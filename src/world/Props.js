/**
 * src/world/Props.js — everything standing on the terrain.
 * See docs/CONTRACTS.md §9.
 *
 * Two very different populations live in here and they are built by two very
 * different paths:
 *
 *  1. **Scatter** — trees, bushes, grass, reeds, rocks, logs, flowers. Placed
 *     from a deterministic RNG seeded off `mapDef.seed`, on a jittered grid so
 *     spacing is guaranteed (a Poisson-ish lattice; solid walls of trunks would
 *     seal spawn areas off the nav grid). Everything is a `THREE.InstancedMesh`,
 *     bucketed into 32-unit chunks so the frustum can throw whole chunks away,
 *     with per-instance scale, yaw *and* tint — uniform instances read as fake
 *     instantly. Trees come out of a recursive branch generator, not a cylinder
 *     with a ball on top.
 *
 *  2. **Structures** — the hand-authored `mapDef.structures[]` list. Each one is
 *     built as real geometry in a period East-Asian idiom: raised stone plinths,
 *     timber frames with visible posts and lintels, paper screens with lattice
 *     mullions, and roofs lofted along a proper 举折 curve with upturned corners,
 *     ridge beams, drip tiles and stepped 斗拱 brackets under the overhang.
 *     Geometry is built in *local* space and merged per material, so a whole
 *     house is 4-6 draw calls and one group node to cull.
 *
 * Modeled GLBs take priority when they exist (`ctx.assets.prop(name)`); none of
 * the structure/nature assets are built yet, so the JS fallback below is what
 * actually runs, and it is written to be the shipping version rather than a
 * placeholder.
 *
 * Budgets:
 *  - at most `MAX_LIGHTS[quality]` dynamic PointLights, re-assigned from a
 *    distance-sorted source list on a throttle; everything else keeps its
 *    emissive material and (if it is close enough) a particle plume.
 *  - foliage sways in the vertex shader via `onBeforeCompile`, one shared
 *    uniform block for the whole map.
 *  - `update()` allocates nothing.
 */

import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { makeRng } from '../core/Rng.js';
import { QUALITY_PRESETS } from '../game/Config.js';

/* ========================================================================== *
 * 0. Tables and tunables
 * ========================================================================== */

/** Fallback blocking radii for point props that didn't declare one. */
const DEFAULT_RADIUS = {
  'temple.pillar': 0.8, brazier: 0.55, altar: 1.5, well: 1.15, cart: 1.0,
  crate: 0.65, barrel: 0.5, 'statue.beast': 1.25, 'banner.pole': 0.4,
  'tomb.stone': 0.8, fence: 0.35, 'lava.pool': 1.7,
};

/** Kinds you walk through or over — never emit a blocker for these. */
const NON_BLOCKING = new Set(['gate.town', 'bridge', 'stairs', 'torch.wall', 'cave.mouth']);

/** Point props that are built once and drawn with an InstancedMesh. */
const INSTANCED_KINDS = new Set([
  'crate', 'barrel', 'fence', 'banner.pole', 'tomb.stone', 'temple.pillar',
  'statue.beast', 'torch.wall', 'brazier', 'well', 'cart', 'stairs',
]);

/** Library materials that carry their own shader; leave their defines alone. */
const SHADER_MATERIALS = new Set(['lava', 'water', 'rune', 'crystal', 'glass', 'eye.glow', 'shadowBlob']);

/** Roof skins are emitted as their own meshes so they can fade out of the camera sightline. */
const ROOF_MATERIALS = new Set(['roofTile', 'thatch']);
/** Upper building shell materials which must reveal a character standing indoors. */
const STRUCTURE_SIGHT_MATERIALS = new Set([
  'roofTile', 'thatch', 'plank', 'plaster', 'paperScreen', 'banner',
]);
const STRUCTURE_SIGHT_KINDS = new Set([
  'house.tiled', 'house.thatch', 'shop', 'inn', 'temple.hall',
]);

const MAX_LIGHTS = { low: 3, med: 5, high: 8, ultra: 8 };
/** How many flame/smoke plumes may be alive at once. */
const MAX_FX = { low: 3, med: 6, high: 10, ultra: 14 };

/** Chunk edge in world units for scatter batching / culling. */
const CHUNK = 32;

/** Distance (world units) past which a structure's fine detail mesh hides. */
const LOD_DETAIL = 46;
const LOD_DETAIL2 = LOD_DETAIL * LOD_DETAIL;

/** Exclusion bits written into the scatter mask. */
const EX_BIG = 1;    // no trees / rocks / logs / bushes
const EX_SMALL = 2;  // no grass / flowers either

/**
 * Per-style material + tint table. `style` comes off the MapDef structure.
 * Vertex colours are only ever multiplicative near-white variation; real hue
 * shifts go through a material override so the cache stays small.
 */
const STYLES = {
  stone: {
    wall: ['stoneWall', null], trim: ['plank', 0x6d5236], post: ['plank', 0x7a4b32],
    roof: ['roofTile', null], plinth: ['stoneWall', 0x8c8579], infill: ['plaster', null],
    metal: 'ironRusted', tint: 1.0,
  },
  temple: {
    wall: ['templeWall', null], trim: ['plank', 0x8e3527], post: ['plank', 0x93382a],
    roof: ['roofTile', 0x5b4a5e], plinth: ['templeWall', 0x9a8f76], infill: ['plaster', 0xd8c9a8],
    metal: 'bronze', tint: 1.02,
  },
  sand: {
    wall: ['plaster', 0xd6bd93], trim: ['plank', 0x7d5c37], post: ['plank', 0x8a6338],
    roof: ['roofTile', 0x7a6448], plinth: ['brick', 0xc0a377], infill: ['plaster', 0xdcc79f],
    metal: 'ironRusted', tint: 1.04,
  },
  wood: {
    wall: ['plaster', 0xcfc2a4], trim: ['plank', 0x6f4e30], post: ['plank', 0x7b5334],
    roof: ['roofTile', null], plinth: ['stoneWall', 0x87817a], infill: ['plaster', null],
    metal: 'ironRusted', tint: 1.0,
  },
  cave: {
    wall: ['rock', null], trim: ['plank', 0x5a4530], post: ['plank', 0x5a4530],
    roof: ['rock', null], plinth: ['rock', 0x6f6a63], infill: ['rock', null],
    metal: 'ironRusted', tint: 0.92,
  },
  lava: {
    wall: ['cliff', 0x5a4038], trim: ['plank', 0x4a3327], post: ['plank', 0x4a3327],
    roof: ['cliff', 0x4a3630], roofAlt: null, plinth: ['cliff', 0x584038], infill: ['cliff', 0x50392f],
    metal: 'ironRusted', tint: 0.88,
  },
};

function styleOf(name) { return STYLES[name] || STYLES.stone; }

/** Resolve a material-cache key back to its library name (`!` marks unlit variants). */
function materialName(key) {
  const hash = key.indexOf('#');
  const name = hash < 0 ? key : key.slice(0, hash);
  return name.charCodeAt(0) === 33 ? name.slice(1) : name;
}

/** Which tree species a biome grows, and how thick the ambient cover is. */
const BIOME_FLORA = {
  meadow: {
    trees: ['oak', 'oak', 'pine', 'willow'], ambient: 0.16,
    grass: 0.85, bush: 0.42, flower: 0.22, rock: 0.16, log: 0.5, reed: 1,
  },
  desert: {
    trees: ['palm', 'dead'], ambient: 0.02,
    grass: 0.16, bush: 0.14, flower: 0.03, rock: 0.3, log: 0.2, reed: 0,
  },
  temple: {
    trees: [], ambient: 0, grass: 0, bush: 0, flower: 0, rock: 0.06, log: 0, reed: 0,
  },
  cave: {
    trees: [], ambient: 0, grass: 0, bush: 0, flower: 0, rock: 0.42, log: 0.08, reed: 0,
  },
  hell: {
    trees: ['dead'], ambient: 0.03, grass: 0, bush: 0, flower: 0, rock: 0.5, log: 0.2, reed: 0,
  },
};

function floraOf(biome) { return BIOME_FLORA[biome] || BIOME_FLORA.meadow; }

/* ========================================================================== *
 * 1. Scalar helpers (no allocation)
 * ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

function smoothstep(e0, e1, x) {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Cheap deterministic hash in [0,1). */
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Distance from (px,pz) to segment (ax,az)-(bx,bz). */
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/* ========================================================================== *
 * 2. Mesher — a tiny append-only geometry builder
 *
 * Every geometry in this module carries the same four attributes
 * (position / normal / uv / color) plus an optional `aWind`, because merged and
 * instanced meshes share materials and a material with `vertexColors` on a
 * geometry without a `color` attribute is a black screen.
 * ========================================================================== */

const _e1 = [0, 0, 0];
const _e2 = [0, 0, 0];
const _nn = [0, 0, 0];

class Mesher {
  constructor() {
    this.p = []; this.n = []; this.t = []; this.c = []; this.w = [];
    this.idx = [];
    this.count = 0;
  }

  get empty() { return this.count === 0; }

  vert(x, y, z, nx, ny, nz, u, v, cr, cg, cb, wind) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.t.push(u, v);
    this.c.push(cr, cg, cb);
    this.w.push(wind || 0);
    return this.count++;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /**
   * A planar quad from four corner arrays in CCW order. UVs come from the real
   * edge lengths so any material tiles at a consistent world scale.
   * @param {number[]} a @param {number[]} b @param {number[]} c @param {number[]} d
   * @param {number[]} col rgb multiplier
   * @param {number} us  uv units per world unit
   * @param {number|Function} [wind] constant, or fn(x,y,z)
   * @param {number[]} [ref] outward reference; winding flips to match it
   * @param {number[]} [uvRect] explicit [u0,v0,u1,v1], for continuous atlases
   */
  face(a, b, c, d, col, us, wind, ref, uvRect) {
    _e1[0] = b[0] - a[0]; _e1[1] = b[1] - a[1]; _e1[2] = b[2] - a[2];
    _e2[0] = d[0] - a[0]; _e2[1] = d[1] - a[1]; _e2[2] = d[2] - a[2];
    _nn[0] = _e1[1] * _e2[2] - _e1[2] * _e2[1];
    _nn[1] = _e1[2] * _e2[0] - _e1[0] * _e2[2];
    _nn[2] = _e1[0] * _e2[1] - _e1[1] * _e2[0];
    let len = Math.hypot(_nn[0], _nn[1], _nn[2]);
    if (len < 1e-9) return;
    let flip = false;
    if (ref && (_nn[0] * ref[0] + _nn[1] * ref[1] + _nn[2] * ref[2]) < 0) {
      flip = true;
      _nn[0] = -_nn[0]; _nn[1] = -_nn[1]; _nn[2] = -_nn[2];
    }
    const nx = _nn[0] / len, ny = _nn[1] / len, nz = _nn[2] / len;
    const u0 = uvRect ? uvRect[0] : 0;
    const v0 = uvRect ? uvRect[1] : 0;
    const u1 = uvRect ? uvRect[2] : Math.hypot(_e1[0], _e1[1], _e1[2]) * us;
    const v1 = uvRect ? uvRect[3] : Math.hypot(_e2[0], _e2[1], _e2[2]) * us;
    const wf = typeof wind === 'function' ? wind : null;
    const wc = wf ? 0 : (wind || 0);
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, u0, v0, col[0], col[1], col[2], wf ? wf(a[0], a[1], a[2]) : wc);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, u1, v0, col[0], col[1], col[2], wf ? wf(b[0], b[1], b[2]) : wc);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, u1, v1, col[0], col[1], col[2], wf ? wf(c[0], c[1], c[2]) : wc);
    const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, u0, v1, col[0], col[1], col[2], wf ? wf(d[0], d[1], d[2]) : wc);
    if (flip) this.quad(i0, i3, i2, i1);
    else this.quad(i0, i1, i2, i3);
  }

  /** Axis-aligned-ish box, optionally yawed and/or tapered toward the top. */
  box(cx, cy, cz, sx, sy, sz, col, us, rotY = 0, inset = 0) {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const tx = Math.max(0.001, hx - inset), tz = Math.max(0.001, hz - inset);
    const ca = Math.cos(rotY), sa = Math.sin(rotY);
    const P = (lx, ly, lz) => [cx + lx * ca + lz * sa, cy + ly, cz - lx * sa + lz * ca];
    const b0 = P(-hx, -hy, -hz), b1 = P(hx, -hy, -hz), b2 = P(hx, -hy, hz), b3 = P(-hx, -hy, hz);
    const t0 = P(-tx, hy, -tz), t1 = P(tx, hy, -tz), t2 = P(tx, hy, tz), t3 = P(-tx, hy, tz);
    this.face(t0, t3, t2, t1, col, us, 0, [0, 1, 0]);
    this.face(b0, b1, b2, b3, col, us, 0, [0, -1, 0]);
    this.face(b3, b2, t2, t3, col, us, 0, [0, 0, 1]);
    this.face(b1, b0, t0, t1, col, us, 0, [0, 0, -1]);
    this.face(b2, b1, t1, t2, col, us, 0, [1, 0, 0]);
    this.face(b0, b3, t3, t0, col, us, 0, [-1, 0, 0]);
  }

  /** Vertical cylinder / truncated cone. */
  cyl(cx, cy, cz, r0, r1, h, seg, col, us, capTop = true, capBot = false) {
    const y0 = cy, y1 = cy + h;
    const ring0 = [], ring1 = [];
    const slope = (r0 - r1) / Math.max(1e-4, h);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ny = slope / Math.hypot(1, slope), s = 1 / Math.hypot(1, slope);
      const u = (i / seg) * TAU * ((r0 + r1) * 0.5) * us;
      ring0.push(this.vert(cx + ca * r0, y0, cz + sa * r0, ca * s, ny, sa * s, u, 0, col[0], col[1], col[2], 0));
      ring1.push(this.vert(cx + ca * r1, y1, cz + sa * r1, ca * s, ny, sa * s, u, h * us, col[0], col[1], col[2], 0));
    }
    for (let i = 0; i < seg; i++) this.quad(ring0[i], ring0[i + 1], ring1[i + 1], ring1[i]);
    if (capTop && r1 > 1e-4) {
      const cIdx = this.vert(cx, y1, cz, 0, 1, 0, 0, 0, col[0], col[1], col[2], 0);
      const rim = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        rim.push(this.vert(cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, 0, 1, 0,
          Math.cos(a) * r1 * us, Math.sin(a) * r1 * us, col[0], col[1], col[2], 0));
      }
      for (let i = 0; i < seg; i++) this.tri(cIdx, rim[i + 1], rim[i]);
    }
    if (capBot && r0 > 1e-4) {
      const cIdx = this.vert(cx, y0, cz, 0, -1, 0, 0, 0, col[0], col[1], col[2], 0);
      const rim = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        rim.push(this.vert(cx + Math.cos(a) * r0, y0, cz + Math.sin(a) * r0, 0, -1, 0,
          Math.cos(a) * r0 * us, Math.sin(a) * r0 * us, col[0], col[1], col[2], 0));
      }
      for (let i = 0; i < seg; i++) this.tri(cIdx, rim[i], rim[i + 1]);
    }
  }

  /** Revolve a [radius, y] profile. */
  lathe(cx, cy, cz, profile, seg, col, us) {
    const rings = [];
    for (let p = 0; p < profile.length; p++) {
      const r = profile[p][0], y = profile[p][1];
      const ring = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        // approximate normal from the profile slope
        const pp = profile[Math.max(0, p - 1)], pn = profile[Math.min(profile.length - 1, p + 1)];
        const dr = pn[0] - pp[0], dy = pn[1] - pp[1];
        let nx = dy, nyv = -dr;
        const l = Math.hypot(nx, nyv) || 1;
        nx /= l; nyv /= l;
        ring.push(this.vert(cx + ca * r, cy + y, cz + sa * r, ca * nx, nyv, sa * nx,
          (i / seg) * TAU * 0.5 * us * Math.max(0.2, r), y * us, col[0], col[1], col[2], 0));
      }
      rings.push(ring);
    }
    for (let p = 0; p < rings.length - 1; p++) {
      for (let i = 0; i < seg; i++) {
        this.quad(rings[p][i], rings[p][i + 1], rings[p + 1][i + 1], rings[p + 1][i]);
      }
    }
  }

  /**
   * Tapered tube swept along a polyline with parallel-transported frames.
   * @param {number[][]} pts   [[x,y,z], …]
   * @param {number[]} radii   one per point
   * @param {number} seg       radial segments
   */
  tube(pts, radii, seg, col, us, windFn) {
    if (pts.length < 2) return;
    const n = pts.length;
    let rx = 0, ry = 0, rz = 0;
    const rings = [];
    let prevT = null;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      let tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      if (!prevT) {
        // seed a right vector perpendicular to the first tangent
        const ax = Math.abs(ty) < 0.9 ? 0 : 1;
        const ux = ax, uy = ax ? 0 : 1, uz = 0;
        rx = ty * uz - tz * uy; ry = tz * ux - tx * uz; rz = tx * uy - ty * ux;
      } else {
        // remove the component along the new tangent (parallel transport)
        const d = rx * tx + ry * ty + rz * tz;
        rx -= tx * d; ry -= ty * d; rz -= tz * d;
      }
      let rl = Math.hypot(rx, ry, rz);
      if (rl < 1e-5) { rx = 1; ry = 0; rz = 0; rl = 1; }
      rx /= rl; ry /= rl; rz /= rl;
      const bx = ty * rz - tz * ry, by = tz * rx - tx * rz, bz = tx * ry - ty * rx;
      prevT = 1;
      const r = radii[i];
      const ring = [];
      const wv = windFn ? windFn(pts[i][0], pts[i][1], pts[i][2], i / (n - 1)) : 0;
      for (let k = 0; k <= seg; k++) {
        const ang = (k / seg) * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = rx * ca + bx * sa, ny = ry * ca + by * sa, nz = rz * ca + bz * sa;
        ring.push(this.vert(pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r,
          nx, ny, nz, (k / seg) * TAU * 0.35 * us, i * us * 1.4, col[0], col[1], col[2], wv));
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < seg; k++) {
        this.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]);
      }
    }
  }

  /** Merge another mesher's contents, offset and yawed. */
  append(other, dx, dy, dz, rotY) {
    const ca = Math.cos(rotY || 0), sa = Math.sin(rotY || 0);
    const base = this.count;
    for (let i = 0; i < other.count; i++) {
      const x = other.p[i * 3], y = other.p[i * 3 + 1], z = other.p[i * 3 + 2];
      const nx = other.n[i * 3], ny = other.n[i * 3 + 1], nz = other.n[i * 3 + 2];
      this.p.push(dx + x * ca + z * sa, dy + y, dz - x * sa + z * ca);
      this.n.push(nx * ca + nz * sa, ny, -nx * sa + nz * ca);
      this.t.push(other.t[i * 2], other.t[i * 2 + 1]);
      this.c.push(other.c[i * 3], other.c[i * 3 + 1], other.c[i * 3 + 2]);
      this.w.push(other.w[i]);
      this.count++;
    }
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
  }

  /** Merge another mesher through an arbitrary matrix (used for wheels etc.). */
  appendMatrix(other, m4) {
    const e = m4.elements;
    const base = this.count;
    for (let i = 0; i < other.count; i++) {
      const x = other.p[i * 3], y = other.p[i * 3 + 1], z = other.p[i * 3 + 2];
      this.p.push(
        e[0] * x + e[4] * y + e[8] * z + e[12],
        e[1] * x + e[5] * y + e[9] * z + e[13],
        e[2] * x + e[6] * y + e[10] * z + e[14]);
      const nx = other.n[i * 3], ny = other.n[i * 3 + 1], nz = other.n[i * 3 + 2];
      let ax = e[0] * nx + e[4] * ny + e[8] * nz;
      let ay = e[1] * nx + e[5] * ny + e[9] * nz;
      let az = e[2] * nx + e[6] * ny + e[10] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      ax /= l; ay /= l; az /= l;
      this.n.push(ax, ay, az);
      this.t.push(other.t[i * 2], other.t[i * 2 + 1]);
      this.c.push(other.c[i * 3], other.c[i * 3 + 1], other.c[i * 3 + 2]);
      this.w.push(other.w[i]);
      this.count++;
    }
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
  }

  /** @returns {THREE.BufferGeometry|null} */
  geometry(withWind) {
    if (!this.count || !this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.t), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    if (withWind) g.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(this.w), 1));
    const Idx = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new Idx(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/* ========================================================================== *
 * 3. Kit — one structure's geometry, bucketed by material key
 * ========================================================================== */

/** Material key: `name` or `name#rrggbb` when the style asks for a tint. */
function mk(name, color) {
  return (color === null || color === undefined) ? name : `${name}#${(color >>> 0).toString(16)}`;
}

class Kit {
  constructor() {
    /** @type {Map<string, Mesher>} always-visible geometry */
    this.near = new Map();
    /** @type {Map<string, Mesher>} fine detail, hidden past LOD_DETAIL */
    this.far = new Map();
  }

  g(key) {
    let m = this.near.get(key);
    if (!m) this.near.set(key, (m = new Mesher()));
    return m;
  }

  d(key) {
    let m = this.far.get(key);
    if (!m) this.far.set(key, (m = new Mesher()));
    return m;
  }
}

/** Small colour jitter around white, for per-face variation. */
function jit(rng, amt, warm) {
  const v = 1 + (rng() - 0.5) * amt;
  const w = warm ? warm * (rng() - 0.5) : 0;
  return [clamp(v + w, 0.4, 1.6), clamp(v, 0.4, 1.6), clamp(v - w, 0.4, 1.6)];
}

const WHITE = [1, 1, 1];

/* ========================================================================== *
 * 4. East-Asian architecture kit
 * ========================================================================== */

/**
 * A tiled roof lofted along a 举折 curve: steep off the ridge, flattening into a
 * long shallow eave that lifts at the corners. Adds the ridge beam, its end
 * ornaments, the fascia board, drip tiles and the stepped 斗拱 brackets.
 *
 * @param {Kit} kit
 * @param {object} o {w,d,y,rise,ov,hip,ridgeFrac,up,roofKey,woodKey,rng,
 *                    brackets, tint}
 */
function addRoof(kit, o) {
  const w = o.w, d = o.d, y0 = o.y, rise = o.rise;
  const ov = o.ov !== undefined ? o.ov : 0.9;
  const hip = o.hip !== false;
  const up = o.up !== undefined ? o.up : Math.max(0.22, rise * 0.3);
  const rl = hip ? w * (o.ridgeFrac || 0.5) : w + ov * 2;
  const rng = o.rng;
  const rm = kit.g(o.roofKey);
  const wm = kit.g(o.woodKey);
  const dm = kit.d(o.roofKey);
  const dw = kit.d(o.woodKey);
  const NU = 8, NT = 5;
  const ew = w * 0.5 + ov, ed = d * 0.5 + ov;
  const q = 0.62;
  const tint = o.tint || 1;

  const yAt = (t, u) => y0 + rise - rise * Math.pow(t, q)
    + up * Math.pow(t, 4) * (0.3 + 0.7 * Math.pow(Math.abs(2 * u - 1), 2));

  const col = [tint, tint, tint];
  // The texture already contains 8 barrel tiles × 6 courses and the material
  // repeats it three times. A world-scale UV multiplier of 1.15 turned roofs
  // into dense blue pinstripes; this lands near two tiles per world unit.
  const us = 0.11;
  const roofU = ew * 2 * us;
  const roofV = Math.hypot(ed, rise) * us;
  const uv = [0, 0, 0, 0];

  // ---- the two long slopes ------------------------------------------------
  const eaveCurves = [];
  for (let side = -1; side <= 1; side += 2) {
    const grid = [];
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU;
      const rx = lerp(-rl * 0.5, rl * 0.5, u);
      const ex = lerp(-ew, ew, u);
      const row = [];
      for (let it = 0; it <= NT; it++) {
        const t = it / NT;
        row.push([lerp(rx, ex, t), yAt(t, u), side * t * ed]);
      }
      grid.push(row);
    }
    for (let iu = 0; iu < NU; iu++) {
      for (let it = 0; it < NT; it++) {
        uv[0] = (iu / NU) * roofU;
        uv[1] = (it / NT) * roofV;
        uv[2] = ((iu + 1) / NU) * roofU;
        uv[3] = ((it + 1) / NT) * roofV;
        rm.face(grid[iu][it], grid[iu + 1][it], grid[iu + 1][it + 1], grid[iu][it + 1],
          col, us, 0, [0, 1, side], uv);
      }
    }
    eaveCurves.push(grid.map((row) => row[NT]));
  }

  // ---- hip ends -----------------------------------------------------------
  if (hip) {
    for (let side = -1; side <= 1; side += 2) {
      const grid = [];
      for (let iu = 0; iu <= NU; iu++) {
        const u = iu / NU;
        const row = [];
        for (let it = 0; it <= NT; it++) {
          const t = it / NT;
          const x = lerp(side * rl * 0.5, side * ew, t);
          const z = lerp(0, lerp(-ed, ed, u), t);
          row.push([x, yAt(t, u), z]);
        }
        grid.push(row);
      }
      for (let iu = 0; iu < NU; iu++) {
        for (let it = 0; it < NT; it++) {
          uv[0] = (iu / NU) * (ed * 2 * us);
          uv[1] = (it / NT) * roofV;
          uv[2] = ((iu + 1) / NU) * (ed * 2 * us);
          uv[3] = ((it + 1) / NT) * roofV;
          rm.face(grid[iu][it], grid[iu + 1][it], grid[iu + 1][it + 1], grid[iu][it + 1],
            col, us, 0, [side, 1, 0], uv);
        }
      }
    }
  } else {
    // gable ends: fill the triangle under the ridge with the wall material
    const gm = kit.g(o.gableKey || o.woodKey);
    for (let side = -1; side <= 1; side += 2) {
      const x = side * (w * 0.5);
      const N = 5;
      for (let i = 0; i < N; i++) {
        const u0 = i / N, u1 = (i + 1) / N;
        const z0 = lerp(-d * 0.5, d * 0.5, u0), z1 = lerp(-d * 0.5, d * 0.5, u1);
        const y0a = yAt(Math.abs(z0) / (d * 0.5), 0.5);
        const y1a = yAt(Math.abs(z1) / (d * 0.5), 0.5);
        gm.face([x, y0, z0], [x, y0, z1], [x, Math.min(y1a, y0 + rise), z1], [x, Math.min(y0a, y0 + rise), z0],
          [tint * 0.96, tint * 0.96, tint * 0.96], 0.75, 0, [side, 0, 0]);
      }
      gm.box(x, y0 + rise * 0.5, 0, 0.12, rise, d * 0.16, WHITE, 0.8);
    }
  }

  // ---- ridge beam + end ornaments ----------------------------------------
  const ridgeY = y0 + rise;
  wm.box(0, ridgeY + 0.13, 0, rl + (hip ? 0.4 : ov * 2 + 0.3), 0.26, 0.34, [0.82, 0.8, 0.82], 1.2);
  wm.box(0, ridgeY + 0.3, 0, rl * 0.98, 0.12, 0.18, [0.7, 0.68, 0.72], 1.2);
  for (let s = -1; s <= 1; s += 2) {
    const ex = s * (rl * 0.5 + (hip ? 0.18 : ov));
    // 鸱吻: a wedge that curls back over the ridge
    wm.box(ex, ridgeY + 0.42, 0, 0.34, 0.5, 0.3, [0.72, 0.7, 0.74], 1.4);
    wm.box(ex - s * 0.12, ridgeY + 0.74, 0, 0.5, 0.24, 0.22, [0.72, 0.7, 0.74], 1.4, 0.06);
  }

  // ---- fascia + drip tiles along both long eaves ---------------------------
  for (let e = 0; e < eaveCurves.length; e++) {
    const curve = eaveCurves[e];
    const side = e === 0 ? -1 : 1;
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1];
      rm.face([a[0], a[1], a[2]], [b[0], b[1], b[2]],
        [b[0], b[1] - 0.16, b[2]], [a[0], a[1] - 0.16, a[2]],
        [tint * 0.86, tint * 0.86, tint * 0.9], 1.6, 0, [0, 0, side]);
    }
    // drip tiles (瓦当) — detail only
    const n = Math.max(4, Math.round(w / 0.62));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const fi = u * (curve.length - 1);
      const i0 = Math.min(curve.length - 2, Math.floor(fi));
      const f = fi - i0;
      const a = curve[i0], b = curve[i0 + 1];
      const x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f), z = lerp(a[2], b[2], f);
      dm.cyl(x, y - 0.19, z, 0.13, 0.13, 0.1, 6, [tint * 0.9, tint * 0.88, tint * 0.94], 2.2, true, false);
    }
  }

  // ---- 斗拱 brackets: stepped blocks carrying the overhang ------------------
  if (o.brackets !== false) {
    const step = Math.max(1.3, w / Math.max(2, Math.round(w / 1.7)));
    const bcol = [0.95, 0.9, 0.88];
    for (let side = -1; side <= 1; side += 2) {
      const z = side * (d * 0.5 - 0.06);
      for (let x = -w * 0.5 + step * 0.5; x <= w * 0.5 - step * 0.35; x += step) {
        const by = y0 - 0.12;
        dw.box(x, by, z + side * 0.06, 0.44, 0.2, 0.44, bcol, 1.6);
        dw.box(x, by + 0.2, z + side * 0.16, 0.86, 0.16, 0.34, bcol, 1.6);
        dw.box(x, by + 0.37, z + side * 0.3, 0.5, 0.16, 0.62, bcol, 1.6);
        dw.box(x, by + 0.53, z + side * 0.4, 1.02, 0.14, 0.3, bcol, 1.6);
      }
    }
    for (let side = -1; side <= 1; side += 2) {
      const x = side * (w * 0.5 - 0.06);
      const stepZ = Math.max(1.3, d / Math.max(2, Math.round(d / 1.7)));
      for (let z = -d * 0.5 + stepZ * 0.5; z <= d * 0.5 - stepZ * 0.35; z += stepZ) {
        const by = y0 - 0.12;
        dw.box(x + side * 0.06, by, z, 0.44, 0.2, 0.44, bcol, 1.6);
        dw.box(x + side * 0.16, by + 0.2, z, 0.34, 0.16, 0.86, bcol, 1.6);
        dw.box(x + side * 0.3, by + 0.37, z, 0.62, 0.16, 0.5, bcol, 1.6);
        dw.box(x + side * 0.4, by + 0.53, z, 0.3, 0.14, 1.02, bcol, 1.6);
      }
    }
  }
  void rng;
}

