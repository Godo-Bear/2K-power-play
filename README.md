# 2K Power Play 🏀

A modern 3D basketball game that runs in the browser. It's an original game with a fictional league of 16 teams,
built with Three.js and deployed on Cloudflare Workers.

## Features

**Game modes**
- **Play Now**: pick any two teams and which one you control
- **My Career**: up to 3 saved players. Create a player (name, position, look with 10 hair styles, a starter play style), join a team, and earn Rep Points from your game grades to upgrade your ratings. Like FC PlayStyles, the others unlock as your OVR climbs, and you can equip up to 2 extras. Each style changes how you play (shooting, speed, steals, blocks, rebounds, passing), not just your ratings. Your player card goes from Bronze to Legend as you improve.
- **Season**: a 16-team league where you play every other team once (15 games), with standings, team stats, then 4-team playoffs for the title. Play or simulate each game. Progress is saved in your browser.
- **Online**: play a friend. One player creates a room and shares the 5-letter code, the other joins with it. If your friend leaves, the CPU takes over their team.
- **Contests**: a 3-point contest (5 racks, a money ball on each) and a dunk contest (3 rounds, judges score your style against three rivals)
- **Practice**: no clock and no fouls. Choose how many players are on your team (1-5) and how many opponents (0-5), easy or real defense, with a shot tracker.
- **Tutorial**: 13 interactive steps covering every control

**On the court**
- Opening **jump ball**, then full 5-on-5 with quarters, overtime, a 24-second shot clock (14 on offensive rebounds), fouls, free throws, the bonus, and timeouts
- **Substitutions**: 10-player rosters with benches, player fatigue, foul-outs, an auto-sub coach you can turn off, and a manual substitutions screen (from Pause or a timeout)
- **Team tactics**: edit how a team plays, like FC's Edit Tactic screen. Pick a preset (Pace & Space, Inside-Out, Fast Break, Iso Star, Half-Court Grind, Full Pressure) or drag sliders for pace, 3-point focus, rim attack, ball movement, offensive rebounding, defensive pressure and defensive line. Open it from the Matchup screen, the Pause menu, halftime, or a Season/Career hub. Teams also play to their OVR: an 88 is sharp and tough to rattle, an 80 makes more mistakes.
- **Halftime show**: three studio legends break down the first half with real replays of the half's best dunks, threes, blocks and steals played back on the court (low TV camera, slow motion), plus top performers
- **Customize kit & shoes**: change your team's colors, logo (20 emblems, 4 shapes), home kit style and sneaker colors, with a 3D front-and-back preview. Your players wear the logo, number and name on their jerseys.
- **Real rules**: 24-second shot clock, 8 seconds to cross half court, no going back over it (backcourt), 3 seconds in the lane, goaltending, free throws and the bonus, and the possession arrow (the team that loses the opening tip starts Q2 and Q3, with a sideline inbound). The CPU manages the clock, fouls on purpose when trailing late, and avoids throwing into defended lanes
- **More moves**: pump fake (tap Pass while winding up a shot), post-ups, defensive slides, pick-and-roll, hot and cold streaks, and CPU coaches who adjust to the score
- **Move Guide**: a screen (Pause menu, Controls, home footer) that lists every move and which button does it, using your own key bindings
- **Referees and benches**: two officials run with the play and signal fouls, violations and baskets; substitutes sit on their bench
- Timed shot meter, layups, dunks, aimed passes, steals, blocks and rebounds
- **Automatic moves**: the game picks the right move for the situation. Fadeaways, step-backs, pull-ups, floaters,
  euro-steps, reverse layups, one- and two-hand slams, windmills and tomahawks, spin moves, hesitations,
  behind-the-back dribbles, bounce passes and alley-oops, each with its own animation
- **On Fire**: hit three shots in a row and your player heats up, with a flaming ball and a shooting boost until they miss
- Player switching, Player Lock, and CPU AI with 4 difficulty levels

**Presentation**
- **Graphics**: Low, Medium, High (smooth edges and glow) and Ultra (renders at 4K and scales down), plus adaptive resolution that holds the frame rate steady
- **Commentary**: a play-by-play voice and a color analyst with no player names, reacting to shots, runs, violations and the score (spoken or as captions)
- Home hub with a live CPU game playing behind the menus, and original menu music
- Pre-game intro with a camera fly-in and matchup banner
- Slow-motion highlight camera on dunks, blocks and buzzer beaters; a behind-the-shooter free-throw camera
- Ball trails, crowd camera flashes, sparks, confetti for the winners, light beams, and a Player of the Game card
- Brightness slider, 3 cameras, 3 graphics levels

**Accounts and accessibility**
- Cloud save: careers, seasons, kits, tactics and settings follow your account to any device
- **Admin panel**: the basketball next to the logo on the home screen opens a code page, then a panel where admins can see every account (who is online and what they are doing), look at careers, gift career-mode Rep Points, rating boosts and unlocks, send messages and announcements, reset passwords, suspend or delete accounts, pause sign-ups and read an activity log
- Color-blind friendly colors, larger text, and one-handed or left-handed touch layouts

**Controls**
- Keyboard, mouse buttons, **gamepad** and **touch** (touch controls appear when you touch the screen)
- Every action can be remapped, including to mouse buttons and the scroll wheel
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

