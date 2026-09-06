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

function logSearch(query, type, lensKey, section, cacheHit, ticker) {
  if (!SUPABASE_KEY) return;
  fetch(`${SUPABASE_URL}/rest/v1/intel_searches`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      query:     (query || '').slice(0, 200),
      type:      type    || null,
      lens_key:  lensKey || null,
      section:   section || null,
      cache_hit: !!cacheHit,
      ticker:    ticker  || null,
    }),
  }).catch(() => {}); /* fire-and-forget — never blocks the response */
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

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

CERTAINTY SCALE: write every pitch at 9/10 certainty. Confident. Factual. Specific. Certainty in the language is the carrier wave — the right words on a hesitant frequency do not land.

═══════════════════════════════════════════════════
PSYCHOLOGY — APPLY ACROSS EVERY PITCH PLAYBOOK
═══════════════════════════════════════════════════

KAHNEMAN & TVERSKY — PROSPECT THEORY:
- Loss aversion coefficient: losses felt 2-2.5x more painfully than equivalent gains feel pleasurable. Always frame the cost of inaction as a specific, calculated loss BEFORE framing the benefit of action. "£500k at 5% inflation loses £73,500 in purchasing power over three years" — the loss frame operates whether the client realises it or not.
- Four-fold pattern: certain gains → risk aversion (offer tax relief certainty first); low-probability gains → risk seeking (frame asymmetric upside last); holding a losing position → risk seeking (they hold it hoping for recovery — redirect do not argue); low-probability catastrophic loss → risk aversion (name the insurance-style structural features explicitly).
- Reference point manipulation: set the reference point as "current purchasing power in three years at current inflation" — not the nominal balance. From that reference point, holding cash IS a loss. The alternative asset IS a gain.
- Status quo bias: inertia is the primary competitor. "Have you ever calculated your real return after inflation over the last three years?" They almost never have. That question changes the conversation.
- Availability heuristic: clients overweight recent events. Counter recency bias by expanding the time horizon — "what did this concern look like in [historical parallel year] and what happened to people who acted on it?"
- Peak-End Rule: prospects remember only two moments — the peak (most intense insight) and the end. Engineer both. End on a statement of conviction: "The people who act now are the ones who look back at this period as the moment they got ahead of the curve."
- System 1 decides; System 2 rationalises. 95% of decisions are made by System 1 — trust, likability, cognitive ease all operate there. When a client raises a logical objection it is usually a System 2 rationalisation of a System 1 discomfort. Address the feeling first: "It sounds like something about this doesn't feel settled yet — what is it?"

CIALDINI — INFLUENCE + PRE-SUASION:
- Authority: name institutional actors (central banks, sovereign wealth funds, endowments, Harvard/Yale endowments). "The people who run the printing presses are buying the thing that cannot be printed" > any self-claim.
- Social proof: match to the client's identity group. UHNW clients respond to UHNW peer behaviour. First-time alternative investors respond to "most clients in your situation."
- Scarcity: real scarcity only — rate windows, EIS tranche closes, tax year deadlines. Name the exact mechanism. Never manufactured.
- Commitment & consistency: anchor to beliefs the prospect has already stated. "You said non-correlated assets belong in a well-constructed portfolio — what percentage of your portfolio is currently in non-correlated assets?"
- Contrast principle: introduce a high reference point before stating the allocation. "Central bank buying runs to hundreds of billions per year. The position we are discussing represents a fraction of what institutional investors commit to this category in a single quarter."
- Pre-Suasion privileged moment: what you make salient before the pitch determines the evaluative frame. Lead the pitch with: "What is the thing you most want to protect about what you have built?" Their answer becomes the frame through which every subsequent fact is evaluated.
- Unity principle: establish shared identity before the ask. Identify the prospect's tribe (business builders, self-made HNWIs, wealth-to-preservation stage) and mirror their self-concept.
- "Because" effect: every request carries a genuine reason. "I want to discuss this now because [specific data point] has changed the timing calculus in a way we have not seen since [historical parallel]."
- Rejection-then-retreat: start with the full allocation; retreat to a smaller first position if declined. Follow-through rate 85% vs 50% for non-negotiated agreements.

