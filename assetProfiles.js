/* ── ASSET LENS PROFILES ─────────────────────────────────────────────────────
   The single source of truth for every asset class on the platform.
   All widgets read from window._assetLens — set by the lens selector.
   Fire window.dispatchEvent(new CustomEvent('lens:change')) after updating.
   ─────────────────────────────────────────────────────────────────────────── */

window.ASSET_PROFILES = {

  /* ── RARE WHISKY ── */
  whisky: {
    key:        'whisky',
    label:      'Rare Whisky',
    shortLabel: 'Whisky',
    icon:       '◈',
    tag:        'Alternative · Unregulated',
    category:   'tangible',
    regulated:  false,
    regulatory: 'Unregulated alternative investment — not FSCS protected',
    sipp:       false,
    eis:        false,
    liquidity:  'Illiquid',
    hold:       '5–10 years',
    minTicket:  '£5,000',
    thesis: [
      'Finite supply — distillery output cannot be retrospectively increased; every cask sold is irreplaceable',
      'Maturation premium — time adds intrinsic, measurable value independent of market conditions',
      'Non-correlation — cask returns have shown near-zero correlation to FTSE 100 through 2008, 2020, and 2022'
    ],
    openers: [
      '"Before I get into the reason for the call — have you seen what the HMRC statistics came out with on UK spirits exports? Rare Scotch is now Britain\'s single largest food and drink export. I\'m calling clients with meaningful cash positions because the window at current valuations will not be open indefinitely."',
      '"I want to give you a number. The Knight Frank Luxury Investment Index has tracked rare whisky for the last decade. Over that period it has outperformed gold, art, wine, and classic cars. Most people I speak to have never heard that. I wanted to make sure you had."',
      '"Scotland\'s 140 operating distilleries produced less new spirit last year than the year before. Supply is contracting. Demand — particularly from Asia — is growing. The arithmetic is straightforward, and it plays out over the hold period of a cask, not over a quarter."'
    ],
    objections: [
      { id:'w01', cat:'REGULATION',
        q:'"It\'s not regulated — that concerns me."',
        ack:'That\'s a completely reasonable thing to raise, and I\'d be concerned if you didn\'t.',
        redirect:'Unregulated doesn\'t mean unprotected — it means the asset isn\'t a financial product. The cask is a physical asset in a bonded HMRC warehouse with a title deed in your name. It doesn\'t need a regulator to have intrinsic value. In fact, the assets that destroyed wealth in 2008 — CDOs, structured products — were all regulated.',
        pivot:'"What specifically about the regulatory status concerns you? Is it the recourse if something goes wrong, or the perception of legitimacy? Because the answers to both are different."' },
      { id:'w02', cat:'LIQUIDITY',
        q:'"I can\'t afford to have money locked up."',
        ack:'Liquidity is one of the most important things to get right in any portfolio.',
        redirect:'The question is which portion of your capital genuinely needs to be liquid. Emergency funds, short-term commitments — those stay liquid, always. But capital you won\'t need for five to seven years is currently earning less than inflation in a savings account. Illiquidity is a feature when it comes with a premium — and the whisky market has historically delivered that premium.',
        pivot:'"If we ringfenced the capital you genuinely need access to and looked only at the portion you wouldn\'t touch for seven years — what does that number look like?"' },
      { id:'w03', cat:'FAMILIARITY',
        q:'"I\'ve never heard of investing in whisky."',
        ack:'Most people haven\'t — and that\'s not a coincidence.',
        redirect:'Family offices and institutional buyers discovered this asset class a decade ago. They weren\'t advertising it. The general public is only beginning to hear about it now, which is typically the point in a market cycle where informed early movers have already positioned and the mainstream is starting to catch up.',
        pivot:'"The fact that you haven\'t heard of it — does that mean it\'s not a real market, or does it mean most of your competitors haven\'t positioned yet either?"' },
      { id:'w04', cat:'STORAGE',
        q:'"What are the storage and insurance costs?"',
        ack:'Completely fair question — and the numbers are smaller than most people expect.',
        redirect:'HMRC bonded warehouse storage for a standard cask runs between £150 and £250 per year, fully insured. That\'s built into the investment model. The maturation premium — the annual increase in value from the whisky ageing — has historically exceeded those costs by a significant multiple.',
        pivot:'"If the storage cost is £200 per year on a cask that appreciates several thousand over the same period, does the cost concern still stand?"' },
      { id:'w05', cat:'VALUATION',
        q:'"How do I know what it\'s actually worth?"',
        ack:'That\'s the right question to ask about any illiquid asset.',
        redirect:'Scotch whisky casks are valued against a transparent, published market — auction houses like Whisky Auctioneer and WhiskyStats publish live transaction data. The market has real buyers, real prices, and real comparables. It\'s more transparent than the private property market, where you don\'t know what the house next door actually sold for until the Land Registry updates.',
        pivot:'"Would seeing live auction transaction data for comparable casks — same distillery, same age — give you a basis to evaluate the valuation independently?"' },
      { id:'w06', cat:'TIMING',
        q:'"Can\'t I just buy a bottle instead of a cask?"',
        ack:'You can — and bottles are a great way to engage with the category as a consumer.',
        redirect:'But a bottle is a finished product with a retail margin built in. A cask is the raw asset — you\'re buying at production cost and selling at the point of maximum maturation value. The difference between buying a cask and buying bottles is the difference between buying a vineyard and buying wine from Waitrose.',
        pivot:'"Is the question about the entry point, or is it about familiarity with the product? Because if it\'s the latter, I can arrange a tasting before we discuss anything further."' }
    ],
    analogies: [
      { scenario:'Supply scarcity', text:'A distillery that closed in 1985 produced its last cask that year. You cannot go back and make more. Every bottle opened permanently reduces the available stock. The asset shrinks while the demand for it grows.' },
      { scenario:'Maturation premium', text:'A surgeon who invests in a new medical device the day it enters clinical trials, before the results are published. Time is the mechanism — waiting for the data is what creates the return.' }
    ],
    socialProof:     'Family offices across Europe and Asia, HNWI collectors, and institutional buyers at the major auction houses — Christie\'s, Sotheby\'s, and Bonhams all operate dedicated spirits departments.',
    urgencyTriggers: ['HMRC export data release', 'New distillery allocation windows', 'Knight Frank Luxury Index publication', 'Major auction house scheduled sale dates'],
    promptContext:   'ASSET CONTEXT — RARE WHISKY CASKS:\nRare cask investment thesis: (1) Finite supply — distillery output is fixed at production; closed distilleries cannot produce more. (2) Maturation premium — whisky legally must age in oak casks; time adds verifiable, intrinsic value. (3) Non-correlation — cask returns have shown near-zero correlation to equity markets through multiple crises. Key risk signals: GBP strength affects export demand; regulatory changes to alcohol duty; Asian buyer sentiment. Pitch must reference physical ownership, bonded HMRC storage, title deed, and auction market transparency. Never name a specific return figure without a verified source.'
  },

  /* ── FINE WINE ── */
  wine: {
    key:        'wine',
    label:      'Fine Wine',
    shortLabel: 'Wine',
    icon:       '◈',
    tag:        'Alternative · Unregulated',
    category:   'tangible',
    regulated:  false,
    regulatory: 'Unregulated alternative investment — not FSCS protected',
    sipp:       false,
    eis:        false,
    liquidity:  'Semi-liquid',
    hold:       '5–15 years',
    minTicket:  '£10,000',
    thesis: [
      'Finite vintage supply — each year\'s harvest is unique and irreplaceable; every bottle consumed permanently reduces available stock',
      'Liv-ex liquidity — real-time pricing on a dedicated exchange with hundreds of millions in annual transaction volume',
      'Proven through crisis — the Liv-ex Fine Wine 1000 held value through 2008 and 2020 while equities fell 40% and 34% respectively'
    ],
    openers: [
      '"The en primeur allocation window for the 2024 Bordeaux vintage opens in six weeks. The early indications from négociants suggest pricing in line with 2019 — which has since returned 34% at auction. I\'m calling clients who have expressed interest in tangible assets because this window is time-limited and allocations are fixed."',
      '"The Liv-ex Fine Wine 1000 has returned an average of 10.2% annually over the last 20 years with near-zero correlation to equities. In 2008, when global equities fell 40%, fine wine held its value. Most of the people I speak to have never seen those numbers. I wanted to make sure you had them."',
      '"First-growth Bordeaux, DRC Burgundy, and prestige Champagne — the investable segment is a subset of the broader wine market, globally demanded, with real-time pricing on the Liv-ex exchange. This is not a niche hobby investment. It\'s an institutional-grade alternative asset with 300 years of price history."'
    ],
    objections: [
      { id:'wn01', cat:'DEMAND',
        q:'"Wine can go out of fashion."',
        ack:'Consumer preferences do shift — you\'re right to think about that.',
        redirect:'But investment-grade fine wine — first-growth Bordeaux, DRC, prestige Champagne — has a 300-year track record as a store of value. These are not fashion items. They are finite, globally traded, auction-verified assets. The same bottles that appear in Christie\'s and Sotheby\'s catalogues this year appeared in their catalogues in 1980.',
        pivot:'"What wine specifically concerns you? Because the fashion risk at the volume of DRC Romanée-Conti — 6,000 bottles a year — is fundamentally different from a case of supermarket rosé."' },
      { id:'wn02', cat:'PROVENANCE',
        q:'"How do I know it\'s genuine?"',
        ack:'Provenance is the most important question in the wine investment market, and I\'m glad you asked it.',
        redirect:'Every case in an institutional wine portfolio comes with a full provenance chain from the château. Storage is in a temperature-controlled, bonded warehouse — typically in London or Bordeaux — with full insurance and third-party custody. You hold a certificate of ownership and can inspect the physical stock at any time.',
        pivot:'"If I could show you the chain of custody documentation for a specific case — from the château to the current storage location — would that satisfy the provenance question?"' },
      { id:'wn03', cat:'LIQUIDITY',
        q:'"How do I sell it when I want to?"',
        ack:'Liquidity is the right thing to establish before any investment.',
        redirect:'Fine wine is the most liquid segment of the collectibles market. The Liv-ex exchange provides real-time bid/ask pricing for investment-grade cases. Beyond Liv-ex, Christie\'s, Sotheby\'s, and Acker run dedicated wine departments with scheduled auctions. Sale-to-settlement can be as fast as 30 days for top Bordeaux.',
        pivot:'"Compared to direct property, which can take six months to sell, or private equity, which is locked for seven years — does the 30-day liquidity profile change how you think about wine relative to those alternatives?"' },
      { id:'wn04', cat:'STORAGE',
        q:'"What does storage cost, and who manages it?"',
        ack:'Storage is a real cost and it\'s important to model it correctly.',
        redirect:'Professional wine storage in a bonded warehouse runs approximately £12–18 per case per year, fully insured. That cost is materially offset by the storage being VAT-deferred — wine held in bond incurs no VAT until it leaves bond. Professional cellar management is included.',
        pivot:'"If storage costs £15 per case per year on a case that appreciates several hundred pounds over the same period, how does that affect the investment case for you?"' },
      { id:'wn05', cat:'RETURN',
        q:'"Why would I invest in wine rather than equities?"',
        ack:'Equities have delivered exceptional returns over the long run — that\'s a fair starting point.',
        redirect:'The question isn\'t wine OR equities. It\'s what percentage of a portfolio benefits from genuine non-correlation. In 2022, both equities AND bonds fell — the 60/40 portfolio lost 16%. Fine wine returned positive. Non-correlation only has value when everything else is falling simultaneously.',
        pivot:'"In 2022, your equity portfolio and bond portfolio both fell. What was performing positively? And is that something you\'d want more of before the next time that happens?"' }
    ],
    analogies: [
      { scenario:'Finite vintage supply', text:'A coffee shop that sources its beans from one farm. When a late frost hits that farm, every other coffee shop in town suddenly looks more attractive. You cannot replicate a 2005 Pétrus. Every bottle opened permanently removes it from the available supply.' },
      { scenario:'Market proof', text:'Christie\'s has been selling fine wine at auction since 1766. The Liv-ex exchange processes over £1bn in annual transactions. This is not an emerging market — it\'s one of the oldest and most liquid alternative asset markets on earth.' }
    ],
    socialProof:     'Institutional wine funds, family offices across Europe and Asia, and auction houses Christie\'s, Sotheby\'s, and Acker with dedicated wine departments generating hundreds of millions in annual volume.',
    urgencyTriggers: ['En primeur allocation windows', 'Major auction house sale calendars', 'Liv-ex index publications', 'Harvest quality reports'],
    promptContext:   'ASSET CONTEXT — FINE WINE:\nFine wine investment thesis: (1) Finite vintage supply — each harvest is unique and irreplaceable. (2) Liv-ex liquidity — real-time pricing, institutional market, £1bn+ annual volume. (3) Crisis resilience — held value through 2008 and 2020 equity crises. Key risk signals: USD strength affects global auction pricing; Asia buyer sentiment; GBP/EUR cross for European purchases. Pitch must reference Liv-ex exchange, bonded storage, provenance documentation, and auction market transparency. Never cite specific return figures without a verifiable source.'
  },

  /* ── PRECIOUS METALS ── */
  gold: {
    key:        'gold',
    label:      'Precious Metals',
    shortLabel: 'Gold & Silver',
    icon:       '◆',
    tag:        'Hard Asset · Unregulated',
    category:   'tangible',
    regulated:  false,
    regulatory: 'Physical ownership — unregulated, fully allocated',
    sipp:       false,
    eis:        false,
    liquidity:  'Liquid',
    hold:       '3–10 years',
    minTicket:  '£2,000',
    thesis: [
      'Monetary foundation — central banks globally hold gold as reserve asset; the same institutions that print currencies are accumulating the one asset that cannot be printed',
      'Real rate sensitivity — gold\'s primary mechanical driver; when real interest rates fall or go negative, gold\'s opportunity cost falls and its purchasing power role strengthens',
      'Crisis liquidity — gold has been accepted as payment for 5,000 years across every civilisation, currency, and political system'
    ],
    openers: [
      '"Central banks globally bought over 1,000 tonnes of gold for the fourth consecutive year. The same institutions responsible for printing currency are accumulating the one asset that cannot be printed. I wanted to call while that data is still being absorbed by the mainstream."',
      '"Real interest rates — the return on cash after inflation — are the single most reliable mechanical driver of gold. When real rates fall, gold outperforms. The rate cut cycle that began in September is compressing real rates across the curve. I\'m calling clients with significant cash positions before that becomes the consensus trade."',
      '"The pound has lost approximately 75% of its real purchasing power since 2000. A savings account balance that hasn\'t moved looks stable — it isn\'t. I\'d like to walk through what that means for where your capital is currently positioned."'
    ],
    objections: [
      { id:'g01', cat:'YIELD',
        q:'"Gold doesn\'t pay any income or dividends."',
        ack:'You\'re completely right — gold pays zero income. That\'s a fact, not a marketing spin.',
        redirect:'The relevant comparison isn\'t gold versus an income-generating asset. It\'s gold versus cash. A savings account paying 4% when inflation is 4.5% has a real yield of -0.5%. Gold doesn\'t pay income — but it also doesn\'t lose purchasing power when the currency that denominates your savings is being debased.',
        pivot:'"If your savings account is currently returning less than inflation in real terms — what is the yield on that account actually worth to you?"' },
      { id:'g02', cat:'TIMING',
        q:'"It\'s already up significantly — I\'ve missed the move."',
        ack:'After a major move, that\'s a completely rational thing to think.',
        redirect:'Assets don\'t reverse because they\'ve moved. They reverse when the underlying drivers reverse. Central banks are still buying. Real rates are still falling. Geopolitical risk has not resolved. Gold ran 645% from 2001 to 2011 with multiple 15–20% corrections along the way. Each correction felt like the top. None were the top.',
        pivot:'"Which of the structural drivers — central bank buying, falling real rates, dollar weakness — do you believe is about to reverse? Because if none are, what causes the correction you\'re anticipating?"' },
      { id:'g03', cat:'VOLATILITY',
        q:'"The price is too volatile for me."',
        ack:'Gold does have periods of significant price movement — that\'s accurate.',
        redirect:'Over 20-year periods, gold has not experienced a single decade of negative real returns. Short-term volatility and long-term value protection are two different things. The clients who sold gold in 2008\'s correction sold at $750. The clients who held sold at $2,000. The volatility was real. So was the outcome.',
        pivot:'"Is the concern about the mark-to-market during the hold period, or about the exit value at the end? Because those require different conversations."' },
      { id:'g04', cat:'STORAGE',
        q:'"Where is it stored and is it insured?"',
        ack:'Physical ownership requires a real answer on storage and insurance, and you\'re right to ask.',
        redirect:'Allocated physical gold is held in a professional vault — Brinks, G4S, or equivalent — with full segregation from the custodian\'s assets, full insurance, and regular independent audit. You can take physical delivery at any time. The gold is yours, not a claim on a financial institution.',
        pivot:'"The alternative to physical allocation is a gold ETF — which is a claim on a financial institution, not ownership of metal. Given that the entire thesis is assets outside the banking system, does the storage question change how you want to hold it?"' }
    ],
    analogies: [
      { scenario:'Currency debasement', text:'A ruler that shrinks 3% every year. The house doesn\'t get bigger — the ruler just gets shorter. The same dynamic applies to money. Prices don\'t rise because things become more valuable. Prices rise because the unit of measurement loses purchasing power.' },
      { scenario:'Central bank buying', text:'The head sommelier at the world\'s finest restaurant quietly moving their personal savings into the rarest bottles on the wine list. They see the cellar. They know the inventory. Their personal money follows their professional conviction.' }
    ],
    socialProof:     'Over 70 central banks globally hold gold as a reserve asset. The Bank of England, the Bundesbank, and the People\'s Bank of China are the three largest institutional gold holders on earth.',
    urgencyTriggers: ['Fed rate decisions', 'CPI / inflation data releases', 'Central bank purchase disclosures', 'Geopolitical escalation events', 'Dollar index movements'],
    promptContext:   'ASSET CONTEXT — PRECIOUS METALS / GOLD:\nGold thesis: (1) Central banks have bought 1,000+ tonnes per year for four consecutive years. (2) Real interest rates (after inflation) are the primary mechanical driver — when real rates fall, gold outperforms. (3) Currency debasement — the pound has lost ~75% of its real purchasing power since 2000. Risk signals: real rate direction, DXY (Dollar Index), geopolitical risk premium, central bank buying disclosure. Pitch must reference physical ownership, allocated storage, and the distinction from paper gold (ETFs). Asset-neutral language: "physical assets", "real assets", "hard assets outside the banking system".'
  },

  /* ── PROPERTY FINANCE ── */
  property: {
    key:        'property',
    label:      'Property Finance',
    shortLabel: 'Property',
    icon:       '◉',
    tag:        'Real Asset · FCA Regulated',
    category:   'financial',
    regulated:  true,
    regulatory: 'FCA regulated — loan notes / bonds may be restricted investments',
    sipp:       true,
    eis:        false,
    liquidity:  'Semi-liquid',
    hold:       '12–36 months',
    minTicket:  '£10,000',
    thesis: [
      'Senior secured — first-charge security over UK real estate; the investor is the first creditor paid ahead of all equity holders',
      'Fixed income — predetermined return (typically 8–12% p.a.) agreed at outset, not subject to market fluctuation',
      'UK housing deficit — structural undersupply of approximately 300,000 units per year creates persistent demand for development finance'
    ],
    openers: [
      '"Two consecutive rate cuts since August have changed the maths on fixed-rate development finance. The spread between our loan note return and base rate has widened. I\'m calling because the window at current pricing won\'t be here once the market adjusts."',
      '"The UK government has just reinstated mandatory housing targets for councils for the first time in three years. That\'s the largest catalyst for development activity we\'ve seen in a decade. The developers who need capital to move quickly are the ones offering the best security terms. I\'d like to walk through what that means for you."',
      '"I want to give you a framework. Senior secured property loan notes sit above equity in the capital stack — you are the first creditor paid. Fixed 10% return. UK real estate as security. 18-month term. If you can get that from an ISA or a savings account, tell me and I\'ll leave you alone."'
    ],
    objections: [
      { id:'p01', cat:'RETURN',
        q:'"10–12% sounds too good to be true."',
        ack:'It\'s the right instinct to question a return that sounds high, and I respect that.',
        redirect:'The developer pays a premium over bank rates because they value speed and certainty. High-street banks take six months and require extensive due diligence. We can deploy in six weeks. That speed premium is what you\'re earning — it\'s structural, not promotional. The return exists because the developer has a genuine business reason to pay it.',
        pivot:'"If I showed you a case study — specific development, specific loan terms, specific security — where the developer\'s exit valuation covers our loan at 2x, would that address the credibility question?"' },
      { id:'p02', cat:'SECURITY',
        q:'"What happens if the development fails?"',
        ack:'Default risk is the critical question for any debt instrument, and you\'re right to focus on it.',
        redirect:'Senior secured means the loan is protected by a first legal charge over the property. In a worst case, the lender has the right to appoint a receiver, sell the asset, and recover capital before any equity is returned. Loan-to-value ratios are typically 65–70% — meaning the property would need to fall over 30% in value before capital is at risk.',
        pivot:'"UK property has not experienced a sustained 30%+ decline since the early 1990s. Is the scenario you\'re concerned about a market-wide event at that scale, or a specific development-level failure?"' },
      { id:'p03', cat:'PROPERTY MARKET',
        q:'"The property market is struggling right now."',
        ack:'The residential sales market has faced pressure — that\'s accurate.',
        redirect:'Loan notes are not a bet on property price appreciation. You\'re a senior secured lender, not an equity investor. The property needs to sell for enough to repay a 65% LTV loan — not to hit a specific profit margin. A developer making a smaller profit than projected is still repaying your loan in full.',
        pivot:'"Is your concern about property prices falling below the point where the developer can repay a 65% LTV loan — or a different risk entirely?"' },
      { id:'p04', cat:'LIQUIDITY',
        q:'"What if I need my money back early?"',
        ack:'Liquidity is one of the most important parameters to establish before committing to any fixed-term investment.',
        redirect:'Most property loan notes have a defined term — typically 12–24 months. Some structures include a secondary market or buyback facility. This is capital that should be treated as genuinely committed for the term. The premium return exists precisely because of that commitment.',
        pivot:'"If we separated your capital into what you need immediate access to and what you wouldn\'t touch for 18 months — what does the committed portion look like? That\'s the only capital appropriate for this structure."' }
    ],
    analogies: [
      { scenario:'Senior secured structure', text:'A mortgage lender who agrees to finance 65% of a house purchase. If the homeowner defaults, the lender sells the house and takes their 65% back first, before anyone else gets paid. You\'re the mortgage lender, not the homeowner.' },
      { scenario:'Speed premium', text:'A plumber who charges double to fix a burst pipe on Christmas Day. The homeowner could wait and pay less — but they need it fixed now. The developer\'s premium over bank rates is the same calculation: urgency commands a price.' }
    ],
    socialProof:     'Institutional bridge lenders, debt funds, and family offices have been the primary providers of UK development finance since banks retreated post-2008. The market processes over £7bn in transactions annually.',
    urgencyTriggers: ['Bank of England base rate decisions', 'UK housing starts data', 'Planning reform announcements', 'Tranche close dates', 'Interest rate forward curve movements'],
    promptContext:   'ASSET CONTEXT — PROPERTY FINANCE / LOAN NOTES:\nProperty finance thesis: (1) Senior secured — first-charge UK real estate security. (2) Fixed income — predetermined return at outset, not subject to market fluctuation. (3) UK housing deficit — structural undersupply of 300,000+ units/year creates persistent development finance demand. Key risk signals: base rate direction (affects spread), UK planning environment, residential transaction volumes. Pitch must explain capital stack (senior vs equity), LTV ratio, first charge security, and developer motivation for paying premium rates. Regulatory note: loan notes to retail investors may be restricted investments requiring appropriateness checks under FCA rules.'
  },

  /* ── PRIVATE EQUITY ── */
  pe: {
    key:        'pe',
    label:      'Private Equity',
    shortLabel: 'Private Equity',
    icon:       '◆',
    tag:        'Growth Capital · FCA Regulated',
    category:   'equity',
    regulated:  true,
    regulatory: 'FCA regulated — typically restricted to professional / sophisticated investors',
    sipp:       false,
    eis:        false,
    liquidity:  'Illiquid',
    hold:       '5–7 years',
    minTicket:  '£25,000',
    thesis: [
      'Operational alpha — returns generated by building and improving businesses, not by market sentiment; uncorrelated to public market movements',
      'Illiquidity premium — private equity has historically outperformed public equity by 3–5% annually, specifically because of the commitment required',
      'Vintage timing — entry multiples compress in downturns; capital deployed in low-activity periods has historically produced the strongest returns'
    ],
    openers: [
      '"Deal flow at UK mid-market private equity is at a six-year low. Entry multiples have compressed 30% from the 2021 peak. The same quality companies are available at materially better prices. The clients who deploy capital into this vintage will look back on it the way 2009 equity investors do now."',
      '"I want to explain the difference between a stock and a stake. When you buy a FTSE 100 stock, you\'re buying market sentiment about a company. When you hold a PE stake, you\'re buying operational improvement — management changes, cost restructuring, growth capital. Those two things don\'t move together. That\'s the point."',
      '"The J-curve in private equity is frequently misunderstood. Capital is deployed over two to three years. The write-down phase in years one to two reflects accounting conservatism, not actual value destruction. The realisation phase in years four to seven is where the return is generated. I\'d like to walk you through what that looks like in practice."'
    ],
    objections: [
      { id:'pe01', cat:'LIQUIDITY',
        q:'"My money is locked up for too long."',
        ack:'A seven-year commitment is significant, and I wouldn\'t minimise that.',
        redirect:'The illiquidity premium exists because most investors won\'t commit to seven years. The ones who do are compensated for it — historically 3–5% per annum above public equity over full cycles. That premium is real and persistent precisely because the commitment barrier keeps most capital out.',
        pivot:'"What portion of your total investable assets are you genuinely committed not to need for seven years? That\'s the only portion that belongs in this structure — and the premium applies specifically to it."' },
      { id:'pe02', cat:'COMPLEXITY',
        q:'"Private equity is too complex for me to evaluate."',
        ack:'The complexity is real — and it\'s exactly why most retail investors have been excluded from the returns.',
        redirect:'The investment decision at the client level is actually simple: do you trust the fund manager\'s track record and team to identify, buy, improve, and exit businesses better than the public market? The complexity lives in their execution, not in your decision.',
        pivot:'"If I showed you the track record — fund by fund, exit by exit, IRR and multiple on invested capital — would you feel able to evaluate whether this team has demonstrated they can do it?"' },
      { id:'pe03', cat:'PUBLIC EQUITY',
        q:'"I can get equity exposure more cheaply through an ISA."',
        ack:'You can — and public equity belongs in a portfolio. They\'re not substitutes.',
        redirect:'An ISA gives you beta — exposure to broad market movement. Private equity gives you operational alpha — value created by actively building businesses. In 2022, both FTSE 100 and global bond indices fell. Private equity held value because returns weren\'t driven by market sentiment. That non-correlation only matters when everything else is falling.',
        pivot:'"In 2022, what in your existing portfolio was positive? And how much of your portfolio do you want to be genuinely uncorrelated to what happened in 2022?"' }
    ],
    analogies: [
      { scenario:'Operational alpha', text:'A corporate surgeon who uses their own savings to invest in a company they\'ve just been hired to restructure. They\'ve seen the management accounts. They know what\'s broken and how to fix it. Their money follows their conviction — and their return comes from the improvement, not from the market going up.' },
      { scenario:'Vintage timing', text:'A vineyard owner who plants in the worst weather year of the decade. Everyone else held back. Their grapes face less competition in the market when they\'re ready. The best private equity vintages are planted in the quietest deal markets.' }
    ],
    socialProof:     'Pension funds, endowments, and sovereign wealth funds allocate 15–25% to private equity as standard. Yale\'s endowment model — the most replicated institutional investment framework — allocates over 30% to illiquid alternatives.',
    urgencyTriggers: ['Fund close dates (fixed by LPA)', 'Entry multiple compression data', 'Fundraising market activity reports', 'Portfolio company exit announcements'],
    promptContext:   'ASSET CONTEXT — PRIVATE EQUITY:\nPE thesis: (1) Operational alpha — returns from building businesses, not market sentiment. (2) Illiquidity premium — historically 3–5% above public equity over full cycles. (3) Vintage timing — entry multiples in low-activity periods produce strongest long-run returns. Key risk signals: credit availability (affects leveraged buyout economics), deal flow data, vintage year deployment pace. Pitch must explain J-curve, capital call structure, IRR vs MOIC, and why the commitment barrier creates the premium. Regulatory note: typically restricted to professional or sophisticated investors under FCA rules — appropriateness test required.'
  },

  /* ── EIS / SEIS ── */
  eis: {
    key:        'eis',
    label:      'EIS / SEIS',
    shortLabel: 'EIS / SEIS',
    icon:       '◫',
    tag:        'Tax-Efficient · HMRC Approved',
    category:   'equity',
    regulated:  true,
    regulatory: 'FCA regulated — HMRC approved EIS / SEIS qualifying investments',
    sipp:       false,
    eis:        true,
    liquidity:  'Illiquid',
    hold:       '3–5 years minimum',
    minTicket:  '£10,000',
    thesis: [
      'Immediate income tax relief — 30% (EIS) or 50% (SEIS) relief on investment in the tax year of subscription, reducing the effective cost from day one',
      'CGT exemption — gains on qualifying EIS/SEIS investments held for three years are completely free of capital gains tax',
      'Loss relief — if the investment fails, losses are offset against income or capital gains, reducing the effective downside significantly'
    ],
    openers: [
      '"I want to put a number on the table. A £50,000 EIS investment costs you £35,000 after income tax relief. If the company doubles, your £50,000 becomes £100,000 — completely free of capital gains tax. If the company fails, your effective loss after income tax relief on the loss is approximately £17,500 on a £50,000 position. The tax structure changes the risk/return mathematics fundamentally."',
      '"The CGT environment has changed. Annual exempt amounts have been cut, and rates have moved. The question I\'m putting to clients with significant unrealised gains is: what\'s your strategy for managing the tax on those gains? EIS is one of the few remaining mechanisms where gains are sheltered entirely."',
      '"SEIS is the earliest-stage equivalent — 50% income tax relief, the same CGT exemption, and loss relief. For clients who want exposure to early-stage British businesses and want HMRC to share the downside, it\'s the most compelling tax-efficient structure currently available."'
    ],
    objections: [
      { id:'e01', cat:'RISK',
        q:'"Early-stage companies are too risky."',
        ack:'Early-stage investment does carry higher failure rates than established businesses — that\'s accurate.',
        redirect:'The tax structure changes the risk mathematics. A 50% SEIS relief means HMRC effectively co-invests with you on the downside. A failed SEIS investment, after tax relief on the loss, has an effective loss rate of approximately 22.5p per £1 invested for a 45% taxpayer. That asymmetry — capped downside, uncapped upside, tax-free gains — is why institutional investors use EIS as a core portfolio tool.',
        pivot:'"If HMRC is covering approximately 73% of your downside through relief and loss offset — does the risk profile feel different when you model it on the net investment rather than the gross?"' },
      { id:'e02', cat:'COMPLEXITY',
        q:'"The tax rules are too complicated."',
        ack:'The qualifying rules are detailed — and getting them wrong has consequences.',
        redirect:'The complexity is managed at the fund level, not by the investor. HMRC-advance-assured EIS funds have already confirmed qualifying status. Your role is to subscribe to the fund and file the relief on your tax return — a single line on a self-assessment. Your accountant does the rest.',
        pivot:'"Is the concern about understanding the rules yourself, or about the compliance process? Because the two have very different solutions."' },
      { id:'e03', cat:'RETURNS',
        q:'"What are the expected returns?"',
        ack:'Return expectations should always be grounded in data, not projections.',
        redirect:'EIS performance data shows that diversified portfolios of 20+ EIS investments have historically returned 2–3x MOIC over 5-year periods before tax relief. After tax relief, the effective multiple on capital deployed is materially higher. Individual company returns range from zero to 10x+. Diversification across a fund structure is how the mathematics work in your favour.',
        pivot:'"Would you like to look at the published track record data for specific EIS fund managers — realised returns, fund by fund — rather than projected returns?"' }
    ],
    analogies: [
      { scenario:'Tax relief mechanics', text:'HMRC co-invests with you on the downside. If the company fails, they return 50% of your investment in tax relief. If it succeeds, they step aside and let you keep 100% of the gain, tax-free. It is the only investment structure where the government shares your downside but not your upside.' },
      { scenario:'Portfolio construction', text:'A surgeon who doesn\'t invest in a single operation — they invest across a portfolio of twenty. The ones that fail are covered by relief. The ones that succeed, unencumbered by CGT, fund the portfolio return.' }
    ],
    socialProof:     'EIS has been used by FTSE 100 executives, City professionals, and family offices as a core CGT mitigation tool for 30 years. Over £20bn has been deployed into EIS-qualifying investments since inception.',
    urgencyTriggers: ['Tax year-end (April 5th) — relief claimed in current year', 'Budget announcements (relief rate or qualifying rules changes)', 'CGT rate changes', 'Specific fund close dates'],
    promptContext:   'ASSET CONTEXT — EIS / SEIS:\nEIS/SEIS thesis: (1) 30% (EIS) / 50% (SEIS) upfront income tax relief — reduces effective cost immediately. (2) CGT exemption on qualifying gains held 3+ years. (3) Loss relief — effective downside significantly reduced by tax offsets. Key risk signals: budget announcements affecting relief rates, CGT rate changes, annual exempt amount changes. Pitch must always reference HMRC advance assurance, the net-of-relief investment amount, and portfolio diversification. Regulatory note: EIS/SEIS investments are higher-risk by HMRC definition; appropriateness assessment required for retail clients. Never imply guaranteed returns.'
  },

  /* ── ART & COLLECTIBLES ── */
  art: {
    key:        'art',
    label:      'Art & Collectibles',
    shortLabel: 'Art',
    icon:       '◎',
    tag:        'Alternative · Unregulated',
    category:   'tangible',
    regulated:  false,
    regulatory: 'Unregulated alternative investment — not FSCS protected',
    sipp:       false,
    eis:        false,
    liquidity:  'Semi-liquid',
    hold:       '5–15 years',
    minTicket:  '£15,000',
    thesis: [
      'Absolute scarcity — a Basquiat, a Warhol, a Richter is singular; no financial instrument or central bank policy can create more of it',
      'Dual return — aesthetic enjoyment during the hold period alongside financial appreciation; the asset is not inert capital',
      'Institutional validation — Sotheby\'s, Christie\'s, and Phillips collectively process over $10bn in annual transactions; this is a mature, liquid market at the top end'
    ],
    openers: [
      '"The art market processes over $65bn in transactions annually. Christie\'s and Sotheby\'s collectively generate more in annual revenue than the London Stock Exchange charges in annual listing fees. This is not a hobby market — it\'s the third largest alternative asset class globally."',
      '"Blue-chip contemporary art — Basquiat, Hirst, Koons, Richter — has returned an average of 7.5% annually over 25 years according to the Mei Moses All Art Index. With near-zero correlation to equities. During 2008, the market fell less than 10% while global equities fell 40%."',
      '"I\'d like to ask you a question. What is the most valuable thing in your home? For most people with significant wealth, the answer is a painting or a piece of furniture they inherited. They never thought of it as an investment. It\'s appreciated significantly anyway. The question is whether you\'d like to be intentional about the next acquisition."'
    ],
    objections: [
      { id:'a01', cat:'VALUATION',
        q:'"Art is too subjective — how do you value it?"',
        ack:'Valuation at the top end of the market is actually more transparent than most people realise.',
        redirect:'Blue-chip works have public auction records going back decades. Sotheby\'s pre-sale estimates are derived from the published sales history of comparable works. The Mei Moses index tracks repeat-sale pairs — the same works sold multiple times — giving a transparent returns dataset. The subjectivity exists in contemporary emerging artists. At the blue-chip level, the market is data-driven.',
        pivot:'"If I showed you the published auction history — specific works, specific prices, specific dates — for the category we\'re discussing, would that give you a basis to evaluate the valuation independently?"' },
      { id:'a02', cat:'LIQUIDITY',
        q:'"How quickly can I sell it?"',
        ack:'Liquidity in art is real but requires planning.',
        redirect:'Major auction houses run scheduled sales three to four times per year. Consigning a work to Christie\'s or Sotheby\'s typically results in sale within 60–90 days of submission. Private treaty sales — where the auction house finds a buyer directly — can complete faster. At the blue-chip level, a Warhol or Basquiat has a waiting list of buyers.',
        pivot:'"Compared to direct property — which takes six months minimum — or PE which is locked for seven years, does 60–90 days change how you think about art\'s liquidity profile?"' },
      { id:'a03', cat:'STORAGE',
        q:'"What are the costs of insurance and storage?"',
        ack:'Storage and insurance are real costs and they vary significantly by work.',
        redirect:'Professional art storage in a climate-controlled, high-security facility runs approximately £500–2,000 per year depending on size. Insurance is typically 0.1–0.3% of insured value annually. Most collectors display works at home — in which case home contents insurance covers the asset at a fraction of vault storage cost.',
        pivot:'"Most clients display the works they hold. The carrying costs fall to home contents insurance and periodic conservation. Is the concern about the cost structure specifically, or about the transparency of what you\'re paying for?"' }
    ],
    analogies: [
      { scenario:'Absolute scarcity', text:'A single Rolex Daytona Paul Newman sold at Phillips for $17.75m. Not because watches became fashionable. Because it was the only one — provenance from the actor himself, unmodified, the last time it would ever come to market. The market for truly singular objects doesn\'t correlate to the stock market because nothing about it is manufactured.' },
      { scenario:'Institutional proof', text:'Christie\'s has been operating since 1766. Sotheby\'s since 1744. The two oldest continuously operating auction businesses on earth both chose art as their primary market. They\'ve survived every war, every recession, and every financial crisis in between.' }
    ],
    socialProof:     'Ultra-high-net-worth family offices, sovereign wealth funds, and institutional art funds from Singapore, the Gulf, and the US are the primary buyers at major auction houses.',
    urgencyTriggers: ['Major auction house sale dates', 'Artist retrospective exhibitions (drive price appreciation)', 'Specific provenance events', 'Museum acquisition announcements'],
    promptContext:   'ASSET CONTEXT — ART & COLLECTIBLES:\nArt thesis: (1) Absolute scarcity — singular works cannot be replicated. (2) Dual return — aesthetic enjoyment alongside financial appreciation. (3) Institutional validation — $65bn+ annual global art market with transparent auction data. Key risk signals: USD strength (global art is priced in USD), luxury sentiment, HNWI wealth growth, specific artist market trajectories. Pitch must reference Mei Moses index data, specific auction house volumes, and the distinction between blue-chip (institutional) and speculative (emerging) segments. Avoid return projections on specific artists or works.'
  },

  /* ── AGRICULTURAL LAND ── */
  land: {
    key:        'land',
    label:      'Agricultural Land',
    shortLabel: 'Land & Forestry',
    icon:       '◐',
    tag:        'Real Asset · IHT Relief',
    category:   'tangible',
    regulated:  false,
    regulatory: 'Unregulated — Agricultural Property Relief (APR) and Business Property Relief (BPR) qualifying structures',
    sipp:       false,
    eis:        false,
    liquidity:  'Illiquid',
    hold:       '7–20 years',
    minTicket:  '£50,000',
    thesis: [
      'Inheritance tax efficiency — qualifying agricultural and woodland assets benefit from Agricultural Property Relief (100% IHT exemption after 2 years\' ownership)',
      'Inflation hedge — UK farmland prices have tracked and exceeded CPI over 30-year periods; land is a finite, productive real asset',
      'Carbon and ESG premium — forestry assets generate verified carbon credits alongside timber income, adding a second income stream with institutional buyer demand'
    ],
    openers: [
      '"I want to talk about the most effective inheritance tax planning tool that most accountants still don\'t have on their radar. Agricultural Property Relief provides 100% IHT exemption on qualifying land and woodland after just two years of ownership. For a client with a £2m estate facing a 40% IHT bill, that\'s an £800,000 conversation."',
      '"UK farmland has returned an average of 8.4% annually over the last 20 years according to RICS data. It hasn\'t recorded a 10-year period of negative returns in recorded history. It qualifies for full IHT relief. And it\'s a finite asset — they\'re not making more of it. I\'d like to walk through why it\'s underrepresented in most wealth portfolios."',
      '"The voluntary carbon market is growing at 30% annually. A managed woodland generates verified carbon credits that institutional buyers — airlines, energy companies, asset managers meeting net-zero commitments — actively bid for. Forestry as an asset class now has two institutional income streams: timber and carbon. I\'d like to share what that does to the return profile."'
    ],
    objections: [
      { id:'l01', cat:'IHT RULES',
        q:'"What if HMRC changes the Agricultural Property Relief rules?"',
        ack:'Regulatory risk on any tax-advantaged structure is real and worth addressing directly.',
        redirect:'APR has been in continuous operation since 1984 — 40 years without material change to the core relief. The most recent Budget consultations proposed tightening at the very top end (estates over £3m). Qualifying managed woodland and farmland portfolios structured under current rules have grandfathering provisions in virtually every historical reform. Tax law changes prospectively, not retrospectively, in the UK.',
        pivot:'"If APR were reduced or removed — and the investment returns the same 7–8% annually without the tax relief — does the land investment still make sense for the portion of your portfolio you\'re considering?"' },
      { id:'l02', cat:'LIQUIDITY',
        q:'"Land is completely illiquid."',
        ack:'Land is one of the most illiquid real assets — that\'s accurate.',
        redirect:'The liquidity profile is appropriate for the role land plays in a portfolio. It is not trading capital. It is generational wealth preservation — the asset class that British landed estates have used to maintain capital across centuries. The illiquidity is the mechanism by which the IHT relief works: you hold it, it qualifies.',
        pivot:'"For the portion of your estate that you genuinely intend to pass to the next generation — does liquidity matter, or does IHT efficiency matter more?"' },
      { id:'l03', cat:'FARMING',
        q:'"I don\'t know anything about farming."',
        ack:'Most land investors don\'t, and it\'s not necessary.',
        redirect:'Institutional land portfolios are managed by specialist farm management companies — Savills, Carter Jonas, Strutt & Parker. They handle tenancy arrangements, planning applications, subsidy claims, and land management. The investor holds the asset. The manager runs the farm. It\'s structurally similar to owning a rental property through a managing agent.',
        pivot:'"If the land was professionally managed — all operational decisions handled by an accredited farm manager — would the lack of farming knowledge still be a barrier?"' }
    ],
    analogies: [
      { scenario:'IHT efficiency', text:'An estate worth £2m facing a 40% IHT bill would owe £800,000 on death. Agricultural land worth £2m, held for two years and qualifying for APR, passes IHT-free. The same £2m, invested differently, costs the next generation £800,000. That\'s not a small difference.' },
      { scenario:'Carbon income', text:'A landlord who discovers the river running through their property is the drinking water source for a major city. The water company pays them an annual easement fee they didn\'t know existed. Forestry owners are discovering the same thing about carbon — a second income stream from the same asset.' }
    ],
    socialProof:     'UK institutional land funds, family offices, and pension-backed agricultural investment vehicles (Grosvenor Farms, Savills Investment Management) manage over £10bn in UK farmland.',
    urgencyTriggers: ['Budget announcements (APR/BPR rule changes)', 'RICS farmland price index publications', 'Carbon credit price movements', 'Agricultural subsidy reform announcements'],
    promptContext:   'ASSET CONTEXT — AGRICULTURAL LAND / FORESTRY:\nLand thesis: (1) IHT efficiency — Agricultural Property Relief (100% after 2 years). (2) Inflation hedge — UK farmland historically tracks and exceeds CPI over 30-year periods. (3) Carbon income — verified carbon credits from managed woodland add institutional buyer demand. Key risk signals: APR/BPR legislative risk (budget sensitivity), RICS farmland price index, carbon market voluntary demand growth, planning reform. Pitch must always reference HMRC qualifying conditions for APR, professional management structures, and the distinction from speculative land banking. Never imply IHT planning without recommending specialist legal advice.'
  },

  /* ── VENTURE CAPITAL TRUSTS ── */
  vct: {
    key:        'vct',
    label:      'Venture Capital Trusts',
    shortLabel: 'VCTs',
    icon:       '◇',
    tag:        'Tax-Efficient · FCA Regulated · LSE Listed',
    category:   'equity',
    regulated:  true,
    regulatory: 'FCA regulated — HMRC approved VCT qualifying investment',
    sipp:       false,
    eis:        false,
    liquidity:  'Semi-liquid',
    hold:       '5 years minimum',
    minTicket:  '£5,000',
    thesis: [
      '30% immediate income tax relief — on up to £200,000 invested per tax year, in the year of subscription; if the trust has been operating long enough, shares can be transferred to a spouse to double the annual limit',
      'Tax-free dividends — VCTs pay dividends from the portfolio of qualifying companies; unlike EIS, VCT dividends are completely exempt from income tax, providing an ongoing tax-free income stream',
      'LSE-listed secondary market — unlike direct EIS, VCT shares trade on the London Stock Exchange; while spreads can be wide and discounts common, a genuine exit mechanism exists without requiring a company event'
    ],
    openers: [
      '"I want to put a number on the table. A £50,000 VCT investment costs you £35,000 after 30% income tax relief. The trust then pays tax-free dividends — typically 5–7% per year on the original subscription. On the net cost of £35,000, that is a 10% tax-free yield. Tell me where else you can get that."',
      '"The CGT environment has fundamentally changed. Rates have moved, annual exempt amounts have been cut, and the relief landscape is narrowing. VCTs are one of the last structures where you get immediate relief going in, tax-free income while you hold, and CGT-free disposal on exit. That combination is not available anywhere else in the UK tax code."',
      '"Most of the clients I speak to have heard of EIS but not VCTs. The distinction matters. EIS is a direct stake in one company — concentrated risk, no dividends, illiquid until exit. A VCT is a managed portfolio of 30–50 qualifying companies — diversification, regular dividends, listed shares. Same tax relief. Very different risk profile."'
    ],
    objections: [
      { id:'v01', cat:'RISK',
        q:'"Small companies are too risky."',
        ack:'Small company portfolios do carry higher failure rates than FTSE 100 stocks — that is accurate.',
        redirect:'The VCT structure is designed around that reality. A typical VCT holds 30–50 qualifying companies. One failure is a rounding error. The tax relief on the way in means the portfolio needs to return only 70p in the pound to break even on the gross investment — a bar that most established VCT managers have consistently cleared over 20-year track records.',
        pivot:'"If the downside is effectively capped at 70p on the pound by the tax relief — and you are collecting tax-free dividends in the meantime — how does the risk profile compare to a bond yielding 4% with full income tax exposure on the coupon?"' },
      { id:'v02', cat:'LIQUIDITY',
        q:'"The shares are thinly traded — I can\'t get out."',
        ack:'VCT secondary market liquidity is genuinely limited — that is the right concern to raise.',
        redirect:'Two mechanisms mitigate this. First, the listing means you can sell at market. Second, most established VCT managers run buyback programmes — they buy back shares at a set discount to NAV, typically 5%. It is not equity-market liquidity, but for a 5-year minimum hold it is materially more accessible than a direct EIS investment in a private company.',
        pivot:'"For capital that your client genuinely won\'t need for five years — and in exchange for which they receive 30% relief upfront and tax-free dividends throughout — does the liquidity constraint change the attractiveness of the structure?"' },
      { id:'v03', cat:'RETURN',
        q:'"What are the expected returns?"',
        ack:'Return expectations need to be grounded in verified track records, not projections.',
        redirect:'The established VCT managers — Octopus, Mobeus, Baronsmead, Albion — have published 20-year track records. Total return, including tax relief and dividends reinvested, has historically run at 8–12% per annum on the net-of-relief cost for the better managers. The tax relief is structural — it exists independently of portfolio performance. Even a flat portfolio returns 30% on day one.',
        pivot:'"If I showed you the published 10-year total return figures for three established VCT managers — net of all charges, including tax relief and dividends — would that give you a data-based framework for comparison?"' },
      { id:'v04', cat:'COMPLEXITY',
        q:'"VCTs sound complicated."',
        ack:'The underlying portfolio is managed complexity — the investor\'s decision is actually simple.',
        redirect:'You subscribe to a VCT fundraise. You receive HMRC certificates. You claim 30% back on your self-assessment. You receive tax-free dividends. You sell after five years on the LSE or via the manager\'s buyback programme. The manager handles portfolio construction, qualifying company selection, and compliance. Your role is subscription and claim.',
        pivot:'"Is the complexity concern about understanding the mechanics — which I can walk through in five minutes — or about the compliance process? Because your accountant handles the claim on one line of a self-assessment."' },
      { id:'v05', cat:'VERSUS',
        q:'"Why VCT rather than EIS?"',
        ack:'EIS and VCT are both HMRC-approved and both give 30% income tax relief — the comparison is legitimate.',
        redirect:'Three structural differences. First, VCT is a managed, diversified portfolio — EIS is a direct stake in one company. Second, VCTs pay tax-free dividends — EIS pays no income. Third, VCT shares are listed — EIS is locked until a company event. For a client who wants tax efficiency, regular income, and some exit mechanism, VCT wins. For a client who wants maximum upside concentration in a single high-growth company, EIS wins.',
        pivot:'"Does your client need income from the investment, or are they purely seeking capital growth with tax mitigation? That single answer decides EIS versus VCT."' }
    ],
    analogies: [
      { scenario:'Tax relief mechanics', text:'Buying a house worth £100,000 for £70,000 because the government pays the deposit. The house still needs to appreciate for a profit — but you started 30% ahead of every other buyer on the street. That\'s the VCT entry position.' },
      { scenario:'Dividend structure', text:'A landlord who not only gets the rent tax-free, but also paid 30% less for the property in the first place. The income stream is untaxed. The entry cost was subsidised. It is the most structurally advantaged income investment in the UK tax code.' }
    ],
    socialProof:     'UK VCTs have deployed over £10bn into British growth companies since their introduction in 1995. The sector is dominated by established managers with 20-year track records — Octopus, Mobeus, Albion, Baronsmead — with institutional-grade due diligence on qualifying portfolios.',
    urgencyTriggers: ['Tax year-end April 5th — relief claimed in the year of subscription', 'Annual subscription limits reset each tax year', 'Fund raise windows close when target is reached', 'Budget announcements affecting relief rates'],
    promptContext:   'ASSET CONTEXT — VENTURE CAPITAL TRUSTS (VCTs):\nVCT thesis: (1) 30% upfront income tax relief on up to £200,000/year — immediate, in the year of subscription. (2) Tax-free dividends — ongoing income stream, exempt from income tax, typically 5–7% on subscription amount. (3) LSE-listed secondary market plus manager buyback programmes — more liquid than direct EIS. Key risk signals: Budget announcements affecting relief rates, VCT qualifying rules changes, small company market sentiment. Pitch must distinguish VCT from EIS (managed vs direct, dividends vs no income, listed vs illiquid), reference 5-year minimum hold, HMRC advance assurance, and established manager track records. Regulatory note: FCA regulated, HMRC approved — retail eligible with appropriateness assessment.'
  },

  /* ── INVESTMENT TRUSTS ── */
  trusts: {
    key:        'trusts',
    label:      'Investment Trusts',
    shortLabel: 'Inv. Trusts',
    icon:       '◰',
    tag:        'Listed · FCA Regulated · ISA & SIPP Eligible',
    category:   'equity',
    regulated:  true,
    regulatory: 'FCA regulated — listed closed-ended investment companies on the London Stock Exchange',
    sipp:       true,
    eis:        false,
    liquidity:  'Liquid',
    hold:       '3–10 years',
    minTicket:  '£1,000',
    thesis: [
      'NAV discount opportunity — UK investment trusts are currently trading at the widest average discount to net asset value in 20 years; buying a trust at a 15% discount means acquiring £1.00 of underlying assets for 85p, with the discount itself as a second return driver as it narrows',
      'Structural advantages over open-ended funds — closed-ended structure means managers never forced to sell assets to meet redemptions; can use gearing to amplify returns; can smooth dividends from revenue reserves across market cycles',
      'Income engine — the Association of Investment Companies\' Dividend Heroes have increased dividends every year for over 20 consecutive years through recessions, pandemics, and financial crises; income from revenue reserves means dividends don\'t depend on annual portfolio income'
    ],
    openers: [
      '"UK investment trusts are trading at the widest discount to net asset value in 20 years. The average discount across the sector is approximately 14%. That means you can buy £1.00 of underlying assets for 86p. When that discount narrows — and historically it always does — you get a return on top of the underlying portfolio return. It is a structural entry advantage that open-ended funds simply cannot offer."',
      '"There are 23 investment trusts on the London Stock Exchange that have increased their dividend every single year for over 20 consecutive years. Through 2008. Through COVID. Through 2022. Not maintained — increased. The mechanism is revenue reserves: in good years the trust holds back income, in bad years it pays it out. That is an income engine most OEIC investors have never had access to."',
      '"The question I put to every wealth manager I speak to is: why would you own an OEIC when you could own a closed-ended trust at a discount? An OEIC manager is forced to sell into falling markets when clients redeem. A trust manager is never a forced seller. In 2020, OEICs sold assets at the bottom to fund redemptions. Investment trust managers bought them."'
    ],
    objections: [
      { id:'t01', cat:'DISCOUNT',
        q:'"If it\'s at a discount, maybe there\'s a reason."',
        ack:'That\'s the right question — and it deserves a precise answer, not reassurance.',
        redirect:'Discounts in investment trusts widen for three structural reasons: interest rate rises (which make the fixed costs of gearing look expensive and push income-seeking investors toward bonds), sentiment shifts away from illiquid underlying assets, and retail investor redemption pressure on the wider market. All three of those forces are now reversing. The underlying assets have not changed. The price has.',
        pivot:'"If the discount exists because interest rates rose rapidly in 2022 — and rates are now falling — what would you expect to happen to the discount over the next 12 months?"' },
      { id:'t02', cat:'GEARING',
        q:'"Gearing means more downside — that worries me."',
        ack:'Gearing amplifies both gains and losses — you\'re right to identify it.',
        redirect:'The distinction is between structural gearing and tactical gearing. Infrastructure trusts and income trusts typically use modest gearing — 10–15% — at fixed long-term rates. That gearing was locked in at 2–3% when rates were low. The interest cost is fixed; the portfolio income and capital growth are variable. At current portfolio yields, the income covers the gearing cost with significant margin.',
        pivot:'"If the gearing is fixed-rate, locked in at 2–3% when rates were low, and the portfolio is yielding 5–6% — what is the actual risk from the gearing in a falling rate environment?"' },
      { id:'t03', cat:'VERSUS',
        q:'"I\'d rather just buy a tracker fund."',
        ack:'A tracker fund is rational — low cost, liquid, transparent. I wouldn\'t argue against it.',
        redirect:'A tracker gives you beta — the market return. An investment trust gives you beta plus three things a tracker cannot: the discount to NAV as a separate return driver, gearing to amplify the manager\'s conviction, and dividend smoothing via revenue reserves. In markets where the best opportunities are in unlisted assets — private equity, infrastructure, direct property — a trust can hold them. A tracker cannot.',
        pivot:'"What portion of your portfolio is in assets a tracker fund simply cannot access — private equity, infrastructure, direct real estate? Because that\'s the allocation where an investment trust is the only listed route in."' },
      { id:'t04', cat:'INCOME',
        q:'"Are the dividends sustainable?"',
        ack:'Dividend sustainability is the most important question for any income investor, and I\'m glad you asked it.',
        redirect:'The AIC publishes the Dividend Heroes list — trusts that have increased their dividend for 20+ consecutive years. City of London Investment Trust has raised its dividend for 57 consecutive years. The mechanism is the revenue reserve: in strong years, the trust banks surplus income; in weaker years, it pays from reserve. That smoothing is structurally impossible for an OEIC.',
        pivot:'"If I showed you the reserve cover ratio — how many years of dividends the trust can pay from reserves even with zero portfolio income — would that change how you think about sustainability?"' }
    ],
    analogies: [
      { scenario:'NAV discount', text:'A portfolio manager who runs a fund containing £100m of FTSE-listed shares. The fund itself is listed at £86m. You can buy those £100m of shares — with a professional manager, a revenue reserve, and a 20-year track record — for £86m. The mechanism that creates that entry is temporary. The assets are permanent.' },
      { scenario:'Closed-ended vs open-ended', text:'Two market stalls, same produce. One closes at 4pm regardless of demand — the manager takes home whatever didn\'t sell. The other stays open all day and the manager can buy more stock to meet demand. In a falling market, the first manager is never a forced seller at 3:59pm. That\'s the closed-ended structural advantage.' }
    ],
    socialProof:     'Investment trusts are the preferred vehicle of UK endowments, charitable foundations, and pension funds with long time horizons. The oldest — Foreign & Colonial, now F&C Investment Trust — has paid dividends since 1868.',
    urgencyTriggers: ['Interest rate cut cycle (narrows discounts)', 'AIC discount data releases', 'Specific trust tender offers or wind-ups (immediate NAV realisation)', 'ISA/SIPP annual allowance deadlines'],
    promptContext:   'ASSET CONTEXT — INVESTMENT TRUSTS:\nInvestment trust thesis: (1) NAV discount — trusts currently trading at widest discounts in 20 years; buying assets at 14%+ below intrinsic value. (2) Structural advantages — closed-ended, no forced selling, gearing, dividend reserves. (3) Dividend Heroes — 20+ consecutive years of dividend increases through every crisis. Key risk signals: interest rate direction (rising rates widen discounts), sector sentiment, underlying asset class (infrastructure, PE, property trusts each have different drivers). Pitch must reference discount to NAV (specific %), revenue reserves, the closed-ended structure advantage versus OEICs, and AIC data. SIPP and ISA eligible — relevant for tax-efficient wrapper conversations. Regulatory note: FCA regulated, LSE listed — retail eligible without appropriateness test.'
  },

  /* ── OFFSHORE BONDS ── */
  offshore: {
    key:        'offshore',
    label:      'Offshore Bonds',
    shortLabel: 'Offshore Bonds',
    icon:       '◳',
    tag:        'Tax Wrapper · FCA Regulated · IHT Planning',
    category:   'financial',
    regulated:  true,
    regulatory: 'FCA regulated — investment bonds issued by life assurance companies under FCA/PRA oversight',
    sipp:       false,
    eis:        false,
    liquidity:  'Semi-liquid',
    hold:       '5–25 years',
    minTicket:  '£25,000',
    thesis: [
      '5% annual withdrawal allowance — withdrawals of up to 5% of the original premium each year are treated as a return of capital, not income; tax is deferred to the point of surrender or assignment, allowing the fund to compound gross inside the wrapper',
      'Assignment and segmentation — a bond can be assigned to a lower-rate taxpayer (a spouse, adult child, or trustee) before surrender; the gain is then taxed at the recipient\'s marginal rate, not the original investor\'s; segments allow partial assignment to manage the taxable event precisely',
      'Multi-generational wealth transfer — placed in trust, an offshore bond can pass outside the estate for IHT purposes while the settlor retains a 5% income stream; combines income, IHT planning, and generational transfer in a single structure'
    ],
    openers: [
      '"I want to explain a structure that most clients have never heard of, and their accountants rarely recommend because it sits outside normal tax planning. An offshore bond allows you to take 5% of the original investment as income every year — deferred, not exempt — while everything inside the wrapper compounds gross without income or capital gains tax. For a 40% taxpayer with significant investment income, that deferral is worth materially more than most people calculate."',
      '"The question I put to clients with significant capital in general investment accounts is: every dividend, every coupon, every capital gain — are you paying tax on that annually? Because inside an offshore bond, none of that is taxed until you choose to surrender. The fund compounds gross. For a 20-year hold on a £500,000 portfolio, the compound effect of that annual tax saving is not trivial."',
      '"I\'d like to walk through a specific scenario. You have £500,000 in a GIA paying 40% income tax on dividends and CGT on gains. Inside an offshore bond, that compound tax drag is eliminated. You take 5% per year — £25,000 — tax-deferred. At the end, you surrender into a lower-rate year, or assign to an adult child. The tax comes due once. The compounding happened 25 years untaxed."'
    ],
    objections: [
      { id:'ob01', cat:'TAX',
        q:'"I\'ll just pay the tax as I go — at least I know where I stand."',
        ack:'Certainty has value — that\'s a completely rational preference.',
        redirect:'The question is whether the certainty is worth the compound cost. On a £500,000 portfolio growing at 6% per annum, the annual tax drag on income and gains inside a GIA at 40% reduces the 20-year end value by approximately £180,000 relative to gross compounding. The tax inside a bond is deferred, not avoided — it comes due on surrender. But you\'ve had 20 years of compound growth on capital that would otherwise have been paid to HMRC each year.',
        pivot:'"If I modelled the gross compounding inside the bond versus the annual tax drag outside it over your intended hold period — would you want to see that number before deciding?"' },
      { id:'ob02', cat:'COMPLEXITY',
        q:'"This sounds very complicated."',
        ack:'Offshore bonds have layers — and the technical rules around chargeable events are genuinely detailed.',
        redirect:'The investor\'s experience is straightforward: you invest, you take 5% per year, you surrender when the time is right. The complexity sits with the provider and your accountant. The 5% rule is mechanical — 5% of the original premium per year, cumulative. Unused allowance carries forward. A specialist accountant handles the chargeable event calculation on surrender.',
        pivot:'"Is the complexity concern about managing it day-to-day — which is actually simpler than a GIA — or about understanding the tax treatment on exit? Because those have different answers."' },
      { id:'ob03', cat:'IHT',
        q:'"How does this actually help with inheritance tax?"',
        ack:'The IHT planning angle requires precise explanation — and it\'s where the structure becomes most powerful.',
        redirect:'A bond written in trust is outside the estate immediately for IHT purposes on day one if it meets the relevant conditions, or after the standard seven-year period for a potentially exempt transfer. Inside the trust, the settlor can retain a 5% income stream. The trust assets pass to beneficiaries outside probate, outside the estate, and without the delay of a grant. Three problems — income, IHT, and estate administration — solved in one structure.',
        pivot:'"Does your client currently have a plan for the IHT liability on their estate? Because the offshore bond in trust addresses it while preserving the income they need in the meantime."' },
      { id:'ob04', cat:'OFFSHORE',
        q:'"Offshore sounds like a grey area — is this legitimate?"',
        ack:'That\'s the most important question to answer clearly, and I respect you asking it.',
        redirect:'Offshore bonds are FCA regulated products issued by major UK life assurance companies domiciled in the Isle of Man, Dublin, or the Channel Islands. They are fully disclosed to HMRC, reported on the investor\'s self-assessment, and have been a mainstream UK wealth planning tool for 40 years. The providers include Prudential International, Old Mutual International, and Zurich. This is not tax avoidance — it is a HMRC-recognised deferral mechanism written into statute.',
        pivot:'"The providers are UK-regulated insurers. The product is reported to HMRC. The 5% rule is a statutory allowance. At what point does a legitimate, HMRC-recognised, FCA-regulated product become grey in your view?"' },
      { id:'ob05', cat:'VERSUS',
        q:'"Why not just use a pension instead?"',
        ack:'A pension is the single most tax-efficient vehicle for most people — that\'s accurate.',
        redirect:'Pension funding is limited by the annual allowance — currently £60,000 for most clients. Beyond that, an offshore bond is the closest available structure for gross compounding. It is also more flexible on access — no minimum pension age, no death benefit restrictions, no lifetime allowance legacy concerns. And unlike a pension, the bond can be assigned to a beneficiary outside the estate while the original investor retains the 5% income.',
        pivot:'"Has your client maximised their pension contributions? Because if so — and they have further capital to deploy in a tax-efficient structure — the offshore bond is the logical next layer."' }
    ],
    analogies: [
      { scenario:'Gross compounding', text:'Two identical market gardens. One pays rent tax every month. The other defers all rent until the lease ends — and reinvests everything gross in the meantime. After 20 years, both gardens are sold and the deferred rent is paid once. The second garden has significantly more produce. Not because it avoided the rent. Because it had 20 years of uninhibited growth.' },
      { scenario:'Assignment mechanism', text:'A business that sells itself to its adult children at a point when they\'re in a lower tax bracket. The gain exists — but the timing and the taxpayer are chosen strategically. The offshore bond\'s assignment mechanism is the investment equivalent: the taxable event happens when and to whom the original investor decides.' }
    ],
    socialProof:     'Offshore investment bonds have been used by UK wealth managers and private banks for 40 years. Providers include Prudential International, Old Mutual International, Zurich International, and Utmost. The structure is standard in portfolios managed by St James\'s Place, Brewin Dolphin, and Rathbones.',
    urgencyTriggers: ['Tax year-end — maximise 5% cumulative allowance timing', 'CGT rate changes (makes deferral more valuable)', 'Budget announcements on income tax or IHT', 'Client approaching higher-rate threshold', 'Estate planning review triggers'],
    promptContext:   'ASSET CONTEXT — OFFSHORE BONDS / INVESTMENT BONDS:\nOffshore bond thesis: (1) 5% annual withdrawal allowance — statutory deferral, not avoidance; tax deferred to surrender, allowing gross compounding inside the wrapper. (2) Assignment and segmentation — bond can be assigned to a lower-rate taxpayer before surrender; chargeable event gain taxed at recipient\'s marginal rate. (3) Multi-generational IHT planning — written in trust, outside the estate, settlor retains 5% income stream. Key risk signals: income tax rate changes, CGT rate changes, IHT threshold changes, offshore regulatory environment. Pitch must reference FCA/PRA regulation, established providers (Prudential International, Zurich, Old Mutual), HMRC statutory basis of the 5% rule, and specific use case (GIA alternative for higher-rate taxpayers with significant investment income). Always recommend specialist tax advice before implementation.'
  },

  /* ── UNIVERSAL ── */
  universal: {
    key:        'universal',
    label:      'Universal',
    shortLabel: 'Universal',
    icon:       '∞',
    tag:        'Cross-Asset · All Classes',
    category:   'universal',
    regulated:  null,
    regulatory: 'Varies by asset class — confirm regulatory status per product',
    sipp:       null,
    eis:        null,
    liquidity:  'Varies',
    hold:       'Varies',
    minTicket:  'Varies',
    thesis: [
      'Purchasing power preservation — the pound has lost 74% of its real purchasing power since 2000; real assets with intrinsic scarcity preserve what paper assets erode',
      'Non-correlation imperative — in 2022, both equities and bonds fell simultaneously; genuine portfolio resilience requires assets that don\'t move with financial markets',
      'Wealth outside the banking system — physical, tangible, and equity assets held directly are not claims on financial institutions; they exist independently of bank solvency'
    ],
    openers: [
      '"The question I\'m hearing from clients this week isn\'t which asset to own — it\'s why their money is still sitting in a savings account returning less than inflation. I\'d like to walk through what the data says about that decision."',
      '"In 2022, both equity and bond markets fell simultaneously for the first time in 40 years. The 60/40 portfolio — the default for most private wealth — lost 16%. What was positive in your portfolio during that period? And how much of your allocation do you want to be genuinely uncorrelated to the next time that happens?"',
      '"The pound has lost 74% of its real purchasing power since 2000. A savings account balance that hasn\'t moved looks stable. In purchasing power terms, it isn\'t. The clients I\'m calling today have significant capital in structures that look safe but are quietly losing ground to currency debasement."'
    ],
    objections: [
      { id:'u01', cat:'RISK',
        q:'"I don\'t want to take on more risk."',
        ack:'Risk management is exactly the right framework, and I wouldn\'t suggest anything different.',
        redirect:'The question is how you define risk. Staying in cash is a risk decision — it just doesn\'t feel like one. Your savings account is making a concentrated bet on sterling purchasing power. It\'s delivered a real return of approximately -3% per year for the last five years. That\'s a loss — it just doesn\'t appear on a statement.',
        pivot:'"If your current allocation is returning less than inflation in real terms — is that the risk-free position you\'re trying to protect, or is that a risk you\'re already carrying?"' },
      { id:'u02', cat:'TIMING',
        q:'"Now\'s not the right time."',
        ack:'Timing is one of the most psychologically powerful reasons to defer any decision.',
        redirect:'There is no investment decision in history where the data said "perfect time, all clear, no uncertainty." The clients who invested in 2009 said there was too much uncertainty. So did 2012, 2016, and 2020. The pattern is consistent: the period that felt most uncertain produced the strongest subsequent returns. Waiting for certainty is waiting for the opportunity to pass.',
        pivot:'"What specifically needs to change before the timing feels right? And what is the cost of being in cash for that period if it takes longer than expected?"' },
      { id:'u03', cat:'COMPLEXITY',
        q:'"I don\'t understand these alternative investments."',
        ack:'That\'s one of the most honest things a client can say, and I respect it.',
        redirect:'Complexity is usually a function of how something is explained, not how it works. A cask of whisky is simpler than a bond — you own a physical object that increases in value over time and you sell it. A property loan is simpler than an equity fund — you lend money at a fixed rate against a specific building as security. I\'d like to see if I can explain the specific structure clearly enough that the complexity concern resolves.',
        pivot:'"Is the complexity about the asset itself, or about how to evaluate whether the specific offer you\'re looking at is a fair one? Because those need different conversations."' }
    ],
    analogies: [
      { scenario:'Currency debasement', text:'A ruler that shrinks 3% every year. The house doesn\'t get bigger — the ruler just gets shorter. The same is true of money. When the unit of measurement is being debased, the assets that hold real value aren\'t the ones priced in that unit.' },
      { scenario:'Non-correlation', text:'A ship\'s captain who doesn\'t know whether the Suez Canal will be open next week. They don\'t cancel the cargo. They insure it against the risk. Real assets in a portfolio are not a bet that equities will fall — they\'re insurance that continues to appreciate even if equities don\'t.' }
    ],
    socialProof:     'Sovereign wealth funds, endowments, and family offices globally allocate 25–40% to alternatives. The Yale endowment model — the most replicated institutional framework — holds over 60% in non-traditional assets.',
    urgencyTriggers: ['CPI / inflation data releases', 'Central bank rate decisions', 'Currency movements', 'Geopolitical escalation events', 'Annual ISA / pension allowance deadlines'],
    promptContext:   'ASSET CONTEXT — UNIVERSAL / CROSS-ASSET:\nUniversal framework: (1) Purchasing power preservation — currency debasement affects all cash and fixed-rate holdings. (2) Non-correlation — genuine portfolio resilience requires assets independent of financial market movements. (3) Wealth outside the banking system — physical and direct equity assets exist independently of bank solvency. This context applies to any alternative investment conversation before the specific asset is named. Key signals: CPI, real interest rates, DXY, geopolitical risk index. Pitch must be completely asset-neutral — "real assets", "tangible assets", "alternative assets", "assets outside the banking system" — the broker names the specific product after the framework is established.'
  }

};

/* ── ACTIVE LENS STATE ─────────────────────────────────────────────────────── */
(function () {
  var saved = localStorage.getItem('tbt_asset_lens');
  var initial = (saved && window.ASSET_PROFILES[saved]) ? saved : 'whisky';
  window._assetLens = window.ASSET_PROFILES[initial];

  window._setAssetLens = function (key) {
    var profile = window.ASSET_PROFILES[key];
    if (!profile) return;
    window._assetLens = profile;
    localStorage.setItem('tbt_asset_lens', key);
    window.dispatchEvent(new CustomEvent('lens:change', { detail: profile }));
  };
})();
