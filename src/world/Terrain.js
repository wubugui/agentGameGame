/**
 * src/world/Terrain.js — heightfield ground, splatted PBR surface, water.
 * See docs/CONTRACTS.md §8.
 *
 * Design notes (English identifiers/comments, zh-CN only for user-facing text —
 * this module has none, it is pure geometry and shading):
 *
 *  - The heightfield is a plain Float32Array sampled `seg` times per Mir tile.
 *    `heightAt()` is a branch-light bilinear fetch into it, because entities call
 *    it several times per frame each. No raycasts, no allocation.
 *  - The ground is drawn by ONE MeshStandardMaterial patched through
 *    `onBeforeCompile`. Four surface layers live in two `DataArrayTexture`s
 *    (albedo.rgb + roughness.a, normal.rgb + height.a) so the whole splat costs
 *    two samplers instead of eight. Layers are combined with height-aware
 *    blending (`w + h*sharpness`, keep the top band) which gives crisp gravel
 *    edges instead of a muddy cross-fade, then a detail texture tiled ~8x the
 *    macro scale is multiplied in at close range and a very-low-frequency macro
 *    variation breaks up the tiling at distance.
 *  - Roads declared in `mapDef.terrain.roads` are rasterised into the splat
 *    weights *and* used to flatten the heightfield, so a track both looks and
 *    walks like a track.
 *  - Water regions carve a riverbed into the heightfield, mark their tiles
 *    unwalkable, and render a transparent surface with scrolling normals,
 *    depth-absorbed colour, a shoreline foam band derived from
 *    (waterLevel - terrainHeight), and a real half-resolution planar reflection
 *    at 'high'/'ultra' (fresnel + horizon/env fake at 'low'/'med').
 *
 * Known contract objection (implemented as specified anyway): §8 gives no way to
 * tell Terrain which tiles a bridge spans, so we read `mapDef.structures[]` for
 * `walkable === true` boxes and force those tiles walkable — otherwise the
 * carved river in 比奇城外 would cut the map in two.
 */

import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { QUALITY_PRESETS } from '../game/Config.js';

/* ========================================================================== *
 * 0. Small deterministic noise helpers (no allocation)
 * ========================================================================== */