`wrangler.jsonc` does two things:

- serves the `public/` folder (the game) as static assets
- runs `src/worker.js`, which hosts the **online rooms**: each room code is a Durable Object that relays
  WebSocket messages between the two players. This works on the Workers free plan.
- also in `src/worker.js`: **accounts**. The game opens on a login screen until you sign in. Each username is a
  Durable Object (`User`) holding a salted PBKDF2 password hash and your sign-in sessions (30 days, up to 8 devices).
  After 5 wrong passwords an account locks for 5 minutes. Online rooms require a valid login.

Accounts and rooms use Durable Objects, which need no setup: the migrations in `wrangler.jsonc` create them on deploy.

> Good to know: the login protects accounts and online rooms. The game files themselves are an ordinary public
> website, and saves (careers, seasons, settings) are stored in each browser, not on your account.

With the Worker connected to this GitHub repo (Workers Builds), every push to `main` redeploys.
If your Worker in the Cloudflare dashboard has a different name than `2k-power-play`, change `"name"`
in `wrangler.jsonc` to match.

Online play only works on the deployed site or under `npx wrangler dev`. A plain static server
(`npx serve public`) runs everything else.

### The Trophy Room

Open it from the footer of the home screen. 21 trophies (first win, blowouts, comebacks, triple-doubles, streaks...), three daily
challenges that change every day, and a login streak. Everything pays Rep Points; press **Pay into my careers** to add them to every
career you have. Progress is one save key (`pph-trophies`), so it follows your account.

### The admin panel

Click the basketball next to **2K POWER PLAY** on the home screen. It asks for the admin code, and the code is checked on the
server (`src/worker.js`), never in the browser. Capitals and extra spaces in the code don't matter. Only a salted hash of the
code is stored in the source, so the code itself is not written down anywhere in this repository.

- **Overview**: accounts, who is online now (and in which mode), new sign-ups, a switch to pause new sign-ups.
- **Players**: search every account, open one to see their saved careers (position, play style, OVR, Rep Points), season, devices and cloud save.
  From there you can give **Rep Points**, **rating boosts**, **all ratings to 99**, **all play styles unlocked** or **championships** to
  one career slot or all of them, send a message, reset their password, sign them out everywhere, suspend or unsuspend them, clear their cloud save or delete the account.
- **Gift everyone**: the same gifts, sent to every account at once.
- **Announcements**: a banner on every player's home screen and the login page until it expires.
- **Activity log**: the last 300 admin actions.

Gifts wait on the server and are applied the next time the player opens the game (career gifts wait until they have a career),
then a pop-up tells them what they got. Players check in about every minute and a half, which is how "online" is worked out.
Accounts appear in the list once they have signed in since the panel was added.

**Change the admin code.** The built-in code is stored as a salted hash in `src/worker.js`, but a short, well-known phrase can still be
guessed by anyone who reads that hash and tries common phrases offline. To use a stronger code, set a Worker secret named `ADMIN_CODE`
(Cloudflare dashboard: your Worker, Settings, Variables and Secrets, or `npx wrangler secret put ADMIN_CODE`). When it is set it replaces the
built-in code, and **Overview, Sign out all admins** ends every admin sign-in that used the old one. After 5 wrong tries the admin door locks for
10 minutes. Clicking the ball always asks for the code, an admin sign-in lasts 2 hours at most, and **Exit and lock** ends it straight away.
The panel needs the game's server, so it does not work on a plain static file server.

### How online play works

The host's browser runs the match. The guest's browser sends its controls about 30 times a second and
receives the game state back, which it smooths and draws. Nothing is stored on the server.

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
  js/season.js              season, playoffs and career progression
  js/auth.js                login screen logic (sign up, log in, log out)
  js/admin.js               admin panel (code page, players, gifts, announcements, activity log)
  js/gifts.js               applies admin gifts to careers, announcements
  js/net.js                 online play (room connection, state sync)
  js/hair.js                hair styles
  js/fx.js                  particles, crowd flashes, confetti
  js/announcer.js           play-by-play commentary
  js/tutorial.js            interactive tutorial
  js/input.js, audio.js     remappable controls and synthesized sound
  assets/                   your uploaded models and textures
  vendor/three/             Three.js (MIT)
src/worker.js               Cloudflare Worker: static site, accounts and the online room relay
```

## 3D model credits

- Man Player by RiverofCreative (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/man-player-4c7133dbb06e4136891d59231372d818)
- Basketball Court by Klieg3D (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/basketball-court-d2ea5bc76e094f1a9e6aa15891bd6885)
- Basketball (shape only) by FIELDFLY3R (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/basketball-80f10af6cb604d7cbbd141050d093b2b)
- AJ 12 Basketball Sneakers by Real Slim Shady (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/aj-12-basketball-sneakers-3bda4837b67e47cca67516b374bfa456)
- Low Poly Sports Stands by Cole Brenner (CC-BY 3.0), via [Poly Pizza](https://poly.pizza)

The uploaded models were optimized for the web (smaller textures, unused animations and the court's fence removed; the sneakers went from 176k to about 6k triangles per shoe and were split into a left and a right).
Credits are also shown in the game's Settings screen.
