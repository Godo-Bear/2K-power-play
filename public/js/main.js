import { SLIDERS, PRESETS, PRESET_KEYS, presetValues, getTactics, saveTactics, resetTactics, matchPreset, tacticsNorm, traits as tacTraits } from './tactics.js';
import { cloudSync, push as cloudPush, onCloudStatus } from './cloud.js';
import { SYMBOLS, SHAPES, PALETTE, SHOE_COLORS, LOOKS, getKit, saveKit, applyAllKits } from './kit.js';
import { PERK_TEXT } from './styles.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TEAMS, DIFFICULTY } from './data.js';
import { buildArena, C } from './arena.js';
import { Game } from './game.js';
import { applyTouchPreset } from './input.js';
import { input, pollInput, setupTouch, tapAction, ACTIONS, bindings, setKey, setPad, resetBindings, keyName, padName, firstGamepad, touchLayout, saveTouchLayout, resetTouchLayout, applyTouchLayout } from './input.js';
import { initAudio, setMuted, setQuiet, sfx, startMusic, stopMusic, audioReady } from './audio.js';
import { loadCustomAssets, custom, portrait } from './assets.js';
import { Tutorial } from './tutorial.js';
import { FX } from './fx.js';
import { HAIR_STYLES } from './hair.js';
import { initAnnouncer, attachAnnouncer, sayIntro, setVoice, stopAnnouncer } from './announcer.js';
import { attachCrowd } from './crowd.js';
import * as Season from './season.js';
import { initAdmin, openAdmin } from './admin.js';
import { collectGifts, fetchAnnouncements, seenAnnouncements, markSeen } from './gifts.js';
import { auth, heartbeat, checkSession, register as authRegister, login as authLogin, logout as authLogout } from './auth.js';
import { Room, makeCode, makeRemoteInput, makeInputSender, packEvent, unpackEvent, snapshot, applySnapshot, guestFrame } from './net.js';
applyAllKits(TEAMS); // saved kit, logo and shoe customisations

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Settings (remembered per browser) ----------
const settings = { cam: 'broadcast', gfx: 'high', mute: false, home: 0, away: 3, side: 'home', diff: 'pro', q: '2', speed: 0.85, bright: 90, lock: -1, court: 'arena', voice: true, music: true, autoSubs: true };
settings.adaptive = true;
try {
  const savedSettings = JSON.parse(localStorage.getItem('pph-settings') || '{}');
  Object.assign(settings, savedSettings);
  // Phones start on Medium so they stay smooth; everything else starts on High
  if (!savedSettings.gfx && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) settings.gfx = 'medium';
} catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('pph-settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---------- Renderer ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const baseExposure = () => 0.9 * (settings.bright / 100);
const applyBrightness = () => { renderer.toneMappingExposure = baseExposure(); };
applyBrightness();

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(0, 9, 17);

let scene, arena, composer, bloomPass, renderPass, fx, sharpenPass;
let game = null;
let tutorial = null;
let attract = false;        // a CPU-vs-CPU game playing behind the menus
let session = { kind: 'quick', save: null };
let intro = null;           // pre-game cinematic state
let mode = 'menu';          // menu | game | paused | over
let lastScreen = 'menu';
let practice = null;         // practice-mode state
let careerSlot = 1;         // which of the 3 career saves is open
let online = null;          // { room, role, peer, home, away, q, playing, remote, sender, queue, acc, statsT }

// Graphics tiers. Ultra renders at 4K (3840x2160) and the browser scales it down to your screen, which smooths every edge.
const TIERS = {
  low: { dpr: 1, shadow: false, post: false, msaa: 0, shadowRes: 1024, aniso: 4 },
  medium: { dpr: 1.5, shadow: true, post: false, msaa: 0, shadowRes: 2048, aniso: 8 },
  high: { dpr: 2, shadow: true, post: true, msaa: 4, shadowRes: 2048, aniso: 8 },
  ultra: { dpr: 3, shadow: true, post: true, msaa: 4, shadowRes: 4096, aniso: 16, fourK: true },
};
let renderScale = 1;           // adaptive resolution: 1 = full quality, lower when the frame rate drops
const gfxStats = { fps: 60, ms: 16.7, w: 0, h: 0 };
function targetRatio() {
  const T = TIERS[settings.gfx] || TIERS.high;
  const w = window.innerWidth, h = window.innerHeight;
  let r = Math.min(window.devicePixelRatio || 1, T.dpr);
  if (T.fourK) r = Math.min(T.dpr, Math.max(r, 3840 / Math.max(w, h * 16 / 9))); // reach 4K even on a 1080p screen
  const maxPixels = T.fourK ? 3840 * 2160 * 1.02 : 2560 * 1440 * 1.1;
  r = Math.min(r, Math.sqrt(maxPixels / (w * h)));
  const floor = T.fourK ? 1 : 0.75;
  return Math.max(floor, r * (settings.adaptive ? renderScale : 1));
}
function applyQuality() {
  const q = TIERS[settings.gfx] ? settings.gfx : 'high';
  Game.lite = q === 'low' || q === 'medium';
  const T = TIERS[q];
  renderer.setPixelRatio(targetRatio());
  renderer.shadowMap.enabled = T.shadow;
  const aniso = Math.min(T.aniso, renderer.capabilities.getMaxAnisotropy());
  if (scene) scene.traverse((o) => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m.map && m.map.anisotropy !== aniso) { m.map.anisotropy = aniso; m.map.needsUpdate = true; }
      m.needsUpdate = true;
    });
  });
  if (arena && arena.key && arena.key.shadow.mapSize.x !== T.shadowRes) {
    arena.key.shadow.mapSize.set(T.shadowRes, T.shadowRes);
    if (arena.key.shadow.map) { arena.key.shadow.map.dispose(); arena.key.shadow.map = null; }
  }
  if (composer) for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== T.msaa) { rt.samples = T.msaa; rt.dispose(); }
  if (bloomPass) bloomPass.enabled = T.post;
  if (sharpenPass) sharpenPass.enabled = T.post;
  resize();
}

function buildWorld(home, away) {
  if (scene) scene.traverse((o) => { if (!o.isSkinnedMesh && o.geometry) o.geometry.dispose(); });
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  scene.fog = new THREE.Fog(0x05070c, 30, 70);
  scene.environment = envTex;
  scene.environmentIntensity = 0.6;
  arena = buildArena(scene, home, away, { courtStyle: settings.court });
  fx = new FX(scene, arena);
  // Multisampled half-float target: smooth edges (the canvas's own antialiasing doesn't apply to post-processing)
  const rt = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: (TIERS[settings.gfx] || TIERS.high).msaa });
  composer = new EffectComposer(renderer, rt);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // Subtle glow only on genuinely bright things (LED boards, lights, particles), not the whole court
  bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.3, 0.95);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  // A light unsharp mask after tone mapping: keeps characters and lines crisp (multisampling softens edges slightly)
  sharpenPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, amount: { value: 0.38 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float amount; varying vec2 vUv;
      void main() {
        vec2 px = 1.0 / resolution;
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 blur = (texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb) * 0.25;
        vec3 sharp = c.rgb + (c.rgb - blur) * amount;
        gl_FragColor = vec4(clamp(sharp, 0.0, 1.0), c.a);
      }`,
  });
  composer.addPass(sharpenPass);
  applyQuality();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  gfxStats.w = Math.round(w * renderer.getPixelRatio()); gfxStats.h = Math.round(h * renderer.getPixelRatio());
  if (sharpenPass) sharpenPass.uniforms.resolution.value.set(gfxStats.w, gfxStats.h);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 62 : w / h < 1.4 ? 50 : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- Screens ----------
function show(id) {
  $$('.screen').forEach((s) => s.classList.remove('show'));
  if (id) {
    const el = $(`#${id}`);
    el.classList.add('show');
    const first = el.querySelector('.tile, button.primary, button');
    if (first && input.usingGamepad) first.focus();
  }
  $('#hud').classList.toggle('show', (mode === 'game' || mode === 'paused') && !intro);
  $('#touch').classList.toggle('active', mode === 'game' && !intro);
}
const shown = () => document.querySelector('.screen.show');

$$('[data-go]').forEach((b) => b.addEventListener('click', () => {
  initAudio(); sfx.menu(); musicMaybe();
  const go = b.dataset.go;
  if (go === 'back') { stopCapture(); show(lastScreen); return; }
  if (go === 'controls' || go === 'settings') lastScreen = mode === 'paused' ? 'pause' : 'menu';
  if (go === 'select') renderSelect();
  if (go === 'controls') renderRemap();
  if (go === 'menu') renderHome();
  show(go);
}));

function musicMaybe() {
  if (!audioReady()) return;
  if (settings.music && (mode === 'menu' || mode === 'over') && !settings.mute) startMusic(); else stopMusic();
}

const crest = (t, cls = 'crest') => `<span class="${cls} shape-${(t.logo && t.logo.shape) || 'circle'}" style="background:${t.secondary};border-color:${t.primary};color:${t.accent}">${(t.logo && t.logo.symbol) || t.id}</span>`;

