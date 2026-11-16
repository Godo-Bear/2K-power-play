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

// The league keeps getting better: every year in a career the rival teams' players gain rating points,
// so winning titles stays a challenge (your own team grows at half speed, your player grows with Rep Points)
export function leagueGrowth(year) { return Math.min(10, Math.max(0, ((year || 1) - 1) * 1.8)); }
export const scaledCache = new Map();
export function scaledTeam(idx, year, factor = 1) {
  const g = Math.round(leagueGrowth(year) * factor);
  const base = TEAMS[idx];
  if (!g) return base;
  const key = `${idx}:${g}`;
  if (scaledCache.has(key)) return scaledCache.get(key);
  const bump = (r) => { const o = {}; for (const k of Object.keys(r)) o[k] = Math.min(99, r[k] + g); return o; };
  const t = { ...base, ovr: Math.min(97, base.ovr + g), roster: base.roster.map((p) => ({ ...p, ratings: bump(p.ratings), ovr: Math.min(99, p.ovr + g) })) };
  scaledCache.set(key, t);
  return t;
}

const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
function teamOvr(s, idx) {
  // In career mode your own rating nudges your team's strength in simulated games
  if (s.career && idx === s.team) return scaledTeam(idx, s.year, 0.5).ovr + (careerOvr(s.career) - 80) / 6;
  if (s.career) return scaledTeam(idx, s.year).ovr;
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

// ---------- Playoffs: best-of series ----------
// Semifinals are best of 5, the final best of 7. The higher seed (sr.h) has home court: games 1, 2, 5 and 7 at home, 3, 4 and 6 away.
export const SERIES = { semi: 5, final: 7 };
const mkSeries = (h, a, best) => ({ h, a, best, games: [], hw: 0, aw: 0, winner: null });
export const seriesHomeIsSeed = (n) => [true, true, false, false, true, false, true][n] !== false;   // n = game index from 0
const seriesGame = (sr) => { const n = sr.games.length, seedHome = seriesHomeIsSeed(n); return { h: seedHome ? sr.h : sr.a, a: seedHome ? sr.a : sr.h, n, seedHome }; };
function seriesRecord(sr, hs, as) {
  const g = seriesGame(sr);
  sr.games.push({ h: g.h, a: g.a, hs, as });
  const seedWon = g.seedHome ? hs > as : as > hs;
  if (seedWon) sr.hw++; else sr.aw++;
  const need = Math.ceil(sr.best / 2);
  if (sr.hw >= need) sr.winner = sr.h; else if (sr.aw >= need) sr.winner = sr.a;
}
const userSeries = (s) => { const p = s.playoffs; return [...(p.final ? [p.final] : []), ...p.semis].find((sr) => !sr.winner && (sr.h === s.team || sr.a === s.team)) || null; };
export const seriesScore = (sr) => `${sr.hw}-${sr.aw}`;

// The next game the user has to play (or null if their season is over)
export function nextGame(s) {
  if (!regularSeasonDone(s)) return { ...s.schedule[s.round].find((g) => g.h === s.team || g.a === s.team), stage: `Game ${s.round + 1} of ${s.schedule.length}` };
  const p = s.playoffs;
  if (!p || p.champion != null) return null;
  const sr = userSeries(s);
  if (!sr) return null;
  const g = seriesGame(sr);
  const isFinal = sr === p.final;
  const mineWins = sr.h === s.team ? sr.hw : sr.aw, theirWins = sr.h === s.team ? sr.aw : sr.hw;
  const lead = mineWins === theirWins ? `series tied ${mineWins}-${theirWins}` : mineWins > theirWins ? `you lead ${mineWins}-${theirWins}` : `you trail ${mineWins}-${theirWins}`;
  return { h: g.h, a: g.a, hs: null, as: null, stage: `${isFinal ? 'Final' : 'Semifinal'} · Game ${g.n + 1} of ${sr.best} · ${lead}` };
}

function startPlayoffs(s) {
  const top = standings(s).slice(0, 4).map((x) => x.team);
  s.playoffs = { seeds: top, semis: [mkSeries(top[0], top[3], SERIES.semi), mkSeries(top[1], top[2], SERIES.semi)], final: null, champion: null };
  advancePlayoffs(s);
}

// Plays out every series the user is not in, opens the final once both semis are decided, and crowns the champion
function advancePlayoffs(s) {
  const p = s.playoffs;
  const userIn = (sr) => sr.h === s.team || sr.a === s.team;
  const simSeries = (sr) => { while (!sr.winner) { const g = seriesGame(sr), tmp = { h: g.h, a: g.a }; simScore(s, tmp); seriesRecord(sr, tmp.hs, tmp.as); } };
  if (!p.final) {
    for (const sr of p.semis) if (!userIn(sr)) simSeries(sr);
    if (p.semis.every((sr) => sr.winner)) {
      const w = p.semis.map((sr) => sr.winner).sort((a, b) => p.seeds.indexOf(a) - p.seeds.indexOf(b));
      p.final = mkSeries(w[0], w[1], SERIES.final);
    }
  }
  if (p.final) {
    if (!userIn(p.final)) simSeries(p.final);
    if (p.final.winner != null) p.champion = p.final.winner;
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
    const sr = userSeries(s);
    if (sr) seriesRecord(sr, hs, as);
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
export function simUserGame(s, { rest = false } = {}) {
  const g = nextGame(s);
  if (!g) return null;
  const tmp = { h: g.h, a: g.a };
  simScore(s, tmp);
  const rows = rosterRows(s).map((r) => ({ ...r, rested: rest && r.isMe }));
  if (!s.career || rest || healthReport(s).meOut) {
    recordGame(s, tmp.hs, tmp.as);
    afterGame(s, rows, true);
    tmp.rested = !!s.career;
    return tmp;
  }
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
  afterGame(s, rows, true);
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

// ---------- Health: fatigue that carries over and short injuries ----------
// Mild on purpose: most tiredness is gone by the next tip-off, injuries last 1-3 games, your own player misses at most 2,
// and an admin can clear everything with the "Heal" gift. Keyed like the stats rows: "First Last#number".
export const playerKey = (p) => `${p.first} ${p.last}#${p.number}`;
export const health = (s) => s.health || (s.health = {});
const INJURIES = ['sprained ankle', 'tight hamstring', 'bruised knee', 'sore back', 'jammed finger', 'hip bruise'];
// Team data for a game: injured starters swap with their backups, and everyone carries in their energy
export function applyHealth(s, teamData) {
  const H = health(s);
  const roster = teamData.roster.map((p) => ({ ...p }));
  const hurt = (p) => { const h = H[playerKey(p)]; return !!(h && h.out > 0); };
  for (let i = 0; i < 5; i++) {
    if (!hurt(roster[i])) continue;
    // the backup in the same slot first, otherwise any healthy substitute
    const j = [i + 5, 5, 6, 7, 8, 9].find((k) => !hurt(roster[k]));
    if (j == null) continue;                                           // everyone on the bench is out too: he plays through it
    const st = roster[i]; roster[i] = { ...roster[j], bench: false }; roster[j] = { ...st, bench: true };
  }
  for (const p of roster) {
    const h = H[playerKey(p)];
    p.injured = !!(h && h.out > 0);
    p.energy = p.injured ? 0.05 : Math.max(0.4, 1 - (h ? h.fatigue : 0));
  }
  return { ...teamData, roster };
}
// Rows for the user's whole team ({ key, bench, isMe }), used when a game is simulated
export function rosterRows(s) {
  const t = s.career ? careerTeamData(s) : TEAMS[s.team];
  return t.roster.map((p) => ({ key: playerKey(p), bench: !!p.bench, isMe: !!p.isMe }));
}
// After a game: what is left of the tiredness, injury counters tick down, and a small chance of a new knock
export function afterGame(s, rows, simulated) {
  const H = health(s), gameSec = s.q * 4 * 60;
  for (const row of rows) {
    const h = H[row.key] || (H[row.key] = { fatigue: 0, out: 0, label: '' });
    if (h.out > 0) { h.out--; if (!h.out) h.label = ''; h.fatigue = Math.max(0, h.fatigue - 0.5); continue; }
    const played = row.rested ? 0 : simulated ? (row.bench ? 0.35 : 0.7) : Math.min(1, (row.sec || 0) / gameSec);
    const tiredNow = row.rested ? 0 : simulated ? played * 0.45 : Math.max(0, 1 - (row.energy ?? 1));
    h.fatigue = Math.max(0, Math.min(0.5, tiredNow - 0.3));            // only a long, hard night carries over, and never below 50% energy
    if (played > 0 && Math.random() < (0.01 + tiredNow * 0.03) * played * (row.isMe ? 0.6 : 1)) {
      h.out = 1 + Math.floor(Math.random() * (row.isMe ? 2 : 3));
      h.label = INJURIES[Math.floor(Math.random() * INJURIES.length)];
    }
  }
  for (const k of Object.keys(H)) if (!H[k].out && H[k].fatigue <= 0) delete H[k];
  save(s);
}
export function healAll(s) { s.health = {}; save(s); }
// The injuries and tired players on the user's team right now
export function healthReport(s) {
  const H = health(s), out = [], tired = [];
  for (const p of (s.career ? careerTeamData(s) : TEAMS[s.team]).roster) {
    const h = H[playerKey(p)];
    if (!h) continue;
    const name = `${p.first} ${p.last}`;
    if (h.out > 0) out.push({ name, isMe: !!p.isMe, games: h.out, label: h.label });
    else if (h.fatigue > 0.1) tired.push({ name, isMe: !!p.isMe, energy: Math.round((1 - h.fatigue) * 100) });
  }
  return { out, tired, meOut: out.find((x) => x.isMe) || null };
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
  sharpshooter: { label: 'Sharpshooter', desc: 'Deadly from deep', pos: [1, 2], unlock: 0, boost: { three: 14, mid: 10, handle: 2 } },
  playmaker: { label: 'Playmaker', desc: 'Runs the offense', pos: [0], unlock: 0, boost: { pass: 14, handle: 12, speed: 6 } },
  slasher: { label: 'Slasher', desc: 'Attacks the rim', pos: [1, 2], unlock: 0, boost: { inside: 12, dunk: 14, speed: 8 } },
  lockdown: { label: 'Lockdown Defender', desc: 'Shuts opponents down', pos: [0, 1, 2], unlock: 0, boost: { def: 14, steal: 12, block: 6, speed: 4 } },
  glass: { label: 'Glass Cleaner', desc: 'Owns the boards', pos: [3, 4], unlock: 0, boost: { reb: 16, block: 12, inside: 8 } },
  threeD: { label: '3-and-D Wing', desc: 'Hits threes, guards the best', pos: [1, 2], unlock: 72, boost: { three: 11, def: 11, steal: 7, mid: 3 } },
  shotCreator: { label: 'Shot Creator', desc: 'Gets a bucket from anywhere', pos: [0, 1], unlock: 74, boost: { mid: 13, handle: 10, three: 7, inside: 3 } },
  stretchBig: { label: 'Stretch Big', desc: 'A big who shoots', pos: [3, 4], unlock: 78, boost: { three: 13, mid: 9, reb: 8, block: 4 } },
  postScorer: { label: 'Post Scorer', desc: 'Unstoppable down low', pos: [3, 4], unlock: 80, boost: { inside: 15, mid: 8, reb: 7, dunk: 5 } },
  rimProtector: { label: 'Rim Protector', desc: 'Nothing easy at the rim', pos: [3, 4], unlock: 82, boost: { block: 16, def: 11, reb: 8 } },
  speedster: { label: 'Speedster', desc: 'Fastest player on the floor', pos: [0, 1], unlock: 76, boost: { speed: 15, handle: 9, steal: 7, inside: 4 } },
  floorGeneral: { label: 'Floor General', desc: 'Sees every play before it happens', pos: [0], unlock: 0, boost: { pass: 16, handle: 10, def: 4, steal: 3 } },
  scoringGuard: { label: 'Scoring Guard', desc: 'Pure bucket-getter from the backcourt', pos: [0, 1], unlock: 74, boost: { mid: 11, three: 11, handle: 8, inside: 3 } },
  twoWayWing: { label: 'Two-Way Wing', desc: 'Guards the best wing and scores', pos: [2], unlock: 0, boost: { def: 10, three: 8, steal: 8, speed: 4, mid: 3 } },
  pointForward: { label: 'Point Forward', desc: 'A big wing who runs the offense', pos: [2, 3], unlock: 76, boost: { pass: 13, handle: 10, reb: 8, inside: 4 } },
  enforcer: { label: 'Enforcer', desc: 'Physical, hard-nosed defense and rebounding', pos: [3, 4], unlock: 0, boost: { def: 12, reb: 12, block: 6, inside: 6 } },
  lobThreat: { label: 'Lob Threat', desc: 'Lives above the rim, finishes everything', pos: [4], unlock: 0, boost: { dunk: 16, inside: 10, block: 6, speed: 3 } },
  playBig: { label: 'Playmaking Big', desc: 'A center who passes like a guard', pos: [3, 4], unlock: 78, boost: { pass: 14, reb: 8, inside: 7, handle: 4 } },
  allAround: { label: 'All-Around', desc: 'Good at everything', pos: [0, 1, 2, 3, 4], unlock: 0, boost: { three: 4, mid: 4, inside: 4, pass: 4, handle: 4, def: 4, reb: 4, speed: 3, steal: 2, block: 2 } },
};
// Like FC PlayStyles: the starter styles are open from day one, the rest unlock as your OVR rises.
// A style you have unlocked can be equipped (up to 2 extras) for 40% of its rating boosts on top of your primary style.
export const MAX_EXTRA_STYLES = 2;
export function styleUnlocked(ovr, key, c) { return !!(c && c.adminUnlock) || ovr >= ARCHETYPES[key].unlock; }
export function extraStyles(c) { return (c.styles || []).filter((k) => ARCHETYPES[k] && k !== c.archetype); }
export function effectiveRatings(c) {
  const r = { ...c.ratings };
  for (const k of extraStyles(c)) for (const [a, v] of Object.entries(ARCHETYPES[k].boost)) r[a] = Math.min(99, r[a] + Math.round(v * 0.4));
  return r;
}
export function toggleStyle(s, key) {
  const c = s.career;
  if (!styleUnlocked(careerOvr(c), key, c) || key === c.archetype) return false;
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
  const base = scaledTeam(s.team, s.year, 0.5);
  const c = s.career;
  const me = {
    first: c.first, last: c.last, pos: POS[c.pos], number: c.number, height: c.height, skin: c.skin, hair: c.hair, hairStyle: c.hairStyle,
    headband: false, sleeve: true, ratings: effectiveRatings(c), styles: [c.archetype, ...extraStyles(c)], ovr: careerOvr(c), isMe: true,
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
