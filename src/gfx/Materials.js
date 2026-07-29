/**
 * gfx/Materials.js — the material library (CONTRACTS §2).
 *
 * Every surface in the world asks this module for its material. TextureForge
 * supplies the pixels; this module supplies the *physics*: metalness, roughness,
 * sheen, clearcoat, transmission, IOR and emissive weighting. That split matters
 * because in a PBR renderer the physical parameters carry more of the "this is
 * bronze / this is silk / this is lava" read than the albedo ever does.
 *
 * Design notes
 * ------------
 * - Materials are cached by (name + overrides). Two callers asking for `iron`
 *   share one material and therefore one shader program.
 * - The forge is treated as *untrusted*: it is being written in parallel and a
 *   missing `kind` must degrade (solid tinted PBR) rather than throw. Every
 *   texture fetch is wrapped and every returned slot is type-checked.
 * - `lava`, `water` and `rune` are animated through onBeforeCompile-injected
 *   uniforms. The uniform objects are created once, stored on
 *   `material.userData.uniforms`, and merely written to in update() — no
 *   per-frame allocation anywhere in this file.
 * - Textures produced by the forge are owned by the forge and are NOT disposed
 *   here (Game disposes the forge separately). Only textures this module
 *   creates itself are tracked in `_owned` and freed by dispose().
 */

import * as THREE from 'three';

const QUALITIES = ['low', 'med', 'high', 'ultra'];

/** Base albedo resolution per quality tier; per-material `sizeMul` scales it. */
const SIZE_BASE = { low: 256, med: 512, high: 1024, ultra: 1024 };

/** Keys in `overrides` that steer texture *generation* instead of the material. */
const FORGE_OPT_KEYS = ['size', 'repeat', 'tint', 'seed', 'normalStrength', 'detail', 'variant'];

/** Colour-valued material properties, so overrides can pass hex numbers. */
const COLOR_PROPS = new Set([
  'color', 'emissive', 'sheenColor', 'specularColor', 'attenuationColor',
]);

/** Overrides that change shader defines and therefore need a recompile flag. */
const DEFINE_PROPS = new Set([
  'flatShading', 'vertexColors', 'transparent', 'alphaTest', 'fog', 'side',
  'wireframe', 'toneMapped', 'depthWrite', 'depthTest', 'blending',
]);

const SIDE = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide };

// ---------------------------------------------------------------------------
// Shared GLSL: a tiny tileable value-noise fbm. Used by the animated lava and
// rune materials so they still animate convincingly when the forge gives us
// nothing at all.
// ---------------------------------------------------------------------------
const NOISE_GLSL = /* glsl */`
float mirHash( vec2 p ) {
	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float mirNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = mirHash( i );
	float b = mirHash( i + vec2( 1.0, 0.0 ) );
	float c = mirHash( i + vec2( 0.0, 1.0 ) );
	float d = mirHash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float mirFbm( vec2 p ) {
	float v = 0.0;
	float a = 0.5;
	for ( int i = 0; i < 4; i ++ ) {
		v += a * mirNoise( p );
		p *= 2.03;
		a *= 0.5;
	}
	return v;
}
`;

