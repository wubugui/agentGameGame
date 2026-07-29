/**
 * TextureForge — procedural PBR surface factory (CONTRACTS §1).
 *
 * Every pixel in the game is born here. Nothing is fetched, nothing is embedded:
 * each surface is composed from a small internal toolkit of *tileable* fields
 * (gradient fbm on a periodic lattice, worley cells, ridged noise, directional
 * streaks) plus a canvas-2D stroke pass for the surfaces that need real drawn
 * structure — grass blades, fur strands, cracks, thatch.
 *
 * Pipeline for every `kind`:
 *   1. a recipe fills three float/byte planes: albedo (RGBA), height, roughness
 *      (+ optional emissive RGBA),
 *   2. strokes are painted over those planes through wrapped canvases,
 *   3. the height field is converted to a tangent-space normal map and to a
 *      multi-scale ambient-occlusion approximation,
 *   4. everything is uploaded as CanvasTextures and cached by (kind + opts).
 *
 * Colour-space rule: albedo and emissive are SRGBColorSpace, normal/roughness/AO
 * stay NoColorSpace. All maps are RepeatWrapping + maxAniso unless the kind is a
 * sprite (clamped).
 */

import * as THREE from 'three';
import { makeRng } from '../core/Rng.js';

/* ========================================================================== *
 * 0. tiny math
 * ========================================================================== */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const d = e1 - e0;
  const t = sat(d === 0 ? (x < e0 ? 0 : 1) : (x - e0) / d);
  return t * t * (3 - 2 * t);
}

/** 32-bit integer hash. Deterministic across platforms. */
function hashi(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const hashf = (x, y, seed) => hashi(x, y, seed) / 4294967296;

/** HSL -> RGB in 0..255, written into `out`. */
function hsl2rgb(h, s, l, out) {
  h = h - Math.floor(h);
  s = sat(s); l = sat(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c * 0.5;
  out[0] = (r + m) * 255; out[1] = (g + m) * 255; out[2] = (b + m) * 255;
  return out;
}

const _c3 = [0, 0, 0];
const _c3b = [0, 0, 0];

function css(r, g, b) {
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}
function grey(v) {
  const c = Math.round(sat(v) * 255);
  return 'rgb(' + c + ',' + c + ',' + c + ')';
}

/* ========================================================================== *
 * 1. tileable noise toolkit
 * ========================================================================== */

/** Periodic gradient lattices, cached: building one is the only hashing cost. */
const _lattices = new Map();
function lattice(PX, PY, seed) {
  const key = PX + ':' + PY + ':' + seed;
  let L = _lattices.get(key);
  if (L) return L;
  const n = PX * PY;
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let y = 0; y < PY; y++) {
    for (let x = 0; x < PX; x++) {
      const a = hashf(x, y, seed) * TAU;
      const i = y * PX + x;
      gx[i] = Math.cos(a); gy[i] = Math.sin(a);
    }
  }
  L = { gx, gy };
  if (_lattices.size > 2048) _lattices.clear();
  _lattices.set(key, L);
  return L;
}

/**
 * Per-axis lattice tables: index pair + quintic fade for every texel column.
 * Computing these once per (N, period) removes the modulo from the inner loop,
 * which is where nearly all of the field-generation time used to go.
 */
const _axisCache = new Map();
function axisTable(N, P) {
  const key = N + ':' + P;
  let a = _axisCache.get(key);
  if (a) return a;
  const i0 = new Int32Array(N), i1 = new Int32Array(N);
  const tt = new Float32Array(N), ff = new Float32Array(N);
  const s = P / N;
  for (let x = 0; x < N; x++) {
    const v = x * s;
    let v0 = v | 0;
    if (v0 >= P) v0 = P - 1;
    i0[x] = v0;
    i1[x] = v0 + 1 === P ? 0 : v0 + 1;
    const f = v - v0;
    tt[x] = f;
    ff[x] = f * f * f * (f * (f * 6 - 15) + 10);
  }
  a = { i0, i1, t: tt, f: ff };
  if (_axisCache.size > 2048) _axisCache.clear();
  _axisCache.set(key, a);
  return a;
}

/** Wrapped cell index + unwrap offset for k in [-1, P], indexed by k+1. */
function wrapTable(P) {
  const wrap = new Int32Array(P + 2);
  const off = new Int32Array(P + 2);
  for (let k = -1; k <= P; k++) {
    let w = k % P; if (w < 0) w += P;
    wrap[k + 1] = w;
    off[k + 1] = k - w;
  }
  return { wrap, off };
}

/**
 * Accumulate one perlin octave over an N*N field. PX/PY are the lattice periods
 * in x and y, so a rectangular lattice gives directional (streaked) noise for
 * free — that single knob covers bark fissures, brushed metal and cloth weave.
 */
function addOctave(dst, N, PX, PY, seed, amp, warpX, warpY, warpAmt, ridged) {
  const L = lattice(PX, PY, seed);
  const gx = L.gx, gy = L.gy;

  if (warpX === null) {
    // Fast path: x maps monotonically into [0,PX) so the lattice indices and
    // the quintic fade weights can be tabulated once per axis and reused.
    const AX = axisTable(N, PX), AY = axisTable(N, PY);
    const ax0 = AX.i0, ax1 = AX.i1, axt = AX.t, axf = AX.f;
    for (let y = 0; y < N; y++) {
      const r0 = AY.i0[y] * PX, r1 = AY.i1[y] * PX;
      const ty = AY.t[y], ty1 = ty - 1, v = AY.f[y];
      const row = y * N;
      for (let x = 0; x < N; x++) {
        const x0 = ax0[x], x1 = ax1[x];
        const tx = axt[x], tx1 = tx - 1, u = axf[x];
        const i00 = r0 + x0, i10 = r0 + x1, i01 = r1 + x0, i11 = r1 + x1;
        const n00 = gx[i00] * tx + gy[i00] * ty;
        const n10 = gx[i10] * tx1 + gy[i10] * ty;
        const n01 = gx[i01] * tx + gy[i01] * ty1;
        const n11 = gx[i11] * tx1 + gy[i11] * ty1;
        const a = n00 + u * (n10 - n00);
        const b = n01 + u * (n11 - n01);
        let nv = a + v * (b - a);
        if (ridged) {
          nv = 1 - (nv < 0 ? -nv : nv) * 1.45;
          if (nv < 0) nv = 0;
          nv *= nv;
        }
        dst[row + x] += amp * nv;
      }
    }
    return;
  }

  // Warped path: sample positions leave the [0,P) range, so wrap explicitly.
  const sx = PX / N, sy = PY / N;
  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const ox = x + warpX[i] * warpAmt;
      const oy = y + warpY[i] * warpAmt;
      let fx = (ox * sx) % PX; if (fx < 0) fx += PX;
      let fy = (oy * sy) % PY; if (fy < 0) fy += PY;
      const x0 = fx | 0, y0 = fy | 0;
      const tx = fx - x0, ty = fy - y0;
      const x1 = x0 + 1 === PX ? 0 : x0 + 1;
      const y1 = y0 + 1 === PY ? 0 : y0 + 1;
      const r0 = y0 * PX, r1 = y1 * PX;
      const i00 = r0 + x0, i10 = r0 + x1, i01 = r1 + x0, i11 = r1 + x1;
      const tx1 = tx - 1, ty1 = ty - 1;
      const n00 = gx[i00] * tx + gy[i00] * ty;
      const n10 = gx[i10] * tx1 + gy[i10] * ty;
      const n01 = gx[i01] * tx + gy[i01] * ty1;
      const n11 = gx[i11] * tx1 + gy[i11] * ty1;
      const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
      const v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const a = n00 + u * (n10 - n00);
      const b = n01 + u * (n11 - n01);
      let nv = a + v * (b - a);
      if (ridged) {
        nv = 1 - Math.abs(nv * 1.45);
        if (nv < 0) nv = 0;
        nv *= nv;
      }
      dst[i] += amp * nv;
    }
  }
}

/** Smallest power of two >= v. */
function pow2ceil(v) {
  if (v <= 1) return 1;
  return 1 << (32 - Math.clz32(Math.ceil(v) - 1));
}

/**
 * Wrapped bilinear upsample with Hermite weights. Hermite (rather than plain
 * linear) keeps the first derivative continuous, so a field synthesised at a
 * reduced resolution shows no grid creases once it reaches the normal map.
 */
function upsampleWrap(src, R, N) {
  const dst = new Float32Array(N * N);
  const s = R / N;
  const i0 = new Int32Array(N), i1 = new Int32Array(N), tf = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const v = x * s;
    let v0 = v | 0;
    if (v0 >= R) v0 = R - 1;
    i0[x] = v0;
    i1[x] = v0 + 1 === R ? 0 : v0 + 1;
    const f = v - v0;
    tf[x] = f * f * (3 - 2 * f);
  }
  for (let y = 0; y < N; y++) {
    const r0 = i0[y] * R, r1 = i1[y] * R, ty = tf[y];
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const xa = i0[x], xb = i1[x], tx = tf[x];
      const a = src[r0 + xa], b = src[r0 + xb];
      const c = src[r1 + xa], d = src[r1 + xb];
      const top = a + (b - a) * tx;
      const bot = c + (d - c) * tx;
      dst[row + x] = top + (bot - top) * ty;
    }
  }
  return dst;
}

/**
 * Seamless fbm field. Result ~[-1,1] (or [0,1] when `ridged`).
 * `freqY` defaults to `freq`; set them apart for directional streaks.
 *
 * Low-frequency fields are synthesised at a reduced resolution and upsampled —
 * a 4-octave field topping out at 24 cycles carries no information at 1024²,
 * and paying full price for it is what makes a 40-surface world slow to build.
 */
function fbmField(N, {
  freq = 4, freqY = 0, octaves = 5, lacunarity = 2, gain = 0.5, seed = 1,
  warpX = null, warpY = null, warpAmt = 0, ridged = false, out = null,
} = {}) {
  // cap the finest lattice so one octave never degenerates into white noise
  const maxP = Math.max(4, Math.min(N, 512));
  const plan = [];
  let fX = Math.max(2, Math.round(freq));
  let fY = Math.max(2, Math.round(freqY || freq));
  let amp = 1, norm = 0, top = 2;
  for (let o = 0; o < octaves; o++) {
    plan.push(fX, fY, amp, (seed + o * 7919) | 0);
    if (fX > top) top = fX;
    if (fY > top) top = fY;
    norm += amp;
    amp *= gain;
    fX = Math.min(maxP, Math.max(2, Math.round(fX * lacunarity)));
    fY = Math.min(maxP, Math.max(2, Math.round(fY * lacunarity)));
  }

  // 5 samples per cycle of the finest octave is well past the point where the
  // upsample is visible; the warped path has to stay at full resolution
  // because the warp arrays are addressed per output texel.
  const R = (warpX !== null || out) ? N : Math.max(64, Math.min(N, pow2ceil(top * 5)));
  const work = R === N ? (out || new Float32Array(N * N)) : new Float32Array(R * R);
  work.fill(0);
  for (let i = 0; i < plan.length; i += 4) {
    addOctave(work, R, plan[i], plan[i + 1], plan[i + 3], plan[i + 2], warpX, warpY, warpAmt, ridged);
  }
  // Normalising by the amplitude *sum* leaves an fbm with only ~0.19 std, which
  // reads as flat once it is scaled into a lightness range. Normalise closer to
  // the RMS instead: peaks occasionally clip, which is what gives contrast.
  const k = (ridged ? 1 : 2.3) / norm;
  for (let i = 0; i < work.length; i++) work[i] *= k;
  return R === N ? work : upsampleWrap(work, R, N);
}

/** Box-average a wrapped field down to R x R (R must divide N). */
function downsampleField(src, N, R) {
  if (R >= N) return src;
  const dst = new Float32Array(R * R);
  const f = N / R;
  const inv = 1 / (f * f);
  for (let y = 0; y < R; y++) {
    const y0 = y * f;
    for (let x = 0; x < R; x++) {
      const x0 = x * f;
      let sum = 0;
      for (let j = 0; j < f; j++) {
        const row = (y0 + j) * N + x0;
        for (let i = 0; i < f; i++) sum += src[row + i];
      }
      dst[y * R + x] = sum * inv;
    }
  }
  return dst;
}

/** Nearest-neighbour upsample (used for per-cell ids, which must not blend). */
function upsampleNearest(src, R, N) {
  const dst = new Float32Array(N * N);
  const s = R / N;
  const ix = new Int32Array(N);
  for (let x = 0; x < N; x++) { let v = (x * s) | 0; if (v >= R) v = R - 1; ix[x] = v; }
  for (let y = 0; y < N; y++) {
    const row = ix[y] * R, out = y * N;
    for (let x = 0; x < N; x++) dst[out + x] = src[row + ix[x]];
  }
  return dst;
}

/**
 * Seamless worley/cellular field. Distances are in *cell* units so an
 * anisotropic cell grid stretches the cells (long vertical bark plates,
 * flattened cobbles) with no extra code.
 *
 * At 1024² a field with only a handful of cells is synthesised at a reduced
 * resolution: 40 samples across a cell is far more than its seam needs, and
 * the 4x saving is what keeps the ground set affordable.
 */
function worleyField(N, {
  cells = 8, cellsY = 0, seed = 1, jitter = 1,
  warpX = null, warpY = null, warpAmt = 0,
} = {}) {
  const PX = Math.max(1, Math.round(cells));
  const PY = Math.max(1, Math.round(cellsY || cells));

  if (N >= 1024) {
    const R = Math.max(256, Math.min(N, pow2ceil(Math.max(PX, PY) * 40)));
    if (R < N) {
      const w = worleyField(R, {
        cells: PX, cellsY: PY, seed, jitter,
        warpX: warpX ? downsampleField(warpX, N, R) : null,
        warpY: warpY ? downsampleField(warpY, N, R) : null,
        warpAmt: warpAmt * (R / N),
      });
      return {
        f1: upsampleWrap(w.f1, R, N),
        f2: upsampleWrap(w.f2, R, N),
        id: upsampleNearest(w.id, R, N),
        PX, PY,
      };
    }
  }

  const n = PX * PY;
  const px = new Float32Array(n), py = new Float32Array(n), hid = new Float32Array(n);
  for (let y = 0; y < PY; y++) {
    for (let x = 0; x < PX; x++) {
      const h = hashi(x, y, seed);
      const i = y * PX + x;
      px[i] = x + 0.5 + ((h & 0xffff) / 65536 - 0.5) * jitter;
      py[i] = y + 0.5 + (((h >>> 16) & 0xffff) / 65536 - 0.5) * jitter;
      hid[i] = ((h >>> 8) & 0xffff) / 65535;
    }
  }
  const f1 = new Float32Array(N * N);
  const f2 = new Float32Array(N * N);
  const id = new Float32Array(N * N);
  const sx = PX / N, sy = PY / N;
  const WX = wrapTable(PX), WY = wrapTable(PY);
  const wxA = WX.wrap, oxA = WX.off, wyA = WY.wrap, oyA = WY.off;

  if (warpX === null) {
    // Fast path: cell coordinates are monotonic, so tabulate them per axis and
    // hoist the row wrap lookups out of the 3x3 neighbourhood scan.
    const cxA = new Float32Array(N), xiA = new Int32Array(N);
    for (let x = 0; x < N; x++) {
      const c = x * sx; cxA[x] = c;
      let v = c | 0; if (v >= PX) v = PX - 1;
      xiA[x] = v;
    }
    for (let y = 0; y < N; y++) {
      const cy = y * sy;
      let yi = cy | 0; if (yi >= PY) yi = PY - 1;
      const bA = wyA[yi] * PX, oA = oyA[yi] - cy;
      const bB = wyA[yi + 1] * PX, oB = oyA[yi + 1] - cy;
      const bC = wyA[yi + 2] * PX, oC = oyA[yi + 2] - cy;
      const row = y * N;
      for (let x = 0; x < N; x++) {
        const cx = cxA[x], xi = xiA[x];
        let d1 = 1e9, d2 = 1e9, best = 0;
        for (let dy = 0; dy < 3; dy++) {
          const base = dy === 0 ? bA : dy === 1 ? bB : bC;
          const oy = dy === 0 ? oA : dy === 1 ? oB : oC;
          for (let dx = 0; dx < 3; dx++) {
            const kx = xi + dx;
            const k = base + wxA[kx];
            const ddx = px[k] + oxA[kx] - cx;
            const ddy = py[k] + oy;
            const d = ddx * ddx + ddy * ddy;
            if (d < d1) { d2 = d1; d1 = d; best = hid[k]; }
            else if (d < d2) { d2 = d; }
          }
        }
        const i = row + x;
        f1[i] = Math.sqrt(d1);
        f2[i] = Math.sqrt(d2);
        id[i] = best;
      }
    }
    return { f1, f2, id, PX, PY };
  }

  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      let cx = (x + warpX[i] * warpAmt) * sx;
      let cy = (y + warpY[i] * warpAmt) * sy;
      let xi = Math.floor(cx), yi = Math.floor(cy);
      if (xi < 0 || xi >= PX) { const w = ((xi % PX) + PX) % PX; cx -= xi - w; xi = w; }
      if (yi < 0 || yi >= PY) { const w = ((yi % PY) + PY) % PY; cy -= yi - w; yi = w; }
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let dy = 0; dy < 3; dy++) {
        const ky = yi + dy;
        const base = wyA[ky] * PX;
        const oy = oyA[ky] - cy;
        for (let dx = 0; dx < 3; dx++) {
          const kx = xi + dx;
          const k = base + wxA[kx];
          const ddx = px[k] + oxA[kx] - cx;
          const ddy = py[k] + oy;
          const d = ddx * ddx + ddy * ddy;
          if (d < d1) { d2 = d1; d1 = d; best = hid[k]; }
          else if (d < d2) { d2 = d; }
        }
      }
      f1[i] = Math.sqrt(d1);
      f2[i] = Math.sqrt(d2);
      id[i] = best;
    }
  }
  return { f1, f2, id, PX, PY };
}