// ---------- Home hub ----------
const TIPS = [
  'Release your shot in the green zone. Open greens always go in.',
  'Hit three shots in a row and your player catches fire.',
  'Tired players shoot worse. Check the energy bar and use your bench.',
  'Press the crossover button next to a defender to break their ankles.',
  'Sprint at the rim and press shoot to dunk with athletic players.',
  'On defense, jump as the shooter goes up to contest or block.',
  'You can bind actions to mouse buttons and the scroll wheel in Controls.',
  'Create a room in Online and send the code to a friend.',
];
let tipIdx = Math.floor(Math.random() * TIPS.length);
function allCareers() {
  const out = [];
  for (let i = 1; i <= Season.CAREER_SLOTS; i++) { const c = Season.load('career', i); if (c) out.push(c); }
  return out;
}
function renderHome() {
  const h = TEAMS[settings.home], a = TEAMS[settings.away];
  $('#tilePlaySub').textContent = `${a.city} ${a.name} at ${h.city} ${h.name}`;
  $('#tilePlayArt').innerHTML = `${crest(a)}<span class="vs">VS</span>${crest(h)}`;
  const careers = allCareers().sort((x, y) => Season.careerOvr(y.career) - Season.careerOvr(x.career));
  const c = careers[0];
  $('#tileCareerSub').textContent = c
    ? `${c.career.first} ${c.career.last} · ${TEAMS[c.team].name} ${Season.record(c, c.team)}${careers.length > 1 ? ` · +${careers.length - 1} more` : ''}`
    : 'Create your player and start your journey';
  let art = '';
  if (c) {
    const t = TEAMS[c.team];
    const img = portrait({ skin: c.career.skin, hair: c.career.hair, hairStyle: c.career.hairStyle, jersey: t.primary, trim: t.accent });
    art = `${img ? `<img src="${img}" alt="">` : ''}<span class="ovr">${Season.careerOvr(c.career)}</span>`;
  }
  $('#tileCareerArt').innerHTML = art;
  const s = Season.load('season');
  $('#tileSeasonSub').textContent = s ? `${TEAMS[s.team].name} · ${Season.record(s, s.team)} · Year ${s.year}` : 'Lead a team to the title';
  $('#hubTip').innerHTML = `<b>TIP</b>${TIPS[tipIdx % TIPS.length]}`;
  $$('.seasonGames').forEach((el) => { el.textContent = Season.SEASON_GAMES; });
}
setInterval(() => { if (mode === 'menu' && shown() && shown().id === 'menu') { tipIdx++; $('#hubTip').innerHTML = `<b>TIP</b>${TIPS[tipIdx % TIPS.length]}`; } }, 7000);
setInterval(() => {
  const d = new Date();
  $('#hubClock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (attract && game) $('#hubLive').innerHTML = `<b>● LIVE</b>${game.away.data.id} ${game.away.score} – ${game.home.score} ${game.home.data.id} · ${game.periodName()} ${game.clockText()}`;
}, 500);

// Arrow keys / controller move between buttons on any menu screen
function focusables() {
  const scr = shown();
  return scr ? [...scr.querySelectorAll('button:not([disabled]):not([hidden]), select, input')].filter((e) => e.offsetParent !== null) : [];
}
function moveFocus(d) {
  const list = focusables();
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  list[(i + d + list.length) % list.length].focus();
  sfx.menu();
}
window.addEventListener('keydown', (e) => {
  if (capture || !shown() || ['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { moveFocus(1); e.preventDefault(); }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { moveFocus(-1); e.preventDefault(); }
});
let padNavPrev = {};
function padMenuNav() {
  const gp = firstGamepad();
  if (!gp || !shown() || capture) { padNavPrev = {}; return; }
  const now = {
    next: gp.buttons[15]?.pressed || gp.buttons[13]?.pressed || gp.axes[0] > 0.6 || gp.axes[1] > 0.6,
    prev: gp.buttons[14]?.pressed || gp.buttons[12]?.pressed || gp.axes[0] < -0.6 || gp.axes[1] < -0.6,
    ok: gp.buttons[0]?.pressed, back: gp.buttons[1]?.pressed,
  };
  if (now.next && !padNavPrev.next) { input.usingGamepad = true; moveFocus(1); }
  if (now.prev && !padNavPrev.prev) { input.usingGamepad = true; moveFocus(-1); }
  if (now.ok && !padNavPrev.ok && document.activeElement && shown().contains(document.activeElement)) document.activeElement.click();
  if (now.back && !padNavPrev.back) { const b = shown().querySelector('[data-go=back], [data-go=menu], #subsDone, #hubBack, #admExit'); if (b) b.click(); }
  padNavPrev = now;
}

// ---------- Quick-game team select ----------
function teamCard(el, idx) {
  const t = TEAMS[idx];
  el.style.setProperty('--tc', t.primary);
  const cr = el.querySelector('.crest');
  cr.textContent = t.id;
  cr.style.background = t.secondary;
  cr.style.borderColor = t.primary;
  cr.style.color = t.accent;
  el.querySelector('h3').textContent = `${t.city} ${t.name}`;
  el.querySelector('.ovr').innerHTML = `Team OVR <b>${t.ovr}</b>`;
  el.querySelector('.roster').innerHTML = t.roster.slice(0, 5).map((p) =>
    `<li><span class="p">${p.pos}</span><span class="n">#${p.number} ${p.first} ${p.last}</span><span class="o">${p.ovr}</span></li>`).join('') +
    `<li><span class="p">+5</span><span class="n" style="color:var(--muted)">Bench: ${t.roster.slice(5).map((p) => p.last).join(', ')}</span></li>`;
  const mine = el.dataset.side === settings.side;
  el.classList.toggle('mine', mine);
  el.querySelector('.playas').textContent = mine ? '✔ Your team' : 'Play as this team';
}
function renderSelect() {
  teamCard($('#cardHome'), settings.home);
  teamCard($('#cardAway'), settings.away);
  const team = TEAMS[settings[settings.side]];
  $('#optLock').innerHTML = '<option value="-1">Off (auto switch)</option>' +
    team.roster.slice(0, 5).map((p, i) => `<option value="${i}">${p.pos} · #${p.number} ${p.first} ${p.last} (${p.ovr})</option>`).join('');
  $('#optLock').value = String(settings.lock);
  $('#optDiff').value = settings.diff;
  $('#optQ').value = settings.q;
}
$$('#select .team-card').forEach((card) => {
  const side = card.dataset.side;
  const step = (d) => {
    sfx.menu();
    let v = settings[side];
    do { v = (v + d + TEAMS.length) % TEAMS.length; } while (v === settings[side === 'home' ? 'away' : 'home']);
    settings[side] = v; saveSettings(); renderSelect();
  };
  card.querySelector('.arrow.l').addEventListener('click', () => step(-1));
  card.querySelector('.arrow.r').addEventListener('click', () => step(1));
  card.querySelector('.playas').addEventListener('click', () => {
    sfx.select();
    settings.side = side; settings.lock = -1; saveSettings(); renderSelect();
  });
});
$('#optLock').addEventListener('change', (e) => { settings.lock = Number(e.target.value); saveSettings(); });
$('#optDiff').addEventListener('change', (e) => { settings.diff = e.target.value; saveSettings(); });
$('#optQ').addEventListener('change', (e) => { settings.q = e.target.value; saveSettings(); });

// ---------- Settings ----------
$('#optCam').value = settings.cam;
$('#optGfx').value = settings.gfx;
$('#optMute').checked = settings.mute;
$('#optVoice').checked = settings.voice;
$('#optMusic').checked = settings.music;
$('#optBright').value = settings.bright;
$('#brightVal').textContent = `${settings.bright}%`;
setMuted(settings.mute);
setVoice(settings.voice && !settings.mute);
// Accessibility: color-blind friendly palette and larger text
const applyAccess = () => {
  document.documentElement.dataset.cb = settings.cb ? '1' : '';
  document.documentElement.style.setProperty('--ui', String(settings.ui || 1));
};
applyAccess();
$('#optCb').checked = !!settings.cb;
$('#optCb').addEventListener('change', (e) => { settings.cb = e.target.checked; applyAccess(); saveSettings(); });
$('#optUi').value = String(settings.ui || 1);
$('#optUi').addEventListener('change', (e) => { settings.ui = Number(e.target.value); applyAccess(); saveSettings(); });
$('#touchPreset').value = settings.touchPreset || 'standard';
$('#touchPreset').addEventListener('change', (e) => { settings.touchPreset = e.target.value; saveSettings(); applyTouchPreset(e.target.value); sfx.menu(); });
$('#optSpeed').value = String(settings.speed);
if (!$('#optSpeed').value) { settings.speed = 0.85; $('#optSpeed').value = '0.85'; }
$('#optSpeed').addEventListener('change', (e) => { settings.speed = Number(e.target.value); saveSettings(); });
$('#optCam').addEventListener('change', (e) => { settings.cam = e.target.value; saveSettings(); });
$('#optGfx').addEventListener('change', (e) => { settings.gfx = e.target.value; renderScale = 1; saveSettings(); applyQuality(); });
$('#optAdaptive').checked = settings.adaptive !== false;
$('#optAdaptive').addEventListener('change', (e) => { settings.adaptive = e.target.checked; renderScale = 1; saveSettings(); applyQuality(); });
$('#optMute').addEventListener('change', (e) => { settings.mute = e.target.checked; setMuted(settings.mute); setVoice(settings.voice && !settings.mute); saveSettings(); musicMaybe(); });
$('#optVoice').addEventListener('change', (e) => { settings.voice = e.target.checked; setVoice(settings.voice && !settings.mute); saveSettings(); });
$('#optMusic').addEventListener('change', (e) => { settings.music = e.target.checked; saveSettings(); musicMaybe(); });
$('#optBright').addEventListener('input', (e) => {
  settings.bright = Number(e.target.value);
  $('#brightVal').textContent = `${settings.bright}%`;
  applyBrightness(); saveSettings();
});
$('#optCourt').addEventListener('change', (e) => {
  settings.court = e.target.value; saveSettings();
  if (mode === 'menu') startAttract();
});

// ---------- Control remapping (keyboard, mouse buttons, controller) ----------
let capture = null; // { action, slot, kind: 'key'|'pad', el }
function renderRemap() {
  const body = $('#remapBody');
  body.innerHTML = ACTIONS.map((a) => `
    <tr>
      <td>${a.label}</td>
      <td><button class="bind" data-a="${a.id}" data-slot="0" data-kind="key">${keyName(bindings.keys[a.id][0])}</button></td>
      <td><button class="bind" data-a="${a.id}" data-slot="1" data-kind="key">${keyName(bindings.keys[a.id][1])}</button></td>
      <td>${a.pad ? `<button class="bind" data-a="${a.id}" data-kind="pad">${padName(bindings.pad[a.id])}</button>` : '<span class="na">Left stick / D-pad</span>'}</td>
    </tr>`).join('');
  body.querySelectorAll('.bind').forEach((el) => el.addEventListener('click', () => startCapture(el)));
}
function startCapture(el) {
  stopCapture();
  capture = { action: el.dataset.a, slot: Number(el.dataset.slot || 0), kind: el.dataset.kind, el };
  el.classList.add('wait');
  el.textContent = el.dataset.kind === 'pad' ? 'Press a button…' : 'Press a key, click or scroll…';
  input.capturing = true;
  if (capture.kind === 'pad') {
    const gp = firstGamepad();
    capture.prev = gp ? gp.buttons.map((b) => b.pressed) : [];
    if (!gp) el.textContent = 'Connect a controller & press a button…';
  }
}
function stopCapture() {
  if (capture) capture.el.classList.remove('wait');
  capture = null;
  input.capturing = false;
}
window.addEventListener('keydown', (e) => {
  if (!capture) return;
  e.preventDefault(); e.stopPropagation();
  if (e.code === 'Escape') { stopCapture(); renderRemap(); return; }
  if (capture.kind === 'key') {
    setKey(capture.action, capture.slot, e.code === 'Backspace' || e.code === 'Delete' ? '' : e.code);
  } else if (e.code === 'Backspace' || e.code === 'Delete') setPad(capture.action, -1);
  stopCapture(); renderRemap(); sfx.select();
}, true);
// Mouse buttons can be bound too (left / middle / right / side buttons)
let swallow = null; // event type to cancel right after a mouse capture, so the click doesn't also press a button
window.addEventListener('mousedown', (e) => {
  if (!capture || capture.kind !== 'key') return;
  // Clicking another control (Done, Reset...) cancels instead of binding
  const btn = e.target.closest && e.target.closest('button');
  if (btn && !btn.classList.contains('bind')) { stopCapture(); renderRemap(); return; }
  e.preventDefault(); e.stopPropagation();
  setKey(capture.action, capture.slot, `Mouse${e.button}`);
  swallow = { type: e.button === 0 ? 'click' : e.button === 2 ? 'contextmenu' : 'auxclick', x: e.clientX, y: e.clientY };
  stopCapture(); renderRemap(); sfx.select();
}, true);
// The scroll wheel can be bound too
window.addEventListener('wheel', (e) => {
  if (!capture || capture.kind !== 'key' || !e.deltaY) return;
  e.preventDefault(); e.stopPropagation();
  setKey(capture.action, capture.slot, e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
  stopCapture(); renderRemap(); sfx.select();
}, { capture: true, passive: false });
// The click (if any) fires right after mouseup, so the guard can be dropped just after it
window.addEventListener('mouseup', () => { if (swallow) setTimeout(() => { swallow = null; }, 0); }, true);
for (const ev of ['click', 'auxclick', 'contextmenu']) {
  window.addEventListener(ev, (e) => {
    if (!swallow || swallow.type !== ev) return;
    // Only cancel the click that belongs to the capture press (same spot); never a later click elsewhere
    if (e.clientX === swallow.x && e.clientY === swallow.y) { e.preventDefault(); e.stopPropagation(); }
    swallow = null;
  }, true);
}
function pollPadCapture() {
  if (!capture || capture.kind !== 'pad') return;
  const gp = firstGamepad();
  if (!gp) return;
  if (!capture.prev.length) { capture.prev = gp.buttons.map((b) => b.pressed); capture.el.textContent = 'Press a button…'; return; }
  const i = gp.buttons.findIndex((b, j) => b.pressed && !capture.prev[j]);
  capture.prev = gp.buttons.map((b) => b.pressed);
  if (i >= 0) { setPad(capture.action, i); stopCapture(); renderRemap(); sfx.select(); }
}
$('#resetKeys').addEventListener('click', () => { resetBindings(); renderRemap(); sfx.select(); });

// ---------- Touch layout editor: drag each on-screen control where you want it ----------
{
  const root = $('#touch');
  let sel = null, drag = null;
  const select = (el) => {
    root.querySelectorAll('.tc').forEach((t) => t.classList.toggle('sel', t === el));
    sel = el;
    $('#touchSize').disabled = !el;
    if (el) $('#touchSize').value = Math.round(touchLayout[el.dataset.tc].s * 100);
    $('#touchBarHint').textContent = el ? `Selected: ${el.dataset.tc.toUpperCase()}. Drag to move, use the slider to resize.` : 'Drag a control to move it. Tap one to select it, then resize.';
  };
  $('#editTouch').addEventListener('click', () => { stopCapture(); sfx.select(); select(null); root.classList.add('edit'); applyTouchLayout(); });
  $('#touchDone').addEventListener('click', () => { root.classList.remove('edit'); select(null); saveTouchLayout(); sfx.select(); });
  $('#touchReset').addEventListener('click', () => { resetTouchLayout(); select(null); sfx.menu(); });
  $('#touchSize').addEventListener('input', (e) => { if (!sel) return; touchLayout[sel.dataset.tc].s = Number(e.target.value) / 100; applyTouchLayout(); saveTouchLayout(); });
  root.querySelectorAll('.tc').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (!root.classList.contains('edit')) return;
      e.preventDefault();
      select(el);
      const r = el.getBoundingClientRect();
      drag = { el, id: e.pointerId, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2) };
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.el !== el || e.pointerId !== drag.id) return;
      const L = touchLayout[el.dataset.tc];
      L.x = Math.max(0.03, Math.min(0.97, (e.clientX - drag.ox) / window.innerWidth));
      L.y = Math.max(0.05, Math.min(0.97, (e.clientY - drag.oy) / window.innerHeight));
      applyTouchLayout();
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; saveTouchLayout(); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
}

// ---------- Buttons ----------
$('#startBtn').addEventListener('click', () => {
  initAudio(); sfx.select();
  session = { kind: 'quick', save: null };
  launch({ home: TEAMS[settings.home], away: TEAMS[settings.away], userSide: settings.side, diff: settings.diff, q: Number(settings.q), lock: settings.lock, stage: 'Exhibition' });
});
$('#tutorialBtn').addEventListener('click', () => { initAudio(); sfx.select(); startTutorial(); });
$('#tileSeason').addEventListener('click', () => { initAudio(); sfx.select(); musicMaybe(); openHub('season'); });
$('#tileCareer').addEventListener('click', () => { initAudio(); sfx.select(); musicMaybe(); openSlots(); });
$('#tilePractice').addEventListener('click', () => { initAudio(); sfx.select(); startPractice(); });
$('#resumeBtn').addEventListener('click', () => resume());
$('#pauseBtn').addEventListener('click', () => pause());
$('#switchBtn').addEventListener('click', () => { if (game && !attract) { tapAction('switch'); sfx.menu(); } });
$('#timeoutBtn').addEventListener('click', () => tapAction('timeout'));
$('#pauseTimeout').addEventListener('click', () => { resume(); setTimeout(() => tapAction('timeout'), 30); });
$('#toContinue').addEventListener('click', () => { if (!game) return; if (game.guest) hud.hideTimeout(); else game.endTimeout(); });
$('#quitBtn').addEventListener('click', () => leaveGame());
$('#menuBtn').addEventListener('click', () => quitToMenu());
$('#rematchBtn').addEventListener('click', () => $('#startBtn').click());
$('#tileOnline').addEventListener('click', () => { initAudio(); sfx.select(); musicMaybe(); openOnline(); });
$('#overContinue').addEventListener('click', () => afterSessionGame());
$('#tutExit').addEventListener('click', () => quitToMenu());
$('#tutSkip').addEventListener('click', () => { if (tutorial) tutorial.skip(); });
$('#tutPlay').addEventListener('click', () => { quitToMenu(); renderSelect(); show('select'); });
$('#tutMenu').addEventListener('click', () => quitToMenu());
canvas.addEventListener('pointerdown', () => { if (intro && intro.t > 0.6) endIntro(); });

const netPlaying = () => !!(online && online.playing);
function pause() {
  if (mode !== 'game' || intro) return;
  if (netPlaying()) { online.menu = true; show('pause'); return; } // online: the game keeps running
  mode = 'paused'; show('pause');
}
function resume() {
  if (netPlaying() && online.menu) { online.menu = false; show(null); if (game && game.state === 'timeout') $('#timeoutScreen').classList.add('show'); return; }
  if (mode !== 'paused') return;
  mode = 'game'; show(null); if (game && game.state === 'timeout') $('#timeoutScreen').classList.add('show');
}
function endGameObjects() {
  if (game) { game.dispose(); game = null; }
  tutorial = null; attract = false; intro = null; practice = null;
  if (contest && contest.realInput && game) game.user.input = contest.realInput;
  contest = null;
  $('#contestPanel').classList.remove('show');
  $('#pracPanel').classList.remove('show');
  stopAnnouncer();
  $('#tutPanel').classList.remove('show');
  $('#intro').classList.remove('show');
  $('#vignette').classList.remove('on');
  applyBrightness();
}
function quitToMenu() {
  htClear();
  closeOnline();
  endGameObjects();
  mode = 'menu';
  startAttract();
  renderHome();
  show('menu');
  musicMaybe();
}
// Leaving a season/career game goes back to its hub (the game isn't recorded)
function leaveGame() {
  if (session.save) { const kind = session.kind; quitToMenu(); openHub(kind, careerSlot); } else quitToMenu();
}

// ---------- HUD ----------
let toastTimer = 0, popTimer = 0;
const mins = (p) => Math.round(p.stats.sec / 60 * (game ? (12 * 60) / Math.max(60, game.quarterLen) : 1));
const statRow = (p) => `<tr${p.data.isMe ? ' style="color:#ffd60a"' : ''}><td>${p.data.pos} ${p.data.first[0]}. ${esc(p.data.last)}</td><td>${mins(p)}</td><td>${p.stats.pts}</td><td>${p.stats.reb}</td><td>${p.stats.ast}</td><td>${p.stats.stl}</td><td>${p.stats.blk}</td><td>${p.stats.fgm}-${p.stats.fga}</td><td>${p.stats.tpm}-${p.stats.tpa}</td><td>${p.stats.ftm}-${p.stats.fta}</td><td>${p.stats.to}</td><td>${p.stats.pf}</td></tr>`;
const everyone = (t) => [...t.players, ...t.bench].sort((a, b) => b.stats.sec - a.stats.sec);
const hud = {
  toast(title, sub = '', dur = 2) {
    const t = $('#toast');
    t.querySelector('b').textContent = title;
    t.querySelector('span').textContent = sub;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    toastTimer = dur;
  },
  hideToast() { $('#toast').classList.remove('show'); },
  feedback(text, color = '#fff') {
    const f = $('#feedback');
    if (settings.cb) color = ({ '#3dff7a': '#35b6ff', '#ff3b3b': '#ffb000', '#ff8c1a': '#ffd60a' })[color] || color;
    f.textContent = text; f.style.color = color;
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  },
  scored(team, pts, p) {
    const el = $(`.sb-team.${team.isHome ? 'home' : 'away'} .score`);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    const pop = $('#scorePop');
    pop.style.borderLeftColor = team.data.primary;
    pop.innerHTML = `<b>${p.data.first[0]}. ${esc(p.data.last)} +${pts}${p.onFire ? ' 🔥' : ''}</b>${p.stats.pts} PTS · ${p.stats.fgm}/${p.stats.fga} FG${p.stats.tpa ? ` · ${p.stats.tpm}/${p.stats.tpa} 3PT` : ''}`;
    pop.classList.add('show');
    popTimer = 2.6;
  },
  timeout(g, team) {
    $('#toTitle').textContent = `Timeout: ${team.data.name}`;
    $('#toSub').textContent = `${team.timeouts} timeout${team.timeouts === 1 ? '' : 's'} left · Energy restored · ${g.periodName()} ${g.clockText()}`;
    const box = (t) => {
      const all = everyone(t);
      const top = [...all].sort((a, b) => b.stats.pts - a.stats.pts)[0];
      const fg = all.reduce((a, p) => [a[0] + p.stats.fgm, a[1] + p.stats.fga], [0, 0]);
      const reb = all.reduce((a, p) => a + p.stats.reb, 0);
      const to = all.reduce((a, p) => a + p.stats.to, 0);
      return `<div class="box"><h4 style="color:${t.data.primary}">${t.data.city} ${t.data.name} · ${t.score}</h4>
        <div class="line"><span>Field goals</span><span>${fg[0]}-${fg[1]}</span></div>
        <div class="line"><span>Rebounds</span><span>${reb}</span></div>
        <div class="line"><span>Turnovers</span><span>${to}</span></div>
        <div class="line"><span>Team fouls (this quarter)</span><span>${t.fouls}${t.fouls >= 5 ? ' · BONUS' : ''}</span></div>
        <div class="line"><span>Leading scorer</span><span>${esc(top.data.last)} ${top.stats.pts}</span></div></div>`;
    };
    $('#toStats').innerHTML = box(g.away) + box(g.home);
    $('#toContinue').textContent = team.isUser ? 'Continue' : 'Continue (auto in a few seconds)';
    $('#timeoutScreen').classList.add('show');
  },
  hideTimeout() { $('#timeoutScreen').classList.remove('show'); if ($('#subs').classList.contains('show') && mode !== 'paused') $('#subs').classList.remove('show'); },
  gameOver(g) {
    const winner = g.home.score > g.away.score ? g.home : g.away;
    setTimeout(() => {
      if (game !== g) return;
      mode = 'over';
      $('#overTitle').textContent = winner.isUser ? 'Victory' : 'Final';
      $('#finalScore').innerHTML = [g.away, g.home].map((t) =>
        `<span class="${t === winner ? 'w' : ''}">${t.data.id} ${t.score}</span>`).join('<span>–</span>');
      // Player of the game
      const val = (p) => p.stats.pts + p.stats.reb * 1.2 + p.stats.ast * 1.5 + p.stats.stl * 2 + p.stats.blk * 2 - p.stats.to;
      const pog = everyone(winner).sort((a, b) => val(b) - val(a))[0];
      let extras = `<div class="pog"><span class="big">★</span><div><small>Player of the game</small><b>${esc(pog.data.first)} ${esc(pog.data.last)}</b><br><span>${pog.stats.pts} PTS · ${pog.stats.reb} REB · ${pog.stats.ast} AST</span></div></div>`;
      if (g.simmed) extras += `<div class="pog"><span class="big">⏩</span><div><small>Simulated</small><b>Rest of the game</b><br><span>You were on the bench, so the rest was simmed</span></div></div>`;
      extras += recordSessionGame(g, winner);
      $('#overExtras').innerHTML = extras;
      $('#boxscore').innerHTML = [g.away, g.home].map((t) => `
        <div class="box"><h4 style="color:${t.data.primary}">${t.data.city} ${t.data.name}</h4>
        <table><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3PT</th><th>FT</th><th>TO</th><th>PF</th></tr>
        ${everyone(t).map(statRow).join('')}
        </table></div>`).join('');
      const inSession = !!session.save;
      $('#overContinue').hidden = !inSession;
      $('#rematchBtn').hidden = inSession || !!online;
      $('#menuBtn').hidden = inSession;
      show('over');
      musicMaybe();
    }, 2600);
  },
};
const nullHud = {
  toast() {}, hideToast() {}, feedback() {}, scored() {}, timeout() {}, hideTimeout() {},
  gameOver(g) { setTimeout(() => { if (attract && game === g) startAttract(); }, 5000); },
};

const tutUI = {
  show({ n, total, title, html }) {
    const el = $('#tutPanel');
    el.classList.remove('done');
    el.querySelector('.tut-n').textContent = `Tutorial ${n} / ${total}`;
    el.querySelector('.tut-title').textContent = title;
    el.querySelector('.tut-text').innerHTML = html;
    el.querySelector('.tut-bar i').style.width = '0%';
    el.classList.add('show');
  },
  progress(v) { $('#tutPanel .tut-bar i').style.width = `${Math.round(v * 100)}%`; },
  check() { $('#tutPanel').classList.add('done'); sfx.green(); },
  finish() {
    $('#tutPanel').classList.remove('show');
    mode = 'over';
    show('tutDone');
  },
};

function updateHUD(dt) {
  const g = game;
  for (const t of [g.home, g.away]) {
    const el = $(`.sb-team.${t.isHome ? 'home' : 'away'}`);
    el.querySelector('.abbr').textContent = t.data.id;
    el.querySelector('.score').textContent = t.score;
    el.querySelector('.sw').style.background = t.data.primary;
    const tos = Array.from({ length: 5 }, (_, i) => `<i class="${i < t.timeouts ? '' : 'used'}"></i>`).join('');
    const key = `${t.timeouts}-${t.fouls >= 5}`;
    const tel = el.querySelector('.tos');
    if (tel.dataset.k !== key) { tel.innerHTML = tos + (t.fouls >= 5 ? '<b>BONUS</b>' : ''); tel.dataset.k = key; }
  }
  $('.sb-mid .period').textContent = g.periodName();
  $('.sb-mid .clock').textContent = g.opts.tutorial ? 'PRACTICE' : g.clockText();
  const sc = $('.sb-mid .shot');
  sc.textContent = g.opts.tutorial || (g.shotClockFrozen && g.state !== 'live') ? '' : Math.ceil(g.shotClock);
  sc.classList.toggle('low', g.shotClock < 5);
  $('#timeoutBtn span').textContent = `${g.user.timeouts}`;
  $('#timeoutBtn').disabled = g.user.timeouts <= 0;

  updateBenchPrompt(g);
  const p = g.userPlayer;
  if (p) {
    $('#ptag .num').textContent = p.data.number;
    $('#ptag .num').style.background = p.team.data.primary;
    $('#ptag .name').textContent = `${p.data.first} ${p.data.last}${p.onFire ? ' 🔥' : ''}${g.lock ? ' 🔒' : ''}`;
    $('#ptag .meta').textContent = `${p.data.pos} · ${p.data.ovr} OVR · ${p.stats.pts} PTS · ${p.stats.pf} PF`;
    $('#ptag .stam:not(.energy) i').style.width = `${Math.round(p.stamina * 100)}%`;
    $('#ptag .stam.energy i').style.width = `${Math.round(p.energy * 100)}%`;
  }
  $('#vignette').classList.toggle('on', g.slowT > 0);

  // Shot meter beside the shooter; disappears right after release
  const m = $('#meter');
  const mp = g.meter.player || p;
  if (g.meter.visible && mp) {
    const v = new THREE.Vector3(mp.pos.x, mp.y + mp.data.height * 0.9, mp.pos.z).project(camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth + 46;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    m.style.left = `${x}px`; m.style.top = `${y}px`;
    m.classList.add('show');
    const val = g.meter.result ? g.meter.result.value : g.meter.value;
    m.querySelector('.fill').style.height = `${Math.min(100, val * 100)}%`;
    const zone = m.querySelector('.zone');
    zone.style.bottom = `${(g.meter.target - g.meter.win) * 100}%`;
    zone.style.height = `${g.meter.win * 200}%`;
    m.classList.toggle('green', !!(g.meter.result && g.meter.result.label === 'EXCELLENT'));
    if (g.meter.result && !m.dataset.shown) { hud.feedback(g.meter.result.label, g.meter.result.color); m.dataset.shown = '1'; }
  } else {
    m.classList.remove('show');
    delete m.dataset.shown;
  }

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0 && g.state !== 'break') hud.hideToast(); }
  if (popTimer > 0) { popTimer -= dt; if (popTimer <= 0) $('#scorePop').classList.remove('show'); }
}

// ---------- Career: your player is on the bench ----------
let benchDismissed = false, benchKey = '';
function updateBenchPrompt(g) {
  const el = $('#benchPrompt');
  const benched = !!(g.user.benchedMe && session.kind === 'career' && !g.opts.attract && g.state !== 'over');
  if (!benched) { benchDismissed = false; benchKey = ''; el.classList.remove('show'); return; }
  const me = [...g.user.players, ...g.user.bench].find((q) => q.data.isMe);
  const out = !!(me && me.fouledOut);
  const key = out ? 'out' : 'bench';
  if (key !== benchKey) { benchKey = key; benchDismissed = false; } // a new reason: ask again
  el.classList.toggle('show', !benchDismissed);
  if (benchDismissed) return;
  $('#benchTitle').textContent = out ? `${me.data.first} fouled out` : `${me ? me.data.first : 'Your player'} is on the bench`;
  $('#benchText').textContent = out
    ? "You're done for the night, so you can't play any more. Sim the rest of the game, or keep watching."
    : "You're not playing right now. Sim the rest of the game, sub yourself back in, or keep watching until the coach calls your number.";
  $('#benchIn').hidden = out;
}
$('#benchSim').addEventListener('click', () => { if (game && game.simRemainder()) { sfx.select(); $('#benchPrompt').classList.remove('show'); } });
$('#benchWatch').addEventListener('click', () => { benchDismissed = true; $('#benchPrompt').classList.remove('show'); sfx.menu(); });
$('#benchIn').addEventListener('click', () => {
  const g = game;
  if (!g) return;
  const me = g.user.bench.find((q) => q.data.isMe);
  if (!me) return;
  const bi = g.user.bench.indexOf(me);
  let ci = g.user.players.findIndex((q) => q.data.pos === me.data.pos);
  if (ci < 0) ci = g.user.meSlot ?? 0;
  g.requestSub(g.user, ci, bi);
  benchDismissed = true;
  $('#benchPrompt').classList.remove('show');
  hud.feedback(g.canSubNow() ? "YOU'RE BACK IN" : 'SUBBING IN AT THE NEXT WHISTLE', '#ffd60a');
  sfx.select();
});

// ---------- Substitutions screen ----------
let subSel = { court: -1, bench: -1 };
function subRow(p, i, where, g) {
  const pend = g.user.pendingSubs.some((q) => (where === 'court' ? q.courtIdx : q.benchIdx) === i);
  const sel = subSel[where] === i;
  return `<button class="sub-row${sel ? ' sel' : ''}${p.fouledOut ? ' out' : ''}" data-w="${where}" data-i="${i}" ${p.fouledOut && where === 'bench' ? 'disabled' : ''}>
    <span class="p">${p.data.pos}</span><span>#${p.data.number} ${esc(p.data.first[0])}. ${esc(p.data.last)}${p.onFire ? ' 🔥' : ''} ${pend ? '<span class="pend">SWAPPING</span>' : ''}</span>
    <span class="o">${p.data.ovr}</span><span class="e" title="Energy"><i style="width:${Math.round(p.energy * 100)}%"></i></span>
    <span class="f">${p.fouledOut ? 'OUT' : `${p.stats.pts}p ${p.stats.pf}f`}</span></button>`;
}
function renderSubs() {
  const g = game;
  if (!g) return;
  $('#subsCourt').innerHTML = g.user.players.map((p, i) => subRow(p, i, 'court', g)).join('');
  $('#subsBench').innerHTML = g.user.bench.map((p, i) => subRow(p, i, 'bench', g)).join('');
  $('#subsHint').textContent = g.canSubNow() ? 'Pick a player on the court, then a player on the bench to swap them. Bars show energy.' : 'Play is live: swaps you pick will happen at the next whistle.';
  $('#optAutoSubs').checked = settings.autoSubs;
  $$('#subs .sub-row').forEach((el) => el.addEventListener('click', () => {
    const w = el.dataset.w, i = Number(el.dataset.i);
    subSel[w] = subSel[w] === i ? -1 : i;
    if (subSel.court >= 0 && subSel.bench >= 0) {
      g.requestSub(g.user, subSel.court, subSel.bench);
      subSel = { court: -1, bench: -1 };
      sfx.select();
    } else sfx.menu();
    renderSubs();
  }));
}
$$('.openSubs').forEach((b) => b.addEventListener('click', () => { if (!game || attract) return; if (game.guest) { hud.feedback('YOUR COACH HANDLES SUBS ONLINE', '#ffd60a'); return; } subSel = { court: -1, bench: -1 }; renderSubs(); show('subs'); }));
$('#subsDone').addEventListener('click', () => {
  if (mode === 'paused' || (netPlaying() && online.menu)) show('pause');
  else { show(null); if (game && game.state === 'timeout') $('#timeoutScreen').classList.add('show'); }
});
$('#optAutoSubs').addEventListener('change', (e) => { settings.autoSubs = e.target.checked; if (game) game.autoSubs = settings.autoSubs; saveSettings(); });

// ---------- Kit customiser ----------
let kitEd = null;
let kitTimer = 0;
const kitSwatches = (list, cur, field) => list.map((c) => `<button class="sw${c === cur ? ' on' : ''}${c === null ? ' none' : ''}" data-f="${field}" data-val="${c === null ? '' : c}" style="${c === null ? '' : `background:${c}`}" aria-label="${c || 'Original'}">${c === null ? '↺' : ''}</button>`).join('');
function openKit(team, onClose) {
  kitEd = { team, kit: JSON.parse(JSON.stringify(getKit(team))), onClose, view: 'home' };
  $('#kitTeam').textContent = `${team.city} ${team.name}`;
  drawKit();
  show('kit');
}
function kitJerseys() {
  const k = kitEd.kit;
  if (kitEd.view === 'away' || k.homeStyle === 'color') return { jersey: k.primary, trim: k.accent };
  return { jersey: '#f5f5f5', trim: k.primary };
}
function kitCrestHTML() {
  const k = kitEd.kit;
  return crest({ ...kitEd.team, primary: k.primary, secondary: k.secondary, accent: k.accent, logo: k.logo });
}
function drawKit() {
  const k = kitEd.kit, t = kitEd.team;
  $('#kitCrest').innerHTML = kitCrestHTML();
  $('#kitColors').innerHTML = [['primary', 'Primary (jersey)'], ['secondary', 'Secondary (logo background)'], ['accent', 'Accent (numbers and trim)']].map(([f, label]) =>
    `<div class="kit-row"><label>${label}</label><div class="sws">${kitSwatches(PALETTE, k[f], f)}<input type="color" value="${k[f]}" data-pick="${f}" aria-label="Custom colour for ${label}"></div></div>`).join('');
  $('#kitLooks').innerHTML = `<button data-look="orig">Original</button>` + LOOKS.map((l, i) => `<button data-look="${i}" style="border-left:6px solid ${l.primary}">${l.name}</button>`).join('');
  $$('#kitLooks button').forEach((b) => b.addEventListener('click', () => {
    const o = t._orig;
    const l = b.dataset.look === 'orig' ? { primary: o.primary, secondary: o.secondary, accent: o.accent, homeStyle: 'white' } : LOOKS[Number(b.dataset.look)];
    Object.assign(k, { primary: l.primary, secondary: l.secondary, accent: l.accent, homeStyle: l.homeStyle, shorts: null, numColor: null });
    sfx.menu(); drawKit();
  }));
  $('#kitExtra').innerHTML = `<div class="kit-row"><label>Shorts (the arrow matches the jersey)</label><div class="sws">${kitSwatches([null, ...PALETTE], k.shorts, 'shorts')}</div></div><div class="kit-row"><label>Numbers and name (the arrow uses the accent color)</label><div class="sws">${kitSwatches([null, ...PALETTE], k.numColor, 'numColor')}</div></div>`;
  $('#kitHome').innerHTML = [['white', 'Classic white'], ['color', 'Team colors']].map(([v, l]) => `<button class="${k.homeStyle === v ? 'on' : ''}" data-hs="${v}">${l}</button>`).join('');
  $('#kitSymbols').innerHTML = SYMBOLS.map((s) => `<button class="${k.logo.symbol === s ? 'on' : ''}" data-sym="${s}">${s || t.id}</button>`).join('');
  $('#kitShapes').innerHTML = Object.entries(SHAPES).map(([v, l]) => `<button class="${k.logo.shape === v ? 'on' : ''}" data-shape="${v}">${l}</button>`).join('');
  $('#kitShoeUpper').innerHTML = kitSwatches(SHOE_COLORS, k.shoeUpper, 'shoeUpper');
  $('#kitShoeSole').innerHTML = kitSwatches(SHOE_COLORS, k.shoeSole, 'shoeSole');
  $('#kitView').innerHTML = [['home', 'Home kit'], ['away', 'Away kit']].map(([v, l]) => `<button class="${kitEd.view === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('') + [['0', 'Front'], ['90', 'Side'], ['180', 'Back']].map(([v, l]) => `<button class="ang ${String(kitEd.yaw ?? 0) === v ? 'on' : ''}" data-yaw="${v}">${l}</button>`).join('');
  $$('#kit .sw').forEach((b) => b.addEventListener('click', () => { const f = b.dataset.f; k[f] = b.dataset.val || ((f === 'primary' || f === 'secondary' || f === 'accent') ? k[f] : null); drawKit(); }));
  $$('#kit input[type=color]').forEach((i) => i.addEventListener('input', () => { k[i.dataset.pick] = i.value; $('#kitCrest').innerHTML = kitCrestHTML(); clearTimeout(kitTimer); kitTimer = setTimeout(renderKitPreview, 150); }));
  $$('#kitHome button').forEach((b) => b.addEventListener('click', () => { k.homeStyle = b.dataset.hs; drawKit(); }));
  $$('#kitSymbols button').forEach((b) => b.addEventListener('click', () => { k.logo.symbol = b.dataset.sym; drawKit(); }));
  $$('#kitShapes button').forEach((b) => b.addEventListener('click', () => { k.logo.shape = b.dataset.shape; drawKit(); }));
  $$('#kitView button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.yaw !== undefined) kitEd.yaw = Number(b.dataset.yaw); else kitEd.view = b.dataset.v; drawKit(); }));
  clearTimeout(kitTimer);
  kitTimer = setTimeout(renderKitPreview, 60);
}
function renderKitPreview() {
  if (!kitEd) return;
  const k = kitEd.kit, t = kitEd.team, j = kitJerseys();
  const kit = { team: { id: t.id, secondary: k.secondary, logo: k.logo, shoeUpper: k.shoeUpper, shoeSole: k.shoeSole, numColor: k.numColor }, number: 7, last: t.name, shoeUpper: k.shoeUpper, shoeSole: k.shoeSole };
  const img = (yaw) => portrait({ skin: '#c68642', hair: '#111111', hairStyle: 1, jersey: j.jersey, trim: j.trim, shorts: k.shorts, yaw, body: true, kit });
  // the chosen angle large, with the other two beside it
  const main = kitEd.yaw ?? 0, others = [0, 90, 180].filter((y) => y !== main);
  const a = img(main);
  $('#kitPreview').innerHTML = a ? `<img class="big" src="${a}" alt="The kit"><div class="thumbs">${others.map((y) => `<img src="${img(y)}" alt="" data-yaw="${y}">`).join('')}</div>` : '<p class="hint">The preview needs the 3D player model.</p>';
  $$('#kitPreview .thumbs img').forEach((im) => im.addEventListener('click', () => { kitEd.yaw = Number(im.dataset.yaw); drawKit(); }));
}
$('#kitSave').addEventListener('click', () => {
  sfx.select();
  saveKit(kitEd.team, kitEd.kit);
  Season.scaledCache.clear();
  const cb = kitEd.onClose; kitEd = null; if (cb) cb();
});
$('#kitBack').addEventListener('click', () => { sfx.menu(); const cb = kitEd.onClose; kitEd = null; if (cb) cb(); });
$('#kitReset').addEventListener('click', () => {
  sfx.menu();
  const o = kitEd.team._orig;
  kitEd.kit = { primary: o.primary, secondary: o.secondary, accent: o.accent, homeStyle: 'white', logo: { symbol: '', shape: 'circle' }, shoeUpper: null, shoeSole: null, shorts: null, numColor: null };
  drawKit();
});
$('#selKit').addEventListener('click', () => { sfx.menu(); openKit(TEAMS[settings[settings.side]], () => { renderSelect(); show('select'); }); });

// ---------- Move guide: what every button does ----------
const bindLabel = (id) => {
  const k = bindings.keys[id] && bindings.keys[id][0];
  const pad = bindings.pad[id];
  return [k ? keyName(k) : null, pad != null && pad >= 0 ? padName(pad) : null].filter(Boolean).join(' / ') || '—';
};
const MOVE_TABS = [
  { id: 'ball', label: 'With the ball', items: [
    { b: ['shoot'], how: 'Hold, then release', t: 'Jump shot', d: 'A meter fills while you hold. Let go in the green zone and it almost always goes in. The game picks the shot: pull-up on the move, step-back after a step-back, fadeaway when guarded close, floater in the lane.' },
    { b: ['shoot'], how: 'Tap near the rim', t: 'Layup and dunk', d: 'Close to the basket the same button goes up for a layup. Sprint in with speed and it becomes a dunk: a windmill or tomahawk when you are open, a two-hand slam when crowded, plus euro-steps and reverse layups.' },
    { b: ['pass'], how: 'Tap, point the stick', t: 'Pass', d: 'Aim the stick at a teammate. The game chooses a chest pass, a bounce pass through traffic, or a lob for an alley-oop near the rim.' },
    { b: ['move'], how: 'Tap', t: 'Crossover moves', d: 'The situation picks the move: crossover, behind-the-back, hesitation, step-back, or a spin when a defender is on you and you are driving. Good handles make defenders stumble.' },
    { b: ['move'], how: 'Stand still near the rim', t: 'Post-up', d: 'A big player near the basket with a defender on his back can back him down. He turns and finishes on his own when the move ends.' },
    { b: ['shoot', 'pass'], how: 'Hold Shoot, tap Pass', t: 'Pump fake', d: 'Cancel the shot and fake it. A defender who bites jumps and is out of the play, so drive past him.' },
    { b: ['sprint'], how: 'Hold', t: 'Sprint', d: 'Faster, and needed for dunks and fast breaks. It tires players, so rotate your bench.' },
    { b: ['shoot'], how: 'Hold, then release', t: 'Free throws', d: 'Same meter as a jump shot. Wait for the green zone.' },
  ] },
  { id: 'off', label: 'Without the ball', items: [
    { b: ['pass'], how: 'Tap', t: 'Call for the ball', d: 'Your teammate with the ball throws it to you.' },
    { b: ['switch'], how: 'Tap', t: 'Switch player', d: 'Take control of another teammate, or turn on Player Lock to stay on one player.' },
    { b: ['shoot'], how: 'Tap', t: 'Jump for a rebound', d: 'When a shot is in the air, jump to grab the board. Offensive rebounds reset the shot clock to 14.' },
    { b: ['move'], how: 'Move the stick', t: 'Cut and space the floor', d: 'Run to open space, cut to the rim for a lob or a pass, and stay out of the lane: three seconds there is a violation.' },
    { b: ['timeout'], how: 'Tap', t: 'Call timeout', d: 'Stops the clock, lets you rest and sub, and changes tactics from the Pause menu.' },
  ] },
  { id: 'def', label: 'On defense', items: [
    { b: ['shoot'], how: 'Tap, timed', t: 'Contest and block', d: 'Jump at the shooter. Time it as the ball goes up for a block. Touch it on the way down to the rim and it is goaltending, so the basket counts.' },
    { b: ['pass'], how: 'Tap near the ball', t: 'Steal', d: 'A lunge with a poke or a swipe. Close and good hands win the ball, but a reach-in can be a foul.' },
    { b: [], how: 'Stand in the lane', t: 'Intercept', d: 'Step into a passing lane and the pass is yours. Stay close to the receiver you are guarding.' },
    { b: ['move'], how: 'Tap', t: 'Quick switch', d: 'Instantly take control of the defender nearest the ball.' },
    { b: ['sprint'], how: 'Hold', t: 'Recover', d: 'Sprint back to the basket on a fast break. Defenders slide on their own in a low stance when you hold the stick sideways.' },
  ] },
  { id: 'rules', label: 'The rules', items: [
    { b: [], how: '24 seconds', t: 'Shot clock', d: 'Get a shot up before it hits zero. After an offensive rebound it resets to 14.' },
    { b: [], how: '8 seconds', t: 'Half court', d: 'Bring the ball over the half-court line within eight seconds, and never carry it back over once you are across.' },
    { b: [], how: '3 seconds', t: 'The lane', d: 'No offensive player can stay in the paint more than three seconds while his team has the ball.' },
    { b: [], how: 'Q2 and Q3', t: 'Possession', d: 'The team that loses the opening tip gets the ball to start the second and third quarters, and the tip winner gets the fourth.' },
    { b: [], how: 'Fouls', t: 'Fouls and the bonus', d: 'Contact on a shooter is a shooting foul. After five team fouls in a quarter, every foul is two free throws. Six personal fouls and a player is out.' },
  ] },
];
let movesTab = 'ball';
function renderMoves() {
  $('#movesTabs').innerHTML = MOVE_TABS.map((t) => `<button class="${t.id === movesTab ? 'on' : ''}" data-t="${t.id}">${t.label}</button>`).join('');
  $$('#movesTabs button').forEach((b) => b.addEventListener('click', () => { movesTab = b.dataset.t; sfx.menu(); renderMoves(); }));
  const tab = MOVE_TABS.find((t) => t.id === movesTab) || MOVE_TABS[0];
  $('#movesBody').innerHTML = tab.items.map((m) => `<div class="mv"><div class="mv-keys">${m.b.map((id) => `<kbd>${bindLabel(id)}</kbd>`).join('<i>+</i>')}<small>${m.how}</small></div><div class="mv-txt"><b>${m.t}</b><p>${m.d}</p></div></div>`).join('');
}
let movesReturn = 'menu';
function openMoves(back) { movesReturn = back; renderMoves(); show('moves'); }
$('#movesDone').addEventListener('click', () => { sfx.menu(); show(movesReturn); });
$('#pauseMoves').addEventListener('click', () => openMoves('pause'));
$('#controlsMoves').addEventListener('click', () => openMoves('controls'));
$('#hubMoves').addEventListener('click', () => { initAudio(); sfx.menu(); openMoves('menu'); });

// ---------- Team tactics ----------
let tac = null;
function openTactics(teamData, onClose) {
  const t = getTactics(teamData);
  tac = { team: teamData, preset: t.preset, vals: { ...t.vals }, onClose };
  $('#tacCrest').innerHTML = crest(teamData);
  $('#tacTeam').textContent = `${teamData.city} ${teamData.name}`;
  const ovr = teamData.ovr || 83;
  const feel = ovr >= 87 ? 'Elite: sharp decisions, tight defense, hard to rattle' : ovr >= 84 ? 'Strong: plays smart and holds up under pressure' : ovr >= 82 ? 'Solid: makes some mistakes' : 'Rough around the edges: loose passes, late rotations';
  $('#tacOvr').innerHTML = `<b>${ovr} OVR</b>${feel}`;
  $('#tacPresets').innerHTML = PRESET_KEYS.map((k) => `<button data-k="${k}" title="${PRESETS[k].desc}">${PRESETS[k].label}</button>`).join('');
  $$('#tacPresets button').forEach((b) => b.addEventListener('click', () => { sfx.menu(); tac.vals = presetValues(b.dataset.k); tac.preset = b.dataset.k; drawTactics(true); }));
  $('#tacSliders').innerHTML = SLIDERS.map((sl) => `<div class="tac-sl"><div class="top"><span>${sl.label}</span><b data-v="${sl.k}"></b></div><input type="range" min="0" max="100" data-k="${sl.k}"><div class="ends"><span>${sl.lo}</span><span>${sl.hi}</span></div><p>${sl.tip}</p></div>`).join('');
  $$('#tacSliders input').forEach((r) => r.addEventListener('input', () => { tac.vals[r.dataset.k] = Number(r.value); tac.preset = matchPreset(tac.vals); drawTactics(false); }));
  drawTactics(true);
  show('tactics');
}
function drawTactics(syncSliders) {
  const v = tac.vals;
  if (syncSliders) $$('#tacSliders input').forEach((r) => { r.value = v[r.dataset.k]; });
  SLIDERS.forEach((sl) => { $(`#tacSliders [data-v=${sl.k}]`).textContent = v[sl.k]; });
  $$('#tacPresets button').forEach((b) => b.classList.toggle('on', b.dataset.k === tac.preset));
  $('#tacPresetName').textContent = tac.preset === 'custom' ? 'CUSTOM' : PRESETS[tac.preset].label.toUpperCase();
  // Half-court diagram: where the five players set up, with arrows for the plan
  const sc = 16, hx = 150, hy = 236, n = (k) => v[k] / 100;
  const spots = [[7.6, 0], [7.4, 0.95], [7.0, -1.33], [5.0, -0.55], [2.4, 0.95]];
  const pos = spots.map(([r0, a], i) => {
    const r = i <= 2 ? r0 * (0.92 + n('threes') * 0.2) : r0 * (1 - (n('attack') - 0.5) * 0.16);
    return [hx + r * Math.sin(a) * sc, hy - r * Math.cos(a) * sc];
  });
  const labels = ['PG', 'SG', 'SF', 'PF', 'C'];
  let g = '<rect x="2" y="2" width="296" height="266" rx="10" fill="none" stroke="rgba(255,255,255,0.25)"/>';
  g += `<rect x="${hx - 29}" y="${hy - 70}" width="58" height="82" fill="none" stroke="rgba(255,255,255,0.3)"/><circle cx="${hx}" cy="${hy - 70}" r="24" fill="none" stroke="rgba(255,255,255,0.3)"/>`;
  g += `<path d="M ${hx - 128} 268 L ${hx - 128} ${hy - 44} A 134 134 0 0 1 ${hx + 128} ${hy - 44} L ${hx + 128} 268" fill="none" stroke="rgba(255,255,255,0.3)"/>`;
  g += `<circle cx="${hx}" cy="${hy}" r="6" fill="none" stroke="#ff8c1a" stroke-width="2"/>`;
  const ly = hy - 24 - n('line') * 150;
  g += `<line x1="14" x2="286" y1="${ly}" y2="${ly}" stroke="#ffd60a" stroke-width="1.5" stroke-dasharray="6 5"/><text x="18" y="${ly - 5}" fill="#ffd60a" font-size="10" font-weight="700">DEFENSIVE LINE</text>`;
  const passes = Math.round(n('passing') * 3) + (n('passing') > 0.4 ? 1 : 0);
  const pairs = [[0, 1], [1, 3], [2, 0], [3, 4], [2, 3]];
  for (let i = 0; i < passes && i < pairs.length; i++) { const [a, b] = pairs[i]; g += `<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" stroke="#3dff7a" stroke-width="2" stroke-dasharray="4 4" opacity="0.8"/>`; }
  if (n('attack') > 0.55) g += `<path d="M ${pos[0][0]} ${pos[0][1]} Q ${pos[0][0] - 40} ${(pos[0][1] + hy) / 2} ${hx - 6} ${hy - 12}" fill="none" stroke="#3dff7a" stroke-width="${1 + n('attack') * 3}" marker-end="url(#ar)"/>`;
  const crash = 1 + Math.round(n('glass') * 3);
  for (let i = 0; i < crash; i++) g += `<path d="M ${pos[4 - i][0]} ${pos[4 - i][1]} L ${hx + (i % 2 ? -14 : 14)} ${hy - 14}" stroke="#35f0ff" stroke-width="1.6" fill="none" marker-end="url(#ar2)"/>`;
  const ch = Math.round(n('pace') * 3);
  g += '<text x="270" y="40" fill="#8f9bb3" font-size="9" text-anchor="middle">PACE</text>';
  for (let i = 0; i < ch; i++) g += `<text x="270" y="${60 + i * 16}" fill="#3dff7a" font-size="16" font-weight="900" text-anchor="middle">»</text>`;
  pos.forEach(([x, y], i) => { g += `<circle cx="${x}" cy="${y}" r="11" fill="#0b1220" stroke="#35f0ff" stroke-width="2"/><text x="${x}" y="${y + 3.5}" fill="#fff" font-size="9" font-weight="800" text-anchor="middle">${labels[i]}</text>`; });
  $('#tacCourt').innerHTML = '<defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#3dff7a"/></marker><marker id="ar2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#35f0ff"/></marker></defs>' + g;
  const tr = tacTraits(v);
  $('#tacTraits').innerHTML = tr.good.map((x) => `<div class="g">✓ <span>${x}</span></div>`).join('') + tr.bad.map((x) => `<div class="b">! <span>${x}</span></div>`).join('');
}
$('#tacSave').addEventListener('click', () => {
  sfx.select();
  saveTactics(tac.team, tac.preset, tac.vals);
  if (game) for (const t of game.teams) if (t.data.id === tac.team.id) t.tac = tacticsNorm(tac.vals); // takes effect right away, even mid-game
  const cb = tac.onClose; tac = null; if (cb) cb();
});
$('#tacBack').addEventListener('click', () => { sfx.menu(); const cb = tac.onClose; tac = null; if (cb) cb(); });
$('#tacReset').addEventListener('click', () => { sfx.menu(); resetTactics(tac.team); const t = getTactics(tac.team); tac.preset = t.preset; tac.vals = { ...t.vals }; drawTactics(true); });
$('#pauseTactics').addEventListener('click', () => { if (!game || attract) return; openTactics(game.user.data, () => show('pause')); });
$('#selTactics').addEventListener('click', () => { sfx.menu(); openTactics(TEAMS[settings[settings.side]], () => { renderSelect(); show('select'); }); });

// ---------- Halftime show ----------
// Three original studio legends break down the first half while a highlight reel plays
const ANALYSTS = [
  { name: 'Big Tex', role: 'Center · 4× champion', skin: '#8d5524', hair: '#111111', hairStyle: 0, suit: '#1b2a4a' },
  { name: 'Slick Dom', role: 'Guard · scoring legend', skin: '#c68642', hair: '#111111', hairStyle: 3, suit: '#5b1633' },
  { name: 'Coach Kingsley', role: 'Forward · all-time great', skin: '#5c3a1e', hair: '#1a1a1a', hairStyle: 1, suit: '#10413a' },
];
const REEL_ICON = { dunk: '🔥', three: '🎯', block: '🛑', steal: '✋', buzzer: '⏱️', assist: '🤝' };
let htTimers = [];
let htNext = () => {};
function htClear() { htTimers.forEach((t) => { if (t && t.stop) t.stop(); else { clearInterval(t); clearTimeout(t); } }); htTimers = []; if (game) game.stopReplay(); }

function halftimeLines(g) {
  const a = g.away, h = g.home;
  const all = [...a.players, ...a.bench, ...h.players, ...h.bench];
  const tot = (t, k) => [...t.players, ...t.bench].reduce((x, p) => x + p.stats[k], 0);
  const top = (k) => all.reduce((b, p) => (p.stats[k] > (b ? b.stats[k] : -1) ? p : b), null);
  const nm = (t) => t.data.name;
  const lead = h.score - a.score, leader = lead >= 0 ? h : a, trailer = lead >= 0 ? a : h;
  const L = [];
  L.push([1, Math.abs(lead) <= 2 ? `All square at the break, ${a.score} to ${h.score}. This one is a street fight.` : Math.abs(lead) >= 12 ? `${nm(leader)} are running away with it, up ${Math.abs(lead)}. ${nm(trailer)} need answers fast.` : `${nm(leader)} lead by ${Math.abs(lead)} at the half. Nothing is decided yet.`]);
  const sc = top('pts');
  if (sc && sc.stats.pts > 0) L.push([0, `${sc.data.first} ${sc.data.last} already has ${sc.stats.pts} points on ${sc.stats.fgm}-for-${sc.stats.fga} shooting. ${sc.stats.pts >= 14 ? 'He is cooking out there!' : 'Quietly efficient.'}`]);
  const tp = (t) => `${tot(t, 'tpm')}-for-${tot(t, 'tpa')}`;
  L.push([1, `From deep: ${nm(h)} are ${tp(h)}, ${nm(a)} are ${tp(a)}. ${tot(h, 'tpm') + tot(a, 'tpm') >= 6 ? 'The nets are on fire.' : 'The rims have been tight.'}`]);
  const rb = tot(h, 'reb') - tot(a, 'reb');
  L.push([0, rb === 0 ? 'Even on the glass, so it comes down to who wants it more.' : `${nm(rb > 0 ? h : a)} are winning the boards ${Math.max(tot(h, 'reb'), tot(a, 'reb'))} to ${Math.min(tot(h, 'reb'), tot(a, 'reb'))}. That is where games are won.`]);
  const tov = tot(h, 'to') - tot(a, 'to');
  L.push([2, tov === 0 ? 'Both teams are taking care of the ball. Clean basketball.' : `${nm(tov > 0 ? h : a)} have ${Math.max(tot(h, 'to'), tot(a, 'to'))} turnovers. Cut those out and it is a different game.`]);
  const bl = top('blk'), st = top('stl');
  if (bl && bl.stats.blk >= 2) L.push([0, `${bl.data.last} has ${bl.stats.blk} blocks. Nothing is easy at the rim against him.`]);
  else if (st && st.stats.stl >= 2) L.push([1, `${st.data.last} has ${st.stats.stl} steals. Those hands are quick.`]);
  const me = g.user, tc = me.tac;
  L.push([2, tc.pace > 0.65 ? `${nm(me)} want to run. Keep pushing the pace, the legs will tell in the fourth.` : tc.pressure > 0.7 ? `That pressure is working for ${nm(me)}, but watch the reach-in fouls.` : tc.threes > 0.7 ? `${nm(me)} keep hunting threes. Live by it, die by it.` : `${nm(me)}, trust your tactics and adjust at the break. You can change them from the pause menu.`]);
  L.push([1, `Fresh legs and a new half. Let's get back to it!`]);
  return L;
}

function renderHalftime(g, reel) {
  htClear();
  $('#htScore').innerHTML = `${crest(g.away.data)}<b>${g.away.score}</b><span>-</span><b>${g.home.score}</b>${crest(g.home.data)}`;
  $('#htDesk').innerHTML = ANALYSTS.map((a, i) => {
    const img = portrait({ skin: a.skin, hair: a.hair, hairStyle: a.hairStyle, jersey: a.suit, trim: '#ffd60a' });
    return `<div class="ht-an" data-i="${i}">${img ? `<img src="${img}" alt="">` : ''}<b>${a.name}</b></div>`;
  }).join('');
  const lines = halftimeLines(g);
  let li = 0;
  const say = () => {
    if (li >= lines.length) { clearInterval(lineT); return; }
    const [who, text] = lines[li++];
    $$('#htDesk .ht-an').forEach((e) => e.classList.toggle('talk', Number(e.dataset.i) === who));
    $('#htBubble').innerHTML = `<b>${ANALYSTS[who].name}</b> ${text}`;
  };
  say();
  const lineT = setInterval(say, 6500);
  htTimers.push(lineT);
  // Top performers
  const all = [...g.away.players, ...g.away.bench, ...g.home.players, ...g.home.bench].filter((p) => p.stats.sec > 0 || p.stats.pts > 0);
  const lead = all.sort((x, y) => y.stats.pts + y.stats.reb + y.stats.ast - (x.stats.pts + x.stats.reb + x.stats.ast)).slice(0, 3);
  $('#htLeaders').innerHTML = lead.map((p) => `<div class="ht-ld" style="--tc:${p.team.data.primary}"><b>${p.data.first[0]}. ${p.data.last}</b><span>${p.stats.pts} PTS · ${p.stats.reb} REB · ${p.stats.ast} AST</span></div>`).join('');
  // Highlight reel: the best plays of the half, played back on the court in game order
  const best = [...reel].sort((x, y) => (y.frames ? 1 : 0) - (x.frames ? 1 : 0) || y.pri - x.pri).slice(0, 6).sort((x, y) => x.period - y.period || 0);
  const clips = best.length ? best : [{ kind: 'assist', clock: '', period: 1, text: 'A quiet half so far. The highlights are coming in the second!', team: g.home.data.id, frames: null }];
  let ci = -1, clipT = 0;
  htNext = () => {
    clearTimeout(clipT);
    g.stopReplay();
    ci++;
    if (ci >= clips.length) {
      $('#htClip').innerHTML = '<div class="ht-clip end"><span class="ico">🏀</span><div><small>That is the reel</small><b>Second half is next. Good luck out there!</b></div></div>';
      htTimers.push(setTimeout(() => { if (game === g && g.halftime) endHalftimeShow(); }, 14000));
      return;
    }
    const c = clips[ci];
    const t = [g.home, g.away].find((x) => x.data.id === c.team) || g.home;
    $('#htClip').innerHTML = `<div class="ht-clip" style="--tc:${t.data.primary}"><span class="ico">${REEL_ICON[c.kind] || '🏀'}</span><div><small>${c.frames ? '<i class="rec">● REPLAY</i> ' : ''}${c.period ? 'Q' + c.period : ''} ${c.clock}${c.kind ? ' · ' + c.kind.toUpperCase() : ''} · ${ci + 1}/${clips.length}</small><b>${c.text}</b></div>${crest(t.data)}</div>`;
    if (c.kind !== 'assist') { fx.crowdFlashes(40); }
    const started = c.frames && g.startReplay(c.frames, 0.75, () => { clipT = setTimeout(htNext, 900); });
    if (!started) clipT = setTimeout(htNext, 3600);
  };
  htNext();
  htTimers.push({ stop: () => { clearTimeout(clipT); } });
}
function endHalftimeShow() {
  htClear();
  if (game) game.endHalftime();
  if ($('#halftime').classList.contains('show')) show(null);
}
$('#htSkip').addEventListener('click', () => { sfx.select(); endHalftimeShow(); });
$('#htNext').addEventListener('click', () => { sfx.menu(); htNext(); });

$('#pauseTactics2').addEventListener('click', () => { if (game) openTactics(game.user.data, () => show('halftime')); });

// ---------- Game lifecycle ----------
function hookFx(g) {
  g.on((type, d) => {
    if (type === 'halftime' && g === game) { renderHalftime(g, d.reel); show('halftime'); $('#hud').classList.remove('show'); $('#touch').classList.remove('active'); }
    if (type === 'stealAttempt' && d.player && d.target) {
      // A glowing streak from the hand to the ball at the moment of the strike
      const who = d.player, tgt = d.target;
      setTimeout(() => {
        if (game !== g) return;
        fx.swipe(new THREE.Vector3(who.pos.x, who.y + who.data.height * 0.7, who.pos.z), g.ball.pos.clone().setY(Math.max(0.8, g.ball.pos.y)));
      }, 110);
      void tgt;
    }
    if (type === 'steal') { fx.sparks(g.ball.pos.clone(), [1, 0.7, 0.3], 24); fx.crowdFlashes(25); }
    if (type === 'shot' && d.player) fx.shotPulse(d.player, d.kind === 'dunk' ? [1, 0.3, 0.5] : d.kind === 'layup' ? [0.4, 0.9, 1] : [1, 0.85, 0.4]);
    if (type === 'score') {
      fx.crowdFlashes(d.kind === 'dunk' ? 70 : d.pts === 3 ? 45 : 18);
      if (d.kind === 'dunk') fx.sparks(new THREE.Vector3(d.team.dir * C.HOOP_X, C.RIM_H, 0), [1, 0.55, 0.2], 36);
      if (d.buzzer) fx.crowdFlashes(150);
    } else if (type === 'block') fx.crowdFlashes(30);
    else if (type === 'onFire') { fx.crowdFlashes(60); fx.sparks(new THREE.Vector3(d.player.pos.x, 1.2, d.player.pos.z), [1, 0.4, 0.1], 40); }
    else if (type === 'gameOver') { fx.celebrate([d.winner.data.primary, d.winner.data.secondary, '#ffffff', d.winner.data.accent]); fx.crowdFlashes(200); }
  });
}

function launch({ home, away, userSide, diff, q, lock, stage, strictLock = false }) {
  endGameObjects();
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, { difficulty: diff, quarterMinutes: q, userSide, playerLock: lock, strictLock, autoSubs: settings.autoSubs }, hud);
  hookFx(game);
  attachAnnouncer(game); attachCrowd(game, arena);
  setQuiet(false);
  mode = 'game';
  stopMusic();
  beginIntro(stage);
}

function beginIntro(stage) {
  const g = game;
  g.state = 'intro';
  intro = { t: 0, dur: 6 };
  const block = (t, tag) => `${crest(t.data)}<h3>${t.data.city}<br>${t.data.name}</h3><small>${tag}${t.isUser ? ' · YOU' : ''}</small>`;
  const rec = (t) => (session.save ? Season.record(session.save, TEAMS.findIndex((x) => x.id === t.data.id)) : `${t.data.ovr} OVR`);
  $('#introAway').innerHTML = block(g.away, `Away · ${rec(g.away)}`);
  $('#introHome').innerHTML = block(g.home, `Home · ${rec(g.home)}`);
  $('#introAway').style.setProperty('--glow', g.away.data.primary);
  $('#introHome').style.setProperty('--glow', g.home.data.primary);
  $('#introStage').textContent = stage || '';
  show(null);
  $('#intro').classList.add('show');
  sfx.horn(); sfx.cheer(1);
  fx.crowdFlashes(120);
  setTimeout(() => { if (game === g && intro) sayIntro(g); }, 500);
}
function endIntro() {
  if (!intro || !game) return;
  intro = null;
  game.begin();
  applyBrightness();
  $('#intro').classList.remove('show');
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
}

function startAttract() {
  endGameObjects();
  const home = TEAMS[settings.home], away = TEAMS[settings.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, { difficulty: 'allstar', quarterMinutes: 3, userSide: 'home', playerLock: -1, attract: true }, nullHud);
  game.autoplay = true;
  hookFx(game);
  attract = true;
  setQuiet(true);
  camPos.set(6, 6, 14); camTarget.set(0, 1.5, 0);
}

function startTutorial() {
  endGameObjects();
  session = { kind: 'tutorial', save: null };
  const home = TEAMS[settings.home], away = TEAMS[settings.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, {
    difficulty: 'rookie', quarterMinutes: 12, userSide: 'home', playerLock: -1, tutorial: true, noFouls: true,
  }, hud);
  hookFx(game);
  setQuiet(false);
  stopMusic();
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
  tutorial = new Tutorial(game, tutUI);
}

// ---------- Online multiplayer ----------
const SFX_SKIP = new Set(['menu', 'select', 'levelUp', 'green']);
let sfxOriginal = null;
function patchSfx(queue) {
  // Host: every game sound is also sent to the guest
  sfxOriginal = {};
  for (const k of Object.keys(sfx)) {
    if (SFX_SKIP.has(k)) continue;
    const orig = sfx[k];
    sfxOriginal[k] = orig;
    sfx[k] = (...a) => { orig(...a); queue.push({ s: k, a }); };
  }
}
function unpatchSfx() { if (sfxOriginal) { Object.assign(sfx, sfxOriginal); sfxOriginal = null; } }

function closeOnline() {
  unpatchSfx();
  if (!online) return;
  const o = online; online = null;
  o.room.close();
}

function onlineError(msg) { $('#onError').textContent = msg || ''; }
function openOnline() {
  closeOnline();
  $('#onStart').hidden = false; $('#onLobby').hidden = true;
  onlineError('');
  show('online');
}
async function connectOnline(code, role, tries = 0) {
  onlineError('');
  if (tries === 0) {
    // Rooms need a valid login: check it first so an expired login gets a clear message
    $('#onCreate').disabled = $('#onJoin').disabled = true;
    const st = await checkSession();
    if (st !== 'ok') {
      $('#onCreate').disabled = $('#onJoin').disabled = false;
      if (st === 'none') { updateAccountUI(); showLogin(false); $('#loginError').textContent = 'Your login has expired. Please log in again.'; }
      else onlineError("Online play needs the game's login server, which isn't available here.");
      return;
    }
  }
  $('#onCreate').disabled = $('#onJoin').disabled = true;
  const o = { role, peer: false, home: settings.home, away: settings.away, q: Number(settings.q) > 5 ? 2 : Number(settings.q), playing: false, queue: [], acc: 0, statsT: 0, menu: false };
  o.room = new Room(code, role, {
    joined: (m) => {
      if (online !== o) return;
      o.peer = !!m.peer;
      $('#onCreate').disabled = $('#onJoin').disabled = false;
      $('#onStart').hidden = true; $('#onLobby').hidden = false;
      renderLobby();
      if (role === 'guest') o.room.send({ k: 'pick', team: o.away });
    },
    peerJoined: () => { if (online !== o) return; o.peer = true; sfx.select(); o.room.send({ k: 'lobby', home: o.home, away: o.away, q: o.q }); if (!o.playing) renderLobby(); },
    peerLeft: () => { if (online === o) peerGone(o); },
    message: (m) => { if (online === o) netMessage(o, m); },
    closed: (why) => {
      $('#onCreate').disabled = $('#onJoin').disabled = false;
      if (online !== o) return;
      // A fresh host code can clash with an existing room: just pick another
      if (role === 'host' && !o.room.joined && /in use/.test(why) && tries < 4) { connectOnline(makeCode(), 'host', tries + 1); return; }
      if (o.playing) { peerGone(o, true); return; }
      online = null;
      $('#onStart').hidden = false; $('#onLobby').hidden = true;
      if (shown() && shown().id === 'online') onlineError(why);
    },
  });
  online = o;
}
$('#onCreate').addEventListener('click', () => { sfx.select(); connectOnline(makeCode(), 'host'); });
$('#onJoin').addEventListener('click', () => {
  const code = $('#onCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { onlineError('Enter the 5-letter room code.'); return; }
  sfx.select(); connectOnline(code, 'guest');
});
$('#onCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#onJoin').click(); });
$('#onCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(online ? online.room.code : ''); $('#onCopy').textContent = 'Copied!'; } catch { $('#onCopy').textContent = 'Copy failed'; }
  setTimeout(() => { $('#onCopy').textContent = 'Copy'; }, 1500);
});
$('#onLeave').addEventListener('click', () => { sfx.menu(); openOnline(); });

