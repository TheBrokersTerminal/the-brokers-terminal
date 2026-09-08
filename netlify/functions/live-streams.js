/* live-streams.js — resolves current YouTube live video IDs for each channel
   Fetches channel/live page server-side to avoid CORS, parses canonical video ID */

const CHANNELS = [
  { key:'sky',      id:'UCoMdktPbSTixAyNGwb-UYkQ',  name:'Sky News' },
  { key:'bbc',      id:'UCknLrEdhRCp1aegoMqRaCZg',  name:'BBC World Service' },
  { key:'netflix',  id:'UCvJJ_dzjViJCoLf5uKUTwoA',  name:'Netflix' },
  { key:'cnbc',     id:'UCrp_UI8XtuYfpiqAWD83uTg',  name:'CNBC' },
];

async function resolveVideoId(channelId) {
  const url = `https://www.youtube.com/channel/${channelId}/live`;
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(9000),
  });
  const html = await res.text();

  /* 1. canonical link tag — most reliable */
  const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
  if (canonical) return canonical[1];

  /* 2. og:url meta tag */
  const og = html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
  if (og) return og[1];

  /* 3. ytInitialData videoId in JSON */
  const json = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  if (json) return json[1];

  return null;
}

exports.handler = async function() {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  const results = await Promise.allSettled(
    CHANNELS.map(async ch => ({ key: ch.key, videoId: await resolveVideoId(ch.id) }))
  );

  const out = {};
  results.forEach(r => {
    if (r.status === 'fulfilled') out[r.value.key] = r.value.videoId;
  });

  return { statusCode: 200, headers, body: JSON.stringify(out) };
};