/** Wrapped separable box blur (sliding window, O(N^2) per pass). */
function blurWrap(src, N, r) {
  r = Math.max(0, Math.min(r | 0, (N >> 1) - 1));
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(N * N);
  const dst = new Float32Array(N * N);
  const inv = 1 / (r * 2 + 1);
  // index tables kill the two modulos that would otherwise run per texel
  const outI = new Int32Array(N), inI = new Int32Array(N);
  for (let x = 0; x < N; x++) {
    outI[x] = ((x - r) % N + N) % N;
    inI[x] = (x + r + 1) % N;
  }
  for (let y = 0; y < N; y++) {
    const row = y * N;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + (((k % N) + N) % N)];
    for (let x = 0; x < N; x++) {
      tmp[row + x] = sum * inv;
      sum += src[row + inI[x]] - src[row + outI[x]];
    }
  }
  for (let x = 0; x < N; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[(((k % N) + N) % N) * N + x];
    for (let y = 0; y < N; y++) {
      dst[y * N + x] = sum * inv;
      sum += tmp[inI[y] * N + x] - tmp[outI[y] * N + x];
    }
  }
  return dst;
}

/** Convex-edge mask from a height field: 1 on ridges/corners, 0 in recesses. */
function edgeWearMask(height, N, radius, gainK) {
  const b = blurWrap(height, N, radius);
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = sat((height[i] - b[i]) * gainK);
  return out;
}

/** Tangent-space normal map bytes from a wrapped height field (sobel). */
function normalRGBA(height, N, strength) {
  const out = new Uint8ClampedArray(N * N * 4);
  const k = (strength * 10 * (N / 512)) / 8;
  const xmA = new Int32Array(N), xpA = new Int32Array(N);
  for (let x = 0; x < N; x++) { xmA[x] = (x - 1 + N) % N; xpA[x] = (x + 1) % N; }
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N;
    const y0 = y * N;
    const yp = ((y + 1) % N) * N;
    for (let x = 0; x < N; x++) {
      const xm = xmA[x], xp = xpA[x];
      const h00 = height[ym + xm], h10 = height[ym + x], h20 = height[ym + xp];
      const h01 = height[y0 + xm], h21 = height[y0 + xp];
      const h02 = height[yp + xm], h12 = height[yp + x], h22 = height[yp + xp];
      const dx = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02);
      const dy = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20);
      const nx = -dx * k;
      const ny = dy * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const p = (y0 + x) * 4;
      out[p] = (nx * inv * 0.5 + 0.5) * 255;
      out[p + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[p + 2] = (inv * 0.5 + 0.5) * 255;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** Multi-scale AO approximation: how far below its neighbourhood a texel sits. */
function aoField(height, N, strength) {
  const b1 = blurWrap(height, N, Math.max(1, Math.round(N / 160)));
  const b2 = blurWrap(height, N, Math.max(2, Math.round(N / 34)));
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) {
    const o1 = sat((b1[i] - height[i]) * 2.4);
    const o2 = sat((b2[i] - height[i]) * 1.5);
    out[i] = sat(1 - (o1 * 0.55 + o2 * 0.5) * strength);
  }
  return out;
}

/* ========================================================================== *
 * 2. canvas plumbing
 * ========================================================================== */

function newCanvas(N) {
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  return c;
}
function newCtx(N) {
  const c = newCanvas(N);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.lineCap = 'round';
  x.lineJoin = 'round';
  return x;
}
function rgbaToCanvas(N, rgba) {
  const x = newCtx(N);
  const img = x.createImageData(N, N);
  img.data.set(rgba);
  x.putImageData(img, 0, 0);
  return x.canvas;
}
function fieldToCanvas(N, field, scale, bias) {
  const rgba = new Uint8ClampedArray(N * N * 4);
  const s = scale === undefined ? 1 : scale;
  const b = bias === undefined ? 0 : bias;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const v = sat(field[i] * s + b) * 255;
    rgba[p] = v; rgba[p + 1] = v; rgba[p + 2] = v; rgba[p + 3] = 255;
  }
  return rgbaToCanvas(N, rgba);
}

/**
 * A surface under construction: three (optionally four) parallel planes plus a
 * wrapped canvas stroke pass. Recipes fill the planes directly for speed and
 * only pay for canvases when they actually need to draw.
 */
class Surface {
  constructor(N) {
    this.N = N;
    const n = N * N;
    this.alb = new Uint8ClampedArray(n * 4);
    this.hgt = new Float32Array(n);
    this.rgh = new Float32Array(n);
    this.ems = null;
    /** filled by recipes to tune the post pass */
    this.normalStrength = 1;
    this.aoStrength = 1;
    this.metalness = 0;
    this.sprite = false;
    this.transparent = false;
    this.heightSmooth = 0;
    for (let p = 3; p < n * 4; p += 4) this.alb[p] = 255;
    this.hgt.fill(0.5);
    this.rgh.fill(0.85);
    this.ac = null; this.hc = null; this.rc = null; this.ec = null;
    this.ctxs = null;
  }

  enableEmissive() {
    if (this.ems) return this.ems;
    const n = this.N * this.N;
    this.ems = new Uint8ClampedArray(n * 4);
    for (let p = 3; p < n * 4; p += 4) this.ems[p] = 255;
    return this.ems;
  }

  /** Move the planes onto canvases so strokes can be drawn over them. */
  beginStrokes() {
    const N = this.N, n = N * N;
    this.ac = newCtx(N);
    const ia = this.ac.createImageData(N, N);
    ia.data.set(this.alb);
    this.ac.putImageData(ia, 0, 0);

    this.hc = newCtx(N);
    const ih = this.hc.createImageData(N, N);
    const dh = ih.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = sat(this.hgt[i]) * 255;
      dh[p] = v; dh[p + 1] = v; dh[p + 2] = v; dh[p + 3] = 255;
    }
    this.hc.putImageData(ih, 0, 0);

    this.rc = newCtx(N);
    const ir = this.rc.createImageData(N, N);
    const dr = ir.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = sat(this.rgh[i]) * 255;
      dr[p] = v; dr[p + 1] = v; dr[p + 2] = v; dr[p + 3] = 255;
    }
    this.rc.putImageData(ir, 0, 0);

    this.ctxs = [this.ac, this.hc, this.rc];
    if (this.ems) {
      this.ec = newCtx(N);
      const ie = this.ec.createImageData(N, N);
      ie.data.set(this.ems);
      this.ec.putImageData(ie, 0, 0);
      this.ctxs.push(this.ec);
    }
    return this;
  }

  /** Read the canvases back into the planes and release them. */
  endStrokes() {
    const N = this.N, n = N * N;
    this.alb.set(this.ac.getImageData(0, 0, N, N).data);
    const dh = this.hc.getImageData(0, 0, N, N).data;
    for (let i = 0, p = 0; i < n; i++, p += 4) this.hgt[i] = dh[p] / 255;
    const dr = this.rc.getImageData(0, 0, N, N).data;
    for (let i = 0, p = 0; i < n; i++, p += 4) this.rgh[i] = dr[p] / 255;
    if (this.ec) this.ems.set(this.ec.getImageData(0, 0, N, N).data);
    this.ac.canvas.width = this.ac.canvas.height = 1;
    this.hc.canvas.width = this.hc.canvas.height = 1;
    this.rc.canvas.width = this.rc.canvas.height = 1;
    if (this.ec) this.ec.canvas.width = this.ec.canvas.height = 1;
    this.ac = this.hc = this.rc = this.ec = null;
    this.ctxs = null;
    return this;
  }

  /** Set the paint for the next stroke/fill across every plane at once. */
  style(colorCss, height, rough, width, emissiveCss, alpha) {
    const a = alpha === undefined ? 1 : alpha;
    this.ac.strokeStyle = this.ac.fillStyle = colorCss;
    this.hc.strokeStyle = this.hc.fillStyle = grey(height);
    this.rc.strokeStyle = this.rc.fillStyle = grey(rough);
    if (this.ec) this.ec.strokeStyle = this.ec.fillStyle = emissiveCss || '#000000';
    for (let i = 0; i < this.ctxs.length; i++) {
      this.ctxs[i].lineWidth = width || 1;
      this.ctxs[i].globalAlpha = a;
    }
    return this;
  }

  /** Draw `build(ctx, x, y)` into every plane, wrapped across the seam. */
  tiled(x, y, rad, build, fill) {
    const N = this.N;
    for (let oy = -1; oy <= 1; oy++) {
      const py = y + oy * N;
      if (py + rad < 0 || py - rad > N) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const px = x + ox * N;
        if (px + rad < 0 || px - rad > N) continue;
        for (let i = 0; i < this.ctxs.length; i++) {
          const c = this.ctxs[i];
          c.beginPath();
          build(c, px, py);
          if (fill) c.fill(); else c.stroke();
        }
      }
    }
  }

  /** Write one albedo texel (0..255 components). */
  setAlb(i, r, g, b, a) {
    const p = i * 4;
    this.alb[p] = r; this.alb[p + 1] = g; this.alb[p + 2] = b;
    if (a !== undefined) this.alb[p + 3] = a;
  }
  setEms(i, r, g, b) {
    const p = i * 4;
    this.ems[p] = r; this.ems[p + 1] = g; this.ems[p + 2] = b; this.ems[p + 3] = 255;
  }
}

/* ========================================================================== *
 * 3. recipes
 * ========================================================================== */

/* ---------------------------------------------------------------- ground -- */

function grassRecipe(s, o, dry) {
  const N = s.N, rng = o.rng;
  const clump = fbmField(N, { freq: 3, octaves: 4, seed: o.seed + 11 });
  const patch = fbmField(N, { freq: 7, octaves: 4, seed: o.seed + 29 });
  const soilN = fbmField(N, { freq: 26, octaves: 4, seed: o.seed + 43 });
  const fine = fbmField(N, { freq: 90, octaves: 2, seed: o.seed + 61 });

  const soilA = [0, 0, 0], soilB = [0, 0, 0], gA = [0, 0, 0], gB = [0, 0, 0];
  hsl2rgb(0.075, 0.34, 0.21, soilA);          // damp earth
  hsl2rgb(0.09, 0.28, 0.33, soilB);           // dry crumb
  hsl2rgb(dry ? 0.145 : 0.255, dry ? 0.46 : 0.42, dry ? 0.31 : 0.22, gA);
  hsl2rgb(dry ? 0.115 : 0.215, dry ? 0.52 : 0.5, dry ? 0.42 : 0.34, gB);

  const dryBias = dry ? 0.34 : -0.06;
  for (let i = 0; i < N * N; i++) {
    const cl = sat(clump[i] * 0.5 + 0.5);
    const dr = sat(patch[i] * 0.5 + 0.5 + dryBias);
    const sn = soilN[i] * 0.5 + 0.5;
    const fn = fine[i];

    const sr = lerp(soilA[0], soilB[0], sn) * (0.86 + sn * 0.3);
    const sg = lerp(soilA[1], soilB[1], sn) * (0.86 + sn * 0.3);
    const sb = lerp(soilA[2], soilB[2], sn) * (0.86 + sn * 0.3);

    const gt = sat(dr * 0.85 + fn * 0.25);
    const gr = lerp(gA[0], gB[0], gt);
    const gg = lerp(gA[1], gB[1], gt);
    const gb = lerp(gA[2], gB[2], gt);

    // thin spots let soil show through
    let cover = smoothstep(0.30, 0.66, cl + sn * 0.16 - (dry ? 0.16 : 0));
    cover = sat(cover * (dry ? 0.82 : 0.96));
    const sh = 0.82 + fn * 0.18;
    s.setAlb(i,
      lerp(sr, gr * sh, cover),
      lerp(sg, gg * sh, cover),
      lerp(sb, gb * sh, cover));
    s.hgt[i] = 0.30 + cover * 0.20 + sn * 0.07 + fn * 0.03;
    s.rgh[i] = 0.94 - cover * 0.06 - dr * 0.03;
  }

  s.beginStrokes();

  // ---- pebbles and fallen leaves sit *under* the canopy -------------------
  const pebbles = Math.round((N * N) / 9000);
  for (let i = 0; i < pebbles; i++) {
    const x = rng() * N, y = rng() * N;
    const idx = (Math.floor(y) * N + Math.floor(x)) | 0;
    if (sat(clump[idx] * 0.5 + 0.5) > 0.6) continue;
    const r = N * (0.0025 + rng() * 0.005);
    const l = 0.36 + rng() * 0.22;
    hsl2rgb(0.09, 0.06, l, _c3);
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.62 + rng() * 0.1, 0.72, 1);
    const rot = rng() * TAU, sq = 0.6 + rng() * 0.5;
    s.tiled(x, y, r * 2, (c, px, py) => { c.ellipse(px, py, r, r * sq, rot, 0, TAU); }, true);
  }

  const leaves = Math.round((N * N) / 14000);
  for (let i = 0; i < leaves; i++) {
    const x = rng() * N, y = rng() * N;
    const r = N * (0.006 + rng() * 0.008);
    hsl2rgb(0.075 + rng() * 0.05, 0.5, 0.26 + rng() * 0.14, _c3);
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.56, 0.9, 1);
    const rot = rng() * TAU;
    s.tiled(x, y, r * 2, (c, px, py) => { c.ellipse(px, py, r, r * 0.42, rot, 0, TAU); }, true);
  }

  // ---- blades ------------------------------------------------------------
  const density = dry ? 92 : 56;
  const blades = Math.round((N * N) / density * o.detail);
  const upBias = -Math.PI * 0.5;
  for (let b = 0; b < blades; b++) {
    const x = rng() * N, y = rng() * N;
    const idx = (Math.floor(y) * N + Math.floor(x)) | 0;
    const cl = sat(clump[idx] * 0.5 + 0.5);
    if (rng() > 0.12 + cl * 1.15) continue;          // clumping mask
    const dr = sat(patch[idx] * 0.5 + 0.5 + dryBias);

    const len = N * (0.012 + rng() * 0.024) * (0.55 + cl * 0.8);
    const ang = upBias + (rng() - 0.5) * 1.9;
    const bend = (rng() - 0.5) * len * 0.75;
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    const mx = (x + ex) * 0.5 - Math.sin(ang) * bend;
    const my = (y + ey) * 0.5 + Math.cos(ang) * bend;

    const tone = rng();
    const hue = dry ? 0.115 + tone * 0.04 : 0.21 + tone * 0.06 - dr * 0.05;
    const satr = dry ? 0.42 + tone * 0.2 : 0.36 + tone * 0.3;
    const li = (dry ? 0.30 : 0.22) + tone * 0.2 + cl * 0.05;
    hsl2rgb(hue, satr, li, _c3);
    const w = N > 700 ? (rng() < 0.35 ? 2 : 1.2) : 1;
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.55 + cl * 0.3 + tone * 0.1, 0.9 - tone * 0.1, w, null, 0.9);
    s.tiled(x, y, len + 3, (c, px, py) => {
      c.moveTo(px, py);
      c.quadraticCurveTo(mx + (px - x), my + (py - y), ex + (px - x), ey + (py - y));
    });
  }

  s.endStrokes();
  s.normalStrength = 0.9;
  s.aoStrength = 1.15;
  s.heightSmooth = 1;
}

function dirtRecipe(s, o, road) {
  const N = s.N;
  const macro = fbmField(N, { freq: 4, octaves: 4, seed: o.seed + 7 });
  const mid = fbmField(N, { freq: 16, octaves: 5, seed: o.seed + 19 });
  const grit = fbmField(N, { freq: 70, octaves: 3, seed: o.seed + 31 });
  const stones = worleyField(N, { cells: Math.max(10, Math.round(N / 26)), seed: o.seed + 53, jitter: 1 });
  const rut = fbmField(N, { freq: 3, freqY: 22, octaves: 3, seed: o.seed + 71 });

  const cA = [0, 0, 0], cB = [0, 0, 0];
  hsl2rgb(0.072, 0.36, 0.19, cA);
  hsl2rgb(0.095, 0.27, 0.36, cB);

  for (let i = 0; i < N * N; i++) {
    const m = sat(macro[i] * 0.5 + 0.5);
    const d = sat(mid[i] * 0.5 + 0.5);
    const g = grit[i];
    let t = sat(m * 0.55 + d * 0.45 + g * 0.12);
    if (road) t = sat(t * 0.8 + 0.18 + rut[i] * 0.1);
    let r = lerp(cA[0], cB[0], t);
    let gg = lerp(cA[1], cB[1], t);
    let b = lerp(cA[2], cB[2], t);

    let h = 0.42 + (d - 0.5) * 0.35 + g * 0.05;
    let rough = 0.95 - t * 0.06;

    // embedded gravel
    const st = stones.f1[i];
    if (st < 0.34) {
      const dome = smoothstep(0.34, 0.1, st);
      const sl = 0.17 + stones.id[i] * 0.15;
      hsl2rgb(0.08, 0.06 + stones.id[i] * 0.05, sl, _c3);
      r = lerp(r, _c3[0], dome * 0.62);
      gg = lerp(gg, _c3[1], dome * 0.62);
      b = lerp(b, _c3[2], dome * 0.62);
      h += dome * 0.16;
      rough -= dome * 0.16;
    }
    if (road) {
      // wheel ruts: packed, darker, smoother
      const packed = sat(Math.abs(Math.sin((i % N) / N * Math.PI * 2 + 0.6)) * 1.2 - 0.35);
      r *= 1 - packed * 0.14; gg *= 1 - packed * 0.14; b *= 1 - packed * 0.12;
      h -= packed * 0.08;
      rough -= packed * 0.1;
    }
    s.setAlb(i, r, gg, b);
    s.hgt[i] = h;
    s.rgh[i] = rough;
  }
  s.normalStrength = 1.15;
  s.aoStrength = 1.0;
}

