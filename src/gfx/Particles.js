/**
 * src/gfx/Particles.js — CONTRACTS §6, the VFX system.
 *
 * Everything draws out of a handful of preallocated GPU objects that are built
 * once and never grow:
 *
 *   5 x THREE.Points        one per (sprite texture, blend mode) pair
 *   1 x ribbon bank         billboarded polyline strips (bolts, slash arcs)
 *   1 x instanced orb bank  camera-facing additive quads (cores, flashes)
 *   1 x instanced ring bank flat ground rings (shockwaves, runes, portals)
 *   1 x instanced aura bank fresnel shells (shields, boss auras)
 *
 * Particles live in flat typed arrays with a packed-to-the-front free list, so a
 * dead particle is an O(1) `copyWithin` and the draw range is just `count`.
 * `update()` allocates nothing: every vector, colour and emission descriptor is
 * a module-scope singleton.
 *
 * Effects are data: `EFFECTS[name] = { dur, loop, init(sys,em), tick(sys,em,dt) }`.
 * `init`/`tick` are closures created once at module load, never per spawn.
 *
 * Textures come from `ctx.forge` ('spark', 'ember', 'smoke.puff', 'glow.radial').
 * They belong to the forge's cache and are NOT disposed here — TextureForge owns
 * them and other subsystems share them. We only free what we created.
 */

import * as THREE from 'three';
import { makeRng } from '../core/Rng.js';
import { QUALITY_PRESETS } from '../game/Config.js';

const TAU = Math.PI * 2;

/* ========================================================================== *
 * 0. Scratch — every one of these is a module singleton. Nothing below `new`s
 *    inside a per-frame path.
 * ========================================================================== */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _sc = new THREE.Vector3(1, 1, 1);
const _dbSize = new THREE.Vector2(1, 1);

/** Linear-space colour from an sRGB hex literal. */
function lin(hex) { return new THREE.Color().setHex(hex >>> 0, THREE.SRGBColorSpace); }

/** The Mir2 spell palette, in linear working space. */
const C = {
  white: lin(0xffffff),
  fireCore: lin(0xfff6d2),
  fireHot: lin(0xffc255),
  fireMid: lin(0xff7a18),
  fireLow: lin(0xc02a04),
  fireDim: lin(0x3a0b02),
  ember: lin(0xff9436),
  smokeHot: lin(0x6d574a),
  smokeGrey: lin(0xc6c0b4),
  smokeDark: lin(0x37302b),
  blood: lin(0x7c0d10),
  bloodDark: lin(0x35060a),
  steel: lin(0xdce6f2),
  ice: lin(0x9fe4ff),
  iceDeep: lin(0x2a6ea8),
  iceWhite: lin(0xe8fbff),
  bolt: lin(0xcfe4ff),
  boltCore: lin(0xffffff),
  boltDim: lin(0x3f6bb0),
  heal: lin(0x9fffb0),
  healGold: lin(0xffe9a8),
  poison: lin(0x76d43a),
  poisonDark: lin(0x1e3a10),
  soul: lin(0x6fe8c8),
  soulDim: lin(0x0d4a3c),
  arcane: lin(0x9db6ff),
  arcaneDeep: lin(0x2a2f7a),
  gold: lin(0xffd76a),
  goldDeep: lin(0x8a5a10),
  dust: lin(0xd6c6a4),
  dustDark: lin(0x6a5c46),
  leaf: lin(0x9fc45a),
  leafDry: lin(0xc79a44),
  hell: lin(0xff3b1e),
  hellDark: lin(0x3a0508),
};

/* ========================================================================== *
 * 1. Emission descriptor — one shared struct, filled then flushed.
 * ========================================================================== */

const E = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  life: 1,
  s0: 0.3, s1: 0.3,
  r0: 1, g0: 1, b0: 1,
  r1: 1, g1: 1, b1: 1,
  a: 1,
  grav: 0, drag: 0,
  rot: 0, rotV: 0,
  turb: 0, turbF: 1,
  fadeIn: 0.14,
};

function eReset() {
  E.x = E.y = E.z = 0;
  E.vx = E.vy = E.vz = 0;
  E.life = 1;
  E.s0 = 0.3; E.s1 = 0.3;
  E.r0 = E.g0 = E.b0 = 1;
  E.r1 = E.g1 = E.b1 = 1;
  E.a = 1;
  E.grav = 0; E.drag = 0;
  E.rot = 0; E.rotV = 0;
  E.turb = 0; E.turbF = 1;
  E.fadeIn = 0.14;
}

function eAt(x, y, z) { E.x = x; E.y = y; E.z = z; }
function eVel(x, y, z) { E.vx = x; E.vy = y; E.vz = z; }
function eSize(a, b) { E.s0 = a; E.s1 = (b === undefined ? a : b); }
function eCol(c0, c1) {
  E.r0 = c0.r; E.g0 = c0.g; E.b0 = c0.b;
  const c = c1 || c0;
  E.r1 = c.r; E.g1 = c.g; E.b1 = c.b;
}

/* ========================================================================== *
 * 2. PointBank — one pooled THREE.Points system.
 * ========================================================================== */

/** Per-particle simulation stride inside the packed `D` array. */
const S = 16;
const S_VX = 0, S_VY = 1, S_VZ = 2, S_AGE = 3, S_LIFE = 4, S_S0 = 5, S_S1 = 6,
  S_A = 7, S_GRAV = 8, S_DRAG = 9, S_ROT = 10, S_ROTV = 11, S_TURB = 12,
  S_TURBF = 13, S_FADEIN = 14;

const POINT_VERT = /* glsl */`
  uniform float uScale;
  uniform float uMax;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aRot;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vRot;
  void main() {
    vCol = aColor;
    vAlpha = aAlpha;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
    float d = max( 0.05, -mv.z );
    gl_PointSize = clamp( aSize * uScale / d, 1.0, uMax );
  }
`;

const POINT_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform float uEnergy;
  varying vec3 vCol;
  varying float vAlpha;
  varying float vRot;
  void main() {
    if ( vAlpha <= 0.002 ) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos( vRot ), s = sin( vRot );
    uv = vec2( c * uv.x - s * uv.y, s * uv.x + c * uv.y ) + 0.5;
    vec4 t = texture2D( uMap, uv );
    float a = t.a * vAlpha;
    if ( a < 0.004 ) discard;
    // The forge's spark/ember sprites carry their own warm hue. Take their
    // *shape* and hot-core ramp only, so a blue ice shard does not come out
    // muddy orange — the tint is entirely the particle's own colour.
    float core = max( t.r, max( t.g, t.b ) );
    float hot = pow( core, 5.0 ) * uEnergy;
    vec3 chroma = vCol * ( 0.32 + 0.78 * core );
    // Additive sparks/flame carry a small white-energy nucleus surrounded by
    // saturated colour. Normal-blended smoke has uEnergy=0 and stays diffuse.
    vec3 outCol = chroma + mix( vCol, vec3( 1.0 ), 0.78 ) * hot * 0.62;
    gl_FragColor = vec4( outCol, a );
  }
`;

class PointBank {
  constructor(map, blending, capacity) {
    const cap = Math.max(16, capacity | 0);
    this.cap = cap;
    this.n = 0;

    this.D = new Float32Array(cap * S);
    this.Dc = new Float32Array(cap * 6);

    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.siz = new Float32Array(cap);
    this.alp = new Float32Array(cap);
    this.rotA = new Float32Array(cap);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSiz = new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlp = new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(this.rotA, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSiz);
    g.setAttribute('aAlpha', this.aAlp);
    g.setAttribute('aRot', this.aRot);
    this._rPos = newRange(); this._rCol = newRange(); this._rSiz = newRange();
    this._rAlp = newRange(); this._rRot = newRange();
    g.setDrawRange(0, 0);
    // never let three try to compute one from a half-empty buffer
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      name: 'fx.points',
      uniforms: {
        uMap: { value: map },
        uScale: { value: 400 },
        uMax: { value: 340 },
        uEnergy: { value: blending === THREE.AdditiveBlending ? 1 : 0 },
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      blending,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.points.matrixAutoUpdate = false;
    this.points.raycast = noRaycast;
  }

  /** Emit one particle from the shared `E` descriptor. */
  emit() {
    if (this.n >= this.cap) return false;
    const i = this.n++;
    const d = this.D, o = i * S;
    d[o + S_VX] = E.vx; d[o + S_VY] = E.vy; d[o + S_VZ] = E.vz;
    d[o + S_AGE] = 0;
    d[o + S_LIFE] = E.life > 0.01 ? E.life : 0.01;
    d[o + S_S0] = E.s0; d[o + S_S1] = E.s1;
    d[o + S_A] = E.a;
    d[o + S_GRAV] = E.grav; d[o + S_DRAG] = E.drag;
    d[o + S_ROT] = E.rot; d[o + S_ROTV] = E.rotV;
    d[o + S_TURB] = E.turb; d[o + S_TURBF] = E.turbF;
    d[o + S_FADEIN] = E.fadeIn < 0.02 ? 0.02 : (E.fadeIn > 0.85 ? 0.85 : E.fadeIn);

    const c = this.Dc, co = i * 6;
    c[co] = E.r0; c[co + 1] = E.g0; c[co + 2] = E.b0;
    c[co + 3] = E.r1; c[co + 4] = E.g1; c[co + 5] = E.b1;

    const p = i * 3;
    this.pos[p] = E.x; this.pos[p + 1] = E.y; this.pos[p + 2] = E.z;
    this.col[p] = E.r0; this.col[p + 1] = E.g0; this.col[p + 2] = E.b0;
    this.siz[i] = E.s0;
    this.alp[i] = 0;
    this.rotA[i] = E.rot;
    return true;
  }

  _kill(i) {
    const j = --this.n;
    if (i !== j) {
      this.D.copyWithin(i * S, j * S, j * S + S);
      this.Dc.copyWithin(i * 6, j * 6, j * 6 + 6);
      this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
      this.col.copyWithin(i * 3, j * 3, j * 3 + 3);
      this.siz[i] = this.siz[j];
      this.alp[i] = this.alp[j];
      this.rotA[i] = this.rotA[j];
    }
  }

  update(dt, time) {
    const D = this.D, Dc = this.Dc, pos = this.pos, col = this.col;
    let i = 0;
    while (i < this.n) {
      const o = i * S;
      const life = D[o + S_LIFE];
      const age = D[o + S_AGE] + dt;
      if (age >= life) { this._kill(i); continue; }
      D[o + S_AGE] = age;
      const t = age / life;

      const p = i * 3;
      let px = pos[p], py = pos[p + 1], pz = pos[p + 2];
      let vx = D[o + S_VX], vy = D[o + S_VY], vz = D[o + S_VZ];

      const tb = D[o + S_TURB];
      if (tb !== 0) {
        // cheap curl-ish field: divergence is low enough to read as real
        // turbulence, and it costs three sines and three cosines.
        const f = D[o + S_TURBF];
        const ax = Math.sin(py * f + time * 1.7) * Math.cos(pz * f * 0.8 + time * 1.1);
        const az = Math.cos(px * f * 0.9 - time * 1.3) * Math.sin(py * f * 1.1 + time * 0.7);
        const ay = Math.sin(px * f * 0.7 + pz * f * 0.6 + time * 0.9);
        const k = tb * dt;
        vx += ax * k; vz += az * k; vy += ay * k * 0.45;
      }

      vy += D[o + S_GRAV] * dt;
      const dr = D[o + S_DRAG];
      if (dr > 0) {
        const damp = 1 / (1 + dr * dt);
        vx *= damp; vy *= damp; vz *= damp;
      }
      D[o + S_VX] = vx; D[o + S_VY] = vy; D[o + S_VZ] = vz;

      pos[p] = px + vx * dt;
      pos[p + 1] = py + vy * dt;
      pos[p + 2] = pz + vz * dt;

      const s0 = D[o + S_S0];
      this.siz[i] = s0 + (D[o + S_S1] - s0) * t;

      const co = i * 6;
      col[p] = Dc[co] + (Dc[co + 3] - Dc[co]) * t;
      col[p + 1] = Dc[co + 1] + (Dc[co + 4] - Dc[co + 1]) * t;
      col[p + 2] = Dc[co + 2] + (Dc[co + 5] - Dc[co + 2]) * t;

      const fi = D[o + S_FADEIN];
      let f = t < fi ? t / fi : 1 - (t - fi) / (1 - fi);
      if (f < 0) f = 0; else if (f > 1) f = 1;
      this.alp[i] = D[o + S_A] * f * f * (3 - 2 * f);

      this.rotA[i] = D[o + S_ROT] + D[o + S_ROTV] * age;
      i++;
    }
    this.upload();
  }

  upload() {
    const n = this.n;
    this.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n === 0) return;
    setRange(this.aPos, this._rPos, n * 3);
    setRange(this.aCol, this._rCol, n * 3);
    setRange(this.aSiz, this._rSiz, n);
    setRange(this.aAlp, this._rAlp, n);
    setRange(this.aRot, this._rRot, n);
  }

  clear() { this.n = 0; this.upload(); }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function noRaycast() { /* fx never participates in picking */ }

/**
 * Mark the first `count` elements of an attribute dirty using a *persistent*
 * range object. `BufferAttribute.addUpdateRange()` pushes a fresh `{start,count}`
 * literal every call, which at ~40 attribute updates a frame is real garbage;
 * three only ever does `updateRanges.length = 0` after uploading, so re-pushing
 * the same object is safe and allocates nothing.
 */
function setRange(attr, range, count) {
  range.start = 0;
  range.count = count;
  const r = attr.updateRanges;
  if (r.length === 0) r.push(range);
  else { r[0] = range; r.length = 1; }
  attr.needsUpdate = true;
}

function newRange() { return { start: 0, count: 0 }; }

/* ========================================================================== *
 * 3. RibbonBank — billboarded polyline strips.
 *    Used for thunder bolts, slash arcs and ice spikes: a bright thin core with
 *    a wide additive falloff, all from the |side| coordinate, no texture.
 * ========================================================================== */

const RIBBON_SEG = 96;    // max segments per block
const RIBBON_BLOCKS = 10;

const RIBBON_VERT = /* glsl */`
  attribute vec3 aDir;
  attribute float aSide;
  attribute float aWidth;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying float vSide;
  varying vec3 vCol;
  varying float vAlpha;
  void main() {
    vSide = aSide;
    vCol = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    vec3 d = ( modelViewMatrix * vec4( aDir, 0.0 ) ).xyz;
    vec2 pv = vec2( -d.y, d.x );
    float l = length( pv );
    vec2 perp = l > 1e-5 ? pv / l : vec2( 1.0, 0.0 );
    mv.xy += perp * ( aSide * aWidth );
    gl_Position = projectionMatrix * mv;
  }
