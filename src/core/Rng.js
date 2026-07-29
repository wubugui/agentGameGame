/**
 * Deterministic RNG (mulberry32). Every world-generation path takes one of
 * these so a given map seed always rebuilds the identical world.
 */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
  rng.range = (min, max) => min + rng() * (max - min);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  /** Box-Muller, cached. */
  let spare = null;
  rng.gauss = (mu = 0, sigma = 1) => {
    if (spare !== null) { const v = spare; spare = null; return mu + sigma * v; }
    let u, v, s;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return mu + sigma * u * m;
  };
  rng.fork = () => makeRng(Math.floor(rng() * 0xffffffff));
  return rng;
}

export default makeRng;
