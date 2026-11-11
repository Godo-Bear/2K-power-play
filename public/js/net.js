// Online play. The HOST's browser runs the real match; the GUEST sends inputs and
// receives snapshots of the game state ~30 times a second, which it smooths and draws.
// A small relay on the Cloudflare Worker (src/worker.js) passes messages between the two.
import { auth } from './auth.js';

const BTN = ['shoot', 'pass', 'move', 'switch', 'sprint', 'timeout', 'pause'];
const r2 = (v) => Math.round(v * 100) / 100;

export function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike letters (I/O/0/1)
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

const ERRORS = {
  'not-found': "No room with that code. Check the code, and make sure your friend's room is still open.",
  full: 'That room already has two players.',
  'code-taken': 'That code is in use. Try again.',
  'bad-role': 'Could not join the room.',
};

// ---------- Connection ----------
export class Room {
  constructor(code, role, on) {
    this.code = code; this.role = role; this.on = on;
    this.open = false; this.closed = false; this.joined = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      this.ws = new WebSocket(`${proto}://${location.host}/api/room/${code}?role=${role}&token=${encodeURIComponent(auth.token || '')}`);
    } catch (e) { setTimeout(() => this.fail('Could not connect.'), 0); return; }
    this.ws.onopen = () => { this.open = true; };
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.k === 'sys') {
        if (m.ev === 'joined') { this.joined = true; on.joined && on.joined(m); }
        else if (m.ev === 'error') { this.error = ERRORS[m.code] || 'Could not join the room.'; }
        else if (m.ev === 'peer-joined') on.peerJoined && on.peerJoined();
        else if (m.ev === 'peer-left') on.peerLeft && on.peerLeft();
        return;
      }
      on.message && on.message(m);
    };
    this.ws.onerror = () => { if (!this.joined && !this.error) this.error = 'Online play is not available here. It needs the game to be running on its Cloudflare site.'; };
    this.ws.onclose = () => {
      this.open = false;
      if (this.closed) return;
      this.closed = true;
      on.closed && on.closed(this.error || (this.joined ? 'Connection lost.' : 'Online play is not available here. It needs the game to be running on its Cloudflare site.'));
    };
  }

  fail(msg) { if (!this.closed) { this.closed = true; this.on.closed && this.on.closed(msg); } }
  send(obj) { if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  close() { this.closed = true; try { this.ws.close(1000); } catch { /* ignore */ } }
}

// ---------- Remote player's controller (lives on the host) ----------
export function makeRemoteInput() {
  const inp = {
    moveX: 0, moveY: 0, sprint: false,
    held: Object.fromEntries(BTN.map((b) => [b, false])),
    pressed: Object.fromEntries(BTN.map((b) => [b, false])),
    released: Object.fromEntries(BTN.map((b) => [b, false])),
    _held: 0, _tap: 0,
    // A message from the guest: stick position, buttons held, and buttons tapped since the last message
    receive(m) { inp.moveX = m.x || 0; inp.moveY = m.y || 0; inp._held = m.h | 0; inp._tap |= m.t | 0; },
    // Call once per host frame, before the game update
    tick() {
      BTN.forEach((b, i) => {
        const bit = 1 << i;
        const h = !!((inp._held | inp._tap) & bit);
        inp.pressed[b] = h && !inp.held[b];
        inp.released[b] = !h && inp.held[b];
        inp.held[b] = h;
      });
      inp._tap = 0;
      inp.sprint = inp.held.sprint;
    },
  };
  return inp;
}

// Guest: pack the local input for sending
export function makeInputSender(input) {
  let tap = 0;
  return {
    frame() { BTN.forEach((b, i) => { if (input.pressed[b]) tap |= 1 << i; }); },
    message() {
      let h = 0;
      BTN.forEach((b, i) => { if (input.held[b]) h |= 1 << i; });
      const m = { k: 'i', x: r2(input.moveX), y: r2(input.moveY), h, t: tap };
      tap = 0;
      return m;
    },
  };
}

// ---------- Game events (so the guest hears the announcer and sees effects) ----------
const FORWARD = new Set(['shot', 'tipoff', 'score', 'block', 'steal', 'miss', 'foul', 'foulOut', 'onFire', 'heatingUp', 'timeout', 'sub', 'periodEnd', 'gameOver']);
export function packEvent(g, type, d) {
  if (!FORWARD.has(type)) return null;
  const team = d.team || d.winner;
  return {
    e: type, p: g.idOf(d.player), v: g.idOf(d.victim), df: g.idOf(d.def), a: g.idOf(d.assist), i: g.idOf(d.inn), o: g.idOf(d.out),
    t: team ? (team === g.home ? 0 : 1) : -1, pts: d.pts, kind: d.kind, bz: d.buzzer ? 1 : 0, label: d.label, period: d.period, air: d.airball ? 1 : 0,
  };
}
export function unpackEvent(g, m) {
  const P = (id) => (id >= 0 ? g.playerById(id) : null);
  const team = m.t >= 0 ? g.teams[m.t] : null;
  return { player: P(m.p), victim: P(m.v), def: P(m.df), assist: P(m.a), inn: P(m.i), out: P(m.o), team, winner: team, pts: m.pts, kind: m.kind, buzzer: !!m.bz, label: m.label, period: m.period, airball: !!m.air };
}

