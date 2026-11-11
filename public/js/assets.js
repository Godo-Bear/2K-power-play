// Loads optional custom 3D models and textures listed in /assets/assets.json.
// Everything here is optional: if a file is missing or fails to load, the game
// falls back to its built-in procedural graphics.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildHair, scalpTint } from './hair.js';

const BASE = 'assets/';
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

export const custom = {
  manifest: {},
  ball: null,        // { scene }
  ballTexture: null, // THREE.Texture
  player: null,      // { scene, animations, cfg }
  courtTexture: null,
  courtModel: null,  // { scene, cfg }
  arenaModels: [],   // [{ scene, cfg }]
  credits: [],
  log: [],
};

function note(msg) { custom.log.push(msg); console.info('[assets]', msg); }
const url = (p) => BASE + p.split('/').map(encodeURIComponent).join('/');

async function loadGLTF(path) {
  const g = await gltfLoader.loadAsync(url(path));
  g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

async function loadTex(path, repeat) {
  const t = await texLoader.loadAsync(url(path));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

async function attempt(label, fn) {
  try { await fn(); note(`loaded ${label}`); }
  catch (e) { note(`could not load ${label}: ${e.message || e}`); }
}

export async function loadCustomAssets() {
  let m;
  try {
    const res = await fetch(BASE + 'assets.json', { cache: 'no-cache' });
    if (!res.ok) return custom;
    m = await res.json();
  } catch { return custom; }
  custom.manifest = m;
  custom.credits = Array.isArray(m.credits) ? m.credits : [];
  const jobs = [];
  if (m.ball?.model) jobs.push(attempt('ball model', async () => { custom.ball = { scene: (await loadGLTF(m.ball.model)).scene, cfg: m.ball }; }));
  if (m.ball?.texture) jobs.push(attempt('ball texture', async () => { custom.ballTexture = await loadTex(m.ball.texture); }));
  if (m.player?.model) jobs.push(attempt('player model', async () => {
    const g = await loadGLTF(m.player.model);
    custom.player = { scene: g.scene, animations: g.animations, cfg: m.player };
  }));
  if (m.court?.texture) jobs.push(attempt('court texture', async () => { custom.courtTexture = await loadTex(m.court.texture); }));
  if (m.court?.model) jobs.push(attempt('court model', async () => { custom.courtModel = { scene: (await loadGLTF(m.court.model)).scene, cfg: m.court }; }));
  // `arena` may be a single entry or have a `models` list
  const arenaList = [...(m.arena?.model ? [m.arena] : []), ...((m.arena?.models) || [])];
  arenaList.forEach((cfg, i) => {
    if (!cfg.model) return;
    jobs.push(attempt(`arena model ${i + 1}`, async () => { custom.arenaModels.push({ scene: (await loadGLTF(cfg.model)).scene, cfg }); }));
  });
  await Promise.all(jobs);
  return custom;
}

// Fit a model so its height equals `height` meters and its feet sit at y=0.
function fitToHeight(obj, height) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0) obj.scale.multiplyScalar(height / size.y);
  obj.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box2.min.y;
}

// Which player color a material should take: tint map { materialNameContains: 'jersey'|'trim'|'skin'|'hair'|'shoe' }
function tintColor(player, kind) {
  switch (kind) {
    case 'jersey': return player.team.jerseyColor;
    case 'trim': return player.team.trimColor;
    case 'skin': return player.data.skin;
    case 'hair': return player.data.hairStyle === 0 ? player.data.skin : player.data.hair; // style 0 = bald
    case 'shoe': return player.index % 2 ? '#ffffff' : player.team.data.secondary;
    default: return null;
  }
}

// ---------- Skeleton helpers ----------
function findBones(model) {
  const b = {};
  const want = { upperarml: 'uaL', lowerarml: 'laL', upperarmr: 'uaR', lowerarmr: 'laR', upperlegl: 'ulL', lowerlegl: 'llL', upperlegr: 'ulR', lowerlegr: 'llR', head: 'head', headend: 'headEnd', torso: 'torso' };
  model.traverse((o) => {
    if (!o.isBone) return;
    const key = want[o.name.toLowerCase().replace(/[^a-z]/g, '')];
    if (key && !b[key]) b[key] = o;
  });
  for (const k of Object.keys(b)) {
    const child = b[k].children.find((c) => c.isBone) || b[k].children[0];
    b[k].userData.rest = child ? child.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
  }
  return b;
}

