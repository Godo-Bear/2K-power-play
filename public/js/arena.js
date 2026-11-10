import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { custom, placeCustomArena } from './assets.js';

// Court dimensions in meters (regulation 94ft x 50ft)
export const C = {
  HALF_L: 14.325,
  HALF_W: 7.62,
  HOOP_X: 12.725,
  RIM_H: 3.05,
  RIM_R: 0.229,
  BOARD_X: 13.1,
  THREE_R: 7.24,
  CORNER_Z: 6.71,
  KEY_W: 4.88,
  FT_X: 8.535, // free-throw line distance from center
};
const APRON = 2.6;

function courtTexture(home) {
  const Lx = C.HALF_L * 2 + APRON * 2, Lz = C.HALF_W * 2 + APRON * 2;
  const W = 4096, H = Math.round(W * Lz / Lx);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const s = W / Lx;
  const X = (x) => (x + Lx / 2) * s;
  const Z = (z) => (z + Lz / 2) * s;

  // Apron
  g.fillStyle = home.secondary;
  g.fillRect(0, 0, W, H);

  // Hardwood planks
  const plankW = 0.06 * s;
  const x0 = X(-C.HALF_L), x1 = X(C.HALF_L), z0 = Z(-C.HALF_W), z1 = Z(C.HALF_W);
  for (let y = z0, row = 0; y < z1; y += plankW, row++) {
    let x = x0 - (row * 137) % 400;
    while (x < x1) {
      const len = (2.0 + Math.random() * 2.5) * s;
      const l = 62 + Math.random() * 10;
      const h = 30 + Math.random() * 6;
      g.fillStyle = `hsl(${h}, ${48 + Math.random() * 10}%, ${l}%)`;
      g.fillRect(x, y, len, plankW);
      g.fillStyle = 'rgba(80,45,15,0.18)';
      g.fillRect(x, y, 1.5, plankW);
      // grain
      g.strokeStyle = 'rgba(120,70,30,0.07)';
      g.lineWidth = 1;
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        const yy = y + Math.random() * plankW;
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + 2, x + len * 0.6, yy - 2, x + len, yy);
        g.stroke();
      }
      x += len;
    }
    g.fillStyle = 'rgba(70,40,15,0.12)';
    g.fillRect(x0, y, x1 - x0, 1);
  }

  // Painted keys
  g.fillStyle = home.primary;
  g.globalAlpha = 0.88;
  for (const side of [-1, 1]) {
    const bx = side * C.HALF_L, fx = side * (C.HALF_L - 5.8);
    g.fillRect(Math.min(X(bx), X(fx)), Z(-C.KEY_W / 2), Math.abs(X(bx) - X(fx)), C.KEY_W * s);
  }
  // Center circle fill
  g.beginPath(); g.arc(X(0), Z(0), 1.83 * s, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;

  // Lines
  g.strokeStyle = '#ffffff';
  g.lineWidth = 0.05 * s;
  g.strokeRect(x0, z0, x1 - x0, z1 - z0);
  g.beginPath(); g.moveTo(X(0), z0); g.lineTo(X(0), z1); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 1.83 * s, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 0.61 * s, 0, Math.PI * 2); g.stroke();

  for (const side of [-1, 1]) {
    const hx = side * C.HOOP_X;
    const bx = side * C.HALF_L;
    const fx = side * (C.HALF_L - 5.8);
    // Key outline
    g.strokeRect(Math.min(X(bx), X(fx)), Z(-C.KEY_W / 2), Math.abs(X(bx) - X(fx)), C.KEY_W * s);
    // Free-throw circle
    g.beginPath();
    g.arc(X(fx), Z(0), 1.83 * s, side > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? Math.PI * 1.5 : Math.PI / 2);
    g.stroke();
    g.setLineDash([0.3 * s, 0.3 * s]);
    g.beginPath();
    g.arc(X(fx), Z(0), 1.83 * s, side > 0 ? -Math.PI / 2 : Math.PI / 2, side > 0 ? Math.PI / 2 : Math.PI * 1.5);
    g.stroke();
    g.setLineDash([]);
    // Three point line
    const ang = Math.asin(C.CORNER_Z / C.THREE_R);
    const cornerX = hx - side * C.THREE_R * Math.cos(ang);
    g.beginPath();
    g.moveTo(X(bx), Z(-C.CORNER_Z)); g.lineTo(X(cornerX), Z(-C.CORNER_Z));
    g.moveTo(X(bx), Z(C.CORNER_Z)); g.lineTo(X(cornerX), Z(C.CORNER_Z));
    g.stroke();
    g.beginPath();
    if (side > 0) g.arc(X(hx), Z(0), C.THREE_R * s, Math.PI - ang, Math.PI + ang);
    else g.arc(X(hx), Z(0), C.THREE_R * s, -ang, ang);
    g.stroke();
    // Restricted area
    g.beginPath();
    if (side > 0) g.arc(X(hx), Z(0), 1.22 * s, Math.PI / 2, Math.PI * 1.5);
    else g.arc(X(hx), Z(0), 1.22 * s, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    // Baseline wordmark
    g.save();
    g.translate(X(side * (C.HALF_L + APRON * 0.5)), Z(0));
    g.rotate(side * Math.PI / 2);
    g.fillStyle = home.accent;
    g.font = `900 ${1.1 * s}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(home.name.toUpperCase(), 0, 0);
    g.restore();
  }

  // Sideline wordmarks
  g.fillStyle = home.accent;
  g.font = `900 ${0.9 * s}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(home.city.toUpperCase(), X(-6), Z(-C.HALF_W - APRON * 0.5));
  g.fillText('2K POWER PLAY', X(6), Z(-C.HALF_W - APRON * 0.5));
  g.save(); g.translate(X(0), Z(C.HALF_W + APRON * 0.5)); g.rotate(Math.PI);
  g.fillText(home.city.toUpperCase() + ' ' + home.name.toUpperCase(), 0, 0); g.restore();

  // Center logo
  g.save();
  g.translate(X(0), Z(0));
  g.fillStyle = home.secondary;
  g.beginPath(); g.arc(0, 0, 1.25 * s, 0, Math.PI * 2); g.fill();
  g.strokeStyle = home.accent; g.lineWidth = 0.08 * s; g.stroke();
  g.fillStyle = home.accent;
  g.font = `900 ${0.85 * s}px "Arial Black", Impact, sans-serif`;
  g.fillText(home.id, 0, 0.05 * s);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, Lx, Lz };
}