CHRIS VOSS — TACTICAL EMPATHY:
- Label emotions before addressing logic: "It seems like there has been an experience in this space that did not deliver what was promised." Then silence. The label validates without arguing.
- Mirror the last 2-3 words with an upward inflection. The prospect always expands — the expansion contains the real objection.
- Calibrated questions over closed ones: "What is it about the timing that concerns you?" not "Is it the timing?"
- No-oriented questions create safety: "Would it be completely off-base to suggest that a 5-10% non-correlated allocation could strengthen your position?" — "no, that would not be off-base" = yes without resistance.
- "That's right" vs "you're right": engineer "that's right" by summarising their position better than they articulated it. "That's right" = genuine buy-in. "You're right" = polite brush-off.
- Accusation audit in opening lines: name the likely objection before they raise it. "I know what I'm about to say might sound like a sales pitch — so let me start with the data."
- Black Swans: every conversation contains unknown information that would change your strategy. Surface it with: "What's usually gotten in the way when you've looked at opportunities like this?"
- Email / follow-up: no-oriented subject lines ("have you moved in a different direction?"). Mirror one phrase from their last message. Close with one "how" or "what" question — never "let me know your thoughts."

RACKHAM — SPIN SELLING:
- In major sales, features generate objections. Benefits tied to an explicit stated need generate agreement. Only pitch features that directly address something the client has already said they want.
- Implication questions amplify problem size: "You mentioned the current yield is 2.5% against 4% inflation. On £500k over ten years compounded, that is approximately £79,000 in lost purchasing power. Does that number concern you?"
- The spinQuestion is the most important output. Write it as a genuine question the broker asks after the pitch. The answer the client gives is their close.

ARIELY — PREDICTABLY IRRATIONAL:
- IKEA Effect: involve the prospect in building the frame before presenting the solution — "what would a good outcome look like in five years?" Their effort creates co-ownership of the conclusion.
- Arbitrary coherence: the first number heard anchors all subsequent valuations. Lead with high comparable values (auction results, institutional figures, tax relief amounts) BEFORE stating the entry price or minimum.
- Price-placebo effect: never apologise for fees — explain them as a structural feature. "The minimum is £X because below it the cost-benefit does not work."
- Relativity: control the comparison set before sharing data. "Hold two comparisons in mind: an equity ISA at 6% with full market correlation, and cash at 0.4% real. Here is how this sits against both."
- Moral reminder effect: when clients raise ethical concerns, acknowledge them fully and specifically. The client who feels their values have been respected is the client who acts.

NAPOLEON HILL — THINK AND GROW RICH:
- Discover the burning desire before pitching anything: "What is the financial outcome you are actually working toward right now — specifically?" Pitch the product as the vehicle for THEIR stated goal, not your product's features.
- Repetition + emotion = belief: identify one core theme and weave it through every field. Familiarity breeds credibility (illusory truth effect).
- Decision velocity: "In your experience, has waiting for certainty in investment decisions usually produced better outcomes?"

NASSIM TALEB — ANTIFRAGILE / BLACK SWAN:
- Antifragility frame: physical assets gain from volatility, they do not merely survive it. "Every shock to the financial system since 2008 has increased the strategic case for assets outside the banking system — not just preserved it."
- Barbell architecture: the allocation is the asymmetric edge of a conservative barbell. The ask is not "replace your safe assets" — it is "add optionality to the edge."
- Fat tail asymmetry: frame real assets' downside as structurally bounded (intrinsic scarcity) while the upside is open-ended. Bounded downside is the most powerful argument given loss aversion.

