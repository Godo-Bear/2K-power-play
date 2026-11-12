// Season + My Career logic. Everything is saved in the browser (localStorage).
import { TEAMS } from './data.js';

export const CAREER_SLOTS = 3;
const N = TEAMS.length;
// Seasons have one save; careers have three slots
const keyFor = (kind, slot = 1) => (kind === 'career' ? `pph-career-${slot}` : 'pph-season');

// An older version kept a single career: move it into slot 1
try {
  const old = localStorage.getItem('pph-career');
  if (old && !localStorage.getItem('pph-career-1')) localStorage.setItem('pph-career-1', old);
  if (old) localStorage.removeItem('pph-career');
} catch { /* ignore */ }

export function load(kind, slot = 1) {
  try {
    const s = JSON.parse(localStorage.getItem(keyFor(kind, slot)) || 'null');
    if (!s || s.v !== 1) return null;
    s.slot = slot;
    return s;
  } catch { return null; }
}
export function save(s) { try { localStorage.setItem(keyFor(s.kind, s.slot || 1), JSON.stringify(s)); } catch { /* ignore */ } }
export function clear(kind, slot = 1) { try { localStorage.removeItem(keyFor(kind, slot)); } catch { /* ignore */ } }

// Everyone plays everyone once (15 games in a 16-team league). Small leagues play home and away.
export const SEASON_GAMES = N > 10 ? N - 1 : 2 * (N - 1);
function makeSchedule() {
  const ids = [...Array(N).keys()].sort(() => Math.random() - 0.5);
  const rounds = [];
  const arr = ids.slice();
  const homeCount = Array(N).fill(0);
  for (let r = 0; r < N - 1; r++) {
    const games = [];
    for (let i = 0; i < N / 2; i++) {
      const a = arr[i], b = arr[N - 1 - i];
      // Whoever has hosted less so far gets the home game, so everyone ends up about even
      const aHosts = homeCount[a] === homeCount[b] ? Math.random() < 0.5 : homeCount[a] < homeCount[b];
      const h = aHosts ? a : b;
      homeCount[h]++;
      games.push({ h, a: aHosts ? b : a });
    }
    rounds.push(games);
    arr.splice(1, 0, arr.pop());
  }
  const second = N > 10 ? [] : rounds.map((g) => g.map((x) => ({ h: x.a, a: x.h })));
  return [...rounds, ...second].map((g) => g.map((x) => ({ ...x, hs: null, as: null })));
}

export function newSeason({ kind = 'season', team, diff, q, career = null, year = 1, slot = 1 }) {
  const s = { v: 1, kind, slot, team, diff, q, year, round: 0, schedule: makeSchedule(), stats: {}, playoffs: null, career };
  save(s);
  return s;
}

const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
function teamOvr(s, idx) {
  // In career mode your own rating nudges your team's strength in simulated games
  if (s.career && idx === s.team) return TEAMS[idx].ovr + (careerOvr(s.career) - 80) / 6;
  return TEAMS[idx].ovr;
}
function simScore(s, g) {
  const base = s.q * 4 * 5.4;
  let hs = Math.round(base * (1 + (teamOvr(s, g.h) - 85) / 75) + base * 0.17 * gauss() + base * 0.03);
  let as = Math.round(base * (1 + (teamOvr(s, g.a) - 85) / 75) + base * 0.17 * gauss());
  while (hs === as) { if (Math.random() < 0.52) hs += 1 + Math.floor(Math.random() * 5); else as += 1 + Math.floor(Math.random() * 5); }
  g.hs = Math.max(8, hs); g.as = Math.max(8, as);
  if (g.hs === g.as) g.hs++;
}

export function standings(s) {
  const t = TEAMS.map((_, i) => ({ team: i, w: 0, l: 0, pf: 0, pa: 0 }));
  for (const round of s.schedule) for (const g of round) {
    if (g.hs == null) continue;
    const H = t[g.h], A = t[g.a];
    H.pf += g.hs; H.pa += g.as; A.pf += g.as; A.pa += g.hs;
    if (g.hs > g.as) { H.w++; A.l++; } else { A.w++; H.l++; }
  }
  return t.sort((x, y) => y.w - x.w || (y.pf - y.pa) - (x.pf - x.pa));
}

export function regularSeasonDone(s) { return s.round >= s.schedule.length; }

// The next game the user has to play (or null if their season is over)
export function nextGame(s) {
  if (!regularSeasonDone(s)) return { ...s.schedule[s.round].find((g) => g.h === s.team || g.a === s.team), stage: `Game ${s.round + 1} of ${s.schedule.length}` };
  const p = s.playoffs;
  if (!p || p.champion != null) return null;
  const pool = p.final ? [p.final] : p.semis;
  const g = pool.find((x) => x.hs == null && (x.h === s.team || x.a === s.team));
  return g ? { ...g, stage: p.final ? 'Championship Final' : 'Playoff Semifinal' } : null;
}