/** A thatched roof: thicker, shaggier, gabled, with a bound ridge. */
function addThatch(kit, o) {
  const w = o.w, d = o.d, y0 = o.y, rise = o.rise;
  const ov = o.ov !== undefined ? o.ov : 0.7;
  const m = kit.g(o.roofKey);
  const wm = kit.g(o.woodKey);
  const rng = o.rng;
  const NU = 7, NT = 4;
  const ew = w * 0.5 + ov, ed = d * 0.5 + ov;
  const us = 0.16;
  const roofU = ew * 2 * us;
  const roofV = Math.hypot(ed, rise) * us;
  const uv = [0, 0, 0, 0];

  for (let side = -1; side <= 1; side += 2) {
    const grid = [];
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU;
      const row = [];
      for (let it = 0; it <= NT; it++) {
        const t = it / NT;
        // sag + a wobbly edge so the straw never looks extruded
        const wob = (hash3(iu, it, side + 7) - 0.5) * 0.16 * t;
        row.push([
          lerp(-w * 0.5 - ov * 0.2, ew, u) + wob,
          y0 + rise - rise * Math.pow(t, 0.78) + wob * 0.4,
          side * t * ed + wob,
        ]);
      }
      grid.push(row);
    }
    for (let iu = 0; iu < NU; iu++) {
      for (let it = 0; it < NT; it++) {
        uv[0] = (iu / NU) * roofU;
        uv[1] = (it / NT) * roofV;
        uv[2] = ((iu + 1) / NU) * roofU;
        uv[3] = ((it + 1) / NT) * roofV;
        m.face(grid[iu][it], grid[iu + 1][it], grid[iu + 1][it + 1], grid[iu][it + 1],
          [1, 1, 1], us, 0, [0, 1, side], uv);
      }
    }
    // thick cut edge at the eave
    for (let iu = 0; iu < NU; iu++) {
      const a = grid[iu][NT], b = grid[iu + 1][NT];
      m.face([a[0], a[1], a[2]], [b[0], b[1], b[2]],
        [b[0], b[1] - 0.3, b[2]], [a[0], a[1] - 0.3, a[2]], [0.85, 0.82, 0.75], 1.3, 0, [0, 0, side]);
    }
  }
  // gable ends
  const gm = kit.g(o.gableKey || o.woodKey);
  for (let side = -1; side <= 1; side += 2) {
    const x = side * (w * 0.5);
    const N = 4;
    for (let i = 0; i < N; i++) {
      const z0 = lerp(-d * 0.5, d * 0.5, i / N), z1 = lerp(-d * 0.5, d * 0.5, (i + 1) / N);
      const t0 = Math.abs(z0) / (d * 0.5), t1 = Math.abs(z1) / (d * 0.5);
      gm.face([x, y0, z0], [x, y0, z1],
        [x, y0 + rise - rise * Math.pow(t1, 0.78), z1],
        [x, y0 + rise - rise * Math.pow(t0, 0.78), z0], [0.94, 0.94, 0.94], 0.7, 0, [side, 0, 0]);
    }
  }
  // ridge: a bound straw bundle, pinned down by crossed poles
  wm.box(0, y0 + rise + 0.12, 0, w + ov, 0.22, 0.46, [0.9, 0.86, 0.74], 1.1, 0, 0.06);
  const bands = Math.max(2, Math.round(w / 2.2));
  for (let i = 0; i <= bands; i++) {
    const x = lerp(-w * 0.5, w * 0.5, i / bands);
    kit.d(o.woodKey).box(x, y0 + rise + 0.16, 0, 0.09, 0.3, d * 0.55, [0.7, 0.62, 0.5], 2);
  }
  void rng;
}

/**
 * Raised stone plinth with a moulded step course, plus optional front stairs.
 * @returns {number} the plinth top height
 */
function addPlinth(kit, o) {
  const m = kit.g(o.key);
  const h = o.h !== undefined ? o.h : 0.55;
  const w = o.w, d = o.d;
  m.box(0, h * 0.34, 0, w + 0.9, h * 0.68, d + 0.9, [0.94, 0.93, 0.92], 0.55);
  m.box(0, h * 0.83, 0, w + 0.5, h * 0.34, d + 0.5, [1.02, 1.01, 1.0], 0.55);
  if (o.outline) {
    // When the upper structure reveals the player, retain a knee-low dressed
    // stone outline. It gives the exposed floor a readable architectural edge
    // without putting any new mass in front of the character.
    const rim = kit.d(o.key);
    // A shallow, lighter ashlar inset breaks up the rain-darkened brick slab.
    // Its top is only five centimetres above navigation height, so feet stay
    // grounded while the revealed interior no longer reads as a black void.
    const floor = kit.g(mk('stoneWall', 0xa6987d));
    floor.box(0, h + 0.025, 0, w - 0.22, 0.05, d - 0.22, [1.08, 1.06, 1.0], 0.72);
    const rw = w + 0.58, rd = d + 0.58;
    const ry = h + 0.045;
    const rc = [1.12, 1.08, 0.98];
    rim.box(0, ry, -rd * 0.5, rw, 0.09, 0.16, rc, 0.8);
    rim.box(0, ry, rd * 0.5, rw, 0.09, 0.16, rc, 0.8);
    rim.box(-rw * 0.5, ry, 0, 0.16, 0.09, rd, rc, 0.8);
    rim.box(rw * 0.5, ry, 0, 0.16, 0.09, rd, rc, 0.8);
  }
  // corner blocks read as dressed stone
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      kit.d(o.key).box(sx * (w * 0.5 + 0.28), h * 0.5, sz * (d * 0.5 + 0.28),
        0.7, h * 1.02, 0.7, [0.88, 0.87, 0.86], 0.7);
    }
  }
  if (o.steps) {
    const sw = o.stepWidth || Math.min(w * 0.5, 3.2);
    const sz = o.stepSide || 1;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      m.box(o.stepX || 0, h * (1 - t) * 0.5, sz * (d * 0.5 + 0.45 + i * 0.42),
        sw - i * 0.12, h * (1 - t), 0.45, [0.97, 0.96, 0.95], 0.7);
    }
  }
  return h;
}

/**
 * Timber-frame walls: visible corner + intermediate posts, a lintel band under
 * the eave, a plinth-level sill, plaster infill, and paper screen windows with
 * lattice mullions. Returns the door's local centre so the caller can register
 * an interactable.
 *
 * @param {Kit} kit
 * @param {object} o {w,d,y,h,postKey,infillKey,paperKey,rng,door,windows,
 *                    doorSide, tint}
 */
function addTimberWalls(kit, o) {
  const w = o.w, d = o.d, y = o.y, h = o.h;
  const pm = kit.g(o.postKey);
  const im = kit.g(o.infillKey);
  const rng = o.rng;
  const post = 0.26;
  const doorH = Math.min(h * 0.72, 2.5);
  const sill = 0.9, head = Math.min(h - 0.5, 2.35);

  // --- posts ---------------------------------------------------------------
  const xs = [];
  const nx = Math.max(2, Math.round(w / 2.4));
  for (let i = 0; i <= nx; i++) xs.push(lerp(-w * 0.5, w * 0.5, i / nx));
  const zs = [];
  const nz = Math.max(2, Math.round(d / 2.4));
  for (let i = 0; i <= nz; i++) zs.push(lerp(-d * 0.5, d * 0.5, i / nz));

  for (const x of xs) {
    for (const sz of [-1, 1]) {
      pm.box(x, y + h * 0.5, sz * d * 0.5, post, h, post, jit(rng, 0.1), 1.0, 0, 0.02);
    }
  }
  for (const z of zs) {
    for (const sx of [-1, 1]) {
      pm.box(sx * w * 0.5, y + h * 0.5, z, post, h, post, jit(rng, 0.1), 1.0, 0, 0.02);
    }
  }

  // --- lintels and sills ---------------------------------------------------
  for (const sz of [-1, 1]) {
    pm.box(0, y + h - 0.2, sz * d * 0.5, w + 0.1, 0.3, post * 1.15, [0.95, 0.92, 0.9], 1.0);
    pm.box(0, y + 0.16, sz * d * 0.5, w + 0.05, 0.24, post * 1.1, [0.88, 0.86, 0.84], 1.0);
    pm.box(0, y + head, sz * d * 0.5, w, 0.16, post * 1.05, [0.92, 0.9, 0.88], 1.0);
  }
  for (const sx of [-1, 1]) {
    pm.box(sx * w * 0.5, y + h - 0.2, 0, post * 1.15, 0.3, d + 0.1, [0.95, 0.92, 0.9], 1.0);
    pm.box(sx * w * 0.5, y + 0.16, 0, post * 1.1, 0.24, d + 0.05, [0.88, 0.86, 0.84], 1.0);
  }

  // --- infill panels -------------------------------------------------------
  const front = o.doorSide === undefined ? 1 : o.doorSide;
  const panel = (x0, x1, sz) => {
    const cx = (x0 + x1) * 0.5, pw = x1 - x0;
    if (pw <= 0.05) return;
    im.box(cx, y + h * 0.5, sz * (d * 0.5 - 0.03), pw, h, 0.2, jit(rng, 0.07), 0.75);
  };
  /** Infill with a window hole punched between `sill` and `head`. */
  const panelHole = (x0, x1, sz) => {
    const cx = (x0 + x1) * 0.5, pw = x1 - x0;
    if (pw <= 0.05) return;
    im.box(cx, y + sill * 0.5, sz * (d * 0.5 - 0.03), pw, sill, 0.2, jit(rng, 0.07), 0.75);
    if (h - head > 0.05) {
      im.box(cx, y + head + (h - head) * 0.5, sz * (d * 0.5 - 0.03), pw, h - head, 0.2,
        jit(rng, 0.07), 0.75);
    }
  };
  const panelHoleZ = (z0, z1, sx) => {
    const cz = (z0 + z1) * 0.5, pw = z1 - z0;
    if (pw <= 0.05) return;
    im.box(sx * (w * 0.5 - 0.03), y + sill * 0.5, cz, 0.2, sill, pw, jit(rng, 0.07), 0.75);
    if (h - head > 0.05) {
      im.box(sx * (w * 0.5 - 0.03), y + head + (h - head) * 0.5, cz, 0.2, h - head, pw,
        jit(rng, 0.07), 0.75);
    }
  };

  // the bay nearest the centre of the front wall becomes the doorway, and the
  // leaf width follows that bay — a fixed 2.2m door never fits a 2.0m bay
  let doorBay = 0, bestAbs = Infinity;
  for (let i = 0; i < xs.length - 1; i++) {
    const a = Math.abs((xs[i] + xs[i + 1]) * 0.5);
    if (a < bestAbs) { bestAbs = a; doorBay = i; }
  }
  const doorBayW = (xs[doorBay + 1] - post * 0.5) - (xs[doorBay] + post * 0.5);
  const doorW = clamp(doorBayW - 0.34, 0.9, 2.3);

  const windows = [];
  for (const sz of [-1, 1]) {
    const isFront = sz === front;
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i] + post * 0.5, x1 = xs[i + 1] - post * 0.5;
      const cx = (x0 + x1) * 0.5;
      const isDoor = isFront && o.door !== false && i === doorBay && (x1 - x0) > doorW + 0.1;
      if (isDoor) {
        // leave the doorway open: side jambs + a header panel
        panel(x0, cx - doorW * 0.5, sz);
        panel(cx + doorW * 0.5, x1, sz);
        im.box(cx, y + doorH + (h - doorH) * 0.5, sz * (d * 0.5 - 0.03),
          doorW, h - doorH, 0.2, jit(rng, 0.07), 0.75);
        addDoor(kit, {
          x: cx, y, z: sz * (d * 0.5 - 0.02), w: doorW, h: doorH,
          key: o.postKey, faceZ: sz, rng,
        });
        o.doorAt = [cx, y + doorH * 0.5, sz * (d * 0.5 + 0.1)];
      } else if (o.windows !== false && (x1 - x0) > 0.9 && head > sill + 0.6 && h > head) {
        panelHole(x0, x1, sz);
        windows.push([cx, (x1 - x0) - 0.28, sz, 0]);
      } else {
        panel(x0, x1, sz);
      }
    }
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < zs.length - 1; i++) {
      const z0 = zs[i] + post * 0.5, z1 = zs[i + 1] - post * 0.5;
      const cz = (z0 + z1) * 0.5, pw = z1 - z0;
      if (pw <= 0.05) continue;
      if (o.windows !== false && pw > 1.1 && head > sill + 0.6 && h > head) {
        panelHoleZ(z0, z1, sx);
        windows.push([cz, pw - 0.28, sx, 1]);
      } else {
        im.box(sx * (w * 0.5 - 0.03), y + h * 0.5, cz, 0.2, h, pw, jit(rng, 0.07), 0.75);
      }
    }
  }

  // --- paper screens with lattice mullions ---------------------------------
  if (o.paperKey) {
    const paper = kit.g(o.paperKey);
    const lat = kit.d(o.postKey);
    for (const win of windows) {
      const [c, pw, side, axis] = win;
      const wh = head - sill;
      const px = axis === 0 ? c : side * (w * 0.5 - 0.12);
      const pz = axis === 0 ? side * (d * 0.5 - 0.12) : c;
      const sx = axis === 0 ? pw : 0.06;
      const szz = axis === 0 ? 0.06 : pw;
      paper.box(px, y + sill + wh * 0.5, pz, sx, wh, szz, [1, 1, 1], 0.9);
      // frame
      lat.box(px, y + sill + wh * 0.5, pz, sx + 0.14, wh + 0.14, szz + 0.14, [0.9, 0.86, 0.82], 1.4, 0, 0.0);
      // mullions: 3 vertical x 4 horizontal
      const cols = 3, rows = Math.max(2, Math.round(wh / 0.45));
      for (let i = 1; i < cols; i++) {
        const t = i / cols;
        const mx = axis === 0 ? lerp(c - pw * 0.5, c + pw * 0.5, t) : px;
        const mz = axis === 0 ? pz : lerp(c - pw * 0.5, c + pw * 0.5, t);
        lat.box(mx, y + sill + wh * 0.5, mz, axis === 0 ? 0.05 : 0.1, wh, axis === 0 ? 0.1 : 0.05,
          [0.85, 0.8, 0.76], 2);
      }
      for (let j = 1; j < rows; j++) {
        const my = y + sill + wh * (j / rows);
        lat.box(px, my, pz, axis === 0 ? pw : 0.1, 0.05, axis === 0 ? 0.1 : pw, [0.85, 0.8, 0.76], 2);
      }
    }
  }
  return o.doorAt || null;
}

