/**
 * Global tunables. Everything that a designer might want to tweak lives here so
 * no subsystem hard-codes a magic number that another subsystem also depends on.
 */

/** One world unit == one Mir tile. Grid is X (east) / Z (south), Y is up. */
export const TILE = 1;

export const CAMERA = {
  /** Mir2 was drawn on a 45°-yaw isometric grid; we keep the silhouette. */
  yaw: Math.PI * 0.25,
  pitch: 0.86,          // radians above the horizon (~49°)
  distance: 26,
  minDistance: 13,
  maxDistance: 42,
  fov: 30,
  near: 0.5,
  far: 400,
  /** How fast the rig chases the player (higher == snappier). */
  followLambda: 7.5,
};

export const QUALITY_PRESETS = {
  low:   { pixelRatio: 1.0, shadowMap: 1024, shadows: true,  ssao: false, bloom: true,  taa: false, aniso: 4,  particles: 0.4, propDensity: 0.5, terrainSeg: 1 },
  med:   { pixelRatio: 1.25, shadowMap: 2048, shadows: true, ssao: false, bloom: true,  taa: false, aniso: 8,  particles: 0.7, propDensity: 0.8, terrainSeg: 1 },
  high:  { pixelRatio: 1.5, shadowMap: 2048, shadows: true,  ssao: true,  bloom: true,  taa: true,  aniso: 16, particles: 1.0, propDensity: 1.0, terrainSeg: 2 },
  ultra: { pixelRatio: 2.0, shadowMap: 4096, shadows: true,  ssao: true,  bloom: true,  taa: true,  aniso: 16, particles: 1.4, propDensity: 1.3, terrainSeg: 2 },
};

export const COMBAT = {
  /** Global attack cadence in seconds; items/skills scale this. */
  baseAttackInterval: 1.1,
  /** Melee reach in tiles (Mir2 melee is strictly adjacent). */
  meleeRange: 1.6,
  /** Chance-to-hit floor/ceiling so fights never fully stall. */
  minHitChance: 0.12,
  maxHitChance: 0.97,
  critMultiplier: 1.75,
  /** Seconds a corpse lingers before fading out. */
  corpseLinger: 9,
  respawnDelay: [14, 26],
};

export const PLAYER = {
  walkSpeed: 3.6,      // tiles/sec
  runSpeed: 6.1,
  turnLambda: 14,
  pickupRange: 1.9,
  /** Stamina drained per second while running. */
  runStaminaDrain: 5,
  staminaRegen: 7,
};

export const WORLD = {
  /** Seconds of real time per in-game hour. */
  secondsPerGameHour: 55,
  startHour: 8.5,
  /** Max simultaneously simulated monsters (rest are frozen far from player). */
  activeMonsterBudget: 90,
  simulationRadius: 46,
};

export const DEBUG = {
  stats: false,
  navGrid: false,
  wireframe: false,
  freeCam: false,
};

/** Detect a sane default quality tier from the device. */
export function autoQuality() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return 'low';
  if (mem >= 8 && cores >= 8) return 'high';
  if (mem >= 4 && cores >= 4) return 'med';
  return 'low';
}
