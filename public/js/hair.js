// Hair styles. Everything is built around a unit "skull" (a sphere of radius 1 centred in the head: +y up, +z toward the face)
// and the whole group is scaled to the real head, so the hair hugs the skull instead of sitting on it like a hat.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HAIR_STYLES = ['Bald', 'Buzz Cut', 'Short', 'High Top', 'Afro', 'Mohawk', 'Locs', 'Top Bun', 'Cornrows', 'Curly Top'];

// How the model's own scalp hair should be coloured for each style: 'skin' (bald), 'buzz' (faint), or 'hair'
export function scalpTint(style) { return style === 0 ? 'skin' : style === 1 ? 'buzz' : 'hair'; }

// Small deterministic random so a style looks the same every time
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s & 0xffff) / 0xffff; }; }

// Fine vertical streaks, so the hair has the look of strands instead of smooth plastic
let strandTex = null;
function strandTexture() {
  if (strandTex) return strandTex;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  const rnd = rng(11);
  for (let x = 0; x < 256; x += 2) {
    const l = 165 + Math.floor(rnd() * 90);
    g.fillStyle = `rgb(${l},${l},${l})`;
    g.fillRect(x, 0, 2, 128);
  }
  for (let i = 0; i < 300; i++) {
    const l = rnd() < 0.5 ? 70 : 255;
    g.strokeStyle = `rgba(${l},${l},${l},0.14)`;
    g.lineWidth = 1;
    const x = rnd() * 256;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 8, 128); g.stroke();
  }
  strandTex = new THREE.CanvasTexture(cv);
  strandTex.wrapS = strandTex.wrapT = THREE.RepeatWrapping;
  strandTex.colorSpace = THREE.SRGBColorSpace;
  strandTex.repeat.set(2, 1);
  return strandTex;
}
const material = (color, rough = 0.78) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, map: strandTexture() });

