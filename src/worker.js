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

// ---------- Admin ----------
// The admin office lives in one reserved Durable Object. Its name starts with "~", which no username can (USERNAME_RE),
// so no player can ever be that object. Everything admin is checked here on the server; the game's pages only ask.
const ADMIN_ID = '~admin';
const ADMIN_SESSION_MS = 2 * 60 * 60 * 1000;   // an admin sign-in lasts 2 hours
const ADMIN_MAX_FAILS = 5;                      // wrong codes in a row before the admin door locks
const ADMIN_LOCK_MS = 10 * 60 * 1000;
const ONLINE_MS = 150 * 1000;                   // seen in the last 2.5 minutes counts as online (players check in every 90 s)
// The admin code is kept as a salted hash, not as text. To use a different code, set a secret named ADMIN_CODE
// (Cloudflare dashboard: Workers > your Worker > Settings > Variables and Secrets, or `npx wrangler secret put ADMIN_CODE`).
const ADMIN_SALT = '9c3b5146a974ac501756343a1ecfa811';
const ADMIN_HASH = '39a96c969962d951b5f1e558f8a66142436e894135a0b27a4a92e4f78ea6a23a';
const normCode = (c) => String(c).trim().toLowerCase().replace(/\s+/g, ' ');   // case and extra spaces don't matter
const GIFT_ATTRS = ['three', 'mid', 'inside', 'dunk', 'pass', 'handle', 'speed', 'def', 'steal', 'block', 'reb', 'all'];
const POS_NAMES = ['PG', 'SG', 'SF', 'PF', 'C'];

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
    // (only someone who knows the password learns the account is suspended)
    if (await this.ctx.storage.get('ban')) return { ok: false, error: 'banned' };
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

  // ----- Admin tools for one account (called only by the admin routes below) -----
  async adminInfo() {
    const acct = await this.ctx.storage.get('acct');
    if (!acct) return null;
    const now = Date.now();
    const sessions = (await this.ctx.storage.get('sessions')) || {};
    const saves = await this.ctx.storage.list({ prefix: 'save:' });
    const keys = {};
    const careers = [];
    let season = null;
    for (const [k, v] of saves) {
      keys[k.slice(5)] = typeof v === 'string' ? v.length : 0;
      try {
        if (/^save:pph-career-[1-3]$/.test(k)) { const c = summarizeCareer(JSON.parse(v)); if (c) careers.push(c); }
        else if (k === 'save:pph-season') season = summarizeSeason(JSON.parse(v));
      } catch { /* a save that isn't valid JSON is just skipped */ }
    }
    careers.sort((a, b) => a.slot - b.slot);
    return {
      created: acct.created || null,
      sessions: Object.values(sessions).filter((e) => e > now).length,
      ban: (await this.ctx.storage.get('ban')) || null,
      saveAt: (await this.ctx.storage.get('saveAt')) || 0,
      keys, careers, season,
      inbox: (await this.ctx.storage.get('inbox')) || [],
    };
  }

  async setBan(on, reason) {
    if (!(await this.ctx.storage.get('acct'))) return false;
    if (on) {
      await this.ctx.storage.put('ban', { at: Date.now(), reason: String(reason || '').slice(0, 200) });
      await this.ctx.storage.delete('sessions');   // signs them out everywhere
    } else await this.ctx.storage.delete('ban');
    return true;
  }

  async setPassword(password) {
    if (!(await this.ctx.storage.get('acct'))) return false;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const old = await this.ctx.storage.get('acct');
    await this.ctx.storage.put('acct', { ...old, salt: toHex(salt), hash: await hashPassword(password, salt) });
    await this.ctx.storage.delete('lock');
    await this.ctx.storage.delete('sessions');
    return true;
  }

  async revokeSessions() { await this.ctx.storage.delete('sessions'); return true; }

  async clearSave() {
    const old = await this.ctx.storage.list({ prefix: 'save:' });
    if (old.size) await this.ctx.storage.delete([...old.keys()]);
    await this.ctx.storage.delete('saveAt');
    return true;
  }

  async deleteAccount() { await this.ctx.storage.deleteAll(); return true; }

  // Gifts and messages waiting for the player. The game applies them to the player's career the next time they open it.
  async addInbox(item) {
    if (!(await this.ctx.storage.get('acct'))) return false;
    const inbox = (await this.ctx.storage.get('inbox')) || [];
    inbox.push(item);
    while (inbox.length > 50) inbox.shift();
    await this.ctx.storage.put('inbox', inbox);
    return true;
  }
  async getInbox() { return (await this.ctx.storage.get('inbox')) || []; }
  async claimInbox(ids) {
    const inbox = (await this.ctx.storage.get('inbox')) || [];
    const left = inbox.filter((i) => !ids.includes(i.id));
    if (left.length) await this.ctx.storage.put('inbox', left); else await this.ctx.storage.delete('inbox');
    return true;
  }

  // ----- The admin office: this same class also runs the one reserved "~admin" object -----
  async adminLogin(code) {
    const now = Date.now();
    const lock = (await this.ctx.storage.get('adminLock')) || { fails: 0, until: 0 };
    if (lock.until > now) return { ok: false, error: 'locked', retry: Math.ceil((lock.until - now) / 1000) };
    if (!(await checkAdminCode(this.env, code))) {
      lock.fails += 1;
      if (lock.fails >= ADMIN_MAX_FAILS) { lock.until = now + ADMIN_LOCK_MS; lock.fails = 0; }
      await this.ctx.storage.put('adminLock', lock);
      await this.audit({ a: 'admin sign-in failed' });
      return { ok: false, error: 'bad' };
    }
    if (lock.fails || lock.until) await this.ctx.storage.put('adminLock', { fails: 0, until: 0 });
    const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const sessions = (await this.ctx.storage.get('adminSessions')) || {};
    for (const [h, exp] of Object.entries(sessions)) if (exp < now) delete sessions[h];
    const keys = Object.keys(sessions);
    if (keys.length >= 5) delete sessions[keys[0]];
    sessions[await sha256(secret)] = now + ADMIN_SESSION_MS;
    await this.ctx.storage.put('adminSessions', sessions);
    await this.audit({ a: 'admin signed in' });
    return { ok: true, token: secret, expires: now + ADMIN_SESSION_MS };
  }

  async adminVerify(token) {
    const sessions = (await this.ctx.storage.get('adminSessions')) || {};
    const exp = sessions[await sha256(token)];
    return !!exp && exp > Date.now();
  }

  async adminRevokeAll() {
    await this.ctx.storage.delete('adminSessions');
    await this.audit({ a: 'all admin sign-ins ended' });
    return true;
  }

  async adminLogout(token) {
    const sessions = (await this.ctx.storage.get('adminSessions')) || {};
    delete sessions[await sha256(token)];
    await this.ctx.storage.put('adminSessions', sessions);
    await this.audit({ a: 'admin signed out' });
    return true;
  }

  // The registry of accounts the admin can see (Durable Objects can't be listed, so players check in here)
  async touch(name, activity, opts = {}) {
    const key = `u:${name}`;
    const cur = (await this.ctx.storage.get(key)) || { created: null, logins: 0, lastLogin: 0, lastSeen: 0 };
    const now = Date.now();
    cur.lastSeen = now;
    if (activity) cur.activity = String(activity).replace(/[^a-z]/g, '').slice(0, 12);
    if (opts.login) { cur.logins = (cur.logins || 0) + 1; cur.lastLogin = now; }
    if (opts.created) cur.created = opts.created;
    await this.ctx.storage.put(key, cur);
    return true;
  }
  async patchUser(name, patch) {
    const key = `u:${name}`;
    const cur = (await this.ctx.storage.get(key)) || { created: null, logins: 0, lastLogin: 0, lastSeen: 0 };
    await this.ctx.storage.put(key, { ...cur, ...patch });
    return true;
  }
  async getUserEntry(name) { return (await this.ctx.storage.get(`u:${name}`)) || null; }
  async removeUser(name) { await this.ctx.storage.delete(`u:${name}`); return true; }
  async listUsers() {
    const all = await this.ctx.storage.list({ prefix: 'u:' });
    return [...all].map(([k, v]) => ({ username: k.slice(2), ...v }));
  }

  async adminOverview() {
    const now = Date.now();
    const users = await this.listUsers();
    users.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    const day = 864e5;
    return {
      now,
      settings: await this.getSettings(),
      stats: {
        total: users.length,
        online: users.filter((u) => now - (u.lastSeen || 0) < ONLINE_MS).length,
        newToday: users.filter((u) => u.created && now - u.created < day).length,
        newWeek: users.filter((u) => u.created && now - u.created < 7 * day).length,
        suspended: users.filter((u) => u.banned).length,
      },
      users: users.map((u) => ({ ...u, online: now - (u.lastSeen || 0) < ONLINE_MS })),
      announcements: await this.activeAnnouncements(),
    };
  }

  async getSettings() { return { signups: true, ...((await this.ctx.storage.get('settings')) || {}) }; }
  async setSettings(patch) {
    const cur = await this.getSettings();
    await this.ctx.storage.put('settings', { ...cur, ...patch });
    return true;
  }

  async activeAnnouncements() {
    const now = Date.now();
    const all = (await this.ctx.storage.get('ann')) || [];
    const live = all.filter((a) => a.until > now);
    if (live.length !== all.length) await this.ctx.storage.put('ann', live);
    return live;
  }
  async addAnnouncement(text, hours) {
    const live = await this.activeAnnouncements();
    const now = Date.now();
    live.push({ id: toHex(crypto.getRandomValues(new Uint8Array(4))), text, at: now, until: now + hours * 36e5 });
    while (live.length > 10) live.shift();
    await this.ctx.storage.put('ann', live);
    return true;
  }
  async removeAnnouncement(id) {
    const live = await this.activeAnnouncements();
    await this.ctx.storage.put('ann', live.filter((a) => a.id !== id));
    return true;
  }

  async audit(entry) {
    const log = (await this.ctx.storage.get('audit')) || [];
    log.push({ t: Date.now(), ...entry });
    if (log.length > 300) log.splice(0, log.length - 300);
    await this.ctx.storage.put('audit', log);
    return true;
  }
  async getAudit() { return ((await this.ctx.storage.get('audit')) || []).slice().reverse(); }

  async verify(secret) {
    if (await this.ctx.storage.get('ban')) return false;
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

async function handleAccount(request, env, path, ctx) {
  if (path === '/api/me' && request.method === 'GET') {
    const user = await authenticate(env, bearer(request));
    if (!user) return json({ error: 'not-logged-in' }, 401);
    // Players check in every minute or two: that is how the admin sees who is online and what they are doing
    ctx.waitUntil(adminStub(env).touch(user, new URL(request.url).searchParams.get('a')).catch(() => {}));
    return json({ username: user });
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
    if (!(await adminStub(env).getSettings()).signups) return json({ error: 'closed' }, 403);
    const r = await userStub(env, username).register(username, password);
    if (!r.ok) return json({ error: 'taken' }, 409);
    ctx.waitUntil(adminStub(env).touch(username, 'menu', { login: true, created: Date.now() }).catch(() => {}));
    return json({ username, token: r.token });
  }
  if (path === '/api/login') {
    const r = await userStub(env, username).login(username, password);
    if (r.ok) {
      ctx.waitUntil(adminStub(env).touch(username, 'menu', { login: true }).catch(() => {}));
      return json({ username, token: r.token });
    }
    if (r.error === 'banned') return json({ error: 'banned' }, 403);
    return r.error === 'locked' ? json({ error: 'locked', retry: r.retry }, 429) : json({ error: 'bad' }, 401);
  }
  return json({ error: 'not-found' }, 404);
}

// ---------- Admin helpers and routes ----------
async function checkAdminCode(env, code) {
  if (typeof code !== 'string' || !code.trim() || code.length > 100) return false;
  const salt = fromHex(ADMIN_SALT);
  const given = await hashPassword(normCode(code), salt);
  const custom = typeof env.ADMIN_CODE === 'string' && env.ADMIN_CODE.trim();
  const want = custom ? await hashPassword(normCode(env.ADMIN_CODE), salt) : ADMIN_HASH;
  return safeEqual(given, want);
}

const adminStub = (env) => env.USERS.get(env.USERS.idFromName(ADMIN_ID));

// The same score the game shows: the average of the eleven ratings, plus 6
function careerOvr(ratings) {
  const v = Object.values(ratings || {}).filter((n) => typeof n === 'number');
  return v.length ? Math.max(40, Math.min(99, Math.round(v.reduce((a, b) => a + b, 0) / v.length + 6))) : 0;
}
// Saves are written by the players' own browsers, so nothing in them is trusted: the admin page only ever receives
// plain numbers and short plain strings built here.
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-1e9, Math.min(1e9, n)) : 0; };
const toText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, max) : '');
const RATING_KEYS = ['three', 'mid', 'inside', 'dunk', 'pass', 'handle', 'speed', 'def', 'steal', 'block', 'reb'];
function summarizeCareer(s) {
  const c = s && s.career;
  if (!c || typeof c !== 'object') return null;
  const ratings = {};
  for (const k of RATING_KEYS) ratings[k] = c.ratings ? toNum(c.ratings[k]) : 0;
  return {
    slot: Math.max(1, Math.min(3, toNum(s.slot) || 1)),
    name: `${toText(c.first, 20)} ${toText(c.last, 20)}`.trim(),
    pos: POS_NAMES[toNum(c.pos)] || '?',
    archetype: toText(c.archetype, 24),
    ovr: careerOvr(ratings),
    ratings,
    rp: toNum(c.rp), games: toNum(c.games), titles: toNum(c.titles), upgrades: toNum(c.upgrades),
    team: toNum(s.team), year: toNum(s.year) || 1,
    adminUnlock: c.adminUnlock === true,
  };
}
function summarizeSeason(s) {
  if (!s || typeof s !== 'object') return null;
  const team = toNum(s.team);
  let w = 0, l = 0;
  for (const round of Array.isArray(s.schedule) ? s.schedule : []) for (const g of Array.isArray(round) ? round : []) {
    if (!g || g.hs == null || (g.h !== team && g.a !== team)) continue;
    const mine = g.h === team ? g.hs : g.as, theirs = g.h === team ? g.as : g.hs;
    if (mine > theirs) w++; else l++;
  }
  return { team, year: toNum(s.year) || 1, wins: w, losses: l, champion: !!(s.playoffs && s.playoffs.champion === team) };
}

