// Fictional league data. All teams, logos and players are original.

const FIRST = ['Marcus', 'Dante', 'Jalen', 'Theo', 'Isaiah', 'Rico', 'Malik', 'Andre', 'Kofi', 'Luka', 'Niko', 'Tyrese',
  'Cam', 'Darius', 'Elijah', 'Jonah', 'Kai', 'Mateo', 'Omar', 'Quinn', 'Rashad', 'Silas', 'Tariq', 'Victor', 'Xavier',
  'Zion', 'Bruno', 'Caleb', 'Desmond', 'Emeka', 'Felix', 'Gabe', 'Hugo', 'Idris', 'Jace', 'Keon', 'Levi', 'Moses'];
const LAST = ['Okafor', 'Reyes', 'Holloway', 'Brandt', 'Vance', 'Mbeki', 'Calloway', 'Thornton', 'Ibarra', 'Novak',
  'Whitfield', 'Ashby', 'Crane', 'Delacroix', 'Ellison', 'Fontaine', 'Garrow', 'Hastings', 'Iverly', 'Jansen', 'Kessler',
  'Langford', 'Mercer', 'Nwosu', 'Oyelaran', 'Prescott', 'Quarles', 'Ramsey', 'Sorensen', 'Tolliver', 'Underwood',
  'Valdez', 'Wexford', 'Yarbrough', 'Zeller', 'Abara', 'Barlow', 'Castellan'];

export const TEAMS = [
  { id: 'BCB', city: 'Bay City', name: 'Breakers', primary: '#0fb5ae', secondary: '#0b1f3a', accent: '#ffffff', ovr: 86 },
  { id: 'IVF', city: 'Iron Valley', name: 'Forge', primary: '#ff6a13', secondary: '#23262b', accent: '#f2f2f2', ovr: 84 },
  { id: 'NHS', city: 'Neon Harbor', name: 'Surge', primary: '#ff2e88', secondary: '#120a1c', accent: '#35f0ff', ovr: 85 },
  { id: 'CAP', city: 'Capital', name: 'Monarchs', primary: '#5b2bd1', secondary: '#f5c542', accent: '#ffffff', ovr: 88 },
  { id: 'DSC', city: 'Desert', name: 'Scorpions', primary: '#d9a441', secondary: '#9e1b1b', accent: '#1a1a1a', ovr: 82 },
  { id: 'NSW', city: 'Northshore', name: 'Wolves', primary: '#8fa3b8', secondary: '#0e2a47', accent: '#d8f3ff', ovr: 83 },
  { id: 'MTV', city: 'Metro', name: 'Voltage', primary: '#ffd60a', secondary: '#111111', accent: '#ffffff', ovr: 87 },
  { id: 'RDG', city: 'Redgate', name: 'Phoenix', primary: '#e63946', secondary: '#1d3557', accent: '#f1faee', ovr: 81 },
];

const POSITIONS = [
  { pos: 'PG', height: 1.88, bias: { three: 6, mid: 3, inside: -4, dunk: -6, pass: 12, handle: 12, speed: 8, def: 0, block: -14, steal: 8, reb: -12 } },
  { pos: 'SG', height: 1.96, bias: { three: 10, mid: 6, inside: -2, dunk: 0, pass: 2, handle: 6, speed: 6, def: 2, block: -10, steal: 4, reb: -8 } },
  { pos: 'SF', height: 2.03, bias: { three: 3, mid: 4, inside: 2, dunk: 6, pass: 0, handle: 2, speed: 3, def: 5, block: -3, steal: 3, reb: -2 } },
  { pos: 'PF', height: 2.08, bias: { three: -4, mid: 1, inside: 6, dunk: 6, pass: -4, handle: -6, speed: -2, def: 4, block: 6, steal: -2, reb: 8 } },
  { pos: 'C', height: 2.13, bias: { three: -14, mid: -4, inside: 10, dunk: 10, pass: -6, handle: -14, speed: -8, def: 4, block: 14, steal: -6, reb: 14 } },
];

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#3d2716', '#ffdbac', '#a0673a'];
const HAIR = ['#111111', '#2b1b10', '#5a3a1a', '#8a6a3a', '#222222', '#c9a26b'];

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampRating(v) { return Math.max(40, Math.min(99, Math.round(v))); }

function buildRoster(team, teamIndex) {
  const rnd = seeded(1337 + teamIndex * 7919);
  const usedNums = new Set();
  return POSITIONS.map((p, i) => {
    const ratings = {};
    for (const [k, b] of Object.entries(p.bias)) {
      ratings[k] = clampRating(team.ovr - 6 + b + (rnd() - 0.5) * 14 + (i === teamIndex % 5 ? 5 : 0));
    }
    let num;
    do { num = Math.floor(rnd() * 55); } while (usedNums.has(num));
    usedNums.add(num);
    const vals = Object.values(ratings);
    const ovr = clampRating(vals.reduce((a, b) => a + b, 0) / vals.length + 6);
    return {
      first: FIRST[Math.floor(rnd() * FIRST.length)],
      last: LAST[Math.floor(rnd() * LAST.length)],
      pos: p.pos,
      number: num,
      height: p.height + (rnd() - 0.5) * 0.08,
      skin: SKIN[Math.floor(rnd() * SKIN.length)],
      hair: HAIR[Math.floor(rnd() * HAIR.length)],
      hairStyle: Math.floor(rnd() * 4),
      headband: rnd() < 0.2,
      sleeve: rnd() < 0.35,
      ratings,
      ovr,
    };
  });
}

TEAMS.forEach((t, i) => { t.roster = buildRoster(t, i); });

export const DIFFICULTY = {
  rookie:  { label: 'Rookie',      aiShot: 0.78, aiDef: 0.6,  aiSteal: 0.5, greenWindow: 0.085, react: 0.45 },
  pro:     { label: 'Pro',         aiShot: 0.92, aiDef: 0.8,  aiSteal: 0.8, greenWindow: 0.065, react: 0.3 },
  allstar: { label: 'All-Star',    aiShot: 1.02, aiDef: 0.95, aiSteal: 1.0, greenWindow: 0.05, react: 0.2 },
  hof:     { label: 'Hall of Fame',aiShot: 1.12, aiDef: 1.1,  aiSteal: 1.25, greenWindow: 0.038, react: 0.12 },
};