// Colour for the model's own scalp hair, depending on the hair style
function scalpColor(data) {
  const kind = scalpTint(data.hairStyle ?? 2);
  if (kind === 'skin') return data.skin;
  if (kind === 'buzz') return '#' + new THREE.Color(data.skin).lerp(new THREE.Color(data.hair), 0.55).getHexString();
  return data.hair;
}

// Put styled hair on the model's head bone so it follows the head
function attachHair(holder, model, bones, data) {
  if (!bones.head) return;
  holder.updateMatrixWorld(true);
  // The head runs from the head bone (base of the skull) up to the top of the model
  const a = bones.head.getWorldPosition(new THREE.Vector3());
  const top = new THREE.Box3().setFromObject(model).max.y;
  const r = (top - a.y) * 0.56;
  if (!(r > 0.01)) return;
  const hair = buildHair(data.hairStyle ?? 2, data.hair, r);
  if (!hair.children.length) return;
  hair.position.set(a.x, a.y + r * 0.9, a.z);
  hair.rotation.y = model.rotation.y;
  holder.add(hair);
  holder.updateMatrixWorld(true);
  bones.head.attach(hair);
}

function tintModel(model, cfg, fake) {
  const tint = { ...(cfg.tint || {}) };
  if (cfg.jerseyMaterial && !Object.keys(tint).length) tint[cfg.jerseyMaterial] = 'jersey';
  const rules = Object.entries(tint).map(([k, v]) => [k.toLowerCase(), v]);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // skinned meshes can be culled wrongly when animated
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((mt) => {
      const c = mt.clone();
      const rule = rules.find(([k]) => (mt.name || '').toLowerCase().includes(k));
      const col = rule && (rule[1] === 'hair' ? scalpColor(fake.data) : tintColor(fake, rule[1]));
      if (col && c.color) c.color.set(col);
      return c;
    });
    o.material = mats.length === 1 ? mats[0] : mats;
  });
}

// Replace a procedural player's look with the custom model (keeps the hidden rig for gameplay).
export function applyCustomPlayer(player) {
  const cp = custom.player;
  if (!cp) return;
  const cfg = cp.cfg;
  const model = SkeletonUtils.clone(cp.scene);
  const holder = new THREE.Group();
  holder.rotation.order = 'YXZ';
  holder.add(model);
  model.rotation.y = THREE.MathUtils.degToRad(cfg.rotationY || 0);
  fitToHeight(model, player.data.height * (cfg.scale || 1));
  tintModel(model, cfg, player);
  player.bones = findBones(model);
  attachHair(holder, model, player.bones, player.data);
  player.limb = { aL: { w: 0 }, aR: { w: 0 }, lL: { w: 0 }, lR: { w: 0 } };
  player.body.visible = false;
  player.root.add(holder);
  player.customModel = holder;
  if (cp.animations?.length) {
    player.mixer = new THREE.AnimationMixer(model);
    const names = cfg.animations || {};
    player.clips = {};
    for (const [state, clipName] of Object.entries(names)) {
      if (!clipName) continue;
      const clip = THREE.AnimationClip.findByName(cp.animations, clipName);
      if (clip) player.clips[state] = player.mixer.clipAction(clip);
    }
    player.currentClip = null;
    player.mixer.update(Math.random() * 2);
  }
}

// ---------- Procedural poses layered on top of the model's clips ----------
// Directions are in player space: +x = the player's left, +y = up, +z = forward.
const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _e = new THREE.Vector3();
function toWorld(d, facing, out) {
  const c = Math.cos(facing), s = Math.sin(facing);
  return out.set(d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c);
}
function aim(bone, dirWorld, w) {
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_pq).invert();
  _v.copy(dirWorld).applyQuaternion(_pq).normalize();
  _q.setFromUnitVectors(bone.userData.rest, _v);
  bone.quaternion.slerp(_q, w);
}

