// Admin panel. A basketball button on the home screen opens a page for the admin code, then this panel.
// Every check happens on the server (src/worker.js): these pages only ask, and nothing here can grant access by itself.
import { TEAMS } from './data.js';
import * as Season from './season.js';

const ATTR_LABELS = Object.fromEntries(Season.ATTRS);
const ACTIVITY = { menu: 'Home screen', game: 'In a game', career: 'My Career', season: 'Season', online: 'Online match', practice: 'Practice', contest: 'Contest', tutorial: 'Tutorial' };

let c = null;              // { $, $$, show, sfx, esc, exit } handed over by main.js
let token = null, expiresAt = 0;
let state = { tab: 'overview', data: null, q: '', sort: 'seen', audit: null, detail: null, busy: false };
let timer = 0;

// The admin sign-in is kept only in memory while the panel is open: leaving the panel locks it, and clicking the ball always asks for the code.
const saveToken = (t, exp) => { token = t; expiresAt = exp; };
const clearToken = () => { token = null; expiresAt = 0; };

const e = (s) => c.esc(String(s ?? ''));
const ago = (t) => {
  if (!t) return 'never';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const dateStr = (t) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown');
const timeStr = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- Talking to the server ----------
async function api(path, { method = 'GET', body = null } = {}) {
  const headers = { 'X-Admin-Token': token || '' };
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined }); } catch { return { status: 0, data: null }; }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401 && data && data.error === 'not-admin') { endSession('Your admin sign-in ended. Enter the code again.'); throw new Error('not-admin'); }
  return { status: res.status, data };
}

function endSession(message) {
  clearToken();
  clearInterval(timer);
  state = { tab: 'overview', data: null, q: '', sort: 'seen', audit: null, detail: null, busy: false };
  showCodePage(message || '');
}

// ---------- The code page ----------
function showCodePage(message) {
  c.$('#adminError').textContent = message || '';
  c.$('#adminCode').value = '';
  c.show('adminLogin');
  setTimeout(() => { try { c.$('#adminCode').focus(); } catch { /* ignore */ } }, 80);
}

async function submitCode(ev) {
  ev.preventDefault();
  const code = c.$('#adminCode').value;
  const err = (m) => { c.$('#adminError').textContent = m; };
  if (!code.trim()) return err('Enter the admin code.');
  const btn = c.$('#adminGo');
  btn.disabled = true; err('');
  let res, data = null;
  try {
    res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    try { data = await res.json(); } catch { /* not the game's server */ }
  } catch { btn.disabled = false; return err('Could not reach the server. Check your connection.'); }
  btn.disabled = false;
  if (res.status === 200 && data && data.token) {
    c.$('#adminCode').value = '';
    saveToken(data.token, data.expires);
    c.sfx.select();
    return openPanel();
  }
  if (res.status === 429) { const m = Math.max(1, Math.ceil(((data && data.retry) || 600) / 60)); return err(`Too many wrong tries. The admin door is locked for about ${m} minute${m === 1 ? '' : 's'}.`); }
  if (res.status === 401) return err('That is not the admin code.');
  return err("Admin tools need the game's server. They don't work on a plain file server.");
}

// ---------- Opening the panel ----------
export function openAdmin() {
  clearToken();
  showCodePage('');
}

async function openPanel() {
  if (!(await refresh(true))) { c.$('#adminError').textContent = 'Could not load the admin panel. Please try again.'; return; }
  c.show('admin');
  render();
  clearInterval(timer);
  timer = setInterval(() => {
    const open = c.$('#admin').classList.contains('show');
    if (!open) { clearInterval(timer); return; }
    if (state.detail || c.$('#admDialog').childElementCount) return;
    // keep what the admin is typing: on the Players tab only the list underneath is redrawn
    refresh(true).then((ok) => { if (!ok || !state.data) return; if (state.tab === 'players' && c.$('#admList')) c.$('#admList').innerHTML = playerRows(); else if (state.tab === 'overview' || state.tab === 'players') render(true); });
  }, 20000);
}