function mudRecipe(s, o) {
  const N = s.N;
  const macro = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 3 });
  const crack = fbmField(N, { freq: 9, octaves: 3, seed: o.seed + 17, ridged: true });
  const cells = worleyField(N, { cells: 9, seed: o.seed + 23, jitter: 1 });
  const wet = fbmField(N, { freq: 6, octaves: 3, seed: o.seed + 37 });
  for (let i = 0; i < N * N; i++) {
    const m = sat(macro[i] * 0.5 + 0.5);
    const seam = smoothstep(0.0, 0.11, cells.f2[i] - cells.f1[i]);
    const w = sat(wet[i] * 0.5 + 0.5);
    hsl2rgb(0.07, 0.3 - w * 0.1, 0.13 + m * 0.12 + seam * 0.05, _c3);
    const puddle = smoothstep(0.62, 0.9, w);
    const r = lerp(_c3[0], _c3[0] * 0.55, puddle);
    const g = lerp(_c3[1], _c3[1] * 0.58, puddle);
    const b = lerp(_c3[2], _c3[2] * 0.7, puddle);
    s.setAlb(i, r, g, b);
    s.hgt[i] = 0.34 + seam * 0.2 + m * 0.1 - puddle * 0.12 + crack[i] * 0.05;
    s.rgh[i] = 0.9 - puddle * 0.62 - seam * 0.05;
  }
  s.normalStrength = 1.2;
}

function sandRecipe(s, o) {
  const N = s.N;
  const dune = fbmField(N, { freq: 3, freqY: 6, octaves: 4, seed: o.seed + 5 });
  const ripple = fbmField(N, { freq: 8, freqY: 46, octaves: 3, seed: o.seed + 13 });
  const grain = fbmField(N, { freq: 150, octaves: 2, seed: o.seed + 27 });
  const shell = worleyField(N, { cells: Math.max(12, Math.round(N / 34)), seed: o.seed + 41 });
  for (let i = 0; i < N * N; i++) {
    const d = dune[i] * 0.5 + 0.5;
    const rp = ripple[i];
    const g = grain[i];
    const h = 0.42 + d * 0.18 + rp * 0.22 + g * 0.05;
    hsl2rgb(0.105 + g * 0.01, 0.34 - d * 0.06, 0.48 + d * 0.1 + rp * 0.11 + g * 0.04, _c3);
    let r = _c3[0], gg = _c3[1], b = _c3[2];
    if (shell.f1[i] < 0.07 && shell.id[i] > 0.72) {
      const k = smoothstep(0.07, 0.02, shell.f1[i]) * 0.7;
      r = lerp(r, 214, k); gg = lerp(gg, 205, k); b = lerp(b, 184, k);
    }
    s.setAlb(i, r, gg, b);
    s.hgt[i] = h;
    s.rgh[i] = 0.93 - g * 0.04;
  }
  s.normalStrength = 0.85;
  s.aoStrength = 0.7;
}

function snowRecipe(s, o) {
  const N = s.N;
  const drift = fbmField(N, { freq: 4, octaves: 4, seed: o.seed + 9 });
  const crust = fbmField(N, { freq: 24, octaves: 4, seed: o.seed + 21 });
  const spark = fbmField(N, { freq: 190, octaves: 1, seed: o.seed + 33 });
  for (let i = 0; i < N * N; i++) {
    const d = drift[i] * 0.5 + 0.5;
    const c = crust[i];
    const sp = sat(spark[i] * 2.2 - 1.4);
    const l = 0.80 + d * 0.11 + c * 0.04 + sp * 0.12;
    hsl2rgb(0.58, 0.10 - d * 0.05, l, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.45 + d * 0.22 + c * 0.08;
    s.rgh[i] = 0.72 - sp * 0.35 - d * 0.05;
  }
  s.normalStrength = 0.7;
  s.aoStrength = 0.8;
}

function stoneFloorRecipe(s, o) {
  const N = s.N;
  const rows = 4, colsBase = 4;
  const grain = fbmField(N, { freq: 40, octaves: 4, seed: o.seed + 5 });
  const stain = fbmField(N, { freq: 6, octaves: 4, seed: o.seed + 15 });
  const chip = fbmField(N, { freq: 34, octaves: 3, seed: o.seed + 25 });
  const mortarW = 0.045;
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const row = Math.floor(v * rows);
    const rowH = hashf(0, row, o.seed + 91);
    const cols = colsBase + (rowH < 0.4 ? 0 : rowH < 0.8 ? 1 : -1);
    const phase = hashf(1, row, o.seed + 92);
    const bv = v * rows - row;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const cu = (u + phase) * cols;
      const col = Math.floor(cu);
      const bu = cu - col;
      // the first and last column index address the same physical slab, so the
      // per-slab hash has to be taken on the wrapped index or the tile seams
      const ch = hashf(((col % cols) + cols) % cols, row, o.seed + 93);
      const noise = chip[i] * 0.035;
      const dEdge = Math.min(
        Math.min(bu, 1 - bu) / cols,
        Math.min(bv, 1 - bv) / rows
      ) + noise;
      const face = smoothstep(mortarW * 0.45, mortarW, dEdge);
      const g = grain[i];
      const stn = sat(stain[i] * 0.5 + 0.5);
      const l = 0.30 + ch * 0.12 + g * 0.05 - stn * 0.05;
      hsl2rgb(0.09 + ch * 0.03, 0.05 + ch * 0.04, l, _c3);
      // mortar
      hsl2rgb(0.1, 0.06, 0.24 + g * 0.03, _c3b);
      const r = lerp(_c3b[0], _c3[0], face);
      const gg = lerp(_c3b[1], _c3[1], face);
      const b = lerp(_c3b[2], _c3[2], face);
      s.setAlb(i, r, gg, b);
      s.hgt[i] = 0.24 + face * 0.5 + g * 0.04 + ch * 0.03;
      s.rgh[i] = 0.86 - face * 0.16 + stn * 0.04;
    }
  }
  s.normalStrength = 1.25;
  s.aoStrength = 1.2;
}

function cobbleRecipe(s, o) {
  const N = s.N;
  const cells = Math.max(6, Math.round(N / 96));
  const warp = fbmField(N, { freq: 12, octaves: 3, seed: o.seed + 61 });
  const warp2 = fbmField(N, { freq: 12, octaves: 3, seed: o.seed + 62 });
  const w = worleyField(N, { cells, seed: o.seed + 4, jitter: 0.95, warpX: warp, warpY: warp2, warpAmt: N * 0.022 });
  const chip = fbmField(N, { freq: 90, octaves: 3, seed: o.seed + 12 });
  const speck = fbmField(N, { freq: 150, octaves: 2, seed: o.seed + 18 });
  const grime = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 26 });
  const pathN = fbmField(N, { freq: 3, octaves: 3, seed: o.seed + 34 });

  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const edge = w.f2[i] - w.f1[i];
      const id = w.id[i];
      // chipped rim: perturb the seam width with high-frequency noise
      const seam = 0.085 + chip[i] * 0.05;
      const face = smoothstep(seam * 0.35, seam, edge);
      const dome = smoothstep(0.72, 0.05, w.f1[i]);

      // worn traffic path — a soft meander across the tile
      const pathCentre = 0.5 + pathN[i] * 0.22;
      const traffic = sat(1 - Math.abs(u - pathCentre) * 3.1) * sat(1 - Math.abs(v - 0.5) * 0.2);

      const sp = speck[i];
      const gr = sat(grime[i] * 0.5 + 0.5);
      const hue = 0.07 + id * 0.09;
      const satu = 0.03 + id * 0.09;
      const li = 0.24 + id * 0.16 + sp * 0.05 + dome * 0.05 - gr * 0.04 + traffic * 0.05;
      hsl2rgb(hue, satu, li, _c3);
      // recessed mortar / packed grit between stones
      hsl2rgb(0.09, 0.12, 0.14 + gr * 0.05, _c3b);

      const r = lerp(_c3b[0], _c3[0], face);
      const g = lerp(_c3b[1], _c3[1], face);
      const b = lerp(_c3b[2], _c3[2], face);
      s.setAlb(i, r, g, b);
      s.hgt[i] = 0.16 + face * (0.46 + dome * 0.22) + sp * 0.03 - traffic * face * 0.05;
      s.rgh[i] = 0.92 - face * 0.1 - traffic * face * 0.34 + gr * 0.04;
    }
  }
  s.normalStrength = 1.35;
  s.aoStrength = 1.35;
}

function caveFloorRecipe(s, o) {
  const N = s.N;
  const rock = fbmField(N, { freq: 7, octaves: 5, seed: o.seed + 8, ridged: true });
  const rubble = worleyField(N, { cells: Math.max(10, Math.round(N / 40)), seed: o.seed + 16 });
  const damp = fbmField(N, { freq: 4, octaves: 4, seed: o.seed + 24 });
  const grit = fbmField(N, { freq: 120, octaves: 2, seed: o.seed + 32 });
  for (let i = 0; i < N * N; i++) {
    const rk = rock[i];
    const dome = smoothstep(0.45, 0.05, rubble.f1[i]);
    const wet = sat(damp[i] * 0.5 + 0.5);
    const g = grit[i];
    const l = 0.10 + rk * 0.12 + dome * 0.06 + g * 0.03 - wet * 0.03;
    hsl2rgb(0.60 - rk * 0.05, 0.07, l, _c3);
    const puddle = smoothstep(0.68, 0.92, wet);
    s.setAlb(i,
      lerp(_c3[0], _c3[0] * 0.55, puddle),
      lerp(_c3[1], _c3[1] * 0.6, puddle),
      lerp(_c3[2], _c3[2] * 0.78, puddle));
    s.hgt[i] = 0.3 + rk * 0.2 + dome * 0.22 - puddle * 0.1;
    s.rgh[i] = 0.94 - puddle * 0.68 - dome * 0.04;
  }
  s.normalStrength = 1.3;
  s.aoStrength = 1.3;
}

function templeFloorRecipe(s, o) {
  const N = s.N;
  const tiles = 3;
  const grain = fbmField(N, { freq: 50, octaves: 4, seed: o.seed + 6 });
  const wear = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 14 });
  const crack = fbmField(N, { freq: 30, octaves: 3, seed: o.seed + 22, ridged: true });
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const ty = Math.floor(v * tiles), bv = v * tiles - ty;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const tx = Math.floor(u * tiles), bu = u * tiles - tx;
      const ch = hashf(tx, ty, o.seed + 77);
      const d = Math.min(Math.min(bu, 1 - bu), Math.min(bv, 1 - bv));
      const face = smoothstep(0.012, 0.028, d + crack[i] * 0.006);
      const g = grain[i], wr = sat(wear[i] * 0.5 + 0.5);
      // dark polished slate with a gold inlaid border ring
      const ring = smoothstep(0.055, 0.075, d) * (1 - smoothstep(0.088, 0.105, d));
      hsl2rgb(0.62, 0.10, 0.13 + ch * 0.05 + g * 0.03 - wr * 0.02, _c3);
      hsl2rgb(0.11, 0.62, 0.42 + g * 0.06, _c3b);
      let r = lerp(_c3[0], _c3b[0], ring * 0.85);
      let gg = lerp(_c3[1], _c3b[1], ring * 0.85);
      let b = lerp(_c3[2], _c3b[2], ring * 0.85);
      const mr = 26 + g * 12, mg = 24 + g * 12, mb = 26 + g * 12;
      r = lerp(mr, r, face); gg = lerp(mg, gg, face); b = lerp(mb, b, face);
      s.setAlb(i, r, gg, b);
      s.hgt[i] = 0.22 + face * 0.52 + ring * 0.05 - crack[i] * 0.06;
      s.rgh[i] = 0.72 - face * 0.28 + wr * 0.14 - ring * 0.18;
    }
  }
  s.normalStrength = 1.2;
  s.aoStrength = 1.2;
}

function bloodFloorRecipe(s, o) {
  stoneFloorRecipe(s, o);
  const N = s.N;
  const pool = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 300 });
  const edge = fbmField(N, { freq: 26, octaves: 3, seed: o.seed + 301 });
  for (let i = 0; i < N * N; i++) {
    const p = sat(pool[i] * 0.5 + 0.5 + edge[i] * 0.13);
    const m = smoothstep(0.54, 0.78, p);
    if (m <= 0) continue;
    const p4 = i * 4;
    const dark = 0.55 + (1 - m) * 0.45;   // thinner at the rim, near-black in the pool
    s.alb[p4] = lerp(s.alb[p4], 58 * dark, m);
    s.alb[p4 + 1] = lerp(s.alb[p4 + 1], 9 * dark, m);
    s.alb[p4 + 2] = lerp(s.alb[p4 + 2], 11 * dark, m);
    s.hgt[i] = lerp(s.hgt[i], s.hgt[i] * 0.85, m);
    s.rgh[i] = lerp(s.rgh[i], 0.24, m);
  }
}

/* ------------------------------------------------------------------ rock -- */

function rockRecipe(s, o, mossy) {
  const N = s.N;
  const fract = fbmField(N, { freq: 5, octaves: 5, seed: o.seed + 2, ridged: true });
  const cracks = fbmField(N, { freq: 13, octaves: 4, seed: o.seed + 9, ridged: true });
  const plates = worleyField(N, { cells: Math.max(5, Math.round(N / 90)), seed: o.seed + 10, jitter: 1 });
  const mineral = fbmField(N, { freq: 110, octaves: 2, seed: o.seed + 18 });
  const macro = fbmField(N, { freq: 3, octaves: 3, seed: o.seed + 26 });
  const mossF = mossy ? fbmField(N, { freq: 8, octaves: 4, seed: o.seed + 34 }) : null;

  for (let i = 0; i < N * N; i++) {
    const f = fract[i];
    const ck = sat((cracks[i] - 0.66) * 3.4);          // sparse sharp fissures
    const seam = smoothstep(0.0, 0.16, plates.f2[i] - plates.f1[i]);
    const mn = mineral[i];
    const mc = macro[i] * 0.5 + 0.5;
    const id = plates.id[i];
    const l = 0.20 + mc * 0.12 + f * 0.16 + mn * 0.07 + id * 0.07 + seam * 0.06 - ck * 0.12;
    hsl2rgb(0.09 - id * 0.03, 0.05 + mn * 0.04, l, _c3);
    let r = _c3[0], g = _c3[1], b = _c3[2];
    // quartz flecks
    const fleck = sat(mn * 2.6 - 1.7);
    r = lerp(r, 208, fleck); g = lerp(g, 204, fleck); b = lerp(b, 196, fleck);
    let h = 0.18 + f * 0.36 + seam * 0.24 + mc * 0.12 - ck * 0.3;
    let rough = 0.92 - fleck * 0.3 + ck * 0.05;
    if (mossy) {
      const crev = sat(1 - h * 1.35);
      const mv = sat(mossF[i] * 0.5 + 0.5);
      const m = smoothstep(0.34, 0.72, mv * 0.55 + crev * 0.7);
      hsl2rgb(0.26 + mv * 0.04, 0.42, 0.16 + mv * 0.1, _c3b);
      r = lerp(r, _c3b[0], m); g = lerp(g, _c3b[1], m); b = lerp(b, _c3b[2], m);
      h += m * 0.05;
      rough = lerp(rough, 0.97, m);
    }
    s.setAlb(i, r, g, b);
    s.hgt[i] = h;
    s.rgh[i] = rough;
  }
  s.normalStrength = 1.4;
  s.aoStrength = 1.25;
}