function renderLobby() {
  const o = online;
  if (!o) return;
  const host = o.role === 'host';
  $('#onRoomCode').textContent = o.room.code;
  $('#onStatus').textContent = host
    ? (o.peer ? 'Your friend is here. Pick your team and start the game.' : 'Waiting for your friend to join with this code…')
    : 'Connected. Pick your team. The host starts the game.';
  const card = (el, idx, mine, who) => {
    const t = TEAMS[idx];
    el.style.setProperty('--tc', t.primary);
    const cr = el.querySelector('.crest');
    cr.textContent = t.id; cr.style.background = t.secondary; cr.style.borderColor = t.primary; cr.style.color = t.accent;
    el.querySelector('h3').textContent = `${t.city} ${t.name}`;
    el.querySelector('.ovr').innerHTML = `Team OVR <b>${t.ovr}</b>`;
    el.querySelector('.who').textContent = who;
    el.classList.toggle('mine', mine);
    el.querySelectorAll('.arrow').forEach((a) => { a.disabled = !mine; });
  };
  card($('#onHome'), o.home, host, host ? 'YOU' : 'HOST');
  card($('#onAway'), o.away, !host, host ? (o.peer ? 'FRIEND' : 'WAITING…') : 'YOU');
  $('#onQ').value = String(o.q); $('#onQ').disabled = !host;
  $('#onGo').hidden = !host; $('#onGo').disabled = !o.peer;
}
for (const [id, side] of [['#onHome', 'home'], ['#onAway', 'away']]) {
  const step = (d) => {
    const o = online;
    if (!o || (o.role === 'host') !== (side === 'home')) return;
    o[side] = (o[side] + d + TEAMS.length) % TEAMS.length;
    sfx.menu();
    if (o.role === 'host') o.room.send({ k: 'lobby', home: o.home, away: o.away, q: o.q }); else o.room.send({ k: 'pick', team: o.away });
    renderLobby();
  };
  $(`${id} .arrow.l`).addEventListener('click', () => step(-1));
  $(`${id} .arrow.r`).addEventListener('click', () => step(1));
}
$('#onQ').addEventListener('change', (e) => { if (online && online.role === 'host') { online.q = Number(e.target.value); online.room.send({ k: 'lobby', home: online.home, away: online.away, q: online.q }); } });
$('#onGo').addEventListener('click', () => { if (online && online.role === 'host' && online.peer) { sfx.select(); startOnlineHost(); } });

