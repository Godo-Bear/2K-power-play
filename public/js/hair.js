// Hair styles. Builds hair geometry around a head of radius `r`, in head space:
// origin = centre of the head, +y up, +z toward the face.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const HAIR_STYLES = ['Bald', 'Buzz Cut', 'Short', 'High Top', 'Afro', 'Mohawk', 'Locs', 'Top Bun', 'Cornrows', 'Curly Top'];

// How the model's own scalp hair should be coloured for each style: 'skin' (bald), 'buzz' (faint), or 'hair'
export function scalpTint(style) { return style === 0 ? 'skin' : style === 1 ? 'buzz' : 'hair'; }

// Small deterministic random so a style looks the same every time
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s & 0xffff) / 0xffff; }; }

// `cap: true` also adds the scalp layer (for heads that have no hair of their own)
export function buildHair(style, color, r, { cap = false } = {}) {
  const g = new THREE.Group();
  if (style === 0) return g;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
  const add = (geo, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x * r, y * r, z * r);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  if (cap) {
    const thick = style === 1 ? 1.02 : 1.07;
    const capMat = style === 1 ? new THREE.MeshStandardMaterial({ color, roughness: 0.95, transparent: true, opacity: 0.55 }) : mat;
    const c = new THREE.Mesh(new THREE.SphereGeometry(r * thick, 20, 14, 0, Math.PI * 2, 0, Math.PI * (style === 1 ? 0.46 : 0.52)), capMat);
    c.position.set(0, 0.04 * r, -0.06 * r);
    c.rotation.x = -0.18;
    g.add(c);
  }
  switch (style) {
    case 3: // High top
      add(new RoundedBoxGeometry(1.5 * r, 0.85 * r, 1.45 * r, 3, 0.16 * r), 0, 0.98, -0.05);
      break;
    case 4: // Afro
      add(new THREE.SphereGeometry(1.24 * r, 20, 16), 0, 0.56, -0.24);
      break;
    case 5: { // Mohawk
      const m = add(new THREE.SphereGeometry(r, 16, 12), 0, 0.82, -0.12);
      m.scale.set(0.2, 0.62, 1.02);
      break;
    }
    case 6: { // Locs
      const geo = new THREE.CapsuleGeometry(0.105 * r, 0.95 * r, 3, 8);
      for (let i = 0; i < 17; i++) {
        const a = THREE.MathUtils.degToRad(48 + (i / 16) * 264);
        const m = add(geo, Math.sin(a) * 0.97, -0.02 - (i % 2) * 0.12, Math.cos(a) * 0.97);
        m.rotation.set(Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12);
      }
      const top = add(new THREE.SphereGeometry(1.08 * r, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.06, -0.08);
      top.rotation.x = -0.2;
      break;
    }
    case 7: { // Top bun
      add(new THREE.SphereGeometry(0.4 * r, 14, 12), 0, 1.14, -0.3);
      const band = add(new THREE.TorusGeometry(0.2 * r, 0.06 * r, 8, 16), 0, 0.92, -0.26);
      band.rotation.x = Math.PI / 2 - 0.25;
      break;
    }
    case 8: // Cornrows
      for (const x of [-0.62, -0.32, 0, 0.32, 0.62]) {
        const R = Math.sqrt(Math.max(0.05, 1 - x * x)) * 1.03 * r;
        const m = add(new THREE.TorusGeometry(R, 0.075 * r, 6, 22, Math.PI * 1.08), x, 0.02, -0.04);
        m.rotation.set(0, Math.PI / 2, 0);
        m.rotation.order = 'YXZ';
        m.rotation.x = -0.32;
      }
      break;
    case 9: { // Curly top
      const rnd = rng(77);
      const geo = new THREE.SphereGeometry(0.3 * r, 10, 8);
      for (let i = 0; i < 18; i++) {
        const a = rnd() * Math.PI * 2, e = rnd() * 0.75;
        add(geo, Math.sin(a) * e * 0.85, 0.82 + (1 - e) * 0.32, Math.cos(a) * e * 0.85 - 0.1);
      }
      break;
    }
    default: break; // 1 buzz, 2 short: scalp layer only
  }
  return g;
}
