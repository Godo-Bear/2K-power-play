// Procedural Web Audio sound effects: no external sound files needed.
let ctx = null;
let master = null;
let crowdGain = null;
let muted = false;
let quiet = false; // attract mode: game sounds off, UI sounds still on
export function setQuiet(q) { quiet = q; if (crowdGain && ctx) crowdGain.gain.setTargetAtTime(q ? 0.03 : 0.12, ctx.currentTime, 0.3); }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.7;
  master.connect(ctx.destination);

  // Crowd ambience: looped filtered noise.
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
  crowdGain = ctx.createGain();
  crowdGain.gain.value = 0.12;
  src.connect(bp).connect(crowdGain).connect(master);
  src.start();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.7;
}
export function isMuted() { return muted; }

let uiCall = false;
function noiseBurst(dur, freq, type = 'bandpass', gain = 0.5, q = 1) {
  if (!ctx || (quiet && !uiCall)) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start();
}

function tone(freq, dur, type = 'sine', gain = 0.3, endFreq = null, delay = 0) {
  if (!ctx || (quiet && !uiCall)) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  dribble(vol = 1) { tone(110, 0.09, 'sine', 0.45 * vol, 55); noiseBurst(0.04, 900, 'lowpass', 0.15 * vol); },
  swish() { noiseBurst(0.35, 4500, 'highpass', 0.35, 0.7); },
  rim() { tone(620, 0.35, 'triangle', 0.18); tone(1340, 0.25, 'triangle', 0.08); tone(910, 0.3, 'square', 0.03); },
  board() { tone(160, 0.15, 'sine', 0.35, 90); noiseBurst(0.08, 1500, 'bandpass', 0.2); },
  pass() { noiseBurst(0.07, 1200, 'bandpass', 0.15); },
  catch() { tone(140, 0.06, 'sine', 0.3, 80); },
  squeak() { tone(2400 + Math.random() * 900, 0.08, 'sine', 0.05, 3200); },
  whistle() { tone(2900, 0.5, 'sine', 0.12); tone(3050, 0.5, 'sine', 0.08); },
  buzzer() { tone(196, 1.1, 'sawtooth', 0.18); tone(198, 1.1, 'square', 0.08); },
  dunk() { tone(90, 0.35, 'sine', 0.6, 40); noiseBurst(0.25, 600, 'lowpass', 0.4); tone(480, 0.5, 'triangle', 0.12); },
  green() { tone(880, 0.12, 'sine', 0.12); tone(1320, 0.18, 'sine', 0.1, null, 0.06); },
  menu() { uiCall = true; tone(660, 0.06, 'sine', 0.1); uiCall = false; },
  select() { uiCall = true; tone(520, 0.08, 'triangle', 0.12); tone(780, 0.12, 'triangle', 0.1, null, 0.05); uiCall = false; },
  levelUp() { uiCall = true; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.13, null, i * 0.09)); uiCall = false; },
  horn() { tone(233, 0.9, 'sawtooth', 0.12); tone(349, 0.9, 'sawtooth', 0.08); },
  cheer(intensity = 1) {
    if (!crowdGain || quiet) return;
    const t = ctx.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.linearRampToValueAtTime(0.12 + 0.45 * intensity, t + 0.25);
    crowdGain.gain.linearRampToValueAtTime(0.12, t + 2.8);
  },
  groan() {
    if (!crowdGain || quiet) return;
    const t = ctx.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.linearRampToValueAtTime(0.25, t + 0.2);
    crowdGain.gain.linearRampToValueAtTime(0.12, t + 1.4);
  },
};

// ---------- Original procedural menu music (drums, bass, pad) ----------
let musicOn = false, musicTimer = null, musicGain = null, nextBar = 0, barNo = 0;
const BPM = 92, BEAT = 60 / BPM;
const BASS = [55, 55, 65.4, 49];           // A1 A1 C2 G1
const CHORDS = [[220, 261.6, 329.6], [220, 261.6, 329.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];

function mTone(freq, t, dur, type, gain, lp) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
  node.connect(g).connect(musicGain); o.start(t); o.stop(t + dur + 0.05);
}
function mKick(t) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g).connect(musicGain); o.start(t); o.stop(t + 0.25); }
function mNoise(t, dur, freq, gain, type = 'highpass') {
  const n = Math.floor(ctx.sampleRate * dur); const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = gain; src.connect(f).connect(g).connect(musicGain); src.start(t);
}
function scheduleBar(t, bar) {
  const c = bar % 4;
  [0, 1.5, 2.5].forEach((b) => mKick(t + b * BEAT));
  if (bar % 2 === 1) mKick(t + 3.5 * BEAT);
  [1, 3].forEach((b) => mNoise(t + b * BEAT, 0.16, 1800, 0.32, 'bandpass'));
  for (let i = 0; i < 8; i++) mNoise(t + i * BEAT / 2, 0.04, 7000, i % 2 ? 0.1 : 0.05);
  [0, 0.75, 1.5, 2.5, 3.25].forEach((b, i) => mTone(BASS[c] * (i === 3 ? 1.5 : 1), t + b * BEAT, 0.3, 'sawtooth', 0.22, 320));
  for (const f of CHORDS[c]) mTone(f, t, BEAT * 3.8, 'triangle', 0.035, 1400);
  const lead = [0, 2, 4, 2, 0, 4, 2, 0];
  if (bar % 8 >= 4) [0.5, 1.5, 2, 3].forEach((b, i) => mTone(CHORDS[c][lead[(bar + i) % 8] % 3] * 2, t + b * BEAT, 0.25, 'square', 0.025, 2200));
}
export function startMusic() {
  if (!ctx || musicOn) return;
  musicOn = true;
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0001; musicGain.connect(master);
  musicGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.2);
  nextBar = ctx.currentTime + 0.1; barNo = 0;
  musicTimer = setInterval(() => {
    while (nextBar < ctx.currentTime + 0.6) { scheduleBar(nextBar, barNo++); nextBar += BEAT * 4; }
  }, 200);
}
export function stopMusic() {
  if (!musicOn) return;
  musicOn = false;
  clearInterval(musicTimer);
  const g = musicGain;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
  setTimeout(() => g.disconnect(), 900);
}
export function audioReady() { return !!ctx; }