function cliffRecipe(s, o) {
  const N = s.N;
  const strata = fbmField(N, { freq: 3, freqY: 20, octaves: 2, seed: o.seed + 3 });
  const fract = fbmField(N, { freq: 10, freqY: 4, octaves: 5, seed: o.seed + 11, ridged: true });
  const chunk = worleyField(N, { cells: Math.max(3, Math.round(N / 260)), cellsY: Math.max(6, Math.round(N / 90)), seed: o.seed + 19 });
  const grit = fbmField(N, { freq: 100, octaves: 2, seed: o.seed + 27 });
  for (let i = 0; i < N * N; i++) {
    const st = strata[i] * 0.5 + 0.5;
    const fr = fract[i];
    const seam = smoothstep(0.0, 0.1, chunk.f2[i] - chunk.f1[i]);
    const g = grit[i];
    const band = Math.floor(st * 6) / 6;
    hsl2rgb(0.075 + band * 0.035, 0.06 + band * 0.07, 0.13 + band * 0.22 + fr * 0.10 + g * 0.04, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.16 + fr * 0.34 + seam * 0.24 + band * 0.2;
    s.rgh[i] = 0.95 - g * 0.05;
  }
  s.normalStrength = 1.6;
  s.aoStrength = 1.4;
}

function gravelRecipe(s, o) {
  const N = s.N;
  const c1 = worleyField(N, { cells: Math.max(14, Math.round(N / 22)), seed: o.seed + 5, jitter: 1 });
  const c2 = worleyField(N, { cells: Math.max(26, Math.round(N / 12)), seed: o.seed + 6, jitter: 1 });
  const dust = fbmField(N, { freq: 60, octaves: 3, seed: o.seed + 13 });
  for (let i = 0; i < N * N; i++) {
    const d1 = smoothstep(0.5, 0.05, c1.f1[i]);
    const d2 = smoothstep(0.44, 0.05, c2.f1[i]);
    const big = d1 > d2 * 0.85;
    const id = big ? c1.id[i] : c2.id[i];
    const dome = big ? d1 : d2;
    const du = dust[i];
    hsl2rgb(0.08 + id * 0.05, 0.05 + id * 0.06, 0.2 + id * 0.2 + dome * 0.06 + du * 0.04, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.24 + dome * 0.5 + du * 0.05;
    s.rgh[i] = 0.94 - dome * 0.08;
  }
  s.normalStrength = 1.5;
  s.aoStrength = 1.4;
}

/* ------------------------------------------------------------------ wood -- */

function barkRecipe(s, o, kindPine) {
  const N = s.N;
  // long vertical plates: cells are tall (few rows, many columns)
  const warpX = fbmField(N, { freq: 6, freqY: 18, octaves: 3, seed: o.seed + 41 });
  const warpY = fbmField(N, { freq: 6, freqY: 18, octaves: 3, seed: o.seed + 42 });
  const plateX = kindPine ? 7 : 9;
  const plateY = kindPine ? 3 : 4;
  const plates = worleyField(N, {
    cells: plateX, cellsY: plateY, seed: o.seed + 3, jitter: 1,
    warpX, warpY, warpAmt: N * (kindPine ? 0.035 : 0.028),
  });
  const fissure = fbmField(N, {
    freq: kindPine ? 26 : 40, freqY: kindPine ? 5 : 7, octaves: 5,
    seed: o.seed + 9, ridged: true,
  });
  const grain = fbmField(N, { freq: 90, freqY: 10, octaves: 3, seed: o.seed + 17 });
  const lichen = fbmField(N, { freq: 6, octaves: 4, seed: o.seed + 23 });

  const seamW = kindPine ? 0.34 : 0.26;
  for (let i = 0; i < N * N; i++) {
    const edge = plates.f2[i] - plates.f1[i];
    const seam = smoothstep(0.0, seamW, edge);
    const fis = fissure[i];
    const g = grain[i];
    const id = plates.id[i];
    // plate faces sit high, fissures cut deep and read dark
    const h = 0.10 + seam * 0.58 + fis * 0.20 + g * 0.05;
    const depth = sat(1 - h * 1.55);

    const hue = kindPine ? 0.055 + id * 0.02 : 0.075 + id * 0.015;
    const satu = (kindPine ? 0.36 : 0.16) - id * 0.06 + (1 - seam) * 0.1;
    const li = (kindPine ? 0.07 : 0.065) + seam * 0.24 + id * 0.08 + g * 0.05 + fis * 0.07;
    hsl2rgb(hue, satu, li, _c3);
    let r = _c3[0], gg = _c3[1], b = _c3[2];

    // lichen colonises the deepest crevices only
    const lv = sat(lichen[i] * 0.5 + 0.5);
    const lm = smoothstep(0.55, 0.92, lv * 0.45 + depth * 0.8) * 0.55;
    hsl2rgb(0.22 + lv * 0.05, 0.16, 0.26 + lv * 0.08, _c3b);
    r = lerp(r, _c3b[0], lm);
    gg = lerp(gg, _c3b[1], lm);
    b = lerp(b, _c3b[2], lm);

    s.setAlb(i, r, gg, b);
    s.hgt[i] = h;
    s.rgh[i] = 0.96 - lm * 0.06 - seam * 0.05;
  }
  s.normalStrength = kindPine ? 1.9 : 1.7;
  s.aoStrength = 1.5;
}

function plankRecipe(s, o, worn) {
  const N = s.N, rng = o.rng;
  const boards = 5;
  const grain = fbmField(N, { freq: 44, freqY: 4, octaves: 4, seed: o.seed + 4 });
  const grain2 = fbmField(N, { freq: 26, freqY: 3, octaves: 3, seed: o.seed + 5 });
  const wearF = fbmField(N, { freq: 8, octaves: 4, seed: o.seed + 12 });
  const gapW = 0.038;

  for (let y = 0; y < N; y++) {
    const v = y / N;
    const bi = Math.floor(v * boards);
    const bv = v * boards - bi;
    const bh = hashf(0, bi, o.seed + 88);
    const bh2 = hashf(3, bi, o.seed + 88);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const g = grain[i], g2 = grain2[i];
      const w = sat(wearF[i] * 0.5 + 0.5);
      const dEdge = Math.min(bv, 1 - bv);
      const face = smoothstep(gapW * 0.3, gapW, dEdge + g * 0.01);
      const ring = Math.abs(Math.sin((g2 * 3.4 + bh2 * 6.0) * Math.PI));
      const hue = worn ? 0.085 - bh * 0.02 : 0.07 + bh * 0.02;
      const satu = worn ? 0.10 + bh * 0.06 : 0.32 + bh * 0.1;
      const li = (worn ? 0.30 : 0.24) + bh * 0.07 + ring * 0.13 + g * 0.06 - (worn ? w * 0.06 : 0);
      hsl2rgb(hue, satu, li, _c3);
      let r = _c3[0], gg = _c3[1], b = _c3[2];
      r = lerp(30, r, face); gg = lerp(23, gg, face); b = lerp(18, b, face);
      s.setAlb(i, r, gg, b);
      s.hgt[i] = 0.2 + face * (0.5 + bh * 0.06) + ring * 0.05 + g * 0.05 - (worn ? w * 0.06 : 0);
      s.rgh[i] = (worn ? 0.96 : 0.82) - ring * 0.04 + w * 0.03;
    }
  }

  s.beginStrokes();
  // knots
  const knots = Math.max(2, Math.round(boards * 1.4));
  for (let k = 0; k < knots; k++) {
    const bi = Math.floor(rng() * boards);
    const cx = rng() * N;
    const cy = (bi + 0.25 + rng() * 0.5) / boards * N;
    const rr = N * (0.012 + rng() * 0.02);
    for (let ring = 5; ring >= 1; ring--) {
      const t = ring / 5;
      hsl2rgb(0.06, 0.4, 0.10 + t * 0.06, _c3);
      s.style(css(_c3[0], _c3[1], _c3[2]), 0.42 + t * 0.1, 0.9, Math.max(1, N * 0.002));
      s.tiled(cx, cy, rr * 1.4, (c, px, py) => { c.ellipse(px, py, rr * t, rr * t * 0.7, 0.3, 0, TAU); });
    }
  }
  // nails / splinters
  const nails = boards * 4;
  for (let n = 0; n < nails; n++) {
    const bi = Math.floor(rng() * boards);
    const cx = rng() * N;
    const cy = (bi + (rng() < 0.5 ? 0.18 : 0.82)) / boards * N;
    const rr = Math.max(1.2, N * 0.0035);
    s.style('rgb(58,54,50)', 0.36, 0.5, 1);
    s.tiled(cx, cy, rr * 2, (c, px, py) => { c.ellipse(px, py, rr, rr, 0, 0, TAU); }, true);
  }
  if (worn) {
    const cracks = Math.round(N / 22);
    for (let cI = 0; cI < cracks; cI++) {
      const x = rng() * N, y = rng() * N;
      const len = N * (0.05 + rng() * 0.16);
      const dy = (rng() - 0.5) * 4;
      s.style('rgb(20,16,13)', 0.24, 0.98, Math.max(1, N * 0.0018));
      s.tiled(x, y, len, (c, px, py) => {
        c.moveTo(px, py);
        c.lineTo(px + len, py + dy);
      });
    }
  }
  s.endStrokes();
  s.normalStrength = 1.25;
  s.aoStrength = 1.1;
  s.heightSmooth = 1;
}

function logRecipe(s, o) {
  const N = s.N;
  const grain = fbmField(N, { freq: 16, freqY: 90, octaves: 4, seed: o.seed + 7 });
  const ridge = fbmField(N, { freq: 10, freqY: 46, octaves: 4, seed: o.seed + 15, ridged: true });
  const barkF = fbmField(N, { freq: 5, octaves: 3, seed: o.seed + 21 });
  for (let i = 0; i < N * N; i++) {
    const g = grain[i], r = ridge[i];
    const b = sat(barkF[i] * 0.5 + 0.5);
    hsl2rgb(0.07 + b * 0.015, 0.30 - r * 0.06, 0.07 + r * 0.24 + g * 0.06 + b * 0.06, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.16 + r * 0.50 + g * 0.08;
    s.rgh[i] = 0.94 - r * 0.05;
  }
  s.normalStrength = 1.5;
  s.aoStrength = 1.2;
}

/* ----------------------------------------------------------------- built -- */

/**
 * Running-bond masonry. `variable` gives each course its own brick count and
 * phase (ashlar stone wall); otherwise it is a strict half-offset brick bond.
 */
function masonry(s, o, cfg) {
  const N = s.N;
  const rows = cfg.rows;
  const grain = fbmField(N, { freq: cfg.grainFreq, octaves: 4, seed: o.seed + 5 });
  const erode = fbmField(N, { freq: 46, octaves: 4, seed: o.seed + 13 });
  const stain = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 21 });
  const mort = fbmField(N, { freq: 70, octaves: 3, seed: o.seed + 29 });
  const mortarPx = cfg.mortar;

  for (let y = 0; y < N; y++) {
    const v = y / N;
    const row = Math.floor(v * rows);
    const bv = v * rows - row;
    let cols = cfg.cols;
    let phase = (row & 1) * 0.5;
    if (cfg.variable) {
      const h = hashf(0, row, o.seed + 55);
      cols = cfg.cols + (h < 0.33 ? -1 : h < 0.66 ? 0 : 1);
      phase = hashf(1, row, o.seed + 56);
    }
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const cu = (u + phase) * cols;
      const col = Math.floor(cu);
      const bu = cu - col;
      const cw = ((col % cols) + cols) % cols;   // wrapped index: keeps the bond seamless
      const bh = hashf(cw, row, o.seed + 57);
      const bh2 = hashf(cw + 91, row, o.seed + 58);

      const er = erode[i];
      const du = Math.min(bu, 1 - bu) / cols;
      const dv = Math.min(bv, 1 - bv) / rows;
      const d = Math.min(du, dv) + er * cfg.erodeAmt;
      // corners erode hardest
      const corner = smoothstep(0.55, 1.0, 1 - Math.min(du, dv) / Math.max(1e-5, Math.max(du, dv)));
      const dd = d - corner * cfg.erodeAmt * 0.8;
      const face = smoothstep(mortarPx * 0.35, mortarPx, dd);

      const g = grain[i];
      const st = sat(stain[i] * 0.5 + 0.5);
      const li = cfg.l + bh * cfg.lVar + g * 0.05 - st * cfg.stainAmt;
      hsl2rgb(cfg.h + bh2 * cfg.hVar, cfg.s + bh * cfg.sVar, li, _c3);
      // mortar: pale, gritty, and BELOW the brick face
      const mg = mort[i];
      hsl2rgb(0.10, 0.06, cfg.mortarL + mg * 0.06, _c3b);
      const r = lerp(_c3b[0], _c3[0], face);
      const gg = lerp(_c3b[1], _c3[1], face);
      const b = lerp(_c3b[2], _c3[2], face);
      s.setAlb(i, r, gg, b);
      s.hgt[i] = cfg.mortarH + face * cfg.faceH + g * 0.04 + bh * 0.03 + er * 0.03;
      s.rgh[i] = 0.94 - face * cfg.faceGloss + mg * 0.03;
    }
  }
  s.normalStrength = 1.45;
  s.aoStrength = 1.4;
}

function brickRecipe(s, o) {
  masonry(s, o, {
    rows: 10, cols: 5, mortar: 0.012, faceH: 0.5, mortarH: 0.16,
    h: 0.035, hVar: 0.02, s: 0.32, sVar: 0.13, l: 0.22, lVar: 0.11,
    grainFreq: 70, erodeAmt: 0.006, stainAmt: 0.06, mortarL: 0.34, faceGloss: 0.06,
  });
}

function stoneWallRecipe(s, o) {
  masonry(s, o, {
    rows: 6, cols: 4, mortar: 0.016, faceH: 0.5, mortarH: 0.14, variable: true,
    h: 0.09, hVar: 0.03, s: 0.04, sVar: 0.06, l: 0.24, lVar: 0.22,
    grainFreq: 44, erodeAmt: 0.011, stainAmt: 0.08, mortarL: 0.18, faceGloss: 0.05,
  });
}

function templeWallRecipe(s, o) {
  masonry(s, o, {
    rows: 4, cols: 3, mortar: 0.013, faceH: 0.48, mortarH: 0.16, variable: false,
    h: 0.055, hVar: 0.02, s: 0.12, sVar: 0.08, l: 0.30, lVar: 0.09,
    grainFreq: 40, erodeAmt: 0.008, stainAmt: 0.07, mortarL: 0.26, faceGloss: 0.1,
  });
  // faded vermilion paint + carved relief band
  const N = s.N;
  const paint = fbmField(N, { freq: 7, octaves: 4, seed: o.seed + 111 });
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const band = smoothstep(0.40, 0.44, v) * (1 - smoothstep(0.56, 0.60, v));
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const p4 = i * 4;
      const flake = sat(paint[i] * 0.5 + 0.5);
      const m = band * smoothstep(0.25, 0.6, flake);
      if (m > 0) {
        s.alb[p4] = lerp(s.alb[p4], 132, m * 0.8);
        s.alb[p4 + 1] = lerp(s.alb[p4 + 1], 38, m * 0.8);
        s.alb[p4 + 2] = lerp(s.alb[p4 + 2], 30, m * 0.8);
        // carved key-fret groove inside the band
        const fret = Math.abs(((u * 12) % 1) - 0.5) < 0.16 ? 1 : 0;
        s.hgt[i] -= band * fret * 0.12;
        s.rgh[i] = lerp(s.rgh[i], 0.78, m);
      }
    }
  }
}

function roofTileRecipe(s, o) {
  const N = s.N;
  const cols = 8;      // barrel tiles run down the slope
  const rows = 6;      // courses
  const grain = fbmField(N, { freq: 60, octaves: 3, seed: o.seed + 6 });
  const moss = fbmField(N, { freq: 9, octaves: 4, seed: o.seed + 14 });
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const row = Math.floor(v * rows);
    const bv = v * rows - row;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const cu = u * cols;
      const col = Math.floor(cu);
      const bu = cu - col;
      const ch = hashf(col, row, o.seed + 66);
      // half-round barrel profile across the tile
      const barrel = Math.sqrt(Math.max(0, 1 - Math.pow((bu - 0.5) * 2, 2)));
      const gap = smoothstep(0.0, 0.06, Math.min(bu, 1 - bu));
      // course overlap: a lip at the top of each row
      const lip = smoothstep(0.0, 0.09, bv);
      const g = grain[i];
      // light rakes across the barrel: bright crown, dark valley between tiles
      const roll = barrel * gap;
      const li = 0.07 + ch * 0.04 + roll * 0.22 + g * 0.04;
      hsl2rgb(0.60, 0.08 + ch * 0.04, li, _c3);
      let r = _c3[0], gg = _c3[1], b = _c3[2];
      const mv = sat(moss[i] * 0.5 + 0.5);
      const mm = smoothstep(0.66, 0.88, mv) * (1 - gap * 0.5);
      hsl2rgb(0.25, 0.3, 0.2, _c3b);
      r = lerp(r, _c3b[0], mm); gg = lerp(gg, _c3b[1], mm); b = lerp(b, _c3b[2], mm);
      const shade = 0.5 + lip * 0.5;
      s.setAlb(i, r * shade, gg * shade, b * shade);
      s.hgt[i] = 0.18 + barrel * 0.46 * gap + lip * 0.14;
      s.rgh[i] = 0.78 - barrel * 0.1 + mm * 0.18;
    }
  }
  s.normalStrength = 1.5;
  s.aoStrength = 1.35;
}

