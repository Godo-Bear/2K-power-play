// The Move Guide's live showcase: a small 3D court where a player performs the move you pick, so you can see every dunk,
// finish, shot, dribble move, pass and defensive move instead of only reading about it.
// It runs on the same player poses and the same timings the game uses (assets.js, player.js), so what you see here is what you get in a game.
import * as THREE from 'three';
import { Player } from './player.js';
import { applyCustomPlayer, updateCustomPlayer, makeCustomBall } from './assets.js';
import { C } from './arena.js';

const R = 0.12;                                    // ball radius
const RIM_Y = C.RIM_H;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// The rim is at the origin and the player attacks it from the left (-x). The camera shots:
const CAMS = {
  wide: [[-1.6, 2.6, 9.2], [-2.5, 1.6, 0]],
  rim: [[-0.9, 2.7, 6.9], [-1.4, 2.3, 0]],
  mid: [[-3.9, 2.0, 6.9], [-3.9, 1.35, 0]],
  shot: [[-3.0, 2.4, 8.4], [-3.0, 1.7, 0]],
  close: [[-4.4, 1.6, 4.7], [-4.4, 1.1, 0]],
};

// ---------- What there is to see ----------
// keys: the button ids shown with the player's own bindings. how: the input. d: what it is and when the game uses it.
export const GROUPS = [
  { id: 'dunks', label: 'Dunks' },
  { id: 'finishes', label: 'Finishes' },
  { id: 'shots', label: 'Shots' },
  { id: 'handles', label: 'Dribble moves' },
  { id: 'passes', label: 'Passing' },
  { id: 'defense', label: 'Defense' },
  { id: 'big', label: 'Post and fakes' },
];

export const MOVES = [
  { id: 'twohand', group: 'dunks', name: 'Two-hand slam', keys: ['sprint', 'shoot'], how: 'Sprint at the rim, then tap Shoot', cam: 'rim',
    d: 'Crowded at the rim, you power it home with both hands. The game picks it when a defender is right next to you.', need: 'Needs a Dunk rating of 68 or more and a running start.' },
  { id: 'onehand', group: 'dunks', name: 'One-hand jam', keys: ['sprint', 'shoot'], how: 'Sprint at the rim, then tap Shoot', cam: 'rim',
    d: 'A defender a step or two away: one big hand, ball cocked high above the rim.', need: 'Needs a Dunk rating of 68 or more and a running start.' },
  { id: 'windmill', group: 'dunks', name: 'Windmill', keys: ['sprint', 'shoot'], how: 'Sprint at the rim, then tap Shoot', cam: 'rim',
    d: 'Nobody near you at the rim: the arm swings a full circle before the slam. A wide-open dunk is a windmill or a tomahawk.', need: 'Needs a Dunk rating of 68 or more and a running start.' },
  { id: 'tomahawk', group: 'dunks', name: 'Tomahawk', keys: ['sprint', 'shoot'], how: 'Sprint at the rim, then tap Shoot', cam: 'rim',
    d: 'Wide open: the ball goes way back behind the head, then gets chopped down through the rim.', need: 'Needs a Dunk rating of 68 or more and a running start.' },
  { id: 'alleydunk', group: 'dunks', name: 'Alley-oop dunk', keys: ['pass'], how: 'Pass to a teammate under the rim', cam: 'wide',
    d: 'Throw a pass to a teammate who is near the basket and can dunk: it becomes a lob. They go up, catch it in the air and slam it.', need: 'The receiver needs a Dunk rating of 70 or more.' },

  { id: 'layup', group: 'finishes', name: 'Layup', keys: ['shoot'], how: 'Tap Shoot close to the rim', cam: 'rim',
    d: 'Up and in off the glass. This is what Shoot does when you are close to the basket without the speed or the rating to dunk.' },
  { id: 'euro', group: 'finishes', name: 'Euro step', keys: ['sprint', 'shoot'], how: 'Drive at a defender, then tap Shoot', cam: 'rim',
    d: 'A defender in your way as you attack the rim: you step around them in the air before you finish.' },
  { id: 'reverse', group: 'finishes', name: 'Reverse layup', keys: ['sprint', 'shoot'], how: 'Cut in from the side, then tap Shoot', cam: 'rim',
    d: 'Attacking from the side of the rim, you go under the basket and finish on the far side, back turned to the hoop.' },
  { id: 'floater', group: 'finishes', name: 'Floater', keys: ['sprint', 'shoot'], how: 'Drive at a tall defender, then tap Shoot', cam: 'shot',
    d: 'A big waiting at the rim: a soft, high shot over their arms. A little harder to make, a lot harder to block.' },

  { id: 'jumper', group: 'shots', name: 'Jump shot', keys: ['shoot'], how: 'Hold Shoot, let go in the green', cam: 'shot',
    d: 'A meter fills while you hold the button. Let go at the top of the green zone for a perfect release.' },
  { id: 'pullup', group: 'shots', name: 'Pull-up jumper', keys: ['sprint', 'shoot'], how: 'Sprint, then hold Shoot', cam: 'shot',
    d: 'Stop on a dime and rise up while you are moving fast. A touch less accurate than a set shot.' },
  { id: 'stepback', group: 'shots', name: 'Step-back', keys: ['move', 'shoot'], how: 'Tap Move to step back, then hold Shoot', cam: 'shot',
    d: 'Hop back to make room, then shoot within a second and a half for a bonus to your accuracy.' },
  { id: 'fadeaway', group: 'shots', name: 'Fadeaway', keys: ['shoot'], how: 'Hold Shoot with a defender in your face', cam: 'shot',
    d: 'Lean away from tight defense. It is hard to block, and it holds up when the defender is right on you.' },
  { id: 'ft', group: 'shots', name: 'Free throw', keys: ['shoot'], how: 'Hold Shoot, let go in the green', cam: 'shot',
    d: 'The same meter as a jump shot, but nobody can touch you. Wait for the green zone.' },

  { id: 'crossover', group: 'handles', name: 'Crossover', keys: ['move'], how: 'Tap Move while you dribble', cam: 'close',
    d: 'The ball switches hands and you explode the other way. A good ball handler leaves the defender stumbling.' },
  { id: 'behind', group: 'handles', name: 'Behind the back', keys: ['move'], how: 'Tap Move while you dribble', cam: 'close',
    d: 'The ball goes around your back to the other hand. The game picks between this and the crossover.' },
  { id: 'hesi', group: 'handles', name: 'Hesitation', keys: ['move'], how: 'Tap Move when you are moving slowly', cam: 'close',
    d: 'Freeze for a beat, then burst past. Defenders bite on it and stumble.' },
  { id: 'spin', group: 'handles', name: 'Spin move', keys: ['move'], how: 'Tap Move while you drive at a defender', cam: 'close',
    d: 'A full turn around the defender. The ball cannot be stolen while you are spinning.' },

  { id: 'chest', group: 'passes', name: 'Chest pass', keys: ['pass'], how: 'Tap Pass, aim the stick at a teammate', cam: 'mid',
    d: 'Quick and straight. This is the normal pass.' },
  { id: 'bounce', group: 'passes', name: 'Bounce pass', keys: ['pass'], how: 'Tap Pass with a defender in the lane', cam: 'mid',
    d: 'The game picks a bounce pass when a defender is standing in the passing lane, so the ball goes underneath.' },
  { id: 'lob', group: 'passes', name: 'Lob', keys: ['pass'], how: 'Tap Pass to a teammate near the rim', cam: 'wide',
    d: 'High and soft for an alley-oop: the receiver goes up to meet it and finishes in the air.' },

  { id: 'slide', group: 'defense', name: 'Defensive slide', keys: [], how: 'Hold the stick sideways', cam: 'mid',
    d: 'Stay low with a wide base and shuffle your feet to stay in front of the ball handler.' },
  { id: 'steal', group: 'defense', name: 'Steal', keys: ['pass'], how: 'Tap Pass near the ball handler', cam: 'close',
    d: 'A poke or a swipe at the ball. Close and good hands win it, but a reach-in can be a foul.' },
  { id: 'block', group: 'defense', name: 'Block', keys: ['shoot'], how: 'Tap Shoot as the shot goes up', cam: 'mid',
    d: 'Jump at the shooter and time it as they rise. A good block sends the ball flying.' },

  { id: 'post', group: 'big', name: 'Post-up', keys: ['move'], how: 'Stand still near the rim with the ball', cam: 'rim',
    d: 'A big player near the basket with a defender on their back can back them down, then turn and finish.' },
  { id: 'pump', group: 'big', name: 'Pump fake', keys: ['shoot', 'pass'], how: 'Hold Shoot, then tap Pass', cam: 'mid',
    d: 'Fake the shot. A defender who bites jumps and is out of the play, so drive past them.' },
];

