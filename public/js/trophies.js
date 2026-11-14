// Trophy room: achievements, three daily challenges and a login streak. Everything pays Rep Points into your careers.
// The progress lives in one save key (pph-trophies), so it follows the account like the rest of the cloud save.
import * as Season from './season.js';

const KEY = 'pph-trophies';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayNum = (s) => Math.floor(Date.parse(s + 'T12:00:00Z') / 864e5);

// Totals across all games (cnt) and best single games (best)
const ACH = [
  { id: 'first_win', icon: '🏀', name: 'First Win', desc: 'Win a game', rp: 100, test: (s, g) => g.win },
  { id: 'wins_10', icon: '🔟', name: 'Double Digits', desc: 'Win 10 games', rp: 300, of: 10, val: (s) => s.cnt.wins },
  { id: 'wins_50', icon: '👑', name: 'Dynasty', desc: 'Win 50 games', rp: 1200, of: 50, val: (s) => s.cnt.wins },
  { id: 'streak_3', icon: '🔥', name: 'Heating Up', desc: 'Win 3 games in a row', rp: 200, of: 3, val: (s) => s.cnt.streak },
  { id: 'streak_7', icon: '🚀', name: 'Unstoppable', desc: 'Win 7 games in a row', rp: 800, of: 7, val: (s) => s.cnt.streak },
  { id: 'blowout', icon: '💥', name: 'Blowout', desc: 'Win by 20 or more', rp: 250, test: (s, g) => g.win && g.margin >= 20 },
  { id: 'clutch', icon: '🧊', name: 'Ice in the Veins', desc: 'Win a game by 3 or less', rp: 250, test: (s, g) => g.win && g.margin <= 3 },
  { id: 'comeback', icon: '🎢', name: 'The Comeback', desc: 'Win after trailing by 10 or more', rp: 400, test: (s, g) => g.win && g.maxTrail >= 10 },
  { id: 'dunks_5', icon: '🔨', name: 'Rim Wrecker', desc: 'Throw down 5 dunks in one game', rp: 300, test: (s, g) => g.dunks >= 5 },
  { id: 'dunks_100', icon: '⚡', name: 'Poster Machine', desc: 'Throw down 100 dunks', rp: 700, of: 100, val: (s) => s.cnt.dunks },
  { id: 'threes_8', icon: '🎯', name: 'Raining Threes', desc: 'Hit 8 threes in one game', rp: 300, test: (s, g) => g.threes >= 8 },
  { id: 'threes_150', icon: '🌧️', name: 'Downtown', desc: 'Hit 150 three-pointers', rp: 700, of: 150, val: (s) => s.cnt.threes },
  { id: 'blocks_6', icon: '🛑', name: 'Not In My House', desc: 'Block 6 shots in one game', rp: 300, test: (s, g) => g.blocks >= 6 },
  { id: 'steals_8', icon: '✋', name: 'Pickpocket', desc: 'Get 8 steals in one game', rp: 300, test: (s, g) => g.steals >= 8 },
  { id: 'assists_20', icon: '🤝', name: 'Pass First', desc: 'Dish 20 assists in one game', rp: 300, test: (s, g) => g.ast >= 20 },
  { id: 'pts_30', icon: '🔥', name: 'Thirty Bomb', desc: 'Score 30 points with one player', rp: 300, test: (s, g) => g.topPts >= 30 },
  { id: 'pts_50', icon: '🌋', name: 'Fifty Burger', desc: 'Score 50 points with one player', rp: 1000, test: (s, g) => g.topPts >= 50 },
  { id: 'triple', icon: '🎩', name: 'Triple-Double', desc: 'Get a triple-double', rp: 800, test: (s, g) => g.triple },
  { id: 'perfect_ft', icon: '🎪', name: 'Perfect at the Line', desc: 'Make every free throw, with 6 or more tries', rp: 300, test: (s, g) => g.ft >= 6 && g.ftPerfect },
  { id: 'games_25', icon: '📅', name: 'Regular', desc: 'Play 25 games', rp: 400, of: 25, val: (s) => s.cnt.games },
  { id: 'login_7', icon: '🗓️', name: 'Week One', desc: 'Come back 7 days in a row', rp: 500, of: 7, val: (s) => s.streak.n },
];

