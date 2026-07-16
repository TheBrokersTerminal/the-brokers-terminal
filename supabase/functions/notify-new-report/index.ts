import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') || 're_AjYBEDdz_5bM7EDhpo3jR4u7WVer3xKoP'
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const TYPE_LABELS: Record<string, string> = {
  weekly:         'Weekly Report',
  monthly:        'Monthly Deep-Dive',
  quarterly:      'Quarterly Review',
  pitch_pack:     'Pitch Pack',
  objection_file: 'Objection File',
  training:       'Training Module',
  hit_list:       'Hit List',
  morning_line:   'Flash Alert',
  psychology:     'Psychology Desk',
  client_monthly: 'Client Monthly Report',
}

const ASSET_LABELS: Record<string, string> = {
  gold:    'Gold Bullion',
  whisky:  'Whisky Market',
  macro:   'Macro',
  all:     'All Markets',
}

function emailHtml(firstName: string, title: string, reportType: string, assetClass: string, publishedDate: string): string {
  const typeLabel  = TYPE_LABELS[reportType]  || reportType.replace(/_/g, ' ').toUpperCase()
  const assetLabel = ASSET_LABELS[assetClass] || assetClass.toUpperCase()
  const dateStr    = new Date(publishedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()

  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A" style="background-color:#0A0A0A !important;">
<tr><td align="center" bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:40px 20px;">
  <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; border:1px solid #E97132;">

    <!-- HEADER -->
    <tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:22px 32px; border-bottom:2px solid #E97132;">
      <span style="font-family:'Courier New',Courier,monospace; font-size:15px; font-weight:bold; color:#E97132; letter-spacing:0.2em; text-transform:uppercase;">&#9608; THE BROKERS TERMINAL</span>
    </td></tr>

    <!-- ORANGE BAR -->
    <tr><td bgcolor="#E97132" style="background-color:#E97132 !important; padding:10px 32px;">
      <span style="font-family:'Courier New',Courier,monospace; font-size:10px; font-weight:bold; color:#0A0A0A; letter-spacing:0.24em; text-transform:uppercase;">NEW INTELLIGENCE — ${assetLabel.toUpperCase()}</span>
    </td></tr>

    <!-- BODY -->
    <tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:36px 32px;">
      <p style="font-family:'Courier New',Courier,monospace; font-size:11px; color:#E97132; letter-spacing:0.18em; text-transform:uppercase; margin:0 0 6px 0;">${typeLabel.toUpperCase()} &nbsp;·&nbsp; ${dateStr}</p>
      <h1 style="font-family:'Courier New',Courier,monospace; font-size:22px; font-weight:bold; color:#FFFFFF; letter-spacing:0.04em; margin:0 0 24px 0; text-transform:uppercase; line-height:1.2;">${title}</h1>
      <p style="font-family:'Courier New',Courier,monospace; font-size:12px; color:#CCCCCC; line-height:1.75; margin:0 0 28px 0;">Your new ${typeLabel.toLowerCase()} is on the desk, ${firstName}. Log in to read the full briefing — market intelligence, pitch scripts, and everything you need for the week ahead.</p>

      <!-- BUTTON -->
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="#E97132" style="background-color:#E97132 !important; padding:0;">
          <a href="https://thebrokersterminal.com/dashboard.html" style="display:inline-block; font-family:'Courier New',Courier,monospace; font-size:11px; font-weight:bold; color:#0A0A0A; letter-spacing:0.22em; text-transform:uppercase; text-decoration:none; padding:14px 28px;">&#9608; ACCESS THE DESK</a>
        </td>
      </tr></table>

      <!-- DIVIDER -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;">
        <tr><td style="border-top:1px solid #222; padding-top:20px;">
          <p style="font-family:'Courier New',Courier,monospace; font-size:9px; color:#555555; line-height:1.65; margin:0;">You are receiving this because you have an active subscription to The Brokers Terminal. To unsubscribe, reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>

    <!-- FOOTER -->
    <tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:14px 32px; border-top:1px solid #E97132;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:'Courier New',Courier,monospace; font-size:8px; color:#E97132; letter-spacing:0.16em; text-transform:uppercase;">© 2026 THE BROKERS TERMINAL</td>
        <td align="right" style="font-family:'Courier New',Courier,monospace; font-size:8px; color:#555555; letter-spacing:0.14em; text-transform:uppercase;">BROKERS EYES ONLY</td>
      </tr><tr>
        <td colspan="2" style="padding-top:5px; font-family:'Courier New',Courier,monospace; font-size:8px; color:#444444; letter-spacing:0.08em;">This communication is intended for professional use only. Not financial advice.</td>
      </tr></table>
    </td></tr>

  </table>
</td></tr>
</table>`
}

function clientMonthlyEmailHtml(firstName: string, title: string, publishedDate: string): string {
  const dateStr = new Date(publishedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A" style="background-color:#0A0A0A !important;">
<tr><td align="center" bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:40px 20px;">
  <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; border:1px solid #E97132;">

    <tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:22px 32px; border-bottom:2px solid #E97132;">
      <span style="font-family:'Courier New',Courier,monospace; font-size:15px; font-weight:bold; color:#E97132; letter-spacing:0.2em; text-transform:uppercase;">&#9608; THE BROKERS TERMINAL</span>
    </td></tr>

    <tr><td bgcolor="#E97132" style="background-color:#E97132 !important; padding:10px 32px;">
      <span style="font-family:'Courier New',Courier,monospace; font-size:10px; font-weight:bold; color:#0A0A0A; letter-spacing:0.24em; text-transform:uppercase;">CLIENT MONTHLY REPORT — READY TO BRAND &amp; SEND</span>
    </td></tr>

    <tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:36px 32px;">
      <p style="font-family:'Courier New',Courier,monospace; font-size:11px; color:#E97132; letter-spacing:0.18em; text-transform:uppercase; margin:0 0 6px 0;">CLIENT EDITION &nbsp;·&nbsp; ${dateStr}</p>
      <h1 style="font-family:'Courier New',Courier,monospace; font-size:22px; font-weight:bold; color:#FFFFFF; letter-spacing:0.04em; margin:0 0 24px 0; text-transform:uppercase; line-height:1.2;">${title}</h1>
      <p style="font-family:'Courier New',Courier,monospace; font-size:12px; color:#CCCCCC; line-height:1.75; margin:0 0 12px 0;">Hi ${firstName}, a new client-facing monthly report has been uploaded to the terminal.</p>
      <p style="font-family:'Courier New',Courier,monospace; font-size:12px; color:#CCCCCC; line-height:1.75; margin:0 0 28px 0;">Log in to the admin panel, open the <strong style="color:#FFFFFF;">Client Edition</strong> section, enter your firm's branding details, and download the branded report — ready to send straight to your clients.</p>

      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="#E97132" style="background-color:#E97132 !important; padding:0;">
          <a href="https://thebrokersterminal.com/dashboard.html" style="display:inline-block; font-family:'Courier New',Courier,monospace; font-size:11px; font-weight:bold; color:#0A0A0A; letter-spacing:0.22em; text-transform:uppercase; text-decoration:none; padding:14px 28px;">&#9608; OPEN THE TERMINAL</a>
        </td>
      </tr></table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;">
        <tr><td style="border-top:1px solid #222; padding-top:20px;">
          <p style="font-family:'Courier New',Courier,monospace; font-size:9px; color:#555555; line-height:1.65; margin:0;">You are receiving this as the account administrator for your firm on The Brokers Terminal. To unsubscribe, reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>

    <tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A !important; padding:14px 32px; border-top:1px solid #E97132;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:'Courier New',Courier,monospace; font-size:8px; color:#E97132; letter-spacing:0.16em; text-transform:uppercase;">© 2026 THE BROKERS TERMINAL</td>
        <td align="right" style="font-family:'Courier New',Courier,monospace; font-size:8px; color:#555555; letter-spacing:0.14em; text-transform:uppercase;">ADMIN NOTICE ONLY</td>
      </tr></table>
    </td></tr>

  </table>
</td></tr>
</table>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    const { title, reportType, assetClass, publishedDate, reportId, test_email } = await req.json()

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)

    const isClientMonthly = reportType === 'client_monthly'

    let recipients: any[]

    if (test_email) {
      recipients = [{ email: test_email, first_name: 'Test' }]
    } else {
      const { data: users, error } = await supabase
        .from('users')
        .select('email, first_name, role, status, firm_id, firms(status, access, subscription_type)')
        .eq('status', 'active')
        .not('firm_id', 'is', null)

      if (error) throw error

      // For client monthly, look up which firms have access
      let allowedFirmIds: string[] | null = null
      if (isClientMonthly && reportId) {
        const { data: accessRows } = await supabase
          .from('report_firm_access')
          .select('firm_id')
          .eq('report_id', reportId)
        if (accessRows && accessRows.length > 0) {
          allowedFirmIds = accessRows.map((r: any) => r.firm_id)
        }
      }

      if (isClientMonthly) {
        // Client monthly — corporate admins only, restricted to ticked firms if any
        recipients = (users || []).filter((u: any) => {
          if (!u.firms || u.firms.status !== 'active') return false
          if (u.firms.subscription_type !== 'corporate' || u.role !== 'admin') return false
          if (allowedFirmIds) return allowedFirmIds.includes(u.firm_id)
          return true
        })
      } else {
        // Standard report — all active subscribers with matching asset access
        recipients = (users || []).filter((u: any) => {
          if (!u.firms || u.firms.status !== 'active') return false
          const access = u.firms.access || 'both'
          if (access === 'both' || access === 'all') return true
          return access === assetClass
        })
      }
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No eligible recipients' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    const typeLabel  = TYPE_LABELS[reportType]  || reportType.replace(/_/g, ' ')
    const assetLabel = ASSET_LABELS[assetClass] || assetClass

    // Send to each recipient
    const sends = await Promise.allSettled(
      recipients.map(async (u: any) => {
        const firstName = u.first_name || 'Broker'
        const subject = isClientMonthly
          ? `▸ Client Monthly Report Ready — Brand & Send to Your Clients`
          : `▸ New ${assetLabel} ${typeLabel} — ${title}`
        const html = isClientMonthly
          ? clientMonthlyEmailHtml(firstName, title, publishedDate)
          : emailHtml(firstName, title, reportType, assetClass, publishedDate)
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'The Brokers Terminal <desk@thebrokersterminal.com>',
            to: u.email,
            subject,
            html,
          }),
        })
        if (!res.ok) {
          const errBody = await res.text()
          throw new Error(`Resend rejected ${u.email}: ${res.status} ${errBody}`)
        }
        return u.email
      })
    )

    const sent   = sends.filter(r => r.status === 'fulfilled').length
    const failed = sends.filter(r => r.status === 'rejected').length
    const errors = sends.filter(r => r.status === 'rejected').map((r: any) => r.reason?.message)

    return new Response(JSON.stringify({ sent, failed, total: recipients.length, errors }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})
