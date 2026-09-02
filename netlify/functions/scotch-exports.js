/* ── WHISKY EXPORTS — UN Comtrade proxy ─────────────────────────────
   Fetches whisky export data (HS 220830) from the UN Comtrade
   public API for any major producing country.
   No API key required (public preview endpoint).

   Route: GET /scotch-exports?origin=scotland|japan|usa|ireland&year=2024
   origin defaults to scotland (UK reporter 826)
   ──────────────────────────────────────────────────────────────── */
var https = require('https');

/* Cache 7 days — UN Comtrade annual data updates ~quarterly */
var CACHE_HDR = 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400';

/* M49 numeric → short destination key used in the widget */
var DEST_MAP = {
  840: 'usa',
  250: 'france',
  276: 'germany',
  356: 'india',
  702: 'singapore',
  392: 'japan',
  158: 'taiwan',
   36: 'australia',
  410: 'korea',
  124: 'canada',
   56: 'belgium',
  528: 'netherlands',
  756: 'switzerland',
  724: 'spain',
  380: 'italy',
  616: 'poland',
  764: 'thailand',
  340: 'cambodia',   /* unlikely — catch-all for SE Asia */
};

/* Human-readable labels for unknown codes */
var COUNTRY_NAMES = {
  usa: 'USA', france: 'France', germany: 'Germany',
  india: 'India', singapore: 'Singapore', japan: 'Japan',
  taiwan: 'Taiwan', australia: 'Australia', korea: 'S. Korea',
  canada: 'Canada', belgium: 'Belgium', netherlands: 'Netherlands',
  switzerland: 'Switzerland', spain: 'Spain', italy: 'Italy',
  poland: 'Poland', thailand: 'Thailand',
};

function fetchUrl(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 10000 }, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('parse error: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function() {
      reject(new Error('timeout'));
    });
  });
}

/* Friendly names for known UN Comtrade partner codes that don't map cleanly */
var CODE_OVERRIDE = {
  842: 'USA',        /* UN Comtrade uses 842 for United States in some classifications */
  381: 'Italy',
  579: 'Norway',
  757: 'Switzerland',
};

/* UN Comtrade M49 reporter codes for each whisky origin */
var REPORTER_CODES = {
  scotland: 826,   /* United Kingdom */
  ireland:  372,   /* Ireland */
  japan:    392,   /* Japan */
  usa:      840,   /* United States */
};

function comtradeUrl(year, reporterCode) {
  return 'https://comtradeapi.un.org/public/v1/preview/C/A/HS' +
    '?reporterCode=' + (reporterCode || 826) + '&flowCode=X&cmdCode=220830&period=' + year +
    '&includeDesc=true';
}

function processRows(rows, reporterCode) {
  /* First pass: build name map and flag which codes are aggregates to exclude */
  var nameByCode = {};
  var excludeCode = {};
  rows.forEach(function(r) {
    var pc = r.partnerCode;
    if (!pc) return;
    var desc = r.partnerDesc || CODE_OVERRIDE[pc] || null;
    if (desc) {
      if (/\bnes\b|^Other\s|^World$|^Areas|^Special/i.test(desc)) {
        excludeCode[pc] = true;
      } else {
        nameByCode[pc] = nameByCode[pc] || desc;
      }
    } else if (!nameByCode[pc] && !excludeCode[pc]) {
      /* No description and not in override — mark as unknown aggregate */
      excludeCode[pc] = true;
    }
  });

  /* Second pass: aggregate values for known, non-excluded country partners */
  var byPartner = {};
  rows.forEach(function(r) {
    var pc = r.partnerCode;
    if (!pc || pc < 10 || pc > 900) return;           /* skip region aggregates */
    if (pc === (reporterCode || 826)) return;           /* skip reporter→self */
    if (excludeCode[pc]) return;                       /* skip unknown aggregates */
    var val = r.primaryValue || 0;
    if (!val) return;
    byPartner[pc] = (byPartner[pc] || 0) + val;
  });

  var total = 0;
  Object.keys(byPartner).forEach(function(k) { total += byPartner[k]; });
  if (!total) return null;

  /* Build sorted destination list */
  var dests = Object.keys(byPartner).map(function(k) {
    var code     = parseInt(k);
    var rawName  = nameByCode[code] || CODE_OVERRIDE[code] || ('Country ' + code);
    /* Shorten long UN names */
    var country = rawName
      .replace('United States of America', 'USA')
      .replace('United Kingdom', 'UK')
      .replace('United Arab Emirates', 'UAE')
      .replace('Republic of Korea', 'S. Korea')
      .replace('China, mainland', 'China')
      .replace('China, Hong Kong SAR', 'Hong Kong')
      .replace('China, Macao SAR', 'Macao')
      .replace('Russian Federation', 'Russia')
      .replace('Viet Nam', 'Vietnam')
      .replace('Czechia', 'Czech Rep.')
      .replace('Netherlands (Kingdom of the)', 'Netherlands');
    /* key for widget lookup */
    var key = DEST_MAP[code] || country.toLowerCase().replace(/[^a-z]/g, '_');
    return {
      m49:      code,
      key:      key,
      country:  country,
      valueUSD: byPartner[k],
      pct:      Math.round((byPartner[k] / total) * 1000) / 10,
    };
  }).sort(function(a, b) { return b.valueUSD - a.valueUSD; });

  return { total: total, dests: dests };
}