// Which pose each arm/leg should take. Returns { aL, aR, lL, lR } with [upperDir, lowerDir] or null.
function choosePose(p, state, ctx) {
  const out = { aL: null, aR: null, lL: null, lR: null };
  const mir = (d) => [-d[0], d[1], d[2]];
  const both = (u, f) => { out.aL = [u, f]; out.aR = [mir(u), mir(f)]; };
  const style = ctx.style;
  if (ctx.passT > 0 && ctx.passLocal) {
    // Push the ball toward the target: chest pass, low bounce pass or a high lob
    const [px, pz] = ctx.passLocal;
    const y = ctx.passStyle === 'bounce' ? -0.5 : ctx.passStyle === 'lob' ? 0.65 : -0.05;
    const side = Math.abs(px) > 0.75; // passing across the body: one arm
    const u = [px * 0.8 + 0.18, y - 0.1, pz * 0.8], f = [px, y, pz];
    if (side) { if (px > 0) out.aL = [u, f]; else out.aR = [[px * 0.8 - 0.18, y - 0.1, pz * 0.8], f]; }
    else { out.aL = [u, f]; out.aR = [[px * 0.8 - 0.18, y - 0.1, pz * 0.8], f]; }
  } else if (state === 'shoot' || state === 'ft') {
    if (!ctx.released) both([0.2, 0.5, 0.82], [-0.14, 0.97, 0.12]);          // ball set above the forehead
    else { out.aR = [[-0.14, 0.86, 0.5], [-0.04, 0.72, 0.7]]; out.aL = [[0.3, 0.35, 0.75], [0.1, 0.85, 0.35]]; } // follow-through
    if (style === 'fadeaway') out.lR = [[-0.05, -0.7, 0.72], [0, -0.9, -0.42]]; // lead knee up as he leans away
  } else if (state === 'layup') {
    if (style === 'floater') {
      out.aR = [[-0.05, 0.98, 0.2], [0, 0.9, 0.42]];                           // one-hand push shot
      out.aL = [[0.3, -0.5, 0.3], [0.1, 0.1, 0.8]];
    } else if (style === 'reverse') {
      out.aL = [[0.15, 0.9, -0.3], [0.05, 0.85, -0.5]];                        // finish on the far side, arm reaching back
      out.aR = [[-0.4, -0.3, 0.4], [-0.1, 0.3, 0.7]];
      out.lL = [[0.05, -0.5, 0.86], [0, -0.95, -0.3]];
    } else {
      out.aR = [[-0.1, 0.96, 0.3], [0, 0.95, 0.32]];
      out.aL = [[0.35, -0.2, 0.6], [0.1, 0.3, 0.75]];
      out.lR = [[-0.05, -0.45, 0.9], [0, -0.95, -0.3]];                        // knee drive
    }
  } else if (state === 'dunk') {
    const wind = !ctx.released;
    if (style === 'twohand' || style === 'alley') {
      if (wind) both([0.16, 0.95, style === 'alley' ? 0.25 : -0.12], [0.05, 0.85, style === 'alley' ? 0.3 : -0.5]);
      else both([0.14, 0.5, 0.86], [0.02, -0.3, 0.95]);
    } else if (style === 'windmill') {
      // The arm sweeps a full circle before the slam
      const a = Math.min(1, (ctx.actionT || 0) / 0.38) * Math.PI * 2 - Math.PI * 0.5;
      out.aR = wind ? [[-0.25, Math.sin(a), Math.cos(a)], [-0.2, Math.sin(a + 0.5), Math.cos(a + 0.5)]] : [[-0.1, 0.5, 0.88], [0, -0.3, 0.95]];
      out.aL = [[0.8, 0.2, 0.2], [0.55, 0.5, 0.35]];
    } else {
      const deep = style === 'tomahawk';
      out.aR = wind ? [[-0.15, deep ? 0.8 : 0.95, deep ? -0.5 : -0.12], [-0.05, deep ? 0.25 : 0.75, deep ? -0.95 : -0.6]] : [[-0.1, 0.5, 0.88], [0, -0.3, 0.95]];
      out.aL = [[0.75, 0.25, 0.3], [0.5, 0.55, 0.4]];
    }
    out.lL = [[0.1, -0.72, 0.68], [0, -0.75, -0.66]];
    out.lR = [[-0.1, -0.6, 0.8], [0, -0.8, -0.6]];
  } else if (state === 'steal') {
    if (ctx.stealStyle === 'swipe') {
      const a = Math.min(1, (ctx.actionT || 0) / 0.3) * 1.8 - 0.9;              // arm sweeps across
      out.aR = [[-Math.cos(a) * 0.6, -0.3, 0.75], [Math.sin(a), -0.2, 0.9]];
    } else out.aR = [[-0.2, -0.25, 0.95], [0, -0.12, 1]];
  } else if (ctx.airborne && ctx.move !== 'stepback') {
    both([0.25, 0.95, 0.2], [0.05, 1, 0.15]);                                  // hands up to contest / rebound
  } else if (ctx.hasBall) {
    const s = ctx.ballSide >= 0 ? 1 : -1;
    const arm = [[s * 0.3, -0.75, ctx.move === 'behind' ? -0.1 : 0.35], 'ball']; // dribbling hand follows the ball
    let off = [[-s * 0.5, -0.55, 0.4], [-s * 0.15, 0.05, 0.95]];               // off arm shields
    if (ctx.move === 'spin') off = [[-s * 0.3, -0.7, 0.3], [-s * 0.3, 0.3, 0.5]]; // tucked in while spinning
    if (ctx.move === 'hesi') off = [[-s * 0.6, -0.2, 0.5], [-s * 0.3, 0.6, 0.6]];  // "hold up" hand
    if (s > 0) { out.aL = arm; out.aR = off; } else { out.aR = arm; out.aL = off; }
  } else if (ctx.defending && ctx.speed < 5) {
    both([0.82, -0.3, 0.35], [0.55, 0.42, 0.6]);                               // wide defensive stance
  }
  return out;
}

