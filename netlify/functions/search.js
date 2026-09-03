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

const SEARCH_SYSTEM = `You are The Brokers Edge Intelligence Engine. You brief alternative asset brokers with analyst-grade intelligence and a full sales pitch playbook for every search.

STYLE: Plain English. Short punchy sentences. Active voice. Tone: senior analyst briefing a sharp junior broker 10 minutes before a client call. Never alarm — educate then empower.

SALES FRAMEWORK (apply to every pitch playbook):
- THREE TENS: Build logical certainty first (facts/numbers), emotional certainty second (future pace — paint their life once the decision is made), broker trust third (demonstrated through insight the client did not have before).
- SPIN: Situation > Problem > Implication > Need-Payoff. Brokers ask before they tell. The Need-Payoff question lets the client articulate the benefit themselves.
- CIALDINI: Social proof (smart money already does this), real scarcity/timing (never manufactured), authority (verified data), reciprocity (give insight first).
- OBJECTIONS: Three-part loop — acknowledge genuinely, reframe as evidence for action, close with a need-payoff question.
- URGENCY: One legitimate reason why now beats later. Never fabricated.

BANK RULE (ONLY for banks/lenders — Barclays, HSBC, Lloyds, JPMorgan, etc.):
The pitch angle is PROFIT EXTRACTION — not "banks might fail." Key facts:
- Fractional reserve banking: the bank immediately lends out most of your deposit and earns on YOUR capital. You get a fraction back as interest.
- ESLR leverage: UK banks hold roughly 3.25% Tier 1 capital against total exposures — about £30 deployed for every £1 held. Your deposit is raw material for a leveraged profit machine.
- The yield gap: banks pay savers 1-3%, charge mortgage borrowers 4-7%. They keep the spread. The depositor is the silent investor earning the worst return in the room.
- Real return: after income tax (20-40%) and UK CPI inflation (2-5%), most easy-access accounts deliver a negative real return. The bank profits. The saver loses purchasing power.
- Misconduct: PPI mis-selling cost the UK banking industry £38bn. LIBOR rigging, forex manipulation, money laundering fines — all documented facts.
- Bonus culture (all staff, not just CEOs): the banker bonus cap was removed in October 2023. Traders, relationship managers, dealmakers all earn bonuses by deploying client capital at higher rates than they pay for it. Banks never invest their own institutional capital into their own savings products — they use markets, bonds, equity. Their clients get the cash ISA. Their staff get the performance bonus.
- FSCS: £120,000 per person per authorised institution. Joint accounts: £240,000. Temporary high balance: £1M for 6 months. Beyond this, the depositor is an unsecured creditor.
- Tone: educational, not alarmist. Help the client understand the deal they signed up for.
When subject is NOT a bank: make the positive case. No unprompted bank comparisons.

ASSET NEUTRALITY: In ALL pitch fields NEVER name a specific asset. Use "physical assets", "tangible assets", "real assets", "alternative assets", "hard assets", "assets outside the banking system." Educational fields (overview, keyFacts, relevance) may name asset classes generally.

Respond with valid JSON only — no markdown fences, no extra text. CRITICAL: never use double-quote characters inside string values — use single quotes or rephrase instead.`;

/* ── SECTION-SPECIFIC PROMPTS (faster, focused) ── */

const OVERVIEW_PROMPT = (query, profile) => `Research request: "${query}"
${profile ? `Finnhub profile data: ${JSON.stringify(profile)}` : ''}

Generate a company overview briefing ONLY — no pitch playbook. Return this exact JSON:
{
  "type": "company",
  "title": "Full company name",
  "ticker": "Ticker symbol or empty string if private",
  "exchange": "Exchange name or 'Private' if not listed",
  "category": "One of: distillery, spirits, commodities, precious metals, financial institution, central bank, private equity, regulator, other",
  "tagline": "One sentence — what this company does, in plain English a non-expert understands instantly",
  "overview": "2-3 sentences. Who they are, what they do, why a broker should care. No jargon.",
  "keyFacts": ["Specific number or verified data point", "Fact 2", "Fact 3", "Fact 4"],
  "relevance": "2-3 sentences. The angle connecting this company to physical assets, wealth protection, or macro forces.",
  "brokerNote": "One paragraph. What the broker says if this subject comes up naturally. Asset-neutral, plain English, confident."
}`;

