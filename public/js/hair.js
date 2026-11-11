// Hair styles. Everything is built around a unit "skull" (a sphere of radius 1 centred in the head: +y up, +z toward the face)
// and the whole group is scaled to the real head, so the hair hugs the skull instead of sitting on it like a hat.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
    case 3: // High top: faded sides and a flat top
      if (cap) shell(fadeMat, 1.090, 0.45, 0.5);
      add(new RoundedBoxGeometry(1.95, 0.7, 1.75, 3, 0.26), hairMat, 0, 0.84, -0.06);
      break;
    case 4: // Afro: a full round crown that clears the face
      if (cap) shell(hairMat, 1.110, 0.45, 0.5);
      add(new THREE.SphereGeometry(1, 32, 24), hairMat, 0, 0.5, -0.36).scale.set(1.5, 1.32, 1.38);
      break;
    case 5: { // Mohawk: shaved sides and a ridge from the forehead to the nape
      if (cap) shell(fadeMat, 1.080, 0.45, 0.5);
      for (let i = 0; i < 10; i++) {
        const a = -2.1 + i * (3.0 / 9);
        const n = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
        const m = add(new THREE.SphereGeometry(1, 16, 12), hairMat, 0, n.y * 1.12, n.z * 1.12);
        m.scale.set(0.2, 0.4 + 0.1 * Math.sin((i / 9) * Math.PI), 0.34);
        m.rotation.x = a;
      }
      break;
    }
    case 6: { // Locs: strands that start at the scalp and hang down around the back and sides
      if (cap) shell(hairMat, 1.110, 0.46, 0.5);
      for (let i = 0; i < 40; i++) {
        const phi = THREE.MathUtils.degToRad(62 + (i / 39) * 236);          // around the back, leaving the face and temples clear
        const th = (0.37 + rnd() * 0.07) * Math.PI;
        const rr = 1.08 * Math.sin(th), yy = 1.08 * Math.cos(th);
        const len = 0.7 + rnd() * 0.8;
        const m = add(new THREE.CapsuleGeometry(0.052, len, 3, 8), hairMat, Math.sin(phi) * rr, yy - len / 2, Math.cos(phi) * rr);
        m.rotation.set(Math.cos(phi) * 0.18, 0, -Math.sin(phi) * 0.18);       // flare slightly away from the head
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
      for (let tries = 0; tries < 400 && made < 54; tries++) {
        const th = rnd() * 0.46 * Math.PI, phi = rnd() * Math.PI * 2;
        const y = Math.cos(th);
        if (Math.abs(((phi + Math.PI) % (Math.PI * 2)) - Math.PI) < 1.1 && y < 0.62) continue; // keep the forehead clear
        const rad = 0.26 + rnd() * 0.08;
        add(new THREE.SphereGeometry(rad, 10, 8), hairMat, 1.0 * Math.sin(th) * Math.sin(phi), y * 1.02 - 0.02, 1.0 * Math.sin(th) * Math.cos(phi) - 0.08);
        made++;
      }
      break;
    }
    default: break;
  }
  return g;
}
