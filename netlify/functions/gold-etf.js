/* ── GOLD ETF & LIVE PRICE FEED ─────────────────────────────────────────────
   Fetches live prices for GLD, IAU, GLDM from Yahoo Finance (free, no key).
   Also fetches XAU/USD spot from Yahoo Finance.
   Caches 15 minutes to Supabase to protect against rate limits.
   Called by the Gold Intelligence widget ETF tab.
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CACHE_KEY    = 'gold_etf_live';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function cacheGet() {
  if (!SUPABASE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/intelligence_cache?cache_key=eq.${CACHE_KEY}&expires_at=gt.${new Date().toISOString()}&select=response&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = r.ok ? await r.json() : [];
    return rows.length ? rows[0].response : null;
  } catch { return null; }
}

async function cacheSet(data) {
  if (!SUPABASE_KEY) return;
  const expires_at = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/intelligence_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ cache_key: CACHE_KEY, response: data, expires_at }),
    });
  } catch {}
}

async function fetchQuote(symbol) {
  /* Yahoo Finance chart endpoint — no API key required */
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TBT/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`Yahoo Finance ${symbol}: ${resp.status}`);
  const json = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);
  const meta = result.meta;
  const price    = meta.regularMarketPrice;
  const prevClose = meta.previousClose || meta.chartPreviousClose || price;
  const chg      = price - prevClose;
  const chgPct   = prevClose ? (chg / prevClose * 100) : 0;
  return {
    symbol,
    price:    Math.round(price * 100) / 100,
    prevClose: Math.round(prevClose * 100) / 100,
    chg:      Math.round(chg * 100) / 100,
    chgPct:   Math.round(chgPct * 100) / 100,
    currency: meta.currency || 'USD',
    ts:       meta.regularMarketTime || null,
  };
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  /* ── Cache hit ─────────────────────────────────────────────────────────── */
  const cached = await cacheGet();
  if (cached) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'X-Cache': 'HIT' },
      body: JSON.stringify(cached),
    };
  }

  /* ── Live fetch ────────────────────────────────────────────────────────── */
  const symbols = ['GLD', 'IAU', 'GLDM', 'GC=F'];   // GC=F = COMEX Gold Futures
  const results = {};

  await Promise.allSettled(
    symbols.map(s =>
      fetchQuote(s)
        .then(q => { results[q.symbol] = q; })
        .catch(err => { results[s] = { symbol: s, error: err.message }; })
    )
  );

  results._fetched = new Date().toISOString();

  cacheSet(results); /* fire-and-forget */

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'X-Cache': 'MISS' },
    body: JSON.stringify(results),
  };
};
