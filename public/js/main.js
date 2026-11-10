import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TEAMS } from './data.js';
import { buildArena, C } from './arena.js';
import { Game } from './game.js';
import { input, pollInput, setupTouch, tapAction, ACTIONS, bindings, setKey, setPad, resetBindings, keyName, padName, firstGamepad } from './input.js';
import { initAudio, setMuted, sfx } from './audio.js';
import { loadCustomAssets, custom } from './assets.js';
import { Tutorial } from './tutorial.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ---------- Settings (remembered per browser) ----------
const settings = { cam: 'broadcast', gfx: 'high', mute: false, home: 0, away: 3, side: 'home', diff: 'pro', q: '2', bright: 90, lock: -1, court: 'arena' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('pph-settings') || '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('pph-settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---------- Renderer ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const applyBrightness = () => { renderer.toneMappingExposure = 0.9 * (settings.bright / 100); };
applyBrightness();

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(0, 9, 17);

let scene, arena, composer, bloomPass, renderPass;
let game = null;
let tutorial = null;
let mode = 'menu'; // menu | game | paused | over
let lastScreen = 'menu';

function applyQuality() {
  const q = settings.gfx;
  const dpr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = q !== 'low';
  if (scene) scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  if (bloomPass) bloomPass.enabled = q === 'high';
  resize();
}

function buildWorld(home, away) {
  if (scene) {
    scene.traverse((o) => {
      if (o.isSkinnedMesh) return;
      if (o.geometry) o.geometry.dispose();
    });
  }
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  scene.fog = new THREE.Fog(0x05070c, 30, 70);
  scene.environment = envTex;
  scene.environmentIntensity = 0.6;
  arena = buildArena(scene, home, away, { courtStyle: settings.court });
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // Subtle glow only on genuinely bright things (LED boards, lights), not the whole court
  bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.3, 0.95);
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
  if (go === 'back') { stopCapture(); show(lastScreen); return; }
  if (go === 'controls' || go === 'settings') lastScreen = mode === 'paused' ? 'pause' : 'menu';
  if (go === 'select') renderSelect();
  if (go === 'controls') renderRemap();
  show(go);
}));

