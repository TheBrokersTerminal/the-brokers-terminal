/* ── CFTC COT AUTOMATED INGESTION ────────────────────────────────────────────
   Scheduled Netlify Function — runs every Friday at 21:00 UTC (4 PM ET)
   CFTC releases disaggregated COT data at ~3:30 PM ET; we wait 30 min.

   Data source: CFTC Socrata Open Data API (free, no key required)
   Gold market code: 088691 (GOLD - COMMODITY EXCHANGE / COMEX)
   Upserts into: public.gold_cot_reports in Supabase
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL     = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;

/* CFTC Socrata endpoint — Disaggregated Futures Only */
const CFTC_API = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json';

function toInt(val) {
  const n = parseInt(String(val).replace(/,/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

async function fetchLatestCOT() {
  /* Verified field names from live CFTC Socrata API (72hh-3qpy) */
  const url = new URL(CFTC_API);
  url.searchParams.set('cftc_contract_market_code', '088691');
  url.searchParams.set('$order', 'report_date_as_yyyy_mm_dd DESC');
  url.searchParams.set('$limit', '5');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': 'TBT/1.0 (thebrokersterminal.com)' },
  });

  if (!resp.ok) throw new Error(`CFTC API ${resp.status}: ${await resp.text()}`);

  const rows = await resp.json();
  if (!rows.length) throw new Error('No COT rows returned from CFTC');

  return rows.map(function(r) {
    return {
      report_date:         r.report_date_as_yyyy_mm_dd
                             ? r.report_date_as_yyyy_mm_dd.split('T')[0]
                             : null,
      open_interest:       toInt(r.open_interest_all),
      managed_money_long:  toInt(r.m_money_positions_long_all),
      managed_money_short: toInt(r.m_money_positions_short_all),
      producer_long:       toInt(r.prod_merc_positions_long),       /* no _all suffix */
      producer_short:      toInt(r.prod_merc_positions_short),      /* no _all suffix */
      swap_long:           toInt(r.swap_positions_long_all),
      swap_short:          toInt(r['swap__positions_short_all']),    /* double underscore */
    };
  }).filter(function(r) { return r.report_date; });
}

async function upsertCOT(rows) {
  if (!SUPABASE_URL || !SUPABASE_SVC_KEY) throw new Error('Missing Supabase env vars');

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/gold_cot_reports`, {
    method: 'POST',
    headers: {
      apikey:          SUPABASE_SVC_KEY,
      Authorization:   `Bearer ${SUPABASE_SVC_KEY}`,
      'Content-Type':  'application/json',
      /* ON CONFLICT DO UPDATE — handles CFTC revised data patches */
      Prefer:          'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Supabase upsert ${resp.status}: ${body}`);
  }

  return await resp.json();
}

exports.handler = async function(event) {
  console.log('[fetch-cftc-data] Run started:', new Date().toISOString());

  try {
    const rows = await fetchLatestCOT();
    console.log(`[fetch-cftc-data] Fetched ${rows.length} rows from CFTC. Latest: ${rows[0]?.report_date}`);

    const upserted = await upsertCOT(rows);
    console.log(`[fetch-cftc-data] Upserted ${upserted.length} rows to gold_cot_reports.`);

    return { statusCode: 200 };
  } catch (err) {
    console.error('[fetch-cftc-data] ERROR:', err.message);
    return { statusCode: 500 };
  }
};
