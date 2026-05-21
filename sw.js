/* ═══════════════════════════════════════════════════════════════
   THE BROKERS TERMINAL — SERVICE WORKER
   Strategy:
   · SHELL (css / js / site pages) — cache-first, update in background
   · HTML REPORTS — cached on first fetch, served offline forever after
   · Everything else — network with cache fallback
   ═══════════════════════════════════════════════════════════════ */

var CACHE_VERSION  = 'tbt-v1';
var SHELL_CACHE    = CACHE_VERSION + '-shell';
var REPORTS_CACHE  = CACHE_VERSION + '-reports';

/* Core site files cached immediately on SW install */
var SHELL_ASSETS = [
  '/',
  '/index.html',
  '/pricing.html',
  '/download.html',
  '/login.html',
  '/signup.html',
  '/dashboard.html',
  '/success.html',
  '/admin.html',
  '/site.css',
  '/site.js'
];

/* ── INSTALL ──────────────────────────────────────────────────── */
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL_ASSETS);
    }).then(function () {
      return self.skipWaiting(); /* activate immediately */
    })
  );
});

/* ── ACTIVATE ─────────────────────────────────────────────────── */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) {
          /* delete caches from old versions */
          return k.startsWith('tbt-') && k !== SHELL_CACHE && k !== REPORTS_CACHE;
        }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim(); /* take control of open tabs */
    })
  );
});

/* ── FETCH ────────────────────────────────────────────────────── */
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);

  /* Only handle GETs */
  if (e.request.method !== 'GET') return;

  var path = url.pathname;
  var isSupabaseReport = url.hostname.includes('supabase.co') && url.pathname.includes('/reports/');

  /* ── HTML reports → cache-first (permanent offline access) ── */
  if (isSupabaseReport || (url.origin === location.origin && isReport(path))) {
    e.respondWith(reportStrategy(e.request));
    return;
  }

  /* Only handle same-origin for remaining requests */
  if (url.origin !== location.origin) return;

  /* ── Shell assets (css / js / html pages) → stale-while-revalidate */
  if (isShell(path)) {
    e.respondWith(staleWhileRevalidate(e.request, SHELL_CACHE));
    return;
  }

  /* ── Everything else → network, fall back to cache ────────── */
  e.respondWith(networkWithCacheFallback(e.request));
});

/* ─────────────────────────────────────────────────────────────── */

function isReport(path) {
  return (
    path.endsWith('.html') && (
      path.toLowerCase().includes('weekly') ||
      path.toLowerCase().includes('monthly') ||
      path.toLowerCase().includes('quarterly') ||
      path.toLowerCase().includes('brokers weekly') ||
      path.toLowerCase().includes('report')
    )
  ) || path.endsWith('.pdf');
}

function isShell(path) {
  return (
    path === '/' ||
    path.endsWith('.html') ||
    path.endsWith('.css')  ||
    path.endsWith('.js')
  );
}

/* Cache-first; if missing, fetch → cache → return */
function reportStrategy(request) {
  return caches.open(REPORTS_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () {
        return offlinePage();
      });
    });
  });
}

/* Serve from cache immediately; refresh cache in background */
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var networkFetch = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () { return cached; });

      return cached || networkFetch;
    });
  });
}

/* Try network; fall back to cache */
function networkWithCacheFallback(request) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(function () {
      return cache.match(request).then(function (cached) {
        return cached || offlinePage();
      });
    });
  });
}

/* Minimal offline fallback returned when nothing is cached */
function offlinePage() {
  var body = [
    '<!DOCTYPE html><html lang="en-GB"><head>',
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>THE BROKERS TERMINAL — OFFLINE</title>',
    '<style>',
    'body{margin:0;background:#0A0A0A;color:#C8C0B0;font-family:Consolas,monospace;',
    'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}',
    '.box{max-width:480px;padding:40px;}',
    '.icon{font-size:32px;color:#E97132;margin-bottom:20px;}',
    '.title{font-size:14px;letter-spacing:.2em;color:#E97132;margin-bottom:16px;}',
    '.body{font-size:12px;line-height:1.8;letter-spacing:.06em;color:#9A9080;}',
    '</style></head><body>',
    '<div class="box">',
    '<div class="icon">█</div>',
    '<div class="title">NO CONNECTION</div>',
    '<p class="body">You are offline. Previously viewed reports and pages are still accessible — ',
    'return to your desk and open a cached document.</p>',
    '</div></body></html>'
  ].join('');

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
