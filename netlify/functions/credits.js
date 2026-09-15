/* ── TBT CREDITS — user credit management ──────────────────────────────────
   GET  ?action=balance              — current user's balance
   GET  ?action=users                — owner: all users + balances + access flags
   GET  ?action=my_access            — current user's allowed_features + allowed_asset_classes
   GET  ?action=firm_members         — corp admin: members of caller's firm + their balances

   POST {action:'deduct', amount, description}
     — deduct from own account (usage; all users)

   POST {action:'add', target_user_id, amount}
     — owner only: create credits from nothing and add to any user

   POST {action:'distribute', target_user_id, amount, description}
     — corp admin or owner: move credits FROM caller's account TO target
       (corp admin: own firm members only; owner: anyone)

   POST {action:'recall', target_user_id, amount, description}
     — corp admin or owner: move credits FROM target BACK TO caller's account
       (corp admin: own firm members only; owner: anyone)

   POST {action:'set_access', target_user_id,
         allowed_features, allowed_asset_classes, is_corp_admin}
     — owner only: set feature/asset flags on a user
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL  = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const OWNER_EMAIL   = 'admin@thebrokersterminal.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function ok(data)        { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }; }
function fail(code, msg) { return { statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

async function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey:        SERVICE_KEY,
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

/* Fetch the users table row for a given auth user id */
async function getUserRow(userId) {
  const r = await sbFetch(`/rest/v1/users?id=eq.${userId}&select=id,email,firm_id,role,is_corp_admin,allowed_features,allowed_asset_classes&limit=1`);
  const rows = r.ok ? await r.json() : [];
  return rows.length ? rows[0] : null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const auth = (event.headers.authorization || event.headers.Authorization || '');
  const jwt  = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return fail(401, 'missing_token');

  const authUser = await getUser(jwt);
  if (!authUser || !authUser.id) return fail(401, 'invalid_token');

  const isOwner    = authUser.email === OWNER_EMAIL;
  const userRow    = await getUserRow(authUser.id);
  const isCorpAdmin = isOwner || !!(userRow && userRow.is_corp_admin);

  /* ── GET ── */
  if (event.httpMethod === 'GET') {
    const action = (event.queryStringParameters || {}).action || 'balance';

    if (action === 'balance') {
      const r = await sbFetch(`/rest/v1/user_credits?user_id=eq.${authUser.id}&select=balance,subscription_credits,purchased_credits`);
      const rows = r.ok ? await r.json() : [];
      const row = rows.length ? rows[0] : { balance: 0, subscription_credits: 0, purchased_credits: 0 };
      return ok({
        balance:              row.balance              || 0,
        subscription_credits: row.subscription_credits || 0,
        purchased_credits:    row.purchased_credits    || 0,
      });
    }

    /* Current user's access flags — used by terminal on load */
    if (action === 'my_access') {
      if (isOwner) {
        return ok({
          allowed_features:      ['vault', 'terminal', 'news_feed', 'intel'],
          allowed_asset_classes: null,
          is_corp_admin:         true,
        });
      }
      return ok({
        allowed_features:      userRow ? userRow.allowed_features      : null,
        allowed_asset_classes: userRow ? userRow.allowed_asset_classes : null,
        is_corp_admin:         userRow ? !!userRow.is_corp_admin        : false,
      });
    }

    /* Corp admin: list own firm members + their balances */
    if (action === 'firm_members') {
      if (!isCorpAdmin) return fail(403, 'corp_admin_only');
      const firmId = userRow && userRow.firm_id;
      if (!firmId) return fail(400, 'no_firm');

      const [membersR, creditsR] = await Promise.all([
        sbFetch(`/rest/v1/users?firm_id=eq.${firmId}&select=id,email,first_name,last_name,status,is_corp_admin,allowed_features,allowed_asset_classes`),
        sbFetch('/rest/v1/user_credits?select=user_id,balance'),
      ]);
      const members = membersR.ok ? await membersR.json() : [];
      const credits = creditsR.ok ? await creditsR.json() : [];
      const balMap  = {};
      credits.forEach(function (c) { balMap[c.user_id] = c.balance; });
      members.forEach(function (m) { m.balance = balMap[m.id] || 0; });
      return ok({ members });
    }

    /* Owner: all users + balances + access flags */
    if (action === 'users') {
      if (!isOwner) return fail(403, 'owner_only');

      const [usersR, creditsR] = await Promise.all([
        sbFetch('/rest/v1/users?select=id,email,first_name,last_name,firm_id,status,role,is_corp_admin,allowed_features,allowed_asset_classes&order=created_at.desc'),
        sbFetch('/rest/v1/user_credits?select=user_id,balance,subscription_credits,purchased_credits'),
      ]);
      const users   = usersR.ok  ? await usersR.json()   : [];
      const credits = creditsR.ok ? await creditsR.json() : [];
      const balMap  = {};
      credits.forEach(function (c) { balMap[c.user_id] = c; });
      users.forEach(function (u) {
        const c = balMap[u.id] || {};
        u.balance              = c.balance              || 0;
        u.subscription_credits = c.subscription_credits || 0;
        u.purchased_credits    = c.purchased_credits    || 0;
      });
      return ok({ users });
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
        body: JSON.stringify({ p_user_id: authUser.id, p_amount: amount, p_description: desc }),
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

    /* Add credits — owner only (direct allocation, no deduction from anyone) */
    if (action === 'add') {
      if (!isOwner) return fail(403, 'owner_only');
      const targetId = body.target_user_id;
      const amount   = parseInt(body.amount, 10);
      const desc     = String(body.description || 'owner allocation').slice(0, 200);
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

    /* ── Distribute: caller → target (corp admin: own firm; owner: anyone) ── */
    if (action === 'distribute') {
      if (!isCorpAdmin) return fail(403, 'admin_only');
      const targetId = body.target_user_id;
      const amount   = parseInt(body.amount, 10);
      const desc     = String(body.description || 'credit distribution').slice(0, 200);
      if (!targetId || !amount || amount <= 0) return fail(400, 'invalid_params');
      if (targetId === authUser.id) return fail(400, 'cannot_distribute_to_self');

      if (!isOwner) {
        const targetRow = await getUserRow(targetId);
        if (!targetRow || targetRow.firm_id !== (userRow && userRow.firm_id)) {
          return fail(403, 'outside_firm');
        }
      }

      const r = await sbFetch('/rest/v1/rpc/transfer_credits', {
        method: 'POST',
        body: JSON.stringify({ p_from_user_id: authUser.id, p_to_user_id: targetId, p_amount: amount, p_description: desc }),
      });
      const result = r.ok ? await r.json() : null;
      if (!result) return fail(500, 'rpc_failed');
      if (!result.ok) {
        if (result.error === 'insufficient_credits') return fail(402, 'insufficient_credits');
        if (result.error === 'no_source_account')    return fail(402, 'no_credits_account');
        return fail(500, result.error || 'unknown');
      }
      return ok({ my_balance: result.from_balance, their_balance: result.to_balance });
    }

    /* ── Recall: target → caller (credits returned to admin's account) ── */
    if (action === 'recall') {
      if (!isCorpAdmin) return fail(403, 'admin_only');
      const targetId = body.target_user_id;
      const amount   = parseInt(body.amount, 10);
      const desc     = String(body.description || 'credit recall').slice(0, 200);
      if (!targetId || !amount || amount <= 0) return fail(400, 'invalid_params');
      if (targetId === authUser.id) return fail(400, 'cannot_recall_from_self');

      if (!isOwner) {
        const targetRow = await getUserRow(targetId);
        if (!targetRow || targetRow.firm_id !== (userRow && userRow.firm_id)) {
          return fail(403, 'outside_firm');
        }
      }

      /* Reverse direction: target → caller */
      const r = await sbFetch('/rest/v1/rpc/transfer_credits', {
        method: 'POST',
        body: JSON.stringify({ p_from_user_id: targetId, p_to_user_id: authUser.id, p_amount: amount, p_description: desc }),
      });
      const result = r.ok ? await r.json() : null;
      if (!result) return fail(500, 'rpc_failed');
      if (!result.ok) {
        if (result.error === 'insufficient_credits') return fail(402, 'insufficient_credits');
        if (result.error === 'no_source_account')    return fail(402, 'no_credits_account');
        return fail(500, result.error || 'unknown');
      }
      return ok({ my_balance: result.to_balance, their_balance: result.from_balance });
    }

    /* Remove credits — owner only: debit a user's account directly (credits voided, not transferred) */
    if (action === 'remove') {
      if (!isOwner) return fail(403, 'owner_only');
      const targetId = body.target_user_id;
      const amount   = parseInt(body.amount, 10);
      const desc     = String(body.description || 'owner removal').slice(0, 200);
      if (!targetId || !amount || amount <= 0) return fail(400, 'invalid_params');

      const r = await sbFetch('/rest/v1/rpc/deduct_credits', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: targetId, p_amount: amount, p_description: desc }),
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

    /* Set access flags — owner only */
    if (action === 'set_access') {
      if (!isOwner) return fail(403, 'owner_only');
      const targetId = body.target_user_id;
      if (!targetId) return fail(400, 'missing_target');

      const updates = {};
      if (body.allowed_features      !== undefined) updates.allowed_features      = body.allowed_features      || null;
      if (body.allowed_asset_classes !== undefined) updates.allowed_asset_classes = body.allowed_asset_classes || null;
      if (body.is_corp_admin         !== undefined) updates.is_corp_admin         = !!body.is_corp_admin;

      if (!Object.keys(updates).length) return fail(400, 'nothing_to_update');

      const r = await sbFetch(`/rest/v1/users?id=eq.${targetId}`, {
        method:  'PATCH',
        headers: { Prefer: 'return=representation' },
        body:    JSON.stringify(updates),
      });
      if (!r.ok) {
        const err = await r.text();
        return fail(500, 'update_failed: ' + err.slice(0, 200));
      }
      return ok({ updated: true });
    }

    return fail(400, 'unknown_action');
  }

  return fail(405, 'method_not_allowed');
};