// Daily challenge pool: stat keys are counted from the games you play that day
const DAILY = [
  { id: 'dunks', label: 'Throw down {n} dunks', need: 3, rp: 80 },
  { id: 'threes', label: 'Hit {n} three-pointers', need: 5, rp: 100 },
  { id: 'steals', label: 'Get {n} steals', need: 4, rp: 90 },
  { id: 'blocks', label: 'Block {n} shots', need: 3, rp: 90 },
  { id: 'reb', label: 'Grab {n} rebounds', need: 15, rp: 80 },
  { id: 'ast', label: 'Dish {n} assists', need: 8, rp: 90 },
  { id: 'wins', label: 'Win {n} game', need: 1, rp: 120 },
  { id: 'pts', label: 'Score {n} points as a team', need: 60, rp: 80 },
];

function fresh() { return { got: {}, cnt: { wins: 0, games: 0, streak: 0, dunks: 0, threes: 0 }, streak: { last: '', n: 0, paid: '' }, daily: { date: '', goals: [] }, pending: 0, earned: 0 }; }
let S = fresh();
export function loadTrophies() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && typeof v === 'object') S = { ...fresh(), ...v, cnt: { ...fresh().cnt, ...(v.cnt || {}) }, streak: { ...fresh().streak, ...(v.streak || {}) }, daily: { ...fresh().daily, ...(v.daily || {}) } }; } catch { S = fresh(); }
  return S;
}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } };

// New day: advance the login streak and draw three fresh daily challenges (the same three for everybody on a given date)
export function newDay() {
  loadTrophies();
  const t = today();
  if (S.streak.last !== t) {
    S.streak.n = S.streak.last && dayNum(t) - dayNum(S.streak.last) === 1 ? S.streak.n + 1 : 1;
    S.streak.last = t;
    S.pending += 25 * Math.min(S.streak.n, 7);               // login bonus: 25 per day in the streak, up to 175
    S.earned += 25 * Math.min(S.streak.n, 7);
  }
  if (S.daily.date !== t) {
    let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const pool = DAILY.slice(), pick = [];
    while (pick.length < 3) { h = (h * 1664525 + 1013904223) >>> 0; pick.push(pool.splice(h % pool.length, 1)[0]); }
    S.daily = { date: t, goals: pick.map((d) => ({ id: d.id, have: 0, done: false })) };
  }
  checkAch({}, {});
  persist();
}

// What the achievements need to know about one finished game
function checkAch(s, g, notify) {
  for (const a of ACH) {
    if (S.got[a.id]) continue;
    const ok = a.test ? (g && Object.keys(g).length && a.test(S, g)) : (a.val(S) >= a.of);
    if (ok) { S.got[a.id] = Date.now(); S.pending += a.rp; S.earned += a.rp; if (notify) notify('TROPHY UNLOCKED', `${a.icon} ${a.name} · +${a.rp} RP`); }
  }
}

// Counts the user's team in a game: call once per game
export function attachTrophies(game, notify) {
  const o = game.opts || {};
  if (o.attract || o.tutorial || o.practice || o.guest || o.contest) return;
  loadTrophies();
  const me = game.user, opp = game.cpu;
  const G = { dunks: 0, threes: 0, blocks: 0, steals: 0, reb: 0, ast: 0, maxTrail: 0 };
  const mine = (p) => !!p && p.team === me;
  const daily = (id, n = 1) => {
    for (const g of S.daily.goals) if (g.id === id && !g.done) { g.have += n; }
    persist();
  };
  game.on((type, d) => {
    if (type === 'score' && d.team === me) {
      if (d.kind === 'dunk') { G.dunks++; daily('dunks'); }
      if (d.pts === 3) { G.threes++; daily('threes'); }
      if (d.assist && mine(d.assist)) { G.ast++; daily('ast'); }
      daily('pts', d.pts);
    }
    if (type === 'score') G.maxTrail = Math.max(G.maxTrail, opp.score - me.score);
    if (type === 'block' && mine(d.player)) { G.blocks++; daily('blocks'); }
    if ((type === 'steal' || type === 'intercept') && mine(d.player)) { G.steals++; daily('steals'); }
    if (type === 'rebound' && mine(d.player)) { G.reb++; daily('reb'); }
    if (type === 'gameOver') {
      if (G.done) return; G.done = true;
      const win = d.winner === me, all = [...me.players, ...me.bench];
      const top = all.reduce((m, p) => Math.max(m, p.stats.pts), 0);
      const triple = all.some((p) => ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => p.stats[k] >= 10).length >= 3);
      const ftm = all.reduce((a, p) => a + p.stats.ftm, 0), fta = all.reduce((a, p) => a + p.stats.fta, 0);
      S.cnt.games++; S.cnt.dunks += G.dunks; S.cnt.threes += G.threes;
      if (win) { S.cnt.wins++; S.cnt.streak++; daily('wins'); } else S.cnt.streak = 0;
      checkAch(S, { win, margin: me.score - opp.score, maxTrail: G.maxTrail, dunks: G.dunks, threes: G.threes, blocks: G.blocks, steals: G.steals, ast: G.ast, topPts: top, triple, ft: fta, ftPerfect: ftm === fta }, notify);
      for (const g of S.daily.goals) { const def = DAILY.find((x) => x.id === g.id); if (def && !g.done && g.have >= def.need && notify) notify('DAILY CHALLENGE DONE', def.label.replace('{n}', def.need)); }
      persist();
    }
  });
}

