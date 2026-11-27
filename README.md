# 2K Power Play 🏀

A modern 3D basketball game that runs in the browser. It's an original game with a fictional league of 16 teams,
built with Three.js and deployed on Cloudflare Workers.

## Features

**Game modes**
- **Play Now**: change both teams right on the home screen with the arrows (or the dice for a random matchup), tap a crest to choose which team you control, then Tip off. Options opens the full matchup screen
- **Continue**: the Play Now card offers your last career, season or draft run; one tap goes straight into the next game
- **My Career**: up to 3 saved players. Create a player (name, position, skin tone, hair colour, 17 hair styles, facial hair, a starter play style), join a team, and earn Rep Points from your game grades to upgrade your ratings. Like FC PlayStyles, the others unlock as your OVR climbs, and you can equip up to 2 extras. Each style changes how you play (shooting, speed, steals, blocks, rebounds, passing), not just your ratings. Your player card goes from Bronze to Legend as you improve.
- **Season**: a 16-team league where you play every other team once (15 games), with standings, team stats, then 4-team playoffs for the title. Play or simulate each game. Progress is saved in your browser.
- **Season life**: playoffs are best-of-5 semifinals and a best-of-7 final (2-2-1-1-1 home court). Tiredness from a long game carries into the next one and players can pick up short injuries (1-3 games; your own player misses at most 2, and admins can clear them with the Heal gift). Team chemistry grows with games and wins together and makes passes cleaner. In the summer a few free agents offer to join: sign one and they start for you. In My Career, sponsors pay Rep Points every game and put their shoes on your player
- **Online**: play a friend. One player creates a room and shares the 5-letter code, the other joins with it. If your friend leaves, the CPU takes over their team.
- **Ranked**: on the Online screen, Find Ranked Match pairs you with another player. Ratings start at 1000 and move with each result (Elo, K = 32); the Ladder shows the top 50 and your rank
- **Watch a friend**: when a friend is in an online game, a Watch button appears next to their name in Friends. Watchers see the live game but cannot affect it, and leaving changes nothing for the players
- **Contests**: a 3-point contest (5 racks, a money ball on each) and a dunk contest (3 rounds, judges score your style against three rivals)
- **Street ball**: 3-on-3 and 21 (one on one) on the Contests screen. Ones and twos, no fouls, make it take it, first to 21 wins
- **Draft**: like FC's draft. Eight picks from five choices each (a player at every position plus three bench players, drawn from the whole league), then a run of up to four games against tougher and tougher teams. One loss ends it. Wins pay Rep Points into every career (60, 140, 260 or 450)
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
- **Hustle plays**: when a shot goes up, players near the rim box out, and a rebound with two players on it is a fight that position, the rebound rating and timing decide. Tap Pass near a loose ball on the floor to dive for it (the CPU dives too)
- **On-screen controls**: Settings (or Pause, Show controls on screen) puts a small key guide in the corner while you play, with your own bindings for the situation you are in
- **Move Guide**: a screen (Pause menu, Controls, home footer) that lists every move and which button does it, using your own key bindings. Its **Dunks & moves** tab is a live 3D court that plays out 26 moves (five dunks, four finishes, five shots, four dribble moves, three passes, steal, block, slide, post-up, pump fake) on the game's own poses, with slow-mo, replay and arrow-key browsing
- **TV lower-thirds**: name-and-stat cards slide in for named dunks, scoring milestones, double- and triple-doubles, hot streaks, foul trouble, big runs and each new quarter (Settings can turn them off)
- **Referees and benches**: two officials run with the play and signal fouls, violations and baskets; substitutes sit on their bench
- Timed shot meter, layups, dunks, aimed passes, steals, blocks and rebounds
- **Automatic moves**: the game picks the right move for the situation. Fadeaways, step-backs, pull-ups, floaters,
  euro-steps, reverse layups, one- and two-hand slams, windmills and tomahawks, spin moves, hesitations,
  behind-the-back dribbles, bounce passes and alley-oops, each with its own animation
- **On Fire**: hit three shots in a row and your player heats up, with a flaming ball and a shooting boost until they miss
- Player switching, Player Lock, and CPU AI with 4 difficulty levels

