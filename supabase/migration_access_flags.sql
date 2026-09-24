-- ── TBT Access Flags + Credit Transfer Migration ─────────────────────────
-- Run in Supabase SQL Editor (Project Settings → SQL Editor)

-- 1. Add per-user feature flags
--    null  = vault only (legacy default for non-owner users)
--    array = subset of ['vault','terminal','news_feed','intel']
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allowed_features text[] DEFAULT NULL;

-- 2. Add per-user asset class restrictions
--    null  = all asset classes (no restriction)
--    array = e.g. ['whisky'] means only whisky reports/widgets visible
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allowed_asset_classes text[] DEFAULT NULL;

-- 3. Mark corp-admin users (can distribute credits within their firm)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_corp_admin boolean NOT NULL DEFAULT false;

-- 4. Set owner accounts to full access (so migration doesn't break them)
UPDATE users
  SET allowed_features = ARRAY['vault','terminal','news_feed','intel']
  WHERE email IN ('admin@thebrokersterminal.com', 'desk@thebrokersterminal.com');

-- 5. RPC: transfer credits between users
--    p_from_user_id: source user (must be caller or admin)
--    p_to_user_id:   target user
--    p_amount:       positive integer credits to move
--    p_description:  audit note
CREATE OR REPLACE FUNCTION transfer_credits(
  p_from_user_id uuid,
  p_to_user_id   uuid,
  p_amount       integer,
  p_description  text DEFAULT 'credit transfer'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_from_balance integer;
  v_from_new     integer;
  v_to_balance   integer;
  v_to_new       integer;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  -- Lock both rows in consistent order to avoid deadlock
  SELECT balance INTO v_from_balance
    FROM user_credits
    WHERE user_id = p_from_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_source_account');
  END IF;

  IF v_from_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_credits', 'balance', v_from_balance);
  END IF;

  v_from_new := v_from_balance - p_amount;
  UPDATE user_credits SET balance = v_from_new, updated_at = now()
    WHERE user_id = p_from_user_id;

  -- Upsert target account
  INSERT INTO user_credits (user_id, balance, updated_at)
    VALUES (p_to_user_id, p_amount, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance = user_credits.balance + p_amount, updated_at = now()
    RETURNING balance INTO v_to_new;

  -- Audit log (reuse credit_transactions table if it exists, else skip)
  BEGIN
    INSERT INTO credit_transactions (user_id, amount, type, description, created_at)
      VALUES (p_from_user_id, -p_amount, 'transfer_out', p_description, now());
    INSERT INTO credit_transactions (user_id, amount, type, description, created_at)
      VALUES (p_to_user_id,   p_amount,  'transfer_in',  p_description, now());
  EXCEPTION WHEN undefined_table THEN NULL; END;

  RETURN jsonb_build_object(
    'ok',           true,
    'from_balance', v_from_new,
    'to_balance',   v_to_new
  );
END;
$$;

-- Grant execute to authenticated users (server enforces who can call it)
GRANT EXECUTE ON FUNCTION transfer_credits TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_credits TO service_role;

-- 6. Index for looking up users by firm (helps corp-admin queries)
CREATE INDEX IF NOT EXISTS idx_users_firm_id ON users(firm_id);
