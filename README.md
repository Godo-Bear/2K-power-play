# 2K Power Play 🏀

A modern 3D basketball game that runs in the browser. It's an original game with a fictional league of 8 teams,
built with Three.js and deployed on Cloudflare Workers.

## Features

- **Full 5-on-5** with quarters, overtime, a 24-second shot clock (it resets to 14 on offensive rebounds), and out-of-bounds and shot-clock violations
- **Timed shot meter**: hold shoot and release in the green for an "Excellent" release
- Layups, dunks, passing aimed with the stick, crossovers that can break ankles, steals, interceptions, blocks, contests and rebounds
- **CPU AI** on both ends: spacing, cuts, drives, kick-outs, man-to-man, help defense and contests
- **4 difficulty levels**: Rookie, Pro, All-Star and Hall of Fame
- **Modern graphics**: PBR materials, a glossy hardwood floor, soft shadows, bloom, ACES tone mapping, an animated crowd, LED ribbon boards and a jumbotron
- Broadcast, court-level and high cameras
- Keyboard, **gamepad** (Xbox/PlayStation) and **touch** controls
- Box score at the end of the game
- **Custom 3D models and textures**: see [`public/assets/README.md`](public/assets/README.md)

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | WASD / Arrows | Left stick |
| Sprint | Shift | RT / R2 |
| Shoot / Layup / Dunk (hold, then release) | Space | X / □ |
| Pass, or Steal on defense | J | A / ✕ |
| Crossover, or Switch player on defense | K | B / ○ |
| Block / Rebound (defense) | Space | X / □ |
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
  js/input.js, audio.js     controls and synthesized sound
  assets/                   your uploaded models and textures
  vendor/three/             Three.js (MIT)
```