// Host HUD: show locally and forward to the guest
function makeNetHud(o) {
  const q = (h, a) => o.queue.push({ h, a });
  return {
    toast(...a) { hud.toast(...a); q('toast', a); },
    hideToast() { hud.hideToast(); q('hideToast', []); },
    feedback(...a) { hud.feedback(...a); q('feedback', a); },
    scored(team, pts, p) { hud.scored(team, pts, p); o.statsT = 99; q('scored', [team.isHome ? 0 : 1, pts, game.idOf(p)]); },
    timeout(g, team) { hud.timeout(g, team); o.statsT = 99; q('timeout', [team.isHome ? 0 : 1]); },
    hideTimeout() { hud.hideTimeout(); q('hideTimeout', []); },
    gameOver(g) { hud.gameOver(g); o.statsT = 99; q('over', []); },
  };
}

function startOnlineHost() {
  const o = online;
  endGameObjects();
  session = { kind: 'online', save: null };
  const home = TEAMS[o.home], away = TEAMS[o.away];
  buildWorld(home, away);
  o.remote = makeRemoteInput();
  o.queue = [];
  game = new Game(scene, arena, home, away, { difficulty: 'pro', quarterMinutes: o.q, userSide: 'home', playerLock: -1, versus: true, remoteInput: o.remote, autoSubs: settings.autoSubs }, makeNetHud(o));
  hookFx(game);
  attachAnnouncer(game); attachCrowd(game, arena);
  game.on((type, d) => { const e = packEvent(game, type, d); if (e) o.queue.push(e); });
  patchSfx(o.queue);
  setQuiet(false); stopMusic();
  game.state = 'intro'; // frozen until the guest has loaded
  o.playing = true; o.ready = false; o.menu = false;
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
  hud.toast('GET READY', 'Waiting for your friend to load…', 30);
  o.room.send({ k: 'start', home: o.home, away: o.away, q: o.q });
}

