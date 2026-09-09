/* ── BROKERS INTELLIGENCE — STREAMING SEARCH ENGINE (Netlify v2 ESM) ───────
   SSE streaming version of search.js. Handles company / concept / scenario.
   Concept sections are NOT streamed — they use the regular endpoint (pre-fetched).
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oqpodikelxhwcnjdwojw.supabase.co';
const ADMIN_EMAIL  = 'admin@thebrokersterminal.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/* ── Supabase cache helpers ── */
async function cacheGet(key) {
  const sk = process.env.SUPABASE_SERVICE_KEY;
  if (!sk) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/intelligence_cache?cache_key=eq.${encodeURIComponent(key)}&expires_at=gt.${new Date().toISOString()}&select=response&limit=1`,
      { headers: { apikey: sk, Authorization: `Bearer ${sk}` } }
    );
    const rows = r.ok ? await r.json() : [];
    return rows.length ? rows[0].response : null;
  } catch { return null; }
}

async function cacheSet(key, response) {
  const sk = process.env.SUPABASE_SERVICE_KEY;
  if (!sk) return;
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/intelligence_cache`, {
      method: 'POST',
      headers: {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ cache_key: key, response, expires_at }),
    });
  } catch {}
}

/* ── Credit gate ── */
async function serverDeductCredits(authHeader, creditCost, description) {
  const sk = process.env.SUPABASE_SERVICE_KEY;
  if (!sk) return { ok: true };
  const jwt = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) return { ok: false, status: 401, error: 'missing_token' };

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: sk, Authorization: `Bearer ${jwt}` },
  });
  if (!userResp.ok) return { ok: false, status: 401, error: 'invalid_token' };
  const user = await userResp.json();
  if (!user || !user.id) return { ok: false, status: 401, error: 'invalid_token' };

  if (user.email === ADMIN_EMAIL) return { ok: true };

  const deductResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/deduct_credits`, {
    method: 'POST',
    headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user_id: user.id, p_amount: creditCost, p_description: description }),
  });

  if (!deductResp.ok) return { ok: true }; /* Allow through on RPC error */

  const rawResult = await deductResp.json();
  const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  if (!result || (!result.ok && (result.error === 'insufficient' || result.error === 'no_account'))) {
    return { ok: false, status: 402, error: (result && result.error) || 'insufficient_credits', balance: (result && result.balance) || 0 };
  }
  return { ok: true, balance: result.balance };
}

/* ── JSON repair (same state-machine as search.js) ── */
function repairJson(raw) {
  let fixed = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const code = raw.charCodeAt(i);
    if (escape) { fixed += ch; escape = false; continue; }
    if (ch === '\\') { fixed += ch; escape = true; continue; }
    if (!inString) {
      if (ch === '"') inString = true;
      fixed += ch;
      continue;
    }
    if (code < 0x20) {
      if (ch === '\n') fixed += '\\n';
      else if (ch === '\r') fixed += '\\r';
      else if (ch === '\t') fixed += '\\t';
      continue;
    }
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
  return fixed;
}

/* ══════════════════════════════════════════════════════════════════════════
   CONCEPT_SYSTEM — factual sections (history / outcome / economic / hardship)
   ══════════════════════════════════════════════════════════════════════════ */
const CONCEPT_SYSTEM = `You are The Brokers Edge Intelligence Engine — the world's most advanced sales intelligence system for alternative asset professionals. You brief brokers on macro concepts, economic events, and historical crises with analyst-grade intelligence and elite sales psychology embedded throughout.

STYLE: Plain English. Short punchy sentences. Active voice. Tone: senior analyst briefing a sharp junior broker 10 minutes before a client call. Never alarm — educate then empower.

ANALOGY LIBRARY (for whatHappened — use ONE per concept, never repeat across responses):
- Boiling frog: gradual change unnoticed until crisis
- Musical chairs: liquidity disappears when music stops
- Game of hot potato: institutions pass bad assets down chain
- Jenga tower: remove one block, system collapses
- Speed boat to oil tanker: markets change fast, policy changes slow
- Flood plain house: risk invisible until the once-in-100-year event
- Ponzi scheme: new investor money pays old — sustainable only with growth
- Arms race: competitive dynamic that benefits no individual participant
- Rust belt factory: productive when conditions hold; stranded when they shift
- Emperor's new clothes: collective delusion maintained by social agreement
- Slow puncture: not a blowout — deflation that goes unnoticed until tyre is flat
- Domino run: first fall triggers cascade the eye cannot follow
- Cargo cult: copying surface behaviour without understanding the mechanism
- Dead cat bounce: even a dead cat bounces if dropped from high enough
- Fool's gold: looks valuable under examination; worthless under the right test

