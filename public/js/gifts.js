// Gifts and announcements from the admin.
// Gifts wait on the server for the player. This applies them to the career saves in this browser (which then sync to the
// account like any other change) and tells the server they have been received.
import * as Season from './season.js';
import { auth } from './auth.js';

const SEEN = 'pph-ann-seen';       // announcements this player has dismissed
const DONE = 'pph-gifts-done';     // gifts already applied here, so a failed "received" message can never pay out twice
const ATTR_LABELS = Object.fromEntries(Season.ATTRS);
const authHeaders = () => ({ Authorization: `Bearer ${auth.token}` });

const readList = (key) => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list.slice(-200))); } catch { /* ignore */ } };

// Changes one career and returns a short line saying what it got
function applyGift(c, g) {
  switch (g.type) {
    case 'rp': c.rp = (c.rp || 0) + g.amount; return `+${g.amount.toLocaleString()} Rep Points`;
    case 'attr': {
      const keys = g.attr === 'all' ? Season.ATTRS.map(([k]) => k) : [g.attr];
      for (const k of keys) if (c.ratings && c.ratings[k] != null) c.ratings[k] = Math.max(40, Math.min(99, c.ratings[k] + g.amount));
      return `${g.attr === 'all' ? 'Every rating' : ATTR_LABELS[g.attr] || g.attr} ${g.amount > 0 ? '+' : ''}${g.amount}`;
    }
    case 'maxRatings': for (const k of Object.keys(c.ratings || {})) c.ratings[k] = 99; return 'All ratings set to 99';
    case 'unlockStyles': c.adminUnlock = true; return 'Every play style unlocked';
    case 'titles': c.titles = (c.titles || 0) + g.amount; return `+${g.amount} championship${g.amount === 1 ? '' : 's'}`;
    default: return null;
  }
}

// Collects what is waiting, applies it, and returns lines for the "you got a gift" pop-up
export async function collectGifts() {
  if (!auth.token || auth.offline) return [];
  let items;
  try {
    const r = await fetch('/api/inbox', { headers: authHeaders() });
    if (!r.ok) return [];
    items = (await r.json()).items || [];
  } catch { return []; }
  if (!Array.isArray(items) || !items.length) return [];

  const done = readList(DONE);
  const saves = [1, 2, 3].map((slot) => Season.load('career', slot)).filter((s) => s && s.career);
  const touched = new Set(), claim = [], lines = [];
  for (const g of items) {
    if (!g || typeof g.id !== 'string') continue;
    if (done.includes(g.id)) { claim.push(g.id); continue; }       // applied before: just tell the server again
    if (g.type === 'message') { lines.push({ icon: '✉️', title: 'A message from the admin', text: g.text }); done.push(g.id); claim.push(g.id); continue; }
    const targets = saves.filter((s) => !g.slot || s.slot === g.slot);
    if (!targets.length) continue;                                   // no career to give it to yet: it keeps waiting
    let what = null;
    for (const s of targets) { what = applyGift(s.career, g); touched.add(s); }
    if (what) {
      lines.push({ icon: '🎁', title: what, who: targets.map((s) => `${s.career.first} ${s.career.last}`.trim()).join(', '), text: g.note || '' });
      done.push(g.id); claim.push(g.id);
    }
  }
  writeList(DONE, done);
  touched.forEach((s) => Season.save(s));
  if (claim.length) {
    try { await fetch('/api/inbox/claim', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: claim }) }); } catch { /* it will be told again next time */ }
  }
  return lines;
}

export async function fetchAnnouncements() {
  try {
    const r = await fetch('/api/announcements');
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.items) ? d.items : [];
  } catch { return []; }   // no game server here (a plain file server), so no announcements
}
export const seenAnnouncements = () => readList(SEEN);
export function markSeen(id) { const s = readList(SEEN); if (!s.includes(id)) { s.push(id); writeList(SEEN, s); } }
