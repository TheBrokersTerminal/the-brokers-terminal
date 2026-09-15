/* ── TBT STRIPE WEBHOOK ──────────────────────────────────────────────────────
   Handles Stripe subscription lifecycle events.

   Events handled:
     invoice.paid               → reset subscription_credits for the billing period
     customer.subscription.deleted → (no credit action; access handled separately)

   Setup in Stripe dashboard:
     Webhooks → Add endpoint → https://thebrokersterminal.com/.netlify/functions/stripe-webhook
     Events: invoice.paid, customer.subscription.deleted

   Required Netlify env vars:
     STRIPE_SECRET_KEY       (existing)
     STRIPE_WEBHOOK_SECRET   (from Stripe → Webhooks → signing secret)
     SUPABASE_SERVICE_KEY    (existing)
   ─────────────────────────────────────────────────────────────────────────── */

const crypto      = require('crypto');
const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/* Credits granted per plan — keyed by monthly amount in pence */
const PLAN_CREDITS = {
  4900:  4900,   /* £49/month  individual */
  49900: 49000,  /* £499/month corporate  */
};

function creditsForAmount(amountPaid) {
  if (PLAN_CREDITS[amountPaid] !== undefined) return PLAN_CREDITS[amountPaid];
  /* Fallback: scale nearest bracket */
  if (amountPaid >= 49900) return 49000;
  if (amountPaid >= 4900)  return 4900;
  return 0;
}

/* Stripe webhook signature verification (no npm package needed) */
function verifySignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  sigHeader.split(',').forEach(function(p) {
    const [k, v] = p.split('=');
    parts[k] = v;
  });
  const ts = parts['t'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  const payload = ts + '.' + rawBody;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  /* Timing-safe compare */
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch { return false; }
}

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

async function stripeFetch(path) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  return r.ok ? r.json() : null;
}

async function findUserByEmail(email) {
  const r = await sb(`/rest/v1/users?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,email,firm_id&limit=1`);
  const rows = r.ok ? await r.json() : [];
  return rows.length ? rows[0] : null;
}

async function handleInvoicePaid(invoice) {
  /* Only act on subscription invoices that were actually paid */
  if (invoice.billing_reason !== 'subscription_cycle' &&
      invoice.billing_reason !== 'subscription_create') return;
  if (invoice.status !== 'paid') return;

  const amountPaid = invoice.amount_paid; /* pence */
  const credits    = creditsForAmount(amountPaid);
  if (!credits) {
    console.log('[webhook] invoice.paid: unrecognised amount', amountPaid, '— skipping');
    return;
  }

  /* Resolve customer email */
  let email = invoice.customer_email;
  if (!email && invoice.customer) {
    const customer = await stripeFetch(`/customers/${invoice.customer}`);
    email = customer && customer.email;
  }
  if (!email) {
    console.error('[webhook] invoice.paid: no customer email on invoice', invoice.id);
    return;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.error('[webhook] invoice.paid: no user found for email', email);
    return;
  }

  const r = await sb('/rest/v1/rpc/set_subscription_credits', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id:    user.id,
      p_amount:     credits,
      p_description: `subscription renewal: invoice ${invoice.id} (£${(amountPaid/100).toFixed(2)})`,
    }),
  });

  const result = r.ok ? await r.json() : null;
  if (result && result.ok) {
    console.log('[webhook] Set', credits, 'subscription credits for', email, '| new balance:', result.balance);
  } else {
    console.error('[webhook] set_subscription_credits failed for', email, result);
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  /* Verify Stripe signature */
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.body;

  if (WEBHOOK_SECRET) {
    if (!verifySignature(rawBody, sig, WEBHOOK_SECRET)) {
      console.error('[webhook] Signature verification failed');
      return { statusCode: 400, body: 'Invalid signature' };
    }
  } else {
    console.warn('[webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature check');
  }

  let stripeEvent;
  try { stripeEvent = JSON.parse(rawBody); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  console.log('[webhook] Received event:', stripeEvent.type, stripeEvent.id);

  try {
    if (stripeEvent.type === 'invoice.paid') {
      await handleInvoicePaid(stripeEvent.data.object);
    }
    /* customer.subscription.deleted — no credit action needed;
       access suspension is handled separately via admin CRM */
  } catch (err) {
    console.error('[webhook] Handler error:', err.message);
    return { statusCode: 500, body: 'Handler error' };
  }

  /* Always return 200 so Stripe doesn't retry */
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