// ---------------------------------------------------------------------------
// The definition table. `kind` is a TextureForge kind; everything else is the
// physical description of the surface.
//
//   rough / metal      base scalars (a roughnessMap modulates `rough`)
//   sizeMul            multiplier on the quality-tier texture resolution
//   repeat             default UV repeat, also handed to the forge as an opt
//   tint               forge tint for generic kinds (cloth.linen -> red banner)
//   mapColor           material.color when an albedo map *is* present
//   color              material.color when the forge gave us nothing
//   physical           force MeshPhysicalMaterial (sheen/clearcoat/transmission)
// ---------------------------------------------------------------------------
const DEFS = {

  // ---- vegetation & terrain dressing ------------------------------------
  bark: {
    kind: 'bark.oak', color: 0x6d5a44, rough: 0.95, metal: 0,
    repeat: [1, 2], sizeMul: 0.5, normalScale: 1.35, aoIntensity: 1.0,
  },
  leaf: {
    kind: 'leaf.broad', color: 0x3f6b2b, rough: 0.8, metal: 0,
    sizeMul: 0.5, side: 'double', alphaTest: 0.42, physical: true,
    sheen: 0.3, sheenRoughness: 0.55, sheenColor: 0x9ec36b, normalScale: 0.8,
  },
  'leaf.pine': {
    kind: 'leaf.pine', color: 0x2b4a26, rough: 0.86, metal: 0,
    sizeMul: 0.5, side: 'double', alphaTest: 0.45, normalScale: 0.7,
  },
  bush: {
    kind: 'bush', color: 0x3a5a2c, rough: 0.87, metal: 0,
    sizeMul: 0.5, side: 'double', alphaTest: 0.4, normalScale: 0.8,
  },
  rock: {
    kind: 'rock', color: 0x77716a, rough: 0.92, metal: 0,
    repeat: [1, 1], sizeMul: 0.75, normalScale: 1.25,
  },
  cliff: {
    kind: 'cliff', color: 0x6b6560, rough: 0.95, metal: 0,
    repeat: [2, 2], sizeMul: 1, normalScale: 1.6,
  },
  gravel: {
    kind: 'gravel', color: 0x7a736a, rough: 0.96, metal: 0,
    repeat: [3, 3], sizeMul: 0.75, normalScale: 1.1,
  },

  // ---- built environment -------------------------------------------------
  plank: {
    kind: 'plank', color: 0x8a6a45, rough: 0.85, metal: 0,
    repeat: [1, 1], sizeMul: 0.75, normalScale: 1.0,
  },
  'plank.worn': {
    kind: 'plank.worn', color: 0x6f5941, rough: 0.94, metal: 0,
    repeat: [1, 1], sizeMul: 0.75, normalScale: 1.2,
  },
  torchWood: {
    kind: 'bark.pine', color: 0x4d3a28, rough: 0.93, metal: 0,
    repeat: [1, 2], sizeMul: 0.35, normalScale: 1.1,
  },
  brick: {
    kind: 'brick', color: 0x8a5a46, rough: 0.9, metal: 0,
    repeat: [2, 2], sizeMul: 1, normalScale: 1.5, aoIntensity: 1.1,
  },
  stoneWall: {
    kind: 'stone.wall', color: 0x7c7568, rough: 0.93, metal: 0,
    repeat: [2, 2], sizeMul: 1, normalScale: 1.55, aoIntensity: 1.15,
  },
  templeWall: {
    kind: 'temple.wall', color: 0x8b7f66, rough: 0.88, metal: 0,
    repeat: [2, 2], sizeMul: 1, normalScale: 1.4, aoIntensity: 1.1,
  },
  roofTile: {
    kind: 'roof.tile', color: 0x4a4048, rough: 0.72, metal: 0,
    repeat: [3, 3], sizeMul: 0.75, normalScale: 1.5, physical: true,
    clearcoat: 0.18, clearcoatRoughness: 0.55,
  },
  thatch: {
    kind: 'roof.thatch', color: 0x9c8348, rough: 0.98, metal: 0,
    repeat: [3, 3], sizeMul: 0.75, normalScale: 1.7,
  },
  plaster: {
    kind: 'plaster', color: 0xcabfa6, rough: 0.94, metal: 0,
    repeat: [2, 2], sizeMul: 0.75, normalScale: 0.7,
  },
  paperScreen: {
    kind: 'paper.screen', color: 0xe6dcc0, rough: 0.9, metal: 0,
    repeat: [1, 1], sizeMul: 0.5, side: 'double', physical: true,
    transmission: 0.42, thickness: 0.03, ior: 1.35, normalScale: 0.45,
    fallbackOpacity: 0.88,
  },
  parchment: {
    kind: 'parchment', color: 0xd8c9a2, rough: 0.92, metal: 0,
    sizeMul: 0.5, side: 'double', normalScale: 0.5,
  },

  // ---- metals: metalness 1, no diffuse, roughness low but *varied* -------
  iron: {
    kind: 'iron', color: 0xb7bdc4, rough: 0.42, metal: 1,
    sizeMul: 0.5, normalScale: 0.85, envBoost: 1.15,
  },
  ironRusted: {
    // Rust is a dielectric crust over metal: pull metalness down, roughness up.
    kind: 'iron.rusted', color: 0x8d5c3b, rough: 0.86, metal: 0.62,
    sizeMul: 0.5, normalScale: 1.35, envBoost: 0.8,
  },
  steel: {
    kind: 'steel', color: 0xdae0e8, rough: 0.26, metal: 1,
    sizeMul: 0.5, normalScale: 0.7, envBoost: 1.3,
  },
  bronze: {
    kind: 'bronze', color: 0xc98a45, rough: 0.38, metal: 1,
    sizeMul: 0.5, normalScale: 0.95, envBoost: 1.15,
  },
  gold: {
    kind: 'gold', color: 0xffd35e, rough: 0.2, metal: 1,
    sizeMul: 0.5, normalScale: 0.6, envBoost: 1.45,
  },

  // ---- cloth: metalness 0, roughness ~0.9, sheen on the fine weaves ------
  clothRed: {
    kind: 'cloth.linen', tint: 0x8f2320, color: 0x8f2320, rough: 0.9, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.35, sheenRoughness: 0.85, sheenColor: 0xd06a58,
    normalScale: 0.9,
  },
  clothBlue: {
    kind: 'robe.blue', color: 0x2b3f7a, rough: 0.9, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.35, sheenRoughness: 0.85, sheenColor: 0x7f9ada,
    normalScale: 0.9,
  },
  clothWhite: {
    kind: 'robe.white', color: 0xdcd6c6, rough: 0.9, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.4, sheenRoughness: 0.82, sheenColor: 0xfffaf0,
    normalScale: 0.9,
  },
  silk: {
    // Silk is the sheen material: near-mirror grazing lobe, tight roughness.
    kind: 'cloth.silk', color: 0xb8a05c, rough: 0.42, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 1.0, sheenRoughness: 0.22, sheenColor: 0xfff0c8,
    specularIntensity: 0.75, normalScale: 0.55,
  },
  sackcloth: {
    kind: 'sackcloth', color: 0xa08b62, rough: 0.98, metal: 0,
    sizeMul: 0.5, normalScale: 1.4,
  },
  banner: {
    kind: 'cloth.linen', tint: 0x7d1f1c, color: 0x7d1f1c, rough: 0.88, metal: 0,
    sizeMul: 0.5, side: 'double', physical: true,
    sheen: 0.45, sheenRoughness: 0.7, sheenColor: 0xe08a70, normalScale: 0.8,
  },

  // ---- leather & shells: clearcoat sheen ---------------------------------
  leather: {
    kind: 'leather', color: 0x5a3a24, rough: 0.72, metal: 0,
    sizeMul: 0.5, physical: true, clearcoat: 0.42, clearcoatRoughness: 0.42,
    normalScale: 1.15,
  },
  leatherStudded: {
    kind: 'leather.studded', color: 0x4e3220, rough: 0.7, metal: 0,
    sizeMul: 0.5, physical: true, clearcoat: 0.45, clearcoatRoughness: 0.38,
    normalScale: 1.5,
  },
  hide: {
    kind: 'hide', color: 0x6b533a, rough: 0.85, metal: 0,
    sizeMul: 0.5, physical: true, clearcoat: 0.18, clearcoatRoughness: 0.6,
    normalScale: 1.1,
  },
  chitin: {
    kind: 'chitin', color: 0x3b2f3d, rough: 0.34, metal: 0.15,
    sizeMul: 0.5, physical: true, clearcoat: 0.85, clearcoatRoughness: 0.16,
    iridescence: 0.35, iridescenceIOR: 1.4, normalScale: 1.2, envBoost: 1.1,
  },
  scaleGreen: {
    kind: 'scale.green', color: 0x2f5c33, rough: 0.44, metal: 0.08,
    sizeMul: 0.5, physical: true, clearcoat: 0.55, clearcoatRoughness: 0.3,
    normalScale: 1.35, envBoost: 1.05,
  },
  scaleRed: {
    kind: 'scale.red', color: 0x76251f, rough: 0.42, metal: 0.1,
    sizeMul: 0.5, physical: true, clearcoat: 0.6, clearcoatRoughness: 0.28,
    normalScale: 1.35, envBoost: 1.05,
  },

  // ---- creature surfaces --------------------------------------------------
  bone: {
    kind: 'bone', color: 0xd9d0b4, rough: 0.62, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.2, sheenRoughness: 0.5, sheenColor: 0xfff4dd,
    normalScale: 1.05,
  },
  flesh: {
    kind: 'flesh', color: 0xa8564c, rough: 0.68, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.45, sheenRoughness: 0.42, sheenColor: 0xff9d86,
    normalScale: 1.0,
  },
  furBrown: {
    kind: 'fur.brown', color: 0x6b4b2e, rough: 0.93, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.5, sheenRoughness: 0.75, sheenColor: 0xc79a63,
    normalScale: 1.45,
  },
  furGrey: {
    kind: 'fur.grey', color: 0x74716c, rough: 0.93, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.5, sheenRoughness: 0.75, sheenColor: 0xc3c0bb,
    normalScale: 1.45,
  },
  furWhite: {
    kind: 'fur.white', color: 0xd7d3c8, rough: 0.92, metal: 0,
    sizeMul: 0.5, physical: true, sheen: 0.55, sheenRoughness: 0.72, sheenColor: 0xfffdf5,
    normalScale: 1.45,
  },

  // ---- skin: cheap fake subsurface = warm sheen + lowish roughness -------
  // We deliberately take only the *normal* and *roughness* slots from the
  // forge's `flesh` kind so the (bloody) albedo never leaks onto a face.
  'skin.pale': {
    kind: 'flesh', color: 0xe7c2a3, rough: 0.55, metal: 0, mapColor: 0xe7c2a3,
    sizeMul: 0.35, physical: true, useSlots: ['normalMap', 'roughnessMap'],
    sheen: 0.55, sheenRoughness: 0.4, sheenColor: 0xff9f7d, specularIntensity: 0.55,
    normalScale: 0.5,
  },
  'skin.tan': {
    kind: 'flesh', color: 0xc38a5c, rough: 0.54, metal: 0, mapColor: 0xc38a5c,
    sizeMul: 0.35, physical: true, useSlots: ['normalMap', 'roughnessMap'],
    sheen: 0.55, sheenRoughness: 0.4, sheenColor: 0xf08d5c, specularIntensity: 0.55,
    normalScale: 0.5,
  },
  'skin.grey': {
    kind: 'flesh', color: 0x94a09a, rough: 0.62, metal: 0, mapColor: 0x94a09a,
    sizeMul: 0.35, physical: true, useSlots: ['normalMap', 'roughnessMap'],
    sheen: 0.4, sheenRoughness: 0.5, sheenColor: 0xa8c0b6, specularIntensity: 0.45,
    normalScale: 0.55,
  },
};