// Checks and tidies a gift before it is stored (the admin page is not trusted: everything is validated here)
function cleanGift(g) {
  if (!g || typeof g !== 'object') return null;
  const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  const base = {
    id: toHex(crypto.getRandomValues(new Uint8Array(4))), at: Date.now(),
    note: typeof g.note === 'string' ? g.note.trim().slice(0, 200) : '',
    slot: [1, 2, 3].includes(Number(g.slot)) ? Number(g.slot) : 0,
  };
  switch (g.type) {
    case 'rp': { const n = int(g.amount, 1, 100000); return n === null ? null : { ...base, type: 'rp', amount: n }; }
    case 'attr': {
      const n = int(g.amount, -50, 50);
      return n === null || n === 0 || !GIFT_ATTRS.includes(g.attr) ? null : { ...base, type: 'attr', attr: g.attr, amount: n };
    }
    case 'titles': { const n = int(g.amount, 1, 50); return n === null ? null : { ...base, type: 'titles', amount: n }; }
    case 'maxRatings': return { ...base, type: 'maxRatings' };
    case 'unlockStyles': return { ...base, type: 'unlockStyles' };
    case 'message': {
      const text = typeof g.text === 'string' ? g.text.trim().slice(0, 400) : '';
      return text ? { ...base, type: 'message', text, slot: 0 } : null;
    }
    default: return null;
  }
}
const describeGift = (g) => ({ rp: `+${g.amount} Rep Points`, attr: `${g.attr === 'all' ? 'every rating' : g.attr} ${g.amount > 0 ? '+' : ''}${g.amount}`, titles: `+${g.amount} championship(s)`, message: 'message', maxRatings: 'all ratings to 99', unlockStyles: 'unlock all play styles' })[g.type] || g.type;

