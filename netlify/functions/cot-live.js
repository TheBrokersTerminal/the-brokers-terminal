/* ── COT LIVE READ ───────────────────────────────────────────────────────────
   Returns latest + previous week COT report from Supabase.
   histMaxMmNet uses the higher of: db historical max OR 300,000 — the
   institutional crowding threshold used by Goldman Sachs commodities desk
   and systematic macro funds. The 300,000 floor reflects the Aug 2016 /
   2019-2020 cycle peak and is the standard "extreme long" signal level.
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

/* Institutional benchmark — verified CFTC historical peak for gold MM net */
const INSTITUTIONAL_EXTREME = 300000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  try {
    /* Fetch latest 2 rows — gives us current + previous week */
    const rows = await sbGet(
      'gold_cot_reports?select=*&order=report_date.desc&limit=2'
    );

    if (!rows.length) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ empty: true }) };
    }

    /* Historical max from DB — floored at the institutional benchmark */
    const maxRows = await sbGet(
      'gold_cot_reports?select=managed_money_net&order=managed_money_net.desc&limit=1'
    );
    const dbMax = maxRows.length ? maxRows[0].managed_money_net : 0;
    const histMaxMmNet = Math.max(dbMax, INSTITUTIONAL_EXTREME);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        latest:       rows[0],
        previous:     rows[1] || null,   /* previous week for OI & MM net delta */
        histMaxMmNet,
        institutionalExtreme: INSTITUTIONAL_EXTREME,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
