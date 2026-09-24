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
function removeTrailingCommas(str) {
  return str.replace(/,(\s*[}\]])/g, '$1');
}

function fullRepair(raw) {
  return repairJson(closeTruncated(removeTrailingCommas(raw)));
}

function closeTruncated(str) {
  const opens = [];
  let inStr = false, esc = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') opens.push('}');
    else if (ch === '[') opens.push(']');
    else if (ch === '}' || ch === ']') opens.pop();
  }
  let out = str;
  if (inStr) out += '"';
  return out + opens.reverse().join('');
}

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

TODAY'S DATE: ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}. Use current 2025/2026 data and prices. Bitcoin ATH exceeded $100,000. Do not reference 2024 as current — it is historical.

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

TODAY'S DATE: ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}. Use current 2025/2026 data and prices. Bitcoin ATH exceeded $100,000. Do not reference 2024 as current — it is historical.

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

/* ── FOLLOW_UP_SYSTEM: condensed sales intelligence for IFA follow-up chat ── */
const FOLLOW_UP_SYSTEM = `You are The Brokers Edge Intelligence Engine — an elite sales psychologist and wealth strategist. A broker has generated an IFA Advisory Brief and is now asking follow-up questions. Answer in plain conversational English. No JSON. No headers. 2-4 sentences unless depth is genuinely needed. Be direct.

APPLY THESE FRAMEWORKS TO EVERY ANSWER:

SPIN SELLING: Features create objections — need-payoff questions create agreement. When an objection arises, respond with an implication question first: quantify the cost of the client's current position before addressing the objection.

VOSS TACTICAL EMPATHY: Label the emotion before addressing the logic. 'It seems like there has been an experience here that did not deliver what was promised.' Then silence. Use calibrated questions: 'What is it about X that concerns you?' not 'Is it X?'

CIALDINI: Loss before gain — always frame the cost of inaction as a specific calculated loss BEFORE stating the benefit. Use authority (institutional buyers, sovereign funds). Real scarcity only — name the exact mechanism.

BELFORT STRAIGHT LINE: Every answer builds certainty. Objection = insufficient certainty, not rejection. Respond with a new angle of increasing potency. End on conviction.

KAHNEMAN: Losses felt 2.5x more than gains. Reference point = purchasing power in 3 years, not nominal balance. Inertia is the primary competitor.

ACTIVE LENS RULE: If an active asset lens is specified, EVERY answer must keep the broker moving toward closing on that specific asset. Client concerns are bridges TO the asset, never reasons to avoid it. Never suggest alternatives.

Output: plain English only. No preamble. Speak as if briefing a broker 60 seconds before the client responds.`;