/** A pair of recessed door leaves with a stud pattern and a ring handle. */
function addDoor(kit, o) {
  const m = kit.g(o.key);
  const dm = kit.d(o.key);
  const leaf = o.w * 0.5 - 0.03;
  for (let s = -1; s <= 1; s += 2) {
    m.box(o.x + s * (leaf * 0.5 + 0.02), o.y + o.h * 0.5, o.z,
      leaf, o.h, 0.12, [0.72, 0.6, 0.55], 1.1);
  }
  // frame
  m.box(o.x, o.y + o.h + 0.09, o.z, o.w + 0.3, 0.18, 0.2, [0.95, 0.9, 0.86], 1.2);
  for (let s = -1; s <= 1; s += 2) {
    m.box(o.x + s * (o.w * 0.5 + 0.1), o.y + o.h * 0.5, o.z, 0.2, o.h, 0.2, [0.95, 0.9, 0.86], 1.2);
  }
  // door studs + ring pulls
  for (let s = -1; s <= 1; s += 2) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        dm.cyl(o.x + s * (0.18 + c * 0.24), o.y + 0.55 + r * 0.55, o.z + o.faceZ * 0.07,
          0.045, 0.04, 0.05, 5, [1.25, 1.15, 0.9], 2, true, false);
      }
    }
    dm.cyl(o.x + s * 0.16, o.y + o.h * 0.48, o.z + o.faceZ * 0.08, 0.11, 0.11, 0.03, 8,
      [1.3, 1.15, 0.85], 2, true, false);
  }
  void o.rng;
}

/** Round lacquered column on a stone drum, with a bracket capital. */
function addColumn(kit, o) {
  const m = kit.g(o.key);
  const bm = kit.g(o.baseKey || o.key);
  const h = o.h, r = o.r;
  bm.cyl(o.x, o.y, o.z, r * 1.5, r * 1.35, 0.16, 10, [0.95, 0.94, 0.92], 1.2, true, false);
  bm.cyl(o.x, o.y + 0.16, o.z, r * 1.25, r * 1.18, 0.14, 10, [1.0, 0.99, 0.97], 1.2, true, false);
  m.cyl(o.x, o.y + 0.3, o.z, r, r * 0.9, h - 0.3, 10, [1, 1, 1], 0.9, false, false);
  if (o.capital !== false) {
    const cm = kit.d(o.capKey || o.key);
    cm.box(o.x, o.y + h + 0.08, o.z, r * 2.4, 0.16, r * 2.4, [0.95, 0.92, 0.9], 1.4);
    cm.box(o.x, o.y + h + 0.26, o.z, r * 3.4, 0.2, r * 1.6, [0.95, 0.92, 0.9], 1.4);
    cm.box(o.x, o.y + h + 0.26, o.z, r * 1.6, 0.2, r * 3.4, [0.95, 0.92, 0.9], 1.4);
  }
}

/** Crenellated parapet along a wall top. */
function addCrenels(kit, key, x0, x1, z, y, thick, rng) {
  const m = kit.g(key);
  const len = x1 - x0;
  const n = Math.max(1, Math.round(len / 1.7));
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 + step * (i + 0.5);
    m.box(cx, y + 0.42, z, step * 0.62, 0.84, thick, jit(rng, 0.1), 0.7, 0, 0.03);
  }
  m.box((x0 + x1) * 0.5, y - 0.1, z, len, 0.22, thick * 1.25, [0.92, 0.91, 0.9], 0.7);
}

/**
 * Semi-circular voussoir arch: an annulus in the XY plane extruded along Z.
 * Draws the soffit, both faces (with per-voussoir tint so the joints read) and
 * the outer ring. The opening itself is left empty — callers build the wall
 * around it.
 * @param {object} o {x, z, span, springY, thick, d, rng}
 */
function addArch(kit, key, o) {
  const m = kit.g(key);
  const r = o.span * 0.5, y0 = o.springY, R = r + o.thick;
  const hz = o.d * 0.5;
  const n = 12;
  const pt = (a, rad) => [o.x - Math.cos(a) * rad, y0 + Math.sin(a) * rad];
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI * (i / n), a1 = Math.PI * ((i + 1) / n);
    const i0 = pt(a0, r), i1 = pt(a1, r);
    const o0 = pt(a0, R), o1 = pt(a1, R);
    const c = jit(o.rng, 0.16);
    // soffit (faces down into the opening)
    m.face([i0[0], i0[1], o.z - hz], [i1[0], i1[1], o.z - hz],
      [i1[0], i1[1], o.z + hz], [i0[0], i0[1], o.z + hz], c, 0.9, 0,
      [-Math.cos((a0 + a1) * 0.5), -Math.sin((a0 + a1) * 0.5), 0]);
    // extrados
    m.face([o0[0], o0[1], o.z - hz], [o1[0], o1[1], o.z - hz],
      [o1[0], o1[1], o.z + hz], [o0[0], o0[1], o.z + hz], c, 0.9, 0,
      [Math.cos((a0 + a1) * 0.5), Math.sin((a0 + a1) * 0.5), 0]);
    // both faces
    for (let s = -1; s <= 1; s += 2) {
      m.face([i0[0], i0[1], o.z + s * hz], [i1[0], i1[1], o.z + s * hz],
        [o1[0], o1[1], o.z + s * hz], [o0[0], o0[1], o.z + s * hz], c, 0.9, 0, [0, 0, s]);
    }
    // keystone flare
    if (i === (n >> 1) - 1 || i === (n >> 1)) {
      const km = kit.d(key);
      km.box(o.x + (i < n / 2 ? -0.12 : 0.12), y0 + R + 0.12, o.z, 0.3, 0.42, o.d * 1.04,
        [1.05, 1.02, 1.0], 1.1);
    }
  }
}

/** A lumpy rock mass with a noisy crown — cave and lava "walls". */
function addRockMass(m, w, d, h, rng, tint) {
  const nx = clamp(Math.round(w / 2.2), 1, 9);
  const nz = clamp(Math.round(d / 2.2), 1, 9);
  const hAt = (i, j) => {
    const n = hash3(i * 7 + 3, j * 13 + 5, 17);
    const edge = Math.min(i, nx - i, j, nz - j) / Math.max(1, Math.min(nx, nz) * 0.5);
    return h * (0.72 + 0.34 * n) * (0.72 + 0.42 * clamp01(edge));
  };
  const px = (i) => lerp(-w * 0.5, w * 0.5, i / nx);
  const pz = (j) => lerp(-d * 0.5, d * 0.5, j / nz);
  const jx = (i, j) => (i === 0 || i === nx) ? 0 : (hash3(i, j, 31) - 0.5) * 0.5;
  const jz = (i, j) => (j === 0 || j === nz) ? 0 : (hash3(i, j, 47) - 0.5) * 0.5;

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = [tint * (0.86 + hash3(i, j, 5) * 0.3), tint * (0.86 + hash3(i, j, 6) * 0.3),
        tint * (0.86 + hash3(i, j, 7) * 0.3)];
      m.face(
        [px(i) + jx(i, j), hAt(i, j), pz(j) + jz(i, j)],
        [px(i + 1) + jx(i + 1, j), hAt(i + 1, j), pz(j) + jz(i + 1, j)],
        [px(i + 1) + jx(i + 1, j + 1), hAt(i + 1, j + 1), pz(j + 1) + jz(i + 1, j + 1)],
        [px(i) + jx(i, j + 1), hAt(i, j + 1), pz(j + 1) + jz(i, j + 1)],
        c, 0.5, 0, [0, 1, 0]);
    }
  }
  // skirts
  for (let i = 0; i < nx; i++) {
    for (const s of [-1, 1]) {
      const j = s < 0 ? 0 : nz;
      const c = [tint * (0.8 + hash3(i, s, 9) * 0.3), tint * (0.8 + hash3(i, s, 10) * 0.3),
        tint * (0.8 + hash3(i, s, 11) * 0.3)];
      m.face([px(i), 0, pz(j)], [px(i + 1), 0, pz(j)],
        [px(i + 1) + jx(i + 1, j), hAt(i + 1, j), pz(j) + jz(i + 1, j)],
        [px(i) + jx(i, j), hAt(i, j), pz(j) + jz(i, j)], c, 0.5, 0, [0, 0, s]);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (const s of [-1, 1]) {
      const i = s < 0 ? 0 : nx;
      const c = [tint * (0.8 + hash3(j, s, 12) * 0.3), tint * (0.8 + hash3(j, s, 13) * 0.3),
        tint * (0.8 + hash3(j, s, 14) * 0.3)];
      m.face([px(i), 0, pz(j)], [px(i), 0, pz(j + 1)],
        [px(i) + jx(i, j + 1), hAt(i, j + 1), pz(j + 1) + jz(i, j + 1)],
        [px(i) + jx(i, j), hAt(i, j), pz(j) + jz(i, j)], c, 0.5, 0, [s, 0, 0]);
    }
  }
  void rng;
}

/* ========================================================================== *
 * 5. Structure builders — unique geometry, local space, +Y up, origin centred
 * ========================================================================== */

/** 城墙 — battered curtain wall with a string course, walk and crenellations. */
function buildWallTown(B) {
  const s = B.s, st = B.st, kit = B.kit, rng = B.rng;
  const w = s.w || 3, d = s.d || 3, h = s.h || 6;
  const natural = s.style === 'cave' || s.style === 'lava';
  const key = mk(st.wall[0], st.wall[1]);

  if (natural) {
    addRockMass(kit.g(key), w, d, h, rng, st.tint);
    return;
  }

  const m = kit.g(key);
  const along = w >= d;
  const inset = Math.min(0.22, Math.min(w, d) * 0.09);
  m.box(0, h * 0.5, 0, w, h, d, [1, 1, 1], 0.55, 0, inset);
  // string course two thirds up
  m.box(0, h * 0.66, 0, w + 0.22, 0.2, d + 0.22, [0.92, 0.91, 0.9], 0.7);
  // wall walk
  const capW = w - inset * 1.4, capD = d - inset * 1.4;
  m.box(0, h + 0.06, 0, capW + 0.3, 0.14, capD + 0.3, [0.96, 0.95, 0.94], 0.6);

  if (s.tower) {
    const th = h;
    m.box(0, th + 1.2, 0, capW * 0.94, 2.3, capD * 0.94, [1, 1, 1], 0.55, 0, 0.12);
    m.box(0, th + 2.45, 0, capW + 0.5, 0.2, capD + 0.5, [0.95, 0.94, 0.93], 0.6);
    for (const sz of [-1, 1]) {
      addCrenels(kit, key, -capW * 0.5, capW * 0.5, sz * (capD * 0.5 + 0.12), th + 2.55, 0.36, rng);
    }
    addRoof(kit, {
      w: capW + 1.1, d: capD + 1.1, y: th + 3.3, rise: Math.max(1.1, capW * 0.34),
      ov: 0.75, hip: true, ridgeFrac: 0.34, rng,
      roofKey: mk(st.roof[0], st.roof[1]), woodKey: mk(st.trim[0], st.trim[1]),
      tint: st.tint, brackets: true,
    });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        kit.d(mk(st.post[0], st.post[1])).box(sx * capW * 0.42, th + 3.0, sz * capD * 0.42,
          0.2, 1.6, 0.2, [1, 1, 1], 1.2);
      }
    }
    return;
  }

  // crenellated parapet down both long sides
  if (along) {
    for (const sz of [-1, 1]) {
      addCrenels(kit, key, -capW * 0.5, capW * 0.5, sz * (capD * 0.5 - 0.16), h + 0.16, 0.34, rng);
    }
    // arrow slits
    const dm = kit.d(key);
    const n = Math.max(1, Math.round(w / 4.5));
    for (let i = 0; i < n; i++) {
      const x = lerp(-w * 0.4, w * 0.4, n === 1 ? 0.5 : i / (n - 1));
      for (const sz of [-1, 1]) {
        dm.box(x, h * 0.62, sz * (d * 0.5 + 0.02), 0.16, 0.7, 0.1, [0.35, 0.34, 0.33], 1.4);
      }
    }
  } else {
    for (const sx of [-1, 1]) {
      const mm = kit.g(key);
      const len = capD;
      const n = Math.max(1, Math.round(len / 1.7));
      const step = len / n;
      for (let i = 0; i < n; i++) {
        mm.box(sx * (capW * 0.5 - 0.16), h + 0.58, -len * 0.5 + step * (i + 0.5),
          0.34, 0.84, step * 0.62, jit(rng, 0.1), 0.7, 0, 0.03);
      }
      mm.box(sx * (capW * 0.5 - 0.16), h + 0.06, 0, 0.42, 0.22, len, [0.92, 0.91, 0.9], 0.7);
    }
  }
}

/** 城门 — twin piers, a voussoir arch, and a gatehouse with a tiled roof. */
function buildGateTown(B) {
  const s = B.s, st = B.st, kit = B.kit, rng = B.rng;
  const span = s.span || 8;
  const thick = Math.max(2.2, (s.d && s.w) ? Math.min(s.w, s.d) : 2.5);
  const h = s.h || 10;
  const key = mk(st.wall[0], st.wall[1]);
  const woodKey = mk(st.trim[0], st.trim[1]);
  const m = kit.g(key);

  const pierW = 1.5;
  const outer = span * 0.5 + 2.4;
  const springY = h * 0.42;

  // piers either side of the opening
  for (const sx of [-1, 1]) {
    m.box(sx * (span * 0.5 + (outer - span * 0.5) * 0.5), h * 0.5, 0,
      outer - span * 0.5, h, thick, [1, 1, 1], 0.55, 0, 0.16);
    B.blocker(sx * (span * 0.5 + pierW * 0.5), 0, pierW * 0.55);
  }

  addArch(kit, key, {
    x: 0, z: 0, span, springY, thick: 0.55, d: thick + 0.1, rng,
  });
  // spandrel: wall above the arch up to the gatehouse floor
  const archTop = springY + span * 0.5 + 0.55;
  m.box(0, (archTop + h) * 0.5, 0, span + 1.1, Math.max(0.2, h - archTop), thick, [1, 1, 1], 0.55);
  // jamb reveals
  for (const sx of [-1, 1]) {
    m.box(sx * (span * 0.5 + 0.28), springY * 0.5, 0, 0.56, springY, thick, [0.95, 0.94, 0.93], 0.7);
  }

  // wall walk + crenellations
  m.box(0, h + 0.1, 0, outer * 2, 0.2, thick + 0.5, [0.96, 0.95, 0.94], 0.6);
  for (const sz of [-1, 1]) {
    addCrenels(kit, key, -outer, outer, sz * (thick * 0.5 + 0.12), h + 0.28, 0.36, rng);
  }

  // gatehouse
  const gw = span + 3.4, gd = thick + 2.2, gh = 3.1;
  const gy = h + 0.9;
  m.box(0, gy + gh * 0.5, 0, gw, gh, gd, [1, 1, 1], 0.6, 0, 0.1);
  const pm = kit.g(mk(st.post[0], st.post[1]));
  const nBay = Math.max(3, Math.round(gw / 1.9));
  for (let i = 0; i <= nBay; i++) {
    const x = lerp(-gw * 0.5, gw * 0.5, i / nBay);
    for (const sz of [-1, 1]) pm.box(x, gy + gh * 0.5, sz * gd * 0.5, 0.22, gh, 0.24, jit(rng, 0.1), 1);
  }
  for (const sz of [-1, 1]) {
    pm.box(0, gy + gh - 0.18, sz * gd * 0.5, gw, 0.3, 0.3, [0.95, 0.92, 0.9], 1);
    // railing
    kit.d(mk(st.post[0], st.post[1])).box(0, gy + 1.0, sz * (gd * 0.5 + 0.16), gw, 0.1, 0.12, [0.9, 0.85, 0.8], 1.6);
  }
  addRoof(kit, {
    w: gw + 0.6, d: gd + 0.6, y: gy + gh, rise: Math.max(1.4, gw * 0.17), ov: 1.15,
    hip: true, ridgeFrac: 0.5, rng,
    roofKey: mk(st.roof[0], st.roof[1]), woodKey, tint: st.tint, brackets: true,
  });

  // 匾额 plaque over the arch
  kit.d(woodKey).box(0, archTop + 0.75, thick * 0.5 + 0.12, span * 0.5, 0.9, 0.16, [1.1, 0.95, 0.7], 1.2);

  // torches on the piers
  for (const sx of [-1, 1]) {
    const tx = sx * (span * 0.5 + 0.7);
    addTorchHead(kit, woodKey, mk(st.metal, null), tx, springY + 1.5, thick * 0.5 + 0.1, 0, rng);
    B.light(tx, springY + 2.15, thick * 0.5 + 0.42, { color: 0xff9a44, intensity: 3.2, distance: 13 });
    B.fx('torch.flame', tx, springY + 2.15, thick * 0.5 + 0.42);
  }
}

/** Wall torch head: bracket, shaft, iron basket, emissive flame cone. */
function addTorchHead(kit, woodKey, metalKey, x, y, z, faceZ, rng) {
  const wm = kit.g(woodKey);
  const mm = kit.g(metalKey);
  const dz = faceZ === 0 ? 1 : faceZ;
  wm.box(x, y, z + dz * 0.12, 0.12, 0.12, 0.34, [0.9, 0.86, 0.8], 1.4);
  wm.box(x, y + 0.3, z + dz * 0.3, 0.1, 0.62, 0.1, [0.92, 0.88, 0.82], 1.4);
  mm.lathe(x, y + 0.55, z + dz * 0.3,
    [[0.05, 0], [0.14, 0.1], [0.17, 0.26], [0.13, 0.3]], 8, [1, 1, 1], 1.6);
  const fm = kit.g('__flame');
  fm.cyl(x, y + 0.62, z + dz * 0.3, 0.13, 0.02, 0.42, 6, [1, 0.72, 0.3], 1, true, false);
  fm.cyl(x, y + 0.6, z + dz * 0.3, 0.08, 0.03, 0.2, 6, [1, 0.95, 0.72], 1, true, false);
  void rng;
}

/**
 * The workhorse building: house / shop / inn. Plinth, timber frame, paper
 * screens, curved tiled (or thatched) roof, optional shop sign and awning,
 * optional upper storey.
 */