function startOnlineGuest(m) {
  const o = online;
  endGameObjects();
  session = { kind: 'online', save: null };
  o.home = m.home; o.away = m.away; o.q = m.q;
  const home = TEAMS[o.home], away = TEAMS[o.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, { difficulty: 'pro', quarterMinutes: o.q, userSide: 'away', playerLock: -1, versus: true, guest: true }, hud);
  game.guest = true;
  game.state = 'intro';
  hookFx(game);
  attachAnnouncer(game); attachCrowd(game, arena);
  o.sender = makeInputSender(input);
  setQuiet(false); stopMusic();
  o.playing = true; o.menu = false;
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
  hud.toast('GET READY', `You're the ${away.name} (away)`, 3);
  o.room.send({ k: 'ready' });
}

function netMessage(o, m) {
  if (m.k === 'lobby' && o.role === 'guest' && !o.playing) { o.home = m.home; o.q = m.q; renderLobby(); }
  else if (m.k === 'pick' && o.role === 'host' && !o.playing) { o.away = m.team; renderLobby(); o.room.send({ k: 'lobby', home: o.home, away: o.away, q: o.q }); }
  else if (m.k === 'start' && o.role === 'guest') startOnlineGuest(m);
  else if (m.k === 'ready' && o.role === 'host' && o.playing && game && !o.ready) {
    o.ready = true;
    hud.hideToast();
    game.begin();
    sfx.cheer(0.8);
  } else if (m.k === 'i' && o.role === 'host' && o.remote) o.remote.receive(m);
  else if (m.k === 's' && o.role === 'guest' && game && game.guest) {
    applySnapshot(game, m);
    for (const ev of m.ev || []) guestEvent(ev);
  }
}

const flip = { '#3dff7a': '#ff3b3b', '#ff3b3b': '#3dff7a' };
function guestEvent(ev) {
  const g = game;
  if (ev.s) { if (sfx[ev.s]) sfx[ev.s](...(ev.a || [])); return; }
  if (ev.e) { g.emit(ev.e, unpackEvent(g, ev)); return; }
  const a = ev.a || [];
  switch (ev.h) {
    case 'toast': hud.toast(...a); break;
    case 'hideToast': hud.hideToast(); break;
    case 'feedback': hud.feedback(a[0], flip[a[1]] || a[1]); break; // good for them is bad for us
    case 'scored': { const p = g.playerById(a[2]); if (p) hud.scored(g.teams[a[0]], a[1], p); break; }
    case 'timeout': hud.timeout(g, g.teams[a[0]]); break;
    case 'hideTimeout': hud.hideTimeout(); break;
    case 'over': g.state = 'over'; hud.gameOver(g); break;
    default: break;
  }
}

// Host: send the game state ~30 times a second
function netHostTick(dt) {
  const o = online;
  o.acc += dt; o.statsT += dt;
  if (o.acc < 1 / 30 || !o.peer) { if (!o.peer) o.queue.length = 0; return; }
  o.acc = 0;
  const withStats = o.statsT >= 1;
  if (withStats) o.statsT = 0;
  const s = snapshot(game, withStats);
  if (o.queue.length) s.ev = o.queue.splice(0);
  o.room.send(s);
}
// Guest: send our controls ~30 times a second
function netGuestTick(dt) {
  const o = online;
  if (!o || !o.sender) return;
  o.sender.frame();
  o.acc += dt;
  if (o.acc < 1 / 30) return;
  o.acc = 0;
  o.room.send(o.sender.message());
}

function peerGone(o, lostConnection = false) {
  if (!o.playing) { o.peer = false; if (o.role === 'host' && !lostConnection) renderLobby(); return; }
  if (o.role === 'host' && game && !game.guest) {
    // Keep playing: the CPU takes over the other team
    o.peer = false;
    game.away.input = null; game.away.human = false;
    if (game.state === 'intro') game.begin();
    hud.toast('OPPONENT LEFT', 'The CPU has taken over their team', 3);
  } else {
    hud.toast(lostConnection ? 'CONNECTION LOST' : 'HOST LEFT THE GAME', 'Returning to the menu…', 3);
    setTimeout(() => { if (online === o || !online) { quitToMenu(); openOnline(); onlineError(lostConnection ? 'Connection lost.' : 'The host left the game.'); } }, 2600);
  }
}

// ---------- Season & My Career ----------
let hubTab = 'standings';
let snTeam = 0;
let pendingCareer = null;
const SKINS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#a0673a', '#8d5524', '#5c3a1e', '#3d2716'];
const HAIRS = ['#111111', '#2b1b10', '#5a3a1a', '#8a6a3a', '#c9a26b', '#b23a2e', '#e8e8e8'];
const create = { arch: 'sharpshooter', skin: SKINS[3], hair: HAIRS[0], hairStyle: 1 };

function cardHTML(c, teamIdx) {
  const ovr = Season.careerOvr(c), t = Season.tier(ovr);
  const r = c.ratings;
  const team = teamIdx != null ? TEAMS[teamIdx] : null;
  // Portrait rendered from the 3D player model (falls back to a simple drawn face)
  const img = portrait({ skin: c.skin, hair: c.hair, hairStyle: c.hairStyle, jersey: team ? team.primary : '#e9edf5', trim: team ? team.accent : '#35f0ff' });
  const face = img
    ? `<div class="face3d" data-num="#${c.number}"><img src="${img}" alt=""></div>`
    : `<div class="face" data-num="#${c.number}" style="--skin:${c.skin};--hair:${c.hair};--hairShow:${c.hairStyle === 0 ? 'none' : 'block'}"></div>`;
  return `<div class="pcard ${t.cls}">
    <div class="top"><div class="ovr">${ovr}<small>${['PG', 'SG', 'SF', 'PF', 'C'][c.pos]}</small></div><span class="tier">${t.name}</span></div>
    ${face}
    <div class="name">${esc(c.first || 'Your')} ${esc(c.last || 'Player')}<small>${Season.ARCHETYPES[c.archetype].label}${team ? ` · ${team.name}` : ''}</small></div>
    <div class="attrs"><span><b>${r.three}</b>3PT</span><span><b>${r.inside}</b>FIN</span><span><b>${r.pass}</b>PAS</span><span><b>${r.handle}</b>HND</span><span><b>${r.def}</b>DEF</span><span><b>${r.reb}</b>REB</span></div>
  </div>`;
}

function openHub(kind, slot = 1) {
  if (kind === 'career') careerSlot = slot;
  const s = Season.load(kind, slot);
  if (!s) { if (kind === 'career') openCareerCreate(); else openSeasonNew('season'); return; }
  session = { kind, save: s };
  hubTab = kind === 'career' ? 'upgrades' : 'standings';
  maybeChampion(s) || (renderHub(), show('hub'));
}

function openSeasonNew(kind) {
  $('#snTitle').textContent = kind === 'career' ? 'Choose Your Team' : 'New Season';
  $('#snStart').textContent = kind === 'career' ? 'Start Career' : 'Start Season';
  $('#snStart').dataset.kind = kind;
  $('#snDiff').value = settings.diff; $('#snQ').value = settings.q;
  const draw = () => {
    $('#snTeams').innerHTML = TEAMS.map((t, i) => `<button class="team-pick${i === snTeam ? ' sel' : ''}" data-i="${i}" style="--tc:${t.primary}">${crest(t)}<span><b>${t.city} ${t.name}</b><small>${t.ovr} OVR</small></span></button>`).join('');
    $$('#snTeams .team-pick').forEach((el) => el.addEventListener('click', () => { snTeam = Number(el.dataset.i); sfx.menu(); draw(); }));
  };
  draw();
  show('seasonNew');
}
$('#snStart').addEventListener('click', () => {
  const kind = $('#snStart').dataset.kind;
  const diff = $('#snDiff').value, q = Number($('#snQ').value);
  const s = Season.newSeason({ kind, team: snTeam, diff, q, career: kind === 'career' ? pendingCareer : null, slot: kind === 'career' ? careerSlot : 1 });
  pendingCareer = null;
  sfx.select();
  session = { kind, save: s };
  hubTab = kind === 'career' ? 'upgrades' : 'standings';
  renderHub(); show('hub');
});