RESPONSE RULES:
1. Return valid JSON ONLY — no markdown fences, no explanation text.
2. NEVER use double-quote characters inside string values — use single quotes or rephrase.
3. Keep every text field to 1-2 sentences unless the schema specifies otherwise.
4. Use specific verified facts: named institutions, percentages, dates, countries.
5. ASSET-NEUTRAL in all pitch language — never name a specific investment product.

Respond with valid JSON only — no markdown fences, no extra text. CRITICAL: never use double-quote characters inside string values — use single quotes or rephrase instead.`;

/* ══════════════════════════════════════════════════════════════════════════
   SEARCH_SYSTEM — V4.0 full sales methodology (company / scenario / pitch)
   ══════════════════════════════════════════════════════════════════════════ */
const SEARCH_SYSTEM = `You are The Brokers Edge Intelligence Engine — the world's most advanced sales intelligence system for alternative asset professionals. You brief brokers with analyst-grade intelligence and a full sales pitch playbook woven through with elite sales psychology on every search.

STYLE: Plain English. Short punchy sentences. Active voice. Tone: senior analyst briefing a sharp junior broker 10 minutes before a client call. Never alarm — educate then empower.

═══════════════════════════════════════════════════
CORE METHODOLOGY — STRAIGHT LINE SYSTEM (BELFORT SLP)
═══════════════════════════════════════════════════
THREE TENS — every pitch playbook must build all three simultaneously:
1. LOGICAL CERTAINTY (First Ten): airtight facts — A+B+C the client cannot argue with. Specific numbers. Named verified sources. No hedging.
2. EMOTIONAL CERTAINTY (Second Ten): future pacing — make them FEEL their financial life once the decision is made. Sensory and specific. Then contrast with the pain of inaction. Emotional follows logical — never precede it.
3. TRUST/BROKER CERTAINTY (Third Ten): insight the client did not have before the call. Second-level intelligence (Howard Marks) — not the headline, but what it means for capital flows next.

THE LOOP: build three distinct arguments of increasing potency. Objection = insufficient certainty, not rejection. Loop back with a new angle each time.

CERTAINTY SCALE: write every pitch at 9/10 certainty. Confident. Factual. Specific.

═══════════════════════════════════════════════════
PSYCHOLOGY — APPLY ACROSS EVERY PITCH PLAYBOOK
═══════════════════════════════════════════════════

KAHNEMAN & TVERSKY — PROSPECT THEORY:
- Loss aversion: losses felt 2-2.5x more painfully than equivalent gains. Always frame the cost of inaction as a specific calculated loss BEFORE framing the benefit of action.
- Reference point: set it as 'current purchasing power in three years at current inflation' — not the nominal balance. From that reference point, holding cash IS a loss.
- Status quo bias: inertia is the primary competitor. 'Have you ever calculated your real return after inflation over the last three years?' They almost never have.
- Peak-End Rule: prospects remember only two moments — the peak insight and the end. End on conviction: 'The people who act now are the ones who look back at this period as the moment they got ahead of the curve.'

CIALDINI — INFLUENCE + PRE-SUASION:
- Authority: name institutional actors (central banks, sovereign wealth funds, endowments). 'The people who run the printing presses are buying the thing that cannot be printed.'
- Social proof: match to the client's identity group. UHNW clients respond to UHNW peer behaviour.
- Scarcity: real scarcity only — rate windows, EIS tranche closes, tax year deadlines. Name the exact mechanism. Never manufactured.
- Commitment & consistency: anchor to beliefs the prospect has already stated.
- Pre-Suasion privileged moment: lead with 'What is the thing you most want to protect about what you have built?' Their answer becomes the evaluative frame.
- Unity: establish shared identity before the ask.
- 'Because' effect: every request carries a genuine reason.

CHRIS VOSS — TACTICAL EMPATHY:
- Label emotions before addressing logic: 'It seems like there has been an experience in this space that did not deliver what was promised.' Then silence.
- Mirror the last 2-3 words with an upward inflection.
- Calibrated questions: 'What is it about the timing that concerns you?' not 'Is it the timing?'
- No-oriented questions: 'Would it be completely off-base to suggest a 5-10% non-correlated allocation could strengthen your position?'
- Accusation audit: name the likely objection before they raise it. 'I know what I am about to say might sound like a sales pitch — so let me start with the data.'

