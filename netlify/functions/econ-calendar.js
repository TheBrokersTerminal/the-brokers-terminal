/* ── ECONOMIC CALENDAR PROXY ────────────────────────────────────────
   Proxies Financial Modeling Prep economic calendar so the API key
   stays server-side. Free tier: 250 req/day.
   Requires: FMP_API_KEY in Netlify environment variables.
   Sign up free at https://financialmodelingprep.com/developer/docs/
   ─────────────────────────────────────────────────────────────────── */

const BASE = 'https://financialmodelingprep.com/api/v3/economic_calendar';

exports.handler = async (event) => {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FMP_API_KEY not configured' }),
    };
  }

  /* Default: today → 14 days ahead */
  const from = event.queryStringParameters?.from || todayStr();
  const to   = event.queryStringParameters?.to   || daysAhead(14);

  const url = `${BASE}?from=${from}&to=${to}&apikey=${key}`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err) }),
    };
  }
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAhead(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
