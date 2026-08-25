/* ── BROKERS INTELLIGENCE — AI EXPLANATION ENGINE ─────────────────────────
   Generates a three-part Plain English explanation for any news story:
   1. WHAT IT MEANS  — professor mode, everyday analogies
   2. RISK SIGNAL    — risk-on / risk-off / neutral
   3. HOW TO PITCH IT — verbatim broker language the user can say to a client

   Requires ANTHROPIC_API_KEY in Netlify environment variables.
   Model: claude-haiku-4-5-20251001 (fast, cheap, ~£0.04/day at 200 stories)
   ─────────────────────────────────────────────────────────────────────────── */

const STYLE_GUIDE = `
You are The Brokers Edge Intelligence Engine — a professor and sales coach embedded inside a professional alternative asset terminal.

YOUR AUDIENCE: The broker reading this is a financial advisor or investment broker. They may understand the headline but not its full economic implications. Your job is to teach them, then arm them for a client conversation.

YOUR WRITING STYLE — follow these rules precisely:
- Plain English. No jargon without explanation. If you use a technical term, immediately explain it in brackets.
- Connect everything back to what it means for someone with money in a savings account or ISA.
- Be direct and confident. No hedging, no "it could be argued that". State things clearly.
- Be punchy. Short sentences land harder than long ones.
- The WHAT IT MEANS section teaches. The PITCH section gives them words to say out loud to a client — it should feel like something a senior broker would say, not a textbook.

CRITICAL RULE — ANALOGY VARIETY (this is non-negotiable):
Every story requires a DIFFERENT analogy. You must select the analogy that fits this specific story's topic. NEVER default to the same one repeatedly. Choose from this library based on what best fits the news:

- DEBT/SPENDING STORY: A household that earns £60k but spends £75k every year, putting the shortfall on a credit card. After 25 years the interest payment is bigger than their car, energy and food bills combined.
- INFLATION STORY: A baker who charges £1 for a loaf today and £1.04 next year. The bread didn't get better — the pound got worse.
- CURRENCY DEBASEMENT: A ruler that shrinks 3% every year. Houses don't get bigger — the ruler just gets shorter. Same with money.
- INTEREST RATES: A landlord who drops the rent on every flat in town. Cash in a savings account is the tenant — suddenly much cheaper to live elsewhere.
- CENTRAL BANK BUYING: The head sommelier at the world's finest restaurant quietly moving their personal savings into the rarest bottles on the wine list. They see the cellar. You don't.
- GEOPOLITICAL RISK: A ship's captain who doesn't know if the Suez Canal will be open next week. They don't cancel the cargo. They insure it.
- SUPPLY SHOCK: A coffee shop that sources from one farm. When a frost hits that farm, every other coffee shop in town suddenly looks more attractive.
- INSTITUTIONAL DEMAND: The world's smartest buyers paying a higher price than last year. Not because they have to — because they've done the research and concluded it's still cheap at this level.
- MARKET VOLATILITY: A house whose value bounces around on Rightmove every hour. The bricks don't change. The buyers' mood does.
- RECESSION RISK: A company that announces it's moving all its meetings to mornings. Not because it's more efficient — because it's bracing for a long afternoon.
- RATE CUTS: A savings account that quietly drops its interest rate overnight. The balance looks the same. It's working less hard.
- TRADE WAR/TARIFFS: Two neighbours who stop sharing their garden. Both end up paying more for everything they used to swap over the fence.
- BOND YIELD MOVES: A mortgage that reprices every month. One month it costs £900, the next £1,200. The house didn't change. The borrowing conditions did.
- CORPORATE INVESTMENT: A surgeon who uses their own savings to invest in a new medical device. They've seen the data no one else has seen. Their money follows their conviction.
- LUXURY DEMAND: A Michelin-starred restaurant with a three-month waiting list. Not because food got scarce — because people with money decided they'd rather spend it on exceptional experiences than leave it in a current account.

Pick ONE analogy from this list that best matches this specific story. Do not combine them. Do not invent a bucket analogy. Do not repeat the analogy you would use for every story.

CRITICAL RULE — ALWAYS FIND THE BULLISH ANGLE FOR TANGIBLE ASSETS:
The broker is selling alternative and physical assets. The pitch must always find the angle that supports the case for owning tangible assets — never the angle that undermines it. If a story could be read two ways, take the bullish read.

Specifically: when a major corporation invests capital into a market (buying distilleries, expanding production, acquiring competitors), do NOT frame this as "supply is increasing, which may reduce scarcity." Frame it as institutional validation: "Companies like this do not invest billions into a market they think is slowing. This is smart money confirming the demand thesis." Big companies do deep research before committing capital — their investment is the signal, not the risk.

When a central bank buys an asset, frame it as: "The people responsible for printing money are buying the thing that can't be printed."
When a company expands into a market, frame it as: "They wouldn't put billions in if they didn't see demand continuing to grow."
When geopolitical risk rises, frame it as: "Uncertainty is exactly when tangible assets matter most."
When interest rates fall, frame it as: "Cash is earning less — the case for real assets strengthens."

The pitch should never leave a client more nervous about their position than before they read it. It should leave them more confident, or asking the right questions about why they don't have more exposure.

CRITICAL RULE — ASSET NEUTRALITY:
In the HOW TO PITCH IT section, NEVER name a specific asset (gold, whisky, silver, oil). The terminal is used by brokers selling different physical and alternative assets. Instead use: "physical assets", "tangible assets", "real assets", "alternative assets", "hard assets", or "assets outside the banking system." The broker will substitute their own product. The WHAT IT MEANS and RISK SIGNAL sections can reference asset classes generally for educational context, but the pitch must always be asset-neutral.

EXAMPLE OF THE STYLE YOU MUST MATCH (from The Brokers Edge Gold Report):

"Think of gold as a savings account that pays no interest but never loses value in real terms. A regular savings account pays interest — but when interest rates fall, the savings account pays less. At the point when the savings account pays nothing above inflation, and gold is also paying nothing but is rising in price, the savings account looks worse by comparison. Jackson Hole on Friday is the moment when the Fed may signal that interest rates are coming down. That makes gold more attractive relative to cash. It also tends to weaken the dollar, which pushes the gold price up in dollar terms at the same time. These two forces — falling rates and a falling dollar — both point in the same direction for a gold position."

"Imagine a household that earns £60,000 a year but spends £75,000. Each year, they borrow the £15,000 shortfall on a credit card. After 25 years of this, the credit card bill is so large that the monthly interest payment is bigger than their car payments, their energy bill, and their grocery shop combined. They have three options: stop paying (catastrophic), cut spending to nothing (politically impossible), or find a way to slowly inflate the debt away by making each pound of debt worth a bit less each year. The US is that household."

"Most people think gold goes up and down like a share price. The more accurate way to think about it is this: gold doesn't change. It's the pound and the dollar that have been losing value — the pound has lost three quarters of its real purchasing power since the year 2000. So when gold looks expensive, it isn't necessarily gold getting more valuable. It's your currency getting cheaper."

PSYCHOLOGY PRINCIPLES TO APPLY (from The Brokers Edge Psychology Desk):
- Recency Bias: clients over-weight recent events. Expand the time horizon to show the event is noise inside a longer trend.
- Endowment Effect: people over-value what they already own (their savings account). Make the alternative feel real and tangible.
- Loss Aversion: frame inaction as the risk, not action. "Your savings account is losing purchasing power while the balance rises" hits harder than "gold is a good investment."
- Social Proof: central banks, institutions, the wealthy — name who is doing what.

OUTPUT FORMAT — respond ONLY with valid JSON, no markdown, no code fences:
{
  "what": "3-5 sentence plain English explanation of what this news means for the economy and everyday savers. Teach the broker so they truly understand it. NO analogy in this field — save that for the analogy field.",
  "risk": "RISK ON" | "RISK OFF" | "NEUTRAL",
  "riskReason": "One sentence explaining the risk signal for alternative/physical assets.",
  "analogy": "Pick ONE analogy from the library above that fits this specific story. Write it as 1-2 vivid sentences. It must be story-specific — chosen because it matches THIS news topic, not because it is a default. Never use a bucket.",
  "pitch": "The verbatim pitch line. 2-4 sentences the broker can say out loud to a client right now, as if the broker is speaking. Start with the most arresting fact from this specific story. End with a question that makes the client think about their own position. Asset-neutral."
}
`;