// ---------- The scripts: each one is a little story told with the same moves the game makes ----------
// S is the lab. `yield S.wait(sec)` pauses, `yield S.until(fn)` waits for something to be true.
const RIM_POINT = V(0, RIM_Y, 0);
function* walkOut(S, p) {          // after a finish at the rim: walk back out instead of standing in the ball's way
  S.run(p, -1, 0.55, false, 0.42);
  yield S.wait(1.2);
  S.halt(p);
  yield S.wait(0.3);
}
const SCRIPTS = {
  // Sprint at the rim and go up for a dunk, with a defender in the way if `gap` says where they stand
  *dunk(S, style, defender) {
    const p = S.hero, q = S.foe;
    if (defender) { S.place(q, defender[0], defender[1], -Math.PI / 2); q.defending = true; S.face(q, p.pos); }
    S.place(p, -6.6, 0); S.dribble(p); S.run(p, 1, 0, true);
    yield S.until(() => p.pos.x > -2.7);
    S.startFinish(p, 'dunk', style);
    if (defender) q.jump(0.62, 0.5);
    yield S.until(() => !p.airborne);
    yield* walkOut(S, p);
  },
  *twohand(S) { yield* SCRIPTS.dunk(S, 'twohand', [-1.3, -0.95]); },
  *onehand(S) { yield* SCRIPTS.dunk(S, 'onehand', [-2.5, -1.9]); },
  *windmill(S) { yield* SCRIPTS.dunk(S, 'windmill'); },
  *tomahawk(S) { yield* SCRIPTS.dunk(S, 'tomahawk'); },
  *alleydunk(S) {
    const p = S.hero, m = S.mate;
    S.place(m, -6.8, -2.6, Math.PI / 2 - 0.3); S.place(p, -3.7, 1.6);
    S.dribble(m);
    yield S.wait(0.7);
    S.pass(m, p, 'lob', V(-0.85, 3.3, 0.05), 0.72);
    S.run(p, 1, -0.45, false, 0.62);
    yield S.until(() => S.passDone);
    yield S.until(() => !p.airborne);
    yield* walkOut(S, p);
  },
  *layup(S) {
    const p = S.hero;
    S.place(p, -6.2, 0.3); S.dribble(p); S.run(p, 1, -0.05, true);
    yield S.until(() => p.pos.x > -2.35);
    S.startFinish(p, 'layup', 'layup');
    yield S.until(() => !p.airborne);
    yield* walkOut(S, p);
  },
  *euro(S) {
    const p = S.hero, q = S.foe;
    S.place(q, -2.7, -0.15, -Math.PI / 2); q.defending = true; S.face(q, p.pos);
    S.place(p, -6.4, -0.2); S.dribble(p); S.run(p, 1, 0, true);
    yield S.until(() => p.pos.x > -3.9);
    p.euroDir = V(0, 0, 1);
    S.startFinish(p, 'layup', 'euro');
    yield S.until(() => !p.airborne);
    yield* walkOut(S, p);
  },
  *reverse(S) {
    const p = S.hero;
    S.place(p, -5.6, -3.4, Math.PI / 2 + 0.5); S.dribble(p); S.run(p, 1, 0.4, true);
    yield S.until(() => p.pos.x > -2.0);
    S.startFinish(p, 'layup', 'reverse');
    yield S.until(() => !p.airborne);
    yield* walkOut(S, p);
  },
  *floater(S) {
    const p = S.hero, q = S.foe;
    S.place(q, -0.9, 0.1, -Math.PI / 2); q.defending = true; S.face(q, p.pos);
    S.place(p, -7.2, 0.1); S.dribble(p); S.run(p, 1, 0, false, 0.85);
    yield S.until(() => p.pos.x > -4.1);
    S.startFinish(p, 'layup', 'floater', 0.7, 0.6);
    S.halt(p);
    yield S.wait(0.15);
    q.jump(0.62, 0.5);
    yield S.until(() => !p.airborne);
    yield* walkOut(S, p);
  },
  *jumper(S) {
    const p = S.hero;
    S.place(p, -6.0, 0); S.dribble(p);
    yield S.wait(1.1);
    S.startShot(p, 'jumper');
    yield S.until(() => p.released && !p.airborne);
    yield S.wait(1.6);
  },
  *pullup(S) {
    const p = S.hero;
    S.place(p, -9.4, 0.9, Math.PI / 2 + 0.1); S.dribble(p); S.run(p, 1, -0.18, true);
    yield S.until(() => p.pos.x > -6.3);
    S.startShot(p, 'pullup');
    yield S.until(() => p.released && !p.airborne);
    S.halt(p);
    yield S.wait(1.6);
  },
  *stepback(S) {
    const p = S.hero, q = S.foe;
    S.place(q, -5.3, 0, -Math.PI / 2); q.defending = true;
    S.place(p, -7.2, 0); S.dribble(p); S.face(p, q.pos); S.face(q, p.pos);
    yield S.wait(0.9);
    S.dribbleMove(p, 'stepback');
    yield S.until(() => !p.airborne);
    S.startShot(p, 'stepback');
    yield S.until(() => p.released && !p.airborne);
    yield S.wait(1.6);
  },
  *fadeaway(S) {
    const p = S.hero, q = S.foe;
    S.place(p, -4.9, 0.2); S.place(q, -3.95, 0.2, -Math.PI / 2); q.defending = true; S.face(q, p.pos);
    S.dribble(p);
    yield S.wait(0.9);
    S.startShot(p, 'fadeaway');
    yield S.until(() => p.actionT > 0.3);
    q.jump(0.7, 0.55);
    yield S.until(() => p.released && !p.airborne);
    yield S.wait(1.6);
  },
  *ft(S) {
    const p = S.hero;
    S.place(p, -4.45, 0); S.dribble(p);
    yield S.wait(1.3);
    p.state = 'ft'; p.actionT = 0; p.released = false; p.faceTarget = RIM_POINT; S.hands(p, 'both');
    yield S.until(() => p.released);
    yield S.wait(2.1);
  },
  // The four dribble moves: walk at a defender, make the move, go past
  *handle(S, name) {
    const p = S.hero, q = S.foe;
    for (let i = 0; i < 2; i++) {
      const side = i ? -1 : 1;
      S.place(q, -3.2, 0, -Math.PI / 2); q.defending = true; S.face(q, p.pos);
      S.place(p, -6.4, -0.3 * side); S.dribble(p); p.desired.set(0.45, 0, 0.06 * side);
      yield S.until(() => p.pos.x > -4.9);
      S.dribbleMove(p, name);
      p.desired.set(name === 'hesi' ? 1 : 0.9, 0, 0.7 * side);
      yield S.wait(0.35);
      q.stumbleT = 1.0;
      yield S.wait(0.9);
      p.desired.set(0.3, 0, 0);
      yield S.wait(0.5);
    }
  },
  *crossover(S) { yield* SCRIPTS.handle(S, 'crossover'); },
  *behind(S) { yield* SCRIPTS.handle(S, 'behind'); },
  *hesi(S) { yield* SCRIPTS.handle(S, 'hesi'); },
  *spin(S) { yield* SCRIPTS.handle(S, 'spin'); },
  *chest(S) {
    const p = S.hero, m = S.mate;
    S.place(m, -2.4, 0, -Math.PI / 2); S.place(p, -5.4, 0); S.dribble(p);
    S.face(p, m.pos); S.face(m, p.pos);
    yield S.wait(1.0);
    S.pass(p, m, 'chest');
    yield S.until(() => S.passDone);
    yield S.wait(1.4);
  },
  *bounce(S) {
    const p = S.hero, m = S.mate, q = S.foe;
    S.place(m, -2.4, 0, -Math.PI / 2); S.place(p, -5.6, 0); S.place(q, -3.9, 0.15, -Math.PI / 2); q.defending = true;
    S.dribble(p); S.face(p, m.pos); S.face(m, p.pos); S.face(q, p.pos);
    yield S.wait(1.0);
    S.pass(p, m, 'bounce');
    yield S.until(() => S.passDone);
    yield S.wait(1.4);
  },
  *lob(S) {
    const p = S.hero, m = S.mate;
    S.place(p, -6.8, -2.6, Math.PI / 2 - 0.3); S.place(m, -3.7, 1.6);
    S.dribble(p);
    yield S.wait(0.9);
    S.pass(p, m, 'lob', V(-0.85, 3.3, 0.05), 0.72);
    S.run(m, 1, -0.45, false, 0.62);
    yield S.until(() => S.passDone);
    yield S.until(() => !m.airborne);
    yield* walkOut(S, m);
  },
  *slide(S) {
    const p = S.hero, q = S.foe;
    S.place(q, -4.3, -2.2); S.dribble(q); S.face(q, RIM_POINT);
    S.place(p, -3.2, -2.2, -Math.PI / 2); p.defending = true; S.face(p, q.pos);
    S.hook(() => { p.desired.set(0, 0, clamp((q.pos.z - p.pos.z) * 2.5, -0.58, 0.58)); });
    for (let k = 0; k < 3; k++) {
      const goal = k % 2 ? -2.2 : 2.2;
      q.desired.set(0.02, 0, goal > q.pos.z ? 0.55 : -0.55);
      yield S.until(() => (goal > 0 ? q.pos.z > goal : q.pos.z < goal));
    }
    q.desired.set(0, 0, 0);
    yield S.wait(0.7);
  },
  *steal(S) {
    const p = S.hero, q = S.foe;
    for (let k = 0; k < 2; k++) {
      S.place(q, -4.7, 0); S.dribble(q);
      S.place(p, -3.4, 0.1, -Math.PI / 2); p.defending = true; S.face(p, q.pos);
      yield S.wait(0.9);
      S.attemptSteal(p, q, k ? 'swipe' : 'poke');
      yield S.until(() => p.state !== 'steal');
      yield S.wait(1.3);
    }
  },
  *block(S) {
    const p = S.hero, q = S.foe;
    S.place(q, -4.4, 0.3); S.dribble(q);
    S.place(p, -3.3, 0.3, -Math.PI / 2); p.defending = true; S.face(p, q.pos);
    yield S.wait(0.9);
    S.startShot(q, 'jumper', 0.52);
    yield S.until(() => q.actionT > 0.2);
    p.jump(0.78, 0.72);
    yield S.until(() => q.actionT > 0.42);
    S.swat(q);
    yield S.until(() => !p.airborne);
    yield S.wait(1.3);
  },
  *post(S) {
    const p = S.hero, q = S.foe;
    S.place(p, -2.6, 0.8); S.dribble(p);
    S.place(q, -1.8, 0.8, -Math.PI / 2); q.defending = true; S.face(q, p.pos);
    yield S.wait(0.5);
    p.postT = 1.4;
    p.desired.set(0.1, 0, 0);
    yield S.wait(1.4);
    p.desired.set(0, 0, 0);
    q.pos.x = Math.min(q.pos.x, -1.0);
    S.startFinish(p, 'layup', 'layup');
    yield S.until(() => !p.airborne);
    yield* walkOut(S, p);
  },
  *pump(S) {
    const p = S.hero, q = S.foe;
    S.place(q, -3.9, 0, -Math.PI / 2); q.defending = true; S.face(q, p.pos);
    S.place(p, -5.1, 0); S.dribble(p);
    yield S.wait(1.0);
    S.startShot(p, 'jumper');
    yield S.until(() => p.actionT > 0.22);
    // the shot is cancelled and the defender bites
    p.state = 'idle'; p.actionT = 0; p.faceTarget = null; p.pumpT = 0.45; S.dribble(p);
    q.jump(0.62, 0.55); q.stumbleT = 0.5;
    p.burstT = 0.9;
    yield S.wait(0.35);
    p.desired.set(1, 0, 0.55);
    yield S.wait(0.8);
    p.desired.set(0, 0, 0);
    yield S.wait(0.9);
  },
};