function startPlayoffs(s) {
  const top = standings(s).slice(0, 4).map((x) => x.team);
  s.playoffs = { seeds: top, semis: [{ h: top[0], a: top[3], hs: null, as: null }, { h: top[1], a: top[2], hs: null, as: null }], final: null, champion: null };
  advancePlayoffs(s);
}

function advancePlayoffs(s) {
  const p = s.playoffs;
  const userIn = (g) => g.h === s.team || g.a === s.team;
  const winner = (g) => (g.hs > g.as ? g.h : g.a);
  if (!p.final) {
    for (const g of p.semis) if (g.hs == null && !userIn(g)) simScore(s, g);
    if (p.semis.every((g) => g.hs != null)) {
      const w = p.semis.map(winner).sort((a, b) => p.seeds.indexOf(a) - p.seeds.indexOf(b));
      p.final = { h: w[0], a: w[1], hs: null, as: null };
    }
  }
  if (p.final) {
    if (p.final.hs == null && !userIn(p.final)) simScore(s, p.final);
    if (p.final.hs != null) p.champion = winner(p.final);
  }
}

// Record the user's game (hs/as = home/away score) and simulate the rest of the round
export function recordGame(s, hs, as, boxScore = null) {
  if (!regularSeasonDone(s)) {
    const round = s.schedule[s.round];
    for (const g of round) {
      if (g.h === s.team || g.a === s.team) { g.hs = hs; g.as = as; } else simScore(s, g);
    }
    s.round++;
    if (regularSeasonDone(s)) startPlayoffs(s);
  } else if (s.playoffs && s.playoffs.champion == null) {
    const p = s.playoffs;
    const g = (p.final ? [p.final] : p.semis).find((x) => x.hs == null && (x.h === s.team || x.a === s.team));
    if (g) { g.hs = hs; g.as = as; }
    advancePlayoffs(s);
  }
  if (boxScore) {
    for (const row of boxScore) {
      const st = s.stats[row.key] || (s.stats[row.key] = { name: row.name, pos: row.pos, gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 });
      if (row.sec > 0) st.gp++;
      for (const k of ['pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa']) st[k] += row[k];
    }
  }
  save(s);
}

// Simulate the user's own next game
export function simUserGame(s) {
  const g = nextGame(s);
  if (!g) return null;
  const tmp = { h: g.h, a: g.a };
  simScore(s, tmp);
  if (!s.career) { recordGame(s, tmp.hs, tmp.as); return tmp; }
  // Career: the player gets a full stat line, as if he had played the game
  const c = s.career;
  const mineHome = tmp.h === s.team;
  const teamPts = mineHome ? tmp.hs : tmp.as;
  const line = simCareerLine(c, s.q, 1, teamPts);
  const row = { key: `${c.first} ${c.last}#${c.number}`, name: `${c.first} ${c.last}`, pos: ['PG', 'SG', 'SF', 'PF', 'C'][c.pos], ...line };
  recordGame(s, tmp.hs, tmp.as, [row]);
  tmp.won = mineHome ? tmp.hs > tmp.as : tmp.as > tmp.hs;
  tmp.line = line;
  tmp.reward = careerReward(s, line, tmp.won);
  return tmp;
}

// A believable stat line for a career player who didn't play (or only part of) a game, built from his ratings.
// `fraction` is how much of the game is being simulated (1 = all of it); `teamPts` caps his scoring at a fair share.
export function simCareerLine(c, q, fraction = 1, teamPts = 999) {
  const r = c.ratings;
  const ovr = careerOvr(c);
  const per8 = (q * 4 / 8) * fraction;                  // the numbers below are per 8 minutes of game time
  const jitter = (v, spread = 0.32) => Math.max(0, v * (1 - spread + Math.random() * spread * 2));
  const n = (v) => Math.max(0, Math.round(v));
  // Small counting stats: an average of 0.4 steals should give a steal in about 4 games in 10, not never
  const sn = (v) => { const f = Math.floor(Math.max(0, v)); return f + (Math.random() < Math.max(0, v) - f ? 1 : 0); };
  let pts = n(jitter((3 + (ovr - 50) * 0.3) * per8, 0.4));
  pts = Math.min(pts, Math.floor(teamPts * 0.45));
  // Shooting splits follow his ratings
  const ppa = 0.88 + (ovr - 60) / 130;                  // points per shot attempt
  const tpa = n(pts / ppa * (0.18 + (r.three - 50) / 160));
  const tpm = Math.min(tpa, n(tpa * (0.3 + (r.three - 50) / 170)));
  const ftm = n(pts * 0.1 * (0.6 + Math.random() * 0.8));
  const twoPts = Math.max(0, pts - tpm * 3 - ftm);
  const fg2 = Math.floor(twoPts / 2);
  const fgm = fg2 + tpm;
  const ftExtra = pts - tpm * 3 - fg2 * 2;              // an odd point is a free throw
  const ftmAll = ftm + Math.max(0, ftExtra - ftm);
  const fga = Math.max(fgm, n(pts / ppa) + (Math.random() < 0.5 ? 1 : 0));
  return {
    pts, fgm, fga, tpm, tpa, ftm: ftmAll, fta: ftmAll + n(Math.random() * 1.2),
    reb: sn(jitter((0.5 + (r.reb - 40) / 45) * per8)),
    ast: sn(jitter((0.4 + (r.pass - 40) / 30) * per8)),
    stl: sn(jitter((0.1 + (r.steal - 40) / 90) * per8, 0.6)),
    blk: sn(jitter((0.05 + (r.block - 40) / 90) * per8, 0.6)),
    to: sn(jitter((0.3 + (80 - r.handle) / 90) * per8, 0.6)),
    pf: Math.min(5, sn(jitter(0.5 * per8, 0.8))),
    sec: Math.round(per8 * 8 * 60 * 0.8),
  };
}

