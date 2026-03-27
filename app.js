/* ============================================================
   ALAMIN NOTICES — app.js
   ============================================================ */

/* ── CONFIG ─────────────────────────────────────────────────── */
const SUPABASE_URL  = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY_HERE';
const ADMIN_EMAIL   = 'text.me.md.alamin@gmail.com';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ── STATE ───────────────────────────────────────────────────── */
let currentUser    = null;
let isAdmin        = false;
let displayName    = 'User';
let allNotices     = [];
let reactedMap     = JSON.parse(localStorage.getItem('reacted') || '{}');
// reactedMap[noticeId] = Set of emojis user reacted with
// stored as { noticeId: ['❤️','🔥'] }

let configuredEmojis = JSON.parse(localStorage.getItem('emojis') || '["❤️","🔥","👏","😮"]');
let editingNoticeId  = null;
let searchActive     = false;
let authInitialized  = false;

/* ── INIT: CHECK EXISTING SESSION (PERSIST LOGIN) ───────────── */
(async function checkExistingSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    isAdmin = currentUser.email === ADMIN_EMAIL;
    await loadProfile();
    showApp();
  } else {
    showScreen('auth-screen');
  }
})();

/* ── AUTH STATE LISTENER ─────────────────────────────────────── */
sb.auth.onAuthStateChange(async (_e, session) => {
  if (authInitialized) return;
  if (session?.user) {
    authInitialized = true;
    currentUser = session.user;
    isAdmin = currentUser.email === ADMIN_EMAIL;
    await loadProfile();
    showApp();
  } else if (!authInitialized) {
    showScreen('auth-screen');
  }
});

/* ── SCREENS ─────────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showApp() {
  showScreen('app-screen');
  document.getElementById('user-av').textContent    = displayName.charAt(0).toUpperCase();
  document.getElementById('user-name').textContent  = displayName;
  if (isAdmin) {
    document.getElementById('fab').classList.add('visible');
    document.getElementById('btn-dashboard').style.display = 'flex';
  }
  loadFeed();
  checkDeepLink();
}

/* ── PROFILE ─────────────────────────────────────────────────── */
async function loadProfile() {
  const { data } = await sb.from('profiles').select('display_name').eq('id', currentUser.id).single();
  if (data) displayName = data.display_name;
  else {
    // Create default profile
    const name = currentUser.email.split('@')[0];
    await sb.from('profiles').insert({ id: currentUser.id, display_name: name });
    displayName = name;
  }
}

