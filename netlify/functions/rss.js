const FEEDS = [
  /* General financial news */
  { url: 'https://feeds.reuters.com/reuters/businessNews',          source: 'Reuters' },
  { url: 'https://feeds.reuters.com/reuters/topNews',               source: 'Reuters' },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',  source: 'CNBC' },
  { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',   source: 'CNBC' },
  { url: 'https://feeds.marketwatch.com/marketwatch/realtimeheadlines', source: 'MarketWatch' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories',   source: 'MarketWatch' },
  { url: 'https://finance.yahoo.com/news/rssindex',                 source: 'Yahoo Finance' },
  { url: 'https://www.ft.com/rss/home/uk',                         source: 'Financial Times' },
  { url: 'https://www.investing.com/rss/news.rss',                  source: 'Investing.com' },
  { url: 'https://www.investing.com/rss/news_285.rss',              source: 'Investing.com' },
  { url: 'https://feeds.bloomberg.com/markets/news.rss',            source: 'Bloomberg' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069', source: 'CNBC' },
  /* Whisky & alternative assets */
  { url: 'https://www.whiskymag.com/feed/',                         source: 'Whisky Magazine' },
  { url: 'https://www.thespiritsbusiness.com/feed/',                source: 'The Spirits Business' },
  { url: 'https://www.decanter.com/feed/',                          source: 'Decanter' },
  { url: 'https://scotchwhisky.com/feed/',                          source: 'Scotch Whisky' },
];

function parseXML(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const x = r.exec(block);
      return x ? x[1].trim() : '';
    };
    const getLinkHref = () => {
      // Try <link> tag (may be text node or atom:link href)
      const atomLink = /<atom:link[^>]+href="([^"]+)"/i.exec(block);
      if (atomLink) return atomLink[1];
      const linkTag = /<link>([^<]+)<\/link>/i.exec(block);
      if (linkTag) return linkTag[1].trim();
      const linkCdata = /<link><!\[CDATA\[([^\]]+)\]\]><\/link>/i.exec(block);
      if (linkCdata) return linkCdata[1].trim();
      return '';
    };
    const title = get('title').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    const desc  = get('description').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
    const link  = getLinkHref() || get('guid');
    const pubDate = get('pubDate') || get('dc:date') || get('published');
    const ts = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000);
    if (title && title.length > 5) {
      items.push({ title, description: desc, url: link, datetime: ts });
    }
  }
  return items;
}

exports.handler = async () => {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(feed.url, {
          signal: ctrl.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheBrokersTerminal/1.0)' }
        });
        clearTimeout(t);
        if (!res.ok) return [];
        const text = await res.text();
        return parseXML(text).map(item => ({ ...item, source: feed.source }));
      } catch {
        clearTimeout(t);
        return [];
      }
    })
  );

  const seen = new Set();
  const stories = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const s of r.value) {
      const key = s.title.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      stories.push(s);
    }
  }

  stories.sort((a, b) => b.datetime - a.datetime);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
    body: JSON.stringify(stories.slice(0, 400)),
  };
};
