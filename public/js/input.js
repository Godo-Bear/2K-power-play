// Unified input: keyboard, gamepad (Standard mapping) and touch, with remappable bindings.
// Produces an abstract state each frame: move vector, sprint, and button held/pressed flags.

export const ACTIONS = [
  { id: 'up', label: 'Move up', kb: true },
  { id: 'down', label: 'Move down', kb: true },
  { id: 'left', label: 'Move left', kb: true },
  { id: 'right', label: 'Move right', kb: true },
  { id: 'sprint', label: 'Sprint', kb: true, pad: true },
  { id: 'shoot', label: 'Shoot / Block / Rebound', kb: true, pad: true },
  { id: 'pass', label: 'Pass / Steal', kb: true, pad: true },
  { id: 'move', label: 'Crossover / Quick switch (defense)', kb: true, pad: true },
  { id: 'switch', label: 'Switch player', kb: true, pad: true },
  { id: 'timeout', label: 'Call timeout', kb: true, pad: true },
  { id: 'pause', label: 'Pause', kb: true, pad: true },
];
const BUTTONS = ['shoot', 'pass', 'move', 'switch', 'sprint', 'timeout', 'pause'];

const DEFAULT_KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], shoot: ['Space', ''], pass: ['KeyJ', ''], move: ['KeyK', ''],
  switch: ['KeyQ', ''], timeout: ['KeyT', ''], pause: ['Escape', 'KeyP'],
};
// Standard mapping: 0=A/✕ 1=B/○ 2=X/□ 3=Y/△ 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start
const DEFAULT_PAD = { sprint: 7, shoot: 2, pass: 0, move: 1, switch: 4, timeout: 8, pause: 9 };

const STORE = 'pph-bindings';
export const bindings = { keys: structuredClone(DEFAULT_KEYS), pad: { ...DEFAULT_PAD } };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved) {
    for (const a of Object.keys(DEFAULT_KEYS)) if (Array.isArray(saved.keys?.[a])) bindings.keys[a] = [saved.keys[a][0] || '', saved.keys[a][1] || ''];
    for (const a of Object.keys(DEFAULT_PAD)) if (Number.isInteger(saved.pad?.[a])) bindings.pad[a] = saved.pad[a];
  }
} catch { /* ignore */ }
function save() { try { localStorage.setItem(STORE, JSON.stringify(bindings)); } catch { /* ignore */ } }

export function setKey(action, slot, code) {
  // A key can only do one thing: remove it from other actions
  if (code) for (const a of Object.keys(bindings.keys)) bindings.keys[a] = bindings.keys[a].map((c) => (c === code ? '' : c));
  bindings.keys[action][slot] = code;
  save();
}
export function setPad(action, index) {
  for (const a of Object.keys(bindings.pad)) if (bindings.pad[a] === index) bindings.pad[a] = -1;
  bindings.pad[action] = index;
  save();
}
export function resetBindings() {
  bindings.keys = structuredClone(DEFAULT_KEYS);
  bindings.pad = { ...DEFAULT_PAD };
  save();
}

const KEY_NAMES = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps' };
const MOUSE_NAMES = ['Left Click', 'Middle Click', 'Right Click', 'Mouse 4', 'Mouse 5'];
export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Mouse')) return MOUSE_NAMES[Number(code.slice(5))] || code;
  if (code === 'WheelUp') return 'Scroll Up';
  if (code === 'WheelDown') return 'Scroll Down';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
const PAD_NAMES = ['A / ✕', 'B / ○', 'X / □', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back / Share', 'Start / Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];
export function padName(i) { return i == null || i < 0 ? '—' : PAD_NAMES[i] || `Button ${i}`; }
// Short label for UI hints, e.g. "Space" or "Space / X / □" when a controller is in use
export function label(action) {
  const k = bindings.keys[action]?.filter(Boolean).map(keyName).join(' / ') || '—';
  if (input.usingGamepad && bindings.pad[action] >= 0) return padName(bindings.pad[action]);
  return k;
}

const keys = new Set();
const tapped = new Set(); // keys pressed since the last poll (so quick taps are never missed)
const touch = { x: 0, y: 0, buttons: {} };
const prev = {};
export const input = {
  moveX: 0, moveY: 0, sprint: false,
  held: Object.fromEntries(BUTTONS.map((b) => [b, false])),
  pressed: Object.fromEntries(BUTTONS.map((b) => [b, false])),
  released: Object.fromEntries(BUTTONS.map((b) => [b, false])),
  usingGamepad: false,
  capturing: false, // true while the remap UI waits for a key
};

