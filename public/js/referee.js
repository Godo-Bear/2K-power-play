// Officials and benches: two referees who run with the play and signal calls, plus benches where the substitutes sit.
import * as THREE from 'three';
import { C } from './arena.js';
import { Player } from './player.js';
import { applyCustomPlayer, updateCustomPlayer } from './assets.js';

const RATINGS = { three: 60, mid: 60, inside: 60, dunk: 60, pass: 60, handle: 60, speed: 62, def: 60, steal: 60, block: 60, reb: 60 };
const SKINS = ['#c68642', '#8d5524', '#e0ac69'];

// Where each substitute sits: the far sideline, home bench left of centre, away bench right
export function seatPos(team, slot) {
  const side = team.isHome ? -1 : 1;
  return { x: side * (2.9 + slot * 1.0), z: -(C.HALF_W + 2.15) };
}

export function buildBenches(scene) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x35f0ff, roughness: 0.5, emissive: 0x0a2a30 });
  for (const side of [-1, 1]) {
    const x = side * (2.9 + 2.0);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.1, 0.55), mat);
    seat.position.set(x, 0.45, -(C.HALF_W + 2.38)); g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.6, 0.08), mat);
    back.position.set(x, 0.8, -(C.HALF_W + 2.68)); g.add(back);
    const base = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.4, 0.4), mat);
    base.position.set(x, 0.2, -(C.HALF_W + 2.38)); g.add(base);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.04, 0.58), trim);
    stripe.position.set(x, 0.51, -(C.HALF_W + 2.38)); g.add(stripe);
  }
  scene.add(g);
  return g;
}

export class Referees {
  constructor(game, scene) {
    this.game = game; this.scene = scene;
    this.refs = [];
    const kit = { jerseyColor: '#2c2f38', trimColor: '#f2f2f2', human: false, isUser: false, isHome: false, tac: {}, skill: 0, dir: 1,
      data: { id: 'REF', city: '', name: 'Officials', primary: '#2c2f38', secondary: '#f2f2f2', accent: '#f2f2f2', logo: { symbol: '' }, noDecals: true, shoeUpper: '#111111', shoeSole: '#ffffff' } };
    for (let i = 0; i < 2; i++) {
      const data = { first: 'Ref', last: 'Official', pos: 'SF', number: 0, height: 1.84, skin: SKINS[i], hair: '#1a1a1a', hairStyle: i ? 1 : 0, ratings: { ...RATINGS }, bench: false };
      const p = new Player(data, kit, 20 + i, scene);
      p.root.visible = true;
      applyCustomPlayer(p);
      p.signal = null; p.signalT = 0; p.signalPoint = null;
      p.pos.set(i ? 3 : -3, 0, i ? -C.HALF_W - 0.8 : C.HALF_W - 1);
      this.refs.push(p);
    }
    game.on((type, d) => this.onEvent(type, d));
  }

  onEvent(type, d) {
    const g = this.game;
    const near = (pt) => this.refs.reduce((a, b) => (Math.hypot(a.pos.x - pt.x, a.pos.z - pt.z) < Math.hypot(b.pos.x - pt.x, b.pos.z - pt.z) ? a : b));
    const call = (ref, signal, dur, point) => { ref.signal = signal; ref.signalT = dur; ref.signalPoint = point || null; };
    if (type === 'foul' && d.def) call(near(d.def.pos), 'foul', 2.2);
    else if (type === 'score') { const r = near(g.ball.pos); call(r, d.pts === 3 ? 'three' : 'two', 1.3); }
    else if (type === 'goaltend') call(near(g.ball.pos), 'two', 1.6);
    else if (type === 'timeout') call(near(g.ball.pos), 'tee', 2.4);
    else if (type === 'turnover') {
      const r = near(g.ball.pos), reason = d.reason || '';
      if (reason.includes('OUT OF BOUNDS')) call(r, 'point', 1.8, { x: -d.team.dir, z: 0 }); // toward the end the new offense attacks
      else if (reason.includes('OFFENSIVE FOUL')) call(r, 'foul', 1.8);
      else if (reason.includes('VIOLATION')) call(r, 'travel', 1.8);
    }
  }

  update(dt) {
    const g = this.game, b = g.ball.pos;
    const dir = g.possession ? g.possession.dir : 1;
    const targets = [
      // lead official near the baseline the offense is attacking, on the side away from the ball
      { x: dir * (C.HALF_L - 1.1), z: (b.z > 0 ? -1 : 1) * 5.2 },
      // trail official on the far sideline, behind the play
      { x: Math.max(-C.HALF_L + 2, Math.min(C.HALF_L - 2, b.x - dir * 4.2)), z: -(C.HALF_W + 0.75) },
    ];
    this.refs.forEach((p, i) => {
      const t = targets[i];
      const dx = t.x - p.pos.x, dz = t.z - p.pos.z, d = Math.hypot(dx, dz);
      const frozen = p.signalT > 0;                                  // stand still while making a call
      const sp = frozen ? 0 : Math.min(5.2, d * 2.2);
      if (d > 0.05 && sp > 0) { p.vel.set(dx / d * sp, 0, dz / d * sp); p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; } else p.vel.set(0, 0, 0);
      const lookX = frozen && p.signal === 'point' && p.signalPoint ? p.pos.x + p.signalPoint.x : b.x, lookZ = frozen && p.signal === 'point' ? p.pos.z : b.z;
      const want = Math.atan2(lookX - p.pos.x, lookZ - p.pos.z);
      let df = want - p.facing; df = Math.atan2(Math.sin(df), Math.cos(df));
      p.facing += df * Math.min(1, dt * 7);
      p.targetFacing = p.facing;
      p.signalT = Math.max(0, p.signalT - dt);
      if (p.signalT <= 0) p.signal = null;
      p.animate(dt, { hasBall: false, dribble: false, defending: false, released: false });
      const speed = Math.hypot(p.vel.x, p.vel.z);
      let local = null;
      if (p.signal === 'point' && p.signalPoint) { const c = Math.cos(p.facing), s = Math.sin(p.facing); local = [p.signalPoint.x * c - p.signalPoint.z * s, 0.05, p.signalPoint.x * s + p.signalPoint.z * c]; }
      updateCustomPlayer(p, dt, speed > 2.6 ? 'run' : speed > 0.5 ? 'walk' : 'idle', speed, { hasBall: false, refSignal: p.signal, refPoint: local });
    });
  }

  dispose() { for (const p of this.refs) this.scene.remove(p.root); }
}