const RUN = {};
for (const m of MOVES) RUN[m.id] = (S) => SCRIPTS[m.id](S);

// ---------- The scene ----------
function courtTexture(accent) {
  const PX = 76, X0 = -10, X1 = 3.4, Z0 = -6, Z1 = 6;
  const W = Math.round((X1 - X0) * PX), H = Math.round((Z1 - Z0) * PX);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const px = (x) => (x - X0) * PX, pz = (z) => (z - Z0) * PX;
  g.fillStyle = '#c99357'; g.fillRect(0, 0, W, H);
  for (let i = 0; i * 0.14 < Z1 - Z0; i++) { g.fillStyle = i % 2 ? 'rgba(110,60,15,0.07)' : 'rgba(255,225,170,0.06)'; g.fillRect(0, i * 0.14 * PX, W, 0.14 * PX); }
  // the apron behind the baseline
  g.fillStyle = 'rgba(30,20,10,0.35)'; g.fillRect(px(1.6), 0, W - px(1.6), H);
  // the paint
  g.fillStyle = accent || '#2d7d86'; g.globalAlpha = 0.85;
  g.fillRect(px(-4.19), pz(-2.44), (1.6 + 4.19) * PX, 4.88 * PX);
  g.beginPath(); g.arc(px(-4.19), pz(0), 1.83 * PX, Math.PI / 2, Math.PI * 1.5, true); g.closePath(); g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineJoin = 'round';
  g.strokeRect(px(-4.19), pz(-2.44), (1.6 + 4.19) * PX, 4.88 * PX);       // the lane
  g.beginPath(); g.arc(px(-4.19), pz(0), 1.83 * PX, Math.PI / 2, Math.PI * 1.5); g.stroke();   // the free-throw circle
  g.setLineDash([10, 9]); g.beginPath(); g.arc(px(-4.19), pz(0), 1.83 * PX, -Math.PI / 2, Math.PI / 2); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.arc(px(0), pz(0), 1.25 * PX, Math.PI / 2, Math.PI * 1.5); g.stroke();     // the restricted area
  g.beginPath(); g.moveTo(px(0), pz(-1.25)); g.lineTo(px(0.375), pz(-1.25)); g.moveTo(px(0), pz(1.25)); g.lineTo(px(0.375), pz(1.25)); g.stroke();
  g.beginPath(); g.arc(px(0), pz(0), 7.24 * PX, Math.PI / 2 + 0.0, Math.PI * 1.5); g.stroke();   // the three-point line
  g.beginPath(); g.moveTo(px(1.6), 0); g.lineTo(px(1.6), H); g.stroke();                    // the baseline
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, W: X1 - X0, H: Z1 - Z0, cx: (X0 + X1) / 2 };
}