HOWARD MARKS — THE MOST IMPORTANT THING:
- Second-level thinking: deliver the insight behind the headline, not the headline itself. First-level: "inflation is elevated." Second-level: "which assets have historically repriced fastest in the 12-month window after CPI peaks at this level — and who is currently positioned for that?"
- Pendulum position: communicate where the asset class sits on the sentiment cycle with specific data — positioning surveys, institutional flows, valuation multiples vs history.
- Cycle literacy: leave the client with a mental model of the cycle, not just a recommendation. Clients who understand the cycle trust the broker who taught it to them.

THALER & SUNSTEIN — NUDGE:
- Default framing: the recommended allocation IS the default. Present it specifically ("10% of investable assets, which in your case is approximately £X") before asking about adjustments. Never ask open-ended "how much would you consider?"
- Choice architecture: present three options with the target in the middle. Centre option selected most frequently.
- Mental accounting: recode where the money currently lives. "This is not moving money from safe to risky — it is moving money from a guaranteed purchasing-power loss to a structured position with a defined floor."
- Sludge elimination: end every pitch with the simplest possible next step. "The only thing I need from you today is [one specific thing]."

FESTINGER — COGNITIVE DISSONANCE:
- Socratic dissonance: "You said non-correlated assets belong in a well-constructed portfolio. What percentage of your portfolio is currently in non-correlated assets?" The gap between belief and allocation IS the close.
- Commitment escalation: every small yes makes the next yes psychologically consistent. The spinQuestion is a micro-commitment — the client who answers it affirmatively has already made the decision.

ROBERT SHILLER — NARRATIVE ECONOMICS / CAPE:
- Narrative economics: markets are driven by viral narratives that spread contagiously before prices adjust. Identify the current macro narrative. The investor who acts before the narrative goes fully mainstream captures the full return.
- CAPE ratio: Shiller's cyclically adjusted P/E has predicted 10-year real equity returns with ~0.90 correlation since 1880. When CAPE exceeds 30, forward real returns have averaged near zero or negative. "This is not a market call — it is a statistical base rate most retail investors have never seen."
- Excess volatility: stock prices are 5-13x more volatile than justified by dividend changes. Price volatility is emotional noise, not fundamental signal.

BEHAVIOURAL FINANCE — RESEARCHERS:
- Gigerenzer: in uncertain environments, simple structural rules beat complex models. The three-question heuristic: structural supply constraint that cannot be reversed? Non-cyclical demand? Outside the correlated financial system? Yes to all three — it belongs.
- Slovic (affect heuristic): negative feelings toward an asset class produce high risk / low benefit judgements regardless of data. More data will not fix negative affect. Name the source of the feeling. Distinguish it from the current opportunity. Then rebuild positive affect through institutional social proof.
- Ellsberg (ambiguity aversion): alternatives feel riskier not because they are — but because their risks are less familiar. Counter: make the specific risk parameters as concrete as the equity risk they are already comfortable with: the floor, the IHT qualification, the exit mechanism.
- Shefrin & Statman (disposition effect): investors realise winners 67% more often than losers; held losers underperform by 3.4% per year. "If you had the current value of that position in cash today, would you buy it again at today's price?" The answer unlocks frozen capital.
- Barber & Odean (overtrading): most active traders underperform by 6.5% per year. Illiquidity is not a bug — it is the mechanism that prevents the behaviours that destroy returns.
- De Bondt & Thaler (overreaction): assets that performed worst over the prior 3-5 years outperformed by 24.6% in the subsequent period. "The asset class that feels most uncomfortable right now is almost always the one with the most remaining upside."

COGNITIVE BIASES:
- Planning fallacy: the better moment to act is always imagined more clearly than it arrives. "The investors who build robust portfolios do so now, in imperfect conditions — not in perfect conditions that do not come."
- Narrative fallacy: humans build causal stories from loosely connected events. Use this — a story beats a statistic every time in System 1. Every pitch must contain one compelling narrative: who is doing this, why now, who has yet to act, what the world looks like when they do.
- Hindsight bias: "In five years, the investors who acted on the data available today will feel they always knew. The question is whether you are one of them — with the position — or watching from outside."
- Choice overload (Iyengar & Lepper): 24 options converted 3%; 6 options converted 30%. Present ONE specific recommendation with ONE specific allocation — never a menu.
- Base rate neglect: clients ignore statistical base rates when a vivid story is present. "The thesis makes sense — I agree. But let us check it against the base rate. Of investments structured this way in this environment, held for 10-year periods, what has the return distribution looked like historically?"

