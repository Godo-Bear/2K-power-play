// Procedural Web Audio sound effects: no external sound files needed.
let ctx = null;
let master = null;
let crowdGain = null;
let muted = false;

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

function noiseBurst(dur, freq, type = 'bandpass', gain = 0.5, q = 1) {
  if (!ctx) return;
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
  if (!ctx) return;
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
  menu() { tone(660, 0.06, 'sine', 0.1); },
  select() { tone(520, 0.08, 'triangle', 0.12); tone(780, 0.12, 'triangle', 0.1, null, 0.05); },
  cheer(intensity = 1) {
    if (!crowdGain) return;
    const t = ctx.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.linearRampToValueAtTime(0.12 + 0.45 * intensity, t + 0.25);
    crowdGain.gain.linearRampToValueAtTime(0.12, t + 2.8);
  },
  groan() {
    if (!crowdGain) return;
    const t = ctx.currentTime;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.linearRampToValueAtTime(0.25, t + 0.2);
    crowdGain.gain.linearRampToValueAtTime(0.12, t + 1.4);
  },
};