/**
 * Bloom in PostFX thresholds at ~0.85. Emissive materials are tuned to land
 * just above it so they bloom without blowing out in daylight.
 */
const BLOOM_THRESHOLD = 0.85;

export class MaterialLibrary {
  /**
   * @param {import('./TextureForge.js').TextureForge} forge
   * @param {{quality?:string, maxAniso?:number, envMap?:THREE.Texture|null}} [opts]
   */
  constructor(forge, { quality = 'high', maxAniso = 8, envMap = null } = {}) {
    this.forge = forge || null;
    this.quality = QUALITIES.indexOf(quality) >= 0 ? quality : 'high';
    this.maxAniso = Math.max(1, Math.floor(maxAniso) || 1);

    this._envMap = envMap || null;
    this._envIntensity = 1;

    /** name+overrides -> material */
    this._cache = new Map();
    /** kind+opts -> forge texture set (so we never hit the forge twice) */
    this._mapSets = new Map();
    /** textures this module created and must free */
    this._owned = new Set();
    /** the shared blob-shadow falloff (created lazily, owned by us) */
    this._radial = null;
    /** animated materials: { mat, u, kind, base } */
    this._animated = [];
    /** materials whose emissiveIntensity breathes */
    this._pulsing = [];

    this._elapsed = 0;
    this._missing = new Set();

    // Quality gates. Degrade the *shading model*, not the frame rate.
    const q = this.quality;
    this._allowPhysical = q !== 'low';
    this._allowTransmission = q === 'high' || q === 'ultra';
    this._allowAo = q !== 'low';
    this._allowRoughMap = q !== 'low';
    this._allowIridescence = q === 'ultra';
    this._allowClearcoat = q !== 'low';
  }

  // =========================================================================
  // public API
  // =========================================================================

