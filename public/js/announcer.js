// Commentary: a play-by-play voice and a color analyst, on-screen captions plus optional spoken commentary
// (browser speech synthesis). Nobody is called by name: players are "the point guard", "the big man", "he".
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let voiceOn = true;
let captionEl = null;
let hideTimer = 0;
let lastEnd = 0;           // when the last line finished (performance.now ms)
let busyUntil = 0;
let queue = [];

export function setVoice(on) { voiceOn = on; if (!on && window.speechSynthesis) speechSynthesis.cancel(); }
export function initAnnouncer(el) { captionEl = el; }
export function stopAnnouncer() {
  queue = [];
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (captionEl) captionEl.classList.remove('show');
}

// Two different voices if the device has them: a lively play-by-play man and a lower, slower analyst
function voices() {
  const vs = window.speechSynthesis ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
  const us = vs.filter((v) => /en-US|en-GB/i.test(v.lang));
  const a = us.find((v) => /david|guy|google us|daniel|alex|mark|male/i.test(v.name)) || us[0] || vs[0] || null;
  const b = us.find((v) => v !== a && /mark|james|george|fred|google uk english male|male|ryan/i.test(v.name)) || us.find((v) => v !== a) || a;
  return [a, b];
}

function speakNow(item) {
  if (captionEl) {
    captionEl.textContent = item.text;
    captionEl.dataset.who = item.who;
    captionEl.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => captionEl.classList.remove('show'), 2600 + item.text.length * 38);
  }
  const est = 700 + item.text.length * 62;      // rough speaking time, used even when voice is off so the lines don't pile up
  busyUntil = performance.now() + est;
  if (!voiceOn || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(item.text.replace(/[!]+/g, '!'));
    const [a, b] = voices();
    const v = item.who === 1 ? b : a;
    if (v) u.voice = v;
    u.rate = item.who === 1 ? 1.04 : 1.18;
    u.pitch = item.who === 1 ? 0.82 : 1.05;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch { /* speech not available */ }
}

// who: 0 = play-by-play, 1 = analyst. priority: 0 chatter, 1 normal, 2 big moment (interrupts)
export function say(text, { who = 0, priority = 1 } = {}) {
  const now = performance.now();
  if (priority >= 2) {
    queue = [];
    if (window.speechSynthesis) speechSynthesis.cancel();
    speakNow({ text, who });
    return;
  }
  if (now < busyUntil) {
    if (priority === 0) return;                // chatter never waits
    queue = queue.filter((q) => q.priority >= 1).slice(-1);
    queue.push({ text, who, priority });
    return;
  }
  speakNow({ text, who });
}
// Called often: plays the next waiting line when the current one is done
export function tickAnnouncer() {
  if (queue.length && performance.now() >= busyUntil) speakNow(queue.shift());
}

const POS = { PG: 'point guard', SG: 'shooting guard', SF: 'wing', PF: 'power forward', C: 'big man' };
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

