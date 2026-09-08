/* ── CATALYST WATCH — live macro + shipping intelligence ──────────────────
   Fetches: DXY (Yahoo), 10yr TIPS real yield (FRED), gold spot (Yahoo),
            Baltic Dry Index (Yahoo ^BDI — falls back gracefully)
   Cache: 4 hours in intelligence_cache
   ─────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL  = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const FRED_KEY      = process.env.FRED_API_KEY;
const CACHE_KEY     = 'catalyst_watch_v1';
const CACHE_TTL_MS  = 4 * 60 * 60 * 1000;

const corsHeaders   = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function readCache() {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/intelligence_cache?cache_key=eq.${CACHE_KEY}&select=response,expires_at&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    if (!rows.length || new Date(rows[0].expires_at) < new Date()) return null;
    return JSON.parse(rows[0].response);
  } catch { return null; }
}

async function writeCache(data) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/intelligence_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        cache_key: CACHE_KEY,
        response: JSON.stringify(data),
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      }),
    });
  } catch (e) { console.warn('[catalyst] cache write failed:', e.message); }
}

async function fetchYahoo(symbol) {
  const enc = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?interval=1d&range=30d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 TBT/1.0' } });
  if (!r.ok) throw new Error(`Yahoo ${symbol}: ${r.status}`);
  const json = await r.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart result for ${symbol}`);
  const closes = result.indicators?.quote?.[0]?.close || [];
  const valid = closes.filter(c => c != null);
  if (valid.length < 2) throw new Error(`Too few data points for ${symbol}`);
  const latest = valid[valid.length - 1];
  const prev   = valid[valid.length - 2];
  const chgPct = ((latest - prev) / prev) * 100;
  return {
    value:   Math.round(latest * 100) / 100,
    chgPct:  Math.round(chgPct * 100) / 100,
    spark:   valid.slice(-15).map(v => Math.round(v * 100) / 100),
  };
}

async function fetchFRED(seriesId) {
  if (!FRED_KEY) throw new Error('FRED_API_KEY not set');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=30`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${seriesId}: ${r.status}`);
  const json = await r.json();
  const obs = (json.observations || [])
    .filter(o => o.value !== '.')
    .map(o => Math.round(parseFloat(o.value) * 100) / 100);
  if (obs.length < 2) throw new Error(`No FRED data for ${seriesId}`);
  return {
    value: obs[0],
    chg:   Math.round((obs[0] - obs[1]) * 100) / 100,
    spark: obs.slice(0, 15).reverse(),
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };

  const force = event.queryStringParameters?.force === '1';
  if (!force) {
    const cached = await readCache();
    if (cached) {
      console.log('[catalyst] serving from cache');
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ...cached, cached: true }) };
    }
  }

  const result = { ts: new Date().toISOString() };

  /* DXY US Dollar Index */
  try {
    result.dxy = await fetchYahoo('DX-Y.NYB');
  } catch (e) {
    console.warn('[catalyst] DXY failed:', e.message);
    result.dxy = null;
  }

  /* 10yr TIPS real yield */
  try {
    result.tips10 = await fetchFRED('DFII10');
  } catch (e) {
    console.warn('[catalyst] TIPS failed:', e.message);
    result.tips10 = null;
  }

  /* Gold spot */
  try {
    result.gold = await fetchYahoo('GC=F');
  } catch (e) {
    result.gold = null;
  }

  /* Baltic Dry Index — proprietary data, Yahoo Finance may not carry it */
  try {
    result.bdi = await fetchYahoo('^BDI');
  } catch (e) {
    console.warn('[catalyst] BDI not available via Yahoo (expected):', e.message);
    result.bdi = null;
  }

  await writeCache(result);
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
};