// Pays what is waiting into every career on this device. Returns the amount paid, or 0 when there is no career yet.
export function payOut() {
  loadTrophies();
  if (!S.pending) return 0;
  const saves = [1, 2, 3].map((slot) => Season.load('career', slot)).filter((s) => s && s.career);
  if (!saves.length) return 0;
  const n = S.pending;
  for (const s of saves) { s.career.rp = (s.career.rp || 0) + n; Season.save(s); }
  S.pending = 0; persist();
  return n;
}
export function claimDaily(i) {
  loadTrophies();
  const g = S.daily.goals[i], def = g && DAILY.find((x) => x.id === g.id);
  if (!g || !def || g.done || g.have < def.need) return false;
  g.done = true; S.pending += def.rp; S.earned += def.rp; persist();
  return def.rp;
}
export const hasUnclaimed = () => { loadTrophies(); return S.daily.goals.some((g) => { const d = DAILY.find((x) => x.id === g.id); return d && !g.done && g.have >= d.need; }) || S.pending > 0; };

export function renderTrophies(el, esc) {
  loadTrophies();
  const got = Object.keys(S.got).length;
  const goals = S.daily.goals.map((g, i) => {
    const d = DAILY.find((x) => x.id === g.id); if (!d) return '';
    const have = Math.min(g.have, d.need), pct = Math.round((have / d.need) * 100), ready = !g.done && have >= d.need;
    return `<div class="tr-goal ${g.done ? 'done' : ''}"><div><b>${esc(d.label.replace('{n}', d.need))}</b><small>${have} / ${d.need} · +${d.rp} RP</small><i style="--p:${pct}%"></i></div>
      <button type="button" data-claim="${i}" ${ready ? '' : 'disabled'}>${g.done ? 'Claimed' : ready ? 'Claim' : 'In progress'}</button></div>`;
  }).join('');
  const badges = ACH.map((a) => {
    const on = !!S.got[a.id], prog = a.of ? ` <small>${Math.min(a.val(S), a.of)}/${a.of}</small>` : '';
    return `<div class="tr-ach ${on ? 'on' : ''}"><span class="ic">${on ? a.icon : '🔒'}</span><div><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>${on ? '' : prog}</div><em>+${a.rp}</em></div>`;
  }).join('');
  el.innerHTML = `
    <div class="tr-top"><div class="tr-stat"><b>${got}<small>/${ACH.length}</small></b><span>Trophies</span></div>
      <div class="tr-stat"><b>${S.streak.n}</b><span>Day streak</span></div>
      <div class="tr-stat"><b>${S.earned.toLocaleString()}</b><span>RP earned</span></div>
      <div class="tr-pay"><span>${S.pending ? `<b>${S.pending.toLocaleString()} RP</b> waiting` : 'Nothing waiting'}</span><button type="button" id="trPay" ${S.pending ? '' : 'disabled'}>Pay into my careers</button><small id="trPayNote"></small></div></div>
    <h3>Today's challenges</h3><div class="tr-goals">${goals}</div>
    <h3>Trophies</h3><div class="tr-grid">${badges}</div>`;
}