// ---------- Snapshots ----------
const STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'to', 'pf', 'sec'];

export function snapshot(g, withStats) {
  const P = [];
  for (const t of g.teams) {
    for (const p of t.players) {
      let f = 0;
      if (p.released) f |= 1; if (p.airborne) f |= 2; if (p.onFire) f |= 4; if (p.sprinting) f |= 8;
      if (p.stumbleT > 0) f |= 16; if (p.fouledOut) f |= 32; if (p.burstT > 0.25) f |= 64; if ((p.crossSide || 1) < 0) f |= 128;
      const row = [p.rid, r2(p.pos.x), r2(p.pos.z), r2(p.y), r2(p.facing), r2(p.vel.x), r2(p.vel.z), p.state, r2(p.actionT), f, r2(p.energy), r2(p.stamina)];
      // Move details, only while something special is happening
      if (p.state !== 'idle' || (p.moveT || 0) > 0 || (p.passT || 0) > 0) {
        row.push(p.shotStyle || '', (p.moveT || 0) > 0 ? p.moveName : '', r2(p.moveT || 0), r2(p.spinT || 0), p.spinDir || 1,
          r2(p.passT || 0), p.passStyle || '', p.passLocal ? r2(p.passLocal[0]) : 0, p.passLocal ? r2(p.passLocal[1]) : 0, p.stealStyle || '');
      }
      P.push(row);
    }
  }
  const b = g.ball, away = g.away, m = away.meter;
  const s = {
    k: 's', st: g.state, pe: g.period, gc: r2(g.gameClock), sc: r2(g.shotClock), sf: g.shotClockFrozen ? 1 : 0,
    po: g.possession === g.home ? 0 : 1, sl: r2(Math.max(0, g.slowT)), fo: g.idOf(g.focus), cs: r2(g.cameraShake),
    ce: g.celebrateTeam ? (g.celebrateTeam === g.home ? 0 : 1) : -1,
    s0: g.home.score, s1: g.away.score, to: [g.home.timeouts, g.away.timeouts], fl: [g.home.fouls, g.away.fouls], d: [g.home.dir, g.away.dir],
    cp: g.idOf(away.cp), lk: away.lock ? 1 : 0,
    p: P,
    b: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), r2(b.vel.x), r2(b.vel.y), r2(b.vel.z), b.state, g.idOf(b.holder), b.shot ? g.idOf(b.shot.shooter) : -1, r2(b.spin)],
    m: m.visible ? [r2(m.result ? m.result.value : m.value), r2(m.win), m.result ? m.result.label : '', m.result ? m.result.color : '', g.idOf(m.player)] : 0,
    ft: g.ft ? [g.idOf(g.ft.shooter), g.ft.phase] : 0,
    na: g.netAnim.map(r2),
  };
  if (withStats) {
    s.ss = {};
    for (const t of g.teams) for (const p of [...t.players, ...t.bench]) s.ss[g.idOf(p)] = STAT_KEYS.map((k) => Math.round(p.stats[k]));
  }
  return s;
}

