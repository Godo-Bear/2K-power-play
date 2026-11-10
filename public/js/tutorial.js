// Interactive tutorial: a guided practice game that checks each skill as you do it.
import * as THREE from 'three';
import { C } from './arena.js';
import { input, label } from './input.js';

const k = (a) => `<kbd>${label(a)}</kbd>`;

// side: which team has the ball during the step ('user' offense / 'cpu' defense)
const STEPS = [
  { id: 'move', side: 'user', title: 'Move', text: () => `Move your player with ${k('up')} ${k('left')} ${k('down')} ${k('right')} or the left stick.` },
  { id: 'sprint', side: 'user', title: 'Sprint', text: () => `Hold ${k('sprint')} while moving to sprint. Sprinting uses stamina (the bar in the bottom-left).` },
  { id: 'jumper', side: 'user', title: 'Jump shot', text: () => `Stand away from the rim, <b>hold</b> ${k('shoot')} and <b>release</b> when the meter reaches the green zone.` },
  { id: 'green', side: 'user', title: 'Perfect release', text: () => `Now try to land an <b style="color:#3dff7a">EXCELLENT</b> release: let go of ${k('shoot')} exactly in the green. Open green shots always go in.`, skippable: true },
  { id: 'layup', side: 'user', title: 'Layup or dunk', text: () => `Drive toward the rim (hold ${k('sprint')}) and press ${k('shoot')} when you're close. Fast, athletic players will dunk.` },
  { id: 'pass', side: 'user', title: 'Passing', text: () => `Press ${k('pass')} to pass. Point the move direction at a teammate to choose who gets it.` },
  { id: 'cross', side: 'user', title: 'Crossover', text: () => `Press ${k('move')} with the ball for a crossover burst. Do it next to a defender to break their ankles.` },
  { id: 'switchO', side: 'user', title: 'Switch player', text: () => `Press ${k('switch')} to take control of a different teammate. On offense you can then call for the ball with ${k('pass')}.` },
  { id: 'steal', side: 'cpu', title: 'Defense: steal', text: () => `Now you're on defense. Get close to the ball handler and press ${k('pass')} to swipe for a steal. Careful: reaching too much can be a foul.` },
  { id: 'block', side: 'cpu', title: 'Defense: block & contest', text: () => `Press ${k('shoot')} to jump. Time it when a shooter goes up to contest or block the shot. It also grabs rebounds.` },
  { id: 'switchD', side: 'cpu', title: 'Defense: switch', text: () => `Press ${k('move')} (or ${k('switch')}) on defense to switch to the player closest to the ball.` },
  { id: 'ft', side: 'user', title: 'Free throws', text: () => `You got fouled! At the line, <b>hold</b> ${k('shoot')} and release in the green, just like a jump shot. Make your two free throws.` },
  { id: 'timeout', side: 'user', title: 'Timeouts', text: () => `With the ball in your hands, press ${k('timeout')} to call a timeout. It stops the clock and refills everyone's stamina. You get 5 per game.` },
];

export class Tutorial {
  constructor(game, ui, onDone) {
    this.game = game;
    this.ui = ui;
    this.onDone = onDone;
    this.i = 0;
    this.progress = 0;
    this.lastPos = null;
    this.waitT = 0;
    this.doneT = 0;
    game.on((type, data) => this.onEvent(type, data));
    this.begin();
  }

  get step() { return STEPS[this.i]; }

