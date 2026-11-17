// Draft: build a squad from random picks (like FC's draft), then take it on a run of up to four wins.
// The draft lives in one save key (pph-draft), so it follows the account like everything else.
import { TEAMS } from './data.js';
import * as Season from './season.js';

const KEY = 'pph-draft';
export const POSN = ['PG', 'SG', 'SF', 'PF', 'C'];
export const SLOTS = [...POSN, 'bench', 'bench', 'bench'];
export const REWARDS = [0, 60, 140, 260, 450];        // Rep Points into every career for 0-4 wins
export const RUN_LEN = 4;

export const loadDraft = () => { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && d.v === 1 ? d : null; } catch { return null; } };
const persist = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } };
export const clearDraft = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

// Every player in the league, tagged with where they come from
const pool = () => TEAMS.flatMap((t, ti) => t.roster.map((p, i) => ({ ...p, team: ti, pid: `${ti}:${i}` })));

export function newDraft({ diff, q }) {
  const old = loadDraft();
  const d = { v: 1, diff, q, picks: [], slot: 0, used: [], offers: null, run: { wins: 0, losses: 0, games: [] }, done: false, reward: 0, best: old ? old.best || 0 : 0, runs: old ? old.runs || 0 : 0 };
  nextOffers(d);
  persist(d);
  return d;
}

function nextOffers(d) {
  if (d.slot >= SLOTS.length) { d.offers = null; return; }
  const want = SLOTS[d.slot];
  const open = pool().filter((p) => !d.used.includes(p.pid) && (want === 'bench' || p.pos === want));
  // five choices that are not all the same quality: a couple of stars, a couple of solid players, a wild card
  open.sort(() => Math.random() - 0.5);
  const stars = open.filter((p) => p.ovr >= 86).slice(0, 2), mid = open.filter((p) => p.ovr >= 78 && p.ovr < 86).slice(0, 2), rest = open.filter((p) => !stars.includes(p) && !mid.includes(p)).slice(0, 1);
  let offers = [...stars, ...mid, ...rest];
  for (const p of open) { if (offers.length >= 5) break; if (!offers.includes(p)) offers.push(p); }
  d.offers = offers.slice(0, 5).sort(() => Math.random() - 0.5);
}

export function pick(d, i) {
  const p = d.offers && d.offers[i];
  if (!p || d.slot >= SLOTS.length) return false;
  d.picks.push(p); d.used.push(p.pid); d.slot++;
  nextOffers(d);
  persist(d);
  return true;
}

// The squad as team data the game can use: five starters by position, five backups mirroring them
export function squadTeam(d) {
  const starters = d.picks.slice(0, 5).map((p) => ({ ...p, bench: false }));
  const benchPicks = d.picks.slice(5);
  const left = pool().filter((p) => !d.used.includes(p.pid)).sort(() => Math.random() - 0.5);
  const bench = POSN.map((pos) => {
    const mine = benchPicks.find((p) => p.pos === pos && !benchPicks.taken?.includes(p.pid));
    if (mine) { benchPicks.taken = [...(benchPicks.taken || []), mine.pid]; return { ...mine, bench: true }; }
    return null;
  });
  // picks at a position that is already covered go into any empty bench slot, then the rest is filled from the league
  for (const p of benchPicks) if (!(benchPicks.taken || []).includes(p.pid)) { const k = bench.indexOf(null); if (k >= 0) { bench[k] = { ...p, bench: true }; benchPicks.taken = [...(benchPicks.taken || []), p.pid]; } }
  bench.forEach((b, k) => { if (!b) { const f = left.find((p) => p.pos === POSN[k] && p.ovr < 84) || left.find((p) => p.pos === POSN[k]) || left[0]; left.splice(left.indexOf(f), 1); bench[k] = { ...f, bench: true }; } });
  const roster = [...starters, ...bench];
  const ovr = Math.max(78, Math.min(95, Math.round(starters.reduce((a, p) => a + p.ovr, 0) / 5) - 4));
  return { id: 'DRF', city: 'Your', name: 'Draft', primary: '#35f0ff', secondary: '#0b1f3a', accent: '#ffd60a', logo: { symbol: '★', shape: 'shield' }, ovr, roster, draft: true };
}
export const squadOvr = (d) => (d.picks.length ? Math.round(d.picks.slice(0, 5).reduce((a, p) => a + p.ovr, 0) / Math.min(5, d.picks.length)) : 0);

// Opponents get stronger as the run goes on
export function nextOpponent(d) {
  const n = d.run.games.length;
  const used = d.run.games.map((g) => g.opp);
  const choices = TEAMS.map((t, i) => i).filter((i) => !used.includes(i)).sort((a, b) => TEAMS[a].ovr - TEAMS[b].ovr);
  const band = choices.slice(Math.floor(choices.length * n / RUN_LEN), Math.ceil(choices.length * (n + 1) / RUN_LEN)) || choices;
  const idx = band[Math.floor(Math.random() * band.length)] ?? choices[0];
  return Season.scaledTeam(idx, 1 + n, 0.9);
}

export function recordGame(d, { won, us, them, opp }) {
  d.run.games.push({ won, us, them, opp });
  if (won) d.run.wins++; else d.run.losses++;
  if (d.run.wins >= RUN_LEN || d.run.losses >= 1) {
    d.done = true;
    d.reward = REWARDS[d.run.wins];
    d.best = Math.max(d.best || 0, d.run.wins);
    d.runs = (d.runs || 0) + 1;
    if (d.reward) Season.payCareers(d.reward);
  }
  persist(d);
  return d;
}