function applyLimb(p, key, upper, lower, pose, dt, ctx) {
  const L = p.limb[key];
  if (pose) L.pose = pose;
  L.w += ((pose ? 1 : 0) - L.w) * Math.min(1, dt * 13);
  if (L.w < 0.02 || !L.pose || !upper || !lower) return;
  aim(upper, toWorld(L.pose[0], p.facing, _e), L.w);
  if (L.pose[1] === 'ball' && ctx.ballPos) {
    // Point the forearm at the ball (never lower than the knees, so the arm doesn't hyper-extend)
    lower.parent.updateWorldMatrix(true, false);
    lower.getWorldPosition(_e);
    _e.set(ctx.ballPos.x - _e.x, Math.max(ctx.ballPos.y, p.data.height * 0.34 + p.y) - _e.y, ctx.ballPos.z - _e.z).normalize();
    aim(lower, _e, L.w);
  } else if (L.pose[1] !== 'ball') aim(lower, toWorld(L.pose[1], p.facing, _e), L.w);
}

const LOOPING = new Set(['idle', 'walk', 'run', 'celebrate']);
const FALLBACK = { walk: ['run', 'idle'], run: ['walk', 'idle'], celebrate: ['idle'] };

export function updateCustomPlayer(player, dt, state, speed, ctx = {}) {
  if (!player.customModel) return;
  const h = player.customModel;
  // Whole-body flourishes: spin moves turn a full circle, reverse layups turn the back to the rim
  let yaw = player.facing + (ctx.spin || 0) * Math.PI * 2;
  if (state === 'layup' && ctx.style === 'reverse') yaw += Math.PI * 0.7;
  h.rotation.y = yaw;
  const roll = state === 'layup' && ctx.style === 'euro' ? 0.22 : ctx.move === 'crossover' || ctx.move === 'behind' ? (ctx.ballSide || 1) * 0.12 : 0;
  h.rotation.z += (roll - h.rotation.z) * Math.min(1, dt * 10);
  // Lean into sprints, sit into a defensive stance
  const lean = Math.min(0.16, speed * 0.022) + (ctx.defending && speed < 4 ? 0.07 : 0) + (state === 'dunk' ? -0.12 : 0)
    + (state === 'shoot' && ctx.style === 'fadeaway' ? -0.3 : 0) + (ctx.move === 'stepback' ? -0.16 : 0) + (ctx.move === 'hesi' ? -0.1 : 0);
  h.rotation.x += (lean - h.rotation.x) * Math.min(1, dt * 8);
  if (player.mixer) {
    // Only body-movement clips come from the model; actions are posed procedurally so they match the gameplay timing
    let want = LOOPING.has(state) ? state : 'idle';
    if (!player.clips[want]) want = (FALLBACK[want] || []).find((s) => player.clips[s]) || (player.clips.idle ? 'idle' : null);
    if (want) {
      const act = player.clips[want];
      act.timeScale = want === 'run' ? Math.max(0.7, speed / 5) : want === 'walk' ? Math.max(0.7, speed / 1.8) : 1;
      if (player.currentClip !== want) {
        const prev = player.currentClip && player.clips[player.currentClip];
        act.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        if (prev && prev !== act) prev.crossFadeTo(act, 0.18, false);
        player.currentClip = want;
      }
    }
    player.mixer.update(dt);
  }
  const b = player.bones;
  if (!b || !player.limb) return;
  const pose = choosePose(player, state, { ...ctx, speed });
  const realFacing = player.facing;
  player.facing = yaw; // limbs follow the turned body
  applyLimb(player, 'aL', b.uaL, b.laL, pose.aL, dt, ctx);
  applyLimb(player, 'aR', b.uaR, b.laR, pose.aR, dt, ctx);
  applyLimb(player, 'lL', b.ulL, b.llL, pose.lL, dt, ctx);
  applyLimb(player, 'lR', b.ulR, b.llR, pose.lR, dt, ctx);
  player.facing = realFacing;
}