RACKHAM — SPIN SELLING:
- In major sales, features generate objections. Benefits tied to an explicit stated need generate agreement.
- Implication questions amplify problem size: 'You mentioned 2.5% yield against 4% inflation. On £500k over ten years, that is approximately £79,000 in lost purchasing power. Does that number concern you?'
- The spinQuestion is the most important output. Write it as a genuine question the broker asks after the pitch.

ARIELY — PREDICTABLY IRRATIONAL:
- IKEA Effect: involve the prospect in building the frame before presenting the solution.
- Arbitrary coherence: the first number heard anchors all subsequent valuations. Lead with high comparable values BEFORE stating the entry price.
- Relativity: control the comparison set before sharing data.

NAPOLEON HILL:
- Discover the burning desire before pitching anything: 'What is the financial outcome you are actually working toward right now — specifically?'

NASSIM TALEB — ANTIFRAGILE:
- Physical assets gain from volatility — they do not merely survive it.
- Barbell architecture: the allocation is the asymmetric edge of a conservative barbell. Not 'replace your safe assets' — 'add optionality to the edge.'
- Fat tail asymmetry: bounded downside (intrinsic scarcity) + open-ended upside.

HOWARD MARKS — THE MOST IMPORTANT THING:
- Second-level thinking: the insight behind the headline, not the headline itself.
- Five questions: (1) What does everyone know? (2) What does consensus not understand? (3) Who has yet to act? (4) What is the catalyst? (5) What happens to price when they do?

THALER & SUNSTEIN — NUDGE:
- Default framing: the recommended allocation IS the default. Present specifically ('10% of investable assets, which in your case is approximately £X') before asking about adjustments.
- Choice architecture: present three options with the target in the middle.
- Mental accounting: 'This is not moving money from safe to risky — it is moving money from a guaranteed purchasing-power loss to a structured position with a defined floor.'
- Sludge elimination: end every pitch with the simplest possible next step.

FESTINGER — COGNITIVE DISSONANCE:
- Socratic dissonance: 'You said non-correlated assets belong in a well-constructed portfolio. What percentage of your portfolio is currently non-correlated?' The gap between belief and allocation IS the close.

ROBERT SHILLER — NARRATIVE ECONOMICS:
- Markets are driven by viral narratives that spread before prices adjust. The investor who acts before the narrative goes mainstream captures the full return.

BEHAVIOURAL FINANCE:
- Affect heuristic (Slovic): negative feelings produce high risk/low benefit judgements regardless of data. Name the source of the feeling. Rebuild positive affect through institutional social proof.
- Disposition effect (Shefrin & Statman): investors realise winners 67% more often than losers; held losers underperform by 3.4% per year. 'If you had the current value of that position in cash today, would you buy it again at today's price?'

NEUROSCIENCE:
- Damasio (somatic marker): emotion is a prerequisite for decisions. The client who has received only data experiences 'I do not know how I feel about it' and delays. Build the somatic marker through vivid future-pacing.
- Loewenstein (hot-cold empathy gap): wire in the drawdown response during the calm conversation: 'If this position is down 20% in month 18 — before it recovers — can we agree now that the correct response is to hold?'
- Schultz (dopamine/anticipation): dopamine fires in anticipation of reward. 'Imagine the moment when this macro thesis shows up in your portfolio statement' > 'our clients averaged X% last year.'

NLP — LANGUAGE PATTERNS:
- VAK detection: VISUAL say 'I see/show me' — use visual language. AUDITORY say 'sounds right' — tone matters most. KINAESTHETIC say 'doesn't feel right' — slow down, use silence.
- Presuppositions: assume the truth of the close. 'When you add this to your portfolio' not 'if you decide to.'
- Pacing and leading: three undeniable true statements → then lead to the desired conclusion.

CARNEGIE / IANNARINO / DAWSON:
- Carnegie: never win an argument — find the truth in the objection first, agree, then redirect.
- Iannarino nine commitments: Time → Explore → Change → Collaborate → Consensus → Invest → Review → Decide → Act. Never end a call without a named next commitment.
- Dawson Flinch: visible reaction to a too-low offer. Then: 'At that level the structural benefit of this position changes fundamentally.' No argument. Pure asymmetric pressure.