`;

const RIBBON_FRAG = /* glsl */`
  varying float vSide;
  varying vec3 vCol;
  varying float vAlpha;
  void main() {
    float e = clamp( 1.0 - abs( vSide ), 0.0, 1.0 );
    if ( vAlpha <= 0.002 ) discard;
    float glow = pow( e, 1.7 );
    float core = pow( e, 9.0 );
    vec3 c = vCol * glow + vec3( 1.0 ) * core;
    float a = clamp( ( glow * 0.85 + core ) * vAlpha, 0.0, 1.0 );
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( c, a );
  }
`;

class RibbonBank {
  constructor() {
    const verts = RIBBON_BLOCKS * RIBBON_SEG * 4;
    this.pos = new Float32Array(verts * 3);
    this.dir = new Float32Array(verts * 3);
    this.side = new Float32Array(verts);
    this.wid = new Float32Array(verts);
    this.col = new Float32Array(verts * 3);
    this.alp = new Float32Array(verts);

    const idx = new Uint16Array(RIBBON_BLOCKS * RIBBON_SEG * 6);
    for (let s = 0; s < RIBBON_BLOCKS * RIBBON_SEG; s++) {
      const v = s * 4, o = s * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    // static per-vertex side signs: (-1, +1, +1, -1)
    for (let s = 0; s < RIBBON_BLOCKS * RIBBON_SEG; s++) {
      const v = s * 4;
      this.side[v] = -1; this.side[v + 1] = 1; this.side[v + 2] = 1; this.side[v + 3] = -1;
    }

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aDir = new THREE.BufferAttribute(this.dir, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSide = new THREE.BufferAttribute(this.side, 1);
    this.aWid = new THREE.BufferAttribute(this.wid, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlp = new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aDir', this.aDir);
    g.setAttribute('aSide', this.aSide);
    g.setAttribute('aWidth', this.aWid);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aAlpha', this.aAlp);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      name: 'fx.ribbon',
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Without this three splits every transparent DoubleSide draw into a
      // back pass + a front pass and sets material.needsUpdate on each one,
      // every frame. Additive does not care about face order, so one pass it is.
      forceSinglePass: true,
    });

    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = noRaycast;

    // polyline storage, one per block
    this.pt = [];
    this.brk = [];
    this.np = new Int32Array(RIBBON_BLOCKS);
    this.used = new Uint8Array(RIBBON_BLOCKS);
    for (let b = 0; b < RIBBON_BLOCKS; b++) {
      this.pt.push(new Float32Array((RIBBON_SEG + 1) * 3));
      this.brk.push(new Uint8Array(RIBBON_SEG + 1));
    }
    this.dirty = true;
  }

  alloc() {
    for (let b = 0; b < RIBBON_BLOCKS; b++) {
      if (!this.used[b]) { this.used[b] = 1; this.np[b] = 0; return b; }
    }
    return -1;
  }

  free(b) {
    if (b < 0 || b >= RIBBON_BLOCKS) return;
    this.used[b] = 0;
    this.np[b] = 0;
    const v0 = b * RIBBON_SEG * 4;
    this.alp.fill(0, v0, v0 + RIBBON_SEG * 4);
    this.wid.fill(0, v0, v0 + RIBBON_SEG * 4);
    this.dirty = true;
  }

  begin(b) { this.np[b] = 0; }

  /** @param {boolean} [breakAfter] true if no segment should join this point to the next. */
  add(b, x, y, z, breakAfter) {
    const i = this.np[b];
    if (i > RIBBON_SEG) return;
    const p = this.pt[b], o = i * 3;
    p[o] = x; p[o + 1] = y; p[o + 2] = z;
    this.brk[b][i] = breakAfter ? 1 : 0;
    this.np[b] = i + 1;
  }

  /**
   * Rewrite a block's vertices.
   * @param {number} b block
   * @param {THREE.Color} colour
   * @param {number} width world-space half width
   * @param {number} alpha overall opacity
   * @param {number} head normalised sweep head (>=1 shows the whole line)
   * @param {number} span normalised length of the visible window (<=0 == all)
   * @param {number} taper 0 uniform width, 1 tapered towards both ends
   */
  write(b, colour, width, alpha, head, span, taper) {
    const n = this.np[b];
    const pts = this.pt[b], brk = this.brk[b];
    const base = b * RIBBON_SEG * 4;
    const inv = n > 1 ? 1 / (n - 1) : 1;
    let seg = 0;
    for (let i = 0; i < n - 1 && seg < RIBBON_SEG; i++) {
      if (brk[i]) continue;
      const o0 = i * 3, o1 = (i + 1) * 3;
      const x0 = pts[o0], y0 = pts[o0 + 1], z0 = pts[o0 + 2];
      const x1 = pts[o1], y1 = pts[o1 + 1], z1 = pts[o1 + 2];
      let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;

      const u0 = i * inv, u1 = (i + 1) * inv;
      const a0 = alpha * windowAlpha(u0, head, span);
      const a1 = alpha * windowAlpha(u1, head, span);
      const w0 = width * (taper > 0 ? Math.pow(Math.sin(Math.PI * u0), 0.55) * taper + (1 - taper) : 1);
      const w1 = width * (taper > 0 ? Math.pow(Math.sin(Math.PI * u1), 0.55) * taper + (1 - taper) : 1);

      const v = base + seg * 4;
      writeRibbonVert(this, v + 0, x0, y0, z0, dx, dy, dz, w0, colour, a0);
      writeRibbonVert(this, v + 1, x0, y0, z0, dx, dy, dz, w0, colour, a0);
      writeRibbonVert(this, v + 2, x1, y1, z1, dx, dy, dz, w1, colour, a1);
      writeRibbonVert(this, v + 3, x1, y1, z1, dx, dy, dz, w1, colour, a1);
      seg++;
    }
    // blank the tail of the block
    for (; seg < RIBBON_SEG; seg++) {
      const v = base + seg * 4;
      this.alp[v] = this.alp[v + 1] = this.alp[v + 2] = this.alp[v + 3] = 0;
      this.wid[v] = this.wid[v + 1] = this.wid[v + 2] = this.wid[v + 3] = 0;
    }
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.aPos.needsUpdate = true;
    this.aDir.needsUpdate = true;
    this.aWid.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aAlp.needsUpdate = true;
  }

  clear() {
    for (let b = 0; b < RIBBON_BLOCKS; b++) this.free(b);
    this.flush();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function windowAlpha(u, head, span) {
  if (!(span > 0)) return 1;
  const tail = head - span;
  if (u > head || u < tail) return 0;
  const inH = Math.min(1, (head - u) / (span * 0.35));
  const inT = Math.min(1, (u - tail) / (span * 0.55));
  const f = Math.min(inH, inT);
  return f < 0 ? 0 : f;
}

function writeRibbonVert(bank, v, x, y, z, dx, dy, dz, w, colour, a) {
  const p = v * 3;
  bank.pos[p] = x; bank.pos[p + 1] = y; bank.pos[p + 2] = z;
  bank.dir[p] = dx; bank.dir[p + 1] = dy; bank.dir[p + 2] = dz;
  bank.col[p] = colour.r; bank.col[p + 1] = colour.g; bank.col[p + 2] = colour.b;
  bank.wid[v] = w;
  bank.alp[v] = a;
}

/* ========================================================================== *
 * 4. Instanced banks — orbs (billboards), rings (flat), auras (shells).
 *    All three are immediate-mode: `begin()` each frame, `push()` from effect
 *    ticks, `end()` fixes the instance count. No per-effect bookkeeping.
 * ========================================================================== */

class InstBank {
  constructor(geometry, material, cap) {
    this.cap = cap;
    this.n = 0;
    this.geometry = geometry;
    this.material = material;
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aOpacity = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this._rMat = newRange(); this._rCol = newRange();
    this._rOpa = newRange(); this._rRot = newRange();
    geometry.setAttribute('aColor', this.aColor);
    geometry.setAttribute('aOpacity', this.aOpacity);
    geometry.setAttribute('aRot', this.aRot);
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = 14;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = noRaycast;
  }

  begin() { this.n = 0; }

  /** @param {THREE.Quaternion|null} quat */
  push(x, y, z, sx, sy, sz, quat, colour, opacity, rot) {
    if (this.n >= this.cap || !(opacity > 0.002)) return;
    const i = this.n++;
    _v1.set(x, y, z);
    _sc.set(sx, sy, sz);
    _m4.compose(_v1, quat || IDENT_Q, _sc);
    this.mesh.setMatrixAt(i, _m4);
    const c = this.aColor.array, o = i * 3;
    c[o] = colour.r; c[o + 1] = colour.g; c[o + 2] = colour.b;
    this.aOpacity.array[i] = opacity;
    this.aRot.array[i] = rot || 0;
  }

  end() {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    setRange(this.mesh.instanceMatrix, this._rMat, n * 16);
    setRange(this.aColor, this._rCol, n * 3);
    setRange(this.aOpacity, this._rOpa, n);
    setRange(this.aRot, this._rRot, n);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose?.();
  }
}

const IDENT_Q = new THREE.Quaternion();

const ORB_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aOpacity;
  attribute float aRot;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vUv = uv;
    vCol = aColor;
    vA = aOpacity;
    float sc = length( vec3( instanceMatrix[0].x, instanceMatrix[0].y, instanceMatrix[0].z ) );
    vec3 ip = vec3( instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z );
    vec4 mv = modelViewMatrix * vec4( ip, 1.0 );
    float c = cos( aRot ), s = sin( aRot );
    vec2 q = vec2( position.x * c - position.y * s, position.x * s + position.y * c );
    mv.xy += q * sc;
    gl_Position = projectionMatrix * mv;
  }
`;

const ORB_FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec4 t = texture2D( uMap, vUv );
    float a = t.a * vA;
    if ( a < 0.004 ) discard;
    float core = max( t.r, max( t.g, t.b ) );
    float nucleus = pow( core, 4.5 );
    vec3 chroma = vCol * ( 0.28 + 0.86 * core );
    vec3 hot = mix( vCol, vec3( 1.0 ), 0.82 ) * nucleus * 0.72;
    gl_FragColor = vec4( chroma + hot, a );
  }
`;

const RING_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aOpacity;
  attribute float aRot;
  varying float vR;
  varying vec3 vCol;
  varying float vA;
  varying float vAng;
  void main() {
    vCol = aColor;
    vA = aOpacity;
    float r = length( position.xz );
    vR = clamp( ( r - 0.5 ) * 2.0, 0.0, 1.0 );
    vAng = atan( position.z, position.x ) + aRot;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
  }
`;

const RING_FRAG = /* glsl */`
  varying float vR;
  varying vec3 vCol;
  varying float vA;
  varying float vAng;
  void main() {
    float e = 1.0 - abs( vR * 2.0 - 1.0 );
    float band = pow( clamp( e, 0.0, 1.0 ), 1.65 );
    float core = pow( band, 6.0 );
    // Two incommensurate angular bands stop every rune/shockwave reading as
    // the same twelve-toothed neon donut.
    float glyphA = 0.76 + 0.24 * smoothstep( -0.25, 0.55, cos( vAng * 9.0 ) );
    float glyphB = 0.84 + 0.16 * smoothstep( -0.45, 0.62, sin( vAng * 17.0 + vR * 7.0 ) );
    float ticks = glyphA * glyphB;
    float a = ( band * 0.82 + core * 0.18 ) * vA * ticks;
    if ( a < 0.004 ) discard;
    vec3 c = vCol * ( 0.30 + band * 0.74 )
      + mix( vCol, vec3( 1.0 ), 0.72 ) * core * 0.34;
    gl_FragColor = vec4( c, a );
  }
`;