function thatchRecipe(s, o) {
  const N = s.N, rng = o.rng;
  const base = fbmField(N, { freq: 12, freqY: 40, octaves: 4, seed: o.seed + 5 });
  const shade = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 12 });
  for (let i = 0; i < N * N; i++) {
    const b = base[i], sh = sat(shade[i] * 0.5 + 0.5);
    hsl2rgb(0.115, 0.36, 0.18 + sh * 0.09 + b * 0.05, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.3 + b * 0.1 + sh * 0.08;
    s.rgh[i] = 0.97;
  }
  s.beginStrokes();
  const rows = 7;
  const perRow = Math.round(N * 1.6 * o.detail);
  for (let r = 0; r < rows; r++) {
    const rowY = (r + 0.85) / rows * N;
    for (let k = 0; k < perRow; k++) {
      const x = rng() * N;
      const len = N * (0.10 + rng() * 0.09);
      const ang = Math.PI * 0.5 + (rng() - 0.5) * 0.34;
      const y0 = rowY - len * 0.9 + (rng() - 0.5) * N * 0.02;
      const t = rng();
      hsl2rgb(0.108 + t * 0.02, 0.34 + t * 0.18, 0.14 + t * 0.24, _c3);
      s.style(css(_c3[0], _c3[1], _c3[2]), 0.30 + t * 0.42, 0.97, Math.max(1, N * 0.0022), null, 0.85);
      const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
      const jx = (rng() - 0.5) * 3;
      s.tiled(x, y0, len + 4, (c, px, py) => {
        c.moveTo(px, py);
        c.quadraticCurveTo(px + ex * 0.5 + jx, py + ey * 0.5, px + ex, py + ey);
      });
    }
  }
  s.endStrokes();
  s.normalStrength = 1.1;
  s.aoStrength = 1.45;
  s.heightSmooth = 1;
}

function plasterRecipe(s, o) {
  const N = s.N;
  const trowel = fbmField(N, { freq: 7, freqY: 5, octaves: 4, seed: o.seed + 4 });
  const fine = fbmField(N, { freq: 90, octaves: 3, seed: o.seed + 11 });
  const crack = fbmField(N, { freq: 14, octaves: 4, seed: o.seed + 19, ridged: true });
  const stain = fbmField(N, { freq: 4, octaves: 4, seed: o.seed + 27 });
  for (let i = 0; i < N * N; i++) {
    const t = trowel[i], f = fine[i];
    const cr = sat((crack[i] - 0.80) * 5.5);   // only the sharpest ridges crack
    const st = sat(stain[i] * 0.5 + 0.5);
    hsl2rgb(0.10, 0.09 + st * 0.05, 0.66 + t * 0.06 + f * 0.03 - st * 0.12, _c3);
    const r = lerp(_c3[0], _c3[0] * 0.45, cr);
    const g = lerp(_c3[1], _c3[1] * 0.45, cr);
    const b = lerp(_c3[2], _c3[2] * 0.45, cr);
    s.setAlb(i, r, g, b);
    s.hgt[i] = 0.55 + t * 0.1 + f * 0.03 - cr * 0.3;
    s.rgh[i] = 0.9 + f * 0.04;
  }
  s.normalStrength = 0.95;
  s.aoStrength = 1.0;
}

function paperScreenRecipe(s, o) {
  const N = s.N;
  const fib1 = fbmField(N, { freq: 160, freqY: 6, octaves: 2, seed: o.seed + 3 });
  const fib2 = fbmField(N, { freq: 6, freqY: 160, octaves: 2, seed: o.seed + 4 });
  const stain = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 12 });
  const grid = 6;
  const barW = 0.09;
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const gv = Math.abs(((v * grid) % 1) - 0.5) * 2;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const gu = Math.abs(((u * grid) % 1) - 0.5) * 2;
      const bar = Math.max(smoothstep(1 - barW, 1, gu), smoothstep(1 - barW, 1, gv));
      const f = fib1[i] * 0.5 + fib2[i] * 0.5;
      const st = sat(stain[i] * 0.5 + 0.5);
      hsl2rgb(0.11, 0.13, 0.80 + f * 0.05 - st * 0.09, _c3);   // rice paper
      hsl2rgb(0.065, 0.34, 0.18, _c3b);                        // lattice frame
      s.setAlb(i, lerp(_c3[0], _c3b[0], bar), lerp(_c3[1], _c3b[1], bar), lerp(_c3[2], _c3b[2], bar));
      s.hgt[i] = 0.46 + f * 0.05 + bar * 0.34;
      s.rgh[i] = 0.88 - bar * 0.14;
    }
  }
  s.normalStrength = 0.8;
  s.aoStrength = 1.1;
}

/* --------------------------------------------------------------- organic -- */

function pineNeedleRecipe(s, o) {
  const N = s.N, rng = o.rng;
  for (let i = 0; i < N * N; i++) {
    s.setAlb(i, 0, 0, 0, 0);
    s.hgt[i] = 0.5;
    s.rgh[i] = 0.92;
  }
  s.transparent = true;
  s.beginStrokes();
  const sprigs = Math.round(34 * o.detail) + 10;
  for (let k = 0; k < sprigs; k++) {
    const x = rng() * N, y = rng() * N;
    const dir = rng() * TAU;
    const stemLen = N * (0.16 + rng() * 0.16);
    const dark = 0.12 + rng() * 0.1;
    hsl2rgb(0.30, 0.5, dark, _c3);
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.62, 0.9, Math.max(1.2, N * 0.004));
    s.tiled(x, y, stemLen + 4, (c, px, py) => {
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(dir) * stemLen, py + Math.sin(dir) * stemLen);
    });
    const needles = Math.round(stemLen / Math.max(2, N * 0.012));
    for (let n = 0; n < needles; n++) {
      const t = n / needles;
      const bx = x + Math.cos(dir) * stemLen * t;
      const by = y + Math.sin(dir) * stemLen * t;
      const nl = N * (0.03 + rng() * 0.035) * (1 - t * 0.4);
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const a = dir + sgn * (0.55 + rng() * 0.4);
        const tone = rng();
        hsl2rgb(0.29 + tone * 0.05, 0.45 + tone * 0.2, 0.14 + tone * 0.14, _c3);
        s.style(css(_c3[0], _c3[1], _c3[2]), 0.5 + tone * 0.25, 0.92, Math.max(1, N * 0.0026));
        s.tiled(bx, by, nl + 3, (c, px, py) => {
          c.moveTo(px, py);
          c.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl);
        });
      }
    }
  }
  s.endStrokes();
  // canvas readback already carries per-texel coverage in the alpha channel
  s.normalStrength = 0.6;
}

function broadLeafRecipe(s, o) {
  const N = s.N, rng = o.rng;
  for (let i = 0; i < N * N; i++) { s.setAlb(i, 0, 0, 0, 0); s.hgt[i] = 0.5; s.rgh[i] = 0.86; }
  s.transparent = true;
  s.beginStrokes();
  const leaves = Math.round(88 * o.detail) + 24;
  for (let k = 0; k < leaves; k++) {
    const x = rng() * N, y = rng() * N;
    const len = N * (0.10 + rng() * 0.12);
    const wid = len * (0.32 + rng() * 0.2);
    const rot = rng() * TAU;
    const tone = rng();
    hsl2rgb(0.27 - tone * 0.06, 0.44 + tone * 0.18, 0.16 + tone * 0.16, _c3);
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.5 + tone * 0.2, 0.88, 1);
    s.tiled(x, y, len, (c, px, py) => {
      c.save();
      c.translate(px, py); c.rotate(rot);
      c.moveTo(-len * 0.5, 0);
      c.quadraticCurveTo(0, -wid * 0.5, len * 0.5, 0);
      c.quadraticCurveTo(0, wid * 0.5, -len * 0.5, 0);
      c.restore();
    }, true);
    // midrib + veins
    hsl2rgb(0.24, 0.35, 0.10 + tone * 0.08, _c3);
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.62, 0.9, Math.max(1, N * 0.0022));
    s.tiled(x, y, len, (c, px, py) => {
      c.save(); c.translate(px, py); c.rotate(rot);
      c.moveTo(-len * 0.5, 0); c.lineTo(len * 0.5, 0);
      c.restore();
    });
  }
  s.endStrokes();
  // canvas readback already carries per-texel coverage in the alpha channel
  s.normalStrength = 0.7;
}

function bushRecipe(s, o) {
  const N = s.N, rng = o.rng;
  for (let i = 0; i < N * N; i++) { s.setAlb(i, 0, 0, 0, 0); s.hgt[i] = 0.5; s.rgh[i] = 0.9; }
  s.transparent = true;
  s.beginStrokes();
  const clusters = Math.round(150 * o.detail) + 50;
  for (let k = 0; k < clusters; k++) {
    const x = rng() * N, y = rng() * N;
    const r = N * (0.02 + rng() * 0.04);
    const tone = rng();
    const depth = rng();
    hsl2rgb(0.26 - tone * 0.05, 0.40 + tone * 0.2, 0.09 + tone * 0.16 * (0.4 + depth * 0.8), _c3);
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.35 + depth * 0.45, 0.92, 1);
    const rot = rng() * TAU;
    const ry = r * (0.5 + rng() * 0.4);
    s.tiled(x, y, r * 1.6, (c, px, py) => { c.ellipse(px, py, r, ry, rot, 0, TAU); }, true);
  }
  // a few berries for read at distance
  for (let k = 0; k < 14; k++) {
    const x = rng() * N, y = rng() * N;
    const r = Math.max(1.5, N * 0.006);
    s.style('rgb(140,26,32)', 0.75, 0.4, 1);
    s.tiled(x, y, r * 2, (c, px, py) => { c.ellipse(px, py, r, r, 0, 0, TAU); }, true);
  }
  s.endStrokes();
  // canvas readback already carries per-texel coverage in the alpha channel
  s.normalStrength = 0.8;
}

function reedRecipe(s, o) {
  const N = s.N, rng = o.rng;
  for (let i = 0; i < N * N; i++) { s.setAlb(i, 0, 0, 0, 0); s.hgt[i] = 0.5; s.rgh[i] = 0.94; }
  s.transparent = true;
  s.beginStrokes();
  const blades = Math.round(70 * o.detail) + 26;
  for (let k = 0; k < blades; k++) {
    const x = rng() * N;
    const y = N * (0.9 + rng() * 0.25);
    const len = N * (0.5 + rng() * 0.5);
    const ang = -Math.PI * 0.5 + (rng() - 0.5) * 0.5;
    const bend = (rng() - 0.5) * len * 0.5;
    const tone = rng();
    hsl2rgb(0.19 + tone * 0.04, 0.42, 0.16 + tone * 0.2, _c3);
    s.style(css(_c3[0], _c3[1], _c3[2]), 0.4 + tone * 0.4, 0.94, Math.max(1.2, N * 0.005));
    const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
    s.tiled(x, y, len + 6, (c, px, py) => {
      c.moveTo(px, py);
      c.quadraticCurveTo(px + ex * 0.5 - bend * 0.4, py + ey * 0.5, px + ex + bend, py + ey);
    });
  }
  s.endStrokes();
  // canvas readback already carries per-texel coverage in the alpha channel
  s.normalStrength = 0.6;
}

function furRecipe(s, o, cfg) {
  const N = s.N, rng = o.rng;
  const flow = fbmField(N, { freq: 4, octaves: 3, seed: o.seed + 3 });
  const patch = fbmField(N, { freq: 8, octaves: 4, seed: o.seed + 9 });
  const under = [0, 0, 0], guard = [0, 0, 0], root = [0, 0, 0];
  hsl2rgb(cfg.h, cfg.s * 0.7, cfg.lUnder, under);
  hsl2rgb(cfg.h, cfg.s, cfg.lGuard, guard);
  hsl2rgb(cfg.h, cfg.s * 1.1, cfg.lRoot, root);

  for (let i = 0; i < N * N; i++) {
    const p = sat(patch[i] * 0.5 + 0.5);
    s.setAlb(i, lerp(root[0], under[0], p), lerp(root[1], under[1], p), lerp(root[2], under[2], p));
    s.hgt[i] = 0.28 + p * 0.1;
    s.rgh[i] = 0.94;
  }

  s.beginStrokes();
  const total = Math.round((N * N) / 30 * o.detail);
  const flowScale = Math.PI * 1.5;
  for (let k = 0; k < total; k++) {
    const x = rng() * N, y = rng() * N;
    const idx = (Math.floor(y) * N + Math.floor(x)) | 0;
    const dir = cfg.dir + flow[idx] * flowScale;
    const guardHair = rng() < 0.34;
    const len = N * (guardHair ? 0.028 + rng() * 0.035 : 0.014 + rng() * 0.016);
    const segs = 3;
    const px0 = x, py0 = y;
    const curl = (rng() - 0.5) * 0.6;
    let prevX = px0, prevY = py0;
    const pts = [];
    for (let sIdx = 1; sIdx <= segs; sIdx++) {
      const t = sIdx / segs;
      const a = dir + curl * t;
      prevX += Math.cos(a) * (len / segs);
      prevY += Math.sin(a) * (len / segs);
      pts.push(prevX, prevY);
    }
    const tone = rng();
    let lastX = px0, lastY = py0;
    for (let sIdx = 0; sIdx < segs; sIdx++) {
      const t = (sIdx + 1) / segs;
      // dark at the root, brighter at the tip
      const l = lerp(cfg.lRoot, guardHair ? cfg.lTip : cfg.lGuard, t) + tone * 0.05;
      hsl2rgb(cfg.h, cfg.s * (1 - t * 0.2), l, _c3);
      s.style(css(_c3[0], _c3[1], _c3[2]), 0.3 + t * 0.55, 0.95, guardHair ? Math.max(1, N * 0.0022) : Math.max(1, N * 0.0016), null, 0.85);
      const ax = lastX, ay = lastY;
      const bx = pts[sIdx * 2], by = pts[sIdx * 2 + 1];
      s.tiled(ax, ay, len + 3, (c, cx, cy) => {
        c.moveTo(cx, cy);
        c.lineTo(cx + (bx - ax), cy + (by - ay));
      });
      lastX = bx; lastY = by;
    }
  }
  s.endStrokes();
  s.normalStrength = 0.85;
  s.aoStrength = 1.3;
  s.heightSmooth = 1;
}

function hideRecipe(s, o) {
  const N = s.N;
  const grain = fbmField(N, { freq: 110, octaves: 3, seed: o.seed + 5 });
  const cells = worleyField(N, { cells: Math.max(20, Math.round(N / 16)), seed: o.seed + 11, jitter: 1 });
  const macro = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 19 });
  for (let i = 0; i < N * N; i++) {
    const pore = smoothstep(0.4, 0.06, cells.f1[i]);
    const g = grain[i];
    const m = sat(macro[i] * 0.5 + 0.5);
    hsl2rgb(0.075, 0.24 + m * 0.06, 0.20 + m * 0.13 + g * 0.05 + pore * 0.07, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.44 + pore * 0.16 + g * 0.05 + m * 0.06;
    s.rgh[i] = 0.86 - pore * 0.08 + g * 0.03;
  }
  s.normalStrength = 1.0;
  s.aoStrength = 1.0;
}

function chitinRecipe(s, o) {
  const N = s.N;
  const plates = worleyField(N, { cells: 5, cellsY: 8, seed: o.seed + 4, jitter: 0.7 });
  const bumps = worleyField(N, { cells: Math.max(24, Math.round(N / 14)), seed: o.seed + 12 });
  const irid = fbmField(N, { freq: 9, octaves: 3, seed: o.seed + 20 });
  for (let i = 0; i < N * N; i++) {
    const seam = smoothstep(0.0, 0.1, plates.f2[i] - plates.f1[i]);
    const bump = smoothstep(0.5, 0.1, bumps.f1[i]);
    const ir = irid[i] * 0.5 + 0.5;
    // dark carapace with an oily hue shift
    hsl2rgb(0.66 + ir * 0.16, 0.26 - seam * 0.08, 0.05 + seam * 0.10 + bump * 0.04 + ir * 0.03, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.2 + seam * 0.5 + bump * 0.14;
    s.rgh[i] = 0.34 + (1 - seam) * 0.2 - bump * 0.06;
  }
  s.normalStrength = 1.4;
  s.aoStrength = 1.3;
  s.metalness = 0.1;
}

function scaleRecipe(s, o, cfg) {
  const N = s.N;
  const rows = 16, cols = 12;
  const grain = fbmField(N, { freq: 80, octaves: 3, seed: o.seed + 6 });
  const macro = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 14 });
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const row = Math.floor(v * rows);
    const bv = v * rows - row;
    const off = (row & 1) * 0.5;
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const cu = (u + off / cols) * cols;
      const col = Math.floor(cu);
      const bu = cu - col;
      const ch = hashf(((col % cols) + cols) % cols, row, o.seed + 44);
      // rounded scale, overlapping downward
      const dx = (bu - 0.5) * 2;
      const dy = (bv - 0.35) * 1.55;
      const d = Math.sqrt(dx * dx + dy * dy);
      const face = 1 - smoothstep(0.72, 1.0, d);
      const dome = Math.sqrt(Math.max(0, 1 - Math.min(1, d * d)));
      // the row above overlaps this scale's crown, so it sits in shadow
      const overlap = smoothstep(-0.95, -0.1, dy);
      const g = grain[i];
      const m = sat(macro[i] * 0.5 + 0.5);
      hsl2rgb(cfg.h + ch * cfg.hVar + m * 0.02, cfg.s - dome * 0.08,
        cfg.l + ch * cfg.lVar + dome * 0.10 + g * 0.03, _c3);
      const sh = 0.42 + overlap * 0.58;
      const r = lerp(_c3[0] * 0.22, _c3[0] * sh, face);
      const gg = lerp(_c3[1] * 0.22, _c3[1] * sh, face);
      const b = lerp(_c3[2] * 0.22, _c3[2] * sh, face);
      s.setAlb(i, r, gg, b);
      s.hgt[i] = 0.16 + face * (0.30 + dome * 0.40) * (0.55 + overlap * 0.45);
      s.rgh[i] = cfg.rough - dome * 0.14 + (1 - face) * 0.18;
    }
  }
  s.normalStrength = 1.35;
  s.aoStrength = 1.25;
  s.metalness = cfg.metal || 0;
}

