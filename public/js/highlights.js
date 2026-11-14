// The highlight director and the halftime story.
//
// The director watches the game like a TV producer: every play gets an excitement score from what actually happened
// (an alley-oop, a dunk over a defender, a long three, a block at the rim, a buzzer-beater, a steal that turns into a
// bucket, the shot that ends a run or takes the lead). Sequences are joined into one clip. When the show needs a reel,
// pickReel() chooses the best few with variety, so it is never six threes by the same player.
// gameStory() reads the box score the way an analyst would: what decided the half and what to change in the second.

const FT = 3.281;                                              // feet in a metre
const periodName = (p) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
const short = (p) => (p && p.data ? `${p.data.first[0]}. ${p.data.last}` : 'a defender');
const FAMILY = { dunk: 'dunk', alley: 'dunk', three: 'three', logo: 'three', layup: 'finish', mid: 'finish', block: 'block', blockscore: 'block', steal: 'steal', stealscore: 'steal', ankles: 'ankles' };
const ICON = { dunk: '🔥', alley: '🚀', three: '🎯', logo: '🌋', layup: '🏀', mid: '🏀', block: '🛑', blockscore: '🛑', steal: '✋', stealscore: '⚡', ankles: '🕺', buzzer: '⏱️', winner: '🏆' };
const MIN_SCORE = 2.4;
const REPLAY_SCORE = 8.5;                                      // plays this good get an instant replay during the game...
const REPLAY_GAP = 80;                                         // ...but never more than one in 80 seconds of game time (a game-winner always does)                                         // plays below this never make the reel

const scoreLine = (g) => {
  const h = g.home.score, a = g.away.score;
  return h === a ? `Tied ${h}-${a}` : `${(h > a ? g.home : g.away).data.id} ${Math.max(h, a)}-${Math.min(h, a)}`;
};