exports.handler = async function(event) {
  var hdrs = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': CACHE_HDR,
  };

  var qp       = event.queryStringParameters || {};
  var now      = new Date();
  var thisYear = now.getFullYear();
  /* UN Comtrade annual data lags ~12 months; prefer year-2 then year-1 */
  var year     = parseInt(qp.year) || (thisYear - 1);

  var originKey    = (qp.origin || 'scotland').toLowerCase().replace(/[^a-z]/g, '');
  var reporterCode = REPORTER_CODES[originKey] || REPORTER_CODES.scotland;
  var originLabel  = { scotland: 'UK', ireland: 'Ireland', japan: 'Japan', usa: 'USA' }[originKey] || 'UK';

  try {
    var current = await fetchUrl(comtradeUrl(year, reporterCode));
    var rows    = (current && current.data) || [];

    /* If empty, try one year earlier */
    if (!rows.length) {
      var fallback = await fetchUrl(comtradeUrl(year - 1, reporterCode));
      rows  = (fallback && fallback.data) || [];
      year  = year - 1;
    }

    var result = processRows(rows, reporterCode);
    if (!result) {
      return { statusCode: 502, headers: hdrs, body: JSON.stringify({ error: 'no data', year: year, origin: originKey }) };
    }

    /* Fetch previous year for YoY — fault-tolerant: yoy stays null if this fails */
    var prevResult = null;
    var prevByKey  = {};
    try {
      var prevData = await fetchUrl(comtradeUrl(year - 1, reporterCode));
      var prevRows = (prevData && prevData.data) || [];
      prevResult = processRows(prevRows, reporterCode);
    } catch(e) { /* previous year unavailable — yoy will be null */ }
    if (prevResult) {
      prevResult.dests.forEach(function(d) { prevByKey[d.key] = d.valueUSD; });
    }

    /* Add YoY and GBP value to each destination */
    result.dests.forEach(function(d) {
      if (prevByKey[d.key]) {
        var chg = ((d.valueUSD - prevByKey[d.key]) / prevByKey[d.key]) * 100;
        d.yoy = Math.round(chg * 10) / 10;
      } else {
        d.yoy = null;
      }
      d.valueGBP = Math.round(d.valueUSD * 0.79);
    });

    /* Total YoY */
    var totalYoy = null;
    if (prevResult && prevResult.total) {
      totalYoy = Math.round(((result.total - prevResult.total) / prevResult.total) * 1000) / 10;
    }

    return {
      statusCode: 200,
      headers: hdrs,
      body: JSON.stringify({
        origin:   originKey,
        source:   'UN Comtrade · HS 220830 · ' + originLabel + ' exports',
        period:   String(year),
        prevPeriod: prevResult ? String(year - 1) : null,
        totalUSD: Math.round(result.total),
        totalGBP: Math.round(result.total * 0.79),
        totalYoy: totalYoy,
        destinations: result.dests.slice(0, 15),     /* top 15 */
        updatedAt: now.toISOString().slice(0, 10),
      }),
    };
  } catch(err) {
    return {
      statusCode: 502,
      headers: hdrs,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
