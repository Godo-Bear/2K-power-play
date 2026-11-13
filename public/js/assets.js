// Loads optional custom 3D models and textures listed in /assets/assets.json.
// Everything here is optional: if a file is missing or fails to load, the game
// falls back to its built-in procedural graphics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
  if (m.shoes?.left && m.shoes?.right) jobs.push(attempt('shoes', async () => {
    const [l, r] = await Promise.all([loadGLTF(m.shoes.left), loadGLTF(m.shoes.right)]);
    l.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    r.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    custom.shoes = { left: l.scene, right: r.scene, cfg: m.shoes };
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
    case 'shorts': return player.team.shortsColor || player.team.jerseyColor;
    case 'skin': return player.data.skin;
    case 'hair': return player.data.hairStyle === 0 ? player.data.skin : player.data.hair; // style 0 = bald
    case 'shoe': return player.index % 2 ? '#ffffff' : player.team.data.secondary;
    default: return null;
  }
}

// ---------- Skeleton helpers ----------
// Works with different skeletons. Names are reduced to letters only ("CC_Base_L_Upperarm_050" -> "lupperarm",
// "UpperArm.L" -> "upperarml"), so both the Quaternius-style and Character-Creator-style rigs are recognised.
const BONE_KEYS = {
  upperarml: 'uaL', lowerarml: 'laL', upperarmr: 'uaR', lowerarmr: 'laR', upperlegl: 'ulL', lowerlegl: 'llL', upperlegr: 'ulR', lowerlegr: 'llR',
  lupperarm: 'uaL', lforearm: 'laL', rupperarm: 'uaR', rforearm: 'laR', lthigh: 'ulL', lcalf: 'llL', rthigh: 'ulR', rcalf: 'llR',
  head: 'head', headend: 'headEnd', torso: 'torso',
  lfoot: 'ftL', rfoot: 'ftR', footl: 'ftL', footr: 'ftR', spine: 'chest',
};
// The bone a limb points toward (its "child"), by name. Rigs with twist bones have several children, so the first one is not reliable.
const BONE_CHILD = { lupperarm: 'lforearm', lforearm: 'lhand', rupperarm: 'rforearm', rforearm: 'rhand', lthigh: 'lcalf', lcalf: 'lfoot', rthigh: 'rcalf', rcalf: 'rfoot' };
const boneId = (name) => name.toLowerCase().replace(/^cc_base_/, '').replace(/_\d+$/, '').replace(/[^a-z]/g, '');

function findBones(model) {
  const b = {};
  const byId = {};
  model.traverse((o) => {
    if (!o.isBone) return;
    const id = boneId(o.name);
    if (!byId[id]) byId[id] = o;
    const key = BONE_KEYS[id];
    if (key && (!b[key] || key === 'chest')) b[key] = o; // the chest is the topmost spine bone
  });
  for (const k of Object.keys(b)) {
    const bone = b[k];
    const named = byId[BONE_CHILD[boneId(bone.name)]];
    const child = named && named.parent === bone ? named : bone.children.find((c) => c.isBone && c.position.lengthSq() > 1e-8) || bone.children[0];
    bone.userData.rest = child && child.position.lengthSq() > 1e-8 ? child.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
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
function attachHair(holder, model, bones, data, cfg = {}) {
  if (!bones.head) return;
  const style = data.hairStyle ?? 2;
  // A model with its own hair mesh uses it for the Short style. Every other style is built by the game.
  if (cfg.hairMesh && style === 2) return;
  holder.updateMatrixWorld(true);
  // Fit the hair to the real skull, measured from the model's head mesh (the top of the head, not the jaw)
  let dims = null, center = null, headMesh = null;
  model.traverse((o) => {
    if (headMesh || !o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (/skin_head/i.test((mat && mat.name) || '')) headMesh = o;
  });
  if (headMesh) {
    // Measure the cranium from the vertices of the upper head (the top ~40%: forehead and skull, no nose or jaw)
    const box = new THREE.Box3().setFromObject(headMesh);
    const pos = headMesh.geometry.attributes.position, v = new THREE.Vector3();
    const yCut = box.max.y - (box.max.y - box.min.y) * 0.4;
    const hi = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
    let foreheadMaxZ = -1e9;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(headMesh.matrixWorld);
      if (v.y < yCut) continue;
      hi.minX = Math.min(hi.minX, v.x); hi.maxX = Math.max(hi.maxX, v.x);
      hi.minZ = Math.min(hi.minZ, v.z); hi.maxZ = Math.max(hi.maxZ, v.z);
      if (v.y > box.max.y - 0.06) foreheadMaxZ = Math.max(foreheadMaxZ, v.z);
    }
    const ry = (box.max.y - box.min.y) * 0.43;
    const rx = (hi.maxX - hi.minX) / 2;
    const rz = (hi.maxZ - hi.minZ) / 2;
    dims = { rx, ry, rz };
    center = new THREE.Vector3((hi.minX + hi.maxX) / 2, box.max.y - ry, (hi.minZ + hi.maxZ) / 2);
  } else {
    // No head mesh to measure: estimate from the head bone and the top of the model
    const a = bones.head.getWorldPosition(new THREE.Vector3());
    const top = new THREE.Box3().setFromObject(model).max.y;
    const r = (top - a.y) * 0.56;
    if (!(r > 0.01)) return;
    dims = { rx: r, ry: r, rz: r };
    center = new THREE.Vector3(a.x, a.y + r * 0.9, a.z);
  }
  const hair = buildHair(style, data.hair, dims.ry, { cap: !!cfg.hairMesh, skin: data.skin, dims });
  if (!hair.children.length) return;
  hair.position.copy(center);
  hair.rotation.y = model.rotation.y;
  holder.add(hair);
  holder.updateMatrixWorld(true);
  bones.head.attach(hair);
}

function tintModel(model, cfg, fake) {
  const tint = { ...(cfg.tint || {}) };
  if (cfg.jerseyMaterial && !Object.keys(tint).length) tint[cfg.jerseyMaterial] = 'jersey';
  const rules = Object.entries(tint).map(([k, v]) => [k.toLowerCase(), v]);
  const style = fake.data.hairStyle ?? 2;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // skinned meshes can be culled wrongly when animated
    // Fewer, cheaper draw calls: the mouth parts, nails and lashes are never visible at game distance, and only the big parts cast shadows
    const mname = ((Array.isArray(o.material) ? o.material[0] : o.material).name || '');
    if (/Tongue|Teeth|Nails|Eyelash|Cornea/i.test(mname)) o.visible = false;
    o.castShadow = /Skin|T_shirt|Shorts/i.test(mname);
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((mt) => {
      const c = mt.clone();
      const rule = rules.find(([k]) => (mt.name || '').toLowerCase().includes(k));
      if (rule && rule[1] === 'hair' && cfg.hairMesh && style !== 2) o.visible = false; // only the Short style keeps the model's own hair
      const col = rule && (rule[1] === 'hair' ? (cfg.hairMesh ? fake.data.hair : scalpColor(fake.data)) : tintColor(fake, rule[1]));
      if (col && c.color) {
        c.color.set(col);
        // Kit made from photo textures (a red shirt, say) would stain the team colour: use a flat colour and keep the fabric's normal map
        if (c.map && ['jersey', 'trim', 'shoe', 'shorts'].includes(rule[1]) && cfg.flatColors !== false) c.map = null;
        if (['jersey', 'trim', 'shorts'].includes(rule[1])) { c.normalMap = null; c.bumpMap = null; c.aoMap = null; c.roughness = 0.82; c.metalness = 0; }   // clean fabric: no baked wrinkles
      }
      return c;
    });
    o.material = mats.length === 1 ? mats[0] : mats;
  });
}

// ---------- Kit customisation: shoe colours and the logo / number on the jersey ----------
const shoeCache = new Map();
// A clean, flat-coloured copy of a shoe merged into a single mesh (vertex colours for the upper, midsole, trim and dark parts) so it is cheap to draw.
// `upper` and `sole` are optional custom colours; the default is the classic black and white.
function shoeVariant(side, upper, sole) {
  const key = `${side}|${upper || ''}|${sole || ''}`;
  if (shoeCache.has(key)) return shoeCache.get(key);
  const base = custom.shoes[side];
  const roleOf = (n) => (n === 'upper' ? 'upper' : n === 'midsole' ? 'midsole' : n === 'trim' ? 'trim' : 'dark');
  const col = {
    upper: new THREE.Color(upper || '#17171c'),
    midsole: new THREE.Color(sole || '#f2f2f4'),
    trim: new THREE.Color('#d5d9e0'),
    dark: sole ? new THREE.Color(sole).multiplyScalar(0.28) : new THREE.Color('#2a2b31'),
  };
  const geos = [];
  base.updateMatrixWorld(true);
  base.traverse((o) => {
    if (!o.isMesh) return;
    const ge = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(ge.attributes)) if (k !== 'position' && k !== 'normal') ge.deleteAttribute(k);
    const c = col[roleOf(o.material.name)], n = ge.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    ge.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(ge);
  });
  // One mesh, one draw call: the colours ride on the vertices
  const group = new THREE.Group();
  const geo = mergeGeometries(geos, false);
  if (geo) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.08 }));
    mesh.castShadow = false; mesh.frustumCulled = false;
    group.add(mesh);
  }
  shoeCache.set(key, group);
  return group;
}