async function refresh(quiet) {
  try {
    const { status, data } = await api('/api/admin/overview');
    if (status === 200 && data) { state.data = data; return true; }
  } catch { return false; }
  if (!quiet) toast('Could not load the player list.', true);
  return false;
}

// ---------- Small helpers: toast and dialog ----------
let toastT = 0;
function toast(msg, bad) {
  const t = c.$('#admToast');
  t.textContent = msg;
  t.className = `adm-toast show${bad ? ' bad' : ''}`;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

function ask({ title, text = '', input = null, confirm = 'OK', danger = false, expect = null }) {
  return new Promise((resolve) => {
    const d = c.$('#admDialog');
    d.innerHTML = `<div class="adm-dlg" role="dialog" aria-modal="true"><h3>${e(title)}</h3>${text ? `<p>${e(text)}</p>` : ''}${input ? `<input id="admDlgIn" type="${input.type || 'text'}" placeholder="${e(input.placeholder || '')}" maxlength="${input.max || 200}" autocomplete="off">` : ''}${expect ? `<input id="admDlgIn" placeholder="Type ${e(expect)} to confirm" autocomplete="off">` : ''}<div class="row"><button type="button" id="admDlgNo">Cancel</button><button type="button" id="admDlgYes" class="${danger ? 'danger' : 'primary'}">${e(confirm)}</button></div></div>`;
    d.hidden = false;
    const inp = d.querySelector('#admDlgIn');
    if (inp) inp.focus();
    const done = (v) => { d.hidden = true; d.innerHTML = ''; resolve(v); };
    d.querySelector('#admDlgNo').onclick = () => done(null);
    d.querySelector('#admDlgYes').onclick = () => {
      if (expect) { if (inp.value.trim().toLowerCase() !== expect.toLowerCase()) { inp.classList.add('bad'); return; } return done(true); }
      if (input && !inp.value.trim()) { inp.classList.add('bad'); return; }
      done(inp ? inp.value.trim() : true);
    };
    if (inp) inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') d.querySelector('#admDlgYes').click(); else if (ev.key === 'Escape') done(null); });
  });
}

// ---------- Layout ----------
const TABS = [['overview', 'Overview'], ['players', 'Players'], ['gifts', 'Gift everyone'], ['announce', 'Announcements'], ['activity', 'Activity log']];

function buildShell() {
  c.$('#admin').innerHTML = `
    <div class="adm-bar">
      <div class="adm-title"><span class="adm-mini-ball" aria-hidden="true"></span><div><b>Admin Panel</b><small id="admSub"></small></div></div>
      <div class="adm-actions"><button type="button" id="admRefresh">Refresh</button><button type="button" id="admExit" class="primary">Exit and lock</button></div>
    </div>
    <div class="adm-tabs" id="admTabs" role="tablist"></div>
    <div id="admBody" class="adm-body"></div>
    <div id="admDetail" class="adm-detail" hidden></div>
    <div id="admDialog" class="adm-dialog" hidden></div>
    <div id="admToast" class="adm-toast" role="status"></div>`;
  c.$('#admTabs').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-tab]'); if (b) { state.tab = b.dataset.tab; c.sfx.menu(); render(); } });
  c.$('#admRefresh').addEventListener('click', async () => { c.sfx.menu(); state.audit = null; await refresh(); render(); toast('Updated'); });
  c.$('#admExit').addEventListener('click', async () => {
    c.sfx.menu();
    clearInterval(timer);
    closeDetail();
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch { /* already ended */ }
    clearToken();
    state = { tab: 'overview', data: null, q: '', sort: 'seen', audit: null, detail: null, busy: false };
    c.exit();
  });
}

