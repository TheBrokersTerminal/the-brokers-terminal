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
  search:  'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',  /* 7d */
  browse:  'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',  /* 7d */
  market:  'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',  /* 7d */
  full:    'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',  /* 7d */
  history:        'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400', /* 7d */
  retail_history: 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400', /* 7d */
  indices:        'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400', /* 7d */
  index_history:  'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400', /* 7d */
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
        wsGet('/v01/whisky/auction_pricing?whisky_id=' + id + '&currency_code=' + cur + '&bottle_group_fallback=true'),
        wsGet('/v01/whisky/retail_pricing?whisky_id='  + id + '&currency_code=' + cur + '&bottle_group_fallback=true'),
      ]);
      return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ auction, retail, currency: cur }) };
    }

    /* ── AUCTION LISTINGS — live lots (7 credits) ── */
    if (type === 'auction_listings') {
      var id = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      try {
        var res = await wsGet('/v01/whisky/auction_listings?whisky_id=' + id + '&bottle_group_fallback=true');
        if (res && res.status === 404) return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ listings: [] }) };
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ listings: [] }) };
      }
    }

    /* ── RETAIL LISTINGS — shop offers (7 credits) ── */
    if (type === 'retail_listings') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      try {
        var res = await wsGet('/v01/whisky/retail_listings?whisky_id=' + id + '&currency_code=' + cur + '&bottle_group_fallback=true');
        if (res && res.status === 404) return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ listings: [] }) };
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ listings: [] }) };
      }
    }

    /* ── FULL (legacy — details + pricing + rating) ── */
    if (type === 'full') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      var details = await wsGet('/v01/whisky/bottle_details?whisky_id=' + id);
      var bgId    = (details.parent_bottle_group_id || id).replace(/[^A-Za-z0-9]/g, '');
      var [auction, retail, rating] = await Promise.all([
        wsGet('/v01/whisky/auction_pricing?whisky_id='  + bgId + '&currency_code=' + cur + '&bottle_group_fallback=true'),
        wsGet('/v01/whisky/retail_pricing?whisky_id='   + bgId + '&currency_code=' + cur + '&bottle_group_fallback=true'),
        wsGet('/v01/whisky/whiskybase_rating?whisky_id=' + id + '&bottle_group_fallback=true'),
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
        /* WhiskyStats returns a JSON 404 object when endpoint unavailable */
        if (res && res.status === 404) return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
      }
    }

    /* ── RETAIL PRICE HISTORY ── */
    if (type === 'retail_history') {
      var id  = (p.id || '').replace(/[^A-Za-z0-9]/g, '');
      var cur = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      if (!id) return { statusCode: 400, headers: baseHdrs(type), body: JSON.stringify({ error: 'id required' }) };
      try {
        var res = await wsGet('/v01/whisky/retail_price_history?whisky_id=' + id + '&currency_code=' + cur);
        if (res && res.status === 404) return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
      }
    }

    /* ── REGION INDICES — overview table ── */
    if (type === 'indices') {
      try {
        /* Try both likely endpoint names */
        var res = await wsGet('/v01/index/region_indices').catch(function(){ return null; });
        if (!res || res.status === 404) res = await wsGet('/v01/index/region_index').catch(function(){ return null; });
        if (!res || res.status === 404) return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true, _tried: 'region_indices,region_index' }) };
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
      }
    }

    /* ── INDEX HISTORY — time-series for one region or global index ── */
    if (type === 'index_history') {
      var region = (p.region || '').replace(/[^A-Za-z0-9_\-]/g, '');
      var cur    = (p.currency || 'GBP').replace(/[^A-Z]/g, '').slice(0, 3);
      try {
        var path = region
          ? '/v01/index/region_index_history?region=' + encodeURIComponent(region) + '&currency_code=' + cur
          : '/v01/index/whisky_index_history?currency_code=' + cur;
        var res = await wsGet(path).catch(function(){ return null; });
        /* Some APIs don't take currency on index endpoints — retry without */
        if (!res || res.status === 404) {
          var path2 = region
            ? '/v01/index/region_index_history?region=' + encodeURIComponent(region)
            : '/v01/index/whisky_index_history';
          res = await wsGet(path2).catch(function(){ return null; });
        }
        if (!res || res.status === 404) return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
      }
    }

    /* ── INDEX WHISKIES — bottles that make up an index ── */
    if (type === 'index_whiskies') {
      var region = (p.region || '').replace(/[^A-Za-z0-9_\-]/g, '');
      try {
        var path = region
          ? '/v01/index/index_whiskies?region=' + encodeURIComponent(region)
          : '/v01/index/index_whiskies';
        var res = await wsGet(path).catch(function(){ return null; });
        if (!res || res.status === 404) return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: baseHdrs(type), body: JSON.stringify({ _tbt_empty: true }) };
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