function hash2i(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable-free value noise in [0,1]. */
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix + 1, iz, seed);
  const c = hash2i(ix, iz + 1, seed);
  const d = hash2i(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

/** fbm in [-1,1]. */
function fbm(x, z, seed, octaves, freq, gain, lacunarity) {
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (vnoise(x * f, z * f, seed + i * 1013) * 2 - 1);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged fbm in [0,1] — sharp crests, for hell. */
function ridged(x, z, seed, octaves, freq) {
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(x * f, z * f, seed + i * 787) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.52;
    f *= 2.07;
  }
  return norm > 0 ? sum / norm : 0;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function smoothstep(e0, e1, x) {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Squared distance from (px,pz) to segment (ax,az)-(bx,bz), plus the param t. */
const _seg = { d: 0, t: 0 };
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cz = az + dz * t;
  _seg.t = t;
  _seg.d = Math.hypot(px - cx, pz - cz);
  return _seg.d;
}

/* ========================================================================== *
 * 1. Biome tables
 * ========================================================================== */

const PAVED = new Set(['cobble', 'stone.floor', 'brick', 'temple.floor']);

/**
 * Each biome names four surface layers. Layer 0 is the base, layer 1 the
 * path/track, layer 2 the slope/cliff surface, layer 3 the accent (dry patches,
 * gravel, mud). `scale` is world-units^-1: 0.16 ≈ one texture per 6 tiles.
 */
const BIOMES = {
  meadow: {
    base: 'grass', path: 'dirt.road', slope: 'rock', accent: 'gravel',
    detail: 'gravel',
    scale: [0.165, 0.150, 0.115, 0.210],
    detailScale: 1.35,
    macroScale: 0.0115,
    slopeBand: [0.24, 0.55],
    patchFreq: 0.052,
    water: { shallow: 0x3d7a63, deep: 0x0a2429, absorb: 2.6, foam: 0.55 },
    roughBias: 1.0,
  },
  desert: {
    base: 'sand', path: 'dirt', slope: 'rock', accent: 'gravel',
    detail: 'sand',
    scale: [0.135, 0.150, 0.110, 0.200],
    detailScale: 1.5,
    macroScale: 0.009,
    slopeBand: [0.20, 0.48],
    patchFreq: 0.040,
    water: { shallow: 0x4d8f86, deep: 0x123a3f, absorb: 2.0, foam: 0.4 },
    roughBias: 1.05,
  },
  temple: {
    base: 'temple.floor', path: 'stone.floor', slope: 'cobble', accent: 'blood.floor',
    detail: 'gravel',
    scale: [0.130, 0.130, 0.150, 0.190],
    detailScale: 1.6,
    macroScale: 0.014,
    slopeBand: [0.18, 0.42],
    patchFreq: 0.070,
    water: { shallow: 0x36555f, deep: 0x0a1a20, absorb: 1.6, foam: 0.35 },
    roughBias: 0.95,
  },
  cave: {
    base: 'cave.floor', path: 'gravel', slope: 'rock', accent: 'mud',
    detail: 'gravel',
    scale: [0.145, 0.190, 0.120, 0.170],
    detailScale: 1.5,
    macroScale: 0.016,
    slopeBand: [0.18, 0.44],
    patchFreq: 0.085,
    water: { shallow: 0x2a4a55, deep: 0x08161c, absorb: 1.5, foam: 0.3 },
    roughBias: 1.0,
  },
  hell: {
    base: 'rock', path: 'gravel', slope: 'cliff', accent: 'blood.floor',
    detail: 'gravel',
    scale: [0.130, 0.185, 0.100, 0.175],
    detailScale: 1.45,
    macroScale: 0.013,
    slopeBand: [0.16, 0.40],
    patchFreq: 0.075,
    water: { shallow: 0xff7a24, deep: 0x8c1c05, absorb: 1.1, foam: 0.9 },
    roughBias: 1.05,
  },
};

/** Texture resolution for the layer arrays, per quality tier. */
const ARRAY_RES = { low: 256, med: 512, high: 512, ultra: 1024 };
/** Splat weight texels per tile. */
const SPLAT_PER_TILE = { low: 1, med: 1, high: 2, ultra: 2 };
/** Reflection render-target divisor (screen size / n). */
const REFLECT_DIV = { low: 0, med: 0, high: 3, ultra: 2 };

const CHUNK_TILES = 32;

/* ========================================================================== *
 * 2. Terrain
 * ========================================================================== */

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _v3d = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _size2 = new THREE.Vector2();

export class Terrain {
  /**
   * @param {object} mapDef  see MapDefs.js
   * @param {object} ctx     { engine, bus, forge, materials, fx, quality, rng }
   */
  constructor(mapDef, ctx) {
    this.def = mapDef || {};
    this.ctx = ctx;
    this.quality = (ctx && ctx.quality) || 'high';
    this.preset = QUALITY_PRESETS[this.quality] || QUALITY_PRESETS.high;

    const t = this.def.terrain || {};
    this.tdef = t;
    this.biomeName = BIOMES[this.def.biome] ? this.def.biome : 'meadow';
    this.biome = BIOMES[this.biomeName];

    this.W = Math.max(8, this.def.width | 0 || 128);
    this.H = Math.max(8, this.def.height | 0 || 128);
    this.seed = (this.def.seed | 0) || 1337;

    /** Heightfield samples per tile. */
    this.seg = Math.max(1, this.preset.terrainSeg | 0 || 1);
    this.hw = this.W * this.seg + 1;
    this.hh = this.H * this.seg + 1;

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    /** @type {THREE.Object3D[]} */
    this.pickTargets = [];

    /** @type {THREE.BufferGeometry[]} */
    this._geoms = [];
    /** @type {THREE.Texture[]} textures this module owns and must free */
    this._ownTex = [];
    /** @type {THREE.Material[]} */
    this._mats = [];
    /** @type {THREE.Mesh[]} */
    this._waterMeshes = [];

    this._time = 0;
    this._wetness = 0;
    this._reflectFrame = 0;
    this._disposed = false;

    // ---- build ---------------------------------------------------------
    this._buildHeightfield();
    this._buildWaterRegions();
    this._buildWalkable();
    this._buildSplat();
    this._buildAo();
    this._buildMaterial();
    this._buildChunks();
    this._buildWater();

    this._offWet = bus.on('weather:wetness', (v) => {
      const w = typeof v === 'number' ? clamp01(v) : clamp01(v && v.wetness);
      this._wetness = w;
    });
  }

  /* ---------------------------------------------------------------- height */

  _biomeHeight(wx, wz, amp) {
    const s = this.seed;
    switch (this.biomeName) {
      case 'desert': {
        // Long dune crests marching NE, with a soft basin underneath.
        const warp = fbm(wx, wz, s + 71, 3, 1 / 55, 0.5, 2.0);
        const crest = Math.sin((wx * 0.075 + wz * 0.031) + warp * 3.4);
        const dune = Math.pow(clamp01(0.5 + 0.5 * crest), 1.7) - 0.42;
        const basin = fbm(wx, wz, s + 17, 3, 1 / 90, 0.5, 2.0) * 0.55;
        const grain = fbm(wx, wz, s + 233, 2, 1 / 9, 0.5, 2.0) * 0.05;
        return (dune * 1.15 + basin + grain) * amp;
      }
      case 'hell': {
        // Jagged: ridged crests, fissured, with sharp shoulders.
        const r = ridged(wx, wz, s + 41, 4, 1 / 26);
        const crack = 1 - Math.pow(1 - ridged(wx, wz, s + 401, 2, 1 / 13), 3);
        const base = fbm(wx, wz, s + 5, 3, 1 / 70, 0.5, 2.0) * 0.4;
        return ((r - 0.42) * 1.5 + base - crack * 0.22) * amp;
      }
      case 'cave':
      case 'temple': {
        // Mostly flat with authored steps: quantised plateaus + a little grain.
        const n = fbm(wx, wz, s + 61, 3, 1 / 34, 0.5, 2.0);
        const steps = Math.round(n * 2.5) / 2.5;
        const grain = fbm(wx, wz, s + 907, 2, 1 / 7, 0.5, 2.0) * 0.12;
        return (steps * 0.9 + grain) * amp;
      }
      default: {
        // meadow: gentle rolling hills, a couple of broad rises.
        const broad = fbm(wx, wz, s + 3, 4, 1 / 62, 0.5, 2.05);
        const mid = fbm(wx, wz, s + 129, 3, 1 / 21, 0.5, 2.0) * 0.34;
        const fine = fbm(wx, wz, s + 631, 2, 1 / 6.5, 0.5, 2.0) * 0.06;
        // soften extremes so slopes stay walkable
        const v = broad + mid + fine;
        return (v / (1 + Math.abs(v) * 0.45)) * amp;
      }
    }
  }

  _buildHeightfield() {
    const { hw, hh, seg } = this;
    const heights = new Float32Array(hw * hh);
    this.heights = heights;

    const t = this.tdef;
    const scale = typeof t.heightScale === 'number' ? t.heightScale : 3.0;
    const flat = t.flat === true || this.def.interior === true;
    const amp = (flat ? scale * 0.22 : scale * 0.5);
    this._amp = amp;

    const invSeg = 1 / seg;
    for (let j = 0; j < hh; j++) {
      const wz = j * invSeg;
      const row = j * hw;
      for (let i = 0; i < hw; i++) {
        heights[row + i] = amp > 0 ? this._biomeHeight(i * invSeg, wz, amp) : 0;
      }
    }

    // ---- road influence field (also drives the splat) -------------------
    this._buildRoadFields();

    // ---- grade the ground along roads -----------------------------------
    if (this._roadAny) this._flattenAlongRoads();

    // ---- carve authored water regions ------------------------------------
    this._carveWater();

    // ---- flatten building footprints so structures don't float ----------
    this._flattenStructures();

    // ---- keep the entry and every portal on a sane pad -------------------
    const pads = [];
    if (this.def.entry) pads.push(this.def.entry);
    for (const p of this.def.portals || []) pads.push(p);
    for (const p of pads) this._flattenDisc(p.x + 0.5, p.z + 0.5, 3.5, 2.0);

    // stats used by the splat and by the water shader
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const v = heights[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    if (mx - mn < 1e-3) mx = mn + 1e-3;
    this.minHeight = mn;
    this.maxHeight = mx;
  }

  /** Rasterise every road into layer-1 / layer-3 weight fields. */
  _buildRoadFields() {
    const sr = SPLAT_PER_TILE[this.quality] || 1;
    this.splatRes = sr;
    const sw = this.W * sr, sh = this.H * sr;
    this.splatW = sw;
    this.splatH = sh;

    const roads = (this.tdef.roads || []).filter((r) => r && r.pts && r.pts.length >= 2);
    this._roadPaved = null;
    this._roadDirt = null;
    this._roadAny = null;

    // Which surface family wins which layer slot?
    let pavedBest = null, pavedScore = 0, dirtBest = null, dirtScore = 0;
    for (const r of roads) {
      let len = 0;
      for (let i = 1; i < r.pts.length; i++) {
        len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      }
      const score = len * (r.width || 4);
      if (PAVED.has(r.surface)) {
        if (score > pavedScore) { pavedScore = score; pavedBest = r.surface; }
      } else if (score > dirtScore) { dirtScore = score; dirtBest = r.surface || this.biome.path; }
    }

    const b = this.biome;
    this.layerKinds = [
      this.tdef.base || b.base,
      pavedBest || dirtBest || b.path,
      b.slope,
      pavedBest ? (dirtBest || b.accent) : b.accent,
    ];
    // Natural dirt/gravel patches must not paint cobblestone into a meadow.
    this._patchLayer = pavedBest ? 3 : 1;

    if (!roads.length) return;

    const paved = new Float32Array(sw * sh);
    const dirt = new Float32Array(sw * sh);
    const any = new Float32Array(sw * sh);
    const inv = 1 / sr;

    for (const r of roads) {
      const target = (pavedBest && PAVED.has(r.surface)) ? paved : dirt;
      const halfW = Math.max(0.6, (r.width || 4) * 0.5);
      for (let k = 1; k < r.pts.length; k++) {
        const ax = r.pts[k - 1][0], az = r.pts[k - 1][1];
        const bx = r.pts[k][0], bz = r.pts[k][1];
        const pad = halfW + 2.5;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad) * sr));
        const i1 = Math.min(sw - 1, Math.ceil((Math.max(ax, bx) + pad) * sr));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - pad) * sr));
        const j1 = Math.min(sh - 1, Math.ceil((Math.max(az, bz) + pad) * sr));
        for (let j = j0; j <= j1; j++) {
          const wz = (j + 0.5) * inv;
          for (let i = i0; i <= i1; i++) {
            const wx = (i + 0.5) * inv;
            let d = distToSegment(wx, wz, ax, az, bx, bz);
            // wobble the verge so the track isn't a ruler-straight ribbon
            d += (vnoise(wx * 0.42, wz * 0.42, this.seed + 991) - 0.5) * 1.5;
            const v = 1 - smoothstep(halfW - 1.1, halfW + 0.5, d);
            if (v <= 0) continue;
            const idx = j * sw + i;
            if (v > target[idx]) target[idx] = v;
            if (v > any[idx]) any[idx] = v;
          }
        }
      }
    }

    this._roadPaved = pavedBest ? paved : null;
    this._roadDirt = dirt;
    this._roadAny = any;
    // When there is no paved family, all roads live in the dirt field but the
    // dirt field IS layer 1, so re-point it.
    this._roadLayer1 = pavedBest ? paved : dirt;
    this._roadLayer3 = pavedBest ? dirt : null;
  }

  /** Bilinear read of a splat-resolution field. */
  _fieldAt(field, wx, wz) {
    if (!field) return 0;
    const sr = this.splatRes, sw = this.splatW, sh = this.splatH;
    let fx = wx * sr - 0.5, fz = wz * sr - 0.5;
    fx = clamp(fx, 0, sw - 1.0001);
    fz = clamp(fz, 0, sh - 1.0001);
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const ix1 = Math.min(ix + 1, sw - 1), iz1 = Math.min(iz + 1, sh - 1);
    const a = field[iz * sw + ix], b = field[iz * sw + ix1];
    const c = field[iz1 * sw + ix], d = field[iz1 * sw + ix1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
  }

  _flattenAlongRoads() {
    const { hw, hh, seg, heights } = this;
    const blurred = new Float32Array(heights.length);
    const tmp = new Float32Array(heights.length);
    const R = Math.max(1, Math.round(seg * 2));

    // separable box blur, twice, wrapping clamped at the edges
    const passH = (src, dst) => {
      for (let j = 0; j < hh; j++) {
        const row = j * hw;
        for (let i = 0; i < hw; i++) {
          let s = 0, n = 0;
          for (let k = -R; k <= R; k++) {
            const x = i + k;
            if (x < 0 || x >= hw) continue;
            s += src[row + x]; n++;
          }
          dst[row + i] = s / n;
        }
      }
    };
    const passV = (src, dst) => {
      for (let j = 0; j < hh; j++) {
        for (let i = 0; i < hw; i++) {
          let s = 0, n = 0;
          for (let k = -R; k <= R; k++) {
            const y = j + k;
            if (y < 0 || y >= hh) continue;
            s += src[y * hw + i]; n++;
          }
          dst[j * hw + i] = s / n;
        }
      }
    };
    passH(heights, tmp);
    passV(tmp, blurred);
    passH(blurred, tmp);
    passV(tmp, blurred);

    const invSeg = 1 / seg;
    for (let j = 0; j < hh; j++) {
      const wz = j * invSeg, row = j * hw;
      for (let i = 0; i < hw; i++) {
        const w = this._fieldAt(this._roadAny, i * invSeg, wz);
        if (w <= 0.001) continue;
        const k = clamp01(w) * 0.88;
        heights[row + i] += (blurred[row + i] - heights[row + i]) * k;
      }
    }
  }

  _flattenDisc(cx, cz, radius, falloff) {
    const { hw, hh, seg, heights } = this;
    const i0 = Math.max(0, Math.floor((cx - radius - falloff) * seg));
    const i1 = Math.min(hw - 1, Math.ceil((cx + radius + falloff) * seg));
    const j0 = Math.max(0, Math.floor((cz - radius - falloff) * seg));
    const j1 = Math.min(hh - 1, Math.ceil((cz + radius + falloff) * seg));
    if (i1 < i0 || j1 < j0) return;
    let sum = 0, n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i / seg - cx, j / seg - cz);
        if (d > radius) continue;
        sum += heights[j * hw + i]; n++;
      }
    }
    if (!n) return;
    const target = sum / n;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i / seg - cx, j / seg - cz);
        const k = 1 - smoothstep(radius, radius + falloff, d);
        if (k <= 0) continue;
        const idx = j * hw + i;
        heights[idx] += (target - heights[idx]) * k;
      }
    }
  }

  _flattenStructures() {
    const list = this.def.structures || [];
    if (!list.length || this._amp <= 0) return;
    const { hw, hh, seg, heights } = this;
    for (const s of list) {
      if (!s || !(s.w > 0) || !(s.d > 0)) continue;
      const pad = 1.6;
      const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2;
      const z0 = s.z - s.d / 2, z1 = s.z + s.d / 2;
      const i0 = Math.max(0, Math.floor((x0 - pad) * seg));
      const i1 = Math.min(hw - 1, Math.ceil((x1 + pad) * seg));
      const j0 = Math.max(0, Math.floor((z0 - pad) * seg));
      const j1 = Math.min(hh - 1, Math.ceil((z1 + pad) * seg));
      if (i1 < i0 || j1 < j0) continue;
      let sum = 0, n = 0;
      for (let j = j0; j <= j1; j++) {
        const wz = j / seg;
        if (wz < z0 || wz > z1) continue;
        for (let i = i0; i <= i1; i++) {
          const wx = i / seg;
          if (wx < x0 || wx > x1) continue;
          sum += heights[j * hw + i]; n++;
        }
      }
      if (!n) continue;
      const target = sum / n;
      for (let j = j0; j <= j1; j++) {
        const wz = j / seg;
        const dz = Math.max(z0 - wz, wz - z1, 0);
        for (let i = i0; i <= i1; i++) {
          const wx = i / seg;
          const dx = Math.max(x0 - wx, wx - x1, 0);
          const d = Math.hypot(dx, dz);
          const k = 1 - smoothstep(0, pad, d);
          if (k <= 0) continue;
          const idx = j * hw + i;
          heights[idx] += (target - heights[idx]) * k;
        }
      }
    }
  }

  /* ------------------------------------------------------------- water defs */

  _buildWaterRegions() {
    /** @type {{x0,z0,x1,z1,level,lava:boolean}[]} */
    this.waterRegions = this._regions || [];
  }

  /** Collect authored water/lava rectangles, and carve a bed for each. */
  _carveWater() {
    const t = this.tdef;
    const regions = [];
    for (const w of t.water || []) {
      if (!w) continue;
      regions.push({
        x0: Math.min(w.x0, w.x1), z0: Math.min(w.z0, w.z1),
        x1: Math.max(w.x0, w.x1), z1: Math.max(w.z0, w.z1),
        level: typeof w.level === 'number' ? w.level : -0.9,
        lava: w.kind === 'lava',
        carve: w.carve !== false,
      });
    }
    if (typeof t.lavaLevel === 'number') {
      regions.push({
        x0: 0, z0: 0, x1: this.W, z1: this.H,
        level: t.lavaLevel, lava: true, carve: false,
      });
    }
    if (typeof t.waterLevel === 'number') {
      regions.push({
        x0: 0, z0: 0, x1: this.W, z1: this.H,
        level: t.waterLevel, lava: false, carve: false,
      });
    }

    const { hw, hh, seg, heights } = this;
    for (const r of regions) {
      if (!r.carve) continue;
      const margin = 5.0;
      const i0 = Math.max(0, Math.floor((r.x0 - margin) * seg));
      const i1 = Math.min(hw - 1, Math.ceil((r.x1 + margin) * seg));
      const j0 = Math.max(0, Math.floor((r.z0 - margin) * seg));
      const j1 = Math.min(hh - 1, Math.ceil((r.z1 + margin) * seg));
      const bed = r.level - 1.35;
      for (let j = j0; j <= j1; j++) {
        const wz = j / seg;
        const dz = Math.max(r.z0 - wz, wz - r.z1, 0);
        for (let i = i0; i <= i1; i++) {
          const wx = i / seg;
          const dx = Math.max(r.x0 - wx, wx - r.x1, 0);
          const d = Math.hypot(dx, dz);
          const k = 1 - smoothstep(0, margin, d);
          if (k <= 0) continue;
          // ragged bank + a deeper channel down the middle of the short axis
          const wobble = vnoise(wx * 0.16, wz * 0.16, this.seed + 313) * 0.55;
          const spanZ = Math.max(1e-3, r.z1 - r.z0);
          const spanX = Math.max(1e-3, r.x1 - r.x0);
          const tt = spanZ < spanX
            ? clamp01((wz - r.z0) / spanZ)
            : clamp01((wx - r.x0) / spanX);
          const channel = Math.sin(tt * Math.PI);
          const target = bed - channel * 0.75 + wobble;
          const idx = j * hw + i;
          const kk = clamp01(k * (0.55 + 0.45 * channel));
          if (heights[idx] > target) heights[idx] += (target - heights[idx]) * kk;
        }
      }
    }

    this._regions = regions;
  }

  /* ----------------------------------------------------------- walkability */

  _buildWalkable() {
    const W = this.W, H = this.H;
    const walk = new Uint8Array(W * H);
    this.walkable = walk;
    const flat = this.tdef.flat === true || this.def.interior === true;
    const slopeLimit = flat ? 0.62 : 0.42;

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const cx = x + 0.5, cz = z + 0.5;
        const h = this.heightAt(cx, cz);
        let ok = this.slopeAt(cx, cz) < slopeLimit;
        if (ok) {
          for (const r of this.waterRegions) {
            if (cx < r.x0 || cx > r.x1 || cz < r.z0 || cz > r.z1) continue;
            if (h < r.level) { ok = false; break; }
          }
        }
        walk[z * W + x] = ok ? 1 : 0;
      }
    }

    // Bridges, gates and stairs are authored crossings; never let a carved
    // river or a steep step make them impassable.
    for (const s of this.def.structures || []) {
      if (!s) continue;
      const crossing = s.walkable === true
        || s.kind === 'bridge' || s.kind === 'stairs' || s.kind === 'gate.town';
      if (!crossing) continue;
      const w = s.w > 0 ? s.w : (s.span || 4);
      const d = s.d > 0 ? s.d : (s.span || 4);
      const x0 = Math.floor(s.x - w / 2), x1 = Math.ceil(s.x + w / 2);
      const z0 = Math.floor(s.z - d / 2), z1 = Math.ceil(s.z + d / 2);
      for (let z = Math.max(0, z0); z < Math.min(H, z1); z++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) walk[z * W + x] = 1;
      }
    }
  }

  /* ------------------------------------------------------------- splat map */

  _buildSplat() {
    const sw = this.splatW, sh = this.splatH, sr = this.splatRes;
    const data = new Uint8Array(sw * sh * 4);
    const inv = 1 / sr;
    const b = this.biome;
    const [sb0, sb1] = b.slopeBand;
    const hMin = this.minHeight, hRange = Math.max(1e-3, this.maxHeight - this.minHeight);
    const patch = this._patchLayer;
    const w = [0, 0, 0, 0];
    const shoreLevel = this.waterRegions.length ? this.waterRegions[0].level : -1e9;

    for (let j = 0; j < sh; j++) {
      const wz = (j + 0.5) * inv;
      for (let i = 0; i < sw; i++) {
        const wx = (i + 0.5) * inv;
        const h = this.heightAt(wx, wz);
        const hN = clamp01((h - hMin) / hRange);
        const s = this.slopeAt(wx, wz);

        const n1 = vnoise(wx * b.patchFreq, wz * b.patchFreq, this.seed + 11);
        const n2 = vnoise(wx * 0.13, wz * 0.13, this.seed + 29);
        const n3 = vnoise(wx * 0.31, wz * 0.31, this.seed + 53);

        const slopeW = smoothstep(sb0, sb1, s) * (0.55 + 0.85 * n2);
        const patchW = smoothstep(0.50, 0.86, n1 * 0.72 + n3 * 0.28) * (0.6 + 0.7 * n3)
          + smoothstep(0.78, 1.0, hN) * 0.45;

        w[0] = 1.0;
        w[1] = 0.0;
        w[2] = slopeW * 1.75;
        w[3] = 0.0;
        w[patch] += patchW * 1.30;

        // riverbed / lakebed reads as silt, not lawn
        if (h < shoreLevel + 0.5) w[patch] += (1 - smoothstep(shoreLevel - 1.4, shoreLevel + 0.5, h)) * 2.2;

        const idx = j * sw + i;
        const r1 = this._roadLayer1 ? this._roadLayer1[idx] : 0;
        const r3 = this._roadLayer3 ? this._roadLayer3[idx] : 0;
        const rAny = Math.max(r1, r3);
        if (rAny > 0.001) {
          w[1] += r1 * 7.0;
          w[3] += r3 * 7.0;
          const suppress = 1 - rAny * 0.94;
          w[0] *= suppress;
          w[2] *= suppress;
          if (patch !== 1 && patch !== 3) w[patch] *= suppress;
        }

        let sum = w[0] + w[1] + w[2] + w[3];
        if (sum < 1e-5) { w[0] = 1; sum = 1; }
        const p = idx * 4;
        data[p] = (w[0] / sum) * 255;
        data[p + 1] = (w[1] / sum) * 255;
        data[p + 2] = (w[2] / sum) * 255;
        data[p + 3] = (w[3] / sum) * 255;
      }
    }

    const tex = new THREE.DataTexture(data, sw, sh, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 1;
    tex.needsUpdate = true;
    this.splatTex = tex;
    this._ownTex.push(tex);

    // road fields are only needed during the bake
    this._roadPaved = null;
    this._roadDirt = null;
    this._roadLayer1 = null;
    this._roadLayer3 = null;
  }

  /* --------------------------------------------------------------- ao bake */

  /** Nearest sample of the heightfield, clamped. Hot inner loop, no allocs. */
  _hs(i, j) {
    const hw = this.hw, hh = this.hh;
    const x = i < 0 ? 0 : i >= hw ? hw - 1 : i;
    const y = j < 0 ? 0 : j >= hh ? hh - 1 : j;
    return this.heights[y * hw + x];
  }

  _buildAo() {
    const W = this.W, H = this.H, seg = this.seg;
    const data = new Uint8Array(W * H * 4);
    const DIRS = 6;
    const STEPS = 5;
    const strength = this._amp > 0.05 ? 0.85 : 0.0;
    const dx = new Float32Array(DIRS), dz = new Float32Array(DIRS);
    for (let d = 0; d < DIRS; d++) {
      const a = (d / DIRS) * Math.PI * 2 + 0.3;
      dx[d] = Math.cos(a); dz[d] = Math.sin(a);
    }

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        let ao = 1;
        if (strength > 0) {
          const i0 = Math.round((x + 0.5) * seg);
          const j0 = Math.round((z + 0.5) * seg);
          const h0 = this._hs(i0, j0);
          let occ = 0;
          for (let d = 0; d < DIRS; d++) {
            let best = 0;
            for (let k = 1; k <= STEPS; k++) {
              const dist = k * 1.35;
              const hi = this._hs(Math.round(i0 + dx[d] * dist * seg), Math.round(j0 + dz[d] * dist * seg));
              const ang = (hi - h0) / dist;
              if (ang > best) best = ang;
            }
            occ += best / Math.sqrt(1 + best * best);
          }
          ao = clamp01(1 - (occ / DIRS) * strength);
          ao = 0.34 + ao * 0.66;
        }
        const v = ao * 255;
        const p = (z * W + x) * 4;
        data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255;
      }
    }

    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    tex.channel = 1;              // second UV set, per contract §8
    this.aoTex = tex;
    this._ownTex.push(tex);
  }

  /* -------------------------------------------------------- layer textures */

  /** Draw any three.js texture image into a 2D context at `size`. */
  static _drawInto(cx, tex, size) {
    const img = tex && tex.image;
    if (!img) {
      cx.fillStyle = '#7f7f7f';
      cx.fillRect(0, 0, size, size);
      return;
    }
    try {
      if (img.data && img.width && !img.tagName) {
        const tmp = document.createElement('canvas');
        tmp.width = img.width; tmp.height = img.height;
        const tc = tmp.getContext('2d');
        const id = tc.createImageData(img.width, img.height);
        const n = Math.min(id.data.length, img.data.length);
        for (let i = 0; i < n; i++) id.data[i] = img.data[i];
        tc.putImageData(id, 0, 0);
        cx.drawImage(tmp, 0, 0, size, size);
        tmp.width = tmp.height = 1;
      } else {
        cx.drawImage(img, 0, 0, size, size);
      }
    } catch (e) {
      cx.fillStyle = '#7f7f7f';
      cx.fillRect(0, 0, size, size);
    }
  }

  /**
   * Pack the four surface layers into two array textures:
   *   albedo : rgb = base colour (sRGB), a = roughness
   *   normal : rgb = tangent normal, a = layer height (blend weight)
   * Rows are written bottom-up so the arrays behave like flipY textures, which
   * is how every other texture in the game is oriented.
   */
  _buildLayerArrays() {
    const forge = this.ctx && this.ctx.forge;
    const res = ARRAY_RES[this.quality] || 512;
    const N = 4;
    const albBuf = new Uint8Array(res * res * 4 * N);
    const nrmBuf = new Uint8Array(res * res * 4 * N);

    const cv = document.createElement('canvas');
    cv.width = cv.height = res;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in cx) cx.imageSmoothingQuality = 'high';

    const layerSlice = res * res * 4;
    for (let L = 0; L < N; L++) {
      const kind = this.layerKinds[L];
      let set = null;
      if (forge) {
        try { set = forge.pbr(kind, { size: res }); } catch (e) { set = null; }
      }
      const base = L * layerSlice;

      // albedo
      Terrain._drawInto(cx, set && set.map, res);
      const alb = cx.getImageData(0, 0, res, res).data;
      // roughness (three reads .g from a roughnessMap)
      Terrain._drawInto(cx, set && set.roughnessMap, res);
      const rgh = cx.getImageData(0, 0, res, res).data;
      // normal
      Terrain._drawInto(cx, set && set.normalMap, res);
      const nrm = cx.getImageData(0, 0, res, res).data;

      const roughBias = this.biome.roughBias;
      for (let y = 0; y < res; y++) {
        const srcRow = (res - 1 - y) * res * 4;
        const dstRow = base + y * res * 4;
        for (let x = 0; x < res; x++) {
          const s = srcRow + x * 4;
          const d = dstRow + x * 4;
          const r = alb[s], g = alb[s + 1], bl = alb[s + 2];
          albBuf[d] = r;
          albBuf[d + 1] = g;
          albBuf[d + 2] = bl;
          albBuf[d + 3] = clamp(rgh[s + 1] * roughBias, 8, 255);
          nrmBuf[d] = nrm[s];
          nrmBuf[d + 1] = nrm[s + 1];
          nrmBuf[d + 2] = nrm[s + 2];
          // height proxy: perceptual luminance of the albedo
          nrmBuf[d + 3] = (r * 0.299 + g * 0.587 + bl * 0.114);
        }
      }
    }
    cv.width = cv.height = 1;

    const maxAniso = (this.ctx && this.ctx.engine && this.ctx.engine.maxAniso) || 4;

    const albTex = new THREE.DataArrayTexture(albBuf, res, res, N);
    albTex.format = THREE.RGBAFormat;
    albTex.type = THREE.UnsignedByteType;
    albTex.colorSpace = THREE.SRGBColorSpace;
    albTex.wrapS = albTex.wrapT = THREE.RepeatWrapping;
    albTex.minFilter = THREE.LinearMipmapLinearFilter;
    albTex.magFilter = THREE.LinearFilter;
    albTex.generateMipmaps = true;
    albTex.anisotropy = maxAniso;
    albTex.needsUpdate = true;

    const nrmTex = new THREE.DataArrayTexture(nrmBuf, res, res, N);
    nrmTex.format = THREE.RGBAFormat;
    nrmTex.type = THREE.UnsignedByteType;
    nrmTex.colorSpace = THREE.NoColorSpace;
    nrmTex.wrapS = nrmTex.wrapT = THREE.RepeatWrapping;
    nrmTex.minFilter = THREE.LinearMipmapLinearFilter;
    nrmTex.magFilter = THREE.LinearFilter;
    nrmTex.generateMipmaps = true;
    nrmTex.anisotropy = maxAniso;
    nrmTex.needsUpdate = true;

    this.layerAlbedo = albTex;
    this.layerNormal = nrmTex;
    this._ownTex.push(albTex, nrmTex);
  }

  /* ------------------------------------------------------- ground material */

  _buildMaterial() {
    this._buildLayerArrays();

    const forge = this.ctx && this.ctx.forge;
    let detail = null;
    if (forge) {
      try { detail = forge.pbr(this.biome.detail, { size: this.quality === 'low' ? 128 : 256 }); }
      catch (e) { detail = null; }
    }
    // forge textures are owned by the forge — reference, never dispose.
    const fallback = this._fallbackTexture();
    this._detailAlb = (detail && detail.map) || fallback;
    this._detailNrm = (detail && detail.normalMap) || fallback;

    const b = this.biome;
    const detailScale = b.scale[0] * (b.detailScale * 8);

    this.uniforms = {
      tLayerAlb: { value: this.layerAlbedo },
      tLayerNrm: { value: this.layerNormal },
      tSplat: { value: this.splatTex },
      tDetailAlb: { value: this._detailAlb },
      tDetailNrm: { value: this._detailNrm },
      uMapDim: { value: new THREE.Vector2(this.W, this.H) },
      uLayerScale: { value: new THREE.Vector4(b.scale[0], b.scale[1], b.scale[2], b.scale[3]) },
      uDetailScale: { value: detailScale },
      uMacroScale: { value: b.macroScale },
      uDetailFade: { value: new THREE.Vector2(16.0, 54.0) },
      uDetailAmount: { value: this.quality === 'low' ? 0.5 : 0.85 },
      uBlendSharp: { value: 0.55 },
      uBlendDepth: { value: 0.22 },
      uWetness: { value: 0 },
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      aoMap: this.aoTex,
      aoMapIntensity: 1.0,
      dithering: true,
    });
    mat.name = 'terrain.ground';
    mat.defines = mat.defines || {};
    if (this.quality !== 'low') mat.defines.TERRAIN_MACRO = '1';
    if (this.quality === 'high' || this.quality === 'ultra') mat.defines.TERRAIN_DETAIL_NORMAL = '1';

    const U = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      for (const k in U) shader.uniforms[k] = U[k];

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vTerrainWorld;
varying vec3 vTerrainNrm;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  vTerrainNrm = normalize( mat3( modelMatrix ) * objectNormal );`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vTerrainWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tLayerAlb;
uniform sampler2DArray tLayerNrm;
uniform sampler2D tSplat;
uniform sampler2D tDetailAlb;
uniform sampler2D tDetailNrm;
uniform vec2 uMapDim;
uniform vec4 uLayerScale;
uniform float uDetailScale;
uniform float uMacroScale;
uniform vec2 uDetailFade;
uniform float uDetailAmount;
uniform float uBlendSharp;
uniform float uBlendDepth;
uniform float uWetness;
varying vec3 vTerrainWorld;
varying vec3 vTerrainNrm;`)
        .replace('#include <map_fragment>', `
  vec2 tXZ = vTerrainWorld.xz;
  vec4 tW = texture2D( tSplat, tXZ / uMapDim );
  tW /= max( tW.x + tW.y + tW.z + tW.w, 1e-4 );

  vec2 tUv0 = tXZ * uLayerScale.x;
  vec2 tUv1 = tXZ * uLayerScale.y;
  vec2 tUv2 = tXZ * uLayerScale.z;
  vec2 tUv3 = tXZ * uLayerScale.w;

  vec4 tN0 = texture( tLayerNrm, vec3( tUv0, 0.0 ) );
  vec4 tN1 = texture( tLayerNrm, vec3( tUv1, 1.0 ) );
  vec4 tN2 = texture( tLayerNrm, vec3( tUv2, 2.0 ) );
  vec4 tN3 = texture( tLayerNrm, vec3( tUv3, 3.0 ) );

  // height-aware blend: keep only the top band so edges stay crisp
  vec4 tB = tW + vec4( tN0.a, tN1.a, tN2.a, tN3.a ) * uBlendSharp;
  float tMax = max( max( tB.x, tB.y ), max( tB.z, tB.w ) ) - uBlendDepth;
  tB = max( tB - tMax, vec4( 0.0 ) ) * step( vec4( 0.0008 ), tW );
  float tBs = tB.x + tB.y + tB.z + tB.w;
  tB = tBs > 1e-5 ? tB / tBs : vec4( 1.0, 0.0, 0.0, 0.0 );

  vec4 tA0 = texture( tLayerAlb, vec3( tUv0, 0.0 ) );
  vec4 tA1 = texture( tLayerAlb, vec3( tUv1, 1.0 ) );
  vec4 tA2 = texture( tLayerAlb, vec3( tUv2, 2.0 ) );
  vec4 tA3 = texture( tLayerAlb, vec3( tUv3, 3.0 ) );

  vec3 tAlbedo = tA0.rgb * tB.x + tA1.rgb * tB.y + tA2.rgb * tB.z + tA3.rgb * tB.w;
  float tRough = tA0.a * tB.x + tA1.a * tB.y + tA2.a * tB.z + tA3.a * tB.w;
  vec3 tNrmTS = ( tN0.xyz * tB.x + tN1.xyz * tB.y + tN2.xyz * tB.z + tN3.xyz * tB.w ) * 2.0 - 1.0;

  // close-range detail so the ground still reads when the camera zooms in
  float tDist = length( vViewPosition );
  float tDetAmt = ( 1.0 - smoothstep( uDetailFade.x, uDetailFade.y, tDist ) ) * uDetailAmount;
  vec3 tDet = texture2D( tDetailAlb, tXZ * uDetailScale ).rgb;
  float tDetLum = dot( tDet, vec3( 0.2126, 0.7152, 0.0722 ) );
  tAlbedo *= mix( 1.0, 0.62 + tDetLum * 0.86, tDetAmt );
  #ifdef TERRAIN_DETAIL_NORMAL
    vec3 tDetN = texture2D( tDetailNrm, tXZ * uDetailScale ).xyz * 2.0 - 1.0;
    tNrmTS.xy += tDetN.xy * tDetAmt * 0.75;
  #endif
  #ifdef TERRAIN_MACRO
    float tMacro = texture2D( tDetailAlb, tXZ * uMacroScale ).g;
    tAlbedo *= mix( 0.84, 1.15, tMacro );
  #endif

  // rain darkens and polishes the ground
  tAlbedo *= mix( 1.0, 0.66, uWetness );
  tRough = mix( tRough, 0.14, uWetness * 0.8 );
  tNrmTS.xy *= mix( 1.0, 0.45, uWetness );

  diffuseColor.rgb *= tAlbedo;
`)
        .replace('#include <roughnessmap_fragment>', `
  float roughnessFactor = clamp( tRough, 0.045, 1.0 );
`)
        .replace('#include <normal_fragment_maps>', `
  {
    vec3 tNw = normalize( vTerrainNrm );
    vec3 tAx = abs( tNw.x ) < 0.9 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 0.0, 1.0 );
    vec3 tTw = normalize( tAx - tNw * dot( tAx, tNw ) );
    vec3 tBw = cross( tTw, tNw );
    vec3 tN = normalize( tTw * tNrmTS.x + tBw * tNrmTS.y + tNw * max( tNrmTS.z, 0.08 ) );
    normal = normalize( ( viewMatrix * vec4( tN, 0.0 ) ).xyz );
  }
`);
    };

    this.material = mat;
    this._mats.push(mat);
  }

  /** 1x1 white texture used when the forge is unavailable. */
  _fallbackTexture() {
    if (this._fallbackTex) return this._fallbackTex;
    const d = new Uint8Array([128, 128, 255, 255]);
    const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    this._fallbackTex = t;
    this._ownTex.push(t);
    return t;
  }

  /* --------------------------------------------------------------- geometry */

  _buildChunks() {
    const { W, H, seg } = this;
    const cw = Math.min(CHUNK_TILES, W);
    const ch = Math.min(CHUNK_TILES, H);
    const nx = Math.ceil(W / cw);
    const nz = Math.ceil(H / ch);

    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        const tx0 = cx * cw;
        const tz0 = cz * ch;
        const tw = Math.min(cw, W - tx0);
        const th = Math.min(ch, H - tz0);
        if (tw <= 0 || th <= 0) continue;
        const geo = this._buildChunkGeometry(tx0, tz0, tw, th);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.name = `terrain.chunk.${cx}.${cz}`;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.userData.terrainChunk = true;
        this.group.add(mesh);
        this.pickTargets.push(mesh);
        this._geoms.push(geo);
      }
    }
  }

  _buildChunkGeometry(tx0, tz0, tw, th) {
    const seg = this.seg;
    const nu = tw * seg + 1;
    const nv = th * seg + 1;
    const count = nu * nv;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const uv1 = new Float32Array(count * 2);

    const invSeg = 1 / seg;
    const invW = 1 / this.W, invH = 1 / this.H;
    const macro = this.biome.scale[0];
    const e = invSeg;

    for (let j = 0; j < nv; j++) {
      const gj = tz0 * seg + j;
      const wz = gj * invSeg;
      for (let i = 0; i < nu; i++) {
        const gi = tx0 * seg + i;
        const wx = gi * invSeg;
        const k = j * nu + i;

        const h = this._hs(gi, gj);
        pos[k * 3] = wx;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = wz;

        const hl = this._hs(gi - 1, gj), hr = this._hs(gi + 1, gj);
        const hd = this._hs(gi, gj - 1), hu = this._hs(gi, gj + 1);
        const dhx = (hr - hl) / (2 * e);
        const dhz = (hu - hd) / (2 * e);
        const nx = -dhx, ny = 1, nz = -dhz;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nor[k * 3] = nx / len;
        nor[k * 3 + 1] = ny / len;
        nor[k * 3 + 2] = nz / len;

        uv[k * 2] = wx * macro;
        uv[k * 2 + 1] = wz * macro;
        uv1[k * 2] = wx * invW;
        uv1[k * 2 + 1] = wz * invH;
      }
    }

    const quads = (nu - 1) * (nv - 1);
    const IdxArray = count > 65535 ? Uint32Array : Uint16Array;
    const idx = new IdxArray(quads * 6);
    let p = 0;
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = j * nu + i;
        const b = a + 1;
        const c = a + nu;
        const d = c + 1;
        // wind CCW when viewed from +Y (X east, Z south, Y up)
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  /* ------------------------------------------------------------------ water */

  _buildWater() {
    const regions = this.waterRegions;
    if (!regions.length) { this._reflectRT = null; return; }

    // Only keep regions that actually contain submerged ground.
    const live = [];
    for (const r of regions) {
      let submerged = 0;
      const step = Math.max(1, Math.floor(Math.min(r.x1 - r.x0, r.z1 - r.z0) / 24) || 1);
      for (let z = Math.floor(r.z0); z < r.z1; z += step) {
        for (let x = Math.floor(r.x0); x < r.x1; x += step) {
          if (this.heightAt(x + 0.5, z + 0.5) < r.level) { submerged++; }
        }
      }
      if (submerged > 0) live.push(r);
    }
    if (!live.length) { this._reflectRT = null; return; }
    this._liveRegions = live;

    this._buildHeightTexture();

    const div = REFLECT_DIV[this.quality] || 0;
    const wantsReflect = div > 0 && live.some((r) => !r.lava);
    if (wantsReflect) this._makeReflectTarget(div);

    for (const r of live) this._makeWaterMesh(r, wantsReflect && !r.lava);
  }

  /** RGBA16F copy of the heightfield at tile-corner resolution. */
  _buildHeightTexture() {
    const W = this.W, H = this.H, seg = this.seg;
    const tw = W + 1, th = H + 1;
    const buf = new Uint16Array(tw * th * 4);
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const h = this._hs(i * seg, j * seg);
        const p = (j * tw + i) * 4;
        buf[p] = toHalf(h);
        buf[p + 1] = 0;
        buf[p + 2] = 0;
        buf[p + 3] = toHalf(1);
      }
    }
    const tex = new THREE.DataTexture(buf, tw, th, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.heightTex = tex;
    this._heightUv = new THREE.Vector4(1 / tw, 1 / th, 0.5 / tw, 0.5 / th);
    this._ownTex.push(tex);
  }

  _makeReflectTarget(div) {
    const renderer = this.ctx && this.ctx.engine && this.ctx.engine.renderer;
    if (!renderer) return;
    renderer.getDrawingBufferSize(_size2);
    const w = Math.max(64, Math.floor(_size2.x / div));
    const h = Math.max(64, Math.floor(_size2.y / div));
    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    rt.texture.name = 'terrain.reflection';
    rt.texture.colorSpace = THREE.NoColorSpace;
    this._reflectRT = rt;
    this._reflectDiv = div;
    this._reflectCam = new THREE.PerspectiveCamera();
    this._reflectMatrix = new THREE.Matrix4();
  }

  _makeWaterMesh(region, reflective) {
    const forge = this.ctx && this.ctx.forge;
    let waterNrm = this._fallbackTexture();
    if (forge) {
      try {
        const set = forge.pbr(region.lava ? 'lava' : 'water.normal', { size: 256 });
        if (set && set.normalMap) waterNrm = set.normalMap;
      } catch (e) { /* keep fallback */ }
    }

    const x0 = clamp(region.x0, 0, this.W);
    const x1 = clamp(region.x1, 0, this.W);
    const z0 = clamp(region.z0, 0, this.H);
    const z1 = clamp(region.z1, 0, this.H);
    const w = Math.max(1, x1 - x0);
    const d = Math.max(1, z1 - z0);
    const segX = clamp(Math.round(w / 4), 1, 64);
    const segZ = clamp(Math.round(d / 4), 1, 64);

    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, region.level, (z0 + z1) / 2);
    geo.computeBoundingSphere();
    this._geoms.push(geo);

    const pal = this.biome.water;
    const uniforms = {
      tWaterNrm: { value: waterNrm },
      tHeight: { value: this.heightTex },
      tReflect: { value: this._reflectRT ? this._reflectRT.texture : this._fallbackTexture() },
      uReflectMatrix: { value: this._reflectMatrix || new THREE.Matrix4() },
      uHeightUv: { value: this._heightUv },
      uLevel: { value: region.level },
      uShallow: { value: new THREE.Color(pal.shallow).convertSRGBToLinear() },
      uDeep: { value: new THREE.Color(pal.deep).convertSRGBToLinear() },
      uHorizon: { value: new THREE.Color(0x9fc4e0).convertSRGBToLinear() },
      uAbsorb: { value: pal.absorb },
      uFoam: { value: pal.foam },
      uTime: { value: 0 },
      uFlow: { value: region.lava ? 0.16 : 1.0 },
      uReflectAmount: { value: reflective ? 0.85 : 0.42 },
      uDistort: { value: reflective ? 0.045 : 0.0 },
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: region.lava ? 0.62 : 0.08,
      metalness: 0.0,
      transparent: !region.lava,
      opacity: 1.0,
      depthWrite: region.lava,
      side: THREE.FrontSide,
      emissive: region.lava ? new THREE.Color(0xff4a08) : new THREE.Color(0x000000),
      emissiveIntensity: region.lava ? 1.6 : 0.0,
      dithering: true,
    });
    mat.name = region.lava ? 'terrain.lava' : 'terrain.water';
    mat.defines = mat.defines || {};
    if (reflective) mat.defines.TERRAIN_PLANAR_REFLECT = '1';
    if (region.lava) mat.defines.TERRAIN_LAVA = '1';

    mat.onBeforeCompile = (shader) => {
      for (const k in uniforms) shader.uniforms[k] = uniforms[k];

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform mat4 uReflectMatrix;
varying vec3 vWaterWorld;
varying vec4 vWaterRefl;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vWaterRefl = uReflectMatrix * vec4( vWaterWorld, 1.0 );`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tWaterNrm;
uniform sampler2D tHeight;
uniform sampler2D tReflect;
uniform vec4 uHeightUv;
uniform float uLevel;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform float uAbsorb;
uniform float uFoam;
uniform float uTime;
uniform float uFlow;
uniform float uReflectAmount;
uniform float uDistort;
varying vec3 vWaterWorld;
varying vec4 vWaterRefl;`)
        .replace('#include <map_fragment>', `
  vec2 wXZ = vWaterWorld.xz;
  vec2 hUv = wXZ * uHeightUv.xy + uHeightUv.zw;
  float wGround = texture2D( tHeight, hUv ).r;
  float wDepth = uLevel - wGround;
  if ( wDepth < -0.05 ) discard;
  wDepth = max( wDepth, 0.0 );
  float wDN = clamp( wDepth / uAbsorb, 0.0, 1.0 );

  float wT = uTime * uFlow;
  vec2 wS1 = wXZ * 0.085 + vec2( wT * 0.030, wT * 0.019 );
  vec2 wS2 = wXZ * 0.215 - vec2( wT * 0.021, wT * 0.041 );
  vec3 wNa = texture2D( tWaterNrm, wS1 ).xyz * 2.0 - 1.0;
  vec3 wNb = texture2D( tWaterNrm, wS2 ).xyz * 2.0 - 1.0;
  vec3 wNts = normalize( vec3( wNa.xy + wNb.xy, max( wNa.z * wNb.z, 0.12 ) * 2.0 ) );
  wNts.xy *= mix( 0.22, 1.0, wDN );

  // shoreline foam from the depth difference, wobbled by the same noise field
  float wRipple = texture2D( tWaterNrm, wXZ * 0.33 + vec2( wT * 0.05, -wT * 0.037 ) ).x;
  float wFoamBand = 1.0 - smoothstep( 0.0, 0.42 + wRipple * 0.30, wDepth );
  float wFoam = wFoamBand * uFoam * step( 0.0, wDepth );

  vec3 wBody = mix( uShallow, uDeep, wDN * wDN * 0.75 + wDN * 0.25 );
  diffuseColor.rgb *= wBody;
  #ifdef TERRAIN_LAVA
    diffuseColor.a = 1.0;
    totalEmissiveRadiance *= mix( 0.45, 1.45, wRipple ) * ( 0.35 + 0.65 * ( 1.0 - wDN ) );
  #else
    diffuseColor.a = clamp( mix( 0.34, 0.95, wDN ) + wFoam * 0.55, 0.0, 1.0 );
  #endif
`)
        .replace('#include <normal_fragment_maps>', `
  {
    vec3 wNw = normalize( vec3( wNts.x, wNts.z, wNts.y ) );
    normal = normalize( ( viewMatrix * vec4( wNw, 0.0 ) ).xyz );
  }
`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
  {
    vec3 wRefl = uHorizon;
    #ifdef TERRAIN_PLANAR_REFLECT
      vec2 wRuv = vWaterRefl.xy / max( abs( vWaterRefl.w ), 1e-4 );
      wRuv += wNts.xy * uDistort;
      wRefl = texture2D( tReflect, clamp( wRuv, vec2( 0.002 ), vec2( 0.998 ) ) ).rgb;
    #endif
    vec3 wView = normalize( cameraPosition - vWaterWorld );
    float wF = pow( 1.0 - clamp( dot( wView, vec3( 0.0, 1.0, 0.0 ) ), 0.0, 1.0 ), 4.0 );
    wF = mix( 0.035, 1.0, wF );
    #ifdef TERRAIN_LAVA
      gl_FragColor.rgb += vec3( 1.0, 0.42, 0.10 ) * wFoam * 0.55;
    #else
      gl_FragColor.rgb = mix( gl_FragColor.rgb, wRefl, clamp( wF * uReflectAmount, 0.0, 0.92 ) );
      gl_FragColor.rgb += vec3( 0.90, 0.96, 1.0 ) * wFoam * 0.85;
      gl_FragColor.a = clamp( gl_FragColor.a + wFoam * 0.25, 0.0, 1.0 );
    #endif
  }
`);
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = mat.name;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = region.lava ? 0 : 2;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.waterUniforms = uniforms;
    mesh.userData.reflective = !!reflective;
    mesh.userData.level = region.level;

    this.group.add(mesh);
    this._waterMeshes.push(mesh);
    this._mats.push(mat);
  }

  /* ------------------------------------------------------------------ query */

  /** World-space Y at (x,z). Bilinear, allocation-free. */
  heightAt(x, z) {
    const hw = this.hw, hh = this.hh, seg = this.seg, H = this.heights;
    let fx = x * seg, fz = z * seg;
    if (!(fx >= 0)) fx = 0; else if (fx > hw - 1.0001) fx = hw - 1.0001;
    if (!(fz >= 0)) fz = 0; else if (fz > hh - 1.0001) fz = hh - 1.0001;
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const i0 = iz * hw + ix;
    const i1 = i0 + hw;
    const a = H[i0], b = H[i0 + 1], c = H[i1], d = H[i1 + 1];
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * tz;
  }

  /** 0 (flat) .. 1 (vertical). */
  slopeAt(x, z) {
    const e = 1 / this.seg;
    const dhx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dhz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const g = Math.sqrt(dhx * dhx + dhz * dhz);
    return g / (g + 1);
  }

  /** Static terrain walkability for a tile index. */
  walkableAt(tx, tz) {
    const x = tx | 0, z = tz | 0;
    if (x < 0 || z < 0 || x >= this.W || z >= this.H) return false;
    return this.walkable[z * this.W + x] === 1;
  }

  /** Water surface Y at a world position, or null when dry. */
  waterLevelAt(x, z) {
    for (const r of this._liveRegions || []) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      if (this.heightAt(x, z) < r.level) return r.level;
    }
    return null;
  }

  /* ------------------------------------------------------------------ frame */

  update(dt, camera) {
    if (this._disposed) return;
    this._time += dt;
    this.uniforms.uWetness.value += (this._wetness - this.uniforms.uWetness.value) * Math.min(1, dt * 1.8);

    if (!this._waterMeshes.length) return;

    const scene = this.ctx && this.ctx.engine && this.ctx.engine.scene;
    const fogCol = scene && scene.fog && scene.fog.color;
    for (const m of this._waterMeshes) {
      const u = m.userData.waterUniforms;
      u.uTime.value = this._time;
      if (fogCol) {
        u.uHorizon.value.setRGB(fogCol.r, fogCol.g, fogCol.b);
        // fog colour is already linear-working-space in three
      }
    }

    if (this._reflectRT && camera) this._renderReflection(camera);
  }

  _renderReflection(camera) {
    const engine = this.ctx.engine;
    const renderer = engine && engine.renderer;
    const scene = engine && engine.scene;
    if (!renderer || !scene) return;

    // ultra reflects every frame, high every other — the pass is a full scene draw
    this._reflectFrame++;
    if (this.quality !== 'ultra' && (this._reflectFrame & 1)) return;

    let any = false;
    for (const m of this._waterMeshes) if (m.userData.reflective && m.visible) any = true;
    if (!any) return;

    // keep the target in step with the canvas
    renderer.getDrawingBufferSize(_size2);
    const tw = Math.max(64, Math.floor(_size2.x / this._reflectDiv));
    const th = Math.max(64, Math.floor(_size2.y / this._reflectDiv));
    if (this._reflectRT.width !== tw || this._reflectRT.height !== th) {
      this._reflectRT.setSize(tw, th);
    }

    const level = this._waterMeshes[0].userData.level;
    const vc = this._reflectCam;

    camera.updateMatrixWorld();
    _v3a.setFromMatrixPosition(camera.matrixWorld);
    _mat4.extractRotation(camera.matrixWorld);
    _v3b.set(0, 0, -1).applyMatrix4(_mat4).add(_v3a);     // look-at point
    _v3c.set(0, 1, 0).applyMatrix4(_mat4);                // camera up

    // Mirror the whole camera frame about the horizontal water plane.
    vc.position.set(_v3a.x, 2 * level - _v3a.y, _v3a.z);
    _v3d.set(_v3b.x, 2 * level - _v3b.y, _v3b.z);
    vc.up.set(_v3c.x, -_v3c.y, _v3c.z);
    vc.lookAt(_v3d);
    vc.near = camera.near;
    vc.far = camera.far;
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    vc.updateMatrixWorld(true);

    this._reflectMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    this._reflectMatrix.multiply(vc.projectionMatrix);
    this._reflectMatrix.multiply(vc.matrixWorldInverse);

    const prevRT = renderer.getRenderTarget();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;

    for (const m of this._waterMeshes) m.visible = false;
    renderer.setRenderTarget(this._reflectRT);
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    for (const m of this._waterMeshes) m.visible = true;

    renderer.shadowMap.autoUpdate = prevShadowAuto;
  }

  /* ---------------------------------------------------------------- dispose */

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._offWet) { this._offWet(); this._offWet = null; }

    for (let i = this.group.children.length - 1; i >= 0; i--) {
      this.group.remove(this.group.children[i]);
    }
    if (this.group.parent) this.group.parent.remove(this.group);

    for (const g of this._geoms) g.dispose();
    this._geoms.length = 0;

    for (const m of this._mats) {
      m.onBeforeCompile = () => {};
      m.dispose();
    }
    this._mats.length = 0;

    for (const t of this._ownTex) {
      t.dispose();
      if (t.image && t.image.data) t.image.data = null;
    }
    this._ownTex.length = 0;

    if (this._reflectRT) { this._reflectRT.dispose(); this._reflectRT = null; }

    this.pickTargets.length = 0;
    this._waterMeshes.length = 0;
    this.heights = null;
    this.walkable = null;
    this.splatTex = null;
    this.aoTex = null;
    this.heightTex = null;
    this.layerAlbedo = null;
    this.layerNormal = null;
    this.material = null;
    this._detailAlb = null;
    this._detailNrm = null;
    this._fallbackTex = null;
  }
}

export default Terrain;
