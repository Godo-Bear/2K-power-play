// Loads optional custom 3D models and textures listed in /assets/assets.json.
// Everything here is optional: if a file is missing or fails to load, the game
// falls back to its built-in procedural graphics.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

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

// Replace a procedural player's look with the custom model (keeps the hidden rig for gameplay).
export function applyCustomPlayer(player) {
  const cp = custom.player;
  if (!cp) return;
  const cfg = cp.cfg;
  const model = SkeletonUtils.clone(cp.scene);
  const holder = new THREE.Group();
  holder.add(model);
  model.rotation.y = THREE.MathUtils.degToRad(cfg.rotationY || 0);
  fitToHeight(model, player.data.height * (cfg.scale || 1));
  const tint = { ...(cfg.tint || {}) };
  if (cfg.jerseyMaterial && !Object.keys(tint).length) tint[cfg.jerseyMaterial] = 'jersey';
  const rules = Object.entries(tint).map(([k, v]) => [k.toLowerCase(), v]);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // skinned meshes can be culled wrongly when animated
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((mt) => {
      const c = mt.clone();
      const name = (mt.name || '').toLowerCase();
      const rule = rules.find(([k]) => name.includes(k));
      const col = rule && tintColor(player, rule[1]);
      if (col && c.color) c.color.set(col);
      return c;
    });
    o.material = out.length === 1 ? out[0] : out;
  });
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

const ONE_SHOT = new Set(['jump', 'shoot', 'layup', 'dunk']);

export function updateCustomPlayer(player, dt, state, speed) {
  if (!player.customModel) return;
  player.customModel.rotation.y = player.facing;
  if (!player.mixer) return;
  // Fallbacks so partial animation sets still work
  const fallback = { walk: ['run'], dribble: ['idle'], shoot: ['jump'], layup: ['jump'], dunk: ['layup', 'jump'], celebrate: ['idle'], jump: ['idle'], run: ['walk', 'idle'] };
  let want = state;
  if (!player.clips[want]) want = (fallback[state] || []).find((s) => player.clips[s]) || (player.clips.idle ? 'idle' : null);
  if (want) {
    const act = player.clips[want];
    if (want === 'run' || want === 'walk') act.timeScale = Math.max(0.6, speed / (want === 'run' ? 5 : 1.8));
    else if (ONE_SHOT.has(want)) act.timeScale = act.getClip().duration / 0.85;
    else act.timeScale = 1;
    if (player.currentClip !== want) {
      const prev = player.currentClip && player.clips[player.currentClip];
      act.reset();
      act.setLoop(ONE_SHOT.has(want) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      act.clampWhenFinished = true;
      act.play();
      if (prev && prev !== act) prev.crossFadeTo(act, 0.15, false);
      player.currentClip = want;
    }
  }
  player.mixer.update(dt);
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
    const model = SkeletonUtils.clone(cp.scene);
    model.rotation.y = THREE.MathUtils.degToRad((cp.cfg.rotationY || 0) + 18);
    fitToHeight(model, 2);
    const fake = { team: { jerseyColor: jersey, trimColor: trim, data: { secondary: trim } }, data: { skin, hair, hairStyle }, index: 1 };
    const rules = Object.entries(cp.cfg.tint || {}).map(([k, v]) => [k.toLowerCase(), v]);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((mt) => {
        const c = mt.clone();
        const rule = rules.find(([k]) => (mt.name || '').toLowerCase().includes(k));
        const col = rule && tintColor(fake, rule[1]);
        if (col && c.color) c.color.set(col);
        return c;
      });
      o.material = mats.length === 1 ? mats[0] : mats;
    });
    pScene.add(model);
    pCam.position.set(0.25, 1.78, 1.75);
    pCam.lookAt(0, 1.7, 0);
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
