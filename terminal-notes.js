/* ── TERMINAL NOTES ─────────────────────────────────────────────
   Note system: private or firm-shared, reply threads, send via chat.
   ─────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  function escH(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── NOTE MODAL ── */
  window.noteModalOpen = function (opts) {
    var existing = document.getElementById('tnote-modal-overlay');
    if (existing) existing.remove();

    var sb       = window._sbClient || null;
    var uid      = window._uid      || null;
    var firmId   = window._canonicalFirmId || null;
    var userName = window._userName || 'BROKER';

    var isPrivate = true; /* default: private */

    var overlay = document.createElement('div');
    overlay.id = 'tnote-modal-overlay';
    overlay.innerHTML =
      '<div class="tnote-modal">' +
        '<div class="tnote-modal-hdr">' +
          '<span class="tnote-modal-icon">✎</span>' +
          '<span class="tnote-modal-type">' + escH((opts.subjectType||'').toUpperCase()) + ' NOTE</span>' +
          '<button class="tnote-modal-close" id="tnote-modal-x">✕</button>' +
        '</div>' +
        '<div class="tnote-modal-subject">' + escH(opts.subjectTitle||'') + '</div>' +
        '<textarea class="tnote-modal-ta" id="tnote-ta" placeholder="Write your note…"></textarea>' +

        /* Privacy toggle */
        '<div class="tnote-privacy-row">' +
          '<button class="tnote-priv-btn active" id="tnote-priv-private">🔒 PRIVATE</button>' +
          '<button class="tnote-priv-btn" id="tnote-priv-firm">◎ SHARE WITH FIRM</button>' +
        '</div>' +

        /* Send-to-colleague — hidden by default (private mode) */
        '<div class="tnote-send-row" id="tnote-send-row" style="display:none;">' +
          '<span class="tnote-send-lbl">ALSO SEND TO:</span>' +
          '<select class="tnote-send-select" id="tnote-send-to"><option value="">Nobody (feed only)</option></select>' +
        '</div>' +

        '<div class="tnote-modal-footer">' +
          '<div class="tnote-modal-info" id="tnote-modal-info">Only you can see this note</div>' +
          '<button class="tnote-modal-save" id="tnote-save">SAVE NOTE</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.getElementById('tnote-modal-x').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    /* Pre-fill textarea with highlighted quote if provided */
    var ta = document.getElementById('tnote-ta');
    if (opts.subjectHighlight && ta) {
      ta.value = '"' + opts.subjectHighlight + '"\n\n';
    }
    ta.focus();

    /* Privacy toggle logic */
    var privBtn  = document.getElementById('tnote-priv-private');
    var firmBtn  = document.getElementById('tnote-priv-firm');
    var sendRow  = document.getElementById('tnote-send-row');
    var infoEl   = document.getElementById('tnote-modal-info');
    var saveBtn  = document.getElementById('tnote-save');

    privBtn.addEventListener('click', function () {
      isPrivate = true;
      privBtn.classList.add('active');
      firmBtn.classList.remove('active');
      sendRow.style.display = 'none';
      infoEl.textContent = 'Only you can see this note';
      saveBtn.textContent = 'SAVE NOTE';
    });
    firmBtn.addEventListener('click', function () {
      isPrivate = false;
      firmBtn.classList.add('active');
      privBtn.classList.remove('active');
      sendRow.style.display = 'flex';
      infoEl.textContent = 'All colleagues in your firm can view & reply';
      saveBtn.textContent = 'SAVE & SHARE';
    });

    /* Load firm contacts into the send-to dropdown */
    if (sb && firmId) {
      sb.from('users').select('id, full_name, first_name, last_name').eq('firm_id', firmId).neq('id', uid)
        .then(function (res) {
          var sel = document.getElementById('tnote-send-to');
          if (!sel) return;
          (res.data || []).forEach(function (u) {
            var name = u.full_name || (u.first_name + ' ' + u.last_name).trim() || u.id;
            var opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = name;
            sel.appendChild(opt);
          });
        });
    }

    saveBtn.addEventListener('click', function () {
      var text = document.getElementById('tnote-ta').value.trim();
      if (!text) { document.getElementById('tnote-ta').style.outline = '1px solid #e05050'; return; }
      var sendToId = !isPrivate ? ((document.getElementById('tnote-send-to') || {}).value || '') : '';
      saveBtn.textContent = 'SAVING…';
      saveBtn.disabled = true;

      if (!sb || !uid || !firmId) { saveBtn.textContent = 'NOT CONNECTED'; return; }

      console.log('[Notes] save — uid:', uid, 'firmId:', firmId, 'isPrivate:', isPrivate, 'sendToId:', sendToId);
      var thread = [{
        user_id:       uid,
        user_name:     userName,
        text:          text,
        ts:            new Date().toISOString(),
        story_content: opts.subjectContent || null,
        highlight:     opts.subjectHighlight || null,
      }];
      var _saveTimeout = setTimeout(function () {
        saveBtn.textContent = 'TIMED OUT — RETRY';
        saveBtn.disabled = false;
      }, 10000);

      Promise.resolve(
        sb.from('shared_notes').insert({
          firm_id:        firmId,
          creator_id:     uid,
          creator_name:   userName,
          subject_type:   opts.subjectType  || 'intel',
          subject_title:  opts.subjectTitle || '',
          subject_url:    opts.subjectUrl   || null,
          subject_ticker: opts.subjectTicker || null,
          is_private:     isPrivate,
          thread:         thread,
        })
      ).then(function (res) {
        clearTimeout(_saveTimeout);
        if (res && res.error) {
          console.error('Note save error:', res.error);
          saveBtn.textContent = 'ERR: ' + (res.error.code || res.error.message || 'unknown');
          saveBtn.disabled = false;
          return;
        }

        /* Optional DM */
        if (sendToId) {
          var chatMsg = '✎ NOTE — ' + (opts.subjectTitle || '') + '\n\n' + text;
          Promise.resolve(
            sb.from('messages').insert({
              firm_id: firmId, sender_id: uid, sender_name: userName,
              recipient_id: sendToId, content: chatMsg,
            })
          ).then(function () {}).catch(function () {});
        }

        overlay.remove();
        if (window._notesInboxRefreshAll) window._notesInboxRefreshAll();
        showNoteToast(opts.subjectTitle || 'Note', isPrivate);
      }).catch(function (err) {
        clearTimeout(_saveTimeout);
        console.error('Note save error (catch):', err);
        saveBtn.textContent = 'ERR: ' + (err && err.message ? err.message.slice(0, 40) : 'network');
        saveBtn.disabled = false;
      });
    });
  };

  /* ── ACTIONABLE TOAST ── */
  function showNoteToast(subject, isPrivate) {
    var existing = document.getElementById('tnote-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'tnote-toast';
    toast.style.cssText =
      'position:fixed;bottom:28px;right:28px;background:#0f0f0f;border:1px solid #E97132;border-top:2px solid #E97132;' +
      'color:#d0d0d0;font-family:Consolas,Menlo,monospace;font-size:10px;letter-spacing:.12em;' +
      'padding:14px 18px;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,.85);min-width:280px;';
    toast.innerHTML =
      '<div style="color:#E97132;font-size:9px;letter-spacing:.22em;margin-bottom:6px;">' +
        (isPrivate ? '🔒 PRIVATE NOTE SAVED' : '✓ NOTE SHARED WITH FIRM') +
      '</div>' +
      '<div style="color:#888;font-size:9px;margin-bottom:12px;">' + escH(subject.slice(0, 50)) + '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="tnote-toast-view" style="flex:1;background:#E97132;border:none;color:#000;font-family:Consolas,Menlo,monospace;font-size:9px;letter-spacing:.18em;padding:7px;cursor:pointer;">VIEW IN MY NOTES →</button>' +
        '<button id="tnote-toast-close" style="background:none;border:1px solid #2a2a2a;color:#555;font-family:Consolas,Menlo,monospace;font-size:9px;padding:7px 10px;cursor:pointer;">✕</button>' +
      '</div>';
    document.body.appendChild(toast);
    document.getElementById('tnote-toast-close').addEventListener('click', function () { toast.remove(); });
    document.getElementById('tnote-toast-view').addEventListener('click', function () {
      toast.remove();
      if (window.terminalOpenFirmNotes) window.terminalOpenFirmNotes();
    });
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 6000);
  }

  /* ── NOTES INBOX WIDGET ── */
  window.renderNotesInboxWidget = function (widgetId, body, sb, uid, firmId, userName) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.overflow = 'hidden';

    window._notesInboxRefreshAll = function () {
      document.querySelectorAll('[data-notes-body]').forEach(function (b) {
        if (b._notesLoad) b._notesLoad();
      });
    };
    body.dataset.notesBody = '1';

    var notes = [];
    var activeFilter = 'all'; /* 'all' | 'mine' | 'firm' */

    function loadNotes() {
      if (!sb || !firmId) { body.innerHTML = '<div class="tnote-inbox-empty">NO FIRM CONNECTED</div>'; return; }
      /* Fetch: own notes (private + shared) + firm shared notes */
      sb.from('shared_notes')
        .select('*')
        .eq('firm_id', firmId)
        .order('updated_at', {ascending: false})
        .limit(100)
        .then(function (res) {
          /* Client-side: filter out other people's private notes (RLS should also enforce this) */
          notes = (res.data || []).filter(function (n) {
            return !n.is_private || n.creator_id === uid;
          });
          renderList();
        });
    }
    body._notesLoad = loadNotes;

    /* Auto-refresh list every 5 s while widget is alive */
    var _refreshTimer = setInterval(function () {
      if (!document.body.contains(body)) { clearInterval(_refreshTimer); return; }
      if (body._inThreadView) return; /* don't clobber open thread */
      loadNotes();
    }, 5000);

    function renderList() {
      var filtered = notes.filter(function (n) {
        if (activeFilter === 'mine') return n.creator_id === uid;
        if (activeFilter === 'firm') return !n.is_private;
        return true;
      });

      body.innerHTML =
        /* Filter tabs */
        '<div class="tnote-filter-tabs">' +
          '<button class="tnote-filter-tab' + (activeFilter==='all'  ? ' active' : '') + '" data-f="all">ALL</button>' +
          '<button class="tnote-filter-tab' + (activeFilter==='mine' ? ' active' : '') + '" data-f="mine">MY NOTES</button>' +
          '<button class="tnote-filter-tab' + (activeFilter==='firm' ? ' active' : '') + '" data-f="firm">FIRM SHARED</button>' +
        '</div>' +
        (filtered.length
          ? '<div class="tnote-inbox-list" id="' + widgetId + '-list"></div>'
          : '<div class="tnote-inbox-empty">NO NOTES' +
            (activeFilter === 'all' ? '<br><span style="font-size:8px;color:#2a2a2a;display:block;margin-top:8px;line-height:1.8;">Open any intel search<br>and click ✎ ADD NOTE</span>' : '') +
            '</div>'
        );

      body.querySelectorAll('.tnote-filter-tab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeFilter = btn.dataset.f;
          renderList();
        });
      });

      if (!filtered.length) return;
      var list = document.getElementById(widgetId + '-list');
      list.innerHTML = filtered.map(function (n) {
        var first = n.thread && n.thread[0] ? n.thread[0] : {};
        var replyCount = n.thread ? n.thread.length - 1 : 0;
        var isMine = n.creator_id === uid;
        return '<div class="tnote-inbox-card" data-nid="' + escH(String(n.id)) + '">' +
          '<div class="tnote-inbox-card-hdr">' +
            '<span class="tnote-inbox-type">' + escH((n.subject_type||'').toUpperCase()) + '</span>' +
            (n.is_private ? '<span class="tnote-priv-badge">🔒 PRIVATE</span>' : '') +
            '<span class="tnote-inbox-from' + (isMine ? ' mine' : '') + '">' + escH(n.creator_name||'') + (isMine ? ' (you)' : '') + '</span>' +
          '</div>' +
          '<div class="tnote-inbox-subject">' + escH(n.subject_title||'') + '</div>' +
          '<div class="tnote-inbox-preview">' + escH((first.text||'').slice(0,90)) + ((first.text||'').length > 90 ? '…' : '') + '</div>' +
          '<div class="tnote-inbox-card-footer">' +
            (replyCount > 0 ? '<span class="tnote-inbox-replies">+ ' + replyCount + ' repl' + (replyCount===1?'y':'ies') + '</span>' : '<span></span>') +
            (isMine ? '<button class="tnote-delete-btn" data-nid="' + escH(String(n.id)) + '">✕ DELETE</button>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      list.querySelectorAll('.tnote-inbox-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.classList.contains('tnote-delete-btn')) return;
          var note = notes.find(function (n) { return String(n.id) === String(card.dataset.nid); });
          if (note) openNotePopout(note);
        });
      });

      list.querySelectorAll('.tnote-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!confirm('Delete this note?')) return;
          var nid = btn.dataset.nid;
          sb.from('shared_notes').delete().eq('id', nid).eq('creator_id', uid)
            .then(function (res) {
              if (!res.error) {
                notes = notes.filter(function (n) { return String(n.id) !== String(nid); });
                renderList();
              }
            });
        });
      });
    }

    function openNotePopout(note) {
      if (!window.createGenericPopout) {
        /* Fallback: open inline if popout unavailable */
        openThread(note);
        return;
      }
      var noteTitle = (note.subject_title || 'NOTE').slice(0, 40).toUpperCase();
      window.createGenericPopout(noteTitle, '✎', function (popBody) {
        /* Render the note thread inside the popout body */
        var subBody = document.createElement('div');
        subBody.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;height:100%;';
        popBody.appendChild(subBody);
        renderNoteThreadInEl(note, subBody);
      }, {w: 400, h: 500});
    }

    /* Render a note thread inside any container element (used by popout + inline) */
    function renderNoteThreadInEl(note, container) {
      var firstEntry = note.thread && note.thread[0] ? note.thread[0] : {};
      var storyContent = firstEntry.story_content || null;
      var highlight    = firstEntry.highlight    || null;

      container.innerHTML =
        '<div class="tnote-thread-subject" style="margin:0;border-radius:0;">' +
          (note.is_private ? '<span class="tnote-priv-badge">🔒 PRIVATE</span>  ' : '') +
          '<span class="tnote-inbox-type">' + escH((note.subject_type||'').toUpperCase()) + '</span>  ' +
          escH(note.subject_title||'') +
          (note.subject_url ? '  <a class="tnote-thread-link" href="' + escH(note.subject_url) + '" target="_blank" rel="noopener">↗</a>' : '') +
        '</div>' +

        (storyContent
          ? '<details class="tnote-story-panel">' +
              '<summary class="tnote-story-toggle">▸ VIEW FULL INTEL</summary>' +
              '<div class="tnote-story-body">' +
                (highlight ? '<div class="tnote-story-highlight">"' + escH(highlight) + '"</div>' : '') +
                '<div class="tnote-story-text">' + escH(storyContent) + '</div>' +
              '</div>' +
            '</details>'
          : '') +

        (!note.is_private || note.creator_id === uid
          ? '<div class="tnote-thread-send-chat" id="tpop-chat-send-' + note.id + '">' +
              '<span class="tnote-send-lbl">SEND TO:</span>' +
              '<select class="tnote-send-select" id="tpop-chat-contact-' + note.id + '"><option value="">Pick colleague…</option></select>' +
              '<button class="tnote-thread-send-btn" id="tpop-chat-btn-' + note.id + '">SEND VIA CHAT ↗</button>' +
            '</div>'
          : '') +

        '<div class="tnote-thread-msgs" id="tpop-thread-' + note.id + '" style="flex:1;min-height:0;overflow-y:auto;"></div>' +
        '<div class="tnote-thread-input-wrap">' +
          '<textarea class="tnote-thread-input" id="tpop-reply-' + note.id + '" placeholder="Add to this note…"></textarea>' +
          '<button class="tnote-thread-send" id="tpop-send-' + note.id + '">↵</button>' +
        '</div>';

      /* Load contacts */
      var chatContactSel = document.getElementById('tpop-chat-contact-' + note.id);
      if (sb && firmId && chatContactSel) {
        sb.from('users').select('id, full_name, first_name, last_name').eq('firm_id', firmId).neq('id', uid)
          .then(function (res) {
            (res.data || []).forEach(function (u) {
              var name = u.full_name || (u.first_name + ' ' + u.last_name).trim() || u.id;
              var opt = document.createElement('option');
              opt.value = u.id; opt.textContent = name;
              if (chatContactSel) chatContactSel.appendChild(opt);
            });
          });
      }

      /* SEND VIA CHAT */
      var chatBtn = document.getElementById('tpop-chat-btn-' + note.id);
      if (chatBtn) {
        chatBtn.addEventListener('click', function () {
          var sel = document.getElementById('tpop-chat-contact-' + note.id);
          var recipientId = sel ? sel.value : '';
          if (!recipientId) { if (sel) sel.style.outline = '1px solid #e05050'; return; }
          var firstText = note.thread && note.thread[0] ? note.thread[0].text : '';
          var msg = '✎ NOTE — ' + (note.subject_title || '') + '\n\n' + firstText;
          Promise.resolve(sb.from('messages').insert({
            firm_id: firmId, sender_id: uid, sender_name: userName,
            recipient_id: recipientId, content: msg,
          })).then(function (res) {
            if (res && !res.error) {
              chatBtn.textContent = '✓ SENT';
              chatBtn.style.color = '#44cc88';
              setTimeout(function () { chatBtn.textContent = 'SEND VIA CHAT ↗'; chatBtn.style.color = ''; }, 2000);
            }
          }).catch(function(){});
        });
      }

      renderThread(note.thread || [], 'tpop-thread-' + note.id, uid);

      function sendReplyPop() {
        var ta = document.getElementById('tpop-reply-' + note.id);
        var text = ta ? ta.value.trim() : '';
        if (!text) return;
        var entry = {user_id: uid, user_name: userName, text: text, ts: new Date().toISOString()};
        var newThread = (note.thread || []).concat([entry]);
        if (ta) ta.value = '';
        Promise.resolve(
          sb.from('shared_notes').update({thread: newThread, updated_at: new Date().toISOString()}).eq('id', note.id)
        ).then(function (res) {
          if (res && !res.error) {
            note.thread = newThread;
            renderThread(newThread, 'tpop-thread-' + note.id, uid);
            /* Notify participants */
            var seen = {};
            newThread.forEach(function (e) { if (e.user_id && e.user_id !== uid) seen[e.user_id] = true; });
            if (note.creator_id && note.creator_id !== uid) seen[note.creator_id] = true;
            var notifyMsg = '↩ REPLY — ' + (note.subject_title || 'Note') + '\n\n' + text;
            Object.keys(seen).forEach(function (rid) {
              Promise.resolve(sb.from('messages').insert({
                firm_id: firmId, sender_id: uid, sender_name: userName,
                recipient_id: rid, content: notifyMsg,
              })).then(function(){}).catch(function(){});
            });
          }
        }).catch(function(){});
      }

      var sendBtn = document.getElementById('tpop-send-' + note.id);
      var replyTa = document.getElementById('tpop-reply-' + note.id);
      if (sendBtn) sendBtn.addEventListener('click', sendReplyPop);
      if (replyTa) replyTa.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReplyPop(); }
      });
    }

    function openThread(note) {
      var firstEntry = note.thread && note.thread[0] ? note.thread[0] : {};
      var storyContent = firstEntry.story_content || null;
      var highlight    = firstEntry.highlight    || null;

      body.innerHTML =
        '<div class="tnote-thread-back" id="' + widgetId + '-back">← ALL NOTES</div>' +
        '<div class="tnote-thread-subject">' +
          (note.is_private ? '<span class="tnote-priv-badge">🔒 PRIVATE</span>  ' : '') +
          '<span class="tnote-inbox-type">' + escH((note.subject_type||'').toUpperCase()) + '</span>  ' +
          escH(note.subject_title||'') +
          (note.subject_url ? '  <a class="tnote-thread-link" href="' + escH(note.subject_url) + '" target="_blank" rel="noopener">↗</a>' : '') +
        '</div>' +

        /* Story content panel */
        (storyContent
          ? '<details class="tnote-story-panel">' +
              '<summary class="tnote-story-toggle">▸ VIEW FULL INTEL</summary>' +
              '<div class="tnote-story-body">' +
                (highlight ? '<div class="tnote-story-highlight">"' + escH(highlight) + '"</div>' : '') +
                '<div class="tnote-story-text">' + escH(storyContent) + '</div>' +
              '</div>' +
            '</details>'
          : '') +

        /* Send via chat — only if note is shared or user is creator */
        (!note.is_private || note.creator_id === uid
          ? '<div class="tnote-thread-send-chat" id="' + widgetId + '-chat-send-row">' +
              '<span class="tnote-send-lbl">SEND TO:</span>' +
              '<select class="tnote-send-select" id="' + widgetId + '-chat-contact"><option value="">Pick colleague…</option></select>' +
              '<button class="tnote-thread-send-btn" id="' + widgetId + '-chat-btn">SEND VIA CHAT ↗</button>' +
            '</div>'
          : '') +
        '<div class="tnote-thread-msgs" id="' + widgetId + '-thread"></div>' +
        '<div class="tnote-thread-input-wrap">' +
          '<textarea class="tnote-thread-input" id="' + widgetId + '-reply" placeholder="Add to this note…"></textarea>' +
          '<button class="tnote-thread-send" id="' + widgetId + '-send">↵</button>' +
        '</div>';

      document.getElementById(widgetId + '-back').addEventListener('click', function () { loadNotes(); });
      renderThread(note.thread || []);

      /* Load contacts */
      var chatContactSel = document.getElementById(widgetId + '-chat-contact');
      if (sb && firmId && chatContactSel) {
        sb.from('users').select('id, full_name, first_name, last_name').eq('firm_id', firmId).neq('id', uid)
          .then(function (res) {
            (res.data || []).forEach(function (u) {
              var name = u.full_name || (u.first_name + ' ' + u.last_name).trim() || u.id;
              var opt = document.createElement('option');
              opt.value = u.id; opt.textContent = name;
              chatContactSel.appendChild(opt);
            });
          });
      }

      var chatBtn = document.getElementById(widgetId + '-chat-btn');
      if (chatBtn) {
        chatBtn.addEventListener('click', function () {
          var sel = document.getElementById(widgetId + '-chat-contact');
          var recipientId = sel ? sel.value : '';
          if (!recipientId) { if (sel) sel.style.outline = '1px solid #e05050'; return; }
          var firstText = note.thread && note.thread[0] ? note.thread[0].text : '';
          var msg = '✎ NOTE — ' + (note.subject_title || '') + '\n\n' + firstText;
          Promise.resolve(
            sb.from('messages').insert({
              firm_id: firmId, sender_id: uid, sender_name: userName,
              recipient_id: recipientId, content: msg,
            })
          ).then(function (res) {
            if (res && !res.error) {
              chatBtn.textContent = '✓ SENT';
              chatBtn.style.color = '#44cc88';
              setTimeout(function () { chatBtn.textContent = 'SEND VIA CHAT ↗'; chatBtn.style.color = ''; }, 2000);
            }
          });
        });
      }

      function sendReply() {
        var ta = document.getElementById(widgetId + '-reply');
        var text = ta ? ta.value.trim() : '';
        if (!text) return;
        var entry = {user_id: uid, user_name: userName, text: text, ts: new Date().toISOString()};
        var newThread = (note.thread || []).concat([entry]);
        ta.value = '';
        Promise.resolve(
          sb.from('shared_notes').update({thread: newThread, updated_at: new Date().toISOString()})
            .eq('id', note.id)
        ).then(function (res) {
          if (res && !res.error) {
            note.thread = newThread;
            renderThread(newThread);

            /* Notify all other participants via DM */
            var seen = {};
            (newThread || []).forEach(function (e) { if (e.user_id && e.user_id !== uid) seen[e.user_id] = true; });
            if (note.creator_id && note.creator_id !== uid) seen[note.creator_id] = true;
            var notifyMsg = '↩ REPLY — ' + (note.subject_title || 'Note') + '\n\n' + text;
            Object.keys(seen).forEach(function (recipientId) {
              Promise.resolve(
                sb.from('messages').insert({
                  firm_id: firmId, sender_id: uid, sender_name: userName,
                  recipient_id: recipientId, content: notifyMsg,
                })
              ).then(function(){}).catch(function(){});
            });
          }
        }).catch(function(){});
      }

      document.getElementById(widgetId + '-send').addEventListener('click', sendReply);
      document.getElementById(widgetId + '-reply').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
      });
    }

    function renderThread(thread, elId, meId) {
      var el = document.getElementById(elId || (widgetId + '-thread'));
      var myId = meId || uid;
      if (!el) return;
      el.innerHTML = thread.map(function (entry) {
        var isMe = entry.user_id === myId;
        var d = new Date(entry.ts);
        var time = d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) + ' ' +
                   d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
        return '<div class="tnote-thread-msg">' +
          '<div class="tnote-thread-msg-meta">' +
            '<span class="tnote-thread-msg-name' + (isMe ? ' mine' : '') + '">' + escH(entry.user_name||'') + '</span>' +
            '<span class="tnote-thread-msg-time">' + escH(time) + '</span>' +
          '</div>' +
          '<div class="tnote-thread-msg-body">' + escH(entry.text||'') + '</div>' +
        '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    }

    loadNotes();
  };

})();