// ---------- Words for a play ----------
export function describe(e) {
  const f = e.flags || {}, p = e.player, nm = short(p), ft = e.dist ? Math.round(e.dist * FT) : 0;
  let h, d, icon = ICON[e.kind] || '🏀';
  const tail = [];
  if (f.and1) tail.push('and draws the foul');
  if (f.endsRun) tail.push(`to end ${/^(8|11|18)/.test(String(f.endsRun)) ? 'an' : 'a'} ${f.endsRun}-0 run`);
  if (f.goAhead && !f.winner) tail.push('to take the lead');
  else if (f.tie) tail.push('to tie it up');
  if (f.clutch && !f.winner && !f.buzzer) tail.push('in crunch time');
  const tailText = tail.length ? ' ' + tail.join(' ') : '';
  switch (e.kind) {
    case 'dunk': case 'alley': {
      const sty = f.style;
      h = f.winner ? 'GAME-WINNING SLAM' : f.alley ? 'ALLEY-OOP SLAM' : f.contested ? 'POSTERIZED!' : sty === 'windmill' ? 'WINDMILL JAM' : sty === 'tomahawk' ? 'TOMAHAWK SLAM' : f.fb ? 'FAST-BREAK SLAM' : f.and1 ? 'AND-ONE SLAM' : 'THROWS IT DOWN';
      d = f.alley ? `${nm} finishes the lob from ${short(f.assist)}` : f.contested && e.contester ? `${nm} dunks it right over ${short(e.contester)}` : sty === 'windmill' ? `${nm} winds it up and slams it home` : sty === 'tomahawk' ? `${nm} rips it back and hammers it down` : f.fb ? `${nm} finishes the break with a slam` : `${nm} throws it down`;
      icon = f.alley ? '🚀' : '🔥';
      break;
    }
    case 'three': case 'logo': {
      h = f.winner ? 'GAME-WINNING THREE' : f.and1 ? 'FOUR-POINT PLAY' : f.logo ? 'FROM WAY DOWNTOWN' : f.deep ? 'DEEP THREE' : f.heat ? 'HEAT CHECK, SPLASH' : f.clutch ? 'CLUTCH THREE' : 'THREE-POINTER';
      d = `${nm} drains a ${ft}-footer${f.contested ? ' with a hand in his face' : ''}${f.heat && !f.contested ? ' to stay on fire' : ''}`;
      icon = f.logo ? '🌋' : '🎯';
      break;
    }
    case 'layup': case 'mid': {
      const sty = f.style;
      h = f.winner ? 'GAME-WINNER' : f.and1 ? 'AND-ONE' : sty === 'floater' ? 'FLOATER' : sty === 'reverse' ? 'REVERSE LAYUP' : sty === 'euro' ? 'EURO-STEP FINISH' : sty === 'fadeaway' ? 'FADEAWAY' : sty === 'stepback' ? 'STEP-BACK JUMPER' : f.fb ? 'FAST-BREAK FINISH' : 'TOUGH BUCKET';
      d = `${nm} ${e.kind === 'layup' ? 'finishes at the rim' : `hits a ${ft}-foot jumper`}${f.contested ? ' through a defender' : ''}`;
      break;
    }
    case 'block': {
      h = e.flags && e.flags.rim ? 'DENIED AT THE RIM' : 'REJECTED!';
      d = `${nm} swats ${short(e.victim)}'s shot away`;
      icon = '🛑';
      break;
    }
    case 'blockscore': {
      h = 'BLOCK AND FINISH';
      d = e.thief === p ? `${nm} swats it away and finishes the other way` : `${short(e.thief)} swats it away, then ${nm} finishes the other way`;
      icon = '🛑';
      break;
    }
    case 'steal': {
      h = 'PICKED CLEAN';
      d = `${nm} takes it from ${short(e.victim)}`;
      icon = '✋';
      break;
    }
    case 'stealscore': {
      const fin = f.dunk ? 'with a slam' : f.three ? 'with a three' : 'at the rim';
      h = f.dunk ? 'STEAL AND SLAM' : f.three ? 'STEAL AND THREE' : 'STEAL AND SCORE';
      d = e.thief && e.thief !== p ? `${short(e.thief)} steals it from ${short(e.victim)}, and ${nm} finishes ${fin}` : `${nm} steals it from ${short(e.victim)} and finishes ${fin}`;
      icon = '⚡';
      break;
    }
    case 'ankles': {
      h = e.scored ? 'ANKLES BROKEN, BUCKET' : 'ANKLE BREAKER';
      d = e.scored ? `${nm} crosses ${short(e.victim)} out of his shoes and scores` : `${nm} leaves ${short(e.victim)} on the floor`;
      icon = '🕺';
      break;
    }
    default: h = 'HIGHLIGHT'; d = nm;
  }
  if (f.buzzer && !f.winner) h = f.halfEnd ? 'BEATS THE HALF BUZZER' : 'BUZZER-BEATER';
  if (f.winner) icon = '🏆';
  else if (f.buzzer) icon = '⏱️';
  e.headline = h;
  e.detail = d + tailText;
  e.icon = icon;
  const ck = /:/.test(String(e.clock)) ? e.clock : `0:${String(e.clock).padStart(4, '0')}`;
  e.meta = `${periodName(e.period)} ${ck} · ${e.scoreText || ''}`.trim();
  const lead = h.charAt(0) + h.slice(1).toLowerCase();
  e.call = `${lead}${/[!?]$/.test(lead) ? '' : '.'} ${e.detail}.`;
  e.text = `${e.headline}: ${e.detail}`;
  return e;
}

// ---------- The director ----------
export class Director {
  constructor(game) { this.g = game; this.seq = 0; this.open = null; this.runSnap = { team: null, pts: 0 }; }

