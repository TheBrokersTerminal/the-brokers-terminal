/* ── WHISKY DATA — WhiskyStats API proxy ───────────────────────────
   Keeps the API key server-side. Routes:
   ?type=search&query=X&page=1
   ?type=full&id=WB208534&currency=GBP
   ?type=history&id=BG4591&currency=GBP
   ?type=credits
   ─────────────────────────────────────────────────────────────── */
const https = require('https');

const BASE = 'data.api.whiskystats.com';
const KEY  = process.env.WHISKYSTATS_API_KEY;

/* Per-type CDN cache durations (WhiskyStats T&Cs allow 30-day max) */
const CACHE = {
  search:  'public, max-age=3600,  s-maxage=3600,  stale-while-revalidate=300',   /* 1h  */
  browse:  'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',   /* 24h */
  market:  'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',   /* 24h */
  full:    'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',   /* 24h */
  history: 'public, max-age=604800,s-maxage=604800,stale-while-revalidate=86400',  /* 7d  */
  credits: 'private, no-store',
  default: 'public, max-age=3600,  s-maxage=3600',
};

function baseHdrs(type) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': CACHE[type] || CACHE.default,
  };
}

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
  if (!KEY) return { statusCode: 500, headers: baseHdrs('default'), body: JSON.stringify({ error: 'API key not configured' }) };

  var p    = event.queryStringParameters || {};
  var type = p.type || 'search';

  try {
    /* ── SEARCH ── */
    if (type === 'search') {
      var q    = encodeURIComponent(p.query || '');
      var page = parseInt(p.page || '1');
      if (!q) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'query required' }) };
      var res = await wsGet('/v01/whisky/bottle_search?query=' + q + '&page=' + page);
      return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
    }

    /* ── BROWSE — details + rating only (3 credits) ── */
    if (type === 'browse') {
      var id = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      var [details, rating] = await Promise.all([
        wsGet('/v01/whisky/bottle_details?whisky_id=' + id),
        wsGet('/v01/whisky/whiskybase_rating?whisky_id=' + id),
      ]);
      var bgId = (details.parent_bottle_group_id || id).replace(/[^A-Za-z0-9]/g, '');
      return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ details, rating, bg_id: bgId }) };
    }

    /* ── MARKET — auction + retail pricing (15 credits) ── */
    if (type === 'market') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      var [auction, retail] = await Promise.all([
        wsGet('/v01/whisky/auction_pricing?whisky_id=' + id + '&currency_code=' + cur),
        wsGet('/v01/whisky/retail_pricing?whisky_id='  + id + '&currency_code=' + cur),
      ]);
      return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ auction, retail, currency: cur }) };
    }

    /* ── FULL (legacy — details + pricing + rating) ── */
    if (type === 'full') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      var details = await wsGet('/v01/whisky/bottle_details?whisky_id=' + id);
      var bgId    = (details.parent_bottle_group_id || id).replace(/[^A-Za-z0-9]/g, '');
      var [auction, retail, rating] = await Promise.all([
        wsGet('/v01/whisky/auction_pricing?whisky_id='  + bgId + '&currency_code=' + cur),
        wsGet('/v01/whisky/retail_pricing?whisky_id='   + bgId + '&currency_code=' + cur),
        wsGet('/v01/whisky/whiskybase_rating?whisky_id=' + id),
      ]);
      return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ details, auction, retail, rating, currency: cur, bg_id: bgId }) };
    }

    /* ── AUCTION PRICE HISTORY ── */
    if (type === 'history') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      try {
        var res = await wsGet('/v01/whisky/auction_price_history?whisky_id=' + id + '&currency_code=' + cur);
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        /* Return empty rather than erroring — client caches this too so we don't retry */
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ prices: [] }) };
      }
    }

    /* ── CREDITS (never cached) ── */
    if (type === 'credits') {
      var res = await wsGet('/v01/utilities/credit_balance');
      return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
    }

    return { statusCode: 400, headers: baseHdrs('default'), body: JSON.stringify({ error: 'unknown type' }) };

  } catch (e) {
    return { statusCode: 502, headers: baseHdrs('default'), body: JSON.stringify({ error: e.message }) };
  }
};