const L = {
  // the moment he lets it go
  rise3: ['Rises up from deep...', 'Lets it fly from three...', 'Behind the arc, he fires...', 'Three-point attempt...', 'Spots up... and shoots!'],
  riseMid: ['Pulls up from the elbow...', 'Rises for the jumper...', 'Steps into the mid-range...', 'Fadeaway... here it goes!'],
  riseLay: ['Attacks the rim...', 'Gets to the basket...', 'Drives hard...', 'Takes it all the way...'],
  riseDunk: ['Up he goes...', 'Takes flight!', 'Going up with it...'],
  // makes
  three: ['Bang! From downtown!', 'Splash! Three ball!', 'Nothing but net from deep!', 'That is a bucket from way out!', 'Cold-blooded from three!'],
  dunk: ['Throws it down!', 'Oh, what a slam!', 'Rim rocker!', 'Posterized! Are you kidding me!', 'With authority!'],
  layup: ['Lays it in.', 'Finishes at the rim.', 'Easy two.', 'Soft touch off the glass.'],
  mid: ['Pulls up, got it.', 'Smooth jumper, count it.', 'Nothing but net.', 'The mid-range falls.'],
  assist: ['Great pass, and he finishes!', 'Beautiful ball movement, count it!', 'The feed is perfect, easy bucket.'],
  buzzer: ['At the buzzer... it is good! Unbelievable!', 'Beats the buzzer! Are you kidding me!', 'Game-changing shot at the horn!'],
  // misses and rebounds
  miss: ['Off the rim.', 'No good.', 'Rattles out.', 'Just short.', "Won't go."],
  airball: ['Air ball!', 'That one missed everything.'],
  rebD: ['Defensive rebound, and they are going the other way.', 'Cleans the glass.', 'Rebound secured.'],
  rebO: ['Offensive rebound! Second chance!', 'Gets his own miss, another shot coming!', 'Crashes the boards and keeps it alive.'],
  // defense
  block: ['Rejected!', 'Get that out of here!', 'Not in this house!', 'Swatted away!', 'Denied at the rim!'],
  steal: ['Picked his pocket!', 'Steals it, and the other way!', 'Stripped clean!', 'Takes it away!'],
  intercept: ['Jumps the lane, intercepted!', 'Picked off! Bad pass.', 'He read that all the way, intercepted!'],
  stealTry: ['Swipes at the ball...', 'Reaches in...', 'Goes for the strip...'],
  // whistles
  foul: ['Whistle on the play.', 'Foul called.', "That's a foul."],
  foulOut: ["That's his sixth. He is done for the night."],
  ftMake: ['Good at the line.', 'Knocks it down.', 'Free throw is good.'],
  ftMiss: ['Rims out.', 'Misses the free throw.'],
  ftUp: ['Steps to the line.', 'Free throws coming up.', 'Two shots at the stripe.'],
  // violations
  v8: ['Eight seconds! He took too long to bring it up.', 'Eight-second violation. Cannot get it across half court.'],
  vBack: ['Over and back! Backcourt violation.', "Can't go back across half court. Turnover."],
  v3: ['Three seconds in the lane. Turnover.', 'Lane violation. He camped in the paint too long.'],
  vShot: ['Shot clock violation. The clock ran out on them.', 'Nothing doing, the shot clock expires.'],
  vOut: ['Out of bounds. Their ball.', 'Steps out. Turnover.'],
  vGoal: ['Goaltending! The basket counts.', 'He touched it on the way down. That is goaltending.'],
  vInt: ['Intentional foul, they are trying to stop the clock.', 'Sending him to the line on purpose.'],
  // flow
  onFire: ['He is on fire! Somebody call the fire department!', "Can't miss right now, he is locked in!", 'Heating up, and the crowd knows it!'],
  heatingUp: ['He is starting to get hot.', 'Finding his rhythm.'],
  fireOut: ['And the flames go out.', 'That cools him off.'],
  timeout: ['Timeout on the floor.', 'They need a break, timeout called.', 'The coach has seen enough, timeout.'],
  sub: ['A fresh set of legs checks in.', 'Substitution at the scorer’s table.'],
  clock: ['The shot clock is winding down...', 'Shot clock running low, they need something.', 'Five seconds left to get a shot up.'],
  fast: ['Out in transition!', 'Here they come on the break!', 'Running the floor, looking for the easy one.'],
  tie: ['Tied up! All square.', 'We are all tied up now.'],
  lead: ['They take the lead!', 'That gives them the lead!', 'Back in front!'],
  clutch: ['Crunch time, every possession matters.', 'Tight game, and the crowd is on its feet.', 'This is why you watch the fourth quarter.'],
  run: ['They are on a {r}-0 run!', "That's {r} straight points. Momentum is all theirs.", 'The run is up to {r}, and the other bench is worried.'],
  blowout: ['This one is getting out of hand.', 'The bench is up and ready, they know how this one ends.'],
  comeback: ['They are clawing back into this game!', 'The lead is shrinking fast!'],
  half: ["That's the half.", "We've reached halftime."],
  quarter: ['End of the quarter.', 'That will do it for the quarter.'],
  ot: ["We're tied! This one is going to overtime!"],
  win: ['Ball game! That will do it.', "And that's the final. What a game."],
  tipoff: ['The ball is up!', 'And we are underway!', 'Tip-off!'],
  intro: ['Welcome to {arena}! Tonight, the {a} take on the {h}.', "It's game night! {a} versus {h}. Let's get it started."],
};