const AURA_VERT = /* glsl */`
  attribute vec3 aColor;
  attribute float aOpacity;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vCol = aColor;
    vA = aOpacity;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
    vN = normalize( normalMatrix * ( mat3( instanceMatrix ) * normal ) );
    vV = normalize( -mv.xyz );
    gl_Position = projectionMatrix * mv;
  }
`;

const AURA_FRAG = /* glsl */`
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vCol;
  varying float vA;
  void main() {
    float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
    float a = pow( clamp( f, 0.0, 1.0 ), 2.6 ) * vA;
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( vCol * ( 0.32 + 0.78 * f ), a );
  }
`;

/* ========================================================================== *
 * 5. Emitters
 * ========================================================================== */

class Emitter {
  constructor(idx) {
    this.idx = idx | 0;
    this.gen = 0;
    this.alive = false;
    this.stopping = false;
    this.name = '';
    this.def = null;
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.vel = new THREE.Vector3();
    this.col = new THREE.Color(1, 1, 1);
    this.col2 = new THREE.Color(1, 1, 1);
    this.hasColor = false;
    this.scale = 1;
    this.age = 0;
    this.duration = 1;
    this.loop = false;
    this.parent = null;
    this.onDone = null;
    this.acc = 0;
    this.acc2 = 0;
    this.a = 0; this.b = 0; this.c = 0; this.d = 0;
    this.ribbon = -1;
    this.light = null;
    this.fade = 1;
    this.fadeT = 0;
    this.seed = 0;
  }
}

/** Returned to callers. Never holds a strong claim on a recycled emitter. */
class FxHandle {
  constructor(sys, em) {
    this._s = sys;
    this._e = em || null;
    this._g = em ? em.gen : -1;
  }

  get alive() {
    const e = this._e;
    return !!(e && e.gen === this._g && e.alive && !e.stopping);
  }

  stop() {
    const e = this._e;
    if (e && e.gen === this._g && e.alive && !e.stopping) this._s._stopEmitter(e);
  }

  setPosition(v) {
    const e = this._e;
    if (v && e && e.gen === this._g && e.alive) e.pos.set(v.x, v.y, v.z);
  }
}

const DEAD_HANDLE = new FxHandle(null, null);

/* ========================================================================== *
 * 6. Small maths helpers used by the effect table.
 * ========================================================================== */

/** Fill a horizontal unit vector perpendicular to `d` into `out`. */
function perpH(d, out) {
  out.set(-d.z, 0, d.x);
  const l = Math.hypot(out.x, out.z);
  if (l < 1e-4) out.set(1, 0, 0); else { out.x /= l; out.z /= l; }
  return out;
}

/* ========================================================================== *
 * 7. The effect table
 * ========================================================================== */

const EFFECTS = Object.create(null);

/** @param {string} name @param {object} def */
function fx(name, def) {
  def.dur = def.dur === undefined ? 1 : def.dur;
  def.loop = !!def.loop;
  if (!def.init) def.init = noop2;
  if (!def.tick) def.tick = noop3;
  EFFECTS[name] = def;
}
function noop2() {}
function noop3() {}

/* ------------------------------------------------------------------ impacts */

fx('hit.slash', {
  dur: 0.26,
  init(sys, em) {
    const b = sys.ribbons.alloc();
    em.ribbon = b;
    if (b < 0) return;
    const s = em.scale;
    const R = 0.85 * s;
    perpH(em.dir, _v1);                       // sweep axis
    _v2.copy(em.dir).normalize();             // forward
    const cx = em.pos.x + _v2.x * 0.36 * s;
    const cy = em.pos.y + 0.35 * s;
    const cz = em.pos.z + _v2.z * 0.36 * s;
    // tilted plane: horizontal sweep axis blended with up + forward, so the
    // ribbon reads as a diagonal downward cut rather than a flat disc
    _v3.set(_v2.x * 0.62, 0.78, _v2.z * 0.62).normalize();
    sys.ribbons.begin(b);
    const N = 17;
    for (let i = 0; i < N; i++) {
      const a = -1.18 + (i / (N - 1)) * 2.36;
      const ca = Math.cos(a), sa = Math.sin(a);
      sys.ribbons.add(b,
        cx + _v1.x * ca * R + _v3.x * sa * R * 0.42,
        cy + _v3.y * sa * R * 0.42,
        cz + _v1.z * ca * R + _v3.z * sa * R * 0.42, false);
    }
  },
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    if (em.ribbon >= 0) {
      const head = -0.12 + t * 1.5;
      const alpha = (1 - t) * (1 - t) * 1.25;
      sys.ribbons.write(em.ribbon, em.hasColor ? em.col : C.steel,
        0.085 * em.scale * (0.5 + 0.5 * (1 - t)), Math.min(1, alpha), head, 0.55, 1);
    }
    if (t < 0.2 && sys.roll(dt * 90)) {
      eReset();
      eAt(em.pos.x + sys.sym(0.3 * em.scale), em.pos.y + 0.3 * em.scale + sys.sym(0.2), em.pos.z + sys.sym(0.3 * em.scale));
      eVel(sys.sym(3.2), sys.rnd() * 2.2, sys.sym(3.2));
      E.life = 0.16 + sys.rnd() * 0.16;
      eSize(0.07, 0.01);
      E.grav = -7; E.drag = 1.4; E.a = 0.9; E.fadeIn = 0.08;
      eCol(C.white, em.hasColor ? em.col : C.steel);
      sys.push('spark');
    }
  },
});

fx('hit.crit', {
  dur: 0.34,
  init(sys, em) {
    EFFECTS['hit.slash'].init(sys, em);
    const s = em.scale;
    for (let i = 0, n = sys.count(26); i < n; i++) {
      const a = sys.rnd() * TAU, e = sys.rnd() * Math.PI;
      const sp = 3.4 + sys.rnd() * 6.5;
      eReset();
      eAt(em.pos.x, em.pos.y + 0.2 * s, em.pos.z);
      eVel(Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp * 0.8 + 1.4, Math.sin(a) * Math.sin(e) * sp);
      E.life = 0.28 + sys.rnd() * 0.4;
      eSize(0.1, 0.012);
      E.grav = -9.2; E.drag = 1.1; E.a = 1; E.fadeIn = 0.06;
      eCol(C.white, C.gold);
      sys.push('spark');
    }
  },
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    if (em.ribbon >= 0) {
      sys.ribbons.write(em.ribbon, C.gold, 0.13 * em.scale * (1 - t * 0.6),
        Math.min(1, (1 - t) * 1.5), -0.12 + t * 1.55, 0.62, 1);
    }
    if (t < 0.35) {
      sys.orb(em.pos.x, em.pos.y + 0.2 * em.scale, em.pos.z,
        1.5 * em.scale * (0.4 + t * 2.2), C.gold, (1 - t / 0.35) * 0.5, 0);
    }
    sys.ringPulse(em, t, 2.6 * em.scale, C.gold, 0.7);
  },
});

fx('hit.blunt', {
  dur: 0.5,
  init(sys, em) {
    const s = em.scale;
    for (let i = 0, n = sys.count(14); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 1.2 + sys.rnd() * 2.6;
      eReset();
      eAt(em.pos.x, em.pos.y, em.pos.z);
      eVel(Math.cos(a) * sp, 0.8 + sys.rnd() * 1.4, Math.sin(a) * sp);
      E.life = 0.5 + sys.rnd() * 0.5;
      eSize(0.22 * s, 0.75 * s);
      E.drag = 2.2; E.grav = -1.1; E.a = 0.44; E.fadeIn = 0.14;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(1.4);
      eCol(C.dust, C.dustDark);
      sys.push('smoke');
    }
    for (let i = 0, n = sys.count(9); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 3 + sys.rnd() * 4;
      eReset();
      eAt(em.pos.x, em.pos.y, em.pos.z);
      eVel(Math.cos(a) * sp, sys.rnd() * 3, Math.sin(a) * sp);
      E.life = 0.2 + sys.rnd() * 0.2;
      eSize(0.08, 0.01);
      E.grav = -9; E.a = 0.8;
      eCol(C.white, C.gold);
      sys.push('spark');
    }
  },
  tick(sys, em) { sys.ringPulse(em, em.age / em.duration, 1.9 * em.scale, C.dust, 0.4); },
});

fx('hit.blood', {
  dur: 1.1,
  init(sys, em) {
    const s = em.scale;
    for (let i = 0, n = sys.count(18); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 1.4 + sys.rnd() * 4.2;
      eReset();
      eAt(em.pos.x, em.pos.y, em.pos.z);
      eVel(Math.cos(a) * sp * 0.7, 1.6 + sys.rnd() * 3.2, Math.sin(a) * sp * 0.7);
      E.life = 0.5 + sys.rnd() * 0.55;
      eSize(0.075 * s, 0.035 * s);
      E.grav = -13; E.drag = 0.4; E.a = 0.95; E.fadeIn = 0.05;
      eCol(C.blood, C.bloodDark);
      sys.push('soft');
    }
    for (let i = 0, n = sys.count(7); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 0.6 + sys.rnd() * 1.4;
      eReset();
      eAt(em.pos.x, em.pos.y, em.pos.z);
      eVel(Math.cos(a) * sp, 0.5 + sys.rnd(), Math.sin(a) * sp);
      E.life = 0.45 + sys.rnd() * 0.4;
      eSize(0.16 * s, 0.44 * s);
      E.drag = 2.6; E.grav = -1.6; E.a = 0.32; E.fadeIn = 0.1;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(2);
      eCol(C.blood, C.bloodDark);
      sys.push('smoke');
    }
  },
});

