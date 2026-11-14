// Friends: add people by username, see who is online and what they are playing, and chat.
// Everything goes through the game's server (accounts), so it needs a signed-in account.
import { auth } from './auth.js';

const ACTIVITY = { menu: 'In the menu', game: 'In a game', career: 'In Career', season: 'In Season', online: 'Online game', practice: 'Practice', contest: 'Contests', tutorial: 'Tutorial' };
let ctx = null, poll = 0, chatPoll = 0, current = null, state = { friends: [], incoming: [], outgoing: [] };

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${auth.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* no body */ }
  return { status: r.status, data };
}
const signedIn = () => !!auth.token && !auth.offline;
const ago = (t) => { if (!t) return 'a while ago'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

// The dot on the hub button: a request waiting or a message you have not read
export async function friendsBadge() {
  if (!signedIn()) return false;
  try { const { status, data } = await api('/api/friends'); if (status !== 200) return false; return data.incoming.length > 0 || data.friends.some((f) => f.unread > 0); } catch { return false; }
}

export function initFriends(c) {
  ctx = c;
  const $ = c.$;
  $('#frBody').addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-act]'); if (!t) return;
    const name = t.dataset.name, act = t.dataset.act;
    if (act === 'open') { current = name; renderChat(true); renderList(); return; }
    if (act === 'accept' || act === 'decline') await api(`/api/friends/${act}`, { username: name });
    if (act === 'remove') { if (!confirm(`Remove ${name} from your friends?`)) return; await api('/api/friends/remove', { username: name }); if (current === name) current = null; }
    c.sfx.menu(); await refresh(); renderChat(true);
  });
  $('#frAdd').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const inp = $('#frName'), name = inp.value.trim().toLowerCase();
    if (!name) return;
    const { status, data } = await api('/api/friends/add', { username: name });
    const msg = $('#frMsg');
    if (status === 200) { msg.textContent = data.status === 'friends' ? `You and ${name} are friends now.` : `Request sent to ${name}.`; inp.value = ''; c.sfx.select(); }
    else msg.textContent = status === 404 ? 'No player has that name.' : status === 429 ? 'Slow down a little, then try again.' : data && data.error === 'full' ? 'Your friends list is full.' : 'That did not work. Check the name.';
    await refresh();
  });
  $('#frSend').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const inp = $('#frText'), text = inp.value.trim();
    if (!text || !current) return;
    inp.value = '';
    const { status } = await api('/api/chat', { to: current, text });
    if (status === 429) $('#frMsg').textContent = 'You are sending messages too fast.';
    await renderChat(true);
  });
}

export async function openFriends() {
  const $ = ctx.$;
  ctx.show('friends');
  $('#frMsg').textContent = '';
  if (!signedIn()) { $('#frBody').innerHTML = '<p class="adm-empty">Log in to your account to add friends and chat. (Offline mode has no friends list.)</p>'; $('#frChat').hidden = true; $('#frAdd').hidden = true; return; }
  $('#frAdd').hidden = false;
  await refresh();
  clearInterval(poll); clearInterval(chatPoll);
  poll = setInterval(() => { if (!$('#friends').classList.contains('show')) { clearInterval(poll); clearInterval(chatPoll); return; } refresh(); }, 8000);
  chatPoll = setInterval(() => { if ($('#friends').classList.contains('show') && current) renderChat(false); }, 3000);
}

async function refresh() {
  const { status, data } = await api('/api/friends');
  if (status !== 200) return;
  state = data;
  renderList();
}

function renderList() {
  const esc = ctx.esc, el = ctx.$('#frBody');
  const inc = state.incoming.map((n) => `<div class="fr-row"><b>${esc(n)}</b><span class="grow"></span><button type="button" data-act="accept" data-name="${esc(n)}">Accept</button><button type="button" class="danger" data-act="decline" data-name="${esc(n)}">Decline</button></div>`).join('');
  const out = state.outgoing.length ? `<p class="adm-note">Waiting for: ${state.outgoing.map(esc).join(', ')}</p>` : '';
  const fr = state.friends.slice().sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)).map((f) => `
    <div class="fr-row ${current === f.name ? 'on' : ''}"><button type="button" class="fr-open" data-act="open" data-name="${esc(f.name)}"><i class="dot ${f.online ? 'on' : ''}"></i><b>${esc(f.name)}</b>
      <small>${f.online ? esc(ACTIVITY[f.activity] || 'Playing') : 'Seen ' + ago(f.lastSeen)}</small>${f.unread ? `<span class="adm-count hot">${f.unread}</span>` : ''}</button>
      <button type="button" class="fr-x" title="Remove friend" aria-label="Remove ${esc(f.name)}" data-act="remove" data-name="${esc(f.name)}">×</button></div>`).join('');
  el.innerHTML = (inc ? `<h4>Requests</h4>${inc}` : '') + `<h4>Friends <small>${state.friends.length}</small></h4>${fr || '<p class="adm-empty">No friends yet. Add someone by their username above.</p>'}${out}`;
}

async function renderChat(scroll) {
  const $ = ctx.$, box = $('#frChat');
  if (!current || !state.friends.some((f) => f.name === current)) { box.hidden = true; return; }
  box.hidden = false;
  $('#frWith').textContent = current;
  const { status, data } = await api('/api/chat', { with: current, read: true });
  if (status !== 200) return;
  const list = $('#frMsgs'), atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
  list.innerHTML = data.items.length ? data.items.map((m) => `<div class="fr-msg ${m.from === current ? 'them' : 'me'}"><span>${ctx.esc(m.text)}</span></div>`).join('') : '<p class="adm-empty">Say hi! Tip: send your room code to invite them to an online game.</p>';
  if (scroll || atEnd) list.scrollTop = list.scrollHeight;
}
