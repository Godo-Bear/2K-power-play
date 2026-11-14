// Accounts: sign up, log in and out. The login token is kept in this browser; the server (src/worker.js) checks it.
const KEY = 'pph-auth';

export const auth = { user: null, token: null, offline: false };

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && typeof saved.token === 'string' && typeof saved.user === 'string') { auth.token = saved.token; auth.user = saved.user; }
} catch { /* ignore */ }

function remember() { try { localStorage.setItem(KEY, JSON.stringify({ user: auth.user, token: auth.token })); } catch { /* ignore */ } }
function forget() { auth.user = null; auth.token = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

async function call(path, { method = 'POST', body = null, token = null } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON: the server isn't the game's Worker */ }
  return { status: res.status, data };
}

// 'ok' (logged in), 'none' (not logged in), or 'unreachable' (no account server here, e.g. a plain static file server)
export async function checkSession() {
  if (!auth.token) {
    try { const r = await call('/api/ping', { method: 'GET' }); return r.data && r.data.ok ? 'none' : 'unreachable'; } catch { return 'unreachable'; }
  }
  try {
    const r = await call('/api/me', { method: 'GET', token: auth.token });
    if (r.status === 200 && r.data && r.data.username) { auth.user = r.data.username; remember(); return 'ok'; }
    if (r.status === 401) { forget(); return 'none'; }
    return 'unreachable';
  } catch { return 'unreachable'; }
}

// A quiet check-in about every minute and a half: it tells the admin you are online and what you are doing.
// Returns 'ok', 'none' (this login is no longer valid: signed out or suspended) or 'unreachable'.
export async function heartbeat(activity) {
  if (!auth.token) return 'none';
  try {
    const r = await call(`/api/me?a=${encodeURIComponent(activity || 'menu')}`, { method: 'GET', token: auth.token });
    if (r.status === 200) return 'ok';
    if (r.status === 401) { forget(); return 'none'; }
  } catch { /* offline */ }
  return 'unreachable';
}

const MESSAGES = {
  'bad-username': 'Usernames are 3 to 16 characters: letters, numbers and underscores.',
  'bad-password': 'Passwords need at least 8 characters.',
  taken: 'That username is already taken.',
  reserved: 'That name is reserved. Please pick another one.',
  bad: 'Wrong username or password.',
  banned: 'This account has been suspended. Ask the admin if you think that is a mistake.',
  closed: 'New accounts are paused right now. Please try again later.',
};

// Returns { ok: true } or { ok: false, message }
async function submit(path, username, password) {
  try {
    const { status, data } = await call(path, { body: { username, password } });
    if (status === 200 && data && data.token) { auth.user = data.username; auth.token = data.token; remember(); return { ok: true }; }
    if (status === 429) {
      const mins = Math.max(1, Math.ceil(((data && data.retry) || 300) / 60));
      const what = data && data.error === 'slow-down' ? 'Too many attempts from this network' : 'Too many wrong tries';
      return { ok: false, message: `${what}. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
    }
    if (data && MESSAGES[data.error]) return { ok: false, message: MESSAGES[data.error] };
    return { ok: false, message: 'Could not reach the login server.' };
  } catch {
    return { ok: false, message: 'Could not reach the login server. Check your connection.' };
  }
}
export const register = (u, p) => submit('/api/register', u, p);
export const login = (u, p) => submit('/api/login', u, p);

export async function logout() {
  const token = auth.token;
  forget();
  auth.offline = false;
  if (token) { try { await call('/api/logout', { token }); } catch { /* the token is gone locally either way */ } }
}
