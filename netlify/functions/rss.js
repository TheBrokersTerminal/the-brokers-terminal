/* Only feeds confirmed accessible from cloud/server IPs */
const FEEDS = [
  /* Financial wire & broadcast */
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',                       source: 'BBC Business' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',            source: 'NY Times' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml',             source: 'NY Times' },
  { url: 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml',                      source: 'Wall St Journal' },
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',                        source: 'Wall St Journal' },
  { url: 'https://www.theguardian.com/business/rss',                              source: 'The Guardian' },
  { url: 'https://www.theguardian.com/business/economics/rss',                    source: 'The Guardian' },
  { url: 'https://feeds.skynews.com/feeds/rss/business.xml',                      source: 'Sky News' },
  { url: 'https://www.independent.co.uk/topic/business/rss',                      source: 'The Independent' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',    source: 'MarketWatch' },
  /* Gold & commodities */
  { url: 'https://www.gold.org/research/rss.xml',                                 source: 'World Gold Council' },
  { url: 'https://www.mining.com/feed/',                                           source: 'Mining.com' },
  /* Whisky & spirits */
  { url: 'https://www.decanter.com/feed/',                                         source: 'Decanter' },
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
  /* Hard 8-second ceiling — whichever settles first wins */
  const timeout = new Promise(resolve => setTimeout(() => resolve([]), 8000));

  const fetchAll = Promise.allSettled(
    FEEDS.map(async (feed) => {
      const ctrl = new AbortController();
      /* Keep abort alive through body read — don't clearTimeout early */
      const t = setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(feed.url, {
          signal: ctrl.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheBrokersTerminal/1.0; +https://thebrokersterminal.com)' }
        });
        if (!res.ok) { clearTimeout(t); return []; }
        const text = await res.text();
        clearTimeout(t);
        return parseXML(text).map(item => ({ ...item, source: feed.source }));
      } catch {
        clearTimeout(t);
        return [];
      }
    })
  );

  const settled = await Promise.race([fetchAll, timeout]);

  const seen = new Set();
  const stories = [];
  for (const r of (Array.isArray(settled) ? settled : [])) {
    if (!r || r.status !== 'fulfilled') continue;
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
      'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=60',
    },
    body: JSON.stringify(stories.slice(0, 300)),
  };
};