// `r` is the skull radius when no `dims` are given. `dims` ({ rx, ry, rz }) fits the hair to a head that isn't round.
// `cap: true` also adds the scalp layer (for heads that have no hair of their own).
export function buildHair(style, color, r, { cap = false, skin = '#c68642', dims = null } = {}) {
  const g = new THREE.Group();
  g.scale.set(dims ? dims.rx : r, dims ? dims.ry : r, dims ? dims.rz : r);
  if (style === 0) return g;
  const hairMat = material(color);
  // Shaved sides (fades, buzz cuts): the hair colour fading toward the skin
  const fadeMat = material(new THREE.Color(skin).lerp(new THREE.Color(color), 0.72), 0.95);
  const buzzMat = material(new THREE.Color(skin).lerp(new THREE.Color(color), 0.8), 0.95);
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // The scalp layer: a shell over the top and back of the skull, tilted so the hairline sits at the top of the forehead
  const shell = (mat, thick = 1.06, theta = 0.45, tilt = 0.5) => {
    const m = add(new THREE.SphereGeometry(thick, 32, 20, 0, Math.PI * 2, 0, Math.PI * theta), mat);
    m.rotation.x = -tilt;
    return m;
  };
  const rnd = rng(7 + style);

  switch (style) {
    case 1: // Buzz cut: a very thin layer
      if (cap) shell(buzzMat, 1.075, 0.46, 0.5);
      break;
    case 2: // Short (only when the model has no hair of its own)
      if (cap) shell(hairMat, 1.120, 0.46, 0.5);
      break;
    case 3: { // High top: faded sides and a rounded, tall flat-top (a lathed column, no hard box edges)
      if (cap) shell(fadeMat, 1.090, 0.45, 0.5);
      const prof = [[0, 0.5], [0.96, 0.5], [0.99, 0.7], [0.96, 1.0], [0.9, 1.14], [0.8, 1.22], [0.6, 1.27], [0, 1.29]].map(([x, y]) => new THREE.Vector2(x, y));
      const col = add(new THREE.LatheGeometry(prof, 28), hairMat, 0, 0, -0.05);
      col.scale.set(1.0, 1.0, 0.96);
      break;
    }
    case 4: { // Afro: a soft, slightly irregular round crown that leaves the forehead clear
      if (cap) shell(hairMat, 1.100, 0.45, 0.5);
      const core = add(new THREE.SphereGeometry(1, 20, 14), hairMat, 0, 0.62, -0.36);
      core.scale.set(1.3, 1.14, 1.22);
      // Small puffs around the outline give a soft, fluffy edge instead of a smooth helmet
      for (let i = 0; i < 46; i++) {
        const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2, sq = Math.sqrt(1 - u * u);
        const nx = sq * Math.sin(phi), ny = u, nz = sq * Math.cos(phi);
        if (nz > 0.45 && ny < 0.55) continue;                 // keep the face clear
        if (ny < -0.25) continue;
        const rad = 0.13 + rnd() * 0.08;
        add(new THREE.SphereGeometry(rad, 6, 4), hairMat, nx * 1.24, 0.62 + ny * 1.08, -0.36 + nz * 1.16);
      }
      break;
    }
    case 5: { // Mohawk: shaved sides and one smooth fin from the forehead to the nape
      if (cap) shell(fadeMat, 1.080, 0.45, 0.5);
      const shape = new THREE.Shape();
      const top = [], base = [];
      for (let k = 0; k <= 16; k++) {
        const a = 0.95 - (k / 16) * 3.05;                       // from the forehead, over the crown, down the back
        const hh = 0.18 + 0.32 * Math.sin((k / 16) * Math.PI);  // a fin that rises toward the middle
        top.push([(1.02 + hh) * Math.sin(a), (1.02 + hh) * Math.cos(a)]);
        base.push([0.98 * Math.sin(a), 0.98 * Math.cos(a)]);
      }
      shape.moveTo(base[0][0], base[0][1]);
      top.forEach(([x, y]) => shape.lineTo(x, y));
      for (let k = base.length - 1; k >= 0; k--) shape.lineTo(base[k][0], base[k][1]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 3, curveSegments: 8 });
      geo.rotateY(-Math.PI / 2);
      geo.translate(0.17, 0, 0);
      add(geo, hairMat);
      break;
    }
    case 6: { // Locs: thin strands that start at the scalp and hang down around the back and sides
      if (cap) shell(hairMat, 1.100, 0.46, 0.5);
      for (let i = 0; i < 60; i++) {
        const phi = THREE.MathUtils.degToRad(58 + (i / 59) * 244 + (rnd() - 0.5) * 6);   // around the back, leaving the face and temples clear
        const th = (0.3 + rnd() * 0.16) * Math.PI;
        const rr = 1.07 * Math.sin(th), yy = 1.07 * Math.cos(th);
        const len = 0.55 + rnd() * 0.75;
        const out = 0.14 + rnd() * 0.1, sway = (rnd() - 0.5) * 0.12;
        const dx = Math.sin(phi), dz = Math.cos(phi);
        const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(dx * (rr + out * t * t) + sway * t, yy - len * t, dz * (rr + out * t * t)));
        add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.05 - 0.012 * rnd(), 4, false), hairMat);
      }
      break;
    }
    case 7: { // Top bun: slicked back with a bun and a tie
      if (cap) shell(hairMat, 1.110, 0.47, 0.62);
      add(new THREE.SphereGeometry(0.42, 20, 16), hairMat, 0, 1.12, -0.4);
      const band = add(new THREE.TorusGeometry(0.3, 0.055, 8, 18), material('#e63946', 0.6), 0, 0.88, -0.36);
      band.rotation.x = Math.PI / 2 - 0.35;
      break;
    }
    case 8: { // Cornrows: braids running front to back along a close-cropped scalp
      if (cap) shell(fadeMat, 1.080, 0.45, 0.5);
      for (const u of [-0.74, -0.5, -0.25, 0, 0.25, 0.5, 0.74]) {
        const s = Math.sqrt(1 - u * u), pts = [];
        for (let k = 0; k <= 14; k++) {
          const a = -2.0 + k * (2.9 / 14);
          pts.push(new THREE.Vector3(u * 1.04, 1.045 * s * Math.cos(a), 1.045 * s * Math.sin(a)));
        }
        add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.055, 6, false), hairMat);
      }
      break;
    }
    case 9: { // Curly top: tight curls packed over the crown
      if (cap) shell(hairMat, 1.090, 0.45, 0.5);
      let made = 0;
      for (let tries = 0; tries < 900 && made < 120; tries++) {
        const th = rnd() * 0.47 * Math.PI, phi = rnd() * Math.PI * 2;
        const y = Math.cos(th);
        if (Math.abs(((phi + Math.PI) % (Math.PI * 2)) - Math.PI) < 1.05 && y < 0.7) continue; // keep the forehead clear
        const rad = 0.15 + rnd() * 0.07;
        add(new THREE.SphereGeometry(rad, 6, 4), hairMat, 1.02 * Math.sin(th) * Math.sin(phi), y * 1.03, 1.02 * Math.sin(th) * Math.cos(phi) - 0.06);
        made++;
      }
      break;
    }
    default: break;
  }
  return mergeByMaterial(g);
}

// One draw call per material instead of one per curl, loc or puff
function mergeByMaterial(g) {
  const byMat = new Map();
  g.children.forEach((m) => { if (!byMat.has(m.material)) byMat.set(m.material, []); byMat.get(m.material).push(m); });
  const merged = [];
  for (const [mat, meshes] of byMat) {
    const geos = meshes.map((m) => { m.updateMatrix(); const ge = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); ge.applyMatrix4(m.matrix); for (const k of Object.keys(ge.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ge.deleteAttribute(k); return ge; });
    const geo = mergeGeometries(geos, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    merged.push(mesh);
  }
  g.clear();
  merged.forEach((m) => g.add(m));
  return g;
}