function render(keepScroll) {
  if (!state.data) return;
  const sub = c.$('#admSub');
  if (sub) sub.textContent = `Signed in until ${new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  c.$('#admTabs').innerHTML = TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === state.tab ? 'on' : ''}">${l}${k === 'players' ? ` <span class="adm-count">${state.data.stats.total}</span>` : ''}</button>`).join('');
  const body = c.$('#admBody');
  const top = keepScroll ? body.scrollTop : 0;
  if (state.tab === 'overview') renderOverview(body);
  else if (state.tab === 'players') renderPlayers(body);
  else if (state.tab === 'gifts') renderGifts(body);
  else if (state.tab === 'announce') renderAnnounce(body);
  else renderActivity(body);
  body.scrollTop = top;
}

// ---------- Overview ----------
const signIns = (n) => `${n || 0} sign-in${n === 1 ? '' : 's'}`;

function userLine(u, extra) {
  return `<button type="button" class="adm-user" data-user="${e(u.username)}"><i class="dot ${u.online ? 'on' : ''}"></i><b>${e(u.username)}</b>${u.banned ? '<span class="adm-tag bad">suspended</span>' : ''}<span class="grow"></span><small>${extra}</small></button>`;
}

function renderOverview(body) {
  const d = state.data, s = d.stats;
  const online = d.users.filter((u) => u.online);
  const recent = d.users.filter((u) => !u.online).slice(0, 8);
  body.innerHTML = `
    <div class="adm-cards">
      <div class="adm-card"><b>${s.total}</b><span>Accounts</span></div>
      <div class="adm-card live"><b>${s.online}</b><span>Online now</span></div>
      <div class="adm-card"><b>${s.newToday}</b><span>New today</span></div>
      <div class="adm-card"><b>${s.newWeek}</b><span>New this week</span></div>
      <div class="adm-card ${s.suspended ? 'warn' : ''}"><b>${s.suspended}</b><span>Suspended</span></div>
    </div>
    <div class="adm-sec">
      <h4>New accounts</h4>
      <div class="adm-row"><span>Sign-ups are <b>${d.settings.signups ? 'open' : 'paused'}</b>. ${d.settings.signups ? 'Anyone can create an account.' : 'Nobody new can register. Existing players are not affected.'}</span><button type="button" id="admSignups" class="${d.settings.signups ? 'danger' : 'primary'}">${d.settings.signups ? 'Pause sign-ups' : 'Open sign-ups'}</button></div>
    </div>
    <div class="adm-two">
      <div class="adm-sec"><h4>Online now <small>${online.length}</small></h4>${online.length ? online.map((u) => userLine(u, e(ACTIVITY[u.activity] || 'Playing'))).join('') : '<p class="adm-empty">Nobody is online right now.</p>'}</div>
      <div class="adm-sec"><h4>Seen recently</h4>${recent.length ? recent.map((u) => userLine(u, ago(u.lastSeen))).join('') : '<p class="adm-empty">No other accounts yet.</p>'}</div>
    </div>
    <div class="adm-sec">
      <h4>Admin security</h4>
      <div class="adm-row"><span>Signs every admin out of the panel, including you. Do this after changing the admin code.</span><button type="button" id="admRevoke" class="danger">Sign out all admins</button></div>
    </div>
    <p class="adm-note">Accounts show up here once they have signed in since the admin panel was added. Players check in about every minute and a half, so "online" means seen in the last couple of minutes.</p>`;
  c.$('#admRevoke').addEventListener('click', async () => {
    if (!(await ask({ title: 'Sign out all admins?', text: 'Everyone using the admin panel, you included, has to enter the code again.', confirm: 'Sign them out', danger: true }))) return;
    await api('/api/admin/revoke-admins', { method: 'POST', body: {} }).catch(() => null);
    endSession('All admin sign-ins ended. Enter the code to come back.');
  });
  c.$('#admSignups').addEventListener('click', async () => {
    const open = d.settings.signups;
    if (open && !(await ask({ title: 'Pause new sign-ups?', text: 'Nobody new will be able to create an account until you open sign-ups again.', confirm: 'Pause sign-ups', danger: true }))) return;
    const r = await api('/api/admin/settings', { method: 'POST', body: { signups: !open } });
    if (r.status === 200) { await refresh(true); render(true); toast(open ? 'Sign-ups paused' : 'Sign-ups open'); } else toast('That did not work.', true);
  });
}