const PITCH_PROMPT = (query) => `Generate ONLY the sales pitch playbook for "${query}". Return this exact JSON:
{
  "type": "company",
  "title": "${query.replace(/"/g, "'")}",
  "pitch": {
    "openingLine": "The exact first sentence to open with a client. One punchy attention-grabbing line. A question or provocative statement — not a pitch. Asset-neutral.",
    "logicalCase": ["Most compelling fact — specific, verified, simple", "Second pillar — different angle", "Logical conclusion for their wealth"],
    "emotionalCase": "Future pace in 2 sentences. Their worry gone. The outcome they want, achieved. Asset-neutral.",
    "painPoint": "The one precise fear this client has right now. One sentence. Be specific.",
    "spinQuestions": [
      "Situation — where is their money now and how do they feel about it",
      "Problem/Implication — the cost of doing nothing",
      "Need-Payoff — lets them articulate the benefit themselves. Starts with 'So if you had...' or 'What would it mean if...'"
    ],
    "objections": [
      {"objection": "Most common first objection", "rebuttal": "Acknowledge genuinely, reframe as evidence for action, close with need-payoff question. Conversational, not scripted."},
      {"objection": "Second objection", "rebuttal": "Same three-part structure. Different angle. Asset-neutral."}
    ],
    "urgencyLine": "One real, verifiable reason why acting now is smarter than waiting. Never manufactured.",
    "socialProof": "One sentence. What sophisticated or institutional money is doing relative to this subject."
  }
}`;

const COMPANY_PROMPT = (query, profile) => `Research request: "${query}"
${profile ? `Finnhub profile data: ${JSON.stringify(profile)}` : ''}

Generate a full company intelligence briefing AND sales pitch playbook. Return this exact JSON:
{
  "type": "company",
  "title": "Full company name",
  "ticker": "Ticker symbol or empty string if private",
  "exchange": "Exchange name or 'Private' if not listed",
  "category": "One of: distillery, spirits, commodities, precious metals, financial institution, central bank, private equity, regulator, other",
  "tagline": "One sentence — what this company does, in plain English a non-expert understands instantly",
  "overview": "2-3 sentences. Who they are, what they do, why a broker should care. No jargon — explain it like you would to a smart friend who doesn't work in finance.",
  "keyFacts": ["Fact 1 — specific number or verified data point", "Fact 2", "Fact 3", "Fact 4"],
  "relevance": "2-3 sentences. The angle that connects this company to physical assets, wealth protection, or macro forces. Always find the real-assets connection.",
  "brokerNote": "One paragraph. What the broker says if this subject comes up naturally in conversation. Asset-neutral — never name a specific asset. Plain English. Confident, not pushy.",
  "pitch": {
    "openingLine": "The exact first sentence to open this conversation with a client. One punchy, attention-grabbing line that makes them want to hear more. Asset-neutral. Written as a question or provocative statement — not a pitch.",
    "logicalCase": ["Bullet 1: the single most compelling fact or number. Specific, verified, devastating in its simplicity.", "Bullet 2: second pillar of the logical argument. A different angle — regulation, track record, structural reality.", "Bullet 3: the logical conclusion. What this means for the client's wealth specifically."],
    "emotionalCase": "Future pacing — paint the picture of their life once this decision is made. 2 sentences. Their specific worry gone. The outcome they actually want, achieved. Write it so they can see it. Asset-neutral.",
    "painPoint": "The one fear or frustration this type of client most likely has RIGHT NOW, in one plain-English sentence. Be precise — not generic. What is actually keeping them up at night?",
    "spinQuestions": [
      "Situation question — establishes where their money is now and how they feel about it",
      "Problem/Implication question — surfaces the specific cost of their current situation doing nothing",
      "Need-Payoff question — lets them articulate the benefit themselves. Starts with 'So if you had...' or 'What would it mean if...'"
    ],
    "objections": [
      {"objection": "Most common first objection for this specific subject", "rebuttal": "Three-part response: (1) acknowledge genuinely — one sentence, (2) reframe the objection as evidence for the decision — one or two sentences, (3) loop back with a need-payoff question — one sentence. Conversational, not scripted."},
      {"objection": "Second most common objection", "rebuttal": "Same three-part structure. Different angle. Asset-neutral."}
    ],
    "urgencyLine": "One sentence. A real, legitimate, verifiable reason why acting now is smarter than waiting. Rate cycles, timing windows, structural shifts. Never manufactured. If no genuine urgency exists, say what changes the picture.",
    "socialProof": "One sentence. How sophisticated investors, family offices, or institutional allocators are positioned relative to this subject. Grounds the conversation in what smart money is doing."
  }
}`;

