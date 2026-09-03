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

  window.terminalCanvasInit = function (supabaseClient, userId, firmId, userName, userEmail) {
    _sb       = supabaseClient;
    _uid      = userId;
    _firmId   = firmId   || null;
    _userName = userName || 'BROKER';
    window._isOwner = (userEmail === 'admin@thebrokersterminal.com');
    _canvas = document.getElementById('tbc-canvas');
    if (!_canvas) return;

    buildTabBar();
    loadPreferences().then(function (prefs) {
      var layout = (prefs && prefs.dashboard_layout) ? prefs.dashboard_layout : DEFAULT_LAYOUT;
      var notes  = (prefs && prefs.notes_content)    ? prefs.notes_content    : '';
      /* One-time migration: strip the erroneous 44px nav offset that was added by a bad clamp.
         Flag stored in localStorage so it only runs once per browser. */
      var migrated = localStorage.getItem('tbt_layout_nav_fix') === '1';
      if (!migrated) {
        layout.forEach(function (cfg) { if (cfg.y >= 44) cfg.y = Math.max(0, cfg.y - 44); });
        localStorage.setItem('tbt_layout_nav_fix', '1');
        /* Persist corrected positions immediately */
        setTimeout(saveLayout, 200);
      }
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

    if (window._isOwner) {
      /* Owner: full terminal access */
      bar.innerHTML =
        '<button class="tbc-tab active" data-tab="terminal">▌ TERMINAL</button>' +
        '<div class="tbc-tab-sep"></div>' +
        '<button class="tbc-tab" data-tab="vault">VAULT</button>' +
        '<button class="tbc-tab" data-tab="news">NEWS FEED</button>' +
        '<button class="tbc-tab-add" id="tbc-add-btn">＋ ADD WIDGET</button>';
    } else {
      /* SANDBOX MODE — Vault only for all other users */
      bar.innerHTML =
        '<button class="tbc-tab active" data-tab="vault">VAULT</button>';

      /* Force vault visible, hide everything else immediately */
      var vaultEl = document.getElementById('vault-section');
      if (vaultEl) vaultEl.style.display = 'block';
      var canvasWrap = document.getElementById('tbc-canvas-wrap');
      if (canvasWrap) canvasWrap.style.display = 'none';
      var newsPanel = document.getElementById('tbc-news-panel');
      if (newsPanel) newsPanel.style.display = 'none';
      /* Hide terminal-only features */
      var intelCtr = document.getElementById('intel-search-container');
      if (intelCtr) intelCtr.style.display = 'none';
      var ticker = document.getElementById('content-ticker');
      if (ticker) { ticker.style.display = 'none'; document.body.classList.remove('ticker-on'); }
      var tickerRestore = document.getElementById('ttb-ticker-restore');
      if (tickerRestore) tickerRestore.style.display = 'none';
    }

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
        /* News feed panel — static HTML, lazy-load iframe src */
        var newsPanel = document.getElementById('tbc-news-panel');
        if (newsPanel) {
          if (tab === 'news') {
            var nif = document.getElementById('tbc-news-iframe');
            if (nif && !nif.src) nif.src = 'news.html';
          }
          newsPanel.style.display = tab === 'news' ? 'block' : 'none';
        }
        /* Ticker: only visible on terminal tab, respecting user's hidden preference */
        var ticker = document.getElementById('content-ticker');
        var restoreBtn = document.getElementById('ttb-ticker-restore');
        if (ticker) {
          if (tab === 'terminal') {
            /* Restore to user's preference when returning to terminal */
            var isHidden = window._tickerHidden || localStorage.getItem('tkHidden') === '1';
            if (!isHidden) {
              ticker.style.display = 'flex';
              document.body.classList.add('ticker-on');
              if (restoreBtn) restoreBtn.style.display = 'none';
            } else {
              ticker.style.display = 'none';
              document.body.classList.remove('ticker-on');
              if (restoreBtn) restoreBtn.style.display = '';
            }
          } else {
            /* Hide ticker on vault and news feed */
            ticker.style.display = 'none';
            document.body.classList.remove('ticker-on');
            if (restoreBtn) restoreBtn.style.display = 'none';
          }
        }
      });
    });

    /* tbc-add-btn only exists when terminal tab is present — skip in sandbox mode */
    var addBtn = document.getElementById('tbc-add-btn');
    if (addBtn) addBtn.addEventListener('click', function (e) { toggleAddMenu(e.currentTarget); });
  }

  /* ── ADD WIDGET MENU ── */
  var _addMenu = null;
  function toggleAddMenu(btn) {
    if (_addMenu) { _addMenu.remove(); _addMenu = null; return; }
    var rect = btn.getBoundingClientRect();
    _addMenu = document.createElement('div');
    _addMenu.className = 'tbc-add-menu';
    _addMenu.style.cssText = 'top:' + (rect.bottom + 4) + 'px;right:' + (window.innerWidth - rect.right) + 'px;';
    var _menuSections = [
      { cat: 'MARKETS', items: [
        {type:'market',        icon:'◉', lbl:'MARKET PRICES',      sub:'Live price tiles — gold, indices, FX'},
        {type:'watchlist',     icon:'◈', lbl:'MY WATCHLIST',        sub:'Pin tickers with live prices and day change'},
        {type:'sector_heatmap',icon:'▩', lbl:'SECTOR HEATMAP',      sub:'US equity sectors — day% with heatmap colouring'},
        {type:'macro_chart',   icon:'◐', lbl:'ASSET COMPARISON',    sub:'Gold vs S&P 500 vs inflation chart'},
      ]},
      { cat: 'INTELLIGENCE', items: [
        {type:'macro_intel',   icon:'◧', lbl:'MACRO INTELLIGENCE',  sub:'Professor + sales engine — 5 macro themes'},
        {type:'macro_monitor', icon:'▦', lbl:'MACRO MONITOR',       sub:'Cross-asset heatmap — 14 series WTD/QTD/YTD/1Y'},
        {type:'origin_web',    icon:'◎', lbl:'ORIGIN WEB',          sub:'Distillery supply network — countries, auction markets'},
        {type:'global_map',    icon:'◉', lbl:'GLOBAL MAP',          sub:'Macro rates, inflation, gold production, whisky regions'},
      ]},
      { cat: 'WHISKY', items: [
        {type:'whisky_lookup', icon:'▣', lbl:'WHISKY TERMINAL',     sub:'Live auction & retail prices — powered by WhiskyStats'},
        {type:'cask_calc',     icon:'◫', lbl:'CASK CALCULATOR',     sub:'Cask value, bottle yield, angel\'s share & ROI'},
      ]},
      { cat: 'NEWS & DATA', items: [
        {type:'news',          icon:'◈', lbl:'LIVE HEADLINES',      sub:'Latest news from all feeds'},
        {type:'ticker',        icon:'▸', lbl:'NEWS TICKER',         sub:'Scrolling headline bar — gold or whisky filter'},
        {type:'econ_calendar', icon:'◫', lbl:'ECONOMIC CALENDAR',   sub:'Upcoming market & macro events'},
      ]},
      { cat: 'WORKSPACE', items: [
        {type:'reports',       icon:'▣', lbl:'VAULT REPORTS',       sub:'Your latest saved reports'},
        {type:'notes',         icon:'✎', lbl:'MY NOTES',            sub:'Private scratchpad'},
        {type:'calendar',      icon:'◷', lbl:'CALENDAR',            sub:'Events & reminders'},
        {type:'chat',          icon:'◎', lbl:'FIRM CHAT',           sub:'Realtime firm messaging'},
        {type:'notes_inbox',   icon:'✉', lbl:'FIRM NOTES',          sub:'Shared intel notes from your firm'},
      ]},
    ];
    _addMenu.innerHTML = _menuSections.map(function(sec) {
      return '<div class="tbc-add-category">' + sec.cat + '</div>' +
        sec.items.map(function(w) {
          return '<div class="tbc-add-item" data-type="' + w.type + '">' +
            '<span class="tbc-add-icon">' + w.icon + '</span>' +
            '<div><div class="tbc-add-lbl">' + w.lbl + '</div><div class="tbc-add-sub">' + w.sub + '</div></div>' +
            '</div>';
        }).join('');
    }).join('');
    _addMenu.querySelectorAll('.tbc-add-item').forEach(function (row) {
      row.addEventListener('click', function () {
        var type = row.dataset.type;
        _addMenu.remove(); _addMenu = null;

        /* Ticker is not a canvas widget — just show/restore it */
        if (type === 'ticker') {
          window._tickerHidden = false;
          localStorage.setItem('tkHidden', '0');
          var ticker = document.getElementById('content-ticker');
          var restoreBtn = document.getElementById('ttb-ticker-restore');
          if (ticker) { ticker.style.display = 'flex'; document.body.classList.add('ticker-on'); }
          if (restoreBtn) restoreBtn.style.display = 'none';
          return;
        }

        var offset = Object.keys(_widgets).length * 24;
        var cfg = {
          id: 'w-' + Date.now(),
          type: type,
          x: 40 + offset, y: 40 + offset,
          w: type === 'notes' ? 280 : type === 'news' ? 400 : type === 'chat' ? 480 : type === 'calendar' || type === 'econ_calendar' ? 420 : type === 'macro_chart' ? 520 : type === 'macro_intel' ? 580 : type === 'macro_monitor' ? 720 : type === 'sector_heatmap' ? 620 : type === 'watchlist' ? 320 : type === 'global_map' ? 760 : type === 'origin_web' ? 920 : type === 'cask_calc' ? 720 : 340,
          h: type === 'news' || type === 'notes' ? 480 : type === 'chat' ? 440 : type === 'calendar' ? 380 : type === 'econ_calendar' ? 500 : type === 'macro_chart' ? 360 : type === 'macro_intel' ? 500 : type === 'macro_monitor' ? 480 : type === 'sector_heatmap' ? 380 : type === 'watchlist' ? 420 : type === 'global_map' ? 480 : type === 'origin_web' ? 600 : type === 'cask_calc' ? 620 : 240,
          data: type === 'market' ? {cat:'gold'} : {},
        };
        spawnWidget(cfg);
        saveLayout();
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
  function _minWidgetTop() {
    /* body has padding-top:44px for nav; ticker-on adds margin-top:34px to canvas-wrap.
       Both are handled by CSS so widget top:0 is always correct — no JS offset needed. */
    return 0;
  }

  function spawnWidget(cfg) {
    /* Clamp saved position — just prevent negatives */
    cfg.x = Math.max(0, cfg.x || 0);
    cfg.y = Math.max(0, cfg.y || 0);

    var el = document.createElement('div');
    el.className = 'tbc-widget';
    el.id = cfg.id;
    el.style.cssText = 'left:' + cfg.x + 'px;top:' + cfg.y + 'px;width:' + cfg.w + 'px;height:' + cfg.h + 'px;z-index:' + (++window._sharedZ) + ';';

    var icons = {news:'◈', market:'◉', reports:'▣', notes:'✎', intel:'◆', chat:'◎', calendar:'◷', notes_inbox:'✉', report_viewer:'▤', econ_calendar:'◫', macro_chart:'◐', macro_intel:'◧', macro_monitor:'▦', sector_heatmap:'▩', watchlist:'◈', global_map:'◉', origin_web:'◎'};
    var titles = {news:'LIVE HEADLINES', market:'MARKET PRICES', reports:'VAULT · LATEST', notes:'MY NOTES', intel:'BROKERS INTEL', chat:'FIRM CHAT', calendar:'CALENDAR', notes_inbox:'FIRM NOTES', report_viewer:'REPORT', econ_calendar:'ECONOMIC CALENDAR', macro_chart:'ASSET COMPARISON', macro_intel:'MACRO INTELLIGENCE', macro_monitor:'MACRO MONITOR', sector_heatmap:'SECTOR HEATMAP', watchlist:'MY WATCHLIST', global_map:'GLOBAL MAP', whisky_lookup:'WHISKY TERMINAL', cask_calc:'CASK CALCULATOR', origin_web:'ORIGIN WEB'};

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
    /* Expose a helper so intel-search.js can pop this widget out programmatically */
    el._tbcPopout = function () {
      if (!window.createGenericPopout) return null;
      var wb = el.querySelector('.tbc-widget-body');
      var wt = (el.querySelector('.tbc-widget-title') || {}).textContent || '';
      var wi = (el.querySelector('.tbc-widget-icon') || {}).textContent || '◆';
      var rect = el.getBoundingClientRect();
      var popwin = window.createGenericPopout(wt.trim(), wi.trim(), function (pb) {
        if (wb) pb.appendChild(wb);
      }, { x: rect.left, y: rect.top, w: rect.width, h: rect.height });
      el.remove();
      delete _widgets[cfg.id];
      saveLayout();
      return popwin;
    };
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
    else if (type === 'macro_monitor')  renderMacroMonitor(id, body);
    else if (type === 'sector_heatmap') renderSectorHeatmap(id, body);
    else if (type === 'watchlist')      renderWatchlist(id, body);
    else if (type === 'global_map')     renderGlobalMap(id, body);
    else if (type === 'macro_chart')    renderMacroChart(id, body);
    else if (type === 'macro_intel')    renderMacroIntel(id, body);
    else if (type === 'whisky_lookup')  renderWhiskyLookup(id, body);
    else if (type === 'cask_calc')      renderCaskCalc(id, body);
    else if (type === 'origin_web')     renderOriginWeb(id, body);
  }

  /* ── NEWS ── */
  var _NEWS_KW = {
    whisky: ['whisky','whiskey','scotch','bourbon','distillery','single malt','spirits','diageo','pernod','macallan','glenfiddich','glenlivet','balvenie','ardbeg','dalmore','springbank','bruichladdich','laphroaig','talisker','cask'],
    gold:   ['gold','silver','platinum','precious metal','xau','bullion','comex','spot gold','gold price','gold etf','mining','miner','gdx'],
    macro:  ['financialjuice']  /* FinancialJuice items are pre-filtered server-side to macro-only */
  };
  function _newsRelevant(s, asset) {
    var kw = _NEWS_KW[asset]; if (!kw) return false;
    var txt = ((s.title||'') + ' ' + (s.source||'')).toLowerCase();
    return kw.some(function(k){ return txt.includes(k); });
  }
  function openNewsStoryPopout(story) {
    var hl      = decodeRssEntities(story.title || story.headline || '');
    var src     = story.source || '';
    var ts      = story.datetime ? new Date(story.datetime * 1000).toISOString() : (story.pubDate || '');
    var ago     = ts ? timeAgo(ts) : '';
    var summary = story.description || story.summary || '';

    /* Guess category for the explain prompt */
    var cat = 'macro';
    if (_newsRelevant(story, 'whisky')) cat = 'whisky';
    else if (_newsRelevant(story, 'gold')) cat = 'gold';

    var z = (window._sharedZ || 1000) + 1;
    window._sharedZ = z;

    var pop = document.createElement('div');
    pop.className = 'tnp-popout';
    pop.style.cssText = 'top:90px;left:220px;z-index:' + z + ';';
    pop.innerHTML =
      '<div class="tnp-bar">' +
        '<span class="tnp-bar-lbl">▌ NEWS</span>' +
        '<span class="tnp-bar-src">' + escH(src) + (ago ? ' · ' + ago : '') + '</span>' +
        '<button class="tnp-close">✕</button>' +
      '</div>' +
      '<div class="tnp-body">' +
        '<div class="tnp-headline">' + escH(hl) + '</div>' +
        (summary ? '<div class="tnp-summary">' + escH(summary) + '</div>' : '') +
        '<div class="tnp-intel-wrap">' +
          '<button class="tnp-intel-btn">▌ BROKERS INTELLIGENCE — LOAD PITCH &amp; ANALYSIS</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(pop);
    makeDraggable(pop, pop.querySelector('.tnp-bar'));
    pop.addEventListener('mousedown', function () { window._sharedZ++; pop.style.zIndex = window._sharedZ; });
    pop.querySelector('.tnp-close').addEventListener('click', function () { pop.remove(); });

    pop.querySelector('.tnp-intel-btn').addEventListener('click', function () {
      var wrap = pop.querySelector('.tnp-intel-wrap');
      wrap.innerHTML = '<div class="tnp-intel-loading">ANALYSING<span class="tnp-ld"></span></div>';
      fetch('/.netlify/functions/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: hl, summary: summary, category: cat }),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || d.error) { wrap.innerHTML = '<div class="tnp-intel-err">Intelligence unavailable.</div>'; return; }
          var riskCls = d.risk === 'RISK ON' ? 'tnp-risk-on' : d.risk === 'RISK OFF' ? 'tnp-risk-off' : 'tnp-risk-neu';
          var html = '<div class="tnp-intel-panel">';
          if (d.what) html += '<div class="tnp-sec"><div class="tnp-sec-lbl">WHAT IT MEANS</div><div class="tnp-text">' + escH(d.what) + '</div>' + (d.analogy ? '<div class="tnp-analogy">"' + escH(d.analogy) + '"</div>' : '') + '</div>';
          if (d.risk) html += '<div class="tnp-sec"><div class="tnp-sec-lbl">RISK SIGNAL</div><div class="tnp-risk ' + riskCls + '"><span class="tnp-risk-dot"></span>' + escH(d.risk) + '</div>' + (d.riskReason ? '<div class="tnp-risk-reason">' + escH(d.riskReason) + '</div>' : '') + '</div>';
          html += '<div class="tnp-sec tnp-pitch-block"><div class="tnp-sec-lbl">HOW TO PITCH IT</div>';
          if (d.openingLine) html += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">OPEN WITH</div><div class="tnp-quote">"' + escH(d.openingLine) + '"</div></div>';
          if (d.pitch)       html += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">THE LOGICAL CASE</div><div class="tnp-pitch-txt">' + escH(d.pitch) + '</div></div>';
          if (d.futurePace)  html += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">FUTURE PACE</div><div class="tnp-pitch-txt tnp-future">' + escH(d.futurePace) + '</div></div>';
          if (d.spinQuestion)html += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">ASK THEM</div><div class="tnp-quote">"' + escH(d.spinQuestion) + '"</div></div>';
          if (d.urgency)     html += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">TIMING</div><div class="tnp-pitch-txt tnp-urgency">' + escH(d.urgency) + '</div></div>';
          html += '</div></div>';
          wrap.innerHTML = html;
        })
        .catch(function () { wrap.innerHTML = '<div class="tnp-intel-err">Intelligence unavailable.</div>'; });
    });
  }

  function renderNews(id, body) {
    var LS_KEY = 'tbt_rss_v2', LS_TS = 'tbt_rss_ts_v2', MAX_AGE = 600000; /* 10 min localStorage TTL */

    function lsGet() { try { var d=localStorage.getItem(LS_KEY); return d?JSON.parse(d):null; } catch(e){ return null; } }
    function lsSet(d) { try { localStorage.setItem(LS_KEY,JSON.stringify(d)); localStorage.setItem(LS_TS,Date.now()); } catch(e){} }
    function lsTs() { try { return parseInt(localStorage.getItem(LS_TS)||'0',10); } catch(e){ return 0; } }

    /* in-memory cache still used within same tab session */
    var cacheOk = window._rssCache && window._rssCacheTs && (Date.now() - window._rssCacheTs) < 180000;

    /* localStorage fallback — render immediately if we have recent data */
    var lsCached = lsGet();
    var lsFresh = lsCached && (Date.now() - lsTs()) < MAX_AGE;
    var initialStories = cacheOk ? window._rssCache : (lsCached || null);

    function doFetch() {
      var ctrl = new AbortController();
      var bail = setTimeout(function(){ ctrl.abort(); }, 12000);
      return fetch('/.netlify/functions/rss', { signal: ctrl.signal })
        .then(function(r){ clearTimeout(bail); return r.ok ? r.json() : null; })
        .then(function(d){ if(d){ window._rssCache=d; window._rssCacheTs=Date.now(); lsSet(d); } return d; })
        .catch(function(){ clearTimeout(bail); return null; });
    }

    var fetchStories;
    if (cacheOk) {
      fetchStories = Promise.resolve(window._rssCache);
    } else if (lsFresh) {
      /* render from localStorage immediately, refresh in background */
      fetchStories = Promise.resolve(lsCached);
      doFetch(); /* fire-and-forget background refresh */
    } else {
      fetchStories = doFetch();
    }

    fetchStories
      .then(function (stories) {
        if (!stories || !stories.length) {
          body.innerHTML = '<div class="tbw-loading" style="cursor:pointer" title="Click to retry">FEED UNAVAILABLE — TAP TO RETRY</div>';
          body.querySelector('.tbw-loading').addEventListener('click', function(){ renderNews(id, body); });
          return;
        }

        var activeFilter = 'all';

        function getFiltered(filter) {
          var twoHrsAgo = Math.floor(Date.now()/1000) - 7200;
          function pad(matched) {
            var isStale = !matched.length || matched[0].datetime < twoHrsAgo;
            if (!isStale) return matched.slice(0, 20);
            var seen = {}; matched.forEach(function(s){ seen[s.url]=true; });
            return matched.concat(stories.filter(function(s){ return !seen[s.url]; }).slice(0, 20 - matched.length)).slice(0, 20);
          }
          if (filter === 'whisky') return pad(stories.filter(function(s){ return _newsRelevant(s,'whisky'); }));
          if (filter === 'gold')   return pad(stories.filter(function(s){ return _newsRelevant(s,'gold'); }));
          if (filter === 'macro')  return pad(stories.filter(function(s){ return _newsRelevant(s,'macro'); }));
          return pad(stories.filter(function(s){ return _newsRelevant(s,'whisky')||_newsRelevant(s,'gold')||_newsRelevant(s,'macro'); }));
        }

        function renderList(filter) {
          activeFilter = filter;
          var top = getFiltered(filter);

          /* Update tab active states */
          body.querySelectorAll('.tbw-filter-tab').forEach(function(t){
            t.classList.toggle('active', t.dataset.filter === filter);
          });

          var listEl = body.querySelector('.tbw-news-list');
          listEl.innerHTML = top.length ? top.map(function(s) {
            var ts  = s.datetime ? new Date(s.datetime * 1000).toISOString() : (s.pubDate || '');
            var ago = timeAgo(ts);
            var hl  = decodeRssEntities(s.title || s.headline || '');
            return '<div class="tbw-news-item">' +
              '<div class="tbw-news-meta"><span class="tbw-news-time">' + ago + '</span></div>' +
              '<div class="tbw-news-hl">' + escH(hl) + '</div>' +
            '</div>';
          }).join('') : '<div class="tbw-loading">NO STORIES FOR THIS FILTER</div>';

          listEl.querySelectorAll('.tbw-news-item').forEach(function(row, i) {
            row.addEventListener('click', function(){ openNewsStoryPopout(top[i]); });
          });
        }

        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.innerHTML =
          '<div class="tbw-filter-bar">' +
            '<button class="tbw-filter-tab active" data-filter="all">ALL</button>' +
            '<button class="tbw-filter-tab" data-filter="whisky">WHISKY</button>' +
            '<button class="tbw-filter-tab" data-filter="gold">GOLD</button>' +
            '<button class="tbw-filter-tab" data-filter="macro">MACRO</button>' +
          '</div>' +
          '<div class="tbw-news-list"></div>' +
          '<div class="tbw-news-footer">' +
            '<span class="tbw-news-refresh">Updated ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</span>' +
            '<a class="tbw-news-link" href="news.html" target="_blank" rel="noopener">FULL TERMINAL ↗</a>' +
          '</div>';

        body.querySelectorAll('.tbw-filter-tab').forEach(function(tab) {
          tab.addEventListener('click', function(){ renderList(tab.dataset.filter); });
        });

        renderList('all');

        /* auto-refresh every 5 min */
        clearTimeout(el_refresh_timer(id));
        set_refresh_timer(id, setTimeout(function () { window._rssCache = null; renderNews(id, body); }, 300000));
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

    function fetchAndRenderMarket() {
      fetch('/.netlify/functions/macro-data?type=market&cat=' + encodeURIComponent(cat))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (quotes) {
          if (!quotes) { grid.innerHTML = '<div class="tbw-loading" style="grid-column:1/-1;">UNAVAILABLE</div>'; return; }
          /* update footer timestamp */
          var foot = body.querySelector('.tbw-mkt-footer');
          if (foot) foot.textContent = 'INDICATIVE · FINNHUB · ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
          grid.innerHTML = quotes.map(function (q) {
            if (!q.c) return '<div class="tbw-mkt-tile"><div class="tbw-mkt-lbl">' + escH(q.l) + '</div><div class="tbw-mkt-val" style="font-size:11px;color:#333">N/A</div></div>';
            var price = (q.c * q.mult).toFixed(2);
            var prev  = q.pc ? (q.pc * q.mult).toFixed(2) : price;
            var chg   = parseFloat(price) - parseFloat(prev);
            var pct   = q.dp ? q.dp.toFixed(2) : (prev ? (chg / parseFloat(prev) * 100).toFixed(2) : '0.00');
            var up    = chg >= 0;
            var cls   = up ? 'tbw-mkt-up' : 'tbw-mkt-dn';
            var arr   = up ? '▲' : '▼';
            return '<div class="tbw-mkt-tile">' +
              '<div class="tbw-mkt-lbl">' + escH(q.l) + '</div>' +
              '<div class="tbw-mkt-val">$' + price + '</div>' +
              '<div class="tbw-mkt-chg ' + cls + '">' + arr + ' ' + (up?'+':'') + chg.toFixed(2) + ' (' + (up?'+':'') + pct + '%)</div>' +
              '</div>';
          }).join('');
        })
        .catch(function () { grid.innerHTML = '<div class="tbw-loading" style="grid-column:1/-1;">UNAVAILABLE</div>'; });
    }

    fetchAndRenderMarket();
    /* auto-refresh every 60s */
    clearTimeout(el_refresh_timer(id));
    set_refresh_timer(id, setInterval(function () {
      if (!document.getElementById(id + '-mkt-grid')) { clearInterval(el_refresh_timer(id)); return; }
      fetchAndRenderMarket();
    }, 60000));
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

  /* ── SNAP GRID + EDGE MAGNETISM ── */
  var SNAP_GRID = 8;   /* fall-back grid pitch (px) */
  var SNAP_EDGE = 36;  /* magnetic pull radius (px) */

  function snapPosition(el, rawLeft, rawTop) {
    var w = el.offsetWidth, h = el.offsetHeight;
    var snapX = null, snapY = null;

    /* Compute canvas-to-viewport offset via offsetParent for reliability */
    var par = el.offsetParent;
    var offX, offY;
    if (par) {
      var pr = par.getBoundingClientRect();
      offX = pr.left - par.scrollLeft;
      offY = pr.top  - par.scrollTop;
    } else {
      /* Fixed element — rawLeft/rawTop are already viewport coords */
      offX = 0; offY = 0;
    }
    var vL = rawLeft + offX, vT = rawTop + offY;
    var vR = vL + w,         vB = vT + h;

    /* Groups get priority and a wider snap radius — check them before canvas widgets */
    var snapTargets = [];
    document.querySelectorAll('.intel-tab-group').forEach(function (g) { snapTargets.push(g); });
    document.querySelectorAll('.tbc-widget').forEach(function (w) { snapTargets.push(w); });

    snapTargets.forEach(function (other) {
      if (other === el) return;
      var isGroup = other.classList.contains('intel-tab-group');
      var SE = isGroup ? SNAP_EDGE * 2 : SNAP_EDGE;
      var or = other.getBoundingClientRect();
      if (!or.width && !or.height) return; /* skip invisible */

      if (snapX === null) {
        if      (Math.abs(vL - or.right)  < SE) snapX = or.right  - offX;
        else if (Math.abs(vR - or.left)   < SE) snapX = or.left   - offX - w;
        else if (Math.abs(vL - or.left)   < SE) snapX = or.left   - offX;
        else if (Math.abs(vR - or.right)  < SE) snapX = or.right  - offX - w;
      }
      if (snapY === null) {
        if      (Math.abs(vT - or.bottom) < SE) snapY = or.bottom - offY;
        else if (Math.abs(vB - or.top)    < SE) snapY = or.top    - offY - h;
        else if (Math.abs(vT - or.top)    < SE) snapY = or.top    - offY;
        else if (Math.abs(vB - or.bottom) < SE) snapY = or.bottom - offY - h;
      }
    });

    /* Screen-edge magnetism */
    if (snapX === null && vL < SNAP_EDGE) snapX = -offX;
    if (snapY === null && vT < SNAP_EDGE) snapY = -offY;

    /* Keep widget bar reachable — clamp to 0 (nav offset handled by body padding) or ticker height */
    return {
      left: Math.max(0,              snapX !== null ? snapX : Math.round(rawLeft / SNAP_GRID) * SNAP_GRID),
      top:  Math.max(_minWidgetTop(), snapY !== null ? snapY : Math.round(rawTop / SNAP_GRID) * SNAP_GRID)
    };
  }

  window._snapPosition = snapPosition; /* expose for intel-search.js */

  /* ── DRAG ── */
  function makeDraggable(el, handle) {
    var ox, oy, startX, startY;

    /* Double-click the bar → recentre the widget so it's always reachable */
    handle.addEventListener('dblclick', function (e) {
      if (e.target.classList.contains('tbc-widget-btn')) return;
      var minTop = _minWidgetTop();
      var vw = window.innerWidth, vh = window.innerHeight;
      var w  = el.offsetWidth,   h  = el.offsetHeight;
      el.style.left = Math.max(0,      Math.round((vw - w) / 2)) + 'px';
      el.style.top  = Math.max(minTop, Math.round((vh - 44 - h) / 2)) + 'px';
      updateCfgPos(el.id);
      saveLayout();
    });

    handle.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('tbc-widget-btn')) return;
      ox = el.offsetLeft; oy = el.offsetTop;
      startX = e.clientX; startY = e.clientY;
      var _hasMoved = false;
      function onMove(e) {
        var snapped = snapPosition(el, ox + e.clientX - startX, oy + e.clientY - startY);
        el.style.left = snapped.left + 'px';
        el.style.top  = snapped.top  + 'px';
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (!_hasMoved && dx*dx + dy*dy > 100) _hasMoved = true;
        /* Drop-zone: header-only hit-test against intel popouts */
        if (_hasMoved && window.createGenericPopout) {
          var cx = e.clientX, cy = e.clientY;
          var newTarget = null;
          document.querySelectorAll('.intel-popwin, .intel-tab-group').forEach(function (t) {
            var hdr = t.querySelector('.intel-popwin-titlebar, .intel-tg-bar');
            if (!hdr) return;
            var tr = hdr.getBoundingClientRect();
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

  /* ── MACRO MONITOR — cross-asset heatmap table ──────────────── */
  function renderMacroMonitor(id, body) {
    body.innerHTML = '<div class="tbw-loading">LOADING MONITOR…</div>';

    var sortCol = 'cat';
    var sortDir = 1;
    var filterQ = '';
    var lastData = null;
    var editMode = false;
    var catCache = null;
    var catFetching = false;

    var DEFAULT_SERIES = ['GOLDAMGBD228NLBM','DCOILWTICO','SP500','DEXUSUK','DEXUSEU',
      'IRLTLT01GBM156N','DGS10','DGS2','T10Y2Y','IRSTCI01GBM156N',
      'FEDFUNDS','CPALTT01GBM659N','CPIAUCSL','M2SL'];

    function mmGetUserSeries() {
      try {
        var stored = localStorage.getItem('tbt_mm_series_v1');
        if (stored) {
          var arr = JSON.parse(stored);
          if (Array.isArray(arr) && arr.length) {
            /* Migrate old GBP gold series ID to daily USD series */
            arr = arr.map(function(s) { return s === 'GOLDPMGBD228NLBM' ? 'GOLDAMGBD228NLBM' : s; });
            return arr;
          }
        }
      } catch(e) {}
      return DEFAULT_SERIES.slice();
    }
    function mmSaveUserSeries(arr) {
      try { localStorage.setItem('tbt_mm_series_v1', JSON.stringify(arr)); } catch(e) {}
    }

    var CAT_ORDER = ['COMMODITIES','EQUITIES','FX','RATES','INFLATION','LIQUIDITY','EMPLOYMENT','SENTIMENT'];

    function fmtLast(row) {
      var v = row.last;
      if (v === null) return '—';
      if (row.u === 'GBP/oz') return '£' + Math.round(v).toLocaleString('en-GB');
      if (row.u === 'USD/bbl') return '$' + v.toFixed(2);
      if (row.u === 'USD/oz') return '$' + v.toFixed(2);
      if (row.u === 'pts') return Math.round(v).toLocaleString();
      if (row.u === 'FX') return v.toFixed(4);
      if (row.u === 'JPY') return v.toFixed(2);
      if (row.u === '%') return v.toFixed(2) + '%';
      if (row.u === 'idx') return v.toFixed(1);
      if (row.u === '$bn') return '$' + Math.round(v / 1000).toLocaleString() + 'B';
      if (row.u === '$tn') return '$' + (v / 1000000).toFixed(1) + 'T';
      if (row.u === 'Mppl') return Math.round(v / 1000) + 'M';
      return v.toFixed(2);
    }
    function fmtNet(row) {
      var v = row.net;
      if (v === null) return '—';
      var s = v >= 0 ? '+' : '';
      if (row.u === 'GBP/oz' || row.u === 'USD/bbl') return s + v.toFixed(2);
      if (row.u === 'pts') return s + Math.round(v).toLocaleString();
      if (row.u === 'FX') return s + v.toFixed(4);
      if (row.u === '%') { var bp = Math.round(v * 100); return (bp >= 0 ? '+' : '') + bp + 'bp'; }
      return s + v.toFixed(2);
    }
    function hmStyle(pct) {
      if (pct === null) return '';
      var v = Math.max(-25, Math.min(25, pct));
      var i = Math.abs(v) / 25;
      var a = 0.12 + i * 0.65;
      if (v > 0)  return 'background:rgba(44,160,80,' + a.toFixed(2) + ');color:#fff;';
      if (v < 0)  return 'background:rgba(180,50,50,' + a.toFixed(2) + ');color:#fff;';
      return '';
    }
    function pctCell(pct) {
      if (pct === null || pct === undefined) return '<td class="mm-td mm-td-null">—</td>';
      var sign = pct >= 0 ? '+' : '';
      return '<td class="mm-td mm-td-pct" style="' + hmStyle(pct) + '">' + sign + pct.toFixed(2) + '%</td>';
    }
    function netCls(v) { return v === null ? '' : v > 0 ? 'mm-pos' : v < 0 ? 'mm-neg' : ''; }

    function buildTable(rows) {
      var q = filterQ.toLowerCase();
      var visible = rows.filter(function(r) { return !q || r.n.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q); });

      if (sortCol !== 'cat') {
        visible.sort(function(a, b) {
          var av = a[sortCol], bv = b[sortCol];
          if (av === null) return 1; if (bv === null) return -1;
          return (av - bv) * sortDir;
        });
      } else {
        visible.sort(function(a, b) {
          var ci = CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat);
          return ci !== 0 ? ci : 0;
        });
      }

      /* Trimmed column set — NET and QTD removed for cleaner layout */
      var cols = [
        { key:'n',   lbl:'INSTRUMENT' },
        { key:'last',lbl:'LAST'       },
        { key:'day', lbl:'DAY%'       },
        { key:'wtd', lbl:'WTD%'       },
        { key:'ytd', lbl:'YTD%'       },
        { key:'y1',  lbl:'1Y%'        },
      ];

      var colSpan = cols.length + (editMode ? 1 : 0);
      var thead = '<thead><tr>' + (editMode ? '<th class="mm-th mm-th-rm"></th>' : '') + cols.map(function(c) {
        var cls = 'mm-th' + (sortCol === c.key ? (' sort-' + (sortDir > 0 ? 'asc' : 'desc')) : '');
        return '<th class="' + cls + '" data-col="' + c.key + '">' + c.lbl + '</th>';
      }).join('') + '</tr></thead>';

      var prevCat = '';
      var tbody = '<tbody>';
      visible.forEach(function(r) {
        if (sortCol === 'cat' && r.cat !== prevCat) {
          prevCat = r.cat;
          tbody += '<tr class="mm-cat-row"><td colspan="' + colSpan + '"><span class="mm-cat-pip"></span>' + r.cat + '</td></tr>';
        }
        var dirIcon = r.day === null ? '<span class="mm-dir mm-dir-n">—</span>'
          : r.day > 0 ? '<span class="mm-dir mm-dir-up">▲</span>'
          : r.day < 0 ? '<span class="mm-dir mm-dir-dn">▼</span>'
          : '<span class="mm-dir mm-dir-n">—</span>';
        var liveDot = r.isLive ? '<span class="mm-live-row-dot" title="Live data">●</span>' : '';
        tbody += '<tr class="mm-tr" data-series="' + escH(r.chartId || r.s) + '" data-sid="' + escH(r.s) + '" data-name="' + escH(r.n) + '">' +
          (editMode ? '<td class="mm-td mm-td-rm"><button class="mm-rm-btn" data-sid="' + escH(r.s) + '" title="Remove">✕</button></td>' : '') +
          '<td class="mm-td mm-td-name">' + dirIcon + escH(r.n) + liveDot + '</td>' +
          '<td class="mm-td mm-td-last">' + fmtLast(r) + '</td>' +
          pctCell(r.day) +
          pctCell(r.wtd) +
          pctCell(r.ytd) +
          pctCell(r.y1) +
          '</tr>';
      });
      tbody += '</tbody>';

      return '<table class="mm-table">' + thead + tbody + '</table>';
    }

    function buildCatResults(q) {
      if (!catCache) return '<div style="font-family:Consolas,monospace;font-size:9px;color:#fff;padding:10px;">LOADING…</div>';
      var userSeries = mmGetUserSeries();
      var lq = q.toLowerCase();
      var filtered = catCache.filter(function(c) {
        return !lq || c.n.toLowerCase().indexOf(lq) !== -1 || c.s.toLowerCase().indexOf(lq) !== -1 || c.cat.toLowerCase().indexOf(lq) !== -1;
      });
      if (!filtered.length) return '<div style="font-family:Consolas,monospace;font-size:9px;color:#fff;padding:10px;">NO MATCHES</div>';
      var html = '';
      var prevCat = '';
      filtered.forEach(function(c) {
        var added = userSeries.indexOf(c.s) !== -1;
        if (c.cat !== prevCat) {
          prevCat = c.cat;
          html += '<div style="font-family:Consolas,monospace;font-size:7px;letter-spacing:.22em;color:#E97132;padding:7px 10px 3px;background:#0d0d0d;position:sticky;top:0;">' + c.cat + '</div>';
        }
        html += '<div class="mm-cat-item" data-sid="' + escH(c.s) + '" data-added="' + (added ? '1' : '0') + '" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #111;cursor:' + (added ? 'default' : 'pointer') + ';opacity:' + (added ? '.4' : '1') + ';">' +
          '<div style="font-family:Consolas,monospace;font-size:10px;color:#ffffff;flex:1;">' + escH(c.n) + '</div>' +
          '<div style="font-family:Consolas,monospace;font-size:8px;color:#E97132;letter-spacing:.1em;">' + escH(c.u) + '</div>' +
          '<div style="font-family:Consolas,monospace;font-size:9px;color:' + (added ? '#44cc64' : '#444') + ';width:14px;text-align:center;">' + (added ? '✓' : '+') + '</div>' +
        '</div>';
      });
      return html;
    }

    function buildAddPanel() {
      return '<div style="border-top:2px solid #181818;background:#080808;">' +
        '<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-bottom:1px solid #141414;">' +
          '<span style="font-family:Consolas,monospace;font-size:8px;letter-spacing:.22em;color:#E97132;font-weight:700;">+ ADD SERIES</span>' +
          '<input class="mm-search" id="mm-add-search-' + id + '" placeholder="SEARCH 30 SERIES…" style="flex:1;max-width:200px;">' +
        '</div>' +
        '<div id="mm-cat-results-' + id + '" style="max-height:180px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#1e1e1e transparent;">' +
          buildCatResults('') +
        '</div>' +
      '</div>';
    }

    function render(rows) {
      lastData = rows;
      body.innerHTML =
        '<div class="mm-wrap">' +
          '<div class="mm-topbar">' +
            '<input class="mm-search" id="mm-search-' + id + '" placeholder="FILTER…" value="' + escH(filterQ) + '">' +
            '<span class="mm-live-dot">● LIVE</span>' +
            '<span class="mm-ts-lbl" id="mm-ts-' + id + '">0s AGO</span>' +
            '<button class="mm-edit-btn" id="mm-edit-' + id + '">' + (editMode ? 'DONE' : 'EDIT') + '</button>' +
          '</div>' +
          '<div class="mm-table-wrap" id="mm-tw-' + id + '">' + buildTable(rows) + '</div>' +
          (editMode ? buildAddPanel() : '') +
          '<div class="mm-foot">FRED · FX LIVE VIA ER-API · AUTO-REFRESH 60s · CLICK ROW FOR CHART · ' + (editMode ? 'EDIT MODE: ✕ TO REMOVE · SEARCH TO ADD' : 'CLICK EDIT TO CUSTOMISE') + '</div>' +
        '</div>';

      body.querySelector('#mm-search-' + id).addEventListener('input', function (e) {
        filterQ = e.target.value;
        body.querySelector('#mm-tw-' + id).innerHTML = buildTable(lastData);
        wireTable();
      });

      body.querySelector('#mm-edit-' + id).addEventListener('click', function () {
        editMode = !editMode;
        if (editMode && !catCache && !catFetching) {
          catFetching = true;
          fetch('/.netlify/functions/macro-data?type=catalogue')
            .then(function(r) { return r.json(); })
            .then(function(data) { catCache = data; catFetching = false; render(lastData); })
            .catch(function() { catFetching = false; });
        }
        render(lastData);
      });

      if (editMode) {
        var addSearch = body.querySelector('#mm-add-search-' + id);
        if (addSearch) {
          addSearch.addEventListener('input', function(e) {
            var res = body.querySelector('#mm-cat-results-' + id);
            if (res) res.innerHTML = buildCatResults(e.target.value);
            wireCatItems();
          });
        }
        wireCatItems();
      }

      wireTable();
    }

    function wireCatItems() {
      body.querySelectorAll('.mm-cat-item[data-added="0"]').forEach(function(el) {
        el.addEventListener('click', function() {
          var sid = el.dataset.sid;
          var userSeries = mmGetUserSeries();
          if (userSeries.indexOf(sid) === -1) {
            userSeries.push(sid);
            mmSaveUserSeries(userSeries);
            mmFetch();
          }
        });
      });
    }

    function wireTable() {
      /* sort headers */
      body.querySelectorAll('.mm-th[data-col]').forEach(function (th) {
        th.addEventListener('click', function () {
          var col = th.dataset.col;
          if (sortCol === col) { sortDir *= -1; }
          else { sortCol = col; sortDir = col === 'n' ? 1 : -1; }
          body.querySelector('#mm-tw-' + id).innerHTML = buildTable(lastData);
          wireTable();
        });
      });

      /* remove buttons in edit mode */
      body.querySelectorAll('.mm-rm-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var sid = btn.dataset.sid;
          var userSeries = mmGetUserSeries();
          var idx = userSeries.indexOf(sid);
          if (idx !== -1 && userSeries.length > 1) {
            userSeries.splice(idx, 1);
            mmSaveUserSeries(userSeries);
            mmFetch();
          }
        });
      });

      /* row click → chart (only when not in edit mode) */
      body.querySelectorAll('.mm-tr[data-series]').forEach(function (tr) {
        tr.addEventListener('click', function () {
          if (editMode) return;
          if (!window.createGenericPopout) return;
          var series = tr.dataset.series;
          var name   = tr.dataset.name;
          window.createGenericPopout(name + ' · CHART', '▦', function (popBody) {
            renderPriceChart(popBody, series, name);
          }, { w: 500, h: 340 });
        });
      });
    }

    var mmRefreshTimer = null;
    var mmTickTimer = null;
    var mmLastFetch = 0;

    function mmTick() {
      var tsEl = body.querySelector('#mm-ts-' + id);
      if (!tsEl) { clearInterval(mmTickTimer); mmTickTimer = null; return; }
      var sec = Math.round((Date.now() - mmLastFetch) / 1000);
      tsEl.textContent = sec < 60 ? sec + 's AGO' : Math.floor(sec / 60) + 'm AGO';
    }

    function mmFetch() {
      var seriesParam = encodeURIComponent(mmGetUserSeries().join(','));
      fetch('/.netlify/functions/macro-data?type=monitor-live&series=' + seriesParam)
        .then(function (r) { return r.json(); })
        .then(function (rows) {
          if (!Array.isArray(rows) || !rows.length) {
            body.innerHTML = '<div class="tbw-loading">NO DATA</div>'; return;
          }
          mmLastFetch = Date.now();
          render(rows);
          if (!mmTickTimer) mmTickTimer = setInterval(mmTick, 1000);
        })
        .catch(function () { body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; });
    }

    mmFetch();
    mmRefreshTimer = setInterval(function () {
      if (!body.querySelector('.mm-wrap')) {
        clearInterval(mmRefreshTimer);
        clearInterval(mmTickTimer);
        return;
      }
      mmFetch();
    }, 60000);
  }

  /* ── SECTOR HEATMAP ─────────────────────────────────────────── */
  function renderSectorHeatmap(id, body) {
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;background:#0a0a0a;';
    var lastRows = null;

    function hmBg(dp) {
      if (dp === null) return '#141414';
      var v = Math.max(-4, Math.min(4, dp));
      var abs = Math.abs(v), t = abs / 4;
      if (v > 0) {
        var r = Math.round(0   + (0   - 0)   * t);
        var g = Math.round(80  + (170 - 80)  * t);
        var b = Math.round(40  + (85  - 40)  * t);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
      } else if (v < 0) {
        var r2 = Math.round(100 + (210 - 100) * t);
        var g2 = Math.round(15  + (20  - 15)  * t);
        var b2 = Math.round(15  + (20  - 15)  * t);
        return 'rgb(' + r2 + ',' + g2 + ',' + b2 + ')';
      }
      return '#141414';
    }

    function textColor(dp) {
      if (dp === null) return '#888';
      return Math.abs(dp) > 0.5 ? '#fff' : '#ccc';
    }

    function buildGrid(rows) {
      var ts = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      /* Color scale legend stops */
      var stops = [-4,-3,-2,-1,0,1,2,3,4];
      var legend = stops.map(function(v) {
        return '<span class="sh-leg-cell" style="background:' + hmBg(v) + ';flex:1">' + (v > 0 ? '+' : '') + v + '%</span>';
      }).join('');
      return '<div class="sh-heatmap">' +
          rows.map(function(s) {
            var price = s.c ? '$' + parseFloat(s.c).toFixed(2) : '—';
            var chg   = s.dp !== null ? (s.dp >= 0 ? '+' : '') + parseFloat(s.dp).toFixed(2) + '%' : '—';
            var hl    = (s.h && s.l) ? 'H ' + parseFloat(s.h).toFixed(2) + '  L ' + parseFloat(s.l).toFixed(2) : '';
            var spanCls = 'sh-span-' + (s.span || 1);
            return '<div class="sh-tile ' + spanCls + '" data-etf="' + escH(s.etf) + '" style="background:' + hmBg(s.dp) + ';color:' + textColor(s.dp) + '">' +
              '<div class="sh-sector">' + escH(s.name) + '</div>' +
              '<div class="sh-etf-lbl">' + escH(s.etf) + '</div>' +
              '<div class="sh-pct ' + (s.dp === null ? '' : s.dp >= 0 ? 'sh-pos' : 'sh-neg') + '">' + chg + '</div>' +
              '<div class="sh-price-lbl">' + price + '</div>' +
              (hl ? '<div class="sh-hl">' + hl + '</div>' : '') +
              '</div>';
          }).join('') +
        '</div>' +
        '<div class="sh-legend">' + legend + '</div>' +
        '<div class="sh-footer">SPDR SECTOR ETFs · YAHOO FINANCE · ' + ts + '</div>';
    }

    function updateTiles(rows) {
      rows.forEach(function(s) {
        var tile = body.querySelector('[data-etf="' + s.etf + '"]');
        if (!tile) return;
        tile.style.background = hmBg(s.dp);
        tile.style.color = textColor(s.dp);
        var pct = tile.querySelector('.sh-pct');
        if (pct) pct.textContent = s.dp !== null ? (s.dp >= 0 ? '+' : '') + parseFloat(s.dp).toFixed(2) + '%' : '—';
        var priceLbl = tile.querySelector('.sh-price-lbl');
        if (priceLbl) priceLbl.textContent = s.c ? '$' + parseFloat(s.c).toFixed(2) : '—';
        var hl = tile.querySelector('.sh-hl');
        if (hl && s.h && s.l) hl.textContent = 'H ' + parseFloat(s.h).toFixed(2) + '  L ' + parseFloat(s.l).toFixed(2);
        /* update footer timestamp */
        var ft = body.querySelector('.sh-footer');
        if (ft) ft.textContent = 'SPDR SECTOR ETFs · YAHOO FINANCE · ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      });
    }

    function fetch_sectors(isRefresh) {
      if (!isRefresh) body.innerHTML = '<div class="tbw-loading">LOADING SECTORS…</div>';
      fetch('/.netlify/functions/macro-data?type=sectors')
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(rows){
          if (!rows) { if (!isRefresh) body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; return; }
          lastRows = rows;
          if (isRefresh && body.querySelector('.sh-heatmap')) {
            updateTiles(rows);
          } else {
            body.innerHTML = buildGrid(rows);
          }
        })
        .catch(function(){ if (!isRefresh) body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; });
    }

    fetch_sectors(false);
    clearTimeout(el_refresh_timer(id));
    set_refresh_timer(id, setInterval(function() {
      if (!body.querySelector('.sh-heatmap') && !body.querySelector('.tbw-loading')) { clearInterval(el_refresh_timer(id)); return; }
      fetch_sectors(true);
    }, 60000));
  }

  /* ── WATCHLIST ───────────────────────────────────────────────── */
  function renderWatchlist(id, body) {
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;';
    var STORE = 'tbt-watchlist-v1';
    var tickers = JSON.parse(localStorage.getItem(STORE) || '[]');
    function save() { localStorage.setItem(STORE, JSON.stringify(tickers)); }

    var refreshTimer = null;

    function draw(quotes) {
      var listHtml = quotes.length ? quotes.map(function(q) {
        var price = q.c ? '$' + q.c.toFixed(2) : '—';
        var chg = q.dp !== null ? (q.dp >= 0 ? '+' : '') + q.dp.toFixed(2) + '%' : '—';
        var cls = q.dp === null ? '' : q.dp >= 0 ? 'wl-pos' : 'wl-neg';
        return '<div class="wl-row">' +
          '<span class="wl-sym">' + escH(q.sym) + '</span>' +
          '<span class="wl-price">' + price + '</span>' +
          '<span class="wl-chg ' + cls + '">' + chg + '</span>' +
          '<button class="wl-del" data-sym="' + escH(q.sym) + '">✕</button>' +
          '</div>';
      }).join('') : '<div class="wl-empty">NO TICKERS YET<br>TYPE A SYMBOL ABOVE &amp; PRESS ENTER</div>';

      var ts = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      body.innerHTML =
        '<div class="wl-add-bar">' +
          '<input class="wl-input" id="' + id + '-inp" placeholder="ADD TICKER  e.g. AAPL" maxlength="12"/>' +
          '<button class="wl-add-btn" id="' + id + '-add">＋</button>' +
        '</div>' +
        '<div class="wl-list">' + listHtml + '</div>' +
        '<div class="wl-footer">LIVE PRICES · FINNHUB · ' + ts + '</div>';

      body.querySelectorAll('.wl-del').forEach(function(btn) {
        btn.addEventListener('click', function() {
          tickers = tickers.filter(function(t){ return t !== btn.dataset.sym; });
          save();
          if (tickers.length) fetchAndRender(); else { draw([]); wireInput(); }
        });
      });
      wireInput();
    }

    function wireInput() {
      var inp = document.getElementById(id + '-inp');
      var addBtn = document.getElementById(id + '-add');
      if (!inp || !addBtn) return;
      function tryAdd() {
        var sym = (inp.value || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,'');
        if (!sym || tickers.indexOf(sym) !== -1) { inp.value = ''; return; }
        inp.disabled = addBtn.disabled = true;
        fetch('/.netlify/functions/macro-data?type=quote&symbols=' + encodeURIComponent(sym))
          .then(function(r){ return r.ok ? r.json() : null; })
          .then(function(data){
            inp.disabled = addBtn.disabled = false;
            if (data && data[0] && data[0].c) {
              tickers.push(sym); save(); inp.value = ''; fetchAndRender();
            } else { inp.classList.add('wl-err'); setTimeout(function(){ inp.classList.remove('wl-err'); inp.value = ''; }, 1500); }
          })
          .catch(function(){ inp.disabled = addBtn.disabled = false; });
      }
      inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') tryAdd(); });
      addBtn.addEventListener('click', tryAdd);
    }

    function fetchAndRender() {
      if (!tickers.length) { draw([]); return; }
      fetch('/.netlify/functions/macro-data?type=quote&symbols=' + encodeURIComponent(tickers.join(',')))
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(q){ if (q) draw(q); })
        .catch(function(){});
    }

    fetchAndRender();
    clearTimeout(el_refresh_timer(id));
    set_refresh_timer(id, setInterval(function(){
      if (!body.querySelector('.wl-add-bar')) { clearInterval(el_refresh_timer(id)); return; }
      fetchAndRender();
    }, 60000));
  }

  /* ── GLOBAL MAP ──────────────────────────────────────────────── */
  function renderGlobalMap(id, body) {
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;position:relative;';
    var mode = 'macro', sub = 'realrate';
    var mapData = null, _globe = null, _features = [], _isoMap = new Map();

    var ISO_CUR = {
      US:'USD',GB:'GBP',EU:'EUR',DE:'EUR',FR:'EUR',IT:'EUR',ES:'EUR',NL:'EUR',
      PT:'EUR',FI:'EUR',BE:'EUR',AT:'EUR',IE:'EUR',GR:'EUR',SK:'EUR',SI:'EUR',
      LU:'EUR',CY:'EUR',MT:'EUR',JP:'JPY',CN:'CNY',CA:'CAD',AU:'AUD',CH:'CHF',
      NO:'NOK',SE:'SEK',NZ:'NZD',KR:'KRW',IN:'INR',BR:'BRL',MX:'MXN',RU:'RUB',
      TR:'TRY',ZA:'ZAR',SA:'SAR',AE:'AED',SG:'SGD',HK:'HKD',TH:'THB',ID:'IDR',
      PH:'PHP',MY:'MYR',PK:'PKR',EG:'EGP',NG:'NGN',KE:'KES',GH:'GHS',UA:'UAH',
      PL:'PLN',CZ:'CZK',HU:'HUF',RO:'RON',DK:'DKK',AR:'ARS',CL:'CLP',CO:'COP',
      PE:'PEN',VE:'VES',UY:'UYU',MA:'MAD',DZ:'DZD',TN:'TND',LY:'LYD',ET:'ETB',
      IQ:'IQD',IR:'IRR',KW:'KWD',QA:'QAR',KZ:'KZT',UZ:'UZS',VN:'VND',BD:'BDT',
      LK:'LKR',NP:'NPR',IS:'ISK',RS:'RSD',HR:'HRK',BA:'BAM',MK:'MKD',MD:'MDL',
      AL:'ALL',LB:'LBP',SY:'SYP',JO:'JOD',YE:'YER',TZ:'TZS',UG:'UGX',MZ:'MZN',
      ZW:'ZWL',NA:'NAD',AO:'AOA',EC:'USD',PA:'USD',PR:'USD',KP:'KPW',
      KG:'KGS',ML:'XOF',BF:'XOF',GN:'GNF',SN:'XOF',CM:'XAF',SO:'SOS',SL:'SLL',
      CI:'XOF',HT:'HTG',JM:'JMD',TT:'TTD',CR:'CRC',HN:'HNL',GT:'GTQ',
      BO:'BOB',PY:'PYG'
    };
    var OIL_PROD = {
      US:12900,RU:9500,SA:8900,CA:4200,IQ:4100,CN:4000,AE:3400,BR:3300,KW:2700,
      IR:3200,MX:1800,NO:1800,NG:1400,KZ:1900,VE:800,LY:1100,AO:1200,DZ:1000,
      GB:700,AU:400,QA:1600,EC:500,MY:600,CO:800,AR:700,EG:600,IN:700,VN:200
    };
    var GOLD_PROD = {
      CN:370,AU:310,RU:310,CA:200,US:170,GH:130,MX:120,UZ:110,ID:100,ZA:100,
      PE:100,BR:70,KZ:70,TZ:50,TR:40,CL:40,PH:50,NG:20,ML:70,BF:60,GN:20
    };
    var GOLD_RES = {
      US:8133,DE:3353,IT:2452,FR:2436,RU:2327,CN:2192,CH:1040,JP:846,IN:803,
      NL:612,TR:572,PL:358,GB:310,PT:383,TW:424,AU:79,KZ:302,UZ:369,BE:227,
      SE:126,MX:120,RO:103,PH:154,VE:153,BR:130,QA:62,UA:45,KW:79,EG:126,
      DZ:174,IQ:96,LY:117,TH:244,SG:154,SA:323,MA:22
    };
    var WHISKY = {
      GB:{lbl:'SCOTCH',    note:'Highland · Speyside · Islay · Campbeltown · Lowlands'},
      IE:{lbl:'IRISH',     note:'Midleton · Bushmills · Teeling · Dingle'},
      US:{lbl:'BOURBON',   note:'Kentucky · Tennessee · New York · Texas'},
      JP:{lbl:'JAPANESE',  note:'Yamazaki · Nikka · Chichibu · Mars'},
      IN:{lbl:'INDIAN',    note:'Amrut · Paul John · Rampur'},
      CA:{lbl:'CANADIAN',  note:'Crown Royal · Forty Creek · Gooderham'},
      TW:{lbl:'TAIWANESE', note:'Kavalan · Nantou'},
      AU:{lbl:'AUSTRALIAN',note:'Archie Rose · Starward · Lark'},
      ZA:{lbl:'S.AFRICAN', note:"Bain's · Three Ships"},
      FR:{lbl:'FRENCH',    note:'Armorik · Glann ar Mor'},
      NZ:{lbl:'NEW ZEALAND',note:'Thomson · Cardrona'},
      DE:{lbl:'GERMAN',    note:'Slyrs · Fading Hill'},
      SE:{lbl:'SWEDISH',   note:'Mackmyra · High Coast'},
      FI:{lbl:'FINNISH',   note:'Kyrö · Teerenpeli'},
      NO:{lbl:'NORWEGIAN', note:'Myken · Arcus'},
      CH:{lbl:'SWISS',     note:'Langatun · Säntis Malt'}
    };
    var CNAME = {
      US:'United States',GB:'United Kingdom',DE:'Germany',FR:'France',JP:'Japan',
      CN:'China',CA:'Canada',AU:'Australia',RU:'Russia',IN:'India',BR:'Brazil',
      MX:'Mexico',KR:'South Korea',IT:'Italy',ES:'Spain',NL:'Netherlands',
      CH:'Switzerland',SE:'Sweden',NO:'Norway',DK:'Denmark',FI:'Finland',
      PL:'Poland',AT:'Austria',BE:'Belgium',PT:'Portugal',GR:'Greece',TR:'Turkey',
      SA:'Saudi Arabia',AE:'UAE',ZA:'South Africa',NG:'Nigeria',EG:'Egypt',
      KE:'Kenya',GH:'Ghana',MA:'Morocco',AR:'Argentina',CL:'Chile',CO:'Colombia',
      PE:'Peru',VE:'Venezuela',ID:'Indonesia',TH:'Thailand',PH:'Philippines',
      MY:'Malaysia',SG:'Singapore',PK:'Pakistan',BD:'Bangladesh',VN:'Vietnam',
      IR:'Iran',IQ:'Iraq',KW:'Kuwait',QA:'Qatar',UA:'Ukraine',KZ:'Kazakhstan',
      UZ:'Uzbekistan',TW:'Taiwan',NZ:'New Zealand',IE:'Ireland',SK:'Slovakia',
      HU:'Hungary',RO:'Romania',CZ:'Czech Republic',HR:'Croatia',RS:'Serbia',
      BA:'Bosnia',MK:'N. Macedonia',MD:'Moldova',AL:'Albania',LY:'Libya',
      DZ:'Algeria',TN:'Tunisia',LB:'Lebanon',SY:'Syria',JO:'Jordan',YE:'Yemen',
      ET:'Ethiopia',TZ:'Tanzania',UG:'Uganda',MZ:'Mozambique',ZW:'Zimbabwe',
      NA:'Namibia',AO:'Angola',LK:'Sri Lanka',NP:'Nepal',IS:'Iceland',
      LU:'Luxembourg',CY:'Cyprus',MT:'Malta',KP:'North Korea',KG:'Kyrgyzstan',
      ML:'Mali',BF:'Burkina Faso',GN:'Guinea',SN:'Senegal',CM:'Cameroon',
      SO:'Somalia',SL:'Sierra Leone',CI:'Ivory Coast',HT:'Haiti',JM:'Jamaica',
      TT:'Trinidad',CR:'Costa Rica',HN:'Honduras',GT:'Guatemala',EC:'Ecuador',
      BO:'Bolivia',PY:'Paraguay',UY:'Uruguay',HK:'Hong Kong'
    };

    /* numeric ISO 3166-1 → alpha-2 (world-atlas uses numeric feature IDs) */
    var NUM2ISO = {
      '4':'AF','8':'AL','12':'DZ','24':'AO','32':'AR','36':'AU','40':'AT',
      '50':'BD','56':'BE','64':'BT','68':'BO','70':'BA','76':'BR','100':'BG',
      '104':'MM','116':'KH','120':'CM','124':'CA','144':'LK','152':'CL',
      '156':'CN','158':'TW','170':'CO','188':'CR','191':'HR','196':'CY',
      '203':'CZ','208':'DK','218':'EC','231':'ET','246':'FI','250':'FR',
      '276':'DE','288':'GH','300':'GR','320':'GT','324':'GN','332':'HT',
      '340':'HN','344':'HK','348':'HU','352':'IS','356':'IN','360':'ID',
      '364':'IR','368':'IQ','372':'IE','380':'IT','388':'JM','392':'JP',
      '398':'KZ','400':'JO','404':'KE','408':'KP','410':'KR','414':'KW',
      '417':'KG','418':'LA','422':'LB','430':'LR','434':'LY','440':'LT',
      '442':'LU','458':'MY','466':'ML','484':'MX','498':'MD','504':'MA',
      '508':'MZ','516':'NA','524':'NP','528':'NL','554':'NZ','562':'NE',
      '566':'NG','578':'NO','586':'PK','591':'PA','600':'PY','604':'PE',
      '608':'PH','616':'PL','620':'PT','630':'PR','634':'QA','642':'RO',
      '643':'RU','682':'SA','686':'SN','694':'SL','702':'SG','703':'SK',
      '704':'VN','705':'SI','706':'SO','710':'ZA','716':'ZW','724':'ES',
      '752':'SE','756':'CH','760':'SY','764':'TH','780':'TT','784':'AE',
      '788':'TN','792':'TR','800':'UG','804':'UA','807':'MK','818':'EG',
      '826':'GB','834':'TZ','840':'US','854':'BF','858':'UY','860':'UZ',
      '862':'VE','887':'YE'
    };

    function lerp(a,b,t){ return Math.round(a+(b-a)*Math.max(0,Math.min(1,t))); }
    function rgb(r,g,b){ return 'rgb('+r+','+g+','+b+')'; }
    function b2(t,A,B){ return rgb(lerp(A[0],B[0],t),lerp(A[1],B[1],t),lerp(A[2],B[2],t)); }
    function b3(t,A,B,C){ return t<0.5?b2(t*2,A,B):b2((t-0.5)*2,B,C); }
    var SCH = {
      rate:     function(t){ return b3(t,[14,48,120],[80,60,10],[160,24,24]); },
      cpi:      function(t){ return b3(t,[10,80,40],[150,130,10],[160,24,24]); },
      realrate: function(t){ return b3(t,[140,20,20],[50,50,50],[14,80,140]); },
      goldL:    function(t){ return b2(t,[20,15,5],[210,165,30]); },
      goldP:    function(t){ return b2(t,[15,12,5],[200,155,20]); },
      goldR:    function(t){ return b2(t,[12,10,5],[180,140,15]); },
      fx:       function(t){ return b3(t,[20,100,60],[60,55,30],[140,20,20]); },
      oil:      function(t){ return b2(t,[15,10,8],[180,70,10]); },
      whisky:   function(t){ return b2(t,[30,20,10],[160,90,20]); }
    };
    function curSch(){
      if(mode==='macro') return SCH[sub]||SCH.rate;
      if(mode==='gold') return sub==='local'?SCH.goldL:sub==='reserves'?SCH.goldR:SCH.goldP;
      return SCH[mode]||SCH.rate;
    }
    function getVal(iso){
      if(mode==='macro'){
        if(!mapData||!mapData.countries) return null;
        var c=mapData.countries[iso]; if(!c) return null;
        if(sub==='realrate'){
          var r=parseFloat(c.rate),ci=parseFloat(c.cpi);
          return(!isNaN(r)&&!isNaN(ci))?(r-ci):null;
        }
        var v=c[sub]; return v!=null?parseFloat(v):null;
      }
      if(mode==='gold'){
        if(sub==='local'){
          if(!mapData||!mapData.goldUSD) return null;
          var cur=ISO_CUR[iso]; if(!cur) return null;
          var fxR=mapData.fx&&mapData.fx[cur]; if(!fxR) return null;
          return mapData.goldUSD*fxR;
        }
        return (sub==='production'?GOLD_PROD:GOLD_RES)[iso]||null;
      }
      if(mode==='fx'){
        if(!mapData||!mapData.fx) return null;
        var c2=ISO_CUR[iso]; if(!c2||c2==='USD') return null;
        return mapData.fx[c2]||null;
      }
      if(mode==='oil') return OIL_PROD[iso]||null;
      if(mode==='whisky') return WHISKY[iso]?1:null;
      return null;
    }
    function fmtVal(iso,v){
      if(v===null) return 'No data';
      if(mode==='macro'){
        if(sub==='realrate') return (v>=0?'+':'')+v.toFixed(1)+'% real';
        return v.toFixed(1)+'%';
      }
      if(mode==='gold'){
        if(sub==='local'){ var c=ISO_CUR[iso]||'?'; return c+' '+Math.round(v).toLocaleString(); }
        return Math.round(v).toLocaleString()+'t';
      }
      if(mode==='fx'){
        var c3=ISO_CUR[iso]||'?';
        var dp=(['JPY','KRW','IDR','VND','CLP','HUF','PYG'].indexOf(c3)>=0)?0:2;
        return '1 USD = '+v.toFixed(dp)+' '+c3;
      }
      if(mode==='oil') return Math.round(v).toLocaleString()+' kbd';
      if(mode==='whisky') return WHISKY[iso]?WHISKY[iso].lbl:'';
      return String(v);
    }
    function brokerLine(iso,v){
      if(mode==='macro'){
        if(sub==='realrate') return v!==null&&v<0?'Negative real rate — GOLD BULLISH. Prime pitch territory.':'Positive real rate — gold headwind. Focus on whisky casks.';
        if(sub==='rate') return v!==null&&v>5?'High rates — pitch inflation protection now.':'Low rates — yield chase. Real assets compelling.';
        if(sub==='cpi') return v!==null&&v>5?'High inflation — gold & whisky tailwind.':'Low CPI — quality narrative wins over inflation hedge.';
      }
      if(mode==='gold'){
        if(sub==='local') return 'Currency weakness drives local gold demand — a natural entry point.';
        if(sub==='production') return 'Supply concentrated here. Any disruption moves spot globally.';
        if(sub==='reserves') return 'Central bank holder. New reserve buying at this scale moves markets.';
      }
      if(mode==='fx') return 'Weaker currency raises local gold price — inflation hedge demand rises.';
      if(mode==='oil') return 'Petrodollar nation — oil revenues often recycled into gold & alternatives.';
      if(mode==='whisky'&&WHISKY[iso]) return WHISKY[iso].note;
      return '';
    }
    var SUBS = {
      macro:[{k:'realrate',l:'REAL RATE'},{k:'rate',l:'RATES'},{k:'cpi',l:'INFLATION'}],
      gold: [{k:'local',l:'LOCAL PRICE'},{k:'production',l:'PRODUCTION'},{k:'reserves',l:'CB RESERVES'}],
      fx:[],oil:[],whisky:[]
    };
    var FOOTS = {
      'macro:realrate':'FRED · RATE − CPI · NEGATIVE REAL RATE = GOLD BULLISH',
      'macro:rate':    'FRED · CENTRAL BANK POLICY RATES',
      'macro:cpi':     'FRED · CPI YEAR-ON-YEAR %',
      'gold:local':    'FINNHUB + ER-API · GOLD IN LOCAL CURRENCY (LIVE)',
      'gold:production':'WORLD GOLD COUNCIL 2023 · MINE OUTPUT (TONNES)',
      'gold:reserves': 'WORLD GOLD COUNCIL 2024 · CENTRAL BANK RESERVES (TONNES)',
      'fx:':           'ER-API · FX RATES vs USD (LIVE) · RED = WEAKER CURRENCY',
      'oil:':          'EIA 2024 · CRUDE OIL PRODUCTION (1000 BPD)',
      'whisky:':       'GLOBAL WHISKY PRODUCING REGIONS'
    };

    function colorData() {
      var rawVals = {};
      _features.forEach(function(f){ var iso=_isoMap.get(f); if(iso) rawVals[iso]=getVal(iso); });
      var vals = Object.keys(rawVals).map(function(k){ return rawVals[k]; }).filter(function(v){ return v!==null; });
      var minV = vals.length?Math.min.apply(null,vals):0;
      var maxV = vals.length?Math.max.apply(null,vals):1;
      if(maxV===minV) maxV=minV+1;
      var useLog = mode==='fx'||mode==='oil';
      var sch = curSch();
      function norm(v){
        if(v===null) return null;
        if(useLog){
          var lMin=Math.log(Math.max(1e-4,minV)),lMax=Math.log(Math.max(1e-4,maxV));
          return lMax===lMin?0.5:(Math.log(Math.max(1e-4,v))-lMin)/(lMax-lMin);
        }
        return (v-minV)/(maxV-minV);
      }
      return { rawVals:rawVals, norm:norm, sch:sch };
    }

    function capColor(d, cd) {
      var iso = _isoMap.get(d);
      /* no ISO mapping → micro-territory, let ocean texture show through */
      if(!iso) return 'rgba(0,0,0,0)';
      var t = cd.norm(cd.rawVals[iso]);
      /* known country but no data for this mode → subtle land tint */
      return t===null ? 'rgba(28,36,28,0.72)' : cd.sch(t);
    }

    function updateColors() {
      if(!_globe) return;
      var cd = colorData();
      _globe.polygonCapColor(function(d){ return capColor(d,cd); });
    }

    function makeLabel(iso) {
      var cd = colorData();
      var v = cd.rawVals[iso];
      var bl = brokerLine(iso,v);
      return '<div style="background:#0c0c0c;border:1px solid #252525;padding:7px 10px;font-family:Consolas,Menlo,monospace;max-width:215px;pointer-events:none;line-height:1.4">' +
        '<div style="font-size:8.5px;letter-spacing:.13em;color:#bbb;text-transform:uppercase;margin-bottom:3px">'+(CNAME[iso]||iso)+'</div>' +
        (v!==null
          ? '<div style="font-size:12px;color:#c8901a;margin-bottom:2px">'+fmtVal(iso,v)+'</div>'
          : '<div style="font-size:9px;color:#333;margin-bottom:2px">NO DATA</div>') +
        (bl ? '<div style="font-size:7.5px;color:#555;border-top:1px solid #1c1c1c;padding-top:4px;margin-top:4px;line-height:1.5">'+bl+'</div>' : '') +
        '</div>';
    }

    function rebuildControls() {
      var mc = document.getElementById('gm-modes-'+id);
      var sc = document.getElementById('gm-subs-'+id);
      var ft = document.getElementById('gm-foot-'+id);
      if(!mc) return;
      mc.innerHTML = ['macro','gold','fx','oil','whisky'].map(function(m){
        return '<button class="gm-mode'+(mode===m?' active':'')+'" data-mode="'+m+'">'+m.toUpperCase()+'</button>';
      }).join('');
      sc.innerHTML = (SUBS[mode]||[]).map(function(s){
        return '<button class="gm-sub'+(sub===s.k?' active':'')+'" data-sub="'+s.k+'">'+s.l+'</button>';
      }).join('');
      if(ft){ var sk=mode+(sub?':'+sub:':'); ft.textContent=FOOTS[sk]||''; }
      mc.querySelectorAll('.gm-mode').forEach(function(btn){
        btn.addEventListener('click',function(){
          mode=btn.dataset.mode;
          var first=SUBS[mode]&&SUBS[mode][0];
          sub=first?first.k:'';
          rebuildControls(); updateColors();
        });
      });
      sc.querySelectorAll('.gm-sub').forEach(function(btn){
        btn.addEventListener('click',function(){ sub=btn.dataset.sub; rebuildControls(); updateColors(); });
      });
    }

    function loadScript(url, cb) {
      if(window._tbtScripts && window._tbtScripts[url]){ cb(); return; }
      var s = document.createElement('script');
      s.src = url;
      s.onload = function(){ window._tbtScripts=window._tbtScripts||{}; window._tbtScripts[url]=true; cb(); };
      s.onerror = function(){ cb(new Error('script load failed: '+url)); };
      document.head.appendChild(s);
    }

    function buildGlobe(wrap) {
      var G = window.Globe;
      if(!G){ wrap.innerHTML='<div class="gm-loading">3D ENGINE UNAVAILABLE</div>'; return; }
      var cd = colorData();
      _globe = G({ animateIn:false })(wrap);
      _globe
        .backgroundColor('rgba(0,0,0,0)')
        .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg')
        .atmosphereColor('#7ec8ff')
        .atmosphereAltitude(0.20)
        .showGraticules(false)
        .showAtmosphere(true)
        .polygonsData(_features)
        .polygonAltitude(function(d){ return _isoMap.get(d)?0.020:0.001; })
        .polygonCapColor(function(d){ return capColor(d,cd); })
        .polygonSideColor(function(){ return 'rgba(0,0,0,0.45)'; })
        .polygonStrokeColor(function(){ return 'rgba(255,255,255,0.10)'; })
        .polygonLabel(function(d){ var iso=_isoMap.get(d); return iso?makeLabel(iso):''; })
        .onPolygonHover(function(hov){
          _globe.polygonAltitude(function(d){ return d===hov?0.045:(_isoMap.get(d)?0.020:0.001); });
        })
        .polygonsTransitionDuration(200);

      var ctrl = _globe.controls();
      ctrl.autoRotate = true;
      ctrl.autoRotateSpeed = 0.30;
      ctrl.enableDamping = true;
      ctrl.dampingFactor = 0.10;
      ctrl.minDistance = 120;
      ctrl.maxDistance = 700;
      wrap.addEventListener('mousedown', function(){ ctrl.autoRotate = false; });
    }

    function init() {
      body.innerHTML = '<div class="gm-loading">LOADING 3D GLOBE…</div>';
      loadScript('https://unpkg.com/globe.gl/dist/globe.gl.min.js', function(err) {
        if(err){ body.innerHTML='<div class="gm-loading">GLOBE ENGINE FAILED</div>'; return; }
        loadScript('https://unpkg.com/topojson-client@3/dist/topojson-client.min.js', function(err2) {
          if(err2){ body.innerHTML='<div class="gm-loading">TOPO ENGINE FAILED</div>'; return; }
          Promise.all([
            fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(function(r){ return r.json(); }),
            fetch('/.netlify/functions/macro-data?type=global-macro').then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
          ]).then(function(res) {
            var topo = res[0]; mapData = res[1];
            var geo = window.topojson.feature(topo, topo.objects.countries);
            _features = geo.features;
            _features.forEach(function(f){
              var iso = NUM2ISO[String(f.id)];
              if(iso) _isoMap.set(f, iso);
            });
            body.innerHTML =
              '<div id="gm-modes-'+id+'" class="gm-controls"></div>'+
              '<div id="gm-subs-'+id+'" class="gm-sub-bar"></div>'+
              '<div id="gm-wrap-'+id+'" class="gm-svg-wrap" style="flex:1;overflow:hidden;background:#00010a;position:relative;"></div>'+
              '<div class="gm-bottom"><span id="gm-foot-'+id+'" class="gm-footer"></span></div>';
            rebuildControls();
            buildGlobe(document.getElementById('gm-wrap-'+id));
          }).catch(function(){ body.innerHTML='<div class="gm-loading">GLOBE DATA UNAVAILABLE</div>'; });
        });
      });
    }

    init();
  }

  /* ── UK SPENDING ON CARDS (ONS) ──────────────────────────────── */
  function renderUKSpending(id, body) {
    var CATS = [
      {
        key: 'aggregate',
        lbl: 'AGGREGATE',
        icon: '◈',
        what: 'Total UK card spending across all categories — the headline number.',
        why: "Confirms whether the overall consumer environment is expanding or contracting. A broker's first sanity check before pitching any discretionary asset.",
        gold: 'Weak aggregate spend → financial stress → flight to gold as a safe store of value.',
        whisky: 'Weak aggregate spend narrows the audience for premium cask investment. Focus on clients with liquid net worth, not income-dependent buyers.'
      },
      {
        key: 'delayable',
        lbl: 'DELAYABLE',
        icon: '◇',
        what: 'Spending that can be postponed: clothing, electronics, furniture, luxury goods.',
        why: 'The most sensitive category to consumer confidence. When people defer big-ticket purchases, it signals they feel financially stretched or uncertain about the future.',
        gold: 'Delayable weakness often precedes gold demand — consumers cut spending before they buy protection. Watch for the lag.',
        whisky: 'Direct indicator for premium whisky appetite. Cask investment is a delayable decision. If this is below 90, clients need a stronger value narrative, not a lifestyle pitch.'
      },
      {
        key: 'social',
        lbl: 'SOCIAL',
        icon: '◎',
        what: 'Pubs, restaurants, events, hotels — the experience economy.',
        why: 'Social spending is forward-looking confidence. People go out when they feel secure. It also tracks the on-trade whisky market directly.',
        gold: 'Social rebound signals risk appetite is up — gold as a hedge becomes a harder sell in this environment.',
        whisky: 'Strong social spend = healthy hospitality sector = active whisky consumption market. Reinforces the story that demand for quality Scotch is growing.'
      },
      {
        key: 'staple',
        lbl: 'STAPLE',
        icon: '▣',
        what: 'Food, fuel, utilities — non-negotiable everyday spending.',
        why: 'High staple spend relative to 2019 usually signals inflation squeezing real budgets, not increased consumption. Watch this alongside CPI.',
        gold: 'Rising staple costs driven by inflation historically correlate with gold demand as a purchasing-power hedge. Strong alignment for the gold sales narrative.',
        whisky: 'Staple pressure reduces the wallet share available for premium goods. Acknowledge it in client conversations — then reframe whisky as an asset, not a cost.'
      },
      {
        key: 'work-related',
        lbl: 'WORK-RELATED',
        icon: '◧',
        what: 'Business travel, taxis, professional services — work and commuting expenditure.',
        why: 'A proxy for economic activity and business confidence. Rising work spend = businesses investing and staff moving.',
        gold: 'Limited direct correlation, but falling work spend suggests economic slowdown — a supportive macro backdrop for gold.',
        whisky: 'Corporate gifting and hospitality are tied to work-related budgets. High-end whisky gifting thrives when businesses are spending. Useful for institutional clients.'
      }
    ];

    var view = 'overview'; /* 'overview' | cat key */

    function colourClass(v) {
      if (v === null) return '';
      if (v >= 103) return 'uks-strong';
      if (v >= 100) return 'uks-above';
      if (v >= 95)  return 'uks-near';
      return 'uks-below';
    }
    function signal(v) {
      if (v === null) return { lbl:'—', cls:'' };
      if (v >= 103) return { lbl:'STRONG', cls:'uks-strong' };
      if (v >= 100) return { lbl:'ABOVE BASELINE', cls:'uks-above' };
      if (v >= 95)  return { lbl:'NEAR BASELINE', cls:'uks-near' };
      if (v >= 88)  return { lbl:'BELOW BASELINE', cls:'uks-below' };
      return { lbl:'SIGNIFICANTLY WEAK', cls:'uks-below' };
    }

    function renderOverview(spending, dateStr) {
      var rows = CATS.map(function(cat) {
        var v = spending[cat.key];
        var delta = v !== null ? (v - 100) : null;
        var sign  = delta !== null ? (delta >= 0 ? '+' : '') : '';
        var cls   = colourClass(v);
        var sig   = signal(v);
        var barW  = v !== null ? Math.max(2, Math.min(100, (v / 110) * 100)) : 0;
        return '<div class="uks-row" data-cat="' + cat.key + '">' +
          '<div class="uks-row-left">' +
            '<span class="uks-row-icon">' + cat.icon + '</span>' +
            '<span class="uks-row-lbl">' + cat.lbl + '</span>' +
          '</div>' +
          '<div class="uks-bar-wrap">' +
            '<div class="uks-bar ' + cls + '" style="width:' + barW + '%"></div>' +
            '<div class="uks-bar-base"></div>' +
          '</div>' +
          '<div class="uks-row-right">' +
            '<span class="uks-val ' + cls + '">' + (v !== null ? v.toFixed(1) : '—') + '</span>' +
            '<span class="uks-delta ' + cls + '">' + (delta !== null ? sign + delta.toFixed(1) + '%' : '') + '</span>' +
          '</div>' +
          '<span class="uks-sig ' + sig.cls + '">' + sig.lbl + '</span>' +
        '</div>';
      }).join('');

      return '<div class="uks-wrap">' +
        '<div class="uks-header">' +
          '<span class="uks-title">UK CONSUMER SPENDING</span>' +
          '<span class="uks-stale">⚠ DATA: ' + escH(dateStr) + '</span>' +
        '</div>' +
        '<div class="uks-baseline-note">Index where <strong>100 = 2019</strong> — the last full pre-COVID year. 2019 is the standard ONS baseline: it captures normal consumer behaviour before pandemic distortions. A reading of 86 means spending in that category is 14% below 2019 levels in real card transaction terms.</div>' +
        '<div class="uks-rows">' + rows + '</div>' +
        '<div class="uks-click-hint">↗ Click any row for broker context</div>' +
        '<div class="uks-footer">ONS Faster Indicators · UK credit &amp; debit card transactions · Last updated: ' + escH(dateStr) + '</div>' +
      '</div>';
    }

    function renderDetail(spending, dateStr, catKey) {
      var cat = CATS.find(function(c){ return c.key === catKey; });
      if (!cat) return '';
      var v = spending[cat.key];
      var delta = v !== null ? (v - 100) : null;
      var sign  = delta !== null ? (delta >= 0 ? '+' : '') : '';
      var cls   = colourClass(v);
      var sig   = signal(v);

      return '<div class="uks-wrap">' +
        '<div class="uks-detail-header">' +
          '<button class="uks-back">← BACK</button>' +
          '<span class="uks-detail-title">' + cat.icon + ' ' + cat.lbl + '</span>' +
          '<span class="uks-stale">⚠ ' + escH(dateStr) + '</span>' +
        '</div>' +
        '<div class="uks-detail-score">' +
          '<span class="uks-big-val ' + cls + '">' + (v !== null ? v.toFixed(1) : '—') + '</span>' +
          '<span class="uks-big-delta ' + cls + '">' + (delta !== null ? sign + delta.toFixed(1) + '% vs 2019' : '') + '</span>' +
          '<span class="uks-big-sig ' + sig.cls + '">' + sig.lbl + '</span>' +
        '</div>' +
        '<div class="uks-detail-body">' +
          '<div class="uks-section">' +
            '<div class="uks-section-lbl">WHAT THIS MEASURES</div>' +
            '<div class="uks-section-txt">' + escH(cat.what) + '</div>' +
          '</div>' +
          '<div class="uks-section">' +
            '<div class="uks-section-lbl">WHY IT MATTERS</div>' +
            '<div class="uks-section-txt">' + escH(cat.why) + '</div>' +
          '</div>' +
          '<div class="uks-section uks-gold-angle">' +
            '<div class="uks-section-lbl">◆ GOLD ANGLE</div>' +
            '<div class="uks-section-txt">' + escH(cat.gold) + '</div>' +
          '</div>' +
          '<div class="uks-section uks-whisky-angle">' +
            '<div class="uks-section-lbl">▲ WHISKY ANGLE</div>' +
            '<div class="uks-section-txt">' + escH(cat.whisky) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="uks-footer">ONS Faster Indicators · UK credit &amp; debit card transactions · ' + escH(dateStr) + '</div>' +
      '</div>';
    }

    var _spending = {}, _dateStr = '—';

    function render() {
      if (view === 'overview') {
        body.innerHTML = renderOverview(_spending, _dateStr);
        body.querySelectorAll('.uks-row[data-cat]').forEach(function(row) {
          row.style.cursor = 'pointer';
          row.addEventListener('click', function() { view = row.dataset.cat; render(); });
        });
      } else {
        body.innerHTML = renderDetail(_spending, _dateStr, view);
        var backBtn = body.querySelector('.uks-back');
        if (backBtn) backBtn.addEventListener('click', function() { view = 'overview'; render(); });
      }
    }

    body.innerHTML = '<div class="uks-loading">Loading ONS data…</div>';
    fetch('/.netlify/functions/macro-data?type=ons-spending')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (d) { _spending = d.spending; _dateStr = d.date; }
        render();
      })
      .catch(function() { render(); });
  }

  /* ── PRICE CHART POPOUT ──────────────────────────────────────── */
  function renderPriceChart(body, series, lbl) {
    /* ── state ───────────────────────────── */
    var years    = 2;
    var logScale = false;
    var overlay  = null;
    var locked   = false;
    var picking  = false;
    var ro       = null;
    var showSMA20  = false;
    var showSMA50  = false;
    var showSMA200 = false;
    var showRSI    = false;
    var measuring  = false;
    var measureA   = null; /* anchor: { idx, d, v } */
    var measureB   = null; /* end:    { idx, d, v } */

    var OVERLAYS = [
      { s:'DEXUSUK',          l:'GBP/USD'       },
      { s:'EURGBP',           l:'EUR/GBP'        },
      { s:'FEDFUNDS',         l:'US FED RATE'    },
      { s:'IRLTLT01GBM156N',  l:'UK 10-YR GILT'  },
      { s:'IRSTCI01GBM156N',  l:'UK RATE'        },
      { s:'CPALTT01GBM659N',  l:'UK CPI'         },
      { s:'GOLDPMGBD228NLBM', l:'GOLD GBP'       },
    ];

    function cUrl(s, y) {
      return '/.netlify/functions/macro-data?type=chart&series=' + encodeURIComponent(s) + '&years=' + y;
    }

    function loadPrimary(onDone) {
      body.innerHTML = '<div class="tbw-loading">LOADING CHART…</div>';
      fetch(cUrl(series, years))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.data || !d.data.length) { body.innerHTML = '<div class="tbw-loading">NO DATA</div>'; return; }
          onDone(d);
        })
        .catch(function () { body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; });
    }

    function fetchOverlay(ovSeries, onDone) {
      fetch(cUrl(ovSeries, years))
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.data && d.data.length) onDone(d); })
        .catch(function () {});
    }

    function render(primary) {
      var data = primary.data;
      var unit = primary.unit || '';

      function fmt(v, u) {
        var uu = u !== undefined ? u : unit;
        if (uu === 'GBP') return '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
        if (uu === '%')   return Number(v).toFixed(2) + '%';
        return Number(v).toFixed(4);
      }
      function fmtY(v, u) {
        var uu = u !== undefined ? u : unit;
        if (uu === 'GBP') return '£' + (v >= 1000 ? Math.round(v/1000) + 'k' : Math.round(v));
        if (uu === '%')   return v.toFixed(1) + '%';
        return v.toFixed(3);
      }

      var first = data[0].v, last = data[data.length - 1].v;
      var chgPct  = ((last - first) / Math.abs(first) * 100).toFixed(2);
      var chgCls  = parseFloat(chgPct) >= 0 ? 'mpc-chg-up' : 'mpc-chg-dn';
      var YRS     = [1, 2, 5, 10, 0];
      var yrLabel = function(y) { return y === 0 ? 'MAX' : y + 'Y'; };
      var yrBtns  = YRS.map(function (y) {
        return '<button class="mpc-yr' + (y === years ? ' mpc-yr-act' : '') + '" data-y="' + y + '">' + yrLabel(y) + '</button>';
      }).join('');

      /* overlay picker HTML (computed before innerHTML) */
      var pickerHtml = '';
      if (picking) {
        var avail = OVERLAYS.filter(function (o) { return o.s !== series; });
        pickerHtml = '<div class="mpc-picker">' + avail.map(function (o) {
          var act = overlay && overlay.series === o.s;
          return '<button class="mpc-pick-btn' + (act ? ' mpc-pick-act' : '') + '" data-s="' + o.s + '" data-l="' + o.l + '">' + o.l + '</button>';
        }).join('') + '</div>';
      }

      var legendHtml = overlay
        ? '<div class="mpc-legend"><span class="mpc-leg-p">━ ' + escH(primary.label || lbl) + '</span><span class="mpc-leg-o">┅ ' + escH(overlay.label) + '</span><button class="mpc-leg-rm" id="mpc-rm-ov">✕ REMOVE</button></div>'
        : '';

      body.innerHTML =
        '<div class="mpc-wrap">' +
          '<div class="mpc-top">' +
            '<span class="mpc-title">' + escH(primary.label || lbl) + '</span>' +
            '<span class="mpc-chg-badge ' + chgCls + '">' + (parseFloat(chgPct) >= 0 ? '+' : '') + chgPct + '%</span>' +
            '<div class="mpc-yrs">' + yrBtns + '</div>' +
            '<div class="mpc-controls">' +
              '<button class="mpc-ctrl-btn' + (showSMA20  ? ' mpc-ctrl-act' : '') + '" id="mpc-sma20-btn">SMA20</button>' +
              '<button class="mpc-ctrl-btn' + (showSMA50  ? ' mpc-ctrl-act' : '') + '" id="mpc-sma50-btn">SMA50</button>' +
              '<button class="mpc-ctrl-btn' + (showSMA200 ? ' mpc-ctrl-act' : '') + '" id="mpc-sma200-btn">SMA200</button>' +
              '<button class="mpc-ctrl-btn' + (showRSI    ? ' mpc-ctrl-act' : '') + '" id="mpc-rsi-btn">RSI</button>' +
              '<button class="mpc-ctrl-btn' + (measuring  ? ' mpc-ctrl-act' : '') + '" id="mpc-msr-btn">⬌ MEASURE</button>' +
              '<button class="mpc-ctrl-btn' + (logScale   ? ' mpc-ctrl-act' : '') + '" id="mpc-log-btn">LOG</button>' +
              '<button class="mpc-ctrl-btn" id="mpc-note-btn">✎ NOTE</button>' +
              '<button class="mpc-ctrl-btn' + (picking    ? ' mpc-ctrl-act' : '') + '" id="mpc-ov-btn">⊕ OVERLAY</button>' +
            '</div>' +
          '</div>' +
          pickerHtml +
          legendHtml +
          '<div class="mpc-chart-area"><canvas class="mpc-canvas"></canvas><div class="mpc-tooltip"></div></div>' +
          '<div class="mpc-foot">FRED · ST. LOUIS FED · CLICK CHART TO LOCK CROSSHAIR</div>' +
        '</div>';

      /* Year buttons */
      body.querySelectorAll('.mpc-yr').forEach(function (btn) {
        btn.addEventListener('click', function () {
          years = parseInt(btn.dataset.y);
          var savedOv = overlay;
          overlay = null;
          loadPrimary(function (p2) {
            render(p2);
            if (savedOv) {
              fetchOverlay(savedOv.series, function (od) {
                overlay = { series: savedOv.series, label: savedOv.label, unit: od.unit, data: od.data };
                render(p2);
              });
            }
          });
        });
      });

      /* Technicals */
      body.querySelector('#mpc-sma20-btn').addEventListener('click',  function () { showSMA20  = !showSMA20;  render(primary); });
      body.querySelector('#mpc-sma50-btn').addEventListener('click',  function () { showSMA50  = !showSMA50;  render(primary); });
      body.querySelector('#mpc-sma200-btn').addEventListener('click', function () { showSMA200 = !showSMA200; render(primary); });
      body.querySelector('#mpc-rsi-btn').addEventListener('click',    function () { showRSI    = !showRSI;    render(primary); });
      body.querySelector('#mpc-msr-btn').addEventListener('click',    function () {
        measuring = !measuring;
        if (!measuring) { measureA = null; measureB = null; }
        render(primary);
      });

      /* LOG */
      body.querySelector('#mpc-log-btn').addEventListener('click', function () { logScale = !logScale; render(primary); });

      /* NOTE */
      body.querySelector('#mpc-note-btn').addEventListener('click', function () {
        if (!window.noteModalOpen) return;
        var summary = (primary.label || lbl) + ' · ' + yrLabel(years) +
          '\nCurrent: ' + fmt(last) + ' · Period change: ' + (parseFloat(chgPct) >= 0 ? '+' : '') + chgPct + '%' +
          (overlay ? '\nOverlay: ' + overlay.label + ' · ' + fmt(overlay.data[overlay.data.length - 1].v, overlay.unit) : '');
        window.noteModalOpen({ subjectType: 'CHART', subjectTitle: (primary.label || lbl) + ' · ' + yrLabel(years), subjectContent: summary });
      });

      /* OVERLAY toggle */
      body.querySelector('#mpc-ov-btn').addEventListener('click', function () { picking = !picking; render(primary); });

      /* Remove overlay */
      var rmBtn = body.querySelector('#mpc-rm-ov');
      if (rmBtn) rmBtn.addEventListener('click', function () { overlay = null; picking = false; render(primary); });

      /* Picker series buttons */
      body.querySelectorAll('.mpc-pick-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var s = btn.dataset.s, l = btn.dataset.l;
          if (overlay && overlay.series === s) { overlay = null; picking = false; render(primary); return; }
          btn.textContent = 'LOADING…'; btn.disabled = true;
          fetchOverlay(s, function (od) {
            overlay = { series: s, label: l, unit: od.unit, data: od.data };
            picking = false;
            render(primary);
          });
        });
      });

      /* Canvas */
      var canvas  = body.querySelector('.mpc-canvas');
      var area    = body.querySelector('.mpc-chart-area');
      var tooltip = body.querySelector('.mpc-tooltip');

      function logV(v) { return v > 0 ? Math.log(v) : -9999; }

      function computeSMA(arr, period) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          if (i < period - 1) { out.push(null); continue; }
          var s2 = 0;
          for (var j = i - period + 1; j <= i; j++) s2 += arr[j].v;
          out.push(s2 / period);
        }
        return out;
      }

      function computeRSI(arr, period) {
        period = period || 14;
        var rsi = [];
        if (arr.length < period + 1) return rsi;
        var gains = [], losses = [];
        for (var i = 1; i < arr.length; i++) {
          var chg2 = arr[i].v - arr[i-1].v;
          gains.push(Math.max(0, chg2));
          losses.push(Math.max(0, -chg2));
        }
        var ag = 0, al = 0;
        for (var j = 0; j < period; j++) { ag += gains[j]; al += losses[j]; }
        ag /= period; al /= period;
        for (var k = period; k < gains.length; k++) {
          var rs = al === 0 ? 100 : ag / al;
          rsi.push({ d: arr[k].d, v: parseFloat((100 - 100 / (1 + rs)).toFixed(2)) });
          ag = (ag * (period - 1) + gains[k]) / period;
          al = (al * (period - 1) + losses[k]) / period;
        }
        return rsi;
      }

      function drawSMA(ctx, smaVals, color, dX, pY, mainTop, mainH) {
        ctx.save();
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
        var started = false;
        for (var i = 0; i < data.length; i++) {
          if (smaVals[i] === null) { started = false; continue; }
          var sx = dX(data[i].d), sy = pY(smaVals[i]);
          if (!started) { ctx.moveTo(sx, sy); started = true; }
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();
      }

      function paint(hoverIdx) {
        var sma20v  = (showSMA20  || showSMA50 || showSMA200) ? computeSMA(data, 20)  : null;
        var sma50v  = (showSMA50  || showSMA200)              ? computeSMA(data, 50)  : null;
        var sma200v = showSMA200                              ? computeSMA(data, 200) : null;
        var rsiData = showRSI ? computeRSI(data, 14) : [];

        var dpr = window.devicePixelRatio || 1;
        var W = area.clientWidth || 460;
        var H = area.clientHeight || 230;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        var hasOv = !!(overlay && overlay.data && overlay.data.length);

        /* Layout: split height for RSI panel */
        var RSI_H = showRSI ? Math.round(H * 0.28) : 0;
        var RSI_GAP = showRSI ? 8 : 0;
        var P = { t: 20, r: hasOv ? 56 : 18, b: 28, l: 58 };
        var cw = W - P.l - P.r;
        var ch = H - P.t - P.b - RSI_H - RSI_GAP; /* main chart height */
        var mainTop = P.t, mainBot = P.t + ch;
        var rsiTop  = mainBot + RSI_GAP, rsiBot = H - P.b;

        /* Background */
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);

        /* X: date-based */
        var allTs = data.map(function (p) { return new Date(p.d).getTime(); });
        if (hasOv) overlay.data.forEach(function (p) { allTs.push(new Date(p.d).getTime()); });
        var tsMin = Math.min.apply(null, allTs), tsMax = Math.max.apply(null, allTs);
        var tsSpan = tsMax - tsMin || 1;
        function dX(dateStr) { return P.l + ((new Date(dateStr).getTime() - tsMin) / tsSpan) * cw; }

        /* Primary Y range */
        var pVals = logScale ? data.map(function(p){ return logV(p.v); }) : data.map(function(p){ return p.v; });
        var vMin = Math.min.apply(null, pVals), vMax = Math.max.apply(null, pVals), vRng = vMax - vMin || 1;
        vMin -= vRng * 0.05; vMax += vRng * 0.05; vRng = vMax - vMin;
        function pY(v) { var lv = logScale ? logV(v) : v; return mainTop + ch - ((lv - vMin) / vRng) * ch; }

        /* Overlay Y range */
        var oMin, oMax, oRng;
        if (hasOv) {
          var oVals = logScale ? overlay.data.map(function(p){ return logV(p.v); }) : overlay.data.map(function(p){ return p.v; });
          oMin = Math.min.apply(null, oVals); oMax = Math.max.apply(null, oVals); oRng = oMax - oMin || 1;
          oMin -= oRng * 0.05; oMax += oRng * 0.05; oRng = oMax - oMin;
        }
        function oY(v) { var lv = logScale ? logV(v) : v; return mainTop + ch - ((lv - oMin) / oRng) * ch; }

        /* Grid + primary Y labels */
        ctx.font = '8px monospace';
        for (var g = 0; g <= 4; g++) {
          var gy = mainTop + ((4 - g) / 4) * ch;
          ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(P.l, gy); ctx.lineTo(P.l + cw, gy); ctx.stroke();
          var gv = vMin + (g / 4) * vRng;
          var gvReal = logScale ? Math.exp(gv) : gv;
          ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
          ctx.fillText(fmtY(gvReal), P.l - 4, gy + 3);
        }

        /* Overlay right-axis labels */
        if (hasOv) {
          for (var og = 0; og <= 4; og++) {
            var ogy = mainTop + ((4 - og) / 4) * ch;
            var ogv = oMin + (og / 4) * oRng;
            var ogvReal = logScale ? Math.exp(ogv) : ogv;
            ctx.fillStyle = '#4a9eed'; ctx.textAlign = 'left';
            ctx.fillText(fmtY(ogvReal, overlay.unit), P.l + cw + 4, ogy + 3);
          }
        }

        /* Primary area fill */
        var grad = ctx.createLinearGradient(0, mainTop, 0, mainBot);
        grad.addColorStop(0, 'rgba(233,113,50,0.18)'); grad.addColorStop(1, 'rgba(233,113,50,0.01)');
        ctx.beginPath();
        ctx.moveTo(dX(data[0].d), pY(data[0].v));
        for (var i = 1; i < data.length; i++) ctx.lineTo(dX(data[i].d), pY(data[i].v));
        ctx.lineTo(dX(data[data.length-1].d), mainBot); ctx.lineTo(dX(data[0].d), mainBot);
        ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

        /* Primary line */
        ctx.beginPath(); ctx.strokeStyle = '#E97132'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.moveTo(dX(data[0].d), pY(data[0].v));
        for (var i = 1; i < data.length; i++) ctx.lineTo(dX(data[i].d), pY(data[i].v));
        ctx.stroke();

        /* SMA overlays */
        if (showSMA20  && sma20v)  drawSMA(ctx, sma20v,  '#44cc88', dX, pY, mainTop, ch);
        if (showSMA50  && sma50v)  drawSMA(ctx, sma50v,  '#4898d8', dX, pY, mainTop, ch);
        if (showSMA200 && sma200v) drawSMA(ctx, sma200v, '#E97132', dX, pY, mainTop, ch);

        /* Overlay line (dashed blue) */
        if (hasOv) {
          ctx.beginPath(); ctx.strokeStyle = '#4a9eed'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
          ctx.moveTo(dX(overlay.data[0].d), oY(overlay.data[0].v));
          for (var i = 1; i < overlay.data.length; i++) ctx.lineTo(dX(overlay.data[i].d), oY(overlay.data[i].v));
          ctx.stroke(); ctx.setLineDash([]);
        }

        /* RSI sub-panel */
        if (showRSI && rsiData.length) {
          var rsiH2 = rsiBot - rsiTop;
          /* divider */
          ctx.fillStyle = '#1a1a1a'; ctx.fillRect(P.l, rsiTop - 1, cw, 1);
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '7px monospace'; ctx.textAlign = 'left';
          ctx.fillText('RSI(14)', P.l + 3, rsiTop + 9);
          /* ref lines at 30 and 70 */
          var rLine = function(level, col) {
            var ry = rsiTop + rsiH2 - (level / 100) * rsiH2;
            ctx.strokeStyle = col; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(P.l, ry); ctx.lineTo(P.l + cw, ry); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = col; ctx.font = '7px monospace'; ctx.textAlign = 'right';
            ctx.fillText(level, P.l - 3, ry + 3);
          };
          rLine(70, 'rgba(233,113,50,0.5)');
          rLine(30, 'rgba(68,152,216,0.5)');
          rLine(50, 'rgba(255,255,255,0.12)');
          /* RSI line */
          ctx.beginPath(); ctx.strokeStyle = '#b878d8'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
          var rStarted = false;
          for (var ri = 0; ri < rsiData.length; ri++) {
            var rxv = dX(rsiData[ri].d);
            var ryv = rsiTop + rsiH2 - (rsiData[ri].v / 100) * rsiH2;
            if (!rStarted) { ctx.moveTo(rxv, ryv); rStarted = true; } else ctx.lineTo(rxv, ryv);
          }
          ctx.stroke();
          /* RSI hover label */
          if (hoverIdx !== undefined && hoverIdx >= 0) {
            var nearRsi = null;
            var hts2 = new Date(data[hoverIdx].d).getTime();
            var nRd = Infinity;
            for (var ri2 = 0; ri2 < rsiData.length; ri2++) {
              var rd2 = Math.abs(new Date(rsiData[ri2].d).getTime() - hts2);
              if (rd2 < nRd) { nRd = rd2; nearRsi = rsiData[ri2]; }
            }
            if (nearRsi) {
              var rsiDot_x = dX(nearRsi.d);
              var rsiDot_y = rsiTop + rsiH2 - (nearRsi.v / 100) * rsiH2;
              ctx.beginPath(); ctx.arc(rsiDot_x, rsiDot_y, 3, 0, Math.PI * 2); ctx.fillStyle = '#b878d8'; ctx.fill();
              ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'left';
              ctx.fillText('RSI ' + nearRsi.v, rsiDot_x + 5, rsiDot_y - 3);
            }
          }
        }

        /* X-axis labels */
        var tCount = Math.min(6, data.length);
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '7.5px monospace'; ctx.textAlign = 'center';
        for (var t = 0; t < tCount; t++) {
          var ti = Math.round(t / (tCount - 1) * (data.length - 1));
          ctx.fillText(data[ti].d.slice(0, 7), dX(data[ti].d), H - 6);
        }

        /* Hover crosshair */
        if (hoverIdx !== undefined && hoverIdx >= 0 && hoverIdx < data.length) {
          var hx = dX(data[hoverIdx].d), hy = pY(data[hoverIdx].v);
          ctx.strokeStyle = locked ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(hx, mainTop); ctx.lineTo(hx, rsiBot); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#E97132'; ctx.fill();
          if (hasOv) {
            var hts = new Date(data[hoverIdx].d).getTime();
            var nOI = 0, nDist = Infinity;
            overlay.data.forEach(function (op, oi) { var d2 = Math.abs(new Date(op.d).getTime() - hts); if (d2 < nDist) { nDist = d2; nOI = oi; } });
            ctx.beginPath(); ctx.arc(dX(overlay.data[nOI].d), oY(overlay.data[nOI].v), 3.5, 0, Math.PI * 2); ctx.fillStyle = '#4a9eed'; ctx.fill();
          }
        }

        /* Measurement band */
        if (measuring && measureA && measureB) {
          var mxA = dX(data[measureA.idx].d), mxB = dX(data[measureB.idx].d);
          var myA = pY(data[measureA.idx].v), myB = pY(data[measureB.idx].v);
          var mLeft = Math.min(mxA, mxB), mRight = Math.max(mxA, mxB);
          ctx.fillStyle = 'rgba(184,120,216,0.08)'; ctx.fillRect(mLeft, mainTop, mRight - mLeft, ch);
          ctx.strokeStyle = 'rgba(184,120,216,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(mxA, mainTop); ctx.lineTo(mxA, mainBot); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(mxB, mainTop); ctx.lineTo(mxB, mainBot); ctx.stroke();
          ctx.setLineDash([]);
          /* measurement label */
          var pctChg = ((data[measureB.idx].v - data[measureA.idx].v) / Math.abs(data[measureA.idx].v) * 100).toFixed(2);
          var dayDiff = Math.round(Math.abs(new Date(data[measureB.idx].d).getTime() - new Date(data[measureA.idx].d).getTime()) / 86400000);
          var mLabel = (parseFloat(pctChg) >= 0 ? '+' : '') + pctChg + '%  ' + dayDiff + 'd';
          var mMid = (mxA + mxB) / 2;
          ctx.fillStyle = 'rgba(10,10,10,0.85)'; ctx.fillRect(mMid - 52, mainTop + 6, 104, 18);
          ctx.strokeStyle = 'rgba(184,120,216,0.7)'; ctx.lineWidth = 0.5; ctx.strokeRect(mMid - 52, mainTop + 6, 104, 18);
          ctx.fillStyle = '#b878d8'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
          ctx.fillText(mLabel, mMid, mainTop + 18);
          /* dots at anchors */
          ctx.beginPath(); ctx.arc(mxA, myA, 4, 0, Math.PI * 2); ctx.fillStyle = '#b878d8'; ctx.fill();
          ctx.beginPath(); ctx.arc(mxB, myB, 4, 0, Math.PI * 2); ctx.fillStyle = '#b878d8'; ctx.fill();
          /* connector line between the two anchor points */
          ctx.beginPath(); ctx.strokeStyle = 'rgba(184,120,216,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.moveTo(mxA, myA); ctx.lineTo(mxB, myB); ctx.stroke();
        } else if (measuring && measureA && !measureB) {
          /* First anchor placed, waiting for second click */
          var mxA2 = dX(data[measureA.idx].d);
          ctx.strokeStyle = 'rgba(184,120,216,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
          ctx.beginPath(); ctx.moveTo(mxA2, mainTop); ctx.lineTo(mxA2, mainBot); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(mxA2, pY(data[measureA.idx].v), 4, 0, Math.PI * 2); ctx.fillStyle = '#b878d8'; ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
          ctx.fillText('CLICK TO SET END', mxA2, mainTop + 12);
        }

        /* SMA legend strip */
        if (showSMA20 || showSMA50 || showSMA200) {
          var legItems = [];
          if (showSMA20)  legItems.push({ c:'#44cc88', l:'SMA20'  });
          if (showSMA50)  legItems.push({ c:'#4898d8', l:'SMA50'  });
          if (showSMA200) legItems.push({ c:'#E97132', l:'SMA200' });
          var legX = P.l + 4, legY = mainTop + 12;
          legItems.forEach(function(li) {
            ctx.strokeStyle = li.c; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(legX, legY); ctx.lineTo(legX + 14, legY); ctx.stroke();
            ctx.fillStyle = li.c; ctx.font = '7.5px monospace'; ctx.textAlign = 'left';
            ctx.fillText(li.l, legX + 17, legY + 3);
            legX += 52;
          });
        }

        canvas._state = { P: P, cw: cw, ch: ch, data: data, hasOv: hasOv, tsMin: tsMin, tsSpan: tsSpan, mainTop: mainTop, mainBot: mainBot };
      }

      paint();

      canvas.addEventListener('mousemove', function (e) {
        if (locked) return;
        var s = canvas._state; if (!s) return;
        var mx = e.offsetX;
        if (mx < s.P.l || mx > s.P.l + s.cw) { tooltip.style.display = 'none'; paint(); return; }
        var idx = Math.round((mx - s.P.l) / s.cw * (s.data.length - 1));
        idx = Math.max(0, Math.min(s.data.length - 1, idx));
        paint(idx);
        var pt = s.data[idx];
        var tipLines = [pt.d + '  ' + fmt(pt.v)];
        if (s.hasOv) {
          var hts = new Date(pt.d).getTime(), nOI = 0, nDist = Infinity;
          overlay.data.forEach(function (op, oi) { var d2 = Math.abs(new Date(op.d).getTime() - hts); if (d2 < nDist) { nDist = d2; nOI = oi; } });
          tipLines.push(overlay.label + '  ' + fmt(overlay.data[nOI].v, overlay.unit));
        }
        tooltip.style.whiteSpace = 'pre';
        tooltip.textContent = tipLines.join('\n');
        tooltip.style.display = 'block';
        var tipX = e.offsetX + 10; if (tipX + 210 > canvas.width) tipX = e.offsetX - 215;
        tooltip.style.left = tipX + 'px'; tooltip.style.top = (e.offsetY - 14) + 'px';
      });

      canvas.addEventListener('click', function (e) {
        if (measuring) {
          var s = canvas._state; if (!s) return;
          var mx = e.offsetX;
          var idx = Math.round((mx - s.P.l) / s.cw * (s.data.length - 1));
          idx = Math.max(0, Math.min(s.data.length - 1, idx));
          if (!measureA) {
            measureA = { idx: idx, d: data[idx].d, v: data[idx].v };
            measureB = null;
          } else if (!measureB) {
            measureB = { idx: idx, d: data[idx].d, v: data[idx].v };
          } else {
            /* third click: reset and start new measurement */
            measureA = { idx: idx, d: data[idx].d, v: data[idx].v };
            measureB = null;
          }
          paint(idx);
          return;
        }
        locked = !locked;
        canvas.style.cursor = locked ? 'crosshair' : 'default';
      });
      canvas.addEventListener('mouseleave', function () { if (!locked) { tooltip.style.display = 'none'; paint(); } });

      if (ro) ro.disconnect();
      ro = new ResizeObserver(function () { paint(); });
      ro.observe(area);
    }

    loadPrimary(render);
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

  /* ── WHISKY TERMINAL ─────────────────────────────────────────── */
  function renderWhiskyLookup(id, body) {
    var CURRENCIES = ['GBP','USD','EUR','HKD','JPY','SGD','CHF','AUD','CAD','CNY'];
    var _cur = 'GBP';
    var _results = [];
    var _selectedId = null;
    var _debounce = null;
    var _WL_KEY = 'tbt_whisky_wl';
    var _filters = {region:'', age:'', cask:'', distillery:''};

    var REGIONS = ['All Regions','Speyside','Islay','Highland','Lowland','Campbeltown','Islands','Japan','Ireland','USA','India','Taiwan'];
    var AGES    = ['Any Age','NAS','10YO','12YO','15YO','18YO','21YO','25YO','30YO','40YO+'];
    var CASKS   = ['Any Cask','Sherry Butt','Bourbon Cask','Port Pipe','Wine Cask','Ex-Bourbon','Oloroso','Pedro Ximenez','Madeira','Rum Cask'];

    var SUGGESTED = [
      {q:'Macallan 18 Sherry',    label:'MACALLAN 18 SHERRY OAK'},
      {q:'Ardbeg Uigeadail',      label:'ARDBEG UIGEADAIL'},
      {q:'Springbank 15',         label:'SPRINGBANK 15YO'},
      {q:'Glenfarclas 25',        label:'GLENFARCLAS 25YO'},
      {q:'Port Ellen 1979',       label:'PORT ELLEN 1979'},
      {q:'Dalmore King Alexander',label:'DALMORE KING ALEXANDER'},
      {q:'Balvenie 21 Portwood',  label:'BALVENIE 21 PORTWOOD'},
      {q:'Laphroaig 10',          label:'LAPHROAIG 10YO'},
    ];

    /* ── Whisky price chart — Bloomberg style, DPR-correct ── */
    /* ── Aggregate chart — 7-point stat chart, no extra credits ── */
    function paintAggregateChart(canvas, auc, retAvg) {
      var mv12 = auc.latest_12m || {};
      var hi   = auc.max_auction_price || {};
      var mv   = auc.market_value;
      var lat  = auc.latest_auction_price || {};
      var qMin = mv12.buyer_price_min, qQ1 = mv12.buyer_price_qrt1, qQ2 = mv12.buyer_price_qrt2;
      var qAvg = mv12.buyer_price_avg, qQ3 = mv12.buyer_price_qrt3, qMax = mv12.buyer_price_max;
      if (!qMin || !qMax || qMax <= qMin) { canvas.style.display='none'; return; }
      canvas.style.display='';
      var dpr = window.devicePixelRatio || 1;
      var _box = canvas.parentElement;
      var cssW = (_box ? _box.clientWidth : 0) || 460;
      var cssH = (_box ? _box.clientHeight : 0) || 220;
      canvas.width  = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW+'px'; canvas.style.height = cssH+'px';
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      var W=cssW, H=cssH, P={t:22,r:16,b:28,l:54};
      var cw=W-P.l-P.r, ch=H-P.t-P.b, x0=P.l, x1=P.l+cw, base=P.t+ch;
      var yMin=qMin*0.90, yMax=qMax*1.10;
      if (hi.buyer_price && hi.buyer_price<=qMax*2) yMax=Math.max(yMax,hi.buyer_price*1.06);
      var yRng=yMax-yMin||1;
      function yP(v){return P.t+ch-((v-yMin)/yRng)*ch;}
      function lbl(v){if(v==null)return '';return v>=1000?(v/1000).toFixed(v>=10000?0:1)+'k':Math.round(v).toString();}
      ctx.fillStyle='#080808'; ctx.fillRect(0,0,W,H);
      ctx.font='9px monospace';
      for(var gi=0;gi<=4;gi++){
        var gv=yMin+(gi/4)*yRng,gy=yP(gv);
        ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(x0,gy);ctx.lineTo(x1,gy);ctx.stroke();
        ctx.fillStyle='#fff';ctx.textAlign='right';ctx.textBaseline='middle';
        ctx.fillText(lbl(gv),x0-6,gy);
      }
      var pts=[{x:x0,y:yP(qMin)},{x:x0+cw*0.15,y:yP(qQ1)},{x:x0+cw*0.35,y:yP(qQ2)},
               {x:x0+cw*0.50,y:yP(qAvg)},{x:x0+cw*0.70,y:yP(qQ3)},{x:x0+cw*0.88,y:yP(qMax)},
               {x:x1,y:yP(mv!=null?mv:qMax)}];
      var ag=ctx.createLinearGradient(0,P.t,0,base);
      ag.addColorStop(0,'rgba(233,113,50,0.45)');ag.addColorStop(1,'rgba(233,113,50,0.04)');
      ctx.beginPath();ctx.moveTo(pts[0].x,base);ctx.lineTo(pts[0].x,pts[0].y);
      for(var i=1;i<pts.length;i++){var mx=(pts[i-1].x+pts[i].x)/2;ctx.bezierCurveTo(mx,pts[i-1].y,mx,pts[i].y,pts[i].x,pts[i].y);}
      ctx.lineTo(pts[pts.length-1].x,base);ctx.closePath();ctx.fillStyle=ag;ctx.fill();
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(var j=1;j<pts.length;j++){var cmx=(pts[j-1].x+pts[j].x)/2;ctx.bezierCurveTo(cmx,pts[j-1].y,cmx,pts[j].y,pts[j].x,pts[j].y);}
      ctx.strokeStyle='#E97132';ctx.lineWidth=2;ctx.lineJoin='round';ctx.stroke();
      var ep=pts[pts.length-1];
      ctx.beginPath();ctx.arc(ep.x,ep.y,4,0,Math.PI*2);ctx.fillStyle='#E97132';ctx.fill();
      ctx.strokeStyle='#080808';ctx.lineWidth=1.5;ctx.stroke();
      if(hi.buyer_price){
        if(hi.buyer_price>=yMin&&hi.buyer_price<=yMax){
          var hy=yP(hi.buyer_price);
          ctx.strokeStyle='rgba(233,113,50,0.5)';ctx.lineWidth=1;ctx.setLineDash([3,4]);
          ctx.beginPath();ctx.moveTo(x0,hy);ctx.lineTo(x1,hy);ctx.stroke();ctx.setLineDash([]);
          ctx.font='8px monospace';ctx.fillStyle='#E97132';ctx.textAlign='right';ctx.textBaseline='bottom';
          ctx.fillText('ATH '+lbl(hi.buyer_price),x1,hy-3);
        }
      }
      if(retAvg!=null&&retAvg>=yMin&&retAvg<=yMax){
        var ry=yP(retAvg);
        ctx.strokeStyle='#5aad7a';ctx.lineWidth=1;ctx.setLineDash([]);
        ctx.beginPath();ctx.moveTo(x0,ry);ctx.lineTo(x1,ry);ctx.stroke();
        ctx.font='8px monospace';ctx.fillStyle='#5aad7a';ctx.textAlign='left';ctx.textBaseline='bottom';
        ctx.fillText('RETAIL '+lbl(retAvg),x0+3,ry-2);
      }
      var now=new Date();
      var ago=new Date(now.getFullYear()-1,now.getMonth(),1).toLocaleString('en-GB',{month:'short',year:'2-digit'});
      ctx.font='8px monospace';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.textBaseline='top';
      ctx.textAlign='left';ctx.fillText(ago,x0,base+5);
      ctx.textAlign='center';ctx.fillText('6M',x0+cw/2,base+5);
      ctx.textAlign='right';ctx.fillText('NOW',x1,base+5);
      ctx.textAlign='left';ctx.fillText('12M AUCTION RANGE · '+(mv12.number_of_trades||'—')+' TRADES',x0,5);
    }

    function paintHistoryChart(canvas, rawPrices, retAvg, filter, accentCol) {
      accentCol = accentCol || '#E97132';
      /* rawPrices: array from WhiskyStats history endpoint — field names vary */
      var dpr  = window.devicePixelRatio || 1;
      var _box = canvas.parentElement;
      var cssW = (_box ? _box.clientWidth  : 0) || 460;
      var cssH = (_box ? _box.clientHeight : 0) || 220;
      canvas.width  = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width  = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.style.display = '';
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var W = cssW, H = cssH;
      var P = {t:20, r:14, b:26, l:52};
      var cw = W - P.l - P.r, ch = H - P.t - P.b;
      var base = P.t + ch;

      function priceLbl(v) {
        if (v == null) return '';
        if (v >= 1000) return (v/1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
        return Math.round(v).toString();
      }

      /* Normalise field names — WhiskyStats uses price_date or date */
      var pts = [];
      (rawPrices || []).forEach(function(p) {
        var d   = p.price_date || p.date || p.auction_date;
        var v   = p.buyer_price || p.hammer_price || p.price;
        if (!d || !v) return;
        var t = new Date(d).getTime();
        if (isNaN(t) || v <= 0) return;
        pts.push({t: t, v: v});
      });
      pts.sort(function(a,b){ return a.t - b.t; });

      /* Apply time filter */
      var now = Date.now();
      var cutoff = 0;
      if (filter === '1Y') cutoff = now - 365 * 86400000;
      else if (filter === '3Y') cutoff = now - 3 * 365 * 86400000;
      var vis = pts.filter(function(p){ return p.t >= cutoff; });

      /* Background */
      ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, W, H);

      if (vis.length < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '9px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('NO DATA FOR THIS PERIOD', W/2, H/2);
        return;
      }

      var tMin = vis[0].t, tMax = vis[vis.length-1].t, tRng = tMax - tMin || 1;
      var vAll = vis.map(function(p){return p.v;});
      var vMin = Math.min.apply(null, vAll) * 0.90;
      var vMax = Math.max.apply(null, vAll) * 1.08;
      if (retAvg && retAvg > vMax) vMax = retAvg * 1.04;
      var vRng = vMax - vMin || 1;

      function xOf(t){ return P.l + ((t - tMin) / tRng) * cw; }
      function yOf(v){ return P.t + ch - ((v - vMin) / vRng) * ch; }

      /* Grid */
      ctx.font = '9px monospace';
      for (var gi = 0; gi <= 4; gi++) {
        var gv = vMin + (gi/4) * vRng, gy = yOf(gv);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(P.l, gy); ctx.lineTo(W - P.r, gy); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(priceLbl(gv), P.l - 5, gy);
      }

      /* Volume bars — monthly */
      var months = {};
      vis.forEach(function(p){
        var d  = new Date(p.t);
        var mk = d.getFullYear() * 12 + d.getMonth();
        if (!months[mk]) months[mk] = { t: new Date(d.getFullYear(), d.getMonth(), 15).getTime(), n: 0 };
        months[mk].n++;
      });
      var maxVol = 1;
      Object.keys(months).forEach(function(k){ if (months[k].n > maxVol) maxVol = months[k].n; });
      var barZone = ch * 0.22;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      Object.keys(months).forEach(function(k){
        var m = months[k];
        var bx = xOf(m.t), bh = (m.n / maxVol) * barZone;
        ctx.fillRect(bx - 2, base - bh, 4, bh);
      });

      /* Retail avg reference line */
      if (retAvg != null && retAvg >= vMin && retAvg <= vMax) {
        var ry = yOf(retAvg);
        ctx.strokeStyle = '#5aad7a'; ctx.lineWidth = 1; ctx.setLineDash([3,4]);
        ctx.beginPath(); ctx.moveTo(P.l, ry); ctx.lineTo(W - P.r, ry); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '8px monospace'; ctx.fillStyle = '#5aad7a';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText('RETAIL ' + priceLbl(retAvg), P.l + 3, ry - 2);
      }

      /* Scatter dots */
      var accentRgb = accentCol === '#5aad7a' ? '90,173,122' : '233,113,50';
      vis.forEach(function(p){
        ctx.beginPath();
        ctx.arc(xOf(p.t), yOf(p.v), 1.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + accentRgb + ',0.45)';
        ctx.fill();
      });

      /* Rolling average line */
      var win = Math.max(3, Math.floor(vis.length / 25));
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < vis.length; i++) {
        var s = Math.max(0, i - win + 1), avg = 0;
        for (var k = s; k <= i; k++) avg += vis[k].v;
        avg /= (i - s + 1);
        var mx = xOf(vis[i].t), my = yOf(avg);
        if (!started){ ctx.moveTo(mx, my); started = true; } else ctx.lineTo(mx, my);
      }
      ctx.strokeStyle = accentCol; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

      /* Endpoint dot */
      var last = vis[vis.length - 1];
      ctx.beginPath(); ctx.arc(xOf(last.t), yOf(last.v), 4, 0, Math.PI * 2);
      ctx.fillStyle = accentCol; ctx.fill();
      ctx.strokeStyle = '#080808'; ctx.lineWidth = 1.5; ctx.stroke();

      /* X-axis year labels */
      var sy = new Date(tMin).getFullYear(), ey = new Date(tMax).getFullYear();
      var step = (ey - sy) > 6 ? 2 : 1;
      ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (var yr = sy; yr <= ey; yr += step) {
        var xt = new Date(yr, 0, 1).getTime();
        if (xt >= tMin && xt <= tMax) ctx.fillText(String(yr), xOf(xt), base + 3);
      }

      /* Header */
      ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText((accentCol === '#5aad7a' ? 'RETAIL' : 'AUCTION') + ' PRICE HISTORY · ' + vis.length + ' SALES', P.l, 4);
    }

    /* ── Layout ── */
    body.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#090909;font-family:var(--font,monospace);';

    function ddSel(items, key, placeholderIndex) {
      return '<select class="wl-flt" data-flt="'+key+'" style="background:#111;border:1px solid #252525;color:#fff;font-family:var(--font);font-size:10px;letter-spacing:.08em;padding:5px 6px;cursor:pointer;max-width:110px;">' +
        items.map(function(v,i){ return '<option value="'+(i===0?'':v)+'">'+(i===0?v:v)+'</option>'; }).join('') +
      '</select>';
    }

    body.innerHTML =
      /* ── Filter bar ── */
      '<div style="display:flex;gap:5px;align-items:center;padding:7px 10px;border-bottom:1px solid #181818;flex-shrink:0;flex-wrap:wrap;">' +
        '<span style="font-size:10px;letter-spacing:.14em;color:#fff;opacity:.45;margin-right:3px;">FILTER</span>' +
        ddSel(REGIONS, 'region') +
        ddSel(AGES,    'age') +
        ddSel(CASKS,   'cask') +
        '<input id="wl-dis-'+id+'" type="text" placeholder="DISTILLERY..." style="background:#111;border:1px solid #252525;color:#fff;font-family:var(--font);font-size:10px;letter-spacing:.08em;padding:5px 8px;outline:none;width:110px;" />' +
        '<div style="flex:1;"></div>' +
        '<select id="wl-cur-'+id+'" style="background:#111;border:1px solid #252525;color:#fff;font-family:var(--font);font-size:10px;padding:5px 5px;letter-spacing:.08em;cursor:pointer;">' +
          CURRENCIES.map(function(c){ return '<option value="'+c+'"'+(c==='GBP'?' selected':'')+'>'+c+'</option>'; }).join('') +
        '</select>' +
      '</div>' +
      /* ── Search bar + INDICES button ── */
      '<div style="display:flex;gap:5px;padding:7px 10px;border-bottom:1px solid #181818;flex-shrink:0;">' +
        '<input id="wl-q-'+id+'" type="text" placeholder="▸  Search distillery, bottling, vintage..." '+
          'style="flex:1;background:#111;border:1px solid #252525;color:#fff;font-family:var(--font);font-size:11px;letter-spacing:.08em;padding:7px 10px;outline:none;" />' +
        '<button id="wl-idx-'+id+'" style="background:transparent;border:1px solid #252525;color:#fff;font-family:var(--font);font-size:9px;letter-spacing:.12em;padding:7px 12px;cursor:pointer;white-space:nowrap;">INDICES</button>' +
        '<button id="wl-mon-'+id+'" style="background:transparent;border:1px solid #252525;color:#fff;font-family:var(--font);font-size:9px;letter-spacing:.12em;padding:7px 12px;cursor:pointer;white-space:nowrap;">MONITOR</button>' +
      '</div>' +
      /* ── Split body ── */
      '<div style="flex:1;display:flex;overflow:hidden;">' +
        /* Left: results list */
        '<div id="wl-list-'+id+'" style="width:260px;flex-shrink:0;overflow-y:auto;border-right:1px solid #181818;display:flex;flex-direction:column;">' +
          /* Onboarding */
          '<div id="wl-guide-'+id+'" style="padding:14px 12px;">' +
            '<div style="font-size:10px;letter-spacing:.16em;color:#fff;margin-bottom:10px;">TRY THESE</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;">' +
              SUGGESTED.map(function(s){
                return '<button class="wl-sug" data-q="'+s.q+'" style="background:#111;border:1px solid #1e1e1e;color:#fff;font-family:var(--font);font-size:10px;letter-spacing:.08em;padding:7px 10px;cursor:pointer;text-align:left;">'+s.label+'</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        /* Right: detail panel */
        '<div id="wl-detail-'+id+'" style="flex:1;overflow-y:auto;">' +
          '<div style="padding:28px 16px;text-align:center;">' +
            '<div style="font-size:8px;letter-spacing:.2em;color:#fff;opacity:.3;">SELECT A WHISKY</div>' +
            '<div style="font-size:7px;letter-spacing:.14em;color:#fff;opacity:.2;margin-top:6px;">USE FILTERS OR SEARCH TO FIND A BOTTLE</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      /* ── Footer ── */
      '<div style="padding:4px 10px;font-size:9px;letter-spacing:.12em;color:#fff;opacity:.4;border-top:1px solid #141414;flex-shrink:0;display:flex;justify-content:space-between;">' +
        '<span>DATA BY WHISKYSTATS · WHISKYBASE</span>' +
        '<span id="wl-cr-'+id+'"></span>' +
      '</div>';

    var qEl     = body.querySelector('#wl-q-'+id);
    var disEl   = body.querySelector('#wl-dis-'+id);
    var curEl   = body.querySelector('#wl-cur-'+id);
    var listEl  = body.querySelector('#wl-list-'+id);
    var guideEl = body.querySelector('#wl-guide-'+id);
    var detailEl= body.querySelector('#wl-detail-'+id);
    var crEl    = body.querySelector('#wl-cr-'+id);

    /* Credits — fetch once per hour, cache in localStorage */
    (function(){
      var CR_KEY = 'tbt_wl_credits', CR_TTL = 3600000;
      try {
        var cached = JSON.parse(localStorage.getItem(CR_KEY)||'null');
        if (cached && Date.now() - cached.ts < CR_TTL) { crEl.textContent = cached.txt; return; }
      } catch(e){}
      fetch('/.netlify/functions/whisky-data?type=credits').then(function(r){ return r.json(); }).then(function(d){
        if (d.credit_usage != null) {
          var txt = (d.credit_limit - d.credit_usage) + ' CREDITS';
          crEl.textContent = txt;
          try { localStorage.setItem(CR_KEY, JSON.stringify({txt:txt, ts:Date.now()})); } catch(e){}
        }
      }).catch(function(){});
    })();

    /* ── Helpers ── */
    function fmt(n, cur) {
      if (n == null) return '—';
      var sym = {GBP:'£',USD:'$',EUR:'€',HKD:'HK$',JPY:'¥',SGD:'S$',CHF:'Fr',AUD:'A$',CAD:'C$',CNY:'¥'}[cur]||cur+' ';
      return sym + Number(n).toLocaleString('en-GB',{maximumFractionDigits:0});
    }
    function fmtPct(n) { return n == null ? '—' : (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'; }
    function col(n) { return n == null ? '#fff' : n >= 0 ? '#5aad7a' : '#e05050'; }
    function priceLbl(v) {
      if (v == null) return '—';
      return v >= 100000 ? (v/1000).toFixed(0)+'k' : v >= 10000 ? (v/1000).toFixed(1)+'k' : v >= 1000 ? (v/1000).toFixed(2)+'k' : v.toFixed(0);
    }
    function statRow(lbl, val, vc) {
      return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid #141414;">' +
        '<span style="font-size:10px;letter-spacing:.1em;color:#fff;opacity:.55;">'+lbl+'</span>' +
        '<span style="font-size:12px;letter-spacing:.03em;color:'+(vc||'#fff')+';">'+val+'</span>' +
      '</div>';
    }

    /* ── Watchlist ── */
    function getWl() { try { return JSON.parse(localStorage.getItem(_WL_KEY)||'[]'); } catch(e){ return []; } }
    function saveWl(a) { try { localStorage.setItem(_WL_KEY, JSON.stringify(a)); } catch(e){} }
    function isWl(wid) { return getWl().some(function(x){ return x.whisky_id === wid; }); }
    function toggleWl(item, btn) {
      var wl = getWl();
      var idx = wl.findIndex(function(x){ return x.whisky_id === item.whisky_id; });
      if (idx >= 0) { wl.splice(idx, 1); btn.textContent = '☆ ADD TO MONITOR'; btn.style.color='#fff'; }
      else { wl.push(item); btn.textContent = '★ IN MONITOR'; btn.style.color='#E97132'; }
      saveWl(wl);
    }

    /* ── (unused — replaced by paintWhiskyChart above) ── */
    function paintTimeChart(canvas, pts, mv, cur) {
      var W = canvas.offsetWidth || 400, H = canvas.height || 160;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      var P = {t:12, r:10, b:22, l:54};
      var cw = W - P.l - P.r, ch = H - P.t - P.b;

      ctx.fillStyle = '#090909'; ctx.fillRect(0, 0, W, H);

      /* Sort pts by date */
      pts.sort(function(a,b){ return new Date(a.date||a.price_date||a.d||0) - new Date(b.date||b.price_date||b.d||0); });
      var prices = pts.map(function(p){ return p.price || p.buyer_price_avg || p.value || p.p || 0; }).filter(function(v){ return v > 0; });
      if (prices.length < 2) { canvas.style.display='none'; return; }

      var yMin = Math.min.apply(null, prices) * 0.92;
      var yMax = Math.max.apply(null, prices) * 1.08;
      if (mv) yMax = Math.max(yMax, mv * 1.08);
      var yRng = yMax - yMin || 1;
      function xP(i){ return P.l + (i / (prices.length - 1)) * cw; }
      function yP(v){ return P.t + ch - ((v - yMin) / yRng) * ch; }

      /* Y grid + labels */
      ctx.font = '8px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      var gridN = 5;
      for (var gi = 0; gi <= gridN; gi++) {
        var gv = yMin + (gi / gridN) * yRng;
        var gy = yP(gv);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(P.l, gy); ctx.lineTo(P.l + cw, gy); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(priceLbl(gv), P.l - 4, gy);
      }

      /* Area fill */
      var grad = ctx.createLinearGradient(0, P.t, 0, P.t + ch);
      grad.addColorStop(0, 'rgba(233,113,50,0.3)');
      grad.addColorStop(1, 'rgba(233,113,50,0)');
      ctx.beginPath();
      ctx.moveTo(xP(0), P.t + ch);
      prices.forEach(function(v,i){ ctx.lineTo(xP(i), yP(v)); });
      ctx.lineTo(xP(prices.length - 1), P.t + ch);
      ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();

      /* Price line */
      ctx.beginPath();
      prices.forEach(function(v,i){
        if (i === 0) ctx.moveTo(xP(0), yP(v));
        else ctx.lineTo(xP(i), yP(v));
      });
      ctx.strokeStyle = '#E97132'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();

      /* Latest price dot */
      var lastX = xP(prices.length - 1), lastY = yP(prices[prices.length - 1]);
      ctx.beginPath(); ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#E97132'; ctx.fill();
      ctx.strokeStyle = '#090909'; ctx.lineWidth = 1.5; ctx.stroke();

      /* X-axis date labels */
      ctx.font = '7px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var firstDate = pts[0] && (pts[0].date || pts[0].price_date || pts[0].d || '');
      var lastDate  = pts[pts.length-1] && (pts[pts.length-1].date || pts[pts.length-1].price_date || pts[pts.length-1].d || '');
      if (firstDate) ctx.fillText(firstDate.slice(0,7), P.l, P.t + ch + 4);
      if (lastDate)  { ctx.textAlign='right'; ctx.fillText(lastDate.slice(0,7), P.l + cw, P.t + ch + 4); }
    }

    /* ── Fallback statistical chart (when no time series) ── */
    function paintStatChart(canvas, auc, ret) {
      var mv12 = auc.latest_12m || {};
      var hi   = auc.max_auction_price || {};
      var mv   = auc.market_value;
      var pts  = [mv12.buyer_price_min, mv12.buyer_price_qrt1, mv12.buyer_price_qrt2, mv12.buyer_price_avg, mv12.buyer_price_qrt3, mv12.buyer_price_max];
      if (!pts[0] || !pts[5] || pts[5] <= pts[0]) { canvas.style.display='none'; return; }

      var W = canvas.offsetWidth || 400, H = canvas.height || 160;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      var P = {t:12, r:16, b:22, l:54};
      var cw = W - P.l - P.r, ch = H - P.t - P.b;

      /* Y scale: min-max of 12M range only, with 8% padding each side */
      var yMin = pts[0] * 0.92, yMax = pts[5] * 1.08;
      var yRng = yMax - yMin || 1;
      function yP(v){ return P.t + ch - ((v - yMin) / yRng) * ch; }

      ctx.fillStyle = '#090909'; ctx.fillRect(0, 0, W, H);

      /* Grid + Y labels */
      ctx.font = '8px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      pts.forEach(function(v){
        if (v == null) return;
        var y = yP(v);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + cw, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(priceLbl(v), P.l - 4, y);
      });

      /* IQR filled band (Q1→Q3) */
      var bx = P.l + 30, bw = cw - 60;
      var q1y = yP(pts[1]), q3y = yP(pts[4]);
      var band = ctx.createLinearGradient(0, q3y, 0, q1y);
      band.addColorStop(0, 'rgba(233,113,50,0.25)');
      band.addColorStop(1, 'rgba(233,113,50,0.08)');
      ctx.fillStyle = band; ctx.fillRect(bx, q3y, bw, q1y - q3y);
      ctx.strokeStyle = 'rgba(233,113,50,0.35)'; ctx.lineWidth = 0.8;
      ctx.strokeRect(bx, q3y, bw, q1y - q3y);

      /* Whiskers */
      var mid = P.l + cw / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([2,3]);
      ctx.beginPath(); ctx.moveTo(mid, yP(pts[0])); ctx.lineTo(mid, q1y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mid, q3y); ctx.lineTo(mid, yP(pts[5])); ctx.stroke();
      ctx.setLineDash([]);
      [pts[0], pts[5]].forEach(function(v){
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mid-16, yP(v)); ctx.lineTo(mid+16, yP(v)); ctx.stroke();
      });

      /* Median */
      ctx.strokeStyle = '#E97132'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(bx, yP(pts[2])); ctx.lineTo(bx + bw, yP(pts[2])); ctx.stroke();

      /* Avg dashed */
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(bx, yP(pts[3])); ctx.lineTo(bx+bw, yP(pts[3])); ctx.stroke();
      ctx.setLineDash([]);

      /* Market value dot on right */
      if (mv != null && mv >= yMin && mv <= yMax) {
        var mvy = yP(mv);
        ctx.beginPath(); ctx.arc(P.l+cw-10, mvy, 5, 0, Math.PI*2);
        ctx.fillStyle = '#E97132'; ctx.fill();
        ctx.strokeStyle = '#090909'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = 'rgba(233,113,50,0.25)'; ctx.lineWidth = 0.8; ctx.setLineDash([2,3]);
        ctx.beginPath(); ctx.moveTo(P.l, mvy); ctx.lineTo(P.l+cw-16, mvy); ctx.stroke();
        ctx.setLineDash([]);
      }

      /* Retail avg */
      var rAvg = ret && ret.retail_price_avg;
      if (rAvg != null && rAvg >= yMin && rAvg <= yMax) {
        ctx.strokeStyle = 'rgba(90,173,122,0.6)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(bx, yP(rAvg)); ctx.lineTo(bx+bw, yP(rAvg)); ctx.stroke();
      }

      /* ATH annotation (outside range — show at top with label) */
      var hiPrice = hi.buyer_price;
      if (hiPrice && hiPrice > yMax) {
        ctx.font = '7px monospace'; ctx.fillStyle = 'rgba(233,113,50,0.7)';
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('ATH ' + priceLbl(hiPrice) + ' (' + (hi.price_date||'').slice(0,7) + ')  ↑', P.l+cw, P.t);
      } else if (hiPrice && hiPrice >= yMin) {
        ctx.strokeStyle = 'rgba(233,113,50,0.25)'; ctx.lineWidth = 0.8; ctx.setLineDash([1,4]);
        ctx.beginPath(); ctx.moveTo(P.l, yP(hiPrice)); ctx.lineTo(P.l+cw, yP(hiPrice)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '7px monospace'; ctx.fillStyle = 'rgba(233,113,50,0.6)'; ctx.textAlign='right'; ctx.textBaseline='bottom';
        ctx.fillText('ATH', P.l+cw, yP(hiPrice)-1);
      }

      /* X-axis labels */
      ctx.font = '7px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText('MIN', mid, P.t+ch+4);
      ctx.fillText('MED', bx+bw/2, P.t+ch+4);
      ctx.fillStyle = '#E97132'; ctx.textAlign='right';
      ctx.fillText('MV', P.l+cw-5, P.t+ch+4);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.textAlign='left';
      ctx.fillText('12M AUCTION RANGE · '+(mv12.number_of_trades||0)+' TRADES', P.l, P.t+ch+4);
    }

    /* ── Render results in left list ── */
    function renderList(data) {
      guideEl.style.display = 'none';
      if (!data || !data.results || !data.results.length) {
        listEl.innerHTML = '<div style="padding:12px 10px;font-size:8px;letter-spacing:.16em;color:#fff;opacity:.4;">NO RESULTS</div>';
        return;
      }
      _results = data.results;
      var html = _results.map(function(r, i) {
        return '<div class="wl-row" data-i="'+i+'" style="display:flex;align-items:center;gap:7px;padding:7px 10px;cursor:pointer;border-bottom:1px solid #111;">' +
          '<img src="'+r.whisky_image_url+'" style="width:20px;height:28px;object-fit:contain;flex-shrink:0;" onerror="this.style.display=\'none\'" />' +
          '<div style="flex:1;min-width:0;">' +
            '<div title="'+r.whisky_name+'" style="font-size:11px;letter-spacing:.04em;color:#fff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+r.whisky_name+'</div>' +
            '<div style="font-size:9px;letter-spacing:.08em;color:#fff;opacity:.4;margin-top:2px;">'+r.whisky_id+'</div>' +
          '</div>' +
        '</div>';
      }).join('');
      /* Re-insert guide at bottom */
      listEl.innerHTML = html;
      listEl.querySelectorAll('.wl-row').forEach(function(row) {
        row.addEventListener('mouseenter', function(){ if (!row.classList.contains('active')) row.style.background='#141414'; });
        row.addEventListener('mouseleave', function(){ if (!row.classList.contains('active')) row.style.background=''; });
        row.addEventListener('click', function() {
          listEl.querySelectorAll('.wl-row').forEach(function(r){ r.classList.remove('active'); r.style.background=''; });
          row.classList.add('active'); row.style.background='#1a1a1a';
          loadBottle(_results[parseInt(row.dataset.i)]);
        });
      });
    }

    /* ── Cache helpers (24h for full data, 7d for history) ── */
    function cacheGet(key, ttl) {
      try {
        var v = JSON.parse(localStorage.getItem(key)||'null');
        if (v && Date.now() - v.ts < ttl) return v.data;
      } catch(e){}
      return null;
    }
    function cacheSet(key, data) {
      try { localStorage.setItem(key, JSON.stringify({data:data, ts:Date.now()})); } catch(e){}
    }

    /* ── Stage 1: browse — details + rating only (3 credits) ── */
    function loadBottle(item) {
      _selectedId = item.whisky_id;
      var brKey = 'tbt_br_'+item.whisky_id;
      var cached = cacheGet(brKey, 86400000);
      if (cached) { renderBrowse(cached, item); return; }
      detailEl.innerHTML = '<div style="padding:16px;font-size:8px;letter-spacing:.18em;color:#fff;opacity:.4;">LOADING<span class="ld"></span></div>';
      fetch('/.netlify/functions/whisky-data?type=browse&id='+encodeURIComponent(item.whisky_id))
        .then(function(r){ return r.json(); })
        .then(function(d){ cacheSet(brKey, d); renderBrowse(d, item); })
        .catch(function(){ detailEl.innerHTML='<div style="padding:16px;font-size:8px;letter-spacing:.14em;color:#fff;opacity:.4;">DATA UNAVAILABLE</div>'; });
    }

    function renderBrowse(d, item) {
      var det  = d.details || {};
      var rat  = d.rating  || {};
      var bgId = d.bg_id || det.parent_bottle_group_id || item.whisky_id;
      var inWl = isWl(item.whisky_id);

      detailEl.innerHTML =
        '<div style="padding:10px 12px;">' +
          '<div style="display:flex;gap:10px;align-items:flex-start;padding-bottom:10px;border-bottom:1px solid #181818;margin-bottom:10px;">' +
            '<img src="'+(det.whisky_image_url||'')+'" style="width:42px;object-fit:contain;flex-shrink:0;" onerror="this.style.display=\'none\'" />' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:10px;letter-spacing:.18em;color:#fff;opacity:.5;margin-bottom:3px;">'+(det.brand||'')+'</div>' +
              '<div style="font-size:15px;letter-spacing:.04em;color:#fff;line-height:1.2;">'+(det.bottler_serie||'')+' '+(det.name||'')+'</div>' +
              '<div style="font-size:10px;letter-spacing:.08em;color:#fff;opacity:.5;margin-top:4px;">'+(det.type||'')+(det.age?' · '+det.age+'YO':'')+(det.strength?' · '+det.strength+'%vol':'')+(det.cask_type?' · '+det.cask_type:'')+(det.bottle_year?' · '+det.bottle_year:'')+(det.country?' · '+det.country:'')+'</div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0;">' +
              (rat.whiskybase_rating!=null ?
                '<div style="font-size:24px;color:#E97132;font-weight:bold;">'+rat.whiskybase_rating.toFixed(1)+'</div>'+
                '<div style="font-size:10px;letter-spacing:.08em;color:#fff;opacity:.45;">'+rat.whiskybase_rating_count+' RATINGS</div>' : '') +
            '</div>' +
          '</div>' +
          '<div style="margin-bottom:12px;">' +
            (det.distillery       ? statRow('DISTILLERY',        det.distillery) : '') +
            (det.region           ? statRow('REGION',            det.region) : '') +
            (det.age              ? statRow('AGE STATEMENT',     det.age + ' Years') : '') +
            (det.vintage          ? statRow('VINTAGE',           det.vintage) : '') +
            (det.bottle_year      ? statRow('BOTTLED',           det.bottle_year) : '') +
            (det.strength         ? statRow('STRENGTH',          det.strength + '% vol') : '') +
            (det.cask_type        ? statRow('CASK TYPE',         det.cask_type) : '') +
            (det.bottles_produced ? statRow('BOTTLES PRODUCED',  Number(det.bottles_produced).toLocaleString()) : '') +
          '</div>' +
          '<div id="wl-mktcta-'+id+'" style="background:#0d0d0d;border:1px solid #1e1e1e;padding:14px 12px;margin-bottom:10px;text-align:center;">' +
            '<div style="font-size:10px;letter-spacing:.16em;color:#fff;opacity:.45;margin-bottom:10px;">MARKET DATA NOT LOADED</div>' +
            '<button id="wl-loadmkt-'+id+'" style="background:#E97132;border:none;color:#000;font-family:var(--font);font-size:10px;letter-spacing:.14em;padding:10px 20px;cursor:pointer;font-weight:bold;">LOAD AUCTION & MARKET DATA</button>' +
            '<div style="font-size:9px;letter-spacing:.1em;color:#fff;opacity:.3;margin-top:8px;">CACHED 24H AFTER FIRST LOAD</div>' +
          '</div>' +
          '<div><button id="wl-star-'+id+'" style="background:#111;border:1px solid #252525;color:'+(inWl?'#E97132':'#fff')+';font-family:var(--font);font-size:10px;letter-spacing:.1em;padding:8px 12px;cursor:pointer;">'+(inWl?'★ IN MONITOR':'☆ ADD TO MONITOR')+'</button></div>' +
        '</div>';

      var loadBtn = detailEl.querySelector('#wl-loadmkt-'+id);
      if (loadBtn) loadBtn.addEventListener('click', function(){ loadMarket(bgId, item, det, rat); });
      var starBtn = detailEl.querySelector('#wl-star-'+id);
      if (starBtn) starBtn.addEventListener('click', function(){
        toggleWl({whisky_id:item.whisky_id, bg_id:bgId, name:(det.bottler_serie||'')+' '+(det.name||''), currency:_cur}, starBtn);
      });
      /* Auto-load market if already cached (free) */
      var mktKey = 'tbt_mkt_'+bgId+'_'+_cur;
      if (cacheGet(mktKey, 86400000)) loadMarket(bgId, item, det, rat);
    }

    /* ── Stage 2b: history — individual auction sales (cached 7d) ── */
    function loadHistory(bgId, retAvg) {
      var hKey = 'tbt_hist_' + bgId + '_' + _cur;
      var _filter = 'ALL';

      function repaint(allPts, filter) {
        var canvas   = detailEl.querySelector('#wl-chart-' + id);
        if (!canvas) return;
        var cutoff = 0;
        if (filter === '1Y') cutoff = Date.now() - 365 * 86400000;
        else if (filter === '3Y') cutoff = Date.now() - 3 * 365 * 86400000;
        var vis = (allPts || []).filter(function(p){
          var d = p.price_date || p.date || p.auction_date;
          return d && new Date(d).getTime() >= cutoff;
        });
        /* Highlight active filter button */
        var bar = detailEl.querySelector('#wl-hfbar-' + id);
        if (bar) {
          bar.querySelectorAll('button').forEach(function(b){
            var on = b.dataset.f === filter;
            b.style.background = on ? '#E97132' : 'transparent';
            b.style.color      = on ? '#000'    : '#fff';
            b.style.borderColor= on ? '#E97132' : '#252525';
          });
        }
        requestAnimationFrame(function(){
          requestAnimationFrame(function(){
            paintHistoryChart(canvas, vis, retAvg, filter);
          });
        });
      }

      function extractPts(d) {
        /* Try every key WhiskyStats might use — log to console so we can see exact structure */
        if (Array.isArray(d)) { console.log('[WL-HIST] root is array, len:', d.length, 'sample:', JSON.stringify(d[0])); return d; }
        var tryKeys = ['prices','auction_price_history','auction_prices','price_history','history','results','data','records','items','sales'];
        for (var ki = 0; ki < tryKeys.length; ki++) {
          if (d[tryKeys[ki]] && Array.isArray(d[tryKeys[ki]])) {
            console.log('[WL-HIST] key='+tryKeys[ki]+' len:'+d[tryKeys[ki]].length+' sample:'+JSON.stringify(d[tryKeys[ki]][0]));
            return d[tryKeys[ki]];
          }
        }
        /* Last resort: grab first non-empty array value */
        var keys = Object.keys(d);
        for (var i = 0; i < keys.length; i++) {
          if (Array.isArray(d[keys[i]]) && d[keys[i]].length) {
            console.log('[WL-HIST] fallback key='+keys[i]+' len:'+d[keys[i]].length+' sample:'+JSON.stringify(d[keys[i]][0]));
            return d[keys[i]];
          }
        }
        console.log('[WL-HIST] no array found. keys:', JSON.stringify(keys), 'full:', JSON.stringify(d).slice(0,300));
        return [];
      }

      function renderWithHistory(d) {
        var allPts = extractPts(d);
        /* If no history data available (endpoint not in plan), leave aggregate chart as-is */
        if (!allPts.length) return;

        /* We have history data — inject filter bar and paint scatter chart */
        var chartBox = detailEl.querySelector('#wl-chartbox-' + id);
        if (chartBox && !detailEl.querySelector('#wl-hfbar-' + id)) {
          var bar = document.createElement('div');
          bar.id = 'wl-hfbar-' + id;
          bar.style.cssText = 'display:flex;align-items:center;gap:4px;padding:8px 0 4px;';
          var lbl = document.createElement('span');
          lbl.textContent = 'AUCTION';
          lbl.style.cssText = 'font-size:9px;letter-spacing:.14em;color:#fff;opacity:.5;margin-right:4px;';
          bar.appendChild(lbl);
          ['ALL','3Y','1Y'].forEach(function(f){
            var b = document.createElement('button');
            b.dataset.f = f; b.textContent = f;
            b.style.cssText = 'background:' + (f==='ALL'?'#E97132':'transparent') + ';border:1px solid ' + (f==='ALL'?'#E97132':'#252525') + ';color:' + (f==='ALL'?'#000':'#fff') + ';font-family:var(--font,monospace);font-size:9px;letter-spacing:.1em;padding:3px 10px;cursor:pointer;';
            b.addEventListener('click', function(){ _filter = f; repaint(allPts, f); });
            bar.appendChild(b);
          });
          chartBox.parentNode.insertBefore(bar, chartBox);
        }
        repaint(allPts, _filter);
      }

      var cached = cacheGet(hKey, 7 * 24 * 60 * 60 * 1000);
      if (cached && !cached._tbt_empty) { renderWithHistory(cached); return; }
      if (cached && cached._tbt_empty) return; /* endpoint failed previously, don't retry */
      fetch('/.netlify/functions/whisky-data?type=history&id=' + encodeURIComponent(bgId) + '&currency=' + _cur)
        .then(function(r){ return r.json(); })
        .then(function(d){ cacheSet(hKey, d); if (!d._tbt_empty) renderWithHistory(d); })
        .catch(function(){});
    }

    /* ── Stage 2c: retail history ── */
    function loadRetailHistory(bgId, retAvg) {
      var hKey = 'tbt_rhist_' + bgId + '_' + _cur;
      var _filter = 'ALL';

      function extractPts(d) {
        if (Array.isArray(d)) return d;
        var tryKeys = ['prices','retail_price_history','retail_prices','price_history','history','results','data','records','items'];
        for (var ki = 0; ki < tryKeys.length; ki++) {
          if (d[tryKeys[ki]] && Array.isArray(d[tryKeys[ki]])) return d[tryKeys[ki]];
        }
        var keys = Object.keys(d);
        for (var i = 0; i < keys.length; i++) {
          if (Array.isArray(d[keys[i]]) && d[keys[i]].length) return d[keys[i]];
        }
        console.log('[WL-RETAIL-HIST]', JSON.stringify(d).slice(0,200));
        return [];
      }

      function repaintRetail(allPts, filter) {
        var canvas = detailEl.querySelector('#wl-rchart-' + id);
        if (!canvas) return;
        var cutoff = 0;
        if (filter === '1Y') cutoff = Date.now() - 365 * 86400000;
        else if (filter === '3Y') cutoff = Date.now() - 3 * 365 * 86400000;
        var vis = (allPts || []).filter(function(p){
          var dt = p.price_date || p.date || p.retail_date || p.listing_date;
          return dt && new Date(dt).getTime() >= cutoff;
        });
        var bar = detailEl.querySelector('#wl-rhfbar-' + id);
        if (bar) {
          bar.querySelectorAll('button').forEach(function(b){
            var on = b.dataset.f === filter;
            b.style.background  = on ? '#5aad7a' : 'transparent';
            b.style.color       = on ? '#000'    : '#fff';
            b.style.borderColor = on ? '#5aad7a' : '#252525';
          });
        }
        requestAnimationFrame(function(){
          requestAnimationFrame(function(){
            paintHistoryChart(canvas, vis, null, filter, '#5aad7a');
          });
        });
      }

      function renderWithRetailHistory(d) {
        var allPts = extractPts(d);
        if (!allPts.length) return; /* endpoint returned nothing — skip silently */

        var rBox = detailEl.querySelector('#wl-rchartbox-' + id);
        if (!rBox) return;
        rBox.style.display = '';

        if (!detailEl.querySelector('#wl-rhfbar-' + id)) {
          var bar = document.createElement('div');
          bar.id = 'wl-rhfbar-' + id;
          bar.style.cssText = 'display:flex;align-items:center;gap:4px;padding:8px 0 4px;';
          var lbl = document.createElement('span');
          lbl.textContent = 'RETAIL';
          lbl.style.cssText = 'font-size:9px;letter-spacing:.14em;color:#5aad7a;opacity:.8;margin-right:4px;';
          bar.appendChild(lbl);
          ['ALL','3Y','1Y'].forEach(function(f){
            var b = document.createElement('button');
            b.dataset.f = f; b.textContent = f;
            b.style.cssText = 'background:' + (f==='ALL'?'#5aad7a':'transparent') + ';border:1px solid ' + (f==='ALL'?'#5aad7a':'#252525') + ';color:' + (f==='ALL'?'#000':'#fff') + ';font-family:var(--font,monospace);font-size:9px;letter-spacing:.1em;padding:3px 10px;cursor:pointer;';
            b.addEventListener('click', function(){ _filter = f; repaintRetail(allPts, f); });
            bar.appendChild(b);
          });
          rBox.parentNode.insertBefore(bar, rBox);
        }
        repaintRetail(allPts, _filter);
      }

      var cached = cacheGet(hKey, 7 * 24 * 60 * 60 * 1000);
      if (cached && !cached._tbt_empty) { renderWithRetailHistory(cached); return; }
      if (cached && cached._tbt_empty) return;
      fetch('/.netlify/functions/whisky-data?type=retail_history&id=' + encodeURIComponent(bgId) + '&currency=' + _cur)
        .then(function(r){ return r.json(); })
        .then(function(d){ cacheSet(hKey, d); if (!d._tbt_empty) renderWithRetailHistory(d); })
        .catch(function(){});
    }

    /* ── Stage 2: market — auction + retail (15 credits, cached 24h) ── */
    function loadMarket(bgId, item, det, rat) {
      var mktKey = 'tbt_mkt_'+bgId+'_'+_cur;
      var ctaEl  = detailEl.querySelector('#wl-mktcta-'+id);
      if (ctaEl) ctaEl.innerHTML = '<div style="font-size:8px;letter-spacing:.16em;color:#fff;opacity:.4;padding:6px 0;">LOADING MARKET DATA<span class="ld"></span></div>';

      function renderMarket(m) {
        cacheSet(mktKey, m);
        var auc  = m.auction || {};
        var ret  = m.retail  || {};
        var cur  = m.currency || _cur;
        var mv   = auc.market_value;
        var mv12 = auc.latest_12m || {};
        var lat  = auc.latest_auction_price || {};
        var hi   = auc.max_auction_price || {};
        var chg  = mv12.market_value_change_pct;
        var inWl = isWl(item.whisky_id);
        var cta  = detailEl.querySelector('#wl-mktcta-'+id);
        if (!cta) return;
        var rAvg = ret.retail_price_avg;
        cta.outerHTML =
          (mv!=null ?
            '<div style="background:#0d0d0d;border:1px solid #1e1e1e;padding:8px 12px;margin-bottom:8px;">' +
              '<div style="font-size:10px;letter-spacing:.16em;color:#fff;opacity:.45;margin-bottom:4px;">MARKET VALUE · '+cur+'</div>' +
              '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">' +
                '<div style="font-size:28px;letter-spacing:.02em;color:#E97132;">'+fmt(mv,cur)+'</div>' +
                '<div style="font-size:13px;color:'+(chg!=null?(chg>=0?'#5aad7a':'#e05050'):'#fff')+';">'+fmtPct(chg)+' 12M</div>' +
                (auc.total_trades ? '<div style="font-size:10px;color:#fff;opacity:.4;margin-left:auto;">'+auc.total_trades.toLocaleString()+' TOTAL TRADES</div>' : '') +
              '</div>' +
            '</div>' : '') +
          /* auction chart — filter bar injected dynamically by loadHistory */
          '<div id="wl-chartbox-'+id+'" class="wl-chart-area">' +
            '<canvas id="wl-chart-'+id+'" class="wl-chart-canvas"></canvas>' +
          '</div>' +
          /* retail chart — hidden until loadRetailHistory finds data */
          '<div id="wl-rchartbox-'+id+'" class="wl-chart-area" style="display:none;">' +
            '<canvas id="wl-rchart-'+id+'" class="wl-chart-canvas"></canvas>' +
          '</div>' +
          '<div style="margin-bottom:10px;">' +
            statRow('LATEST AUCTION', fmt(lat.buyer_price_avg,cur)) +
            statRow('LAST SOLD', lat.price_date||'—') +
            statRow('12M RANGE', lat.buyer_price_min!=null ? fmt(lat.buyer_price_min,cur)+' – '+fmt(lat.buyer_price_max,cur) : '—') +
            statRow('12M MEDIAN / Q1 / Q3',
              mv12.buyer_price_qrt2!=null
                ? fmt(mv12.buyer_price_qrt2,cur)+' / '+fmt(mv12.buyer_price_qrt1,cur)+' / '+fmt(mv12.buyer_price_qrt3,cur)
                : '—') +
            statRow('ALL-TIME HIGH', hi.buyer_price ? fmt(hi.buyer_price,cur)+(hi.price_date?' · '+hi.price_date:'') : '—', '#E97132') +
            statRow('LAST SOLD DATE', auc.market_value_date||'—') +
            (rAvg!=null ? statRow('RETAIL AVG · '+ret.number_of_retail_listings+' LISTINGS', fmt(rAvg,cur), '#5aad7a') : '') +
            (ret.retail_price_min!=null ? statRow('RETAIL RANGE', fmt(ret.retail_price_min,cur)+' – '+fmt(ret.retail_price_max,cur)) : '') +
          '</div>';

        /* Paint aggregate chart immediately (no extra credits), then attempt history upgrade */
        var att = 0;
        var canvas   = detailEl.querySelector('#wl-chart-'+id);
        var chartBox = detailEl.querySelector('#wl-chartbox-'+id);
        (function tryHistory(){
          if (!chartBox.offsetWidth && att++ < 14) { setTimeout(tryHistory, 50); return; }
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              paintAggregateChart(canvas, auc, rAvg);
              /* loadHistory will silently replace with scatter chart if endpoint becomes available */
              loadHistory(bgId, rAvg);
              loadRetailHistory(bgId, rAvg);
            });
          });
        })();
      }

      var cached = cacheGet(mktKey, 86400000);
      if (cached) { renderMarket(cached); return; }
      fetch('/.netlify/functions/whisky-data?type=market&id='+encodeURIComponent(bgId)+'&currency='+_cur)
        .then(function(r){ return r.json(); })
        .then(renderMarket)
        .catch(function(){
          var cta = detailEl.querySelector('#wl-mktcta-'+id);
          if (cta) cta.innerHTML = '<div style="font-size:8px;letter-spacing:.14em;color:#fff;opacity:.4;padding:6px 0;">MARKET DATA UNAVAILABLE</div>';
        });
    }

    /* ── Build search query from filters + text ── */
    function buildQuery() {
      var parts = [];
      var dis = disEl.value.trim();
      if (dis) parts.push(dis);
      if (_filters.region) parts.push(_filters.region);
      var q   = qEl.value.trim();
      if (q) parts.push(q);
      if (_filters.age && _filters.age !== 'NAS') parts.push(_filters.age.replace('YO','').replace('+','') + ' year');
      else if (_filters.age === 'NAS') parts.push('NAS');
      if (_filters.cask) parts.push(_filters.cask.split(' ')[0]); /* e.g. "Sherry" from "Sherry Butt" */
      return parts.join(' ').trim();
    }

    /* ── Search ── */
    function doSearch() {
      var q = buildQuery();
      if (!q || q.length < 2) return;
      listEl.innerHTML = '<div style="padding:10px;font-size:8px;letter-spacing:.16em;color:#fff;opacity:.4;">SEARCHING<span class="ld"></span></div>';
      fetch('/.netlify/functions/whisky-data?type=search&query='+encodeURIComponent(q)+'&page=1')
        .then(function(r){ return r.json(); })
        .then(renderList)
        .catch(function(){ listEl.innerHTML='<div style="padding:10px;font-size:8px;letter-spacing:.14em;color:#fff;opacity:.4;">ERROR</div>'; });
    }

    /* Search on type */
    qEl.addEventListener('input', function(){
      clearTimeout(_debounce);
      _debounce = setTimeout(doSearch, 380);
    });
    disEl.addEventListener('input', function(){
      clearTimeout(_debounce);
      _debounce = setTimeout(doSearch, 380);
    });

    /* Filter selects */
    body.querySelectorAll('.wl-flt').forEach(function(sel){
      sel.addEventListener('change', function(){
        _filters[sel.dataset.flt] = sel.value;
        clearTimeout(_debounce);
        _debounce = setTimeout(doSearch, 200);
      });
    });

    /* Currency */
    curEl.addEventListener('change', function(){
      _cur = curEl.value;
      if (_selectedId) {
        var item = (_results||[]).find(function(r){ return r.whisky_id === _selectedId; }) || {whisky_id:_selectedId};
        loadBottle(item);
      }
    });

    /* Suggested pills */
    body.querySelectorAll('.wl-sug').forEach(function(btn){
      btn.addEventListener('click', function(){
        qEl.value = btn.dataset.q;
        doSearch();
      });
    });

    /* ── INDICES button ── */
    var idxBtn = body.querySelector('#wl-idx-'+id);
    if (idxBtn) idxBtn.addEventListener('click', showIndicesView);

    /* ── MONITOR button ── */
    var monBtn = body.querySelector('#wl-mon-'+id);
    if (monBtn) monBtn.addEventListener('click', showMonitorView);

    function showMonitorView() {
      /* Highlight MONITOR button, reset INDICES */
      monBtn.style.background = '#E97132'; monBtn.style.color = '#000'; monBtn.style.borderColor = '#E97132';
      if (idxBtn) { idxBtn.style.background = ''; idxBtn.style.color = '#fff'; idxBtn.style.borderColor = '#252525'; }

      var wl = getWl();

      if (!wl.length) {
        listEl.innerHTML = '<div style="padding:20px 12px;font-size:9px;letter-spacing:.16em;color:#fff;opacity:.35;text-align:center;">NO WHISKIES IN MONITOR<br><br>Search a bottle and click<br>☆ ADD TO MONITOR</div>';
        detailEl.innerHTML = '';
        return;
      }

      /* Left panel: list of monitored whiskies */
      listEl.innerHTML = '<div style="padding:7px 12px 5px;font-size:7px;letter-spacing:.2em;color:#E97132;border-bottom:1px solid #181818;">MONITOR · ' + wl.length + ' BOTTLE' + (wl.length !== 1 ? 'S' : '') + '</div>' +
        wl.map(function(item, i) {
          var name = item.name || item.whisky_id || 'Unknown';
          var sub  = [item.region, item.age ? item.age + 'YO' : null, item.cask].filter(Boolean).join(' · ');
          return '<div class="wl-mon-row" data-i="'+i+'" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #111;display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:10px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escH(name)+'</div>' +
              (sub ? '<div style="font-size:8px;color:#fff;opacity:.4;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escH(sub)+'</div>' : '') +
            '</div>' +
            '<button class="wl-mon-del" data-i="'+i+'" title="Remove" style="background:none;border:none;color:#fff;opacity:.3;font-size:12px;cursor:pointer;flex-shrink:0;padding:0 0 0 8px;line-height:1;">✕</button>' +
          '</div>';
        }).join('');

      /* Click row → load detail */
      listEl.querySelectorAll('.wl-mon-row').forEach(function(row) {
        row.addEventListener('mouseenter', function() { if (!row.classList.contains('active')) row.style.background='#141414'; });
        row.addEventListener('mouseleave', function() { if (!row.classList.contains('active')) row.style.background=''; });
        row.addEventListener('click', function(e) {
          if (e.target.classList.contains('wl-mon-del')) return;
          listEl.querySelectorAll('.wl-mon-row').forEach(function(r) { r.classList.remove('active'); r.style.background=''; });
          row.classList.add('active'); row.style.background='#1a1a1a';
          var item = getWl()[parseInt(row.dataset.i, 10)];
          if (!item) return;
          detailEl.innerHTML = '<div style="padding:16px;font-size:8px;letter-spacing:.16em;color:#fff;opacity:.4;">LOADING<span class="ld"></span></div>';
          fetchAndShowDetail(item.whisky_id, item.name);
        });
      });

      /* Remove button */
      listEl.querySelectorAll('.wl-mon-del').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = parseInt(btn.dataset.i, 10);
          var wl2 = getWl();
          wl2.splice(idx, 1);
          saveWl(wl2);
          showMonitorView();
        });
      });
    }

    function fetchAndShowDetail(wid, name) {
      var brKey = 'tbt_br_' + wid;
      var cached = cacheGet(brKey, 86400000);
      if (cached) { renderBrowse(cached, { whisky_id: wid, name: name }); return; }
      fetch('/.netlify/functions/whisky-data?type=browse&id=' + encodeURIComponent(wid))
        .then(function(r) { return r.json(); })
        .then(function(d) { cacheSet(brKey, d); renderBrowse(d, { whisky_id: wid, name: name }); })
        .catch(function() { detailEl.innerHTML = '<div style="padding:20px;font-size:9px;color:#e05050;letter-spacing:.1em;">FAILED TO LOAD</div>'; });
    }

    /* ── INDICES — region table + history charts ── */
    var REGION_NAMES = [
      {key:'', label:'WHISKYSTATS INDEX', sub:'Top 500 most traded'},
      {key:'Scotland', label:'SCOTLAND', sub:'Broad Scotland index'},
      {key:'Speyside', label:'SPEYSIDE', sub:''},
      {key:'Highlands', label:'HIGHLANDS', sub:''},
      {key:'Islay', label:'ISLAY', sub:''},
      {key:'Campbeltown', label:'CAMPBELTOWN', sub:''},
      {key:'Lowlands', label:'LOWLANDS', sub:''},
      {key:'Islands', label:'ISLANDS', sub:''},
      {key:'Ireland', label:'IRELAND', sub:''},
      {key:'Japan', label:'JAPAN', sub:''},
    ];

    function fmtChg(v) {
      if (v == null) return '—';
      var s = (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
      return s;
    }
    function chgCol(v) { return v == null ? '#fff' : v >= 0 ? '#5aad7a' : '#e05050'; }

    function showIndicesView() {
      /* Highlight INDICES button */
      idxBtn.style.background = '#E97132'; idxBtn.style.color = '#000'; idxBtn.style.borderColor = '#E97132';

      /* Left panel: region nav list */
      listEl.innerHTML = REGION_NAMES.map(function(r, i) {
        return '<div class="wl-idx-nav" data-k="'+escH(r.key)+'" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #111;'+(i===0?'background:#1a1a1a;':'')+'">' +
          '<div style="font-size:10px;letter-spacing:.06em;color:#fff;">'+escH(r.label)+'</div>' +
          (r.sub ? '<div style="font-size:8px;color:#fff;opacity:.35;margin-top:2px;">'+escH(r.sub)+'</div>' : '') +
        '</div>';
      }).join('');

      /* Right panel: loading */
      detailEl.innerHTML = '<div style="padding:16px;font-size:8px;letter-spacing:.16em;color:#fff;opacity:.4;">LOADING INDICES<span class="ld"></span></div>';

      /* Nav item click */
      listEl.querySelectorAll('.wl-idx-nav').forEach(function(el) {
        el.addEventListener('mouseenter', function(){ if (!el.classList.contains('active')) el.style.background='#141414'; });
        el.addEventListener('mouseleave', function(){ if (!el.classList.contains('active')) el.style.background=''; });
        el.addEventListener('click', function(){
          listEl.querySelectorAll('.wl-idx-nav').forEach(function(e){ e.classList.remove('active'); e.style.background=''; });
          el.classList.add('active'); el.style.background='#1a1a1a';
          showRegionIndex(el.dataset.k, REGION_NAMES.find(function(r){ return r.key===el.dataset.k; })||{label:el.dataset.k});
        });
      });

      /* Auto-load global index */
      listEl.querySelector('.wl-idx-nav').classList.add('active');
      showRegionIndex('', REGION_NAMES[0]);
    }

    function showRegionIndex(regionKey, regionObj) {
      var hKey = 'tbt_idxh_' + (regionKey||'global');
      detailEl.innerHTML = '<div style="padding:16px;font-size:8px;letter-spacing:.16em;color:#fff;opacity:.4;">LOADING<span class="ld"></span></div>';

      function renderIndex(d) {
        if (d._tbt_empty) {
          detailEl.innerHTML = '<div style="padding:16px;font-size:9px;letter-spacing:.1em;color:#fff;opacity:.4;">INDEX DATA NOT AVAILABLE ON CURRENT PLAN</div>';
          return;
        }

        /* Detect data array — WhiskyStats may use different key names */
        var hist = [];
        if (Array.isArray(d)) hist = d;
        else {
          var tryKeys = ['history','index_history','data','results','prices','records','items'];
          for (var ki=0; ki<tryKeys.length; ki++) {
            if (d[tryKeys[ki]] && Array.isArray(d[tryKeys[ki]])) { hist = d[tryKeys[ki]]; break; }
          }
          if (!hist.length) {
            Object.keys(d).some(function(k){ if (Array.isArray(d[k]) && d[k].length){ hist=d[k]; return true; } });
          }
        }
        console.log('[WL-IDX] region:', regionKey||'global', 'keys:', Object.keys(d), 'pts:', hist.length, hist.length?'sample:'+JSON.stringify(hist[0]):'');

        /* Stats from response top-level fields */
        var pts_val = hist.map(function(p){ return p.index_value||p.value||p.index||p.points||p.price||0; }).filter(Boolean);
        var pts_date= hist.map(function(p){ return p.date||p.month||p.period||p.price_date||''; });
        var latest  = d.latest_index_value||d.index_value||d.index_points||d.value||(pts_val.length?pts_val[pts_val.length-1]:null);
        var change1m= d.change_1m||d.one_month_change||d.monthly_change||null;
        var change1y= d.change_1y||d.one_year_change||d.yearly_change||null;
        var change3y= d.change_3y||d.three_year_change||null;
        var total_w = d.total_whiskies||d.whisky_count||null;
        var total_p = d.total_prices||d.price_count||null;
        var updated = d.latest_update||d.updated||d.period||d.date||'';

        var html =
          '<div style="padding:12px;">' +
            '<div style="font-size:12px;letter-spacing:.14em;color:#fff;margin-bottom:10px;">'+escH(regionObj.label)+' INDEX</div>' +
            (latest!=null ?
              '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px;">' +
                '<div><div style="font-size:8px;color:#fff;opacity:.4;letter-spacing:.12em;margin-bottom:3px;">INDEX POINTS</div>' +
                  '<div style="font-size:22px;color:#E97132;">'+Number(latest).toFixed(2)+'</div></div>' +
                (change1m!=null?'<div><div style="font-size:8px;color:#fff;opacity:.4;letter-spacing:.12em;margin-bottom:3px;">1M</div><div style="font-size:14px;color:'+chgCol(change1m)+';">'+fmtChg(change1m)+'</div></div>':'') +
                (change1y!=null?'<div><div style="font-size:8px;color:#fff;opacity:.4;letter-spacing:.12em;margin-bottom:3px;">1Y</div><div style="font-size:14px;color:'+chgCol(change1y)+';">'+fmtChg(change1y)+'</div></div>':'') +
                (change3y!=null?'<div><div style="font-size:8px;color:#fff;opacity:.4;letter-spacing:.12em;margin-bottom:3px;">3Y</div><div style="font-size:14px;color:'+chgCol(change3y)+';">'+fmtChg(change3y)+'</div></div>':'') +
              '</div>' : '') +
            (total_w||total_p ?
              '<div style="display:flex;gap:16px;margin-bottom:12px;">' +
                (total_w?'<div style="font-size:9px;color:#fff;opacity:.5;">'+Number(total_w).toLocaleString()+' INDEX WHISKIES</div>':'') +
                (total_p?'<div style="font-size:9px;color:#fff;opacity:.5;">'+Number(total_p).toLocaleString()+' TOTAL PRICES</div>':'') +
              '</div>' : '') +
          /* Chart */
          '<div id="wl-idx-chartbox" class="wl-chart-area" style="margin-bottom:0;">' +
            '<canvas id="wl-idx-canvas" class="wl-chart-canvas"></canvas>' +
          '</div>' +
          '</div>';

        detailEl.innerHTML = html;

        /* Paint the index history chart if we have data */
        if (hist.length >= 2) {
          var canvas  = detailEl.querySelector('#wl-idx-canvas');
          var chartBox= detailEl.querySelector('#wl-idx-chartbox');
          var att2=0;
          (function tryPaint(){
            if (!chartBox.offsetWidth && att2++<14){ setTimeout(tryPaint,50); return; }
            requestAnimationFrame(function(){
              requestAnimationFrame(function(){
                paintIndexChart(canvas, hist);
              });
            });
          })();
        } else if (!hist.length) {
          /* No history array but we got some data — show the stats only */
          var canvas = detailEl.querySelector('#wl-idx-canvas');
          if (canvas) canvas.style.display='none';
        }
      }

      var cached = cacheGet(hKey, 86400000);
      if (cached) { renderIndex(cached); return; }
      var url = '/.netlify/functions/whisky-data?type=index_history' +
        (regionKey ? '&region='+encodeURIComponent(regionKey) : '') + '&currency=GBP';
      fetch(url).then(function(r){ return r.json(); })
        .then(function(d){ cacheSet(hKey, d); renderIndex(d); })
        .catch(function(){
          detailEl.innerHTML = '<div style="padding:16px;font-size:9px;color:#fff;opacity:.4;">ERROR LOADING INDEX</div>';
        });
    }

    function paintIndexChart(canvas, hist) {
      /* hist: array of {date/month, value/index_value/points, ...} */
      var dpr = window.devicePixelRatio||1;
      var box = canvas.parentElement;
      var cssW = (box?box.clientWidth:0)||460;
      var cssH = (box?box.clientHeight:0)||220;
      canvas.width  = Math.round(cssW*dpr); canvas.height = Math.round(cssH*dpr);
      canvas.style.width=cssW+'px'; canvas.style.height=cssH+'px';
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      var W=cssW, H=cssH, P={t:20,r:14,b:26,l:52};
      var cw=W-P.l-P.r, ch=H-P.t-P.b, base=P.t+ch;

      /* Parse */
      var pts=[];
      hist.forEach(function(p){
        var d = p.date||p.month||p.period||p.price_date||'';
        var v = p.index_value||p.value||p.index||p.points||p.price;
        if (!d||!v) return;
        var t=new Date(d).getTime();
        if (!isNaN(t) && v>0) pts.push({t:t,v:v});
      });
      pts.sort(function(a,b){return a.t-b.t;});
      if (pts.length<2){canvas.style.display='none';return;}

      var tMin=pts[0].t, tMax=pts[pts.length-1].t, tRng=tMax-tMin||1;
      var vals=pts.map(function(p){return p.v;});
      var vMin=Math.min.apply(null,vals)*0.93, vMax=Math.max.apply(null,vals)*1.07, vRng=vMax-vMin||1;

      function xOf(t){return P.l+((t-tMin)/tRng)*cw;}
      function yOf(v){return P.t+ch-((v-vMin)/vRng)*ch;}
      function lbl(v){return v>=1000?(v/1000).toFixed(1)+'k':Math.round(v).toString();}

      ctx.fillStyle='#080808'; ctx.fillRect(0,0,W,H);

      /* Grid */
      for(var gi=0;gi<=4;gi++){
        var gv=vMin+(gi/4)*vRng, gy=yOf(gv);
        ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(P.l,gy); ctx.lineTo(W-P.r,gy); ctx.stroke();
        ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='9px monospace';
        ctx.textAlign='right'; ctx.textBaseline='middle';
        ctx.fillText(lbl(gv), P.l-5, gy);
      }

      /* Area fill */
      var ag=ctx.createLinearGradient(0,P.t,0,base);
      ag.addColorStop(0,'rgba(233,113,50,0.35)'); ag.addColorStop(1,'rgba(233,113,50,0.03)');
      ctx.beginPath(); ctx.moveTo(xOf(pts[0].t),base); ctx.lineTo(xOf(pts[0].t),yOf(pts[0].v));
      for(var i=1;i<pts.length;i++){
        var mx=(xOf(pts[i-1].t)+xOf(pts[i].t))/2;
        ctx.bezierCurveTo(mx,yOf(pts[i-1].v),mx,yOf(pts[i].v),xOf(pts[i].t),yOf(pts[i].v));
      }
      ctx.lineTo(xOf(pts[pts.length-1].t),base); ctx.closePath();
      ctx.fillStyle=ag; ctx.fill();

      /* Line */
      ctx.beginPath(); ctx.moveTo(xOf(pts[0].t),yOf(pts[0].v));
      for(var j=1;j<pts.length;j++){
        var cmx=(xOf(pts[j-1].t)+xOf(pts[j].t))/2;
        ctx.bezierCurveTo(cmx,yOf(pts[j-1].v),cmx,yOf(pts[j].v),xOf(pts[j].t),yOf(pts[j].v));
      }
      ctx.strokeStyle='#E97132'; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.stroke();

      /* Endpoint */
      var last=pts[pts.length-1];
      ctx.beginPath(); ctx.arc(xOf(last.t),yOf(last.v),4,0,Math.PI*2);
      ctx.fillStyle='#E97132'; ctx.fill();
      ctx.strokeStyle='#080808'; ctx.lineWidth=1.5; ctx.stroke();

      /* Year labels */
      var sy=new Date(tMin).getFullYear(), ey=new Date(tMax).getFullYear();
      var step=(ey-sy)>8?2:1;
      ctx.font='8px monospace'; ctx.fillStyle='rgba(255,255,255,0.4)';
      ctx.textAlign='center'; ctx.textBaseline='top';
      for(var yr=sy;yr<=ey;yr+=step){
        var xt=new Date(yr,0,1).getTime();
        if(xt>=tMin&&xt<=tMax) ctx.fillText(String(yr),xOf(xt),base+3);
      }

      /* Current value label */
      var lv=lbl(last.v);
      ctx.font='9px monospace'; ctx.fillStyle='#E97132';
      ctx.textAlign='right'; ctx.textBaseline='bottom';
      ctx.fillText(lv, W-P.r, yOf(last.v)-3);
    }
  }

  /* ── CASK CALCULATOR ─────────────────────────────────────── */
  function renderCaskCalc(id, body) {
    var CURRENT_YEAR = 2026;
    var MILESTONES = [10, 12, 15, 18, 21, 25, 30, 35, 40];
    var CURRENCIES = {
      GBP:{sym:'£',   rate:1.0},
      USD:{sym:'$',   rate:1.27},
      EUR:{sym:'€',   rate:1.18},
      HKD:{sym:'HK$', rate:9.90},
      SGD:{sym:'S$',  rate:1.70},
      AED:{sym:'AED ',rate:4.67}
    };

    function angelRate(age) {
      if (age < 5)  return 0.02;
      if (age < 15) return 0.015;
      if (age < 25) return 0.01;
      return 0.005;
    }
    function calcRLA(rla, fromAge, years) {
      for (var y = 0; y < years; y++) rla *= (1 - angelRate(fromAge + y));
      return rla;
    }
    function calcABV(abv, years) { return Math.max(40, abv - years * 0.1); }
    function calcBtls(rla, tAbv) { return Math.floor(rla * 1000 / (700 * tAbv / 100)); }
    function calcCAGR(finalVal, initVal, years) {
      if (years <= 0 || initVal <= 0 || finalVal <= 0) return null;
      return (Math.pow(finalVal / initVal, 1 / years) - 1) * 100;
    }
    function fM(n, curKey) {
      var c = CURRENCIES[curKey] || CURRENCIES.GBP;
      var v = n * c.rate;
      if (Math.abs(v) >= 1000000) return c.sym + (v/1000000).toFixed(2) + 'm';
      return c.sym + Math.round(v).toLocaleString('en-GB');
    }
    function fPct(n) { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
    function fNum(n) { return Math.round(n).toLocaleString('en-GB'); }

    function ccInp(iid, ph, val, num) {
      return '<input class="cc-inp"' + (num ? ' type="number" step="any"' : ' type="text"') +
             ' id="' + iid + '" placeholder="' + ph + '"' +
             (val !== undefined && val !== '' ? ' value="' + val + '"' : '') + '>';
    }
    function ccField(lab, inputHtml) {
      return '<div class="cc-field"><span class="cc-lbl">' + lab + '</span>' + inputHtml + '</div>';
    }
    function makePriceField(fieldId, label) {
      var div = document.createElement('div');
      div.className = 'cc-field';
      div.innerHTML =
        '<span class="cc-lbl">' + label + '</span>' +
        '<div class="cc-price-row">' +
          '<input class="cc-inp cc-price-inp" type="number" step="any" id="' + fieldId + '" placeholder="0.00">' +
          '<button class="cc-lookup-btn" data-field="' + fieldId + '" title="Search WhiskyStats">▌</button>' +
        '</div>' +
        '<div class="cc-lookup-results" id="lkp-' + fieldId + '" style="display:none;"></div>';
      return div;
    }

    body.innerHTML =
      '<div class="cc-wrap">' +
        '<div class="cc-sec-hdr">CASK DETAILS</div>' +
        '<div class="cc-grid-3">' +
          ccField('DISTILLERY', ccInp('cc-distillery', 'e.g. Glenfarclas', '')) +
          ccField('CASK TYPE', '<select class="cc-inp" id="cc-cask-type">' +
            '<option>Hogshead (~250L)</option>' +
            '<option>Sherry Butt (~500L)</option>' +
            '<option>Barrel (~200L)</option>' +
            '<option>Puncheon (~500L)</option>' +
            '<option>Quarter Cask (~50L)</option>' +
          '</select>') +
          ccField('YEAR DISTILLED', ccInp('cc-year', '2020', '', true)) +
          ccField('YEAR PURCHASED', ccInp('cc-yr-purchased', CURRENT_YEAR, CURRENT_YEAR, true)) +
          ccField('CASK REFERENCE', ccInp('cc-ref', 'e.g. HH/2020/001', '')) +
          ccField('CLIENT NAME', ccInp('cc-client', 'Optional', '')) +
          ccField('CURRENT RLA (LPA)', ccInp('cc-rla', '0.0', '', true)) +
          ccField('CURRENT ABV (%)', ccInp('cc-abv', '63.5', '', true)) +
          ccField('PURCHASE PRICE (£)', ccInp('cc-purchase', '0', '', true)) +
        '</div>' +

        '<div class="cc-sec-hdr">BOTTLING ASSUMPTIONS</div>' +
        '<div class="cc-grid-4">' +
          ccField('TARGET ABV (%)', ccInp('cc-target-abv', '46', 46, true)) +
          ccField('OWN-MAKE DISC (%)', ccInp('cc-discount', '40', 40, true)) +
          ccField('STORAGE / YR (£)', ccInp('cc-storage', '150', 150, true)) +
          ccField('BOTTLING / BTL (£)', ccInp('cc-bottling', '10', 10, true)) +
          ccField('REGAUGING (£)', ccInp('cc-regauge-cost', '75', 75, true)) +
          ccField('REGAUGE EVERY (YRS)', ccInp('cc-regauge-every', '5', 5, true)) +
          ccField('MIN BOTTLE RUN', ccInp('cc-min-bottles', '120', 120, true)) +
          ccField('DISPLAY CURRENCY', '<select class="cc-inp" id="cc-currency">' +
            '<option value="GBP">GBP — £</option>' +
            '<option value="USD">USD — $</option>' +
            '<option value="EUR">EUR — €</option>' +
            '<option value="HKD">HKD — HK$</option>' +
            '<option value="SGD">SGD — S$</option>' +
            '<option value="AED">AED</option>' +
          '</select>') +
        '</div>' +

        '<div class="cc-sec-hdr">SPIRIT DUTY</div>' +
        '<div class="cc-duty-row">' +
          '<label class="cc-radio-lbl"><input type="radio" name="cc-duty-' + id + '" value="bond" id="cc-duty-bond" checked> IN-BOND SALE <span class="cc-radio-sub">(buyer pays duty)</span></label>' +
          '<label class="cc-radio-lbl"><input type="radio" name="cc-duty-' + id + '" value="retail" id="cc-duty-retail"> RETAIL BOTTLING <span class="cc-radio-sub">(duty paid by you)</span></label>' +
          '<div class="cc-duty-rate-wrap" id="cc-duty-rate-wrap" style="display:none;">' +
            '<span class="cc-lbl">DUTY RATE (£/LPA)</span>' +
            ccInp('cc-duty-rate', '31.64', 31.64, true) +
          '</div>' +
        '</div>' +

        '<div class="cc-sec-hdr">COMPARABLE PRICES <span class="cc-hint-lbl">— from WhiskyStats · click ▌ to search</span></div>' +
        '<div id="cc-price-fields" class="cc-grid-3"></div>' +

        '<button class="cc-calc-btn" id="cc-calc-btn">▌ CALCULATE CASK VALUE</button>' +
        '<div id="cc-results"></div>' +
      '</div>';

    /* duty toggle */
    body.querySelector('#cc-duty-retail').addEventListener('change', function() {
      body.querySelector('#cc-duty-rate-wrap').style.display = 'flex';
    });
    body.querySelector('#cc-duty-bond').addEventListener('change', function() {
      body.querySelector('#cc-duty-rate-wrap').style.display = 'none';
    });

    var yearInp = body.querySelector('#cc-year');

    function refreshMilestoneFields() {
      var yr  = parseInt(yearInp.value) || 0;
      var age = (yr > 1900 && yr <= CURRENT_YEAR) ? (CURRENT_YEAR - yr) : -1;
      var container = body.querySelector('#cc-price-fields');
      container.innerHTML = '';
      var nowLbl = age >= 0 ? 'NOW · ' + age + 'YO (£/BTL)' : 'CURRENT AGE (£/BTL)';
      container.appendChild(makePriceField('cc-price-now', nowLbl));
      if (age >= 0 && age < 50) {
        MILESTONES.filter(function(m) { return m > age && m <= 50; }).forEach(function(m) {
          container.appendChild(makePriceField('cc-price-' + m, m + 'YO (£/BTL)'));
        });
      }
    }

    yearInp.addEventListener('input', refreshMilestoneFields);
    refreshMilestoneFields();

    /* WhiskyStats inline price lookup */
    body.addEventListener('click', function(e) {
      var btn = e.target.closest('.cc-lookup-btn');
      if (!btn) return;
      var distillery = body.querySelector('#cc-distillery').value.trim();
      var fieldId    = btn.dataset.field;
      var ageHint    = fieldId === 'cc-price-now' ? '' : fieldId.replace('cc-price-', '') + 'yo';
      var resDiv     = body.querySelector('#lkp-' + fieldId);
      if (!distillery) {
        resDiv.style.display = 'block';
        resDiv.innerHTML = '<div class="cc-lkp-msg">Enter a distillery name first.</div>';
        return;
      }
      var q = distillery + (ageHint ? ' ' + ageHint : '');
      resDiv.style.display = 'block';
      resDiv.innerHTML = '<div class="cc-lkp-msg">Searching WhiskyStats…</div>';
      fetch('/.netlify/functions/whisky-data?type=search&query=' + encodeURIComponent(q) + '&currency=GBP')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var items = (data.results || data.data || []).slice(0, 6);
          if (!items.length) { resDiv.innerHTML = '<div class="cc-lkp-msg">No results — try a broader search.</div>'; return; }
          resDiv.innerHTML = items.map(function(item) {
            var price = item.avg_auction_price || item.retail_avg || item.latest_price || 0;
            var name  = escH(item.title || item.name || '');
            return '<div class="cc-lkp-item" data-price="' + price + '" data-field="' + fieldId + '">' +
              '<span class="cc-lkp-name">' + name + '</span>' +
              '<span class="cc-lkp-price">' + (price ? '£' + Math.round(price) : 'n/a') + '</span>' +
            '</div>';
          }).join('');
        })
        .catch(function() { resDiv.innerHTML = '<div class="cc-lkp-msg">Search failed.</div>'; });
    });

    /* fill price field from lookup result */
    body.addEventListener('click', function(e) {
      var item = e.target.closest('.cc-lkp-item');
      if (!item) return;
      var price = parseFloat(item.dataset.price) || 0;
      var fieldId = item.dataset.field;
      if (price > 0) {
        var inp = body.querySelector('#' + fieldId);
        if (inp) inp.value = price.toFixed(2);
      }
      var resDiv = body.querySelector('#lkp-' + fieldId);
      if (resDiv) resDiv.style.display = 'none';
    });

    /* close lookup dropdowns when clicking elsewhere */
    body.addEventListener('click', function(e) {
      if (!e.target.closest('.cc-lookup-btn') && !e.target.closest('.cc-lkp-item')) {
        body.querySelectorAll('.cc-lookup-results').forEach(function(d) { d.style.display = 'none'; });
      }
    });

    body.querySelector('#cc-calc-btn').addEventListener('click', function() {
      var distillery   = body.querySelector('#cc-distillery').value.trim() || 'CASK';
      var caskType     = body.querySelector('#cc-cask-type').value;
      var yr           = parseInt(yearInp.value) || 0;
      var yrPurchased  = parseInt(body.querySelector('#cc-yr-purchased').value) || CURRENT_YEAR;
      var caskRef      = body.querySelector('#cc-ref').value.trim();
      var clientName   = body.querySelector('#cc-client').value.trim();
      var rla          = parseFloat(body.querySelector('#cc-rla').value) || 0;
      var abv          = parseFloat(body.querySelector('#cc-abv').value) || 0;
      var purchase     = parseFloat(body.querySelector('#cc-purchase').value) || 0;
      var tAbv         = Math.max(40, parseFloat(body.querySelector('#cc-target-abv').value) || 46);
      var disc         = Math.min(100, Math.max(0, parseFloat(body.querySelector('#cc-discount').value) || 40));
      var storage      = parseFloat(body.querySelector('#cc-storage').value) || 0;
      var bottlingFee  = parseFloat(body.querySelector('#cc-bottling').value) || 0;
      var regaugeCost  = parseFloat(body.querySelector('#cc-regauge-cost').value) || 0;
      var regaugeEvery = parseInt(body.querySelector('#cc-regauge-every').value) || 5;
      var minBtls      = parseInt(body.querySelector('#cc-min-bottles').value) || 120;
      var curKey       = body.querySelector('#cc-currency').value || 'GBP';
      var retailDuty   = body.querySelector('#cc-duty-retail').checked;
      var dutyRate     = retailDuty ? (parseFloat(body.querySelector('#cc-duty-rate').value) || 31.64) : 0;
      var priceNow     = parseFloat(body.querySelector('#cc-price-now').value) || 0;
      var resultsEl    = body.querySelector('#cc-results');
      var fC = function(n) { return fM(n, curKey); };

      if (!yr || yr < 1900 || yr > CURRENT_YEAR) {
        resultsEl.innerHTML = '<div class="cc-error">Enter a valid distillation year.</div>'; return;
      }
      if (rla <= 0) {
        resultsEl.innerHTML = '<div class="cc-error">Enter the current RLA (litres of pure alcohol).</div>'; return;
      }
      if (abv < 40 || abv > 99) {
        resultsEl.innerHTML = '<div class="cc-error">Enter a valid current ABV (40–99%).</div>'; return;
      }
      if (purchase <= 0) {
        resultsEl.innerHTML = '<div class="cc-error">Enter the purchase price paid.</div>'; return;
      }

      var curAge     = CURRENT_YEAR - yr;
      var ownMult    = 1 - disc / 100;
      var yrsHeldNow = Math.max(0, CURRENT_YEAR - yrPurchased);

      function calcRegauging(yrs) {
        return regaugeEvery > 0 ? Math.floor(yrs / regaugeEvery) * regaugeCost : 0;
      }

      /* --- sell now --- */
      var nowBtls     = calcBtls(rla, tAbv);
      var nowDuty     = retailDuty ? rla * dutyRate : 0;
      var nowGross    = priceNow > 0 ? nowBtls * priceNow * ownMult : 0;
      var nowBotCost  = nowBtls * bottlingFee;
      var nowNet      = nowGross - nowBotCost - nowDuty;
      var nowGrossROI = purchase > 0 ? (nowGross - purchase) / purchase * 100 : 0;
      var nowNetROI   = purchase > 0 ? (nowNet   - purchase) / purchase * 100 : 0;
      var nowCAGRNet  = calcCAGR(nowNet, purchase, yrsHeldNow);
      var nowBelowMin = nowBtls < minBtls;

      /* --- future projections --- */
      var futureMiles = MILESTONES.filter(function(m) { return m > curAge && m <= 50; });
      var rows = [], chartRows = [], breakEvenAge = null;

      futureMiles.forEach(function(tAge) {
        var yrs       = tAge - curAge;
        var priceEl   = body.querySelector('#cc-price-' + tAge);
        var refPrice  = priceEl ? (parseFloat(priceEl.value) || 0) : 0;
        var pRLA      = calcRLA(rla, curAge, yrs);
        var pABV      = calcABV(abv, yrs);
        var btls      = calcBtls(pRLA, tAbv);
        var storeCost = yrs * storage;
        var rgCost    = calcRegauging(yrs);
        var botCost   = btls * bottlingFee;
        var dutyAmt   = retailDuty ? pRLA * dutyRate : 0;
        var totalHeld = Math.max(0, (yr + tAge) - yrPurchased);

        if (refPrice > 0) {
          var gross = btls * refPrice * ownMult;
          var net   = gross - storeCost - rgCost - botCost - dutyAmt;
          var gROI  = purchase > 0 ? (gross - purchase) / purchase * 100 : 0;
          var nROI  = purchase > 0 ? (net   - purchase) / purchase * 100 : 0;
          var cGross= calcCAGR(gross, purchase, totalHeld);
          var cNet  = calcCAGR(net,   purchase, totalHeld);
          if (breakEvenAge === null && net >= purchase) breakEvenAge = tAge;
          rows.push({ age:tAge, yrs:yrs, pRLA:pRLA, pABV:pABV, abvWarn:(pABV<=40.5),
            btls:btls, btlWarn:(btls<minBtls), gross:gross, storeCost:storeCost,
            rgCost:rgCost, botCost:botCost, dutyAmt:dutyAmt,
            net:net, gROI:gROI, nROI:nROI, cGross:cGross, cNet:cNet, hasPrice:true });
          chartRows.push({ age:tAge, gross:gross, net:net });
        } else {
          rows.push({ age:tAge, yrs:yrs, pRLA:pRLA, pABV:pABV, abvWarn:(pABV<=40.5),
            btls:btls, btlWarn:(btls<minBtls), hasPrice:false });
        }
      });

      /* --- render --- */
      var html = '<div class="cc-results-inner">';

      /* header */
      html += '<div class="cc-res-hdr">' +
        escH(distillery).toUpperCase() + ' · ' + curAge + 'YO · ' + escH(caskType) +
        (caskRef    ? ' &nbsp;<span class="cc-dim2">REF ' + escH(caskRef) + '</span>' : '') +
        (clientName ? ' &nbsp;<span class="cc-dim2">CLIENT ' + escH(clientName) + '</span>' : '') +
      '</div>';

      /* sell-now card */
      if (priceNow > 0) {
        html += '<div class="cc-now-card">' +
          '<div class="cc-now-title">▌ SELL NOW — ' + curAge + 'YO' +
            (nowBelowMin ? ' &nbsp;<span class="cc-warn">⚠ BELOW MIN RUN (' + minBtls + ' BOTTLES)</span>' : '') +
          '</div>' +
          '<div class="cc-now-grid">' +
            '<div class="cc-now-stat"><div class="cc-now-val">' + fNum(nowBtls) + '</div><div class="cc-now-sub">BOTTLES AT ' + tAbv + '%</div></div>' +
            '<div class="cc-now-stat"><div class="cc-now-val">' + fC(nowGross) + '</div><div class="cc-now-sub">GROSS REVENUE</div></div>' +
            (retailDuty ? '<div class="cc-now-stat cc-neg-bg"><div class="cc-now-val">(' + fC(nowDuty) + ')</div><div class="cc-now-sub">SPIRIT DUTY</div></div>' : '') +
            '<div class="cc-now-stat"><div class="cc-now-val">' + fC(nowNet) + '</div><div class="cc-now-sub">NET VALUE</div></div>' +
            '<div class="cc-now-stat ' + (nowGrossROI >= 0 ? 'cc-pos-bg' : 'cc-neg-bg') + '"><div class="cc-now-val">' + fPct(nowGrossROI) + '</div><div class="cc-now-sub">GROSS ROI</div></div>' +
            '<div class="cc-now-stat ' + (nowNetROI >= 0 ? 'cc-pos-bg' : 'cc-neg-bg') + '"><div class="cc-now-val">' + fPct(nowNetROI) + '</div><div class="cc-now-sub">NET ROI</div></div>' +
            (nowCAGRNet !== null ? '<div class="cc-now-stat"><div class="cc-now-val">' + fPct(nowCAGRNet) + '/yr</div><div class="cc-now-sub">NET CAGR</div></div>' : '') +
          '</div>' +
        '</div>';
      } else {
        html += '<div class="cc-hint-box">Enter the current age comparable price to see the sell-now value.</div>';
      }

      /* break-even */
      var priceRows = rows.filter(function(r) { return r.hasPrice; });
      var noPrRows  = rows.filter(function(r) { return !r.hasPrice; });
      if (priceRows.length) {
        if (breakEvenAge !== null) {
          html += '<div class="cc-breakeven">▌ BREAK-EVEN: Net value covers purchase price at <strong>' + breakEvenAge + 'YO</strong> · ' + (yr + breakEvenAge) + '</div>';
        } else {
          html += '<div class="cc-breakeven cc-breakeven--none">▌ BREAK-EVEN: Not reached within the milestones entered</div>';
        }
      }

      /* projection table */
      if (priceRows.length) {
        var dutyMode = retailDuty ? 'RETAIL — DUTY PAID @ £' + dutyRate.toFixed(2) + '/LPA' : 'IN-BOND SALE';
        html += '<div class="cc-proj-title">▌ FUTURE PROJECTIONS <span class="cc-proj-sub">· ' + dutyMode + '</span></div>';
        html += '<div class="cc-tbl-wrap"><table class="cc-tbl"><thead><tr>' +
          '<th>AGE</th><th>HOLD</th><th>RLA</th><th>BOTTLES</th><th>ABV</th>' +
          '<th>GROSS REV</th>' + (retailDuty ? '<th>DUTY</th>' : '') +
          '<th>STORAGE</th><th>REGAUGE</th><th>BOTTLING</th>' +
          '<th>NET VALUE</th><th>CAGR</th><th>GROSS ROI</th><th>NET ROI</th>' +
        '</tr></thead><tbody>';
        priceRows.forEach(function(r) {
          var abvW = r.abvWarn ? ' <span class="cc-warn" title="ABV approaching 40% Scotch legal minimum">⚠</span>' : '';
          var btlW = r.btlWarn ? ' <span class="cc-warn" title="Below minimum bottling run of ' + minBtls + ' bottles">⚠</span>' : '';
          var cagrTxt = r.cNet !== null ? fPct(r.cNet) + '/yr' : '—';
          html += '<tr' + (r.btlWarn ? ' class="cc-row-warn"' : '') + '>' +
            '<td><strong>' + r.age + 'YO</strong></td>' +
            '<td class="cc-dim">' + r.yrs + 'yr</td>' +
            '<td class="cc-dim">' + r.pRLA.toFixed(1) + '</td>' +
            '<td>' + fNum(r.btls) + btlW + '</td>' +
            '<td class="cc-dim">' + r.pABV.toFixed(1) + '%' + abvW + '</td>' +
            '<td>' + fC(r.gross) + '</td>' +
            (retailDuty ? '<td class="cc-neg">(' + fC(r.dutyAmt) + ')</td>' : '') +
            '<td class="cc-dim">' + fC(r.storeCost) + '</td>' +
            '<td class="cc-dim">' + (r.rgCost > 0 ? fC(r.rgCost) : '—') + '</td>' +
            '<td class="cc-dim">' + fC(r.botCost) + '</td>' +
            '<td><strong>' + fC(r.net) + '</strong></td>' +
            '<td class="' + (r.cNet !== null && r.cNet >= 0 ? 'cc-pos' : 'cc-neg') + '">' + cagrTxt + '</td>' +
            '<td class="' + (r.gROI >= 0 ? 'cc-pos' : 'cc-neg') + '">' + fPct(r.gROI) + '</td>' +
            '<td class="' + (r.nROI >= 0 ? 'cc-pos' : 'cc-neg') + '"><strong>' + fPct(r.nROI) + '</strong></td>' +
          '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<canvas id="cc-chart-' + id + '" class="cc-chart"></canvas>';
      }

      if (noPrRows.length) {
        var missing = noPrRows.map(function(r) { return r.age + 'YO'; }).join(', ');
        html += '<div class="cc-hint-box">Enter comparable prices for ' + missing + ' to see those projections.</div>';
      }

      html += '</div>';
      resultsEl.innerHTML = html;

      if (priceRows.length) {
        var canvas = body.querySelector('#cc-chart-' + id);
        if (canvas) drawCaskChart(canvas, purchase, chartRows, curKey);
      }
    });
  }

  function drawCaskChart(canvas, purchase, rows, curKey) {
    var DPR = window.devicePixelRatio || 1;
    var W   = canvas.offsetWidth || 660;
    var H   = 160;
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    var CURRENCIES = {GBP:{sym:'£',rate:1},USD:{sym:'$',rate:1.27},EUR:{sym:'€',rate:1.18},HKD:{sym:'HK$',rate:9.90},SGD:{sym:'S$',rate:1.70},AED:{sym:'AED ',rate:4.67}};
    var c   = CURRENCIES[curKey] || CURRENCIES.GBP;
    var vals = [purchase * c.rate];
    rows.forEach(function(r) { vals.push(r.gross * c.rate, r.net * c.rate); });
    var maxV = Math.max.apply(null, vals);
    var minV = Math.min(0, Math.min.apply(null, vals));
    var span = maxV - minV || 1;

    var P = {t:20, r:90, b:28, l:66};
    var cw = W - P.l - P.r, ch = H - P.t - P.b;
    var n  = rows.length;

    function xOf(i) { return P.l + (n > 1 ? i / (n - 1) * cw : cw / 2); }
    function yOf(v) { return P.t + ch - (v - minV) / span * ch; }

    ctx.clearRect(0, 0, W, H);

    /* grid */
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    [0, 0.33, 0.66, 1].forEach(function(f) {
      var y = P.t + ch * (1 - f);
      ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(W - P.r, y); ctx.stroke();
    });

    /* purchase cost baseline */
    var py = yOf(purchase * c.rate);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(P.l, py); ctx.lineTo(W - P.r, py); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace'; ctx.textAlign = 'right';
    ctx.fillText('COST', P.l - 4, py + 4);

    function drawLine(getV, color) {
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
      rows.forEach(function(r, i) {
        var x = xOf(i), y = yOf(getV(r) * c.rate);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      rows.forEach(function(r, i) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(xOf(i), yOf(getV(r) * c.rate), 3, 0, Math.PI * 2); ctx.fill();
      });
    }
    drawLine(function(r) { return r.gross; }, '#E97132');
    drawLine(function(r) { return r.net;   }, '#ffffff');

    /* x labels */
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '9px monospace'; ctx.textAlign = 'center';
    rows.forEach(function(r, i) { ctx.fillText(r.age + 'yr', xOf(i), H - P.b + 11); });

    /* y labels */
    ctx.textAlign = 'right';
    [0, 0.5, 1].forEach(function(f) {
      var v = minV + span * f;
      var y = P.t + ch * (1 - f);
      var lbl = Math.abs(v) >= 1000000 ? c.sym + (v/1000000).toFixed(1) + 'm' :
                Math.abs(v) >= 1000    ? c.sym + (v/1000).toFixed(0) + 'k' : c.sym + Math.round(v);
      ctx.fillText(lbl, P.l - 4, y + 4);
    });

    /* legend */
    ctx.textAlign = 'left';
    ctx.fillStyle = '#E97132';
    ctx.fillRect(W - P.r + 8, P.t, 14, 2);
    ctx.fillText('GROSS', W - P.r + 26, P.t + 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W - P.r + 8, P.t + 14, 14, 2);
    ctx.fillText('NET', W - P.r + 26, P.t + 19);
  }

  /* ── ORIGIN WEB ── three-mode macro picture with drill-down ── */
  function renderOriginWeb(id, body) {
    var OD = {
      scotland: {
        label: 'SCOTLAND', regions: ['SPEYSIDE','ISLAY','HIGHLANDS','ISLANDS','CAMPBELTOWN'],
        distilleries: [
          {name:'Macallan',       region:'Speyside',    avg:420,  yoy:22},
          {name:'Springbank',     region:'Campbeltown', avg:280,  yoy:25},
          {name:'Dalmore',        region:'Highlands',   avg:250,  yoy:18},
          {name:'Ardbeg',         region:'Islay',       avg:220,  yoy:18},
          {name:'Glendronach',    region:'Highlands',   avg:200,  yoy:20},
          {name:'Highland Park',  region:'Islands',     avg:175,  yoy:16},
          {name:'Lagavulin',      region:'Islay',       avg:180,  yoy:14},
          {name:'Glenfarclas',    region:'Speyside',    avg:180,  yoy:12},
          {name:'Talisker',       region:'Islands',     avg:155,  yoy:13},
        ],
        markets: [
          {name:'Whisky Auctioneer',   loc:'UK',   share:38, avg:285},
          {name:'Scotch Wh. Auctions', loc:'UK',   share:22, avg:210},
          {name:'Bonhams HK',          loc:'ASIA', share:18, avg:380},
          {name:'Hart Davis Hart',     loc:'USA',  share:12, avg:320},
          {name:'Langtons',            loc:'AUS',  share:6,  avg:195},
        ],
        exports: [
          {country:'USA',          pct:25, val:'£1.10bn', yoy:+8,  flag:'🇺🇸'},
          {country:'France',       pct:12, val:'£530m',   yoy:+5,  flag:'🇫🇷'},
          {country:'Singapore',    pct:8,  val:'£355m',   yoy:+14, flag:'🇸🇬'},
          {country:'Germany',      pct:6,  val:'£265m',   yoy:+4,  flag:'🇩🇪'},
          {country:'India',        pct:5,  val:'£220m',   yoy:+22, flag:'🇮🇳'},
          {country:'Taiwan',       pct:4,  val:'£175m',   yoy:+18, flag:'🇹🇼'},
          {country:'UAE',          pct:3,  val:'£130m',   yoy:+12, flag:'🇦🇪'},
          {country:'Australia',    pct:3,  val:'£130m',   yoy:+7,  flag:'🇦🇺'},
        ],
        macro: {
          exportVal:  {lbl:'TOTAL EXPORTS',        val:'£5.36bn',  sub:'2025 — SWA official'},
          cagr:       {lbl:'5-YR EXPORT CAGR',     val:'+8.2%',    sub:'2019–2025'},
          bottles:    {lbl:'BOTTLES EXPORTED',     val:'1.34bn',   sub:'2025 SWA · 70cl equivalent'},
          avgBottle:  {lbl:'AVG EXPORT VALUE',     val:'£4.00',    sub:'per 70cl bottle · FOB customs'},
          smShare:    {lbl:'SINGLE MALT SHARE',    val:'29%',      sub:'by value of total exports'},
          topGrowth:  {lbl:'TOP GROWTH MARKET',    val:'India',    sub:'+22% YoY demand'},
          distCount:  {lbl:'ACTIVE DISTILLERIES',  val:'140+',     sub:'Scotland total'},
          lpaExport:  {lbl:'VOLUME (LPA)',          val:'1.58bn',   sub:'litres pure alcohol'},
          premiumShare:{lbl:'PREMIUM SEGMENT',     val:'£2.1bn',   sub:'15yr+ & single cask'},
          ukTariff:   {lbl:'US TARIFF STATUS',      val:'ZERO',     sub:'Zero-for-zero deal — 24 Jul 2026'},
        },
      },
      japan: {
        label: 'JAPAN', regions: ['SUNTORY','NIKKA','CRAFT','INDEPENDENT','NEW WAVE'],
        distilleries: [
          {name:'Chichibu',    region:'Saitama',   avg:890, yoy:45},
          {name:'Yamazaki',    region:'Osaka',     avg:650, yoy:35},
          {name:'Hakushu',     region:'Yamanashi', avg:480, yoy:28},
          {name:'Akkeshi',     region:'Hokkaido',  avg:340, yoy:38},
          {name:'Hibiki',      region:'Osaka',     avg:390, yoy:30},
          {name:'Nikka Yoichi',region:'Hokkaido',  avg:320, yoy:22},
          {name:'Miyagikyo',   region:'Miyagi',    avg:280, yoy:18},
          {name:'Fuji',        region:'Shizuoka',  avg:210, yoy:20},
        ],
        markets: [
          {name:'Bonhams HK',        loc:'ASIA', share:42, avg:580},
          {name:'Whisky Auctioneer', loc:'UK',   share:24, avg:490},
          {name:'Acker Merrall',     loc:'USA',  share:18, avg:620},
          {name:'Hart Davis Hart',   loc:'USA',  share:10, avg:540},
          {name:'Langtons',          loc:'AUS',  share:6,  avg:410},
        ],
        exports: [
          {country:'USA',          pct:35, val:'£180m',  yoy:+35, flag:'🇺🇸'},
          {country:'France',       pct:18, val:'£93m',   yoy:+22, flag:'🇫🇷'},
          {country:'Singapore',    pct:14, val:'£72m',   yoy:+28, flag:'🇸🇬'},
          {country:'Germany',      pct:10, val:'£51m',   yoy:+18, flag:'🇩🇪'},
          {country:'Australia',    pct:9,  val:'£46m',   yoy:+15, flag:'🇦🇺'},
          {country:'UK',           pct:8,  val:'£41m',   yoy:+20, flag:'🇬🇧'},
          {country:'China',        pct:6,  val:'£31m',   yoy:+40, flag:'🇨🇳'},
        ],
        macro: {
          exportVal:  {lbl:'TOTAL EXPORTS',        val:'£228m',    sub:'MoF customs 2024 · ¥43.7bn'},
          cagr:       {lbl:'10-YR EXPORT CAGR',    val:'+28%',     sub:'fastest growing origin'},
          bottles:    {lbl:'BOTTLES EXPORTED',     val:'~18m',     sub:'2024 · all grades · 70cl equiv'},
          avgBottle:  {lbl:'AVG EXPORT VALUE',     val:'£12.70',   sub:'per 70cl bottle · FOB customs'},
          smShare:    {lbl:'SUNTORY SHARE',         val:'60%',      sub:'of total Japanese export'},
          topGrowth:  {lbl:'TOP GROWTH MARKET',    val:'China',    sub:'+40% YoY demand'},
          distCount:  {lbl:'ACTIVE DISTILLERIES',  val:'120+',     sub:'incl. craft boom since 2015'},
          lpaExport:  {lbl:'SUPPLY CONSTRAINT',    val:'CRITICAL', sub:'aging stock 3-5yr shortage'},
          premiumShare:{lbl:'RARE/LIMITED SHARE',  val:'£91m',     sub:'~40% · Chichibu, Yamazaki'},
          ukTariff:   {lbl:'PRICE TREND',          val:'STEEP UP', sub:'shortage driving premiums'},
        },
      },
      usa: {
        label: 'USA', regions: ['BOURBON','RYE','TENNESSEE','WHEAT','SINGLE BARREL'],
        distilleries: [
          {name:'Pappy Van Winkle', region:'Kentucky', avg:1200, yoy:28},
          {name:'Wm. Larue Weller', region:'Kentucky', avg:580,  yoy:32},
          {name:'Thomas H. Handy',  region:'Kentucky', avg:520,  yoy:30},
          {name:'George T. Stagg',  region:'Kentucky', avg:490,  yoy:25},
          {name:'Eagle Rare 17yr',  region:'Kentucky', avg:380,  yoy:28},
          {name:'Blantons Gold',    region:'Kentucky', avg:210,  yoy:38},
          {name:'Four Roses Ltd',   region:'Kentucky', avg:220,  yoy:20},
          {name:'Woodford Reserve', region:'Kentucky', avg:140,  yoy:15},
        ],
        markets: [
          {name:'Skinner Auctions',  loc:'USA',  share:35, avg:420},
          {name:'Hart Davis Hart',   loc:'USA',  share:28, avg:480},
          {name:'Whisky Auctioneer', loc:'UK',   share:18, avg:390},
          {name:'Acker Merrall',     loc:'USA',  share:12, avg:510},
          {name:'Bonhams HK',        loc:'ASIA', share:7,  avg:460},
        ],
        exports: [
          {country:'EU',           pct:27, val:'£340m',  yoy:+18, flag:'🇪🇺'},
          {country:'UK',           pct:18, val:'£226m',  yoy:+12, flag:'🇬🇧'},
          {country:'Australia',    pct:10, val:'£125m',  yoy:+9,  flag:'🇦🇺'},
          {country:'Canada',       pct:8,  val:'£100m',  yoy:+6,  flag:'🇨🇦'},
          {country:'Japan',        pct:7,  val:'£88m',   yoy:+15, flag:'🇯🇵'},
          {country:'Singapore',    pct:5,  val:'£63m',   yoy:+20, flag:'🇸🇬'},
          {country:'UAE',          pct:4,  val:'£50m',   yoy:+22, flag:'🇦🇪'},
        ],
        macro: {
          exportVal:  {lbl:'TOTAL EXPORTS',        val:'£1.03bn',  sub:'DISCUS official 2024'},
          cagr:       {lbl:'5-YR EXPORT CAGR',     val:'+12%',     sub:'2019–2024'},
          bottles:    {lbl:'BOTTLES EXPORTED',     val:'~130m',    sub:'all grades · 70cl equiv'},
          avgBottle:  {lbl:'AVG EXPORT VALUE',     val:'£7.90',    sub:'per 70cl bottle · FOB customs'},
          smShare:    {lbl:'TN EXPORT LEAD',        val:'~55%',     sub:'Tennessee leads by export value'},
          topGrowth:  {lbl:'TOP GROWTH MARKET',    val:'UAE',      sub:'+22% YoY demand'},
          distCount:  {lbl:'ACTIVE DISTILLERIES',  val:'2,000+',   sub:'USA total craft + major'},
          lpaExport:  {lbl:'TARIFF RISK',          val:'MEDIUM',   sub:'EU retaliation watch'},
          premiumShare:{lbl:'BUFFALO TRACE BTAC',  val:'~£400m',   sub:'annual secondary mkt est.'},
          ukTariff:   {lbl:'EU TARIFF STATUS',     val:'PAUSED',   sub:'retaliatory tariffs suspended'},
        },
      },
      ireland: {
        label: 'IRELAND', regions: ['SINGLE POT STILL','SINGLE MALT','BLENDED','GRAIN','PEATED'],
        distilleries: [
          {name:'Midleton V. Rare', region:'Cork',      avg:280, yoy:20},
          {name:'Redbreast 21',     region:'Cork',      avg:180, yoy:15},
          {name:'Teeling Brabazon', region:'Dublin',    avg:150, yoy:22},
          {name:'Dingle Single',    region:'Kerry',     avg:130, yoy:18},
          {name:'Waterford',        region:'Waterford', avg:120, yoy:25},
          {name:'Powers Johns Ln',  region:'Cork',      avg:110, yoy:12},
          {name:'Green Spot',       region:'Cork',      avg:90,  yoy:10},
        ],
        markets: [
          {name:'Whisky Auctioneer', loc:'UK',  share:40, avg:160},
          {name:'Catawiki',          loc:'EU',  share:25, avg:145},
          {name:'Bonhams',           loc:'UK',  share:18, avg:190},
          {name:'Hart Davis Hart',   loc:'USA', share:12, avg:175},
          {name:'Langtons',          loc:'AUS', share:5,  avg:150},
        ],
        exports: [
          {country:'USA',          pct:40, val:'£220m',  yoy:+18, flag:'🇺🇸'},
          {country:'France',       pct:12, val:'£66m',   yoy:+8,  flag:'🇫🇷'},
          {country:'UK',           pct:10, val:'£55m',   yoy:+5,  flag:'🇬🇧'},
          {country:'Germany',      pct:8,  val:'£44m',   yoy:+6,  flag:'🇩🇪'},
          {country:'Canada',       pct:6,  val:'£33m',   yoy:+10, flag:'🇨🇦'},
          {country:'Australia',    pct:5,  val:'£28m',   yoy:+12, flag:'🇦🇺'},
          {country:'Spain',        pct:5,  val:'£28m',   yoy:+7,  flag:'🇪🇸'},
        ],
        macro: {
          exportVal:  {lbl:'TOTAL EXPORTS',        val:'£550m',    sub:'Irish whiskey 2024'},
          cagr:       {lbl:'5-YR EXPORT CAGR',     val:'+15%',     sub:'fastest EU growth origin'},
          bottles:    {lbl:'BOTTLES SOLD',         val:'14m+',     sub:'global annual volume'},
          avgBottle:  {lbl:'AVG EXPORT VALUE',     val:'£39',      sub:'per 70cl bottle'},
          smShare:    {lbl:'MIDLETON GROUP SHARE',  val:'65%',      sub:'of Irish total volume'},
          topGrowth:  {lbl:'TOP GROWTH MARKET',    val:'USA',      sub:'+18% YoY — largest market'},
          distCount:  {lbl:'ACTIVE DISTILLERIES',  val:'32',       sub:'revival from 3 in 1990s'},
          lpaExport:  {lbl:'CRAFT GROWTH',         val:'STRONG',   sub:'18 new distilleries since 2015'},
          premiumShare:{lbl:'PREMIUM SEGMENT',     val:'£120m',    sub:'single pot still & vintage'},
          ukTariff:   {lbl:'POST-BREXIT TARIFF',   val:'ZERO',     sub:'Ireland–UK Windsor Framework'},
        },
      },
    };

    /* ── Per-flow drill-down data ── */
    var FLOWS = {
      scotland: {
        'USA': {
          hist:[{yr:2019,v:1069},{yr:2020,v:729},{yr:2021,v:790},{yr:2022,v:1053},{yr:2023,v:978},{yr:2024,v:971},{yr:2025,v:933}],
          proj:[{yr:2026,v:1100}],
          cagr3:'+7.1%', cagr5:'-1.9%',
          cats:[{n:'Single Malt',p:48},{n:'Blended Scotch',p:44},{n:'Blended Malt',p:5},{n:'Single Grain',p:3}],
          tariff:'ZERO as of 24 July 2026. Trump imposed 10% tariff Apr 2025 (threatened to rise to 25% on single malt), then lifted all tariffs on UK whisky following King Charles III\'s state visit. "Zero-for-zero" deal — US whisky also enters UK duty-free. First permanent resolution since 2018.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Zero-for-zero tariff deal unlocks structural demand growth','On-trade and collector market both expanding','Premiumisation shift to 12yr+','Whisky bar culture growing in US cities','High-net-worth gifting — single cask and vintage tier'],
          note:'Source: SWA annual export statistics (HMRC-based). Largest export market for Scotch by value. The 10% Trump tariff (Apr 2025–Jul 2026) cost the industry an estimated £200m before resolution. The July 2026 zero-for-zero deal is structurally bullish — exports to the US are expected to accelerate sharply into 2027. CAGRs: 3yr 2021–2024; 5yr 2019–2024.',
        },
        'France': {
          hist:[{yr:2019,v:432},{yr:2020,v:375},{yr:2021,v:387},{yr:2022,v:488},{yr:2023,v:474},{yr:2024,v:419},{yr:2025,v:404}],
          proj:[{yr:2026,v:430}],
          cagr3:'+2.7%', cagr5:'-0.6%',
          cats:[{n:'Blended Scotch',p:62},{n:'Single Malt',p:28},{n:'Single Grain',p:7},{n:'Blended Malt',p:3}],
          tariff:'No significant tariff barriers. EU–UK Trade and Cooperation Agreement provides duty-free access.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Long-established blended Scotch culture','Café & restaurant on-trade strength','Growing single malt education','Premium gifting market'],
          note:'Source: SWA annual export statistics (HMRC-based). France is the largest EU destination for Scotch by volume, driven by blended categories. Export value peaked in 2022 at £488m and has contracted since, reflecting the broader EU demand reset. Single malt growth is gradual but consistent.',
        },
        'Singapore': {
          hist:[{yr:2019,v:300},{yr:2020,v:247},{yr:2021,v:212},{yr:2022,v:316},{yr:2023,v:378},{yr:2024,v:310},{yr:2025,v:274}],
          proj:[{yr:2026,v:295}],
          cagr3:'+13.4%', cagr5:'+0.7%',
          cats:[{n:'Single Malt',p:56},{n:'Blended Scotch',p:26},{n:'Blended Malt',p:12},{n:'Single Grain',p:6}],
          tariff:'Zero tariff. Singapore operates as a free port — significant portion re-exported to Malaysia, Indonesia, Vietnam and wider ASEAN.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['APAC travel retail hub','Re-export gateway to SE Asia','Ultra-premium collector auctions (Bonhams HK corridor)','Growing HNWI wealth in region','Changi Airport duty-free — world\'s largest spirits retail'],
          note:'Source: SWA annual export statistics (HMRC-based). Singapore\'s import figures overstate direct consumption — an estimated 35–40% is re-exported across ASEAN. The 2023 peak at £378m reflected strong post-COVID destocking demand; 2024/25 contraction reflects inventory normalisation. Its role as an APAC transit and auction hub makes it a leading indicator of broader regional demand.',
        },
        'Germany': {
          hist:[{yr:2019,v:185},{yr:2020,v:139},{yr:2021,v:148},{yr:2022,v:202},{yr:2023,v:197},{yr:2024,v:169},{yr:2025,v:177}],
          proj:[{yr:2026,v:185}],
          cagr3:'+4.5%', cagr5:'-1.8%',
          cats:[{n:'Blended Scotch',p:50},{n:'Single Malt',p:38},{n:'Blended Malt',p:8},{n:'Single Grain',p:4}],
          tariff:'No tariff. EU–UK TCA duty-free access. EU market stability dependent on UK maintaining equivalence.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Largest economy in EU','Whisky festival culture (Berlin, Hamburg)','Growing specialist retail','On-trade recovery'],
          note:'Source: SWA annual export statistics (HMRC-based). Germany\'s whisky market is one of Europe\'s most developed, with a strong independent retailer network. Export value peaked in 2022 at £202m; 2024 contraction to £169m reflects macro weakness and inventory correction. The 3yr CAGR from the 2021 trough shows recovery momentum.',
        },
        'India': {
          hist:[{yr:2019,v:166},{yr:2020,v:100},{yr:2021,v:146},{yr:2022,v:282},{yr:2023,v:218},{yr:2024,v:248},{yr:2025,v:286}],
          proj:[{yr:2026,v:390}],
          cagr3:'+19.3%', cagr5:'+8.4%',
          cats:[{n:'Blended Scotch',p:75},{n:'Single Malt',p:18},{n:'Blended Malt',p:4},{n:'Single Grain',p:3}],
          tariff:'UK-India FTA entered into force 15 July 2026. Tariff cut from 150% to 75% immediately. Further reductions to 40% by January 2036 on a phased 10-year schedule. Retail impact: a ₹5,000 bottle expected to retail at ₹3,500–4,000. SWA projects £1bn additional exports over 5 years.',
          tariffStatus:'75% (DOWN FROM 150%)', tariffCol:'#E97132',
          drivers:['FTA tariff halved — price accessibility unlocks mass-affluent tier','Rapidly expanding HNWI and aspirational middle class','Aspirational gifting culture: Scotch as status signal','Spirits premiumisation already underway pre-deal','Growing urban on-trade in Mumbai, Delhi, Bengaluru'],
          note:'Source: SWA annual export statistics (HMRC-based). 2020 estimated — India was outside the SWA top 10 that year. The UK-India FTA (July 2026) is the most significant structural event for Scotch exports in a generation. India\'s tariff falling from 150% to 75% makes Scotch meaningfully more accessible to India\'s 400m+ strong middle class. The SWA forecasts £1bn in additional exports over 5 years, with further upside as the rate drops to 40% by 2036.',
        },
        'Taiwan': {
          hist:[{yr:2019,v:205},{yr:2020,v:182},{yr:2021,v:226},{yr:2022,v:315},{yr:2023,v:341},{yr:2024,v:298},{yr:2025,v:233}],
          proj:[{yr:2026,v:245}],
          cagr3:'+9.7%', cagr5:'+7.8%',
          cats:[{n:'Single Malt',p:68},{n:'Blended Malt',p:18},{n:'Blended Scotch',p:14}],
          tariff:'Low tariff environment. Taiwan has historically been one of the most open APAC markets for Scotch imports.',
          tariffStatus:'LOW', tariffCol:'#44cc64',
          drivers:['Sophisticated collector culture','Strong auction market participation','High single malt affinity','Gift culture driving premium purchases'],
          note:'Source: SWA annual export statistics (HMRC-based). Taiwan peaked at £341m in 2023 — reflecting intense post-COVID demand from its mature collector market. The 2024/25 contraction is an inventory correction after years of strong growth, not structural decline. Taiwan punches above its weight for single malt per capita consumption, with Kavalan\'s domestic success deepening the category.',
        },
        'UAE': {
          hist:[{yr:2019,v:100},{yr:2020,v:70},{yr:2021,v:95},{yr:2022,v:115},{yr:2023,v:125},{yr:2024,v:130},{yr:2025,v:141}],
          proj:[{yr:2026,v:154}],
          cagr3:'+7.0%', cagr5:'+15.0%',
          cats:[{n:'Single Malt',p:55},{n:'Blended Scotch',p:28},{n:'Blended Malt',p:12},{n:'Single Grain',p:5}],
          tariff:'5% customs duty — minimal barrier. Dubai Duty Free is one of the world\'s largest single spirits retailers.',
          tariffStatus:'5% DUTY', tariffCol:'#44cc64',
          drivers:['Dubai Duty Free travel retail dominance','HNWI population growth in Gulf','Ultra-premium gifting culture','Re-export to wider Middle East & South Asia','Expo legacy & tourism infrastructure'],
          note:'The UAE operates as the travel retail and luxury goods gateway to the broader Gulf and South Asian markets. Dubai Duty Free consistently ranks among the world\'s top spirits retailers. The ultra-premium segment (£200+ bottles) is disproportionately strong relative to market size.',
        },
        'Australia': {
          hist:[{yr:2019,v:110},{yr:2020,v:90},{yr:2021,v:105},{yr:2022,v:120},{yr:2023,v:127},{yr:2024,v:130},{yr:2025,v:136}],
          proj:[{yr:2026,v:146}],
          cagr3:'+4.3%', cagr5:'+8.6%',
          cats:[{n:'Single Malt',p:48},{n:'Blended Scotch',p:38},{n:'Blended Malt',p:9},{n:'Single Grain',p:5}],
          tariff:'No tariff. Australia–UK Free Trade Agreement (2023) — Scotch tariffs already zero, confirmed and locked in.',
          tariffStatus:'ZERO FTA', tariffCol:'#44cc64',
          drivers:['Strong craft spirits culture','Growing single malt affinity','UK cultural ties driving brand familiarity','Langton\'s auction market expanding','On-trade premium spirits adoption'],
          note:'Australia is a stable, growing market with a sophisticated drinks culture. The 2023 UK–Australia FTA cements the zero-tariff position. Langton\'s, Australia\'s leading auction house, reports year-on-year growth in Scotch lots, led by Islay and Speyside expressions.',
        },
      },
      japan: {
        'USA': {
          hist:[{yr:2019,v:39},{yr:2020,v:46},{yr:2021,v:68},{yr:2022,v:65},{yr:2023,v:58},{yr:2024,v:51},{yr:2025,v:55}],
          proj:[{yr:2026,v:60}],
          cagr3:'-9.1%', cagr5:'+5.5%',
          cats:[{n:'Single Malt',p:68},{n:'Blended',p:24},{n:'Grain',p:8}],
          tariff:'No tariff. US–Japan Trade Agreement (2020) removed spirits duties.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Japanese whisky scarcity premium driving collector demand','Suntory & Nikka brand investment in US market','Cocktail culture adoption of Japanese expressions','High-end restaurant & bar listings','Chichibu and craft distilleries gaining cult following'],
          note:'Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP at annual average rates. 2024 estimated; 2025 editorial. The US market grew strongly to 2021–22, then contracted as the Japanese whisky bubble moderated. Note: China is now Japan\'s largest whisky export market by value — the US is second. Supply constraints for aged expressions remain the key investment thesis.',
        },
        'France': {
          hist:[{yr:2019,v:20},{yr:2020,v:20},{yr:2021,v:30},{yr:2022,v:30},{yr:2023,v:22},{yr:2024,v:19},{yr:2025,v:21}],
          proj:[{yr:2026,v:23}],
          cagr3:'-14.1%', cagr5:'-1.0%',
          cats:[{n:'Single Malt',p:65},{n:'Blended',p:28},{n:'Grain',p:7}],
          tariff:'EU–Japan Economic Partnership Agreement (2019) — spirits duty reduced to zero.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Strong French affinity for Japanese culture and aesthetics','Whisky bars in Paris driving education','Sommelier community adopting Japanese expressions','Ultra-premium positioning resonates with luxury French market'],
          note:'Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP. 2024 estimated; 2025 editorial. France peaked in 2021–22 during the height of the Japanese whisky premium bubble and has contracted since. Cultural affinity between French gastronomy and Japanese craft remains strong — this is a structural market, not a speculative one.',
        },
        'Singapore': {
          hist:[{yr:2019,v:10},{yr:2020,v:13},{yr:2021,v:12},{yr:2022,v:22},{yr:2023,v:22},{yr:2024,v:19},{yr:2025,v:21}],
          proj:[{yr:2026,v:24}],
          cagr3:'+16.5%', cagr5:'+13.7%',
          cats:[{n:'Single Malt',p:72},{n:'Blended',p:20},{n:'Grain',p:8}],
          tariff:'Zero tariff. Singapore–Japan Comprehensive Economic Partnership Agreement.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['APAC re-export hub for Yamazaki, Hakushu, Hibiki','Bonhams and Christie\'s HK auction corridor','HNWI collector demand in SE Asia','Luxury retail corridor Orchard Road'],
          note:'Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP. 2024 estimated; 2025 editorial. Singapore acts as the APAC distribution and auction hub for Japanese whisky. The jump in 2022 reflects post-COVID travel retail recovery and auction house demand. The ultra-rare segment (Chichibu, limited Yamazaki) is disproportionately routed through Singapore.',
        },
        'China': {
          hist:[{yr:2019,v:18},{yr:2020,v:58},{yr:2021,v:112},{yr:2022,v:117},{yr:2023,v:72},{yr:2024,v:58},{yr:2025,v:65}],
          proj:[{yr:2026,v:72}],
          cagr3:'-19.6%', cagr5:'+26.3%',
          cats:[{n:'Blended',p:52},{n:'Single Malt',p:38},{n:'Grain',p:10}],
          tariff:'10% import duty. Subject to China–Japan diplomatic relationship — risk factor to monitor.',
          tariffStatus:'10% DUTY', tariffCol:'#E97132',
          drivers:['Expanding HNWI population in Tier 1 cities','Status gifting culture — premium spirits as currency','Baijiu crossover interest in aged expressions','Growing whisky bar scene in Shanghai, Beijing'],
          note:'Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP. 2024 estimated; 2025 editorial. China is Japan\'s LARGEST whisky export market by value — overtaking the USA in 2020. The extraordinary surge from £18m (2019) to £117m (2022 peak) defined the Japanese whisky bubble. The correction since is driven by Chinese luxury goods demand softening, not structural loss of interest. Suntory and Nikka have made significant direct investment in China distribution.',
        },
        'Germany': {
          hist:[{yr:2019,v:5},{yr:2020,v:4},{yr:2021,v:7},{yr:2022,v:12},{yr:2023,v:12},{yr:2024,v:10},{yr:2025,v:11}],
          proj:[{yr:2026,v:13}],
          cagr3:'+12.5%', cagr5:'+14.9%',
          cats:[{n:'Single Malt',p:65},{n:'Blended',p:28},{n:'Grain',p:7}],
          tariff:'EU–Japan Economic Partnership Agreement (EPA), in force February 2019. Spirits import duty reduced to zero on entry into force.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:["Largest whisky market in continental Europe after France","Strong whisky festival culture — Berlin, Hamburg, Munich","Deep specialist retail network (WiskyBase-listed stores)","EU–Japan EPA zero tariff accelerated import surge from 2019","Suntory and Nikka dedicated German distribution","Educated collector base paying premium for limited expressions"],
          note:"Industry estimate — Japan MoF statistics record Netherlands as the EU port of entry for Japanese whisky (Rotterdam effect), meaning Germany consumption is largely captured in the Netherlands line. Direct Japan→Germany shipments are small; German consumers access Japanese whisky through EU distributors. The EU–Japan EPA zero tariff since 2019 has grown the category across all continental EU markets.",
        },
        'Australia': {
          hist:[{yr:2019,v:4},{yr:2020,v:5},{yr:2021,v:8},{yr:2022,v:9},{yr:2023,v:11},{yr:2024,v:10},{yr:2025,v:11}],
          proj:[{yr:2026,v:12}],
          cagr3:'+7.7%', cagr5:'+20.1%',
          cats:[{n:'Single Malt',p:66},{n:'Blended',p:25},{n:'Grain',p:9}],
          tariff:'Japan–Australia EPA (JAEPA), in force January 2015. Spirits tariff phased to zero by 2022 under the EPA staging schedule.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:["Strong Japanese cultural affinity in Australia","Langton's auction house expanding Japanese whisky catalogue","Geographic proximity and significant Japanese tourism flow","HNWI collector demand growing sharply","Craft bar culture in Sydney and Melbourne embracing Japanese expressions"],
          note:"Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP. 2024 estimated; 2025 editorial. Australia is a growing market for Japanese whisky, helped by cultural ties and the JAEPA phasing tariffs to zero by 2022. The market doubled between 2019 and 2023. Langton's auction house increasingly catalogues Japanese lots. Values remain modest in absolute terms — this is an emerging market with strong growth trajectory.",
        },
        'UK': {
          hist:[{yr:2019,v:8},{yr:2020,v:8},{yr:2021,v:10},{yr:2022,v:9},{yr:2023,v:6},{yr:2024,v:5},{yr:2025,v:6}],
          proj:[{yr:2026,v:7}],
          cagr3:'-20.6%', cagr5:'-9.9%',
          cats:[{n:'Single Malt',p:70},{n:'Blended',p:22},{n:'Grain',p:8}],
          tariff:'UK–Japan Comprehensive Economic Partnership Agreement (CEPA), in force January 2021. Zero duty on spirits. Rolled over from EU–Japan EPA with continuity provisions.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:["The Whisky Exchange and Master of Malt — world's largest online specialists","London auction market (Bonhams, Christie's, Whisky Auctioneer)","Whisky Show and UK festival circuit driving education","Sophisticated bar culture adopting Japanese expressions","UK food & drink media creating collector demand"],
          note:"Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP. 2019–2021 estimated (not individually reported). The UK market peaked in 2021 and has contracted — UK consumers have access to Japanese whisky through EU grey-market routes and parallel imports, which don't appear in Japan export figures. The Whisky Exchange, Master of Malt, and the auction ecosystem (Bonhams, Christie's) remain the UK's primary Japanese whisky channels.",
        },
      },
      usa: {
        'EU': {
          hist:[{yr:2019,v:392},{yr:2020,v:344},{yr:2021,v:319},{yr:2022,v:457},{yr:2023,v:569},{yr:2024,v:555},{yr:2025,v:600}],
          proj:[{yr:2026,v:640}],
          cagr3:'+20.2%', cagr5:'+7.2%',
          cats:[{n:'Bourbon',p:72},{n:'Tennessee',p:18},{n:'Rye',p:10}],
          tariff:'EU imposed 25% retaliatory tariff on American whiskey June 2018 (response to US steel/aluminium tariffs). Suspended June 2021. Further suspended through 2025. Permanent resolution linked to global metals dispute.',
          tariffStatus:'SUSPENDED', tariffCol:'#E97132',
          drivers:['Bourbon cocktail culture adoption across EU (Negroni, Old Fashioned)','American whiskey premiumisation','Post-tariff recovery momentum','Kentucky Bourbon Trail driving brand tourism and awareness','Buffalo Trace Antique Collection European launches'],
          note:'Source: DISCUS (Distilled Spirits Council of the US) annual export reports, converted GBP at annual average rates. The EU retaliatory tariff (2018–2021) depressed exports to ~£320–392m. The recovery since tariff suspension has been extraordinary — 2023 at £569m was a record high, nearly 80% above the tariff-era trough. A permanent metals tariff resolution would secure this growth trajectory.',
        },
        'UK': {
          hist:[{yr:2019,v:79},{yr:2020,v:65},{yr:2021,v:64},{yr:2022,v:90},{yr:2023,v:69},{yr:2024,v:68},{yr:2025,v:72}],
          proj:[{yr:2026,v:76}],
          cagr3:'+2.1%', cagr5:'-2.9%',
          cats:[{n:'Bourbon',p:62},{n:'Tennessee',p:25},{n:'Rye',p:10},{n:'Other',p:3}],
          tariff:'Zero tariff post-Brexit UK–US trade negotiations — currently MFN rate 0%. UK–US FTA discussions ongoing. UK applies zero duty on spirits imports under its post-Brexit tariff schedule.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Strong bourbon cocktail culture in London & major cities','Buffalo Trace, Maker\'s Mark brand recognition','US whiskey specialist retailers growing','Bourbon replacing blended Scotch in on-trade well spirit role'],
          note:'Source: DISCUS annual export reports, converted GBP. Post-Brexit, the UK independently set spirits import duties to zero — but the market remains modest at £68–90m. The UK is well-supplied with premium American whiskey through specialist retailers. The 2022 spike to £90m followed strong post-tariff-era restocking; 2023–24 normalised.',
        },
        'Japan': {
          hist:[{yr:2019,v:55},{yr:2020,v:50},{yr:2021,v:69},{yr:2022,v:82},{yr:2023,v:85},{yr:2024,v:63},{yr:2025,v:68}],
          proj:[{yr:2026,v:73}],
          cagr3:'-3.0%', cagr5:'+4.8%',
          cats:[{n:'Bourbon',p:65},{n:'Tennessee',p:18},{n:'Rye',p:12},{n:'Other',p:5}],
          tariff:'US–Japan Trade Agreement (2020) removed tariffs on American whiskey exports to Japan. Zero duty.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['American whiskey complements Japanese cocktail culture','Highball format driving bourbon consumption','Four Roses and Knob Creek strong Japanese retail presence','Whisky magazine culture creating educated consumer base'],
          note:'Source: DISCUS annual export reports, converted GBP. American whiskey exports to Japan peaked in 2023 at £85m before contracting in 2024 alongside broader US whiskey export softness. The highball format — standard in Japanese bars — drives bourbon volume. Four Roses, Knob Creek, and Jim Beam dominate distribution.',
        },
        'Australia': {
          hist:[{yr:2019,v:68},{yr:2020,v:57},{yr:2021,v:61},{yr:2022,v:94},{yr:2023,v:98},{yr:2024,v:90},{yr:2025,v:96}],
          proj:[{yr:2026,v:104}],
          cagr3:'+13.9%', cagr5:'+5.7%',
          cats:[{n:'Bourbon',p:70},{n:'Tennessee',p:18},{n:'Rye',p:9},{n:'Other',p:3}],
          tariff:'No US–Australia FTA exists. Australia applies a 5% WTO MFN customs duty on imported spirits. This has not been addressed in bilateral negotiations.',
          tariffStatus:'5% DUTY', tariffCol:'#44cc64',
          drivers:['Bourbon firmly embedded in Australian bar and cocktail culture','US cultural influence driving brand recognition','Dan Murphy\'s and BWS national retail distribution','Bourbon trail tourism creating affinity among Australian visitors to the US','Growing single barrel and small-batch collector segment'],
          note:"Source: DISCUS annual export reports, converted GBP. Australia is a strong market for American whiskey — bourbon is second only to Scotch in premium spirits market share. DISCUS data shows a sharp post-tariff recovery in 2022 (+54% from 2021 trough), with a modest 2024 pullback following inventory normalisation. The 5% MFN tariff is a minor friction with no bilateral FTA in place.",
        },
        'Canada': {
          hist:[{yr:2019,v:61},{yr:2020,v:51},{yr:2021,v:49},{yr:2022,v:65},{yr:2023,v:61},{yr:2024,v:58},{yr:2025,v:62}],
          proj:[{yr:2026,v:68}],
          cagr3:'+5.8%', cagr5:'-1.0%',
          cats:[{n:'Bourbon',p:62},{n:'Tennessee',p:20},{n:'Rye',p:12},{n:'Other',p:6}],
          tariff:'Zero tariff under USMCA (successor to NAFTA, in force July 2020). Canada considered retaliatory tariffs on US goods in March 2025 (Trump steel/aluminium dispute) but spirits were specifically excluded from the retaliation list.',
          tariffStatus:'ZERO (USMCA)', tariffCol:'#44cc64',
          drivers:['Zero-tariff USMCA access','Shared North American drinking culture and media','Strong bourbon presence in Ontario LCBO and BC Liquor government retail','Jim Beam, Jack Daniel\'s dominant in mass-market channel','Canadian–American tourism and cross-border cultural integration'],
          note:"Source: DISCUS annual export reports, converted GBP. Canada is a mature, integrated market — USMCA guarantees zero-tariff access. Exports are broadly flat at £58–65m, reflecting a saturated market where American whiskey is deeply embedded. When Canada threatened retaliatory tariffs in 2025, spirits were deliberately excluded — signalling political sensitivity about disrupting this deeply integrated cross-border trade.",
        },
        'Singapore': {
          hist:[{yr:2019,v:40},{yr:2020,v:32},{yr:2021,v:42},{yr:2022,v:52},{yr:2023,v:58},{yr:2024,v:63},{yr:2025,v:70}],
          proj:[{yr:2026,v:80}],
          cagr3:'+10.4%', cagr5:'+16.9%',
          cats:[{n:'Bourbon',p:62},{n:'Tennessee',p:22},{n:'Rye',p:12},{n:'Other',p:4}],
          tariff:'Zero tariff. US–Singapore Free Trade Agreement (USSFTA), in force January 2004 — one of the first US bilateral FTAs, providing full zero-tariff access for spirits.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['US–Singapore FTA zero tariff since 2004','American whiskey cocktail culture at Marina Bay Sands and luxury hotels','Re-export to ASEAN markets','Expatriate professional community driving premium consumption','Changi Airport travel retail','Allocated bourbons (Buffalo Trace, Pappy) trading at premium in specialist retail'],
          note:"Singapore is a high-income free-trade hub where American whiskey has enjoyed zero tariffs since 2004. A significant portion is consumed by the expatriate professional community and re-exported across ASEAN. Premium and allocated bourbons attract substantial mark-ups through specialist retailers in the Orchard Road corridor.",
        },
        'UAE': {
          hist:[{yr:2019,v:28},{yr:2020,v:22},{yr:2021,v:30},{yr:2022,v:38},{yr:2023,v:44},{yr:2024,v:50},{yr:2025,v:58}],
          proj:[{yr:2026,v:68}],
          cagr3:'+15.2%', cagr5:'+21.4%',
          cats:[{n:'Tennessee',p:40},{n:'Bourbon',p:45},{n:'Rye',p:10},{n:'Other',p:5}],
          tariff:'UAE applies a 5% customs duty on spirits imports under its standard import schedule. Duty-free sales at Dubai Duty Free — one of the world\'s top 5 spirits retailers — are exempt from this duty.',
          tariffStatus:'5% DUTY', tariffCol:'#44cc64',
          drivers:['Dubai Duty Free — top 5 global spirits retailer by value','International HNWI and expat community in Dubai and Abu Dhabi','Jack Daniel\'s dominant brand recognition across Gulf region','Luxury hotel and rooftop bar on-trade (DIFC, Downtown Dubai)','Re-export gateway to Gulf and South Asian markets'],
          note:"The UAE is American whiskey's fastest-growing Gulf market, centred on Dubai Duty Free and the luxury hotel on-trade. Jack Daniel's dominates by volume. The ultra-premium segment — Buffalo Trace Antique Collection, Pappy Van Winkle — moves through specialist retailers in DIFC and the Four Seasons hotel network.",
        },
      },
      ireland: {
        'USA': {
          hist:[{yr:2019,v:140},{yr:2020,v:155},{yr:2021,v:175},{yr:2022,v:195},{yr:2023,v:210},{yr:2024,v:220},{yr:2025,v:238}],
          proj:[{yr:2026,v:262}],
          cagr3:'+6.9%', cagr5:'+8.9%',
          cats:[{n:'Blended Irish',p:65},{n:'Single Pot Still',p:18},{n:'Single Malt',p:13},{n:'Single Grain',p:4}],
          tariff:'Zero tariff. Irish whiskey was not subject to the 2019 US tariffs (which only applied to Scotch). This gave Irish producers a significant competitive advantage during 2019–2022.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Irish diaspora — 40m Americans claim Irish heritage','St Patrick\'s Day seasonal demand peak','Jameson\'s dominant market position and marketing investment','Single pot still category education growing','On-trade Irish bar culture in major US cities'],
          note:'Irish whiskey\'s US growth story is one of the most consistent in spirits. The tariff exemption during 2019–2022 when Scotch faced 25% duty gave Irish brands a structural advantage that drove trial and brand loyalty. Jameson alone accounts for approximately 70% of Irish whiskey US volumes.',
        },
        'France': {
          hist:[{yr:2019,v:45},{yr:2020,v:40},{yr:2021,v:48},{yr:2022,v:58},{yr:2023,v:63},{yr:2024,v:66},{yr:2025,v:70}],
          proj:[{yr:2026,v:77}],
          cagr3:'+6.4%', cagr5:'+11.8%',
          cats:[{n:'Blended Irish',p:68},{n:'Single Pot Still',p:16},{n:'Single Malt',p:12},{n:'Single Grain',p:4}],
          tariff:'Zero tariff. EU Single Market — Ireland is a member of the EU, so intra-EU trade applies for Irish exports to France via the TCA framework.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Celtic cultural affinity','Tourism reverse flow — French visitors to Ireland driving brand awareness','Premium Irish malt growing in French specialist retail','Cocktail adoption'],
          note:'France is the second-largest market for Irish whiskey globally. Growth is driven by cultural links and the growing French interest in premium blended and pot still expressions beyond Jameson.',
        },
        'UK': {
          hist:[{yr:2019,v:42},{yr:2020,v:36},{yr:2021,v:43},{yr:2022,v:48},{yr:2023,v:52},{yr:2024,v:55},{yr:2025,v:59}],
          proj:[{yr:2026,v:64}],
          cagr3:'+7.1%', cagr5:'+10.4%',
          cats:[{n:'Blended Irish',p:58},{n:'Single Pot Still',p:24},{n:'Single Malt',p:14},{n:'Grain',p:4}],
          tariff:'Zero tariff. Irish whiskey accesses the UK market under the Windsor Framework and UK–EU Trade and Cooperation Agreement, maintaining frictionless island-of-Ireland trade arrangements post-Brexit.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['Jameson dominant in UK pub and bar on-trade','Growing craft Irish whiskey in specialist retail — Redbreast, Green Spot, Dingle','Irish diaspora and deep cultural affinity','Windsor Framework maintaining frictionless Irish–UK trade','Celtic identity and tourism driving brand loyalty'],
          note:"The UK is Ireland's third-largest export market and one of its most consistent. Irish whiskey is Scotch's primary competitor in UK on-trade, with Jameson particularly strong in city-centre bars. The Windsor Framework resolved post-Brexit trade complexity, preserving seamless access.",
        },
        'Germany': {
          hist:[{yr:2019,v:28},{yr:2020,v:22},{yr:2021,v:28},{yr:2022,v:35},{yr:2023,v:40},{yr:2024,v:44},{yr:2025,v:48}],
          proj:[{yr:2026,v:54}],
          cagr3:'+11.1%', cagr5:'+16.8%',
          cats:[{n:'Blended Irish',p:68},{n:'Single Pot Still',p:15},{n:'Single Malt',p:13},{n:'Single Grain',p:4}],
          tariff:'Zero tariff. Ireland and Germany are both EU members — fully frictionless intra-EU Single Market trade. No tariff, no customs checks.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['EU Single Market — zero barriers','Jameson brand investment in German on-trade marketing','Irish pub culture in Berlin, Hamburg, Munich, Frankfurt','Growing interest in premium Irish single pot still among German collectors','Teeling and Waterford building direct German distribution channels'],
          note:"Germany is Ireland's largest continental European market. The EU Single Market eliminates all trade friction. Jameson dominates by volume, but the premium segment — Redbreast, Green Spot, Midleton — is growing rapidly among Germany's sizeable whisky collector community.",
        },
        'Canada': {
          hist:[{yr:2019,v:20},{yr:2020,v:18},{yr:2021,v:22},{yr:2022,v:26},{yr:2023,v:30},{yr:2024,v:33},{yr:2025,v:36}],
          proj:[{yr:2026,v:40}],
          cagr3:'+11.5%', cagr5:'+14.9%',
          cats:[{n:'Blended Irish',p:66},{n:'Single Pot Still',p:15},{n:'Single Malt',p:15},{n:'Single Grain',p:4}],
          tariff:'Reduced tariff under CETA (EU–Canada Comprehensive Economic and Trade Agreement), in force provisionally since 2017. Irish whiskey benefits as an EU product — spirits tariff reduced significantly below Canada\'s WTO MFN rate.',
          tariffStatus:'CETA — LOW', tariffCol:'#44cc64',
          drivers:['Irish diaspora — 4.5m Canadians claim Irish heritage','St Patrick\'s Day volume peak','Jameson dominant in Ontario LCBO and BC Liquor government retail','CETA preferential market access for EU spirits','Growing premium Irish category awareness beyond Jameson'],
          note:"Canada's large Irish diaspora (over 4 million) creates natural structural demand for Irish whiskey. CETA provides preferential access through Canada's provincial liquor board retail monopolies. Jameson dominates, but Redbreast and single pot still expressions are gaining ground in specialist channels.",
        },
        'Australia': {
          hist:[{yr:2019,v:16},{yr:2020,v:14},{yr:2021,v:18},{yr:2022,v:22},{yr:2023,v:25},{yr:2024,v:28},{yr:2025,v:31}],
          proj:[{yr:2026,v:35}],
          cagr3:'+12.1%', cagr5:'+17.2%',
          cats:[{n:'Blended Irish',p:65},{n:'Single Pot Still',p:15},{n:'Single Malt',p:16},{n:'Single Grain',p:4}],
          tariff:'EU–Australia FTA negotiations stalled in 2023. Australia applies its WTO MFN rate of 5% customs duty on spirits imported from Ireland. No preferential deal currently in force.',
          tariffStatus:'5% DUTY', tariffCol:'#44cc64',
          drivers:['Irish diaspora — 2.5m Australians claim Irish heritage','St Patrick\'s Day cultural event driving volume peaks','Jameson distribution across Dan Murphy\'s and BWS national chains','Growing craft spirits interest benefiting premium Irish expressions','Irish pub network in Sydney, Melbourne, Brisbane'],
          note:"Australia is a steady growth market for Irish whiskey, anchored by Jameson in national retail. The EU–Australia FTA stalled in 2023, leaving the 5% tariff in place, but growth continues regardless. Premium Irish expressions are gaining an audience at specialist retailers and Irish hospitality venues.",
        },
        'Spain': {
          hist:[{yr:2019,v:18},{yr:2020,v:14},{yr:2021,v:18},{yr:2022,v:23},{yr:2023,v:26},{yr:2024,v:28},{yr:2025,v:31}],
          proj:[{yr:2026,v:35}],
          cagr3:'+10.5%', cagr5:'+17.2%',
          cats:[{n:'Blended Irish',p:74},{n:'Single Pot Still',p:14},{n:'Single Malt',p:9},{n:'Single Grain',p:3}],
          tariff:'Zero tariff. Both Ireland and Spain are EU member states — fully frictionless intra-EU Single Market trade.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['EU Single Market zero barriers','Jameson & tonic format popular in Spanish bars — standard cocktail offering','Tourism reverse flow — Spanish visitors to Ireland building brand familiarity','Jameson on-trade investment in Spanish hospitality sector','Growing whiskey curiosity among Spanish consumers transitioning from gin and vermouth'],
          note:"Spain is a growing market driven by Jameson's penetration of the Spanish on-trade cocktail scene. The 'Jameson & tonic' format has become a standard bar offering alongside the traditional gin & tonic. EU membership provides completely frictionless trade from Ireland.",
        },
      },
    };

    var current = 'scotland';
    var mode = 'supply';
    var drillKey = null;

    /* ── Per-origin live data stores ── */
    var _liveExp  = {};  /* keyed by origin: UN Comtrade export data */
    var _livePrc  = {};  /* keyed by origin: WhiskyStats distillery prices */
    var _liveHist = {};  /* keyed by "origin_m49": UN Comtrade bilateral route history */
    var _drillM49 = null; /* M49 partner code for the currently drilled destination */

    /* Static M49 fallback for common FLOWS destinations — used when live export
       data hasn't loaded yet so the drilldown can still fetch route history. */
    var DEST_M49_FALLBACK = {
      'USA': 842, 'France': 250, 'Germany': 276, 'India': 356,
      'Singapore': 702, 'Japan': 392, 'Taiwan': 158, 'Australia': 36,
      'S. Korea': 410, 'Canada': 124, 'Belgium': 56, 'Netherlands': 528,
      'Switzerland': 756, 'Spain': 724, 'Italy': 380, 'Poland': 616,
      'Thailand': 764, 'UAE': 784, 'China': 156, 'Hong Kong': 344,
      'UK': 826, 'EU': null,  /* EU has no single M49 */
    };

    function _getDestM49(originKey, destCountry) {
      var le = _liveExp[originKey];
      if (le && le.destinations) {
        for (var i = 0; i < le.destinations.length; i++) {
          if (le.destinations[i].country === destCountry) return le.destinations[i].m49;
        }
      }
      return DEST_M49_FALLBACK[destCountry] || null;
    }

    function fetchRouteHistory(originKey, m49) {
      if (!m49) return;
      var histKey = originKey + '_' + m49;
      if (_liveHist[histKey] && _liveHist[histKey].rows && _liveHist[histKey].rows.length) return;
      var cacheKey = 'tbt_rh4_' + histKey;
      var TTL = 86400000 * 7;
      try {
        var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (cached && cached._ts && (Date.now() - cached._ts) < TTL && cached.rows && cached.rows.length) {
          _liveHist[histKey] = cached;
          buildUI();
          return;
        }
      } catch(e) {}
      /* Route-history function fetches years sequentially (26s timeout) to avoid rate limiting.
         v=2 busts the Netlify CDN cache from the old parallel-fetch version. */
      fetch('/.netlify/functions/route-history?v=2&origin=' + originKey + '&dest=' + m49)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.rows && data.rows.length) {
            data._ts = Date.now();
            _liveHist[histKey] = data;
            try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch(e) {}
            buildUI();
          }
        })
        .catch(function() {});
    }

    function _getExportNodes(originKey) {
      var le = _liveExp[originKey];
      if (!le || !le.destinations || !le.destinations.length) return null;
      var flowData = FLOWS[originKey] || {};
      return le.destinations.slice(0, 10).map(function(dest) {
        /* Prefer SWA/official static FLOWS value over UN Comtrade absolute.
           UN Comtrade reporter 826 (UK) inflates Scotland figures ~2x by
           including non-Scotch re-exports. FLOWS hist uses verified SWA data. */
        var flow = flowData[dest.country];
        var gbpM;
        if (flow && flow.hist && flow.hist.length) {
          var lastBar = flow.hist[flow.hist.length - 1];
          gbpM = lastBar.v;  /* already in £m, SWA-verified */
        } else {
          gbpM = dest.valueGBP ? Math.round(dest.valueGBP / 1000000) : null;
        }
        return {
          country: dest.country,
          pct:     dest.pct,
          val:     gbpM ? (gbpM >= 1000 ? '£' + (gbpM/1000).toFixed(2) + 'bn' : '£' + gbpM + 'm') : '',
          yoy:     dest.yoy != null ? dest.yoy : undefined,
          flag:    '',
          m49:     dest.m49,
          _live:   true,
        };
      });
    }

    function _getMergedDistilleries(originKey) {
      var base = OD[originKey].distilleries;
      var lp   = _livePrc[originKey];
      if (!lp || !lp.distilleries || !lp.distilleries.length) return base;
      return base.map(function(d) {
        var live = null;
        for (var li = 0; li < lp.distilleries.length; li++) {
          if (lp.distilleries[li].name === d.name) { live = lp.distilleries[li]; break; }
        }
        return (live && live.avg) ? { name: d.name, region: d.region, avg: live.avg, yoy: d.yoy, _live: true } : d;
      });
    }

    /* ── Live data fetcher (exports + distillery prices) ── */
    function fetchLiveData(originKey) {
      var expKey = 'tbt_exp2_' + originKey;
      var prcKey = 'tbt_prc2_' + originKey;
      var EXP_TTL = 86400000 * 7;   /* 7 days (matches CDN cache) */
      var PRC_TTL = 86400000 * 7;

      try {
        var ce = localStorage.getItem(expKey);
        if (ce) { var c = JSON.parse(ce); if (c && c._ts && (Date.now()-c._ts)<EXP_TTL) _liveExp[originKey]=c; }
        var cp = localStorage.getItem(prcKey);
        if (cp) { var p = JSON.parse(cp); if (p && p._ts && (Date.now()-p._ts)<PRC_TTL) _livePrc[originKey]=p; }
      } catch(e) {}

      if (!_liveExp[originKey]) {
        fetch('/.netlify/functions/scotch-exports?origin=' + originKey)
          .then(function(r){return r.json();})
          .then(function(data){
            if (!data || !data.destinations || !data.destinations.length) return;
            data._ts = Date.now();
            _liveExp[originKey] = data;
            try { localStorage.setItem(expKey, JSON.stringify(data)); } catch(e) {}
            if (current === originKey) buildUI();
          }).catch(function(){});
      }

      if (!_livePrc[originKey]) {
        fetch('/.netlify/functions/distillery-prices?origin=' + originKey)
          .then(function(r){return r.json();})
          .then(function(data){
            if (!data || !data.distilleries || !data.distilleries.length) return;
            data._ts = Date.now();
            _livePrc[originKey] = data;
            try { localStorage.setItem(prcKey, JSON.stringify(data)); } catch(e) {}
            if (current === originKey) buildUI();
          }).catch(function(){});
      }
    }

    /* Kick off Scotland immediately; others load on demand */
    fetchLiveData('scotland');

    /* ── SVG helpers ── */
    function svgNode(s, x, y, w, h, name, sub1, sub2, stat, acol, bgcol, borderCol) {
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + bgcol + '" stroke="' + borderCol + '" stroke-width="1"/>';
      var nm = name.length > 17 ? name.slice(0,16) + '…' : name;
      s += '<text x="' + (x+8) + '" y="' + (y+14) + '" font-family="Consolas,monospace" font-size="9" fill="#ffffff" font-weight="700">' + nm + '</text>';
      if (sub1) s += '<text x="' + (x+8) + '" y="' + (y+25) + '" font-family="Consolas,monospace" font-size="7" fill="' + acol + '" letter-spacing="0.08em">' + sub1 + '</text>';
      if (stat) s += '<text x="' + (x+8) + '" y="' + (y+38) + '" font-family="Consolas,monospace" font-size="7.5" fill="rgba(255,255,255,0.45)">' + stat + '</text>';
      if (sub2) s += '<text x="' + (x+8+52) + '" y="' + (y+38) + '" font-family="Consolas,monospace" font-size="7.5" fill="' + acol + '">' + sub2 + '</text>';
      return s;
    }

    function svgLine(s, x1, y1, x2, y2, color, width) {
      var cpx = x1 + (x2 - x1) * 0.5;
      s += '<path d="M' + x1 + ',' + y1 + ' C' + cpx + ',' + y1 + ' ' + cpx + ',' + y2 + ' ' + x2 + ',' + y2 + '" stroke="' + color + '" stroke-width="' + (width||1) + '" fill="none"/>';
      return s;
    }

    function buildWebSVG(rightNodes, rightLabel, lineColor) {
      var d = OD[current];
      var distils = _getMergedDistilleries(current);
      var W = 800, H = 430;
      var NW = 162, NH = 46, MW = 162, MH = 46, CW = 164, CH = 110;
      var centerX = (W - CW) / 2, centerY = (H - CH) / 2, cMidY = centerY + CH / 2;
      var leftN  = Math.min(distils.length, 9);
      var leftStep = Math.min(52, (H-30)/leftN), leftY0 = (H - leftN*leftStep)/2 + 2;
      var rightN = Math.min(rightNodes.length, 9);
      var rightStep = Math.min(62, (H-30)/rightN), rightY0 = (H - rightN*rightStep)/2 + 2;
      var rightX = W - MW;
      var avgP = Math.round(distils.reduce(function(a,b){return a+b.avg;},0)/distils.length);
      var avgY = Math.round(distils.reduce(function(a,b){return a+b.yoy;},0)/distils.length);
      var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:100%;display:block;">';

      /* lines left */
      var li;
      for (li = 0; li < leftN; li++) {
        var lny = leftY0 + li*leftStep + NH/2;
        var yoy = distils[li].yoy;
        var lc = yoy >= 20 ? 'rgba(68,204,100,0.55)' : yoy >= 10 ? 'rgba(68,204,100,0.32)' : 'rgba(200,180,60,0.28)';
        s = svgLine(s, NW, lny, centerX, cMidY, lc, yoy>=25?1.5:1);
      }
      /* lines right */
      var ri;
      for (ri = 0; ri < rightN; ri++) {
        var rny = rightY0 + ri*rightStep + MH/2;
        var wt = rightNodes[ri].share || rightNodes[ri].pct || 10;
        var rc = wt >= 25 ? lineColor.replace('0.3','0.55') : lineColor;
        s = svgLine(s, centerX+CW, cMidY, rightX, rny, rc, wt>=30?1.5:1);
      }
      /* distillery nodes */
      var di;
      for (di = 0; di < leftN; di++) {
        var dt = distils[di]; var ny = leftY0 + di*leftStep;
        var yv = dt.yoy;
        var nc = yv>=20?'#44cc64':yv>=10?'#2ea84a':'#b8b030';
        var nb = yv>=20?'rgba(30,80,45,0.92)':'rgba(22,60,34,0.9)';
        var ystr = (yv>=0?'+':'')+yv+'% YoY';
        s = svgNode(s, 0, ny, NW, NH, dt.name, dt.region.toUpperCase(), ystr, '£'+dt.avg+' avg', nc, nb, nc);
      }
      /* center node */
      s += '<rect x="'+centerX+'" y="'+centerY+'" width="'+CW+'" height="'+CH+'" fill="rgba(80,28,8,0.96)" stroke="#E97132" stroke-width="2"/>';
      s += '<rect x="'+centerX+'" y="'+centerY+'" width="'+CW+'" height="3" fill="#E97132"/>';
      var cx = centerX + CW/2;
      s += '<text x="'+cx+'" y="'+(centerY+22)+'" font-family="Consolas,monospace" font-size="11" fill="#E97132" font-weight="700" letter-spacing="0.22em" text-anchor="middle">'+d.label+'</text>';
      s += '<text x="'+cx+'" y="'+(centerY+38)+'" font-family="Consolas,monospace" font-size="7.5" fill="#c0c0c0" text-anchor="middle">'+distils.length+' DISTILLERIES · '+rightNodes.length+' '+rightLabel.toUpperCase()+'</text>';
      s += '<text x="'+cx+'" y="'+(centerY+56)+'" font-family="Consolas,monospace" font-size="8" fill="#E97132" text-anchor="middle">AVG £'+avgP+'</text>';
      s += '<text x="'+cx+'" y="'+(centerY+72)+'" font-family="Consolas,monospace" font-size="8" fill="#44cc64" text-anchor="middle">+'+(avgY)+'% YoY</text>';
      /* right nodes */
      for (ri = 0; ri < rightN; ri++) {
        var rn = rightNodes[ri]; var ny2 = rightY0 + ri*rightStep;
        var pct = rn.share || rn.pct || 0;
        var rc2 = pct>=30?'#4898d8':pct>=15?'#3070a8':'#225580';
        var rb2 = pct>=30?'rgba(18,38,80,0.92)':'rgba(14,28,60,0.9)';
        var stat2, sub2a, sub2b;
        if (mode === 'supply') {
          stat2 = 'Vol: '; sub2a = pct+'%'; sub2b = '£'+(rn.avg||0)+' avg';
          s = svgNode(s, rightX, ny2, MW, MH, rn.name, rn.loc||'', sub2a, stat2, rc2, rb2, rc2);
          s += '<text x="'+(rightX+8+52)+'" y="'+(ny2+38)+'" font-family="Consolas,monospace" font-size="7.5" fill="rgba(255,255,255,0.45)">  '+sub2b+'</text>';
        } else {
          var yoy2 = rn.yoy; var hasYoy = yoy2 != null && yoy2 !== undefined;
          var yc2 = hasYoy && yoy2>=15?'#44cc64':hasYoy && yoy2>=5?'#2ea84a':'rgba(255,255,255,0.45)';
          stat2 = rn.val; sub2a = hasYoy ? ((yoy2>=0?'+':'')+yoy2+'% YoY') : '';
          var destKey = rn.country;
          var hasFlow = !!(FLOWS[current] && FLOWS[current][destKey]);
          var hasM49  = !!(rn._live && rn.m49);  /* live node with M49 — can fetch history */
          var isDrill = hasFlow || hasM49;
          var borderStyle = isDrill ? rc2 : '#1e3050';
          s += '<rect x="'+rightX+'" y="'+ny2+'" width="'+MW+'" height="'+MH+'" fill="'+rb2+'" stroke="'+borderStyle+'" stroke-width="1" data-dest="'+destKey+'" data-m49="'+(rn.m49||'')+'" style="cursor:'+(isDrill?'pointer':'default')+'"/>';
          var nm2 = rn.country.length>17?rn.country.slice(0,16)+'…':rn.country;
          s += '<text x="'+(rightX+8)+'" y="'+(ny2+14)+'" font-family="Consolas,monospace" font-size="9" fill="#ffffff" font-weight="700" pointer-events="none">'+nm2+'</text>';
          s += '<text x="'+(rightX+8)+'" y="'+(ny2+25)+'" font-family="Consolas,monospace" font-size="7" fill="'+rc2+'" letter-spacing="0.08em" pointer-events="none">'+pct+'% of exports</text>';
          s += '<text x="'+(rightX+8)+'" y="'+(ny2+38)+'" font-family="Consolas,monospace" font-size="7.5" fill="rgba(255,255,255,0.45)" pointer-events="none">'+stat2+'  </text>';
          s += '<text x="'+(rightX+8+52)+'" y="'+(ny2+38)+'" font-family="Consolas,monospace" font-size="7.5" fill="'+yc2+'" pointer-events="none">'+sub2a+'</text>';
          if (isDrill) s += '<text x="'+(rightX+MW-6)+'" y="'+(ny2+NH/2+3)+'" font-family="Consolas,monospace" font-size="9" fill="#E97132" text-anchor="middle" pointer-events="none">›</text>';
        }
      }
      var distSrc  = (_livePrc[current] && _livePrc[current].distilleries) ? 'WhiskyStats live' : 'est.';
      var expSrc   = (_liveExp[current] && _liveExp[current].period) ? 'UN Comtrade ' + _liveExp[current].period : 'est.';
      var leftSrc  = mode === 'supply' ? '' : ' · prices: ' + distSrc;
      var rightSrc = mode === 'exports' ? ' · ' + expSrc : '';
      s += '<text x="'+(NW/2)+'" y="'+(H-6)+'" font-family="Consolas,monospace" font-size="6.5" fill="rgba(255,255,255,0.2)" text-anchor="middle" letter-spacing="0.1em">DISTILLERIES'+leftSrc+'</text>';
      s += '<text x="'+(rightX+MW/2)+'" y="'+(H-6)+'" font-family="Consolas,monospace" font-size="6.5" fill="rgba(255,255,255,0.2)" text-anchor="middle" letter-spacing="0.1em">'+rightLabel.toUpperCase()+rightSrc+'</text>';
      if (mode === 'exports') s += '<text x="'+(rightX+MW-4)+'" y="'+(H-6)+'" font-family="Consolas,monospace" font-size="6.5" fill="rgba(233,113,50,0.4)" text-anchor="end" letter-spacing="0.1em">› CLICK FOR DETAIL</text>';
      s += '</svg>';
      return s;
    }

    /* SVG bar chart — scales perfectly at any CSS zoom level */
    function buildBarChartSVG(hist, proj) {
      var all = hist.concat(proj);
      var rawMax = Math.max.apply(null, all.map(function(p){return p.v;}));
      /* round up to a nice ceiling */
      var mag = Math.pow(10, Math.floor(Math.log(rawMax) / Math.log(10)));
      var maxV = Math.ceil(rawMax / (mag * 0.5)) * (mag * 0.5);

      var W = 800, H = 130;
      var PAD = {t:22, r:10, b:26, l:56};
      var cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
      var barGap = cW / all.length;
      var barW = barGap * 0.60;

      var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" style="width:100%;height:100%;display:block;">';

      /* grid */
      [0.25, 0.5, 0.75, 1].forEach(function(f) {
        var y = PAD.t + cH * (1 - f);
        s += '<line x1="'+PAD.l+'" y1="'+y+'" x2="'+(W-PAD.r)+'" y2="'+y+'" stroke="#1c1c1c" stroke-width="1"/>';
        var lv = maxV * f;
        var lbl = lv >= 1000 ? '£'+(lv/1000).toFixed(1)+'bn' : '£'+Math.round(lv)+'m';
        s += '<text x="'+(PAD.l-4)+'" y="'+(y+3.5)+'" font-family="Consolas,monospace" font-size="9" fill="rgba(255,255,255,0.3)" text-anchor="end">'+lbl+'</text>';
      });

      /* projection divider */
      if (proj.length) {
        var dx = PAD.l + hist.length * barGap;
        var projLbl = proj[0] && proj[0].yr ? proj[0].yr+' PROJ' : 'PROJECTED';
        s += '<line x1="'+dx+'" y1="'+PAD.t+'" x2="'+dx+'" y2="'+(PAD.t+cH)+'" stroke="#282828" stroke-width="1" stroke-dasharray="4,3"/>';
        s += '<text x="'+(dx+4)+'" y="'+(PAD.t+10)+'" font-family="Consolas,monospace" font-size="8" fill="rgba(255,255,255,0.22)" letter-spacing="0.1em">'+projLbl+'</text>';
      }

      /* bars */
      all.forEach(function(pt, i) {
        var isProj = i >= hist.length;
        var bh = Math.max(3, (pt.v / maxV) * cH);
        var bx = PAD.l + i * barGap + (barGap - barW) / 2;
        var by = PAD.t + cH - bh;
        var valStr = pt.v >= 1000 ? '£'+(pt.v/1000).toFixed(1)+'bn' : '£'+pt.v+'m';
        if (isProj) {
          s += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="'+bh+'" fill="rgba(233,113,50,0.15)" stroke="#E97132" stroke-width="1.2" stroke-dasharray="4,2"/>';
        } else {
          s += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="'+bh+'" fill="#C05A18"/>';
          s += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="5" fill="#E97132"/>';
        }
        s += '<text x="'+(bx+barW/2)+'" y="'+(by-5)+'" font-family="Consolas,monospace" font-size="9" fill="'+(isProj?'rgba(233,113,50,0.7)':'rgba(255,255,255,0.7)')+'" text-anchor="middle">'+valStr+'</text>';
        s += '<text x="'+(bx+barW/2)+'" y="'+(PAD.t+cH+16)+'" font-family="Consolas,monospace" font-size="9" fill="'+(isProj?'rgba(255,255,255,0.22)':'rgba(255,255,255,0.4)')+'" text-anchor="middle">'+pt.yr+'</text>';
      });

      s += '</svg>';
      return s;
    }

    function buildDrillDown() {
      var d = OD[current];
      var flow = (FLOWS[current] || {})[drillKey];
      var exp = null;
      d.exports.forEach(function(e){ if (e.country === drillKey) exp = e; });

      /* Try live export nodes too — pct/val may be more current */
      if (!exp) {
        var liveNodes = _getExportNodes(current);
        if (liveNodes) liveNodes.forEach(function(n){ if (n.country === drillKey) exp = n; });
      }

      var F = 'font-family:Consolas,monospace;';

      if (!flow) {
        return '<div style="display:flex;flex-direction:column;height:100%;">' +
          '<div style="padding:8px 12px;border-bottom:1px solid #181818;flex-shrink:0;">' +
          '<button class="oweb-back" style="'+F+'font-size:9px;letter-spacing:.14em;padding:4px 12px;border:1px solid #2a2a2a;background:transparent;color:rgba(255,255,255,0.5);cursor:pointer;">← BACK</button></div>' +
          '<div style="padding:24px;'+F+'font-size:10px;color:#ffffff;letter-spacing:.1em;">DETAILED FLOW DATA NOT YET AVAILABLE FOR THIS MARKET</div></div>';
      }

      var histBars = flow.hist;
      var projBars = flow.proj || [];

      var tariffCol = flow.tariffCol || '#44cc64';
      var cagr3 = flow.cagr3; var cagr5 = flow.cagr5;
      var cagr3Col = (cagr3||'').charAt(0) === '-' ? '#e05050' : '#44cc64';
      var cagr5Col = (cagr5||'').charAt(0) === '-' ? '#e05050' : '#44cc64';
      var peak = histBars.reduce(function(m,p){return p.v>m.v?p:m;}, histBars[0]);
      var lastBar = histBars[histBars.length - 1] || {};
      var lastVal = (lastBar.v||0) >= 1000 ? '£'+((lastBar.v||0)/1000).toFixed(2)+'bn' : '£'+(lastBar.v||0)+'m';
      var lastYrLbl = String(lastBar.yr || '—');
      var _srcLabel = {scotland:'SWA OFFICIAL DATA',japan:'JAPAN CUSTOMS (MOFJ)',usa:'DISCUS OFFICIAL DATA',ireland:'INDUSTRY ESTIMATES'}[current]||'INDUSTRY ESTIMATES';
      var chartLbl = 'EXPORT VALUE — ' + _srcLabel + ' 2019–2025 · 2026 PROJECTED';

      var html = '<div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">';

      /* ── Row 1: Back + destination header ── */
      html += '<div style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid #181818;flex-shrink:0;background:#0d0d0d;">' +
        '<button class="oweb-back" style="'+F+'font-size:9px;letter-spacing:.14em;padding:4px 12px;border:1px solid #2a2a2a;background:transparent;color:rgba(255,255,255,0.5);cursor:pointer;white-space:nowrap;flex-shrink:0;">← BACK</button>' +
        '<span style="'+F+'font-size:11px;color:#E97132;font-weight:700;letter-spacing:.14em;">'+OD[current].label+'</span>' +
        '<span style="'+F+'font-size:11px;color:#3a3a3a;margin:0 2px;">→</span>' +
        '<span style="'+F+'font-size:11px;color:#ffffff;font-weight:700;letter-spacing:.14em;">'+drillKey.toUpperCase()+'</span>' +
        (exp?'<span style="'+F+'font-size:9px;color:rgba(255,255,255,0.5);margin-left:auto;white-space:nowrap;">'+exp.pct+'% OF EXPORTS · '+exp.val+'</span>':'') +
        '</div>';

      /* ── Row 2: Chart ── */
      html += '<div style="padding:10px 14px 6px;border-bottom:1px solid #181818;flex-shrink:0;">' +
        '<div style="'+F+'font-size:8px;letter-spacing:.2em;color:#444;margin-bottom:8px;">'+chartLbl+'</div>' +
        '<div style="height:130px;">'+buildBarChartSVG(histBars, projBars)+'</div>' +
        '</div>';

      /* ── Row 3: Stat tiles ── */
      html += '<div style="display:flex;border-bottom:1px solid #181818;flex-shrink:0;">';
      [
        {lbl:lastYrLbl+' VALUE', val:lastVal,                     col:'#E97132'},
        {lbl:'3-YR CAGR',        val:cagr3,                       col:cagr3Col},
        {lbl:'5-YR CAGR',        val:cagr5,                       col:cagr5Col},
        {lbl:'PEAK YEAR',        val:String(peak.yr||'—'),         col:'#4898d8'},
        {lbl:'TARIFF',           val:flow?(flow.tariffStatus||'—'):'—', col:tariffCol},
      ].forEach(function(t) {
        html += '<div style="flex:1;padding:10px 12px;border-right:1px solid #181818;min-width:0;">' +
          '<div style="'+F+'font-size:7.5px;letter-spacing:.16em;color:#444;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+t.lbl+'</div>' +
          '<div style="'+F+'font-size:17px;color:'+t.col+';font-weight:700;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+t.val+'</div>' +
          '</div>';
      });
      html += '</div>';

      /* ── Row 4: Bottom two-column detail ── */
      html += '<div style="flex:1;display:flex;overflow:hidden;min-height:0;">';

      /* Left: categories + tariff */
      html += '<div style="width:38%;border-right:1px solid #181818;display:flex;flex-direction:column;overflow-y:auto;">';
      if (flow && flow.cats && flow.cats.length) {
        html += '<div style="padding:12px 14px;border-bottom:1px solid #181818;">' +
          '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#444;margin-bottom:12px;">CATEGORY SPLIT</div>';
        flow.cats.forEach(function(c) {
          html += '<div style="margin-bottom:10px;">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">' +
            '<span style="'+F+'font-size:10px;color:#ffffff;">'+c.n+'</span>' +
            '<span style="'+F+'font-size:10px;color:#E97132;font-weight:700;">'+c.p+'%</span>' +
            '</div>' +
            '<div style="height:3px;background:#1a1a1a;border-radius:2px;">' +
            '<div style="height:3px;background:#E97132;width:'+c.p+'%;border-radius:2px;"></div>' +
            '</div></div>';
        });
        html += '</div>';
      }
      if (flow && flow.tariffStatus) {
        html += '<div style="padding:12px 14px;">' +
          '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#444;margin-bottom:8px;">TARIFF STATUS</div>' +
          '<div style="border-left:3px solid '+tariffCol+';padding:8px 12px;background:rgba(0,0,0,0.35);">' +
          '<div style="'+F+'font-size:12px;color:'+tariffCol+';font-weight:700;margin-bottom:6px;">'+flow.tariffStatus+'</div>' +
          '<div style="'+F+'font-size:9.5px;color:#ffffff;line-height:1.65;">'+flow.tariff+'</div>' +
          '</div></div>';
      }
      html += '</div>'; /* end left */

      /* Right: note + drivers */
      html += '<div style="flex:1;overflow-y:auto;padding:12px 14px;">';
      if (flow && flow.note) {
        html += '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#444;margin-bottom:8px;">MARKET NOTE</div>' +
          '<div style="'+F+'font-size:10.5px;color:#ffffff;line-height:1.75;margin-bottom:18px;">'+flow.note+'</div>';
      }
      if (flow && flow.drivers && flow.drivers.length) {
        html += '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#444;margin-bottom:10px;">GROWTH DRIVERS</div>';
        flow.drivers.forEach(function(dr) {
          html += '<div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start;">' +
            '<span style="'+F+'font-size:10px;color:#E97132;flex-shrink:0;margin-top:2px;">▪</span>' +
            '<span style="'+F+'font-size:10.5px;color:#ffffff;line-height:1.6;">'+dr+'</span>' +
            '</div>';
        });
      }
      html += '</div>'; /* end right */

      html += '</div>'; /* end row 4 */
      html += '</div>'; /* end outer */
      return html;
    }



    function buildMarketData() {
      var F = 'font-family:Consolas,monospace;';
      var m = OD[current].macro;
      var d = OD[current];

      var RADAR_DATA = {
        scotland: [100, 29, 29, 72, 82, 95],
        japan:    [12, 100, 100, 85, 18, 62],
        usa:      [29,  43,  36, 48, 88, 70],
        ireland:  [12,  54,  46, 33, 70, 55],
      };
      var RADAR_LABELS = ['VOLUME','CAGR','AVG PRICE','PREMIUM','SUPPLY','REACH'];
      var RADAR_DESC = [
        'Total export value',
        '5-year growth rate',
        'Avg price per bottle',
        'Rare & limited share',
        'Aging stock health',
        'Global market reach',
      ];
      var ORIGIN_COL = { scotland:'#E97132', japan:'#4898d8', usa:'#44cc64', ireland:'#b878d8' };
      var nAxes = 6;
      var RW = 460, RH = 420, rcx = 224, rcy = 208, rR = 165;

      function rPt(val, ai) {
        var ang = (ai / nAxes) * 2 * Math.PI - Math.PI / 2;
        return { x: rcx + (val / 100) * rR * Math.cos(ang), y: rcy + (val / 100) * rR * Math.sin(ang) };
      }
      function rPoly(vals) {
        var pts = [];
        for (var ri = 0; ri < nAxes; ri++) { var rp = rPt(vals[ri], ri); pts.push(rp.x.toFixed(1)+','+rp.y.toFixed(1)); }
        return pts.join(' ');
      }

      var curCol = ORIGIN_COL[current];
      var curVals = RADAR_DATA[current];

      var rs = '<svg class="oweb-radar-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+RW+' '+RH+'" style="width:100%;height:auto;display:block;">';
      /* grid rings */
      for (var gi = 1; gi <= 4; gi++) {
        rs += '<polygon points="'+rPoly([gi*25,gi*25,gi*25,gi*25,gi*25,gi*25])+'" fill="none" stroke="#1e1e1e" stroke-width="1"/>';
      }
      /* spokes */
      for (var ski = 0; ski < nAxes; ski++) {
        var sep = rPt(100, ski);
        rs += '<line x1="'+rcx+'" y1="'+rcy+'" x2="'+sep.x.toFixed(1)+'" y2="'+sep.y.toFixed(1)+'" stroke="#222" stroke-width="1"/>';
      }
      /* ring ticks — white, small */
      [50, 100].forEach(function(pct) {
        var tp = rPt(pct, 0);
        rs += '<text x="'+(rcx+3)+'" y="'+tp.y.toFixed(1)+'" '+F+' font-size="8" fill="rgba(255,255,255,0.25)">'+pct+'</text>';
      });
      /* axis labels — pure white */
      for (var ali = 0; ali < nAxes; ali++) {
        var alp = rPt(115, ali);
        var anch = alp.x < rcx - 5 ? 'end' : alp.x > rcx + 5 ? 'start' : 'middle';
        rs += '<text x="'+alp.x.toFixed(1)+'" y="'+(alp.y+4).toFixed(1)+'" '+F+' font-size="9.5" fill="#ffffff" text-anchor="'+anch+'" letter-spacing="0.14em" font-weight="700">'+RADAR_LABELS[ali]+'</text>';
      }
      /* ghost polygons */
      Object.keys(RADAR_DATA).forEach(function(key) {
        if (key === current) return;
        var gc = ORIGIN_COL[key];
        rs += '<polygon class="radar-poly" data-origin="'+key+'" points="'+rPoly(RADAR_DATA[key])+'" fill="'+gc+'" fill-opacity="0.06" stroke="'+gc+'" stroke-width="1" stroke-opacity="0.28"/>';
      });
      /* current polygon */
      rs += '<polygon class="radar-poly" data-origin="'+current+'" points="'+rPoly(curVals)+'" fill="'+curCol+'" fill-opacity="0.2" stroke="'+curCol+'" stroke-width="2.2"/>';
      /* axis dots */
      for (var ddi = 0; ddi < nAxes; ddi++) {
        var ddp = rPt(curVals[ddi], ddi);
        rs += '<circle cx="'+ddp.x.toFixed(1)+'" cy="'+ddp.y.toFixed(1)+'" r="4" fill="'+curCol+'" stroke="#0a0a0a" stroke-width="1.5"/>';
      }
      rs += '</svg>';

      /* Radar explanation strip */
      var radarExpl = '<div style="padding:6px 10px 4px;border-top:1px solid #181818;border-bottom:1px solid #181818;background:#0b0b0b;">' +
        '<div style="'+F+'font-size:7.5px;color:#ffffff;letter-spacing:.04em;line-height:1.7;">' +
        '<span style="color:'+curCol+';font-weight:700;">MARKET STRENGTH INDEX</span> — Each axis scores 0–100 relative to all origins. ' +
        '<span style="color:#ffffff;">VOLUME</span> = total exports · ' +
        '<span style="color:#ffffff;">CAGR</span> = 5yr growth · ' +
        '<span style="color:#ffffff;">AVG PRICE</span> = per bottle · ' +
        '<span style="color:#ffffff;">PREMIUM</span> = rare/limited share · ' +
        '<span style="color:#ffffff;">SUPPLY</span> = aging stock health · ' +
        '<span style="color:#ffffff;">REACH</span> = global market breadth' +
        '</div>' +
        '<div style="'+F+'font-size:7px;color:rgba(255,255,255,0.4);margin-top:3px;letter-spacing:.04em;">Hover the origin labels below to spotlight each country\'s profile</div>' +
        '</div>';

      /* Radar legend — HTML rows */
      var radarLeg = '<div style="display:flex;flex-shrink:0;border-top:1px solid #181818;">';
      Object.keys(ORIGIN_COL).forEach(function(key) {
        var lc = ORIGIN_COL[key]; var isAct = key === current;
        radarLeg += '<div class="radar-leg" data-origin="'+key+'" style="flex:1;display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;border-right:1px solid #141414;border-bottom:3px solid '+(isAct?lc:'transparent')+';background:'+(isAct?'rgba(255,255,255,0.02)':'transparent')+';transition:background .1s;">' +
          '<div style="width:10px;height:10px;background:'+lc+';opacity:'+(isAct?1:0.4)+';flex-shrink:0;"></div>' +
          '<span style="'+F+'font-size:10px;color:#ffffff;font-weight:'+(isAct?700:400)+';letter-spacing:.12em;opacity:'+(isAct?1:0.45)+';border-bottom:'+(isAct?'1px solid '+lc:'none')+'">'+OD[key].label+'</span>' +
          '</div>';
      });
      radarLeg += '</div>';

      /* ── Donut chart — use live UN Comtrade data when available ── */
      var liveLabel = '';
      var exps = d.exports;
      var _le = _liveExp[current];
      if (_le && _le.destinations && _le.destinations.length) {
        exps = _le.destinations.slice(0, 10).map(function(dest) {
          return { country: dest.country, pct: dest.pct, yoy: dest.yoy || 0 };
        });
        liveLabel = ' · LIVE ' + _le.period + ' DATA';
      }
      var totalPct = 0;
      for (var ei = 0; ei < exps.length; ei++) totalPct += (exps[ei].pct || 0);
      var expsFull = exps.slice();
      if (totalPct < 99) expsFull.push({country:'Other', pct: 100 - totalPct, yoy: 0});

      function sliceCol(yoy) {
        return yoy >= 20 ? '#44cc64' : yoy >= 10 ? '#2ea84a' : yoy >= 5 ? '#3a7ccc' : '#2a2a2a';
      }

      var dcx = 128, dcy = 128, outerR = 112, innerR = 62, DSZ = 256;
      var dnutSVG = '<svg class="oweb-donut-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+DSZ+' '+DSZ+'" style="width:100%;max-width:260px;height:auto;display:block;">';
      var sAng = -Math.PI / 2;
      for (var si = 0; si < expsFull.length; si++) {
        var es = expsFull[si];
        var swp = (es.pct / 100) * 2 * Math.PI;
        var mAng = sAng + swp / 2;
        var eAng = sAng + swp;
        var osx=dcx+outerR*Math.cos(sAng), osy=dcy+outerR*Math.sin(sAng);
        var oex=dcx+outerR*Math.cos(eAng), oey=dcy+outerR*Math.sin(eAng);
        var iex=dcx+innerR*Math.cos(eAng), iey=dcy+innerR*Math.sin(eAng);
        var isx=dcx+innerR*Math.cos(sAng), isy=dcy+innerR*Math.sin(sAng);
        var lg = swp > Math.PI ? 1 : 0;
        var sc = es.country === 'Other' ? '#1a1a1a' : sliceCol(es.yoy);
        dnutSVG += '<path class="donut-slice" data-idx="'+si+'" data-midang="'+mAng.toFixed(4)+'" data-label="'+es.country+'" data-pct="'+es.pct+'" data-yoy="'+(es.yoy||0)+'" data-col="'+sc+'" d="M '+osx.toFixed(1)+' '+osy.toFixed(1)+' A '+outerR+' '+outerR+' 0 '+lg+' 1 '+oex.toFixed(1)+' '+oey.toFixed(1)+' L '+iex.toFixed(1)+' '+iey.toFixed(1)+' A '+innerR+' '+innerR+' 0 '+lg+' 0 '+isx.toFixed(1)+' '+isy.toFixed(1)+' Z" fill="'+sc+'" stroke="#0a0a0a" stroke-width="2" style="cursor:pointer;transition:opacity .12s;"/>';
        sAng = eAng;
      }
      dnutSVG += '<text x="'+dcx+'" y="'+(dcy-10)+'" '+F+' font-size="24" fill="'+curCol+'" font-weight="700" text-anchor="middle">'+expsFull.length+'</text>';
      dnutSVG += '<text x="'+dcx+'" y="'+(dcy+9)+'" '+F+' font-size="8" fill="#ffffff" text-anchor="middle" letter-spacing="0.16em">MARKETS</text>';
      dnutSVG += '</svg>';

      /* Donut explanation strip — mirrors radarExpl */
      var liveSource = _le
        ? '<span style="color:#44cc64;"> · UN Comtrade HS 220830'+liveLabel+'</span>'
        : '<span style="color:rgba(255,255,255,0.3);"> · loading live data…</span>';
      var donutExpl = '<div style="padding:6px 10px 4px;border-top:1px solid #181818;border-bottom:1px solid #181818;background:#0b0b0b;flex-shrink:0;">' +
        '<div style="'+F+'font-size:7.5px;color:#ffffff;letter-spacing:.04em;line-height:1.7;">' +
        '<span style="color:'+curCol+';font-weight:700;">DESTINATION MIX</span> — Slice size = % of total exports. ' +
        'Colour = YoY growth: <span style="color:#44cc64;">green ≥20%</span> · <span style="color:#2ea84a;">mid 10–20%</span> · <span style="color:#3a7ccc;">blue 5–10%</span>' +
        liveSource +
        '</div>' +
        '<div style="'+F+'font-size:7px;color:rgba(255,255,255,0.4);margin-top:3px;letter-spacing:.04em;">Hover slice or row to highlight</div>' +
        '</div>';

      /* Donut legend HTML */
      var dnutLeg = '<div style="flex:1;overflow-y:auto;padding:0 10px 4px 6px;scrollbar-width:thin;scrollbar-color:#1e1e1e transparent;">';
      for (var ll = 0; ll < expsFull.length; ll++) {
        var le = expsFull[ll];
        var lec = le.country === 'Other' ? '#444' : sliceCol(le.yoy);
        var yoyStr = le.yoy ? (le.yoy >= 0 ? '+' : '') + le.yoy + '% YoY' : '';
        var barW = Math.min(le.pct * 2, 64);
        dnutLeg += '<div class="donut-leg-row" data-idx="'+ll+'" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #111;cursor:pointer;">' +
          '<div style="width:5px;height:24px;background:'+lec+';flex-shrink:0;"></div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="'+F+'font-size:10px;color:#ffffff;font-weight:700;white-space:nowrap;">'+le.country+'</div>' +
            (yoyStr ? '<div style="'+F+'font-size:8px;color:'+lec+';">'+yoyStr+'</div>' : '<div style="'+F+'font-size:8px;color:rgba(255,255,255,0.3);">—</div>') +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;">' +
            '<div style="'+F+'font-size:15px;color:#ffffff;font-weight:700;line-height:1;">'+le.pct+'<span style="'+F+'font-size:9px;color:rgba(255,255,255,0.5);">%</span></div>' +
            '<div style="height:3px;background:'+lec+';width:'+barW+'px;margin-top:3px;margin-left:auto;"></div>' +
          '</div>' +
        '</div>';
      }
      dnutLeg += '</div>';

      /* ── Stat strip — use SWA/official verified totals where available ── */
      /* UN Comtrade reporter 826 (UK) overstates Scotland figures; prefer SWA. */
      var _VERIFIED_TOTALS = {
        scotland: { val:'£5.3bn', sub:'SWA official 2025 · -1.9% YoY' },
        japan:    { val:'£228m',  sub:'Japan MoF customs 2024 · ¥43.7bn · -10.6% YoY' },
        usa:      { val:'£1.03bn',sub:'DISCUS official 2024 · -5.4% YoY' },
        ireland:  { val:'~£855m', sub:'Drinks Ireland est. 2024' },
      };
      var mLive = m;
      var _vt = _VERIFIED_TOTALS[current];
      if (_vt) {
        mLive = JSON.parse(JSON.stringify(m));
        mLive.exportVal = { lbl: 'TOTAL EXPORTS', val: _vt.val, sub: _vt.sub };
      } else if (_le && _le.totalGBP) {
        var _gbp = _le.totalGBP;
        var _gbpStr = _gbp >= 1000000000 ? '£' + (_gbp/1000000000).toFixed(1) + 'bn' : '£' + Math.round(_gbp/1000000) + 'm';
        var _yoyStr = _le.totalYoy ? (_le.totalYoy >= 0 ? '+' : '') + _le.totalYoy + '%' : '';
        mLive = JSON.parse(JSON.stringify(m));
        mLive.exportVal = {
          lbl: 'TOTAL EXPORTS',
          val: _gbpStr,
          sub: 'UN Comtrade ' + _le.period + (_yoyStr ? ' · ' + _yoyStr + ' YoY' : ''),
        };
      }
      var statKeys = Object.keys(mLive);
      var statHtml = '<div style="display:flex;flex-shrink:0;border-top:2px solid #181818;overflow-x:auto;scrollbar-width:none;">';
      statKeys.forEach(function(k) {
        var tile = mLive[k];
        var vc = (tile.val === 'CRITICAL' || tile.val === 'STEEP UP' || tile.val === 'HIGH') ? '#e05050'
          : tile.val === 'MEDIUM' ? '#E97132'
          : (tile.val === 'STRONG' || tile.val === 'ZERO' || tile.val === 'PAUSED' || tile.val.charAt(0) === '+') ? '#44cc64'
          : '#E97132';
        statHtml += '<div style="flex:0 0 auto;min-width:140px;padding:9px 14px;border-right:1px solid #111;background:#080808;">' +
          '<div style="'+F+'font-size:6.5px;letter-spacing:.22em;color:#ffffff;text-transform:uppercase;margin-bottom:5px;white-space:nowrap;">'+tile.lbl+'</div>' +
          '<div style="'+F+'font-size:18px;color:'+vc+';font-weight:700;letter-spacing:.04em;line-height:1;white-space:nowrap;">'+tile.val+'</div>' +
          '<div style="'+F+'font-size:7px;color:#ffffff;margin-top:4px;white-space:nowrap;">'+tile.sub+'</div>' +
          '</div>';
      });
      statHtml += '</div>';

      /* Tooltip overlay */
      var ttip = '<div class="oweb-tooltip" style="display:none;position:absolute;background:#111;border:1px solid #222;border-top:2px solid '+curCol+';padding:8px 14px;pointer-events:none;z-index:200;min-width:120px;box-shadow:0 8px 24px rgba(0,0,0,.8);top:50px;right:12px;"></div>';

      return '<div style="display:flex;flex-direction:column;height:100%;position:relative;">' +
        '<div style="display:flex;flex:1;min-height:0;">' +
          '<div style="flex:0 0 54%;border-right:1px solid #181818;display:flex;flex-direction:column;overflow:hidden;">' +
            '<div style="flex:1;overflow:hidden;padding:8px 10px 2px;">'+rs+'</div>' +
            radarExpl +
            radarLeg +
          '</div>' +
          '<div style="flex:0 0 46%;display:flex;flex-direction:column;overflow:hidden;">' +
            '<div style="display:flex;justify-content:center;align-items:center;padding:6px 10px 2px;flex-shrink:0;">'+dnutSVG+'</div>' +
            donutExpl +
            dnutLeg +
          '</div>' +
        '</div>' +
        statHtml +
        ttip +
        '</div>';
    }


    function buildUI() {
      var d = OD[current];
      var countries = Object.keys(OD);
      var modes = [
        {k:'supply',  lbl:'SUPPLY WEB'},
        {k:'exports', lbl:'EXPORT FLOWS'},
        {k:'market',  lbl:'MARKET DATA'},
      ];

      /* Top bar: country + mode selectors */
      var topBar = '<div style="display:flex;align-items:center;gap:0;padding:0;border-bottom:1px solid #181818;background:#0c0c0c;flex-shrink:0;flex-wrap:wrap;">' +
        '<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;border-right:1px solid #181818;">' +
        '<span style="font-family:Consolas,monospace;font-size:8px;color:#ffffff;letter-spacing:.2em;">ORIGIN</span>' +
        countries.map(function(k) {
          var a = k === current;
          return '<button class="oweb-c" data-k="' + k + '" style="font-family:Consolas,monospace;font-size:10px;letter-spacing:.15em;padding:5px 12px;border:1px solid '+(a?'#E97132':'#222')+';background:'+(a?'rgba(233,113,50,.12)':'transparent')+';color:'+(a?'#E97132':'#ffffff')+';cursor:pointer;">' + OD[k].label + '</button>';
        }).join('') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:0;padding:0 10px;">' +
        modes.map(function(m2) {
          var a = m2.k === mode;
          return '<button class="oweb-m" data-m="' + m2.k + '" style="font-family:Consolas,monospace;font-size:10px;letter-spacing:.15em;padding:9px 16px;border:none;border-bottom:2px solid '+(a?'#E97132':'transparent')+';background:transparent;color:'+(a?'#E97132':'#ffffff')+';cursor:pointer;">' + m2.lbl + '</button>';
        }).join('') +
        '</div>' +
        '<div style="margin-left:auto;display:flex;gap:4px;align-items:center;padding-right:10px;flex-wrap:wrap;">' +
        d.regions.map(function(r) {
          return '<span style="font-family:Consolas,monospace;font-size:7px;letter-spacing:.08em;padding:2px 6px;border:1px solid #1a1a1a;color:#ffffff;">'+r+'</span>';
        }).join('') +
        '</div></div>';

      var content;
      if (mode === 'exports' && drillKey) {
        content = '<div style="flex:1;overflow:auto;">'+buildDrillDown()+'</div>';
      } else if (mode === 'supply') {
        var supplyNote = '<div style="font-family:Consolas,monospace;font-size:7px;color:rgba(255,255,255,0.28);padding:4px 10px;text-align:right;letter-spacing:.06em;">Auction market share — industry estimates · No public API available</div>';
        content = '<div style="flex:1;overflow:auto;padding:2px 4px 4px;display:flex;flex-direction:column;">'+buildWebSVG(d.markets, 'AUCTION MARKETS', 'rgba(68,144,220,0.3)')+supplyNote+'</div>';
      } else if (mode === 'exports') {
        var liveNodes = _getExportNodes(current) || d.exports;
        content = '<div style="flex:1;overflow:auto;padding:2px 4px 4px;">'+buildWebSVG(liveNodes, 'EXPORT MARKETS', 'rgba(160,100,220,0.3)')+'</div>';
      } else {
        content = '<div style="flex:1;overflow:auto;">'+buildMarketData()+'</div>';
      }

      /* Set styles individually to preserve zoom applied by the widget's +/- buttons */
      body.style.display = 'flex';
      body.style.flexDirection = 'column';
      body.style.height = '100%';
      body.style.overflow = 'auto';
      body.style.padding = '0';
      body.style.background = '#0a0a0a';
      body.innerHTML = topBar + content;

      /* Country + mode selector listeners */
      body.querySelectorAll('.oweb-c').forEach(function(btn) {
        btn.addEventListener('click', function() { current = btn.dataset.k; drillKey = null; _drillM49 = null; fetchLiveData(current); buildUI(); });
        btn.addEventListener('mouseenter', function() { if (btn.dataset.k!==current){btn.style.color='#ffffff';btn.style.borderColor='#3a3a3a';} });
        btn.addEventListener('mouseleave', function() { if (btn.dataset.k!==current){btn.style.color='#ffffff';btn.style.borderColor='#222';} });
      });
      body.querySelectorAll('.oweb-m').forEach(function(btn) {
        btn.addEventListener('click', function() { mode = btn.dataset.m; drillKey = null; _drillM49 = null; buildUI(); });
        btn.addEventListener('mouseenter', function() { if (btn.dataset.m!==mode) btn.style.color='#ffffff'; });
        btn.addEventListener('mouseleave', function() { if (btn.dataset.m!==mode) btn.style.color='#ffffff'; });
      });

      /* Export flow: click right nodes for drill-down */
      if (mode === 'exports' && !drillKey) {
        body.querySelectorAll('rect[data-dest]').forEach(function(r) {
          var dest = r.getAttribute('data-dest');
          var m49attr = parseInt(r.getAttribute('data-m49') || '0') || null;
          var hasFlow = !!(FLOWS[current] && FLOWS[current][dest]);
          if (!hasFlow && !m49attr) return;
          r.addEventListener('click', function() {
            drillKey = dest;
            _drillM49 = m49attr || _getDestM49(current, dest);
            buildUI();
          });
          r.addEventListener('mouseenter', function() { r.setAttribute('fill', 'rgba(30,55,100,0.95)'); });
          r.addEventListener('mouseleave', function() { r.setAttribute('fill', r.getAttribute('data-origfill') || 'rgba(14,28,60,0.9)'); });
        });
      }

      /* Back button */
      var backBtn = body.querySelector('.oweb-back');
      if (backBtn) backBtn.addEventListener('click', function() { drillKey = null; _drillM49 = null; buildUI(); });

      /* ── Market data interactivity ── */
      if (mode === 'market') {
        var mTip = body.querySelector('.oweb-tooltip');
        var allPolys = body.querySelectorAll('.radar-poly');
        var allSlices = body.querySelectorAll('.donut-slice');

        /* Radar legend: hover spotlights that origin polygon */
        body.querySelectorAll('.radar-leg').forEach(function(leg) {
          var orig = leg.dataset.origin;
          leg.addEventListener('mouseenter', function() {
            leg.style.background = 'rgba(255,255,255,0.04)';
            allPolys.forEach(function(p) {
              var isFocus = p.dataset.origin === orig;
              p.setAttribute('fill-opacity', isFocus ? 0.3 : 0.02);
              p.setAttribute('stroke-opacity', isFocus ? 1 : 0.08);
              p.setAttribute('stroke-width', isFocus ? 2.8 : 0.6);
            });
          });
          leg.addEventListener('mouseleave', function() {
            leg.style.background = orig === current ? 'rgba(255,255,255,0.02)' : 'transparent';
            allPolys.forEach(function(p) {
              var isCur = p.dataset.origin === current;
              p.setAttribute('fill-opacity', isCur ? 0.2 : 0.06);
              p.setAttribute('stroke-opacity', isCur ? 1 : 0.28);
              p.setAttribute('stroke-width', isCur ? 2.2 : 1);
            });
          });
        });

        /* Donut: hover slice expands outward + tooltip */
        allSlices.forEach(function(path) {
          var mAng = parseFloat(path.dataset.midang);
          var PUSH = 9;
          var tx = (Math.cos(mAng) * PUSH).toFixed(2);
          var ty = (Math.sin(mAng) * PUSH).toFixed(2);
          path.addEventListener('mouseenter', function() {
            path.setAttribute('transform', 'translate('+tx+','+ty+')');
            path.setAttribute('stroke', '#ffffff');
            path.setAttribute('stroke-width', '2.5');
            allSlices.forEach(function(s) { if (s !== path) s.style.opacity = '0.35'; });
            if (mTip) {
              var yoy = parseInt(path.dataset.yoy, 10);
              var yc = yoy >= 20 ? '#44cc64' : yoy >= 10 ? '#2ea84a' : yoy >= 5 ? '#3a7ccc' : '#888';
              var ys = yoy ? (yoy >= 0 ? '+' : '') + yoy + '% YoY' : '—';
              mTip.innerHTML = '<div style="font-family:Consolas,monospace;font-size:8px;color:#E97132;letter-spacing:.16em;margin-bottom:5px;">'+path.dataset.label.toUpperCase()+'</div>' +
                '<div style="font-family:Consolas,monospace;font-size:22px;color:#fff;font-weight:700;line-height:1;">'+path.dataset.pct+'<span style="font-size:12px;">%</span></div>' +
                '<div style="font-family:Consolas,monospace;font-size:11px;color:'+yc+';margin-top:3px;">'+ys+'</div>';
              mTip.style.display = 'block';
            }
          });
          path.addEventListener('mouseleave', function() {
            path.setAttribute('transform', '');
            path.setAttribute('stroke', '#0a0a0a');
            path.setAttribute('stroke-width', '2');
            allSlices.forEach(function(s) { s.style.opacity = '1'; });
            if (mTip) mTip.style.display = 'none';
          });
        });

        /* Donut legend rows: hover highlights corresponding slice */
        body.querySelectorAll('.donut-leg-row').forEach(function(row) {
          var idx = parseInt(row.dataset.idx, 10);
          var slice = body.querySelector('.donut-slice[data-idx="'+idx+'"]');
          row.addEventListener('mouseenter', function() {
            row.style.background = 'rgba(255,255,255,0.03)';
            if (slice) { slice.setAttribute('stroke', '#fff'); slice.setAttribute('stroke-width', '2.8'); }
            allSlices.forEach(function(s) { if (s !== slice) s.style.opacity = '0.3'; });
          });
          row.addEventListener('mouseleave', function() {
            row.style.background = '';
            if (slice) { slice.setAttribute('stroke', '#0a0a0a'); slice.setAttribute('stroke-width', '2'); }
            allSlices.forEach(function(s) { s.style.opacity = '1'; });
          });
        });
      }
    }

    buildUI();
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