fx('hit.spark', {
  dur: 0.45,
  init(sys, em) {
    const col = em.hasColor ? em.col : C.fireHot;
    for (let i = 0, n = sys.count(22); i < n; i++) {
      const a = sys.rnd() * TAU, e = sys.rnd() * Math.PI;
      const sp = 2.4 + sys.rnd() * 5.5;
      eReset();
      eAt(em.pos.x, em.pos.y, em.pos.z);
      eVel(Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp * 0.7 + 1.1, Math.sin(a) * Math.sin(e) * sp);
      E.life = 0.22 + sys.rnd() * 0.34;
      eSize(0.09 * em.scale, 0.012);
      E.grav = -7.5; E.drag = 1.5; E.a = 1; E.fadeIn = 0.06;
      eCol(C.white, col);
      sys.push('spark');
    }
    for (let i = 0, n = sys.count(6); i < n; i++) {
      eReset();
      eAt(em.pos.x + sys.sym(0.14), em.pos.y + sys.sym(0.14), em.pos.z + sys.sym(0.14));
      eVel(sys.sym(0.6), 0.5 + sys.rnd(), sys.sym(0.6));
      E.life = 0.3 + sys.rnd() * 0.3;
      eSize(0.3 * em.scale, 0.08);
      E.drag = 3; E.a = 0.5; E.fadeIn = 0.1;
      eCol(col, C.fireDim);
      sys.push('glow');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    if (t < 0.25) {
      sys.orb(em.pos.x, em.pos.y, em.pos.z, 1.1 * em.scale * (0.5 + t * 2),
        em.hasColor ? em.col : C.fireHot, (1 - t / 0.25) * 0.6, 0);
    }
  },
});

fx('hit.block', {
  dur: 0.4,
  init(sys, em) {
    perpH(em.dir, _v1);
    for (let i = 0, n = sys.count(20); i < n; i++) {
      const a = sys.rnd() * TAU;
      const sp = 3.5 + sys.rnd() * 6;
      eReset();
      eAt(em.pos.x, em.pos.y, em.pos.z);
      // sparks fan out in a rough disc facing the blow
      eVel(_v1.x * Math.cos(a) * sp + sys.sym(1), Math.sin(a) * sp * 0.85, _v1.z * Math.cos(a) * sp + sys.sym(1));
      E.life = 0.16 + sys.rnd() * 0.26;
      eSize(0.085, 0.01);
      E.grav = -8.5; E.drag = 1.6; E.a = 1; E.fadeIn = 0.05;
      eCol(C.white, C.steel);
      sys.push('spark');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    if (t < 0.3) {
      sys.orb(em.pos.x, em.pos.y, em.pos.z, 0.95 * em.scale * (0.35 + t * 2.4),
        C.steel, (1 - t / 0.3) * 0.75, 0);
    }
  },
});

/* --------------------------------------------------------------------- fire */

/** Shared fireball body: bright core, corona, lagging ember trail, moving light. */
function fireballInit(sys, em, hot, mid, dim) {
  em.prev.copy(em.pos);
  em.vel.set(0, 0, 0);
  em.light = sys.takeLight(mid, 2.6 * em.scale, 10 * em.scale);
  em.a = sys.rnd() * 10;
  em.col2.copy(hot);
  em.b = dim.r; em.c = dim.g; em.d = dim.b;
  em.acc = 0;
}

function fireballTick(sys, em, dt, hot, mid, dim) {
  const s = em.scale;
  // travel direction, smoothed — Combat calls setPosition() every frame
  if (dt > 0) {
    _v1.subVectors(em.pos, em.prev).multiplyScalar(1 / dt);
    em.vel.lerp(_v1, 0.35);
  }
  const speed = em.vel.length();
  const flick = 0.86 + 0.14 * Math.sin(sys.time * 31 + em.a) + 0.08 * Math.sin(sys.time * 17.3 + em.a * 2);

  // bright core + corona
  sys.orb(em.pos.x, em.pos.y, em.pos.z, 0.44 * s * flick, C.white, 0.95, 0);
  sys.orb(em.pos.x, em.pos.y, em.pos.z, 0.92 * s * (2 - flick), hot, 0.72, sys.time * 1.7);
  sys.orb(em.pos.x, em.pos.y, em.pos.z, 1.5 * s, mid, 0.3, -sys.time * 1.1);

  // lagging trail: interpolate along the travelled segment so fast shots don't gap
  em.acc += dt * 88 * sys.density;
  let emits = em.acc | 0;
  em.acc -= emits;
  if (emits > 12) emits = 12;
  for (let i = 0; i < emits; i++) {
    const u = emits > 1 ? i / emits : 0;
    eReset();
    eAt(
      em.prev.x + (em.pos.x - em.prev.x) * u + sys.sym(0.09 * s),
      em.prev.y + (em.pos.y - em.prev.y) * u + sys.sym(0.09 * s),
      em.prev.z + (em.pos.z - em.prev.z) * u + sys.sym(0.09 * s)
    );
    eVel(-em.vel.x * 0.18 + sys.sym(0.5), -em.vel.y * 0.18 + sys.rnd() * 0.7, -em.vel.z * 0.18 + sys.sym(0.5));
    E.life = 0.28 + sys.rnd() * 0.34;
    eSize(0.44 * s, 0.07 * s);
    E.grav = 0.7; E.drag = 2.4; E.a = 0.8; E.fadeIn = 0.1;
    E.turb = 1.6; E.turbF = 3.4;
    eCol(hot, dim);
    sys.push('ember');
  }
  if (speed > 0.5 && sys.roll(dt * 14 * sys.density)) {
    eReset();
    eAt(em.prev.x + sys.sym(0.12 * s), em.prev.y + sys.sym(0.1 * s), em.prev.z + sys.sym(0.12 * s));
    eVel(sys.sym(0.3), 0.5 + sys.rnd() * 0.6, sys.sym(0.3));
    E.life = 0.7 + sys.rnd() * 0.6;
    eSize(0.28 * s, 0.9 * s);
    E.drag = 1.6; E.grav = 0.35; E.a = 0.2; E.fadeIn = 0.25;
    E.rot = sys.rnd() * TAU; E.rotV = sys.sym(1.2);
    eCol(C.smokeHot, C.smokeDark);
    sys.push('smoke');
  }

  if (em.light) {
    em.light.position.copy(em.pos);
    em.light.intensity = 2.8 * s * flick;
  }
  em.prev.copy(em.pos);
}

fx('fire.ball', {
  dur: Infinity, loop: true,
  init(sys, em) {
    fireballInit(sys, em, em.hasColor ? em.col : C.fireHot, em.hasColor ? em.col : C.fireMid, C.fireDim);
  },
  tick(sys, em, dt) {
    fireballTick(sys, em, dt, em.hasColor ? em.col : C.fireHot, em.hasColor ? em.col : C.fireMid, C.fireDim);
  },
});

fx('soul.fireball', {
  dur: Infinity, loop: true,
  init(sys, em) { fireballInit(sys, em, C.soul, C.soul, C.soulDim); },
  tick(sys, em, dt) {
    fireballTick(sys, em, dt, em.hasColor ? em.col : C.soul, em.hasColor ? em.col : C.soul, C.soulDim);
  },
});

fx('fire.trail', {
  dur: Infinity, loop: true,
  tick(sys, em, dt) {
    const s = em.scale;
    em.acc += dt * 40 * sys.density;
    while (em.acc >= 1) {
      em.acc -= 1;
      eReset();
      eAt(em.pos.x + sys.sym(0.12 * s), em.pos.y + sys.sym(0.1 * s), em.pos.z + sys.sym(0.12 * s));
      eVel(sys.sym(0.4), 0.4 + sys.rnd() * 0.9, sys.sym(0.4));
      E.life = 0.3 + sys.rnd() * 0.35;
      eSize(0.26 * s, 0.05 * s);
      E.grav = 0.9; E.drag = 2.2; E.a = 0.8; E.turb = 1.5; E.turbF = 3.6;
      eCol(em.hasColor ? em.col : C.fireHot, C.fireDim);
      sys.push('ember');
    }
  },
});

fx('fire.explode', {
  dur: 3.0,
  init(sys, em) {
    const s = Math.max(0.6, em.scale);
    const hot = em.hasColor ? em.col : C.fireHot;
    em.light = sys.takeLight(hot, 6 * s, 16 * s);

    // expanding, decelerating flame shell
    for (let i = 0, n = sys.count(56 * Math.min(2.2, s)); i < n; i++) {
      const a = sys.rnd() * TAU, e = Math.acos(1 - 2 * sys.rnd());
      const sp = (4.4 + sys.rnd() * 3.4) * s;
      eReset();
      eAt(em.pos.x, em.pos.y + 0.25 * s, em.pos.z);
      eVel(Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp * 0.72 + 1.2 * s, Math.sin(a) * Math.sin(e) * sp);
      E.life = 0.42 + sys.rnd() * 0.4;
      eSize(0.34 * s, 0.9 * s);
      E.drag = 4.2; E.grav = 1.4; E.a = 0.95; E.fadeIn = 0.08;
      E.turb = 2.2 * s; E.turbF = 2.2;
      eCol(sys.rnd() < 0.35 ? C.fireCore : hot, C.fireLow);
      sys.push('ember');
    }
    // embers that arc and fall
    for (let i = 0, n = sys.count(26 * Math.min(2, s)); i < n; i++) {
      const a = sys.rnd() * TAU, e = sys.rnd() * Math.PI * 0.55;
      const sp = (3.5 + sys.rnd() * 6.5) * s;
      eReset();
      eAt(em.pos.x, em.pos.y + 0.3 * s, em.pos.z);
      eVel(Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp + 1.6, Math.sin(a) * Math.sin(e) * sp);
      E.life = 0.8 + sys.rnd() * 1.1;
      eSize(0.1 * s, 0.02);
      E.grav = -9.4; E.drag = 0.55; E.a = 1; E.fadeIn = 0.05;
      eCol(C.fireCore, C.fireLow);
      sys.push('spark');
    }
    // buoyant smoke that outlives the flame
    for (let i = 0, n = sys.count(22 * Math.min(2, s)); i < n; i++) {
      const a = sys.rnd() * TAU, r = sys.rnd() * 1.1 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.25 * s + sys.rnd() * 0.4 * s, em.pos.z + Math.sin(a) * r);
      eVel(Math.cos(a) * (0.7 + sys.rnd()) * s, 0.9 + sys.rnd() * 1.1, Math.sin(a) * (0.7 + sys.rnd()) * s);
      E.life = 1.9 + sys.rnd() * 1.0;
      eSize(0.55 * s, 2.4 * s);
      E.drag = 1.35; E.grav = 0.62; E.a = 0.42; E.fadeIn = 0.18;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.7);
      E.turb = 0.5; E.turbF = 1.1;
      eCol(C.smokeHot, C.smokeDark);
      sys.push('smoke');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    const s = Math.max(0.6, em.scale);
    if (t < 0.13) {
      const k = t / 0.13;
      sys.orb(em.pos.x, em.pos.y + 0.3 * s, em.pos.z, (1.5 + k * 3.6) * s, C.fireCore, (1 - k) * 0.95, 0);
    }
    sys.ringPulse(em, t / 0.34, 4.2 * s, em.hasColor ? em.col : C.fireHot, 0.85);
    if (em.light) em.light.intensity = Math.max(0, 6 * s * (1 - t * 4.5));
  },
});

fx('fire.wall', {
  dur: 9, loop: false,
  init(sys, em) { em.light = sys.takeLight(C.fireMid, 3 * em.scale, 12); },
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, t * 8) * Math.min(1, (1 - t) * 5);
    const s = Math.max(1, em.scale);
    perpH(em.dir, _v1);
    em.acc += dt * 90 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const u = sys.sym(1);
      eReset();
      eAt(em.pos.x + _v1.x * u * s + sys.sym(0.16), em.pos.y, em.pos.z + _v1.z * u * s + sys.sym(0.16));
      eVel(sys.sym(0.3), 2.2 + sys.rnd() * 1.8, sys.sym(0.3));
      E.life = 0.5 + sys.rnd() * 0.4;
      eSize(0.44, 0.12);
      E.grav = 2.4; E.drag = 0.9; E.a = 0.7; E.fadeIn = 0.16;
      E.turb = 3.2; E.turbF = 2.6;
      eCol(C.fireCore, C.fireLow);
      sys.push('ember');
    }
    if (sys.roll(dt * 14 * sys.density * env)) {
      const u = sys.sym(1);
      eReset();
      eAt(em.pos.x + _v1.x * u * s, em.pos.y + 1.2, em.pos.z + _v1.z * u * s);
      eVel(sys.sym(0.5), 1.4 + sys.rnd(), sys.sym(0.5));
      E.life = 1.4 + sys.rnd();
      eSize(0.6, 2.0);
      E.drag = 1.2; E.grav = 0.5; E.a = 0.24; E.fadeIn = 0.2;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.6);
      eCol(C.smokeHot, C.smokeDark);
      sys.push('smoke');
    }
    if (em.light) {
      em.light.position.set(em.pos.x, em.pos.y + 0.9, em.pos.z);
      em.light.intensity = 3.4 * env * (0.85 + 0.15 * Math.sin(sys.time * 21));
    }
  },
});

fx('fire.pillar', {
  dur: 1.8,
  init(sys, em) { em.light = sys.takeLight(C.fireMid, 5 * em.scale, 14); },
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, t * 9) * Math.min(1, (1 - t) * 3.2);
    const s = Math.max(0.8, em.scale);
    em.acc += dt * 150 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * 0.55 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 0.4, em.pos.z + Math.sin(a) * r);
      eVel(Math.cos(a) * 0.3, 5.5 + sys.rnd() * 4.5, Math.sin(a) * 0.3);
      E.life = 0.55 + sys.rnd() * 0.5;
      eSize(0.55 * s, 0.14 * s);
      E.grav = 2.2; E.drag = 0.6; E.a = 0.75; E.fadeIn = 0.12;
      E.turb = 3.6; E.turbF = 2.1;
      eCol(C.fireCore, C.fireLow);
      sys.push('ember');
    }
    sys.ringPulse(em, t / 0.5, 3.2 * s, C.fireHot, 0.8);
    if (em.light) {
      em.light.position.set(em.pos.x, em.pos.y + 1.6 * s, em.pos.z);
      em.light.intensity = 5.5 * env;
    }
  },
});

/* ---------------------------------------------------------------------- ice */

fx('ice.shard', {
  dur: 0.55,
  init(sys, em) {
    const b = sys.ribbons.alloc();
    em.ribbon = b;
    const s = em.scale;
    if (b >= 0) {
      sys.ribbons.begin(b);
      const spikes = 5;
      for (let k = 0; k < spikes; k++) {
        const a = (k / spikes) * TAU + sys.rnd() * 0.4;
        const len = (0.7 + sys.rnd() * 0.9) * s;
        const ey = sys.sym(0.5) * s;
        sys.ribbons.add(b, em.pos.x, em.pos.y, em.pos.z, false);
        sys.ribbons.add(b, em.pos.x + Math.cos(a) * len, em.pos.y + ey, em.pos.z + Math.sin(a) * len, true);
      }
    }
    for (let i = 0, n = sys.count(20); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 2 + sys.rnd() * 5;
      eReset();
      eAt(em.pos.x, em.pos.y, em.pos.z);
      eVel(Math.cos(a) * sp, sys.sym(2.5), Math.sin(a) * sp);
      E.life = 0.3 + sys.rnd() * 0.35;
      eSize(0.09 * s, 0.015);
      E.grav = -5.5; E.drag = 1.2; E.a = 1; E.fadeIn = 0.06;
      eCol(C.iceWhite, C.iceDeep);
      sys.push('spark');
    }
    for (let i = 0, n = sys.count(8); i < n; i++) {
      eReset();
      eAt(em.pos.x + sys.sym(0.3 * s), em.pos.y + sys.sym(0.3 * s), em.pos.z + sys.sym(0.3 * s));
      eVel(sys.sym(0.5), sys.sym(0.4), sys.sym(0.5));
      E.life = 0.5 + sys.rnd() * 0.4;
      eSize(0.3 * s, 0.85 * s);
      E.drag = 2.4; E.a = 0.3; E.fadeIn = 0.15;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(1);
      eCol(C.ice, C.iceDeep);
      sys.push('smoke');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    if (em.ribbon >= 0) {
      sys.ribbons.write(em.ribbon, em.hasColor ? em.col : C.ice,
        0.07 * em.scale * (1 - t), Math.max(0, 1 - t * 1.6), 1.1, 0, 0);
    }
    if (t < 0.25) {
      sys.orb(em.pos.x, em.pos.y, em.pos.z, 1.2 * em.scale * (0.4 + t * 2.2),
        C.iceWhite, (1 - t / 0.25) * 0.6, 0);
    }
  },
});

fx('ice.storm', {
  dur: 2.6,
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, t * 6) * Math.min(1, (1 - t) * 3);
    const R = Math.max(1.2, em.scale);
    em.acc += dt * 120 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * R;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 4.5 + sys.rnd() * 2.5, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.7), -9 - sys.rnd() * 6, sys.sym(0.7));
      E.life = 0.42 + sys.rnd() * 0.2;
      eSize(0.14, 0.05);
      E.grav = -6; E.a = 0.95; E.fadeIn = 0.12;
      eCol(C.iceWhite, C.ice);
      sys.push('spark');
    }
    if (sys.roll(dt * 26 * sys.density * env)) {
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * R;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.1, em.pos.z + Math.sin(a) * r);
      eVel(Math.cos(a) * 1.4, 0.25, Math.sin(a) * 1.4);
      E.life = 1.1 + sys.rnd() * 0.7;
      eSize(0.5, 1.7);
      E.drag = 1.6; E.a = 0.24; E.fadeIn = 0.22;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.5);
      eCol(C.ice, C.iceDeep);
      sys.push('smoke');
    }
    sys.ring(em.pos.x, em.pos.y + 0.05, em.pos.z, R * (0.75 + 0.25 * Math.sin(sys.time * 3)),
      em.hasColor ? em.col : C.ice, 0.4 * env, sys.time * 0.6);
  },
});

