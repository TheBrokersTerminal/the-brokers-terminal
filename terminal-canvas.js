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
      {type:'macro_monitor',  icon:'▦', lbl:'MACRO MONITOR',        sub:'Cross-asset heatmap — 14 series with WTD/QTD/YTD/1Y'},
      {type:'macro_chart',    icon:'◐', lbl:'ASSET COMPARISON',     sub:'Gold vs S&P 500 vs inflation chart'},
      {type:'macro_intel',    icon:'◧', lbl:'MACRO INTELLIGENCE',   sub:'Professor + sales engine — 5 macro themes'},
      {type:'ticker',         icon:'▸', lbl:'NEWS TICKER',          sub:'Scrolling headline bar — show/filter by gold or whisky'},
      {type:'sector_heatmap', icon:'▩', lbl:'SECTOR HEATMAP',        sub:'US equity sectors — day% performance with heatmap colouring'},
      {type:'watchlist',      icon:'◈', lbl:'MY WATCHLIST',          sub:'Pin your own tickers with live prices and day change'},
      {type:'global_map',     icon:'◉', lbl:'GLOBAL MAP',            sub:'World view — macro rates, inflation, gold production, whisky regions'},
    ].map(function (w) {
      return '<div class="tbc-add-item" data-type="' + w.type + '">' +
        '<span class="tbc-add-icon">' + w.icon + '</span>' +
        '<div><div class="tbc-add-lbl">' + w.lbl + '</div><div class="tbc-add-sub">' + w.sub + '</div></div>' +
        '</div>';
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
          w: type === 'notes' ? 280 : type === 'news' ? 400 : type === 'chat' ? 480 : type === 'calendar' || type === 'econ_calendar' ? 420 : type === 'macro_chart' ? 520 : type === 'macro_intel' ? 580 : type === 'macro_monitor' ? 720 : type === 'sector_heatmap' ? 460 : type === 'watchlist' ? 320 : type === 'global_map' ? 760 : 340,
          h: type === 'news' || type === 'notes' ? 480 : type === 'chat' ? 440 : type === 'calendar' ? 380 : type === 'econ_calendar' ? 500 : type === 'macro_chart' ? 360 : type === 'macro_intel' ? 500 : type === 'macro_monitor' ? 480 : type === 'sector_heatmap' ? 340 : type === 'watchlist' ? 420 : type === 'global_map' ? 480 : 240,
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
  function spawnWidget(cfg) {
    var el = document.createElement('div');
    el.className = 'tbc-widget';
    el.id = cfg.id;
    el.style.cssText = 'left:' + cfg.x + 'px;top:' + cfg.y + 'px;width:' + cfg.w + 'px;height:' + cfg.h + 'px;z-index:' + (++window._sharedZ) + ';';

    var icons = {news:'◈', market:'◉', reports:'▣', notes:'✎', intel:'◆', chat:'◎', calendar:'◷', notes_inbox:'✉', report_viewer:'▤', econ_calendar:'◫', macro_chart:'◐', macro_intel:'◧', macro_monitor:'▦', sector_heatmap:'▩', watchlist:'◈', global_map:'◉'};
    var titles = {news:'LIVE HEADLINES', market:'MARKET PRICES', reports:'VAULT · LATEST', notes:'MY NOTES', intel:'BROKERS INTEL', chat:'FIRM CHAT', calendar:'CALENDAR', notes_inbox:'FIRM NOTES', report_viewer:'REPORT', econ_calendar:'ECONOMIC CALENDAR', macro_chart:'ASSET COMPARISON', macro_intel:'MACRO INTELLIGENCE', macro_monitor:'MACRO MONITOR', sector_heatmap:'SECTOR HEATMAP', watchlist:'MY WATCHLIST', global_map:'GLOBAL MAP'};

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
        var asset = (window.firmAccess || 'both').toLowerCase();
        var top;
        var twoHrsAgo = Math.floor(Date.now()/1000) - 7200;
        function supplementWithRecent(matched, limit) {
          /* If latest match is stale (>2h old), pad with fresh general financial news */
          var isStale = !matched.length || matched[0].datetime < twoHrsAgo;
          if (!isStale) return matched.slice(0, limit);
          var seen = {};
          matched.forEach(function(s){ seen[s.url] = true; });
          var extras = stories.filter(function(s){ return !seen[s.url]; }).slice(0, limit - matched.length);
          return matched.concat(extras).slice(0, limit);
        }
        if (asset === 'whisky' || asset === 'gold') {
          top = supplementWithRecent(stories.filter(function(s){ return _newsRelevant(s, asset); }), 15);
        } else {
          top = supplementWithRecent(stories.filter(function(s){
            return _newsRelevant(s, 'whisky') || _newsRelevant(s, 'gold');
          }), 15);
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
        /* auto-refresh every 5 min — bust cache so fresh stories are fetched */
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

    var sortCol = 'cat'; /* default sort preserves category order */
    var sortDir = 1;
    var filterQ = '';
    var lastData = null;

    var CAT_ORDER = ['COMMODITIES','EQUITIES','FX','RATES','INFLATION','LIQUIDITY'];

    function fmtLast(row) {
      var v = row.last;
      if (v === null) return '—';
      if (row.u === 'GBP/oz') return '£' + Math.round(v).toLocaleString('en-GB');
      if (row.u === 'USD/bbl') return '$' + v.toFixed(2);
      if (row.u === 'pts') return Math.round(v).toLocaleString();
      if (row.u === 'FX') return v.toFixed(4);
      if (row.u === '%') return v.toFixed(2) + '%';
      if (row.u === 'idx') return v.toFixed(1);
      if (row.u === '$bn') return '$' + Math.round(v / 1000).toLocaleString() + 'B';
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

      var cols = [
        { key:'n',   lbl:'NAME'   },
        { key:'last',lbl:'LAST'   },
        { key:'net', lbl:'NET'    },
        { key:'day', lbl:'DAY%'   },
        { key:'wtd', lbl:'WTD%'   },
        { key:'qtd', lbl:'QTD%'   },
        { key:'ytd', lbl:'YTD%'   },
        { key:'y1',  lbl:'1Y%'    },
      ];

      var thead = '<thead><tr>' + cols.map(function(c) {
        var cls = 'mm-th' + (sortCol === c.key ? (' sort-' + (sortDir > 0 ? 'asc' : 'desc')) : '');
        return '<th class="' + cls + '" data-col="' + c.key + '">' + c.lbl + '</th>';
      }).join('') + '</tr></thead>';

      var prevCat = '';
      var tbody = '<tbody>';
      visible.forEach(function(r) {
        if (sortCol === 'cat' && r.cat !== prevCat) {
          prevCat = r.cat;
          tbody += '<tr class="mm-cat-row"><td colspan="8">' + r.cat + '</td></tr>';
        }
        tbody += '<tr class="mm-tr" data-series="' + escH(r.chartId || r.s) + '" data-name="' + escH(r.n) + '">' +
          '<td class="mm-td mm-td-name">' + escH(r.n) + '</td>' +
          '<td class="mm-td mm-td-last">' + fmtLast(r) + '</td>' +
          '<td class="mm-td ' + netCls(r.net) + '">' + fmtNet(r) + '</td>' +
          pctCell(r.day) +
          pctCell(r.wtd) +
          pctCell(r.qtd) +
          pctCell(r.ytd) +
          pctCell(r.y1) +
          '</tr>';
      });
      tbody += '</tbody>';

      return '<table class="mm-table">' + thead + tbody + '</table>';
    }

    function render(rows) {
      lastData = rows;
      body.innerHTML =
        '<div class="mm-wrap">' +
          '<div class="mm-topbar">' +
            '<input class="mm-search" id="mm-search-' + id + '" placeholder="FILTER…" value="' + escH(filterQ) + '">' +
            '<span class="mm-live-dot">● LIVE</span>' +
            '<span class="mm-ts-lbl" id="mm-ts-' + id + '">0s AGO</span>' +
          '</div>' +
          '<div class="mm-table-wrap" id="mm-tw-' + id + '">' + buildTable(rows) + '</div>' +
          '<div class="mm-foot">FRED · FX LIVE VIA ER-API · AUTO-REFRESH 60s · CLICK ROW FOR CHART · HEATMAP SCALE ±25%</div>' +
        '</div>';

      /* search */
      body.querySelector('#mm-search-' + id).addEventListener('input', function (e) {
        filterQ = e.target.value;
        body.querySelector('#mm-tw-' + id).innerHTML = buildTable(lastData);
        wireTable();
      });

      wireTable();
    }

    function wireTable() {
      /* sort headers */
      body.querySelectorAll('.mm-th').forEach(function (th) {
        th.addEventListener('click', function () {
          var col = th.dataset.col;
          if (sortCol === col) { sortDir *= -1; }
          else { sortCol = col; sortDir = col === 'n' ? 1 : -1; }
          body.querySelector('#mm-tw-' + id).innerHTML = buildTable(lastData);
          wireTable();
        });
      });

      /* row click → chart */
      body.querySelectorAll('.mm-tr[data-series]').forEach(function (tr) {
        tr.addEventListener('click', function () {
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
      fetch('/.netlify/functions/macro-data?type=monitor-live')
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
    body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;';

    function hmBg(dp) {
      if (dp === null) return '#111';
      var v = Math.max(-3, Math.min(3, dp)), i = Math.abs(v) / 3, a = 0.18 + i * 0.68;
      return v > 0 ? 'rgba(44,160,80,' + a.toFixed(2) + ')' : v < 0 ? 'rgba(180,50,50,' + a.toFixed(2) + ')' : '#111';
    }

    function draw(rows) {
      var ts = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      body.innerHTML = '<div class="sh-grid">' +
        rows.map(function(s) {
          var price = s.c ? '$' + s.c.toFixed(2) : '—';
          var chg = s.dp !== null ? (s.dp >= 0 ? '+' : '') + s.dp.toFixed(2) + '%' : '—';
          return '<div class="sh-tile" style="background:' + hmBg(s.dp) + '">' +
            '<div class="sh-name">' + escH(s.name) + '</div>' +
            '<div class="sh-etf">' + escH(s.etf) + '</div>' +
            '<div class="sh-price">' + price + '</div>' +
            '<div class="sh-chg ' + (s.dp === null ? '' : s.dp >= 0 ? 'sh-pos' : 'sh-neg') + '">' + chg + '</div>' +
            '</div>';
        }).join('') + '</div>' +
        '<div class="sh-footer">S&P SPDR SECTOR ETFs · FINNHUB · ' + ts + '</div>';
    }

    function fetch_sectors() {
      body.innerHTML = '<div class="tbw-loading">LOADING SECTORS…</div>';
      fetch('/.netlify/functions/macro-data?type=sectors')
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(rows){ if (rows) draw(rows); else body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; })
        .catch(function(){ body.innerHTML = '<div class="tbw-loading">UNAVAILABLE</div>'; });
    }

    fetch_sectors();
    clearTimeout(el_refresh_timer(id));
    set_refresh_timer(id, setInterval(function() {
      if (!body.querySelector('.sh-grid') && !body.querySelector('.tbw-loading')) { clearInterval(el_refresh_timer(id)); return; }
      fetch_sectors();
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
    var overlay  = null;   /* { series, label, unit, data } | null */
    var locked   = false;
    var picking  = false;
    var ro       = null;

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
              '<button class="mpc-ctrl-btn' + (logScale ? ' mpc-ctrl-act' : '') + '" id="mpc-log-btn">LOG</button>' +
              '<button class="mpc-ctrl-btn" id="mpc-note-btn">✎ NOTE</button>' +
              '<button class="mpc-ctrl-btn' + (picking ? ' mpc-ctrl-act' : '') + '" id="mpc-ov-btn">⊕ OVERLAY</button>' +
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

      function paint(hoverIdx) {
        var W = area.clientWidth || 460;
        var H = area.clientHeight || 230;
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');
        var hasOv = !!(overlay && overlay.data && overlay.data.length);
        var P = { t: 20, r: hasOv ? 56 : 18, b: 36, l: 58 };
        var cw = W - P.l - P.r, ch = H - P.t - P.b;

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
        function pY(v) { var lv = logScale ? logV(v) : v; return P.t + ch - ((lv - vMin) / vRng) * ch; }

        /* Overlay Y range */
        var oMin, oMax, oRng;
        if (hasOv) {
          var oVals = logScale ? overlay.data.map(function(p){ return logV(p.v); }) : overlay.data.map(function(p){ return p.v; });
          oMin = Math.min.apply(null, oVals); oMax = Math.max.apply(null, oVals); oRng = oMax - oMin || 1;
          oMin -= oRng * 0.05; oMax += oRng * 0.05; oRng = oMax - oMin;
        }
        function oY(v) { var lv = logScale ? logV(v) : v; return P.t + ch - ((lv - oMin) / oRng) * ch; }

        /* Background */
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);

        /* Grid + primary Y labels */
        ctx.font = '8px monospace';
        for (var g = 0; g <= 4; g++) {
          var gy = P.t + ((4 - g) / 4) * ch;
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
            var ogy = P.t + ((4 - og) / 4) * ch;
            var ogv = oMin + (og / 4) * oRng;
            var ogvReal = logScale ? Math.exp(ogv) : ogv;
            ctx.fillStyle = '#4a9eed'; ctx.textAlign = 'left';
            ctx.fillText(fmtY(ogvReal, overlay.unit), P.l + cw + 4, ogy + 3);
          }
        }

        /* Primary area fill */
        var grad = ctx.createLinearGradient(0, P.t, 0, P.t + ch);
        grad.addColorStop(0, 'rgba(233,113,50,0.18)'); grad.addColorStop(1, 'rgba(233,113,50,0.01)');
        ctx.beginPath();
        ctx.moveTo(dX(data[0].d), pY(data[0].v));
        for (var i = 1; i < data.length; i++) ctx.lineTo(dX(data[i].d), pY(data[i].v));
        ctx.lineTo(dX(data[data.length-1].d), P.t + ch); ctx.lineTo(dX(data[0].d), P.t + ch);
        ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

        /* Primary line */
        ctx.beginPath(); ctx.strokeStyle = '#E97132'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.moveTo(dX(data[0].d), pY(data[0].v));
        for (var i = 1; i < data.length; i++) ctx.lineTo(dX(data[i].d), pY(data[i].v));
        ctx.stroke();

        /* Overlay line (dashed blue) */
        if (hasOv) {
          ctx.beginPath(); ctx.strokeStyle = '#4a9eed'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
          ctx.moveTo(dX(overlay.data[0].d), oY(overlay.data[0].v));
          for (var i = 1; i < overlay.data.length; i++) ctx.lineTo(dX(overlay.data[i].d), oY(overlay.data[i].v));
          ctx.stroke(); ctx.setLineDash([]);
        }

        /* X-axis labels */
        var tCount = Math.min(6, data.length);
        ctx.fillStyle = '#fff'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
        for (var t = 0; t < tCount; t++) {
          var ti = Math.round(t / (tCount - 1) * (data.length - 1));
          ctx.fillText(data[ti].d.slice(0, 7), dX(data[ti].d), H - P.b + 14);
        }

        /* Hover crosshair */
        if (hoverIdx !== undefined && hoverIdx >= 0 && hoverIdx < data.length) {
          var hx = dX(data[hoverIdx].d), hy = pY(data[hoverIdx].v);
          ctx.strokeStyle = locked ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(hx, P.t); ctx.lineTo(hx, P.t + ch); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#E97132'; ctx.fill();
          if (hasOv) {
            var hts = new Date(data[hoverIdx].d).getTime();
            var nOI = 0, nDist = Infinity;
            overlay.data.forEach(function (op, oi) { var d2 = Math.abs(new Date(op.d).getTime() - hts); if (d2 < nDist) { nDist = d2; nOI = oi; } });
            ctx.beginPath(); ctx.arc(dX(overlay.data[nOI].d), oY(overlay.data[nOI].v), 3.5, 0, Math.PI * 2); ctx.fillStyle = '#4a9eed'; ctx.fill();
          }
        }

        canvas._state = { P: P, cw: cw, ch: ch, data: data, hasOv: hasOv, tsMin: tsMin, tsSpan: tsSpan };
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

      canvas.addEventListener('click', function () { locked = !locked; canvas.style.cursor = locked ? 'crosshair' : 'default'; });
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
