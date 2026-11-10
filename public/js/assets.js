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
  arena: null,       // { scene, cfg }
  log: [],
};

function note(msg) { custom.log.push(msg); console.info('[assets]', msg); }

async function loadGLTF(path) {
  const g = await gltfLoader.loadAsync(BASE + path);
  g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

async function loadTex(path, repeat) {
  const t = await texLoader.loadAsync(BASE + path);
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
  const jobs = [];
  if (m.ball?.model) jobs.push(attempt('ball model', async () => { custom.ball = { scene: (await loadGLTF(m.ball.model)).scene, cfg: m.ball }; }));
  if (m.ball?.texture) jobs.push(attempt('ball texture', async () => { custom.ballTexture = await loadTex(m.ball.texture); }));
  if (m.player?.model) jobs.push(attempt('player model', async () => {
    const g = await loadGLTF(m.player.model);
    custom.player = { scene: g.scene, animations: g.animations, cfg: m.player };
  }));
  if (m.court?.texture) jobs.push(attempt('court texture', async () => { custom.courtTexture = await loadTex(m.court.texture); }));
  if (m.arena?.model) jobs.push(attempt('arena model', async () => { custom.arena = { scene: (await loadGLTF(m.arena.model)).scene, cfg: m.arena }; }));
  await Promise.all(jobs);
  return custom;
}

// Fit a model so its height equals `height` meters and its feet sit at y=0.
function fitToHeight(obj, height) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0) obj.scale.multiplyScalar(height / size.y);
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box2.min.y;
}

// Replace a procedural player's look with the custom model (keeps the hidden rig for gameplay).
export function applyCustomPlayer(player) {
  const cp = custom.player;
  if (!cp) return;
  const cfg = cp.cfg;
  const model = SkeletonUtils.clone(cp.scene);
  const holder = new THREE.Group();
  holder.add(model);
  fitToHeight(model, player.data.height * (cfg.scale || 1));
  model.rotation.y = THREE.MathUtils.degToRad(cfg.rotationY || 0);
  // Tint jersey materials: any material whose name contains `jerseyMaterial` (default "jersey")
  const key = (cfg.jerseyMaterial || 'jersey').toLowerCase();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((mt) => {
      const c = mt.clone();
      if ((mt.name || '').toLowerCase().includes(key) && c.color) c.color.set(player.team.jerseyColor);
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  player.body.visible = false;
  player.root.add(holder);
  player.customModel = holder;
  if (cp.animations?.length) {
    player.mixer = new THREE.AnimationMixer(model);
    const names = cfg.animations || {};
    player.clips = {};
    for (const [state, clipName] of Object.entries(names)) {
      const clip = THREE.AnimationClip.findByName(cp.animations, clipName);
      if (clip) player.clips[state] = player.mixer.clipAction(clip);
    }
    player.currentClip = null;
  }
}

export function updateCustomPlayer(player, dt, state) {
  if (!player.customModel) return;
  player.customModel.rotation.y = player.facing;
  if (!player.mixer) return;
  player.mixer.update(dt);
  const want = player.clips[state] ? state : player.clips.idle ? 'idle' : null;
  if (!want || player.currentClip === want) return;
  const next = player.clips[want];
  const prev = player.currentClip && player.clips[player.currentClip];
  next.reset().play();
  if (prev) prev.crossFadeTo(next, 0.2, false);
  player.currentClip = want;
}

export function makeCustomBall(radius) {
  if (!custom.ball) return null;
  const model = custom.ball.scene.clone();
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

export function placeCustomArena(scene) {
  if (!custom.arena) return;
  const { scene: model, cfg } = custom.arena;
  model.scale.setScalar(cfg.scale || 1);
  if (cfg.position) model.position.fromArray(cfg.position);
  if (cfg.rotationY) model.rotation.y = THREE.MathUtils.degToRad(cfg.rotationY);
  scene.add(model);
}