// Color analyst remarks, driven by what the game has actually shown
function analystLine(g) {
  const t = [g.home, g.away];
  const sum = (tm, k) => [...tm.players, ...tm.bench].reduce((a, p) => a + p.stats[k], 0);
  const lines = [];
  for (const tm of t) {
    const fga = sum(tm, 'fga'), fgm = sum(tm, 'pts') > 0 ? [...tm.players, ...tm.bench].reduce((a, p) => a + p.stats.fgm, 0) : 0;
    if (fga >= 8 && fgm / fga < 0.34) lines.push(`${tm.data.name} are struggling to find the bottom of the net.`);
    if (fga >= 8 && fgm / fga > 0.58) lines.push(`${tm.data.name} are shooting the lights out.`);
    if (sum(tm, 'to') >= 6) lines.push(`${tm.data.name} are giving it away too much. Take care of the ball.`);
    if (sum(tm, 'tpm') >= 4) lines.push(`${tm.data.name} are feasting from three.`);
    if (sum(tm, 'blk') >= 3) lines.push(`${tm.data.name} are protecting the rim like a fortress.`);
    if (tm.fouls >= 5) lines.push(`${tm.data.name} are in the bonus now, so every foul is two free throws.`);
  }
  const reb = sum(g.home, 'reb') - sum(g.away, 'reb');
  if (Math.abs(reb) >= 6) lines.push(`${(reb > 0 ? g.home : g.away).data.name} are dominating the glass.`);
  const tc = g.possession && g.possession.tac;
  if (tc && tc.pace > 0.7) lines.push('They want to run on every possession, you can see it.');
  if (tc && tc.passing > 0.7) lines.push('The ball is moving beautifully, nobody is stuck holding it.');
  if (tc && tc.pressure > 0.75) lines.push('That pressure on the ball is making them uncomfortable.');
  lines.push('Look at that spacing. The floor is wide open when they share the ball.', 'Defense wins in this league. You can feel the intensity picking up.', 'The crowd is getting into this one.');
  return pick(lines);
}

