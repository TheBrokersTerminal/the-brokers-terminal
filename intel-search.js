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
        '<div class="intel-search-bar">' +
          '<span class="intel-search-icon">⌕</span>' +
          '<span class="intel-search-lbl">INTEL</span>' +
          '<input id="intel-search-input" type="text" placeholder="Company, event, or describe a client scenario…" autocomplete="off" spellcheck="false" readonly>' +
        '</div>' +
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

    /* Chrome won't autofill readonly inputs — remove readonly on first interaction */
    function unlockInput() {
      input.removeAttribute('readonly');
      input.removeEventListener('mousedown', unlockInput);
      input.removeEventListener('focus', unlockInput);
    }
    input.addEventListener('mousedown', unlockInput);
    input.addEventListener('focus', unlockInput);

    function positionDropdown() {
      var r = input.getBoundingClientRect();
      dropdown.style.top  = (r.bottom + 4) + 'px';
      dropdown.style.left = r.left + 'px';
    }

    input.addEventListener('input', function () {
      clearTimeout(_debounce);
      var q = this.value.trim();
      if (!q || q.length < 2) { dropdown.style.display = 'none'; return; }
      positionDropdown();
      dropdown.style.display = 'block';
      dropdown.innerHTML = '<div class="intel-drop-loading">SEARCHING<span>...</span></div>';
      _debounce = setTimeout(function () { fetchSuggestions(q, dropdown); }, 320);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { dropdown.style.display = 'none'; input.value = ''; }
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
    });
  }

  /* ── FETCH SUGGESTIONS ── */
  function fetchSuggestions(q, dropdown) {
    fetch('/.netlify/functions/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) { renderDropdown(items, dropdown); })
      .catch(function () {
        dropdown.innerHTML =
          '<div class="intel-drop-item concept" onclick="window._intelSearch(\'' +
          escQ(q) + '\',\'concept\')">' +
          '<span class="intel-drop-badge cx">SEARCH</span>' +
          '<span class="intel-drop-label">Search: "' + escH(q) + '"</span>' +
          '</div>';
      });
  }

  /* ── RENDER DROPDOWN ── */
  function renderDropdown(items, dropdown) {
    if (!items || !items.length) {
      dropdown.innerHTML = '<div class="intel-drop-loading">NO RESULTS</div>';
      return;
    }
    dropdown.innerHTML = items.map(function (item) {
      if (item.type === 'company') {
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
        return '<div class="intel-drop-item concept" ' +
          'data-label="' + escH(item.label) + '" ' +
          'data-query="' + escH(item.query || item.label) + '" ' +
          'data-type="scenario">' +
          '<span class="intel-drop-badge sc">IFA</span>' +
          '<span class="intel-drop-label">' + escH(item.label) + '</span>' +
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
    window._sharedZ++;

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

  /* ── FETCH FULL DETAIL ── */
  function fetchDetail(query, type, ticker, win) {
    var lensKey = (window._assetLens && window._assetLens.key) || 'universal';
    var lensContext = (window._assetLens && window._assetLens.promptContext) || '';
    var cacheKey = type + ':' + lensKey + ':' + (ticker || query);
    if (_cache[cacheKey]) {
      renderPopout(_cache[cacheKey], win);
      return;
    }
    var fetchHeaders = { 'Content-Type': 'application/json' };
    if (window._authToken) fetchHeaders['Authorization'] = 'Bearer ' + window._authToken;
    fetch('/.netlify/functions/search', {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify({ query: query, type: type, ticker: ticker, lensKey: lensKey, lensContext: lensContext }),
    })
      .then(function (r) {
        if (r.status === 402) {
          win.remove();
          r.json().then(function (d) {
            window._showNoCredits && window._showNoCredits(d.balance || 0);
          });
          return null;
        }
        if (!r.ok) {
          var body = win.querySelector('.intel-popwin-body');
          if (win._loadingTimer) { clearInterval(win._loadingTimer); win._loadingTimer = null; }
          if (body) body.innerHTML = '<div class="sp-loading" style="color:#e05050;">INTEL ERROR · HTTP ' + r.status + '<br><span style="font-size:8px;color:#666;margin-top:6px;display:block;">Check Netlify function logs</span></div>';
          return null;
        }
        return r.json();
      })
      .then(function (d) {
        if (!d) return; /* already handled above */
        if (d && !d.error) {
          _cache[cacheKey] = d;
          if (win._popId && _registry[win._popId] && d.ticker) {
            _registry[win._popId].ticker = d.ticker;
          }
        }
        /* Distillery: fetch WhiskyStats expressions (page 1 only — 1 credit) */
        if (d && d.type === 'company' && d.category === 'distillery') {
          var wsKey = 'ws:' + (d.title || cacheKey);
          var lsKey = 's_' + (d.title || cacheKey).toLowerCase().replace(/\s+/g, '_');
          /* 1. Session cache */
          if (_cache[wsKey]) { d._wsResults = _cache[wsKey]; renderPopout(d, win); return; }
          /* 2. localStorage cache (survives page refresh) */
          var lsCached = lsGet(lsKey);
          if (lsCached) { d._wsResults = lsCached; _cache[wsKey] = lsCached; renderPopout(d, win); return; }
          var wsQ = encodeURIComponent(d.title || query);
          var distWords = (d.title || query).toLowerCase().split(/\s+/).filter(function (w) { return w.length > 3; });
          d._wsDistWords = distWords;
          d._wsQ = wsQ;
          d._wsLsKey = lsKey;
          fetch('/.netlify/functions/whisky-data?type=search&query=' + wsQ + '&page=1')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (ws) {
              var all = [], seen = {};
              if (ws && ws.results) {
                ws.results.forEach(function (r) {
                  if (seen[r.whisky_id]) return;
                  var n = (r.whisky_name || '').toLowerCase();
                  if (!distWords.length || distWords.some(function (w) { return n.indexOf(w) !== -1; })) {
                    seen[r.whisky_id] = true; all.push(r);
                  }
                });
              }
              d._wsResults = all;
              d._wsPage = 1;
              _cache[wsKey] = all;
              lsSet(lsKey, all);
              renderPopout(d, win);
            }).catch(function () { renderPopout(d, win); });
        } else {
          renderPopout(d, win);
        }
      })
      .catch(function () {
        var body = win.querySelector('.intel-popwin-body');
        if (body) body.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>';
      });
  }

  /* ── FETCH SECTION DETAIL (overview or pitch) ── */
  function fetchDetailSection(query, type, ticker, section, win) {
    var lensKey = (window._assetLens && window._assetLens.key) || 'universal';
    var lensContext = (window._assetLens && window._assetLens.promptContext) || '';
    var cacheKey = type + ':' + lensKey + ':' + section + ':' + (ticker || query);
    if (_cache[cacheKey]) {
      renderSection(_cache[cacheKey], section, win);
      return;
    }
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
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && !d.error) { _cache[cacheKey] = d; }
        renderSection(d, section, win);
      })
      .catch(function () {
        var body = win.querySelector('.intel-popwin-body');
        if (body) body.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>';
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
    }
    wireNoteBtn(d, body);
    cascadeType(body);
  }

  function renderOverview(d, body) {
    var isListed = d.ticker && d.ticker.length > 0;
    var pitchBtn = d.title ?
      '<button class="sp-pitch-shortcut" data-title="' + escH(d.title) + '" data-ticker="' + escH(d.ticker || '') + '">▌ PITCH PLAYBOOK</button>' : '';
    body.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<div class="sp-badge ' + (isListed ? 'listed' : 'private') + '" style="margin-bottom:0;">' +
          (isListed ? '● LISTED · ' + escH(d.ticker) + ' · ' + escH(d.exchange || '') : '● PRIVATE COMPANY') +
        '</div>' +
        pitchBtn +
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
      '<div class="sp-tagline">' + escH((d.title || '') + ' — PITCH PLAYBOOK') + '</div>' +
      buildPitchPlaybook(d.pitch, d.brokerNote) +
      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ ADD NOTE</button>' +
      '</div>';
  }

  function wirePitchShortcut(d, body) {
    var btn = body.querySelector('.sp-pitch-shortcut');
    if (!btn) return;
    btn.addEventListener('click', function () {
      window._intelSearchSection(d.title, 'company', d.ticker || '', 'pitch');
    });
  }

  function wireNoteBtn(d, body) {
    wirePitchShortcut(d, body);
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
    var A = '#E97132', GRN = '#3DAA6A', RED = '#D14040', BLU = '#4A90D9';
    var suitCol = function(s) { return s === 'HIGH' ? GRN : s === 'MEDIUM' ? A : 'rgba(255,255,255,0.45)'; };

    body.innerHTML =
      '<div class="sp-badge private" style="margin-bottom:8px;background:rgba(233,113,50,0.12);border-color:' + A + ';color:' + A + ';">▌ IFA ADVISORY BRIEF</div>' +

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
        '</div>' : '') +

      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ SAVE TO NOTES</button>' +
      '</div>';
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
    } else {
      renderConcept(d, body);
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
                            parts.push('SPIN QUESTIONS:\n' + p.spinQuestions.map(function (q, i) { return ['Situation', 'Problem/Implication', 'Need-Payoff'][i] + ': ' + q; }).join('\n'));
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
      return '<div class="sp-section">' +
        '<div class="sp-sec-lbl">BROKER NOTE</div>' +
        '<div class="sp-pitch">' + escH(brokerNote) + '</div>' +
      '</div>';
    }
    var html = '<div class="sp-pitch-playbook">';

    /* 1 — Opening line */
    if (pitch.openingLine) {
      html += '<div class="sp-section">' +
        '<div class="sp-sec-lbl">OPENING LINE</div>' +
        '<div class="sp-pitch">“' + escH(pitch.openingLine) + '”</div>' +
      '</div>';
    }

    /* 2 — The logical case */
    if (pitch.logicalCase && pitch.logicalCase.length) {
      html += '<div class="sp-section">' +
        '<div class="sp-sec-lbl">THE LOGICAL CASE — BUILD CERTAINTY FIRST</div>' +
        '<ul class="sp-facts">' +
          pitch.logicalCase.map(function (f) { return '<li>' + escH(f) + '</li>'; }).join('') +
        '</ul>' +
      '</div>';
    }

    /* 3 — Emotional future pace */
    if (pitch.emotionalCase) {
      html += '<div class="sp-section">' +
        '<div class="sp-sec-lbl">FUTURE PACE — MAKE THEM FEEL THE OUTCOME</div>' +
        '<div class="sp-pitch">' + escH(pitch.emotionalCase) + '</div>' +
      '</div>';
    }

    /* 4 — SPIN questions */
    if (pitch.spinQuestions && pitch.spinQuestions.length) {
      html += '<div class="sp-section">' +
        '<div class="sp-sec-lbl">QUESTIONS TO ASK FIRST — SPIN INTELLIGENCE</div>' +
        '<ul class="sp-facts sp-spin">' +
          pitch.spinQuestions.map(function (q, i) {
            var labels = ['SITUATION', 'PROBLEM / IMPLICATION', 'NEED-PAYOFF'];
            return '<li><span class="sp-spin-lbl">' + (labels[i] || 'Q' + (i + 1)) + '</span>' + escH(q) + '</li>';
          }).join('') +
        '</ul>' +
      '</div>';
    }

    /* 5 — Handle objections */
    if (pitch.objections && pitch.objections.length) {
      html += '<div class="sp-section">' +
        '<div class="sp-sec-lbl">HANDLE OBJECTIONS — LOOP AND BUILD CERTAINTY</div>' +
        pitch.objections.map(function (o) {
          return '<div class="sp-objection">' +
            '<div class="sp-obj-q">“' + escH(o.objection || '') + '”</div>' +
            '<div class="sp-obj-a">' + escH(o.rebuttal || '') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    /* 6 — Urgency + social proof */
    var urgencyRow = '';
    if (pitch.urgencyLine) urgencyRow += '<div class="sp-intel-row"><span class="sp-intel-lbl">TIMING</span><span class="sp-intel-val">' + escH(pitch.urgencyLine) + '</span></div>';
    if (pitch.socialProof) urgencyRow += '<div class="sp-intel-row"><span class="sp-intel-lbl">SOCIAL PROOF</span><span class="sp-intel-val">' + escH(pitch.socialProof) + '</span></div>';
    if (urgencyRow) {
      html += '<div class="sp-section">' +
        '<div class="sp-sec-lbl">CREATE URGENCY</div>' +
        '<div class="sp-intel-grid">' + urgencyRow + '</div>' +
      '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderCompany(d, body) {
    var isListed = d.ticker && d.ticker.length > 0;
    body.innerHTML =
      '<div class="sp-badge ' + (isListed ? 'listed' : 'private') + '">' +
        (isListed ? '● LISTED · ' + escH(d.ticker) + ' · ' + escH(d.exchange || '') : '● PRIVATE COMPANY') +
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

      buildPitchPlaybook(d.pitch, d.brokerNote) +

      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ ADD NOTE</button>' +
      '</div>';
    cascadeType(body);
  }

  function renderConcept(d, body) {
    var timelineHTML = '';
    if (d.timeline && d.timeline.length) {
      timelineHTML =
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">TIMELINE</div>' +
          '<div class="sp-timeline">' +
            d.timeline.map(function (t) {
              return '<div class="sp-tl-row">' +
                '<div class="sp-tl-date">' + escH(t.date || '') + '</div>' +
                '<div class="sp-tl-evt">' + escH(t.event || '') + '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>';
    }

    var causesHTML = '';
    if (d.causes && d.causes.length) {
      causesHTML =
        '<div class="sp-section">' +
          '<div class="sp-sec-lbl">CAUSES</div>' +
          '<ul class="sp-facts">' +
            d.causes.map(function (c) { return '<li>' + escH(c) + '</li>'; }).join('') +
          '</ul>' +
        '</div>';
    }

    body.innerHTML =
      '<div class="sp-badge event">' +
        '● ' + escH(d.period || 'CONCEPT') +
      '</div>' +
      '<div class="sp-tagline">' + escH(d.tagline || '') + '</div>' +

      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">WHAT IS IT?</div>' +
        '<div class="sp-text">' + escH(d.whatHappened || '') + '</div>' +
      '</div>' +

      causesHTML +
      timelineHTML +

      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">IMPACT ON ASSET CLASSES</div>' +
        '<div class="sp-text">' + escH(d.impactOnAssets || '') + '</div>' +
      '</div>' +

      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">THE LESSON FOR CLIENTS</div>' +
        '<div class="sp-text">' + escH(d.lessonForClients || '') + '</div>' +
      '</div>' +

      buildPitchPlaybook(d.pitch, d.brokerNote) +

      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn">✎ ADD NOTE</button>' +
      '</div>';
    cascadeType(body);
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

    /* Fetch browse (details + rating) — 3 credits; localStorage-cached for 7 days */
    var sBody = sidebar.querySelector('.dist-sidebar-body');
    var bLsKey = 'b_' + whiskyId;
    var bCached = lsGet(bLsKey) || _cache['browse:' + whiskyId];
    if (bCached) {
      renderExpressionDetail(bCached, sBody, whiskyId);
    } else {
      fetch('/.netlify/functions/whisky-data?type=browse&id=' + encodeURIComponent(whiskyId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || data.error) {
            sBody.innerHTML = '<div class="sp-loading">' + (data && data.error ? 'API ERROR: ' + escH(data.error) : 'DATA UNAVAILABLE') + '</div>';
            return;
          }
          _cache['browse:' + whiskyId] = data;
          lsSet(bLsKey, data);
          renderExpressionDetail(data, sBody, whiskyId);
        })
        .catch(function () { sBody.innerHTML = '<div class="sp-loading">DATA UNAVAILABLE</div>'; });
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
        (rat.whiskybase_rating != null ? sRow('RATING', rat.whiskybase_rating + ' / 100') : '') +
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
