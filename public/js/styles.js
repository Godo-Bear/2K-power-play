// What each career play style does on the court, beyond its rating boosts.
// Values are small additive bonuses; the primary style counts in full and equipped extras at 60%.
export const PERKS = {
  sharpshooter: { three: 0.07, resist: 0.12 },
  playmaker: { passSpeed: 0.18, handle: 0.06, speed: 0.02 },
  slasher: { inside: 0.06, speed: 0.04, handle: 0.03, blockResist: 0.2 },
  lockdown: { steal: 0.12, contestD: 0.12, speed: 0.03 },
  glass: { reb: 0.3, block: 0.15 },
  threeD: { three: 0.04, steal: 0.06, contestD: 0.06 },
  shotCreator: { mid: 0.05, resist: 0.18, handle: 0.05 },
  stretchBig: { three: 0.05, mid: 0.03, reb: 0.12 },
  postScorer: { inside: 0.08, blockResist: 0.25, reb: 0.1 },
  rimProtector: { block: 0.35, reb: 0.15, contestD: 0.1 },
  speedster: { speed: 0.09, handle: 0.05, steal: 0.05 },
  floorGeneral: { passSpeed: 0.22, handle: 0.05, contestD: 0.04 },
  scoringGuard: { mid: 0.04, three: 0.03, resist: 0.12, handle: 0.04 },
  twoWayWing: { three: 0.03, steal: 0.08, contestD: 0.08, speed: 0.02 },
  pointForward: { passSpeed: 0.15, handle: 0.04, reb: 0.1 },
  enforcer: { reb: 0.2, blockResist: 0.2, contestD: 0.1, block: 0.1 },
  lobThreat: { inside: 0.07, blockResist: 0.25, speed: 0.02 },
  playBig: { passSpeed: 0.18, reb: 0.12, inside: 0.03 },
  allAround: { three: 0.015, mid: 0.015, inside: 0.015, steal: 0.02, reb: 0.05, block: 0.05, passSpeed: 0.05 },
};
export const PERK_KEYS = ['three', 'mid', 'inside', 'resist', 'speed', 'handle', 'steal', 'block', 'reb', 'passSpeed', 'contestD', 'blockResist'];
export function perksFor(keys) {
  const out = {};
  for (const k of PERK_KEYS) out[k] = 0;
  (keys || []).forEach((key, i) => { const pk = PERKS[key]; if (pk) for (const [a, v] of Object.entries(pk)) out[a] += v * (i === 0 ? 1 : 0.6); });
  return out;
}
export const PERK_TEXT = {
  sharpshooter: 'Hits more threes, shrugs off contests',
  playmaker: 'Faster passes, easier shots for teammates, tighter handle',
  slasher: 'Quicker drives, better at the rim, hard to block',
  lockdown: 'Steals more, bothers shooters',
  glass: 'Wins rebounds, adds blocks',
  threeD: 'Better threes, steals and shot contests',
  shotCreator: 'Mid-range specialist, hard to guard',
  stretchBig: 'Big man who hits threes and rebounds',
  postScorer: 'Finishes inside, hard to block, rebounds',
  rimProtector: 'Many more blocks, rebounds, hurts inside shots',
  speedster: 'Much faster, tough handle, more steals',
  floorGeneral: 'Passes much faster, runs the offense, tight handle',
  scoringGuard: 'Mid-range and three specialist, hard to guard',
  twoWayWing: 'Steals, bothers shooters, hits some threes',
  pointForward: 'Faster passes, strong handle, rebounds',
  enforcer: 'Wins rebounds, hard to block, bothers shooters',
  lobThreat: 'Finishes at the rim, very hard to block',
  playBig: 'Fast passes from the post, rebounds',
  allAround: 'Small boosts everywhere',
};