// ---------- Team select ----------
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
  const mine = el.dataset.side === settings.side;
  el.classList.toggle('mine', mine);
  el.querySelector('.playas').textContent = mine ? '✔ Your team' : 'Play as this team';
}
function renderSelect() {
  teamCard($('#cardHome'), settings.home);
  teamCard($('#cardAway'), settings.away);
  const team = TEAMS[settings[settings.side]];
  $('#optLock').innerHTML = '<option value="-1">Off (auto switch)</option>' +
    team.roster.map((p, i) => `<option value="${i}">${p.pos} · #${p.number} ${p.first} ${p.last} (${p.ovr})</option>`).join('');
  $('#optLock').value = String(settings.lock);
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
$('#optBright').value = settings.bright;
$('#brightVal').textContent = `${settings.bright}%`;
setMuted(settings.mute);
$('#optCam').addEventListener('change', (e) => { settings.cam = e.target.value; saveSettings(); });
$('#optGfx').addEventListener('change', (e) => { settings.gfx = e.target.value; saveSettings(); applyQuality(); });
$('#optMute').addEventListener('change', (e) => { settings.mute = e.target.checked; setMuted(settings.mute); saveSettings(); });
$('#optBright').addEventListener('input', (e) => {
  settings.bright = Number(e.target.value);
  $('#brightVal').textContent = `${settings.bright}%`;
  applyBrightness(); saveSettings();
});
$('#optCourt').addEventListener('change', (e) => {
  settings.court = e.target.value; saveSettings();
  if (mode === 'menu') buildWorld(TEAMS[settings.home], TEAMS[settings.away]);
});

// ---------- Control remapping ----------
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
  el.textContent = el.dataset.kind === 'pad' ? 'Press a button…' : 'Press a key…';
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

// ---------- Buttons ----------
$('#startBtn').addEventListener('click', () => { initAudio(); sfx.select(); startGame(); });
$('#tutorialBtn').addEventListener('click', () => { initAudio(); sfx.select(); startTutorial(); });
$('#resumeBtn').addEventListener('click', () => resume());
$('#pauseBtn').addEventListener('click', () => pause());
$('#switchBtn').addEventListener('click', () => { if (game) { game.switchPlayer(); sfx.menu(); } });
$('#timeoutBtn').addEventListener('click', () => tapAction('timeout'));
$('#pauseTimeout').addEventListener('click', () => { resume(); setTimeout(() => game && game.callTimeout(game.user), 30); });
$('#toContinue').addEventListener('click', () => { if (game) game.endTimeout(); });
$('#quitBtn').addEventListener('click', () => quitToMenu());
$('#menuBtn').addEventListener('click', () => quitToMenu());
$('#rematchBtn').addEventListener('click', () => startGame());
$('#tutExit').addEventListener('click', () => quitToMenu());
$('#tutSkip').addEventListener('click', () => { if (tutorial) tutorial.skip(); });
$('#tutPlay').addEventListener('click', () => { renderSelect(); mode = 'menu'; show('select'); });
$('#tutMenu').addEventListener('click', () => quitToMenu());

function pause() { if (mode !== 'game') return; mode = 'paused'; show('pause'); }
function resume() { if (mode !== 'paused') return; mode = 'game'; show(null); if (game && game.state === 'timeout') $('#timeoutScreen').classList.add('show'); }
function endGameObjects() {
  if (game) { game.dispose(); game = null; }
  tutorial = null;
  $('#tutPanel').classList.remove('show');
}
function quitToMenu() {
  endGameObjects();
  mode = 'menu';
  buildWorld(TEAMS[settings.home], TEAMS[settings.away]);
  show('menu');
}

// ---------- HUD ----------
let toastTimer = 0, popTimer = 0;
const statRow = (p) => `<tr><td>${p.data.pos} ${p.data.first[0]}. ${p.data.last}</td><td>${p.stats.pts}</td><td>${p.stats.reb}</td><td>${p.stats.ast}</td><td>${p.stats.stl}</td><td>${p.stats.blk}</td><td>${p.stats.fgm}-${p.stats.fga}</td><td>${p.stats.tpm}-${p.stats.tpa}</td><td>${p.stats.ftm}-${p.stats.fta}</td><td>${p.stats.to}</td><td>${p.stats.pf}</td></tr>`;
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
  timeout(g, team) {
    $('#toTitle').textContent = `Timeout: ${team.data.name}`;
    $('#toSub').textContent = `${team.timeouts} timeout${team.timeouts === 1 ? '' : 's'} left · Stamina restored · ${g.periodName()} ${g.clockText()}`;
    const box = (t) => {
      const top = [...t.players].sort((a, b) => b.stats.pts - a.stats.pts)[0];
      const fg = t.players.reduce((a, p) => [a[0] + p.stats.fgm, a[1] + p.stats.fga], [0, 0]);
      const reb = t.players.reduce((a, p) => a + p.stats.reb, 0);
      const to = t.players.reduce((a, p) => a + p.stats.to, 0);
      return `<div class="box"><h4 style="color:${t.data.primary}">${t.data.city} ${t.data.name} · ${t.score}</h4>
        <div class="line"><span>Field goals</span><span>${fg[0]}-${fg[1]}</span></div>
        <div class="line"><span>Rebounds</span><span>${reb}</span></div>
        <div class="line"><span>Turnovers</span><span>${to}</span></div>
        <div class="line"><span>Team fouls (this quarter)</span><span>${t.fouls}${t.fouls >= 5 ? ' · BONUS' : ''}</span></div>
        <div class="line"><span>Leading scorer</span><span>${top.data.last} ${top.stats.pts}</span></div></div>`;
    };
    $('#toStats').innerHTML = box(g.away) + box(g.home);
    $('#toContinue').textContent = team.isUser ? 'Continue' : 'Continue (auto in a few seconds)';
    $('#timeoutScreen').classList.add('show');
  },
  hideTimeout() { $('#timeoutScreen').classList.remove('show'); },
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
        <table><tr><th>Player</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3PT</th><th>FT</th><th>TO</th><th>PF</th></tr>
        ${t.players.map(statRow).join('')}
        </table></div>`).join('');
      show('over');
    }, 2200);
  },
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

  const p = g.userPlayer;
  if (p) {
    $('#ptag .num').textContent = p.data.number;
    $('#ptag .num').style.background = p.team.data.primary;
    $('#ptag .name').textContent = `${p.data.first} ${p.data.last}${g.lock ? ' 🔒' : ''}`;
    $('#ptag .meta').textContent = `${p.data.pos} · ${p.data.ovr} OVR · ${p.stats.pts} PTS · ${p.stats.pf} PF`;
    $('#ptag .stam i').style.width = `${Math.round(p.stamina * 100)}%`;
  }

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

// ---------- Game lifecycle ----------
function startGame() {
  endGameObjects();
  const home = TEAMS[settings.home], away = TEAMS[settings.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, {
    difficulty: settings.diff, quarterMinutes: Number(settings.q), userSide: settings.side, playerLock: settings.lock,
  }, hud);
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
  hud.toast(`${away.name} at ${home.name}`, `You're the ${game.user.data.name} · ${game.firstPossession.data.name} ball first`, 2.4);
  sfx.whistle();
  sfx.cheer(0.8);
}

