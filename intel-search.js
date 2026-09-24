/* ── BROKERS INTELLIGENCE SEARCH — shared component ─────────────────────── */
(function () {
  'use strict';

  var _debounce = null;
  window._sharedZ = window._sharedZ || 1000;
  var _popOffset = 0;
  var _cache = {};    /* session cache: key → parsed response */

  /* ── localStorage cache — 7-day TTL, matches CDN ── */
  var LS_TTL = 7 * 24 * 3600 * 1000;
  function lsGet(key) {
    try {
      var raw = localStorage.getItem('tbt_ws_' + key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || Date.now() - (obj.ts || 0) > LS_TTL) { localStorage.removeItem('tbt_ws_' + key); return null; }
      return obj.data;
    } catch (e) { return null; }
  }
  function lsSet(key, data) {
    try { localStorage.setItem('tbt_ws_' + key, JSON.stringify({ ts: Date.now(), data: data })); } catch (e) {}
  }
  var _registry = {}; /* pid → {query, type, ticker, x, y, w, h} */

  /* ── Static concept / event suggestion list — all searchable financial topics ── */
  var CONCEPT_LIST = [
    /* ── Historical crises ── */
    { label: 'Global Financial Crisis (GFC) 2008', query: 'Global Financial Crisis 2008' },
    { label: 'Subprime Mortgage Crisis 2007', query: 'Subprime Mortgage Crisis 2007 US housing collapse' },
    { label: 'Black Monday 1987', query: 'Black Monday stock market crash 1987' },
    { label: 'Dot-com Bubble 2000', query: 'Dot-com bubble 2000 tech crash Nasdaq' },
    { label: 'Tulip Mania 1637', query: 'Tulip mania 1637 speculative bubble' },
    { label: 'Asian Financial Crisis 1997', query: 'Asian Financial Crisis 1997 currency contagion' },
    { label: 'Great Depression 1929', query: 'Great Depression 1929 stock market crash banking collapse' },
    { label: 'Weimar Hyperinflation 1923', query: 'Weimar Republic hyperinflation 1923 currency collapse' },
    { label: 'Stagflation 1970s', query: 'Stagflation 1970s oil crisis inflation unemployment' },
    { label: 'Eurozone Sovereign Debt Crisis', query: 'Eurozone Sovereign Debt Crisis 2010 Greece bailout' },
    { label: 'COVID Market Crash 2020', query: 'COVID market crash March 2020 pandemic selloff' },
    { label: 'Silicon Valley Bank Collapse 2023', query: 'Silicon Valley Bank SVB collapse 2023 bank run' },
    { label: 'LTCM Collapse 1998', query: 'Long-Term Capital Management LTCM collapse 1998 hedge fund bailout' },
    { label: 'Black Wednesday 1992', query: 'Black Wednesday 1992 UK pound ERM crisis Soros' },
    { label: 'Northern Rock Bank Run 2007', query: 'Northern Rock bank run 2007 UK mortgage crisis' },
    { label: 'UK Gilt Crisis 2022', query: 'UK Gilt Crisis 2022 mini-budget LDI pension funds' },
    { label: 'Nifty Fifty Bubble 1970s', query: 'Nifty Fifty bubble 1970s US growth stock collapse' },
    { label: 'Savings & Loan Crisis 1980s', query: 'Savings and Loan Crisis 1980s US banking deregulation failure' },
    { label: 'Russian Default 1998', query: 'Russian Default 1998 rouble collapse sovereign debt' },
    { label: 'Argentine Default 2001', query: 'Argentine Default 2001 peso crisis IMF' },
    { label: 'Flash Crash 2010', query: 'Flash Crash May 2010 algorithmic trading market structure' },
    { label: 'Mexican Peso Crisis 1994', query: 'Mexican Peso Crisis 1994 tequila effect currency devaluation' },
    { label: 'Japanese Asset Bubble 1989', query: 'Japanese Asset Bubble 1989 Nikkei property collapse lost decade' },
    { label: 'Enron Collapse 2001', query: 'Enron collapse 2001 corporate fraud accounting scandal' },
    { label: 'Lehman Brothers Collapse 2008', query: 'Lehman Brothers collapse September 2008 bankruptcy contagion' },

    /* ── Macro & monetary policy ── */
    { label: 'Quantitative Easing (QE)', query: 'Quantitative Easing monetary policy central bank asset purchases' },
    { label: 'Quantitative Tightening (QT)', query: 'Quantitative Tightening balance sheet reduction interest rates' },
    { label: 'Financial Repression', query: 'Financial Repression negative real interest rates government debt' },
    { label: 'Monetary Debasement', query: 'Monetary Debasement currency devaluation purchasing power erosion' },
    { label: 'Debt Supercycle', query: 'Debt Supercycle Ray Dalio long-term debt cycle deleveraging' },
    { label: 'Yield Curve Inversion', query: 'Yield Curve Inversion recession signal inverted 2s10s' },
    { label: 'De-dollarisation', query: 'De-dollarisation BRICS reserve currency shift petrodollar end' },
    { label: 'Cantillon Effect', query: 'Cantillon Effect money creation inequality asset price inflation' },
    { label: 'Currency Wars', query: 'Currency Wars competitive devaluation beggar-thy-neighbour policy' },
    { label: 'M2 Money Supply', query: 'M2 Money Supply expansion inflation monetary aggregates' },
    { label: 'Petrodollar System', query: 'Petrodollar System USD oil settlement Bretton Woods dollar hegemony' },
    { label: 'Bretton Woods System', query: 'Bretton Woods System 1944 gold standard dollar reserve currency' },
    { label: 'Dollar Milkshake Theory', query: 'Dollar Milkshake Theory Brent Johnson USD strength capital flows' },
    { label: 'Fiscal Dominance', query: 'Fiscal Dominance government debt monetisation central bank independence' },
    { label: 'Modern Monetary Theory (MMT)', query: 'Modern Monetary Theory MMT government spending money creation' },
    { label: 'Phillips Curve', query: 'Phillips Curve inflation unemployment trade-off breakdown' },
    { label: 'Basel III / Bank Capital Rules', query: 'Basel III bank capital requirements liquidity coverage ratio' },
    { label: 'Repo Market', query: 'Repo Market repurchase agreements overnight funding liquidity' },
    { label: 'Shadow Banking System', query: 'Shadow Banking System non-bank financial intermediation systemic risk' },
    { label: 'Central Bank Digital Currency (CBDC)', query: 'Central Bank Digital Currency CBDC digital pound programmable money' },
    { label: 'BRICS Currency & Reserve Shift', query: 'BRICS reserve currency alternative dollar replacement geopolitics' },

    /* ── Economic indicators ── */
    { label: 'Inflation', query: 'Inflation causes effects CPI wealth erosion real returns' },
    { label: 'Deflation', query: 'Deflation falling prices debt deflation spiral Japan' },
    { label: 'Stagflation', query: 'Stagflation simultaneous high inflation high unemployment slow growth' },
    { label: 'Hyperinflation', query: 'Hyperinflation extreme price acceleration currency collapse historical cases' },
    { label: 'ISM Manufacturing Index', query: 'ISM Manufacturing PMI economic indicator expansion contraction' },
    { label: 'Purchasing Power Parity (PPP)', query: 'Purchasing Power Parity PPP exchange rate valuation Big Mac index' },
    { label: 'Velocity of Money', query: 'Velocity of Money MV=PQ monetary equation GDP transmission' },
    { label: 'Bank Run Mechanics', query: 'Bank Run mechanism fractional reserve banking deposit insurance contagion' },
    { label: 'Credit Crunch', query: 'Credit Crunch liquidity crisis bank lending freeze economic impact' },
    { label: 'Carry Trade', query: 'Carry Trade borrow low-rate currency invest high-rate unwinding risk' },
    { label: 'Correlation Breakdown', query: 'Correlation Breakdown 60/40 portfolio stocks bonds inflation 2022' },

    /* ── Investment concepts ── */
    { label: 'Illiquidity Premium', query: 'Illiquidity Premium private assets return advantage over public markets' },
    { label: 'Volatility (VIX)', query: 'VIX Volatility Index fear gauge options market implied volatility' },
    { label: 'Duration Risk', query: 'Duration Risk bond sensitivity interest rate rises long-dated gilts' },
    { label: 'Diversification Myth', query: 'Diversification Myth 2022 bonds equities correlate in inflation regime' },
    { label: 'Gold as a Monetary Metal', query: 'Gold monetary metal safe haven inflation hedge central bank reserves' },
    { label: 'Gold Bull Market History', query: 'Gold Bull Market 1970s 2000s 2024 price drivers performance' },
    { label: 'Silver Market', query: 'Silver Market gold-silver ratio industrial demand monetary metal' },
    { label: 'Fine Wine as an Investment', query: 'Fine Wine investment Liv-ex market returns alternative asset' },
    { label: 'Whisky as an Investment', query: 'Whisky investment rare cask single malt auction market returns' },
    { label: 'Agricultural Land & Forestry', query: 'Agricultural Land Forestry investment IHT relief APR farmland returns' },
    { label: 'Art Market', query: 'Art Market investment Mei Moses index blue-chip Sothebys Christie liquidity' },
    { label: 'Private Equity Returns', query: 'Private Equity returns illiquidity premium J-curve MOIC IRR endowments' },
    { label: 'Infrastructure Investment', query: 'Infrastructure Investment investment trusts income inflation-linked returns' },

    /* ── UK tax & planning ── */
    { label: 'Inheritance Tax (IHT) Planning', query: 'Inheritance Tax IHT planning Business Property Relief agricultural APR' },
    { label: 'Venture Capital Trusts (VCT)', query: 'Venture Capital Trusts VCT 30% income tax relief dividends LSE-listed' },
    { label: 'Enterprise Investment Scheme (EIS)', query: 'Enterprise Investment Scheme EIS SEIS 30% 50% income tax relief CGT' },
    { label: 'Offshore Bonds', query: 'Offshore Bonds investment bonds 5% withdrawal tax deferral gross roll-up' },
    { label: 'Business Property Relief (BPR)', query: 'Business Property Relief BPR IHT exemption 2-year qualifying hold AIM' },
    { label: 'Capital Gains Tax (CGT)', query: 'Capital Gains Tax CGT UK rates planning bed and ISA asset disposal' },
  ];

  /* Expose state for terminal-canvas saveLayout */
  window._getIntelPopouts = function () {
    return Object.values(_registry);
  };

  /* ── TYPEWRITER CASCADE ─────────────────────────────────────────────────────
     After renderCompany/renderConcept sets innerHTML, call cascadeType(body) to
     animate each text block in sequentially — mimics the "writing" feel.
     Speed: ~6ms per character for key fields, instant fade for structural elements.
  ──────────────────────────────────────────────────────────────────────────── */
  function typeInto(el, text, speed, onDone) {
    el.textContent = '';
    var i = 0;
    var t = setInterval(function () {
      if (i >= text.length) { clearInterval(t); if (onDone) onDone(); return; }
      /* Append one char at a time; respect natural word breaks */
      el.textContent = text.slice(0, i + 1);
      i++;
    }, speed || 6);
    return t;
  }

  function cascadeType(body) {
    /* Selectors ordered by visual position — type top to bottom */
    var selectors = [
      '.sp-tagline',
      '.sp-text',
      '.sp-tl-evt',
      '.sp-pitch-quote',
      '.sp-pitch-body',
      '.sp-pitch-row .sp-pitch-body',
    ];
    var queue = [];
    selectors.forEach(function (sel) {
      body.querySelectorAll(sel).forEach(function (el) {
        var txt = el.textContent;
        if (txt && txt.trim()) queue.push({ el: el, txt: txt });
      });
    });
    /* De-duplicate (an element can match multiple selectors) */
    var seen = [];
    queue = queue.filter(function (item) {
      if (seen.indexOf(item.el) !== -1) return false;
      seen.push(item.el); return true;
    });

    /* Clear every element upfront so the panel starts blank — no flash of full content */
    queue.forEach(function (item) { item.el.textContent = ''; });

    /* Animate each element after the previous finishes, with a small gap */
    var GAP = 80; /* ms pause between elements */
    function runNext(idx) {
      if (idx >= queue.length) return;
      var item = queue[idx];
      /* Cap typing time per element so long texts don't drag */
      var chars = item.txt.length;
      var speed = chars > 300 ? 2 : chars > 120 ? 3 : 5;
      typeInto(item.el, item.txt, speed, function () {
        setTimeout(function () { runNext(idx + 1); }, GAP);
      });
    }
    runNext(0);
  }

  /* Called by terminal-canvas on login to restore saved popouts */
  window._restoreIntelPopouts = function (saved) {
    (saved || []).forEach(function (p) {
      if (!p.query) return;
      var win = createPopout(p.query, p.type || 'company');
      win.style.left = (p.x || 200) + 'px';
      win.style.top  = (p.y || 80)  + 'px';
      if (p.w) win.style.width  = p.w + 'px';
      if (p.h) win.style.height = p.h + 'px';
      fetchDetail(p.query, p.type || 'company', p.ticker || '', win);
    });
  };

  function _saveIntelState() {
    if (window.saveLayout) { window.saveLayout(); return; }
    /* Fallback: trigger saveLayout via the canvas module if available */
    if (window._tbcSaveLayout) window._tbcSaveLayout();
  }

  /* ── BUILD SEARCH BAR HTML ── */
  function buildSearchBar(containerId) {
    var wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="intel-search-wrap">' +
        /* Honeypot inputs: absorb Chrome credential autofill so it never reaches the real search field */
        '<input type="text" name="username" tabindex="-1" aria-hidden="true" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;overflow:hidden;">' +
        '<input type="password" name="password" tabindex="-1" aria-hidden="true" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;overflow:hidden;">' +
        '<div class="intel-search-bar">' +
          '<span class="intel-search-icon">⌕</span>' +
          '<span class="intel-search-lbl">INTEL</span>' +
          '<input type="text" id="intel-search-input" placeholder="Company, asset, concept or IFA scenario…" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" readonly>' +
        '</div>' +
        '<button id="intel-ifa-btn" title="Open IFA client intake form">▌ IFA INTEL</button>' +
        '<button id="intel-clients-btn" title="View saved client briefs">CLIENTS</button>' +
      '</div>';

    /* Append dropdown to body so it escapes any parent stacking context */
    var dropdown = document.getElementById('intel-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'intel-dropdown';
      dropdown.id = 'intel-dropdown';
      dropdown.style.display = 'none';
      document.body.appendChild(dropdown);
    }

    var input = document.getElementById('intel-search-input');

    /* ── IFA INTEL INTAKE FORM ── */
    var ifaBtn = document.getElementById('intel-ifa-btn');
    var ifaModal = document.getElementById('intel-ifa-modal');
    if (!ifaModal) {
      ifaModal = document.createElement('div');
      ifaModal.id = 'intel-ifa-modal';
      ifaModal.innerHTML =
        '<div class="ifa-modal-overlay" id="intel-ifa-overlay"></div>' +
        '<div class="ifa-modal-panel">' +
          '<div class="ifa-modal-hdr">' +
            '<div style="display:flex;flex-direction:column;gap:2px;">' +
              '<div style="font-size:7px;letter-spacing:.3em;color:#E97132;font-weight:700;">IFA INTEL</div>' +
              '<div style="font-size:13px;color:#fff;letter-spacing:.06em;font-weight:700;">CLIENT INTAKE</div>' +
            '</div>' +
            '<button class="ifa-modal-close" id="intel-ifa-close">✕</button>' +
          '</div>' +

          '<div class="ifa-modal-body">' +

            '<div class="ifa-row2">' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">CLIENT REFERENCE <span class="ifa-opt">optional</span></label>' +
                '<input class="ifa-input" id="ifa-ref" type="text" placeholder="e.g. Client A, JB47…" autocomplete="off">' +
              '</div>' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">AGE / BACKGROUND</label>' +
                '<input class="ifa-input" id="ifa-age" type="text" placeholder="e.g. 54, retired surgeon, married" autocomplete="off">' +
              '</div>' +
            '</div>' +

            '<div class="ifa-row2">' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">PORTFOLIO VALUE</label>' +
                '<input class="ifa-input" id="ifa-portfolio" type="text" placeholder="e.g. £1.2m investable" autocomplete="off">' +
              '</div>' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">TIME HORIZON</label>' +
                '<select class="ifa-input ifa-select" id="ifa-horizon">' +
                  '<option value="">Select…</option>' +
                  '<option value="short-term (under 3 years)">Short-term — under 3 years</option>' +
                  '<option value="medium-term (3–7 years)">Medium-term — 3–7 years</option>' +
                  '<option value="long-term (7+ years)">Long-term — 7+ years</option>' +
                  '<option value="wealth preservation / multigenerational">Multigenerational / preservation</option>' +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div class="ifa-field">' +
              '<label class="ifa-lbl">CURRENT HOLDINGS</label>' +
              '<input class="ifa-input" id="ifa-holdings" type="text" placeholder="e.g. 70% UK equities, 20% cash, 10% property" autocomplete="off">' +
            '</div>' +

            '<div class="ifa-row2">' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">GOALS</label>' +
                '<textarea class="ifa-input ifa-ta" id="ifa-goals" placeholder="e.g. Preserve capital, generate income, fund retirement in 8 years…" rows="3"></textarea>' +
              '</div>' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">CONCERNS / PAIN POINTS</label>' +
                '<textarea class="ifa-input ifa-ta" id="ifa-concerns" placeholder="e.g. Worried about inflation eroding savings, no diversification outside stocks…" rows="3"></textarea>' +
              '</div>' +
            '</div>' +

            '<div class="ifa-row2">' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">TAX SITUATION <span class="ifa-opt">optional</span></label>' +
                '<input class="ifa-input" id="ifa-tax" type="text" placeholder="e.g. ISA fully used, large GIA, IHT concern, SIPP drawdown" autocomplete="off">' +
              '</div>' +
              '<div class="ifa-field">' +
                '<label class="ifa-lbl">FOCUS FOR THIS BRIEF <span class="ifa-opt">optional</span></label>' +
                '<input class="ifa-input" id="ifa-focus" type="text" placeholder="e.g. Alternative allocation case, IHT mitigation, opening pitch" autocomplete="off">' +
              '</div>' +
            '</div>' +

          '</div>' +

          '<div class="ifa-modal-ftr">' +
            '<div class="ifa-preview" id="ifa-preview"></div>' +
            '<button class="ifa-run-btn" id="ifa-run-btn">▌ RUN INTEL BRIEF</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ifaModal);
    }

    function _openIfaModal() {
      /* Reset all fields so previous client data never bleeds through */
      ['ifa-ref','ifa-age','ifa-portfolio','ifa-horizon','ifa-holdings','ifa-goals','ifa-concerns','ifa-tax','ifa-focus'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      ifaModal.style.display = 'flex';
      setTimeout(function() { ifaModal.querySelector('.ifa-modal-panel').classList.add('ifa-panel-in'); }, 10);
      document.getElementById('ifa-age').focus();
      _updateIfaPreview();
    }
    function _closeIfaModal() {
      ifaModal.querySelector('.ifa-modal-panel').classList.remove('ifa-panel-in');
      setTimeout(function() { ifaModal.style.display = 'none'; }, 180);
    }

    function _getIfaVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

    function _buildIfaQuery() {
      var parts = [];
      var age = _getIfaVal('ifa-age'), portfolio = _getIfaVal('ifa-portfolio'),
          holdings = _getIfaVal('ifa-holdings'), horizon = _getIfaVal('ifa-horizon'),
          goals = _getIfaVal('ifa-goals'), concerns = _getIfaVal('ifa-concerns'),
          tax = _getIfaVal('ifa-tax'), focus = _getIfaVal('ifa-focus'), ref = _getIfaVal('ifa-ref');
      if (ref)       parts.push('Client: ' + ref + '.');
      if (age)       parts.push('Profile: ' + age + '.');
      if (portfolio) parts.push('Portfolio: ' + portfolio + '.');
      if (holdings)  parts.push('Current holdings: ' + holdings + '.');
      if (horizon)   parts.push('Time horizon: ' + horizon + '.');
      if (goals)     parts.push('Goals: ' + goals + '.');
      if (concerns)  parts.push('Concerns: ' + concerns + '.');
      if (tax)       parts.push('Tax situation: ' + tax + '.');
      if (focus)     parts.push('Focus: ' + focus + '.');
      return parts.join(' ');
    }

    function _updateIfaPreview() {
      var prev = document.getElementById('ifa-preview');
      if (!prev) return;
      var q = _buildIfaQuery();
      prev.textContent = q || '';
      prev.style.display = q ? 'block' : 'none';
    }

    function _resetIfaBtn() {
      if (ifaBtn) { ifaBtn.textContent = '▌ IFA INTEL'; ifaBtn.style.background = '#E97132'; }
    }

    if (ifaBtn) {
      ifaBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var typed = input.value.trim();
        var isLong = typed.split(/\s+/).filter(Boolean).length > 5;
        if (isLong) {
          /* User typed a scenario — run it directly as an IFA brief */
          window._lastIfaIntake = { query: typed, composedAt: Date.now() };
          input.value = '';
          _resetIfaBtn();
          dropdown.style.display = 'none';
          window._intelSearch(typed, 'scenario', '');
        } else {
          _openIfaModal();
        }
      });
    }


    var clientsBtn = document.getElementById('intel-clients-btn');
    if (clientsBtn) {
      clientsBtn.addEventListener('click', function(e) { e.stopPropagation(); _openClientsModal(); });
    }
    document.getElementById('intel-ifa-close') && document.getElementById('intel-ifa-close').addEventListener('click', _closeIfaModal);
    document.getElementById('intel-ifa-overlay') && document.getElementById('intel-ifa-overlay').addEventListener('click', _closeIfaModal);

    /* Live preview update */
    ['ifa-ref','ifa-age','ifa-portfolio','ifa-horizon','ifa-holdings','ifa-goals','ifa-concerns','ifa-tax','ifa-focus'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', _updateIfaPreview);
    });

    /* Run button */
    var ifaRunBtn = document.getElementById('ifa-run-btn');
    if (ifaRunBtn) {
      ifaRunBtn.addEventListener('click', function() {
        var q = _buildIfaQuery();
        if (!q) return;
        /* Snapshot intake fields for client brief saving */
        window._lastIfaIntake = {
          ref: _getIfaVal('ifa-ref'), age: _getIfaVal('ifa-age'),
          portfolio: _getIfaVal('ifa-portfolio'), horizon: _getIfaVal('ifa-horizon'),
          holdings: _getIfaVal('ifa-holdings'), goals: _getIfaVal('ifa-goals'),
          concerns: _getIfaVal('ifa-concerns'), tax: _getIfaVal('ifa-tax'),
          focus: _getIfaVal('ifa-focus'), query: q, composedAt: Date.now(),
        };
        _closeIfaModal();
        /* Small delay so modal closes cleanly before result appears */
        setTimeout(function() { window._intelSearch(q, 'scenario', ''); }, 200);
      });
    }

    /* Pre-warm: fire a ping on first focus to keep the serverless function hot */
    var _warmSent = false;
    function _pingWarm() {
      if (_warmSent) return;
      _warmSent = true;
      fetch('/.netlify/functions/search?ping=1').catch(function(){});
    }

    /* Chrome won't autofill readonly inputs — remove readonly on first interaction */
    function unlockInput() {
      input.removeAttribute('readonly');
      input.removeEventListener('mousedown', unlockInput);
      input.removeEventListener('focus', unlockInput);
    }
    input.addEventListener('mousedown', function() { _pingWarm(); unlockInput(); });
    input.addEventListener('focus',     function() { _pingWarm(); unlockInput(); });

    function positionDropdown() {
      var r = input.getBoundingClientRect();
      dropdown.style.top  = (r.bottom + 4) + 'px';
      dropdown.style.left = r.left + 'px';
    }

    input.addEventListener('input', function () {
      clearTimeout(_debounce);
      var q = this.value.trim();
      var wc = q.split(/\s+/).filter(Boolean).length;
      /* Relabel IFA INTEL button when query is long enough to be a scenario */
      if (ifaBtn) {
        if (wc > 5) {
          ifaBtn.textContent = '▌ RUN IFA BRIEF →';
          ifaBtn.style.background = '#c05a1e';
        } else {
          ifaBtn.textContent = '▌ IFA INTEL';
          ifaBtn.style.background = '#E97132';
        }
      }
      if (!q || q.length < 2) { dropdown.style.display = 'none'; return; }
      positionDropdown();
      dropdown.style.display = 'block';
      if (wc > 5) {
        /* Scenario — render immediately from local text, no server call */
        var label = 'Advisory brief: "' + q + '"';
        var scenWords = label.split(' ');
        var scenLines = [];
        for (var wi = 0; wi < scenWords.length; wi += 10) {
          scenLines.push(escH(scenWords.slice(wi, wi + 10).join(' ')));
        }
        dropdown.innerHTML = '<div class="intel-drop-item concept intel-drop-scenario" ' +
          'data-label="' + escH(label) + '" ' +
          'data-query="' + escH(q) + '" ' +
          'data-type="scenario">' +
          '<span class="intel-drop-badge sc">IFA</span>' +
          '<span class="intel-drop-label">' + scenLines.join('<br>') + '</span>' +
          '</div>';
        /* Wire click on the locally-rendered scenario item */
        dropdown.querySelector('[data-type="scenario"]').addEventListener('click', function () {
          dropdown.style.display = 'none';
          window._intelSearch(q, 'scenario', '');
        });
      } else {
        dropdown.innerHTML = '<div class="intel-drop-loading">SEARCHING<span>...</span></div>';
        _debounce = setTimeout(function () { fetchSuggestions(q, dropdown); }, 320);
      }
    });

    input.addEventListener('keydown', function (e) {
      /* Prevent textarea newlines — Enter submits, Shift+Enter is blocked too */
      if (e.key === 'Enter') { e.preventDefault(); }
      if (e.key === 'Escape') {
        dropdown.style.display = 'none';
        input.value = '';
        _resetIfaBtn();
      }
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
    });
  }

  /* ── FETCH SUGGESTIONS ── */
  function fetchSuggestions(q, dropdown) {
    var ql = q.toLowerCase();
    /* Client-side concept matches — instant, no network needed */
    var conceptMatches = CONCEPT_LIST.filter(function (c) {
      return c.label.toLowerCase().indexOf(ql) !== -1 ||
             c.query.toLowerCase().indexOf(ql) !== -1;
    }).slice(0, 4).map(function (c) {
      return { type: 'concept', label: c.label, query: c.query };
    });

    var wordCount = q.trim().split(/\s+/).length;
    var companyFreeSearch = wordCount <= 5 ? { type: 'company', label: q, query: q, ticker: '', private: true } : null;

    fetch('/.netlify/functions/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        var combined = conceptMatches.concat(items || []);
        if (!combined.length) combined.push({ type: 'concept', label: 'Search: "' + q + '"', query: q });
        if (companyFreeSearch) combined.push(companyFreeSearch);
        renderDropdown(combined, dropdown);
      })
      .catch(function () {
        var fallback = conceptMatches.concat([{ type: 'concept', label: 'Search: "' + q + '"', query: q }]);
        if (companyFreeSearch) fallback.push(companyFreeSearch);
        renderDropdown(fallback, dropdown);
      });
  }

  /* ── RENDER DROPDOWN ── */
  function renderDropdown(items, dropdown) {
    if (!items || !items.length) {
      dropdown.innerHTML = '<div class="intel-drop-loading">NO RESULTS</div>';
      return;
    }
    dropdown.innerHTML = items.map(function (item) {
      if (item.type === 'company' && item.private) {
        return '<div class="intel-drop-item concept" ' +
          'data-label="' + escH(item.label) + '" ' +
          'data-query="' + escH(item.query || item.label) + '" ' +
          'data-type="company-free">' +
          '<span class="intel-drop-badge sc">PRIV</span>' +
          '<span class="intel-drop-label">Company search: ' + escH(item.label) + '</span>' +
          '</div>';
      } else if (item.type === 'company') {
        return '<div class="intel-drop-item" ' +
          'data-label="' + escH(item.label) + '" ' +
          'data-ticker="' + escH(item.ticker || '') + '" ' +
          'data-type="company">' +
          '<span class="intel-drop-badge co">CO</span>' +
          '<span class="intel-drop-label">' + escH(item.label) + '</span>' +
          '<span class="intel-drop-ticker">' + escH(item.ticker || '') + '</span>' +
          '<span class="intel-drop-arrow">›</span>' +
          '</div>';
      } else if (item.type === 'scenario') {
        var scenWords = item.label.split(' ');
        var scenLines = [];
        for (var wi = 0; wi < scenWords.length; wi += 10) {
          scenLines.push(escH(scenWords.slice(wi, wi + 10).join(' ')));
        }
        return '<div class="intel-drop-item concept intel-drop-scenario" ' +
          'data-label="' + escH(item.label) + '" ' +
          'data-query="' + escH(item.query || item.label) + '" ' +
          'data-type="scenario">' +
          '<span class="intel-drop-badge sc">IFA</span>' +
          '<span class="intel-drop-label">' + scenLines.join('<br>') + '</span>' +
          '</div>';
      } else {
        return '<div class="intel-drop-item concept" ' +
          'data-label="' + escH(item.label) + '" ' +
          'data-query="' + escH(item.query || item.label) + '" ' +
          'data-type="concept">' +
          '<span class="intel-drop-badge cx">SEARCH</span>' +
          '<span class="intel-drop-label">' + escH(item.label) + '</span>' +
          '</div>';
      }
    }).join('');

    /* Wire hover sub-panel for company items */
    dropdown.querySelectorAll('.intel-drop-item[data-type="company"]').forEach(function (row) {
      var hoverTimer;
      row.addEventListener('mouseenter', function () {
        hoverTimer = setTimeout(function () { showSubPanel(row); }, 180);
      });
      row.addEventListener('mouseleave', function (e) {
        clearTimeout(hoverTimer);
        var sub = row.querySelector('.intel-sub-panel');
        if (sub && !sub.contains(e.relatedTarget)) sub.remove();
      });
    });

    /* Concept items: click directly */
    dropdown.querySelectorAll('.intel-drop-item[data-type="concept"]').forEach(function (row) {
      row.addEventListener('click', function () {
        window._intelSearch(row.dataset.query || row.dataset.label, 'concept', '');
      });
    });

    /* Private/free company search: click directly */
    dropdown.querySelectorAll('.intel-drop-item[data-type="company-free"]').forEach(function (row) {
      row.addEventListener('click', function () {
        window._intelSearch(row.dataset.query || row.dataset.label, 'company', '');
      });
    });

    /* Scenario items: click directly */
    dropdown.querySelectorAll('.intel-drop-item[data-type="scenario"]').forEach(function (row) {
      row.addEventListener('click', function () {
        window._intelSearch(row.dataset.query || row.dataset.label, 'scenario', '');
      });
    });
  }

  /* ── SHOW HOVER SUB-PANEL ── */
  function showSubPanel(row) {
    /* Remove any existing sub-panels */
    document.querySelectorAll('.intel-sub-panel').forEach(function (s) { s.remove(); });

    var label  = row.dataset.label  || '';
    var ticker = row.dataset.ticker || '';

    var sub = document.createElement('div');
    sub.className = 'intel-sub-panel';
    sub.innerHTML =
      '<div class="intel-sub-hdr">' +
        '<div class="intel-sub-name">' + escH(label) + '</div>' +
        (ticker ? '<div class="intel-sub-ticker">' + escH(ticker) + '</div>' : '') +
      '</div>' +
      '<div class="intel-sub-option" data-action="profile">' +
        '<span class="intel-sub-opt-icon">▌</span>' +
        '<div><div class="intel-sub-opt-lbl">COMPANY PROFILE</div><div class="intel-sub-opt-sub">Overview · Key facts · Broker note</div></div>' +
      '</div>' +
      '<div class="intel-sub-option" data-action="news">' +
        '<span class="intel-sub-opt-icon">▌</span>' +
        '<div><div class="intel-sub-opt-lbl">LATEST NEWS</div><div class="intel-sub-opt-sub">Recent stories · Headlines</div></div>' +
      '</div>' +
      '<div class="intel-sub-option" data-action="market">' +
        '<span class="intel-sub-opt-icon">▌</span>' +
        '<div><div class="intel-sub-opt-lbl">MARKET DATA</div><div class="intel-sub-opt-sub">Live price · Price change</div></div>' +
      '</div>' +
      '<div class="intel-sub-option" data-action="intel">' +
        '<span class="intel-sub-opt-icon">▌</span>' +
        '<div><div class="intel-sub-opt-lbl">BROKERS INTELLIGENCE</div><div class="intel-sub-opt-sub">Pitch playbook</div></div>' +
      '</div>';

    row.appendChild(sub);

    /* Keep sub-panel open while hovering it */
    sub.addEventListener('mouseleave', function (e) {
      if (!row.contains(e.relatedTarget)) sub.remove();
    });

    /* Handle option clicks — dropdown stays open so user can pick multiple panels */
    sub.querySelectorAll('.intel-sub-option').forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        var action = opt.dataset.action;
        /* Flash selection feedback without closing dropdown */
        opt.style.background = '#1a1a1a';
        setTimeout(function () { opt.style.background = ''; }, 200);

        if (action === 'profile') {
          if (ticker) _prefetchCompanyPitch(label, ticker); /* start pitch warm-up immediately */
          window._intelSearchSection(label, 'company', ticker, 'overview');
        } else if (action === 'intel') {
          window._intelSearchSection(label, 'company', ticker, 'pitch');
        } else if (action === 'news') {
          openNewsPopout(label, ticker);
        } else if (action === 'market') {
          openMarketPopout(label, ticker);
        }
      });
    });
  }

  /* ── NEWS POP-OUT ── */
  function openNewsPopout(label, ticker) {
    var win = createPopout(label + ' — NEWS', 'news');
    var body = win.querySelector('.intel-popwin-body');
    body.innerHTML = '<div style="font-size:9px;color:#444;letter-spacing:.2em;padding:10px 0;text-transform:uppercase;">Searching news feeds...</div>';

    var keyword = label.split(' ')[0]; /* use first word as search term */

    /* First try already-loaded stories on news page */
    var localStories = (typeof allStories !== 'undefined' ? allStories : [])
      .filter(function (s) {
        var t = ((s.headline || '') + ' ' + (s.summary || '')).toLowerCase();
        return t.includes(label.toLowerCase()) || (ticker && t.includes(ticker.split('.')[0].toLowerCase()));
      }).slice(0, 10);

    if (localStories.length) {
      renderNewsResults(localStories, body);
      return;
    }

    /* Otherwise fetch fresh from RSS and filter */
    fetch('/.netlify/functions/rss')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        var q = label.toLowerCase();
        var tk = ticker ? ticker.split('.')[0].toLowerCase() : '';
        var matched = items.filter(function (s) {
          var t = ((s.title || '') + ' ' + (s.description || '')).toLowerCase();
          return t.includes(q) || (tk && tk.length > 2 && t.includes(tk));
        }).slice(0, 12);
        if (matched.length) {
          renderNewsResults(matched.map(function(s, i) {
            return { id: s.url || i, headline: s.title, summary: s.description, source: s.source, datetime: s.datetime, url: s.url };
          }), body);
        } else {
          body.innerHTML =
            '<div style="padding:8px 0;font-size:10px;color:#d0d0d0;line-height:1.7;">' +
              'No recent stories found for <strong style="color:#E97132;">' + escH(label) + '</strong> in the current feed.' +
              '<br><br><span style="color:#555;font-size:9px;">Stories refresh every 60 seconds. Try searching a shorter name or use the news terminal search bar.</span>' +
            '</div>';
        }
      })
      .catch(function () {
        body.innerHTML = '<div style="font-size:10px;color:#555;padding:8px 0;">News unavailable.</div>';
      });
  }

  function renderNewsResults(stories, body) {
    body.innerHTML = '<div style="padding:2px 0;">' +
      stories.map(function (s) {
        var ts = s.datetime ? new Date(s.datetime * 1000).toLocaleDateString('en-GB', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) : '';
        return '<div style="padding:9px 0;border-bottom:1px solid #181818;cursor:pointer;" onclick="window._intelOpenStory && window._intelOpenStory(\'' + escQ(String(s.id)) + '\');' + (s.url ? 'if(!window._intelOpenStory||!window.allStories)window.open(\'' + escQ(s.url) + '\',\'_blank\');' : '') + '">' +
          '<div style="font-size:7.5px;color:#E97132;letter-spacing:.15em;margin-bottom:3px;text-transform:uppercase;">' + escH(s.source || 'WIRE') + (ts ? ' · ' + ts : '') + '</div>' +
          '<div style="font-size:10px;color:#d8d8d8;line-height:1.5;">' + escH(s.headline || '') + '</div>' +
        '</div>';
      }).join('') +
    '</div>';

    window._intelOpenStory = function (sid) {
      var s = (typeof allStories !== 'undefined' ? allStories : []).find(function (x) { return String(x.id) === sid; });
      if (s && typeof openStoryTab === 'function') openStoryTab(s);
    };
  }

  /* ── MARKET DATA POP-OUT ── */
  function openMarketPopout(label, ticker) {
    var win = createPopout(label + ' — MARKET DATA', 'market');
    var body = win.querySelector('.intel-popwin-body');

    if (!ticker) {
      body.innerHTML = '<div style="padding:10px 0;font-size:10px;color:#555;">No exchange listing found for this company.</div>';
      return;
    }

    /* Detect non-US tickers — Finnhub free tier only covers US exchanges */
    var isNonUS = /\.(L|PA|AS|MI|SW|HK|TO|AX|DE|F|MC|VI|BR|CO|ST|HE|OL|LS|IR|WA|PR|BU|LJ|RG|TL|VS|LV)$/i.test(ticker);
    if (isNonUS) {
      var exchange = ticker.split('.').pop().toUpperCase();
      var exchangeNames = { L:'London Stock Exchange', PA:'Euronext Paris', AS:'Euronext Amsterdam', MI:'Borsa Italiana', DE:'Xetra Frankfurt', HK:'Hong Kong Exchange', TO:'Toronto Stock Exchange', AX:'ASX Australia', SW:'SIX Swiss Exchange' };
      var exName = exchangeNames[exchange] || exchange + ' Exchange';
      body.innerHTML =
        '<div style="border-left:3px solid #E97132;padding:10px 14px;background:#0f0f0f;margin-bottom:14px;">' +
          '<div style="font-size:8px;color:#E97132;letter-spacing:.2em;margin-bottom:6px;text-transform:uppercase;">Non-US Listing</div>' +
          '<div style="font-size:10px;color:#d0d0d0;line-height:1.7;">' +
            '<strong style="color:#fff;">' + escH(ticker) + '</strong> trades on the ' + escH(exName) + '.' +
            ' Live price data for international exchanges requires a premium data subscription.' +
          '</div>' +
        '</div>' +
        '<div style="font-size:10px;color:#888;line-height:1.7;margin-bottom:10px;">You can view live prices for <strong style="color:#fff;">' + escH(label) + '</strong> at:</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' +
          mkLink('Reuters', 'https://www.reuters.com/markets/companies/' + ticker) +
          mkLink('Financial Times', 'https://markets.ft.com/data/equities/tearsheet/summary?s=' + ticker) +
          mkLink('Yahoo Finance', 'https://finance.yahoo.com/quote/' + ticker) +
        '</div>';
      return;
    }

    body.innerHTML = '<div style="font-size:9px;color:#444;letter-spacing:.2em;padding:10px 0;text-transform:uppercase;">Loading market data...</div>';

    var key = 'da6p77hr01qqqkkgl7b0da6p77hr01qqqkkgl7bg';
    fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(ticker) + '&token=' + key)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (q) {
        if (!q || (!q.c && !q.pc)) {
          body.innerHTML = '<div style="font-size:10px;color:#555;padding:8px 0;">Market data unavailable for <strong style="color:#E97132;">' + escH(ticker) + '</strong>.</div>';
          return;
        }
        var price = q.c || q.pc;
        var prev  = q.pc || price;
        var chg   = price - prev;
        var pct   = prev ? (chg / prev * 100) : 0;
        var up    = chg >= 0;
        var col   = up ? '#44cc88' : '#ff5555';
        var arr   = up ? '▲' : '▼';
        body.innerHTML =
          '<div style="margin-bottom:16px;">' +
            '<div style="font-size:8px;letter-spacing:.2em;color:#555;margin-bottom:6px;text-transform:uppercase;">Last Price · ' + escH(ticker) + '</div>' +
            '<div style="font-size:28px;font-weight:700;color:#fff;line-height:1;">' + price.toFixed(2) + '</div>' +
            '<div style="font-size:12px;color:' + col + ';margin-top:6px;">' + arr + ' ' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%) TODAY</div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            mkTile('OPEN', q.o) + mkTile('HIGH', q.h) +
            mkTile('LOW',  q.l) + mkTile('PREV CLOSE', q.pc) +
          '</div>' +
          '<div style="font-size:7px;color:#333;letter-spacing:.15em;margin-top:12px;text-transform:uppercase;">Indicative · ' + escH(ticker) + '</div>';
      })
      .catch(function () {
        body.innerHTML = '<div style="font-size:10px;color:#555;padding:8px 0;">Market data unavailable.</div>';
      });
  }

  function mkLink(label, url) {
    return '<a href="' + url + '" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#111;border:1px solid #1e1e1e;text-decoration:none;transition:border-color .1s;" onmouseover="this.style.borderColor=\'#E97132\'" onmouseout="this.style.borderColor=\'#1e1e1e\'">' +
      '<span style="font-size:9px;color:#E97132;">↗</span>' +
      '<span style="font-size:10px;color:#d0d0d0;">' + escH(label) + '</span>' +
    '</a>';
  }

  function mkTile(lbl, val) {
    return '<div style="background:#111;border:1px solid #1e1e1e;padding:8px 10px;">' +
      '<div style="font-size:7px;letter-spacing:.2em;color:#555;margin-bottom:4px;">' + lbl + '</div>' +
      '<div style="font-size:13px;color:#d0d0d0;">' + (val != null ? val.toFixed(2) : '—') + '</div>' +
    '</div>';
  }

  /* ── HANDLE SELECTION → POP-OUT ── */
  function _gateCredits(amount, description, proceed) {
    if (!window._deductCredits) { proceed(); return; }
    window._deductCredits(amount, description).then(function (result) {
      if (!result.ok && result.status === 402) {
        window._showNoCredits && window._showNoCredits(result.balance || 0);
        return;
      }
      /* On non-402 errors (network, not authenticated) — allow through */
      proceed();
    });
  }

  function _sessionCacheKey(type, ticker, query) {
    var lensKey = (window._assetLens && window._assetLens.key) || 'universal';
    return type + ':' + lensKey + ':' + (ticker || query);
  }

  window._intelSearch = function (query, type, ticker) {
    var dropdown = document.getElementById('intel-dropdown');
    var input = document.getElementById('intel-search-input');
    if (dropdown) dropdown.style.display = 'none';
    if (input) input.value = '';

    var win = createPopout(query, type);
    fetchDetail(query, type, ticker || '', win);
  };

  window._intelSearchSection = function (query, type, ticker, section) {
    var dropdown = document.getElementById('intel-dropdown');
    var input = document.getElementById('intel-search-input');
    if (dropdown) dropdown.style.display = 'none';
    if (input) input.value = '';

    var suffix = section === 'overview' ? ' — PROFILE' : section === 'pitch' ? ' — PITCH' : '';
    var win = createPopout(query + suffix, type);
    fetchDetailSection(query, type, ticker || '', section, win);
  };

  /* ── TAB GROUP REGISTRY ── */
  /* Each entry: {el, tabs:[{title,panelEl}], activeIdx} */
  var _groups = [];

  /* ── CREATE DRAGGABLE POP-OUT ── */
  function createPopout(query, type) {
    _popOffset = (_popOffset + 24) % 120;
    window._sharedZ = (window._sharedZ || 1000) + 1;

    var pid = 'pop-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    var x   = 200 + _popOffset;
    var y   = 80  + _popOffset;

    var win = document.createElement('div');
    win.className  = 'intel-popwin';
    win._itTitle   = query.toUpperCase();
    win._popId     = pid;
    win.style.cssText = 'top:' + y + 'px;left:' + x + 'px;z-index:' + window._sharedZ + ';';

    win.innerHTML =
      '<div class="intel-popwin-titlebar">' +
        '<span class="intel-popwin-icon">▌ INTEL</span>' +
        '<span class="intel-popwin-title">' + escH(query.toUpperCase()) + '</span>' +
        '<div style="display:flex;gap:4px;margin-left:auto;align-items:center;">' +
          '<button class="intel-popwin-btn intel-popwin-zoom-out" title="Zoom out">−</button>' +
          '<button class="intel-popwin-btn intel-popwin-zoom-in"  title="Zoom in">+</button>' +
          '<button class="intel-popwin-btn intel-popwin-group" title="Click to merge with another open panel">⊞ GROUP</button>' +
          '<button class="intel-popwin-close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="intel-popwin-body">' +
        '<div class="sp-intel-load">READING THE BRIEF<span class="sp-intel-ld"></span></div>' +
      '</div>';

    /* Register in state */
    _registry[pid] = {query: query, type: type || 'company', ticker: '', x: x, y: y, w: 440, h: 500};

    document.body.appendChild(win);

    /* Cycling status messages while fetch is in-flight */
    var _IST = ['READING THE BRIEF','ANALYSING CONTEXT','IDENTIFYING OPPORTUNITIES','DRAFTING INTELLIGENCE','FINALISING BRIEF'];
    var _isi = 0;
    var _ldEl = win.querySelector('.sp-intel-load');
    win._loadingTimer = setInterval(function () {
      _isi = (_isi + 1) % _IST.length;
      if (_ldEl) _ldEl.innerHTML = _IST[_isi] + '<span class="sp-intel-ld"></span>';
    }, 1600);

    makeDraggable(win, win.querySelector('.intel-popwin-titlebar'));
    makeResizablePop(win);

    win.addEventListener('mousedown', function () { window._sharedZ++; win.style.zIndex = window._sharedZ; });

    /* Trap scroll inside the popout — let inner scrollable elements work first */
    win.addEventListener('wheel', function (e) {
      e.stopPropagation();
      var el = e.target;
      while (el && el !== win) {
        var oy = window.getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') {
          var atTop = el.scrollTop <= 0;
          var atBot = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if (!((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBot))) return;
        }
        el = el.parentElement;
      }
      e.preventDefault();
      var body = win.querySelector('.intel-popwin-body');
      if (body) body.scrollTop += e.deltaY;
    }, { passive: false });

    /* Close: deregister + save */
    win.querySelector('.intel-popwin-close').addEventListener('click', function () {
      delete _registry[pid];
      win.remove();
      _saveIntelState();
    });

    /* GROUP button — uses shared picker so canvas widgets and note popouts are included */
    win.querySelector('.intel-popwin-group').addEventListener('click', function (e) {
      e.stopPropagation();
      window._popwinGroupPicker && window._popwinGroupPicker(win);
    });

    /* Zoom buttons for intel popout */
    var _popZoom = 1;
    function applyPopZoom(z) {
      _popZoom = Math.min(2, Math.max(0.4, z));
      var b = win.querySelector('.intel-popwin-body');
      if (b) b.style.zoom = _popZoom;
    }
    win.querySelector('.intel-popwin-zoom-in').addEventListener('click', function (e) { e.stopPropagation(); applyPopZoom(_popZoom + 0.1); });
    win.querySelector('.intel-popwin-zoom-out').addEventListener('click', function (e) { e.stopPropagation(); applyPopZoom(_popZoom - 0.1); });

    return win;
  }

  /* ── MERGE TWO POPOUTS INTO A TAB GROUP ── */
  function mergeIntoGroup(winA, winB) {
    var rectB = winB.getBoundingClientRect();
    var w = Math.max(winA.offsetWidth, winB.offsetWidth, 480);
    var h = Math.max(winA.offsetHeight, winB.offsetHeight, 500);

    /* Place group inside the canvas so it scrolls with canvas widgets */
    var _grpCanvas = document.getElementById('tbc-canvas');
    var _grpCr = _grpCanvas ? _grpCanvas.getBoundingClientRect() : {left:0, top:0};
    var _grpSX = _grpCanvas ? _grpCanvas.scrollLeft : 0;
    var _grpSY = _grpCanvas ? _grpCanvas.scrollTop  : 0;
    var _grpL  = rectB.left - _grpCr.left + _grpSX;
    var _grpT  = rectB.top  - _grpCr.top  + _grpSY;

    var group = document.createElement('div');
    group.className = 'intel-tab-group';
    group.style.cssText =
      'position:absolute;top:' + _grpT + 'px;left:' + _grpL + 'px;' +
      'width:' + w + 'px;height:' + h + 'px;z-index:' + (++window._sharedZ) + ';';

    /* Build tab data */
    var tabs = [
      {title: winA._itTitle || 'PANEL', bodyEl: winA.querySelector('.intel-popwin-body')},
      {title: winB._itTitle || 'PANEL', bodyEl: winB.querySelector('.intel-popwin-body')},
    ];

    var _tgZoom = 1;
    function applyTgZoom(z) {
      _tgZoom = Math.min(2, Math.max(0.4, z));
      var b = group.querySelector('.intel-tg-body');
      if (b) b.style.zoom = _tgZoom;
    }

    function renderGroup(activeIdx) {
      group.innerHTML =
        '<div class="intel-tg-bar">' +
          tabs.map(function (t, i) {
            return '<button class="intel-tg-tab' + (i === activeIdx ? ' active' : '') + '" data-idx="' + i + '">' +
              escH(t.title) +
              '<span class="intel-tg-tab-close" data-idx="' + i + '">×</span>' +
            '</button>';
          }).join('') +
          '<div style="margin-left:auto;display:flex;gap:2px;align-items:center;">' +
            '<button class="intel-tg-zoom-out" title="Zoom out" style="background:none;border:1px solid #222;color:#555;font-size:11px;cursor:pointer;padding:1px 6px;font-family:Consolas,Menlo,monospace;">−</button>' +
            '<button class="intel-tg-zoom-in"  title="Zoom in"  style="background:none;border:1px solid #222;color:#555;font-size:11px;cursor:pointer;padding:1px 6px;font-family:Consolas,Menlo,monospace;">+</button>' +
            '<button class="intel-tg-minimize" title="Minimise to dock" style="background:none;border:1px solid #222;color:#555;font-size:11px;cursor:pointer;padding:1px 6px;font-family:Consolas,Menlo,monospace;">─</button>' +
            '<button class="intel-tg-fullscreen" title="Full screen" style="background:none;border:1px solid #222;color:#555;font-size:11px;cursor:pointer;padding:1px 6px;font-family:Consolas,Menlo,monospace;">⛶</button>' +
            '<button class="intel-tg-close-all" style="margin-left:4px;">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="intel-tg-body" id="intel-tg-body-' + group._uid + '"></div>';

      var bodyHost = group.querySelector('.intel-tg-body');
      /* Move active panel's DOM into view */
      var active = tabs[activeIdx];
      if (active && active.bodyEl) {
        bodyHost.innerHTML = '';
        bodyHost.appendChild(active.bodyEl);
      }

      /* Re-attach drag to the new bar element every render (innerHTML replacement destroys old listeners) */
      makeDraggable(group, group.querySelector('.intel-tg-bar'));

      group.querySelectorAll('.intel-tg-tab').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          if (e.target.classList.contains('intel-tg-tab-close')) return;
          renderGroup(parseInt(btn.dataset.idx));
        });
      });
      group.querySelectorAll('.intel-tg-tab-close').forEach(function (x) {
        x.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(x.dataset.idx);
          var removed = tabs[idx];
          tabs.splice(idx, 1);
          if (!tabs.length) { group.remove(); return; }
          group._itTitle = tabs.map(function(t){return t.title;}).join(' / ');
          renderGroup(Math.min(idx, tabs.length - 1));

          /* Pop the closed tab back out as a standalone floating window */
          if (removed && removed.bodyEl && window.createGenericPopout) {
            var gr = group.getBoundingClientRect();
            window.createGenericPopout(removed.title, '', function (popBody) {
              popBody.style.cssText = (removed.bodyEl.style.cssText || '') + ';overflow:auto;';
              Array.from(removed.bodyEl.childNodes).forEach(function (child) {
                popBody.appendChild(child);
              });
            }, { x: gr.left + 40, y: gr.top + 40, w: gr.width, h: gr.height });
          }
        });
      });
      group.querySelector('.intel-tg-close-all').addEventListener('click', function () { group.remove(); });

      /* ── TAB DRAG-OUT: drag a tab out of the bar to detach it ── */
      group.querySelectorAll('.intel-tg-tab').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          if (e.target.classList.contains('intel-tg-tab-close')) return;
          if (e.button !== 0) return;
          var idx = parseInt(btn.dataset.idx);
          var dsx = e.clientX, dsy = e.clientY;
          var dragging = false;
          var ghost = null;
          function onDragMove(ev) {
            var ddx = ev.clientX - dsx, ddy = ev.clientY - dsy;
            if (!dragging && ddx*ddx + ddy*ddy > 400) { dragging = true; }
            if (dragging) {
              if (!ghost) {
                ghost = document.createElement('div');
                ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:999999;background:#0d0d0d;border:1px solid #E97132;padding:5px 12px;font-size:9px;font-family:Consolas,Menlo,monospace;letter-spacing:.08em;color:#E97132;opacity:.9;';
                ghost.textContent = tabs[idx] ? tabs[idx].title : 'PANEL';
                document.body.appendChild(ghost);
              }
              ghost.style.left = (ev.clientX + 14) + 'px';
              ghost.style.top  = (ev.clientY - 8)  + 'px';
              /* Drop-zone detection */
              document.querySelectorAll('.intel-drop-target').forEach(function (t) { t.classList.remove('intel-drop-target'); });
              window._popwinDropTarget = null;
              document.querySelectorAll('.intel-popwin, .intel-tab-group, .tbc-widget').forEach(function (t) {
                if (t === group) return;
                var hdr = t.querySelector('.intel-popwin-titlebar, .intel-tg-bar, .tbc-widget-bar');
                if (!hdr) return;
                var tr = hdr.getBoundingClientRect();
                if (ev.clientX > tr.left && ev.clientX < tr.right && ev.clientY > tr.top && ev.clientY < tr.bottom) {
                  t.classList.add('intel-drop-target');
                  window._popwinDropTarget = t;
                }
              });
            }
          }
          function onDragUp(ev) {
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup',   onDragUp);
            if (ghost) ghost.remove();
            document.querySelectorAll('.intel-drop-target').forEach(function (t) { t.classList.remove('intel-drop-target'); });
            if (!dragging) return;
            var tab = tabs[idx];
            if (!tab) return;
            /* Remove tab from group */
            tabs.splice(idx, 1);
            if (!tabs.length) { group.remove(); }
            else {
              group._itTitle = tabs.map(function (t) { return t.title; }).join(' / ');
              renderGroup(Math.min(idx, tabs.length - 1));
            }
            var dropTarget = window._popwinDropTarget;
            window._popwinDropTarget = null;
            if (dropTarget) {
              if (dropTarget.classList.contains('intel-tab-group') && dropTarget._addTab) {
                dropTarget._addTab(tab.title, tab.bodyEl);
              } else if (dropTarget.classList.contains('intel-popwin')) {
                var tmpWin = document.createElement('div');
                tmpWin.className = 'intel-popwin';
                tmpWin._itTitle = tab.title;
                var tmpBody = document.createElement('div');
                tmpBody.className = 'intel-popwin-body';
                if (tab.bodyEl) while (tab.bodyEl.firstChild) tmpBody.appendChild(tab.bodyEl.firstChild);
                tmpWin.appendChild(tmpBody);
                tmpWin.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                document.body.appendChild(tmpWin);
                mergeIntoGroup(tmpWin, dropTarget);
              } else if (dropTarget.classList.contains('tbc-widget') && dropTarget._tbcPopout) {
                var canvasPopwin = dropTarget._tbcPopout();
                if (canvasPopwin) {
                  var tmpWin2 = document.createElement('div');
                  tmpWin2.className = 'intel-popwin';
                  tmpWin2._itTitle = tab.title;
                  var tmpBody2 = document.createElement('div');
                  tmpBody2.className = 'intel-popwin-body';
                  if (tab.bodyEl) while (tab.bodyEl.firstChild) tmpBody2.appendChild(tab.bodyEl.firstChild);
                  tmpWin2.appendChild(tmpBody2);
                  tmpWin2.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
                  document.body.appendChild(tmpWin2);
                  mergeIntoGroup(tmpWin2, canvasPopwin);
                }
              }
            } else {
              /* Drop on empty space — standalone popout */
              var gr = group.getBoundingClientRect();
              window.createGenericPopout && window.createGenericPopout(tab.title, '', function (popBody) {
                if (tab.bodyEl) while (tab.bodyEl.firstChild) popBody.appendChild(tab.bodyEl.firstChild);
              }, { x: ev.clientX - 50, y: ev.clientY - 20, w: gr.width, h: gr.height });
            }
          }
          document.addEventListener('mousemove', onDragMove);
          document.addEventListener('mouseup',   onDragUp);
        });
      });

      /* Zoom buttons — survive re-renders via delegation on group */
      var zIn  = group.querySelector('.intel-tg-zoom-in');
      var zOut = group.querySelector('.intel-tg-zoom-out');
      if (zIn)  zIn.addEventListener('click',  function (e) { e.stopPropagation(); applyTgZoom(_tgZoom + 0.1); });
      if (zOut) zOut.addEventListener('click', function (e) { e.stopPropagation(); applyTgZoom(_tgZoom - 0.1); });
      applyTgZoom(_tgZoom); /* restore zoom after re-render */
      /* Minimize + Fullscreen — re-wired each render */
      var _minBtn = group.querySelector('.intel-tg-minimize');
      var _fsBtn  = group.querySelector('.intel-tg-fullscreen');
      if (_minBtn) _minBtn.addEventListener('click', function(e) { e.stopPropagation(); enterGrpMinimize(); });
      if (_fsBtn)  {
        _fsBtn.textContent = _grpFullscreen ? '⊠' : '⛶';
        _fsBtn.title = _grpFullscreen ? 'Exit full screen' : 'Full screen';
        _fsBtn.addEventListener('click', function(e) { e.stopPropagation(); _grpFullscreen ? exitGrpFullscreen() : enterGrpFullscreen(); });
      }
    }

    /* Minimize + Fullscreen state */
    var _grpMinimized    = false;
    var _grpSavedStyle   = null;
    var _grpFullscreen   = false;
    var _grpSavedStyleFs = null;

    function enterGrpMinimize() {
      var dock = document.getElementById('tbc-dock');
      if (!dock) return;
      _grpMinimized = true;
      _grpSavedStyle = { left: group.style.left, top: group.style.top, width: group.style.width, height: group.style.height };
      group.style.display = 'none';
      dock.style.pointerEvents = 'auto';
      var chip = document.createElement('button');
      chip.id = 'dock-chip-grp-' + group._uid;
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#181818;border:1px solid #2a2a2a;border-radius:3px;color:#ffffff;font-size:8px;font-family:Consolas,monospace;padding:3px 10px;cursor:pointer;letter-spacing:.06em;white-space:nowrap;height:24px;transition:border-color .15s;';
      chip.innerHTML = '<span style="color:#E97132;">⊞</span> ' + escH((group._itTitle || 'GROUP')).slice(0, 40);
      chip.addEventListener('mouseenter', function() { chip.style.borderColor = '#E97132'; });
      chip.addEventListener('mouseleave', function() { chip.style.borderColor = '#2a2a2a'; });
      chip.addEventListener('click', function() {
        _grpMinimized = false;
        group.style.display = '';
        if (_grpSavedStyle) { group.style.left = _grpSavedStyle.left; group.style.top = _grpSavedStyle.top; group.style.width = _grpSavedStyle.width; group.style.height = _grpSavedStyle.height; }
        group.style.zIndex = ++window._sharedZ;
        chip.remove();
        if (!dock.querySelector('button')) dock.style.pointerEvents = 'none';
      });
      dock.appendChild(chip);
    }

    function enterGrpFullscreen() {
      _grpFullscreen = true;
      _grpSavedStyleFs = { left: group.style.left, top: group.style.top, width: group.style.width, height: group.style.height, zIndex: group.style.zIndex };
      var wrap = document.getElementById('tbc-canvas-wrap');
      var dockH = 36;
      group.style.left   = '0px';
      group.style.top    = '0px';
      group.style.width  = (wrap ? wrap.clientWidth  : window.innerWidth)  + 'px';
      group.style.height = ((wrap ? wrap.clientHeight : window.innerHeight) - dockH) + 'px';
      group.style.zIndex = 7900;
      var fsBtn = group.querySelector('.intel-tg-fullscreen');
      if (fsBtn) { fsBtn.textContent = '⊠'; fsBtn.title = 'Exit full screen'; }
    }

    function exitGrpFullscreen() {
      _grpFullscreen = false;
      if (_grpSavedStyleFs) { group.style.left = _grpSavedStyleFs.left; group.style.top = _grpSavedStyleFs.top; group.style.width = _grpSavedStyleFs.width; group.style.height = _grpSavedStyleFs.height; group.style.zIndex = _grpSavedStyleFs.zIndex; }
      var fsBtn = group.querySelector('.intel-tg-fullscreen');
      if (fsBtn) { fsBtn.textContent = '⛶'; fsBtn.title = 'Full screen'; }
    }

    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && _grpFullscreen) exitGrpFullscreen(); });

    group._uid = Date.now();
    group._itTitle = tabs.map(function(t){return t.title;}).join(' / ');
    group._addTab = function (title, bodyEl) {
      tabs.push({title: title, bodyEl: bodyEl});
      group._itTitle = tabs.map(function(t){return t.title;}).join(' / ');
      renderGroup(tabs.length - 1);
    };
    if (_grpCanvas) { _grpCanvas.appendChild(group); } else { document.body.appendChild(group); }
    renderGroup(0);

    /* makeResizablePop attaches to group itself (not a child) so only needs wiring once */
    makeResizablePop(group);
    group.addEventListener('mousedown', function () { window._sharedZ++; group.style.zIndex = window._sharedZ; });
    group.addEventListener('wheel', function (e) {
      e.stopPropagation();
      var el = e.target;
      while (el && el !== group) {
        var oy = window.getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') {
          var atTop = el.scrollTop <= 0;
          var atBot = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if (!((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBot))) return;
        }
        el = el.parentElement;
      }
      e.preventDefault();
      var body = group.querySelector('.intel-tg-body');
      if (body) body.scrollTop += e.deltaY;
    }, { passive: false });

    winA.remove();
    winB.remove();
  }

  /* ── FETCH FULL DETAIL — SSE streaming with fallback ── */
  function fetchDetail(query, type, ticker, win, _retryCount) {
    var lensKey     = (window._assetLens && window._assetLens.key)         || 'universal';
    var lensContext = (window._assetLens && window._assetLens.promptContext) || '';
    var cacheKey    = type + ':' + lensKey + ':' + (ticker || query);

    /* Session cache hit — render immediately */
    if (_cache[cacheKey]) { renderPopout(_cache[cacheKey], win); return; }

    var fetchHeaders = { 'Content-Type': 'application/json' };
    if (window._authToken) fetchHeaders['Authorization'] = 'Bearer ' + window._authToken;
    var reqBody = JSON.stringify({ query: query, type: type, ticker: ticker, lensKey: lensKey, lensContext: lensContext });

    /* Shared handler: once we have a parsed response object d, finish normally */
    function _onDetail(d) {
      if (!d) return;
      if (!d.error) {
        _cache[cacheKey] = d;
        if (win._popId && _registry[win._popId] && d.ticker) _registry[win._popId].ticker = d.ticker;
        window._loadCreditBalance && window._loadCreditBalance();
      }
      /* Distillery: fetch WhiskyStats expressions */
      if (d.type === 'company' && d.category === 'distillery') {
        var wsKey = 'ws:' + (d.title || cacheKey);
        var lsKey = 's_' + (d.title || cacheKey).toLowerCase().replace(/\s+/g, '_');
        if (_cache[wsKey]) { d._wsResults = _cache[wsKey]; renderPopout(d, win); return; }
        var lsCached = lsGet(lsKey);
        if (lsCached) { d._wsResults = lsCached; _cache[wsKey] = lsCached; renderPopout(d, win); return; }
        var wsQ = encodeURIComponent(d.title || query);
        var distWords = (d.title || query).toLowerCase().split(/\s+/).filter(function(w){ return w.length > 3; });
        d._wsDistWords = distWords; d._wsQ = wsQ; d._wsLsKey = lsKey;
        fetch('/.netlify/functions/whisky-data?type=search&query=' + wsQ + '&page=1')
          .then(function(r){ return r.ok ? r.json() : null; })
          .then(function(ws){
            var all = [], seen = {};
            if (ws && ws.results) {
              ws.results.forEach(function(r){
                if (seen[r.whisky_id]) return;
                var n = (r.whisky_name || '').toLowerCase();
                if (!distWords.length || distWords.some(function(w){ return n.indexOf(w) !== -1; })) { seen[r.whisky_id] = true; all.push(r); }
              });
            }
            d._wsResults = all; d._wsPage = 1; _cache[wsKey] = all; lsSet(lsKey, all);
            renderPopout(d, win);
          }).catch(function(){ renderPopout(d, win); });
      } else {
        renderPopout(d, win);
      }
    }

    function _showError(win) {
      var body = win.querySelector('.intel-popwin-body');
      if (win._loadingTimer) { clearInterval(win._loadingTimer); win._loadingTimer = null; }
      if (body) {
        var msg = type === 'scenario' ? 'BRIEF GENERATION FAILED<br><span style="font-size:9px;color:#888;letter-spacing:.05em;">Generation timed out — click to try again</span>' : 'INTELLIGENCE UNAVAILABLE';
        body.innerHTML = '<div class="sp-loading" style="color:#e05050;">' + msg + '<br><span class="intel-retry-btn" style="margin-top:8px;display:inline-block;">↻ RETRY</span></div>';
        var btn = body.querySelector('.intel-retry-btn');
        if (btn) btn.addEventListener('click', function(){ body.innerHTML='<div class="sp-intel-load">GENERATING BRIEF<span class="sp-intel-ld"></span></div>'; fetchDetail(query, type, ticker, win, 0); });
      }
    }

    /* ── Try SSE streaming endpoint ── */
    if (window.ReadableStream && window.TextDecoder) {
      fetch('/.netlify/functions/search-stream', { method: 'POST', headers: fetchHeaders, body: reqBody })
        .then(function(r) {
          if (!r.ok || !r.body) { _fallbackFetch(); return; }

          var reader  = r.body.getReader();
          var decoder = new TextDecoder();
          var lineBuf = '';
          var _streamResolved = false; /* true once cache/done/402 received */

          function readChunk() {
            return reader.read().then(function(chunk) {
              /* Stream closed — if we never got a done/cache event, fall back */
              if (chunk.done) {
                if (!_streamResolved) _fallbackFetch();
                return;
              }
              lineBuf += decoder.decode(chunk.value, { stream: true });
              var lines = lineBuf.split('\n');
              lineBuf = lines.pop();

              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var raw;
                try { raw = JSON.parse(line.slice(6)); } catch { continue; }

                if (raw.type === 'cache') {
                  _streamResolved = true;
                  if (win._loadingTimer) { clearInterval(win._loadingTimer); win._loadingTimer = null; }
                  _onDetail(raw.data);
                  return;
                }

                if (raw.type === 'delta') {
                  /* Spinner stays — render fires when done */
                  return readChunk();
                }

                if (raw.type === 'done') {
                  _streamResolved = true;
                  _onDetail(raw.data);
                  return;
                }

                if (raw.type === 'error') {
                  if (raw.code === 402) {
                    _streamResolved = true;
                    win.remove();
                    window._showNoCredits && window._showNoCredits(raw.balance || 0);
                  } else {
                    /* Server-sent error (timeout, parse_error) — try buffered fallback */
                    _fallbackFetch();
                  }
                  return;
                }
              }
              return readChunk();
            });
          }

          /* Network/reader error — try buffered fallback before showing error */
          readChunk().catch(function() { _fallbackFetch(); });
        })
        .catch(function() { _fallbackFetch(); });
    } else {
      _fallbackFetch();
    }

    /* ── Fallback: regular buffered endpoint ── */
    function _fallbackFetch() {
      var retries = _retryCount || 0;
      fetch('/.netlify/functions/search', { method: 'POST', headers: fetchHeaders, body: reqBody })
        .then(function(r) {
          if (r.status === 402) {
            win.remove();
            r.json().then(function(d){ window._showNoCredits && window._showNoCredits(d.balance || 0); });
            return null;
          }
          if ((r.status === 503 || r.status === 504) && retries < 2) {
            return r.json().then(function(d) {
              /* parse_error with retryable:false means same broken JSON will repeat — show error now */
              if (d && d.retryable === false) { _showError(win); return null; }
              var bdy = win.querySelector('.intel-popwin-body');
              if (bdy) bdy.innerHTML = '<div class="sp-intel-load">GENERATING BRIEF — PLEASE WAIT<span class="sp-intel-ld"></span></div>';
              setTimeout(function(){ fetchDetail(query, type, ticker, win, retries + 1); }, 4000);
              return null;
            }).catch(function(){ _showError(win); return null; });
          }
          if (!r.ok) { _showError(win); return null; }
          return r.json();
        })
        .then(function(d){ if (d) _onDetail(d); })
        .catch(function(){ _showError(win); });
    }
  }

  /* ── FETCH SECTION DETAIL (overview or pitch) ── */
  function fetchDetailSection(query, type, ticker, section, win, _retryCount) {
    var lensKey = (window._assetLens && window._assetLens.key) || 'universal';
    var lensContext = (window._assetLens && window._assetLens.promptContext) || '';
    var cacheKey = type + ':' + lensKey + ':' + section + ':' + (ticker || query);
    if (_cache[cacheKey]) {
      renderSection(_cache[cacheKey], section, win);
      return;
    }

    /* ── Pitch-playbook: stream via SSE so content appears line by line ── */
    if (section === 'pitch-playbook' && window.ReadableStream && window.TextDecoder) {
      var panel = win.querySelector('.intel-sec-panel[data-sec="pitch-playbook"]') || win.querySelector('.intel-popwin-body');
      var streamBuf = '';
      var streamDiv = null;

      var fHeaders = { 'Content-Type': 'application/json' };
      if (window._authToken) fHeaders['Authorization'] = 'Bearer ' + window._authToken;

      fetch('/.netlify/functions/search-stream', {
        method: 'POST', headers: fHeaders,
        body: JSON.stringify({ query: query, type: type, ticker: ticker, section: section, lensKey: lensKey, lensContext: lensContext }),
      }).then(function(r) {
        if (!r.ok || !r.body) { _fetchSectionBuffered(); return; }
        var reader  = r.body.getReader();
        var decoder = new TextDecoder();
        var lineBuf = '';
        var gotDone = false;

        function readChunk() {
          return reader.read().then(function(chunk) {
            if (chunk.done) { if (!gotDone) _fetchSectionBuffered(); return; }
            lineBuf += decoder.decode(chunk.value, { stream: true });
            var lines = lineBuf.split('\n');
            lineBuf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (!line.startsWith('data: ')) continue;
              var raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
              if (raw.type === 'cache') {
                gotDone = true;
                _cache[cacheKey] = raw.data;
                renderSection(raw.data, section, win);
                window._loadCreditBalance && window._loadCreditBalance();
                return;
              }
              if (raw.type === 'delta') {
                streamBuf += raw.text;
              }
              if (raw.type === 'done') {
                gotDone = true;
                _cache[cacheKey] = raw.data;
                renderSection(raw.data, section, win);
                window._loadCreditBalance && window._loadCreditBalance();
                return;
              }
              if (raw.type === 'error') { _fetchSectionBuffered(); return; }
            }
            return readChunk();
          });
        }
        readChunk().catch(function() { _fetchSectionBuffered(); });
      }).catch(function() { _fetchSectionBuffered(); });

      function _fetchSectionBuffered() {
        /* Fallback to buffered search.js if stream fails */
        var fh2 = { 'Content-Type': 'application/json' };
        if (window._authToken) fh2['Authorization'] = 'Bearer ' + window._authToken;
        fetch('/.netlify/functions/search', {
          method: 'POST', headers: fh2,
          body: JSON.stringify({ query: query, type: type, ticker: ticker, section: section, lensKey: lensKey, lensContext: lensContext }),
        }).then(function(r2) {
          if (r2.status === 402) { win.remove(); r2.json().then(function(d){ window._showNoCredits && window._showNoCredits(d.balance||0); }); return; }
          return r2.ok ? r2.json() : null;
        }).then(function(d) {
          if (!d || d.error) { if (panel) panel.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>'; return; }
          _cache[cacheKey] = d;
          renderSection(d, section, win);
          window._loadCreditBalance && window._loadCreditBalance();
        }).catch(function() { if (panel) panel.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>'; });
      }
      return;
    }

    var retries = _retryCount || 0;
    var fetchHeadersSec = { 'Content-Type': 'application/json' };
    if (window._authToken) fetchHeadersSec['Authorization'] = 'Bearer ' + window._authToken;
    fetch('/.netlify/functions/search', {
      method: 'POST',
      headers: fetchHeadersSec,
      body: JSON.stringify({ query: query, type: type, ticker: ticker, section: section, lensKey: lensKey, lensContext: lensContext }),
    })
      .then(function (r) {
        if (r.status === 402) {
          win.remove();
          r.json().then(function (d) { window._showNoCredits && window._showNoCredits(d.balance || 0); });
          return null;
        }
        if ((r.status === 503 || r.status === 504) && retries < 2) {
          var body = win.querySelector('.intel-popwin-body');
          if (body) body.innerHTML = '<div class="sp-intel-load">GENERATING BRIEF — PLEASE WAIT<span class="sp-intel-ld"></span></div>';
          setTimeout(function() { fetchDetailSection(query, type, ticker, section, win, retries + 1); }, 4000);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d) return;
        if (d && !d.error) {
          _cache[cacheKey] = d;
          window._loadCreditBalance && window._loadCreditBalance();
        }
        renderSection(d, section, win);
      })
      .catch(function () {
        var body = win.querySelector('.intel-popwin-body');
        if (body) {
          body.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE<span class="intel-retry-btn">↻ RETRY</span></div>';
          var btn = body.querySelector('.intel-retry-btn');
          if (btn) btn.addEventListener('click', function() {
            body.innerHTML = '<div class="sp-intel-load">GENERATING BRIEF<span class="sp-intel-ld"></span></div>';
            fetchDetailSection(query, type, ticker, section, win, 0);
          });
        }
      });
  }

  function renderSection(d, section, win) {
    var body = win.querySelector('.intel-popwin-body');
    if (!body || !d || d.error) {
      if (body) body.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>';
      return;
    }
    var titleEl = win.querySelector('.intel-popwin-title');
    if (titleEl && d.title) {
      var suffix = section === 'overview' ? ' — PROFILE' : ' — PITCH PLAYBOOK';
      titleEl.textContent = d.title.toUpperCase() + suffix;
    }
    if (section === 'overview') {
      renderOverview(d, body);
    } else if (section === 'pitch') {
      renderPitchOnly(d, body);
    } else if (section === 'pitch-playbook') {
      /* Render pitch into sub-panel if inside a company brief, otherwise use full body */
      var pitchPanel = body.querySelector('.intel-sec-panel[data-sec="pitch-playbook"]');
      if (pitchPanel) {
        pitchPanel.innerHTML = buildPitchPlaybook(d.pitch || d, d.brokerNote);
        cascadeType(pitchPanel);
      } else {
        renderPitchOnly(d, body);
        wireNoteBtn(d, body);
        cascadeType(body);
      }
      return;
    }
    wireNoteBtn(d, body);
    cascadeType(body);
  }

  function renderOverview(d, body) {
    var isListed = d.ticker && d.ticker.length > 0;
    var pitchBtn = (d.title && isListed) ?
      '<button class="sp-pitch-shortcut" data-title="' + escH(d.title) + '" data-ticker="' + escH(d.ticker || '') + '">▌ PITCH PLAYBOOK</button>' : '';
    var chartBtn = isListed ?
      '<button class="sp-chart-shortcut" data-ticker="' + escH(toYfTicker(d.ticker, d.exchange)) + '" data-name="' + escH(d.title || d.ticker) + '">▦ VIEW CHART</button>' : '';
    body.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<div class="sp-badge ' + (isListed ? 'listed' : 'private') + '" style="margin-bottom:0;">' +
          (isListed ? '● LISTED · ' + escH(d.ticker) + ' · ' + escH(d.exchange || '') : '● PRIVATE COMPANY') +
        '</div>' +
        pitchBtn +
        chartBtn +
      '</div>' +
      '<div class="sp-tagline">' + escH(d.tagline || '') + '</div>' +
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">OVERVIEW</div>' +
        '<div class="sp-text">' + escH(d.overview || '') + '</div>' +
      '</div>' +
      (d.keyFacts && d.keyFacts.length ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">KEY FACTS</div>' +
          '<ul class="sp-facts">' +
            d.keyFacts.map(function (f) { return '<li>' + escH(f) + '</li>'; }).join('') +
          '</ul>' +
        '</div>' : '') +
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">RELEVANCE TO ALTERNATIVE ASSETS</div>' +
        '<div class="sp-text">' + escH(d.relevance || '') + '</div>' +
      '</div>' +
      (d.brokerNote ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">BROKER NOTE</div>' +
          '<div class="sp-pitch">' + escH(d.brokerNote) + '</div>' +
        '</div>' : '') +
      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ ADD NOTE</button>' +
      '</div>';
  }

  function renderPitchOnly(d, body) {
    body.innerHTML =
      '<div class="sp-badge event" style="margin-bottom:8px;">▌ PITCH PLAYBOOK</div>' +
      buildPitchPlaybook(d.pitch, d.brokerNote) +
      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ ADD NOTE</button>' +
      '</div>';
  }

  function wirePitchShortcut(d, body) {
    var btn = body.querySelector('.sp-pitch-shortcut');
    if (!btn) return;
    btn.addEventListener('click', function () {
      window._intelSearchSection(d.title, 'company', d.ticker || '', 'pitch-playbook');
    });
  }

  /* Map exchange name → Yahoo Finance ticker suffix for non-US listings */
  function toYfTicker(ticker, exchange) {
    if (!ticker) return '';
    if (ticker.indexOf('.') !== -1) return ticker; /* already has suffix e.g. BARC.L */
    var ex = (exchange || '').toUpperCase();
    if (/LONDON|LSE/.test(ex))     return ticker + '.L';
    if (/TORONTO|TSX|TSX/.test(ex)) return ticker + '.TO';
    if (/AUSTRALIA|ASX/.test(ex))  return ticker + '.AX';
    if (/FRANKFURT|XETRA/.test(ex)) return ticker + '.DE';
    if (/PARIS|EURONEXT FR/.test(ex)) return ticker + '.PA';
    if (/AMSTERDAM|EURONEXT AM/.test(ex)) return ticker + '.AS';
    if (/MILAN|BORSA/.test(ex))    return ticker + '.MI';
    if (/STOCKHOLM|NASDAQ OM/.test(ex)) return ticker + '.ST';
    if (/HONG KONG/.test(ex))      return ticker + '.HK';
    if (/TOKYO|TSE/.test(ex))      return ticker + '.T';
    return ticker;
  }

  function wireChartBtn(d, body) {
    var btn = body.querySelector('.sp-chart-shortcut');
    if (!btn) return;
    btn.addEventListener('click', function () {
      /* Apply Yahoo Finance exchange suffix at click time — d.exchange is in closure */
      var ticker = toYfTicker(btn.dataset.ticker || d.ticker || '', d.exchange);
      var name   = btn.dataset.name || d.title || ticker;
      if (!ticker || !window.createGenericPopout) return;
      window.createGenericPopout(ticker + ' · CHART', '▦', function (popBody) {
        if (window._tbtRenderPriceChart) {
          window._tbtRenderPriceChart(popBody, ticker, name);
        } else {
          popBody.innerHTML = '<div style="padding:20px;font-size:9px;letter-spacing:.12em;color:#fff;opacity:.5;">OPEN THE TERMINAL TAB TO ENABLE CHARTS</div>';
        }
      }, { w: 620, h: 420 });
    });
  }

  function wireNoteBtn(d, body) {
    wirePitchShortcut(d, body);
    wireChartBtn(d, body);
    var parts = [];
    if (d.overview)         parts.push(d.overview);
    if (d.relevance)        parts.push('RELEVANCE:\n' + d.relevance);
    if (d.brokerNote)       parts.push('BROKER NOTE:\n' + d.brokerNote);
    if (d.pitch) {
      var p = d.pitch;
      if (p.openingLine)   parts.push('OPENING LINE:\n"' + p.openingLine + '"');
      if (p.logicalCase && p.logicalCase.length)
                            parts.push('LOGICAL CASE:\n' + p.logicalCase.map(function (f, i) { return (i + 1) + '. ' + f; }).join('\n'));
      if (p.urgencyLine)   parts.push('TIMING: ' + p.urgencyLine);
    }
    body._intelNoteData = {
      subjectType: 'intel', subjectTitle: d.title || '', subjectTicker: d.ticker || '',
      subjectContent: parts.join('\n\n'),
    };
    var noteBtn = body.querySelector('.sp-note-btn');
    if (noteBtn) {
      noteBtn.removeAttribute('onclick');
      noteBtn.addEventListener('click', function () {
        var sel = window.getSelection ? window.getSelection().toString().trim() : '';
        window.noteModalOpen && noteModalOpen(Object.assign({}, body._intelNoteData, { subjectHighlight: sel }));
      });
    }
  }

  /* ── RENDER POP-OUT CONTENT ── */
  /* ── SCENARIO / IFA ADVISORY RESULT ── */
  function renderScenario(d, body) {
    var A = '#E97132', GRN = '#3DAA6A', RED = '#D14040';
    var suitCol = function(s) { return s === 'HIGH' ? GRN : s === 'MEDIUM' ? A : 'rgba(255,255,255,0.45)'; };

    var briefHtml =
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">SITUATION SUMMARY</div>' +
        '<div class="sp-text">' + escH(d.situation || '') + '</div>' +
      '</div>' +

      (d.openingLine ? '<div class="sp-section"><div class="sp-sec-lbl">OPEN WITH</div><div class="sp-pitch-quote" style="font-size:11px;">"' + escH(d.openingLine) + '"</div></div>' : '') +

      (d.keyConsiderations && d.keyConsiderations.length ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">KEY PLANNING CONSIDERATIONS</div>' +
          '<ul class="sp-facts">' + d.keyConsiderations.map(function(c){ return '<li>' + escH(c) + '</li>'; }).join('') + '</ul>' +
        '</div>' : '') +

      (d.solutionAreas && d.solutionAreas.length ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">SOLUTION AREAS</div>' +
          d.solutionAreas.map(function(s) {
            return '<div style="margin-bottom:10px;padding:10px;background:#0c0c0c;border:1px solid #1a1a1a;border-left:2px solid ' + suitCol(s.suitability) + ';">' +
              '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">' +
                '<div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#fff;">' + escH(s.asset || '') + '</div>' +
                '<div style="font-size:7px;letter-spacing:.12em;color:' + suitCol(s.suitability) + ';">' + escH(s.suitability || '') + '</div>' +
              '</div>' +
              '<div style="font-size:10px;color:rgba(255,255,255,0.75);line-height:1.6;margin-bottom:5px;">' + escH(s.rationale || '') + '</div>' +
              (s.keyPoint ? '<div style="font-size:9px;color:' + A + ';font-style:italic;">"' + escH(s.keyPoint) + '"</div>' : '') +
            '</div>';
          }).join('') +
        '</div>' : '') +

      (d.riskFlags && d.riskFlags.length ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl" style="color:' + RED + ';">RISK FLAGS</div>' +
          '<ul class="sp-facts">' + d.riskFlags.map(function(r){ return '<li style="color:' + RED + ';">' + escH(r) + '</li>'; }).join('') + '</ul>' +
        '</div>' : '') +

      (d.brokerBrief ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">HOW TO POSITION</div>' +
          '<div class="sp-pitch">' + escH(d.brokerBrief) + '</div>' +
        '</div>' : '') +

      (d.nextSteps && d.nextSteps.length ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">NEXT STEPS</div>' +
          '<ul class="sp-facts">' + d.nextSteps.map(function(n,i){ return '<li><strong style="color:' + A + ';">' + (i+1) + '.</strong> ' + escH(n) + '</li>'; }).join('') + '</ul>' +
        '</div>' : '');

    /* IFA pitch is always a separate full-quality fetch — always show the tab */
    var scenPitchCacheKey = 'scenario:pitch:' + (d.title || (d.situation || '').slice(0, 60));

    body.innerHTML =
      '<div class="sp-badge private" style="margin-bottom:8px;background:rgba(233,113,50,0.12);border-color:' + A + ';color:' + A + ';">▌ IFA ADVISORY BRIEF</div>' +

      '<div class="concept-sec-bar" style="margin-bottom:8px;">' +
        '<button class="concept-sec-btn active" data-scen-tab="brief">ADVISORY BRIEF</button>' +
        '<button class="concept-sec-btn" data-scen-tab="pitch" style="display:inline-flex;align-items:center;gap:5px;">PITCH PLAYBOOK<span class="scen-tab-i" data-info="pitch" style="font-family:Georgia,serif;font-size:9px;font-style:italic;opacity:.6;font-weight:400;cursor:pointer;padding:0 1px;">i</span></button>' +
        '<button class="concept-sec-btn" data-scen-tab="cfa" style="color:#4A9EDD;display:inline-flex;align-items:center;gap:5px;">INSTITUTIONAL ANALYSIS<span class="scen-tab-i" data-info="cfa" style="font-family:Georgia,serif;font-size:9px;font-style:italic;opacity:.6;font-weight:400;cursor:pointer;padding:0 1px;color:#4A9EDD;">i</span></button>' +
      '</div>' +

      '<div class="scen-tab-panel" data-scen-panel="brief">' + briefHtml +

        /* Follow-up thread */
        '<div class="scen-thread" style="margin-top:4px;"></div>' +

        /* Follow-up input */
        '<div class="scen-followup-bar" style="border-top:1px solid #1a1a1a;padding-top:10px;margin-top:8px;">' +
          '<div style="font-size:7px;letter-spacing:.25em;color:#E97132;margin-bottom:6px;">ASK A FOLLOW-UP QUESTION</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<input class="scen-fu-input" type="text" placeholder="e.g. How do I handle the objection about timing?" ' +
              'style="flex:1;background:#0c0c0c;border:1px solid #2a2a2a;color:#e0e0e0;font-size:10px;padding:7px 10px;outline:none;font-family:inherit;" />' +
            '<button class="scen-fu-send" style="background:#E97132;color:#000;font-size:7px;letter-spacing:.2em;padding:7px 10px;border:none;cursor:pointer;white-space:nowrap;">ASK ›</button>' +
          '</div>' +
        '</div>' +

      '</div>' +
      '<div class="scen-tab-panel" data-scen-panel="pitch" hidden>' +
        '<div class="scen-pitch-panel"><div class="sp-intel-load">GENERATING PITCH PLAYBOOK<span class="sp-intel-ld"></span></div></div>' +
      '</div>' +
      '<div class="scen-tab-panel" data-scen-panel="cfa" hidden>' +
        '<div class="scen-cfa-panel"><div class="sp-intel-load">RUNNING INSTITUTIONAL ANALYSIS<span class="sp-intel-ld"></span></div></div>' +
      '</div>' +

      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;display:flex;gap:8px;align-items:center;">' +
        '<button class="sp-save-brief-btn" style="background:none;border:1px solid #E97132;color:#E97132;font-size:7.5px;letter-spacing:.18em;padding:6px 12px;cursor:pointer;font-family:inherit;white-space:nowrap;">▌ SAVE CLIENT BRIEF</button>' +
        '<button class="sp-note-btn" style="background:none;border:none;color:#555;font-size:7.5px;letter-spacing:.12em;padding:6px 0;cursor:pointer;font-family:inherit;">✎ ADD NOTE</button>' +
      '</div>';

    /* Background prefetch for pitch + CFA — fires immediately on card load.
       In-flight deduplication: if a fetch is already running when the user clicks,
       we queue the render callback rather than firing a second Anthropic request. */
    var pitchCharged = false;
    var scenPitchQuery = d.situation ? (d.title ? d.title + ': ' + d.situation : d.situation) : (d.title || '');
    var lensKeyNow = (window._assetLens && window._assetLens.key) || 'universal';
    var lensCtxNow = (window._assetLens && window._assetLens.promptContext) || '';

    /* null = idle, [] = in-flight (callbacks queued until resolved) */
    var _pitchInFlight = null;
    var _cfaInFlight   = null;

    function _renderScenPitch(pitchData) {
      var pitchPanel = body.querySelector('.scen-pitch-panel');
      if (!pitchPanel) return;
      pitchPanel.innerHTML = buildPitchPlaybook(pitchData, null) +
        '<div class="scen-pitch-thread" style="margin-top:4px;"></div>' +
        '<div class="scen-followup-bar" style="border-top:1px solid #1a1a1a;padding-top:10px;margin-top:8px;">' +
          '<div style="font-size:7px;letter-spacing:.25em;color:#E97132;margin-bottom:6px;">ASK A FOLLOW-UP QUESTION</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<input class="scen-pitch-fu-input" type="text" placeholder="e.g. How do I handle the objection about fees?" ' +
              'style="flex:1;background:#0c0c0c;border:1px solid #2a2a2a;color:#e0e0e0;font-size:10px;padding:7px 10px;outline:none;font-family:inherit;" />' +
            '<button class="scen-pitch-fu-send" style="background:#E97132;color:#000;font-size:7px;letter-spacing:.2em;padding:7px 10px;border:none;cursor:pointer;white-space:nowrap;">ASK ›</button>' +
          '</div>' +
        '</div>';
      _wirePitchFollowUp(pitchData, pitchPanel);
    }

    function _wirePitchFollowUp(pitchData, pitchPanel) {
      var pitchFuInput = pitchPanel.querySelector('.scen-pitch-fu-input');
      var pitchFuSend  = pitchPanel.querySelector('.scen-pitch-fu-send');
      var pitchThread  = pitchPanel.querySelector('.scen-pitch-thread');
      var winEl = body.closest('.intel-popwin') || body.parentElement;
      if (!winEl._pitchHistory) winEl._pitchHistory = [];

      function _submitPitchFollowUp() {
        var q = pitchFuInput.value.trim();
        if (!q || pitchFuSend.disabled) return;
        pitchFuInput.value = '';
        pitchFuSend.disabled = true;
        pitchFuSend.textContent = '…';

        var userBubble = document.createElement('div');
        userBubble.style.cssText = 'text-align:right;margin-bottom:8px;';
        userBubble.innerHTML = '<span style="display:inline-block;background:#1a1a1a;border:1px solid #2a2a2a;color:#e0e0e0;font-size:10px;padding:6px 10px;line-height:1.6;max-width:85%;text-align:left;">' + escH(q) + '</span>';
        pitchThread.appendChild(userBubble);

        var asstBubble = document.createElement('div');
        asstBubble.style.cssText = 'margin-bottom:12px;';
        asstBubble.innerHTML = '<div style="display:flex;gap:6px;align-items:flex-start;"><span style="color:#E97132;font-size:7px;letter-spacing:.2em;padding-top:4px;white-space:nowrap;">PITCH</span><div class="scen-pitch-resp" style="font-size:10px;color:#c8c8c8;line-height:1.7;flex:1;min-height:14px;">▍</div></div>';
        pitchThread.appendChild(asstBubble);
        pitchThread.scrollTop = pitchThread.scrollHeight;

        var respEl = asstBubble.querySelector('.scen-pitch-resp');
        var accumulated = '';

        var fuHeaders = { 'Content-Type': 'application/json' };
        if (window._authToken) fuHeaders['Authorization'] = 'Bearer ' + window._authToken;

        var activeLensKey     = (window._assetLens && window._assetLens.key)         || 'universal';
        var activeLensContext = (window._assetLens && window._assetLens.promptContext) || '';
        var activeLensLabel   = (window._assetLens && window._assetLens.label)         || '';

        var pitchScenCtx = {
          situation: (pitchData.openingLine || '') + ' ' + (pitchData.logicalCase || ''),
          brokerBrief: pitchData.logicalCase || '',
          keyConsiderations: (pitchData.spinQuestions || []).map(function(sq) { return sq.question || sq; }).filter(Boolean),
          riskFlags: (pitchData.objections || []).map(function(o) { return o.objection || o; }).filter(Boolean),
        };

        fetch('/.netlify/functions/search-stream', {
          method: 'POST',
          headers: fuHeaders,
          body: JSON.stringify({
            type: 'follow-up',
            query: d.title ? (d.title + ': ' + d.situation) : (d.situation || ''),
            question: q,
            scenarioContext: pitchScenCtx,
            conversationHistory: winEl._pitchHistory.slice(),
            lensKey: activeLensKey,
            lensContext: activeLensContext,
            lensLabel: activeLensLabel,
          }),
        }).then(function(r) {
          if (!r.ok || !r.body) {
            respEl.textContent = 'Failed to get response. Please try again.';
            respEl.style.color = '#D14040';
            pitchFuSend.disabled = false; pitchFuSend.textContent = 'ASK ›';
            return;
          }
          var reader  = r.body.getReader();
          var decoder = new TextDecoder();
          var lineBuf = '';

          function readChunk() {
            return reader.read().then(function(chunk) {
              if (chunk.done) { pitchFuSend.disabled = false; pitchFuSend.textContent = 'ASK ›'; return; }
              lineBuf += decoder.decode(chunk.value, { stream: true });
              var lines = lineBuf.split('\n'); lineBuf = lines.pop();
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
                if (raw.type === 'text-delta') {
                  accumulated += raw.text;
                  respEl.textContent = accumulated + '▍';
                  pitchThread.scrollTop = pitchThread.scrollHeight;
                } else if (raw.type === 'text-done') {
                  accumulated = raw.text || accumulated;
                  respEl.textContent = accumulated;
                  winEl._pitchHistory.push({ role: 'user', content: q });
                  winEl._pitchHistory.push({ role: 'assistant', content: accumulated });
                  if (winEl._pitchHistory.length > 20) winEl._pitchHistory = winEl._pitchHistory.slice(-20);
                  pitchFuSend.disabled = false; pitchFuSend.textContent = 'ASK ›';
                  window._loadCreditBalance && window._loadCreditBalance();
                } else if (raw.type === 'error') {
                  if (raw.code === 402) {
                    respEl.textContent = 'Not enough credits (5 required).';
                    respEl.style.color = '#D14040';
                    window._showNoCredits && window._showNoCredits(raw.balance || 0);
                  } else {
                    respEl.textContent = 'Error — please try again.';
                    respEl.style.color = '#D14040';
                  }
                  pitchFuSend.disabled = false; pitchFuSend.textContent = 'ASK ›';
                }
              }
              return readChunk();
            }).catch(function() {
              respEl.textContent = 'Connection error — please try again.';
              respEl.style.color = '#D14040';
              pitchFuSend.disabled = false; pitchFuSend.textContent = 'ASK ›';
            });
          }
          readChunk();
        }).catch(function() {
          respEl.textContent = 'Request failed — please try again.';
          respEl.style.color = '#D14040';
          pitchFuSend.disabled = false; pitchFuSend.textContent = 'ASK ›';
        });
      }

      pitchFuSend.addEventListener('click', _submitPitchFollowUp);
      pitchFuInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); _submitPitchFollowUp(); }
      });
    }

    function _fetchScenPitch(onDemand) {
      if (_cache[scenPitchCacheKey]) {
        if (onDemand) _renderScenPitch(_cache[scenPitchCacheKey]);
        return;
      }
      /* already in-flight — register render callback and wait, don't fire another request */
      if (_pitchInFlight !== null) {
        if (onDemand) _pitchInFlight.push(_renderScenPitch);
        return;
      }
      _pitchInFlight = onDemand ? [_renderScenPitch] : [];

      var headers = { 'Content-Type': 'application/json' };
      if (window._authToken) headers['Authorization'] = 'Bearer ' + window._authToken;
      var reqBody = JSON.stringify({ query: scenPitchQuery, type: 'scenario', section: 'pitch-playbook', lensKey: lensKeyNow, lensContext: lensCtxNow, prefetch: true });

      fetch('/.netlify/functions/search-stream', { method: 'POST', headers: headers, body: reqBody })
        .then(function(r) {
          if (!r.ok || !r.body) { _pitchInFlight = null; return; }
          var reader = r.body.getReader();
          var decoder = new TextDecoder();
          var lineBuf = '';
          function readChunk() {
            return reader.read().then(function(chunk) {
              if (chunk.done) { _pitchInFlight = null; return; }
              lineBuf += decoder.decode(chunk.value, { stream: true });
              var lines = lineBuf.split('\n'); lineBuf = lines.pop();
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
                if (raw.type === 'cache' || raw.type === 'done') {
                  _cache[scenPitchCacheKey] = raw.data;
                  var cbs = _pitchInFlight || []; _pitchInFlight = null;
                  var pitchPanel = body.querySelector('.scen-tab-panel[data-scen-panel="pitch"]');
                  if (pitchPanel && !pitchPanel.hidden) _renderScenPitch(raw.data);
                  cbs.forEach(function(cb) { cb(raw.data); });
                  return;
                }
                if (raw.type === 'error' && raw.code === 402) {
                  _pitchInFlight = null;
                  window._showNoCredits && window._showNoCredits(raw.balance || 0);
                  return;
                }
              }
              return readChunk();
            });
          }
          readChunk().catch(function() { _pitchInFlight = null; });
        }).catch(function() { _pitchInFlight = null; });
    }

    /* Start background prefetch immediately */
    _fetchScenPitch(false);

    /* ── CFA Technical Analysis ── */
    var cfaCharged = false;
    var scenCfaCacheKey = 'scenario:cfa:' + (d.title || (d.situation || '').slice(0, 60));

    function _renderScenCfa(cfaData) {
      var cfaPanel = body.querySelector('.scen-cfa-panel');
      if (!cfaPanel) return;
      cfaPanel.innerHTML = buildCfaAnalysis(cfaData) +
        '<div class="scen-cfa-thread" style="margin-top:4px;"></div>' +
        '<div class="scen-followup-bar" style="border-top:1px solid #1a1a1a;padding-top:10px;margin-top:8px;">' +
          '<div style="font-size:7px;letter-spacing:.25em;color:#4A9EDD;margin-bottom:6px;">ASK A FOLLOW-UP QUESTION</div>' +
          '<div style="display:flex;gap:6px;">' +
            '<input class="scen-cfa-fu-input" type="text" placeholder="e.g. How does the BPR allocation affect IHT?" ' +
              'style="flex:1;background:#0c0c0c;border:1px solid #2a2a2a;color:#e0e0e0;font-size:10px;padding:7px 10px;outline:none;font-family:inherit;" />' +
            '<button class="scen-cfa-fu-send" style="background:#4A9EDD;color:#000;font-size:7px;letter-spacing:.2em;padding:7px 10px;border:none;cursor:pointer;white-space:nowrap;">ASK ›</button>' +
          '</div>' +
        '</div>';
      _wireCfaFollowUp(cfaData, cfaPanel);
    }

    function _wireCfaFollowUp(cfaData, cfaPanel) {
      var cfaFuInput  = cfaPanel.querySelector('.scen-cfa-fu-input');
      var cfaFuSend   = cfaPanel.querySelector('.scen-cfa-fu-send');
      var cfaThread   = cfaPanel.querySelector('.scen-cfa-thread');
      var winEl = body.closest('.intel-popwin') || body.parentElement;
      if (!winEl._cfaHistory) winEl._cfaHistory = [];

      function _submitCfaFollowUp() {
        var q = cfaFuInput.value.trim();
        if (!q || cfaFuSend.disabled) return;
        cfaFuInput.value = '';
        cfaFuSend.disabled = true;
        cfaFuSend.textContent = '…';

        var userBubble = document.createElement('div');
        userBubble.style.cssText = 'text-align:right;margin-bottom:8px;';
        userBubble.innerHTML = '<span style="display:inline-block;background:#1a1a1a;border:1px solid #2a2a2a;color:#e0e0e0;font-size:10px;padding:6px 10px;line-height:1.6;max-width:85%;text-align:left;">' + escH(q) + '</span>';
        cfaThread.appendChild(userBubble);

        var asstBubble = document.createElement('div');
        asstBubble.style.cssText = 'margin-bottom:12px;';
        asstBubble.innerHTML = '<div style="display:flex;gap:6px;align-items:flex-start;"><span style="color:#4A9EDD;font-size:7px;letter-spacing:.2em;padding-top:4px;white-space:nowrap;">CFA</span><div class="scen-cfa-resp" style="font-size:10px;color:#c8c8c8;line-height:1.7;flex:1;min-height:14px;">▍</div></div>';
        cfaThread.appendChild(asstBubble);
        cfaThread.scrollTop = cfaThread.scrollHeight;

        var respEl = asstBubble.querySelector('.scen-cfa-resp');
        var accumulated = '';

        var fuHeaders = { 'Content-Type': 'application/json' };
        if (window._authToken) fuHeaders['Authorization'] = 'Bearer ' + window._authToken;

        var activeLensKey     = (window._assetLens && window._assetLens.key)          || 'universal';
        var activeLensContext = (window._assetLens && window._assetLens.promptContext)  || '';
        var activeLensLabel   = (window._assetLens && window._assetLens.label)          || '';

        /* Build scenarioContext from CFA data so backend has full analytical context */
        var cfaScenCtx = {
          situation: (cfaData.suitabilityVerdict || '') + (cfaData.ipsAssessment ? ' Risk profile: ' + (cfaData.ipsAssessment.riskProfile || '') + '. Time horizon: ' + (cfaData.ipsAssessment.timeHorizon || '') + '.' : ''),
          brokerBrief: cfaData.technicalVerdict || '',
          keyConsiderations: [
            cfaData.allocationFramework && cfaData.allocationFramework.recommendedAllocation ? 'Recommended allocation: ' + cfaData.allocationFramework.recommendedAllocation : null,
            cfaData.allocationFramework && cfaData.allocationFramework.portfolioRationale    ? cfaData.allocationFramework.portfolioRationale : null,
            cfaData.taxOptimisation && cfaData.taxOptimisation.length ? 'Tax: ' + cfaData.taxOptimisation.join('; ') : null,
          ].filter(Boolean),
          riskFlags: cfaData.riskFlags || [],
        };

        fetch('/.netlify/functions/search-stream', {
          method: 'POST',
          headers: fuHeaders,
          body: JSON.stringify({
            type: 'follow-up',
            query: d.title ? (d.title + ': ' + d.situation) : (d.situation || ''),
            question: q,
            scenarioContext: cfaScenCtx,
            conversationHistory: winEl._cfaHistory.slice(),
            lensKey: activeLensKey,
            lensContext: activeLensContext,
            lensLabel: activeLensLabel,
          }),
        }).then(function(r) {
          if (!r.ok || !r.body) {
            respEl.textContent = 'Failed to get response. Please try again.';
            respEl.style.color = '#D14040';
            cfaFuSend.disabled = false; cfaFuSend.textContent = 'ASK ›';
            return;
          }
          var reader  = r.body.getReader();
          var decoder = new TextDecoder();
          var lineBuf = '';

          function readChunk() {
            return reader.read().then(function(chunk) {
              if (chunk.done) { cfaFuSend.disabled = false; cfaFuSend.textContent = 'ASK ›'; return; }
              lineBuf += decoder.decode(chunk.value, { stream: true });
              var lines = lineBuf.split('\n'); lineBuf = lines.pop();
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
                if (raw.type === 'text-delta') {
                  accumulated += raw.text;
                  respEl.textContent = accumulated + '▍';
                  cfaThread.scrollTop = cfaThread.scrollHeight;
                } else if (raw.type === 'text-done') {
                  accumulated = raw.text || accumulated;
                  respEl.textContent = accumulated;
                  winEl._cfaHistory.push({ role: 'user', content: q });
                  winEl._cfaHistory.push({ role: 'assistant', content: accumulated });
                  if (winEl._cfaHistory.length > 20) winEl._cfaHistory = winEl._cfaHistory.slice(-20);
                  cfaFuSend.disabled = false; cfaFuSend.textContent = 'ASK ›';
                  window._loadCreditBalance && window._loadCreditBalance();
                } else if (raw.type === 'error') {
                  if (raw.code === 402) {
                    respEl.textContent = 'Not enough credits (5 required).';
                    respEl.style.color = '#D14040';
                    window._showNoCredits && window._showNoCredits(raw.balance || 0);
                  } else {
                    respEl.textContent = 'Error — please try again.';
                    respEl.style.color = '#D14040';
                  }
                  cfaFuSend.disabled = false; cfaFuSend.textContent = 'ASK ›';
                }
              }
              return readChunk();
            }).catch(function() {
              respEl.textContent = 'Connection error — please try again.';
              respEl.style.color = '#D14040';
              cfaFuSend.disabled = false; cfaFuSend.textContent = 'ASK ›';
            });
          }
          readChunk();
        }).catch(function() {
          respEl.textContent = 'Request failed — please try again.';
          respEl.style.color = '#D14040';
          cfaFuSend.disabled = false; cfaFuSend.textContent = 'ASK ›';
        });
      }

      cfaFuSend.addEventListener('click', _submitCfaFollowUp);
      cfaFuInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); _submitCfaFollowUp(); }
      });
    }

    function _fetchScenCfa(onDemand) {
      if (_cache[scenCfaCacheKey]) {
        if (onDemand) _renderScenCfa(_cache[scenCfaCacheKey]);
        return;
      }
      /* already in-flight — register render callback and wait, don't fire another request */
      if (_cfaInFlight !== null) {
        if (onDemand) _cfaInFlight.push(_renderScenCfa);
        return;
      }
      _cfaInFlight = onDemand ? [_renderScenCfa] : [];

      var headers = { 'Content-Type': 'application/json' };
      if (window._authToken) headers['Authorization'] = 'Bearer ' + window._authToken;
      var cfaReqBody = JSON.stringify({ query: scenPitchQuery, type: 'scenario', section: 'cfa-analysis', lensKey: lensKeyNow, lensContext: lensCtxNow, prefetch: true });

      fetch('/.netlify/functions/search-stream', { method: 'POST', headers: headers, body: cfaReqBody })
        .then(function(r) {
          if (!r.ok || !r.body) { _cfaInFlight = null; return; }
          var reader = r.body.getReader();
          var decoder = new TextDecoder();
          var lineBuf = '';
          function readChunk() {
            return reader.read().then(function(chunk) {
              if (chunk.done) { _cfaInFlight = null; return; }
              lineBuf += decoder.decode(chunk.value, { stream: true });
              var lines = lineBuf.split('\n'); lineBuf = lines.pop();
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
                if (raw.type === 'cache' || raw.type === 'done') {
                  _cache[scenCfaCacheKey] = raw.data;
                  var cbs = _cfaInFlight || []; _cfaInFlight = null;
                  var cfaPanel = body.querySelector('.scen-tab-panel[data-scen-panel="cfa"]');
                  if (cfaPanel && !cfaPanel.hidden) _renderScenCfa(raw.data);
                  cbs.forEach(function(cb) { cb(raw.data); });
                  return;
                }
                if (raw.type === 'error') {
                  var cbs = _cfaInFlight || []; _cfaInFlight = null;
                  if (raw.code === 402) {
                    window._showNoCredits && window._showNoCredits(raw.balance || 0);
                  } else {
                    /* timeout or other error — show retry message in panel if visible */
                    if (cbs.length) {
                      var cfaPanelErr = body.querySelector('.scen-cfa-panel');
                      if (cfaPanelErr) cfaPanelErr.innerHTML = '<div style="padding:12px;font-size:10px;color:#D14040;line-height:1.7;">Analysis timed out — please try again.<br><span style="color:#555;font-size:9px;">Large analyses occasionally take longer. Click the tab again to retry.</span></div>';
                    }
                  }
                  return;
                }
              }
              return readChunk();
            }).catch(function() {
              _cfaInFlight = null;
              var cfaPanelErr = body.querySelector('.scen-cfa-panel');
              if (cfaPanelErr && cfaPanelErr.querySelector('.sp-intel-load')) cfaPanelErr.innerHTML = '<div style="padding:12px;font-size:10px;color:#D14040;">Connection lost — please try again.</div>';
            });
          }
          readChunk().catch(function() { _cfaInFlight = null; });
        }).catch(function() { _cfaInFlight = null; });
    }

    /* Start CFA background prefetch immediately */
    _fetchScenCfa(false);

    /* Tab switching — charge 25 credits on first pitch click, 25 on first CFA click */
    body.querySelectorAll('.concept-sec-btn[data-scen-tab]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        if (e.target.closest('.scen-tab-i')) return; /* clicking the i — tooltip handles it */
        var tab = btn.getAttribute('data-scen-tab');

        if (tab === 'pitch' && !pitchCharged) {
          var chHeaders = { 'Content-Type': 'application/json' };
          if (window._authToken) chHeaders['Authorization'] = 'Bearer ' + window._authToken;
          fetch('/.netlify/functions/credits', {
            method: 'POST', headers: chHeaders,
            body: JSON.stringify({ action: 'deduct', amount: 25, description: 'intel:ifa-pitch-playbook' }),
          }).then(function(r) { return r.json(); })
          .then(function(res) {
            if (res && res.error === 'insufficient') {
              window._showNoCredits && window._showNoCredits(res.balance || 0);
              return;
            }
            pitchCharged = true;
            window._loadCreditBalance && window._loadCreditBalance();
            body.querySelectorAll('.concept-sec-btn[data-scen-tab]').forEach(function(b){ b.classList.remove('active'); });
            btn.classList.add('active');
            body.querySelectorAll('.scen-tab-panel').forEach(function(p){ p.hidden = (p.getAttribute('data-scen-panel') !== tab); });
            if (_cache[scenPitchCacheKey]) _renderScenPitch(_cache[scenPitchCacheKey]);
            else _fetchScenPitch(true);
          }).catch(function() {
            pitchCharged = true;
            body.querySelectorAll('.concept-sec-btn[data-scen-tab]').forEach(function(b){ b.classList.remove('active'); });
            btn.classList.add('active');
            body.querySelectorAll('.scen-tab-panel').forEach(function(p){ p.hidden = (p.getAttribute('data-scen-panel') !== tab); });
            if (_cache[scenPitchCacheKey]) _renderScenPitch(_cache[scenPitchCacheKey]);
            else _fetchScenPitch(true);
          });
          return;
        }

        if (tab === 'cfa' && !cfaCharged) {
          var cfaChHeaders = { 'Content-Type': 'application/json' };
          if (window._authToken) cfaChHeaders['Authorization'] = 'Bearer ' + window._authToken;
          fetch('/.netlify/functions/credits', {
            method: 'POST', headers: cfaChHeaders,
            body: JSON.stringify({ action: 'deduct', amount: 25, description: 'intel:ifa-cfa-analysis' }),
          }).then(function(r) { return r.json(); })
          .then(function(res) {
            if (res && res.error === 'insufficient') {
              window._showNoCredits && window._showNoCredits(res.balance || 0);
              return;
            }
            cfaCharged = true;
            window._loadCreditBalance && window._loadCreditBalance();
            body.querySelectorAll('.concept-sec-btn[data-scen-tab]').forEach(function(b){ b.classList.remove('active'); });
            btn.classList.add('active');
            body.querySelectorAll('.scen-tab-panel').forEach(function(p){ p.hidden = (p.getAttribute('data-scen-panel') !== tab); });
            if (_cache[scenCfaCacheKey]) _renderScenCfa(_cache[scenCfaCacheKey]);
            else _fetchScenCfa(true);
          }).catch(function() {
            cfaCharged = true;
            body.querySelectorAll('.concept-sec-btn[data-scen-tab]').forEach(function(b){ b.classList.remove('active'); });
            btn.classList.add('active');
            body.querySelectorAll('.scen-tab-panel').forEach(function(p){ p.hidden = (p.getAttribute('data-scen-panel') !== tab); });
            if (_cache[scenCfaCacheKey]) _renderScenCfa(_cache[scenCfaCacheKey]);
            else _fetchScenCfa(true);
          });
          return;
        }

        body.querySelectorAll('.concept-sec-btn[data-scen-tab]').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        body.querySelectorAll('.scen-tab-panel').forEach(function(p){ p.hidden = (p.getAttribute('data-scen-panel') !== tab); });
      });
    });

    /* ── Pitch Playbook info button ── */
    var pitchInfoBtn = body.querySelector('.scen-tab-i[data-info="pitch"]');
    if (pitchInfoBtn) {
      pitchInfoBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var existing = body.querySelector('.scen-pitch-tooltip');
        if (existing) { existing.remove(); return; }
        var tip = document.createElement('div');
        tip.className = 'scen-pitch-tooltip';
        tip.style.cssText = 'position:absolute;z-index:9999;background:#0d0d0d;border:1px solid #E97132;padding:14px 16px;width:280px;font-size:9.5px;line-height:1.7;color:#c8c8c8;box-shadow:0 4px 20px rgba(0,0,0,.6);';
        tip.innerHTML =
          '<div style="font-size:7.5px;letter-spacing:.2em;color:#E97132;margin-bottom:10px;font-weight:700;">PITCH PLAYBOOK — WHAT\'S INCLUDED</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Opening Line</strong> — Second-level hook tailored to this client\'s dominant driver</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Broker Note</strong> — The angle and opening gambit for this exact client</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">The Logical Case</strong> — Three verified data points building certainty before the ask</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Socratic Question</strong> — Exposes the gap between what they believe and what they own</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Future Pace</strong> — Loss frame and gain frame specific to this client\'s situation</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Entry Architecture</strong> — Removes yes/no — replaces it with a sizing decision</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Discovery Questions</strong> — Situation, implication and need-payoff questions scripted for this client</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Objection Handling</strong> — Most likely pushbacks with verbatim rebuttals</div>' +
          '<div style="margin-bottom:10px;"><span style="color:#E97132;">▸</span> <strong style="color:#fff;">Trigger Agreement</strong> — Conditional close script for the hesitant client</div>' +
          '<div style="font-size:8px;color:#E97132;letter-spacing:.1em;border-top:1px solid #1a1a1a;padding-top:8px;">Methodology: Diagnostic questioning · Influence & compliance · Negotiation empathy · Conviction-building · Loss-aversion framing</div>';
        var btnRect = pitchInfoBtn.getBoundingClientRect();
        var bodyRect = (body.closest('.intel-popwin') || document.body).getBoundingClientRect();
        tip.style.top  = (btnRect.bottom - bodyRect.top + 6) + 'px';
        tip.style.left = Math.max(0, (btnRect.left - bodyRect.left - 220)) + 'px';
        (body.closest('.intel-popwin') || document.body).appendChild(tip);
        setTimeout(function() {
          document.addEventListener('click', function _closePitchTip() {
            tip.remove(); document.removeEventListener('click', _closePitchTip);
          });
        }, 10);
      });
    }

    /* ── Institutional Analysis info button ── */
    var iaInfoBtn = body.querySelector('.scen-tab-i[data-info="cfa"]');
    if (iaInfoBtn) {
      iaInfoBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var existing = body.querySelector('.scen-ia-tooltip');
        if (existing) { existing.remove(); return; }
        var tip = document.createElement('div');
        tip.className = 'scen-ia-tooltip';
        tip.style.cssText = 'position:absolute;z-index:9999;background:#0d0d0d;border:1px solid #4A9EDD;padding:14px 16px;width:280px;font-size:9.5px;line-height:1.7;color:#c8c8c8;box-shadow:0 4px 20px rgba(0,0,0,.6);';
        tip.innerHTML =
          '<div style="font-size:7.5px;letter-spacing:.2em;color:#4A9EDD;margin-bottom:10px;font-weight:700;">INSTITUTIONAL ANALYSIS — WHAT\'S INCLUDED</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Suitability Verdict</strong> — IPS/KYC ruling on this client</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Investment Policy Statement</strong> — Risk profile, time horizon, liquidity, tax points</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Allocation Framework</strong> — Recommended % with diversification rationale and asset-class correlation analysis</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Risk & Return Metrics</strong> — Risk-adjusted return, drawdown exposure, real return, duration — current vs with allocation</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Behavioural Risk Profile</strong> — Biases this client is most likely showing and how to counter them</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Tax Optimisation</strong> — Structural planning actions: BPR, EIS, CGT wrappers, IHT planning</div>' +
          '<div style="margin-bottom:6px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Technical Risk Flags</strong> — Concentration, liquidity, suitability, regulatory</div>' +
          '<div style="margin-bottom:10px;"><span style="color:#4A9EDD;">▸</span> <strong style="color:#fff;">Technical Verdict</strong> — Institutional-grade analytical case in plain English</div>' +
          '<div style="font-size:8px;color:#4A9EDD;letter-spacing:.1em;border-top:1px solid #1a1a1a;padding-top:8px;">Methodology: Portfolio theory · Risk analytics · Tax optimisation · Behavioural finance · Regulatory suitability</div>' +
          '';
        /* Position relative to the button */
        var btnRect = iaInfoBtn.getBoundingClientRect();
        var bodyRect = (body.closest('.intel-popwin') || document.body).getBoundingClientRect();
        tip.style.top  = (btnRect.bottom - bodyRect.top + 6) + 'px';
        tip.style.left = Math.max(0, (btnRect.left - bodyRect.left - 220)) + 'px';
        (body.closest('.intel-popwin') || document.body).appendChild(tip);
        /* Close on outside click */
        setTimeout(function() {
          document.addEventListener('click', function _closeTip() {
            tip.remove(); document.removeEventListener('click', _closeTip);
          });
        }, 10);
      });
    }

    /* Follow-up conversation handler */
    var fuInput  = body.querySelector('.scen-fu-input');
    var fuSend   = body.querySelector('.scen-fu-send');
    var fuThread = body.querySelector('.scen-thread');

    /* Store original scenario data on body element for context */
    body._scenData = d;
    /* Init history if not already set (preserves thread across tab switches) */
    var win = body.closest('.intel-popwin') || body.parentElement;
    if (!win._scenHistory) win._scenHistory = [];

    function _submitFollowUp() {
      var q = fuInput.value.trim();
      if (!q || fuSend.disabled) return;
      fuInput.value = '';
      fuSend.disabled = true;
      fuSend.textContent = '…';

      /* User bubble */
      var userBubble = document.createElement('div');
      userBubble.style.cssText = 'text-align:right;margin-bottom:8px;';
      userBubble.innerHTML = '<span style="display:inline-block;background:#1a1a1a;border:1px solid #2a2a2a;color:#e0e0e0;font-size:10px;padding:6px 10px;line-height:1.6;max-width:85%;text-align:left;">' + escH(q) + '</span>';
      fuThread.appendChild(userBubble);

      /* Assistant bubble */
      var asstBubble = document.createElement('div');
      asstBubble.style.cssText = 'margin-bottom:12px;';
      asstBubble.innerHTML = '<div style="display:flex;gap:6px;align-items:flex-start;"><span style="color:#E97132;font-size:7px;letter-spacing:.2em;padding-top:4px;white-space:nowrap;">IFA</span><div class="scen-fu-resp" style="font-size:10px;color:#c8c8c8;line-height:1.7;flex:1;min-height:14px;">▍</div></div>';
      fuThread.appendChild(asstBubble);
      fuThread.scrollTop = fuThread.scrollHeight;

      var respEl = asstBubble.querySelector('.scen-fu-resp');
      var accumulated = '';

      var fuHeaders = { 'Content-Type': 'application/json' };
      if (window._authToken) fuHeaders['Authorization'] = 'Bearer ' + window._authToken;

      var activeLensKey     = (window._assetLens && window._assetLens.key)          || 'universal';
      var activeLensContext = (window._assetLens && window._assetLens.promptContext)  || '';
      var activeLensLabel   = (window._assetLens && window._assetLens.label)          || '';

      fetch('/.netlify/functions/search-stream', {
        method: 'POST',
        headers: fuHeaders,
        body: JSON.stringify({
          type: 'follow-up',
          query: d.title ? (d.title + ': ' + d.situation) : (d.situation || ''),
          question: q,
          scenarioContext: { situation: d.situation, brokerBrief: d.brokerBrief, keyConsiderations: d.keyConsiderations, riskFlags: d.riskFlags },
          conversationHistory: win._scenHistory.slice(),
          lensKey: activeLensKey,
          lensContext: activeLensContext,
          lensLabel: activeLensLabel,
        }),
      }).then(function(r) {
        if (!r.ok || !r.body) {
          respEl.textContent = 'Failed to get response. Please try again.';
          respEl.style.color = '#D14040';
          fuSend.disabled = false; fuSend.textContent = 'ASK ›';
          return;
        }
        var reader  = r.body.getReader();
        var decoder = new TextDecoder();
        var lineBuf = '';

        function readChunk() {
          return reader.read().then(function(chunk) {
            if (chunk.done) {
              fuSend.disabled = false; fuSend.textContent = 'ASK ›';
              return;
            }
            lineBuf += decoder.decode(chunk.value, { stream: true });
            var lines = lineBuf.split('\n');
            lineBuf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (!line.startsWith('data: ')) continue;
              var raw;
              try { raw = JSON.parse(line.slice(6)); } catch { continue; }
              if (raw.type === 'text-delta') {
                accumulated += raw.text;
                respEl.textContent = accumulated + '▍';
                fuThread.scrollTop = fuThread.scrollHeight;
              } else if (raw.type === 'text-done') {
                accumulated = raw.text || accumulated;
                respEl.textContent = accumulated;
                win._scenHistory.push({ role: 'user', content: q });
                win._scenHistory.push({ role: 'assistant', content: accumulated });
                /* Keep last 10 exchanges (20 messages) */
                if (win._scenHistory.length > 20) win._scenHistory = win._scenHistory.slice(-20);
                fuSend.disabled = false; fuSend.textContent = 'ASK ›';
                window._loadCreditBalance && window._loadCreditBalance();
              } else if (raw.type === 'error') {
                if (raw.code === 402) {
                  respEl.textContent = 'Not enough credits (5 required).';
                  respEl.style.color = '#D14040';
                  window._showNoCredits && window._showNoCredits(raw.balance || 0);
                } else {
                  respEl.textContent = 'Error — please try again.';
                  respEl.style.color = '#D14040';
                }
                fuSend.disabled = false; fuSend.textContent = 'ASK ›';
              }
            }
            return readChunk();
          }).catch(function() {
            respEl.textContent = 'Connection error — please try again.';
            respEl.style.color = '#D14040';
            fuSend.disabled = false; fuSend.textContent = 'ASK ›';
          });
        }
        readChunk();
      }).catch(function() {
        respEl.textContent = 'Request failed — please try again.';
        respEl.style.color = '#D14040';
        fuSend.disabled = false; fuSend.textContent = 'ASK ›';
      });
    }

    fuSend.addEventListener('click', _submitFollowUp);
    fuInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); _submitFollowUp(); }
    });

    /* ── SAVE CLIENT BRIEF ── */
    var saveBriefBtn = body.querySelector('.sp-save-brief-btn');
    if (saveBriefBtn) {
      saveBriefBtn.addEventListener('click', function() {
        var winEl = body.closest('.intel-popwin') || body.parentElement;
        var pitchKey = 'scenario:pitch:' + (d.title || (d.situation || '').slice(0, 60));
        var cfaKey   = 'scenario:cfa:'   + (d.title || (d.situation || '').slice(0, 60));
        var intake   = window._lastIfaIntake || {};
        var saved = {
          id:           Date.now(),
          savedAt:      new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}),
          intake:       intake,
          query:        intake.query || (d.title || d.situation || ''),
          briefData:    d,
          pitchData:    _cache[pitchKey] || null,
          cfaData:      _cache[cfaKey]   || null,
          briefHistory: (winEl._scenHistory  || []).slice(),
          cfaHistory:   (winEl._cfaHistory   || []).slice(),
          pitchHistory: (winEl._pitchHistory || []).slice(),
        };
        var briefs = _loadBriefs();
        var existingIdx = briefs.findIndex(function(b) { return b.query === saved.query; });
        if (existingIdx !== -1) {
          saved.id = briefs[existingIdx].id; /* keep original id so it stays in place */
          briefs[existingIdx] = saved;
        } else {
          briefs.unshift(saved);
          if (briefs.length > 50) briefs.length = 50;
        }
        try { localStorage.setItem('tbt_briefs', JSON.stringify(briefs)); } catch(e) {}
        saveBriefBtn.textContent = '✓ SAVED';
        saveBriefBtn.style.borderColor = '#3d8c5a';
        saveBriefBtn.style.color = '#3d8c5a';
        setTimeout(function() {
          saveBriefBtn.textContent = '▌ SAVE CLIENT BRIEF';
          saveBriefBtn.style.borderColor = '#E97132';
          saveBriefBtn.style.color = '#E97132';
        }, 2000);
      });
    }
  }

  /* ── SAVED CLIENT BRIEFS ── */
  function _loadBriefs() {
    try { return JSON.parse(localStorage.getItem('tbt_briefs') || '[]'); } catch(e) { return []; }
  }

  function _openSavedBrief(saved) {
    /* Pre-populate cache so pitch/CFA load instantly from saved data (no API call) */
    var pitchKey = 'scenario:pitch:' + (saved.briefData.title || (saved.briefData.situation || '').slice(0, 60));
    var cfaKey   = 'scenario:cfa:'   + (saved.briefData.title || (saved.briefData.situation || '').slice(0, 60));
    if (saved.pitchData) _cache[pitchKey] = saved.pitchData;
    if (saved.cfaData)   _cache[cfaKey]   = saved.cfaData;

    /* Bring existing window to front if already open */
    var pid = 'saved-' + saved.id;
    var existing = document.querySelector('.intel-popwin[data-pop-saved="' + saved.id + '"]');
    if (existing) { window._sharedZ++; existing.style.zIndex = window._sharedZ; return; }

    var x = 80 + (Object.keys(_registry).length % 5) * 44;
    var y = 80 + (Object.keys(_registry).length % 5) * 32;

    var win = document.createElement('div');
    win.className  = 'intel-popwin';
    win._itTitle   = (saved.intake.ref || saved.briefData.title || 'SAVED BRIEF').toUpperCase();
    win._popId     = pid;
    win.dataset.popSaved = saved.id;
    win.style.cssText = 'top:' + y + 'px;left:' + x + 'px;z-index:' + (++window._sharedZ) + ';';

    var popZoom = 1;
    win.innerHTML =
      '<div class="intel-popwin-titlebar">' +
        '<span class="intel-popwin-icon">▌ INTEL</span>' +
        '<span class="intel-popwin-title">' + escH(win._itTitle) + '</span>' +
        '<div style="display:flex;gap:4px;margin-left:auto;align-items:center;">' +
          '<button class="intel-popwin-btn intel-popwin-zoom-out" title="Zoom out">−</button>' +
          '<button class="intel-popwin-btn intel-popwin-zoom-in"  title="Zoom in">+</button>' +
          '<button class="intel-popwin-close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="intel-popwin-body"></div>';

    _registry[pid] = { query: win._itTitle, type: 'scenario', ticker: '', x: x, y: y, w: 440, h: 500 };
    document.body.appendChild(win);

    var zoomInBtn  = win.querySelector('.intel-popwin-zoom-in');
    var zoomOutBtn = win.querySelector('.intel-popwin-zoom-out');
    var bodyEl     = win.querySelector('.intel-popwin-body');

    function applyZoom(z) {
      popZoom = Math.min(2, Math.max(0.4, z));
      bodyEl.style.zoom = popZoom;
    }
    zoomInBtn.addEventListener('click',  function(e) { e.stopPropagation(); applyZoom(popZoom + 0.1); });
    zoomOutBtn.addEventListener('click', function(e) { e.stopPropagation(); applyZoom(popZoom - 0.1); });

    makeDraggable(win, win.querySelector('.intel-popwin-titlebar'));
    makeResizablePop(win);
    win.addEventListener('mousedown', function() { window._sharedZ++; win.style.zIndex = window._sharedZ; });

    win.querySelector('.intel-popwin-close').addEventListener('click', function() {
      delete _registry[pid];
      win.remove();
    });

    /* Restore conversation histories before rendering */
    win._scenHistory  = (saved.briefHistory  || []).slice();
    win._cfaHistory   = (saved.cfaHistory    || []).slice();
    win._pitchHistory = (saved.pitchHistory  || []).slice();

    /* Tag the last intake so the save button updates correctly from a re-opened brief */
    window._lastIfaIntake = saved.intake || {};

    bodyEl.style.cssText += 'opacity:0;transition:opacity .35s ease;';
    requestAnimationFrame(function() { requestAnimationFrame(function() { bodyEl.style.opacity = '1'; }); });
    renderScenario(saved.briefData, bodyEl);
  }

  function _openClientsModal() {
    var existing = document.getElementById('intel-clients-modal');
    if (existing) { existing.remove(); }

    var briefs = _loadBriefs();

    var modal = document.createElement('div');
    modal.id = 'intel-clients-modal';
    modal.style.cssText = 'position:fixed;z-index:99999;top:60px;right:20px;background:#0a0a0a;border:1px solid #2a2a2a;border-top:2px solid #E97132;width:320px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.7);';

    var panel = modal; /* panel === modal now — no wrapper needed */

    var hdr = '<div id="intel-clients-titlebar" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #1a1a1a;cursor:move;user-select:none;">' +
      '<div>' +
        '<div style="font-size:7px;letter-spacing:.3em;color:#E97132;font-weight:700;margin-bottom:2px;">IFA INTEL</div>' +
        '<div style="font-size:12px;color:#fff;letter-spacing:.06em;font-weight:700;">SAVED CLIENTS</div>' +
      '</div>' +
      '<button id="intel-clients-close" style="background:none;border:none;color:#555;font-size:14px;cursor:pointer;padding:4px;">✕</button>' +
    '</div>';

    var listHtml = '';
    if (!briefs.length) {
      listHtml = '<div style="padding:20px 14px;font-size:9.5px;color:#444;text-align:center;line-height:1.8;">No saved client briefs yet.<br><span style="color:#333;">Run an IFA Intel brief and click<br>▌ SAVE CLIENT BRIEF to store it here.</span></div>';
    } else {
      listHtml = briefs.map(function(b, i) {
        var ref       = b.customName || (b.intake && b.intake.ref) || b.briefData.title || 'Client';
        var age       = (b.intake && b.intake.age)       || '';
        var portfolio = (b.intake && b.intake.portfolio) || '';
        var hasPitch  = !!b.pitchData;
        var hasCfa    = !!b.cfaData;
        return '<div class="clients-row" data-idx="' + i + '" style="padding:10px 14px;border-bottom:1px solid #111;cursor:pointer;transition:background .15s;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;gap:6px;">' +
            '<div class="clients-row-name" style="font-size:10px;color:#fff;font-weight:700;letter-spacing:.05em;flex:1;">' + escH(ref) + '</div>' +
            '<button class="clients-rename-btn" data-idx="' + i + '" title="Rename" style="background:none;border:none;color:#444;font-size:11px;cursor:pointer;padding:0 2px;flex-shrink:0;line-height:1;">✎</button>' +
            '<div style="font-size:8px;color:#444;flex-shrink:0;">' + escH(b.savedAt) + '</div>' +
          '</div>' +
          (age       ? '<div style="font-size:8.5px;color:#888;">' + escH(age) + '</div>' : '') +
          (portfolio ? '<div style="font-size:8.5px;color:#E97132;">' + escH(portfolio) + '</div>' : '') +
          '<div style="margin-top:4px;display:flex;gap:4px;">' +
            '<span style="font-size:7px;letter-spacing:.1em;padding:1px 5px;border:1px solid #1f1f1f;color:#555;">BRIEF</span>' +
            (hasPitch ? '<span style="font-size:7px;letter-spacing:.1em;padding:1px 5px;border:1px solid #2a1a0a;color:#E97132;">PITCH</span>' : '') +
            (hasCfa   ? '<span style="font-size:7px;letter-spacing:.1em;padding:1px 5px;border:1px solid #0a1a2a;color:#4A9EDD;">CFA</span>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }

    var deleteRowHtml = briefs.length ?
      '<div style="padding:10px 14px;border-top:1px solid #1a1a1a;">' +
        '<button id="intel-clients-clear" style="background:none;border:none;color:#444;font-size:8px;letter-spacing:.1em;cursor:pointer;padding:0;">✕ CLEAR ALL SAVED CLIENTS</button>' +
      '</div>' : '';

    modal.innerHTML = hdr +
      '<div style="overflow-y:auto;flex:1;">' + listHtml + '</div>' +
      deleteRowHtml;

    document.body.appendChild(modal);
    makeDraggable(modal, modal.querySelector('#intel-clients-titlebar'));

    /* Hover effect + open brief on row click */
    modal.querySelectorAll('.clients-row').forEach(function(row) {
      row.addEventListener('mouseenter', function() { row.style.background = '#111'; });
      row.addEventListener('mouseleave', function() { row.style.background = ''; });
      row.addEventListener('click', function() {
        var idx = parseInt(row.getAttribute('data-idx'), 10);
        if (briefs[idx]) {
          modal.remove();
          _openSavedBrief(briefs[idx]);
        }
      });
    });

    /* Rename buttons */
    modal.querySelectorAll('.clients-rename-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var nameEl = btn.closest('.clients-row').querySelector('.clients-row-name');
        var current = briefs[idx].customName || nameEl.textContent;
        var inp = document.createElement('input');
        inp.value = current;
        inp.style.cssText = 'background:#111;border:none;border-bottom:1px solid #E97132;color:#fff;font-size:10px;font-weight:700;letter-spacing:.05em;outline:none;width:100%;font-family:Consolas,Menlo,monospace;';
        nameEl.innerHTML = '';
        nameEl.appendChild(inp);
        inp.focus();
        inp.select();
        function save() {
          var newName = inp.value.trim() || current;
          briefs[idx].customName = newName;
          try { localStorage.setItem('tbt_briefs', JSON.stringify(briefs)); } catch(e2) {}
          nameEl.textContent = newName;
        }
        inp.addEventListener('blur', save);
        inp.addEventListener('keydown', function(e2) {
          if (e2.key === 'Enter') { e2.preventDefault(); inp.blur(); }
          if (e2.key === 'Escape') { inp.value = current; inp.blur(); }
        });
      });
    });

    var closeBtn = modal.querySelector('#intel-clients-close');
    if (closeBtn) closeBtn.addEventListener('click', function() { modal.remove(); });

    var clearBtn = modal.querySelector('#intel-clients-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        if (confirm('Clear all saved client briefs? This cannot be undone.')) {
          try { localStorage.removeItem('tbt_briefs'); } catch(e) {}
          modal.remove();
        }
      });
    }

    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  }

  function renderPopout(d, win) {
    if (win._loadingTimer) { clearInterval(win._loadingTimer); win._loadingTimer = null; }
    var body = win.querySelector('.intel-popwin-body');
    if (!body || !d) {
      if (body) body.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>';
      return;
    }
    body.style.cssText += 'opacity:0;transition:opacity .35s ease;';
    requestAnimationFrame(function () { requestAnimationFrame(function () { body.style.opacity = '1'; }); });

    /* Update title bar */
    var titleEl = win.querySelector('.intel-popwin-title');
    if (titleEl && d.title) titleEl.textContent = d.title.toUpperCase();

    if (d.type === 'scenario') {
      renderScenario(d, body);
    } else if (d.type === 'company' && d.category === 'distillery') {
      renderDistillery(d, d._wsResults || [], body, win);
    } else if (d.type === 'company') {
      renderCompany(d, body);
      /* Pre-fetch pitch playbook silently so it's cached when user clicks the button */
      if (d.ticker && d.ticker.length) _prefetchCompanyPitch(d.title || d.ticker, d.ticker);
    } else {
      renderConcept(d, body, win);
    }

    /* Store story content for note-taking, wire ADD NOTE with selection capture */
    var parts = [];
    if (d.overview)          parts.push(d.overview);
    if (d.relevance)         parts.push('RELEVANCE TO ALTERNATIVE ASSETS:\n' + d.relevance);
    if (d.whatHappened)      parts.push(d.whatHappened);
    if (d.impactOnAssets)    parts.push('IMPACT ON ASSETS:\n' + d.impactOnAssets);
    if (d.lessonForClients)  parts.push('LESSON FOR CLIENTS:\n' + d.lessonForClients);
    if (d.brokerNote)        parts.push('HOW TO PITCH:\n' + d.brokerNote);
    if (d.pitch) {
      var p = d.pitch;
      if (p.openingLine)    parts.push('OPENING LINE:\n"' + p.openingLine + '"');
      if (p.logicalCase && p.logicalCase.length)
                            parts.push('LOGICAL CASE:\n' + p.logicalCase.map(function (f, i) { return (i + 1) + '. ' + f; }).join('\n'));
      if (p.emotionalCase)  parts.push('FUTURE PACE:\n' + p.emotionalCase);
      if (p.spinQuestions && p.spinQuestions.length)
                            parts.push('DISCOVERY QUESTIONS:\n' + p.spinQuestions.map(function (q, i) { return ['Situation', 'Problem/Implication', 'Need-Payoff'][i] + ': ' + q; }).join('\n'));
      if (p.objections && p.objections.length)
                            parts.push('OBJECTIONS:\n' + p.objections.map(function (o) { return '"' + o.objection + '"\n→ ' + o.rebuttal; }).join('\n\n'));
      if (p.urgencyLine)    parts.push('TIMING: ' + p.urgencyLine);
      if (p.socialProof)    parts.push('SOCIAL PROOF: ' + p.socialProof);
    }

    body._intelNoteData = {
      subjectType:    'intel',
      subjectTitle:   d.title  || '',
      subjectTicker:  d.ticker || '',
      subjectContent: parts.join('\n\n'),
    };

    var noteBtn = body.querySelector('.sp-note-btn');
    if (noteBtn) {
      noteBtn.removeAttribute('onclick');
      noteBtn.addEventListener('click', function () {
        var sel = window.getSelection ? window.getSelection().toString().trim() : '';
        window.noteModalOpen && noteModalOpen(
          Object.assign({}, body._intelNoteData, {subjectHighlight: sel})
        );
      });
    }
  }

  function buildPitchPlaybook(pitch, brokerNote) {
    if (!pitch && !brokerNote) return '';
    if (!pitch) {
      return '<div class=”sp-section”><div class=”sp-sec-lbl”>BROKER NOTE</div><div class=”sp-pitch”>' + escH(brokerNote) + '</div></div>';
    }

    var A = '#E97132';

    /* card helper — orange left border, dark background, label + body */
    function card(label, body) {
      return '<div style=”margin-bottom:8px;padding:8px 10px;background:#0c0c0c;border:1px solid #1a1a1a;border-left:2px solid ' + A + ';”>' +
        (label ? '<div style=”font-size:7px;color:' + A + ';letter-spacing:.14em;font-weight:700;margin-bottom:5px;text-transform:uppercase;”>' + label + '</div>' : '') +
        '<div style=”font-size:10px;color:#c8c8c8;line-height:1.7;”>' + body + '</div>' +
      '</div>';
    }

    var openLine = pitch.openingLine || '';
    var driverBadge = pitch.dominantDriverTarget ? ' — ' + pitch.dominantDriverTarget.toUpperCase() + ' DRIVER' : '';
    var html = openLine
      ? '<div class=”sp-section”><div class=”sp-sec-lbl”>' + 'OPENING LINE' + escH(driverBadge) + '</div>' +
        card('', '”' + escH(openLine) + '”') + '</div>'
      : '';

    var bn = pitch.brokerNote || brokerNote;
    if (bn) html +=
      '<div class=”sp-section”><div class=”sp-sec-lbl”>BROKER NOTE</div>' +
      card('', escH(bn)) + '</div>';

    if (pitch.logicalCase && pitch.logicalCase.length) html +=
      '<div class=”sp-section”><div class=”sp-sec-lbl”>THE LOGICAL CASE — BUILD CERTAINTY FIRST</div>' +
      pitch.logicalCase.map(function(f, i) {
        return card('POINT ' + (i + 1), escH(f));
      }).join('') + '</div>';

    if (pitch.socraticDissonancePrompt) html +=
      '<div class=”sp-section”><div class=”sp-sec-lbl”>SOCRATIC QUESTION — EXPOSE THE GAP</div>' +
      card('', '<span style=”color:' + A + ';font-style:italic;”>”' + escH(pitch.socraticDissonancePrompt) + '”</span>') +
      '</div>';

    var fp = pitch.asIfFuturePace;
    if (fp && (fp.lossFrame || fp.gainFrame)) {
      html += '<div class=”sp-section”><div class=”sp-sec-lbl”>FUTURE PACE — WITHOUT VS WITH</div>';
      if (fp.lossFrame) html += card('WITHOUT', escH(fp.lossFrame));
      if (fp.gainFrame) html += card('WITH', escH(fp.gainFrame));
      html += '</div>';
    } else if (pitch.emotionalCase) {
      html += '<div class=”sp-section”><div class=”sp-sec-lbl”>FUTURE PACE</div>' +
        card('', escH(pitch.emotionalCase)) + '</div>';
    }

    if (pitch.entryDefaultArchitecture) html +=
      '<div class=”sp-section”><div class=”sp-sec-lbl”>ENTRY ARCHITECTURE — REMOVE YES/NO</div>' +
      card('', escH(pitch.entryDefaultArchitecture)) + '</div>';

    if (pitch.painPoint) html +=
      '<div class=”sp-section”><div class=”sp-sec-lbl”>THEIR PAIN POINT</div>' +
      card('', escH(pitch.painPoint)) + '</div>';

    if (pitch.spinQuestions && pitch.spinQuestions.length) {
      var spinLabels = ['SITUATION', 'PROBLEM / IMPLICATION', 'NEED-PAYOFF'];
      html += '<div class=”sp-section”><div class=”sp-sec-lbl”>DISCOVERY QUESTIONS — ASK FIRST</div>' +
        pitch.spinQuestions.map(function(q, i) {
          var clean = q.replace(/^(situation|problem\s*[\/]?\s*implication|need[-\s]payoff)[:\s]*/i, '').trim();
          return card(spinLabels[i] || '', escH(clean));
        }).join('') + '</div>';
    }

    if (pitch.objections && pitch.objections.length) {
      html += '<div class=”sp-section”><div class=”sp-sec-lbl”>HANDLE OBJECTIONS</div>' +
        pitch.objections.map(function(o) {
          var body = '<div style=”color:' + A + ';font-style:italic;margin-bottom:6px;”>”' + escH(o.objection || '') + '”</div>' +
                     '<div style=”color:#c8c8c8;”>' + escH(o.rebuttal || '') + '</div>';
          return card('OBJECTION / REBUTTAL', body);
        }).join('') + '</div>';
    }

    if (pitch.urgencyLine || pitch.socialProof) {
      html += '<div class=”sp-section”><div class=”sp-sec-lbl”>TIMING & SOCIAL PROOF</div>';
      if (pitch.urgencyLine) html += card('URGENCY', escH(pitch.urgencyLine));
      if (pitch.socialProof) html += card('SOCIAL PROOF', escH(pitch.socialProof));
      html += '</div>';
    }

    if (pitch.triggerAgreementTemplate) html +=
      '<div class=”sp-section”><div class=”sp-sec-lbl”>TRIGGER AGREEMENT — CONDITIONAL CLOSE</div>' +
      card('', escH(pitch.triggerAgreementTemplate)) + '</div>';

    return html;
  }

  function buildCfaAnalysis(data) {
    if (!data) return '<div class="sp-intel-load">ANALYSIS UNAVAILABLE<span class="sp-intel-ld"></span></div>';
    var BLU = '#4A9EDD', A = '#E97132', GRN = '#6bcb77', RED = '#D14040';
    var html = '';

    if (data.suitabilityVerdict) html +=
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl" style="color:' + BLU + ';">SUITABILITY VERDICT — REGULATORY REVIEW</div>' +
        '<div class="sp-pitch" style="border-left-color:' + BLU + ';color:#c8c8c8;">' + escH(data.suitabilityVerdict) + '</div>' +
      '</div>';

    var ips = data.ipsAssessment;
    if (ips) {
      var ipsRows = [
        { key: 'riskProfile',        label: 'RISK PROFILE' },
        { key: 'timeHorizon',        label: 'TIME HORIZON' },
        { key: 'liquidityNeeds',     label: 'LIQUIDITY' },
        { key: 'taxConsiderations',  label: 'TAX POINTS' },
      ];
      html += '<div class="sp-section"><div class="sp-sec-lbl" style="color:' + BLU + ';">INVESTMENT POLICY STATEMENT</div>' +
        ipsRows.map(function(r) {
          return ips[r.key] ? '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #181818;font-size:10px;color:#c8c8c8;line-height:1.6;">' +
            '<span style="color:' + BLU + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">' + r.label + '</span>' +
            escH(ips[r.key]) + '</div>' : '';
        }).join('') +
      '</div>';
    }

    var af = data.allocationFramework;
    if (af) {
      html += '<div class="sp-section"><div class="sp-sec-lbl" style="color:' + BLU + ';">ALLOCATION FRAMEWORK — MARKOWITZ / ENDOWMENT MODEL</div>' +
        (af.recommendedAllocation ? '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #181818;font-size:10px;color:#c8c8c8;line-height:1.6;"><span style="color:' + BLU + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">RECOMMENDED</span>' + escH(af.recommendedAllocation) + '</div>' : '') +
        (af.portfolioRationale ? '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #181818;font-size:10px;color:#c8c8c8;line-height:1.6;"><span style="color:' + BLU + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">RATIONALE</span>' + escH(af.portfolioRationale) + '</div>' : '') +
        (af.modelComparison ? '<div style="display:flex;gap:8px;padding:4px 0;font-size:10px;color:#c8c8c8;line-height:1.6;"><span style="color:' + BLU + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">vs BENCHMARK</span>' + escH(af.modelComparison) + '</div>' : '') +
      '</div>';
    }

    if (data.keyMetrics && data.keyMetrics.length) {
      html += '<div class="sp-section"><div class="sp-sec-lbl" style="color:' + BLU + ';">RISK / RETURN METRICS</div>' +
        data.keyMetrics.map(function(m) {
          return '<div style="margin-bottom:8px;padding:8px;background:#0c0c0c;border:1px solid #1a1a1a;border-left:2px solid ' + BLU + ';">' +
            '<div style="font-size:8px;color:' + BLU + ';letter-spacing:.12em;font-weight:700;margin-bottom:5px;">' + escH(m.metric || '') + '</div>' +
            (m.currentPosition ? '<div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-bottom:2px;"><span style="color:#444;font-size:8px;">NOW → </span>' + escH(m.currentPosition) + '</div>' : '') +
            (m.withAllocation  ? '<div style="font-size:9.5px;color:' + GRN + ';"><span style="color:#444;font-size:8px;">WITH → </span>' + escH(m.withAllocation) + '</div>' : '') +
          '</div>';
        }).join('') +
      '</div>';
    }

    if (data.behaviouralProfile && data.behaviouralProfile.length) {
      html += '<div class="sp-section"><div class="sp-sec-lbl" style="color:' + BLU + ';">BEHAVIOURAL RISK PROFILE</div>' +
        data.behaviouralProfile.map(function(b) {
          return '<div style="margin-bottom:8px;padding:8px;background:#0c0c0c;border:1px solid #1a1a1a;">' +
            '<div style="font-size:8px;color:' + A + ';letter-spacing:.12em;font-weight:700;margin-bottom:3px;">' + escH(b.bias || '') + '</div>' +
            (b.signal         ? '<div style="font-size:9.5px;color:rgba(255,255,255,0.45);margin-bottom:4px;">' + escH(b.signal) + '</div>' : '') +
            (b.advisorResponse ? '<div style="font-size:9.5px;color:#c8c8c8;border-left:2px solid ' + BLU + ';padding-left:7px;">' + escH(b.advisorResponse) + '</div>' : '') +
          '</div>';
        }).join('') +
      '</div>';
    }

    if (data.taxOptimisation && data.taxOptimisation.length) html +=
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl" style="color:' + BLU + ';">TAX OPTIMISATION — STRUCTURAL PLANNING</div>' +
        '<ul class="sp-facts">' + data.taxOptimisation.map(function(t){ return '<li>' + escH(t) + '</li>'; }).join('') + '</ul>' +
      '</div>';

    if (data.riskFlags && data.riskFlags.length) html +=
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl" style="color:' + RED + ';">TECHNICAL RISK FLAGS</div>' +
        '<ul class="sp-facts">' + data.riskFlags.map(function(r){ return '<li style="color:' + RED + ';">' + escH(r) + '</li>'; }).join('') + '</ul>' +
      '</div>';

    if (data.stressTest && data.stressTest.length) {
      html += '<div class="sp-section"><div class="sp-sec-lbl" style="color:' + RED + ';">STRESS TEST — SCENARIO ANALYSIS</div>' +
        data.stressTest.map(function(s) {
          return '<div style="margin-bottom:8px;padding:8px;background:#0c0c0c;border:1px solid #1a1a1a;border-left:2px solid ' + RED + ';">' +
            '<div style="font-size:8px;color:' + RED + ';letter-spacing:.12em;font-weight:700;margin-bottom:5px;">' + escH(s.scenario || '') + '</div>' +
            (s.portfolioImpact ? '<div style="font-size:9.5px;color:rgba(255,255,255,0.5);margin-bottom:4px;"><span style="color:#444;font-size:8px;">CURRENT → </span>' + escH(s.portfolioImpact) + '</div>' : '') +
            (s.withAllocation  ? '<div style="font-size:9.5px;color:' + GRN + ';"><span style="color:#444;font-size:8px;">WITH ALLOC → </span>' + escH(s.withAllocation) + '</div>' : '') +
          '</div>';
        }).join('') +
      '</div>';
    }

    var iht = data.estateIht;
    if (iht) {
      html += '<div class="sp-section"><div class="sp-sec-lbl" style="color:' + A + ';">ESTATE PLANNING — IHT ASSESSMENT</div>' +
        (iht.estimatedExposure ? '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #181818;font-size:10px;color:#c8c8c8;line-height:1.6;"><span style="color:' + A + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">EXPOSURE</span>' + escH(iht.estimatedExposure) + '</div>' : '') +
        (iht.mitigationOptions && iht.mitigationOptions.length ? '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #181818;font-size:10px;color:#c8c8c8;line-height:1.6;"><span style="color:' + A + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">MITIGATION</span><div>' + iht.mitigationOptions.map(function(m,i){ return '<div style="margin-bottom:4px;">' + (i+1) + '. ' + escH(m) + '</div>'; }).join('') + '</div></div>' : '') +
        (iht.urgencyFlag ? '<div style="display:flex;gap:8px;padding:4px 0;font-size:10px;color:#c8c8c8;line-height:1.6;"><span style="color:' + A + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">TIMING</span>' + escH(iht.urgencyFlag) + '</div>' : '') +
      '</div>';
    }

    var impl = data.implementationPathway;
    if (impl) {
      var implRows = [
        { key: 'recommendedWrapper', label: 'WRAPPER' },
        { key: 'fundingSource',      label: 'FUNDING' },
        { key: 'sequencing',         label: 'SEQUENCE' },
        { key: 'minimumEntry',       label: 'MINIMUM' },
      ];
      html += '<div class="sp-section"><div class="sp-sec-lbl" style="color:' + GRN + ';">IMPLEMENTATION PATHWAY</div>' +
        implRows.map(function(r) {
          return impl[r.key] ? '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #181818;font-size:10px;color:#c8c8c8;line-height:1.6;">' +
            '<span style="color:' + GRN + ';font-size:7px;letter-spacing:.12em;flex-shrink:0;padding-top:2px;min-width:80px;">' + r.label + '</span>' +
            escH(impl[r.key]) + '</div>' : '';
        }).join('') +
      '</div>';
    }

    if (data.technicalVerdict) html +=
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl" style="color:' + BLU + ';">TECHNICAL VERDICT</div>' +
        '<div class="sp-pitch" style="border-left-color:' + BLU + ';color:#c8c8c8;">' + escH(data.technicalVerdict) + '</div>' +
      '</div>';

    return html || '<div style="padding:10px;font-size:10px;color:#555;">Analysis unavailable.</div>';
  }

  function renderCompany(d, body) {
    var isListed = d.ticker && d.ticker.length > 0;
    var pitchBtn = (d.title && isListed) ?
      '<button class="sp-pitch-shortcut" data-title="' + escH(d.title) + '" data-ticker="' + escH(d.ticker || '') + '">▌ PITCH PLAYBOOK</button>' : '';
    var chartBtn = isListed ?
      '<button class="sp-chart-shortcut" data-ticker="' + escH(toYfTicker(d.ticker, d.exchange)) + '" data-name="' + escH(d.title || d.ticker) + '">▦ VIEW CHART</button>' : '';
    body.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<div class="sp-badge ' + (isListed ? 'listed' : 'private') + '" style="margin-bottom:0;">' +
          (isListed ? '● LISTED · ' + escH(d.ticker) + ' · ' + escH(d.exchange || '') : '● PRIVATE COMPANY') +
        '</div>' +
        pitchBtn +
        chartBtn +
      '</div>' +
      '<div class="sp-tagline">' + escH(d.tagline || '') + '</div>' +
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">OVERVIEW</div>' +
        '<div class="sp-text">' + escH(d.overview || '') + '</div>' +
      '</div>' +
      (d.keyFacts && d.keyFacts.length ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">KEY FACTS</div>' +
          '<ul class="sp-facts">' +
            d.keyFacts.map(function (f) { return '<li>' + escH(f) + '</li>'; }).join('') +
          '</ul>' +
        '</div>' : '') +
      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">RELEVANCE TO ALTERNATIVE ASSETS</div>' +
        '<div class="sp-text">' + escH(d.relevance || '') + '</div>' +
      '</div>' +
      (d.brokerNote ?
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">BROKER NOTE</div>' +
          '<div class="sp-pitch">' + escH(d.brokerNote) + '</div>' +
        '</div>' : '') +
      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ ADD NOTE</button>' +
      '</div>';

    /* Wire pitch + chart buttons — renderPopout doesn't call wireNoteBtn for company type */
    wirePitchShortcut(d, body);
    wireChartBtn(d, body);
    cascadeType(body);
  }

  function renderConcept(d, body, win) {
    /* Support both slim (overview field) and legacy full (whatHappened field) formats */
    var overviewText = d.overview || d.whatHappened || '';
    var conceptQuery = d.title || '';

    body.innerHTML =
      '<div class="sp-badge event">● ' + escH(d.period || 'CONCEPT') + '</div>' +
      '<div class="sp-tagline">' + escH(d.tagline || '') + '</div>' +
      '<div class="sp-section"><div class="sp-text">' + escH(overviewText) + '</div></div>' +
      '<div class="concept-sec-bar">' +
        '<button class="concept-sec-btn" data-sec="the-history">THE HISTORY</button>' +
        '<button class="concept-sec-btn" data-sec="the-outcome">THE OUTCOME</button>' +
        '<button class="concept-sec-btn" data-sec="economic-impact">ECONOMIC IMPACT</button>' +
        '<button class="concept-sec-btn" data-sec="hardship-loss">HARDSHIP & LOSS</button>' +
        '<button class="concept-sec-btn" data-sec="pitch-playbook">PITCH PLAYBOOK</button>' +
      '</div>' +
      '<div class="concept-sec-panel"></div>' +
      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ ADD NOTE</button>' +
      '</div>';

    var secPanel = body.querySelector('.concept-sec-panel');
    body.querySelectorAll('.concept-sec-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        body.querySelectorAll('.concept-sec-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        fetchConceptSection(conceptQuery, btn.dataset.sec, secPanel);
      });
    });

    /* Pre-fetch remaining 4 sections silently — the-history is loaded immediately by auto-click below */
    var SECTIONS = ['the-outcome','economic-impact','hardship-loss','pitch-playbook'];
    SECTIONS.forEach(function(sec) { _prefetchConceptSection(conceptQuery, sec); });

    /* Auto-load THE HISTORY — will serve from cache if pre-fetch already completed, else shows loading */
    var firstBtn = body.querySelector('.concept-sec-btn[data-sec="the-history"]');
    if (firstBtn) firstBtn.click();

    cascadeType(body);
  }

  /* ── Silent background pre-fetch — populates cache only, no UI side effects ── */
  function _prefetchConceptSection(conceptTitle, sectionId) {
    var lensKey = (window._assetLens && window._assetLens.key) || 'universal';
    var lensContext = (window._assetLens && window._assetLens.promptContext) || '';
    var cacheKey = 'concept-section:' + sectionId + ':' + conceptTitle.trim().toLowerCase().slice(0, 80);
    if (_cache[cacheKey]) return;
    var headers = { 'Content-Type': 'application/json' };
    if (window._authToken) headers['Authorization'] = 'Bearer ' + window._authToken;

    /* Pitch-playbook: pre-fetch via SSE stream — avoids buffered search.js timeout */
    if (sectionId === 'pitch-playbook' && window.ReadableStream && window.TextDecoder) {
      fetch('/.netlify/functions/search-stream', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ query: conceptTitle, type: 'concept', section: sectionId, lensKey: lensKey, lensContext: lensContext }),
      }).then(function(r) {
        if (!r.ok || !r.body) return;
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var lineBuf = '';
        function readChunk() {
          return reader.read().then(function(chunk) {
            if (chunk.done) return;
            lineBuf += decoder.decode(chunk.value, { stream: true });
            var lines = lineBuf.split('\n'); lineBuf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (!line.startsWith('data: ')) continue;
              var raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
              if (raw.type === 'cache' || raw.type === 'done') {
                if (!_cache[cacheKey]) _cache[cacheKey] = raw.data;
                return;
              }
            }
            return readChunk();
          });
        }
        readChunk().catch(function(){});
      }).catch(function(){});
      return;
    }

    fetch('/.netlify/functions/search', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query: conceptTitle, type: 'concept', section: sectionId, lensKey: lensKey, lensContext: lensContext }),
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) { if (d && !_cache[cacheKey]) _cache[cacheKey] = d; })
    .catch(function(){});
  }

  /* ── Silent background pre-fetch for company pitch playbook ── */
  window._prefetchCompanyPitch = function _prefetchCompanyPitch(query, ticker) {
    var lensKey = (window._assetLens && window._assetLens.key) || 'universal';
    var lensContext = (window._assetLens && window._assetLens.promptContext) || '';
    var cacheKey = 'company:' + lensKey + ':pitch-playbook:' + (ticker || query);
    if (_cache[cacheKey]) return;
    var headers = { 'Content-Type': 'application/json' };
    if (window._authToken) headers['Authorization'] = 'Bearer ' + window._authToken;

    fetch('/.netlify/functions/search-stream', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ query: query, type: 'company', ticker: ticker, section: 'pitch-playbook', lensKey: lensKey, lensContext: lensContext, prefetch: true }),
    }).then(function(r) {
      if (!r.ok || !r.body) return;
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var lineBuf = '';
      function readChunk() {
        return reader.read().then(function(chunk) {
          if (chunk.done) return;
          lineBuf += decoder.decode(chunk.value, { stream: true });
          var lines = lineBuf.split('\n'); lineBuf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.startsWith('data: ')) continue;
            var raw; try { raw = JSON.parse(line.slice(6)); } catch(e) { continue; }
            if (raw.type === 'cache' || raw.type === 'done') {
              if (!_cache[cacheKey]) _cache[cacheKey] = raw.data;
              return;
            }
          }
          return readChunk();
        });
      }
      readChunk().catch(function(){});
    }).catch(function(){});
  };

  /* ── Fetch a concept section on demand ── */
  function fetchConceptSection(conceptTitle, sectionId, panel) {
    var lensKey = (window._assetLens && window._assetLens.key) || 'universal';
    var lensContext = (window._assetLens && window._assetLens.promptContext) || '';
    var cacheKey = 'concept-section:' + sectionId + ':' + conceptTitle.trim().toLowerCase().slice(0, 80);
    if (_cache[cacheKey]) {
      renderConceptSection(_cache[cacheKey], sectionId, panel);
      return;
    }
    var headers = { 'Content-Type': 'application/json' };
    if (window._authToken) headers['Authorization'] = 'Bearer ' + window._authToken;

    /* Pitch-playbook: stream via SSE so content appears as Claude writes */
    if (sectionId === 'pitch-playbook' && window.ReadableStream && window.TextDecoder) {
      panel.innerHTML = '<div class="sp-intel-load">GENERATING PITCH PLAYBOOK<span class="sp-intel-ld"></span></div>';
      var gotDone = false;
      fetch('/.netlify/functions/search-stream', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ query: conceptTitle, type: 'concept', section: sectionId, lensKey: lensKey, lensContext: lensContext }),
      }).then(function(r) {
        if (!r.ok || !r.body) { _pitchFailed(); return; }
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var lineBuf = '';
        function readChunk() {
          return reader.read().then(function(chunk) {
            if (chunk.done) { if (!gotDone) _pitchFailed(); return; }
            lineBuf += decoder.decode(chunk.value, { stream: true });
            var lines = lineBuf.split('\n'); lineBuf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (!line.startsWith('data: ')) continue;
              var raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
              if (raw.type === 'cache' || raw.type === 'done') {
                gotDone = true;
                _cache[cacheKey] = raw.data;
                renderConceptSection(raw.data, sectionId, panel);
                window._loadCreditBalance && window._loadCreditBalance();
                return;
              }
              if (raw.type === 'error') { _pitchFailed(); return; }
            }
            return readChunk();
          });
        }
        readChunk().catch(function() { _pitchFailed(); });
      }).catch(function() { _pitchFailed(); });

      function _pitchFailed() {
        if (!gotDone) panel.innerHTML = '<div class="sp-loading">SECTION UNAVAILABLE — CLICK PITCH PLAYBOOK TO RETRY</div>';
      }
      return;
    }

    panel.innerHTML = '<div class="sp-intel-load">LOADING<span class="sp-intel-ld"></span></div>';
    var retries = 0;
    function attempt() {
      fetch('/.netlify/functions/search', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ query: conceptTitle, type: 'concept', section: sectionId, lensKey: lensKey, lensContext: lensContext }),
      })
      .then(function (r) {
        if (r.status === 402) {
          r.json().then(function (d) { window._showNoCredits && window._showNoCredits(d.balance || 0); });
          panel.innerHTML = '<div class="sp-loading" style="color:#E97132;letter-spacing:.1em;">INSUFFICIENT CREDITS</div>';
          return null;
        }
        if ((r.status === 503 || r.status === 504) && retries < 2) {
          retries++;
          panel.innerHTML = '<div class="sp-intel-load">GENERATING — PLEASE WAIT<span class="sp-intel-ld"></span></div>';
          setTimeout(attempt, 4000);
          return null;
        }
        if (!r.ok) {
          panel.innerHTML = '<div class="sp-loading" style="color:#e05050;">SECTION UNAVAILABLE</div>';
          return null;
        }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        _cache[cacheKey] = d;
        window._loadCreditBalance && window._loadCreditBalance();
        renderConceptSection(d, sectionId, panel);
      })
      .catch(function () {
        panel.innerHTML = '<div class="sp-loading">SECTION UNAVAILABLE</div>';
      });
    }
    attempt();
  }

  function renderConceptSection(d, sectionId, panel) {
    var html = '';
    if (sectionId === 'the-history') {
      html = _renderHistorySection(d);
    } else if (sectionId === 'the-outcome') {
      html = _renderOutcomeSection(d);
    } else if (sectionId === 'economic-impact') {
      html = _renderEconomicSection(d);
    } else if (sectionId === 'hardship-loss') {
      html = _renderHardshipSection(d);
    } else if (sectionId === 'pitch-playbook') {
      html = buildPitchPlaybook(d, d.brokerNote);
    }
    panel.innerHTML = html || '<div class="sp-text">No data available.</div>';
    cascadeType(panel);
  }

  function _renderHistorySection(d) {
    var causesHTML = d.causes && d.causes.length
      ? '<div class="sp-section"><div class="sp-sec-lbl">CAUSES</div><ul class="sp-facts">' +
          d.causes.map(function (c) { return '<li>' + escH(c) + '</li>'; }).join('') +
        '</ul></div>' : '';
    var tlHTML = d.timeline && d.timeline.length
      ? '<div class="sp-section"><div class="sp-sec-lbl">TIMELINE</div><div class="sp-timeline">' +
          d.timeline.map(function (t) {
            return '<div class="sp-tl-row"><div class="sp-tl-date">' + escH(t.date || '') + '</div>' +
              '<div class="sp-tl-evt">' + escH(t.event || '') + '</div></div>';
          }).join('') + '</div></div>' : '';
    return (d.headline ? '<div class="sp-tagline" style="font-size:10px;margin-bottom:8px;">' + escH(d.headline) + '</div>' : '') +
      (d.background ? '<div class="sp-section"><div class="sp-sec-lbl">BACKGROUND</div><div class="sp-text">' + escH(d.background) + '</div></div>' : '') +
      causesHTML + tlHTML;
  }

  function _renderOutcomeSection(d) {
    var changesHTML = d.whatChanged && d.whatChanged.length
      ? '<div class="sp-section"><div class="sp-sec-lbl">WHAT CHANGED</div><ul class="sp-facts">' +
          d.whatChanged.map(function (c) { return '<li>' + escH(c) + '</li>'; }).join('') +
        '</ul></div>' : '';
    return (d.headline ? '<div class="sp-tagline" style="font-size:10px;margin-bottom:8px;">' + escH(d.headline) + '</div>' : '') +
      (d.immediateEffect ? '<div class="sp-section"><div class="sp-sec-lbl">IMMEDIATE EFFECT</div><div class="sp-text">' + escH(d.immediateEffect) + '</div></div>' : '') +
      (d.recovery ? '<div class="sp-section"><div class="sp-sec-lbl">RECOVERY</div><div class="sp-text">' + escH(d.recovery) + '</div></div>' : '') +
      changesHTML;
  }

  function _renderEconomicSection(d) {
    var impactHTML = d.assetImpacts && d.assetImpacts.length
      ? '<div class="sp-section"><div class="sp-sec-lbl">IMPACT BY ASSET CLASS</div><div class="sp-timeline">' +
          d.assetImpacts.map(function (a) {
            return '<div class="sp-tl-row"><div class="sp-tl-date">' + escH(a.asset || '') + '</div>' +
              '<div class="sp-tl-evt">' + escH(a.effect || '') + '</div></div>';
          }).join('') + '</div></div>' : '';
    return (d.headline ? '<div class="sp-tagline" style="font-size:10px;margin-bottom:8px;">' + escH(d.headline) + '</div>' : '') +
      (d.overview ? '<div class="sp-section"><div class="sp-sec-lbl">ECONOMIC TRANSMISSION</div><div class="sp-text">' + escH(d.overview) + '</div></div>' : '') +
      (d.gdpImpact ? '<div class="sp-section"><div class="sp-sec-lbl">GDP & GROWTH</div><div class="sp-text">' + escH(d.gdpImpact) + '</div></div>' : '') +
      impactHTML;
  }

  function _renderHardshipSection(d) {
    var statsHTML = d.statistics && d.statistics.length
      ? '<div class="sp-section"><div class="sp-sec-lbl">KEY STATISTICS</div><div class="sp-timeline">' +
          d.statistics.map(function (s) {
            return '<div class="sp-tl-row"><div class="sp-tl-date">' + escH(s.metric || '') + '</div>' +
              '<div class="sp-tl-evt">' + escH(s.figure || '') + '</div></div>';
          }).join('') + '</div></div>' : '';
    return (d.headline ? '<div class="sp-tagline" style="font-size:10px;margin-bottom:8px;">' + escH(d.headline) + '</div>' : '') +
      (d.overview ? '<div class="sp-section"><div class="sp-sec-lbl">HUMAN IMPACT</div><div class="sp-text">' + escH(d.overview) + '</div></div>' : '') +
      statsHTML +
      (d.pensionImpact ? '<div class="sp-section"><div class="sp-sec-lbl">SAVINGS & PENSIONS</div><div class="sp-text">' + escH(d.pensionImpact) + '</div></div>' : '') +
      (d.globalReach ? '<div class="sp-section"><div class="sp-sec-lbl">GLOBAL REACH</div><div class="sp-text">' + escH(d.globalReach) + '</div></div>' : '');
  }

  /* ── DISTILLERY PANEL ── */
  function sRow(lbl, val) {
    return '<div class="dist-stat-row"><span class="dist-stat-lbl">' + escH(lbl) + '</span><span class="dist-stat-val">' + escH(String(val)) + '</span></div>';
  }

  function renderDistillery(d, wsResults, body, win) {
    /* Widen window if it's still at default narrow width */
    if (win && win.offsetWidth < 460) win.style.width = '460px';
    var region = d.exchange && d.exchange !== 'Private' ? d.exchange : '';
    body.innerHTML =
      '<div class="sp-badge private">● DISTILLERY' + (region ? ' · ' + escH(region) : '') + '</div>' +
      '<div class="sp-tagline">' + escH(d.tagline || '') + '</div>' +
      '<div class="dist-tabs">' +
        '<button class="dist-tab active" data-tab="overview">OVERVIEW</button>' +
        '<button class="dist-tab" data-tab="expressions">EXPRESSIONS' +
          (wsResults.length ? ' <span class="dist-count">' + wsResults.length + '</span>' : '') +
        '</button>' +
        '<button class="dist-tab" data-tab="pitch">PITCH</button>' +
      '</div>' +
      '<div class="dist-panel" data-panel="overview">' +
        '<div class="sp-section"><div class="sp-sec-lbl">OVERVIEW</div><div class="sp-text">' + escH(d.overview || '') + '</div></div>' +
        (d.keyFacts && d.keyFacts.length ?
          '<div class="sp-section"><div class="sp-sec-lbl">KEY FACTS</div><ul class="sp-facts">' +
          d.keyFacts.map(function (f) { return '<li>' + escH(f) + '</li>'; }).join('') +
          '</ul></div>' : '') +
        '<div class="sp-section"><div class="sp-sec-lbl">RELEVANCE TO ALTERNATIVE ASSETS</div><div class="sp-text">' + escH(d.relevance || '') + '</div></div>' +
      '</div>' +
      '<div class="dist-panel" data-panel="expressions" style="display:none;">' +
        buildExpressionsPanel(wsResults) +
      '</div>' +
      '<div class="dist-panel" data-panel="pitch" style="display:none;">' +
        buildPitchPlaybook(d.pitch, d.brokerNote) +
        '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;"><button class="sp-note-btn">✎ ADD NOTE</button></div>' +
      '</div>';

    /* Tab switching */
    body.querySelectorAll('.dist-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        body.querySelectorAll('.dist-tab').forEach(function (t) { t.classList.remove('active'); });
        body.querySelectorAll('.dist-panel').forEach(function (p) { p.style.display = 'none'; });
        tab.classList.add('active');
        var panel = body.querySelector('.dist-panel[data-panel="' + tab.dataset.tab + '"]');
        if (panel) panel.style.display = '';
      });
    });

    /* Expression row click → sidebar */
    body.querySelectorAll('.dist-expr-row').forEach(function (row) {
      row.addEventListener('click', function () {
        body.querySelectorAll('.dist-expr-row').forEach(function (r) { r.classList.remove('dist-expr-active'); });
        row.classList.add('dist-expr-active');
        showExpressionSidebar(win, row.dataset.id, row.dataset.name);
      });
    });

    /* Expression filter input */
    var srch = body.querySelector('.dist-expr-search');
    if (srch) {
      srch.addEventListener('input', function () {
        var q = this.value.toLowerCase();
        body.querySelectorAll('.dist-expr-row').forEach(function (row) {
          row.style.display = (!q || (row.dataset.name || '').toLowerCase().indexOf(q) !== -1) ? '' : 'none';
        });
      });
    }

    /* Load More button — fetches pages 2+3 (2 credits) on demand */
    var loadMoreBtn = body.querySelector('.dist-load-more');
    if (loadMoreBtn && d._wsQ) {
      loadMoreBtn.addEventListener('click', function () {
        loadMoreBtn.textContent = 'LOADING…';
        loadMoreBtn.disabled = true;
        var distWords = d._wsDistWords || [];
        var lsKey     = d._wsLsKey || '';
        Promise.all([
          fetch('/.netlify/functions/whisky-data?type=search&query=' + d._wsQ + '&page=2').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
          fetch('/.netlify/functions/whisky-data?type=search&query=' + d._wsQ + '&page=3').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        ]).then(function (pages) {
          var list = body.querySelector('.dist-expr-list');
          if (!list) return;
          var seen = {};
          body.querySelectorAll('.dist-expr-row').forEach(function (r) { seen[r.dataset.id] = true; });
          var newRows = [];
          pages.forEach(function (ws) {
            if (ws && ws.results) {
              ws.results.forEach(function (r) {
                if (seen[r.whisky_id]) return;
                var n = (r.whisky_name || '').toLowerCase();
                if (!distWords.length || distWords.some(function (w) { return n.indexOf(w) !== -1; })) {
                  seen[r.whisky_id] = true;
                  newRows.push(r);
                }
              });
            }
          });
          /* Append new rows */
          newRows.forEach(function (r) {
            var div = document.createElement('div');
            div.innerHTML = buildExprRow(r);
            var row = div.firstChild;
            list.appendChild(row);
            row.addEventListener('click', function () {
              body.querySelectorAll('.dist-expr-row').forEach(function (x) { x.classList.remove('dist-expr-active'); });
              row.classList.add('dist-expr-active');
              showExpressionSidebar(win, row.dataset.id, row.dataset.name);
            });
          });
          loadMoreBtn.parentNode.removeChild(loadMoreBtn);
          /* Update cache with full set */
          var allResults = (d._wsResults || []).concat(newRows);
          d._wsResults = allResults;
          _cache['ws:' + (d.title || '')] = allResults;
          if (lsKey) lsSet(lsKey, allResults);
          /* Update tab count */
          var countEl = body.querySelector('.dist-count');
          if (countEl) countEl.textContent = allResults.length;
        });
      });
    }
  }

  function buildExprRow(r) {
    var name = r.whisky_name || '';
    var tags = [];
    var ageM = name.match(/(\d+)[\s-]?year[\s-]?old/i) || name.match(/(\d+)\s*yo\b/i);
    if (ageM) tags.push(ageM[1] + 'YO');
    var vinM = name.match(/(?:d\.?|vintage\s*)(\d{4})/i) || name.match(/\b(19[3-9]\d|20[0-2]\d)\b/);
    if (vinM && !ageM) tags.push(vinM[1]);
    var szM = name.match(/\((\d+(?:\.\d+)?(?:ml|l|cl))\)/i);
    if (szM) tags.push(szM[1].toLowerCase());
    var rating = r.rating || r.whiskybase_rating || r.score || null;
    var price  = r.avg_price || r.latest_price || r.avg_auction_price || null;
    var metaParts = [];
    if (tags.length) metaParts.push(tags.join(' · '));
    if (rating) metaParts.push('★ ' + rating);
    if (price)  metaParts.push('£' + Math.round(price).toLocaleString('en-GB'));
    var meta = metaParts.join('  ');
    return '<div class="dist-expr-row" data-id="' + escH(r.whisky_id) + '" data-name="' + escH(name) + '">' +
      '<div class="dist-expr-img-wrap">' +
        (r.whisky_image_url
          ? '<img src="' + escH(r.whisky_image_url) + '" class="dist-expr-img" onerror="this.style.display=\'none\'" />'
          : '<div class="dist-expr-img-ph">▣</div>') +
      '</div>' +
      '<div class="dist-expr-info">' +
        '<div class="dist-expr-name">' + escH(name) + '</div>' +
        '<div class="dist-expr-meta">' + (meta ? escH(meta) : escH(r.whisky_id)) + '</div>' +
      '</div>' +
      '<div class="dist-expr-arrow">›</div>' +
    '</div>';
  }

  function buildExpressionsPanel(results) {
    if (!results || !results.length) {
      return '<div style="padding:20px;font-size:9px;letter-spacing:.18em;color:#fff;opacity:.4;text-align:center;">NO EXPRESSIONS FOUND</div>';
    }
    var rows = results.map(buildExprRow).join('');
    return '<div class="dist-expr-search-wrap"><input class="dist-expr-search" placeholder="▸  FILTER EXPRESSIONS…" /></div>' +
      '<div class="dist-expr-list">' + rows + '</div>' +
      '<button class="dist-load-more">▸ LOAD MORE EXPRESSIONS</button>';
  }

  /* ── EXPRESSION SIDEBAR ── */
  var _exprSidebar = null;

  function showExpressionSidebar(win, whiskyId, whiskyName) {
    /* Remove old sidebar */
    if (_exprSidebar && _exprSidebar.parentNode) _exprSidebar.parentNode.removeChild(_exprSidebar);

    var wr = win.getBoundingClientRect();
    var sidebar = document.createElement('div');
    sidebar.className = 'intel-popwin';
    sidebar.style.cssText = 'position:fixed;top:' + wr.top + 'px;left:' + (wr.right + 4) + 'px;' +
      'width:310px;height:' + wr.height + 'px;z-index:9600;min-width:260px;min-height:200px;max-width:none;max-height:none;';
    sidebar.innerHTML =
      '<div class="intel-popwin-titlebar dist-sidebar-bar">' +
        '<span class="intel-popwin-icon">▣</span>' +
        '<span class="intel-popwin-title">' + escH(whiskyName) + '</span>' +
        '<button class="intel-popwin-close dist-sidebar-close">✕</button>' +
      '</div>' +
      '<div class="intel-popwin-body dist-sidebar-body">' +
        '<div class="sp-loading">LOADING…</div>' +
      '</div>';

    document.body.appendChild(sidebar);
    _exprSidebar = sidebar;

    var bar = sidebar.querySelector('.dist-sidebar-bar');
    makeDraggable(sidebar, bar);
    makeResizablePop(sidebar);

    sidebar.querySelector('.dist-sidebar-close').addEventListener('click', function () {
      if (sidebar.parentNode) sidebar.parentNode.removeChild(sidebar);
      _exprSidebar = null;
    });

    /* Fetch browse (details + rating) — 3 TBT tokens; free if already cached */
    var sBody = sidebar.querySelector('.dist-sidebar-body');
    var bLsKey = 'b_' + whiskyId;
    var bCached = lsGet(bLsKey) || _cache['browse:' + whiskyId];
    if (bCached) {
      renderExpressionDetail(bCached, sBody, whiskyId);
    } else {
      _gateCredits(3, 'WS browse: ' + whiskyName, function () {
        fetch('/.netlify/functions/whisky-data?type=browse&id=' + encodeURIComponent(whiskyId))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (!data || data.error) {
              sBody.innerHTML = '<div class="sp-loading">' + (data && data.error ? 'API ERROR: ' + escH(data.error) : 'DATA UNAVAILABLE') + '</div>';
              return;
            }
            _cache['browse:' + whiskyId] = data;
            lsSet(bLsKey, data);
            window._loadCreditBalance && window._loadCreditBalance();
            renderExpressionDetail(data, sBody, whiskyId);
          })
          .catch(function () { sBody.innerHTML = '<div class="sp-loading">DATA UNAVAILABLE</div>'; });
      });
    }
  }

  function renderExpressionDetail(data, sBody, whiskyId) {
    var det = data.details || {};
    var rat = data.rating  || {};
    var bgId = data.bg_id  || whiskyId;

    var fullName = [(det.bottler_serie || ''), (det.name || '')].filter(Boolean).join(' ');
    var meta = [det.region, det.age ? det.age + ' YO' : null, det.vintage ? 'Vintage ' + det.vintage : null].filter(Boolean).join(' · ');

    sBody.innerHTML =
      (meta ? '<div class="sp-badge private">● ' + escH(meta) + '</div>' : '') +
      '<div class="sp-tagline" style="font-size:11px;">' + escH(fullName) + '</div>' +
      '<div class="dist-stat-block">' +
        (det.distillery  ? sRow('DISTILLERY', det.distillery)  : '') +
        (det.age         ? sRow('AGE',        det.age + ' Years') : '') +
        (det.vintage     ? sRow('VINTAGE',    det.vintage)     : '') +
        (det.region      ? sRow('REGION',     det.region)      : '') +
        (det.cask_type   ? sRow('CASK',       det.cask_type)   : '') +
        (det.abv         ? sRow('ABV',        det.abv + '%')   : '') +
        (rat.whiskybase_rating != null ? sRow('COMMUNITY SCORE', rat.whiskybase_rating + ' / 100') : '') +
      '</div>' +
      '<div class="sp-sec-lbl" style="margin-top:10px;">PRICE HISTORY</div>' +
      '<canvas id="expr-chart-' + escH(whiskyId) + '" style="width:100%;height:120px;display:block;margin:4px 0;"></canvas>' +
      '<div id="expr-mkt-' + escH(whiskyId) + '">' +
        '<button class="dist-load-prices" data-bg="' + escH(bgId) + '" data-canvas="expr-chart-' + escH(whiskyId) + '" data-mkt="expr-mkt-' + escH(whiskyId) + '">' +
          '▸ LOAD PRICES + CHART' +
        '</button>' +
      '</div>';

    /* Wire load prices button */
    var btn = sBody.querySelector('.dist-load-prices');
    if (btn) {
      btn.addEventListener('click', function () {
        var bgId2 = btn.dataset.bg;
        var canvasId = btn.dataset.canvas;
        var mktId = btn.dataset.mkt;
        /* Check localStorage first — market/history are expensive (15 WS credits = 40 TBT) */
        var mLsKey = 'm_' + bgId2;
        var hLsKey = 'h_' + bgId2;
        var mCached = lsGet(mLsKey), hCached = lsGet(hLsKey);
        var needsFetch = !mCached || !hCached;
        function _doLoadPrices() {
          btn.textContent = 'LOADING…';
          btn.disabled = true;
          Promise.all([
          mCached ? Promise.resolve(mCached) : fetch('/.netlify/functions/whisky-data?type=market&id='  + encodeURIComponent(bgId2) + '&currency=GBP').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
          hCached ? Promise.resolve(hCached) : fetch('/.netlify/functions/whisky-data?type=history&id=' + encodeURIComponent(bgId2) + '&currency=GBP').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        ]).then(function (res) {
          var mkt  = res[0];
          var hist = res[1];
          /* Persist to localStorage if freshly fetched */
          if (!mCached && mkt && !mkt.error) lsSet(mLsKey, mkt);
          if (!hCached && hist)              lsSet(hLsKey, hist);

          /* Credit exhaustion check */
          var creditErr = (mkt && mkt.error && /credit/i.test(mkt.error));
          var mktEl = document.getElementById(mktId);
          if (creditErr) {
            if (mktEl) mktEl.innerHTML = '<div style="font-size:9px;letter-spacing:.12em;color:#E97132;padding:6px 0;">⚠ INSUFFICIENT CREDITS — PLEASE TOP UP</div>';
            return;
          }
          if (mktEl) {
            var auc    = (mkt && mkt.auction) || {};
            var lat    = auc.latest_auction_price || {};
            var m12    = auc.latest_12m || {};
            var atMax  = auc.max_auction_price || {};
            var ret    = (mkt && mkt.retail) || {};

            /* Correct field names from WhiskyStats API */
            var latAvg  = lat.buyer_price_avg;
            var latMin  = lat.buyer_price_min;
            var latMax  = lat.buyer_price_max;
            var latDate = (lat.price_date || '').slice(0, 7); /* YYYY-MM */
            var m12Avg  = m12.buyer_price_avg;
            var m12Min  = m12.buyer_price_min;
            var m12Max  = m12.buyer_price_max;
            var m12Chg  = m12.market_value_change_pct;
            var allMax  = atMax.buyer_price;
            var retAvg  = ret.retail_price_avg;
            var retMin  = ret.retail_price_min;
            var retMax  = ret.retail_price_max;

            var chgStr  = m12Chg != null ? (m12Chg >= 0 ? '+' : '') + Math.round(m12Chg * 100) + '% YOY' : '';

            mktEl.innerHTML =
              '<div class="sp-sec-lbl" style="margin-top:8px;">AUCTION PRICES' + (chgStr ? ' <span style="color:' + (m12Chg >= 0 ? '#4caf50' : '#e97132') + ';font-size:7px;">' + escH(chgStr) + '</span>' : '') + '</div>' +
              '<div class="dist-stat-block">' +
                (latAvg  != null ? sRow('LAST SALE',  '£' + Math.round(latAvg).toLocaleString('en-GB') + (latDate ? '  ' + latDate : '')) : '') +
                (m12Avg  != null ? sRow('12M AVG',    '£' + Math.round(m12Avg).toLocaleString('en-GB')) : '') +
                (m12Min  != null ? sRow('12M RANGE',  '£' + Math.round(m12Min).toLocaleString('en-GB') + ' – £' + Math.round(m12Max).toLocaleString('en-GB')) : '') +
                (allMax  != null ? sRow('ALL-TIME HIGH','£' + Math.round(allMax).toLocaleString('en-GB') + (atMax.price_date ? '  ' + atMax.price_date.slice(0,7) : '')) : '') +
                (retAvg  != null ? sRow('RETAIL',     '£' + Math.round(retAvg).toLocaleString('en-GB') + (retMin !== retMax ? '  (' + Math.round(retMin).toLocaleString('en-GB') + '–' + Math.round(retMax).toLocaleString('en-GB') + ')' : '')) : '') +
              '</div>';

            /* ── On-demand listing buttons ── */
            var listBtnWrap = document.createElement('div');
            listBtnWrap.style.cssText = 'display:flex;gap:6px;margin-top:10px;';
            listBtnWrap.innerHTML =
              '<button class="dist-list-btn" data-listtype="auction_listings" style="flex:1;font-size:8px;letter-spacing:.1em;padding:5px 4px;background:#111;border:1px solid #222;color:#E97132;cursor:pointer;">▸ LIVE LOTS</button>' +
              '<button class="dist-list-btn" data-listtype="retail_listings"  style="flex:1;font-size:8px;letter-spacing:.1em;padding:5px 4px;background:#111;border:1px solid #222;color:#4caf50;cursor:pointer;">▸ RETAIL SHOPS</button>';
            mktEl.appendChild(listBtnWrap);

            listBtnWrap.querySelectorAll('.dist-list-btn').forEach(function (lb) {
              lb.addEventListener('click', function () {
                var ltype = lb.dataset.listtype;
                var isAuction = ltype === 'auction_listings';
                /* Gate: 20 TBT credits per listing fetch (7 WS credits = ~5.9p) */
                function _doListFetch() {
                  lb.textContent = 'LOADING…';
                  lb.disabled = true;
                  var url = '/.netlify/functions/whisky-data?type=' + ltype + '&id=' + encodeURIComponent(bgId2) + (isAuction ? '' : '&currency=GBP');
                  fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
                  var lots = (data && Array.isArray(data.listings)) ? data.listings : [];
                  lb.remove();
                  if (!lots.length) {
                    var none = document.createElement('div');
                    none.style.cssText = 'font-size:8px;color:#555;padding:4px 0;letter-spacing:.08em;';
                    none.textContent = isAuction ? 'NO LIVE AUCTION LOTS' : 'NO RETAIL LISTINGS';
                    mktEl.appendChild(none);
                    return;
                  }
                  var html = '<div class="sp-sec-lbl" style="margin-top:8px;">' + (isAuction ? 'LIVE AUCTION LOTS <span style="color:#E97132;font-size:7px;">' + lots.length + ' ACTIVE</span>' : 'RETAIL SHOPS <span style="color:#4caf50;font-size:7px;">' + lots.length + ' LISTINGS</span>') + '</div>';
                  (isAuction ? lots.slice(0, 6) : lots.slice(0, 5)).forEach(function (lot) {
                    if (isAuction) {
                      var ends = lot.end_date ? lot.end_date.slice(0, 10) : '';
                      html += '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #111;font-size:9px;">' +
                        '<span style="color:rgba(255,255,255,0.85);">' + escH(lot.auction_name || lot.auction_house || '') + '</span>' +
                        '<span style="color:#E97132;">' + (ends ? 'ENDS ' + ends : '') + '</span></div>';
                    } else {
                      var price = lot.price != null ? '£' + Math.round(lot.price).toLocaleString('en-GB') : '';
                      html += '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #111;font-size:9px;">' +
                        '<span style="color:rgba(255,255,255,0.85);">' + escH(lot.shop_name || '') + '</span>' +
                        '<span style="color:#4caf50;">' + escH(price) + '</span></div>';
                    }
                  });
                  var el = document.createElement('div');
                  el.innerHTML = html;
                  mktEl.appendChild(el);
                }).catch(function () { lb.textContent = isAuction ? '▸ LIVE LOTS' : '▸ RETAIL SHOPS'; lb.disabled = false; });
                } /* end _doListFetch */
                if (window._deductCredits) {
                  window._deductCredits(20, 'WS ' + ltype + ': ' + bgId2).then(function (result) {
                    if (!result.ok && result.status === 402) {
                      window._showNoCredits && window._showNoCredits(result.balance || 0);
                      return;
                    }
                    _doListFetch();
                  });
                } else {
                  _doListFetch();
                }
              });
            });
          }
          var canvas = document.getElementById(canvasId);
          if (canvas) {
            var dpr = window.devicePixelRatio || 1;
            var cw = canvas.offsetWidth || 280;
            var ch = 120;
            canvas.width  = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
            canvas.style.width  = cw + 'px';
            canvas.style.height = ch + 'px';
            /* Use full history if available, else fall back to 12m summary */
            if (hist && !hist._tbt_empty) {
              drawExpressionChart(canvas, hist, dpr);
            } else {
              draw12mRangeChart(canvas, auc, dpr);
            }
          }
        });
        } /* end _doLoadPrices */

        /* Always charge 40 TBT credits — cache only protects OUR WS API credits, not the user */
        if (window._deductCredits) {
          window._deductCredits(40, 'WS prices+chart: ' + bgId2).then(function (result) {
            if (!result.ok && result.status === 402) {
              window._showNoCredits && window._showNoCredits(result.balance || 0);
              return;
            }
            _doLoadPrices();
          });
        } else {
          _doLoadPrices();
        }
      });
    }
  }

  function drawExpressionChart(canvas, histData, dpr) {
    if (!canvas) return;
    dpr = dpr || 1;
    /* Extract series from various WhiskyStats response shapes */
    var points = [];
    if (Array.isArray(histData)) { points = histData; }
    else {
      var tryKeys = ['prices', 'auction_price_history', 'auction_prices', 'price_history', 'history', 'results', 'data', 'records', 'items', 'sales'];
      for (var k = 0; k < tryKeys.length; k++) {
        if (histData && Array.isArray(histData[tryKeys[k]])) { points = histData[tryKeys[k]]; break; }
      }
    }
    var series = [];
    points.forEach(function (p) {
      var v = parseFloat(p.price || p.avg_price || p.hammer_price || p.avg || p.value || p.v || 0);
      var d = p.date || p.sale_date || p.auction_date || p.d || p.sold_date || p.month || '';
      if (!d && p.timestamp) d = new Date(p.timestamp * 1000).toISOString().split('T')[0];
      if (v > 0 && d) series.push({ d: d, v: v });
    });
    series.sort(function (a, b) { return a.d < b.d ? -1 : 1; });

    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    if (!series.length) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#444';
      ctx.font = (9 * dpr) + 'px Consolas';
      ctx.textAlign = 'center';
      ctx.fillText('NO PRICE HISTORY', W / 2, H / 2);
      return;
    }

    var vals = series.map(function (p) { return p.v; });
    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
    var rng  = maxV - minV || 1;
    var pL = 8 * dpr, pR = 8 * dpr, pT = 10 * dpr, pB = 18 * dpr;
    var cW = W - pL - pR, cH = H - pT - pB;
    var n = series.length;

    function xp(i)  { return pL + (n > 1 ? (i / (n - 1)) * cW : cW / 2); }
    function yp(v)  { return pT + cH - ((v - minV) / rng) * cH; }

    /* Grid line at midpoint */
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.moveTo(pL, pT + cH / 2);
    ctx.lineTo(pL + cW, pT + cH / 2);
    ctx.stroke();

    /* Fill area */
    ctx.beginPath();
    ctx.moveTo(xp(0), pT + cH);
    series.forEach(function (p, i) { ctx.lineTo(xp(i), yp(p.v)); });
    ctx.lineTo(xp(n - 1), pT + cH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(233,113,50,0.10)';
    ctx.fill();

    /* Line */
    ctx.beginPath();
    series.forEach(function (p, i) { i === 0 ? ctx.moveTo(xp(i), yp(p.v)) : ctx.lineTo(xp(i), yp(p.v)); });
    ctx.strokeStyle = '#E97132';
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* Last dot */
    ctx.beginPath();
    ctx.arc(xp(n - 1), yp(series[n - 1].v), 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#E97132';
    ctx.fill();

    /* Price labels */
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = (8 * dpr) + 'px Consolas';
    ctx.textAlign = 'left';
    ctx.fillText('£' + Math.round(minV).toLocaleString('en-GB'), pL, H - 2 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText('£' + Math.round(maxV).toLocaleString('en-GB'), W - pR, pT + 8 * dpr);
  }

  /* Full-width horizontal box-plot for 12m summary data */
  function draw12mRangeChart(canvas, auc, dpr) {
    if (!canvas || !auc) return;
    dpr = dpr || 1;
    var m12  = auc.latest_12m || {};
    var minV = m12.buyer_price_min;
    var q1V  = m12.buyer_price_qrt1;
    var q3V  = m12.buyer_price_qrt3;
    var avgV = m12.buyer_price_avg;
    var maxV = m12.buyer_price_max;
    var latV = (auc.latest_auction_price || {}).buyer_price_avg;
    var allV = (auc.max_auction_price    || {}).buyer_price;
    if (minV == null || maxV == null) {
      var ctx0 = canvas.getContext('2d');
      ctx0.fillStyle = '#1a1a1a'; ctx0.fillRect(0, 0, canvas.width, canvas.height);
      ctx0.fillStyle = '#444'; ctx0.font = (9 * dpr) + 'px Consolas';
      ctx0.textAlign = 'center';
      ctx0.fillText('NO PRICE DATA', canvas.width / 2, canvas.height / 2);
      return;
    }
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, W, H);

    var pL = 10 * dpr, pR = 10 * dpr, pT = 16 * dpr, pB = 20 * dpr;
    var cW = W - pL - pR;
    /* Horizontal scale: include all-time high if > max */
    var scaleMin = minV * 0.96;
    var scaleMax = Math.max(allV || 0, maxV) * 1.04;
    var rng = scaleMax - scaleMin || 1;
    function xv(v) { return pL + ((v - scaleMin) / rng) * cW; }

    /* Bar geometry — centred vertically */
    var barMid = pT + (H - pT - pB) / 2;
    var barH   = Math.round((H - pT - pB) * 0.38);

    /* Background track: min → max */
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(xv(minV), barMid - barH / 2, xv(maxV) - xv(minV), barH);

    /* IQR box: Q1 → Q3 */
    if (q1V != null && q3V != null) {
      ctx.fillStyle = 'rgba(233,113,50,0.18)';
      ctx.fillRect(xv(q1V), barMid - barH / 2, xv(q3V) - xv(q1V), barH);
      ctx.strokeStyle = 'rgba(233,113,50,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xv(q1V), barMid - barH / 2, xv(q3V) - xv(q1V), barH);
    }

    /* Whisker lines: min→Q1 and Q3→max */
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    if (q1V != null) {
      ctx.beginPath(); ctx.moveTo(xv(minV), barMid); ctx.lineTo(xv(q1V), barMid); ctx.stroke();
    }
    if (q3V != null) {
      ctx.beginPath(); ctx.moveTo(xv(q3V), barMid); ctx.lineTo(xv(maxV), barMid); ctx.stroke();
    }

    /* End ticks */
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    [minV, maxV].forEach(function (v) {
      ctx.beginPath();
      ctx.moveTo(xv(v), barMid - barH / 2);
      ctx.lineTo(xv(v), barMid + barH / 2);
      ctx.stroke();
    });

    /* Avg vertical line — full bar height + overshoot */
    if (avgV != null) {
      ctx.strokeStyle = '#E97132';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(xv(avgV), barMid - barH / 2 - 4 * dpr);
      ctx.lineTo(xv(avgV), barMid + barH / 2 + 4 * dpr);
      ctx.stroke();
    }

    /* Latest sale dot */
    if (latV != null) {
      ctx.beginPath();
      ctx.arc(xv(latV), barMid, 4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#E97132'; ctx.fill();
      /* Dot label above */
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = (7 * dpr) + 'px Consolas';
      ctx.textAlign = 'center';
      ctx.fillText('LAST', xv(latV), barMid - barH / 2 - 8 * dpr);
    }

    /* All-time high dashed vertical */
    if (allV && allV > maxV) {
      ctx.setLineDash([2 * dpr, 3 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      var ax = Math.min(xv(allV), W - pR - 1);
      ctx.beginPath(); ctx.moveTo(ax, pT); ctx.lineTo(ax, H - pB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = (6.5 * dpr) + 'px Consolas';
      ctx.textAlign = 'right';
      ctx.fillText('ATH', ax - 2 * dpr, pT + 8 * dpr);
    }

    /* Bottom labels: min — avg — max */
    ctx.font = (7.5 * dpr) + 'px Consolas';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'left';
    ctx.fillText('£' + Math.round(minV).toLocaleString('en-GB'), pL, H - 3 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText('£' + Math.round(maxV).toLocaleString('en-GB'), W - pR, H - 3 * dpr);
    if (avgV != null) {
      ctx.fillStyle = '#E97132';
      ctx.textAlign = 'center';
      ctx.fillText('AVG £' + Math.round(avgV).toLocaleString('en-GB'), xv(avgV), H - 3 * dpr);
    }

    /* Header */
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = (6.5 * dpr) + 'px Consolas';
    ctx.textAlign = 'left';
    ctx.fillText('12-MONTH RANGE', pL, pT - 5 * dpr);
  }

  /* ── DRAGGABLE ── */
  function makeDraggable(win, handle) {
    var ox = 0, oy = 0, sx = 0, sy = 0;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      if (_popDir(win, e)) return; /* let border-resize handle it instead */
      e.preventDefault();
      sx = e.clientX; sy = e.clientY;
      var r = win.getBoundingClientRect();
      /* Use canvas-relative offsetLeft/Top when inside the canvas (offsetParent set),
         viewport r.left/top for fixed body-appended popouts (offsetParent null) */
      if (win.offsetParent) {
        ox = win.offsetLeft; oy = win.offsetTop;
      } else {
        ox = r.left; oy = r.top;
      }
      var _hasMoved = false;
      function onMove(e) {
        var rawL = ox + e.clientX - sx, rawT = oy + e.clientY - sy;
        if (window._snapPosition) {
          var snapped = window._snapPosition(win, rawL, rawT);
          win.style.left = snapped.left + 'px';
          win.style.top  = snapped.top  + 'px';
        } else {
          win.style.left = rawL + 'px';
          win.style.top  = rawT + 'px';
        }
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (!_hasMoved && dx*dx + dy*dy > 100) _hasMoved = true;
        /* Drop-zone detection: header-only hit-test, includes canvas widgets */
        if (_hasMoved && win.classList.contains('intel-popwin')) {
          var cx = e.clientX, cy = e.clientY;
          var newTarget = null;
          document.querySelectorAll('.intel-popwin, .intel-tab-group, .tbc-widget').forEach(function (t) {
            if (t === win) return;
            var hdr = t.querySelector('.intel-popwin-titlebar, .intel-tg-bar, .tbc-widget-bar');
            if (!hdr) return;
            var tr = hdr.getBoundingClientRect();
            if (cx > tr.left && cx < tr.right && cy > tr.top && cy < tr.bottom) newTarget = t;
          });
          document.querySelectorAll('.intel-drop-target').forEach(function (t) { t.classList.remove('intel-drop-target'); });
          if (newTarget) newTarget.classList.add('intel-drop-target');
          window._popwinDropTarget = newTarget;
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.querySelectorAll('.intel-drop-target').forEach(function (t) { t.classList.remove('intel-drop-target'); });
        /* Persist position */
        if (win._popId && _registry[win._popId]) {
          _registry[win._popId].x = win.offsetLeft;
          _registry[win._popId].y = win.offsetTop;
          _saveIntelState();
        }
        /* Merge if dropped on another window */
        if (_hasMoved && win.classList.contains('intel-popwin') && window._popwinDropTarget) {
          var target = window._popwinDropTarget;
          window._popwinDropTarget = null;
          if (target.classList.contains('intel-tab-group') && target._addTab) {
            target._addTab(win._itTitle || 'PANEL', win.querySelector('.intel-popwin-body'));
            win.remove();
          } else if (target.classList.contains('intel-popwin')) {
            mergeIntoGroup(win, target);
          } else if (target.classList.contains('tbc-widget') && target._tbcPopout) {
            /* Pop the canvas widget out, then group both together */
            var canvasPopwin = target._tbcPopout();
            if (canvasPopwin) mergeIntoGroup(win, canvasPopwin);
          }
        } else {
          window._popwinDropTarget = null;
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ── RESIZABLE (all edges/corners via border detection) ── */
  var _RM = 10; /* resize margin px */
  function _popDir(win, e) {
    var r = win.getBoundingClientRect();
    var n = e.clientY - r.top    < _RM;
    var s = r.bottom - e.clientY < _RM;
    var w = e.clientX - r.left   < _RM;
    var east = r.right - e.clientX < _RM;
    if (!n && !s && !w && !east) return null;
    return {north:n, south:s, west:w, east:east};
  }
  function _popCur(d) {
    if (!d) return '';
    if (d.north && d.west) return 'nw-resize';
    if (d.north && d.east) return 'ne-resize';
    if (d.south && d.west) return 'sw-resize';
    if (d.south && d.east) return 'se-resize';
    if (d.north) return 'n-resize';
    if (d.south) return 's-resize';
    if (d.west)  return 'w-resize';
    if (d.east)  return 'e-resize';
    return '';
  }
  function makeResizablePop(win) {
    win.addEventListener('mousemove', function (e) {
      var d = _popDir(win, e);
      if (d) { win.style.cursor = _popCur(d); return; } /* edge wins over titlebar */
      if (e.target.closest('.intel-popwin-titlebar, .intel-tg-bar')) { win.style.cursor = ''; return; }
      win.style.cursor = '';
    });
    win.addEventListener('mouseleave', function () { win.style.cursor = ''; });
    win.addEventListener('mousedown', function (e) {
      var d = _popDir(win, e);
      if (!d) return;
      if (e.target.closest('button, a')) return;
      e.preventDefault(); e.stopPropagation();
      var r  = win.getBoundingClientRect();
      var sw = r.width,  sh = r.height;
      var sl = r.left,   st = r.top;
      var sx = e.clientX,       sy = e.clientY;
      var cur = _popCur(d);
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:' + cur + ';';
      document.body.appendChild(ov);
      function onMove(e) {
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (d.east)  win.style.width  = Math.max(320, sw + dx) + 'px';
        if (d.south) win.style.height = Math.max(200, sh + dy) + 'px';
        if (d.west)  { var nw = Math.max(320, sw - dx); win.style.width = nw + 'px'; win.style.left = (win.offsetLeft + win.offsetWidth - nw) + 'px'; }
        if (d.north) { var nh = Math.max(200, sh - dy); win.style.height = nh + 'px'; win.style.top  = (win.offsetTop  + win.offsetHeight - nh) + 'px'; }
      }
      function onUp() {
        ov.remove();
        /* Persist size/position */
        if (win._popId && _registry[win._popId]) {
          _registry[win._popId].x = win.offsetLeft;
          _registry[win._popId].y = win.offsetTop;
          _registry[win._popId].w = win.offsetWidth;
          _registry[win._popId].h = win.offsetHeight;
          _saveIntelState();
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ── HTML ESCAPE ── */
  function escH(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escQ(s) {
    return String(s || '').replace(/'/g,"\\'").replace(/\\/g,'\\\\');
  }

  /* ── INIT ── */
  window.intelSearchInit = buildSearchBar;

  /* ── EXPOSE POPOUT UTILITIES FOR CROSS-MODULE USE ── */
  window._popwinDrag      = makeDraggable;
  window._popwinResize    = makeResizablePop;
  window._mergeIntoGroup  = mergeIntoGroup;

  /* Show the GROUP picker for any intel-popwin element */
  window._popwinGroupPicker = function (win) {
    var others = document.querySelectorAll('.intel-popwin, .intel-tab-group');
    var candidates = Array.from(others).filter(function (el) { return el !== win; });
    if (!candidates.length) return;

    var picker = document.createElement('div');
    picker.className = 'intel-group-picker';
    picker.style.cssText = 'position:fixed;background:#0d0d0d;border:1px solid #E97132;border-top:2px solid #E97132;z-index:99999;min-width:200px;';
    var rect = win.getBoundingClientRect();
    picker.style.top  = (rect.top + 36) + 'px';
    picker.style.left = rect.left + 'px';
    picker.innerHTML = '<div style="font-size:7px;letter-spacing:.22em;color:#555;padding:8px 12px 4px;text-transform:uppercase;">MERGE WITH:</div>';

    candidates.forEach(function (other) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:9px 14px;font-size:10px;color:#ccc;cursor:pointer;border-bottom:1px solid #111;font-family:Consolas,Menlo,monospace;letter-spacing:.04em;';
      item.textContent = other._itTitle || (other.querySelector('.intel-popwin-title,.intel-tg-tab.active') || {}).textContent || 'PANEL';
      item.addEventListener('mouseenter', function () { item.style.background = '#161616'; item.style.color = '#E97132'; });
      item.addEventListener('mouseleave', function () { item.style.background = ''; item.style.color = '#ccc'; });
      item.addEventListener('click', function () {
        picker.remove();
        if (other.classList.contains('intel-tab-group')) {
          /* Add win as a new tab to the existing group */
          other._addTab && other._addTab(win._itTitle || 'PANEL', win.querySelector('.intel-popwin-body'));
          win.remove();
        } else {
          mergeIntoGroup(win, other);
        }
      });
      picker.appendChild(item);
    });

    document.body.appendChild(picker);
    setTimeout(function () {
      document.addEventListener('click', function close() {
        picker.remove();
        document.removeEventListener('click', close);
      });
    }, 10);
  };

  /* Create a generic floating popout window */
  window.createGenericPopout = function (title, icon, populateFn, opts) {
    opts = opts || {};
    window._sharedZ = window._sharedZ || 1000;
    var win = document.createElement('div');
    win.className = 'intel-popwin' + (opts.extraClass ? ' ' + opts.extraClass : '');
    win._itTitle = (icon ? icon + ' ' : '') + title.toUpperCase();

    var x = opts.x != null ? opts.x : (160 + Math.random() * 60);
    var y = opts.y != null ? opts.y : (80  + Math.random() * 40);
    var w = opts.w || 420;
    var h = opts.h || 500;
    win.style.cssText = 'top:' + y + 'px;left:' + x + 'px;width:' + w + 'px;height:' + h + 'px;z-index:' + (++window._sharedZ) + ';';

    win.innerHTML =
      '<div class="intel-popwin-titlebar">' +
        '<span class="intel-popwin-icon">' + escH(icon || '◆') + '</span>' +
        '<span class="intel-popwin-title">' + escH(title.toUpperCase()) + '</span>' +
        '<div style="display:flex;gap:4px;margin-left:auto;align-items:center;">' +
          '<button class="intel-popwin-btn gen-zoom-out" title="Zoom out">−</button>' +
          '<button class="intel-popwin-btn gen-zoom-in"  title="Zoom in">+</button>' +
          '<button class="intel-popwin-btn intel-popwin-group" title="Group with another panel">⊞ GROUP</button>' +
          '<button class="intel-popwin-close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="intel-popwin-body" style="overflow-y:auto;display:flex;flex-direction:column;"></div>';

    document.body.appendChild(win);

    var body = win.querySelector('.intel-popwin-body');
    populateFn(body);

    makeDraggable(win, win.querySelector('.intel-popwin-titlebar'));
    makeResizablePop(win);
    win.addEventListener('mousedown', function () { window._sharedZ++; win.style.zIndex = window._sharedZ; });
    win.addEventListener('wheel', function (e) {
      e.stopPropagation();
      var el = e.target;
      while (el && el !== win) {
        var oy = window.getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') {
          var atTop = el.scrollTop <= 0;
          var atBot = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if (!((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBot))) return;
        }
        el = el.parentElement;
      }
      e.preventDefault();
      var b = win.querySelector('.intel-popwin-body');
      if (b) b.scrollTop += e.deltaY;
    }, { passive: false });

    win.querySelector('.intel-popwin-group').addEventListener('click', function (e) {
      e.stopPropagation();
      window._popwinGroupPicker(win);
    });
    win.querySelector('.intel-popwin-close').addEventListener('click', function () {
      opts.onClose && opts.onClose();
      win.remove();
    });

    /* Zoom */
    var _gz = 1;
    function applyGz(z) {
      _gz = Math.min(2, Math.max(0.4, z));
      body.style.zoom = _gz;
    }
    win.querySelector('.gen-zoom-in').addEventListener('click',  function (e) { e.stopPropagation(); applyGz(_gz + 0.1); });
    win.querySelector('.gen-zoom-out').addEventListener('click', function (e) { e.stopPropagation(); applyGz(_gz - 0.1); });

    return win;
  };

})();