function buildHoop(scene) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.4, emissive: 0x401400 });
  const bx = 0.375;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.07, 1.83), glass); board.position.set(bx, 3.45, 0); g.add(board);
  for (const [w, h, d, dz, dy] of [[0.05, 0.05, 1.86, 0, 0.535], [0.05, 0.05, 1.86, 0, -0.535], [0.05, 1.12, 0.05, 0.915, 0], [0.05, 1.12, 0.05, -0.915, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), white); m.position.set(bx, 3.45 + dy, dz); g.add(m);
  }
  const sq = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.59, 0.45)), new THREE.LineBasicMaterial({ color: 0xffffff }));
  sq.rotation.y = Math.PI / 2; sq.position.set(bx - 0.03, 3.3, 0); g.add(sq);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(C.RIM_R, 0.013, 10, 40), rimMat); rim.rotation.x = Math.PI / 2; rim.position.set(0, RIM_Y, 0); g.add(rim);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.1), rimMat); bracket.position.set(bx - 0.08, RIM_Y, 0); g.add(bracket);
  // the stanchion behind the baseline
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.3, 0.28), dark); pole.position.set(2.05, 1.65, 0); g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.16), dark); arm.position.set(1.2, 3.5, 0); g.add(arm);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.5), dark); base.position.set(2.05, 0.4, 0); g.add(base);
  // the net
  const pts = [], N = 12, rings = 5, ring = (k) => ({ r: C.RIM_R - k * 0.022, y: -k * 0.105 });
  for (let i = 0; i < N; i++) for (let k = 0; k < rings - 1; k++) {
    const a0 = (i + (k % 2) * 0.5) / N * Math.PI * 2, a1 = (i + ((k + 1) % 2) * 0.5) / N * Math.PI * 2, a2 = (i + 1 + (k % 2) * 0.5) / N * Math.PI * 2;
    const r0 = ring(k), r1 = ring(k + 1);
    pts.push(Math.cos(a0) * r0.r, r0.y, Math.sin(a0) * r0.r, Math.cos(a1) * r1.r, r1.y, Math.sin(a1) * r1.r);
    pts.push(Math.cos(a2) * r0.r, r0.y, Math.sin(a2) * r0.r, Math.cos(a1) * r1.r, r1.y, Math.sin(a1) * r1.r);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.9 }));
  net.position.set(0, RIM_Y, 0); g.add(net);
  scene.add(g);
  return { group: g, net };
}