function buildBuilding(B, kind) {
  const s = B.s, st = B.st, kit = B.kit, rng = B.rng;
  const w = Math.max(4, s.w || 8), d = Math.max(4, s.d || 6);
  const total = s.h || 6;
  const thatched = kind === 'house.thatch';
  const twoStorey = kind === 'inn' && total >= 7.5;
  const plinthH = thatched ? 0.34 : 0.5;
  const wallH = clamp((twoStorey ? total * 0.46 : total * 0.62), 2.3, 4.2);

  addPlinth(kit, {
    key: mk(st.plinth[0], st.plinth[1]), w, d, h: plinthH,
    steps: true, stepSide: 1, stepWidth: Math.min(w * 0.45, 3.0), outline: true,
  });

  const doorAt = addTimberWalls(kit, {
    w, d, y: plinthH, h: wallH,
    postKey: mk(st.post[0], st.post[1]),
    infillKey: mk(st.infill[0], st.infill[1]),
    paperKey: thatched ? null : 'paperScreen',
    rng, doorSide: 1, windows: true,
  });

  let roofY = plinthH + wallH;
  if (twoStorey) {
    // 腰檐 skirt roof, then the upper storey and its balcony
    addRoof(kit, {
      w: w + 0.5, d: d + 0.5, y: roofY, rise: 0.9, ov: 1.15, hip: true, ridgeFrac: 0.62, rng,
      roofKey: mk(st.roof[0], st.roof[1]), woodKey: mk(st.trim[0], st.trim[1]),
      tint: st.tint, brackets: true,
    });
    const upH = clamp(total - wallH - plinthH - 1.0, 2.0, 3.4);
    const uw = w - 1.0, ud = d - 1.0;
    roofY += 0.95;
    addTimberWalls(kit, {
      w: uw, d: ud, y: roofY, h: upH,
      postKey: mk(st.post[0], st.post[1]),
      infillKey: mk(st.infill[0], st.infill[1]),
      paperKey: 'paperScreen', rng, doorSide: 1, door: false, windows: true,
    });
    // balcony railing round the skirt roof
    const rm = kit.d(mk(st.post[0], st.post[1]));
    for (const sz of [-1, 1]) {
      rm.box(0, roofY + 0.45, sz * (d * 0.5 - 0.1), w - 0.4, 0.1, 0.1, [0.9, 0.85, 0.8], 1.6);
      rm.box(0, roofY + 0.85, sz * (d * 0.5 - 0.1), w - 0.4, 0.12, 0.14, [0.9, 0.85, 0.8], 1.6);
      const n = Math.max(3, Math.round(w / 0.8));
      for (let i = 0; i <= n; i++) {
        rm.box(lerp(-w * 0.5 + 0.2, w * 0.5 - 0.2, i / n), roofY + 0.5, sz * (d * 0.5 - 0.1),
          0.07, 0.8, 0.07, [0.88, 0.83, 0.78], 1.8);
      }
    }
    roofY += upH;
  }

  const roofRise = clamp(Math.min(w, d) * (thatched ? 0.46 : 0.34), 1.2, 3.2);
  if (thatched) {
    addThatch(kit, {
      w, d, y: roofY, rise: roofRise, ov: 0.8, rng,
      roofKey: mk('thatch', null), woodKey: mk(st.trim[0], st.trim[1]),
      gableKey: mk(st.infill[0], st.infill[1]),
    });
  } else {
    addRoof(kit, {
      w, d, y: roofY, rise: roofRise, ov: 1.0, hip: kind !== 'house.tiled' || w > d * 1.4,
      ridgeFrac: 0.52, rng,
      roofKey: mk(st.roof[0], st.roof[1]), woodKey: mk(st.trim[0], st.trim[1]),
      gableKey: mk(st.infill[0], st.infill[1]), tint: st.tint, brackets: true,
    });
  }

  // chimney + hearth smoke
  if (kind !== 'shop') {
    const cx = -w * 0.28, cz = -d * 0.2;
    kit.g(mk(st.plinth[0], st.plinth[1])).box(cx, roofY + roofRise * 0.6, cz, 0.6, roofRise * 1.3, 0.6,
      [0.9, 0.88, 0.86], 0.9, 0, 0.05);
    B.fx('chimney.smoke', cx, roofY + roofRise * 1.25, cz);
  }

  // shop dressing: awning over the door plus a hanging sign board
  if (kind === 'shop' || kind === 'inn') {
    const am = kit.g(mk(st.trim[0], st.trim[1]));
    const az = d * 0.5 + 0.95;
    for (const sx of [-1, 1]) {
      am.box(sx * (w * 0.26), plinthH + 1.2, az, 0.16, 2.4, 0.16, [0.95, 0.9, 0.85], 1.2);
    }
    const cm = kit.g('banner');
    cm.face([-w * 0.32, plinthH + wallH * 0.86, d * 0.5 + 0.1],
      [w * 0.32, plinthH + wallH * 0.86, d * 0.5 + 0.1],
      [w * 0.32, plinthH + 2.42, az + 0.25], [-w * 0.32, plinthH + 2.42, az + 0.25],
      [1, 1, 1], 0.8, 0, [0, 1, 1]);
    if (s.sign) {
      B.sign(s.sign, w * 0.5 - 0.55, plinthH + wallH * 0.62, d * 0.5 + 0.28);
    }
  }

  if (doorAt) {
    B.interact({
      kind: 'door', label: s.sign ? `${s.sign}` : '木门',
      x: doorAt[0], y: doorAt[1], z: doorAt[2], radius: 1.9,
      use: () => {
        bus.emit('audio:sfx', { id: 'door' });
        bus.emit('chat', { text: s.sign ? `【${s.sign}】的门开着，掌柜就在门口。` : '门从里面闩上了。', channel: 'system' });
      },
    });
  }
}

/** 大殿 — colonnaded temple hall with a double eave and an altar inside. */
function buildTempleHall(B) {
  const s = B.s, st = B.st, kit = B.kit, rng = B.rng;
  const w = Math.max(8, s.w || 20), d = Math.max(6, s.d || 14);
  const total = s.h || 13;
  const plinthH = 1.0;
  const colH = clamp(total * 0.42, 3.0, 5.2);
  const colR = 0.34;
  const plinthKey = mk(st.plinth[0], st.plinth[1]);
  const postKey = mk(st.post[0], st.post[1]);

  addPlinth(kit, { key: plinthKey, w, d, h: plinthH, steps: true, stepSide: 1, stepWidth: w * 0.4 });
  // balustrade round the terrace
  const bm = kit.d(plinthKey);
  for (const sz of [-1, 1]) {
    const n = Math.max(4, Math.round(w / 1.5));
    for (let i = 0; i <= n; i++) {
      const x = lerp(-w * 0.5 - 0.35, w * 0.5 + 0.35, i / n);
      if (sz === 1 && Math.abs(x) < w * 0.22) continue;   // stair gap
      bm.box(x, plinthH + 0.3, sz * (d * 0.5 + 0.4), 0.16, 0.6, 0.16, [0.95, 0.94, 0.92], 1.4);
    }
  }

  // veranda colonnade
  const nx = Math.max(4, Math.round(w / 3.2));
  const nz = Math.max(3, Math.round(d / 3.2));
  for (let i = 0; i <= nx; i++) {
    const x = lerp(-w * 0.5 + 0.5, w * 0.5 - 0.5, i / nx);
    for (const sz of [-1, 1]) {
      addColumn(kit, {
        key: postKey, baseKey: plinthKey, x, y: plinthH, z: sz * (d * 0.5 - 0.5),
        h: colH, r: colR,
      });
    }
  }
  for (let j = 1; j < nz; j++) {
    const z = lerp(-d * 0.5 + 0.5, d * 0.5 - 0.5, j / nz);
    for (const sx of [-1, 1]) {
      addColumn(kit, {
        key: postKey, baseKey: plinthKey, x: sx * (w * 0.5 - 0.5), y: plinthH, z,
        h: colH, r: colR,
      });
    }
  }
  // architrave tying the colonnade together
  const am = kit.g(postKey);
  for (const sz of [-1, 1]) {
    am.box(0, plinthH + colH + 0.28, sz * (d * 0.5 - 0.5), w - 0.6, 0.36, 0.3, [1.05, 1.0, 0.98], 1.1);
  }
  for (const sx of [-1, 1]) {
    am.box(sx * (w * 0.5 - 0.5), plinthH + colH + 0.28, 0, 0.3, 0.36, d - 0.6, [1.05, 1.0, 0.98], 1.1);
  }

  // cella walls, set back behind the veranda
  addTimberWalls(kit, {
    w: w - 3.0, d: d - 3.0, y: plinthH, h: colH,
    postKey, infillKey: mk(st.infill[0], st.infill[1]), paperKey: 'paperScreen',
    rng, doorSide: 1, windows: true,
  });

  // lower (veranda) eave, then the great upper roof
  addRoof(kit, {
    w, d, y: plinthH + colH + 0.5, rise: 1.15, ov: 1.5, hip: true, ridgeFrac: 0.66, rng,
    roofKey: mk(st.roof[0], st.roof[1]), woodKey: postKey, tint: st.tint, brackets: true,
  });
  const upperY = plinthH + colH + 1.9;
  am.box(0, upperY - 0.35, 0, w - 3.4, 0.9, d - 3.4, [1, 1, 1], 0.9, 0, 0.1);
  addRoof(kit, {
    w: w - 2.0, d: d - 2.0, y: upperY, rise: clamp(Math.min(w, d) * 0.3, 2.0, 4.0),
    ov: 1.5, hip: true, ridgeFrac: 0.5, rng,
    roofKey: mk(st.roof[0], st.roof[1]), woodKey: postKey, tint: st.tint, brackets: true,
  });

  // altar and its candles, on the axis
  buildAltarGeo(kit, st, rng, 0, plinthH, -d * 0.22, 1.0);
  B.light(0, plinthH + 1.5, -d * 0.22, { color: 0xffb257, intensity: 2.6, distance: 12 });
  B.fx('brazier', 0, plinthH + 1.25, -d * 0.22);
  B.interact({
    kind: 'altar', label: '神坛', x: 0, y: plinthH + 1.0, z: -d * 0.22 + 1.6, radius: 2.2,
    use: () => bus.emit('chat', { text: '你在神坛前上了一炷香，心里安静了些。', channel: 'system' }),
  });

  // banners hanging between the front columns
  const cm = kit.g('banner');
  for (const sx of [-1, 1]) {
    const x = sx * (w * 0.28);
    cm.face([x - 0.45, plinthH + colH - 0.1, d * 0.5 - 0.35],
      [x + 0.45, plinthH + colH - 0.1, d * 0.5 - 0.35],
      [x + 0.45, plinthH + colH - 2.6, d * 0.5 - 0.35],
      [x - 0.45, plinthH + colH - 2.6, d * 0.5 - 0.35], [1, 1, 1], 0.7, 0, [0, 0, 1]);
  }
}

/** Stepped stone altar with an offering bowl and a rune slab. */
function buildAltarGeo(kit, st, rng, x, y, z, scale) {
  const key = mk(st.plinth[0], st.plinth[1]);
  const m = kit.g(key);
  const S = scale || 1;
  m.box(x, y + 0.18 * S, z, 3.0 * S, 0.36 * S, 1.7 * S, [0.95, 0.94, 0.93], 0.7);
  m.box(x, y + 0.52 * S, z, 2.5 * S, 0.34 * S, 1.35 * S, [1.0, 0.99, 0.98], 0.7);
  m.box(x, y + 0.9 * S, z, 2.8 * S, 0.24 * S, 1.55 * S, [1.02, 1.01, 1.0], 0.7);
  // carved front panel
  const dm = kit.d(key);
  for (let i = -1; i <= 1; i++) {
    dm.box(x + i * 0.85 * S, y + 0.52 * S, z + 0.7 * S, 0.55 * S, 0.24 * S, 0.08 * S,
      [0.85, 0.84, 0.83], 1.4);
  }
  // offering bowl
  kit.g(mk(st.metal, null)).lathe(x, y + 1.02 * S, z,
    [[0.0, 0], [0.34 * S, 0.05 * S], [0.44 * S, 0.28 * S], [0.4 * S, 0.32 * S]], 12, [1, 1, 1], 1.2);
  kit.g('__flame').lathe(x, y + 1.22 * S, z,
    [[0.3 * S, 0], [0.16 * S, 0.2 * S], [0.0, 0.4 * S]], 8, [1, 0.7, 0.3], 1.2);
  // rune slab standing behind
  kit.g('rune').box(x, y + 1.5 * S, z - 0.75 * S, 1.1 * S, 1.5 * S, 0.14 * S, [1, 1, 1], 0.9);
  void rng;
}

/** 石桥 — a walkable arched bridge with parapets. */
function buildBridge(B) {
  const s = B.s, st = B.st, kit = B.kit, rng = B.rng;
  const w = s.w || 8, d = s.d || 12;
  const along = d >= w;               // long axis
  const L = along ? d : w, Wd = along ? w : d;
  const rise = s.h || 1.4;
  const key = mk(st.plinth[0], st.plinth[1]);
  const m = kit.g(key);
  const N = 10;

  const yAt = (t) => rise * Math.sin(Math.PI * clamp01(t)) * 0.55;
  const pos = (t, o) => (along ? [o, yAt(t), lerp(-L * 0.5, L * 0.5, t)]
    : [lerp(-L * 0.5, L * 0.5, t), yAt(t), o]);

  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const a = pos(t0, -Wd * 0.5), b = pos(t0, Wd * 0.5);
    const c = pos(t1, Wd * 0.5), e = pos(t1, -Wd * 0.5);
    m.face(a, b, c, e, jit(rng, 0.08), 0.75, 0, [0, 1, 0]);
    // underside + fascia
    const drop = 0.45;
    for (const sgn of [-1, 1]) {
      const p0 = pos(t0, sgn * Wd * 0.5), p1 = pos(t1, sgn * Wd * 0.5);
      m.face([p0[0], p0[1], p0[2]], [p1[0], p1[1], p1[2]],
        [p1[0], p1[1] - drop, p1[2]], [p0[0], p0[1] - drop, p0[2]],
        jit(rng, 0.08), 0.75, 0, along ? [sgn, 0, 0] : [0, 0, sgn]);
    }
  }
  // parapets and newel posts
  const pm = kit.d(key);
  for (const sgn of [-1, 1]) {
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = pos(t, sgn * (Wd * 0.5 - 0.22));
      pm.box(p[0], p[1] + 0.36, p[2], along ? 0.22 : L / N, 0.62, along ? L / N : 0.22,
        [0.96, 0.95, 0.94], 1.0);
    }
    for (const t of [0.02, 0.98]) {
      const p = pos(t, sgn * (Wd * 0.5 - 0.22));
      m.box(p[0], p[1] + 0.55, p[2], 0.44, 1.0, 0.44, [1, 1, 1], 1.0, 0, 0.06);
      m.cyl(p[0], p[1] + 1.05, p[2], 0.2, 0.05, 0.28, 8, [1, 1, 1], 1.2, true, false);
    }
  }
}

/** 洞口 — an arched mouth framed by rock (or a temple gateway). */
function buildCaveMouth(B) {
  const s = B.s, st = B.st, kit = B.kit, rng = B.rng;
  const span = s.span || 7;
  const h = span * 0.95;
  const temple = s.style === 'temple';
  const key = temple ? mk(st.wall[0], st.wall[1]) : mk('rock', null);
  const m = kit.g(key);

  if (temple) {
    for (const sx of [-1, 1]) {
      m.box(sx * (span * 0.5 + 0.9), h * 0.5, 0, 1.8, h, 1.8, [1, 1, 1], 0.6, 0, 0.12);
    }
    addArch(kit, key, { x: 0, z: 0, span, springY: h * 0.5, thick: 0.7, d: 1.8, rng });
    m.box(0, h + 0.55, 0, span + 3.6, 0.7, 2.2, [1, 1, 1], 0.6);
    addRoof(kit, {
      w: span + 4.2, d: 2.8, y: h + 0.9, rise: 1.5, ov: 1.1, hip: true, ridgeFrac: 0.55, rng,
      roofKey: mk(st.roof[0], st.roof[1]), woodKey: mk(st.trim[0], st.trim[1]),
      tint: st.tint, brackets: true,
    });
  } else {
    // rough rock jambs and a lumpy lintel mass
    for (const sx of [-1, 1]) {
      const mm = new Mesher();
      addRockMass(mm, 3.0, 2.6, h * 1.05, rng, st.tint);
      m.append(mm, sx * (span * 0.5 + 1.2), 0, 0, sx * 0.4);
    }
    const top = new Mesher();
    addRockMass(top, span + 4.0, 2.6, 2.2, rng, st.tint);
    m.append(top, 0, h * 0.86, 0, 0);
    addArch(kit, key, { x: 0, z: 0, span, springY: h * 0.42, thick: 0.5, d: 2.4, rng });
  }
  // the dark throat
  const dm = kit.g('__dark');
  dm.face([-span * 0.5, 0.02, -1.2], [span * 0.5, 0.02, -1.2],
    [span * 0.5, h * 0.42 + span * 0.5, -1.2], [-span * 0.5, h * 0.42 + span * 0.5, -1.2],
    [1, 1, 1], 1, 0, [0, 0, 1]);
}

/** 熔岩池 — a rock rim around an emissive lava disc. */
function buildLavaPool(B) {
  const kit = B.kit, rng = B.rng;
  const r = (B.s.r || 1.7) * 1.05;
  const rim = kit.g(mk('rock', 0x50372c));
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.2;
    const rr = r * (0.92 + hash3(i, 3, 9) * 0.22);
    rim.box(Math.cos(a) * rr, 0.12 + hash3(i, 5, 2) * 0.2, Math.sin(a) * rr,
      0.7, 0.42 + hash3(i, 7, 4) * 0.4, 0.55, [0.9, 0.86, 0.84], 0.9, -a, 0.06);
  }
  kit.g('lava').lathe(0, -0.06, 0, [[0, 0], [r * 0.55, 0.02], [r * 0.9, 0.05]], 14, [1, 1, 1], 0.6);
  B.light(0, 0.5, 0, { color: 0xff5a18, intensity: 3.4, distance: 12, flicker: 0.5 });
  B.fx('lava.bubble', 0, 0.05, 0);
}

/* ========================================================================== *
 * 6. Repeated point props — built once, drawn with InstancedMesh
 * ========================================================================== */

function buildTemplePillar(B) {
  const st = B.st, kit = B.kit;
  addColumn(kit, {
    key: mk(st.post[0], st.post[1]), baseKey: mk(st.plinth[0], st.plinth[1]),
    x: 0, y: 0, z: 0, h: 5.2, r: 0.42,
  });
  // bracket arms spreading under the ceiling
  const dm = kit.d(mk(st.post[0], st.post[1]));
  for (let i = 0; i < 4; i++) {
    const a = i * HALF_PI;
    dm.box(Math.cos(a) * 0.55, 5.42, Math.sin(a) * 0.55, 1.0, 0.16, 0.3, [0.96, 0.92, 0.9], 1.4, -a);
  }
}

function buildBrazier(B) {
  const st = B.st, kit = B.kit;
  const metal = mk(st.metal, null);
  const m = kit.g(metal);
  for (let i = 0; i < 3; i++) {
    const a = i * (TAU / 3) + 0.5;
    m.box(Math.cos(a) * 0.34, 0.42, Math.sin(a) * 0.34, 0.11, 0.86, 0.11, [1, 1, 1], 1.6, -a, 0.02);
  }
  m.lathe(0, 0.8, 0, [[0.12, 0], [0.42, 0.12], [0.55, 0.42], [0.5, 0.48]], 12, [1, 1, 1], 1.2);
  m.lathe(0, 1.24, 0, [[0.55, 0], [0.5, 0.06]], 12, [0.9, 0.9, 0.9], 1.2);
  kit.g('__coal').lathe(0, 1.16, 0, [[0.44, 0], [0.3, 0.08], [0, 0.12]], 10, [1, 0.42, 0.14], 1.5);
  kit.g('__flame').cyl(0, 1.2, 0, 0.34, 0.03, 0.85, 7, [1, 0.74, 0.3], 1, true, false);
  B.light(0, 1.55, 0, { color: 0xff9c3c, intensity: 4.2, distance: 15 });
  B.fx('brazier', 0, 1.25, 0);
}

function buildTorchWall(B) {
  const st = B.st, kit = B.kit;
  addTorchHead(kit, mk(st.trim[0], st.trim[1]), mk(st.metal, null), 0, 2.1, 0, 1, B.rng);
  B.light(0, 2.75, 0.35, { color: 0xffa050, intensity: 3.0, distance: 12 });
  B.fx('torch.flame', 0, 2.72, 0.3);
}

function buildWell(B) {
  const st = B.st, kit = B.kit, rng = B.rng;
  const key = mk(st.plinth[0], st.plinth[1]);
  const m = kit.g(key);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    m.box(Math.cos(a) * 0.95, 0.45, Math.sin(a) * 0.95, 0.56, 0.9, 0.34,
      jit(rng, 0.14), 1.0, -a, 0.03);
  }
  m.lathe(0, 0.9, 0, [[0.7, 0], [1.16, 0.04], [1.12, 0.14], [0.72, 0.16]], 14, [1.02, 1.01, 1.0], 1.1);
  kit.g('__dark').lathe(0, 0.2, 0, [[0, 0], [0.72, 0.02]], 12, [1, 1, 1], 1);
  const wm = kit.g(mk(st.trim[0], st.trim[1]));
  for (const sx of [-1, 1]) wm.box(sx * 0.95, 1.75, 0, 0.16, 1.8, 0.16, [1, 1, 1], 1.2);
  wm.box(0, 2.62, 0, 2.5, 0.16, 0.16, [1, 1, 1], 1.2);
  wm.cyl(0, 2.42, 0, 0.11, 0.11, 0.0001, 8, [1, 1, 1], 1.2, false, false);
  wm.box(0, 2.48, 0, 1.0, 0.2, 0.2, [0.95, 0.9, 0.86], 1.4);
  addRoof(kit, {
    w: 2.9, d: 2.0, y: 2.7, rise: 0.75, ov: 0.45, hip: true, ridgeFrac: 0.5, rng,
    roofKey: mk(st.roof[0], st.roof[1]), woodKey: mk(st.trim[0], st.trim[1]),
    tint: st.tint, brackets: false,
  });
  // bucket on a rope
  kit.d(mk(st.trim[0], st.trim[1])).box(0, 2.0, 0, 0.03, 0.86, 0.03, [0.7, 0.66, 0.6], 2);
  kit.d(mk(st.trim[0], st.trim[1])).lathe(0, 1.4, 0,
    [[0.2, 0], [0.24, 0.3], [0.22, 0.32]], 8, [0.9, 0.85, 0.8], 1.4);
  B.interact({
    kind: 'well', label: '水井', x: 0, y: 1.0, z: 1.3, radius: 2.0,
    use: () => bus.emit('chat', { text: '井水冰凉，喝一口精神一振。', channel: 'system' }),
  });
}

