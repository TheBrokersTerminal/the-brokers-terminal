/* ── BROKERS INTELLIGENCE — SEARCH ENGINE ──────────────────────────────────
   Two modes:
   GET  ?q=query          → fast suggestions (Finnhub symbol search)
   POST { query, type }   → full detail via Claude (company or concept/event)
   ─────────────────────────────────────────────────────────────────────────── */

const FINNHUB_KEY = process.env.FINNHUB_KEY || 'da6p77hr01qqqkkgl7b0da6p77hr01qqqkkgl7bg';
const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function cacheGet(key) {
  if (!SUPABASE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/intelligence_cache?cache_key=eq.${encodeURIComponent(key)}&expires_at=gt.${new Date().toISOString()}&select=response&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = r.ok ? await r.json() : [];
    return rows.length ? rows[0].response : null;
  } catch { return null; }
}

async function cacheSet(key, response) {
  if (!SUPABASE_KEY) return;
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/intelligence_cache`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ cache_key: key, response, expires_at }),
    });
  } catch {}
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const SEARCH_SYSTEM = `You are The Brokers Edge Intelligence Engine. You produce professional, plain-English intelligence briefings for financial brokers and advisors who specialise in alternative and physical assets.

Your audience: brokers who need to quickly understand a company, institution, or historical financial event — and then explain it confidently to a client.

STYLE RULES:
- Plain English. No jargon without immediate explanation.
- Short punchy sentences. Active voice.
- Always connect to what it means for everyday savers and alternative asset investors.
- Use vivid analogies — but always pick one that fits the specific subject. Never default to the same analogy twice.
- Professional tone — like a senior analyst briefing a junior broker before a client call.
- Never scare clients. Always find the angle that educates and builds confidence.

CRITICAL RULE — HOW TO HANDLE BANKS AND FINANCIAL INSTITUTIONS:
This rule applies ONLY when the search subject itself is a bank, high-street lender, or mainstream financial institution (Barclays, HSBC, Lloyds, NatWest, Goldman Sachs, JPMorgan, etc.). Do NOT apply this rule to distilleries, whisky brands, commodities, or any other non-bank subject.

When the subject IS a bank: the brokerNote must NOT speak positively about them from the client's perspective. Banks are the contrast — the system the broker's clients are trying to diversify away from. Highlight:
- Banks offer savers poor returns while charging high fees and keeping the spread
- They act as intermediaries, taking a cut of every return generated on client deposits
- They have a long record of misconduct: LIBOR manipulation, PPI mis-selling, forex fixing, money laundering fines
- A savings account at a high-street bank is an unsecured loan to that bank, protected only up to £120,000 by FSCS (as of December 2025)
- Use the bank as a reason to diversify into tangible assets outside the banking system
Example for Barclays: "Barclays has paid over £10 billion in fines — LIBOR rigging, PPI mis-selling, forex fixing. Your client's savings account is an unsecured loan to this institution, protected only to £120,000. The case for holding assets outside that system is obvious."
Example for HSBC: "HSBC has paid billions in fines — money laundering penalties, forex misconduct. Your client's savings sit as an unsecured loan to a leveraged institution. Everything above £120,000 is exposed to the bank's solvency."
IMPORTANT: use only verified facts. Barclays: "over £10 billion" is documented. HSBC: "billions in fines" — do not claim a specific total.

When the subject is NOT a bank (a distillery, commodity, brand, market event): write a brokerNote that makes the positive case for that subject as an investment or conversation piece. Do not bring in bank comparisons unless they arise naturally and briefly.

CRITICAL RULE — ASSET NEUTRALITY IN PITCH SECTIONS:
The terminal is used by brokers selling DIFFERENT physical and alternative assets — some sell whisky, some sell gold, some sell commodities. In the brokerNote and pitch fields, NEVER name a specific asset (gold, whisky, silver, oil, platinum). Instead use: "physical assets", "tangible assets", "real assets", "alternative assets", "hard assets", or "assets outside the banking system." The broker will substitute their own product. Educational context fields (overview, relevance, keyFacts) may reference asset classes generally, but the brokerNote must always be asset-neutral so any broker can use it verbatim.

You must respond with valid JSON only — no markdown fences, no extra text.`;

const COMPANY_PROMPT = (query, profile) => `Research request: "${query}"
${profile ? `Finnhub profile data: ${JSON.stringify(profile)}` : ''}

Generate a company intelligence briefing. Return this exact JSON structure:
{
  "type": "company",
  "title": "Full company name",
  "ticker": "Ticker symbol or empty string if private",
  "exchange": "Exchange name or 'Private' if not listed",
  "category": "One of: distillery, spirits, commodities, precious metals, financial institution, central bank, private equity, regulator, other",
  "tagline": "One sentence — what this company does, written plainly",
  "overview": "2-3 sentences. What they do, who they are, why a broker should know them. No jargon.",
  "keyFacts": ["Fact 1 — a specific, useful number or fact", "Fact 2", "Fact 3", "Fact 4"],
  "relevance": "2-3 sentences. Why this company is relevant to alternative assets, physical investments, or the macro picture. Always find the angle that connects to tangible, real assets.",
  "brokerNote": "One paragraph. What a broker says to a client if this company comes up in conversation. STRICT RULE: do not mention gold, whisky, silver, oil or any specific asset by name. Use only: physical assets, tangible assets, real assets, alternative assets, or hard assets. The broker will insert their own product. Make it confidence-building — never alarming."
}`;

const CONCEPT_PROMPT = (query) => `Research request: "${query}"

IMPORTANT: First decide what this query is.

If the query is a COMPANY, BRAND, DISTILLERY, PERSON, or ORGANISATION (e.g. "Macallan", "Diageo", "Warren Buffett", "Bank of England"), treat it as a company/entity and return the COMPANY format below.

If the query is a FINANCIAL EVENT, ECONOMIC CONCEPT, HISTORICAL CRISIS, or MARKET PHENOMENON (e.g. "2008 financial crisis", "quantitative easing", "inflation", "yield curve"), return the CONCEPT format below.

COMPANY format:
{
  "type": "company",
  "title": "Full name",
  "ticker": "Ticker or empty string if private",
  "exchange": "Exchange or 'Private'",
  "category": "One of: distillery, spirits, commodities, precious metals, financial institution, central bank, private equity, regulator, other",
  "tagline": "One sentence — what they do",
  "overview": "2-3 sentences. What they do, who they are, why a broker should know them.",
  "keyFacts": ["Fact 1", "Fact 2", "Fact 3", "Fact 4"],
  "relevance": "2-3 sentences connecting to alternative/physical assets.",
  "brokerNote": "One paragraph. Asset-neutral pitch — never name specific assets."
}

CONCEPT format:
{
  "type": "concept",
  "title": "Proper name",
  "period": "Time period or 'Ongoing concept'",
  "tagline": "One sentence in plain English",
  "whatHappened": "3-4 sentences with one vivid analogy.",
  "causes": ["Cause 1", "Cause 2", "Cause 3"],
  "timeline": [{"date": "Year", "event": "One sentence"}],
  "impactOnAssets": "2-3 sentences on what went up and what went down.",
  "lessonForClients": "2-3 sentences. Frank, direct, asset-neutral.",
  "brokerNote": "One paragraph. Asset-neutral — never name specific assets."
}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  /* ── GET: fast suggestions ── */
  if (event.httpMethod === 'GET') {
    const q = (event.queryStringParameters || {}).q || '';
    if (!q || q.length < 2) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify([]) };
    }
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`,
        { headers: { 'User-Agent': 'TheBrokersTerminal/1.0' } }
      );
      const d = r.ok ? await r.json() : { result: [] };
      const companies = (d.result || []).slice(0, 6).map(item => ({
        type: 'company',
        label: item.description || item.symbol,
        ticker: item.symbol,
        exchange: item.type || '',
      }));
      /* Always offer a concept search option */
      const suggestions = [
        ...companies,
        { type: 'concept', label: `Search: "${q}"`, query: q },
      ];
      return {
        statusCode: 200,
        headers: { ...CORS, 'Cache-Control': 'public, max-age=30' },
        body: JSON.stringify(suggestions),
      };
    } catch (e) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify([{ type: 'concept', label: `Search: "${q}"`, query: q }]),
      };
    }
  }

  /* ── POST: full detail ── */
  if (event.httpMethod === 'POST') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'API not configured' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

    const { query, type, ticker } = body;
    if (!query) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'query required' }) };

    /* Cache key: company uses ticker, concept uses normalised query */
    const cacheKey = 'search:' + type + ':' + (ticker || query.trim().toLowerCase().slice(0, 80));

    const cached = await cacheGet(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' },
        body: JSON.stringify(cached),
      };
    }

    const userMsg = type === 'concept' ? CONCEPT_PROMPT(query) : COMPANY_PROMPT(query, null);

    try {
      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1300,
          system: SEARCH_SYSTEM,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });

      if (!claudeResp.ok) {
        return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Anthropic error' }) };
      }

      const data = await claudeResp.json();
      const text = data.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text);

      cacheSet(cacheKey, parsed); /* fire-and-forget */

      return {
        statusCode: 200,
        headers: { ...CORS, 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' },
        body: JSON.stringify(parsed),
      };
    } catch (e) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