function boneRecipe(s, o) {
  const N = s.N;
  const grain = fbmField(N, { freq: 22, freqY: 60, octaves: 4, seed: o.seed + 3 });
  const pit = worleyField(N, { cells: Math.max(24, Math.round(N / 14)), seed: o.seed + 11 });
  const stain = fbmField(N, { freq: 6, octaves: 4, seed: o.seed + 19 });
  const crack = fbmField(N, { freq: 24, freqY: 60, octaves: 3, seed: o.seed + 27, ridged: true });
  for (let i = 0; i < N * N; i++) {
    const g = grain[i];
    const p = smoothstep(0.32, 0.04, pit.f1[i]);
    const st = sat(stain[i] * 0.5 + 0.5);
    const cr = sat(crack[i] * 1.7 - 0.85);
    hsl2rgb(0.115, 0.17 + st * 0.06, 0.70 + g * 0.05 - st * 0.16 - p * 0.05, _c3);
    const r = lerp(_c3[0], _c3[0] * 0.4, cr);
    const gg = lerp(_c3[1], _c3[1] * 0.4, cr);
    const b = lerp(_c3[2], _c3[2] * 0.42, cr);
    s.setAlb(i, r, gg, b);
    s.hgt[i] = 0.56 + g * 0.06 - p * 0.2 - cr * 0.25;
    s.rgh[i] = 0.72 + p * 0.12 + st * 0.08;
  }
  s.normalStrength = 1.1;
  s.aoStrength = 1.2;
}

function fleshRecipe(s, o) {
  const N = s.N;
  const fibre = fbmField(N, { freq: 130, freqY: 12, octaves: 3, seed: o.seed + 4 });
  const bundle = fbmField(N, { freq: 22, freqY: 6, octaves: 4, seed: o.seed + 12 });
  const vein = fbmField(N, { freq: 9, octaves: 4, seed: o.seed + 20, ridged: true });
  const wet = fbmField(N, { freq: 7, octaves: 3, seed: o.seed + 28 });
  for (let i = 0; i < N * N; i++) {
    const f = fibre[i], b = bundle[i] * 0.5 + 0.5;
    const v = sat(vein[i] * 1.6 - 0.7);
    const w = sat(wet[i] * 0.5 + 0.5);
    hsl2rgb(0.985 + b * 0.01, 0.52 - b * 0.08, 0.20 + b * 0.12 + f * 0.05, _c3);
    const r = lerp(_c3[0], 96, v * 0.7);
    const g = lerp(_c3[1], 24, v * 0.7);
    const bb = lerp(_c3[2], 30, v * 0.7);
    s.setAlb(i, r, g, bb);
    s.hgt[i] = 0.42 + b * 0.16 + f * 0.06 - v * 0.14;
    s.rgh[i] = 0.42 - w * 0.18 + v * 0.1;
  }
  s.normalStrength = 1.1;
  s.aoStrength = 1.1;
}

function skinRecipe(s, o, cfg) {
  const N = s.N;
  const pore = worleyField(N, { cells: Math.max(40, Math.round(N / 8)), seed: o.seed + 5 });
  const macro = fbmField(N, { freq: 6, octaves: 4, seed: o.seed + 13 });
  const fine = fbmField(N, { freq: 120, octaves: 2, seed: o.seed + 21 });
  for (let i = 0; i < N * N; i++) {
    const p = smoothstep(0.35, 0.05, pore.f1[i]);
    const m = macro[i] * 0.5 + 0.5;
    const f = fine[i];
    hsl2rgb(cfg.h, cfg.s + m * 0.04, cfg.l + m * 0.05 + f * 0.015 - p * 0.02, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.52 - p * 0.1 + m * 0.04;
    s.rgh[i] = cfg.rough + p * 0.06 + f * 0.02;
  }
  s.normalStrength = 0.6;
  s.aoStrength = 0.7;
}

/* ------------------------------------------------------------------ gear -- */

function metalRecipe(s, o, cfg) {
  const N = s.N;
  const facets = worleyField(N, { cells: Math.max(9, Math.round(N / 26)), seed: o.seed + 3, jitter: 1 });
  const polish = fbmField(N, { freq: Math.max(60, N >> 2), freqY: 5, octaves: 3, seed: o.seed + 9 });
  const scratch = fbmField(N, { freq: Math.max(120, N >> 1), freqY: 4, octaves: 2, seed: o.seed + 15 });
  const tarnishF = fbmField(N, { freq: 7, octaves: 4, seed: o.seed + 23 });
  const dent = fbmField(N, { freq: 26, octaves: 3, seed: o.seed + 31 });

  const base = [0, 0, 0], bright = [0, 0, 0], tarn = [0, 0, 0];
  hsl2rgb(cfg.h, cfg.s, cfg.l, base);
  hsl2rgb(cfg.h, cfg.s * 0.55, Math.min(0.95, cfg.l + 0.28), bright);
  hsl2rgb(cfg.th, cfg.ts, cfg.tl, tarn);

  // hammer facets: shallow domes with crisp seams
  const height = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const dome = smoothstep(0.85, 0.05, facets.f1[i]);
    const seam = smoothstep(0.0, 0.1, facets.f2[i] - facets.f1[i]);
    height[i] = 0.36 + dome * 0.22 * cfg.hammer + seam * 0.10 * cfg.hammer
      + dent[i] * 0.05 + scratch[i] * 0.012;
  }
  const wear = edgeWearMask(height, N, Math.max(2, Math.round(N / 48)), 5.5);

  for (let i = 0; i < N * N; i++) {
    const pol = polish[i];
    const sc = scratch[i];
    const w = wear[i];
    const tv = sat(tarnishF[i] * 0.5 + 0.5);
    // tarnish pools where the surface is low
    const low = sat(1 - height[i] * 1.5);
    const tarnMask = smoothstep(0.42, 0.95, tv * 0.6 + low * 0.7) * cfg.tarnish;

    // facet shading + directional polish streaks carry most of the read
    const dome = smoothstep(0.85, 0.05, facets.f1[i]);
    const shade = 0.78 + dome * 0.30 * cfg.hammer + pol * 0.20 + sc * 0.08;
    let r = base[0] * shade;
    let g = base[1] * shade;
    let b = base[2] * shade;
    r = lerp(r, bright[0], w * cfg.wear);
    g = lerp(g, bright[1], w * cfg.wear);
    b = lerp(b, bright[2], w * cfg.wear);
    r = lerp(r, tarn[0], tarnMask);
    g = lerp(g, tarn[1], tarnMask);
    b = lerp(b, tarn[2], tarnMask);
    s.setAlb(i, r, g, b);
    s.hgt[i] = height[i] + tarnMask * 0.04;
    s.rgh[i] = sat(cfg.rough + pol * cfg.polishAmt + sc * 0.06 - w * 0.26 + tarnMask * 0.42);
  }
  s.normalStrength = cfg.normal;
  s.aoStrength = 1.0;
  s.metalness = 1;
}

function rustRecipe(s, o) {
  metalRecipe(s, o, {
    h: 0.58, s: 0.03, l: 0.34, th: 0.06, ts: 0.5, tl: 0.24,
    hammer: 0.9, tarnish: 0.6, wear: 0.5, rough: 0.5, polishAmt: 0.08, normal: 1.2,
  });
  const N = s.N;
  const blot = fbmField(N, { freq: 6, octaves: 5, seed: o.seed + 201 });
  const flake = fbmField(N, { freq: 40, octaves: 4, seed: o.seed + 202 });
  const pit = worleyField(N, { cells: Math.max(16, Math.round(N / 22)), seed: o.seed + 203 });
  for (let i = 0; i < N * N; i++) {
    const m = smoothstep(0.34, 0.72, sat(blot[i] * 0.5 + 0.5) + flake[i] * 0.2);
    if (m <= 0.001) continue;
    const fl = flake[i];
    const p = smoothstep(0.3, 0.05, pit.f1[i]);
    hsl2rgb(0.055 + fl * 0.015, 0.62, 0.22 + fl * 0.1 + p * 0.05, _c3);
    const p4 = i * 4;
    s.alb[p4] = lerp(s.alb[p4], _c3[0], m);
    s.alb[p4 + 1] = lerp(s.alb[p4 + 1], _c3[1], m);
    s.alb[p4 + 2] = lerp(s.alb[p4 + 2], _c3[2], m);
    s.hgt[i] += m * (fl * 0.1 - p * 0.16);
    s.rgh[i] = lerp(s.rgh[i], 0.96, m);
  }
  s.metalness = 0.55;
}

function weaveRecipe(s, o, cfg) {
  const N = s.N;
  const threads = cfg.threads;
  const fuzz = fbmField(N, { freq: 140, octaves: 2, seed: o.seed + 4 });
  const macro = fbmField(N, { freq: 5, octaves: 4, seed: o.seed + 12 });
  const slub = fbmField(N, { freq: threads * 2, freqY: 6, octaves: 2, seed: o.seed + 20 });
  const colA = [0, 0, 0], colB = [0, 0, 0];
  hsl2rgb(cfg.h, cfg.s, cfg.l, colA);
  hsl2rgb(cfg.h + cfg.hVar, cfg.s * 0.9, cfg.l * 0.86, colB);

  for (let y = 0; y < N; y++) {
    const v = y / N;
    const ty = v * threads;
    const wy = ty - Math.floor(ty);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const tx = u * threads;
      const wx = tx - Math.floor(tx);
      // plain weave: alternate which yarn is on top
      const over = ((Math.floor(tx) + Math.floor(ty)) & 1) === 0;
      const bumpX = Math.sin(wx * Math.PI);
      const bumpY = Math.sin(wy * Math.PI);
      const bump = over ? bumpY : bumpX;
      const f = fuzz[i], m = macro[i] * 0.5 + 0.5, sl = slub[i];
      const cA = over ? colA : colB;
      const shade = 0.7 + bump * 0.42 + f * cfg.fuzz + sl * 0.05 + m * 0.06;
      s.setAlb(i, cA[0] * shade, cA[1] * shade, cA[2] * shade);
      s.hgt[i] = 0.34 + bump * 0.28 + f * 0.04;
      s.rgh[i] = cfg.rough - bump * cfg.sheen + f * 0.05;
    }
  }
  s.normalStrength = cfg.normal || 1.0;
  s.aoStrength = 1.1;
}

function leatherRecipe(s, o, studded) {
  const N = s.N;
  const cells = worleyField(N, { cells: Math.max(20, Math.round(N / 16)), seed: o.seed + 5, jitter: 1 });
  const cells2 = worleyField(N, { cells: Math.max(38, Math.round(N / 9)), seed: o.seed + 6, jitter: 1 });
  const macro = fbmField(N, { freq: 6, octaves: 4, seed: o.seed + 13 });
  const scuff = fbmField(N, { freq: 34, octaves: 3, seed: o.seed + 21 });
  for (let i = 0; i < N * N; i++) {
    const p1 = smoothstep(0.42, 0.06, cells.f1[i]);
    const p2 = smoothstep(0.4, 0.06, cells2.f1[i]);
    const m = sat(macro[i] * 0.5 + 0.5);
    const sc = scuff[i];
    hsl2rgb(0.065, 0.36 - m * 0.06, 0.12 + m * 0.09 + p1 * 0.08 + p2 * 0.05 + sc * 0.04, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.4 + p1 * 0.14 + p2 * 0.1 + m * 0.06;
    s.rgh[i] = 0.66 + p1 * 0.08 - sc * 0.06 + m * 0.06;
  }
  s.normalStrength = 1.05;
  s.aoStrength = 1.0;

  if (studded) {
    s.beginStrokes();
    const cols = 6, rows = 6;
    const rr = Math.max(2, N * 0.014);
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const cx = ((rx + 0.5 + ((ry & 1) ? 0.5 : 0)) / cols) * N;
        const cy = ((ry + 0.5) / rows) * N;
        s.style('rgb(24,22,20)', 0.34, 0.7, 1);
        s.tiled(cx, cy, rr * 2.2, (c, px, py) => { c.ellipse(px, py, rr * 1.25, rr * 1.25, 0, 0, TAU); }, true);
        s.style('rgb(126,120,110)', 0.9, 0.28, 1);
        s.tiled(cx, cy, rr * 2.2, (c, px, py) => { c.ellipse(px, py, rr, rr, 0, 0, TAU); }, true);
        s.style('rgb(196,190,178)', 0.96, 0.18, 1);
        s.tiled(cx, cy, rr * 2.2, (c, px, py) => { c.ellipse(px - rr * 0.28, py - rr * 0.28, rr * 0.42, rr * 0.42, 0, 0, TAU); }, true);
      }
    }
    s.endStrokes();
    s.metalness = 0.35;
    s.normalStrength = 1.3;
  }
}

/* -------------------------------------------------------------------- fx -- */