  note(type, d) {
    const g = this.g;
    if (g.opts.attract || g.opts.tutorial || g.opts.practice) return;
    try {
      if (type === 'score') this.onScore(d);
      else if (type === 'block') this.onBlock(d);
      else if (type === 'steal' || type === 'intercept') this.onSteal(d);
      else if (type === 'ankles') this.onAnkles(d);
    } catch (err) { console.warn('[highlights]', err); }   // a highlight problem must never break the game
  }

  // Adds a play to the reel and starts recording its clip. Returns the entry.
  add(entry, t0, until) {
    const g = this.g;
    entry.id = ++this.seq; entry.fam = FAMILY[entry.kind] || entry.kind; entry.period = g.period; entry.clock = g.clockText();
    entry.scoreText = scoreLine(g); entry.tAbs = g.time; entry.frames = null;
    describe(entry);
    g.reel = g.reel || [];
    g.reel.push(entry);
    if (g.recording) entry.clip = { entry, t0, until };
    if (entry.clip) g.pendingClips.push(entry.clip);
    while (g.reel.length > 26) {                                // keep the best; forget the dullest
      let lo = 0; g.reel.forEach((e, i) => { if (e.score < g.reel[lo].score) lo = i; });
      const gone = g.reel.splice(lo, 1)[0];
      const k = g.pendingClips.findIndex((c) => c.entry === gone); if (k >= 0) g.pendingClips.splice(k, 1);
      if (this.open && this.open.entry === gone) this.open = null;
    }
    return entry;
  }

  onScore(d) {
    const g = this.g, p = d.player, team = d.team, opp = g.other(team), sh = d.shot || {};
    if (!p) return;
    const after = team.score - opp.score, before = after - d.pts;
    const dist = sh.dist || 0;
    const f = {
      style: sh.style, and1: !!sh.fouled, fb: !!sh.fb, heat: !!p.onFire, assist: d.assist || null,
      contested: sh.contest != null && sh.contest < (d.kind === 'dunk' ? 1.6 : 1.2),
      deep: d.pts === 3 && dist >= 8.2, logo: d.pts === 3 && dist >= 9.3,
    };
    f.alley = d.kind === 'dunk' && !!d.assist && sh.assistStyle === 'lob';
    f.clutch = g.period >= 4 && g.gameClock < 120 && Math.abs(after) <= 6;
    f.goAhead = before < 0 && after > 0; f.tie = after === 0 && before < 0;      // a real lead change, not the first basket of the game
    f.buzzer = !!d.buzzer; f.winner = f.buzzer && g.period >= 4 && before <= 0 && after > 0; f.halfEnd = f.buzzer && g.period === 2;

    let s, kind;
    if (d.kind === 'dunk') {
      kind = f.alley ? 'alley' : 'dunk'; s = 6;
      if (f.alley) s += 3;
      if (f.style === 'windmill' || f.style === 'tomahawk') s += 2;
      if (f.contested) s += 2;
    } else if (d.pts === 3) {
      kind = f.logo ? 'logo' : 'three'; s = 3.4;
      if (f.deep) s += 1.5;
      if (f.logo) s += 1.5;
      if (f.contested) s += 1;
      if (f.heat) s += 1;
    } else if (d.kind === 'layup' || ['reverse', 'euro', 'floater'].includes(f.style)) {
      kind = 'layup'; s = 2;
      if (['reverse', 'euro', 'floater'].includes(f.style)) s += 1;
      if (f.contested) s += 1;
    } else {
      kind = 'mid'; s = 1.5;
      if (['fadeaway', 'stepback'].includes(f.style)) s += 1;
      if (f.contested) s += 1;
    }
    if (f.fb) s += 1;
    if (f.and1) s += d.pts === 3 ? 5 : 3;
    if (f.clutch) s *= 1.5;
    if (f.goAhead) s += f.clutch ? 2.5 : 1.2; else if (f.tie) s += 1;
    const run = g.run;
    if (run && run.team === team && run.pts >= 10) s += 1;
    if (this.runSnap.team && this.runSnap.team !== team && this.runSnap.pts >= 8) { s += 1.5; f.endsRun = this.runSnap.pts; }
    this.runSnap = run ? { team: run.team, pts: run.pts } : this.runSnap;
    if (f.buzzer) s += f.winner ? 14 : f.halfEnd ? 5 : 3.5;
    if (team.isUser) s *= 1.12;
    if (p.data && p.data.isMe) s *= 1.5;

    const until = g.time + (f.buzzer ? 2.4 : 1.7);
    // A steal, block or ankle-breaker just before this basket: it is one play, so it becomes one clip
    const o = this.open;
    if (o && o.team === team && g.time - o.t < o.win && (o.type !== 'ankles' || o.entry.player === p)) {
      const e = o.entry;
      e.thief = e.player; e.player = p; e.assist = d.assist || null; e.scored = true; e.dist = dist; e.flags = f; e.contester = sh.contester || null;
      e.kind = o.type === 'steal' ? 'stealscore' : o.type === 'block' ? 'blockscore' : 'ankles';
      e.score = e.score + s * 0.6 + 1;                       // the finish counts, and so does turning the play into points
      e.key = g.time; e.focus = p; e.tAbs = g.time; e.period = g.period; e.clock = g.clockText(); e.scoreText = scoreLine(g);
      if (e.clip) e.clip.until = until;
      describe(e);
      this.open = null;
      this.maybeReplay(e);
      return;
    }
    if (s < MIN_SCORE) return;
    const poss = g.possStart != null ? g.possStart - 0.8 : g.time - 5;
    const t0 = Math.min(g.time - 3.2, Math.max(poss, g.time - 8));
    const e = this.add({ kind, score: s, player: p, team: team.data.id, teamObj: team, assist: d.assist || null, flags: f, dist, contester: sh.contester || null, key: g.time, focus: p }, t0, until);
    this.maybeReplay(e);
  }

