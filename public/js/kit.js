// Kit customisation: team colours, home kit style, logo and shoes. Saved per team in this browser and applied
// straight onto the team data, so every screen, the court and the 3D players pick it up.
export const SYMBOLS = ['', '🏀', '⚡', '🔥', '👑', '🐺', '🦅', '⭐', '🌊', '🛡️', '⚔️', '🦂', '🏔️', '🐍', '🦏', '🚀', '💎', '🌵', '🌙', '☀️'];
export const SHAPES = { circle: 'Circle', square: 'Rounded', shield: 'Shield', pill: 'Pill' };
export const PALETTE = ['#e63946', '#ff6a13', '#ffd60a', '#3dff7a', '#19c37d', '#0fb5ae', '#35f0ff', '#3c8bff', '#5b2bd1', '#7b2cbf', '#ff2e88', '#ffffff', '#aab4c0', '#1c1c1c', '#0b1f3a', '#7a1024'];
export const SHOE_COLORS = [null, '#ffffff', '#1c1c1c', '#e63946', '#ff6a13', '#ffd60a', '#3dff7a', '#35f0ff', '#3c8bff', '#5b2bd1', '#ff2e88', '#c9a227'];
const KEY = 'pph-kits';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ } };

export const defaultKit = (t) => ({
  primary: t._orig.primary, secondary: t._orig.secondary, accent: t._orig.accent,
  homeStyle: 'white', logo: { symbol: '', shape: 'circle' }, shoeUpper: null, shoeSole: null,
});
export function getKit(t) { remember(t); return { ...defaultKit(t), ...(read()[t.id] || {}), logo: { ...defaultKit(t).logo, ...((read()[t.id] || {}).logo || {}) } }; }

function remember(t) { if (!t._orig) t._orig = { primary: t.primary, secondary: t.secondary, accent: t.accent }; }
export function applyKit(t) {
  remember(t);
  const k = { ...defaultKit(t), ...(read()[t.id] || {}) };
  t.primary = k.primary; t.secondary = k.secondary; t.accent = k.accent;
  t.homeStyle = k.homeStyle; t.logo = { symbol: '', shape: 'circle', ...(k.logo || {}) };
  t.shoeUpper = k.shoeUpper; t.shoeSole = k.shoeSole;
}
export function applyAllKits(teams) { teams.forEach(applyKit); }
export function saveKit(t, kit) { const all = read(); all[t.id] = kit; write(all); applyKit(t); }
export function resetKit(t) { const all = read(); delete all[t.id]; write(all); applyKit(t); }
