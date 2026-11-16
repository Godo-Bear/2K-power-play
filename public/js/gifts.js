// Gifts and announcements from the admin.
// Gifts wait on the server for the player. This applies them to the career saves in this browser (which then sync to the
// account like any other change) and tells the server they have been received.
import * as Season from './season.js';
import { auth } from './auth.js';
import { resetTrophies, takeTrophy } from './trophies.js';

const SEEN = 'pph-ann-seen';       // announcements this player has dismissed
const DONE = 'pph-gifts-done';     // gifts already applied here, so a failed "received" message can never pay out twice
const ATTR_LABELS = Object.fromEntries(Season.ATTRS);
const TAKES = new Set(['takeRp', 'takeTitles', 'lockStyles']);
const authHeaders = () => ({ Authorization: `Bearer ${auth.token}` });

const readList = (key) => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list.slice(-200))); } catch { /* ignore */ } };

// Changes one career and returns a short line saying what it got
function applyGift(c, g, s) {
  switch (g.type) {
    case 'rp': c.rp = (c.rp || 0) + g.amount; return `+${g.amount.toLocaleString()} Rep Points`;
    case 'attr': {
      const keys = g.attr === 'all' ? Season.ATTRS.map(([k]) => k) : [g.attr];
      for (const k of keys) if (c.ratings && c.ratings[k] != null) c.ratings[k] = Math.max(40, Math.min(99, c.ratings[k] + g.amount));
      return `${g.attr === 'all' ? 'Every rating' : ATTR_LABELS[g.attr] || g.attr} ${g.amount > 0 ? '+' : '−'}${Math.abs(g.amount)}`;
    }
    case 'maxRatings': for (const k of Object.keys(c.ratings || {})) c.ratings[k] = 99; return 'All ratings set to 99';
    case 'unlockStyles': c.adminUnlock = true; return 'Every play style unlocked';
    case 'heal': if (s) s.health = {}; return 'Injuries healed and everyone rested';
    case 'titles': c.titles = (c.titles || 0) + g.amount; return `+${g.amount} championship${g.amount === 1 ? '' : 's'}`;
    // Taking things away: never below the floor (0 Rep Points, 0 championships; ratings are kept at 40 or more above)
    case 'takeRp': c.rp = Math.max(0, (c.rp || 0) - g.amount); return `−${g.amount.toLocaleString()} Rep Points`;
    case 'takeTitles': c.titles = Math.max(0, (c.titles || 0) - g.amount); return `−${g.amount} championship${g.amount === 1 ? '' : 's'}`;
    case 'lockStyles':
      c.adminUnlock = false;
      c.styles = (c.styles || []).filter((k) => Season.ARCHETYPES[k] && Season.styleUnlocked(Season.careerOvr(c), k, c));   // equipped styles they no longer qualify for come off
      return 'Play styles locked again (only the ones your rating unlocks)';
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
    // Things that are not about one career's numbers
    if (g.type === 'resetTrophies') { resetTrophies(); lines.push({ icon: '🔻', title: 'Your Trophy Room was reset', text: g.note || '' }); done.push(g.id); claim.push(g.id); continue; }
    if (g.type === 'takeTrophy') { const nm = takeTrophy(g.trophy); lines.push({ icon: '🔻', title: `Trophy removed${nm ? `: ${nm}` : ''}`, text: g.note || '' }); done.push(g.id); claim.push(g.id); continue; }
    if (g.type === 'deleteCareer') {
      const victim = saves.find((x) => x.slot === g.slot);
      if (victim) {
        Season.clear('career', g.slot);
        saves.splice(saves.indexOf(victim), 1); touched.delete(victim);
        lines.push({ icon: '🔻', title: `Your career in slot ${g.slot} was removed`, who: `${victim.career.first} ${victim.career.last}`.trim(), text: g.note || '' });
      }
      done.push(g.id); claim.push(g.id); continue;                    // nothing in that slot: nothing to remove, and it does not wait
    }
    const taking = TAKES.has(g.type) || (g.type === 'attr' && g.amount < 0);
    const targets = saves.filter((s) => !g.slot || s.slot === g.slot);
    if (!targets.length) {
      if (taking) { done.push(g.id); claim.push(g.id); }            // taking from a career they do not have: nothing to take, and it must not hit a future career
      continue;                                                      // a gift with no career to go to yet keeps waiting
    }
    let what = null;
    for (const s of targets) { what = applyGift(s.career, g, s); touched.add(s); }
    if (g.type === 'heal' && !g.slot) { const ss = Season.load('season'); if (ss) { ss.health = {}; Season.save(ss); } }   // the season team too
    if (what) {
      lines.push({ icon: taking ? '🔻' : '🎁', title: what, who: targets.map((s) => `${s.career.first} ${s.career.last}`.trim()).join(', '), text: g.note || '' });
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