function buildCart(B, stall) {
  const st = B.st, kit = B.kit, rng = B.rng;
  const wood = mk('plank.worn', null);
  const m = kit.g(wood);
  // bed
  for (let i = 0; i < 5; i++) {
    m.box(0, 0.72, -0.7 + i * 0.35, 2.5, 0.09, 0.3, jit(rng, 0.14), 1.2);
  }
  m.box(0, 0.86, -0.86, 2.5, 0.35, 0.1, jit(rng, 0.1), 1.2);
  m.box(0, 0.86, 0.86, 2.5, 0.35, 0.1, jit(rng, 0.1), 1.2);
  for (const sx of [-1, 1]) m.box(sx * 1.25, 0.86, 0, 0.1, 0.35, 1.8, jit(rng, 0.1), 1.2);
  // shafts
  for (const sx of [-1, 1]) {
    m.box(sx * 0.5, 0.66, 1.75, 0.1, 0.1, 1.9, [0.95, 0.92, 0.9], 1.4);
  }
  // wheels: built flat in a scratch mesher, then tipped onto the X axle
  const im = kit.g(mk(st.metal, null));
  const wheel = new Mesher();
  wheel.lathe(0, -0.06, 0, [[0.42, 0], [0.54, 0.02], [0.56, 0.06], [0.5, 0.11], [0.42, 0.12]],
    14, [1, 1, 1], 1.4);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    wheel.box(0, 0, 0, 1.0, 0.09, 0.09, [0.92, 0.9, 0.88], 1.6, a);
  }
  wheel.cyl(0, -0.09, 0, 0.13, 0.13, 0.18, 8, [0.85, 0.83, 0.8], 1.6, true, true);
  const tip = new THREE.Matrix4();
  for (const sx of [-1, 1]) {
    tip.makeRotationZ(HALF_PI);
    tip.setPosition(sx * 1.32, 0.56, 0);
    m.appendMatrix(wheel, tip);
  }
  // axle
  im.box(0, 0.56, 0, 2.9, 0.09, 0.09, [1, 1, 1], 1.4);
  if (stall) {
    // market awning on four poles
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        m.box(sx * 1.15, 1.5, sz * 0.8, 0.09, 1.5, 0.09, [1, 1, 1], 1.4);
      }
    }
    const cm = kit.g('banner');
    cm.face([-1.45, 2.25, -1.15], [1.45, 2.25, -1.15], [1.45, 2.05, 1.15], [-1.45, 2.05, 1.15],
      [1, 1, 1], 0.8, 0, [0, 1, 0]);
    // goods
    for (let i = 0; i < 3; i++) {
      m.box(-0.8 + i * 0.8, 0.92, 0, 0.5, 0.3, 0.5, jit(rng, 0.2, 0.06), 1.6, rng() * 0.7);
    }
  }
}

function buildCrate(B, variant) {
  const kit = B.kit, rng = B.rng;
  const wood = mk('plank.worn', null);
  const m = kit.g(wood);
  const s = [0.9, 1.1, 0.75][variant % 3];
  m.box(0, s * 0.5, 0, s, s, s, jit(rng, 0.14, 0.05), 1.3);
  // slats + corner braces
  const dm = kit.d(wood);
  for (const sz of [-1, 1]) {
    dm.box(0, s * 0.3, sz * (s * 0.5 + 0.02), s * 1.01, 0.09, 0.03, [0.86, 0.82, 0.78], 2);
    dm.box(0, s * 0.72, sz * (s * 0.5 + 0.02), s * 1.01, 0.09, 0.03, [0.86, 0.82, 0.78], 2);
  }
  for (const sx of [-1, 1]) {
    dm.box(sx * (s * 0.5 + 0.02), s * 0.3, 0, 0.03, 0.09, s * 1.01, [0.86, 0.82, 0.78], 2);
    dm.box(sx * (s * 0.5 + 0.02), s * 0.72, 0, 0.03, 0.09, s * 1.01, [0.86, 0.82, 0.78], 2);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      dm.box(sx * (s * 0.5 - 0.02), s * 0.5, sz * (s * 0.5 - 0.02), 0.07, s * 1.02, 0.07,
        [0.78, 0.74, 0.7], 2);
    }
  }
}

function buildBarrel(B) {
  const kit = B.kit, rng = B.rng;
  const m = kit.g(mk('plank.worn', null));
  m.lathe(0, 0, 0, [
    [0.34, 0], [0.4, 0.12], [0.44, 0.42], [0.44, 0.62], [0.4, 0.9], [0.34, 1.0], [0, 1.02],
  ], 12, jit(rng, 0.12, 0.04), 1.2);
  const im = kit.d(mk('ironRusted', null));
  for (const y of [0.14, 0.5, 0.88]) {
    im.lathe(0, y, 0, [[0.452, 0], [0.452, 0.08]], 12, [1, 1, 1], 1.6);
  }
}

function buildFence(B) {
  const kit = B.kit, rng = B.rng;
  const m = kit.g(mk('plank.worn', null));
  // one 3-unit bay; instances scale along local X to match `len`
  for (const sx of [-1, 1]) {
    m.box(sx * 1.4, 0.6, 0, 0.16, 1.2, 0.16, jit(rng, 0.12), 1.4, 0, 0.02);
    m.box(sx * 1.4, 1.24, 0, 0.2, 0.1, 0.2, [0.9, 0.86, 0.82], 1.6);
  }
  for (const y of [0.4, 0.88]) {
    m.box(0, y, 0, 2.86, 0.11, 0.07, jit(rng, 0.1), 1.4);
  }
}

function buildBannerPole(B) {
  const st = B.st, kit = B.kit, rng = B.rng;
  const m = kit.g(mk(st.trim[0], st.trim[1]));
  m.cyl(0, 0, 0, 0.28, 0.22, 0.22, 8, [1, 1, 1], 1.2, true, false);
  m.cyl(0, 0.22, 0, 0.11, 0.08, 3.9, 8, [1, 1, 1], 1.0, false, false);
  m.box(0, 3.95, 0, 1.1, 0.09, 0.09, [1, 1, 1], 1.4);
  kit.g(mk(st.metal, null)).lathe(0, 4.05, 0, [[0.1, 0], [0.05, 0.18], [0, 0.3]], 6, [1, 1, 1], 1.4);
  // hanging banner: swings from the crossbar, so wind rises toward the free edge
  const cm = kit.g('__banner_wind');
  const top = 3.9, bot = 1.5, hw = 0.42;
  const NB = 4;
  for (let i = 0; i < NB; i++) {
    const y0 = lerp(top, bot, i / NB), y1 = lerp(top, bot, (i + 1) / NB);
    cm.face([-hw, y0, 0], [hw, y0, 0], [hw, y1, 0], [-hw, y1, 0], [1, 1, 1], 0.9,
      (x, y) => clamp01((top - y) / (top - bot)) * 0.9, [0, 0, 1]);
  }
  // pennant tail
  cm.face([-hw, bot, 0], [hw, bot, 0], [hw * 0.2, bot - 0.5, 0], [-hw * 0.2, bot - 0.5, 0],
    [1, 1, 1], 0.9, 1.0, [0, 0, 1]);
  void rng;
}

function buildTombStone(B) {
  const kit = B.kit, rng = B.rng;
  const m = kit.g(mk('rock', 0x8a857c));
  const lean = (rng() - 0.5) * 0.22;
  m.box(0, 0.16, 0, 1.2, 0.32, 0.8, [0.92, 0.91, 0.9], 0.9);
  m.box(Math.sin(lean) * 0.6, 0.95, 0, 0.86, 1.5, 0.24, [1, 1, 1], 0.9, 0, 0.05);
  m.box(Math.sin(lean) * 1.2, 1.76, 0, 1.0, 0.2, 0.34, [0.95, 0.94, 0.93], 1.0);
  const dm = kit.d(mk('rock', 0x8a857c));
  for (let i = 0; i < 4; i++) {
    dm.box(Math.sin(lean) * 0.7, 1.35 - i * 0.28, 0.13, 0.2, 0.2, 0.03, [0.7, 0.69, 0.68], 2.5);
  }
}

/** 石狮 — a seated guardian beast on a pedestal. */
function buildStatueBeast(B) {
  const st = B.st, kit = B.kit, rng = B.rng;
  const key = mk('rock', st.plinth[1]);
  const m = kit.g(key);
  const d = kit.d(key);
  m.box(0, 0.28, 0, 1.7, 0.56, 1.3, [0.95, 0.94, 0.93], 0.8);
  m.box(0, 0.66, 0, 1.45, 0.24, 1.1, [1.0, 0.99, 0.98], 0.8);
  // haunches and chest
  m.box(0, 1.25, -0.28, 0.95, 1.0, 0.75, [1, 1, 1], 0.9, 0, 0.08);
  m.box(0, 1.45, 0.3, 0.85, 1.2, 0.6, [1, 1, 1], 0.9, 0, 0.1);
  // forelegs
  for (const sx of [-1, 1]) {
    m.box(sx * 0.3, 1.0, 0.55, 0.24, 1.0, 0.3, [0.98, 0.97, 0.96], 1.0, 0, 0.02);
    d.box(sx * 0.3, 0.58, 0.72, 0.3, 0.16, 0.44, [0.95, 0.94, 0.93], 1.4);
  }
  // head + mane
  m.box(0, 2.2, 0.45, 0.72, 0.66, 0.66, [1, 1, 1], 1.0, 0, 0.06);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    d.box(Math.cos(a) * 0.44, 2.2 + Math.sin(a) * 0.44, 0.36, 0.26, 0.26, 0.3,
      [0.9 + hash3(i, 1, 2) * 0.2, 0.9, 0.9], 1.4, -a, 0.04);
  }
  d.box(-0.16, 2.34, 0.78, 0.14, 0.12, 0.1, [0.6, 0.58, 0.56], 2);
  d.box(0.16, 2.34, 0.78, 0.14, 0.12, 0.1, [0.6, 0.58, 0.56], 2);
  d.box(0, 2.08, 0.8, 0.3, 0.16, 0.12, [0.7, 0.68, 0.66], 2);
  // paw on a ball
  m.lathe(0.34, 0.78, 0.78, [[0, 0], [0.2, 0.1], [0.24, 0.22], [0.14, 0.32], [0, 0.34]], 10,
    [0.96, 0.95, 0.94], 1.2);
  void rng;
}

function buildStairs(B) {
  const st = B.st, kit = B.kit, rng = B.rng;
  const m = kit.g(mk(st.plinth[0], st.plinth[1]));
  const n = 6;
  for (let i = 0; i < n; i++) {
    m.box(0, 0.16 + i * 0.3, 1.6 - i * 0.55, 3.4, 0.3, 0.6, jit(rng, 0.09), 0.9);
  }
  for (const sx of [-1, 1]) {
    m.box(sx * 1.85, 1.0, 0, 0.3, 2.0, 3.6, [0.94, 0.93, 0.92], 0.9);
  }
}

/* ========================================================================== *
 * 7. Nature — recursive trees, and the rest of the undergrowth
 * ========================================================================== */

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}

/** Rotate unit `d` by `ang` about a random axis perpendicular to it. */
function bendDir(d, ang, rng) {
  const ax = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let k = [d[1] * ax[2] - d[2] * ax[1], d[2] * ax[0] - d[0] * ax[2], d[0] * ax[1] - d[1] * ax[0]];
  norm3(k);
  // spin that perpendicular around d so the split azimuth is random
  const phi = rng() * TAU;
  const k2 = [d[1] * k[2] - d[2] * k[1], d[2] * k[0] - d[0] * k[2], d[0] * k[1] - d[1] * k[0]];
  const kk = [
    k[0] * Math.cos(phi) + k2[0] * Math.sin(phi),
    k[1] * Math.cos(phi) + k2[1] * Math.sin(phi),
    k[2] * Math.cos(phi) + k2[2] * Math.sin(phi),
  ];
  norm3(kk);
  const c = Math.cos(ang), s = Math.sin(ang);
  const cross = [
    kk[1] * d[2] - kk[2] * d[1],
    kk[2] * d[0] - kk[0] * d[2],
    kk[0] * d[1] - kk[1] * d[0],
  ];
  return norm3([d[0] * c + cross[0] * s, d[1] * c + cross[1] * s, d[2] * c + cross[2] * s]);
}

/** One foliage card: a quad with spherical normals so clusters shade as blobs. */
function emitCard(m, c, u, v, size, aspect, col, wind, bulge) {
  const hx = size, hy = size * aspect;
  const pts = [
    [c[0] - u[0] * hx - v[0] * hy, c[1] - u[1] * hx - v[1] * hy, c[2] - u[2] * hx - v[2] * hy],
    [c[0] + u[0] * hx - v[0] * hy, c[1] + u[1] * hx - v[1] * hy, c[2] + u[2] * hx - v[2] * hy],
    [c[0] + u[0] * hx + v[0] * hy, c[1] + u[1] * hx + v[1] * hy, c[2] + u[2] * hx + v[2] * hy],
    [c[0] - u[0] * hx + v[0] * hy, c[1] - u[1] * hx + v[1] * hy, c[2] - u[2] * hx + v[2] * hy],
  ];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const idx = [];
  const b = bulge === undefined ? 1 : bulge;
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    // spherical normals about the cluster centre: a canopy shades as a mass,
    // not as a stack of flat cards
    const nx = (p[0] - c[0]) * b;
    const ny = (p[1] - c[1]) * b + 0.35;
    const nz = (p[2] - c[2]) * b;
    const l = Math.hypot(nx, ny, nz) || 1;
    idx.push(m.vert(p[0], p[1], p[2], nx / l, ny / l, nz / l,
      uvs[i][0], uvs[i][1], col[0], col[1], col[2], wind));
  }
  m.quad(idx[0], idx[1], idx[2], idx[3]);
}

/** A blob of 3 crossed cards at a branch tip. */
function emitLeafCluster(m, p, size, rng, col, wind, aspect) {
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU, e = (rng() - 0.5) * 1.4;
    const u = norm3([Math.cos(a), Math.sin(e) * 0.4, Math.sin(a)]);
    const v = norm3([-u[2] * 0.3 + (rng() - 0.5) * 0.3, 1, u[0] * 0.3 + (rng() - 0.5) * 0.3]);
    // re-orthogonalise v against u
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    v[0] -= u[0] * d; v[1] -= u[1] * d; v[2] -= u[2] * d;
    norm3(v);
    emitCard(m, p, u, v, size * (0.75 + rng() * 0.5), aspect || 0.8, col, wind, 1.1);
  }
}

const TREE_PARAMS = {
  oak: {
    depth: 3, len: 3.0, rad: 0.3, kids: [3, 3, 2], spread: [0.5, 0.72, 0.9],
    shrink: [0.68, 0.62, 0.58], taper: 0.62, droop: -0.04,
    leafSize: 0.85, leafAspect: 0.85, mat: 'leaf', trunkSeg: 7,
  },
  willow: {
    depth: 3, len: 2.6, rad: 0.28, kids: [3, 3, 3], spread: [0.6, 0.95, 1.25],
    shrink: [0.7, 0.66, 0.62], taper: 0.6, droop: 0.34,
    leafSize: 0.72, leafAspect: 1.9, mat: 'leaf', trunkSeg: 7,
  },
  dead: {
    depth: 3, len: 2.7, rad: 0.26, kids: [2, 2, 2], spread: [0.75, 1.0, 1.15],
    shrink: [0.66, 0.6, 0.55], taper: 0.5, droop: 0.06,
    leafSize: 0, leafAspect: 1, mat: 'leaf', trunkSeg: 6,
  },
};

/**
 * Recursive branch generator: 3-4 levels, tapering along each limb, varied
 * split angles, gravity droop, and leaf blobs at the tips.
 * @returns {{wood:Mesher, leaf:Mesher, height:number, radius:number}}
 */
function makeTree(rng, species) {
  const wood = new Mesher();
  const leaf = new Mesher();
  const P = TREE_PARAMS[species] || TREE_PARAMS.oak;
  const scale = 0.82 + rng() * 0.5;
  const barkCol = [0.86 + rng() * 0.28, 0.86 + rng() * 0.2, 0.84 + rng() * 0.18];
  const leafBase = 0.8 + rng() * 0.4;
  let top = 0;

  const branch = (p0, dir, len, rad, depth) => {
    const steps = 3 + (P.depth - depth);
    const pts = [p0.slice()];
    const radii = [rad];
    let d = dir.slice();
    let cur = p0.slice();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      d = bendDir(d, 0.16 * (0.5 + rng()), rng);
      d[1] += P.droop * (depth + 1) * 0.22;
      if (depth === 0) d[1] += 0.06;
      norm3(d);
      cur = [cur[0] + d[0] * (len / steps), cur[1] + d[1] * (len / steps), cur[2] + d[2] * (len / steps)];
      pts.push(cur.slice());
      radii.push(rad * lerp(1, P.taper, t));
      if (cur[1] > top) top = cur[1];
    }
    const seg = depth === 0 ? P.trunkSeg : depth === 1 ? 5 : 4;
    const wBase = depth / (P.depth + 1);
    wood.tube(pts, radii, seg, barkCol, 0.9,
      (x, y) => clamp01(wBase + y * 0.05) * 0.5);

    const tip = pts[pts.length - 1];
    if (depth >= P.depth) {
      if (P.leafSize > 0) {
        const col = [leafBase * (0.86 + rng() * 0.3), leafBase * (0.9 + rng() * 0.24), leafBase * (0.82 + rng() * 0.3)];
        emitLeafCluster(leaf, tip, P.leafSize * (len / P.len + 0.55), rng, col,
          clamp01(0.35 + tip[1] * 0.09), P.leafAspect);
      }
      return;
    }
    const kids = P.kids[Math.min(depth, P.kids.length - 1)];
    for (let k = 0; k < kids; k++) {
      const ang = P.spread[Math.min(depth, P.spread.length - 1)] * (0.6 + rng() * 0.75);
      const nd = bendDir(d, ang, rng);
      branch(tip, nd, len * P.shrink[Math.min(depth, P.shrink.length - 1)] * (0.85 + rng() * 0.3),
        rad * (0.56 + rng() * 0.16), depth + 1);
    }
    // a few leaves along the upper limbs too, so the canopy isn't hollow
    if (P.leafSize > 0 && depth >= P.depth - 1) {
      const col = [leafBase * 0.95, leafBase, leafBase * 0.9];
      emitLeafCluster(leaf, pts[Math.max(1, pts.length - 2)], P.leafSize * 0.8, rng, col,
        clamp01(0.3 + tip[1] * 0.08), P.leafAspect);
    }
  };

  branch([0, 0, 0], [0, 1, 0], P.len * scale, P.rad * scale, 0);
  // root flare
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng() * 0.5;
    wood.box(Math.cos(a) * P.rad * scale * 1.1, 0.14, Math.sin(a) * P.rad * scale * 1.1,
      P.rad * scale * 0.7, 0.4, P.rad * scale * 0.9, barkCol, 1.4, -a, 0.04);
  }
  return { wood, leaf, height: top, radius: P.rad * scale * 1.5 };
}

/** 松树 — a straight leader with whorls of down-swept needle skirts. */
function makePine(rng) {
  const wood = new Mesher();
  const leaf = new Mesher();
  const scale = 0.85 + rng() * 0.55;
  const h = 7.4 * scale;
  const rad = 0.3 * scale;
  const barkCol = [0.82 + rng() * 0.24, 0.84 + rng() * 0.18, 0.8 + rng() * 0.16];
  const pts = [];
  const radii = [];
  const N = 7;
  let dx = 0, dz = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    dx += (rng() - 0.5) * 0.12;
    dz += (rng() - 0.5) * 0.12;
    pts.push([dx * t, h * t, dz * t]);
    radii.push(rad * (1 - t * 0.85) + 0.02);
  }
  wood.tube(pts, radii, 7, barkCol, 0.9, (x, y) => clamp01(y / h) * 0.35);

  const whorls = 6;
  const green = 0.78 + rng() * 0.3;
  for (let i = 0; i < whorls; i++) {
    const t = 0.24 + (i / whorls) * 0.74;
    const y = h * t;
    const rr = (1 - t) * 2.5 * scale + 0.35;
    const n = Math.max(4, Math.round(8 - i * 0.6));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + i * 0.7 + rng() * 0.3;
      const tipR = rr * (0.75 + rng() * 0.45);
      const c = [Math.cos(a) * tipR * 0.62 + dx * t, y - tipR * 0.22, Math.sin(a) * tipR * 0.62 + dz * t];
      const u = norm3([Math.cos(a), -0.34, Math.sin(a)]);
      const v = norm3([-Math.sin(a), 0.12, Math.cos(a)]);
      const col = [green * (0.85 + rng() * 0.28), green * (0.9 + rng() * 0.24), green * (0.8 + rng() * 0.24)];
      emitCard(leaf, c, u, v, tipR * 0.66, 0.42, col, clamp01(t) * 0.85, 0.8);
      emitCard(leaf, c, v, u, tipR * 0.4, 0.7, col, clamp01(t) * 0.85, 0.8);
    }
  }
  // a crown tuft
  emitLeafCluster(leaf, [dx, h - 0.15, dz], 0.55 * scale, rng, [green, green * 1.05, green * 0.9], 1.0, 0.9);
  return { wood, leaf, height: h, radius: rad * 1.6 };
}

/** 棕榈 — a leaning trunk with ringed bark and drooping fronds. */
function makePalm(rng) {
  const wood = new Mesher();
  const leaf = new Mesher();
  const scale = 0.9 + rng() * 0.45;
  const h = 6.2 * scale;
  const lean = (rng() - 0.5) * 1.6;
  const leanZ = (rng() - 0.5) * 1.6;
  const pts = [], radii = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([lean * t * t, h * t, leanZ * t * t]);
    radii.push(0.28 * scale * (1 - t * 0.4));
  }
  const barkCol = [0.9 + rng() * 0.2, 0.88, 0.8];
  wood.tube(pts, radii, 8, barkCol, 1.1, (x, y) => clamp01(y / h) * 0.3);
  const topP = pts[N];
  // frond crown
  const fronds = 8 + Math.floor(rng() * 4);
  const green = 0.8 + rng() * 0.3;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * TAU + rng() * 0.3;
    const dirx = Math.cos(a), dirz = Math.sin(a);
    const L = (2.4 + rng() * 1.1) * scale;
    const S = 5;
    const col = [green * (0.86 + rng() * 0.26), green * (0.94 + rng() * 0.2), green * 0.82];
    for (let i = 0; i < S; i++) {
      const t0 = i / S, t1 = (i + 1) / S;
      const y0 = topP[1] + 0.5 * Math.sin(t0 * 2.2) - t0 * t0 * 1.9;
      const y1 = topP[1] + 0.5 * Math.sin(t1 * 2.2) - t1 * t1 * 1.9;
      const w0 = (0.42 - Math.abs(t0 - 0.4) * 0.5) * scale;
      const w1 = (0.42 - Math.abs(t1 - 0.4) * 0.5) * scale;
      const px0 = topP[0] + dirx * L * t0, pz0 = topP[2] + dirz * L * t0;
      const px1 = topP[0] + dirx * L * t1, pz1 = topP[2] + dirz * L * t1;
      const nx = -dirz, nz = dirx;
      leaf.face(
        [px0 - nx * w0, y0, pz0 - nz * w0], [px0 + nx * w0, y0, pz0 + nz * w0],
        [px1 + nx * w1, y1, pz1 + nz * w1], [px1 - nx * w1, y1, pz1 - nz * w1],
        col, 1.0, 0.35 + t0 * 0.65, [0, 1, 0]);
    }
  }
  return { wood, leaf, height: h, radius: 0.34 * scale };
}