/* ── AUTH ────────────────────────────────────────────────────── */
function switchTab(tab) {
  ['login','signup'].forEach(t => {
    document.getElementById(`${t}-form`).style.display = t === tab ? '' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  clearMsg('auth-msg');
}

async function handleLogin() {
  const email = v('login-email'), password = v('login-password');
  if (!email || !password) return showMsg('auth-msg', 'Please fill all fields.', 'error');
  setBtn('btn-login', 'Signing in…', true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  setBtn('btn-login', 'Sign In →', false);
  if (error) showMsg('auth-msg', error.message, 'error');
}

async function handleSignup() {
  const email = v('signup-email'), password = v('signup-password'), name = v('signup-name');
  if (!email || !password || !name) return showMsg('auth-msg', 'Please fill all fields.', 'error');
  if (password.length < 6) return showMsg('auth-msg', 'Password must be at least 6 characters.', 'error');
  setBtn('btn-signup', 'Creating…', true);
  const { data, error } = await sb.auth.signUp({ email, password });
  setBtn('btn-signup', 'Create Account →', false);
  if (error) return showMsg('auth-msg', error.message, 'error');
  // Save display name right after signup
  if (data.user) {
    await sb.from('profiles').upsert({ id: data.user.id, display_name: name });
  }
  showMsg('auth-msg', '✓ Account created! You can now sign in.', 'success');
}

async function handleLogout() {
  await sb.auth.signOut();
  authInitialized = false;
  currentUser = null;
  isAdmin = false;
  showScreen('auth-screen');
}

/* ── FEED ────────────────────────────────────────────────────── */
async function loadFeed(query = null) {
  const feed = document.getElementById('feed');
  feed.innerHTML = '<div class="spinner"></div>';
  searchActive = !!query;

  let req = sb.from('notices').select('*').order('is_pinned', { ascending: false }).order('created_at', { ascending: false });

  if (query) {
    // Full-text search across all notices (including expired)
    req = sb.from('notices')
      .select('*')
      .textSearch('content', query, { type: 'websearch' })
      .order('created_at', { ascending: false });
  }

  const { data, error } = await req;
  if (error) { feed.innerHTML = `<p style="color:var(--danger);text-align:center;padding:40px">${error.message}</p>`; return; }

  allNotices = data || [];

  // Load profiles for all authors in one query
  const authorIds = [...new Set(allNotices.map(n => n.author_id).filter(Boolean))];
  let profileMap = {};
  if (authorIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id,display_name').in('id', authorIds);
    (profiles || []).forEach(p => { profileMap[p.id] = p.display_name; });
  }

  // Load view counts if admin
  let viewMap = {};
  if (isAdmin && allNotices.length) {
    const ids = allNotices.map(n => n.id);
    const { data: views } = await sb.from('notice_views').select('notice_id').in('notice_id', ids);
    (views || []).forEach(v => { viewMap[v.notice_id] = (viewMap[v.notice_id] || 0) + 1; });
  }

  const activeCount = allNotices.filter(n => !isExpired(n) && isPublished(n)).length;
  document.getElementById('notice-count').textContent =
    query ? `${allNotices.length} result${allNotices.length !== 1 ? 's' : ''} for "${query}"`
    : activeCount === 0 ? 'No notices yet'
    : `${activeCount} active notice${activeCount !== 1 ? 's' : ''}`;

  // Search banner
  const banner = document.getElementById('search-banner');
  if (query) {
    banner.style.display = 'flex';
    document.getElementById('search-result-text').textContent = `Showing all results for "${query}"`;
  } else {
    banner.style.display = 'none';
  }

  if (!allNotices.length) {
    feed.innerHTML = `<div class="empty-state"><div class="e-icon">📋</div><h4>${query ? 'No results found' : 'No Notices Yet'}</h4><p>${query ? 'Try different keywords.' : 'Announcements will appear here.'}</p></div>`;
    return;
  }

  feed.innerHTML = '';
  let delay = 0;
  for (const notice of allNotices) {
    const authorName = profileMap[notice.author_id] || 'Admin';
    const views = viewMap[notice.id] || 0;
    const card  = buildCard(notice, authorName, views);
    card.style.animationDelay = `${delay}ms`;
    delay += 40;
    feed.appendChild(card);
    // Record view (non-blocking)
    if (currentUser && !isExpired(notice) && isPublished(notice)) {
      recordView(notice.id);
    }
  }
}

function isExpired(n)   { return n.expires_at && new Date(n.expires_at) < new Date(); }
function isPublished(n) { return !n.publish_at || new Date(n.publish_at) <= new Date(); }

async function recordView(noticeId) {
  await sb.from('notice_views').upsert(
    { notice_id: noticeId, user_id: currentUser.id },
    { onConflict: 'notice_id,user_id', ignoreDuplicates: true }
  );
}

/* ── CARD BUILDER ────────────────────────────────────────────── */
function buildCard(notice, authorName, views = 0) {
  const card = document.createElement('div');
  card.className = 'notice-card' +
    (notice.is_pinned ? ' pinned' : '') +
    (isExpired(notice) ? ' expired-card' : '');
  card.id = `card-${notice.id}`;

  const expired   = isExpired(notice);
  const scheduled = !isPublished(notice);
  let badge = '';
  if (notice.is_pinned && !expired)  badge = '<div class="pin-badge">📌 Pinned</div>';
  if (expired)                        badge = '<div class="expired-badge">Archived</div>';
  if (scheduled)                      badge = `<div class="scheduled-badge">⏰ Scheduled</div>`;

  const imgHTML = notice.image_url
    ? `<img class="card-img" src="${esc(notice.image_url)}" alt="Notice image" loading="lazy" />`
    : '';

  // Reactions
  const reactions = notice.reactions || {};
  const userReacted = reactedMap[notice.id] ? new Set(reactedMap[notice.id]) : new Set();
  const reactHTML = configuredEmojis.map(emoji => {
    const count = reactions[emoji] || 0;
    const active = userReacted.has(emoji) ? 'reacted' : '';
    return `<button class="reaction-btn ${active}" onclick="toggleReaction('${notice.id}','${emoji}',this)">${emoji} <span class="r-count">${count || ''}</span></button>`;
  }).join('');

  // Admin stats
  const statsHTML = isAdmin
    ? `<div class="admin-stats">
        <div class="stat-pill">👁 <span>${views}</span> views</div>
        ${notice.is_pinned
          ? `<button class="btn-action" onclick="togglePin('${notice.id}',false)">📌 Unpin</button>`
          : `<button class="btn-action" onclick="togglePin('${notice.id}',true)">📌 Pin</button>`}
        <button class="btn-action" onclick="openEdit('${notice.id}')">✏️ Edit</button>
        <button class="btn-action danger" onclick="deleteNotice('${notice.id}')">✕ Delete</button>
       </div>`
    : '';

  card.innerHTML = `
    ${badge}
    <div class="card-meta">
      <div class="card-author">
        <div class="card-av">${authorName.charAt(0).toUpperCase()}</div>
        <span class="card-author-name">${esc(authorName)}</span>
      </div>
      <span class="card-time">${formatTime(notice.created_at)}</span>
    </div>
    <div class="card-body">${esc(notice.content)}</div>
    ${imgHTML}
    <div class="reactions-row">${reactHTML}</div>
    ${statsHTML}
    <div class="card-actions">
      <button class="btn-action comments-toggle" onclick="toggleComments('${notice.id}',this)">💬 Comments</button>
      <button class="btn-action" onclick="shareNotice('${notice.id}')">↗ Share</button>
    </div>
    <div class="comments-section" id="comments-${notice.id}"></div>`;

  return card;
}

/* ── REACTIONS ───────────────────────────────────────────────── */
async function toggleReaction(noticeId, emoji, btn) {
  const userReacted = reactedMap[noticeId] ? new Set(reactedMap[noticeId]) : new Set();
  const notice      = allNotices.find(n => n.id === noticeId);
  if (!notice) return;

  const reactions = { ...(notice.reactions || {}) };
  const wasActive = userReacted.has(emoji);

  if (wasActive) {
    userReacted.delete(emoji);
    reactions[emoji] = Math.max(0, (reactions[emoji] || 1) - 1);
    btn.classList.remove('reacted');
  } else {
    userReacted.add(emoji);
    reactions[emoji] = (reactions[emoji] || 0) + 1;
    btn.classList.add('reacted');
  }

  const countEl = btn.querySelector('.r-count');
  countEl.textContent = reactions[emoji] || '';

  // Persist locally
  reactedMap[noticeId] = [...userReacted];
  localStorage.setItem('reacted', JSON.stringify(reactedMap));

  // Update DB
  notice.reactions = reactions;
  await sb.from('notices').update({ reactions }).eq('id', noticeId);
}

/* ── PIN ─────────────────────────────────────────────────────── */
async function togglePin(noticeId, pin) {
  await sb.from('notices').update({ is_pinned: pin }).eq('id', noticeId);
  showToast(pin ? 'Notice pinned!' : 'Notice unpinned.');
  loadFeed();
}

/* ── COMMENTS ────────────────────────────────────────────────── */
async function toggleComments(noticeId, btn) {
  const section = document.getElementById(`comments-${noticeId}`);
  const isOpen  = section.classList.contains('open');

  if (isOpen) {
    section.classList.remove('open');
    btn.classList.remove('open');
    return;
  }

  btn.classList.add('open');
  section.classList.add('open');
  section.innerHTML = '<div class="spinner" style="width:24px;height:24px;margin:16px auto;border-width:2px;"></div>';
  await renderComments(noticeId, section);
}

async function renderComments(noticeId, container) {
  const { data: comments, error } = await sb
    .from('comments')
    .select('*')
    .eq('notice_id', noticeId)
    .is('parent_id', null)
    .order('created_at', { ascending: true });

  if (error) { container.innerHTML = `<p style="color:var(--danger);font-size:13px;">${error.message}</p>`; return; }

  // Load all replies
  const topIds = (comments || []).map(c => c.id);
  let replies = [];
  if (topIds.length) {
    const { data: r } = await sb.from('comments').select('*').in('parent_id', topIds).order('created_at', { ascending: true });
    replies = r || [];
  }

  // Load profiles
  const allIds  = [...(comments || []), ...replies].map(c => c.author_id).filter(Boolean);
  const uids    = [...new Set(allIds)];
  let pMap = {};
  if (uids.length) {
    const { data: ps } = await sb.from('profiles').select('id,display_name').in('id', uids);
    (ps || []).forEach(p => { pMap[p.id] = p.display_name; });
  }

  container.innerHTML = '';

  if (!comments || !comments.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-soft);margin-bottom:12px;">No comments yet.</p>';
  } else {
    comments.forEach(c => {
      container.appendChild(buildComment(c, pMap[c.author_id] || 'User', false, noticeId));
      replies.filter(r => r.parent_id === c.id).forEach(r => {
        container.appendChild(buildComment(r, pMap[r.author_id] || 'User', true, noticeId));
      });
    });
  }

  // Add comment input
  const row = document.createElement('div');
  row.className = 'comment-input-row';
  row.innerHTML = `
    <input type="text" placeholder="Write a comment…" id="cinput-${noticeId}" onkeydown="if(event.key==='Enter')submitComment('${noticeId}',null)" />
    <button class="btn-send" onclick="submitComment('${noticeId}',null)">Send</button>`;
  container.appendChild(row);
}

function buildComment(c, name, isReply, noticeId) {
  const div = document.createElement('div');
  div.className = `comment-item${isReply ? ' reply' : ''}`;
  div.id = `comment-${c.id}`;
  const canDelete = isAdmin || c.author_id === currentUser?.id;

  div.innerHTML = `
    <div class="c-av">${name.charAt(0).toUpperCase()}</div>
    <div class="c-bubble">
      <div class="c-meta">
        <span class="c-name">${esc(name)}</span>
        <span class="c-time">${formatTime(c.created_at)}</span>
      </div>
      <div class="c-text">${esc(c.content)}</div>
      <div class="c-actions">
        ${!isReply ? `<button class="c-btn" onclick="showReplyBox('${c.id}','${noticeId}')">↩ Reply</button>` : ''}
        ${canDelete ? `<button class="c-btn" onclick="deleteComment('${c.id}','${noticeId}')">✕ Delete</button>` : ''}
      </div>
      <div id="reply-box-${c.id}"></div>
    </div>`;
  return div;
}

function showReplyBox(commentId, noticeId) {
  const box = document.getElementById(`reply-box-${commentId}`);
  if (box.innerHTML) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="comment-input-row reply-row" style="margin-left:0;margin-top:8px;">
      <input type="text" placeholder="Write a reply…" id="rinput-${commentId}" onkeydown="if(event.key==='Enter')submitComment('${noticeId}','${commentId}')" />
      <button class="btn-send" onclick="submitComment('${noticeId}','${commentId}')">Send</button>
    </div>`;
  document.getElementById(`rinput-${commentId}`)?.focus();
}

async function submitComment(noticeId, parentId) {
  const inputId = parentId ? `rinput-${parentId}` : `cinput-${noticeId}`;
  const input   = document.getElementById(inputId);
  const content = input?.value.trim();
  if (!content) return;

  input.value = '';
  const { error } = await sb.from('comments').insert({
    notice_id: noticeId,
    parent_id: parentId || null,
    author_id: currentUser.id,
    content
  });

  if (error) { showToast('Could not post comment.'); return; }

  const section = document.getElementById(`comments-${noticeId}`);
  await renderComments(noticeId, section);
  showToast('Comment posted!');
}

async function deleteComment(commentId, noticeId) {
  await sb.from('comments').delete().eq('id', commentId);
  document.getElementById(`comment-${commentId}`)?.remove();
  showToast('Comment deleted.');
}

/* ── DELETE NOTICE ───────────────────────────────────────────── */
async function deleteNotice(id) {
  if (!confirm('Delete this notice permanently?')) return;
  await sb.from('notices').delete().eq('id', id);
  document.getElementById(`card-${id}`)?.remove();
  allNotices = allNotices.filter(n => n.id !== id);
  showToast('Notice deleted.');
}

/* ── SHARE / DEEP LINK ───────────────────────────────────────── */
function shareNotice(id) {
  const url = `${location.origin}${location.pathname}?id=${id}`;
  navigator.clipboard.writeText(url).then(() => showToast('Link copied!'));
}

function checkDeepLink() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  setTimeout(() => {
    const el = document.getElementById(`card-${id}`);
    if (el) { el.classList.add('highlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }, 700);
}

/* ── POST MODAL ──────────────────────────────────────────────── */
function openPost() {
  editingNoticeId = null;
  document.getElementById('sheet-title-text').innerHTML = 'New <em>Notice</em>';
  document.getElementById('btn-publish').textContent     = 'Publish Notice';
  document.getElementById('post-content').value          = '';
  document.getElementById('post-image').value            = '';
  document.getElementById('img-preview').classList.remove('show');
  document.getElementById('upload-zone').style.display  = '';
  document.getElementById('post-schedule').value         = '';
  clearMsg('post-error');
  renderEmojiConfig();
  document.getElementById('post-modal').classList.add('open');
  document.getElementById('post-content').focus();
}

function openEdit(id) {
  const notice = allNotices.find(n => n.id === id);
  if (!notice) return;
  editingNoticeId = id;
  document.getElementById('sheet-title-text').innerHTML  = 'Edit <em>Notice</em>';
  document.getElementById('btn-publish').textContent      = 'Save Changes';
  document.getElementById('post-content').value           = notice.content || '';
  document.getElementById('post-schedule').value          = '';
  document.getElementById('img-preview').classList.remove('show');
  document.getElementById('upload-zone').style.display   = '';
  clearMsg('post-error');
  renderEmojiConfig();
  document.getElementById('post-modal').classList.add('open');
}

function closePost() {
  document.getElementById('post-modal').classList.remove('open');
}

function handleOverlayClick(e, modalId) {
  if (e.target.id === modalId) document.getElementById(modalId).classList.remove('open');
}

function previewImage(e) {
  const file = e.target.files[0]; if (!file) return;
  const prev = document.getElementById('img-preview');
  prev.src   = URL.createObjectURL(file);
  prev.classList.add('show');
  document.getElementById('upload-zone').style.display = 'none';
}

async function handlePublish() {
  const content  = v('post-content');
  const fileEl   = document.getElementById('post-image');
  const file     = fileEl.files[0];
  const schedStr = v('post-schedule');

  if (!content && !file) return showMsg('post-error', 'Write something or attach an image.', 'error');

  const btn = document.getElementById('btn-publish');
  setBtn('btn-publish', 'Publishing…', true);

  try {
    let image_url = editingNoticeId ? (allNotices.find(n => n.id === editingNoticeId)?.image_url || null) : null;

    if (file) {
      // Compress image before upload
      const compressed = await compressImage(file, 1200, 0.82);
      const ext   = file.name.split('.').pop();
      const fname = `${Date.now()}.${ext}`;
      const { error: upErr } = await sb.storage.from('notice-images').upload(fname, compressed, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const { data: urlData } = sb.storage.from('notice-images').getPublicUrl(fname);
      image_url = urlData.publicUrl;
    }

    const publish_at = schedStr ? new Date(schedStr).toISOString() : new Date().toISOString();
    const expires_at = new Date(new Date(publish_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const reactions  = buildEmptyReactions();

    if (editingNoticeId) {
      const { error } = await sb.from('notices').update({ content, image_url }).eq('id', editingNoticeId);
      if (error) throw error;
      showToast('Notice updated!');
    } else {
      const { error } = await sb.from('notices').insert([{
        content, image_url,
        author_id: currentUser.id,
        author_email: currentUser.email,
        publish_at, expires_at,
        is_pinned: false,
        reactions
      }]);
      if (error) throw error;
      showToast('Notice published!');
    }

    closePost();
    loadFeed();
  } catch (err) {
    showMsg('post-error', err.message || 'Something went wrong.', 'error');
    setBtn('btn-publish', editingNoticeId ? 'Save Changes' : 'Publish Notice', false);
  }
}

/* ── IMAGE COMPRESSION ───────────────────────────────────────── */
function compressImage(file, maxPx, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
          else                { width  = Math.round(width  * maxPx / height); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob || file), file.type || 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── EMOJI CONFIG (admin) ────────────────────────────────────── */
function renderEmojiConfig() {
  const wrap = document.getElementById('emoji-tags');
  wrap.innerHTML = '';
  configuredEmojis.forEach(emoji => {
    const tag = document.createElement('div');
    tag.className = 'emoji-tag';
    tag.innerHTML = `<span>${emoji}</span><button onclick="removeEmoji('${emoji}')">×</button>`;
    wrap.appendChild(tag);
  });
}

function addEmoji() {
  const val = document.getElementById('new-emoji').value.trim();
  if (!val || configuredEmojis.includes(val)) return;
  configuredEmojis.push(val);
  localStorage.setItem('emojis', JSON.stringify(configuredEmojis));
  document.getElementById('new-emoji').value = '';
  renderEmojiConfig();
}

function removeEmoji(emoji) {
  configuredEmojis = configuredEmojis.filter(e => e !== emoji);
  localStorage.setItem('emojis', JSON.stringify(configuredEmojis));
  renderEmojiConfig();
}

function buildEmptyReactions() {
  const r = {};
  configuredEmojis.forEach(e => { r[e] = 0; });
  return r;
}

/* ── SEARCH ──────────────────────────────────────────────────── */
let searchTimer;
function handleSearch(e) {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => {
    if (q.length >= 2) loadFeed(q);
    else if (searchActive) loadFeed();
  }, 400);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  loadFeed();
}

/* ── SETTINGS MODAL ──────────────────────────────────────────── */
function openSettings() {
  document.getElementById('settings-name').value = displayName;
  document.getElementById('settings-modal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
}

async function saveSettings() {
  const name = document.getElementById('settings-name').value.trim();
  if (!name) return showMsg('settings-msg', 'Name cannot be empty.', 'error');
  setBtn('btn-save-settings', 'Saving…', true);
  const { error } = await sb.from('profiles').upsert({ id: currentUser.id, display_name: name });
  setBtn('btn-save-settings', 'Save Changes', false);
  if (error) return showMsg('settings-msg', error.message, 'error');
  displayName = name;
  document.getElementById('user-av').textContent   = name.charAt(0).toUpperCase();
  document.getElementById('user-name').textContent = name;
  closeSettings();
  showToast('Display name updated!');
  loadFeed();
}

/* ── ADMIN DASHBOARD ─────────────────────────────────────────── */
async function openDashboard() {
  document.getElementById('dash-modal').classList.add('open');
  document.getElementById('dash-content').innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';

  // Total notices
  const { count: total } = await sb.from('notices').select('*', { count: 'exact', head: true });
  const { count: active } = await sb.from('notices').select('*', { count: 'exact', head: true })
    .gt('expires_at', new Date().toISOString());
  const { count: totalViews } = await sb.from('notice_views').select('*', { count: 'exact', head: true });

  // Per-notice view counts
  const { data: notices } = await sb.from('notices').select('id, content, created_at').order('created_at', { ascending: false }).limit(20);
  const ids = (notices || []).map(n => n.id);
  let viewMap = {};
  if (ids.length) {
    const { data: views } = await sb.from('notice_views').select('notice_id').in('notice_id', ids);
    (views || []).forEach(v => { viewMap[v.notice_id] = (viewMap[v.notice_id] || 0) + 1; });
  }

  const rows = (notices || []).map(n => `
    <tr>
      <td>${esc(n.content.substring(0, 60))}${n.content.length > 60 ? '…' : ''}</td>
      <td>${formatTime(n.created_at)}</td>
      <td class="views-cell">${viewMap[n.id] || 0}</td>
     </tr>`).join('');

  document.getElementById('dash-content').innerHTML = `
    <div class="dash-grid">
      <div class="dash-tile"><div class="dt-val">${total || 0}</div><div class="dt-label">Total Notices</div></div>
      <div class="dash-tile"><div class="dt-val">${active || 0}</div><div class="dt-label">Active Notices</div></div>
      <div class="dash-tile"><div class="dt-val">${totalViews || 0}</div><div class="dt-label">Total Views</div></div>
    </div>
    <table class="dash-table">
      <thead><tr><th>Notice</th><th>Posted</th><th>Views</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" style="color:var(--text-soft)">No notices yet.</td></tr>'}</tbody>
    </table>`;
}

function closeDashboard() {
  document.getElementById('dash-modal').classList.remove('open');
}

/* ── UTILS ───────────────────────────────────────────────────── */
function v(id)  { return document.getElementById(id)?.value?.trim() || ''; }
function esc(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `msg-box ${type}`;
  el.style.display = 'block';
}

function clearMsg(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function setBtn(id, text, disabled) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.textContent = text;
  btn.disabled    = disabled;
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function formatTime(iso) {
  const d = new Date(iso), now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
  }
});