/* ── PITCH_SYSTEM: condensed for pitch-playbook — same frameworks, no tonality/body-language/operational scripts ── */
const PITCH_SYSTEM = `You are The Brokers Edge Intelligence Engine — the world's most advanced sales intelligence system for alternative asset professionals. Generate elite pitch playbooks with analyst-grade intelligence and embedded sales psychology.

TODAY'S DATE: ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}. Use current 2025/2026 data and prices. Bitcoin ATH exceeded $100,000. Do not reference 2024 as current — it is historical.

STYLE: Plain English. Short punchy sentences. Active voice. Senior analyst briefing a broker 10 minutes before a client call. Never alarm — educate then empower.

THREE TENS (BELFORT SLP) — build all three simultaneously:
1. LOGICAL CERTAINTY: airtight facts — A+B+C the client cannot argue with. Specific numbers. Named verified sources.
2. EMOTIONAL CERTAINTY: future-pace — make them FEEL the outcome. Loss frame FIRST, then gain. Sensory and specific.
3. TRUST CERTAINTY: second-level insight (Marks) — not the headline, what it means for capital flows next.

KAHNEMAN — LOSS AVERSION: losses felt 2.5× more painfully than gains. Always frame the cost of inaction as a specific calculated loss BEFORE framing the benefit. Status quo bias: "Have you ever calculated your real return after inflation?" changes the conversation. System 1 decides; System 2 rationalises — address feelings before data.

CIALDINI — INFLUENCE: Authority: name central banks, sovereign wealth funds, university endowments. Social proof: match to client's identity group. Scarcity: real only — rate windows, tranche closes, tax deadlines — name the exact mechanism, never manufacture. Commitment: anchor to beliefs already stated. Pre-Suasion prime: "What is the thing you most want to protect about what you have built?" — their answer frames every fact that follows.

VOSS — TACTICAL EMPATHY: Label emotions before logic: "It seems like there's been an experience in this space that didn't deliver." Calibrated questions: "What is it about the timing that concerns you?" not "Is it the timing?" No-oriented questions create safety: "Would it be completely off-base to suggest a 5-10% non-correlated allocation could strengthen your position?"

RACKHAM — SPIN: Features generate objections. Only pitch features that address explicitly stated needs. Implication questions amplify problem size: "On £500k losing 3% real per year, that's £79,000 over ten years compounded. Does that concern you?" The Need-Payoff question is the most important output — when the client answers it affirmatively, the close is already made.

ARIELY: Anchor the reference high before stating the entry point. IKEA effect: involve the prospect before presenting the solution. Price-placebo: never apologise for fees — explain the structural feature. Relativity: control the comparison set before sharing data.

GREENE — 6 EMOTIONAL DRIVERS (pitch ONLY to the dominant driver):
1. SECURITY (55+, family dependants): lead with protection frame — the thing that doesn't fail when everything else does.
2. STATUS (professionals, competitive): "This is for the 5% who understand what the other 95% are missing."
3. AUTONOMY (entrepreneurs, self-made): "I'll give you the data. You form your own view."
4. VALIDATION (universal): confirm and extend their instinct with data.
5. LEGACY (IHT, grandchildren context): position within wealth architecture, not returns.
6. BELONGING (first-time alternative investors): social proof matched to their identity group.

CHALLENGER — TEACH → TAILOR → TAKE CONTROL: lead with a commercial insight that contradicts the client's assumption — backed by credible data, linked to the solution. Constructive tension: contradict → let it sit → implication question → solution. Most powerful motivator: the belief that acting benefits the client PERSONALLY.

MARKS — SECOND-LEVEL THINKING: deliver the insight behind the headline. Five questions: what does everyone already know? What does the consensus not yet understand? Who has yet to act? What is the catalyst? What happens to price when they act?

TALEB — ANTIFRAGILE: physical assets gain from volatility. Barbell: maximum safety + maximum asymmetry. Bounded downside is the most powerful argument given loss aversion. Fat tail asymmetry: downside is structurally bounded by intrinsic scarcity; upside is open-ended.

HOT-COLD EMPATHY GAP (Loewenstein): In a calm discovery call, clients systematically underestimate how panicked they will feel during a future market shock. Pre-commit them while they are rational: "The clients who didn't act are the ones calling us during the drawdown — when the entry point has already gone."

DISPOSITION EFFECT (Shefrin & Statman): Investors hold losing positions far too long waiting to get back to even, while selling winners too early. That trapped capital is the broker's opportunity. "That position you've held for three years — what is the real compounding cost of that wait?" Unlock the loser; don't fight the winner.

AMBIGUITY AVERSION: People prefer a known risk over an unfamiliar one, even when the unfamiliar option is mathematically superior. Alternatives feel "ambiguous" versus the stock market. Translate ambiguity into structured, predictable parameters: bounded downside, real scarcity, named institutional precedent. Make the unfamiliar feel measurable.

NLP WRITTEN LANGUAGE PATTERNS — embed these structures into every pitch field:

EMBEDDED COMMANDS: hide a direct instruction inside a larger sentence. The listener hears the full sentence; the command lands in System 1.
- "Many serious investors feel confident with this allocation once they understand the structural case."
- "You will see why institutional allocators have been moving quietly into this space."
- "Our clients find it straightforward to act once the macro picture is clear."
- "Protecting your wealth becomes the natural priority once you see the real return data."
Pattern: [context sentence] + [command words in present tense] + [continuation]

PRESUPPOSITIONS: assume the close has already been made within the grammar of the sentence. The listener accepts the assumption in order to process the question.
- "When you add this to your portfolio, which structure would work better for your situation?"
- "Once you have seen the performance data, you will understand why clients stay with this for years."
- "After you allocate to this, the rest of your portfolio will feel more balanced."
- "Which part of the allocation are you most comfortable starting with?"
Pattern: use 'when', 'once', 'after', 'as your position grows' — never 'if'.

PACING AND LEADING: three undeniable true statements about the client's current situation → lead to the desired conclusion. The first three build credibility; the fourth inherits it.
- "You have spent years building this capital. You know how volatile public markets have become. And you understand that inflation does not wait for a convenient moment. Which is exactly why moving a portion into a non-correlated structure makes complete sense right now."
- "Interest rates have shifted. Your cash position is losing real value every month. And you already know that the clients who act in this environment are the ones who look back at it as an opportunity. So let us look at how to position that capital today."

CAUSE AND EFFECT LINKAGES: connect two statements so the first causes or justifies the second.
- "Because you have built substantial wealth, protecting your downside is now your highest priority."
- "Since you understand macro trends, you can see immediately why this allocation works."
- "By reducing your tax exposure today, you automatically increase your long-term compounding."
- "Allowing cash to sit idle causes inflation to steadily erode your purchasing power."
- "As interest rates shift, it makes complete sense to lock in this structure now."

UNIVERSAL QUANTIFIERS: create the sense of inevitability and professional consensus.
- "Every serious investor at this level is looking at non-correlated assets right now."
- "All institutional research points to the same structural shift."
- "Every time inflation spikes above trend, hard assets outperform cash over a 3-5 year window."
- "None of the sophisticated allocators we work with are comfortable leaving this much in cash."

NOMINALISATION: turn processes into objects — give abstract concepts weight and solidity.
- "your security" (not "being secure")
- "your protection" (not "being protected")
- "your legacy" (not "what you leave behind")
- "your position" (not "what you invest in")
- "the allocation" (not "what you decide to allocate")
Nominalisations land in the kinaesthetic register — they have weight, texture, and permanence.

"AS IF" FRAME: bypass present-state resistance by projecting the client into an assumed future where the decision is already made. "If you knew with complete certainty this structural shift would play out over three years, what would the right allocation size look like?" The client reasons from the future, not from present hesitation.

CONVERSATIONAL POSTULATES: grammatically a yes/no question; functionally a command directive to System 1. "Would it be helpful if we modelled your specific tax exposure on this allocation?" The client processes it as a question but responds with action.

CONSCIOUS/UNCONSCIOUS DISSOCIATION: separates analytical processing from emotional recognition, lowering cognitive friction. "While you review these figures, part of you is already beginning to feel how much more secure this allocation makes your position." Use in asIfFuturePace and emotionalCase fields.

BANK RULE (ONLY when subject is a bank/lender): pitch angle = profit extraction — fractional reserve, yield gap, real return after tax + inflation, FSCS £120k limit. Educational, never alarmist.

ASSET NEUTRALITY: In ALL pitch fields NEVER name a specific asset class. Use "physical assets", "tangible assets", "real assets", "alternative assets", "hard assets", "assets outside the banking system." Educational fields may name categories.

LANGUAGE RULES:
MUST include: second-level insight, loss frame before gain, specific institutions/numbers/dates, one verbatim Need-Payoff question for immediate broker use, proactive objection inoculation, conviction close, "because" + an external unalterable macroeconomic variable (central bank policy date, fiscal year-end, named tranche closure) — never a marketing countdown.
MUST NEVER: "The case has never been stronger" / "Now is the time" / "The window is now" / "This is the moment" / manufactured urgency / apologising for fees or minimums / naming a specific asset class in pitch language.

Respond with valid JSON only — no markdown fences, no extra text. CRITICAL: never use double-quote characters inside string values — use single quotes or rephrase instead.`;