fx('ice.freeze', {
  dur: 1.0,
  init(sys, em) {
    for (let i = 0, n = sys.count(24); i < n; i++) {
      const a = sys.rnd() * TAU, e = sys.rnd() * Math.PI;
      const sp = 1.4 + sys.rnd() * 2.4;
      eReset();
      eAt(em.pos.x, em.pos.y + 0.6 * em.scale, em.pos.z);
      eVel(Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp, Math.sin(a) * Math.sin(e) * sp);
      E.life = 0.5 + sys.rnd() * 0.5;
      eSize(0.08 * em.scale, 0.02);
      E.drag = 2.6; E.grav = -1.4; E.a = 0.95; E.fadeIn = 0.1;
      eCol(C.iceWhite, C.iceDeep);
      sys.push('spark');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    const s = Math.max(0.6, em.scale);
    sys.aura(em.pos.x, em.pos.y + 0.8 * s, em.pos.z, s * (1.4 - t * 0.35),
      C.ice, (1 - t) * 0.55);
  },
});

/* ------------------------------------------------------------------ thunder */

/**
 * Recursive midpoint displacement into a ribbon block.
 * Writes `2^levels + 1` points between (x0,y0,z0) and (x1,y1,z1).
 */
const _boltBuf = new Float32Array(129 * 3);

function midpointBolt(sys, bank, block, x0, y0, z0, x1, y1, z1, amp, levels, breakAfter) {
  const n = (1 << levels) + 1;
  _boltBuf[0] = x0; _boltBuf[1] = y0; _boltBuf[2] = z0;
  const last = (n - 1) * 3;
  _boltBuf[last] = x1; _boltBuf[last + 1] = y1; _boltBuf[last + 2] = z1;
  let step = n - 1;
  let a = amp;
  while (step > 1) {
    const half = step >> 1;
    for (let i = half; i < n; i += step) {
      const l = (i - half) * 3, r = (i + half) * 3, m = i * 3;
      _boltBuf[m] = (_boltBuf[l] + _boltBuf[r]) * 0.5 + sys.sym(a);
      _boltBuf[m + 1] = (_boltBuf[l + 1] + _boltBuf[r + 1]) * 0.5 + sys.sym(a * 0.4);
      _boltBuf[m + 2] = (_boltBuf[l + 2] + _boltBuf[r + 2]) * 0.5 + sys.sym(a);
    }
    step = half;
    a *= 0.52;
  }
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    bank.add(block, _boltBuf[o], _boltBuf[o + 1], _boltBuf[o + 2], breakAfter && i === n - 1);
  }
}

fx('thunder.bolt', {
  dur: 0.42,
  init(sys, em) {
    const b = sys.ribbons.alloc();
    em.ribbon = b;
    const s = Math.max(0.8, em.scale);
    em.light = sys.takeLight(em.hasColor ? em.col : C.bolt, 0, 40 * s);
    if (b < 0) return;
    sys.ribbons.begin(b);
    const topY = em.pos.y + 26 * s;
    const dx = sys.sym(3.5 * s), dz = sys.sym(3.5 * s);
    midpointBolt(sys, sys.ribbons, b,
      em.pos.x + dx, topY, em.pos.z + dz,
      em.pos.x, em.pos.y, em.pos.z,
      1.5 * s, 5, true);
    // forks peel off the trunk and die out fast
    const forks = 2 + (sys.rnd() < 0.5 ? 1 : 0);
    for (let k = 0; k < forks; k++) {
      const u = 0.25 + sys.rnd() * 0.5;
      const sx = em.pos.x + dx * u, sy = em.pos.y + (topY - em.pos.y) * u, sz = em.pos.z + dz * u;
      const a = sys.rnd() * TAU;
      const len = (4 + sys.rnd() * 7) * s;
      midpointBolt(sys, sys.ribbons, b,
        sx, sy, sz,
        sx + Math.cos(a) * len, sy - len * (0.5 + sys.rnd() * 0.6), sz + Math.sin(a) * len,
        0.9 * s, 3, true);
    }
    // ground scatter at the strike point
    for (let i = 0, n = sys.count(22); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 2 + sys.rnd() * 7;
      eReset();
      eAt(em.pos.x, em.pos.y + 0.05, em.pos.z);
      eVel(Math.cos(a) * sp, 1.5 + sys.rnd() * 5, Math.sin(a) * sp);
      E.life = 0.25 + sys.rnd() * 0.4;
      eSize(0.1 * s, 0.015);
      E.grav = -11; E.drag = 0.7; E.a = 1; E.fadeIn = 0.04;
      eCol(C.boltCore, C.bolt);
      sys.push('spark');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    const s = Math.max(0.8, em.scale);
    // strobe: a couple of hard re-strikes, then a fast square-law decay
    const strobe = t < 0.06 ? 1
      : (0.35 + 0.65 * Math.abs(Math.sin(t * 47 + em.seed))) * (1 - t) * (1 - t) * 1.9;
    const a = Math.max(0, Math.min(1.6, strobe));
    if (em.ribbon >= 0) {
      sys.ribbons.write(em.ribbon, em.hasColor ? em.col : C.bolt,
        0.10 * s * (0.55 + 0.45 * a), a, 1.1, 0, 0);
    }
    if (em.light) em.light.intensity = a * 14 * s;
    if (t < 0.3) {
      sys.orb(em.pos.x, em.pos.y + 0.2, em.pos.z, 2.6 * s * (0.4 + t * 2), C.bolt, a * 0.5, 0);
    }
  },
});

fx('thunder.impact', {
  dur: 0.6,
  init(sys, em) {
    em.light = sys.takeLight(C.bolt, 0, 16 * em.scale);
    for (let i = 0, n = sys.count(30); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 2.5 + sys.rnd() * 6.5;
      eReset();
      eAt(em.pos.x, em.pos.y + 0.1, em.pos.z);
      eVel(Math.cos(a) * sp * 0.6, 3 + sys.rnd() * 6, Math.sin(a) * sp * 0.6);
      E.life = 0.3 + sys.rnd() * 0.4;
      eSize(0.1 * em.scale, 0.015);
      E.grav = -12; E.drag = 0.6; E.a = 1; E.fadeIn = 0.05;
      eCol(C.boltCore, C.boltDim);
      sys.push('spark');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    sys.ringPulse(em, t / 0.5, 3.4 * em.scale, C.bolt, 0.9);
    if (em.light) em.light.intensity = Math.max(0, 10 * (1 - t * 3));
    if (t < 0.2) sys.orb(em.pos.x, em.pos.y + 0.3, em.pos.z, 2 * em.scale * (0.4 + t * 3), C.bolt, (1 - t / 0.2) * 0.7, 0);
  },
});

/* ------------------------------------------------------------- support magic */

fx('heal.aura', {
  dur: 1.7,
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, (1 - t) * 2.4);
    const s = Math.max(0.7, em.scale);
    em.acc += dt * 55 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = (0.35 + sys.rnd() * 0.35) * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 0.3, em.pos.z + Math.sin(a) * r);
      // gentle spiral: tangential push plus lift
      eVel(-Math.sin(a) * 0.8, 1.5 + sys.rnd() * 1.4, Math.cos(a) * 0.8);
      E.life = 0.8 + sys.rnd() * 0.6;
      eSize(0.15 * s, 0.03);
      E.drag = 0.5; E.a = 0.9; E.fadeIn = 0.2;
      eCol(C.healGold, C.heal);
      sys.push('glow');
    }
    sys.ring(em.pos.x, em.pos.y + 0.05, em.pos.z, s * (0.6 + t * 1.5), C.heal, env * 0.5, -sys.time * 0.9);
    sys.aura(em.pos.x, em.pos.y + 0.9 * s, em.pos.z, s * (0.85 + t * 0.35), C.heal, env * 0.24);
  },
});

fx('poison.cloud', {
  dur: 6, loop: false,
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, t * 5) * Math.min(1, (1 - t) * 4);
    const s = Math.max(0.7, em.scale);
    em.acc += dt * 22 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * 0.8 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.15 + sys.rnd() * 0.5 * s, em.pos.z + Math.sin(a) * r);
      eVel(Math.cos(a) * 0.28, 0.22 + sys.rnd() * 0.3, Math.sin(a) * 0.28);
      E.life = 1.6 + sys.rnd() * 1.2;
      eSize(0.5 * s, 1.5 * s);
      E.drag = 1.1; E.a = 0.3; E.fadeIn = 0.25;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.4);
      E.turb = 0.4; E.turbF = 1.5;
      eCol(C.poison, C.poisonDark);
      sys.push('smoke');
    }
    if (sys.roll(dt * 9 * sys.density * env)) {
      const a = sys.rnd() * TAU, r = sys.rnd() * 0.8 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.2, em.pos.z + Math.sin(a) * r);
      eVel(0, 0.5 + sys.rnd() * 0.6, 0);
      E.life = 0.9 + sys.rnd() * 0.6;
      eSize(0.12 * s, 0.02);
      E.a = 0.75; E.drag = 0.6; E.fadeIn = 0.2;
      eCol(C.poison, C.poisonDark);
      sys.push('glow');
    }
  },
});

fx('poison.tick', {
  dur: 0.8,
  init(sys, em) {
    for (let i = 0, n = sys.count(12); i < n; i++) {
      const a = sys.rnd() * TAU, r = sys.rnd() * 0.32 * em.scale;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.4), 1.1 + sys.rnd() * 1.2, sys.sym(0.4));
      E.life = 0.5 + sys.rnd() * 0.4;
      eSize(0.13 * em.scale, 0.02);
      E.drag = 1.1; E.a = 0.9; E.fadeIn = 0.15;
      eCol(C.poison, C.poisonDark);
      sys.push('glow');
    }
  },
});

fx('shield.magic', {
  dur: 20, loop: false,
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, t * 12) * Math.min(1, (1 - t) * 6);
    const s = Math.max(0.7, em.scale);
    const pulse = 0.72 + 0.28 * Math.sin(sys.time * 2.4 + em.seed);
    const col = em.hasColor ? em.col : C.arcane;
    sys.aura(em.pos.x, em.pos.y + 0.95 * s, em.pos.z, s * 1.15 * (0.97 + 0.03 * pulse),
      col, env * 0.42 * pulse);
    em.acc += dt * 14 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, e = sys.rnd() * Math.PI;
      const r = 1.1 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * Math.sin(e) * r,
        em.pos.y + 0.95 * s + Math.cos(e) * r,
        em.pos.z + Math.sin(a) * Math.sin(e) * r);
      eVel(0, 0.15, 0);
      E.life = 0.7 + sys.rnd() * 0.5;
      eSize(0.1 * s, 0.015);
      E.a = 0.85; E.fadeIn = 0.25;
      eCol(C.white, col);
      sys.push('glow');
    }
  },
});

