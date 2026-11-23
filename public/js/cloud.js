// Cloud save: keeps careers, seasons, kits, tactics and settings on your account so they follow you to any device.
//
// Every saved key carries the time it last changed, here and on the server, and syncing merges key by key: the newer copy of
// each key wins, so an old tab or another device can never wipe out a career it never had. Deleting is recorded too, so a
// career you delete stays deleted. Each account keeps its own data in this browser: logging in as someone else puts the
// first account's data aside and brings it back when they log in again. The server keeps the last few versions of every
// career, season and draft, which can be restored from Settings.
import { auth } from './auth.js';

const SYNC_AT = 'pph-sync-at';
const DIRTY = 'pph-dirty';   // older versions: who had changes here that the cloud had not received yet
const TIMES = 'pph-times';   // { t: {key: when it last changed}, d: {key: when it was deleted} }
const OWNER = 'pph-owner';   // which account the game data in this browser belongs to ('' = played without logging in)
const SKIP = new Set(['pph-auth', SYNC_AT, DIRTY, TIMES, OWNER]);
const STASH = (u) => `pphx:${u}`;   // another account's data, put aside in this browser (not synced: no "pph-" prefix)
let pushTimer = 0, enabled = false, lastStatus = '';
const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;   // the unpatched versions
const listeners = new Set();
export const onCloudStatus = (fn) => listeners.add(fn);
function status(s) { lastStatus = s; listeners.forEach((fn) => fn(s)); }
export const cloudStatus = () => lastStatus;

