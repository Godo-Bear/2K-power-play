import * as THREE from 'three';
import { C } from './arena.js';
import { Player } from './player.js';
import { getTactics, tacticsNorm } from './tactics.js';
import { DIFFICULTY } from './data.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { custom, applyCustomPlayer, updateCustomPlayer, makeCustomBall } from './assets.js';
import { simCareerLine } from './season.js';

const G = 9.8;
const BALL_R = 0.12;
const METER_TIME = 0.62;   // seconds for meter to reach top
const METER_TARGET = 0.88; // ideal release point on the meter (0..1)
const v3 = () => new THREE.Vector3();
const tmp = v3(), tmp2 = v3();
const rand = (a, b) => a + Math.random() * (b - a);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Soft additive glow sprite that rides with the ball
function makeBallHalo() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,170,70,0.9)');
  grad.addColorStop(0.35, 'rgba(255,120,30,0.45)');
  grad.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(0.62, 0.62, 1);
  s.renderOrder = 4;
  return s;
}

function ballTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#d8661f'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,200,150'},${Math.random() * 0.12})`;
    g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = '#1a0d05'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, 128); g.lineTo(512, 128); g.stroke();
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(384, 0); g.lineTo(384, 256); g.stroke();
  for (const cx of [0, 256, 512]) {
    g.beginPath(); g.ellipse(cx, 128, 70, 128, 0, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Game {
  constructor(scene, arena, homeData, awayData, opts, hud) {
    this.scene = scene;
    this.arena = arena;
    this.hud = hud;
    this.opts = opts;
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.pro;
    this.quarterLen = opts.quarterMinutes * 60;
    this.time = 0;

    const mkTeam = (data, isHome) => ({
      data,
      isHome,
      score: 0,
      dir: isHome ? 1 : -1,
      isUser: (opts.userSide === 'home') === isHome,
      jerseyColor: isHome ? '#f5f5f5' : data.primary,
      trimColor: isHome ? data.primary : data.accent,
      players: [],
      quarterScores: [],
      timeouts: 5,
      fouls: 0,
    });
    this.home = mkTeam(homeData, true);
    this.away = mkTeam(awayData, false);
    this.teams = [this.home, this.away];
    for (const t of this.teams) {
      t.players = t.data.roster.slice(0, 5).map((d, i) => new Player(d, t, i, scene));
      t.bench = t.data.roster.slice(5, 10).map((d, i) => new Player(d, t, i, scene));
      t.pendingSubs = [];
      // How the team plays: saved or roster-based tactics, and how sharp it is for its overall rating (88 = sharp, 80 = sloppy)
      t.tac = tacticsNorm(getTactics(t.data).vals);
      t.skill = ((t.data.ovr || 83) - 83) / 4;
      t.players.forEach((p, i) => { p.rid = i; });
      t.bench.forEach((p, i) => { p.rid = i + 5; });
      // Controller: which input drives this team (null = CPU), the player it controls, and its shot meter
      t.human = t.isUser || !!opts.versus;
      t.input = t.isUser ? input : (opts.versus ? opts.remoteInput || null : null);
      t.cp = null;
      t.lock = null;
      t.meter = { visible: false, value: 0, target: METER_TARGET, win: this.diff.greenWindow, result: null };
      for (const p of t.bench) p.root.visible = false;
      for (const p of [...t.players, ...t.bench]) applyCustomPlayer(p);
    }
    this.autoSubs = opts.autoSubs !== false;
    this.slowT = 0;
    this.focus = null;
    this.user = this.teams.find((t) => t.isUser);
    this.cpu = this.other(this.user);

    // Ball
    this.ball = {
      mesh: new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 24), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.65 })),
      pos: v3(), vel: v3(),
      state: 'held', holder: null, lastTouch: null,
      shot: null, pass: null, dribblePhase: 0, lastCos: 1,
      ignore: null, ignoreT: 0, reboundable: false,
      lastPasser: null, lastPassTime: -99, spin: 0,
    };
    this.ball.mesh.castShadow = true;
    if (custom.ballTexture) this.ball.mesh.material.map = custom.ballTexture;
    const customBall = makeCustomBall(BALL_R);
    if (customBall) { this.ball.mesh.material.visible = false; this.ball.mesh.add(customBall); }
    scene.add(this.ball.mesh);
    // Make the ball easy to follow: a slightly bigger ball, a soft glow around it, and a ring on the floor under it
    this.ball.mesh.scale.setScalar(1.2);
    this.ball.halo = makeBallHalo();
    this.ball.mesh.add(this.ball.halo);
    this.ball.ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 36), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.8, depthWrite: false }));
    this.ball.ring.rotation.x = -Math.PI / 2;
    this.ball.ring.renderOrder = 3;
    scene.add(this.ball.ring);

    this.period = 1;
    this.gameClock = this.quarterLen;
    this.shotClock = 24;
    this.shotClockFrozen = false;
    this.state = 'live';
    this.stateT = 0;
    this.possession = this.home;
    this.firstPossession = Math.random() < 0.5 ? this.home : this.away;
    this.user.cp = this.user.players[0];
    this.buzzerPlayed = false;
    this.cameraShake = 0;
    this.netAnim = [0, 0];
    this.inbounder = null;
    this.pendingInbound = null;
    this.events = [];
    this.listeners = [];
    this.run = { team: null, pts: 0 };
    this.contactCd = 0;
    this.ft = null;
    this.celebrateTeam = null;
    this.tutorialPossession = null;
    this.user.lock = opts.playerLock >= 0 ? this.user.players[opts.playerLock] : null;

    this.startPeriod();
    if (!opts.tutorial && !opts.guest) this.setupTipoff();
  }

  // Start play after the intro (or straight away): a jump ball if one is set up
  begin() { this.state = this.tip ? 'tipoff' : 'live'; }

  // ---------- Opening jump ball ----------
  setupTipoff() {
    const b = this.ball;
    for (const t of this.teams) {
      const d = t.dir;
      // Centers face each other at mid-court, everyone else rings the circle
      const spots = [[-4.2, 0], [-1.2, -3.6], [1.4, 3.6], [-1.6, 3.4], [-0.62, 0]];
      t.players.forEach((p, i) => {
        p.pos.set(d * spots[i][0], 0, d * spots[i][1]);
        p.vel.set(0, 0, 0); p.desired.set(0, 0, 0); p.state = 'idle'; p.jumpT = -1; p.y = 0;
        p.facing = p.targetFacing = Math.atan2(-p.pos.x, -p.pos.z);
      });
      // You jump for the tip with your center, unless you're locked to one player
      if (t.human) this.setCtl(t, t.lock || t.players[4]);
    }
    b.state = 'tip'; b.holder = null; b.shot = null; b.pass = null;
    b.pos.set(0, 1.25, 0); b.vel.set(0, 0, 0);
    this.tip = { t: 0, jumped: [null, null], done: false };
    this.shotClockFrozen = true;
    this.state = 'tipoff';
  }

  updateTipoff(dt) {
    const tip = this.tip, b = this.ball;
    const TOSS = 1.3, HIT = 1.02; // seconds: when the ball goes up, and when it can be tipped after that
    const before = tip.t;
    tip.t += dt;
    if (before === 0) {
      const mine = this.user.cp && this.user.cp === (this.user.players[4] || this.user.players[this.user.players.length - 1]);
      this.hud.toast('JUMP BALL', mine ? 'Press SHOOT to jump for it' : 'Your center jumps for it', 2);
    }
    const tt = tip.t - TOSS;
    if (tt < 0) { b.pos.set(0, 1.25, 0); return; }
    if (before - TOSS < 0) sfx.whistle();
    b.pos.set(0, 1.25 + 6.9 * tt - 0.5 * G * tt * tt, 0);
    b.spin = 5;
    this.teams.forEach((t, i) => {
      const c = t.players[4] || t.players[t.players.length - 1];
      if (tip.jumped[i] !== null || !c) return;
      const human = t.human && t.input && !this.autoplay && t.cp === c; // only if you're the one jumping
      if (human ? t.input.pressed.shoot || tt > HIT + 0.05 : tt >= c.tipAt) {
        tip.jumped[i] = tt;
        c.jump(0.62, 0.8);
      }
      if (c.tipAt === undefined) c.tipAt = HIT - 0.3 + (Math.random() - 0.5) * (0.34 - c.r.block / 400);
    });
    if (tt >= HIT && !tip.done) {
      tip.done = true;
      // Whoever is highest when the ball comes down wins the tap
      const score = this.teams.map((t) => {
        const c = t.players[4] || t.players[t.players.length - 1];
        return c ? c.reach + c.r.reb / 400 + c.perk.reb * 0.5 + Math.random() * 0.06 : -1;
      });
      const winner = this.teams[score[0] >= score[1] ? 0 : 1];
      const c = winner.players[4] || winner.players[winner.players.length - 1];
      const pg = winner.players[0];
      this.firstPossession = winner;
      this.possession = winner;
      b.state = 'pass'; b.lastTouch = winner;
      b.pass = { from: c, to: pg, t: 0, dur: 0.55, start: b.pos.clone(), arc: 0.25, checked: new Set(this.other(winner).players) };
      this.shotClock = 24; this.shotClockFrozen = false;
      this.tip = null;
      this.state = 'live';
      for (const t of this.teams) if (t.human && t.lock && t.cp !== t.lock) this.setCtl(t, t.lock);
      sfx.pass(); sfx.cheer(0.5);
      this.hud.toast('TIP-OFF', `${winner.data.name} win the jump ball`, 1.8);
      this.emit('tipoff', { team: winner, player: c });
    }
  }

  other(team) { return team === this.home ? this.away : this.home; }
  // The local player's view of the controllers (kept for the HUD and single-player code)
  get userPlayer() { return this.user.cp; }
  set userPlayer(p) { this.user.cp = p; }
  get lock() { return this.user.lock; }
  set lock(p) { this.user.lock = p; }
  get meter() { return this.user.meter; }
  // True when `p` is the player a human is currently controlling
  ctl(p) { return !this.autoplay && p.team.human && p.team.cp === p && !!p.team.input; }
  playerById(id) { const t = this.teams[id >= 10 ? 1 : 0]; return [...t.players, ...t.bench].find((p) => p.rid === id % 10) || null; }
  idOf(p) { return p ? (p.team === this.home ? 0 : 10) + p.rid : -1; }
  on(fn) { this.listeners.push(fn); }
  // Tutorial/practice: the CPU defense doesn't contest or steal unless practice sets it to "live"
  passive() { return !!this.opts.tutorial && this.practiceDefense !== 'live'; }
  // Practice: how many players each team has on the floor (0-5)
  setTeamSize(team, n) {
    team.full = team.full || team.players.slice();
    n = Math.max(team === this.user ? 1 : 0, Math.min(5, n));
    team.full.forEach((p, i) => { p.root.visible = i < n; p.setControlled(false); p.index = i; });
    team.players = team.full.slice(0, n);
    if (team.human) this.setCtl(team, team.players.includes(team.cp) ? team.cp : team.players[0]);
    if (!this.ball.holder || !this.user.players.includes(this.ball.holder)) this.forcePossession(this.user.cp || this.user.players[0]);
  }
  emit(type, data = {}) {
    this.noteHighlight(type, data);
    for (const fn of this.listeners) fn(type, data);
  }

  // Keeps the best plays of the game for the halftime show
  noteHighlight(type, d) {
    if (this.opts.attract || this.opts.tutorial || this.opts.practice) return;
    let pri = 0, kind = '', verb = '';
    if (type === 'score') {
      if (d.buzzer) { pri = 5; kind = 'buzzer'; verb = 'hits the buzzer-beater'; }
      else if (d.kind === 'dunk') { pri = 4; kind = 'dunk'; verb = 'throws it down'; }
      else if (d.pts === 3) { pri = 3; kind = 'three'; verb = 'drains a three'; }
      else if (d.assist && d.kind !== 'dunk') { pri = 1; kind = 'assist'; verb = `finishes off a pass from #${d.assist.data.number} ${d.assist.data.last}`; }
    } else if (type === 'block') { pri = 4; kind = 'block'; verb = `swats #${d.victim.data.number} ${d.victim.data.last}'s shot away`; }
    else if (type === 'steal') { pri = 3; kind = 'steal'; verb = `picks the pocket of #${d.victim.data.number} ${d.victim.data.last}`; }
    else if (type === 'intercept') { pri = 3; kind = 'steal'; verb = `jumps the passing lane`; }
    if (!pri || !d.player && !d.team) return;
    const pl = d.player;
    this.reel = this.reel || [];
    this.reel.push({ pri, kind, period: this.period, clock: this.clockText(), team: (pl ? pl.team : d.team).data.id, name: pl ? `#${pl.data.number} ${pl.data.last}` : '', text: pl ? `${pl.data.first[0]}. ${pl.data.last} ${verb}` : verb, pts: d.pts || 0 });
  }
  // Tutorial can force who gets the ball after dead balls
  nextOffense(team) {
    if (this.tutorialPossession) return this.tutorialPossession === 'user' ? this.user : this.cpu;
    return team;
  }
  trackRun(team, pts) {
    if (this.run.team === team) this.run.pts += pts; else this.run = { team, pts };
  }
  ftRating(p) { return Math.max(50, Math.min(95, Math.round(p.r.mid * 0.55 + p.r.three * 0.45 + 4))); }
  hoopOf(team) { return tmp2.set(team.dir * C.HOOP_X, C.RIM_H, 0).clone(); }
  get allPlayers() { return [...this.home.players, ...this.away.players]; }

  // ---------- Setup ----------
  startPeriod() {
    const off = this.period % 2 === 1 ? this.firstPossession : this.other(this.firstPossession);
    const def = this.other(off);
    this.possession = off;
    off.players.forEach((p, i) => {
      p.pos.set(-off.dir * (i === 0 ? 0.6 : 3.5), 0, [0, -4.5, 4.5, -2, 2][i]);
      p.vel.set(0, 0, 0); p.state = 'idle'; p.jumpT = -1; p.y = 0;
    });
    def.players.forEach((p, i) => {
      const m = off.players[i % Math.max(1, off.players.length)];
      if (!m) return;
      p.pos.set(m.pos.x + off.dir * 2.2, 0, m.pos.z * 0.8);
      p.vel.set(0, 0, 0); p.state = 'idle'; p.jumpT = -1; p.y = 0;
    });
    this.setHolder(off.players[0], { silent: true });
    this.gameClock = this.period > 4 ? Math.max(60, this.quarterLen * 0.42) : this.quarterLen;
    this.shotClock = 24;
    this.shotClockFrozen = false;
    this.buzzerPlayed = false;
    this.state = 'live';
    for (const t of this.teams) t.fouls = 0;
    for (const t of this.teams) if (t.human && !t.benchedMe) this.setCtl(t, t.lock || t.players[0]);
  }

  // Manual player switch (button). Works on offense and defense.
  switchPlayer(team = this.user) {
    // Career "just my player": you stay on your player for the whole game
    if (team === this.user && this.opts.strictLock) {
      if (team.lock) this.hud.feedback('PLAYING AS YOUR PLAYER ONLY', '#ffd60a');
      return; // locked on your player, or he's on the bench
    }
    const ps = team.players;
    let next;
    if (team.lock) {
      next = ps[(team.lock.index + 1) % ps.length];
      team.lock = next;
    } else if (this.possession !== team || !this.ball.holder) {
      const target = this.ball.holder ? this.ball.holder.pos : this.ball.pos;
      const sorted = ps.filter((q) => q !== team.cp).sort((a, c) => hdist(a.pos, target) - hdist(c.pos, target));
      next = sorted[0];
    } else {
      next = ps[((team.cp ? team.cp.index : 0) + 1) % ps.length];
    }
    if (next) { this.setCtl(team, next); this.emit('switch', { player: next }); }
  }

  // Give a human team control of a player. Only the local user's player gets the ring marker.
  setCtl(team, p) {
    if (team === this.user && team.cp) team.cp.setControlled(false);
    team.cp = p;
    if (team === this.user) p.setControlled(!this.opts.attract, p.data.isMe ? 0xffd60a : 0x35f0ff);
  }
  setUserPlayer(p) { this.setCtl(this.user, p); }

  // ---------- Ball ownership ----------
  setHolder(p, { silent = false, steal = false } = {}) {
    const b = this.ball;
    const prevTeam = this.possession;
    const wasReboundable = b.reboundable;
    b.state = 'held'; b.holder = p; b.shot = null; b.pass = null;
    b.lastTouch = p.team;
    b.reboundable = false;
    p.holdT = 0; p.decT = 0.3;
    if (!silent) sfx.catch();
    if (p.team !== prevTeam) {
      this.possession = p.team;
      this.shotClock = 24;
      this.shotClockFrozen = false;
      if (wasReboundable) p.stats.reb++;
    } else if (wasReboundable) {
      p.stats.reb++;
      if (this.shotClockFrozen) this.shotClock = Math.max(this.shotClock, 14);
      this.shotClockFrozen = false;
    }
    for (const t of this.teams) {
      if (!t.human || t.lock || t.benchedMe) continue; // player lock: never auto-switch
      if (p.team === t) this.setCtl(t, p);
      // Now on defense: control the defender closest to the ball
      else if (prevTeam === t) this.setCtl(t, this.closestTo(t.players, p.pos));
    }
    void steal;
  }

  closestTo(players, pos, exclude = null) {
    let best = null, bd = 1e9;
    for (const q of players) { if (q === exclude) continue; const d = hdist(q.pos, pos); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  nearestDefender(p) {
    let best = null, bd = 1e9;
    for (const q of this.other(p.team).players) { const d = hdist(q.pos, p.pos); if (d < bd) { bd = d; best = q; } }
    return { p: best, d: bd };
  }

  isThree(team, x, z) {
    const hx = team.dir * C.HOOP_X;
    const cornerX = C.HOOP_X - C.THREE_R * Math.cos(Math.asin(C.CORNER_Z / C.THREE_R));
    if (team.dir * x >= cornerX) return Math.abs(z) >= C.CORNER_Z;
    return Math.hypot(x - hx, z) >= C.THREE_R;
  }

  // Base make probability before timing
  shotChance(p, pos = p.pos) {
    const hoop = this.hoopOf(p.team);
    const d = Math.hypot(pos.x - hoop.x, pos.z);
    const three = this.isThree(p.team, pos.x, pos.z);
    let base, rating;
    if (d < 1.6) { base = 0.68; rating = p.r.inside; }
    else if (d < 3.2) { base = 0.52; rating = p.r.inside; }
    else if (!three) { base = 0.45 - (d - 3.2) * 0.012; rating = p.r.mid; }
    else { base = 0.39 - Math.max(0, d - 7.6) * 0.06; rating = p.r.three; }
    base *= 0.55 + rating / 100 * 0.6;
    base *= 0.88 + 0.12 * p.energy;
    if (p.onFire) base *= 1.12;
    // Contest
    let contest = 1.08;
    for (const q of this.other(p.team).players) {
      const dd = hdist(q.pos, pos);
      // Defender between shooter and hoop counts more
      const toHoop = tmp.set(hoop.x - pos.x, 0, hoop.z - pos.z).normalize();
      const toDef = tmp2.set(q.pos.x - pos.x, 0, q.pos.z - pos.z).normalize();
      const front = toHoop.dot(toDef) > 0.2 ? 1 : 0.6;
      let c = 1.08;
      if (dd < 0.9) c = 0.5; else if (dd < 1.5) c = 0.7; else if (dd < 2.4) c = 0.88;
      c = 1 - (1 - c) * front * (q.airborne ? 1.25 : 1);
      contest = Math.min(contest, c);
    }
    // Play style perks: shooters hit more of their spot, creators shrug off a hand in the face, defenders bother more
    const pk = p.perk;
    if (contest < 1) contest += (1 - contest) * Math.min(0.6, pk.resist);
    let defBonus = 0;
    for (const q of this.other(p.team).players) if (q.perk.contestD && hdist(q.pos, pos) < 2.4) defBonus = Math.max(defBonus, q.perk.contestD);
    contest = Math.max(0.05, contest - defBonus * (1 - Math.min(1, contest)) * 1.5);
    // Playmakers set teammates up: a shot right off their pass is a little easier
    const b = this.ball;
    if (b.lastPasser && b.lastPasser !== p && b.lastPasser.team === p.team && this.time - b.lastPassTime < 2.5) contest += b.lastPasser.perk.passSpeed * 0.2;
    const spot = d < 3.2 ? pk.inside : !three ? pk.mid : pk.three;
    return { p: Math.max(0.02, Math.min(0.95, base * contest + spot)), three, d, contest };
  }

  // ---------- Actions ----------
  // Labels shown when the game picks a special move for you
  static MOVE_LABEL = {
    fadeaway: 'FADEAWAY', stepback: 'STEP-BACK', floater: 'FLOATER', euro: 'EURO STEP', reverse: 'REVERSE LAYUP',
    twohand: 'TWO-HAND SLAM', windmill: 'WINDMILL!', tomahawk: 'TOMAHAWK!', alley: 'ALLEY-OOP!', spin: 'SPIN MOVE', hesi: 'HESITATION',
  };
  announceMove(p, style) {
    this.emit('style', { player: p, style });
    if (p.team === this.user && this.ctl(p) && Game.MOVE_LABEL[style]) this.hud.feedback(Game.MOVE_LABEL[style], '#35f0ff');
  }

  startShot(p) {
    if (this.ball.holder !== p || p.state !== 'idle') return;
    const hoop = this.hoopOf(p.team);
    const d = Math.hypot(p.pos.x - hoop.x, p.pos.z);
    p.faceTarget = hoop;
    p.actionT = 0;
    p.released = false;
    p.rimChecked = null; // fresh attempt: every defender gets a new chance to block it
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const toHoop = tmp.set(hoop.x - p.pos.x, 0, -p.pos.z).normalize().clone();
    const { p: def, d: dd } = this.nearestDefender(p);
    // Is that defender between me and the rim?
    const inFront = !!def && toHoop.dot(tmp2.set(def.pos.x - p.pos.x, 0, def.pos.z - p.pos.z).normalize()) > 0.3;
    const driving = sp > 2.4 && toHoop.x * p.vel.x + toHoop.z * p.vel.z > 1.5;
    let style;
    if (d < 2.6) {
      const canDunk = p.r.dunk >= 68 && (p.sprinting || sp > 3 || d < 1.4) && p.stamina > 0.1;
      p.state = canDunk && Math.random() < 0.4 + p.r.dunk / 200 ? 'dunk' : 'layup';
      if (p.state === 'dunk') {
        // Wide open: show off. Crowded: power it home with two hands.
        if (!def || dd > 3) style = Math.random() < 0.5 ? 'windmill' : 'tomahawk';
        else if (dd < 1.5) style = 'twohand';
        else style = 'onehand';
      } else if (Math.abs(p.pos.z) > 1.0 && p.team.dir * p.pos.x > C.HOOP_X - 0.9) style = 'reverse';
      else if (inFront && dd < 1.7 && sp > 2.4) {
        style = 'euro';
        // Side-step away from the defender before going up
        const side = (def.pos.x - p.pos.x) * toHoop.z - (def.pos.z - p.pos.z) * toHoop.x > 0 ? 1 : -1;
        p.euroDir = new THREE.Vector3(toHoop.z * side, 0, -toHoop.x * side);
      } else style = 'layup';
      p.jump(p.state === 'dunk' ? 0.9 : 0.74, p.state === 'dunk' ? 1.12 : 0.78);
      if (p.state === 'dunk' && !this.opts.tutorial) { this.slowT = 0.75; this.focus = p; this.emit('dunkStart', { player: p }); }
    } else if (d < 4.4 && driving && inFront && dd < 2.4) {
      // A big man waiting at the rim: float it over him
      p.state = 'layup';
      style = 'floater';
      p.jump(0.7, 0.6);
    } else {
      p.state = 'shoot';
      if (inFront && dd < 1.4) {
        style = 'fadeaway';
        p.vel.set(-toHoop.x * 2.6, 0, -toHoop.z * 2.6); // drift away from the defender
      } else {
        style = (p.rhythmT || 0) > 0 ? 'stepback' : sp > 3.5 ? 'pullup' : 'jumper';
        p.vel.multiplyScalar(0.3);
      }
      p.jump(0.86, 0.62);
      p.aiRelease = this.ctl(p) ? null
        : METER_TARGET + (Math.random() - 0.5) * 0.3 * (1.15 - p.r[this.isThree(p.team, p.pos.x, p.pos.z) ? 'three' : 'mid'] / 100);
    }
    p.shotStyle = style;
    this.announceMove(p, style);
  }

  releaseShot(p) {
    if (p.released) return;
    p.released = true;
    const b = this.ball;
    const team = p.team;
    const hoop = this.hoopOf(team);
    const info = this.shotChance(p);
    let prob = info.p;
    let label = null, color = '#fff';
    let airball = false;
    const isUser = this.ctl(p);
    if (p.state === 'shoot') {
      const val = Math.min(1.25, p.actionT / METER_TIME);
      const err = val - METER_TARGET;
      const w = isUser ? this.diff.greenWindow : 0.06;
      const ae = Math.abs(err);
      if (ae <= w) {
        label = 'EXCELLENT'; color = '#3dff7a';
        // A green release by a human almost always goes in, even with a hand in the face
        if (isUser) prob = info.contest >= 0.7 ? 1 : 0.94;
        else prob *= 1.24;
      } else if (ae <= w * 2.5) { label = err < 0 ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE'; color = '#ffd60a'; prob *= 0.78; }
      else if (ae <= w * 5) { label = err < 0 ? 'EARLY' : 'LATE'; color = '#ff8c1a'; prob *= 0.4; }
      else { label = err < 0 ? 'VERY EARLY' : 'VERY LATE'; color = '#ff3b3b'; prob *= 0.08; airball = Math.random() < 0.5; }
      if (isUser) {
        team.meter.result = { label, color, value: val };
        team.meter.hideT = 0.15;
      }
    } else {
      // Layup / dunk
      prob = Math.max(prob, p.state === 'dunk' ? 0.9 : 0.62) * (0.7 + p.r.inside / 330);
      if (p.state === 'dunk') prob = Math.min(0.97, prob * Math.min(1.05, info.contest + 0.25));
    }
    if (!team.human) prob *= this.diff.aiShot * (1 + team.skill * 0.08);
    // The move matters: fades and floaters trade a little accuracy for being hard to contest
    if (label !== 'EXCELLENT' || !isUser) {
      const lift = { fadeaway: info.contest < 0.9 ? 1.2 : 0.96, stepback: 1.07, pullup: 0.97, euro: 1.14, reverse: 1.1, floater: 0.92, twohand: 1.05 }[p.shotStyle];
      if (lift) prob *= lift;
    }
    // Shooting fouls. Whether there was illegal contact is decided now, but nothing is called until the shot
    // comes down: a clean block is never a foul. Fouls need real contact: running into the shooter, or chasing
    // from behind. Standing in front and jumping straight up is a fair contest.
    let fouled = null;
    if (!this.opts.noFouls) {
      const { p: q, d } = this.nearestDefender(p);
      const close = p.state === 'shoot' ? 0.9 : 1.1;
      if (q && d < close) {
        const hx = hoop.x - p.pos.x, hz = -p.pos.z, hl = Math.hypot(hx, hz) || 1;
        const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, dl = Math.hypot(dx, dz) || 1;
        const behind = (hx * dx + hz * dz) / (hl * dl) < -0.2;                  // chasing from behind or the side
        const closing = Math.max(0, -((q.vel.x * dx + q.vel.z * dz) / dl));     // how fast he is running into the shooter
        let fc = (q.team.human ? 0.02 : 0.08) + (close - d) * 0.1 + closing * 0.03 + (behind ? 0.1 : 0) - (q.r.def - 70) / 800;
        if (q.airborne && !behind && closing < 2.5) fc *= 0.35;                // a clean vertical contest
        if (q.team.human) fc *= 0.5;                                           // never punish a person's good defense
        if (Math.random() < Math.max(0.005, Math.min(0.3, fc))) fouled = q;
      }
    }
    if (fouled) prob *= (isUser && label === 'EXCELLENT') ? 0.97 : 0.55; // contact barely affects a perfect release
    prob = Math.min(1, prob);
    if (label === 'EXCELLENT' && isUser && team === this.user) sfx.green();
    const made = Math.random() < prob;
    const pts = info.three ? 3 : 2;
    p.stats.fga++; if (pts === 3) p.stats.tpa++;
    this.emit('shot', { player: p, kind: p.state, label, user: isUser });
    this.launchShot(p, made, pts, p.state, airball);
    b.shot.fouled = fouled;
  }

  launchShot(p, made, pts, kind, airball) {
    const b = this.ball;
    const team = p.team;
    const hoop = this.hoopOf(team);
    const start = b.pos.clone();
    const target = new THREE.Vector3(hoop.x, C.RIM_H + 0.05, 0);
    if (!made) {
      if (airball) {
        target.x -= team.dir * rand(0.5, 0.9); target.z += rand(-0.4, 0.4); target.y = C.RIM_H - 0.1;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const r = rand(0.2, 0.3);
        target.x += Math.cos(ang) * r; target.z += Math.sin(ang) * r;
        target.y = C.RIM_H + 0.03;
      }
    }
    const dist = Math.hypot(target.x - start.x, target.z - start.z);
    const style = kind === 'ft' ? 'ft' : p.shotStyle;
    const T = kind === 'shoot' || kind === 'ft' ? 0.75 + dist * 0.06 : (kind === 'dunk' ? 0.18 : style === 'floater' ? 0.62 + dist * 0.08 : 0.5);
    b.state = 'shot';
    b.holder = null;
    b.lastTouch = team;
    b.shot = { shooter: p, team, made, pts, T, t: 0, target, start, airball, kind, style, checked: new Set(), fouled: null };
    b.vel.set((target.x - start.x) / T, (target.y - start.y + 0.5 * G * T * T) / T, (target.z - start.z) / T);
    b.spin = -8;
    if (kind === 'dunk') { b.vel.set((target.x - start.x) / T, (target.y - start.y) / T - 2, (target.z - start.z) / T); }
  }

  startPass(p, target) {
    if (!target || this.ball.holder !== p) return;
    const b = this.ball;
    const hoop = this.hoopOf(p.team);
    const d = hdist(p.pos, target.pos);
    // The game picks the pass: a lob for an alley-oop, a bounce pass through traffic, or a chest pass
    let style = 'chest';
    const tHoop = Math.hypot(target.pos.x - hoop.x, target.pos.z);
    const lane = this.other(p.team).players.some((q) => {
      const ax = target.pos.x - p.pos.x, az = target.pos.z - p.pos.z;
      const t = ((q.pos.x - p.pos.x) * ax + (q.pos.z - p.pos.z) * az) / (d * d || 1);
      return t > 0.15 && t < 0.85 && Math.hypot(q.pos.x - (p.pos.x + ax * t), q.pos.z - (p.pos.z + az * t)) < 1.0;
    });
    if (tHoop < 3.0 && d > 3 && target.r.dunk >= 70 && !target.airborne && this.nearestDefender(target).d > 0.9 && !this.opts.tutorial && Math.random() < (this.ctl(p) ? 0.8 : 0.4)) style = 'lob';
    else if (lane && d > 2.5) style = 'bounce';
    b.state = 'pass';
    b.holder = null;
    b.lastTouch = p.team;
    const checked = new Set(style === 'lob' ? this.other(p.team).players : []);
    b.pass = { from: p, to: target, t: 0, dur: (style === 'lob' ? Math.max(0.55, d / 10) : Math.max(0.25, d / (style === 'bounce' ? 13 : 15))) / (1 + p.perk.passSpeed), start: b.pos.clone(), arc: style === 'lob' ? 1.5 : 0.2 + d * 0.03, checked, style, bounced: false };
    p.state = 'idle';
    p.faceTarget = null;
    // Passing pose
    p.passT = 0.32; p.passStyle = style;
    const c = Math.cos(p.facing), sn = Math.sin(p.facing);
    const wx = (target.pos.x - p.pos.x) / (d || 1), wz = (target.pos.z - p.pos.z) / (d || 1);
    p.passLocal = [wx * c - wz * sn, wx * sn + wz * c]; // direction of the pass in the passer's own space
    sfx.pass();
    b.lastPasser = p; b.lastPassTime = this.time;
    if (style === 'lob') this.announceMove(p, 'alley');
    this.emit('pass', { player: p, user: this.ctl(p), style });
  }

  pickPassTarget(p, dirX, dirZ) {
    const mates = p.team.players.filter((q) => q !== p);
    const dl = Math.hypot(dirX, dirZ);
    if (dl < 0.2) {
      // no direction: most open teammate weighted by distance
      let best = null, bs = -1e9;
      for (const q of mates) {
        const open = this.nearestDefender(q).d;
        const s = open * 1.2 - hdist(p.pos, q.pos) * 0.15;
        if (s > bs) { bs = s; best = q; }
      }
      return best;
    }
    let best = null, bs = -1e9;
    for (const q of mates) {
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      const dot = (dx * dirX + dz * dirZ) / (l * dl);
      const s = dot * 3 - l * 0.05;
      if (s > bs) { bs = s; best = q; }
    }
    return best;
  }

  attemptSteal(p) {
    if (p.stealCooldown > 0 || p.airborne) return;
    p.stealCooldown = 0.9;
    p.state = 'steal'; p.actionT = 0;
    p.stealStyle = Math.random() < 0.5 ? 'poke' : 'swipe';
    const t = this.ball.holder;
    p.stealTarget = t && t.team !== p.team ? t : null;
    p.stealResolved = false;
    sfx.swipe();
    this.emit('stealAttempt', { player: p, user: this.ctl(p), target: p.stealTarget });
  }

  // The result of a steal lands when the hand reaches the ball, a moment after the button, so the move reads clearly
  resolveSteal(p) {
    p.stealResolved = true;
    const h = p.stealTarget;
    // He already passed or shot, or moved out of reach: a miss
    if (!h || this.ball.holder !== h) { p.stumbleT = 0.25; return; }
    const d = hdist(p.pos, h.pos);
    if (d > 2.1 || h.state !== 'idle') { p.stumbleT = 0.25; return; }
    // Close and well-rated hands win the ball: the closer the lunge ends, the better the odds
    let chance = 0.34 + (p.r.steal - h.r.handle) / 160 + Math.max(0, 1.5 - d) * 0.18 + (Math.hypot(h.vel.x, h.vel.z) > 3 ? 0.05 : 0) + p.perk.steal - h.perk.handle * 0.5;
    chance = Math.max(0.1, Math.min(0.85, chance));
    if ((h.stealImmuneT || 0) > 0) chance = 0; // can't strip a player mid-spin
    if (!p.team.human) chance *= this.diff.aiSteal * 0.7 * (1 + p.team.skill * 0.12);
    else chance += 0.1; // a person has to commit to the lunge and the result lands a beat later, so give it a real boost
    if (Math.random() < chance) {
      const b = this.ball;
      b.state = 'loose'; b.holder = null;
      b.vel.set((p.pos.x - h.pos.x) * 2 + rand(-1.5, 1.5), 1.5, (p.pos.z - h.pos.z) * 2 + rand(-1.5, 1.5));
      b.ignore = h; b.ignoreT = 0.6;
      b.lastTouch = p.team;
      b.reboundable = false;
      p.stats.stl++; h.stats.to++;
      h.stumbleT = 0.35; // the ball handler is rocked
      this.hud.feedback('STOLEN!', p.team.isUser ? '#3dff7a' : '#ff3b3b');
      this.emit('steal', { player: p, victim: h });
      sfx.cheer(0.5);
      this.arena.excitement = Math.min(1, this.arena.excitement + 0.4);
    } else {
      p.stumbleT = 0.3;
      if (!this.opts.noFouls && d < 1.3 && Math.random() < (p.team.human ? 0.07 : 0.14)) this.nonShootingFoul(p, h, 'REACH-IN FOUL');
    }
  }

  // ---------- Fouls ----------
  recordFoul(def, victim, label) {
    def.stats.pf++;
    def.team.fouls++;
    sfx.whistle();
    const bonus = def.team.fouls >= 5 ? ' · BONUS' : '';
    this.hud.toast(label, `#${def.data.number} ${def.data.last} (${def.stats.pf} PF) · Team fouls ${def.team.fouls}${bonus}`, 1.8);
    this.emit('foul', { def, victim, label });
    if (def.stats.pf >= 6 && !def.fouledOut) {
      def.fouledOut = true;
      this.hud.feedback(`${def.data.last.toUpperCase()} FOULED OUT`, '#ff3b3b');
      this.emit('foulOut', { player: def });
    }
  }

  // ---------- Substitutions ----------
  canSubNow() { return ['dead', 'timeout', 'break', 'intro'].includes(this.state); }

  // Ask for a swap between a court slot and a bench slot; happens at the next whistle if play is live
  requestSub(team, courtIdx, benchIdx) {
    const out = team.players[courtIdx], inn = team.bench[benchIdx];
    if (!out || !inn || inn.fouledOut) return false;
    if (this.canSubNow()) { this.substitute(team, courtIdx, benchIdx); return true; }
    team.pendingSubs = team.pendingSubs.filter((q) => q.courtIdx !== courtIdx && q.benchIdx !== benchIdx);
    team.pendingSubs.push({ courtIdx, benchIdx });
    return true;
  }

  substitute(team, courtIdx, benchIdx) {
    const out = team.players[courtIdx], inn = team.bench[benchIdx];
    if (!out || !inn || inn.fouledOut) return;
    if (this.ft && this.ft.shooter === out) return;
    inn.pos.copy(out.pos); inn.vel.set(0, 0, 0); inn.desired.set(0, 0, 0);
    inn.facing = inn.targetFacing = out.facing;
    inn.index = courtIdx; out.index = benchIdx;
    inn.state = 'idle'; inn.jumpT = -1; inn.y = 0; inn.faceTarget = null; inn.stamina = 1;
    out.root.visible = false; inn.root.visible = true;
    out.streak = 0; out.onFire = false;
    team.players[courtIdx] = inn; team.bench[benchIdx] = out;
    const b = this.ball;
    if (b.holder === out) b.holder = inn;
    if (this.inbounder === out) this.inbounder = inn;
    const solo = this.opts.strictLock && team === this.user;
    if (solo && out.data.isMe) {
      // Career "just my player": he's on the bench, so you aren't playing. Nobody else gets your controls.
      team.lock = null; team.benchedMe = true; team.meSlot = courtIdx;
      if (team.cp === out) team.cp = null;
    } else {
      if (team.lock === out) team.lock = inn;
      if (team.cp === out) this.setCtl(team, inn);
    }
    if (solo && inn.data.isMe) { team.benchedMe = false; team.lock = inn; this.setCtl(team, inn); } // back in the game
    out.setControlled(false);
    this.emit('sub', { team, inn, out });
  }

  // Apply queued subs, forced foul-out subs, and automatic fatigue subs
  applySubs() {
    if (this.opts.tutorial) return;
    for (const team of this.teams) {
      for (const q of team.pendingSubs) this.substitute(team, q.courtIdx, q.benchIdx);
      team.pendingSubs = [];
      const auto = team.isUser ? (this.autoSubs || this.autoplay || !!this.opts.guest) : true;
      for (let i = 0; i < 5; i++) {
        const cur = team.players[i];
        // Best available bench player (prefer the same position slot)
        const options = team.bench.map((p, j) => ({ p, j })).filter((o) => !o.p.fouledOut);
        if (!options.length) continue;
        const same = options.find((o) => o.j === i) || options.sort((a, c) => c.p.energy - a.p.energy)[0];
        if (cur.fouledOut) { this.substitute(team, i, same.j); continue; }
        if (!auto) continue;
        if (cur.data.isMe && cur.energy > 0.3) continue; // career: your own player stays in unless exhausted
        const alt = team.bench[i];
        if (!alt || alt.fouledOut) continue;
        const tired = cur.energy < 0.6 && alt.energy > cur.energy + 0.25;
        const starterBack = !cur.starter && alt.starter && alt.energy > 0.9 && !(alt.stats.pf >= 5 && this.period < 4);
        if (tired || starterBack) this.substitute(team, i, i);
      }
    }
  }

  nonShootingFoul(def, victim, label) {
    this.recordFoul(def, victim, label);
    if (def.team.fouls >= 5) { this.startFreeThrows(victim, 2); return; }
    const spot = new THREE.Vector3(Math.max(-C.HALF_L + 1, Math.min(C.HALF_L - 1, victim.pos.x)), 0, Math.sign(victim.pos.z || 1) * (C.HALF_W - 0.25));
    this.beginDead(1.4, victim.team, spot, Math.max(this.shotClock, 14));
  }

  offensiveFoul(holder) {
    holder.stats.pf++;
    this.emit('foul', { def: null, victim: null, label: 'OFFENSIVE FOUL' });
    this.turnover(holder.team, 'OFFENSIVE FOUL');
  }

  // ---------- Free throws ----------
  startFreeThrows(shooter, n) {
    const b = this.ball;
    if (b.state === 'shot') { b.state = 'free'; b.vel.set(rand(-1, 1), 1, rand(-1, 1)); }
    this.state = 'ft';
    this.ft = { shooter, team: shooter.team, remaining: n, total: n, t: 1.4, phase: 'setup' };
    this.applySubs();
    for (const t of this.teams) t.meter.visible = false;
    for (const p of this.allPlayers) { p.state = 'idle'; p.faceTarget = null; p.burstT = 0; }
  }

  positionFT() {
    const f = this.ft, t = f.team, dir = t.dir, hx = dir * C.HOOP_X;
    const sh = f.shooter;
    const hoop = new THREE.Vector3(hx, 0, 0);
    const zs = C.KEY_W / 2 + 0.45;
    const def = this.other(t);
    const defSpots = [[1.75, zs], [1.75, -zs], [3.55, zs], [3.55, -zs], [8.6, 2.5]];
    const offSpots = [[2.65, zs], [2.65, -zs], [8.2, -4], [8.4, 4.5]];
    sh.pos.set(hx - dir * 4.19, 0, 0);
    def.players.forEach((p, i) => p.pos.set(hx - dir * defSpots[i][0], 0, defSpots[i][1]));
    t.players.filter((p) => p !== sh).forEach((p, i) => p.pos.set(hx - dir * offSpots[i][0], 0, offSpots[i][1]));
    for (const p of this.allPlayers) {
      p.vel.set(0, 0, 0); p.desired.set(0, 0, 0); p.jumpT = -1; p.y = 0; p.state = 'idle';
      p.faceTarget = hoop;
      p.facing = p.targetFacing = Math.atan2(hoop.x - p.pos.x, hoop.z - p.pos.z);
    }
    this.setHolder(sh, { silent: true });
  }

  updateFT(dt) {
    const f = this.ft;
    if (!f) return;
    const sh = f.shooter;
    const userShoots = sh.team.human && !!sh.team.input && !this.autoplay;
    if (f.phase === 'setup' || f.phase === 'between') {
      f.t -= dt;
      if (f.t <= 0) {
        if (f.phase === 'setup') this.positionFT(); else this.setHolder(sh, { silent: true });
        f.phase = 'ready'; f.t = userShoots ? 0.3 : 1.0;
        this.hud.toast(`FREE THROW ${f.total - f.remaining + 1} OF ${f.total}`, `${sh.data.first} ${sh.data.last} · ${this.ftRating(sh)} FT${userShoots ? ' · Hold & release SHOOT' : ''}`, 1.4);
      }
      return;
    }
    if (f.phase === 'ready') {
      f.t -= dt;
      if (f.t <= 0 && (!userShoots || sh.team.input.pressed.shoot)) {
        sh.state = 'ft'; sh.actionT = 0; sh.released = false;
        sh.aiRelease = METER_TARGET + (Math.random() - 0.5) * 0.25 * (1.2 - this.ftRating(sh) / 100);
        f.phase = 'shooting';
      }
    }
  }

  releaseFT(p) {
    if (p.released) return;
    p.released = true;
    const userShoots = p.team.human && !!p.team.input && !this.autoplay;
    const val = Math.min(1.25, p.actionT / METER_TIME);
    const err = val - METER_TARGET, ae = Math.abs(err);
    const w = this.diff.greenWindow * 1.2;
    let prob = this.ftRating(p) / 100;
    let label, color;
    if (ae <= w) { label = 'EXCELLENT'; color = '#3dff7a'; prob = 1; }
    else if (ae <= w * 2.5) { label = err < 0 ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE'; color = '#ffd60a'; prob *= 0.85; }
    else if (ae <= w * 5) { label = err < 0 ? 'EARLY' : 'LATE'; color = '#ff8c1a'; prob *= 0.55; }
    else { label = err < 0 ? 'VERY EARLY' : 'VERY LATE'; color = '#ff3b3b'; prob *= 0.15; }
    if (userShoots) {
      p.team.meter.result = { label, color, value: val };
      p.team.meter.hideT = 0.15;
      if (label === 'EXCELLENT' && p.team === this.user) sfx.green();
    } else {
      prob = Math.min(0.95, (this.ftRating(p) / 100) * (0.84 + 0.08 * this.diff.aiShot));
    }
    p.stats.fta++;
    this.launchShot(p, Math.random() < prob, 1, 'ft', false);
    this.ft.phase = 'flight';
  }

  resolveFT(s) {
    const f = this.ft, p = s.shooter, b = this.ball;
    f.remaining--;
    b.pos.copy(s.target);
    const hoop = this.hoopOf(p.team);
    if (s.made) {
      p.team.score += 1; p.stats.pts += 1; p.stats.ftm++;
      this.trackRun(p.team, 1);
      sfx.swish(); if (p.team.isHome) sfx.cheer(0.35);
      this.netAnim[p.team.dir > 0 ? 1 : 0] = 1;
      b.state = 'free'; b.vel.set(0, -2, 0);
    } else {
      sfx.rim();
      const out = tmp.set(s.target.x - hoop.x, 0, s.target.z - hoop.z).normalize();
      b.vel.set(out.x * rand(1.5, 3) - p.team.dir * 1.2, rand(2, 3.5), out.z * rand(1.5, 3));
      b.state = 'free';
    }
    this.emit('ft', { made: s.made, player: p });
    if (f.remaining > 0) { f.phase = 'between'; f.t = 1.1; return; }
    this.ft = null;
    this.emit('ftDone', { player: p });
    if (s.made) {
      const spot = new THREE.Vector3(p.team.dir * (C.HALF_L - 0.2), 0, 1.2);
      this.beginDead(1.3, this.nextOffense(this.other(p.team)), spot);
    } else {
      // Live rebound off the last miss
      b.state = 'loose';
      b.reboundable = true;
      b.lastTouch = p.team;
      this.shotClockFrozen = true;
      this.state = 'live';
      for (const q of this.allPlayers) { q.faceTarget = null; q.state = 'idle'; }
    }
  }

  // ---------- Sim the rest of the game ----------
  // Used when a career player is on the bench: both teams' remaining points are generated from their
  // ratings (like a season sim), shared out among real players so the box score still adds up.
  simRemainder() {
    if (this.state === 'over' || this.opts.tutorial || this.opts.versus) return false;
    const total = this.quarterLen * 4;
    const played = this.period > 4 ? total : (this.period - 1) * this.quarterLen + (this.quarterLen - this.gameClock);
    const left = Math.max(0.03, (total - played) / total);
    const base = (this.quarterLen / 60) * 4 * 5.4 * left;
    const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
    const add = {};
    for (const t of this.teams) add[t === this.home ? 'h' : 'a'] = Math.max(0, Math.round(base * (1 + (t.data.ovr - 85) / 75) + base * 0.17 * gauss()));
    while (this.home.score + add.h === this.away.score + add.a) { if (Math.random() < 0.5) add.h += 1 + Math.floor(Math.random() * 4); else add.a += 1 + Math.floor(Math.random() * 4); }
    for (const t of this.teams) {
      let pts = add[t === this.home ? 'h' : 'a'];
      t.score += pts;
      // A career player gets a real stat line for the part of the game that was simmed, like he had played it
      const me = t === this.user ? [...t.players, ...t.bench].find((p) => p.data.isMe) : null;
      if (me) {
        const line = simCareerLine({ ratings: me.r }, this.quarterLen / 60, left, pts);
        pts -= line.pts;
        for (const k of Object.keys(line)) me.stats[k] = (me.stats[k] || 0) + line[k];
      }
      const pool = [...t.players, ...t.bench].filter((p) => !p.fouledOut && !p.data.isMe);
      const weight = (p) => Math.max(1, p.data.ovr - 50) * (p.starter ? 1.6 : 0.7);
      const sum = pool.reduce((a, p) => a + weight(p), 0);
      while (pts > 0 && pool.length) {
        let r = Math.random() * sum, pick = pool[0];
        for (const p of pool) { r -= weight(p); if (r <= 0) { pick = p; break; } }
        const value = pts >= 3 && Math.random() < 0.3 ? 3 : pts >= 2 && Math.random() < 0.8 ? 2 : 1;
        pick.stats.pts += value;
        if (value === 1) { pick.stats.ftm++; pick.stats.fta++; }
        else { pick.stats.fgm++; pick.stats.fga += Math.random() < 0.45 ? 2 : 1; if (value === 3) { pick.stats.tpm++; pick.stats.tpa++; } }
        pts -= value;
      }
    }
    this.simmed = true;
    for (const t of this.teams) t.meter.visible = false;
    this.state = 'over';
    this.ball.state = 'free'; this.ball.holder = null;
    const winner = this.home.score > this.away.score ? this.home : this.away;
    this.emit('gameOver', { winner });
    this.hud.gameOver(this);
    return true;
  }

  // ---------- Timeouts ----------
  canCallTimeout(team) {
    if (team.timeouts <= 0 || this.opts.noTimeouts) return false;
    const b = this.ball;
    if (this.state === 'live') return b.state === 'held' && b.holder && b.holder.team === team && b.holder.state === 'idle';
    if (this.state === 'dead') return !!(this.pendingInbound && this.pendingInbound.team === team);
    return false;
  }

  callTimeout(team) {
    if (!this.canCallTimeout(team)) {
      if (team.isUser) this.hud.feedback(team.timeouts <= 0 ? 'NO TIMEOUTS LEFT' : 'NEED THE BALL TO CALL TIMEOUT', '#ff8c1a');
      return false;
    }
    team.timeouts--;
    sfx.whistle();
    this.timeoutTeam = team;
    this.savedShotClock = this.state === 'dead' ? 24 : this.shotClock;
    this.state = 'timeout';
    this.stateT = this.opts.versus ? 10 : team.isUser ? 600 : 6;
    this.run = { team: null, pts: 0 };
    for (const t of this.teams) t.meter.visible = false;
    for (const p of this.allPlayers) { p.stamina = 1; p.energy = Math.min(1, p.energy + 0.12); p.state = 'idle'; p.vel.set(0, 0, 0); p.desired.set(0, 0, 0); p.faceTarget = null; }
    this.applySubs();
    this.hud.timeout(this, team);
    this.emit('timeout', { team });
    return true;
  }

  endTimeout() {
    if (this.state !== 'timeout') return;
    const team = this.timeoutTeam;
    this.hud.hideTimeout();
    // Inbound from the frontcourt sideline, keeping the shot clock
    const spot = new THREE.Vector3(team.dir * 3, 0, C.HALF_W - 0.25);
    this.beginDead(1.0, team, spot, Math.max(1, this.savedShotClock));
  }

  // Tutorial helper: hand the ball to a player, clearing any dead-ball state
  forcePossession(p, pos) {
    this.state = 'live';
    this.ft = null;
    this.pendingInbound = null;
    this.hud.hideTimeout && this.hud.hideTimeout();
    if (pos) { p.pos.copy(pos); p.vel.set(0, 0, 0); }
    for (const q of this.allPlayers) { q.state = 'idle'; q.faceTarget = null; }
    this.ball.reboundable = false;
    this.setHolder(p, { silent: true });
    this.shotClock = 24;
    this.shotClockFrozen = false;
  }

  dribbleMove(p) {
    if (this.ball.holder !== p || p.state !== 'idle' || (p.moveCd || 0) > 0) return;
    const hoop = this.hoopOf(p.team);
    const toHoop = tmp.set(hoop.x - p.pos.x, 0, -p.pos.z).normalize().clone();
    const { p: def, d } = this.nearestDefender(p);
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const want = Math.hypot(p.desired.x, p.desired.z) > 0.2 ? p.desired.x * toHoop.x + p.desired.z * toHoop.z : (sp > 1 ? (p.vel.x * toHoop.x + p.vel.z * toHoop.z) / sp : 0);
    // The situation picks the move
    let name;
    const roll = Math.random();
    if (def && d < 1.35 && want > 0.4 && sp > 2) name = 'spin';
    else if (want < -0.3) name = 'stepback';
    else if (def && d < 1.3 && sp < 1.5) name = roll < 0.28 ? 'stepback' : roll < 0.55 ? 'crossover' : roll < 0.78 ? 'hesi' : 'behind';
    else if (sp < 1.2) name = 'hesi';
    else name = roll < 0.5 ? 'crossover' : 'behind';
    p.moveCd = 1.1;
    p.moveName = name; p.moveT = 0.5;
    let ankle = 0, bite = 0;
    if (name === 'stepback') {
      const away = def && d < 2.5 ? tmp2.set(p.pos.x - def.pos.x, 0, p.pos.z - def.pos.z).normalize() : tmp2.copy(toHoop).multiplyScalar(-1);
      p.vel.set(away.x * 5.6, 0, away.z * 5.6);
      p.jump(0.32, 0.16);          // a quick hop back
      p.rhythmT = 1.5;             // shooting right after a step-back gets a boost
      bite = 0.22;
    } else if (name === 'hesi') {
      p.hesiT = 0.28; p.burstT = 0.9; bite = 0.26 + p.r.handle / 500;
    } else {
      p.burstT = name === 'spin' ? 0.58 : 0.5;
      p.crossSide = -(p.crossSide || 1);
      if (name === 'spin') { p.spinT = 0.45; p.spinDir = p.crossSide; p.stealImmuneT = 0.65; }
      ankle = (name === 'spin' ? 0.24 : 0.18) + (p.r.handle - (def ? def.r.def : 70)) / 220 + p.perk.handle;
    }
    if (def && d < 1.9 && !def.airborne) {
      if (Math.random() < ankle) {
        def.stumbleT = 1.0;
        if (p.team.isUser) this.hud.feedback('ANKLES BROKEN!', '#35f0ff');
        sfx.cheer(0.6);
        this.arena.excitement = Math.min(1, this.arena.excitement + 0.5);
      } else if (Math.random() < bite) def.stumbleT = 0.6; // the defender bites on the fake
      else this.announceMove(p, name);
    } else this.announceMove(p, name);
    sfx.squeak();
    this.emit('move', { player: p, user: this.ctl(p), name });
  }

  // ---------- Possession changes / dead balls ----------
  turnover(team, reason) {
    // `team` loses the ball
    sfx.whistle();
    this.hud.toast(reason, `${this.other(team).data.name} ball`);
    const offender = this.ball.holder || (this.ball.shot && this.ball.shot.shooter);
    if (offender) offender.stats.to++;
    const newOff = this.nextOffense(this.other(team));
    const spot = this.ball.pos.clone();
    spot.x = Math.max(-C.HALF_L + 0.6, Math.min(C.HALF_L - 0.6, spot.x));
    spot.z = Math.sign(spot.z || 1) * (C.HALF_W - 0.25);
    this.beginDead(1.4, newOff, spot);
    this.ball.state = 'free';
    this.ball.holder = null;
  }

  beginDead(t, newOff, spot, shotClock = 24) {
    this.state = 'dead';
    this.stateT = t;
    this.possession = newOff;
    this.shotClockFrozen = true;
    this.inbounder = this.closestTo(newOff.players, spot);
    this.pendingInbound = { team: newOff, spot, shotClock };
    for (const p of this.allPlayers) { p.state = 'idle'; p.faceTarget = null; }
    this.applySubs();
    this.inbounder = this.closestTo(newOff.players, spot);
  }

  finishInbound() {
    const { team, spot, shotClock } = this.pendingInbound;
    const p = this.inbounder;
    p.pos.x = spot.x; p.pos.z = spot.z;
    p.vel.set(0, 0, 0);
    this.shotClock = shotClock ?? 24;
    this.celebrateTeam = null;
    this.shotClockFrozen = false;
    this.setHolder(p, { silent: true });
    this.ball.reboundable = false;
    this.state = 'live';
    this.pendingInbound = null;
    if (team.human && !team.lock && !team.benchedMe) this.setCtl(team, p);
  }

  scored(shot) {
    const team = shot.team, p = shot.shooter;
    team.score += shot.pts;
    p.stats.pts += shot.pts; p.stats.fgm++; if (shot.pts === 3) p.stats.tpm++;
    const passer = this.ball.lastPasser;
    if (passer && passer !== p && passer.team === team && this.time - this.ball.lastPassTime < 4) passer.stats.ast++;
    const sideIdx = team.dir > 0 ? 1 : 0;
    this.netAnim[sideIdx] = 1;
    if (shot.kind === 'dunk') { sfx.dunk(); this.cameraShake = 0.5; this.hud.feedback('SLAM!', '#ff2e88'); }
    else sfx.swish();
    p.streak++;
    if (p.streak >= 3 && !p.onFire) { p.onFire = true; this.hud.feedback(`${p.data.last.toUpperCase()} IS ON FIRE!`, '#ff8c1a'); this.emit('onFire', { player: p }); }
    else if (p.streak === 2) this.emit('heatingUp', { player: p });
    const buzzer = this.gameClock <= 0;
    if (buzzer) { this.slowT = 1.6; this.focus = p; }
    shot.buzzer = buzzer;
    const loud = shot.pts === 3 ? 1 : 0.7;
    if (team.isHome) sfx.cheer(loud); else sfx.cheer(0.25);
    this.arena.excitement = Math.min(1, this.arena.excitement + (team.isHome ? loud : 0.3));
    this.hud.scored(team, shot.pts, p);
    this.trackRun(team, shot.pts);
    this.celebrateTeam = team;
    this.emit('score', { team, pts: shot.pts, player: p, kind: shot.kind, buzzer: shot.buzzer, assist: passer && passer !== p && passer.team === team && this.time - this.ball.lastPassTime < 4 ? passer : null });
    this.ball.pos.set(team.dir * C.HOOP_X, C.RIM_H - 0.15, 0);
    this.ball.vel.set(0, -2, 0);
    this.ball.state = 'free';
    if (shot.fouled) {
      this.recordFoul(shot.fouled, p, 'SHOOTING FOUL');
      this.hud.feedback('AND ONE!', '#ffd60a');
      this.startFreeThrows(p, 1);
      return;
    }
    const newOff = this.nextOffense(this.other(team));
    const spot = new THREE.Vector3(team.dir * (C.HALF_L - 0.2), 0, 1.2);
    this.beginDead(1.7, newOff, spot);
  }

  // ---------- Main update ----------
  update(dt) {
    // Slow-motion highlight moments (dunks, blocks, buzzer beaters)
    if (this.slowT > 0) { this.slowT -= dt; dt *= 0.32; if (this.slowT <= 0) this.focus = null; }
    this.time += dt;
    if (this.state === 'live') {
      // Fatigue: players tire on the court (faster when sprinting) and recover on the bench
      const k = dt / Math.max(60, this.quarterLen);
      for (const t of this.teams) {
        for (const p of t.players) { p.energy = Math.max(0.05, p.energy - k * (p.sprinting ? 1.1 : 0.5)); p.stats.sec += dt; }
        for (const p of t.bench) p.energy = Math.min(1, p.energy + k * 0.7);
      }
    }
    // Buttons that work in any game state
    if (!this.autoplay) {
      for (const t of this.teams) {
        const inp = t.human && t.input;
        if (!inp) continue;
        if (this.state === 'timeout' && this.timeoutTeam === t && (inp.pressed.shoot || inp.pressed.pass)) this.endTimeout();
        else if (inp.pressed.timeout && this.state !== 'timeout') this.callTimeout(t);
        if (inp.pressed.switch && ['live', 'dead'].includes(this.state)) this.switchPlayer(t);
      }
    }
    this.cameraShake = Math.max(0, this.cameraShake - dt);
    for (const t of this.teams) {
      const m = t.meter;
      // Safety net: if nobody is winding up a shot any more, the meter must not linger
      const charging = m.player && (m.player.state === 'shoot' || m.player.state === 'ft') && !m.player.released;
      if (m.visible && m.hideT === undefined && !charging) m.hideT = 0.15;
      if (m.hideT === undefined) continue;
      m.hideT -= dt;
      if (m.hideT <= 0) { m.visible = false; m.result = null; m.value = 0; m.hideT = undefined; }
    }
    for (const p of this.allPlayers) { p.moveCd = Math.max(0, (p.moveCd || 0) - dt); }
    this.contactCd = Math.max(0, this.contactCd - dt);

    if (this.state === 'intro') {
      /* frozen while the pre-game intro plays */
    } else if (this.state === 'tipoff') {
      this.updateTipoff(dt);
      for (const p of this.allPlayers) { p.desired.set(0, 0, 0); p.update(dt); }
    } else if (this.state === 'timeout') {
      this.stateT -= dt;
      if (this.stateT <= 0) this.endTimeout();
    } else if (this.state === 'break') {
      this.stateT -= dt;
      for (const p of this.allPlayers) { p.desired.set(0, 0, 0); p.update(dt); }
      if (this.stateT <= 0) { this.startPeriod(); this.hud.hideToast(); }
    } else if (this.state === 'over') {
      for (const p of this.allPlayers) { p.desired.set(0, 0, 0); p.update(dt); }
    } else {
      if (this.state === 'live' && !this.opts.tutorial) this.tickClocks(dt);
      if (this.state === 'live' && !this.opts.tutorial) this.cpuTimeoutCheck();
      if (this.state === 'dead') {
        this.stateT -= dt;
        if (this.stateT <= 0) this.finishInbound();
      }
      if (this.state === 'ft') {
        this.updateFT(dt);
        for (const p of this.allPlayers) { p.desired.set(0, 0, 0); p.sprinting = false; }
      } else if (this.state !== 'timeout') this.controlPlayers(dt);
      for (const p of this.allPlayers) {
        if (p.state !== 'idle') p.actionT += dt;
        this.updateAction(p);
        p.update(dt);
      }
      if (this.state !== 'ft') this.separatePlayers();
      this.updateBall(dt);
      if (this.state === 'live') this.checkRules();
    }

    this.animateAll(dt);
  }

  // Poses, ball and nets. Separate from the simulation so an online guest can render received state.
  animateAll(dt) {
    for (const p of this.allPlayers) {
      const hasBall = this.ball.holder === p;
      p.animate(dt, {
        hasBall,
        dribble: hasBall && p.state === 'idle',
        defending: p.team !== this.possession && this.state === 'live',
        released: p.released,
      });
      const sp = Math.hypot(p.vel.x, p.vel.z);
      let animState;
      if (p.state !== 'idle' && p.state !== 'steal') animState = p.state;
      else if (p.airborne) animState = 'jump';
      else if (sp > 2.6) animState = 'run';
      else if (sp > 0.5) animState = 'walk';
      else if (this.state === 'dead' && this.celebrateTeam === p.team) animState = 'celebrate';
      else animState = hasBall ? 'dribble' : 'idle';
      updateCustomPlayer(p, dt, animState, sp, {
        hasBall, released: p.released, airborne: p.airborne,
        defending: p.team !== this.possession && this.state === 'live',
        ballPos: this.ball.pos, ballSide: (p.crossSide || 1) * (p.burstT > 0.25 ? -1 : 1),
        style: p.shotStyle, move: (p.moveT || 0) > 0 ? p.moveName : null,
        spin: (p.spinT || 0) > 0 ? (1 - p.spinT / 0.45) * (p.spinDir || 1) : 0,
        passT: p.passT || 0, passStyle: p.passStyle, passLocal: p.passLocal, actionT: p.actionT, stealStyle: p.stealStyle,
      });
    }
    // Ball mesh
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.mesh.rotation.x += this.ball.spin * dt;
    {
      const b = this.ball, held = b.state === 'held';
      // Glow: gentle while dribbled, stronger when the ball is in the air or loose
      if (b.halo) b.halo.material.opacity += ((held ? 0.3 : 0.62) - b.halo.material.opacity) * Math.min(1, dt * 8);
      // Floor ring: sits under the ball, grows and fades as it rises, so the ball's position (and a shot's arc) is easy to read
      if (b.ring) {
        const k = Math.min(1, Math.max(0, b.pos.y - 0.12) / 4);
        b.ring.position.set(b.pos.x, 0.025, b.pos.z);
        b.ring.scale.setScalar(1 + k * 1.7);
        b.ring.material.opacity = (held ? 0.32 : 0.85) * (1 - 0.5 * k);
      }
    }
    // Nets
    this.netAnim.forEach((a, i) => {
      const net = this.arena.hoops[i].net;
      if (a > 0) {
        this.netAnim[i] = Math.max(0, a - dt * 1.8);
        net.scale.set(1 - a * 0.25, 1 + Math.sin(a * 14) * 0.25 * a, 1 - a * 0.25);
      } else net.scale.set(1, 1, 1);
    });
  }

  tickClocks(dt) {
    const b = this.ball;
    this.gameClock = Math.max(0, this.gameClock - dt);
    if (!this.shotClockFrozen) this.shotClock = Math.max(0, this.shotClock - dt);

    if (this.gameClock <= 0) {
      if (!this.buzzerPlayed) { sfx.buzzer(); this.buzzerPlayed = true; }
      if (b.state !== 'shot') { this.endPeriod(); return; }
    }
    if (this.shotClock <= 0 && !this.shotClockFrozen && b.state !== 'shot' && this.gameClock > 0) {
      sfx.buzzer();
      this.turnover(this.possession, 'SHOT CLOCK VIOLATION');
    }
  }

  endPeriod() {
    for (const t of this.teams) t.quarterScores.push(t.score - t.quarterScores.reduce((a, b) => a + b, 0));
    for (const p of this.allPlayers) { p.state = 'idle'; p.faceTarget = null; }
    for (const t of this.teams) t.meter.visible = false;
    if (this.period >= 4 && this.home.score !== this.away.score) {
      this.state = 'over';
      this.ball.state = 'free';
      this.ball.holder = null;
      const winner = this.home.score > this.away.score ? this.home : this.away;
      if (winner.isHome) sfx.cheer(1);
      this.emit('gameOver', { winner });
      this.hud.gameOver(this);
      return;
    }
    const label = this.period === 2 ? 'HALFTIME' : this.period >= 4 ? 'END OF REGULATION' : `END OF ${this.periodName()}`;
    this.hud.toast(label, `${this.away.data.id} ${this.away.score} - ${this.home.score} ${this.home.data.id}`, 3);
    if (this.period === 2) for (const t of this.teams) t.dir *= -1;
    this.emit('periodEnd', { period: this.period });
    const rest = this.period === 2 ? 0.5 : 0.2;
    for (const t of this.teams) for (const p of [...t.players, ...t.bench]) p.energy = Math.min(1, p.energy + rest);
    this.period++;
    this.state = 'break';
    this.stateT = this.period === 3 ? 5 : 3.2;
    // Halftime show: the break lasts until the show is done (the screen calls endHalftime)
    if (this.period === 3 && !this.opts.attract && !this.opts.tutorial && !this.opts.practice && !this.opts.versus && !this.opts.guest && !this.opts.noHalftime) {
      this.halftime = true;
      this.stateT = 9999;
      this.emit('halftime', { reel: this.reel || [] });
    }
    this.applySubs();
    this.ball.state = 'free';
    this.ball.holder = null;
  }

  endHalftime() { if (this.halftime) { this.halftime = false; this.stateT = 0.4; } }

  periodName() { return this.period <= 4 ? `Q${this.period}` : this.period === 5 ? 'OT' : `${this.period - 4}OT`; }

  checkRules() {
    const b = this.ball;
    const h = b.holder;
    if (h && (Math.abs(h.pos.x) > C.HALF_L + 0.02 || Math.abs(h.pos.z) > C.HALF_W + 0.02)) {
      this.turnover(h.team, 'OUT OF BOUNDS');
      return;
    }
    if ((b.state === 'loose') && b.pos.y < 0.5 && (Math.abs(b.pos.x) > C.HALF_L + 0.1 || Math.abs(b.pos.z) > C.HALF_W + 0.1)) {
      this.turnover(b.lastTouch || this.possession, 'OUT OF BOUNDS');
    }
  }

  separatePlayers() {
    const ps = this.allPlayers;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.team === c.team ? 0.85 : 0.62;
        if (d < min && d > 1e-4) {
          if (this.checkContactFoul(a, c)) return;
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          c.pos.x += nx * push; c.pos.z += nz * push;
        }
      }
    }
  }

  // Collisions between a driving ball handler and a defender can draw a charge or a blocking foul
  checkContactFoul(a, c) {
    if (this.opts.noFouls || this.contactCd > 0 || this.state !== 'live') return false;
    const h = this.ball.holder;
    if (!h || h.state !== 'idle' || (h !== a && h !== c)) return false;
    const def = h === a ? c : a;
    if (def.team === h.team) return false;
    const hs = Math.hypot(h.vel.x, h.vel.z);
    if (hs < 4.2) return false;
    this.contactCd = 2.5;
    const ds = Math.hypot(def.vel.x, def.vel.z);
    if (ds < 1.0 && Math.random() < 0.05 + def.r.def / 3000) { this.offensiveFoul(h); return true; }
    if (ds >= 1.6 && Math.random() < 0.05) { this.nonShootingFoul(def, h, 'BLOCKING FOUL'); return true; }
    return false;
  }

  cpuTimeoutCheck() {
    const cpu = this.cpu, b = this.ball;
    if (this.autoplay || this.opts.versus) return;
    if (this.run.team === this.user && this.run.pts >= 8 && cpu.timeouts > 0 && b.state === 'held' && b.holder && b.holder.team === cpu && b.holder.state === 'idle' && b.holder.holdT > 0.8) {
      this.callTimeout(cpu);
    }
  }

  updateAction(p) {
    const b = this.ball;
    if (p.state === 'steal') {
      // Lunge at the ball handler while the arm strikes, land the result mid-strike, then recover
      const h = p.stealTarget;
      if (h && p.actionT > 0.05 && p.actionT < 0.34) {
        p.desired.set(h.pos.x - p.pos.x, 0, h.pos.z - p.pos.z).normalize().multiplyScalar(1);
        p.faceTarget = h.pos;
      }
      if (!p.stealResolved && p.actionT >= 0.22) this.resolveSteal(p);
      if (p.actionT > 0.62) { p.state = 'idle'; p.stealTarget = null; p.faceTarget = null; }
    }
    if (p.state === 'shoot') {
      const isUser = this.ctl(p);
      if (isUser) {
        // The meter only fills until the release; after that it shows the result briefly and hides
        if (!p.released) {
          const m = p.team.meter;
          m.visible = true;
          m.player = p;
          m.value = Math.min(1.2, p.actionT / METER_TIME);
          m.win = this.diff.greenWindow;
          m.result = null;
          m.hideT = undefined;
          if (!p.team.input.held.shoot || p.actionT > METER_TIME * 1.25) this.releaseShot(p);
        }
      } else if (!p.released && p.actionT / METER_TIME >= p.aiRelease) this.releaseShot(p);
      if (p.released && !p.airborne) { p.state = 'idle'; p.faceTarget = null; }
    }
    if (p.state === 'ft') {
      const isUser = p.team.human && !!p.team.input && !this.autoplay;
      if (isUser) {
        if (!p.released) {
          const m = p.team.meter;
          m.visible = true;
          m.player = p;
          m.value = Math.min(1.2, p.actionT / METER_TIME);
          m.win = this.diff.greenWindow * 1.2;
          m.result = null;
          m.hideT = undefined;
          if (!p.team.input.held.shoot || p.actionT > METER_TIME * 1.25) this.releaseFT(p);
        }
      } else if (!p.released && p.actionT / METER_TIME >= p.aiRelease) this.releaseFT(p);
      if (p.released && p.actionT > 0.9) p.state = 'idle';
    }
    if (p.state === 'layup' || p.state === 'dunk') {
      const hoop = this.hoopOf(p.team);
      const d = Math.hypot(p.pos.x - hoop.x, p.pos.z);
      const front = tmp.set(hoop.x - p.team.dir * 0.55, 0, 0);
      if (p.shotStyle === 'floater') p.desired.set(0, 0, 0);
      else if (d > 0.6) { p.desired.set(front.x - p.pos.x, 0, front.z - p.pos.z).normalize(); }
      else p.desired.set(0, 0, 0);
      if (p.shotStyle === 'euro' && p.euroDir && p.actionT < 0.24) { p.pos.x += p.euroDir.x * 3.6 * 0.016; p.pos.z += p.euroDir.z * 3.6 * 0.016; }
      // A defender in the air next to a dunk or layup can still stop it before the ball is released
      if (!p.released && p.actionT > 0.08 && this.tryRimBlock(p)) return;
      if (!p.released && p.actionT > (p.state === 'dunk' ? 0.38 : 0.3)) this.releaseShot(p);
      if (p.released && !p.airborne) { p.state = 'idle'; p.faceTarget = null; }
    }
    if (b.holder === p && p.state === 'shoot' && p.released) p.state = 'idle';
  }

  // Block a dunk or layup attempt in progress (before the ball leaves the shooter's hand).
  // A human defender who jumps at the right moment almost always gets it; the CPU gets it less often.
  tryRimBlock(p) {
    const b = this.ball;
    if (b.holder !== p || p.released) return false;
    p.rimChecked = p.rimChecked || new Set();
    for (const q of this.other(p.team).players) {
      if (!q.airborne || p.rimChecked.has(q)) continue;
      // Close enough to the ball, with hands up high enough to reach it
      const dx = q.pos.x - b.pos.x, dz = q.pos.z - b.pos.z;
      if (Math.hypot(dx, dz) > 1.25) continue;
      if (q.reach + 0.35 < b.pos.y) continue;
      p.rimChecked.add(q);
      const human = q.team.human && this.ctl(q);
      let chance;
      if (human) chance = 0.9 - (p.state === 'dunk' ? Math.max(0, p.r.dunk - 80) / 300 : 0);
      else chance = (0.04 + q.r.block / 900) * (p.state === 'dunk' ? 0.65 : 1) * this.diff.aiDef * (1 + q.team.skill * 0.1);
      chance *= { reverse: 0.7, euro: 0.8, floater: 0.7 }[p.shotStyle] || 1;
      chance *= (1 + q.perk.block) * Math.max(0.3, 1 - p.perk.blockResist);
      if (Math.random() >= chance) continue;
      this.blockAtRim(p, q);
      return true;
    }
    return false;
  }

  blockAtRim(p, q) {
    const b = this.ball;
    p.rimChecked = null;
    // The attempt is over: the shooter lands empty-handed and the ball is swatted away
    p.state = 'idle'; p.faceTarget = null; p.released = true; p.streak = 0; p.onFire = false;
    p.stats.fga++;
    q.stats.blk++;
    b.state = 'loose'; b.holder = null; b.shot = null; b.pass = null;
    const away = tmp2.set(b.pos.x - q.pos.x, 0, b.pos.z - q.pos.z);
    if (away.lengthSq() < 1e-4) away.set(-p.team.dir, 0, 0);
    away.normalize();
    b.vel.set(away.x * rand(4.5, 7), rand(-0.5, 1.5), away.z * rand(4.5, 7));
    b.spin = 12;
    b.reboundable = true;
    b.lastTouch = q.team;
    b.ignore = p; b.ignoreT = 0.5; // the dunker can't immediately grab his own blocked ball
    this.hud.feedback('SWATTED AWAY!', q.team === this.user ? '#3dff7a' : '#ff3b3b');
    if (q.team.human || p.team.human) { this.slowT = 0.6; this.focus = q; } // slow-mo only when a person is involved
    this.emit('block', { player: q, victim: p, kind: 'rim' });
    sfx.board(); sfx.cheer(0.9);
    this.arena.excitement = Math.min(1, this.arena.excitement + 0.7);
    this.cameraShake = 0.3;
  }

  // ---------- Ball physics ----------
  updateBall(dt) {
    const b = this.ball;
    b.ignoreT = Math.max(0, b.ignoreT - dt);
    if (b.ignoreT <= 0) b.ignore = null;
    if (b.state === 'held' && b.holder) {
      const p = b.holder;
      b.spin = 0;
      if (p.state === 'shoot' || p.state === 'layup' || p.state === 'ft') {
        const u = Math.min(1, p.actionT / 0.3);
        const fwd = tmp.set(Math.sin(p.facing), 0, Math.cos(p.facing));
        b.pos.set(p.pos.x + fwd.x * 0.2, p.y + p.data.height * (0.62 + 0.42 * u), p.pos.z + fwd.z * 0.2);
      } else if (p.state === 'dunk') {
        p.handWorld(true, b.pos);
        b.pos.y += 0.06;
      } else {
        const sp = Math.hypot(p.vel.x, p.vel.z);
        b.dribblePhase += dt * (6.5 + sp * 0.9);
        const c = Math.cos(b.dribblePhase);
        if (Math.sign(c) !== Math.sign(b.lastCos) && c < b.lastCos) { /* top */ }
        const bounce = Math.abs(c);
        if (bounce < 0.12 && b.lastCos >= 0.12) sfx.dribble(p.team.isUser ? 0.8 : 0.4);
        b.lastCos = bounce;
        const side = (p.crossSide || 1) * (p.burstT > 0.25 ? -1 : 1);
        const behind = p.moveName === 'behind' && (p.moveT || 0) > 0.2;
        const off = tmp.set(0.3 * side, 0, behind ? -0.22 : 0.32).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.facing);
        const handY = p.data.height * 0.47;
        b.pos.set(p.pos.x + off.x, BALL_R + (handY - BALL_R) * bounce + p.y, p.pos.z + off.z);
      }
      return;
    }
    if (b.state === 'pass') {
      const ps = b.pass;
      ps.t += dt / ps.dur;
      const target = ps.to;
      const lob = ps.style === 'lob';
      const end = tmp.set(target.pos.x, (lob ? target.data.height * 1.25 : 1.3) + target.y, target.pos.z);
      const u = Math.min(1, ps.t);
      b.pos.lerpVectors(ps.start, end, u);
      if (ps.style === 'bounce') {
        // Down to the floor about 60% of the way, then up into the hands
        const f = u < 0.6 ? 1 - u / 0.6 : (u - 0.6) / 0.4;
        b.pos.y = BALL_R + (b.pos.y - BALL_R) * Math.pow(f, 0.75);
        if (u >= 0.6 && !ps.bounced) { ps.bounced = true; sfx.dribble(0.7); }
      } else b.pos.y += Math.sin(u * Math.PI) * ps.arc;
      // Alley-oop: the receiver goes up to meet the lob
      if (lob && u > 0.5 && !target.airborne && target.state === 'idle') target.jump(0.8, 1.05);
      b.spin = 6;
      // Interceptions
      for (const q of this.other(ps.from.team).players) {
        if (ps.checked.has(q)) continue;
        const d = hdist(q.pos, b.pos);
        if (d < 0.95 && b.pos.y < q.reach + 0.2 && u > 0.1 && u < 0.92) {
          ps.checked.add(q);
          // Standing in the passing lane is an interception: the closer to the ball's path, the surer it is
          let chance = (d < 0.5 ? 0.9 : 0.62) + q.r.steal / 1000 + q.perk.steal * 0.5;
          if (!q.team.human) chance *= Math.min(1, 0.55 + this.diff.aiSteal * 0.45) * (1 + q.team.skill * 0.1);
          chance *= 1 - ps.from.team.skill * 0.12;      // sharp passers read the lane
          if (q.state === 'steal' || q.stumbleT > 0) chance *= 0.6; // off balance
          chance = Math.min(0.97, chance);
          if (Math.random() < chance) {
            q.stats.stl++; ps.from.stats.to++;
            this.hud.feedback('INTERCEPTED!', q.team.isUser ? '#3dff7a' : '#ff3b3b');
            this.setHolder(q);
            this.emit('intercept', { player: q, victim: ps.from });
            sfx.cheer(0.5);
            return;
          }
        }
      }
      if (u >= 1) {
        this.setHolder(target);
        const hoop = this.hoopOf(target.team);
        if (lob && target.state === 'idle' && Math.hypot(target.pos.x - hoop.x, target.pos.z) < 3.2) {
          // Catch it in the air and throw it down
          target.state = 'dunk'; target.actionT = 0.26; target.released = false; target.shotStyle = 'alley';
          target.faceTarget = hoop;
          if (!target.airborne) target.jump(0.6, 0.9);
          this.slowT = 0.7; this.focus = target;
          this.emit('dunkStart', { player: target });
        }
      }
      return;
    }
    if (b.state === 'shot') {
      const s = b.shot;
      s.t += dt;
      // Blocks
      if (s.t < (s.kind === 'dunk' ? 0.12 : 0.45) && s.kind !== 'ft') {
        for (const q of this.other(s.team).players) {
          if (s.checked.has(q) || !q.airborne) continue;
          const hand = tmp.set(q.pos.x, q.reach, q.pos.z);
          if (hand.distanceTo(b.pos) < (s.kind === 'dunk' ? 0.9 : 0.6)) {
            s.checked.add(q);
            let chance = 0.1 + q.r.block / 320 - (s.kind === 'shoot' ? 0.03 : 0);
            if (s.kind === 'dunk') chance = q.team.human && this.ctl(q) ? 0.8 : chance * 0.4; // a late hand can still swat a dunk
            chance *= { fadeaway: 0.45, floater: 0.55, reverse: 0.5, euro: 0.7 }[s.style] || 1;
            if (!q.team.human) chance *= this.diff.aiDef;
            chance *= (1 + q.perk.block) * Math.max(0.3, 1 - s.shooter.perk.blockResist);
            if (Math.random() < chance) {
              b.state = 'loose';
              const away = tmp2.set(b.pos.x - q.pos.x, 0, b.pos.z - q.pos.z).normalize();
              b.vel.set(away.x * rand(3, 6), rand(-1, 2), away.z * rand(3, 6));
              b.reboundable = true;
              b.lastTouch = q.team;
              q.stats.blk++;
              // Caught from behind at full speed
              const chase = Math.hypot(q.vel.x, q.vel.z) > 3.5 && (q.pos.x - s.shooter.pos.x) * s.team.dir < 0;
              this.hud.feedback(chase ? 'CHASE-DOWN BLOCK!' : 'REJECTED!', q.team.isUser ? '#3dff7a' : '#ff3b3b');
              s.shooter.streak = 0; s.shooter.onFire = false;
              if (q.team.human || s.shooter.team.human) { this.slowT = 0.5; this.focus = q; }
              this.emit('block', { player: q, victim: s.shooter });
              sfx.board(); sfx.cheer(0.8);
              this.arena.excitement = Math.min(1, this.arena.excitement + 0.6);
              this.cameraShake = 0.25;
              s.fouled = null; // a clean block is not a foul: no whistle, no free throws
              return;
            }
          }
        }
      }
      if (s.t >= s.T) {
        if (s.kind === 'ft') { this.resolveFT(s); return; }
        b.pos.copy(s.target);
        if (s.made) { this.scored(s); return; }
        if (s.fouled) { sfx.rim(); this.recordFoul(s.fouled, s.shooter, 'SHOOTING FOUL'); this.startFreeThrows(s.shooter, s.pts); return; }
        b.state = 'loose';
        b.reboundable = true;
        s.shooter.streak = 0;
        if (s.shooter.onFire) { s.shooter.onFire = false; this.emit('fireOut', { player: s.shooter }); }
        this.emit('miss', { player: s.shooter, airball: s.airball, pts: s.pts });
        if (!s.airball) {
          this.shotClockFrozen = true;
          sfx.rim();
          if (s.team.isUser) sfx.groan();
          const hoop = this.hoopOf(s.team);
          const out = tmp.set(s.target.x - hoop.x, 0, s.target.z - hoop.z).normalize();
          const back = tmp2.set(s.start.x - hoop.x, 0, s.start.z - hoop.z).normalize();
          const sp = rand(1.5, 3.8);
          b.vel.set(out.x * sp + back.x * 0.8, rand(1.8, 4.2), out.z * sp + back.z * 0.8);
        } else {
          this.hud.feedback('AIRBALL', '#ff3b3b');
          sfx.groan();
        }
        return;
      }
      b.vel.y -= G * dt;
      b.pos.addScaledVector(b.vel, dt);
      return;
    }
    // Loose / free ball physics
    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);
    b.spin *= 0.99;
    if (b.pos.y < BALL_R) {
      b.pos.y = BALL_R;
      if (b.vel.y < -0.8) { sfx.dribble(Math.min(1, -b.vel.y / 6)); b.vel.y = -b.vel.y * 0.72; }
      else b.vel.y = 0;
      b.vel.x *= 0.9; b.vel.z *= 0.9;
    }
    for (const side of [-1, 1]) {
      const bx = C.BOARD_X - BALL_R;
      if (side * b.pos.x > bx && side * (b.pos.x - b.vel.x * dt) <= bx && Math.abs(b.pos.z) < 0.92 && b.pos.y > 2.9 && b.pos.y < 4.0) {
        b.pos.x = side * bx; b.vel.x = -b.vel.x * 0.6; sfx.board();
      }
    }
    // Arena walls
    if (Math.abs(b.pos.x) > C.HALF_L + 3) { b.pos.x = Math.sign(b.pos.x) * (C.HALF_L + 3); b.vel.x *= -0.5; }
    if (Math.abs(b.pos.z) > C.HALF_W + 3) { b.pos.z = Math.sign(b.pos.z) * (C.HALF_W + 3); b.vel.z *= -0.5; }

    if (b.state === 'loose' && this.state === 'live') {
      // Pickups
      let best = null, bd = 1e9;
      for (const p of this.allPlayers) {
        if (p === b.ignore) continue;
        const d = hdist(p.pos, b.pos);
        if (d < 0.7 && b.pos.y < p.reach + 0.15 && d < bd) { bd = d; best = p; }
      }
      if (best) this.setHolder(best);
    }
  }

  // ---------- Control: user + AI ----------
  controlPlayers(dt) {
    const off = this.possession, def = this.other(off);
    const b = this.ball;
    const live = this.state === 'live';
    for (const p of this.allPlayers) {
      p.sprinting = false;
      if (!live || !this.ctl(p)) this.aiControl(p, off, def, dt);
    }
    if (live) for (const t of this.teams) if (t.cp && this.ctl(t.cp)) this.userControl(t.cp, dt);
    // Loose-ball chasing: closest two from each team chase
    if (live && b.state === 'loose') {
      for (const t of this.teams) {
        const sorted = [...t.players].sort((a, c) => hdist(a.pos, b.pos) - hdist(c.pos, b.pos));
        for (const p of sorted.slice(0, 2)) {
          if (this.ctl(p)) continue;
          const land = tmp.set(b.pos.x + b.vel.x * 0.35, 0, b.pos.z + b.vel.z * 0.35);
          this.moveTo(p, land, true);
          const d = hdist(p.pos, b.pos);
          if (d < 1.4 && b.pos.y > 2.1 && b.pos.y < 3.8 && b.vel.y < 1 && !p.airborne && Math.random() < dt * 8) p.jump(0.6, 0.6);
        }
      }
    }
  }

  moveTo(p, target, sprint = false) {
    // AI never intentionally leaves the court (inbounders may stand on the line)
    const mx = C.HALF_L - (p === this.inbounder && this.state === 'dead' ? 0.15 : 0.6);
    const mz = C.HALF_W - (p === this.inbounder && this.state === 'dead' ? 0.15 : 0.6);
    const tx = Math.max(-mx, Math.min(mx, target.x)), tz = Math.max(-mz, Math.min(mz, target.z));
    const dx = tx - p.pos.x, dz = tz - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) { p.desired.set(0, 0, 0); return d; }
    const k = Math.min(1, d / 1.0);
    p.desired.set(dx / d * k, 0, dz / d * k);
    p.sprinting = sprint && d > 2.5;
    return d;
  }

  userControl(p, dt) {
    const b = this.ball;
    // Screen-relative movement: camera looks toward -z, so screen-right = +x, screen-up = -z
    const input = p.team.input; // this team's controller (local keyboard/pad, or the remote player)
    let mx = input.moveX, mz = input.moveY;
    p.desired.set(mx, 0, mz);
    p.sprinting = input.sprint;
    if (p.state === 'idle') p.faceTarget = null;

    if (b.holder === p) {
      if (input.pressed.shoot) this.startShot(p);
      else if (input.pressed.pass && p.state === 'idle') this.startPass(p, this.pickPassTarget(p, mx, mz));
      else if (input.pressed.move) this.dribbleMove(p);
    } else if (p.team === this.possession && b.state !== 'loose') {
      // Offense without the ball: call for it / switch
      if (input.pressed.pass && b.holder && b.holder.team === p.team) this.startPass(b.holder, p);
      if (input.pressed.shoot && !p.airborne) p.jump(0.6, 0.65);
    } else {
      // Defense or loose ball
      if (input.pressed.shoot && !p.airborne) { p.jump(0.65, 0.75); this.emit('defJump', { player: p }); }
      if (input.pressed.pass && b.holder) this.attemptSteal(p);
      if (input.pressed.move && !(this.opts.strictLock && p.team.lock)) {
        const target = b.holder ? b.holder.pos : b.pos;
        const next = this.closestTo(p.team.players, target, p);
        if (next) {
          if (p.team.lock) p.team.lock = next;
          this.setCtl(p.team, next);
          this.emit('switch', { player: next });
        }
      }
      // Face the ball handler while defending
      if (b.holder && b.holder.team !== p.team && hdist(p.pos, b.holder.pos) < 3) p.faceTarget = b.holder.pos;
    }
    void dt;
  }

  offenseSpot(team, i, p) {
    const dir = team.dir;
    const spots = [
      [7.6, 0], [7.4, 0.95], [7.0, -1.33], [5.0, -0.55], [2.4, 0.95],
    ];
    if (p.cutT > 0) return tmp.set(dir * (C.HOOP_X - 1.4), 0, (p.cutZ || 0));
    let [r, a] = spots[i];
    const tc = team.tac;
    if (i <= 2) r *= 0.92 + tc.threes * 0.2;               // shooters stand deeper when the team hunts threes
    else r *= 1 - (tc.attack - 0.5) * 0.16;                 // bigs set up closer when attacking the rim
    const jitter = Math.sin(this.time * 0.5 + i * 2) * 0.5;
    return tmp.set(dir * (C.HOOP_X - r * Math.cos(a)), 0, r * Math.sin(a) + jitter);
  }

  aiControl(p, off, def, dt) {
    const b = this.ball;
    if (p.state !== 'idle' && p.state !== 'steal') return; // committed to an action
    p.faceTarget = null;
    const live = this.state === 'live';

    if (!live && this.state === 'dead') {
      if (p === this.inbounder && this.pendingInbound) { this.moveTo(p, this.pendingInbound.spot, true); return; }
    }

    if (p.team === off) {
      if (b.holder === p && live) { this.aiBallHandler(p, dt); return; }
      // Off-ball offense
      p.cutT = Math.max(0, (p.cutT || 0) - dt);
      if (live && p.cutT <= 0 && Math.random() < dt * (0.03 + 0.08 * off.tac.attack) && p.index !== 0) { p.cutT = 1.6; p.cutZ = rand(-1.2, 1.2); }
      let target = this.offenseSpot(off, p.index, p).clone();
      // Crash the boards on a shot
      if (b.state === 'shot' && p.index >= 5 - (1 + Math.round(off.tac.glass * 3))) target.set(off.dir * (C.HOOP_X - 1.8), 0, (p.index % 2 ? -1.2 : 1.2) * (0.7 + (p.index % 3) * 0.35));
      this.moveTo(p, target, hdist(p.pos, target) > 5);
      return;
    }
    // Defense
    const man = off.players[p.index] || off.players[p.index % off.players.length]; // extra defenders double-team
    if (!man) { p.desired.set(0, 0, 0); return; }
    const hoop = this.hoopOf(off);
    const toHoop = tmp2.set(hoop.x - man.pos.x, 0, -man.pos.z);
    const dh = toHoop.length();
    toHoop.normalize();
    const onBall = b.holder === man;
    const tut = this.passive() && !p.team.human;
    const dtc = p.team.tac;
    let gap = onBall ? 1.35 - dtc.pressure * 0.55 + (1 - this.diff.aiDef) * 0.8 : (1.5 + Math.min(2.2, hdist(man.pos, b.pos) / 5)) * (1.3 - dtc.line * 0.6);
    if (tut) gap += 1.4;
    gap = Math.min(gap, Math.max(0.5, dh - 0.6));
    if (p.team.human) gap = onBall ? 1.1 : gap; // teammates of a human play solid D
    const target = tmp.set(man.pos.x + toHoop.x * gap, 0, man.pos.z + toHoop.z * gap);
    // Help defense: if ball handler is driving into the paint, the nearest helper steps in
    if (b.holder && b.holder !== man && b.holder.team === off && hdist(b.holder.pos, hoop) < 3.5 + (1 - dtc.line) * 2 && p.index >= 3 - Math.round((1 - dtc.line) * 2)) {
      target.lerp(tmp2.set(b.holder.pos.x + (hoop.x - b.holder.pos.x) * 0.4, 0, b.holder.pos.z * 0.6), 0.45 + (1 - dtc.line) * 0.35);
    }
    // Reaction lag: blend toward the target
    p.defTarget = p.defTarget || target.clone();
    p.defTarget.lerp(target, Math.min(1, dt / Math.max(0.05, this.diff.react / (1 + p.team.skill * 0.12))));
    this.moveTo(p, p.defTarget, hdist(p.pos, p.defTarget) > 3);
    if (hdist(p.pos, man.pos) < 3) p.faceTarget = man.pos;

    if (!live || this.passive()) return;
    // Contest shots
    const shooter = b.holder && b.holder.team === off && b.holder.state !== 'idle' ? b.holder : null;
    if (shooter && !p.airborne && hdist(p.pos, shooter.pos) < 2.3 && shooter.actionT > this.diff.react * 0.7) {
      p.desired.set(shooter.pos.x - p.pos.x, 0, shooter.pos.z - p.pos.z).normalize();
      if (Math.random() < (p.team.human ? 0.55 : this.diff.aiDef * 0.8 * (1 + p.team.skill * 0.1)) * (0.8 + dtc.pressure * 0.4)) p.jump(0.65, 0.55 + p.r.block / 300);
      else p.jump(0.4, 0.2);
    }
    // Steal attempts
    if (onBall && man.state === 'idle' && hdist(p.pos, man.pos) < 1.3 && Math.random() < dt * 0.1 * (p.team.human ? 0.5 : this.diff.aiSteal) * (0.4 + dtc.pressure * 1.2) * (1 + p.team.skill * 0.1)) {
      this.attemptSteal(p);
    }
  }

  aiBallHandler(p, dt) {
    const off = p.team;
    const hoop = this.hoopOf(off);
    const dir = off.dir;
    p.holdT = (p.holdT || 0) + dt;
    p.decT = (p.decT || 0) - dt;
    const dHoop = Math.hypot(p.pos.x - hoop.x, p.pos.z);
    const backcourt = p.pos.x * dir < 0.5;
    const tc = off.tac, sk = off.skill;

    if (this.opts.tutorial && !p.team.human) {
      // Tutorial: CPU just dribbles around the top of the key
      if (!p.aiTarget || p.decT <= 0 || hdist(p.pos, p.aiTarget) < 0.5) {
        p.decT = rand(1.5, 2.5);
        p.aiTarget = new THREE.Vector3(dir * (C.HOOP_X - rand(6.5, 8)), 0, rand(-3, 3));
      }
      this.moveTo(p, p.aiTarget, false);
      p.desired.multiplyScalar(0.45);
      return;
    }
    if (p.driveT > 0) {
      p.driveT -= dt;
      this.moveTo(p, tmp.set(hoop.x - dir * 0.8, 0, p.pos.z * 0.3), true);
      if (dHoop < 2.3) { p.driveT = 0; this.startShot(p); }
      return;
    }
    if (!p.aiTarget || p.decT <= 0) {
      p.decT = rand(0.45, 0.8) * (1.25 - tc.pace * 0.5);
      if (backcourt) {
        p.aiTarget = new THREE.Vector3(dir * 5, 0, rand(-2, 2));
        if (p.index !== 0 && p.holdT > 0.5) {
          const pg = off.players[0];
          if (this.nearestDefender(pg).d > 1.5 && Math.random() < 0.6) { this.startPass(p, pg); return; }
        }
      } else {
        const me = this.shotChance(p);
        const ev = me.p * (me.three ? 3 * (0.7 + tc.threes * 0.6) : 2 * (1.08 - tc.threes * 0.16));
        const open = this.nearestDefender(p).d;
        if (this.shotClock < 2.5 + Math.random()) { this.startShot(p); return; }
        if (dHoop < 2.3) { this.startShot(p); return; }
        if (open > 1.7 && ev > 0.9 + sk * 0.06 - (tc.pace - 0.5) * 0.2 && p.holdT > 0.5 && Math.random() < 0.55) { this.startShot(p); return; }
        // A teammate cutting to the rim, open: throw it up to him
        const cutter = off.players.find((q) => q !== p && (q.cutT || 0) > 0.3 && q.r.dunk >= 70 && Math.hypot(q.pos.x - hoop.x, q.pos.z) < 3 && this.nearestDefender(q).d > 0.9);
        if (cutter && dHoop > 4 && Math.random() < 0.18) { this.startPass(p, cutter); return; }
        // Lane to the rim?
        const laneOpen = this.allPlayers.every((q) => {
          if (q.team === off) return true;
          const ax = hoop.x - p.pos.x, az = -p.pos.z;
          const len = Math.hypot(ax, az);
          const t = ((q.pos.x - p.pos.x) * ax + (q.pos.z - p.pos.z) * az) / (len * len);
          if (t < 0 || t > 1) return true;
          const px = p.pos.x + ax * t, pz = p.pos.z + az * t;
          return Math.hypot(q.pos.x - px, q.pos.z - pz) > 1.1;
        });
        if (laneOpen && dHoop < 9 && Math.random() < 0.5 + p.r.inside / 300 + (tc.attack - 0.5) * 0.7) { p.driveT = 1.6; return; }
        // Dribble move to shake a tight defender
        if (open < 1.3 && Math.random() < 0.18 + p.r.handle / 500) this.dribbleMove(p);
        // Pass to a better option
        let bestMate = null, bestEv = ev;
        for (const q of off.players) {
          if (q === p) continue;
          const c = this.shotChance(q);
          const qev = c.p * (c.three ? 3 * (0.7 + tc.threes * 0.6) : 2) * (this.nearestDefender(q).d > 1.8 ? 1.15 : 0.85);
          if (qev > bestEv) { bestEv = qev; bestMate = q; }
        }
        // Move the ball with a purpose: only after holding it a moment, and only to a clearly better look
        const sinceCatch = this.time - this.ball.lastPassTime;
        if (bestMate && p.holdT > 1.1 * (1.5 - tc.passing) && sinceCatch > 1.4 * (1.4 - tc.passing * 0.8) && (bestEv > ev + 0.25 - (tc.passing - 0.5) * 0.4 || p.holdT > 3.5 * (1.4 - tc.passing * 0.8)) && Math.random() < 0.4 + p.r.pass / 400 + (tc.passing - 0.5) * 0.5 + sk * 0.04) { this.startPass(p, bestMate); return; }
        if (p.holdT > 5 && open > 1.2) { this.startShot(p); return; }
        const spot = this.offenseSpot(off, p.index, p);
        p.aiTarget = new THREE.Vector3(spot.x + rand(-1.2, 1.2), 0, spot.z + rand(-1.2, 1.2));
      }
    }
    if (p.aiTarget) this.moveTo(p, p.aiTarget, backcourt);
  }

  // ---------- Info for HUD ----------
  clockText() {
    const s = Math.max(0, this.gameClock);
    if (s < 60) return s.toFixed(1);
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  dispose() {
    for (const t of this.teams) for (const p of [...(t.full || t.players), ...t.bench]) this.scene.remove(p.root);
    if (this.ball.ring) this.scene.remove(this.ball.ring);
    this.scene.remove(this.ball.mesh);
  }
}