function startTutorial() {
  endGameObjects();
  const home = TEAMS[settings.home], away = TEAMS[settings.away];
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, {
    difficulty: 'rookie', quarterMinutes: 12, userSide: 'home', playerLock: -1, tutorial: true, noFouls: true,
  }, hud);
  mode = 'game';
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
  tutorial = new Tutorial(game, tutUI);
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
  if (window.pph.manual) { renderer.render(scene, camera); return; } // test hook: game stepped externally
  pollPadCapture();
  pollInput();
  if (input.pressed.pause) { if (mode === 'game') pause(); else if (mode === 'paused') resume(); }
  if (mode === 'game' && game) {
    game.update(dt);
    if (tutorial) tutorial.update(dt);
    if (game) updateHUD(dt);
  } else if (mode === 'over' && game) game.update(dt);
  if (arena) {
    arena.update(dt, t);
    jumboT -= dt;
    if (jumboT <= 0) {
      jumboT = 0.25;
      if (game) arena.drawJumbo({ home: { ...game.home.data, score: game.home.score }, away: { ...game.away.data, score: game.away.score }, clockText: game.opts.tutorial ? 'PRACTICE' : game.clockText(), periodText: game.periodName() });
      else arena.drawJumbo({ home: { ...TEAMS[settings.home], score: 0 }, away: { ...TEAMS[settings.away], score: 0 }, clockText: 'TIP-OFF', periodText: '2K POWER PLAY' });
    }
  }
  updateCamera(dt, t);
  if (settings.gfx === 'high') composer.render();
  else renderer.render(scene, camera);
}

// ---------- Boot ----------
(async () => {
  setupTouch($('#touch'));
  $('#loadText').textContent = 'Loading 3D models…';
  await loadCustomAssets();
  if (custom.courtModel) $('#courtStyleWrap').hidden = false;
  else settings.court = 'arena';
  $('#optCourt').value = settings.court;
  if (custom.credits.length) {
    $('#credits').hidden = false;
    $('#credits').innerHTML = '<b>3D model credits</b>' + custom.credits.map((c) => `<div>${c.replace(/</g, '&lt;')}</div>`).join('');
  }
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
window.pph = {
  manual: false, input,
  get game() { return game; }, get tutorial() { return tutorial; },
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
      if (game) { game.update(1 / 60); if (tutorial) tutorial.update(1 / 60); }
    }
  },
};
