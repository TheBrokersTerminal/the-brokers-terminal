/* ── ECONOMIC CALENDAR PROXY ────────────────────────────────────────
   Primary: ForexFactory public calendar feed (free, no key required)
   Fetches current week + next week and normalises to a common schema.
   Fallback: FMP if FMP_API_KEY is present in env vars.
   ─────────────────────────────────────────────────────────────────── */

const https = require('https');

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'BrokersTerminal/1.0' } }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

/* Normalise ForexFactory item → internal event schema */
function normFF(item) {
  return {
    event:    item.title    || '',
    country:  item.country  || '',
    date:     item.date     || '',
    impact:   (item.impact || 'low').toLowerCase().replace('holiday', 'low'),
    actual:   item.actual   != null ? String(item.actual)   : '',
    estimate: item.forecast != null ? String(item.forecast) : '',
    previous: item.previous != null ? String(item.previous) : '',
    revised:  item.revised  != null ? String(item.revised)  : '',
    period:   item.period   || '',
    unit:     item.unit     || '',
  };
}

/* Normalise FMP item → internal event schema */
function normFMP(item) {
  return {
    event:    item.event   || '',
    country:  item.country || '',
    date:     item.date    || '',
    impact:   (item.impact || 'low').toLowerCase(),
    actual:   item.actual   != null ? String(item.actual)   : '',
    estimate: item.estimate != null ? String(item.estimate) : '',
    previous: item.previous != null ? String(item.previous) : '',
  };
}

exports.handler = async function (event) {
  var hdrs = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=1800',
    'Access-Control-Allow-Origin': '*',
  };

  /* ── Try ForexFactory first (always available, no key) ── */
  try {
    var results = await Promise.allSettled([
      fetchJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json?version=1'),
      fetchJson('https://nfs.faireconomy.media/ff_calendar_nextweek.json?version=1'),
    ]);

    var combined = [];
    results.forEach(function (r) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        r.value.forEach(function (item) { combined.push(normFF(item)); });
      }
    });

    if (combined.length) {
      /* Filter to UK + US events and High/Medium impact only, sort by date */
      var relevant = combined
        .filter(function (e) {
          var c = (e.country || '').toUpperCase();
          var imp = e.impact;
          return (c === 'USD' || c === 'GBP' || c === 'EUR') && (imp === 'high' || imp === 'medium');
        })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

      /* If no relevant events fall through, show everything */
      if (!relevant.length) relevant = combined.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

      return { statusCode: 200, headers: hdrs, body: JSON.stringify(relevant) };
    }
  } catch (ffErr) {
    /* ForexFactory failed — fall through to FMP */
  }

  /* ── Fallback: FMP if key is present ── */
  var fmpKey = process.env.FMP_API_KEY;
  if (fmpKey) {
    var from = todayStr();
    var to   = daysAhead(14);
    var url  = 'https://financialmodelingprep.com/api/v3/economic_calendar?from=' + from + '&to=' + to + '&apikey=' + fmpKey;
    try {
      var fmpData = await fetchJson(url);
      var events  = (Array.isArray(fmpData) ? fmpData : []).map(normFMP);
      return { statusCode: 200, headers: hdrs, body: JSON.stringify(events) };
    } catch (fmpErr) {
      return { statusCode: 502, headers: hdrs, body: JSON.stringify({ error: String(fmpErr) }) };
    }
  }

  return { statusCode: 503, headers: hdrs, body: JSON.stringify({ error: 'No calendar data source available' }) };
};

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAhead(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
