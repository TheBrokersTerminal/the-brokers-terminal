/* ── BROKERS INTELLIGENCE SEARCH — shared component ─────────────────────── */
(function () {
  'use strict';

  var _debounce = null;
  var _popZ = 8000;
  var _popOffset = 0;
  var _cache = {};    /* session cache: key → parsed response */
  var _registry = {}; /* pid → {query, type, ticker, x, y, w, h} */

  /* Expose state for terminal-canvas saveLayout */
  window._getIntelPopouts = function () {
    return Object.values(_registry);
  };

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
          '<input id="intel-search-input" type="text" placeholder="Company, distillery, event, crisis…" autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<div class="intel-dropdown" id="intel-dropdown" style="display:none;"></div>' +
      '</div>';

    var input = document.getElementById('intel-search-input');
    var dropdown = document.getElementById('intel-dropdown');

    input.addEventListener('input', function () {
      clearTimeout(_debounce);
      var q = this.value.trim();
      if (!q || q.length < 2) { dropdown.style.display = 'none'; return; }
      dropdown.style.display = 'block';
      dropdown.innerHTML = '<div class="intel-drop-loading">SEARCHING<span>...</span></div>';
      _debounce = setTimeout(function () { fetchSuggestions(q, dropdown); }, 320);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { dropdown.style.display = 'none'; input.value = ''; }
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) dropdown.style.display = 'none';
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
        '<span class="intel-sub-opt-icon">◈</span>' +
        '<div><div class="intel-sub-opt-lbl">LATEST NEWS</div><div class="intel-sub-opt-sub">Recent stories · Headlines</div></div>' +
      '</div>' +
      '<div class="intel-sub-option" data-action="market">' +
        '<span class="intel-sub-opt-icon">▲</span>' +
        '<div><div class="intel-sub-opt-lbl">MARKET DATA</div><div class="intel-sub-opt-sub">Live price · Price change</div></div>' +
      '</div>' +
      '<div class="intel-sub-option" data-action="intel">' +
        '<span class="intel-sub-opt-icon">⬡</span>' +
        '<div><div class="intel-sub-opt-lbl">BROKERS INTELLIGENCE</div><div class="intel-sub-opt-sub">AI briefing · Pitch language</div></div>' +
      '</div>';

    row.appendChild(sub);

    /* Keep sub-panel open while hovering it */
    sub.addEventListener('mouseleave', function (e) {
      if (!row.contains(e.relatedTarget)) sub.remove();
    });

    /* Handle option clicks */
    sub.querySelectorAll('.intel-sub-option').forEach(function (opt) {
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        var action = opt.dataset.action;
        var dropdown = document.getElementById('intel-dropdown');
        if (dropdown) dropdown.style.display = 'none';
        document.querySelectorAll('.intel-sub-panel').forEach(function (s) { s.remove(); });

        if (action === 'profile' || action === 'intel') {
          window._intelSearch(label, 'company', ticker);
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
  window._intelSearch = function (query, type, ticker) {
    var dropdown = document.getElementById('intel-dropdown');
    var input = document.getElementById('intel-search-input');
    if (dropdown) dropdown.style.display = 'none';
    if (input) input.value = '';

    var win = createPopout(query, type);
    fetchDetail(query, type, ticker || '', win);
  };

  /* ── TAB GROUP REGISTRY ── */
  /* Each entry: {el, tabs:[{title,panelEl}], activeIdx} */
  var _groups = [];

  /* ── CREATE DRAGGABLE POP-OUT ── */
  function createPopout(query, type) {
    _popOffset = (_popOffset + 24) % 120;
    _popZ++;

    var pid = 'pop-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    var x   = 200 + _popOffset;
    var y   = 80  + _popOffset;

    var win = document.createElement('div');
    win.className  = 'intel-popwin';
    win._itTitle   = query.toUpperCase();
    win._popId     = pid;
    win.style.cssText = 'top:' + y + 'px;left:' + x + 'px;z-index:' + _popZ + ';';

    win.innerHTML =
      '<div class="intel-popwin-titlebar">' +
        '<span class="intel-popwin-icon">▌ INTEL</span>' +
        '<span class="intel-popwin-title">' + escH(query.toUpperCase()) + '</span>' +
        '<div style="display:flex;gap:4px;margin-left:auto;">' +
          '<button class="intel-popwin-btn intel-popwin-group" title="Click to merge with another open panel">⊞ GROUP</button>' +
          '<button class="intel-popwin-close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="intel-popwin-body">' +
        '<div class="sp-loading">LOADING INTELLIGENCE<span>...</span></div>' +
      '</div>';

    /* Register in state */
    _registry[pid] = {query: query, type: type || 'company', ticker: '', x: x, y: y, w: 440, h: 500};

    document.body.appendChild(win);
    makeDraggable(win, win.querySelector('.intel-popwin-titlebar'));
    makeResizablePop(win);

    win.addEventListener('mousedown', function () { _popZ++; win.style.zIndex = _popZ; });

    /* Close: deregister + save */
    win.querySelector('.intel-popwin-close').addEventListener('click', function () {
      delete _registry[pid];
      win.remove();
      _saveIntelState();
    });

    /* GROUP button: click to pick a sibling to merge with */
    win.querySelector('.intel-popwin-group').addEventListener('click', function (e) {
      e.stopPropagation();
      var others = document.querySelectorAll('.intel-popwin');
      if (others.length < 2) { return; }
      /* Show a mini picker */
      var picker = document.createElement('div');
      picker.className = 'intel-group-picker';
      picker.style.cssText = 'position:fixed;background:#0d0d0d;border:1px solid #E97132;border-top:2px solid #E97132;z-index:99999;min-width:200px;';
      var rect = win.getBoundingClientRect();
      picker.style.top  = (rect.top + 36) + 'px';
      picker.style.left = rect.left + 'px';
      picker.innerHTML = '<div style="font-size:7px;letter-spacing:.22em;color:#555;padding:8px 12px 4px;text-transform:uppercase;">MERGE WITH:</div>';
      others.forEach(function (other) {
        if (other === win) return;
        var item = document.createElement('div');
        item.style.cssText = 'padding:9px 14px;font-size:10px;color:#ccc;cursor:pointer;border-bottom:1px solid #111;font-family:Consolas,Menlo,monospace;letter-spacing:.04em;';
        item.textContent = other._itTitle || 'PANEL';
        item.addEventListener('mouseenter', function () { item.style.background = '#161616'; item.style.color = '#E97132'; });
        item.addEventListener('mouseleave', function () { item.style.background = ''; item.style.color = '#ccc'; });
        item.addEventListener('click', function () {
          picker.remove();
          mergeIntoGroup(win, other);
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
    });

    return win;
  }

  /* ── MERGE TWO POPOUTS INTO A TAB GROUP ── */
  function mergeIntoGroup(winA, winB) {
    var rectB = winB.getBoundingClientRect();
    var w = Math.max(winA.offsetWidth, winB.offsetWidth, 480);
    var h = Math.max(winA.offsetHeight, winB.offsetHeight, 500);

    var group = document.createElement('div');
    group.className = 'intel-tab-group';
    group.style.cssText =
      'top:' + rectB.top + 'px;left:' + rectB.left + 'px;' +
      'width:' + w + 'px;height:' + h + 'px;z-index:' + (++_popZ) + ';';

    /* Build tab data */
    var tabs = [
      {title: winA._itTitle || 'PANEL', bodyEl: winA.querySelector('.intel-popwin-body')},
      {title: winB._itTitle || 'PANEL', bodyEl: winB.querySelector('.intel-popwin-body')},
    ];

    function renderGroup(activeIdx) {
      group.innerHTML =
        '<div class="intel-tg-bar">' +
          tabs.map(function (t, i) {
            return '<button class="intel-tg-tab' + (i === activeIdx ? ' active' : '') + '" data-idx="' + i + '">' +
              escH(t.title) +
              '<span class="intel-tg-tab-close" data-idx="' + i + '">×</span>' +
            '</button>';
          }).join('') +
          '<button class="intel-tg-close-all">✕</button>' +
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
          tabs.splice(idx, 1);
          if (!tabs.length) { group.remove(); return; }
          renderGroup(Math.min(idx, tabs.length - 1));
        });
      });
      group.querySelector('.intel-tg-close-all').addEventListener('click', function () { group.remove(); });
    }

    group._uid = Date.now();
    document.body.appendChild(group);
    renderGroup(0);

    /* makeResizablePop attaches to group itself (not a child) so only needs wiring once */
    makeResizablePop(group);
    group.addEventListener('mousedown', function () { _popZ++; group.style.zIndex = _popZ; });

    winA.remove();
    winB.remove();
  }

  /* ── FETCH FULL DETAIL ── */
  function fetchDetail(query, type, ticker, win) {
    var cacheKey = type + ':' + (ticker || query);
    if (_cache[cacheKey]) {
      renderPopout(_cache[cacheKey], win);
      return;
    }
    fetch('/.netlify/functions/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, type: type, ticker: ticker }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && !d.error) {
          _cache[cacheKey] = d;
          /* store resolved ticker so persistence can re-fetch exactly */
          if (win._popId && _registry[win._popId] && d.ticker) {
            _registry[win._popId].ticker = d.ticker;
          }
        }
        renderPopout(d, win);
      })
      .catch(function () {
        var body = win.querySelector('.intel-popwin-body');
        if (body) body.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>';
      });
  }

  /* ── RENDER POP-OUT CONTENT ── */
  function renderPopout(d, win) {
    var body = win.querySelector('.intel-popwin-body');
    if (!body || !d) {
      if (body) body.innerHTML = '<div class="sp-loading">INTELLIGENCE UNAVAILABLE</div>';
      return;
    }

    /* Update title bar */
    var titleEl = win.querySelector('.intel-popwin-title');
    if (titleEl && d.title) titleEl.textContent = d.title.toUpperCase();

    if (d.type === 'company') {
      renderCompany(d, body);
    } else {
      renderConcept(d, body);
    }
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

      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">HOW TO PITCH IT — SAY THIS TO YOUR CLIENT</div>' +
        '<div class="sp-pitch">' + escH(d.brokerNote || '') + '</div>' +
      '</div>' +
      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn" onclick="window.noteModalOpen&&noteModalOpen({subjectType:\'intel\',subjectTitle:\'' + escQ(d.title||'') + '\',subjectTicker:\'' + escQ(d.ticker||'') + '\'})">✎ ADD NOTE</button>' +
      '</div>';
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

      '<div class="sp-section">' +
        '<div class="sp-sec-lbl">HOW TO PITCH IT — SAY THIS TO YOUR CLIENT</div>' +
        '<div class="sp-pitch">' + escH(d.brokerNote || '') + '</div>' +
      '</div>' +
      '<div class="sp-section" style="border-top:1px solid #111;padding-top:10px;">' +
        '<button class="sp-note-btn" onclick="window.noteModalOpen&&noteModalOpen({subjectType:\'intel\',subjectTitle:\'' + escQ(d.title||'') + '\',subjectTicker:\'' + escQ(d.ticker||'') + '\'})">✎ ADD NOTE</button>' +
      '</div>';
  }

  /* ── DRAGGABLE ── */
  function makeDraggable(win, handle) {
    var ox = 0, oy = 0, sx = 0, sy = 0;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      e.preventDefault();
      sx = e.clientX; sy = e.clientY;
      ox = win.offsetLeft; oy = win.offsetTop;
      function onMove(e) {
        win.style.left = (ox + e.clientX - sx) + 'px';
        win.style.top  = (oy + e.clientY - sy) + 'px';
      }
      function onUp() {
        /* Persist position */
        if (win._popId && _registry[win._popId]) {
          _registry[win._popId].x = win.offsetLeft;
          _registry[win._popId].y = win.offsetTop;
          _saveIntelState();
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ── RESIZABLE (all edges/corners via border detection) ── */
  var _RM = 7; /* resize margin px */
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
      if (e.target.closest('.intel-popwin-titlebar, .intel-tg-bar')) { win.style.cursor = ''; return; }
      win.style.cursor = _popCur(_popDir(win, e)) || '';
    });
    win.addEventListener('mouseleave', function () { win.style.cursor = ''; });
    win.addEventListener('mousedown', function (e) {
      var d = _popDir(win, e);
      if (!d) return;
      if (e.target.closest('button, a')) return;
      e.preventDefault(); e.stopPropagation();
      var sw = win.offsetWidth, sh = win.offsetHeight;
      var sl = win.offsetLeft,  st = win.offsetTop;
      var sx = e.clientX,       sy = e.clientY;
      var cur = _popCur(d);
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:' + cur + ';';
      document.body.appendChild(ov);
      function onMove(e) {
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (d.east)  win.style.width  = Math.max(320, sw + dx) + 'px';
        if (d.south) win.style.height = Math.max(200, sh + dy) + 'px';
        if (d.west)  { var nw = Math.max(320, sw - dx); win.style.width = nw + 'px'; win.style.left = (sl + sw - nw) + 'px'; }
        if (d.north) { var nh = Math.max(200, sh - dy); win.style.height = nh + 'px'; win.style.top = (st + sh - nh) + 'px'; }
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

})();