  /**
   * Cached material lookup.
   * @param {string} name
   * @param {object} [overrides] material properties, plus forge opts
   *   (`size`, `repeat`, `tint`, `seed`, `normalStrength`, `detail`, `variant`).
   * @returns {THREE.Material}
   */
  get(name, overrides = {}) {
    const key = this._key(name, overrides);
    const hit = this._cache.get(key);
    if (hit) return hit;
    let mat;
    try {
      mat = this._create(name, overrides || {});
    } catch (e) {
      console.warn(`[materials] failed to build '${name}':`, e);
      mat = this._fallback(name);
    }
    this._cache.set(key, mat);
    // The cache is only bounded by the number of distinct override sets. If a
    // caller is generating per-entity tints it will grow without limit and each
    // entry is a shader program, so shout once.
    if (this._cache.size === 400) {
      console.warn('[materials] 400 cached variants — a caller is probably passing per-instance overrides; prefer instanceColor or vertexColors.');
    }
    return mat;
  }

  /** Called once per frame; animates lava/water/rune/emissive uniforms. */
  update(dt, elapsed) {
    const d = typeof dt === 'number' && isFinite(dt) ? dt : 0;
    this._elapsed = (typeof elapsed === 'number' && isFinite(elapsed))
      ? elapsed
      : this._elapsed + d;
    const t = this._elapsed;

    const anim = this._animated;
    for (let i = 0; i < anim.length; i++) {
      const a = anim[i];
      a.u.uTime.value = t;
      if (a.kind === 'lava') {
        // Slow swell + a faster crackle so the crust never feels like a loop.
        a.u.uEmissiveBoost.value = a.base *
          (0.86 + 0.14 * Math.sin(t * 0.71) + 0.06 * Math.sin(t * 3.7 + 1.3));
      } else if (a.kind === 'rune') {
        a.u.uGlow.value = a.base * (0.72 + 0.28 * Math.sin(t * 1.9 + a.phase));
      }
    }

    const pul = this._pulsing;
    for (let i = 0; i < pul.length; i++) {
      const p = pul[i];
      p.mat.emissiveIntensity = p.base * (0.93 + 0.07 * Math.sin(t * 2.3 + p.phase));
    }
  }

  /**
   * Assign the scene env map to every PBR material at once.
   * @param {THREE.Texture} envTexture
   * @param {number} [intensity]
   */
  setEnvironment(envTexture, intensity = 1) {
    this._envMap = envTexture || null;
    this._envIntensity = (typeof intensity === 'number' && isFinite(intensity)) ? intensity : 1;
    for (const mat of this._cache.values()) this._applyEnv(mat);
  }

  /** Free every material and every texture this library owns. */
  dispose() {
    for (const mat of this._cache.values()) {
      if (!mat) continue;
      // Only null out slots holding textures we own; forge textures are the
      // forge's to free.
      try { mat.dispose(); } catch (e) { /* already gone */ }
      if (mat.userData) { mat.userData.uniforms = null; }
    }
    this._cache.clear();

    for (const tex of this._owned) {
      try { tex.dispose(); } catch (e) { /* already gone */ }
    }
    this._owned.clear();
    this._radial = null;

    this._mapSets.clear();
    this._animated.length = 0;
    this._pulsing.length = 0;
    this._missing.clear();
    this.forge = null;
    this._envMap = null;
  }

  // =========================================================================
  // construction
  // =========================================================================

