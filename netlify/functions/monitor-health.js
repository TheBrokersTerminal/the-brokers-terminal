/* ── TBT HEALTH MONITOR ──────────────────────────────────────────────────────
   Scheduled every 30 minutes. Checks all critical platform endpoints.
   Sends email alert to admin if any service is down.
   Requires: RESEND_API_KEY in Netlify env vars
   ─────────────────────────────────────────────────────────────────────────── */

const SITE_URL    = 'https://thebrokersterminal.com';
const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const ALERT_TO     = 'admin@thebrokersterminal.com';

async function sendAlert(subject, html) {
  if (!RESEND_KEY) { console.error('[health] RESEND_API_KEY not set — skipping email'); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TBT Monitor <noreply@thebrokersterminal.com>',
        to: [ALERT_TO],
        subject,
        html,
      }),
    });
    if (!r.ok) console.error('[health] Resend error:', r.status, await r.text());
  } catch (e) { console.error('[health] sendAlert failed:', e.message); }
}

async function check(name, url, options = {}) {
  const { timeout = 9000 } = options;
  try {
    const r = await fetch(url, {
      headers: options.headers || {},
      signal: AbortSignal.timeout(timeout),
    });
    /* Any 4xx means the function is running and responding correctly —
       401 = auth required, 400 = missing params, 405 = wrong method.
       Only 5xx indicates an actual server/function failure. */
    const ok = r.status < 500;
    return { name, ok, status: r.status };
  } catch (e) {
    return { name, ok: false, status: null, error: e.message };
  }
}

exports.handler = async function () {
  const results = await Promise.allSettled([
    check('INTEL (search)',   `${SITE_URL}/.netlify/functions/search`),
    check('INTEL (explain)',  `${SITE_URL}/.netlify/functions/explain`),
    check('Whisky terminal',  `${SITE_URL}/.netlify/functions/whisky-data?type=search&query=macallan`),
    check('News feed',        `${SITE_URL}/.netlify/functions/media-feed?limit=1`),
    check('Credits API',      `${SITE_URL}/.netlify/functions/credits`),
    check('Stripe credits',   `${SITE_URL}/.netlify/functions/stripe-credits`),
  ]);

  const checks = results.map(r => r.status === 'fulfilled' ? r.value : { name: 'unknown', ok: false, error: r.reason?.message });

  /* Supabase connectivity check */
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    checks.push({ name: 'Supabase DB', ok: r.ok, status: r.status });
  } catch (e) {
    checks.push({ name: 'Supabase DB', ok: false, error: e.message });
  }

  const failed = checks.filter(c => !c.ok);
  const passed = checks.filter(c => c.ok);

  if (failed.length === 0) {
    console.log(`[health] All ${checks.length} checks passed`);
    return { statusCode: 200 };
  }

  console.error('[health] FAILURES:', JSON.stringify(failed));

  const failList = failed.map(c =>
    `<li><strong>${c.name}</strong> — ${c.error || `HTTP ${c.status}`}</li>`
  ).join('');
  const passList = passed.map(c => `${c.name} ✅`).join(' &nbsp;·&nbsp; ');

  await sendAlert(
    `🚨 TBT: ${failed.length} service${failed.length > 1 ? 's' : ''} down`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#c0392b">Platform Health Alert</h2>
      <p><strong>${failed.length} of ${checks.length} services failing</strong> at ${new Date().toUTCString()}</p>
      <h3>❌ Failing</h3>
      <ul>${failList}</ul>
      <h3>✅ Passing</h3>
      <p style="color:#555;font-size:13px">${passList}</p>
      <p style="color:#888;font-size:12px">This alert fires every 30 minutes while the issue persists.</p>
    </div>`
  );

  return { statusCode: 200 };
};
