/* ── MACRO DATA — FRED + Finnhub proxy ──────────────────────────
   ?type=prices   → live gold, FX, BoE rate, UK CPI
   ?type=history  → monthly historical for comparison chart (10Y)
   Keys injected server-side; never exposed to browser.
   ─────────────────────────────────────────────────────────── */
const https = require('https');
const url_module = require('url');

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

function fetchJsonWith(urlStr, reqHeaders) {
  return new Promise(function (resolve, reject) {
    var parsed = url_module.parse(urlStr);
    var opts = { hostname: parsed.hostname, path: parsed.path, headers: reqHeaders || {}, timeout: 8000 };
    https.get(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var loc = res.headers.location;
        if (loc.startsWith('/')) loc = 'https://' + parsed.hostname + loc;
        return fetchJsonWith(loc, reqHeaders).then(resolve).catch(reject);
      }
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

function clean(obs) {
  return (obs || [])
    .filter(function (o) { return o.value !== '.'; })
    .map(function (o) { return { d: o.date, v: parseFloat(o.value) }; });
}

/* ── MACRO MONITOR CATALOGUE — full list of available series ── */
var MM_CATALOGUE = [
  { s:'GOLDAMGBD228NLBM', n:'Gold',                   u:'USD/oz',  cat:'COMMODITIES', chartId:'GOLDAMGBD228NLBM', fxKey:null,     def:true  },
  { s:'DCOILWTICO',       n:'WTI Oil',                 u:'USD/bbl', cat:'COMMODITIES', chartId:'DCOILWTICO',       fxKey:null,     def:true  },
  { s:'DCOILBRENTEU',     n:'Brent Crude',             u:'USD/bbl', cat:'COMMODITIES', chartId:'DCOILBRENTEU',     fxKey:null,     def:false },
  { s:'SLVPRUSD',         n:'Silver',                  u:'USD/oz',  cat:'COMMODITIES', chartId:'SLVPRUSD',         fxKey:null,     def:false },
  { s:'VIXCLS',           n:'VIX',                     u:'idx',     cat:'COMMODITIES', chartId:'VIXCLS',           fxKey:null,     def:false },
  { s:'SP500',            n:'S&P 500',                 u:'pts',     cat:'EQUITIES',    chartId:'SP500',            fxKey:null,     def:true  },
  { s:'NASDAQCOM',        n:'NASDAQ',                  u:'pts',     cat:'EQUITIES',    chartId:'NASDAQCOM',        fxKey:null,     def:false },
  { s:'DEXUSUK',          n:'GBP/USD',                 u:'FX',      cat:'FX',          chartId:'DEXUSUK',          fxKey:'GBPUSD', def:true  },
  { s:'DEXUSEU',          n:'EUR/USD',                 u:'FX',      cat:'FX',          chartId:'DEXUSEU',          fxKey:'EURUSD', def:true  },
  { s:'DEXJPUS',          n:'USD/JPY',                 u:'JPY',     cat:'FX',          chartId:'DEXJPUS',          fxKey:'USDJPY', def:false },
  { s:'DEXSZUS',          n:'USD/CHF',                 u:'FX',      cat:'FX',          chartId:'DEXSZUS',          fxKey:'USDCHF', def:false },
  { s:'DEXCAUS',          n:'USD/CAD',                 u:'FX',      cat:'FX',          chartId:'DEXCAUS',          fxKey:'USDCAD', def:false },
  { s:'DEXUSAL',          n:'AUD/USD',                 u:'FX',      cat:'FX',          chartId:'DEXUSAL',          fxKey:'AUDUSD', def:false },
  { s:'DEXCHUS',          n:'USD/CNY',                 u:'FX',      cat:'FX',          chartId:'DEXCHUS',          fxKey:'USDCNY', def:false },
  { s:'IRLTLT01GBM156N',  n:'UK Gilt 10Y',             u:'%',       cat:'RATES',       chartId:'IRLTLT01GBM156N',  fxKey:null,     def:true  },
  { s:'DGS10',            n:'US 10Y',                  u:'%',       cat:'RATES',       chartId:'DGS10',            fxKey:null,     def:true  },
  { s:'DGS2',             n:'US 2Y',                   u:'%',       cat:'RATES',       chartId:'DGS2',             fxKey:null,     def:true  },
  { s:'DGS5',             n:'US 5Y',                   u:'%',       cat:'RATES',       chartId:'DGS5',             fxKey:null,     def:false },
  { s:'T10Y2Y',           n:'Yield Curve',             u:'%',       cat:'RATES',       chartId:'T10Y2Y',           fxKey:null,     def:true  },
  { s:'IRSTCI01GBM156N',  n:'UK Rate',                 u:'%',       cat:'RATES',       chartId:'IRSTCI01GBM156N',  fxKey:null,     def:true  },
  { s:'FEDFUNDS',         n:'US Fed Rate',             u:'%',       cat:'RATES',       chartId:'FEDFUNDS',         fxKey:null,     def:true  },
  { s:'ECBDFR',           n:'ECB Rate',                u:'%',       cat:'RATES',       chartId:'ECBDFR',           fxKey:null,     def:false },
  { s:'CPALTT01GBM659N',  n:'UK CPI',                  u:'%',       cat:'INFLATION',   chartId:'CPALTT01GBM659N',  fxKey:null,     def:true  },
  { s:'CPIAUCSL',         n:'US CPI',                  u:'idx',     cat:'INFLATION',   chartId:'CPIAUCSL',         fxKey:null,     def:true  },
  { s:'CPILFESL',         n:'US Core CPI',             u:'idx',     cat:'INFLATION',   chartId:'CPILFESL',         fxKey:null,     def:false },
  { s:'PCEPI',            n:'US PCE',                  u:'idx',     cat:'INFLATION',   chartId:'PCEPI',            fxKey:null,     def:false },
  { s:'M2SL',             n:'US M2',                   u:'$bn',     cat:'LIQUIDITY',   chartId:'M2SL',             fxKey:null,     def:true  },
  { s:'WALCL',            n:'Fed Balance Sheet',       u:'$tn',     cat:'LIQUIDITY',   chartId:'WALCL',            fxKey:null,     def:false },
  { s:'UNRATE',           n:'US Unemployment',         u:'%',       cat:'EMPLOYMENT',  chartId:'UNRATE',           fxKey:null,     def:false },
  { s:'PAYEMS',           n:'US Nonfarm Payrolls',     u:'Mppl',    cat:'EMPLOYMENT',  chartId:'PAYEMS',           fxKey:null,     def:false },
  { s:'UMCSENT',          n:'UoM Consumer Sentiment',  u:'idx',     cat:'SENTIMENT',   chartId:'UMCSENT',          fxKey:null,     def:false },
];

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

    /* ── CATALOGUE — return all available series metadata ── */
    if (type === 'catalogue') {
      var catOut = MM_CATALOGUE.map(function(s) {
        return { s: s.s, n: s.n, u: s.u, cat: s.cat, def: s.def };
      });
      return { statusCode: 200, headers: Object.assign({}, hdrs, { 'Cache-Control': 'public, max-age=86400' }), body: JSON.stringify(catOut) };
    }

    /* ── MACRO MONITOR LIVE (FRED + open.er-api.com FX overlay) ── */
    if (type === 'monitor-live') {
      var mlNow = new Date();
      var mlYearStart = mlNow.getFullYear() + '-01-01';
      var mlQm = Math.floor(mlNow.getMonth() / 3) * 3;
      var mlQtdStart = new Date(mlNow.getFullYear(), mlQm, 1).toISOString().split('T')[0];
      var mlDow = mlNow.getDay();
      var mlDaysBack = mlDow === 0 ? 6 : mlDow - 1;
      var mlWtdStart = new Date(mlNow.getTime() - mlDaysBack * 86400000).toISOString().split('T')[0];
      /* fetch 2 years to capture monthly/quarterly series (UK CPI etc.) */
      var mlQueryStart = new Date(mlNow.getTime() - 731 * 86400000).toISOString().split('T')[0];
      /* 1Y% column uses price from 366 days ago */
      var mlOneYearAgo = new Date(mlNow.getTime() - 366 * 86400000).toISOString().split('T')[0];

      /* Filter catalogue to user's series list if provided, else use defaults */
      var userSeriesParam = p.series ? p.series.split(',').filter(Boolean) : null;
      var ML_SERIES = userSeriesParam
        ? MM_CATALOGUE.filter(function(s) { return userSeriesParam.indexOf(s.s) !== -1; })
        : MM_CATALOGUE.filter(function(s) { return s.def; });

      function mlNearest(obs, dateStr) {
        var t = new Date(dateStr).getTime();
        for (var i = obs.length - 1; i >= 0; i--) {
          if (new Date(obs[i].d).getTime() <= t) return obs[i].v;
        }
        return null;
      }
      function mlPct(a, b) { return (a !== null && b !== null && b !== 0) ? parseFloat(((a - b) / Math.abs(b) * 100).toFixed(3)) : null; }

      var MF2 = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&api_key=' + FRED + '&observation_start=' + mlQueryStart + '&series_id=';

      /* Live price sources:
         - gold-api.com  → Gold (XAU) and Silver (XAG) in USD
         - Yahoo Finance v8 chart → Oil, VIX, Equities
         - open.er-api.com → FX (GBP/USD, EUR/USD) and GBP conversion for metals */
      var YAHOO_MAP = {
        'DCOILWTICO':  'CL%3DF',   /* CL=F  WTI crude futures  */
        'DCOILBRENTEU':'BZ%3DF',   /* BZ=F  Brent crude        */
        'VIXCLS':      '%5EVIX',   /* ^VIX                     */
        'SP500':       '%5EGSPC',  /* ^GSPC S&P 500            */
        'NASDAQCOM':   '%5EIXIC',  /* ^IXIC NASDAQ             */
      };

      /* Collect only the Yahoo symbols we actually need for this request */
      var yhSeriesIds = ML_SERIES.filter(function(s) { return !!YAHOO_MAP[s.s]; });
      var yhHdrs = { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' };
      var YH_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

      var needGold   = ML_SERIES.some(function(s) { return s.s === 'GOLDAMGBD228NLBM'; });
      var needSilver = ML_SERIES.some(function(s) { return s.s === 'SLVPRUSD'; });

      var mlResults = await Promise.all([
        Promise.allSettled(ML_SERIES.map(function (s) { return fetchJson(MF2 + s.s); })),
        fetchJson('https://open.er-api.com/v6/latest/USD').catch(function () { return null; }),
        Promise.allSettled(yhSeriesIds.map(function(s) {
          return fetchJsonWith(YH_BASE + YAHOO_MAP[s.s] + '?interval=1d&range=5d', yhHdrs);
        })),
        needGold   ? fetchJson('https://api.gold-api.com/price/XAU').catch(function() { return null; }) : Promise.resolve(null),
        needSilver ? fetchJson('https://api.gold-api.com/price/XAG').catch(function() { return null; }) : Promise.resolve(null),
        needGold   ? fetchJsonWith(YH_BASE + 'GC%3DF?interval=1d&range=2y', yhHdrs).catch(function() { return null; }) : Promise.resolve(null),
      ]);
      var mlFredRes  = mlResults[0];
      var erData     = mlResults[1];
      var yhFetchRes = mlResults[2];
      var goldApiRes = mlResults[3];
      var silvApiRes = mlResults[4];
      var goldHistRes = mlResults[5];

      /* Build gold historical obs from Yahoo GC=F (FRED GOLDAMGBD228NLBM discontinued 2015) */
      var goldObs = [];
      if (needGold && goldHistRes) {
        try {
          var ghResult = ((goldHistRes.chart || {}).result || [])[0];
          if (ghResult) {
            var ghTs = ghResult.timestamp || [];
            var ghClose = ((ghResult.indicators || {}).quote || [{}])[0].close || [];
            ghTs.forEach(function(ts, idx) {
              var v = ghClose[idx];
              if (v != null && !isNaN(v)) {
                goldObs.push({ d: new Date(ts * 1000).toISOString().split('T')[0], v: parseFloat(v.toFixed(2)) });
              }
            });
          }
        } catch(e) {}
      }

      /* Build Yahoo quote map: FRED series ID → { price, dayPct } */
      var yhQuotes = {};
      yhSeriesIds.forEach(function(s, i) {
        var r = yhFetchRes[i];
        if (r.status !== 'fulfilled') return;
        var result = ((r.value || {}).chart || {}).result;
        if (!result || !result[0]) return;
        var meta = result[0].meta || {};
        var price = meta.regularMarketPrice;
        var prevClose = meta.chartPreviousClose || meta.previousClose;
        if (!price) return;
        var dayPct = prevClose ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(3)) : null;
        yhQuotes[s.s] = { price: price, dayPct: dayPct };
      });

      /* Gold and silver from gold-api.com (USD price, will convert to GBP/USD below) */
      var goldUSD   = (goldApiRes && goldApiRes.price) ? goldApiRes.price : null;
      var silverUSD = (silvApiRes && silvApiRes.price) ? silvApiRes.price : null;

      var erRates  = (erData && erData.rates) ? erData.rates : {};
      var erGBP    = erRates['GBP'] || null;
      var erEUR    = erRates['EUR'] || null;
      var erGBPUSD = erGBP ? parseFloat((1 / erGBP).toFixed(4)) : null;
      var erEURUSD = erEUR ? parseFloat((1 / erEUR).toFixed(4)) : null;

      var hasLiveSrc = {};
      ML_SERIES.forEach(function(s) {
        hasLiveSrc[s.s] = !!(YAHOO_MAP[s.s] || s.fxKey ||
          s.s === 'GOLDAMGBD228NLBM' || s.s === 'SLVPRUSD');
      });

      var mlRows = ML_SERIES.map(function (s, i) {
        var r   = mlFredRes[i];
        var row = { s: s.s, chartId: s.chartId, n: s.n, u: s.u, cat: s.cat,
          last: null, net: null, day: null, wtd: null, qtd: null, ytd: null, y1: null,
          isLive: !!hasLiveSrc[s.s] };

        /* FRED historical obs — used for % calculations; may be empty for some series */
        var obs = (r.status === 'fulfilled') ? clean((r.value || {}).observations) : [];
        var fredLast = obs.length ? obs[obs.length - 1] : null;
        var prev     = obs.length > 1 ? obs[obs.length - 2].v : null;

        /* Start from FRED last value (may be null if no obs) */
        var liveLast = fredLast ? fredLast.v : null;
        var liveDay  = null;

        /* FX live overrides from ER-API */
        if (s.fxKey === 'GBPUSD' && erGBPUSD)              liveLast = erGBPUSD;
        if (s.fxKey === 'EURUSD' && erEURUSD)              liveLast = erEURUSD;
        if (s.fxKey === 'USDJPY' && erRates['JPY'])        liveLast = parseFloat(erRates['JPY'].toFixed(2));
        if (s.fxKey === 'USDCHF' && erRates['CHF'])        liveLast = parseFloat(erRates['CHF'].toFixed(4));
        if (s.fxKey === 'USDCAD' && erRates['CAD'])        liveLast = parseFloat(erRates['CAD'].toFixed(4));
        if (s.fxKey === 'AUDUSD' && erRates['AUD'])        liveLast = parseFloat((1 / erRates['AUD']).toFixed(4));
        if (s.fxKey === 'USDCNY' && erRates['CNY'])        liveLast = parseFloat(erRates['CNY'].toFixed(4));

        /* Gold: live spot from gold-api.com; history from Yahoo GC=F (FRED series discontinued 2015) */
        if (s.s === 'GOLDAMGBD228NLBM' && goldUSD) {
          liveLast = parseFloat(goldUSD.toFixed(2));
          if (!obs.length && goldObs.length) obs = goldObs;
        }
        if (s.s === 'SLVPRUSD' && silverUSD) {
          liveLast = parseFloat(silverUSD.toFixed(3));
        }

        /* Yahoo Finance live quotes for equities/commodities */
        if (yhQuotes[s.s]) {
          liveLast = yhQuotes[s.s].price;
          liveDay  = yhQuotes[s.s].dayPct;
        }

        /* No price from any source → skip row */
        if (liveLast === null) return row;

        row.last = liveLast;
        row.date = fredLast ? fredLast.d : null;
        row.net  = (prev !== null) ? parseFloat((liveLast - prev).toFixed(4)) : null;
        row.day  = liveDay !== null ? parseFloat(liveDay.toFixed(3)) : mlPct(liveLast, prev);
        row.wtd  = mlPct(liveLast, mlNearest(obs, mlWtdStart));
        row.qtd  = mlPct(liveLast, mlNearest(obs, mlQtdStart));
        row.ytd  = mlPct(liveLast, mlNearest(obs, mlYearStart));
        row.y1   = mlPct(liveLast, mlNearest(obs, mlOneYearAgo));
        return row;
      });

      var liveHdrs = Object.assign({}, hdrs, { 'Cache-Control': 'public, max-age=60' });
      return { statusCode: 200, headers: liveHdrs, body: JSON.stringify(mlRows) };
    }

    /* ── MACRO MONITOR (cross-asset heatmap table) ── */
    if (type === 'monitor') {
      var now   = new Date();

      /* Period start dates */
      var yearStart = now.getFullYear() + '-01-01';
      var qm = Math.floor(now.getMonth() / 3) * 3;
      var qtdStart = new Date(now.getFullYear(), qm, 1).toISOString().split('T')[0];
      var dow = now.getDay(); /* 0=Sun */
      var daysBack = dow === 0 ? 6 : dow - 1;
      var wtdStart = new Date(now.getTime() - daysBack * 86400000).toISOString().split('T')[0];
      var y1Start  = new Date(now.getTime() - 731 * 86400000).toISOString().split('T')[0];
      var oneYearAgo = new Date(now.getTime() - 366 * 86400000).toISOString().split('T')[0];

      var MON_SERIES = [
        { s:'DCOILWTICO',       n:'WTI Oil',     u:'USD/bbl', cat:'COMMODITIES' },
        { s:'SP500',            n:'S&P 500',      u:'pts',     cat:'EQUITIES'    },
        { s:'DEXUSUK',          n:'GBP/USD',      u:'FX',      cat:'FX'          },
        { s:'DEXUSEU',          n:'EUR/USD',      u:'FX',      cat:'FX'          },
        { s:'IRLTLT01GBM156N',  n:'UK Gilt 10Y', u:'%',       cat:'RATES'       },
        { s:'DGS10',            n:'US 10Y',       u:'%',       cat:'RATES'       },
        { s:'DGS2',             n:'US 2Y',        u:'%',       cat:'RATES'       },
        { s:'T10Y2Y',           n:'Yield Curve',  u:'%',       cat:'RATES'       },
        { s:'IRSTCI01GBM156N',  n:'UK Rate',      u:'%',       cat:'RATES'       },
        { s:'FEDFUNDS',         n:'US Fed Rate',  u:'%',       cat:'RATES'       },
        { s:'CPALTT01GBM659N',  n:'UK CPI',       u:'%',       cat:'INFLATION'   },
        { s:'CPIAUCSL',         n:'US CPI',       u:'idx',     cat:'INFLATION'   },
        { s:'M2SL',             n:'US M2',        u:'$bn',     cat:'LIQUIDITY'   },
      ];

      var MF = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&api_key=' + FRED + '&observation_start=' + y1Start + '&series_id=';
      var mRes = await Promise.allSettled(MON_SERIES.map(function(s) { return fetchJson(MF + s.s); }));

      function nearest(obs, dateStr) {
        var t = new Date(dateStr).getTime();
        for (var i = obs.length - 1; i >= 0; i--) {
          if (new Date(obs[i].d).getTime() <= t) return obs[i].v;
        }
        return null;
      }
      function pct(a, b) { return (a !== null && b !== null && b !== 0) ? parseFloat(((a - b) / Math.abs(b) * 100).toFixed(3)) : null; }

      var monRows = MON_SERIES.map(function(s, i) {
        var r   = mRes[i];
        var row = { s:s.s, n:s.n, u:s.u, cat:s.cat, last:null, net:null, day:null, wtd:null, qtd:null, ytd:null, y1:null };
        if (r.status !== 'fulfilled') return row;
        var obs = clean((r.value || {}).observations);
        if (!obs.length) return row;
        var last = obs[obs.length - 1];
        var prev = obs.length > 1 ? obs[obs.length - 2].v : null;
        row.last = last.v;
        row.date = last.d;
        row.net  = (prev !== null) ? parseFloat((last.v - prev).toFixed(4)) : null;
        row.day  = pct(last.v, prev);
        row.wtd  = pct(last.v, nearest(obs, wtdStart));
        row.qtd  = pct(last.v, nearest(obs, qtdStart));
        row.ytd  = pct(last.v, nearest(obs, yearStart));
        row.y1   = pct(last.v, nearest(obs, oneYearAgo));
        return row;
      });

      return { statusCode: 200, headers: hdrs, body: JSON.stringify(monRows) };
    }

    /* ── SINGLE-SERIES PRICE CHART ── */
    if (type === 'chart') {
      var seriesId = ((p.series || '')).toUpperCase().replace(/[^A-Z0-9.]/g, '');
      if (!seriesId) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'series required' }) };

      var cyRaw = parseInt(p.years || '2');
      var useMax = cyRaw <= 0;
      var cy   = useMax ? 0 : Math.min(50, Math.max(1, cyRaw));

      /* ── STOCK TICKER (Yahoo Finance) ── */
      if (p.source === 'stock') {
        var yhRange = cy >= 5 ? '10y' : cy >= 2 ? '5y' : '2y';
        var yhHdrs  = { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' };
        var yhRaw   = await fetchJsonWith(
          'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(seriesId) + '?interval=1wk&range=' + yhRange,
          yhHdrs
        ).catch(function () { return null; });
        var yhData = [];
        var yhCurrency = '';
        try {
          var yhResult = ((yhRaw || {}).chart || {}).result || [];
          if (yhResult[0]) {
            yhCurrency = (yhResult[0].meta || {}).currency || '';
            var yhTs    = yhResult[0].timestamp || [];
            var yhClose = (((yhResult[0].indicators || {}).quote || [{}])[0].close || []);
            yhTs.forEach(function (ts, idx) {
              var v = yhClose[idx];
              if (v != null && !isNaN(v)) yhData.push({ d: new Date(ts * 1000).toISOString().split('T')[0], v: parseFloat(v.toFixed(2)) });
            });
          }
        } catch (e) {}
        return { statusCode: 200, headers: hdrs, body: JSON.stringify({ label: seriesId, unit: yhCurrency || 'Price', data: yhData }) };
      }

      var FB_BASE = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&api_key=' + FRED;
      var FB = FB_BASE + (useMax ? '' : ('&observation_start=' + (function(){ var d=new Date(); d.setFullYear(d.getFullYear()-cy); return d.toISOString().split('T')[0]; })())) + '&series_id=';

      /* EUR/GBP = DEXUSEU / DEXUSUK (both USD-based cross rates) */
      if (seriesId === 'EURGBP') {
        var cPair = await Promise.all([ fetchJson(FB + 'DEXUSUK'), fetchJson(FB + 'DEXUSEU') ]);
        var ukO = clean((cPair[0] || {}).observations);
        var euO = clean((cPair[1] || {}).observations);
        var euMap = {}; euO.forEach(function (o) { euMap[o.d] = o.v; });
        var eurgbpData = ukO.filter(function (o) { return euMap[o.d]; })
          .map(function (o) { return { d: o.d, v: parseFloat((euMap[o.d] / o.v).toFixed(4)) }; });
        return { statusCode: 200, headers: hdrs, body: JSON.stringify({ label: 'EUR/GBP', unit: 'Rate', data: eurgbpData }) };
      }

      var labelMap = {
        DEXUSUK:           { label: 'GBP/USD',        unit: 'Rate' },
        GOLDAMGBD228NLBM:  { label: 'Gold (USD/oz)',  unit: 'USD'  },
        IRSTCI01GBM156N:   { label: 'UK Rate',        unit: '%'    },
        IRLTLT01GBM156N:   { label: 'UK 10-Yr Gilt',  unit: '%'    },
        CPALTT01GBM659N:   { label: 'UK CPI (YoY)',   unit: '%'    },
        FEDFUNDS:          { label: 'US Fed Rate',    unit: '%'    },
      };
      var cMeta = labelMap[seriesId] || { label: seriesId, unit: '' };

      /* Gold: FRED series discontinued 2015 — use Yahoo GC=F instead */
      if (seriesId === 'GOLDAMGBD228NLBM') {
        var gcHdrs = { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' };
        var gcRange = cy >= 5 ? '10y' : cy >= 2 ? '5y' : '2y';
        var gcRaw = await fetchJsonWith('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1wk&range=' + gcRange, gcHdrs).catch(function(){ return null; });
        var gcData = [];
        try {
          var gcResult = ((gcRaw || {}).chart || {}).result || [];
          if (gcResult[0]) {
            var gcTs = gcResult[0].timestamp || [];
            var gcClose = (((gcResult[0].indicators || {}).quote || [{}])[0].close || []);
            gcTs.forEach(function(ts, idx) {
              var v = gcClose[idx];
              if (v != null && !isNaN(v)) gcData.push({ d: new Date(ts * 1000).toISOString().split('T')[0], v: parseFloat(v.toFixed(2)) });
            });
          }
        } catch(e) {}
        return { statusCode: 200, headers: hdrs, body: JSON.stringify({ label: cMeta.label, unit: cMeta.unit, data: gcData }) };
      }

      var cRaw  = await fetchJson(FB + seriesId);
      return { statusCode: 200, headers: hdrs, body: JSON.stringify({ label: cMeta.label, unit: cMeta.unit, data: clean((cRaw || {}).observations) }) };
    }

    /* ── HISTORICAL COMPARISON ── */
    if (type === 'history') {
      var years    = Math.min(20, Math.max(1, parseInt(p.years || '10')));
      var startD   = new Date();
      startD.setFullYear(startD.getFullYear() - years);
      var startStr = startD.toISOString().split('T')[0];
      var fredBase = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&api_key=' + FRED + '&observation_start=' + startStr + '&frequency=m&aggregation_method=eop&series_id=';

      var hResults = await Promise.allSettled([
        fetchJson(fredBase + 'GOLDAMGBD228NLBM'), /* Gold (USD) daily agg monthly */
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

    /* ── MARKET WIDGET QUOTES (proxied — key never sent to browser) ── */
    if (type === 'market') {
      var cat = p.cat || 'gold';
      var CATS = {
        gold:  [{sym:'GLD',  l:'GOLD (GLD)',      mult:10},
                {sym:'GDX',  l:'GOLD MINERS',     mult:1},
                {sym:'SGOL', l:'ABERDEEN GOLD',   mult:1},
                {sym:'IAU',  l:'iSHARES GOLD',    mult:10}],
        whisky:[{sym:'DEO',  l:'DIAGEO (DEO)',    mult:1},
                {sym:'BF.B', l:'BROWN-FORMAN',    mult:1},
                {sym:'MGPI', l:'MGP INGREDIENTS', mult:1},
                {sym:'GLD',  l:'GOLD/OZ',         mult:10}],
      };
      var syms = CATS[cat] || CATS.gold;
      var FHQ = 'https://finnhub.io/api/v1/quote?token=' + FINN + '&symbol=';
      var mktRes = await Promise.allSettled(syms.map(function(s){ return fetchJson(FHQ + s.sym); }));
      var quotes = syms.map(function(s, i) {
        var r = mktRes[i];
        var q = r.status === 'fulfilled' ? r.value : null;
        return {
          sym: s.sym, l: s.l, mult: s.mult,
          c:  q && q.c  ? q.c  : null,
          pc: q && q.pc ? q.pc : null,
          dp: q && q.dp ? q.dp : null,
        };
      });
      var mktHdrs = Object.assign({}, hdrs, { 'Cache-Control': 'public, max-age=60' });
      return { statusCode: 200, headers: mktHdrs, body: JSON.stringify(quotes) };
    }

    /* ── SECTOR HEATMAP ── */
    if (type === 'sectors') {
      var SECTORS = [
        {etf:'XLK',  name:'Technology',       span:4},
        {etf:'XLV',  name:'Healthcare',        span:2},
        {etf:'XLF',  name:'Financials',        span:2},
        {etf:'XLY',  name:'Discretionary',     span:2},
        {etf:'XLC',  name:'Comm Services',     span:2},
        {etf:'XLI',  name:'Industrials',       span:3},
        {etf:'XLP',  name:'Staples',           span:2},
        {etf:'XLE',  name:'Energy',            span:2},
        {etf:'XLRE', name:'Real Estate',       span:2},
        {etf:'XLB',  name:'Materials',         span:2},
        {etf:'XLU',  name:'Utilities',         span:1},
      ];
      var SYH = 'https://query1.finance.yahoo.com/v8/finance/chart/';
      var sYhHdrs = { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' };
      var sRes = await Promise.allSettled(SECTORS.map(function(s){
        return fetchJsonWith(SYH + s.etf + '?interval=1d&range=5d', sYhHdrs);
      }));
      var sRows = SECTORS.map(function(s, i){
        var r = sRes[i];
        var meta = (r.status === 'fulfilled' && r.value && r.value.chart && r.value.chart.result && r.value.chart.result[0]) ? r.value.chart.result[0].meta : null;
        var c  = meta ? (meta.regularMarketPrice || null) : null;
        var pc = meta ? (meta.chartPreviousClose || meta.previousClose || null) : null;
        var h  = meta ? (meta.regularMarketDayHigh  || null) : null;
        var l  = meta ? (meta.regularMarketDayLow   || null) : null;
        var dp = (c && pc) ? parseFloat(((c - pc) / pc * 100).toFixed(2)) : null;
        return { etf:s.etf, name:s.name, span:s.span, c:c, pc:pc, h:h, l:l, dp:dp };
      });
      return { statusCode:200, headers:Object.assign({},hdrs,{'Cache-Control':'public,max-age=60'}), body:JSON.stringify(sRows) };
    }

    /* ── MULTI-MARKET SECTOR HEATMAP ── */
    if (type === 'market-sectors') {
      var mkt = (p.market || 'US').toUpperCase();
      var per = (p.period || '1D').toUpperCase();
      var yhH2 = { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' };

      /* Proxy ticker per sector-key for each market */
      var MKT_PROXIES = {
        US:  { XLK:'XLK', XLF:'XLF', XLV:'XLV', XLE:'XLE', XLY:'XLY', XLC:'XLC', XLI:'XLI', XLP:'XLP', XLU:'XLU', XLRE:'XLRE', XLB:'XLB' },
        UK:  { UK_FIN:'HSBA.L', UK_MIN:'GLEN.L', UK_CON:'ULVR.L', UK_ENE:'SHEL.L', UK_HLT:'AZN.L', UK_IND:'RR.L', UK_TEC:'SAGE.L', UK_UTL:'NG.L', UK_REI:'SGRO.L', UK_TEL:'VOD.L' },
        EU:  { EU_FIN:'AXA.PA', EU_IND:'SIE.DE', EU_HLT:'NVO', EU_CON:'MC.PA', EU_ENE:'TTE.PA', EU_TEC:'ASML.AS', EU_UTL:'IBE.MC', EU_MAT:'BAS.DE' }
      };
      var proxies = MKT_PROXIES[mkt] || MKT_PROXIES.US;
      var etfKeys = Object.keys(proxies);
      var tickers2 = etfKeys.map(function(k){ return proxies[k]; });

      if (per === '1D') {
        var bUrl = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(tickers2.join(','));
        var bData = await fetchJsonWith(bUrl, yhH2).catch(function(){ return null; });
        var qMap = {};
        (((bData || {}).quoteResponse || {}).result || []).forEach(function(q) {
          qMap[q.symbol] = { c: q.regularMarketPrice || null, dp: q.regularMarketChangePercent != null ? parseFloat(q.regularMarketChangePercent.toFixed(2)) : null };
        });
        var msR1 = etfKeys.map(function(k) {
          var d = qMap[proxies[k]] || {};
          return { etf: k, c: d.c || null, dp: d.dp != null ? d.dp : null };
        });
        return { statusCode:200, headers:Object.assign({},hdrs,{'Cache-Control':'public,max-age=60'}), body:JSON.stringify(msR1) };
      } else {
        var now3 = Date.now();
        var pStart;
        if      (per === '1W')  pStart = now3 - 7*86400000;
        else if (per === '1M')  pStart = now3 - 30*86400000;
        else if (per === '3M')  pStart = now3 - 91*86400000;
        else if (per === 'YTD') { var yd = new Date(); yd.setMonth(0,1); pStart = yd.getTime(); }
        else                    pStart = now3 - 365*86400000;
        var p1ts = Math.floor(pStart/1000), p2ts = Math.floor(now3/1000);

        var chRes = await Promise.allSettled(tickers2.map(function(tick) {
          return fetchJsonWith('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(tick) + '?interval=1d&period1=' + p1ts + '&period2=' + p2ts, yhH2);
        }));
        var msR2 = etfKeys.map(function(k, i) {
          var r = chRes[i];
          if (r.status !== 'fulfilled' || !r.value) return { etf:k, c:null, dp:null };
          var res0 = (((r.value.chart || {}).result) || [])[0];
          if (!res0) return { etf:k, c:null, dp:null };
          var cls = ((((res0.indicators || {}).quote || [{}])[0]).close || []).filter(function(v){ return v != null; });
          if (cls.length < 2) return { etf:k, c:null, dp:null };
          var f = cls[0], l = cls[cls.length-1];
          return { etf:k, c:parseFloat(l.toFixed(2)), dp:parseFloat(((l-f)/f*100).toFixed(2)) };
        });
        return { statusCode:200, headers:Object.assign({},hdrs,{'Cache-Control':'public,max-age=300'}), body:JSON.stringify(msR2) };
      }
    }

    /* ── YAHOO FINANCE BATCH QUOTE (any exchange) ── */
    if (type === 'yh-quote') {
      var yhqSyms = (p.symbols||'').split(',').map(function(s){return s.trim();}).filter(Boolean).slice(0,30);
      if (!yhqSyms.length) return { statusCode:400, headers:hdrs, body:JSON.stringify({error:'No symbols'}) };
      var yhqH = { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' };
      var yhqR = await fetchJsonWith('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(yhqSyms.join(',')), yhqH).catch(function(){ return null; });
      var yhqMap = {};
      (((yhqR || {}).quoteResponse || {}).result || []).forEach(function(q) {
        yhqMap[q.symbol] = { sym:q.symbol, c:q.regularMarketPrice||null, dp:q.regularMarketChangePercent!=null?parseFloat(q.regularMarketChangePercent.toFixed(2)):null, d:q.regularMarketChange!=null?parseFloat(q.regularMarketChange.toFixed(2)):null };
      });
      var yhqRows = yhqSyms.map(function(s) { return yhqMap[s] || { sym:s, c:null, dp:null }; });
      return { statusCode:200, headers:Object.assign({},hdrs,{'Cache-Control':'public,max-age=60'}), body:JSON.stringify(yhqRows) };
    }

    /* ── WATCHLIST BATCH QUOTES ── */
    if (type === 'quote') {
      var qSyms = (p.symbols||'').split(',').map(function(s){return s.trim().toUpperCase();}).filter(Boolean).slice(0,20);
      if (!qSyms.length) return { statusCode:400, headers:hdrs, body:JSON.stringify({error:'No symbols'}) };
      var FHQ2 = 'https://finnhub.io/api/v1/quote?token=' + FINN + '&symbol=';
      var wqRes = await Promise.allSettled(qSyms.map(function(s){ return fetchJson(FHQ2 + s); }));
      var wqRows = qSyms.map(function(sym, i){
        var r = wqRes[i], q = r.status === 'fulfilled' ? r.value : null;
        return { sym:sym, c:(q&&q.c)?q.c:null, pc:(q&&q.pc)?q.pc:null, dp:(q&&q.dp)?q.dp:null, h:(q&&q.h)?q.h:null, l:(q&&q.l)?q.l:null };
      });
      return { statusCode:200, headers:Object.assign({},hdrs,{'Cache-Control':'public,max-age=60'}), body:JSON.stringify(wqRows) };
    }

    /* ── GLOBAL MACRO (rates + CPI + live gold + FX for world map) ── */
    if (type === 'global-macro') {
      var GM = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&sort_order=desc&limit=3&api_key=' + FRED + '&series_id=';
      /* Extended country coverage: [iso2, field, fredSeries] */
      var GM_SERIES = [
        ['US','rate','FEDFUNDS'],
        ['GB','rate','IRSTCI01GBM156N'],
        ['EU','rate','ECBDFR'],
        ['JP','rate','IRSTCI01JPM156N'],
        ['CA','rate','IRSTCI01CAM156N'],
        ['AU','rate','IRSTCI01AUM156N'],
        ['CH','rate','IRSTCI01CHM156N'],
        ['NO','rate','IRSTCI01NOM156N'],
        ['SE','rate','IRSTCI01SEM156N'],
        ['NZ','rate','IRSTCI01NZM156N'],
        ['KR','rate','IRSTCI01KRM156N'],
        ['IN','rate','IRSTCI01INM156N'],
        ['CN','rate','IRSTCI01CNM156N'],
        ['BR','rate','IRSTCI01BRM156N'],
        ['MX','rate','IRSTCI01MXM156N'],
        ['US','cpi','CPALTT01USM659N'],
        ['GB','cpi','CPALTT01GBM659N'],
        ['EU','cpi','CPALTT01EZM659N'],
        ['JP','cpi','CPALTT01JPM659N'],
        ['CA','cpi','CPALTT01CAM659N'],
        ['AU','cpi','CPALTT01AUM659N'],
        ['CH','cpi','CPALTT01CHM659N'],
        ['NO','cpi','CPALTT01NOM659N'],
        ['SE','cpi','CPALTT01SEM659N'],
        ['NZ','cpi','CPALTT01NZM659N'],
        ['KR','cpi','CPALTT01KRM659N'],
        ['IN','cpi','CPALTT01INM659N'],
        ['CN','cpi','CPALTT01CNM659N'],
        ['BR','cpi','CPALTT01BRM659N'],
        ['MX','cpi','CPALTT01MXM659N'],
        ['ZA','cpi','CPALTT01ZAM659N'],
        ['TR','cpi','CPALTT01TRM659N'],
      ];
      var FH_GOLD = 'https://finnhub.io/api/v1/quote?token=' + FINN + '&symbol=OANDA:XAU_USD';
      var gmAll = await Promise.allSettled([
        ...GM_SERIES.map(function(s){ return fetchJson(GM + s[2]); }),
        fetchJson('https://open.er-api.com/v6/latest/USD').catch(function(){ return null; }),
        fetchJson(FH_GOLD).catch(function(){ return null; }),
      ]);
      var gmData = {};
      GM_SERIES.forEach(function(s, i){
        var obs = clean(((gmAll[i].status==='fulfilled'?(gmAll[i].value||{}):{}).observations)||[]);
        if (!gmData[s[0]]) gmData[s[0]] = {};
        gmData[s[0]][s[1]] = obs[0] ? obs[0].v : null;
      });
      /* Map EU rate/cpi to eurozone countries */
      var EUROZONE = ['DE','FR','IT','ES','NL','PT','FI','BE','AT','IE','GR','SK','SI','LU','CY','MT'];
      EUROZONE.forEach(function(iso){ gmData[iso] = Object.assign({}, gmData['EU'], gmData[iso]||{}); });

      var fxIdx = GM_SERIES.length;
      var fxR = gmAll[fxIdx];
      var goldR = gmAll[fxIdx + 1];
      var fxRates3 = (fxR.status==='fulfilled'&&fxR.value&&fxR.value.rates) ? fxR.value.rates : {};
      var goldUSD  = (goldR.status==='fulfilled'&&goldR.value&&goldR.value.c) ? goldR.value.c : null;

      return { statusCode:200, headers:Object.assign({},hdrs,{'Cache-Control':'public,max-age=60'}),
        body:JSON.stringify({countries:gmData, fx:fxRates3, goldUSD:goldUSD}) };
    }

return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'Unknown type' }) };

  } catch (err) {
    return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: err.message }) };
  }
};