function runeRecipe(s, o) {
  const N = s.N, rng = o.rng;
  const stone = fbmField(N, { freq: 30, octaves: 4, seed: o.seed + 4 });
  s.enableEmissive();
  for (let i = 0; i < N * N; i++) {
    const g = stone[i];
    hsl2rgb(0.62, 0.12, 0.10 + g * 0.05, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.setEms(i, 0, 0, 0);
    s.hgt[i] = 0.6 + g * 0.06;
    s.rgh[i] = 0.8;
  }
  s.beginStrokes();
  const cx = N * 0.5, cy = N * 0.5;
  const glow = 'rgb(96,196,255)';
  const glowDim = 'rgb(34,96,150)';

  // concentric rings
  const rings = [0.46, 0.40, 0.20];
  for (let k = 0; k < rings.length; k++) {
    const rr = N * rings[k];
    s.style('rgb(120,208,255)', 0.30, 0.4, Math.max(1.5, N * (k === 0 ? 0.007 : 0.004)), glow);
    s.tiled(cx, cy, rr + 8, (c, px, py) => { c.ellipse(px, py, rr, rr, 0, 0, TAU); });
  }
  // radial ticks
  const ticks = 24;
  for (let k = 0; k < ticks; k++) {
    const a = (k / ticks) * TAU;
    const r0 = N * 0.40, r1 = N * 0.46;
    s.style('rgb(120,208,255)', 0.28, 0.4, Math.max(1.2, N * 0.0035), glowDim);
    s.tiled(cx, cy, N * 0.5, (c, px, py) => {
      c.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0);
      c.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
    });
  }
  // pseudo-glyphs around the band
  const glyphs = 12;
  for (let k = 0; k < glyphs; k++) {
    const a = (k / glyphs) * TAU + 0.1;
    const rr = N * 0.30;
    const gx = cx + Math.cos(a) * rr, gy = cy + Math.sin(a) * rr;
    const size = N * 0.035;
    s.style('rgb(150,226,255)', 0.24, 0.35, Math.max(1.4, N * 0.0035), glow);
    const strokes = 3 + Math.floor(rng() * 3);
    for (let t = 0; t < strokes; t++) {
      const x0 = gx + (rng() - 0.5) * size, y0 = gy + (rng() - 0.5) * size;
      const x1 = gx + (rng() - 0.5) * size, y1 = gy + (rng() - 0.5) * size;
      s.tiled(gx, gy, size * 2, (c, px, py) => {
        c.moveTo(px + (x0 - gx), py + (y0 - gy));
        c.lineTo(px + (x1 - gx), py + (y1 - gy));
      });
    }
  }
  // inner sigil: a star polygon
  const pts = 7, step = 3, rr = N * 0.18;
  s.style('rgb(170,236,255)', 0.22, 0.3, Math.max(1.6, N * 0.005), glow);
  s.tiled(cx, cy, rr + 6, (c, px, py) => {
    for (let k = 0; k <= pts; k++) {
      const a = ((k * step) % pts) / pts * TAU - Math.PI * 0.5;
      const x = px + Math.cos(a) * rr, y = py + Math.sin(a) * rr;
      if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
  });
  s.endStrokes();
  // engraved: glyph strokes sit below the stone face
  s.normalStrength = 1.3;
  s.aoStrength = 1.2;
}

function parchmentRecipe(s, o) {
  const N = s.N;
  const fibre = fbmField(N, { freq: 150, freqY: 8, octaves: 2, seed: o.seed + 3 });
  const fibre2 = fbmField(N, { freq: 8, freqY: 150, octaves: 2, seed: o.seed + 4 });
  const stain = fbmField(N, { freq: 4, octaves: 5, seed: o.seed + 11 });
  const foxing = worleyField(N, { cells: 7, seed: o.seed + 19, jitter: 1 });
  for (let i = 0; i < N * N; i++) {
    const f = fibre[i] * 0.5 + fibre2[i] * 0.5;
    const st = sat(stain[i] * 0.5 + 0.5);
    const fx = smoothstep(0.34, 0.06, foxing.f1[i]);
    hsl2rgb(0.098 + fx * 0.01, 0.28 + st * 0.08, 0.72 - st * 0.16 - fx * 0.14 + f * 0.03, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.5 + f * 0.08 + (st - 0.5) * 0.06;
    s.rgh[i] = 0.9 + f * 0.04;
  }
  s.normalStrength = 0.7;
  s.aoStrength = 0.8;
}

function lavaRecipe(s, o) {
  const N = s.N;
  const warpX = fbmField(N, { freq: 8, octaves: 3, seed: o.seed + 91 });
  const warpY = fbmField(N, { freq: 8, octaves: 3, seed: o.seed + 92 });
  const crust = worleyField(N, {
    cells: Math.max(4, Math.round(N / 150)), seed: o.seed + 3, jitter: 1,
    warpX, warpY, warpAmt: N * 0.045,
  });
  const fine = worleyField(N, {
    cells: Math.max(10, Math.round(N / 52)), seed: o.seed + 4, jitter: 1,
    warpX, warpY, warpAmt: N * 0.02,
  });
  const soot = fbmField(N, { freq: 40, octaves: 4, seed: o.seed + 12 });
  const flow = fbmField(N, { freq: 6, octaves: 4, seed: o.seed + 20 });
  s.enableEmissive();

  for (let i = 0; i < N * N; i++) {
    const seamA = crust.f2[i] - crust.f1[i];
    const seamB = fine.f2[i] - fine.f1[i];
    const crackA = 1 - smoothstep(0.0, 0.10, seamA);
    const crackB = (1 - smoothstep(0.0, 0.055, seamB)) * 0.55;
    const crack = sat(Math.max(crackA, crackB) * (0.6 + sat(flow[i] * 0.5 + 0.5) * 0.9));
    const so = soot[i];
    const plate = 1 - crack;

    // cooled black crust
    hsl2rgb(0.03, 0.12, 0.045 + so * 0.03 + crust.id[i] * 0.02, _c3);
    // molten channel colour
    const heat = sat(crack * 1.25);
    const hotR = lerp(_c3[0], 255, heat);
    const hotG = lerp(_c3[1], 118 * heat + 20, heat);
    const hotB = lerp(_c3[2], 26 * heat, heat);
    s.setAlb(i, hotR, hotG, hotB);

    // emissive is what bloom picks up
    const e = Math.pow(heat, 1.6);
    s.setEms(i, 255 * e, (95 + 130 * heat) * e * 0.9, 22 * e);

    s.hgt[i] = 0.26 + plate * 0.42 + so * 0.05 - crack * 0.12;
    s.rgh[i] = 0.92 - heat * 0.45;
  }
  s.normalStrength = 1.5;
  s.aoStrength = 1.3;
}

function waterNormalRecipe(s, o) {
  const N = s.N;
  const a = fbmField(N, { freq: 6, freqY: 9, octaves: 4, seed: o.seed + 3 });
  const b = fbmField(N, { freq: 11, freqY: 7, octaves: 4, seed: o.seed + 4 });
  const c = fbmField(N, { freq: 26, octaves: 3, seed: o.seed + 5 });
  for (let i = 0; i < N * N; i++) {
    const h = a[i] * 0.5 + b[i] * 0.35 + c[i] * 0.15;
    s.hgt[i] = 0.5 + h * 0.3;
    hsl2rgb(0.55, 0.42, 0.16 + h * 0.05, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.rgh[i] = 0.08;
  }
  s.normalStrength = 0.75;
  s.aoStrength = 0.3;
}

function causticsRecipe(s, o) {
  const N = s.N;
  const w1 = worleyField(N, { cells: 6, seed: o.seed + 3, jitter: 1 });
  const w2 = worleyField(N, { cells: 9, seed: o.seed + 4, jitter: 1 });
  s.enableEmissive();
  for (let i = 0; i < N * N; i++) {
    const e1 = sat(1 - Math.abs(w1.f2[i] - w1.f1[i]) * 7);
    const e2 = sat(1 - Math.abs(w2.f2[i] - w2.f1[i]) * 9) * 0.6;
    const v = sat(Math.pow(Math.max(e1, e2), 1.7));
    const r = 150 * v, g = 216 * v, b = 255 * v;
    s.setAlb(i, r, g, b, 255);
    s.setEms(i, r, g, b);
    s.hgt[i] = 0.5;
    s.rgh[i] = 0.4;
  }
  s.normalStrength = 0.2;
  s.aoStrength = 0.2;
}

/** Shared sprite helper: radial falloff * optional noise, emissive = albedo. */
function radialSprite(s, o, cfg) {
  const N = s.N;
  const nz = cfg.noiseFreq ? fbmField(N, { freq: cfg.noiseFreq, octaves: cfg.noiseOct || 4, seed: o.seed + 7 }) : null;
  s.enableEmissive();
  s.sprite = true;
  s.transparent = true;
  const cx = (N - 1) * 0.5, cy = (N - 1) * 0.5;
  const inv = 1 / (N * 0.5);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = (x - cx) * inv, dy = (y - cy) * inv;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (cfg.stretchY) d = Math.sqrt(dx * dx + (dy / cfg.stretchY) * (dy / cfg.stretchY));
      let a = sat(1 - d);
      a = Math.pow(a, cfg.power);
      if (nz) a *= sat(0.55 + nz[i] * cfg.noiseAmt + 0.45);
      a = sat(a);
      const t = sat(a * cfg.coreBoost);
      const r = lerp(cfg.colOuter[0], cfg.colInner[0], t);
      const g = lerp(cfg.colOuter[1], cfg.colInner[1], t);
      const b = lerp(cfg.colOuter[2], cfg.colInner[2], t);
      s.setAlb(i, r, g, b, a * 255);
      s.setEms(i, r * a * cfg.emissive, g * a * cfg.emissive, b * a * cfg.emissive);
      s.hgt[i] = 0.5;
      s.rgh[i] = 0.9;
    }
  }
  s.normalStrength = 0.1;
  s.aoStrength = 0;
}

function smokePuffRecipe(s, o) {
  const N = s.N;
  const nz = fbmField(N, { freq: 5, octaves: 5, seed: o.seed + 3 });
  const nz2 = fbmField(N, { freq: 13, octaves: 4, seed: o.seed + 4 });
  s.sprite = true; s.transparent = true;
  const cx = (N - 1) * 0.5, cy = (N - 1) * 0.5, inv = 1 / (N * 0.5);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = (x - cx) * inv, dy = (y - cy) * inv;
      const d = Math.sqrt(dx * dx + dy * dy);
      const puff = sat(1 - d + nz[i] * 0.32 + nz2[i] * 0.14);
      const a = Math.pow(sat(puff * 1.15), 1.5);
      const l = 150 + nz2[i] * 60 + (1 - d) * 40;
      s.setAlb(i, l, l * 0.98, l * 0.95, a * 255);
      s.hgt[i] = 0.5;
      s.rgh[i] = 1;
    }
  }
  s.normalStrength = 0.1; s.aoStrength = 0;
}

function bloodSplatRecipe(s, o) {
  const N = s.N, rng = o.rng;
  s.sprite = true; s.transparent = true;
  for (let i = 0; i < N * N; i++) { s.setAlb(i, 0, 0, 0, 0); s.hgt[i] = 0.5; s.rgh[i] = 0.45; }
  s.beginStrokes();
  const cx = N * 0.5, cy = N * 0.5;
  s.style('rgb(104,10,12)', 0.62, 0.3, 1);
  const lobes = 9;
  s.tiled(cx, cy, N * 0.4, (c, px, py) => {
    for (let k = 0; k <= lobes; k++) {
      const a = (k / lobes) * TAU;
      const rr = N * (0.14 + 0.10 * hashf(k, 1, o.seed));
      const x = px + Math.cos(a) * rr, y = py + Math.sin(a) * rr;
      if (k === 0) c.moveTo(x, y);
      else {
        const am = a - Math.PI / lobes;
        const rm = N * (0.10 + 0.12 * hashf(k, 2, o.seed));
        c.quadraticCurveTo(px + Math.cos(am) * rm, py + Math.sin(am) * rm, x, y);
      }
    }
    c.closePath();
  }, true);
  const drops = 40;
  for (let k = 0; k < drops; k++) {
    const a = rng() * TAU;
    const rr = N * (0.16 + rng() * 0.3);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    const dr = N * (0.006 + rng() * 0.02);
    const dry = dr * (0.5 + rng() * 0.7);
    s.style(k % 3 === 0 ? 'rgb(84,6,8)' : 'rgb(118,14,16)', 0.6, 0.3, 1);
    s.tiled(x, y, dr * 2, (c, px, py) => { c.ellipse(px, py, dr, dry, a, 0, TAU); }, true);
  }
  s.endStrokes();
  s.normalStrength = 0.4;
  s.aoStrength = 0;
}

function crackRecipe(s, o) {
  const N = s.N, rng = o.rng;
  s.sprite = true; s.transparent = true;
  for (let i = 0; i < N * N; i++) { s.setAlb(i, 0, 0, 0, 0); s.hgt[i] = 0.5; s.rgh[i] = 0.95; }
  s.beginStrokes();
  const cx = N * 0.5, cy = N * 0.5;
  const branches = 7;
  const drawBranch = (x, y, ang, len, w, depth) => {
    let px = x, py = y;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const a = ang + (rng() - 0.5) * 0.5;
      const nx = px + Math.cos(a) * (len / steps);
      const ny = py + Math.sin(a) * (len / steps);
      s.style('rgb(16,12,10)', 0.18, 0.98, Math.max(1, w));
      const ax = px, ay = py, bx = nx, by = ny;
      s.tiled(ax, ay, len, (c, qx, qy) => {
        c.moveTo(qx, qy);
        c.lineTo(qx + (bx - ax), qy + (by - ay));
      });
      px = nx; py = ny;
      if (depth > 0 && rng() < 0.3) {
        drawBranch(px, py, a + (rng() < 0.5 ? 0.8 : -0.8), len * 0.45, w * 0.6, depth - 1);
      }
    }
  };
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * TAU + rng() * 0.5;
    drawBranch(cx, cy, a, N * (0.22 + rng() * 0.2), N * 0.008, 2);
  }
  s.endStrokes();
  // the crack colour is uniform, so coverage is read out of the height plane:
  // strokes cut the height down to 0.18 while the untouched field stays at 0.5
  for (let i = 0, p = 0; i < N * N; i++, p += 4) {
    const a = sat((0.5 - s.hgt[i]) * 4.2);
    s.alb[p] = 16; s.alb[p + 1] = 12; s.alb[p + 2] = 10; s.alb[p + 3] = a * 255;
  }
  s.normalStrength = 1.2;
  s.aoStrength = 0.6;
}

function crystalRecipe(s, o) {
  const N = s.N;
  const facet = worleyField(N, { cells: 5, cellsY: 9, seed: o.seed + 3, jitter: 0.6 });
  const inner = fbmField(N, { freq: 14, octaves: 4, seed: o.seed + 11 });
  s.enableEmissive();
  for (let i = 0; i < N * N; i++) {
    const seam = smoothstep(0.0, 0.09, facet.f2[i] - facet.f1[i]);
    const iv = sat(inner[i] * 0.5 + 0.5);
    hsl2rgb(0.52 + facet.id[i] * 0.06, 0.55, 0.26 + seam * 0.16 + iv * 0.1, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.setEms(i, _c3[0] * 0.32, _c3[1] * 0.42, _c3[2] * 0.5);
    s.hgt[i] = 0.24 + seam * 0.52 + iv * 0.06;
    s.rgh[i] = 0.14 + (1 - seam) * 0.16;
  }
  s.normalStrength = 1.5;
  s.aoStrength = 0.9;
}

/* ========================================================================== *
 * 4. registry
 * ========================================================================== */

const RECIPES = {
  // ground
  'grass': (s, o) => grassRecipe(s, o, false),
  'grass.dry': (s, o) => grassRecipe(s, o, true),
  'dirt': (s, o) => dirtRecipe(s, o, false),
  'dirt.road': (s, o) => dirtRecipe(s, o, true),
  'mud': mudRecipe,
  'sand': sandRecipe,
  'snow': snowRecipe,
  'stone.floor': stoneFloorRecipe,
  'cobble': cobbleRecipe,
  'cave.floor': caveFloorRecipe,
  'temple.floor': templeFloorRecipe,
  'blood.floor': bloodFloorRecipe,
  // rock
  'rock': (s, o) => rockRecipe(s, o, false),
  'rock.mossy': (s, o) => rockRecipe(s, o, true),
  'cliff': cliffRecipe,
  'gravel': gravelRecipe,
  // wood
  'bark.pine': (s, o) => barkRecipe(s, o, true),
  'bark.oak': (s, o) => barkRecipe(s, o, false),
  'plank': (s, o) => plankRecipe(s, o, false),
  'plank.worn': (s, o) => plankRecipe(s, o, true),
  'log': logRecipe,
  // built
  'brick': brickRecipe,
  'stone.wall': stoneWallRecipe,
  'temple.wall': templeWallRecipe,
  'roof.tile': roofTileRecipe,
  'roof.thatch': thatchRecipe,
  'plaster': plasterRecipe,
  'paper.screen': paperScreenRecipe,
  // organic
  'leaf.pine': pineNeedleRecipe,
  'leaf.broad': broadLeafRecipe,
  'bush': bushRecipe,
  'reed': reedRecipe,
  'fur.brown': (s, o) => furRecipe(s, o, { h: 0.075, s: 0.42, lUnder: 0.27, lGuard: 0.21, lRoot: 0.12, lTip: 0.34, dir: -1.2 }),
  'fur.grey': (s, o) => furRecipe(s, o, { h: 0.09, s: 0.06, lUnder: 0.37, lGuard: 0.30, lRoot: 0.19, lTip: 0.5, dir: -1.35 }),
  'fur.white': (s, o) => furRecipe(s, o, { h: 0.11, s: 0.07, lUnder: 0.70, lGuard: 0.64, lRoot: 0.42, lTip: 0.84, dir: -1.1 }),
  'hide': hideRecipe,
  'chitin': chitinRecipe,
  'scale.green': (s, o) => scaleRecipe(s, o, { h: 0.30, hVar: 0.05, s: 0.44, l: 0.18, lVar: 0.09, rough: 0.44, metal: 0.15 }),
  'scale.red': (s, o) => scaleRecipe(s, o, { h: 0.005, hVar: 0.03, s: 0.56, l: 0.19, lVar: 0.1, rough: 0.4, metal: 0.2 }),
  'bone': boneRecipe,
  'flesh': fleshRecipe,
  'skin.pale': (s, o) => skinRecipe(s, o, { h: 0.055, s: 0.34, l: 0.66, rough: 0.62 }),
  'skin.tan': (s, o) => skinRecipe(s, o, { h: 0.065, s: 0.38, l: 0.50, rough: 0.6 }),
  'skin.grey': (s, o) => skinRecipe(s, o, { h: 0.36, s: 0.10, l: 0.42, rough: 0.72 }),
  // gear
  'iron': (s, o) => metalRecipe(s, o, {
    h: 0.60, s: 0.03, l: 0.35, th: 0.06, ts: 0.22, tl: 0.16,
    hammer: 1.0, tarnish: 0.42, wear: 0.75, rough: 0.44, polishAmt: 0.1, normal: 1.25,
  }),
  'iron.rusted': rustRecipe,
  'steel': (s, o) => metalRecipe(s, o, {
    h: 0.60, s: 0.02, l: 0.52, th: 0.60, ts: 0.06, tl: 0.30,
    hammer: 0.55, tarnish: 0.2, wear: 0.95, rough: 0.24, polishAmt: 0.12, normal: 0.95,
  }),
  'bronze': (s, o) => metalRecipe(s, o, {
    h: 0.095, s: 0.42, l: 0.38, th: 0.44, ts: 0.36, tl: 0.32,
    hammer: 1.15, tarnish: 0.62, wear: 0.8, rough: 0.36, polishAmt: 0.1, normal: 1.35,
  }),
  'gold': (s, o) => metalRecipe(s, o, {
    h: 0.122, s: 0.60, l: 0.44, th: 0.10, ts: 0.45, tl: 0.24,
    hammer: 0.5, tarnish: 0.3, wear: 0.9, rough: 0.18, polishAmt: 0.09, normal: 1.1,
  }),
  'cloth.linen': (s, o) => weaveRecipe(s, o, { h: 0.10, hVar: 0.01, s: 0.20, l: 0.56, threads: 46, fuzz: 0.16, rough: 0.92, sheen: 0.06 }),
  'cloth.silk': (s, o) => weaveRecipe(s, o, { h: 0.02, hVar: 0.004, s: 0.55, l: 0.32, threads: 92, fuzz: 0.06, rough: 0.42, sheen: 0.2, normal: 0.7 }),
  'leather': (s, o) => leatherRecipe(s, o, false),
  'leather.studded': (s, o) => leatherRecipe(s, o, true),
  'sackcloth': (s, o) => weaveRecipe(s, o, { h: 0.10, hVar: 0.02, s: 0.30, l: 0.40, threads: 26, fuzz: 0.3, rough: 0.98, sheen: 0.02, normal: 1.35 }),
  'robe.blue': (s, o) => weaveRecipe(s, o, { h: 0.60, hVar: 0.01, s: 0.46, l: 0.28, threads: 70, fuzz: 0.08, rough: 0.6, sheen: 0.14, normal: 0.8 }),
  'robe.white': (s, o) => weaveRecipe(s, o, { h: 0.12, hVar: 0.006, s: 0.08, l: 0.72, threads: 70, fuzz: 0.09, rough: 0.62, sheen: 0.12, normal: 0.8 }),
  // fx
  'rune': runeRecipe,
  'parchment': parchmentRecipe,
  'lava': lavaRecipe,
  'water.normal': waterNormalRecipe,
  'caustics': causticsRecipe,
  'ember': (s, o) => radialSprite(s, o, {
    power: 2.6, coreBoost: 1.5, emissive: 2.2, noiseFreq: 0,
    colOuter: [150, 26, 6], colInner: [255, 214, 130],
  }),
  'spark': (s, o) => radialSprite(s, o, {
    power: 4.5, coreBoost: 2.0, emissive: 2.6, noiseFreq: 0, stretchY: 2.4,
    colOuter: [190, 120, 40], colInner: [255, 250, 226],
  }),
  'glow.radial': (s, o) => radialSprite(s, o, {
    power: 2.0, coreBoost: 1.3, emissive: 1.6, noiseFreq: 0,
    colOuter: [40, 40, 40], colInner: [255, 255, 255],
  }),
  'smoke.puff': smokePuffRecipe,
  'blood.splat': bloodSplatRecipe,
  'crack': crackRecipe,
  'crystal': crystalRecipe,
};

/** Friendly names other subsystems reach for. Resolved silently. */
const ALIASES = {
  'bark': 'bark.oak',
  'wood': 'plank',
  'leaf': 'leaf.broad',
  'stonewall': 'stone.wall',
  'templewall': 'temple.wall',
  'templefloor': 'temple.floor',
  'rooftile': 'roof.tile',
  'thatch': 'roof.thatch',
  'paperscreen': 'paper.screen',
  'ironrusted': 'iron.rusted',
  'rust': 'iron.rusted',
  'silk': 'cloth.silk',
  'linen': 'cloth.linen',
  'cloth': 'cloth.linen',
  'clothred': 'cloth.silk',
  'clothblue': 'robe.blue',
  'clothwhite': 'robe.white',
  'banner': 'cloth.silk',
  'furbrown': 'fur.brown',
  'furgrey': 'fur.grey',
  'furwhite': 'fur.white',
  'scalegreen': 'scale.green',
  'scalered': 'scale.red',
  'water': 'water.normal',
  'glass': 'crystal',
  'torchwood': 'log',
  'shadowblob': 'glow.radial',
  'eye.glow': 'glow.radial',
  'eyeglow': 'glow.radial',
  'skin': 'skin.tan',
  'stonefloor': 'stone.floor',
  'cavefloor': 'cave.floor',
  'bloodfloor': 'blood.floor',
  'grassdry': 'grass.dry',
  'dirtroad': 'dirt.road',
  'plankworn': 'plank.worn',
  'leatherstudded': 'leather.studded',
  'leafpine': 'leaf.pine',
  'leafbroad': 'leaf.broad',
  'barkpine': 'bark.pine',
  'barkoak': 'bark.oak',
};

/** Kinds that carry an emissive channel. */
const EMISSIVE_KINDS = new Set(['lava', 'rune', 'caustics', 'ember', 'spark', 'glow.radial', 'crystal']);

/** Kinds that deserve the full ground resolution. */
const LARGE_KINDS = new Set([
  'grass', 'grass.dry', 'dirt', 'dirt.road', 'mud', 'sand', 'snow', 'stone.floor',
  'cobble', 'cave.floor', 'temple.floor', 'blood.floor', 'rock', 'rock.mossy',
  'cliff', 'gravel', 'brick', 'stone.wall', 'temple.wall', 'lava',
]);
/** Sprite/decal kinds: small, clamped, no tiling requirement. */
const SPRITE_KINDS = new Set(['ember', 'spark', 'glow.radial', 'smoke.puff', 'blood.splat', 'crack']);

const QUALITY_BASE = { low: 256, med: 512, high: 1024, ultra: 1024 };

function stableKey(o) {
  if (!o) return '';
  const keys = Object.keys(o).sort();
  let out = '';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = o[k];
    if (v === undefined || typeof v === 'function') continue;
    out += k + '=' + (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)) + ';';
  }
  return out;
}

