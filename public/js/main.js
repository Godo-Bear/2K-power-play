import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TEAMS } from './data.js';
import { buildArena, C } from './arena.js';
import { Game } from './game.js';
import { input, pollInput, setupTouch } from './input.js';
import { initAudio, setMuted, sfx } from './audio.js';
import { loadCustomAssets } from './assets.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ---------- Settings (remembered per browser) ----------
const settings = { cam: 'broadcast', gfx: 'high', mute: false, home: 0, away: 3, side: 'home', diff: 'pro', q: '2' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('pph-settings') || '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('pph-settings', JSON.stringify(settings)); } catch { /* ignore */ } };
if (!navigator.maxTouchPoints && settings.gfx === undefined) settings.gfx = 'high';

// ---------- Renderer ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(0, 9, 17);

let scene, arena, composer, bloomPass, renderPass;
let game = null;
let mode = 'menu'; // menu | game | paused
let lastScreen = 'menu';

function applyQuality() {
  const q = settings.gfx;
  const dpr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = q !== 'low';
  if (scene) scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  if (bloomPass) bloomPass.enabled = q === 'high';
  resize();
}

function buildWorld(home, away) {
  if (scene) {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
  }
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  scene.fog = new THREE.Fog(0x05070c, 30, 70);
  scene.environment = envTex;
  arena = buildArena(scene, home, away);
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.85);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  applyQuality();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (composer) { composer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio()); }
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 62 : w / h < 1.4 ? 50 : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- Screens ----------
function show(id) {
  $$('.screen').forEach((s) => s.classList.remove('show'));
  if (id) $(`#${id}`).classList.add('show');
  $('#hud').classList.toggle('show', mode === 'game' || mode === 'paused');
  $('#touch').classList.toggle('active', mode === 'game');
}

$$('[data-go]').forEach((b) => b.addEventListener('click', () => {
  initAudio(); sfx.menu();
  const go = b.dataset.go;
  if (go === 'back') { show(lastScreen); return; }
  if (go === 'controls' || go === 'settings') lastScreen = mode === 'paused' ? 'pause' : 'menu';
  if (go === 'select') renderSelect();
  show(go);
}));

// Team select
function teamCard(el, idx) {
  const t = TEAMS[idx];
  el.style.setProperty('--tc', t.primary);
  const crest = el.querySelector('.crest');
  crest.textContent = t.id;
  crest.style.background = t.secondary;
  crest.style.borderColor = t.primary;
  crest.style.color = t.accent;
  el.querySelector('h3').textContent = `${t.city} ${t.name}`;
  el.querySelector('.ovr').innerHTML = `Team OVR <b>${t.ovr}</b>`;
  el.querySelector('.roster').innerHTML = t.roster.map((p) =>
    `<li><span class="p">${p.pos}</span><span class="n">#${p.number} ${p.first} ${p.last}</span><span class="o">${p.ovr}</span></li>`).join('');
}
function renderSelect() {
  teamCard($('#cardHome'), settings.home);
  teamCard($('#cardAway'), settings.away);
  $('#optSide').value = settings.side;
  $('#optDiff').value = settings.diff;
  $('#optQ').value = settings.q;
}
$$('.team-card').forEach((card) => {
  const side = card.dataset.side;
  const step = (d) => {
    sfx.menu();
    let v = settings[side];
    do { v = (v + d + TEAMS.length) % TEAMS.length; } while (v === settings[side === 'home' ? 'away' : 'home']);
    settings[side] = v; saveSettings(); renderSelect();
  };
  card.querySelector('.arrow.l').addEventListener('click', () => step(-1));
  card.querySelector('.arrow.r').addEventListener('click', () => step(1));
});
$('#optSide').addEventListener('change', (e) => { settings.side = e.target.value; saveSettings(); });
$('#optDiff').addEventListener('change', (e) => { settings.diff = e.target.value; saveSettings(); });
$('#optQ').addEventListener('change', (e) => { settings.q = e.target.value; saveSettings(); });
$('#optCam').value = settings.cam;
$('#optGfx').value = settings.gfx;
$('#optMute').checked = settings.mute;
setMuted(settings.mute);
$('#optCam').addEventListener('change', (e) => { settings.cam = e.target.value; saveSettings(); });
$('#optGfx').addEventListener('change', (e) => { settings.gfx = e.target.value; saveSettings(); applyQuality(); });
$('#optMute').addEventListener('change', (e) => { settings.mute = e.target.checked; setMuted(settings.mute); saveSettings(); });