/** 灌木 — a low mound of crossed leaf cards on stubby stems. */
function makeBush(rng) {
  const wood = new Mesher();
  const leaf = new Mesher();
  const s = 0.7 + rng() * 0.6;
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU;
    wood.cyl(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1, 0.06 * s, 0.03 * s, 0.42 * s, 4,
      [0.9, 0.86, 0.8], 1.4, false, false);
  }
  const green = 0.8 + rng() * 0.35;
  const n = 9 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, rr = rng() * 0.5 * s;
    const c = [Math.cos(a) * rr, 0.3 * s + rng() * 0.55 * s, Math.sin(a) * rr];
    const col = [green * (0.85 + rng() * 0.3), green * (0.95 + rng() * 0.2), green * (0.8 + rng() * 0.25)];
    emitLeafCluster(leaf, c, 0.34 * s, rng, col, clamp01(c[1] / (0.9 * s)) * 0.8, 0.85);
  }
  return { wood, leaf, height: s, radius: 0.55 * s };
}

/** Grass tuft — a low, broad fan of tapered blades with vertex-shader sway. */
function makeGrass(rng, tall) {
  const m = new Mesher();
  // The old field grass was tall, wide and spaced on an almost one-tile grid.
  // From the isometric camera every tuft became a dark conifer-shaped spike.
  // Keep reeds tall, but make ordinary grass a broad knee-high tuft.
  const h = (tall ? 1.35 : 0.32) * (0.78 + rng() * 0.52);
  const blades = tall ? 4 : 6;
  const SEGS = tall ? 3 : 2;
  const green = tall ? (0.9 + rng() * 0.22) : (0.78 + rng() * 0.14);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + rng() * 0.32;
    const ux = Math.cos(a), uz = Math.sin(a);
    const bw = (tall ? 0.07 : 0.055) * (0.82 + rng() * 0.42);
    const bend = (0.12 + rng() * 0.22) * h;
    const rootR = tall ? rng() * 0.025 : (0.045 + rng() * 0.08);
    const rootX = ux * rootR, rootZ = uz * rootR;
    const col = tall
      ? [
        green * (0.78 + rng() * 0.18),
        green * (0.96 + rng() * 0.12),
        green * (0.62 + rng() * 0.18),
      ]
      : [
        green * (0.74 + rng() * 0.13),
        green * (0.82 + rng() * 0.12),
        green * (0.58 + rng() * 0.11),
      ];
    const N = SEGS;
    // blade normal: mostly the card normal, tilted up so tufts catch skylight
    const nl = Math.hypot(uz, 0.78, ux) || 1;
    const bnx = -uz / nl, bny = 0.78 / nl, bnz = ux / nl;
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N;
      const w0 = bw * (1 - t0 * 0.75), w1 = bw * (1 - t1 * 0.75);
      const y0 = h * t0, y1 = h * t1;
      const x0 = bend * t0 * t0, x1 = bend * t1 * t1;
      const i0 = m.vert(rootX + x0 * ux - uz * w0, y0, rootZ + x0 * uz + ux * w0, bnx, bny, bnz, 1, t0, col[0], col[1], col[2], t0 * t0);
      const i1 = m.vert(rootX + x0 * ux + uz * w0, y0, rootZ + x0 * uz - ux * w0, bnx, bny, bnz, 0, t0, col[0], col[1], col[2], t0 * t0);
      const i2 = m.vert(rootX + x1 * ux + uz * w1, y1, rootZ + x1 * uz - ux * w1, bnx, bny, bnz, 0, t1, col[0], col[1], col[2], t1 * t1);
      const i3 = m.vert(rootX + x1 * ux - uz * w1, y1, rootZ + x1 * uz + ux * w1, bnx, bny, bnz, 1, t1, col[0], col[1], col[2], t1 * t1);
      m.quad(i0, i1, i2, i3);
    }
    if (tall && rng() < 0.7) {
      // seed head
      const c = [bend * ux, h * 1.02, bend * uz];
      emitCard(m, c, [ux, 0, uz], [0, 1, 0], 0.05, 2.6, [col[0] * 1.1, col[1] * 1.05, col[2] * 0.8], 1.0, 0.3);
    }
  }
  return { leaf: m, height: h };
}

/** A small flower: stem plus a couple of petal cards (tint comes per-instance). */
function makeFlower(rng) {
  const m = new Mesher();
  const h = 0.3 + rng() * 0.22;
  m.box(0, h * 0.5, 0, 0.024, h, 0.024, [0.55, 0.8, 0.45], 2);
  const c = [0, h, 0];
  for (let i = 0; i < 2; i++) {
    const a = rng() * TAU;
    emitCard(m, c, [Math.cos(a), 0.15, Math.sin(a)], [-Math.sin(a) * 0.3, 1, Math.cos(a) * 0.3],
      0.085, 0.9, [1, 1, 1], 1.0, 0.4);
  }
  return { leaf: m, height: h };
}

/** Irregular boulder: a subdivided icosahedron pushed around by a hash field. */
function makeRockGeometry(rng) {
  const src = new THREE.IcosahedronGeometry(1, 1);
  const pos = src.getAttribute('position');
  const n = pos.count;
  const arr = pos.array;
  const sx = 0.72 + rng() * 0.75, sy = 0.5 + rng() * 0.62, sz = 0.72 + rng() * 0.75;
  const seed = Math.floor(rng() * 9999);
  for (let i = 0; i < n; i++) {
    let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
    const kx = Math.round(x * 64), ky = Math.round(y * 64), kz = Math.round(z * 64);
    const d = 0.72 + hash3(kx + seed, ky, kz) * 0.6;
    const d2 = 0.9 + hash3(kx * 3, ky * 5 + seed, kz * 7) * 0.32;
    x *= d * sx * d2; y *= d * sy; z *= d * sz * d2;
    if (y < -0.3) y = -0.3 - (y + 0.3) * 0.1;    // flatten the buried side
    arr[i * 3] = x; arr[i * 3 + 1] = y + 0.3; arr[i * 3 + 2] = z;
  }
  pos.needsUpdate = true;
  src.computeVertexNormals();
  const cols = new Float32Array(n * 3);
  const winds = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    const v = 0.84 + hash3(i, seed, 11) * 0.34;
    const w = 0.86 + hash3(i, seed, 12) * 0.3;
    for (let k = 0; k < 3; k++) {
      cols[(i + k) * 3] = v; cols[(i + k) * 3 + 1] = v * 0.99; cols[(i + k) * 3 + 2] = w;
    }
  }
  src.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  src.setAttribute('aWind', new THREE.BufferAttribute(winds, 1));
  src.computeBoundingSphere();
  return src;
}

/** 倒木 — a bent, broken trunk with a couple of snapped stubs. */
function makeLog(rng) {
  const m = new Mesher();
  const len = 2.4 + rng() * 2.6;
  const rad = 0.22 + rng() * 0.16;
  const bend = (rng() - 0.5) * 0.5;
  const pts = [], radii = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([lerp(-len * 0.5, len * 0.5, t), rad * (0.9 + Math.sin(t * Math.PI) * 0.16), bend * Math.sin(t * Math.PI)]);
    radii.push(rad * (1 - t * 0.28) * (0.92 + hash3(i, 3, 1) * 0.18));
  }
  const col = [0.9 + rng() * 0.18, 0.88, 0.84];
  m.tube(pts, radii, 7, col, 1.0, null);
  // broken ends
  for (const s of [-1, 1]) {
    const p = s < 0 ? pts[0] : pts[N];
    m.lathe(p[0], p[1] - rad * 0.8, p[2], [[0, 0], [rad * 0.8, rad * 0.5], [rad * 0.95, rad * 1.4]],
      7, [0.78, 0.74, 0.68], 1.6);
  }
  // stubs
  for (let i = 0; i < 2; i++) {
    const t = 0.3 + rng() * 0.4;
    const p = pts[Math.round(t * N)];
    m.cyl(p[0], p[1], p[2], rad * 0.34, rad * 0.16, 0.5 + rng() * 0.4, 5, col, 1.4, true, false);
  }
  return { wood: m, len, radius: rad };
}

/* ========================================================================== *
 * 8. Props
 * ========================================================================== */

const _wv = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _ws = new THREE.Vector3();
const _wm = new THREE.Matrix4();
const _wc = new THREE.Color();
const _cam = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const EMPTY_FX_OPTS = Object.freeze({});

export class Props {
  /**
   * @param {object} mapDef  see MapDefs.js
   * @param {import('./Terrain.js').Terrain} terrain
   * @param {object} ctx     { engine, bus, forge, materials, fx, quality, rng, assets }
   */
  constructor(mapDef, terrain, ctx) {
    this.def = mapDef || {};
    this.terrain = terrain || null;
    this.ctx = ctx || {};
    this.quality = this.ctx.quality || 'high';
    this.preset = (this.ctx.engine && this.ctx.engine.preset)
      || QUALITY_PRESETS[this.quality] || QUALITY_PRESETS.high;
    this.density = clamp(this.preset.propDensity || 1, 0.15, 2);

    this.group = new THREE.Group();
    this.group.name = 'props';

    /** @type {{x:number,z:number,r:number}[]} */
    this.blockers = [];
    /** @type {object[]} */
    this.interactables = [];

    // ---- owned resources -------------------------------------------------
    /** @type {Set<THREE.BufferGeometry>} */
    this._geoms = new Set();
    /** @type {Set<THREE.Material>} materials WE made (library ones are shared) */
    this._mats = new Set();
    /** @type {Set<THREE.Texture>} */
    this._tex = new Set();
    /** @type {Map<string, THREE.Material>} resolved material cache by key */
    this._matCache = new Map();
    /** @type {THREE.Object3D[]} meshes hidden past LOD_DETAIL */
    this._lod = [];
    /**
     * Structure roof skins which may sit between the isometric camera and its
     * focus.  The opaque material stays the common library material; a local
     * transparent clone is only switched in while the roof is actually fading.
     * @type {object[]}
     */
    this._roofOccluders = [];
    /** @type {THREE.PointLight[]} */
    this._lightPool = [];
    /** @type {object[]} candidate light emitters */
    this._lightSources = [];
    /** @type {object[]} candidate particle emitters */
    this._fxSources = [];

    this._time = 0;
    this._lightTimer = 0;
    this._fxTimer = 0;
    this._lodTimer = 0;
    this._disposed = false;

    this._wind = {
      uTime: { value: 0 },
      uWindDir: { value: new THREE.Vector2(0.82, 0.57) },
      uWindAmp: { value: 1.0 },
    };
    this._gust = 0;

    const seed = (this.def.seed | 0) || 12345;
    this.rng = makeRng(seed ^ 0x5f3a7b);

    this.W = Math.max(8, this.def.width | 0 || 128);
    this.H = Math.max(8, this.def.height | 0 || 128);

    /** @type {Map<string, object[]>} instanced placements, keyed kind|variant|style */
    this._instQueue = new Map();
    /** @type {Map<string, Kit>} */
    this._instKits = new Map();

    try {
      this._buildExclusion();
      this._buildStructures();
      this._buildScatter();
      this._buildAmbientFx();
      this._buildLightPool();
    } catch (e) {
      console.warn('[props] build failed', e);
    }

    this._offWeather = bus.on('weather:wetness', (v) => {
      const w = typeof v === 'number' ? clamp01(v) : 0;
      this._wind.uWindAmp.value = 1 + w * 0.7;
    });
  }

  /* ------------------------------------------------------------- materials */

  _h(x, z) {
    const t = this.terrain;
    if (!t || typeof t.heightAt !== 'function') return 0;
    const y = t.heightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  }

  _slope(x, z) {
    const t = this.terrain;
    if (!t || typeof t.slopeAt !== 'function') return 0;
    const s = t.slopeAt(x, z);
    return Number.isFinite(s) ? s : 0;
  }

  _water(x, z) {
    const t = this.terrain;
    if (!t || typeof t.waterLevelAt !== 'function') return null;
    return t.waterLevelAt(x, z);
  }

  /** Resolve a material key (`name`, `name#rrggbb`, or one of our `__` specials). */
  _mat(key) {
    let m = this._matCache.get(key);
    if (m) return m;
    m = this._makeMat(key);
    this._matCache.set(key, m);
    return m;
  }

  _makeMat(key) {
    const lib = this.ctx.materials;
    if (key === '__flame') {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffb457, transparent: true, opacity: 0.85, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true,
        toneMapped: false, fog: false, name: 'props.flame',
      });
      this._mats.add(mat);
      return mat;
    }
    if (key === '__coal') {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a1208, emissive: 0xff5a14, emissiveIntensity: 1.35,
        roughness: 0.85, metalness: 0, vertexColors: true, name: 'props.coal',
      });
      this._mats.add(mat);
      return mat;
    }
    if (key === '__dark') {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x07070a, roughness: 1, metalness: 0, vertexColors: true, name: 'props.dark',
      });
      this._mats.add(mat);
      return mat;
    }
    if (key === '__banner_wind') return this._windMat('banner', 0.16);
    if (key === '__grass_wind') return this._windMat('grass', 0.10, 0x59683d);
    if (key.charCodeAt(0) === 33) return this._windMat(key.slice(1), 0.2);

    const hash = key.indexOf('#');
    const name = hash < 0 ? key : key.slice(0, hash);
    // The library's animated/exotic materials own their whole shader; don't
    // push a vertexColors define into them, just let the attribute go unused.
    const opts = SHADER_MATERIALS.has(name) ? {} : { vertexColors: true };
    if (hash >= 0) opts.color = parseInt(key.slice(hash + 1), 16);
    if (!lib || typeof lib.get !== 'function') {
      const mat = new THREE.MeshStandardMaterial({
        color: opts.color === undefined ? 0x9a9a9a : opts.color,
        roughness: 0.9, metalness: 0, vertexColors: true,
      });
      this._mats.add(mat);
      return mat;
    }
    return lib.get(name, opts);
  }

  /**
   * A cloned library material with a vertex-shader sway driven by `aWind`,
   * `uTime` and a per-instance phase read straight off `instanceMatrix`.
   */
  _windMat(name, amp, plainColor) {
    const lib = this.ctx.materials;
    let mat;
    if (plainColor !== undefined) {
      // Grass uses its authored blade silhouette, not the very dark bush
      // cut-out texture. Multiplying that texture by vertex + instance colour
      // drove distant tufts nearly black.
      mat = new THREE.MeshStandardMaterial({
        color: plainColor,
        roughness: 0.94,
        metalness: 0,
        vertexColors: true,
        side: THREE.DoubleSide,
      });
    } else if (lib && typeof lib.get === 'function') {
      mat = lib.get(name, { vertexColors: true }).clone();
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: 0x5a7a3a,
        roughness: 0.9,
        metalness: 0,
        vertexColors: true,
        side: THREE.DoubleSide,
      });
    }
    mat.name = `${name}.wind`;
    const U = this._wind;
    const A = amp === undefined ? 0.2 : amp;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = U.uTime;
      shader.uniforms.uWindDir = U.uWindDir;
      shader.uniforms.uWindAmp = U.uWindAmp;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindAmp;
