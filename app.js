/* ================================================================
   ALAMIN NOTICES — app.js
   ================================================================ */
const SUPABASE_URL  = 'https://stczzndroorzorquszxn.supabase.co';
const SUPABASE_ANON = 'sb_publishable_7_58bmgqais4Y_EJtlO2Nw_bLgs2uUq';
const ADMIN_EMAIL   = 'text.me.md.alamin@gmail.com';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null, isAdmin = false, displayName = 'User';
let allNotices = [], profileCache = {}, searchActive = false, editingId = null;

const urlParams  = new URLSearchParams(location.search);
const deepLinkId = urlParams.get('id');

sb.auth.onAuthStateChange(async (_e, session) => {
  if (session?.user) {
    currentUser = session.user;
    isAdmin = currentUser.email === ADMIN_EMAIL;
    await ensureProfile();
    if (deepLinkId) showSingleNotice(deepLinkId);
    else bootApp();
  } else {
    currentUser = null; isAdmin = false;
    showScreen('auth-screen');
  }
});

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function bootApp() {
  showScreen('app-screen');
  document.getElementById('user-av-txt').textContent   = displayName.charAt(0).toUpperCase();
  document.getElementById('user-name-txt').textContent = displayName;
  const dash = document.getElementById('btn-dashboard');
  if (dash) dash.style.display = isAdmin ? 'flex' : 'none';
  if (isAdmin) document.getElementById('fab').classList.add('show');
  loadFeed();
}

async function ensureProfile() {
  const { data } = await sb.from('profiles').select('display_name').eq('id', currentUser.id).single();
  if (data) { displayName = data.display_name; }
  else {
    const fb = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
    await sb.from('profiles').insert({ id: currentUser.id, display_name: fb });
    displayName = fb;
  }
  profileCache[currentUser.id] = displayName;
}

/* AUTH */
function switchTab(tab) {
  document.getElementById('login-form').style.display  = tab === 'login'  ? '' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? '' : 'none';
  document.getElementById('tab-login').classList.toggle('active',  tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  hide('auth-msg');
}
async function handleLogin() {
  const email = val('login-email'), pw = val('login-password');
  if (!email || !pw) return showMsg('auth-msg','Fill in all fields.','error');
  setBtn('btn-login','Signing in…',true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBtn('btn-login','Sign In →',false);
  if (error) showMsg('auth-msg', error.message, 'error');
}
async function handleSignup() {
  const name = val('signup-name'), email = val('signup-email'), pw = val('signup-password');
  if (!name||!email||!pw) return showMsg('auth-msg','Fill in all fields.','error');
  if (pw.length < 6) return showMsg('auth-msg','Password needs 6+ chars.','error');
  setBtn('btn-signup','Creating…',true);
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  setBtn('btn-signup','Create Account →',false);
  if (error) return showMsg('auth-msg', error.message, 'error');
  if (data?.user) await sb.from('profiles').upsert({ id: data.user.id, display_name: name });
  showMsg('auth-msg','Account created! Sign in now.','success');
  switchTab('login');
}
async function handleGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) showMsg('auth-msg', error.message, 'error');
}
async function handleLogout() { await sb.auth.signOut(); location.reload(); }