  // A play this big is shown again in the next dead ball, if it has been a while since the last replay
  maybeReplay(e) {
    const g = this.g;
    if (e.score < REPLAY_SCORE) return;
    const must = e.flags && e.flags.winner;
    if (!must && g.time - (g.lastInstantT == null ? -999 : g.lastInstantT) < REPLAY_GAP) return;
    if (!g.instantQueue || e.score > g.instantQueue.score) g.instantQueue = e;
  }

  onBlock(d) {
    const g = this.g, q = d.player, v = d.victim;
    if (!q) return;
    let s = 4 + (d.kind === 'rim' ? 1 : 0) + (v && (v.state === 'dunk' || v.state === 'layup') ? 1.5 : 0);
    const clutch = g.period >= 4 && g.gameClock < 120 && Math.abs(g.home.score - g.away.score) <= 6;
    if (clutch) s *= 1.3;
    if (q.team.isUser) s *= 1.12;
    if (q.data && q.data.isMe) s *= 1.5;
    const e = this.add({ kind: 'block', score: s, player: q, victim: v, team: q.team.data.id, teamObj: q.team, flags: { rim: d.kind === 'rim', clutch }, key: g.time, focus: q }, g.time - 3.2, g.time + 1.4);
    this.open = { type: 'block', team: q.team, t: g.time, win: 6.5, entry: e };
  }

  onSteal(d) {
    const g = this.g, p = d.player;
    if (!p) return;
    let s = 2.6;
    if (p.team.isUser) s *= 1.12;
    if (p.data && p.data.isMe) s *= 1.5;
    const e = this.add({ kind: 'steal', score: s, player: p, victim: d.victim, team: p.team.data.id, teamObj: p.team, flags: {}, key: g.time, focus: p }, g.time - 2.0, g.time + 2.4);
    this.open = { type: 'steal', team: p.team, t: g.time, win: 6.5, entry: e };
  }

