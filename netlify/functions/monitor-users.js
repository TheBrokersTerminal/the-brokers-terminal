/* ── TBT USER ONBOARDING GUARDIAN ───────────────────────────────────────────
   Scheduled daily at 7am UTC. Finds new users (last 48h) who are missing
   database rows and provisions them. Also flags stuck/broken accounts.
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const ALERT_TO     = 'admin@thebrokersterminal.com';
const OWNER_EMAIL  = 'admin@thebrokersterminal.com';

async function sendAlert(subject, html) {
  if (!RESEND_KEY) { console.error('[user-monitor] RESEND_API_KEY not set'); return; }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TBT Monitor <noreply@thebrokersterminal.com>',
        to: [ALERT_TO],
        subject,
        html,
      }),
    });
  } catch (e) { console.error('[user-monitor] sendAlert failed:', e.message); }
}

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

exports.handler = async function () {
  if (!SERVICE_KEY) {
    console.error('[user-monitor] SUPABASE_SERVICE_KEY not set');
    return { statusCode: 200 };
  }

  const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();

  /* Fetch auth users created in last 48h */
  let authUsers = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?created_after=${encodeURIComponent(twoDaysAgo)}&per_page=100`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const data = r.ok ? await r.json() : {};
    authUsers = data.users || [];
  } catch (e) {
    console.error('[user-monitor] Could not fetch auth users:', e.message);
    return { statusCode: 200 };
  }

  /* Skip the owner account */
  authUsers = authUsers.filter(u => u.email !== OWNER_EMAIL);

  if (authUsers.length === 0) {
    console.log('[user-monitor] No new users in last 48h');
    return { statusCode: 200 };
  }

  console.log('[user-monitor] Checking', authUsers.length, 'new user(s)');

  /* Batch fetch existing credit rows */
  const userIds = authUsers.map(u => u.id);
  const credR = await sbFetch(
    `/rest/v1/user_credits?user_id=in.(${userIds.join(',')})&select=user_id`
  );
  const existingCredits = new Set((credR.ok ? await credR.json() : []).map(r => r.user_id));

  /* Batch fetch existing users table rows */
  const usersR = await sbFetch(
    `/rest/v1/users?id=in.(${userIds.join(',')})&select=id,email,status,allowed_features`
  );
  const existingUsers = usersR.ok ? await usersR.json() : [];
  const userMap = {};
  existingUsers.forEach(u => { userMap[u.id] = u; });

  const provisioned = [];
  const issues      = [];

  for (const authUser of authUsers) {
    const uid   = authUser.id;
    const email = authUser.email || '(no email)';

    /* 1. Provision user_credits row if missing */
    if (!existingCredits.has(uid)) {
      const ir = await sbFetch('/rest/v1/user_credits', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: uid, balance: 0, subscription_credits: 0, purchased_credits: 0 }),
      });
      if (ir.ok || ir.status === 409 /* already exists — race condition */) {
        provisioned.push({ email, action: 'created user_credits row' });
      } else {
        issues.push({ email, issue: `user_credits insert failed: HTTP ${ir.status}` });
      }
    }

    /* 2. Flag users who signed up but have no users table row (incomplete onboarding) */
    if (!userMap[uid]) {
      issues.push({ email, issue: 'missing users table row — signup may be incomplete' });
    }

    /* 3. Flag users still in pending status for > 24h */
    const row = userMap[uid];
    if (row && row.status === 'pending') {
      const createdAt = new Date(authUser.created_at);
      if (Date.now() - createdAt.getTime() > 86400000) {
        issues.push({ email, issue: 'stuck in "pending" status for >24h — may need manual approval' });
      }
    }

    /* 4. Flag users with no allowed_features set */
    if (row && (!row.allowed_features || row.allowed_features.length === 0)) {
      issues.push({ email, issue: 'no allowed_features assigned — user cannot access terminal' });
    }
  }

  if (provisioned.length === 0 && issues.length === 0) {
    console.log('[user-monitor] All', authUsers.length, 'new user(s) fully provisioned — nothing to do');
    return { statusCode: 200 };
  }

  const provList = provisioned.map(p =>
    `<li>${p.email} — ${p.action}</li>`
  ).join('');
  const issueList = issues.map(i =>
    `<li><strong>${i.email}</strong>: ${i.issue}</li>`
  ).join('');

  await sendAlert(
    `TBT Onboarding: ${provisioned.length} provisioned, ${issues.length} issue${issues.length !== 1 ? 's' : ''}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>User Onboarding Report</h2>
      <p>Checked ${authUsers.length} new user(s) registered in the last 48h.</p>
      ${provisioned.length ? `<h3>✅ Auto-provisioned (${provisioned.length})</h3><ul>${provList}</ul>` : ''}
      ${issues.length ? `
        <h3>⚠️ Needs your attention (${issues.length})</h3>
        <ul>${issueList}</ul>
        <p>Log into the <a href="https://thebrokersterminal.com/admin.html">Admin CRM</a> to review these users.</p>
      ` : ''}
      <p style="color:#888;font-size:12px">Checked at ${new Date().toUTCString()}</p>
    </div>`
  );

  return { statusCode: 200 };
};
