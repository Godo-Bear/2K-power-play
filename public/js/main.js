import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TEAMS, DIFFICULTY } from './data.js';
import { buildArena, C } from './arena.js';
import { Game } from './game.js';
import { input, pollInput, setupTouch, tapAction, ACTIONS, bindings, setKey, setPad, resetBindings, keyName, padName, firstGamepad, touchLayout, saveTouchLayout, resetTouchLayout, applyTouchLayout } from './input.js';
import { initAudio, setMuted, setQuiet, sfx, startMusic, stopMusic, audioReady } from './audio.js';
import { loadCustomAssets, custom, portrait } from './assets.js';
import { Tutorial } from './tutorial.js';
import { FX } from './fx.js';
import { HAIR_STYLES } from './hair.js';
import { initAnnouncer, attachAnnouncer, sayIntro, setVoice, stopAnnouncer } from './announcer.js';
import * as Season from './season.js';
import { Room, makeCode, makeRemoteInput, makeInputSender, packEvent, unpackEvent, snapshot, applySnapshot, guestFrame } from './net.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Settings (remembered per browser) ----------
const settings = { cam: 'broadcast', gfx: 'high', mute: false, home: 0, away: 3, side: 'home', diff: 'pro', q: '2', speed: 0.85, bright: 90, lock: -1, court: 'arena', voice: true, music: true, autoSubs: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('pph-settings') || '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('pph-settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---------- Renderer ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const baseExposure = () => 0.9 * (settings.bright / 100);
const applyBrightness = () => { renderer.toneMappingExposure = baseExposure(); };
applyBrightness();

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
camera.position.set(0, 9, 17);

let scene, arena, composer, bloomPass, renderPass, fx;
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
  if (scene) scene.traverse((o) => { if (!o.isSkinnedMesh && o.geometry) o.geometry.dispose(); });
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  scene.fog = new THREE.Fog(0x05070c, 30, 70);
  scene.environment = envTex;
  scene.environmentIntensity = 0.6;
  arena = buildArena(scene, home, away, { courtStyle: settings.court });
  fx = new FX(scene, arena);
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // Subtle glow only on genuinely bright things (LED boards, lights, particles), not the whole court
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

const crest = (t, cls = 'crest') => `<span class="${cls}" style="background:${t.secondary};border-color:${t.primary};color:${t.accent}">${t.id}</span>`;

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
  if (now.back && !padNavPrev.back) { const b = shown().querySelector('[data-go=back], [data-go=menu], #subsDone, #hubBack'); if (b) b.click(); }
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
$('#optSpeed').value = String(settings.speed);
if (!$('#optSpeed').value) { settings.speed = 0.85; $('#optSpeed').value = '0.85'; }
$('#optSpeed').addEventListener('change', (e) => { settings.speed = Number(e.target.value); saveSettings(); });
$('#optCam').addEventListener('change', (e) => { settings.cam = e.target.value; saveSettings(); });
$('#optGfx').addEventListener('change', (e) => { settings.gfx = e.target.value; saveSettings(); applyQuality(); });
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
  $('#pracPanel').classList.remove('show');
  stopAnnouncer();
  $('#tutPanel').classList.remove('show');
  $('#intro').classList.remove('show');
  $('#vignette').classList.remove('on');
  applyBrightness();
}
function quitToMenu() {
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

// ---------- Game lifecycle ----------
function hookFx(g) {
  g.on((type, d) => {
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
  attachAnnouncer(game);
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
function connectOnline(code, role, tries = 0) {
  onlineError('');
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
  attachAnnouncer(game);
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
  attachAnnouncer(game);
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
    $('#cnArch').innerHTML = Object.entries(Season.ARCHETYPES).map(([k, a]) => `<button class="${k === create.arch ? 'on' : ''}" data-k="${k}">${a.label}<small>${a.desc}</small></button>`).join('');
    $('#cnSkin').innerHTML = SKINS.map((c) => `<button class="${c === create.skin ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Skin tone"></button>`).join('');
    $('#cnHair').innerHTML = HAIRS.map((c) => `<button class="${c === create.hair ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Hair color"></button>`).join('');
    $('#cnHairStyle').innerHTML = HAIR_STYLES.map((n, i) => `<button class="${i === create.hairStyle ? 'on' : ''}" data-i="${i}">${n}</button>`).join('');
    $$('#cnArch button').forEach((b) => b.addEventListener('click', () => { create.arch = b.dataset.k; sfx.menu(); chips(); }));
    $$('#cnSkin button').forEach((b) => b.addEventListener('click', () => { create.skin = b.dataset.c; chips(); }));
    $$('#cnHair button').forEach((b) => b.addEventListener('click', () => { create.hair = b.dataset.c; chips(); }));
    $$('#cnHairStyle button').forEach((b) => b.addEventListener('click', () => { create.hairStyle = Number(b.dataset.i); chips(); }));
    preview();
  };
  for (const id of ['#cnFirst', '#cnLast', '#cnPos', '#cnNum']) $(id).oninput = preview;
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
  const tabs = [...(kind === 'career' ? [['upgrades', 'Upgrades'], ['log', 'My Games']] : []), ['standings', 'Standings'], ['schedule', 'Schedule'], ['stats', 'Team Stats'], ['playoffs', 'Playoffs'], ['options', 'Options']];
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
    body.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px 8px"><span class="hint" style="margin:0;text-align:left">Earn Rep Points by playing games. Better grades earn more.</span><span class="rp">${c.rp}</span></div>` +
      Season.ATTRS.map(([k, l]) => {
        const cost = Season.upgradeCost(c.ratings[k]);
        return `<div class="upg"><span>${l}</span><b>${c.ratings[k]}</b><div class="bar"><i style="width:${c.ratings[k]}%"></i></div><button data-k="${k}" ${c.rp < cost ? 'disabled' : ''}>${cost === Infinity ? 'MAX' : `+1 · ◆${cost}`}</button></div>`;
      }).join('');
    $$('#hubTab .upg button').forEach((b) => b.addEventListener('click', () => {
      const before = Season.tier(Season.careerOvr(c)).name;
      if (Season.upgrade(s, b.dataset.k)) { if (Season.tier(Season.careerOvr(c)).name !== before) sfx.levelUp(); else sfx.select(); renderHub(); }
    }));
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
  const home = ng.h === s.team ? mine : TEAMS[ng.h];
  const away = ng.a === s.team ? mine : TEAMS[ng.a];
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
  if (game.slowT > 0 && game.focus) {
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
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 1 / 20);
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
  if (settings.gfx === 'high') composer.render();
  else renderer.render(scene, camera);
}

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
  show('menu');
  const first = () => { initAudio(); setQuiet(attract); musicMaybe(); };
  window.addEventListener('pointerdown', first, { once: true });
  window.addEventListener('keydown', first, { once: true });
})();

// Debug handle for testing in the browser console
window.pph = {
  manual: false, input, Season, portrait, camera,
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
