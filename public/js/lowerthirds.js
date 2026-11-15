// TV lower-thirds: a name-and-numbers bar that slides in at the corner of the screen for the moments a broadcast would put one up
// (a named dunk, a scoring milestone, a double-double, a hot streak, foul trouble, a big run, the start of a quarter).
// It only listens to the game's events and draws into #lt, so the game never waits for it and nothing here can break a game.
const ORD = ['', '1ST', '2ND', '3RD', '4TH'];
const SHOW = 4300;       // how long a card stays
const GAP = 1500;        // the pause between two cards
const STALE = 9000;      // a card still waiting after this long is no longer news

// How a finish is named on screen: [title, tag, priority]. Plain jumpers and layups get nothing.
const FINISH = {
  windmill: ['Windmill jam', 'Signature slam', 2],
  tomahawk: ['Tomahawk jam', 'Signature slam', 2],
  alley: ['Alley-oop', 'In the air', 2],
  twohand: ['Two-hand slam', 'Power finish', 0],
  onehand: ['One-hand jam', 'Power finish', 0],
  euro: ['Euro step', 'Slick finish', 1],
  reverse: ['Reverse layup', 'Slick finish', 1],
  floater: ['Floater', 'Finesse', 0],
  fadeaway: ['Fadeaway', 'Tough shot', 1],
  stepback: ['Step-back', 'Makes the space', 1],
};

const name = (p) => `${p.data.first} ${p.data.last}`.trim();
// Dark or white lettering, whichever reads on the team colour
const ink = (hex) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#fff';
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0a0e18' : '#fff';
};
const statLine = (p) => {
  const s = p.stats, bits = [`${s.pts} PTS`];
  if (s.reb >= 3) bits.push(`${s.reb} REB`);
  if (s.ast >= 3) bits.push(`${s.ast} AST`);
  if (s.stl >= 2) bits.push(`${s.stl} STL`);
  if (s.blk >= 2) bits.push(`${s.blk} BLK`);
  return bits.join(' · ');
};

let token = 0, timers = [];
const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };

export function stopLowerThirds() {
  token++;
  timers.forEach(clearTimeout); timers = [];
  const el = document.getElementById('lt');
  if (el) el.innerHTML = '';
}

