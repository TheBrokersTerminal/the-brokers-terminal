/* ── INTEL CACHE SEEDER — runs daily at 02:00 UTC ───────────────────────────
   Pre-warms the Supabase intelligence cache so every common search returns
   instantly from cache rather than hitting Claude on-demand.
   Each item calls search.js POST → Claude → Supabase upsert.
   ─────────────────────────────────────────────────────────────────────────── */

const SITE_URL = process.env.URL || 'https://thebrokersterminal.netlify.app';

/* ── SEED LIST ───────────────────────────────────────────────────────────── */
const COMPANIES = [
  /* UK Banks */
  { query: 'Barclays',          ticker: 'BARC',  type: 'company' },
  { query: 'HSBC',              ticker: 'HSBA',  type: 'company' },
  { query: 'Lloyds Banking',    ticker: 'LLOY',  type: 'company' },
  { query: 'NatWest Group',     ticker: 'NWG',   type: 'company' },
  { query: 'Standard Chartered',ticker: 'STAN',  type: 'company' },
  /* Central Banks */
  { query: 'Bank of England',   ticker: '',      type: 'company' },
  { query: 'Federal Reserve',   ticker: '',      type: 'company' },
  { query: 'European Central Bank', ticker: '',  type: 'company' },
  /* US Banks & Finance */
  { query: 'Goldman Sachs',     ticker: 'GS',    type: 'company' },
  { query: 'JP Morgan',         ticker: 'JPM',   type: 'company' },
  { query: 'Morgan Stanley',    ticker: 'MS',    type: 'company' },
  { query: 'BlackRock',         ticker: 'BLK',   type: 'company' },
  /* Spirits & Luxury */
  { query: 'Diageo',            ticker: 'DGE',   type: 'company' },
  { query: 'LVMH',              ticker: 'MC',    type: 'company' },
  { query: 'Pernod Ricard',     ticker: 'RI',    type: 'company' },
  /* Distilleries */
  { query: 'Macallan',          ticker: '',      type: 'company' },
  { query: 'Glenfarclas',       ticker: '',      type: 'company' },
  { query: 'Springbank',        ticker: '',      type: 'company' },
  { query: 'Ardbeg',            ticker: '',      type: 'company' },
  { query: 'Laphroaig',         ticker: '',      type: 'company' },
  { query: 'Bruichladdich',     ticker: '',      type: 'company' },
  { query: 'GlenDronach',       ticker: '',      type: 'company' },
  { query: 'Dalmore',           ticker: '',      type: 'company' },
  { query: 'Highland Park',     ticker: '',      type: 'company' },
  { query: 'Glenfiddich',       ticker: '',      type: 'company' },
  { query: 'Glenlivet',         ticker: '',      type: 'company' },
  { query: 'Bowmore',           ticker: '',      type: 'company' },
  { query: 'Talisker',          ticker: '',      type: 'company' },
  { query: 'Lagavulin',         ticker: '',      type: 'company' },
  { query: 'Bunnahabhain',      ticker: '',      type: 'company' },
  /* Commodities & Macro */
  { query: 'London Bullion Market Association', ticker: '', type: 'company' },
  { query: 'World Gold Council', ticker: '',    type: 'company' },
];

const CONCEPTS = [
  /* Macro */
  'Financial repression',
  'Monetary debasement',
  'Quantitative easing',
  'Quantitative tightening',
  'Yield curve inversion',
  'Stagflation',
  'Inflation',
  'Hyperinflation',
  'Deflation',
  'Interest rate cycle',
  'Debt supercycle',
  'Currency debasement',
  'Fiscal dominance',
  'Safe haven assets',
  'Portfolio diversification',
  /* Crises */
  '2008 financial crisis',
  '1970s stagflation',
  'Dot-com bubble',
  'COVID market crash 2020',
  'UK gilt crisis 2022',
  'Silicon Valley Bank collapse',
  /* UK Specific */
  'UK national debt',
  'UK gilt market',
  'Bank of England base rate',
  'UK inflation history',
  /* Physical Assets */
  'Alternative assets',
  'Whisky as investment',
  'Gold as investment',
  'Physical assets vs paper assets',
  'Illiquid assets',
  'Tangible assets',
  'Store of value',
  'Hard assets',
];

async function seedOne(payload, delay) {
  await new Promise(function (r) { setTimeout(r, delay); });
  try {
    const r = await fetch(SITE_URL + '/.netlify/functions/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const status = r.ok ? 'OK' : ('HTTP ' + r.status);
    console.log('[seed]', payload.type, payload.query, status);
    return status;
  } catch (e) {
    console.log('[seed] ERROR', payload.query, e.message);
    return 'ERROR';
  }
}

exports.handler = async function (event) {
  /* Allow manual trigger via GET for admin testing */
  const isManual = event && event.httpMethod === 'GET';

  console.log('[cache-seed] Starting. Manual:', isManual);

  const items = [
    ...COMPANIES.map(function (c) { return { query: c.query, ticker: c.ticker, type: 'company' }; }),
    ...CONCEPTS.map(function (c)  { return { query: c, type: 'concept' }; }),
  ];

  /* Stagger requests — 800ms apart to avoid Claude rate limits */
  var ok = 0, err = 0;
  for (var i = 0; i < items.length; i++) {
    var result = await seedOne(items[i], i === 0 ? 0 : 800);
    if (result === 'OK') ok++; else err++;
  }

  var summary = 'Seeded ' + ok + '/' + items.length + ' items. Errors: ' + err;
  console.log('[cache-seed]', summary);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: ok, errors: err, total: items.length, summary: summary }),
  };
};