/* FEED */
async function loadFeed(query = null) {
  const feed = document.getElementById('feed');
  feed.innerHTML = '<div class="spinner"></div>';
  searchActive = !!query;
  let req;
  if (query) {
    req = sb.from('notices').select('*').textSearch('content', query, { type: 'websearch' }).order('created_at', { ascending: false });
  } else {
    req = sb.from('notices').select('*').order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
  }
  const { data, error } = await req;
  if (error) { feed.innerHTML = errHtml(error.message); return; }
  allNotices = data || [];
  await loadProfiles(allNotices.map(n => n.author_id).filter(Boolean));
  let viewMap = {};
  if (isAdmin && allNotices.length) {
    const ids = allNotices.map(n => n.id);
    const { data: views } = await sb.from('notice_views').select('notice_id').in('notice_id', ids);
    (views||[]).forEach(v => { viewMap[v.notice_id] = (viewMap[v.notice_id]||0)+1; });
  }
  let lovedSet = new Set();
  if (currentUser && allNotices.length) {
    const ids = allNotices.map(n => n.id);
    const { data: loved } = await sb.from('reactions').select('notice_id').eq('user_id', currentUser.id).in('notice_id', ids);
    (loved||[]).forEach(r => lovedSet.add(r.notice_id));
  }
  const active = allNotices.filter(n => !isExpired(n) && isPublished(n)).length;
  document.getElementById('notice-count').textContent = query
    ? `${allNotices.length} result${allNotices.length!==1?'s':''}`
    : active === 0 ? 'No notices yet' : `${active} active`;
  const banner = document.getElementById('search-banner');
  if (query) { banner.classList.add('show'); document.getElementById('search-result-text').textContent = `Results for "${query}"`; }
  else banner.classList.remove('show');
  if (!allNotices.length) {
    feed.innerHTML = `<div class="empty">${iconEmpty(16)}<h4>${query?'No results found':'No Notices Yet'}</h4><p>${query?'Try different keywords.':'Announcements will appear here.'}</p></div>`;
    return;
  }
  feed.innerHTML = '';
  allNotices.forEach((n, i) => {
    const card = buildCard(n, profileCache[n.author_id]||'Alamin', viewMap[n.id]||0, lovedSet.has(n.id));
    card.style.animationDelay = `${i*32}ms`;
    feed.appendChild(card);
    if (!isExpired(n) && isPublished(n)) recordView(n.id);
  });
}
function isExpired(n)   { return n.expires_at && new Date(n.expires_at) < new Date(); }
function isPublished(n) { return !n.publish_at || new Date(n.publish_at) <= new Date(); }
async function loadProfiles(uids) {
  const needed = [...new Set(uids)].filter(id => id && !profileCache[id]);
  if (!needed.length) return;
  const { data } = await sb.from('profiles').select('id,display_name').in('id', needed);
  (data||[]).forEach(p => { profileCache[p.id] = p.display_name; });
}
async function recordView(noticeId) {
  if (!currentUser) return;
  await sb.from('notice_views').upsert({ notice_id: noticeId, user_id: currentUser.id }, { onConflict: 'notice_id,user_id', ignoreDuplicates: true });
}

/* CARD */
function buildCard(n, authorName, views, isLoved, standalone = false) {
  const card = document.createElement('div');
  const expired = isExpired(n), scheduled = !isPublished(n);
  card.className = 'notice-card' + (n.is_pinned&&!expired?' pinned':'') + (expired?' expired-fade':'');
  card.id = `card-${n.id}`;
  let badge = '';
  if (n.is_pinned&&!expired&&!scheduled) badge = `<div class="badge pin">${iconPin(12)} Pinned</div>`;
  if (expired)   badge = `<div class="badge archive">${iconArchive(12)} Archived</div>`;
  if (scheduled) badge = `<div class="badge sched">${iconClock(12)} Scheduled</div>`;
  const imgHTML = n.image_url ? `<img class="card-img" src="${esc(n.image_url)}" alt="image" loading="lazy" />` : '';
  const adminRow = isAdmin ? `
    <div class="admin-row">
      <div class="stat-pill">${iconEye(12)}&nbsp;<b>${views}</b> views</div>
      <button class="btn-pill gold-h" onclick="togglePin('${n.id}',${!n.is_pinned})">${iconPin(12)} ${n.is_pinned?'Unpin':'Pin'}</button>
      <button class="btn-pill gold-h" onclick="openEdit('${n.id}')">${iconEdit(12)} Edit</button>
      <button class="btn-pill del" onclick="deleteNotice('${n.id}')">${iconTrash(12)} Delete</button>
    </div>` : '';
  card.innerHTML = `
    ${badge}
    <div class="card-head">
      <div class="card-author">
        <div class="card-av">${authorName.charAt(0).toUpperCase()}</div>
        <span class="card-name">${esc(authorName)}</span>
      </div>
      <span class="card-time">${formatTime(n.created_at)}</span>
    </div>
    <div class="card-body">${esc(n.content)}</div>
    ${imgHTML}
    ${adminRow}
    <div class="card-foot">
      <button class="btn-love ${isLoved?'loved':''}" id="love-btn-${n.id}" onclick="toggleLove('${n.id}',this)">
        ${iconHeart(isLoved)}&nbsp;<span id="love-count-${n.id}">${n.love_count||0}</span>
      </button>
      <button class="btn-action-pill" id="ct-${n.id}" onclick="toggleComments('${n.id}',this)">
        ${iconComment()} Comments
      </button>
      <button class="btn-action-pill" onclick="shareNotice('${n.id}')">
        ${iconShare()} Share
      </button>
    </div>
    <div class="comments-wrap" id="comments-${n.id}"></div>`;
  return card;
}