fx('invisible.puff', {
  dur: 0.9,
  init(sys, em) {
    const s = Math.max(0.7, em.scale);
    for (let i = 0, n = sys.count(20); i < n; i++) {
      const a = sys.rnd() * TAU, r = (0.7 + sys.rnd() * 0.4) * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 1.6 * s, em.pos.z + Math.sin(a) * r);
      // collapse inward: velocity points at the centre
      eVel(-Math.cos(a) * 1.9, 0.35, -Math.sin(a) * 1.9);
      E.life = 0.55 + sys.rnd() * 0.4;
      eSize(0.45 * s, 0.12 * s);
      E.drag = 1.4; E.a = 0.4; E.fadeIn = 0.16;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(1.4);
      eCol(C.smokeGrey, C.arcane);
      sys.push('smoke');
    }
    for (let i = 0, n = sys.count(12); i < n; i++) {
      const a = sys.rnd() * TAU, r = sys.rnd() * 0.8 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 1.6 * s, em.pos.z + Math.sin(a) * r);
      eVel(0, 0.9, 0);
      E.life = 0.5 + sys.rnd() * 0.4;
      eSize(0.1, 0.01);
      E.a = 0.9;
      eCol(C.white, C.arcane);
      sys.push('glow');
    }
  },
});

fx('summon.rune', {
  dur: 1.4, loop: false,
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, t * 6) * Math.min(1, (1 - t) * 4);
    const s = Math.max(0.8, em.scale);
    const col = em.hasColor ? em.col : C.arcane;
    sys.ring(em.pos.x, em.pos.y + 0.04, em.pos.z, 1.15 * s, col, env * 0.85, sys.time * 1.1);
    sys.ring(em.pos.x, em.pos.y + 0.06, em.pos.z, 0.72 * s, col, env * 0.6, -sys.time * 1.7);
    em.acc += dt * 26 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = (0.5 + sys.rnd() * 0.7) * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.05, em.pos.z + Math.sin(a) * r);
      eVel(-Math.sin(a) * 0.5, 1.1 + sys.rnd() * 1.1, Math.cos(a) * 0.5);
      E.life = 0.8 + sys.rnd() * 0.5;
      eSize(0.13 * s, 0.02);
      E.drag = 0.4; E.a = 0.9; E.fadeIn = 0.2;
      eCol(C.white, col);
      sys.push('glow');
    }
  },
});

fx('summon.burst', {
  dur: 1.2,
  init(sys, em) {
    const s = Math.max(0.8, em.scale);
    em.light = sys.takeLight(C.arcane, 3 * s, 12);
    for (let i = 0, n = sys.count(38); i < n; i++) {
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * 0.9 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.05, em.pos.z + Math.sin(a) * r);
      eVel(Math.cos(a) * 0.9, 3.2 + sys.rnd() * 4.2, Math.sin(a) * 0.9);
      E.life = 0.6 + sys.rnd() * 0.6;
      eSize(0.16 * s, 0.02);
      E.grav = -2.6; E.drag = 0.5; E.a = 0.95; E.fadeIn = 0.1;
      eCol(C.white, C.arcane);
      sys.push('glow');
    }
  },
  tick(sys, em) {
    const t = em.age / em.duration;
    const s = Math.max(0.8, em.scale);
    sys.ringPulse(em, t / 0.55, 3 * s, C.arcane, 0.85);
    if (t < 0.2) sys.orb(em.pos.x, em.pos.y + 0.5 * s, em.pos.z, 2.4 * s * (0.3 + t * 3), C.arcane, (1 - t / 0.2) * 0.8, 0);
    if (em.light) em.light.intensity = Math.max(0, 3.4 * s * (1 - t * 2.2));
  },
});

/* -------------------------------------------------------------- world / props */

fx('torch.flame', {
  dur: Infinity, loop: true,
  init(sys, em) { em.a = sys.rnd() * 10; },
  tick(sys, em, dt) {
    const s = em.scale;
    em.acc += dt * 50 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU;
      const r = 0.06 * s * Math.sqrt(sys.rnd());
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y - 0.02 * s, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.14) * s, (0.9 + sys.rnd() * 0.5) * s, sys.sym(0.14) * s);
      E.life = 0.34 + sys.rnd() * 0.3;
      eSize(0.25 * s, 0.06 * s);
      E.grav = 1.45 * s;            // buoyancy, not gravity
      E.drag = 1.15;
      E.turb = 2.8 * s; E.turbF = 3.2;
      E.a = 0.7; E.fadeIn = 0.18;
      eCol(C.fireCore, C.fireLow);
      sys.push('ember');
    }
    em.acc2 += dt * 3.2 * sys.density * em.fade;
    while (em.acc2 >= 1) {
      em.acc2 -= 1;
      eReset();
      eAt(em.pos.x + sys.sym(0.05 * s), em.pos.y + 0.4 * s, em.pos.z + sys.sym(0.05 * s));
      eVel(sys.sym(0.12), 0.75 * s, sys.sym(0.12));
      E.life = 1.1 + sys.rnd() * 0.8;
      eSize(0.18 * s, 0.7 * s);
      E.grav = 0.35; E.drag = 0.9; E.a = 0.13; E.fadeIn = 0.3;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.5);
      E.turb = 0.7; E.turbF = 1.4;
      eCol(C.smokeHot, C.smokeDark);
      sys.push('smoke');
    }
    const fl = 0.8 + 0.2 * Math.sin(sys.time * 17.4 + em.a) + 0.12 * Math.sin(sys.time * 29.1 + em.a * 1.7);
    sys.orb(em.pos.x, em.pos.y + 0.1 * s, em.pos.z, 0.5 * s * fl, C.fireHot, 0.5 * fl * em.fade, 0);
  },
});

fx('campfire', {
  dur: Infinity, loop: true,
  init(sys, em) { em.a = sys.rnd() * 10; },
  tick(sys, em, dt) {
    const s = em.scale * 1.5;
    em.acc += dt * 62 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU;
      const r = 0.22 * s * Math.sqrt(sys.rnd());
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.2) * s, (0.85 + sys.rnd() * 0.6) * s, sys.sym(0.2) * s);
      E.life = 0.42 + sys.rnd() * 0.36;
      eSize(0.3 * s, 0.06 * s);
      E.grav = 1.5 * s; E.drag = 1.1;
      E.turb = 2.4 * s; E.turbF = 2.6;
      E.a = 0.7; E.fadeIn = 0.18;
      eCol(C.fireCore, C.fireLow);
      sys.push('ember');
    }
    em.acc2 += dt * 8 * sys.density * em.fade;
    while (em.acc2 >= 1) {
      em.acc2 -= 1;
      if (sys.rnd() < 0.45) {
        eReset();
        eAt(em.pos.x + sys.sym(0.2 * s), em.pos.y + 0.4 * s, em.pos.z + sys.sym(0.2 * s));
        eVel(sys.sym(0.5), 1.6 + sys.rnd() * 1.6, sys.sym(0.5));
        E.life = 1.0 + sys.rnd() * 1.2;
        eSize(0.06 * s, 0.012);
        E.grav = 0.6; E.drag = 0.8; E.a = 0.9; E.turb = 1.4; E.turbF = 2.4;
        eCol(C.fireHot, C.fireLow);
        sys.push('spark');
      } else {
        eReset();
        eAt(em.pos.x + sys.sym(0.15 * s), em.pos.y + 0.6 * s, em.pos.z + sys.sym(0.15 * s));
        eVel(sys.sym(0.2), 1.1 * s, sys.sym(0.2));
        E.life = 1.6 + sys.rnd() * 1.2;
        eSize(0.4 * s, 1.6 * s);
        E.grav = 0.4; E.drag = 0.9; E.a = 0.16; E.fadeIn = 0.3;
        E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.4);
        E.turb = 0.6; E.turbF = 1.1;
        eCol(C.smokeHot, C.smokeDark);
        sys.push('smoke');
      }
    }
    const fl = 0.8 + 0.2 * Math.sin(sys.time * 13.2 + em.a) + 0.1 * Math.sin(sys.time * 24.6 + em.a * 1.4);
    sys.orb(em.pos.x, em.pos.y + 0.16 * s, em.pos.z, 0.9 * s * fl, C.fireHot, 0.5 * fl * em.fade, 0);
  },
});

fx('brazier', {
  dur: Infinity, loop: true,
  init(sys, em) { em.a = sys.rnd() * 10; },
  tick(sys, em, dt) {
    const s = em.scale * 1.15;
    em.acc += dt * 54 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU;
      const r = 0.13 * s * Math.sqrt(sys.rnd());
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.16) * s, (1.0 + sys.rnd() * 0.6) * s, sys.sym(0.16) * s);
      E.life = 0.4 + sys.rnd() * 0.32;
      eSize(0.28 * s, 0.06 * s);
      E.grav = 1.6 * s; E.drag = 1.05;
      E.turb = 2.9 * s; E.turbF = 3.0;
      E.a = 0.72; E.fadeIn = 0.18;
      eCol(C.fireCore, C.fireLow);
      sys.push('ember');
    }
    em.acc2 += dt * 6 * sys.density * em.fade;
    while (em.acc2 >= 1) {
      em.acc2 -= 1;
      eReset();
      eAt(em.pos.x + sys.sym(0.12 * s), em.pos.y + 0.5 * s, em.pos.z + sys.sym(0.12 * s));
      eVel(sys.sym(0.4), 1.9 + sys.rnd() * 1.8, sys.sym(0.4));
      E.life = 0.9 + sys.rnd() * 1.1;
      eSize(0.055 * s, 0.01);
      E.grav = 0.5; E.drag = 0.7; E.a = 0.9; E.turb = 1.6; E.turbF = 2.6;
      eCol(C.fireHot, C.fireLow);
      sys.push('spark');
    }
    const fl = 0.82 + 0.18 * Math.sin(sys.time * 15.7 + em.a) + 0.1 * Math.sin(sys.time * 26.3 + em.a * 2.1);
    sys.orb(em.pos.x, em.pos.y + 0.14 * s, em.pos.z, 0.72 * s * fl, C.fireHot, 0.52 * fl * em.fade, 0);
  },
});

fx('lava.bubble', {
  dur: Infinity, loop: true,
  init(sys, em) { em.a = 0; em.b = sys.rnd() * 2; },
  tick(sys, em, dt) {
    const s = Math.max(0.6, em.scale);
    em.b -= dt;
    if (em.b <= 0) {
      em.b = 1.4 + sys.rnd() * 3.4;
      em.a = 0.55;                        // start a pop
      em.c = sys.sym(1.1 * s);
      em.d = sys.sym(1.1 * s);
      for (let i = 0, n = sys.count(9); i < n; i++) {
        const a = sys.rnd() * TAU, sp = 0.7 + sys.rnd() * 2.4;
        eReset();
        eAt(em.pos.x + em.c, em.pos.y + 0.08, em.pos.z + em.d);
        eVel(Math.cos(a) * sp, 1.6 + sys.rnd() * 2.6, Math.sin(a) * sp);
        E.life = 0.6 + sys.rnd() * 0.6;
        eSize(0.11 * s, 0.02);
        E.grav = -6.5; E.drag = 0.6; E.a = 0.95;
        eCol(C.fireCore, C.fireLow);
        sys.push('spark');
      }
      eReset();
      eAt(em.pos.x + em.c, em.pos.y + 0.2, em.pos.z + em.d);
      eVel(sys.sym(0.2), 0.7, sys.sym(0.2));
      E.life = 1.8 + sys.rnd();
      eSize(0.35 * s, 1.4 * s);
      E.grav = 0.35; E.drag = 1.1; E.a = 0.2; E.fadeIn = 0.3;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.4);
      eCol(C.smokeHot, C.smokeDark);
      sys.push('smoke');
    }
    if (em.a > 0) {
      em.a = Math.max(0, em.a - dt);
      const k = em.a / 0.55;
      sys.orb(em.pos.x + em.c, em.pos.y + 0.12, em.pos.z + em.d,
        0.75 * s * (1.2 - k), C.fireMid, k * 0.7 * em.fade, 0);
    }
  },
});

fx('chimney.smoke', {
  dur: Infinity, loop: true,
  tick(sys, em, dt) {
    const s = Math.max(0.7, em.scale);
    em.acc += dt * 5.5 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      eReset();
      eAt(em.pos.x + sys.sym(0.12 * s), em.pos.y, em.pos.z + sys.sym(0.12 * s));
      eVel(0.35 + sys.sym(0.2), 1.1 + sys.rnd() * 0.5, 0.2 + sys.sym(0.2));
      E.life = 3.4 + sys.rnd() * 2.2;
      eSize(0.42 * s, 2.6 * s);
      E.grav = 0.22; E.drag = 0.42; E.a = 0.24; E.fadeIn = 0.28;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.3);
      E.turb = 0.35; E.turbF = 0.7;
      eCol(C.smokeGrey, C.smokeDark);
      sys.push('smoke');
    }
  },
});

/* --------------------------------------------------------------- environment */

fx('dust.step', {
  dur: 0.7,
  init(sys, em) {
    const s = Math.max(0.3, em.scale);
    for (let i = 0, n = sys.count(6); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 0.35 + sys.rnd() * 0.7;
      eReset();
      eAt(em.pos.x + sys.sym(0.1), em.pos.y + 0.03, em.pos.z + sys.sym(0.1));
      eVel(Math.cos(a) * sp, 0.3 + sys.rnd() * 0.4, Math.sin(a) * sp);
      E.life = 0.4 + sys.rnd() * 0.35;
      eSize(0.16 * s, 0.55 * s);
      E.drag = 2.6; E.grav = -0.5; E.a = 0.3; E.fadeIn = 0.18;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(1);
      eCol(C.dust, C.dustDark);
      sys.push('smoke');
    }
  },
});

