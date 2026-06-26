import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    const { firm_id } = await req.json()
    if (!firm_id) return new Response(JSON.stringify({ error: 'firm_id required' }), { status: 400, headers: cors })

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

    // Get all users in this firm
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id')
      .eq('firm_id', firm_id)

    if (usersErr) throw usersErr

    // Sign out each user server-side — invalidates their JWT immediately
    const results = await Promise.allSettled(
      (users || []).map((u: any) =>
        supabase.auth.admin.signOut(u.id)
      )
    )

    const signed_out = results.filter(r => r.status === 'fulfilled').length
    const failed     = results.filter(r => r.status === 'rejected').length

    return new Response(JSON.stringify({ signed_out, failed }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: cors
    })
  }
})
