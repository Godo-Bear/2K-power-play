import * as THREE from 'three';
import { C } from './arena.js';
import { Player } from './player.js';
import { DIFFICULTY } from './data.js';
import { input } from './input.js';
import { sfx } from './audio.js';
import { custom, applyCustomPlayer, updateCustomPlayer, makeCustomBall } from './assets.js';

const G = 9.8;
const BALL_R = 0.12;
const METER_TIME = 0.62;   // seconds for meter to reach top
const METER_TARGET = 0.88; // ideal release point on the meter (0..1)
const v3 = () => new THREE.Vector3();
const tmp = v3(), tmp2 = v3();
const rand = (a, b) => a + Math.random() * (b - a);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

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
    });
    this.home = mkTeam(homeData, true);
    this.away = mkTeam(awayData, false);
    this.teams = [this.home, this.away];
    for (const t of this.teams) t.players = t.data.roster.map((d, i) => new Player(d, t, i, scene));
    for (const p of this.allPlayers) applyCustomPlayer(p);
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

    this.period = 1;
    this.gameClock = this.quarterLen;
    this.shotClock = 24;
    this.shotClockFrozen = false;
    this.state = 'live';
    this.stateT = 0;
    this.possession = this.home;
    this.firstPossession = Math.random() < 0.5 ? this.home : this.away;
    this.userPlayer = this.user.players[0];
    this.meter = { visible: false, value: 0, target: METER_TARGET, win: this.diff.greenWindow, result: null };
    this.buzzerPlayed = false;
    this.cameraShake = 0;
    this.netAnim = [0, 0];
    this.inbounder = null;
    this.pendingInbound = null;
    this.events = [];

    this.startPeriod();
  }

  other(team) { return team === this.home ? this.away : this.home; }
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
      const m = off.players[i];
      p.pos.set(m.pos.x + off.dir * 2.2, 0, m.pos.z * 0.8);
      p.vel.set(0, 0, 0); p.state = 'idle'; p.jumpT = -1; p.y = 0;
    });
    this.setHolder(off.players[0], { silent: true });
    this.gameClock = this.period > 4 ? Math.max(60, this.quarterLen * 0.42) : this.quarterLen;
    this.shotClock = 24;
    this.shotClockFrozen = false;
    this.buzzerPlayed = false;
    this.state = 'live';
    if (off === this.user) this.setUserPlayer(off.players[0]);
    else this.setUserPlayer(this.user.players[0]);
  }

  setUserPlayer(p) {
    if (this.userPlayer) this.userPlayer.setControlled(false);
    this.userPlayer = p;
    p.setControlled(true, 0x35f0ff);
  }

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
    if (p.team.isUser) this.setUserPlayer(p);
    else if (prevTeam === this.user && p.team !== this.user) {
      // User now on defense: control the defender closest to the ball
      this.setUserPlayer(this.closestTo(this.user.players, p.pos));
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
    return { p: Math.max(0.02, Math.min(0.95, base * contest)), three, d, contest };
  }

  // ---------- Actions ----------
  startShot(p) {
    if (this.ball.holder !== p || p.state !== 'idle') return;
    const hoop = this.hoopOf(p.team);
    const d = Math.hypot(p.pos.x - hoop.x, p.pos.z);
    p.faceTarget = hoop;
    p.actionT = 0;
    p.released = false;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (d < 2.6) {
      const canDunk = p.r.dunk >= 68 && (p.sprinting || sp > 3 || d < 1.4) && p.stamina > 0.1;
      p.state = canDunk && Math.random() < 0.4 + p.r.dunk / 200 ? 'dunk' : 'layup';
      p.jump(p.state === 'dunk' ? 0.8 : 0.7, p.state === 'dunk' ? 0.95 : 0.7);
    } else {
      p.state = 'shoot';
      p.vel.multiplyScalar(0.3);
      p.jump(0.78, 0.45);
      p.aiRelease = p.team.isUser && p === this.userPlayer && !this.autoplay ? null
        : METER_TARGET + (Math.random() - 0.5) * 0.3 * (1.15 - p.r[this.isThree(p.team, p.pos.x, p.pos.z) ? 'three' : 'mid'] / 100);
    }
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
    const isUser = team.isUser && p === this.userPlayer;
    if (p.state === 'shoot') {
      const val = Math.min(1.25, p.actionT / METER_TIME);
      const err = val - METER_TARGET;
      const w = isUser ? this.diff.greenWindow : 0.06;
      const ae = Math.abs(err);
      if (ae <= w) {
        label = 'EXCELLENT'; color = '#3dff7a';
        prob = info.contest >= 0.7 ? 1 : Math.max(prob, 0.72);
      } else if (ae <= w * 2.5) { label = err < 0 ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE'; color = '#ffd60a'; prob *= 0.78; }
      else if (ae <= w * 5) { label = err < 0 ? 'EARLY' : 'LATE'; color = '#ff8c1a'; prob *= 0.4; }
      else { label = err < 0 ? 'VERY EARLY' : 'VERY LATE'; color = '#ff3b3b'; prob *= 0.08; airball = Math.random() < 0.5; }
      if (isUser) {
        this.meter.result = { label, color, value: val };
        this.meter.hideT = 0.9;
      }
    } else {
      // Layup / dunk
      prob = Math.max(prob, p.state === 'dunk' ? 0.9 : 0.62) * (0.7 + p.r.inside / 330);
      if (p.state === 'dunk') prob = Math.min(0.97, prob * Math.min(1.05, info.contest + 0.25));
    }
    if (!team.isUser) prob *= this.diff.aiShot;
    prob = Math.min(1, prob);
    if (label === 'EXCELLENT' && isUser) sfx.green();
    const made = Math.random() < prob;
    const pts = info.three ? 3 : 2;
    p.stats.fga++; if (pts === 3) p.stats.tpa++;

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
    let T = p.state === 'shoot' ? 0.75 + dist * 0.06 : (p.state === 'dunk' ? 0.18 : 0.5);
    b.state = 'shot';
    b.holder = null;
    b.lastTouch = team;
    b.shot = { shooter: p, team, made, pts, T, t: 0, target, start, airball, kind: p.state, checked: new Set() };
    b.vel.set((target.x - start.x) / T, (target.y - start.y + 0.5 * G * T * T) / T, (target.z - start.z) / T);
    b.spin = -8;
    if (p.state === 'dunk') { b.vel.set((target.x - start.x) / T, (target.y - start.y) / T - 2, (target.z - start.z) / T); }
  }

  startPass(p, target) {
    if (!target || this.ball.holder !== p) return;
    const b = this.ball;
    b.state = 'pass';
    b.holder = null;
    b.lastTouch = p.team;
    const d = hdist(p.pos, target.pos);
    b.pass = { from: p, to: target, t: 0, dur: Math.max(0.25, d / 15), start: b.pos.clone(), arc: 0.2 + d * 0.03, checked: new Set() };
    p.state = 'idle';
    p.faceTarget = null;
    sfx.pass();
    b.lastPasser = p; b.lastPassTime = this.time;
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
    const h = this.ball.holder;
    if (!h || h.team === p.team) return;
    const d = hdist(p.pos, h.pos);
    if (d > 1.6 || h.state !== 'idle') { p.stumbleT = 0.25; return; }
    let chance = 0.12 + (p.r.steal - h.r.handle) / 260 + (Math.hypot(h.vel.x, h.vel.z) > 3 ? 0.04 : 0);
    if (!p.team.isUser) chance *= this.diff.aiSteal * 0.7;
    if (Math.random() < chance) {
      const b = this.ball;
      b.state = 'loose'; b.holder = null;
      b.vel.set((p.pos.x - h.pos.x) * 2 + rand(-1.5, 1.5), 1.5, (p.pos.z - h.pos.z) * 2 + rand(-1.5, 1.5));
      b.ignore = h; b.ignoreT = 0.6;
      b.lastTouch = p.team;
      b.reboundable = false;
      p.stats.stl++; h.stats.to++;
      this.hud.feedback('STOLEN!', p.team.isUser ? '#3dff7a' : '#ff3b3b');
      sfx.cheer(0.5);
      this.arena.excitement = Math.min(1, this.arena.excitement + 0.4);
    } else {
      p.stumbleT = 0.4;
    }
  }

  dribbleMove(p) {
    if (this.ball.holder !== p || p.state !== 'idle' || (p.moveCd || 0) > 0) return;
    p.moveCd = 1.2;
    p.burstT = 0.5;
    p.crossSide = -(p.crossSide || 1);
    const { p: def, d } = this.nearestDefender(p);
    if (def && d < 1.9 && !def.airborne) {
      const chance = 0.18 + (p.r.handle - def.r.def) / 220;
      if (Math.random() < chance) {
        def.stumbleT = 1.0;
        if (p.team.isUser) this.hud.feedback('ANKLES BROKEN!', '#35f0ff');
        sfx.cheer(0.6);
        this.arena.excitement = Math.min(1, this.arena.excitement + 0.5);
      }
    }
    sfx.squeak();
  }

  // ---------- Possession changes / dead balls ----------
  turnover(team, reason) {
    // `team` loses the ball
    sfx.whistle();
    this.hud.toast(reason, `${this.other(team).data.name} ball`);
    const offender = this.ball.holder || (this.ball.shot && this.ball.shot.shooter);
    if (offender) offender.stats.to++;
    const newOff = this.other(team);
    const spot = this.ball.pos.clone();
    spot.x = Math.max(-C.HALF_L + 0.6, Math.min(C.HALF_L - 0.6, spot.x));
    spot.z = Math.sign(spot.z || 1) * (C.HALF_W - 0.25);
    this.beginDead(1.4, newOff, spot);
    this.ball.state = 'free';
    this.ball.holder = null;
  }

  beginDead(t, newOff, spot) {
    this.state = 'dead';
    this.stateT = t;
    this.possession = newOff;
    this.shotClockFrozen = true;
    this.inbounder = this.closestTo(newOff.players, spot);
    this.pendingInbound = { team: newOff, spot };
    for (const p of this.allPlayers) { p.state = 'idle'; p.faceTarget = null; }
  }

  finishInbound() {
    const { team, spot } = this.pendingInbound;
    const p = this.inbounder;
    p.pos.x = spot.x; p.pos.z = spot.z;
    p.vel.set(0, 0, 0);
    this.shotClock = 24;
    this.shotClockFrozen = false;
    this.setHolder(p, { silent: true });
    this.ball.reboundable = false;
    this.state = 'live';
    this.pendingInbound = null;
    if (team === this.user) this.setUserPlayer(p);
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
    const loud = shot.pts === 3 ? 1 : 0.7;
    if (team.isHome) sfx.cheer(loud); else sfx.cheer(0.25);
    this.arena.excitement = Math.min(1, this.arena.excitement + (team.isHome ? loud : 0.3));
    this.hud.scored(team, shot.pts, p);
    const newOff = this.other(team);
    const spot = new THREE.Vector3(team.dir * (C.HALF_L - 0.2), 0, 1.2);
    this.beginDead(1.7, newOff, spot);
    this.ball.state = 'free';
    this.ball.pos.set(team.dir * C.HOOP_X, C.RIM_H - 0.15, 0);
    this.ball.vel.set(0, -2, 0);
  }

  // ---------- Main update ----------
  update(dt) {
    this.time += dt;
    this.cameraShake = Math.max(0, this.cameraShake - dt);
    if (this.meter.hideT !== undefined) {
      this.meter.hideT -= dt;
      if (this.meter.hideT <= 0) { this.meter.visible = false; this.meter.result = null; this.meter.hideT = undefined; }
    }
    for (const p of this.allPlayers) { p.moveCd = Math.max(0, (p.moveCd || 0) - dt); }

    if (this.state === 'break') {
      this.stateT -= dt;
      for (const p of this.allPlayers) { p.desired.set(0, 0, 0); p.update(dt); }
      if (this.stateT <= 0) { this.startPeriod(); this.hud.hideToast(); }
    } else if (this.state === 'over') {
      for (const p of this.allPlayers) { p.desired.set(0, 0, 0); p.update(dt); }
    } else {
      if (this.state === 'live') this.tickClocks(dt);
      if (this.state === 'dead') {
        this.stateT -= dt;
        if (this.stateT <= 0) this.finishInbound();
      }
      this.controlPlayers(dt);
      for (const p of this.allPlayers) {
        if (p.state !== 'idle') p.actionT += dt;
        this.updateAction(p);
        p.update(dt);
      }
      this.separatePlayers();
      this.updateBall(dt);
      if (this.state === 'live') this.checkRules();
    }

    // Animate players
    for (const p of this.allPlayers) {
      const hasBall = this.ball.holder === p;
      p.animate(dt, {
        hasBall,
        dribble: hasBall && p.state === 'idle',
        defending: p.team !== this.possession && this.state === 'live',
        released: p.released,
      });
      const animState = p.airborne && p.state === 'idle' ? 'jump'
        : p.state !== 'idle' && p.state !== 'steal' ? p.state
        : Math.hypot(p.vel.x, p.vel.z) > 0.6 ? 'run' : hasBall ? 'dribble' : 'idle';
      updateCustomPlayer(p, dt, animState);
    }
    // Ball mesh
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.mesh.rotation.x += this.ball.spin * dt;
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
    this.meter.visible = false;
    if (this.period >= 4 && this.home.score !== this.away.score) {
      this.state = 'over';
      this.ball.state = 'free';
      this.ball.holder = null;
      const winner = this.home.score > this.away.score ? this.home : this.away;
      if (winner.isHome) sfx.cheer(1);
      this.hud.gameOver(this);
      return;
    }
    const label = this.period === 2 ? 'HALFTIME' : this.period >= 4 ? 'END OF REGULATION' : `END OF ${this.periodName()}`;
    this.hud.toast(label, `${this.away.data.id} ${this.away.score} - ${this.home.score} ${this.home.data.id}`, 3);
    if (this.period === 2) for (const t of this.teams) t.dir *= -1;
    this.period++;
    this.state = 'break';
    this.stateT = 3.2;
    this.ball.state = 'free';
    this.ball.holder = null;
  }

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
        const min = 0.6;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          c.pos.x += nx * push; c.pos.z += nz * push;
        }
      }
    }
  }

  updateAction(p) {
    const b = this.ball;
    if (p.state === 'steal' && p.actionT > 0.3) p.state = 'idle';
    if (p.state === 'shoot') {
      const isUser = p === this.userPlayer && p.team.isUser && !this.autoplay;
      if (isUser) {
        this.meter.visible = true;
        this.meter.value = Math.min(1.2, p.actionT / METER_TIME);
        this.meter.win = this.diff.greenWindow;
        this.meter.hideT = undefined;
        if (!p.released && (!input.held.shoot || p.actionT > METER_TIME * 1.25)) this.releaseShot(p);
      } else if (!p.released && p.actionT / METER_TIME >= p.aiRelease) this.releaseShot(p);
      if (p.released && !p.airborne) { p.state = 'idle'; p.faceTarget = null; }
    }
    if (p.state === 'layup' || p.state === 'dunk') {
      const hoop = this.hoopOf(p.team);
      const d = Math.hypot(p.pos.x - hoop.x, p.pos.z);
      const front = tmp.set(hoop.x - p.team.dir * 0.55, 0, 0);
      if (d > 0.6) { p.desired.set(front.x - p.pos.x, 0, front.z - p.pos.z).normalize(); }
      else p.desired.set(0, 0, 0);
      if (!p.released && p.actionT > (p.state === 'dunk' ? 0.38 : 0.3)) this.releaseShot(p);
      if (p.released && !p.airborne) { p.state = 'idle'; p.faceTarget = null; }
    }
    if (b.holder === p && p.state === 'shoot' && p.released) p.state = 'idle';
  }

  // ---------- Ball physics ----------
  updateBall(dt) {
    const b = this.ball;
    b.ignoreT = Math.max(0, b.ignoreT - dt);
    if (b.ignoreT <= 0) b.ignore = null;
    if (b.state === 'held' && b.holder) {
      const p = b.holder;
      b.spin = 0;
      if (p.state === 'shoot' || p.state === 'layup') {
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
        const off = tmp.set(0.3 * side, 0, 0.32).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.facing);
        const handY = p.data.height * 0.47;
        b.pos.set(p.pos.x + off.x, BALL_R + (handY - BALL_R) * bounce + p.y, p.pos.z + off.z);
      }
      return;
    }
    if (b.state === 'pass') {
      const ps = b.pass;
      ps.t += dt / ps.dur;
      const target = ps.to;
      const end = tmp.set(target.pos.x, 1.3 + target.y, target.pos.z);
      const u = Math.min(1, ps.t);
      b.pos.lerpVectors(ps.start, end, u);
      b.pos.y += Math.sin(u * Math.PI) * ps.arc;
      b.spin = 6;
      // Interceptions
      for (const q of this.other(ps.from.team).players) {
        if (ps.checked.has(q)) continue;
        const d = hdist(q.pos, b.pos);
        if (d < 0.75 && b.pos.y < q.reach + 0.2 && u > 0.15 && u < 0.9) {
          ps.checked.add(q);
          let chance = 0.04 + q.r.steal / 700;
          if (!q.team.isUser) chance *= this.diff.aiSteal;
          if (d < 0.4) chance += 0.12;
          if (Math.random() < chance) {
            q.stats.stl++; ps.from.stats.to++;
            this.hud.feedback('INTERCEPTED!', q.team.isUser ? '#3dff7a' : '#ff3b3b');
            this.setHolder(q);
            sfx.cheer(0.5);
            return;
          }
        }
      }
      if (u >= 1) this.setHolder(target);
      return;
    }
    if (b.state === 'shot') {
      const s = b.shot;
      s.t += dt;
      // Blocks
      if (s.t < 0.45 && s.kind !== 'dunk') {
        for (const q of this.other(s.team).players) {
          if (s.checked.has(q) || !q.airborne) continue;
          const hand = tmp.set(q.pos.x, q.reach, q.pos.z);
          if (hand.distanceTo(b.pos) < 0.6) {
            s.checked.add(q);
            let chance = 0.25 + q.r.block / 220 - (s.kind === 'shoot' ? 0.05 : 0);
            if (!q.team.isUser) chance *= this.diff.aiDef;
            if (Math.random() < chance) {
              b.state = 'loose';
              const away = tmp2.set(b.pos.x - q.pos.x, 0, b.pos.z - q.pos.z).normalize();
              b.vel.set(away.x * rand(3, 6), rand(-1, 2), away.z * rand(3, 6));
              b.reboundable = true;
              b.lastTouch = q.team;
              q.stats.blk++;
              this.hud.feedback('REJECTED!', q.team.isUser ? '#3dff7a' : '#ff3b3b');
              sfx.board(); sfx.cheer(0.8);
              this.arena.excitement = Math.min(1, this.arena.excitement + 0.6);
              this.cameraShake = 0.25;
              return;
            }
          }
        }
      }
      if (s.t >= s.T) {
        b.pos.copy(s.target);
        if (s.made) { this.scored(s); return; }
        b.state = 'loose';
        b.reboundable = true;
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
      if (p !== this.userPlayer || !live || !p.team.isUser || this.autoplay) this.aiControl(p, off, def, dt);
    }
    if (live && this.userPlayer && !this.autoplay) this.userControl(this.userPlayer, dt);
    // Loose-ball chasing: closest two from each team chase
    if (live && b.state === 'loose') {
      for (const t of this.teams) {
        const sorted = [...t.players].sort((a, c) => hdist(a.pos, b.pos) - hdist(c.pos, b.pos));
        for (const p of sorted.slice(0, 2)) {
          if (p === this.userPlayer && t.isUser) continue;
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
      if (input.pressed.shoot && !p.airborne) p.jump(0.65, 0.75);
      if (input.pressed.pass && b.holder) this.attemptSteal(p);
      if (input.pressed.move) {
        const target = b.holder ? b.holder.pos : b.pos;
        const next = this.closestTo(p.team.players, target, p);
        if (next && hdist(next.pos, target) < hdist(p.pos, target) + 3) this.setUserPlayer(next);
        else if (next) this.setUserPlayer(next);
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
    const [r, a] = spots[i];
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
      if (live && p.cutT <= 0 && Math.random() < dt * 0.07 && p.index !== 0) { p.cutT = 1.6; p.cutZ = rand(-1.2, 1.2); }
      let target = this.offenseSpot(off, p.index, p).clone();
      // Crash the boards on a shot
      if (b.state === 'shot' && (p.index >= 3)) target.set(off.dir * (C.HOOP_X - 1.8), 0, p.index === 3 ? -1.2 : 1.2);
      this.moveTo(p, target, hdist(p.pos, target) > 5);
      return;
    }
    // Defense
    const man = off.players[p.index];
    const hoop = this.hoopOf(off);
    const toHoop = tmp2.set(hoop.x - man.pos.x, 0, -man.pos.z);
    const dh = toHoop.length();
    toHoop.normalize();
    const onBall = b.holder === man;
    let gap = onBall ? 1.0 + (1 - this.diff.aiDef) * 0.8 : 1.5 + Math.min(2.2, hdist(man.pos, b.pos) / 5);
    gap = Math.min(gap, Math.max(0.5, dh - 0.6));
    if (p.team.isUser) gap = onBall ? 1.1 : gap; // teammates of the user play solid D
    const target = tmp.set(man.pos.x + toHoop.x * gap, 0, man.pos.z + toHoop.z * gap);
    // Help defense: if ball handler is driving into the paint, the nearest helper steps in
    if (b.holder && b.holder !== man && b.holder.team === off && hdist(b.holder.pos, hoop) < 3.5 && p.index >= 3) {
      target.lerp(tmp2.set(b.holder.pos.x + (hoop.x - b.holder.pos.x) * 0.4, 0, b.holder.pos.z * 0.6), 0.6);
    }
    // Reaction lag: blend toward the target
    p.defTarget = p.defTarget || target.clone();
    p.defTarget.lerp(target, Math.min(1, dt / Math.max(0.05, this.diff.react)));
    this.moveTo(p, p.defTarget, hdist(p.pos, p.defTarget) > 3);
    if (hdist(p.pos, man.pos) < 3) p.faceTarget = man.pos;

    if (!live) return;
    // Contest shots
    const shooter = b.holder && b.holder.team === off && b.holder.state !== 'idle' ? b.holder : null;
    if (shooter && !p.airborne && hdist(p.pos, shooter.pos) < 2.3 && shooter.actionT > this.diff.react * 0.7) {
      p.desired.set(shooter.pos.x - p.pos.x, 0, shooter.pos.z - p.pos.z).normalize();
      if (Math.random() < (p.team.isUser ? 0.6 : this.diff.aiDef)) p.jump(0.65, 0.55 + p.r.block / 300);
      else p.jump(0.4, 0.2);
    }
    // Steal attempts
    if (onBall && man.state === 'idle' && hdist(p.pos, man.pos) < 1.3 && Math.random() < dt * 0.1 * (p.team.isUser ? 0.5 : this.diff.aiSteal)) {
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

    if (p.driveT > 0) {
      p.driveT -= dt;
      this.moveTo(p, tmp.set(hoop.x - dir * 0.8, 0, p.pos.z * 0.3), true);
      if (dHoop < 2.3) { p.driveT = 0; this.startShot(p); }
      return;
    }
    if (!p.aiTarget || p.decT <= 0) {
      p.decT = rand(0.3, 0.55);
      if (backcourt) {
        p.aiTarget = new THREE.Vector3(dir * 5, 0, rand(-2, 2));
        if (p.index !== 0 && p.holdT > 0.5) {
          const pg = off.players[0];
          if (this.nearestDefender(pg).d > 1.5 && Math.random() < 0.6) { this.startPass(p, pg); return; }
        }
      } else {
        const me = this.shotChance(p);
        const ev = me.p * (me.three ? 3 : 2);
        const open = this.nearestDefender(p).d;
        if (this.shotClock < 2.5 + Math.random()) { this.startShot(p); return; }
        if (dHoop < 2.3) { this.startShot(p); return; }
        if (open > 1.7 && ev > 0.9 && p.holdT > 0.5 && Math.random() < 0.55) { this.startShot(p); return; }
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
        if (laneOpen && dHoop < 9 && Math.random() < 0.5 + p.r.inside / 300) { p.driveT = 1.6; return; }
        // Dribble move to shake a tight defender
        if (open < 1.3 && Math.random() < 0.18 + p.r.handle / 500) this.dribbleMove(p);
        // Pass to a better option
        let bestMate = null, bestEv = ev;
        for (const q of off.players) {
          if (q === p) continue;
          const c = this.shotChance(q);
          const qev = c.p * (c.three ? 3 : 2) * (this.nearestDefender(q).d > 1.8 ? 1.15 : 0.85);
          if (qev > bestEv) { bestEv = qev; bestMate = q; }
        }
        if (bestMate && (bestEv > ev + 0.12 || p.holdT > 3) && Math.random() < 0.45 + p.r.pass / 400) { this.startPass(p, bestMate); return; }
        if (p.holdT > 5 && open > 1.2) { this.startShot(p); return; }
        const spot = this.offenseSpot(off, p.index, p);
        p.aiTarget = new THREE.Vector3(spot.x + rand(-2, 2), 0, spot.z + rand(-2, 2));
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
    for (const p of this.allPlayers) this.scene.remove(p.root);
    this.scene.remove(this.ball.mesh);
  }
}
