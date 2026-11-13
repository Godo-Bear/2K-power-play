// Cloudflare Worker for 2K Power Play.
// - Serves the game (static files in /public)
// - Accounts: /api/register, /api/login, /api/logout, /api/me (one Durable Object per username)
// - Hosts online rooms: /api/room/<CODE>?role=host|guest&token=... is a WebSocket that relays
//   messages between the two players in that room (one Durable Object per room code). Needs a login.
import { DurableObject } from 'cloudflare:workers';

const MAX_MESSAGE_BYTES = 32 * 1024;
const sys = (ev, extra = {}) => JSON.stringify({ k: 'sys', ev, ...extra });

// ---------- Accounts ----------
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const SESSION_DAYS = 30;
const MAX_SESSIONS = 8;           // devices signed in at once
const MAX_FAILS = 5;              // wrong passwords in a row before the account is locked for a while
const LOCK_MS = 5 * 60 * 1000;
const PBKDF2_ITERATIONS = 100000; // the most Workers allow

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const sha256 = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class User extends DurableObject {
  async newSession(username) {
    const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const now = Date.now();
    const sessions = (await this.ctx.storage.get('sessions')) || {};
    for (const [h, exp] of Object.entries(sessions)) if (exp < now) delete sessions[h];
    const keys = Object.keys(sessions);
    if (keys.length >= MAX_SESSIONS) delete sessions[keys[0]];
    sessions[await sha256(secret)] = now + SESSION_DAYS * 864e5;
    await this.ctx.storage.put('sessions', sessions);
    return `${username}.${secret}`;
  }

  async register(username, password) {
    if (await this.ctx.storage.get('acct')) return { ok: false, error: 'taken' };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await this.ctx.storage.put('acct', { salt: toHex(salt), hash: await hashPassword(password, salt), created: Date.now() });
    return { ok: true, token: await this.newSession(username) };
  }

  async login(username, password) {
    const acct = await this.ctx.storage.get('acct');
    const lock = (await this.ctx.storage.get('lock')) || { fails: 0, until: 0 };
    if (lock.until > Date.now()) return { ok: false, error: 'locked', retry: Math.ceil((lock.until - Date.now()) / 1000) };
    // Do the same hashing work whether or not the account exists, so timing doesn't reveal which usernames exist
    const hash = await hashPassword(password, acct ? fromHex(acct.salt) : new Uint8Array(16));
    if (!acct || !safeEqual(hash, acct.hash)) {
      if (acct) { // nothing is stored for usernames that don't exist
        lock.fails += 1;
        if (lock.fails >= MAX_FAILS) { lock.until = Date.now() + LOCK_MS; lock.fails = 0; }
        await this.ctx.storage.put('lock', lock);
      }
      return { ok: false, error: 'bad' };
    }
    if (lock.fails || lock.until) await this.ctx.storage.put('lock', { fails: 0, until: 0 });
    return { ok: true, token: await this.newSession(username) };
  }

  // Cloud save: the game's browser storage (career, season, kits, tactics, settings), one entry per key
  async getSave() {
    const all = await this.ctx.storage.list({ prefix: 'save:' });
    const data = {};
    for (const [k, v] of all) data[k.slice(5)] = v;
    return { data, updated: (await this.ctx.storage.get('saveAt')) || 0 };
  }

  async putSave(data, updated) {
    const old = await this.ctx.storage.list({ prefix: 'save:' });
    const drop = [...old.keys()].filter((k) => !(k.slice(5) in data));
    if (drop.length) await this.ctx.storage.delete(drop);
    const entries = {};
    for (const [k, v] of Object.entries(data)) entries[`save:${k}`] = v;
    if (Object.keys(entries).length) await this.ctx.storage.put(entries);
    await this.ctx.storage.put('saveAt', updated);
    return true;
  }

  async verify(secret) {
    const sessions = (await this.ctx.storage.get('sessions')) || {};
    const exp = sessions[await sha256(secret)];
    return !!exp && exp > Date.now();
  }

  async logout(secret) {
    const sessions = (await this.ctx.storage.get('sessions')) || {};
    delete sessions[await sha256(secret)];
    await this.ctx.storage.put('sessions', sessions);
    return true;
  }
}

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });
const userStub = (env, name) => env.USERS.get(env.USERS.idFromName(name));

