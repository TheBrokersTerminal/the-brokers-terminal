/* ── WHISKY DATA — WhiskyStats API proxy ───────────────────────────
   Keeps the API key server-side. Routes:
   ?type=search&query=X&page=1
   ?type=details&id=WB208534
   ?type=pricing&id=BG4591&currency=GBP
   ?type=rating&id=WB208534
   ?type=full&id=WB208534&currency=GBP   (details + pricing + rating in one)
   ?type=credits
   ─────────────────────────────────────────────────────────────── */
const https = require('https');

const BASE = 'data.api.whiskystats.com';
const KEY  = process.env.WHISKYSTATS_API_KEY;

const hdrs = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
};

function wsGet(path) {
  return new Promise(function (resolve, reject) {
    var opts = {
      hostname: BASE,
      path: path,
      headers: { Authorization: 'Bearer ' + KEY },
      timeout: 8000,
    };
    https.get(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('parse: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function () { reject(new Error('timeout')); });
  });
}

exports.handler = async function (event) {
  if (!KEY) return { statusCode: 500, headers: hdrs, body: JSON.stringify({ error: 'API key not configured' }) };

  var p   = event.queryStringParameters || {};
  var type = p.type || 'search';

  try {
    /* ── SEARCH ── */
    if (type === 'search') {
      var q    = encodeURIComponent(p.query || '');
      var page = parseInt(p.page || '1');
      if (!q) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'query required' }) };
      var res = await wsGet('/v01/whisky/bottle_search?query=' + q + '&page=' + page);
      return { statusCode: 200, headers: hdrs, body: JSON.stringify(res) };
    }

    /* ── BOTTLE DETAILS ── */
    if (type === 'details') {
      var id = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      if (!id) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'id required' }) };
      var res = await wsGet('/v01/whisky/bottle_details?whisky_id=' + id);
      return { statusCode: 200, headers: hdrs, body: JSON.stringify(res) };
    }

    /* ── AUCTION + RETAIL PRICING ── */
    if (type === 'pricing') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'id required' }) };
      var [auction, retail] = await Promise.all([
        wsGet('/v01/whisky/auction_pricing?whisky_id=' + id + '&currency_code=' + cur),
        wsGet('/v01/whisky/retail_pricing?whisky_id='  + id + '&currency_code=' + cur),
      ]);
      return { statusCode: 200, headers: hdrs, body: JSON.stringify({ auction, retail }) };
    }

    /* ── RATING ── */
    if (type === 'rating') {
      var id = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      if (!id) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'id required' }) };
      var res = await wsGet('/v01/whisky/whiskybase_rating?whisky_id=' + id);
      return { statusCode: 200, headers: hdrs, body: JSON.stringify(res) };
    }

    /* ── FULL (details + pricing + rating) ── */
    if (type === 'full') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'id required' }) };

      var details = await wsGet('/v01/whisky/bottle_details?whisky_id=' + id);
      /* Use BG (bottle group) ID for pricing if available */
      var bgId = (details.parent_bottle_group_id || id).replace(/[^A-Za-z0-9]/g, '');

      var [auction, retail, rating] = await Promise.all([
        wsGet('/v01/whisky/auction_pricing?whisky_id='  + bgId + '&currency_code=' + cur),
        wsGet('/v01/whisky/retail_pricing?whisky_id='   + bgId + '&currency_code=' + cur),
        wsGet('/v01/whisky/whiskybase_rating?whisky_id=' + id),
      ]);

      return {
        statusCode: 200,
        headers: hdrs,
        body: JSON.stringify({ details, auction, retail, rating, currency: cur }),
      };
    }

    /* ── AUCTION PRICE HISTORY ── */
    if (type === 'history') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'id required' }) };
      /* Try BG_ ID first for history; fall back gracefully */
      try {
        var res = await wsGet('/v01/whisky/auction_price_history?whisky_id=' + id + '&currency_code=' + cur);
        return { statusCode: 200, headers: hdrs, body: JSON.stringify(res) };
      } catch(e) {
        return { statusCode: 200, headers: hdrs, body: JSON.stringify({ prices: [], error: e.message }) };
      }
    }

    /* ── CREDITS ── */
    if (type === 'credits') {
      var res = await wsGet('/v01/utilities/credit_balance');
      return { statusCode: 200, headers: hdrs, body: JSON.stringify(res) };
    }

    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'unknown type' }) };

  } catch (e) {
    return { statusCode: 502, headers: hdrs, body: JSON.stringify({ error: e.message }) };
  }
};
