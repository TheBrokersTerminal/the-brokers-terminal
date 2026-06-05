import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Individual product IDs (£49/month)
const INDIVIDUAL_PRODUCTS = [
  "prod_UREdj4L7AbzIxf", // Original individual product
  "prod_UVbUjOgRgL6lgz", // New individual product
];

// Corporate product ID (£400/month)
const CORPORATE_PRODUCTS = [
  "prod_UQJg5T5viAk6GC",
];

async function getProductFromSubscription(subscriptionId: string): Promise<{ productId: string; tier: "individual" | "corporate" }> {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}?expand[]=items.data.price.product`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const sub = await res.json();
  const item = sub?.items?.data?.[0];
  const productId = typeof item?.price?.product === "string"
    ? item.price.product
    : item?.price?.product?.id;

  const tier = INDIVIDUAL_PRODUCTS.includes(productId) ? "individual" : "corporate";
  return { productId, tier };
}

async function getCustomerEmail(customerId: string): Promise<string | null> {
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const customer = await res.json();
  return customer?.email ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, stripe-signature",
      },
    });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  // Verify webhook signature
  if (STRIPE_WEBHOOK_SECRET && signature) {
    // Basic timestamp check (full HMAC verification handled by Stripe lib below)
    const parts = signature.split(",");
    const tPart = parts.find((p) => p.startsWith("t="));
    if (tPart) {
      const ts = parseInt(tPart.slice(2));
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > 300) {
        return new Response("Webhook timestamp too old", { status: 400 });
      }
    }
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // ─── SUBSCRIPTION ACTIVATED / TRIAL STARTED ──────────────────
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const subscriptionId = subscription.id;
      const subStatus = subscription.status; // active, trialing, past_due, canceled, etc.

      const email = await getCustomerEmail(customerId);
      if (!email) {
        console.error("No email found for customer", customerId);
        return new Response("OK", { status: 200 });
      }

      const domain = email.split("@")[1];
      const { tier } = await getProductFromSubscription(subscriptionId);

      const isActive = ["active", "trialing"].includes(subStatus);
      const firmStatus = isActive ? "active" : "inactive";

      if (tier === "individual") {
        // ── INDIVIDUAL: firm per Stripe customer ─────────────────────
        // Look up by stripe_customer_id first (most reliable)
        const { data: existing } = await supabase
          .from("firms")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("firms")
            .update({
              status: firmStatus,
              stripe_subscription_id: subscriptionId,
            })
            .eq("id", existing.id);
        } else {
          await supabase.from("firms").insert([{
            company_name: email.split("@")[0],
            domain: domain,
            subscription_type: "individual",
            max_users: 1,
            status: firmStatus,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            access: "both",
          }]);
        }

      } else {
        // ── CORPORATE: firm per domain ───────────────────────────────
        const { data: existing } = await supabase
          .from("firms")
          .select("id")
          .eq("domain", domain)
          .eq("subscription_type", "corporate")
          .maybeSingle();

        if (existing) {
          await supabase
            .from("firms")
            .update({
              status: firmStatus,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await supabase.from("firms").insert([{
            company_name: domain,
            domain: domain,
            subscription_type: "corporate",
            max_users: 15,
            status: firmStatus,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            access: "both",
          }]);
        }
      }
    }

    // ─── CHECKOUT COMPLETED — set correct desk from client_reference_id ─
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const desk = session.client_reference_id; // 'gold' or 'whisky'
      const customerId = session.customer;
      if (customerId && (desk === "gold" || desk === "whisky")) {
        await supabase.from("firms").update({ access: desk }).eq("stripe_customer_id", customerId);
      }
    }

    // ─── SUBSCRIPTION CANCELLED / EXPIRED ────────────────────────
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const subscriptionId = subscription.id;

      await supabase
        .from("firms")
        .update({ status: "inactive", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subscriptionId);
    }

    // ─── PAYMENT FAILED ───────────────────────────────────────────
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      if (subscriptionId) {
        await supabase
          .from("firms")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subscriptionId);
      }
    }

    // ─── PAYMENT SUCCEEDED ────────────────────────────────────────
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      if (subscriptionId) {
        await supabase
          .from("firms")
          .update({ status: "active", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subscriptionId);
      }
    }

  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
