import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
    }});
  }

  try {
    const { user_email } = await req.json();
    if (!user_email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    let firm = null;

    // Step 1: look up firm_id from users table
    const { data: userRow } = await supabase
      .from('users')
      .select('firm_id')
      .eq('email', user_email)
      .maybeSingle();

    if (userRow?.firm_id) {
      const { data: firmById } = await supabase
        .from('firms')
        .select('stripe_customer_id')
        .eq('id', userRow.firm_id)
        .maybeSingle();
      firm = firmById;
    }

    // Step 2: fallback — corporate firm by domain
    if (!firm) {
      const domain = user_email.split('@')[1];
      const { data: corpFirm } = await supabase
        .from('firms')
        .select('stripe_customer_id')
        .eq('domain', domain)
        .eq('subscription_type', 'corporate')
        .maybeSingle();
      firm = corpFirm;
    }

    // Step 3: fallback — individual firm by owner_email
    if (!firm) {
      const { data: indFirm } = await supabase
        .from('firms')
        .select('stripe_customer_id')
        .eq('owner_email', user_email)
        .eq('subscription_type', 'individual')
        .maybeSingle();
      firm = indFirm;
    }

    if (!firm?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'NO_STRIPE_CUSTOMER' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: firm.stripe_customer_id.trim(),
        return_url: 'https://www.thebrokersterminal.com/dashboard.html',
      }),
    });

    const session = await response.json();
    if (!session.url) throw new Error('Failed to create portal session: ' + JSON.stringify(session));

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
