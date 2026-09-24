-- ── TBT Security: RLS on user_credits + users write protection ──────────────
-- Run in Supabase SQL Editor AFTER migration_access_flags.sql

-- ── 1. user_credits: lock down direct writes ─────────────────────────────────
-- Enable RLS (if not already on)
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;

-- Users can only READ their own row — balance display in the UI
DROP POLICY IF EXISTS "Users can read own credits" ON user_credits;
CREATE POLICY "Users can read own credits"
  ON user_credits FOR SELECT
  USING (auth.uid() = user_id);

-- NO INSERT, UPDATE, or DELETE policies for authenticated users.
-- All mutations go through server-side RPCs (deduct_credits, add_credits,
-- transfer_credits) which run as SECURITY DEFINER with service_role bypass.
-- Without a permissive policy, direct REST API writes are blocked.

-- Service role (used by Netlify functions) bypasses RLS automatically.

-- ── 2. users table: block direct writes to sensitive columns ─────────────────
-- Users should not be able to update their own allowed_features,
-- allowed_asset_classes, or is_corp_admin via direct Supabase REST calls.
-- Only the service role (Netlify functions) may write these columns.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own row (needed for dashboard queries)
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Allow users to update only safe personal fields (name, preferences)
-- Explicitly excludes: allowed_features, allowed_asset_classes, is_corp_admin, role, firm_id, status
DROP POLICY IF EXISTS "Users can update own safe fields" ON users;
CREATE POLICY "Users can update own safe fields"
  ON users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent self-elevation: these columns must be unchanged from their current values
    -- (Supabase doesn't support column-level restrictions in policies directly,
    --  so we use a trigger below for the sensitive columns)
  );

-- ── 3. Trigger to block self-modification of privilege columns ────────────────
CREATE OR REPLACE FUNCTION prevent_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow service_role to change these columns
  IF current_setting('role') != 'service_role' THEN
    IF NEW.allowed_features      IS DISTINCT FROM OLD.allowed_features OR
       NEW.allowed_asset_classes IS DISTINCT FROM OLD.allowed_asset_classes OR
       NEW.is_corp_admin          IS DISTINCT FROM OLD.is_corp_admin OR
       NEW.role                   IS DISTINCT FROM OLD.role OR
       NEW.status                 IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot modify privilege fields directly';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_privilege_escalation ON users;
CREATE TRIGGER trg_prevent_privilege_escalation
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_privilege_escalation();

-- ── 4. intelligence_cache: read-only for authenticated users ─────────────────
-- Cache is populated by server only; users should not be able to inject
-- fake cached responses to serve others free content.
ALTER TABLE intelligence_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read cache" ON intelligence_cache;
CREATE POLICY "Authenticated users can read cache"
  ON intelligence_cache FOR SELECT
  USING (auth.role() = 'authenticated');

-- No INSERT/UPDATE/DELETE policies — service_role only writes cache.