  _key(name, o) {
    if (!o) return name;
    const keys = Object.keys(o);
    if (keys.length === 0) return name;
    keys.sort();
    let s = name;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = o[k];
      let sv;
      if (v && v.isColor) sv = v.getHexString();
      else if (v && v.isVector2) sv = `${v.x},${v.y}`;
      else if (v && v.isTexture) sv = v.uuid;
      else if (Array.isArray(v)) sv = v.join(',');
      else sv = String(v);
      s += `|${k}=${sv}`;
    }
    return s;
  }

  _create(name, overrides) {
    switch (name) {
      case 'lava': return this._makeLava(overrides);
      case 'water': return this._makeWater(overrides);
      case 'rune': return this._makeRune(overrides);
      case 'crystal': return this._makeCrystal(overrides, 0x9fd8ff, 1.72, 0.9);
      case 'glass': return this._makeCrystal(overrides, 0xdff0f5, 1.5, 0.96);
      case 'eye.glow': return this._makeEyeGlow(overrides);
      case 'shadowBlob': return this._makeShadowBlob(overrides);
      default: break;
    }
    const def = DEFS[name];
    if (!def) return this._fallback(name);
    return this._makeStandard(name, def, overrides);
  }

  /** Unknown name: loud magenta so it is impossible to miss in-game. */
  _fallback(name) {
    if (!this._missing.has(name)) {
      this._missing.add(name);
      console.warn(`[materials] unknown material '${name}' — using magenta placeholder`);
    }
    const m = new THREE.MeshStandardMaterial({
      color: 0xff00ff, roughness: 0.6, metalness: 0, name: `missing:${name}`,
    });
    this._applyEnv(m);
    return m;
  }

  // ---- generic PBR --------------------------------------------------------

  _makeStandard(name, def, overrides) {
    const forgeOpts = this._forgeOpts(def, overrides);
    const set = this._textures(def.kind, forgeOpts, def);

    const usePhysical = !!def.physical && this._allowPhysical;
    const params = {
      name,
      color: set.map ? (def.mapColor !== undefined ? def.mapColor : 0xffffff) : def.color,
      roughness: def.rough,
      metalness: def.metal,
    };

    if (set.map) params.map = set.map;
    if (set.normalMap) {
      params.normalMap = set.normalMap;
      params.normalScale = new THREE.Vector2(def.normalScale || 1, def.normalScale || 1);
    }
    if (set.roughnessMap && this._allowRoughMap) params.roughnessMap = set.roughnessMap;
    if (set.aoMap && this._allowAo) {
      params.aoMap = set.aoMap;
      params.aoMapIntensity = def.aoIntensity !== undefined ? def.aoIntensity : 1;
    }
    if (set.metalnessMap) params.metalnessMap = set.metalnessMap;

    if (def.side) params.side = SIDE[def.side] || THREE.FrontSide;
    if (def.alphaTest) {
      params.alphaTest = def.alphaTest;
      // Alpha-tested foliage must cast a matching cut-out shadow.
      params.transparent = false;
      params.shadowSide = THREE.DoubleSide;
    }

    if (usePhysical) {
      if (def.sheen) {
        params.sheen = def.sheen;
        params.sheenRoughness = def.sheenRoughness !== undefined ? def.sheenRoughness : 0.6;
        params.sheenColor = new THREE.Color(def.sheenColor !== undefined ? def.sheenColor : 0xffffff);
      }
      if (def.clearcoat && this._allowClearcoat) {
        params.clearcoat = def.clearcoat;
        params.clearcoatRoughness = def.clearcoatRoughness !== undefined ? def.clearcoatRoughness : 0.3;
      }
      if (def.iridescence && this._allowIridescence) {
        params.iridescence = def.iridescence;
        params.iridescenceIOR = def.iridescenceIOR || 1.3;
      }
      if (def.specularIntensity !== undefined) params.specularIntensity = def.specularIntensity;
      if (def.transmission !== undefined) {
        if (this._allowTransmission) {
          params.transmission = def.transmission;
          params.thickness = def.thickness !== undefined ? def.thickness : 0.05;
          params.ior = def.ior !== undefined ? def.ior : 1.5;
        } else {
          params.transparent = true;
          params.opacity = def.fallbackOpacity !== undefined ? def.fallbackOpacity : 0.85;
        }
      }
      if (def.ior !== undefined && params.ior === undefined) params.ior = def.ior;
    } else if (def.transmission !== undefined) {
      // Physical shading unavailable at this tier: approximate with opacity.
      params.transparent = true;
      params.opacity = def.fallbackOpacity !== undefined ? def.fallbackOpacity : 0.85;
    }

    const mat = usePhysical
      ? new THREE.MeshPhysicalMaterial(params)
      : new THREE.MeshStandardMaterial(params);

    mat.envMapIntensity = def.envBoost !== undefined ? def.envBoost : 1;
    mat.userData.envBoost = mat.envMapIntensity;

    this._applyOverrides(mat, overrides);
    this._applyEnv(mat);
    return mat;
  }

  // ---- lava ---------------------------------------------------------------

  _makeLava(overrides) {
    const forgeOpts = this._forgeOpts({ repeat: [2, 2], sizeMul: 0.75 }, overrides);
    const set = this._textures('lava', forgeOpts, { kind: 'lava' });

    const mat = new THREE.MeshStandardMaterial({
      name: 'lava',
      color: set.map ? 0xffffff : 0x2a1109,
      roughness: 0.72,
      metalness: 0,
      emissive: new THREE.Color(0xff6a1e),
      emissiveIntensity: 1.0,
    });
    if (set.map) mat.map = set.map;
    if (set.normalMap) {
      mat.normalMap = set.normalMap;
      mat.normalScale.set(1.1, 1.1);
    }
    if (set.roughnessMap && this._allowRoughMap) mat.roughnessMap = set.roughnessMap;
    if (set.emissiveMap) mat.emissiveMap = set.emissiveMap;

    const base = 1.9; // comfortably over the ~0.85 bloom threshold
    const u = {
      uTime: { value: 0 },
      uFlowDir: { value: new THREE.Vector2(0.14, 0.09) },
      uFlowSpeed: { value: 0.055 },
      uLavaScale: { value: 3.2 },
      uCrust: { value: 0.46 },
      uEmissiveBoost: { value: base },
      uLavaHot: { value: new THREE.Color(0xfff2a8) },
      uLavaMid: { value: new THREE.Color(0xff5a12) },
    };

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMirUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMirUv = uv;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vMirUv;
uniform float uTime;
uniform vec2 uFlowDir;
uniform float uFlowSpeed;
uniform float uLavaScale;
uniform float uCrust;
uniform float uEmissiveBoost;
uniform vec3 uLavaHot;
uniform vec3 uLavaMid;
${NOISE_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		vec2 mirFlow = uFlowDir * uTime * uFlowSpeed;
		float n1 = mirFbm( vMirUv * uLavaScale + mirFlow );
		float n2 = mirFbm( vMirUv * uLavaScale * 1.93 - mirFlow * 0.63 + n1 * 0.45 );
		float mirField = n1 * 0.62 + n2 * 0.38;
		float crust = smoothstep( uCrust - 0.13, uCrust + 0.13, mirField );
		float heat = 1.0 - crust;
		vec3 hot = mix( uLavaMid, uLavaHot, smoothstep( 0.55, 1.0, heat ) );
		totalEmissiveRadiance = mix( hot * uEmissiveBoost, totalEmissiveRadiance * 0.06, crust );
		diffuseColor.rgb = mix( diffuseColor.rgb * 0.28, diffuseColor.rgb, crust );
		roughnessFactor = mix( 0.3, roughnessFactor, crust );
	}`);
    };
    mat.customProgramCacheKey = () => 'mir-lava';

    mat.userData.uniforms = u;
    this._animated.push({ mat, u, kind: 'lava', base, phase: 0 });

    this._applyOverrides(mat, overrides);
    this._applyEnv(mat);
    return mat;
  }

  // ---- water --------------------------------------------------------------

  _makeWater(overrides) {
    const optsA = this._forgeOpts({ repeat: [8, 8], sizeMul: 0.5 }, overrides);
    const setA = this._textures('water.normal', optsA, { kind: 'water.normal' });

    // A second, independently seeded normal field. Two layers scrolling at
    // different rates and scales is what stops water reading as a sliding
    // texture.
    // NOTE: the repeat stays identical to layer A on purpose. If the forge
    // hashes its cache without `seed` we would otherwise get one shared texture
    // and the second `_prepTexture` call would stomp layer A's repeat. The
    // scale difference is carried by `uWaveScaleB` in the shader instead.
    const optsB = Object.assign({}, optsA, { seed: (optsA.seed || 1) + 977 });
    const setB = this._textures('water.normal', optsB, { kind: 'water.normal' });

    const nA = setA.normalMap || setA.map || null;
    const nB = setB.normalMap || setB.map || nA;

    const usePhysical = this._allowPhysical;
    const params = {
      name: 'water',
      color: 0x2f6b7a,
      roughness: 0.06,
      metalness: 0.02,
      transparent: true,
      opacity: 0.86,
      depthWrite: true,
      side: THREE.FrontSide,
    };
    if (nA) {
      params.normalMap = nA;
      params.normalScale = new THREE.Vector2(0.85, 0.85);
    }
    const mat = usePhysical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
    if (usePhysical) {
      mat.ior = 1.333;
      mat.specularIntensity = 1.0;
      mat.clearcoat = this._allowClearcoat ? 0.35 : 0;
      mat.clearcoatRoughness = 0.06;
    }
    mat.envMapIntensity = 1.6;
    mat.userData.envBoost = 1.6;

    const u = {
      uTime: { value: 0 },
      uNormalMapB: { value: nB },
      uWaveScaleA: { value: new THREE.Vector2(1.0, 1.0) },
      uWaveScaleB: { value: new THREE.Vector2(0.43, 0.43) },
      uFlowA: { value: new THREE.Vector2(0.021, 0.013) },
      uFlowB: { value: new THREE.Vector2(-0.009, 0.017) },
      uDeepColor: { value: new THREE.Color(0x0d2a38) },
      uShallowColor: { value: new THREE.Color(0x3f8f95) },
      uFoamColor: { value: new THREE.Color(0xcfe9ea) },
      uFoam: { value: 0.55 },
      uDepthPower: { value: 1.35 },
      uAlphaEdge: { value: 0.55 },
      uAlphaDeep: { value: 0.94 },
    };

    const hasNormals = !!nA;

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec2 uWaveScaleA;
uniform vec2 uWaveScaleB;
uniform vec2 uFlowA;
uniform vec2 uFlowB;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
uniform float uFoam;
uniform float uDepthPower;
uniform float uAlphaEdge;
uniform float uAlphaDeep;
${hasNormals ? 'uniform sampler2D uNormalMapB;' : ''}`)
        .replace('#include <normal_fragment_maps>', `	float mirCrest = 0.0;
${hasNormals ? `	#ifdef USE_NORMALMAP_TANGENTSPACE
		vec2 mirUvA = vNormalMapUv * uWaveScaleA + uFlowA * uTime;
		vec2 mirUvB = vNormalMapUv * uWaveScaleB - uFlowB * uTime;
		vec3 mirNA = texture2D( normalMap, mirUvA ).xyz * 2.0 - 1.0;
		vec3 mirNB = texture2D( uNormalMapB, mirUvB ).xyz * 2.0 - 1.0;
		vec3 mapN = normalize( vec3( mirNA.xy + mirNB.xy, max( mirNA.z * mirNB.z, 0.08 ) ) );
		mirCrest = saturate( length( mapN.xy ) * 1.7 );
		mapN.xy *= normalScale;
		normal = normalize( tbn * mapN );
	#endif
` : ''}
	// Depth ramp. With no scene-depth texture available we use the view/normal
	// term as the depth proxy: looking straight down into the body of water
	// reads deep and dark, grazing angles read shallow and sky-lit. That is the
	// physically correct direction and it gives water a real colour gradient
	// instead of a flat tint.
	{
		vec3 mirV = normalize( vViewPosition );
		float mirNdv = saturate( dot( normal, mirV ) );
		float mirFres = pow( 1.0 - mirNdv, 4.0 );
		float mirDepth = saturate( pow( mirNdv, uDepthPower ) );
		vec3 mirCol = mix( uShallowColor, uDeepColor, mirDepth );
		mirCol = mix( mirCol, uFoamColor, smoothstep( 0.5, 1.0, mirCrest ) * uFoam );
		diffuseColor.rgb = mirCol;
		diffuseColor.a *= clamp( mix( uAlphaEdge, uAlphaDeep, mirDepth ) + mirFres * 0.45, 0.0, 1.0 );
		roughnessFactor = mix( roughnessFactor, 0.02, 0.65 );
	}`);
    };
    mat.customProgramCacheKey = () => (hasNormals ? 'mir-water-n' : 'mir-water');

    mat.userData.uniforms = u;
    this._animated.push({ mat, u, kind: 'water', base: 1, phase: 0 });

    this._applyOverrides(mat, overrides);
    this._applyEnv(mat);
    return mat;
  }

  // ---- rune ---------------------------------------------------------------

  _makeRune(overrides) {
    const forgeOpts = this._forgeOpts({ repeat: [1, 1], sizeMul: 0.5 }, overrides);
    const set = this._textures('rune', forgeOpts, { kind: 'rune' });

    const mat = new THREE.MeshStandardMaterial({
      name: 'rune',
      color: 0x000000,
      roughness: 1,
      metalness: 0,
      emissive: new THREE.Color(0x63c8ff),
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: true,
    });
    if (set.map) {
      mat.map = set.map;
      mat.emissiveMap = set.emissiveMap || set.map;
    } else if (set.emissiveMap) {
      mat.emissiveMap = set.emissiveMap;
    }

    const base = 1.55;
    const u = {
      uTime: { value: 0 },
      uGlow: { value: base },
      uPulseSpeed: { value: 1.9 },
      uSweepSpeed: { value: 0.16 },
    };

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMirUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMirUv = uv;');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vMirUv;
uniform float uTime;
uniform float uGlow;
uniform float uPulseSpeed;
uniform float uSweepSpeed;
${NOISE_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		float mirPulse = 0.6 + 0.4 * sin( uTime * uPulseSpeed );
		float mirBand = abs( fract( vMirUv.y - uTime * uSweepSpeed ) - 0.5 ) * 2.0;
		float mirSweep = 0.7 + 0.55 * smoothstep( 0.55, 1.0, mirBand );
		float mirFlick = 0.9 + 0.1 * mirFbm( vMirUv * 5.0 + uTime * 0.35 );
		totalEmissiveRadiance *= uGlow * mirPulse * mirSweep * mirFlick;
		diffuseColor.a *= clamp( 0.5 + 0.5 * mirPulse, 0.0, 1.0 );
	}`);
    };
    mat.customProgramCacheKey = () => 'mir-rune';

    mat.userData.uniforms = u;
    this._animated.push({ mat, u, kind: 'rune', base, phase: 0.7 });

    this._applyOverrides(mat, overrides);
    this._applyEnv(mat);
    return mat;
  }

  // ---- crystal / glass ----------------------------------------------------

  _makeCrystal(overrides, tint, ior, transmission) {
    if (!this._allowPhysical) {
      const cheap = new THREE.MeshStandardMaterial({
        name: 'crystal.cheap',
        color: tint, roughness: 0.12, metalness: 0.1,
        transparent: true, opacity: 0.55, depthWrite: false,
      });
      cheap.envMapIntensity = 1.5;
      cheap.userData.envBoost = 1.5;
      this._applyOverrides(cheap, overrides);
      this._applyEnv(cheap);
      return cheap;
    }

    const mat = new THREE.MeshPhysicalMaterial({
      name: 'crystal',
      color: 0xffffff,
      roughness: 0.045,
      metalness: 0,
      // NB: do not pass `reflectivity` here — its setter recomputes `ior`.
      ior,
      specularIntensity: 1,
      thickness: 0.55,
      attenuationDistance: 1.4,
      attenuationColor: new THREE.Color(tint),
      clearcoat: this._allowClearcoat ? 0.6 : 0,
      clearcoatRoughness: 0.05,
      side: THREE.FrontSide,
    });
    if (this._allowTransmission) {
      mat.transmission = transmission;
      mat.transparent = false;
      mat.opacity = 1;
    } else {
      mat.transparent = true;
      mat.opacity = 0.42;
      mat.depthWrite = false;
      mat.color.set(tint);
    }
    if (this._allowIridescence) {
      mat.iridescence = 0.25;
      mat.iridescenceIOR = 1.35;
    }
    mat.envMapIntensity = 1.8;
    mat.userData.envBoost = 1.8;

    this._applyOverrides(mat, overrides);
    this._applyEnv(mat);
    return mat;
  }

  // ---- emissive eyes ------------------------------------------------------

  _makeEyeGlow(overrides) {
    const base = 1.95;   // linear luminance well over the 0.85 bloom threshold
    const mat = new THREE.MeshStandardMaterial({
      name: 'eye.glow',
      color: 0x140502,
      roughness: 0.28,
      metalness: 0,
      emissive: new THREE.Color(0xff4a16),
      emissiveIntensity: base,
      toneMapped: true,
    });
    mat.userData.bloomThreshold = BLOOM_THRESHOLD;
    mat.userData.emissiveBase = base;
    this._applyOverrides(mat, overrides);
    // Re-read the base in case an override retuned it.
    this._pulsing.push({ mat, base: mat.emissiveIntensity, phase: 1.7 });
    this._applyEnv(mat);
    return mat;
  }

  // ---- blob shadow --------------------------------------------------------

  _makeShadowBlob(overrides) {
    const tex = this._radialTexture();
    const mat = new THREE.MeshBasicMaterial({
      name: 'shadowBlob',
      color: 0x000000,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      toneMapped: false,
      alphaMap: tex,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this._applyOverrides(mat, overrides);
    return mat;
  }

  // =========================================================================
  // helpers
  // =========================================================================

  /** Build the opts object handed to `forge.pbr()`. */
  _forgeOpts(def, overrides) {
    const base = SIZE_BASE[this.quality] || 512;
    const mul = def.sizeMul !== undefined ? def.sizeMul : 1;
    let size = Math.round(base * mul);
    // clamp to a sane power-of-two-ish range
    size = Math.max(128, Math.min(2048, 1 << Math.round(Math.log2(Math.max(1, size)))));

    const opts = {
      size,
      repeat: def.repeat || [1, 1],
      quality: this.quality,
    };
    if (def.tint !== undefined) opts.tint = def.tint;
    if (def.seed !== undefined) opts.seed = def.seed;
    if (def.normalStrength !== undefined) opts.normalStrength = def.normalStrength;

    if (overrides) {
      for (let i = 0; i < FORGE_OPT_KEYS.length; i++) {
        const k = FORGE_OPT_KEYS[i];
        if (overrides[k] !== undefined) opts[k] = overrides[k];
      }
    }
    return opts;
  }

  /**
   * Fetch a PBR texture set from the forge, guarding against a missing kind, a
   * throwing forge, or a partially-populated result.
   * @returns {{map:?THREE.Texture, normalMap:?THREE.Texture, roughnessMap:?THREE.Texture,
   *            aoMap:?THREE.Texture, emissiveMap:?THREE.Texture, metalnessMap:?THREE.Texture}}
   */
  _textures(kind, opts, def) {
    const empty = {
      map: null, normalMap: null, roughnessMap: null,
      aoMap: null, emissiveMap: null, metalnessMap: null,
    };
    if (!kind || !this.forge || typeof this.forge.pbr !== 'function') return empty;

    const cacheKey = kind + '|' + JSON.stringify(opts);
    const cached = this._mapSets.get(cacheKey);
    if (cached) return this._filterSlots(cached, def);

    let raw = null;
    try {
      raw = this.forge.pbr(kind, opts);
    } catch (e) {
      if (!this._missing.has('forge:' + kind)) {
        this._missing.add('forge:' + kind);
        console.warn(`[materials] forge.pbr('${kind}') threw; falling back to untextured`, e);
      }
      raw = null;
    }
    if (!raw || typeof raw !== 'object') {
      this._mapSets.set(cacheKey, empty);
      return empty;
    }

    const out = {
      map: this._prepTexture(raw.map, true, opts),
      normalMap: this._prepTexture(raw.normalMap, false, opts),
      roughnessMap: this._prepTexture(raw.roughnessMap, false, opts),
      aoMap: this._prepTexture(raw.aoMap, false, opts),
      emissiveMap: this._prepTexture(raw.emissiveMap, true, opts),
      metalnessMap: this._prepTexture(raw.metalnessMap, false, opts),
    };
    this._mapSets.set(cacheKey, out);
    return this._filterSlots(out, def);
  }

  /** Some defs only want part of a forge set (skin takes normal + roughness). */
  _filterSlots(set, def) {
    if (!def || !def.useSlots) return set;
    const out = {
      map: null, normalMap: null, roughnessMap: null,
      aoMap: null, emissiveMap: null, metalnessMap: null,
    };
    for (let i = 0; i < def.useSlots.length; i++) {
      const k = def.useSlots[i];
      if (set[k]) out[k] = set[k];
    }
    return out;
  }

  /** Wrap/repeat/aniso/colour-space a forge texture in place. */
  _prepTexture(tex, srgb, opts) {
    if (!tex || !tex.isTexture) return null;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const r = opts && opts.repeat;
    if (Array.isArray(r)) tex.repeat.set(r[0] || 1, r[1] !== undefined ? r[1] : (r[0] || 1));
    else if (typeof r === 'number' && isFinite(r)) tex.repeat.set(r, r);
    tex.anisotropy = this.maxAniso;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /** A soft radial falloff used as the blob-shadow alpha. We own this one. */
  _radialTexture() {
    if (this._radial) return this._radial;
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    // Opaque greyscale, NOT an alpha ramp: `alphaMap` samples the green
    // channel, so the falloff has to live in the colour, not in the alpha.
    g.fillStyle = '#000000';
    g.fillRect(0, 0, size, size);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, 'rgb(255,255,255)');
    grad.addColorStop(0.55, 'rgb(184,184,184)');
    grad.addColorStop(0.82, 'rgb(56,56,56)');
    grad.addColorStop(1.0, 'rgb(0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, this.maxAniso);
    tex.needsUpdate = true;
    this._owned.add(tex);
    this._radial = tex;
    return tex;
  }

  /** Apply the current environment map to one material. */
  _applyEnv(mat) {
    if (!mat) return;
    if (!(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) return;
    const had = mat.envMap;
    mat.envMap = this._envMap;
    const boost = mat.userData && mat.userData.envBoost !== undefined ? mat.userData.envBoost : 1;
    mat.envMapIntensity = boost * this._envIntensity;
    // Adding or removing an env map flips a shader define.
    if ((had === null) !== (this._envMap === null)) mat.needsUpdate = true;
  }

  /**
   * Copy caller overrides onto the material. Colour props accept hex numbers,
   * CSS strings or THREE.Color; forge opts are skipped (already consumed).
   */
  _applyOverrides(mat, overrides) {
    if (!overrides) return;
    let recompile = false;
    for (const k in overrides) {
      if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
      if (FORGE_OPT_KEYS.indexOf(k) >= 0) continue;
      const v = overrides[k];
      if (v === undefined) continue;

      if (COLOR_PROPS.has(k)) {
        if (mat[k] && mat[k].isColor) mat[k].set(v);
        continue;
      }
      if (k === 'normalScale') {
        if (mat.normalScale && mat.normalScale.isVector2) {
          if (typeof v === 'number') mat.normalScale.set(v, v);
          else if (v && v.isVector2) mat.normalScale.copy(v);
          else if (Array.isArray(v)) mat.normalScale.set(v[0], v[1] !== undefined ? v[1] : v[0]);
        }
        continue;
      }
      if (!(k in mat)) continue;
      mat[k] = v;
      // Keep the env-map base in sync so setEnvironment() does not clobber a
      // caller-supplied intensity later on.
      if (k === 'envMapIntensity') mat.userData.envBoost = v;
      if (DEFINE_PROPS.has(k)) recompile = true;
    }
    if (recompile) mat.needsUpdate = true;
  }
}

export default MaterialLibrary;