const isGameKey = (k) => typeof k === 'string' && k.startsWith('pph-') && !SKIP.has(k);
const syncedKeys = () => { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isGameKey(k)) keys.push(k); } return keys; };
const collect = () => { const o = {}; for (const k of syncedKeys()) { try { o[k] = localStorage.getItem(k); } catch { /* ignore */ } } return o; };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { rawSet.call(localStorage, k, v); } catch { /* ignore */ } };
const del = (k) => { try { rawRemove.call(localStorage, k); } catch { /* ignore */ } };
const localAt = () => Number(get(SYNC_AT)) || 0;
const headers = () => ({ Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' });
const active = () => enabled && auth.token && !auth.offline;

let times = null;
function T() {
  if (!times) { try { times = JSON.parse(get(TIMES) || 'null'); } catch { times = null; } }
  if (!times || typeof times !== 'object') times = { t: {}, d: {} };
  times.t = times.t || {}; times.d = times.d || {};
  return times;
}
const saveTimes = () => put(TIMES, JSON.stringify(T()));
function touched(k, removed) {
  const m = T(), now = Date.now();
  if (removed) { m.d[k] = now; delete m.t[k]; } else { m.t[k] = now; delete m.d[k]; }
  saveTimes();
}

// Saves worth keeping old versions of on the server
export const BACKUP_RE = /^pph-(career-\d+|season|draft)$/;

async function api(method, body, path = '/api/save') {
  const text = body ? JSON.stringify(body) : undefined;
  const r = await fetch(path, { method, headers: headers(), body: text, keepalive: !!text && text.length < 60000 });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Each account keeps its own careers in this browser. Data from another account is put aside (and comes back when that
// account logs in again); data made without logging in joins the account that logs in.
function switchOwner(user) {
  const owner = get(OWNER);
  if (owner === user) return;
  if (owner) {
    const keep = { data: collect(), times: T() };
    put(STASH(owner), JSON.stringify(keep));
    for (const k of syncedKeys()) del(k);
    times = { t: {}, d: {} };
  }
  let mine = null;
  try { mine = JSON.parse(get(STASH(user)) || 'null'); } catch { mine = null; }
  if (mine && mine.data) {
    const m = T();
    for (const [k, v] of Object.entries(mine.data)) {
      if (!isGameKey(k) || get(k) != null) continue;
      put(k, v);
      if (mine.times?.t?.[k]) m.t[k] = mine.times.t[k];
    }
    for (const [k, t] of Object.entries(mine.times?.d || {})) if (!(k in m.t)) m.d[k] = Math.max(m.d[k] || 0, t);
    del(STASH(user));
  }
  saveTimes();
  put(OWNER, user);
}

// Called after login: merge this browser's data with the account's, key by key. Returns 'applied' when anything from the
// server changed this browser's data (the page should reload so the game picks it up).
export async function cloudSync() {
  if (!auth.token || auth.offline) return 'off';
  switchOwner(auth.user);
  enabled = true;
  status('Syncing...');
  try {
    const s = await api('GET');
    const sData = s.data || {}, sTimes = s.times || {}, sDel = s.deleted || {};
    const m = T();
    // Keys from before change times were kept: unsent changes (older versions marked them) count as new, the rest as of the last sync
    const legacyLocal = get(DIRTY) === auth.user ? Date.now() : localAt();
    const local = collect();
    const bak = {};
    let changed = false;
    const keys = new Set([...Object.keys(sData), ...Object.keys(sDel), ...Object.keys(local), ...Object.keys(m.d)]);
    for (const k of keys) {
      if (!isGameKey(k)) continue;
      const sv = sData[k], lv = local[k];
      const st = sv != null ? (sTimes[k] || s.updated || 0) : 0, sd = sDel[k] || 0;
      const lt = lv != null ? (m.t[k] || legacyLocal) : 0, ld = m.d[k] || 0;
      const serverAt = Math.max(st, sd), localAt2 = Math.max(lt, ld);
      if (serverAt <= localAt2) continue;            // this browser's copy is as new or newer: it goes up with the next push
      if (sv != null && st >= sd) {
        if (lv === sv) { m.t[k] = st; continue; }
        if (lv != null && BACKUP_RE.test(k)) bak[k] = lv;   // never lose the local version: the server keeps it as a backup
        put(k, sv); m.t[k] = st; delete m.d[k]; changed = true;
      } else if (lv != null) {
        if (BACKUP_RE.test(k)) bak[k] = lv;
        del(k); m.d[k] = sd; delete m.t[k]; changed = true;
      }
    }
    saveTimes();
    del(DIRTY);
    if (changed) {
      // Stop syncing until the reload: a push racing it would loop. The backups of anything replaced go up first.
      enabled = false; clearTimeout(pushTimer);
      if (Object.keys(bak).length) { try { await api('PUT', { data: {}, times: {}, deleted: {}, updated: Date.now(), bak }); } catch { /* best effort */ } }
      put(SYNC_AT, String(Date.now()));
      status('Cloud save loaded');
      return 'applied';
    }
    await push();
    return 'ok';
  } catch { status('Cloud save unavailable'); return 'error'; }
}

let ver = 0, sentVer = 0, inflight = null;   // ver counts changes, so a change made during an upload is never forgotten
export function push() {
  if (!active()) return Promise.resolve();
  if (inflight) return inflight.then(() => (ver !== sentVer ? push() : undefined));
  inflight = (async () => {
    const v = ver;
    try {
      const updated = Date.now();
      const data = collect(), m = T(), tm = {};
      for (const k of Object.keys(data)) tm[k] = m.t[k] || localAt() || updated;
      await api('PUT', { data, times: tm, deleted: m.d, updated });
      put(SYNC_AT, String(updated)); sentVer = v;
      status(`Saved to your account at ${new Date(updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    } catch {
      status('Cloud save failed. Will retry.');
      clearTimeout(pushTimer); pushTimer = setTimeout(push, 15000);
    }
    inflight = null;
    if (ver !== sentVer && active()) { clearTimeout(pushTimer); pushTimer = setTimeout(push, 1000); }
  })();
  return inflight;
}

export function schedulePush() {
  if (!active()) return;
  ver++;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 3000);
}

// Old versions of careers, seasons and drafts kept on the server
export async function listBackups() {
  if (!auth.token || auth.offline) return null;
  try { return (await api('GET', null, '/api/save/backups')).backups || {}; } catch { return null; }
}
export function restoreBackup(key, value) {
  if (!BACKUP_RE.test(key) || typeof value !== 'string') return false;
  const cur = get(key);
  if (cur && cur !== value) { api('PUT', { data: {}, times: {}, deleted: {}, updated: Date.now(), bak: { [key]: cur } }).catch(() => {}); }
  localStorage.setItem(key, value);   // marks it as changed now, so it wins everywhere on the next sync
  return true;
}

// Any change to the game's saved data is time-stamped and schedules an upload
try {
  Storage.prototype.setItem = function (k, v) {
    // Writing the same value again is not a change: it must not make an old copy look new
    const same = this === localStorage && isGameKey(k) && this.getItem(k) === String(v);
    rawSet.call(this, k, v);
    if (this === localStorage && isGameKey(k) && !same) { touched(k, false); schedulePush(); }
  };
  Storage.prototype.removeItem = function (k) {
    const had = this === localStorage && isGameKey(k) && this.getItem(k) != null;
    rawRemove.call(this, k);
    if (had) { touched(k, true); schedulePush(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pushTimer) { clearTimeout(pushTimer); push(); } });
  window.addEventListener('pagehide', () => { if (pushTimer) { clearTimeout(pushTimer); push(); } });
} catch { /* storage patching unavailable */ }