  onAnkles(d) {
    const g = this.g, p = d.player;
    if (!p) return;
    const e = this.add({ kind: 'ankles', score: 2.2, player: p, victim: d.victim, team: p.team.data.id, teamObj: p.team, flags: {}, key: g.time, focus: p }, g.time - 1.8, g.time + 3.6);
    this.open = { type: 'ankles', team: p.team, t: g.time, win: 3.6, entry: e };
  }
}

// ---------- Picking the reel ----------
// The best n plays with variety: not the same kind or the same player over and over, not clustered in the same minute.
export function pickReel(entries, n = 5) {
  const pool = entries.filter((e) => e.frames && e.frames.length >= 6);
  const left = pool.slice().sort((a, b) => b.score - a.score);
  const picked = [];
  while (picked.length < n && left.length) {
    let bi = -1, bs = -1e9;
    left.forEach((e, i) => {
      let adj = e.score;
      for (const q of picked) {
        if (q.fam === e.fam) adj -= picked.filter((x) => x.fam === e.fam).length >= 2 ? 6 : 2.4;
        if (q.player === e.player) adj -= 1.8;
        if (q.period === e.period && Math.abs(q.tAbs - e.tAbs) < 25) adj -= 1.5;
      }
      if (adj > bs) { bs = adj; bi = i; }
    });
    if (bs < (picked.length < 3 ? 0.8 : 2.2)) break;              // always try for three; after that only genuinely good plays
    picked.push(left.splice(bi, 1)[0]);
  }
  // Defense belongs in a highlight package: swap the weakest non-top play for the best block or steal, if there is one
  if (picked.length >= 4 && !picked.some((e) => ['block', 'steal'].includes(e.fam))) {
    const d = left.filter((e) => ['block', 'steal'].includes(e.fam) && e.score >= 3.5).sort((a, b) => b.score - a.score)[0];
    if (d) {
      const order = picked.slice().sort((a, b) => a.score - b.score);
      const out = order[0] === picked.slice().sort((a, b) => b.score - a.score)[0] ? order[1] : order[0];
      picked.splice(picked.indexOf(out), 1, d);
    }
  }
  const best = picked.slice().sort((a, b) => b.score - a.score)[0];
  picked.forEach((e) => { e.best = e === best; });
  return picked.sort((a, b) => a.period - b.period || a.tAbs - b.tAbs);
}

// ---------- The halftime story ----------
const sum = (t, k) => [...t.players, ...t.bench].reduce((a, p) => a + p.stats[k], 0);
function numbers(t) {
  const all = [...t.players, ...t.bench];
  const x = t.extra || { paint: 0, fb: 0, pot: 0 };
  return {
    fgm: sum(t, 'fgm'), fga: sum(t, 'fga'), tpm: sum(t, 'tpm'), tpa: sum(t, 'tpa'), ftm: sum(t, 'ftm'), fta: sum(t, 'fta'),
    reb: sum(t, 'reb'), ast: sum(t, 'ast'), stl: sum(t, 'stl'), blk: sum(t, 'blk'), to: sum(t, 'to'), pf: sum(t, 'pf'),
    paint: x.paint, fb: x.fb, pot: x.pot, bench: all.filter((p) => !p.starter).reduce((a, p) => a + p.stats.pts, 0),
  };
}
const pct = (m, a) => (a ? Math.round((m / a) * 100) : 0);
const rating = (p) => { const s = p.stats; return s.pts + s.reb * 1.2 + s.ast * 1.5 + s.stl * 2 + s.blk * 2 - s.to; };   // the same formula as Player of the Game
const statLine = (p) => { const s = p.stats; return `${s.pts} PTS · ${s.reb} REB · ${s.ast} AST`; };
const shootLine = (p) => { const s = p.stats; return `${s.fgm}/${s.fga} FG${s.tpa ? ` · ${s.tpm}/${s.tpa} 3PT` : ''}`; };

