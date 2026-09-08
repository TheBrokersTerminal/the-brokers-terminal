/* ── DISTILLERY PRICES — WhiskyStats auction avg per origin ─────────
   Searches WhiskyStats for each top distillery per origin,
   computes the median GBP auction price from current search results.

   Route: GET /distillery-prices?origin=scotland|japan|usa|ireland

   Credit cost: 1 per distillery search. CDN-cached 7 days.
   Scotland 9 distilleries, Japan 8, USA 8, Ireland 7 = 32 credits
   per origin group per 7-day cache period (~130 credits/month total).
   ──────────────────────────────────────────────────────────────── */
var https = require('https');

var BASE = 'data.api.whiskystats.com';
var KEY  = process.env.WHISKYSTATS_API_KEY;

var CACHE_HDR = 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400'; /* 7d */

var ORIGINS = {
  scotland: [
    {name:'Macallan',       region:'Speyside',    q:'Macallan'},
    {name:'Springbank',     region:'Campbeltown', q:'Springbank'},
    {name:'Dalmore',        region:'Highlands',   q:'Dalmore'},
    {name:'Ardbeg',         region:'Islay',       q:'Ardbeg'},
    {name:'Glendronach',    region:'Highlands',   q:'Glendronach'},
    {name:'Highland Park',  region:'Islands',     q:'Highland Park'},
    {name:'Lagavulin',      region:'Islay',       q:'Lagavulin'},
    {name:'Glenfarclas',    region:'Speyside',    q:'Glenfarclas'},
    {name:'Talisker',       region:'Islands',     q:'Talisker'},
  ],
  japan: [
    {name:'Chichibu',      region:'Saitama',   q:'Chichibu'},
    {name:'Yamazaki',      region:'Osaka',     q:'Yamazaki'},
    {name:'Hakushu',       region:'Yamanashi', q:'Hakushu'},
    {name:'Akkeshi',       region:'Hokkaido',  q:'Akkeshi'},
    {name:'Hibiki',        region:'Osaka',     q:'Hibiki'},
    {name:'Nikka Yoichi',  region:'Hokkaido',  q:'Nikka Yoichi'},
    {name:'Miyagikyo',     region:'Miyagi',    q:'Miyagikyo'},
    {name:'Fuji',          region:'Shizuoka',  q:'Fuji whisky'},
  ],
  usa: [
    {name:'Pappy Van Winkle', region:'Kentucky', q:'Pappy Van Winkle'},
    {name:'Wm Larue Weller',  region:'Kentucky', q:'William Larue Weller'},
    {name:'George T Stagg',   region:'Kentucky', q:'George T Stagg'},
    {name:'Eagle Rare 17yr',  region:'Kentucky', q:'Eagle Rare 17'},
    {name:'Blantons',         region:'Kentucky', q:'Blanton'},
    {name:'Four Roses Ltd',   region:'Kentucky', q:'Four Roses Limited'},
    {name:'Buffalo Trace',    region:'Kentucky', q:'Buffalo Trace'},
    {name:'Woodford Reserve', region:'Kentucky', q:'Woodford Reserve'},
  ],
  ireland: [
    {name:'Midleton',     region:'Cork',      q:'Midleton'},
    {name:'Redbreast',    region:'Cork',      q:'Redbreast'},
    {name:'Teeling',      region:'Dublin',    q:'Teeling'},
    {name:'Dingle',       region:'Kerry',     q:'Dingle whiskey'},
    {name:'Waterford',    region:'Waterford', q:'Waterford whisky'},
    {name:'Powers',       region:'Cork',      q:'Powers whiskey'},
    {name:'Green Spot',   region:'Cork',      q:'Green Spot'},
  ],
};

function wsSearch(q) {
  return new Promise(function(resolve, reject) {
    var path = '/v01/whisky/bottle_search?query=' + encodeURIComponent(q) + '&page=1';
    var opts = {
      hostname: BASE,
      path: path,
      headers: { Authorization: 'Bearer ' + KEY },
      timeout: 8000,
    };
    https.get(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('parse: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function() { reject(new Error('timeout')); });
  });
}

function median(arr) {
  if (!arr.length) return null;
  arr.sort(function(a, b) { return a - b; });
  var mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? Math.round((arr[mid - 1] + arr[mid]) / 2) : arr[mid];
}

function extractPrice(item) {
  /* WhiskyStats search results may use various price field names */
  var raw = item.auction_price_gbp || item.auction_price || item.price_gbp
         || item.price || item.avg_price || item.current_price || null;
  if (raw == null) return null;
  var n = parseFloat(raw);
  return (isFinite(n) && n > 5) ? Math.round(n) : null; /* skip suspiciously low values */
}

exports.handler = async function(event) {
  if (!KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'API key not configured' }),
    };
  }

  var hdrs = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': CACHE_HDR,
  };

  var p = event.queryStringParameters || {};
  var originKey = (p.origin || 'scotland').toLowerCase().replace(/[^a-z]/g, '');
  var distList  = ORIGINS[originKey];

  if (!distList) {
    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'unknown origin: ' + originKey }) };
  }

  /* Check credits first with a single probe search */
  var probe;
  try { probe = await wsSearch(distList[0].q); } catch(e) { probe = {}; }
  if (probe && probe.error && /quota|credit|limit/i.test(String(probe.error) + String(probe.message || ''))) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, no-store' },
      body: JSON.stringify({ error: 'WhiskyStats quota exceeded', message: probe.message || '', origin: originKey }),
    };
  }

  /* Extract prices from the probe result for the first distillery */
  var probeItems = probe.results || probe.data || [];
  var probePrices = [];
  probeItems.forEach(function(item) { var pr = extractPrice(item); if (pr !== null) probePrices.push(pr); });

  var results = await Promise.allSettled(
    distList.map(async function(d, i) {
      try {
        /* Reuse probe result for the first distillery */
        var items = i === 0 ? probeItems : (await wsSearch(d.q)).results || (await wsSearch(d.q)).data || [];
        var prices = i === 0 ? probePrices : [];
        if (i > 0) {
          var res = await wsSearch(d.q);
          items = res.results || res.data || [];
          items.forEach(function(item) { var pr = extractPrice(item); if (pr !== null) prices.push(pr); });
        }
        var med = median(prices);
        return {
          name:    d.name,
          region:  d.region,
          avg:     med,
          samples: prices.length,
          source:  'WhiskyStats',
        };
      } catch(e) {
        return { name: d.name, region: d.region, avg: null, samples: 0, source: 'error' };
      }
    })
  );

  var distilleries = results.map(function(r, i) {
    return r.status === 'fulfilled' ? r.value
         : { name: distList[i].name, region: distList[i].region, avg: null, samples: 0, source: 'error' };
  });

  return {
    statusCode: 200,
    headers: hdrs,
    body: JSON.stringify({
      origin:       originKey,
      distilleries: distilleries,
      updatedAt:    new Date().toISOString().slice(0, 10),
      source:       'WhiskyStats API',
    }),
  };
};