export function attachAnnouncer(game) {
  const pos = (p) => POS[p && p.data && p.data.pos] || 'player';
  const who = (p) => pick([`the ${pos(p)}`, 'he']);
  let lastRun = 0, lastQuiet = performance.now(), lastLeadTeam = null, clockWarned = false, shotAt = 0;
  const speak = (text, o) => { lastQuiet = performance.now(); say(text, o); };
  const margin = () => Math.abs(game.home.score - game.away.score);
  const clutch = () => game.period >= 4 && game.gameClock < 120 && margin() <= 6;

  game.on((type, d) => {
    switch (type) {
      case 'tipoff': speak(pick(L.tipoff), { priority: 2 }); break;
      case 'shot': {
        if (d.user && Math.random() < 0.35) break;               // don't talk over the player's own shot meter
        shotAt = performance.now();
        const k = d.kind === 'dunk' ? L.riseDunk : d.kind === 'layup' ? L.riseLay : (d.label && /3/.test(String(d.label))) ? L.rise3 : null;
        const isThree = d.player && game.isThree && game.isThree(d.player.team, d.player.pos.x, d.player.pos.z);
        const lines = k || (isThree ? L.rise3 : L.riseMid);
        if (Math.random() < 0.5) say(pick(lines), { who: 0, priority: 0 });
        break;
      }
      case 'score': {
        const leadBefore = lastLeadTeam;
        const lead = game.home.score === game.away.score ? null : (game.home.score > game.away.score ? game.home : game.away);
        if (d.buzzer) { speak(pick(L.buzzer), { who: 0, priority: 2 }); lastLeadTeam = lead; break; }
        const kind = d.kind === 'dunk' ? 'dunk' : d.pts === 3 ? 'three' : d.kind === 'layup' ? 'layup' : 'mid';
        if (d.assist && Math.random() < 0.4 && kind !== 'three') speak(pick(L.assist), { who: 0, priority: 1 });
        else speak(pick(L[kind]), { who: 0, priority: kind === 'dunk' || kind === 'three' ? 2 : 1 });
        // the analyst follows up on what it means for the game
        setTimeout(() => {
          if (!game || game.state === 'over') return;
          if (!lead) speak(pick(L.tie), { who: 1, priority: 1 });
          else if (lead !== leadBefore && leadBefore !== null && Math.random() < 0.8) speak(pick(L.lead), { who: 1, priority: 1 });
          else if (game.run && game.run.pts >= 8 && game.run.pts !== lastRun) { lastRun = game.run.pts; speak(fill(pick(L.run), { r: game.run.pts }), { who: 1, priority: 1 }); }
          else if (clutch() && Math.random() < 0.5) speak(pick(L.clutch), { who: 1, priority: 1 });
          else if (Math.random() < 0.22) speak(analystLine(game), { who: 1, priority: 0 });
          lastLeadTeam = lead;
        }, 2300);
        break;
      }
      case 'miss': if (d.airball) say(pick(L.airball), { priority: 1 }); else if (Math.random() < 0.3) say(pick(L.miss), { priority: 0 }); break;
      case 'rebound': say(pick(d.off ? L.rebO : L.rebD), { who: 0, priority: d.off ? 1 : 0 }); break;
      case 'block': speak(pick(L.block), { who: 0, priority: 2 }); break;
      case 'steal': speak(pick(L.steal), { who: 0, priority: 1 }); break;
      case 'intercept': speak(pick(L.intercept), { who: 0, priority: 1 }); break;
      case 'stealAttempt': if (Math.random() < 0.2) say(pick(L.stealTry), { who: 0, priority: 0 }); break;
      case 'foul': if (d.label === 'INTENTIONAL FOUL') speak(pick(L.vInt), { who: 1, priority: 1 }); else speak(pick(L.foul), { who: 0, priority: 1 }); break;
      case 'foulOut': speak(pick(L.foulOut), { who: 1, priority: 2 }); break;
      case 'ft': say(pick(d.made ? L.ftMake : L.ftMiss), { priority: 0 }); break;
      case 'turnover': {
        const r = d.reason || '';
        const map = [['8-SECOND', L.v8], ['BACKCOURT', L.vBack], ['3-SECOND', L.v3], ['SHOT CLOCK', L.vShot], ['OUT OF BOUNDS', L.vOut]];
        const m = map.find(([k]) => r.includes(k));
        if (m) speak(pick(m[1]), { who: 1, priority: 1 });
        break;
      }
      case 'goaltend': speak(pick(L.vGoal), { who: 1, priority: 2 }); break;
      case 'onFire': speak(pick(L.onFire), { who: 0, priority: 2 }); break;
      case 'heatingUp': speak(pick(L.heatingUp), { who: 1, priority: 1 }); break;
      case 'fireOut': say(pick(L.fireOut), { who: 1, priority: 0 }); break;
      case 'timeout': speak(pick(L.timeout), { who: 1, priority: 1 }); break;
      case 'sub': if (Math.random() < 0.25) say(pick(L.sub), { who: 1, priority: 0 }); break;
      case 'periodEnd':
        if (d.period === 2) speak(pick(L.half), { who: 0, priority: 2 });
        else if (d.period >= 4) speak(pick(L.ot), { who: 0, priority: 2 });
        else speak(pick(L.quarter), { who: 0, priority: 1 });
        clockWarned = false;
        break;
      case 'gameOver': speak(pick(L.win), { who: 0, priority: 2 }); break;
      default: break;
    }
  });

  // Between the big moments: shot clock warnings, fast breaks, and the analyst filling the quiet
  const t = setInterval(() => {
    if (!game || window.__announcerGame !== game) { clearInterval(t); return; }
    tickAnnouncer();
    if (game.state !== 'live') { clockWarned = false; return; }
    const now = performance.now();
    if (game.shotClock < 5 && game.shotClock > 1 && !clockWarned && !game.shotClockFrozen) { clockWarned = true; say(pick(L.clock), { who: 1, priority: 1 }); }
    if (game.shotClock > 20) clockWarned = false;
    if (now - lastQuiet > 14000) { lastQuiet = now; say(clutch() ? pick(L.clutch) : margin() >= 20 && game.period >= 3 ? pick(L.blowout) : analystLine(game), { who: 1, priority: 0 }); }
  }, 400);
  window.__announcerGame = game;
}

export function sayIntro(game) {
  say(fill(pick(L.intro), { arena: `${game.home.data.city} Arena`, a: game.away.data.name, h: game.home.data.name }), { who: 0, priority: 2 });
}