SOCIAL PSYCHOLOGY:
- Asch conformity: 75% of people gave clearly wrong answers when a group gave that answer first. One dissenter dropped conformity from 37% to 5-6%. Name a sophisticated consensus group (central banks, university endowments, Norwegian sovereign wealth fund) to give the client a group to conform TO instead of the mainstream.
- Latané & Darley (bystander effect): generic communications diffuse responsibility. Personalised communications concentrate it. Always connect the thesis to the client's SPECIFIC situation with at least one personalised data point. The client who believes the message was written for them is the client who acts.
- Bandura (self-efficacy): a client with low investment efficacy ("I don't really understand these things") will not act regardless of how good the opportunity is. Build efficacy before the ask: "You understood the macro case faster than most people I speak to."

NEUROSCIENCE:
- Sapolsky / Coates (cortisol): stressed investors are systematically more risk-averse than their actual preferences. Do not fight it with more data. Name the emotional state first: "The volatility is real. The question is whether the response to that feeling serves your medium-term interest." Naming the state reduces cortisol.
- Damasio (somatic marker hypothesis): emotion is a prerequisite for decisions, not the enemy. A purely logical case gives the brain no emotional compass. The client who has received only data experiences "I do not know how I feel about it" and delays. Build the somatic marker through vivid future-pacing and stories of specific other investors who felt what they feel and acted.
- Loewenstein (hot-cold empathy gap): calm-state clients cannot accurately predict their stressed-state behaviour. Wire in the drawdown response during the calm conversation: "If this position is down 20% in month 18 — before it recovers — can we agree now that the correct response is to hold? The clients who benefit most decided their drawdown response in advance."
- Schultz (dopamine / anticipation): dopamine fires in anticipation of reward, not receipt. The anticipated future is more motivating than the reported past. "Imagine the moment when this macro thesis shows up in your portfolio statement" > "our clients averaged X% last year."

NLP — LANGUAGE PATTERNS:
- VAK detection: VISUAL clients say "I see", "show me", "looks right" — use show/picture/outlook language, send charts. AUDITORY clients say "sounds right", "rings true" — tone and rhythm matter most, talk them through it. KINAESTHETIC clients say "doesn't feel right", "sit with that" — slow down, use silence, say "feel certain", "solid foundation". Never mix sensory systems in one sentence.
- Presuppositions: assume the truth of the close within the sentence structure. "When you add this to your portfolio" not "if you decide to." "After you have seen year-two performance" presupposes they are still a client.
- Embedded commands: deliver commands within a larger sentence with a slight tonal shift on the command words. "I do not know exactly when you will FEEL READY TO COMMIT, but I want you to TAKE THIS SERIOUSLY."
- Pacing and leading: three undeniable true statements about their current situation → then lead to the desired conclusion. The first three build credibility; the fourth inherits it.
- Meta Model: recover the real specific objection from vague surface language. "I'm worried" → "Worried about what specifically?" "I need to think about it" → "What specifically do you need to think about?" "These things never work" → "Never? What is the one exception?"
- As If frame: "Putting aside the timing question for a moment — just as IF it were resolved — what would your decision be?" Reveals whether the stated objection is load-bearing or a holding deflection.
- Future pacing (somatic marker installation): guide the prospect into a vivid sensory experience of having made the decision. Then contrast with the alternative. "It is two years from now. The allocation is returning X%. Your accountant says: that was the right call. How does that feel?" Then: "Now imagine the alternative — the position you considered is performing exactly as discussed, and you are watching from outside." Brief pause. Then close.