async function handleAdmin(request, env, path) {
  const admin = adminStub(env);
  const url = new URL(request.url);
  if (path === '/api/admin/login') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const body = await readJson(request);
    const r = await admin.adminLogin(body && typeof body.code === 'string' ? body.code : '');
    if (r.ok) return json({ token: r.token, expires: r.expires });
    return r.error === 'locked' ? json({ error: 'locked', retry: r.retry }, 429) : json({ error: 'bad' }, 401);
  }
  // Everything below needs a valid admin sign-in
  const token = request.headers.get('X-Admin-Token') || '';
  if (!/^[0-9a-f]{64}$/.test(token) || !(await admin.adminVerify(token))) return json({ error: 'not-admin' }, 401);
  const post = request.method === 'POST';

  if (path === '/api/admin/overview' && request.method === 'GET') return json(await admin.adminOverview());
  if (path === '/api/admin/audit' && request.method === 'GET') return json({ items: await admin.getAudit() });
  if (path === '/api/admin/user' && request.method === 'GET') {
    const name = (url.searchParams.get('u') || '').toLowerCase();
    if (!USERNAME_RE.test(name)) return json({ error: 'bad-username' }, 400);
    const info = await userStub(env, name).adminInfo();
    if (!info) return json({ error: 'not-found' }, 404);
    return json({ username: name, ...info, entry: await admin.getUserEntry(name) });
  }
  if (path === '/api/admin/logout' && post) { await admin.adminLogout(token); return json({ ok: true }); }
  if (!post) return json({ error: 'method' }, 405);

  const body = (await readJson(request, 6000)) || {};
  const name = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const needUser = () => USERNAME_RE.test(name);

  if (path === '/api/admin/gift') {
    const gift = cleanGift(body.gift);
    if (!gift) return json({ error: 'bad-gift' }, 400);
    if (name === '*') {
      const users = (await admin.listUsers()).slice(0, 2000);
      let sent = 0;
      for (let i = 0; i < users.length; i += 25) {
        const batch = await Promise.all(users.slice(i, i + 25).map((u) => userStub(env, u.username).addInbox({ ...gift, id: toHex(crypto.getRandomValues(new Uint8Array(4))) })));
        sent += batch.filter(Boolean).length;
      }
      await admin.audit({ a: 'gift to everyone', target: '*', detail: `${describeGift(gift)}${gift.slot ? ` (slot ${gift.slot})` : ''} sent to ${sent}` });
      return json({ ok: true, sent });
    }
    if (!needUser()) return json({ error: 'bad-username' }, 400);
    if (!(await userStub(env, name).addInbox(gift))) return json({ error: 'not-found' }, 404);
    await admin.audit({ a: 'gift', target: name, detail: `${describeGift(gift)}${gift.slot ? ` (slot ${gift.slot})` : ''}` });
    return json({ ok: true, sent: 1 });
  }
  if (path === '/api/admin/ban') {
    if (!needUser()) return json({ error: 'bad-username' }, 400);
    const on = !!body.on;
    if (!(await userStub(env, name).setBan(on, body.reason))) return json({ error: 'not-found' }, 404);
    await admin.patchUser(name, { banned: on });
    await admin.audit({ a: on ? 'suspended' : 'unsuspended', target: name, detail: on ? String(body.reason || '').slice(0, 120) : '' });
    return json({ ok: true });
  }
  if (path === '/api/admin/password') {
    if (!needUser()) return json({ error: 'bad-username' }, 400);
    const pw = typeof body.password === 'string' ? body.password : '';
    if (pw.length < 8 || pw.length > 128) return json({ error: 'bad-password' }, 400);
    if (!(await userStub(env, name).setPassword(pw))) return json({ error: 'not-found' }, 404);
    await admin.audit({ a: 'password reset', target: name });
    return json({ ok: true });
  }
  if (path === '/api/admin/signout-user') {
    if (!needUser()) return json({ error: 'bad-username' }, 400);
    await userStub(env, name).revokeSessions();
    await admin.audit({ a: 'signed out everywhere', target: name });
    return json({ ok: true });
  }
  if (path === '/api/admin/clear-save') {
    if (!needUser()) return json({ error: 'bad-username' }, 400);
    await userStub(env, name).clearSave();
    await admin.audit({ a: 'cloud save cleared', target: name });
    return json({ ok: true });
  }
  if (path === '/api/admin/delete') {
    if (!needUser() || body.confirm !== name) return json({ error: 'bad-username' }, 400);
    await userStub(env, name).deleteAccount();
    await admin.removeUser(name);
    await admin.audit({ a: 'account deleted', target: name });
    return json({ ok: true });
  }
  if (path === '/api/admin/revoke-admins') {
    await admin.adminRevokeAll();
    return json({ ok: true });
  }
  if (path === '/api/admin/settings') {
    if (typeof body.signups !== 'boolean') return json({ error: 'bad' }, 400);
    await admin.setSettings({ signups: body.signups });
    await admin.audit({ a: body.signups ? 'new sign-ups opened' : 'new sign-ups paused' });
    return json({ ok: true });
  }
  if (path === '/api/admin/announce') {
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : '';
    const hours = Math.round(Number(body.hours));
    if (!text || !Number.isFinite(hours) || hours < 1 || hours > 720) return json({ error: 'bad' }, 400);
    await admin.addAnnouncement(text, hours);
    await admin.audit({ a: 'announcement posted', detail: text.slice(0, 80) });
    return json({ ok: true });
  }
  if (path === '/api/admin/announce/remove') {
    if (typeof body.id !== 'string' || !/^[0-9a-f]{8}$/.test(body.id)) return json({ error: 'bad' }, 400);
    await admin.removeAnnouncement(body.id);
    await admin.audit({ a: 'announcement removed' });
    return json({ ok: true });
  }
  return json({ error: 'not-found' }, 404);
}

// What a player's game asks for: waiting gifts and the current announcements
async function handleInbox(request, env, path) {
  const user = await authenticate(env, bearer(request));
  if (!user) return json({ error: 'not-logged-in' }, 401);
  const stub = userStub(env, user);
  if (path === '/api/inbox' && request.method === 'GET') return json({ items: await stub.getInbox() });
  if (path === '/api/inbox/claim' && request.method === 'POST') {
    const body = await readJson(request);
    const ids = body && Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && /^[0-9a-f]{8}$/.test(x)).slice(0, 50) : [];
    await stub.claimInbox(ids);
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
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
  async fetch(request, env, ctx) {
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
    if (path === '/api/me' || path === '/api/register' || path === '/api/login' || path === '/api/logout') return handleAccount(request, env, path, ctx);
    if (path.startsWith('/api/admin/')) return handleAdmin(request, env, path);
    if (path === '/api/inbox' || path === '/api/inbox/claim') return handleInbox(request, env, path);
    if (path === '/api/announcements' && request.method === 'GET') return json({ items: await adminStub(env).activeAnnouncements() });
    if (path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