function textCanvas(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return { canvas: cv, tex: t };
}

function buildHoop(side, mats) {
  const g = new THREE.Group();
  const hx = side * C.HOOP_X;
  // Stanchion base (padded) behind baseline
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.2, 1.1, 1.6, 4, 0.12), mats.pad);
  base.position.set(side * (C.HALF_L + 1.35), 0.55, 0);
  base.castShadow = true; base.receiveShadow = true;
  g.add(base);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.9, 0.28), mats.pad);
  pole.position.set(side * (C.HALF_L + 1.15), 2.4, 0);
  pole.rotation.z = side * 0.32;
  pole.castShadow = true;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.16, 0.16), mats.metal);
  arm.position.set(side * (C.BOARD_X + 0.78), 3.55, 0);
  g.add(arm);
  // Backboard glass + frame
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.07, 1.83), mats.glass);
  glass.position.set(side * C.BOARD_X, 3.45, 0);
  g.add(glass);
  const frameMat = mats.frame;
  const fr = [[0.05, 0.05, 1.86, 0, 0.535], [0.05, 0.05, 1.86, 0, -0.535], [0.05, 1.12, 0.05, 0.915, 0], [0.05, 1.12, 0.05, -0.915, 0]];
  for (const [w, h, d, dz, dy] of fr) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(side * C.BOARD_X, 3.45 + dy, dz);
    g.add(m);
  }
  // Shooter square
  const sq = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.59, 0.45)), new THREE.LineBasicMaterial({ color: 0xffffff }));
  sq.rotation.y = Math.PI / 2;
  sq.position.set(side * (C.BOARD_X - 0.02), 3.3, 0);
  g.add(sq);
  // Rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(C.RIM_R, 0.012, 10, 40), mats.rim);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(hx, C.RIM_H, 0);
  rim.castShadow = true;
  g.add(rim);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.1), mats.rim);
  bracket.position.set(side * (C.BOARD_X - 0.08), C.RIM_H, 0);
  g.add(bracket);
  // Net
  const netPts = [];
  const N = 12, rings = 5;
  const ring = (k) => ({ r: C.RIM_R - k * 0.022, y: -k * 0.105 });
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < rings - 1; k++) {
      const a0 = (i + (k % 2) * 0.5) / N * Math.PI * 2;
      const a1 = (i + ((k + 1) % 2) * 0.5) / N * Math.PI * 2;
      const r0 = ring(k), r1 = ring(k + 1);
      netPts.push(Math.cos(a0) * r0.r, r0.y, Math.sin(a0) * r0.r, Math.cos(a1) * r1.r, r1.y, Math.sin(a1) * r1.r);
      const a2 = (i + 1 + (k % 2) * 0.5) / N * Math.PI * 2;
      netPts.push(Math.cos(a2) * r0.r, r0.y, Math.sin(a2) * r0.r, Math.cos(a1) * r1.r, r1.y, Math.sin(a1) * r1.r);
    }
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(netPts, 3));
  const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.9 }));
  net.position.set(hx, C.RIM_H, 0);
  g.add(net);
  return { group: g, net };
}