**Presentation**
- **Graphics**: Low, Medium, High (smooth edges and glow) and Ultra (4K). Ultra is the default on computers: the screen is always 4K (the HUD and menus stay sharp) while the 3D picture renders at whatever resolution holds the frame rate, down to about half of 4K, and is sharpened back up to 4K, the way console games do it
- **Motion-captured run, jump, jump shot and dribble**: running uses a captured run cycle, sped up to match how fast the player is really moving; blocks, rebounds and jump balls use a captured jump (arms reaching at the top, feet kept down); the arms and upper body play real captured motion (a right- and a left-handed dribble kept in time with the ball's bounce, and a jump shot timed to the shot meter, with the ball held in the hands), layered over the procedural legs and moves
- **Ball handler marker**: a small orange arrow over whoever has the ball (Settings to switch it off)
- **Performance auto-tuner**: when the frame rate drops, the resolution goes down first, then bloom, then shadows, and they come back when the game is smooth again. **Install app**: on browsers that support it the home screen offers to install the game, and an app-shell cache makes it open instantly
- **Commentary**: a play-by-play voice and a color analyst with no player names, reacting to shots, runs, violations and the score (spoken or as captions)
- Home hub with a live CPU game playing behind the menus, and original menu music
- Pre-game intro with a camera fly-in and matchup banner
- Slow-motion highlight camera on dunks, blocks and buzzer beaters; a behind-the-shooter free-throw camera
- Ball trails, crowd camera flashes, sparks, confetti for the winners, light beams, and a Player of the Game card
- Brightness slider, 3 cameras, 3 graphics levels

**Accounts and accessibility**
- Cloud save: careers, seasons, kits, tactics and settings follow your account to any device. Saves merge key by key (the newer change of each wins), so an old tab or another device can never wipe a career it never had; each account keeps its own data in a shared browser; and the server keeps the last six versions of every career, season and draft (Settings, Backups, Restore)
- **Admin panel**: the basketball next to the logo on the home screen opens a code page, then a panel where admins can see every account (who is online and what they are doing), look at careers, gift career-mode Rep Points, rating boosts and unlocks (or take them away again), send messages and announcements, reset passwords, suspend or delete accounts, pause sign-ups and read an activity log
- Color-blind friendly colors, larger text, and one-handed or left-handed touch layouts

**Controls**
- Keyboard, mouse buttons, **gamepad** and **touch** (touch controls appear when you touch the screen)
- Every action can be remapped, including to mouse buttons and the scroll wheel
- **Mouse lock**: in a game the mouse locks to the game view (cursor hidden, every click goes to the game). Right-click, middle-click, the back/forward side buttons and dragging never open browser menus, leave the page or select text. Esc frees the mouse and pauses; Resume or a click on the game locks it again. It can be turned off in Settings
- **Custom 3D models and textures**: see [`public/assets/README.md`](public/assets/README.md)

## Controls (defaults, all remappable in the Controls menu)

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | WASD / Arrows | Left stick |
| Sprint | Shift | RT / R2 |
| Shoot / Layup / Dunk / Free throw (hold, then release) | Space | X / □ |
| Pass, or Steal on defense | J | A / ✕ |
| Dribble move, or quick switch on defense | K | B / ○ |
| Flair (hold with another button for the fancy version) | L | Y / △ |
| Switch player | Q | LB / L1 |
| Block / Rebound (defense) | Space | X / □ |
| Call timeout | T | Back / Share |
| Pause | Esc / P | Start |

Every move has its own combination (the Move Guide shows them with your own keys). "Side" means the stick pushed to the side of the line to the basket, "away" pulled away from it:

| Move | Buttons |
|---|---|
| Two-hand slam / one-hand jam | Sprint + Shoot at the rim / the same with the stick to the side |
| Tomahawk / windmill | Sprint + Flair + Shoot / the same with the stick to the side |
| Layup / euro step / reverse layup | Shoot at the rim / stick to the side + Shoot / Flair + Shoot |
| Floater | Flair + Shoot in the lane |
| Jump shot / pull-up / fadeaway | Hold Shoot / Sprint + Shoot / Flair + Shoot |
| Crossover / behind the back / spin / step-back / hesitation | Stick to the side + Move / Flair + Move / Sprint + Move / stick away + Move / Move |
| Chest pass / bounce pass or alley-oop lob | Pass / Flair + Pass (a lob when the teammate is a dunker near the rim) |
| Pump fake | Hold Shoot, tap Pass |

Computer players still choose their own moves.

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

### Highlights, instant replays and the halftime show

A highlight director (`public/js/highlights.js`) rates every play by what actually happened: alley-oops, dunks over a defender,
windmills, deep threes, blocks at the rim, buzzer-beaters, game-winners, the shot that ends a run or takes the lead, and sequences such
as a steal that turns into a slam (one clip, not two). Plays that big get an **instant replay** during the next dead ball, with slow
motion at the payoff and a cut-in camera; press any action button to skip. At **halftime** the show plays the best five plays with
variety (never six threes by the same player), shows the line score, a team-stats comparison (field goals, threes, rebounds, turnovers,
paint, fast-break and bench points, points off steals), the stars of the half, three data-driven "keys to the second half" and
analysts whose lines are built from what decided the half. After the final whistle, **Game highlights** replays the best plays of the
whole game with the player of the game.

Between quarters (after Q1, Q3 and regulation) the same show plays a shorter **quarter recap**: the line score so far, how the quarter
went (who won it and by how much, the biggest run, the hot and cold shooters), the stars of the quarter, and a replay of the play of the
quarter. It can be turned off in Settings ("Quarter recaps"), and "Start next quarter" skips it.

### Friends and chat

Open **Friends** from the home footer (needs a signed-in account). Add people by username, accept requests, see who is online and what
they are playing, and chat (messages are plain text, up to 200 characters, 40 a minute). A dot on the button shows a waiting request or
unread message. To invite a friend to an online game, tap the green "online" chip on the Online tile and press Invite.

### Power Pass, profile and Moments

- **Power Pass**: every finished game earns XP and coins (a game played, a win, your points, career/season/draft/online games, your
  highlight plays, and a bonus for the first win each day). 30 levels unlock coins, ball skins, shoe colourways for your team, card
  frames and profile titles. Coins can unlock a reward early. Equip them in the Locker. The XP bar fills on the results screen and a
  level-up shows your new rewards. Saved under `pph-pass`, so it follows your account through the cloud save
- **Profile badge**: top right of the home screen: your face (your best career player), level with an XP ring, title, frame and coins
- **Moments**: when your team makes a big play, a picture is taken from the game camera. The best play of each game is kept (the
  last 12, in this browser), shown on the home screen, and can be saved or shared as a picture card
- **Friends online**: the Online tile shows how many friends are online. Tap it to invite one (it opens a room and sends them an
  invite) or watch their game. Invites pop up on your friend's home screen with a Join button and last 3 minutes

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
  **Take something away** is the opposite of a gift: take Rep Points, rating points or championships, lock the play styles again, remove one trophy or reset
  the whole Trophy Room, delete a career slot, or clear their friends and chats. Anything still waiting for them can be cancelled one by one (the × on each line) or all at once.
- **Gift everyone**: the same gifts, sent to every account at once.
- **Take from everyone**: take Rep Points, a rating, championships or the unlocked play styles from every account (you type *everyone* to confirm).
  Deleting careers and resetting or editing Trophy Rooms can only be done for one player at a time.
- **Announcements**: a banner on every player's home screen and the login page until it expires.
- **Activity log**: the last 300 admin actions.

Gifts and take-aways wait on the server and are applied the next time the player opens the game (career gifts wait until they have a career),
then a pop-up tells them what happened, with your note if you wrote one. Things are applied once, and numbers never go below their floor:
Rep Points and championships stop at 0, ratings stop at 40. A take-away aimed at a career the player does not have is simply dropped, so it can never hit a career they
start later. A trophy that counts something (wins, dunks, games) has its count wound back to just under the goal so it is not earned straight back.
Rep Points a trophy already paid out stay paid unless you take them back too. A deleted career is removed from the device that opens the game first and from the
cloud copy; another device with changes it has not synced yet could still bring the old copy back, as with Clear cloud save. Players check in about every minute and a half, which is how "online" is worked out.
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
  js/lowerthirds.js         TV lower-third name cards
  js/movelab.js             the Move Guide's live court (scripted moves on the game's poses)
  js/draft.js               the Draft mode (picks, squad, runs)
  js/pass.js                the Power Pass (XP, levels, rewards, coins, the Locker)
  js/moments.js             Moments (big-play pictures, the best play of each game, picture cards)
  sw.js                     app-shell cache for the installable app
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
- Jump shot motion: "Pj_shot" by Keith_Pamment (Sketchfab Standard license), via [Sketchfab](https://sketchfab.com/3d-models/pj-shot-f7d31c3808ef481f8e98eca7cdf54664). Only the retargeted motion is included (public/assets/anims), not the model
- Dribble motion: "Basketball Player Dribbles Invisible Ball" by LasquetiSpice (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/basketball-player-dribbles-invisible-ball-426b74048cd34a2a9c7fec0c3b603f4e). Retargeted from a Mixamo skeleton, plus a mirrored left-handed version
- Running motion: "Running Motion" by Jason Kan (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/running-motion-92847620b80b4b7c92a7f98f971f9ed5). Only the runner's motion is used (the treadmill is left out), played at the player's real speed
- Player looks: sleeveless jerseys with trim, side panels on the shorts, socks (crew or low, in each team's sock colour), wristbands and the odd shooting sleeve are drawn in the player shaders, so they cost no extra draw calls. Each player's look comes from their name, so it is the same every game. The clean-shaven and bearded faces (`assets/textures/face-*.webp`) are edited copies of the player model's own face texture, and skin tones are matched to the chosen colour so darker skin keeps its detail
- Hair styles: "FREE Male Fashion Hair collection 01 lowpoly" by Vincent Page (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/free-male-fashion-hair-collection-01-lowpoly-2735370f6f764078a18f5d80651050a2). Only the hair is used (the mannequin heads and faces were removed), simplified to about 6,000 triangles a style and fitted to each player's head
- Jumping motion: "Boy Jumping" by myzatulsarah (CC-BY 4.0), via [Sketchfab](https://sketchfab.com/3d-models/boy-jumping-7bd8d2d9821449abbd8657e053bafea8). The arms and upper body are used for blocks, rebounds and jump balls; the legs stay extended with the feet down

The uploaded models were optimized for the web (smaller textures, unused animations and the court's fence removed; the sneakers went from 176k to about 6k triangles per shoe and were split into a left and a right).
Credits are also shown in the game's Settings screen.
