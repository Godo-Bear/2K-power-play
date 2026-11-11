# Custom 3D models & textures

Drop your own models and textures here and the game will use them in place of the
built-in graphics. Anything you don't provide keeps the default look.

```
public/assets/
├── assets.json      ← tells the game which files to use
├── models/          ← .glb / .gltf (+ .bin) files
└── textures/        ← .png / .jpg / .webp files
```

## Uploading from the GitHub website (no coding needed)

1. Open the repo on GitHub and go to `public/assets/models` (or `public/assets/textures`).
2. Click **Add file → Upload files**, drag your files in, and click **Commit changes**.
3. Open `public/assets/assets.json`, click the ✏️ pencil, and fill in the file names (example below).
4. Commit. The **Check uploaded assets** action runs automatically (Actions tab) and tells you
   if a file is missing, misspelled, or too big.
5. Cloudflare redeploys from `main`, and the new look appears on the site.

## What you can replace

| Slot | Key in `assets.json` | Format | Notes |
|------|----------------------|--------|-------|
| Players | `player.model` | `.glb` | Auto-scaled to each player's height. Feet should be at the bottom. |
| Player animations | `player.animations` | clip names inside the `.glb` | Map game states to your clip names: `idle`, `run`, `dribble`, `shoot`, `layup`, `dunk`, `jump`. |
| Player colors | `player.tint` | `{ "materialName": "jersey" }` | Recolor materials by name: `jersey`, `trim`, `skin`, `hair` or `shoe`. Example: `{ "Shirt": "jersey", "Skin": "skin" }`. Kit materials (jersey, trim, shoe) have their texture replaced by the flat team color, so a red photo-textured shirt doesn't stain the team color. Set `"flatColors": false` to keep textures. |
| Player hair | `player.hairMesh` | `true` / `false` | Set `true` if the model has its own hair as a separate mesh (material tinted `hair`). It is used for the Buzz and Short styles, and hidden for Bald and for the sculpted styles (High Top, Afro, Mohawk, Locs, Top Bun, Cornrows, Curly Top), which the game builds on the head bone. |
| Ball | `ball.model` / `ball.texture` | `.glb` / image | Model is auto-sized to a real ball. A texture alone wraps the default sphere. |
| Court floor | `court.texture` | image | Covers the full floor including the apron (about 32.7m × 20.4m, so roughly 1.6:1). Paint your own lines. |
| Court model | `court.model` | `.glb` | Used under **Settings → Court**. Two ways to use one. **Surroundings only** (the street court): add `"floor": { "base", "key", "apron", "lines" }` colors. The game paints its own floor in those colors, so the lines match the rules exactly, and keeps its own hoops; the model supplies walls, benches, light poles and so on. `scale` can be a single number or `[x, y, z]`, with `position` and `rotationY` to place it. **Complete court**: leave `floor` out, and the model replaces the floor and hoops, so line its rims up with the game's (3.05 m high, 12.73 m from center). |
| Extra arena scenery | `arena.models` | list of `.glb` | Added around the court. Each entry has `model`, `scale`, `rotationY` (degrees) and `copies`: a list of `{ "position": [x, y, z] }` to place it several times. |
| Credits | `credits` | list of text | Shown in Settings. Put the CC-BY credit lines here. |

### Example

```json
{
  "player": {
    "model": "models/baller.glb",
    "scale": 1,
    "rotationY": 0,
    "jerseyMaterial": "jersey",
    "animations": { "idle": "Idle", "run": "Run", "dribble": "Dribble", "shoot": "Jumpshot", "jump": "Jump" }
  },
  "ball": { "model": "models/ball.glb" },
  "court": { "texture": "textures/court.jpg" },
  "arena": { "model": "models/stadium.glb", "scale": 1, "position": [0, 0, 0], "rotationY": 0 }
}
```

If the model faces the wrong way, set `rotationY` to `90`, `180` or `-90`.

## Tips

- **Use `.glb`**: it's one file with the textures baked in. For `.gltf`, upload its `.bin` and textures too, in the same folder layout.
- **Size limit**: Cloudflare serves files up to **25 MiB** each. Shrink big models with
  [glTF-Transform](https://gltf-transform.dev/) (`npx @gltf-transform/cli optimize in.glb out.glb --texture-compress webp`).
  GitHub's web uploader also caps files at 25 MB.
- **FBX/OBJ**: convert to `.glb` first (Blender → File → Export → glTF 2.0).
- **Rights**: only upload assets you're allowed to use, such as your own work or files with a license
  that permits it (CC0 / CC-BY from Sketchfab, Poly Haven, Quaternius, Mixamo and similar). Keep the
  author credit when CC-BY asks for it. Models ripped from commercial games aren't allowed, even
  if they're posted for free somewhere.
- Loading errors show in the browser console (F12) as `[assets] ...`, and the game keeps
  running with the default graphics.