CARNEGIE / IANNARINO / DAWSON:
- Carnegie: never win an argument — find the truth in the objection first, agree with the surface, then redirect. "You are completely right — the liquidity profile is different from what you are used to, and that is a real consideration. Let me walk you through what it means in practice."
- Carnegie genuine interest: ask one more question than planned. Listen completely before formulating your response. Reference their answer later in the call. The broker who is genuinely curious about every client's story builds the most durable book.
- Iannarino nine commitments: deals are lost not at the close but by failing to secure prerequisites. The sequence: Time → Explore → Change → Collaborate → Consensus → Invest → Review → Decide → Act. Never end a call without a named commitment from both parties for the next step.
- Dawson Flinch: visible/audible reaction to a too-low offer. "£5,000?" [pause, slight recalibration]. Then: "I want to be straight with you — at that level the structural benefit of this position changes fundamentally." No argument. Pure asymmetric pressure.
- Dawson Vice: "You will have to do better than that." Then complete silence. The prospect moves first.
- Dawson reluctant concession: never give a concession without visible reluctance. A concession given flatly signals more room exists. Visible deliberation signals you are at your floor.

ROBERT GREENE — LAWS OF HUMAN NATURE:
- Read the dominant emotional driver before pitching: security (protect what is built), status (signal sophistication), autonomy (own the decision), validation (confirm their instincts), legacy (build something that outlasts them). Pitch only to the dominant driver.
- Strategic listening: the most important information is what the client omits, qualifies, or rushes past. Note every qualifier ("probably", "maybe", "I suppose") and every rapid subject change. The omission is always the real objection.
- Law of absence: after the pitch is complete, create deliberate space — do not fill it. "I will leave it there. I have told you everything you need. I will be in touch later in the week." Absence makes the opportunity feel more real.

FOGG / MILGRAM / CHALLENGER:
- Fogg B=MAP: before applying more pitch (motivation), diagnose which element is missing. Motivation low → address the fear or aspiration first. Ability low → simplify to one specific small step. Prompt missing (most common with HNWIs) → create a specific credible forcing function: "Allocations close on the 30th — I would suggest we get the paperwork moving this week."
- Milgram incremental commitment: never ask for the final decision first. Build a sequence of small agreements: "Can we agree that non-correlated assets should be part of a well-constructed portfolio?" → "And that tax efficiency matters at your income level?" → "Given those two things — what is the argument for not doing this today?"
- Challenger commercial insight: teach them a problem they did not know they had before introducing the product as the natural response. "Most business owners at your level assume their pension allowance is the primary tax shelter. Since the LTA changes, the EIS route often produces better after-tax outcomes on gains above £250k."

BANK RULE (ONLY for banks/lenders — Barclays, HSBC, Lloyds, JPMorgan, etc.):
The pitch angle is PROFIT EXTRACTION — not "banks might fail." Key facts:
- Fractional reserve banking: the bank immediately lends out most of your deposit and earns on YOUR capital. You get a fraction back as interest.
- ESLR leverage: UK banks hold roughly 3.25% Tier 1 capital against total exposures — about £30 deployed for every £1 held. Your deposit is raw material for a leveraged profit machine.
- The yield gap: banks pay savers 1-3%, charge mortgage borrowers 4-7%. They keep the spread. The depositor is the silent investor earning the worst return in the room.
- Real return: after income tax (20-40%) and UK CPI inflation (2-5%), most easy-access accounts deliver a negative real return. The bank profits. The saver loses purchasing power.
- Misconduct: PPI mis-selling cost the UK banking industry £38bn. LIBOR rigging, forex manipulation, money laundering fines — all documented facts.
- Bonus culture: the banker bonus cap was removed in October 2023. Banks never invest their own institutional capital into their own savings products — they use markets, bonds, equity. Their clients get the cash ISA. Their staff get the performance bonus.
- FSCS: £120,000 per person per authorised institution. Joint accounts £240,000. Beyond this, the depositor is an unsecured creditor.
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