  begin() {
    const s = this.step;
    const g = this.game;
    this.progress = 0;
    this.lastPos = null;
    this.doneT = 0;
    g.tutorialPossession = s.side;
    const user = g.user.players[0], cpu = g.cpu.players[0];
    if (s.side === 'user') {
      const spot = new THREE.Vector3(g.user.dir * (C.HOOP_X - 7.5), 0, 0);
      if (!(g.ball.holder && g.ball.holder.team === g.user)) g.forcePossession(user, spot);
      else if (s.id === 'ft' || s.id === 'timeout') g.forcePossession(g.ball.holder);
    } else {
      // Put the CPU ball handler at the top of the key, user's defender near him
      const spot = new THREE.Vector3(g.cpu.dir * (C.HOOP_X - 7.5), 0, 0);
      g.forcePossession(cpu, spot);
      const def = g.user.players[0];
      def.pos.set(spot.x + g.cpu.dir * 2.2, 0, 0.6);
      g.setUserPlayer(def);
    }
    if (s.id === 'ft') g.startFreeThrows(g.ball.holder || user, 2);
    this.render();
  }

  complete() {
    if (this.doneT > 0) return;
    this.doneT = 1.1;
    this.ui.check();
  }

  next() {
    this.i++;
    if (this.i >= STEPS.length) { this.ui.finish(); this.onDone && this.onDone(); return; }
    this.begin();
  }

  skip() { this.next(); }

  render() {
    const s = this.step;
    this.ui.show({ n: this.i + 1, total: STEPS.length, title: s.title, html: s.text(), skippable: true, progress: this.progress });
  }

  onEvent(type, d) {
    const s = this.step;
    if (!s || this.doneT > 0) return;
    const g = this.game;
    const mine = d && d.player && d.player.team === g.user;
    switch (s.id) {
      case 'jumper': if (type === 'shot' && d.user && d.kind === 'shoot') this.complete(); break;
      case 'green': if (type === 'shot' && d.user && d.label === 'EXCELLENT') this.complete(); break;
      case 'layup': if (type === 'shot' && mine && (d.kind === 'layup' || d.kind === 'dunk')) this.complete(); break;
      case 'pass': if (type === 'pass' && mine) this.complete(); break;
      case 'cross': if (type === 'move' && d.user) this.complete(); break;
      case 'switchO': if (type === 'switch') this.complete(); break;
      case 'steal': if (type === 'stealAttempt' && d.user) this.complete(); break;
      case 'block': if (type === 'defJump') this.complete(); break;
      case 'switchD': if (type === 'switch') this.complete(); break;
      case 'ft': if (type === 'ftDone') this.complete(); break;
      case 'timeout': if (type === 'timeout' && d.team === g.user) this.complete(); break;
      default: break;
    }
  }

  update(dt) {
    const g = this.game;
    const s = this.step;
    if (!s) return;
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) {
        if (g.state === 'timeout') g.endTimeout();
        this.next();
      }
      return;
    }
    // Movement-based steps
    const p = g.userPlayer;
    if (s.id === 'move' || s.id === 'sprint') {
      if (this.lastPos) {
        const d = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
        if (s.id === 'move') this.progress += d / 8;
        else if (input.sprint && Math.hypot(p.vel.x, p.vel.z) > p.maxSpeed * 1.05) this.progress += dt / 1.5;
        this.ui.progress(Math.min(1, this.progress));
        if (this.progress >= 1) this.complete();
      }
      this.lastPos = p.pos.clone();
    }
    // Keep the right team on the ball between attempts
    if (s.id === 'ft' || g.state === 'ft' || g.state === 'timeout') return;
    const b = g.ball;
    const busy = b.state === 'shot' || b.state === 'pass';
    const wantUser = s.side === 'user';
    const ok = b.state === 'held' && b.holder && (b.holder.team === g.user) === wantUser;
    if (!ok && !busy && g.state !== 'dead') {
      this.waitT += dt;
      if (this.waitT > (b.state === 'loose' ? 2.2 : 0.8)) {
        this.waitT = 0;
        const team = wantUser ? g.user : g.cpu;
        const spot = new THREE.Vector3(team.dir * (C.HOOP_X - 7.5), 0, 0);
        g.forcePossession(team.players[0], spot);
        if (!wantUser) g.setUserPlayer(g.user.players[0]);
      }
    } else this.waitT = 0;
  }
}