fx('dust.land', {
  dur: 1.0,
  init(sys, em) {
    const s = Math.max(0.5, em.scale);
    for (let i = 0, n = sys.count(16); i < n; i++) {
      const a = sys.rnd() * TAU, sp = 1.4 + sys.rnd() * 2.4;
      eReset();
      eAt(em.pos.x, em.pos.y + 0.05, em.pos.z);
      eVel(Math.cos(a) * sp, 0.35 + sys.rnd() * 0.6, Math.sin(a) * sp);
      E.life = 0.6 + sys.rnd() * 0.5;
      eSize(0.24 * s, 1.05 * s);
      E.drag = 2.9; E.grav = -0.7; E.a = 0.36; E.fadeIn = 0.16;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(1.2);
      eCol(C.dust, C.dustDark);
      sys.push('smoke');
    }
  },
  tick(sys, em) { sys.ringPulse(em, em.age / em.duration / 0.5, 2.2 * em.scale, C.dust, 0.3); },
});

fx('leaf.fall', {
  dur: Infinity, loop: true,
  tick(sys, em, dt) {
    const s = Math.max(1, em.scale);
    em.acc += dt * 2.4 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * 2.6 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 1.5 + sys.rnd() * 2.4, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.5), -0.42 - sys.rnd() * 0.3, sys.sym(0.5));
      E.life = 3.4 + sys.rnd() * 2.4;
      eSize(0.12, 0.11);
      E.drag = 0.6; E.a = 0.85; E.fadeIn = 0.12;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(3.2);
      E.turb = 0.8; E.turbF = 1.6;
      eCol(sys.rnd() < 0.5 ? C.leaf : C.leafDry, C.leafDry);
      sys.push('smoke');
    }
  },
});

fx('firefly', {
  dur: Infinity, loop: true,
  tick(sys, em, dt) {
    const s = Math.max(1, em.scale);
    em.acc += dt * 3.2 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * 2.4 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.4 + sys.rnd() * 1.4, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.25), sys.sym(0.16), sys.sym(0.25));
      E.life = 3.5 + sys.rnd() * 3;
      eSize(0.06, 0.05);
      E.a = 0.85; E.fadeIn = 0.35;
      E.turb = 0.55; E.turbF = 2.2; E.drag = 0.35;
      eCol(C.healGold, C.heal);
      sys.push('glow');
    }
  },
});

/* -------------------------------------------------------------- player beats */

fx('level.up', {
  dur: 2.4,
  init(sys, em) {
    em.light = sys.takeLight(C.gold, 4, 14);
    for (let i = 0, n = sys.count(70); i < n; i++) {
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * 0.85;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 0.3, em.pos.z + Math.sin(a) * r);
      eVel(-Math.sin(a) * 0.7, 3.2 + sys.rnd() * 4.4, Math.cos(a) * 0.7);
      E.life = 0.9 + sys.rnd() * 0.9;
      eSize(0.17, 0.02);
      E.drag = 0.42; E.a = 1; E.fadeIn = 0.1;
      eCol(C.white, C.gold);
      sys.push('glow');
    }
  },
  tick(sys, em, dt) {
    const t = em.age / em.duration;
    const env = Math.min(1, (1 - t) * 2.2);
    sys.ringPulse(em, t / 0.5, 3.4, C.gold, 0.9);
    sys.ring(em.pos.x, em.pos.y + 0.05, em.pos.z, 0.6 + t * 1.6, C.healGold, env * 0.55, sys.time * 1.6);
    sys.orb(em.pos.x, em.pos.y + 1.0 + t * 1.4, em.pos.z, 1.5 * env, C.gold, env * 0.55, 0);
    em.acc += dt * 30 * sys.density * env;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU;
      eReset();
      eAt(em.pos.x + Math.cos(a) * 0.5, em.pos.y + 0.1, em.pos.z + Math.sin(a) * 0.5);
      eVel(0, 2.4 + sys.rnd() * 2.4, 0);
      E.life = 0.7 + sys.rnd() * 0.6;
      eSize(0.12, 0.02);
      E.a = 0.9; E.fadeIn = 0.15;
      eCol(C.white, C.healGold);
      sys.push('glow');
    }
    if (em.light) em.light.intensity = 4.4 * env;
  },
});

fx('loot.sparkle', {
  dur: Infinity, loop: true,
  tick(sys, em, dt) {
    em.acc += dt * 6 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = sys.rnd() * 0.18;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 0.16, em.pos.z + Math.sin(a) * r);
      eVel(0, 0.35 + sys.rnd() * 0.35, 0);
      E.life = 0.7 + sys.rnd() * 0.5;
      eSize(0.075, 0.01);
      E.a = 0.95; E.fadeIn = 0.25;
      eCol(C.white, C.gold);
      sys.push('glow');
    }
    const pulse = 0.6 + 0.4 * Math.sin(sys.time * 2.6 + em.seed);
    sys.orb(em.pos.x, em.pos.y + 0.06, em.pos.z, 0.34 * pulse, C.gold, 0.35 * pulse * em.fade, 0);
  },
});

fx('portal.swirl', {
  dur: Infinity, loop: true,
  tick(sys, em, dt) {
    const s = Math.max(0.8, em.scale);
    const col = em.hasColor ? em.col : C.arcane;
    sys.ring(em.pos.x, em.pos.y + 0.05, em.pos.z, 1.1 * s, col, 0.75 * em.fade, sys.time * 1.4);
    sys.ring(em.pos.x, em.pos.y + 0.08, em.pos.z, 0.68 * s, C.white, 0.4 * em.fade, -sys.time * 2.2);
    sys.aura(em.pos.x, em.pos.y + 0.9 * s, em.pos.z, 0.75 * s, col, 0.24 * em.fade);
    em.acc += dt * 26 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = (0.9 + sys.rnd() * 0.5) * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 0.25, em.pos.z + Math.sin(a) * r);
      // spiral inward and up
      eVel(-Math.cos(a) * 1.5 - Math.sin(a) * 1.5, 1.1 + sys.rnd() * 0.9, -Math.sin(a) * 1.5 + Math.cos(a) * 1.5);
      E.life = 0.8 + sys.rnd() * 0.5;
      eSize(0.13 * s, 0.015);
      E.drag = 0.8; E.a = 0.9; E.fadeIn = 0.2;
      eCol(C.white, col);
      sys.push('glow');
    }
  },
});

function teleportInit(sys, em, outward) {
  const s = Math.max(0.7, em.scale);
  em.light = sys.takeLight(C.arcane, 3, 12);
  for (let i = 0, n = sys.count(46); i < n; i++) {
    const a = sys.rnd() * TAU;
    const r = outward ? sys.rnd() * 0.3 * s : (1.2 + sys.rnd() * 0.6) * s;
    eReset();
    eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 1.9 * s, em.pos.z + Math.sin(a) * r);
    const sp = outward ? 3.4 : -3.4;
    eVel(Math.cos(a) * sp, outward ? 1.6 + sys.rnd() * 2 : 2.6 + sys.rnd() * 2.4, Math.sin(a) * sp);
    E.life = 0.5 + sys.rnd() * 0.4;
    eSize(0.15 * s, 0.02);
    E.drag = 1.5; E.a = 0.95; E.fadeIn = 0.12;
    eCol(C.white, C.arcane);
    sys.push('glow');
  }
}

fx('teleport.out', {
  dur: 0.85,
  init(sys, em) { teleportInit(sys, em, false); },
  tick(sys, em) {
    const t = em.age / em.duration;
    const s = Math.max(0.7, em.scale);
    const env = Math.min(1, (1 - t) * 2.6);
    sys.orb(em.pos.x, em.pos.y + 0.9 * s, em.pos.z, 1.2 * s * (1 - t * 0.7), C.arcane, env * 0.8, 0);
    sys.ring(em.pos.x, em.pos.y + 0.05, em.pos.z, 1.4 * s * (1 - t * 0.8), C.arcane, env * 0.8, sys.time * 3);
    if (em.light) em.light.intensity = 3 * env;
  },
});

fx('teleport.in', {
  dur: 0.85,
  init(sys, em) { teleportInit(sys, em, true); },
  tick(sys, em) {
    const t = em.age / em.duration;
    const s = Math.max(0.7, em.scale);
    const env = Math.min(1, (1 - t) * 2.2);
    sys.orb(em.pos.x, em.pos.y + 0.9 * s, em.pos.z, 1.2 * s * (0.4 + t), C.arcane, env * 0.8, 0);
    sys.ringPulse(em, t / 0.7, 2.8 * s, C.arcane, 0.85);
    if (em.light) em.light.intensity = 3 * env;
  },
});

fx('death.dissolve', {
  dur: 1.6,
  init(sys, em) {
    const s = Math.max(0.6, em.scale);
    for (let i = 0, n = sys.count(40 * Math.min(2, s)); i < n; i++) {
      const a = sys.rnd() * TAU, r = Math.sqrt(sys.rnd()) * 0.45 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 1.5 * s, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.35), 0.5 + sys.rnd() * 1.1, sys.sym(0.35));
      E.life = 0.9 + sys.rnd() * 0.8;
      eSize(0.22 * s, 0.55 * s);
      E.grav = 0.3; E.drag = 0.9; E.a = 0.35; E.fadeIn = 0.15;
      E.rot = sys.rnd() * TAU; E.rotV = sys.sym(0.8);
      E.turb = 0.7; E.turbF = 1.7;
      eCol(C.smokeGrey, C.smokeDark);
      sys.push('smoke');
    }
    for (let i = 0, n = sys.count(16 * Math.min(2, s)); i < n; i++) {
      const a = sys.rnd() * TAU, r = sys.rnd() * 0.4 * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + sys.rnd() * 1.3 * s, em.pos.z + Math.sin(a) * r);
      eVel(sys.sym(0.2), 0.9 + sys.rnd() * 1.2, sys.sym(0.2));
      E.life = 1.0 + sys.rnd() * 0.8;
      eSize(0.08 * s, 0.012);
      E.drag = 0.6; E.a = 0.8; E.fadeIn = 0.2;
      eCol(C.ember, C.fireDim);
      sys.push('ember');
    }
  },
});

fx('boss.aura', {
  dur: Infinity, loop: true,
  tick(sys, em, dt) {
    const s = Math.max(1, em.scale);
    const col = em.hasColor ? em.col : C.hell;
    const pulse = 0.68 + 0.32 * Math.sin(sys.time * 1.7 + em.seed);
    sys.aura(em.pos.x, em.pos.y + 1.05 * s, em.pos.z, 1.25 * s * (0.97 + 0.03 * pulse),
      col, 0.32 * pulse * em.fade);
    sys.ring(em.pos.x, em.pos.y + 0.05, em.pos.z, 1.5 * s, col, 0.5 * pulse * em.fade, sys.time * 0.7);
    em.acc += dt * 16 * sys.density * em.fade;
    while (em.acc >= 1) {
      em.acc -= 1;
      const a = sys.rnd() * TAU, r = (0.6 + sys.rnd() * 0.8) * s;
      eReset();
      eAt(em.pos.x + Math.cos(a) * r, em.pos.y + 0.05, em.pos.z + Math.sin(a) * r);
      eVel(-Math.sin(a) * 0.5, 1.3 + sys.rnd() * 1.4, Math.cos(a) * 0.5);
      E.life = 1.0 + sys.rnd() * 0.7;
      eSize(0.16 * s, 0.03);
      E.drag = 0.5; E.a = 0.75; E.fadeIn = 0.2;
      eCol(col, C.hellDark);
      sys.push('ember');
    }
  },
});

/* ========================================================================== *
 * 8. FxSystem
 * ========================================================================== */

const EMITTER_POOL = 192;
const LIGHTS_BY_QUALITY = { low: 0, med: 1, high: 2, ultra: 3 };

const BANK_CAPS = {
  glow: 900,
  spark: 760,
  ember: 1500,
  smoke: 760,
  soft: 520,
};

