/* ── CFTC COT AUTO-SYNC ──────────────────────────────────────────────────────
   Fetches the CFTC Disaggregated Commitments of Traders report (public, free).
   Isolates the GOLD - COMEX row, parses Managed Money and Producer/Merchant
   positions, calculates net positions, stores to Supabase.

   Schedule: run as a Netlify Scheduled Function every Friday at 21:30 UTC
   (CFTC releases at ~15:30 EST = 20:30 UTC; we wait 1hr for propagation).

   Also callable manually via GET /.netlify/functions/cot-sync
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

/* CFTC publishes disaggregated futures-only data as a pipe-delimited text file */
const CFTC_URL = 'https://www.cftc.gov/dea/newcot/f_disagg.txt';

function parseDate(str) {
  /* "YYYY-MM-DD" or "MM/DD/YYYY" */
  if (!str) return null;
  const s = str.trim();
  if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return s;
  const [m, d, y] = s.split('/');
  if (y) return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  return s;
}

async function fetchAndParseCOT() {
  const resp = await fetch(CFTC_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TBT/1.0)' },
  });
  if (!resp.ok) throw new Error(`CFTC fetch failed: ${resp.status}`);
  const text = await resp.text();

  const lines = text.split('\n');
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  /* Column indices we need */
  const idx = (name) => header.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

  const iName    = idx('Market and Exchange Names');
  const iDate    = idx('As of Date in Form');
  const iOI      = idx('Open Interest');
  const iMML     = idx('Money Manager Longs');
  const iMMS     = idx('Money Manager Shorts');
  const iPML     = idx('Producer/Merchant/Processor/User Longs');
  const iPMS     = idx('Producer/Merchant/Processor/User Shorts');
  const iSDL     = idx('Swap Dealer Longs');
  const iSDS     = idx('Swap Dealer Shorts');

  /* Find GOLD - COMEX row */
  const goldRow = lines.slice(1).find(l => {
    const name = (l.split(',')[iName] || '').toUpperCase();
    return name.includes('GOLD') && name.includes('COMEX');
  });

  if (!goldRow) throw new Error('GOLD COMEX row not found in CFTC data');

  const cols = goldRow.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const num  = (i) => i >= 0 ? parseInt(cols[i].replace(/,/g, ''), 10) || 0 : 0;

  const mm_long  = num(iMML);
  const mm_short = num(iMMS);
  const pm_long  = num(iPML);
  const pm_short = num(iPMS);
  const sd_long  = num(iSDL);
  const sd_short = num(iSDS);
  const oi       = num(iOI);

  const asOf = parseDate(cols[iDate]);

  return {
    asOf,
    mm_long, mm_short, mm_net: mm_long - mm_short,
    pm_long, pm_short, pm_net: pm_long - pm_short,
    sd_long, sd_short, sd_net: sd_long - sd_short,
    oi,
    fetched: new Date().toISOString(),
  };
}

async function saveCOT(data) {
  if (!SUPABASE_KEY) return;
  /* Store in intelligence_cache with a long TTL (8 days — refreshed weekly) */
  const expires_at = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/intelligence_cache`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ cache_key: 'cot_gold_latest', response: data, expires_at }),
  });
}

async function loadCachedCOT() {
  if (!SUPABASE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/intelligence_cache?cache_key=eq.cot_gold_latest&select=response&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = r.ok ? await r.json() : [];
    return rows.length ? rows[0].response : null;
  } catch { return null; }
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const force = event.queryStringParameters?.force === 'true';

  /* Serve cached if not forcing a refresh */
  if (!force) {
    const cached = await loadCachedCOT();
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'X-Cache': 'HIT' },
        body: JSON.stringify(cached),
      };
    }
  }

  try {
    const cot = await fetchAndParseCOT();
    await saveCOT(cot);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'X-Cache': 'MISS' },
      body: JSON.stringify(cot),
    };
  } catch (err) {
    /* Fallback: return cached even if expired, rather than crashing */
    const stale = await loadCachedCOT();
    if (stale) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'X-Cache': 'STALE', 'X-Error': err.message },
        body: JSON.stringify({ ...stale, _stale: true }),
      };
    }
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