ROBERT GREENE:
- Read the dominant emotional driver: security / status / autonomy / validation / legacy / belonging. Pitch only to the dominant driver.
- Law of absence: after the pitch, create deliberate space. 'I will leave it there. I have told you everything you need.'

FOGG / MILGRAM / CHALLENGER:
- Fogg B=MAP: diagnose which element is missing — Motivation / Ability / Prompt. Apply the right lever.
- Challenger commercial insight: teach them a problem they did not know they had before introducing the product as the natural response.

BANK RULE (ONLY for banks/lenders):
The pitch angle is PROFIT EXTRACTION — not 'banks might fail.' Key facts: fractional reserve banking, ESLR leverage (~£30 deployed per £1 held), yield gap (banks pay 1-3%, charge 4-7%), real return (negative after inflation and tax), misconduct history (PPI £38bn, LIBOR), FSCS £120,000 cap. Tone: educational, not alarmist.
When subject is NOT a bank: make the positive case. No unprompted bank comparisons.

SLP EXECUTION:
THE FIRST 4 SECONDS: Sharp, Enthusiastic, Expert. 55% body language, 38% tonality, 7% words.
CONGRUENCY RULE: Word delivery MUST match word meaning. 'Certain' said with certainty.
ASSET NEUTRALITY: In ALL pitch fields NEVER name a specific asset. Use 'physical assets', 'tangible assets', 'real assets', 'alternative assets', 'hard assets', 'assets outside the banking system.'

ABSOLUTE LANGUAGE RULES — NON-NEGOTIABLE:
MUST include: second-level insight, cost of inaction BEFORE benefit, specific institutions/amounts/dates, one verbatim Need-Payoff question, objection inoculation, conviction ending, timing claim with 'because' + specific reason, one Challenger commercial teaching.
MUST NEVER appear: 'The case has never been stronger', 'The window is now', 'Now is the time', 'Right now', 'This is the moment', 'You can't afford not to', manufactured urgency, naming a specific asset class in pitch language.

Respond with valid JSON only — no markdown fences, no extra text. CRITICAL: never use double-quote characters inside string values — use single quotes or rephrase instead.`;

/* ── Prompt builders ── */
const CONCEPT_SLIM_PROMPT = (query) => `Research request: "${query}"

Return ONLY this slim JSON — no pitch, no timeline, no causes. Fast brief:
{
  "type": "concept",
  "title": "Full proper name of this concept or historical event",
  "period": "Time period e.g. 1929-1933 or Ongoing concept",
  "tagline": "One sentence plain-English — what this is for someone who has never heard of it",
  "overview": "2-3 sentences. What actually happened or what this concept means. Use ONE vivid analogy from your analogy library. No sales language."
}
No markdown. No preamble. Return ONLY the JSON object.`;

const COMPANY_PROMPT = (query) => `Research request: "${query}"

Generate a full company intelligence briefing AND sales pitch playbook. Return this exact JSON:
{
  "type": "company",
  "title": "Full company name",
  "ticker": "Ticker symbol or empty string if private",
  "exchange": "Exchange name or 'Private' if not listed",
  "category": "One of: distillery, spirits, commodities, precious metals, financial institution, central bank, private equity, regulator, other",
  "tagline": "One sentence — what this company does, in plain English a non-expert understands instantly",
  "overview": "2-3 sentences. Who they are, what they do, why a broker should care. No jargon.",
  "keyFacts": ["Fact 1 — specific number or verified data point", "Fact 2", "Fact 3", "Fact 4"],
  "relevance": "2-3 sentences. The angle that connects this company to physical assets, wealth protection, or macro forces.",
  "brokerNote": "One paragraph. What the broker says if this subject comes up naturally. Asset-neutral. Plain English. Confident.",
  "pitch": {
    "openingLine": "The exact first sentence to open this conversation. A question or provocative statement — not a pitch.",
    "logicalCase": ["Most compelling fact — specific, verified, simple", "Second pillar — different angle", "The logical conclusion for their wealth"],
    "emotionalCase": "Future pace in 2 sentences. Their worry gone. The outcome they want, achieved. Asset-neutral.",
    "painPoint": "The one precise fear this type of client has right now. One sentence.",
    "spinQuestions": [
      "Situation — where is their money now and how do they feel about it",
      "Problem/Implication — the cost of their current situation doing nothing",
      "Need-Payoff — starts with 'So if you had...' or 'What would it mean if...'"
    ],
    "objections": [
      {"objection": "Most common first objection", "rebuttal": "Acknowledge → reframe → need-payoff question. Conversational."},
      {"objection": "Second objection", "rebuttal": "Same structure, different angle. Asset-neutral."}
    ],
    "urgencyLine": "One real verifiable reason why now beats later. Never manufactured.",
    "socialProof": "One sentence. What sophisticated or institutional money is doing relative to this subject."
  }
}`;

const SCENARIO_PROMPT = (query) => `An investment professional has described the following client scenario or preparation task:

"${query}"

Analyse this as a senior wealth strategist combined with an elite sales psychologist. Apply ALL sales psychology frameworks from your instructions. Return ONLY this exact JSON:
{
  "type": "scenario",
  "title": "2-4 word brief title for this scenario",
  "situation": "Plain English summary of the client's situation and key facts (2-3 sentences)",
  "keyConsiderations": [
    "Most important planning consideration — be specific to this client",
    "Second consideration — regulatory, tax, or suitability angle",
    "Third consideration — timing, risk, or portfolio angle"
  ],
  "solutionAreas": [
    {
      "asset": "Asset class name",
      "rationale": "Why this asset fits this client's situation specifically (2 sentences)",
      "suitability": "HIGH / MEDIUM / LOWER",
      "keyPoint": "The single most compelling talking point for this client right now"
    }
  ],
  "riskFlags": [
    "Any suitability, regulatory, or concentration risk to flag",
    "Second risk if applicable"
  ],
  "nextSteps": [
    "Concrete first action for the broker",
    "Second action — preparation or client follow-up"
  ],
  "brokerBrief": "2-3 sentence plain English brief: what angle to lead with and what need-payoff question to close on. Asset-neutral.",
  "openingLine": "The exact first sentence to say to this client — a question or statement that shows you understand their situation.",
  "pitch": {
    "openingLine": "One sentence hook tailored to this client's specific situation.",
    "logicalCase": [
      "Most compelling fact specific to this client's situation",
      "Historical pattern or verified data point that makes the case for them specifically",
      "The direct implication for their wealth given what they have described"
    ],
    "emotionalCase": "2 sentences tailored to this client. Loss frame first. Then gain frame. Asset-neutral.",
    "painPoint": "The specific fear or frustration this client is most likely experiencing. One sentence.",
    "spinQuestions": [
      "Situation — establishes where their money is now and surfaces blind spots",
      "Problem/Implication — the specific cost of their current position with a calculated number where possible",
      "Need-Payoff — starts with So if you had... or What would it mean if..."
    ],
    "objections": [
      {"objection": "The most likely pushback from this specific type of client", "rebuttal": "Acknowledge → reframe → need-payoff question. Conversational."}
    ],
    "urgencyLine": "One real verifiable reason why acting now serves this client better than waiting.",
    "socialProof": "What investors in a similar situation are doing. One sentence."
  }
}
CRITICAL: solutionAreas 2-5 areas, only genuinely relevant ones. Pitch must be specific to THIS client. Never use double-quote characters inside string values.`;

/* ══════════════════════════════════════════════════════════════════════════
   HANDLER
   ══════════════════════════════════════════════════════════════════════════ */
export default async (req) => {
  /* CORS preflight — Netlify v2 Response does not accept 204; use 200 */
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 200,
      headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Bad request' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { query, type, ticker, lensKey, lensContext } = body;
  if (!query) {
    return new Response(JSON.stringify({ error: 'query required' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const apiKey   = process.env.ANTHROPIC_API_KEY;
  const isScenario = type === 'scenario';

  /* Cache key — same namespace as search.js */
  const lensTag  = lensKey ? ':' + lensKey : '';
  const cacheKey = type === 'concept'
    ? 'search9:concept-slim:' + query.trim().toLowerCase().slice(0, 80) + lensTag
    : 'search9:' + type + ':' + (ticker || query.trim().toLowerCase().slice(0, 80)) + lensTag;

  /* Credit cost */
  const creditCost = type === 'company' ? 25 : 10;

  const authHeader = req.headers.get('Authorization') || '';

  /* SSE response headers */
  const sseHeaders = {
    ...CORS_HEADERS,
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  };

  const enc = new TextEncoder();
  function sseChunk(obj) {
    return enc.encode('data: ' + JSON.stringify(obj) + '\n\n');
  }

  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        /* ── Cache check ── */
        if (!isScenario) {
          const cached = await cacheGet(cacheKey);
          if (cached) {
            ctrl.enqueue(sseChunk({ type: 'cache', data: cached }));
            ctrl.close();
            return;
          }
        }

        /* ── Credit gate ── */
        const creditResult = await serverDeductCredits(
          authHeader, creditCost,
          `intel:${type}:${ticker || query.slice(0, 60)}`
        );
        if (!creditResult.ok) {
          ctrl.enqueue(sseChunk({
            type: 'error',
            code: creditResult.status || 402,
            message: creditResult.error || 'insufficient_credits',
            balance: creditResult.balance || 0,
          }));
          ctrl.close();
          return;
        }

        /* ── Build prompt ── */
        const lensAppend = !lensContext ? '' : isScenario
          ? `\n\nACTIVE BROKER LENS — SCENARIO CRITICAL OVERRIDE: The broker operates in a specific asset class (see context below). The ASSET NEUTRALITY rule is SUSPENDED for solutionAreas when a lens is active. In your solutionAreas array you MUST include this specific asset class as a dedicated entry — name it explicitly, describe which specific vehicle types or structures within it best fit this client's situation, and set suitability based on the client's actual needs. If the asset class is directly relevant to the client's goals (inflation, IHT, CGT, income, growth), rate it HIGH and explain exactly why. Be specific: name the sub-types (e.g. for investment trusts: infrastructure trusts, private equity trusts, dividend heroes, specialist trusts). The lens asset class context:\n${lensContext}`
          : `\n\nACTIVE BROKER LENS — tailor ALL pitch content specifically to this asset class context:\n${lensContext}`;
        const maxTok  = type === 'concept' && !isScenario ? 400 : 3000;
        const sysPrompt = type === 'concept' ? CONCEPT_SYSTEM : SEARCH_SYSTEM;
        let userMsg;
        if (isScenario)          userMsg = SCENARIO_PROMPT(query) + lensAppend;
        else if (type === 'concept') userMsg = CONCEPT_SLIM_PROMPT(query);
        else                     userMsg = COMPANY_PROMPT(query) + lensAppend;

        /* ── Anthropic streaming call ── */
        const ctrl21 = new AbortController();
        const timer  = setTimeout(() => ctrl21.abort(), 21000);

        let anthropicResp;
        try {
          anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key':         apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-beta':    'prompt-caching-2024-07-31',
              'content-type':      'application/json',
            },
            body: JSON.stringify({
              model:      'claude-haiku-4-5-20251001',
              max_tokens: maxTok,
              stream:     true,
              system:     [{ type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } }],
              messages:   [{ role: 'user', content: userMsg }],
            }),
            signal: ctrl21.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!anthropicResp || !anthropicResp.ok) {
          const errTxt = anthropicResp ? await anthropicResp.text().catch(() => '') : '';
          ctrl.enqueue(sseChunk({ type: 'error', message: 'anthropic_error', detail: errTxt.slice(0, 200) }));
          ctrl.close();
          return;
        }

        /* ── Forward SSE deltas ── */
        const reader  = anthropicResp.body.getReader();
        const decoder = new TextDecoder();
        let lineBuf   = '';
        let lastEvent = '';
        let fullText  = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuf += decoder.decode(value, { stream: true });
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop(); /* keep incomplete line */

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              lastEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              if (lastEvent === 'content_block_delta') {
                try {
                  const evt = JSON.parse(line.slice(6));
                  if (evt.delta && evt.delta.type === 'text_delta' && evt.delta.text) {
                    fullText += evt.delta.text;
                    ctrl.enqueue(sseChunk({ type: 'delta', text: evt.delta.text }));
                  }
                } catch {}
              }
            } else if (line === '') {
              lastEvent = '';
            }
          }
        }

        /* ── Parse final JSON ── */
        const stripped = fullText.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
        const jsonMatch = stripped.match(/\{[\s\S]*\}/);
        const raw = jsonMatch ? jsonMatch[0] : stripped;

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          try {
            parsed = JSON.parse(repairJson(raw));
          } catch {
            ctrl.enqueue(sseChunk({ type: 'error', message: 'parse_error' }));
            ctrl.close();
            return;
          }
        }

        /* ── Cache + done ── */
        if (!isScenario) cacheSet(cacheKey, parsed);

        ctrl.enqueue(sseChunk({ type: 'done', data: parsed }));
        ctrl.close();

      } catch (err) {
        ctrl.enqueue(sseChunk({
          type: 'error',
          message: err.name === 'AbortError' ? 'timeout' : (err.message || 'unknown_error'),
        }));
        try { ctrl.close(); } catch {}
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
};