attribute float aWind;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float wPhase = 0.0;
  #ifdef USE_INSTANCING
    wPhase = instanceMatrix[3].x * 0.83 + instanceMatrix[3].z * 0.61;
  #endif
  float wT = uTime * 1.35 + wPhase;
  float wSway = sin( wT ) * 0.55 + sin( wT * 2.17 + 1.3 ) * 0.28 + sin( wT * 0.43 ) * 0.4;
  float wAmt = aWind * uWindAmp * ${A.toFixed(3)};
  transformed.x += uWindDir.x * wSway * wAmt;
  transformed.z += uWindDir.y * wSway * wAmt;
  transformed.y -= abs( wSway ) * wAmt * 0.18;
}`);
    };
    mat.customProgramCacheKey = () => `props.wind.${name}`;
    mat.needsUpdate = true;
    this._mats.add(mat);
    return mat;
  }

  /** A hanging sign board: vertical zh-CN characters painted on planking. */
  _signTexture(text) {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 384;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, '#3a2418');
    g.addColorStop(0.5, '#54341f');
    g.addColorStop(1, '#33200f');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 384);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 26; i++) {
      c.beginPath();
      c.moveTo(0, i * 15 + (i % 3));
      c.lineTo(128, i * 15 + ((i * 7) % 5));
      c.stroke();
    }
    c.strokeStyle = '#c8a24a';
    c.lineWidth = 6;
    c.strokeRect(8, 8, 112, 368);
    const chars = String(text || '').slice(0, 4).split('');
    const size = chars.length > 3 ? 68 : 78;
    c.font = `600 ${size}px "Songti SC","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const step = 360 / (chars.length + 0.4);
    for (let i = 0; i < chars.length; i++) {
      const y = 26 + step * (i + 0.5);
      c.fillStyle = '#1a0f06';
      c.fillText(chars[i], 66, y + 3);
      c.fillStyle = '#e8c163';
      c.fillText(chars[i], 64, y);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = (this.ctx.engine && this.ctx.engine.maxAniso) || 4;
    tex.needsUpdate = true;
    this._tex.add(tex);
    return tex;
  }

  /* ------------------------------------------------------- exclusion mask */

  /**
   * A per-tile mask saying where scatter may not go: structure footprints,
   * roads, portals, spawn pads and NPC posts. One byte per tile, built once,
   * so the scatter loop is an O(1) lookup instead of an O(structures) test.
   */
  _buildExclusion() {
    const W = this.W, H = this.H;
    const mask = new Uint8Array(W * H);
    this._mask = mask;

    const stamp = (x0, z0, x1, z1, bits) => {
      const i0 = Math.max(0, Math.floor(x0)), i1 = Math.min(W - 1, Math.ceil(x1));
      const j0 = Math.max(0, Math.floor(z0)), j1 = Math.min(H - 1, Math.ceil(z1));
      for (let j = j0; j <= j1; j++) {
        const row = j * W;
        for (let i = i0; i <= i1; i++) mask[row + i] |= bits;
      }
    };
    const disc = (cx, cz, r, bits) => {
      const i0 = Math.max(0, Math.floor(cx - r)), i1 = Math.min(W - 1, Math.ceil(cx + r));
      const j0 = Math.max(0, Math.floor(cz - r)), j1 = Math.min(H - 1, Math.ceil(cz + r));
      const r2 = r * r;
      for (let j = j0; j <= j1; j++) {
        const dz = j + 0.5 - cz, row = j * W;
        for (let i = i0; i <= i1; i++) {
          const dx = i + 0.5 - cx;
          if (dx * dx + dz * dz <= r2) mask[row + i] |= bits;
        }
      }
    };

    for (const s of this.def.structures || []) {
      if (!s) continue;
      if (s.w > 0 && s.d > 0) {
        const pad = s.hidden ? 0.5 : 1.6;
        stamp(s.x - s.w / 2 - pad, s.z - s.d / 2 - pad, s.x + s.w / 2 + pad, s.z + s.d / 2 + pad,
          EX_BIG | EX_SMALL);
      } else {
        disc(s.x, s.z, (s.r || 0.6) + 1.4, EX_BIG | EX_SMALL);
      }
    }

    const t = this.def.terrain || {};
    for (const r of t.roads || []) {
      if (!r || !r.pts || r.pts.length < 2) continue;
      const half = (r.width || 4) * 0.5;
      for (let k = 1; k < r.pts.length; k++) {
        const ax = r.pts[k - 1][0], az = r.pts[k - 1][1];
        const bx = r.pts[k][0], bz = r.pts[k][1];
        const pad = half + 2.5;
        const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
        const i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + pad));
        const j0 = Math.max(0, Math.floor(Math.min(az, bz) - pad));
        const j1 = Math.min(H - 1, Math.ceil(Math.max(az, bz) + pad));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const dd = distSeg(i + 0.5, j + 0.5, ax, az, bx, bz);
            if (dd < half + 1.6) mask[j * W + i] |= EX_BIG;
            if (dd < half - 0.4) mask[j * W + i] |= EX_SMALL;
          }
        }
      }
    }

    if (this.def.entry) disc(this.def.entry.x + 0.5, this.def.entry.z + 0.5, 5, EX_BIG);
    for (const p of this.def.portals || []) disc(p.x + 0.5, p.z + 0.5, 5, EX_BIG);
    for (const n of this.def.npcs || []) disc(n.x, n.z, 3.2, EX_BIG | EX_SMALL);
    for (const sp of this.def.spawns || []) {
      // keep the middle of a spawn ring open so monsters have somewhere to stand
      if (sp && sp.area) disc(sp.area.x, sp.area.z, Math.min(4, (sp.area.r || 8) * 0.35), EX_BIG);
    }
  }

  _blocked(x, z, bits) {
    const i = x | 0, j = z | 0;
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return true;
    return (this._mask[j * this.W + i] & bits) !== 0;
  }

  /* ------------------------------------------------------------ structures */

  /** Circle blockers for one structure, matching MapDefs' nav conventions. */
  _blockersFor(s) {
    if (!s || s.walkable === true || NON_BLOCKING.has(s.kind)) return;
    if (s.w > 0 && s.d > 0) {
      const step = s.hidden ? 2.0 : 1.35;
      const rad = s.hidden ? 1.45 : 1.0;
      const nx = Math.max(1, Math.ceil(s.w / step));
      const nz = Math.max(1, Math.ceil(s.d / step));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          this.blockers.push({
            x: s.x - s.w / 2 + (i + 0.5) * (s.w / nx),
            z: s.z - s.d / 2 + (j + 0.5) * (s.d / nz),
            r: rad,
          });
        }
      }
    } else {
      const r = s.r !== undefined ? s.r : (DEFAULT_RADIUS[s.kind] !== undefined ? DEFAULT_RADIUS[s.kind] : 0.6);
      if (r > 0) this.blockers.push({ x: s.x, z: s.z, r });
    }
  }

  /** Recorder handed to the builders so they can emit non-geometry payloads. */
  _recorder(kit, s, st) {
    const rec = { lights: [], fx: [], interact: [], blockers: [], signs: [] };
    return {
      kit, s, st, rng: this.rng, rec,
      light: (x, y, z, o) => rec.lights.push({ x, y, z, o: o || {} }),
      fx: (name, x, y, z) => rec.fx.push({ name, x, y, z }),
      interact: (o) => rec.interact.push(o),
      blocker: (x, z, r) => rec.blockers.push({ x, z, r }),
      sign: (text, x, y, z) => rec.signs.push({ text, x, y, z }),
    };
  }

  _buildStructures() {
    const list = this.def.structures || [];
    for (const s of list) {
      if (!s || !s.kind) continue;
      this._blockersFor(s);
      if (s.hidden) continue;
      try {
        if (INSTANCED_KINDS.has(s.kind)) this._queueInstance(s);
        else this._buildUnique(s);
      } catch (e) {
        console.warn(`[props] structure '${s.kind}' failed`, e);
      }
    }
    this._flushInstanced();
  }

  /** Modeled GLB if one exists, otherwise procedural geometry. */
  _tryAsset(name) {
    const a = this.ctx.assets;
    if (!a || typeof a.has !== 'function' || !a.has(name)) return null;
    try { return a.prop(name, this.ctx.materials); } catch (e) { return null; }
  }

  _buildUnique(s) {
    const st = styleOf(s.style);
    const y = this._h(s.x, s.z);
    const holder = new THREE.Group();
    holder.name = `prop:${s.kind}`;
    holder.position.set(s.x, y, s.z);
    holder.rotation.y = s.rot || 0;

    const modeled = this._tryAsset(`prop_${String(s.kind).replace(/\./g, '_')}`);
    if (modeled) {
      holder.add(modeled);
      this.group.add(holder);
      return;
    }

    const kit = new Kit();
    const B = this._recorder(kit, s, st);
    switch (s.kind) {
      case 'wall.town': buildWallTown(B); break;
      case 'gate.town': buildGateTown(B); break;
      case 'temple.hall': buildTempleHall(B); break;
      case 'altar':
        buildAltarGeo(kit, st, this.rng, 0, 0, 0, 1.1);
        B.light(0, 1.4, 0, { color: 0xffb257, intensity: 2.4, distance: 11 });
        B.fx('brazier', 0, 1.25, 0);
        B.interact({
          kind: 'altar', label: '祭坛', x: 0, y: 1.0, z: 1.4, radius: 2.2,
          use: () => bus.emit('chat', { text: '祭坛上的血迹还没干透。', channel: 'system' }),
        });
        break;
      case 'bridge': buildBridge(B); break;
      case 'cave.mouth': buildCaveMouth(B); break;
      case 'lava.pool': buildLavaPool(B); break;
      case 'house.tiled':
      case 'house.thatch':
      case 'shop':
      case 'inn': buildBuilding(B, s.kind); break;
      default:
        // Unknown box-shaped kind: at least give it an honest massing.
        if (s.w > 0 && s.d > 0) buildWallTown(B);
        else buildCrate(B, 0);
        break;
    }

    const structureFade = STRUCTURE_SIGHT_KINDS.has(s.kind);
    const sightW = Math.max(4, s.w || 8);
    const sightD = Math.max(4, s.d || 6);
    const sightH = Math.max(3, s.h || 6);
    this._emitKit(kit, holder, {
      shadow: true,
      roofFade: true,
      structureFade,
      sightY: sightH * 0.54,
      sightRadius: Math.hypot(sightW * 0.5 + 1.2, sightD * 0.5 + 1.2, sightH * 0.56),
    });
    for (const sg of B.rec.signs) this._addSign(holder, sg);
    this._absorbRecord(B.rec, holder, s);
    if (holder.children.length) this.group.add(holder);
  }

  /** Turn a Kit's meshers into meshes under `parent`. */
  _emitKit(kit, parent, o) {
    const shadow = o && o.shadow;
    for (const [key, m] of kit.near) {
      const geo = m.geometry(key.charCodeAt(0) === 33 || key === '__banner_wind');
      if (!geo) continue;
      this._geoms.add(geo);
      const opaqueMat = this._mat(key);
      const matName = materialName(key);
      const isStructureShell = !!(o && o.structureFade) && STRUCTURE_SIGHT_MATERIALS.has(matName);
      const canFade = !!(o && o.roofFade) && (ROOF_MATERIALS.has(matName) || isStructureShell);
      let fadeMat = null;
      if (canFade) {
        // Clone at build time, never in update(). Textures remain shared and
        // owned by MaterialLibrary; this Props instance owns only the material.
        fadeMat = opaqueMat.clone();
        fadeMat.name = `${opaqueMat.name || matName}.sightFade`;
        fadeMat.transparent = true;
        fadeMat.opacity = 1;
        fadeMat.depthWrite = false;
        fadeMat.needsUpdate = true;
        this._mats.add(fadeMat);
      }
      const mesh = new THREE.Mesh(geo, opaqueMat);
      mesh.castShadow = !!shadow && key !== '__flame' && key !== '__dark';
      mesh.receiveShadow = key !== '__flame';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      if (fadeMat) {
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const bounds = geo.boundingSphere;
        this._roofOccluders.push({
          mesh,
          parent,
          opaqueMat,
          fadeMat,
          alpha: 1,
          baseCastShadow: mesh.castShadow,
          // Every upper-shell part of a building shares the same sight volume.
          // This prevents the roof from fading while its beams and wall panels
          // continue to hide the player underneath.
          localX: isStructureShell ? 0 : (bounds ? bounds.center.x : 0),
          localY: isStructureShell ? o.sightY : (bounds ? bounds.center.y : 0),
          localZ: isStructureShell ? 0 : (bounds ? bounds.center.z : 0),
          radius: isStructureShell
            ? Math.max(2.5, o.sightRadius || 5)
            : Math.max(1.5, bounds ? bounds.radius : 4),
        });
      }
    }
    if (this.quality === 'low') return;
    for (const [key, m] of kit.far) {
      const geo = m.geometry(key.charCodeAt(0) === 33 || key === '__banner_wind');
      if (!geo) continue;
      this._geoms.add(geo);
      const opaqueMat = this._mat(key);
      const matName = materialName(key);
      const isStructureShell = !!(o && o.structureFade) && STRUCTURE_SIGHT_MATERIALS.has(matName);
      const canFade = !!(o && o.roofFade) && (ROOF_MATERIALS.has(matName) || isStructureShell);
      let fadeMat = null;
      if (canFade) {
        fadeMat = opaqueMat.clone();
        fadeMat.name = `${opaqueMat.name || matName}.sightFade.detail`;
        fadeMat.transparent = true;
        fadeMat.opacity = 1;
        fadeMat.depthWrite = false;
        fadeMat.needsUpdate = true;
        this._mats.add(fadeMat);
      }
      const mesh = new THREE.Mesh(geo, opaqueMat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.lodParent = parent;
      parent.add(mesh);
      this._lod.push(mesh);
      if (fadeMat) {
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const bounds = geo.boundingSphere;
        this._roofOccluders.push({
          mesh,
          parent,
          opaqueMat,
          fadeMat,
          alpha: 1,
          baseCastShadow: false,
          localX: isStructureShell ? 0 : (bounds ? bounds.center.x : 0),
          localY: isStructureShell ? o.sightY : (bounds ? bounds.center.y : 0),
          localZ: isStructureShell ? 0 : (bounds ? bounds.center.z : 0),
          radius: isStructureShell
            ? Math.max(2.5, o.sightRadius || 5)
            : Math.max(1.5, bounds ? bounds.radius : 4),
        });
      }
    }
  }

  _addSign(parent, sg) {
    const tex = this._signTexture(sg.text);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.82, metalness: 0, name: 'props.sign',
    });
    this._mats.add(mat);
    const geo = new THREE.BoxGeometry(0.62, 1.85, 0.12);
    this._geoms.add(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sg.x, sg.y, sg.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    // parent.matrixWorld is not up to date during construction, so place the
    // interactable by hand from the holder's transform
    const ca = Math.cos(parent.rotation.y), sa = Math.sin(parent.rotation.y);
    this.interactables.push({
      id: `sign:${sg.text}`, kind: 'sign', label: sg.text,
      position: new THREE.Vector3(
        parent.position.x + sg.x * ca + sg.z * sa,
        parent.position.y + sg.y,
        parent.position.z - sg.x * sa + sg.z * ca),
      radius: 2.0,
      onUse: () => bus.emit('chat', { text: `招牌上写着【${sg.text}】。`, channel: 'system' }),
    });
  }

  /** Move a builder's recorded lights/fx/interactables into world space. */
  _absorbRecord(rec, holder, s) {
    const rot = holder.rotation.y;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const wx = holder.position.x, wy = holder.position.y, wz = holder.position.z;
    const T = (x, y, z) => new THREE.Vector3(wx + x * ca + z * sa, wy + y, wz - x * sa + z * ca);

    for (const l of rec.lights) this._addLightSource(T(l.x, l.y, l.z), l.o);
    for (const f of rec.fx) this._addFxSource(f.name, T(f.x, f.y, f.z));
    for (const b of rec.blockers) {
      this.blockers.push({ x: wx + b.x * ca + b.z * sa, z: wz - b.x * sa + b.z * ca, r: b.r });
    }
    for (const it of rec.interact) {
      const pos = T(it.x, it.y, it.z);
      this.interactables.push({
        id: `${it.kind}:${Math.round(pos.x)},${Math.round(pos.z)}`,
        kind: it.kind,
        position: pos,
        radius: it.radius || 2.0,
        label: it.label || '',
        onUse: it.use || (() => {}),
      });
    }
    void s;
  }

  _addLightSource(pos, o) {
    this._lightSources.push({
      pos,
      color: o.color === undefined ? 0xffa04a : o.color,
      base: (o.intensity === undefined ? 3.0 : o.intensity) * 8,
      distance: o.distance === undefined ? 12 : o.distance,
      flicker: o.flicker === undefined ? 0.32 : o.flicker,
      phase: this.rng() * TAU,
      light: null,
      d2: 0,
    });
  }

  _addFxSource(name, pos, opts = EMPTY_FX_OPTS) {
    this._fxSources.push({ name, pos, opts, handle: null, d2: 0 });
  }

  /* --------------------------------------------------------- instancing */

  _queueInstance(s) {
    const kind = s.kind;
    const style = s.style || (this.def.biome === 'temple' ? 'temple'
      : this.def.biome === 'cave' ? 'cave' : this.def.biome === 'hell' ? 'lava'
        : this.def.biome === 'desert' ? 'sand' : 'stone');
    let variant = 0;
    if (kind === 'crate') variant = Math.floor(hash3(Math.round(s.x * 4), Math.round(s.z * 4), 3) * 3);
    else if (kind === 'cart') variant = s.stall ? 1 : 0;
    const key = `${kind}|${variant}|${style}`;
    if (!this._instKits.has(key)) this._instKits.set(key, this._makeInstKit(kind, variant, style));

    const y = this._h(s.x, s.z);
    const jitter = hash3(Math.round(s.x * 8), Math.round(s.z * 8), 17);
    let sx = 1, sy = 1, sz = 1, yaw = s.rot || 0;
    if (kind === 'fence' && s.len) sx = clamp(s.len / 3.0, 0.5, 1.6);
    if (kind === 'crate' || kind === 'barrel') {
      const v = 0.9 + jitter * 0.24;
      sx = sz = v; sy = v * (0.94 + jitter * 0.12);
      yaw += (jitter - 0.5) * 0.8;
    } else if (kind === 'tomb.stone' || kind === 'banner.pole') {
      const v = 0.88 + jitter * 0.3;
      sx = sz = v; sy = v;
      yaw += (jitter - 0.5) * (kind === 'tomb.stone' ? 1.2 : 0.4);
    } else if (kind !== 'torch.wall' && kind !== 'fence') {
      const v = 0.95 + jitter * 0.12;
      sx = sy = sz = v;
    }
    const tint = 0.9 + jitter * 0.2;

    let list = this._instQueue.get(key);
    if (!list) this._instQueue.set(key, (list = []));
    list.push({ x: s.x, y, z: s.z, yaw, sx, sy, sz, tint });
  }

  /** Build (once) the geometry + payload template for an instanced prop kind. */
  _makeInstKit(kind, variant, style) {
    const st = styleOf(style);
    const kit = new Kit();
    const B = this._recorder(kit, { kind, style }, st);
    switch (kind) {
      case 'temple.pillar': buildTemplePillar(B); break;
      case 'brazier': buildBrazier(B); break;
      case 'torch.wall': buildTorchWall(B); break;
      case 'well': buildWell(B); break;
      case 'cart': buildCart(B, variant === 1); break;
      case 'crate': buildCrate(B, variant); break;
      case 'barrel': buildBarrel(B); break;
      case 'fence': buildFence(B); break;
      case 'banner.pole': buildBannerPole(B); break;
      case 'tomb.stone': buildTombStone(B); break;
      case 'statue.beast': buildStatueBeast(B); break;
      case 'stairs': buildStairs(B); break;
      default: buildCrate(B, 0); break;
    }
    return { parts: this._partsFromKit(kit), rec: B.rec };
  }

  /**
   * Flatten a Kit into instanced-ready parts. Small props are cheap, so above
   * `low` their detail geometry is folded straight into the base mesher rather
   * than paying for a second draw call and an LOD test.
   */
  _partsFromKit(kit) {
    if (this.quality !== 'low') {
      for (const [key, m] of kit.far) {
        const near = kit.near.get(key);
        if (near) near.append(m, 0, 0, 0, 0);
        else kit.near.set(key, m);
      }
    }
    const parts = [];
    for (const [key, m] of kit.near) {
      const wind = key.charCodeAt(0) === 33 || key === '__banner_wind';
      const geo = m.geometry(wind);
      if (!geo) continue;
      this._geoms.add(geo);
      parts.push({ key, geo, wind });
    }
    return parts;
  }

  _flushInstanced() {
    for (const [key, list] of this._instQueue) {
      const kit = this._instKits.get(key);
      if (!kit || !list.length) continue;
      this._emitInstances(kit.parts, list, { shadow: true, name: key });
      // per-instance payloads
      for (const p of list) {
        const ca = Math.cos(p.yaw), sa = Math.sin(p.yaw);
        const T = (x, y, z) => new THREE.Vector3(
          p.x + (x * p.sx) * ca + (z * p.sz) * sa,
          p.y + y * p.sy,
          p.z - (x * p.sx) * sa + (z * p.sz) * ca);
        for (const l of kit.rec.lights) this._addLightSource(T(l.x, l.y, l.z), l.o);
        for (const f of kit.rec.fx) this._addFxSource(f.name, T(f.x, f.y, f.z));
        for (const it of kit.rec.interact) {
          const pos = T(it.x, it.y, it.z);
          this.interactables.push({
            id: `${it.kind}:${Math.round(pos.x)},${Math.round(pos.z)}`,
            kind: it.kind, position: pos, radius: it.radius || 2.0,
            label: it.label || '', onUse: it.use || (() => {}),
          });
        }
      }
    }
    this._instQueue.clear();
  }

  /**
   * Emit one InstancedMesh per (part, chunk). Chunking is what makes the
   * frustum useful: a single instanced mesh spanning the map is never culled.
   */
  _emitInstances(parts, list, o) {
    if (!parts.length || !list.length) return;
    // Chunking buys frustum culling but costs a draw call per chunk, so only
    // split populations big enough to pay for it. A hundred barrels spread over
    // a town are cheaper as one call than as twenty-five.
    const edge = list.length > 2500 ? CHUNK : list.length > 700 ? CHUNK * 2 : Infinity;
    const buckets = new Map();
    for (const p of list) {
      const ck = edge === Infinity ? 0
        : (Math.floor(p.z / edge) * 4096 + Math.floor(p.x / edge));
      let b = buckets.get(ck);
      if (!b) buckets.set(ck, (b = []));
      b.push(p);
    }
    for (const [, items] of buckets) {
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, this._mat(part.key), items.length);
        mesh.name = `inst:${o.name || ''}:${part.key}`;
        mesh.castShadow = !!o.shadow && part.key !== '__flame' && !o.noShadow;
        mesh.receiveShadow = part.key !== '__flame';
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          _wv.set(it.x, it.y, it.z);
          _wq.setFromAxisAngle(_up, it.yaw);
          _ws.set(it.sx, it.sy, it.sz);
          _wm.compose(_wv, _wq, _ws);
          mesh.setMatrixAt(i, _wm);
          const t = it.tint === undefined ? 1 : it.tint;
          if (it.cr !== undefined) _wc.setRGB(it.cr, it.cg, it.cb);
          else _wc.setRGB(t, t, t);
          mesh.setColorAt(i, _wc);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        if (o.lod) {
          mesh.castShadow = false;
          this._lod.push(mesh);
        }
        this.group.add(mesh);
      }
    }
  }

  /* -------------------------------------------------------------- scatter */

  /** Strongest grove covering (x,z), or null out in the open. */
  _groveAt(x, z) {
    let best = null, bestV = 0;
    for (const g of this._groves) {
      const dx = x - g.x, dz = z - g.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > g.r) continue;
      const v = (g.density === undefined ? 0.6 : g.density) * (1 - smoothstep(g.r * 0.45, g.r, dist));
      if (v > bestV) { bestV = v; best = g; }
    }
    return best ? { g: best, v: bestV } : null;
  }

  /**
   * Deterministic jittered-grid sampler. The lattice is what guarantees a gap
   * between trunks — pure rejection sampling clumps, and clumps seal the nav
   * grid inside a spawn ring.
   */
  _sample(cell, cb) {
    const rng = this.rng;
    const nx = Math.ceil(this.W / cell), nz = Math.ceil(this.H / cell);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.15 + rng() * 0.7) * cell;
        const z = (j + 0.15 + rng() * 0.7) * cell;
        if (x < 1.5 || z < 1.5 || x > this.W - 1.5 || z > this.H - 1.5) continue;
        cb(x, z, rng);
      }
    }
  }

  _buildScatter() {
    const flora = floraOf(this.def.biome);
    const t = this.def.terrain || {};
    this._groves = (t.groves || []).filter((g) => g && g.r > 0);
    this._ambient = this.def.safeZone || this.def.interior ? 0 : (flora.ambient || 0);
    const dens = this.density;

    this._scatterTrees(flora, dens);
    this._scatterBushes(flora, dens);
    this._scatterRocks(flora, dens);
    this._scatterLogs(flora, dens);
    this._scatterGrass(flora, dens);
    this._scatterFlowers(flora, dens);
    this._scatterReeds(flora, dens, t);
  }

  /**
   * Sparse looping ambience gives woodland silhouettes motion even while the
   * player is idle. These are candidates, not live emitters: the existing
   * nearest-N FX selector activates only the few close to the camera.
   */
  _buildAmbientFx() {
    if (this.def.biome !== 'meadow' || !this._groves.length) return;
    let fireflyToggle = 0;
    for (let i = 0; i < this._groves.length; i++) {
      const g = this._groves[i];
      if (!g || g.r < 5 || g.kind === 'palm') continue;
      const y = this._h(g.x, g.z);
      const scale = clamp(g.r / 7.5, 1.0, 2.8);
      this._addFxSource(
        'leaf.fall',
        new THREE.Vector3(g.x, y + 0.05, g.z),
        { scale }
      );
      // Alternate groves so the glints remain a discovery instead of visual
      // confetti. At noon bloom keeps them nearly invisible; dusk reveals them.
      if ((fireflyToggle++ & 1) === 0) {
        this._addFxSource(
          'firefly',
          new THREE.Vector3(g.x + g.r * 0.18, y + 0.08, g.z - g.r * 0.12),
          { scale: clamp(scale * 0.82, 1.0, 2.1) }
        );
      }
    }
  }

  /** Build (and cache) instanced parts from a set of meshers. */
  _parts(list) {
    const parts = [];
    for (const e of list) {
      if (!e || !e.m) continue;
      const wind = e.key.charCodeAt(0) === 33;
      const geo = e.m.geometry(true);
      if (!geo) continue;
      this._geoms.add(geo);
      parts.push({ key: e.key, geo, wind });
    }
    return parts;
  }

  _scatterTrees(flora, dens) {
    const species = flora.trees || [];
    if (!species.length) return;
    const hasGrove = this._groves.length > 0;
    if (!hasGrove && this._ambient <= 0) return;

    // three geometry variants per species so a wood never repeats a silhouette
    const kinds = Array.from(new Set(species.concat(this._groves.some((g) => g.kind === 'palm') ? ['palm'] : [])));
    const bank = new Map();
    for (const sp of kinds) {
      const vars = [];
      for (let v = 0; v < 3; v++) {
        const rng = makeRng(((this.def.seed | 0) ^ (v * 7919)) + sp.charCodeAt(0) * 104729);
        const tree = sp === 'pine' ? makePine(rng) : sp === 'palm' ? makePalm(rng) : makeTree(rng, sp);
        const leafKey = sp === 'pine' ? '!leaf.pine' : '!leaf';
        const parts = this._parts([
          { key: 'bark', m: tree.wood },
          { key: leafKey, m: tree.leaf },
        ]);
        vars.push({ parts, radius: tree.radius, height: tree.height, list: [] });
      }
      bank.set(sp, vars);
    }

    let placed = 0;
    const cap = Math.round(1800 * clamp(dens, 0.3, 1.6));
    this._sample(3.0, (x, z, rng) => {
      if (placed >= cap) return;
      if (this._blocked(x, z, EX_BIG)) return;
      if (this._water(x, z) !== null) return;
      if (this._slope(x, z) > 0.34) return;
      const gv = this._groveAt(x, z);
      const p = Math.max(gv ? gv.v : 0, this._ambient) * dens;
      if (p <= 0 || rng() > p) return;
      let sp = (gv && gv.g.kind === 'palm' && bank.has('palm')) ? 'palm' : species[Math.floor(rng() * species.length)];
      if (!bank.has(sp)) sp = kinds[0];
      const vars = bank.get(sp);
      const v = vars[Math.floor(rng() * vars.length)];
      const s = 0.8 + rng() * 0.55;
      const tint = 0.86 + rng() * 0.3;
      v.list.push({
        x, y: this._h(x, z) - 0.12, z, yaw: rng() * TAU,
        sx: s * (0.94 + rng() * 0.12), sy: s, sz: s * (0.94 + rng() * 0.12),
        cr: tint, cg: tint * (0.96 + rng() * 0.08), cb: tint * (0.92 + rng() * 0.1),
      });
      this.blockers.push({ x, z, r: Math.max(0.4, v.radius * s * 1.5) });
      placed++;
    });

    const leafShadow = this.quality === 'high' || this.quality === 'ultra';
    for (const vars of bank.values()) {
      for (const v of vars) {
        if (!v.list.length) continue;
        this._emitInstances(v.parts, v.list, { shadow: true, name: 'tree', noShadow: !leafShadow });
      }
    }
  }

  _scatterBushes(flora, dens) {
    if (!(flora.bush > 0)) return;
    const vars = [];
    for (let v = 0; v < 3; v++) {
      const rng = makeRng(((this.def.seed | 0) ^ 0x2b11) + v * 7717);
      const b = makeBush(rng);
      vars.push({ parts: this._parts([{ key: 'bark', m: b.wood }, { key: '!bush', m: b.leaf }]), list: [] });
    }
    this._sample(4.2, (x, z, rng) => {
      if (this._blocked(x, z, EX_BIG)) return;
      if (this._water(x, z) !== null) return;
      if (this._slope(x, z) > 0.44) return;
      const gv = this._groveAt(x, z);
      const p = flora.bush * dens * (0.45 + (gv ? gv.v : 0) * 0.9);
      if (rng() > p) return;
      const v = vars[Math.floor(rng() * vars.length)];
      const s = 0.75 + rng() * 0.75;
      const tint = 0.85 + rng() * 0.32;
      v.list.push({
        x, y: this._h(x, z) - 0.05, z, yaw: rng() * TAU, sx: s, sy: s * (0.8 + rng() * 0.5), sz: s,
        cr: tint * 0.98, cg: tint, cb: tint * 0.9,
      });
    });
    for (const v of vars) {
      if (v.list.length) this._emitInstances(v.parts, v.list, { shadow: false, name: 'bush' });
    }
  }

  _scatterRocks(flora, dens) {
    if (!(flora.rock > 0)) return;
    const vars = [];
    for (let v = 0; v < 4; v++) {
      const rng = makeRng(((this.def.seed | 0) ^ 0x51c3) + v * 3121);
      const geo = makeRockGeometry(rng);
      this._geoms.add(geo);
      vars.push({ parts: [{ key: 'rock', geo, wind: false }], list: [] });
    }
    const cap = Math.round(900 * clamp(dens, 0.3, 1.6));
    let placed = 0;
    this._sample(5.5, (x, z, rng) => {
      if (placed >= cap) return;
      if (this._blocked(x, z, EX_BIG)) return;
      if (this._water(x, z) !== null) return;
      const slope = this._slope(x, z);
      const p = flora.rock * dens * (0.5 + slope * 1.6);
      if (rng() > p) return;
      const v = vars[Math.floor(rng() * vars.length)];
      const s = 0.4 + rng() * rng() * 2.0;
      const tint = 0.82 + rng() * 0.34;
      v.list.push({
        x, y: this._h(x, z) - s * 0.22, z, yaw: rng() * TAU,
        sx: s * (0.85 + rng() * 0.4), sy: s * (0.7 + rng() * 0.5), sz: s * (0.85 + rng() * 0.4),
        cr: tint, cg: tint * (0.98 + rng() * 0.04), cb: tint * (0.96 + rng() * 0.08),
      });
      if (s > 0.75) this.blockers.push({ x, z, r: s * 0.6 });
      placed++;
    });
    for (const v of vars) {
      if (v.list.length) this._emitInstances(v.parts, v.list, { shadow: true, name: 'rock' });
    }
  }

  _scatterLogs(flora, dens) {
    if (!(flora.log > 0)) return;
    const vars = [];
    for (let v = 0; v < 3; v++) {
      const rng = makeRng(((this.def.seed | 0) ^ 0x70a1) + v * 911);
      const l = makeLog(rng);
      vars.push({ parts: this._parts([{ key: 'bark', m: l.wood }]), len: l.len, list: [] });
    }
    this._sample(17, (x, z, rng) => {
      if (this._blocked(x, z, EX_BIG)) return;
      if (this._water(x, z) !== null) return;
      if (this._slope(x, z) > 0.3) return;
      const gv = this._groveAt(x, z);
      if (rng() > flora.log * dens * (0.25 + (gv ? gv.v : 0))) return;
      const v = vars[Math.floor(rng() * vars.length)];
      const yaw = rng() * TAU;
      const s = 0.8 + rng() * 0.6;
      const tint = 0.82 + rng() * 0.3;
      v.list.push({
        x, y: this._h(x, z), z, yaw, sx: s, sy: s, sz: s,
        cr: tint, cg: tint * 0.97, cb: tint * 0.9,
      });
      const half = v.len * s * 0.32;
      this.blockers.push({ x: x + Math.sin(yaw) * half, z: z + Math.cos(yaw) * half, r: 0.4 });
      this.blockers.push({ x: x - Math.sin(yaw) * half, z: z - Math.cos(yaw) * half, r: 0.4 });
    });
    for (const v of vars) {
      if (v.list.length) this._emitInstances(v.parts, v.list, { shadow: true, name: 'log' });
    }
  }

  _scatterGrass(flora, dens) {
    if (!(flora.grass > 0)) return;
    const vars = [];
    for (let v = 0; v < 3; v++) {
      const rng = makeRng(((this.def.seed | 0) ^ 0x9911) + v * 1291);
      const g = makeGrass(rng, false);
      vars.push({ parts: this._parts([{ key: '__grass_wind', m: g.leaf }]), list: [] });
    }
    const cap = Math.round(6100 * clamp(dens, 0.25, 1.5));
    const palettes = [
      [0.74, 0.80, 0.58], // deep meadow olive
      [0.82, 0.78, 0.55], // dry yellow-green
      [0.66, 0.77, 0.62], // cool shaded grass
    ];
    let placed = 0;
    this._sample(1.95, (x, z, rng) => {
      if (placed >= cap) return;
      if (this._blocked(x, z, EX_SMALL)) return;
      if (this._water(x, z) !== null) return;
      if (this._slope(x, z) > 0.5) return;
      const patch = hash3(Math.round(x * 0.22), Math.round(z * 0.22), 91);
      const clump = 0.10 + smoothstep(0.24, 0.84, patch) * 0.84;
      if (rng() > flora.grass * dens * clump) return;
      const vi = Math.floor(rng() * vars.length);
      const v = vars[vi];
      const pal = palettes[vi];
      const s = 0.70 + rng() * 0.54;
      const tint = 0.86 + rng() * 0.16;
      v.list.push({
        x, y: this._h(x, z) - 0.015, z, yaw: rng() * TAU,
        sx: s * (0.82 + rng() * 0.28),
        sy: s * (0.66 + rng() * 0.46),
        sz: s * (0.82 + rng() * 0.28),
        cr: tint * pal[0], cg: tint * pal[1], cb: tint * pal[2],
      });
      placed++;
    });
    for (const v of vars) {
      if (v.list.length) this._emitInstances(v.parts, v.list, { shadow: false, name: 'grass' });
    }
  }

  _scatterFlowers(flora, dens) {
    if (!(flora.flower > 0)) return;
    const vars = [];
    for (let v = 0; v < 2; v++) {
      const rng = makeRng(((this.def.seed | 0) ^ 0x3f77) + v * 617);
      const f = makeFlower(rng);
      vars.push({ parts: this._parts([{ key: '!bush', m: f.leaf }]), list: [] });
    }
    const PAL = [
      [1.5, 1.35, 0.5], [1.5, 0.7, 0.75], [0.85, 0.9, 1.5], [1.5, 1.5, 1.35], [1.3, 0.6, 1.35],
    ];
    this._sample(2.6, (x, z, rng) => {
      if (this._blocked(x, z, EX_SMALL)) return;
      if (this._water(x, z) !== null) return;
      if (this._slope(x, z) > 0.42) return;
      const patch = hash3(Math.round(x * 0.18), Math.round(z * 0.18), 43);
      if (rng() > flora.flower * dens * (patch * 2.2)) return;
      const v = vars[Math.floor(rng() * vars.length)];
      const c = PAL[Math.floor(rng() * PAL.length)];
      const s = 0.8 + rng() * 0.7;
      v.list.push({
        x, y: this._h(x, z), z, yaw: rng() * TAU, sx: s, sy: s, sz: s,
        cr: c[0], cg: c[1], cb: c[2],
      });
    });
    for (const v of vars) {
      if (v.list.length) this._emitInstances(v.parts, v.list, { shadow: false, name: 'flower' });
    }
  }

  _scatterReeds(flora, dens, t) {
    if (!(flora.reed > 0) || !t.water || !t.water.length) return;
    const vars = [];
    for (let v = 0; v < 2; v++) {
      const rng = makeRng(((this.def.seed | 0) ^ 0x1d4c) + v * 331);
      const g = makeGrass(rng, true);
      vars.push({ parts: this._parts([{ key: '!bush', m: g.leaf }]), list: [] });
    }
    const rng = this.rng;
    for (const w of t.water) {
      const x0 = Math.min(w.x0, w.x1) - 4, x1 = Math.max(w.x0, w.x1) + 4;
      const z0 = Math.min(w.z0, w.z1) - 4, z1 = Math.max(w.z0, w.z1) + 4;
      for (let z = z0; z < z1; z += 1.1) {
        for (let x = x0; x < x1; x += 1.1) {
          const px = x + rng() * 0.9, pz = z + rng() * 0.9;
          if (px < 2 || pz < 2 || px > this.W - 2 || pz > this.H - 2) continue;
          if (this._blocked(px, pz, EX_SMALL)) continue;
          const level = typeof w.level === 'number' ? w.level : -0.9;
          const h = this._h(px, pz);
          if (h < level - 0.35 || h > level + 0.55) continue;
          if (rng() > 0.5 * dens) continue;
          const v = vars[Math.floor(rng() * vars.length)];
          const s = 0.8 + rng() * 0.8;
          const tint = 0.7 + rng() * 0.4;
          v.list.push({
            x: px, y: h - 0.05, z: pz, yaw: rng() * TAU, sx: s, sy: s * (0.8 + rng() * 0.7), sz: s,
            cr: tint * 1.05, cg: tint, cb: tint * 0.72,
          });
        }
      }
    }
    for (const v of vars) {
      if (v.list.length) this._emitInstances(v.parts, v.list, { shadow: false, name: 'reed' });
    }
  }

  /* --------------------------------------------------------------- lights */

  _buildLightPool() {
    const n = MAX_LIGHTS[this.quality] || 6;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 12, 2);
      l.castShadow = false;
      l.visible = false;
      l.matrixAutoUpdate = true;
      this.group.add(l);
      this._lightPool.push(l);
    }
    this._sel = new Array(n).fill(null);
    this._activeLights = [];
    this._maxFx = MAX_FX[this.quality] || 8;
    this._fxSel = new Array(this._maxFx).fill(null);
    this._activeFx = [];
  }

  /** Nearest-N selection into `sel`, no allocation. */
  static _selectNearest(sources, sel, cx, cy, cz, maxD2) {
    const N = sel.length;
    for (let i = 0; i < N; i++) sel[i] = null;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      const dx = s.pos.x - cx, dy = s.pos.y - cy, dz = s.pos.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      s.d2 = d2;
      if (d2 > maxD2) continue;
      const last = sel[N - 1];
      if (last && last.d2 <= d2) continue;
      let j = N - 1;
      while (j > 0 && (sel[j - 1] === null || sel[j - 1].d2 > d2)) { sel[j] = sel[j - 1]; j--; }
      sel[j] = s;
    }
  }

  _assignLights(cx, cy, cz) {
    const pool = this._lightPool;
    if (!pool.length || !this._lightSources.length) return;
    Props._selectNearest(this._lightSources, this._sel, cx, cy, cz, 62 * 62);
    for (let i = 0; i < this._activeLights.length; i++) this._activeLights[i].light = null;
    this._activeLights.length = 0;
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i];
      const src = this._sel[i];
      if (!src) { l.visible = false; l.userData.src = null; continue; }
      l.visible = true;
      l.position.copy(src.pos);
      l.color.setHex(src.color);
      l.distance = src.distance;
      l.decay = 2;
      l.intensity = src.base;
      l.userData.src = src;
      src.light = l;
      this._activeLights.push(src);
    }
  }

  _assignFx(cx, cy, cz) {
    const fx = this.ctx.fx;
    if (!fx || typeof fx.spawn !== 'function' || !this._fxSources.length) return;
    Props._selectNearest(this._fxSources, this._fxSel, cx, cy, cz, 44 * 44);
    for (let i = 0; i < this._activeFx.length; i++) {
      const s = this._activeFx[i];
      let keep = false;
      for (let k = 0; k < this._fxSel.length; k++) if (this._fxSel[k] === s) { keep = true; break; }
      if (!keep && s.handle) {
        try { s.handle.stop(); } catch (e) { /* already gone */ }
        s.handle = null;
      }
    }
    this._activeFx.length = 0;
    for (let i = 0; i < this._fxSel.length; i++) {
      const s = this._fxSel[i];
      if (!s || s.dead) continue;
      if (!s.handle || s.handle.alive === false) {
        let h = null;
        try { h = fx.spawn(s.name, s.pos, s.opts); } catch (e) { h = null; }
        // an effect the FxSystem doesn't know is never worth retrying
        if (!h || typeof h.stop !== 'function') { s.dead = true; s.handle = null; continue; }
        s.handle = h;
      }
      this._activeFx.push(s);
    }
  }

  _updateLod(cx, cz) {
    for (let i = 0; i < this._lod.length; i++) {
      const m = this._lod[i];
      const p = m.userData.lodParent;
      const x = p ? p.position.x : 0, z = p ? p.position.z : 0;
      const dx = x - cx, dz = z - cz;
      m.visible = (dx * dx + dz * dz) < LOD_DETAIL2;
    }
  }

  /**
   * Fade only the roof skin that crosses the camera-to-player sightline.
   * Walls, posts, eaves and ridge trim remain fully readable, so this behaves
   * like the classic RPG "roof reveal" while preserving architectural massing.
   * The math is deliberately scalar to keep update() allocation-free.
   */
  _updateRoofOcclusion(dt, camera) {
    const focus = this.ctx.engine && this.ctx.engine.camTarget;
    if (!camera || !camera.position || !focus) return;

    const ax = camera.position.x, ay = camera.position.y, az = camera.position.z;
    const vx = focus.x - ax, vy = focus.y - ay, vz = focus.z - az;
    const len2 = vx * vx + vy * vy + vz * vz;
    const ease = 1 - Math.exp(-Math.max(0, dt) * 8.5);

    for (let i = 0; i < this._roofOccluders.length; i++) {
      const r = this._roofOccluders[i];
      const p = r.parent.position;
      const yaw = r.parent.rotation.y;
      const ca = Math.cos(yaw), sa = Math.sin(yaw);
      const bx = p.x + r.localX * ca + r.localZ * sa;
      const by = p.y + r.localY;
      const bz = p.z - r.localX * sa + r.localZ * ca;

      let occlusion = 0;
      if (len2 > 1e-5) {
        const t = ((bx - ax) * vx + (by - ay) * vy + (bz - az) * vz) / len2;
        if (t > 0.035 && t < 1.045) {
          const px = ax + vx * t, py = ay + vy * t, pz = az + vz * t;
          const dx = bx - px, dy = by - py, dz = bz - pz;
          const lineDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          // Fade firmly once the camera ray enters the roof's broad projected
          // mass. The outer band avoids a hard pop at upturned eave corners.
          occlusion = 1 - smoothstep(r.radius * 0.70, r.radius * 1.20, lineDist);
        }
      }

      // Also reveal the interior whenever the focus itself is beneath a broad
      // roof, even at near-vertical camera angles.
      const tx = bx - focus.x, tz = bz - focus.z;
      const targetDist = Math.sqrt(tx * tx + tz * tz);
      const overTarget = 1 - smoothstep(r.radius * 0.48, r.radius * 1.02, targetDist);
      if (overTarget > occlusion) occlusion = overTarget;

      const goal = 1 - occlusion * 0.92;
      r.alpha += (goal - r.alpha) * ease;
      if (r.alpha >= 0.992) {
        if (r.mesh.material !== r.opaqueMat) r.mesh.material = r.opaqueMat;
        r.mesh.castShadow = r.baseCastShadow;
      } else {
        r.fadeMat.opacity = clamp(r.alpha, 0.08, 1);
        if (r.mesh.material !== r.fadeMat) r.mesh.material = r.fadeMat;
        r.mesh.castShadow = r.baseCastShadow && r.alpha > 0.62;
      }
    }
  }

  /* ---------------------------------------------------------------- frame */

  update(dt, camera) {
    if (this._disposed) return;
    const d = (typeof dt === 'number' && isFinite(dt)) ? dt : 0;
    this._time += d;
    this._wind.uTime.value = this._time;

    // slow gust envelope so the whole canopy breathes together
    this._gust += d;
    const gust = 0.82 + 0.3 * Math.sin(this._gust * 0.21) + 0.12 * Math.sin(this._gust * 0.73 + 1.1);
    this._wind.uWindDir.value.set(0.82 * gust, 0.57 * gust);

    const cam = camera || (this.ctx.engine && this.ctx.engine.camera);
    if (cam && cam.position) {
      _cam.copy(cam.position);
    } else {
      _cam.set(this.W * 0.5, 0, this.H * 0.5);
    }
    this._updateRoofOcclusion(d, cam);

    this._lightTimer -= d;
    if (this._lightTimer <= 0) {
      this._lightTimer = 0.22;
      this._assignLights(_cam.x, _cam.y, _cam.z);
    }

    const t = this._time;
    for (let i = 0; i < this._lightPool.length; i++) {
      const l = this._lightPool[i];
      if (!l.visible) continue;
      const src = l.userData.src;
      if (!src) continue;
      const ph = src.phase;
      const f = 1 + src.flicker * (
        Math.sin(t * 9.1 + ph) * 0.5 + Math.sin(t * 17.3 + ph * 1.7) * 0.3 + Math.sin(t * 3.7 + ph * 0.5) * 0.2);
      l.intensity = src.base * (f < 0.35 ? 0.35 : f > 1.45 ? 1.45 : f);
    }

    this._fxTimer -= d;
    if (this._fxTimer <= 0) {
      this._fxTimer = 0.6;
      this._assignFx(_cam.x, _cam.y, _cam.z);
    }

    this._lodTimer -= d;
    if (this._lodTimer <= 0) {
      this._lodTimer = 0.3;
      this._updateLod(_cam.x, _cam.z);
    }
  }

  /* -------------------------------------------------------------- teardown */

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._offWeather) { this._offWeather(); this._offWeather = null; }

    for (const s of this._fxSources) {
      if (s.handle) {
        try { s.handle.stop(); } catch (e) { /* already gone */ }
        s.handle = null;
      }
    }
    this._fxSources.length = 0;
    this._lightSources.length = 0;
    if (this._activeLights) this._activeLights.length = 0;
    if (this._activeFx) this._activeFx.length = 0;

    for (const l of this._lightPool) {
      l.visible = false;
      if (l.parent) l.parent.remove(l);
      if (typeof l.dispose === 'function') l.dispose();
    }
    this._lightPool.length = 0;

    if (this.group.parent) this.group.parent.remove(this.group);
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const c = this.group.children[i];
      if (c.isInstancedMesh && typeof c.dispose === 'function') c.dispose();
      this.group.remove(c);
    }

    for (const g of this._geoms) { try { g.dispose(); } catch (e) { /* gone */ } }
    this._geoms.clear();
    // only materials we created ourselves; MaterialLibrary owns the rest
    for (const m of this._mats) { try { m.dispose(); } catch (e) { /* gone */ } }
    this._mats.clear();
    for (const tx of this._tex) { try { tx.dispose(); } catch (e) { /* gone */ } }
    this._tex.clear();
    this._matCache.clear();
    this._instKits.clear();
    this._instQueue.clear();
    this._lod.length = 0;
    this._roofOccluders.length = 0;
    this.blockers.length = 0;
    this.interactables.length = 0;
    this._mask = null;
  }
}

export default Props;