export function gameStory(g, opts = {}) {
  const final = !!opts.final;
  const A = g.away, H = g.home, me = g.user || H, op = g.other(me);
  const nA = numbers(A), nH = numbers(H), N = new Map([[A, nA], [H, nH]]);
  const nm = (t) => t.data.name;
  const lead = H.score - A.score, leader = lead >= 0 ? H : A, trailer = lead >= 0 ? A : H;

  // Team comparison rows (away on the left, home on the right, the way the score is shown)
  const rows = [
    { label: 'Field goals', a: pct(nA.fgm, nA.fga), h: pct(nH.fgm, nH.fga), fmt: (v) => `${v}%`, sa: `${nA.fgm}/${nA.fga}`, sh: `${nH.fgm}/${nH.fga}` },
    { label: '3-pointers', a: pct(nA.tpm, nA.tpa), h: pct(nH.tpm, nH.tpa), fmt: (v) => `${v}%`, sa: `${nA.tpm}/${nA.tpa}`, sh: `${nH.tpm}/${nH.tpa}` },
    { label: 'Free throws', a: nA.ftm, h: nH.ftm, fmt: (v) => v, sa: `${nA.ftm}/${nA.fta}`, sh: `${nH.ftm}/${nH.fta}` },
    { label: 'Rebounds', a: nA.reb, h: nH.reb },
    { label: 'Assists', a: nA.ast, h: nH.ast },
    { label: 'Steals', a: nA.stl, h: nH.stl },
    { label: 'Blocks', a: nA.blk, h: nH.blk },
    { label: 'Turnovers', a: nA.to, h: nH.to, low: true },
    { label: 'Paint points', a: nA.paint, h: nH.paint },
    { label: 'Fast-break points', a: nA.fb, h: nH.fb },
    { label: 'Points off steals', a: nA.pot, h: nH.pot },
    { label: 'Bench points', a: nA.bench, h: nH.bench },
  ];

  // Stars of the half
  const everyone = [...A.players, ...A.bench, ...H.players, ...H.bench].filter((p) => p.stats.sec > 0 || p.stats.pts > 0);
  const best = (t) => [...t.players, ...t.bench].filter((p) => p.stats.sec > 0 || p.stats.pts > 0).sort((a, b) => rating(b) - rating(a)).slice(0, 2);
  const stars = [...best(A), ...best(H)];
  const winnerTeam = H.score >= A.score ? H : A;
  const potw = (final ? everyone.filter((p) => p.team === winnerTeam) : everyone).sort((a, b) => rating(b) - rating(a))[0] || null;

  // What the analysts would point at: each item has a weight (how loud the story is)
  const items = [];
  const cmp = (key, label, hi, mk) => { const d = N.get(H)[key] - N.get(A)[key]; if (Math.abs(d) >= hi) { const w = d > 0 ? H : A, l = d > 0 ? A : H; items.push(mk(w, l, N.get(w), N.get(l), Math.abs(d))); } };
  for (const t of [A, H]) {
    const n = N.get(t), fg = pct(n.fgm, n.fga), tp = pct(n.tpm, n.tpa);
    if (n.fga >= 8 && fg >= 55) items.push({ w: fg - 45, who: 1, type: 'fg', text: `${nm(t)} are shooting ${fg}% from the field, ${n.fgm} of ${n.fga}. They cannot miss.` });
    if (n.fga >= 8 && fg <= 33) items.push({ w: 42 - fg, who: 1, type: 'fg', text: `${nm(t)} are ${n.fgm}-for-${n.fga} from the floor. Nothing is falling.` });
    if (n.tpa >= 6 && tp >= 50) items.push({ w: tp - 33, who: 1, type: 'three', text: `${nm(t)} are ${n.tpm}-for-${n.tpa} from deep. That is a ${tp} percent night from three.` });
    if (n.tpa >= 6 && tp <= 20) items.push({ w: 32 - tp, who: 1, type: 'three', text: `${nm(t)} are just ${n.tpm}-for-${n.tpa} from three. The rim is not friendly.` });
    if (n.blk >= 4) items.push({ w: n.blk * 3, who: 0, type: 'blk', text: `${nm(t)} have ${n.blk} blocks. Nothing is easy at the rim against them.` });
  }
  cmp('reb', 'reb', 5, (w, l, a, b, d) => ({ w: d * 2.2, who: 0, type: 'reb', text: `${nm(w)} own the glass, ${a.reb} boards to ${b.reb}. Second chances are killing ${nm(l)}.` }));
  // for turnovers the team with MORE is the story, so w is the careless team here
  cmp('to', 'to', 3, (w, l, a, b, d) => ({ w: d * 3.2, who: 2, type: 'to', text: `${nm(w)} have turned it over ${a.to} times to ${b.to} for ${nm(l)}${b.pot > 0 ? `, and ${b.pot} points came the other way off them` : ''}. Take care of the ball.` }));
  cmp('paint', 'paint', 8, (w, l, a, b, d) => ({ w: d * 1.4, who: 0, type: 'paint', text: `${nm(w)} have ${a.paint} points in the paint to ${b.paint}. They are living at the rim.` }));
  cmp('fb', 'fb', 6, (w, l, a, b) => ({ w: (a.fb - b.fb) * 1.8, who: 1, type: 'fb', text: `${nm(w)} are running: ${a.fb} fast-break points to ${b.fb}. Get back on defense!` }));
  cmp('bench', 'bench', 10, (w, l, a, b, d) => ({ w: d * 1.1, who: 2, type: 'bench', text: `The ${nm(w)} bench is winning its minutes, ${a.bench} points to ${b.bench}.` }));
  cmp('fta', 'fta', 6, (w, l, a, b) => ({ w: (a.fta - b.fta) * 1.3, who: 2, type: 'ft', text: `${nm(w)} have shot ${a.fta} free throws to ${b.fta}. They keep attacking and getting the call.` }));
  if (g.bestRun && g.bestRun.pts >= 10) items.push({ w: g.bestRun.pts * 1.3, who: 1, type: 'run', text: `${nm(g.bestRun.team)} ripped off a ${g.bestRun.pts}-0 run in ${periodName(g.bestRun.period || 1)}. That was the swing.` });
  for (const p of everyone) {
    if (p.stats.pf >= 3) items.push({ w: p.stats.pf * 4, who: 2, type: 'pf', text: `${p.data.last} has ${p.stats.pf} fouls already. The coach has to think about sitting him.` });
  }
  items.sort((a, b) => b.w - a.w);

  // Keys for the user's team
  const mn = N.get(me), on = N.get(op), keys = [];
  const key = (w, text) => keys.push({ w, text });
  if (mn.to >= on.to + 3) key((mn.to - on.to) * 3, on.pot > 0 ? `Protect the ball: ${mn.to} turnovers have led to ${on.pot} points for ${nm(op)}.` : `Protect the ball: ${mn.to} turnovers to their ${on.to}.`);
  if (on.reb >= mn.reb + 4) key((on.reb - mn.reb) * 2, `Crash the glass. ${nm(op)} lead the boards ${on.reb} to ${mn.reb}.`);
  if (mn.reb >= on.reb + 4) key(4, `Keep boxing out: you lead the rebounds ${mn.reb} to ${on.reb}.`);
  if (on.tpa >= 6 && pct(on.tpm, on.tpa) >= 45) key(pct(on.tpm, on.tpa) / 4, `Run them off the line: ${nm(op)} are ${on.tpm}-for-${on.tpa} from three. Tighten the defense (Tactics).`);
  if (mn.tpa >= 6 && pct(mn.tpm, mn.tpa) <= 28) key(8, `You are ${mn.tpm}-for-${mn.tpa} from three. Move the ball for better looks, or attack the rim.`);
  if (on.paint >= mn.paint + 8) key((on.paint - mn.paint) * 1.2, `${nm(op)} are winning the paint ${on.paint} to ${mn.paint}. Send help earlier and contest at the rim.`);
  if (mn.paint >= on.paint + 8) key(5, `Keep attacking the paint, where you lead ${mn.paint} to ${on.paint}.`);
  if (on.fb >= 8) key(on.fb, `Get back in transition: ${nm(op)} have ${on.fb} fast-break points.`);
  if (mn.fb >= 8) key(5, `Your transition game is working (${mn.fb} fast-break points). Keep pushing the pace.`);
  if (on.fta >= mn.fta + 6) key(6, `Stay disciplined: ${nm(op)} have been to the line ${on.fta} times to your ${mn.fta}.`);
  for (const p of [...me.players, ...me.bench]) {
    if (p.stats.pf >= 3) key(p.stats.pf * 4, `${p.data.last} has ${p.stats.pf} fouls. Consider a rest, or ask him to defend without reaching.`);
  }
  for (const p of me.players) if (p.energy < 0.5) key((1 - p.energy) * 12, `${p.data.last} is at ${Math.round(p.energy * 100)}% energy. Sub him early in the third.`);
  const hot = [...op.players, ...op.bench].sort((a, b) => b.stats.pts - a.stats.pts)[0];
  if (hot && hot.stats.pts >= 14) key(hot.stats.pts, `Make ${hot.data.last} work. He has ${hot.stats.pts} points already.`);
  const myLead = me.score - op.score;
  keys.sort((a, b) => b.w - a.w);
  const keyText = keys.map((k) => k.text).slice(0, 3);
  const fallback = myLead >= 0 ? ['Keep the ball moving and stay in your tactics.', 'Do not relax: a run changes a game in a minute.', 'Defend without fouling to stay out of foul trouble.'] : ['You are in this one. Pick up the pressure and get stops.', 'Look for the quick shot early in the clock to shorten the gap.', 'One run changes it: stay patient and stay together.'];
  for (const f of fallback) if (keyText.length < 3) keyText.push(f);

  // The analysts' lines, in the order they are spoken
  const lines = [];
  const absLead = Math.abs(lead);
  if (final) {
    lines.push([1, absLead >= 20 ? `${nm(leader)} win it going away, ${leader.score} to ${trailer.score}. That was a rout.` : absLead <= 3 ? `${nm(leader)} survive a thriller, ${leader.score} to ${trailer.score}!` : `${nm(leader)} take this one, ${leader.score} to ${trailer.score}.`]);
  } else {
    lines.push([1, absLead <= 2 ? `All square at the break, ${A.score} to ${H.score}. This one is a street fight.` : absLead >= 12 ? `${nm(leader)} are running away with it, up ${absLead}. ${nm(trailer)} need answers fast.` : `${nm(leader)} lead by ${absLead} at the half, ${leader.score} to ${trailer.score}. Nothing is decided yet.`]);
  }
  if (potw) lines.push([potw.stats.pts >= 14 ? 0 : 1, `${potw.data.first} ${potw.data.last} ${final ? 'is the player of the game' : 'has been the best player on the floor'}: ${statLine(potw)}, ${shootLine(potw)}. ${potw.stats.pts >= 14 ? 'He is cooking!' : 'Quietly dominant.'}`]);
  const used = new Set();
  for (const it of items) { if (lines.length >= 5) break; if (used.has(it.type)) continue; used.add(it.type); lines.push([it.who, it.text]); }
  if (lines.length < 3) lines.push([0, 'Cleaner than it looks on paper. Both teams were still finding their rhythm.']);
  if (final) {
    lines.push([2, 'That is the ballgame. Check the box score for the full story.']);
  } else {
    lines.push([2, `For ${nm(me)}: ${keyText[0]}`]);
    if (keyText[1]) lines.push([1, keyText[1]]);
    lines.push([1, 'Fresh legs and a new half. Let us get back to it!']);
  }

  return { rows, stars, potw, keys: keyText, lines, lead, numbers: { A: nA, H: nH } };
}

export { periodName };