window.addEventListener('keydown', (e) => {
  if (input.capturing) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  keys.add(e.code);
  tapped.add(e.code);
  input.usingGamepad = false;
  const bound = Object.values(bindings.keys).some((arr) => arr.includes(e.code));
  if (bound || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// Mouse buttons act like keys ("Mouse0" = left, "Mouse2" = right ...) when pressed on the game view
const mouseBound = (code) => Object.values(bindings.keys).some((arr) => arr.includes(code));
window.addEventListener('mousedown', (e) => {
  if (input.capturing || e.target.tagName !== 'CANVAS') return;
  const code = `Mouse${e.button}`;
  if (!mouseBound(code)) return;
  keys.add(code); tapped.add(code);
  input.usingGamepad = false;
  e.preventDefault();
});
window.addEventListener('mouseup', (e) => keys.delete(`Mouse${e.button}`));
window.addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS' && mouseBound('Mouse2')) e.preventDefault(); });
// The scroll wheel counts as a quick button tap ("WheelUp" / "WheelDown")
const wheelTimers = {};
window.addEventListener('wheel', (e) => {
  if (input.capturing || e.target.tagName !== 'CANVAS' || !e.deltaY) return;
  const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  if (!mouseBound(code)) return;
  e.preventDefault();
  keys.add(code); tapped.add(code);
  input.usingGamepad = false;
  clearTimeout(wheelTimers[code]);
  wheelTimers[code] = setTimeout(() => keys.delete(code), 140);
}, { passive: false });
window.addEventListener('auxclick', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
window.addEventListener('blur', () => { keys.clear(); tapped.clear(); });

export function firstGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) if (gp && gp.connected) return gp;
  return null;
}
const padDown = (gp, i) => i >= 0 && !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));

function gamepadState() {
  const gp = firstGamepad();
  if (!gp) return null;
  let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
  if (Math.hypot(x, y) < 0.18) { x = 0; y = 0; }
  const used = new Set(Object.values(bindings.pad));
  if (!used.has(14) && padDown(gp, 14)) x = -1;
  if (!used.has(15) && padDown(gp, 15)) x = 1;
  if (!used.has(12) && padDown(gp, 12)) y = -1;
  if (!used.has(13) && padDown(gp, 13)) y = 1;
  if (x !== 0 || y !== 0 || gp.buttons.some((bt) => bt.pressed)) input.usingGamepad = true;
  const out = { x, y };
  for (const b of BUTTONS) out[b] = padDown(gp, bindings.pad[b]);
  return out;
}

const keyHeld = (action) => bindings.keys[action].some((c) => c && (keys.has(c) || tapped.has(c)));

export function pollInput() {
  let x = 0, y = 0;
  if (keyHeld('left')) x -= 1;
  if (keyHeld('right')) x += 1;
  if (keyHeld('up')) y -= 1;
  if (keyHeld('down')) y += 1;

  const held = {};
  for (const b of BUTTONS) held[b] = keyHeld(b) || !!touch.buttons[b];

  const gp = gamepadState();
  if (gp) {
    if (gp.x || gp.y) { x = gp.x; y = gp.y; }
    for (const b of BUTTONS) held[b] = held[b] || gp[b];
  }
  if (touch.x || touch.y) { x = touch.x; y = touch.y; }
  if (input.capturing) { x = 0; y = 0; for (const b of BUTTONS) held[b] = false; }

  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  input.moveX = x; input.moveY = y;

  for (const b of BUTTONS) {
    input.pressed[b] = held[b] && !prev[b];
    input.released[b] = !held[b] && !!prev[b];
    input.held[b] = held[b];
    prev[b] = held[b];
  }
  input.sprint = held.sprint;
  tapped.clear();
}

// ---------- Touch controls ----------
export function setupTouch(root) {
  // Hidden until the screen is actually touched; hidden again when keyboard, mouse or controller is used
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') root.classList.add('show'); }, true);
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) root.classList.remove('show'); });
  window.addEventListener('keydown', () => root.classList.remove('show'));
  setInterval(() => { if (input.usingGamepad) root.classList.remove('show'); }, 500);
  const stick = root.querySelector('.stick');
  const knob = root.querySelector('.knob');
  let stickId = null, cx = 0, cy = 0;
  const R = 50;
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  const moveStick = (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx = dx / l * R; dy = dy / l * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.x = dx / R; touch.y = dy / R;
    if (Math.hypot(touch.x, touch.y) < 0.15) { touch.x = 0; touch.y = 0; }
  };
  stick.addEventListener('pointermove', moveStick);
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null; touch.x = 0; touch.y = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  root.querySelectorAll('[data-btn]').forEach((el) => {
    const name = el.dataset.btn;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.buttons[name] = true; el.classList.add('down'); el.setPointerCapture(e.pointerId); });
    const up = () => { touch.buttons[name] = false; el.classList.remove('down'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// A HUD/touch button can tap an action for one frame
export function tapAction(name) {
  touch.buttons[name] = true;
  setTimeout(() => { touch.buttons[name] = false; }, 80);
}