/* ========================================================================== *
 * 5. TextureForge
 * ========================================================================== */

export class TextureForge {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{maxAniso?:number, quality?:'low'|'med'|'high'|'ultra'}} [opts]
   */
  constructor(renderer, { maxAniso = 8, quality = 'high' } = {}) {
    this.renderer = renderer || null;
    this.maxAniso = Math.max(1, Math.floor(maxAniso));
    this.quality = QUALITY_BASE[quality] ? quality : 'high';

    /** kind|opts -> PBR set */
    this._cache = new Map();
    /** key -> DataTexture (noise/data helpers) */
    this._dataCache = new Map();
    /** every texture we own, for dispose() */
    this._textures = new Set();
    this._flat = null;
    this._warned = new Set();
  }

  /** Resolve an alias / unknown kind to a recipe name. */
  _resolve(kind) {
    if (RECIPES[kind]) return kind;
    const k = String(kind || '').toLowerCase();
    if (RECIPES[k]) return k;
    const a = ALIASES[k] || ALIASES[k.replace(/[._-]/g, '')];
    if (a && RECIPES[a]) return a;
    if (!this._warned.has(kind)) {
      this._warned.add(kind);
      console.warn(`[TextureForge] unknown kind '${kind}' — falling back to tinted noise`);
    }
    return null;
  }

  _sizeFor(kind, opts) {
    if (opts && opts.size) return Math.max(32, opts.size | 0);
    let n = QUALITY_BASE[this.quality] || 1024;
    if (SPRITE_KINDS.has(kind)) n = Math.max(128, n >> 2);
    else if (!LARGE_KINDS.has(kind)) n = Math.max(128, n >> 1);
    return n;
  }

  /* ---------------------------------------------------------------- public */

  /**
   * Full PBR set for a named surface. Cached by (kind + opts).
   * @returns {{map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture,
   *            aoMap:THREE.Texture, emissiveMap?:THREE.Texture,
   *            metalness:number, transparent:boolean, size:number}}
   */
  pbr(kind, opts = {}) {
    // key on the *resolved* name so aliases share one set of GPU textures
    const key = (this._resolve(kind) || '__fallback__') + '|' + stableKey(opts);
    const hit = this._cache.get(key);
    if (hit) return hit;
    let set;
    try {
      set = this._build(kind, opts);
    } catch (e) {
      console.error(`[TextureForge] failed to build '${kind}'`, e);
      set = this._build('__fallback__', opts);
    }
    this._cache.set(key, set);
    return set;
  }

  /** Just the albedo canvas. Not cached — safe to mutate/draw over. */
  canvas(kind, size = 512, opts = {}) {
    const s = this._surface(kind, Object.assign({}, opts, { size }));
    return rgbaToCanvas(s.N, s.alb);
  }

  /**
   * Derive a tangent-space normal map from a height/luminance source.
   * @param {HTMLCanvasElement|THREE.Texture} canvasOrTex
   * @returns {THREE.CanvasTexture}
   */
  normalFromHeight(canvasOrTex, strength = 1.0) {
    const cv = (canvasOrTex && canvasOrTex.isTexture) ? canvasOrTex.image : canvasOrTex;
    if (!cv || !cv.width) {
      console.warn('[TextureForge] normalFromHeight: no readable canvas');
      return this._flatMaps().normalMap;
    }
    const N = cv.width;
    const x = newCtx(N);
    x.drawImage(cv, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data;
    const h = new Float32Array(N * N);
    for (let i = 0, p = 0; i < N * N; i++, p += 4) {
      h[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 255;
    }
    x.canvas.width = x.canvas.height = 1;
    const tex = this._tex(rgbaToCanvas(N, normalRGBA(h, N, strength)), false, false);
    return tex;
  }

  /**
   * NxN data texture from a callback. cb(x,y,u,v) -> [r,g,b,a] in 0..255.
   * @returns {THREE.DataTexture}
   */
  data(key, size, cb, opts = {}) {
    const ck = 'data:' + key + ':' + size + ':' + stableKey(opts);
    const hit = this._dataCache.get(ck);
    if (hit) return hit;
    const N = Math.max(1, size | 0);
    const buf = new Uint8Array(N * N * 4);
    const inv = 1 / N;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const r = cb(x, y, (x + 0.5) * inv, (y + 0.5) * inv);
        const p = (y * N + x) * 4;
        if (r) {
          buf[p] = r[0]; buf[p + 1] = r[1]; buf[p + 2] = r[2];
          buf[p + 3] = r[3] === undefined ? 255 : r[3];
        } else {
          buf[p + 3] = 255;
        }
      }
    }
    const tex = new THREE.DataTexture(buf, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.magFilter = opts.nearest ? THREE.NearestFilter : THREE.LinearFilter;
    tex.minFilter = opts.nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = !opts.nearest;
    tex.anisotropy = this.maxAniso;
    tex.needsUpdate = true;
    this._textures.add(tex);
    this._dataCache.set(ck, tex);
    return tex;
  }

  /**
   * Seamless noise as a grayscale data texture. Cached by `key`.
   * @returns {THREE.DataTexture}
   */
  noise(key, size, {
    type = 'simplex', octaves = 5, freq = 4, lacunarity = 2, gain = 0.5, seed = 1,
  } = {}) {
    const ck = 'noise:' + key + ':' + size + ':' + type + ':' + octaves + ':' + freq + ':' + lacunarity + ':' + gain + ':' + seed;
    const hit = this._dataCache.get(ck);
    if (hit) return hit;
    const N = Math.max(4, size | 0);
    let field;
    if (type === 'worley' || type === 'cell') {
      const w = worleyField(N, { cells: Math.max(2, Math.round(freq)), seed, jitter: 1 });
      field = new Float32Array(N * N);
      for (let i = 0; i < field.length; i++) field[i] = sat(w.f1[i]);
    } else if (type === 'ridged') {
      field = fbmField(N, { freq, octaves, lacunarity, gain, seed, ridged: true });
    } else {
      field = fbmField(N, { freq, octaves, lacunarity, gain, seed });
      for (let i = 0; i < field.length; i++) field[i] = field[i] * 0.5 + 0.5;
    }
    const buf = new Uint8Array(N * N * 4);
    for (let i = 0, p = 0; i < field.length; i++, p += 4) {
      const v = sat(field[i]) * 255;
      buf[p] = v; buf[p + 1] = v; buf[p + 2] = v; buf[p + 3] = 255;
    }
    const tex = new THREE.DataTexture(buf, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.maxAniso;
    tex.needsUpdate = true;
    this._textures.add(tex);
    this._dataCache.set(ck, tex);
    return tex;
  }

  dispose() {
    for (const t of this._textures) {
      t.dispose();
      if (t.image && t.image.tagName === 'CANVAS') { t.image.width = 1; t.image.height = 1; }
      else if (t.image && t.image.data) t.image.data = null;
    }
    this._textures.clear();
    this._cache.clear();
    this._dataCache.clear();
    this._warned.clear();
    this._flat = null;
    _lattices.clear();
    _axisCache.clear();
  }

  /* --------------------------------------------------------------- private */

  _surface(kind, opts) {
    const resolved = this._resolve(kind);
    const name = resolved || '__fallback__';
    const N = this._sizeFor(name, opts);
    let seed = (opts.seed === undefined ? 1337 : opts.seed | 0) + hashi(N, name.length, 7) % 9973;
    // `variant` re-rolls the same recipe so two props of one kind differ
    if (opts.variant !== undefined) seed = (seed + hashi(String(opts.variant).length, 17, opts.variant | 0)) | 0;
    const o = {
      N,
      seed,
      rng: makeRng(seed ^ 0x5f3759df),
      quality: this.quality,
      detail: typeof opts.detail === 'number'
        ? clamp(opts.detail, 0.15, 2)
        : (this.quality === 'low' ? 0.5 : this.quality === 'med' ? 0.75 : 1),
      opts,
    };
    const s = new Surface(N);
    if (EMISSIVE_KINDS.has(name)) s.enableEmissive();
    const recipe = RECIPES[name];
    if (recipe) recipe(s, o);
    else fallbackRecipe(s, o);

    if (SPRITE_KINDS.has(name)) s.sprite = true;

    // user tint / roughness bias
    if (opts.tint !== undefined && opts.tint !== null) {
      const c = new THREE.Color(opts.tint);
      const tr = c.r, tg = c.g, tb = c.b;
      for (let p = 0; p < s.alb.length; p += 4) {
        s.alb[p] = s.alb[p] * tr;
        s.alb[p + 1] = s.alb[p + 1] * tg;
        s.alb[p + 2] = s.alb[p + 2] * tb;
      }
    }
    if (typeof opts.roughness === 'number') {
      const k = opts.roughness;
      for (let i = 0; i < s.rgh.length; i++) s.rgh[i] = sat(s.rgh[i] * k);
    }
    if (typeof opts.normalStrength === 'number') s.normalStrength *= opts.normalStrength;
    if (typeof opts.aoStrength === 'number') s.aoStrength *= opts.aoStrength;
    return s;
  }

  _build(kind, opts) {
    const s = this._surface(kind, opts);
    const N = s.N;

    // height smoothing removes 8-bit stair-stepping on stroke-built surfaces
    let height = s.hgt;
    if (s.heightSmooth > 0) height = blurWrap(height, N, Math.max(1, Math.round(s.heightSmooth)));

    const repeat = opts.repeat;
    const clampWrap = s.sprite;

    const map = this._tex(rgbaToCanvas(N, s.alb), true, clampWrap, repeat);
    map.premultiplyAlpha = false;

    let normalMap, roughnessMap, aoMap;
    if (s.sprite) {
      // fresh (not shared) — consumers such as Materials mutate wrap/repeat in place
      const flat = this._makeFlatMaps();
      normalMap = flat.normalMap;
      roughnessMap = flat.roughnessMap;
      aoMap = flat.aoMap;
    } else {
      normalMap = this._tex(rgbaToCanvas(N, normalRGBA(height, N, s.normalStrength)), false, clampWrap, repeat);
      // roughness and AO are low-frequency; at 1024 they ship at half size,
      // so they are also *computed* at half size rather than downsampled after
      const half = (N >= 1024 && (N & 1) === 0) ? N >> 1 : N;
      roughnessMap = this._tex(fieldToCanvas(half, downsampleField(s.rgh, N, half)), false, clampWrap, repeat);
      if (s.aoStrength > 0) {
        const hAo = downsampleField(height, N, half);
        aoMap = this._tex(fieldToCanvas(half, aoField(hAo, half, s.aoStrength)), false, clampWrap, repeat);
      } else {
        aoMap = this._makeFlatMaps().aoMap;
      }
    }

    const out = {
      map, normalMap, roughnessMap, aoMap,
      metalness: s.metalness,
      transparent: s.transparent,
      size: N,
    };
    if (s.ems) out.emissiveMap = this._tex(rgbaToCanvas(N, s.ems), true, clampWrap, repeat);
    return out;
  }

  _tex(canvas, srgb, clampWrap, repeat) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = clampWrap ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.anisotropy = this.maxAniso;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    if (repeat && !clampWrap) {
      if (Array.isArray(repeat)) t.repeat.set(repeat[0], repeat[1] === undefined ? repeat[0] : repeat[1]);
      else if (typeof repeat === 'number') t.repeat.set(repeat, repeat);
      else if (repeat.x !== undefined) t.repeat.set(repeat.x, repeat.y === undefined ? repeat.x : repeat.y);
    }
    t.needsUpdate = true;
    this._textures.add(t);
    return t;
  }

  /** Shared flat maps, only for internal fallbacks that never leave the forge. */
  _flatMaps() {
    if (this._flat) return this._flat;
    this._flat = this._makeFlatMaps();
    return this._flat;
  }

  /** A fresh 4x4 flat normal + white roughness/AO trio (~200 bytes on the GPU). */
  _makeFlatMaps() {
    const N = 4;
    const nrm = new Uint8ClampedArray(N * N * 4);
    const white = new Uint8ClampedArray(N * N * 4);
    for (let p = 0; p < N * N * 4; p += 4) {
      nrm[p] = 128; nrm[p + 1] = 128; nrm[p + 2] = 255; nrm[p + 3] = 255;
      white[p] = white[p + 1] = white[p + 2] = 255; white[p + 3] = 255;
    }
    return {
      normalMap: this._tex(rgbaToCanvas(N, nrm), false, true),
      roughnessMap: this._tex(rgbaToCanvas(N, white), false, true),
      aoMap: this._tex(rgbaToCanvas(N, white), false, true),
    };
  }
}

/** Unknown kinds land here: tinted fbm so nothing ever throws or renders black. */
function fallbackRecipe(s, o) {
  const N = s.N;
  const a = fbmField(N, { freq: 8, octaves: 5, seed: o.seed + 1 });
  const b = fbmField(N, { freq: 40, octaves: 3, seed: o.seed + 2 });
  for (let i = 0; i < N * N; i++) {
    const v = sat(a[i] * 0.5 + 0.5);
    const w = b[i];
    hsl2rgb(0.08 + v * 0.05, 0.14, 0.30 + v * 0.16 + w * 0.05, _c3);
    s.setAlb(i, _c3[0], _c3[1], _c3[2]);
    s.hgt[i] = 0.45 + v * 0.15 + w * 0.06;
    s.rgh[i] = 0.85;
  }
  s.normalStrength = 1.0;
}
RECIPES['__fallback__'] = fallbackRecipe;

export default TextureForge;