// ---------- Players ----------
function filteredUsers() {
  const q = state.q.trim().toLowerCase();
  let list = state.data.users.filter((u) => !q || u.username.includes(q));
  const by = {
    seen: (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0),
    name: (a, b) => a.username.localeCompare(b.username),
    created: (a, b) => (b.created || 0) - (a.created || 0),
    logins: (a, b) => (b.logins || 0) - (a.logins || 0),
  }[state.sort] || (() => 0);
  list = list.slice().sort(by);
  return list;
}

function playerRows() {
  const list = filteredUsers();
  if (!list.length) return '<p class="adm-empty">No accounts match.</p>';
  return list.map((u) => `<button type="button" class="adm-row-user" data-user="${e(u.username)}">
      <span class="who"><i class="dot ${u.online ? 'on' : ''}"></i><b>${e(u.username)}</b>${u.banned ? '<span class="adm-tag bad">suspended</span>' : ''}</span>
      <span class="what">${u.online ? e(ACTIVITY[u.activity] || 'Playing') : `Seen ${ago(u.lastSeen)}`}</span>
      <span class="meta">${signIns(u.logins)}</span>
      <span class="meta">Joined ${dateStr(u.created)}</span></button>`).join('');
}

function renderPlayers(body) {
  body.innerHTML = `
    <div class="adm-tools">
      <input id="admQ" type="search" placeholder="Search players" value="${e(state.q)}" autocomplete="off" aria-label="Search players">
      <select id="admSort" aria-label="Sort players"><option value="seen">Last seen</option><option value="name">Name</option><option value="created">Newest</option><option value="logins">Most sign-ins</option></select>
      <button type="button" id="admCsv">Export CSV</button>
    </div>
    <div class="adm-list" id="admList">${playerRows()}</div>`;
  c.$('#admSort').value = state.sort;
  c.$('#admQ').addEventListener('input', (ev) => { state.q = ev.target.value; c.$('#admList').innerHTML = playerRows(); });
  c.$('#admSort').addEventListener('change', (ev) => { state.sort = ev.target.value; c.$('#admList').innerHTML = playerRows(); });
  c.$('#admCsv').addEventListener('click', exportCsv);
}

