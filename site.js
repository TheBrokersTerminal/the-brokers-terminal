/* THE BROKERS TERMINAL — SITE JS */

// Capture affiliate referral code from ?ref= on any page and persist it
(function () {
  var ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) localStorage.setItem('referralCode', ref.toUpperCase().trim());
}());

(function () {
  'use strict';

  /* ── Active nav link ─────────────────────────────────────── */
  function setActiveNav() {
    var page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href === page || (page === '' && href === 'index.html')) {
        a.classList.add('active');
      }
    });
  }

  /* ── Submit button state ─────────────────────────────────── */
  function bindSubmitButtons() {
    document.querySelectorAll('.btn-submit').forEach(function (btn) {
      var form = btn.closest('form');
      if (!form) return;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var orig = btn.textContent;
        btn.textContent = 'TRANSMITTING...';
        btn.disabled = true;
        setTimeout(function () {
          btn.textContent = orig;
          btn.disabled = false;
        }, 1500);
      });
    });
  }

  /* ── Checkbox tile passthrough ───────────────────────────── */
  function bindCheckboxTiles() {
    document.querySelectorAll('.checkbox-label').forEach(function (label) {
      label.addEventListener('click', function () {
        var cb = label.querySelector('input[type="checkbox"]');
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
      });
    });
  }

  /* ── Dashboard filter tabs ───────────────────────────────── */
  function bindFilterTabs() {
    var tabs = document.querySelectorAll('.filter-tab');
    var cards = document.querySelectorAll('.doc-card');
    if (!tabs.length) return;

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');

        var filter = tab.getAttribute('data-filter');
        var visible = 0;
        cards.forEach(function (card) {
          var type = card.getAttribute('data-type') || '';
          var show = filter === 'all' || type === filter;
          card.style.display = show ? '' : 'none';
          if (show) visible++;
        });

        // Show/hide empty state
        var empty = document.getElementById('empty-state');
        if (empty) empty.style.display = visible === 0 ? '' : 'none';
      });
    });
  }

  /* ── Admin password gate ─────────────────────────────────── */
  function adminGate() {
    var gate = document.getElementById('admin-gate');
    var panel = document.getElementById('admin-panel-content');
    if (!gate || !panel) return;

    var form = gate.querySelector('form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = form.querySelector('input[type="password"]').value;
      // Demo password — in production this is checked server-side
      if (pw === 'terminal2026') {
        gate.style.display = 'none';
        panel.style.display = '';
      } else {
        var err = gate.querySelector('.form-error');
        if (err) { err.textContent = 'INCORRECT PASSWORD'; err.classList.add('visible'); }
      }
    });
  }

  /* ── Admin upload form ───────────────────────────────────── */
  function bindAdminUpload() {
    var form = document.getElementById('upload-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var orig = btn.textContent;
      btn.textContent = 'UPLOADING...';
      btn.disabled = true;
      setTimeout(function () {
        btn.textContent = orig;
        btn.disabled = false;
        // Show confirmation
        var conf = document.getElementById('upload-confirm');
        if (conf) { conf.style.display = 'block'; setTimeout(function () { conf.style.display = 'none'; }, 3000); }
        form.reset();
      }, 1500);
    });
  }

  /* ── Service Worker registration ────────────────────────── */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      // New version available — soft notification (no intrusive prompt)
      reg.addEventListener('updatefound', function () {
        var newWorker = reg.installing;
        newWorker.addEventListener('statechange', function () {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showBanner('UPDATE AVAILABLE — reload to get the latest version.', 'info');
          }
        });
      });
    }).catch(function () { /* sw registration failed — no problem, site still works */ });
  }

  /* ── Offline / online indicator ──────────────────────────── */
  function bindOfflineIndicator() {
    var banner = document.getElementById('offline-banner');
    if (!banner) return;

    function update() {
      if (!navigator.onLine) {
        banner.textContent = '█ OFFLINE MODE — Cached documents are still accessible below.';
        banner.style.display = 'block';
        banner.classList.add('offline');
        banner.classList.remove('online');
      } else if (banner.classList.contains('offline')) {
        // Just came back online
        banner.textContent = '█ CONNECTION RESTORED';
        banner.classList.add('online');
        banner.classList.remove('offline');
        setTimeout(function () { banner.style.display = 'none'; }, 3000);
      }
    }

    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    update(); // run once on page load
  }

  function showBanner(msg, type) {
    var banner = document.getElementById('offline-banner');
    if (!banner) return;
    banner.textContent = '█ ' + msg;
    banner.style.display = 'block';
    banner.className = 'offline-banner ' + (type || 'info');
  }

  /* ── Pre-cache HTML report when its DOWNLOAD button is clicked ── */
  function bindReportCaching() {
    document.querySelectorAll('.doc-card .btn-sm').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var href = btn.getAttribute('href');
        if (!href || href === '#') return;
        // Ask SW to cache this file now (fire-and-forget)
        if ('caches' in window && (href.endsWith('.html') || href.endsWith('.pdf'))) {
          caches.open('tbt-v1-reports').then(function (cache) {
            cache.add(href).catch(function () { /* ignore if offline */ });
          });
        }
      });
    });
  }

  /* ── Init ────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    setActiveNav();
    bindSubmitButtons();
    bindCheckboxTiles();
    bindFilterTabs();
    adminGate();
    bindAdminUpload();
    registerServiceWorker();
    bindOfflineIndicator();
    bindReportCaching();
  });
}());
