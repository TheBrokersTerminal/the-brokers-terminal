/* ── MACRO DATA — FRED + Finnhub proxy ──────────────────────────
   ?type=prices   → live gold, FX, BoE rate, UK CPI
   ?type=history  → monthly historical for comparison chart (10Y)
   Keys injected server-side; never exposed to browser.
   ─────────────────────────────────────────────────────────── */
const https = require('https');

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

function clean(obs) {
  return (obs || [])
    .filter(function (o) { return o.value !== '.'; })
    .map(function (o) { return { d: o.date, v: parseFloat(o.value) }; });
}

exports.handler = async function (event) {
  var FRED    = process.env.FRED_API_KEY;
  var FINN    = process.env.FINNHUB_KEY || 'da6p77hr01qqqkkgl7b0da6p77hr01qqqkkgl7bg';
  var p       = event.queryStringParameters || {};
  var type = p.type || 'prices';

  var hdrs = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    /* ── LIVE PRICES ── */
    if (type === 'prices') {
      /* FRED base URL helper */
      var F = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&sort_order=desc&api_key=' + FRED + '&series_id=';

      var FH = 'https://finnhub.io/api/v1/';

      var results = await Promise.allSettled([
        /* Gold spot in USD via Finnhub */
        fetchJson(FH + 'quote?symbol=OANDA:XAU_USD&token=' + FINN),
        /* FX rates base USD — open.er-api.com (free, no key) */
        fetchJson('https://open.er-api.com/v6/latest/USD'),
        /* FRED macro */
        fetchJson(F + 'IRSTCI01GBM156N&limit=3'),
        fetchJson(F + 'CPALTT01GBM659N&limit=2'),
        fetchJson(F + 'FEDFUNDS&limit=2'),
        fetchJson(F + 'IRLTLT01GBM156N&limit=2'),
      ]);

      function val(r) { return r.status === 'fulfilled' ? r.value : null; }
      var goldRaw  = val(results[0]);
      var fxRaw    = val(results[1]);
      var boeRaw   = val(results[2]);
      var cpiRaw   = val(results[3]);
      var fedRaw   = val(results[4]);
      var giltRaw  = val(results[5]);

      /* Parse Finnhub gold quote */
      var goldUSD = (goldRaw && goldRaw.c) ? goldRaw.c : null;
      var goldPct = (goldRaw && goldRaw.dp) ? goldRaw.dp : null;

      /* Parse er-api.com FX rates (base USD) */
      var fxRates = (fxRaw && fxRaw.rates) ? fxRaw.rates : {};
      var gbpRate = fxRates['GBP'] || null;   /* USD→GBP rate */
      var eurRate = fxRates['EUR'] || null;
      var gbpusd  = gbpRate ? (1 / gbpRate) : null;   /* GBP/USD */
      var eurgbp  = (eurRate && gbpRate) ? (eurRate / gbpRate) : null;
      var goldGBP = (goldUSD && gbpRate) ? Math.round(goldUSD * gbpRate) : null;

      /* CPI series already reports YoY rate directly */
      var cpiObs = clean((cpiRaw || {}).observations);
      var cpiYoy = cpiObs.length ? cpiObs[0].v.toFixed(1) : null;

      var boeObs  = clean((boeRaw  || {}).observations);
      var fedObs  = clean((fedRaw  || {}).observations);
      var giltObs = clean((giltRaw || {}).observations);

      return {
        statusCode: 200, headers: hdrs,
        body: JSON.stringify({
          gold:   { usd: goldUSD, gbp: goldGBP, pct: goldPct },
          gbpusd: gbpusd ? { price: gbpusd } : null,
          eurgbp: eurgbp ? { price: eurgbp } : null,
          boe:    { rate: boeObs[0] ? boeObs[0].v : null, prev: boeObs[1] ? boeObs[1].v : null, date: boeObs[0] ? boeObs[0].d : null },
          fed:    { rate: fedObs[0] ? fedObs[0].v : null, date: fedObs[0] ? fedObs[0].d : null },
          ukcpi:  { yoy: cpiYoy, date: cpiObs[0] ? cpiObs[0].d : null },
          ukgilt: { rate: giltObs[0] ? giltObs[0].v.toFixed(2) : null, date: giltObs[0] ? giltObs[0].d : null },
        }),
      };
    }

    /* ── MACRO INTELLIGENCE (five professor/sales themes) ── */
    if (type === 'intel') {
      var FI = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&sort_order=desc&limit=3&api_key=' + FRED + '&series_id=';

      var iRes = await Promise.allSettled([
        fetchJson(FI + 'DFII10'),            /* [0] US 10yr TIPS real yield  */
        fetchJson(FI + 'M2SL'),              /* [1] US M2 money supply $bn   */
        fetchJson(FI + 'T10Y2Y'),            /* [2] 10yr-2yr yield curve     */
        fetchJson(FI + 'ICSA'),              /* [3] Initial jobless claims k */
        fetchJson(FI + 'IRLTLT01GBM156N'),  /* [4] UK 10yr gilt yield       */
        fetchJson(FI + 'IRSTCI01GBM156N'),  /* [5] UK interbank rate        */
        fetchJson(FI + 'CPALTT01GBM659N'),  /* [6] UK CPI YoY               */
        fetchJson(FI + 'DGS10'),             /* [7] US 10yr Treasury         */
        fetchJson(FI + 'FEDFUNDS'),          /* [8] US Fed funds rate        */
      ]);

      function iv(r) {
        if (r.status !== 'fulfilled') return { cur: null, prev: null, date: null };
        var obs = clean((r.value || {}).observations);
        return { cur: obs[0] ? obs[0].v : null, prev: obs[1] ? obs[1].v : null, date: obs[0] ? obs[0].d : null };
      }

      var tips     = iv(iRes[0]);
      var m2       = iv(iRes[1]);
      var curve    = iv(iRes[2]);
      var claims   = iv(iRes[3]);
      var ukGilt   = iv(iRes[4]);
      var ukRate   = iv(iRes[5]);
      var ukCpi    = iv(iRes[6]);
      var usTsy    = iv(iRes[7]);
      var usFed    = iv(iRes[8]);

      /* Computed: UK real yield = gilt − CPI */
      var ukReal = (ukGilt.cur !== null && ukCpi.cur !== null)
        ? { cur: parseFloat((ukGilt.cur - ukCpi.cur).toFixed(2)), date: ukGilt.date }
        : { cur: null, date: null };

      /* Computed: gilt spread UK−US */
      var giltSpread = (ukGilt.cur !== null && usTsy.cur !== null)
        ? { cur: parseFloat((ukGilt.cur - usTsy.cur).toFixed(2)) }
        : { cur: null };

      return {
        statusCode: 200, headers: hdrs,
        body: JSON.stringify({
          repression: { ukReal: ukReal, ukGilt: ukGilt, ukCpi: ukCpi, tips: tips },
          debasement: { m2: m2, usFed: usFed },
          cycle:      { curve: curve, claims: claims },
          ukdebt:     { ukGilt: ukGilt, ukCpi: ukCpi, ukRate: ukRate },
          gilts:      { ukGilt: ukGilt, usTsy: usTsy, giltSpread: giltSpread },
        }),
      };
    }

    /* ── HISTORICAL COMPARISON ── */
    if (type === 'history') {
      var years    = Math.min(20, Math.max(1, parseInt(p.years || '10')));
      var startD   = new Date();
      startD.setFullYear(startD.getFullYear() - years);
      var startStr = startD.toISOString().split('T')[0];
      var fredBase = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&api_key=' + FRED + '&observation_start=' + startStr + '&frequency=m&aggregation_method=eop&series_id=';

      var hResults = await Promise.allSettled([
        fetchJson(fredBase + 'GOLDPMGBD228NLBM'), /* Gold (GBP) monthly */
        fetchJson(fredBase + 'SP500'),             /* S&P 500            */
        fetchJson(fredBase + 'CPALTT01GBM659N'),   /* UK CPI index       */
        fetchJson(fredBase + 'BOEBR'),             /* BoE base rate      */
      ]);

      function hVal(r) { return r.status === 'fulfilled' ? clean((r.value || {}).observations) : []; }

      return {
        statusCode: 200, headers: hdrs,
        body: JSON.stringify({
          gold:  hVal(hResults[0]),
          sp500: hVal(hResults[1]),
          ukcpi: hVal(hResults[2]),
          boe:   hVal(hResults[3]),
        }),
      };
    }

    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'Unknown type' }) };

  } catch (err) {
    return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: err.message }) };
  }
};