export function record(s, team) {
  const r = standings(s).find((x) => x.team === team);
  return r ? `${r.w}-${r.l}` : '0-0';
}

// ---------- My Career ----------
export const ATTRS = [
  ['three', '3-Point Shot'], ['mid', 'Mid-Range'], ['inside', 'Finishing'], ['dunk', 'Dunking'], ['pass', 'Passing'], ['handle', 'Ball Handling'],
  ['speed', 'Speed'], ['def', 'Defense'], ['steal', 'Steal'], ['block', 'Block'], ['reb', 'Rebounding'],
];
export const ARCHETYPES = {
  sharpshooter: { label: 'Sharpshooter', desc: 'Deadly from deep', unlock: 0, boost: { three: 14, mid: 10, handle: 2 } },
  playmaker: { label: 'Playmaker', desc: 'Runs the offense', unlock: 0, boost: { pass: 14, handle: 12, speed: 6 } },
  slasher: { label: 'Slasher', desc: 'Attacks the rim', unlock: 0, boost: { inside: 12, dunk: 14, speed: 8 } },
  lockdown: { label: 'Lockdown Defender', desc: 'Shuts opponents down', unlock: 0, boost: { def: 14, steal: 12, block: 6, speed: 4 } },
  glass: { label: 'Glass Cleaner', desc: 'Owns the boards', unlock: 0, boost: { reb: 16, block: 12, inside: 8 } },
  threeD: { label: '3-and-D Wing', desc: 'Hits threes, guards the best', unlock: 72, boost: { three: 11, def: 11, steal: 7, mid: 3 } },
  shotCreator: { label: 'Shot Creator', desc: 'Gets a bucket from anywhere', unlock: 74, boost: { mid: 13, handle: 10, three: 7, inside: 3 } },
  stretchBig: { label: 'Stretch Big', desc: 'A big who shoots', unlock: 78, boost: { three: 13, mid: 9, reb: 8, block: 4 } },
  postScorer: { label: 'Post Scorer', desc: 'Unstoppable down low', unlock: 80, boost: { inside: 15, mid: 8, reb: 7, dunk: 5 } },
  rimProtector: { label: 'Rim Protector', desc: 'Nothing easy at the rim', unlock: 82, boost: { block: 16, def: 11, reb: 8 } },
  speedster: { label: 'Speedster', desc: 'Fastest player on the floor', unlock: 76, boost: { speed: 15, handle: 9, steal: 7, inside: 4 } },
  allAround: { label: 'All-Around', desc: 'Good at everything', unlock: 0, boost: { three: 4, mid: 4, inside: 4, pass: 4, handle: 4, def: 4, reb: 4, speed: 3, steal: 2, block: 2 } },
};
// Like FC PlayStyles: the starter styles are open from day one, the rest unlock as your OVR rises.
// A style you have unlocked can be equipped (up to 2 extras) for 40% of its rating boosts on top of your primary style.
export const MAX_EXTRA_STYLES = 2;
export function styleUnlocked(ovr, key) { return ovr >= ARCHETYPES[key].unlock; }
export function extraStyles(c) { return (c.styles || []).filter((k) => ARCHETYPES[k] && k !== c.archetype); }
export function effectiveRatings(c) {
  const r = { ...c.ratings };
  for (const k of extraStyles(c)) for (const [a, v] of Object.entries(ARCHETYPES[k].boost)) r[a] = Math.min(99, r[a] + Math.round(v * 0.4));
  return r;
}
export function toggleStyle(s, key) {
  const c = s.career;
  if (!styleUnlocked(careerOvr(c), key) || key === c.archetype) return false;
  c.styles = extraStyles(c);
  if (c.styles.includes(key)) c.styles = c.styles.filter((k) => k !== key);
  else if (c.styles.length < MAX_EXTRA_STYLES) c.styles.push(key);
  else return false;
  save(s);
  return true;
}
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const POS_HEIGHT = [1.88, 1.96, 2.03, 2.08, 2.13];