function openCareerCreate() {
  const preview = () => {
    const c = Season.newCareerPlayer({ first: $('#cnFirst').value.trim(), last: $('#cnLast').value.trim(), pos: Number($('#cnPos').value), number: Math.max(0, Math.min(99, Number($('#cnNum').value) || 0)), archetype: create.arch, skin: create.skin, hair: create.hair, hairStyle: create.hairStyle });
    // Stable preview numbers: use archetype base without the random spread
    $('#cnCard').innerHTML = cardHTML(c);
    return c;
  };
  const chips = () => {
    // New players start around 70 OVR, so only the starter styles are open; the others unlock as you improve
    // Every style is listed; the ones that suit the chosen position come first and say so
    const posIdx = Number($('#cnPos').value) || 0;
    const POSN = ['PG', 'SG', 'SF', 'PF', 'C'];
    const fits = (a) => a.pos.includes(posIdx);
    const styles = Object.entries(Season.ARCHETYPES).sort((x, y) => (fits(y[1]) ? 1 : 0) - (fits(x[1]) ? 1 : 0));
    $('#cnArch').innerHTML = styles.map(([k, a]) => {
      const locked = a.unlock > 0;
      const tag = a.pos.length === 5 ? 'ALL' : a.pos.map((i) => POSN[i]).join(' · ');
      return `<button class="${k === create.arch ? 'on' : ''}${locked ? ' locked' : ''}${fits(a) ? ' fit' : ''}" data-k="${k}" ${locked ? 'disabled' : ''}><span class="pos-tag">${tag}</span>${locked ? '🔒 ' : ''}${a.label}<small>${locked ? `Unlocks at ${a.unlock} OVR` : a.desc}</small>${fits(a) ? '<small class="fitnote">✓ Fits your position</small>' : ''}</button>`;
    }).join('');
    $('#cnSkin').innerHTML = SKINS.map((c) => `<button class="${c === create.skin ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Skin tone"></button>`).join('');
    $('#cnHair').innerHTML = HAIRS.map((c) => `<button class="${c === create.hair ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Hair color"></button>`).join('');
    $('#cnHairStyle').innerHTML = HAIR_STYLES.map((n, i) => `<button class="${i === create.hairStyle ? 'on' : ''}" data-i="${i}">${n}</button>`).join('');
    $$('#cnArch button').forEach((b) => b.addEventListener('click', () => { create.arch = b.dataset.k; sfx.menu(); chips(); }));
    $$('#cnSkin button').forEach((b) => b.addEventListener('click', () => { create.skin = b.dataset.c; chips(); }));
    $$('#cnHair button').forEach((b) => b.addEventListener('click', () => { create.hair = b.dataset.c; chips(); }));
    $$('#cnHairStyle button').forEach((b) => b.addEventListener('click', () => { create.hairStyle = Number(b.dataset.i); chips(); }));
    preview();
  };
  for (const id of ['#cnFirst', '#cnLast', '#cnNum']) $(id).oninput = preview;
  $('#cnPos').oninput = chips; $('#cnPos').onchange = chips;
  $('#cnNext').onclick = () => {
    const c = preview();
    if (!c.first) c.first = 'Rookie';
    if (!c.last) c.last = 'Star';
    pendingCareer = c;
    sfx.select();
    openSeasonNew('career');
  };
  chips();
  show('careerNew');
}

function renderHub() {
  const s = session.save, kind = session.kind;
  const team = TEAMS[s.team];
  const table = Season.standings(s);
  const rank = table.findIndex((x) => x.team === s.team) + 1;
  $('#hubTitle').textContent = kind === 'career' ? `My Career · Year ${s.year}` : `Season · Year ${s.year}`;
  $('#hubSub').textContent = `${team.city} ${team.name} · ${Season.record(s, s.team)} · ${rank}${['st', 'nd', 'rd'][rank - 1] || 'th'} place · ${DIFFICULTY[s.diff].label} · ${s.q}-min quarters`;
  $('#hubCard').innerHTML = kind === 'career'
    ? `${cardHTML(s.career, s.team)}<div style="text-align:center;margin-top:10px"><span class="rp">${s.career.rp} Rep Points</span></div>`
    : `<div class="box" style="text-align:center;padding:18px"><div style="display:inline-block">${crest(team, 'crest')}</div><style>#hubCard .crest{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font-family:var(--display);font-size:22px;border:4px solid}</style><h3 style="margin:10px 0 2px">${team.city} ${team.name}</h3><span class="hint">${Season.record(s, s.team)} · Team OVR ${team.ovr}</span></div>`;

  // What your player did in the game that was just simmed
  const ls = session.lastSim, simBox = $('#simResult');
  if (kind === 'career' && ls && ls.line) {
    const L = ls.line;
    simBox.hidden = false;
    simBox.innerHTML = `<h4 style="margin:2px 0 8px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#ffd60a">Simulated game</h4>
      <div class="reward"><span class="grade">${ls.reward.grade}</span><div><small>${ls.won ? 'Win' : 'Loss'} ${ls.us}-${ls.them} vs ${esc(ls.opp.name)}</small><b>${L.pts} PTS · ${L.reb} REB · ${L.ast} AST</b><br><span class="rp">+${ls.reward.rp} Rep Points</span></div></div>
      <p class="hint" style="text-align:left;margin:8px 0 0;font-size:12px">FG ${L.fgm}-${L.fga} · 3PT ${L.tpm}-${L.tpa} · FT ${L.ftm}-${L.fta} · ${L.stl} STL · ${L.blk} BLK · ${L.to} TO</p>`;
  } else simBox.hidden = true;

  // Next game panel
  const ng = Season.nextGame(s);
  const nx = $('#hubNext');
  if (ng) {
    const h = TEAMS[ng.h], a = TEAMS[ng.a];
    nx.innerHTML = `<h4>${ng.stage}</h4><div class="mu"><span>${a.id}<small>${Season.record(s, ng.a)}</small></span><span style="color:var(--muted)">at</span><span>${h.id}<small>${Season.record(s, ng.h)}</small></span></div>
      ${kind === 'career' ? `<div class="ctl-pick"><small>In games you control</small><div class="seg" id="hubControl">
        <button data-v="player" class="${s.control !== 'team' ? 'on' : ''}">Just my player</button>
        <button data-v="team" class="${s.control === 'team' ? 'on' : ''}">Whole team</button></div>
        <p>${s.control === 'team' ? 'You switch between all five players, like a normal game.' : `You stay on ${esc(s.career.first)} the whole game. Teammates play on their own. Press Pass to call for the ball.`}</p></div>` : ''}
      <button class="primary" id="hubPlay">Play Game</button><button id="hubSim">Simulate</button>`;
    $$('#hubControl button').forEach((b) => b.addEventListener('click', () => { s.control = b.dataset.v; Season.save(s); sfx.menu(); renderHub(); }));
    $('#hubPlay').onclick = () => playHubGame();
    $('#hubSim').onclick = () => {
      const r = Season.simUserGame(s);
      sfx.menu();
      if (r && r.line) { const home = r.h === s.team; session.lastSim = { ...r, us: home ? r.hs : r.as, them: home ? r.as : r.hs, opp: TEAMS[home ? r.a : r.h] }; }
      maybeChampion(s) || renderHub();
    };
  } else {
    const ch = s.playoffs && s.playoffs.champion != null ? TEAMS[s.playoffs.champion] : null;
    nx.innerHTML = `<h4>Season complete</h4><p style="margin:6px 0;font-size:14px">${ch ? `🏆 ${ch.city} ${ch.name} are champions.` : 'Your season is over.'}</p>
      <button class="primary" id="hubNextYear">Start Year ${s.year + 1}</button>`;
    $('#hubNextYear').onclick = () => { session.save = Season.nextYear(s); sfx.select(); renderHub(); };
  }

  // Tabs
  const tabs = [...(kind === 'career' ? [['upgrades', 'Upgrades'], ['log', 'My Games']] : []), ['tactics', 'Tactics'], ['kit', 'Kit'], ['standings', 'Standings'], ['schedule', 'Schedule'], ['stats', 'Team Stats'], ['playoffs', 'Playoffs'], ['options', 'Options']];
  $('#hubTabs').innerHTML = tabs.map(([k, l]) => `<button class="${k === hubTab ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
  $$('#hubTabs button').forEach((b) => b.addEventListener('click', () => { hubTab = b.dataset.k; sfx.menu(); renderHub(); }));
  const body = $('#hubTab');
  const tname = (i) => `<span class="dot" style="background:${TEAMS[i].primary}"></span>${TEAMS[i].city} ${TEAMS[i].name}`;
  if (hubTab === 'standings') {
    body.innerHTML = `<table class="lg"><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>PF</th><th>PA</th><th>DIFF</th></tr>${table.map((r, i) =>
      `<tr class="${r.team === s.team ? 'me' : ''}${i === 3 ? ' cut' : ''}"><td>${i + 1}</td><td>${tname(r.team)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.w + r.l ? (r.w / (r.w + r.l)).toFixed(3).slice(1) : '.000'}</td><td>${r.pf}</td><td>${r.pa}</td><td>${r.pf - r.pa > 0 ? '+' : ''}${r.pf - r.pa}</td></tr>`).join('')}</table><p class="hint" style="text-align:left">Top 4 make the playoffs.</p>`;
  } else if (hubTab === 'schedule') {
    body.innerHTML = `<table class="lg"><tr><th>#</th><th>Opponent</th><th></th><th>Result</th></tr>${s.schedule.map((round, i) => {
      const g = round.find((x) => x.h === s.team || x.a === s.team);
      const home = g.h === s.team, opp = home ? g.a : g.h;
      let res = i === s.round ? '<span style="color:#ffd60a">NEXT</span>' : '—';
      if (g.hs != null) { const us = home ? g.hs : g.as, them = home ? g.as : g.hs; res = `<span class="${us > them ? 'res-w' : 'res-l'}">${us > them ? 'W' : 'L'}</span> ${us}-${them}`; }
      return `<tr><td>${i + 1}</td><td>${tname(opp)}</td><td>${home ? 'Home' : 'Away'}</td><td>${res}</td></tr>`;
    }).join('')}</table>`;
  } else if (hubTab === 'stats') {
    const rows = Object.values(s.stats).filter((r) => r.gp > 0).sort((a, b) => b.pts / b.gp - a.pts / a.gp);
    const avg = (v, gp) => (v / gp).toFixed(1);
    body.innerHTML = rows.length ? `<table class="lg"><tr><th>Pos</th><th>Player</th><th>GP</th><th>PPG</th><th>RPG</th><th>APG</th><th>SPG</th><th>BPG</th><th>FG%</th><th>3P%</th></tr>${rows.map((r) =>
      `<tr><td>${r.pos}</td><td>${esc(r.name)}</td><td>${r.gp}</td><td>${avg(r.pts, r.gp)}</td><td>${avg(r.reb, r.gp)}</td><td>${avg(r.ast, r.gp)}</td><td>${avg(r.stl, r.gp)}</td><td>${avg(r.blk, r.gp)}</td><td>${r.fga ? Math.round(r.fgm / r.fga * 100) : 0}</td><td>${r.tpa ? Math.round(r.tpm / r.tpa * 100) : 0}</td></tr>`).join('')}</table>`
      : '<p class="hint">Play a game to see your team\'s stats. Simulated games don\'t record player stats.</p>';
  } else if (hubTab === 'playoffs') {
    const p = s.playoffs;
    if (!p) body.innerHTML = `<p class="hint">The playoffs start after game ${s.schedule.length}. The top 4 teams qualify: 1 vs 4 and 2 vs 3, then the final.</p>`;
    else {
      const gm = (g) => (g ? `<div class="g"><div class="${g.hs != null && g.hs > g.as ? 'w' : ''}"><span>${tname(g.h)}</span><span>${g.hs ?? ''}</span></div><div class="${g.hs != null && g.as > g.hs ? 'w' : ''}"><span>${tname(g.a)}</span><span>${g.as ?? ''}</span></div></div>` : '<div class="g"><div><span>TBD</span></div><div><span>TBD</span></div></div>');
      body.innerHTML = `<div class="bracket"><div class="col"><h5>Semifinals</h5>${p.semis.map(gm).join('')}</div><div class="col"><h5>Final</h5>${gm(p.final)}</div><div class="col"><h5>Champion</h5><div class="g">${p.champion != null ? `🏆 ${tname(p.champion)}` : 'TBD'}</div></div></div>`;
    }
  } else if (hubTab === 'upgrades') {
    const c = s.career;
    body.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px 8px"><span class="hint" style="margin:0;text-align:left">Earn Rep Points by playing games. Better grades earn more. Rival teams grow stronger every year${Season.leagueGrowth(s.year) ? ` (+${Math.round(Season.leagueGrowth(s.year))} rating this year)` : ''}.</span><span class="rp">${c.rp}</span></div>` +
      Season.ATTRS.map(([k, l]) => {
        const cost = Season.upgradeCost(c.ratings[k]);
        return `<div class="upg"><span>${l}</span><b>${c.ratings[k]}</b><div class="bar"><i style="width:${c.ratings[k]}%"></i></div><button data-k="${k}" ${c.rp < cost ? 'disabled' : ''}>${cost === Infinity ? 'MAX' : `+1 · ◆${cost}`}</button></div>`;
      }).join('') + (() => {
        const ovr = Season.careerOvr(c), extra = Season.extraStyles(c);
        return `<h4 class="ps-h">Play Styles <small>Unlock with OVR · equip up to ${Season.MAX_EXTRA_STYLES} extras (+40% of their boosts)</small></h4><div class="ps-grid">` +
          Object.entries(Season.ARCHETYPES).sort((x, y) => (y[1].pos.includes(c.pos) ? 1 : 0) - (x[1].pos.includes(c.pos) ? 1 : 0)).map(([k, a]) => {
            const posTag = a.pos.length === 5 ? 'ALL' : a.pos.map((i) => ['PG', 'SG', 'SF', 'PF', 'C'][i]).join(' · ');
            const primary = k === c.archetype, on = extra.includes(k), open = Season.styleUnlocked(ovr, k, c);
            const status = primary ? '<em>Primary</em>' : !open ? `<em>🔒 ${a.unlock} OVR</em>` : on ? '<em class="on">Equipped</em>' : extra.length >= Season.MAX_EXTRA_STYLES ? '<em>Slots full</em>' : '<em>Tap to equip</em>';
            return `<button class="ps${primary || on ? ' on' : ''}${open ? '' : ' locked'}${a.pos.includes(c.pos) ? ' fit' : ''}" data-ps="${k}" ${primary || !open ? 'disabled' : ''}><span class="pos-tag">${posTag}</span><b>${a.label}</b><small>${PERK_TEXT[k] || a.desc}</small>${status}</button>`;
          }).join('') + '</div>';
      })();
    $$('#hubTab .ps').forEach((b) => b.addEventListener('click', () => { if (Season.toggleStyle(s, b.dataset.ps)) { sfx.select(); renderHub(); } }));
    $$('#hubTab .upg button').forEach((b) => b.addEventListener('click', () => {
      const before = Season.tier(Season.careerOvr(c)).name;
      if (Season.upgrade(s, b.dataset.k)) { if (Season.tier(Season.careerOvr(c)).name !== before) sfx.levelUp(); else sfx.select(); renderHub(); }
    }));
  } else if (hubTab === 'kit') {
    body.innerHTML = `<div style="display:flex;align-items:center;gap:14px;padding:6px 4px">${crest(team, 'crest')}<div><b>${team.city} ${team.name}</b><div class="hint" style="margin:2px 0 0;text-align:left">Change your colors, logo and shoes. Your players wear them in every game.</div></div></div><div class="row"><button id="hubKit" class="primary">Customize kit &amp; shoes</button></div>`;
    $('#hubKit').addEventListener('click', () => { sfx.menu(); openKit(team, () => { renderHub(); show('hub'); }); });
  } else if (hubTab === 'tactics') {
    const t = getTactics(team), tr = tacTraits(t.vals);
    body.innerHTML = `<div class="box"><div class="line"><span>Tactical preset</span><span>${t.preset === 'custom' ? 'CUSTOM' : PRESETS[t.preset].label}</span></div>` +
      SLIDERS.map((sl) => `<div class="line"><span>${sl.label}</span><span>${t.vals[sl.k]}</span></div>`).join('') + '</div>' +
      `<div class="tac-traits" style="margin:10px 4px">${tr.good.map((x) => `<div class="g">✓ <span>${x}</span></div>`).join('')}${tr.bad.map((x) => `<div class="b">! <span>${x}</span></div>`).join('')}</div>` +
      '<div class="row"><button id="hubTactics" class="primary">Edit tactics</button></div>';
    $('#hubTactics').addEventListener('click', () => { sfx.menu(); openTactics(team, () => { renderHub(); show('hub'); }); });
  } else if (hubTab === 'log') {
    const c = s.career;
    const g = Math.max(1, c.games);
    body.innerHTML = `<div class="to-stats" style="margin-bottom:10px"><div class="box"><div class="line"><span>Games played</span><span>${c.games}</span></div><div class="line"><span>Points per game</span><span>${(c.totals.pts / g).toFixed(1)}</span></div><div class="line"><span>Rebounds per game</span><span>${(c.totals.reb / g).toFixed(1)}</span></div><div class="line"><span>Assists per game</span><span>${(c.totals.ast / g).toFixed(1)}</span></div></div>
      <div class="box"><div class="line"><span>Career high</span><span>${c.best.pts} PTS</span></div><div class="line"><span>Championships</span><span>${c.titles}</span></div><div class="line"><span>Rep Points earned</span><span>${c.earned}</span></div><div class="line"><span>Upgrades bought</span><span>${c.upgrades}</span></div></div></div>` +
      (c.log.length ? `<table class="lg"><tr><th></th><th>Recent games</th><th>PTS</th><th>REB</th><th>AST</th><th>Grade</th><th>Rep</th></tr>${c.log.map((l) => `<tr><td><span class="${l.won ? 'res-w' : 'res-l'}">${l.won ? 'W' : 'L'}</span></td><td></td><td>${l.pts}</td><td>${l.reb}</td><td>${l.ast}</td><td>${l.grade}</td><td>+${l.rp}</td></tr>`).join('')}</table>` : '<p class="hint">Play your first game to start your story.</p>');
  } else if (hubTab === 'options') {
    body.innerHTML = `<div class="options" style="justify-content:flex-start;padding:8px">
      <label>Difficulty<select id="hubDiff">${Object.entries(DIFFICULTY).map(([k, d]) => `<option value="${k}" ${k === s.diff ? 'selected' : ''}>${d.label}</option>`).join('')}</select></label>
      <label>&nbsp;<button id="hubDelete" style="padding:10px 14px;border-radius:8px;border:1px solid #ff5a5a;background:transparent;color:#ff5a5a;font-weight:700">Delete this ${kind === 'career' ? 'career' : 'season'}</button></label></div>`;
    $('#hubDiff').onchange = (e) => { s.diff = e.target.value; Season.save(s); renderHub(); };
    let armed = false;
    $('#hubDelete').onclick = (e) => {
      if (!armed) { armed = true; e.target.textContent = 'Click again to confirm'; return; }
      Season.clear(kind, s.slot || 1); session = { kind: 'quick', save: null }; renderHome();
      if (kind === 'career') openSlots(); else show('menu');
    };
  }
}
$('#hubBack').addEventListener('click', () => { sfx.menu(); renderHome(); if (session.kind === 'career') openSlots(); else show('menu'); });