/* LOVE */
async function toggleLove(noticeId, btn) {
  if (!currentUser) return;
  const isLoved = btn.classList.contains('loved');
  const countEl = document.getElementById(`love-count-${noticeId}`);
  const cur = parseInt(countEl?.textContent)||0;
  const newCount = isLoved ? Math.max(0, cur-1) : cur+1;
  btn.classList.toggle('loved', !isLoved);
  btn.innerHTML = `${iconHeart(!isLoved)}&nbsp;<span id="love-count-${noticeId}">${newCount}</span>`;
  btn.classList.toggle('loved', !isLoved);
  btn.classList.add('heart-pop');
  setTimeout(() => btn.classList.remove('heart-pop'), 300);
  const notice = allNotices.find(n => n.id === noticeId);
  if (notice) notice.love_count = newCount;
  if (isLoved) {
    await Promise.all([
      sb.from('reactions').delete().eq('notice_id', noticeId).eq('user_id', currentUser.id),
      sb.from('notices').update({ love_count: newCount }).eq('id', noticeId)
    ]);
  } else {
    await Promise.all([
      sb.from('reactions').upsert({ notice_id: noticeId, user_id: currentUser.id }, { ignoreDuplicates: true }),
      sb.from('notices').update({ love_count: newCount }).eq('id', noticeId)
    ]);
  }
}

/* PIN */
async function togglePin(noticeId, pin) {
  await sb.from('notices').update({ is_pinned: pin }).eq('id', noticeId);
  showToast(pin ? 'Notice pinned!' : 'Unpinned.');
  loadFeed();
}

/* COMMENTS */
async function toggleComments(noticeId, btn) {
  const wrap = document.getElementById(`comments-${noticeId}`);
  const open = wrap.classList.contains('open');
  if (open) { wrap.classList.remove('open'); btn.classList.remove('open'); return; }
  btn.classList.add('open');
  wrap.classList.add('open');
  wrap.innerHTML = '<div class="spinner" style="width:22px;height:22px;margin:14px auto;border-width:2px"></div>';
  await renderComments(noticeId, wrap);
}
async function renderComments(noticeId, container) {
  const [{ data: tops }, { data: replies }] = await Promise.all([
    sb.from('comments').select('*').eq('notice_id', noticeId).is('parent_id', null).order('created_at'),
    sb.from('comments').select('*').eq('notice_id', noticeId).not('parent_id','is',null).order('created_at')
  ]);
  const all = [...(tops||[]), ...(replies||[])];
  await loadProfiles(all.map(c => c.author_id));
  container.innerHTML = '';
  if (!(tops||[]).length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-soft);margin-bottom:10px">No comments yet.</p>';
  } else {
    (tops||[]).forEach(c => {
      container.appendChild(buildComment(c, false, noticeId));
      (replies||[]).filter(r => r.parent_id === c.id).forEach(r => container.appendChild(buildComment(r, true, noticeId)));
    });
  }
  const row = document.createElement('div');
  row.className = 'comment-input';
  row.innerHTML = `<input id="ci-${noticeId}" placeholder="Add a comment…" onkeydown="if(event.key==='Enter')postComment('${noticeId}',null)" /><button class="btn-send" onclick="postComment('${noticeId}',null)">Send</button>`;
  container.appendChild(row);
}
function buildComment(c, isReply, noticeId) {
  const name = profileCache[c.author_id]||'User';
  const canDel = isAdmin || c.author_id === currentUser?.id;
  const div = document.createElement('div');
  div.className = `comment${isReply?' reply':''}`;
  div.id = `comment-${c.id}`;
  div.innerHTML = `
    <div class="c-av">${name.charAt(0).toUpperCase()}</div>
    <div class="c-bubble">
      <div class="c-meta"><span class="c-name">${esc(name)}</span><span class="c-time">${formatTime(c.created_at)}</span></div>
      <div class="c-text">${esc(c.content)}</div>
      <div class="c-actions">
        ${!isReply?`<button class="c-btn" onclick="showReplyBox('${c.id}','${noticeId}')">↩ Reply</button>`:''}
        ${canDel?`<button class="c-btn del" onclick="deleteComment('${c.id}','${noticeId}')">✕ Delete</button>`:''}
      </div>
      <div id="rbox-${c.id}"></div>
    </div>`;
  return div;
}
function showReplyBox(cid, noticeId) {
  const box = document.getElementById(`rbox-${cid}`);
  if (box.innerHTML) { box.innerHTML=''; return; }
  box.innerHTML = `<div class="comment-input ri" style="margin-top:8px;margin-left:0"><input id="ri-${cid}" placeholder="Reply…" onkeydown="if(event.key==='Enter')postComment('${noticeId}','${cid}')" /><button class="btn-send" onclick="postComment('${noticeId}','${cid}')">Send</button></div>`;
  document.getElementById(`ri-${cid}`)?.focus();
}
async function postComment(noticeId, parentId) {
  const inputId = parentId ? `ri-${parentId}` : `ci-${noticeId}`;
  const input = document.getElementById(inputId);
  const content = input?.value.trim();
  if (!content||!currentUser) return;
  input.value = '';
  const { error } = await sb.from('comments').insert({ notice_id: noticeId, parent_id: parentId||null, author_id: currentUser.id, content });
  if (error) { showToast('Could not post comment.'); return; }
  await renderComments(noticeId, document.getElementById(`comments-${noticeId}`));
}
async function deleteComment(commentId, noticeId) {
  await sb.from('comments').delete().eq('id', commentId);
  document.getElementById(`comment-${commentId}`)?.remove();
  showToast('Comment deleted.');
}

