/* ── TBT WHISKYSTATS CREDIT MONITOR ─────────────────────────────────────────
   Scheduled daily at 9am UTC. Checks WhiskyStats API credit balance.
   Alerts at < 1,000 (warning) and < 300 (critical).
   Build tier = 5,000 credits/month. At current usage patterns this
   guards against unexpectedly high usage wiping out the monthly allowance.
   ─────────────────────────────────────────────────────────────────────────── */

const WS_KEY    = process.env.WHISKYSTATS_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const ALERT_TO  = 'admin@thebrokersterminal.com';

const WARN_THRESHOLD     = 1000;
const CRITICAL_THRESHOLD = 300;
const MONTHLY_ALLOWANCE  = 5000;

async function sendAlert(subject, html) {
  if (!RESEND_KEY) { console.error('[ws-monitor] RESEND_API_KEY not set'); return; }
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
  } catch (e) { console.error('[ws-monitor] sendAlert failed:', e.message); }
}

exports.handler = async function () {
  if (!WS_KEY) {
    console.error('[ws-monitor] WHISKYSTATS_API_KEY not set');
    return { statusCode: 200 };
  }

  let balance = null;
  let used    = null;

  try {
    const r = await fetch('https://data.api.whiskystats.com/v01/utilities/credit_balance', {
      headers: { Authorization: `Bearer ${WS_KEY}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) {
      await sendAlert(
        '⚠️ TBT: WhiskyStats API unreachable',
        `<p>Credit balance check failed with HTTP ${r.status} at ${new Date().toUTCString()}.</p>
         <p>The whisky terminal may be degraded. Check <a href="https://www.whiskystats.com">whiskystats.com</a>.</p>`
      );
      return { statusCode: 200 };
    }

    const data = await r.json();
    /* API returns {credit_usage, credit_limit, credit_cycle}
       credit_limit 0 = unlimited/pre-paid plan */
    used    = data.credit_usage ?? null;
    const limit = data.credit_limit || 0;
    balance = limit > 0 ? limit - (used || 0) : null; /* null = unlimited */
    console.log('[ws-monitor] usage:', used, '| limit:', limit || 'unlimited', '| resets:', data.credit_cycle);
  } catch (e) {
    console.error('[ws-monitor] fetch failed:', e.message);
    await sendAlert(
      '⚠️ TBT: WhiskyStats balance check failed',
      `<p>Could not reach WhiskyStats API: <code>${e.message}</code></p>`
    );
    return { statusCode: 200 };
  }

  /* Unlimited plan (credit_limit = 0) — just log usage, no threshold alerts */
  if (balance === null) {
    console.log(`[ws-monitor] Unlimited plan — ${used ?? '?'} credits used this cycle`);
    return { statusCode: 200 };
  }

  const pct = Math.round((balance / MONTHLY_ALLOWANCE) * 100);
  console.log(`[ws-monitor] WS credits: ${balance} remaining (${pct}%) | ${used ?? '?'} used`);

  if (balance < CRITICAL_THRESHOLD) {
    await sendAlert(
      `🚨 TBT: WhiskyStats credits CRITICAL — ${balance} left`,
      `<div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#c0392b">WhiskyStats Credits Critical</h2>
        <p>Only <strong>${balance} credits</strong> remaining this month (${pct}% of ${MONTHLY_ALLOWANCE}).</p>
        <p>The whisky terminal will <strong>break for all users</strong> if credits reach zero.</p>
        <h3>Immediate action needed:</h3>
        <ul>
          <li>Log into <a href="https://www.whiskystats.com/user/data_api">WhiskyStats</a> and check usage</li>
          <li>Contact Johannes at WhiskyStats to discuss a top-up or plan upgrade</li>
          <li>If credits are exhausted: whisky-data.js will return errors until the monthly reset</li>
        </ul>
        <p style="color:#888;font-size:12px">Checked at ${new Date().toUTCString()}</p>
      </div>`
    );
  } else if (balance < WARN_THRESHOLD) {
    await sendAlert(
      `⚠️ TBT: WhiskyStats credits low — ${balance} remaining`,
      `<div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#e67e22">WhiskyStats Credits Warning</h2>
        <p><strong>${balance} credits</strong> remaining this month (${pct}% of ${MONTHLY_ALLOWANCE}).</p>
        ${used !== null ? `<p>${used} credits used so far.</p>` : ''}
        <p>At current rate you may run out before month end. Check usage at
           <a href="https://www.whiskystats.com/user/data_api">whiskystats.com</a>.</p>
        <p style="color:#888;font-size:12px">Checked at ${new Date().toUTCString()}</p>
      </div>`
    );
  }

  return { statusCode: 200 };
};
