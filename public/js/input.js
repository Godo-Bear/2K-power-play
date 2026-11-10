// Unified input: keyboard, gamepad (Standard mapping) and touch.
// Produces an abstract state each frame: move vector, sprint, and button held/pressed flags.

const keys = new Set();
const touch = { x: 0, y: 0, buttons: {} };
const BUTTONS = ['shoot', 'pass', 'move', 'sprint', 'pause'];

const prev = {};
export const input = {
  moveX: 0, moveY: 0, sprint: false,
  held: { shoot: false, pass: false, move: false, sprint: false, pause: false },
  pressed: { shoot: false, pass: false, move: false, sprint: false, pause: false },
  released: { shoot: false, pass: false, move: false, sprint: false, pause: false },
  usingGamepad: false,
};

const KEYMAP = {
  shoot: ['Space'],
  pass: ['KeyJ', 'KeyL'],
  move: ['KeyK', 'KeyE'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
};

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  keys.add(e.code);
  input.usingGamepad = false;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function gamepadState() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (Math.hypot(x, y) < 0.18) { x = 0; y = 0; }
    if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) y = -1; if (b(13)) y = 1;
    const active = x !== 0 || y !== 0 || gp.buttons.some((bt) => bt.pressed);
    if (active) input.usingGamepad = true;
    return {
      x, y,
      // Standard mapping: 0=A/Cross 1=B/Circle 2=X/Square 3=Y/Triangle 7=RT 9=Start
      shoot: b(2) || b(3),
      pass: b(0),
      move: b(1) || b(5),
      sprint: b(7) || b(6),
      pause: b(9),
    };
  }
  return null;
}

export function pollInput() {
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;

  const held = {};
  for (const b of BUTTONS) held[b] = KEYMAP[b].some((k) => keys.has(k)) || !!touch.buttons[b];

  const gp = gamepadState();
  if (gp) {
    if (gp.x || gp.y) { x = gp.x; y = gp.y; }
    for (const b of BUTTONS) held[b] = held[b] || gp[b];
  }
  if (touch.x || touch.y) { x = touch.x; y = touch.y; }

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
}

// ---------- Touch controls ----------
export function setupTouch(root) {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!isTouch) return;
  root.classList.add('show');
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
