import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INDIVIDUAL_PRODUCTS = ["prod_UREdj4L7AbzIxf", "prod_UVbUjOgRgL6lgz", "prod_UqGSgy7bGHnsHg"];
const CORPORATE_PRODUCTS = ["prod_UQJg5T5viAk6GC"];

async function getProductFromSubscription(subscriptionId: string): Promise<{ productId: string; tier: "individual" | "corporate" }> {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}?expand[]=items.data.price.product`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const sub = await res.json();
  const item = sub?.items?.data?.[0];
  const productId = typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  if (CORPORATE_PRODUCTS.includes(productId)) return { productId, tier: "corporate" };
  if (INDIVIDUAL_PRODUCTS.includes(productId)) return { productId, tier: "individual" };
  return { productId, tier: "corporate" }; // default to corporate for unknown products
}

async function getCustomerEmail(customerId: string): Promise<string | null> {
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return (await res.json())?.email ?? null;
}

async function getDeskFromCheckout(customerId: string): Promise<string> {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?customer=${customerId}&limit=1`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const ref = (await res.json())?.data?.[0]?.client_reference_id;
  return (ref === "gold" || ref === "whisky") ? ref : "both";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, stripe-signature" } });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (STRIPE_WEBHOOK_SECRET && signature) {
    const tPart = signature.split(",").find((p) => p.startsWith("t="));
    if (tPart) {
      const ts = parseInt(tPart.slice(2));
      if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return new Response("Webhook timestamp too old", { status: 400 });
    }
  }

  let event: any;
  try { event = JSON.parse(body); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // ── NEW SUBSCRIPTION — create firm with correct desk ──────────
    if (event.type === "customer.subscription.created") {
      const sub = event.data.object;
      const customerId = sub.customer;
      const subscriptionId = sub.id;
      const email = await getCustomerEmail(customerId);
      if (!email) return new Response("OK", { status: 200 });
      const domain = email.split("@")[1];
      const { tier } = await getProductFromSubscription(subscriptionId);
      const firmStatus = ["active", "trialing"].includes(sub.status) ? "active" : "inactive";
      const desk = await getDeskFromCheckout(customerId);

      if (tier === "individual") {
        // Check by stripe_customer_id first, then fall back to owner_email (catches pre-created fallback firms)
        const { data: existingByCustomer } = await supabase.from("firms").select("id").eq("stripe_customer_id", customerId).maybeSingle();
        const { data: existingByEmail } = !existingByCustomer
          ? await supabase.from("firms").select("id").eq("owner_email", email).eq("subscription_type", "individual").maybeSingle()
          : { data: null };
        const existing = existingByCustomer || existingByEmail;
        if (existing) {
          // Firm already exists — update status and stripe IDs, never overwrite access
          await supabase.from("firms").update({ status: firmStatus, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId }).eq("id", existing.id);
        } else {
          await supabase.from("firms").insert([{
            company_name: email.split("@")[0], domain, owner_email: email,
            subscription_type: "individual", max_users: 1, status: firmStatus,
            stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, access: desk,
          }]);
        }
      } else {
        const { data: existing } = await supabase.from("firms").select("id").eq("domain", domain).eq("subscription_type", "corporate").maybeSingle();
        if (existing) {
          // Firm already exists — update status only, never overwrite access
          await supabase.from("firms").update({ status: firmStatus, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, updated_at: new Date().toISOString() }).eq("id", existing.id);
        } else {
          await supabase.from("firms").insert([{
            company_name: domain, domain, subscription_type: "corporate", max_users: 15,
            status: firmStatus, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId, access: desk,
          }]);
        }
      }
    }

    // ── SUBSCRIPTION UPDATED — status changes only, never touch access ─
    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const firmStatus = ["active", "trialing"].includes(sub.status) ? "active" : "inactive";
      await supabase.from("firms").update({ status: firmStatus, stripe_subscription_id: sub.id, updated_at: new Date().toISOString() }).eq("stripe_customer_id", sub.customer);
    }

    if (event.type === "checkout.session.completed") {
      const desk = event.data.object.client_reference_id;
      const customerId = event.data.object.customer;
      if (customerId && (desk === "gold" || desk === "whisky")) {
        await supabase.from("firms").update({ access: desk }).eq("stripe_customer_id", customerId);
      }
    }

    if (event.type === "customer.subscription.deleted") {
      await supabase.from("firms").update({ status: "inactive", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", event.data.object.id);
    }

    if (event.type === "invoice.payment_failed") {
      const subId = event.data.object.subscription;
      if (subId) await supabase.from("firms").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", subId);
    }

    if (event.type === "invoice.payment_succeeded") {
      const subId = event.data.object.subscription;
      if (subId) await supabase.from("firms").update({ status: "active", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", subId);
    }

  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
