// The crowd as a character: it reacts to what happens, not just to the score.
import { sfx } from './audio.js';

export function attachCrowd(game, arena) {
  if (!arena || !arena.react) return;
  window.__crowdGame = game;
  const home = game.home;
  const margin = () => Math.abs(game.home.score - game.away.score);
  const clutch = () => game.period >= 4 && game.gameClock < 150 && margin() <= 6;
  let lastChant = 0, lastBoo = 0, lastWave = 0;
  const now = () => performance.now();
  const mine = (p) => !!p && p.team === home;

  game.on((type, d) => {
    if (window.__crowdGame !== game) return;
    switch (type) {
      case 'score': {
        const big = d.kind === 'dunk' || d.pts === 3 || d.buzzer;
        if (d.team === home) {
          if (big || clutch()) arena.react('stand');
          if (game.home.score - game.away.score >= 15 && game.period >= 3 && now() - lastWave > 45000) { lastWave = now(); arena.react('wave'); }
        } else if (big) sfx.groan();
        break;
      }
      case 'miss':
        if (mine(d.player)) { if (d.airball) sfx.groan(); else if (d.pts === 3 || Math.random() < 0.35) sfx.ooh(); }
        else if (d.player && !d.airball && Math.random() < 0.5) sfx.cheer(0.3);
        break;
      case 'block': if (mine(d.player)) { arena.react('stand'); sfx.cheer(0.8); } else sfx.groan(); break;
      case 'steal': case 'intercept': if (mine(d.player)) sfx.cheer(0.5); break;
      case 'fastBreak': if (d.team === home) { sfx.cheer(0.55); arena.excitement = Math.min(1, arena.excitement + 0.3); } break;
      case 'foul':
        if (d.def && d.def.team === home && now() - lastBoo > 4000) { lastBoo = now(); sfx.boo(); }
        else if (d.def) sfx.cheer(0.25);
        break;
      case 'ft':
        if (d.player && d.player.team !== home && now() - lastBoo > 2500) { lastBoo = now(); sfx.boo(); }
        else if (d.made && mine(d.player)) sfx.clap(2);
        break;
      case 'timeout': sfx.clap(5); if (now() - lastWave > 30000) { lastWave = now(); arena.react('wave'); } break;
      case 'periodEnd': sfx.clap(4); break;
      case 'gameOver': arena.react('stand'); if (d.winner === home) sfx.cheer(1); break;
      default: break;
    }
  });

  // Close game late and the visitors have the ball: the home crowd chants
  const t = setInterval(() => {
    if (window.__crowdGame !== game) { clearInterval(t); return; }
    if (game.state !== 'live' || game.possession === home) return;
    if (game.period >= 4 && game.gameClock < 240 && margin() <= 10 && now() - lastChant > 9000) { lastChant = now(); sfx.chant(); }
  }, 900);
}
