import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TEAMS, DIFFICULTY } from './data.js';
import { buildArena, C } from './arena.js';
import { Game } from './game.js';
import { input, pollInput, setupTouch, tapAction, ACTIONS, bindings, setKey, setPad, resetBindings, keyName, padName, firstGamepad } from './input.js';
import { initAudio, setMuted, setQuiet, sfx, startMusic, stopMusic, audioReady } from './audio.js';
import { loadCustomAssets, custom, portrait } from './assets.js';
import { Tutorial } from './tutorial.js';
import { FX } from './fx.js';
import { initAnnouncer, attachAnnouncer, sayIntro, setVoice, stopAnnouncer } from './announcer.js';
import * as Season from './season.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Settings (remembered per browser) ----------
const settings = { cam: 'broadcast', gfx: 'high', mute: false, home: 0, away: 3, side: 'home', diff: 'pro', q: '2', bright: 90, lock: -1, court: 'arena', voice: true, music: true, autoSubs: true };
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
function renderHome() {
  const h = TEAMS[settings.home], a = TEAMS[settings.away];
  $('#tilePlaySub').textContent = `${a.city} ${a.name} at ${h.city} ${h.name}`;
  $('#tilePlayArt').innerHTML = `${crest(a)}<span>VS</span>${crest(h)}`;
  const c = Season.load('career');
  $('#tileCareerSub').textContent = c ? `${c.career.first} ${c.career.last} · ${Season.careerOvr(c.career)} OVR · ${TEAMS[c.team].name} ${Season.record(c, c.team)}` : 'Create your player and start your journey';
  const s = Season.load('season');
  $('#tileSeasonSub').textContent = s ? `${TEAMS[s.team].city} ${TEAMS[s.team].name} · ${Season.record(s, s.team)} · Year ${s.year}` : 'Lead a team to the championship';
}
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
$('#optVoice').checked = settings.voice;
$('#optMusic').checked = settings.music;
$('#optBright').value = settings.bright;
$('#brightVal').textContent = `${settings.bright}%`;
setMuted(settings.mute);
setVoice(settings.voice && !settings.mute);
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
  el.textContent = el.dataset.kind === 'pad' ? 'Press a button…' : 'Press a key or click…';
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

// ---------- Buttons ----------
$('#startBtn').addEventListener('click', () => {
  initAudio(); sfx.select();
  session = { kind: 'quick', save: null };
  launch({ home: TEAMS[settings.home], away: TEAMS[settings.away], userSide: settings.side, diff: settings.diff, q: Number(settings.q), lock: settings.lock, stage: 'Exhibition' });
});
$('#tutorialBtn').addEventListener('click', () => { initAudio(); sfx.select(); startTutorial(); });
$('#tileSeason').addEventListener('click', () => { initAudio(); sfx.select(); musicMaybe(); openHub('season'); });
$('#tileCareer').addEventListener('click', () => { initAudio(); sfx.select(); musicMaybe(); openHub('career'); });
$('#resumeBtn').addEventListener('click', () => resume());
$('#pauseBtn').addEventListener('click', () => pause());
$('#switchBtn').addEventListener('click', () => { if (game && !attract) { game.switchPlayer(); sfx.menu(); } });
$('#timeoutBtn').addEventListener('click', () => tapAction('timeout'));
$('#pauseTimeout').addEventListener('click', () => { resume(); setTimeout(() => game && game.callTimeout(game.user), 30); });
$('#toContinue').addEventListener('click', () => { if (game) game.endTimeout(); });
$('#quitBtn').addEventListener('click', () => leaveGame());
$('#menuBtn').addEventListener('click', () => quitToMenu());
$('#rematchBtn').addEventListener('click', () => $('#startBtn').click());
$('#overContinue').addEventListener('click', () => afterSessionGame());
$('#tutExit').addEventListener('click', () => quitToMenu());
$('#tutSkip').addEventListener('click', () => { if (tutorial) tutorial.skip(); });
$('#tutPlay').addEventListener('click', () => { quitToMenu(); renderSelect(); show('select'); });
$('#tutMenu').addEventListener('click', () => quitToMenu());
canvas.addEventListener('pointerdown', () => { if (intro && intro.t > 0.6) endIntro(); });