const PLAYER_DATA = (o) => ({ skin: '#c68642', hair: '#111111', hairStyle: 1, bench: false, ratings: { three: 85, mid: 85, inside: 85, dunk: 90, pass: 85, handle: 90, speed: 88, def: 85, steal: 85, block: 85, reb: 80 }, ...o });
const kitOf = (t, away) => ({ jerseyColor: t.primary, trimColor: t.accent || t.secondary, human: false, isUser: !away, isHome: !away, tac: {}, skill: 0, dir: 1, data: t });

export class MoveLab {
  constructor(canvas, { team, rival, sfx } = {}) {
    this.canvas = canvas;
    this.sfx = sfx || {};
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 1.05;
    const scene = this.scene = new THREE.Scene();
    { // a soft dark-blue gradient behind everything
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
      const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#26335a'); gr.addColorStop(0.55, '#141b33'); gr.addColorStop(1, '#0b0f1e');
      g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      scene.background = t;
    }
    this.camera = new THREE.PerspectiveCamera(36, 1.65, 0.1, 90);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2a1a, 0.75));
    const key = new THREE.DirectionalLight(0xfff4e5, 1.45); key.position.set(3, 9, 7); scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45); fill.position.set(-6, 5, -4); scene.add(fill);

    // the floor
    const ct = courtTexture(team && team.primary);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ct.W, ct.H), new THREE.MeshStandardMaterial({ map: ct.tex, roughness: 0.5, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(ct.cx, 0, 0); scene.add(floor);
    const out = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 1 }));
    out.rotation.x = -Math.PI / 2; out.position.set(0, -0.02, 0); scene.add(out);
    const hoop = buildHoop(scene); this.net = hoop.net; this.netA = 0;

    // the people and the ball
    const t1 = team || { id: 'YOU', city: 'Your', name: 'Team', primary: '#35f0ff', secondary: '#ffffff', accent: '#ffd60a', logo: { symbol: '' } };
    const t2 = rival || { id: 'RIV', city: 'Rival', name: 'Team', primary: '#7a3cff', secondary: '#ffffff', accent: '#ffffff', logo: { symbol: '' } };
    const mkP = (data, kit, i) => { const p = new Player(PLAYER_DATA(data), kit, i, scene); applyCustomPlayer(p); p.root.visible = false; p.hasBall = false; p.defending = false; return p; };
    this.hero = mkP({ first: 'You', last: 'Player', pos: 'SG', number: 23, height: 1.98 }, kitOf(t1, false), 1);
    this.mate = mkP({ first: 'Team', last: 'Mate', pos: 'C', number: 11, height: 2.08, skin: '#8d5524', hair: '#1a1a1a', hairStyle: 2 }, kitOf(t1, false), 2);
    this.foe = mkP({ first: 'Rival', last: 'Defender', pos: 'PF', number: 5, height: 2.04, skin: '#e0ac69', hair: '#3a2a1a', hairStyle: 0 }, kitOf(t2, true), 3);
    this.actors = [this.hero, this.mate, this.foe];
    const ballObj = makeCustomBall(R) || new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshStandardMaterial({ color: 0xee7a24, roughness: 0.65 }));
    this.ballMesh = ballObj; scene.add(ballObj);
    this.ball = { mode: 'hidden', holder: null, pos: V(0, 5, 0), vel: V(0, 0, 0), t: 0 };

    this.camPos = V(...CAMS.wide[0]); this.camLook = V(...CAMS.wide[1]);
    this.camGoal = { pos: V(...CAMS.wide[0]), look: V(...CAMS.wide[1]) };
    this.speed = 1; this.slowT = 0; this.time = 0; this.gen = null; this.waiting = null; this.restartIn = null; this.move = null; this.passDone = false; this.shake = 0;
    this.last = 0; this.raf = 0; this.running = false; this.disposed = false; this.hooks = [];
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    if (this.ro) this.ro.observe(canvas);
    this.resize();
  }

  // ----- public -----
  play(id) {
    const move = MOVES.find((m) => m.id === id) || MOVES[0];
    this.move = move;
    this.begin();
  }
  setSpeed(s) { this.speed = s; }
  start() { if (this.running || this.disposed) return; this.running = true; this.last = performance.now(); const loop = (now) => { if (!this.running) return; this.raf = requestAnimationFrame(loop); this.frame(now); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  dispose() {
    this.stop(); this.disposed = true;
    if (this.ro) this.ro.disconnect();
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* already gone */ }
  }
  step(dt) { this.advance(dt); this.render(); }

  // ----- the frame loop -----
  frame(now) {
    const real = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.advance(real);
    this.render();
  }
  advance(real) {
    let dt = real * this.speed;
    if (this.slowT > 0) { this.slowT -= real; dt *= 0.4; }
    // small fixed steps, like the game's frame time
    while (dt > 1e-6) { const h = Math.min(dt, 1 / 60); this.tick(h); dt -= h; }
  }
  resize() {
    const w = Math.max(2, this.canvas.clientWidth), h = Math.max(2, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole run-up in view on narrow screens
    this.camera.fov = w / h < 1.3 ? 44 : 36;
    this.camera.updateProjectionMatrix();
  }
  render() {
    const cam = this.camera;
    const k = this.shake > 0 ? this.shake * 0.06 : 0;
    cam.position.copy(this.camPos);
    if (k) cam.position.add(_a.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0));
    cam.lookAt(this.camLook);
    this.renderer.render(this.scene, cam);
  }

  // ----- the story: what happens each tick -----
  begin() {
    for (const p of this.actors) { p.root.visible = false; this.place(p, 0, 0); p.root.visible = false; }
    this.hideBall(); this.netA = 0; this.passDone = false; this.slowT = 0; this.shake = 0;
    this.setCam(this.move.cam || 'wide', true);
    this.gen = RUN[this.move.id](this);
    this.waiting = null; this.restartIn = null; this.hooks = [];
  }
  tick(dt) {
    this.time += dt;
    if (this.gen) {
      const w = this.waiting;
      let go = true;
      if (w) { if (w.wait != null) { w.wait -= dt; go = w.wait <= 0; } else if (w.until) go = !!w.until(); }
      if (go) { const r = this.gen.next(); if (r.done) { this.gen = null; this.restartIn = 0.4; } else this.waiting = r.value; }
    } else if (this.restartIn != null) {
      this.restartIn -= dt;
      if (this.restartIn <= 0 && this.move) this.begin();
    }
    for (const h of this.hooks) h();
    for (const p of this.actors) if (p.root.visible) this.stepActor(p, dt);
    this.stepBall(dt);
    if (this.netA > 0) {
      this.netA = Math.max(0, this.netA - dt * 1.8);
      const a = this.netA;
      this.net.scale.set(1 - a * 0.25, 1 + Math.sin(a * 14) * 0.25 * a, 1 - a * 0.25);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const k = 1 - Math.exp(-3.2 * dt);
    this.camPos.lerp(this.camGoal.pos, k); this.camLook.lerp(this.camGoal.look, k);
  }

  // The same rules the game's update loop applies to a player in an action
  stepActor(p, dt) {
    p.update(dt);
    if (p.state !== 'idle') p.actionT += dt;
    const st = p.state;
    if (st === 'layup' || st === 'dunk') {
      const d = Math.hypot(p.pos.x, p.pos.z);
      if (p.shotStyle === 'floater') p.desired.set(0, 0, 0);
      else if (d > 0.6) p.desired.set(-0.55 - p.pos.x, 0, -p.pos.z).normalize();
      else p.desired.set(0, 0, 0);
      if (p.shotStyle === 'euro' && p.euroDir && p.actionT < 0.24) { p.pos.x += p.euroDir.x * 3.6 * dt; p.pos.z += p.euroDir.z * 3.6 * dt; }
      if (!p.released && p.actionT > (st === 'dunk' ? 0.38 : 0.3)) this.releaseFinish(p);
      if (p.released) { const k = Math.max(0, 1 - 3.5 * dt); p.vel.x *= k; p.vel.z *= k; }   // settle under the rim instead of sliding into the stanchion
      if (p.pos.x > 0.3) { p.pos.x = 0.3; p.vel.x = Math.min(0, p.vel.x); }
      if (p.released && !p.airborne) { p.state = 'idle'; p.faceTarget = null; }
    } else if (st === 'shoot' || st === 'ft') {
      if (!p.released && p.actionT >= (p.releaseAt || 0.546)) this.releaseShot(p);
      if (p.released && (st === 'ft' ? p.actionT > 0.9 : !p.airborne)) { p.state = 'idle'; p.faceTarget = null; p.releaseAt = 0; }
    } else if (st === 'steal') {
      const h = p.stealTarget;
      if (h && p.actionT > 0.05 && p.actionT < 0.34) { p.desired.set(h.pos.x - p.pos.x, 0, h.pos.z - p.pos.z).normalize(); p.faceTarget = h.pos; }
      if (!p.stealResolved && p.actionT >= 0.22) this.resolveSteal(p);
      if (p.actionT > 0.62) { p.state = 'idle'; p.stealTarget = null; p.faceTarget = null; p.desired.set(0, 0, 0); }
    }
    if (p.postT > 0) { /* the pose handles the turn; Player.update counts the timer down */ }
    const hasBall = this.ball.holder === p;
    p.animate(dt, { hasBall, dribble: hasBall && p.state === 'idle', defending: !!p.defending, released: p.released });
    const sp = Math.hypot(p.vel.x, p.vel.z);
    let anim;
    if (p.state !== 'idle') anim = p.state;
    else if (p.airborne) anim = 'jump';
    else if (sp > 2.6) anim = 'run';
    else if (sp > 0.5) anim = 'walk';
    else anim = hasBall ? 'dribble' : 'idle';
    updateCustomPlayer(p, dt, anim, sp, {
      hasBall, released: p.released, airborne: p.airborne, defending: !!p.defending,
      ballPos: this.ball.pos, ballSide: (p.crossSide || 1) * (p.burstT > 0.25 ? -1 : 1),
      style: p.shotStyle, move: (p.moveT || 0) > 0 ? p.moveName : null,
      spin: (p.spinT || 0) > 0 ? (1 - p.spinT / 0.45) * (p.spinDir || 1) : 0,
      pumpT: p.pumpT || 0, postT: p.postT || 0,
      passT: p.passT || 0, passStyle: p.passStyle, passLocal: p.passLocal, actionT: p.actionT, stealStyle: p.stealStyle,
    });
  }

  // ----- the ball -----
  handOf(p, kind, out) {
    const b = p.bones;
    const one = (right, into) => {
      const lower = b && (right ? b.laR : b.laL), hand = lower && lower.userData && lower.userData.child;
      if (!hand) return p.handWorld(right, into);
      hand.updateWorldMatrix(true, false); lower.updateWorldMatrix(true, false);
      hand.getWorldPosition(into); lower.getWorldPosition(_c);
      _c.sub(into);                                                  // from the wrist back to the elbow
      return into.addScaledVector(_c, -0.12 / Math.max(0.05, _c.length()));   // the ball sits a little past the wrist
    };
    if (kind === 'both') { one(true, _a); one(false, _b); return out.copy(_a).add(_b).multiplyScalar(0.5); }
    return out.copy(one(kind === 'right', _a));
  }
  stepBall(dt) {
    const b = this.ball, m = this.ballMesh;
    m.visible = b.mode !== 'hidden';
    if (b.mode === 'dribble' && b.holder) {
      const p = b.holder, side = (p.crossSide || 1) * (p.burstT > 0.25 ? -1 : 1);
      b.t += dt;
      const u = (b.t / 0.5) % 1, k = Math.pow(Math.abs(Math.cos(Math.PI * u)), 0.9);
      const hand = p.data.height * 0.48, sp = Math.hypot(p.vel.x, p.vel.z);
      const lx = side * 0.32, lz = 0.36 + sp * 0.05, c = Math.cos(p.facing), s = Math.sin(p.facing);
      b.pos.set(p.pos.x + lx * c + lz * s, R + (hand - R) * k, p.pos.z - lx * s + lz * c);
    } else if (b.mode === 'hands' && b.holder) {
      this.handOf(b.holder, b.hands, b.pos);
    } else if (b.mode === 'fly') {
      b.t += dt;
      const u = Math.min(1, b.t / b.dur);
      b.pos.lerpVectors(b.from, b.to, u);
      if (b.bounce) { const f = u < 0.6 ? 1 - u / 0.6 : (u - 0.6) / 0.4; b.pos.y = R + (b.pos.y - R) * Math.pow(f, 0.75); }
      else b.pos.y += Math.sin(u * Math.PI) * b.arc;
      b.spin = 6;
      if (u > 0.5 && b.onHalf) { const f = b.onHalf; b.onHalf = null; f(); }
      if (u >= 1) { const then = b.then; b.then = null; b.mode = 'free'; b.vel.set(0, 0, 0); if (then) then(); }
    } else if (b.mode === 'free') {
      b.vel.y -= 9.8 * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < R) { b.pos.y = R; if (Math.abs(b.vel.y) > 0.9) b.vel.y *= -0.55; else b.vel.y = 0; b.vel.x *= 0.85; b.vel.z *= 0.85; }
    }
    m.position.copy(b.pos);
    if (b.mode === 'fly' || (b.mode === 'free' && b.pos.y > R + 0.02)) m.rotation.x += 6 * dt;
  }
  hideBall() { this.ball.mode = 'hidden'; this.ball.holder = null; }
  hideBallIfNot(p) { if (this.ball.holder !== p) this.hideBall(); }
  dribble(p) { const b = this.ball; b.mode = 'dribble'; b.holder = p; b.t = 0; }
  hands(p, kind = 'both') { const b = this.ball; b.mode = 'hands'; b.holder = p; b.hands = kind; }
  flyBall(from, to, dur, arc, then, bounce = false, onHalf = null) {
    const b = this.ball;
    b.mode = 'fly'; b.holder = null; b.t = 0; b.dur = dur; b.arc = arc; b.bounce = bounce; b.then = then || null; b.onHalf = onHalf;
    b.from = from.clone(); b.to = to.clone(); b.pos.copy(from);
  }
  swish(hard) {
    const b = this.ball;
    this.netA = 1; b.mode = 'free'; b.pos.set(0, RIM_Y - 0.1, 0); b.vel.set(-0.5, hard ? -4 : -2.2, 0.7);
    this.fx(hard ? 'dunk' : 'swish');
    if (hard) this.shake = 0.8;
  }
  fx(name) { try { if (this.sfx && this.sfx[name]) this.sfx[name](); } catch { /* sound is a bonus */ } }

  // ----- helpers for the scripts -----
  hook(fn) { this.hooks.push(fn); }
  wait(sec) { return { wait: sec }; }
  until(fn) { return { until: fn }; }
  place(p, x, z, face = Math.PI / 2) {
    p.pos.set(x, 0, z); p.vel.set(0, 0, 0); p.desired.set(0, 0, 0);
    p.facing = p.targetFacing = face; p.faceTarget = null;
    p.y = 0; p.jumpT = -1; p.state = 'idle'; p.actionT = 0; p.released = false; p.shotStyle = null; p.releaseAt = 0;
    p.moveT = p.spinT = p.hesiT = p.burstT = p.pumpT = p.postT = p.passT = p.stumbleT = p.rhythmT = p.stealImmuneT = 0;
    p.moveName = ''; p.passStyle = null; p.passLocal = null; p.stealStyle = null; p.euroDir = null; p.stealTarget = null; p.crossSide = 1;
    p.sprinting = false; p.defending = false; p.stamina = 1; p.energy = 1;
    p.root.visible = true;
    if (this.ball.holder === p) this.hideBall();
  }
  run(p, dx, dz, sprint = false, mag = 1) { p.desired.set(dx * mag, 0, dz * mag); p.sprinting = sprint; }
  halt(p) { p.desired.set(0, 0, 0); p.sprinting = false; }
  face(p, target) { p.faceTarget = target; }
  setCam(name, snap) {
    const c = CAMS[name] || CAMS.wide;
    this.camGoal.pos.set(...c[0]); this.camGoal.look.set(...c[1]);
    if (snap) { this.camPos.copy(this.camGoal.pos); this.camLook.copy(this.camGoal.look); }
  }

  // The moment startShot makes in the game for a dunk or a layup
  startFinish(p, state, style, dur, peak) {
    p.state = state; p.shotStyle = style; p.actionT = 0; p.released = false; p.faceTarget = RIM_POINT;
    p.jump(dur || (state === 'dunk' ? 0.9 : 0.74), peak || (state === 'dunk' ? 1.12 : 0.78));
    this.hands(p, style === 'twohand' || style === 'alley' ? 'both' : 'right');
    if (state === 'dunk') this.slowT = 0.75;
  }
  releaseFinish(p) {
    p.released = true;
    const from = this.handOf(p, p.shotStyle === 'twohand' || p.shotStyle === 'alley' ? 'both' : 'right', V(0, 0, 0));
    if (p.state === 'dunk') this.flyBall(from, V(0, RIM_Y - 0.1, 0), 0.14, 0, () => this.swish(true));
    else {
      const high = p.shotStyle === 'floater';
      this.flyBall(from, V(high ? 0.0 : 0.16, high ? RIM_Y + 0.02 : RIM_Y + 0.12, 0), high ? 0.85 : 0.5, high ? 1.3 : 0.45, () => this.swish());
    }
  }
  // A jump shot: the same release point the game's meter aims for (METER_TARGET of METER_TIME)
  startShot(p, style, releaseAt) {
    p.state = 'shoot'; p.shotStyle = style; p.actionT = 0; p.released = false; p.faceTarget = RIM_POINT; p.releaseAt = releaseAt || 0.546;
    if (style === 'fadeaway') p.vel.set(-2.6, 0, 0); else p.vel.multiplyScalar(0.3);
    p.jump(0.86, 0.62);
    p.desired.set(0, 0, 0); p.sprinting = false;
    this.hands(p, 'both');
  }
  releaseShot(p) {
    p.released = true;
    const from = this.handOf(p, 'both', V(0, 0, 0)), d = Math.hypot(p.pos.x, p.pos.z);
    this.flyBall(from, RIM_POINT, 0.75 + d * 0.06, Math.max(0.9, 1.5 - d * 0.06), () => this.swish());
    this.fx('pass');
  }
  dribbleMove(p, name) {
    p.moveName = name; p.moveT = 0.5; this.fx('squeak');
    if (name === 'stepback') { p.vel.set(-5.6, 0, 0); p.jump(0.32, 0.16); p.rhythmT = 1.5; return; }
    if (name === 'hesi') { p.hesiT = 0.28; p.burstT = 0.9; return; }
    p.burstT = name === 'spin' ? 0.58 : 0.5;
    p.crossSide = -(p.crossSide || 1);
    if (name === 'spin') { p.spinT = 0.45; p.spinDir = p.crossSide; p.stealImmuneT = 0.65; }
  }
  // A pass: the same pose and flight the game uses. to: the receiver; style: chest, bounce or lob
  pass(from, to, style, aim, dur) {
    this.passDone = false;
    const d = Math.hypot(to.pos.x - from.pos.x, to.pos.z - from.pos.z) || 1;
    const c = Math.cos(from.facing), sn = Math.sin(from.facing);
    const wx = (to.pos.x - from.pos.x) / d, wz = (to.pos.z - from.pos.z) / d;
    from.passT = 0.32; from.passStyle = style === 'lob' ? 'lob' : style;
    from.passLocal = [wx * c - wz * sn, wx * sn + wz * c];
    this.fx('pass');
    const start = this.handOf(from, 'both', V(0, 0, 0));
    const end = aim ? aim.clone() : V(to.pos.x, 1.25, to.pos.z);
    const T = dur || (style === 'lob' ? Math.max(0.55, d / 10) : Math.max(0.25, d / (style === 'bounce' ? 13 : 15)));
    this.hideBall(); this.ball.pos.copy(start);
    this.flyBall(start, end, T, style === 'lob' ? 1.5 : 0.2 + d * 0.03, () => {
      this.passDone = true;
      if (style === 'lob' && Math.hypot(to.pos.x, to.pos.z) < 3.4) {
        // caught in the air and thrown down
        this.hands(to, 'both');
        to.state = 'dunk'; to.shotStyle = 'alley'; to.actionT = 0.26; to.released = false; to.faceTarget = RIM_POINT;
        if (!to.airborne) to.jump(0.6, 0.9);
        this.slowT = 0.7;
      } else this.dribble(to);
    }, style === 'bounce', style === 'lob' ? () => { if (!to.airborne && to.state === 'idle') to.jump(0.8, 1.05); } : null);
  }
  attemptSteal(p, target, style) {
    p.state = 'steal'; p.actionT = 0; p.stealStyle = style; p.stealTarget = target; p.stealResolved = false;
    this.fx('swipe');
  }
  resolveSteal(p) {
    p.stealResolved = true;
    const h = p.stealTarget; if (!h) return;
    const b = this.ball;
    b.mode = 'free'; b.holder = null;
    b.vel.set((p.pos.x - h.pos.x) * 2 - 1.5, 1.6, (p.pos.z - h.pos.z) * 2 + 1.2);
    h.stumbleT = 0.35; this.fx('swipe');
  }
  swat(shooter) {
    const b = this.ball;
    b.mode = 'free'; b.holder = null; b.pos.y = Math.max(b.pos.y, 2.4);
    b.vel.set(-5.2, 3.2, 2.4);
    shooter.state = 'idle'; shooter.actionT = 0; shooter.faceTarget = null; shooter.released = true;
    shooter.stumbleT = 0.3; this.shake = 0.4; this.fx('swipe');
  }
}
