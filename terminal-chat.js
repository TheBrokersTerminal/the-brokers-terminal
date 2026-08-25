/* ── BROKERS TERMINAL — CHAT + CALENDAR ENGINE ────────────────────
   Chat: Supabase Realtime firm-scoped messaging (DMs + broadcast)
   Calendar: monthly grid, personal events, economic calendar
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var FINNHUB_KEY = 'da6p77hr01qqqkkgl7b0da6p77hr01qqqkkgl7bg';

  /* ══════════════════════════════════════════════════════════════
     CHAT WIDGET
  ══════════════════════════════════════════════════════════════ */

  window.renderChatWidget = function (widgetId, body, sb, user) {
    /* user = {id, firmId, name} */
    body.style.padding = '0';
    body.style.overflow = 'hidden';
    body.style.display = 'flex';
    body.innerHTML = '<div class="tchat-wrap" id="' + widgetId + '-chat">' +
      '<div class="tchat-sidebar">' +
        '<div class="tchat-sidebar-hdr">CHANNELS</div>' +
        '<div id="' + widgetId + '-contacts"><div style="padding:10px;font-size:8px;color:#333;letter-spacing:.14em;">LOADING…</div></div>' +
      '</div>' +
      '<div class="tchat-main">' +
        '<div class="tchat-thread-hdr" id="' + widgetId + '-thread-hdr">SELECT A CHANNEL</div>' +
        '<div class="tchat-messages" id="' + widgetId + '-messages"><div class="tchat-empty">SELECT A CHANNEL OR CONTACT</div></div>' +
        '<div class="tchat-input-wrap">' +
          '<textarea class="tchat-input" id="' + widgetId + '-input" placeholder="Type a message…" rows="1"></textarea>' +
          '<button class="tchat-send" id="' + widgetId + '-send">↵</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    var state = {
      activeRecipient: null, /* null = broadcast */
      activeName: 'BROADCAST',
      messages: [],
      contacts: [],
      unread: {},
      realtimeSub: null,
    };

    /* ── Load contacts ── */
    loadContacts(sb, user.firmId, function (contacts) {
      state.contacts = contacts;
      renderContacts(widgetId, contacts, state, sb, user);
    });

    /* ── Subscribe to realtime ── */
    state.realtimeSub = sb.channel('firm-messages-' + user.firmId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: 'firm_id=eq.' + user.firmId,
      }, function (payload) {
        var msg = payload.new;
        var isForActive = (
          (state.activeRecipient === null && msg.recipient_id === null) ||
          (state.activeRecipient === msg.sender_id && msg.recipient_id === user.id) ||
          (state.activeRecipient === msg.recipient_id && msg.sender_id === user.id)
        );
        if (isForActive) {
          appendMessage(widgetId, msg, user.id, sb);
          scrollBottom(widgetId);
        } else if (msg.sender_id !== user.id) {
          /* unread badge */
          var key = msg.recipient_id ? msg.sender_id : 'broadcast';
          state.unread[key] = (state.unread[key] || 0) + 1;
          updateBadges(widgetId, state);
          /* widget title badge */
          var titleEl = document.getElementById(widgetId + '-title');
          if (titleEl && !titleEl.textContent.includes('●')) titleEl.textContent = '● FIRM CHAT';
        }
      })
      .subscribe();

    /* ── Send ── */
    var inputEl = document.getElementById(widgetId + '-input');
    var sendBtn = document.getElementById(widgetId + '-send');

    function doSend() {
      var text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sb.from('messages').insert({
        firm_id: user.firmId,
        sender_id: user.id,
        sender_name: user.name,
        recipient_id: state.activeRecipient,
        content: text,
      }).then(function (res) {
        if (res.error) return;
        /* optimistic render */
        var msg = {sender_id: user.id, sender_name: user.name, content: text, created_at: new Date().toISOString(), recipient_id: state.activeRecipient};
        appendMessage(widgetId, msg, user.id, sb);
        scrollBottom(widgetId);
      });
    }

    sendBtn.addEventListener('click', doSend);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    inputEl.addEventListener('input', function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
    });

    /* ── Select channel helper (exposed for contact clicks) ── */
    window['_chatSelect_' + widgetId] = function (recipientId, name, contacts) {
      state.activeRecipient = recipientId;
      state.activeName = name;
      var key = recipientId || 'broadcast';
      delete state.unread[key];
      updateBadges(widgetId, state);
      /* clear widget title badge */
      var total = Object.values(state.unread).reduce(function(a,b){return a+b;}, 0);
      var titleEl = document.getElementById(widgetId + '-title');
      if (titleEl && total === 0) titleEl.textContent = 'FIRM CHAT';
      document.getElementById(widgetId + '-thread-hdr').textContent = name;
      var msgEl = document.getElementById(widgetId + '-messages');
      msgEl.innerHTML = '<div class="tchat-empty">LOADING…</div>';
      loadMessages(sb, user.firmId, user.id, recipientId, function (msgs) {
        state.messages = msgs;
        renderMessages(widgetId, msgs, user.id, sb);
        scrollBottom(widgetId);
      });
      /* update active state on contacts */
      document.querySelectorAll('#' + widgetId + '-contacts .tchat-contact').forEach(function (el) {
        el.classList.remove('active');
      });
    };
  };

  function loadContacts(sb, firmId, cb) {
    sb.from('users').select('id, full_name, first_name, last_name').eq('firm_id', firmId)
      .then(function (res) {
        var contacts = (res.data || []).map(function (u) {
          return {id: u.id, name: (u.full_name || ((u.first_name||'') + ' ' + (u.last_name||''))).trim().toUpperCase() || 'UNKNOWN'};
        });
        cb(contacts);
      }).catch(function () { cb([]); });
  }

  function renderContacts(widgetId, contacts, state, sb, user) {
    var el = document.getElementById(widgetId + '-contacts');
    if (!el) return;
    var html = '<div class="tchat-contact tchat-broadcast" id="' + widgetId + '-c-broadcast" onclick="chatSelectContact(\'' + widgetId + '\',null,\'BROADCAST\')">' +
      '<div class="tchat-contact-name">BROADCAST</div>' +
      '<div class="tchat-contact-sub">ALL MEMBERS</div>' +
      '<span class="tchat-contact-badge" id="' + widgetId + '-badge-broadcast" style="display:none;"></span>' +
    '</div>';
    contacts.forEach(function (c) {
      if (c.id === user.id) return;
      html += '<div class="tchat-contact" id="' + widgetId + '-c-' + c.id + '" onclick="chatSelectContact(\'' + widgetId + '\',\'' + c.id + '\',\'' + escQ(c.name) + '\')">' +
        '<div class="tchat-contact-name">' + escH(c.name.split(' ')[0]) + '</div>' +
        '<div class="tchat-contact-sub">DM</div>' +
        '<span class="tchat-contact-badge" id="' + widgetId + '-badge-' + c.id + '" style="display:none;"></span>' +
      '</div>';
    });
    el.innerHTML = html;

    /* auto-select broadcast */
    chatSelectContact(widgetId, null, 'BROADCAST · ALL MEMBERS');
  }

  window.chatSelectContact = function (widgetId, recipientId, name) {
    var fn = window['_chatSelect_' + widgetId];
    if (fn) fn(recipientId, name);
    var activeId = recipientId || 'broadcast';
    document.querySelectorAll('#' + widgetId + '-contacts .tchat-contact').forEach(function (el) {
      el.classList.remove('active');
    });
    var activeEl = document.getElementById(widgetId + '-c-' + activeId);
    if (activeEl) activeEl.classList.add('active');
  };

  function updateBadges(widgetId, state) {
    Object.keys(state.unread).forEach(function (key) {
      var badgeEl = document.getElementById(widgetId + '-badge-' + key);
      if (!badgeEl) return;
      var count = state.unread[key] || 0;
      badgeEl.style.display = count ? 'flex' : 'none';
      badgeEl.textContent = count > 9 ? '9+' : count;
    });
  }

  function loadMessages(sb, firmId, userId, recipientId, cb) {
    var query = sb.from('messages').select('*').eq('firm_id', firmId).order('created_at', {ascending: true}).limit(80);
    if (recipientId === null) {
      query = query.is('recipient_id', null);
    } else {
      query = query.or('and(sender_id.eq.' + userId + ',recipient_id.eq.' + recipientId + '),and(sender_id.eq.' + recipientId + ',recipient_id.eq.' + userId + ')');
    }
    query.then(function (res) { cb(res.data || []); }).catch(function () { cb([]); });
  }

  function msgBubble(m, myId, sb) {
    var d = new Date(m.created_at);
    var mine = m.sender_id === myId;
    var div = document.createElement('div');
    div.className = 'tchat-msg';
    div.dataset.msgId = m.id;
    var deleteBtn = mine
      ? '<button class="tchat-msg-del" title="Delete message" onclick="window._chatDeleteMsg(\'' + m.id + '\',this)">✕</button>'
      : '';
    div.innerHTML =
      '<div class="tchat-msg-meta">' +
        '<span class="tchat-msg-name' + (mine ? ' mine' : '') + '">' + escH(m.sender_name || 'UNKNOWN') + '</span>' +
        '<span class="tchat-msg-time">' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</span>' +
        deleteBtn +
      '</div>' +
      '<div class="tchat-msg-body">' + escH(m.content) + '</div>';
    return div;
  }

  /* Global delete handler — called by inline onclick */
  window._chatDeleteMsg = function (msgId, btn) {
    if (!window._sbClient) return;
    if (!confirm('Delete this message?')) return;
    btn.disabled = true;
    window._sbClient.from('messages').delete().eq('id', msgId).eq('sender_id', window._uid)
      .then(function (res) {
        if (res.error) { btn.disabled = false; return; }
        var row = document.querySelector('.tchat-msg[data-msg-id="' + msgId + '"]');
        if (row) row.remove();
      });
  };

  function renderMessages(widgetId, msgs, myId, sb) {
    var el = document.getElementById(widgetId + '-messages');
    if (!el) return;
    if (!msgs.length) { el.innerHTML = '<div class="tchat-empty">NO MESSAGES YET — SAY HELLO</div>'; return; }
    el.innerHTML = '';
    var lastDate = '';
    msgs.forEach(function (m) {
      var d = new Date(m.created_at);
      var dateStr = d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
      if (dateStr !== lastDate) {
        var sep = document.createElement('div');
        sep.className = 'tchat-date-divider';
        sep.textContent = dateStr;
        el.appendChild(sep);
        lastDate = dateStr;
      }
      el.appendChild(msgBubble(m, myId, sb));
    });
  }

  function appendMessage(widgetId, msg, myId, sb) {
    var el = document.getElementById(widgetId + '-messages');
    if (!el) return;
    var empty = el.querySelector('.tchat-empty');
    if (empty) empty.remove();
    el.appendChild(msgBubble(msg, myId, sb));
  }

  function scrollBottom(widgetId) {
    var el = document.getElementById(widgetId + '-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  /* ══════════════════════════════════════════════════════════════
     CALENDAR WIDGET
  ══════════════════════════════════════════════════════════════ */

  window.renderCalendarWidget = function (widgetId, body, sb, userId) {
    body.style.padding = '0';
    body.style.overflow = 'hidden';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';

    var today    = new Date();
    var state    = { year: today.getFullYear(), month: today.getMonth(), selected: null, personalEvts: [], econEvts: [] };

    function rebuild() {
      renderCalendar(widgetId, body, state, sb, userId, today);
    }

    /* Load personal events */
    sb.from('calendar_events').select('*').eq('user_id', userId)
      .then(function (res) { state.personalEvts = res.data || []; rebuild(); })
      .catch(function () { rebuild(); });

    /* Load economic calendar from Finnhub */
    loadEconCalendar(function (evts) { state.econEvts = evts; rebuild(); });

    rebuild();
  };

  function loadEconCalendar(cb) {
    var from = new Date(); from.setDate(1);
    var to   = new Date(from.getFullYear(), from.getMonth() + 2, 0);
    var fmt  = function(d) { return d.toISOString().slice(0,10); };
    fetch('https://finnhub.io/api/v1/calendar/economic?from=' + fmt(from) + '&to=' + fmt(to) + '&token=' + FINNHUB_KEY)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { cb((d && d.economicCalendar) || []); })
      .catch(function () { cb([]); });
  }

  function renderCalendar(widgetId, body, state, sb, userId, today) {
    var year = state.year, month = state.month;
    var first = new Date(year, month, 1);
    var last  = new Date(year, month + 1, 0);
    var startDow = (first.getDay() + 6) % 7; /* Mon=0 */
    var monthName = first.toLocaleDateString('en-GB', {month:'long', year:'numeric'}).toUpperCase();

    /* Build event map */
    var evtMap = {};
    state.personalEvts.forEach(function (e) {
      var k = e.event_date.slice(0,10);
      evtMap[k] = evtMap[k] || [];
      evtMap[k].push({title: e.title, color: e.color || '#E97132', id: e.id, personal: true});
    });
    state.econEvts.forEach(function (e) {
      var k = e.time ? e.time.slice(0,10) : '';
      if (!k || k.slice(0,7) !== year + '-' + String(month+1).padStart(2,'0')) return;
      evtMap[k] = evtMap[k] || [];
      evtMap[k].push({title: e.event || e.name || 'Economic Event', color: '#48a0e8', econ: true});
    });

    var dows = ['M','T','W','T','F','S','S'].map(function(d){ return '<div class="tcal-dow">' + d + '</div>'; }).join('');

    /* Days grid */
    var days = '';
    var totalCells = Math.ceil((startDow + last.getDate()) / 7) * 7;
    for (var i = 0; i < totalCells; i++) {
      var dayNum = i - startDow + 1;
      var isOther = dayNum < 1 || dayNum > last.getDate();
      var dateStr = isOther ? '' : year + '-' + String(month+1).padStart(2,'0') + '-' + String(dayNum).padStart(2,'0');
      var isToday = !isOther && dayNum === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      var isSelected = state.selected && dateStr === state.selected;
      var evts = evtMap[dateStr] || [];
      var dots = evts.map(function(e){ return '<div class="tcal-dot" style="background:' + e.color + ';"></div>'; }).join('');
      days += '<div class="tcal-day' + (isOther?' other-month':'') + (isToday?' today':'') + (evts.length?' has-event':'') + (isSelected?' active':'') + '"' +
        (dateStr ? ' onclick="calDayClick(\'' + widgetId + '\',\'' + dateStr + '\')" style="cursor:pointer;"' : '') + '>' +
        '<div class="tcal-day-num">' + (isOther ? '' : dayNum) + '</div>' +
        (dots ? '<div class="tcal-dots">' + dots + '</div>' : '') +
      '</div>';
    }

    /* Event panel for selected day */
    var evtPanel = '';
    if (state.selected && evtMap[state.selected]) {
      var selEvts = evtMap[state.selected];
      evtPanel = '<div class="tcal-event-panel">' +
        '<div class="tcal-event-lbl">' + state.selected + '</div>' +
        selEvts.map(function(e){
          return '<div class="tcal-event-row">' +
            '<div class="tcal-dot tcal-event-dot" style="background:' + e.color + ';"></div>' +
            escH(e.title) +
            (e.personal ? ' <button onclick="calDeleteEvent(\'' + widgetId + '\',\'' + escQ(e.id||'') + '\')" style="background:none;border:1px solid #2a2a2a;color:#666;font-family:inherit;font-size:8px;letter-spacing:.12em;padding:2px 7px;cursor:pointer;margin-left:auto;transition:color .1s,border-color .1s;" onmouseover="this.style.color=\'#e05050\';this.style.borderColor=\'#e05050\';" onmouseout="this.style.color=\'#666\';this.style.borderColor=\'#2a2a2a\';">✕ DELETE</button>' : '') +
          '</div>';
        }).join('') +
        '<button class="tcal-add-btn" onclick="calShowAdd(\'' + widgetId + '\')">+ ADD REMINDER</button>' +
        '<div id="' + widgetId + '-add-form" style="display:none;">' +
          '<div class="tcal-add-form">' +
            '<input class="tcal-add-input" id="' + widgetId + '-add-input" placeholder="Reminder text…">' +
            '<button class="tcal-add-save" onclick="calSaveEvent(\'' + widgetId + '\')">SAVE</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    } else if (state.selected) {
      evtPanel = '<div class="tcal-event-panel">' +
        '<div class="tcal-event-lbl">' + state.selected + ' — NO EVENTS</div>' +
        '<button class="tcal-add-btn" onclick="calShowAdd(\'' + widgetId + '\')">+ ADD REMINDER</button>' +
        '<div id="' + widgetId + '-add-form" style="display:none;">' +
          '<div class="tcal-add-form">' +
            '<input class="tcal-add-input" id="' + widgetId + '-add-input" placeholder="Reminder text…">' +
            '<button class="tcal-add-save" onclick="calSaveEvent(\'' + widgetId + '\')">SAVE</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    body.innerHTML =
      '<div class="tcal-header">' +
        '<button class="tcal-nav" onclick="calNav(\'' + widgetId + '\',-1)">◀</button>' +
        '<div class="tcal-month">' + monthName + '</div>' +
        '<button class="tcal-nav" onclick="calNav(\'' + widgetId + '\',1)">▶</button>' +
      '</div>' +
      '<div class="tcal-grid" id="' + widgetId + '-cal-grid">' + dows + days + '</div>' +
      evtPanel;

    /* Store state on body for callbacks */
    body._calState = state;
    body._calSb    = sb;
    body._calUid   = userId;
  }

  /* ── Calendar callbacks (global for onclick) ── */
  window.calNav = function (widgetId, dir) {
    var body = document.getElementById(widgetId + '-body');
    if (!body || !body._calState) return;
    var s = body._calState;
    s.month += dir;
    if (s.month < 0)  { s.month = 11; s.year--; }
    if (s.month > 11) { s.month = 0;  s.year++; }
    s.selected = null;
    renderCalendar(widgetId, body, s, body._calSb, body._calUid, new Date());
  };

  window.calDayClick = function (widgetId, dateStr) {
    var body = document.getElementById(widgetId + '-body');
    if (!body || !body._calState) return;
    body._calState.selected = body._calState.selected === dateStr ? null : dateStr;
    renderCalendar(widgetId, body, body._calState, body._calSb, body._calUid, new Date());
  };

  window.calShowAdd = function (widgetId) {
    var form = document.getElementById(widgetId + '-add-form');
    if (form) form.style.display = 'block';
  };

  window.calSaveEvent = function (widgetId) {
    var body   = document.getElementById(widgetId + '-body');
    var input  = document.getElementById(widgetId + '-add-input');
    if (!body || !body._calState || !input || !input.value.trim()) return;
    var s = body._calState;
    body._calSb.from('calendar_events').insert({
      user_id: body._calUid,
      title: input.value.trim(),
      event_date: s.selected,
      color: '#E97132',
    }).then(function (res) {
      if (res.error) return;
      s.personalEvts.push({event_date: s.selected, title: input.value.trim(), color: '#E97132', id: (res.data && res.data[0]) ? res.data[0].id : null});
      renderCalendar(widgetId, body, s, body._calSb, body._calUid, new Date());
    });
  };

  window.calDeleteEvent = function (widgetId, evtId) {
    if (!evtId) return;
    var body = document.getElementById(widgetId + '-body');
    if (!body || !body._calState) return;
    var s = body._calState;
    body._calSb.from('calendar_events').delete().eq('id', evtId).then(function () {
      s.personalEvts = s.personalEvts.filter(function (e) { return e.id !== evtId; });
      renderCalendar(widgetId, body, s, body._calSb, body._calUid, new Date());
    });
  };

  /* ── Helpers ── */
  function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function escQ(s) { return String(s||'').replace(/'/g,"\\'"); }

})();