/* ── SCENARIO / IFA ADVISORY PROMPT ── */
const SCENARIO_PROMPT = (query) => `An investment professional has described the following client scenario or preparation task:

"${query}"

Analyse this as a senior wealth strategist would. Return ONLY this exact JSON:
{
  "type": "scenario",
  "title": "2-4 word brief title for this scenario",
  "situation": "Plain English summary of the client's situation and key facts (2-3 sentences)",
  "keyConsiderations": [
    "Most important planning consideration — be specific",
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
  "brokerBrief": "2-3 sentence plain English brief: what to say to this client, what angle to lead with, and what need-payoff question to close on. Asset-neutral pitch framing.",
  "openingLine": "The exact first sentence to say to this client on the call — a question or statement that shows you understand their situation. Not a pitch."
}

IMPORTANT: solutionAreas should only include asset classes genuinely relevant to this client's situation. Include 2-5 areas. Be specific to the scenario — not generic. CRITICAL: never use double-quote characters inside string values.`;

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
    /* Detect conversational / scenario queries: 5+ words or sentence-like */
    const wordCount = q.trim().split(/\s+/).length;
    const isScenario = wordCount >= 5 || /\b(client|meeting|ifa|preparing|portfolio|invest|advise|scenario|fact.find|sipp|isa|pension|planning)\b/i.test(q);

    if (isScenario) {
      /* Skip Finnhub for scenarios — return only the scenario option */
      return {
        statusCode: 200,
        headers: { ...CORS, 'Cache-Control': 'no-store' },
        body: JSON.stringify([
          { type: 'scenario', label: `Advisory brief: "${q.length > 60 ? q.slice(0, 60) + '…' : q}"`, query: q },
        ]),
      };
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
      /* Always offer a concept / scenario search option */
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

    const { query, type, ticker, section, lensKey, lensContext } = body;
    if (!query) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'query required' }) };

    const isScenario = type === 'scenario';

    /* Scenarios: skip cache (bespoke per query), use more tokens */
    let cached = null;
    const lensTag = lensKey ? ':' + lensKey : '';
    const cacheKey = 'search:' + type + ':' + (section ? section + ':' : '') + (ticker || query.trim().toLowerCase().slice(0, 80)) + lensTag;

    if (!isScenario) {
      cached = await cacheGet(cacheKey);
      if (cached) {
        logSearch(query, type, lensKey, section, true, ticker);
        return {
          statusCode: 200,
          headers: { ...CORS, 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' },
          body: JSON.stringify(cached),
        };
      }
    }

    /* Lens context appended to non-scenario prompts */
    const lensAppend = (!isScenario && lensContext)
      ? `\n\nACTIVE BROKER LENS — tailor ALL pitch content (relevance, brokerNote, pitch playbook) specifically to this asset class context:\n${lensContext}`
      : '';

    let userMsg;
    if (isScenario) {
      userMsg = SCENARIO_PROMPT(query);
    } else if (section === 'overview') {
      userMsg = OVERVIEW_PROMPT(query, null) + lensAppend;
    } else if (section === 'pitch') {
      userMsg = PITCH_PROMPT(query) + lensAppend;
    } else {
      userMsg = (type === 'concept' ? CONCEPT_PROMPT(query) : COMPANY_PROMPT(query, null)) + lensAppend;
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
          max_tokens: isScenario ? 3000 : 2000,
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

      if (!isScenario) cacheSet(cacheKey, parsed); /* fire-and-forget; scenarios not cached */
      logSearch(query, type, lensKey, section, false, ticker); /* fire-and-forget */

      return {
        statusCode: 200,
        headers: { ...CORS, 'Cache-Control': isScenario ? 'no-store' : 'public, max-age=3600', 'X-Cache': 'MISS' },
        body: JSON.stringify(parsed),
      };
    } catch (e) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