// ---------- Career slots (up to 3 players) ----------
function openSlots() {
  let html = '';
  for (let i = 1; i <= Season.CAREER_SLOTS; i++) {
    const s = Season.load('career', i);
    html += s
      ? `<div class="slot" data-i="${i}"><div class="open">${cardHTML(s.career, s.team)}</div>
          <div class="meta">${TEAMS[s.team].city} ${TEAMS[s.team].name} · ${Season.record(s, s.team)} · Year ${s.year}</div>
          <div class="btns"><button class="primary open">Continue</button><button class="del">Delete</button></div></div>`
      : `<div class="slot" data-i="${i}"><button class="empty open"><b>+</b>Empty slot ${i}<span class="hint" style="margin:0">Create a player</span></button></div>`;
  }
  $('#slotGrid').innerHTML = html;
  $$('#slotGrid .slot').forEach((el) => {
    const i = Number(el.dataset.i);
    el.querySelectorAll('.open').forEach((b) => b.addEventListener('click', () => { sfx.select(); openHub('career', i); }));
    const del = el.querySelector('.del');
    if (del) del.addEventListener('click', () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Really delete?'; return; }
      Season.clear('career', i); sfx.menu(); renderHome(); openSlots();
    });
  });
  show('slots');
}

// ---------- Practice mode ----------
// ---------- Contests: 3-point and dunk ----------
let contest = null;
const BEST_KEY = 'pph-contest-best';
const bestScores = () => { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; } };
function saveBest(k, v) {
  const b = bestScores();
  if (b[k] >= v) return false;
  b[k] = v;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* ignore */ }
  return true;
}
function renderContestsHome() {
  const b = bestScores();
  $('#cstBest').textContent = `Best 3-point score: ${b.three ?? '-'} / 30   ·   Best dunk score: ${b.dunk ?? '-'} / 90`;
}
$('#tileContests').addEventListener('click', () => { initAudio(); sfx.select(); renderContestsHome(); show('contests'); });
$('#cstThree').addEventListener('click', () => { initAudio(); sfx.select(); startContest('three'); });
$('#cstDunk').addEventListener('click', () => { initAudio(); sfx.select(); startContest('dunk'); });
$('#crMenu').addEventListener('click', () => { sfx.menu(); quitToMenu(); });
$('#crAgain').addEventListener('click', () => { sfx.select(); startContest(contest ? contest.kind : 'three'); });

const DUNK_STYLES = [
  { k: 'twohand', label: 'Two-Hand', diff: 6.6 },
  { k: 'onehand', label: 'One-Hand', diff: 7.1 },
  { k: 'windmill', label: 'Windmill', diff: 8.2 },
  { k: 'tomahawk', label: 'Tomahawk', diff: 8.7 },
];

function startContest(kind) {
  endGameObjects();
  session = { kind: 'contest', save: null };
  const home = TEAMS[settings.home], away = TEAMS[settings.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, {
    difficulty: 'rookie', quarterMinutes: 12, userSide: 'home', playerLock: -1, tutorial: true, practice: true, noFouls: true, noTimeouts: true, contest: kind,
  }, hud);
  hookFx(game);
  game.tutorialPossession = 'user';
  attachAnnouncer(game); attachCrowd(game, arena);
  setQuiet(false); stopMusic();
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  game.practiceDefense = 'passive';
  game.setTeamSize(game.user, 1);
  game.setTeamSize(game.cpu, 0);
  const dir = game.user.dir;
  const me = game.user.players[0];
  contest = { kind, over: false, wait: 0, me, dir, lastShots: 0 };
  if (kind === 'three') {
    // Five racks around the arc, each with four balls worth 1 and a money ball worth 2
    const R = C.THREE_R + 0.45;
    contest.spots = [-80, -40, 0, 40, 80].map((deg) => {
      const a = deg * Math.PI / 180;
      return new THREE.Vector3(dir * (C.HOOP_X - R * Math.cos(a)), 0, R * Math.sin(a));
    });
    Object.assign(contest, { rack: 0, ball: 0, pts: 0, t: 70, started: false, pending: false, moneyNow: false });
    contestSpot(true);
  } else {
    Object.assign(contest, { round: 0, phase: 'pick', style: 'twohand', scores: [], running: false, runT: 0, judged: false, doneT: 0 });
    contestDunkPlace();
  }
  game.on((type, d) => contestEvent(type, d));
  show(null);
  $('#hud').classList.add('show');
  renderContestPanel();
  hud.toast(kind === 'three' ? '3-POINT CONTEST' : 'DUNK CONTEST', kind === 'three' ? 'Shoot from each rack. The last ball is worth 2.' : 'Pick a style and go. Three judges score each dunk.', 3);
}

function contestSpot(first) {
  const c = contest, g = game;
  const s = c.spots[c.rack];
  c.me.pos.copy(s); c.me.vel.set(0, 0, 0);
  c.me.facing = c.me.targetFacing = Math.atan2(c.dir * C.HOOP_X - s.x, -s.z);
  g.forcePossession(c.me);
  c.moneyNow = c.ball === 4;
  if (!first && c.ball === 0) hud.toast(`RACK ${c.rack + 1} OF 5`, 'Next spot', 1.4);
}

function contestDunkPlace() {
  const c = contest, g = game;
  c.me.pos.set(c.dir * (C.HOOP_X - 11), 0, 0); c.me.vel.set(0, 0, 0);
  c.me.facing = c.me.targetFacing = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  g.forcePossession(c.me);
  c.running = false; c.judged = false; c.phase = 'pick';
  renderContestPanel();
}

function contestEvent(type, d) {
  const c = contest;
  if (!c || c.over || !d.player || d.player !== c.me) return;
  if (c.kind === 'three') {
    if (type === 'shot') { c.pending = true; c.ball++; }
    else if (type === 'score' && c.pending) { if (d.pts === 3) { const v = c.moneyNow ? 2 : 1; c.pts += v; hud.feedback(c.moneyNow ? 'MONEY BALL! +2' : '+1', '#ffd60a'); } c.pending = false; c.wait = 0; }
    else if (type === 'miss' && c.pending) { c.pending = false; c.wait = 0; }
  } else if (type === 'score' && !c.judged && (d.kind === 'dunk' || d.kind === 'layup')) {
    c.judged = true; c.doneT = 0;
    const st = DUNK_STYLES.find((s) => s.k === c.style) || DUNK_STYLES[0];
    const judges = [0, 1, 2].map(() => Math.max(5, Math.min(10, +(st.diff + (c.me.r.dunk - 70) / 60 + (Math.random() - 0.4) * 1.4).toFixed(1))));
    const total = +judges.reduce((a, b) => a + b, 0).toFixed(1);
    c.scores.push({ style: st.label, judges, total });
    sfx.cheer(1);
    c.judgesShown = { judges, total, style: st.label };
    renderContestPanel();
  }
}

function contestUpdate(dt) {
  const c = contest, g = game;
  if (!c || c.over || !g) return;
  if (c.kind === 'three') {
    if (c.started) c.t -= dt;
    if (g.state === 'live' && (c.pending || g.ball.state === 'shot')) c.started = true;
    const busy = g.ball.state === 'shot' || g.ball.state === 'pass';
    const mine = g.ball.state === 'held' && g.ball.holder === c.me;
    if (c.t <= 0 && !busy) { finishContest(); return; }
    if (!mine && !busy && !c.pending) {
      c.wait += dt;
      if (c.wait > 0.9) {
        c.wait = 0;
        if (c.ball >= 5) { c.rack++; c.ball = 0; if (c.rack >= 5) { finishContest(); return; } }
        contestSpot(false);
      }
    }
    c.lastT = c.lastT || 0; c.lastT += dt;
    if (c.lastT > 0.2) { c.lastT = 0; renderContestPanel(); }
  } else {
    const me = c.me;
    if (c.running) {
      // Scripted run-up: a stand-in controller sprints at the rim, then the dunk takes over
      c.runT += dt;
      const hoop = g.hoopOf(g.user);
      const dx = hoop.x - me.pos.x, dist = Math.abs(dx);
      if (dist > 2.45 || me.state !== 'idle') { c.fake.moveX = Math.sign(dx); }
      if (c.runT > 9) { g.user.input = c.realInput; contestDunkPlace(); return; }   // safety: restart the run
      if (dist <= 2.45 && me.state === 'idle' && g.ball.holder === me) {
        me.forceDunkStyle = c.style;
        g.user.input = c.realInput;
        g.startShot(me);
        c.running = false;
      }
    } else if (c.judged) {
      c.doneT += dt;
      if (c.doneT > 3.2 && me.state === 'idle') {
        c.round++;
        c.judgesShown = null;
        if (c.round >= 3) { finishContest(); return; }
        contestDunkPlace();
      }
    }
  }
}

function contestGo() {
  const c = contest;
  if (!c || c.kind !== 'dunk' || c.phase !== 'pick' || c.over) return;
  c.phase = 'run'; c.running = true; c.runT = 0; c.judgesShown = null;
  c.realInput = game.user.input;
  const none = new Proxy({}, { get: () => false });
  c.fake = { moveX: 0, moveY: 0, sprint: true, pressed: none, held: none, usingGamepad: false };
  game.user.input = c.fake;
  sfx.select();
  renderContestPanel();
}

function renderContestPanel() {
  const p = $('#contestPanel'), c = contest;
  if (!c) { p.classList.remove('show'); return; }
  p.classList.add('show');
  if (c.kind === 'three') {
    const t = Math.max(0, c.t);
    p.innerHTML = `<b>3-Point Contest</b><div class="big">${c.pts} <small style="font-size:12px;color:var(--muted)">/ 30</small></div><div>Rack ${Math.min(5, c.rack + 1)} of 5 · Ball ${Math.min(5, c.ball + 1)} of 5${c.moneyNow ? ' · MONEY BALL' : ''} · ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}</div>`;
    return;
  }
  const total = c.scores.reduce((a, s) => a + s.total, 0).toFixed(1);
  const j = c.judgesShown;
  p.innerHTML = `<b>Dunk Contest · Round ${Math.min(3, c.round + 1)} of 3</b><div class="big">${total}</div>` +
    (j ? `<div>${j.style}: ${j.judges.map((x) => `<b>${x}</b>`).join(' · ')} = <b>${j.total}</b></div>` :
      c.phase === 'pick' ? `<div class="row">${DUNK_STYLES.map((s) => `<button class="${s.k === c.style ? 'on' : ''}" data-st="${s.k}">${s.label}</button>`).join('')}<button class="on" id="cstGo">Go!</button></div>` : '<div>Here he goes...</div>');
  $$('#contestPanel [data-st]').forEach((b) => b.addEventListener('click', () => { c.style = b.dataset.st; sfx.menu(); renderContestPanel(); }));
  const go = $('#cstGo'); if (go) go.addEventListener('click', contestGo);
}

function finishContest() {
  const c = contest;
  if (!c || c.over) return;
  c.over = true;
  const isThree = c.kind === 'three';
  const score = isThree ? c.pts : +c.scores.reduce((a, s) => a + s.total, 0).toFixed(1);
  const newBest = saveBest(isThree ? 'three' : 'dunk', score);
  let rows = '';
  if (isThree) {
    const rivals = [['Rival A', 14 + Math.floor(Math.random() * 7)], ['Rival B', 12 + Math.floor(Math.random() * 8)], ['Rival C', 10 + Math.floor(Math.random() * 8)]];
    const all = [['You', score, true], ...rivals].sort((a, b) => b[1] - a[1]);
    rows = all.map((r, i) => `<div class="line${r[2] ? ' me' : ''}"><span>${i + 1}. ${r[0]}</span><b>${r[1]}</b></div>`).join('');
    $('#crTitle').textContent = all[0][2] ? '3-Point Champion!' : '3-Point Contest';
  } else {
    const st = Object.values({});
    void st;
    const base = 62 + (c.me.r.dunk - 70) * 0.35;
    const rivals = [['Rival A', +(base + Math.random() * 18).toFixed(1)], ['Rival B', +(base + Math.random() * 16).toFixed(1)], ['Rival C', +(base + Math.random() * 14).toFixed(1)]];
    const all = [['You', score, true], ...rivals].sort((a, b) => b[1] - a[1]);
    rows = c.scores.map((s, i) => `<div class="line"><span>Round ${i + 1}: ${s.style}</span><b>${s.total}</b></div>`).join('') + all.map((r, i) => `<div class="line${r[2] ? ' me' : ''}"><span>${i + 1}. ${r[0]}</span><b>${r[1]}</b></div>`).join('');
    $('#crTitle').textContent = all[0][2] ? 'Dunk Contest Champion!' : 'Dunk Contest';
  }
  $('#crBody').innerHTML = `<div class="line"><span>Your score</span><b>${score}${newBest ? ' · NEW BEST' : ''}</b></div>${rows}`;
  $('#contestPanel').classList.remove('show');
  sfx.cheer(1);
  setTimeout(() => { if (contest === c) show('contestResult'); }, 900);
}

