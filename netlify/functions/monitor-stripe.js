/* ── TBT STRIPE WEBHOOK AUDITOR ─────────────────────────────────────────────
   Scheduled daily at 8am UTC. Checks that every subscription invoice paid
   in the last 24h had its credits correctly reset in Supabase.
   If any slipped through (webhook failure), this auto-repairs them.
   ─────────────────────────────────────────────────────────────────────────── */

const STRIPE_SECRET  = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL   = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY     = process.env.RESEND_API_KEY;
const ALERT_TO       = 'admin@thebrokersterminal.com';

const PLAN_CREDITS = { 4900: 4900, 49900: 49000 };

function creditsForAmount(pence) {
  if (PLAN_CREDITS[pence] !== undefined) return PLAN_CREDITS[pence];
  if (pence >= 49900) return 49000;
  if (pence >= 4900)  return 4900;
  return 0;
}

async function sendAlert(subject, html) {
  if (!RESEND_KEY) { console.error('[stripe-audit] RESEND_API_KEY not set'); return; }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TBT Monitor <onboarding@resend.dev>',
        to: [ALERT_TO],
        subject,
        html,
      }),
    });
  } catch (e) { console.error('[stripe-audit] sendAlert failed:', e.message); }
}

async function sb(path, opts = {}) {
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

async function getCustomerEmail(customerId) {
  try {
    const r = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
    });
    const c = r.ok ? await r.json() : null;
    return c && c.email;
  } catch { return null; }
}

exports.handler = async function () {
  if (!STRIPE_SECRET || !SERVICE_KEY) {
    console.error('[stripe-audit] Missing env vars');
    return { statusCode: 200 };
  }

  /* Invoices paid in last 26h (slight overlap to catch edge cases) */
  const since = Math.floor(Date.now() / 1000) - 93600;
  let invoices = [];
  try {
    const r = await fetch(
      `https://api.stripe.com/v1/invoices?status=paid&created[gte]=${since}&limit=100`,
      { headers: { Authorization: `Bearer ${STRIPE_SECRET}` } }
    );
    const data = r.ok ? await r.json() : {};
    invoices = (data.data || []).filter(inv =>
      inv.billing_reason === 'subscription_cycle' || inv.billing_reason === 'subscription_create'
    );
  } catch (e) {
    console.error('[stripe-audit] Stripe fetch failed:', e.message);
    return { statusCode: 200 };
  }

  if (invoices.length === 0) {
    console.log('[stripe-audit] No subscription renewals in last 26h');
    return { statusCode: 200 };
  }

  console.log('[stripe-audit] Checking', invoices.length, 'subscription invoice(s)');

  const repaired = [];
  const failed   = [];

  for (const inv of invoices) {
    const email = inv.customer_email || await getCustomerEmail(inv.customer);
    if (!email) { failed.push({ invoice: inv.id, issue: 'no customer email' }); continue; }

    /* Find user */
    const ur = await sb(`/rest/v1/users?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,email&limit=1`);
    const users = ur.ok ? await ur.json() : [];
    if (!users.length) { console.log('[stripe-audit] No user for', email, '— may be pre-TBT customer'); continue; }
    const userId = users[0].id;

    /* Check when credits were last reset */
    const cr = await sb(`/rest/v1/user_credits?user_id=eq.${userId}&select=subscription_reset_at,subscription_credits&limit=1`);
    const rows = cr.ok ? await cr.json() : [];

    if (!rows.length) {
      failed.push({ email, invoice: inv.id, issue: 'no user_credits row' });
      continue;
    }

    const resetAt   = rows[0].subscription_reset_at;
    const resetDate = resetAt ? new Date(resetAt) : null;
    const invoiceDate = new Date(inv.created * 1000);
    const alreadyReset = resetDate && resetDate > invoiceDate;

    if (alreadyReset) {
      console.log('[stripe-audit] ✅', email, '— credits reset at', resetAt);
      continue;
    }

    /* Credits weren't reset — repair it now */
    console.log('[stripe-audit] ⚠️', email, '— credits not reset for invoice', inv.id, '— repairing');
    const credits = creditsForAmount(inv.amount_paid);
    if (!credits) {
      failed.push({ email, invoice: inv.id, issue: `unrecognised amount ${inv.amount_paid}p` });
      continue;
    }

    const rr = await sb('/rest/v1/rpc/set_subscription_credits', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id:     userId,
        p_amount:      credits,
        p_description: `audit-repair: invoice ${inv.id} (£${(inv.amount_paid / 100).toFixed(2)})`,
      }),
    });
    const result = rr.ok ? await rr.json() : null;

    if (result && result.ok) {
      repaired.push({ email, invoice: inv.id, credits, newBalance: result.balance });
    } else {
      failed.push({ email, invoice: inv.id, issue: 'RPC set_subscription_credits failed' });
    }
  }

  if (repaired.length > 0 || failed.length > 0) {
    const repairedList = repaired.map(r =>
      `<li>${r.email} — ${r.credits} credits restored (invoice ${r.invoice})</li>`
    ).join('');
    const failList = failed.map(f =>
      `<li>${f.email || f.invoice} — ${f.issue}</li>`
    ).join('');

    await sendAlert(
      `TBT Stripe Audit: ${repaired.length} repaired, ${failed.length} failed`,
      `<div style="font-family:sans-serif;max-width:600px">
        <h2>Stripe Webhook Audit</h2>
        <p>Checked ${invoices.length} subscription renewal(s) from the last 24h.</p>
        ${repaired.length ? `<h3>✅ Auto-repaired (${repaired.length})</h3><ul>${repairedList}</ul>` : ''}
        ${failed.length ? `<h3>❌ Needs manual attention (${failed.length})</h3><ul>${failList}</ul>` : ''}
        <p style="color:#888;font-size:12px">Checked at ${new Date().toUTCString()}</p>
      </div>`
    );
  } else {
    console.log('[stripe-audit] All', invoices.length, 'renewal(s) verified — no action needed');
  }

  return { statusCode: 200 };
};
