/* ── FRED DATA PROXY ─────────────────────────────────────────────
   Fetches economic series from the St. Louis Fed FRED API.
   API key is kept server-side via FRED_API_KEY env var.

   Route: GET /fred-data?series_id=NAPM&limit=60
          GET /fred-data?series=NAPM,UNRATE,T10Y2YM&limit=60
   ──────────────────────────────────────────────────────────────── */
var https = require('https');

var CACHE_HDR = 'public, max-age=43200, s-maxage=43200, stale-while-revalidate=3600';

function fetchUrl(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 12000 }, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('parse error: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function() { reject(new Error('timeout')); });
  });
}

function fredUrl(seriesId, limit, apiKey) {
  return 'https://api.stlouisfed.org/fred/series/observations' +
    '?series_id=' + seriesId +
    '&api_key=' + apiKey +
    '&file_type=json' +
    '&limit=' + limit +
    '&sort_order=desc';
}

function processSeries(data, seriesId) {
  if (!data || !data.observations) return null;
  var obs = data.observations
    .filter(function(o) { return o.value !== '.' && o.value !== ''; })
    .map(function(o) { return { date: o.date, value: parseFloat(o.value) }; })
    .reverse();  /* chronological order */
  if (!obs.length) return null;
  var latest = obs[obs.length - 1];
  var prev   = obs.length > 1 ? obs[obs.length - 2] : null;
  return {
    series_id: seriesId,
    observations: obs,
    latest_date:  latest.date,
    latest_value: latest.value,
    prev_value:   prev ? prev.value : null,
    change:       prev ? Math.round((latest.value - prev.value) * 100) / 100 : null,
    count:        obs.length,
  };
}

exports.handler = async function(event) {
  var hdrs = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':               CACHE_HDR,
  };

  var apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  var qp     = event.queryStringParameters || {};
  var limit  = Math.min(parseInt(qp.limit) || 72, 300);

  /* Multi-series mode: ?series=NAPM,UNRATE,T10Y2YM */
  var multiParam = qp.series || '';
  var singleParam = (qp.series_id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  var seriesList = multiParam
    ? multiParam.split(',').map(function(s) { return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }).filter(Boolean)
    : singleParam ? [singleParam] : [];

  if (!seriesList.length) {
    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'series or series_id required' }) };
  }

  if (seriesList.length > 12) {
    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'max 12 series per request' }) };
  }

  try {
    var results = await Promise.all(seriesList.map(async function(sid) {
      try {
        var data = await fetchUrl(fredUrl(sid, limit, apiKey));
        if (data.error_message) return { series_id: sid, error: data.error_message };
        return processSeries(data, sid);
      } catch(e) {
        return { series_id: sid, error: e.message };
      }
    }));

    /* Single-series response keeps old shape for backwards compat */
    if (seriesList.length === 1) {
      var r = results[0];
      if (r && r.error) return { statusCode: 404, headers: hdrs, body: JSON.stringify(r) };
      return { statusCode: 200, headers: hdrs, body: JSON.stringify(r) };
    }

    var out = {};
    results.forEach(function(r) { if (r) out[r.series_id] = r; });
    return { statusCode: 200, headers: hdrs, body: JSON.stringify({ series: out, updated: new Date().toISOString().slice(0, 10) }) };

  } catch(err) {
    return { statusCode: 502, headers: hdrs, body: JSON.stringify({ error: err.message }) };
  }
};
