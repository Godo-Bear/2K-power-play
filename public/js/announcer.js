// Play-by-play announcer: on-screen captions plus optional spoken commentary (browser speech synthesis).
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let voiceOn = true;
let captionEl = null;
let hideTimer = 0;
let lastSpoke = 0;

export function setVoice(on) { voiceOn = on; if (!on && window.speechSynthesis) speechSynthesis.cancel(); }
export function initAnnouncer(el) { captionEl = el; }
export function stopAnnouncer() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (captionEl) captionEl.classList.remove('show');
}

function voice() {
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => /en-US/i.test(v.lang) && /male|guy|david|daniel|google us/i.test(v.name)) || vs.find((v) => /^en/i.test(v.lang)) || null;
}

export function say(text, { priority = false } = {}) {
  if (captionEl) {
    captionEl.textContent = text;
    captionEl.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => captionEl.classList.remove('show'), 3200);
  }
  if (!voiceOn || !window.speechSynthesis) return;
  const now = performance.now();
  if (speechSynthesis.speaking && !priority && now - lastSpoke < 2500) return; // don't talk over ourselves
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[!]+/g, '!'));
    const v = voice();
    if (v) u.voice = v;
    u.rate = 1.2; u.pitch = 1.05; u.volume = 0.9;
    speechSynthesis.speak(u);
    lastSpoke = now;
  } catch { /* speech not available */ }
}

const L = {
  three: ['{n} from deep... got it!', 'Three ball! {n} knocks it down!', '{n} lets it fly... bang!', 'Downtown! {n} for three!', 'Splash! {n} from way out!'],
  dunk: ['{n} throws it down!', 'Oh my! What a slam by {n}!', '{n} with authority!', 'Rim rocker from {n}!'],
  layup: ['{n} lays it in.', '{n} finishes at the rim.', 'Easy two for {n}.'],
  mid: ['{n} pulls up... good!', 'Jumper by {n}, nothing but net.', '{n} with the smooth mid-range.'],
  assist: ['Great feed from {a}, and {n} finishes!', '{a} finds {n}... count it!'],
  block: ['Rejected by {n}!', '{n} says not today!', 'Get that out of here! {n} with the block!'],
  steal: ['{n} picks his pocket!', 'Stolen by {n}!', '{n} jumps the lane!'],
  miss: ['Off the rim.', 'No good.', "Won't go."],
  airball: ['Air ball!', 'That one missed everything.'],
  foul: ['Whistle on the play. Foul on {n}.', '{n} is called for the foul.'],
  foulOut: ["That's six fouls! {n} is done for the night."],
  onFire: ["{n} is on fire! Somebody call the fire department!", "{n} can't miss right now!"],
  heatingUp: ['{n} is heating up.'],
  timeout: ['Timeout on the floor.', 'Timeout, {t}.'],
  sub: ['{n} checks into the game.'],
  buzzer: ['At the buzzer... {n}! Unbelievable!', '{n} beats the buzzer! Are you kidding me!'],
  half: ["That's the half. {s}", "We've reached halftime. {s}"],
  quarter: ['End of the quarter. {s}'],
  ot: ["We're tied! This one is going to overtime!"],
  win: ['Ball game! The {w} win it, {s}.', "That'll do it! {w} take it, {s}."],
  intro: ['Welcome to {arena}! Tonight, the {a} take on the {h}.', "It's game night! {a} versus {h}. Let's get it started."],
  run: ['The {t} are on a {r} to nothing run!'],
};
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

export function attachAnnouncer(game) {
  const score = () => `${game.away.data.name} ${game.away.score}, ${game.home.data.name} ${game.home.score}`;
  let lastRun = 0;
  game.on((type, d) => {
    const n = d.player ? d.player.data.last : '';
    switch (type) {
      case 'score': {
        if (d.buzzer) { say(fill(pick(L.buzzer), { n }), { priority: true }); break; }
        const kind = d.kind === 'dunk' ? 'dunk' : d.pts === 3 ? 'three' : d.kind === 'layup' ? 'layup' : 'mid';
        if (d.assist && Math.random() < 0.4 && kind !== 'three') say(fill(pick(L.assist), { n, a: d.assist.data.last }));
        else say(fill(pick(L[kind]), { n }), { priority: kind === 'dunk' || kind === 'three' });
        if (game.run.pts >= 8 && game.run.pts !== lastRun && game.run.pts % 2 === 0) { lastRun = game.run.pts; setTimeout(() => say(fill(pick(L.run), { t: game.run.team.data.name, r: game.run.pts })), 2400); }
        break;
      }
      case 'block': say(fill(pick(L.block), { n }), { priority: true }); break;
      case 'steal': say(fill(pick(L.steal), { n })); break;
      case 'miss': if (d.airball) say(pick(L.airball)); else if (Math.random() < 0.3) say(pick(L.miss)); break;
      case 'foul': if (d.def) say(fill(pick(L.foul), { n: d.def.data.last })); break;
      case 'foulOut': say(fill(pick(L.foulOut), { n }), { priority: true }); break;
      case 'onFire': say(fill(pick(L.onFire), { n }), { priority: true }); break;
      case 'heatingUp': say(fill(pick(L.heatingUp), { n })); break;
      case 'timeout': say(fill(pick(L.timeout), { t: d.team.data.name })); break;
      case 'sub': if (Math.random() < 0.5) say(fill(pick(L.sub), { n: d.inn.data.last })); break;
      case 'periodEnd':
        if (d.period === 2) say(fill(pick(L.half), { s: score() }), { priority: true });
        else if (d.period >= 4) say(pick(L.ot), { priority: true });
        else say(fill(pick(L.quarter), { s: score() }));
        break;
      case 'gameOver': say(fill(pick(L.win), { w: d.winner.data.name, s: `${Math.max(game.home.score, game.away.score)} to ${Math.min(game.home.score, game.away.score)}` }), { priority: true }); break;
      default: break;
    }
  });
}

export function sayIntro(game) {
  say(fill(pick(L.intro), { arena: `${game.home.data.city} Arena`, a: game.away.data.name, h: game.home.data.name }), { priority: true });
}