// Guest: take a snapshot from the host and set targets to glide toward
export function applySnapshot(g, s) {
  const now = performance.now();
  s.p.forEach((a, i) => {
    const t = g.teams[i < 5 ? 0 : 1];
    const slot = i % 5;
    // Substitutions: make our lineup match the host's
    if (t.players[slot].rid !== a[0]) {
      const bi = t.bench.findIndex((q) => q.rid === a[0]);
      if (bi >= 0) {
        const out = t.players[slot], inn = t.bench[bi];
        inn.pos.set(a[1], 0, a[2]); inn.index = slot; out.index = bi;
        out.root.visible = false; inn.root.visible = true; out.setControlled(false);
        t.players[slot] = inn; t.bench[bi] = out;
        if (t.cp === out) t.cp = null;
      }
    }
    const p = t.players[slot];
    const f = a[9];
    if (!p.net) p.pos.set(a[1], 0, a[2]);
    p.net = { x: a[1], z: a[2], vx: a[5], vz: a[6], facing: a[4], t: now };
    p.y = a[3]; p.vel.set(a[5], 0, a[6]); p.state = a[7]; p.actionT = a[8];
    p.released = !!(f & 1); p.jumpT = f & 2 ? 0.01 : -1; p.onFire = !!(f & 4); p.sprinting = !!(f & 8);
    p.stumbleT = f & 16 ? 0.5 : 0; p.fouledOut = !!(f & 32); p.burstT = f & 64 ? 0.4 : 0; p.crossSide = f & 128 ? -1 : 1;
    p.energy = a[10]; p.stamina = a[11];
    if (a.length > 12) {
      p.shotStyle = a[12] || p.shotStyle; p.moveName = a[13] || p.moveName; p.moveT = a[14]; p.spinT = a[15]; p.spinDir = a[16];
      p.passT = a[17]; p.passStyle = a[18]; p.passLocal = [a[19], a[20]]; p.stealStyle = a[21];
    } else { p.moveT = 0; p.spinT = 0; p.passT = 0; }
  });
  const b = g.ball, sb = s.b;
  if (!b.net) b.pos.set(sb[0], sb[1], sb[2]);
  b.net = { x: sb[0], y: sb[1], z: sb[2], vx: sb[3], vy: sb[4], vz: sb[5], t: now };
  b.state = sb[6]; b.holder = sb[7] >= 0 ? g.playerById(sb[7]) : null;
  b.shot = sb[8] >= 0 ? { shooter: g.playerById(sb[8]) } : null;
  b.spin = sb[9];

  g.state = s.st; g.period = s.pe; g.gameClock = s.gc; g.shotClock = s.sc; g.shotClockFrozen = !!s.sf;
  g.possession = g.teams[s.po]; g.slowT = s.sl; g.focus = s.fo >= 0 ? g.playerById(s.fo) : null; g.cameraShake = s.cs;
  g.celebrateTeam = s.ce >= 0 ? g.teams[s.ce] : null;
  g.home.score = s.s0; g.away.score = s.s1;
  g.teams.forEach((t, i) => { t.timeouts = s.to[i]; t.fouls = s.fl[i]; t.dir = s.d[i]; });
  s.na.forEach((v, i) => { if (v > g.netAnim[i]) g.netAnim[i] = v; });

  // Which of my players I'm controlling (decided by the host)
  const me = s.cp >= 0 ? g.playerById(s.cp) : null;
  if (me && g.user.cp !== me) g.setCtl(g.user, me);
  g.user.lock = s.lk ? me : null;
  const m = g.user.meter;
  if (s.m) {
    m.visible = true; m.value = s.m[0]; m.win = s.m[1]; m.player = g.playerById(s.m[4]);
    m.result = s.m[2] ? { label: s.m[2], color: s.m[3], value: s.m[0] } : null;
  } else { m.visible = false; m.result = null; }
  if (s.ft) { const sh = g.playerById(s.ft[0]); g.ft = sh ? { shooter: sh, team: sh.team, phase: s.ft[1] } : null; } else g.ft = null;
  if (s.ss) {
    for (const [id, arr] of Object.entries(s.ss)) {
      const p = g.playerById(Number(id));
      if (p) STAT_KEYS.forEach((k, i) => { p.stats[k] = arr[i]; });
    }
  }
}

// Guest: every frame, glide everything toward the latest snapshot and animate
export function guestFrame(g, dt) {
  const now = performance.now();
  const k = 1 - Math.exp(-dt * 16);
  for (const p of g.allPlayers) {
    const n = p.net;
    if (!n) continue;
    const age = Math.min(0.12, (now - n.t) / 1000);
    const tx = n.x + n.vx * age, tz = n.z + n.vz * age;
    if (Math.hypot(tx - p.pos.x, tz - p.pos.z) > 3.5) { p.pos.x = tx; p.pos.z = tz; }
    else { p.pos.x += (tx - p.pos.x) * k; p.pos.z += (tz - p.pos.z) * k; }
    let df = n.facing - p.facing;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    p.facing += df * Math.min(1, dt * 14);
  }
  const b = g.ball, n = b.net;
  if (n) {
    const moving = b.state !== 'held';
    const age = moving ? Math.min(0.1, (now - n.t) / 1000) : 0;
    const tx = n.x + n.vx * age, ty = n.y + n.vy * age, tz = n.z + n.vz * age;
    const kb = 1 - Math.exp(-dt * 26);
    if (Math.hypot(tx - b.pos.x, ty - b.pos.y, tz - b.pos.z) > 4) b.pos.set(tx, ty, tz);
    else { b.pos.x += (tx - b.pos.x) * kb; b.pos.y += (ty - b.pos.y) * kb; b.pos.z += (tz - b.pos.z) * kb; }
  }
  g.time += dt;
  g.animateAll(dt);
}
