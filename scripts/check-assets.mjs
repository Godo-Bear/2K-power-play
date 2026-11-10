// Validates uploaded assets before they get deployed to Cloudflare Workers.
// - assets.json must be valid JSON
// - every file it references must exist
// - every file must be under Cloudflare's 25 MiB per-file limit
// - only supported file types are allowed
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = 'public/assets';
const LIMIT = 25 * 1024 * 1024;
const OK = new Set(['.glb', '.gltf', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.json', '.md', '']);
let errors = 0;
const fail = (m) => { console.error(`✖ ${m}`); errors++; };

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const rel = relative(ROOT, p);
    if (!OK.has(extname(name).toLowerCase()) && name !== '.gitkeep') fail(`${rel}: unsupported file type (use .glb/.gltf for models, .png/.jpg/.webp for textures)`);
    if (st.size > LIMIT) fail(`${rel}: ${(st.size / 1048576).toFixed(1)} MiB is over Cloudflare's 25 MiB per-file limit. Compress it (e.g. gltf-transform / smaller textures).`);
    else console.log(`✔ ${rel} (${(st.size / 1024).toFixed(0)} KiB)`);
  }
}
walk(ROOT);

let manifest = {};
try { manifest = JSON.parse(readFileSync(join(ROOT, 'assets.json'), 'utf8')); }
catch (e) { fail(`assets.json is not valid JSON: ${e.message}`); }

const refs = [
  manifest.player?.model, manifest.ball?.model, manifest.ball?.texture,
  manifest.court?.texture, manifest.arena?.model,
].filter(Boolean);
for (const r of refs) {
  if (!existsSync(join(ROOT, r))) fail(`assets.json points to "${r}" but public/assets/${r} does not exist (check the spelling and folder, names are case-sensitive)`);
}

if (errors) { console.error(`\n${errors} problem(s) found.`); process.exit(1); }
console.log('\nAll assets look good.');