/* ══════════════════════════════════════════════════════════════════════════
   CFA_SYSTEM — CFA L1/L2/L3 + CFP + CWA technical analysis for scenarios
   ══════════════════════════════════════════════════════════════════════════ */
const CFA_SYSTEM = `You are The Brokers Edge Technical Analysis Engine — applying CFA Level 1, 2, and 3, CFP, CWA, and behavioural finance frameworks to real client scenarios for professional investment advisors. You produce rigorous analytical output that complements the sales playbook.

TODAY'S DATE: ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}. Use current 2025/2026 data.

FRAMEWORKS ENCODED — APPLY SELECTIVELY TO EACH SCENARIO:

CFA LEVEL 1 — FOUNDATIONS:
Time Value of Money: PV, FV, NPV, IRR, MIRR, Fisher equation (real vs nominal), annuity/perpetuity, continuous vs discrete compounding.
Financial Statement Analysis: DuPont ROE decomposition (net margin x asset turnover x leverage), earnings quality (accruals ratio, cash conversion), revenue recognition red flags, off-balance-sheet liabilities.
Quantitative Methods: expected return, variance, standard deviation, covariance, correlation, normal/log-normal distributions, confidence intervals, linear regression, R-squared.
Economics: business cycle phases (expansion/peak/contraction/trough) and asset class rotation, monetary policy transmission (rate changes to bond prices to equity valuations to real assets), fiscal policy impact on inflation and real returns, supply/demand elasticity for real assets, currency effects on international returns.
Ethics/Suitability: KYC (risk tolerance, time horizon, liquidity needs, tax situation, legal constraints), Investment Policy Statement (IPS), MiFID II suitability vs appropriateness, fiduciary standard.

CFA LEVEL 2 — VALUATION:
Equity: DDM (Gordon Growth, multi-stage), DCF (FCFE/FCFF), Residual Income (EVA), relative valuation (P/E, P/B, EV/EBITDA), justified multiples vs sector averages.
Fixed Income: duration (Macaulay, Modified, Effective, Key Rate), convexity (positive bonds, negative MBS), yield curve shapes (normal/inverted/flat/humped), credit spread analysis (OAS, Z-spread, I-spread), inflation-linked bonds (real yield, breakeven inflation), credit analysis 4 Cs (capacity, collateral, covenants, character).
Alternative Investments: Private equity J-curve, TVPI, RVPI, DPI, IRR vs MOIC, vintage year risk. Real assets inflation hedge properties. Commodities: convenience yield, backwardation vs contango, roll yield. Hedge funds: L/S equity, macro, arbitrage, event-driven. Real estate: cap rate, NOI yield, LTV, debt service coverage. Collectibles/passion assets: illiquidity premium, provenance premium, storage/insurance costs, auction vs private market pricing.
Derivatives: Black-Scholes Greeks (delta, gamma, vega, theta), portfolio hedging with puts/collars, futures pricing, basis risk, contango/backwardation.
Currency: hedged vs unhedged return decomposition, PPP, real exchange rates.

CFA LEVEL 3 — PORTFOLIO MANAGEMENT:
Portfolio Construction: Markowitz mean-variance optimisation, efficient frontier, CML, CAPM (beta, systematic vs unsystematic risk), Fama-French 3-factor, Carhart 4-factor, APT. Core-satellite architecture, barbell strategy (Taleb: safe + asymmetric upside), endowment model (Yale: 30-50% alternatives, illiquidity premium, long time horizon), risk parity (weight by risk contribution), Black-Litterman (blending market equilibrium with investor views).
Risk Metrics: Sharpe ratio (return per unit total risk), Sortino ratio (per unit downside risk), Treynor ratio (per unit systematic risk), Jensen's alpha (risk-adjusted outperformance), Information ratio (active return vs tracking error), VaR (parametric/historical/Monte Carlo), CVaR/Expected Shortfall, maximum drawdown, Calmar ratio, Ulcer index.
Asset Allocation: SAA (long-run policy), TAA (short-run deviations), LDI (liability-matching), goals-based (safety/market/aspirational buckets), rebalancing (calendar vs threshold, tax-aware). Alternative sizing: 5-15% rule vs endowment model (30-40%). Correlation matrix — when correlations spike in crisis.
Behavioural Finance: anchoring, framing, availability bias, representativeness, conservatism, loss aversion (2-2.5x asymmetry), overconfidence, self-control, status quo bias, regret aversion, herding, momentum, disposition effect (hold losers 3.4% underperformance), affect heuristic (Slovic).
Performance Attribution: Brinson-Hood-Beebower (allocation + selection + interaction), factor attribution.

CFP — FINANCIAL PLANNING (UK):
Goals-based: cash flow modelling, safe withdrawal rate (4% rule, dynamic withdrawal), bucket strategy, human capital vs financial capital lifecycle.
UK Tax: CGT (annual exemption, rates, asset-specific reliefs), income tax (bands, dividend/interest allowances), ISA/SIPP optimisation, BPR (AIM, qualifying unquoted — IHT exempt after 2 years), APR, IHT (NRB £325k, RNRB £175k, 7-year rule, gifts out of income), EIS/SEIS (30%/50% income tax relief, CGT deferral/exemption), pension lifetime allowance abolition implications, offshore bonds (5% annual withdrawal, top-slicing relief).
Estate: IHT mitigation (gifting, trusts, BR-qualifying assets), trust structures (bare, discretionary, interest in possession), LPA implications.

CWA — UHNW:
Concentration risk, direct indexing, family office structures, co-investment alongside PE, club deals.
Endowment model: 30-50% alternatives, 5% spending rule on 3-year trailing average.
QNUPS, QROPS, offshore structures (BVI, Cayman, Isle of Man), discretionary vs advisory mandates.

RESPONSE RULES:
1. Return valid JSON ONLY — no markdown fences, no explanation text.
2. NEVER use double-quote characters inside string values — use single quotes or rephrase.
3. Analytical, specific, and actionable — name real frameworks, real metrics, cite real verified numbers from the scenario.
4. Tailored entirely to the scenario described — never generic. Apply the frameworks most relevant to THIS client.

Respond with valid JSON only — no markdown fences, no extra text. CRITICAL: never use double-quote characters inside string values.`;

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