const CONCEPT_PROMPT = (query) => `Research request: "${query}"

IMPORTANT: First decide what this query is. Then return the correct format.

If the query is a COMPANY, BRAND, DISTILLERY, PERSON, or ORGANISATION → return COMPANY format.
If the query is a FINANCIAL EVENT, ECONOMIC CONCEPT, CRISIS, or MARKET PHENOMENON → return CONCEPT format.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPANY FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "type": "company",
  "title": "Full name",
  "ticker": "Ticker or empty string",
  "exchange": "Exchange or 'Private'",
  "category": "One of: distillery, spirits, commodities, precious metals, financial institution, central bank, private equity, regulator, other",
  "tagline": "One sentence — what they do in plain English",
  "overview": "2-3 sentences. Who they are, what they do, why a broker should care. No jargon.",
  "keyFacts": ["Specific fact with number", "Fact 2", "Fact 3", "Fact 4"],
  "relevance": "2-3 sentences. The real-assets connection — always find the angle.",
  "brokerNote": "One paragraph. What to say if this comes up in conversation. Asset-neutral, plain English.",
  "pitch": {
    "openingLine": "The exact first sentence to open this conversation. A question or provocative statement — not a pitch. Makes them want to hear more. Asset-neutral.",
    "logicalCase": ["Most compelling fact — specific, verified, simple", "Second pillar — different angle", "The logical conclusion for their wealth"],
    "emotionalCase": "Future pace in 2 sentences. Their worry gone. The outcome they want, achieved. Asset-neutral.",
    "painPoint": "The one precise fear this type of client has right now. One sentence. Be specific.",
    "spinQuestions": [
      "Situation — where is their money now and how do they feel about it",
      "Problem/Implication — the cost of their current situation doing nothing",
      "Need-Payoff — lets them articulate the benefit. Starts with 'So if you had...' or 'What would it mean if...'"
    ],
    "objections": [
      {"objection": "Most common first objection", "rebuttal": "Acknowledge → reframe → need-payoff question. Conversational, not scripted."},
      {"objection": "Second objection", "rebuttal": "Same structure, different angle. Asset-neutral."}
    ],
    "urgencyLine": "One real, verifiable reason why now beats later. Never manufactured.",
    "socialProof": "One sentence. What sophisticated or institutional money is doing relative to this subject."
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONCEPT FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "type": "concept",
  "title": "Proper name",
  "period": "Time period or 'Ongoing concept'",
  "tagline": "One sentence — the plain-English version of what this is",
  "whatHappened": "3-4 sentences explaining the event or concept using one vivid, subject-specific analogy. Never reuse a standard finance analogy.",
  "causes": ["Root cause 1 — specific", "Cause 2", "Cause 3"],
  "timeline": [{"date": "Year or month", "event": "One sentence — what happened and why it mattered"}],
  "impactOnAssets": "2-3 sentences. What went up, what went down, why. Asset-neutral in the implication.",
  "lessonForClients": "2-3 sentences. The frank, honest lesson. What a well-advised client would have done differently.",
  "brokerNote": "One paragraph. Asset-neutral. What the broker says to connect this concept to their client's situation today.",
  "pitch": {
    "openingLine": "The hook. One sentence — a question or statement that stops the client in their tracks and makes them want to understand this concept.",
    "logicalCase": ["The single clearest fact that proves this concept is real and relevant", "What it has done historically — a verified number or pattern", "What it means for a client's wealth right now, today"],
    "emotionalCase": "Future pace in 2 sentences. If this concept plays out — or is already playing out — what does their financial picture look like without the right positioning? Then the alternative: what does it look like with it? Asset-neutral.",
    "painPoint": "The specific fear or frustration this concept triggers in a typical client. One precise sentence.",
    "spinQuestions": [
      "Situation — how aware are they of this concept and how it affects them",
      "Problem/Implication — what has it already cost them or might cost them",
      "Need-Payoff — what would it mean to be positioned correctly for what this concept is doing"
    ],
    "objections": [
      {"objection": "Most likely first pushback on this concept", "rebuttal": "Acknowledge → reframe → need-payoff. Conversational."},
      {"objection": "Second pushback", "rebuttal": "Same three-part structure. Different angle."}
    ],
    "urgencyLine": "One real, current reason this concept makes acting now smarter than waiting. Honest.",
    "socialProof": "What informed, sophisticated investors are doing in response to this concept. One sentence."
  }
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

    const { query, type, ticker, section } = body;
    if (!query) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'query required' }) };

    /* Cache key includes section so overview and pitch are stored separately */
    const cacheKey = 'search:' + type + ':' + (section ? section + ':' : '') + (ticker || query.trim().toLowerCase().slice(0, 80));

    const cached = await cacheGet(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' },
        body: JSON.stringify(cached),
      };
    }

    let userMsg;
    if (section === 'overview') {
      userMsg = OVERVIEW_PROMPT(query, null);
    } else if (section === 'pitch') {
      userMsg = PITCH_PROMPT(query);
    } else {
      userMsg = type === 'concept' ? CONCEPT_PROMPT(query) : COMPANY_PROMPT(query, null);
    }

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
          max_tokens: 2000,
          system: SEARCH_SYSTEM,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });

      if (!claudeResp.ok) {
        return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Anthropic error' }) };
      }

      const data = await claudeResp.json();
      const text = data.content?.[0]?.text || '';
      /* Strip markdown code fences Claude sometimes adds despite instructions */
      const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
      const match = stripped.match(/\{[\s\S]*\}/);
      const raw = match ? match[0] : stripped;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_e) {
        /* Claude sometimes embeds unescaped double-quotes or bare control chars
           inside JSON string values. Fix with a state machine. */
        let fixed = '';
        let inString = false;
        let escape = false;
        for (let i = 0; i < raw.length; i++) {
          const ch = raw[i];
          const code = raw.charCodeAt(i);
          if (escape) { fixed += ch; escape = false; continue; }
          if (ch === '\\') { fixed += ch; escape = true; continue; }
          if (!inString) {
            if (ch === '"') { inString = true; }
            fixed += ch;
            continue;
          }
          /* Inside a string — escape bare control characters */
          if (code < 0x20) {
            if (ch === '\n') fixed += '\\n';
            else if (ch === '\r') fixed += '\\r';
            else if (ch === '\t') fixed += '\\t';
            /* strip other control chars */
            continue;
          }
          /* Embedded unescaped double-quote — peek at what follows */
          if (ch === '"') {
            let j = i + 1;
            while (j < raw.length && (raw[j] === ' ' || raw[j] === '\n' || raw[j] === '\r' || raw[j] === '\t')) j++;
            const next = raw[j];
            if (next === ':' || next === ',' || next === '}' || next === ']' || j >= raw.length) {
              inString = false; fixed += ch;
            } else {
              fixed += '\\"';
            }
            continue;
          }
          fixed += ch;
        }
        parsed = JSON.parse(fixed);
      }

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