// game: the Game to watch; on(): whether the player has them switched on
export function attachLowerThirds(game, { on = () => true } = {}) {
  const el = document.getElementById('lt');
  if (!el || !game) return;
  stopLowerThirds();
  const mine = token;
  const queue = [], lastShown = {};
  let showing = false, lastEnd = 0;

  const hidden = () => !on() || document.hidden || game.state === 'over' || game.replay || game.halftime || game.recap || (game.opts && game.opts.attract);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show(c) {
    showing = true;
    lastShown[c.key] = performance.now();
    const card = document.createElement('div');
    card.className = 'lt-card';
    card.style.setProperty('--tc', c.color || '#35f0ff');
    card.style.setProperty('--ink', ink(c.color || '#35f0ff'));
    card.innerHTML = `<div class="lt-badge">${esc(c.badge)}</div><div class="lt-body"><span class="lt-tag">${esc(c.tag)}</span><b class="lt-title">${esc(c.title)}</b><span class="lt-sub">${esc(c.sub)}</span></div>`;
    el.innerHTML = '';
    el.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('in')));
    later(() => {
      card.classList.add('out');
      later(() => { if (mine !== token) return; card.remove(); showing = false; lastEnd = performance.now(); pump(); }, 380);
    }, SHOW);
  }

  function pump() {
    if (mine !== token || showing || !queue.length) return;
    if (hidden()) { later(pump, 700); return; }
    const wait = lastEnd + GAP - performance.now();
    if (wait > 0) { later(pump, wait); return; }
    const c = queue.shift();
    if (performance.now() - c.at > STALE && c.pri < 3) { pump(); return; }
    show(c);
  }

  // key: the same kind of card is not repeated for `cool` ms; pri: who goes first and who may be dropped
  function add(c) {
    if (mine !== token || !on()) return;
    const now = performance.now();
    if (lastShown[c.key] && now - lastShown[c.key] < (c.cool || 22000)) return;
    if (queue.some((q) => q.key === c.key)) return;
    c.at = now;
    queue.push(c);
    queue.sort((a, b) => b.pri - a.pri || a.at - b.at);
    queue.length = Math.min(queue.length, 3);
    later(pump, 250);        // a beat to let everything from the same moment arrive, so the biggest card goes first
  }

  const teamColor = (t) => (t && t.data && (t.data.primary || t.data.accent)) || '#35f0ff';
  const forPlayer = (p, extra) => ({ color: teamColor(p.team), badge: `#${p.data.number}`, ...extra });

  const doubles = (p) => {
    const st = p.stats, n = ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => st[k] >= 10).length;
    if (n >= 3 && !p._ltTD) { p._ltTD = true; p._ltDD = true; add(forPlayer(p, { key: `td${p.data.number}${p.team.data.id}`, pri: 3, tag: 'History', title: 'Triple-double', sub: `${name(p)} · ${statLine(p)}`, cool: 1e9 })); }
    else if (n >= 2 && !p._ltDD) { p._ltDD = true; add(forPlayer(p, { key: `dd${p.data.number}${p.team.data.id}`, pri: 1, tag: 'Milestone', title: 'Double-double', sub: `${name(p)} · ${statLine(p)}`, cool: 1e9 })); }
  };

  game.on((type, d) => {
    try {
      switch (type) {
        case 'periodStart': {
          const n = d.period, label = n <= 4 ? `${ORD[n]} QUARTER` : n === 5 ? 'OVERTIME' : `${n - 4}OT`;
          const h = game.home, a = game.away;
          add({ key: `q${n}`, pri: 3, cool: 1e9, color: '#35f0ff', badge: n <= 4 ? `Q${n}` : 'OT', tag: n === 1 ? 'Tip-off' : 'Next up', title: label, sub: `${a.data.id} ${a.score} · ${h.data.id} ${h.score}` });
          break;
        }
        case 'score': {
          const p = d.player;
          if (!p) break;
          const s = d.shot || {}, fin = FINISH[s.style];
          const isThree = d.pts === 3;
          const before = p.stats.pts - d.pts, mile = [10, 20, 30, 40, 50, 60].find((m) => before < m && p.stats.pts >= m);
          if (mile) add(forPlayer(p, { key: `pts${p.data.number}${p.team.data.id}${mile}`, pri: mile >= 30 ? 3 : mile >= 20 ? 2 : 1, tag: 'Milestone', title: `${mile} points`, sub: `${name(p)} · ${statLine(p)}`, cool: 1e9 }));
          else if (fin && (d.kind === 'dunk' || d.kind === 'layup' || s.style === 'fadeaway' || (s.style === 'stepback' && isThree))) {
            add(forPlayer(p, { key: `fin${s.style}`, pri: fin[2], tag: fin[1], title: isThree && s.style === 'stepback' ? 'Step-back three' : fin[0], sub: `${name(p)} · ${statLine(p)}`, cool: fin[2] >= 2 ? 16000 : 45000 }));
          }
          doubles(p);
          if (d.assist) doubles(d.assist);
          const r = game.run;
          if (r && r.team && r.pts >= 10) add({ key: `run${r.team.data.id}`, pri: 2, cool: 40000, color: teamColor(r.team), badge: `${r.pts}-0`, tag: 'Momentum', title: `${r.pts}-0 run`, sub: `${r.team.data.city} ${r.team.data.name}` });
          break;
        }
        case 'rebound': if (d.player) doubles(d.player); break;
        case 'steal': if (d.player) doubles(d.player); break;
        case 'block': {
          const b = d.player || d.blocker;
          if (b && b.stats) doubles(b);
          break;
        }
        case 'onFire': {
          const p = d.player;
          if (p) add(forPlayer(p, { key: `fire${p.data.number}${p.team.data.id}`, pri: 2, tag: 'Hot hand', title: 'On fire', sub: `${name(p)} · ${p.streak} straight makes`, cool: 60000 }));
          break;
        }
        case 'foul': {
          const p = d.def;
          if (p && p.stats && (p.stats.pf === 3 || p.stats.pf === 4)) add(forPlayer(p, { key: `ft${p.data.number}${p.team.data.id}${p.stats.pf}`, pri: 1, tag: 'Watch out', title: 'Foul trouble', sub: `${name(p)} · ${p.stats.pf} fouls`, cool: 1e9 }));
          break;
        }
        case 'foulOut': {
          const p = d.player;
          if (p) add(forPlayer(p, { key: `fo${p.data.number}${p.team.data.id}`, pri: 2, tag: 'Disqualified', title: 'Fouled out', sub: `${name(p)} · ${statLine(p)}`, cool: 1e9 }));
          break;
        }
        default: break;
      }
    } catch { /* a lower-third must never get in the way of the game */ }
  });
}