function pause() { if (mode !== 'game' || intro) return; mode = 'paused'; show('pause'); }
function resume() { if (mode !== 'paused') return; mode = 'game'; show(null); if (game && game.state === 'timeout') $('#timeoutScreen').classList.add('show'); }
function endGameObjects() {
  if (game) { game.dispose(); game = null; }
  tutorial = null; attract = false; intro = null;
  stopAnnouncer();
  $('#tutPanel').classList.remove('show');
  $('#intro').classList.remove('show');
  $('#vignette').classList.remove('on');
  applyBrightness();
}
function quitToMenu() {
  endGameObjects();
  mode = 'menu';
  startAttract();
  renderHome();
  show('menu');
  musicMaybe();
}
// Leaving a season/career game goes back to its hub (the game isn't recorded)
function leaveGame() {
  if (session.save) { const kind = session.kind; quitToMenu(); openHub(kind); } else quitToMenu();
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
      extras += recordSessionGame(g, winner);
      $('#overExtras').innerHTML = extras;
      $('#boxscore').innerHTML = [g.away, g.home].map((t) => `
        <div class="box"><h4 style="color:${t.data.primary}">${t.data.city} ${t.data.name}</h4>
        <table><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3PT</th><th>FT</th><th>TO</th><th>PF</th></tr>
        ${everyone(t).map(statRow).join('')}
        </table></div>`).join('');
      const inSession = !!session.save;
      $('#overContinue').hidden = !inSession;
      $('#rematchBtn').hidden = inSession;
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
$$('.openSubs').forEach((b) => b.addEventListener('click', () => { if (!game || attract) return; subSel = { court: -1, bench: -1 }; renderSubs(); show('subs'); }));
$('#subsDone').addEventListener('click', () => {
  if (mode === 'paused') show('pause');
  else { show(null); if (game && game.state === 'timeout') $('#timeoutScreen').classList.add('show'); }
});
$('#optAutoSubs').addEventListener('change', (e) => { settings.autoSubs = e.target.checked; if (game) game.autoSubs = settings.autoSubs; saveSettings(); });

// ---------- Game lifecycle ----------
function hookFx(g) {
  g.on((type, d) => {
    if (type === 'score') {
      fx.crowdFlashes(d.kind === 'dunk' ? 70 : d.pts === 3 ? 45 : 18);
      if (d.kind === 'dunk') fx.sparks(new THREE.Vector3(d.team.dir * C.HOOP_X, C.RIM_H, 0), [1, 0.55, 0.2], 36);
      if (d.buzzer) fx.crowdFlashes(150);
    } else if (type === 'block') fx.crowdFlashes(30);
    else if (type === 'onFire') { fx.crowdFlashes(60); fx.sparks(new THREE.Vector3(d.player.pos.x, 1.2, d.player.pos.z), [1, 0.4, 0.1], 40); }
    else if (type === 'gameOver') { fx.celebrate([d.winner.data.primary, d.winner.data.secondary, '#ffffff', d.winner.data.accent]); fx.crowdFlashes(200); }
  });
}

function launch({ home, away, userSide, diff, q, lock, stage }) {
  endGameObjects();
  buildWorld(home, away);
  game = new Game(scene, arena, home, away, { difficulty: diff, quarterMinutes: q, userSide, playerLock: lock, autoSubs: settings.autoSubs }, hud);
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
  game.state = 'live';
  applyBrightness();
  $('#intro').classList.remove('show');
  camPos.set(0, 8.2, 16); camTarget.set(0, 1.2, 0);
  show(null);
  hud.toast('TIP-OFF', `You're the ${game.user.data.name} · ${game.firstPossession.data.name} ball first`, 2.2);
  sfx.whistle();
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

// ---------- Season & My Career ----------
let hubTab = 'standings';
let snTeam = 0;
let pendingCareer = null;
const SKINS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#a0673a', '#8d5524', '#5c3a1e', '#3d2716'];
const HAIRS = ['#111111', '#2b1b10', '#5a3a1a', '#8a6a3a', '#c9a26b', '#b23a2e', '#e8e8e8'];
const HAIR_STYLES = ['Bald', 'Short', 'Fade', 'Afro'];
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

function openHub(kind) {
  const s = Season.load(kind);
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
  const s = Season.newSeason({ kind, team: snTeam, diff, q, career: kind === 'career' ? pendingCareer : null });
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

  // Next game panel
  const ng = Season.nextGame(s);
  const nx = $('#hubNext');
  if (ng) {
    const h = TEAMS[ng.h], a = TEAMS[ng.a];
    nx.innerHTML = `<h4>${ng.stage}</h4><div class="mu"><span>${a.id}<small>${Season.record(s, ng.a)}</small></span><span style="color:var(--muted)">at</span><span>${h.id}<small>${Season.record(s, ng.h)}</small></span></div>
      <button class="primary" id="hubPlay">Play Game</button><button id="hubSim">Simulate</button>`;
    $('#hubPlay').onclick = () => playHubGame();
    $('#hubSim').onclick = () => { Season.simUserGame(s); sfx.menu(); maybeChampion(s) || renderHub(); };
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
      Season.clear(kind); session = { kind: 'quick', save: null }; renderHome(); show('menu');
    };
  }
}
$('#hubBack').addEventListener('click', () => { sfx.menu(); renderHome(); show('menu'); });

function playHubGame() {
  const s = session.save;
  const ng = Season.nextGame(s);
  if (!ng) return;
  const mine = s.career ? Season.careerTeamData(s) : TEAMS[s.team];
  const home = ng.h === s.team ? mine : TEAMS[ng.h];
  const away = ng.a === s.team ? mine : TEAMS[ng.a];
  sfx.select();
  launch({ home, away, userSide: ng.h === s.team ? 'home' : 'away', diff: s.diff, q: s.q, lock: s.career ? s.career.pos : -1, stage: ng.stage });
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
  game.update(dt);
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
  } else if (input.pressed.pause) { if (mode === 'game') pause(); else if (mode === 'paused') resume(); }
  if (game) {
    if (mode === 'game') {
      stepGame(dt);
      if (tutorial) tutorial.update(dt);
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
  if (custom.courtModel) $('#courtStyleWrap').hidden = false;
  else settings.court = 'arena';
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
  manual: false, input, Season,
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