function startPractice() {
  endGameObjects();
  session = { kind: 'practice', save: null };
  const home = TEAMS[settings.home], away = TEAMS[settings.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, {
    difficulty: settings.diff, quarterMinutes: 12, userSide: 'home', playerLock: -1, tutorial: true, practice: true, noFouls: true, noTimeouts: true,
  }, hud);
  hookFx(game);
  game.tutorialPossession = 'user';
  setQuiet(false); stopMusic();
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  practice = { mine: 1, opp: 0, def: 'passive', fgm: 0, fga: 0, tpm: 0, tpa: 0, streak: 0, best: 0, wait: 0, pending3: false };
  game.on((type, d) => {
    const P = practice;
    if (!P || !d.player || d.player.team !== game.user) return;
    if (type === 'shot') { P.fga++; P.pending3 = game.isThree(game.user, d.player.pos.x, d.player.pos.z); if (P.pending3) P.tpa++; }
    else if (type === 'score') { P.fgm++; if (d.pts === 3) P.tpm++; P.streak++; P.best = Math.max(P.best, P.streak); }
    else if (type === 'miss') P.streak = 0;
    renderPractice();
  });
  applyPracticeSetup(true);
  show(null);
  $('#pracPanel').classList.add('show');
  hud.toast('PRACTICE', 'No clock, no fouls. Set team sizes in the panel.', 2.6);
}
function applyPracticeSetup(reset) {
  const g = game, P = practice;
  g.practiceDefense = P.def;
  g.setTeamSize(g.user, P.mine);
  g.setTeamSize(g.cpu, P.opp);
  if (reset) {
    const spot = new THREE.Vector3(g.user.dir * (C.HOOP_X - 7.5), 0, 0);
    g.forcePossession(g.user.players[0], spot);
    g.cpu.players.forEach((p, i) => p.pos.set(g.user.dir * (C.HOOP_X - 3 - i * 0.8), 0, (i - (g.cpu.players.length - 1) / 2) * 2.2));
  }
  renderPractice();
}
function renderPractice() {
  const P = practice;
  if (!P) return;
  $('#pracMine').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" class="${n === P.mine ? 'on' : ''}">${n}</button>`).join('');
  $('#pracOpp').innerHTML = [0, 1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" class="${n === P.opp ? 'on' : ''}">${n}</button>`).join('');
  $$('#pracDef button').forEach((b) => b.classList.toggle('on', b.dataset.v === P.def));
  const pct = (m, a) => (a ? `${Math.round((m / a) * 100)}%` : '—');
  $('#pracStats').innerHTML = `Shots <b>${P.fgm}/${P.fga}</b> (${pct(P.fgm, P.fga)}) · Threes <b>${P.tpm}/${P.tpa}</b> (${pct(P.tpm, P.tpa)})<br>Streak <b>${P.streak}</b> · Best <b>${P.best}</b>`;
  $$('#pracMine button').forEach((b) => b.addEventListener('click', () => { P.mine = Number(b.dataset.n); sfx.menu(); applyPracticeSetup(false); }));
  $$('#pracOpp button').forEach((b) => b.addEventListener('click', () => { P.opp = Number(b.dataset.n); sfx.menu(); applyPracticeSetup(false); }));
}
$$('#pracDef button').forEach((b) => b.addEventListener('click', () => { if (practice) { practice.def = b.dataset.v; sfx.menu(); applyPracticeSetup(false); } }));
$('#pracExit').addEventListener('click', () => quitToMenu());
$('#pracReset').addEventListener('click', () => { if (practice) { Object.assign(practice, { fgm: 0, fga: 0, tpm: 0, tpa: 0, streak: 0, best: 0 }); renderPractice(); } });
$('#pracFT').addEventListener('click', () => { if (game && practice && game.state === 'live') game.startFreeThrows(game.user.cp || game.user.players[0], 2); });
// Keep the ball coming back to you
function practiceUpdate(dt) {
  const g = game, P = practice, b = g.ball;
  if (g.state === 'ft' || g.state === 'timeout') { P.wait = 0; return; }
  const busy = b.state === 'shot' || b.state === 'pass';
  const mine = b.state === 'held' && b.holder && b.holder.team === g.user && g.state === 'live';
  if (mine || busy) { P.wait = 0; return; }
  P.wait += dt;
  if (P.wait > (g.state === 'dead' ? 0.9 : b.state === 'loose' ? 2.4 : 0.8)) {
    P.wait = 0;
    g.forcePossession(g.user.cp && g.user.players.includes(g.user.cp) ? g.user.cp : g.user.players[0]);
  }
}

function playHubGame() {
  const s = session.save;
  const ng = Season.nextGame(s);
  if (!ng) return;
  session.lastSim = null;
  const mine = s.career ? Season.careerTeamData(s) : TEAMS[s.team];
  const other = (i) => (s.career ? Season.scaledTeam(i, s.year) : TEAMS[i]);
  const home = ng.h === s.team ? mine : other(ng.h);
  const away = ng.a === s.team ? mine : other(ng.a);
  sfx.select();
  // Career: play as just your player (locked on, no switching) or run the whole team
  const solo = !!s.career && s.control !== 'team';
  launch({ home, away, userSide: ng.h === s.team ? 'home' : 'away', diff: s.diff, q: s.q, lock: solo ? s.career.pos : -1, strictLock: solo, stage: ng.stage });
}

// Called once when a game ends: saves a season/career result. Returns extra HTML for the final screen.
function recordSessionGame(g, winner) {
  const s = session.save;
  if (!s || g.recorded) return '';
  g.recorded = true;
  const rows = everyone(g.user).map((p) => ({ key: `${p.data.first} ${p.data.last}#${p.data.number}`, name: `${p.data.first} ${p.data.last}`, pos: p.data.pos, ...p.stats }));
  Season.recordGame(s, g.home.score, g.away.score, rows);
  if (!s.career) return '';
  const me = everyone(g.user).find((p) => p.data.isMe);
  if (!me) return '';
  const r = Season.careerReward(s, me.stats, winner.isUser);
  sfx.levelUp();
  return `<div class="reward"><span class="grade">${r.grade}</span><div><small>Your game grade</small><b>${me.stats.pts} PTS · ${me.stats.reb} REB · ${me.stats.ast} AST</b><br><span class="rp">+${r.rp} Rep Points</span></div></div>`;
}

function afterSessionGame() {
  const kind = session.kind, s = session.save;
  endGameObjects();
  mode = 'menu';
  startAttract();
  musicMaybe();
  hubTab = kind === 'career' ? 'upgrades' : 'standings';
  maybeChampion(s) || (renderHub(), show('hub'));
}

// Show the champion screen once per season. Returns true if it was shown.
function maybeChampion(s) {
  const p = s.playoffs;
  if (!p || p.champion == null || s.champShown) return false;
  s.champShown = true;
  const ch = TEAMS[p.champion];
  const mine = p.champion === s.team;
  if (mine && s.career) { s.career.titles++; s.career.rp += 100; s.career.earned += 100; }
  Season.save(s);
  $('#champTitle').textContent = mine ? 'Champions!' : `${ch.city} ${ch.name} win the title`;
  $('#champSub').textContent = mine ? `Your ${ch.city} ${ch.name} are the Year ${s.year} champions${s.career ? ' · +100 Rep Points' : ''}.` : (p.seeds.includes(s.team) ? 'You made the playoffs. Run it back next year.' : 'You missed the playoffs. Upgrade and come back stronger.');
  if (mine && fx) fx.celebrate([ch.primary, ch.secondary, '#ffffff', '#ffd60a']);
  if (mine) sfx.levelUp();
  show('champ');
  return true;
}
$('#champOk').addEventListener('click', () => { hubTab = 'playoffs'; renderHub(); show('hub'); });

// ---------- Camera ----------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const vA = new THREE.Vector3(), vB = new THREE.Vector3();
function updateCamera(dt, t) {
  if (!game) {
    const a = t * 0.08;
    camera.position.set(Math.sin(a) * 18, 7 + Math.sin(t * 0.2) * 1.5, Math.cos(a) * 14);
    camera.lookAt(0, 1.5, 0);
    return;
  }
  if (intro) {
    // Sweeping fly-in that settles into the broadcast view while the lights come up
    const u = Math.min(1, intro.t / intro.dur);
    const e = 1 - Math.pow(1 - u, 3);
    const ang = -2.4 * (1 - e), R = 5 + 11.1 * e, h = 17 - 8.8 * e;
    camera.position.set(Math.sin(ang) * R, h, Math.cos(ang) * R);
    camera.lookAt(0, 1.2, 0);
    renderer.toneMappingExposure = baseExposure() * (0.22 + 0.78 * Math.min(1, u * 1.8));
    return;
  }
  const b = game.ball.pos;
  const up = game.userPlayer && !attract ? game.userPlayer.pos : b;
  const fx_ = THREE.MathUtils.clamp(b.x * 0.75 + up.x * 0.25, -C.HALF_L + 2, C.HALF_L - 2);
  const fz = THREE.MathUtils.clamp(b.z * 0.4 + up.z * 0.2, -3, 3);
  const portrait = camera.aspect < 1;
  let pos, look, speed = 3.2;
  const ft = game.state === 'ft' && game.ft && game.ft.phase !== 'setup' ? game.ft : null;
  if (game.replay) {
    // Halftime replays: low, wide TV angle that follows the ball
    const bp = game.ball.pos;
    const rx = THREE.MathUtils.clamp(bp.x * 0.8, -C.HALF_L + 3, C.HALF_L - 3);
    pos = [rx * 0.9, 3.6, 11.2]; look = [rx, 1.7, bp.z * 0.4]; speed = 5;
  } else if (game.slowT > 0 && game.focus) {
    // Highlight cam: push in on the player
    const f = game.focus.pos;
    pos = [f.x - Math.sign(f.x || 1) * 3.4, 2.6, f.z + 6.2]; look = [f.x, 2.1 + game.focus.y * 0.5, f.z]; speed = 7;
  } else if (ft) {
    // Free throws: behind the shooter
    const sh = ft.shooter, dir = sh.team.dir;
    pos = [sh.pos.x - dir * 5.4, 3.1, 1.9]; look = [dir * C.HOOP_X, 2.5, 0]; speed = 2.6;
  } else if (attract) {
    pos = [fx_ * 0.6 + Math.sin(t * 0.07) * 5, 5.6, 13.5]; look = [fx_ * 0.85, 1.7, 0]; speed = 1.5;
  } else if (settings.cam === 'court') { pos = [fx_ * 0.85, 4.4, 12.5 + fz * 0.3]; look = [fx_ * 0.9, 1.6, fz * 0.5]; }
  else if (settings.cam === 'high') { pos = [fx_ * 0.6, 16, 15]; look = [fx_ * 0.7, 0, fz * 0.3]; }
  else { pos = [fx_ * 0.82, 8.2, 16 + fz * 0.3]; look = [fx_ * 0.88, 1.2, fz * 0.5]; }
  if (portrait && !ft) { pos[1] += 3; pos[2] += 4; }
  const k = 1 - Math.exp(-dt * speed);
  camPos.lerp(vA.set(...pos), k);
  camTarget.lerp(vB.set(...look), k);
  camera.position.copy(camPos);
  if (game.cameraShake > 0) {
    const s = game.cameraShake * 0.25;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  camera.lookAt(camTarget);
}

// ---------- Loop ----------
let lastNow = performance.now(), elapsed = 0;
let jumboT = 0;
function stepGame(dt) {
  if (game.guest) {
    guestFrame(game, dt);
    netGuestTick(dt);
  } else {
    if (netPlaying() && online.remote) online.remote.tick();
    game.update(dt * (attract ? 0.9 : settings.speed)); // overall game speed (Settings)
    if (game && netPlaying()) netHostTick(dt);
  }
  if (!game) return;
  // Effects that follow the action
  const b = game.ball;
  if (b.state === 'shot' && b.shot) fx.ballTrail(b.pos, b.shot.shooter.onFire);
  for (const p of game.allPlayers) if (p.onFire) fx.playerFire(p);
}
let dtSmooth = 1 / 60, adaptT = 0, adaptN = 0, adaptSum = 0;
// Adaptive resolution: if the frame rate sags, render fewer pixels; when there is headroom, add them back
function adaptResolution(dt) {
  adaptT += dt; adaptN++; adaptSum += dt;
  if (adaptT < 1.2) return;
  const avg = adaptSum / adaptN;
  gfxStats.ms = avg * 1000; gfxStats.fps = 1 / avg;
  adaptT = 0; adaptN = 0; adaptSum = 0;
  if (!settings.adaptive || mode === 'menu' && !attract) return;
  const before = renderScale;
  // Only trade sharpness for speed when the frame rate is really struggling, and never go below 80% (stays crisp)
  if (avg > 1 / 40) renderScale = Math.max(0.8, renderScale - (avg > 1 / 28 ? 0.1 : 0.05));
  else if (avg < 1 / 56 && renderScale < 1) renderScale = Math.min(1, renderScale + 0.05);
  if (renderScale !== before) { renderer.setPixelRatio(targetRatio()); resize(); }
  const st = $('#gfxInfo');
  if (st && st.offsetParent) st.textContent = `Rendering ${gfxStats.w}x${gfxStats.h} at ${Math.round(gfxStats.fps)} fps`;
}
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const rawDt = Math.min((now - lastNow) / 1000, 1 / 15);
  // Smooth out frame-time jitter so motion stays even (big hitches pass straight through)
  dtSmooth = dtSmooth * 0.72 + rawDt * 0.28;
  const dt = Math.abs(rawDt - dtSmooth) > 0.012 ? rawDt : dtSmooth;
  lastNow = now; elapsed += dt;
  const t = elapsed;
  if (window.pph.manual) { renderer.render(scene, camera); return; } // test hook: game stepped externally
  pollPadCapture();
  padMenuNav();
  pollInput();
  if (intro) {
    intro.t += dt;
    if (intro.t > 0.6 && (input.pressed.shoot || input.pressed.pass || input.pressed.pause || input.pressed.move)) endIntro();
    else if (intro.t >= intro.dur) endIntro();
  } else if (input.pressed.pause) {
    if (netPlaying() && online.menu) resume();
    else if (mode === 'game') pause(); else if (mode === 'paused') resume();
  }
  if (game) {
    if (mode === 'game') {
      stepGame(dt);
      if (tutorial) tutorial.update(dt);
      if (practice && game) practiceUpdate(dt);
      if (contest && game) contestUpdate(dt);
      if (game && !intro) updateHUD(dt);
    } else if (mode === 'over' || (mode === 'menu' && attract)) stepGame(dt);
  }
  if (arena) {
    arena.update(dt, t);
    if (mode !== 'paused') fx.update(dt, t);
    jumboT -= dt;
    if (jumboT <= 0) {
      jumboT = 0.25;
      if (game) arena.drawJumbo({ home: { ...game.home.data, score: game.home.score }, away: { ...game.away.data, score: game.away.score }, clockText: game.opts.tutorial ? 'PRACTICE' : game.clockText(), periodText: game.periodName() });
      else arena.drawJumbo({ home: { ...TEAMS[settings.home], score: 0 }, away: { ...TEAMS[settings.away], score: 0 }, clockText: 'TIP-OFF', periodText: '2K POWER PLAY' });
    }
  }
  updateCamera(dt, t);
  if ((TIERS[settings.gfx] || TIERS.high).post) composer.render();
  else renderer.render(scene, camera);
  adaptResolution(rawDt);
}

// ---------- Login ----------
let loginMode = 'login';
function setLoginMode(m) {
  loginMode = m;
  $$('#loginTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#loginPass2Wrap').hidden = m !== 'register';
  $('#loginPass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
  $('#loginSubmit').textContent = m === 'register' ? 'Create account' : 'Log in';
  $('#loginError').textContent = '';
}
$$('#loginTabs button').forEach((b) => b.addEventListener('click', () => { setLoginMode(b.dataset.mode); sfx.menu(); }));
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  initAudio();
  const u = $('#loginUser').value.trim().toLowerCase(), p = $('#loginPass').value;
  const fail = (msg) => { $('#loginError').textContent = msg; };
  if (!u || !p) return fail('Enter a username and password.');
  if (loginMode === 'register' && p !== $('#loginPass2').value) return fail("The passwords don't match.");
  $('#loginSubmit').disabled = true;
  $('#loginError').textContent = '';
  const r = loginMode === 'register' ? await authRegister(u, p) : await authLogin(u, p);
  $('#loginSubmit').disabled = false;
  if (!r.ok) return fail(r.message);
  $('#loginPass').value = ''; $('#loginPass2').value = '';
  sfx.select();
  enterGame();
});
$('#loginOffline').addEventListener('click', () => { auth.offline = true; enterGame(); });

function updateAccountUI() {
  const on = !!auth.user && !auth.offline;
  $('#hubAcct').hidden = !on;
  $('#settingsAcct').hidden = !on;
  $('#acctName').textContent = auth.user || '';
  $('#settingsAcctName').textContent = auth.user || '';
}
function showLogin(unreachable) {
  setLoginMode('login');
  refreshNotice();
  $('#loginOffline').hidden = !unreachable;
  $('#loginHint').textContent = unreachable
    ? "Can't reach the login server here (this is probably a local copy of the game). You can still play offline."
    : 'Sign in to play. Accounts are also needed for online games.';
  mode = 'menu';
  show('login');
  setTimeout(() => { try { $('#loginUser').focus(); } catch { /* ignore */ } }, 60);
}
function enterGame() {
  updateAccountUI(); renderHome(); show('menu'); musicMaybe();
  refreshNotice();
  // Cloud save: take the newer copy of your careers, kits and settings, then collect any gifts from the admin
  if (auth.token && !auth.offline) cloudSync().then((r) => { if (r === 'applied') location.reload(); else applyInbox(); });
}

// ---------- Admin: gifts, announcements, check-ins ----------
async function applyInbox() {
  const lines = await collectGifts();
  if (!lines.length) return;
  $('#giftList').innerHTML = lines.map((l) => `<div class="gift-item"><span class="gi">${l.icon}</span><div><b>${esc(l.title)}</b>${l.who ? `<small>${esc(l.who)}</small>` : ''}${l.text ? `<p>${esc(l.text)}</p>` : ''}</div></div>`).join('');
  $('#giftModal').hidden = false;
  sfx.levelUp();
  renderHome();
}
$('#giftOk').addEventListener('click', () => { sfx.select(); $('#giftModal').hidden = true; renderHome(); });

async function refreshNotice() {
  const items = await fetchAnnouncements();
  const seen = seenAnnouncements();
  const fresh = items.filter((a) => !seen.includes(a.id)).pop();
  const bar = $('#hubNotice');
  if (fresh) { $('#hubNoticeText').textContent = fresh.text; bar.dataset.id = fresh.id; bar.hidden = false; } else bar.hidden = true;
  const ln = $('#loginNotice'), latest = items[items.length - 1];
  if (ln) { ln.textContent = latest ? `📣 ${latest.text}` : ''; ln.hidden = !latest; }
}
$('#hubNoticeX').addEventListener('click', () => { const bar = $('#hubNotice'); if (bar.dataset.id) markSeen(bar.dataset.id); bar.hidden = true; sfx.menu(); });

const activityNow = () => {
  if (mode === 'game' || mode === 'paused') {
    if (online && netPlaying()) return 'online';
    if (tutorial) return 'tutorial';
    const k = session && session.kind;
    return k === 'career' ? 'career' : k === 'season' ? 'season' : k === 'practice' ? 'practice' : k === 'contest' ? 'contest' : 'game';
  }
  return 'menu';
};
setInterval(async () => {
  if (!auth.token || auth.offline) return;
  const r = await heartbeat(activityNow());
  if (r === 'none') { quitToMenu(); updateAccountUI(); showLogin(false); $('#loginError').textContent = 'You were signed out. Please log in again.'; return; }
  if (r === 'ok') { refreshNotice(); if ($('#giftModal').hidden) applyInbox(); }
}, 90000);

// The basketball next to the logo opens the admin code page
$('#adminBall').addEventListener('click', () => { initAudio(); sfx.menu(); openAdmin(); });
initAdmin({ $, $$, show, sfx, esc, exit: () => { renderHome(); show('menu'); } });
onCloudStatus((s) => { const el = $('#cloudInfo'); if (el) el.textContent = s; const row = $('#cloudRow'); if (row) row.hidden = !(auth.token && !auth.offline); });
$('#cloudNow').addEventListener('click', async () => { sfx.menu(); await cloudPush(); });
async function doLogout() {
  sfx.menu();
  quitToMenu();          // leaves any game and online room first
  await authLogout();
  updateAccountUI();
  showLogin(false);
}
$('#acctLogout').addEventListener('click', doLogout);
$('#settingsLogout').addEventListener('click', doLogout);

// ---------- Boot ----------
(async () => {
  setupTouch($('#touch'));
  initAnnouncer($('#caption'));
  $('#loadText').textContent = 'Loading 3D models…';
  await loadCustomAssets();
  if (custom.courtModel) {
    $('#courtStyleWrap').hidden = false;
    // The first time a court model is available, switch to it once. It can be changed back in Settings → Court.
    if (settings.courtSeen !== 'street') { settings.court = 'classic'; settings.courtSeen = 'street'; saveSettings(); }
  } else settings.court = 'arena';
  $('#optCourt').value = settings.court;
  if (custom.credits.length) {
    $('#credits').hidden = false;
    $('#credits').innerHTML = '<b>3D model credits</b>' + custom.credits.map((c) => `<div>${esc(c)}</div>`).join('');
  }
  $('#loadText').textContent = 'Building arena…';
  await new Promise((r) => setTimeout(r, 30));
  startAttract();
  resize();
  frame();
  renderHome();
  // Nothing is playable until you're signed in (the demo game keeps running behind the login screen)
  const loggedIn = await checkSession();
  if (loggedIn === 'ok') enterGame(); else showLogin(loggedIn === 'unreachable');
  const first = () => { initAudio(); setQuiet(attract); musicMaybe(); };
  window.addEventListener('pointerdown', first, { once: true });
  window.addEventListener('keydown', first, { once: true });
})();

// Debug handle for testing in the browser console
window.pph = {
  manual: false, input, Season, portrait, camera, auth, gfxStats, renderer, getContest: () => contest,
  get game() { return game; }, get tutorial() { return tutorial; }, get session() { return session; }, get intro() { return intro; },
  endIntro,
  // Step the game with a fixed input state (used by automated tests)
  step(n = 1, inp = {}) {
    for (let i = 0; i < n; i++) {
      input.moveX = inp.x || 0; input.moveY = inp.y || 0; input.sprint = !!inp.sprint;
      for (const k of Object.keys(input.held)) {
        const h = !!inp[k];
        input.pressed[k] = h && !input.held[k];
        input.released[k] = !h && input.held[k];
        input.held[k] = h;
      }
      if (inp.sprint) { input.held.sprint = true; }
      if (game) { stepGame(1 / 60); if (tutorial) tutorial.update(1 / 60); fx.update(1 / 60, i / 60); }
    }
  },
};