$('#startBtn').addEventListener('click', () => { initAudio(); sfx.select(); startGame(); });
$('#resumeBtn').addEventListener('click', () => resume());
$('#pauseBtn').addEventListener('click', () => pause());
$('#quitBtn').addEventListener('click', () => quitToMenu());
$('#menuBtn').addEventListener('click', () => quitToMenu());
$('#rematchBtn').addEventListener('click', () => startGame());

function pause() { if (mode !== 'game') return; mode = 'paused'; show('pause'); }
function resume() { if (mode !== 'paused') return; mode = 'game'; show(null); }
function quitToMenu() {
  if (game) { game.dispose(); game = null; }
  mode = 'menu';
  buildWorld(TEAMS[settings.home], TEAMS[settings.away]);
  show('menu');
}

// ---------- HUD ----------
let toastTimer = 0, popTimer = 0;
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
    f.textContent = text; f.style.color = color;
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  },
  scored(team, pts, p) {
    const el = $(`.sb-team.${team.isHome ? 'home' : 'away'} .score`);
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    const pop = $('#scorePop');
    pop.style.borderLeftColor = team.data.primary;
    pop.innerHTML = `<b>${p.data.first[0]}. ${p.data.last} +${pts}</b>${p.stats.pts} PTS · ${p.stats.fgm}/${p.stats.fga} FG${p.stats.tpa ? ` · ${p.stats.tpm}/${p.stats.tpa} 3PT` : ''}`;
    pop.classList.add('show');
    popTimer = 2.6;
  },
  gameOver(g) {
    const winner = g.home.score > g.away.score ? g.home : g.away;
    setTimeout(() => {
      if (game !== g) return;
      mode = 'over';
      $('#overTitle').textContent = winner.isUser ? 'Victory' : 'Final';
      $('#finalScore').innerHTML = [g.away, g.home].map((t) =>
        `<span class="${t === winner ? 'w' : ''}">${t.data.id} ${t.score}</span>`).join('<span>–</span>');
      $('#boxscore').innerHTML = [g.away, g.home].map((t) => `
        <div class="box"><h4 style="color:${t.data.primary}">${t.data.city} ${t.data.name}</h4>
        <table><tr><th>Player</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3PT</th><th>TO</th></tr>
        ${t.players.map((p) => `<tr><td>${p.data.pos} ${p.data.first[0]}. ${p.data.last}</td><td>${p.stats.pts}</td><td>${p.stats.reb}</td><td>${p.stats.ast}</td><td>${p.stats.stl}</td><td>${p.stats.blk}</td><td>${p.stats.fgm}-${p.stats.fga}</td><td>${p.stats.tpm}-${p.stats.tpa}</td><td>${p.stats.to}</td></tr>`).join('')}
        </table></div>`).join('');
      show('over');
    }, 2200);
  },
};

