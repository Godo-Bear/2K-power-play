import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { C } from './arena.js';
import { buildHair } from './hair.js';

const tmpV = new THREE.Vector3();
const d_height = (p) => p.data.height; // the overhead marker sits just above the head (root already includes the jump)

function numberTexture(num, fg, bg, name) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (name) {
    g.fillStyle = fg; g.font = '900 34px "Arial Black", Impact, sans-serif';
    g.fillText(name.toUpperCase(), 128, 52);
  }
  g.font = '900 140px "Arial Black", Impact, sans-serif';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.strokeText(String(num), 128, name ? 150 : 135);
  g.fillStyle = fg;
  g.fillText(String(num), 128, name ? 150 : 135);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function limb(len, rTop, rBot, mat) {
  const pivot = new THREE.Group();
  const geo = new THREE.CapsuleGeometry((rTop + rBot) / 2, len - (rTop + rBot), 4, 10);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  pivot.add(m);
  const end = new THREE.Group();
  end.position.y = -len;
  pivot.add(end);
  return { pivot, end, mesh: m };
}

export class Player {
  constructor(data, team, index, scene) {
    this.data = data;
    this.r = data.ratings;
    this.team = team;
    this.index = index;
    this.name = `${data.first} ${data.last}`;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.facing = 0;
    this.targetFacing = 0;
    this.y = 0; // jump height
    this.jumpT = -1; this.jumpDur = 0.7; this.jumpPeak = 0.75;
    this.state = 'idle';
    this.actionT = 0;
    this.stumbleT = 0;
    this.burstT = 0;
    this.stealCooldown = 0;
    this.phase = Math.random() * 6;
    this.stamina = 1;
    this.energy = 1;     // long-term fatigue: drains on court, recovers on the bench
    this.streak = 0;     // consecutive made field goals
    this.onFire = false;
    this.fouledOut = false;
    this.starter = !data.bench;
    this.sprinting = false;
    this.stats = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, to: 0, pf: 0, sec: 0 };
    this.build(scene);
  }

  get maxSpeed() { return (4.6 + this.r.speed * 0.022) * (0.84 + 0.16 * this.energy); }

  build(scene) {
    const d = this.data, t = this.team.data;
    const s = d.height / 2.0;
    const skin = new THREE.MeshStandardMaterial({ color: d.skin, roughness: 0.55 });
    const jersey = new THREE.MeshStandardMaterial({ color: this.team.jerseyColor, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: this.team.trimColor, roughness: 0.6 });
    const shoe = new THREE.MeshStandardMaterial({ color: this.index % 2 ? '#ffffff' : t.secondary, roughness: 0.4 });
    const hairMat = new THREE.MeshStandardMaterial({ color: d.hair, roughness: 0.9 });

    const root = new THREE.Group();
    const body = new THREE.Group(); // rotates with facing
    root.add(body);
    this.root = root; this.body = body;
    body.scale.setScalar(s);

    // Hips
    const hips = new THREE.Group();
    hips.position.y = 1.0;
    body.add(hips);
    this.hips = hips;
    const shorts = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.34, 0.26, 3, 0.06), jersey);
    shorts.position.y = -0.08; shorts.castShadow = true;
    hips.add(shorts);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.3, 0.04), trim);
    stripe.position.set(0, -0.08, 0); stripe.scale.set(1.0, 1, 7);
    stripe.visible = false;
    // Torso
    const torso = new THREE.Group();
    torso.position.y = 0.08;
    hips.add(torso);
    this.torso = torso;
    const chest = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.58, 0.25, 3, 0.07), jersey);
    chest.position.y = 0.3; chest.castShadow = true;
    torso.add(chest);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshStandardMaterial({ map: numberTexture(d.number, this.team.trimColor, this.team.jerseyColor), roughness: 0.6 }));
    front.position.set(0, 0.32, 0.127);
    torso.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshStandardMaterial({ map: numberTexture(d.number, this.team.trimColor, this.team.jerseyColor, d.last), roughness: 0.6 }));
    back.position.set(0, 0.32, -0.127); back.rotation.y = Math.PI;
    torso.add(back);
    // Neck & head
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), skin);
    neck.position.y = 0.64; torso.add(neck);
    const head = new THREE.Group();
    head.position.y = 0.8; torso.add(head);
    this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin);
    skull.scale.set(0.92, 1.08, 1); skull.castShadow = true;
    head.add(skull);
    // Hair (shared styles with the 3D-model players)
    head.add(buildHair(d.hairStyle ?? 2, d.hair, 0.115, { cap: true, skin: d.skin }));
    if (d.headband) {
      const hb = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.018, 8, 24), trim);
      hb.rotation.x = Math.PI / 2; hb.position.y = 0.04;
      head.add(hb);
    }
    // Arms
    const mkArm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.29, 0.52, 0);
      torso.add(sh);
      const upper = limb(0.32, 0.065, 0.055, d.sleeve && side > 0 ? trim : skin);
      sh.add(upper.pivot);
      const lower = limb(0.3, 0.05, 0.045, skin);
      upper.end.add(lower.pivot);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
      hand.position.y = -0.04;
      lower.end.add(hand);
      return { shoulder: sh, upper: upper.pivot, elbow: lower.pivot, hand };
    };
    this.armL = mkArm(-1); this.armR = mkArm(1);
    // Legs
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.12, -0.12, 0);
      hips.add(hip);
      const thigh = limb(0.46, 0.085, 0.07, skin);
      hip.add(thigh.pivot);
      const shortLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.24, 12), jersey);
      shortLeg.position.y = -0.1; thigh.pivot.add(shortLeg);
      const shin = limb(0.44, 0.065, 0.05, skin);
      thigh.end.add(shin.pivot);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.14, 10), new THREE.MeshStandardMaterial({ color: '#f2f2f2' }));
      sock.position.y = -0.38; shin.pivot.add(sock);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.09, 0.27, 2, 0.035), shoe);
      foot.position.set(0, -0.04, 0.06); foot.castShadow = true;
      shin.end.add(foot);
      return { hip: thigh.pivot, knee: shin.pivot };
    };
    this.legL = mkLeg(-1); this.legR = mkLeg(1);

    // Marker for the player you control: a bright double ring on the floor, a facing arrow,
    // and a bobbing pointer with a "YOU" tag above the head that always draws on top.
    const mk = new THREE.MeshBasicMaterial({ color: 0x35f0ff, transparent: true, opacity: 0.95, depthWrite: false });
    this.markerMat = mk;
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.74, 48), mk);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.9, 48), mk);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.58, 32), new THREE.MeshBasicMaterial({ color: 0x35f0ff, transparent: true, opacity: 0.2, depthWrite: false }));
    this.markerGlow = glow.material;
    for (const m of [glow, ring, ring2]) { m.rotation.x = -Math.PI / 2; this.marker.add(m); }
    this.markerRing2 = ring2;
    this.marker.position.y = 0.014;
    this.marker.visible = false;
    root.add(this.marker);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 3), mk);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.015, 1.05);
    this.markerArrow = arrow;
    this.markerPivot = new THREE.Group();
    this.markerPivot.add(arrow);
    this.markerPivot.visible = false;
    root.add(this.markerPivot);
    // Overhead pointer
    const top = new THREE.MeshBasicMaterial({ color: 0x35f0ff, transparent: true, opacity: 0.98, depthTest: false, depthWrite: false });
    this.markerTopMat = top;
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 4), top);
    pointer.rotation.x = Math.PI; // tip down
    pointer.renderOrder = 30;
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 48;
    const g = cv.getContext('2d');
    g.font = '900 34px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(3,10,20,0.9)'; g.strokeText('YOU', 64, 25);
    g.fillStyle = '#ffffff'; g.fillText('YOU', 64, 25);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, depthWrite: false, transparent: true }));
    tag.scale.set(0.95, 0.36, 1);
    tag.position.y = 0.36;
    tag.renderOrder = 31;
    this.markerTop = new THREE.Group();
    this.markerTop.add(pointer, tag);
    this.markerTop.visible = false;
    root.add(this.markerTop);
    // Soft contact shadow
    const cs = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    cs.rotation.x = -Math.PI / 2; cs.position.y = 0.006;
    root.add(cs);
    this.contactShadow = cs;

    scene.add(root);
  }

  setControlled(on, color = 0x35f0ff) {
    this.marker.visible = on;
    this.markerPivot.visible = on;
    this.markerTop.visible = on;
    this.markerMat.color.set(color);
    this.markerGlow.color.set(color);
    this.markerTopMat.color.set(color);
  }

  jump(dur = 0.7, peak = 0.75) {
    if (this.jumpT >= 0) return false;
    this.jumpT = 0; this.jumpDur = dur; this.jumpPeak = peak;
    return true;
  }
  get airborne() { return this.jumpT >= 0; }

  // Reach height of hands
  get reach() { return this.data.height * 1.33 + this.y; }

  handWorld(right = true, out = tmpV) {
    (right ? this.armR : this.armL).hand.getWorldPosition(out);
    return out;
  }

  update(dt) {
    this.stealCooldown = Math.max(0, this.stealCooldown - dt);
    for (const k of ['moveT', 'spinT', 'rhythmT', 'stealImmuneT', 'hesiT', 'passT']) if (this[k] > 0) this[k] = Math.max(0, this[k] - dt);
    this.burstT = Math.max(0, this.burstT - dt);
    this.stumbleT = Math.max(0, this.stumbleT - dt);

    // Accelerate toward desired velocity
    let max = this.maxSpeed;
    if (this.sprinting && this.stamina > 0.05) { max *= 1.32; this.stamina = Math.max(0, this.stamina - dt * 0.16); }
    else this.stamina = Math.min(1, this.stamina + dt * 0.09);
    if (this.burstT > 0) max *= 1.35;
    if (this.stumbleT > 0) max *= 0.2;
    if (this.hesiT > 0) max *= 0.22; // hesitation: freeze, then explode
    if (this.state === 'shoot') max = 0.3;
    if (this.state === 'dunk' || this.state === 'layup') max = 4.2;

    const d = this.desired;
    const dl = Math.hypot(d.x, d.z);
    const tx = dl > 0 ? d.x / Math.max(1, dl) * max : 0;
    const tz = dl > 0 ? d.z / Math.max(1, dl) * max : 0;
    const accel = this.airborne ? 1.5 : (dl > 0 ? 9 : 12);
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // Keep in bounds (small allowance outside lines)
    this.pos.x = Math.max(-C.HALF_L - 0.3, Math.min(C.HALF_L + 0.3, this.pos.x));
    this.pos.z = Math.max(-C.HALF_W - 0.3, Math.min(C.HALF_W + 0.3, this.pos.z));

    // Jump arc
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const u = this.jumpT / this.jumpDur;
      if (u >= 1) { this.jumpT = -1; this.y = 0; }
      else this.y = Math.sin(u * Math.PI) * this.jumpPeak;
    }

    // Facing
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.faceTarget) {
      this.targetFacing = Math.atan2(this.faceTarget.x - this.pos.x, this.faceTarget.z - this.pos.z);
    } else if (sp > 0.4) {
      this.targetFacing = Math.atan2(this.vel.x, this.vel.z);
    }
    let df = this.targetFacing - this.facing;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    this.facing += df * Math.min(1, dt * 8.5); // turn smoothly instead of snapping
  }

  animate(dt, ctx) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.phase += dt * (3 + sp * 1.9);
    const run = Math.min(1, sp / 5.5);
    const ph = this.phase;
    this.root.position.set(this.pos.x, this.y, this.pos.z);
    this.body.rotation.y = this.facing;
    this.contactShadow.position.y = 0.006 - this.y;
    this.contactShadow.material.opacity = 0.35 * (1 - Math.min(0.7, this.y));
    this.marker.position.y = 0.014 - this.y;
    if (this.marker.visible) {
      const pulse = 1 + Math.sin(this.phase * 0 + performance.now() * 0.006) * 0.08;
      this.markerRing2.scale.setScalar(pulse);
      this.markerTop.position.y = d_height(this) + 0.42 + Math.sin(performance.now() * 0.005) * 0.07;
    }
    this.markerPivot.position.y = -this.y;
    this.markerPivot.rotation.y = this.facing;
    this.marker.rotation.y += dt * 1.5;

    const crouch = ctx.defending ? 0.12 : (ctx.hasBall ? 0.05 : 0.02);
    // Legs: running cycle
    const swing = Math.sin(ph) * 0.9 * run;
    this.legL.hip.rotation.x = -swing - crouch * 2;
    this.legR.hip.rotation.x = swing - crouch * 2;
    this.legL.knee.rotation.x = Math.max(0, Math.sin(ph + 1.2)) * 1.3 * run + crouch * 3.5;
    this.legR.knee.rotation.x = Math.max(0, Math.sin(ph + 1.2 + Math.PI)) * 1.3 * run + crouch * 3.5;
    this.hips.position.y = 1.0 - crouch * 0.9 + Math.abs(Math.cos(ph)) * 0.05 * run;
    this.torso.rotation.x = 0.12 * run + crouch * 0.8;

    // Arms default: counter-swing
    let lS = swing * 0.9, rS = -swing * 0.9, lE = -0.5 - run * 0.6, rE = -0.5 - run * 0.6, lZ = 0.12, rZ = -0.12;
    if (ctx.defending && sp < 4.5) { lS = -0.5; rS = -0.5; lZ = 0.9; rZ = -0.9; lE = -0.3; rE = -0.3; }
    if (ctx.hasBall) {
      if (ctx.dribble) { rS = -0.55; rE = -0.6; rZ = -0.1; }
      else { lS = -1.0; rS = -1.0; lE = -1.3; rE = -1.3; lZ = -0.25; rZ = 0.25; }
    }
    if (this.state === 'shoot' || this.state === 'layup' || this.state === 'ft') {
      const u = Math.min(1, this.actionT / 0.35);
      lS = rS = -1.2 - 1.6 * u; lE = rE = -1.6 + 1.2 * u; lZ = -0.2; rZ = 0.1;
      if (ctx.released) { rS = -3.0; rE = -0.1; lS = -2.4; lE = -0.6; }
    }
    if (this.state === 'dunk') { rS = lS = -3.0; rE = lE = -0.1; lZ = 0.2; rZ = -0.2; }
    if (this.airborne && this.state !== 'shoot' && this.state !== 'dunk' && this.state !== 'layup') {
      // contest / rebound arms up
      lS = rS = -2.9; lE = rE = -0.15; lZ = 0.2; rZ = -0.2;
      this.legL.knee.rotation.x = this.legR.knee.rotation.x = 0.8;
    }
    if (this.state === 'steal') {
      // wind up (arm back), then strike (arm out at the ball)
      if (this.actionT < 0.12) { rS = 0.5; rE = -0.6; rZ = -0.3; lS = -0.2; lZ = 1.1; }
      else { rS = -1.6; rE = -0.1; rZ = -0.3; lS = 0.3; lZ = 1.1; this.torso.rotation.x = 0.35; }
    }
    if (this.stumbleT > 0) { this.torso.rotation.x = -0.4; lZ = 1.2; rZ = -1.2; }
    const L = Math.min(1, dt * 18);
    const a = this.armL, b = this.armR;
    a.upper.rotation.x += (lS - a.upper.rotation.x) * L;
    b.upper.rotation.x += (rS - b.upper.rotation.x) * L;
    a.elbow.rotation.x += (lE - a.elbow.rotation.x) * L;
    b.elbow.rotation.x += (rE - b.elbow.rotation.x) * L;
    a.shoulder.rotation.z += (lZ - a.shoulder.rotation.z) * L;
    b.shoulder.rotation.z += (rZ - b.shoulder.rotation.z) * L;
  }
}
