/* ── TBT ADMIN PROXY ────────────────────────────────────────────────────────
   Server-side proxy for all admin CRM operations.
   All requests must include a valid JWT for admin@thebrokersterminal.com.
   Service key is ONLY here — never in client-side HTML.

   Actions:
     rest              — forward any Supabase REST call (table queries)
     auth_create_user  — create an auth user
     auth_update_user  — update password / metadata
     auth_delete_user  — hard-delete an auth user
     auth_list_users   — list all auth users
     storage_remove    — delete files from storage
     storage_upload_url — create a signed upload URL (browser uploads directly)
     functions_invoke  — call a Supabase Edge Function
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL  = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const OWNER_EMAIL   = 'admin@thebrokersterminal.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function ok(data)        { return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }; }
function fail(code, msg) { return { statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

async function sbFetch(path, opts = {}) {
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

async function verifyOwner(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const jwt = authHeader.slice(7);
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    if (!user || user.email !== OWNER_EMAIL) return null;
    return user;
  } catch { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return fail(405, 'method_not_allowed');

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const owner = await verifyOwner(authHeader);
  if (!owner) return fail(403, 'owner_only');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'invalid_json'); }

  const { action } = body;

  /* ── Generic REST proxy ────────────────────────────────────────────────── */
  if (action === 'rest') {
    const { path, method = 'GET', reqBody, prefer } = body;
    if (!path || !path.startsWith('/rest/v1/')) return fail(400, 'invalid_path');

    const headers = {};
    if (prefer) headers['Prefer'] = prefer;

    const r = await sbFetch(path, {
      method,
      headers,
      body: reqBody != null ? JSON.stringify(reqBody) : undefined,
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!r.ok) {
      return { statusCode: r.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: data }) };
    }

    /* Extract total count from Content-Range header if a count was requested */
    let count = null;
    if (prefer && prefer.includes('count=exact')) {
      const cr = r.headers.get('Content-Range') || r.headers.get('content-range');
      if (cr) {
        const m = cr.match(/\/(\d+)$/);
        if (m) count = parseInt(m[1], 10);
      }
    }
    return ok({ data, count, status: r.status });
  }

  /* ── Auth: create user ─────────────────────────────────────────────────── */
  if (action === 'auth_create_user') {
    const { email, password, user_metadata } = body;
    if (!email || !password) return fail(400, 'missing_email_or_password');

    const r = await sbFetch('/auth/v1/admin/users', {
      method: 'POST',
      body:   JSON.stringify({ email, password, email_confirm: true, user_metadata: user_metadata || {} }),
    });
    const result = await r.json();
    if (!r.ok) return fail(r.status, result.msg || result.error || 'create_failed');
    return ok({ user: result });
  }

  /* ── Auth: update user ─────────────────────────────────────────────────── */
  if (action === 'auth_update_user') {
    const { user_id, updates } = body;
    if (!user_id || !updates) return fail(400, 'missing_params');

    const r = await sbFetch(`/auth/v1/admin/users/${user_id}`, {
      method: 'PUT',
      body:   JSON.stringify(updates),
    });
    const result = await r.json();
    if (!r.ok) return fail(r.status, result.msg || 'update_failed');
    return ok({ user: result });
  }

  /* ── Auth: delete user ─────────────────────────────────────────────────── */
  if (action === 'auth_delete_user') {
    const { user_id } = body;
    if (!user_id) return fail(400, 'missing_user_id');

    const r = await sbFetch(`/auth/v1/admin/users/${user_id}`, { method: 'DELETE' });
    if (!r.ok) {
      const err = await r.text();
      return fail(r.status, err.slice(0, 200));
    }
    return ok({ deleted: true });
  }

  /* ── Auth: list users ──────────────────────────────────────────────────── */
  if (action === 'auth_list_users') {
    const r = await sbFetch('/auth/v1/admin/users?per_page=1000');
    if (!r.ok) return fail(r.status, 'list_failed');
    const result = await r.json();
    return ok({ users: result.users || result });
  }

  /* ── Storage: remove files ─────────────────────────────────────────────── */
  if (action === 'storage_remove') {
    const { bucket, paths } = body;
    if (!bucket || !Array.isArray(paths)) return fail(400, 'missing_params');

    const r = await sbFetch(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method:  'DELETE',
      body:    JSON.stringify({ prefixes: paths }),
    });
    if (!r.ok) {
      const err = await r.text();
      return fail(r.status, err.slice(0, 200));
    }
    return ok({ deleted: true });
  }

  /* ── Storage: create signed upload URL (browser uploads directly) ──────── */
  if (action === 'storage_upload_url') {
    const { bucket, path: filePath } = body;
    if (!bucket || !filePath) return fail(400, 'missing_params');

    const r = await sbFetch(`/storage/v1/object/sign/upload/${encodeURIComponent(bucket)}/${filePath}`, {
      method: 'POST',
      body:   JSON.stringify({}),
    });
    if (!r.ok) {
      const err = await r.text();
      return fail(r.status, err.slice(0, 200));
    }
    const result = await r.json();
    return ok({ signed_url: SUPABASE_URL + result.url, token: result.token });
  }

  /* ── Edge Functions: invoke ────────────────────────────────────────────── */
  if (action === 'functions_invoke') {
    const { function_name, fn_body } = body;
    if (!function_name) return fail(400, 'missing_function_name');

    const r = await fetch(`${SUPABASE_URL}/functions/v1/${function_name}`, {
      method:  'POST',
      headers: {
        apikey:         SERVICE_KEY,
        Authorization:  `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: fn_body != null ? JSON.stringify(fn_body) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return ok({ data, status: r.status });
  }

  return fail(400, 'unknown_action');
};
