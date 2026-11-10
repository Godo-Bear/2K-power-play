# 2K Power Play 🏀

A modern 3D basketball game that runs in the browser. It's an original game with a fictional league of 8 teams,
built with Three.js and deployed on Cloudflare Workers.

## Features

- **Full 5-on-5** with quarters, overtime, a 24-second shot clock (it resets to 14 on offensive rebounds), and out-of-bounds and shot-clock violations
- **Fouls**: shooting fouls (2 or 3 free throws, plus and-ones), reach-ins, blocking fouls and charges. Team fouls put the other team in the bonus after 5 in a quarter, and fouls show in the box score.
- **Free throws** with the same timed shot meter. A missed last free throw is a live rebound.
- **Timeouts**: 5 per team. They stop the clock, restore stamina and show team stats. The CPU calls one when you go on a run.
- **Timed shot meter**: hold shoot and release in the green for an "Excellent" release. The meter disappears as soon as you shoot.
- Layups, dunks, passing aimed with the stick, crossovers that can break ankles, steals, interceptions, blocks, contests and rebounds
- **Interactive tutorial** that teaches every control, step by step
- **Choose your team** and **switch players** at any time, or use **Player Lock** to play the whole game as one player
- **Remappable controls** for keyboard and controller (Controls menu)
- **CPU AI** on both ends, with 4 difficulty levels
- **Graphics**: PBR materials, shadows, a subtle glow effect, an animated crowd, LED boards and a jumbotron. There's a brightness slider in Settings.
- Keyboard, **gamepad** (Xbox/PlayStation) and **touch** controls
- **Custom 3D models and textures**: see [`public/assets/README.md`](public/assets/README.md)

## Controls (defaults, all remappable in the Controls menu)

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | WASD / Arrows | Left stick |
| Sprint | Shift | RT / R2 |
| Shoot / Layup / Dunk / Free throw (hold, then release) | Space | X / □ |
| Pass, or Steal on defense | J | A / ✕ |
| Crossover, or quick switch on defense | K | B / ○ |
| Switch player | Q | LB / L1 |
| Block / Rebound (defense) | Space | X / □ |
| Call timeout | T | Back / Share |
| Pause | Esc / P | Start |

## Run locally

It's plain static files with no build step:

```bash
npx serve public
```

Or with the Cloudflare runtime:

```bash
npx wrangler dev
```

## Deploying (Cloudflare Workers)

`wrangler.jsonc` serves the `public/` folder as static assets. With the Worker connected to this
GitHub repo (Workers Builds), every push to `main` redeploys. If your Worker in the Cloudflare
dashboard has a different name than `2k-power-play`, change `"name"` in `wrangler.jsonc` to match.

## Adding your own 3D models and textures

Upload `.glb` models to `public/assets/models/` and images to `public/assets/textures/` (GitHub → **Add file → Upload files**),
then list them in `public/assets/assets.json`. The **Check uploaded assets** GitHub Action validates
every upload. Full guide: [`public/assets/README.md`](public/assets/README.md).

## Project layout

```
public/
  index.html, style.css     UI, menus, HUD
  js/main.js                renderer, camera, menus, HUD
  js/game.js                rules, AI, ball physics, shooting, passing
  js/player.js              player model and animation
  js/arena.js               court, hoops, crowd, lights
  js/assets.js              custom model/texture loader
  js/tutorial.js            interactive tutorial
  js/input.js, audio.js     remappable controls and synthesized sound
  assets/                   your uploaded models and textures
  vendor/three/             Three.js (MIT)
```

## 3D model credits

- Man by Quaternius (CC0)
- Basket Ball by J-Toastie (CC-BY 3.0)
- Basketball court by Poly by Google (CC-BY 3.0)
- Low Poly Sports Stands by Cole Brenner (CC-BY 3.0)

All via [Poly Pizza](https://poly.pizza). Credits are also shown in the game's Settings screen.
