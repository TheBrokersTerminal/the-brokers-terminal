/* ── CENTRAL BANK GOLD HOLDINGS — LIVE FEED ─────────────────────────────────
   Strategy 1: IMF IFS SDMX REST API (dataservices.imf.org)
               → gold in fine troy ounces → convert to metric tonnes
   Strategy 2: FRED API (ex-gold series) + Yahoo Finance (gold price)
               → total reserves − ex-gold reserves = gold value → tonnes
   Strategy 3: Hardcoded Q2 2026 baseline (always available, no network needed)

   Cache: 7 days in intelligence_cache (IMF IFS updates monthly, 2-month lag)
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL      = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;
const FRED_KEY          = process.env.FRED_API_KEY;
const TROY_OZ_PER_TONNE = 32150.75;
const CACHE_KEY         = 'cb_holdings_live';
const CACHE_TTL_MS      = 7 * 24 * 60 * 60 * 1000;

/* ── Static holders: these countries have not changed their gold in years ── */
const STATIC_HOLDERS = [
  { code:'US', name:'United States', tonnes:8133, pct:72.6 },
  { code:'DE', name:'Germany',       tonnes:3352, pct:72.4 },
  { code:'IT', name:'Italy',         tonnes:2452, pct:66.5 },
  { code:'FR', name:'France',        tonnes:2437, pct:67.5 },
  { code:'CH', name:'Switzerland',   tonnes:1040, pct:7.4  },
  { code:'NL', name:'Netherlands',   tonnes:612,  pct:54.7 },
  { code:'PT', name:'Portugal',      tonnes:383,  pct:71.2 },
];

/* ── Active buyers: we need live data for these ─────────────────────────── */
/* FRED series IDs for "Total Reserves Excluding Gold" (Millions of USD)
   Pattern: TRESEG + ISO2 + M052N (monthly, USD, NSA)                        */
const ACTIVE_BUYERS = [
  { code:'CN', name:'China',        fredId:'TRESEGCNM052N', pctEst:5.3,  note:'GS est. higher (OTC)' },
  { code:'RU', name:'Russia',       fredId:'TRESEGRUM052N', pctEst:29.5, note:'' },
  { code:'IN', name:'India',        fredId:'TRESEGINM052N', pctEst:9.7,  note:'' },
  { code:'TR', name:'Turkey',       fredId:'TRESEGTRM052N', pctEst:32.1, note:'' },
  { code:'PL', name:'Poland',       fredId:'TRESEGPLM052N', pctEst:15.6, note:'' },
  { code:'SA', name:'Saudi Arabia', fredId:'TRESEGSAM052N', pctEst:4.5,  note:'' },
  { code:'KZ', name:'Kazakhstan',   fredId:'TRESEGKZM052N', pctEst:56.5, note:'' },
  { code:'JP', name:'Japan',        fredId:'TRESEGPDM052N', pctEst:4.3,  note:'' },
];

/* Q2 2026 baseline — used if both live sources fail */
const BASELINE = [
  { code:'US', name:'United States', tonnes:8133, pct:72.6 },
  { code:'DE', name:'Germany',       tonnes:3352, pct:72.4 },
  { code:'IT', name:'Italy',         tonnes:2452, pct:66.5 },
  { code:'FR', name:'France',        tonnes:2437, pct:67.5 },
  { code:'CN', name:'China',         tonnes:2386, pct:5.3,  note:'Jul 2026 · GS est. higher (OTC)' },
  { code:'RU', name:'Russia',        tonnes:2335, pct:29.5 },
  { code:'CH', name:'Switzerland',   tonnes:1040, pct:7.4  },
  { code:'IN', name:'India',         tonnes:869,  pct:9.7  },
  { code:'JP', name:'Japan',         tonnes:846,  pct:4.3  },
  { code:'NL', name:'Netherlands',   tonnes:612,  pct:54.7 },
  { code:'TR', name:'Turkey',        tonnes:555,  pct:32.1 },
  { code:'PL', name:'Poland',        tonnes:448,  pct:15.6 },
  { code:'PT', name:'Portugal',      tonnes:383,  pct:71.2 },
  { code:'SA', name:'Saudi Arabia',  tonnes:323,  pct:4.5  },
  { code:'KZ', name:'Kazakhstan',    tonnes:302,  pct:56.5 },
];

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

/* ── Supabase cache ───────────────────────────────────────────────────────── */
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
async function readCache() {
  try {
    const rows = await sbGet(`intelligence_cache?cache_key=eq.${CACHE_KEY}&select=response,expires_at&limit=1`);
    if (!rows.length) return null;
    if (new Date(rows[0].expires_at) < new Date()) return null;
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
      body: JSON.stringify({ cache_key: CACHE_KEY, response: JSON.stringify(data), expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString() }),
    });
  } catch (e) { console.warn('[cb-holdings] cache write failed:', e.message); }
}