export function makeCustomBall(radius) {
  if (!custom.ball) return null;
  const model = custom.ball.scene.clone();
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = (radius * 2) / Math.max(size.x, size.y, size.z);
  model.position.sub(center).multiplyScalar(s);
  model.scale.multiplyScalar(s);
  const g = new THREE.Group();
  g.add(model);
  return g;
}

function placeModel(scene, model, cfg) {
  const s = cfg.scale ?? 1;
  if (Array.isArray(s)) model.scale.fromArray(s); else model.scale.setScalar(s);
  if (cfg.position) model.position.fromArray(cfg.position);
  if (cfg.rotationY) model.rotation.y = THREE.MathUtils.degToRad(cfg.rotationY);
  scene.add(model);
}

export function placeCustomArena(scene) {
  for (const { scene: model, cfg } of custom.arenaModels) {
    const copies = cfg.copies && cfg.copies.length ? cfg.copies : [cfg];
    copies.forEach((c, i) => placeModel(scene, i === 0 ? model : model.clone(), { ...cfg, ...c }));
  }
}

// Returns true when the custom court model was placed (the built-in floor/hoops get hidden)
export function placeCustomCourt(scene) {
  if (!custom.courtModel) return false;
  placeModel(scene, custom.courtModel.scene, custom.courtModel.cfg);
  return true;
}

// ---------- Player portraits (used on cards) ----------
// Renders a head-and-shoulders picture of the 3D player model with the given colors.
let pRenderer = null, pScene = null, pCam = null;
const portraitCache = new Map();
export function portrait({ skin, hair, hairStyle = 1, jersey = '#e9edf5', trim = '#35f0ff' }) {
  const cp = custom.player;
  if (!cp) return null;
  const key = [skin, hair, hairStyle, jersey, trim].join('|');
  if (portraitCache.has(key)) return portraitCache.get(key);
  try {
    if (!pRenderer) {
      pRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      pRenderer.setSize(320, 320, false);
      pRenderer.outputColorSpace = THREE.SRGBColorSpace;
      pScene = new THREE.Scene();
      pScene.add(new THREE.HemisphereLight(0xffffff, 0x334466, 1.7));
      const key1 = new THREE.DirectionalLight(0xffffff, 2.4); key1.position.set(1.5, 2.5, 3); pScene.add(key1);
      const rim = new THREE.DirectionalLight(0x88ccff, 1.6); rim.position.set(-2, 2, -2); pScene.add(rim);
      pCam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    }
    let model = SkeletonUtils.clone(cp.scene);
    model.rotation.y = THREE.MathUtils.degToRad(cp.cfg.rotationY || 0);
    fitToHeight(model, 2);
    const fake = { team: { jerseyColor: jersey, trimColor: trim, data: { secondary: trim } }, data: { skin, hair, hairStyle }, index: 1 };
    tintModel(model, cp.cfg, fake);
    const pHolder = new THREE.Group();
    pHolder.add(model);
    attachHair(pHolder, model, findBones(model), fake.data);
    model = pHolder;
    pScene.add(model);
    pCam.position.set(0.62, 1.82, 1.72);
    pCam.lookAt(0, 1.72, 0);
    pRenderer.render(pScene, pCam);
    const url = pRenderer.domElement.toDataURL('image/png');
    pScene.remove(model);
    portraitCache.set(key, url);
    return url;
  } catch (e) {
    note(`portrait failed: ${e.message || e}`);
    portraitCache.set(key, null);
    return null;
  }
}