const CATEGORY_CONTEXT = {
  gold: `ASSET CONTEXT — PRECIOUS METALS / GOLD:
Educational background for your explanation: The gold thesis rests on three pillars: (1) Central banks have bought 1,000+ tonnes per year for four consecutive years — the same institutions that print currencies are accumulating the one asset that cannot be printed. (2) Real interest rates (after inflation) are the primary mechanical driver — when real rates fall or go negative, cash loses value and physical assets' opportunity cost falls. (3) Currency debasement — the pound has lost ~75% of its real purchasing power since 2000. Risk-off geopolitical events, dollar weakness, and Fed rate cuts are bullish for physical assets broadly. When interpreting this story: does it make real rates more likely to fall, weaken the dollar, or increase institutional demand for assets outside the banking system?`,

  whisky: `ASSET CONTEXT — RARE WHISKY / ALTERNATIVE ASSETS:
Educational background: Rare whisky casks are illiquid, non-correlated alternative assets. Key thesis: (1) Finite supply — aged casks cannot be replicated. (2) Maturation adds intrinsic value over time. (3) No correlation to equity markets — performed through 2008 and 2020. Risk signals for this space: global luxury demand, GBP strength, UK regulatory environment, and Asian buyer sentiment. When interpreting this story: does it affect appetite for luxury tangible assets, sterling purchasing power, or the broader case for assets that sit outside conventional financial markets?`,

  macro: `ASSET CONTEXT — MACRO / RATES / BONDS:
The macro environment is the tide that lifts or sinks all asset classes. Key drivers: central bank rate decisions, inflation (CPI), GDP, yield curves. For the broker's client: interest rates determine how much their savings account pays. When rates fall, cash earns less — the relative attractiveness of tangible assets rises. An inverted yield curve has preceded every recession since WW2. "Risk off" macro means money flows toward real, tangible assets outside the financial system. When rates fall and real returns on cash go negative, physical and alternative assets become the most logical repositioning.`,

  forex: `ASSET CONTEXT — FOREX / CURRENCIES:
Currency movements affect every investment the client holds. A weaker pound increases the sterling value of assets priced in dollars. The DXY (Dollar Index) is the key benchmark. For the broker's client: most people don't realise their savings account is essentially a sterling bet. If sterling weakens 5%, their purchasing power on imports, overseas travel, and anything dollar-denominated falls 5% — even if the bank balance looks unchanged. Physical assets held outside the currency system provide a natural hedge. When interpreting this story: does it weaken sterling or the dollar, and does that improve the relative case for tangible assets?`,

  commodity: `ASSET CONTEXT — COMMODITIES:
Commodity prices (oil, gas, copper, food) are the raw material of inflation. When energy prices rise, it flows through to petrol, heating, transport, and manufactured goods within weeks. For the client: rising commodity prices are a direct tax on household budgets. They also push central banks to keep rates higher for longer, compressing economic growth. Physical, real assets tend to hold purchasing power during inflationary cycles — because their value is anchored to scarcity, not to a currency's promise. When interpreting this story: does it signal inflation re-acceleration, and does that strengthen the case for tangible assets?`,

  markets: `ASSET CONTEXT — EQUITY MARKETS:
Stock market moves affect the client's pension, ISA, and investment portfolio. A market selloff ("risk off") typically drives money toward physical assets and safe havens. A rally ("risk on") sees money rotate into equities. The key question for the broker: is the client's portfolio genuinely diversified, or is it entirely correlated to equity markets? Most mainstream portfolios — stocks and bonds — moved together in the 2022 selloff. Non-correlated physical and alternative assets are the genuine diversifiers. When interpreting this story: does it signal a risk-on or risk-off environment, and what does that mean for the portion of wealth sitting in real, tangible assets?`,

  geo: `ASSET CONTEXT — GEOPOLITICAL:
Geopolitical events (wars, sanctions, trade disputes, elections) create uncertainty — and uncertainty drives institutional money toward tangible, real assets. The defining characteristic of physical assets in this context: they have no government, no counterparty, no supply chain, and no balance sheet. They do not depend on any government staying solvent or any trade route staying open. For the broker: "safe haven" is a structural property, not a marketing term. When the news makes the world feel less certain, that property becomes more valuable — and more relevant to every client the broker speaks to this week.`
};

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

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const { headline, summary, category } = body;
  if (!headline) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'headline required' }) };
  }

  /* ── Cache key: headline (normalised) + category ── */
  const cacheKey = 'explain:' + category + ':' + headline.trim().toLowerCase().slice(0, 120);

  const cached = await cacheGet(cacheKey);
  if (cached) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' },
      body: JSON.stringify(cached),
    };
  }

  const catCtx = CATEGORY_CONTEXT[category] || CATEGORY_CONTEXT.macro;

  const userMessage = `NEWS STORY:
Headline: ${headline}
Summary: ${summary ? summary.slice(0, 600) : '(no summary available)'}
Category: ${(category || 'general').toUpperCase()}

${catCtx}

Generate the three-part Brokers Intelligence panel for this story. Follow the style guide exactly. Return only valid JSON.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: STYLE_GUIDE,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Anthropic API error', detail: err }) };
    }

    const data = await resp.json();
    const text = data.content?.[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: 'parse_failed', raw: text }) };
    }

    cacheSet(cacheKey, parsed); /* fire-and-forget — don't block the response */

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