/* DELETE NOTICE */
async function deleteNotice(id) {
  if (!confirm('Delete this notice permanently?')) return;
  await sb.from('notices').delete().eq('id', id);
  document.getElementById(`card-${id}`)?.remove();
  allNotices = allNotices.filter(n => n.id !== id);
  showToast('Notice deleted.');
}

/* SINGLE NOTICE VIEW (deep link) */
async function showSingleNotice(id) {
  // Show app header too
  showScreen('single-screen');
  // render header info
  setTimeout(() => {
    const av = document.getElementById('user-av-txt2');
    const nm = document.getElementById('user-name-txt2');
    if (av) av.textContent = displayName.charAt(0).toUpperCase();
    if (nm) nm.textContent = displayName;
    const db = document.getElementById('btn-dashboard2');
    if (db) db.style.display = isAdmin ? 'flex' : 'none';
    if (isAdmin) { const f = document.getElementById('fab2'); if(f) f.classList.add('show'); }
  }, 0);

  const body = document.getElementById('single-body');
  body.innerHTML = '<div class="spinner"></div>';
  const { data: n, error } = await sb.from('notices').select('*').eq('id', id).single();
  if (error || !n) {
    body.innerHTML = `<button class="back-btn" onclick="goBack()">${iconBack()} Back to all notices</button><div class="empty">${iconEmpty(16)}<h4>Notice not found</h4><p>It may have been deleted or expired.</p></div>`;
    return;
  }
  await loadProfiles([n.author_id]);
  const authorName = profileCache[n.author_id]||'Alamin';
  let views = 0;
  if (isAdmin) {
    const { count } = await sb.from('notice_views').select('*',{count:'exact',head:true}).eq('notice_id', id);
    views = count||0;
  }
  let isLoved = false;
  if (currentUser) {
    const { data: r } = await sb.from('reactions').select('id').eq('notice_id', id).eq('user_id', currentUser.id).single();
    isLoved = !!r;
  }
  allNotices = [n];
  body.innerHTML = '';
  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.onclick = goBack;
  backBtn.innerHTML = `${iconBack()} Back to all notices`;
  body.appendChild(backBtn);
  const card = buildCard(n, authorName, views, isLoved, true);
  body.appendChild(card);
  recordView(id);
}
function goBack() {
  history.pushState({}, '', location.pathname);
  deepLinkId && (window.location.search = '');
  bootApp();
}

/* SHARE */
function shareNotice(id) {
  const url = `${location.origin}${location.pathname}?id=${id}`;
  navigator.clipboard.writeText(url).then(() => showToast('Link copied!'));
}

