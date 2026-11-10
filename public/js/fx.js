// Visual effects: glow particles (ball trails, fire, sparks), crowd camera flashes and confetti.
import * as THREE from 'three';

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

const r2 = () => Math.random() - 0.5;

class Particles {
  constructor(scene, count, size) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.i = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    for (let k = 0; k < count; k++) this.pos[k * 3 + 1] = -100;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, g, b, life, grav = 0) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    const j = k * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = r; this.base[j + 1] = g; this.base[j + 2] = b;
    this.life[k] = this.max[k] = life;
    this.grav[k] = grav;
  }

  update(dt) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      const j = k * 3;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[j + 1] = -100; this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      this.vel[j + 1] -= this.grav[k] * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = this.life[k] / this.max[k];
      this.col[j] = this.base[j] * f; this.col[j + 1] = this.base[j + 1] * f; this.col[j + 2] = this.base[j + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, arena) {
    this.scene = scene;
    this.arena = arena;
    this.glow = new Particles(scene, 500, 0.32);
    this.flash = new Particles(scene, 160, 1.5);
    this.flashT = 0;
    this.flashRate = 0.6; // ambient flashes per second
    this.burst = 0;
    this.confetti = null;
    this.conf = [];
  }

  // Trail behind the ball while a shot is in the air
  ballTrail(pos, onFire) {
    const r = () => (Math.random() - 0.5);
    if (onFire) {
      for (let i = 0; i < 3; i++) this.glow.emit(pos.x + r() * 0.1, pos.y + r() * 0.1, pos.z + r() * 0.1, r() * 0.6, 0.6 + Math.random(), r() * 0.6, 1, 0.35 + Math.random() * 0.3, 0.05, 0.45);
    } else {
      // A clear glowing streak so every shot is easy to follow
      this.glow.emit(pos.x, pos.y, pos.z, 0, 0, 0, 1, 0.82, 0.5, 0.4);
      this.glow.emit(pos.x + r() * 0.06, pos.y + r() * 0.06, pos.z + r() * 0.06, 0, 0, 0, 0.9, 0.6, 0.25, 0.28);
    }
  }

  // Expanding ring on the floor under a shooter, plus a burst at the release point
  shotPulse(p, color = [1, 0.85, 0.4]) {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      this.glow.emit(p.pos.x + Math.cos(a) * 0.45, 0.06, p.pos.z + Math.sin(a) * 0.45, Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6, color[0], color[1], color[2], 0.45);
    }
    const h = p.data.height * 1.15 + p.y;
    for (let i = 0; i < 10; i++) this.glow.emit(p.pos.x, h, p.pos.z, r2() * 1.6, 0.5 + Math.random() * 1.5, r2() * 1.6, 1, 1, 0.9, 0.3);
  }

  // Flames around a player who is on fire
  playerFire(p) {
    const r = () => (Math.random() - 0.5);
    this.glow.emit(p.pos.x + r() * 0.5, p.y + 0.1 + Math.random() * 0.4, p.pos.z + r() * 0.5, r() * 0.3, 1.2 + Math.random(), r() * 0.3, 1, 0.3 + Math.random() * 0.3, 0.04, 0.5);
  }

  sparks(pos, color = [1, 0.8, 0.4], n = 26) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
      this.glow.emit(pos.x, pos.y, pos.z, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, color[0], color[1], color[2], 0.5 + Math.random() * 0.4, 9);
    }
  }

  // Camera flashes popping in the stands
  crowdFlashes(n) { this.burst += n; }

  celebrate(colors) {
    if (this.confetti) return;
    const N = 420;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.09), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      this.conf.push({
        x: (Math.random() - 0.5) * 30, y: 10 + Math.random() * 14, z: (Math.random() - 0.5) * 17,
        vy: 1.2 + Math.random() * 1.6, rx: Math.random() * 6, ry: Math.random() * 6, sp: 2 + Math.random() * 5, ph: Math.random() * 6,
      });
      c.set(colors[i % colors.length]);
      mesh.setColorAt(i, c);
    }
    mesh.frustumCulled = false;
    this.confetti = mesh;
    this.scene.add(mesh);
    this.dummy = new THREE.Object3D();
  }

  update(dt, t) {
    this.glow.update(dt);
    // Flashes
    const seats = this.arena.seats;
    this.flashT += dt * (this.flashRate + this.arena.excitement * 6);
    let n = Math.floor(this.flashT); this.flashT -= n;
    const extra = Math.min(this.burst, Math.ceil(this.burst * dt * 6));
    this.burst -= extra; n += extra;
    for (let i = 0; i < n && seats.length; i++) {
      const s = seats[Math.floor(Math.random() * seats.length)];
      this.flash.emit(s.x, s.y + 0.5, s.z, 0, 0, 0, 1, 1, 1, 0.09 + Math.random() * 0.08);
    }
    this.flash.update(dt);
    // Confetti
    if (this.confetti) {
      const d = this.dummy;
      this.conf.forEach((q, i) => {
        q.y -= q.vy * dt;
        if (q.y < 0.05) { q.y = 0.05; } else { q.rx += q.sp * dt; q.ry += q.sp * 0.7 * dt; q.x += Math.sin(t * 2 + q.ph) * dt * 0.8; }
        d.position.set(q.x, q.y, q.z);
        d.rotation.set(q.rx, q.ry, 0);
        d.updateMatrix();
        this.confetti.setMatrixAt(i, d.matrix);
      });
      this.confetti.instanceMatrix.needsUpdate = true;
    }
  }
}
