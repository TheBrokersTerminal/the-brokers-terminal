/* ── TBT SUBSCRIPTION CREDITS MIGRATION ─────────────────────────────────────
   Adds two credit buckets to user_credits:
     subscription_credits  — resets monthly on Stripe invoice.paid
     purchased_credits     — carry-over, never expire
   Existing balance migrated entirely to purchased_credits (safe default).
   Updates deduct_credits, add_credits, transfer_credits RPCs.
   Adds set_subscription_credits RPC (called by stripe-webhook).
   ─────────────────────────────────────────────────────────────────────────── */

/* ── 1. Add new columns ──────────────────────────────────────────────────── */
ALTER TABLE user_credits
  ADD COLUMN IF NOT EXISTS subscription_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchased_credits    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_reset_at TIMESTAMPTZ;

/* Migrate: existing balance → purchased_credits (carry-over by default) */
UPDATE user_credits
SET purchased_credits = balance
WHERE purchased_credits = 0 AND balance > 0;

/* ── 2. deduct_credits — drain subscription first, then purchased ─────────── */
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id    UUID,
  p_amount     INT,
  p_description TEXT DEFAULT 'usage'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sub  INT;
  v_pur  INT;
  v_total INT;
  v_sub_use INT;
  v_pur_use INT;
BEGIN
  SELECT subscription_credits, purchased_credits
  INTO v_sub, v_pur
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_account', 'balance', 0);
  END IF;

  v_total := v_sub + v_pur;
  IF v_total < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', v_total,
      'subscription_credits', v_sub, 'purchased_credits', v_pur);
  END IF;

  /* Drain subscription first */
  v_sub_use := LEAST(v_sub, p_amount);
  v_pur_use := p_amount - v_sub_use;

  UPDATE user_credits
  SET
    subscription_credits = subscription_credits - v_sub_use,
    purchased_credits    = purchased_credits    - v_pur_use,
    balance              = balance              - p_amount,
    updated_at           = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (user_id, amount, type, description)
  VALUES (p_user_id, -p_amount, 'usage', p_description);

  RETURN jsonb_build_object(
    'ok',                  true,
    'balance',             v_total - p_amount,
    'subscription_credits', v_sub - v_sub_use,
    'purchased_credits',   v_pur - v_pur_use
  );
END;
$$;

/* ── 3. add_credits — accepts p_credit_type ('subscription' | 'purchased') ─ */
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id     UUID,
  p_amount      INT,
  p_type        TEXT DEFAULT 'allocation',
  p_description TEXT DEFAULT '',
  p_credit_type TEXT DEFAULT 'purchased'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance INT;
BEGIN
  INSERT INTO user_credits (user_id, subscription_credits, purchased_credits, balance)
  VALUES (
    p_user_id,
    CASE WHEN p_credit_type = 'subscription' THEN p_amount ELSE 0 END,
    CASE WHEN p_credit_type = 'purchased'    THEN p_amount ELSE 0 END,
    p_amount
  )
  ON CONFLICT (user_id) DO UPDATE SET
    subscription_credits = user_credits.subscription_credits +
      CASE WHEN p_credit_type = 'subscription' THEN p_amount ELSE 0 END,
    purchased_credits    = user_credits.purchased_credits +
      CASE WHEN p_credit_type = 'purchased'    THEN p_amount ELSE 0 END,
    balance              = user_credits.balance + p_amount,
    updated_at           = NOW();

  SELECT balance INTO v_balance FROM user_credits WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (user_id, amount, type, description)
  VALUES (p_user_id, p_amount, p_type, p_description);

  RETURN jsonb_build_object('ok', true, 'balance', v_balance);
END;
$$;

/* ── 4. set_subscription_credits — replace subscription bucket, keep purchased */
CREATE OR REPLACE FUNCTION set_subscription_credits(
  p_user_id    UUID,
  p_amount     INT,
  p_description TEXT DEFAULT 'subscription renewal'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_sub INT := 0;
  v_pur     INT := 0;
  v_new_bal INT;
BEGIN
  SELECT subscription_credits, purchased_credits
  INTO v_old_sub, v_pur
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO user_credits (user_id, subscription_credits, purchased_credits, balance, subscription_reset_at)
    VALUES (p_user_id, p_amount, 0, p_amount, NOW());

    INSERT INTO credit_transactions (user_id, amount, type, description)
    VALUES (p_user_id, p_amount, 'subscription', p_description);

    RETURN jsonb_build_object('ok', true, 'balance', p_amount,
      'subscription_credits', p_amount, 'purchased_credits', 0);
  END IF;

  v_new_bal := p_amount + v_pur;

  UPDATE user_credits
  SET
    subscription_credits  = p_amount,
    balance               = v_new_bal,
    subscription_reset_at = NOW(),
    updated_at            = NOW()
  WHERE user_id = p_user_id;

  /* Log the delta — positive means top-up, negative means unused credits expired */
  INSERT INTO credit_transactions (user_id, amount, type, description)
  VALUES (p_user_id, p_amount - v_old_sub, 'subscription', p_description);

  RETURN jsonb_build_object('ok', true, 'balance', v_new_bal,
    'subscription_credits', p_amount, 'purchased_credits', v_pur);
END;
$$;

/* ── 5. transfer_credits — deducts subscription first from sender ─────────── */
CREATE OR REPLACE FUNCTION transfer_credits(
  p_from_user_id UUID,
  p_to_user_id   UUID,
  p_amount       INT,
  p_description  TEXT DEFAULT 'transfer'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_from_sub  INT;
  v_from_pur  INT;
  v_from_total INT;
  v_sub_use   INT;
  v_pur_use   INT;
  v_from_new  INT;
  v_to_new    INT;
BEGIN
  SELECT subscription_credits, purchased_credits
  INTO v_from_sub, v_from_pur
  FROM user_credits
  WHERE user_id = p_from_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_source_account');
  END IF;

  v_from_total := v_from_sub + v_from_pur;
  IF v_from_total < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_credits',
      'balance', v_from_total);
  END IF;

  v_sub_use := LEAST(v_from_sub, p_amount);
  v_pur_use := p_amount - v_sub_use;

  UPDATE user_credits
  SET
    subscription_credits = subscription_credits - v_sub_use,
    purchased_credits    = purchased_credits    - v_pur_use,
    balance              = balance              - p_amount,
    updated_at           = NOW()
  WHERE user_id = p_from_user_id;

  /* Credits land in recipient's purchased bucket (they carry over) */
  INSERT INTO user_credits (user_id, subscription_credits, purchased_credits, balance)
  VALUES (p_to_user_id, 0, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    purchased_credits = user_credits.purchased_credits + p_amount,
    balance           = user_credits.balance           + p_amount,
    updated_at        = NOW();

  INSERT INTO credit_transactions (user_id, amount, type, description)
  VALUES
    (p_from_user_id, -p_amount, 'transfer_out', p_description),
    (p_to_user_id,   p_amount,  'transfer_in',  p_description);

  SELECT balance INTO v_from_new FROM user_credits WHERE user_id = p_from_user_id;
  SELECT balance INTO v_to_new   FROM user_credits WHERE user_id = p_to_user_id;

  RETURN jsonb_build_object('ok', true,
    'from_balance', v_from_new,
    'to_balance',   v_to_new
  );
END;
$$;
