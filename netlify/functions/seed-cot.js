/* ── ONE-TIME CFTC SEED TRIGGER ──────────────────────────────────────────────
   Plain HTTP function — visit /.netlify/functions/seed-cot to seed
   gold_cot_reports with the latest 5 weeks from CFTC Socrata API.
   Safe to call multiple times (upsert handles duplicates).
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL     = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
const CFTC_API         = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json';

function toInt(val) {
  const n = parseInt(String(val).replace(/,/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

exports.handler = async function(event) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    /* 1 — Fetch from CFTC */
    const url = new URL(CFTC_API);
    url.searchParams.set('cftc_contract_market_code', '088691');
    url.searchParams.set('$order', 'report_date_as_yyyy_mm_dd DESC');
    url.searchParams.set('$limit', '5');

    const cftcResp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'TBT/1.0 (thebrokersterminal.com)' },
    });
    if (!cftcResp.ok) throw new Error(`CFTC ${cftcResp.status}`);

    const raw = await cftcResp.json();
    if (!raw.length) throw new Error('No rows from CFTC');

    const rows = raw.map(function(r) {
      return {
        report_date:         r.report_date_as_yyyy_mm_dd ? r.report_date_as_yyyy_mm_dd.split('T')[0] : null,
        open_interest:       toInt(r.open_interest_all),
        managed_money_long:  toInt(r.m_money_positions_long_all),
        managed_money_short: toInt(r.m_money_positions_short_all),
        producer_long:       toInt(r.prod_merc_positions_long),
        producer_short:      toInt(r.prod_merc_positions_short),
        swap_long:           toInt(r.swap_positions_long_all),
        swap_short:          toInt(r['swap__positions_short_all']),
      };
    }).filter(function(r) { return r.report_date; });

    /* 2 — Upsert into Supabase */
    const sbResp = await fetch(`${SUPABASE_URL}/rest/v1/gold_cot_reports`, {
      method: 'POST',
      headers: {
        apikey:         SUPABASE_SVC_KEY,
        Authorization:  `Bearer ${SUPABASE_SVC_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(rows),
    });
    if (!sbResp.ok) throw new Error(`Supabase ${sbResp.status}: ${await sbResp.text()}`);

    const inserted = await sbResp.json();

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        rows_upserted: inserted.length,
        latest: rows[0]?.report_date,
        dates: rows.map(function(r) { return r.report_date; }),
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
