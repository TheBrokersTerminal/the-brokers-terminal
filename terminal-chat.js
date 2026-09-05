/* ── BROKERS TERMINAL — CHAT + CALENDAR ENGINE ────────────────────
   Chat: Bloomberg-style messenger with directory, connect requests,
         user profiles (firm + position), and accept/decline flow
   Calendar: monthly grid, personal events, economic calendar
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var FINNHUB_KEY = 'da6p77hr01qqqkkgl7b0da6p77hr01qqqkkgl7bg';

  var AVATAR_COLORS = ['#4A90D9','#3DAA6A','#C9A84C','#E97132','#9B59B6','#1ABC9C','#c0392b','#2980B9'];
  /* per-widget contact lookup — avoids inline JSON in onclick attrs */
  var _contactMap = {};
  function avColor(name) { var c = (name||'U').charCodeAt(0); return AVATAR_COLORS[c % AVATAR_COLORS.length]; }
  function avLetter(name) { return ((name||'U')[0]).toUpperCase(); }
  function avHtml(name, size) {
    var sz = size || 28;
    return '<div class="tch-av" style="width:' + sz + 'px;height:' + sz + 'px;min-width:' + sz + 'px;font-size:' + Math.round(sz*0.39) + 'px;background:' + avColor(name) + ';">' + avLetter(name) + '</div>';
  }

  /* ── Inject chat widget styles once ── */
  function injectChatStyles() {
    if (document.getElementById('tbt-chat-v2-styles')) return;
    var s = document.createElement('style');
    s.id = 'tbt-chat-v2-styles';
    s.textContent = [
      '.tchat-wrap{display:flex;height:100%;min-height:0;overflow:hidden;}',
      '.tchat-sidebar{width:190px;min-width:150px;border-right:1px solid #1a1a1a;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;}',
      '.tchat-main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;}',
      /* tabs */
      '.tch-tabs{display:flex;border-bottom:1px solid #1a1a1a;flex-shrink:0;}',
      '.tch-tab{flex:1;padding:8px 0;text-align:center;font-size:7px;letter-spacing:.15em;color:rgba(255,255,255,.35);cursor:pointer;transition:color .15s;border-bottom:2px solid transparent;margin-bottom:-1px;position:relative;font-family:inherit;}',
      '.tch-tab.active{color:#fff;border-bottom-color:#E97132;}',
      '.tch-tab:hover{color:rgba(255,255,255,.7);}',
      '.tch-tab-badge{position:absolute;top:4px;right:8px;min-width:14px;height:14px;border-radius:7px;background:#D14040;color:#fff;font-size:6.5px;display:flex;align-items:center;justify-content:center;padding:0 3px;letter-spacing:0;}',
      /* sidebar scroll */
      '.tch-sidebar-body{flex:1;overflow-y:auto;overflow-x:hidden;}',
      '.tch-sidebar-body::-webkit-scrollbar{width:3px;}',
      '.tch-sidebar-body::-webkit-scrollbar-thumb{background:#222;border-radius:2px;}',
      /* section label */
      '.tch-section-lbl{padding:9px 10px 4px;font-size:6px;letter-spacing:.22em;color:rgba(255,255,255,.22);}',
      /* MSG tab contact card */
      '.tch-card{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;transition:background .12s;border-bottom:1px solid rgba(255,255,255,.03);position:relative;}',
      '.tch-card:hover{background:rgba(255,255,255,.04);}',
      '.tch-card.active{background:rgba(233,113,50,.09);border-right:2px solid #E97132;}',
      /* avatar */
      '.tch-av{border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;letter-spacing:0;color:#fff;flex-shrink:0;}',
      /* card text */
      '.tch-card-info{flex:1;min-width:0;}',
      '.tch-card-name{font-size:8.5px;font-weight:600;letter-spacing:.09em;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.tch-card-meta{font-size:7px;letter-spacing:.05em;color:rgba(255,255,255,.38);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;line-height:1.4;}',
      /* unread badge */
      '.tch-unread{min-width:16px;height:16px;border-radius:8px;background:#E97132;color:#fff;font-size:6.5px;display:flex;align-items:center;justify-content:center;padding:0 4px;letter-spacing:0;flex-shrink:0;}',
      /* directory card — richer */
      '.tch-dir-card{padding:11px 10px 10px;border-bottom:1px solid rgba(255,255,255,.04);cursor:default;}',
      '.tch-dir-card:hover{background:rgba(255,255,255,.03);}',
      '.tch-dir-header{display:flex;align-items:center;gap:9px;margin-bottom:6px;}',
      '.tch-dir-name{font-size:9px;font-weight:700;letter-spacing:.1em;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.tch-dir-position{font-size:7.5px;letter-spacing:.1em;color:#E97132;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.tch-dir-company{font-size:7px;letter-spacing:.07em;color:rgba(255,255,255,.42);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.tch-dir-actions{display:flex;gap:5px;margin-top:8px;}',
      /* buttons */
      '.tch-connect-btn{font-size:7px;letter-spacing:.1em;padding:3px 8px;border:1px solid rgba(255,255,255,.2);background:none;color:rgba(255,255,255,.6);cursor:pointer;font-family:inherit;transition:all .15s;}',
      '.tch-connect-btn:hover:not([disabled]){border-color:#E97132;color:#E97132;}',
      '.tch-connect-btn.connected{color:#3DAA6A;border-color:rgba(61,170,106,.35);cursor:default;}',
      '.tch-connect-btn.pending{color:rgba(255,255,255,.25);border-color:rgba(255,255,255,.1);cursor:default;}',
      '.tch-msg-btn{font-size:7px;letter-spacing:.1em;padding:3px 8px;border:1px solid rgba(61,170,106,.38);background:rgba(61,170,106,.06);color:#3DAA6A;cursor:pointer;font-family:inherit;transition:all .15s;}',
      '.tch-msg-btn:hover{background:rgba(61,170,106,.16);border-color:rgba(61,170,106,.6);}',
      /* accept / decline */
      '.tch-req-actions{display:flex;gap:5px;margin-top:6px;}',
      '.tch-accept-btn{font-size:7px;letter-spacing:.1em;padding:3px 8px;border:1px solid rgba(61,170,106,.5);background:rgba(61,170,106,.08);color:#3DAA6A;cursor:pointer;font-family:inherit;transition:all .15s;}',
      '.tch-accept-btn:hover{background:rgba(61,170,106,.2);}',
      '.tch-decline-btn{font-size:7px;letter-spacing:.1em;padding:3px 8px;border:1px solid rgba(209,64,64,.3);background:none;color:rgba(209,64,64,.65);cursor:pointer;font-family:inherit;transition:all .15s;}',
      '.tch-decline-btn:hover{color:#D14040;background:rgba(209,64,64,.08);}',
      /* directory search */
      '.tch-search-wrap{padding:8px 10px;border-bottom:1px solid #1a1a1a;flex-shrink:0;}',
      '.tch-search-input{width:100%;background:#111;border:1px solid #222;color:#fff;font-size:8px;font-family:inherit;letter-spacing:.07em;padding:5px 8px;outline:none;box-sizing:border-box;}',
      '.tch-search-input::placeholder{color:rgba(255,255,255,.2);}',
      '.tch-search-input:focus{border-color:#2e2e2e;}',
      /* thread header */
      '.tchat-thread-hdr{padding:7px 12px;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:9px;flex-shrink:0;min-height:36px;}',
      '.tch-hdr-info{min-width:0;}',
      '.tch-hdr-name{font-size:8.5px;letter-spacing:.14em;color:#fff;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.tch-hdr-sub{font-size:7px;letter-spacing:.08em;color:rgba(255,255,255,.38);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      /* messages area */
      '.tchat-messages{flex:1;overflow-y:auto;padding:8px 0 4px;min-height:0;}',
      '.tchat-messages::-webkit-scrollbar{width:3px;}',
      '.tchat-messages::-webkit-scrollbar-thumb{background:#1e1e1e;}',
      '.tchat-empty{padding:28px 16px;text-align:center;font-size:8px;letter-spacing:.14em;color:rgba(255,255,255,.16);}',
      /* date divider */
      '.tchat-date-divider{display:flex;align-items:center;gap:8px;padding:10px 14px 6px;}',
      '.tchat-date-divider::before,.tchat-date-divider::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.07);}',
      '.tchat-date-divider span{font-size:7px;letter-spacing:.18em;color:rgba(255,255,255,.2);white-space:nowrap;}',
      /* message ROW — bubble layout */
      '.tchat-msg-row{display:flex;align-items:flex-end;gap:7px;padding:2px 12px;}',
      '.tchat-msg-row.mine{flex-direction:row-reverse;}',
      '.tchat-msg-row.grouped{padding-top:1px;}',
      '.tch-av-spacer{width:26px;min-width:26px;flex-shrink:0;}',
      '.tchat-bubble-col{display:flex;flex-direction:column;max-width:73%;min-width:0;}',
      '.tchat-msg-row.mine .tchat-bubble-col{align-items:flex-end;}',
      /* sender name + time above bubble (first in group) */
      '.tchat-bubble-meta{display:flex;align-items:baseline;gap:6px;margin-bottom:3px;padding:0 2px;}',
      '.tchat-bubble-sender{font-size:7.5px;letter-spacing:.12em;color:#E97132;font-weight:700;}',
      '.tchat-bubble-time{font-size:6.5px;letter-spacing:.04em;color:rgba(255,255,255,.25);}',
      '.tchat-msg-row.mine .tchat-bubble-meta{justify-content:flex-end;}',
      '.tchat-msg-row.mine .tchat-bubble-sender{color:#4A90D9;}',
      /* bubble */
      '.tchat-bubble{background:#161616;border:1px solid #242424;color:rgba(255,255,255,.88);font-size:9px;letter-spacing:.04em;line-height:1.5;padding:6px 10px;word-break:break-word;position:relative;}',
      '.tchat-bubble.mine{background:#0f2640;border-color:#1a3a5c;color:#ddeeff;}',
      /* delete on hover */
      '.tchat-bubble-del{display:none;position:absolute;top:3px;right:4px;background:none;border:none;color:rgba(255,255,255,.25);cursor:pointer;font-size:8px;padding:0 1px;line-height:1;}',
      '.tchat-bubble:hover .tchat-bubble-del{display:block;}',
      '.tchat-bubble-del:hover{color:#D14040;}',
      /* locked */
      '.tch-locked{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;}',
      '.tch-locked-lbl{font-size:8px;letter-spacing:.14em;color:rgba(255,255,255,.22);text-align:center;padding:0 24px;line-height:1.7;}',
      /* input area */
      '.tchat-input-wrap{border-top:1px solid #1a1a1a;padding:8px;flex-shrink:0;display:flex;gap:0;}',
      '.tchat-input{flex:1;background:#0d0d0d;border:1px solid #222;border-right:none;color:#fff;font-family:inherit;font-size:9px;letter-spacing:.05em;padding:7px 10px;resize:none;outline:none;min-height:32px;max-height:80px;}',
      '.tchat-input:focus{border-color:#2a2a2a;}',
      '.tchat-send{background:#E97132;border:none;color:#fff;padding:0 14px;font-size:12px;cursor:pointer;transition:background .15s;flex-shrink:0;}',
      '.tchat-send:hover{background:#d0652a;}',
      /* flash animation */
      '@keyframes chatFlash{0%,100%{background:transparent}50%{background:rgba(233,113,50,.13)}}',
      '.tchat-flash{animation:chatFlash .4s ease;}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════════
     CHAT WIDGET
  ══════════════════════════════════════════════════════════════ */

  window.renderChatWidget = function (widgetId, body, sb, user) {
    injectChatStyles();

    body.style.padding = '0';
    body.style.overflow = 'hidden';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.minHeight = '0';

    body.innerHTML =
      '<div class="tchat-wrap" id="' + widgetId + '-chat">' +
        '<div class="tchat-sidebar">' +
          '<div class="tch-tabs">' +
            '<div class="tch-tab active" id="' + widgetId + '-tab-messages" onclick="chatTab(\'' + widgetId + '\',\'messages\')">MSG</div>' +
            '<div class="tch-tab" id="' + widgetId + '-tab-directory" onclick="chatTab(\'' + widgetId + '\',\'directory\')">DIR</div>' +
            '<div class="tch-tab" id="' + widgetId + '-tab-requests" onclick="chatTab(\'' + widgetId + '\',\'requests\')">' +
              'REQ<span class="tch-tab-badge" id="' + widgetId + '-req-badge" style="display:none;"></span>' +
            '</div>' +
          '</div>' +
          '<div class="tch-sidebar-body" id="' + widgetId + '-sidebar-body"></div>' +
        '</div>' +
        '<div class="tchat-main">' +
          '<div class="tchat-thread-hdr" id="' + widgetId + '-thread-hdr">' +
            '<div class="tch-hdr-info"><div class="tch-hdr-name">SELECT A CHANNEL</div></div>' +
          '</div>' +
          '<div class="tchat-messages" id="' + widgetId + '-messages"><div class="tchat-empty">SELECT A CHANNEL OR CONTACT</div></div>' +
          '<div class="tchat-input-wrap">' +
            '<textarea class="tchat-input" id="' + widgetId + '-input" placeholder="Type a message…" rows="1"></textarea>' +
            '<button class="tchat-send" id="' + widgetId + '-send">↵</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    window._uid = user.id;
    var state = {
      mode: 'messages',
      activeRecipient: null,
      activeName: 'BROADCAST',
      activeContact: null,
      messages: [],
      allUsers: [],
      connections: {},
      outgoingReqs: {},
      incomingReqs: [],
      unread: {},
      myProfile: null,
      realtimeSub: null,
      reqSub: null,
    };

    sb.from('users').select('firm_name, position').eq('id', user.id).single()
      .then(function (res) { if (res.data) state.myProfile = res.data; })
      .catch(function () {});

    function fullReload(cb) {
      Promise.all([
        sb.from('users').select('id, full_name, first_name, last_name, firm_name, position').then(function(r){ return r.data || []; }).catch(function(){ return []; }),
        sb.from('chat_requests').select('*').or('from_user.eq.' + user.id + ',to_user.eq.' + user.id).then(function(r){ return r.data || []; }).catch(function(){ return []; }),
      ]).then(function (results) {
        var users = results[0];
        var reqs  = results[1];

        state.allUsers = users.filter(function(u){ return u.id !== user.id; }).map(function(u){
          var contact = {
            id: u.id,
            name: (u.full_name || ((u.first_name||'') + ' ' + (u.last_name||''))).trim().toUpperCase() || 'UNKNOWN',
            firm_name: (u.firm_name || '').toUpperCase(),
            position: (u.position || '').toUpperCase(),
          };
          _contactMap[u.id] = contact;
          return contact;
        });

        state.connections = {};
        state.outgoingReqs = {};
        state.incomingReqs = [];
        reqs.forEach(function(r) {
          if (r.status === 'accepted') {
            var other = r.from_user === user.id ? r.to_user : r.from_user;
            state.connections[other] = true;
          } else if (r.status === 'pending') {
            if (r.from_user === user.id) {
              state.outgoingReqs[r.to_user] = true;
            } else {
              state.incomingReqs.push(r);
            }
          }
        });

        updateReqBadge(widgetId, state);
        renderSidebar(widgetId, state, sb, user);
        if (cb) cb();
      });
    }

    fullReload(function() {
      chatSelectContact(widgetId, null, 'BROADCAST · ALL MEMBERS', null);
    });

    /* ── Incoming message handler ── */
    var _seenIds = {};
    function handleIncoming(msg) {
      if (!msg || !msg.id) return;
      if (_seenIds[msg.id]) return;
      _seenIds[msg.id] = true;
      if (msg.firm_id !== user.firmId) return;
      var isForMe = msg.recipient_id === null || msg.recipient_id === user.id || msg.sender_id === user.id;
      if (!isForMe) return;
      var isForActive = (
        (state.activeRecipient === null && msg.recipient_id === null) ||
        (state.activeRecipient === msg.sender_id && msg.recipient_id === user.id) ||
        (state.activeRecipient === msg.recipient_id && msg.sender_id === user.id)
      );
      if (isForActive) {
        appendMessage(widgetId, msg, user.id, sb);
        scrollBottom(widgetId);
      }
      if (msg.sender_id !== user.id) {
        var key = msg.recipient_id ? msg.sender_id : 'broadcast';
        if (!isForActive) {
          state.unread[key] = (state.unread[key] || 0) + 1;
          updateBadges(widgetId, state);
        }
        var contactEl = document.getElementById(widgetId + '-c-' + key);
        if (contactEl) { contactEl.classList.remove('tchat-flash'); void contactEl.offsetWidth; contactEl.classList.add('tchat-flash'); }
        var titleEl = document.getElementById(widgetId + '-title');
        if (titleEl && !titleEl.textContent.includes('●')) titleEl.textContent = '● FIRM CHAT';
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && !document.hasFocus()) {
          new Notification(msg.sender_name || 'Someone', {
            body: (msg.content || '').slice(0, 100),
            icon: '/favicon.ico',
            tag: 'tbt-chat-' + (msg.recipient_id || 'broadcast'),
          });
        }
      }
    }

    state.realtimeSub = sb.channel('firm-messages-' + user.firmId)
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'messages'}, function(p){ handleIncoming(p.new); })
      .subscribe();

    try {
      state.reqSub = sb.channel('chat-requests-' + user.id)
        .on('postgres_changes', {event:'*', schema:'public', table:'chat_requests'}, function() { fullReload(); })
        .subscribe();
    } catch(e) {}

    var _pollSince = new Date().toISOString();
    var _pollTimer = setInterval(function () {
      if (!document.getElementById(widgetId + '-messages')) { clearInterval(_pollTimer); return; }
      sb.from('messages').select('*')
        .eq('firm_id', user.firmId)
        .gt('created_at', _pollSince)
        .order('created_at', {ascending:true})
        .then(function (res) {
          if (!res.data || !res.data.length) return;
          _pollSince = res.data[res.data.length-1].created_at;
          res.data.forEach(handleIncoming);
        });
    }, 4000);

    /* ── Send ── */
    var inputEl = document.getElementById(widgetId + '-input');
    var sendBtn = document.getElementById(widgetId + '-send');

    function doSend() {
      var text = (inputEl.value || '').trim();
      if (!text) return;
      if (state.activeRecipient && !state.connections[state.activeRecipient]) return;
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sb.from('messages').insert({
        firm_id: user.firmId,
        sender_id: user.id,
        sender_name: user.name,
        recipient_id: state.activeRecipient,
        content: text,
      }).select().then(function (res) {
        if (res.error) return;
        var msg = (res.data && res.data[0]) || {sender_id:user.id, sender_name:user.name, content:text, created_at:new Date().toISOString(), recipient_id:state.activeRecipient};
        if (msg.id) _seenIds[msg.id] = true;
        appendMessage(widgetId, msg, user.id, sb);
        scrollBottom(widgetId);
      });
    }

    sendBtn.addEventListener('click', doSend);
    inputEl.addEventListener('keydown', function(e){ if (e.key==='Enter' && !e.shiftKey){e.preventDefault();doSend();} });
    inputEl.addEventListener('input', function(){ inputEl.style.height='auto'; inputEl.style.height=Math.min(inputEl.scrollHeight,80)+'px'; });

    /* ── Select channel ── */
    window['_chatSelect_' + widgetId] = function (recipientId, name, contact) {
      state.activeRecipient = recipientId;
      state.activeName = name;
      state.activeContact = contact;
      var key = recipientId || 'broadcast';
      delete state.unread[key];
      updateBadges(widgetId, state);
      var total = Object.values(state.unread).reduce(function(a,b){return a+b;},0);
      var titleEl = document.getElementById(widgetId + '-title');
      if (titleEl && total===0) titleEl.textContent = 'FIRM CHAT';

      /* thread header */
      var hdr = document.getElementById(widgetId + '-thread-hdr');
      if (hdr) {
        if (contact) {
          var parts = [];
          if (contact.position)  parts.push(escH(contact.position));
          if (contact.firm_name) parts.push(escH(contact.firm_name));
          hdr.innerHTML =
            avHtml(contact.name, 26) +
            '<div class="tch-hdr-info">' +
              '<div class="tch-hdr-name">' + escH(name) + '</div>' +
              (parts.length ? '<div class="tch-hdr-sub">' + parts.join(' · ') + '</div>' : '') +
            '</div>';
        } else {
          hdr.innerHTML =
            '<div class="tch-av" style="width:26px;height:26px;min-width:26px;font-size:13px;background:#1a1a1a;">📡</div>' +
            '<div class="tch-hdr-info">' +
              '<div class="tch-hdr-name">BROADCAST</div>' +
              '<div class="tch-hdr-sub">ALL MEMBERS</div>' +
            '</div>';
        }
      }

      var msgEl = document.getElementById(widgetId + '-messages');
      msgEl.innerHTML = '<div class="tchat-empty">LOADING…</div>';

      if (recipientId && !state.connections[recipientId]) {
        msgEl.innerHTML = '<div class="tch-locked"><div class="tch-locked-lbl">CONNECT WITH THIS CONTACT TO START A DIRECT MESSAGE</div></div>';
        return;
      }

      loadMessages(sb, user.firmId, user.id, recipientId, function (msgs) {
        state.messages = msgs;
        renderMessages(widgetId, msgs, user.id, sb);
        scrollBottom(widgetId);
      });

      document.querySelectorAll('#' + widgetId + '-sidebar-body .tch-card').forEach(function(el){ el.classList.remove('active'); });
      var activeEl = document.getElementById(widgetId + '-c-' + key);
      if (activeEl) activeEl.classList.add('active');
    };
  };

  /* ── Tab switching ── */
  window.chatTab = function(widgetId, mode) {
    var w = document.getElementById(widgetId + '-chat');
    if (!w) return;
    var state = window['_chatState_' + widgetId];
    if (!state) return;
    state.mode = mode;
    ['messages','directory','requests'].forEach(function(m) {
      var t = document.getElementById(widgetId + '-tab-' + m);
      if (t) t.classList.toggle('active', m === mode);
    });
    var sb = window._sbClient;
    var user = window['_chatUser_' + widgetId];
    if (sb && user) renderSidebar(widgetId, state, sb, user);
  };

  function renderSidebar(widgetId, state, sb, user) {
    window['_chatState_' + widgetId] = state;
    window['_chatUser_' + widgetId]  = user;
    var el = document.getElementById(widgetId + '-sidebar-body');
    if (!el) return;
    if (state.mode === 'messages')  renderMessagesTab(widgetId, state, sb, user, el);
    if (state.mode === 'directory') renderDirectoryTab(widgetId, state, sb, user, el);
    if (state.mode === 'requests')  renderRequestsTab(widgetId, state, sb, user, el);
  }

  /* ── MSG tab ── */
  function renderMessagesTab(widgetId, state, sb, user, el) {
    var html = '';

    html += '<div class="tch-section-lbl">CHANNELS</div>';
    html += '<div class="tch-card" id="' + widgetId + '-c-broadcast" onclick="chatSelectContact(\'' + widgetId + '\',null,\'BROADCAST\',null)">' +
      '<div class="tch-av" style="width:28px;height:28px;min-width:28px;font-size:13px;background:#1a1a1a;">📡</div>' +
      '<div class="tch-card-info">' +
        '<div class="tch-card-name">BROADCAST</div>' +
        '<div class="tch-card-meta">ALL MEMBERS</div>' +
      '</div>' +
      '<span class="tch-unread" id="' + widgetId + '-badge-broadcast" style="display:none;"></span>' +
    '</div>';

    var connectedUsers = state.allUsers.filter(function(u){ return state.connections[u.id]; });
    if (connectedUsers.length) {
      html += '<div class="tch-section-lbl">DIRECT MESSAGES</div>';
      connectedUsers.forEach(function(c) {
        var metaParts = [];
        if (c.position)  metaParts.push(c.position);
        if (c.firm_name) metaParts.push(c.firm_name);
        html += '<div class="tch-card" id="' + widgetId + '-c-' + c.id + '" onclick="chatSelectContact(\'' + widgetId + '\',\'' + c.id + '\',\'' + escQ(c.name) + '\',_contactMap[\'' + c.id + '\'])">' +
          avHtml(c.name) +
          '<div class="tch-card-info">' +
            '<div class="tch-card-name">' + escH(c.name) + '</div>' +
            '<div class="tch-card-meta">' + escH(metaParts.join(' · ') || 'DIRECT MESSAGE') + '</div>' +
          '</div>' +
          '<span class="tch-unread" id="' + widgetId + '-badge-' + c.id + '" style="display:none;"></span>' +
        '</div>';
      });
    } else {
      html += '<div style="padding:14px 10px;font-size:7.5px;letter-spacing:.1em;color:rgba(255,255,255,.18);line-height:1.7;">CONNECT WITH COLLEAGUES IN THE DIRECTORY TO START DIRECT MESSAGES</div>';
    }

    el.innerHTML = html;
    updateBadges(widgetId, state);
    var activeKey = state.activeRecipient || 'broadcast';
    var activeEl = document.getElementById(widgetId + '-c-' + activeKey);
    if (activeEl) activeEl.classList.add('active');
  }

  /* ── DIR tab — rich cards ── */
  function renderDirectoryTab(widgetId, state, sb, user, el) {
    var searchId = widgetId + '-dir-search';
    el.innerHTML =
      '<div class="tch-search-wrap"><input class="tch-search-input" id="' + searchId + '" placeholder="SEARCH BY NAME, ROLE OR FIRM…" autocomplete="off"></div>' +
      '<div id="' + widgetId + '-dir-list"></div>';

    var searchEl = document.getElementById(searchId);
    var listEl   = document.getElementById(widgetId + '-dir-list');

    function renderList(filter) {
      var lower = (filter||'').toLowerCase();
      var users = state.allUsers.filter(function(u) {
        if (!lower) return true;
        return (u.name + ' ' + u.firm_name + ' ' + u.position).toLowerCase().indexOf(lower) !== -1;
      });

      if (!users.length) {
        listEl.innerHTML = '<div style="padding:18px 10px;font-size:7.5px;letter-spacing:.12em;color:rgba(255,255,255,.18);text-align:center;">NO RESULTS</div>';
        return;
      }

      var html = '';
      users.forEach(function(u) {
        var isConn = !!state.connections[u.id];
        var isPend = !!state.outgoingReqs[u.id];
        html += '<div class="tch-dir-card">' +
          '<div class="tch-dir-header">' +
            avHtml(u.name, 32) +
            '<div style="min-width:0;flex:1;">' +
              '<div class="tch-dir-name">' + escH(u.name) + '</div>' +
              (u.position  ? '<div class="tch-dir-position">' + escH(u.position) + '</div>' : '') +
              (u.firm_name ? '<div class="tch-dir-company">' + escH(u.firm_name) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="tch-dir-actions">';

        if (isConn) {
          html +=
            '<button class="tch-msg-btn" onclick="chatGoMsg(\'' + widgetId + '\',\'' + u.id + '\',\'' + escQ(u.name) + '\',_contactMap[\'' + u.id + '\'])">↗ MESSAGE</button>' +
            '<button class="tch-connect-btn connected" disabled>CONNECTED ✓</button>';
        } else if (isPend) {
          html += '<button class="tch-connect-btn pending" disabled>REQUEST SENT…</button>';
        } else {
          html += '<button class="tch-connect-btn" onclick="chatConnect(\'' + widgetId + '\',\'' + u.id + '\')">+ CONNECT</button>';
        }

        html += '</div></div>';
      });
      listEl.innerHTML = html;
    }

    renderList('');
    if (searchEl) {
      searchEl.addEventListener('input', function(){ renderList(searchEl.value); });
      searchEl.addEventListener('click', function(e){ e.stopPropagation(); });
    }
  }

  /* ── REQ tab ── */
  function renderRequestsTab(widgetId, state, sb, user, el) {
    var reqs = state.incomingReqs;
    var html = '';
    if (!reqs.length) {
      html = '<div style="padding:24px 10px;font-size:7.5px;letter-spacing:.12em;color:rgba(255,255,255,.18);text-align:center;">NO PENDING REQUESTS</div>';
    } else {
      html += '<div class="tch-section-lbl">PENDING (' + reqs.length + ')</div>';
      reqs.forEach(function(r) {
        var name = (r.from_name||'UNKNOWN').toUpperCase();
        var firm = (r.from_firm||'').toUpperCase();
        var pos  = (r.from_pos||'').toUpperCase();
        html += '<div class="tch-dir-card">' +
          '<div class="tch-dir-header">' +
            avHtml(name, 32) +
            '<div style="min-width:0;flex:1;">' +
              '<div class="tch-dir-name">' + escH(name) + '</div>' +
              (pos  ? '<div class="tch-dir-position">' + escH(pos) + '</div>' : '') +
              (firm ? '<div class="tch-dir-company">' + escH(firm) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="tch-req-actions">' +
            '<button class="tch-accept-btn" onclick="chatAccept(\'' + widgetId + '\',\'' + r.id + '\',\'' + r.from_user + '\')">ACCEPT</button>' +
            '<button class="tch-decline-btn" onclick="chatDecline(\'' + widgetId + '\',\'' + r.id + '\')">DECLINE</button>' +
          '</div>' +
        '</div>';
      });
    }
    el.innerHTML = html;
  }

  /* ── Global callbacks ── */

  window.chatSelectContact = function (widgetId, recipientId, name, contact) {
    var fn = window['_chatSelect_' + widgetId];
    if (fn) fn(recipientId, name, contact);
  };

  /* Go to MSG tab and open DM — called from DIR tab MESSAGE button */
  window.chatGoMsg = function (widgetId, userId, name, contact) {
    chatTab(widgetId, 'messages');
    setTimeout(function() {
      chatSelectContact(widgetId, userId, name, contact);
    }, 0);
  };

  window.chatConnect = function (widgetId, toUserId) {
    var state = window['_chatState_' + widgetId];
    var user  = window['_chatUser_' + widgetId];
    var sb    = window._sbClient;
    if (!state || !user || !sb) return;
    if (state.connections[toUserId] || state.outgoingReqs[toUserId]) return;
    var mp = state.myProfile || {};
    sb.from('chat_requests').insert({
      from_user: user.id,
      to_user:   toUserId,
      from_name: user.name,
      from_firm: mp.firm_name || null,
      from_pos:  mp.position  || null,
      status:    'pending',
    }).then(function(res) {
      if (res.error) return;
      state.outgoingReqs[toUserId] = true;
      var el = document.getElementById(widgetId + '-sidebar-body');
      if (el) renderDirectoryTab(widgetId, state, sb, user, el);
    });
  };

  window.chatAccept = function (widgetId, reqId, fromUserId) {
    var sb = window._sbClient;
    if (!sb) return;
    sb.from('chat_requests').update({status:'accepted'}).eq('id', reqId).then(function(res) {
      if (res.error) return;
      var state = window['_chatState_' + widgetId];
      var user  = window['_chatUser_' + widgetId];
      if (!state) return;
      state.connections[fromUserId] = true;
      state.incomingReqs = state.incomingReqs.filter(function(r){ return r.id !== reqId; });
      delete state.outgoingReqs[fromUserId];
      updateReqBadge(widgetId, state);
      var el = document.getElementById(widgetId + '-sidebar-body');
      if (el) renderRequestsTab(widgetId, state, sb, user, el);
    });
  };

  window.chatDecline = function (widgetId, reqId) {
    var sb = window._sbClient;
    if (!sb) return;
    sb.from('chat_requests').update({status:'declined'}).eq('id', reqId).then(function(res) {
      if (res.error) return;
      var state = window['_chatState_' + widgetId];
      var user  = window['_chatUser_' + widgetId];
      if (!state) return;
      state.incomingReqs = state.incomingReqs.filter(function(r){ return r.id !== reqId; });
      updateReqBadge(widgetId, state);
      var el = document.getElementById(widgetId + '-sidebar-body');
      if (el) renderRequestsTab(widgetId, state, sb, user, el);
    });
  };

  function updateReqBadge(widgetId, state) {
    var badge = document.getElementById(widgetId + '-req-badge');
    if (!badge) return;
    var count = state.incomingReqs.length;
    badge.style.display = count ? 'flex' : 'none';
    badge.textContent = count > 9 ? '9+' : count;
  }

  function updateBadges(widgetId, state) {
    Object.keys(state.unread).forEach(function (key) {
      var b = document.getElementById(widgetId + '-badge-' + key);
      if (!b) return;
      var n = state.unread[key] || 0;
      b.style.display = n ? 'flex' : 'none';
      b.textContent = n > 9 ? '9+' : n;
    });
  }

  function loadMessages(sb, firmId, userId, recipientId, cb) {
    var query = sb.from('messages').select('*').eq('firm_id', firmId).order('created_at', {ascending:true}).limit(80);
    if (recipientId === null) {
      query = query.is('recipient_id', null);
    } else {
      query = query.or('and(sender_id.eq.' + userId + ',recipient_id.eq.' + recipientId + '),and(sender_id.eq.' + recipientId + ',recipient_id.eq.' + userId + ')');
    }
    query.then(function(res){ cb(res.data||[]); }).catch(function(){ cb([]); });
  }

  /* ── Bubble message element ── */
  function msgBubble(m, myId, prevMsg) {
    var mine = m.sender_id === myId;
    var d = new Date(m.created_at);
    var timeStr = d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});

    /* Group if same sender within 4 minutes of previous */
    var grouped = prevMsg &&
      prevMsg.sender_id === m.sender_id &&
      (d - new Date(prevMsg.created_at)) < 4 * 60 * 1000;

    var row = document.createElement('div');
    row.className = 'tchat-msg-row' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '');
    row.dataset.msgId = m.id;

    var delBtn = mine
      ? '<button class="tchat-bubble-del" title="Delete" onclick="window._chatDeleteMsg(\'' + m.id + '\',this)">✕</button>'
      : '';

    var meta = !grouped
      ? '<div class="tchat-bubble-meta">' +
          (!mine ? '<span class="tchat-bubble-sender">' + escH(m.sender_name||'UNKNOWN') + '</span>' : '') +
          '<span class="tchat-bubble-time">' + timeStr + '</span>' +
        '</div>'
      : '';

    var avatarHtml = !mine
      ? (grouped ? '<div class="tch-av-spacer"></div>' : avHtml(m.sender_name||'?', 26))
      : '';

    row.innerHTML =
      avatarHtml +
      '<div class="tchat-bubble-col">' +
        meta +
        '<div class="tchat-bubble' + (mine ? ' mine' : '') + '">' +
          escH(m.content) +
          delBtn +
        '</div>' +
      '</div>';

    return row;
  }

  window._chatDeleteMsg = function (msgId, btn) {
    if (!window._sbClient) return;
    if (!confirm('Delete this message?')) return;
    btn.disabled = true;
    window._sbClient.from('messages').delete().eq('id', msgId).eq('sender_id', window._uid)
      .then(function(res) {
        if (res.error) { btn.disabled=false; return; }
        var row = document.querySelector('.tchat-msg-row[data-msg-id="' + msgId + '"]');
        if (row) row.remove();
      });
  };

  function renderMessages(widgetId, msgs, myId) {
    var el = document.getElementById(widgetId + '-messages');
    if (!el) return;
    if (!msgs.length) { el.innerHTML = '<div class="tchat-empty">NO MESSAGES YET — SAY HELLO</div>'; return; }
    el.innerHTML = '';
    var lastDate = '';
    var prevMsg = null;
    msgs.forEach(function(m) {
      var d = new Date(m.created_at);
      var dateStr = d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}).toUpperCase();
      if (dateStr !== lastDate) {
        var sep = document.createElement('div');
        sep.className = 'tchat-date-divider';
        sep.innerHTML = '<span>' + dateStr + '</span>';
        el.appendChild(sep);
        lastDate = dateStr;
        prevMsg = null; /* reset grouping on date break */
      }
      el.appendChild(msgBubble(m, myId, prevMsg));
      prevMsg = m;
    });
  }

  function appendMessage(widgetId, msg, myId) {
    var el = document.getElementById(widgetId + '-messages');
    if (!el) return;
    var empty = el.querySelector('.tchat-empty, .tch-locked');
    if (empty) empty.remove();
    /* Find prev msg for grouping */
    var rows = el.querySelectorAll('.tchat-msg-row');
    var prevMsg = null;
    if (rows.length) {
      var lastId = rows[rows.length-1].dataset.msgId;
      /* Approximate: check by sender, good enough */
      var lastSenderId = rows[rows.length-1].classList.contains('mine') ? myId : 'other';
      /* We pass null prev to skip grouping on append — simpler */
    }
    el.appendChild(msgBubble(msg, myId, null));
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

    sb.from('calendar_events').select('*').eq('user_id', userId)
      .then(function (res) { state.personalEvts = res.data || []; rebuild(); })
      .catch(function () { rebuild(); });

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
    var startDow = (first.getDay() + 6) % 7;
    var monthName = first.toLocaleDateString('en-GB', {month:'long', year:'numeric'}).toUpperCase();

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

    body._calState = state;
    body._calSb    = sb;
    body._calUid   = userId;
  }

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
    var body  = document.getElementById(widgetId + '-body');
    var input = document.getElementById(widgetId + '-add-input');
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