function exportCsv() {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['username', 'created', 'last seen', 'sign-ins', 'activity', 'suspended']].concat(state.data.users.map((u) => [u.username, u.created ? new Date(u.created).toISOString() : '', u.lastSeen ? new Date(u.lastSeen).toISOString() : '', u.logins || 0, u.activity || '', u.banned ? 'yes' : '']));
  const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `2k-power-play-players-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- One player ----------
const ratingGrid = (r) => `<div class="adm-ratings">${Season.ATTRS.map(([k, l]) => `<span><small>${e(l)}</small><b>${r && Number.isFinite(Number(r[k])) ? Number(r[k]) : '-'}</b></span>`).join('')}</div>`;

function careerCard(cr) {
  const t = TEAMS[cr.team], tier = Season.tier(cr.ovr), arch = Season.ARCHETYPES[cr.archetype];
  return `<div class="adm-career">
    <div class="adm-c-top"><b>${e(cr.name || 'Unnamed')}</b><span class="adm-tag">${e(cr.pos)}</span><span class="adm-tag tier-${tier.cls}">${cr.ovr} ${tier.name}</span></div>
    <div class="adm-c-sub">Slot ${cr.slot} · ${e(arch ? arch.label : cr.archetype)}${cr.adminUnlock ? ' · all play styles unlocked' : ''}</div>
    <div class="adm-c-stats"><span>◆ ${cr.rp} Rep Points</span><span>${cr.games} games</span><span>${cr.titles} titles</span><span>Year ${cr.year}</span><span>${t ? e(`${t.city} ${t.name}`) : '-'}</span></div>
    ${ratingGrid(cr.ratings)}
  </div>`;
}

function inboxLine(i) {
  const names = { rp: `+${i.amount} Rep Points`, attr: `${i.attr === 'all' ? 'Every rating' : ATTR_LABELS[i.attr] || i.attr} ${i.amount > 0 ? '+' : ''}${i.amount}`, titles: `+${i.amount} championship${i.amount === 1 ? '' : 's'}`, maxRatings: 'All ratings to 99', unlockStyles: 'Unlock all play styles', message: `Message: ${i.text}` };
  return `<li>${e(names[i.type] || i.type)}${i.slot ? ` <small>(slot ${i.slot})</small>` : ''}${i.note ? ` <small>“${e(i.note)}”</small>` : ''}</li>`;
}

async function openDetail(name) {
  const box = c.$('#admDetail');
  box.hidden = false;
  box.innerHTML = '<div class="adm-panel"><p class="adm-empty">Loading...</p></div>';
  const { status, data } = await api(`/api/admin/user?u=${encodeURIComponent(name)}`);
  if (status !== 200 || !data) { box.hidden = true; toast('Could not load that account.', true); return; }
  state.detail = data;
  const entry = data.entry || {};
  const t = data.season ? TEAMS[data.season.team] : null;
  const attrOptions = ['<option value="all">All ratings</option>'].concat(Season.ATTRS.map(([k, l]) => `<option value="${k}">${e(l)}</option>`)).join('');
  box.innerHTML = `<div class="adm-panel" role="dialog" aria-modal="true">
    <div class="adm-p-head">
      <div><h3><i class="dot ${entry.lastSeen && Date.now() - entry.lastSeen < 150000 ? 'on' : ''}"></i> ${e(data.username)} ${data.ban ? '<span class="adm-tag bad">suspended</span>' : ''}</h3>
      <small>Joined ${dateStr(data.created)} · seen ${ago(entry.lastSeen)} · ${signIns(entry.logins)} · ${data.sessions} device${data.sessions === 1 ? '' : 's'} signed in · cloud save ${data.saveAt ? ago(data.saveAt) : 'none'}</small>
      ${data.ban ? `<small class="warn">Suspended ${ago(data.ban.at)}${data.ban.reason ? `: ${e(data.ban.reason)}` : ''}</small>` : ''}</div>
      <button type="button" id="admDetailX" aria-label="Close">×</button>
    </div>
    <div class="adm-sec"><h4>Career mode</h4>${data.careers.length ? data.careers.map(careerCard).join('') : '<p class="adm-empty">No career saved to the cloud yet. Gifts will wait until they start one.</p>'}</div>
    ${data.season ? `<div class="adm-sec"><h4>Season mode</h4><p class="adm-line">${t ? e(`${t.city} ${t.name}`) : 'Team'} · Year ${data.season.year} · ${data.season.wins}-${data.season.losses}${data.season.champion ? ' · champions' : ''}</p></div>` : ''}
    ${data.inbox.length ? `<div class="adm-sec"><h4>Waiting for them</h4><ul class="adm-inbox">${data.inbox.map(inboxLine).join('')}</ul></div>` : ''}
    <div class="adm-sec" id="admGive"><h4>Give something</h4>
      <div class="adm-row">
        <label>Career slot <select id="gSlot"><option value="0">All their careers</option><option value="1">Slot 1</option><option value="2">Slot 2</option><option value="3">Slot 3</option></select></label>
        <label class="grow">Note for the player (optional) <input id="gNote" maxlength="200" placeholder="Shown when they receive it"></label>
      </div>
      <div class="adm-chips">
        <button type="button" data-gift="rp:100">+100 Rep Points</button><button type="button" data-gift="rp:500">+500</button><button type="button" data-gift="rp:1000">+1,000</button><button type="button" data-gift="rp:5000">+5,000</button>
        <button type="button" data-gift="attr:all:5">+5 to every rating</button><button type="button" data-gift="maxRatings">All ratings to 99</button>
        <button type="button" data-gift="unlockStyles">Unlock all play styles</button><button type="button" data-gift="titles:1">+1 championship</button>
      </div>
      <div class="adm-row"><label>Rep Points <input id="gRp" type="number" min="1" max="100000" placeholder="e.g. 250"></label><button type="button" id="gRpGo">Give</button>
        <label>Rating <select id="gAttr">${attrOptions}</select></label><label>Amount <input id="gAmt" type="number" min="-50" max="50" value="5"></label><button type="button" id="gAttrGo">Give</button></div>
      <div class="adm-row"><label class="grow">Message to the player <textarea id="gMsg" maxlength="400" rows="2" placeholder="They will see this the next time they open the game"></textarea></label><button type="button" id="gMsgGo">Send</button></div>
    </div>
    <div class="adm-sec"><h4>Account</h4>
      <div class="adm-chips">
        <button type="button" data-act="password">Reset password</button><button type="button" data-act="signout">Sign out everywhere</button>
        ${data.ban ? '<button type="button" data-act="unban" class="primary">Unsuspend</button>' : '<button type="button" data-act="ban" class="danger">Suspend</button>'}
        <button type="button" data-act="clearsave" class="danger">Clear cloud save</button><button type="button" data-act="delete" class="danger">Delete account</button>
      </div>
    </div>
  </div>`;
  wireDetail(box, data.username);
}

function closeDetail() { const box = c.$('#admDetail'); box.hidden = true; box.innerHTML = ''; state.detail = null; }

function wireDetail(box, name) {
  box.querySelector('#admDetailX').onclick = closeDetail;
  const slot = () => Number(box.querySelector('#gSlot').value) || 0;
  const note = () => box.querySelector('#gNote').value.trim();
  const give = async (gift) => {
    const r = await api('/api/admin/gift', { method: 'POST', body: { username: name, gift: { ...gift, slot: slot(), note: note() } } });
    if (r.status === 200) { c.sfx.select(); toast(`Sent to ${name}`); await openDetail(name); } else toast('That gift could not be sent.', true);
  };
  box.querySelectorAll('[data-gift]').forEach((b) => b.addEventListener('click', () => {
    const [type, a, b2] = b.dataset.gift.split(':');
    if (type === 'rp') give({ type: 'rp', amount: Number(a) });
    else if (type === 'attr') give({ type: 'attr', attr: a, amount: Number(b2) });
    else if (type === 'titles') give({ type: 'titles', amount: Number(a) });
    else give({ type });
  }));
  box.querySelector('#gRpGo').onclick = () => { const n = Number(box.querySelector('#gRp').value); if (!(n >= 1 && n <= 100000)) return toast('Enter 1 to 100,000 Rep Points.', true); give({ type: 'rp', amount: n }); };
  box.querySelector('#gAttrGo').onclick = () => { const n = Number(box.querySelector('#gAmt').value); if (!n || n < -50 || n > 50) return toast('Enter an amount from -50 to 50.', true); give({ type: 'attr', attr: box.querySelector('#gAttr').value, amount: n }); };
  box.querySelector('#gMsgGo').onclick = () => { const text = box.querySelector('#gMsg').value.trim(); if (!text) return toast('Write a message first.', true); give({ type: 'message', text }); };

  const act = async (path, body, ok) => {
    const r = await api(path, { method: 'POST', body: { username: name, ...body } });
    if (r.status === 200) { c.sfx.select(); toast(ok); await refresh(true); render(true); await openDetail(name); } else toast('That did not work.', true);
  };
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.act;
    if (a === 'password') {
      const pw = await ask({ title: `New password for ${name}`, text: 'At least 8 characters. They are signed out everywhere and must use this to log in. Tell them the new password.', input: { type: 'text', placeholder: 'New password', max: 128 }, confirm: 'Reset password' });
      if (!pw) return;
      if (pw.length < 8) return toast('Use at least 8 characters.', true);
      act('/api/admin/password', { password: pw }, 'Password reset');
    } else if (a === 'signout') act('/api/admin/signout-user', {}, 'Signed out everywhere');
    else if (a === 'ban') {
      const reason = await ask({ title: `Suspend ${name}?`, text: 'They are signed out and cannot log in until you unsuspend them. Add a short reason for your own records.', input: { placeholder: 'Reason', max: 200 }, confirm: 'Suspend', danger: true });
      if (reason) act('/api/admin/ban', { on: true, reason }, `${name} suspended`);
    } else if (a === 'unban') act('/api/admin/ban', { on: false }, `${name} can log in again`);
    else if (a === 'clearsave') { if (await ask({ title: 'Clear the cloud save?', text: `${name}'s careers, season, kits and tactics saved on the account are erased. Copies on their own devices stay until the next sync, which can bring them back.`, confirm: 'Clear it', danger: true })) act('/api/admin/clear-save', {}, 'Cloud save cleared'); }
    else if (a === 'delete') {
      if (await ask({ title: `Delete ${name}?`, text: 'The account and everything saved on it are erased for good. This cannot be undone.', expect: name, confirm: 'Delete account', danger: true })) {
        const r = await api('/api/admin/delete', { method: 'POST', body: { username: name, confirm: name } });
        if (r.status === 200) { c.sfx.select(); toast(`${name} deleted`); closeDetail(); await refresh(true); render(true); } else toast('That did not work.', true);
      }
    }
  }));
}