const decalCache = new Map();
function decalTexture(team, player, back) {
  const t = team.data, fg = t.numColor || team.trimColor;
  const sym = (t.logo && t.logo.symbol) || '';
  const key = [back ? 'b' : 'f', fg, sym, t.id, player.data.number, back ? player.data.last : ''].join('|');
  if (decalCache.has(key)) return decalCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 6;
  // Text is sized to fit the canvas (and so the shirt): shrink until it is no wider than maxW
  const text = (s, y, size, maxW = 190) => {
    let px = size;
    g.font = `900 ${px}px "Arial Black", Impact, sans-serif`;
    while (px > 14 && g.measureText(s).width > maxW) { px -= 2; g.font = `900 ${px}px "Arial Black", Impact, sans-serif`; }
    g.lineWidth = Math.max(3, px * 0.07);
    g.strokeText(s, 128, y); g.fillText(s, 128, y);
  };
  if (back) {
    text(String(player.data.last || '').toUpperCase(), 52, 40, 200);
    text(String(player.data.number), 150, 130, 150);
  } else {
    if (sym) { g.font = '84px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.fillStyle = '#fff'; g.fillText(sym, 128, 62); g.fillStyle = fg; }
    else text(t.id, 60, 62, 170);
    text(String(player.data.number), 160, 92, 120);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  decalCache.set(key, tex);
  return tex;
}

// Put the team logo and number on the chest and the name and number on the back, riding on the spine bone
function attachDecals(holder, model, bones, player, cfg) {
  if (!bones || !bones.chest || !player.team || !player.team.data || player.team.data.noDecals) return;
  const rules = Object.entries(cfg.tint || {}).filter(([, v]) => v === 'jersey').map(([k]) => k.toLowerCase());
  if (!rules.length) return;
  holder.updateMatrixWorld(true);
  const v = new THREE.Vector3(), pts = [];
  model.traverse((o) => {
    if (!o.isMesh || !(Array.isArray(o.material) ? o.material : [o.material]).some((mt) => rules.some((r) => (mt.name || '').toLowerCase().includes(r)))) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
  });
  if (!pts.length) return;
  let minY = 1e9, maxY = -1e9;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const cy = minY + (maxY - minY) * 0.62, size = Math.min(0.3, (maxY - minY) * 0.5);
  let zF = -1e9, zB = 1e9, cx = 0, n = 0;
  for (const p of pts) if (Math.abs(p.y - cy) < size * 0.3) { cx += p.x; n++; }
  cx = n ? cx / n : 0;
  for (const p of pts) if (Math.abs(p.y - cy) < size * 0.3 && Math.abs(p.x - cx) < size * 0.25) { zF = Math.max(zF, p.z); zB = Math.min(zB, p.z); }
  if (zF < -1e8) return;
  const mk = (back) => {
    const mat = new THREE.MeshStandardMaterial({ map: decalTexture(player.team, player, back), transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.position.set(cx, cy, back ? zB - 0.004 : zF + 0.004);
    if (back) m.rotation.y = Math.PI;
    m.renderOrder = 2; m.frustumCulled = false; m.castShadow = false;
    holder.add(m);
    holder.updateMatrixWorld(true);
    bones.chest.attach(m);
  };
  mk(false); mk(true);
}

// Swap the model's boots for the sneaker model: each shoe is sized to the boot it replaces and rides on the foot bone
const SHOE_LEN = 0.362; // length of the shoe model, in its own units
function attachShoes(holder, model, bones, player) {
  const sh = custom.shoes;
  const placed = [];
  if (!sh || !bones || !bones.ftL || !bones.ftR) return placed;
  const boots = [];
  model.traverse((o) => { if (o.isMesh && (Array.isArray(o.material) ? o.material : [o.material]).some((mt) => /boot/i.test(mt.name || ''))) boots.push(o); });
  if (!boots.length) return placed;
  holder.updateMatrixWorld(true);
  const v = new THREE.Vector3(), fp = new THREE.Vector3();
  const box = { l: new THREE.Box3(), r: new THREE.Box3() };
  bones.ftL.getWorldPosition(fp);
  const midX = fp.x * 0; // feet are either side of the model's centre line
  for (const m of boots) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      (v.x > midX ? box.l : box.r).expandByPoint(v);
    }
  }
  const fit = (side, bone, src) => {
    const b = box[side];
    if (b.isEmpty()) return;
    const len = b.max.z - b.min.z, wid = b.max.x - b.min.x;
    const s = Math.min((len * 1.06) / SHOE_LEN, (wid * 1.5) / 0.144);
    const shoe = src.clone(true);
    shoe.userData.isShoe = true;
    shoe.rotation.y = -Math.PI / 2;                       // toe along +z, the way the player faces
    shoe.scale.setScalar(s);
    shoe.position.set((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2 + len * 0.02);
    holder.add(shoe);
    holder.updateMatrixWorld(true);
    bone.attach(shoe);
    placed.push({ obj: shoe, foot: bone, calf: side === 'l' ? bones.llL : bones.llR, rel: shoe.quaternion.clone() });
  };
  const upper = (player.data && player.data.shoeUpper) || (player.team && player.team.data && player.team.data.shoeUpper) || null;
  const sole = (player.data && player.data.shoeSole) || (player.team && player.team.data && player.team.data.shoeSole) || null;
  fit('l', bones.ftL, shoeVariant('left', upper, sole));
  fit('r', bones.ftR, shoeVariant('right', upper, sole));
  for (const m of boots) m.visible = false;
  return placed;
}

// The foot bones can twist as the legs are posed, so each shoe is aimed from the body instead:
// toe along the way the player faces, tilted with the shin (toe down on the trailing leg, up on the leading one)
const _qs = { h: new THREE.Quaternion(), i: new THREE.Quaternion(), p: new THREE.Quaternion(), r: new THREE.Quaternion(), d: new THREE.Quaternion(), pitch: new THREE.Quaternion(), yaw: new THREE.Quaternion() };
const _vs = { a: new THREE.Vector3(), b: new THREE.Vector3() };
const _AX = new THREE.Vector3(1, 0, 0), _AY = new THREE.Vector3(0, 1, 0);
function orientShoes(player, fresh = false) {
  const h = player.customModel;
  if (!fresh) h.updateMatrixWorld(true);
  h.getWorldQuaternion(_qs.h);
  _qs.i.copy(_qs.h).invert();
  _qs.yaw.setFromAxisAngle(_AY, -Math.PI / 2);
  for (const s of player.shoes) {
    let pitch = 0;
    if (s.calf) {
      s.foot.getWorldPosition(_vs.a); s.calf.getWorldPosition(_vs.b);
      _vs.a.sub(_vs.b).applyQuaternion(_qs.i);          // calf to ankle, in the body's own frame
      pitch = Math.max(-0.9, Math.min(0.7, Math.atan2(_vs.a.z, -_vs.a.y) * 0.55));
    }
    _qs.pitch.setFromAxisAngle(_AX, -pitch);
    _qs.d.copy(_qs.h).multiply(_qs.pitch).multiply(_qs.yaw);          // desired world rotation
    // Turn the foot bone itself (the clips leave the feet twisted), so the bare foot and the shoe agree
    _qs.d.multiply(_qs.r.copy(s.rel).invert());                         // the bone's own desired world rotation
    s.foot.parent.getWorldQuaternion(_qs.p);
    s.foot.quaternion.copy(_qs.p.invert()).multiply(_qs.d);
    s.foot.updateMatrixWorld(true);
    s.obj.quaternion.copy(s.rel);
  }
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
  attachHair(holder, model, player.bones, player.data, cfg);
  player.shoes = attachShoes(holder, model, player.bones, player);
  if (player.bones && player.bones.ftL && player.bones.ftR) {
    holder.updateMatrixWorld(true);
    const va = new THREE.Vector3(), vb = new THREE.Vector3();
    player.bones.ftL.getWorldPosition(va); player.bones.ftR.getWorldPosition(vb);
    holder.worldToLocal(va); holder.worldToLocal(vb);
    player.ankleH = Math.min(va.y, vb.y);   // ankle height when standing: the reference for keeping feet on the floor
  }
  attachDecals(holder, model, player.bones, player, cfg);
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
  if (ctx.refSignal) {
    // Referee signals
    const t = ctx.t || 0;
    switch (ctx.refSignal) {
      case 'foul': out.aR = [[-0.15, 1, 0.05], [-0.05, 1, 0.12]]; break;                       // fist raised
      case 'two': out.aR = [[-0.2, 0.98, 0.05], [-0.05, 1, 0.1]]; break;
      case 'three': both([0.25, 0.95, 0.1], [0.1, 1, 0.1]); break;                            // both arms up
      case 'point': { const d = ctx.refPoint || [0, 0.05, 1]; out.aR = [d, d]; break; }        // arm out toward the end
      case 'tee': out.aL = [[0.55, 0.4, 0.45], [0.1, 0.95, 0.1]]; out.aR = [[-0.1, 0.05, 0.9], [0.45, 0.1, 0.9]]; break; // timeout T
      case 'travel': {                                                                          // rolling hands
        const a = t * 9;
        out.aL = [[0.45, -0.15, 0.5], [0.25, Math.sin(a) * 0.7, 0.6 + Math.cos(a) * 0.35]];
        out.aR = [[-0.45, -0.15, 0.5], [-0.25, Math.sin(a + 3) * 0.7, 0.6 + Math.cos(a + 3) * 0.35]];
        break;
      }
      default: break;
    }
  } else if (ctx.passT > 0 && ctx.passLocal) {
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
    const t = ctx.actionT || 0;
    // Direction from the shoulder to the ball, in the player's own space, so the arm really reaches for it
    let dx = 0, dy = -0.2, dz = 1;
    if (ctx.ballPos) {
      const wx = ctx.ballPos.x - p.pos.x, wz = ctx.ballPos.z - p.pos.z, wy = ctx.ballPos.y - (p.y + p.data.height * 0.78);
      const c = Math.cos(p.facing), s = Math.sin(p.facing);
      dx = wx * c - wz * s; dz = wx * s + wz * c; dy = wy;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    }
    if (t < 0.14) {
      // Wind-up: the hand is pulled back and low, the other arm goes out for balance
      out.aR = [[-0.35, -0.55, -0.35], [-0.15, -0.3, -0.5]];
      out.aL = [[0.75, 0.1, 0.25], [0.5, 0.4, 0.3]];
    } else if (t < 0.44) {
      // Strike: the arm shoots out at the ball (a swipe also sweeps across it), with a lunging step
      const k = (t - 0.14) / 0.3;
      const sweep = ctx.stealStyle === 'swipe' ? (0.5 - k) * 1.5 : (0.5 - k) * 0.25;
      out.aR = [[dx - sweep, dy, dz], [dx - sweep * 0.5, dy, dz]];
      out.aL = [[0.85, 0.15, -0.15], [0.55, 0.3, -0.3]];
      out.lR = [[-0.1, -0.4, 0.9], [0, -0.95, -0.2]];
      out.lL = [[0.1, -0.85, -0.45], [0, -1, -0.1]];
    } // after that no pose is forced, so he settles back into his defensive stance
  } else if (ctx.pumpT > 0) {
    // Pump fake: the ball goes up as if to shoot, then comes back down
    both([0.2, 0.5, 0.82], [-0.14, 0.97, 0.12]);
  } else if (state === 'celebrate') {
    const w = Math.sin((ctx.t || 0) * 7);
    out.aL = [[0.45, 0.9 + 0.1 * w, 0.1], [0.3, 0.95, 0.1]]; out.aR = [[-0.45, 0.9 - 0.1 * w, 0.1], [-0.3, 0.95, 0.1]];
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
  // Athletic stances (set only when nothing above has posed the legs): the legs bend so every state looks like basketball
  if (!out.lL && !out.lR) {
    const bend = (th, kn, spread) => [[spread, -Math.cos(th), Math.sin(th)], [spread * 0.3, -Math.cos(th - kn), Math.sin(th - kn)]];
    const both2 = (th, kn, sp) => { out.lL = bend(th, kn, sp); out.lR = bend(th, kn, -sp).map((v) => v); };
    if (state === 'sit') {
      out.lL = [[0.05, 0.02, 1], [0.02, -1, 0.1]]; out.lR = [[-0.05, 0.02, 1], [-0.02, -1, 0.1]];
      out.aL = [[0.3, -0.7, 0.2], [0.1, -0.1, 0.95]]; out.aR = [[-0.3, -0.7, 0.2], [-0.1, -0.1, 0.95]];   // forearms rest on the knees
    } else if (state === 'shoot' || state === 'ft') {
      // Load the legs before the jump, then extend and tuck slightly in the air
      const dip = ctx.released ? 0 : Math.min(1, (ctx.actionT || 0) / 0.28);
      if (ctx.released || ctx.airborne) both2(0.1, 0.3, 0.06); else both2(0.62 * dip, 1.0 * dip, 0.08);
    } else if (ctx.postT > 0) {
      both2(0.42, 0.8, 0.2);                                                   // wide, low base while backing down
      out.aR = [[-0.8, -0.15, 0.1], [-0.6, 0.35, -0.2]]; out.aL = [[0.55, -0.55, 0.25], [0.2, 0.05, 0.9]];
    } else if (ctx.pumpT > 0) {
      const d = Math.sin(Math.min(1, ctx.pumpT / 0.4) * Math.PI);
      both2(0.5 * d, 0.85 * d, 0.08);
    } else if (ctx.defending && !ctx.hasBall && !ctx.airborne && (ctx.speed || 0) < 4.6) {
      // Defensive stance and slide: wide base, knees bent, feet shuffling when moving
      const slide = (ctx.speed || 0) > 0.7 ? Math.sin(ctx.phase || 0) : 0;
      const wide = (side, s) => [[side * (0.42 + 0.32 * Math.max(0, s)), -0.84, 0.16], [side * 0.14, -0.82, -0.32]];
      out.lL = wide(1, slide); out.lR = wide(-1, -slide);
    } else if (ctx.hasBall && (ctx.speed || 0) < 1.2 && !ctx.airborne) {
      both2(0.34, 0.68, 0.08);                                               // ball handler sits into a triple-threat stance
    } else if ((ctx.landT || 0) > 0) {
      const k = ctx.landT / 0.2; both2(0.5 * k, 0.9 * k, 0.08);               // absorb the landing
    }
  }
  // Walking and running: the model's clips are single poses, so the stride is built here.
  // Legs swing from the hips with the knee folding on the way forward; arms swing against the legs.
  if ((state === 'walk' || state === 'run') && !ctx.airborne) {
    const run = Math.min(1, Math.max(0, ((ctx.speed || 0) - 1.2) / 4.5));        // 0 = easy walk, 1 = full sprint
    const A = 0.38 + 0.42 * run, K = 0.45 + 0.85 * run;                         // thigh swing and knee fold
    const leg = (a, side) => {
      const th = Math.sin(a) * A, kn = Math.max(0, Math.cos(a)) * K + 0.08;
      return [[side * 0.06, -Math.cos(th), Math.sin(th)], [0, -Math.cos(th - kn), Math.sin(th - kn)]];
    };
    const ph = ctx.phase || 0;
    if (!out.lL && !out.lR) { out.lL = leg(ph, 1); out.lR = leg(ph + Math.PI, -1); }
    if (!out.aL && !out.aR) {
      const AA = 0.3 + 0.5 * run, el = 0.35 + 0.8 * run;
      const arm = (a, side) => { const th = Math.sin(a) * AA; return [[side * 0.22, -Math.cos(th), Math.sin(th)], [side * 0.1, -Math.cos(th + el), Math.sin(th + el)]]; };
      out.aL = arm(ph + Math.PI, 1); out.aR = arm(ph, -1);
    }
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
  if (ctx.postT > 0) yaw += Math.PI * 0.82 * Math.min(1, (1.4 - ctx.postT) / 0.22, ctx.postT / 0.2);   // back to the basket
  h.rotation.y = yaw;
  const roll = state === 'layup' && ctx.style === 'euro' ? 0.22 : ctx.move === 'crossover' || ctx.move === 'behind' ? (ctx.ballSide || 1) * 0.12 : (state === 'idle' && speed < 0.5 ? Math.sin((player.life || 0) * 0.9) * 0.014 : 0);
  h.rotation.z += (roll - h.rotation.z) * Math.min(1, dt * 10);
  // Lean into sprints, sit into a defensive stance
  const lean = Math.min(0.16, speed * 0.022) + (ctx.defending && speed < 4 ? 0.07 : 0) + (state === 'dunk' ? -0.12 : 0)
    + (state === 'steal' ? 0.3 : 0)
    + (state === 'shoot' && ctx.style === 'fadeaway' ? -0.3 : 0) + (ctx.move === 'stepback' ? -0.16 : 0) + (ctx.move === 'hesi' ? -0.1 : 0);
  h.rotation.x += (lean - h.rotation.x) * Math.min(1, dt * 8);
  // Life in the body: a bounce on every stride, a shoulder sway, and slow breathing when standing still
  player.life = (player.life || 0) + dt;
  const stride = (state === 'walk' || state === 'run') ? Math.min(1, Math.max(0, (speed - 1.2) / 4.5)) : -1;
  const ph = player.walkPhase || 0;
  const bob = stride >= 0 ? Math.abs(Math.sin(ph)) * (0.018 + 0.04 * stride) - 0.012 * stride : Math.sin(player.life * 2.1) * 0.006;
  player.bobY = (player.bobY || 0) + (bob - (player.bobY || 0)) * Math.min(1, dt * 18);
  if (player.wasAir && !ctx.airborne) player.landT = 0.2;
  player.wasAir = !!ctx.airborne;
  player.landT = Math.max(0, (player.landT || 0) - dt);
  const sway = stride >= 0 ? Math.sin(ph) * (0.04 + 0.07 * stride) : 0;
  h.rotation.y += sway;
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
    if (!ctx.freezeMixer) player.mixer.update(dt);
  }
  const b = player.bones;
  if (!b || !player.limb) return;
  const sliding = ctx.defending && speed > 0.6 && !ctx.airborne && !ctx.hasBall && speed < 4.6;
  if (state === 'walk' || state === 'run' || sliding) player.walkPhase = ((player.walkPhase || 0) + dt * (sliding ? 5 + speed * 1.6 : Math.min(15, 6 + speed * 1.0))) % (Math.PI * 2);
  const pose = choosePose(player, state, { ...ctx, speed, phase: player.walkPhase || 0, landT: player.landT || 0, t: player.life });
  const realFacing = player.facing;
  player.facing = yaw; // limbs follow the turned body
  applyLimb(player, 'aL', b.uaL, b.laL, pose.aL, dt, ctx);
  applyLimb(player, 'aR', b.uaR, b.laR, pose.aR, dt, ctx);
  applyLimb(player, 'lL', b.ulL, b.llL, pose.lL, dt, ctx);
  applyLimb(player, 'lR', b.ulR, b.llR, pose.lR, dt, ctx);
  player.facing = realFacing;
  // Keep the feet on the floor: when the legs bend, lower the whole body by how far the ankles were lifted
  const fixTarget = ctx.airborne || state === 'dunk' || state === 'layup' ? 0 : groundFix(player);
  player.fixY = (player.fixY || 0) + (fixTarget - (player.fixY || 0)) * Math.min(1, dt * 16);
  h.position.y = (player.bobY || 0) - player.fixY;
  if (player.shoes && player.shoes.length) orientShoes(player, true);
}

const _gv = { a: new THREE.Vector3(), b: new THREE.Vector3() };
function groundFix(player) {
  const b = player.bones, h = player.customModel;
  if (!b || !b.ftL || !b.ftR || player.ankleH == null) return 0;
  h.updateMatrixWorld(true);
  b.ftL.getWorldPosition(_gv.a); b.ftR.getWorldPosition(_gv.b);
  h.worldToLocal(_gv.a); h.worldToLocal(_gv.b);
  return THREE.MathUtils.clamp(Math.min(_gv.a.y, _gv.b.y) - player.ankleH, 0, 0.62);
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
  // Make the ball easy to spot: a warm glow on the surface itself
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((mt) => {
      const c = mt.clone();
      if ('emissive' in c) { c.emissive = new THREE.Color(0xff5a10); c.emissiveIntensity = 0.38; }
      return c;
    }).reduce((a, c, _, all) => (all.length === 1 ? c : all), null);
  });
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
// `yaw` turns the model (degrees) and `zoom` (0 to 1) moves the camera in on the head; both are for previews
export function portrait({ skin, hair, hairStyle = 1, jersey = '#e9edf5', trim = '#35f0ff', shorts = null, yaw = 0, zoom = 0, body = false, kit = null }) {
  const cp = custom.player;
  if (!cp) return null;
  const key = [skin, hair, hairStyle, jersey, trim, shorts, yaw, zoom, body, kit ? JSON.stringify(kit) : ''].join('|');
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
    const fake = { team: { jerseyColor: jersey, trimColor: trim, shortsColor: shorts, data: { secondary: trim, ...((kit && kit.team) || {}) } }, data: { skin, hair, hairStyle, number: kit ? kit.number : 7, last: kit ? kit.last : 'STAR', shoeUpper: kit ? kit.shoeUpper : null, shoeSole: kit ? kit.shoeSole : null }, index: 1 };
    tintModel(model, cp.cfg, fake);
    const pHolder = new THREE.Group();
    pHolder.add(model);
    // The hair is fitted while the model is still in its T-pose, then rides on the head bone through the pose below
    const pBones = findBones(model);
    attachHair(pHolder, model, pBones, fake.data, cp.cfg);
    const pShoes = body ? attachShoes(pHolder, model, pBones, fake) : [];
    if (body) attachDecals(pHolder, model, pBones, fake, cp.cfg);
    // Models are authored in a T-pose: pose the portrait with the idle clip so he stands naturally
    const idleName = cp.cfg.animations && cp.cfg.animations.idle;
    const idleClip = idleName && THREE.AnimationClip.findByName(cp.animations || [], idleName);
    if (idleClip) { const mx = new THREE.AnimationMixer(model); mx.clipAction(idleClip).play(); mx.update(0.4); }
    pHolder.updateMatrixWorld(true);
    if (pShoes.length) orientShoes({ customModel: pHolder, shoes: pShoes });
    model = pHolder;
    model.rotation.y = THREE.MathUtils.degToRad(yaw);
    pScene.add(model);
    pRenderer.setSize(body ? 360 : 320, body ? 540 : 320, false);
    pCam.aspect = body ? 360 / 540 : 1;
    pCam.updateProjectionMatrix();
    if (body) {
      pCam.position.set(0, 1.02, 4.9);
      pCam.lookAt(0, 0.98, 0);
    } else if (zoom > 0) {
      // Head close-up, looking straight at the face (so yaw shows the side/back)
      pCam.position.set(0.0, 1.8, 1.5 - 0.15 * zoom);
      pCam.lookAt(0, 1.79, 0);
    } else {
      pCam.position.set(0.62, 1.82, 1.72);
      pCam.lookAt(0, 1.72, 0);
    }
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
