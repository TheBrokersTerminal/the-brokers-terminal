/* ── TBT COMPLETE SIGNUP ─────────────────────────────────────────────────────
   Called from signup.html after Stripe payment confirmation.
   Verifies the caller's JWT, then performs all service-role DB operations:
   • Poll for Stripe-created firm (one attempt per call — client retries)
   • Fallback: create individual firm if webhook hasn't fired yet
   • Update firm access field
   • Link user to firm in users table
   • Log login activity

   POST { plan, asset, referralCode }
   Authorization: Bearer <user JWT>

   Returns:
     { ok: true,  firmId, sessionId }   — firm found/created, user linked
     { ok: false, retry: true }          — firm not yet visible, try again
     error responses (401/400/405)
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function ok(data)        { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }; }
function fail(code, msg) { return { statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

async function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return fail(405, 'method_not_allowed');

  /* Verify caller's JWT */
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const jwt  = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return fail(401, 'missing_token');

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!userResp.ok) return fail(401, 'invalid_token');
  const authUser = await userResp.json();
  if (!authUser || !authUser.id || !authUser.email) return fail(401, 'invalid_token');

  const userEmail = authUser.email.toLowerCase();
  const domain    = userEmail.split('@')[1];

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'invalid_json'); }

  const plan         = body.plan || 'individual'; // 'individual' | 'corporate'
  const asset        = body.asset || 'gold';
  const referralCode = body.referralCode || null;

  let firm     = null;
  let firmRole = 'subscriber';

  /* ── 1. Look for a Stripe-created firm ─────────────────────────────────── */
  if (plan === 'corporate') {
    const r = await sb(
      `/rest/v1/firms?domain=eq.${encodeURIComponent(domain)}&subscription_type=eq.corporate&status=eq.active&select=id,status&order=created_at.desc&limit=1`
    );
    const rows = r.ok ? await r.json() : [];
    if (rows.length) { firm = rows[0]; firmRole = 'admin'; }
  } else {
    const r = await sb(
      `/rest/v1/firms?owner_email=eq.${encodeURIComponent(userEmail)}&subscription_type=eq.individual&status=eq.active&select=id,status&order=created_at.desc&limit=1`
    );
    const rows = r.ok ? await r.json() : [];
    if (rows.length) firm = rows[0];
  }

  /* ── 2. Individual fallback: create firm if webhook hasn't fired yet ─────── */
  if (!firm && plan === 'individual') {
    const chkR  = await sb(
      `/rest/v1/firms?owner_email=eq.${encodeURIComponent(userEmail)}&subscription_type=eq.individual&select=id,status&limit=1`
    );
    const existing = chkR.ok ? await chkR.json() : [];

    if (existing.length) {
      /* Firm exists but may be inactive */
      if (existing[0].status !== 'active') {
        await sb(`/rest/v1/firms?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          body:   JSON.stringify({ status: 'active', access: asset }),
        });
      }
      firm = existing[0];
    } else {
      /* Create firm directly */
      const newFirm = {
        company_name:      userEmail.split('@')[0],
        domain,
        owner_email:       userEmail,
        subscription_type: 'individual',
        max_users:         1,
        status:            'active',
        access:            asset,
      };
      if (referralCode) newFirm.referral_code = referralCode;

      const crtR = await sb('/rest/v1/firms', {
        method:  'POST',
        headers: { Prefer: 'return=representation' },
        body:    JSON.stringify(newFirm),
      });
      const created = crtR.ok ? await crtR.json() : null;
      firm = Array.isArray(created) ? created[0] : (created || null);
    }
  }

  /* ── 3. Corporate firm still not found — tell client to retry ──────────── */
  if (!firm) return ok({ ok: false, retry: true });

  /* ── 4. Update firm access + referral ─────────────────────────────────── */
  const firmPatch = { access: asset };
  if (referralCode) firmPatch.referral_code = referralCode;
  await sb(`/rest/v1/firms?id=eq.${firm.id}`, {
    method: 'PATCH',
    body:   JSON.stringify(firmPatch),
  });

  /* ── 5. Link user to firm ─────────────────────────────────────────────── */
  const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36);

  await sb(`/rest/v1/users?email=eq.${encodeURIComponent(userEmail)}`, {
    method: 'PATCH',
    body:   JSON.stringify({
      firm_id:           firm.id,
      role:              firmRole,
      current_session_id: sessionId,
      last_login_at:     new Date().toISOString(),
    }),
  });

  /* ── 6. Log activity (fire and forget) ───────────────────────────────── */
  sb('/rest/v1/activity_log', {
    method: 'POST',
    body:   JSON.stringify({ user_email: userEmail, firm_id: firm.id, action: 'login' }),
  }).catch(() => {});

  return ok({ ok: true, firmId: firm.id, sessionId });
};
