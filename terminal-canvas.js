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
  var _zTop = 100;

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
          w: type === 'notes' ? 280 : type === 'news' ? 400 : type === 'chat' ? 480 : type === 'calendar' || type === 'econ_calendar' ? 420 : 340,
          h: type === 'news' || type === 'notes' ? 480 : type === 'chat' ? 440 : type === 'calendar' ? 380 : type === 'econ_calendar' ? 500 : 240,
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
    el.style.cssText = 'left:' + cfg.x + 'px;top:' + cfg.y + 'px;width:' + cfg.w + 'px;height:' + cfg.h + 'px;z-index:' + (++_zTop) + ';';

    var icons = {news:'◈', market:'◉', reports:'▣', notes:'✎', intel:'◆', chat:'◎', calendar:'◷', notes_inbox:'✉', report_viewer:'▤', econ_calendar:'◫'};
    var titles = {news:'LIVE HEADLINES', market:'MARKET PRICES', reports:'VAULT · LATEST', notes:'MY NOTES', intel:'BROKERS INTEL', chat:'FIRM CHAT', calendar:'CALENDAR', notes_inbox:'FIRM NOTES', report_viewer:'REPORT', econ_calendar:'ECONOMIC CALENDAR'};

    el.innerHTML =
      '<div class="tbc-widget-bar">' +
        '<span class="tbc-widget-icon">' + (icons[cfg.type]||'◆') + '</span>' +
        '<span class="tbc-widget-title" id="' + cfg.id + '-title">' + (titles[cfg.type]||cfg.type.toUpperCase()) + '</span>' +
        '<div class="tbc-widget-actions">' +
          '<button class="tbc-widget-btn zoom-out" title="Zoom out">−</button>' +
          '<button class="tbc-widget-btn zoom-in"  title="Zoom in">+</button>' +
          '<button class="tbc-widget-btn refresh" title="Refresh" data-wid="' + cfg.id + '">↺</button>' +
          '<button class="tbc-widget-btn close" title="Remove" data-wid="' + cfg.id + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="tbc-widget-body" id="' + cfg.id + '-body"><div class="tbw-loading">LOADING…</div></div>';

    _canvas.appendChild(el);
    _widgets[cfg.id] = {el: el, cfg: cfg};

    el.addEventListener('mousedown', function () {
      el.style.zIndex = ++_zTop;
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
    else if (type === 'econ_calendar') renderEconCalendar(id, body);
  }

  /* ── NEWS ── */
  function renderNews(id, body) {
    var fetchStories = window._rssCache
      ? Promise.resolve(window._rssCache)
      : fetch('/.netlify/functions/rss').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){ if(d) window._rssCache = d; return d; });
    fetchStories
      .then(function (stories) {
        if (!stories || !stories.length) { body.innerHTML = '<div class="tbw-loading">NO STORIES FOUND</div>'; return; }
        var top = stories.slice(0, 10);
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
      function onMove(e) {
        el.style.left = Math.max(0, ox + e.clientX - startX) + 'px';
        el.style.top  = Math.max(0, oy + e.clientY - startY) + 'px';
      }
      function onUp() {
        updateCfgPos(el.id);
        saveLayout();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
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
      el.style.zIndex = ++_zTop;
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
