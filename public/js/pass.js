// The Power Pass: every finished game earns XP and coins. Levels unlock rewards: coins, ball skins, shoe colourways,
// profile titles and card frames. Coins can also unlock a reward early. Everything is saved under 'pph-pass', so it
// follows the account through the cloud save like careers do.

const KEY = 'pph-pass';
export const MAX_LEVEL = 30;
// XP to go from level l to l+1
export const needFor = (l) => 200 + 20 * (l - 1);

export const BALLS = {
  classic: { name: 'Classic', tint: null },
  street: { name: 'Street Black', tint: '#4a4f5c', glow: 0 },
  ice: { name: 'Ice', tint: '#9fd6f4', glow: 0.05, glowColor: '#7fdcff' },
  royal: { name: 'Royal', tint: '#7d86ff', glow: 0.04, glowColor: '#5b63ff' },
  neon: { name: 'Neon', tint: '#9dff6a', glow: 0.12, glowColor: '#7dff3d' },
  lava: { name: 'Lava', tint: '#ff5a2a', glow: 0.3, glowColor: '#ff3a10' },
  gold: { name: 'Gold', tint: '#ffd35a', glow: 0.08, glowColor: '#ffb000' },
  legend: { name: 'Legend', tint: '#fff4dc', glow: 0.1, glowColor: '#ffd98a' },
};
export const SHOES = {
  none: { name: 'Team shoes', c: null },
  ice: { name: 'Ice Runner', c: ['#e8f6ff', '#35f0ff'] },
  volcano: { name: 'Volcano', c: ['#ff4a1a', '#1a1a1a'] },
  midnight: { name: 'Midnight', c: ['#1b1f3a', '#ffd60a'] },
  toxic: { name: 'Toxic', c: ['#9dff3d', '#111111'] },
  royalgold: { name: 'Royal Gold', c: ['#5b2bd1', '#d4af37'] },
};
export const FRAMES = {
  basic: { name: 'Basic', css: 'linear-gradient(135deg,#3a4664,#1b2234)' },
  teal: { name: 'Teal', css: 'linear-gradient(135deg,#35f0ff,#1d6fff)' },
  magenta: { name: 'Magenta', css: 'linear-gradient(135deg,#ff2e88,#7a2bff)' },
  gold: { name: 'Gold', css: 'linear-gradient(135deg,#ffe08a,#c58a12)' },
  fire: { name: 'Fire', css: 'linear-gradient(135deg,#ffd60a,#ff5a10,#ff2e55)', anim: true },
  diamond: { name: 'Diamond', css: 'linear-gradient(135deg,#ffffff,#9fe8ff,#c7b8ff,#ffffff)', anim: true },
  galaxy: { name: 'Galaxy', css: 'linear-gradient(135deg,#ff2e88,#5b2bd1,#35f0ff,#ff2e88)', anim: true },
};
export const TITLES = {
  rookie: 'Rookie', bucket: 'Bucket Getter', sniper: 'Sharpshooter', glass: 'Glass Cleaner',
  poster: 'Posterizer', clutch: 'Clutch Gene', legend: 'Power Play Legend',
};

// What each level gives
export const TRACK = [
  null, null,
  { type: 'coins', amount: 100 },
  { type: 'ball', id: 'street' },
  { type: 'frame', id: 'teal' },
  { type: 'shoes', id: 'ice' },
  { type: 'coins', amount: 150 },
  { type: 'title', id: 'bucket' },
  { type: 'ball', id: 'ice' },
  { type: 'frame', id: 'magenta' },
  { type: 'shoes', id: 'volcano' },
  { type: 'coins', amount: 200 },
  { type: 'title', id: 'sniper' },
  { type: 'ball', id: 'royal' },
  { type: 'frame', id: 'gold' },
  { type: 'shoes', id: 'midnight' },
  { type: 'coins', amount: 250 },
  { type: 'title', id: 'glass' },
  { type: 'ball', id: 'neon' },
  { type: 'frame', id: 'fire' },
  { type: 'shoes', id: 'toxic' },
  { type: 'coins', amount: 300 },
  { type: 'title', id: 'poster' },
  { type: 'ball', id: 'lava' },
  { type: 'frame', id: 'diamond' },
  { type: 'shoes', id: 'royalgold' },
  { type: 'coins', amount: 400 },
  { type: 'title', id: 'clutch' },
  { type: 'ball', id: 'gold' },
  { type: 'frame', id: 'galaxy' },
  { type: 'ball', id: 'legend', title: 'legend' },
];
export const priceOf = (level) => 120 + 30 * level;

