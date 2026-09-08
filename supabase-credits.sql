-- ── TBT CREDIT SYSTEM — run in Supabase SQL editor ─────────────────────────

-- 1. User credit balances
CREATE TABLE IF NOT EXISTS user_credits (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Full audit trail
CREATE TABLE IF NOT EXISTS credit_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('allocation','purchase','usage','refund')),
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Atomic deduct (prevents race conditions — uses row-level lock)
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id    UUID,
  p_amount     INTEGER,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance     INTEGER;
  v_new_balance INTEGER;
BEGIN
  SELECT balance INTO v_balance FROM user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_account', 'balance', 0);
  END IF;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', v_balance);
  END IF;
  v_new_balance := v_balance - p_amount;
  UPDATE user_credits SET balance = v_new_balance, updated_at = NOW() WHERE user_id = p_user_id;
  INSERT INTO credit_transactions (user_id, amount, type, description)
  VALUES (p_user_id, -p_amount, 'usage', p_description);
  RETURN jsonb_build_object('ok', true, 'balance', v_new_balance);
END;
$$;

-- 4. Add credits (allocation or purchase)
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id    UUID,
  p_amount     INTEGER,
  p_type       TEXT DEFAULT 'allocation',
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  INSERT INTO user_credits (user_id, balance, updated_at)
  VALUES (p_user_id, p_amount, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET balance = user_credits.balance + p_amount, updated_at = NOW()
  RETURNING balance INTO v_new_balance;
  INSERT INTO credit_transactions (user_id, amount, type, description)
  VALUES (p_user_id, p_amount, p_type, p_description);
  RETURN jsonb_build_object('ok', true, 'balance', v_new_balance);
END;
$$;

-- 5. RLS — users read their own data only; service role (Netlify) bypasses RLS
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_credits" ON user_credits;
CREATE POLICY "users_read_own_credits" ON user_credits
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_read_own_transactions" ON credit_transactions;
CREATE POLICY "users_read_own_transactions" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);