export function careerOvr(c) {
  const v = Object.values(c.ratings);
  return Math.max(40, Math.min(99, Math.round(v.reduce((a, b) => a + b, 0) / v.length + 6)));
}
export function tier(ovr) {
  if (ovr >= 93) return { name: 'Legend', cls: 'legend' };
  if (ovr >= 86) return { name: 'Diamond', cls: 'diamond' };
  if (ovr >= 78) return { name: 'Gold', cls: 'gold' };
  if (ovr >= 70) return { name: 'Silver', cls: 'silver' };
  return { name: 'Bronze', cls: 'bronze' };
}

export function newCareerPlayer({ first, last, pos, number, archetype, skin, hair, hairStyle }) {
  const ratings = {};
  for (const [k] of ATTRS) ratings[k] = 60;
  // Position shapes the base, archetype adds the specialty
  const big = pos >= 3;
  ratings.reb += big ? 8 : -4; ratings.block += big ? 6 : -6; ratings.speed += big ? -4 : 6; ratings.handle += big ? -6 : 6; ratings.three += big ? -4 : 3;
  for (const [k, v] of Object.entries(ARCHETYPES[archetype].boost)) ratings[k] += v;
  for (const k of Object.keys(ratings)) ratings[k] = Math.max(40, Math.min(99, ratings[k]));
  return {
    first, last, pos, number, archetype, skin, hair, hairStyle,
    height: POS_HEIGHT[pos], ratings, rp: 30, earned: 0, games: 0, upgrades: 0,
    totals: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 }, best: { pts: 0 }, titles: 0, log: [],
  };
}

// Team data with the career player swapped in as the starter at their position
export function careerTeamData(s) {
  const base = TEAMS[s.team];
  const c = s.career;
  const me = {
    first: c.first, last: c.last, pos: POS[c.pos], number: c.number, height: c.height, skin: c.skin, hair: c.hair, hairStyle: c.hairStyle,
    headband: false, sleeve: true, ratings: effectiveRatings(c), ovr: careerOvr(c), isMe: true,
  };
  const roster = base.roster.slice();
  // The old starter moves to the bench in place of the previous backup
  roster[c.pos + 5] = { ...roster[c.pos], bench: true };
  roster[c.pos] = me;
  return { ...base, roster };
}

export function upgradeCost(rating) { return rating >= 99 ? Infinity : Math.round(4 + Math.max(0, rating - 55) * 0.45); }
export function upgrade(s, attr) {
  const c = s.career;
  const cost = upgradeCost(c.ratings[attr]);
  if (c.rp < cost) return false;
  c.rp -= cost; c.ratings[attr]++; c.upgrades++;
  save(s);
  return true;
}

// Turn one game's stat line into a grade and Rep Points
export function careerReward(s, line, won) {
  const c = s.career;
  const score = line.pts + line.reb * 1.2 + line.ast * 1.5 + line.stl * 2.5 + line.blk * 2.5 - line.to * 1.5 - Math.max(0, line.fga - line.fgm) * 0.4;
  const per = score / Math.max(1, s.q * 4 / 8); // normalize to an 8-minute game
  const grade = per >= 26 ? 'A+' : per >= 20 ? 'A' : per >= 15 ? 'B+' : per >= 11 ? 'B' : per >= 7 ? 'C+' : per >= 4 ? 'C' : 'D';
  const gradeBonus = { 'A+': 30, A: 22, 'B+': 16, B: 11, 'C+': 7, C: 4, D: 1 }[grade];
  const rp = Math.round(8 + gradeBonus + (won ? 10 : 0) + Math.min(20, score * 0.5));
  c.rp += rp; c.earned += rp; c.games++;
  for (const k of ['pts', 'reb', 'ast', 'stl', 'blk']) c.totals[k] += line[k];
  c.best.pts = Math.max(c.best.pts, line.pts);
  c.log.unshift({ pts: line.pts, reb: line.reb, ast: line.ast, grade, rp, won });
  c.log = c.log.slice(0, 8);
  save(s);
  return { grade, rp };
}

// Roll into a new season with the same player
export function nextYear(s) {
  const c = s.career;
  return newSeason({ kind: s.kind, team: s.team, diff: s.diff, q: s.q, career: c, year: (s.year || 1) + 1, slot: s.slot || 1 });
}
