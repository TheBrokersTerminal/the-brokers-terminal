/* ── TBT CREDITS — user credit management ──────────────────────────────────
   GET  ?action=balance           — current user's balance
   GET  ?action=users             — admin: all users + balances
   POST {action:'deduct', amount, description}   — deduct credits (user)
   POST {action:'add', target_user_id, amount}   — admin: add credits to user
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL  = 'admin@thebrokersterminal.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function ok(data)     { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }; }
function fail(code, msg) { return { statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

async function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function getUser(jwt) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const auth = (event.headers.authorization || event.headers.Authorization || '');
  const jwt  = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return fail(401, 'missing_token');

  const user = await getUser(jwt);
  if (!user || !user.id) return fail(401, 'invalid_token');

  const isAdmin = user.email === ADMIN_EMAIL;

  /* ── GET ── */
  if (event.httpMethod === 'GET') {
    const action = (event.queryStringParameters || {}).action || 'balance';

    if (action === 'balance') {
      const r = await sbFetch(`/rest/v1/user_credits?user_id=eq.${user.id}&select=balance`);
      const rows = r.ok ? await r.json() : [];
      return ok({ balance: rows.length ? rows[0].balance : 0 });
    }

    if (action === 'users') {
      if (!isAdmin) return fail(403, 'admin_only');
      /* Get all auth users via admin API */
      const authR = await sbFetch('/auth/v1/admin/users?per_page=1000');
      const authData = authR.ok ? await authR.json() : { users: [] };
      const authUsers = authData.users || [];

      /* Get all credit balances */
      const credR = await sbFetch('/rest/v1/user_credits?select=user_id,balance,updated_at&order=balance.desc');
      const credits = credR.ok ? await credR.json() : [];
      const creditMap = {};
      credits.forEach(function (c) { creditMap[c.user_id] = c; });

      const list = authUsers.map(function (u) {
        const c = creditMap[u.id] || { balance: 0 };
        return { id: u.id, email: u.email, balance: c.balance };
      });
      list.sort(function (a, b) { return b.balance - a.balance; });
      return ok({ users: list });
    }

    return fail(400, 'unknown_action');
  }

  /* ── POST ── */
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'invalid_json'); }

    const action = body.action;

    /* Deduct credits — atomic via Postgres RPC */
    if (action === 'deduct') {
      const amount = parseInt(body.amount, 10);
      const desc   = String(body.description || 'usage').slice(0, 200);
      if (!amount || amount <= 0) return fail(400, 'invalid_amount');

      const r = await sbFetch('/rest/v1/rpc/deduct_credits', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: user.id, p_amount: amount, p_description: desc }),
      });
      const result = r.ok ? await r.json() : null;
      if (!result) return fail(500, 'rpc_failed');
      if (!result.ok) {
        if (result.error === 'insufficient') return fail(402, 'insufficient_credits');
        if (result.error === 'no_account')   return fail(402, 'no_credits_account');
        return fail(500, result.error || 'unknown');
      }
      return ok({ balance: result.balance });
    }

    /* Add credits — admin only */
    if (action === 'add') {
      if (!isAdmin) return fail(403, 'admin_only');
      const targetId = body.target_user_id;
      const amount   = parseInt(body.amount, 10);
      const desc     = String(body.description || 'admin allocation').slice(0, 200);
      const type     = body.type || 'allocation';
      if (!targetId || !amount || amount <= 0) return fail(400, 'invalid_params');

      const r = await sbFetch('/rest/v1/rpc/add_credits', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: targetId, p_amount: amount, p_type: type, p_description: desc }),
      });
      const result = r.ok ? await r.json() : null;
      if (!result || !result.ok) return fail(500, 'rpc_failed');
      return ok({ balance: result.balance });
    }

    return fail(400, 'unknown_action');
  }

  return fail(405, 'method_not_allowed');
};
