// Best moments: when your team makes a big play, a small picture of it is taken from the game camera. At the end of the
// game the best play is kept (with its picture) so the home screen can show your latest highlight, and the Moments screen
// keeps your last twelve. The pictures stay in this browser (they are too big for the cloud save), one list per account.
import { auth } from './auth.js';

const MAX = 12;
const keyFor = () => `pphm:${(auth.user && !auth.offline && auth.user) || ''}`;
const MIN_PLAY = 3.2;          // plays below this excitement score are not worth a picture

export function list() {
  try { const v = JSON.parse(localStorage.getItem(keyFor()) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function store(items) {
  // pictures are big: if the browser is out of room, drop the oldest until it fits
  let l = items.slice(0, MAX);
  while (l.length) {
    try { localStorage.setItem(keyFor(), JSON.stringify(l)); return; } catch { l = l.slice(0, -1); }
  }
}
export function remove(id) { store(list().filter((m) => m.id !== id)); }

// ---------- Taking pictures ----------
let want = null;        // { entry, at } waiting for the next rendered frame
const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
// Ask for a picture of a play a moment from now (so the camera has the action in frame)
export function requestShot(entry, delay = 0.28) {
  if (!entry || entry.thumb || entry.score < MIN_PLAY) return;
  if (want && want.entry.score >= entry.score) return;
  want = { entry, at: performance.now() + delay * 1000 };
}
// Called right after the frame is drawn (the WebGL picture is only readable then)
export function afterRender(canvas) {
  if (!want || performance.now() < want.at || !cv) return;
  const e = want.entry; want = null;
  try {
    const w = 400, h = 225;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    // centre crop to 16:9
    const sw = canvas.width, sh = canvas.height, r = w / h;
    let cw = sw, ch = sw / r;
    if (ch > sh) { ch = sh; cw = sh * r; }
    ctx.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
    e.thumb = cv.toDataURL('image/jpeg', 0.74);
  } catch { /* the picture is a bonus: never break the game for it */ }
}
export function cancelShots() { want = null; }

// ---------- Keeping the best play of a game ----------
// g: the finished game; meta: { mode, opp, won, score }
export function keepBest(g, meta) {
  const reel = (g.reel || []).filter((e) => e.thumb && e.teamObj && e.teamObj.isUser);
  if (!reel.length) return null;
  const best = reel.slice().sort((a, b) => b.score - a.score)[0];
  const m = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    t: Date.now(), icon: best.icon || '🏀', head: best.headline || 'Big play', text: best.detail || '',
    when: `${best.period <= 4 ? `Q${best.period}` : 'OT'} ${best.clock || ''}`.trim(), score: Math.round(best.score * 10) / 10,
    mode: meta.mode, opp: meta.opp, won: !!meta.won, final: meta.score, team: best.team, color: best.teamObj.data.primary,
    img: best.thumb,
  };
  store([m, ...list()]);
  return m;
}

// ---------- A picture card to save or share ----------
export async function cardImage(m) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 675;
  const x = c.getContext('2d');
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = m.img; });
  if (img) x.drawImage(img, 0, 0, 1200, 675); else { x.fillStyle = '#0b1020'; x.fillRect(0, 0, 1200, 675); }
  const g = x.createLinearGradient(0, 300, 0, 675);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.88)');
  x.fillStyle = g; x.fillRect(0, 0, 1200, 675);
  x.fillStyle = m.color || '#35f0ff'; x.fillRect(48, 520, 10, 108);
  x.fillStyle = '#fff'; x.font = 'italic 900 64px system-ui, sans-serif'; x.fillText(m.head.toUpperCase(), 76, 575);
  x.fillStyle = '#c6cfe2'; x.font = '600 28px system-ui, sans-serif'; x.fillText(`${m.text}`.slice(0, 80), 78, 618);
  x.font = '800 22px system-ui, sans-serif'; x.fillStyle = '#35f0ff'; x.fillText('2K POWER PLAY', 48, 64);
  x.fillStyle = '#ffffffcc'; x.textAlign = 'right'; x.fillText(`${m.when}${m.final ? ` · ${m.final}` : ''}`, 1152, 64);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