// ---------- Gift everyone ----------
function renderGifts(body) {
  const total = state.data.stats.total;
  body.innerHTML = `<div class="adm-sec"><h4>Gift everyone</h4>
    <p class="adm-note">Sends to all ${total} account${total === 1 ? '' : 's'} on the list. Each player receives it the next time they open the game, and career gifts wait until they have a career.</p>
    <div class="adm-row"><label>What <select id="bType"><option value="rp">Rep Points</option><option value="attr">Rating boost</option><option value="titles">Championships</option><option value="maxRatings">All ratings to 99</option><option value="unlockStyles">Unlock all play styles</option><option value="message">Message only</option></select></label>
      <label id="bAttrWrap">Rating <select id="bAttr">${['<option value="all">All ratings</option>'].concat(Season.ATTRS.map(([k, l]) => `<option value="${k}">${e(l)}</option>`)).join('')}</select></label>
      <label id="bAmtWrap">Amount <input id="bAmt" type="number" value="100" min="-50" max="100000"></label>
      <label>Career slot <select id="bSlot"><option value="0">All careers</option><option value="1">Slot 1</option><option value="2">Slot 2</option><option value="3">Slot 3</option></select></label></div>
    <div class="adm-row"><label class="grow">Message or note <textarea id="bNote" rows="2" maxlength="400" placeholder="Shown to every player, e.g. Thanks for playing!"></textarea></label><button type="button" id="bGo" class="primary">Send to everyone</button></div></div>`;
  const sync = () => {
    const t = c.$('#bType').value;
    c.$('#bAttrWrap').style.display = t === 'attr' ? '' : 'none';
    c.$('#bAmtWrap').style.display = t === 'rp' || t === 'attr' || t === 'titles' ? '' : 'none';
    c.$('#bAmt').value = t === 'rp' ? 100 : t === 'attr' ? 3 : 1;
  };
  c.$('#bType').addEventListener('change', sync); sync();
  c.$('#bGo').addEventListener('click', async () => {
    const type = c.$('#bType').value, text = c.$('#bNote').value.trim(), amount = Number(c.$('#bAmt').value);
    const gift = { type, slot: Number(c.$('#bSlot').value) || 0 };
    if (type === 'rp' || type === 'titles') gift.amount = amount;
    if (type === 'attr') { gift.attr = c.$('#bAttr').value; gift.amount = amount; }
    if (type === 'message') { if (!text) return toast('Write a message first.', true); gift.text = text; } else gift.note = text;
    if (!(await ask({ title: 'Send to everyone?', text: `This goes to all ${total} accounts and cannot be taken back.`, confirm: 'Send it', danger: true }))) return;
    const r = await api('/api/admin/gift', { method: 'POST', body: { username: '*', gift } });
    if (r.status === 200) { c.sfx.select(); toast(`Sent to ${r.data.sent} player${r.data.sent === 1 ? '' : 's'}`); state.audit = null; } else toast('That gift could not be sent.', true);
  });
}