async function readJson(request, max = 2000) {
  try {
    const text = await request.text();
    if (text.length > max) return null;
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

// Splits a "username.secret" token and checks it against that user's sessions. Returns the username, or null.
async function authenticate(env, raw) {
  if (typeof raw !== 'string') return null;
  const dot = raw.indexOf('.');
  if (dot < 3) return null;
  const name = raw.slice(0, dot), secret = raw.slice(dot + 1);
  if (!USERNAME_RE.test(name) || !/^[0-9a-f]{64}$/.test(secret)) return null;
  return (await userStub(env, name).verify(secret)) ? name : null;
}
const bearer = (request) => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

const SAVE_KEY_RE = /^pph-[a-z0-9_-]{1,40}$/i;
async function handleSave(request, env) {
  const user = await authenticate(env, bearer(request));
  if (!user) return json({ error: 'not-logged-in' }, 401);
  const stub = userStub(env, user);
  if (request.method === 'GET') return json(await stub.getSave());
  if (request.method !== 'PUT') return json({ error: 'method' }, 405);
  const body = await readJson(request, 1_000_000);
  const data = body && body.data && typeof body.data === 'object' ? body.data : null;
  if (!data) return json({ error: 'bad' }, 400);
  const keys = Object.keys(data);
  if (keys.length > 40 || keys.some((k) => !SAVE_KEY_RE.test(k) || k === 'pph-auth' || typeof data[k] !== 'string' || data[k].length > 120000)) return json({ error: 'bad' }, 400);
  const updated = Number.isFinite(body.updated) ? body.updated : Date.now();
  await stub.putSave(data, updated);
  return json({ ok: true, updated });
}

async function handleAccount(request, env, path) {
  if (path === '/api/me' && request.method === 'GET') {
    const user = await authenticate(env, bearer(request));
    return user ? json({ username: user }) : json({ error: 'not-logged-in' }, 401);
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  if (path === '/api/logout') {
    const raw = bearer(request), user = await authenticate(env, raw);
    if (user) await userStub(env, user).logout(raw.slice(raw.indexOf('.') + 1));
    return json({ ok: true });
  }

  const body = await readJson(request);
  const username = body && typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!USERNAME_RE.test(username)) return json({ error: 'bad-username' }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: 'bad-password' }, 400);

  if (path === '/api/register') {
    const r = await userStub(env, username).register(username, password);
    return r.ok ? json({ username, token: r.token }) : json({ error: 'taken' }, 409);
  }
  if (path === '/api/login') {
    const r = await userStub(env, username).login(username, password);
    if (r.ok) return json({ username, token: r.token });
    return r.error === 'locked' ? json({ error: 'locked', retry: r.retry }, 429) : json({ error: 'bad' }, 401);
  }
  return json({ error: 'not-found' }, 404);
}

// ---------- Online rooms ----------
export class Room extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const role = new URL(request.url).searchParams.get('role');
    const hosts = this.ctx.getWebSockets('host');
    const guests = this.ctx.getWebSockets('guest');

    let error = null;
    if (role !== 'host' && role !== 'guest') error = 'bad-role';
    else if (role === 'host' && hosts.length) error = 'code-taken';
    else if (role === 'guest' && !hosts.length) error = 'not-found';
    else if (role === 'guest' && guests.length) error = 'full';

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server, [error ? 'rejected' : role]);
    if (error) {
      server.send(sys('error', { code: error }));
      server.close(4001, error);
    } else {
      server.send(sys('joined', { role, peer: role === 'host' ? guests.length > 0 : true }));
      if (role === 'guest') for (const h of hosts) h.send(sys('peer-joined'));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  others(ws) {
    const [role] = this.ctx.getTags(ws);
    if (role !== 'host' && role !== 'guest') return [];
    return this.ctx.getWebSockets(role === 'host' ? 'guest' : 'host');
  }

  webSocketMessage(ws, message) {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_MESSAGE_BYTES) return;
    for (const peer of this.others(ws)) {
      try { peer.send(message); } catch { /* peer is gone */ }
    }
  }

  leave(ws) {
    const [role] = this.ctx.getTags(ws);
    for (const peer of this.others(ws)) {
      try {
        peer.send(sys('peer-left'));
        if (role === 'host') peer.close(4002, 'host-left'); // the room ends when the host leaves
      } catch { /* already closed */ }
    }
  }

  webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  webSocketError(ws) { this.leave(ws); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const room = path.match(/^\/api\/room\/([A-Z0-9]{4,8})$/);
    if (room) {
      // Online rooms need a signed-in player
      const user = await authenticate(env, url.searchParams.get('token'));
      if (!user) return new Response('Please log in', { status: 401 });
      return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(request);
    }
    if (path === '/api/ping') return json({ ok: true });
    if (path === '/api/save') return handleSave(request, env);
    if (path === '/api/me' || path === '/api/register' || path === '/api/login' || path === '/api/logout') return handleAccount(request, env, path);
    if (path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