/* POST MODAL */
function openPost() {
  editingId = null;
  document.getElementById('modal-title').innerHTML = 'New <em>Notice</em>';
  document.getElementById('btn-publish').textContent = 'Publish Notice';
  document.getElementById('post-content').value = '';
  document.getElementById('post-image').value = '';
  document.getElementById('img-preview').classList.remove('show');
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('post-schedule').value = '';
  hide('post-error');
  document.getElementById('post-modal').classList.add('open');
  setTimeout(() => document.getElementById('post-content').focus(), 80);
}
function openEdit(id) {
  const n = allNotices.find(x => x.id === id); if (!n) return;
  editingId = id;
  document.getElementById('modal-title').innerHTML = 'Edit <em>Notice</em>';
  document.getElementById('btn-publish').textContent = 'Save Changes';
  document.getElementById('post-content').value = n.content||'';
  document.getElementById('post-image').value = '';
  document.getElementById('img-preview').classList.remove('show');
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('post-schedule').value = '';
  hide('post-error');
  document.getElementById('post-modal').classList.add('open');
}
function closePost() { document.getElementById('post-modal').classList.remove('open'); }
function previewImage(e) {
  const file = e.target.files[0]; if (!file) return;
  const prev = document.getElementById('img-preview');
  prev.src = URL.createObjectURL(file); prev.classList.add('show');
  document.getElementById('upload-zone').style.display = 'none';
}
async function handlePublish() {
  const content = val('post-content');
  const file = document.getElementById('post-image').files[0];
  const schedStr = val('post-schedule');
  if (!content && !file) return showMsg('post-error','Write something or attach an image.','error');
  setBtn('btn-publish','Publishing…',true);
  try {
    let image_url = editingId ? (allNotices.find(n=>n.id===editingId)?.image_url||null) : null;
    if (file) {
      const blob = await compressImage(file, 1280, 0.82);
      const fname = `${Date.now()}.${file.name.split('.').pop()}`;
      const { error: upErr } = await sb.storage.from('notice-images').upload(fname, blob, { cacheControl: '3600' });
      if (upErr) throw upErr;
      image_url = sb.storage.from('notice-images').getPublicUrl(fname).data.publicUrl;
    }
    if (editingId) {
      const { error } = await sb.from('notices').update({ content, image_url, updated_at: new Date().toISOString() }).eq('id', editingId);
      if (error) throw error;
      showToast('Notice updated!');
    } else {
      const publish_at = schedStr ? new Date(schedStr).toISOString() : new Date().toISOString();
      const expires_at = new Date(new Date(publish_at).getTime() + 7*24*60*60*1000).toISOString();
      const { error } = await sb.from('notices').insert([{ content, image_url, author_id: currentUser.id, is_pinned: false, publish_at, expires_at, love_count: 0, reactions: {} }]);
      if (error) throw error;
      showToast('Notice published!');
    }
    closePost(); loadFeed();
  } catch(e) {
    showMsg('post-error', e.message||'Something went wrong.','error');
    setBtn('btn-publish', editingId?'Save Changes':'Publish Notice', false);
  }
}