// ---------- Announcements ----------
function renderAnnounce(body) {
  const list = state.data.announcements || [];
  body.innerHTML = `<div class="adm-sec"><h4>Post an announcement</h4>
    <p class="adm-note">A banner on every player's home screen and on the login page until it expires.</p>
    <div class="adm-row"><label class="grow">Message <textarea id="aText" rows="2" maxlength="300" placeholder="e.g. Double Rep Points this weekend!"></textarea></label>
    <label>Show for <select id="aHours"><option value="1">1 hour</option><option value="6">6 hours</option><option value="24" selected>1 day</option><option value="72">3 days</option><option value="168">1 week</option></select></label>
    <button type="button" id="aGo" class="primary">Post</button></div></div>
    <div class="adm-sec"><h4>Showing now <small>${list.length}</small></h4>${list.length ? list.map((a) => `<div class="adm-ann"><div><b>${e(a.text)}</b><small>Posted ${ago(a.at)} · ends ${timeStr(a.until)}</small></div><button type="button" data-rm="${e(a.id)}" class="danger">Remove</button></div>`).join('') : '<p class="adm-empty">No announcements are showing.</p>'}</div>`;
  c.$('#aGo').addEventListener('click', async () => {
    const text = c.$('#aText').value.trim();
    if (!text) return toast('Write a message first.', true);
    const r = await api('/api/admin/announce', { method: 'POST', body: { text, hours: Number(c.$('#aHours').value) } });
    if (r.status === 200) { c.sfx.select(); toast('Posted'); state.audit = null; await refresh(true); render(true); } else toast('That did not work.', true);
  });
  body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api('/api/admin/announce/remove', { method: 'POST', body: { id: b.dataset.rm } });
    if (r.status === 200) { toast('Removed'); state.audit = null; await refresh(true); render(true); } else toast('That did not work.', true);
  }));
}