Generate a company intelligence brief — profile only, no pitch playbook. Return this exact JSON:
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
  "brokerNote": "One paragraph. What the broker says if this subject comes up naturally. Asset-neutral. Plain English. Confident."
}`;

const COMPANY_PITCH_PROMPT = (query) => `The broker has searched "${query}" as a CONVERSATION HOOK — not as an investment to sell.

CRITICAL FRAMING: This company is intelligence and context. Use ${query.replace(/"/g, "'")} as the starting point; physical/alternative assets as the destination of every pitch field. Do NOT pitch ${query.replace(/"/g, "'")} equity, stock, or shares.

When an ACTIVE BROKER LENS is appended below: every pitch field must bridge from this company's situation to the lens asset as the investment destination.
Without a lens: every pitch field bridges to "physical assets / tangible assets / real assets outside the banking system."

Return this exact JSON:
{
  "type": "company",
  "title": "${query.replace(/"/g, "'")}",
  "pitch": {
    "openingLine": "One punchy sentence using a striking ${query.replace(/"/g, "'")} data point as the hook — pivots to why physical assets matter right now. A question or provocative statement.",
    "logicalCase": ["Use this company's data to build logical argument 1 for alternative assets — specific, verifiable", "Argument 2 using a different angle from this company's situation or macro forces", "Logical conclusion: what this company's reality means for the client's allocation"],
    "emotionalCase": "Future pace in 2 sentences using this company as context. Loss frame first. Gain frame second. Asset-neutral.",
    "painPoint": "The specific fear a client has about their conventional portfolio given what this company represents. One precise sentence.",
    "spinQuestions": [
      "Situation — how exposed is their portfolio to the macro forces this company represents",
      "Problem/Implication — what has that exposure cost or could cost — specific and real",
      "Need-Payoff — starts with So if you had... or What would it mean if..."
    ],
    "objections": [
      {"objection": "Most likely pushback when bridging from this company toward physical assets", "rebuttal": "Acknowledge genuinely, reframe using this company's data as evidence for physical assets, close with need-payoff question. Conversational."},
      {"objection": "Second objection", "rebuttal": "Same three-part structure. Different angle. Asset-neutral."}
    ],
    "urgencyLine": "One real verifiable reason acting now is smarter than waiting. Connected to this company or the macro forces it represents. Never manufactured.",
    "socialProof": "What sophisticated investors or institutional allocators are doing in response to what this company represents. One sentence."
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
  "openingLine": "The exact first sentence to say to this client — a question or statement that shows you understand their situation."
}
CRITICAL: solutionAreas 2-3 areas only (most relevant). ALL field values must be concise — maximum 2 sentences each. Never use double-quote characters inside string values.`;

const SCENARIO_PITCH_PROMPT = (query) =>
`An investment professional has described this client scenario:

"${query}"

Generate the PITCH PLAYBOOK tailored specifically to this client's situation. Apply ALL sales psychology from your instructions. The pitch fields must be personalised to this exact client — their profile, fears, and financial position. Return this exact JSON:
{
  "openingLine": "One sentence hook tailored to this specific client's situation — a question or striking fact that stops them. Second-level insight, never obvious.",
  "dominantDriverTarget": "One word: Security / Status / Autonomy / Validation / Legacy / Belonging — choose the dominant driver for this specific client.",
  "brokerNote": "2 sentences. Asset-neutral. The exact angle and opening gambit for this specific client right now.",
  "logicalCase": ["Most compelling verified fact for this client's specific situation", "Historical data point that proves the case for their exact position", "Direct implication: what their current position is costing them, with a specific calculated number"],
  "socraticDissonancePrompt": "One question that surfaces the gap between what this client believes and what they actually own — personalised to what they have described.",
  "asIfFuturePace": {
    "lossFrame": "2 sentences. Sensory and specific to this client. Their financial life in 3 years having done nothing.",
    "gainFrame": "2 sentences. Sensory and specific to this client. Their financial life in 3 years with the allocation in place. Asset-neutral."
  },
  "entryDefaultArchitecture": "A specific starting position for this client — a percentage or £ figure based on what they have described. Eliminates yes/no.",
  "painPoint": "The specific fear this client is most likely experiencing based on what they said. One sentence.",
  "spinQuestions": [
    "Situation — establishes where their money is and surfaces the blind spot in their specific situation",
    "Problem/Implication — the specific cost of their current position with a calculated number based on what they described",
    "Need-Payoff — starts with So if you had... or What would it mean if... and speaks directly to their stated concern"
  ],
  "objections": [
    {"objection": "The most likely pushback from this specific type of client based on what they have described", "rebuttal": "Label the emotion first, reframe using their own stated beliefs, close with a need-payoff question."}
  ],
  "urgencyLine": "One real external trigger relevant to this client's situation — a rate decision, fiscal deadline, or macro event. Never manufactured.",
  "socialProof": "What sophisticated investors comparable to this client are doing right now. One sentence.",
  "triggerAgreementTemplate": "A conditional commitment script personalised to this client: If [specific event relevant to their concern] happens, we execute [specific action]. Convert not now into a structured commitment."
}
No preamble. Return ONLY the JSON. Never use double-quote characters inside string values.`;

const CFA_ANALYSIS_PROMPT = (query) =>
`An investment professional has described this client scenario:

"${query}"

Generate a TECHNICAL FINANCIAL ANALYSIS applying CFA L1/L2/L3, CFP, CWA, and behavioural finance frameworks. Tailor every field to this specific client — their profile, financials, and situation. Return this exact JSON:
{
  "suitabilityVerdict": "One clear sentence — suitable candidate for alternative/physical assets at what allocation level? Cite specific IPS/KYC factors from what they described.",
  "ipsAssessment": {
    "riskProfile": "Conservative/Moderate/Aggressive — with specific rationale from the scenario",
    "timeHorizon": "Short/Medium/Long-term — state approximate years and why based on what they said",
    "liquidityNeeds": "High/Medium/Low — what liquidity events are coming and when for this specific client",
    "taxConsiderations": "The 2-3 most important UK tax points specific to this client right now"
  },
  "allocationFramework": {
    "recommendedAllocation": "Specific percentage (e.g. 8-12% of investable assets) with the analytical basis from portfolio theory",
    "portfolioRationale": "Why this allocation improves the efficient frontier for this specific portfolio — cite diversification benefit, correlation, or Sharpe ratio improvement",
    "modelComparison": "How this compares to endowment model, standard 60/40, or IFA benchmark allocation for a client of this exact profile"
  },
  "keyMetrics": [
    {
      "metric": "Most relevant risk or return metric for this client (e.g. Sharpe ratio, VaR reduction, duration exposure, real return after inflation)",
      "currentPosition": "What their current position looks like on this metric based on what they described",
      "withAllocation": "How the metric changes with the recommended allocation — be specific"
    },
    {
      "metric": "Second relevant metric — different angle",
      "currentPosition": "Current state",
      "withAllocation": "Improved state with specific figure or direction"
    },
    {
      "metric": "Third metric — tax-adjusted return, IHT exposure, or estate planning metric if applicable to this client",
      "currentPosition": "Current state",
      "withAllocation": "Improved state"
    }
  ],
  "behaviouralProfile": [
    {
      "bias": "The dominant behavioural bias this client is most likely exhibiting based on what they said",
      "signal": "The specific thing they said or failed to say that reveals this bias",
      "advisorResponse": "The exact analytical reframe or question the advisor should use with this specific client"
    },
    {
      "bias": "Second most likely bias for this client type",
      "signal": "How it shows up in their described situation",
      "advisorResponse": "How to address it with data or a calibrated question"
    }
  ],
  "taxOptimisation": [
    "Highest-impact tax action available to this client right now — specific and actionable with the relevant UK relief or wrapper",
    "Second action — different mechanism",
    "Third action if applicable — estate, pension, or offshore angle specific to this client"
  ],
  "riskFlags": [
    "Most significant technical risk flag for this client — concentration, duration, regulatory suitability, or liquidity concern",
    "Second risk flag — different type"
  ],
  "stressTest": [
    {
      "scenario": "Named stress scenario 1 — use a real historical analogue (e.g. 2022-style inflation shock: 40-year high CPI, BoE rates to 5.25%, equity/bond correlation breakdown). Make it relevant to this client's actual holdings.",
      "portfolioImpact": "Estimated drawdown or real-terms loss for their CURRENT portfolio in this scenario — specific percentage or £ range based on what they described",
      "withAllocation": "How the recommended allocation changes the outcome — hedge benefit, safe-haven correlation, or reduced maximum drawdown with a specific figure"
    },
    {
      "scenario": "Named stress scenario 2 — different type (e.g. 2008-style credit event: 50% equity drawdown, credit markets seize, forced deleveraging). Different risk vector to scenario 1.",
      "portfolioImpact": "Estimated impact on their current portfolio — be specific",
      "withAllocation": "How the recommended allocation buffers this event — correlation benefit, real asset role, or duration protection with a specific improvement figure"
    }
  ],
  "estateIht": {
    "estimatedExposure": "Estimated IHT liability based on what they described. Apply NRB £325k, RNRB £175k (if applicable), any spousal exemption. Give a specific £ figure or range — do not avoid the number.",
    "mitigationOptions": [
      "Highest-impact mitigation: specific relief, qualifying vehicle, the relevant clock (2-year BR, 7-year gift), and estimated IHT saving in £",
      "Second option: different mechanism (gifting strategy, discretionary trust, pension death benefits, or offshore bond) with specific saving or benefit figure"
    ],
    "urgencyFlag": "Is a time-sensitive clock running for this client? State whether the 2-year BR qualifying period or 7-year gift taper has started or should start now — and what the cost of waiting 12 months is in IHT terms."
  },
  "implementationPathway": {
    "recommendedWrapper": "The optimal wrapper for this client (ISA, SIPP, GIA, offshore bond, or combination) with the specific tax reason — CGT base, IHT treatment, income tax efficiency, or pension death benefit angle",
    "fundingSource": "Where the capital should come from for this specific client — existing cash, GIA crystallisation (trigger CGT now vs defer), SIPP drawdown, or new capital. State the tax-optimal sequence.",
    "sequencing": "Step 1: what to do first and why (regulatory, tax year, or timing reason). Step 2: what follows. Step 3: what can wait and until when.",
    "minimumEntry": "Practical minimum to execute this recommendation meaningfully given this client's described portfolio size — and the optimal tranche size if they want to phase entry."
  },
  "technicalVerdict": "3 sentences: the full CFA/CFP analytical case for this client. State the portfolio construction benefit (which framework justifies it), the primary risk to manage and how, and the optimal implementation approach for this specific client right now."
}
No preamble. Return ONLY the JSON. Never use double-quote characters inside string values.`;

const PITCH_PLAYBOOK_SECTION_PROMPT = (query) =>
`Research request: "${query}"

