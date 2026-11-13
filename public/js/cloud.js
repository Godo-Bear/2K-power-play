// Cloud save: keeps careers, seasons, kits, tactics and settings on your account so they follow you to any device.
import { auth } from './auth.js';

const SYNC_AT = 'pph-sync-at';
const SKIP = new Set(['pph-auth', SYNC_AT]);
let pushTimer = 0, pushing = false, enabled = false, lastStatus = '';
const rawSet = Storage.prototype.setItem;   // the unpatched setItem
const listeners = new Set();
export const onCloudStatus = (fn) => listeners.add(fn);
function status(s) { lastStatus = s; listeners.forEach((fn) => fn(s)); }
export const cloudStatus = () => lastStatus;

const syncedKeys = () => { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('pph-') && !SKIP.has(k)) keys.push(k); } return keys; };
const collect = () => { const o = {}; for (const k of syncedKeys()) { try { o[k] = localStorage.getItem(k); } catch { /* ignore */ } } return o; };
const localAt = () => { try { return Number(localStorage.getItem(SYNC_AT)) || 0; } catch { return 0; } };
const setAt = (t) => { try { localStorage.setItem(SYNC_AT, String(t)); } catch { /* ignore */ } };
const headers = () => ({ Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' });
const active = () => enabled && auth.token && !auth.offline;

async function api(method, body) {
  const r = await fetch('/api/save', { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, keepalive: !!body && JSON.stringify(body).length < 60000 });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Called after login: take the newer copy. Returns 'applied' when the server's copy replaced this browser's (the page should reload).
export async function cloudSync() {
  if (!auth.token || auth.offline) return 'off';
  enabled = true;
  status('Syncing...');
  try {
    const s = await api('GET');
    const hasServer = Object.keys(s.data || {}).length > 0;
    const mine = localAt(), hasLocal = syncedKeys().length > 0;
    if (hasServer && (s.updated > mine || !hasLocal)) {
      // Write straight to storage and stop syncing: the page reloads next, and a push racing that reload would loop
      enabled = false; clearTimeout(pushTimer);
      for (const [k, v] of Object.entries(s.data)) { try { rawSet.call(localStorage, k, v); } catch { /* ignore */ } }
      rawSet.call(localStorage, SYNC_AT, String(s.updated));
      status('Cloud save loaded');
      return 'applied';
    }
    if (hasLocal) await push();
    else status('Cloud save ready');
    return 'ok';
  } catch { status('Cloud save unavailable'); return 'error'; }
}

export async function push() {
  if (!active() || pushing) return;
  pushing = true;
  try {
    const updated = Date.now();
    await api('PUT', { data: collect(), updated });
    setAt(updated);
    status(`Saved to your account at ${new Date(updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  } catch { status('Cloud save failed. Will retry.'); }
  pushing = false;
}

export function schedulePush() {
  if (!active()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 4000);
}

// Any change to the game's saved data schedules an upload
try {
  const origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === localStorage && typeof k === 'string' && k.startsWith('pph-') && !SKIP.has(k)) schedulePush(); };
  Storage.prototype.removeItem = function (k) { origRemove.call(this, k); if (this === localStorage && typeof k === 'string' && k.startsWith('pph-') && !SKIP.has(k)) schedulePush(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pushTimer) { clearTimeout(pushTimer); push(); } });
} catch { /* storage patching unavailable */ }
