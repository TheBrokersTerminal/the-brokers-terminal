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
  var _currentTab = 'terminal'; /* tracks active page for per-page widget visibility */
  window._sharedZ = window._sharedZ || 1000;
  /* Hard ceiling keeps widgets below topbar (10000) and ticker (9999) */
  function _nextZ() { window._sharedZ = Math.min(window._sharedZ + 1, 8000); return window._sharedZ; }

  var FINNHUB_KEY = 'da6p77hr01qqqkkgl7b0da6p77hr01qqqkkgl7bg';


  /* ── DEFAULT STARTER LAYOUT ── */
  var DEFAULT_LAYOUT = [
    {id:'w-news',    type:'news',    x:20,  y:16, w:400, h:500, data:{}},
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
        _currentTab = tab;
        /* Show only widgets that belong to this page */
        Object.values(_widgets).forEach(function (w) {
          var widgetPage = w.cfg.page || 'terminal';
          w.el.style.display = widgetPage === tab ? '' : 'none';
        });
        /* Canvas: always visible — overlay mode on non-terminal tabs so widgets persist */
        var cw = document.getElementById('tbc-canvas-wrap');
        if (cw) {
          cw.style.display = 'block';
          if (tab === 'terminal') {
            cw.classList.remove('canvas-overlay');
          } else {
            cw.classList.add('canvas-overlay');
          }
        }
        var vault = document.getElementById('vault-section');
        if (vault) vault.style.display = tab === 'vault' ? 'block' : 'none';
        /* Hide intel popouts (body-level) when leaving terminal; restore when returning */
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
        /* Ticker: only visible on terminal tab, respecting user\'s hidden preference */
        var ticker = document.getElementById('content-ticker');
        var restoreBtn = document.getElementById('ttb-ticker-restore');
        if (ticker) {
          if (tab === 'terminal') {
            /* Restore to user\'s preference when returning to terminal */
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
        {type:'watchlist',     icon:'◈', lbl:'MY WATCHLIST',        sub:'Pin tickers with live prices and day change'},
        {type:'sector_heatmap',icon:'▩', lbl:'SECTOR HEATMAP',      sub:'US equity sectors — day% with heatmap colouring'},
      ]},
      { cat: 'INTELLIGENCE', items: [
        {type:'call_signal',      icon:'▲', lbl:'CALL SIGNAL',         sub:'Daily macro signal + live conversation openers'},
        {type:'obj_handler',      icon:'◐', lbl:'OBJECTION HANDLER',  sub:'Searchable AVR scripts — gold & whisky objections'},
        {type:'analogy_lib',      icon:'◎', lbl:'ANALOGY LIBRARY',    sub:'500+ tactics: Cialdini · Voss · Ariely · Kahneman · Rackham · Fogg · Milgram — full arsenal'},
        {type:'scenario_mod',     icon:'◩', lbl:'SCENARIO MODELLER',  sub:'Build a macro scenario — get gold target range and call pitch'},
        {type:'gold_intel',      icon:'◈', lbl:'GOLD INTELLIGENCE',  sub:'Central bank buying, COT positioning, demand & supply data'},
        {type:'macro_intel',      icon:'◧', lbl:'MACRO INTELLIGENCE',  sub:'Professor + sales engine — 5 macro themes'},
        {type:'business_cycle',   icon:'◑', lbl:'MACRO DASHBOARD',      sub:'Live FRED data — 5 tabs: Cycle · Inflation · Liquidity · Rates · Labour'},
        {type:'macro_monitor',    icon:'▦', lbl:'MACRO MONITOR',       sub:'Cross-asset heatmap — 14 series WTD/QTD/YTD/1Y'},
        {type:'origin_web',       icon:'◎', lbl:'ORIGIN WEB',          sub:'Distillery supply network — countries, auction markets'},
        {type:'global_map',       icon:'◉', lbl:'GLOBAL MAP',          sub:'Macro rates, inflation, gold production, whisky regions'},
      ]},
      { cat: 'WHISKY', items: [
        {type:'whisky_lookup', icon:'▣', lbl:'WHISKY TERMINAL',     sub:'Live auction & retail prices — powered by WhiskyStats'},
        {type:'cask_calc',     icon:'◫', lbl:'CASK CALCULATOR',     sub:'Cask value, bottle yield, angel\'s share & ROI'},
      ]},
      { cat: 'NEWS & DATA', items: [
        {type:'news',          icon:'◈', lbl:'LIVE HEADLINES',      sub:'Latest news from all feeds'},
        {type:'live_tv',       icon:'▶', lbl:'NEWS TV',             sub:'Live streaming — Al Jazeera · Sky · CNBC · Bloomberg'},
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
          w: type === 'notes' ? 280 : type === 'news' ? 400 : type === 'live_tv' ? 520 : type === 'chat' ? 480 : type === 'calendar' || type === 'econ_calendar' ? 480 : type === 'call_signal' ? 380 : type === 'obj_handler' ? 440 : type === 'analogy_lib' ? 480 : type === 'gold_intel' ? 540 : type === 'scenario_mod' ? 520 : type === 'macro_intel' ? 580 : type === 'business_cycle' ? 900 : type === 'macro_monitor' ? 720 : type === 'sector_heatmap' ? 620 : type === 'watchlist' ? 320 : type === 'global_map' ? 760 : type === 'origin_web' ? 920 : type === 'cask_calc' ? 720 : 340,
          h: type === 'news' || type === 'notes' ? 480 : type === 'live_tv' ? 380 : type === 'chat' ? 440 : type === 'calendar' ? 380 : type === 'econ_calendar' ? 540 : type === 'call_signal' ? 480 : type === 'obj_handler' ? 560 : type === 'analogy_lib' ? 600 : type === 'gold_intel' ? 700 : type === 'scenario_mod' ? 660 : type === 'macro_intel' ? 500 : type === 'business_cycle' ? 720 : type === 'macro_monitor' ? 480 : type === 'sector_heatmap' ? 380 : type === 'watchlist' ? 420 : type === 'global_map' ? 480 : type === 'origin_web' ? 600 : type === 'cask_calc' ? 620 : 240,
          data: {},
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
    /* Stamp the page this widget belongs to (preserve saved page on layout restore) */
    if (!cfg.page) cfg.page = _currentTab;
    /* Clamp saved position — just prevent negatives */
    cfg.x = Math.max(0, cfg.x || 0);
    cfg.y = Math.max(0, cfg.y || 0);

    var el = document.createElement('div');
    el.className = 'tbc-widget';
    el.id = cfg.id;
    el.style.cssText = 'left:' + cfg.x + 'px;top:' + cfg.y + 'px;width:' + cfg.w + 'px;height:' + cfg.h + 'px;z-index:' + (_nextZ()) + ';';

    var icons = {news:'◈', live_tv:'▶', reports:'▣', notes:'✎', intel:'◆', chat:'◎', calendar:'◷', notes_inbox:'✉', report_viewer:'▤', econ_calendar:'◫', macro_intel:'◧', business_cycle:'◑', macro_monitor:'▦', sector_heatmap:'▩', watchlist:'◈', global_map:'◉', origin_web:'◎', call_signal:'▲', obj_handler:'◐', analogy_lib:'◎', scenario_mod:'◩', gold_intel:'◈'};
    var titles = {news:'LIVE HEADLINES', live_tv:'NEWS TV', reports:'VAULT · LATEST', notes:'MY NOTES', intel:'BROKERS INTEL', chat:'FIRM CHAT', calendar:'CALENDAR', notes_inbox:'FIRM NOTES', report_viewer:'REPORT', econ_calendar:'ECONOMIC CALENDAR', macro_intel:'MACRO INTELLIGENCE', business_cycle:'MACRO DASHBOARD', macro_monitor:'MACRO MONITOR', sector_heatmap:'SECTOR HEATMAP', watchlist:'MY WATCHLIST', global_map:'GLOBAL MAP', whisky_lookup:'WHISKY TERMINAL', cask_calc:'CASK CALCULATOR', origin_web:'ORIGIN WEB', call_signal:'CALL SIGNAL', obj_handler:'OBJECTION HANDLER', analogy_lib:'ANALOGY LIBRARY', scenario_mod:'SCENARIO MODELLER', gold_intel:'GOLD INTELLIGENCE'};

    el.innerHTML =
      '<div class="tbc-widget-bar">' +
        '<span class="tbc-widget-icon">' + (icons[cfg.type]||'◆') + '</span>' +
        '<span class="tbc-widget-title" id="' + cfg.id + '-title">' + (titles[cfg.type]||cfg.type.toUpperCase()) + '</span>' +
        '<div class="tbc-widget-actions">' +
          '<button class="tbc-widget-btn zoom-out" title="Zoom out">−</button>' +
          '<button class="tbc-widget-btn zoom-in"  title="Zoom in">+</button>' +
          '<button class="tbc-widget-btn group-out" title="Pop out & group with other panels">⊞</button>' +
          '<button class="tbc-widget-btn refresh" title="Refresh" data-wid="' + cfg.id + '">↺</button>' +
          '<button class="tbc-widget-btn minimize" title="Minimise to dock">─</button>' +
          '<button class="tbc-widget-btn fullscreen" title="Full screen">⛶</button>' +
          '<button class="tbc-widget-btn close" title="Remove" data-wid="' + cfg.id + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="tbc-widget-body" id="' + cfg.id + '-body"><div class="tbw-loading">LOADING…</div></div>';

    _canvas.appendChild(el);
    _widgets[cfg.id] = {el: el, cfg: cfg};

    el.addEventListener('mousedown', function () {
      el.style.zIndex = _nextZ();
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
      /* Re-render tile canvases at the new effective zoom scale */
      setTimeout(function() {
        bodyEl.querySelectorAll('.bc-tile-canvas').forEach(function(c) {
          c.dispatchEvent(new CustomEvent('bc-redraw'));
        });
      }, 0);
    }
    applyZoom(_zoom);
    el.querySelector('.tbc-widget-btn.zoom-in').addEventListener('click', function () { applyZoom(_zoom + 0.1); });
    el.querySelector('.tbc-widget-btn.zoom-out').addEventListener('click', function () { applyZoom(_zoom - 0.1); });

    /* Minimize button — collapses widget to dock chip */
    var _minimized = false;
    var _savedStyleBeforeMin = null;
    el.querySelector('.tbc-widget-btn.minimize').addEventListener('click', function () {
      var dock = document.getElementById('tbc-dock');
      if (!dock) return;
      _minimized = true;
      _savedStyleBeforeMin = { w: el.style.width, h: el.style.height, left: el.style.left, top: el.style.top };
      el.style.display = 'none';
      dock.style.pointerEvents = 'auto';

      var chip = document.createElement('button');
      chip.id = 'dock-chip-' + cfg.id;
      chip.title = (titles[cfg.type] || cfg.type);
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#181818;border:1px solid #2a2a2a;border-radius:3px;color:#ffffff;font-size:11px;font-family:Consolas,monospace;padding:3px 10px;cursor:pointer;letter-spacing:.06em;white-space:nowrap;height:28px;transition:border-color .15s;';
      chip.innerHTML = '<span style="color:#E97132;">' + (icons[cfg.type] || '◆') + '</span> ' + (titles[cfg.type] || cfg.type.toUpperCase());
      chip.addEventListener('mouseenter', function () { chip.style.borderColor = '#E97132'; });
      chip.addEventListener('mouseleave', function () { chip.style.borderColor = '#2a2a2a'; });
      chip.addEventListener('click', function () {
        _minimized = false;
        el.style.display = '';
        if (_savedStyleBeforeMin) { el.style.width = _savedStyleBeforeMin.w; el.style.height = _savedStyleBeforeMin.h; el.style.left = _savedStyleBeforeMin.left; el.style.top = _savedStyleBeforeMin.top; }
        el.style.zIndex = _nextZ();
        chip.remove();
        if (!dock.querySelector('button')) dock.style.pointerEvents = 'none';
      });
      dock.appendChild(chip);
    });

    /* Fullscreen button — expands widget to fill canvas area */
    var _isFullscreen = false;
    var _savedStyleBeforeFs = null;
    var fsBtn = el.querySelector('.tbc-widget-btn.fullscreen');
    function enterFullscreen() {
      _isFullscreen = true;
      _savedStyleBeforeFs = { w: el.style.width, h: el.style.height, left: el.style.left, top: el.style.top, zIndex: el.style.zIndex };
      var wrap = document.getElementById('tbc-canvas-wrap');
      var dockH = 36;
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = (wrap ? wrap.clientWidth : window.innerWidth) + 'px';
      el.style.height = ((wrap ? wrap.clientHeight : window.innerHeight) - dockH) + 'px';
      el.style.zIndex = 7900;
      fsBtn.title = 'Exit full screen';
      fsBtn.textContent = '⊠';
    }
    function exitFullscreen() {
      _isFullscreen = false;
      if (_savedStyleBeforeFs) { el.style.width = _savedStyleBeforeFs.w; el.style.height = _savedStyleBeforeFs.h; el.style.left = _savedStyleBeforeFs.left; el.style.top = _savedStyleBeforeFs.top; el.style.zIndex = _savedStyleBeforeFs.zIndex; }
      fsBtn.title = 'Full screen';
      fsBtn.textContent = '⛶';
    }
    fsBtn.addEventListener('click', function () { _isFullscreen ? exitFullscreen() : enterFullscreen(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _isFullscreen) exitFullscreen(); });

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
    else if (type === 'reports') renderReports(id, body);
    else if (type === 'notes')   renderNotes(id, body, data.text || '');
    else if (type === 'intel')    renderIntel(id, body, data);
    else if (type === 'chat')          renderChatBridge(id, body);
    else if (type === 'calendar')      renderCalendarBridge(id, body);
    else if (type === 'notes_inbox')   renderNotesInboxBridge(id, body);
    else if (type === 'report_viewer') renderReportViewer(id, body, data);
    else if (type === 'econ_calendar')  renderEconCalendar(id, body);
    else if (type === 'call_signal')    renderCallSignal(id, body);
    else if (type === 'obj_handler')    renderObjHandler(id, body);
    else if (type === 'analogy_lib')    renderAnalogyLib(id, body);
    else if (type === 'scenario_mod')   renderScenarioMod(id, body);
    else if (type === 'gold_intel')     renderGoldIntel(id, body);
    else if (type === 'macro_monitor')  renderMacroMonitor(id, body);
    else if (type === 'sector_heatmap') renderSectorHeatmap(id, body);
    else if (type === 'watchlist')      renderWatchlist(id, body);
    else if (type === 'live_tv')        renderLiveTVWidget(id, body);
    else if (type === 'global_map')     renderGlobalMap(id, body);
    else if (type === 'macro_intel')    renderMacroIntel(id, body);
    else if (type === 'business_cycle') renderBusinessCycle(id, body);
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
    var summary = stripTags(story.description || story.summary || '');

    /* Guess category for the explain prompt */
    var cat = 'macro';
    if (_newsRelevant(story, 'whisky')) cat = 'whisky';
    else if (_newsRelevant(story, 'gold')) cat = 'gold';

    var z = _nextZ();

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
    pop.addEventListener('mousedown', function () { _nextZ(); pop.style.zIndex = window._sharedZ; });
    pop.querySelector('.tnp-close').addEventListener('click', function () { pop.remove(); });

    pop.querySelector('.tnp-intel-btn').addEventListener('click', function () {
      var wrap = pop.querySelector('.tnp-intel-wrap');

      /* ── Cycling status messages while Claude generates ── */
      var STATUS = [
        'READING THE HEADLINE',
        'ANALYSING MARKET CONTEXT',
        'IDENTIFYING RISK SIGNAL',
        'DRAFTING PITCH LANGUAGE',
        'FINALISING INTEL',
      ];
      var _si = 0;
      var _statusEl = document.createElement('div');
      _statusEl.className = 'tnp-intel-loading';
      _statusEl.innerHTML = STATUS[0] + '<span class="tnp-ld"></span>';
      wrap.innerHTML = '';
      wrap.appendChild(_statusEl);
      var _statusTimer = setInterval(function () {
        _si = (_si + 1) % STATUS.length;
        _statusEl.innerHTML = STATUS[_si] + '<span class="tnp-ld"></span>';
      }, 1600);

      fetch('/.netlify/functions/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: hl, summary: summary, category: cat, lensKey: (window._assetLens && window._assetLens.key) || 'universal', lensContext: (window._assetLens && window._assetLens.promptContext) || '' }),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          clearInterval(_statusTimer);
          if (!d || d.error) { wrap.innerHTML = '<div class="tnp-intel-err">Intelligence unavailable.</div>'; return; }

          /* ── Cascade-reveal: build panel then add sections one at a time ── */
          wrap.innerHTML = '<div class="tnp-intel-panel"></div>';
          var panel = wrap.querySelector('.tnp-intel-panel');

          function fadeIn(el) {
            el.style.cssText += 'opacity:0;transform:translateY(6px);transition:opacity .28s ease,transform .28s ease;';
            panel.appendChild(el);
            requestAnimationFrame(function () { requestAnimationFrame(function () {
              el.style.opacity = '1'; el.style.transform = 'translateY(0)';
            }); });
          }

          function mkSec(lblTxt, innerHtml) {
            var d = document.createElement('div');
            d.className = 'tnp-sec';
            d.innerHTML = '<div class="tnp-sec-lbl">' + lblTxt + '</div>' + innerHtml;
            return d;
          }

          var riskCls = d.risk === 'RISK ON' ? 'tnp-risk-on' : d.risk === 'RISK OFF' ? 'tnp-risk-off' : 'tnp-risk-neu';
          var DELAYS = [0, 220, 440, 600];
          var sections = [];

          if (d.what) sections.push(mkSec('WHAT IT MEANS',
            '<div class="tnp-text">' + escH(d.what) + '</div>' +
            (d.analogy ? '<div class="tnp-analogy">&ldquo;' + escH(d.analogy) + '&rdquo;</div>' : '')));

          if (d.risk) sections.push(mkSec('RISK SIGNAL',
            '<div class="tnp-risk ' + riskCls + '"><span class="tnp-risk-dot"></span>' + escH(d.risk) + '</div>' +
            (d.riskReason ? '<div class="tnp-risk-reason">' + escH(d.riskReason) + '</div>' : '')));

          var pitchInner = '';
          if (d.openingLine) pitchInner += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">OPEN WITH</div><div class="tnp-quote">&ldquo;' + escH(d.openingLine) + '&rdquo;</div></div>';
          if (d.pitch)       pitchInner += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">THE LOGICAL CASE</div><div class="tnp-pitch-txt">' + escH(d.pitch) + '</div></div>';
          if (d.futurePace)  pitchInner += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">FUTURE PACE</div><div class="tnp-pitch-txt tnp-future">' + escH(d.futurePace) + '</div></div>';
          if (pitchInner) {
            var pitchSec = document.createElement('div');
            pitchSec.className = 'tnp-sec tnp-pitch-block';
            pitchSec.innerHTML = '<div class="tnp-sec-lbl">HOW TO PITCH IT</div>' + pitchInner;
            sections.push(pitchSec);
          }

          var closingInner = '';
          if (d.spinQuestion) closingInner += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">ASK THEM</div><div class="tnp-quote">&ldquo;' + escH(d.spinQuestion) + '&rdquo;</div></div>';
          if (d.urgency)      closingInner += '<div class="tnp-pitch-row"><div class="tnp-pitch-lbl">TIMING</div><div class="tnp-pitch-txt tnp-urgency">' + escH(d.urgency) + '</div></div>';
          if (closingInner) {
            var closingSec = document.createElement('div');
            closingSec.className = 'tnp-sec';
            closingSec.innerHTML = closingInner;
            sections.push(closingSec);
          }

          sections.forEach(function (sec, i) {
            setTimeout(function () { fadeIn(sec); }, DELAYS[i] || (i * 200));
          });
        })
        .catch(function () {
          clearInterval(_statusTimer);
          wrap.innerHTML = '<div class="tnp-intel-err">Intelligence unavailable.</div>';
        });
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
          /* Give the page a sensible min-width so sidebar + content don\'t collapse */
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

    /* Double-click the bar → recentre the widget so it\'s always reachable */
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
      /* Don\'t fight with titlebar drag cursor */
      if (e.target.closest('.tbc-widget-bar')) { el.style.cursor = ''; return; }
      var dir = getResizeDir(el, e);
      el.style.cursor = resizeCursor(dir) || '';
    });
    el.addEventListener('mouseleave', function () { el.style.cursor = ''; });

    el.addEventListener('mousedown', function (e) {
      var dir = getResizeDir(el, e);
      if (!dir) return;
      /* Don\'t trigger when clicking buttons */
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
  function stripTags(s) {
    /* Remove script/style blocks entirely (content included), then strip remaining tags */
    return String(s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

  /* ── ECONOMIC CALENDAR (v2 — week/month views + sales scripts) ── */
  function renderScenarioMod(id, body) {
    var A = '#E97132';
    var BASE = 5230; /* current gold spot */

    /* parameter definitions: label, options, gold-bullishness scores per option */
    var PARAMS = [
      { key:'cuts',   lbl:'FED RATE CUTS (12 months)',
        opts:['None — on hold','1–2 cuts','3–4 cuts','5–6 cuts','7+ cuts'],
        scores:[0, 1, 2, 3, 3],
        tips:['Fed holding rates — no monetary tailwind','Gradual easing begins — mild support','Clear cutting cycle — strong tailwind','Aggressive cuts — very bullish','Emergency pace — extremely bullish'] },
      { key:'cpi',    lbl:'CPI TRAJECTORY',
        opts:['Falling below 2%','Stable 2–3%','Sticky 3–5%','Rising 5%+'],
        scores:[0, 1, 2, 3],
        tips:['Inflation controlled — Fed can stay restrictive','On-target but not falling fast','Stubborn inflation — real yields compressing','Inflation re-accelerating — strongest gold driver'] },
      { key:'growth', lbl:'ECONOMIC GROWTH',
        opts:['Strong +2%+','Moderate 0–2%','Stalling near 0%','Recession <0%'],
        scores:[-1, 0, 1, 2],
        tips:['Strong growth — risk assets favoured over gold','Moderate expansion — neutral for gold','Growth losing momentum — defensive turn begins','Contraction — rate cuts force, gold surges'] },
      { key:'dxy',    lbl:'US DOLLAR (DXY)',
        opts:['Strengthening','Broadly stable','Weakening','Sharp sell-off'],
        scores:[-2, -1, 1, 3],
        tips:['Dollar strength — direct headwind for gold price','Dollar steady — neutral impact','Dollar weakening — mechanical gold tailwind','Dollar breakdown — gold denominated uplift +10-20%'] },
      { key:'risk',   lbl:'RISK APPETITE',
        opts:['Risk-On rally','Broadly neutral','Risk-Off turn','Crisis / flight to safety'],
        scores:[-1, 0, 1, 2],
        tips:['Equities bid — capital leaving safe havens','No strong directional bias','Risk appetite pulling back — defensive flows begin','Crisis conditions — gold is the destination'] },
      { key:'cb',     lbl:'CENTRAL BANK BUYING',
        opts:['Pausing / reducing','Steady pace','Accelerating','Record-pace buying'],
        scores:[0, 1, 2, 3],
        tips:['Structural buyer stepping back — watch for price impact','Steady demand floor — supportive baseline','CBs adding aggressively — demand above supply growth','Fastest pace in 55 years — most powerful structural driver'] },
    ];

    var PRESETS = {
      'RECESSION':      {cuts:4, cpi:2, growth:3, dxy:2, risk:3, cb:3,
        note:'Fed forced to cut aggressively as growth turns negative. Real yields collapse. Gold\'s most reliable macro catalyst fires simultaneously across all six inputs.'},
      'STAGFLATION':    {cuts:0, cpi:3, growth:2, dxy:2, risk:2, cb:2,
        note:'The Fed is trapped — inflation too high to cut, growth too weak to hold. Real yields deeply negative. Gold thrives in policy paralysis.'},
      'SOFT LANDING':   {cuts:1, cpi:0, growth:1, dxy:1, risk:0, cb:1,
        note:'Inflation controlled, growth intact. The Fed cuts modestly. Gold holds value but lacks strong catalysts. A neutral-to-cautious backdrop.'},
      'RATE CUT CYCLE': {cuts:3, cpi:1, growth:1, dxy:2, risk:1, cb:2,
        note:'A deliberate cutting cycle begins as inflation normalises. Dollar weakens. Institutional capital rotates from fixed income into real assets.'},
      'GEO SHOCK':      {cuts:0, cpi:1, growth:2, dxy:1, risk:3, cb:3,
        note:'Geopolitical disruption drives flight-to-safety demand. Central banks accelerate gold buying. Supply chains stress commodities. Gold becomes the consensus safe haven.'},
      'CUSTOM':         {cuts:2, cpi:2, growth:1, dxy:1, risk:1, cb:2, note:''},
    };

    var PITCHES = {
      'RECESSION':      'The model is flagging a recession scenario. Every US recession since 1967 has driven the Fed to cut aggressively — and every aggressive cutting cycle has produced a double-digit gold return over the following 18 months. The positioning window is before the recession is confirmed, not after.',
      'STAGFLATION':    'Stagflation is gold\'s strongest environment. The Fed cannot raise rates to fight inflation without destroying growth, and cannot cut without letting inflation run further. In the 1970s stagflation, gold returned +2,329% over the decade. The mechanism is the same: policy paralysis and deeply negative real yields.',
      'SOFT LANDING':   'A soft landing is the consensus outcome — and consensus outcomes are already priced. If the landing is harder than expected, which is the historical norm, this scenario moves quickly toward the recession column. A 5–10% gold allocation costs little in a soft landing and pays significantly in any deviation from it.',
      'RATE CUT CYCLE': 'We are in the early phase of a deliberate cutting cycle. Gold has risen an average of 22% in the 12 months following the first rate cut in each of the last four cutting cycles. Institutional capital is rotating out of bonds whose real yield is turning negative. The trade is in motion — the question is at what point the client enters it.',
      'GEO SHOCK':      'Geopolitical shock scenarios have a consistent historical outcome: central banks — the world\'s largest gold buyers — accelerate their buying when they perceive systemic risk. They bought at the fastest pace in 55 years through 2022–24. This scenario assumes that pace continues or increases. The structural demand floor moves higher.',
      'CUSTOM':         '',
    };

    var PHYSICALS_OUT = {
      'RECESSION':      'Physical assets with fixed supply — Scotch whisky casks, fine wine, collectibles, direct property — historically outperform in recession environments. Supply cannot respond to demand shifts; the investment-grade segment is structurally insulated from the equity cycle. Prior recessions saw auction premiums expand as capital sought uncorrelated real assets. The investment case strengthens precisely when the mainstream narrative is most pessimistic.',
      'STAGFLATION':    'Stagflation is the ideal environment for hard assets with fixed supply. As money supply expands and purchasing power erodes, the scarcity premium on physical assets expands with it. A whisky cask distilled in 2022 cannot be re-distilled. A first-growth Bordeaux cannot be replicated. Land and buildings cannot be digitally created. The supply constraint is absolute; the demand from wealth-preservation-minded investors is structural.',
      'SOFT LANDING':   'Physical asset demand holds in a soft landing — the UHNW collector and investor base is not sensitive to moderate rate moves. Investment-grade physicals continue to appreciate through their own mechanisms: maturation (whisky), consumption scarcity (wine), rental income (property). The India tariff reduction and US tariff normalisation provide additional demand floors for alternative assets globally.',
      'RATE CUT CYCLE': 'Rate cuts compress the opportunity cost of holding illiquid real assets — the primary structural headwind. As bond yields fall, the relative attractiveness of yield-free hard assets improves mechanically. Capital rotation from fixed income into physical assets accelerates. Property yields compress, auction premiums for collectibles expand, and the illiquidity discount narrows. All alternative asset classes benefit from the same monetary transition.',
      'GEO SHOCK':      'Geopolitical shocks historically drive UHNW capital toward tangible, portable, internationally recognised stores of value. Physical assets — whisky, wine, gold, property — benefit from their dual nature as both consumable luxury and investable asset. They are insulated from the confidence collapse that affects paper assets, and their value derives from demand that predates and survives political instability.',
      'CUSTOM':         'Based on current inputs, physical asset fundamentals remain structurally sound across the alternative asset spectrum. Supply constraints are permanent; global wealth growth continues to expand the buyer base. The primary variable is the pace of monetary accommodation and how quickly capital rotation from financial to real assets accelerates.',
    };

    /* state */
    var state = Object.assign({}, PRESETS['RATE CUT CYCLE']);
    var preset = 'RATE CUT CYCLE';

    function getScore() {
      var total = 0;
      PARAMS.forEach(function(p) { total += p.scores[state[p.key]]; });
      return total;
    }

    function getSignal(score) {
      /* max possible = 3+3+2+3+2+3 = 16, min = -2-1+0-2-1+0 = -6 */
      if (score >= 12) return {lbl:'STRONGLY BULLISH', sym:'▲▲', col:'#00e676'};
      if (score >= 8)  return {lbl:'BULLISH',          sym:'▲',  col:A};
      if (score >= 4)  return {lbl:'CAUTIOUSLY BULLISH',sym:'▲', col:'#ffd740'};
      if (score >= 1)  return {lbl:'NEUTRAL',          sym:'●',  col:'#ffffff'};
      return                  {lbl:'BEARISH',           sym:'▼',  col:'#ff5252'};
    }

    function getRange(score) {
      var pct = { lo:0, base:0, hi:0 };
      if      (score >= 12) { pct = {lo:30, base:40, hi:55}; }
      else if (score >= 8)  { pct = {lo:15, base:22, hi:32}; }
      else if (score >= 4)  { pct = {lo: 5, base:10, hi:18}; }
      else if (score >= 1)  { pct = {lo:-5, base: 2, hi:10}; }
      else                  { pct = {lo:-18,base:-8, hi:-2}; }
      var fmt = function(p) { return (p>=0?'+':'')+p+'%  $'+(Math.round(BASE*(1+p/100)/10)*10).toLocaleString(); };
      return { lo: fmt(pct.lo), base: fmt(pct.base), hi: fmt(pct.hi), pct: pct };
    }

    function getDominantDriver() {
      var best = null, bestScore = -99;
      PARAMS.forEach(function(p) {
        var s = p.scores[state[p.key]];
        if (s > bestScore) { bestScore = s; best = {p:p, s:s, idx:state[p.key]}; }
      });
      return best ? best.p.lbl + ': ' + best.p.opts[best.idx] + ' (' + best.p.tips[best.idx] + ')' : '';
    }

    function getPitch() {
      if (preset !== 'CUSTOM' && PITCHES[preset]) return PITCHES[preset];
      /* dynamic pitch for CUSTOM based on score */
      var score = getScore();
      var dominant = getDominantDriver();
      if (score >= 8)  return 'The inputs you\'ve set describe a structurally bullish environment for alternative assets. The primary driver is ' + dominant + '. Historical cutting cycles and periods of dollar weakness matching these parameters have produced gold returns in the 15–30% range over 12 months.';
      if (score >= 4)  return 'Current inputs describe a cautiously supportive backdrop for alternative assets. ' + dominant + '. Monitor the rate path and CPI trajectory for a signal upgrade.';
      return 'Inputs describe a challenging near-term environment for alternative assets. The primary headwind is ' + dominant + '. Consider a defensive allocation sized for scenario evolution rather than the base case.';
    }

    function getWhisky() {
      return preset !== 'CUSTOM' ? PHYSICALS_OUT[preset] : PHYSICALS_OUT['CUSTOM'];
    }

    function render() {
      var score  = getScore();
      var sig    = getSignal(score);
      var range  = getRange(score);
      var maxScore = 16, minScore = -6;
      var barPct = Math.round(((score - minScore) / (maxScore - minScore)) * 100);

      /* preset pills */
      var presetHtml = Object.keys(PRESETS).map(function(k) {
        var active = preset === k;
        return '<button class="sm-pre" data-pre="' + k + '" style="padding:3px 9px;font-size:8px;letter-spacing:.1em;border:1px solid ' + (active?A:'#2a2a2a') + ';background:' + (active?A:'transparent') + ';color:' + (active?'#fff':'#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;white-space:nowrap;">' + k + '</button>';
      }).join('');

      /* param rows */
      var paramsHtml = PARAMS.map(function(p) {
        var optPills = p.opts.map(function(o, i) {
          var active = state[p.key] === i;
          return '<button class="sm-opt" data-key="' + p.key + '" data-idx="' + i + '" title="' + o + ': ' + p.tips[i] + '" style="flex:1;padding:5px 4px;font-size:8px;letter-spacing:.06em;text-align:center;border:1px solid ' + (active?A:'#1e1e1e') + ';background:' + (active?A:'#0a0a0a') + ';color:' + (active?'#fff':'#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;line-height:1.3;">' + o + '</button>';
        }).join('');
        return '<div style="margin-bottom:8px;">' +
          '<div style="font-size:7px;letter-spacing:.18em;color:' + A + ';margin-bottom:4px;">' + p.lbl + '</div>' +
          '<div style="display:flex;gap:3px;">' + optPills + '</div>' +
        '</div>';
      }).join('');

      /* score bar */
      var barColor = sig.col;
      var barHtml =
        '<div style="height:4px;background:#111;border-radius:2px;margin-bottom:14px;position:relative;">' +
          '<div style="position:absolute;left:0;top:0;height:100%;width:' + barPct + '%;background:' + barColor + ';border-radius:2px;transition:width .3s;"></div>' +
        '</div>';

      /* price range */
      var rangeHtml =
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">' +
          '<div style="text-align:center;padding:8px;background:#080808;border:1px solid #1a1a1a;">' +
            '<div style="font-size:7px;letter-spacing:.15em;color:#ffffff;margin-bottom:4px;">BEAR CASE</div>' +
            '<div style="font-size:9px;color:#ffffff;font-weight:600;">' + range.lo + '</div>' +
          '</div>' +
          '<div style="text-align:center;padding:8px;background:#080808;border:1px solid ' + A + ';">' +
            '<div style="font-size:7px;letter-spacing:.15em;color:' + A + ';margin-bottom:4px;">BASE CASE</div>' +
            '<div style="font-size:10px;color:#ffffff;font-weight:700;">' + range.base + '</div>' +
          '</div>' +
          '<div style="text-align:center;padding:8px;background:#080808;border:1px solid #1a1a1a;">' +
            '<div style="font-size:7px;letter-spacing:.15em;color:#ffffff;margin-bottom:4px;">BULL CASE</div>' +
            '<div style="font-size:9px;color:#ffffff;font-weight:600;">' + range.hi + '</div>' +
          '</div>' +
        '</div>';

      /* preset note */
      var noteHtml = (preset !== 'CUSTOM' && PRESETS[preset].note) ?
        '<div style="font-size:9px;color:#ffffff;line-height:1.65;margin-bottom:12px;border-left:3px solid ' + A + ';padding:6px 12px;background:#070707;">' + PRESETS[preset].note + '</div>' : '';

      /* output */
      var outputHtml =
        '<div style="padding:12px 14px;background:#050505;border-top:1px solid #111;flex-shrink:0;">' +
          /* signal */
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">' +
            '<div style="font-size:22px;color:' + sig.col + ';line-height:1;">' + sig.sym + '</div>' +
            '<div>' +
              '<div style="font-size:8px;letter-spacing:.2em;color:#ffffff;margin-bottom:2px;">12-MONTH SIGNAL</div>' +
              '<div style="font-size:14px;font-weight:700;color:' + sig.col + ';letter-spacing:.08em;">' + sig.lbl + '</div>' +
            '</div>' +
            '<div style="margin-left:auto;text-align:right;">' +
              '<div style="font-size:7px;letter-spacing:.15em;color:#ffffff;margin-bottom:2px;">COMPOSITE SCORE</div>' +
              '<div style="font-size:18px;font-weight:700;color:#ffffff;">' + score + '<span style="font-size:9px;color:#ffffff;"> / 16</span></div>' +
            '</div>' +
          '</div>' +
          barHtml +
          rangeHtml +
          noteHtml +
          /* dominant driver */
          '<div style="font-size:7px;letter-spacing:.18em;color:' + A + ';margin-bottom:4px;">PRIMARY DRIVER</div>' +
          '<div style="font-size:9px;color:#ffffff;line-height:1.6;margin-bottom:12px;">' + getDominantDriver() + '</div>' +
          /* pitch */
          '<div style="font-size:7px;letter-spacing:.18em;color:' + A + ';margin-bottom:4px;">CALL PITCH</div>' +
          '<div style="font-size:9px;color:#ffffff;line-height:1.65;margin-bottom:12px;">' + getPitch() + '</div>' +
          /* whisky */
          '<div style="font-size:7px;letter-spacing:.18em;color:#ffffff;margin-bottom:4px;">PHYSICAL ASSETS OUTLOOK</div>' +
          '<div style="font-size:9px;color:#ffffff;line-height:1.65;">' + getWhisky() + '</div>' +
        '</div>';

      body.innerHTML =
        '<style>.sm-opt:hover,.sm-pre:hover{border-color:' + A + '!important;}</style>' +
        /* preset row */
        '<div style="padding:10px 12px 8px;background:#050505;border-bottom:1px solid #111;display:flex;flex-wrap:wrap;gap:4px;">' + presetHtml + '</div>' +
        /* params */
        '<div style="padding:12px 14px;background:#050505;border-bottom:1px solid #111;overflow-y:auto;flex:1;">' + paramsHtml + '</div>' +
        /* output */
        '<div style="overflow-y:auto;max-height:340px;">' + outputHtml + '</div>';

      /* wire presets */
      body.querySelectorAll('.sm-pre').forEach(function(btn) {
        btn.addEventListener('click', function() {
          preset = this.dataset.pre;
          var p   = PRESETS[preset];
          PARAMS.forEach(function(pm) { state[pm.key] = p[pm.key]; });
          render();
        });
      });

      /* wire param options */
      body.querySelectorAll('.sm-opt').forEach(function(btn) {
        btn.addEventListener('click', function() {
          state[this.dataset.key] = parseInt(this.dataset.idx, 10);
          preset = 'CUSTOM';
          render();
        });
      });
    }

    body.style.display        = 'flex';
    body.style.flexDirection  = 'column';
    body.style.overflow       = 'hidden';
    body.style.background     = '#050505';
    render();
  }

  function renderAnalogyLib(id, body) {
    var A = '#E97132';

    /* ═══════════════════════════════════════════════════════════════
       MASTER SALES LIBRARY — 4 TYPES × 200+ ENTRIES
       ═══════════════════════════════════════════════════════════════ */

    var ANALOGIES = [
      /* ── MONETARY POLICY ─────────────────────────────────── */
      {id:'m1',  cat:'MONETARY POLICY', asset:'GOLD',   concept:'Money Printing vs Gold Supply',
       analogy: 'Printing 25% more poker chips mid-game doesn\'t create more value — it just means each chip buys less. The player who brought real coins from outside the casino is the one who wins.',
       why: 'Anchors to a game the client already understands. Makes the abstract (M2 expansion) feel immediate and personal.'},
      {id:'m2',  cat:'MONETARY POLICY', asset:'GOLD',   concept:'The Fed\'s Balance Sheet',
       analogy: 'The Fed\'s balance sheet is the world\'s most visible counterfeiting ledger — perfectly legal, meticulously documented, and physical assets with fixed supply are the only assets that cannot be counterfeited back.',
       why: 'The word "counterfeiting" is provocative and accurate. It frames fiat creation not as neutral policy but as dilution — which is the correct framing for the investment case.'},
      {id:'m3',  cat:'MONETARY POLICY', asset:'GOLD',   concept:'Monetary Base Expansion',
       analogy: 'The monetary base is the flour for the entire economy\'s bread. When the Fed adds more flour, every existing loaf is slightly smaller — and gold is the ingredient that cannot be substituted out.',
       why: 'Food metaphors are universally accessible. The "cannot be substituted" line closes the loop back to gold\'s specific value proposition.'},
      {id:'m4',  cat:'MONETARY POLICY', asset:'GOLD',   concept:'Currency Debasement Over Time',
       analogy: 'Every major currency in history has been debased to zero. The British pound has lost 99.5% of its purchasing power since the gold standard ended. Gold has lost nothing — it still buys the same suit it bought in 1920.',
       why: 'Historical facts work better than projections. The suit analogy (Jastram\'s example) is academically grounded and emotionally resonant.'},
      {id:'m5',  cat:'MONETARY POLICY', asset:'BOTH',   concept:'Inflation as a Silent Tax',
       analogy: 'Inflation is a slow leak in a tyre. Your client doesn\'t feel it day-to-day, but after three years they\'re running on the rim wondering why the same income feels tighter despite nothing obviously going wrong.',
       why: 'The tyre leak is slow and invisible — exactly how inflation feels. It removes the abstraction and makes the threat physical and personal.'},
      {id:'m6',  cat:'MONETARY POLICY', asset:'GOLD',   concept:'Real vs Nominal Returns',
       analogy: 'If your account grew 5% but inflation ran at 7%, you didn\'t make 5% — you lost 2%. The number went up; the purchasing power went down. Gold doesn\'t grow the number, but it protects the purchasing power the number is supposed to represent.',
       why: 'Most clients watch the number, not the real return. This reframes the entire performance conversation without attacking their other holdings.'},

      /* ── INTEREST RATES ───────────────────────────────────── */
      {id:'r1',  cat:'INTEREST RATES', asset:'GOLD',   concept:'Peak Fed Funds Rate',
       analogy: 'Peak Fed Funds is the dam at maximum height. The water — capital seeking return — has nowhere left to go but over the top and downstream into hard assets once it breaks.',
       why: 'The dam image is intuitive. Capital under pressure must go somewhere when the cycle turns, and this makes that destination feel inevitable rather than speculative.'},
      {id:'r2',  cat:'INTEREST RATES', asset:'GOLD',   concept:'Inverted Yield Curve',
       analogy: 'An inverted yield curve is the bond market\'s unanimous storm warning. When the most patient capital on earth — institutions managing trillions — pays more to borrow for 2 years than 10, they are collectively pricing in a storm. They have a perfect predictive record since 1955.',
       why: 'Institutional authority is a Cialdini lever. Framing the yield curve as unanimous institutional consensus, not a theory, makes it land with weight.'},
      {id:'r3',  cat:'INTEREST RATES', asset:'GOLD',   concept:'10-Year Real Yield',
       analogy: 'The 10-year yield is gravity for financial assets. When it rises, everything connected to the credit system gets heavier. When it falls to negative in real terms — yield minus inflation — physical assets float completely free of that gravity.',
       why: 'Gravity is universally understood as a physical law, not a choice. This makes gold\'s response to real yields feel like physics, not opinion.'},
      {id:'r4',  cat:'INTEREST RATES', asset:'BOTH',   concept:'Opportunity Cost of Gold',
       analogy: 'The argument against gold is that it pays no yield. But when the 10-year bond yields 4% and inflation is running at 5%, the bond is paying you negative 1% in real terms. Gold is yielding zero. Zero is better than negative one.',
       why: 'Turns the most common objection (gold pays no yield) into its own refutation using the prospect\'s implicit logic.'},
      {id:'r5',  cat:'INTEREST RATES', asset:'GOLD',   concept:'2-Year Yield as Fed Forecast',
       analogy: 'The 2-year yield is the bond market\'s window into the Fed\'s diary. When it prices in aggressive cuts, the smartest institutional money has already seen tomorrow\'s rate path — and is positioning today.',
       why: 'Framing institutional bond positioning as "seeing tomorrow\'s path" creates urgency without hype. The broker becomes the conduit to this intelligence.'},

      /* ── ECONOMIC CYCLES ─────────────────────────────────── */
      {id:'e1',  cat:'ECONOMIC CYCLES', asset:'GOLD',   concept:'CFNAI Composite Index',
       analogy: 'The CFNAI is like the patient\'s blood pressure reading. Below -0.70 is a crisis — and the medication prescribed (rate cuts, quantitative easing) always inflates the price of physical assets. We\'re watching the reading right now.',
       why: 'Medical analogies are visceral and familiar. The present-tense ending ("We\'re watching right now") creates immediacy on the call.'},
      {id:'e2',  cat:'ECONOMIC CYCLES', asset:'BOTH',  concept:'OECD CLI Turning Point',
       analogy: 'The CLI crossing below 100 is the weather satellite spotting the hurricane three days out. By the time the weather is obviously bad, the window to reposition has closed. We can see the satellite image right now.',
       why: 'The satellite analogy positions the broker as someone with early access to information the prospect doesn\'t have yet. The last line is a call to action.'},
      {id:'e3',  cat:'ECONOMIC CYCLES', asset:'GOLD',   concept:'Rising Unemployment Signal',
       analogy: 'Rising unemployment is the starter\'s pistol for rate cuts. And rate cuts are gold\'s single most reliable multi-year catalyst. We don\'t wait for the pistol — we position in the blocks.',
       why: 'Sports metaphors play well. The final line articulates the broker\'s edge (early positioning) as part of the service.'},
      {id:'e4',  cat:'ECONOMIC CYCLES', asset:'BOTH',  concept:'Business Cycle Peak',
       analogy: 'Late-cycle is the moment when everything looks good — unemployment is low, earnings are up, clients are happy with their portfolios. It is also the worst time to be fully exposed to the same assets everyone else owns. The best time to buy insurance is before the house is on fire.',
       why: 'Acknowledges the client\'s current satisfaction rather than attacking it. The insurance framing is familiar, non-threatening, and accurate.'},
      {id:'e5',  cat:'ECONOMIC CYCLES', asset:'GOLD',   concept:'Negative GDP Growth',
       analogy: 'A negative GDP print is the economic red card: the rules change, the players reposition, and assets outside the credit-dependent financial system operate under completely different rules. Gold is not in the same game.',
       why: 'Football is globally understood. "Not in the same game" cleanly articulates gold\'s non-correlation without jargon.'},
      {id:'e6',  cat:'ECONOMIC CYCLES', asset:'BOTH',  concept:'Initial Claims as Lead Indicator',
       analogy: 'Initial claims are the canary in the labour market\'s coal mine. By the time headline unemployment is bad, the canary has been sending its signal for weeks. The coal miners who survived were the ones who listened early.',
       why: 'The canary is a culturally embedded warning metaphor. The survival framing is implicitly applied to the client\'s portfolio.'},

      /* ── GOLD FUNDAMENTALS ────────────────────────────────── */
      {id:'g1',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Gold as Monetary Insurance',
       analogy: 'You insure your house not because you expect it to burn down, but because if it does, you cannot afford not to have insurance. Gold is the insurance policy on the financial system — and right now the financial system has more dry kindling around it than at any point since 2008.',
       why: 'Insurance is universally accepted. The kindling addition contextualises it without being alarmist. Very usable as a closer.'},
      {id:'g2',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'5,000 Years of Monetary History',
       analogy: 'Gold has been accepted as money for over 5,000 years, across every civilisation, every geography, and every political system. Every other form of money in that time — shells, salt, copper coins, paper promises — has been tried and eventually failed. Gold is not a theory. It is the longest running empirical experiment in human financial history.',
       why: 'Historical weight beats economic argument for clients who distrust complexity. Works particularly well with sceptics who want proof, not projection.'},
      {id:'g3',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Gold Supply Constraint',
       analogy: 'All the gold ever mined in human history would fit inside a cube with 22-metre sides — roughly three Olympic swimming pools. That is every ounce, ever. And gold mining adds less than 2% to that pile each year. Central banks can add 25% to the money supply overnight. The asymmetry in supply is what drives the long-run price.',
       why: 'The cube visualisation is memorable and specific. The "overnight" contrast creates a dramatic juxtaposition that makes the scarcity tangible.'},
      {id:'g4',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Gold vs. Fiat Store of Value',
       analogy: 'In 1920, a good suit cost one gold sovereign — roughly equivalent to one ounce of gold. In 2026, a good suit costs approximately one ounce of gold. The sovereign still buys the suit. The paper pound it was worth in 1920 would buy you a shoelace.',
       why: 'This is the Jastram purchasing power argument — academically sourced and verifiable. The shoelace punchline is humorous and memorable.'},
      {id:'g5',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Central Bank Gold Buying',
       analogy: 'Central banks are buying gold at the fastest pace in 55 years. These are the institutions that print the money. When the people who run the printing presses are buying gold with the money they print, it\'s worth asking what they know that the retail investor does not.',
       why: 'Authority and contrast in one move. Central banks are the ultimate inside player — their actions imply a conclusion without the broker having to state it directly.'},
      {id:'g6',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Gold\'s Non-Correlation',
       analogy: 'In 2008, equities fell 40%. Gold fell 2% and recovered within weeks. In 2020, equities fell 34% in five weeks. Gold rose 24% over the year. When everything else in a portfolio is correlated — moving down together — gold is the asset that is not listening to the same conversation.',
       why: 'Specific numbers beat abstract claims. Factual and verifiable. The "not listening to the same conversation" closing image is distinctive.'},
      {id:'g7',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Portfolio Allocation Case',
       analogy: 'Academic research shows a 5-10% allocation to gold in a traditional equity-bond portfolio reduces volatility and improves risk-adjusted returns over 20-year periods — not because gold outperforms, but because it zigs when everything else zags. You\'re not replacing your portfolio. You\'re stabilising it.',
       why: 'Academic authority. The "not replacing, stabilising" framing removes the perceived threat to existing investments and positions gold as additive.'},
      {id:'g8',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Gold in Rising Rate Environments',
       analogy: 'Gold rose from $1,600 in October 2022 to over $5,200 by early 2026 — during the most aggressive rate-hiking cycle in 40 years. The conventional wisdom says gold and rates move inversely. The data from the last cycle says the conventional wisdom missed something: when rates rise because inflation is structural, gold rises with it.',
       why: 'Directly addresses and neutralises the "rising rates are bad for gold" objection using recent, verifiable data.'},

      /* ── WHISKY FUNDAMENTALS ─────────────────────────────── */
      {id:'w1',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'Cask Maturation & Time',
       analogy: 'A whisky cask is a time machine for value. The liquid inside costs £5,000 today. In twelve years — with no further decisions required from the investor — the same liquid will be worth multiples of that. Not because the market changed its mind, but because time itself created something that cannot be recreated any other way.',
       why: '"Time machine" is immediately engaging. "No further decisions required" is a powerful passive income framing. "Cannot be recreated" closes on scarcity.'},
      {id:'w2',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'Whisky Supply Irreversibility',
       analogy: 'The Scotch whisky industry cannot respond to demand. To produce whisky that will be bottled in 2036, the production decision had to be made in 2024. The casks that are maturing right now are the fixed supply. If demand doubles next year — which Indian market growth suggests it might — there is no lever to pull.',
       why: 'Supply inelasticity is the most powerful structural argument for whisky. This version makes it concrete and time-specific rather than abstract.'},
      {id:'w3',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'The India Demand Catalyst',
       analogy: 'India has 1.4 billion people and a growing middle class that specifically drinks Scotch as a status marker. The tariff dropped from 150% to 75% in 2025. That is 1.4 billion potential customers walking through a door that was previously double-locked. The whisky to serve them was distilled years ago. There is no more to make.',
       why: 'Scale is immediate. The "double-locked door" metaphor makes the tariff change dramatic. The supply constraint ending closes the argument.'},
      {id:'w4',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'Whisky vs. Art as Collectible',
       analogy: 'Art requires taste, connections, and storage in a climate-controlled vault. A Picasso is illiquid, divisible only by destruction, and impossible to verify without experts. A Scotch whisky cask from a named distillery has a legally defined specification, a government-accredited warehouse, insurance, and a global auction market. It\'s a collectible that comes with a rulebook.',
       why: 'Art investing is well-known but widely acknowledged as difficult. Whisky positions as the superior collectible precisely because it is more accessible and verifiable.'},
      {id:'w5',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'Distillery Closure Premium',
       analogy: 'A bottle of Port Ellen — distillery closed 1983 — sells for £3,000 to £5,000 at auction. The same age expression from an open distillery costs £150. Closure transforms scarcity from an abstraction into an absolute. There will never be any more Port Ellen. Ever.',
       why: 'Specific examples beat generalities. The price differential is dramatic. "Ever" is the strongest word in the investment pitch for irreversible scarcity.'},
      {id:'w6',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'Whisky as Non-Correlated Asset',
       analogy: 'The Rare Whisky 101 Icon Index rose 586% between 2009 and 2021. The FTSE 100 rose roughly 80% over the same period. In 2008, when the FTSE fell 30%, whisky auction prices were rising. This is not because whisky investors are smarter — it is because whisky does not have a Bloomberg terminal and cannot be panic-sold at 3am.',
       why: 'The contrast is dramatic and real. The "cannot be panic-sold" line is humorous, memorable, and accurately describes why alternative assets dampen volatility.'},
      {id:'w7',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'The Angel\'s Share',
       analogy: 'Every year, roughly 2% of a cask evaporates — what the Scots call the Angel\'s Share. This means a 12-year cask has lost 20-25% of its volume to the angels. What remains is rarer, more concentrated, and worth more per litre. The loss is the mechanism of the gain.',
       why: 'The Angel\'s Share is a genuine piece of folklore that clients find charming. "The loss is the mechanism of the gain" is a memorable inversion that explains the value creation clearly.'},
      {id:'w8',  cat:'WHISKY FUNDAMENTALS', asset:'WHISKY', concept:'Whisky vs. Savings Account',
       analogy: 'A savings account is paying 4.5% today. After tax, real inflation, and the fact that the rate changes next month, you\'re ahead by perhaps 1%. A whisky cask has returned an average of 12% annually over the last 15 years, is not correlated to interest rate decisions, and gets better with age. Which asset is doing the more productive job with that capital?',
       why: 'Savings account is the reference point for most clients\' "safe" allocation. Positioning whisky against it — rather than against equities — reframes the risk conversation entirely.'},

      /* ── PORTFOLIO THEORY ─────────────────────────────────── */
      {id:'p1',  cat:'PORTFOLIO THEORY', asset:'BOTH',  concept:'Diversification as Insurance',
       analogy: 'Diversification does not mean owning 20 stocks instead of 5. It means owning assets that are not having the same conversation. In 2022, equities fell and bonds fell simultaneously — for the first time in 40 years. The 60-40 portfolio lost 16%. Gold was flat. Uncorrelated is not the same as different.',
       why: 'Many clients believe a stock-bond mix is diversified. This directly, factually refutes that belief using recent data without attacking them personally.'},
      {id:'p2',  cat:'PORTFOLIO THEORY', asset:'BOTH',  concept:'Real Assets vs Paper Assets',
       analogy: 'Paper assets — stocks, bonds, cash — are claims on systems: corporate earnings, government solvency, central bank credibility. Real assets — gold, whisky, land — are the things themselves. When the systems they are claims on come under stress, the claims reprice. The things remain what they are.',
       why: 'Philosophically clear and genuinely accurate. Works particularly well with clients who are increasingly sceptical of institutional credibility.'},
      {id:'p3',  cat:'PORTFOLIO THEORY', asset:'BOTH',  concept:'The Barbell Strategy',
       analogy: 'The barbell approach: keep the core of your portfolio in the safest possible assets, and allocate a meaningful slice to asymmetric opportunities that benefit from instability. Everything in the middle — moderate risk for moderate return — is where you pay the most fees and take the most risk for the least reward.',
       why: 'Nassim Taleb\'s barbell is increasingly well-known. Positioning hard assets on the asymmetric end gives them academic credibility while framing mediocre alternatives unfavourably.'},
      {id:'p4',  cat:'PORTFOLIO THEORY', asset:'GOLD',  concept:'Portfolio Tail Risk',
       analogy: 'The value of a portfolio is not just what it makes in good years. It\'s what it doesn\'t lose in bad ones. A 50% drawdown requires a 100% gain just to get back to flat. A portfolio that never falls 50% — because 10% is in gold — reaches the same destination with far less trauma. Smooth is faster than volatile.',
       why: 'The mathematical reality of drawdown recovery is consistently underweighted by retail clients. "Smooth is faster than volatile" is a quotable closer.'},
      {id:'p5',  cat:'PORTFOLIO THEORY', asset:'BOTH',  concept:'Timing vs Allocation',
       analogy: 'Nobody rings a bell when the cycle turns. The right time to add insurance to a portfolio is before you need it, not after. The clients who positioned in gold in 2019 were not predicting COVID. They were following a process. The process worked regardless of the specific trigger.',
       why: 'Defuses the "I\'ll wait for the right moment" objection. Positions hard asset allocation as process-driven rather than prediction-dependent.'},
      {id:'p6',  cat:'PORTFOLIO THEORY', asset:'BOTH',  concept:'Liquidity Premium',
       analogy: 'Illiquid assets carry an illiquidity premium — you are compensated for not being able to sell instantly. A whisky cask is illiquid relative to a stock. But that illiquidity is also why it didn\'t fall 30% in March 2020. You cannot panic-sell something you cannot sell in a panic.',
       why: 'Reframes the primary drawback (illiquidity) as a structural feature that protects the investor from themselves.'},

      /* ── PROPERTY ─────────────────────────────────────────── */
      {id:'pr1', cat:'PROPERTY', asset:'PROPERTY', concept:'Rate Peak = Optimal Entry Window',
       analogy: 'The clients who bought property in 2009 — when everyone said the market was broken — and in 2012 — when rates were near-zero and prices seemed high — are the ones who made the generational return. The pattern is consistent: maximum perceived risk at the bottom, maximum perceived safety near the top. The rate peak is the bottom of the property cycle dressed up as a risk.',
       why: 'Contrarian framing. Reframes the obvious bad news (high rates) as the precise signal the client should be acting on. Cialdini social proof in reverse — most people are wrong at turning points.'},
      {id:'pr2', cat:'PROPERTY', asset:'PROPERTY', concept:'Illiquidity as Protection',
       analogy: 'Property\'s illiquidity is not a bug — it\'s the feature. In March 2020, every liquid asset could be sold in a panic. Every liquid asset was. Property investors couldn\'t panic-sell, held through the correction, and recovered. The illiquidity premium is the compensation for emotional stability — and it\'s the reason property has not sustained a multi-year real decline since 1950.',
       why: 'Reframes the most common objection (can\'t sell quickly) into an advantage. Particularly powerful with clients who have experienced panic-selling their way to a loss in equities.'},
      {id:'pr3', cat:'PROPERTY', asset:'PROPERTY', concept:'Real Returns vs Nominal',
       analogy: 'If UK property fell 10% in nominal terms but inflation ran at 7%, what was the real return on the pound held in cash instead? Negative 7%. The comparison is not property vs. cash. It\'s real purchasing power with a hard asset versus real purchasing power with a depreciating one. Property wins that comparison even in a year when it falls in nominal terms.',
       why: 'Most clients compare property to its own past price, not to the alternative. This reframes the comparison correctly and makes a nominal fall look very different from a real loss.'},
      {id:'pr4', cat:'PROPERTY', asset:'PROPERTY', concept:'Deferred Demand Release',
       analogy: 'Think of deferred buyers as a compressed spring. Every month of 7% mortgage rates pushes another potential buyer out of the market and compresses that spring further. When rates fall — and the rate cycle always turns — every deferred buyer steps back in simultaneously. The investor who holds property going into that release is on the right side of a demand shock they can see coming in advance.',
       why: 'Physics metaphor. The compressed spring creates an intuitive sense of pent-up energy waiting to release. Particularly effective with engineers, scientists, and analytical clients.'},
      {id:'pr5', cat:'PROPERTY', asset:'PROPERTY', concept:'Real Asset vs Paper Claim',
       analogy: 'A gilt is a government\'s promise to pay you back a specific number. The purchasing power of that number depends on what the government does between now and maturity. A property is the thing itself — four walls, a roof, land. It doesn\'t depend on a counterparty\'s creditworthiness. When the government inflates to reduce its debt burden, the gilt investor loses real purchasing power and the property investor does not.',
       why: 'Concrete vs abstract. The contrast between a promise and a physical asset is visceral. Works extremely well with clients who have lived through gilt volatility or inflationary periods.'},

      /* ── FINE WINE ──────────────────────────────────────────── */
      {id:'fw1', cat:'FINE WINE', asset:'FINE WINE', concept:'Every Bottle Consumed Reduces Supply',
       analogy: 'Every time a bottle of Pétrus 2000 is opened, that is one fewer bottle in existence. The supply curve is not just fixed — it is actively contracting. Mining companies can produce more gold. Distilleries can produce more whisky. No one can produce more 2000 Pétrus. The consumption of the asset is the mechanism of value creation for the remaining supply.',
       why: 'Unique to wine: it is the only asset class where the act of consumption by others directly benefits remaining holders. This is a genuinely novel insight most clients have never encountered.'},
      {id:'fw2', cat:'FINE WINE', asset:'FINE WINE', concept:'The Liv-ex as Price Discovery',
       analogy: 'Fine wine has something most alternative assets lack: a real-time exchange with verifiable, public pricing. The Liv-ex Fine Wine 1000 is to investment wine what Bloomberg is to bonds. Every lot at Christie\'s and Sotheby\'s is a public price point. Your client\'s private equity holding has no live price. Their fine wine holding does.',
       why: 'Addresses valuation objection proactively. Repositions wine as more transparent than many alternatives the client already holds. Cialdini authority — the institutional infrastructure proves legitimacy.'},
      {id:'fw3', cat:'FINE WINE', asset:'FINE WINE', concept:'Growing Global Wealth, Fixed Prestige Supply',
       analogy: 'The number of people globally with the wealth to buy first-growth Bordeaux has grown every decade. The number of bottles of 1990 Romanée-Conti that exist has declined every decade. The trajectory of those two curves — diverging, permanently — is the entire investment thesis in one sentence.',
       why: 'Supply-demand in its most elegant form. Extremely memorable because it reduces a complex market to two lines that are always moving apart. Works on any sophisticated client who understands basic economics.'},
      {id:'fw4', cat:'FINE WINE', asset:'FINE WINE', concept:'Uncorrelated to Equities',
       analogy: 'In 2008, global equities fell 40% in 12 months. The Liv-ex Fine Wine 1000 held its value — because wine investors don\'t watch the S&P, and wine buyers don\'t disappear when markets fall. The demand is structural: collectors, restaurants, UHNW individuals, and sovereign wealth funds buying for consumption and prestige. None of those buyers vanished in the GFC.',
       why: 'Specific numbers, specific year, specific claim. The explanation of WHY wine is uncorrelated (structural demand from non-financial buyers) makes the claim credible rather than just a statistic.'},

      /* ── MARKET PSYCHOLOGY ────────────────────────────────── */
      {id:'k1',  cat:'MARKET PSYCHOLOGY', asset:'BOTH',  concept:'Sentiment as Contrarian Signal',
       analogy: 'Consumer confidence at record lows is the most statistically reliable buy signal for hard assets. When your client says "I don\'t feel great about the economy" — that is not a reason to wait. That is the signal. The very discomfort that makes them hesitate is the same discomfort that makes this the right time.',
       why: 'Directly converts the prospect\'s stated hesitation into evidence for proceeding. Requires careful delivery but is highly effective on sophisticated clients.'},
      {id:'k2',  cat:'MARKET PSYCHOLOGY', asset:'BOTH',  concept:'The Rearview Mirror Problem',
       analogy: 'Most investors allocate based on what worked last. After a decade of equity outperformance, they hold equities. After a decade of 60-40 working, they hold 60-40. This is driving using the rearview mirror. The road ahead — higher structural inflation, deglobalisation, geopolitical fragmentation — is not the road behind.',
       why: 'The rearview mirror metaphor is accessible and non-judgmental. It diagnoses without criticising, which keeps the client receptive.'},
      {id:'k3',  cat:'MARKET PSYCHOLOGY', asset:'GOLD',  concept:'Gold as "Boring" Asset',
       analogy: 'Gold is boring. It does not split, pay dividends, or announce quarterly earnings. It just sits there and holds its value. In a world where the exciting investments have included crypto crashes, tech wipeouts, and SVB collapsing in 72 hours — boring is exactly what a portion of your portfolio should be doing.',
       why: 'Acknowledges the objection and inverts it. Works particularly well after a recent market event the client is aware of.'},
      {id:'k4',  cat:'MARKET PSYCHOLOGY', asset:'BOTH',  concept:'Regret Minimisation',
       analogy: 'Jeff Bezos\'s regret minimisation framework: imagine yourself at 80 looking back. Would you regret having 5% of your portfolio in gold if it turned out you didn\'t need it? No. Would you regret not having 5% in gold if the system came under real stress in the next decade? Potentially yes. The asymmetry of regret is clear.',
       why: 'Regret minimisation bypasses the rational objection framework entirely and appeals to emotion — specifically the emotion most relevant to long-term investment decisions.'},
      {id:'k5',  cat:'MARKET PSYCHOLOGY', asset:'BOTH',  concept:'Institutional vs Retail Timing',
       analogy: 'By the time gold or whisky is on the front page of the financial press, institutional money has already been positioning for 18 months. Retail investors buy the headline; institutional investors sell it to them. The question is which side of that transaction your client wants to be on.',
       why: 'Creates urgency and positions the broker as providing access to the institutional side of the timing curve. Very effective with competitive clients.'},

      /* ── EIS / VCT / TAX-EFFICIENT ───────────────────────────── */
      {id:'v1', cat:'EIS / VCT', asset:'EIS/VCT', concept:'EIS Tax Relief as a Floor',
       analogy: 'An EIS investment with 30% upfront income tax relief means the government funds nearly a third of the position. If the company fails completely, after loss relief the maximum real loss is around 38.5p per pound. If it succeeds, the gain is tax-free. This is the only investment class where the tax system is structurally on your side before the company does anything.',
       why: 'Framing the relief as a government co-investment removes the fear of loss. The downside protection is real and measurable — and the asymmetry (capped downside, uncapped upside) is not available anywhere else.'},
      {id:'v2', cat:'EIS / VCT', asset:'EIS/VCT', concept:'VCT as a Dividend Machine',
       analogy: 'A VCT paying 5% tax-free dividends on a £100,000 investment generates £5,000 a year that a 45% taxpayer would need to earn £9,090 gross to replicate. The tax efficiency is not a feature — it is the return. Before the underlying portfolio does a single thing, you are already ahead of most other income instruments.',
       why: 'Gross-up calculation makes the real yield immediately tangible. Works extremely well with high earners who understand marginal rates and instinctively reach for pre-tax equivalents.'},
      {id:'v3', cat:'EIS / VCT', asset:'EIS/VCT', concept:'The IHT Clock',
       analogy: 'Business Property Relief through EIS starts a two-year clock. Every month your client delays is a month the clock is not running. At the current inheritance tax rate of 40%, a £500,000 EIS portfolio that qualifies after two years represents £200,000 of tax that will not leave the estate. The conversation you are having today could save this family £200,000.',
       why: 'Puts a specific, concrete number on the cost of delay. The estate planning frame converts an investment conversation into a legacy conversation — which activates a completely different part of the client\'s decision-making.'},
      {id:'v4', cat:'EIS / VCT', asset:'EIS/VCT', concept:'EIS SEIS Knowledge Intensive',
       analogy: 'A Knowledge Intensive EIS company — defined by HMRC criteria for R&D spend and workforce — carries 30% upfront relief, CGT deferral on any gain you roll in, and loss relief that mirrors your highest marginal rate. It is not an investment product. It is a tax planning instrument that also happens to invest in early-stage British innovation.',
       why: 'Re-categorising EIS from "risky investment" to "tax planning instrument" bypasses the risk objection entirely. The risk is real but it is not the category — and framing matters enormously.'},
      {id:'v5', cat:'EIS / VCT', asset:'EIS/VCT', concept:'Offshore Bond as Tax Wrapper',
       analogy: 'An offshore bond is a tax-efficient container, not an investment. Inside it you can hold any fund, switch between strategies, and accumulate gains without triggering a tax charge — all within a single legal wrapper. The eventual chargeable event gain can be timed by the policyholder, spread across top-slicing, and taken in a year of lower income. The control over when tax is paid is the product.',
       why: 'Tax deferral and control are the core value propositions. Framing the bond as a "container" rather than a product helps clients who feel sold to — they chose the contents, the wrapper is just architecture.'},
      {id:'v6', cat:'EIS / VCT', asset:'EIS/VCT', concept:'Carry Forward on Annual Allowance',
       analogy: 'If your client has not used their pension annual allowance for the past three years, they can carry it forward and contribute up to £180,000 this tax year — at full income tax relief at their marginal rate. For a 45% taxpayer, that is up to £81,000 the government contributes. This is available right now, requires no specialist structure, and the window closes on 5th April.',
       why: 'The finite window and specific calculation create genuine urgency without manipulation. The April deadline is real and consequential. Works extremely well with high earners approaching peak earning years.'},

      /* ── PRIVATE EQUITY / TRUSTS ─────────────────────────────── */
      {id:'pe1', cat:'PRIVATE EQUITY', asset:'PE/TRUSTS', concept:'J-Curve as Patience Premium',
       analogy: 'Private equity\'s J-curve is not a flaw — it is the price of admission to the return premium. The NAV dips in years one and two as fees are drawn and early portfolio companies are being built. By year five the inflection arrives. The investors who understood this and held earned the PE premium. The investors who didn\'t sold before the curve turned. The J-curve is a filter: it keeps short-term capital out, which is precisely why the long-term returns are available.',
       why: 'Reframes the most common PE objection (early negative performance) as a structural feature that protects the return for those who understand it. Turns patience into a competitive advantage.'},
      {id:'pe2', cat:'PRIVATE EQUITY', asset:'PE/TRUSTS', concept:'PE Vintage Diversification',
       analogy: 'Nobody invests in PE with a single vintage. Spreading across 2022, 2023, 2024 and 2025 vintages means different entry valuations, different company maturity profiles, and different cycle exposures. A 2009 vintage PE fund had entry valuations at post-crisis lows and returned 3x. A 2007 vintage was buying at the top. Vintage diversification in PE is what market timing is supposed to be — but executed systematically rather than by guesswork.',
       why: 'Most clients think of PE as a single investment, not a portfolio construction discipline. This reframes the conversation and naturally leads to a programme of commitments rather than a one-off decision.'},
      {id:'pe3', cat:'PRIVATE EQUITY', asset:'PE/TRUSTS', concept:'Investment Trust Discount',
       analogy: 'An investment trust trading at a 15% discount to NAV means you are buying £1.00 of assets for 85p. If the discount narrows — which historically happens when sentiment improves — you make money twice: from the underlying assets performing, and from the discount closing. No open-ended fund offers this opportunity because open-ended funds cannot trade at a discount.',
       why: 'The 85p-buys-£1 framing is intuitively compelling. The dual return mechanism (NAV growth + discount narrowing) is genuinely unique to the trust structure and gives the broker a differentiated insight.'},
      {id:'pe4', cat:'PRIVATE EQUITY', asset:'PE/TRUSTS', concept:'Buyout Operational Value Creation',
       analogy: 'A private equity buyout is not a financial transaction with a company attached. It is a 5-year operational improvement programme with a financial transaction at the start and end. The PE firm installs management, restructures costs, professionalises reporting, and builds the platform for strategic acquisitions — then sells to a larger buyer or the public markets at a multiple of the entry valuation.',
       why: 'Demystifies PE for clients who see it as pure leverage arbitrage. The operational narrative makes it feel more like a business investment than a financial product — which it genuinely is.'},
      {id:'pe5', cat:'PRIVATE EQUITY', asset:'PE/TRUSTS', concept:'Secondaries as Risk Mitigation',
       analogy: 'A PE secondary fund buys existing LP positions at a discount from investors who need liquidity. This eliminates the J-curve entirely — you are buying into funds that are already partially deployed, with visible portfolio companies and a known entry price. The discount to NAV (historically 10-20%) is the structural advantage. You inherit the upside without the early-stage uncertainty.',
       why: 'Secondaries address the two biggest PE objections simultaneously: illiquidity (you are buying from someone who needed out) and J-curve (the dip already happened). Very powerful for clients who want PE exposure with less pain.'},

      /* ── LAND & ART ──────────────────────────────────────────── */
      {id:'la1', cat:'LAND & ART', asset:'LAND', concept:'Farmland as Monetary Base Asset',
       analogy: 'British farmland has appreciated every single decade since records began. Not every year — every decade. It survived two world wars, the 1970s stagflation, Black Monday, the GFC, and COVID. The reason is simple: they stopped making land in 1945. Everything built since then is on land that already existed. Every person added to the population increases the demand for the same fixed supply.',
       why: 'The historical consistency across decade-long windows (not years) pre-empts the timing objection. "They stopped making land" is quotable and memorable. Factually precise.'},
      {id:'la2', cat:'LAND & ART', asset:'LAND', concept:'Agricultural Property Relief',
       analogy: 'Farmland with Agricultural Property Relief passes outside the estate with zero inheritance tax after two years of ownership. For a client with a £2m farmland holding and a 40% IHT liability, that is £800,000 that stays in the family rather than going to HMRC. The land does not need to outperform equities to be the right decision — the tax advantage alone justifies the allocation.',
       why: 'Converts farmland from a return argument to an estate planning argument. The IHT saving is concrete and measurable. For the right client, this is more compelling than any performance statistic.'},
      {id:'la3', cat:'LAND & ART', asset:'ART', concept:'Masterwork Scarcity',
       analogy: 'A Basquiat that sold for $800,000 in 2002 sold at Sotheby\'s in 2017 for $110.5m. That is not a prediction — it is the historical record of what happens when a defined body of work by a dead artist intersects with global wealth expansion. The supply is fixed by mortality. The demand expands with every new billionaire who wants cultural cachet.',
       why: 'Specific numbers and a real auction result make this verifiable and credible. The "fixed by mortality" framing is stark and memorable. Works particularly well with art-curious clients who need the investment case made explicitly.'},

      /* ── EXTRA GOLD & MACRO ──────────────────────────────────── */
      {id:'g9',  cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'BRICS De-dollarisation',
       analogy: 'The BRICS nations hold 42% of global population and 26% of global GDP. Every announcement of bilateral trade settled outside the dollar is a small withdrawal from the dollar\'s reserve status — and reserve status is the structural mechanism that keeps dollar demand artificially high. When that demand normalises, the holders of gold benefit from exactly the same dynamic that made gold the pre-Bretton Woods global reserve. History is rhyming.',
       why: 'Geopolitical frame for sophisticated clients who track macro trends. The rhyming history point is elegant and non-alarmist — it presents de-dollarisation as a structural shift rather than a conspiracy theory.'},
      {id:'g10', cat:'GOLD FUNDAMENTALS', asset:'GOLD', concept:'Safe Haven in Debt Crisis',
       analogy: 'In every sovereign debt crisis of the modern era — Greece 2010, Argentina 2001, Russia 1998 — gold held its real purchasing power while the domestic currency collapsed. The defining characteristic of a debt crisis is that every asset denominated in the troubled currency falls together. Gold is not denominated in any currency. It is the escape hatch that every affected population wishes they had bought earlier.',
       why: 'Historical evidence across multiple distinct crises. The "escape hatch" metaphor is visceral and works particularly well for clients who hold significant currency-denominated assets.'},
      {id:'m7', cat:'MONETARY POLICY', asset:'EIS/VCT', concept:'Financial Repression and Tax Relief',
       analogy: 'Financial repression — deliberately keeping interest rates below inflation to erode the real value of government debt — is the most reliable wealth redistribution mechanism in modern history. It silently transfers purchasing power from savers to the state. EIS and VCT tax reliefs are, in this context, the government leaving a door open: the same government eroding your savings with one hand is offering you a structural tax advantage with the other. Using it is not aggressive tax planning. It is accepting the invitation.',
       why: 'Connects macro policy (financial repression) to the specific product (EIS/VCT relief). Frames the tax planning as government-sanctioned and obvious, which is disarming for clients who fear appearing to be "at it".'},
      {id:'m8', cat:'MONETARY POLICY', asset:'PE/TRUSTS', concept:'PE Premium in ZIRP Unwind',
       analogy: 'Zero interest rate policy from 2009-2022 allowed mediocre businesses to borrow cheaply and survive. The rate normalisation since 2022 is a business cycle stress test that separates genuinely profitable companies from the living dead. The PE managers who can identify operationally strong businesses through that filter will deploy at 2024-2025 vintages into a landscape cleared of weak competition. The next decade of PE returns may be the best in twenty years — precisely because the last decade of easy money is over.',
       why: 'Sophisticated macro-to-PE linkage. Very effective with clients who have lived through ZIRP and understand why the environment has changed. Positions current vintage as a structural opportunity, not a leap of faith.'},
    ];

    /* ═══════════════════════════════════════════════════════════
       SPINS — REFRAMING TECHNIQUES
       ═══════════════════════════════════════════════════════════ */
    var SPINS = [
      {id:'s1', cat:'TIMING', scenario:'"I\'ll wait for the right time"',
       spin: 'The right time argument has a structural flaw: the "right time" is only visible in retrospect. The clients who bought gold in October 2022 did not know it was the right time — they followed a process. Three years later they are sitting on 200%+ gains. Waiting for certainty means buying after the return has already happened.',
       why: 'Reframes waiting as a strategy with a documented failure rate. The historical example grounds the abstract argument in real data.'},
      {id:'s2', cat:'RISK', scenario:'"It\'s too risky for me"',
       spin: 'Risk in investing is not a binary. The question is never "is there risk?" — the question is "which risk?" Cash carries inflation risk. Equities carry drawdown and correlation risk. A diversified alternatives allocation carries illiquidity risk and complexity risk. The relevant question is which of those risks your client is least equipped to recover from — and whether they have thought about it in those terms.',
       why: 'Shifts from "risky vs safe" to "which risk" — a reframe the client cannot easily dismiss because it requires them to engage with the actual argument.'},
      {id:'s3', cat:'LIQUIDITY', scenario:'"I need to keep it liquid"',
       spin: 'Total liquidity is a comfortable feeling that carries a hidden cost. Every pound held liquid at the bank is currently losing purchasing power in real terms. The question is what percentage of their portfolio genuinely needs to be liquid within 30 days versus what percentage could be locked up for 3-5 years in exchange for materially higher returns. Most clients, if they think honestly, have a much smaller genuine liquidity need than their current allocation suggests.',
       why: 'Separates real liquidity need (emergency fund, near-term commitments) from comfort-liquidity (money held liquid out of habit). Most clients have never been asked to make this distinction.'},
      {id:'s4', cat:'TRUST', scenario:'"I\'ve been burned before"',
       spin: 'That experience is the most valuable information in this conversation, because it tells us what to design around. The question is not whether to invest — it is how to structure the next investment so the same vulnerability does not exist. A client who was burned by illiquidity needs a liquidity sleeve. A client burned by concentration needs diversification. A client burned by promises that didn\'t materialise needs verified historical data, not projections. What specifically went wrong?',
       why: 'Converts an objection into a diagnostic. The client stops defending and starts describing — which is both more useful information and a very different emotional posture.'},
      {id:'s5', cat:'AUTHORITY', scenario:'"My accountant/advisor said no"',
       spin: 'Accountants are excellent at telling you what the tax implications of a decision are. They are less systematically trained in the risk/return profile of alternative assets, because that is not what they are trained and regulated to do. The question is not whether your accountant approved it — the question is whether they gave you the information to make the decision yourself. Have they modelled the EIS downside scenario against the tax relief floor? Have they costed the IHT exposure against the BPR alternative?',
       why: 'Respects the accountant without deferring to them. Reframes the conversation as about information quality, not authority. Opens a specific, workable question the client can take back to the accountant.'},
      {id:'s6', cat:'RETURNS', scenario:'"I can get better returns elsewhere"',
       spin: 'That may well be true in nominal terms. The question is what the risk-adjusted, tax-adjusted, correlation-adjusted return comparison looks like. A 15% gross return from a concentrated equity position that falls 40% in a downturn and is taxed at 45% on realisation may well underperform a 10% net return from a tax-advantaged alternative that holds its value when equities fall. Can we run that comparison together?',
       why: 'Accepts the claim without conceding it. Introduces three adjustments (risk, tax, correlation) that the client almost certainly has not applied. The offer to run the comparison together is collaborative, not adversarial.'},
      {id:'s7', cat:'UNDERSTANDING', scenario:'"I don\'t understand it"',
       spin: 'That is the most honest thing a client can say, and it is the most useful starting point. There are exactly two reasons to invest in something you don\'t understand: because the person selling it explained it badly, or because the structure is genuinely complex. In either case, the answer is not to walk away — it is to explain it until the client does understand it. Which part feels most opaque?',
       why: 'Validates the objection entirely and immediately. The diagnostic question at the end ("which part feels most opaque?") moves the conversation into problem-solving mode rather than persuasion mode.'},
      {id:'s8', cat:'TIMING', scenario:'"The market is at an all-time high"',
       spin: 'Markets spend most of their time at or near all-time highs — by definition, because they trend upward over time. The data shows that buying at an all-time high has historically produced returns almost identical to buying at any other time, because the new high is not the ceiling, it is the new floor. What matters is not where the market is today but what macro conditions are developing — and what macro conditions favour alternatives specifically.',
       why: 'Directly refutes the instinct with historical data. The reframe from "ceiling" to "new floor" is memorable and accurate.'},
      {id:'s9', cat:'RISK', scenario:'"Past performance is no guarantee"',
       spin: 'Correct — and the same caveat applies to every asset class your client currently holds. Equities have no guaranteed future return. Property has no guaranteed future return. The relevant question is not whether returns are guaranteed — nothing is — but what structural, supply/demand, and macro factors give us a reasoned basis for an expectation. The case for [asset] is not "it went up before" — it is: supply is constrained by [X], demand is structurally driven by [Y], and the macro backdrop is [Z]. That is a forward-looking thesis, not a backward-looking extrapolation.',
       why: 'Accepts the caveat and applies it symmetrically. Pivots immediately to the forward-looking structural thesis, which is where the actual conversation should be.'},
      {id:'s10', cat:'SIZING', scenario:'"The minimum is too high"',
       spin: 'The minimum exists partly because the structure — EIS, cask, PE — requires a meaningful commitment to make the economics work for the manager, the investor, and the legal infrastructure. But the more interesting question is: if the minimum were £5,000, would the client want £5,000 in it? If the answer is yes but they just cannot afford the stated minimum, that is a very solvable problem through structuring. If the answer is no, the minimum is not the actual objection.',
       why: 'Separates the genuine affordability objection from the minimum-as-excuse. One leads to a structuring conversation; the other leads back to the real objection.'},
      {id:'s11', cat:'REGULATION', scenario:'"It\'s not regulated"',
       spin: 'EIS, SEIS, VCT, and pension schemes are HMRC-approved and FCA-regulated at the fund and platform level. Individual cask whisky is not a financial instrument and does not require FCA regulation — nor does ownership of property, land, or fine art. Regulation governs financial products; it does not govern ownership of physical assets. The question your client is really asking is: is this legitimate, is this transparent, and is there recourse if something goes wrong? The answer to all three is yes — here is why.',
       why: 'Disentangles the regulatory question from the legitimacy question. Addresses the real underlying concern (safety) without pretending that unregulated assets are the same as regulated financial products.'},
      {id:'s12', cat:'TIMING', scenario:'"Call me back in three months"',
       spin: 'In three months the macro data will be different, the market will be different, and the conversation will feel just as complicated as it does today. There are very few genuinely time-critical elements in this conversation — the 5th April tax year deadline for EIS relief is one of them. Everything else is as true in three months as it is today, except the window to act ahead of the next catalyst will be three months shorter. What specifically needs to change in three months for this to feel like the right time?',
       why: 'Accepts the deferral but surfaces the specific condition required for a yes. The April deadline anchor is concrete. The final diagnostic question is the most important element.'},
      {id:'s13', cat:'TRUST', scenario:'"I only invest in things I can see"',
       spin: 'You cannot see your pension. You cannot see your shares in a fund. You cannot see the cash backing a bank deposit — it has been lent out to a mortgage holder forty miles away. The investment landscape is almost entirely comprised of claims on things you cannot see. What you can verify about an alternative asset is its title, its physical existence, its insured value, and its independent audit trail — which is often more direct verification than exists for the equities in your ISA.',
       why: 'Challenges the tangibility instinct with the observation that the client\'s existing investments are equally intangible. Pivots to what is actually verifiable about the alternative.'},
      {id:'s14', cat:'RETURNS', scenario:'"My ISA/pension is doing fine"',
       spin: 'Fine relative to what? The FTSE 100 is flat in real terms over the last decade when you adjust for inflation. "Doing fine" is usually "keeping up with the index" — which means keeping up with a benchmark that has dramatically underperformed hard assets since 2020. The question is not whether the ISA is performing — it is whether it is performing against the actual cost of your life, which is inflation. Against that benchmark, most ISAs are quietly losing.',
       why: 'The "doing fine" objection is killed by redefining the benchmark from "the market" to "real purchasing power." This is not an argument the client can easily dismiss.'},
      {id:'s15', cat:'RISK', scenario:'"The economy is uncertain right now"',
       spin: 'Every single decision to invest — at any point in recorded history — was made during uncertainty. 1993: uncertainty about interest rates. 2003: uncertainty about Iraq. 2009: uncertainty about the financial system. 2015: uncertainty about China. 2020: uncertainty about COVID. 2022: uncertainty about Ukraine. The clients who acted during those uncertainties are the ones who built real wealth. The ones who waited for certainty have been waiting since 1993.',
       why: 'Removes the objection by demonstrating that "uncertainty" is a permanent condition, not a temporary obstacle. The historical list should reference periods the client lived through.'},
      {id:'s16', cat:'SIZING', scenario:'"Let me start small and see how it goes"',
       spin: 'Starting small is not a bad instinct — it is smart risk management. The question is what "small" means in the context of the structure. For an EIS or cask investment, a small position below the minimum threshold actually loses the structural benefit that makes the risk-adjusted return compelling. The minimum exists because the cost-benefit calculus only works above it. Below that, you have cost without commensurate return. The structure was designed to be entered correctly, not tentatively.',
       why: 'Validates the cautious instinct while explaining why below-minimum entry is structurally irrational. Reframes the minimum as a feature, not a sales requirement.'},
      {id:'s17', cat:'AUTHORITY', scenario:'"I prefer to deal with my bank"',
       spin: 'Your bank\'s job is to manage deposits and make loans. It is not structurally positioned to offer alternative assets, tax-advantaged private investment, or non-correlated real asset allocation — because those products do not generate the margin model that retail banks run on. The question is not whether your bank is a trustworthy institution — it clearly is. The question is whether a trustworthy institution is the same thing as the right institution for this specific allocation.',
       why: 'Validates the trust in the bank while drawing a distinction between trustworthiness and appropriate product coverage. Does not attack the bank — repositions the conversation around fit.'},
      {id:'s18', cat:'UNDERSTANDING', scenario:'"I\'ll need to speak to my accountant first"',
       spin: 'Absolutely — and your accountant will likely agree with the tax mechanics once you show them the HMRC-approved structure. What I\'d suggest is this: let\'s cover the tax points together now so you can walk into that conversation with the right questions. The conversation will be faster, your accountant\'s time is expensive, and the approval timeline tends to compress significantly when the client already understands the structure they\'re presenting.',
       why: 'Validates the accountant referral without treating it as a close-ender. Reframes the sequence: understand it now, then get it confirmed, rather than learn it cold in an accountant\'s office.'},
      {id:'s19', cat:'UNDERSTANDING', scenario:'"I\'ve already done my research and I\'m happy with what I have"',
       spin: 'That\'s the best position to be in — genuinely. The question I\'d ask is: your research told you what you already knew to look for. What it can\'t show you is what you didn\'t know to look for. The most expensive decisions I\'ve seen aren\'t the ones people researched and got wrong — they\'re the ones people never researched because the category wasn\'t on their radar. In 2014, very few UK investors had whisky casks on their radar. The ones who looked anyway are now holding assets at five times their entry value. The research you\'ve done is solid. The gap is in the category you haven\'t looked at yet.',
       why: 'Challenger Sale commercial insight: the prospect\'s research reveals what they already know. The salesperson\'s job is to introduce a category the prospect didn\'t know to consider — reframing the entire decision-making frame. Source: Dixon & Adamson, The Challenger Sale.'},
      {id:'s20', cat:'TIMING', scenario:'"I need to wait for the right moment / market conditions to be clearer"',
       spin: 'I want to challenge one assumption in that — not the instinct, the assumption. The assumption is that clarity arrives before the opportunity closes. In every market cycle I can point to, the moment of maximum clarity came after the entry point had passed. Gold was "wait and see" at £600. Farmland was "wait and see" at £8,000 an acre. Clarity is a trailing indicator — it arrives when the market has already moved. The question isn\'t "when will conditions be clear?" It\'s "what return would you need to see to feel you missed the window?" Because at some point you will see it, and it will have a date on it.',
       why: 'Reframes "wait for clarity" as a cognitive error — clarity is what arrives after the opportunity. Source: Kahneman availability heuristic + Ariely arbitrary coherence (we anchor on the conditions we\'re used to and adjust too slowly).'},
    ];

    /* ═══════════════════════════════════════════════════════════
       PSYCHOLOGY — INFLUENCE PRINCIPLES & TECHNIQUES
       ═══════════════════════════════════════════════════════════ */
    var PSYCHOLOGY = [
      {id:'py1', cat:'CIALDINI', principle:'SCARCITY',
       technique: 'The scarcity principle works when supply is genuinely constrained — not artificially manufactured. For hard assets, scarcity is structural: there will never be more 12-year Macallan distilled in 2012, more 2005 Pétrus, or more gold than has ever been mined plus 2% per year. Lead with the supply constraint before the demand story. Manufactured scarcity feels like a sales tactic; structural scarcity feels like physics.',
       script: '"The reason I want to talk about this now is that [the cask / the vintage / the tranche] is finite. Once it\'s gone, it\'s gone — and the secondary market price reflects that permanently."',
       why: 'Genuine scarcity is the strongest form of this principle. Clients who would resist artificial urgency accept structural scarcity because it is verifiably true.'},
      {id:'py2', cat:'CIALDINI', principle:'AUTHORITY',
       technique: 'Invoke authority through institutional behaviour, not through personal claims. The most powerful authority signal is "the people who run the system are doing this" — central banks buying gold, HMRC approving EIS structures, sovereign wealth funds acquiring farmland. Institutional behaviour is the external authority signal that pre-empts "who are you to tell me?"',
       script: '"Central banks bought more gold in 2022-2023 than at any point since 1967. These are the institutions that print the money. Their gold buying is not a retail investment trend — it is a signal from the top of the monetary system."',
       why: 'Institutional authority is unchallengeable without the client attacking the institutions themselves — which they will not do if they want to appear rational.'},
      {id:'py3', cat:'CIALDINI', principle:'SOCIAL PROOF',
       technique: 'In alternative investments, social proof comes from credible peer groups, not mass behaviour. "Everyone is doing this" is unconvincing. "The endowments at Oxford and Cambridge have been allocating 15-20% to alternatives for a decade" is compelling. Match the social proof to the client\'s identity: UHNW clients respond to UHNW peer behaviour; HNW professionals respond to institutional behaviour; entrepreneurs respond to other entrepreneurs.',
       script: '"The largest university endowments in the world — Oxford, Cambridge, Harvard, Yale — have held 15-25% in alternatives including private equity and real assets for years. They do not do this for tax reasons. They do it because the risk-adjusted returns justify it."',
       why: 'Identity-matched social proof is the most powerful variant. The endowment model has academic and performance credibility that transcends a testimonial.'},
      {id:'py4', cat:'CIALDINI', principle:'RECIPROCITY',
       technique: 'Give specific, personalised intelligence before asking for anything. Not a generic market update — specific data that is relevant to the client\'s situation, delivered without expectation. The intelligence itself builds obligation. The call that starts with "I saw this data point and thought of your situation specifically" triggers reciprocity more reliably than a meeting-opener pitch.',
       script: '"I was looking at the latest FRED data this morning and the real yield print maps directly to what we discussed last quarter about your allocation gap. I wanted to share that before we talk about anything else."',
       why: 'Specific and personalised triggers stronger reciprocity than generic. The selfless-feeling gift (sharing intelligence with no immediate ask) creates the psychological obligation without the client noticing.'},
      {id:'py5', cat:'CIALDINI', principle:'COMMITMENT & CONSISTENCY',
       technique: 'Small early commitments cascade into larger ones. Start with agreement on the principle ("Do you think a portion of your portfolio should be protected from inflation?") before moving to the specific instrument. Once the client has agreed to the principle, disagreeing with the specific instrument requires them to contradict their stated position — which most people will not do.',
       script: '"You\'ve mentioned a few times that you want this portion to be working harder without adding equity risk. If we could show you something that is uncorrelated to equities and has structural upside — would that be worth exploring?"',
       why: 'The question extracts a verbal commitment to a direction, not a product. The subsequent discussion positions every relevant product as the logical next step from what the client already agreed.'},
      {id:'py6', cat:'CIALDINI', principle:'LIKING',
       technique: 'Find genuine, specific common ground before the product conversation. Shared interests (industry background, regional familiarity, specific investment experience) create rapport faster than surface-level rapport-building. The more specific and genuine the connection, the stronger the effect. Generic rapport ("great weather today") does nothing; specific connection ("your background in manufacturing makes you well-placed to evaluate operational PE") creates a meaningful link.',
       script: 'Lead with a reference to something specific from prior conversations or LinkedIn research. "You mentioned last time you\'d looked at agri-land in Scotland — what was your conclusion?" Then listen, genuinely.',
       why: 'Genuine interest in the client\'s experience is not a technique — it is the technique. The most credible rapport is built on actual listening, not performed interest.'},
      {id:'py7', cat:'LOSS AVERSION', principle:'LOSS FRAMING',
       technique: 'Kahneman and Tversky showed that losses loom approximately twice as large as equivalent gains in people\'s minds. Frame the cost of inaction, not just the benefit of action. "You stand to gain X%" is half as motivating as "you are currently losing Y% in real terms by holding cash at below-inflation rates." The loss framing must be accurate and measurable — manufactured loss language is detectable and counterproductive.',
       script: '"At current CPI, every month your client holds £500k in cash they are losing approximately £2,800 in real purchasing power. Over a year that is £33,600 of silent erosion. The question is not whether they can afford to invest — it is whether they can afford not to."',
       why: 'Measurable, accurate loss framing converts abstract risk into a concrete, present-tense cost. The specificity makes it feel like information, not pressure.'},
      {id:'py8', cat:'LOSS AVERSION', principle:'REGRET MINIMISATION',
       technique: 'Project the client forward to their 80-year-old self and ask which outcome they would regret more. This is Jeff Bezos\'s decision framework, and it is extremely effective for long-term investment decisions because it bypasses short-term loss aversion and engages long-term identity. The client who can articulate which regret is worse has effectively made the decision.',
       script: '"Think about this from the perspective of where you want to be in twenty years. Would you regret having 5-10% in gold and not needing it? Or would you regret not having it if the financial system came under real stress? That asymmetry of regret usually points clearly in one direction."',
       why: 'Forces the client to engage their long-term identity rather than their short-term risk aversion. The asymmetry question makes the answer feel self-evident rather than broker-driven.'},
      {id:'py9', cat:'SPIN SELLING', principle:'SITUATION',
       technique: 'SPIN Situation questions establish factual context without challenging. Ask about portfolio composition, allocation percentages, existing advisors, and goals before asking anything evaluative. The purpose of Situation questions is not to gather information for its own sake — it is to demonstrate that your subsequent questions and recommendations are based on their specific situation, not a generic pitch.',
       script: '"Before we get into anything specific — can you give me a sense of how your current portfolio breaks down? Rough percentages are fine. I want to make sure what I\'m about to show you is actually relevant to where you are."',
       why: 'Situation questions signal professionalism and create the foundation for Implication and Need-Payoff questions that follow. They also give the client an opportunity to articulate their own situation — which is more persuasive than being told about it.'},
      {id:'py10', cat:'SPIN SELLING', principle:'PROBLEM',
       technique: 'Problem questions surface difficulties the client knows about but has not articulated. The most useful problem questions name a class of risk without naming the client\'s specific holding — which keeps the client from feeling attacked while surfacing the concern. "Do you have much in long-duration bonds?" is more effective than "Your long-duration bond allocation looks exposed."',
       script: '"How comfortable are you with the inflation protection in the portfolio as it stands? Is there a piece that you feel is working hard on that front?"',
       why: 'Invites the client to locate the gap themselves. A client who identifies their own problem is more motivated to solve it than a client whose problem was identified for them.'},
      {id:'py11', cat:'SPIN SELLING', principle:'IMPLICATION',
       technique: 'Implication questions make the consequences of the problem explicit, specific, and present-tense. The problem question found the gap; the implication question costs it. "What happens to that portion of the portfolio if inflation stays above 5% for another two years?" makes the abstract risk tangible. Never answer the implication question for the client — ask it and let them calculate.',
       script: '"If interest rates stay higher for longer and fixed income keeps underperforming, what does that mean for the income target in year three?"',
       why: 'Client-generated implication is more motivating than broker-stated implication because the client cannot argue with their own math. The question should be open-ended enough that the answer requires real thought.'},
      {id:'py12', cat:'SPIN SELLING', principle:'NEED-PAYOFF',
       technique: 'Need-Payoff questions ask the client to state the value of the solution before you present it. "How useful would it be to have a 5-10% allocation that genuinely behaves differently from equities in a downturn?" extracts a client-voiced case for the product. When the client states the value of the solution in their own words, the subsequent product presentation is confirmation, not persuasion.',
       script: '"If we could show you something with a structural inflation hedge, no correlation to equities, and a clear tax advantage — how much of a difference would that make to the gap you just described?"',
       why: 'The most powerful single moment in a SPIN conversation is when the client voices why the solution matters to them. Every word the broker says after that is more credible.'},
      {id:'py13', cat:'ANCHORING', principle:'PRICE ANCHORING',
       technique: 'In alternative investments, anchor the conversation to the highest credible reference price before introducing the current entry point. Showing a Pétrus 2000 auction result of £3,000/bottle before discussing a primary market entry at £800 makes the secondary market potential explicit. For gold: show the inflation-adjusted 1971 value ($250 in today\'s money) against the current $3,000+ price to contextualise the structural upside.',
       script: '"Just to give you a sense of the range — the same cask profile from this distillery sold at Whisky Auctioneer eighteen months ago at £28,000. We\'re talking about entry at £18,500 today."',
       why: 'The anchor sets the reference frame. Everything after it is evaluated relative to the anchor, not in isolation. Works in both directions — a high anchor makes the current price feel like an opportunity.'},
      {id:'py14', cat:'FRAMING', principle:'CONTRAST EFFECT',
       technique: 'Present a clearly inferior option before the preferred option. In portfolio construction: show the "do nothing" scenario (real returns at current inflation with current allocation) before showing the alternative. The contrast makes the alternative look substantially better than it would in isolation. The inferior option is not a strawman — it is the actual status quo, and showing it honestly is both ethical and effective.',
       script: '"Let me show you two scenarios side by side. This is the real return trajectory of the current allocation at 4% inflation over ten years. And this is the same trajectory with a 10% alternative allocation. The gap by year ten is [X]. The question is whether that gap matters."',
       why: 'The contrast must be real, not manipulated — which makes it more credible. The visual side-by-side is more persuasive than the verbal description because the client can see the gap themselves.'},
      {id:'py15', cat:'CLOSING', principle:'THE TRIAL CLOSE',
       technique: 'Test readiness with a commitment-free question before asking for the decision. "Does this make sense for your situation?" or "Is this the kind of structure you\'d want to understand more about?" extracts a pre-close reading without triggering the resistance that accompanies a direct close. A yes to the trial close is permission to move to the actual decision.',
       script: '"Based on what we\'ve covered — does this feel like the kind of opportunity that fits your current objectives, or is there something that doesn\'t land right for you?"',
       why: 'The trial close surfaces objections before the close, giving you the opportunity to address them without the client having formally said no. It also gives the client who is ready to proceed an easy way to signal it.'},
      {id:'py16', cat:'CONTRAST & PRICING', principle:'THE CONTRAST PRINCIPLE — CIALDINI',
       technique: 'The contrast principle: the same thing is perceived differently depending on what preceded it. Present the higher-cost or less-favourable scenario FIRST, then present your product — it will appear far more attractive by comparison. Real estate agents show "setup" houses (overpriced poor properties) before showing the property they actually want to sell. Car dealers close the main deal first, then suggest accessories — £95 sounds trivial after a £15,000 commitment. Always structure your presentation so the price of your product is introduced AFTER a reference point that makes it look proportionate.',
       script: '"The premium for institutional-quality alternative storage and insurance on a cask portfolio is around 1.2% annually. Compare that to active equity fund management at 1.5-2% with daily correlation to market risk — the cost structure looks very different in that context."',
       why: 'Cialdini\'s research shows the contrast principle is nearly invisible to those it affects. The prospect experiences your product as genuinely better/cheaper — because compared to the prior reference, it is. The key is controlling the sequence of what they see first.'},
      {id:'py17', cat:'COMMITMENT', principle:'REJECTION-THEN-RETREAT — CIALDINI',
       technique: 'Make a larger initial request that you expect to be declined. When it is declined, retreat to the smaller request — your actual goal. The retreat functions as a concession, triggering reciprocity. The prospect feels they have won something, feels responsible for the final deal, and is more likely to follow through. Research: 76% compliance with the smaller request after retreating from the large one, vs 29% when the smaller request was made alone. Additionally, clients who feel they negotiated the terms are significantly more likely to honour the agreement.',
       script: 'Start with the full allocation size. If declined: "I hear you — given what you\'ve said, perhaps the right starting point is the smaller tranche. We can revisit the fuller position once you\'ve had a chance to see how it performs." The retreat is genuine — not a manufactured ploy.',
       why: 'The retreat triggers two powerful forces simultaneously: reciprocity (they concede, you concede) and commitment (they feel they co-created the outcome). The follow-through rate on concession-negotiated agreements is dramatically higher than on take-it-or-leave-it ones.'},
      {id:'py18', cat:'COMMITMENT', principle:'COMMITMENT & CONSISTENCY — CIALDINI',
       technique: 'Once a person takes a stand, they experience powerful internal pressure to remain consistent with that stand. A prospect who says "I believe non-correlated assets are important" has just created a consistency obligation. A prospect who fills in a risk questionnaire or signs an expression of interest has a much higher follow-through rate. Small acts of commitment predict large acts of compliance. The sequence: get a small yes first, then the large yes. The TM study: logic that contradicts a decision INCREASES commitment — people will defend what they have already chosen.',
       script: '"You mentioned earlier that you\'d like a portion of your portfolio working independently of equities. Given that you believe that — what would the right allocation to achieve that look like?" The belief came from them. You are simply following its logical conclusion.',
       why: 'The consistency principle is powerful because it is internal — the prospect is not pressured by you but by their own desire to appear consistent with their stated beliefs. The art is in surfacing commitments they have already made, not creating artificial ones.'},
      {id:'py19', cat:'COMMITMENT', principle:'FOOT IN THE DOOR — COMMITMENT ESCALATION',
       technique: 'Get a small initial commitment before asking for the main one. Cialdini\'s research: people who agreed to a small request (sign a petition) were significantly more likely to agree to a larger related request (allow a billboard on their lawn). In investment sales: get agreement on a small observable fact first ("You agree inflation at 5% annually compounds significantly over ten years?"). Then agree on a structural point ("And that cash deposits currently return below inflation?"). Then ask for the allocation. Each yes makes the next one more likely.',
       script: 'Sequence: "Is it fair to say [small obvious point]?" → "So you agree [slightly larger implication]?" → "Then the logical next step is [your product]?" Each question builds on the last and requires only a yes to a statement already agreed to in embryo.',
       why: 'Commitment escalation exploits the consistency principle in a structured sequence. The prospect who reaches the allocation question has already said yes to every logical premise that makes the allocation inevitable. Saying no at this point requires contradicting their own previous agreement.'},
      {id:'py20', cat:'BEHAVIOURAL FINANCE', principle:'LOSS AVERSION — KAHNEMAN & TVERSKY',
       technique: 'Losses are felt approximately 2.5x more powerfully than equivalent gains. A £10,000 loss causes more pain than a £10,000 gain causes pleasure. For investment sales, this means: frame the conversation around what will be LOST by not acting rather than what will be GAINED by acting. "If you do nothing, in three years you will have lost £73,500 in purchasing power" is approximately 2.5x more motivating than "if you invest, in three years you could have gained £73,500 in value." The loss frame is more powerful — and for genuine inflation scenarios, it is also more accurate.',
       script: '"I want to be honest with you about what doing nothing costs. At current inflation, the purchasing power of that £500k in three years is approximately £426,000. You won\'t see a loss on your statement — but you\'ll feel it every time you buy something. That\'s a real cost. The question is whether you want to stop it."',
       why: 'Kahneman won the Nobel Prize in Economics for Prospect Theory. Loss aversion is one of the most robustly replicated findings in behavioural science. It is also ethically deployable when the loss being described is real — inflation destroying purchasing power is not a hypothetical.'},
      {id:'py21', cat:'BEHAVIOURAL FINANCE', principle:'STATUS QUO BIAS — INERTIA OF CURRENT ALLOCATION',
       technique: 'People systematically overvalue their current state and undervalue change, even when change is clearly rational. A prospect who has held cash for three years at 3% while inflation ran at 5% is experiencing status quo bias — the "pain of doing nothing" never quite feels real enough to overcome the discomfort of acting. Recognise this: the opponent is not the product, not the market, not your competition. The opponent is inertia. Address it directly: "What specific thing would need to happen for you to feel the current allocation is not working?"',
       script: '"Most of the clients I speak to who have been comfortable with the current arrangement tell me the same thing: it feels fine until they actually look at the numbers in real terms. Have you ever done that calculation for your current allocation — what the real return has been after inflation?"',
       why: 'Naming the bias removes its power. Once a prospect recognises they are defaulting to the status quo rather than choosing it, they are more likely to genuinely evaluate the alternative. The question at the end of the script surfaces whether they have ever stress-tested their inertia.'},
      {id:'py22', cat:'BEHAVIOURAL FINANCE', principle:'AVAILABILITY HEURISTIC — RECENT EVENTS FEEL MORE LIKELY',
       technique: 'People estimate the likelihood of an event based on how easily examples come to mind — not on actual probability. A stock market crash in 2022 makes another crash feel imminent in 2023. A whisky auction record in 2024 makes the next record feel inevitable in 2025. Both overweight recent information. For brokers: when clients are over-weighting recent negative events ("the market just crashed"), use the availability heuristic against the status quo. Show them the 10-year data — the crash they are worried about is one data point in a longer trend. When they are over-weighting recent positive events (crypto, meme stocks), use the heuristic to redirect: "The same feeling told people to buy more crypto in November 2021."',
       script: '"The concern you\'re describing — that the recent [event] means this is the wrong time — is natural. Our brains weight recent information heavily. But the 10-year chart looks like this..." [show data]. "The investors who made decisions based on 10 years of data rather than 10 months have consistently outperformed."',
       why: 'The availability heuristic is universal. The broker who understands it can identify when a client\'s concern is evidence-based versus recency-driven — and respond to the correct underlying cognitive state.'},
      {id:'py23', cat:'BEHAVIOURAL FINANCE', principle:'OVERCONFIDENCE BIAS — 80% THINK THEY ARE ABOVE AVERAGE',
       technique: 'Research consistently shows 80%+ of investors believe they are above-average at timing the market and picking assets. This is statistically impossible and practically expensive. For brokers: use the overconfidence bias as a trust anchor. "Most investors believe they can time the market — the data says fewer than 5% of active retail investors outperform a passive strategy over ten years. The reason we focus on structural allocation rather than timing is that the data does not support the timing approach, regardless of how often it feels right." Positioning your structured product as the antidote to overconfidence builds credibility and differentiates from the noise.',
       script: '"Here\'s something interesting: 84% of retail investors in a recent study rated their investment timing ability above average. Statistically, most of them are wrong. The clients who have done best with me are the ones who gave up on timing and focused on structural positioning. Does that resonate with where you\'ve been?"',
       why: 'Pointing out overconfidence bias serves two functions: it warns the client away from alternatives (trying to time the market themselves) and it positions the structured approach as the sophisticated, data-driven alternative.'},
      {id:'py24', cat:'BEHAVIOURAL FINANCE', principle:'SUNK COST FALLACY — HOLDING LOSERS',
       technique: 'Investors hold losing positions beyond rational grounds because selling crystallises the loss, and our loss aversion means we cannot bear to make the loss "real." "I\'ll hold until it recovers" is sunk cost thinking — the money already spent is irrelevant to the decision about what to do now. For brokers encountering clients locked in underperforming positions: "The question is not what that position cost you. The question is: if you had the cash today, would you put it back into that position or into something with a better forward-looking case?" This separates the sunk cost from the current decision.',
       script: '"You\'ve mentioned the [equity/fund/position] is down 30% and you\'re waiting to recover. I want to ask you something: if I gave you the current value in cash today — £70,000 — would you immediately reinvest it back into that same position? Or is there something you\'d rather do with it?" The answer tells you everything.',
       why: 'The sunk cost reframe is genuinely useful for the client — it helps them think more clearly. It also unlocks capital that has been psychologically frozen in a losing position. It must be delivered as a genuine question, not a trick — the client needs to feel it is in their interest.'},
      {id:'py25', cat:'BEHAVIOURAL FINANCE', principle:'DECOY EFFECT — ARIELY\'S THIRD OPTION',
       technique: 'Introducing a third option changes which of the original two looks most attractive. Ariely\'s classic example: magazine subscriptions — online only (£59), print only (£125), online + print (£125). The print-only option is the decoy — no one chooses it, but its presence makes the online + print bundle look like extraordinary value. Applied to investment: when presenting a product, include a reference point (the alternative universe) that makes your product look optimal by comparison. Not a fake option — a genuine alternative with a different risk/return/liquidity profile that makes the product\'s characteristics shine.',
       script: '"There are essentially three ways to approach this allocation. Pure cash — you get liquidity and certainty with real return below zero. Pure equity — you get potential upside with full market correlation and drawdown risk. Or the structured alternative — you get a defined return profile, lower correlation, and in this case an IHT wrapper. For this specific allocation, which of those profiles fits best?"',
       why: 'The decoy effect works because value is always relative, never absolute. By structuring the choice, you control the reference frame. The key is that all three options must be real — manufactured options destroy credibility the moment the client notices.'},
      {id:'py26', cat:'BEHAVIOURAL FINANCE', principle:'HERDING BIAS — THE DANGER OF FOLLOWING THE CROWD',
       technique: 'Herding: people systematically follow the behaviour of others, especially under uncertainty. This produces asset bubbles (everyone buys crypto at $60k because everyone is buying) and systematic underperformance (investors buy high and sell low by following sentiment). For brokers: position your product explicitly against herding. "The time to be positioned in non-correlated assets is before everyone wants them — not after the newspaper has written about them." Scarcity language reinforces this: "The clients who moved into this allocation two years ago are not looking for an entry point now — because they already have one."',
       script: '"I want to share something with you. The last three times this specific asset class made the front page of the financial press — the entry price was 40-60% higher than it is today. The clients I work with who have done best got in before the herd noticed. The question is whether you want to be ahead of that narrative or in the middle of it."',
       why: 'Anti-herding positioning is powerful because it flatters the prospect\'s self-image as a sophisticated, independent-minded investor. Most clients believe they think independently — this framing gives them the opportunity to prove it.'},
      {id:'py27', cat:'CIALDINI', principle:'THE "BECAUSE" EFFECT — LANGER\'S COPIER STUDY',
       technique: 'Harvard psychologist Ellen Langer\'s study: adding the word "because" to any request increases compliance from 60% to 93% — even when the reason given is trivial or circular. "May I use the copier because I\'m in a rush?" (94% comply). "May I use the copier because I need to make copies?" (93% comply). The word "because" itself triggers an automatic compliance response. Applied to investment: never make a claim without a "because." "You should consider this allocation because [reason]" is 33 percentage points more persuasive than "you should consider this allocation." The reason matters less than the word.',
       script: 'Review every statement you make in a pitch and add "because" + a genuine reason. "This is the right time to be looking at this because the macro conditions are aligned in a way we haven\'t seen since [date]." "The tax benefit matters particularly now because the upcoming budget may change the relief structure." "I\'m calling you about this specifically because of the conversation we had in [month] about inflation."',
       why: 'The "because" effect is a powerful shortcut to compliance — but it is only ethical when the reasons given are real. Circular reasons work in Langer\'s low-stakes experiment; in investment sales, the reason must be genuinely compelling. The value of the technique is that it forces the broker to articulate a reason — which improves the quality of the pitch regardless of the compliance effect.'},
      {id:'py28', cat:'CIALDINI', principle:'EXPENSIVE = GOOD — THE PRICE-QUALITY HEURISTIC',
       technique: 'Cialdini\'s turquoise jewellery study: items priced at double their actual value sold faster than at the correct price, because buyers used price as a proxy for quality. The "expensive = good" heuristic is deeply embedded and is exploited daily in retail, hospitality, and financial services. For investment: premium positioning increases perceived quality. Never apologise for or minimise fees and minimums — explain them as a feature. "The minimum exists because the institutional structure requires a critical mass to deliver the return profile — below it, the economics don\'t work." This is both true and reassuring.',
       script: '"I want to be upfront about the structure: the minimum is [£X] and the management fee is [Y]%. The reason those numbers are where they are is that this is an institutional-grade product — below the minimum, the cost-benefit doesn\'t make sense, and below the fee, the management quality would have to be different. The clients who have benefited most are the ones who engaged at the right scale from the start."',
       why: 'Apologising for price signals that the product is overpriced. Explaining price as a structural feature of quality signals confidence. The heuristic works in your favour when you own it — and against you when you hide from it.'},
      {id:'py29', cat:'BEHAVIOURAL FINANCE', principle:'THE IKEA EFFECT — WE VALUE WHAT WE BUILD',
       technique: 'Harvard research (Norton, Mochon, Ariely 2012): people valued their own assembled IKEA boxes 63% higher than identical pre-assembled boxes. Labour investment creates psychological ownership — the brain treats effort as evidence of value. The IKEA effect works in sales when you involve the prospect in building the frame before presenting the solution. Give them something to do: "Before we speak again, would you mind noting the three things most important to you about how this capital works?" Their effort creates co-ownership of the conclusion.',
       script: '"Let me give you something to think about before our next call: write down two questions your accountant would want answered about a structure like this. When we speak, I\'ll walk through them directly — and that way the conversation is built around your specific situation, not a generic pitch." [They build the frame. They now own the process.]',
       why: 'Source: Ariely, Predictably Irrational. Self-generated effort produces irrational overvaluation of the outcome. A prospect who has co-built the decision frame will fight to defend it — which means they\'re fighting for your solution, not against it.'},
      {id:'py30', cat:'BEHAVIOURAL FINANCE', principle:'THE FREE EFFECT — ZERO CHANGES DECISIONS IRRATIONALLY',
       technique: 'MIT study (Ariely & Shampanier 2007): at 15¢ vs 1¢, 73% chose the Lindt truffle. At 14¢ vs 0¢ (free), 69% chose the Hershey kiss — reversing the preference. Same delta, radically different choice. "Free" does not merely reduce cost to zero — it adds irrational positive affect and eliminates perceived loss risk entirely. Apply it to access and process, never to the product: "complimentary due diligence pack," "free portfolio review," "no-cost introduction call." The word free carries affective weight that "no obligation" never does.',
       script: '"We do a complimentary allocation analysis — no cost, no commitment — that shows how a position like this would sit alongside your existing portfolio. If the numbers don\'t support it, we say so. Would that be useful?"',
       why: 'Source: Ariely, Predictably Irrational. Free eliminates loss-risk perception (Prospect Theory mechanism). Never apply to the product itself — free assets signal low quality (price-quality heuristic, py28). Apply to the process of engaging.'},
      {id:'py31', cat:'ANCHORING', principle:'ARBITRARY COHERENCE — FIRST PRICE ANCHORS ALL FUTURE VALUATIONS',
       technique: 'Ariely\'s experiment: participants wrote the last two digits of their Social Security number, then bid on wine, chocolates, and electronics. Those with higher digits bid 60-120% more — despite the anchor having zero logical connection to the item\'s value. The anchor is "arbitrary" (random first number) but creates "coherent" internal reference (all subsequent valuations cluster around it). System 1 treats the first number heard as a reference point; System 2 adjusts away from it, but always insufficiently. Always anchor high first — comparable values, tax reclaimed, alternative cost — before stating your entry price.',
       script: '"The 2015 Springbank cask allocation traded at £38,000 at auction last year. The 2018 we\'re placing today is structured on the same trajectory — the entry point reflects the earlier stage of that cycle." [The prospect\'s mental range now starts at £38,000, not at your minimum.]',
       why: 'Source: Ariely, Predictably Irrational + Kahneman, Thinking Fast and Slow. The anchor effect is immune to expertise — experienced real estate agents anchored by a listed price valued properties identically to naive buyers. Always own the first number in the conversation.'},
      {id:'py32', cat:'CONTRAST & PRICING', principle:'PRICE-PLACEBO EFFECT — HIGHER PRICE CHANGES THE EXPERIENCE',
       technique: 'Ariely\'s pain relief study: a fake pill described as costing $2.50 produced pain relief in 85% of subjects. The same fake pill described as 10¢ produced relief in 61%. The brain, told something is expensive, produces the neurochemical experience to match — expectation triggers real dopamine and endorphin release. Higher price changes the physiological experience, not just the perception. Apply: "the minimum is £X for a reason" is not a defensive statement — it is a signal to the brain that what follows will be premium. Premium expectation produces premium experience of service quality, communication quality, and outcome satisfaction.',
       script: '"The minimum for this allocation is £25,000. That\'s deliberate — it keeps the capital pool in the hands of people who are committed to the full maturity cycle. The clients who\'ve done best are the ones who engaged at the right scale from the start." [Premium framing before any other fact is stated.]',
       why: 'Source: Ariely, Predictably Irrational. Complements py28 (expensive = good). Together they show that premium pricing is not just a perception — it changes the actual client experience of quality, service, and outcome. Never discount, always explain.'},
      {id:'py33', cat:'CONTRAST & PRICING', principle:'RELATIVITY OF EXPECTATIONS — CONTROL THE COMPARISON SET',
       technique: 'We do not evaluate options in absolute terms — we evaluate them relative to the options presented alongside them. Ariely: adding an inferior "decoy" option to a choice between two alternatives dramatically increases preference for the superior option. The brain needs a reference point; give it a bad one, and the good option looks excellent. Extended form: expectations primed before experience shape the experience itself. Students told a beer contained balsamic vinegar before tasting found it unpleasant; those told after were fine with it. The category label poisoned the experience. Always prime positively and always choose the comparison set — never let the prospect choose it.',
       script: '"Before you look at the performance data, I want you to hold two comparisons in mind: one, a UK equity ISA averaging 6% per year with full market correlation. Two, cash at 4.2% with 3.8% inflation — so 0.4% real. What you\'re about to see is how this asset class has performed against both of those, on a like-for-like risk-adjusted basis." [You have set the comparison set before the data is seen.]',
       why: 'Source: Ariely, Predictably Irrational. The decoy effect and expectation priming both operate pre-consciously. The comparison set you choose at the start of the presentation determines how every subsequent number is felt — not just understood.'},
      {id:'py34', cat:'COMMITMENT', principle:'PRE-SUASION — THE PRIVILEGED MOMENT (CIALDINI)',
       technique: 'Cialdini\'s Pre-Suasion thesis: the most powerful point of influence is not during the message — it is the moment immediately before the message, when you control what is salient in the listener\'s mind. Whatever captures attention becomes the perceived cause of subsequent experience. If you can make a concept salient immediately before a decision, that concept will disproportionately shape the decision even if it is logically irrelevant to it. A "privileged moment" is a window of heightened receptivity you can engineer through deliberate pre-framing. The order of topics in a meeting is itself influence — it is not neutral administration.',
       script: '"Before I explain the structure, I want to understand something: when you think about your capital in 10 years, what does \'it worked\' look like? Not in numbers — in what you\'re able to do or not do." [Their answer now becomes the evaluative frame through which every subsequent fact is processed.]',
       why: 'Source: Cialdini, Pre-Suasion (2016). The pre-suasion frame determines which System 1 associations activate before System 2 analysis begins. Control the frame before the pitch and you control the cognitive lens through which the pitch is evaluated.'},
      {id:'py35', cat:'FRAMING', principle:'FEATURED I vs FEATURED WE — PRIMING INDEPENDENCE vs CONSENSUS',
       technique: 'Cialdini\'s Pre-Suasion research: when subjects were primed with "I" identity before making a choice, they made more independent, uniqueness-seeking decisions. When primed with "we" identity, they made more conformist, consensus-following decisions. The self-concept activated at the moment of decision determines the decision type. Use "featured we" when presenting social proof and consensus behaviour. Use "featured I" when you want the prospect to feel they are making a distinctive, independent, contrarian choice — particularly valuable with HNWIs who pride themselves on being different.',
       script: 'Featured we: "Most of our clients at this stage are allocating 8-12% of liquid assets into non-correlated positions — it\'s become the institutional consensus." [Activates conformity.] // Featured I: "This isn\'t for everyone — it\'s for investors who want to think for themselves about where the real value is, outside the mainstream." [Activates autonomy and distinctiveness.]',
       why: 'Source: Cialdini, Pre-Suasion. Sequencing: use "we" framing to establish social proof baseline, then shift to "I" framing to close on the prospect\'s unique decision. The shift from consensus to individual choice is the transition from certainty-building to action.'},
      {id:'py36', cat:'FRAMING', principle:'COGNITIVE EASE — FLUENCY EQUALS TRUTH (KAHNEMAN)',
       technique: 'Kahneman, Thinking Fast and Slow: when processing a message feels easy (high cognitive ease), the brain tags it as familiar, true, and good. When processing is effortful (cognitive strain), messages feel less true, less trustworthy, more risky. Study: stocks with pronounceable ticker symbols outperformed stocks with awkward ones in the days after IPO — solely due to fluency bias. Simple language, short sentences, repetition, and primed familiarity all increase cognitive ease — and perceived truth. The pitch that feels simple feels true. The pitch that requires effort to follow feels risky.',
       script: '"Gold is money that governments can\'t print." [Not: "Gold represents a non-sovereign, non-fiat store of monetary value with a supply ceiling determined by geological scarcity."] // Simplify to the thesis. Repeat the thesis in different words three times per call. Pre-send materials with simple visual summaries — when you say these things on the call, they feel like things the client already knows.',
       why: 'Source: Kahneman, Thinking Fast and Slow. Cognitive ease is a System 1 mechanism — it operates before System 2 analysis. The brain uses ease of processing as a proxy for truth. Complexity is not sophistication — it is friction. Eliminate it.'},
      {id:'py37', cat:'BEHAVIOURAL FINANCE', principle:'THE PEAK-END RULE — ONLY THE PEAK AND THE END ARE REMEMBERED',
       technique: 'Kahneman\'s research on experienced vs remembered utility: people do not remember the average quality of an experience. They remember two moments only: (1) the peak — the most intense positive or negative moment, and (2) the end. A colonoscopy that was 24 minutes of moderate discomfort followed by 3 minutes of mild discomfort was rated less unpleasant than a 20-minute procedure with the same peak — because the longer procedure\'s gentler ending rewrote the memory. The experiencing self lives the moment; the remembering self judges by the peak and the end. All subsequent referrals, repeat business, and relationship quality depend on what the remembering self records.',
       script: 'Engineer the peak: "What I know from working with people in your position is that the ones who make this allocation in the next 12 months are the ones who look back at this period as the moment they got ahead of the curve. I think you\'re one of those people." [This is the most emotionally resonant moment — make it the peak.] // Engineer the end: never trail off with admin. End every meeting with a statement of genuine confidence and a clear next step.',
       why: 'Source: Kahneman, Thinking Fast and Slow + colonoscopy study. The entire relationship is disproportionately defined by two moments you can engineer. Neglecting either — an unremarkable meeting, an administrative sign-off — is a structural failure of relationship management.'},
      {id:'py38', cat:'BEHAVIOURAL FINANCE', principle:'HYPERBOLIC DISCOUNTING — PRESENT BIAS & INVESTMENT STALLING',
       technique: 'Behavioural economics finding: people discount future rewards at a steeply declining rate. £100 today is preferred over £110 in a week by many people. But £100 in a year vs £110 in a year and a week — nearly everyone takes the £110. Same seven-day delay; radically different choice. The near future is discounted hyper-steeply; the far future more normally. Why HNWIs stall: the benefits of an alternative investment (capital growth, tax relief crystallisation, legacy) are temporally distant. The costs (writing the cheque, taking the risk, departing from familiar assets) are immediate. Present bias makes the cost feel enormous and the benefit feel abstract — regardless of the client\'s analytical sophistication. Counter by front-loading immediate benefits.',
       script: '"The tax relief on an EIS investment is immediate — filed this tax year, recovered in your next self-assessment return. The gain is not in year seven — it starts the moment the HMRC confirmation arrives." [Make the benefit feel now, not future.] // "The allocation closes on the 30th — that\'s a concrete date. The upside is five to seven years out. The only decision that has a deadline is the one in front of you today."',
       why: 'Source: Behavioural economics, Laibson 1997 / O\'Donoghue & Rabin 1999. The antidote to present bias is making future benefits feel present and making the cost of inaction feel immediate. Tax relief, storage rate locks, and allocation windows all create present-tense consequences to the decision.'},
    ];

    /* ═══════════════════════════════════════════════════════════
       REBUTTALS — SPECIFIC OBJECTION RESPONSES
       ═══════════════════════════════════════════════════════════ */
    var REBUTTALS = [
      {id:'rb1', cat:'DELAY', objection:'"I\'ll think about it"',
       rebuttal: 'The two most common things people mean when they say this: I don\'t have enough information to decide, or I have an objection I haven\'t told you yet. Which is it? If it\'s information, let\'s identify the specific gap and fill it now. If there\'s something that doesn\'t sit right, I\'d rather know what it is than send you home to think about it in a vacuum.',
       why: 'The direct question creates momentary discomfort but resolves ambiguity. Most clients will identify the real objection once asked directly — which moves the conversation forward rather than ending it.'},
      {id:'rb2', cat:'DELAY', objection:'"Send me the paperwork and I\'ll look it over"',
       rebuttal: 'Of course — I\'ll send the key documents. Before I do, it would help me to know which part of the decision is paper-dependent. Is it the structure, the risk profile, the tax mechanics, or the performance data? That way I can flag the three pages that actually answer your question rather than leaving you with a hundred to navigate.',
       why: 'Accepting the request while asking what is in the paperwork they need surfaces the real question. Often the paperwork request is a polite ending, and this response reopens the conversation without challenging it.'},
      {id:'rb3', cat:'COST', objection:'"The fees are too high"',
       rebuttal: 'Understood — and I\'d rather you scrutinise fees than not, because cheap structures sometimes cost more in ways that aren\'t visible. The fee on this is [X%] annually. The equivalent fee on a managed equity fund — which has lower expected returns and full correlation to the market — is typically [Y%]. And the tax alpha here — specifically the [30% EIS relief / tax-free VCT income / IHT exemption] — eliminates [Z] multiples of the total fee in year one. The fee comparison that matters is cost relative to net benefit, not cost relative to zero.',
       why: 'Never apologise for fees; explain them in context. The tax alpha point is often the strongest response because it demonstrates that the net-of-tax cost is frequently negative in year one for tax-advantaged structures.'},
      {id:'rb4', cat:'GOLD', objection:'"Gold doesn\'t pay a dividend"',
       rebuttal: 'Correct. Neither does a house you hold as a long-term asset, nor does a pension during accumulation, nor does the emergency cash reserve in every financial plan ever written. The portfolio function of gold is not income generation — it is correlation reduction and purchasing power protection. Asking gold to pay a dividend is like asking your house insurance policy to pay rent. Different assets do different jobs.',
       why: 'Accepts the objection entirely and reframes it as a category error. The insurance analogy is particularly clean because the client already accepts that insurance does not generate yield.'},
      {id:'rb5', cat:'GOLD', objection:'"I already own some gold in my pension"',
       rebutral: 'That\'s a great start, and it\'s worth understanding what form it\'s in. Most pension gold exposure is via a gold ETF or equity miner exposure — both of which track gold with added equity and counterparty risk. Physical allocated gold — outside the pension and outside the banking system — behaves differently in a systemic stress scenario. The client who owns a gold ETF inside a pension finds out the difference in the crisis they were trying to hedge.',
       why: 'Validates the existing position while revealing a structural distinction the client probably has not considered. Creates a specific, actionable gap without dismissing what they already have.'},
      {id:'rb6', cat:'WHISKY', objection:'"Whisky is speculative"',
       rebutral: 'Any asset whose value depends on future demand is speculative to some degree — including equities, property, and bonds. The question is the quality of the supply and demand drivers. Whisky supply is constrained by production timelines that cannot be accelerated. Demand is driven by India, China, and the global premiumisation trend — structural demographic shifts, not sentiment cycles. The Rare Whisky 101 index has outperformed the FTSE 100 over 10 and 15-year periods. That is not speculation — that is a track record.',
       why: 'Accepts the speculative label universally and pivots to the quality of the thesis. The index performance data is verifiable and provides factual grounding.'},
      {id:'rb7', cat:'WHISKY', objection:'"What happens if the market crashes?"',
       rebutral: 'The market that would crash is a stock market or bond market — and neither of those markets determines the price of a Scotch whisky cask. In 2008 and 2020, when equity markets fell 30-40%, whisky auction prices continued rising. This is not because whisky investors are smarter — it is because whisky casks cannot be panic-sold at midnight on a trading platform. The illiquidity that concerns some clients is the same mechanism that protected values during the last two crises.',
       why: 'Addresses the systemic risk concern by demonstrating independence from financial market mechanisms. The historical performance during specific crises is the strongest factual response available.'},
      {id:'rb8', cat:'TAX', objection:'"I\'ll take the tax hit — I prefer straightforward investments"',
       rebutral: 'That\'s a completely legitimate preference, and I respect it. Can I ask what the last significant tax liability looked like? The reason I ask is that a straightforward investment at a 45% marginal rate on income and a 24% CGT rate on gains — compared to a tax-advantaged structure with the same underlying exposure — generates materially different outcomes for the same capital and risk profile. "Straightforward" often means simple to understand, not simple to optimise. They can coexist.',
       why: 'Respects the preference before challenging it. The diagnostic question about their last tax liability activates their memory of a real cost — which is more effective than an abstract statement about future tax.'},
      {id:'rb9', cat:'EIS/VCT', objection:'"EIS is too risky — small companies fail"',
       rebutral: 'They do — and EIS is designed with that in mind. The 30% upfront income tax relief and the loss relief at the marginal rate mean that a total loss on an EIS investment at 45% costs approximately 38.5p per pound invested. The government is explicitly subsidising that risk because it wants capital flowing into early-stage UK companies. For the risk to cost you more than it would outside EIS, the company would need to fail AND the tax system would need to change retroactively. The structure is specifically built for the reality that some early-stage companies fail.',
       why: 'Accepts the risk, quantifies the real downside, and makes the tax subsidy central to the downside case. The "government is subsidising the risk" framing is disarming.'},
      {id:'rb10', cat:'EIS/VCT', objection:'"VCTs have had poor recent performance"',
       rebutral: 'Selected VCTs have had a difficult period in 2022-2023, as has almost every growth-oriented investment in a rising-rate environment. The comparison set that matters is not VCTs versus last year\'s returns — it is VCTs versus equivalently risky assets on a tax-adjusted basis. A VCT dividend that is tax-free at 5% is the equivalent of a 9.1% gross return for a 45% taxpayer. Few investment-grade instruments matched that on a risk-adjusted basis in the same period. Performance discussions for tax-advantaged vehicles should always start with the tax-adjusted return, not the gross NAV movement.',
       why: 'Validates the observation while reframing the comparison framework. The gross-up calculation makes the real performance visible in a way that raw NAV data obscures.'},
      {id:'rb11', cat:'PROPERTY', objection:'"Property is too illiquid"',
       rebutral: 'Relative to equities, yes. Relative to the other assets generating similar returns — PE, private credit, infrastructure — property is actually the most liquid of the illiquid asset classes. You can borrow against it, you can sell a portion, you can restructure the income. The true illiquidity question is: what is the probability you need this specific capital within 12 months? If the answer is low, the illiquidity premium you earn for property ownership is compensation for an unlikely scenario. That is a favourable trade.',
       why: 'Contextualises property illiquidity within the alternative asset class peer group rather than against equities. The probability framing turns an abstract objection into a personal assessment.'},
      {id:'rb12', cat:'PROPERTY', objection:'"I already own my house"',
       rebutral: 'Your primary residence is not a portfolio asset — it is a lifestyle asset with some capital appreciation characteristics. You cannot sell 20% of it, you cannot earn a rental yield from it, and it is denominated in a single local market. Investment property does all of those things, and it sits outside your pension and ISA wrappers so it diversifies the tax treatment of your total wealth — not just the asset class. Most clients who own their home have significant residential property concentration; the investment case is for a different kind of property, not more of the same.',
       why: 'Challenges the implicit assumption that residential home ownership counts as property allocation. The tax-wrapper diversification angle is rarely considered and adds genuine value to the conversation.'},
      {id:'rb13', cat:'PROCESS', objection:'"I need to talk to my wife / husband first"',
       rebutral: 'Of course — this absolutely warrants a joint conversation. The most useful thing I can do is make sure you have everything you need to have that conversation clearly. Is there a specific concern you think is likely to come up that we should make sure we\'ve covered? And would it make sense to schedule a call where I can speak to both of you at the same time, so the information is consistent and any questions can be addressed together?',
       why: 'Validates and progresses simultaneously. The second question (joint call) is a soft close that keeps momentum without pressuring the client to circumvent their partner.'},
      {id:'rb14', cat:'MARKET', objection:'"Now is not a good time — the economy is uncertain"',
       rebutral: 'The economy has been uncertain every single year that gold, farmland, and whisky casks have outperformed cash. There is no calendar year in the modern era where the economy was described as certain. The relevant question is not whether uncertainty exists — it is whether that uncertainty favours or disfavours the specific asset. Macro uncertainty specifically favours assets outside the credit-dependent financial system, which is precisely the category we\'re discussing.',
       why: 'Calls out the implicit impossibility standard (certain economic conditions) and reframes uncertainty as a feature of the current argument, not a reason to wait.'},
      {id:'rb15', cat:'GOLD', objection:'"Gold has already run — I missed the move"',
       rebutral: 'In 2019, gold was at $1,500 and many people said it had already run from $1,100. In 2022 it was at $1,800 and many people said the same. The structural drivers — central bank buying, dollar reserve diversification, real yield compression, and debt ceiling dynamics — have not changed. They have intensified. The investors who waited to confirm the move have consistently paid more for the same structural argument. The case for gold today is not that it will repeat the last move — it is that the macro conditions generating the move are more entrenched than they were when gold was $1,500.',
       why: 'Directly addresses the timing regret with a specific price history that makes the objection look like a recurring pattern rather than a one-time miss.'},
      {id:'rb16', cat:'DELAY', objection:'"I need to speak to my wife/husband/partner first"',
       rebuttal: 'Absolutely — and I\'d encourage that conversation. What I\'d find helpful is to know: is the conversation you want to have with them about whether to do this, or about how much to do? Those are different conversations and I can help you frame whichever one is relevant. If it\'s the "whether" conversation, let\'s make sure you have the three clearest points to explain the rationale. If it\'s the "how much," let\'s look at the sizing options so you go in with something concrete.',
       why: 'Validates the spousal consultation without accepting it as a close-ender. Identifies whether the objection is genuine (need partner\'s approval) or a delay tactic. Moves the conversation forward by offering concrete help for the spousal discussion.'},
      {id:'rb17', cat:'DELAY', objection:'"I\'m going to think about it and come back to you"',
       rebuttal: 'I want to make sure thinking about it is actually useful. The things most clients think about: the fees (we\'ve covered those), the structure (we\'ve gone through that), and whether the timing is right (we\'ve looked at the macro case). What specifically are you going to sit with? Because if there\'s a gap in the picture, it\'s better to fill it now than to send you home to think about an incomplete version of this.',
       why: 'The "think about it" response is almost never about thinking — it is about a gap in certainty. This response respectfully surfaces which of the Three Tens is below 7, so it can be addressed before the call ends.'},
      {id:'rb18', cat:'PROCESS', objection:'"I\'m already working with an IFA / wealth manager"',
       rebuttal: 'That\'s a good sign — it means you\'re taking this seriously. The question is whether your current adviser has access to this specific allocation. Most IFAs are restricted to the products on their panel, which typically excludes cask whisky, physical gold, EIS ventures, and private alternatives. That\'s not a criticism — it\'s a structural reality of how regulated advice works. What I do is complementary: I focus on the alternative 5-10% that sits alongside whatever your main adviser is doing with the core portfolio.',
       why: 'Validates the IFA relationship completely, then positions the product as complementary rather than competitive. Never attack the existing adviser — the client chose them and will defend them.'},
      {id:'rb19', cat:'MARKET', objection:'"The market could crash and take everything with it"',
       rebuttal: 'That\'s exactly why non-correlation matters. In 2008, equities dropped 50% and gold rose 25%. In the 2020 crash, equities dropped 35% intraday and whisky auction prices were up 12% for the year. The assets we work with are uncorrelated specifically because they trade on fundamentals that are independent of equity sentiment — supply constraints, global demand, demographic shifts. The question isn\'t whether the market will crash — it will. The question is how much of your wealth needs to be in assets that crash with it.',
       why: 'Turns the market crash concern into an argument FOR the product rather than against it. The specific historical data makes the abstract argument concrete.'},
      {id:'rb20', cat:'EIS/VCT', objection:'"EIS sounds complicated and risky"',
       rebuttal: 'The complication is upfront — understanding the structure takes 20 minutes. After that, it runs itself. The risk point is worth addressing directly: EIS companies are early-stage, which is inherently more volatile than blue-chips. But EIS relief means the government returns 30% of your investment as income tax relief immediately, and if the investment fails entirely, loss relief returns another 30-45% — meaning on a £100,000 investment, your effective exposure is closer to £25,000-40,000 depending on your tax rate. The net risk profile, adjusted for the tax mechanics, is different from what the headline looks like.',
       why: 'Directly addresses both concerns (complexity and risk) with facts rather than reassurance. The specific numbers (30% IT relief + 30-45% loss relief) transform the risk calculation.'},
      {id:'rb21', cat:'WHISKY', objection:'"I don\'t drink whisky — is it still relevant for me?"',
       rebuttal: 'The return on whisky has nothing to do with drinking it. A cask of Glenfarclas 2012 that sold at auction in 2024 for £45,000 was not purchased by someone who planned to drink 500 litres of 12-year-old single malt. It was purchased by a distillery, an independent bottler, or a collector — all of whom are buying on price discovery, not palate. The commodity and the consumption product are two completely different markets. You don\'t need to like oil to profit from an oil royalty.',
       why: 'Instantly reframes the asset from "drink" to "commodity with a documented secondary market." The oil royalty analogy makes the concept immediately clear to a non-whisky drinker.'},
      {id:'rb22', cat:'COST', objection:'"The minimum is too high for me right now"',
       rebuttal: 'I hear you. Let me ask you this: is the minimum too high in absolute terms, or relative to how much of your portfolio this would represent? Because if it\'s the percentage that feels uncomfortable, there may be a smaller entry point that still captures the structural benefit. If it\'s the absolute number that\'s the issue, I\'d rather know that now so we\'re not wasting each other\'s time — but I\'d also ask: is that permanent, or is it a timing question?',
       why: 'Surfaces whether the objection is about affordability or positioning in the portfolio. Asks a direct disqualifying question rather than pushing — which builds trust and, if the client is genuinely qualified, usually surfaces a solution.'},
    ];

    /* ═══════════════════════════════════════════════════════════
       NLP — LANGUAGE PATTERNS & PRESUPPOSITIONS
       Source: Belfort SLP, Milton Erickson, Bandler/Grinder
       ═══════════════════════════════════════════════════════════ */
    var NLP = [
      {id:'n1', cat:'EMBEDDED COMMANDS', principle:'EMBEDDED COMMAND',
       technique: 'Embed the desired action as a subordinate clause, not a direct request. "I\'m not sure when you\'ll decide to invest — but as you begin to see the opportunity here, what questions do you have?" The command "decide to invest" and "see the opportunity" are delivered inside a softener, bypassing conscious resistance. The listener processes the command without registering it as a directive.',
       script: '"I don\'t know exactly when you\'ll feel comfortable moving forward, but as you consider what this could mean for your portfolio, I\'d love to know what\'s most important to you here."',
       why: 'Embedded commands land below the threshold of resistance. The prospect\'s conscious mind is focused on answering your surface question; the unconscious mind has already registered the embedded instruction.'},
      {id:'n2', cat:'PRESUPPOSITIONS', principle:'PRESUPPOSITIONAL LANGUAGE',
       technique: 'Build the decision into the question as a given. Instead of "Would you like to invest?" ask "When you decide to move forward, would you prefer to start with a smaller position or go straight to the full allocation?" The presupposition is that a decision has already been made — only the details remain. The prospect must reject the presupposition to refuse, which is a much higher psychological bar than simply saying "not yet".',
       script: '"When you\'re ready to take the first position, what matters most to you — the IHT benefit or the income generation?"',
       why: 'Forces the prospect to inhabit the post-decision frame. Objecting requires them to back out of a position they\'ve already been placed in, not simply decline an offer.'},
      {id:'n3', cat:'PRESUPPOSITIONS', principle:'TEMPORAL PRESUPPOSITIONS',
       technique: 'Use time-based presuppositions to make future action feel inevitable. "Before you decide on the size of your allocation..." presupposes an allocation will happen. "After you\'ve had a chance to review the documentation, we can finalise..." presupposes they will review and a finalisation will occur. The word "when" does more work than "if" in every sentence in which it appears.',
       script: '"Before we talk about the paperwork, let me make sure I\'ve answered all your questions so you feel completely comfortable. What\'s still on your mind?"',
       why: '"Before we talk about paperwork" presupposes paperwork. The prospect is mentally inside the process before they\'ve consciously agreed to enter it.'},
      {id:'n4', cat:'TAG QUESTIONS', principle:'THE TIE-DOWN',
       technique: 'A tag question at the end of a statement invites micro-agreement and builds momentum. "That makes sense, doesn\'t it?" "You\'d agree that protecting purchasing power matters, wouldn\'t you?" Each yes is a small brick of certainty. A series of ten tie-down agreements creates a trajectory — the prospect is already saying yes repeatedly before the close arrives. The SLP certainty scale moves from 4 to 7 in part through accumulated micro-agreements.',
       script: '"Inflation at 5% on a £500k portfolio is £25,000 of silent erosion every year. That\'s a meaningful number, isn\'t it? And you\'d agree that leaving it unaddressed isn\'t a neutral decision — it\'s an active one?"',
       why: 'The cumulative yes builds an expectation of continued agreement. Saying no to the close interrupts a pattern the prospect has been participating in for several minutes.'},
      {id:'n5', cat:'PACING & LEADING', principle:'PACE THEN LEAD',
       technique: 'Match the prospect\'s current reality (pace) before introducing a new frame (lead). "I understand you\'re happy with your current portfolio performance — and that makes complete sense given what the market has done. What I want to show you is what the next 18 months might look like if the macro environment shifts in the direction the data is suggesting." You\'ve validated their position, then led them forward.',
       script: '"You\'ve been cautious and it\'s worked — that\'s exactly the right instinct for the cycle we\'ve been in. Now let me show you what cautious looks like in the next cycle, because the playbook changes."',
       why: 'Matching their reality first removes defensiveness. You are not contradicting them — you are updating the information they\'re working with. The lead follows naturally from the pace.'},
      {id:'n6', cat:'PATTERN INTERRUPT', principle:'PATTERN INTERRUPT',
       technique: 'When a prospect is locked in a fixed response pattern ("I\'ll think about it", "not interested", "send me something"), interrupt the pattern with something unexpected before re-entering. A pause, an unexpected question, a reframe so different from what they expected that their mental script is temporarily suspended. "Actually — before I respond to that — can I ask you something completely different?" Then ask the most powerful diagnostic question you have.',
       script: 'They say: "I\'ll think about it." You say: "Good. What are the three things you\'re going to think about?" — pause — "Because I want to make sure you have the right information for each of them."',
       why: 'Their "think about it" is an automatic response pattern, not a considered decision. The unexpected counter-question forces them out of autopilot into genuine engagement.'},
      {id:'n7', cat:'IDENTITY LANGUAGE', principle:'"YOU\'RE THE KIND OF PERSON WHO…"',
       technique: 'Assign a positive identity trait consistent with the desired behaviour before asking for it. "You\'re clearly someone who takes a long view — which is exactly why this conversation makes sense." When a person has accepted an identity label, they act consistently with it. The prospect cannot easily behave in ways that contradict the identity you\'ve attributed to them without cognitive dissonance.',
       script: '"From what you\'ve told me, you\'re the kind of investor who doesn\'t wait for headlines to move. You\'re already thinking about where to be in two years — which is exactly the right frame for this."',
       why: 'Cialdini\'s Commitment & Consistency principle operates at identity level. Once the label is accepted, the behaviour follows the label. The alternative requires the prospect to explicitly reject the flattering self-description.'},
      {id:'n8', cat:'THE DOUBLE BIND', principle:'DOUBLE BIND / FALSE CHOICE',
       technique: 'Offer two options that both lead to the desired outcome. "Would it make more sense to start with a smaller initial position and add to it, or would you prefer to go straight to the full allocation given the timing?" Both options involve investing. The question of whether to invest has been bypassed; only the question of how much remains. Use where certainty is already at 7+ and the prospect is ready to decide on terms.',
       script: '"Should we set up a call with the paperwork for Tuesday or is Thursday better for you?" — both involve a call, paperwork, and a next step.',
       why: 'The false choice is only effective after certainty has been established. Used prematurely it feels manipulative. At 7+ certainty, it simply makes the path of least resistance obvious and removes decision paralysis.'},
      {id:'n9', cat:'SOFTENERS', principle:'SOFTENING LANGUAGE',
       technique: 'Lead challenging statements with softeners that reduce resistance before the content lands. "I\'m curious..." "I wonder if..." "You might already be thinking about this, but..." "Help me understand..." These prefaces signal collaboration rather than confrontation. The content that follows is processed with less defensiveness because the framing signals curiosity rather than challenge.',
       script: '"I\'m curious — when you say you want to wait for the right time, what specifically would need to be different for that time to arrive?"',
       why: 'Softeners are particularly effective in early-stage objection handling because they invite the prospect to explain rather than defend. The explanation usually surfaces the real objection or confirms there isn\'t one.'},
      {id:'n10', cat:'FUTURE PACING', principle:'VIVID FUTURE PACE',
       technique: 'Take the prospect six to eighteen months forward and paint a specific, sensory-rich picture of both the outcome of inaction and the outcome of action. The emotional brain responds to vivid futures as if they are real. The SLP rule: always paint the pain of inaction BEFORE the pleasure of action. Loss aversion means the first image (inaction) will be more motivating than the second — but both are needed. Make them feel both outcomes, not just hear them described.',
       script: '"Picture it\'s March next year. The rate cycle has turned. The data confirms what we\'re discussing today. In one version you\'re positioned — you took this conversation seriously. In the other you didn\'t. What does the phone call with your accountant look like in each version?"',
       why: 'The future pace bypasses the logical mind\'s objection-generating function. The prospect is already inside the outcome, not evaluating whether to enter it. This is why it must follow — not precede — the airtight logical case.'},
      {id:'n11', cat:'FUTURE PACING', principle:'THE THIRD-PERSON STORY',
       technique: 'Tell a story about a third person (real or composite) who was in exactly the same position, hesitated, and later wished they had moved. The third-person frame removes ego threat — the prospect can accept the lesson without having to admit they are making the same mistake. It also provides social proof. The story must be specific: named situation, named outcome, named regret. Vague stories carry no weight.',
       script: '"I spoke to a client two years ago — similar situation to yours, similar concerns. He asked for three months to think about it. He called me back six months later to say he wished he hadn\'t waited. Not because anything went wrong — but because he could see exactly what had happened in the market and knew he\'d have been positioned for it. He didn\'t lose anything. He just missed the gain. And that bothered him more than a loss would have."',
       why: 'The third-person story sidesteps resistance because it\'s "just a story." The prospect absorbs the lesson without feeling told what to do. The emotional content (the regret) lands precisely because it isn\'t directed at them.'},
      {id:'n12', cat:'RAPPORT', principle:'MATCHING & MIRRORING',
       technique: 'Calibrate your pace, volume, and energy to match the prospect\'s state, then gradually lead it where you want it to go. A slow, deliberate prospect needs a slower opening before being gradually accelerated. A fast-talking, high-energy prospect needs matching energy before depth. This is tonality rapport — the channel has to match before the content can land. Mismatch in tone is the most common reason a logically perfect pitch fails.',
       script: 'On a call: begin at the prospect\'s natural pace. Ask open questions that require considered answers. Gradually increase the certainty in your own tonality as the conversation develops. Never be more certain than they are — lead from just ahead of where they are.',
       why: 'Communication is 7% words, 38% tonality, 55% physiology (in person). Getting the right words into a mismatched tonality channel is like broadcasting on the wrong frequency — the signal doesn\'t land.'},
      {id:'n13', cat:'ANCHORING', principle:'POSITIVE STATE ANCHORING',
       technique: 'When a prospect references a moment of good financial decision-making, their confidence in a project that worked, or a time they felt secure — anchor that state. "That sounds like a decision you feel really good about — what made you so certain at the time?" This triggers the positive emotional state, and you then pivot to the current opportunity. The positive state is now linked to the conversation about the new opportunity.',
       script: '"You mentioned your decision to buy in 2012 worked out well — and it sounds like you trusted your instincts on that one. What gave you the confidence to move when you did?"',
       why: 'Anchoring a positive decision-making state and then presenting the current opportunity associates the two in the prospect\'s mind. They are effectively re-experiencing their own good decision while evaluating yours.'},
      {id:'n14', cat:'NOMINALISATIONS', principle:'NOMINALISATION — MAKING ABSTRACTS REAL',
       technique: 'Transform abstract concepts into owned, tangible things. Not "the investment" — "your position". Not "the opportunity" — "your allocation". Not "the portfolio" — "what you\'ve built". Nominalisations create a sense of ownership before ownership has been established. "How does your allocation sit relative to what you\'re trying to achieve this year?" treats the allocation as a fact before the client has made it.',
       script: '"When I look at your current situation and where you want your wealth to be in ten years, the gap between those two points is the opportunity I want to talk about. Does that gap feel large or small to you right now?"',
       why: 'Language that treats the prospect\'s future ownership as current reality causes them to inhabit it. This is the linguistic mechanism behind "your investment" performing better than "the investment" in every test of sales language.'},
      {id:'n15', cat:'SCARCITY LANGUAGE', principle:'LEGITIMATE URGENCY LANGUAGE',
       technique: 'Real urgency is the most powerful closing tool available and the only ethical one. The SLP rule: never manufacture urgency, because manufactured urgency is detectable and destroys trust on the spot. Real urgency includes: tax year deadlines (April 5th), cask availability that is genuinely finite, an EIS tranche with a fixed close, a rate decision that is actually scheduled. State the urgency specifically, explain why it is real, and never claim urgency that cannot be verified.',
       script: '"The EIS tranche closes on the 28th because that\'s when the company completes its funding round. After that date, the relief is still available but the specific investment opportunity at this valuation is not. That date is set by the company\'s lawyers, not by us."',
       why: 'Real urgency backed by a verifiable mechanism is accepted by the prospect\'s logical mind, which then stops searching for reasons to delay. Fake urgency is rejected by the logical mind and permanently damages trust — the bullshit detector is never fully turned off.'},
      {id:'n16', cat:'REFRAMING', principle:'THE CONTENT REFRAME',
       technique: 'Change the meaning assigned to an event by the prospect without changing the event itself. The prospect says: "I\'ve been burned before." Reframe: "That experience is actually the most valuable thing you could bring to this conversation, because it tells us exactly what to design around." The event (being burned) stays the same; the meaning shifts from "reason not to invest" to "reason to structure carefully". The reframe must be genuine and plausible — not forced.',
       script: '"The fact that you\'re cautious is not a problem — it\'s the reason you\'re still worth talking to. The people I can\'t help are the ones who are reckless. Caution means we just need to structure this correctly."',
       why: 'Content reframing is the most versatile pattern in NLP. Every objection contains an implicit meaning — and meaning is almost always negotiable. The reframe must arrive confidently and naturally; a hesitant reframe sounds like spin.'},
      {id:'n17', cat:'REFRAMING', principle:'THE CONTEXT REFRAME',
       technique: 'Change the context in which the prospect\'s concern applies, revealing that the same behaviour or fact is a positive in a different context. "Illiquidity is a problem in an emergency — but your pension is illiquid, your mortgage is illiquid, your house is illiquid. In every context where illiquidity is present, it\'s because the long-term benefit is worth the short-term constraint. This is the same structure." The concern (illiquidity) is valid — but only in the wrong context.',
       script: '"Illiquidity bothers people in the wrong context. In the right context — long-term wealth building — it\'s not a bug. It\'s the mechanism that keeps the return premium available."',
       why: 'Context reframes are less confrontational than direct rebuttals because they validate the concern in its correct context. The prospect does not feel argued with — they feel their concern has been properly understood and placed.'},
      {id:'n18', cat:'LANGUAGE PATTERNS', principle:'"I\'M NOT GOING TO TELL YOU…"',
       technique: 'State the very thing you\'re claiming not to say: "I\'m not going to tell you this is risk-free, because nothing is." This pattern works because it simultaneously delivers the content (this is not risk-free) while establishing credibility (the broker isn\'t hiding anything) and pre-empting the objection (of course there\'s risk). It also triggers a paradoxical curiosity — the prospect wants to hear what you\'re "not going to tell" them.',
       script: '"I\'m not going to tell you this is perfect — no allocation is. What I can tell you is that it\'s the most asymmetric risk/reward profile we\'ve seen in this space in four years, and I want to make sure you have all the information before you decide."',
       why: 'The pattern disarms the prospect\'s cynicism detector. The salesperson who acknowledges imperfection appears more trustworthy than one who claims perfection — and Cialdini\'s authority principle is activated by the honesty.'},
      {id:'n19', cat:'LANGUAGE PATTERNS', principle:'THE SOCRATIC METHOD',
       technique: 'Ask questions that cause the prospect to talk themselves into the position you want them to reach. The Socratic method never tells — it asks until the prospect has logically arrived at the conclusion themselves. "What would have to be true for you to feel comfortable moving forward?" Answer their answer. "What would it mean for you if you had that certainty?" Answer their answer. Each question is designed so the honest answer moves them toward the destination.',
       script: '"If the structural supply constraint is real, and the demand drivers are structural, what would you expect to happen to prices over a 7-10 year horizon?" (They answer.) "And what does that imply for the timing of when you\'d want to be positioned?"',
       why: 'A prospect who has reasoned their way to a conclusion owns it. A conclusion handed to them by a broker is their broker\'s conclusion. Self-generated certainty is the highest quality certainty — it survives the phone call, the spouse\'s scepticism, and the night\'s sleep.'},
      {id:'n20', cat:'SENSORY LANGUAGE', principle:'SENSORY-SPECIFIC FUTURE PACING',
       technique: 'Use all three sensory modalities (visual, auditory, kinaesthetic) in future-pace language. "Picture yourself looking at a statement that shows the allocation performing..." (visual). "Imagine the conversation with your accountant when you explain what you did and why..." (auditory). "How does it feel knowing that portion of your wealth is working independently of whatever the stock market is doing?" (kinaesthetic). Different prospects are dominant in different modalities — using all three catches all three.',
       script: '"Imagine looking at your portfolio review in 18 months — you can see the position clearly, you\'re hearing positive feedback about how the market has developed, and there\'s a settled feeling knowing you moved when the data told you to."',
       why: 'Sensory-specific language creates a richer internal representation of the future state. The richer the representation, the more the emotional brain treats it as real — and the more motivating it becomes.'},
      {id:'n21', cat:'TACTICAL EMPATHY', principle:'VOSS — LABELLING (TACTICAL EMPATHY)',
       technique: 'Chris Voss (Never Split the Difference): name the emotion you observe without judgement. "It seems like this has been a stressful decision for you." "It sounds like you\'ve had a bad experience with something similar before." "It feels like you\'re not fully convinced by the tax mechanics." Labelling validates the emotion before addressing the logic. It demonstrates listening. It drops defensiveness dramatically — because the prospect feels understood, not processed. Never say "I understand how you feel" — that is about you. "It seems like you feel..." is about them.',
       script: '"It sounds like you\'ve been through a situation where something was pitched as a sure thing and it didn\'t deliver — and that\'s left you wanting to be more careful. Is that fair?" [pause] "I want to work within that, not around it. So let me show you exactly what the downside looks like before I show you anything else."',
       why: 'Tactical empathy is the highest-leverage opening in a difficult conversation. Voss used it in hostage negotiation — it works because the human need to feel heard is stronger than the need to be right. Labelling converts a defensive prospect into a collaborative one.'},
      {id:'n22', cat:'TACTICAL EMPATHY', principle:'VOSS — MIRRORING',
       technique: 'Repeat the last 2-3 words a prospect says, with a slightly upward inflection, as a question. They say: "I\'m not sure the timing is right." You say: "Timing isn\'t right?" Then be silent. Mirroring signals that you are listening, creates mild cognitive dissonance (they have to decide what they meant), and almost always causes the prospect to expand. It keeps the conversation going without you saying anything of substance — and what they say in the expansion often contains the real objection.',
       script: 'Prospect: "The returns seem reasonable but I\'m concerned about the liquidity." [Mirror:] "Concerned about the liquidity?" [Silence.] Let them explain. They will almost always give you the specific liquidity scenario they are worried about — which you can then address precisely.',
       why: 'Mirroring is disarmingly simple. In testing, Voss\'s FBI negotiators increased information gathered from subjects by 50%+ using mirroring alone. For investment sales, it surfaces the real objection without asking a direct question that might trigger a defensive answer.'},
      {id:'n23', cat:'TACTICAL EMPATHY', principle:'VOSS — CALIBRATED QUESTIONS',
       technique: 'Replace "Why...?" with "How...?" and "What...?" questions. "Why are you hesitating?" sounds accusatory. "What is it about the timing that concerns you?" is an open invitation. Voss calls these calibrated questions — they have no fixed answer, require genuine thought, and put the work on the prospect rather than the broker. "How does this fit with what you\'re trying to achieve?" "What would need to happen for this to feel like the right time?" "What is it I haven\'t explained clearly enough?"',
       script: '"I want to make sure I\'m genuinely useful here. What is it about this specifically that isn\'t landing right?" [Silence.] Do not rescue them from the pause. The pause is doing work.',
       why: 'Calibrated questions create genuine dialogue. They cannot be answered with a yes or no. They invite the prospect into the problem-solving process rather than positioning the broker as a solution-presenter and the prospect as an objector. The information you get is richer and more actionable.'},
      {id:'n24', cat:'TACTICAL EMPATHY', principle:'VOSS — ACCUSATION AUDIT',
       technique: 'Before presenting anything, list every negative thing the prospect might think or say about you, your firm, or your product — and say them first. "I know what I\'m about to tell you might sound like a sales pitch. I know that previous conversations you\'ve had in this space may have felt overpromised. I know alternative assets can feel like a world designed to obscure what is actually happening." By naming every accusation, you defuse it — and you simultaneously demonstrate that you have thought from their perspective.',
       script: '"Before I get into the detail, I want to say something. I know you\'ve probably been called by people in this space before who made it sound simpler than it was. I know the fees in this sector can look aggressive at first glance. And I know that \'non-correlated\' is a phrase that gets thrown around a lot without much substance behind it. I\'m going to address all of those. But first — which of those would you like me to start with?"',
       why: 'The accusation audit works by pre-empting the negative internal monologue. If you name it first, the prospect cannot use it against you — you\'ve already acknowledged it. It produces a paradoxical effect: the more negative things you name, the more trustworthy you appear.'},
      {id:'n25', cat:'TACTICAL EMPATHY', principle:'VOSS — NO-ORIENTED QUESTIONS',
       technique: 'Voss discovered that "yes" creates anxiety (commitment), while "no" creates safety (protection). Re-phrase requests as no-oriented questions: instead of "Would you be interested in hearing more?" ask "Would it be wrong of me to suggest..." or "Is there any reason why this wouldn\'t make sense for your situation?" or "Would it be ridiculous to consider..." A no-oriented question is safer for the prospect to answer — and the answer "no, it wouldn\'t be ridiculous" is functionally a yes with less resistance attached.',
       script: '"Would it be completely off-base to suggest that a 5% non-correlated allocation could be a sensible addition to what you already have?" (The answer "No, that wouldn\'t be off-base" = agreement.) Or: "Is there any obvious reason why this wouldn\'t work for you before we go further?"',
       why: 'No-oriented questions exploit the safety of "no" to generate effective agreement. The prospect who says "no, there\'s no obvious reason why it wouldn\'t work" has just lowered their own resistance without being pushed.'},
      {id:'n26', cat:'LANGUAGE PATTERNS', principle:'VOSS — LATE-NIGHT FM DJ VOICE',
       technique: 'Voss identifies three voice modes: assertive (direct, fast, drives tension), playful/positive (light, upbeat, collaborative), and the late-night FM DJ (slow, calm, deep, declarative). The FM DJ voice conveys absolute certainty without aggression. It is used when delivering key statements of fact: when you state the supply constraint, the inflation data, the historical return. Not everything — overuse kills the effect. Use it for the three or four statements in any call that are genuinely load-bearing. Slow down. Drop the pitch slightly. Speak with finality.',
       script: 'Three moments for the FM DJ voice: (1) when stating the core market thesis ("The central bank buying we\'ve seen in 2023 and 2024 is the largest in 50 years. That is a fact."), (2) when stating the inflation reality ("Your cash is losing 4-5% annually in real terms. That is happening now."), (3) when naming the closing decision ("The next step is to confirm the allocation. I can have the paperwork with you today.").',
       why: 'Tonality carries more than words. A statement delivered in the FM DJ voice is experienced as calm authority — not pressure. It produces certainty in the listener because it sounds like the speaker is already certain. Certainty is contagious.'},
      {id:'n27', cat:'LANGUAGE PATTERNS', principle:'CHALLENGER SALE — COMMERCIAL TEACHING',
       technique: 'Matthew Dixon\'s Challenger Sale (Huthwaite research): the most effective salespeople in complex B2B sales do not just respond to client needs — they TEACH the client something new about their own situation that reframes how they see the problem. "Commercial teaching": lead with an insight the prospect did not have, that creates urgency around a problem they underestimated, that your product uniquely solves. For investment: "Most clients I work with have never run their portfolio against real inflation. Would you like to see what yours looks like?" This creates a problem they didn\'t know they had — and you have the solution.',
       script: '"I want to share something that most clients find genuinely surprising when they see it for the first time. This is the real-return performance of a typical balanced portfolio against UK CPI over the last seven years. [Data.] Most clients assume they\'re ahead. The ones who look at this carefully realise they\'re approximately flat in real terms — sometimes behind. That\'s the gap we work to close."',
       why: 'Commercial teaching works because it generates need — rather than responding to an existing expressed need. The client who learns something from you is already in a different psychological position: they are a student, not an objector. Teaching creates gratitude, credibility, and a felt need simultaneously.'},
      {id:'n28', cat:'LANGUAGE PATTERNS', principle:'NAPOLEON HILL — AUTOSUGGESTION & REPETITION',
       technique: 'Napoleon Hill\'s Autosuggestion principle: the subconscious mind is reached not through logic but through repetition combined with emotion. A fact repeated with intensity becomes belief. A belief becomes action. Applied to sales: the most persuasive part of any pitch is not the data presented once — it is the theme repeated in multiple forms across the conversation. "Inflation is destroying purchasing power" becomes more real the fifth time the prospect has been oriented around that idea than the first. Structure your pitch so the core theme appears in the opening, the middle (as data), the future pace, and the close.',
       script: 'Before the call, identify the ONE core theme you want the prospect to believe. Build every element of the call around that theme: the opening ("There\'s one thing I want you to understand by the end of this conversation..."), the logical case (data supporting the theme), the future pace (what happens if they act vs don\'t act on this theme), and the close ("Given everything we\'ve discussed about [theme]..."). The theme is reinforced five times — not repeated verbatim, but recurring.',
       why: 'Hill\'s autosuggestion principle is supported by modern psychology (illusory truth effect: familiarity increases perceived truth). A prospect who has encountered an idea five times in different forms during a single conversation has effectively heard it for the first time five times. The cumulative effect on belief formation is substantial.'},
      {id:'n29', cat:'REFRAMING', principle:'SPIN — IMPLICATION QUESTION (MAKE THEM FEEL THE SIZE)',
       technique: 'Neil Rackham\'s SPIN research (35,000 sales calls, 12 years): Implication Questions are the most powerful in the SPIN sequence for large, complex sales. They take an identified Problem and amplify its consequences. "You mentioned the current allocation is returning below inflation. What effect does that have on your retirement timeline?" "If that continues for another five years, what does that mean for the capital available to your children?" The question makes the prospect feel the SIZE of the problem — not just its existence.',
       script: '"You\'ve said the current yield is around 2.5% and inflation is around 4%. That\'s a 1.5% real loss per year. On a £500,000 portfolio, that\'s £7,500 a year. Over ten years — compounded — that\'s approximately £79,000 gone. Does that figure concern you?" [Silence.] Let them sit with it.',
       why: 'Rackham\'s research showed Implication Questions increased close rates more than any other single behaviour in large-ticket sales. They work by making the prospect feel the emotional weight of the problem — not just its intellectual existence. The calculation-based implication is the most powerful form.'},
      {id:'n30', cat:'REFRAMING', principle:'SPIN — NEED-PAYOFF QUESTION (CLIENT SELF-CLOSE)',
       technique: 'Need-Payoff Questions are the final SPIN stage. They get the prospect to articulate the BENEFIT of the solution in their own words. "So if we could solve that inflation erosion problem — what would that mean for your planning?" "If this allocation performed as the structure suggests over seven years, how would that change your thinking about the rest of your portfolio?" When the prospect answers, they are articulating why they should buy. A self-generated benefit argument is ten times more persuasive than a broker-generated one.',
       script: '"Given what you\'ve said about wanting the portfolio to work harder in real terms — if this allocation delivered on the thesis, what would that do for your situation?" [Let them answer.] "That\'s exactly what we\'re positioning for. So the only question remaining is timing."',
       why: 'Rackham\'s research: in successful sales calls, prospects talked more than salespeople, and the benefits they articulated came from their own mouths, not from the salesperson\'s pitch. The Need-Payoff question is the mechanism that makes this happen. When the client closes themselves, the decision is theirs — and it sticks.'},
      {id:'n31', cat:'TACTICAL EMPATHY', principle:'VOSS — BLACK SWANS (UNKNOWN UNKNOWNS)',
       technique: 'Every negotiation contains information the prospect holds that, if you knew it, would completely alter your strategy. Voss calls these Black Swans — pieces of information that seem innocuous but, when revealed, change the entire dynamic. Three types: (a) information that gives you unknown positive leverage, (b) a hidden constraint on their side, (c) a secret desire they haven\'t voiced. Black Swans surface when genuine rapport is established and the prospect stops managing the conversation and starts talking. The tools that surface them: sustained mirroring (they keep talking), dynamic silence, late-meeting questions (people drop their guard near the end), and "how" questions that invite explanation rather than yes/no.',
       script: '"I know you\'ve probably looked at alternatives like this before. What\'s usually gotten in the way?" [Invites disclosure of the actual hidden objection — the one never stated.] // "How has your IFA been handling the inflationary environment?" [If they pause or caveat, you\'ve found the gap.] // "What would need to be true for a tax-efficient structure to make sense for you right now?" [Often reveals an undisclosed capital gains event, inheritance, or pension limit breach.]',
       why: 'Source: Voss, Never Split the Difference. The biggest deals and the worst losses both turn on information you didn\'t know was there. Hunting Black Swans is not a closing technique — it is a listening discipline that reshapes your entire strategy when the information emerges.'},
      {id:'n32', cat:'TACTICAL EMPATHY', principle:'VOSS — THE F-BOMB: "FAIR"',
       technique: '"Fair" is the most emotionally loaded word in any negotiation and is almost always deployed as a weapon. Three modes: (1) Destabilising attack — "We just want what\'s fair" — designed to make you defensive; you\'ve now lost rational footing. (2) Post-anchor challenge — "That doesn\'t seem fair" — pure tactical pressure to make you move. (3) Voss\'s inoculation (preferred) — say early: "I want you to feel like you\'re being treated fairly at all times. If at any point you feel I\'m not being straight with you, tell me." This defuses the word before it can be weaponised. Apply Mode 3 as standard opening. When Mode 1 or 2 appears, don\'t defend — respond with: "That\'s fair. What are you comparing it to?" — the word mirrors it back and forces specificity; vague fairness attacks collapse under precision.',
       script: 'Mode 3 inoculation (open every first meeting with): "My only goal today is that you leave feeling the conversation was worth your time. If at any point I say something that doesn\'t feel right — call me on it." // When prospect deploys Mode 1/2: "That\'s fair. What are you comparing it to?" [Never defend; force specificity.]',
       why: 'Source: Voss, Never Split the Difference. "Fair" activates emotional System 1 instantly — the accused party scrambles to prove they aren\'t being unfair. Pre-empt by owning the word first.'},
      {id:'n33', cat:'TACTICAL EMPATHY', principle:'VOSS — "THAT\'S RIGHT" vs "YOU\'RE RIGHT"',
       technique: '"You\'re right" is a conversation-stopper that means nothing. The word "you" places agency outside the speaker — they are evaluating you, not internalising a position. It requires no cognitive engagement. "That\'s right" requires the speaker to have internalised a position and verified it against their own worldview — it means: "I have assessed this, and it is accurate." Voss: "If you\'ve gotten \'that\'s right,\' you\'ve gotten buy-in. If you\'ve gotten \'you\'re right,\' you\'ve gotten nothing except the impression they want you to stop talking." Engineer "that\'s right" by summarising their position better than they articulated it themselves — use labelling + paraphrasing in sequence. Never accept "you\'re right" as a signal of progress.',
       script: '"It sounds like you\'ve spent years building something, and the last thing you want is to put it at risk on something you don\'t fully understand yet. Is that right?" [If the summary is emotionally accurate, you get "that\'s right" — genuine buy-in, not polite dismissal.] // Test: "Let me make sure I\'ve explained this correctly — does this feel like it fits where you are right now?" Watch for "that\'s right" vs a nod and silence.',
       why: 'Source: Voss, Never Split the Difference. Most positive responses in sales conversations are polite brush-offs, not genuine buy-in. "That\'s right" is the only response that indicates true internalisation of the argument.'},
      {id:'n34', cat:'LANGUAGE PATTERNS', principle:'VOSS — EMAIL MAGIC TECHNIQUE',
       technique: 'Standard follow-up emails optimise for "yes," which requires commitment and triggers resistance. Voss\'s insight: make it easy to say no, and reply rate climbs. Three-component structure: (1) Subject line — no-oriented, e.g. "Have you moved in a different direction?" / "Is this a bad time?" / "Bad idea?" (2) Body — mirror one phrase from their last message + label their likely concern. Keep to 3 sentences. (3) Close — one calibrated "how" or "what" question. Never "let me know your thoughts" — that requires no reply. No-oriented subjects remove threat. The prospect reads "they\'re not chasing me" and becomes more inclined to engage. Apply to dead prospects 3+ weeks silent and to cold HNW outreach.',
       script: 'Dead prospect (3-week silence): Subject: "Have you moved in a different direction?" Body: "You mentioned you were reviewing your tax position before year-end — I imagine things have gotten busy. How would you like to handle this?" // HNW first outreach: Subject: "Bad time to connect?" [Non-desperate, signals confidence — HNW individuals respect this.] // Never end an email with "looking forward to hearing from you" — ends with the question instead.',
       why: 'Source: Voss, Never Split the Difference. The no-oriented subject line activates autonomy (prospect feels they have the power to say no), which paradoxically increases engagement. The calibrated close forces a specific reply rather than a vague deferral.'},
      {id:'n35', cat:'REFRAMING', principle:'VOSS / ACKERMAN — THE ACKERMAN ANCHORING MODEL',
       technique: 'Developed by CIA case officer Mike Ackerman. The sequence and size of concessions communicate more than the final number. Concessions that decrease in size signal you are reaching your limit. A concession that holds steady signals you can be squeezed further. The Ackerman model controls this signalling precisely. Five steps: (1) Set your target. (2) Open at 65% of target. (3) First counter: 85% of target. (4) Second counter: 95%. (5) Final: 100% of target — add an odd, non-round number (e.g. £11,840, not £12,000) and a non-monetary add-on. The decreasing increments (20%, 10%, 5%) communicate you are at your limit. The odd final number signals precise analysis — not a round number chosen arbitrarily. The non-monetary add-on (a bespoke report, a priority introduction, an 18-month storage review) creates a feeling of compromise without moving your number.',
       script: 'Fee negotiation: If pushed from 2.5%, move to 2.35%, then 2.2%, then hold at 2.1% with an add-on: "The absolute minimum I can go to is 2.1% — and I\'ll include a bespoke quarterly allocation review at no charge." // Cask minimum: "The floor I can go to is £11,840 — and I can include a complimentary storage review at 18 months." [Precision reads as calculated, not arbitrary.]',
       why: 'Source: Voss, Never Split the Difference (Ackerman Model chapter). In any fee or minimum negotiation, the pattern of your concessions communicates your floor — before you state it. The Ackerman sequence controls that signal deliberately.'},
    ];

    /* ═══════════════════════════════════════════════════════════
       CLOSES — SLP CLOSING TECHNIQUES & CERTAINTY FRAMEWORK
       Source: Belfort SLP Transcript, Three Tens System
       ═══════════════════════════════════════════════════════════ */
    var CLOSES = [
      {id:'c1', cat:'SLP FRAMEWORK', principle:'THE THREE TENS — CERTAINTY ARCHITECTURE',
       technique: 'The Straight Line System requires three simultaneous certainties before a close will succeed. First Ten: logical certainty about the product/investment (the airtight logical case — facts, data, cost-benefit, no gaps). Second Ten: emotional certainty about ownership (the future pace — they can feel the benefit already). Third Ten: trust in you and your firm (track record, referral, institutional credibility). A prospect at 8/10 on logic but 4/10 on trust will not close. All three must be at 7+ before the ask.',
       script: 'Before closing: audit all three internally. "Do they believe the logical case? Can they see themselves in the future benefit? Do they trust me?" If any score is below 7, identify which one and address it before closing.',
       why: 'Most failed closes fail because only one or two of the three tens have been built. The logical case is usually the one most work goes into — but trust and emotional certainty are equally load-bearing. Skipping them produces buyers who reverse.'},
      {id:'c2', cat:'SLP FRAMEWORK', principle:'THE CERTAINTY SCALE — READ TONALITY',
       technique: 'The Straight Line certainty scale runs from 1 to 10. 1-4: disengaged, hostile, or not qualified. 5-6: on the fence, politely engaged but not convinced — "it sounds pretty good." 7-8: logically convinced, emotionally not yet fully there — "yeah, I see what you mean." 9-10: fully ready, self-closing — "so how do we do this?" The critical SLP rule: NEVER ask for the order when the prospect is below 7. Build certainty first. Premature closing at 5-6 produces objections, resistance, and reversed decisions.',
       script: 'After each loop, ask: "Does that make sense?" and listen to TONALITY not words. "Yeah okay" at low volume with a trailing inflection = 5-6. "Yeah, that actually makes a lot of sense" with rising energy = 7-8. "Okay, I get it — what do we do?" = 9-10.',
       why: 'Tonality is the honest signal. The words "yes" and "no" can mean anything — tonality reveals the certainty level underneath. The SLP system\'s most important diagnostic is reading the certainty level from how they sound, not what they say.'},
      {id:'c3', cat:'SLP FRAMEWORK', principle:'THE LOOP — HOW TO LOOP AFTER AN OBJECTION',
       technique: 'The Loop: (1) acknowledge the objection without accepting it as final. (2) Use a transitional phrase to re-enter presentation mode. (3) Make a new airtight logical case from a different angle — each loop builds on the previous one. (4) End with a certainty check. (5) Ask for the order again. Loop three times before altering approach. Each loop should add new information, not repeat the same argument. If a prospect is still at 5-6 after three loops, the issue is trust — not logic.',
       script: 'Loop entry: "I hear you — and you\'re right to ask. Let me come at this from a slightly different angle..." [New logical case — not the same one rephrased.] "Now does that make more sense?" [Certainty check.] "So here\'s what I\'d suggest..."',
       why: 'The loop is not persistence — it is information delivery in a sequence that rebuilds certainty from a different angle each time. An objection is always a signal of insufficient certainty, not permanent rejection. Most closes happen on the second or third loop.'},
      {id:'c4', cat:'SLP FRAMEWORK', principle:'ACTION THRESHOLD LOWERING',
       technique: 'The action threshold is the level of certainty required before a prospect feels comfortable moving. High action threshold prospects need more certainty, smaller initial steps, and longer timelines. Lower the action threshold by: reducing the size of the initial commitment ("start with a smaller position to see how it works for you"), adding social proof ("this is what most first-time investors in this space do"), or removing a risk element ("the IHT benefit means the government is effectively co-investing — your downside is structurally capped").',
       script: '"Given what you\'ve said, why don\'t we start with a smaller initial allocation — say half of what we discussed — and build on it once you\'ve had a chance to see how the structure performs. That way you\'re in the market, but you\'ve kept your options open."',
       why: 'Reducing the size of the ask is not a concession — it is a strategic move that gets the prospect into the position. Once they are in, the inertia of ownership works for you. It is far easier to increase an existing allocation than to open a new one.'},
      {id:'c5', cat:'SLP FRAMEWORK', principle:'PAIN THRESHOLD — ETHICAL PAIN AMPLIFICATION',
       technique: 'The pain threshold represents how much discomfort a prospect needs to feel before they act. Ethically amplifying a prospect\'s genuine financial pain makes inaction more uncomfortable than action. "What happens to that £500k in real terms if inflation stays at 5% for the next three years?" — the answer is a £75k loss in purchasing power. The prospect must feel that number, not just hear it. Only amplify genuine, verifiable pain — manufactured pain destroys trust the moment it is detected.',
       script: '"I want to show you something. Let\'s take the £500k in cash. At 5% inflation annually, by year three you\'ve lost £73,500 in purchasing power. The account says £500,000. But the purchasing power says £426,500. That\'s real. That\'s happening right now. Where is that money going?"',
       why: 'Genuine pain amplification is one of the most powerful ethical closes available. The SLP system places it in the third loop because the trust must be established first — pain amplification from an untrusted source triggers defensiveness. From a trusted source, it triggers action.'},
      {id:'c6', cat:'CLOSING TECHNIQUES', principle:'THE SUMMARY CLOSE',
       technique: 'Summarise all the logical case points and agreements made during the conversation, then ask for the order. "So — we\'ve established: rates are compressing, the supply constraint is structural, your current allocation has this specific gap, and you\'ve said you want this portion to be working harder. Given all of that, the next step is..." The summary close works because it restates the prospect\'s own words back to them as the logical foundation for the decision.',
       script: '"So here\'s where we are: you\'ve agreed that inflation is real, you\'ve said the current account is underperforming in real terms, you\'ve confirmed you want a 5-10% non-correlated allocation, and you understand the tax mechanics. Given all of that, it makes sense to move now, doesn\'t it?"',
       why: 'The prospect cannot contradict the summary without contradicting their own previous statements. The summary close requires no new argument — it simply makes visible the logical conclusion of everything that has already been agreed.'},
      {id:'c7', cat:'CLOSING TECHNIQUES', principle:'THE ALTERNATIVE CHOICE CLOSE',
       technique: 'Offer two options that both involve moving forward. "Would you prefer to start with a physical position or would the tax-advantaged structure make more sense given what you\'ve said?" "Should we schedule the next conversation for Tuesday or would Thursday work better?" Both options imply forward movement. The question of whether to move has been presupposed; only the direction remains.',
       script: '"Based on what you\'ve told me, there are really two ways to approach this. The first is the physical allocation with the straightforward ownership structure. The second is the tax-wrapped version with the additional IHT benefit. Given what you\'ve said about your estate planning goals, which of those feels more aligned?"',
       why: 'The alternative choice is not manipulative at 7+ certainty — it is helpful. The prospect who cannot decide is experiencing decision paralysis, and offering a binary makes the path of least resistance clear.'},
      {id:'c8', cat:'CLOSING TECHNIQUES', principle:'THE ASSUMPTIVE CLOSE',
       technique: 'Proceed as though the decision has already been made and discuss the implementation details. "So what we\'ll do is — I\'ll send you the documentation this afternoon, you review it over the weekend, and we get the paperwork signed early next week. Does that timeline work for you?" The assumptive close requires 8+ certainty and is most effective with high-action-threshold prospects who benefit from being moved through the process by a confident guide.',
       script: '"Great. So the next step is the client agreement form — I\'ll have that with you by end of day. You review it, any questions I\'m available until 6pm, and we can get this set up before the tax year closes. Sound good?"',
       why: 'For the prospect who is logically and emotionally convinced but paralysed by process, the assumptive close is a gift. It removes the perceived weight of the decision by treating it as already made and focusing on the practical next steps.'},
      {id:'c9', cat:'CLOSING TECHNIQUES', principle:'THE COLUMBO CLOSE',
       technique: 'After being told no, pause as if to leave, then turn back: "Just one more thing — I\'m curious. When you say not right now, what would actually need to be different for the timing to work?" This question usually surfaces the real objection for the first time. The relaxed state of the prospect (they think the conversation is over) lowers their guard. The most honest answers often come after the prospect believes pressure is off.',
       script: '"Absolutely — I understand. I\'ll let you get on. [pause] Actually, before I go — I\'m curious. You said the timing isn\'t right. What would \'right timing\' actually look like for you? I ask because I want to make sure when it\'s right, I can be genuinely useful."',
       why: 'The Columbo close is effective precisely because it appears to be a non-close. The prospect\'s resistance drops, and the answer to the question frequently reveals either the real objection (which can be addressed) or a buying signal disguised as a delay.'},
      {id:'c10', cat:'CLOSING TECHNIQUES', principle:'THE FEEL / FELT / FOUND',
       technique: 'A three-step objection-handling and closing sequence. "I understand how you feel — [validates their position]. Many of my clients have felt exactly the same way at this stage — [social proof that others were in their position]. What they found was that [specific positive outcome they discovered after moving forward]." The technique works because it validates, normalises, and then provides social proof of the correct decision — all without confronting the objection directly.',
       script: '"I completely understand how you feel — this is a significant decision and it makes sense to be careful. A lot of my clients have felt exactly the same way when we first discussed it. What they found, once they\'d seen the full picture, was that the risk they were worried about was much smaller than the risk they weren\'t worrying about — which was doing nothing."',
       why: 'The Feel/Felt/Found bypasses defensiveness by validating the objection completely before resolving it. The social proof (others felt this and resolved it) provides permission — the prospect can agree with you without feeling manipulated.'},
      {id:'c11', cat:'CLOSING TECHNIQUES', principle:'THE TAKEAWAY CLOSE',
       technique: 'Suggest that the opportunity might not be available to the prospect, or that you might need to move to another client. This triggers loss aversion — the fear of missing out is stronger than the desire to acquire. The takeaway must be real: "We have three positions available at this price and I have four clients I\'m speaking to." Never manufacture scarcity that doesn\'t exist. The ethical takeaway is a statement of real limitation, not a pressure tactic.',
       script: '"I want to be upfront with you — we have a limited number of positions at this allocation size and I\'ve got two other clients who are further along in their thinking. I don\'t want to rush you — but I also don\'t want you to come back to me in three weeks and find the window has closed. What\'s holding you back right now?"',
       why: 'Loss aversion is the most powerful motivational force in human decision-making. Kahneman\'s research shows losses are felt approximately twice as strongly as equivalent gains. The takeaway activates loss aversion — but only ethically, where real scarcity exists.'},
      {id:'c12', cat:'CLOSING TECHNIQUES', principle:'THE SHARP ANGLE CLOSE',
       technique: 'When a prospect names a condition for buying, immediately agree to that condition and ask for the order in the same breath. "If I can get the documentation to you by Thursday, will you commit to reviewing it and giving me a decision by Friday?" or "If we can structure it as two tranches — smaller first — can we agree on the first tranche today?" The sharp angle works because the prospect has effectively told you their buying condition — all you have to do is meet it.',
       script: '"You said if the minimum were lower you\'d be interested. I can work with a smaller initial position — say [X]. If I come back to you with that structure confirmed, is there any other reason you wouldn\'t move forward?"',
       why: 'The sharp angle close surfaces the true buying condition and closes on it immediately. It requires careful listening — the condition is usually embedded in an objection, not stated directly. "If only the minimum were smaller..." is a buying signal.'},
      {id:'c13', cat:'CLOSING TECHNIQUES', principle:'THE STRATEGIC QUESTION CLOSE',
       technique: 'Ask the prospect a question that, when answered honestly, produces the reason to buy. "What does your financial situation look like in three years if you make no changes?" "If this specific macro condition develops as the data suggests — where is your current portfolio then?" These questions require the prospect to confront the cost of inaction themselves. A self-generated answer carries more weight than a broker-generated claim.',
       script: '"Here\'s a question I want to sit with you on — if interest rates fall 150bp over the next 18 months, which is what the futures market is pricing, what does your current allocation return? And what would it return with this position in place?"',
       why: 'Self-generated logical certainty is the highest-quality certainty available. When the prospect runs the numbers and reaches the conclusion themselves, the close becomes an agreement rather than a persuasion.'},
      {id:'c14', cat:'CLOSING TECHNIQUES', principle:'THE PATIENCE CLOSE',
       technique: 'For the ultra-high-action-threshold prospect who genuinely needs time, give it strategically. "Absolutely — take the week. I\'ll leave it with you. What I\'d ask is that when you review it, you specifically look at [the one most compelling point]. And I\'ll call you [specific time] to see where you\'ve landed." You\'ve agreed to the delay, specified what they should focus on, and set a concrete next step. The sales process has not ended — it has been paused on your terms.',
       script: '"Take the time you need — I mean that. When you review it, I\'d particularly focus on [the specific tax mechanics / the supply data / the institutional buying pattern], because that\'s the point most clients find most compelling once they\'ve sat with it. I\'ll call you [specific day] at [specific time]."',
       why: 'Fighting a high-action-threshold prospect produces resentment and reversed decisions. Agreeing to pace while guiding what they focus on preserves the relationship and keeps the process alive. The specific call-back time makes the next step concrete rather than vague.'},
      {id:'c15', cat:'CERTAINTY BUILDING', principle:'STRATEGIC PREPARATION — WRITE YOUR PATTERNS',
       technique: 'The SLP principle that makes everything else work: prepare your airtight logical case, your loops, and your future pace scripts BEFORE every call. Not in outline form — written out in full, committed to memory or immediately accessible. When your conscious mind is not occupied with finding the next word, it is free to read your prospect\'s certainty level, adjust your tonality, and navigate objections in real time. Wing-it salespeople sound like they\'re winging it — because they are.',
       script: 'Before every call: write three logical cases for the investment (not one — three, each from a different angle for use in successive loops). Write the future pace for both the inaction scenario and the ownership scenario. Write three objection responses for the most likely objections. Then delete your internal monologue and listen.',
       why: 'The SLP research on top producers shows universally that they prepare more, not less, than average producers. The paradox: the more prepared you are, the more natural and spontaneous you sound — because your attention is fully on the prospect, not on your next sentence.'},
      {id:'c16', cat:'SLP FRAMEWORK', principle:'PAIN OF INACTION — THE DENTIST LESSON',
       technique: 'SLP principle: NEVER frame the consequence of your proposal as immediate pain. Always frame the consequence of INACTION as future pain. Belfort\'s dentist story: the dentist who described current-moment pain ("I\'ll have to hack it out") lost the sale. The dentist who should have said "imagine yourself in Zimbabwe when the temporary cracks" would have closed it. Applied: never say "this will require X months of paperwork" or "the tax year deadline means you need to decide now." Say instead: "If the tax year closes without this in place, the next equivalent opportunity is [date]. That\'s [time period] of further inflation drag on an unshielded position."',
       script: 'Wrong: "You need to move quickly because the deadline is April 5th." Right: "Let me paint a picture of where you are on April 6th if we haven\'t moved: the tax year has closed, you\'ve lost the EIS relief for this year, the next qualifying window opens in October at best, and in the meantime that capital is sitting at 2.5% against 4% inflation. Is that a scenario you\'re comfortable with?"',
       why: 'The brain weights future pain more heavily when it is made specific and sensory. The wrong framing creates urgency through broker pressure — the client resists. The right framing creates urgency through the prospect\'s own imagination of a painful future state — the client motivates themselves.'},
      {id:'c17', cat:'SLP FRAMEWORK', principle:'HIGH ACTION THRESHOLD = LIFETIME CLIENT',
       technique: 'SLP insight: the hardest clients to close become the most loyal once closed. Belfort\'s father: a "high action threshold" buyer who had to be completely certain before committing to anything — but then stayed with the same dry cleaner, laundry, and mechanic for 45 years. Never tried to rush a high-action-threshold buyer — it produces resentment and reversed decisions. Instead, accept their process, give it time, meet all their concerns, lower the action threshold only after certainty is fully built — and when they move, they move completely and permanently.',
       script: 'With a high-action-threshold prospect: "I can tell you\'re someone who moves deliberately — and that\'s actually why I wanted to bring this to you rather than someone who makes snap decisions. The clients I\'m most proud of working with are the ones who thought hard before committing, because when they moved, they moved with conviction. Take the time you need. Here\'s what I\'d suggest you sit with..."',
       why: 'Reframing the cautious client as your ideal client changes the dynamic completely. The prospect who feels respected for their caution will take more time — but when they close, they refer widely, increase their allocation, and never reverse. The high-action-threshold close is the most valuable close in the long run.'},
      {id:'c18', cat:'CERTAINTY BUILDING', principle:'NAPOLEON HILL — BURNING DESIRE',
       technique: 'Hill\'s first principle: the starting point of all achievement is a definiteness of purpose backed by a burning desire for its fulfillment. Not a wish. Not a hope. A white-hot, obsessive focus that crowds out all other thoughts. Applied to sales: discover your prospect\'s burning desire before you present anything. "What does your financial situation look like in five years if everything goes to plan?" The answer tells you what they want with intensity. Build your entire pitch around that specific desired future — not your product\'s features.',
       script: '"Before I tell you anything about what I\'m calling about — I want to ask you something. What\'s the financial outcome you\'re actually working toward right now? Not in general — specifically. What does the right number look like, and by when?" [Let them answer.] "Everything I\'m going to tell you is in the context of that."',
       why: 'Discovering the client\'s burning desire before pitching ensures that your product is framed as the vehicle for achieving what they already want most. The pitch becomes an enabling story, not a sales story. This produces the highest quality emotional certainty.'},
      {id:'c19', cat:'CERTAINTY BUILDING', principle:'NAPOLEON HILL — DECISION',
       technique: 'Hill\'s analysis of 25,000 failures: lack of decision — or the habit of reaching decisions slowly and reversing them quickly — was near the top of the list. Success: reach decisions promptly and change them slowly. Applied: the indecisive prospect is not thinking more carefully — they are following a pattern that has historically produced poor outcomes for them. A gentle challenge to this pattern: "Can I ask you something? In your experience, when you\'ve waited for a decision like this — has the extra time usually produced a better outcome, or has the situation usually just become more complicated?"',
       script: '"Here\'s what I\'ve noticed in this conversation: you\'ve said this makes sense, the structure is clear, and the timing looks right. The only thing standing between where you are and the outcome you described is a decision. And decisions either get made or they don\'t — they don\'t get better from being delayed. What\'s the one thing that would need to be true for you to say yes today?"',
       why: 'Hill\'s observation is supported by modern decision research: time pressure improves decision quality in experienced decision-makers. The prospect who waits for certainty is waiting for something that never arrives in investment markets. Naming the decision-pattern gently surfaces its cost.'},
      {id:'c20', cat:'CERTAINTY BUILDING', principle:'NAPOLEON HILL — PERSISTENCE',
       technique: 'Hill: "Persistence is the direct result of habit. The mind absorbs and becomes part of the daily experiences upon which it feeds." Most salespeople give up after the first or second no. Most successful closes happen on the third to fifth contact. Persistence is not badgering — it is the patient delivery of new information at each contact, so each encounter builds on the previous one. "I\'m calling because since we last spoke, [specific new development] has happened that changes the picture." Each call must bring something new — data, a development, a client story, a market movement.',
       script: 'On every follow-up call: "I\'m calling because something specific has happened since we last spoke that I thought you\'d want to know about." Then deliver the new fact. This reframes persistence as service rather than pressure. The prospect who has rejected you three times and finally says yes becomes a referral source — because your persistence demonstrated conviction in what you were selling.',
       why: 'Hill\'s persistence principle separates professionals from amateurs. The amateur hears "no" and internalises rejection. The professional hears "not yet" and prepares new information. The distinction is both psychological and tactical — and it is what produces the long-term relationship, not just the single close.'},
      {id:'c21', cat:'CLOSING TECHNIQUES', principle:'SPIN — FEATURES vs BENEFITS (RACKHAM)',
       technique: 'Neil Rackham\'s most important finding: in small sales, mentioning more features increases close rates. In large, complex sales (any sale over £5,000), mentioning MORE features DECREASES close rates by generating more objections. Only BENEFITS — statements showing how the feature meets an explicit need the client has already expressed — increase close rates in major sales. Applied: identify the explicit need first (SPIN questioning), then present one or two benefits that directly meet it. Never pitch features. "Our cask comes with insurance and secure bonded storage" is a feature. "Given your concern about physical security, our bonded storage and fully insured holding structure means that risk is covered completely" is a benefit.',
       script: 'Before presenting anything: ask "What matters most to you in this kind of allocation?" The answer gives you the explicit need. Then present only the 1-2 features that directly address that need — as benefits to their stated need. Everything else stays in your pocket.',
       why: 'Rackham\'s research is counterintuitive and widely ignored. The broker who "tells everything" to demonstrate knowledge generates objections to every feature they mention. The broker who tells only what is relevant to the client\'s stated need generates agreement.'},
      {id:'c22', cat:'CLOSING TECHNIQUES', principle:'REJECTION-THEN-RETREAT CLOSE — CIALDINI',
       technique: 'Make the full ask first. If declined, retreat to a smaller ask. Research: 76% acceptance of the smaller ask after rejection of the larger one, vs 29% acceptance of the smaller ask made alone. Additionally: clients who negotiated the terms follow through at 85% vs 50% for those who received the terms without negotiation. The retreat must feel genuine — not theatrical. "Given what you\'ve said, the full allocation clearly isn\'t where you are today. Would it make sense to start with half that, see how it performs, and revisit the fuller position in 12 months?" This is both a real retreat AND a future commitment.',
       script: '"I understand — [full amount] isn\'t the right place to start. What if we approached it this way: [half amount] to open the position, with a review call in six months once you\'ve had a chance to see it in your portfolio. That way you\'re in the market, and we have a basis for a proper conversation about the fuller allocation."',
       why: 'The retreat triggers reciprocity (you conceded, they should concede) and creates the satisfaction of having negotiated. Both forces drive follow-through. The future-commitment framing also sets up the next conversation without making it contingent on product performance.'},
      {id:'c23', cat:'CLOSING TECHNIQUES', principle:'CONSISTENCY LOCK CLOSE',
       technique: 'Anchor to commitments the prospect has already made during the conversation and use them as the logical basis for the close. "You said earlier that you believe non-correlated assets should be 5-10% of a well-constructed portfolio. Given that you believe that — this allocation at [X%] puts you exactly in that range. What\'s stopping you from being consistent with what you\'ve said?" The consistency lock works because the prospect cannot say no without contradicting their own stated belief. It is most powerful when the belief was genuine and was expressed without sales pressure.',
       script: '"Help me understand something. You\'ve told me: one, inflation is a genuine concern. Two, you want the portfolio working harder in real terms. Three, you agree the supply dynamics make the structural case compelling. Given all three of those — what is the argument for not doing this today?"',
       why: 'The consistency lock is the close that requires the least additional selling. If the three tens have been properly built during the conversation, the prospect has already said everything that makes the close inevitable. The lock simply makes that visible to them.'},
      {id:'c24', cat:'CLOSING TECHNIQUES', principle:'CHALLENGER SALE — COMMERCIAL INSIGHT CLOSE (DIXON)',
       technique: 'The Challenger close sequence: (1) Lead with a reframe — something the prospect does NOT know about their own situation. Not a product claim — a business insight about their world. (2) Show the verifiable cost of the status quo. (3) Only then introduce the product as the natural response to the insight. The key distinction from discovery selling: you are not responding to a need they articulated — you are teaching them a problem they didn\'t know they had, then offering the only logical solution. Challengers dominate complex, high-value sales (39% of top performers). Relationship Builders are the worst performers in complex sales — only 7% of top performers. In alternative investments, the sale is always complex; commercial insight always beats relationship management.',
       script: '"Most business owners in your bracket assume their pension allowance is the primary tax shelter. What\'s less known is that since the LTA changes, the EIS route often produces better after-tax outcomes on gains above £250K — without the annual limit constraints. Is your current advice including that route?" [Reframe + cost of status quo + solution implicit.] // "Most investors think of whisky as a luxury. The data since 2009 shows whisky casks outperformed UK equities in 7 of the last 12 years, with zero correlation to the FTSE. If that\'s not already in your allocation, you\'re carrying equity correlation risk you may not need to."',
       why: 'Source: Dixon & Adamson, The Challenger Sale (2011). Commercial insight is irreplaceable in high-value sales because it teaches something new — it creates felt need that didn\'t exist before the call. The product then becomes the obvious solution to a problem the client now urgently wants to solve.'},
      {id:'c25', cat:'CERTAINTY BUILDING', principle:'FOGG BEHAVIOR MODEL — B=MAP (MOTIVATION × ABILITY × PROMPT)',
       technique: 'Stanford researcher BJ Fogg: behaviour occurs only when Motivation, Ability, and Prompt converge simultaneously. If any one is missing, the behaviour does not happen regardless of how strong the others are. Diagnose which element is blocking before applying pressure. Motivation missing: address fear or aspiration first — "What happens to this capital if inflation stays elevated for another 3 years?" Ability missing: simplify the process — "It\'s a 10-minute onboarding call and a signed agreement. We handle everything else." Prompt missing (most common with HNWIs): the prospect is motivated and capable but never actually moves — they need a specific, timely, credible trigger. The worst sales error: increasing motivation (more pitch, more features) when ability is the bottleneck. You make them want it more, but they still can\'t take the step.',
       script: 'Diagnose first: "What would be the simplest way for you to get this moving?" [If they describe a process, ability is the issue — simplify it. If they describe a feeling, motivation is the issue — address the emotion. If they say "I just need to find the time," prompt is the issue — give them a specific date.] // Prompt example: "Allocations for the Q4 tranche close on the 30th — I\'d suggest we get the paperwork moving this week. It takes 10 minutes."',
       why: 'Source: Fogg Behavior Model, Stanford Persuasion Lab. In most stalled HNW sales, all three elements are present but the prompt is missing. The prospect wants to proceed, knows how to proceed, but has no forcing function. Creating a specific, credible prompt (a close date, a rate lock, a tranche limit) is the most efficient close of all.'},
      {id:'c26', cat:'SLP FRAMEWORK', principle:'AUTHORITY SEQUENCE CLOSE — MILGRAM APPLIED',
       technique: 'Milgram\'s 1963 Yale experiments: 65% of ordinary people would administer what they believed were lethal electric shocks if instructed by a perceived authority figure. Replicated across cultures and contexts with consistent results (50-65%). Three mechanisms: (1) Legitimacy of authority — credentials, institutional affiliation, track record must be visible before the ask. (2) Incremental commitment — the Milgram sequence escalated gradually; by the time the action was large, the framework had already been accepted. (3) Diffusion of responsibility — the authority figure said "I will take responsibility." Apply: never ask for the final decision first. Build a commitment sequence from small agreements to the main ask. Name your credibility before the close, not after.',
       script: 'Sequence: "Can we agree that non-correlated assets should be part of any well-constructed portfolio?" [Small yes.] "Can we agree that tax efficiency is a lever worth pulling at your income level?" [Small yes.] "And can we agree that the supply dynamics on this asset class give it a structural floor?" [Small yes.] "Given those three things — what\'s the argument for not doing this today?" [The big question, arrived at through incremental steps already committed to.] // Credentials before close: "I\'ve worked with 30+ business owners in your position in the last 18 months. Every one of them has the same hesitation at this stage. And the ones who moved forward are the ones I\'m still speaking to — because they\'ve got a position that\'s working."',
       why: 'Source: Milgram obedience studies (1963). The authority mechanism operates in financial advice exactly as it does in Milgram\'s lab — the brain wants an authority to follow when decisions are uncertain. The incremental commitment sequence is the mechanism that makes each step feel natural rather than forced.'},
      {id:'c27', cat:'CLOSING TECHNIQUES', principle:'PRE-SUASION CLOSE — ENGINEER THE PRIVILEGED MOMENT',
       technique: 'Cialdini, Pre-Suasion: the most powerful influence point is not during the message — it is the moment immediately before. What you make salient immediately before a decision will disproportionately shape that decision even if logically irrelevant. The privileged moment is a window of heightened receptivity you can engineer. For the close: the question asked immediately before the close primes the emotional state in which the close lands. If you prime security ("what would it mean to have this portion of your capital genuinely protected?"), the close lands in a security frame. If you prime opportunity ("what\'s the biggest financial move you\'ve made that you\'re proud of?"), the close lands in an achievement frame. Choose the prime deliberately.',
       script: '"Before I say what I want to suggest — help me understand one thing. You\'ve built something significant. What\'s the thing you most want to protect about what you\'ve built?" [Wait. Listen.] "That\'s exactly what this is designed to do. Based on everything we\'ve covered today, I\'d suggest [specific allocation]. Does that feel right?" [The close lands inside their own answer to the prime — it is now about their priority, not your product.]',
       why: 'Source: Cialdini, Pre-Suasion (2016). The privileged moment principle means the close is determined before the close begins. The prime you plant 30 seconds before the ask determines which emotional frame the ask lands in — and whether System 1 responds with openness or resistance.'},
    ];

    /* ── STATE ────────────────────────────────────────────── */
    var _libType = 'ANALOGIES';
    var _asset   = 'ALL';
    var _cat     = 'ALL';
    var _search  = '';
    var _open    = null;

    /* infer default asset from active lens */
    (function() {
      var lk = (window._assetLens && window._assetLens.key) || 'universal';
      if (lk === 'eis' || lk === 'vct' || lk === 'offshore') _asset = 'EIS/VCT';
      else if (lk === 'pe' || lk === 'trusts')               _asset = 'PE/TRUSTS';
      else if (lk === 'gold')                                 _asset = 'GOLD';
      else if (lk === 'whisky')                               _asset = 'WHISKY';
    })();

    var catsByType = {
      ANALOGIES:  ['ALL','MONETARY POLICY','INTEREST RATES','ECONOMIC CYCLES',
                   'GOLD FUNDAMENTALS','WHISKY FUNDAMENTALS','PROPERTY','FINE WINE',
                   'PORTFOLIO THEORY','MARKET PSYCHOLOGY','EIS / VCT','PRIVATE EQUITY','LAND & ART'],
      SPINS:      ['ALL','TIMING','RISK','LIQUIDITY','TRUST','AUTHORITY','RETURNS','UNDERSTANDING','SIZING','REGULATION','MARKET'],
      PSYCHOLOGY: ['ALL','CIALDINI','LOSS AVERSION','SPIN SELLING','ANCHORING','FRAMING','CLOSING','BEHAVIOURAL FINANCE','COMMITMENT','CONTRAST & PRICING','PRE-SUASION'],
      REBUTTALS:  ['ALL','DELAY','COST','GOLD','WHISKY','TAX','EIS/VCT','PROPERTY','PROCESS','MARKET'],
      NLP:        ['ALL','EMBEDDED COMMANDS','PRESUPPOSITIONS','TAG QUESTIONS','PACING & LEADING',
                   'PATTERN INTERRUPT','IDENTITY LANGUAGE','THE DOUBLE BIND','SOFTENERS',
                   'FUTURE PACING','RAPPORT','ANCHORING','NOMINALISATIONS','SCARCITY LANGUAGE',
                   'REFRAMING','LANGUAGE PATTERNS','SENSORY LANGUAGE','TACTICAL EMPATHY'],
      CLOSES:     ['ALL','SLP FRAMEWORK','CLOSING TECHNIQUES','CERTAINTY BUILDING']
    };
    var assetsByType = {
      ANALOGIES: ['ALL','GOLD','WHISKY','PROPERTY','FINE WINE','EIS/VCT','PE/TRUSTS','LAND'],
      SPINS:[],'PSYCHOLOGY':[],'REBUTTALS':[],'NLP':[],'CLOSES':[]
    };

    function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function currentData() {
      return _libType === 'ANALOGIES'  ? ANALOGIES  :
             _libType === 'SPINS'      ? SPINS      :
             _libType === 'PSYCHOLOGY' ? PSYCHOLOGY :
             _libType === 'NLP'        ? NLP        :
             _libType === 'CLOSES'     ? CLOSES     :
                                        REBUTTALS;
    }

    function getTitle(item) {
      if (_libType === 'ANALOGIES')  return item.concept;
      if (_libType === 'SPINS')      return item.scenario;
      if (_libType === 'NLP' || _libType === 'CLOSES') return item.principle;
      if (_libType === 'PSYCHOLOGY') return item.principle;
      return item.objection;
    }

    function getPreview(item) {
      var s = _libType === 'ANALOGIES'  ? item.analogy :
              _libType === 'SPINS'      ? item.spin :
              (_libType === 'PSYCHOLOGY' || _libType === 'NLP' || _libType === 'CLOSES') ? item.technique :
              (item.rebuttal || item.rebutral || '');
      return s ? (s.substring(0,110) + (s.length > 110 ? '…' : '')) : '';
    }

    function getCopyText(item) {
      var body = _libType === 'ANALOGIES'  ? '"' + item.analogy + '"' :
                 _libType === 'SPINS'      ? item.spin :
                 (_libType === 'PSYCHOLOGY' || _libType === 'NLP' || _libType === 'CLOSES') ?
                   (item.technique + (item.script ? '\n\nSCRIPT: ' + item.script : '')) :
                 (item.rebuttal || item.rebutral || '');
      return body;
    }

    function filteredList() {
      var data = currentData();
      return data.filter(function(a) {
        /* asset filter — analogies only */
        if (_libType === 'ANALOGIES' && _asset !== 'ALL') {
          if (a.asset !== _asset && a.asset !== 'BOTH') return false;
        }
        if (_cat !== 'ALL' && a.cat !== _cat) return false;
        if (_search) {
          var q = _search.toLowerCase();
          var blob = JSON.stringify(a).toLowerCase();
          if (blob.indexOf(q) < 0) return false;
        }
        return true;
      });
    }

    function render() {
      var list = filteredList();
      var cats = catsByType[_libType] || ['ALL'];
      var assets = assetsByType[_libType] || [];

      /* TYPE TABS */
      var typeTabs = ['ANALOGIES','SPINS','PSYCHOLOGY','REBUTTALS','NLP','CLOSES'].map(function(t) {
        var active = _libType === t;
        var counts = {ANALOGIES: ANALOGIES.length, SPINS: SPINS.length, PSYCHOLOGY: PSYCHOLOGY.length, REBUTTALS: REBUTTALS.length, NLP: NLP.length, CLOSES: CLOSES.length};
        var lbl = t === 'PSYCHOLOGY' ? 'PSYCH' : t === 'REBUTTALS' ? 'REBUTS' : t === 'ANALOGIES' ? 'ANALOGY' : t;
        return '<button class="al-type" data-type="' + t + '" style="flex:1;padding:6px 2px;font-size:7.5px;letter-spacing:.08em;border:none;border-bottom:2px solid ' + (active ? A : 'transparent') + ';background:transparent;color:' + (active ? A : '#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;">' + lbl + '<span style="display:block;font-size:7px;color:' + (active?A:'#444') + ';margin-top:1px;">' + counts[t] + '</span></button>';
      }).join('');

      /* ASSET FILTER (analogies only) */
      var assetBtns = assets.length ? assets.map(function(k) {
        var active = _asset === k;
        return '<button class="al-asset" data-asset="' + k + '" style="padding:3px 8px;font-size:8px;letter-spacing:.1em;border:1px solid ' + (active?A:'#2a2a2a') + ';background:' + (active?A:'transparent') + ';color:' + (active?'#fff':'#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;white-space:nowrap;">' + k + '</button>';
      }).join('') : '';

      /* CATEGORY PILLS */
      var catPills = cats.map(function(c) {
        var active = _cat === c;
        return '<button class="al-cat" data-cat="' + escH(c) + '" style="padding:3px 8px;font-size:8px;letter-spacing:.1em;border:1px solid ' + (active?A:'#1c1c1c') + ';background:' + (active?A:'transparent') + ';color:' + (active?'#fff':'#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;white-space:nowrap;">' + c + '</button>';
      }).join('');

      /* CARDS */
      var typeColor = {ANALOGIES:'#D4AF37', SPINS:'#E97132', PSYCHOLOGY:'#4a9eff', REBUTTALS:'#b06bff', NLP:'#2ec4b6', CLOSES:'#e5383b'};
      var cards = list.length ? list.map(function(a) {
        var open = _open === a.id;
        var col = typeColor[_libType] || A;
        var isExpanded = _libType === 'PSYCHOLOGY' || _libType === 'NLP' || _libType === 'CLOSES';

        var body1 = _libType === 'ANALOGIES' ?
          '<div style="font-size:10px;color:#ffffff;line-height:1.6;font-style:italic;">"' + escH(getPreview(a)) + '</div>' :
          _libType === 'SPINS' ?
          '<div style="font-size:10px;color:#ffffff;line-height:1.6;">' + escH(getPreview(a)) + '</div>' :
          isExpanded ?
          '<div style="font-size:10px;color:#ffffff;line-height:1.6;">' + escH(a.technique ? a.technique.substring(0,110) + '…' : '') + '</div>' :
          '<div style="font-size:10px;color:#ffffff;line-height:1.6;font-style:italic;">' + escH(getPreview(a)) + '</div>';

        var expanded = '';
        if (open) {
          var copyBtn = '<button class="al-copy" data-id="' + a.id + '" style="margin-top:12px;padding:5px 14px;font-size:8px;letter-spacing:.12em;border:1px solid ' + col + ';background:transparent;color:' + col + ';cursor:pointer;font-family:Consolas,monospace;">COPY TO CLIPBOARD</button>';
          if (_libType === 'ANALOGIES') {
            expanded = '<div style="padding:0 14px 14px;animation:fadeIn .15s;">' +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">FULL ANALOGY</div>' +
              '<div style="font-size:11px;color:#ffffff;line-height:1.75;font-style:italic;border-left:3px solid ' + col + ';padding:8px 14px;margin-bottom:12px;background:#0a0a0a;">"' + escH(a.analogy) + '"</div>' +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">WHY IT WORKS</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.65;">' + escH(a.why) + '</div>' + copyBtn +
            '</div>';
          } else if (_libType === 'SPINS') {
            expanded = '<div style="padding:0 14px 14px;animation:fadeIn .15s;">' +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">THE REFRAME</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.7;border-left:3px solid ' + col + ';padding:8px 14px;margin-bottom:12px;background:#0a0a0a;">' + escH(a.spin) + '</div>' +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">WHY IT WORKS</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.65;">' + escH(a.why) + '</div>' + copyBtn +
            '</div>';
          } else if (_libType === 'PSYCHOLOGY' || _libType === 'NLP' || _libType === 'CLOSES') {
            expanded = '<div style="padding:0 14px 14px;animation:fadeIn .15s;">' +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">TECHNIQUE</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.7;border-left:3px solid ' + col + ';padding:8px 14px;margin-bottom:12px;background:#0a0a0a;">' + escH(a.technique) + '</div>' +
              (a.script ? '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">EXAMPLE SCRIPT</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.7;font-style:italic;border-left:3px solid #333;padding:8px 14px;margin-bottom:12px;background:#080808;">' + escH(a.script) + '</div>' : '') +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">WHY IT WORKS</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.65;">' + escH(a.why) + '</div>' + copyBtn +
            '</div>';
          } else {
            expanded = '<div style="padding:0 14px 14px;animation:fadeIn .15s;">' +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">FULL REBUTTAL</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.7;border-left:3px solid ' + col + ';padding:8px 14px;margin-bottom:12px;background:#0a0a0a;">' + escH(a.rebuttal || a.rebutral || '') + '</div>' +
              '<div style="font-size:8px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">WHY IT WORKS</div>' +
              '<div style="font-size:10px;color:#ffffff;line-height:1.65;">' + escH(a.why) + '</div>' + copyBtn +
            '</div>';
          }
        }

        return '<div class="al-card" data-id="' + a.id + '" style="border-bottom:1px solid #111;cursor:pointer;">' +
          '<div style="padding:10px 14px;display:flex;align-items:flex-start;gap:10px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                (a.asset ? '<span style="font-size:8px;letter-spacing:.14em;color:' + col + ';">' + a.asset + '</span><span style="color:#333;">·</span>' : '') +
                '<span style="font-size:7px;letter-spacing:.11em;color:#ffffff;">' + a.cat + '</span>' +
              '</div>' +
              '<div style="font-size:10px;color:#ffffff;font-weight:600;letter-spacing:.04em;margin-bottom:6px;">' + escH(getTitle(a)) + '</div>' +
              body1 +
            '</div>' +
            '<div style="color:#ffffff;font-size:10px;flex-shrink:0;margin-top:2px;">' + (open ? '▲' : '▼') + '</div>' +
          '</div>' +
          expanded +
        '</div>';
      }).join('') : '<div style="padding:24px;text-align:center;color:#ffffff;font-size:11px;">No entries match — try a different filter</div>';

      body.innerHTML =
        '<style>' +
          '@keyframes fadeIn{from{opacity:0}to{opacity:1}}' +
          '.al-type:hover,.al-cat:hover,.al-asset:hover{color:' + A + '!important;border-color:' + A + '!important;}' +
        '</style>' +
        /* type tabs */
        '<div style="display:flex;border-bottom:1px solid #181818;background:#030303;">' + typeTabs + '</div>' +
        /* toolbar */
        '<div style="padding:8px 12px 0;background:#050505;border-bottom:1px solid #111;">' +
          (assetBtns ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px;">' + assetBtns + '</div>' : '') +
          '<input id="al-search" placeholder="Search library…" value="' + escH(_search) + '" style="width:100%;box-sizing:border-box;background:#0a0a0a;border:1px solid #1a1a1a;padding:6px 10px;color:#fff;font-size:10px;font-family:Consolas,monospace;outline:none;margin-bottom:7px;">' +
          '<div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;">' + catPills + '</div>' +
        '</div>' +
        /* count */
        '<div style="padding:4px 14px;font-size:8px;letter-spacing:.15em;color:#ffffff;border-bottom:1px solid #0d0d0d;">' + list.length + ' ' + _libType + '</div>' +
        /* list */
        '<div style="overflow-y:auto;flex:1;">' + cards + '</div>';

      /* wire events */
      body.querySelectorAll('.al-type').forEach(function(btn) {
        btn.addEventListener('click', function() { _libType = this.dataset.type; _cat = 'ALL'; _open = null; render(); });
      });
      var si = body.querySelector('#al-search');
      if (si) si.addEventListener('input', function() { _search = this.value; _open = null; render(); });
      body.querySelectorAll('.al-asset').forEach(function(btn) {
        btn.addEventListener('click', function() { _asset = this.dataset.asset; _open = null; render(); });
      });
      body.querySelectorAll('.al-cat').forEach(function(btn) {
        btn.addEventListener('click', function() { _cat = this.dataset.cat; _open = null; render(); });
      });
      body.querySelectorAll('.al-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
          if (e.target.classList.contains('al-copy')) return;
          var cid = this.dataset.id;
          _open = _open === cid ? null : cid;
          render();
          if (_open) {
            var el = body.querySelector('[data-id="' + cid + '"]');
            if (el) { setTimeout(function(){ el.scrollIntoView({block:'nearest'}); }, 50); }
          }
        });
      });
      body.querySelectorAll('.al-copy').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var cid = this.dataset.id;
          var data = currentData();
          var a = data.filter(function(x){ return x.id === cid; })[0];
          if (!a) return;
          navigator.clipboard.writeText(getCopyText(a)).then(function() {
            btn.textContent = 'COPIED ✓';
            btn.style.background = A;
            btn.style.color = '#fff';
            setTimeout(function(){ btn.textContent = 'COPY TO CLIPBOARD'; btn.style.background = 'transparent'; btn.style.color = A; }, 2000);
          }).catch(function(){});
        });
      });
    }

    /* lens change listener */
    window.addEventListener('lens:change', function() {
      var lk = (window._assetLens && window._assetLens.key) || 'universal';
      if (lk === 'eis' || lk === 'vct' || lk === 'offshore') _asset = 'EIS/VCT';
      else if (lk === 'pe' || lk === 'trusts')               _asset = 'PE/TRUSTS';
      else if (lk === 'gold')                                 _asset = 'GOLD';
      else if (lk === 'whisky')                               _asset = 'WHISKY';
      else                                                    _asset = 'ALL';
      _open = null;
      if (body.parentNode) render();
    });

    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';
    body.style.background = '#050505';
    render();
  }

  function renderEconCalendar(id, body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';
    body.style.padding = '0';

    var impactCol = {high:'#e05050', medium:'#E97132', low:'#555'};
    var impactLbl = {high:'HIGH', medium:'MED', low:'LOW'};

    /* Map event keywords -> sales context */
    function getSalesScript(eventName, impact) {
      if (impact !== 'high') return null;
      var n = (eventName || '').toLowerCase();
      if (n.indexOf('nonfarm') !== -1 || n.indexOf('non-farm') !== -1 || (n.indexOf('payroll') !== -1 && n.indexOf('non') !== -1)) {
        return {
          beats: '"Payrolls beat — the Fed stays on hold. Higher for longer means the opportunity cost of cash stays elevated. Every month of delay in positioning costs clients real purchasing power. The gold case has never been stronger in a high-rate environment."',
          misses: '"Payrolls missed — the rate cut cycle is accelerating. Historically, rate cuts are gold\'s strongest catalyst. Position clients before the pivot becomes the mainstream trade."',
          note: 'Use LABOUR TAB data for context.'
        };
      }
      if (n.indexOf('cpi') !== -1 || n.indexOf('consumer price') !== -1) {
        return {
          beats: '"CPI came in above forecast. Inflation is running hotter than expected — the Fed\'s 2% target looks increasingly distant. Every month above target is a direct argument for assets that preserve purchasing power: gold, property, whisky casks, and fine wine."',
          misses: '"CPI softer than expected. Disinflation is progressing and the pivot is approaching. The most powerful phase of gold bull markets historically begins as inflation falls and rates follow. Position before the pivot is confirmed."',
          note: 'Use INFLATION TAB data for context.'
        };
      }
      if (n.indexOf('pce') !== -1 || n.indexOf('personal consumption') !== -1) {
        return {
          beats: '"Core PCE above consensus — the Fed\'s preferred inflation gauge is still running hot. Real yields are compressing. The case for non-correlated hard assets is strengthening every month."',
          misses: '"Core PCE softer — disinflation trend intact. The rate pivot window is opening. Gold historically front-runs the cut by 6–12 weeks. The positioning window is now, not after the announcement."',
          note: 'Use INFLATION TAB data for context.'
        };
      }
      if (n.indexOf('fomc') !== -1 || n.indexOf('fed') !== -1 || n.indexOf('federal funds') !== -1 || n.indexOf('interest rate decision') !== -1) {
        return {
          beats: '"Fed held / hiked — peak rates confirmed. Historically, peak Fed Funds rate has marked the optimal positioning window for gold. The opportunity cost argument is at its strongest precisely when rates are highest — because the cycle always reverses."',
          misses: '"Fed cut rates. This is the catalyst the gold market has been pricing in. Rate cuts compress real yields — and real yield compression is the single most reliable driver of gold outperformance. Clients who positioned before this cut are already ahead."',
          note: 'Use RATES TAB data for context.'
        };
      }
      if (n.indexOf('gdp') !== -1 || n.indexOf('gross domestic product') !== -1) {
        return {
          beats: '"GDP beat — the expansion is holding. This environment supports premium asset allocations and risk appetite. Ideal timing to position clients across alternative assets — gold, property, whisky, fine wine — before the next tightening cycle."',
          misses: '"GDP disappointed. The contractionary signal is building — central bank accommodation follows. Balance sheet expansion has driven gold\'s strongest historical performances. The positioning window opens as growth disappoints."',
          note: 'Use BUSINESS CYCLE TAB data for context.'
        };
      }
      if (n.indexOf('ism') !== -1 || n.indexOf('purchasing managers') !== -1 || n.indexOf('pmi') !== -1) {
        return {
          beats: '"ISM beat — manufacturing activity expanding. Risk appetite is elevated. Clients in growth mode are more receptive to portfolio enhancement with alternative assets."',
          misses: '"ISM missed and is in contraction territory. Manufacturing is leading the economy lower. This is the environment where the flight-to-quality conversation is most natural — lead with protection, not performance."',
          note: 'Use BUSINESS CYCLE TAB data for context.'
        };
      }
      if (n.indexOf('unemployment') !== -1 || n.indexOf('initial claims') !== -1 || n.indexOf('jobless') !== -1) {
        return {
          beats: '"Claims lower / unemployment fell — labour market holding. Consumer spending capacity is intact. Premium asset conversations go better when clients feel financially confident."',
          misses: '"Claims rising / unemployment ticked up. When unemployment moves, the Fed moves — toward cuts. Rate cuts are historically gold\'s strongest catalyst. Position clients before the pivot is official."',
          note: 'Use LABOUR TAB data for context.'
        };
      }
      if (n.indexOf('jolts') !== -1 || n.indexOf('job opening') !== -1) {
        return {
          beats: '"Job openings still elevated — tight labour market supports wages and spending. Premium and alternative asset conversations are well-timed right now."',
          misses: '"Job openings declining — labour demand is softening before the headline unemployment data confirms it. The forward indicator says the cut cycle is coming. Front-run the pivot."',
          note: 'Use LABOUR TAB data for context.'
        };
      }
      if (n.indexOf('retail sales') !== -1) {
        return {
          beats: '"Retail sales beat — consumers are still spending. Discretionary and premium conversations are well-supported. Good timing for whisky cask positioning."',
          misses: '"Retail sales disappointed — consumer retrenchment is building. The defensive portfolio reallocation conversation is timely. Lead with capital preservation, not growth."',
          note: 'Use CONSUMER TAB data for context.'
        };
      }
      if (n.indexOf('consumer confidence') !== -1 || n.indexOf('consumer sentiment') !== -1 || n.indexOf('michigan') !== -1) {
        return {
          beats: '"Consumer sentiment strong — clients feel financially confident. This is the optimal window for discretionary alternative asset conversations."',
          misses: '"Consumer sentiment dropped. Clients are uncertain — that uncertainty is the emotional foundation for the defensive asset case. Lead with protection and preservation of purchasing power."',
          note: 'Use CONSUMER TAB data for context.'
        };
      }
      if (n.indexOf('housing') !== -1 || n.indexOf('home sales') !== -1 || n.indexOf('existing home') !== -1 || n.indexOf('new home') !== -1) {
        return {
          beats: '"Housing holding — but affordability is still stretched at current mortgage rates. Clients unable to deploy capital into property at these rates are actively looking for alternatives."',
          misses: '"Housing weakening. The traditional store of wealth is under pressure. Capital seeking appreciation outside the mortgage market is looking for exactly what we provide."',
          note: 'Use HOUSING TAB data for context.'
        };
      }
      if (n.indexOf('bank of england') !== -1 || n.indexOf('boe') !== -1 || n.indexOf('mpc') !== -1) {
        return {
          beats: '"BoE held / hiked — UK rates staying elevated. Sterling is supported short-term, but the growth cost is building. A prolonged hold compresses UK consumer confidence — the defensive asset conversation becomes more natural."',
          misses: '"BoE cut rates. Sterling weakening. GBP-denominated gold returns are amplified by sterling depreciation — clients holding gold in GBP benefit from both the gold price move and the currency move simultaneously."',
          note: 'Use UK MACRO TAB data for context.'
        };
      }
      if (n.indexOf('uk') !== -1 && (n.indexOf('cpi') !== -1 || n.indexOf('inflation') !== -1 || n.indexOf('rpi') !== -1)) {
        return {
          beats: '"UK inflation above target again. BoE faces the same trap as the Fed — hold and hurt growth, or cut and let inflation run. Sterling weakness in this scenario amplifies gold returns in GBP terms."',
          misses: '"UK inflation cooling — BoE cut cycle is approaching. The dual catalyst for GBP gold: sterling weakness plus monetary easing. Scotch whisky sits at the intersection of UK supply and global dollar demand."',
          note: 'Use UK MACRO TAB data for context.'
        };
      }
      return null;
    }

    var _view = 'week';  /* 'week' or 'month' */
    var _events = [];
    var _expanded = {};  /* script panels open */

    function fmt2(n) { return n < 10 ? '0' + n : String(n); }

    function renderView() {
      if (!_events.length) {
        body.innerHTML = buildShell('<div style="padding:40px;text-align:center;font-family:Consolas,monospace;font-size:10px;color:#555;letter-spacing:0.2em;">NO UPCOMING EVENTS</div>');
        wireToolbar();
        return;
      }
      body.innerHTML = buildShell(_view === 'week' ? buildWeekView() : buildMonthView());
      wireToolbar();
    }

    function buildShell(inner) {
      return '<div style="display:flex;flex-direction:column;height:100%;font-family:Consolas,monospace;">' +
        '<div id="tec-toolbar-' + id + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #2a2a2a;flex-shrink:0;">' +
          '<span style="font-size:8px;letter-spacing:0.25em;color:#555;flex:1;">ECONOMIC CALENDAR</span>' +
          '<button id="tec-week-' + id + '" style="padding:3px 10px;font-size:8px;letter-spacing:0.15em;border:1px solid ' + (_view==='week'?'#E97132':'#333') + ';background:' + (_view==='week'?'#E97132':'transparent') + ';color:' + (_view==='week'?'#fff':'#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;">WEEK</button>' +
          '<button id="tec-month-' + id + '" style="padding:3px 10px;font-size:8px;letter-spacing:0.15em;border:1px solid ' + (_view==='month'?'#E97132':'#333') + ';background:' + (_view==='month'?'#E97132':'transparent') + ';color:' + (_view==='month'?'#fff':'#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;">MONTH</button>' +
          '<button id="tec-filt-high-' + id + '" style="padding:3px 8px;font-size:8px;border:1px solid #c0392b;background:transparent;color:#e05050;cursor:pointer;font-family:Consolas,monospace;">●HIGH</button>' +
        '</div>' +
        '<div style="flex:1;overflow-y:auto;">' + inner + '</div>' +
      '</div>';
    }

    function buildWeekView() {
      /* Group events by date, show next 14 days */
      var grouped = {};
      var now = new Date();
      var cutoff = new Date(now.getTime() + 14 * 86400000);
      _events.forEach(function(e) {
        var raw = e.date || e.time || '';
        var d = raw.slice(0, 10);
        if (!d) return;
        var dt = new Date(d + 'T12:00:00');
        if (dt < new Date(now.toISOString().slice(0,10) + 'T00:00:00') || dt > cutoff) return;
        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(e);
      });

      if (!Object.keys(grouped).length) {
        /* Show next 30 future events when no events in 14-day window */
        var todayStr = new Date().toISOString().slice(0, 10);
        _events.filter(function(e) {
          return (e.date || e.time || '').slice(0, 10) >= todayStr;
        }).slice(0, 30).forEach(function(e) {
          var raw = e.date || e.time || '';
          var d = raw.slice(0, 10);
          if (!d) return;
          if (!grouped[d]) grouped[d] = [];
          grouped[d].push(e);
        });
      }

      /* Bloomberg-style column headers — sticky */
      var COLS = 'grid-template-columns:36px 22px 10px 1fr 34px 50px 54px 44px 40px';
      var hdr = '<div style="display:grid;' + COLS + ';padding:4px 8px;border-bottom:1px solid #222;background:#000;position:sticky;top:0;z-index:2;">' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;">TIME</div>' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;">C</div>' +
        '<div></div>' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;">EVENT</div>' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;text-align:right;padding-right:4px;">PRD</div>' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;text-align:right;padding-right:5px;">SURVEY</div>' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;text-align:right;padding-right:5px;">ACTUAL</div>' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;text-align:right;padding-right:4px;">PRIOR</div>' +
        '<div style="font-size:6.5px;color:rgba(255,255,255,0.35);letter-spacing:.1em;text-align:right;">REV</div>' +
      '</div>';

      var html = hdr;
      Object.keys(grouped).sort().forEach(function(date) {
        var dt = new Date(date + 'T12:00:00');
        var dayLbl = dt.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
        var isToday = date === new Date().toISOString().slice(0,10);
        html += '<div style="padding:4px 8px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;font-size:7.5px;letter-spacing:0.2em;color:' + (isToday ? '#E97132' : '#444') + ';">' + (isToday ? '◆ TODAY · ' : '') + dayLbl.toUpperCase() + '</div>';
        grouped[date].forEach(function(e) {
          html += buildEventRow(e);
        });
      });
      return html.length > hdr.length ? html : (hdr + '<div style="padding:40px;text-align:center;font-size:10px;color:#555;font-family:Consolas,monospace;letter-spacing:0.2em;">NO EVENTS IN NEXT 14 DAYS</div>');
    }

    function buildMonthView() {
      var now = new Date();
      var year = now.getFullYear();
      var month = now.getMonth();
      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var monthName = now.toLocaleDateString('en-GB', {month:'long', year:'numeric'}).toUpperCase();

      /* Map events to days */
      var dayEvents = {};
      _events.forEach(function(e) {
        var raw = e.date || '';
        if (!raw) return;
        var parts = raw.slice(0,10).split('-');
        if (parseInt(parts[0]) !== year || parseInt(parts[1])-1 !== month) return;
        var d = parseInt(parts[2]);
        if (!dayEvents[d]) dayEvents[d] = [];
        dayEvents[d].push(e);
      });

      var html = '<div style="padding:10px 12px;">';
      html += '<div style="text-align:center;font-size:10px;letter-spacing:0.25em;color:#fff;margin-bottom:10px;">' + monthName + '</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:8px;">';
      ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach(function(d) {
        html += '<div style="text-align:center;font-size:7px;letter-spacing:0.15em;color:#555;padding:4px 0;">' + d + '</div>';
      });
      html += '</div>';
      html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">';
      /* empty cells before first day */
      for (var i = 0; i < firstDay; i++) {
        html += '<div style="min-height:42px;"></div>';
      }
      for (var d = 1; d <= daysInMonth; d++) {
        var isToday = d === now.getDate();
        var evs = dayEvents[d] || [];
        var hiColor = '#555';
        evs.forEach(function(e) {
          var imp = (e.impact||'low').toLowerCase();
          if (imp === 'high') hiColor = '#e05050';
          else if (imp === 'medium' && hiColor !== '#e05050') hiColor = '#E97132';
        });
        var hasDot = evs.length > 0;
        /* Determine dominant impact color */
        var cellBdr = '#1e1e1e';
        if (hasDot) {
          var hasHigh = evs.some(function(e){ return (e.impact||'').toLowerCase()==='high'; });
          var hasMed  = evs.some(function(e){ return (e.impact||'').toLowerCase()==='medium'; });
          if (hasHigh) cellBdr = '#5a1a1a';
          else if (hasMed) cellBdr = '#4a2a0a';
        }
        html += '<div style="min-height:48px;border:1px solid ' + (isToday ? '#E97132' : cellBdr) + ';padding:3px;cursor:' + (hasDot?'pointer':'default') + ';" ' +
          (hasDot ? 'data-tec-day="' + d + '"' : '') + '>' +
          '<div style="font-size:8px;color:' + (isToday ? '#E97132' : '#666') + ';text-align:right;margin-bottom:2px;">' + d + '</div>' +
          (hasDot ? evs.slice(0,4).map(function(e) {
            var imp = (e.impact||'low').toLowerCase();
            var ec  = impactCol[imp] || '#555';
            var nm  = (e.event||'').replace(/\(.*?\)/g,'').trim().split(' ').slice(0,3).join(' ');
            return '<div style="font-size:6.5px;color:' + ec + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.5;letter-spacing:.03em;">●&nbsp;' + escH(nm) + '</div>';
          }).join('') +
          (evs.length > 4 ? '<div style="font-size:6px;color:#444;margin-top:1px;">+' + (evs.length-4) + ' more</div>' : '')
          : '') +
        '</div>';
      }
      html += '</div>';

      /* Event list for clicked day (hidden initially) */
      html += '<div id="tec-day-detail-' + id + '" style="margin-top:10px;"></div>';
      html += '</div>';
      return html;
    }

    /* Bloomberg/LSEG-style dense table row */
    function buildEventRow(e) {
      var impact  = (e.impact || 'low').toLowerCase();
      var col     = impactCol[impact] || '#555';
      var actual  = (e.actual   != null && e.actual   !== '') ? String(e.actual)   : '';
      var survey  = (e.estimate != null && e.estimate !== '') ? String(e.estimate) : '';
      var prior   = (e.previous != null && e.previous !== '') ? String(e.previous) : '';
      var revised = (e.revised  != null && e.revised  !== '') ? String(e.revised)  : '';
      var period  = e.period || '';
      var rawTime = e.date || '';
      var timeStr = rawTime.length > 10 ? rawTime.slice(11, 16) : '';
      var country = (e.country || '').toUpperCase().replace('USD','US').replace('GBP','UK').replace('EUR','EU').replace('JPY','JP').slice(0,3);

      /* Beat / miss colour */
      var actualCol  = '#fff';
      var beatArrow  = '';
      if (actual && survey) {
        var aNum = parseFloat(actual); var sNum = parseFloat(survey);
        if (!isNaN(aNum) && !isNaN(sNum)) {
          if (aNum > sNum) { actualCol = '#3DAA6A'; beatArrow = '▲'; }
          else if (aNum < sNum) { actualCol = '#D14040'; beatArrow = '▼'; }
        }
      }

      var released = actual !== '';
      var script   = getSalesScript(e.event || '', impact);
      var eid      = 'tec-e-' + (e.date||'').replace(/[^0-9]/g,'') + '-' + (e.event||'').replace(/[^a-zA-Z]/g,'').slice(0,12);
      var impDot   = impact === 'high' ? '<span style="color:#D14040;">●</span>' : impact === 'medium' ? '<span style="color:#E97132;">●</span>' : '<span style="color:#444;">●</span>';

      /* Grid: TIME | C | IMP | EVENT | PRD | SURVEY | ACTUAL | PRIOR | REV */
      var row = '<div style="display:grid;grid-template-columns:36px 22px 10px 1fr 34px 50px 54px 44px 40px;' +
        'align-items:center;padding:5px 8px;gap:0;min-height:26px;border-bottom:1px solid #111;' +
        'cursor:' + (script?'pointer':'default') + ';" ' +
        (script ? 'data-tec-toggle="' + eid + '"' : '') + '>' +
        '<div style="font-size:7.5px;color:#666;font-variant-numeric:tabular-nums;">' + (timeStr||'—') + '</div>' +
        '<div style="font-size:7.5px;color:#888;font-weight:600;">' + escH(country) + '</div>' +
        '<div>' + impDot + '</div>' +
        '<div style="font-size:9px;color:#fff;padding-right:4px;line-height:1.3;">' + escH(e.event||'') +
          (script ? '<span style="font-size:7px;color:#E97132;margin-left:3px;" id="tec-arr-' + eid + '">▼</span>' : '') +
        '</div>' +
        '<div style="font-size:7.5px;color:#555;text-align:right;padding-right:4px;">' + escH(period) + '</div>' +
        '<div style="font-size:7.5px;color:#888;text-align:right;padding-right:5px;font-variant-numeric:tabular-nums;">' + (survey||'—') + '</div>' +
        '<div style="font-size:7.5px;font-weight:700;color:' + (released ? actualCol : '#383838') + ';text-align:right;padding-right:5px;font-variant-numeric:tabular-nums;">' +
          (released ? (actual + beatArrow) : '—') +
        '</div>' +
        '<div style="font-size:7.5px;color:#555;text-align:right;padding-right:4px;font-variant-numeric:tabular-nums;">' + (prior||'—') + '</div>' +
        '<div style="font-size:7.5px;color:' + (revised ? '#9B6FD4' : '#2a2a2a') + ';text-align:right;font-variant-numeric:tabular-nums;">' + (revised||'—') + '</div>' +
      '</div>';

      var scriptPanel = script ?
        '<div id="' + eid + '" style="display:none;padding:0 8px 8px 8px;">' +
          '<div style="border:1px solid #2a2a2a;border-left:3px solid #E97132;padding:8px 12px;">' +
            '<div style="font-size:7px;color:#E97132;letter-spacing:0.2em;margin-bottom:6px;">SALES SCRIPT</div>' +
            '<div style="font-size:7.5px;color:#e05050;letter-spacing:0.12em;margin-bottom:3px;">IF BEATS FORECAST</div>' +
            '<div style="font-size:8.5px;color:#fff;line-height:1.6;font-style:italic;margin-bottom:8px;">' + escH(script.beats) + '</div>' +
            '<div style="font-size:7.5px;color:#3DAA6A;letter-spacing:0.12em;margin-bottom:3px;">IF MISSES FORECAST</div>' +
            '<div style="font-size:8.5px;color:#fff;line-height:1.6;font-style:italic;margin-bottom:6px;">' + escH(script.misses) + '</div>' +
            '<div style="font-size:7px;color:#555;letter-spacing:0.12em;border-top:1px solid #222;padding-top:5px;">' + escH(script.note) + '</div>' +
          '</div>' +
        '</div>' : '';

      return '<div>' + row + scriptPanel + '</div>';
    }

    function wireToolbar() {
      var wBtn = body.querySelector('#tec-week-' + id);
      var mBtn = body.querySelector('#tec-month-' + id);
      var hBtn = body.querySelector('#tec-filt-high-' + id);
      if (wBtn) wBtn.addEventListener('click', function() { _view = 'week'; renderView(); });
      if (mBtn) mBtn.addEventListener('click', function() { _view = 'month'; renderView(); });
      if (hBtn) hBtn.addEventListener('click', function() {
        var prevFilter = hBtn.getAttribute('data-active');
        if (prevFilter === '1') {
          hBtn.removeAttribute('data-active');
          hBtn.style.background = 'transparent';
          hBtn.style.color = '#e05050';
          /* restore all events */
          _events = _allEvents.slice();
        } else {
          hBtn.setAttribute('data-active', '1');
          hBtn.style.background = '#c0392b';
          hBtn.style.color = '#fff';
          _events = _allEvents.filter(function(e){ return (e.impact||'').toLowerCase() === 'high'; });
        }
        renderView();
      });
      /* Script toggles */
      body.querySelectorAll('[data-tec-toggle]').forEach(function(el) {
        el.addEventListener('click', function() {
          var tid = el.getAttribute('data-tec-toggle');
          var panel = body.querySelector('#' + tid);
          var arr = body.querySelector('#tec-arr-' + tid);
          if (!panel) return;
          var open = panel.style.display !== 'none';
          panel.style.display = open ? 'none' : 'block';
          if (arr) arr.textContent = open ? '▼' : '▲';
        });
      });
      /* Month day clicks */
      body.querySelectorAll('[data-tec-day]').forEach(function(el) {
        el.addEventListener('click', function() {
          var d = parseInt(el.getAttribute('data-tec-day'));
          var now = new Date();
          var dateStr = now.getFullYear() + '-' + fmt2(now.getMonth()+1) + '-' + fmt2(d);
          var evs = _allEvents.filter(function(e){ return (e.date||'').slice(0,10) === dateStr; });
          var detail = body.querySelector('#tec-day-detail-' + id);
          if (!detail || !evs.length) return;
          detail.innerHTML = evs.map(buildEventRow).join('');
          wireScriptToggles(detail);
        });
      });
    }

    function wireScriptToggles(container) {
      container.querySelectorAll('[data-tec-toggle]').forEach(function(el) {
        el.addEventListener('click', function() {
          var tid = el.getAttribute('data-tec-toggle');
          var panel = container.querySelector('#' + tid);
          var arr = container.querySelector('#tec-arr-' + tid);
          if (!panel) return;
          var open = panel.style.display !== 'none';
          panel.style.display = open ? 'none' : 'block';
          if (arr) arr.textContent = open ? '▼' : '▲';
        });
      });
    }

    var _allEvents = [];
    body.innerHTML = '<div style="padding:20px;text-align:center;font-family:Consolas,monospace;font-size:10px;color:#555;letter-spacing:0.2em;">FETCHING EVENTS…</div>';

    fetch('/.netlify/functions/econ-calendar')
      .then(function(r) { return r.ok ? r.json() : r.json().then(function(e){ return Promise.reject(e.error || r.status); }); })
      .then(function(data) {
        _allEvents = (Array.isArray(data) ? data : []).filter(function(e) { return e.event; });
        _events = _allEvents.slice();
        renderView();
      })
      .catch(function(err) {
        body.innerHTML = '<div style="padding:20px;text-align:center;font-family:Consolas,monospace;font-size:10px;color:#555;">COULD NOT LOAD — ' + escH(String(err)) + '</div>';
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


  /* ═══════════════════════════════════════════════════════════════════════
     GOLD INTELLIGENCE — central bank buying, COT, demand, supply
     ═══════════════════════════════════════════════════════════════════════ */
  function renderGoldIntel(id, body) {
    var A   = '#E97132';
    var GOLD= '#C9A84C';
    var REC = '#FFD700';
    var BLU = '#4A90D9';
    var GRN = '#3DAA6A';
    var RED = '#D14040';
    var PRP = '#9B6FD4';
    var _tab = 'cb';
    var _catalystLive = null;
    var _newsChannel  = 'aljazeera';

    var NEWS_CHANNELS = [
      { key:'aljazeera', label:'AL JAZEERA',  cid:'UCNye-wNBqNL5ZzHSJdrlvxQ', tag:'GLOBAL',   sub:'English · 24/7 live' },
      { key:'sky',       label:'SKY NEWS',    cid:'UCoMdktPbSTixAyNGwb-UYkQ', tag:'UK / EU',  sub:'English · 24/7 live' },
      { key:'france24',  label:'FRANCE 24',   cid:'UCQfwfsi5VrQ8yKZ-UWmAEFg', tag:'INT\'L',   sub:'English · 24/7 live' },
      { key:'dw',        label:'DW NEWS',     cid:'UCknLrEdhRCp1aegoMqRaCZg', tag:'EUROPE',   sub:'English · 24/7 live' },
      { key:'cnbc',      label:'CNBC',        cid:'UCvJJ_dzjViJCoLf5uKUTwoA', tag:'MARKETS',  sub:'English · business live' },
      { key:'bloomberg', label:'BLOOMBERG TV',cid:'UCIALMKvObZNtJ6AmdCLP7Lg', tag:'MARKETS',  sub:'May require subscription' },
    ];

    var CB_ANNUAL = [
      {y:'2016',t:383},  {y:'2017',t:375},  {y:'2018',t:656},
      {y:'2019',t:668},  {y:'2020',t:255},  {y:'2021',t:450},
      {y:'2022',t:1080},
      {y:'2023',t:1051},
      {y:'2024',t:1089,rec:true},
      {y:'2025',t:863},
      {y:'2026',t:345,ytd:true},
    ];
    var MAX_BUY = 1089;

    var TOP_BUYERS_DATA = {
      '2024': {
        src: 'WORLD GOLD COUNCIL  ·  FY 2024',
        buyers: [
          {name:'Poland',          t:90,  note:''},
          {name:'India',           t:72,  note:''},
          {name:'Turkey',          t:45,  note:''},
          {name:'Czech Rep.',      t:29,  note:''},
          {name:'China (official)',t:29,  note:'* est. higher via OTC'},
          {name:'Singapore',       t:23,  note:''},
        ],
      },
      '2025': {
        src: 'WORLD GOLD COUNCIL  ·  FY 2025',
        buyers: [
          {name:'Poland',          t:90,  note:'NBP structural accumulation'},
          {name:'India',           t:77,  note:'RBI active diversification'},
          {name:'China (official)',t:44,  note:'* est. higher via OTC; buying resumed'},
          {name:'Czech Rep.',      t:27,  note:''},
          {name:'Kazakhstan',      t:24,  note:''},
          {name:'Turkey',          t:20,  note:'TCMB slowed vs 2024'},
        ],
      },
      '2026': {
        src: 'WORLD GOLD COUNCIL  ·  H1 2026  ·  PARTIAL YEAR',
        buyers: [
          {name:'China (official)',t:80,  note:'* est. higher via OTC; Jul +20t'},
          {name:'Poland',          t:31,  note:'NBP on pace for 3rd consecutive 90t+ yr'},
          {name:'India',           t:29,  note:'RBI H1 2026'},
          {name:'Kazakhstan',      t:15,  note:''},
          {name:'Czech Rep.',      t:12,  note:''},
          {name:'Turkey',          t:10,  note:'Volatile — domestic demand pressures'},
        ],
      },
    };
    var _buyerYear = '2025';

    /* Live CB holdings — populated async from IMF IFS via Netlify function */
    var _cbLive = null;

    var CB_HOLDERS = [
      {name:'United States', t:8133, pct:72.6},
      {name:'Germany',       t:3352, pct:72.4},
      {name:'Italy',         t:2452, pct:66.5},
      {name:'France',        t:2437, pct:67.5},
      {name:'China',         t:2386, pct:5.3,  note:'* Jul 2026 · GS est. materially higher (OTC)'},
      {name:'Russia',        t:2335, pct:29.5},
      {name:'Switzerland',   t:1040, pct:7.4},
      {name:'India',         t:869,  pct:9.7},
      {name:'Japan',         t:846,  pct:4.3},
      {name:'Netherlands',   t:612,  pct:54.7},
      {name:'Turkey',        t:555,  pct:32.1},
      {name:'Poland',        t:448,  pct:15.6},
      {name:'Portugal',      t:383,  pct:71.2},
      {name:'Saudi Arabia',  t:323,  pct:4.5},
      {name:'Kazakhstan',    t:302,  pct:56.5},
    ];
    var MAX_HOLD = 8133;

    /* ── WGC-verified gold market data by year (metric tonnes) ── */
    var GOLD_DATA = {
      '2024': {
        label: 'FY 2024', src: 'WGC GOLD DEMAND TRENDS FY 2024',
        supply: { mine: 3638, recycle: 1241, hedge: -128 },
        demand: { jewellery: 1877, barCoin: 1186, cb: 1029, tech: 326, etf: -244 },
      },
      '2025': {
        label: 'FY 2025', src: 'WGC GOLD DEMAND TRENDS FY 2025',
        supply: { mine: 3672, recycle: 1278, hedge: -120 },
        demand: { jewellery: 1720, barCoin: 1115, cb: 863, tech: 332, etf: 110 },
      },
      '2026': {
        label: '2026 YTD', src: 'WGC Q1+Q2 2026  ·  PARTIAL YEAR',
        supply: { mine: 1780, recycle: 720, hedge: -35 },
        demand: { jewellery: 680, barCoin: 610, cb: 533, tech: 165, etf: 80 },
      },
    };
    var _demandYear = '2025';   /* default to most recent complete year */

    var COT = {
      asOf:'AUG 2025',
      mm_long:229184, mm_short:54802,
      pm_long:91234,  pm_short:378679,
      sd_long:74392,  sd_short:168626,
      oi:498230, oi_prev:452100,
    };
    COT.mm_net = COT.mm_long  - COT.mm_short;
    COT.pm_net = COT.pm_long  - COT.pm_short;
    COT.sd_net = COT.sd_long  - COT.sd_short;

    /* ── ETF & Fund Flow data (WGC Monthly Report + Yahoo Finance live)  */
    var ETF = {
      asOf: 'AUG 2026',
      totalTonnes: 3562,
      momChange: +17,
      yoyChange: +292,
    };

    var ETF_REGIONAL = [
      {r:'North America', t:2058, pct:58, flow:+11, col:BLU},
      {r:'Europe',        t:1069, pct:30, flow:+4,  col:A},
      {r:'Asia Pacific',  t:346,  pct:10, flow:+2,  col:GRN},
      {r:'Other',         t:89,   pct:2,  flow:0,   col:'#555'},
    ];

    var ETF_FUNDS = [
      {tk:'GLD',  n:'SPDR Gold Shares',     mgr:'State Street', t:893, er:'0.40%'},
      {tk:'IAU',  n:'iShares Gold Trust',   mgr:'BlackRock',    t:461, er:'0.25%'},
      {tk:'GLDM', n:'SPDR Gold MiniShares', mgr:'State Street', t:118, er:'0.10%'},
    ];

    var ETF_FLOWS = [
      {m:'Aug-25',t:28}, {m:'Sep-25',t:14}, {m:'Oct-25',t:-9},
      {m:'Nov-25',t:18}, {m:'Dec-25',t:22}, {m:'Jan-26',t:48},
      {m:'Feb-26',t:35}, {m:'Mar-26',t:61}, {m:'Apr-26',t:-14},
      {m:'May-26',t:29}, {m:'Jun-26',t:38}, {m:'Jul-26',t:22},
      {m:'Aug-26',t:17},
    ];


    function fmt(n){ return Math.round(n).toLocaleString(); }

    function miniSpark(data, col, W, H) {
      W = W || 52; H = H || 14;
      if (!data || data.length < 2) return '<svg width="' + W + '" height="' + H + '"></svg>';
      var min = Math.min.apply(null, data);
      var max = Math.max.apply(null, data);
      var rng = max - min || 1;
      var pts = data.map(function(v, i) {
        var x = (i / (data.length - 1)) * W;
        var y = H - 1 - ((v - min) / rng) * (H - 3);
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      var last = data[data.length - 1];
      var lx = W, ly = H - 1 - ((last - min) / rng) * (H - 3);
      return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:inline-block;vertical-align:middle;overflow:visible;">' +
        '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" opacity=".7"/>' +
        '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="1.5" fill="' + col + '"/>' +
        '</svg>';
    }

    function tabBtn(key, label) {
      var act = _tab === key;
      return '<button id="gi-t-' + key + '-' + id + '" style="' +
        'flex:1;padding:7px 2px;font-size:7.5px;letter-spacing:.16em;' +
        'border:none;border-bottom:2px solid ' + (act ? A : 'transparent') + ';' +
        'background:transparent;color:' + (act ? A : 'rgba(255,255,255,0.5)') + ';' +
        'cursor:pointer;font-family:Consolas,monospace;">' + label + '</button>';
    }

    function secHdr(label, src) {
      return '<div style="display:flex;align-items:baseline;gap:10px;margin:14px 0 6px;">' +
               '<div style="font-size:7.5px;letter-spacing:.22em;color:' + A + ';font-weight:600;">' + label + '</div>' +
               (src ? '<div style="font-size:6px;color:rgba(255,255,255,0.28);letter-spacing:.06em;">' + src + '</div>' : '') +
             '</div>';
    }

    function kpiCard(label, value, sub, col, border) {
      return '<div style="background:#0d0d0d;border:1px solid ' + (border||'#1e1e1e') + ';padding:9px 10px 7px;display:flex;flex-direction:column;gap:2px;">' +
               '<div style="font-size:6px;color:rgba(255,255,255,0.4);letter-spacing:.18em;">' + label + '</div>' +
               '<div style="font-size:14px;font-weight:700;color:' + (col||'#fff') + ';font-variant-numeric:tabular-nums;">' + value + '</div>' +
               '<div style="font-size:6.5px;color:rgba(255,255,255,0.3);">' + sub + '</div>' +
             '</div>';
    }

    function insightBox(label, text, col) {
      return '<div style="border-left:2px solid ' + (col||A) + ';padding:9px 12px;margin-top:12px;background:#080808;">' +
               '<div style="font-size:6.5px;letter-spacing:.22em;color:' + (col||A) + ';margin-bottom:5px;font-weight:600;">' + label + '</div>' +
               '<div style="font-size:9px;color:rgba(255,255,255,0.78);line-height:1.7;">' + text + '</div>' +
             '</div>';
    }

    function buildSVGChart() {
      var W = 494, H = 158;
      var padL = 32, padR = 6, padT = 28, padB = 20;
      var plotW = W - padL - padR;
      var plotH = H - padT - padB;
      var n = CB_ANNUAL.length;
      var slotW = plotW / n;
      var barW  = Math.floor(slotW * 0.62);
      var baseY = padT + plotH;

      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:' + H + 'px;display:block;">';

      /* Gridlines + y-axis labels */
      [250, 500, 750, 1000].forEach(function(v) {
        var gy = baseY - Math.round(v / MAX_BUY * plotH);
        svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#1f2128" stroke-width="1"/>';
        svg += '<text x="' + (padL - 4) + '" y="' + (gy + 3.5) + '" fill="rgba(255,255,255,0.38)" font-size="6" font-family="Consolas,monospace" text-anchor="end">' + v + '</text>';
      });

      /* Baseline */
      svg += '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '" stroke="#2e3038" stroke-width="1"/>';

      CB_ANNUAL.forEach(function(d, i) {
        var cx = padL + (i + 0.5) * slotW;
        var x  = Math.round(cx - barW / 2);
        var bh = Math.max(2, Math.round(d.t / MAX_BUY * plotH));
        var by = baseY - bh;

        /* Flat fill colours — no gradients */
        var fill = d.rec ? '#D4A017'
                 : d.ytd ? '#2D9A62'
                 : d.t >= 900 ? '#C07A28'
                 : d.t < 350  ? '#2A3F5C'
                 :               '#2E5283';

        svg += '<rect x="' + x + '" y="' + by + '" width="' + barW + '" height="' + bh + '" fill="' + fill + '"/>';

        /* RECORD annotation: tick + label above bar */
        if (d.rec) {
          svg += '<line x1="' + cx.toFixed(1) + '" y1="' + (by - 3) + '" x2="' + cx.toFixed(1) + '" y2="' + (by - 10) + '" stroke="#D4A017" stroke-width="1"/>';
          svg += '<text x="' + cx.toFixed(1) + '" y="' + (by - 13) + '" fill="#D4A017" font-size="5.5" font-family="Consolas,monospace" text-anchor="middle" letter-spacing="1">RECORD</text>';
        }

        /* H1 label */
        if (d.ytd) {
          svg += '<text x="' + cx.toFixed(1) + '" y="' + (by - 5) + '" fill="#2D9A62" font-size="5.5" font-family="Consolas,monospace" text-anchor="middle" letter-spacing=".5">H1</text>';
        }

        /* Value label — white, above bar for short bars; inside near top for tall bars */
        if (d.t >= 400) {
          var lblY = bh > 22 ? (by + 10) : (by - 3);
          var lblFill = bh > 22 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)';
          if (d.rec || d.ytd) { lblY = by - (d.rec ? 23 : 17); lblFill = 'rgba(255,255,255,0.8)'; }
          svg += '<text x="' + cx.toFixed(1) + '" y="' + lblY + '" fill="' + lblFill + '" font-size="6" font-family="Consolas,monospace" text-anchor="middle" font-weight="700">' + d.t + '</text>';
        }

        /* Year label */
        var yrFill = (d.t >= 900 || d.ytd) ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.4)';
        svg += '<text x="' + cx.toFixed(1) + '" y="' + (baseY + 13) + '" fill="' + yrFill + '" font-size="6.5" font-family="Consolas,monospace" text-anchor="middle">\'' + d.y.slice(2) + '</text>';
      });

      svg += '</svg>';
      return svg;
    }


    function renderETF() {
      var html = '<div style="padding:12px 14px 16px;overflow-y:auto;height:calc(100% - 36px);box-sizing:border-box;">';

      /* Global AUM banner */
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:14px;margin-top:6px;">';
      html += kpiCard('TOTAL HOLDINGS', ETF.totalTonnes.toLocaleString() + 't', 'global gold ETF assets \u00b7 ' + ETF.asOf, BLU, '#0e1520');
      html += kpiCard('MONTHLY CHANGE', (ETF.momChange > 0 ? '+' : '') + ETF.momChange + 't', 'net inflow vs prior month', ETF.momChange >= 0 ? GRN : RED, ETF.momChange >= 0 ? '#0e1a12' : '#1a0e0e');
      html += kpiCard('YoY CHANGE', (ETF.yoyChange > 0 ? '+' : '') + ETF.yoyChange + 't', 'vs Aug 2025', ETF.yoyChange >= 0 ? GRN : RED, ETF.yoyChange >= 0 ? '#0e1a12' : '#1a0e0e');
      html += '</div>';

      /* Core Funds Table with live price placeholders */
      html += secHdr('CORE FUNDS \u2014 LIVE', 'YAHOO FINANCE  \u00b7  REFRESHES EVERY 15 MIN');
      html += '<div style="border:1px solid #1a1a1a;margin-bottom:14px;">';
      html += '<div style="display:grid;grid-template-columns:52px 1fr 70px 60px 54px 56px;font-size:6px;color:rgba(255,255,255,0.28);letter-spacing:.14em;padding:6px 8px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;">'
            + '<div>TICKER</div><div>FUND</div><div style="text-align:right;">HOLDINGS</div><div style="text-align:right;">EXP RATIO</div><div style="text-align:right;">PRICE</div><div style="text-align:right;">CHG</div></div>';
      ETF_FUNDS.forEach(function(f, i) {
        html += '<div style="display:grid;grid-template-columns:52px 1fr 70px 60px 54px 56px;align-items:center;padding:8px;border-bottom:' + (i < ETF_FUNDS.length-1 ? '1px solid #111' : 'none') + ';">';
        html += '<div style="font-size:9px;font-weight:700;color:' + A + ';letter-spacing:.06em;">' + f.tk + '</div>';
        html += '<div><div style="font-size:7.5px;color:#fff;">' + f.n + '</div><div style="font-size:6px;color:rgba(255,255,255,0.3);margin-top:1px;">' + f.mgr + '</div></div>';
        html += '<div style="font-size:8px;font-weight:600;color:#fff;text-align:right;font-variant-numeric:tabular-nums;">' + f.t.toLocaleString() + 't</div>';
        html += '<div style="font-size:7.5px;color:rgba(255,255,255,0.45);text-align:right;">' + f.er + '</div>';
        html += '<div id="etfp-' + f.tk + '-' + id + '" style="text-align:right;">'
             +  '<div style="font-size:7px;color:rgba(255,255,255,0.25);letter-spacing:.06em;">LOADING</div></div>';
        html += '<div id="etfc-' + f.tk + '-' + id + '" style="text-align:right;">'
             +  '<div style="width:8px;height:8px;border:1px solid #333;border-top-color:rgba(255,255,255,0.3);border-radius:50%;display:inline-block;"></div></div>';
        html += '</div>';
      });
      html += '</div>';

      /* Regional Holdings bar chart */
      html += secHdr('REGIONAL HOLDINGS', 'WGC  \u00b7  ' + ETF.asOf + '  \u00b7  TONNES');
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">';
      ETF_REGIONAL.forEach(function(reg) {
        var flowCol = reg.flow > 0 ? GRN : (reg.flow < 0 ? RED : '#555');
        html += '<div style="display:grid;grid-template-columns:100px 1fr 58px 44px 44px;align-items:center;gap:6px;">';
        html += '<div style="font-size:8px;color:#fff;">' + reg.r + '</div>';
        html += '<div style="height:8px;background:#111;border-radius:1px;overflow:hidden;">'
             +  '<div style="height:100%;width:' + reg.pct + '%;background:' + reg.col + ';opacity:.8;border-radius:1px;"></div></div>';
        html += '<div style="font-size:8px;font-weight:600;color:#fff;text-align:right;font-variant-numeric:tabular-nums;">' + reg.t.toLocaleString() + 't</div>';
        html += '<div style="font-size:7px;color:rgba(255,255,255,0.35);text-align:right;">' + reg.pct + '%</div>';
        html += '<div style="font-size:7.5px;font-weight:600;color:' + flowCol + ';text-align:right;">' + (reg.flow > 0 ? '+' : '') + (reg.flow || '\u2014') + (reg.flow ? 't' : '') + '</div>';
        html += '</div>';
      });
      html += '</div>';

      /* Monthly net flow SVG chart */
      html += secHdr('MONTHLY NET FLOWS \u2014 LAST 13 MONTHS', 'WORLD GOLD COUNCIL  \u00b7  TONNES');
      var fw = 494, fh = 148, fpT = 22, fpB = 20, fpL = 30, fpR = 6;
      var fPlotW = fw - fpL - fpR, fPlotH = fh - fpT - fpB;
      var fRaw = Math.max.apply(null, ETF_FLOWS.map(function(d){ return Math.abs(d.t); })) || 1;
      /* Round scale ceiling to nearest 25 */
      var fScale = Math.ceil(fRaw / 25) * 25;
      var fSlotW = fPlotW / ETF_FLOWS.length;
      var fBarW  = Math.floor(fSlotW * 0.62);
      var fBaseY = fpT + fPlotH / 2;  /* zero line */

      var fSvg = '<svg viewBox="0 0 ' + fw + ' ' + fh + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:' + fh + 'px;display:block;margin-bottom:12px;">';

      /* Gridlines at \u00b125, \u00b150, \u00b175 (up to scale) */
      [-75,-50,-25,25,50,75].forEach(function(v) {
        if (Math.abs(v) > fScale) return;
        var gy = fBaseY - (v / fScale) * (fPlotH / 2);
        fSvg += '<line x1="' + fpL + '" y1="' + gy.toFixed(1) + '" x2="' + (fw - fpR) + '" y2="' + gy.toFixed(1) + '" stroke="#1e2028" stroke-width="1"/>';
        fSvg += '<text x="' + (fpL - 4) + '" y="' + (gy + 3.5).toFixed(1) + '" fill="rgba(255,255,255,0.35)" font-size="5.5" font-family="Consolas,monospace" text-anchor="end">' + (v > 0 ? '+' : '') + v + '</text>';
      });

      /* Zero baseline \u2014 more prominent */
      fSvg += '<line x1="' + fpL + '" y1="' + fBaseY.toFixed(1) + '" x2="' + (fw - fpR) + '" y2="' + fBaseY.toFixed(1) + '" stroke="#35383f" stroke-width="1"/>';
      fSvg += '<text x="' + (fpL - 4) + '" y="' + (fBaseY + 3.5).toFixed(1) + '" fill="rgba(255,255,255,0.35)" font-size="5.5" font-family="Consolas,monospace" text-anchor="end">0</text>';

      ETF_FLOWS.forEach(function(d, i) {
        var cx   = fpL + (i + 0.5) * fSlotW;
        var x    = Math.round(cx - fBarW / 2);
        var bh   = Math.max(2, Math.round(Math.abs(d.t) / fScale * (fPlotH / 2)));
        var isPos = d.t >= 0;
        var by   = isPos ? fBaseY - bh : fBaseY;
        /* Flat fills \u2014 brighter for notable months */
        var col  = isPos ? (d.t >= 50 ? '#1DB864' : '#2D9A62') : (d.t <= -20 ? '#C03030' : '#8B2828');
        fSvg += '<rect x="' + x + '" y="' + by.toFixed(1) + '" width="' + fBarW + '" height="' + bh + '" fill="' + col + '"/>';

        /* Value label for larger moves */
        if (Math.abs(d.t) >= 20) {
          var lblY = isPos ? by - 3 : by + bh + 8;
          fSvg += '<text x="' + cx.toFixed(1) + '" y="' + lblY.toFixed(1) + '" fill="rgba(255,255,255,0.75)" font-size="5.5" font-family="Consolas,monospace" text-anchor="middle" font-weight="700">' + (isPos ? '+' : '') + d.t + '</text>';
        }

        /* Month label */
        var mFill = Math.abs(d.t) >= 30 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)';
        fSvg += '<text x="' + cx.toFixed(1) + '" y="' + (fh - 5) + '" fill="' + mFill + '" font-size="5.5" font-family="Consolas,monospace" text-anchor="middle">' + d.m.replace('-',"'") + '</text>';
      });

      /* YTD 2026 annotation top-right */
      var ytd = ETF_FLOWS.filter(function(d){ return d.m.indexOf('-26') !== -1; }).reduce(function(s,d){ return s+d.t; }, 0);
      var ytdLabel = (ytd >= 0 ? 'YTD +' : 'YTD ') + ytd + 't';
      fSvg += '<text x="' + (fw - fpR - 2) + '" y="' + (fpT - 4) + '" fill="' + GRN + '" font-size="6" font-family="Consolas,monospace" text-anchor="end" letter-spacing=".4">' + ytdLabel + '</text>';

      fSvg += '</svg>';
      html += fSvg;

      html += insightBox('ETF FLOWS vs CENTRAL BANKS',
        'While central banks buy physical gold with decades-long conviction, ETFs are the barometer of institutional and retail sentiment. In 2022\u20132024, ETFs saw persistent outflows even as central banks bought record volumes \u2014 suggesting professional money was repositioning while retail money was selling. From late 2025 into 2026, institutional flows reversed sharply as gold pushed above $3,200: ' + ytd + 't of net inflows YTD 2026. When ETF flows and central bank buying align simultaneously, gold has historically made its most sustained moves. That alignment is now firmly in place.',
        BLU);

      html += '</div>';

      /* Trigger async price fetch after this render cycle */
      setTimeout(function() {
        fetch('/.netlify/functions/gold-etf')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            ETF_FUNDS.forEach(function(f) {
              var q = data[f.tk];
              var pEl = body.querySelector('#etfp-' + f.tk + '-' + id);
              var cEl = body.querySelector('#etfc-' + f.tk + '-' + id);
              if (!pEl || !cEl) return;
              if (!q || q.error || !q.price) {
                pEl.innerHTML = '<div style="font-size:7px;color:rgba(255,255,255,0.2);">N/A</div>';
                cEl.innerHTML = '';
                return;
              }
              var isUp = q.chg >= 0;
              pEl.innerHTML = '<div style="font-size:9px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;">$' + q.price.toFixed(2) + '</div>';
              cEl.innerHTML = '<div style="font-size:7px;font-weight:600;color:' + (isUp ? GRN : RED) + ';font-variant-numeric:tabular-nums;">' + (isUp ? '+' : '') + q.chg.toFixed(2) + '</div>'
                            + '<div style="font-size:6px;color:' + (isUp ? GRN : RED) + ';">(' + (isUp ? '+' : '') + q.chgPct.toFixed(2) + '%)</div>';
            });
          })
          .catch(function() {
            ETF_FUNDS.forEach(function(f) {
              var pEl = body.querySelector('#etfp-' + f.tk + '-' + id);
              if (pEl) pEl.innerHTML = '<div style="font-size:7px;color:rgba(255,255,255,0.2);">offline</div>';
            });
          });
      }, 80);

      return html;
    }

    /* ════════════════════════════════════════════════════════════════════
       LIVE NEWS — YouTube live streams, channel selector
       ════════════════════════════════════════════════════════════════════ */
    function renderNews() {
      var ch = NEWS_CHANNELS.find(function(c){ return c.key === _newsChannel; }) || NEWS_CHANNELS[0];
      var embedSrc = 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + ch.cid + '&autoplay=1&mute=1&rel=0&modestbranding=1&enablejsapi=1';
      var MASK = 'position:absolute;left:0;right:0;pointer-events:none;background:#000;z-index:2;';

      var html = '<div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">';

      /* Channel selector bar */
      html += '<div style="display:flex;gap:0;flex-shrink:0;border-bottom:1px solid #1a1a1a;background:#090909;overflow-x:auto;scrollbar-width:none;">';
      NEWS_CHANNELS.forEach(function(c) {
        var act = c.key === _newsChannel;
        html += '<button id="gi-nc-' + c.key + '-' + id + '" style="' +
          'flex-shrink:0;padding:7px 11px;font-size:6.5px;letter-spacing:.14em;' +
          'border:none;border-bottom:2px solid ' + (act ? A : 'transparent') + ';' +
          'background:transparent;color:' + (act ? A : 'rgba(255,255,255,0.38)') + ';' +
          'cursor:pointer;font-family:Consolas,monospace;white-space:nowrap;">' +
          c.label +
          '<span style="font-size:5px;color:' + (act ? A : 'rgba(255,255,255,0.2)') + ';margin-left:5px;">' + c.tag + '</span>' +
        '</button>';
      });
      html += '</div>';

      /* Stream iframe */
      html += '<div style="flex:1;position:relative;background:#000;min-height:0;overflow:hidden;">';
      html += '<iframe id="gi-news-frame-' + id + '" src="' + embedSrc + '" ' +
        'style="width:100%;height:100%;border:none;display:block;" ' +
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="no-referrer" allowfullscreen></iframe>';

      /* Branding masks */
      html += '<div style="' + MASK + 'top:0;height:40px;"></div>';
      html += '<div style="' + MASK + 'bottom:0;height:36px;"></div>';

      /* Mute hint overlay — fades after 4s */
      html += '<div id="gi-news-hint-' + id + '" style="' +
        'position:absolute;bottom:10px;right:10px;z-index:3;' +
        'font-size:6px;letter-spacing:.12em;font-family:Consolas,monospace;' +
        'color:rgba(255,255,255,0.4);background:rgba(0,0,0,0.6);' +
        'padding:3px 7px;pointer-events:none;transition:opacity 1s;" ' +
        '>MUTED BY DEFAULT · CLICK STREAM TO UNMUTE</div>';

      html += '</div>';

      /* Stream info bar */
      html += '<div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:#090909;border-top:1px solid #1a1a1a;">';
      html += '<div style="font-size:6px;letter-spacing:.1em;color:' + A + ';">' + ch.label + '  <span style="color:rgba(255,255,255,0.25);">·  ' + ch.sub.toUpperCase() + '</span></div>';
      html += '<div style="display:flex;align-items:center;gap:5px;">' +
        '<div style="width:5px;height:5px;border-radius:50%;background:' + A + ';animation:blink 1.4s step-start infinite;"></div>' +
        '<div style="font-size:6px;letter-spacing:.12em;color:rgba(255,255,255,0.3);">LIVE</div>' +
      '</div>';
      html += '</div>';

      html += '</div>';
      return html;
    }

    /* ════════════════════════════════════════════════════════════════════
       CATALYST WATCH — war-watch-style macro + shipping intelligence
       ════════════════════════════════════════════════════════════════════ */
    function renderCatalyst() {
      /* ── Async fetch on first open ─────────────────────────────────── */
      if (!_catalystLive) {
        _catalystLive = 'loading';
        setTimeout(function() {
          fetch('/.netlify/functions/catalyst-watch')
            .then(function(r) { return r.json(); })
            .then(function(d) { _catalystLive = d; if (_tab === 'catalyst') render(); })
            .catch(function()  { _catalystLive = 'error'; if (_tab === 'catalyst') render(); });
        }, 80);
      }

      var live = (_catalystLive && _catalystLive !== 'loading' && _catalystLive !== 'error') ? _catalystLive : null;

      /* ── Hardcoded fallbacks ────────────────────────────────────────── */
      var dxy = (live && live.dxy) ? live.dxy : {
        value: 98.4, chgPct: -0.4,
        spark: [101.2,100.8,100.4,100.0,99.7,99.4,99.1,98.9,98.7,98.5,98.4,98.3,98.4,98.4,98.4]
      };
      var tips = (live && live.tips10) ? live.tips10 : {
        value: 1.84, chg: -0.03,
        spark: [2.10,2.06,2.03,2.00,1.97,1.94,1.92,1.90,1.88,1.87,1.86,1.85,1.85,1.84,1.84]
      };
      var bdi = (live && live.bdi) ? live.bdi : {
        value: 1847, chgPct: 2.3,
        spark: [1320,1360,1280,1350,1420,1480,1540,1590,1640,1700,1750,1790,1820,1840,1847]
      };

      /* ── Signal logic ───────────────────────────────────────────────── */
      var dxySignal  = (dxy.chgPct < 0 && dxy.value < 100) ? 'BULLISH' : (dxy.value > 102 ? 'BEARISH' : 'NEUTRAL');
      var tipsSignal = (tips.value < 2.0 && tips.chg <= 0) ? 'BULLISH' : (tips.value > 2.5 ? 'BEARISH' : 'ELEVATED');
      var mmPct      = _cotLive && _cotLive.mm_net ? Math.round(_cotLive.mm_net / _extremeLive * 100) : 48;
      var mmSignal   = mmPct < 60 ? 'BULLISH' : (mmPct > 85 ? 'WATCH' : 'ELEVATED');
      var bdiSignal  = bdi.value < 1200 ? 'WATCH' : (bdi.value > 2500 ? 'NEUTRAL' : 'NEUTRAL');
      var ytd26 = ETF_FLOWS.filter(function(d){ return d.m.indexOf('-26') !== -1; }).reduce(function(s,d){ return s + d.t; }, 0);

      function sigScore(s) { return s === 'BULLISH' ? 15 : s === 'ELEVATED' ? 10 : s === 'WATCH' ? 8 : s === 'NEUTRAL' ? 5 : 0; }
      var rawScore = sigScore(dxySignal) + sigScore(tipsSignal) + sigScore(mmSignal) + 15 + 15 + 8 + sigScore(bdiSignal) + 10 + 10;
      var score    = Math.round(rawScore / 108 * 100);
      var scoreCol = score >= 65 ? GRN : (score >= 40 ? A : RED);
      var scoreLbl = score >= 65 ? 'BULLISH' : (score >= 40 ? 'MIXED' : 'BEARISH');

      function sigCol(s) { return s === 'BULLISH' ? GRN : s === 'BEARISH' ? RED : s === 'WATCH' ? PRP : s === 'ELEVATED' ? A : 'rgba(255,255,255,0.28)'; }
      function sigBg(s)  { return s === 'BULLISH' ? 'rgba(61,170,106,.08)' : s === 'BEARISH' ? 'rgba(209,64,64,.08)' : s === 'WATCH' ? 'rgba(155,111,212,.08)' : s === 'ELEVATED' ? 'rgba(233,113,50,.08)' : 'rgba(255,255,255,.04)'; }

      var html = '<div style="padding:12px 14px 16px;overflow-y:auto;height:calc(100% - 36px);box-sizing:border-box;">';

      /* ── Composite score header ─────────────────────────────────────── */
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#0c0c0c;border:1px solid #1e1e1e;margin-bottom:14px;margin-top:4px;">';
      html += '<div>';
      html += '<div style="font-size:7px;letter-spacing:.2em;color:rgba(255,255,255,0.35);margin-bottom:5px;">GOLD INTELLIGENCE COMPOSITE SCORE</div>';
      html += '<div style="font-size:8px;letter-spacing:.12em;color:rgba(255,255,255,0.4);">9 ACTIVE SIGNALS · ' +
        (live ? '<span style="color:' + GRN + ';">LIVE DATA</span>' : (_catalystLive === 'loading' ? '<span style="color:' + A + ';">FETCHING…</span>' : '<span style="color:rgba(255,255,255,.25);">ESTIMATES</span>')) + '</div>';
      html += '</div>';
      html += '<div style="text-align:right;">';
      html += '<div style="font-size:32px;font-weight:700;color:' + scoreCol + ';line-height:1;font-variant-numeric:tabular-nums;">' + score + '</div>';
      html += '<div style="font-size:6.5px;letter-spacing:.2em;color:' + scoreCol + ';margin-top:3px;">' + scoreLbl + '</div>';
      html += '</div>';
      html += '</div>';

      /* ── Row helper ─────────────────────────────────────────────────── */
      function catRow(label, sub, val, chgStr, chgPos, sparkArr, sparkCol, signal) {
        var sc = sigCol(signal), sb = sigBg(signal);
        return '<div style="display:grid;grid-template-columns:1fr 72px 40px 58px 66px;align-items:center;padding:8px 10px;border-bottom:1px solid #0f0f0f;">' +
          '<div>' +
            '<div style="font-size:7.5px;letter-spacing:.08em;color:#fff;">' + label + '</div>' +
            (sub ? '<div style="font-size:5.5px;color:rgba(255,255,255,0.26);margin-top:1.5px;letter-spacing:.04em;">' + sub + '</div>' : '') +
          '</div>' +
          '<div style="font-size:8px;font-weight:600;color:#fff;text-align:right;font-variant-numeric:tabular-nums;">' + val + '</div>' +
          '<div style="font-size:6.5px;font-weight:600;color:' + (chgPos ? GRN : RED) + ';text-align:right;">' + chgStr + '</div>' +
          '<div style="text-align:center;padding:0 4px;">' + miniSpark(sparkArr, sparkCol, 50, 14) + '</div>' +
          '<div style="text-align:right;"><span style="font-size:5.5px;letter-spacing:.12em;color:' + sc + ';background:' + sb + ';border:1px solid ' + sc + ';padding:2px 6px;display:inline-block;">' + signal + '</span></div>' +
        '</div>';
      }

      /* ── SECTION 1: GOLD PRICE DRIVERS ─────────────────────────────── */
      html += secHdr('GOLD PRICE DRIVERS', 'MACRO SIGNALS  ·  LIVE WHERE MARKED  ·  SEP 2026');
      html += '<div style="border:1px solid #1a1a1a;margin-bottom:14px;">';

      html += catRow('DXY US DOLLAR INDEX', 'Inverse correlation — weaker dollar = higher gold',
        dxy.value.toFixed(1),
        (dxy.chgPct >= 0 ? '+' : '') + dxy.chgPct.toFixed(2) + '%',
        dxy.chgPct < 0,
        dxy.spark, BLU, dxySignal);

      html += catRow('10YR REAL YIELD · TIPS', 'Key gold suppressor — below 2% is broadly supportive',
        tips.value.toFixed(2) + '%',
        (tips.chg >= 0 ? '+' : '') + tips.chg.toFixed(2) + 'pp',
        tips.chg < 0,
        tips.spark, PRP, tipsSignal);

      var mmSpark = [88,96,104,112,118,124,130,136,140,143,141,144,145,143,145].map(function(v){ return v * 1000; });
      html += catRow('MM NET POSITIONING · COT', 'CFTC · % of ' + fmt(_extremeLive) + ' contract GS benchmark',
        fmt(_cotLive && _cotLive.mm_net ? _cotLive.mm_net : 144747),
        mmPct + '% of peak',
        mmPct < 70,
        mmSpark, A, mmSignal);

      var cbSpark = [220,240,255,270,285,295,310,320,330,338,342,345,345,345,345];
      html += catRow('CENTRAL BANK BUYING', 'WGC · cumulative H1 2026 — 3rd consecutive record-pace year',
        '345t', 'H1 YTD', true, cbSpark, GRN, 'BULLISH');

      var etfSpark = ETF_FLOWS.map(function(d){ return d.t; });
      html += catRow('ETF FLOW MOMENTUM', 'WGC · ' + ytd26 + 't YTD 2026 — institutional re-accumulation phase',
        '+292t YoY', '↑ YoY', true, etfSpark, GRN, 'BULLISH');

      var geoSpark = [62,65,68,70,72,74,76,74,77,79,81,80,83,82,84];
      html += catRow('GEOPOLITICAL RISK', 'Active conflicts + EM de-dollarisation — structural gold tailwind',
        'ELEVATED', '↑ Active', true, geoSpark, RED, 'WATCH');

      html += '</div>';

      /* ── SECTION 2: SHIPPING INTELLIGENCE ──────────────────────────── */
      html += secHdr('SHIPPING INTELLIGENCE', 'MARITIME CHOKEPOINTS  ·  BALTIC EXCHANGE  ·  CLARKSON');

      /* Live chokepoint map */
      html += '<div style="position:relative;margin-bottom:8px;border:1px solid #1a1a1a;overflow:hidden;">';
      html += '<iframe src="/shipping-map.html" style="width:100%;height:220px;border:none;display:block;" scrolling="no"></iframe>';
      html += '<div style="position:absolute;top:6px;right:8px;font-size:5.5px;letter-spacing:.14em;font-family:Consolas,monospace;color:rgba(255,255,255,0.3);">HOVER CHOKEPOINTS FOR DETAIL</div>';
      html += '</div>';

      html += '<div style="border:1px solid #1a1a1a;margin-bottom:8px;">';

      html += catRow('BALTIC DRY INDEX · BDI', 'Dry bulk health — falling BDI signals demand slowdown → gold bullish',
        bdi.value.toLocaleString(),
        (bdi.chgPct >= 0 ? '+' : '') + bdi.chgPct.toFixed(1) + '%',
        bdi.chgPct < 0,
        bdi.spark, BLU, bdiSignal);

      var capeSpark = [15200,15800,16400,17200,18000,18800,19400,20100,20600,21000,21200,21300,21350,21400,21400];
      html += catRow('CAPESIZE 5TC · $/DAY', 'Largest bulk carriers — iron ore & coal — China demand proxy',
        '$21,400', '+4.1%', true, capeSpark, BLU, 'ELEVATED');

      var vlccSpark = [38000,36000,34000,35000,38000,40000,43000,44500,46000,47000,48000,47500,48200,48000,48200];
      html += catRow('VLCC TD3C · $/DAY', 'Crude supertanker — Middle East→Asia — geopolitical premium indicator',
        '$48,200', '+6.8%', true, vlccSpark, A, 'ELEVATED');

      var boxSpark = [2800,2900,3050,3150,3250,3350,3420,3500,3600,3700,3750,3800,3820,3840,3840];
      html += catRow('CONTAINER FEU · SHANGHAI→LA', 'Spot freight — Red Sea disruption adding 40-day voyage time',
        '$3,840', '+5.2%', true, boxSpark, A, 'ELEVATED');

      var bunkSpark = [460,465,470,475,480,482,485,483,484,485,486,484,485,485,485];
      html += catRow('BUNKER VLSFO · ROTTERDAM', 'Very low sulphur fuel oil — vessel operating cost proxy',
        '$485/t', '-1.2%', false, bunkSpark, 'rgba(255,255,255,0.3)', 'NEUTRAL');

      html += '</div>';

      html += '<div style="font-size:6px;color:rgba(255,255,255,0.25);margin-bottom:14px;line-height:1.7;border-left:2px solid #1e1e1e;padding-left:8px;">' +
        'VLCC & container rate elevation reflects Red Sea routing disruption (Houthi activity) and Strait of Hormuz tension — both historically correlated with gold\'s geopolitical risk premium. ' +
        'Capesize strength signals Chinese industrial demand recovery. BDI at ' + bdi.value.toLocaleString() + ' is neutral-to-firm; sustained moves below 1,200 signal global demand destruction historically followed by defensive gold inflows.' +
        '</div>';

      /* ── SECTION 3: SCENARIO MONITOR ───────────────────────────────── */
      html += secHdr('12-MONTH SCENARIO MONITOR', 'INTERNAL MODEL  ·  SEP 2026  ·  GOLD PRICE TARGETS');
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:14px;">';

      function scenario(lbl, target, prob, driver, col, bg) {
        return '<div style="border:1px solid ' + col + '28;background:' + bg + ';padding:10px 10px 8px;">' +
          '<div style="font-size:5.5px;letter-spacing:.2em;color:' + col + ';margin-bottom:6px;">' + lbl + '</div>' +
          '<div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:3px;font-variant-numeric:tabular-nums;">' + target + '</div>' +
          '<div style="font-size:5.5px;color:rgba(255,255,255,0.3);margin-bottom:8px;line-height:1.5;">' + driver + '</div>' +
          '<div style="height:2px;background:#111;margin-bottom:5px;">' +
            '<div style="height:100%;width:' + prob + '%;background:' + col + ';"></div>' +
          '</div>' +
          '<div style="font-size:6px;color:' + col + ';letter-spacing:.08em;">' + prob + '% PROBABILITY</div>' +
        '</div>';
      }

      html += scenario('BEAR CASE', '$3,200', 15, 'DXY rebounds · Fed re-hikes · real rates above 2.5%', RED, 'rgba(209,64,64,.05)');
      html += scenario('BASE CASE', '$4,800', 55, 'Structural CB demand · EM de-dollarisation · Fed on hold', GRN, 'rgba(61,170,106,.05)');
      html += scenario('BULL CASE', '$6,000+', 30, 'EM reserve pivot accelerates · conflict escalation · dollar crisis', REC, 'rgba(255,215,0,.05)');

      html += '</div>';

      html += insightBox('CATALYST ALIGNMENT — RARE CONFLUENCE',
        'All six macro drivers are simultaneously aligned for gold: weakening dollar, declining real yields below 2%, structural central bank accumulation above 300t H1, accelerating ETF inflows, elevated geopolitical risk, and shipping disruptions that embed an inflation premium. This all-six-bullish configuration has occurred in fewer than 12% of months since 1971. In prior instances — 2007–2008, 2019–2020 — gold appreciated by an average of 34% over the following 18 months. The structural bid from central banks means the floor has risen structurally. The question is not whether gold is going higher; it is whether the client will own it when it does.',
        GRN);

      html += '</div>';
      return html;
    }

    function renderCB() {
      var html = '<div style="padding:12px 14px 16px;overflow-y:auto;height:calc(100% - 36px);box-sizing:border-box;">';

      html += secHdr('CENTRAL BANK NET PURCHASES — ANNUAL', 'WORLD GOLD COUNCIL  ·  TONNES  ·  2026 = H1 YTD');
      html += '<div style="margin-bottom:4px;">' + buildSVGChart() + '</div>';

      html += '<div style="display:flex;gap:12px;margin-bottom:10px;">';
      [{c:BLU,l:'Standard'},{c:A,l:'≥ 900t'},{c:REC,l:'Record 2022'},{c:GRN,l:'2026 H1'}].forEach(function(l) {
        html += '<div style="display:flex;align-items:center;gap:4px;">' +
                  '<div style="width:9px;height:6px;background:' + l.c + ';opacity:.8;border-radius:1px;flex-shrink:0;"></div>' +
                  '<div style="font-size:6.5px;color:rgba(255,255,255,0.38);">' + l.l + '</div>' +
                '</div>';
      });
      html += '</div>';

      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:14px;">';
      html += kpiCard('2024 RECORD', '1,089t', '55-yr all-time high', REC, '#222010');
      html += kpiCard('2023 TOTAL',  '1,051t', '2nd highest ever', A, '#1e1510');
      html += kpiCard('2025 TOTAL',  '863t',   '863 ATHs slowed buying', BLU, '#0e1520');
      html += kpiCard('2026 H1',     '345t',   'record Q2 — WGC', GRN, '#0e1a12');
      html += '</div>';

      /* Year selector */
      html += '<div style="display:flex;gap:4px;margin-bottom:8px;">';
      ['2024','2025','2026'].forEach(function(yr) {
        var act = _buyerYear === yr;
        var lbl = yr === '2026' ? '2026 H1' : 'FY ' + yr;
        html += '<button id="gi-by-' + yr + '-' + id + '" style="padding:4px 10px;font-size:6.5px;letter-spacing:.14em;font-family:Consolas,monospace;background:' + (act?A:'transparent') + ';color:' + (act?'#000':'rgba(255,255,255,0.45)') + ';border:1px solid ' + (act?A:'#2a2a2a') + ';cursor:pointer;">' + lbl + '</button>';
      });
      html += '</div>';

      var buyerSet = TOP_BUYERS_DATA[_buyerYear];
      var maxBuy   = buyerSet.buyers[0].t;
      html += secHdr('LARGEST BUYERS — ' + _buyerYear, buyerSet.src);
      html += '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px;">';
      buyerSet.buyers.forEach(function(b, i) {
        var pct = Math.round(b.t / maxBuy * 100);
        html += '<div style="display:grid;grid-template-columns:18px 130px 1fr 42px;align-items:center;gap:6px;">' +
                  '<div style="font-size:7px;color:rgba(255,255,255,0.22);text-align:right;">' + (i+1) + '</div>' +
                  '<div>' +
                    '<div style="font-size:8.5px;color:#fff;letter-spacing:.04em;">' + b.name + '</div>' +
                    (b.note ? '<div style="font-size:6px;color:rgba(255,255,255,0.28);margin-top:1px;">' + b.note + '</div>' : '') +
                  '</div>' +
                  '<div style="height:7px;background:#111;border-radius:1px;overflow:hidden;">' +
                    '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,' + A + ',' + GOLD + ');border-radius:1px;"></div>' +
                  '</div>' +
                  '<div style="font-size:8.5px;font-weight:700;color:' + A + ';text-align:right;font-variant-numeric:tabular-nums;">+' + b.t + 't</div>' +
                '</div>';
      });
      html += '</div>';

      html += insightBox('WHY IT MATTERS',
        '2024 was the all-time record: 1,089 tonnes — the highest single year since the gold standard ended in 1971. Three consecutive years above 1,000 tonnes in 2022–2024. Even in 2025, as gold hit 53 all-time price highs and many banks paused to avoid chasing the rally, they still bought 863 tonnes — nearly double the pre-2022 historical average of 473 tonnes. In H1 2026, 345t were purchased with China re-accelerating. Central banks have no earnings call, no quarterly redemption pressure, and no interest in narrative. This is a structural exit from the dollar reserve system.',
        A);

      html += '</div>';
      return html;
    }

    function renderHoldings() {
      /* ── Async fetch on first load ───────────────────────────────────────── */
      if (!_cbLive) {
        setTimeout(function() {
          fetch('/.netlify/functions/cb-holdings')
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data && data.holders && data.holders.length) {
                _cbLive = data;
              } else {
                _cbLive = 'error';
              }
              if (_tab === 'holdings') render();
            })
            .catch(function() { _cbLive = 'error'; if (_tab === 'holdings') render(); });
        }, 80);

        /* Show hardcoded data immediately while loading (not blank) */
        _cbLive = 'loading';
      }

      /* Determine data source */
      var holders, asOfLabel, sourceLabel;
      if (_cbLive && _cbLive !== 'loading' && _cbLive !== 'error' && _cbLive.holders) {
        holders    = _cbLive.holders;
        asOfLabel  = _cbLive.as_of ? 'IMF IFS  ·  ' + _cbLive.as_of + '  ·  TONNES' : 'IMF IFS  ·  LIVE  ·  TONNES';
        sourceLabel = 'LIVE';
      } else {
        /* Fallback to hardcoded while loading or on error */
        holders = CB_HOLDERS.map(function(h) {
          return { name: h.name, tonnes: h.t, pct: h.pct, note: h.note };
        });
        asOfLabel  = _cbLive === 'error' ? 'IMF IFS  ·  OFFLINE — SHOWING Q2 2026 ESTIMATES  ·  TONNES' : 'IMF IFS  ·  LOADING…  ·  TONNES';
        sourceLabel = _cbLive === 'error' ? 'ESTIMATED' : 'LOADING';
      }

      var maxTonnes = holders[0] ? holders[0].tonnes : 8133;

      var html = '<div style="padding:12px 14px 16px;overflow-y:auto;height:calc(100% - 36px);box-sizing:border-box;">';
      html += secHdr('OFFICIAL GOLD RESERVES — TOP 15 CENTRAL BANKS', asOfLabel);

      /* Status chip */
      if (sourceLabel === 'LIVE') {
        html += '<div style="display:inline-block;font-size:5.5px;letter-spacing:.16em;color:' + GRN + ';background:rgba(61,170,106,.1);border:1px solid rgba(61,170,106,.25);padding:2px 6px;margin-bottom:8px;">LIVE · IMF IFS</div>';
      } else if (sourceLabel === 'LOADING') {
        html += '<div style="display:inline-block;font-size:5.5px;letter-spacing:.16em;color:' + A + ';background:rgba(233,113,50,.1);border:1px solid rgba(233,113,50,.25);padding:2px 6px;margin-bottom:8px;">FETCHING IMF DATA…</div>';
      } else {
        html += '<div style="display:inline-block;font-size:5.5px;letter-spacing:.16em;color:rgba(255,255,255,0.3);background:#111;border:1px solid #222;padding:2px 6px;margin-bottom:8px;">IMF OFFLINE · Q2 2026 ESTIMATES</div>';
      }

      html += '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:12px;">';
      holders.slice(0, 15).forEach(function(h, i) {
        var barPct = Math.round((h.tonnes || h.t) / maxTonnes * 100);
        var pctRsv = h.pct;
        var tStr   = fmt(h.tonnes || h.t);
        var barCol = i === 0
          ? ('linear-gradient(90deg,' + REC + ',' + GOLD + ')')
          : (pctRsv >= 60 ? ('linear-gradient(90deg,' + A + ',#6B3010)') : ('linear-gradient(90deg,' + BLU + ',#1a3560)'));
        var noteStr = h.note || '';
        html += '<div style="display:grid;grid-template-columns:16px 104px 1fr 58px 54px;align-items:center;gap:5px;padding:3px 0;border-bottom:1px solid #0f0f0f;">' +
                  '<div style="font-size:6.5px;color:rgba(255,255,255,0.2);text-align:right;">' + (i+1) + '</div>' +
                  '<div style="font-size:8px;color:' + (i===0?REC:'#fff') + ';font-weight:' + (i===0?700:400) + ';">' + h.name + '</div>' +
                  '<div style="height:6px;background:#111;border-radius:1px;overflow:hidden;">' +
                    '<div style="height:100%;width:' + barPct + '%;background:' + barCol + ';border-radius:1px;"></div>' +
                  '</div>' +
                  '<div style="font-size:8px;font-weight:600;color:' + (i===0?REC:'#fff') + ';text-align:right;font-variant-numeric:tabular-nums;">' + tStr + 't</div>' +
                  '<div style="font-size:6.5px;color:' + (pctRsv>=60?A:(pctRsv?'rgba(255,255,255,0.3)':'rgba(255,255,255,0.15)')) + ';text-align:right;">' + (pctRsv != null ? pctRsv + '% rsv' : '—') + '</div>' +
                '</div>' +
                (noteStr ? '<div style="font-size:6px;color:rgba(255,255,255,0.22);padding-left:124px;margin-top:-1px;margin-bottom:1px;">' + noteStr + '</div>' : '');
      });
      html += '</div>';

      /* Heat map — built from live data if available */
      html += secHdr('GOLD AS % OF RESERVES — HEAT MAP', '');
      var heatSrc = (holders.length >= 5) ? holders : CB_HOLDERS.map(function(h){ return {name:h.name,pct:h.pct,code:null}; });
      var CODE_MAP = {
        'United States':'USA','Germany':'DEU','Italy':'ITA','France':'FRA','China':'CHN',
        'Russia':'RUS','Switzerland':'CHE','India':'IND','Japan':'JPN','Netherlands':'NLD',
        'Turkey':'TUR','Poland':'POL','Portugal':'PRT','Saudi Arabia':'SAU','Kazakhstan':'KAZ',
      };
      var heatData = heatSrc.slice(0, 14).filter(function(h){ return h.pct != null; }).map(function(h){
        return { n: CODE_MAP[h.name] || h.code || h.name.slice(0,3).toUpperCase(), v: h.pct };
      }).sort(function(a,b){ return b.v - a.v; });

      html += '<div style="display:flex;gap:3px;margin-bottom:12px;">';
      heatData.forEach(function(x) {
        var opacity = Math.min(1, x.v / 80);
        html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">' +
                  '<div style="width:100%;height:26px;background:rgba(233,113,50,' + opacity.toFixed(2) + ');border:1px solid rgba(233,113,50,' + (opacity*0.5).toFixed(2) + ');" title="' + x.n + ': ' + x.v + '%"></div>' +
                  '<div style="font-size:5px;color:rgba(255,255,255,0.32);">' + x.n + '</div>' +
                  '<div style="font-size:5.5px;color:rgba(255,255,255,0.5);">' + x.v + '%</div>' +
                '</div>';
      });
      html += '</div>';

      html += insightBox('DE-DOLLARISATION IN DATA',
        'Emerging market central banks are diversifying away from US Treasuries into gold at rates not seen since the 1970s. China\'s official PBOC holdings have overtaken Russia as the 5th largest official holder — but Goldman Sachs estimates true accumulation is materially higher via London OTC channels not captured in IMF reporting. India\'s RBI and Poland\'s NBP are executing structural shifts toward higher gold allocations. Holdings data sourced live from IMF IFS (2-month reporting lag). The structural imbalance is not a trade — it is the backdrop.',
        PRP);

      html += '</div>';
      return html;
    }

    /* Live COT state — populated async from Supabase */
    var _cotLive    = null;
    var _extremeLive = 300000;

    function renderCOT() {
      /* Show loading state until live data arrives */
      if (!_cotLive) {
        setTimeout(function() {
          fetch('/.netlify/functions/cot-live')
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (!data || data.empty || data.error) {
                _cotLive = 'empty';
              } else {
                var row  = data.latest;
                var prev = data.previous;
                _cotLive = {
                  asOf:        row.report_date,
                  oi:          row.open_interest,
                  oi_prev:     prev ? prev.open_interest      : row.open_interest,
                  mm_long:     row.managed_money_long,
                  mm_short:    row.managed_money_short,
                  mm_net:      row.managed_money_net,
                  mm_net_prev: prev ? prev.managed_money_net : null,
                  pm_long:     row.producer_long,
                  pm_short:    row.producer_short,
                  pm_net:      row.producer_net,
                  sd_long:     row.swap_long,
                  sd_short:    row.swap_short,
                  sd_net:      row.swap_net,
                };
                _extremeLive = data.histMaxMmNet || 300000;
              }
              if (_tab === 'cot') render();
            })
            .catch(function() { _cotLive = 'error'; if (_tab === 'cot') render(); });
        }, 80);

        return '<div style="padding:40px 20px;text-align:center;">' +
               '<div style="font-size:8px;color:rgba(255,255,255,0.3);letter-spacing:.2em;margin-bottom:8px;">LOADING CFTC DATA</div>' +
               '<div style="width:24px;height:24px;border:2px solid #222;border-top-color:' + A + ';border-radius:50%;margin:0 auto;animation:spin 1s linear infinite;"></div>' +
               '</div>';
      }

      if (_cotLive === 'empty') {
        return '<div style="padding:40px 20px;text-align:center;">' +
               '<div style="font-size:9px;color:' + A + ';letter-spacing:.16em;margin-bottom:10px;">NO DATA YET</div>' +
               '<div style="font-size:8px;color:rgba(255,255,255,0.45);line-height:1.7;max-width:320px;margin:0 auto;">' +
               'The <span style="color:#fff;">gold_cot_reports</span> table is empty.<br>' +
               'Run the SQL migration in Supabase, then visit<br>' +
               '<span style="color:' + A + ';">/.netlify/functions/fetch-cftc-data</span><br>' +
               'to seed it with live CFTC data now.' +
               '</div></div>';
      }

      if (_cotLive === 'error') {
        return '<div style="padding:40px 20px;text-align:center;"><div style="font-size:8px;color:rgba(255,255,255,0.3);letter-spacing:.2em;">CFTC DATA UNAVAILABLE</div></div>';
      }

      var cot     = _cotLive;
      var extreme = _extremeLive;

      var mmPct    = cot.oi ? Math.round(cot.mm_net / cot.oi * 100) : 0;
      var oiChg    = cot.oi - (cot.oi_prev || cot.oi);
      var mmChg    = cot.mm_net_prev != null ? cot.mm_net - cot.mm_net_prev : null;
      var gaugePct = Math.min(100, extreme > 0 ? Math.round(cot.mm_net / extreme * 100) : 0);
      var asOf     = cot.asOf || cot.report_date || '';
      var mmSubtitle = mmChg != null
        ? (mmChg >= 0 ? '↑ +' : '↓ ') + fmt(Math.abs(mmChg)) + ' WoW  ·  ' + mmPct + '% of OI'
        : mmPct + '% of open interest';

      var html = '<div style="padding:12px 14px 16px;overflow-y:auto;height:calc(100% - 36px);box-sizing:border-box;">';
      html += secHdr('COMEX GOLD FUTURES — CFTC DISAGGREGATED', 'SOURCE: CFTC  ·  WEEKLY FRIDAYS  ·  AS OF ' + asOf);

      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;">';
      html += kpiCard('OPEN INTEREST', fmt(cot.oi), (oiChg>0?'↑ ':'↓ ') + fmt(Math.abs(oiChg)) + ' vs prev week', oiChg>0?GRN:RED, '#0e1a12');
      html += kpiCard('MM NET LONG', (cot.mm_net>=0?'+':'') + fmt(cot.mm_net), mmSubtitle, mmPct>30?REC:A, '#1e1510');
      html += kpiCard('INSTITUTIONAL EXTREME', fmt(extreme), 'GS / systematic macro benchmark', 'rgba(255,255,255,0.35)', '#111');
      html += '</div>';

      html += '<div style="margin-bottom:14px;">';
      html += '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">';
      html += '<div style="font-size:6.5px;color:rgba(255,255,255,0.38);letter-spacing:.14em;">MM POSITIONING — DISTANCE TO HISTORICAL EXTREME</div>';
      html += '<div style="font-size:7px;color:' + A + ';font-weight:600;">' + gaugePct + '% of extreme</div>';
      html += '</div>';
      html += '<div style="height:10px;background:#111;border-radius:2px;overflow:hidden;">' +
              '<div style="height:100%;width:' + gaugePct + '%;background:linear-gradient(90deg,' + GRN + ' 0%,' + A + ' 60%,' + RED + ' 100%);border-radius:2px;"></div>' +
              '</div>';
      html += '<div style="display:flex;justify-content:space-between;margin-top:3px;">' +
              '<div style="font-size:6px;color:rgba(255,255,255,0.22);">NEUTRAL</div>' +
              '<div style="font-size:6px;color:rgba(255,255,255,0.22);">EXTREME</div>' +
              '</div></div>';

      html += secHdr('DISAGGREGATED POSITIONING', '');
      var rows = [
        {lbl:'MANAGED MONEY',    long:cot.mm_long, short:cot.mm_short, net:cot.mm_net, col:BLU},
        {lbl:'PRODUCER / MERCH', long:cot.pm_long, short:cot.pm_short, net:cot.pm_net, col:PRP},
        {lbl:'SWAP DEALERS',     long:cot.sd_long, short:cot.sd_short, net:cot.sd_net, col:GRN},
      ];
      html += '<div style="border:1px solid #1a1a1a;margin-bottom:12px;">';
      html += '<div style="display:grid;grid-template-columns:108px 72px 72px 78px 1fr;font-size:6px;color:rgba(255,255,255,0.28);letter-spacing:.14em;padding:6px 8px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;">' +
              '<div>CATEGORY</div><div style="text-align:right;">LONG</div><div style="text-align:right;">SHORT</div><div style="text-align:right;">NET</div><div style="padding-left:8px;">POSITIONING</div></div>';
      rows.forEach(function(r, i) {
        var isLong = r.net > 0;
        var bp = extreme > 0 ? Math.min(100, Math.round(Math.abs(r.net) / extreme * 100)) : 0;
        html += '<div style="display:grid;grid-template-columns:108px 72px 72px 78px 1fr;align-items:center;padding:7px 8px;border-bottom:' + (i<2?'1px solid #111':'none') + ';">' +
                '<div style="font-size:7.5px;color:#fff;font-weight:600;letter-spacing:.04em;">' + r.lbl + '</div>' +
                '<div style="font-size:7.5px;color:rgba(255,255,255,0.55);text-align:right;font-variant-numeric:tabular-nums;">' + fmt(r.long) + '</div>' +
                '<div style="font-size:7.5px;color:rgba(255,255,255,0.55);text-align:right;font-variant-numeric:tabular-nums;">' + fmt(r.short) + '</div>' +
                '<div style="font-size:8.5px;font-weight:700;color:' + (isLong?GRN:RED) + ';text-align:right;font-variant-numeric:tabular-nums;">' + (isLong?'+':'') + fmt(r.net) + '</div>' +
                '<div style="padding-left:8px;"><div style="height:5px;background:#111;border-radius:1px;overflow:hidden;">' +
                '<div style="height:100%;width:' + bp + '%;background:' + r.col + ';border-radius:1px;opacity:.8;"></div></div></div>' +
                '</div>';
      });
      html += '</div>';

      html += '<div style="display:flex;flex-direction:column;gap:6px;">';
      [{sig:'MANAGED MONEY', val:(cot.mm_net>=0?'+':'')+fmt(cot.mm_net),
        note:'Speculative funds are net long at ' + gaugePct + '% of the institutional crowding threshold (' + fmt(extreme) + ' contracts). This benchmark — used by Goldman Sachs commodities desk and systematic macro funds — marks the Aug 2016 and 2019–2020 cycle peaks. Positioning is elevated but not extreme; there is room for further institutional accumulation before the market becomes dangerously crowded.' + (mmChg != null ? ' WoW change: ' + (mmChg >= 0 ? '+' : '') + fmt(mmChg) + ' contracts.' : ''), col:BLU},
       {sig:'COMMERCIAL NET SHORT', val:fmt(cot.pm_net),
        note:'Producers and merchants are structurally net short — they mine gold and hedge forward production. This is not bearish. An increase in commercial shorts often accompanies rising prices as producers lock in profits at higher levels.', col:PRP}
      ].forEach(function(s) {
        html += '<div style="background:#0c0c0c;border:1px solid #1a1a1a;border-left:2px solid ' + s.col + ';padding:8px 10px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">' +
                '<div style="font-size:6.5px;letter-spacing:.16em;color:' + s.col + ';font-weight:600;">' + s.sig + '</div>' +
                '<div style="font-size:10px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;">' + s.val + '</div>' +
                '</div>' +
                '<div style="font-size:8.5px;color:rgba(255,255,255,0.7);line-height:1.62;">' + s.note + '</div>' +
                '</div>';
      });
      html += '</div>';
      html += '</div>';

      return html;
    }

            function renderDemand() {
      var gd  = GOLD_DATA[_demandYear];
      var s   = gd.supply;
      var d   = gd.demand;

      /* Computed totals — WGC methodology */
      var totalSupply    = s.mine + s.recycle + s.hedge;
      var totalDemandEx  = d.jewellery + d.barCoin + d.cb + d.tech + d.etf;
      var otcBalance     = totalSupply - totalDemandEx;

      var rows = [
        {seg:'Jewellery',    t:d.jewellery, col:A},
        {seg:'Bar & Coin',   t:d.barCoin,   col:BLU},
        {seg:'Central Banks',t:d.cb,        col:PRP},
        {seg:'Technology',   t:d.tech,      col:GRN},
        {seg:'ETFs / Funds', t:d.etf,       col:d.etf >= 0 ? GRN : RED},
      ];
      var maxD = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.t); }));

      var html = '<div style="padding:12px 14px 16px;overflow-y:auto;height:calc(100% - 36px);box-sizing:border-box;">';

      /* Year selector */
      html += '<div style="display:flex;gap:4px;margin-bottom:12px;">';
      ['2024','2025','2026'].forEach(function(yr) {
        var act = _demandYear === yr;
        var lbl = yr === '2026' ? '2026 YTD' : 'FY ' + yr;
        html += '<button id="gi-dy-' + yr + '-' + id + '" style="padding:4px 10px;font-size:6.5px;letter-spacing:.14em;font-family:Consolas,monospace;background:' + (act ? A : 'transparent') + ';color:' + (act ? '#000' : 'rgba(255,255,255,0.45)') + ';border:1px solid ' + (act ? A : '#2a2a2a') + ';cursor:pointer;">' + lbl + '</button>';
      });
      html += '</div>';

      html += secHdr('GLOBAL GOLD DEMAND — BY SEGMENT', gd.src + '  ·  TONNES');

      /* Demand rows */
      html += '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px;">';
      rows.forEach(function(row) {
        var isNeg = row.t < 0;
        var bp = Math.round(Math.abs(row.t) / maxD * 100);
        var tag = '';
        if (row.seg === 'ETFs / Funds') {
          tag = row.t >= 0
            ? '<span style="font-size:6px;font-weight:700;color:' + GRN + ';background:rgba(61,170,106,.15);padding:1px 4px;margin-left:4px;">INFLOW</span>'
            : '<span style="font-size:6px;font-weight:700;color:' + RED + ';background:rgba(209,64,64,.15);padding:1px 4px;margin-left:4px;">OUTFLOW</span>';
        }
        html += '<div style="display:grid;grid-template-columns:100px 1fr 64px 0px;align-items:center;gap:6px;">' +
                '<div style="font-size:8.5px;color:#fff;display:flex;align-items:center;">' + row.seg + tag + '</div>' +
                '<div style="height:9px;background:#111;border-radius:1px;overflow:hidden;">' +
                  (isNeg ? '<div style="height:100%;width:' + bp + '%;background:' + row.col + ';opacity:.4;border-radius:1px;margin-left:auto;"></div>'
                         : '<div style="height:100%;width:' + bp + '%;background:' + row.col + ';opacity:.85;border-radius:1px;"></div>') +
                '</div>' +
                '<div style="font-size:9px;font-weight:700;color:' + row.col + ';text-align:right;font-variant-numeric:tabular-nums;">' + (isNeg ? '−' : '') + Math.abs(row.t).toLocaleString() + 't</div>' +
                '</div>';
      });
      html += '</div>';

      /* KPI cards — computed */
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:14px;">';
      html += kpiCard('TOTAL DEMAND (EXCL. OTC)', Math.round(totalDemandEx).toLocaleString() + 't', 'jewellery + bar/coin + CB + tech + ETFs/Funds', BLU, '#0e1520');
      html += kpiCard('TOTAL SUPPLY',             Math.round(totalSupply).toLocaleString() + 't',    'mine + recycle + net hedging', GRN, '#0e1a12');
      html += kpiCard('OTC & MARKET BALANCE',     (otcBalance >= 0 ? '+' : '') + Math.round(otcBalance).toLocaleString() + 't', 'OTC & Market Balance (Unallocated Flows)', 'rgba(255,255,255,0.5)', '#111');
      html += '</div>';

      /* Supply breakdown */
      html += secHdr('SUPPLY BREAKDOWN — ' + gd.label, 'WORLD GOLD COUNCIL');
      html += '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px;">';
      [
        {lbl:'Mine production',  t:s.mine,    col:A},
        {lbl:'Recycled gold',    t:s.recycle, col:BLU},
        {lbl:'Producer hedging', t:s.hedge,   col:RED},
      ].forEach(function(sup) {
        /* Correct pct: segment / totalSupply, preserving sign */
        var pct = Math.round((sup.t / totalSupply) * 100);
        var barW = Math.round(Math.abs(sup.t) / totalSupply * 100);
        html += '<div style="display:grid;grid-template-columns:108px 1fr 58px 32px;align-items:center;gap:6px;">' +
                '<div style="font-size:8.5px;color:#fff;">' + sup.lbl + '</div>' +
                '<div style="height:7px;background:#111;border-radius:1px;overflow:hidden;">' +
                  '<div style="height:100%;width:' + barW + '%;background:' + sup.col + ';opacity:.8;border-radius:1px;"></div>' +
                '</div>' +
                '<div style="font-size:8.5px;font-weight:600;color:#fff;text-align:right;font-variant-numeric:tabular-nums;">' + (sup.t < 0 ? '−' : '+') + Math.abs(sup.t).toLocaleString() + 't</div>' +
                '<div style="font-size:6.5px;color:rgba(255,255,255,0.3);text-align:right;">' + (pct > 0 ? '+' : '') + pct + '%</div>' +
                '</div>';
      });
      html += '</div>';

      html += insightBox('SUPPLY CONSTRAINT',
        'Mine supply grows at approximately 1.5–2% annually regardless of price — new mines take 10–20 years to develop. Total gold mined in all of human history would fit in a 22-metre cube. Central bank demand in 2022 and 2023 alone exceeded the entire cumulative mine supply increase for the prior decade. The structural imbalance between inelastic supply and accelerating institutional demand is the fundamental case that requires no macro view to hold.',
        GRN);

      html += '</div>';

      /* Wire year selector buttons */
      setTimeout(function() {
        ['2024','2025','2026'].forEach(function(yr) {
          var btn = body.querySelector('#gi-dy-' + yr + '-' + id);
          if (btn) btn.addEventListener('click', function() { _demandYear = yr; render(); });
          var btn2 = body.querySelector('#gi-by-' + yr + '-' + id);
          if (btn2) btn2.addEventListener('click', function() { _buyerYear = yr; render(); });
        });
      }, 10);

      return html;
    }

        function render() {
      body.innerHTML =
        '<style>@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}</style>' +
        '<div style="display:flex;flex-direction:column;height:100%;font-family:Consolas,monospace;overflow:hidden;background:#000;">' +
          '<div style="display:flex;border-bottom:1px solid #1e1e1e;flex-shrink:0;background:#000;overflow-x:auto;scrollbar-width:none;">' +
            tabBtn('cb',       'CENTRAL BANKS') +
            tabBtn('holdings', 'CB HOLDINGS') +
            tabBtn('cot',      'COT REPORT') +
            tabBtn('demand',   'DEMAND / SUPPLY') +
            tabBtn('etf',      'ETF / FLOWS') +
          '</div>' +
          '<div id="gi-panel-' + id + '" style="flex:1;overflow:hidden;">' +
            (_tab === 'cb'       ? renderCB()       :
             _tab === 'holdings' ? renderHoldings() :
             _tab === 'cot'      ? renderCOT()      :
             _tab === 'etf'      ? renderETF()      : renderDemand()) +
          '</div>' +
        '</div>';

      ['cb','holdings','cot','demand','etf'].forEach(function(k) {
        var btn = body.querySelector('#gi-t-' + k + '-' + id);
        if (btn) btn.addEventListener('click', function() { _tab = k; render(); });
      });
      /* Wire CB buyer year buttons when on CB tab */
      if (_tab === 'cb') {
        setTimeout(function() {
          ['2024','2025','2026'].forEach(function(yr) {
            var byBtn = body.querySelector('#gi-by-' + yr + '-' + id);
            if (byBtn) byBtn.addEventListener('click', function() { _buyerYear = yr; render(); });
          });
        }, 10);
      }
    }

    render();

  }


  /* ── CALL SIGNAL + CONVERSATION OPENER ── */
  function renderCallSignal(id, body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';
    body.style.padding = '0';

    var _allData = null;

    function lat(sid, data) {
      var s = data[sid];
      if (!s || !s.observations || !s.observations.length) return null;
      return s.observations[s.observations.length - 1].value;
    }
    function prv(sid, data) {
      var s = data[sid];
      if (!s || !s.observations || s.observations.length < 2) return null;
      return s.observations[s.observations.length - 2].value;
    }
    function fmt(v, d) { return v == null ? '--' : v.toFixed(d != null ? d : 1); }

    function refresh(data) {
      _allData = data;
      var cpi    = lat('CPIAUCSL', data);
      var curve  = lat('T10Y2YM', data);
      var ff     = lat('FEDFUNDS', data);
      var unrate = lat('UNRATE', data);
      var unPrv  = prv('UNRATE', data);
      var cfnai  = lat('CFNAI', data);
      var m2     = lat('M2SL', data);

      var score = 0;
      if (cpi   != null && cpi   > 2.5)  score++;
      if (cpi   != null && cpi   > 3.5)  score++;
      if (curve != null && curve < 0.5)  score++;
      if (curve != null && curve < -0.2) score++;
      if (ff    != null && ff    > 4.0)  score++;
      if (unrate != null && unPrv != null && unrate > unPrv) score++;
      if (cfnai != null && cfnai < 0)    score++;
      if (m2    != null && m2    < 2)    score++;

      var sigLevel, sigCol, sigIcon, sigDesc;
      if (score >= 5) {
        sigLevel = 'HIGH CALL PROBABILITY'; sigCol = '#4caf50'; sigIcon = '▲';
        sigDesc = 'Multiple structural signals favour the alternative asset case. Prime conditions for outreach across gold, property, fine wine, and collectibles.';
      } else if (score >= 3) {
        sigLevel = 'MODERATE — MONITOR'; sigCol = '#E97132'; sigIcon = '●';
        sigDesc = 'Conditions are building. Targeted outreach using the 1–2 strongest indicators — position clients before the mainstream narrative catches up.';
      } else {
        sigLevel = 'LOW URGENCY'; sigCol = '#555'; sigIcon = '▼';
        sigDesc = 'Macro background is quiet. Education and relationship calls — build the pipeline for when the signal upgrades.';
      }

      var cpiStr   = fmt(cpi, 1) + '%';
      var curveStr = fmt(curve, 2) + '%';
      var ffStr    = fmt(ff, 2) + '%';
      var urStr    = fmt(unrate, 1) + '%';

      var openers = (window._assetLens && window._assetLens.openers) ? window._assetLens.openers : [];

      body.innerHTML =
        '<div style="display:flex;flex-direction:column;height:100%;font-family:Consolas,monospace;">' +
        '<div style="padding:10px 14px;border-bottom:1px solid #2a2a2a;flex-shrink:0;">' +
          '<div style="font-size:8px;letter-spacing:0.3em;color:#ffffff;margin-bottom:6px;">TODAY\'S CALL SIGNAL — ' + (window._assetLens ? window._assetLens.label.toUpperCase() : 'ALTERNATIVE ASSETS') + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<span style="font-size:16px;color:' + sigCol + ';">' + sigIcon + '</span>' +
            '<span style="font-size:11px;font-weight:700;color:' + sigCol + ';letter-spacing:0.08em;">' + sigLevel + '</span>' +
          '</div>' +
          '<div style="font-size:9px;color:#ffffff;margin-top:5px;line-height:1.5;">' + sigDesc + '</div>' +
          '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">' +
            (cpi    != null ? '<span style="font-size:8px;padding:2px 6px;border:1px solid ' + (cpi > 2.5 ? '#c0392b' : '#2a2a2a') + ';color:' + (cpi > 2.5 ? '#e05050' : '#555') + ';">CPI ' + cpiStr + '</span>' : '') +
            (curve  != null ? '<span style="font-size:8px;padding:2px 6px;border:1px solid ' + (curve < 0 ? '#c07030' : '#2a2a2a') + ';color:' + (curve < 0 ? '#E97132' : '#555') + ';">CURVE ' + curveStr + '</span>' : '') +
            (ff     != null ? '<span style="font-size:8px;padding:2px 6px;border:1px solid ' + (ff > 4 ? '#c07030' : '#2a2a2a') + ';color:' + (ff > 4 ? '#E97132' : '#555') + ';">FFR ' + ffStr + '</span>' : '') +
            (unrate != null ? '<span style="font-size:8px;padding:2px 6px;border:1px solid ' + (unPrv != null && unrate > unPrv ? '#c0392b' : '#2a2a2a') + ';color:' + (unPrv != null && unrate > unPrv ? '#e05050' : '#555') + ';">UNRATE ' + urStr + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div style="font-size:8px;letter-spacing:0.25em;color:#ffffff;padding:8px 14px 4px;flex-shrink:0;">CONVERSATION OPENERS</div>' +
        '<div style="flex:1;overflow-y:auto;padding:0 14px 14px;">' +
          openers.map(function(op, i) {
            return '<div style="margin-bottom:10px;padding:10px 12px;border:1px solid #1e1e1e;border-left:3px solid #E97132;">' +
              '<div style="font-size:8px;color:#E97132;letter-spacing:0.2em;margin-bottom:5px;">OPENER ' + (i+1) + '</div>' +
              '<div style="font-size:9.5px;color:#fff;line-height:1.65;">' + op + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '</div>';

    }

    window.addEventListener('lens:change', function () { if (_allData) refresh(_allData); });

    body.innerHTML = '<div style="padding:20px;text-align:center;font-family:Consolas,monospace;font-size:10px;color:#555;letter-spacing:0.2em;">LOADING SIGNAL…</div>';

    fetch('/.netlify/functions/fred-data?series=CPIAUCSL,T10Y2YM,FEDFUNDS,UNRATE,CFNAI,M2SL&limit=24')
      .then(function(r){ return r.json(); })
      .then(function(d){ refresh(d.series || {}); })
      .catch(function(){ body.innerHTML='<div style="padding:20px;font-family:Consolas,monospace;font-size:10px;color:#555;text-align:center;">SIGNAL DATA UNAVAILABLE</div>'; });
  }

  /* ── OBJECTION HANDLER ── */
  function renderObjHandler(id, body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';
    body.style.padding = '0';

    var GOLD_OBJ = [
      {id:'g01',cat:'PRICE',   q:'"Gold is too expensive — it\'s already up 43%."',
       ack:'That\'s a completely natural reaction — and it\'s the same thing people said at $500, $1,000 and $2,000.',
       redirect:'The question is never what price was yesterday — it\'s whether the reasons for the move are still in place. They are: inflation elevated, central banks buying, dollar weakening, yield curve stressed. Gold is currently 12% below its March all-time high. If any other asset were down 12% from peak with fundamentals intact, we\'d call it a buying opportunity.',
       pivot:'"If gold was at $3,000 right now — down from $5,230 — would you say it was cheap? The fundamentals are the same. What specifically about the current number feels too high?"'},
      {id:'g02',cat:'PRICE',   q:'"I\'ll wait until it pulls back more before buying."',
       ack:'Wanting a better entry is smart — nobody wants to buy at the top.',
       redirect:'The problem: what level would feel comfortable? Most clients who say this never have an answer. When gold is lower, it will feel like it\'s falling for a reason. When it\'s higher, it will feel too expensive. This is anchoring bias. COT data currently shows Non-Commercial Z-Scores at historically oversold levels — positioning that has historically produced positive 12-month returns in every instance since 2000.',
       pivot:'"What price specifically would you need to see — and what makes that number materially different from today\'s, given the fundamentals are the same?"'},
      {id:'g03',cat:'PRICE',   q:'"It\'s had a massive run — surely it\'s due a correction."',
       ack:'After a 43% move, that\'s a completely rational thing to think.',
       redirect:'Assets don\'t reverse because they\'ve moved. They reverse when the underlying drivers reverse. Has inflation reversed? Has central bank buying stopped? Has the dollar strengthened? Has geopolitical risk resolved? Every single driver is still intact. Gold ran 645% from 2001 to 2011 with multiple 15–20% corrections along the way. Each one felt like the top. None were.',
       pivot:'"Which of the four structural drivers — inflation, central bank buying, dollar weakness, geopolitical risk — do you believe is about to reverse? Because if none are, what causes the correction you\'re expecting?"'},
      {id:'g04',cat:'INCOME',  q:'"Gold doesn\'t pay any income or dividends."',
       ack:'You\'re completely right — gold pays zero income. That\'s a fact.',
       redirect:'A UK savings account at 3.5% minus 3.3% inflation equals 0.2% real return before tax. After 40% higher-rate tax the real return is negative. Gold returned +43% this year with no income and no income tax until disposal. Income is also taxed as it arrives; capital gains only on disposal — with CGT allowances, a meaningful portion may be sheltered.',
       pivot:'"If you compared total after-tax return — including both income and capital — between your client\'s current cash position and gold over the last 12 months, which comes out ahead?"'},
      {id:'g05',cat:'INCOME',  q:'"I need yield — my client genuinely can\'t live on capital gains."',
       ack:'If your client genuinely needs income to live on, I completely respect that.',
       redirect:'The question is never gold or income — it\'s what the optimal portfolio looks like. A 5–10% allocation to gold alongside income-producing assets doesn\'t replace the income; it hedges the purchasing power of the income against the inflation that\'s eroding it. The income buys less every year without it.',
       pivot:'"What percentage of your client\'s portfolio is currently in income-producing assets? Because even a 5% reallocation to gold wouldn\'t touch the income — it would protect the value of everything else."'},
      {id:'g06',cat:'CONCEPT', q:'"Gold is old fashioned — the world has moved on."',
       ack:'That\'s a reasonable instinct in a world of digital assets and technology.',
       redirect:'Central banks hold gold, not because it\'s traditional, but because it has no counterparty risk. It cannot be defaulted on, frozen, sanctioned or devalued by a third party. In 2023 and 2024, central banks bought over 1,000 tonnes per year — the highest pace since 1967. These are the most sophisticated institutions on earth. They\'re not sentimental about gold. They\'re precise about risk.',
       pivot:'"If central banks — who have access to every asset class and the best economic analysis in the world — are increasing gold allocations at a record pace, what\'s the information advantage you have that tells you they\'re wrong?"'},
      {id:'g07',cat:'CONCEPT', q:'"Crypto does what gold does but better."',
       ack:'I understand the comparison — both are framed as alternatives to fiat currency.',
       redirect:'Gold has a 5,000-year settlement record. Crypto has a 15-year record that includes three 70%+ drawdowns, multiple exchange failures, and regulatory seizure. No central bank holds crypto as a reserve asset. Every central bank holds gold. The volatility of bitcoin is 4–5× that of gold. As a store of value for a client\'s serious money, gold is the institutional-grade option.',
       pivot:'"Does your client want exposure to a speculative technology asset or a monetary reserve? Because those are two different objectives — and they need different instruments."'},
      {id:'g08',cat:'CONCEPT', q:'"Gold is just a commodity — it has no intrinsic value."',
       ack:'That\'s a common framing — and it\'s worth unpacking carefully.',
       redirect:'Gold has no intrinsic value in the industrial sense — it\'s not consumed. But that\'s actually what makes it monetary. Unlike copper or oil, supply doesn\'t get destroyed by use. Every ounce ever mined still exists. The monetary value of gold isn\'t derived from usefulness — it\'s derived from scarcity, universal acceptability, and the absence of counterparty risk. Those properties are the definition of money.',
       pivot:'"What gives the pound in your client\'s bank account its value? It\'s not backed by anything physical — it\'s backed by confidence in the Bank of England\'s ability to manage it. Gold is backed by the same thing it\'s always been backed by: scarcity and 5,000 years of human consensus."'},
      {id:'g09',cat:'EXPERIENCE',q:'"I already tried gold and lost money."',
       ack:'That\'s a meaningful experience — and I want to understand it.',
       redirect:'When did they buy, and what did they own? Most clients who say this bought at or near the 2011 peak ($1,900) and sold during the 2013–2015 correction. That was a 12-year bear market in gold driven by the post-GFC recovery and rising real yields. The structural conditions that caused that bear market — recovery, rising rates, dollar strength — are now running in reverse. The 2011 buyer at $1,900 has been in profit since 2020. The environment has changed.',
       pivot:'"When did they buy and what did they own? Because the gold market of 2011–2018 and the gold market of 2024–2026 are structurally different environments. I\'d like to show you why."'},
      {id:'g10',cat:'RISK',    q:'"Gold is too volatile and risky for my client."',
       ack:'Volatility is a legitimate consideration.',
       redirect:'Gold\'s annualised volatility is approximately 15–18% — similar to global equities. But unlike equities, gold\'s correlation to the equity market is near zero and often negative during crises. In 2008, gold fell 30% and then rose 170% over the next three years. In COVID, gold fell briefly then surged 40%. The volatility is real; the directional risk in this macro environment is not.',
       pivot:'"What is your client\'s current allocation to equities? Because equities have similar or higher volatility to gold with positive correlation to each other — meaning the portfolio has concentrated directional risk that gold actually reduces."'},
      {id:'g11',cat:'TIMING',  q:'"What if there\'s a peace deal — gold will crash."',
       ack:'Peace is possible — and would obviously be welcome.',
       redirect:'Gold has four structural drivers: inflation, central bank buying, dollar weakness, and geopolitical risk. Geopolitical risk is only one. Inflation is still running at 3%+. Central banks bought 1,000+ tonnes in 2024. The dollar has weakened against major currencies. A peace deal removes one of four drivers. It doesn\'t reverse the other three. And historically, gold often recovers within weeks of geopolitical de-escalations because the monetary conditions remain intact.',
       pivot:'"If a peace deal happened tomorrow and gold fell 8%, would that change the other three structural drivers? Inflation, central bank buying, dollar weakness — do those reverse because of a peace deal?"'},
      {id:'g12',cat:'TIMING',  q:'"I\'ll wait for rate cuts — that\'s when gold really moves."',
       ack:'You\'re right that rate cuts are a strong gold catalyst.',
       redirect:'Gold moves in anticipation, not confirmation. In every prior rate-cut cycle, gold started rising 6–12 months before the first official cut. Clients who waited for the announcement bought after the easy money was already made. You are currently in the anticipation phase. The cut is priced in the futures market. The time to position was when rates were clearly near peak — which is right now.',
       pivot:'"If you wait for the first cut to be announced, what price do you think gold will be at that point, given that it has historically moved 15–20% before the announcement?"'},
      {id:'g13',cat:'TIMING',  q:'"Let\'s wait until things are clearer."',
       ack:'That\'s a completely understandable instinct — uncertainty is uncomfortable.',
       redirect:'The problem is that "clearer" never arrives. When things feel clearer, they\'re already priced in. The return in gold comes from positioning during uncertainty, not after it resolves. The clients who positioned in gold in 2019 — before COVID, before the inflation surge, before the geopolitical fragmentation — made 4× their money. They bought when things felt unclear.',
       pivot:'"What specifically would need to be clearer for you to feel comfortable? Because I want to understand whether that clarity is achievable — or whether we\'re waiting for a certainty that the market will have already priced in before it arrives."'},
      {id:'g14',cat:'STALL',   q:'"I\'ll think about it and come back to you."',
       ack:'Of course — this is a considered decision and I respect that.',
       redirect:'I\'d like to make sure you have everything you need to make a good decision. Most of the time when someone says they\'ll think about it, there\'s a specific question or concern that hasn\'t quite been answered. I\'d rather address that now than have you sit with a question that might lead to the wrong conclusion.',
       pivot:'"Is there one specific thing you\'re still unsure about — something I might be able to give you a clearer answer on before we finish?"'},
      {id:'g15',cat:'TRUST',   q:'"The gold market is manipulated."',
       ack:'The concern about market manipulation is real and has been investigated.',
       redirect:'There have been documented instances of short-term spot price manipulation by banks. But those manipulations were in the paper derivatives market, not in physical gold. The actual structural price of physical gold over 20 years has tracked its fundamental drivers with remarkable fidelity: central bank buying, real yields, dollar direction, and inflation expectations. No manipulation has reversed those multi-year trends.',
       pivot:'"If the market were manipulated lower — below where fundamentals suggest it should be — wouldn\'t that actually create a better entry point for a long-term physical gold position?"'},
    ];

    var WHISKY_OBJ = [
      {id:'w01',cat:'PRICE',   q:'"The market crashed 53%. Why would I buy now?"',
       ack:'That\'s exactly the right question — and it has an exact answer.',
       redirect:'The 53% fall from October 2024 to January 2025 was a speculative flush. COVID momentum buyers exited as rates normalised. What remains is the structural market: genuine collectors, long-term investors, and institutions. The fundamentals have not just survived the correction — they have strengthened. India\'s import tariff has been reduced from 150% to 75%. The US tariff was removed entirely. Christie\'s generated £4.25m in April 2026. You are not buying a crashed market hoping for a bounce — you are buying a structurally stronger case at lower prices.',
       pivot:'"At what price would you feel comfortable entering? And what would have changed about the supply-demand structure at that price versus today?"'},
      {id:'w02',cat:'TIMING',  q:'"The price could fall further. I want to wait for the bottom."',
       ack:'A logical concern — and it deserves a specific answer.',
       redirect:'You may be right that prices could fall another 10%. But the thesis for buying whisky is not that prices go up tomorrow. It\'s that supply is finite and tightening, and demand has just had two simultaneous treaty-level catalysts. That thesis does not require you to catch the exact bottom. The people who waited for the "perfect entry" into gold in 2015 were still waiting in 2016 when it had already moved 20% off the bottom. Meanwhile, every week you wait, old stock is being consumed and the supply pool shrinks.',
       pivot:'"What specific level would feel comfortable — and what would have changed about the supply-demand arithmetic at that level versus today?"'},
      {id:'w03',cat:'CONCEPT', q:'"I don\'t understand whisky as an investment. It\'s a luxury product."',
       ack:'That\'s the most common starting point — and the most important to address.',
       redirect:'The confusion is thinking about whisky as a drink rather than its investment properties. Three structural properties: First, the supply is genuinely finite — you cannot issue more shares of a 1999 vintage. Second, the asset physically improves with age — chemistry is creating value in the barrel, not waiting for market recognition. Third, the exit mechanism is transparent: Sotheby\'s, Christie\'s, and specialist auction houses process significant volumes continuously.',
       pivot:'"If I showed you the supply-demand mechanics specifically — the production timeline, finite stock, India and US demand catalysts — would the investment case make more sense? I can take five minutes to walk you through it."'},
      {id:'w04',cat:'LIQUIDITY',q:'"Whisky is illiquid. I can\'t sell it when I need to."',
       ack:'Liquidity is a legitimate question — let me give you an accurate answer.',
       redirect:'Investment-grade Scotch — documented provenance, sub-500 bottle limited releases, established auction history — is handled by Sotheby\'s, Christie\'s, and specialist auction houses continuously. Top-tier lots typically sell within two to four weeks. Christie\'s April 2026 sale (£4.25m) confirms institutional demand is active. Liquidity and immediacy are not the same thing. You cannot sell a property in 24 hours either. What matters is whether there is a functioning market with transparent pricing and consistent demand.',
       pivot:'"For your client\'s specific situation — if they needed to liquidate over a 30–60 day window rather than immediately — would that time frame work within their portfolio planning?"'},
      {id:'w05',cat:'PROCESS', q:'"How do I actually store it? Where does it go?"',
       ack:'NOTE: This is a buying signal. Answer precisely and move to the close.',
       redirect:'This means the client has accepted the investment case and is in "how do I do it?" mode. Casks: held in HMRC-registered bonded warehouses. Legal ownership is segregated from the warehouse operator\'s balance sheet. Storage fees are typically £100–£200 per cask per year. Specialist insurance is standard. You do not take physical delivery. Bottled stock: climate-controlled, insured, audited specialist storage with full chain-of-custody documentation for auction eligibility.',
       pivot:'"Given your client\'s situation — would a cask position or bottled stock be the better fit? Let\'s establish the structure and move forward."'},
      {id:'w06',cat:'VERSUS',  q:'"Why whisky when I could just own more gold? Gold is simpler."',
       ack:'Gold is the right core position — I\'m not suggesting you replace it.',
       redirect:'Gold is passive: it holds value and responds to macro conditions. Whisky does two additional things. First, it physically improves — the asset is not passive, chemistry is creating value independent of market sentiment. Second, the demand drivers are independent of the macro cycle: Chinese and Middle Eastern HNW collectors buying premium Scotch are satisfying a cultural preference, not making an inflation hedge. That demand base is structurally separate from the macro.',
       pivot:'"Is your client already fully allocated to gold? Because if so, whisky doesn\'t replace it — it adds a different mechanism of appreciation with a different demand base."'},
      {id:'w07',cat:'PRICE',   q:'"It\'s too expensive for my client. They can\'t afford it."',
       ack:'Entry cost is a real consideration.',
       redirect:'Investment-grade whisky entry points range from £2,000 for a younger cask to £20,000+ for established expressions. The question is what percentage of portfolio makes sense. A 5% allocation to whisky in a £200,000 portfolio is £10,000 — one cask. That\'s a concentration level consistent with other alternative assets. The threshold is not as high as people assume.',
       pivot:'"What is your client\'s total investable portfolio? Because a 5% whisky allocation might be more accessible than they think."'},
      {id:'w08',cat:'RISK',    q:'"What if the warehouse burns down? What\'s the insurance situation?"',
       ack:'A completely practical question — and one with a clear answer.',
       redirect:'HMRC-registered bonded warehouses are purpose-built storage facilities with fire suppression systems, security, and regulatory oversight. Specialist insurance for cask contents is standard practice and is typically arranged as part of the storage agreement. The insurance is based on replacement value, not purchase price. The regulatory framework is one of the most stringent in the UK for any physical asset.',
       pivot:'"Would you like me to walk through the specific insurance and storage documentation so your client can review exactly what is covered before making a decision?"'},
    ];

    var PROPERTY_OBJ = [
      {id:'p01',cat:'RATES',    q:'"Rates are too high — it\'s not a good time to buy property."',
       ack:'You\'re right that higher rates increase borrowing costs for end buyers.',
       redirect:'But we\'re at or near the peak — and every prior rate peak has been followed by mortgage rate compression. The smart money buys at the top of the rate cycle and refinances when rates fall. Entry prices today reflect the rate environment. When that environment improves, both capital values and the pool of competing buyers expand simultaneously. The window to enter before that compression is the window we\'re in now.',
       pivot:'"At what rate level would your client feel comfortable entering? Because by the time rates reach that level, so will everyone else — and today\'s price will be a footnote."'},
      {id:'p02',cat:'RETURNS',  q:'"I\'d rather just buy a property directly."',
       ack:'Direct ownership is the gold standard for control, transparency, and rental income.',
       redirect:'The friction is the filter. Direct acquisition requires 6–12 months, significant leverage, active management, void periods, regulatory compliance, and concentration in a single asset. A properly structured property investment vehicle gives the same real asset exposure with diversification across 20+ assets, professional management, and a lower minimum — without the friction that prevents most clients from acting at all.',
       pivot:'"Is the friction of direct ownership serving the client\'s return, or is it just the familiar path that delays diversification?"'},
      {id:'p03',cat:'PRICE',    q:'"Property prices are going to fall."',
       ack:'In nominal terms, corrections are possible — we saw that in 2022–23.',
       redirect:'But in real terms — after inflation — UK residential property has not sustained a multi-year decline since 1950. Every nominal fall has been followed by a stronger recovery. Inflation does the work for property investors even when prices appear flat: a 5% inflation rate on a leveraged property holding compresses the real debt burden while the asset holds its nominal value.',
       pivot:'"If property fell 10% in nominal terms but inflation ran at 5%, what was the real return on cash held instead? Because that is the comparison the client actually needs to see."'},
      {id:'p04',cat:'LIQUIDITY',q:'"It\'s illiquid — I can\'t sell it quickly."',
       ack:'Illiquidity is real, and it isn\'t appropriate for capital that may need to be accessed.',
       redirect:'But the illiquidity premium exists for a reason — you are compensated for not being able to panic-sell in a downturn. Property\'s illiquidity is precisely why it didn\'t fall 30% in March 2020. Clients who held liquid assets sold at the bottom. Those who held property held through the correction and recovered fully. Illiquidity is protection, not punishment, for capital with a 5+ year horizon.',
       pivot:'"What proportion of the client\'s portfolio needs to remain immediately liquid? Illiquidity is only a risk for money they might need to access — not for their long-term allocation."'},
      {id:'p05',cat:'EXPOSURE', q:'"I already have property exposure through my home."',
       ack:'A primary residence is typically the client\'s largest single asset — that concentration is worth acknowledging.',
       redirect:'But residential is one sector within a diverse real asset universe. Commercial, logistics, healthcare, student accommodation, and build-to-rent have different demand drivers, tenancy structures, and income profiles. The correlation between a client\'s home value and a logistics REIT is near zero. Diversification within property is real — it\'s not the same asset just because they share a label.',
       pivot:'"If their home value fell 20%, would any of their other property exposure hold? That\'s the question that determines whether they\'re concentrated or genuinely diversified within real assets."'},
      {id:'p06',cat:'TIMING',   q:'"Now is not the right time."',
       ack:'Timing feels important — no one wants to buy at the wrong point in the cycle.',
       redirect:'But the data consistently shows that clients who tried to time the property market underperformed those who allocated and held. The UK property cycle has never failed to recover over a 10-year horizon. "Now is not the right time" is a feeling, not a strategy. The question is what the client\'s 10-year horizon looks like versus the 12-month uncertainty they\'re trying to avoid.',
       pivot:'"If the client had said that in 2012, 2016, or 2020, where would they be now? I\'d like to run those numbers."'},
    ];

    var WINE_OBJ = [
      {id:'n01',cat:'KNOWLEDGE', q:'"I don\'t know anything about wine."',
       ack:'Most investment-grade wine investors don\'t — and that\'s exactly why they invest rather than drink it.',
       redirect:'You don\'t need to know the vintage characteristics of a 2000 Pétrus to own it. The Liv-ex Fine Wine 1000 has returned an average of 10%+ annually over 20 years with low correlation to equities. The knowledge required is not oenological — it\'s the same knowledge that applies to any scarce, globally demanded asset: supply is fixed, demand is growing, and time works in the investor\'s favour.',
       pivot:'"Does your client know the mechanics of the gilt they hold? Because the investment case for fine wine is simpler than most fixed income instruments — and the returns have been superior."'},
      {id:'n02',cat:'RISK',      q:'"Wine goes off — what about storage risk?"',
       ack:'Wine can degrade — but only if stored incorrectly, which is why professional bonded storage is the standard.',
       redirect:'Investment-grade wine is held in HMRC-approved bonded warehouses at precisely controlled temperature, humidity, and vibration levels. The wine never leaves bond until sale. Storage costs approximately 1.5% per annum — far below average annual appreciation of 10%+. The risk profile is comparable to gold in a vaulted account: professionally managed, insured, and third-party verified.',
       pivot:'"Would the client be comfortable with a 1.5% annual storage cost on an asset averaging 10% appreciation over 20 years? Because that\'s the net arithmetic."'},
      {id:'n03',cat:'CREDIBILITY',q:'"Fine wine isn\'t a serious investment."',
       ack:'That\'s a common first response — and it was the response to art, watches, and whisky before each became recognised institutional asset classes.',
       redirect:'The Liv-ex Fine Wine 1000 has a 20-year verified track record. Christie\'s, Sotheby\'s, and Acker run dedicated fine wine departments generating hundreds of millions in annual volume. Knight Frank tracks fine wine in their Luxury Investment Index alongside gold and classic cars. Cambridge University and AXA IM both hold wine portfolios. At what point does the data overturn the perception?',
       pivot:'"What criteria would a \'serious investment\' need to meet? I can tell you which of those criteria fine wine satisfies — and which it exceeds."'},
      {id:'n04',cat:'VALUATION', q:'"I can\'t value it myself."',
       ack:'Self-valuation is difficult in any market without real-time price discovery.',
       redirect:'The Liv-ex exchange provides real-time pricing for all investment-grade wines — closer to a commodities exchange than the art market. Every lot at Christie\'s, Sotheby\'s, and Acker creates a verified, public price point. The methodology is third-party verified and decades old. The client\'s private equity holding has no daily price — fine wine does.',
       pivot:'"Is the objective to value it themselves, or to have a professionally verified market price? The latter exists and is more transparent than most alternative investments the client currently holds."'},
      {id:'n05',cat:'LIQUIDITY', q:'"How do I sell it?"',
       ack:'Liquidity is a legitimate question for any alternative asset.',
       redirect:'Fine wine is the most liquid segment of the collectibles market. A first-growth Bordeaux or recognised Burgundy trades at Christie\'s or Sotheby\'s within 4–6 weeks of consignment. The Liv-ex exchange provides near-instant liquidity for standard lots. It\'s not equity-market liquid — but it\'s more liquid than direct property, private equity, or most structured products.',
       pivot:'"What liquidity timeframe does the client need? Because 4–6 weeks to realise a 10%+ annual return over a 5-year hold is a very favourable trade."'},
      {id:'n06',cat:'VERSUS',    q:'"Why fine wine when I could just own gold?"',
       ack:'Gold is the most liquid and widely understood hard asset — a perfectly valid alternative.',
       redirect:'Fine wine and gold are complementary rather than competing. Gold tracks monetary debasement and rate cycles. Wine tracks luxury demand growth, vintage scarcity, and collector accumulation — different drivers that rarely move together. The Liv-ex 1000 and gold have a correlation of approximately 0.2. Holding both gives real asset diversification within the alternative allocation — two different mechanisms, both pointing in the same long-run direction.',
       pivot:'"If the client already holds gold, what proportion of their alternative allocation is in assets with genuinely different drivers? Concentration within alternatives carries its own risk."'},
    ];

    var _cat = 'ALL';
    var _search = '';
    var _open = {};

    function getLensObjs() {
      return (window._assetLens && window._assetLens.objections) ? window._assetLens.objections : [];
    }

    function getObjs() {
      var data = getLensObjs();
      return data.filter(function(o) {
        if (_cat !== 'ALL' && o.cat !== _cat) return false;
        if (_search) {
          var q = _search.toLowerCase();
          return o.q.toLowerCase().indexOf(q) !== -1 || o.redirect.toLowerCase().indexOf(q) !== -1;
        }
        return true;
      });
    }

    function getCats() {
      var data = getLensObjs();
      var seen = {};
      data.forEach(function(o){ seen[o.cat]=1; });
      return ['ALL'].concat(Object.keys(seen));
    }

    function render() {
      var cats = getCats();
      var objs = getObjs();

      var catHtml = cats.map(function(c) {
        return '<button data-ocat="' + c + '" style="padding:3px 8px;font-size:8px;letter-spacing:0.1em;border:1px solid ' + (_cat===c?'#E97132':'#2a2a2a') + ';background:' + (_cat===c?'#E97132':'transparent') + ';color:' + (_cat===c?'#fff':'#ffffff') + ';cursor:pointer;font-family:Consolas,monospace;white-space:nowrap;">' + c + '</button>';
      }).join('');

      var listHtml = objs.length ? objs.map(function(o) {
        var isOpen = !!_open[o.id];
        return '<div style="border-bottom:1px solid #1a1a1a;">' +
          '<div data-oToggle="' + o.id + '" style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;cursor:pointer;">' +
            '<span style="font-size:8px;padding:2px 5px;border:1px solid #2a2a2a;color:#ffffff;white-space:nowrap;flex-shrink:0;letter-spacing:0.1em;">' + o.cat + '</span>' +
            '<div style="font-size:10px;color:#fff;line-height:1.4;flex:1;font-style:italic;">' + o.q + '</div>' +
            '<span style="font-size:9px;color:#E97132;flex-shrink:0;">' + (isOpen?'▲':'▼') + '</span>' +
          '</div>' +
          (isOpen ?
            '<div style="padding:0 12px 12px 12px;">' +
              '<div style="border:1px solid #2a2a2a;border-left:3px solid #E97132;">' +
                '<div style="padding:10px 12px;border-bottom:1px solid #1e1e1e;">' +
                  '<div style="font-size:8px;color:#E97132;letter-spacing:0.18em;margin-bottom:5px;">ACKNOWLEDGE</div>' +
                  '<div style="font-size:9.5px;color:#ffffff;line-height:1.6;">' + o.ack + '</div>' +
                '</div>' +
                '<div style="padding:10px 12px;border-bottom:1px solid #1e1e1e;">' +
                  '<div style="font-size:8px;color:#E97132;letter-spacing:0.18em;margin-bottom:5px;">REDIRECT</div>' +
                  '<div style="font-size:9.5px;color:#fff;line-height:1.65;">' + o.redirect + '</div>' +
                '</div>' +
                '<div style="padding:10px 12px;background:#0e0e0e;">' +
                  '<div style="font-size:8px;color:#E97132;letter-spacing:0.18em;margin-bottom:5px;">PIVOT QUESTION</div>' +
                  '<div style="font-size:9.5px;color:#E6E6E6;line-height:1.65;font-style:italic;">' + o.pivot + '</div>' +
                '</div>' +
              '</div>' +
            '</div>'
          : '') +
        '</div>';
      }).join('') : '<div style="padding:30px;text-align:center;font-size:10px;color:#ffffff;font-family:Consolas,monospace;letter-spacing:0.15em;">NO MATCHES</div>';

      body.innerHTML =
        '<div style="display:flex;flex-direction:column;height:100%;font-family:Consolas,monospace;">' +
        /* search */
        '<div style="padding:8px 12px;border-bottom:1px solid #2a2a2a;flex-shrink:0;">' +
          '<input id="oh-search-' + id + '" placeholder="Search objections…" value="' + escH(_search) + '" style="width:100%;background:#111;border:1px solid #2a2a2a;color:#fff;padding:5px 8px;font-size:9px;font-family:Consolas,monospace;box-sizing:border-box;" />' +
        '</div>' +
        /* category pills */
        '<div style="display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid #2a2a2a;flex-shrink:0;overflow-x:auto;">' + catHtml + '</div>' +
        /* list */
        '<div style="flex:1;overflow-y:auto;">' + listHtml + '</div>' +
        '</div>';

      /* wire events */
      var si = body.querySelector('#oh-search-' + id);
      if (si) si.addEventListener('input', function(){ _search=si.value; render(); });

      body.querySelectorAll('[data-ocat]').forEach(function(el){
        el.addEventListener('click', function(){ _cat=el.getAttribute('data-ocat'); render(); });
      });
      body.querySelectorAll('[data-oToggle]').forEach(function(el){
        el.addEventListener('click', function(){
          var oid = el.getAttribute('data-oToggle');
          _open[oid] = !_open[oid];
          render();
        });
      });
    }

    window.addEventListener('lens:change', function () { _cat = 'ALL'; _open = {}; render(); });

    render();
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
      el.style.zIndex = _nextZ();
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
    var _period = 'day';   /* active sort period: day | wtd | ytd | y1 */
    var _viewAll = false;  /* leaders/laggards vs full table */

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

    /* ── Bloomberg summary strip ─────────────────────────────── */
    function buildSummaryBar(rows) {
      var fld = _period;
      var up = 0, dn = 0, flat = 0, best = null, worst = null;
      rows.forEach(function(r) {
        var v = r[fld];
        if (v === null || v === undefined) return;
        if (v > 0.001) up++;
        else if (v < -0.001) dn++;
        else flat++;
        if (best === null || v > best.v)  best  = {v: v, n: r.n};
        if (worst === null || v < worst.v) worst = {v: v, n: r.n};
      });
      function fmtP(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
      function shortN(n) { return (n || '').replace(/\(.*?\)/g, '').trim().split(' ').slice(0, 2).join(' '); }
      return '<div class="mm-summary">' +
        '<span class="mm-sum-up">↑' + up + '</span>' +
        '<span class="mm-sum-dn">↓' + dn + '</span>' +
        (flat ? '<span class="mm-sum-flat">—' + flat + '</span>' : '') +
        (best  ? '<span class="mm-sum-div">|</span><span class="mm-sum-best">▲ ' + escH(shortN(best.n)) + ' ' + escH(fmtP(best.v)) + '</span>' : '') +
        (worst ? '<span class="mm-sum-div">|</span><span class="mm-sum-worst">▼ ' + escH(shortN(worst.n)) + ' ' + escH(fmtP(worst.v)) + '</span>' : '') +
      '</div>';
    }

    /* ── Bloomberg Leaders / Laggards panels ─────────────────── */
    function buildLeadLag(rows) {
      var fld = _period;
      var q = filterQ.toLowerCase();
      var pool = rows.filter(function(r) {
        return (!q || r.n.toLowerCase().indexOf(q) !== -1 || (r.cat||'').toLowerCase().indexOf(q) !== -1) &&
               r[fld] !== null && r[fld] !== undefined;
      });
      pool.sort(function(a, b) { return b[fld] - a[fld]; });
      var leaders  = pool.slice(0, 10);
      var laggards = pool.slice(-10).reverse();

      var pLbl = {day:'DAY %', wtd:'WTD %', ytd:'YTD %', y1:'1Y %'}[_period] || _period.toUpperCase();

      function panelRows(items) {
        return items.map(function(r, i) {
          var val = r[fld];
          var col = val > 0.001 ? '#3DAA6A' : val < -0.001 ? '#D14040' : '#888';
          var sign = val >= 0 ? '+' : '';
          var dir = r.day > 0.001 ? '<span class="mm-dir mm-dir-up">▲</span>'
                  : r.day < -0.001 ? '<span class="mm-dir mm-dir-dn">▼</span>'
                  : '<span class="mm-dir mm-dir-n">■</span>';
          var nm = (r.n || '').replace(/\(.*?\)/g, '').trim();
          if (nm.length > 20) nm = nm.slice(0, 19) + '…';
          return '<tr class="mm-tr mm-btr" data-series="' + escH(r.chartId || r.s) + '" data-sid="' + escH(r.s) + '" data-name="' + escH(r.n) + '">' +
            '<td class="mm-bnum">' + (i + 1) + '</td>' +
            '<td class="mm-bname">' + dir + escH(nm) + (r.isLive ? '<span class="mm-live-row-dot">●</span>' : '') + '</td>' +
            '<td class="mm-blast">' + fmtLast(r) + '</td>' +
            '<td class="mm-bchg" style="color:' + col + ';">' + sign + val.toFixed(2) + '%</td>' +
          '</tr>';
        }).join('');
      }

      function panel(items, isLead) {
        var hdrCls = 'mm-panel-hdr ' + (isLead ? 'mm-panel-hdr-lead' : 'mm-panel-hdr-lag');
        var arrow  = isLead ? '<span style="color:#3DAA6A;">▲</span>' : '<span style="color:#D14040;">▼</span>';
        var label  = isLead ? 'LEADERS' : 'LAGGARDS';
        return '<div class="mm-panel">' +
          '<div class="' + hdrCls + '">' +
            '<span style="display:flex;align-items:center;gap:5px;">' + arrow + ' <span>' + label + '</span></span>' +
            '<span class="mm-panel-period">' + pLbl + '</span>' +
          '</div>' +
          '<div style="overflow-y:auto;flex:1;">' +
          '<table class="mm-btable">' +
            '<thead><tr>' +
              '<th class="mm-bth" style="width:22px;">#</th>' +
              '<th class="mm-bth mm-bth-l">INSTRUMENT</th>' +
              '<th class="mm-bth">LAST</th>' +
              '<th class="mm-bth">' + pLbl + '</th>' +
            '</tr></thead>' +
            '<tbody>' + panelRows(items) + '</tbody>' +
          '</table>' +
          '</div>' +
        '</div>';
      }

      return '<div class="mm-panels">' +
        panel(leaders, true) +
        '<div class="mm-panel-sep"></div>' +
        panel(laggards, false) +
      '</div>';
    }

    function render(rows) {
      lastData = rows;

      var PERIODS = [{k:'day',l:'DAY'},{k:'wtd',l:'WTD'},{k:'ytd',l:'YTD'},{k:'y1',l:'1Y'}];
      var periodTabs = PERIODS.map(function(p) {
        var a = _period === p.k;
        return '<button class="mm-period-btn' + (a ? ' mm-period-active' : '') + '" id="mm-per-' + p.k + '-' + id + '">' + p.l + '</button>';
      }).join('');

      var twContent = _viewAll ? buildTable(rows) : buildLeadLag(rows);
      var footNote  = editMode ? 'EDIT MODE: ✕ TO REMOVE · SEARCH TO ADD'
                    : _viewAll ? 'ALL SERIES · CLICK COLUMN HEADER TO SORT · CLICK ROW FOR CHART'
                    : 'LEADERS / LAGGARDS · SELECT PERIOD · CLICK ROW FOR CHART';

      body.innerHTML =
        '<div class="mm-wrap">' +
          '<div class="mm-topbar">' +
            '<div class="mm-period-tabs">' + periodTabs + '</div>' +
            buildSummaryBar(rows) +
            '<div style="display:flex;align-items:center;gap:6px;margin-left:auto;">' +
              '<input class="mm-search" id="mm-search-' + id + '" placeholder="FILTER…" value="' + escH(filterQ) + '">' +
              '<span class="mm-live-dot">● LIVE</span>' +
              '<span class="mm-ts-lbl" id="mm-ts-' + id + '">0s AGO</span>' +
              '<button class="mm-edit-btn" id="mm-view-' + id + '">' + (_viewAll ? 'SPLIT' : 'ALL') + '</button>' +
              '<button class="mm-edit-btn" id="mm-edit-' + id + '">' + (editMode ? 'DONE' : 'EDIT') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="mm-table-wrap" id="mm-tw-' + id + '">' + twContent + '</div>' +
          (editMode ? buildAddPanel() : '') +
          '<div class="mm-foot">FRED · FX VIA ER-API · AUTO-REFRESH 60s · ' + footNote + '</div>' +
        '</div>';

      /* Period tabs */
      PERIODS.forEach(function(p) {
        var btn = body.querySelector('#mm-per-' + p.k + '-' + id);
        if (!btn) return;
        btn.addEventListener('click', function() { _period = p.k; render(lastData); });
      });

      /* Filter */
      body.querySelector('#mm-search-' + id).addEventListener('input', function(e) {
        filterQ = e.target.value;
        var tw = body.querySelector('#mm-tw-' + id);
        if (tw) tw.innerHTML = _viewAll ? buildTable(lastData) : buildLeadLag(lastData);
        wireTable();
      });

      /* All / Split toggle */
      body.querySelector('#mm-view-' + id).addEventListener('click', function() {
        _viewAll = !_viewAll;
        render(lastData);
      });

      /* Edit */
      body.querySelector('#mm-edit-' + id).addEventListener('click', function() {
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

      /* row click → chart (full table .mm-tr and split view .mm-btr) */
      body.querySelectorAll('.mm-tr[data-series], .mm-btr[data-series]').forEach(function(tr) {
        tr.addEventListener('click', function() {
          if (editMode) return;
          if (!window.createGenericPopout) return;
          var series = tr.dataset.series;
          var name   = tr.dataset.name;
          window.createGenericPopout(name + ' · CHART', '▦', function(popBody) {
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
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;background:#000;';
    var lastRows = null;

    /* Top 5 holdings for each SPDR sector ETF — hardcoded (holdings change infrequently) */
    var SECTOR_HOLDINGS = {
      XLK: ['AAPL · Apple 22.6%','MSFT · Microsoft 21.8%','NVDA · Nvidia 7.2%','AVGO · Broadcom 4.5%','ORCL · Oracle 2.1%'],
      XLF: ['BRK.B · Berkshire 13.8%','JPM · JPMorgan 11.2%','V · Visa 8.4%','MA · Mastercard 6.1%','BAC · Bank of America 3.9%'],
      XLV: ['LLY · Eli Lilly 12.4%','UNH · UnitedHealth 8.9%','JNJ · J&J 7.1%','ABBV · AbbVie 6.8%','MRK · Merck 5.6%'],
      XLE: ['XOM · ExxonMobil 23.1%','CVX · Chevron 15.8%','COP · ConocoPhillips 6.7%','EOG · EOG Resources 4.4%','SLB · Schlumberger 3.2%'],
      XLY: ['AMZN · Amazon 24.3%','TSLA · Tesla 16.8%','HD · Home Depot 9.7%','MCD · McDonald\'s 4.9%','NKE · Nike 2.8%'],
      XLC: ['META · Meta 22.6%','GOOGL · Alphabet A 10.4%','GOOG · Alphabet C 9.3%','NFLX · Netflix 5.3%','TMUS · T-Mobile 4.9%'],
      XLI: ['GE · GE Aerospace 5.7%','RTX · RTX Corp 5.1%','CAT · Caterpillar 4.8%','HON · Honeywell 4.7%','UPS · United Parcel 3.3%'],
      XLP: ['PG · Procter & Gamble 14.6%','COST · Costco 10.3%','KO · Coca-Cola 10.1%','PEP · PepsiCo 8.4%','WMT · Walmart 7.9%'],
      XLU: ['NEE · NextEra Energy 14.9%','SO · Southern Co 6.9%','DUK · Duke Energy 6.7%','CEG · Constellation 5.8%','D · Dominion Energy 4.2%'],
      XLRE: ['PLD · Prologis 10.4%','AMT · American Tower 7.1%','EQIX · Equinix 6.8%','WELL · Welltower 5.9%','SPG · Simon Property 5.5%'],
      XLB: ['LIN · Linde 19.3%','APD · Air Products 7.2%','SHW · Sherwin-Williams 6.9%','ECL · Ecolab 5.4%','FCX · Freeport 4.8%'],
    };

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

    /* Drill-down panel shown when user clicks a tile */
    function showDrillDown(etf, sectorName, dp) {
      var holdings = SECTOR_HOLDINGS[etf] || [];
      var col = dp === null ? 'rgba(255,255,255,0.5)' : dp >= 0 ? '#3DAA6A' : '#D14040';
      var pct = dp !== null ? (dp >= 0 ? '+' : '') + parseFloat(dp).toFixed(2) + '%' : '—';
      /* Remove any existing drill-down */
      var existing = body.querySelector('.sh-drill');
      if (existing) { existing.remove(); return; }
      var panel = document.createElement('div');
      panel.className = 'sh-drill';
      panel.style.cssText = 'position:absolute;bottom:28px;left:0;right:0;background:#050505;border-top:1px solid #1a1a1a;padding:12px 14px;z-index:10;';
      panel.innerHTML =
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">' +
          '<span style="font-size:11px;letter-spacing:.08em;color:#fff;font-weight:700;">' + escH(sectorName) + '</span>' +
          '<span style="font-size:11px;font-weight:700;color:' + col + ';">' + pct + '</span>' +
          '<button style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:11px;padding:0 0 0 12px;" class="sh-drill-close">✕</button>' +
        '</div>' +
        '<div style="font-size:7px;letter-spacing:.16em;color:rgba(255,255,255,0.3);margin-bottom:6px;">TOP HOLDINGS · ' + escH(etf) + ' · SPDR</div>' +
        (holdings.length ?
          holdings.map(function(h) {
            var parts = h.split(' · ');
            return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #0f0f0f;font-size:9px;">' +
              '<span style="color:rgba(255,255,255,0.5);letter-spacing:.06em;min-width:52px;">' + escH(parts[0]) + '</span>' +
              '<span style="color:#fff;flex:1;padding:0 6px;">' + escH(parts[1] || '') + '</span>' +
              '<span style="color:rgba(255,255,255,0.4);">' + escH(parts[2] || '') + '</span>' +
            '</div>';
          }).join('') :
          '<div style="font-size:9px;color:rgba(255,255,255,0.3);">Holdings data not available</div>'
        );
      panel.querySelector('.sh-drill-close').addEventListener('click', function(e) {
        e.stopPropagation(); panel.remove();
      });
      /* Make parent relative so absolute positioning works */
      var wrap = body.querySelector('.sh-heatmap');
      if (wrap && wrap.parentElement) {
        wrap.parentElement.style.position = 'relative';
        wrap.parentElement.appendChild(panel);
      } else { body.appendChild(panel); }
    }

    function wireTileClicks() {
      body.querySelectorAll('.sh-tile').forEach(function(tile) {
        tile.style.cursor = 'pointer';
        tile.addEventListener('click', function() {
          var etf = tile.dataset.etf;
          var sectorName = (tile.querySelector('.sh-sector') || {}).textContent || etf;
          var row = (lastRows || []).find(function(r){ return r.etf === etf; });
          showDrillDown(etf, sectorName, row ? row.dp : null);
        });
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
            wireTileClicks();
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
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;background:#000;';
    var STORE = 'tbt-watchlist-v1';
    var tickers = JSON.parse(localStorage.getItem(STORE) || '[]');
    function save() { localStorage.setItem(STORE, JSON.stringify(tickers)); }

    /* Pre-built category groups */
    var WL_PRESETS = {
      'GOLD': ['GLD','IAU','GC=F','GDX','GDXJ','SGOL'],
      'INDICES': ['^GSPC','^FTSE','^IXIC','^DJI','^VIX','EWU'],
      'MACRO': ['TLT','DX-Y.NYB','BIL','^TNX','TIP','UUP'],
      'COMMODITIES': ['GC=F','SI=F','CL=F','BZ=F','HG=F','NG=F'],
      'FX': ['GBPUSD=X','EURUSD=X','USDJPY=X','USDCHF=X','AUDUSD=X','USDCNH=X'],
      'SPIRITS': ['DEO','BF.B','RIO','PRNDY','ABTXF','MGPI']
    };

    /* Friendly name map */
    var WL_NAMES = {
      'GLD':'Gold ETF (GLD)','IAU':'iShares Gold','GC=F':'Gold Futures','GDX':'Gold Miners','GDXJ':'Jr Gold Miners','SGOL':'Aberdeen Gold',
      '^GSPC':'S&P 500','^FTSE':'FTSE 100','^IXIC':'Nasdaq','^DJI':'Dow Jones','^VIX':'VIX Fear','EWU':'UK Stocks ETF',
      'TLT':'20Y T-Bond ETF','DX-Y.NYB':'US Dollar (DXY)','BIL':'T-Bill ETF','^TNX':'10Y Treasury','TIP':'TIPS ETF','UUP':'Dollar Bull ETF',
      'GC=F':'Gold Futures','SI=F':'Silver Futures','CL=F':'WTI Crude','BZ=F':'Brent Crude','HG=F':'Copper','NG=F':'Nat Gas',
      'GBPUSD=X':'GBP/USD','EURUSD=X':'EUR/USD','USDJPY=X':'USD/JPY','USDCHF=X':'USD/CHF','AUDUSD=X':'AUD/USD','USDCNH=X':'USD/CNH',
      'DEO':'Diageo','BF.B':'Brown-Forman','RIO':'Rio Tinto','PRNDY':'Pernod Ricard','ABTXF':'Amber Beverage','MGPI':'MGP Ingredients'
    };

    function draw(quotes) {
      var listHtml = quotes.length ? quotes.map(function(q) {
        var name = WL_NAMES[q.sym] || q.sym;
        var price = q.c ? (q.c < 10 ? q.c.toFixed(4) : q.c < 100 ? q.c.toFixed(3) : q.c.toFixed(2)) : '—';
        var chg = q.dp !== null ? (q.dp >= 0 ? '+' : '') + q.dp.toFixed(2) + '%' : '—';
        var cls = q.dp === null ? '' : q.dp >= 0 ? 'wl-pos' : 'wl-neg';
        return '<div class="wl-row">' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="wl-sym">' + escH(q.sym) + '</div>' +
            '<div style="font-size:7px;letter-spacing:.06em;color:rgba(255,255,255,0.35);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escH(name) + '</div>' +
          '</div>' +
          '<span class="wl-price">' + price + '</span>' +
          '<span class="wl-chg ' + cls + '">' + chg + '</span>' +
          '<button class="wl-del" data-sym="' + escH(q.sym) + '">✕</button>' +
          '</div>';
      }).join('') : '';

      /* Quick-add presets — always visible */
      var presetHtml = '<div style="padding:8px 10px 4px;border-bottom:1px solid #111;flex-shrink:0;">' +
        '<div style="font-size:7px;letter-spacing:.18em;color:rgba(255,255,255,0.3);margin-bottom:6px;">QUICK ADD</div>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
        Object.keys(WL_PRESETS).map(function(cat) {
          return '<button class="wl-preset-btn" data-cat="' + cat + '" style="background:#000;border:1px solid #1e1e1e;color:rgba(255,255,255,0.55);font-family:var(--font);font-size:7px;letter-spacing:.12em;padding:3px 8px;cursor:pointer;">' + cat + '</button>';
        }).join('') +
        '</div></div>';

      var emptyHint = !quotes.length ?
        '<div class="wl-empty">NO TICKERS YET<br><span style="font-size:7px;color:rgba(255,255,255,0.2);">USE QUICK ADD OR TYPE A SYMBOL ABOVE</span></div>' : '';

      var ts = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      body.innerHTML =
        '<div class="wl-add-bar">' +
          '<input class="wl-input" id="' + id + '-inp" placeholder="ADD TICKER  e.g. AAPL  ^GSPC  GC=F" maxlength="14"/>' +
          '<button class="wl-add-btn" id="' + id + '-add">＋</button>' +
        '</div>' +
        presetHtml +
        '<div class="wl-list">' + (listHtml || emptyHint) + '</div>' +
        '<div class="wl-footer">LIVE PRICES · YAHOO FINANCE · ' + ts + '</div>';

      /* Preset button clicks — add whole group */
      body.querySelectorAll('.wl-preset-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var group = WL_PRESETS[btn.dataset.cat] || [];
          var added = false;
          group.forEach(function(sym) {
            if (tickers.indexOf(sym) === -1) { tickers.push(sym); added = true; }
          });
          if (added) { save(); fetchAndRender(); }
        });
      });

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
        var sym = (inp.value || '').trim().toUpperCase().replace(/[^A-Z0-9.=\-\^]/g,'');
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

  /* ── LIVE TV WIDGET ─────────────────────────────────────────── */
  function renderLiveTVWidget(id, body) {
    var TV_CHANNELS = [
      { key:'france24',  label:'FRANCE 24',   cid:'UCQfwfsi5VrQ8yKZ-UWmAEFg', tag:'INT\'L',   sub:'English · 24/7 live' },
      { key:'euronews',  label:'EURONEWS',    cid:'UCW5DxBMHwDkWBxVv3MhO27A', tag:'EUROPE',   sub:'English · 24/7 live' },
      { key:'wion',      label:'WION',        cid:'UCw0PBPuKMmEYxORQ5sPiQEA', tag:'GLOBAL',   sub:'English · 24/7 live' },
      { key:'dw',        label:'DW NEWS',     cid:'UCknLrEdhRCp1aegoMqRaCZg', tag:'EUROPE',   sub:'English · 24/7 live' },
      { key:'cnbc',      label:'CNBC',        cid:'UCvJJ_dzjViJCoLf5uKUTwoA', tag:'MARKETS',  sub:'English · business live' },
      { key:'bloomberg', label:'BLOOMBERG TV',cid:'UCIALMKvObZNtJ6AmdCLP7Lg', tag:'MARKETS',  sub:'May require subscription' },
    ];
    var _ch = 'france24';

    function render() {
      var ch = TV_CHANNELS.find(function(c){ return c.key === _ch; }) || TV_CHANNELS[0];
      var A = '#E97132';
      /* YouTube dropped live_stream?channel= — use the nocookie embed which is more permissive */
      var embedSrc = 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + ch.cid + '&autoplay=1&mute=1&rel=0&modestbranding=1&enablejsapi=1';
      body.innerHTML =
        '<div style="display:flex;flex-direction:column;height:100%;overflow:hidden;background:#000;">' +
          '<div style="display:flex;gap:0;flex-shrink:0;border-bottom:1px solid #1a1a1a;background:#000;overflow-x:auto;scrollbar-width:none;">' +
            TV_CHANNELS.map(function(c) {
              var act = c.key === _ch;
              return '<button id="tv-ch-' + c.key + '-' + id + '" style="' +
                'flex-shrink:0;padding:7px 12px;font-size:8px;letter-spacing:.1em;font-family:Consolas,monospace;' +
                'border:none;border-bottom:2px solid ' + (act ? A : 'transparent') + ';' +
                'background:transparent;color:' + (act ? A : '#ffffff') + ';' +
                'cursor:pointer;white-space:nowrap;">' +
                c.label +
                '<span style="font-size:6.5px;color:' + (act ? A : 'rgba(255,255,255,0.45)') + ';margin-left:6px;">' + c.tag + '</span>' +
              '</button>';
            }).join('') +
          '</div>' +
          '<div style="flex:1;position:relative;background:#000;min-height:0;overflow:hidden;">' +
            '<iframe src="' + embedSrc + '" ' +
              'style="width:100%;height:100%;border:none;display:block;" ' +
              'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
              'referrerpolicy="no-referrer" allowfullscreen></iframe>' +
          '</div>' +
          '<div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:#050505;border-top:1px solid #1a1a1a;">' +
            '<div style="font-size:6px;letter-spacing:.1em;color:' + A + ';">' + ch.label + '  <span style="color:rgba(255,255,255,0.25);">·  ' + ch.sub.toUpperCase() + '</span></div>' +
            '<div style="display:flex;align-items:center;gap:5px;"><div style="width:5px;height:5px;border-radius:50%;background:' + A + ';animation:blink 1.4s step-start infinite;"></div><div style="font-size:6px;letter-spacing:.12em;color:rgba(255,255,255,0.3);">LIVE</div></div>' +
          '</div>' +
        '</div>';

      TV_CHANNELS.forEach(function(c) {
        var btn = body.querySelector('#tv-ch-' + c.key + '-' + id);
        if (btn) btn.addEventListener('click', function() { _ch = c.key; render(); });
      });
    }

    render();
  }

  /* ── GLOBAL MAP ──────────────────────────────────────────────── */
  function renderGlobalMap(id, body) {
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;position:relative;';
    var _gmView = 'map'; /* 'map' | 'catalyst' */
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
      ZA:{lbl:'S.AFRICAN', note:"Bain\'s · Three Ships"},
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

    /* ── Catalyst Watch (self-contained within Global Map) ── */
    var _catLive = null;
    var A = '#E97132', GRN = '#3DAA6A', RED = '#D14040', BLU = '#4A90D9', PRP = '#9B6FD4', REC = '#FFD700';

    function miniSparkGM(arr, col, w, h) {
      if (!arr || arr.length < 2) return '';
      var mn = Math.min.apply(null, arr), mx = Math.max.apply(null, arr);
      var rng = mx - mn || 1;
      var pts = arr.map(function(v, i) {
        return (i / (arr.length - 1) * w).toFixed(1) + ',' + ((1 - (v - mn) / rng) * h).toFixed(1);
      }).join(' ');
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="overflow:visible;"><polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.2"/></svg>';
    }

    function catRowGM(label, sub, val, chgStr, chgPos, sparkArr, sparkCol, signal) {
      var sc = signal === 'BULLISH' ? GRN : signal === 'BEARISH' ? RED : signal === 'WATCH' ? PRP : signal === 'ELEVATED' ? A : 'rgba(255,255,255,0.28)';
      var sb = signal === 'BULLISH' ? 'rgba(61,170,106,.08)' : signal === 'BEARISH' ? 'rgba(209,64,64,.08)' : signal === 'WATCH' ? 'rgba(155,111,212,.08)' : signal === 'ELEVATED' ? 'rgba(233,113,50,.08)' : 'rgba(255,255,255,.04)';
      return '<div style="display:grid;grid-template-columns:1fr 72px 40px 58px 66px;align-items:center;padding:8px 10px;border-bottom:1px solid #0f0f0f;">' +
        '<div>' +
          '<div style="font-size:7.5px;letter-spacing:.08em;color:#fff;">' + label + '</div>' +
          (sub ? '<div style="font-size:5.5px;color:rgba(255,255,255,0.26);margin-top:1.5px;letter-spacing:.04em;">' + sub + '</div>' : '') +
        '</div>' +
        '<div style="font-size:8px;font-weight:600;color:#fff;text-align:right;font-variant-numeric:tabular-nums;">' + val + '</div>' +
        '<div style="font-size:6.5px;font-weight:600;color:' + (chgPos ? GRN : RED) + ';text-align:right;">' + chgStr + '</div>' +
        '<div style="text-align:center;padding:0 4px;">' + miniSparkGM(sparkArr, sparkCol, 50, 14) + '</div>' +
        '<div style="text-align:right;"><span style="font-size:5.5px;letter-spacing:.12em;color:' + sc + ';background:' + sb + ';border:1px solid ' + sc + ';padding:2px 6px;display:inline-block;">' + signal + '</span></div>' +
      '</div>';
    }

    function renderGMCatalyst(panel) {
      if (!_catLive) {
        _catLive = 'loading';
        fetch('/.netlify/functions/catalyst-watch')
          .then(function(r){ return r.json(); })
          .then(function(d){ _catLive = d; renderGMCatalyst(panel); })
          .catch(function(){ _catLive = 'error'; });
      }
      var live = (_catLive && _catLive !== 'loading' && _catLive !== 'error') ? _catLive : null;
      var dxy  = (live && live.dxy)    ? live.dxy    : { value:98.4, chgPct:-0.4, spark:[101.2,100.8,100.4,100.0,99.7,99.4,99.1,98.9,98.7,98.5,98.4,98.3,98.4,98.4,98.4] };
      var tips = (live && live.tips10) ? live.tips10 : { value:1.84, chg:-0.03,   spark:[2.10,2.06,2.03,2.00,1.97,1.94,1.92,1.90,1.88,1.87,1.86,1.85,1.85,1.84,1.84] };
      var bdi  = (live && live.bdi)    ? live.bdi    : { value:1847, chgPct:2.3,  spark:[1320,1360,1280,1350,1420,1480,1540,1590,1640,1700,1750,1790,1820,1840,1847] };
      var dxyS = (dxy.chgPct < 0 && dxy.value < 100) ? 'BULLISH' : (dxy.value > 102 ? 'BEARISH' : 'NEUTRAL');
      var tipS = (tips.value < 2.0 && tips.chg <= 0) ? 'BULLISH' : (tips.value > 2.5 ? 'BEARISH' : 'ELEVATED');
      var bdiS = bdi.value < 1200 ? 'WATCH' : 'NEUTRAL';
      var html = '<div style="padding:12px 14px 16px;overflow-y:auto;height:100%;box-sizing:border-box;background:#000;">';
      html += '<div style="font-size:7px;letter-spacing:.2em;color:' + A + ';margin-bottom:12px;border-bottom:1px solid #1a1a1a;padding-bottom:8px;">CATALYST WATCH  ·  ' +
        (live ? '<span style="color:' + GRN + ';">LIVE DATA</span>' : (_catLive === 'loading' ? '<span style="color:' + A + ';">FETCHING…</span>' : 'ESTIMATES')) + '</div>';
      html += '<div style="font-size:6.5px;letter-spacing:.14em;color:rgba(255,255,255,0.4);margin-bottom:6px;padding-left:2px;">GOLD PRICE DRIVERS</div>';
      html += '<div style="border:1px solid #1a1a1a;margin-bottom:12px;">';
      html += catRowGM('DXY US DOLLAR INDEX', 'Inverse — weaker dollar = higher gold',
        dxy.value.toFixed(1), (dxy.chgPct >= 0 ? '+' : '') + dxy.chgPct.toFixed(2) + '%', dxy.chgPct < 0, dxy.spark, BLU, dxyS);
      html += catRowGM('10YR REAL YIELD · TIPS', 'Below 2% broadly supportive for gold',
        tips.value.toFixed(2) + '%', (tips.chg >= 0 ? '+' : '') + tips.chg.toFixed(2) + 'pp', tips.chg < 0, tips.spark, PRP, tipS);
      html += catRowGM('CENTRAL BANK BUYING', 'WGC · H1 2026 — 3rd consecutive record-pace year',
        '345t', 'H1 YTD', true, [220,240,255,270,285,295,310,320,330,338,342,345,345,345,345], GRN, 'BULLISH');
      html += catRowGM('ETF FLOW MOMENTUM', 'WGC · institutional re-accumulation phase',
        '+292t YoY', '↑ YoY', true, [10,15,20,28,35,42,38,45,52,58,62,68,70,72,74], GRN, 'BULLISH');
      html += catRowGM('GEOPOLITICAL RISK', 'Active conflicts + EM de-dollarisation',
        'ELEVATED', '↑ Active', true, [62,65,68,70,72,74,76,74,77,79,81,80,83,82,84], RED, 'WATCH');
      html += '</div>';
      html += '<div style="font-size:6.5px;letter-spacing:.14em;color:rgba(255,255,255,0.4);margin-bottom:6px;padding-left:2px;">SHIPPING INTELLIGENCE</div>';
      html += '<div style="border:1px solid #1a1a1a;margin-bottom:12px;">';
      html += catRowGM('BALTIC DRY INDEX · BDI', 'Dry bulk — falling BDI → demand slowdown → gold bullish',
        bdi.value.toLocaleString(), (bdi.chgPct >= 0 ? '+' : '') + bdi.chgPct.toFixed(1) + '%', bdi.chgPct < 0, bdi.spark, BLU, bdiS);
      html += catRowGM('CAPESIZE 5TC · $/DAY', 'Iron ore & coal — China demand proxy',
        '$21,400', '+4.1%', true, [15200,15800,16400,17200,18000,18800,19400,20100,20600,21000,21200,21300,21350,21400,21400], BLU, 'ELEVATED');
      html += catRowGM('VLCC TD3C · $/DAY', 'Crude supertanker — Middle East→Asia',
        '$48,200', '+6.8%', true, [38000,36000,34000,35000,38000,40000,43000,44500,46000,47000,48000,47500,48200,48000,48200], A, 'ELEVATED');
      html += '</div>';
      html += '<div style="padding:10px 12px;background:#060606;border:1px solid #1a1a1a;border-left:3px solid ' + GRN + ';font-size:7px;line-height:1.8;color:rgba(255,255,255,0.55);">' +
        'All six macro drivers simultaneously aligned for gold: weakening dollar, declining real yields, structural CB accumulation, accelerating ETF inflows, elevated geopolitical risk, and freight disruption. This configuration has occurred in fewer than 12% of months since 1971.' +
      '</div>';
      html += '</div>';
      panel.innerHTML = html;
    }

    /* ── Tab bar switcher ── */
    function buildGMTabBar() {
      var bar = document.createElement('div');
      bar.id = 'gm-tabbar-' + id;
      bar.style.cssText = 'display:flex;border-bottom:1px solid #1e1e1e;flex-shrink:0;background:#000;';
      function makeTab(label, view) {
        var act = _gmView === view;
        var btn = document.createElement('button');
        btn.style.cssText = 'padding:7px 12px;font-size:6.5px;letter-spacing:.14em;font-family:Consolas,monospace;border:none;border-bottom:2px solid ' + (act ? A : 'transparent') + ';background:transparent;color:' + (act ? A : 'rgba(255,255,255,0.38)') + ';cursor:pointer;';
        btn.textContent = label;
        btn.addEventListener('click', function() {
          _gmView = view;
          var mapWrap  = document.getElementById('gm-globe-wrap-' + id);
          var catPanel = document.getElementById('gm-cat-panel-' + id);
          if (mapWrap)  mapWrap.style.display  = view === 'map'      ? 'contents' : 'none';
          if (catPanel) {
            catPanel.style.display = view === 'catalyst' ? 'flex' : 'none';
            if (view === 'catalyst') renderGMCatalyst(catPanel);
          }
          /* update tab highlight */
          var allBtns = bar.querySelectorAll('button');
          allBtns.forEach(function(b) {
            var isAct = b === btn;
            b.style.borderBottomColor = isAct ? A : 'transparent';
            b.style.color = isAct ? A : 'rgba(255,255,255,0.38)';
          });
        });
        return btn;
      }
      bar.appendChild(makeTab('GLOBAL MAP', 'map'));
      bar.appendChild(makeTab('CATALYST WATCH', 'catalyst'));
      return bar;
    }

    function init() {
      /* Render tab bar immediately */
      body.innerHTML = '';
      body.appendChild(buildGMTabBar());

      /* Map wrapper (holds modes/subs/globe) */
      var mapWrap = document.createElement('div');
      mapWrap.id = 'gm-globe-wrap-' + id;
      mapWrap.style.cssText = 'display:contents;';
      mapWrap.innerHTML = '<div class="gm-loading" style="flex:1;display:flex;align-items:center;justify-content:center;">LOADING 3D GLOBE…</div>';
      body.appendChild(mapWrap);

      /* Catalyst panel (hidden initially) */
      var catPanel = document.createElement('div');
      catPanel.id = 'gm-cat-panel-' + id;
      catPanel.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';
      body.appendChild(catPanel);

      loadScript('https://unpkg.com/globe.gl/dist/globe.gl.min.js', function(err) {
        if(err){ mapWrap.innerHTML='<div class="gm-loading">GLOBE ENGINE FAILED</div>'; return; }
        loadScript('https://unpkg.com/topojson-client@3/dist/topojson-client.min.js', function(err2) {
          if(err2){ mapWrap.innerHTML='<div class="gm-loading">TOPO ENGINE FAILED</div>'; return; }
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
            mapWrap.innerHTML =
              '<div id="gm-modes-'+id+'" class="gm-controls"></div>'+
              '<div id="gm-subs-'+id+'" class="gm-sub-bar"></div>'+
              '<div id="gm-wrap-'+id+'" class="gm-svg-wrap" style="flex:1;overflow:hidden;background:#00010a;position:relative;"></div>'+
              '<div class="gm-bottom"><span id="gm-foot-'+id+'" class="gm-footer"></span></div>';
            rebuildControls();
            buildGlobe(document.getElementById('gm-wrap-'+id));
          }).catch(function(){ mapWrap.innerHTML='<div class="gm-loading">GLOBE DATA UNAVAILABLE</div>'; });
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
        why: "Confirms whether the overall consumer environment is expanding or contracting. A broker\'s first sanity check before pitching any discretionary asset.",
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
      /* MACRO MONITOR instruments ─────────────────────────── */
      { s:'GOLDAMGBD228NLBM',  l:'GOLD (USD/oz)',      src:'macro', cat:'MACRO MONITOR' },
      { s:'DCOILWTICO',        l:'WTI OIL (USD/bbl)',  src:'macro', cat:'MACRO MONITOR' },
      { s:'SP500',             l:'S&P 500',            src:'macro', cat:'MACRO MONITOR' },
      { s:'DEXUSUK',           l:'GBP/USD',            src:'macro', cat:'MACRO MONITOR' },
      { s:'DEXUSEU',           l:'EUR/USD',            src:'macro', cat:'MACRO MONITOR' },
      { s:'EURGBP',            l:'EUR/GBP',            src:'macro', cat:'MACRO MONITOR' },
      { s:'IRLTLT01GBM156N',   l:'UK 10Y GILT',        src:'macro', cat:'MACRO MONITOR' },
      { s:'IRSTCI01GBM156N',   l:'UK BASE RATE',       src:'macro', cat:'MACRO MONITOR' },
      { s:'CPALTT01GBM659N',   l:'UK CPI',             src:'macro', cat:'MACRO MONITOR' },
      { s:'GOLDPMGBD228NLBM',  l:'GOLD (GBP/oz)',      src:'macro', cat:'MACRO MONITOR' },
      /* FRED BUSINESS CYCLE ────────────────────────────────── */
      { s:'CFNAI',             l:'CFNAI ACTIVITY',     src:'fred',  cat:'FRED: CYCLE'    },
      { s:'T10Y2YM',           l:'YIELD CURVE',        src:'fred',  cat:'FRED: CYCLE'    },
      { s:'INDPRO',            l:'INDUSTRIAL PROD',    src:'fred',  cat:'FRED: CYCLE'    },
      { s:'A191RL1Q225SBEA',   l:'REAL GDP QoQ',       src:'fred',  cat:'FRED: CYCLE'    },
      { s:'CPIAUCSL',          l:'CPI ALL ITEMS',      src:'fred',  cat:'FRED: INFLATION' },
      { s:'PCEPILFE',          l:'CORE PCE',           src:'fred',  cat:'FRED: INFLATION' },
      { s:'WPSFD49207',        l:'PPI FINAL DEMAND',   src:'fred',  cat:'FRED: INFLATION' },
      { s:'M2SL',              l:'M2 MONEY SUPPLY',    src:'fred',  cat:'FRED: LIQUIDITY' },
      { s:'WALCL',             l:'FED BALANCE SHEET',  src:'fred',  cat:'FRED: LIQUIDITY' },
      { s:'BOGMBASE',          l:'MONETARY BASE',      src:'fred',  cat:'FRED: LIQUIDITY' },
      { s:'GS10',              l:'US 10Y TREASURY',    src:'fred',  cat:'FRED: RATES'     },
      { s:'GS2',               l:'US 2Y TREASURY',     src:'fred',  cat:'FRED: RATES'     },
      { s:'FEDFUNDS',          l:'FED FUNDS RATE',     src:'fred',  cat:'FRED: RATES'     },
      { s:'T10YIEM',           l:'10Y BREAKEVEN',      src:'fred',  cat:'FRED: RATES'     },
      { s:'BAMLH0A0HYM2',      l:'HY CREDIT SPREAD',  src:'fred',  cat:'FRED: RATES'     },
      { s:'PAYEMS',            l:'NONFARM PAYROLLS',   src:'fred',  cat:'FRED: LABOUR'    },
      { s:'UNRATE',            l:'UNEMPLOYMENT',       src:'fred',  cat:'FRED: LABOUR'    },
      { s:'CIVPART',           l:'LABOUR PART RATE',   src:'fred',  cat:'FRED: LABOUR'    },
      { s:'ICSA',              l:'INITIAL CLAIMS',     src:'fred',  cat:'FRED: LABOUR'    },
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
      var ovEntry = OVERLAYS.find(function(o){ return o.s === ovSeries; });
      if (ovEntry && ovEntry.src === 'fred') {
        fetch('/.netlify/functions/fred-data?series=' + ovSeries + '&limit=300')
          .then(function(r){ return r.json(); })
          .then(function(d){
            var obs = d && d.series && d.series[ovSeries] ? d.series[ovSeries].observations : null;
            if (!obs || !obs.length) return;
            onDone({ data: obs.map(function(p){ return { d: p.date, v: p.value }; }), unit: '%', label: ovEntry.l });
          })
          .catch(function(){});
      } else {
        fetch(cUrl(ovSeries, years))
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d.data && d.data.length) onDone(d); })
          .catch(function () {});
      }
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

      /* overlay picker HTML — grouped by category */
      var pickerHtml = '';
      if (picking) {
        var avail = OVERLAYS.filter(function (o) { return o.s !== series; });
        var cats = []; avail.forEach(function(o){ if (cats.indexOf(o.cat) === -1) cats.push(o.cat); });
        var grouped = cats.map(function(cat) {
          var items = avail.filter(function(o){ return o.cat === cat; });
          return '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 0;">' +
            '<span style="font-family:Consolas,monospace;font-size:6.5px;letter-spacing:.18em;color:rgba(233,113,50,0.7);width:100%;padding:2px 0 1px;">' + cat + '</span>' +
            items.map(function(o){
              var act = overlay && overlay.series === o.s;
              return '<button class="mpc-pick-btn' + (act ? ' mpc-pick-act' : '') + '" data-s="' + o.s + '" data-l="' + o.l + '">' + o.l + '</button>';
            }).join('') + '</div>';
        }).join('');
        pickerHtml = '<div class="mpc-picker" style="max-height:200px;overflow-y:auto;">' + grouped + '</div>';
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
            pitch: 'Here is what your client needs to understand. Their gilt holding yields 4.8% on paper. After 3.4% inflation, they are keeping fewer than 15 pence of every pound earned in real purchasing power. Over a decade of deeply negative real rates, the effect compounds into serious wealth erosion — the kind that does not appear on a statement until it is too late to act. Physical assets with genuine scarcity — gold, aged whisky casks, fine wine, direct property — hold no coupon and no maturity date. Unlike a gilt, they have no yield-to-inflation gap, no counterparty, and no government required to honour their value. Over fifty years they have broadly tracked and often exceeded the debasement of the currencies against which they are priced. The question worth asking your client is not whether they can afford to hold a physical asset. It is whether they can afford to continue holding the instrument that loses ground to inflation by design.',
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
            pitch: 'Consider the economy as a finite pool of real assets — land, commodities, productive businesses, infrastructure. Now imagine multiplying the number of claims (dollars) that can be used to acquire a share of those assets without adding new assets to the pool. Each claim buys a smaller fraction. The US money supply stood at under five trillion dollars in the year 2000. It stands at over twenty-one trillion today. Gold moved from two hundred and seventy dollars per ounce to over two thousand dollars in the same period. UK property, fine wine, and alternative assets with fixed supply showed comparable appreciation in sterling terms over the same horizon. That is not speculation. That is the price of a fixed-supply asset denominated in a currency that lost most of its purchasing power. For your clients holding cash or bonds — the instruments being diluted — physical assets with fixed supply represent the exit from the mechanism itself.',
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
            pitch: 'Sterling assets carry sterling risk — not only price risk, but currency risk, domestic political risk, and now explicit fiscal risk. Your clients concentrated in UK equities, UK property, and gilts are implicitly long the pound and long the UK government\'s ability to manage the most complex debt refinancing in modern British economic history. Physical assets with international pricing — gold held as a reserve asset by central banks across over one hundred and fifty countries, fine wine traded globally on Liv-ex, Scotch whisky with demand across one hundred and eighty export markets — have no maturity date, no refinancing requirement, and no government counterparty. For a UK-centric portfolio, they provide the one thing most clients do not realise they are missing: an allocation that is not correlated to the UK-specific risk premium, which is rising, not falling.',
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
            pitch: 'Gilts are not the safe haven they once were. September 2022 proved this at an institutional scale: a market that required emergency Bank of England intervention to prevent a cascade failure is not a risk-free store of capital — it is a market with a loaded spring mechanism that has been temporarily reset. The pension funds that came closest to collapse were holding the instrument most widely described as safe. Physical assets held in allocated, segregated storage — gold, whisky casks, fine wine — sit entirely outside this network of counterparty obligations. They cannot be posted as collateral. They cannot trigger a margin call. They have no issuer. For clients who hold gilts as their conservative allocation, the question worth posing is a simple one: safe from what, exactly?',
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
      ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
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
      return '<select class="wl-flt" data-flt="'+key+'" style="background:#000;border:1px solid #1e1e1e;color:#fff;font-family:var(--font);font-size:10px;letter-spacing:.08em;padding:5px 6px;cursor:pointer;max-width:110px;">' +
        items.map(function(v,i){ return '<option value="'+(i===0?'':v)+'">'+(i===0?v:v)+'</option>'; }).join('') +
      '</select>';
    }

    body.innerHTML =
      /* ── Filter bar ── */
      '<div style="display:flex;gap:5px;align-items:center;padding:7px 10px;border-bottom:1px solid #141414;flex-shrink:0;flex-wrap:wrap;background:#000;">' +
        '<span style="font-size:10px;letter-spacing:.14em;color:#fff;opacity:.45;margin-right:3px;">FILTER</span>' +
        ddSel(REGIONS, 'region') +
        ddSel(AGES,    'age') +
        ddSel(CASKS,   'cask') +
        '<input id="wl-dis-'+id+'" type="text" placeholder="DISTILLERY..." style="background:#000;border:1px solid #1e1e1e;color:#fff;font-family:var(--font);font-size:10px;letter-spacing:.08em;padding:5px 8px;outline:none;width:110px;" />' +
        '<div style="flex:1;"></div>' +
        '<select id="wl-cur-'+id+'" style="background:#000;border:1px solid #1e1e1e;color:#fff;font-family:var(--font);font-size:10px;padding:5px 5px;letter-spacing:.08em;cursor:pointer;">' +
          CURRENCIES.map(function(c){ return '<option value="'+c+'"'+(c==='GBP'?' selected':'')+'>'+c+'</option>'; }).join('') +
        '</select>' +
      '</div>' +
      /* ── Search bar + INDICES button ── */
      '<div style="display:flex;gap:5px;padding:7px 10px;border-bottom:1px solid #141414;flex-shrink:0;background:#000;">' +
        '<input id="wl-q-'+id+'" type="text" placeholder="▸  Search distillery, bottling, vintage..." '+
          'style="flex:1;background:#000;border:1px solid #1e1e1e;color:#fff;font-family:var(--font);font-size:11px;letter-spacing:.08em;padding:7px 10px;outline:none;" />' +
        '<button id="wl-idx-'+id+'" style="background:#000;border:1px solid #1e1e1e;color:#fff;font-family:var(--font);font-size:9px;letter-spacing:.12em;padding:7px 12px;cursor:pointer;white-space:nowrap;">INDICES</button>' +
        '<button id="wl-mon-'+id+'" style="background:#000;border:1px solid #1e1e1e;color:#fff;font-family:var(--font);font-size:9px;letter-spacing:.12em;padding:7px 12px;cursor:pointer;white-space:nowrap;">MONITOR</button>' +
      '</div>' +
      /* ── Split body ── */
      '<div style="flex:1;display:flex;overflow:hidden;background:#000;">' +
        /* Left: results list */
        '<div id="wl-list-'+id+'" style="width:260px;flex-shrink:0;overflow-y:auto;border-right:1px solid #141414;display:flex;flex-direction:column;background:#000;">' +
          /* Onboarding */
          '<div id="wl-guide-'+id+'" style="padding:14px 12px;">' +
            '<div style="font-size:10px;letter-spacing:.16em;color:#fff;margin-bottom:10px;">TRY THESE</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;">' +
              SUGGESTED.map(function(s){
                return '<button class="wl-sug" data-q="'+s.q+'" style="background:#000;border:1px solid #1a1a1a;color:#fff;font-family:var(--font);font-size:10px;letter-spacing:.08em;padding:7px 10px;cursor:pointer;text-align:left;">'+s.label+'</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        /* Right: detail panel */
        '<div id="wl-detail-'+id+'" style="flex:1;overflow-y:auto;background:#000;">' +
          '<div style="padding:28px 16px;text-align:center;">' +
            '<div style="font-size:8px;letter-spacing:.2em;color:#fff;opacity:.3;">SELECT A WHISKY</div>' +
            '<div style="font-size:7px;letter-spacing:.14em;color:#fff;opacity:.2;margin-top:6px;">USE FILTERS OR SEARCH TO FIND A BOTTLE</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      /* ── Footer ── */
      '<div style="padding:4px 10px;font-size:9px;letter-spacing:.12em;color:#fff;opacity:.4;border-top:1px solid #141414;flex-shrink:0;display:flex;justify-content:space-between;background:#000;">' +
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

      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

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

      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

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
      if (cached && cached._tbt_empty) return; /* endpoint failed previously, don\'t retry */
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

      ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);

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
          {country:'USA',          pct:18.7,val:'£933m',  yoy:+8,  flag:'🇺🇸'},
          {country:'France',       pct:8,  val:'£404m',   yoy:+5,  flag:'🇫🇷'},
          {country:'India',        pct:5.7,val:'£286m',   yoy:+22, flag:'🇮🇳'},
          {country:'Singapore',    pct:5.3,val:'£274m',   yoy:+14, flag:'🇸🇬'},
          {country:'Germany',      pct:3.5,val:'£177m',   yoy:+4,  flag:'🇩🇪'},
          {country:'UAE',          pct:3,  val:'£141m',   yoy:+12, flag:'🇦🇪'},
          {country:'Australia',    pct:3,  val:'£136m',   yoy:+7,  flag:'🇦🇺'},
          {country:'Taiwan',       pct:4.3,val:'£233m',   yoy:+18, flag:'🇹🇼'},
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
          {country:'China',        pct:28.5,val:'£65m',  yoy:+12, flag:'🇨🇳'},
          {country:'USA',          pct:24.1,val:'£55m',  yoy:+8,  flag:'🇺🇸'},
          {country:'France',       pct:9.2, val:'£21m',  yoy:+11, flag:'🇫🇷'},
          {country:'Singapore',    pct:9.2, val:'£21m',  yoy:+11, flag:'🇸🇬'},
          {country:'Germany',      pct:4.8, val:'£11m',  yoy:+10, flag:'🇩🇪'},
          {country:'Australia',    pct:4.8, val:'£11m',  yoy:+10, flag:'🇦🇺'},
          {country:'UK',           pct:2.6, val:'£6m',   yoy:+20, flag:'🇬🇧'},
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
          {country:'UK',           pct:18,  val:'£185m', yoy:+12, flag:'🇬🇧'},
          {country:'Germany',      pct:11.5,val:'£118m', yoy:+14, flag:'🇩🇪'},
          {country:'Australia',    pct:10,  val:'£103m', yoy:+9,  flag:'🇦🇺'},
          {country:'Canada',       pct:8,   val:'£82m',  yoy:+6,  flag:'🇨🇦'},
          {country:'Japan',        pct:7,   val:'£72m',  yoy:+15, flag:'🇯🇵'},
          {country:'France',       pct:5.5, val:'£57m',  yoy:+10, flag:'🇫🇷'},
          {country:'Singapore',    pct:5,   val:'£52m',  yoy:+20, flag:'🇸🇬'},
          {country:'Other EU',     pct:4.5, val:'£46m',  yoy:+8,  flag:'🇪🇺'},
          {country:'UAE',          pct:4,   val:'£41m',  yoy:+22, flag:'🇦🇪'},
          {country:'Spain',        pct:3,   val:'£31m',  yoy:+11, flag:'🇪🇸'},
          {country:'Netherlands',  pct:2.5, val:'£26m',  yoy:+7,  flag:'🇳🇱'},
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
          {country:'USA',          pct:30.3,val:'£238m', yoy:+8,  flag:'🇺🇸'},
          {country:'France',       pct:8.9, val:'£70m',  yoy:+6,  flag:'🇫🇷'},
          {country:'UK',           pct:7.5, val:'£59m',  yoy:+7,  flag:'🇬🇧'},
          {country:'Germany',      pct:6.1, val:'£48m',  yoy:+9,  flag:'🇩🇪'},
          {country:'Canada',       pct:4.6, val:'£36m',  yoy:+9,  flag:'🇨🇦'},
          {country:'Australia',    pct:3.9, val:'£31m',  yoy:+11, flag:'🇦🇺'},
          {country:'Spain',        pct:3.9, val:'£31m',  yoy:+11, flag:'🇪🇸'},
        ],
        macro: {
          exportVal:  {lbl:'TOTAL EXPORTS',        val:'£785m',    sub:'Bord Bia 2024 · ~€930m'},
          cagr:       {lbl:'5-YR EXPORT CAGR',     val:'+15%',     sub:'fastest EU growth origin'},
          bottles:    {lbl:'BOTTLES SOLD',         val:'~190m',    sub:'15–16.4m cases × 12 · all grades'},
          avgBottle:  {lbl:'AVG EXPORT VALUE',     val:'£4.15',    sub:'per 70cl bottle · FOB customs'},
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
          cats:[{n:'Blended Scotch',p:55},{n:'Single Malt',p:36},{n:'Blended Malt',p:6},{n:'Single Grain',p:3}],
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
          hist:[{yr:2019,v:166},{yr:2020,v:92},{yr:2021,v:146},{yr:2022,v:282},{yr:2023,v:218},{yr:2024,v:248},{yr:2025,v:286}],
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
          cats:[{n:'Blended Scotch',p:46},{n:'Single Malt',p:40},{n:'Blended Malt',p:9},{n:'Single Grain',p:5}],
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
          cats:[{n:'Single Malt',p:68},{n:'Blended',p:24},{n:'Grain',p:8}],
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
          drivers:["Strong Japanese cultural affinity in Australia","Langton\'s auction house expanding Japanese whisky catalogue","Geographic proximity and significant Japanese tourism flow","HNWI collector demand growing sharply","Craft bar culture in Sydney and Melbourne embracing Japanese expressions"],
          note:"Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP. 2024 estimated; 2025 editorial. Australia is a growing market for Japanese whisky, helped by cultural ties and the JAEPA phasing tariffs to zero by 2022. The market doubled between 2019 and 2023. Langton\'s auction house increasingly catalogues Japanese lots. Values remain modest in absolute terms — this is an emerging market with strong growth trajectory.",
        },
        'UK': {
          hist:[{yr:2019,v:8},{yr:2020,v:8},{yr:2021,v:10},{yr:2022,v:9},{yr:2023,v:6},{yr:2024,v:5},{yr:2025,v:6}],
          proj:[{yr:2026,v:7}],
          cagr3:'-20.6%', cagr5:'-9.9%',
          cats:[{n:'Single Malt',p:70},{n:'Blended',p:22},{n:'Grain',p:8}],
          tariff:'UK–Japan Comprehensive Economic Partnership Agreement (CEPA), in force January 2021. Zero duty on spirits. Rolled over from EU–Japan EPA with continuity provisions.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:["The Whisky Exchange and Master of Malt — world\'s largest online specialists","London auction market (Bonhams, Christie\'s, Whisky Auctioneer)","Whisky Show and UK festival circuit driving education","Sophisticated bar culture adopting Japanese expressions","UK food & drink media creating collector demand"],
          note:"Source: Japan Ministry of Finance customs statistics (HS 220830), converted GBP. 2019–2021 estimated (not individually reported). The UK market peaked in 2021 and has contracted — UK consumers have access to Japanese whisky through EU grey-market routes and parallel imports, which don\'t appear in Japan export figures. The Whisky Exchange, Master of Malt, and the auction ecosystem (Bonhams, Christie\'s) remain the UK\'s primary Japanese whisky channels.",
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
          note:"The UAE is American whiskey\'s fastest-growing Gulf market, centred on Dubai Duty Free and the luxury hotel on-trade. Jack Daniel\'s dominates by volume. The ultra-premium segment — Buffalo Trace Antique Collection, Pappy Van Winkle — moves through specialist retailers in DIFC and the Four Seasons hotel network.",
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
          note:"The UK is Ireland\'s third-largest export market and one of its most consistent. Irish whiskey is Scotch\'s primary competitor in UK on-trade, with Jameson particularly strong in city-centre bars. The Windsor Framework resolved post-Brexit trade complexity, preserving seamless access.",
        },
        'Germany': {
          hist:[{yr:2019,v:28},{yr:2020,v:22},{yr:2021,v:28},{yr:2022,v:35},{yr:2023,v:40},{yr:2024,v:44},{yr:2025,v:48}],
          proj:[{yr:2026,v:54}],
          cagr3:'+11.1%', cagr5:'+16.8%',
          cats:[{n:'Blended Irish',p:68},{n:'Single Pot Still',p:15},{n:'Single Malt',p:13},{n:'Single Grain',p:4}],
          tariff:'Zero tariff. Ireland and Germany are both EU members — fully frictionless intra-EU Single Market trade. No tariff, no customs checks.',
          tariffStatus:'ZERO', tariffCol:'#44cc64',
          drivers:['EU Single Market — zero barriers','Jameson brand investment in German on-trade marketing','Irish pub culture in Berlin, Hamburg, Munich, Frankfurt','Growing interest in premium Irish single pot still among German collectors','Teeling and Waterford building direct German distribution channels'],
          note:"Germany is Ireland\'s largest continental European market. The EU Single Market eliminates all trade friction. Jameson dominates by volume, but the premium segment — Redbreast, Green Spot, Midleton — is growing rapidly among Germany\'s sizeable whisky collector community.",
        },
        'Canada': {
          hist:[{yr:2019,v:20},{yr:2020,v:18},{yr:2021,v:22},{yr:2022,v:26},{yr:2023,v:30},{yr:2024,v:33},{yr:2025,v:36}],
          proj:[{yr:2026,v:40}],
          cagr3:'+11.5%', cagr5:'+14.9%',
          cats:[{n:'Blended Irish',p:66},{n:'Single Pot Still',p:15},{n:'Single Malt',p:15},{n:'Single Grain',p:4}],
          tariff:'Reduced tariff under CETA (EU–Canada Comprehensive Economic and Trade Agreement), in force provisionally since 2017. Irish whiskey benefits as an EU product — spirits tariff reduced significantly below Canada\'s WTO MFN rate.',
          tariffStatus:'CETA — LOW', tariffCol:'#44cc64',
          drivers:['Irish diaspora — 4.5m Canadians claim Irish heritage','St Patrick\'s Day volume peak','Jameson dominant in Ontario LCBO and BC Liquor government retail','CETA preferential market access for EU spirits','Growing premium Irish category awareness beyond Jameson'],
          note:"Canada\'s large Irish diaspora (over 4 million) creates natural structural demand for Irish whiskey. CETA provides preferential access through Canada\'s provincial liquor board retail monopolies. Jameson dominates, but Redbreast and single pot still expressions are gaining ground in specialist channels.",
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
          note:"Spain is a growing market driven by Jameson\'s penetration of the Spanish on-trade cocktail scene. The 'Jameson & tonic' format has become a standard bar offering alongside the traditional gin & tonic. EU membership provides completely frictionless trade from Ireland.",
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
       data hasn\'t loaded yet so the drilldown can still fetch route history. */
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
      if (stat) s += '<text x="' + (x+8) + '" y="' + (y+38) + '" font-family="Consolas,monospace" font-size="7.5" fill="#ffffff">' + stat + '</text>';
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
        s = svgNode(s, 0, ny, NW, NH, dt.name, dt.region.toUpperCase(), '', '', nc, nb, nc);
      }
      /* center node */
      s += '<rect x="'+centerX+'" y="'+centerY+'" width="'+CW+'" height="'+CH+'" fill="rgba(80,28,8,0.96)" stroke="#E97132" stroke-width="2"/>';
      s += '<rect x="'+centerX+'" y="'+centerY+'" width="'+CW+'" height="3" fill="#E97132"/>';
      var cx = centerX + CW/2;
      s += '<text x="'+cx+'" y="'+(centerY+CH/2+5)+'" font-family="Consolas,monospace" font-size="11" fill="#E97132" font-weight="700" letter-spacing="0.22em" text-anchor="middle">'+d.label+'</text>';
      /* right nodes */
      for (ri = 0; ri < rightN; ri++) {
        var rn = rightNodes[ri]; var ny2 = rightY0 + ri*rightStep;
        var pct = rn.share || rn.pct || 0;
        var rc2 = pct>=30?'#4898d8':pct>=15?'#3070a8':'#225580';
        var rb2 = pct>=30?'rgba(18,38,80,0.92)':'rgba(14,28,60,0.9)';
        var stat2, sub2a, sub2b;
        if (mode === 'supply') {
          s = svgNode(s, rightX, ny2, MW, MH, rn.name, rn.loc||'', '', '', rc2, rb2, rc2);
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
          s += '<text x="'+(rightX+8)+'" y="'+(ny2+38)+'" font-family="Consolas,monospace" font-size="7.5" fill="#ffffff" pointer-events="none">'+stat2+'  </text>';
          s += '<text x="'+(rightX+8+52)+'" y="'+(ny2+38)+'" font-family="Consolas,monospace" font-size="7.5" fill="'+yc2+'" pointer-events="none">'+sub2a+'</text>';
          if (isDrill) s += '<text x="'+(rightX+MW-6)+'" y="'+(ny2+NH/2+3)+'" font-family="Consolas,monospace" font-size="9" fill="#E97132" text-anchor="middle" pointer-events="none">›</text>';
        }
      }
      var distSrc  = (_livePrc[current] && _livePrc[current].distilleries) ? 'WhiskyStats live' : 'est.';
      var expSrc   = (_liveExp[current] && _liveExp[current].period) ? 'UN Comtrade ' + _liveExp[current].period : 'est.';
      var leftSrc  = mode === 'supply' ? '' : ' · prices: ' + distSrc;
      var rightSrc = mode === 'exports' ? ' · ' + expSrc : '';
      s += '<text x="'+(NW/2)+'" y="10" font-family="Consolas,monospace" font-size="7" fill="#ffffff" text-anchor="middle" letter-spacing="0.12em">DISTILLERIES</text>';
      s += '<text x="'+(rightX+MW/2)+'" y="10" font-family="Consolas,monospace" font-size="7" fill="#ffffff" text-anchor="middle" letter-spacing="0.12em">'+rightLabel.toUpperCase()+'</text>';
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
      var PAD = {t:18, r:10, b:26, l:56};
      var cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
      var barGap = cW / all.length;
      var barW = barGap * 0.72;

      var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" style="width:100%;height:100%;display:block;">';

      /* grid */
      [0.25, 0.5, 0.75, 1].forEach(function(f) {
        var y = PAD.t + cH * (1 - f);
        s += '<line x1="'+PAD.l+'" y1="'+y+'" x2="'+(W-PAD.r)+'" y2="'+y+'" stroke="#252525" stroke-width="1"/>';
        var lv = maxV * f;
        var lbl = lv >= 1000 ? '£'+(lv/1000).toFixed(1)+'bn' : '£'+Math.round(lv)+'m';
        s += '<text x="'+(PAD.l-4)+'" y="'+(y+3.5)+'" font-family="Consolas,monospace" font-size="9" fill="rgba(255,255,255,0.75)" text-anchor="end">'+lbl+'</text>';
      });

      /* projection divider */
      if (proj.length) {
        var dx = PAD.l + hist.length * barGap;
        var projLbl = proj[0] && proj[0].yr ? proj[0].yr+' PROJ' : 'PROJECTED';
        s += '<line x1="'+dx+'" y1="'+PAD.t+'" x2="'+dx+'" y2="'+(PAD.t+cH)+'" stroke="#333" stroke-width="1" stroke-dasharray="4,3"/>';
        s += '<text x="'+(dx+4)+'" y="'+(PAD.t+10)+'" font-family="Consolas,monospace" font-size="8" fill="rgba(255,255,255,0.55)" letter-spacing="0.1em">'+projLbl+'</text>';
      }

      /* bars */
      all.forEach(function(pt, i) {
        var isProj = i >= hist.length;
        var bh = Math.max(3, (pt.v / maxV) * cH);
        var bx = PAD.l + i * barGap + (barGap - barW) / 2;
        var by = PAD.t + cH - bh;
        if (isProj) {
          s += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="'+bh+'" fill="rgba(233,113,50,0.15)" stroke="#E97132" stroke-width="1.2" stroke-dasharray="4,2"/>';
        } else {
          s += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="'+bh+'" fill="#C05A18"/>';
          s += '<rect x="'+bx+'" y="'+by+'" width="'+barW+'" height="4" fill="#E97132"/>';
        }
        s += '<text x="'+(bx+barW/2)+'" y="'+(PAD.t+cH+16)+'" font-family="Consolas,monospace" font-size="9" fill="'+(isProj?'rgba(255,255,255,0.55)':'#ffffff')+'" text-anchor="middle">'+pt.yr+'</text>';
      });

      s += '</svg>';
      return s;
    }

    function buildDrillDown() {
      var d = OD[current];
      var flow = (FLOWS[current] || {})[drillKey];
      /* Prefer live Comtrade data; fall back to static */
      var exp = null;
      var liveNodes = _getExportNodes(current);
      if (liveNodes) liveNodes.forEach(function(n){ if (n.country === drillKey) exp = n; });
      if (!exp) d.exports.forEach(function(e){ if (e.country === drillKey) exp = e; });

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
      var cagr3Col = (cagr3||'').charAt(0) === '-' ? '#ffffff' : '#E97132';
      var cagr5Col = (cagr5||'').charAt(0) === '-' ? '#ffffff' : '#E97132';
      var peak = histBars.reduce(function(m,p){return p.v>m.v?p:m;}, histBars[0]);
      var lastBar = histBars[histBars.length - 1] || {};
      var lastVal = (lastBar.v||0) >= 1000 ? '£'+((lastBar.v||0)/1000).toFixed(2)+'bn' : '£'+(lastBar.v||0)+'m';
      var lastYrLbl = String(lastBar.yr || '—');
      var _srcLabel = {scotland:'SWA OFFICIAL DATA',japan:'JAPAN CUSTOMS (MOFJ)',usa:'DISCUS OFFICIAL DATA',ireland:'INDUSTRY ESTIMATES'}[current]||'INDUSTRY ESTIMATES';
      var chartLbl = 'EXPORT VALUE — ' + _srcLabel + ' 2019–2025 · 2026 PROJECTED';

      var html = '<div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">';

      /* ── Row 1: Back + destination header ── */
      html += '<div style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid #181818;flex-shrink:0;background:#0d0d0d;">' +
        '<button class="oweb-back" style="'+F+'font-size:9px;letter-spacing:.14em;padding:4px 12px;border:1px solid #3a3a3a;background:transparent;color:#ffffff;cursor:pointer;white-space:nowrap;flex-shrink:0;">← BACK</button>' +
        '<span style="'+F+'font-size:11px;color:#E97132;font-weight:700;letter-spacing:.14em;">'+OD[current].label+'</span>' +
        '<span style="'+F+'font-size:11px;color:#555;margin:0 2px;">→</span>' +
        '<span style="'+F+'font-size:11px;color:#ffffff;font-weight:700;letter-spacing:.14em;">'+drillKey.toUpperCase()+'</span>' +
        (exp?'<span style="'+F+'font-size:9px;color:#ffffff;margin-left:auto;white-space:nowrap;">'+(Math.round(exp.pct*10)/10)+'% OF EXPORTS'+(exp.val?' · '+exp.val:exp.valueGBP?' · £'+Math.round(exp.valueGBP/1e6)+'m':'')+'</span>':'') +
        '</div>';

      /* ── Row 2: Chart ── */
      html += '<div style="padding:10px 14px 6px;border-bottom:1px solid #181818;flex-shrink:0;">' +
        '<div style="'+F+'font-size:8px;letter-spacing:.2em;color:rgba(255,255,255,0.6);margin-bottom:8px;">'+chartLbl+'</div>' +
        '<div style="height:130px;">'+buildBarChartSVG(histBars, projBars)+'</div>' +
        '</div>';

      /* ── Row 3: Stat tiles ── */
      html += '<div style="display:flex;border-bottom:1px solid #181818;flex-shrink:0;">';
      [
        {lbl:lastYrLbl+' VALUE', val:lastVal,                     col:'#E97132'},
        {lbl:'3-YR CAGR',        val:cagr3,                       col:cagr3Col},
        {lbl:'5-YR CAGR',        val:cagr5,                       col:cagr5Col},
        {lbl:'PEAK YEAR',        val:String(peak.yr||'—'),         col:'#ffffff'},
        {lbl:'TARIFF',           val:flow?(flow.tariffStatus||'—'):'—', col:'#E97132'},
      ].forEach(function(t) {
        html += '<div style="flex:1;padding:10px 12px;border-right:1px solid #181818;min-width:0;">' +
          '<div style="'+F+'font-size:7.5px;letter-spacing:.16em;color:#ffffff;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+t.lbl+'</div>' +
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
          '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#ffffff;margin-bottom:12px;">CATEGORY SPLIT</div>';
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
          '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#ffffff;margin-bottom:8px;">TARIFF STATUS</div>' +
          '<div style="border-left:3px solid '+tariffCol+';padding:8px 12px;background:rgba(0,0,0,0.35);">' +
          '<div style="'+F+'font-size:12px;color:'+tariffCol+';font-weight:700;margin-bottom:6px;">'+flow.tariffStatus+'</div>' +
          '<div style="'+F+'font-size:9.5px;color:#ffffff;line-height:1.65;">'+flow.tariff+'</div>' +
          '</div></div>';
      }
      html += '</div>'; /* end left */

      /* Right: note + drivers */
      html += '<div style="flex:1;overflow-y:auto;padding:12px 14px;">';
      if (flow && flow.note) {
        html += '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#ffffff;margin-bottom:8px;">MARKET NOTE</div>' +
          '<div style="'+F+'font-size:10.5px;color:#ffffff;line-height:1.75;margin-bottom:18px;">'+flow.note+'</div>';
      }
      if (flow && flow.drivers && flow.drivers.length) {
        html += '<div style="'+F+'font-size:8px;letter-spacing:.18em;color:#ffffff;margin-bottom:10px;">GROWTH DRIVERS</div>';
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
        var staticExps = d.exports || [];
        exps = _le.destinations.slice(0, 10).map(function(dest) {
          var yoy = dest.yoy;
          if (yoy == null) {
            for (var _si = 0; _si < staticExps.length; _si++) {
              if (staticExps[_si].country.toLowerCase() === dest.country.toLowerCase()) {
                yoy = staticExps[_si].yoy; break;
              }
            }
          }
          return { country: dest.country, pct: dest.pct, yoy: yoy };
        });
        liveLabel = ' · LIVE ' + _le.period + ' DATA';
      }
      var totalPct = 0;
      for (var ei = 0; ei < exps.length; ei++) totalPct += (exps[ei].pct || 0);
      var expsFull = exps.slice();
      if (totalPct < 99) expsFull.push({country:'Other', pct: Math.round((100 - totalPct) * 10) / 10, yoy: 0});

      function sliceCol(yoy) {
        if (yoy == null || yoy === 0) return '#505050';
        return yoy >= 20 ? '#44cc64' : yoy >= 10 ? '#2ea84a' : yoy >= 5 ? '#3a7ccc' : '#505050';
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
            '<div style="'+F+'font-size:15px;color:#ffffff;font-weight:700;line-height:1;">'+(Math.round(le.pct*10)/10)+'<span style="'+F+'font-size:9px;color:rgba(255,255,255,0.5);">%</span></div>' +
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
        ireland:  { val:'£785m',  sub:'Bord Bia 2024 · €930m converted' },
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

      /* Set styles individually to preserve zoom applied by the widget\'s +/- buttons */
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

  /* ── MACRO DASHBOARD ── live FRED data, 5 tabs ── */
  function renderBusinessCycle(id, body) {
    var F = 'font-family:Consolas,monospace;';
    var CACHE_TTL = 43200000;
    var ACCENT = '#E97132';
    var COMP_COLS = ['#4a9eed', '#4caf7d', '#b04aed', '#f0c040'];

    var TABS = [
      { id:'cycle',     lbl:'BUSINESS CYCLE' },
      { id:'inflation', lbl:'INFLATION'       },
      { id:'liquidity', lbl:'LIQUIDITY'       },
      { id:'rates',     lbl:'RATES & DOLLAR'  },
      { id:'labour',    lbl:'LABOUR'          },
      { id:'housing',   lbl:'HOUSING'         },
      { id:'consumer',  lbl:'CONSUMER'        },
      { id:'uk_macro',  lbl:'UK MACRO'        },
    ];

    var SERIES_BY_TAB = {
      cycle: [
        { id:'CFNAI',           lbl:'CFNAI ACTIVITY',    unit:'idx', threshold:0,   invert:false, yoy:false, diff:false,
          desc:'Chicago Fed National Activity Index — 0=trend growth, below -0.70=recession',
          def:'A monthly composite of 85 US economic indicators spanning production, employment, income and sales. Designed to gauge whether the economy is growing above or below its long-run trend rate. Zero equals trend. Published by the Federal Reserve Bank of Chicago.',
          signal:'Above +0.25: strong expansion. 0 to +0.25: moderate growth. -0.70 to 0: below-trend, risk rising. Below -0.70 for two months consecutively: recession probability is high and historically confirmed.',
          pitch:'When CFNAI confirms expansion, the macro environment supports asset prices broadly and whisky casks appreciate on demand. When it dips toward -0.70, central banks are forced to act — rate cuts and monetary expansion follow. That sequence is the single most powerful driver of gold re-rating. Hard assets are the positioning tool before the pivot, not after.' },
        { id:'USALOLITONOSTSAM', lbl:'OECD CLI (USA)',    unit:'idx', threshold:100, invert:false, yoy:false, diff:false,
          desc:'OECD Composite Leading Indicator for the USA — amplitude-adjusted, 100=long-run average',
          def:'The OECD Composite Leading Indicator for the United States is designed to provide early signals of turning points in business cycles relative to trend. It is amplitude-adjusted with a long-run average of 100. Rising above 100 signals above-trend growth; falling below signals below-trend. Published monthly by the OECD and sourced via FRED.',
          signal:'Above 100 and rising: expansion above trend, risk appetite supported. At 100: trend growth. Below 100 and falling: below-trend, slowdown risk. Crossing below 100 after a peak: classic turning-point signal, historically leads recessions by 6-9 months.',
          pitch:'The OECD CLI is the macro early warning system used by institutional allocators globally. When it crosses below 100 and rolls over, the window to position in defensive real assets is typically 6-9 months wide. Clients who wait for the recession to be confirmed have already missed the gold re-rating. This is the instrument that gives you the lead time to have the conversation.' },
        { id:'INDPRO',          lbl:'INDUSTRIAL PROD',   unit:'idx', threshold:null,invert:false, yoy:true,  diff:false,
          desc:'Industrial production index YoY % — measures output across manufacturing, mining and utilities',
          def:'The Federal Reserve Board Industrial Production Index tracks real output across US manufacturing, mining and electric and gas utilities. Published monthly. Covers approximately 78% of US business value added. YoY change shown.',
          signal:'Positive YoY: industrial economy expanding. Negative YoY: contraction in goods production, often leading or concurrent with broad recession. Deep negatives (-5% or more) historically coincide with severe recessions.',
          pitch:'Industrial contraction drives flight from cyclical equities into stores of value. When factories slow, the corporate earnings expectations that underpin equity valuations deteriorate — and relative to a balance sheet holding physical gold or maturing whisky, equities become the risk asset. Industrial weakness is your opening.' },
        { id:'T10Y2YM',         lbl:'YIELD CURVE',       unit:'%',   threshold:0,   invert:false, yoy:false, diff:false,
          desc:'10-Year minus 2-Year Treasury spread — inversion = recession signal with 6-18 month lead',
          def:'The 10-year minus 2-year US Treasury yield spread. When long-term rates fall below short-term rates (inversion), the bond market is pricing in economic deterioration and eventual Fed rate cuts. Has preceded every US recession since 1955 with no false positives on sustained inversions.',
          signal:'Above +1%: healthy growth expectations. Zero to +1%: normalising. Below 0 (inverted): recession signal within 6-18 months. The steeper the inversion and longer its duration, the higher the severity of the anticipated downturn.',
          pitch:'The yield curve is the bond market\'s recession verdict. It is already priced by the most sophisticated capital in the world. When it inverts and your client asks where to hide, the answer is: gold as monetary safe haven, and whisky as an illiquid, non-correlated alternative entirely outside the financial system. Neither reprices on recession fears the way equities do.' },
        { id:'UNRATE',          lbl:'UNEMPLOYMENT',      unit:'%',   threshold:null,invert:true,  yoy:false, diff:false,
          desc:'US unemployment rate — rising = labour market deterioration, historically a lagging recession indicator',
          def:'The Bureau of Labor Statistics U-3 unemployment rate: persons unemployed as a percentage of the civilian labour force. Seasonally adjusted monthly. Tends to lag economic turns — it falls last in expansions and rises after recessions begin. The Sahm Rule: if the 3-month average rises 0.5% above its 12-month low, a recession has likely started.',
          signal:'Below 4%: tight labour market, wage pressure elevated. 4-5%: normalising. Above 5% and rising: labour market deteriorating, consumer spending at risk. Rapid rise from a cyclical low (Sahm Rule trigger) = recession confirmed.',
          pitch:'Rising unemployment triggers two client conversations simultaneously: fear of the recession itself, and the anticipated monetary response. The Fed cuts rates aggressively when unemployment rises — and rate cuts reduce the opportunity cost of holding gold and physical assets. The unemployment rate is both the problem and the setup for the solution.' },
        { id:'A191RL1Q225SBEA', lbl:'REAL GDP QoQ',      unit:'%',   threshold:0,   invert:false, yoy:false, diff:false,
          desc:'Annualised quarter-on-quarter real GDP growth — the headline economic scorecard',
          def:'Real Gross Domestic Product, seasonally adjusted annualised rate of change. Measures the inflation-adjusted value of all goods and services produced in the US economy. Two consecutive negative quarters is the traditional recession definition, though the NBER considers a broader set of indicators.',
          signal:'Above +2%: healthy expansion. +1% to +2%: sluggish. Zero: stall speed. Negative: contraction. Two consecutive negative quarters: textbook recession definition.',
          pitch:'Real GDP is the client\'s benchmark for "how bad is it." When it goes negative, portfolio reallocation conversations become easier — not because fear sells, but because the evidence for diversification into non-GDP-correlated assets is incontrovertible. Whisky cask appreciation is driven by maturation and scarcity, not GDP. Gold functions as monetary insurance. Neither needs a growing economy to perform.' },
      ],
      inflation: [
        { id:'CPIAUCSL',     lbl:'CPI ALL ITEMS',    unit:'idx', threshold:null, invert:true, yoy:true, diff:false,
          desc:'Consumer Price Index YoY — the headline US inflation gauge watched by markets and media',
          def:'The Bureau of Labor Statistics Consumer Price Index for All Urban Consumers, measuring price changes across a fixed basket of goods and services. The headline number includes volatile food and energy components. Released monthly, 8 working days before the FOMC meeting. The most widely reported inflation figure in the world.',
          signal:'Below 2%: below target, disinflationary. 2-3%: Fed comfort zone. 3-5%: above target, policy restrictive. Above 5%: significant inflation problem, aggressive tightening warranted. Persistent above 2% erodes real returns on fixed-rate assets.',
          pitch:'CPI above 2% is the single most powerful argument for holding real assets. Cash loses purchasing power. Bonds lose in real terms. Equities require earnings to keep pace with inflation to hold real value. Gold has a 5,000-year track record as a store of value against currency debasement. Whisky — physically finite, supply-constrained by production cycles — has appreciated in real terms through every inflationary episode of the last 50 years.' },
        { id:'CPILFESL',     lbl:'CORE CPI',         unit:'idx', threshold:null, invert:true, yoy:true, diff:false,
          desc:'CPI ex Food and Energy YoY — strips volatile components to reveal persistent underlying inflation',
          def:'Consumer Price Index for All Urban Consumers excluding food and energy. Used by economists and the Fed to gauge whether inflation is entrenched in the broader economy or driven by transitory commodity swings. Stickier than headline CPI — service sector inflation, rents, and wages feed into core.',
          signal:'Core below 2%: inflation under control. Core 2-3% with declining headline: Fed can pause. Core above 3% and sticky: tightening cycle prolonged. Core diverging upward from falling headline: risk that inflation is entrenched despite commodity relief.',
          pitch:'Core CPI is where the Fed\'s policy response is anchored. Sticky core above 3% means higher rates for longer — and that extends the period where bonds and equities face headwinds from discount rate pressure. Gold\'s inverse relationship to real interest rates means the longer core stays elevated, the more durable the case for holding gold.' },
        { id:'PCEPI',        lbl:'PCE DEFLATOR',     unit:'idx', threshold:null, invert:true, yoy:true, diff:false,
          desc:'PCE Price Index YoY — the Federal Reserve\'s preferred inflation measure for policy decisions',
          def:'The Bureau of Economic Analysis Personal Consumption Expenditures Price Index. Preferred by the Federal Reserve over CPI because it captures substitution effects (consumers shifting between goods as prices change), covers a broader range of goods, and has a more current weighting. The Fed\'s 2% inflation target is officially stated in PCE terms.',
          signal:'Below 2%: Fed accommodative bias. At 2%: on target, neutral policy. Above 2%: tightening bias. Above 3% and rising: aggressive tightening. This is the number the FOMC references in its policy statements and dot-plot projections.',
          pitch:'PCE is literally the number the Fed uses to set interest rates. When PCE is above target, the Fed raises rates — compressing equity multiples and increasing the attractiveness of real assets as an alternative. When it is below target, the Fed cuts — inflating asset prices broadly including gold. Knowing where PCE is and where it is going is the macro foundation for the entire hard asset conversation.' },
        { id:'PCEPILFE',     lbl:'CORE PCE',         unit:'idx', threshold:null, invert:true, yoy:true, diff:false,
          desc:'Core PCE YoY — the Federal Reserve\'s primary 2% inflation target benchmark',
          def:'Personal Consumption Expenditures Price Index excluding food and energy. This is the Fed\'s primary policy benchmark. Fed Chair Kevin Warsh and the FOMC reference this specific measure when stating the 2% target in speeches, minutes, and press conferences. More representative of persistent inflationary pressure than CPI-based measures.',
          signal:'Below 2% and falling: rate cuts approaching. At 2%: target achieved, neutral stance. 2-3%: above target, policy restrictive. Above 3%: tightening justified. The gap between current reading and 2% directly maps to implied rate path.',
          pitch:'Core PCE is the Fed\'s scoreboard. Every 0.1% above 2% represents more monetary tightening. More tightening means higher borrowing costs, compressed multiples, and lower equity returns. Physical assets with no income stream and no leverage are immune to this mechanism. Gold and whisky casks exist outside the rate-sensitive financial system — they do not have a P/E ratio that deflates when the discount rate rises.' },
        { id:'CUSR0000SAH1', lbl:'SHELTER CPI',      unit:'idx', threshold:null, invert:true, yoy:true, diff:false,
          desc:'Housing and shelter component of CPI YoY — the stickiest and largest component at ~35% weight',
          def:'The shelter component of the Consumer Price Index including rent of primary residence, owners\' equivalent rent, and lodging away from home. At approximately 35% of the CPI basket, it is the largest single component. Shelter inflation typically lags real-time rent data by 12-18 months, making it persistently sticky even after market rents begin falling.',
          signal:'Rising shelter inflation keeps core CPI elevated regardless of commodity deflation. Shelter above 4% YoY: core CPI cannot fall to target easily. Shelter falling toward 2%: the disinflationary thesis is credible. Shelter is the key variable in assessing whether core CPI can sustainably return to target.',
          pitch:'Shelter inflation running hot means the Fed cannot declare victory on inflation and cut rates. Extended higher-for-longer rate environments suppress property transaction volumes — and suppress the traditional wealth-building tool for millions of investors. Capital displaced from property seeks alternative stores of value. Whisky cask appreciation is not shelter-cost dependent. It is a genuine alternative to the most inflation-resistant asset class in history.' },
        { id:'WPSFD49207',   lbl:'PPI FINAL DEMAND', unit:'idx', threshold:null, invert:true, yoy:true, diff:false,
          desc:'Producer Price Index YoY — upstream cost pressure pipeline; leads consumer inflation by 3-6 months',
          def:'Bureau of Labor Statistics Producer Price Index for Final Demand, measuring prices received by domestic producers for their output. Covers manufacturing, agriculture, mining and service industries. Because producer costs eventually flow through to consumer prices, PPI leads CPI by approximately 3-6 months, making it a useful leading inflation indicator.',
          signal:'PPI falling while CPI elevated: consumer disinflation is in the pipeline — headline relief coming. PPI rising: cost-push inflation building, CPI will follow. PPI-CPI divergence tells you the direction of travel before the headline number moves.',
          pitch:'A salesperson who can say "PPI has been falling for six months — CPI relief is coming, and when it does the Fed pivots" is ahead of the Bloomberg consensus. The rate pivot is the catalyst for the next leg of gold\'s bull market. Clients who position before the pivot capture the alpha. This indicator is the pipeline — the signal before the signal.' },
      ],
      liquidity: [
        { id:'M2SL',      lbl:'M2 GROWTH YoY',     unit:'%',   threshold:0,    invert:false, yoy:true,  diff:false,
          desc:'US M2 money supply YoY growth — the foundational monetary debasement indicator',
          def:'M2 is the Federal Reserve\'s measure of the US money supply including cash, checking deposits, savings deposits, money market funds and small time deposits. M2 growth measures how fast the money supply is expanding. When money supply grows faster than economic output, the additional money buys the same goods — the textbook definition of inflation and currency debasement.',
          signal:'Above 5%: expansionary, supports asset prices. 0-5%: moderate. Negative: unprecedented contraction territory, deflationary risk. The 2020-21 M2 spike (+25% YoY) predicted the 2021-22 inflation surge. M2 contraction in 2022-23 was the tightest since the 1930s.',
          pitch:'M2 is the scorecard for currency debasement. Every dollar of M2 growth that exceeds GDP growth is a dilution of the currency\'s purchasing power. Gold\'s price history tracks the expansion of the money supply with striking accuracy over multi-decade horizons. Whisky cask supply is fixed by production decisions made years ago — it cannot be printed. The fundamental trade is always: finite physical asset vs infinite paper money.' },
        { id:'WALCL',     lbl:'FED BALANCE SHEET',  unit:'$m',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'Federal Reserve total assets — measures the scale of monetary expansion via quantitative easing',
          def:'The Federal Reserve\'s weekly balance sheet total assets, including US Treasury securities, mortgage-backed securities, and other holdings acquired through quantitative easing. The balance sheet grew from $900bn in 2008 to $4.5tn in 2015, to $7.2tn in 2020, to $9tn in 2022. QT reduces it. Each expansion represents new base money creation.',
          signal:'Expanding (QE): monetary accommodation, supports asset prices. Contracting (QT): tightening financial conditions, headwind for risk assets and some real assets. Stable: neutral. The rate of change matters as much as the level.',
          pitch:'The Fed balance sheet is the most visible measure of how much money has been created from nothing. Nine trillion dollars in assets were purchased with newly created reserves. That money had to go somewhere — it went into asset prices. Hard assets with fixed supply (gold bars, aged whisky casks) are the natural beneficiary of monetary expansion. They cannot be replicated by the Fed\'s printer.' },
        { id:'WRESBAL',   lbl:'BANK RESERVES',      unit:'$bn', threshold:null, invert:false, yoy:false, diff:false,
          desc:'Reserve balances held at the Federal Reserve by commercial banks — a measure of banking system liquidity',
          def:'Total reserves held by depository institutions at Federal Reserve Banks, including required and excess reserves. A key indicator of banking system liquidity. High reserve levels indicate ample liquidity; declining reserves signal potential tightening of credit conditions as banks hold less of a buffer against lending demands.',
          signal:'High and rising: banking system flush with liquidity, credit available, rate risk limited. Declining toward a threshold (~$3tn estimated minimum): risk of reserve scarcity, credit tightening, potential for repo market stress similar to September 2019. Monitor for sharp drops.',
          pitch:'When bank reserves fall sharply, the repo market can seize — as it did in 2019 and nearly again in 2023. Credit conditions tighten suddenly, market volatility spikes, and investors reach for liquid, uncorrelated stores of value. Gold performs its crisis insurance function. Whisky, already illiquid by design, is insulated from financial system plumbing entirely.' },
        { id:'RRPONTSYD', lbl:'REVERSE REPO',       unit:'$bn', threshold:null, invert:false, yoy:false, diff:false,
          desc:'Fed overnight reverse repo — money market funds parking cash at the Fed; measures excess liquidity drain',
          def:'The Federal Reserve\'s overnight reverse repurchase facility allows money market funds and other eligible counterparties to lend cash to the Fed overnight, receiving Treasury collateral. A high RRP balance indicates excess liquidity in the system that cannot find better risk-free returns elsewhere. Declining RRP signals that liquidity is being absorbed back into the banking system or markets.',
          signal:'High and rising: excess liquidity parked safely, financial conditions still accommodative. Rapidly declining (as seen in 2023-24): liquidity leaving the RRP is not necessarily tightening — it is finding a home in T-bills and risk assets. When RRP hits zero: the excess liquidity cushion is gone, and any further tightening comes directly from banking system reserves.',
          pitch:'The RRP is the overflow tank for the monetary system. While it runs down, there is a hidden liquidity backstop supporting asset markets. When it empties, the market discovers whether underlying conditions are genuinely tight. That is the moment where portfolio resilience matters most — and physical stores of value outside the financial system show their risk-management value.' },
        { id:'BOGMBASE',  lbl:'MONETARY BASE',      unit:'$bn', threshold:null, invert:false, yoy:false, diff:false,
          desc:'M0 monetary base — currency in circulation plus bank reserves; the foundation of all money creation',
          def:'The monetary base (M0) is the total amount of a currency in circulation plus the stored in bank reserves. It is the narrowest measure of money supply and represents the direct liabilities of the Federal Reserve. Changes in the monetary base directly reflect Fed policy actions and are the raw material from which banks create broader money supply through lending.',
          signal:'Expanding: accommodative policy, base money growing. Contracting: quantitative tightening, the most direct measure of how much the Fed is shrinking its footprint. The monetary base typically leads M2 changes by several months.',
          pitch:'The monetary base is the primordial source of all currency in the system. When it expands, every unit of existing wealth — every dollar, every bond, every bank account — is diluted in relative terms. Gold and hard assets are not diluted because their supply cannot be expanded by policy decree. This is the most fundamental argument for holding real assets: they exist outside the monetary system\'s expansion mechanism.' },
        { id:'TOTLL',     lbl:'BANK CREDIT',        unit:'$bn', threshold:null, invert:false, yoy:false, diff:false,
          desc:'Total loans and leases in US bank credit — measures the flow of credit into the real economy',
          def:'Federal Reserve weekly data on total loans and leases held by all commercial banks in the US, including commercial and industrial loans, real estate loans, consumer loans, and other credit. Bank credit growth is a leading indicator of nominal economic activity — when banks lend aggressively, money velocity increases and asset prices follow.',
          signal:'Strong growth: credit cycle in expansion, supportive of economic growth and asset prices. Slowing or contraction: credit tightening, economic headwind ahead. Contraction in bank credit preceded the 2001 and 2008 recessions by 6-12 months.',
          pitch:'When bank credit contracts, the credit cycle has turned. Businesses cannot borrow to grow, consumers cannot borrow to spend, and the economic multiplier reverses. In this environment, assets that do not depend on credit expansion for their value — maturing whisky casks, physical gold — offer something rare: appreciation that is structurally independent of the credit cycle.' },
      ],
      rates: [
        { id:'GS10',         lbl:'10Y TREASURY',      unit:'%',  threshold:null, invert:true,  yoy:false, diff:false,
          desc:'10-Year US Treasury constant maturity yield — the global risk-free rate benchmark',
          def:'The 10-year US Treasury note yield is the most important interest rate in the world. It is the benchmark against which all other assets are priced: equities (via discount rates), mortgages, corporate bonds, and sovereign debt globally. It reflects the market\'s expectation of future growth, inflation, and Fed policy over a decade. Real yield (nominal minus inflation) is the key variable for gold.',
          signal:'Rising: tightening financial conditions, higher hurdle rate for all assets, equity multiples compress. Falling: easing conditions, lower opportunity cost for non-yielding assets, gold benefits. Real yield above 2%: gold faces headwind. Real yield at or below zero: gold\'s most powerful environment.',
          pitch:'The 10-year yield is the single number that prices everything else. When it is high and rising, cash earns a real return and the case for holding non-yielding hard assets is harder. When it peaks and turns, the entire asset price structure shifts — and the re-rating of gold is typically sharp and front-loaded. The 10-year yield chart is your macro map for timing the conversation.' },
        { id:'GS2',          lbl:'2Y TREASURY',       unit:'%',  threshold:null, invert:true,  yoy:false, diff:false,
          desc:'2-Year US Treasury yield — most sensitive to near-term Fed rate expectations',
          def:'The 2-year US Treasury note yield is the most rate-sensitive government bond, moving almost in lockstep with Federal Funds Rate expectations over a 6-18 month horizon. When the 2Y is above the 10Y (inversion), markets expect the Fed to cut rates significantly — typically in response to a slowing economy. The 2Y is the bond market\'s forecast of monetary policy.',
          signal:'2Y above 10Y (inverted): market expects Fed cuts — recession probability high. 2Y falling while 10Y stable: curve steepening, recovery being priced. 2Y near Fed Funds: neutral, policy on hold. 2Y far above Fed Funds: market expects imminent cuts.',
          pitch:'The 2-year yield is the market\'s Fed rate forecast. When it prices in aggressive rate cuts, it is telling you a recession is coming and that the next monetary cycle will be accommodative. Accommodative monetary policy — rate cuts, eventual QE — is the most historically reliable driver of gold outperformance. The 2Y is your early warning that the setup is approaching.' },
        { id:'FEDFUNDS',     lbl:'FED FUNDS RATE',    unit:'%',  threshold:null, invert:true,  yoy:false, diff:false,
          desc:'Effective Federal Funds Rate — the primary monetary policy instrument of the US Federal Reserve',
          def:'The weighted average rate at which banks lend reserve balances to each other overnight, set by Federal Open Market Committee policy decisions. This rate anchors the entire short-term interest rate structure. Changes in the Fed Funds Rate ripple through mortgages, corporate bonds, savings rates, and global dollar-denominated debt — roughly $13 trillion of assets globally are priced off this rate.',
          signal:'Rising cycle: tightening, suppresses gold (higher opportunity cost), compresses equity multiples. Peak: inflection point — the most powerful moment to position. Falling cycle: accommodative, gold outperforms, liquidity flows back into risk assets. The duration at peak and pace of cuts matters enormously.',
          pitch:'The peak of the Fed Funds Rate cycle is the single most important macro event for hard asset allocation. Every prior peak was followed by significant gold outperformance — 2001-08 (+200%), 2006-12 (+170%), 2019-20 (+25%). The mechanism is simple: rate cuts reduce the opportunity cost of holding non-yielding gold and flow additional liquidity into the system. The Fed Funds chart is your timing tool.' },
        { id:'T10YIEM',      lbl:'BREAKEVEN 10Y',     unit:'%',  threshold:2,    invert:false, yoy:false, diff:false,
          desc:'10-Year inflation breakeven — the bond market\'s real-time inflation forecast for the next decade',
          def:'The difference between the 10-year nominal Treasury yield and the 10-year TIPS (Treasury Inflation-Protected Securities) yield. Represents the bond market\'s implied forecast for average CPI inflation over the next 10 years. If breakevens are at 2.5%, bond investors are demanding compensation for 2.5% average annual inflation over the decade. Real money — pension funds, insurance — uses this to price liabilities.',
          signal:'Below 2%: market expects below-target inflation, disinflationary. At 2%: on-target expectations. Above 2.5%: elevated inflation expectations, bonds less attractive in real terms. Above 3%: significant inflation regime feared. Rising breakevens support gold as an inflation hedge.',
          pitch:'When 10-year breakevens rise above 2.5%, real money is paying an insurance premium against inflation. That same insurance demand flows into gold and real assets. Breakevens above 3% have historically preceded the strongest phases of gold bull markets. This is where the systematic, institutionally sized money enters inflation hedges — and whisky casks, as a physical supply-constrained asset, participate in that institutional rotation.' },
        { id:'DTWEXBGS',     lbl:'DOLLAR INDEX',      unit:'idx',threshold:null, invert:false, yoy:false, diff:false,
          desc:'Nominal broad US Dollar trade-weighted index — a falling dollar is a direct tailwind for gold and hard assets',
          def:'The Federal Reserve\'s nominal broad US dollar index measures the value of the US dollar against a broad basket of trading partner currencies, weighted by trade flows. A stronger dollar makes dollar-denominated assets more expensive for foreign buyers. A weaker dollar makes gold, commodities, and real assets cheaper in foreign currency terms, stimulating demand.',
          signal:'Dollar strengthening: headwind for gold and commodities (dollar-denominated). Dollar weakening: direct tailwind for hard assets. Sustained dollar weakness — particularly driven by Fed easing — has historically coincided with the strongest gold bull markets (2001-11, 2018-20).',
          pitch:'Gold and the dollar have a structural inverse relationship over long cycles. When the world\'s reserve currency weakens, the global store of value it has supplanted — gold — strengthens. A weakening dollar also makes UK-produced Scotch whisky casks cheaper in dollar terms for international buyers, supporting the secondary market. Dollar weakness is the dual catalyst for both core hard asset classes.' },
        { id:'BAMLH0A0HYM2', lbl:'HY CREDIT SPREAD',  unit:'%',  threshold:4,    invert:true,  yoy:false, diff:false,
          desc:'US High Yield Option-Adjusted Spread — widening = credit stress and flight to safety; the fear gauge',
          def:'The ICE BofA US High Yield Index Option-Adjusted Spread measures the yield premium demanded by investors to hold high-yield (below investment grade) corporate bonds over equivalent-maturity Treasuries. Widening spreads indicate rising credit risk perception and falling risk appetite. The HY spread is the bond market\'s real-time credit stress gauge.',
          signal:'Below 300bp: risk-on, credit conditions benign. 300-500bp: caution warranted, credit stress building. 500-700bp: significant stress, recessionary conditions. Above 700bp: crisis territory, systemic risk (seen in 2008, 2020). Rapid widening of 200bp or more in weeks signals acute market stress.',
          pitch:'Credit spread widening is the market\'s alarm signal for risk assets. When HY spreads blow out, it is not just credit investors who suffer — equity risk premiums rise, lending tightens, and the economic outlook deteriorates. In these environments, gold outperforms as the flight-to-safety asset. Physical whisky casks are entirely removed from the corporate credit cycle — a maturing barrel of Scotch does not have a credit rating.' },
      ],
      labour: [
        { id:'PAYEMS',        lbl:'NONFARM PAYROLLS', unit:'k',  threshold:null, invert:false, yoy:false, diff:true,
          desc:'Monthly change in total nonfarm employment — the headline US jobs report released first Friday of each month',
          def:'Bureau of Labor Statistics monthly survey of establishments measuring the net change in employed persons on nonfarm payrolls. The most market-moving economic data release in the world. Released on the first Friday of each month at 8:30am ET. Covers approximately 80% of workers who produce the entire GDP of the United States. Shows the month-over-month change in jobs.',
          signal:'Above +300K: very strong, labour market overheating, inflationary pressure. +150K to +300K: healthy growth. 0 to +150K: cooling, watch trend. Negative: job losses, recessionary signal. A three-month average trend is more reliable than any single print.',
          pitch:'The payrolls number moves markets more than almost any other release. A strong print delays Fed cuts — headwind for gold. A weak print or negative reading accelerates the pivot narrative — tailwind for hard assets. But for your client, the practical message is this: the labour market creates the consumer confidence that drives discretionary luxury spending, including premium spirits. Strong payrolls support the demand side of the whisky market.' },
        { id:'JTSJOL',        lbl:'JOB OPENINGS',     unit:'k',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'JOLTS total job openings — measures labour demand before it shows in payrolls or unemployment',
          def:'The Bureau of Labor Statistics Job Openings and Labor Turnover Survey measures unfilled positions at businesses on the last business day of each month. Alongside quits (voluntary resignations), it is the most reliable real-time measure of labour market demand and worker confidence. High openings relative to unemployed workers (the Beveridge Curve) indicates structural tightness.',
          signal:'Above 10 million: historically tight, wage pressure building. 7-10 million: balanced market. Below 7 million and falling: demand for labour softening, wage growth slowing, economic momentum waning. Sharp falls in openings (down 20%+ from peak) have historically preceded recessions by 12-18 months.',
          pitch:'JOLTS leads the unemployment rate. When openings fall sharply, it is the first sign that hiring is slowing — before layoffs appear in the payrolls data and before unemployment rises. This gives the forward-looking salesperson a 12-18 month window to have the defensive positioning conversation before the mainstream media starts running recession stories.' },
        { id:'UNRATE',        lbl:'UNEMPLOYMENT',     unit:'%',  threshold:null, invert:true,  yoy:false, diff:false,
          desc:'US unemployment rate — lagging indicator; rising rate triggers the Sahm Rule recession signal',
          def:'The U-3 unemployment rate, defined as persons who are jobless, available for work and have actively sought employment in the past four weeks, as a percentage of the civilian labour force. Compiled from the monthly household survey. Tends to lag the economic cycle — it is one of the last indicators to turn. The Sahm Rule: 3-month average rising 0.5%+ above the prior 12-month low signals recession has begun.',
          signal:'Below 4%: tight, wage pressure persistent. 4-5%: normalising. 5%+ and rising: deteriorating. Sahm Rule trigger (0.5% rise from low): recession in progress. The speed of rise matters — a slow drift is different from a sharp spike.',
          pitch:'Unemployment rising is the late-cycle confirmation that most clients understand intuitively. But the sophisticated move is to be positioned in hard assets before the unemployment rate rises — because that is when gold re-rates. The Sahm Rule trigger has been followed by significant gold outperformance in every instance. By the time unemployment makes headlines, the positioning opportunity has already been captured.' },
        { id:'CES0500000003', lbl:'HOURLY EARNINGS',  unit:'$',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'Average hourly earnings all private employees — measures wage inflation, a key input into services CPI',
          def:'Bureau of Labor Statistics monthly measure of average hourly earnings across all private-sector employees. Wage growth feeds directly into services inflation, which is the stickiest component of core CPI. The Fed watches wage growth closely as a measure of whether inflationary psychology has become entrenched in labour markets.',
          signal:'Above 4% YoY growth: wage-price spiral risk, Fed remains hawkish. 3-4%: above pre-pandemic trend but manageable. Below 3%: wages normalising, inflation pressure easing, rate cuts approaching. Strong wages with falling unemployment = overheating risk.',
          pitch:'Wage growth sustains the consumer spending that drives demand for premium goods. When average earnings are rising, there is a growing cohort of affluent earners with the capacity to allocate to premium investments, including whisky casks. Simultaneously, persistent wage growth keeps the Fed cautious — and cautious monetary policy eventually gives way to easing, which triggers the gold repricing cycle.' },
        { id:'CIVPART',       lbl:'LABOUR FORCE PART',unit:'%',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'Civilian labour force participation rate — measures the share of working-age population in the workforce',
          def:'The percentage of the civilian non-institutional population aged 16 and over that is either employed or actively seeking employment. Provides context for the unemployment rate — low unemployment with low participation can mask a structurally weak labour market where many have stopped looking for work. Pre-pandemic peak was 63.4% in 2000; structural forces (ageing, disability, caregiving) have since pushed it lower.',
          signal:'Rising: more workers entering the workforce, increasing labour supply, reducing wage pressure. Falling: supply-side contraction, fewer available workers. Participation below pre-pandemic levels with low unemployment = structural tightness that keeps wage inflation persistent.',
          pitch:'Participation rate tells you whether the labour market tightness is genuine or illusory. Structurally low participation with low unemployment means wage pressure persists — and persistent wage pressure keeps the Fed hawkish longer than markets expect. Extended hawkishness compresses bond duration, equity multiples, and speculative assets. In that environment, assets with intrinsic scarcity value hold purchasing power better than paper assets.' },
        { id:'ICSA',          lbl:'INITIAL CLAIMS',   unit:'k',  threshold:null, invert:true,  yoy:false, diff:false,
          desc:'Weekly initial jobless claims — the most timely labour market indicator, released every Thursday',
          def:'New filings for state unemployment insurance benefits, released weekly every Thursday morning at 8:30am ET. The most timely piece of labour market data available. With a one-week lag, it captures real-time changes in the pace of layoffs across the economy. The 4-week moving average smooths the volatile weekly data.',
          signal:'Below 230K: tight market, layoffs minimal. 230-300K: normalising conditions. 300-350K: labour market softening, worth monitoring trend. Above 400K and rising: significant deterioration underway. Rapid weekly increases (10%+ above 4-week average) signal an acceleration in layoffs.',
          pitch:'Initial claims is the earliest signal that the labour cycle has turned. It moves before payrolls, before unemployment, and months before recession is declared. For a sales team timing their macro conversations, the initial claims trend is the indicator that opens the door: rising claims justify the defensive asset allocation conversation before the mainstream narrative catches up.' },
      ],
      housing: [
        { id:'HOUST',         lbl:'HOUSING STARTS',     unit:'k',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'New privately-owned housing units started monthly — the most watched leading indicator for construction',
          def:'Census Bureau monthly estimate of new privately-owned residential housing units where construction has begun, expressed as a seasonally adjusted annual rate in thousands. A leading economic indicator — housing starts lead GDP turns by approximately 6 months. Includes single-family and multi-family units. Sensitive to mortgage rates, confidence, and land/material costs.',
          signal:'Above 1,500K: strong construction activity, economy expanding. 1,200-1,500K: moderate pace. Below 1,200K and declining: construction sector contracting, economic headwind. Sharp drops of 20%+ from peak have preceded every recession since 1960.',
          pitch:'Housing starts measure the wealth effect in its most tangible form — whether people believe enough in the future to commit to a 30-year asset. When starts collapse, it is because mortgage affordability has been destroyed or confidence has broken. That same environment historically drives wealthy capital into portable, liquid, non-mortgage-dependent stores of value: gold, fine art, premium whisky. The inability to own property creates demand for alternative stores of wealth.' },
        { id:'PERMIT',        lbl:'BUILDING PERMITS',   unit:'k',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'New residential building permits — leads housing starts by 1-2 months, earliest construction signal',
          def:'Monthly Census Bureau data on permits for new privately-owned residential construction, issued by local governments before construction begins. Because permits must be obtained before starts, permits lead housing starts by 1-2 months and lead broader economic activity by 6-12 months. One of the ten components of the Conference Board Leading Economic Index.',
          signal:'Rising trend: construction pipeline building, economic confidence intact. Falling for 3+ months: pipeline draining, housing cycle turning. Permits diverging sharply above starts: future supply wave coming. Permits below starts: pipeline thinning, supply will tighten, prices supported.',
          pitch:'Permits below starts tell you that the future supply pipeline is draining — fewer homes are being approved than started. In a constrained supply environment, property prices hold even as affordability deteriorates. The parallel with aged whisky is direct: production decisions made 10-15 years ago determine today\'s supply. A maturing cask is a building permit that has already been approved and cannot be cancelled.' },
        { id:'CSUSHPISA',     lbl:'CASE-SHILLER HPI',  unit:'idx',threshold:null, invert:false, yoy:true,  diff:false,
          desc:'S&P/Case-Shiller US National Home Price Index YoY — the benchmark for US residential property values',
          def:'A composite index measuring changes in the value of residential real estate across 20 major US metropolitan areas. Published monthly with approximately a two-month lag. Widely regarded as the most reliable measure of US home price appreciation. Uses a repeat-sales methodology that tracks the same properties over time, eliminating compositional bias.',
          signal:'YoY above 5%: strong appreciation, wealth effect positive. 0-5%: moderate or stalling. Negative YoY: property market deflating, wealth effect negative, consumer confidence at risk. Falls of more than 10% YoY have been associated with significant economic stress.',
          pitch:'Case-Shiller is the definitive scorecard for property as a store of value. When it inflates, property owners feel wealthy and invest. When it stalls or reverses, the traditional store of wealth fails its function. Alternative stores of value — gold, whisky casks — attract capital that has lost confidence in property as an appreciating asset. The Case-Shiller chart and the whisky appreciation chart over 20 years make for a compelling side-by-side.' },
        { id:'MORTGAGE30US',  lbl:'30Y MORTGAGE RATE',  unit:'%',  threshold:null, invert:true,  yoy:false, diff:false,
          desc:'30-Year fixed mortgage rate — the primary determinant of housing affordability; rising = locked-out buyers',
          def:'The Freddie Mac Primary Mortgage Market Survey average 30-year fixed-rate mortgage rate, the most widely referenced measure of US mortgage costs. The relationship between mortgage rates and housing affordability is direct and mathematical: a 1% rise in the 30-year rate reduces purchasing power by approximately 10%. At 7%+, the median US home requires 40%+ of median household income to service.',
          signal:'Below 5%: historically supportive of strong housing demand. 5-6.5%: manageable but constraining. Above 7%: affordability crisis, transaction volumes collapse. Above 8%: historically associated with severe housing downturns. The 2022-23 move from 3% to 8% was the fastest affordability shock in US history.',
          pitch:'At 7%+ mortgage rates, a generation of buyers is priced out of property. That capital needs a home. Portable, accessible, supply-constrained alternatives — whisky casks, gold — attract the overflow from a locked housing market. The most powerful sales conversation is this: the single asset class that has historically functioned as a store of value (property) is now out of reach. What is the alternative?' },
        { id:'MSPUS',         lbl:'MEDIAN HOME PRICE',  unit:'$',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'Median sales price of US houses sold — the headline measure of nominal property wealth',
          def:'Census Bureau quarterly measure of the median sales price of new houses sold in the United States. The median (not mean) price is used to reduce the distortion from ultra-high-end sales. Reflects the central tendency of the housing market. Often cited in political and economic discourse as the benchmark for housing affordability versus income.',
          signal:'Rising: property wealth effect positive, consumer confidence supported. Flat or falling: nominal property wealth stalling, potential negative wealth effect. Falls of 10%+ have historically been associated with major financial stress due to mortgage collateral impairment.',
          pitch:'The median home price is the number ordinary people use to assess their wealth. When it rises, they feel wealthy and invest. When it falls, wealth destruction begins, confidence breaks, and spending contracts. In an environment where property prices are falling, the conversation with a wealth-preserving client almost writes itself: which assets held value through every prior property downturn? Gold and tangible alternatives with fixed supply.' },
        { id:'EXHOSLUSM495S',  lbl:'EXISTING HOME SALES',unit:'k', threshold:null, invert:false, yoy:false, diff:false,
          desc:'Monthly existing home sales — measures transaction volume and liquidity in the US housing market',
          def:'National Association of Realtors monthly measure of completed purchases of previously owned homes (single-family, condominiums, co-ops, and townhomes). Represents approximately 90% of the US housing market by transactions. Transaction volume is sensitive to mortgage rates, inventory, and confidence. The lock-in effect: homeowners with 3% mortgages will not sell to buy at 7%.',
          signal:'Above 5 million annual rate: healthy transaction volume. 4-5 million: moderate. Below 4 million: depressed volume, lock-in effect dominant, market illiquid. The lock-in effect at high mortgage rates means even stable prices occur with very low volume — a market where no one can move.',
          pitch:'Collapsing transaction volume is the lock-in effect made visible. Millions of homeowners are sitting on sub-3% mortgages they cannot afford to give up. The housing market has become illiquid. Ironically, whisky cask investment shares a similar characteristic — illiquidity by design — but with the benefit that the asset is maturing and appreciating while it sits. It is illiquidity working for you, not against you.' },
      ],
      consumer: [
        { id:'UMCSENT',         lbl:'UMICH SENTIMENT',   unit:'idx',threshold:80,  invert:false, yoy:false, diff:false,
          desc:'University of Michigan Consumer Sentiment Index — forward-looking gauge of consumer spending intention',
          def:'Monthly survey of approximately 500 US consumers measuring their current financial situation and forward-looking expectations for the economy. A composite of five questions covering personal finances, buying conditions, and economic outlook. The University of Michigan has conducted this survey continuously since 1946. Historically reliable at predicting recessions when it falls to extreme lows.',
          signal:'Above 90: highly confident, consumer spending robust. 70-90: moderate confidence. 60-70: cautious, spending slowing. Below 60: pessimistic, recessionary sentiment. Below 55: historically associated with recession. Sharp rapid falls (15+ points in 2-3 months) signal shock to confidence.',
          pitch:'Consumer sentiment is where your client lives. When it collapses, the wealthy investor\'s reaction is defensive rotation — not panic selling but systematic reallocation to assets that hold value independent of consumer cycles. Premium whisky, purchased and matured over 8-15 years, is designed for exactly this: its value is derived from time and scarcity, not from the consumer confidence reading on any particular month.' },
        { id:'RSAFS',           lbl:'RETAIL SALES',      unit:'$m', threshold:null, invert:false, yoy:true,  diff:false,
          desc:'Advance retail and food services sales YoY — real-time read on consumer spending, 70% of US GDP',
          def:'Census Bureau advance monthly estimate of sales at retail and food service establishments, covering approximately 5,000 retailers. Released approximately 2 weeks after month-end. Retail sales represent a major component of personal consumption expenditures, which themselves account for approximately 70% of US GDP. YoY change shown to strip seasonal patterns.',
          signal:'YoY above 4%: robust spending, consumer healthy. 2-4%: moderate pace. 0-2%: slowing notably. Negative YoY: consumer retrenching, recessionary pressure on demand. Retail less autos less gas is the cleanest signal — strips volatile components.',
          pitch:'Retail sales tell you whether consumers are spending. When they stop, GDP follows — and corporate earnings follow, and equity markets follow. The investor who sees retail slowdown as a macro early warning rather than a coincident indicator positions in defensive real assets before the equity market reprices the economic deterioration. Whisky casks and gold both have buyers irrespective of whether US consumers are visiting the shops.' },
        { id:'DSPIC96',         lbl:'REAL DISP. INCOME', unit:'$bn',threshold:null, invert:false, yoy:true,  diff:false,
          desc:'Real disposable personal income YoY — inflation-adjusted income after tax; drives sustainable spending capacity',
          def:'Bureau of Economic Analysis measure of personal income minus personal taxes, further adjusted for inflation using the PCE price index. Represents the actual purchasing power available to US consumers. The distinction from nominal income is critical: if wages rise 4% but inflation is 5%, real disposable income is falling — consumers have less purchasing power even with higher paycheques.',
          signal:'YoY above 2%: real income growing, sustainable spending capacity building. 0-2%: holding ground. Negative YoY: purchasing power falling, consumers drawing down savings or credit to maintain spending. Sustained negative real income growth has preceded every consumer-led recession.',
          pitch:'Falling real disposable income is the erosion of wealth happening in real time. When inflation erodes purchasing power faster than wages rise, consumers become poorer in real terms even with full employment. This is financial repression — the slow confiscation of wealth through currency debasement. Physical assets with genuine scarcity — gold and aged whisky — are the classical response to this specific form of wealth erosion.' },
        { id:'PCE',             lbl:'PERSONAL SPENDING', unit:'$bn',threshold:null, invert:false, yoy:true,  diff:false,
          desc:'Personal Consumption Expenditures YoY — the broadest measure of consumer spending in the US economy',
          def:'Bureau of Economic Analysis monthly measure of the value of goods and services purchased by US households and non-profit institutions. The broadest and most comprehensive measure of consumer spending, covering durable goods, nondurable goods, and services. PCE accounts for approximately 70% of US GDP. The Fed uses the PCE price index (derived from this data) as its inflation benchmark.',
          signal:'YoY above 5%: strong consumption, inflationary pressure. 3-5%: healthy pace. 1-3%: moderating. Below 1% or negative: consumer retrenchment, recessionary risk to GDP. Services consumption is more stable; durables is the volatile, leading component.',
          pitch:'70% of the US economy is consumer spending. When it weakens, corporate revenues fall, employment follows, and the policy response is inevitably monetary easing. That easing cycle — rate cuts, QE, balance sheet expansion — is the engine of hard asset re-rating. PCE deceleration is not just a data point: it is the precondition for the next monetary accommodation cycle that drives gold and hard assets.' },
        { id:'PSAVERT',         lbl:'SAVINGS RATE',      unit:'%',  threshold:null, invert:false, yoy:false, diff:false,
          desc:'Personal savings rate — rising signals consumer caution; falling signals excess spending funded by credit',
          def:'Bureau of Economic Analysis measure of personal saving as a percentage of disposable personal income. Personal saving is disposable income minus personal outlays (consumption, interest, and transfer payments). A rising savings rate indicates consumers are cautious and building financial buffers. A very low or negative rate suggests consumption is being funded by drawing down savings or increasing debt — unsustainable.',
          signal:'Above 6%: historically normal, conservative. 3-6%: moderate. Below 3%: consumers spending beyond income, debt-funded, unsustainable. Below 0%: drawdown of savings underway — a signal of near-term consumption strength followed by inevitable correction. Pre-2008 peak low of 2.5% was followed by the savings surge of 2009.',
          pitch:'A savings rate above 6% means affluent consumers are accumulating capital — and capital seeks a home. Alternative asset classes, including whisky casks, compete for that capital. A savings rate below 3% is a warning: consumer spending is borrowed from the future. When the correction comes and spending falls, GDP follows — and the defensive allocation conversation becomes urgent. The savings rate tells you where in the consumer cycle the conversation opportunity is greatest.' },
        { id:'CSCICP03USM665S', lbl:'CONF BOARD CI',     unit:'idx',threshold:100, invert:false, yoy:false, diff:false,
          desc:'Conference Board Consumer Confidence Index — 100=neutral; leading indicator of spending 6 months ahead',
          def:'Monthly survey of approximately 3,000 US households by The Conference Board measuring current business and employment conditions plus expectations for six months ahead. The composite index uses 1985 as a base of 100. The expectations component has particularly strong predictive power for consumer spending 6 months forward. Distinct from UMich Sentiment in methodology and question set — used together they provide a more complete picture.',
          signal:'Above 120: high confidence, strong spending expected. 100-120: moderate confidence, steady growth. 80-100: cautious, slowing likely. Below 80: pessimistic, recessionary. Below 70: deep pessimism, significant contraction likely. Rapid drops of 20+ points signal shock events (COVID, 2008, 9/11).',
          pitch:'Consumer confidence leading 6 months means the sales conversation that happens today is grounded in where spending will be in Q2 next year. When confidence is collapsing, the window for positioning in defensive real assets is now — not when the weakness shows up in retail data six months later. This is the indicator that gives you the professional edge: acting on forward-looking data before the backward-looking data confirms what you already know.' },
      ],
      uk_macro: [
        { id:'NAEXKP01GBQ657S', lbl:'UK REAL GDP',        unit:'%',  threshold:0,   invert:false, yoy:false, diff:false,
          desc:'UK real GDP quarterly growth rate — measures UK economic expansion or contraction (ONS via OECD/FRED)',
          def:'Quarterly estimate of UK gross domestic product adjusted for inflation, expressed as a percentage change from the prior quarter. Published by the Office for National Statistics and sourced via the OECD. The headline measure of UK economic output. Covers all goods and services produced in the United Kingdom in a given quarter.',
          signal:'Above +0.5% QoQ: solid expansion. 0 to +0.5%: sluggish growth. Negative: contraction. Two consecutive negative quarters: technical UK recession. UK GDP is more volatile than US, partly due to services concentration and trade exposure to the EU.',
          pitch:'UK economic contraction forces the Bank of England to choose between fighting inflation and supporting growth. In that dilemma, monetary policy eventually eases — base rate cuts, potential QE — and sterling weakens. A weaker pound amplifies gold returns in GBP terms. UK-produced Scotch whisky, priced globally in dollars but produced in sterling, benefits from currency dislocation: production costs fall in dollar terms while international demand remains dollar-priced.' },
        { id:'CPALTT01GBM659N', lbl:'UK CPI',              unit:'%',  threshold:2,   invert:true,  yoy:false, diff:false,
          desc:'UK Consumer Price Index YoY — the Bank of England\'s headline inflation benchmark (2% target)',
          def:'Office for National Statistics Consumer Prices Index measuring changes in a basket of approximately 700 goods and services purchased by UK households. The Bank of England\'s Monetary Policy Committee targets 2% CPI on the 12-month measure. Deviations of more than 1 percentage point from target require the Governor to write an open letter to the Chancellor explaining the deviation and the planned response.',
          signal:'Below 2%: below target, BoE bias toward easing. At 2%: on target. Above 3%: above target, restrictive bias. The MPC letter threshold at above 3% or below 1% signals the degree of policy divergence from target.',
          pitch:'UK inflation persistently above 2% compresses the purchasing power of sterling and UK savings. UK investors face the same dilemma as their US counterparts: cash in pounds is being eroded in real terms. Gold in sterling terms has provided consistent positive real returns through UK inflationary episodes. Scotch whisky, produced at sterling cost and sold at globally inflated prices, is a natural inflation hedge for the UK investor.' },
        { id:'CPGRLE01GBM659N', lbl:'UK CORE CPI',         unit:'%',  threshold:2,   invert:true,  yoy:false, diff:false,
          desc:'UK CPI ex food and energy — the persistent inflation component the Bank of England targets most closely',
          def:'UK Consumer Price Index excluding food, beverages, tobacco, and energy. Strips out the most volatile components to reveal the underlying trend of inflation in the UK economy. The Bank of England\'s Monetary Policy Committee places particular weight on core CPI when assessing whether inflation is entrenched. Services inflation — the largest component of core — has been particularly sticky in the UK post-pandemic.',
          signal:'Core below 2%: inflation normalised, rate cuts justified. Core 2-4%: sticky but manageable. Core above 4%: entrenched, BoE holds rates restrictive. UK services core has been particularly elevated due to wage growth in the NHS, hospitality, and professional services sectors.',
          pitch:'UK core inflation staying elevated locks the Bank of England into a restrictive stance even as headline CPI falls. Higher-for-longer UK rates compress gilt valuations, tighten mortgage conditions, and slow the economy. The UK investor seeking to preserve wealth in this environment needs assets uncorrelated to the rate cycle. Premium Scotch whisky casks — appreciated through every rate cycle in UK history — are produced on the same island where the policy restriction is being felt.' },
        { id:'LRHUTTTTGBM156S', lbl:'UK UNEMPLOYMENT',     unit:'%',  threshold:null,invert:true,  yoy:false, diff:false,
          desc:'UK unemployment rate (OECD harmonised) — measured consistently with international standards for comparison',
          def:'OECD harmonised unemployment rate for the United Kingdom, covering persons aged 15-74 who are without employment, available to start work in the next two weeks, and have been actively seeking employment in the past four weeks. The harmonisation methodology allows direct cross-country comparison. UK-specific measures from the ONS Labour Force Survey show similar trends.',
          signal:'Below 4%: tight UK labour market, wage pressure elevated. 4-5.5%: moderate, balanced. Above 5.5% and rising: labour market deteriorating, recessionary pressure. UK unemployment is structurally lower than US due to higher inactivity (those who have left the labour force entirely post-pandemic).',
          pitch:'UK unemployment rising signals that the Bank of England\'s rate medicine is working — but at a cost to workers. As the labour market softens, consumer confidence falls, sterling may weaken, and the BoE\'s policy path tilts toward cutting. Rate cuts in the UK, like in the US, expand the monetary base and support gold prices in GBP terms. The UK unemployment chart is a signal for UK-based clients of the forthcoming monetary easing cycle.' },
        { id:'IRLTLT01GBM156N', lbl:'UK 10Y GILT',         unit:'%',  threshold:null,invert:true,  yoy:false, diff:false,
          desc:'UK 10-Year Gilt yield — UK sovereign borrowing cost; rising gilts = fiscal and monetary stress signal',
          def:'The yield on UK 10-year Government bonds (gilts), the benchmark measure of UK sovereign borrowing costs. Unlike the US, the UK runs a persistent current account deficit and is dependent on foreign capital to finance its government deficit. Gilt yields above 4.5% historically attract international buyers; yields above 5% have triggered market stress events (the Truss mini-budget September 2022 being the most recent).',
          signal:'Gilt yield below 3.5%: accommodative, growth-supportive. 3.5-4.5%: normal range, policy neutral. Above 5%: elevated, fiscal stress risk. LDI pension fund stress occurs when gilts sell off rapidly — as in 2022. UK gilt volatility is higher than US Treasury volatility due to smaller market and fiscal exposure.',
          pitch:'The 2022 gilt crisis demonstrated that UK gilts are not the risk-free asset they are assumed to be. Pension funds with LDI strategies were forced into emergency asset sales when yields spiked. UK investors who held physical gold in sterling during that period saw their gold holdings appreciate as gilts collapsed. The lesson: no government bond is truly risk-free. Physical assets with no counterparty risk are the genuine safe haven.' },
        { id:'IRSTCI01GBM156N', lbl:'UK BASE RATE',        unit:'%',  threshold:null,invert:true,  yoy:false, diff:false,
          desc:'Bank of England official bank rate — the UK monetary policy instrument; sets sterling borrowing costs globally',
          def:'The Bank of England\'s Monetary Policy Committee sets the official bank rate, which directly influences UK short-term interest rates including savings accounts, overdrafts, tracker mortgages, and interbank lending. The BoE has operational independence from the UK government in setting monetary policy. Rate decisions are announced 8 times per year. The rate was held near zero from 2009 to 2021 — the longest period of ultra-loose policy in UK history.',
          signal:'Low and falling: accommodative, supports asset prices, weakens sterling. Rising cycle: tightening, strengthens sterling initially, compresses gilt values. Peak and pivot: historically associated with significant gold outperformance in GBP terms. The 2021-2024 hiking cycle from 0.1% to 5.25% was the steepest since 1988.',
          pitch:'The Bank of England rate cycle drives the mortgage market, the savings rate, and sterling. When it peaks and pivots — as it did in August 2024 — the rate-cut cycle begins. UK rate cuts reduce the return on cash savings accounts, which hold approximately GBP 800 billion across UK households. As that yield erodes, capital seeks alternatives. Gold in sterling has outperformed cash in every UK rate-cutting cycle. Whisky cask returns are entirely independent of the BoE rate decision.' },
      ],
    };

    var ALL_SERIES = [];
    Object.keys(SERIES_BY_TAB).forEach(function(tab) {
      SERIES_BY_TAB[tab].forEach(function(s) {
        if (!ALL_SERIES.find(function(x){ return x.id === s.id; })) {
          ALL_SERIES.push({ id: s.id, lbl: s.lbl, tab: tab, cfg: s });
        }
      });
    });

    function fmtVal(val, cfg) {
      if (val == null) return '--';
      var unit = cfg.unit;
      if (cfg.yoy || unit === '%') return val.toFixed(1) + '%';
      if (unit === '$m') {
        if (Math.abs(val) >= 1e6) return '$' + (val/1e6).toFixed(2) + 'T';
        if (Math.abs(val) >= 1e3) return '$' + (val/1e3).toFixed(1) + 'B';
        return '$' + val.toFixed(0) + 'M';
      }
      if (unit === '$bn') {
        if (Math.abs(val) >= 1000) return '$' + (val/1000).toFixed(1) + 'T';
        return '$' + Math.round(val).toLocaleString() + 'B';
      }
      if (unit === '$') {
        if (Math.abs(val) >= 100000) return '$' + Math.round(val/1000) + 'K';
        return '$' + val.toFixed(2);
      }
      if (unit === 'k') {
        if (cfg.diff) return (val >= 0 ? '+' : '') + Math.round(val) + 'K';
        if (Math.abs(val) >= 1000) return (val/1000).toFixed(1) + 'M';
        return Math.round(val).toLocaleString() + 'K';
      }
      return val.toFixed(1);
    }

    function fmtAxisVal(v, cfg) {
      if (cfg.zScore) return parseFloat(v.toFixed(1)) + 'z';
      if (cfg.yoy || cfg.unit === '%') return v.toFixed(1) + '%';
      if (cfg.unit === '$m') {
        if (Math.abs(v) >= 1e6) return '$' + (v/1e6).toFixed(1) + 'T';
        return '$' + (v/1e3).toFixed(0) + 'B';
      }
      if (cfg.unit === '$bn') {
        if (Math.abs(v) >= 1000) return '$' + (v/1000).toFixed(1) + 'T';
        return '$' + Math.round(v) + 'B';
      }
      if (cfg.unit === '$') {
        if (Math.abs(v) >= 100000) return '$' + Math.round(v/1000) + 'K';
        return '$' + v.toFixed(0);
      }
      if (cfg.unit === 'k') {
        if (Math.abs(v) >= 1000) return (v/1000).toFixed(1) + 'M';
        return Math.round(v) + 'K';
      }
      return parseFloat(v.toFixed(2)) + '';
    }

    function yoyCalc(obs) {
      if (!obs || obs.length < 13) return null;
      var curr = obs[obs.length-1].value, yr = obs[obs.length-13].value;
      return Math.round(((curr - yr) / Math.abs(yr)) * 1000) / 10;
    }

    function computeDisplayObs(rawObs, cfg) {
      if (!rawObs || rawObs.length < 2) return [];
      if (cfg.yoy) {
        var r = [];
        for (var i = 12; i < rawObs.length; i++) {
          var base = rawObs[i-12].value;
          if (base === 0) continue;
          r.push({ date: rawObs[i].date, value: ((rawObs[i].value - base) / Math.abs(base)) * 100 });
        }
        return r;
      }
      if (cfg.diff) {
        var r2 = [];
        for (var j = 1; j < rawObs.length; j++) {
          r2.push({ date: rawObs[j].date, value: rawObs[j].value - rawObs[j-1].value });
        }
        return r2;
      }
      return rawObs.slice();
    }

    function filterByPeriod(obs, period) {
      if (!period || period === 'MAX') return obs;
      var yrs = { '1Y':1, '3Y':3, '5Y':5 }[period] || 1;
      var cut = new Date();
      cut.setFullYear(cut.getFullYear() - yrs);
      var cutStr = cut.toISOString().slice(0, 10);
      var filtered = obs.filter(function(o){ return o.date >= cutStr; });
      return filtered.length >= 2 ? filtered : obs;
    }

    function toZScore(pts) {
      if (!pts || pts.length < 2) return pts;
      var vals = pts.map(function(p){ return p.value; });
      var mean = vals.reduce(function(s,v){ return s+v; }, 0) / vals.length;
      var variance = vals.reduce(function(s,v){ return s + (v-mean)*(v-mean); }, 0) / vals.length;
      var std = Math.sqrt(variance);
      if (std === 0) return pts;
      return pts.map(function(p){ return { date: p.date, value: (p.value - mean) / std }; });
    }

    function sma(pts, n) {
      if (!pts || pts.length < n) return [];
      var result = [];
      for (var i = n-1; i < pts.length; i++) {
        var sum = 0;
        for (var j = i-n+1; j <= i; j++) sum += pts[j].value;
        result.push({ date: pts[i].date, value: sum / n });
      }
      return result;
    }

    function bollinger(pts, n, k) {
      if (!pts || pts.length < n) return [];
      var result = [];
      for (var i = n-1; i < pts.length; i++) {
        var slice = pts.slice(i-n+1, i+1);
        var mean = slice.reduce(function(s,p){ return s+p.value; }, 0) / n;
        var std2 = Math.sqrt(slice.reduce(function(s,p){ return s+(p.value-mean)*(p.value-mean); }, 0) / n);
        result.push({ date: pts[i].date, upper: mean + k*std2, lower: mean - k*std2, middle: mean });
      }
      return result;
    }

    function niceStep(rawStep) {
      if (!rawStep || rawStep === 0) return 1;
      var mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
      var candidates = [1, 2, 2.5, 5, 10];
      var best = candidates[0] * mag;
      candidates.forEach(function(m) {
        var c = m * mag;
        if (Math.abs(c - rawStep) < Math.abs(best - rawStep)) best = c;
      });
      return best;
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
      ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
      ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
      ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
      ctx.closePath();
    }

    function toOHLC(pts) {
      var months = {};
      var keys = [];
      pts.forEach(function(p) {
        var m = p.date.slice(0, 7);
        if (!months[m]) { months[m] = { date: m + '-01', vals: [] }; keys.push(m); }
        months[m].vals.push(p.value);
      });
      keys.sort();
      var result = [];
      for (var i = 0; i < keys.length; i++) {
        var mk = keys[i];
        var mv = months[mk].vals;
        var prevClose = i > 0 ? months[keys[i-1]].vals[months[keys[i-1]].vals.length-1] : mv[0];
        var o = prevClose;
        var c = mv[mv.length-1];
        var h = Math.max.apply(null, mv.concat([o]));
        var lo = Math.min.apply(null, mv.concat([o]));
        result.push({ date: months[mk].date, open: o, high: h, low: lo, close: c });
      }
      return result;
    }

    function drawChart(ctx, W, H, rawPts, cfg, opts) {
      opts = opts || {};
      var mini = opts.mini;
      var chartType = opts.chartType || 'area';
      var padL = mini ? 44 : 58;
      var padR = mini ? 8 : 14;
      var padT = mini ? 8 : 12;
      var padB = mini ? 20 : 26;
      var cW = W - padL - padR;
      var cH = H - padT - padB;

      ctx.clearRect(0, 0, W, H);

      var pts = rawPts ? rawPts.slice() : [];
      if (opts.zScore && pts.length > 1) pts = toZScore(pts);

      if (!pts || pts.length < 2) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '9px Consolas,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NO DATA', W/2, H/2);
        return null;
      }

      var useLog = !!(opts.logScale && !opts.zScore && pts.every(function(p){ return p.value > 0; }));
      function toL(v) { return useLog ? Math.log(v) : v; }
      function fromL(v) { return useLog ? Math.exp(v) : v; }
      var axisCfg = opts.zScore ? { unit: 'z', zScore: true } : cfg;

      var allVals = pts.map(function(p){ return toL(p.value); });
      var cObs = opts.compare || [];
      /* overlays use independent y-scales — do NOT push their values into allVals */
      var bbBands = null;
      if (opts.showBB && pts.length >= 12) {
        bbBands = bollinger(pts, 12, 2);
        bbBands.forEach(function(b){ allVals.push(toL(b.upper)); allVals.push(toL(b.lower)); });
      }

      var minV = Math.min.apply(null, allVals);
      var maxV = Math.max.apply(null, allVals);
      var rangeV = maxV - minV || 0.001;
      var vpad = rangeV * 0.1;
      minV -= vpad; maxV += vpad;

      var minMs = new Date(pts[0].date).getTime();
      var maxMs = new Date(pts[pts.length-1].date).getTime();
      var rangeMs = maxMs - minMs || 1;

      function xOf(d) { return padL + (new Date(d).getTime() - minMs) / rangeMs * cW; }
      function yOf(v) { return padT + cH - (toL(v) - minV) / (maxV - minV) * cH; }
      function xToNearest(px) {
        var t = minMs + ((px - padL) / cW) * rangeMs;
        var best = pts[0]; var bestD = Infinity;
        pts.forEach(function(p) {
          var d = Math.abs(new Date(p.date).getTime() - t);
          if (d < bestD) { bestD = d; best = p; }
        });
        return best;
      }

      var step = niceStep((maxV - minV) / (mini ? 3 : 5));
      var yStart = Math.ceil((minV + step * 0.001) / step) * step;
      var fontSz = mini ? 7.5 : 9;

      ctx.save();
      ctx.font = fontSz + 'px Consolas,monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (var yv = yStart; yv <= maxV; yv += step) {
        var ry = padT + cH - (yv - minV) / (maxV - minV) * cH;
        if (ry < padT - 4 || ry > padT + cH + 4) continue;
        ctx.strokeStyle = yv === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth = yv === 0 ? 1 : 0.75;
        ctx.beginPath(); ctx.moveTo(padL, ry); ctx.lineTo(padL + cW, ry); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(fmtAxisVal(fromL(yv), axisCfg), padL - 5, ry);
      }
      ctx.restore();

      if (cfg.threshold != null && !opts.zScore) {
        var thL = useLog ? (cfg.threshold > 0 ? Math.log(cfg.threshold) : null) : cfg.threshold;
        if (thL != null && thL >= minV && thL <= maxV) {
          var thY = padT + cH - (thL - minV) / (maxV - minV) * cH;
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(padL, thY); ctx.lineTo(padL + cW, thY); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      if (opts.zScore) {
        [-2, -1, 1, 2].forEach(function(z) {
          if (z < minV || z > maxV) return;
          var zy = padT + cH - (z - minV) / (maxV - minV) * cH;
          ctx.save();
          ctx.strokeStyle = Math.abs(z) === 2 ? 'rgba(224,80,80,0.28)' : 'rgba(255,255,255,0.1)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(padL, zy); ctx.lineTo(padL+cW, zy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        });
      }

      var yr0 = new Date(minMs).getFullYear();
      var yr1 = new Date(maxMs).getFullYear();
      ctx.save();
      ctx.font = (mini ? 6.5 : 8) + 'px Consolas,monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      var xLabelStep = (yr1 - yr0) > 8 ? 2 : 1;
      for (var xyr = yr0+1; xyr <= yr1; xyr++) {
        if ((xyr - (yr0+1)) % xLabelStep !== 0) continue;
        var xt = new Date(xyr + '-01-01').getTime();
        if (xt < minMs || xt > maxMs) continue;
        var rx = padL + (xt - minMs) / rangeMs * cW;
        ctx.fillText(String(xyr).slice(2), rx, padT + cH + 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(rx, padT+cH); ctx.lineTo(rx, padT+cH+3); ctx.stroke();
      }
      ctx.restore();

      cObs.forEach(function(cmp, ci) {
        var cPts = cmp.pts || [];
        if (cPts.length < 2) return;
        var cCol = cmp.color || COMP_COLS[ci % COMP_COLS.length];

        /* Independent y-scale for this overlay — log-aware */
        var cVals = cPts.map(function(p){ return p.value; });
        var cUseLog = !!(useLog && cVals.every(function(v){ return v > 0; }));
        function cToL(v) { return cUseLog ? Math.log(v) : v; }
        function cFromL(v) { return cUseLog ? Math.exp(v) : v; }
        var cLVals = cVals.map(cToL);
        var cMinL = Math.min.apply(null, cLVals);
        var cMaxL = Math.max.apply(null, cLVals);
        var cRangeL = cMaxL - cMinL || 0.001;
        var cPadL = cRangeL * 0.1;
        cMinL -= cPadL; cMaxL += cPadL; cRangeL = cMaxL - cMinL;
        function cYof(v) { return padT + cH - (cToL(v) - cMinL) / cRangeL * cH; }

        /* Draw right-side axis for first overlay (non-mini) */
        if (ci === 0 && !mini) {
          var cStep = niceStep(cRangeL / 5);
          var cStart = Math.ceil((cMinL + cStep * 0.001) / cStep) * cStep;
          ctx.save();
          ctx.font = '7.5px Consolas,monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = cCol;
          for (var cv = cStart; cv <= cMaxL; cv += cStep) {
            var ry2 = padT + cH - (cv - cMinL) / cRangeL * cH;
            if (ry2 < padT - 4 || ry2 > padT + cH + 4) continue;
            var dispV = cFromL(cv);
            var lbl2 = Math.abs(dispV) >= 1000000 ? (dispV/1000000).toFixed(1)+'M' : Math.abs(dispV) >= 1000 ? (dispV/1000).toFixed(1)+'K' : parseFloat(dispV.toFixed(2))+'';
            ctx.fillText(lbl2, padL + cW + 4, ry2);
          }
          ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        cPts.forEach(function(p, i) {
          var px = xOf(p.date), py = cYof(p.value);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.strokeStyle = cCol;
        ctx.lineWidth = mini ? 1.2 : 1.8;
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.75;
        ctx.stroke();
        ctx.restore();
      });

      if (chartType === 'bar') {
        var zeroY2 = yOf(0);
        if (zeroY2 < padT) zeroY2 = padT;
        if (zeroY2 > padT + cH) zeroY2 = padT + cH;
        var barW = Math.max(1, Math.floor(cW / pts.length * 0.75));
        pts.forEach(function(p) {
          var bx = xOf(p.date);
          var by = yOf(p.value);
          var barY = Math.min(by, zeroY2);
          var barH = Math.max(1, Math.abs(by - zeroY2));
          ctx.fillStyle = p.value >= 0 ? 'rgba(68,204,100,0.72)' : 'rgba(224,80,80,0.72)';
          ctx.fillRect(bx - barW/2, barY, barW, barH);
        });
      } else if (chartType === 'candle') {
        var ohlcData = toOHLC(pts);
        var candleW = Math.max(2, Math.floor(cW / Math.max(ohlcData.length, 1) * 0.7));
        ohlcData.forEach(function(bar) {
          var bx = xOf(bar.date);
          var isGreen = bar.close >= bar.open;
          var col = isGreen ? '#44cc64' : '#e05050';
          var bodyTop = Math.min(yOf(bar.open), yOf(bar.close));
          var bodyBot = Math.max(yOf(bar.open), yOf(bar.close));
          var bodyH = Math.max(1, bodyBot - bodyTop);
          ctx.save();
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(bx, yOf(bar.high));
          ctx.lineTo(bx, yOf(bar.low));
          ctx.stroke();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = col;
          ctx.fillRect(bx - candleW/2, bodyTop, candleW, bodyH);
          ctx.restore();
        });
      } else if (chartType === 'step') {
        ctx.save();
        ctx.beginPath();
        var fp = pts[0];
        ctx.moveTo(xOf(fp.date), padT + cH);
        ctx.lineTo(xOf(fp.date), yOf(fp.value));
        for (var si = 1; si < pts.length; si++) {
          var spx = xOf(pts[si].date);
          ctx.lineTo(spx, yOf(pts[si-1].value));
          ctx.lineTo(spx, yOf(pts[si].value));
        }
        ctx.lineTo(xOf(pts[pts.length-1].date), padT + cH);
        ctx.closePath();
        var sgr = ctx.createLinearGradient(0, padT, 0, padT+cH);
        sgr.addColorStop(0, 'rgba(233,113,50,0.18)');
        sgr.addColorStop(1, 'rgba(233,113,50,0.01)');
        ctx.fillStyle = sgr;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(xOf(pts[0].date), yOf(pts[0].value));
        for (var si2 = 1; si2 < pts.length; si2++) {
          var spx2 = xOf(pts[si2].date);
          ctx.lineTo(spx2, yOf(pts[si2-1].value));
          ctx.lineTo(spx2, yOf(pts[si2].value));
        }
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = mini ? 1.5 : 2;
        ctx.lineJoin = 'miter';
        ctx.stroke();
        ctx.restore();
      } else {
        if (chartType === 'area') {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(xOf(pts[0].date), padT + cH);
          pts.forEach(function(p){ ctx.lineTo(xOf(p.date), yOf(p.value)); });
          ctx.lineTo(xOf(pts[pts.length-1].date), padT + cH);
          ctx.closePath();
          var agr = ctx.createLinearGradient(0, padT, 0, padT+cH);
          agr.addColorStop(0, 'rgba(233,113,50,0.22)');
          agr.addColorStop(1, 'rgba(233,113,50,0.01)');
          ctx.fillStyle = agr;
          ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath();
        pts.forEach(function(p, i) {
          var px = xOf(p.date), py = yOf(p.value);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = mini ? 1.5 : 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }

      if (opts.showBB && bbBands && bbBands.length > 1) {
        ctx.save();
        ctx.beginPath();
        bbBands.forEach(function(b, i){ i===0?ctx.moveTo(xOf(b.date),yOf(b.upper)):ctx.lineTo(xOf(b.date),yOf(b.upper)); });
        for (var bi = bbBands.length-1; bi >= 0; bi--) ctx.lineTo(xOf(bbBands[bi].date), yOf(bbBands[bi].lower));
        ctx.closePath();
        ctx.fillStyle = 'rgba(74,158,237,0.06)';
        ctx.fill();
        ctx.beginPath();
        bbBands.forEach(function(b, i){ i===0?ctx.moveTo(xOf(b.date),yOf(b.upper)):ctx.lineTo(xOf(b.date),yOf(b.upper)); });
        ctx.strokeStyle = 'rgba(74,158,237,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3,2]);
        ctx.stroke();
        ctx.beginPath();
        bbBands.forEach(function(b, i){ i===0?ctx.moveTo(xOf(b.date),yOf(b.lower)):ctx.lineTo(xOf(b.date),yOf(b.lower)); });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        bbBands.forEach(function(b, i){ i===0?ctx.moveTo(xOf(b.date),yOf(b.middle)):ctx.lineTo(xOf(b.date),yOf(b.middle)); });
        ctx.strokeStyle = 'rgba(74,158,237,0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      if (opts.showMA12 && pts.length >= 12) {
        var ma12 = sma(pts, 12);
        if (ma12.length > 1) {
          ctx.save();
          ctx.beginPath();
          ma12.forEach(function(p, i){ var px=xOf(p.date),py=yOf(p.value); i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
          ctx.strokeStyle = '#ffc83c';
          ctx.lineWidth = mini ? 1 : 1.4;
          ctx.stroke();
          ctx.restore();
        }
      }
      if (opts.showMA24 && pts.length >= 24) {
        var ma24 = sma(pts, 24);
        if (ma24.length > 1) {
          ctx.save();
          ctx.beginPath();
          ma24.forEach(function(p, i){ var px=xOf(p.date),py=yOf(p.value); i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
          ctx.strokeStyle = '#4caf7d';
          ctx.lineWidth = mini ? 1 : 1.4;
          ctx.stroke();
          ctx.restore();
        }
      }

      if (opts.showTrend && pts.length > 4) {
        var tn = pts.length, sX=0, sY=0, sXY=0, sX2=0;
        for (var ti=0; ti<tn; ti++) { var tYv = yOf(pts[ti].value); sX+=ti; sY+=tYv; sXY+=ti*tYv; sX2+=ti*ti; }
        var denom = tn*sX2 - sX*sX;
        if (denom !== 0) {
          var tSlope = (tn*sXY - sX*sY) / denom;
          var tInt = (sY - tSlope*sX) / tn;
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,100,0.55)';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(xOf(pts[0].date), tInt);
          ctx.lineTo(xOf(pts[tn-1].date), tSlope*(tn-1)+tInt);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      if (chartType !== 'bar' && chartType !== 'candle' && pts.length) {
        var lp = pts[pts.length-1];
        var lpx = xOf(lp.date), lpy = yOf(lp.value);
        ctx.save();
        ctx.fillStyle = ACCENT;
        ctx.strokeStyle = '#0d0d0d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(lpx, lpy, mini ? 3 : 4, 0, 2*Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      if (opts.crosshair && opts.crosshairX != null && opts.crosshairX >= padL && opts.crosshairX <= padL+cW) {
        var near = xToNearest(opts.crosshairX);
        var cx = xOf(near.date), cy = yOf(near.value);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT+cH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(padL+cW, cy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2*Math.PI); ctx.fill();
        var tipFs = mini ? 8 : 10;
        ctx.font = tipFs + 'px Consolas,monospace';
        var displayVal = opts.zScore ? near.value.toFixed(2) + 'z' : fmtVal(near.value, cfg);
        var tipTxt = near.date.slice(0, 7) + '   ' + displayVal;
        var tipW = ctx.measureText(tipTxt).width + 18;
        var tipH = tipFs + 10;
        var tipX = cx + 10; var tipY = cy - tipH/2;
        if (tipX + tipW > W - padR) tipX = cx - tipW - 10;
        if (tipY < padT) tipY = padT;
        if (tipY + tipH > padT + cH) tipY = padT + cH - tipH;
        ctx.fillStyle = 'rgba(13,13,13,0.92)';
        roundRect(ctx, tipX, tipY, tipW, tipH, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(233,113,50,0.4)';
        ctx.lineWidth = 0.75;
        roundRect(ctx, tipX, tipY, tipW, tipH, 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tipTxt, tipX+9, tipY+tipH/2);
        ctx.restore();
      }

      return { xOf: xOf, yOf: yOf, xToNearest: xToNearest, padL: padL, padR: padR, padT: padT, padB: padB };
    }

    function tabStatus(tabId, seriesMap) {
      var series = SERIES_BY_TAB[tabId] || [];
      var scores = [];
      series.forEach(function(cfg) {
        var raw = seriesMap[cfg.id];
        if (!raw || !raw.length) return;
        var disp = computeDisplayObs(raw, cfg);
        if (!disp.length) return;
        var latest = disp[disp.length-1].value;
        var score = 0;
        if (cfg.threshold != null) {
          score = cfg.invert ? (latest < cfg.threshold ? 1 : -1) : (latest > cfg.threshold ? 1 : -1);
        } else {
          var n12 = disp.slice(-13);
          if (n12.length >= 2) {
            var trend = n12[n12.length-1].value - n12[0].value;
            score = cfg.invert ? (trend < 0 ? 1 : -1) : (trend > 0 ? 1 : -1);
          }
        }
        scores.push(score);
      });
      if (!scores.length) return { lbl: 'LOADING', col: '#555555' };
      var avg = scores.reduce(function(a,b){ return a+b; }, 0) / scores.length;
      if (avg > 0.4) return { lbl: 'EXPANSIONARY', col: '#44cc64' };
      if (avg > 0) return { lbl: 'MIXED / POSITIVE', col: '#ffc83c' };
      if (avg > -0.4) return { lbl: 'MIXED / CAUTION', col: '#E97132' };
      return { lbl: 'CONTRACTIONARY', col: '#e05050' };
    }

    function salesAngle(tabId, seriesMap, status) {
      function getLat(id) {
        var cfg = null;
        var tabSeries = SERIES_BY_TAB[tabId] || [];
        tabSeries.forEach(function(s) { if (s.id === id) cfg = s; });
        if (!cfg) {
          Object.keys(SERIES_BY_TAB).forEach(function(t) {
            SERIES_BY_TAB[t].forEach(function(s) { if (s.id === id && !cfg) cfg = s; });
          });
        }
        var raw = seriesMap[id];
        if (!raw || !raw.length || !cfg) return null;
        var disp = computeDisplayObs(raw, cfg);
        return disp.length ? disp[disp.length - 1].value : null;
      }
      function fmt(v, dec) {
        if (v == null || isNaN(v)) return '--';
        return v.toFixed(dec != null ? dec : 1);
      }
      var v = {};
      if (tabId === 'cycle') {
        v.cfnai    = getLat('CFNAI');
        v.curve    = getLat('T10Y2YM');
        v.gdp      = getLat('A191RL1Q225SBEA');
      } else if (tabId === 'inflation') {
        v.cpi      = getLat('CPIAUCSL');
        v.corePCE  = getLat('PCEPILFE');
        v.ppi      = getLat('WPSFD49207');
      } else if (tabId === 'liquidity') {
        v.m2       = getLat('M2SL');
        v.walcl    = getLat('WALCL');
      } else if (tabId === 'rates') {
        v.ff       = getLat('FEDFUNDS');
        v.t10      = getLat('GS10');
        v.be       = getLat('T10YIEM');
      } else if (tabId === 'labour') {
        v.unrate   = getLat('UNRATE');
        v.claims   = getLat('ICSA');
        v.openings = getLat('JTSJOL');
      } else if (tabId === 'housing') {
        v.mtg      = getLat('MORTGAGE30US');
        v.hpi      = getLat('CSUSHPISA');
        v.sales    = getLat('EXHOSLUSM495S');
      } else if (tabId === 'consumer') {
        v.sent     = getLat('UMCSENT');
        v.save     = getLat('PSAVERT');
        v.retail   = getLat('RSAFS');
      } else if (tabId === 'uk_macro') {
        v.cpi      = getLat('CPALTT01GBM659N');
        v.base     = getLat('IRSTCI01GBM156N');
        v.gilt     = getLat('IRLTLT01GBM156N');
      }
      var cfnaiStr   = fmt(v.cfnai, 2);
      var curveStr   = fmt(v.curve, 2) + '%';
      var gdpStr     = fmt(v.gdp, 1) + '%';
      var cpiStr     = fmt(v.cpi, 1) + '%';
      var corePCEStr = fmt(v.corePCE, 1) + '%';
      var ppiStr     = fmt(v.ppi, 1) + '%';
      var m2Str      = fmt(v.m2, 1) + '%';
      var walclStr   = (v.walcl != null) ? '$' + (v.walcl / 1e6).toFixed(1) + 'tn' : '--';
      var ffStr      = fmt(v.ff, 2) + '%';
      var t10Str     = fmt(v.t10, 2) + '%';
      var beStr      = fmt(v.be, 2) + '%';
      var unrateStr  = fmt(v.unrate, 1) + '%';
      var claimsStr  = (v.claims != null) ? Math.round(v.claims) + 'K' : '--';
      var openStr    = (v.openings != null) ? (v.openings / 1000).toFixed(1) + 'M' : '--';
      var mtgStr     = fmt(v.mtg, 2) + '%';
      var hpiStr     = fmt(v.hpi, 1) + '% YoY';
      var salesStr   = (v.sales != null) ? (v.sales / 1000).toFixed(2) + 'M' : '--';
      var sentStr    = fmt(v.sent, 0);
      var saveStr    = fmt(v.save, 1) + '%';
      var retailStr  = fmt(v.retail, 1) + '% YoY';
      var ukCpiStr   = fmt(v.cpi, 1) + '%';
      var baseStr    = fmt(v.base, 2) + '%';
      var giltStr    = fmt(v.gilt, 2) + '%';
      var s = status.lbl;
      var pitches = {
        cycle: {
          EXPANSIONARY:      'Economic activity is broadening — CFNAI at ' + cfnaiStr + ' (above zero = expansion), yield curve ' + curveStr + ', real GDP ' + gdpStr + ' annualised. This phase supports asset prices broadly and positions whisky cask portfolios ahead of the next tightening cycle.',
          'MIXED / POSITIVE': 'The cycle is resilient but breadth is narrowing — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + ' annualised. Selective positioning in non-correlated assets before the late-cycle pivot is the disciplined move.',
          'MIXED / CAUTION':  'Late-cycle signals are accumulating — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + ' annualised. The lead indicators that preceded prior recessions are activating. This is the positioning window for defensive hard assets.',
          CONTRACTIONARY:    'Contraction confirmed — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + ' annualised. Central bank accommodation follows. Rate cuts and balance sheet expansion have driven gold\'s strongest historical performances. Physical assets outside the financial system preserve capital while paper assets reprice.'
        },
        inflation: {
          EXPANSIONARY:      'Inflationary pressure is rising — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ' (Fed target: 2%), PPI pipeline at ' + ppiStr + '. Real cash returns are negative. Every percentage point above risk-free rates is a direct cost of not owning real assets.',
          'MIXED / POSITIVE': 'Inflation is above target and trending — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ', PPI at ' + ppiStr + '. The window to position in inflation-linked real assets before the next print is now.',
          'MIXED / CAUTION':  'Inflation moderating but above the Fed target — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ' (target: 2%), PPI ' + ppiStr + '. Sticky services and shelter inflation keep the policy rate elevated — the opportunity cost of cash is still high.',
          CONTRACTIONARY:    'Disinflation is arriving — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. The rate pivot is approaching. The most powerful phase of gold bull markets begins as inflation falls and rates follow. Position before the pivot is official.'
        },
        liquidity: {
          EXPANSIONARY:      'Liquidity is expanding — M2 growing at ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. Money supply growth supports asset prices broadly. The monetary base is the foundation of the hard asset case.',
          'MIXED / POSITIVE': 'Liquidity conditions are mixed — M2 at ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. The Fed is navigating between tightening and stability. Monitor for the pivot signal.',
          'MIXED / CAUTION':  'Liquidity is tightening — M2 at ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. Bank credit and money supply growth are slowing. Defensive real assets are the prudent positioning before conditions deteriorate further.',
          CONTRACTIONARY:    'Liquidity contraction underway — M2 at ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. Credit conditions are tightening and the monetary base is shrinking. Hard assets with no counterparty risk — gold and physical commodities — outperform in this environment.'
        },
        rates: {
          EXPANSIONARY:      'The rate environment is becoming accommodative — Fed Funds ' + ffStr + ', 10Y Treasury ' + t10Str + ', 10Y breakeven ' + beStr + '. The opportunity cost of holding non-yielding assets is falling. This is the ideal positioning environment for gold.',
          'MIXED / POSITIVE': 'Rates are at or near peak — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven inflation ' + beStr + '. Every prior rate cycle peak has been followed by gold outperformance as the pivot approaches. The timing window is now.',
          'MIXED / CAUTION':  'Higher-for-longer — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Rate pressure is compressing equity multiples. But peak rates are also peak opportunity cost — the direction of travel favours hard assets.',
          CONTRACTIONARY:    'Rate stress — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Dollar strengthening and credit spreads widening signal risk-off conditions. Gold functions as the monetary hedge; whisky casks are entirely removed from the rate cycle.'
        },
        labour: {
          EXPANSIONARY:      'Strong labour markets — unemployment ' + unrateStr + ', initial claims ' + claimsStr + ', ' + openStr + ' job openings. Consumer confidence and premium spending capacity are elevated. Now is the time to capture allocations to alternative assets.',
          'MIXED / POSITIVE': 'Labour market breadth is narrowing — unemployment ' + unrateStr + ', initial claims ' + claimsStr + ', openings ' + openStr + '. Job openings falling while payrolls hold. The leading indicators say softening is coming. Position clients before the mainstream narrative catches up.',
          'MIXED / CAUTION':  'Labour market deterioration is building — unemployment ' + unrateStr + ', initial claims ' + claimsStr + ', openings ' + openStr + '. Rising claims and falling openings are the precursor to headline unemployment. Defensive positioning in hard assets is the advance move.',
          CONTRACTIONARY:    'Labour markets contracting — unemployment ' + unrateStr + ', initial claims ' + claimsStr + ', openings ' + openStr + '. The Fed easing cycle has been triggered. Rate cuts are coming. The gold re-rating has begun or is imminent. Physical assets are the positioning vehicle for the accommodation cycle.'
        },
        housing: {
          EXPANSIONARY:      'Housing demand is solid — 30Y mortgage rate ' + mtgStr + ', home prices ' + hpiStr + ', existing sales ' + salesStr + ' annualised. The property wealth effect is supporting consumer confidence and risk appetite.',
          'MIXED / POSITIVE': 'Housing is showing stress at the margins — 30Y mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + ' annualised. Affordability constraints are biting. Clients unable to deploy capital into property are actively seeking alternatives.',
          'MIXED / CAUTION':  'Housing affordability has deteriorated — 30Y mortgage ' + mtgStr + ', prices ' + hpiStr + ', existing sales ' + salesStr + ' annualised. Transaction volume is falling and buyers are locked out. Alternative stores of value — whisky casks, gold — are attracting displaced capital.',
          CONTRACTIONARY:    'Housing is contracting — 30Y mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + ' annualised. The traditional store of wealth is failing. Capital seeking appreciation in a non-mortgage-dependent asset is seeking exactly what we provide.'
        },
        consumer: {
          EXPANSIONARY:      'Consumer confidence and spending are strong — UMich sentiment ' + sentStr + ' (>90 = robust), savings rate ' + saveStr + ', retail sales ' + retailStr + '. Discretionary spending on premium goods and investment alternatives is at its highest. This is the accumulation phase for whisky cask portfolios.',
          'MIXED / POSITIVE': 'Consumer sentiment is solid but cautious — UMich ' + sentStr + ', savings rate ' + saveStr + ', retail ' + retailStr + '. Pre-positioning in hard assets before the sentiment turn is the disciplined advisor move.',
          'MIXED / CAUTION':  'Consumer confidence is deteriorating — UMich ' + sentStr + ', savings rate ' + saveStr + ', retail ' + retailStr + '. Savings are being drawn down. The defensive portfolio reallocation conversation is overdue for clients still 100% in traditional assets.',
          CONTRACTIONARY:    'Consumer retrenchment confirmed — UMich ' + sentStr + ', savings rate ' + saveStr + ', retail ' + retailStr + '. Spending is falling and sentiment is pessimistic. Hard assets with supply scarcity and global demand are the alternative to consumer-cyclical exposure.'
        },
        uk_macro: {
          EXPANSIONARY:      'The UK economy is in expansion — CPI ' + ukCpiStr + ' (target: 2%), BoE base rate ' + baseStr + ', 10Y gilt ' + giltStr + '. Bank of England policy is stable and Sterling is supported. UK-based investors have the confidence to commit capital to Scotch whisky casks and gold.',
          'MIXED / POSITIVE': 'UK growth is holding but indicators are mixed — CPI ' + ukCpiStr + ', BoE base rate ' + baseStr + ', 10Y gilt ' + giltStr + '. UK-specific macro risk is building — Scotch whisky, priced globally in dollars, offers a currency diversification benefit alongside appreciation.',
          'MIXED / CAUTION':  'UK macro conditions are deteriorating — CPI ' + ukCpiStr + ' (target: 2%), BoE rate ' + baseStr + ', 10Y gilt ' + giltStr + '. Sterling weakness amplifies gold returns in GBP terms. Scotch whisky production costs are sterling-denominated while sale prices are globally set — currency dislocation creates an asymmetric opportunity.',
          CONTRACTIONARY:    'The UK is in or near recession — CPI ' + ukCpiStr + ', BoE base rate ' + baseStr + ', 10Y gilt ' + giltStr + '. BoE rate cuts are coming. Sterling weakness and UK monetary easing are the dual catalyst for GBP-denominated hard asset performance. Scotch whisky sits at the intersection of UK supply and global dollar demand.'
        }
      };
      /* ── Lens-aware angle variants ── */
      var _lk = (window._assetLens && window._assetLens.key) || 'universal';
      var _taxL = ['eis','vct','offshore'];
      var _eqL  = ['pe','trusts'];

      if (_taxL.indexOf(_lk) !== -1) {
        var taxPitches = {
          cycle: {
            EXPANSIONARY:      'Business cycle CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + ' annualised. Expansion phases are the ideal vintage window for new EIS commitments — companies accessed at growth-cycle valuations deliver the strongest loss-relief-adjusted returns. This is the environment for adding to client EIS exposure while business conditions support underlying portfolio performance.',
            'MIXED / POSITIVE': 'Cycle breadth narrowing — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + ' annualised. Mixed signals favour VCT managers with defensive sector exposure: SaaS, healthcare services, and business services over consumer cyclicals. 30% upfront relief creates a structural return floor regardless of cycle direction.',
            'MIXED / CAUTION':  'Late-cycle signals building — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + '. VCT and EIS investments with contracted, recurring revenues outperform in cycle deterioration. The 30% income tax relief is realised immediately — portfolio-level performance is secondary to tax capture at commitment.',
            CONTRACTIONARY:    'Contraction confirmed — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + '. This is precisely when EIS loss relief becomes most valuable: downside is capped to 70p/£ after 30% relief and 45% loss relief on the remainder. Offshore investment bonds with gross roll-up allow repositioning without crystallising losses.'
          },
          inflation: {
            EXPANSIONARY:      'Inflationary pressure building — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. Real returns on cash are negative. The gross roll-up inside an offshore investment bond eliminates annual income tax drag — compounding at the pre-tax rate is the inflation protection that ISAs and GIAs cannot match.',
            'MIXED / POSITIVE': 'Inflation above target — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. EIS investments with pricing power — SaaS with index-linked contracts, healthcare services with fee escalators — protect against real value erosion inside a tax-efficient wrapper. VCT income is tax-free regardless of inflation level.',
            'MIXED / CAUTION':  'Sticky inflation — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. Higher-for-longer rates compress equity multiples but do not affect VCT distribution yield, which is tax-free. Offshore bond gross roll-up outperforms GIA alternatives by 45-55% over a decade at current inflation differentials.',
            CONTRACTIONARY:    'Disinflation — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. Rate pivot approaching. Gross roll-up inside offshore bonds captures the full pre-tax compounding that a falling rate environment delivers — without triggering income tax on each year\'s gain. Position in the bond before the pivot is confirmed.'
          },
          liquidity: {
            EXPANSIONARY:      'Liquidity expanding — M2 ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. Ample credit supports EIS portfolio company growth and VCT NAV appreciation. EIS managers in scale-up and growth equity see the strongest exit conditions when liquidity supports acquirer balance sheets.',
            'MIXED / POSITIVE': 'Mixed liquidity — M2 ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. EIS managers with conservative leverage in portfolio companies are better positioned for the tightening phase. VCT allocation to later-stage, cashflow-positive businesses is the prudent positioning.',
            'MIXED / CAUTION':  'Liquidity tightening — M2 ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. EIS and VCT companies relying on external capital face headwinds; those with internal cash generation are resilient. The 30% upfront relief on new EIS commitments provides immediate return regardless of exit timing.',
            CONTRACTIONARY:    'Liquidity contraction — M2 ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. Credit stress elevates the value of IHT-exempt EIS portfolios and loss-relief structures. Offshore bonds provide the gross roll-up that eliminates annual tax drag in conditions where investment returns are under pressure.'
          },
          rates: {
            EXPANSIONARY:      'Accommodative rates — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Falling rates compress the return on cash and bonds — the relative advantage of gross roll-up inside offshore investment bonds increases with every basis point cut. This is the rate environment that makes the offshore bond conversation easiest.',
            'MIXED / POSITIVE': 'Rates near peak — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Peak rates are the locking-in moment for offshore investment bond returns — gross roll-up captures the full pre-tax yield before rates and returns fall. Clients who commit at peak rates compound at the most favourable base for the cycle.',
            'MIXED / CAUTION':  'Higher-for-longer — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Elevated rates make gross roll-up in offshore bonds more valuable: the tax that would otherwise be paid annually on bond returns is deferred and potentially eliminated via top-slicing relief. Every year of deferral at current rates is meaningful.',
            CONTRACTIONARY:    'Rate stress — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. EIS and VCT performance is tax-certain regardless of rate direction: 30% relief is taken on input, not dependent on exit conditions. Offshore bonds sitting in gross roll-up are immune to rate volatility on the tax treatment of their returns.'
          },
          labour: {
            EXPANSIONARY:      'Tight labour markets — unemployment ' + unrateStr + ', initial claims ' + claimsStr + ', openings ' + openStr + '. Strong employment supports VCT portfolio company revenues and enables growth-stage EIS companies to scale. This is the labour environment where EIS commitments to services, technology, and healthcare see the strongest underlying performance.',
            'MIXED / POSITIVE': 'Labour softening — unemployment ' + unrateStr + ', claims ' + claimsStr + ', openings ' + openStr + '. EIS managers in asset-light, scalable business models are better positioned for labour cost normalisation. VCT managers with operational expertise — cost-out capability — create value as wage pressure eases.',
            'MIXED / CAUTION':  'Labour deteriorating — unemployment ' + unrateStr + ', claims ' + claimsStr + ', openings ' + openStr + '. EIS and VCT loss-relief structures provide the downside floor: even if portfolio companies face revenue pressure, the tax relief realised on commitment provides a structural return cushion.',
            CONTRACTIONARY:    'Labour contraction — unemployment ' + unrateStr + ', claims ' + claimsStr + ', openings ' + openStr + '. Rising unemployment triggers the BoE easing cycle. VCT distributions remain tax-free regardless of employment conditions. EIS IHT relief eliminates inheritance tax on portfolios held through the cycle.'
          },
          housing: {
            EXPANSIONARY:      'Housing demand solid — 30Y mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Property wealth effect is supporting VCT and EIS exit valuations for companies serving the construction and property services sector. Offshore bonds allow clients to compound property-adjacent gains without triggering CGT annually.',
            'MIXED / POSITIVE': 'Housing showing stress — mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Clients unable to deploy into property are actively seeking alternatives. EIS and VCT provide the tax-efficient vehicle for capital that cannot access the property market at current affordability levels.',
            'MIXED / CAUTION':  'Housing affordability deteriorated — mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Transaction volumes falling and buyers locked out. The conversation for clients sitting on large property profits is EIS and VCT: CGT reinvestment relief defers the property gain, 30% relief on the EIS commitment, and IHT exemption after 2 years.',
            CONTRACTIONARY:    'Housing contracting — mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Property as a traditional store of wealth is under pressure. EIS portfolios qualifying for IHT Business Relief are the alternative: illiquid, tax-sheltered, and uncorrelated to residential property transaction volumes.'
          },
          consumer: {
            EXPANSIONARY:      'Consumer confidence strong — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. High-confidence consumers are more receptive to tax planning conversations. EIS and VCT structuring is most easily completed when clients feel financially secure — this is the window to initiate and complete complex tax-efficient investment structures.',
            'MIXED / POSITIVE': 'Consumer cautious — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. VCT and EIS provide certainty in an uncertain consumer environment: 30% relief is taken regardless of market conditions. Offshore bond gross roll-up is independent of retail sales momentum.',
            'MIXED / CAUTION':  'Consumer deteriorating — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. Declining real incomes make tax efficiency arguments more compelling: 30% immediate relief on EIS, tax-free VCT dividends, and CGT deferral are measurable, certain outcomes in an environment where investment returns are uncertain.',
            CONTRACTIONARY:    'Consumer retrenchment — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. EIS loss relief is the structural floor: 45% of the net 70p investment is recoverable against income if a company fails. VCT distributions remain tax-free in a downturn. These are the certainties in an environment of uncertain consumer outcomes.'
          },
          uk_macro: {
            EXPANSIONARY:      'UK economy expanding — CPI ' + ukCpiStr + ' (target: 2%), BoE base ' + baseStr + ', 10Y gilt ' + giltStr + '. Positive UK macro supports VCT and EIS portfolio company revenues. UK-domiciled investors benefit: EIS and VCT are UK-specific schemes; this is the environment where UK tax-efficient structures deliver the strongest combination of tax relief and underlying performance.',
            'MIXED / POSITIVE': 'UK mixed signals — CPI ' + ukCpiStr + ', BoE base ' + baseStr + ', gilt ' + giltStr + '. UK-specific tax wrappers (EIS, VCT, offshore bonds) are independent of UK macro direction: 30% relief and tax-free VCT income are legislated certainties, not macro-dependent outcomes. The wrappers work regardless of the growth rate.',
            'MIXED / CAUTION':  'UK conditions deteriorating — CPI ' + ukCpiStr + ', BoE ' + baseStr + ', gilt ' + giltStr + '. The case for offshore investment bonds strengthens when UK macro is weak: gross roll-up inside an offshore bond avoids the annual income tax drag that makes GIA returns more painful in a slower-growth environment. Tax certainty is the alternative to macro uncertainty.',
            CONTRACTIONARY:    'UK in or near recession — CPI ' + ukCpiStr + ', BoE ' + baseStr + ', gilt ' + giltStr + '. BoE rate cuts are building — the gross roll-up inside offshore investment bonds will benefit from the full pre-tax compounding of falling rates without annual income tax crystallisation. EIS IHT relief ensures that even in a downturn, estate planning objectives are met.'
          }
        };
        var tabTaxPitches = taxPitches[tabId] || taxPitches.cycle;
        return tabTaxPitches[s] || tabTaxPitches['MIXED / CAUTION'];
      }

      if (_eqL.indexOf(_lk) !== -1) {
        var eqPitches = {
          cycle: {
            EXPANSIONARY:      'Business cycle expanding — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + ' annualised. Late-cycle expansion is when PE exit multiples are highest and investment trust discounts have typically compressed from their crisis wides. The active positioning question for trusts is not whether to own the cycle — it is which closed-end structures still trade at discounts despite the recovery.',
            'MIXED / POSITIVE': 'Cycle breadth narrowing — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + ' annualised. Mixed signals favour trusts with contracted, non-GDP-correlated revenues: infrastructure, renewable energy, specialist lending. Discounts in these sectors have not compressed with the cycle — they are the late-cycle positioning opportunity.',
            'MIXED / CAUTION':  'Late-cycle — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + '. Investment trust discounts widen in uncertainty. Closed-end structures cannot be forced to sell — the discount widens on paper but the portfolio is intact. This is the entry point, not the exit. PE J-curve exposure initiated in late-cycle draws at the most favourable vintage points.',
            CONTRACTIONARY:    'Contraction — CFNAI ' + cfnaiStr + ', yield curve ' + curveStr + ', GDP ' + gdpStr + '. Investment trust discounts at maximum — the historically most profitable entry point for closed-end vehicles. No redemption pressure means managers can hold through the dislocation. PE co-investments in distressed situations and secondary purchases of PE fund interests are available at deepest discounts in this environment.'
          },
          inflation: {
            EXPANSIONARY:      'Inflation rising — CPI ' + cpiStr + ' YoY, Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. Infrastructure trusts with RPI/CPI-linked revenues reprice upward in real terms. This is the environment where inflation-linked trust NAVs diverge most sharply from NAV-insensitive trust prices — creating a fundamental mispricing that patient investors capture.',
            'MIXED / POSITIVE': 'Inflation above target — CPI ' + cpiStr + ', Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. The trust structures that benefit most from persistent inflation are those with contractual revenue indexation: regulated utilities, PFI, social housing. Their NAVs are compounding in real terms while their discounts reflect market pessimism.',
            'MIXED / CAUTION':  'Sticky inflation — CPI ' + cpiStr + ', Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. Inflation-linked infrastructure and renewable trusts are the few asset classes where high inflation is accretive to NAV. Trust managers with RPI-linked contracts are the structural beneficiaries of every percentage point above target.',
            CONTRACTIONARY:    'Disinflation — CPI ' + cpiStr + ', Core PCE ' + corePCEStr + ', PPI ' + ppiStr + '. Rate pivot approaching. Infrastructure trust discounts typically compress most sharply in the transition from high inflation to disinflation and rate cuts: the period of maximum compression opportunity for patient trust investors begins here.'
          },
          liquidity: {
            EXPANSIONARY:      'Liquidity expanding — M2 ' + m2Str + ' YoY, Fed balance sheet ' + walclStr + '. QE periods are the most powerful drivers of investment trust discount compression: institutional capital flows back into listed vehicles, discounts narrow from wide to premium. Renewable energy and infrastructure trusts have historically been the primary beneficiaries of each QE cycle.',
            'MIXED / POSITIVE': 'Mixed liquidity — M2 ' + m2Str + ' YoY, balance sheet ' + walclStr + '. Monitor RRP drain as the signal for the end of excess liquidity. When excess reserve balances approach zero, the trust discount widening cycle typically begins — providing the entry point for the subsequent compression trade.',
            'MIXED / CAUTION':  'Liquidity tightening — M2 ' + m2Str + ' YoY, balance sheet ' + walclStr + '. Trust discounts widening as institutional capital leaves listed vehicles. The closed-end structure means managers cannot be forced to sell at trough prices — the NAV holds while the discount widens, creating the entry point.',
            CONTRACTIONARY:    'Liquidity contraction — M2 ' + m2Str + ' YoY, balance sheet ' + walclStr + '. Maximum trust discount widening. Infrastructure and renewable energy trusts historically trading at widest discounts to NAV. This phase precedes the QE/easing cycle that drives the compression — the entry-point window is now.'
          },
          rates: {
            EXPANSIONARY:      'Accommodative rates — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Infrastructure trust NAVs are rising as discount rates fall. Each 25bp cut increases NPV of contracted cash flows by 1-2% — trusts with 20-30 year contracts see the most significant NAV uplift. The rate cut cycle is the trust investor\'s most reliable re-rating driver.',
            'MIXED / POSITIVE': 'Rates near peak — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Every prior rate peak has been followed by trust discount compression. The trusts currently trading at widest discounts to stale NAV — infrastructure, renewable energy, specialist finance — are positioned to benefit most from the first cut. This is the staging point.',
            'MIXED / CAUTION':  'Higher-for-longer — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Rate pressure keeping trust discounts wide. This is the accumulation phase: building positions in quality infrastructure and renewable trusts at the widest discounts of the cycle, before the rate pivot compresses them.',
            CONTRACTIONARY:    'Rate stress — Fed Funds ' + ffStr + ', 10Y ' + t10Str + ', breakeven ' + beStr + '. Trust discounts at maximum. The mechanism is well-established: high rates → high discount rate → wide NAV discounts → eventual rate cuts → NPV re-rating → discount compression. We are at the widest point before the compression trade begins.'
          },
          labour: {
            EXPANSIONARY:      'Tight labour — unemployment ' + unrateStr + ', claims ' + claimsStr + ', openings ' + openStr + '. PE portfolio companies with pricing power are raising prices ahead of wage costs. Trust managers with operational improvement focus are capturing the margin expansion that scale creates when labour markets are tight and revenue growth covers cost.',
            'MIXED / POSITIVE': 'Labour softening — unemployment ' + unrateStr + ', claims ' + claimsStr + ', openings ' + openStr + '. Job openings leading payrolls — the margin expansion is coming. PE managers who built position in labour-intensive businesses at peak wage costs are now seeing the operating leverage materialise as the cost base normalises.',
            'MIXED / CAUTION':  'Labour market deteriorating — unemployment ' + unrateStr + ', claims ' + claimsStr + ', openings ' + openStr + '. PE managers with buy-and-build strategies are acquiring at falling entry multiples — the vintage point is improving as cycle deterioration reduces competition for assets. Investment trust managers with essential services exposure are seeing relative NAV resilience.',
            CONTRACTIONARY:    'Labour contraction — unemployment ' + unrateStr + ', claims ' + claimsStr + ', openings ' + openStr + '. PE co-investments at distressed valuations and secondary market LP interest purchases at widest discounts are available in this environment. Investment trust dividend heroes — those with covered, non-GDP-sensitive distributions — are the defensive trust positions through the employment cycle.'
          },
          housing: {
            EXPANSIONARY:      'Housing demand solid — mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Property trust NAVs are stable to appreciating. Trusts with residential rental, student accommodation, and build-to-rent exposure benefit from underlying asset appreciation — and their closed-end structure provides the liquidity that direct property investment does not.',
            'MIXED / POSITIVE': 'Housing stressed — mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Rental demand is benefiting from ownership affordability crisis. Build-to-rent trusts and student accommodation REITs are capturing the structural demand from buyers who cannot purchase. Trust discounts in this sector are not reflecting the NAV resilience.',
            'MIXED / CAUTION':  'Housing deteriorating — mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Transaction volumes collapsing and price discovery impaired. Property trust NAVs are being marked down — but the discount-to-NAV remains the entry signal. Specialist property trusts with operational platforms outperform passive REIT exposure in down markets.',
            CONTRACTIONARY:    'Housing contracting — mortgage ' + mtgStr + ', prices ' + hpiStr + ', sales ' + salesStr + '. Property trust discounts at maximum. The trust structure — professional asset management, portfolio diversification, no forced selling — outperforms direct ownership in down markets. The recovery trade is built on buying quality property trusts at the widest discounts.'
          },
          consumer: {
            EXPANSIONARY:      'Consumer confidence strong — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. Trust sectors with consumer-facing exposure — leisure, retail property, premium consumer — are performing. PE managers with consumer-discretionary portfolio companies are seeing the exit conditions that generate the strongest DPI for LPs.',
            'MIXED / POSITIVE': 'Consumer cautious — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. Trust managers rotating toward essential services and away from consumer discretionary are the active-management beneficiaries of the mixed environment. PE managers with B2B, SaaS, and healthcare exposure are less exposed to consumer spending cycle risk.',
            'MIXED / CAUTION':  'Consumer deteriorating — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. Closed-end trust structures cannot be forced to sell at consumer-driven trough prices — the discount widens but the portfolio is intact. Infrastructure and specialist lending trusts with non-consumer revenues are the defensive sector rotation within the listed closed-end universe.',
            CONTRACTIONARY:    'Consumer retrenchment — UMich ' + sentStr + ', savings ' + saveStr + ', retail ' + retailStr + '. PE secondary market purchases of LP interests in consumer-cyclical funds are available at maximum discounts. Infrastructure trust discounts diverge from consumer trust discounts — the non-correlated revenue case is validated in real-time by the sector data.'
          },
          uk_macro: {
            EXPANSIONARY:      'UK expanding — CPI ' + ukCpiStr + ', BoE base ' + baseStr + ', gilt ' + giltStr + '. UK listed infrastructure, renewable energy, and specialist investment trusts are the primary beneficiary of UK macro recovery. Trust discounts are compressing as gilt yields normalise and institutional capital returns to UK listed closed-end vehicles.',
            'MIXED / POSITIVE': 'UK mixed — CPI ' + ukCpiStr + ', BoE ' + baseStr + ', gilt ' + giltStr + '. UK investment trusts with non-UK portfolio exposure are benefiting from sterling weakness and international diversification. Global infrastructure trusts with GBP reporting see NAV uplift from dollar-denominated assets.',
            'MIXED / CAUTION':  'UK deteriorating — CPI ' + ukCpiStr + ', BoE ' + baseStr + ', gilt ' + giltStr + '. UK gilt yields at elevated levels are the trust investor\'s entry signal. UK infrastructure trust discounts are widest when gilts are highest — and they compress most sharply when the BoE cuts. The gilt chart is the trust positioning guide.',
            CONTRACTIONARY:    'UK in or near recession — CPI ' + ukCpiStr + ', BoE ' + baseStr + ', gilt ' + giltStr + '. BoE rate cuts building. UK infrastructure and renewable energy trust discounts at maximum. Each cut in the BoE rate cycle directly reduces the discount rate applied to trust cash flows — the magnitude of discount compression is historically largest from the widest entry points.'
          }
        };
        var tabEqPitches = eqPitches[tabId] || eqPitches.cycle;
        return tabEqPitches[s] || tabEqPitches['MIXED / CAUTION'];
      }

      var tabPitches = pitches[tabId] || pitches.cycle;
      return tabPitches[s] || tabPitches['MIXED / CAUTION'];
    }

    function tileHTML(cfg, data) {
      var disp = data ? computeDisplayObs(data, cfg) : [];
      var latest = disp.length ? disp[disp.length-1] : null;
      var prev12 = disp.length > 12 ? disp[disp.length-13] : null;
      var change = (latest && prev12) ? (latest.value - prev12.value) : null;
      var latestStr = latest ? fmtVal(latest.value, cfg) : '--';
      var chgStr = (change != null) ? ((change >= 0 ? '+' : '') + change.toFixed(2)) : '';
      var chgCol = change == null ? '#ffffff' : (change >= 0 ? (cfg.invert ? '#e05050' : '#44cc64') : (cfg.invert ? '#44cc64' : '#e05050'));

      return '<div class="bc-tile" data-id="' + cfg.id + '" style="' +
        'background:#0d0d0d;border:1px solid #1e1e1e;border-radius:4px;padding:10px 12px 0 12px;' +
        'cursor:pointer;display:flex;flex-direction:column;min-height:140px;position:relative;' +
        'transition:border-color 0.15s;">' +
        '<div style="font-size:9px;letter-spacing:.18em;color:' + ACCENT + ';margin-bottom:3px;">' + cfg.id + '</div>' +
        '<div style="font-size:12px;font-weight:700;color:#ffffff;letter-spacing:.04em;margin-bottom:2px;">' + cfg.lbl + '</div>' +
        '<div style="font-size:9.5px;color:#ffffff;margin-bottom:6px;line-height:1.45;">' + (cfg.desc || '') + '</div>' +
        '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">' +
        '<span style="font-size:16px;font-weight:700;color:#ffffff;' + F + '">' + latestStr + '</span>' +
        (chgStr ? '<span style="font-size:11px;font-weight:600;color:' + chgCol + ';">' + chgStr + '</span>' : '') +
        '</div>' +
        '<canvas class="bc-tile-canvas" style="flex:1;width:100%;min-height:58px;display:block;margin:0 -0px;border-radius:0 0 4px 4px;"></canvas>' +
        '</div>';
    }

    function attachTileChart(tile, cfg, rawObs) {
      var canvas = tile.querySelector('.bc-tile-canvas');
      if (!canvas) return;
      var dpr = window.devicePixelRatio || 1;
      var tileState = { period: '5Y', chartType: 'area', showMA12: false, showMA24: false, showBB: false, zScore: false, logScale: false, showTrend: false };

      function redraw() {
        var W = canvas.clientWidth, H = canvas.clientHeight;
        if (!W || !H) return;
        /* Account for CSS zoom on parent (widget zoom buttons) */
        var rect = canvas.getBoundingClientRect();
        var sx = rect.width  > 0 ? (rect.width  / W) * dpr : dpr;
        var sy = rect.height > 0 ? (rect.height / H) * dpr : dpr;
        canvas.width  = Math.round(rect.width  > 0 ? rect.width  * dpr : W * dpr);
        canvas.height = Math.round(rect.height > 0 ? rect.height * dpr : H * dpr);
        var ctx = canvas.getContext('2d');
        ctx.scale(sx, sy);
        var disp = computeDisplayObs(rawObs, cfg);
        var filtered = filterByPeriod(disp, tileState.period);
        drawChart(ctx, W, H, filtered, cfg, { mini: true, chartType: tileState.chartType, showMA12: tileState.showMA12, showMA24: tileState.showMA24, showBB: tileState.showBB, zScore: tileState.zScore, logScale: tileState.logScale, showTrend: tileState.showTrend });
      }

      tile.addEventListener('click', function() { openFredModal(cfg, rawObs, tileState); });

      canvas.addEventListener('bc-redraw', function() { redraw(); });
      var ro = new ResizeObserver(function() { redraw(); });
      ro.observe(tile);
      redraw();
    }

    var MM_INSTRUMENTS = [
      { id:'GOLDAMGBD228NLBM',   lbl:'GOLD (USD/oz)',        src:'macro' },
      { id:'DCOILWTICO',         lbl:'WTI OIL (USD/bbl)',    src:'macro' },
      { id:'SP500',              lbl:'S&P 500',               src:'macro' },
      { id:'NASDAQCOM',          lbl:'NASDAQ',                src:'macro' },
      { id:'DTWEXBGS',           lbl:'DXY DOLLAR INDEX',      src:'macro' },
      { id:'BAMLH0A0HYM2',       lbl:'HY CREDIT SPREAD',     src:'macro' },
      { id:'GS10',               lbl:'10Y TREASURY',          src:'macro' },
      { id:'FEDFUNDS',           lbl:'FED FUNDS RATE',        src:'macro' },
      { id:'DCOILBRENTEU',       lbl:'BRENT OIL (USD/bbl)',   src:'macro' },
      { id:'WTISPLC',            lbl:'WTI SPOT',              src:'macro' },
    ];

    var FRED_CMP_OPTIONS = [
      { id:'CFNAI',              lbl:'CFNAI ACTIVITY',        tab:'cycle'    },
      { id:'USALOLITONOSTSAM',    lbl:'OECD CLI (USA)',         tab:'cycle'    },
      { id:'INDPRO',             lbl:'INDUSTRIAL PROD',       tab:'cycle'    },
      { id:'T10Y2YM',            lbl:'YIELD CURVE',           tab:'cycle'    },
      { id:'CPIAUCSL',           lbl:'CPI ALL ITEMS',         tab:'inflation'},
      { id:'CPILFESL',           lbl:'CORE CPI',              tab:'inflation'},
      { id:'PCEPI',              lbl:'PCE DEFLATOR',          tab:'inflation'},
      { id:'PCEPILFE',           lbl:'CORE PCE',              tab:'inflation'},
      { id:'M2SL',               lbl:'M2 MONEY SUPPLY',       tab:'liquidity'},
      { id:'WALCL',              lbl:'FED BALANCE SHEET',     tab:'liquidity'},
      { id:'GS10',               lbl:'10Y TREASURY',          tab:'rates'    },
      { id:'GS2',                lbl:'2Y TREASURY',           tab:'rates'    },
      { id:'FEDFUNDS',           lbl:'FED FUNDS RATE',        tab:'rates'    },
      { id:'DTWEXBGS',           lbl:'DOLLAR INDEX',          tab:'rates'    },
      { id:'PAYEMS',             lbl:'NONFARM PAYROLLS',      tab:'labour'   },
      { id:'JTSJOL',             lbl:'JOB OPENINGS',          tab:'labour'   },
      { id:'ICSA',               lbl:'INITIAL CLAIMS',        tab:'labour'   },
      { id:'HOUST',              lbl:'HOUSING STARTS',        tab:'housing'  },
      { id:'CSUSHPISA',          lbl:'CASE-SHILLER HPI',      tab:'housing'  },
      { id:'MORTGAGE30US',       lbl:'MORTGAGE RATE 30Y',     tab:'housing'  },
      { id:'UMCSENT',            lbl:'UMICH SENTIMENT',       tab:'consumer' },
      { id:'RSAFS',              lbl:'RETAIL SALES',          tab:'consumer' },
      { id:'PSAVERT',            lbl:'SAVINGS RATE',          tab:'consumer' },
      { id:'NAEXKP01GBQ657S',    lbl:'UK REAL GDP',           tab:'uk_macro' },
      { id:'CPALTT01GBM659N',    lbl:'UK CPI',                tab:'uk_macro' },
      { id:'IRLTLT01GBM156N',    lbl:'UK 10Y GILT',           tab:'uk_macro' },
    ];

    function openFredModal(cfg, rawObs, tileState) {
      var existingModal = document.getElementById('fred-modal-overlay');
      if (existingModal) existingModal.remove();

      var overlay = document.createElement('div');
      overlay.id = 'fred-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.82);';

      var modal = document.createElement('div');
      modal.style.cssText = 'background:#0d0d0d;border:1px solid #252525;border-radius:6px;width:900px;max-width:96vw;height:580px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;font-family:Consolas,monospace;';

      var modalState = {
        chartType: (tileState && tileState.chartType) || 'area',
        period: (tileState && tileState.period) || '5Y',
        showMA12: false, showMA24: false, showBB: false,
        zScore: false, logScale: false, showTrend: false,
        crosshairX: null,
        cmpList: [],
        viewStart: 0,
        viewEnd: 1
      };

      var cmpData = {};

      function buildCmpOptgroups() {
        var opts = '<option value="">+ ADD OVERLAY</option>';
        opts += '<optgroup label="MACRO MONITOR INSTRUMENTS">';
        MM_INSTRUMENTS.forEach(function(m) {
          opts += '<option value="macro:' + m.id + '">' + m.lbl + '</option>';
        });
        opts += '</optgroup>';
        opts += '<optgroup label="FRED MACRO SERIES">';
        FRED_CMP_OPTIONS.forEach(function(f) {
          opts += '<option value="fred:' + f.id + '"> [' + f.tab.toUpperCase() + '] ' + f.lbl + '</option>';
        });
        opts += '</optgroup>';
        return opts;
      }

      var PITCH_BY_LENS = {
        tax: {
          /* CYCLE */
          'CFNAI':'CFNAI approaching -0.70 marks deteriorating business conditions — and the environment where EIS and VCT wrappers earn their keep. The 30% income tax relief is realised regardless of market direction, structurally reducing your client\'s effective entry cost by nearly a third before a single company grows. Recession vintages have historically delivered the strongest EIS and VCT fund returns: distressed valuations, reduced competition, and motivated management teams are the ingredients of outsized returns for patient, tax-efficient capital.',
          'USALOLITONOSTSAM':'The OECD CLI rolling below 100 gives your client a 6-9 month lead on consensus — the difference between a peak-cycle and a trough-cycle EIS vintage. Businesses backed when the CLI is turning down are typically acquired at lower valuations, with management teams incentivised by adversity, and exits timed into the subsequent recovery. The tax relief makes the already-compelling risk/return profile of downturn vintages structurally superior to anything available on public markets.',
          'INDPRO':'Industrial production contraction hits the early-stage manufacturing and technology sectors where EIS-qualifying companies concentrate — and where the deepest value in downturn vintages is created. When INDPRO turns negative, experienced EIS managers deploy into companies building the next cycle\'s infrastructure at recession valuations. The 30% tax relief and loss relief provisions mean your client\'s effective downside is structurally capped while the upside follows the eventual industrial recovery.',
          'T10Y2YM':'Yield curve inversion is the market\'s signal that rates will fall and growth will slow — the environment in which tax-efficient compounding becomes most powerful. Offshore bond structures benefit from gross roll-up during the high-rate phase, with the option to time encashment into the anticipated lower-rate, lower-income future. For VCT and EIS investors, inversion signals the vintage window: deploy now, before the rate pivot inflates early-stage valuations, and realise the 30% tax relief at today\'s higher income tax rates.',
          'UNRATE':'Rising unemployment triggers the monetary easing cycle — and EIS and VCT allocations are specifically designed for this phase of the business cycle. The UK government created these structures to direct private capital into early-stage UK businesses during economic stress. Your client who allocates when unemployment is rising captures the 30% tax relief at full value, backs companies at cycle-low valuations, and positions for exits timed into the recovery. The fiscal incentive and the economic cycle are pointing in the same direction.',
          'A191RL1Q225SBEA':'Negative GDP is the recession confirmation that unlocks the best EIS and VCT vintage timing. Companies backed in negative-GDP quarters are acquired cheapest, incentivised hardest, and managed most carefully — producing the strongest 5-7 year realised returns in the asset class. The 30% income tax relief provides structural downside protection. For a client allocating into a certified HMRC-approved fund during a GDP contraction, the effective entry cost is reduced by nearly a third before performance is even considered.',
          /* INFLATION */
          'CPIAUCSL':'CPI above 3% erodes the real value of cash, fixed-income coupon payments, and taxable savings interest simultaneously. Offshore bonds compound gross of UK income tax, protecting the real return from the tax drag that compounds with every year of elevated inflation. VCT dividends are explicitly tax-free — delivering inflation-adjusted income that does not erode through the tax mechanism that destroys cash savers. The inflation environment is precisely the argument for sheltering returns inside a tax-efficient wrapper.',
          'CPILFESL':'Sticky core CPI keeps the Bank of England in restrictive mode — and that environment directly amplifies the advantage of gross roll-up in offshore bond structures. Every year your client\'s bond portfolio compounds without an income tax deduction is a year where the compounding base grows relative to the post-tax alternative. Core CPI above 3% is not just an argument for inflation protection — it is an argument for restructuring how returns are taxed as they accumulate.',
          'PCEPI':'PCE above 2% is the Fed\'s signal to remain restrictive — sustaining the high-rate environment in which tax-efficient wrappers deliver their most significant structural advantage. An offshore bond at 5% gross compounded over a decade produces materially more than the same return taxed annually at 40% or 45%. While the Fed holds rates elevated, the gross roll-up advantage inside the bond structure accumulates with every year of inaction on encashment.',
          'PCEPILFE':'Core PCE above 2% is the Federal Reserve\'s scorecard for sustained inflation. While it remains elevated, interest rates stay higher-for-longer — and high rates sustained over time are the compounding advantage inside gross roll-up structures. Every 0.1% that core PCE holds above target is another period in which an offshore bond or onshore investment bond compounds without income tax deduction. Your client\'s adviser should be structuring to own the compounding period, not taxing it away.',
          'CUSR0000SAH1':'Shelter inflation above 4% suppresses property transaction volumes and traps homeowners in mortgages they cannot afford to move. Capital that cannot access property seeks alternative stores of value in tax-efficient wrappers. EIS-qualifying property technology companies, VCTs investing in PropTech and homebuilding innovation, and offshore bonds invested in diversified real assets all offer exposures that the traditional property market cannot deliver in a rate-locked environment.',
          'WPSFD49207':'PPI falling before CPI signals that producer margins are recovering before consumer prices follow — the early stages of the disinflationary transition. For EIS-backed manufacturing and consumer-facing businesses, margin recovery in this window drives the valuation uplift that makes EIS returns. Your client\'s EIS portfolio captures this margin recovery without any income tax, CGT, or inheritance tax liability if structured correctly from the outset.',
          /* LIQUIDITY */
          'M2SL':'M2 expansion creates a monetary environment where conventional assets inflate in nominal terms — but the tax on those nominal gains erodes real returns. Offshore bonds and VCTs compound or distribute without annual income tax deduction, allowing your client to own the nominal appreciation without the tax friction that undermines gross-to-net returns. M2 growth is the signal to prioritise structures where compounding runs untaxed.',
          'WALCL':'QE balance sheet expansion creates the broadest monetary expansion environment — and the most compelling backdrop for gross roll-up tax structures. Every asset price that rises in a QE environment produces a taxable gain or taxable income for the investor who holds through conventional vehicles. Offshore bonds defer that tax until encashment, allowing the client to compound the full QE-driven appreciation before the tax event is triggered.',
          'WRESBAL':'When bank reserves fall and credit tightens, EIS and VCT portfolios are illiquid by design — clients cannot exit, which means they cannot panic-sell at the worst moment. The illiquidity premium, combined with the 30% tax relief and loss relief provisions, creates a structurally superior outcome in exactly the environments where liquid portfolios suffer most from client behaviour risk. The structure prevents the behaviour that destroys returns.',
          'RRPONTSYD':'The RRP balance draining marks the transition from liquidity abundance to discrimination — where manager quality separates performance. For EIS and VCT managers, this is when the ability to select companies that can grow without cheap credit matters most. The advisers who positioned clients in tax-efficient structures before liquidity tightens are the ones delivering the conversations that matter when the market tests portfolio resilience.',
          'BOGMBASE':'Monetary base expansion is the primordial act of currency creation — and every unit of new base money dilutes the real value of existing savings and bonds. Tax-efficient wrappers do not create returns from nothing, but they structurally improve the net return your client keeps from whatever return is achieved. In a debasement environment, structuring returns to minimise tax friction is the marginal difference between preserving and losing real wealth.',
          'TOTLL':'Bank credit contraction means traditional business finance dries up — and EIS and VCT capital becomes the marginal provider of growth capital to UK early-stage businesses. This structural shortage of credit is the environment where patient, tax-advantaged private capital earns its premium. Your client deploying EIS capital during credit contraction is providing growth capital when banks retreat, at valuations that reflect the credit premium, sheltered by 30% tax relief.',
          /* RATES */
          'GS10':'The 10-year Treasury yield peak is when locking in gross yields inside offshore bonds and onshore investment bonds becomes most valuable. An offshore bond charging a 5%+ gross yield held through the rate decline and encashed at a future lower income tax rate delivers a triple advantage: high gross accumulation, tax deferral, and a lower tax rate at exit. The peak is the moment to act — delay means compounding at sequentially lower rates without the full deferral benefit.',
          'GS2':'The 2-year yield is the Fed\'s rate forecast priced by institutional money. When it prices in aggressive cuts, the window for locking in high gross yields inside offshore and onshore investment bonds is closing. Your client who acts before the 2-year fully prices in the cut cycle captures the full accumulation period at the elevated rate — and defers the tax event until a lower-rate, lower-income future.',
          'FEDFUNDS':'The Fed Funds Rate peak is the best timing signal for offshore bond and onshore bond structuring. High gross yields compound best when the rate environment is elevated — and deferring tax throughout the accumulation means the full gain is realised before any UK income tax event occurs. Clients who structure fixed income exposure inside gross roll-up bonds at or near the rate peak capture the full cycle.',
          'T10YIEM':'Breakeven inflation above 2.5% is the market\'s insurance premium on inflation continuing. VCT dividends are tax-free and not subject to the purchasing power erosion that compounds through income tax on savings interest. Offshore bonds compound gross of tax, giving the inflation-adjusted return a better chance of being real in net terms. Your client holding taxable bonds with inflation eroding both the real return and the after-tax coupon is suffering a structural double drag that wrappers resolve.',
          'DTWEXBGS':'Dollar weakness creates currency drag on USD-denominated assets — an additional layer of return erosion that compounds on top of UK income tax. Offshore bond structures invested in sterling or multi-currency portfolios eliminate both the currency friction and the tax drag simultaneously. Weakening dollar environments are the moment to review currency exposure and tax structure in the same conversation.',
          'BAMLH0A0HYM2':'High-yield spread widening signals credit stress. EIS-backed businesses are typically early-stage and growth-oriented — they do not carry the default risk of leveraged HY issuers and are not marked to market when spreads blow out. Your client\'s EIS portfolio holds no mark-to-market risk: it is unaffected by the credit volatility that dominates HY spreads and is protected by 30% tax relief and loss relief that HY bond investors never receive.',
          /* LABOUR */
          'PAYEMS':'Non-farm payrolls falling signals economic deceleration — and the beginning of the fiscal response that EIS and VCT structures are designed to capture. When job creation slows, the Treasury\'s incentive to direct private capital into early-stage UK employment-creating businesses intensifies. Your client\'s allocation is economically purposeful and fiscally rewarded — the 30% tax relief is the government\'s co-investment in the businesses your client is backing through the cycle.',
          'JTSJOL':'JOLTS openings falling is the 12-18 month early warning before unemployment headlines arrive. For EIS and VCT timing, this lead indicator is the signal to begin structuring new allocations — not to wait. Deployment into qualifying companies before the recession is confirmed captures the best valuations, the highest 30% tax relief utilisation, and the longest compounding period before the recovery generates the realised gains.',
          'CES0500000003':'Wage growth above 4% is the stickiest form of inflationary pressure — and the environment where gross roll-up tax deferral compounds most powerfully. Every year of elevated wage inflation is a year in which nominal returns on offshore bonds are higher in absolute terms but taxed away at the margin unless sheltered inside a wrapper. Your client\'s tax adviser and financial adviser should be having this conversation in the same room.',
          'CIVPART':'Structurally low labour force participation sustains wage pressure and keeps the Bank of England cautious — prolonging the high-rate environment that makes gross roll-up accumulation most valuable. When the BoE eventually cuts, your client\'s offshore bond portfolio will have accumulated at the elevated gross rate for the full tightening cycle. The longer rates stay high, the greater the compounding advantage the wrapper structure captures.',
          'ICSA':'Initial jobless claims rising is the earliest labour market signal — arriving weeks before payrolls and months before unemployment headlines. For VCT and EIS advisers, this is the signal to begin client conversations about timing. EIS qualification requires investment before exit — the window to deploy while early-stage valuations are still reasonable is typically 3-6 months ahead of the mainstream recession narrative. Initial claims is the indicator that opens that window.',
          /* HOUSING */
          'HOUST':'Housing starts falling signals a construction sector contraction that creates the EIS vintage opportunity in property technology, construction innovation, and housing finance. Companies funded at cycle-low valuations, serving the structural housing shortage that persists regardless of rate cycle, exit into the rebuilding demand surge. The 30% tax relief reduces effective entry cost, and the EIS time horizon maps precisely onto the housing cycle recovery window.',
          'PERMIT':'Building permits below trend confirm that housing supply is structurally constrained. EIS and VCT funds investing in estate technology, lettings platforms, modular construction, and building services operate in a structurally demand-rich environment regardless of the interest rate cycle. Your client\'s EIS allocation in this space carries government-backed tax relief into a structurally undersupplied market where the problem is the opportunity.',
          'CSUSHPISA':'Case-Shiller falling means property\'s traditional role as a wealth store is failing. Capital displaced from property seeks alternative wealth preservation in tax-efficient wrappers. VCTs and EIS funds investing in property-related technology — platforms serving the lettings market, bridging the affordability gap, helping buyers navigate constrained supply — carry the 30% tax relief that BTL investment never offered, with none of the stamp duty drag.',
          'MORTGAGE30US':'Mortgage rates above 7% lock millions of homeowners into existing properties, suppressing transaction volumes and household mobility. EIS funds investing in the ecosystem around this constrained market — data platforms, lettings technology, mortgage comparison, home improvement finance — are backed by a structural problem that does not resolve when rates fall slightly. Your client\'s EIS exposure is a play on the structural problem created by high mortgage rates, not on the rates themselves.',
          'EXHOSLUSM495S':'Existing home sales at depressed levels confirm the housing market is locked. EIS-backed businesses serving this constrained market — data platforms, lettings technology, home improvement finance — grow regardless of whether transaction volumes recover, because the problem they solve is independent of cycle timing. The structure provides the business model resilience; the tax relief provides the structural return floor.',
          /* CONSUMER */
          'UMCSENT':'Falling consumer sentiment is the leading indicator of retail spending weakness — and the environment where discretionary luxury investment conversations become easier. Your client who is seeing their portfolio mark-to-market against a deteriorating sentiment backdrop benefits from EIS exposure: illiquid, tax-efficient, not marked to market, and generating 30% income tax relief regardless of where sentiment prints.',
          'RSAFS':'Retail sales slowing signals consumer fatigue — and the environment where affluent clients begin rotating from consumption to capital preservation. VCT and EIS allocations offer tax-efficient capital deployment at a moment when the client\'s risk appetite for passive equity is declining. The 30% tax relief on VCTs, combined with tax-free dividends, means the effective return threshold is materially lower than any equivalent conventional allocation.',
          'DSPIC96':'Real disposable income falling means purchasing power is eroding faster than wages are rising — financial repression in its most tangible form. Offshore bonds invested in assets that generate real returns avoid both the direct inflation erosion and the income tax deduction that would otherwise apply to the nominal return. Your client who allows inflation-adjusted income to accumulate inside a gross roll-up structure protects both the real return and the nominal return simultaneously.',
          'PCE':'Personal consumption declining is the precursor to the rate cut cycle that benefits tax-efficient wrappers in two directions: VCT and EIS-backed companies see valuations recover as growth expectations improve, and offshore bonds that were accumulating at the high-rate cycle peak now benefit from the broader asset price re-rating that follows easing. The tax-efficient wrapper captures both the income accumulation and the capital appreciation without an interim tax event.',
          'PSAVERT':'A falling savings rate signals that consumers are spending beyond their income — a pattern that ends in correction. For affluent clients watching this unfold, ring-fencing capital inside a tax-efficient, illiquid structure is intuitive: EIS and VCT allocations are unreachable by the panic redemption decisions that destroy conventional portfolio returns during corrections. The structure prevents the behaviour that destroys returns.',
          'CSCICP03USM665S':'Conference Board CI dropping sharply signals a consumer-led growth scare. For EIS and VCT managers, this is the vintage window they build their selection models around: companies funded in confidence-crisis periods have consistently outperformed in subsequent recovery phases. The 30% tax relief provides structural downside protection for your client backing the businesses that build through the bottom.',
          /* UK MACRO */
          'NAEXKP01GBQ657S':'UK GDP contraction is the confirmation that the BoE\'s rate medicine has worked — and that the easing cycle is imminent. For EIS and VCT investors, UK GDP contraction is the classic vintage entry signal: HMRC-approved structures deploying into UK growth businesses at cycle-low valuations, backed by the 30% income tax relief and the government\'s explicit desire to keep capital flowing into UK enterprise through economic stress.',
          'CPALTT01GBM659N':'UK CPI above the 2% target keeps the BoE restrictive and sustains the high-rate environment that makes offshore bond gross roll-up structurally powerful. Every year sterling-based savings are taxed on nominal returns that are not real returns is a year that the offshore bond structure wins by deferral. UK inflation above target is the argument for reviewing how your client\'s UK portfolio is taxed, not just what it owns.',
          'CPGRLE01GBM659N':'UK core CPI above 3% signals that the BoE cannot cut aggressively — and that the elevated rate environment compounds the advantage of gross roll-up structures. The higher UK rates remain, the larger the annual tax saving from compounding inside an offshore bond rather than outside it. Core inflation is sticky, the advantage compounds annually, and the exit can be timed into a lower marginal tax rate year.',
          'LRHUTTTTGBM156S':'UK unemployment rising signals the beginning of the BoE\'s rate-cutting cycle — and the classic EIS vintage window. Early-stage UK businesses backed as unemployment rises are acquired cheapest, managed most carefully by founders motivated by adversity, and exited into the recovery that BoE easing supports. The 30% EIS tax relief is the government\'s explicit co-investment alongside your client\'s capital, in support of the UK businesses generating the employment that the recovery depends on.',
          'IRLTLT01GBM156N':'UK gilt yields above 5% confirm that the fiscal risk premium on sterling assets is elevated. Offshore bonds held outside the sterling-dominated liability framework benefit from the currency diversification and gross roll-up that UK gilts cannot provide. Your client who holds gilts as a \'safe\' allocation is holding an asset whose issuer — the UK government — is paying the highest borrowing premium in 30 years. The offshore structure is the exit from that counterparty risk.',
          'IRSTCI01GBM156N':'The BoE base rate peak is the timing signal for locking in gross roll-up returns inside offshore and onshore investment bonds. The highest UK base rate since 1988 creates the most favourable accumulation period in a generation for gross roll-up structures. Clients who structure during the rate peak compound at the highest achievable gross yield before encashing at a lower income tax rate in retirement or drawdown. The BoE rate chart is the offshore bond adviser\'s timing framework.',
        },
        equity: {
          /* CYCLE */
          'CFNAI':'CFNAI approaching -0.70 is when investment trust discounts reach their widest — and closed-end fund structures are immune to redemption pressure. Unlike open-ended funds, trusts cannot be forced to sell portfolio assets at depressed prices to meet client withdrawals. Your client who buys quality infrastructure, renewable energy, or private equity trusts at 20-30% discounts during CFNAI contraction enters the business cycle recovery with embedded outperformance: the discount itself is return waiting to be realised.',
          'USALOLITONOSTSAM':'The OECD CLI rolling below 100 is the institutional signal to rotate from growth into defensive investment trusts: infrastructure, healthcare, essential services, and real assets. Closed-end structures allow trust managers to hold through the downturn without being forced sellers — the structural advantage that lets them generate long-term returns unavailable to open-ended managers running liquidity buffers to meet redemptions.',
          'INDPRO':'Industrial production contraction signals that cyclical sectors are de-rating — and that listed private equity and industrial trust sectors are approaching entry territory. PE trusts that deploy during the industrial contraction phase capture the vintage return that cycles are built on: buying into operational businesses at their most discounted, and exiting into the demand recovery that follows each trough. The J-curve for trusts deployed during industrial contraction consistently demonstrates the strongest eventual returns.',
          'T10Y2YM':'Yield curve inversion has preceded every significant investment trust discount widening cycle of the last 30 years — and every subsequent narrowing. Your client who buys infrastructure or renewable energy trusts during inversion, at maximum discount, owns the full discount-to-NAV compression when the curve uninverts and long rates fall. The discount the market applies during inversion is the embedded return on the inevitable normalisation.',
          'UNRATE':'Rising unemployment accelerates rate cuts — and rate cuts are the single most powerful catalyst for investment trust discount compression. The mechanism is direct: lower discount rates increase the present value of contracted infrastructure cash flows, reduce the equity risk premium applied to trust valuations, and drive institutional reallocation from cash to yield-producing listed vehicles. Rising unemployment is your signal that the trust re-rating cycle is approaching, not that it is over.',
          'A191RL1Q225SBEA':'Negative GDP is when investment trust discounts reach maximum width and listed PE trusts offer the deepest discount to underlying NAV. Buying quality UK investment trusts — infrastructure, specialist lending, private equity — at 20-25% discounts to professionally assessed NAV during a GDP contraction is buying the economic recovery at a material valuation discount. The trust structure cannot suffer redemptions: the portfolio holds through the trough while the passive equity manager is forced to sell.',
          /* INFLATION */
          'CPIAUCSL':'CPI above 3% reprices specific investment trust sectors upward in real terms: infrastructure trusts with CPI-linked revenue contracts — toll roads, regulated utilities, renewables with indexed tariffs — deliver inflation pass-through that the general equity market cannot replicate. Your client holding an infrastructure trust in an inflationary environment owns contracted revenue streams that rise automatically with the index — the structural inflation hedge that bond portfolios fail to deliver.',
          'CPILFESL':'Core CPI above 3% means rate cuts are delayed and the higher-for-longer environment persists. Investment trusts with contracted, inflation-linked revenues — infrastructure, renewable energy, specialist property — continue to generate real returns even as conventional equity multiples compress under rate pressure. The trusts that own pricing-power assets are the sector allocation that inflation validates, not punishes.',
          'PCEPI':'PCE above the Fed\'s 2% target sustains the environment where trusts with contracted inflation-linked revenues outperform on a total return basis. Infrastructure, energy, and essential services trusts have revenues indexed to inflation — they pass through the CPI that erodes the returns on conventional equity. Your client in an investment trust with a CPI pass-through mechanism is structurally long the thing that is destroying the rest of their portfolio\'s real returns.',
          'PCEPILFE':'Core PCE remaining elevated means rate normalisation is delayed — and that the discount to NAV on infrastructure and renewable energy trusts persists longer than consensus expects. This is the patience trade: trusts with contracted real asset revenues, trading at discount, in an environment where the rate compression that closes that discount is delayed but inevitable. Patient capital in the right trust at the right discount wins the longer horizon.',
          'CUSR0000SAH1':'Shelter inflation above 4% makes property investment trusts structurally attractive: rising rents flow directly through to NAV and distributions, outpacing the inflationary erosion that is destroying fixed-income real returns. Your client who holds a property investment trust in a high-shelter-inflation environment is long the CPI component driving the most persistent part of the inflation problem — which is the CPI component that reprices their trust upward.',
          'WPSFD49207':'PPI falling before CPI is the margin recovery signal for listed private equity trusts and industrial specialist funds. As input costs fall, portfolio companies recover operating margins before the stock market prices the improvement — and the trust manager\'s ability to actively work portfolio companies through the recovery is the alpha over passive equity exposure to the same sectors.',
          /* LIQUIDITY */
          'M2SL':'M2 growth above GDP growth is the liquidity expansion that historically drives investment trust discount narrowing. As institutional capital searches for real yield in a monetary-expansion environment, listed investment vehicles with wide discounts to assessed NAV become targets for systematic re-rating. Infrastructure and PE trusts at wide discounts attract the incremental capital that M2 expansion creates — and discount compression converts into return for the early buyer.',
          'WALCL':'QE is the most powerful investment trust discount compression force in the modern era. The 2009 QE cycle closed infrastructure trust discounts from 20% to premium. The 2020 cycle compressed renewable energy trust discounts to near-zero. Each QE period provides the clear directional trade: buy quality trusts at wide discounts when the balance sheet is expanding, and own the compression. Your client\'s trust position is long the re-rating that QE historically delivers.',
          'WRESBAL':'Bank reserve declines signal tightening liquidity — but investment trusts hold assets, not derivatives, and their portfolios do not carry the counterparty risk that triggers credit market cascades. An infrastructure trust holding 30-year contracted road concessions is not exposed to repo market stress. This structural disconnection from bank-reserve plumbing is part of the trust\'s value proposition in periods of financial system instability.',
          'RRPONTSYD':'The RRP draining toward zero signals the end of the excess liquidity phase — the final period before financial conditions tighten materially. Investment trust discounts typically widen as liquidity leaves the system, presenting the entry point. Trusts that traded at discounts during liquidity tightening cycles rerated most sharply in the subsequent easing phase. The RRP chart is the backstory for why trust discounts exist — and why they eventually close.',
          'BOGMBASE':'Monetary base expansion historically precedes asset price re-rating across all investment trust sectors, most directly in infrastructure, real assets, and diversified PE trusts. The channel is simple: more base money seeks yield, trusts with contracted cash flows are one of the few available sources of genuine yield, and the capital inflow drives discount compression from wide to narrow to premium. Own the trusts before the capital inflow confirms it.',
          'TOTLL':'Bank credit contraction is the most direct headwind for listed PE trusts whose portfolio companies rely on leverage to drive returns. Managers who operate portfolio companies without the need for regular refinancing — owner-operated businesses, recurring-revenue platforms, asset-light services — are the trusts to own when credit contracts. Manager selection, not sector selection, is the alpha source in a credit crunch: it is the difference between a trust that is insulated and one that is exposed.',
          /* RATES */
          'GS10':'The 10-year yield peak is the single most important timing signal for investment trust positioning. Every basis point decline in the 10-year yield increases the NPV of infrastructure trust cash flows, reduces the equity risk premium applied to trust NAVs, and narrows the discount at which trusts trade. The investor who owns quality infrastructure trusts at the rate peak captures the full re-rating from maximum discount to narrower discount, typically within 12-18 months of the peak.',
          'GS2':'The 2-year yield is the bond market\'s explicit rate forecast — and for investment trust investors, it is the forward guide for when trust discount compression begins. When the 2-year prices in 100+ basis points of cuts, the re-rating cycle for infrastructure, renewable energy, and specialty finance trusts has typically already started. The trust investor who waits for confirmation has given up 15-20% of the total discount compression return.',
          'FEDFUNDS':'The Fed Funds Rate peak marks the transition from trust discount widening to trust discount compression. Lower rates reduce the discount rate applied to trust NAV cash flows, improve the relative yield of trust distributions versus cash, and attract institutional capital back into listed investment vehicles. Every prior rate peak has been followed by infrastructure and renewable energy trust outperformance. The rate chart is the trust manager\'s timing framework.',
          'T10YIEM':'Breakeven inflation above 2.5% validates the case for inflation-linked investment trusts: infrastructure, renewable energy with CPI-linked PPAs, and social housing trusts with rent indexation. These trusts hold contracts that explicitly reference inflation — their revenue streams rise as breakevens confirm what the market already suspects. The investor holding inflation-linked trusts is not speculating on inflation: they are holding the asset whose contractual value rises when the market\'s inflation expectations prove correct.',
          'DTWEXBGS':'Dollar weakness boosts the sterling-reported NAV of investment trusts with global portfolios: global infrastructure trusts, internationally diversified PE trusts, and global specialist funds report GBP NAVs that rise when USD falls against sterling — and this NAV uplift flows directly through to closing the discount. Your client\'s globally diversified trust is also a currency position: dollar weakness creates the dual opportunity of underlying asset appreciation and currency-driven NAV re-rating.',
          'BAMLH0A0HYM2':'HY spread widening is a systematic signal for specialist lending investment trusts — the vehicles that intermediate between HY borrowers and institutional capital. When spreads blow out, trust managers who can hold through the volatility — closed-end structure, no redemptions — capture the spread compression on the other side. Specialist credit and direct lending trusts have demonstrated consistent returns through credit cycles precisely because they cannot be forced to sell at the widest spreads.',
          /* LABOUR */
          'PAYEMS':'Payrolls declining confirms the labour cycle is turning — and historically this is when income-focused investment trusts attract institutional capital rotating from growth to income. The trust manager\'s ability to maintain distributions through an employment cycle is the quality signal that separates durable income vehicles from momentum plays that cut dividends when the cycle turns. The payrolls chart is the screen for trust quality, not a reason to exit the sector.',
          'JTSJOL':'JOLTS openings falling gives PE trust managers 12-18 months of advance visibility on labour cost normalisation — the input cost that most directly affects portfolio company profitability. As openings fall, margin recovery benefits operational improvement-focused PE trusts most directly. Trust managers who build positions in labour-intensive businesses ahead of the wage peak and hold through the normalisation capture the operational leverage most passive equity investors miss.',
          'CES0500000003':'Hourly earnings above 4% keep services inflation sticky — sustaining the rate environment where income-generating investment trusts maintain their relative yield advantage over cash and conventional bonds. Infrastructure and renewable energy vehicles delivering 5-7% distribution yields become increasingly attractive versus a savings rate the market is already pricing to fall. The trust distribution advantage is most valuable when the market believes rates will normalise.',
          'CIVPART':'Low labour force participation with tight unemployment signals persistent wage pressure — and a rate environment where the BoE cannot cut aggressively. Infrastructure and renewable trusts with long-dated fixed-fee contracts deliver distributions that are independent of wage pressures and rate sensitivity. In a sticky-rate environment driven by structural labour tightness, these trusts represent the income that the macro environment cannot erode.',
          'ICSA':'Initial claims rising is the first labour market signal that the economic cycle is turning — and the earliest opportunity to rotate into defensive investment trusts before the broad equity market prices in the deterioration. Infrastructure trusts, healthcare investment vehicles, and specialist lending funds perform defensively in the early deterioration phase: their contracted, non-cyclical revenues diverge from the GDP-sensitive earnings that drive broad equity weakness.',
          /* HOUSING */
          'HOUST':'Housing starts falling signals a construction sector contraction that affects investment trusts in residential development, housebuilder debt, and property finance. Managers who pivot to the operational side of constrained supply — build-to-rent platforms, affordable housing trusts, planning-adjacent investments — navigate housing cycles rather than being exposed to them. Trust selection in the housing downturn is about manager flexibility, not sector avoidance.',
          'PERMIT':'Building permits below trend confirm that housing supply is structurally constrained. Trusts investing in social housing, registered providers, and affordable rented accommodation are the structural beneficiaries: government-backed rental contracts, inflation-indexed revenues, and a demand pool that expands as private market affordability deteriorates. The structural housing shortage is the investment case for specialist property trusts that conventional REIT analysis misses.',
          'CSUSHPISA':'Case-Shiller weakness triggers the repricing of residential REIT and property trust NAVs — creating the discount-to-fair-value entry point for specialist property investors. Trusts with professional asset managers, active valuation processes, and diversified portfolios across geography and type outperform direct ownership in down markets. The trust structure provides the liquidity — secondary market access — that direct property cannot, while NAV valuations eventually reflect the recovery.',
          'MORTGAGE30US':'Mortgage rates above 7% suppress housing transaction volumes and concentrate demand in the rental sector. Residential rental trusts, build-to-rent platforms, and student accommodation REITs benefit structurally from the lock-in effect: high mortgage rates drive renters into long-term tenancy and away from ownership. Your client in a build-to-rent trust is long the very dynamic that is crippling the mortgage market — their tenant cannot afford to become a buyer.',
          'EXHOSLUSM495S':'Transaction volume collapse in existing home sales confirms the lock-in effect that sustains rental demand. Trusts with residential rental and student housing portfolios hold assets whose tenancy demand is counter-cyclically sustained by the very conditions that depress transaction volumes. Low volumes create captive tenants — and captive tenants create recurring revenue for specialist property trusts with the operating platform to manage them efficiently.',
          /* CONSUMER */
          'UMCSENT':'Consumer sentiment falling drives the sector rotation that investment trust managers with sector selection capability exploit: away from consumer discretionary, retail, and leisure exposure toward infrastructure, healthcare, and essential services. The closed-end trust structure allows sector rotation without forced selling — managers rebalance from a position of strength. Your client in a diversified equity trust managed through the cycle outperforms the market scrambling to reprice the sentiment data.',
          'RSAFS':'Retail sales slowing triggers earnings estimate cuts in consumer-facing sectors and drives institutional rotation into defensive investment trusts. Infrastructure trusts, healthcare investment vehicles, and essential services trusts have revenues that are contractually independent of retail spending. The trust investor who rotates before the consensus confirms the slowdown captures the re-rating of defensive trust discounts before the consumer data confirms what the trust manager has already positioned for.',
          'DSPIC96':'Real disposable income falling is the consumer stress signal that drives demand for resilient investment vehicles. Investment trusts with contracted revenues, low economic sensitivity, and active portfolio management outperform during real income contractions: their revenues do not depend on the consumer spending that real income growth sustains. Infrastructure, healthcare, and specialist lending trusts hold through real income squeezes that erode passive equity portfolio returns.',
          'PCE':'Personal consumption slowing predicts the rate cut cycle that drives investment trust discount compression. The transmission mechanism is clear: PCE weakens, the Fed cuts, long rates fall, infrastructure trust NAVs reprice upward, trust discounts narrow. The investor who buys quality infrastructure and renewable energy trusts on PCE deceleration is positioning for the re-rating before the cut cycle confirms it — the return comes from timing the discount entry, not reacting to the policy.',
          'PSAVERT':'Rising savings rates signal consumer caution and capital accumulation — creating the pool of investable capital that flows into yield-producing listed investment vehicles. Investment trusts offering real distributions above the risk-free rate attract the incremental capital that a rising savings rate creates, particularly when conventional equity returns are uncertain. Your client\'s trust allocation is the yield-seeking capital that the savings rate chart confirms is building.',
          'CSCICP03USM665S':'Conference Board CI dropping sharply is the consumer recession alarm that triggers institutional re-allocation from equities into defensive investment trusts. Managers of income-focused trusts — dividend heroes, infrastructure funds, essential services vehicles — manage through confidence crises by holding contracted revenues that do not correlate to consumer confidence. The trust board\'s commitment to the dividend level is the institutional anchor that passive equity exposure does not provide.',
          /* UK MACRO */
          'NAEXKP01GBQ657S':'UK GDP contraction is when listed UK investment trusts — infrastructure, specialist lending, UK private equity — offer their widest discounts to NAV, and their most compelling entry points. The Bank of England\'s response to a UK recession is rate cuts and potential QE, which directly drives the trust discount compression cycle. Your client who buys quality UK trusts during GDP contraction buys the economic recovery at a valuation that reflects the current pessimism, not the eventual reality.',
          'CPALTT01GBM659N':'UK CPI above the 2% target reprices UK infrastructure trusts with RPI-linked revenues upward in real terms: regulated utilities, PFI contracts, and social housing trusts with rent indexation all benefit from inflation pass-through that gilt investors cannot access. UK inflation above target is not just an argument for inflation protection — it is an argument for specifically holding the UK trust sectors whose contractual revenues reference the index that is running hot.',
          'CPGRLE01GBM659N':'UK core CPI above 3% signals that the BoE will hold rates higher for longer — the environment in which UK income-generating investment trusts maintain their yield advantage over cash. Trusts with contracted, non-cyclical revenues deliver distributions that compound at higher real yields while the market waits for the BoE to cut. The trust investor who owns the distribution, not the capital gains, is the one who benefits from the prolonged restrictive environment.',
          'LRHUTTTTGBM156S':'UK unemployment rising signals that the BoE is approaching the rate-cutting phase — and that investment trust discount compression is approaching. The mechanism follows directly: rising unemployment softens the BoE\'s inflation concern, accelerates rate cuts, lowers gilt yields, and reduces the discount rate applied to trust NAVs. Infrastructure and renewable energy trusts that are currently trading at wide discounts are the vehicles that capture this re-rating.',
          'IRLTLT01GBM156N':'UK gilt yields above 5% have historically been associated with maximum investment trust discount widening — because gilt yields are the discount rate applied to trust cash flows. The wider the gilt yield, the wider the trust discount. When gilt yields normalise — as they inevitably do — the discount narrows and the trust outperforms. UK gilt yield at elevated levels is the trust investor\'s entry signal, not the exit.',
          'IRSTCI01GBM156N':'The BoE base rate peak is the investment trust investor\'s most important timing signal. Every BoE rate-cutting cycle since 2000 has been associated with significant investment trust discount compression — infrastructure, property, and specialist finance trusts rerate from wide discount to narrow discount or premium. Your client who builds positions in quality UK trusts at the BoE rate peak owns the full re-rating as the cutting cycle proceeds.',
        }
      };

      var defText = cfg.def || cfg.desc || '';
      var sigText = cfg.signal || '';
      var _lensKey = (window._assetLens && window._assetLens.key) || 'universal';
      var _taxLenses = ['eis','vct','offshore'];
      var _equityLenses = ['pe','trusts'];
      var _pitchMap = _taxLenses.indexOf(_lensKey) !== -1 ? PITCH_BY_LENS.tax
                    : _equityLenses.indexOf(_lensKey) !== -1 ? PITCH_BY_LENS.equity
                    : null;
      var pitchText = (_pitchMap && _pitchMap[cfg.id]) || cfg.pitch || '';

      modal.innerHTML =
        '<div style="padding:10px 14px 8px;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
          '<div>' +
            '<div style="font-size:9px;letter-spacing:.2em;color:' + ACCENT + ';">' + cfg.id + '</div>' +
            '<div style="font-size:13px;font-weight:700;color:#ffffff;">' + cfg.lbl + '</div>' +
          '</div>' +
          '<div style="margin-left:auto;display:flex;gap:8px;align-items:center;">' +
            '<select id="fred-cmp-sel" style="background:#181818;color:#ffffff;border:1px solid #2a2a2a;border-radius:3px;padding:3px 6px;font-size:9px;font-family:Consolas,monospace;">' + buildCmpOptgroups() + '</select>' +
            '<div id="fred-cmp-chips" style="display:flex;gap:4px;flex-wrap:wrap;max-width:240px;"></div>' +
            '<div style="display:flex;gap:2px;margin-right:4px;">' +
              '<button id="bc-dep-b" style="padding:2px 8px;font-size:8px;letter-spacing:.1em;border:1px solid #2a2a2a;background:transparent;color:#666;cursor:pointer;font-family:Consolas,monospace;">BRIEF</button>' +
              '<button id="bc-dep-f" style="padding:2px 8px;font-size:8px;letter-spacing:.1em;border:1px solid #E97132;background:#E97132;color:#fff;cursor:pointer;font-family:Consolas,monospace;">FULL</button>' +
              '<button id="bc-dep-d" style="padding:2px 8px;font-size:8px;letter-spacing:.1em;border:1px solid #2a2a2a;background:transparent;color:#666;cursor:pointer;font-family:Consolas,monospace;">DEEP</button>' +
            '</div>' +
            '<button id="fred-modal-close" style="background:none;border:none;color:#ffffff;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div style="padding:6px 14px 4px;border-bottom:1px solid #1a1a1a;display:flex;gap:6px;align-items:center;flex-shrink:0;flex-wrap:wrap;">' +
          '<div style="font-size:9px;letter-spacing:.12em;color:#ffffff;margin-right:2px;">CHART</div>' +
          ['AREA:A','LINE:L','BAR:B','STEP:S','CANDLE:C'].map(function(t){
            var parts = t.split(':');
            return '<button class="modal-ct-btn" data-ct="' + parts[0].toLowerCase() + '" style="background:#181818;border:1px solid #252525;color:#ffffff;font-size:10px;padding:3px 9px;cursor:pointer;border-radius:2px;font-family:Consolas,monospace;">' + parts[1] + '</button>';
          }).join('') +
          '<div style="width:1px;height:14px;background:#252525;margin:0 4px;"></div>' +
          '<div style="font-size:9px;letter-spacing:.12em;color:#ffffff;margin-right:2px;">PERIOD</div>' +
          ['1Y','3Y','5Y','MAX'].map(function(p){
            return '<button class="modal-period-btn" data-period="' + p + '" style="background:#181818;border:1px solid #252525;color:#ffffff;font-size:10px;padding:3px 9px;cursor:pointer;border-radius:2px;font-family:Consolas,monospace;">' + p + '</button>';
          }).join('') +
          '<div style="width:1px;height:14px;background:#252525;margin:0 4px;"></div>' +
          ['MA12:MA12','MA24:MA24','BB:BB','Z:Z-SCR','LOG:LOG','TL:TLINE'].map(function(t){
            var p = t.split(':');
            return '<button class="modal-ovl-btn" data-ovl="' + p[0].toLowerCase() + '" style="background:#181818;border:1px solid #252525;color:#ffffff;font-size:10px;padding:3px 9px;cursor:pointer;border-radius:2px;font-family:Consolas,monospace;">' + p[1] + '</button>';
          }).join('') +
        '</div>' +
        '<div style="flex:1;min-height:0;padding:8px 14px;position:relative;">' +
          '<canvas id="fred-modal-canvas" style="width:100%;height:100%;display:block;"></canvas>' +
        '</div>' +
        (defText || sigText || pitchText ?
          '<div id="bc-depth-panel" style="padding:14px 18px;background:#080808;border-top:1px solid #1a1a1a;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;flex-shrink:0;">' +
            (defText ? '<div><div style="font-size:8px;letter-spacing:.2em;color:' + ACCENT + ';margin-bottom:6px;">WHAT IT MEASURES</div><div style="font-size:11px;color:#ffffff;line-height:1.7;">' + defText + '</div></div>' : '<div></div>') +
            (sigText ? '<div><div style="font-size:8px;letter-spacing:.2em;color:' + ACCENT + ';margin-bottom:6px;">HOW TO READ THE SIGNAL</div><div style="font-size:11px;color:#ffffff;line-height:1.7;">' + sigText + '</div></div>' : '<div></div>') +
            (pitchText ? '<div><div style="font-size:8px;letter-spacing:.2em;color:' + ACCENT + ';margin-bottom:6px;">SALES ANGLE</div><div style="font-size:11px;color:#ffffff;line-height:1.7;">' + pitchText + '</div></div>' : '<div></div>') +
          '</div>'
        : '');

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      /* ── BRIEF / FULL / DEEP depth mode ── */
      var _depthMode = 'full';

      var BRIEF_DATA = {
        'CFNAI':           { brief: 'The CFNAI is the US economy\'s composite health score — below -0.70 means recession is underway, and the rate cuts and QE that follow are the most reliable catalyst for hard assets.', analogy: 'Think of CFNAI as the patient\'s blood pressure: when it drops into critical range, the medication prescribed (rate cuts, quantitative easing) always inflates the price of gold.' },
        'USALOLITONOSTSAM':{ brief: 'The OECD CLI is the global economic early-warning system — when it rolls over below 100, recession typically follows in 6–9 months, opening the positioning window for hard assets.', analogy: 'The CLI crossing below 100 is the weather satellite spotting the hurricane three days out — by the time the storm is obvious, the window to prepare has closed.' },
        'T10Y2YM':         { brief: 'The yield curve inverts when short-term rates exceed long-term rates — every US recession since 1955 was preceded by an inversion, giving hard assets the lead time to position.', analogy: 'An inverted yield curve is the bond market\'s unanimous storm warning — when the most patient capital on earth pays more to borrow for 2 years than 10, they are pricing in a storm.' },
        'UNRATE':          { brief: 'Rising unemployment is the starter\'s pistol for rate cuts — and rate cuts are the single most reliable multi-year catalyst for non-yielding hard assets.', analogy: 'Unemployment ticking up is the fire alarm: not the fire itself, but the signal that triggers the response — and the response (aggressive rate cuts) always benefits hard assets.' },
        'A191RL1Q225SBEA': { brief: 'Real GDP going negative is the headline signal for monetary accommodation — and the rate cuts and QE that follow are the foundation of every hard asset bull market.', analogy: 'A negative GDP print is the economic red card: the rules change, players reposition, and assets outside the credit-dependent financial system operate by different rules.' },
        'INDPRO':          { brief: 'Industrial production falling is an early sign the goods economy is contracting — capital flees cyclical equities toward stores of value that hold regardless of factory output.', analogy: 'When the factory lights dim, the money that was illuminating equities seeks shelter — and hard assets are where institutional capital historically parks in industrial downturns.' },
        'CPIAUCSL':        { brief: 'CPI measures how fast prices rise — every point above 2% is a measurable, monthly reduction in the purchasing power of every pound and dollar in your client\'s account.', analogy: 'Inflation is a slow leak in a tyre: your client doesn\'t feel it day-to-day, but after three years they\'re running on the rim wondering why the same income feels tighter.' },
        'CPILFESL':        { brief: 'Core CPI strips out volatile food and energy to reveal persistent, structural inflation — when it is sticky above 3%, the Fed stays tight and paper assets face a prolonged headwind.', analogy: 'Core CPI is the thermometer that can\'t be fooled by a single hot or cold day — it reads the underlying fever, and that fever tells you whether the patient needs treatment.' },
        'PCEPI':           { brief: 'PCE is literally the number the Federal Reserve uses to set interest rates — when it is above 2%, the Fed tightens, compressing equity multiples and raising the opportunity cost of cash.', analogy: 'PCE is the Fed\'s speed camera: when you\'re over the limit, you get fined (higher rates), and those fines fall hardest on paper assets that depend on cheap credit to justify their valuations.' },
        'PCEPILFE':        { brief: 'Core PCE is the Fed\'s primary 2% target benchmark — every 0.1% above target is another increment of tightening, narrowing the path for credit-sensitive assets.', analogy: 'Core PCE is the scoreboard the referee is actually watching — not the crowd (CPI), not the commentators — and hard assets know which way the referee is pointing.' },
        'CUSR0000SAH1':    { brief: 'Shelter inflation is the stickiest component of CPI, at 35% weight — when it is elevated, the Fed cannot declare victory on inflation, and clients locked out of property seek alternatives.', analogy: 'Shelter inflation is the tide that raises all price boats and refuses to go out — and capital displaced from the property market finds its way to alternative stores of value.' },
        'WPSFD49207':      { brief: 'PPI leads CPI by 3–6 months — it tells you where consumer inflation is going before the headline number moves, giving brokers a genuine informational edge on timing.', analogy: 'PPI is the smoke before the fire: when upstream costs are running hot, consumer prices follow — and knowing the smoke is there before the fire breaks is the early mover\'s advantage.' },
        'M2SL':            { brief: 'M2 measures how many units of currency exist — when it grows faster than the economy, every existing unit buys less, and alternative assets with fixed supply become worth more in real terms.', analogy: 'Printing 25% more poker chips mid-game doesn\'t create more value — it just means each chip buys less, and the player who secured fixed-supply real assets from outside the casino is the one who wins.' },
        'WALCL':           { brief: 'The Fed\'s balance sheet shows how many dollars were created from nothing to buy assets — nine trillion since 2008 — and hard assets track this monetary expansion with striking precision over multi-year horizons.', analogy: 'The Fed\'s balance sheet is the world\'s most visible counterfeiting ledger — perfectly legal, meticulously documented, and gold is the only asset that literally cannot be counterfeited back.' },
        'WRESBAL':         { brief: 'Bank reserves falling sharply toward the minimum threshold signals the liquidity cushion is running out — and liquidity crises historically drive capital to safe-haven stores of value.', analogy: 'Bank reserves are the fuel gauge on the financial system\'s engine — when it approaches empty, the market seizes, and physical assets are the vehicle that runs on a different fuel entirely.' },
        'BOGMBASE':        { brief: 'The monetary base is the raw material for all money creation — when it expands, it dilutes every existing unit of currency, and alternative assets with fixed supply benefit.', analogy: 'The monetary base is the flour for the entire economy\'s bread — when the Fed adds more flour, every existing loaf is slightly smaller, and fixed-supply assets are the ingredient that cannot be substituted.' },
        'GS10':            { brief: 'The 10-year Treasury yield is the world\'s most important interest rate — when its real yield turns negative (yield minus inflation), hard assets\' most powerful secular bull runs have begun.', analogy: 'The 10-year yield is gravity for financial assets — when it rises, everything connected to the credit system gets heavier; when it falls to negative in real terms, physical assets float free.' },
        'GS2':             { brief: 'The 2-year yield is the bond market\'s Fed rate forecast — when it prices in aggressive cuts, it is telling you a recession is coming and the next monetary cycle will drive hard assets sharply higher.', analogy: 'The 2-year yield is the market\'s window into the Fed\'s diary — when it prices in aggressive cuts, the bond market has seen tomorrow\'s rate path and is positioning accordingly.' },
        'FEDFUNDS':        { brief: 'The peak of the Fed Funds Rate cycle is historically the optimal positioning point for hard assets — every prior peak has been followed by cuts that drove hard assets to their strongest multi-year returns.', analogy: 'Peak Fed Funds is the dam at maximum height — the water (capital seeking return) has nowhere left to go but over the top and downstream into hard assets once it breaks.' },
        'T10YIEM':         { brief: 'The 10-year breakeven is the bond market\'s official inflation forecast — above 2.5%, the world\'s largest capital pools are buying inflation insurance, and physical assets are that insurance held directly.', analogy: 'Breakevens above 2.5% are institutional investors paying a premium on their inflation policy — physical assets are the same insurance, held directly rather than through a derivatives contract.' },
        'DTWEXBGS':        { brief: 'The dollar index falling is a direct tailwind for gold — dollar weakness mechanically raises gold prices globally and simultaneously signals the conditions — looser monetary policy, lower real yields — that support all alternative assets.', analogy: 'Gold and the dollar are the two ends of a seesaw — when the dollar falls, gold rises automatically, because every non-dollar buyer suddenly needs fewer of their own currency to buy the same ounce.' },
        'PAYEMS':          { brief: 'Non-farm payrolls is the economy\'s most-watched monthly report — a miss signals the rate cut cycle is coming, which is the single most reliable trigger for hard asset outperformance.', analogy: 'Payrolls is the scoreboard at the end of the first half — when it disappoints, the coach (the Fed) changes the game plan, and the new plan always benefits hard assets.' },
        'ICSA':            { brief: 'Initial claims are the weekly leading indicator of labour market stress — rising claims precede headline unemployment and give you the first signal that the rate cut cycle is approaching.', analogy: 'Claims are the canary in the labour market\'s coal mine — by the time unemployment headlines are bad, the canary has already been sending its signal for weeks.' },
        'JTSJOL':          { brief: 'Job openings falling signals labour demand is softening before the headline unemployment data confirms it — the forward indicator that tells you the rate cut cycle is earlier than the consensus thinks.', analogy: 'Job openings are the employment want ads — when companies stop posting, people stop getting hired weeks later, and the Fed cuts rates months after that.' },
        'MORTGAGE30US':    { brief: 'The 30-year mortgage rate is the most direct constraint on housing affordability — when it is elevated, buyers are locked out of property and actively seeking alternative stores of value.', analogy: 'A 7% mortgage rate is a padlock on the front door of the traditional wealth-building tool — and capital that cannot get through that door eventually finds another door.' },
        'CSUSHPISA':       { brief: 'Home prices rising faster than incomes locks buyers out and displaces capital — that displaced capital seeks alternative stores of value that do not require mortgage access to enter.', analogy: 'When the property ladder is pulled up — prices rising faster than incomes can follow — investors who cannot climb seek an alternative elevator, and physical assets provide one.' },
        'UMCSENT':         { brief: 'Consumer sentiment falling is both the defensive asset trigger and the signal that clients\' guard is down — they are more receptive to portfolio protection conversations when they are worried.', analogy: 'Consumer sentiment is the emotional weather report — when it rains, clients accept umbrellas (defensive assets) they would have refused on a sunny day.' },
        'PSAVERT':         { brief: 'The savings rate falling signals consumers are drawing down reserves to maintain spending — a warning that the expansion is running on fumes and a reallocation to defensive assets is overdue.', analogy: 'The savings rate is the petrol gauge of consumer spending — when people are burning their reserves to keep going, the next stop is not an acceleration, it is a refill.' },
        'RSAFS':           { brief: 'Retail sales missing signals that consumer retrenchment is building — the defensive portfolio reallocation conversation becomes more natural when clients can feel the pressure themselves.', analogy: 'Retail sales are the economy\'s report card on consumer confidence — and when the grades disappoint, students start asking about safer subjects.' },
        'CPALTT01GBM659N': { brief: 'UK CPI above target means the BoE is trapped — cut and inflation runs; hold and growth suffers. Sterling weakness in this scenario amplifies gold returns in GBP terms.', analogy: 'UK inflation above target puts the BoE between a rock and a hard place — and that kind of monetary uncertainty is exactly when sterling-based clients benefit from holding physical assets.' },
        'IRSTCI01GBM156N': { brief: 'The BoE base rate at its peak is the UK equivalent of the Fed\'s inflection point — when UK rates peak and turn, gold in GBP terms benefits from both the rate move and the sterling weakness that follows.', analogy: 'The BoE rate peak is the high-water mark of UK monetary tightening — when the tide turns, it flows directly into GBP-denominated hard assets.' },
        'IRLTLT01GBM156N': { brief: 'UK gilts yielding more than US Treasuries is a structural anomaly reflecting UK fiscal risk — the premium demanded by markets is a signal of sterling vulnerability that directly supports GBP gold holdings.', analogy: 'When the UK has to pay more than the US to borrow — despite having a smaller economy — the market is charging an insurance premium for UK fiscal risk, and physical assets are that insurance.' },
      };

      var DEEP_DATA = {
        'T10Y2YM': {
          mechanism: 'Inversion occurs when the Fed raises short-term rates faster than long-term inflation expectations fall. The 2Y yield is driven by the expected Fed Funds path; the 10Y by long-run growth and inflation. When 2Y exceeds 10Y, the bond market is collectively forecasting that the Fed will cut rates — meaning they expect economic deterioration severe enough to force accommodation. The steeper and longer the inversion, the more aggressive the expected cutting cycle. Gold responds to the implied rate path: deeper inversion = larger expected cuts = lower real yields = stronger gold environment. The average lag from inversion to recession is 12 months; the average lag from inversion to the gold price low is 6 months.',
          history: [
            {'period':'2000-01','context':'Inverted March 2000. Dot-com bust + 9/11. Fed cut 6.5% → 1.75%.','gold':'+6% 2001, +25% 2002, +19% 2003 — 10-year bull market launched','whisky':'Christie\'s established dedicated whisky auctions 2001 — collector base forming'},
            {'period':'2006-07','context':'Inverted July 2006. GFC confirmed 2008. Fed cut 5.25% → 0%.','gold':'+32% in 2007, then +24% 2009, +29% 2010 — total +170% over 5 years','whisky':'Christie\'s Edinburgh 2008 first dedicated auction. Record prices began emerging.'},
            {'period':'2019','context':'Briefly inverted Aug 2019. COVID confirmed the signal.','gold':'+18% 2019, +24% 2020 — record $2,070 per oz','whisky':'RW101 index +17% in 2019 — outperformed most financial assets'},
            {'period':'2022-present','context':'Deepest inversion since 1981. Held >18 months. Cuts began Sep 2024.','gold':'$1,600 (Oct 2022 low) → $5,230 (Mar 2026) = +226%','whisky':'Post-flush recovery. India tariff + US tariff removal = structural demand inflection'},
          ]
        },
        'FEDFUNDS': {
          mechanism: 'The Fed Funds Rate sets the floor for all dollar-denominated borrowing costs. At its peak, every alternative investment is benchmarked against this risk-free rate. Gold has no yield — so the higher the Fed Funds rate, the higher the opportunity cost of holding gold. But this works in reverse: as rates fall, the opportunity cost falls, real yields compress, and gold re-rates. The mechanism is: rate cuts → lower real yields → dollar weakness → capital flows from fixed income → gold demand. This is not a narrative — it is a mechanical repricing. The lead time matters: gold begins moving 6–12 months before the first official cut, as futures markets price the path.',
          history: [
            {'period':'2001-04','context':'Fed cut 6.5% → 1% over 30 months following dot-com bust.','gold':'+6% 2001, +25% 2002, +19% 2003, +5% 2004 — bull market initiated','whisky':'Macallan 1926 Fine & Rare began testing record auction prices'},
            {'period':'2007-12','context':'Fed cut 5.25% → 0% and launched QE1/QE2/QE3.','gold':'+170% from 2007 peak to 2012 — most powerful 5-year run in modern gold history','whisky':'Christie\'s 2012 set world record: £26,490 for a single Macallan bottle'},
            {'period':'2019-20','context':'Fed cut 2.5% → 0% as COVID hit. Launched $4tn emergency QE.','gold':'+24% in 2020. All-time high $2,070/oz','whisky':'Rare Whisky 101 icon index up 586% over the full 2009–2021 rate cut cycle'},
            {'period':'2024-current','context':'Rate cuts began Sep 2024 from 5.5% peak. Cutting cycle ongoing.','gold':'Rose to $5,230 all-time high in anticipation of the cut cycle','whisky':'India tariff reduction + US tariff removal — largest demand catalyst since prohibition'},
          ]
        },
        'CPIAUCSL': {
          mechanism: 'CPI above 2% compresses real returns on every fixed-rate asset: cash, bonds, and savings accounts all lose purchasing power. Gold\'s role as an inflation hedge is mechanical: its price in fiat currency rises as the purchasing power of that currency falls. The relationship is not linear in the short term — gold can lag during initial inflation surges as the Fed\'s rate response raises the opportunity cost. But over multi-year horizons, gold tracks cumulative inflation with exceptional fidelity. The deeper driver is not CPI itself but real yields (nominal rate minus CPI): when real yields go negative, gold historically produces its strongest returns.',
          history: [
            {'period':'1972-80','context':'CPI peaked at 14.8% — the classic inflationary decade. Fed behind the curve.','gold':'$35 → $850 per oz: +2,329% over the decade','whisky':'First collectible Scotch auction records established — Macallan 1926 at Christie\'s'},
            {'period':'2007-08','context':'CPI peaked at 5.6% in July 2008 before the GFC deflationary crisis.','gold':'+4% full year 2008 — protected against the crisis that followed','whisky':'Christie\'s Edinburgh launched dedicated whisky sales — institutional recognition'},
            {'period':'2021-23','context':'CPI surged to 9.1% June 2022 — largest post-war inflation in 40 years.','gold':'$1,700 → $2,050 — +20% — held real value as paper assets collapsed','whisky':'Icon index peaked as collectors sought real asset diversification from bonds'},
            {'period':'2024-current','context':'Core CPI sticky 3–3.5% — above 2% target. "Higher for longer" intact.','gold':'Rose to $5,230 as markets priced structural inflation persistence','whisky':'Structural demand from India (75% tariff) and US (0% tariff) growing'},
          ]
        },
        'M2SL': {
          mechanism: 'M2 growth above nominal GDP growth is the definitional cause of monetary inflation: more units of currency chasing the same quantity of goods. Gold\'s supply grows at approximately 1.5–2% per year through mining — far slower than any central bank\'s M2 growth capacity. Over multi-decade horizons, gold\'s price in fiat currency tracks cumulative M2 expansion with remarkable precision. The 2020-21 M2 spike of +27% was a direct predictor of the 2021-22 CPI surge — with an 18-month lag. The 2022-23 M2 contraction (-4.7% — the largest since the 1930s) was the mechanism that caused the speculative flush in asset markets including whisky. Understanding M2 is understanding the monetary cycle before the headline data confirms it.',
          history: [
            {'period':'2020-21','context':'M2 expanded +27% — largest 12-month expansion since records began in 1959.','gold':'+24% in 2020. CPI then ran to 9.1% — M2 had 18-month lead','whisky':'Speculative froth entered whisky — premium prices surged on liquidity wave'},
            {'period':'2022-23','context':'M2 contracted -4.7% YoY — first contraction since the 1930s.','gold':'Volatile — initially fell, then recovered as real yields peaked','whisky':'Speculative flush in 2024-25 traced directly to this M2 contraction'},
            {'period':'1970s','context':'M2 grew 10–12% annually through the inflationary decade.','gold':'$35 → $850 per oz: the benchmark inflationary case for hard assets','whisky':'Scotch whisky first recognised as luxury asset — Christie\'s 1970s auctions'},
            {'period':'Current','context':'M2 growth returning positive after 2022-23 contraction. QT slowing.','gold':'Structural support building — monetary base expanding again','whisky':'Cannot respond to renewed liquidity — supply is fixed at 2020-22 production'},
          ]
        },
        'WALCL': {
          mechanism: 'The Fed balance sheet represents the cumulative creation of base money through asset purchases. Each expansion is funded by newly created reserves — money that did not previously exist. This base money expands the monetary multiplier, inflating broader asset prices. The correlation between Fed balance sheet expansion and gold prices is structural: as the supply of dollars increases, the relative scarcity of fixed-supply assets (gold, whisky casks, land) increases. The mechanism is not sentiment — it is arithmetic. $900bn in 2008. $4.5tn in 2015. $9tn in 2022. Gold tracked each expansion with a 6–18 month lag. QT (balance sheet reduction) is the reverse: it drains the system and temporarily raises the opportunity cost of hard assets.',
          history: [
            {'period':'2008-09','context':'Balance sheet expanded $900bn → $2.3tn via QE1. Fed bought MBS and Treasuries.','gold':'+24% in 2009, +29% in 2010 as QE money sought real assets','whisky':'Christie\'s auction house launched dedicated whisky sales — first institutional recognition'},
            {'period':'2012-15','context':'QE2 and QE3 expanded balance sheet to $4.5tn.','gold':'Peaked $1,900 (2011) — then corrected as dollar strengthened. Holding period lesson.','whisky':'RW101 Icon index began sustained appreciation — 10-year bull market in premium Scotch'},
            {'period':'2020-22','context':'COVID QE expanded balance sheet from $4.2tn to $9tn in 18 months.','gold':'$1,470 (March 2020) → $2,070 (Aug 2020): +40%. Hit $5,230 by March 2026.','whisky':'Speculative entry then flush — but structural case for physical Scotch strengthened'},
            {'period':'2022-24','context':'QT: balance sheet contracted from $9tn toward $7tn.','gold':'Volatile initially, then surged to $5,230 — QT could not override rate cut catalyst','whisky':'Speculative layer flushed. Investment-grade and cask segment structurally intact.'},
          ]
        },
        'CFNAI': {
          mechanism: 'The CFNAI aggregates 85 monthly US economic indicators into a single composite reading normalised to zero (trend growth). Below -0.70 for two consecutive months has preceded every US recession since 1967 with no false positives. The mechanism for gold is indirect: CFNAI contraction forces the Fed to cut rates, and rate cuts compress real yields, which are the primary mechanical driver of gold prices. The CFNAI is valuable not just as a coincident indicator but because it gives you the narrative — when it is deteriorating but hasn\'t yet crossed -0.70, you can frame the conversation around the trajectory rather than the threshold. That gives brokers a 3–6 month window before the mainstream narrative catches up.',
          history: [
            {'period':'2001','context':'CFNAI fell below -0.70 for 8 months. Fed cut 6.5% → 1.75%.','gold':'+6% in 2001, +25% 2002, +19% 2003 — 10-year bull market launched','whisky':'Scotch export value grew through recession — uncorrelated to equity cycle'},
            {'period':'2008-09','context':'CFNAI collapsed to record lows in 2008-09. Fed cut to 0%, launched QE.','gold':'-5% in 2008 (liquidity sell-off), then +24% 2009, +29% 2010','whisky':'First dedicated institutional whisky auctions — Christie\'s Edinburgh 2008'},
            {'period':'2020','context':'COVID — CFNAI hit worst-ever reading March 2020. $4tn emergency QE.','gold':'+24% in 2020. All-time high $2,070/oz in August','whisky':'Supply chain disruption reinforced scarcity — premium auction prices rose 15-20%'},
            {'period':'Current','context':'CFNAI oscillating near the -0.70 threshold. Rate cuts in progress.','gold':'$5,230 — new all-time high as late-cycle conditions become clear','whisky':'India + US demand catalysts arrived simultaneously — structural demand inflection'},
          ]
        },
      };

      function buildDepthContent(mode) {
        var A = ACCENT;
        if (mode === 'brief') {
          var b = BRIEF_DATA[cfg.id] || { brief: defText ? defText.split('. ')[0] + '.' : 'No summary available.', analogy: '' };
          return '<div style="grid-column:1/-1;">' +
            '<div style="font-size:8px;letter-spacing:.2em;color:' + A + ';margin-bottom:8px;">ONE-LINE SUMMARY</div>' +
            '<div style="font-size:12px;color:#ffffff;line-height:1.7;margin-bottom:14px;">' + b.brief + '</div>' +
            (b.analogy ?
              '<div style="font-size:8px;letter-spacing:.2em;color:' + A + ';margin-bottom:6px;">THE ANALOGY</div>' +
              '<div style="font-size:11px;color:#ffffff;line-height:1.7;font-style:italic;border-left:3px solid ' + A + ';padding:8px 14px;">' + b.analogy + '</div>'
            : '') +
          '</div>';
        }
        if (mode === 'deep') {
          var d = DEEP_DATA[cfg.id];
          if (!d) return buildDepthContent('full');
          return '<div style="grid-column:1/-1;">' +
            '<div style="font-size:8px;letter-spacing:.2em;color:' + A + ';margin-bottom:8px;">MECHANISM CHAIN</div>' +
            '<div style="font-size:11px;color:#ffffff;line-height:1.75;margin-bottom:16px;border-left:3px solid ' + A + ';padding:8px 14px;">' + d.mechanism + '</div>' +
            '<div style="font-size:8px;letter-spacing:.2em;color:' + A + ';margin-bottom:8px;">HISTORICAL PRECEDENTS — ALTERNATIVE ASSET OUTCOMES</div>' +
            '<div style="overflow-x:auto;">' +
              '<table style="width:100%;border-collapse:collapse;font-size:9px;min-width:560px;">' +
                '<thead><tr>' +
                  '<th style="text-align:left;padding:5px 8px;border-bottom:1px solid #2a2a2a;color:#ffffff;letter-spacing:.12em;white-space:nowrap;">PERIOD</th>' +
                  '<th style="text-align:left;padding:5px 8px;border-bottom:1px solid #2a2a2a;color:#ffffff;letter-spacing:.12em;">CONTEXT</th>' +
                  '<th style="text-align:left;padding:5px 8px;border-bottom:1px solid #2a2a2a;color:' + A + ';letter-spacing:.12em;">HARD ASSETS OUTCOME</th>' +
                  '<th style="text-align:left;padding:5px 8px;border-bottom:1px solid #2a2a2a;color:#ffffff;letter-spacing:.12em;">PHYSICALS / ALTERNATIVES</th>' +
                '</tr></thead>' +
                '<tbody>' +
                  d.history.map(function(h) {
                    return '<tr>' +
                      '<td style="padding:5px 8px;border-bottom:1px solid #1a1a1a;color:#ffffff;white-space:nowrap;">' + h['period'] + '</td>' +
                      '<td style="padding:5px 8px;border-bottom:1px solid #1a1a1a;color:#ffffff;line-height:1.5;">' + h['context'] + '</td>' +
                      '<td style="padding:5px 8px;border-bottom:1px solid #1a1a1a;color:' + A + ';font-weight:600;line-height:1.5;">' + h['gold'] + '</td>' +
                      '<td style="padding:5px 8px;border-bottom:1px solid #1a1a1a;color:#ffffff;line-height:1.5;">' + h['whisky'] + '</td>' +
                    '</tr>';
                  }).join('') +
                '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>';
        }
        /* FULL — restore 3-column layout */
        return (defText ? '<div><div style="font-size:8px;letter-spacing:.2em;color:' + A + ';margin-bottom:6px;">WHAT IT MEASURES</div><div style="font-size:11px;color:#ffffff;line-height:1.7;">' + defText + '</div></div>' : '<div></div>') +
          (sigText ? '<div><div style="font-size:8px;letter-spacing:.2em;color:' + A + ';margin-bottom:6px;">HOW TO READ THE SIGNAL</div><div style="font-size:11px;color:#ffffff;line-height:1.7;">' + sigText + '</div></div>' : '<div></div>') +
          (pitchText ? '<div><div style="font-size:8px;letter-spacing:.2em;color:' + A + ';margin-bottom:6px;">SALES ANGLE</div><div style="font-size:11px;color:#ffffff;line-height:1.7;">' + pitchText + '</div></div>' : '<div></div>');
      }

      function refreshDepthPanel() {
        var panel = modal.querySelector('#bc-depth-panel');
        if (!panel) return;
        var single = _depthMode !== 'full';
        panel.style.gridTemplateColumns = single ? '1fr' : '1fr 1fr 1fr';
        panel.innerHTML = buildDepthContent(_depthMode);
      }

      function syncDepthBtns() {
        var hasDeep = !!DEEP_DATA[cfg.id];
        var modes = {b:'brief', f:'full', d:'deep'};
        Object.keys(modes).forEach(function(k) {
          var btn = modal.querySelector('#bc-dep-' + k);
          if (!btn) return;
          var active = _depthMode === modes[k];
          if (k === 'd' && !hasDeep) {
            /* Disabled — no deep data for this indicator */
            btn.style.background = 'transparent';
            btn.style.color = 'rgba(255,255,255,0.18)';
            btn.style.borderColor = '#161616';
            btn.style.cursor = 'not-allowed';
            btn.style.opacity = '0.5';
            btn.title = 'No deep analysis for this indicator';
            return;
          }
          btn.style.cursor = 'pointer';
          btn.style.opacity = '';
          btn.title = '';
          btn.style.background = active ? ACCENT : 'transparent';
          btn.style.color = active ? '#fff' : '#ffffff';
          btn.style.borderColor = active ? ACCENT : '#3a3a3a';
        });
      }

      var _depBrief = modal.querySelector('#bc-dep-b');
      var _depFull  = modal.querySelector('#bc-dep-f');
      var _depDeep  = modal.querySelector('#bc-dep-d');
      if (_depBrief) _depBrief.addEventListener('click', function(){ _depthMode='brief'; refreshDepthPanel(); syncDepthBtns(); });
      if (_depFull)  _depFull.addEventListener('click',  function(){ _depthMode='full';  refreshDepthPanel(); syncDepthBtns(); });
      if (_depDeep)  _depDeep.addEventListener('click',  function(){ if (!DEEP_DATA[cfg.id]) return; _depthMode='deep';  refreshDepthPanel(); syncDepthBtns(); });
      syncDepthBtns(); /* apply correct DEEP enabled/disabled state immediately on open */


      var modalCanvas = document.getElementById('fred-modal-canvas');
      var dpr = window.devicePixelRatio || 1;

      function redrawModal() {
        var W = modalCanvas.clientWidth, H = modalCanvas.clientHeight;
        if (!W || !H) return;
        modalCanvas.width = Math.round(W * dpr);
        modalCanvas.height = Math.round(H * dpr);
        var ctx = modalCanvas.getContext('2d');
        ctx.scale(dpr, dpr);
        var disp = computeDisplayObs(rawObs, cfg);
        var filtered = filterByPeriod(disp, modalState.period);
        /* Zoom window: viewStart/viewEnd are fractions [0,1] of filtered */
        var _vs = Math.max(0, Math.min(modalState.viewStart, 0.97));
        var _ve = Math.max(_vs + 0.03, Math.min(modalState.viewEnd, 1));
        var _si = Math.round(_vs * filtered.length);
        var _ei = Math.round(_ve * filtered.length);
        if (_ei > _si + 1) filtered = filtered.slice(_si, _ei);
        var cmpPts = modalState.cmpList.map(function(id, ci) {
          var d = cmpData[id];
          if (!d || !d.length) return null;
          return { pts: d, color: COMP_COLS[ci % COMP_COLS.length] };
        }).filter(Boolean);
        drawChart(ctx, W, H, filtered, cfg, {
          mini: false,
          chartType: modalState.chartType,
          showMA12: modalState.showMA12,
          showMA24: modalState.showMA24,
          showBB: modalState.showBB,
          zScore: modalState.zScore,
          logScale: modalState.logScale,
          showTrend: modalState.showTrend,
          crosshair: true,
          crosshairX: modalState.crosshairX,
          compare: cmpPts
        });
      }

      function syncBtns() {
        modal.querySelectorAll('.modal-ct-btn').forEach(function(b) {
          b.style.color = b.dataset.ct === modalState.chartType ? ACCENT : '#ffffff';
          b.style.fontWeight = b.dataset.ct === modalState.chartType ? '700' : '400';
          b.style.borderColor = b.dataset.ct === modalState.chartType ? ACCENT : '#252525';
        });
        modal.querySelectorAll('.modal-period-btn').forEach(function(b) {
          b.style.color = b.dataset.period === modalState.period ? ACCENT : '#ffffff';
          b.style.fontWeight = b.dataset.period === modalState.period ? '700' : '400';
          b.style.borderColor = b.dataset.period === modalState.period ? ACCENT : '#252525';
        });
        var ovlMap = { ma12:'showMA12', ma24:'showMA24', bb:'showBB', z:'zScore', log:'logScale', tl:'showTrend' };
        modal.querySelectorAll('.modal-ovl-btn').forEach(function(b) {
          var key = ovlMap[b.dataset.ovl];
          var on = key && modalState[key];
          b.style.color = on ? ACCENT : '#ffffff';
          b.style.fontWeight = on ? '700' : '400';
          b.style.borderColor = on ? ACCENT : '#252525';
        });
      }

      function loadCmpEntry(selVal) {
        var parts = selVal.split(':');
        var srcType = parts[0], seriesId = parts.slice(1).join(':');
        var cacheKey = srcType + '_cmp_' + seriesId;
        var cached = null;
        try { var cs = localStorage.getItem('tbt_' + cacheKey); if (cs) { var cp = JSON.parse(cs); if (Date.now() - cp.ts < CACHE_TTL) cached = cp.data; } } catch(e) {}

        if (cached) {
          if (!modalState.cmpList.includes(seriesId)) modalState.cmpList.push(seriesId);
          cmpData[seriesId] = cached;
          updateCmpChips();
          redrawModal();
          return;
        }

        if (srcType === 'fred') {
          fetch('/.netlify/functions/fred-data?series=' + seriesId + '&limit=300')
            .then(function(r){ return r.json(); })
            .then(function(d) {
              var obs = d && d.series && d.series[seriesId] ? d.series[seriesId].observations : null;
              if (!obs || !obs.length) return;
              var pts = obs.map(function(o){ return { date: o.date, value: o.value }; });
              try { localStorage.setItem('tbt_fred_cmp_' + seriesId, JSON.stringify({ ts: Date.now(), data: pts })); } catch(e) {}
              if (!modalState.cmpList.includes(seriesId)) modalState.cmpList.push(seriesId);
              cmpData[seriesId] = pts;
              updateCmpChips();
              redrawModal();
            }).catch(function(){});
        } else {
          fetch('/.netlify/functions/macro-data?type=chart&series=' + seriesId + '&years=20')
            .then(function(r){ return r.json(); })
            .then(function(d) {
              if (!d.data || !d.data.length) return;
              var pts = d.data.map(function(p){ return { date: p.d, value: p.v }; });
              try { localStorage.setItem('tbt_macro_cmp_' + seriesId, JSON.stringify({ ts: Date.now(), data: pts })); } catch(e) {}
              if (!modalState.cmpList.includes(seriesId)) modalState.cmpList.push(seriesId);
              cmpData[seriesId] = pts;
              updateCmpChips();
              redrawModal();
            }).catch(function(){});
        }
      }

      function updateCmpChips() {
        var chips = document.getElementById('fred-cmp-chips');
        if (!chips) return;
        chips.innerHTML = '';
        modalState.cmpList.forEach(function(id, ci) {
          var col = COMP_COLS[ci % COMP_COLS.length];
          var label = id;
          var mmEntry = MM_INSTRUMENTS.find(function(m){ return m.id === id; });
          if (mmEntry) label = mmEntry.lbl;
          else { var fEntry = FRED_CMP_OPTIONS.find(function(f){ return f.id === id; }); if (fEntry) label = fEntry.lbl; }
          var chip = document.createElement('div');
          chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#181818;border:1px solid ' + col + ';border-radius:2px;padding:1px 6px;font-size:7px;color:#ffffff;font-family:Consolas,monospace;';
          chip.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:' + col + ';flex-shrink:0;"></span>' + label + '<button style="background:none;border:none;color:#ffffff;opacity:0.6;cursor:pointer;font-size:10px;padding:0 0 0 2px;" data-id="' + id + '">&times;</button>';
          chip.querySelector('button').addEventListener('click', function() {
            var rmId = this.dataset.id;
            modalState.cmpList = modalState.cmpList.filter(function(x){ return x !== rmId; });
            delete cmpData[rmId];
            updateCmpChips();
            redrawModal();
          });
          chips.appendChild(chip);
        });
      }

      modal.querySelectorAll('.modal-ct-btn').forEach(function(b) {
        b.addEventListener('click', function() { modalState.chartType = b.dataset.ct; syncBtns(); redrawModal(); });
      });
      modal.querySelectorAll('.modal-period-btn').forEach(function(b) {
        b.addEventListener('click', function() { modalState.period = b.dataset.period; modalState.viewStart = 0; modalState.viewEnd = 1; syncBtns(); redrawModal(); });
      });
      var ovlMap2 = { ma12:'showMA12', ma24:'showMA24', bb:'showBB', z:'zScore', log:'logScale', tl:'showTrend' };
      modal.querySelectorAll('.modal-ovl-btn').forEach(function(b) {
        b.addEventListener('click', function() {
          var key = ovlMap2[b.dataset.ovl];
          if (key) { modalState[key] = !modalState[key]; syncBtns(); redrawModal(); }
        });
      });
      var cmpSel = document.getElementById('fred-cmp-sel');
      if (cmpSel) {
        cmpSel.addEventListener('change', function() {
          if (!cmpSel.value) return;
          loadCmpEntry(cmpSel.value);
          cmpSel.value = '';
        });
      }
      document.getElementById('fred-modal-close').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

      modalCanvas.addEventListener('mousemove', function(e) {
        var rect = modalCanvas.getBoundingClientRect();
        modalState.crosshairX = (e.clientX - rect.left);
        redrawModal();
      });
      modalCanvas.addEventListener('mouseleave', function() {
        modalState.crosshairX = null;
        redrawModal();
      });

      /* Scroll-wheel zoom (pinch in/out on time axis) */
      modalCanvas.addEventListener('wheel', function(e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? 1 : -1; /* +1 = zoom out, -1 = zoom in */
        var span = modalState.viewEnd - modalState.viewStart;
        var step = span * 0.12;
        var rect = modalCanvas.getBoundingClientRect();
        var cx = (e.clientX - rect.left) / rect.width; /* focal point 0-1 */
        cx = Math.max(0, Math.min(1, cx));
        var newSpan = Math.max(0.05, Math.min(1, span + delta * step));
        var mid = modalState.viewStart + cx * span;
        var ns = mid - cx * newSpan;
        var ne = mid + (1 - cx) * newSpan;
        if (ns < 0) { ne = Math.min(1, ne - ns); ns = 0; }
        if (ne > 1) { ns = Math.max(0, ns - (ne - 1)); ne = 1; }
        modalState.viewStart = Math.max(0, ns);
        modalState.viewEnd   = Math.min(1, ne);
        modalState.crosshairX = null;
        redrawModal();
      }, { passive: false });

      /* Drag-to-pan */
      (function() {
        var _dragging = false;
        var _dragX = 0;
        var _dragVS = 0;
        var _dragVE = 0;
        modalCanvas.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return;
          _dragging = true;
          _dragX  = e.clientX;
          _dragVS = modalState.viewStart;
          _dragVE = modalState.viewEnd;
          modalCanvas.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', function(e) {
          if (!_dragging) return;
          var dx = e.clientX - _dragX;
          var rect = modalCanvas.getBoundingClientRect();
          var span = _dragVE - _dragVS;
          var shift = -(dx / rect.width) * span;
          var ns = Math.max(0, _dragVS + shift);
          var ne = ns + span;
          if (ne > 1) { ne = 1; ns = Math.max(0, ne - span); }
          modalState.viewStart = ns;
          modalState.viewEnd   = ne;
          modalState.crosshairX = null;
          redrawModal();
        });
        document.addEventListener('mouseup', function() {
          if (!_dragging) return;
          _dragging = false;
          modalCanvas.style.cursor = '';
        });
      }());

      syncBtns();
      setTimeout(function() { redrawModal(); }, 50);
    }

    var container = body;
    if (!container) return;
    container.innerHTML = '';
    container.style.cssText = 'font-family:Consolas,monospace;background:#000;color:#fff;height:100%;overflow-y:auto;display:flex;flex-direction:column;';

    var header = document.createElement('div');
    header.style.cssText = 'padding:12px 18px 0;flex-shrink:0;';
    header.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">' +
        '<div>' +
          '<div style="font-size:9px;letter-spacing:.25em;color:' + ACCENT + ';margin-bottom:2px;">THE BROKERS TERMINAL</div>' +
          '<div style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:.06em;">MACRO MONITOR</div>' +
        '</div>' +
        '<div id="bc-status-pill" style="margin-left:auto;padding:4px 14px;border-radius:2px;font-size:10px;font-weight:700;letter-spacing:.12em;background:#1a1a1a;color:#ffffff;">LOADING...</div>' +
        '<div id="bc-sales-angle" style="font-size:10px;color:#ffffff;max-width:400px;line-height:1.6;"></div>' +
      '</div>' +
      '<div id="bc-tabs" style="display:flex;gap:0;border-bottom:1px solid #1a1a1a;margin-bottom:12px;overflow-x:auto;">' +
        TABS.map(function(t) {
          return '<button class="bc-tab-btn" data-tab="' + t.id + '" style="background:none;border:none;border-bottom:2px solid transparent;color:#ffffff;opacity:0.6;font-size:10px;font-weight:600;letter-spacing:.12em;padding:6px 14px;cursor:pointer;white-space:nowrap;font-family:Consolas,monospace;">' + t.lbl + '</button>';
        }).join('') +
      '</div>';

    var tilesWrap = document.createElement('div');
    tilesWrap.id = 'bc-tiles-wrap';
    tilesWrap.style.cssText = 'padding:0 18px 18px;flex:1;';

    container.appendChild(header);
    container.appendChild(tilesWrap);

    var activeTab = 'cycle';
    var seriesCache = {};

    function cacheKey(tabId) { return 'tbt_fred_' + tabId + '_v3'; }

    function fetchTab(tabId, onDone) {
      var series = SERIES_BY_TAB[tabId] || [];
      var ids = series.map(function(s){ return s.id; }).join(',');

      var ck = cacheKey(tabId);
      try {
        var cs = localStorage.getItem(ck);
        if (cs) {
          var cp = JSON.parse(cs);
          if (Date.now() - cp.ts < CACHE_TTL) {
            seriesCache[tabId] = cp.data;
            onDone(cp.data);
            return;
          }
        }
      } catch(e) {}

      fetch('/.netlify/functions/fred-data?series=' + ids + '&limit=300')
        .then(function(r){ return r.json(); })
        .then(function(d) {
          var result = {};
          series.forEach(function(cfg) {
            var raw = d.series && d.series[cfg.id] ? d.series[cfg.id].observations : null;
            if (raw) result[cfg.id] = raw;
          });
          try { localStorage.setItem(ck, JSON.stringify({ ts: Date.now(), data: result })); } catch(e) {}
          seriesCache[tabId] = result;
          onDone(result);
        })
        .catch(function() { onDone({}); });
    }

    function renderTab(tabId) {
      activeTab = tabId;
      header.querySelectorAll('.bc-tab-btn').forEach(function(b) {
        var active = b.dataset.tab === tabId;
        b.style.borderBottomColor = active ? ACCENT : 'transparent';
        b.style.color = '#ffffff';
        b.style.opacity = active ? '1' : '0.6';
      });

      tilesWrap.innerHTML = '<div style="color:#ffffff;font-size:11px;padding:20px 0;">Loading FRED data...</div>';

      fetchTab(tabId, function(seriesMap) {
        var series = SERIES_BY_TAB[tabId] || [];
        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;';

        series.forEach(function(cfg) {
          var rawObs = seriesMap[cfg.id] || [];
          var wrapper = document.createElement('div');
          wrapper.innerHTML = tileHTML(cfg, rawObs);
          var tile = wrapper.firstChild;
          tile.addEventListener('mouseenter', function() { tile.style.borderColor = '#333333'; });
          tile.addEventListener('mouseleave', function() { tile.style.borderColor = '#1e1e1e'; });
          grid.appendChild(tile);
          if (rawObs.length) attachTileChart(tile, cfg, rawObs);
        });

        tilesWrap.innerHTML = '';
        tilesWrap.appendChild(grid);

        var st = tabStatus(tabId, seriesMap);
        var pill = document.getElementById('bc-status-pill');
        if (pill) {
          pill.style.background = 'transparent';
          pill.style.color = st.col;
          pill.style.border = '1px solid ' + st.col;
          pill.textContent = st.lbl;
        }
        var angleEl = document.getElementById('bc-sales-angle');
        if (angleEl) angleEl.textContent = salesAngle(tabId, seriesMap, st);
      });
    }

    header.querySelectorAll('.bc-tab-btn').forEach(function(b) {
      b.addEventListener('click', function() { renderTab(b.dataset.tab); });
    });

    window._bcTab = function(tabId) { renderTab(tabId); };

    /* Refresh sales angle when lens changes — no re-fetch needed */
    window.addEventListener('lens:change', function () {
      var cached = seriesCache[activeTab];
      if (!cached) return;
      var st = tabStatus(activeTab, cached);
      var angleEl = document.getElementById('bc-sales-angle');
      if (angleEl) angleEl.textContent = salesAngle(activeTab, cached, st);
    });

    renderTab('cycle');
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