export function buildArena(scene, home, away) {
  const mats = {
    pad: new THREE.MeshStandardMaterial({ color: home.secondary, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.9, roughness: 0.3 }),
    frame: new THREE.MeshStandardMaterial({ color: 0xff5a1f, metalness: 0.4, roughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xdfefff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }),
    rim: new THREE.MeshStandardMaterial({ color: 0xff4d00, metalness: 0.6, roughness: 0.35, emissive: 0x401000 }),
  };
  const root = new THREE.Group();
  scene.add(root);

  // Floor
  const { tex, Lx, Lz } = courtTexture(home);
  const floorMat = new THREE.MeshPhysicalMaterial({ map: custom.courtTexture || tex, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.15, envMapIntensity: 0.6 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Lx, Lz), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // Surrounding dark ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01;
  root.add(ground);

  // Hoops
  const hoops = [-1, 1].map((side) => {
    const h = buildHoop(side, mats);
    root.add(h.group);
    return h;
  });

  // Stands with crowd (instanced)
  const standMat = new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.85 });
  const crowdGeo = new RoundedBoxGeometry(0.4, 0.5, 0.28, 2, 0.08);
  const headGeo = new THREE.SphereGeometry(0.12, 10, 8);
  const seats = [];
  const tiers = 14;
  const addStand = (cx, cz, len, rotY, startDist) => {
    for (let t = 0; t < tiers; t++) {
      const d = startDist + t * 0.85;
      const h = 0.25 + t * 0.42;
      const step = new THREE.Mesh(new THREE.BoxGeometry(len + t * 1.7, h, 0.85), standMat);
      const off = new THREE.Vector3(0, h / 2, d).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      step.position.set(cx + off.x, off.y, cz + off.z);
      step.rotation.y = rotY;
      step.receiveShadow = true;
      root.add(step);
      const n = Math.floor((len + t * 1.7) / 0.55);
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.08) continue;
        const lx = -((len + t * 1.7) / 2) + (i + 0.5) * 0.55 + (Math.random() - 0.5) * 0.1;
        const p = new THREE.Vector3(lx, h + 0.3, d).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        seats.push({ x: cx + p.x, y: p.y, z: cz + p.z, rot: rotY, phase: Math.random() * 10 });
      }
    }
  };
  addStand(0, 0, 32, 0, C.HALF_W + APRON + 2.4); // near side (behind camera)
  addStand(0, 0, 32, Math.PI, C.HALF_W + APRON + 1.2); // far side
  addStand(0, 0, 18, Math.PI / 2, C.HALF_L + APRON + 2.2);
  addStand(0, 0, 18, -Math.PI / 2, C.HALF_L + APRON + 2.2);

  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, seats.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), seats.length);
  const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac'];
  const dummy = new THREE.Object3D();
  const palette = [home.primary, home.primary, home.secondary, '#e8e8e8', '#2a2a2a', '#3a4a6a', '#8a3a3a', away.primary, '#c9c9c9', '#555'];
  const col = new THREE.Color();
  seats.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.rot, 0);
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    col.set(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(0.55 + Math.random() * 0.3);
    crowd.setColorAt(i, col);
    dummy.position.y += 0.38;
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    col.set(skins[Math.floor(Math.random() * skins.length)]);
    heads.setColorAt(i, col);
  });
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(crowd, heads);

  // Courtside LED ribbon boards
  const ribbons = [];
  const makeRibbon = (len, x, z, rotY) => {
    const { canvas, tex: rt } = textCanvas(2048, 64, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, home.primary); grad.addColorStop(0.5, home.secondary); grad.addColorStop(1, home.primary);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.font = '900 40px "Arial Black", Impact, sans-serif';
      g.textBaseline = 'middle';
      const msgs = ['2K POWER PLAY', `${home.city.toUpperCase()} ${home.name.toUpperCase()}`, 'DEFENSE!', 'MAKE SOME NOISE', `VS ${away.name.toUpperCase()}`];
      let xx = 20;
      for (let i = 0; xx < w; i++) { const m = msgs[i % msgs.length]; g.fillText(m, xx, h / 2); xx += g.measureText(m).width + 90; }
    });
    rt.wrapS = THREE.RepeatWrapping;
    rt.repeat.set(len / 16, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 0.2), [
      standMat, standMat, standMat, standMat,
      new THREE.MeshStandardMaterial({ map: rt, emissive: 0xffffff, emissiveMap: rt, emissiveIntensity: 1.4 }), standMat,
    ]);
    m.position.set(x, 0.35, z);
    m.rotation.y = rotY;
    root.add(m);
    ribbons.push(rt);
    void canvas;
  };
  makeRibbon(30, 0, -(C.HALF_W + APRON - 0.3), 0);
  makeRibbon(14, -(C.HALF_L + APRON + 0.6), 0, Math.PI / 2);
  makeRibbon(14, C.HALF_L + APRON + 0.6, 0, -Math.PI / 2);

  // Scorer's table on near side
  const table = new THREE.Mesh(new RoundedBoxGeometry(8, 0.8, 0.7, 3, 0.05), new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.4 }));
  table.position.set(0, 0.4, C.HALF_W + APRON - 0.2);
  root.add(table);

  // Jumbotron
  const jumbo = textCanvas(1024, 512, () => {});
  const jumboMat = new THREE.MeshStandardMaterial({ map: jumbo.tex, emissive: 0xffffff, emissiveMap: jumbo.tex, emissiveIntensity: 0.9 });
  const jumboBox = new THREE.Group();
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0d, metalness: 0.6, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.9), jumboMat);
    const a = i * Math.PI / 2;
    screen.position.set(Math.sin(a) * 2.62, 0, Math.cos(a) * 2.62);
    screen.rotation.y = a;
    jumboBox.add(screen);
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.1, 5.2), darkMat);
  jumboBox.add(core);
  const ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.35, 48, 1, true), new THREE.MeshStandardMaterial({ color: home.primary, emissive: home.primary, emissiveIntensity: 1.2, side: THREE.DoubleSide }));
  ringMesh.position.y = -1.75;
  jumboBox.add(ringMesh);
  jumboBox.position.set(0, 13.5, 0);
  root.add(jumboBox);

  placeCustomArena(root);

  // Lighting: bright arena wash
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.55));
  const key = new THREE.DirectionalLight(0xfff4e5, 1.7);
  key.position.set(6, 22, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -18; sc.right = 18; sc.top = 12; sc.bottom = -12; sc.near = 5; sc.far = 50;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6);
  fill.position.set(-8, 18, -10);
  scene.add(fill);
  for (const x of [-9, 0, 9]) {
    const sp = new THREE.SpotLight(0xffffff, 55, 30, 0.7, 0.6, 1.4);
    sp.position.set(x, 16, 0);
    sp.target.position.set(x, 0, 0);
    scene.add(sp); scene.add(sp.target);
  }
  // Ceiling light rig (emissive panels)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = -3; i <= 3; i++) {
    for (const z of [-8, 8]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.6), lampMat);
      lamp.position.set(i * 4.5, 19, z);
      root.add(lamp);
    }
  }

  return {
    hoops,
    crowd, seats, dummy,
    ribbons,
    jumbo, jumboBox,
    excitement: 0,
    update(dt, t) {
      for (const r of ribbons) r.offset.x = (r.offset.x + dt * 0.04) % 1;
      jumboBox.rotation.y += dt * 0.05;
      this.excitement = Math.max(0, this.excitement - dt * 0.4);
      // Crowd bob
      const amp = 0.03 + this.excitement * 0.35;
      const step = Math.max(1, Math.floor(seats.length / 1500));
      const off = Math.floor(t * 60) % step;
      for (let i = off; i < seats.length; i += step) {
        const s = seats[i];
        const bob = Math.max(0, Math.sin(t * (4 + this.excitement * 6) + s.phase)) * amp;
        dummy.position.set(s.x, s.y + bob, s.z);
        dummy.rotation.set(0, s.rot, 0);
        dummy.updateMatrix();
        crowd.setMatrixAt(i, dummy.matrix);
        dummy.position.y += 0.38;
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
      }
      crowd.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
    },
    drawJumbo(state) {
      const g = jumbo.canvas.getContext('2d');
      const w = 1024, h = 512;
      g.fillStyle = '#05070c'; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const teams = [state.away, state.home];
      teams.forEach((t, i) => {
        const cx = i === 0 ? 256 : 768;
        g.fillStyle = t.primary; g.fillRect(cx - 230, 30, 460, 90);
        g.fillStyle = '#fff'; g.font = '900 64px "Arial Black", Impact, sans-serif';
        g.fillText(t.id, cx, 78);
        g.font = '900 200px "Arial Black", Impact, sans-serif';
        g.fillText(String(t.score), cx, 270);
      });
      g.fillStyle = '#ffd60a'; g.font = '900 64px "Arial Black", Impact, sans-serif';
      g.fillText(state.clockText, 512, 440);
      g.fillStyle = '#9aa4b8'; g.font = '700 48px Arial, sans-serif';
      g.fillText(state.periodText, 512, 370);
      jumbo.tex.needsUpdate = true;
    },
  };
}
