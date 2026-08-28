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

      var ML_SERIES = [
        { s:'GOLDPMGBD228NLBM', n:'Gold (GBP)',   u:'GBP/oz',  cat:'COMMODITIES', chartId:'GOLDPMGBD228NLBM', fxKey:null, finnhub:'OANDA:XAU_USD', finnhubFxKey:'GBP' },
        { s:'DCOILWTICO',       n:'WTI Oil',      u:'USD/bbl', cat:'COMMODITIES', chartId:'DCOILWTICO',       fxKey:null, finnhub:'OANDA:WTICO_USD', finnhubFxKey:null },
        { s:'SP500',            n:'S&P 500',      u:'pts',     cat:'EQUITIES',    chartId:'SP500',            fxKey:null, finnhub:'OANDA:SPX500_USD', finnhubFxKey:null },
        { s:'DEXUSUK',          n:'GBP/USD',      u:'FX',      cat:'FX',          chartId:'DEXUSUK',          fxKey:'GBPUSD', finnhub:null, finnhubFxKey:null },
        { s:'DEXUSEU',          n:'EUR/USD',      u:'FX',      cat:'FX',          chartId:'DEXUSEU',          fxKey:'EURUSD', finnhub:null, finnhubFxKey:null },
        { s:'IRLTLT01GBM156N',  n:'UK Gilt 10Y',  u:'%',       cat:'RATES',       chartId:'IRLTLT01GBM156N',  fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'DGS10',            n:'US 10Y',       u:'%',       cat:'RATES',       chartId:'DGS10',            fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'DGS2',             n:'US 2Y',        u:'%',       cat:'RATES',       chartId:'DGS2',             fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'T10Y2Y',           n:'Yield Curve',  u:'%',       cat:'RATES',       chartId:'T10Y2Y',           fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'IRSTCI01GBM156N',  n:'UK Rate',      u:'%',       cat:'RATES',       chartId:'IRSTCI01GBM156N',  fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'FEDFUNDS',         n:'US Fed Rate',  u:'%',       cat:'RATES',       chartId:'FEDFUNDS',         fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'CPALTT01GBM659N',  n:'UK CPI',       u:'%',       cat:'INFLATION',   chartId:'CPALTT01GBM659N',  fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'CPIAUCSL',         n:'US CPI',       u:'idx',     cat:'INFLATION',   chartId:'CPIAUCSL',         fxKey:null, finnhub:null, finnhubFxKey:null },
        { s:'M2SL',             n:'US M2',        u:'$bn',     cat:'LIQUIDITY',   chartId:'M2SL',             fxKey:null, finnhub:null, finnhubFxKey:null },
      ];

      function mlNearest(obs, dateStr) {
        var t = new Date(dateStr).getTime();
        for (var i = obs.length - 1; i >= 0; i--) {
          if (new Date(obs[i].d).getTime() <= t) return obs[i].v;
        }
        return null;
      }
      function mlPct(a, b) { return (a !== null && b !== null && b !== 0) ? parseFloat(((a - b) / Math.abs(b) * 100).toFixed(3)) : null; }

      var MF2 = 'https://api.stlouisfed.org/fred/series/observations?file_type=json&api_key=' + FRED + '&observation_start=' + mlQueryStart + '&series_id=';

      /* Unique Finnhub symbols needed */
      var finnhubSymbols = [];
      ML_SERIES.forEach(function (s) { if (s.finnhub && finnhubSymbols.indexOf(s.finnhub) === -1) finnhubSymbols.push(s.finnhub); });

      var FH2 = 'https://finnhub.io/api/v1/quote?token=' + FINN + '&symbol=';

      var mlResults = await Promise.all([
        Promise.allSettled(ML_SERIES.map(function (s) { return fetchJson(MF2 + s.s); })),
        fetchJson('https://open.er-api.com/v6/latest/USD').catch(function () { return null; }),
        Promise.allSettled(finnhubSymbols.map(function (sym) { return fetchJson(FH2 + sym); })),
      ]);
      var mlFredRes  = mlResults[0];
      var erData     = mlResults[1];
      var finnhubRes = mlResults[2];

      /* Build finnhub quote map: symbol → { c, dp } */
      var fhQuotes = {};
      finnhubSymbols.forEach(function (sym, i) {
        var r = finnhubRes[i];
        if (r.status === 'fulfilled' && r.value && r.value.c) {
          fhQuotes[sym] = { c: r.value.c, dp: r.value.dp || null };
        }
      });

      var erRates  = (erData && erData.rates) ? erData.rates : {};
      var erGBP    = erRates['GBP'] || null;
      var erEUR    = erRates['EUR'] || null;
      var erGBPUSD = erGBP ? parseFloat((1 / erGBP).toFixed(4)) : null;
      var erEURUSD = erEUR ? parseFloat((1 / erEUR).toFixed(4)) : null;

      var mlRows = ML_SERIES.map(function (s, i) {
        var r   = mlFredRes[i];
        var row = { s: s.s, chartId: s.chartId, n: s.n, u: s.u, cat: s.cat,
          last: null, net: null, day: null, wtd: null, qtd: null, ytd: null, y1: null,
          isLive: (s.fxKey !== null || s.finnhub !== null) };
        if (r.status !== 'fulfilled') return row;
        var obs = clean((r.value || {}).observations);
        if (!obs.length) return row;

        var fredLast = obs[obs.length - 1];
        var prev     = obs.length > 1 ? obs[obs.length - 2].v : null;

        var liveLast = fredLast.v;
        var liveDay  = null; /* will use Finnhub dp if available */

        /* Override with live FX from er-api.com */
        if (s.fxKey === 'GBPUSD' && erGBPUSD) liveLast = erGBPUSD;
        if (s.fxKey === 'EURUSD' && erEURUSD) liveLast = erEURUSD;

        /* Override with live Finnhub quote for equities/commodities */
        if (s.finnhub && fhQuotes[s.finnhub]) {
          var fhq = fhQuotes[s.finnhub];
          var fhPrice = fhq.c;
          /* Gold: Finnhub gives USD price; convert to GBP if needed */
          if (s.finnhubFxKey === 'GBP' && erGBP) fhPrice = parseFloat((fhPrice * erGBP).toFixed(2));
          liveLast = fhPrice;
          liveDay  = fhq.dp; /* Finnhub day% change */
        }

        row.last = liveLast;
        row.date = fredLast.d;
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
      var seriesId = ((p.series || '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!seriesId) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'series required' }) };

      var cyRaw = parseInt(p.years || '2');
      var useMax = cyRaw <= 0;
      var cy   = useMax ? 0 : Math.min(50, Math.max(1, cyRaw));
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
        GOLDPMGBD228NLBM:  { label: 'Gold (GBP/oz)',  unit: 'GBP'  },
        IRSTCI01GBM156N:   { label: 'UK Rate',        unit: '%'    },
        IRLTLT01GBM156N:   { label: 'UK 10-Yr Gilt',  unit: '%'    },
        CPALTT01GBM659N:   { label: 'UK CPI (YoY)',   unit: '%'    },
        FEDFUNDS:          { label: 'US Fed Rate',    unit: '%'    },
      };
      var cMeta = labelMap[seriesId] || { label: seriesId, unit: '' };
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
        {etf:'XLK',  name:'Technology'},
        {etf:'XLV',  name:'Healthcare'},
        {etf:'XLF',  name:'Financials'},
        {etf:'XLE',  name:'Energy'},
        {etf:'XLI',  name:'Industrials'},
        {etf:'XLP',  name:'Staples'},
        {etf:'XLU',  name:'Utilities'},
        {etf:'XLRE', name:'Real Estate'},
        {etf:'XLB',  name:'Materials'},
        {etf:'XLY',  name:'Discretionary'},
        {etf:'XLC',  name:'Comms'},
      ];
      var FHS = 'https://finnhub.io/api/v1/quote?token=' + FINN + '&symbol=';
      var sRes = await Promise.allSettled(SECTORS.map(function(s){ return fetchJson(FHS + s.etf); }));
      var sRows = SECTORS.map(function(s, i){
        var r = sRes[i], q = r.status === 'fulfilled' ? r.value : null;
        return { etf:s.etf, name:s.name, c:(q&&q.c)?q.c:null, pc:(q&&q.pc)?q.pc:null, dp:(q&&q.dp)?q.dp:null };
      });
      return { statusCode:200, headers:Object.assign({},hdrs,{'Cache-Control':'public,max-age=60'}), body:JSON.stringify(sRows) };
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