/* IMAGE COMPRESSION */
function compressImage(file, maxPx, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let {width:w, height:h} = img;
        if (w>maxPx||h>maxPx) { if(w>h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;} }
        const c = document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        c.toBlob(b=>resolve(b||file), file.type||'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* SEARCH */
let searchTimer;
function handleSearch(e) {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => { if (q.length>=2) loadFeed(q); else if (searchActive) loadFeed(); }, 380);
}
function clearSearch() { document.getElementById('search-input').value=''; loadFeed(); }

/* SETTINGS */
function openSettings() {
  document.getElementById('settings-name').value = displayName;
  hide('settings-msg');
  document.getElementById('settings-modal').classList.add('open');
}
function closeSettings() { document.getElementById('settings-modal').classList.remove('open'); }
async function saveSettings() {
  const name = val('settings-name');
  if (!name) return showMsg('settings-msg','Name cannot be empty.','error');
  setBtn('btn-save-settings','Saving…',true);
  const { error } = await sb.from('profiles').upsert({ id: currentUser.id, display_name: name });
  setBtn('btn-save-settings','Save Changes',false);
  if (error) return showMsg('settings-msg', error.message, 'error');
  displayName = name; profileCache[currentUser.id] = name;
  document.getElementById('user-av-txt').textContent   = name.charAt(0).toUpperCase();
  document.getElementById('user-name-txt').textContent = name;
  closeSettings(); showToast('Name updated!');
}

/* DASHBOARD */
async function openDashboard() {
  document.getElementById('dash-modal').classList.add('open');
  const dc = document.getElementById('dash-content');
  dc.innerHTML = '<div class="spinner" style="margin:40px auto"></div>';
  const [
    { count: total },
    { count: active },
    { count: totalViews },
    { data: notices }
  ] = await Promise.all([
    sb.from('notices').select('*',{count:'exact',head:true}),
    sb.from('notices').select('*',{count:'exact',head:true}).gt('expires_at', new Date().toISOString()),
    sb.from('notice_views').select('*',{count:'exact',head:true}),
    sb.from('notices').select('id,content,created_at,is_pinned,love_count').order('created_at',{ascending:false}).limit(25)
  ]);
  const ids = (notices||[]).map(n=>n.id);
  let vMap = {};
  if (ids.length) {
    const { data: vs } = await sb.from('notice_views').select('notice_id').in('notice_id', ids);
    (vs||[]).forEach(v => { vMap[v.notice_id]=(vMap[v.notice_id]||0)+1; });
  }
  const rows = (notices||[]).map(n=>`
    <tr>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((n.content||'').substring(0,55))}${(n.content||'').length>55?'…':''}</td>
      <td>${formatTime(n.created_at)}</td>
      <td class="td-views">${vMap[n.id]||0}</td>
      <td>${n.love_count||0}</td>
      <td style="display:flex;gap:6px">
        <button class="td-act" onclick="dashPin('${n.id}',${!n.is_pinned})" title="${n.is_pinned?'Unpin':'Pin'}">${iconPin(13)}</button>
        <button class="td-act del" onclick="dashDelete('${n.id}')" title="Delete">${iconTrash(13)}</button>
      </td>
    </tr>`).join('');
  dc.innerHTML = `
    <div class="dash-grid">
      <div class="dash-tile"><div class="dash-val">${total||0}</div><div class="dash-label">Total Notices</div></div>
      <div class="dash-tile"><div class="dash-val">${active||0}</div><div class="dash-label">Active</div></div>
      <div class="dash-tile"><div class="dash-val">${totalViews||0}</div><div class="dash-label">Total Views</div></div>
    </div>
    <table class="dash-table">
      <thead><tr><th>Notice</th><th>Posted</th><th>Views</th><th>Loves</th><th>Actions</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" style="color:var(--text-soft)">No notices yet.</td></tr>'}</tbody>
    </table>`;
}
async function dashPin(id, pin) {
  await sb.from('notices').update({ is_pinned: pin }).eq('id', id);
  showToast(pin?'Pinned!':'Unpinned.'); openDashboard(); loadFeed();
}
async function dashDelete(id) {
  if (!confirm('Delete this notice?')) return;
  await sb.from('notices').delete().eq('id', id);
  showToast('Deleted.'); openDashboard(); loadFeed();
}
function closeDashboard() { document.getElementById('dash-modal').classList.remove('open'); }

/* OVERLAY */
function overlayClick(e, id) { if (e.target.id===id) document.getElementById(id).classList.remove('open'); }
document.addEventListener('keydown', e => {
  if (e.key==='Escape') document.querySelectorAll('.overlay.open').forEach(o=>o.classList.remove('open'));
});

/* SVG ICONS */
const sv = (d,s=15)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
function iconHeart(filled,s=15){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${filled?'currentColor':'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;}
function iconComment(s=15){return sv('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',s)}
function iconShare(s=15){return sv('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',s)}
function iconPin(s=15){return sv('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',s)}
function iconEdit(s=15){return sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',s)}
function iconTrash(s=15){return sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',s)}
function iconEye(s=15){return sv('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',s)}
function iconBack(s=15){return sv('<polyline points="15 18 9 12 15 6"/>',s)}
function iconArchive(s=15){return sv('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>',s)}
function iconClock(s=15){return sv('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',s)}
function iconSearch(s=15){return sv('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',s)}
function iconSettings(s=15){return sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',s)}
function iconSignOut(s=15){return sv('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',s)}
function iconDash(s=15){return sv('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',s)}
function iconPlus(s=18){return sv('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',s)}
function iconEmpty(s=48){return sv('<circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',s)}

/* UTILS */
function val(id)  { return document.getElementById(id)?.value?.trim()||''; }
function esc(s)   { if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function hide(id) { const el=document.getElementById(id); if(el) el.style.display='none'; }
function errHtml(m){ return `<p style="color:var(--danger);text-align:center;padding:40px;font-size:14px">${m}</p>`; }
function showMsg(id,msg,type){ const el=document.getElementById(id); if(!el) return; el.textContent=msg; el.className=`msg-box ${type}`; el.style.display='block'; }
function setBtn(id,text,disabled){ const b=document.getElementById(id); if(!b) return; b.textContent=text; b.disabled=disabled; }
let toastT;
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2600); }
function formatTime(iso){
  const d=new Date(iso),now=new Date(),diff=Math.floor((now-d)/1000);
  if(diff<60) return 'just now';
  if(diff<3600) return `${Math.floor(diff/60)}m ago`;
  if(diff<86400) return `${Math.floor(diff/3600)}h ago`;
  if(diff<604800) return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