export function rewardName(r) {
  if (!r) return '';
  if (r.type === 'coins') return `${r.amount} coins`;
  if (r.type === 'ball') return `${BALLS[r.id].name} ball`;
  if (r.type === 'shoes') return `${SHOES[r.id].name} shoes`;
  if (r.type === 'frame') return `${FRAMES[r.id].name} card frame`;
  if (r.type === 'title') return `“${TITLES[r.id]}” title`;
  return '';
}
export const rewardIcon = (r) => (!r ? '' : { coins: '🪙', ball: '🏀', shoes: '👟', frame: '🖼️', title: '🏷️' }[r.type]);

function blank() { return { xp: 0, coins: 0, bought: [], paid: [], eq: { ball: 'classic', shoes: 'none', frame: 'basic', title: 'rookie' }, day: '', seenXp: 0, games: 0 }; }
export function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  const b = blank();
  if (!s || typeof s !== 'object') return b;
  return { ...b, ...s, eq: { ...b.eq, ...(s.eq || {}) }, bought: Array.isArray(s.bought) ? s.bought : [], paid: Array.isArray(s.paid) ? s.paid : [] };
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ } }

// Level from total XP: { level, into (XP into this level), need (XP for the next level), frac }
export function levelOf(xp) {
  let l = 1, left = Math.max(0, xp | 0);
  while (l < MAX_LEVEL && left >= needFor(l)) { left -= needFor(l); l++; }
  const need = l >= MAX_LEVEL ? 0 : needFor(l);
  return { level: l, into: l >= MAX_LEVEL ? 0 : left, need, frac: need ? left / need : 1 };
}

// Is the reward on this level yours (reached or bought)?
export const unlocked = (s, level) => levelOf(s.xp).level >= level || s.bought.includes(level);
export function owns(s, type, id) {
  if ((type === 'ball' && id === 'classic') || (type === 'shoes' && id === 'none') || (type === 'frame' && id === 'basic') || (type === 'title' && id === 'rookie')) return true;
  return TRACK.some((r, l) => r && unlocked(s, l) && ((r.type === type && r.id === id) || (type === 'title' && r.title === id)));
}

// Coins from levels reached that were not paid out yet
function payLevels(s) {
  const lv = levelOf(s.xp).level;
  let got = 0;
  for (let l = 2; l <= lv; l++) {
    const r = TRACK[l];
    if (r && r.type === 'coins' && !s.paid.includes(l)) { s.paid.push(l); s.coins += r.amount; got += r.amount; }
  }
  return got;
}

const today = () => new Date().toISOString().slice(0, 10);
// What a finished game is worth. info: { won, pts (your team's points), mode, big (your highlight plays), ranked }
export function gameXP(info, s = load()) {
  const parts = [['Game played', 60]];
  if (info.won) parts.push(['Win', 40]);
  const pts = Math.min(60, Math.round((info.pts || 0) * 0.6));
  if (pts) parts.push(['Points scored', pts]);
  if (['career', 'season', 'draft', 'online', 'street'].includes(info.mode)) parts.push([info.ranked ? 'Ranked game' : 'Mode bonus', info.ranked ? 40 : 20]);
  const hl = Math.min(3, info.big || 0);
  if (hl) parts.push([`Highlight play${hl > 1 ? 's' : ''}`, hl * 15]);
  if (info.won && s.day !== today()) parts.push(['First win of the day', 75]);
  return parts;
}

// Adds a game's XP. Returns what happened, for the results screen.
export function awardGame(info) {
  const s = load();
  const parts = gameXP(info, s);
  const xp = parts.reduce((a, p) => a + p[1], 0);
  const before = levelOf(s.xp);
  const prevXp = s.xp;
  s.xp += xp; s.games = (s.games || 0) + 1;
  if (info.won) s.day = today();
  const coins = Math.round(xp / 10);
  s.coins += coins;
  const after = levelOf(s.xp);
  const levelCoins = payLevels(s);
  const rewards = [];
  for (let l = before.level + 1; l <= after.level; l++) if (TRACK[l]) rewards.push({ level: l, ...TRACK[l] });
  save(s);
  return { parts, xp, coins, levelCoins, prevXp, xpNow: s.xp, before, after, rewards };
}

export function buy(level) {
  const s = load();
  if (unlocked(s, level) || !TRACK[level]) return { ok: false };
  const price = priceOf(level);
  if (s.coins < price) return { ok: false, short: price - s.coins };
  s.coins -= price; s.bought.push(level);
  const r = TRACK[level];
  if (r.type === 'coins') { s.paid.push(level); s.coins += r.amount; }
  save(s);
  return { ok: true, reward: { level, ...r } };
}
export function equip(type, id) {
  const s = load();
  if (!owns(s, type, id)) return false;
  s.eq[type] = id; save(s);
  return true;
}
export function markSeen() { const s = load(); if (s.seenXp !== s.xp) { s.seenXp = s.xp; save(s); } }
export const equipped = () => load().eq;
