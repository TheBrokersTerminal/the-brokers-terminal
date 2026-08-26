/* ── BROKERS TERMINAL — CANVAS WIDGET ENGINE ──────────────────────
   Manages draggable/resizable widgets on the dashboard canvas.
   Persists layout + notes to Supabase per user.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var _sb   = null;   /* supabase client, set by init */
  var _uid  = null;   /* current user id */
  var _canvas = null; /* canvas DOM element */
  var _saveTimer = null;
  var _widgets = {};  /* id → {el, cfg} */
  window._sharedZ = window._sharedZ || 1000;

  var FINNHUB_KEY = 'da6p77hr01qqqkkgl7b0da6p77hr01qqqkkgl7bg';

  var MARKET_CATS = {
    gold:  [{sym:'GLD',  l:'GOLD (GLD)',      mult:10},
            {sym:'GDX',  l:'GOLD MINERS',     mult:1},
            {sym:'SGOL', l:'ABERDEEN GOLD',   mult:1},
            {sym:'IAU',  l:'iSHARES GOLD',    mult:10}],
    whisky:[{sym:'DEO',  l:'DIAGEO (DEO)',    mult:1},
            {sym:'BF.B', l:'BROWN-FORMAN',    mult:1},
            {sym:'MGPI', l:'MGP INGREDIENTS', mult:1},
            {sym:'GLD',  l:'GOLD/OZ',         mult:10}],
  };

  /* ── DEFAULT STARTER LAYOUT ── */
  var DEFAULT_LAYOUT = [
    {id:'w-news',    type:'news',    x:20,  y:16, w:400, h:500, data:{}},
    {id:'w-market',  type:'market',  x:440, y:16, w:340, h:230, data:{cat:'gold'}},
    {id:'w-reports', type:'reports', x:440, y:266, w:340, h:250, data:{}},
    {id:'w-notes',   type:'notes',   x:800, y:16, w:280, h:500, data:{text:''}},
  ];

  /* ── INIT ── */
  var _firmId   = null;
  var _userName = null;

  window.terminalCanvasInit = function (supabaseClient, userId, firmId, userName) {
    _sb       = supabaseClient;
    _uid      = userId;
    _firmId   = firmId   || null;
    _userName = userName || 'BROKER';
    _canvas = document.getElementById('tbc-canvas');
    if (!_canvas) return;

    buildTabBar();
    loadPreferences().then(function (prefs) {
      var layout = (prefs && prefs.dashboard_layout) ? prefs.dashboard_layout : DEFAULT_LAYOUT;
      var notes  = (prefs && prefs.notes_content)    ? prefs.notes_content    : '';
      layout.forEach(function (cfg) {
        if (cfg.type === 'notes') cfg.data = cfg.data || {};
        if (cfg.type === 'notes' && !cfg.data.text) cfg.data.text = notes;
        spawnWidget(cfg);
      });
      /* Restore intel popouts after a short delay to ensure intel-search.js is ready */
      var savedIntel = (prefs && prefs.intel_popouts) ? prefs.intel_popouts : [];
      if (savedIntel.length) {
        setTimeout(function () {
          if (window._restoreIntelPopouts) window._restoreIntelPopouts(savedIntel);
        }, 600);
      }
    });
  };

  /* ── TAB BAR ── */
  function buildTabBar() {
    var bar = document.getElementById('tbc-tab-bar');
    if (!bar) return;
    bar.innerHTML =
      '<button class="tbc-tab active" data-tab="terminal">▌ TERMINAL</button>' +
      '<div class="tbc-tab-sep"></div>' +
      '<button class="tbc-tab" data-tab="vault">VAULT</button>' +
      '<button class="tbc-tab" data-tab="news">NEWS FEED</button>' +
      '<button class="tbc-tab-add" id="tbc-add-btn">＋ ADD WIDGET</button>';

    bar.querySelectorAll('.tbc-tab[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        bar.querySelectorAll('.tbc-tab[data-tab]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var tab = btn.dataset.tab;
        document.getElementById('tbc-canvas-wrap').style.display = tab === 'terminal' ? 'block' : 'none';
        var vault = document.getElementById('vault-section');
        if (vault) vault.style.display = tab === 'vault' ? 'block' : 'none';
        /* Hide intel popouts when leaving terminal; restore when returning */
        var vis = tab === 'terminal' ? '' : 'none';
        document.querySelectorAll('.intel-popwin, .intel-tab-group').forEach(function (el) {
          el.style.display = vis;
        });
        /* News feed panel */
        var newsPanel = document.getElementById('tbc-news-panel');
        if (!newsPanel && tab === 'news') {
          newsPanel = document.createElement('div');
          newsPanel.id = 'tbc-news-panel';
          newsPanel.style.cssText = 'width:100%;height:calc(100vh - 120px);border:none;';
          var iframe = document.createElement('iframe');
          iframe.src = 'news.html';
          iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
          iframe.title = 'News Feed';
          newsPanel.appendChild(iframe);
          var wrap = document.getElementById('tbc-canvas-wrap');
          wrap.parentNode.insertBefore(newsPanel, wrap.nextSibling);
        }
        if (newsPanel) newsPanel.style.display = tab === 'news' ? 'block' : 'none';
      });
    });

    document.getElementById('tbc-add-btn').addEventListener('click', function (e) {
      toggleAddMenu(e.currentTarget);
    });
  }

  /* ── ADD WIDGET MENU ── */
  var _addMenu = null;
  function toggleAddMenu(btn) {
    if (_addMenu) { _addMenu.remove(); _addMenu = null; return; }
    var rect = btn.getBoundingClientRect();
    _addMenu = document.createElement('div');
    _addMenu.className = 'tbc-add-menu';
    _addMenu.style.cssText = 'top:' + (rect.bottom + 4) + 'px;right:' + (window.innerWidth - rect.right) + 'px;';
    _addMenu.innerHTML = [
      {type:'news',     icon:'◈', lbl:'LIVE HEADLINES',  sub:'Latest news from all feeds'},
      {type:'market',   icon:'◉', lbl:'MARKET PRICES',   sub:'Live Finnhub price tiles'},
      {type:'reports',  icon:'▣', lbl:'VAULT REPORTS',   sub:'Your latest reports'},
      {type:'notes',    icon:'✎', lbl:'MY NOTES',        sub:'Private scratchpad'},
      {type:'chat',        icon:'◎', lbl:'FIRM CHAT',       sub:'Realtime firm messaging'},
      {type:'calendar',    icon:'◷', lbl:'CALENDAR',        sub:'Events & reminders'},
      {type:'notes_inbox',   icon:'✉', lbl:'FIRM NOTES',          sub:'Shared intel notes from your firm'},
      {type:'econ_calendar', icon:'◫', lbl:'ECONOMIC CALENDAR',   sub:'Upcoming market & macro events'},
      {type:'macro_prices',  icon:'▲', lbl:'MACRO PRICES',         sub:'Live gold, FX, BoE rate & UK CPI'},
      {type:'macro_chart',   icon:'◐', lbl:'ASSET COMPARISON',     sub:'Gold vs S&P 500 vs inflation chart'},
      {type:'macro_intel',   icon:'◧', lbl:'MACRO INTELLIGENCE',   sub:'Professor + sales engine — 5 macro themes'},
    ].map(function (w) {
      return '<div class="tbc-add-item" data-type="' + w.type + '">' +
        '<span class="tbc-add-icon">' + w.icon + '</span>' +
        '<div><div class="tbc-add-lbl">' + w.lbl + '</div><div class="tbc-add-sub">' + w.sub + '</div></div>' +
        '</div>';
    }).join('');
    _addMenu.querySelectorAll('.tbc-add-item').forEach(function (row) {
      row.addEventListener('click', function () {
        var type = row.dataset.type;
        var offset = Object.keys(_widgets).length * 24;
        var cfg = {
          id: 'w-' + Date.now(),
          type: type,
          x: 40 + offset, y: 40 + offset,
          w: type === 'notes' ? 280 : type === 'news' ? 400 : type === 'chat' ? 480 : type === 'calendar' || type === 'econ_calendar' ? 420 : type === 'macro_chart' ? 520 : type === 'macro_prices' ? 360 : type === 'macro_intel' ? 580 : 340,
          h: type === 'news' || type === 'notes' ? 480 : type === 'chat' ? 440 : type === 'calendar' ? 380 : type === 'econ_calendar' ? 500 : type === 'macro_chart' ? 360 : type === 'macro_prices' ? 300 : type === 'macro_intel' ? 500 : 240,
          data: type === 'market' ? {cat:'gold'} : {},
        };
        spawnWidget(cfg);
        saveLayout();
        _addMenu.remove(); _addMenu = null;
      });
    });
    document.body.appendChild(_addMenu);
    setTimeout(function () {
      document.addEventListener('click', function closeMenu(e) {
        if (_addMenu && !_addMenu.contains(e.target) && e.target.id !== 'tbc-add-btn') {
          _addMenu.remove(); _addMenu = null;
        }
        document.removeEventListener('click', closeMenu);
      });
    }, 10);
  }

  /* ── SPAWN WIDGET ── */
  function spawnWidget(cfg) {
    var el = document.createElement('div');
    el.className = 'tbc-widget';
    el.id = cfg.id;
    el.style.cssText = 'left:' + cfg.x + 'px;top:' + cfg.y + 'px;width:' + cfg.w + 'px;height:' + cfg.h + 'px;z-index:' + (++window._sharedZ) + ';';

    var icons = {news:'◈', market:'◉', reports:'▣', notes:'✎', intel:'◆', chat:'◎', calendar:'◷', notes_inbox:'✉', report_viewer:'▤', econ_calendar:'◫', macro_prices:'▲', macro_chart:'◐', macro_intel:'◧'};
    var titles = {news:'LIVE HEADLINES', market:'MARKET PRICES', reports:'VAULT · LATEST', notes:'MY NOTES', intel:'BROKERS INTEL', chat:'FIRM CHAT', calendar:'CALENDAR', notes_inbox:'FIRM NOTES', report_viewer:'REPORT', econ_calendar:'ECONOMIC CALENDAR', macro_prices:'MACRO PRICES', macro_chart:'ASSET COMPARISON', macro_intel:'MACRO INTELLIGENCE'};

    el.innerHTML =
      '<div class="tbc-widget-bar">' +
        '<span class="tbc-widget-icon">' + (icons[cfg.type]||'◆') + '</span>' +
        '<span class="tbc-widget-title" id="' + cfg.id + '-title">' + (titles[cfg.type]||cfg.type.toUpperCase()) + '</span>' +
        '<div class="tbc-widget-actions">' +
          '<button class="tbc-widget-btn zoom-out" title="Zoom out">−</button>' +
          '<button class="tbc-widget-btn zoom-in"  title="Zoom in">+</button>' +
          '<button class="tbc-widget-btn group-out" title="Pop out & group with other panels">⊞</button>' +
          '<button class="tbc-widget-btn refresh" title="Refresh" data-wid="' + cfg.id + '">↺</button>' +
          '<button class="tbc-widget-btn close" title="Remove" data-wid="' + cfg.id + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="tbc-widget-body" id="' + cfg.id + '-body"><div class="tbw-loading">LOADING…</div></div>';

    _canvas.appendChild(el);
    _widgets[cfg.id] = {el: el, cfg: cfg};

    el.addEventListener('mousedown', function () {
      el.style.zIndex = ++window._sharedZ;
    });

    el.querySelector('.tbc-widget-btn.close').addEventListener('click', function () {
      el.remove();
      delete _widgets[cfg.id];
      saveLayout();
    });

    el.querySelector('.tbc-widget-btn.refresh').addEventListener('click', function () {
      populateWidget(cfg.id, cfg.type, cfg.data, el);
    });

    /* Zoom buttons */
    var _zoom = cfg.data._zoom || 1;
    var bodyEl = el.querySelector('.tbc-widget-body');
    function applyZoom(z) {
      _zoom = Math.min(2, Math.max(0.4, z));
      bodyEl.style.zoom = _zoom;
      cfg.data._zoom = _zoom;
    }
    applyZoom(_zoom);
    el.querySelector('.tbc-widget-btn.zoom-in').addEventListener('click', function () { applyZoom(_zoom + 0.1); });
    el.querySelector('.tbc-widget-btn.zoom-out').addEventListener('click', function () { applyZoom(_zoom - 0.1); });

    /* Pop-out / GROUP button — lifts widget out of canvas into a floating window */
    el.querySelector('.tbc-widget-btn.group-out').addEventListener('click', function () {
      if (!window.createGenericPopout) return;
      var widBody = el.querySelector('.tbc-widget-body');
      var widTitle = (titles[cfg.type] || cfg.type).toUpperCase();
      var widIcon  = icons[cfg.type] || '◆';
      var rect = el.getBoundingClientRect();
      var canvasRect = _canvas.getBoundingClientRect();

      /* Detach body from widget — move it into the popout */
      var bodyClone = widBody; /* same DOM node */
      bodyClone.style.zoom = '1'; /* reset zoom so the popout looks right */

      var popwin = window.createGenericPopout(widTitle, widIcon, function (popBody) {
        popBody.appendChild(bodyClone);
      }, {
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
      });

      /* Remove the canvas widget */
      el.remove();
      delete _widgets[cfg.id];
      saveLayout();
    });

    makeDraggable(el, el.querySelector('.tbc-widget-bar'));
    makeResizable(el, cfg.id);
    populateWidget(cfg.id, cfg.type, cfg.data, el);
  }

  /* ── POPULATE WIDGET CONTENT ── */
  function populateWidget(id, type, data, el) {
    var body = el.querySelector('.tbc-widget-body');
    body.innerHTML = '<div class="tbw-loading">LOADING…</div>';
    if      (type === 'news')    renderNews(id, body);
    else if (type === 'market')  renderMarket(id, body, data.cat || 'gold', el);
    else if (type === 'reports') renderReports(id, body);
    else if (type === 'notes')   renderNotes(id, body, data.text || '');
    else if (type === 'intel')    renderIntel(id, body, data);
    else if (type === 'chat')          renderChatBridge(id, body);
    else if (type === 'calendar')      renderCalendarBridge(id, body);
    else if (type === 'notes_inbox')   renderNotesInboxBridge(id, body);
    else if (type === 'report_viewer') renderReportViewer(id, body, data);
    else if (type === 'econ_calendar')  renderEconCalendar(id, body);
    else if (type === 'macro_prices')   renderMacroPrices(id, body);
    else if (type === 'macro_chart')    renderMacroChart(id, body);
    else if (type === 'macro_intel')    renderMacroIntel(id, body);
  }

  /* ── NEWS ── */
  var _NEWS_KW = {
    whisky: ['whisky','whiskey','scotch','bourbon','distillery','single malt','spirits','diageo','pernod','macallan','glenfiddich','glenlivet','balvenie','ardbeg','dalmore','springbank','bruichladdich','laphroaig','talisker','cask'],
    gold:   ['gold','silver','platinum','precious metal','xau','bullion','comex','spot gold','gold price','gold etf','mining','miner','gdx']
  };
  function _newsRelevant(s, asset) {
    var kw = _NEWS_KW[asset]; if (!kw) return false;
    var txt = ((s.title||'') + ' ' + (s.source||'')).toLowerCase();
    return kw.some(function(k){ return txt.includes(k); });
  }
  function renderNews(id, body) {
    var fetchStories = window._rssCache
      ? Promise.resolve(window._rssCache)
      : fetch('/.netlify/functions/rss').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){ if(d) window._rssCache = d; return d; });
    fetchStories
      .then(function (stories) {
        if (!stories || !stories.length) { body.innerHTML = '<div class="tbw-loading">NO STORIES FOUND</div>'; return; }
        var asset = (window.firmAccess || 'both').toLowerCase();
        var top;
        if (asset === 'whisky' || asset === 'gold') {
          /* Single asset — show only that asset's news */
          top = stories.filter(function(s){ return _newsRelevant(s, asset); }).slice(0, 15);
          if (!top.length) top = stories.slice(0, 10); /* fallback if no match */
        } else {
          /* Both access — show whisky + gold stories combined, sorted by date */
          top = stories.filter(function(s){
            return _newsRelevant(s, 'whisky') || _newsRelevant(s, 'gold');
          }).slice(0, 15);
          if (!top.length) top = stories.slice(0, 10);
        }
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.innerHTML = top.map(function (s) {
          /* RSS fn returns: {title, url, datetime (unix secs), source} */
          var ts  = s.datetime ? new Date(s.datetime * 1000).toISOString() : (s.pubDate || '');
          var ago = timeAgo(ts);
          var hl  = decodeRssEntities(s.title || s.headline || '');
          var url = s.url   || s.link     || '';
          return '<div class="tbw-news-item" data-url="' + escH(url) + '">' +
            '<div class="tbw-news-meta"><span class="tbw-news-src">' + escH(s.source||'') + '</span><span class="tbw-news-time">' + ago + '</span></div>' +
            '<div class="tbw-news-hl">' + escH(hl) + '</div>' +
            '</div>';
        }).join('') +
        '<div class="tbw-news-footer">' +
          '<span class="tbw-news-refresh">Updated ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</span>' +
          '<a class="tbw-news-link" href="news.html" target="_blank" rel="noopener">FULL TERMINAL ↗</a>' +
        '</div>';
        body.querySelectorAll('.tbw-news-item').forEach(function (row) {
          row.addEventListener('click', function () {
            var url = row.dataset.url;
            if (url) window.open(url, '_blank', 'noopener');
          });
        });
        /* auto-refresh every 5 min */
        clearTimeout(el_refresh_timer(id));
        set_refresh_timer(id, setTimeout(function () { renderNews(id, body); }, 300000));
      })
      .catch(function () { body.innerHTML = '<div class="tbw-loading">NEWS UNAVAILABLE</div>'; });
  }

  /* ── MARKET ── */
  function renderMarket(id, body, cat, el) {
    var syms = MARKET_CATS[cat] || MARKET_CATS.gold;
    var title = el.querySelector('.tbc-widget-title');
    if (title) title.textContent = 'MARKET PRICES · ' + cat.toUpperCase();

    var tabs = Object.keys(MARKET_CATS).map(function (k) {
      return '<button class="tbw-mkt-cat' + (k===cat?' active':'') + '" data-cat="' + k + '">' + k.toUpperCase() + '</button>';
    }).join('');

    body.style.overflow = 'hidden';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.innerHTML = '<div class="tbw-mkt-cat-tabs">' + tabs + '</div><div id="' + id + '-mkt-grid" class="tbw-mkt-grid"></div><div class="tbw-mkt-footer">INDICATIVE · FINNHUB · ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</div>';

    body.querySelectorAll('.tbw-mkt-cat').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nc = btn.dataset.cat;
        _widgets[id].cfg.data.cat = nc;
        saveLayout();
        renderMarket(id, body, nc, el);
      });
    });

    var grid = document.getElementById(id + '-mkt-grid');
    grid.innerHTML = '<div class="tbw-loading" style="grid-column:1/-1;">FETCHING PRICES…</div>';

    Promise.all(syms.map(function (s) {
      return fetch('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(s.sym) + '&token=' + FINNHUB_KEY)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (q) { return {s:s, q:q}; })
        .catch(function () { return {s:s, q:null}; });
    })).then(function (results) {
      grid.innerHTML = results.map(function (r) {
        var q = r.q; var s = r.s;
        if (!q || !q.c) return '<div class="tbw-mkt-tile"><div class="tbw-mkt-lbl">' + escH(s.l) + '</div><div class="tbw-mkt-val" style="font-size:11px;color:#333">N/A</div></div>';
        var price = (q.c * s.mult).toFixed(2);
        var prev  = (q.pc * s.mult).toFixed(2);
        var chg   = (parseFloat(price) - parseFloat(prev));
        var pct   = prev ? (chg / parseFloat(prev) * 100).toFixed(2) : '0.00';
        var up    = chg >= 0;
        var cls   = up ? 'tbw-mkt-up' : 'tbw-mkt-dn';
        var arr   = up ? '▲' : '▼';
        return '<div class="tbw-mkt-tile">' +
          '<div class="tbw-mkt-lbl">' + escH(s.l) + '</div>' +
          '<div class="tbw-mkt-val">$' + price + '</div>' +
          '<div class="tbw-mkt-chg ' + cls + '">' + arr + ' ' + (up?'+':'') + chg.toFixed(2) + ' (' + (up?'+':'') + pct + '%)</div>' +
          '</div>';
      }).join('');
    });
  }

  var REPORTS_BASE = 'https://oqpodikelxhwcnjdwojw.supabase.co/storage/v1/object/public/Reports/';

  /* ── REPORTS BROWSER ── */
  function renderReports(id, body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';

    function tryRender() {
      var reports = window._dashReports;
      if (!reports) {
        body.innerHTML = '<div class="tbw-rep-empty">REPORTS LOADING…</div>';
        setTimeout(tryRender, 1500);
        return;
      }
      if (!reports.length) {
        body.innerHTML = '<div class="tbw-rep-empty">NO REPORTS AVAILABLE</div>';
        return;
      }

      /* Build type filter tabs */
      var typeSet = {};
      reports.forEach(function (r) { if (r.report_type) typeSet[r.report_type] = true; });
      var types = ['all'].concat(Object.keys(typeSet));

      var listId = id + '-rlist';
      body.innerHTML =
        '<div class="tbw-rep-filters">' +
          types.map(function (t) {
            return '<button class="tbw-rep-filter' + (t === 'all' ? ' active' : '') + '" data-rtype="' + escH(t) + '">' +
              (t === 'all' ? 'ALL' : t.replace(/_/g, ' ').toUpperCase()) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="tbw-rep-list" id="' + listId + '"></div>';

      var currentFilter = 'all';

      function renderList(filter) {
        var filtered = filter === 'all' ? reports : reports.filter(function (r) { return r.report_type === filter; });
        var el = document.getElementById(listId);
        if (!el) return;
        if (!filtered.length) { el.innerHTML = '<div class="tbw-rep-empty">NO REPORTS</div>'; return; }
        el.innerHTML = filtered.map(function (r) {
          return '<div class="tbw-rep-item" data-fp="' + escH(r.file_path||'') + '" data-title="' + escH(r.title||'') + '" data-asset="' + escH(r.asset_class||'') + '" data-rtype="' + escH(r.report_type||'') + '">' +
            '<div class="tbw-rep-asset">' + escH((r.asset_class||'REPORT').toUpperCase()) + '</div>' +
            '<div class="tbw-rep-title">' + escH(r.title||'') + '</div>' +
            '<div class="tbw-rep-date">' + fmtDate(r.published_date||r.published_at||r.created_at) + '</div>' +
            '<div class="tbw-rep-type">' + escH((r.report_type||'').replace(/_/g,' ').toUpperCase()) + '</div>' +
            '</div>';
        }).join('');
        el.querySelectorAll('.tbw-rep-item').forEach(function (row) {
          row.addEventListener('click', function () {
            openReportWidget(row.dataset.fp, row.dataset.title, row.dataset.asset, row.dataset.rtype);
          });
        });
      }

      renderList('all');

      body.querySelectorAll('.tbw-rep-filter').forEach(function (btn) {
        btn.addEventListener('click', function () {
          body.querySelectorAll('.tbw-rep-filter').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          currentFilter = btn.dataset.rtype;
          renderList(currentFilter);
        });
      });
    }
    tryRender();
  }

  /* Open a report as its own draggable/resizable widget */
  function openReportWidget(filePath, title, asset, rtype) {
    var fullUrl = REPORTS_BASE + filePath;
    var offset  = (Object.keys(_widgets).length % 5) * 30;
    var cfg = {
      id: 'w-rep-' + Date.now(),
      type: 'report_viewer',
      x: 40 + offset,
      y: 40 + offset,
      w: 960, h: 740,
      data: {url: fullUrl, title: title, asset: asset, rtype: rtype},
    };
    spawnWidget(cfg);
    saveLayout();
  }

  /* ── REPORT VIEWER WIDGET ── */
  function renderReportViewer(id, body, data) {
    var url = data.url || '';

    /* Update widget title */
    var titleEl = document.getElementById(id + '-title');
    if (titleEl && data.title) titleEl.textContent = (data.title || 'REPORT').toUpperCase().slice(0, 44);

    /* Add expand-to-fullscreen button in the action bar */
    var actions = document.querySelector('#' + id + ' .tbc-widget-actions');
    if (actions && !actions.querySelector('.expand-btn')) {
      var expandBtn = document.createElement('button');
      expandBtn.className = 'tbc-widget-btn expand-btn';
      expandBtn.title = 'Full screen';
      expandBtn.textContent = '⛶';
      expandBtn.addEventListener('click', function () {
        if (window.openReportDirectly) {
          window.openReportDirectly(url, data.title, data.asset, data.rtype);
        } else {
          window.open(url, '_blank', 'noopener');
        }
      });
      actions.insertBefore(expandBtn, actions.firstChild);
    }

    if (!url) { body.innerHTML = '<div class="tbw-loading">NO REPORT URL</div>'; return; }
    body.style.overflow = 'hidden';
    body.innerHTML = '<div class="tbw-loading" style="background:#080808;height:100%;display:flex;align-items:center;justify-content:center;">LOADING REPORT…</div>';

    fetch(url)
      .then(function (r) { return r.ok ? r.text() : Promise.reject('HTTP ' + r.status); })
      .then(function (html) {
        /* Inject minimal overrides: ensure sidebar + content both fit without horizontal clip */
        var css = '<style>' +
          'html,body{overflow-x:auto!important;}' +
          /* Give the page a sensible min-width so sidebar + content don't collapse */
          'body{min-width:0!important;}' +
          /* Anchor clicks stay inside iframe */
        '</style>';
        var anchorFix = '<script>document.addEventListener("click",function(e){' +
          'var a=e.target.closest("a[href]");if(!a)return;' +
          'var h=a.getAttribute("href");' +
          'if(h&&h[0]==="#"){e.preventDefault();var t=document.getElementById(h.slice(1));if(t)t.scrollIntoView({behavior:"smooth"});}' +
        '});<\/script>';
        var injected = html;
        if (injected.includes('</head>')) {
          injected = injected.replace('</head>', css + '</head>');
        } else {
          injected = css + injected;
        }
        if (injected.includes('</body>')) {
          injected = injected.replace('</body>', anchorFix + '</body>');
        }
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
        iframe.srcdoc = injected;
        body.innerHTML = '';
        body.appendChild(iframe);
      })
      .catch(function (err) {
        body.innerHTML = '<div class="tbw-loading" style="height:100%;display:flex;align-items:center;justify-content:center;">COULD NOT LOAD — ' + escH(String(err)) + '</div>';
      });
  }

  /* ── NOTES ── */
  var _notesSaveTimer = null;
  function renderNotes(id, body, text) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';
    body.innerHTML =
      '<textarea class="tbw-notes-area" id="' + id + '-ta" placeholder="Type your notes here…">' + escH(text) + '</textarea>' +
      '<div class="tbw-notes-status" id="' + id + '-status">NOTES AUTO-SAVE ON</div>';

    var ta  = document.getElementById(id + '-ta');
    var sta = document.getElementById(id + '-status');

    ta.addEventListener('input', function () {
      _widgets[id].cfg.data.text = ta.value;
      sta.className = 'tbw-notes-status';
      sta.textContent = 'UNSAVED';
      clearTimeout(_notesSaveTimer);
      _notesSaveTimer = setTimeout(function () {
        saveNotes(ta.value, sta);
      }, 1500);
    });
  }

  function saveNotes(text, statusEl) {
    if (!_sb || !_uid) return;
    _sb.from('user_preferences').upsert({ user_id: _uid, notes_content: text, updated_at: new Date().toISOString() })
      .then(function () {
        if (statusEl) { statusEl.className = 'tbw-notes-status saved'; statusEl.textContent = 'SAVED'; }
        setTimeout(function () {
          if (statusEl) { statusEl.className = 'tbw-notes-status'; statusEl.textContent = 'AUTO-SAVE ON'; }
        }, 2000);
      });
  }

  /* ── INTEL WIDGET (pinned from search) ── */
  function renderIntel(id, body, data) {
    if (!data || !data.query) { body.innerHTML = '<div class="tbw-loading">NO QUERY</div>'; return; }
    body.innerHTML = '<div class="tbw-loading">FETCHING INTEL…</div>';
    fetch('/.netlify/functions/search', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({query: data.query, type: data.type||'company', ticker: data.ticker||''}),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; return; }
        body.style.padding = '12px';
        if (d.type === 'company') {
          body.innerHTML =
            '<div style="font-size:8px;color:#E97132;letter-spacing:.2em;margin-bottom:8px;">' + escH(d.category||'') + ' · ' + escH(d.exchange||'') + '</div>' +
            '<div style="font-size:12px;color:#fff;font-weight:700;margin-bottom:6px;">' + escH(d.title||'') + '</div>' +
            '<div style="font-size:10px;color:#E97132;margin-bottom:10px;font-style:italic;">' + escH(d.tagline||'') + '</div>' +
            '<div style="font-size:10px;color:#c0c0c0;line-height:1.7;margin-bottom:12px;">' + escH(d.overview||'') + '</div>' +
            (d.keyFacts ? '<div style="font-size:7px;letter-spacing:.2em;color:#E97132;margin-bottom:6px;">KEY FACTS</div>' +
            '<ul style="list-style:none;padding:0;margin:0 0 12px;">' + (d.keyFacts||[]).map(function(f){ return '<li style="font-size:9px;color:#aaa;padding:3px 0;border-bottom:1px solid #111;display:flex;gap:6px;"><span style="color:#E97132;flex-shrink:0;">▪</span>' + escH(f) + '</li>'; }).join('') + '</ul>' : '') +
            (d.brokerNote ? '<div style="font-size:7px;letter-spacing:.2em;color:#E97132;margin-bottom:6px;">BROKER NOTE</div><div style="background:#0f0f0f;border-left:2px solid #E97132;padding:8px 10px;font-size:10px;color:#e0e0e0;line-height:1.7;font-style:italic;">' + escH(d.brokerNote) + '</div>' : '');
        } else {
          body.innerHTML = '<div style="font-size:12px;color:#fff;font-weight:700;margin-bottom:6px;">' + escH(d.title||'') + '</div><div style="font-size:10px;color:#c0c0c0;line-height:1.7;">' + escH(d.whatHappened||d.tagline||'') + '</div>';
        }
      })
      .catch(function () { body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; });
  }

  /* ── DRAG ── */
  function makeDraggable(el, handle) {
    var ox, oy, startX, startY;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('tbc-widget-btn')) return;
      ox = el.offsetLeft; oy = el.offsetTop;
      startX = e.clientX; startY = e.clientY;
      var _hasMoved = false;
      function onMove(e) {
        el.style.left = Math.max(0, ox + e.clientX - startX) + 'px';
        el.style.top  = Math.max(0, oy + e.clientY - startY) + 'px';
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (!_hasMoved && dx*dx + dy*dy > 100) _hasMoved = true;
        /* Drop-zone: highlight intel popouts the widget is dragged over */
        if (_hasMoved && window.createGenericPopout) {
          var cx = e.clientX, cy = e.clientY;
          var newTarget = null;
          document.querySelectorAll('.intel-popwin, .intel-tab-group').forEach(function (t) {
            var tr = t.getBoundingClientRect();
            if (cx > tr.left && cx < tr.right && cy > tr.top && cy < tr.bottom) newTarget = t;
          });
          document.querySelectorAll('.intel-drop-target').forEach(function (t) { t.classList.remove('intel-drop-target'); });
          if (newTarget) newTarget.classList.add('intel-drop-target');
          window._popwinDropTarget = newTarget;
        }
      }
      function onUp(e) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        document.querySelectorAll('.intel-drop-target').forEach(function (t) { t.classList.remove('intel-drop-target'); });
        var dropTarget = window._popwinDropTarget;
        window._popwinDropTarget = null;
        if (_hasMoved && dropTarget && window.createGenericPopout && window._mergeIntoGroup) {
          /* Pop widget out and merge it with the drop target */
          var widBody  = el.querySelector('.tbc-widget-body');
          var barTitle = (el.querySelector('.tbc-widget-title') || {}).textContent || el.id;
          var rect     = dropTarget.getBoundingClientRect();
          var popwin   = window.createGenericPopout(barTitle, '', function (popBody) {
            if (widBody) popBody.appendChild(widBody);
          }, { x: rect.left, y: rect.top, w: rect.width, h: rect.height });
          var wid = el.id;
          el.remove();
          if (_widgets) delete _widgets[wid];
          saveLayout();
          if (dropTarget.classList.contains('intel-tab-group') && dropTarget._addTab) {
            dropTarget._addTab(popwin._itTitle, popwin.querySelector('.intel-popwin-body'));
            popwin.remove();
          } else {
            window._mergeIntoGroup(popwin, dropTarget);
          }
        } else {
          updateCfgPos(el.id);
          saveLayout();
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      e.preventDefault();
    });
  }

  /* ── RESIZE (border-detection, all 8 directions) ── */
  var RESIZE_MARGIN = 7; /* px from edge that counts as border */

  function getResizeDir(el, e) {
    var r = el.getBoundingClientRect();
    var n = e.clientY - r.top    < RESIZE_MARGIN;
    var s = r.bottom - e.clientY < RESIZE_MARGIN;
    var w = e.clientX - r.left   < RESIZE_MARGIN;
    var east = r.right - e.clientX < RESIZE_MARGIN;
    if (!n && !s && !w && !east) return null;
    return {north:n, south:s, west:w, east:east};
  }

  function resizeCursor(dir) {
    if (!dir) return '';
    if (dir.north && dir.west)  return 'nw-resize';
    if (dir.north && dir.east)  return 'ne-resize';
    if (dir.south && dir.west)  return 'sw-resize';
    if (dir.south && dir.east)  return 'se-resize';
    if (dir.north)              return 'n-resize';
    if (dir.south)              return 's-resize';
    if (dir.west)               return 'w-resize';
    if (dir.east)               return 'e-resize';
    return '';
  }

  function makeResizable(el, id) {
    el.addEventListener('mousemove', function (e) {
      /* Don't fight with titlebar drag cursor */
      if (e.target.closest('.tbc-widget-bar')) { el.style.cursor = ''; return; }
      var dir = getResizeDir(el, e);
      el.style.cursor = resizeCursor(dir) || '';
    });
    el.addEventListener('mouseleave', function () { el.style.cursor = ''; });

    el.addEventListener('mousedown', function (e) {
      var dir = getResizeDir(el, e);
      if (!dir) return;
      /* Don't trigger when clicking buttons */
      if (e.target.closest('button, a')) return;
      e.preventDefault();
      e.stopPropagation();

      var startW = el.offsetWidth,  startH = el.offsetHeight;
      var startL = el.offsetLeft,   startT = el.offsetTop;
      var startX = e.clientX,       startY = e.clientY;
      var cur    = resizeCursor(dir);
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:' + cur + ';';
      document.body.appendChild(overlay);

      function onMove(e) {
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        if (dir.east)  el.style.width  = Math.max(200, startW + dx) + 'px';
        if (dir.south) el.style.height = Math.max(120, startH + dy) + 'px';
        if (dir.west) {
          var nw = Math.max(200, startW - dx);
          el.style.width = nw + 'px';
          el.style.left  = (startL + startW - nw) + 'px';
        }
        if (dir.north) {
          var nh = Math.max(120, startH - dy);
          el.style.height = nh + 'px';
          el.style.top    = (startT + startH - nh) + 'px';
        }
      }
      function onUp() {
        overlay.remove();
        updateCfgPos(id);
        saveLayout();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  /* ── HELPERS ── */
  function updateCfgPos(id) {
    var w = _widgets[id];
    if (!w) return;
    w.cfg.x = w.el.offsetLeft;
    w.cfg.y = w.el.offsetTop;
    w.cfg.w = w.el.offsetWidth;
    w.cfg.h = w.el.offsetHeight;
  }

  var _refreshTimers = {};
  function el_refresh_timer(id) { return _refreshTimers[id] || null; }
  function set_refresh_timer(id, t) { _refreshTimers[id] = t; }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr), now = Date.now();
    var diff = Math.floor((now - d) / 60000);
    if (diff < 1)  return 'just now';
    if (diff < 60) return diff + 'm ago';
    var h = Math.floor(diff / 60);
    if (h < 24)   return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function fmtDate(str) {
    if (!str) return '';
    var d = new Date(str);
    return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
  }

  function escH(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  var _decodeTA = null;
  function decodeRssEntities(str) {
    if (!_decodeTA) { _decodeTA = document.createElement('textarea'); }
    _decodeTA.innerHTML = String(str || '');
    return _decodeTA.value;
  }

  /* ── SAVE / LOAD ── */
  window.saveLayout = saveLayout;   /* exposed so intel-search.js can trigger saves */
  function saveLayout() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      if (!_sb || !_uid) return;
      var layout = Object.values(_widgets).map(function (w) { return w.cfg; });
      var intel  = window._getIntelPopouts ? window._getIntelPopouts() : [];
      _sb.from('user_preferences').upsert({
        user_id: _uid,
        dashboard_layout: layout,
        intel_popouts: intel,
        updated_at: new Date().toISOString(),
      }).then(function () {}).catch(function () {});
    }, 800);
  }

  function loadPreferences() {
    if (!_sb || !_uid) return Promise.resolve(null);
    return _sb.from('user_preferences').select('dashboard_layout,notes_content,intel_popouts').eq('user_id', _uid).single()
      .then(function (res) { return res.data || null; })
      .catch(function () { return null; });
  }

  /* ── CHAT BRIDGE ── */
  function renderChatBridge(id, body) {
    body.style.overflow = 'hidden';
    body.style.height = '100%';
    if (window.renderChatWidget) {
      window.renderChatWidget(id, body, _sb, {id: _uid, firmId: _firmId, name: _userName});
    } else {
      body.innerHTML = '<div class="tbw-loading">CHAT MODULE NOT LOADED</div>';
    }
  }

  /* ── NOTES INBOX BRIDGE ── */
  function renderNotesInboxBridge(id, body) {
    body.style.overflow = 'hidden';
    if (window.renderNotesInboxWidget) {
      window.renderNotesInboxWidget(id, body, _sb, _uid, _firmId, _userName);
    } else {
      body.innerHTML = '<div class="tbw-loading">NOTES MODULE NOT LOADED</div>';
    }
  }

  /* ── ECONOMIC CALENDAR ── */
  function renderEconCalendar(id, body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';

    var impactColor = {high:'#e05050', medium:'#E97132', low:'#888'};
    var impactLabel = {high:'HIGH', medium:'MED', low:'LOW'};

    body.innerHTML = '<div class="tbw-loading" style="padding:20px;text-align:center;">FETCHING EVENTS…</div>';

    fetch('/.netlify/functions/econ-calendar')
      .then(function (r) { return r.ok ? r.json() : r.json().then(function(e){ return Promise.reject(e.error || r.status); }); })
      .then(function (data) {
        var events = (Array.isArray(data) ? data : []).filter(function (e) { return e.event; });
        if (!events.length) {
          body.innerHTML = '<div class="tbw-loading">NO UPCOMING EVENTS</div>';
          return;
        }

        /* Group by date — FMP uses `date` field like "2025-08-25 08:30:00" */
        var grouped = {};
        events.forEach(function (e) {
          var raw = e.date || e.time || '';
          var d = raw.slice(0, 10) || 'Unknown';
          if (!grouped[d]) grouped[d] = [];
          grouped[d].push(e);
        });

        var html = '';
        Object.keys(grouped).sort().forEach(function (date) {
          var d = new Date(date + 'T12:00:00');
          var label = d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
          html += '<div class="tec-date-hdr">' + label + '</div>';
          grouped[date].forEach(function (e) {
            /* FMP impact: "High", "Medium", "Low" */
            var impact = (e.impact || 'low').toLowerCase();
            var col = impactColor[impact] || '#888';
            var lbl = impactLabel[impact] || impact.toUpperCase();
            var actual   = (e.actual   != null && e.actual   !== '') ? String(e.actual)   : '—';
            var estimate = (e.estimate != null && e.estimate !== '') ? String(e.estimate) : '—';
            var prev     = (e.previous != null && e.previous !== '') ? String(e.previous) : '—';
            var rawTime  = e.date || '';
            var timeStr  = rawTime.length > 10 ? rawTime.slice(11, 16) + ' UTC' : '';
            html +=
              '<div class="tec-event">' +
                '<div class="tec-event-top">' +
                  '<span class="tec-impact" style="color:' + col + '">● ' + lbl + '</span>' +
                  '<span class="tec-country">' + escH(e.country || '') + '</span>' +
                  '<span class="tec-time">' + escH(timeStr) + '</span>' +
                '</div>' +
                '<div class="tec-event-name">' + escH(e.event || '') + '</div>' +
                '<div class="tec-event-vals">' +
                  '<span class="tec-val"><span class="tec-val-lbl">ACTUAL</span>' + escH(actual) + (e.unit ? ' ' + escH(e.unit) : '') + '</span>' +
                  '<span class="tec-val"><span class="tec-val-lbl">FORECAST</span>' + escH(estimate) + '</span>' +
                  '<span class="tec-val"><span class="tec-val-lbl">PREV</span>' + escH(prev) + '</span>' +
                '</div>' +
              '</div>';
          });
        });

        body.innerHTML = '<div class="tec-list">' + html + '</div>';
      })
      .catch(function (err) {
        body.innerHTML = '<div class="tbw-loading">COULD NOT LOAD — ' + escH(String(err)) + '</div>';
      });
  }

  /* ── CALENDAR BRIDGE ── */
  function renderCalendarBridge(id, body) {
    body.style.overflow = 'hidden';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    if (window.renderCalendarWidget) {
      window.renderCalendarWidget(id, body, _sb, _uid);
    } else {
      body.innerHTML = '<div class="tbw-loading">CALENDAR MODULE NOT LOADED</div>';
    }
  }

  /* ── OPEN / FOCUS FIRM NOTES WIDGET ── */
  window.terminalOpenFirmNotes = function () {
    /* Switch to terminal tab first */
    var termTab = document.querySelector('.tbc-tab[data-tab="terminal"]');
    if (termTab) termTab.click();

    /* Find existing notes_inbox widget and flash it */
    var existing = Object.keys(_widgets).find(function (wid) { return _widgets[wid].cfg.type === 'notes_inbox'; });
    if (existing) {
      var el = _widgets[existing].el;
      el.style.zIndex = ++window._sharedZ;
      el.style.outline = '2px solid #E97132';
      setTimeout(function () { el.style.outline = ''; }, 1400);
      /* Refresh its content */
      var b = el.querySelector('.tbc-widget-body');
      if (b && b._notesLoad) b._notesLoad();
      return;
    }

    /* None exists — spawn one */
    var offset = Object.keys(_widgets).length * 24;
    var cfg = {id: 'w-notes-inbox-' + Date.now(), type: 'notes_inbox', x: 60 + offset, y: 60 + offset, w: 400, h: 520, data: {}};
    spawnWidget(cfg);
    saveLayout();
  };

  /* ── EXPOSE PIN FROM SEARCH ── */
  /* ── MACRO PRICES WIDGET ──────────────────────────────────────── */
  function renderMacroPrices(id, body) {
    body.innerHTML = '<div class="tbw-loading">LOADING…</div>';
    fetch('/.netlify/functions/macro-data?type=prices')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        function arrow(v) { return v > 0 ? '▲' : v < 0 ? '▼' : '—'; }
        function cls(v)   { return v > 0 ? 'mp-up' : v < 0 ? 'mp-dn' : ''; }
        function pctStr(v){ return (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'; }

        var goldUSD = d.gold ? d.gold.usd : null;
        var goldGBP = d.gold ? d.gold.gbp : null;
        var goldChg = d.gold ? d.gold.pct : null;

        var boeRate  = d.boe   ? d.boe.rate  : null;
        var boePrev  = d.boe   ? d.boe.prev  : null;
        var boeDiff  = (boeRate !== null && boePrev !== null) ? (boeRate - boePrev) : null;

        var rows = [
          { lbl:'GOLD / TROY OZ', sub:'LBMA · GBP',
            val: goldGBP ? '£' + goldGBP.toLocaleString('en-GB') : (goldUSD ? '$' + Math.round(goldUSD).toLocaleString() : '—'),
            chg: goldChg, isPct: true,
            alt: (goldUSD && goldGBP) ? '$' + Math.round(goldUSD).toLocaleString() : null },
          { lbl:'GBP / USD', sub:'STERLING RATE',
            val: d.gbpusd ? d.gbpusd.price.toFixed(4) : '—',
            chg: null },
          { lbl:'EUR / GBP', sub:'EURO RATE',
            val: d.eurgbp ? d.eurgbp.price.toFixed(4) : '—',
            chg: null },
          { lbl:'UK RATE', sub:'INTERBANK · BOE PROXY',
            val: boeRate !== null ? boeRate.toFixed(2) + '%' : '—',
            chg: boeDiff, isPct: false, unit: 'pp' },
          { lbl:'UK 10-YR GILT', sub:'GOVERNMENT BOND YIELD',
            val: (d.ukgilt && d.ukgilt.rate !== null) ? d.ukgilt.rate + '%' : '—',
            chg: null },
          { lbl:'UK CPI', sub:'YEAR-ON-YEAR',
            val: (d.ukcpi && d.ukcpi.yoy !== null) ? d.ukcpi.yoy + '%' : '—',
            chg: null },
          { lbl:'US FED RATE', sub:'FEDERAL RESERVE',
            val: (d.fed && d.fed.rate !== null) ? Number(d.fed.rate).toFixed(2) + '%' : '—',
            chg: null },
        ];

        var html = '<div class="mp-wrap">';
        rows.forEach(function (r) {
          var chgHtml = '';
          if (r.chg !== null && r.chg !== undefined) {
            var cv = parseFloat(r.chg);
            if (!isNaN(cv)) {
              var label = r.isPct ? pctStr(cv) : ((cv > 0 ? '+' : '') + cv.toFixed(2) + (r.unit || ''));
              chgHtml = '<span class="mp-chg ' + cls(cv) + '">' + arrow(cv) + ' ' + label + '</span>';
            }
          }
          html += '<div class="mp-row">' +
            '<div class="mp-left"><div class="mp-lbl">' + r.lbl + '</div><div class="mp-sub">' + r.sub + '</div></div>' +
            '<div class="mp-right"><div class="mp-val">' + r.val + '</div>' +
              (r.alt ? '<div class="mp-alt">' + r.alt + '</div>' : '') + chgHtml +
            '</div></div>';
        });
        html += '</div><div class="mp-ts">UPDATED ' + new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) + ' · FRED + FMP</div>';
        body.innerHTML = html;
      })
      .catch(function () { body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; });
  }

  /* ── ASSET COMPARISON CHART WIDGET ───────────────────────────── */
  function renderMacroChart(id, body) {
    body.innerHTML = '<div class="tbw-loading">LOADING…</div>';
    fetch('/.netlify/functions/macro-data?type=history&years=10')
      .then(function (r) { return r.json(); })
      .then(function (raw) {
        body._mcData = raw;
        drawMacroChart(body, raw, 10);

        /* Period buttons */
        body.querySelectorAll('.mc-period').forEach(function (btn) {
          btn.addEventListener('click', function () {
            body.querySelectorAll('.mc-period').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            drawMacroChart(body, body._mcData, parseInt(btn.dataset.y));
          });
        });
      })
      .catch(function () { body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; });
  }

  function drawMacroChart(body, raw, years) {
    /* Slice each series to selected period */
    var cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);
    var cutTs = cutoff.getTime();

    function slice(arr) {
      return (arr || []).filter(function (p) { return new Date(p.d).getTime() >= cutTs; });
    }
    function rebase(arr) {
      if (!arr.length) return [];
      var base = arr[0].v;
      return arr.map(function (p) { return { d: p.d, v: (p.v / base - 1) * 100 }; });
    }

    var series = [
      { key:'gold',  lbl:'Gold (GBP)',    col:'#E97132', data: rebase(slice(raw.gold))  },
      { key:'sp500', lbl:'S&P 500 (USD)', col:'#4a9eed', data: rebase(slice(raw.sp500)) },
      { key:'ukcpi', lbl:'UK CPI',        col:'#4caf7d', data: rebase(slice(raw.ukcpi)) },
    ].filter(function (s) { return s.data.length > 1; });

    if (!series.length) {
      body.innerHTML = '<div class="tbw-loading">NO DATA</div>';
      return;
    }

    /* SVG dimensions */
    var W = 460, H = 200, pl = 44, pr = 12, pt = 14, pb = 24;
    var cW = W - pl - pr, cH = H - pt - pb;

    /* Value range across all series */
    var allV = [];
    series.forEach(function (s) { s.data.forEach(function (p) { allV.push(p.v); }); });
    var minV = Math.floor(Math.min.apply(null, allV) / 10) * 10;
    var maxV = Math.ceil(Math.max.apply(null, allV) / 10) * 10;
    if (minV === maxV) { minV -= 10; maxV += 10; }

    /* Time range */
    var allT = [];
    series.forEach(function (s) { s.data.forEach(function (p) { allT.push(new Date(p.d).getTime()); }); });
    var minT = Math.min.apply(null, allT);
    var maxT = Math.max.apply(null, allT);

    function xp(d) { return pl + (new Date(d).getTime() - minT) / (maxT - minT) * cW; }
    function yp(v) { return pt + cH - (v - minV) / (maxV - minV) * cH; }

    /* Y-axis grid lines */
    var yTicks = [];
    var step = Math.round((maxV - minV) / 4 / 10) * 10 || 10;
    for (var y = Math.ceil(minV / step) * step; y <= maxV; y += step) yTicks.push(y);

    /* X-axis ticks — one per year */
    var xTicks = [];
    var yr0 = new Date(minT).getFullYear();
    var yr1 = new Date(maxT).getFullYear();
    for (var y2 = yr0 + 1; y2 <= yr1; y2++) {
      var t = new Date(y2 + '-01-01').getTime();
      if (t >= minT && t <= maxT) xTicks.push({ t: t, lbl: String(y2).slice(2) });
    }

    /* Build SVG */
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">';

    /* Grid lines */
    yTicks.forEach(function (v) {
      var ry = yp(v).toFixed(1);
      svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + ry + '" y2="' + ry + '" stroke="#1a1a1a" stroke-width="1"/>';
      var lbl = (v > 0 ? '+' : '') + v + '%';
      svg += '<text x="' + (pl - 3) + '" y="' + (parseFloat(ry) + 3.5) + '" text-anchor="end" font-size="7.5" font-family="Consolas,Menlo,monospace" fill="#555">' + lbl + '</text>';
    });

    /* Zero line */
    var zy = yp(0).toFixed(1);
    svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + zy + '" y2="' + zy + '" stroke="#333" stroke-width="1" stroke-dasharray="3,2"/>';

    /* X ticks */
    xTicks.forEach(function (t) {
      var rx = xp(t.t).toFixed(1);
      svg += '<text x="' + rx + '" y="' + (H - pb + 10) + '" text-anchor="middle" font-size="7" font-family="Consolas,Menlo,monospace" fill="#444">' + t.lbl + '</text>';
    });

    /* Series paths */
    series.forEach(function (s) {
      var d = s.data.map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + xp(p.d).toFixed(1) + ',' + yp(p.v).toFixed(1);
      }).join(' ');
      svg += '<path d="' + d + '" fill="none" stroke="' + s.col + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';

      /* End-point dot + value label */
      var last = s.data[s.data.length - 1];
      if (last) {
        var ex = xp(last.d), ey = yp(last.v);
        svg += '<circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="2.5" fill="' + s.col + '"/>';
      }
    });

    svg += '</svg>';

    /* Legend */
    var legend = '<div class="mc-legend">' + series.map(function (s) {
      var last = s.data[s.data.length - 1];
      var pct  = last ? (last.v > 0 ? '+' : '') + last.v.toFixed(1) + '%' : '';
      return '<span class="mc-leg-item"><span class="mc-leg-dot" style="background:' + s.col + '"></span>' + s.lbl + '<span class="mc-leg-val" style="color:' + s.col + '">' + pct + '</span></span>';
    }).join('') + '</div>';

    /* Period buttons */
    var periods = [1, 3, 5, 10];
    var btnHtml = '<div class="mc-periods">' + periods.map(function (y) {
      return '<button class="mc-period' + (y === years ? ' active' : '') + '" data-y="' + y + '">' + y + 'Y</button>';
    }).join('') + '</div>';

    /* Preserve scroll, rebuild inner content */
    var inner = body.querySelector('.mc-inner');
    if (!inner) {
      body.innerHTML = '<div class="mc-inner"></div>';
      inner = body.querySelector('.mc-inner');
    }
    inner.innerHTML = btnHtml + '<div class="mc-svg-wrap">' + svg + '</div>' + legend +
      '<div class="mp-ts">GOLD (LBMA·GBP) · S&P 500 · UK CPI — SOURCE: FRED</div>';

    /* Re-attach period button listeners */
    inner.querySelectorAll('.mc-period').forEach(function (btn) {
      btn.addEventListener('click', function () {
        inner.querySelectorAll('.mc-period').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        drawMacroChart(body, body._mcData, parseInt(btn.dataset.y));
      });
    });
  }

  /* ── MACRO INTELLIGENCE WIDGET ─────────────────────────────────── */
  function renderMacroIntel(id, body) {
    body.innerHTML = '<div class="tbw-loading">LOADING INTELLIGENCE…</div>';

    fetch('/.netlify/functions/macro-data?type=intel')
      .then(function (r) { return r.json(); })
      .then(function (d) {

        var THEMES = [
          {
            key: 'repression',
            label: 'FINANCIAL REPRESSION',
            short: 'REPRESSION',
            accent: '#E97132',
            headline: function () {
              var g = d.repression.ukGilt.cur, c = d.repression.ukCpi.cur;
              if (g === null || c === null) return null;
              var real = (g - c).toFixed(2);
              var sign = real >= 0 ? '+' : '';
              return { value: sign + real + '%', sub: 'UK REAL YIELD  ·  GILT ' + g.toFixed(2) + '% − CPI ' + c.toFixed(1) + '%' };
            },
            what: 'Real yield is the return you earn after inflation has taken its cut. A gilt yielding 4.8% when inflation runs at 3.4% pays a real return of just 1.4%. For the entirety of 2020–2022, UK real rates were deeply negative — bondholders were losing purchasing power whilst appearing to earn a return. The structural mechanism that punishes patient capital has not been dismantled. It has merely been paused.',
            why: 'Central banks have used financial repression — keeping real rates below zero to inflate away government debt — in every major debt cycle since World War Two. The current reading of barely positive real yields is historically fragile. If inflation re-accelerates or rates are cut to support growth, real yields turn negative again. Savers pay the cost invisibly. The pound in the account loses value without the statement ever showing a loss.',
            pitch: 'Here is what your client needs to understand. Their gilt holding yields 4.8% on paper. After 3.4% inflation, they are keeping fewer than 15 pence of every pound earned in real purchasing power. Over a decade of deeply negative real rates, the effect compounds into serious wealth erosion — the kind that does not appear on a statement until it is too late to act. Gold holds no coupon and no maturity date. But unlike a gilt, it has no yield-to-inflation gap, no counterparty, and no government required to honour its value. Over fifty years it has broadly tracked the debasement of the currencies against which it is priced. The question worth asking your client is not whether they can afford gold. It is whether they can afford to continue holding the instrument that loses ground to inflation by design.',
            pitchType: 'LOGICAL ARGUMENT',
          },
          {
            key: 'debasement',
            label: 'MONETARY DEBASEMENT',
            short: 'DEBASEMENT',
            accent: '#4a9eed',
            headline: function () {
              if (d.debasement.m2.cur === null) return null;
              var t = (d.debasement.m2.cur / 1000).toFixed(1);
              var prev = d.debasement.m2.prev;
              var delta = prev ? (((d.debasement.m2.cur - prev) / prev) * 100).toFixed(2) : null;
              return { value: '$' + t + 'T', sub: 'US M2 MONEY SUPPLY' + (delta ? '  ·  ' + (delta > 0 ? '+' : '') + delta + '% MOM' : '') };
            },
            what: 'M2 is the broadest measure of money circulating in the economy — cash, deposits, savings accounts, and money market funds. When central banks expand their balance sheets through quantitative easing, new money is created and M2 grows. More units of currency chasing the same pool of real assets means each unit purchases a smaller share of those assets. This is not abstract economics. It is arithmetic.',
            why: 'US M2 grew by over 40% between early 2020 and early 2022 — the fastest peacetime monetary expansion in recorded American history. That flood of liquidity drove asset prices sharply higher across equities, property, and commodities, including gold. M2 growth has since slowed substantially but the expanded base remains. Every trillion added to that base represents a dilution of existing dollar purchasing power, distributed silently across every holder of dollar-denominated assets.',
            pitch: 'Consider the economy as a finite pool of real assets — land, commodities, productive businesses, infrastructure. Now imagine multiplying the number of claims (dollars) that can be used to acquire a share of those assets without adding new assets to the pool. Each claim buys a smaller fraction. The US money supply stood at under five trillion dollars in the year 2000. It stands at over twenty-one trillion today. Gold moved from two hundred and seventy dollars per ounce to over two thousand dollars in the same period. That is not a speculative rally. That is the gold price denominated in a currency that lost most of its purchasing power. For your clients holding cash or bonds — the instruments being diluted — gold represents the exit from the mechanism itself.',
            pitchType: 'LOGICAL ARGUMENT + PAIN AWARENESS',
          },
          {
            key: 'cycle',
            label: 'BUSINESS CYCLE',
            short: 'CYCLE',
            accent: '#4caf7d',
            headline: function () {
              if (d.cycle.curve.cur === null) return null;
              var vc = d.cycle.curve.cur.toFixed(2);
              var cl = d.cycle.claims.cur ? Math.round(d.cycle.claims.cur).toLocaleString() : null;
              return { value: (vc >= 0 ? '+' : '') + vc + '%', sub: '10YR–2YR YIELD CURVE' + (cl ? '  ·  CLAIMS ' + cl + 'K' : '') };
            },
            what: 'The yield curve measures the gap between long-term and short-term government borrowing costs. Under normal conditions it slopes upward — lenders demand more compensation for longer commitments. When short-term rates exceed long-term rates, the curve inverts, signalling that markets expect the economy to contract and rates to be cut. The critical signal is not the inversion itself. It is what happens when it ends.',
            why: 'The yield curve inverted sharply in 2022–23, one of the deepest readings in four decades. It is now disinverting — normalising. History since 1970 is without exception on this point: every US recession followed inversion and then disinversion. The disinversion is not the all-clear. It is the arrival of the storm the barometer already predicted. Initial jobless claims beginning to tick higher confirm the sequence is in motion.',
            pitch: 'The yield curve is not a forecast. It is a measurement of market expectation, calibrated across trillions of dollars of institutional positioning. It has inverted before every US recession since 1970. Without exception. The sequence is inversion — disinversion — recession. We are in the disinversion phase. Initial claims are beginning to rise. Manufacturing ISM has been sub-fifty for consecutive months. These are not opinions. They are the same readings that preceded every downturn in living memory. Late cycle is precisely the moment when institutional capital — quietly, without fanfare — rotates from growth assets into real assets. Your clients do not need to wait for a headline recession to confirm what the leading indicators are already telling them. The time to position is before the crowd agrees.',
            pitchType: 'CONTRARIAN OPPORTUNITY + FUTURE PACING',
          },
          {
            key: 'ukdebt',
            label: 'UK DEBT CRISIS',
            short: 'UK DEBT',
            accent: '#c87adf',
            headline: function () {
              if (d.ukdebt.ukGilt.cur === null) return null;
              var g = d.ukdebt.ukGilt.cur.toFixed(2);
              var c = d.ukdebt.ukCpi.cur !== null ? d.ukdebt.ukCpi.cur.toFixed(1) : null;
              return { value: g + '%', sub: 'UK 10YR GILT' + (c ? '  ·  CPI ' + c + '%' : '') };
            },
            what: 'The UK carries over two and a half trillion pounds in public debt, much of it issued at near-zero rates during the quantitative easing era of 2009–2021. As those gilts mature and require refinancing, the Treasury is rolling over cheap legacy debt at 4–5% market yields. Simultaneously, UK corporate insolvencies have been rising for three consecutive years and consumer credit — credit cards and unsecured loans — sits at multi-decade highs. The debt burden is not a future risk. It is a present drag.',
            why: 'Refinancing legacy low-rate debt at current yields is a scheduled, measurable drain on the UK fiscal position. Tens of billions of maturing gilts must be replaced annually at rates two to three times higher than the originals. This structural squeeze creates a difficult arithmetic: either higher taxes, reduced government spending, higher borrowing, or some combination of all three. Each option constrains domestic growth and, over time, sterling purchasing power relative to harder assets.',
            pitch: 'Sterling assets carry sterling risk — not only price risk, but currency risk, domestic political risk, and now explicit fiscal risk. Your clients concentrated in UK equities, UK property, and gilts are implicitly long the pound and long the UK government\'s ability to manage the most complex debt refinancing in modern British economic history. Gold is priced internationally in dollars, held as a reserve asset by central banks across over one hundred and fifty countries, and has no maturity date, no refinancing requirement, and no government counterparty. For a UK-centric portfolio, it provides the one thing most clients do not realise they are missing: genuine geographic and currency diversification at the moment when the UK-specific risk premium is rising, not falling.',
            pitchType: 'RISK/PAIN AWAKENING + PEER COMPARISON',
          },
          {
            key: 'gilts',
            label: 'THE GILT PROBLEM',
            short: 'GILTS',
            accent: '#e04040',
            headline: function () {
              if (d.gilts.ukGilt.cur === null) return null;
              var g = d.gilts.ukGilt.cur.toFixed(2);
              var us = d.gilts.usTsy.cur !== null ? d.gilts.usTsy.cur.toFixed(2) : null;
              var sp = d.gilts.giltSpread.cur !== null ? (d.gilts.giltSpread.cur >= 0 ? '+' : '') + d.gilts.giltSpread.cur.toFixed(2) + '%' : null;
              return { value: g + '%', sub: 'UK 10YR' + (us ? '  ·  US 10YR ' + us + '%' : '') + (sp ? '  ·  SPREAD ' + sp : '') };
            },
            what: 'UK gilts currently yield more than US Treasuries — unusual given that the United States has a larger economy, deeper capital markets, and the world\'s reserve currency. This premium reflects the market demanding compensation for UK-specific risks: persistent domestic inflation, a structural fiscal deficit, a large gilt issuance calendar, and systemic vulnerabilities in the liability-driven investment strategies used by UK pension funds.',
            why: 'The LDI crisis of September 2022 revealed precisely how fragile the UK gilt market had become. Pension funds had built leveraged positions using gilts as collateral. When gilt prices fell sharply following the mini-budget, funds received margin calls and were forced to sell gilts to raise cash — driving prices lower still, triggering further margin calls. The Bank of England was compelled to intervene with emergency purchases. The structural conditions that caused this — large pension fund gilt exposures, ongoing government borrowing, and a market with limited liquidity buffers — remain substantially intact.',
            pitch: 'Gilts are not the safe haven they once were. September 2022 proved this at an institutional scale: a market that required emergency Bank of England intervention to prevent a cascade failure is not a risk-free store of capital — it is a market with a loaded spring mechanism that has been temporarily reset. The pension funds that came closest to collapse were holding the instrument most widely described as safe. Physical gold held in allocated, segregated storage sits entirely outside this network of counterparty obligations. It cannot be posted as collateral. It cannot trigger a margin call. It has no issuer. For clients who hold gilts as their conservative allocation, the question worth posing is a simple one: safe from what, exactly?',
            pitchType: 'RISK/PAIN AWAKENING + CONTRARIAN',
          },
        ];

        var _activeIdx = 0;

        function buildPanel(ai) {
          var theme = THEMES[ai];
          var hl = null;
          try { hl = theme.headline(); } catch (e) {}

          var tabHtml = '<div class="mi-tabs">' + THEMES.map(function (t, i) {
            return '<button class="mi-tab' + (i === ai ? ' mi-tab-active' : '') + '" data-idx="' + i + '" data-accent="' + t.accent + '">' + t.short + '</button>';
          }).join('') + '</div>';

          var metricHtml = hl
            ? '<div class="mi-metric"><span class="mi-metric-val" style="color:' + theme.accent + '">' + hl.value + '</span><span class="mi-metric-sub">' + hl.sub + '</span></div>'
            : '<div class="mi-metric mi-metric-na">SERIES UNAVAILABLE — FRED MAY HAVE A LAG</div>';

          var pitchSafe = theme.pitch.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

          var panelHtml =
            '<div class="mi-panel">' +
              metricHtml +
              '<div class="mi-section">' +
                '<div class="mi-sec-hdr">WHAT IT IS</div>' +
                '<div class="mi-sec-body">' + theme.what + '</div>' +
              '</div>' +
              '<div class="mi-section">' +
                '<div class="mi-sec-hdr">WHY IT MATTERS NOW</div>' +
                '<div class="mi-sec-body">' + theme.why + '</div>' +
              '</div>' +
              '<div class="mi-section mi-pitch-wrap" style="border-left-color:' + theme.accent + '">' +
                '<div class="mi-sec-hdr" style="color:' + theme.accent + '">THE PITCH  <span class="mi-pitch-type">[' + theme.pitchType + ']</span></div>' +
                '<div class="mi-sec-body mi-pitch-body">' + pitchSafe + '</div>' +
                '<button class="mi-copy-btn" style="border-color:' + theme.accent + ';color:' + theme.accent + '">◈ COPY PITCH</button>' +
              '</div>' +
            '</div>';

          body.innerHTML = '<div class="mi-wrap">' + tabHtml + panelHtml + '</div>';

          /* Tab clicks */
          body.querySelectorAll('.mi-tab').forEach(function (btn) {
            var idx = parseInt(btn.dataset.idx);
            var ac  = btn.dataset.accent;
            if (idx === ai) { btn.style.background = ac; btn.style.borderColor = ac; btn.style.color = '#000'; }
            btn.addEventListener('click', function () { buildPanel(idx); });
          });

          /* Copy pitch */
          body.querySelector('.mi-copy-btn').addEventListener('click', function () {
            var btn = this;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(theme.pitch).then(function () {
                btn.textContent = '✓ COPIED TO CLIPBOARD';
                setTimeout(function () { btn.textContent = '◈ COPY PITCH'; }, 2500);
              });
            }
          });
        }

        buildPanel(0);
      })
      .catch(function () {
        body.innerHTML = '<div class="tbw-loading">MACRO INTELLIGENCE UNAVAILABLE</div>';
      });
  }

  window.terminalPinSearch = function (query, type, ticker, label) {
    var cfg = {
      id: 'w-intel-' + Date.now(),
      type: 'intel',
      x: 40 + Object.keys(_widgets).length * 24,
      y: 40 + Object.keys(_widgets).length * 24,
      w: 380, h: 480,
      data: {query: query, type: type, ticker: ticker},
    };
    var titleEl = document.querySelector('#' + cfg.id + '-title');
    spawnWidget(cfg);
    var t = document.querySelector('#' + cfg.id + '-title');
    if (t) t.textContent = (label || query).toUpperCase().slice(0, 30);
    saveLayout();
    /* switch to terminal tab */
    var termTab = document.querySelector('.tbc-tab[data-tab="terminal"]');
    if (termTab) termTab.click();
  };

})();