/* ── Strategy 1: IMF IFS SDMX ────────────────────────────────────────────── */
async function fetchIMF() {
  const allCodes = [...STATIC_HOLDERS, ...ACTIVE_BUYERS].map(h => h.code).join('+');
  const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS/M.${allCodes}.RAFAGOLD_FINE_TOZ_T_G01?startPeriod=2024-01`;
  console.log('[cb-holdings] Strategy 1 — IMF IFS:', url);

  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TBT/1.0' } });
  if (!r.ok) throw new Error(`IMF ${r.status}: ${(await r.text()).slice(0, 200)}`);

  const json = await r.json();
  const ds = json?.CompactData?.DataSet;
  if (!ds) throw new Error('No DataSet in IMF response');

  const raw = ds.Series;
  const series = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  if (!series.length) throw new Error('IMF returned 0 series');

  const goldOz = {};
  for (const s of series) {
    const obs = s.Obs;
    const obsArr = Array.isArray(obs) ? obs : (obs ? [obs] : []);
    const latest = obsArr[obsArr.length - 1];
    const val = parseFloat(latest?.['@OBS_VALUE']);
    if (!isNaN(val)) goldOz[s['@REF_AREA']] = { oz: val, period: latest['@TIME_PERIOD'] };
  }

  const all = [...STATIC_HOLDERS, ...ACTIVE_BUYERS].map(h => {
    const g = goldOz[h.code];
    if (!g) return null;
    return { code: h.code, name: h.name, tonnes: Math.round(g.oz / TROY_OZ_PER_TONNE), pct: h.pct ?? h.pctEst, period: g.period, note: h.note || '' };
  }).filter(Boolean).sort((a, b) => b.tonnes - a.tonnes);

  if (!all.length) throw new Error('IMF: no parseable series');
  return { holders: all, as_of: all[0]?.period, source: 'IMF IFS SDMX' };
}

/* ── Strategy 2: FRED ex-gold + Yahoo Finance gold price ─────────────────── */
async function fetchFRED() {
  if (!FRED_KEY) throw new Error('FRED_API_KEY not set');
  console.log('[cb-holdings] Strategy 2 — FRED + Yahoo Finance');

  /* Get current gold spot price from Yahoo Finance */
  const yResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=5d');
  if (!yResp.ok) throw new Error(`Yahoo ${yResp.status}`);
  const yData = await yResp.json();
  const quotes = yData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
  const goldPriceOz = quotes.filter(Boolean).slice(-1)[0];
  if (!goldPriceOz || goldPriceOz < 100) throw new Error('Bad gold price from Yahoo');
  console.log('[cb-holdings] Gold price:', goldPriceOz);

  /* For each active buyer: fetch ex-gold from FRED */
  const activeResults = await Promise.allSettled(
    ACTIVE_BUYERS.map(async (h) => {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${h.fredId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`FRED ${h.fredId}: ${r.status}`);
      const json = await r.json();
      const obs = (json.observations || []).find(o => o.value && o.value !== '.');
      if (!obs) throw new Error(`No obs for ${h.fredId}`);

      /* We have ex-gold (USD mn). We need total reserves to compute gold. */
      /* Total reserves (including gold) from World Bank — annual 2025 */
      const wbUrl = `https://api.worldbank.org/v2/en/country/${h.code}/indicator/FI.RES.TOTL.CD?format=json&mrv=1`;
      const wbR = await fetch(wbUrl);
      if (!wbR.ok) throw new Error(`WB ${h.code}: ${wbR.status}`);
      const wbJson = await wbR.json();
      const totalUsd = wbJson[1]?.[0]?.value;
      if (!totalUsd) throw new Error(`No WB total for ${h.code}`);

      const exGoldUsd = parseFloat(obs.value) * 1e6;       /* mn → absolute USD */
      const goldUsd   = totalUsd - exGoldUsd;
      const goldOz    = goldUsd / goldPriceOz;
      const tonnes    = Math.round(goldOz / TROY_OZ_PER_TONNE);
      const pct       = Math.round((goldUsd / totalUsd) * 100 * 10) / 10;

      if (tonnes < 10 || tonnes > 50000) throw new Error(`Unreasonable tonnes for ${h.code}: ${tonnes}`);
      return { code: h.code, name: h.name, tonnes, pct, period: obs.date.slice(0, 7), note: h.note || '' };
    })
  );

  const liveActive = activeResults
    .map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      console.warn(`[cb-holdings] FRED failed for ${ACTIVE_BUYERS[i].code}:`, r.reason?.message);
      /* Fall back to baseline for this country */
      const b = BASELINE.find(x => x.code === ACTIVE_BUYERS[i].code);
      return b ? { ...b, note: (b.note || '') + ' (baseline)' } : null;
    })
    .filter(Boolean);

  const all = [...STATIC_HOLDERS.map(h => ({ ...h, period: 'static' })), ...liveActive]
    .sort((a, b) => b.tonnes - a.tonnes);

  /* Determine as_of from most recent live period */
  const livePeriods = liveActive.map(h => h.period).filter(p => p && p !== 'static').sort();
  const as_of = livePeriods[livePeriods.length - 1] || null;

  return { holders: all, as_of, source: 'FRED + Yahoo Finance', goldPriceOz: Math.round(goldPriceOz) };
}

/* ── Main handler ─────────────────────────────────────────────────────────── */
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };

  /* Force refresh param for manual cache busting */
  const force = event.queryStringParameters?.force === '1';

  if (!force) {
    const cached = await readCache();
    if (cached) {
      console.log('[cb-holdings] serving from cache, source:', cached.source);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ...cached, cached: true }) };
    }
  }

  /* Try strategies in order */
  const strategies = [fetchIMF, fetchFRED];
  let lastError;

  for (const strategy of strategies) {
    try {
      const result = await strategy();
      await writeCache(result);
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
    } catch (err) {
      console.error(`[cb-holdings] ${strategy.name} failed:`, err.message);
      lastError = err;
    }
  }

  /* Both failed — return baseline with error context */
  const baseline = {
    holders: BASELINE,
    as_of:   '2026-06',
    source:  'baseline',
    error:   lastError?.message,
  };
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(baseline) };
};
