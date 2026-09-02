/* ── ROUTE HISTORY — UN Comtrade multi-year bilateral whisky trade ──
   Fetches annual export value + volume for one origin→destination
   pair across a range of years. No API key required.

   Route: GET /route-history?origin=scotland&dest=842&years=2019-2025

   origin  — scotland|japan|usa|ireland (maps to UN Comtrade reporter)
   dest    — UN Comtrade M49 partner code (numeric)
   years   — year range, e.g. 2019-2025 (defaults to 2019–last full year)

   Returns: { origin, dest, rows: [{year, valueUSD, valueGBP, netWgt, kgPerUSD}] }
   CDN-cached 7 days.
   ──────────────────────────────────────────────────────────────── */
var https = require('https');

var CACHE_HDR = 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400';

var REPORTER_CODES = {
  scotland: 826,
  ireland:  372,
  japan:    392,
  usa:      840,
};

/* GBP/USD approximate annual averages for conversion */
var GBP_RATES = {
  2019: 0.783, 2020: 0.779, 2021: 0.727, 2022: 0.812,
  2023: 0.802, 2024: 0.790, 2025: 0.790, 2026: 0.790,
};

function fetchUrl(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 12000 }, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('parse: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function() { reject(new Error('timeout')); });
  });
}

function comtradeUrl(year, reporterCode, partnerCode) {
  return 'https://comtradeapi.un.org/public/v1/preview/C/A/HS' +
    '?reporterCode=' + reporterCode +
    '&partnerCode=' + partnerCode +
    '&flowCode=X&cmdCode=220830&period=' + year +
    '&includeDesc=false';
}

function extractRow(data, year) {
  var rows = (data && data.data) || [];

  /* UN Comtrade returns sub-rows by transport mode (motCode) and sometimes by
     secondary partner (partner2Code for re-export breakdowns). The canonical
     bilateral total is: isAggregate=true, motCode=0, partner2Code=0 (or absent). */
  var aggRows = rows.filter(function(r) {
    return r.partnerCode &&
           r.isAggregate === true &&
           r.motCode === 0 &&
           (r.partner2Code === 0 || r.partner2Code == null);
  });

  /* Fall back: any isAggregate row with motCode=0 */
  if (!aggRows.length) {
    aggRows = rows.filter(function(r) {
      return r.partnerCode && r.isAggregate === true && r.motCode === 0;
    });
  }

  /* Final fall back to any isAggregate row */
  if (!aggRows.length) {
    aggRows = rows.filter(function(r) { return r.partnerCode && r.isAggregate === true; });
  }

  /* If still nothing, fall back to all rows (sum non-duplicate values) */
  var valueUSD = 0, netWgt = 0;
  if (aggRows.length) {
    /* Deduplicate by max primaryValue — duplicate rows are identical */
    valueUSD = Math.max.apply(null, aggRows.map(function(r) { return r.primaryValue || 0; }));
    netWgt   = Math.max.apply(null, aggRows.map(function(r) { return r.netWgt || 0; }));
  } else {
    rows.forEach(function(r) {
      if (!r.partnerCode) return;
      valueUSD += r.primaryValue || 0;
      netWgt   += r.netWgt || 0;
    });
  }

  if (!valueUSD) return null;
  var rate = GBP_RATES[year] || 0.79;
  return {
    year:     year,
    valueUSD: Math.round(valueUSD),
    valueGBP: Math.round(valueUSD * rate),
    netWgt:   Math.round(netWgt),
    gbpPerKg: netWgt > 0 ? Math.round((valueUSD * rate) / netWgt * 100) / 100 : null,
  };
}

exports.handler = async function(event) {
  var hdrs = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': CACHE_HDR,
  };

  var p = event.queryStringParameters || {};

  var originKey    = (p.origin || 'scotland').toLowerCase().replace(/[^a-z]/g, '');
  var reporterCode = REPORTER_CODES[originKey];
  if (!reporterCode) {
    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'unknown origin' }) };
  }

  var destCode = parseInt(p.dest);
  if (!destCode || isNaN(destCode)) {
    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'dest (M49 code) required' }) };
  }

  /* Parse year range */
  var now      = new Date();
  var lastYear = now.getFullYear() - 1;
  var yearRange = (p.years || ('2019-' + lastYear)).split('-');
  var fromYear  = parseInt(yearRange[0]) || 2019;
  var toYear    = parseInt(yearRange[1]) || lastYear;
  if (fromYear < 2000 || toYear > now.getFullYear() || fromYear > toYear) {
    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'invalid year range' }) };
  }

  var years = [];
  for (var y = fromYear; y <= toYear; y++) years.push(y);

  /* Fetch all years in parallel */
  var fetched = await Promise.allSettled(
    years.map(function(yr) {
      return fetchUrl(comtradeUrl(yr, reporterCode, destCode));
    })
  );

  var rows = [];
  fetched.forEach(function(result, i) {
    if (result.status !== 'fulfilled') return;
    var row = extractRow(result.value, years[i]);
    if (row) rows.push(row);
  });

  if (!rows.length) {
    return { statusCode: 502, headers: hdrs, body: JSON.stringify({ error: 'no data for this route' }) };
  }

  /* Compute YoY for each row */
  for (var ri = 1; ri < rows.length; ri++) {
    var prev = rows[ri - 1];
    var curr = rows[ri];
    curr.yoy = Math.round(((curr.valueGBP - prev.valueGBP) / prev.valueGBP) * 1000) / 10;
  }
  rows[0].yoy = null;

  return {
    statusCode: 200,
    headers: hdrs,
    body: JSON.stringify({
      origin:      originKey,
      dest:        destCode,
      source:      'UN Comtrade · HS 220830',
      rows:        rows,
      updatedAt:   now.toISOString().slice(0, 10),
    }),
  };
};