export class FxSystem {
  /** @param {object} ctx shared services — see CONTRACTS §0.1 */
  constructor(ctx) {
    this.ctx = ctx || {};
    this.engine = this.ctx.engine || null;
    this.scene = this.engine ? this.engine.scene : new THREE.Scene();
    this.quality = this.ctx.quality || (this.engine && this.engine.quality) || 'high';
    const preset = (this.engine && this.engine.preset) || QUALITY_PRESETS[this.quality] || QUALITY_PRESETS.high;
    // Ultra spends its headroom on a third local light and denser world
    // geometry; particle banks cap at the already-rich High emission density.
    // This also keeps pooled attribute ranges inside the reliable ANGLE budget.
    this.density = Math.min(1, preset.particles || 1);
    this.time = 0;
    this._disposed = false;
    this._warned = new Set();

    // Our own stream: ctx.rng is re-seeded per map for deterministic world gen
    // and must not be perturbed by cosmetic randomness.
    this._rng = makeRng(0x51F7);

    this.group = new THREE.Group();
    this.group.name = 'fx';
    this.scene.add(this.group);

    const forge = this.ctx.forge;
    const tex = (kind, size) => {
      if (!forge || typeof forge.pbr !== 'function') return null;
      try {
        // a private opts hash keeps these out of the shared material cache
        // entries, so nobody else can retune wrap/repeat underneath us
        return forge.pbr(kind, { size, fxOwner: 1 }).map || null;
      } catch (e) {
        console.warn(`[fx] texture '${kind}' unavailable`, e);
        return null;
      }
    };
    const tGlow = tex('glow.radial', 128);
    const tSpark = tex('spark', 128);
    const tEmber = tex('ember', 128);
    const tSmoke = tex('smoke.puff', 256);

    const q = (n) => Math.max(48, Math.round(n * this.density));
    this.banks = {
      glow: new PointBank(tGlow, THREE.AdditiveBlending, q(BANK_CAPS.glow)),
      spark: new PointBank(tSpark, THREE.AdditiveBlending, q(BANK_CAPS.spark)),
      ember: new PointBank(tEmber, THREE.AdditiveBlending, q(BANK_CAPS.ember)),
      smoke: new PointBank(tSmoke, THREE.NormalBlending, q(BANK_CAPS.smoke)),
      soft: new PointBank(tGlow, THREE.NormalBlending, q(BANK_CAPS.soft)),
    };
    this._bankList = [this.banks.glow, this.banks.spark, this.banks.ember, this.banks.smoke, this.banks.soft];
    for (const b of this._bankList) this.group.add(b.points);

    this.ribbons = new RibbonBank();
    this.group.add(this.ribbons.mesh);

    // instanced banks
    const orbGeo = new THREE.PlaneGeometry(1, 1);
    this.orbs = new InstBank(orbGeo, new THREE.ShaderMaterial({
      name: 'fx.orb',
      uniforms: { uMap: { value: tGlow } },
      vertexShader: ORB_VERT,
      fragmentShader: ORB_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true, depthTest: true, depthWrite: false,
    }), 64);

    const ringGeo = new THREE.RingGeometry(0.5, 1, 64, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new InstBank(ringGeo, new THREE.ShaderMaterial({
      name: 'fx.ring',
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true, depthTest: true, depthWrite: false,
      side: THREE.DoubleSide, forceSinglePass: true,
    }), 32);

    // detail 2 shows a visibly polygonal silhouette on a shield-sized shell
    const auraGeo = new THREE.IcosahedronGeometry(1, this.quality === 'low' ? 2 : 3);
    this.auras = new InstBank(auraGeo, new THREE.ShaderMaterial({
      name: 'fx.aura',
      vertexShader: AURA_VERT,
      fragmentShader: AURA_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true, depthTest: true, depthWrite: false,
      side: THREE.DoubleSide, forceSinglePass: true,
    }), 12);

    this._instList = [this.orbs, this.rings, this.auras];
    for (const i of this._instList) this.group.add(i.mesh);

    // emitters
    this._pool = new Array(EMITTER_POOL);
    this._free = new Int32Array(EMITTER_POOL);
    this._nFree = EMITTER_POOL;
    for (let i = 0; i < EMITTER_POOL; i++) {
      this._pool[i] = new Emitter(i);
      this._free[i] = EMITTER_POOL - 1 - i;
    }
    this._active = [];

    // dynamic lights. Kept permanently in the scene with intensity 0 when idle:
    // toggling `visible` would change the light count and force every material
    // in the game to recompile mid-fight.
    this._lights = [];
    const nLights = LIGHTS_BY_QUALITY[this.quality] !== undefined
      ? LIGHTS_BY_QUALITY[this.quality] : 2;
    for (let i = 0; i < nLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 2);
      l.castShadow = false;
      l.userData.fxBusy = false;
      this.group.add(l);
      this._lights.push(l);
    }
  }

  /* ------------------------------------------------------------ tiny helpers */

  rnd() { return this._rng(); }
  /** Symmetric random in [-a, a). */
  sym(a) { return (this._rng() * 2 - 1) * a; }
  /** Scale a burst count by the quality preset, never below 1. */
  count(n) { const v = Math.round(n * this.density); return v < 1 ? 1 : v; }
  /** Probabilistic gate for sub-frame emission rates. */
  roll(p) { return this._rng() < p; }

  push(bank) {
    const b = this.banks[bank];
    if (b) b.emit();
  }

  /** Camera-facing additive quad. */
  orb(x, y, z, size, colour, opacity, rot) {
    this.orbs.push(x, y, z, size, size, size, null, colour, opacity, rot || 0);
  }

  /** Flat ground ring of the given outer radius. */
  ring(x, y, z, radius, colour, opacity, rot) {
    this.rings.push(x, y, z, radius, radius, radius, null, colour, opacity, rot || 0);
  }

  /** Fresnel shell. */
  aura(x, y, z, radius, colour, opacity) {
    this.auras.push(x, y, z, radius, radius, radius, null, colour, opacity, 0);
  }

  /** One-shot expanding ring keyed off a 0..1 progress value. */
  ringPulse(em, k, maxRadius, colour, strength) {
    if (k < 0 || k >= 1) return;
    const e = 1 - (1 - k) * (1 - k) * (1 - k);   // ease-out cubic
    this.ring(em.pos.x, em.pos.y + 0.06, em.pos.z, 0.25 + e * maxRadius,
      colour, (1 - k) * (1 - k) * strength, 0);
  }

  takeLight(colour, intensity, distance) {
    for (let i = 0; i < this._lights.length; i++) {
      const l = this._lights[i];
      if (l.userData.fxBusy) continue;
      l.userData.fxBusy = true;
      l.color.copy(colour);
      l.intensity = intensity;
      l.distance = distance;
      return l;
    }
    return null;
  }

  _releaseLight(l) {
    if (!l) return;
    l.userData.fxBusy = false;
    l.intensity = 0;
  }

  /* ------------------------------------------------------------------ spawn */

  /**
   * @param {string} name
   * @param {THREE.Vector3} pos
   * @param {{dir?:THREE.Vector3, scale?:number, color?:number, target?:THREE.Vector3,
   *          duration?:number, onDone?:Function, parent?:THREE.Object3D}} [opts]
   * @returns {{stop():void, setPosition(v:THREE.Vector3):void, alive:boolean}}
   */
  spawn(name, pos, opts = {}) {
    if (this._disposed) return DEAD_HANDLE;
    const def = EFFECTS[name];
    if (!def) {
      if (!this._warned.has(name)) {
        this._warned.add(name);
        console.warn(`[fx] unknown effect '${name}'`);
      }
      return DEAD_HANDLE;
    }
    if (this._nFree === 0) return DEAD_HANDLE;

    const em = this._pool[this._free[--this._nFree]];
    em.name = name;
    em.def = def;
    em.alive = true;
    em.stopping = false;
    em.age = 0;
    em.acc = 0;
    em.acc2 = 0;
    em.a = em.b = em.c = em.d = 0;
    em.ribbon = -1;
    em.light = null;
    em.fade = 1;
    em.fadeT = 0;
    em.seed = this._rng() * 100;
    em.onDone = typeof opts.onDone === 'function' ? opts.onDone : null;
    em.parent = opts.parent && opts.parent.isObject3D ? opts.parent : null;
    em.scale = (typeof opts.scale === 'number' && isFinite(opts.scale) && opts.scale > 0) ? opts.scale : 1;
    em.loop = def.loop;

    // `duration` only means anything for effects that animate over time. An
    // init-only burst has already emitted everything it will ever emit, so a
    // caller-supplied 70s buff duration would just pin an emitter for nothing.
    let dur = def.dur;
    if (typeof opts.duration === 'number' && isFinite(opts.duration) && opts.duration > 0
      && !def.loop && def.tick !== noop3) {
      dur = Math.max(opts.duration, 0.05);
    }
    em.duration = dur;

    if (pos) em.pos.set(pos.x, pos.y, pos.z);
    else em.pos.set(0, 0, 0);
    em.prev.copy(em.pos);

    if (opts.dir && (opts.dir.x || opts.dir.y || opts.dir.z)) {
      em.dir.set(opts.dir.x, 0, opts.dir.z);
      if (em.dir.lengthSq() < 1e-6) em.dir.set(opts.dir.x, opts.dir.y, opts.dir.z);
      em.dir.normalize();
    } else if (opts.target) {
      em.dir.set(opts.target.x - em.pos.x, 0, opts.target.z - em.pos.z);
      if (em.dir.lengthSq() < 1e-6) em.dir.set(0, 0, 1); else em.dir.normalize();
    } else {
      const a = this._rng() * TAU;
      em.dir.set(Math.sin(a), 0, Math.cos(a));
    }

    if (typeof opts.color === 'number' && isFinite(opts.color)) {
      em.col.setHex(opts.color >>> 0, THREE.SRGBColorSpace);
      em.hasColor = true;
    } else {
      em.col.setRGB(1, 1, 1);
      em.hasColor = false;
    }

    this._active.push(em);
    try {
      def.init(this, em);
    } catch (e) {
      console.error(`[fx] init '${name}' failed`, e);
    }
    return new FxHandle(this, em);
  }

  _stopEmitter(em) {
    if (!em.alive || em.stopping) return;
    em.stopping = true;
    em.fadeT = 0;
  }

  _release(em) {
    if (em.ribbon >= 0) { this.ribbons.free(em.ribbon); em.ribbon = -1; }
    if (em.light) { this._releaseLight(em.light); em.light = null; }
    em.alive = false;
    em.stopping = false;
    em.parent = null;
    em.def = null;
    em.gen++;
    const cb = em.onDone;
    em.onDone = null;
    if (this._nFree < EMITTER_POOL) this._free[this._nFree++] = em.idx;
    if (cb) { try { cb(); } catch (e) { console.error('[fx] onDone failed', e); } }
  }

  /* ------------------------------------------------------------------ frame */

  update(dt, camera) {
    if (this._disposed) return;
    const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    this.time += d;
    if (this.time > 100000) this.time -= 100000;

    // indexed loops throughout: a for..of iterator is an allocation per frame
    const inst = this._instList, banks = this._bankList;
    for (let k = 0; k < inst.length; k++) inst[k].begin();

    const list = this._active;
    // iterate backwards and swap-remove: no splice, so no per-frame array churn
    for (let i = list.length - 1; i >= 0; i--) {
      const em = list[i];
      if (!em.alive) { list[i] = list[list.length - 1]; list.pop(); continue; }

      if (em.parent) {
        if (!em.parent.parent) { this._stopEmitter(em); }
        else em.pos.setFromMatrixPosition(em.parent.matrixWorld);
      }

      em.age += d;

      if (em.stopping) {
        em.fadeT += d;
        em.fade = Math.max(0, 1 - em.fadeT / 0.28);
      }

      try {
        em.def.tick(this, em, d);
      } catch (e) {
        console.error(`[fx] tick '${em.name}' failed`, e);
        em.stopping = true;
        em.fadeT = 1;
      }

      const done = (em.stopping && em.fadeT >= 0.28) || (!em.loop && em.age >= em.duration);
      if (done) {
        this._release(em);
        list[i] = list[list.length - 1];
        list.pop();
      }
    }

    for (let k = 0; k < banks.length; k++) banks[k].update(d, this.time);
    this.ribbons.flush();
    for (let k = 0; k < inst.length; k++) inst[k].end();

    this._updatePointScale(camera);
  }

  _updatePointScale(camera) {
    const cam = camera || (this.engine && this.engine.camera);
    let scale = 400;
    if (cam && cam.isPerspectiveCamera && this.engine && this.engine.renderer) {
      this.engine.renderer.getDrawingBufferSize(_dbSize);
      scale = _dbSize.y * 0.5 * cam.projectionMatrix.elements[5];
    }
    for (let i = 0; i < this._bankList.length; i++) {
      this._bankList[i].material.uniforms.uScale.value = scale;
    }
  }

  /* --------------------------------------------------------------- teardown */

  /** Kill everything without tearing the system down (used on map change). */
  clear() {
    // detach first: an onDone callback is allowed to spawn, and anything it
    // spawns must survive into the fresh list rather than be silently orphaned
    const list = this._active;
    this._active = [];
    for (let i = list.length - 1; i >= 0; i--) this._release(list[i]);
    for (const b of this._bankList) b.clear();
    this.ribbons.clear();
    for (const b of this._instList) { b.begin(); b.end(); }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.clear();
    for (const l of this._lights) {
      this.group.remove(l);
      l.dispose?.();
    }
    this._lights.length = 0;
    for (const b of this._bankList) { this.group.remove(b.points); b.dispose(); }
    for (const b of this._instList) { this.group.remove(b.mesh); b.dispose(); }
    this.group.remove(this.ribbons.mesh);
    this.ribbons.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this._bankList.length = 0;
    this._instList.length = 0;
    this._pool.length = 0;
    this._warned.clear();
    // Sprite textures belong to TextureForge's cache and are shared with other
    // subsystems — TextureForge.dispose() frees them, not us.
  }
}

export default FxSystem;