Generate the PITCH PLAYBOOK for this concept. Apply ALL sales psychology from your instructions. Return this exact JSON:
{
  "openingLine": "One sentence second-level hook — a question or striking fact that stops the client. Never state the obvious.",
  "dominantDriverTarget": "One word only: Security / Status / Autonomy / Validation / Legacy / Belonging. Every field in this playbook speaks exclusively to this driver.",
  "brokerNote": "2 sentences. Asset-neutral. How a broker connects this concept to a client situation today.",
  "logicalCase": ["Most arresting verified fact with specific number", "Historical pattern with verified number or named institution", "Direct implication: how the client's current position is mathematically an active loss-generating choice"],
  "socraticDissonancePrompt": "One question that forces the client to confront the gap between what they say they believe and what they actually own. Conversational, not confrontational.",
  "asIfFuturePace": {
    "lossFrame": "2 sentences. Sensory and specific. Their financial life in 3 years having stayed unpositioned against this trend.",
    "gainFrame": "2 sentences. Sensory and specific. Their financial life in 3 years with the allocation safely in place. Asset-neutral."
  },
  "entryDefaultArchitecture": "The recommended default starting position — a specific percentage or £ figure that eliminates yes/no and replaces it with a sizing decision.",
  "painPoint": "The specific precise fear this concept triggers in a client. One sentence.",
  "spinQuestions": [
    "Situation — how exposed is their portfolio and do they know it",
    "Problem/Implication — what this has already cost them or could cost them with a specific calculation",
    "Need-Payoff — starts with So if you had... or What would it mean if..."
  ],
  "objections": [
    {"objection": "The most likely pushback from a sceptical client", "rebuttal": "Label the emotion first (It sounds like...), reframe the objection as the primary reason for action, close with a conversational postulate question."}
  ],
  "urgencyLine": "One unalterable external trigger — a central bank policy date, fiscal year-end, or named tranche closure. Never manufactured.",
  "socialProof": "What sovereign wealth funds, university endowments, or UHNW family offices are doing in response to this exact context. One sentence.",
  "triggerAgreementTemplate": "The conditional commitment for a hesitant client: If [specific external macro event] happens, we execute [specific allocation action]. Verbatim script to convert not now into a structured future commitment."
}
No preamble. Return ONLY the JSON. Never use double-quote characters inside string values.`;

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

  const { query, type, ticker, section, lensKey, lensContext, prefetch: isPrefetch,
          scenarioContext, conversationHistory, question } = body;

  /* ── FOLLOW-UP CONVERSATION (IFA Advisory Brief thread) ── */
  if (type === 'follow-up') {
    if (!question) {
      return new Response(JSON.stringify({ error: 'question required' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    const { lensContext: fuLensContext, lensLabel: fuLensLabel } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const authHeader = req.headers.get('Authorization') || '';
    const sseHeaders = {
      ...CORS_HEADERS,
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    };
    const enc = new TextEncoder();
    const sseChunkFU = (obj) => enc.encode('data: ' + JSON.stringify(obj) + '\n\n');

    const fuStream = new ReadableStream({
      async start(ctrl) {
        try {
          /* Credit gate — 10 credits per follow-up */
          const creditResult = await serverDeductCredits(
            authHeader, 10,
            `intel:follow-up:${(query || '').slice(0, 60)}`
          );
          console.log('[follow-up] creditResult:', JSON.stringify(creditResult));
          if (!creditResult.ok) {
            ctrl.enqueue(sseChunkFU({ type: 'error', code: creditResult.status || 402, message: creditResult.error || 'insufficient_credits', balance: creditResult.balance || 0 }));
            ctrl.close(); return;
          }

          /* Build context block — goes into first user message, not system prompt */
          const ctxLines = [];
          if (query) ctxLines.push('ORIGINAL SCENARIO: "' + query + '"');
          if (scenarioContext) {
            if (scenarioContext.situation)        ctxLines.push('SITUATION: ' + scenarioContext.situation);
            if (scenarioContext.brokerBrief)       ctxLines.push('HOW TO POSITION: ' + scenarioContext.brokerBrief);
            if (scenarioContext.keyConsiderations && scenarioContext.keyConsiderations.length)
              ctxLines.push('KEY CONSIDERATIONS:\n' + scenarioContext.keyConsiderations.map(c => '- ' + c).join('\n'));
            if (scenarioContext.riskFlags && scenarioContext.riskFlags.length)
              ctxLines.push('RISK FLAGS:\n' + scenarioContext.riskFlags.map(r => '- ' + r).join('\n'));
          }
          if (fuLensContext) ctxLines.push('⚠ ACTIVE ASSET LENS — PITCH THIS ASSET ONLY: ' + (fuLensLabel || '') + '\n' + fuLensContext);

          const contextBlock = ctxLines.join('\n\n');

          /* Build messages: inject context into first user turn, then history, then new question */
          const history = Array.isArray(conversationHistory) ? conversationHistory : [];
          const msgs = [];
          if (history.length >= 2) {
            /* Subsequent question — prepend context to first history message */
            msgs.push({ role: 'user', content: contextBlock + '\n\n' + history[0].content });
            for (let i = 1; i < history.length; i++) msgs.push(history[i]);
            msgs.push({ role: 'user', content: question });
          } else {
            /* First question — context + question as one message */
            msgs.push({ role: 'user', content: contextBlock + '\n\nBROKER QUESTION: ' + question });
          }

          const sysPrompt = FOLLOW_UP_SYSTEM;

          let fuTimedOut = false;
          const fuKill = setTimeout(() => {
            fuTimedOut = true;
            try { ctrl.enqueue(sseChunkFU({ type: 'error', message: 'timeout' })); ctrl.close(); } catch {}
          }, 25000);

          let anthropicResp;
          try {
            anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31', 'content-type': 'application/json' },
              body: JSON.stringify({
                model:      'claude-haiku-4-5-20251001',
                max_tokens: 600,
                stream:     true,
                system:     [{ type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } }],
                messages:   msgs,
              }),
            });
          } catch (fetchErr) {
            clearTimeout(fuKill);
            ctrl.enqueue(sseChunkFU({ type: 'error', message: 'fetch_error' }));
            ctrl.close(); return;
          }

          if (!anthropicResp || !anthropicResp.ok) {
            clearTimeout(fuKill);
            ctrl.enqueue(sseChunkFU({ type: 'error', message: 'anthropic_error' }));
            ctrl.close(); return;
          }

          const reader  = anthropicResp.body.getReader();
          const decoder = new TextDecoder();
          let lineBuf   = '';
          let lastEvent = '';
          let fullText  = '';

          try {
            while (true) {
              if (fuTimedOut) break;
              const { done, value } = await reader.read();
              if (done || fuTimedOut) break;
              lineBuf += decoder.decode(value, { stream: true });
              const lines = lineBuf.split('\n');
              lineBuf = lines.pop();
              for (const line of lines) {
                if (line.startsWith('event: '))      { lastEvent = line.slice(7).trim(); }
                else if (line.startsWith('data: ')) {
                  if (lastEvent === 'content_block_delta') {
                    try {
                      const evt = JSON.parse(line.slice(6));
                      if (evt.delta && evt.delta.type === 'text_delta' && evt.delta.text) {
                        fullText += evt.delta.text;
                        ctrl.enqueue(sseChunkFU({ type: 'text-delta', text: evt.delta.text }));
                      }
                    } catch {}
                  }
                } else if (line === '') { lastEvent = ''; }
              }
            }
          } finally {
            clearTimeout(fuKill);
            reader.cancel().catch(() => {});
          }

          if (!fuTimedOut) {
            ctrl.enqueue(sseChunkFU({ type: 'text-done', text: fullText }));
          }
          ctrl.close();
        } catch (err) {
          try { ctrl.enqueue(sseChunkFU({ type: 'error', message: err.message || 'unknown' })); ctrl.close(); } catch {}
        }
      },
    });
    return new Response(fuStream, { headers: sseHeaders });
  }

  if (!query) {
    return new Response(JSON.stringify({ error: 'query required' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const apiKey   = process.env.ANTHROPIC_API_KEY;
  const isScenario = type === 'scenario';
  const isPitchPlaybook = section === 'pitch-playbook' && (type === 'concept' || type === 'company' || type === 'scenario');
  const isCompanyPitch = type === 'company' && section === 'pitch-playbook';
  const isCfaAnalysis = isScenario && section === 'cfa-analysis';

  /* Cache key — same namespace as search.js */
  const lensTag  = lensKey ? ':' + lensKey : '';
  const sectionTag = section ? ':' + section : '';
  const cacheKey = isPitchPlaybook
    ? 'search9:pitch-playbook:' + (ticker || query.trim().toLowerCase().slice(0, 80)) + lensTag
    : type === 'concept'
      ? 'search9:concept-slim:' + query.trim().toLowerCase().slice(0, 80) + lensTag
      : 'search9:' + type + ':' + (ticker || query.trim().toLowerCase().slice(0, 80)) + lensTag + sectionTag;

  /* Credit cost — concept sections 10; all AI briefs (IFA/scenario/concept/CFA) 25; company 25 */
  const creditCost = (type === 'company') ? 25 : (type === 'concept' && section) ? 10 : 25;

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
        /* ── PREFETCH MODE (background warm-up, no credits charged) ──
           _prefetchCompanyPitch sends prefetch:true. We populate the cache
           silently. Credits are only charged when the user actually clicks
           the Pitch Playbook button (isPrefetch=false below).
           Auth is still required — only valid subscribers may trigger prefetch. */
        if (isPrefetch && (isPitchPlaybook || isCfaAnalysis)) {
          /* Verify JWT even on prefetch — no free ride for unauthenticated callers */
          const sk = process.env.SUPABASE_SERVICE_KEY;
          if (!sk || !authHeader.startsWith('Bearer ')) {
            ctrl.enqueue(sseChunk({ type: 'error', code: 401, message: 'unauthorized' }));
            ctrl.close(); return;
          }
          const prefetchUserResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: sk, Authorization: authHeader },
          });
          if (!prefetchUserResp.ok) {
            ctrl.enqueue(sseChunk({ type: 'error', code: 401, message: 'unauthorized' }));
            ctrl.close(); return;
          }
          const prefetchUser = await prefetchUserResp.json();
          if (!prefetchUser || !prefetchUser.id) {
            ctrl.enqueue(sseChunk({ type: 'error', code: 401, message: 'unauthorized' }));
            ctrl.close(); return;
          }
          const alreadyCached = await cacheGet(cacheKey);
          if (alreadyCached) { ctrl.close(); return; } /* already warm */
          /* Auth confirmed — fall through to AI call, no credit deduction */
        } else {
          /* ── Standard flow ── */

          /* Credits always charged first — cache is TBT's cost-saver, not a free ride for users.
             User pays on every request; if cached, served instantly (TBT saves the AI call). */
          const desc = isCfaAnalysis
            ? `intel:ifa-cfa-analysis:${query.slice(0, 60)}`
            : isPitchPlaybook
              ? `intel:${type}:pitch-playbook:${ticker || query.slice(0, 60)}`
              : `intel:${type}:${ticker || query.slice(0, 60)}`;
          const creditResult = await serverDeductCredits(authHeader, creditCost, desc);
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
          /* Credits deducted — check cache for instant response (no AI cost to TBT) */
          if (!isScenario || isPitchPlaybook || isCfaAnalysis) {
            const cached = await cacheGet(cacheKey);
            if (cached) {
              ctrl.enqueue(sseChunk({ type: 'cache', data: cached }));
              ctrl.close();
              return;
            }
          }
        }

        /* ── Build prompt ── */
        const lensAppend = (!isScenario && lensContext)
          ? (isCompanyPitch
            ? `\n\nACTIVE BROKER LENS — CRITICAL OVERRIDE: The investment destination is the physical asset described below — NOT the company equity. Every pitch field must use this company's data as the conversation HOOK and explicitly BRIDGE toward this asset as the close:\n${lensContext}`
            : `\n\nACTIVE BROKER LENS — tailor ALL pitch content specifically to this asset class context:\n${lensContext}`)
          : '';
        const isScenarioPitch = isScenario && isPitchPlaybook;
        /* CFA: 2200 tok. Pitch: 2000. Scenarios: 1800. Concept slim: 400. Company: 1200. */
        const maxTok  = isCfaAnalysis ? 3000 : isPitchPlaybook ? 2000 : isScenario ? 1800 : (type === 'concept' ? 400 : 1200);
        const sysPrompt = isCfaAnalysis ? CFA_SYSTEM : isPitchPlaybook ? PITCH_SYSTEM : type === 'concept' ? CONCEPT_SYSTEM : SEARCH_SYSTEM;
        let userMsg;
        if (isCfaAnalysis)           userMsg = CFA_ANALYSIS_PROMPT(query);
        else if (isScenarioPitch)    userMsg = SCENARIO_PITCH_PROMPT(query) + lensAppend;
        else if (isScenario)         userMsg = SCENARIO_PROMPT(query) + lensAppend;
        else if (isCompanyPitch)     userMsg = COMPANY_PITCH_PROMPT(query) + lensAppend;
        else if (isPitchPlaybook)    userMsg = PITCH_PLAYBOOK_SECTION_PROMPT(query) + lensAppend;
        else if (type === 'concept') userMsg = CONCEPT_SLIM_PROMPT(query);
        else                         userMsg = COMPANY_PROMPT(query) + lensAppend;

        /* ── Hard 20s kill for the ENTIRE streaming operation (headers + body).
           The previous pattern cleared the timer after the initial fetch() resolved
           (i.e. when HTTP headers arrived), leaving the body-reading loop unguarded.
           This timer wraps everything — if Anthropic hasn't finished in 20s the
           client gets an SSE error event and can fall back to the buffered endpoint. ── */
        let streamTimedOut = false;
        const streamKill = setTimeout(() => {
          streamTimedOut = true;
          try {
            ctrl.enqueue(sseChunk({ type: 'error', message: 'timeout' }));
            ctrl.close();
          } catch {}
        }, 30000);

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
          });
        } catch (fetchErr) {
          clearTimeout(streamKill);
          if (!streamTimedOut) {
            ctrl.enqueue(sseChunk({ type: 'error', message: 'fetch_error' }));
            ctrl.close();
          }
          return;
        }

        if (!anthropicResp || !anthropicResp.ok) {
          clearTimeout(streamKill);
          const errTxt = anthropicResp ? await anthropicResp.text().catch(() => '') : '';
          if (!streamTimedOut) {
            ctrl.enqueue(sseChunk({ type: 'error', message: 'anthropic_error', detail: errTxt.slice(0, 200) }));
            ctrl.close();
          }
          return;
        }

        /* ── Forward SSE deltas ── */
        const reader  = anthropicResp.body.getReader();
        const decoder = new TextDecoder();
        let lineBuf   = '';
        let lastEvent = '';
        let fullText  = '';

        try {
          while (true) {
            if (streamTimedOut) break;
            const { done, value } = await reader.read();
            if (done || streamTimedOut) break;

            lineBuf += decoder.decode(value, { stream: true });
            const lines = lineBuf.split('\n');
            lineBuf = lines.pop();

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
        } finally {
          clearTimeout(streamKill);
          reader.cancel().catch(() => {});
        }

        if (streamTimedOut) return; /* kill timer already sent error event */

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
            try {
              parsed = JSON.parse(fullRepair(raw));
            } catch {
              console.warn('[search-stream] parse failed after fullRepair — raw_end:', raw.slice(-200));
              ctrl.enqueue(sseChunk({ type: 'error', message: 'parse_error' }));
              ctrl.close();
              return;
            }
          }
        }

        /* ── Cache + done ── */
        if (!isScenario) cacheSet(cacheKey, parsed);

        ctrl.enqueue(sseChunk({ type: 'done', data: parsed }));
        ctrl.close();

      } catch (err) {
        try {
          ctrl.enqueue(sseChunk({ type: 'error', message: err.message || 'unknown_error' }));
          ctrl.close();
        } catch {}
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
};
