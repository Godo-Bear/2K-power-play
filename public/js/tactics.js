// Team tactics, like FC's Edit Tactic screen: pick a preset or drag the sliders to change how a team plays.
// Every value is 0-100. Teams without saved tactics get a style that suits their roster.
export const SLIDERS = [
  { k: 'pace', label: 'Pace', lo: 'Patient', hi: 'Push the tempo', tip: 'How fast the team brings the ball up and takes its shot.' },
  { k: 'threes', label: '3-Point Focus', lo: 'Mid-range', hi: 'Fire from deep', tip: 'How much the team hunts three-pointers, and how wide it spaces the floor.' },
  { k: 'attack', label: 'Attack the Rim', lo: 'Settle', hi: 'Drive hard', tip: 'How often ball handlers drive, and how much the big men cut.' },
  { k: 'passing', label: 'Ball Movement', lo: 'Iso ball', hi: 'Share the ball', tip: 'How quickly the team passes to find a better shot.' },
  { k: 'glass', label: 'Crash the Glass', lo: 'Get back', hi: 'Go for boards', tip: 'How many players crash for offensive rebounds.' },
  { k: 'pressure', label: 'Defensive Pressure', lo: 'Give space', hi: 'Smother', tip: 'How tight defenders guard and how often they go for steals. Risky: more reach-in fouls.' },
  { k: 'line', label: 'Defensive Line', lo: 'Sag to the paint', hi: 'Step up high', tip: 'Low packs the paint and helps early. High guards the perimeter and stays on shooters.' },
];
export const PRESETS = {
  balanced: { label: 'Balanced', desc: 'No weaknesses, no extremes', v: [50, 50, 50, 50, 50, 50, 50] },
  paceSpace: { label: 'Pace & Space', desc: 'Threes and ball movement', v: [70, 88, 38, 72, 30, 50, 60] },
  insideOut: { label: 'Inside-Out', desc: 'Attack the paint, own the boards', v: [45, 32, 82, 60, 78, 55, 32] },
  fastBreak: { label: 'Fast Break', desc: 'Run on every possession', v: [95, 55, 75, 45, 28, 72, 72] },
  isoStar: { label: 'Iso Star', desc: 'Give it to your best player', v: [40, 50, 72, 14, 38, 50, 50] },
  grind: { label: 'Half-Court Grind', desc: 'Slow it down, share it, rebound', v: [18, 40, 50, 68, 66, 62, 28] },
  press: { label: 'Full Pressure', desc: 'Smother ball handlers', v: [64, 50, 52, 50, 40, 94, 88] },
};
export const PRESET_KEYS = Object.keys(PRESETS);

const KEY = 'pph-tactics';
function readAll() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }

function fromVals(v) { const o = {}; SLIDERS.forEach((s, i) => { o[s.k] = Math.max(0, Math.min(100, Math.round(v[i]))); }); return o; }
export function presetValues(key) { return fromVals(PRESETS[key].v); }

// The style a CPU team plays when nobody has edited it, picked from what its roster is good at
export function defaultPreset(team) {
  const r = (team.roster || []).slice(0, 5);
  if (!r.length) return 'balanced';
  const avg = (k) => r.reduce((a, p) => a + (p.ratings?.[k] || 60), 0) / r.length;
  const score = {
    paceSpace: avg('three') + avg('pass') * 0.4,
    insideOut: avg('inside') + avg('reb') * 0.5 + avg('block') * 0.3,
    fastBreak: avg('speed') * 1.2 + avg('dunk') * 0.3,
    grind: avg('def') + avg('pass') * 0.3,
    balanced: 0,
  };
  const mean = Object.values(score).slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  let best = 'balanced', bs = mean + 6;
  for (const [k, v] of Object.entries(score)) if (k !== 'balanced' && v > bs) { best = k; bs = v; }
  return best;
}

// { preset, vals } for a team: what the player saved, or the roster's natural style
export function getTactics(team) {
  const saved = readAll()[team.id];
  if (saved && saved.vals) return { preset: saved.preset || 'custom', vals: fromVals(SLIDERS.map((s) => saved.vals[s.k] ?? 50)), saved: true };
  const p = defaultPreset(team);
  return { preset: p, vals: presetValues(p), saved: false };
}
export function saveTactics(team, preset, vals) {
  const all = readAll();
  all[team.id] = { preset, vals };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
export function resetTactics(team) {
  const all = readAll(); delete all[team.id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
export function matchPreset(vals) {
  for (const [k, p] of Object.entries(PRESETS)) if (SLIDERS.every((s, i) => Math.abs(vals[s.k] - p.v[i]) <= 3)) return k;
  return 'custom';
}
// 0..1 values the game uses
export function tacticsNorm(vals) { const o = {}; for (const s of SLIDERS) o[s.k] = (vals[s.k] ?? 50) / 100; return o; }

// Strengths and weaknesses, like the tick list in FC
export function traits(v) {
  const good = [], bad = [];
  if (v.pace >= 70) good.push('Pushes the pace'); else if (v.pace <= 30) good.push('Patient half-court team');
  if (v.threes >= 72) good.push('Hunts three-pointers'); else if (v.threes <= 30) bad.push('Rarely shoots threes');
  if (v.attack >= 70) good.push('Attacks the rim'); else if (v.attack <= 30) bad.push('Settles for jumpers');
  if (v.passing >= 68) good.push('Moves the ball'); else if (v.passing <= 28) bad.push('Lots of one-on-one play');
  if (v.glass >= 68) good.push('Crashes the boards'); else if (v.glass <= 28) good.push('Gets back in transition');
  if (v.pressure >= 72) { good.push('Smothering defense'); bad.push('Risk of reach-in fouls'); } else if (v.pressure <= 28) bad.push('Gives shooters space');
  if (v.line >= 72) good.push('Sticks to shooters'); else if (v.line <= 28) good.push('Protects the paint');
  if (v.line >= 72 && v.attack >= 70) bad.push('Open lanes for drivers behind the press');
  if (v.pace >= 80 && v.passing <= 35) bad.push('Rushed, unorganized offense');
  if (v.glass >= 75 && v.pace >= 70) bad.push('Leaks out in transition');
  return { good, bad };
}
