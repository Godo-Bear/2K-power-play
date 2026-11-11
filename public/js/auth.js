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

const MESSAGES = {
  'bad-username': 'Usernames are 3 to 16 characters: letters, numbers and underscores.',
  'bad-password': 'Passwords need at least 8 characters.',
  taken: 'That username is already taken.',
  bad: 'Wrong username or password.',
};

// Returns { ok: true } or { ok: false, message }
async function submit(path, username, password) {
  try {
    const { status, data } = await call(path, { body: { username, password } });
    if (status === 200 && data && data.token) { auth.user = data.username; auth.token = data.token; remember(); return { ok: true }; }
    if (status === 429) {
      const mins = Math.max(1, Math.ceil(((data && data.retry) || 300) / 60));
      return { ok: false, message: `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
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
