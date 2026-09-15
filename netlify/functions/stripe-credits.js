/* ── TBT STRIPE CREDITS — buy credit packages via Stripe Checkout ───────────
   GET  ?action=create&package=X  — creates a Checkout session, returns {url}
   GET  ?action=verify&session_id=cs_xxx — verifies payment, adds credits
   ─────────────────────────────────────────────────────────────────────────── */

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL  = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SUCCESS_URL   = 'https://thebrokersterminal.com/dashboard.html?credits_session={CHECKOUT_SESSION_ID}';
const CANCEL_URL    = 'https://thebrokersterminal.com/dashboard.html';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

const PACKAGES = {
  '500':   { credits: 500,   amount: 500,  name: '500 INTEL Credits' },
  '2000':  { credits: 2000,  amount: 2000, name: '2,000 INTEL Credits' },
  '5000':  { credits: 5000,  amount: 5000, name: '5,000 INTEL Credits' },
  '10000': { credits: 10000, amount: 10000, name: '10,000 INTEL Credits' },
};

function ok(data) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
}
function fail(code, msg) {
  return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) };
}

async function getUser(jwt) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return fail(405, 'method_not_allowed');

  if (!STRIPE_SECRET) return fail(503, 'stripe_not_configured');
  if (!SUPABASE_KEY)  return fail(503, 'supabase_not_configured');

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const jwt  = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return fail(401, 'missing_token');

  const user = await getUser(jwt);
  if (!user || !user.id) return fail(401, 'invalid_token');

  const params = event.queryStringParameters || {};
  const action = params.action;

  /* ── CREATE CHECKOUT SESSION ── */
  if (action === 'create') {
    const pkg = PACKAGES[params.package];
    if (!pkg) return fail(400, 'invalid_package');

    const body = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][unit_amount]': String(pkg.amount),
      'line_items[0][price_data][product_data][name]': pkg.name,
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'success_url': SUCCESS_URL,
      'cancel_url': CANCEL_URL,
      'client_reference_id': `credits:${user.id}:${params.package}`,
      'customer_email': user.email || '',
    });

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const session = await r.json();
    if (!r.ok) return fail(502, session.error?.message || 'stripe_error');
    return ok({ url: session.url });
  }

  /* ── VERIFY SESSION + ADD CREDITS ── */
  if (action === 'verify') {
    const sessionId = params.session_id;
    if (!sessionId || !sessionId.startsWith('cs_')) return fail(400, 'invalid_session_id');

    /* Fetch session from Stripe */
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
    });
    const session = await r.json();
    if (!r.ok) return fail(502, session.error?.message || 'stripe_error');

    /* Must be paid */
    if (session.payment_status !== 'paid') return fail(402, 'payment_not_completed');

    /* Extract package from client_reference_id: "credits:{userId}:{package}" */
    const ref = session.client_reference_id || '';
    const parts = ref.split(':');
    if (parts[0] !== 'credits') return fail(400, 'invalid_reference');
    /* Prevent credit hijacking: session must belong to the authenticated user */
    if (parts[1] !== user.id) return fail(403, 'session_belongs_to_different_user');
    const pkgKey = parts[2];
    const pkg = PACKAGES[pkgKey];
    if (!pkg) return fail(400, 'unknown_package');

    /* Idempotency: check if this session ID already credited */
    const existing = await sbFetch(
      `/rest/v1/credit_transactions?description=like.stripe-topup:${sessionId}%25&user_id=eq.${user.id}&select=id&limit=1`
    );
    const rows = existing.ok ? await existing.json() : [];
    if (rows.length) {
      /* Already credited — return current balance */
      const balR = await sbFetch(`/rest/v1/user_credits?user_id=eq.${user.id}&select=balance`);
      const balRows = balR.ok ? await balR.json() : [];
      return ok({ already_credited: true, balance: balRows.length ? balRows[0].balance : 0 });
    }

    /* Add credits */
    const addR = await sbFetch('/rest/v1/rpc/add_credits', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: user.id,
        p_amount: pkg.credits,
        p_type: 'purchase',
        p_description: `stripe-topup:${sessionId}:${pkgKey}`,
      }),
    });
    const addResult = addR.ok ? await addR.json() : null;
    if (!addResult || !addResult.ok) return fail(500, 'credit_add_failed');

    return ok({ credits_added: pkg.credits, balance: addResult.balance });
  }

  return fail(400, 'unknown_action');
};
