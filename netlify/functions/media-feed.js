/* media-feed.js — aggregates latest videos from financial news YouTube channels
   YouTube public RSS feeds require no API key:
   https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID */

const CHANNELS = [
  { tag:'BLOOMBERG', id:'UCIALMKvObZNtJ6AmdCLP7Lg', name:'Bloomberg' },
  { tag:'CNBC',      id:'UCrp_UI8XtuYfpiqAWD83uTg', name:'CNBC' },
];

function parseXml(xml) {
  const entries = [];
  const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  for (const m of entryMatches) {
    const entry = m[1];
    const getId    = (tag) => { const r = entry.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`)); return r ? r[1].trim() : ''; };
    const getAttr  = (tag, attr) => { const r = entry.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`)); return r ? r[1] : ''; };
    const getMedia = (tag) => { const r = entry.match(new RegExp(`<media:${tag}[^>]*>([\\s\\S]*?)<\\/media:${tag}>`)); return r ? r[1].trim() : ''; };
    const getMediaAttr = (tag, attr) => { const r = entry.match(new RegExp(`<media:${tag}[^>]*${attr}="([^"]*)"`)); return r ? r[1] : ''; };

    const vidId = getId('yt:videoId');
    if (!vidId) continue;

    entries.push({
      id:        vidId,
      title:     getId('title').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"'),
      published: getId('published'),
      thumb:     getMediaAttr('thumbnail', 'url') || `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg`,
      views:     getMedia('statistics') ? (getMediaAttr('statistics','views')||'0') : '0',
    });
  }
  return entries;
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    const results = await Promise.allSettled(
      CHANNELS.map(async ch => {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const videos = parseXml(xml).slice(0, 6);
        return videos.map(v => ({ ...v, tag: ch.tag, channel: ch.name }));
      })
    );

    const all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all.push(...r.value); });

    /* sort newest first */
    all.sort((a, b) => new Date(b.published) - new Date(a.published));

    return { statusCode: 200, headers, body: JSON.stringify({ videos: all }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message, videos: [] }) };
  }
};