function updateHUD(dt) {
  const g = game;
  for (const t of [g.home, g.away]) {
    const el = $(`.sb-team.${t.isHome ? 'home' : 'away'}`);
    el.querySelector('.abbr').textContent = t.data.id;
    el.querySelector('.score').textContent = t.score;
    el.querySelector('.sw').style.background = t.data.primary;
  }
  $('.sb-mid .period').textContent = g.periodName();
  $('.sb-mid .clock').textContent = g.clockText();
  const sc = $('.sb-mid .shot');
  sc.textContent = g.shotClockFrozen && g.state !== 'live' ? '' : Math.ceil(g.shotClock);
  sc.classList.toggle('low', g.shotClock < 5);

  const p = g.userPlayer;
  if (p) {
    $('#ptag .num').textContent = p.data.number;
    $('#ptag .num').style.background = p.team.data.primary;
    $('#ptag .name').textContent = `${p.data.first} ${p.data.last}`;
    $('#ptag .meta').textContent = `${p.data.pos} · ${p.data.ovr} OVR · ${p.stats.pts} PTS`;
    $('#ptag .stam i').style.width = `${Math.round(p.stamina * 100)}%`;
  }

  // Shot meter beside the shooter
  const m = $('#meter');
  if (g.meter.visible && p) {
    const v = new THREE.Vector3(p.pos.x, p.y + p.data.height * 0.9, p.pos.z).project(camera);
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

// ---------- Game lifecycle ----------
function startGame() {
  if (game) { game.dispose(); game = null; }
  const home = TEAMS[settings.home], away = TEAMS[settings.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, { difficulty: settings.diff, quarterMinutes: Number(settings.q), userSide: settings.side }, hud);
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
  hud.toast(`${away.name} at ${home.name}`, `${game.firstPossession.data.name} ball first`, 2.2);
  sfx.whistle();
  sfx.cheer(0.8);
}

// ---------- Camera ----------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
function updateCamera(dt, t) {
  if (mode === 'menu' || !game) {
    const a = t * 0.08;
    camera.position.set(Math.sin(a) * 18, 7 + Math.sin(t * 0.2) * 1.5, Math.cos(a) * 14);
    camera.lookAt(0, 1.5, 0);
    return;
  }
  const b = game.ball.pos;
  const up = game.userPlayer ? game.userPlayer.pos : b;
  const fx = THREE.MathUtils.clamp(b.x * 0.75 + up.x * 0.25, -C.HALF_L + 2, C.HALF_L - 2);
  const fz = THREE.MathUtils.clamp(b.z * 0.4 + up.z * 0.2, -3, 3);
  const portrait = camera.aspect < 1;
  let pos, look;
  if (settings.cam === 'court') { pos = [fx * 0.85, 4.4, 12.5 + fz * 0.3]; look = [fx * 0.9, 1.6, fz * 0.5]; }
  else if (settings.cam === 'high') { pos = [fx * 0.6, 16, 15]; look = [fx * 0.7, 0, fz * 0.3]; }
  else { pos = [fx * 0.82, 8.2, 16 + fz * 0.3]; look = [fx * 0.88, 1.2, fz * 0.5]; }
  if (portrait) { pos[1] += 3; pos[2] += 4; }
  const k = 1 - Math.exp(-dt * 3.2);
  camPos.lerp(new THREE.Vector3(...pos), k);
  camTarget.lerp(new THREE.Vector3(...look), k);
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
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 1 / 20);
  lastNow = now; elapsed += dt;
  const t = elapsed;
  pollInput();
  if (input.pressed.pause) { if (mode === 'game') pause(); else if (mode === 'paused') resume(); }
  if (mode === 'game' && game) { game.update(dt); updateHUD(dt); }
  else if (mode === 'over' && game) game.update(dt);
  if (arena) {
    arena.update(dt, t);
    jumboT -= dt;
    if (jumboT <= 0) {
      jumboT = 0.25;
      if (game) arena.drawJumbo({ home: { ...game.home.data, score: game.home.score }, away: { ...game.away.data, score: game.away.score }, clockText: game.clockText(), periodText: game.periodName() });
      else arena.drawJumbo({ home: { ...TEAMS[settings.home], score: 0 }, away: { ...TEAMS[settings.away], score: 0 }, clockText: 'TIP-OFF', periodText: 'POWER PLAY HOOPS' });
    }
  }
  updateCamera(dt, t);
  if (settings.gfx === 'high') composer.render();
  else renderer.render(scene, camera);
}

// ---------- Boot ----------
(async () => {
  setupTouch($('#touch'));
  $('#loadText').textContent = 'Loading custom assets…';
  await loadCustomAssets();
  $('#loadText').textContent = 'Building arena…';
  await new Promise((r) => setTimeout(r, 30));
  buildWorld(TEAMS[settings.home], TEAMS[settings.away]);
  resize();
  frame();
  show('menu');
  window.addEventListener('pointerdown', () => initAudio(), { once: true });
  window.addEventListener('keydown', () => initAudio(), { once: true });
})();

// Debug handle for testing in the browser console
window.pph = { get game() { return game; } };