// ---------- Activity log ----------
async function renderActivity(body) {
  if (!state.audit) {
    body.innerHTML = '<p class="adm-empty">Loading...</p>';
    const r = await api('/api/admin/audit');
    state.audit = r.status === 200 && r.data ? r.data.items : [];
    if (state.tab !== 'activity') return;
  }
  body.innerHTML = `<div class="adm-sec"><h4>Recent admin activity <small>last ${state.audit.length}</small></h4>${state.audit.length ? state.audit.map((i) => `<div class="adm-log"><small>${timeStr(i.t)}</small><b>${e(i.a)}</b>${i.target ? `<span class="adm-tag">${e(i.target)}</span>` : ''}${i.detail ? `<span class="adm-detail-text">${e(i.detail)}</span>` : ''}</div>`).join('') : '<p class="adm-empty">Nothing yet.</p>'}</div>`;
}

// ---------- Hooks ----------
export function initAdmin(ctx) {
  c = ctx;
  buildShell();
  c.$('#adminForm').addEventListener('submit', submitCode);
  c.$('#adminShow').addEventListener('click', () => {
    const f = c.$('#adminCode');
    const show = f.type === 'password';
    f.type = show ? 'text' : 'password';
    c.$('#adminShow').textContent = show ? 'Hide' : 'Show';
  });
  // Clicking a player anywhere in the panel opens their page
  c.$('#admin').addEventListener('click', (ev) => { const b = ev.target.closest('[data-user]'); if (b) { c.sfx.menu(); openDetail(b.dataset.user); } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.detail && c.$('#admDialog').hidden) closeDetail(); });
}
