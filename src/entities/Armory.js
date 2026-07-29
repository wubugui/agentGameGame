/**
 * src/entities/Armory.js — weapons, armour, helmets, shields (CONTRACTS §11b).
 *
 * Strategy note (the contract predates the Blender pipeline): every weapon in
 * the Mir2 ladder now has a real modeled GLB in assets/models/. So the primary
 * path here is `ctx.assets.prop('wpn_*', ctx.materials)`; the JS generators
 * below are the safety net for ids with no model yet (armour, helmets) and for
 * a failed/absent manifest.
 *
 * Objection noted per CONTRACTS §0 (implemented as specified anyway):
 *  - §11b lists no `buildCape` / `SHIELD_IDS`, yet §11 puts `cape` and `shield`
 *    in the humanoid spec. `buildShield` + `SHIELD_IDS` are exported here;
 *    capes are built by CharacterRig because they hang off `attach.back`.
 *
 * ORIENTATION (normative for callers):
 *  - buildWeapon  -> +Z is the blade/shaft direction, grip at the origin.
 *  - buildShield  -> +Z is the face normal, +Y is up, grip at the origin.
 *  - buildHelmet  -> origin sits at the crown (the `headTop` attach point),
 *                    geometry hangs down -Y.
 *  - buildArmor   -> parts are authored in CHARACTER-BODY space: feet at y=0,
 *                    up +Y, facing -Z, sized for a 1.8-unit character.
 *                    CharacterRig re-parents them onto joints at rest.
 *
 * Ownership: everything generated here is pooled by id and reference counted,
 * so 40 town NPCs holding an iron sword share one geometry. Call
 * `releaseGear(obj)` (CharacterRig does) to give an instance back; the pooled
 * prototype is freed when the last holder lets go. Geometry that came from a
 * GLB belongs to core/Assets.js and is never disposed here.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ===========================================================================
// 1. Catalogue — ids mirror src/game/Content.js ITEMS keys exactly.
// ===========================================================================

/** Every weapon id `buildWeapon` understands, in ladder order. */
export const WEAPON_IDS = [
  'wooden_sword', 'short_sword', 'bronze_sword', 'iron_sword', 'ebony_sword',
  'blue_blade', 'crescent_blade', 'dragon_sword', 'blood_drinker', 'asura',
  'bone_jade_staff', 'dragon_tooth', 'soul_devour_staff', 'judgement_staff',
  'dragon_slayer',
  // Not in the item catalogue, but modeled and used by NPCs / monsters.
  'silver_snake', 'wooden_staff', 'axe', 'spear', 'bow', 'dagger',
];

export const ARMOR_IDS = [
  'cloth_robe', 'light_armor', 'medium_armor', 'heavy_armor', 'ghost_armor',
  'taoist_robe', 'mage_cloak', 'holy_plate', 'demon_armor',
];

export const HELMET_IDS = [
  'helm', 'taoist_helm', 'iron_helm', 'memory_helm', 'holy_helm',
  'taoist_crown', 'mage_crown',
];

export const SHIELD_IDS = ['wooden_shield', 'iron_shield'];

/** item id -> manifest asset name (assets/models/manifest.json). */
const WEAPON_ASSET = {
  wooden_sword: 'wpn_wooden_sword',
  short_sword: 'wpn_dagger',
  bronze_sword: 'wpn_bronze_sword',
  iron_sword: 'wpn_iron_sword',
  ebony_sword: 'wpn_ebony_sword',
  blue_blade: 'wpn_bluesky',          // 三尺青锋
  crescent_blade: 'wpn_crescent',     // 偃月
  dragon_sword: 'wpn_dragon_sword',   // 龙纹剑
  blood_drinker: 'wpn_bloodlust',     // 血饮
  asura: 'wpn_asura',                 // 修罗
  bone_jade_staff: 'wpn_bone_staff',  // 骨玉权杖
  dragon_tooth: 'wpn_dragon_tooth',   // 龙牙
  soul_devour_staff: 'wpn_soul_staff',// 嗜魂法杖
  judgement_staff: 'wpn_judgement',   // 裁决之杖
  dragon_slayer: 'wpn_dragonslayer',  // 屠龙
  silver_snake: 'wpn_serpent',        // 银蛇
  wooden_staff: 'wpn_wooden_staff',
  axe: 'wpn_axe',
  spear: 'wpn_spear',
  bow: 'wpn_bow',
  dagger: 'wpn_dagger',
};

const SHIELD_ASSET = {
  wooden_shield: 'wpn_shield_wood',
  iron_shield: 'wpn_shield_iron',
};

/**
 * Anything a designer, a monster table or a save file might hand us instead of
 * the canonical id: the zh-CN name, an English transliteration, a family word.
 */
const WEAPON_ALIAS = {
  '木剑': 'wooden_sword', woodensword: 'wooden_sword', wood_sword: 'wooden_sword',
  '短剑': 'short_sword', shortsword: 'short_sword',
  '匕首': 'dagger', knife: 'dagger',
  '铜剑': 'bronze_sword', '青铜剑': 'bronze_sword', bronzesword: 'bronze_sword',
  '铁剑': 'iron_sword', ironsword: 'iron_sword',
  '乌木剑': 'ebony_sword', ebonysword: 'ebony_sword',
  '三尺青锋': 'blue_blade', bluesky: 'blue_blade', blue_sky: 'blue_blade',
  '偃月': 'crescent_blade', '偃月刀': 'crescent_blade', crescent: 'crescent_blade',
  halfmoon: 'crescent_blade',
  '龙纹剑': 'dragon_sword', dragonsword: 'dragon_sword',
  '血饮': 'blood_drinker', bloodlust: 'blood_drinker', blooddrinker: 'blood_drinker',
  '修罗': 'asura', '修罗刀': 'asura', ashura: 'asura',
  '银蛇': 'silver_snake', serpent: 'silver_snake', silversnake: 'silver_snake',
  '骨玉权杖': 'bone_jade_staff', bonestaff: 'bone_jade_staff', bone_staff: 'bone_jade_staff',
  '龙牙': 'dragon_tooth', dragontooth: 'dragon_tooth',
  '嗜魂法杖': 'soul_devour_staff', soulstaff: 'soul_devour_staff', soul_staff: 'soul_devour_staff',
  '裁决之杖': 'judgement_staff', judgement: 'judgement_staff', judgment: 'judgement_staff',
  '屠龙': 'dragon_slayer', dragonslayer: 'dragon_slayer', dragon_slayer_blade: 'dragon_slayer',
  '木杖': 'wooden_staff', staff: 'wooden_staff', woodenstaff: 'wooden_staff',
  '斧': 'axe', '战斧': 'axe', axe_battle: 'axe', hatchet: 'axe',
  '矛': 'spear', '长矛': 'spear', lance: 'spear', pike: 'spear',
  '弓': 'bow', shortbow: 'bow', longbow: 'bow',
  sword: 'iron_sword', blade: 'crescent_blade', greatsword: 'judgement_staff',
  wand: 'wooden_staff', talisman: 'wooden_staff',
};

const SHIELD_ALIAS = {
  '木盾': 'wooden_shield', wood_shield: 'wooden_shield', shield_wood: 'wooden_shield',
  buckler: 'wooden_shield', shield: 'wooden_shield',
  '铁盾': 'iron_shield', shield_iron: 'iron_shield', steel_shield: 'iron_shield',
};

const ARMOR_ALIAS = {
  '布衣': 'cloth_robe', robe: 'cloth_robe', cloth: 'cloth_robe',
  '轻型盔甲': 'light_armor', light: 'light_armor',
  '中型盔甲': 'medium_armor', medium: 'medium_armor',
  '重型盔甲': 'heavy_armor', heavy: 'heavy_armor', plate: 'heavy_armor',
  '幽灵战衣': 'ghost_armor', ghost: 'ghost_armor',
  '天尊道袍': 'taoist_robe', '道袍': 'taoist_robe',
  '法神披风': 'mage_cloak', '披风': 'mage_cloak',
  '圣战宝甲': 'holy_plate', holy: 'holy_plate',
  '天魔神甲': 'demon_armor', demon: 'demon_armor',
};

const HELMET_ALIAS = {
  '头盔': 'helm', '道士头盔': 'taoist_helm', '铁头盔': 'iron_helm',
  '记忆头盔': 'memory_helm', memory: 'memory_helm',
  '圣战头盔': 'holy_helm', '天尊头盔': 'taoist_crown', '法神头盔': 'mage_crown',
  crown: 'taoist_crown', helmet: 'helm',
};

// ===========================================================================
// 2. Shape tables for the JS generators
// ===========================================================================

/**
 * family: which generator runs. len/width/thick are in world units for a
 * 1.8-unit character. mats picks library material names.
 */
const WEAPON_SHAPE = {
  wooden_sword:      { family: 'sword',  len: 0.68, w: 0.048, t: 0.016, blade: 'plank',  fitting: 'torchWood', grip: 'leather' },
  short_sword:       { family: 'dagger', len: 0.42, w: 0.042, t: 0.014, blade: 'iron',   fitting: 'bronze',    grip: 'leather' },
  dagger:            { family: 'dagger', len: 0.38, w: 0.040, t: 0.013, blade: 'iron',   fitting: 'bronze',    grip: 'leather' },
  bronze_sword:      { family: 'sword',  len: 0.76, w: 0.052, t: 0.017, blade: 'bronze', fitting: 'bronze',    grip: 'leather' },
  iron_sword:        { family: 'sword',  len: 0.84, w: 0.056, t: 0.018, blade: 'iron',   fitting: 'iron',      grip: 'leather' },
  ebony_sword:       { family: 'sword',  len: 0.88, w: 0.056, t: 0.018, blade: 'chitin', fitting: 'iron',      grip: 'leather' },
  blue_blade:        { family: 'sword',  len: 0.96, w: 0.058, t: 0.017, blade: 'steel',  fitting: 'steel',     grip: 'silk'    },
  dragon_sword:      { family: 'sword',  len: 1.00, w: 0.062, t: 0.019, blade: 'steel',  fitting: 'gold',      grip: 'clothRed' },
  crescent_blade:    { family: 'saber',  len: 0.98, w: 0.082, t: 0.020, blade: 'steel',  fitting: 'bronze',    grip: 'leather' },
  blood_drinker:     { family: 'saber',  len: 1.02, w: 0.086, t: 0.021, blade: 'iron',   fitting: 'gold',      grip: 'clothRed' },
  asura:             { family: 'saber',  len: 1.06, w: 0.092, t: 0.022, blade: 'steel',  fitting: 'gold',      grip: 'chitin'  },
  silver_snake:      { family: 'saber',  len: 0.94, w: 0.070, t: 0.018, blade: 'steel',  fitting: 'steel',     grip: 'silk', wave: 0.055 },
  judgement_staff:   { family: 'great',  len: 1.18, w: 0.115, t: 0.032, blade: 'iron',   fitting: 'gold',      grip: 'leather' },
  dragon_slayer:     { family: 'great',  len: 1.30, w: 0.140, t: 0.038, blade: 'iron',   fitting: 'gold',      grip: 'leather' },
  bone_jade_staff:   { family: 'staff',  len: 1.24, w: 0.024, blade: 'bone',      fitting: 'gold',  grip: 'leather', orb: 'crystal' },
  dragon_tooth:      { family: 'staff',  len: 1.20, w: 0.024, blade: 'bone',      fitting: 'bronze', grip: 'leather', orb: 'bone' },
  soul_devour_staff: { family: 'staff',  len: 1.26, w: 0.026, blade: 'chitin',    fitting: 'gold',  grip: 'silk',    orb: 'crystal' },
  wooden_staff:      { family: 'staff',  len: 1.16, w: 0.024, blade: 'torchWood', fitting: 'bronze', grip: 'leather', orb: null },
  axe:               { family: 'axe',    len: 0.86, w: 0.150, t: 0.024, blade: 'iron',   fitting: 'iron',  grip: 'leather' },
  spear:             { family: 'spear',  len: 1.60, w: 0.046, t: 0.016, blade: 'iron',   fitting: 'bronze', grip: 'leather' },
  bow:               { family: 'bow',    len: 1.24, w: 0.028, t: 0.016, blade: 'torchWood', fitting: 'bronze', grip: 'leather' },
};

/** Materials + cut per armour tier. `skirt` picks the lower-body silhouette. */
const ARMOR_SHAPE = {
  cloth_robe:  { shell: 'sackcloth',  trim: 'leather', skirt: 'robe',   pauldron: null,     boot: 'leather', bulk: 0.010 },
  light_armor: { shell: 'leather',    trim: 'bronze',  skirt: 'tasset', pauldron: 'leather', boot: 'leather', bulk: 0.018 },
  medium_armor:{ shell: 'iron',       trim: 'leather', skirt: 'tasset', pauldron: 'iron',   boot: 'leather', bulk: 0.026 },
  heavy_armor: { shell: 'steel',      trim: 'iron',    skirt: 'tasset', pauldron: 'steel',  boot: 'iron',    bulk: 0.036 },
  ghost_armor: { shell: 'steel',      trim: 'bone',    skirt: 'tasset', pauldron: 'bone',   boot: 'leather', bulk: 0.030 },
  taoist_robe: { shell: 'clothWhite', trim: 'gold',    skirt: 'robe',   pauldron: null,     boot: 'leather', bulk: 0.014 },
  mage_cloak:  { shell: 'clothBlue',  trim: 'gold',    skirt: 'robe',   pauldron: null,     boot: 'leather', bulk: 0.014 },
  holy_plate:  { shell: 'gold',       trim: 'steel',   skirt: 'tasset', pauldron: 'gold',   boot: 'steel',   bulk: 0.040 },
  demon_armor: { shell: 'iron',       trim: 'gold',    skirt: 'tasset', pauldron: 'scaleRed', boot: 'iron',  bulk: 0.044 },
};

/** dome/crest/jewel per helmet. */
const HELMET_SHAPE = {
  helm:         { shell: 'iron',  trim: 'leather', crest: null,     jewel: null,      cheek: 0.55 },
  taoist_helm:  { shell: 'silk',  trim: 'gold',    crest: null,     jewel: 'chitin',  cheek: 0.0  },
  iron_helm:    { shell: 'iron',  trim: 'iron',    crest: null,     jewel: null,      cheek: 0.75 },
  memory_helm:  { shell: 'steel', trim: 'bronze',  crest: null,     jewel: 'crystal', cheek: 0.70 },
  holy_helm:    { shell: 'gold',  trim: 'steel',   crest: 'clothRed', jewel: 'crystal', cheek: 0.85 },
  taoist_crown: { shell: 'gold',  trim: 'silk',    crest: 'crown',  jewel: 'crystal', cheek: 0.0  },
  mage_crown:   { shell: 'gold',  trim: 'clothBlue', crest: 'crown', jewel: 'crystal', cheek: 0.0 },
};

const SHIELD_SHAPE = {
  wooden_shield: { board: 'plank', rim: 'iron',  boss: 'iron',  w: 0.30, h: 0.42, t: 0.035 },
  iron_shield:   { board: 'iron',  rim: 'steel', boss: 'bronze', w: 0.32, h: 0.48, t: 0.040 },
};

// ===========================================================================
// 3. Local material fallback (only used when ctx.materials is absent)
// ===========================================================================

const HEX = {
  iron: 0x8c9199, ironRusted: 0x7a5a44, steel: 0xb6bcc4, bronze: 0x9c7a3c, gold: 0xd8b45a,
  leather: 0x6b4a2c, leatherStudded: 0x5a3f26, sackcloth: 0xb5a486, hide: 0x8a6a4a,
  clothRed: 0x8c2f26, clothBlue: 0x2f4585, clothWhite: 0xe6e2d6, silk: 0xd8c8a8,
  banner: 0x8c2f26, bone: 0xded3b8, chitin: 0x2a2320, flesh: 0xa8564c,
  plank: 0x8a6b45, 'plank.worn': 0x7b5f3e, torchWood: 0x6f5232, bark: 0x5a4632,
  scaleRed: 0x8e2a24, scaleGreen: 0x3f6b3a, crystal: 0x9fd8ff, glass: 0xdff0f5,
  rock: 0x8a8880, furBrown: 0x6b4d33, furGrey: 0x8b8681, furWhite: 0xdcd8cf,
  'skin.tan': 0xd6a882, 'skin.pale': 0xe6cbae, 'skin.grey': 0x9aa0a0,
  'eye.glow': 0xffd27f,
};
const METALS = new Set(['iron', 'ironRusted', 'steel', 'bronze', 'gold']);

const _localMats = new Map();

/** @returns {THREE.Material} */
function matOf(ctx, name) {
  const lib = ctx && ctx.materials;
  if (lib && typeof lib.get === 'function') {
    const m = lib.get(name);
    if (m) return m;
  }
  let m = _localMats.get(name);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: HEX[name] !== undefined ? HEX[name] : 0x9a9a9a,
      roughness: METALS.has(name) ? 0.38 : 0.78,
      metalness: METALS.has(name) ? 0.9 : 0.04,
    });
    m.name = name;
    _localMats.set(name, m);
  }
  return m;
}

// ===========================================================================
// 4. Instance pool — one prototype per (id, material library), refcounted
// ===========================================================================

/** key -> { obj:THREE.Object3D, refs:number } */
const _protos = new Map();
const _libIds = new WeakMap();
let _libSeq = 0;

function libId(ctx) {
  const lib = ctx && ctx.materials;
  if (!lib) return 0;
  let id = _libIds.get(lib);
  if (id === undefined) { id = ++_libSeq; _libIds.set(lib, id); }
  return id;
}

/**
 * @param {string} key
 * @param {() => (THREE.Object3D|null)} factory
 * @returns {THREE.Object3D|null}
 */
function instance(key, factory) {
  let rec = _protos.get(key);
  if (!rec) {
    let obj = null;
    try { obj = factory(); } catch (e) {
      console.warn(`[armory] failed to build '${key}':`, e && e.message);
      obj = null;
    }
    if (!obj) return null;
    rec = { obj, refs: 0 };
    _protos.set(key, rec);
  }
  rec.refs++;
  const inst = rec.obj.clone(true);
  inst.userData.gearKey = key;
  return inst;
}

/**
 * Hand an instance back. Detaches it and frees the pooled prototype's
 * geometry once nothing holds it. Geometry cloned out of a GLB is owned by
 * core/Assets.js and is deliberately left alone.
 * @param {THREE.Object3D|null} obj
 */
export function releaseGear(obj) {
  if (!obj) return;
  if (obj.parent) obj.parent.remove(obj);
  const key = obj.userData && obj.userData.gearKey;
  if (!key) return;
  obj.userData.gearKey = null;
  const rec = _protos.get(key);
  if (!rec) return;
  rec.refs--;
  if (rec.refs > 0) return;
  _protos.delete(key);
  rec.obj.traverse((o) => {
    const g = o.geometry;
    if (g && g.userData && g.userData.armoryOwned) g.dispose();
  });
}

/** Free every pooled prototype and locally-created material. Idempotent. */
export function disposeArmory() {
  for (const rec of _protos.values()) {
    rec.obj.traverse((o) => {
      const g = o.geometry;
      if (g && g.userData && g.userData.armoryOwned) g.dispose();
    });
  }
  _protos.clear();
  for (const m of _localMats.values()) m.dispose();
  _localMats.clear();
}

// ===========================================================================
// 5. Geometry helpers
// ===========================================================================

// Cross-sections in (u, v): u scales to WIDTH, v to THICKNESS. All CCW.
const P_DOUBLE = [[-1, 0], [-0.42, -1], [0.42, -1], [1, 0], [0.42, 1], [-0.42, 1]];
const P_SINGLE = [[-1, 0], [-0.34, -1], [0.8, -1], [1, -0.45], [1, 0.45], [0.8, 1], [-0.34, 1]];
const P_SLAB = [[-1, 0], [-0.8, -1], [0.88, -1], [1, -0.52], [1, 0.52], [0.88, 1], [-0.8, 1]];
const P_PLANK = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const P_OVAL = (() => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
})();

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();

/**
 * Loft a closed 2D outline along +Z through a list of rings.
 * @param {Array<[number,number]>} profile
 * @param {Array<{z:number,sx:number,sy:number,ox?:number,oy?:number}>} rings
 */
function loft(profile, rings, cap0 = true, cap1 = true) {
  const n = profile.length;
  const m = rings.length;
  const pos = [];
  const uv = [];
  const idx = [];
  const vDen = m > 1 ? m - 1 : 1;

  for (let k = 0; k < m; k++) {
    const r = rings[k];
    const ox = r.ox || 0;
    const oy = r.oy || 0;
    for (let i = 0; i < n; i++) {
      pos.push(ox + profile[i][0] * r.sx, oy + profile[i][1] * r.sy, r.z);
      uv.push(i / n, k / vDen);
    }
  }
  for (let k = 0; k < m - 1; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = k * n + i;
      const b = k * n + j;
      const c = (k + 1) * n + i;
      const d = (k + 1) * n + j;
      idx.push(a, d, c, a, b, d);
    }
  }
  const cap = (k, flip) => {
    const r = rings[k];
    const ox = r.ox || 0;
    const oy = r.oy || 0;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      pos.push(ox + profile[i][0] * r.sx, oy + profile[i][1] * r.sy, r.z);
      uv.push(0.5 + profile[i][0] * 0.5, 0.5 + profile[i][1] * 0.5);
    }
    const ci = pos.length / 3;
    pos.push(ox, oy, r.z);
    uv.push(0.5, 0.5);
    for (let i = 0; i < n; i++) {
      const a = base + i;
      const b = base + ((i + 1) % n);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (cap0) cap(0, true);
  if (cap1) cap(m - 1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lathe about +Y from (radius, y) pairs. */
function lathe(points, seg) {
  const pts = [];
  for (let i = 0; i < points.length; i++) pts.push(new THREE.Vector2(points[i][0], points[i][1]));
  return new THREE.LatheGeometry(pts, seg);
}

/** Strip a geometry down to position/normal/uv so mergeGeometries never bails. */
function prep(g) {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    const count = g.getAttribute('position').count;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
  }
  if (!g.index) {
    const count = g.getAttribute('position').count;
    const idx = new Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    g.setIndex(idx);
  }
  g.userData.armoryOwned = true;
  return g;
}

/** Accumulates transformed geometry per material and merges on finish(). */
class Kit {
  constructor() {
    /** @type {Map<string, THREE.BufferGeometry[]>} */
    this.groups = new Map();
  }

  /** @returns {Kit} */
  add(geo, mat, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    if (!geo) return this;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _vA.set(px, py, pz);
    _vB.set(sx, sy, sz);
    _m4.compose(_vA, _q, _vB);
    geo.applyMatrix4(_m4);
    prep(geo);
    let arr = this.groups.get(mat);
    if (!arr) { arr = []; this.groups.set(mat, arr); }
    arr.push(geo);
    return this;
  }

  /** @returns {THREE.Group} */
  finish(ctx, name) {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, geos] of this.groups) {
      let merged = geos[0];
      if (geos.length > 1) {
        const m = mergeGeometries(geos, false);
        if (m) {
          for (let i = 0; i < geos.length; i++) geos[i].dispose();
          merged = prep(m);
        } else {
          // Should not happen (prep() normalises), but never drop the mesh.
          for (let i = 1; i < geos.length; i++) {
            const extra = new THREE.Mesh(geos[i], matOf(ctx, mat));
            extra.castShadow = true;
            extra.receiveShadow = true;
            g.add(extra);
          }
        }
      }
      const mesh = new THREE.Mesh(merged, matOf(ctx, mat));
      mesh.name = `${name}.${mat}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    this.groups.clear();
    return g;
  }
}

function segFor(ctx) {
  const q = (ctx && ctx.quality) || 'high';
  if (q === 'low') return 6;
  if (q === 'med') return 8;
  return 12;
}

// ===========================================================================
// 6. Modeled-asset path
// ===========================================================================

const _AX = new THREE.Vector3();
const _AY = new THREE.Vector3();
const _AZ = new THREE.Vector3();

/** Re-basis an object: its local X/Y/Z end up pointing along the given axes. */
function orient(obj, x, y, z) {
  _AX.set(x[0], x[1], x[2]);
  _AY.set(y[0], y[1], y[2]);
  _AZ.set(z[0], z[1], z[2]);
  _m4.makeBasis(_AX, _AY, _AZ);
  obj.quaternion.setFromRotationMatrix(_m4);
}

/**
 * Clone a modeled prop and re-basis it into this module's orientation contract.
 * GLBs come out of Blender with the shaft/blade along +Y.
 */
function assetGear(ctx, assetName, kind) {
  const assets = ctx && ctx.assets;
  if (!assets || typeof assets.prop !== 'function') return null;
  // has() first so Assets never console.warns about models we know are missing.
  if (typeof assets.has === 'function' && !assets.has(assetName)) return null;
  const inst = assets.prop(assetName, ctx && ctx.materials);
  if (!inst) return null;

  if (kind === 'shield') {
    // model +Y (face normal) -> +Z, model +Z (board长轴) -> +Y
    orient(inst, [-1, 0, 0], [0, 0, 1], [0, 1, 0]);
  } else {
    // model +Y (blade) -> +Z
    inst.rotation.x = Math.PI / 2;
  }
  inst.updateMatrix();

  const g = new THREE.Group();
  g.name = assetName;
  g.add(inst);
  g.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return g;
}

// ===========================================================================
// 7. Weapons
// ===========================================================================

function normId(id, alias) {
  if (id === null || id === undefined) return null;
  if (typeof id === 'object') id = id.id || id.name || null;
  if (typeof id !== 'string') return null;
  const raw = id.trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  return alias[raw] || alias[low] || low;
}

const _warned = new Set();
function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn(msg);
}

/**
 * @param {string} id  item id ('iron_sword'), zh-CN name ('屠龙') or family word
 * @param {object} ctx
 * @returns {THREE.Object3D|null} +Z is the blade direction, grip at the origin
 */
export function buildWeapon(id, ctx = {}) {
  const key = normId(id, WEAPON_ALIAS);
  if (!key) return null;

  const asset = WEAPON_ASSET[key];
  if (asset) {
    const modeled = instance(`a:${asset}:${libId(ctx)}`, () => assetGear(ctx, asset, 'weapon'));
    if (modeled) return modeled;
  }

  let shape = WEAPON_SHAPE[key];
  if (!shape) {
    warnOnce(`[armory] unknown weapon '${id}' — falling back to a plain sword`);
    shape = WEAPON_SHAPE.iron_sword;
  }
  return instance(`w:${key}:${libId(ctx)}:${segFor(ctx)}`, () => genWeapon(ctx, key, shape));
}

function genWeapon(ctx, key, o) {
  const kit = new Kit();
  const seg = segFor(ctx);
  switch (o.family) {
    case 'staff': genStaff(kit, ctx, o, seg); break;
    case 'spear': genSpear(kit, ctx, o, seg); break;
    case 'axe': genAxe(kit, ctx, o, seg); break;
    case 'bow': genBow(kit, ctx, o, seg); break;
    default: genBlade(kit, ctx, o, seg); break;
  }
  return kit.finish(ctx, `wpn.${key}`);
}

/** Grip + pommel shared by every hafted/hilted weapon. Runs -Z from the hand. */
function genHilt(kit, o, seg, gripLen, pommelR) {
  const g = o.grip || 'leather';
  const f = o.fitting || 'iron';
  kit.add(lathe([
    [0.001, -gripLen], [0.019, -gripLen + 0.012], [0.021, -gripLen * 0.55],
    [0.018, -0.02], [0.020, 0.0], [0.001, 0.004],
  ], seg), g, 0, 0, 0, Math.PI / 2, 0, 0);
  // rx = -PI/2 maps the lathe axis +Y onto -Z, so the pommel grows off the
  // butt of the grip, away from the blade.
  kit.add(lathe([
    [0.001, 0], [pommelR, 0.008], [pommelR * 0.92, 0.030], [0.012, 0.044], [0.001, 0.046],
  ], seg), f, 0, 0, -gripLen, -Math.PI / 2, 0, 0);
}

function genBlade(kit, ctx, o, seg) {
  const len = o.len;
  const w = o.w;
  const t = o.t;
  const heavy = o.family === 'great';
  const saber = o.family === 'saber';
  const profile = heavy ? P_SLAB : saber ? P_SINGLE : P_DOUBLE;
  const wave = o.wave || 0;
  const curve = saber ? w * 1.9 : 0;

  const rings = [];
  const steps = heavy ? 7 : 6;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const z = 0.03 + (len - 0.03) * f;
    // Fat near the guard, narrowing to a point; sabers belly out at 2/3.
    const wide = saber ? 0.86 + 0.28 * Math.sin(f * 2.1) : 1 - 0.18 * f;
    const tipf = f > 0.86 ? Math.max(0.05, 1 - (f - 0.86) / 0.14) : 1;
    rings.push({
      z,
      sx: w * wide * tipf,
      sy: t * (1 - 0.42 * f) * (0.35 + 0.65 * tipf),
      ox: curve * f * f + (wave ? Math.sin(f * 6.0) * wave : 0),
      oy: 0,
    });
  }
  kit.add(loft(profile, rings), o.blade);

  // Guard: a bar across X, plus a collar wrapping the ricasso.
  const gw = heavy ? w * 3.6 : saber ? w * 2.4 : w * 3.1;
  kit.add(loft(P_OVAL, [
    { z: -gw, sx: 0.012, sy: t * 1.5 },
    { z: -gw * 0.35, sx: 0.020, sy: t * 1.8 },
    { z: gw * 0.35, sx: 0.020, sy: t * 1.8 },
    { z: gw, sx: 0.012, sy: t * 1.5 },
  ]), o.fitting, 0, 0, 0.022, 0, Math.PI / 2, 0);
  kit.add(lathe([
    [0.001, 0], [w * 0.9, 0.004], [w * 0.8, 0.030], [0.014, 0.036], [0.001, 0.038],
  ], seg), o.fitting, 0, 0, 0.008, Math.PI / 2, 0, 0);

  const gripLen = heavy ? 0.26 : saber ? 0.15 : 0.14;
  genHilt(kit, o, seg, gripLen, heavy ? 0.034 : 0.028);

  if (heavy) {
    // 屠龙 / 裁决 read as slabs: add a spine rib so light catches the length.
    kit.add(loft(P_PLANK, [
      { z: 0.06, sx: w * 0.16, sy: t * 1.06 },
      { z: len * 0.7, sx: w * 0.12, sy: t * 0.72 },
    ]), o.fitting);
  }
}

function genStaff(kit, ctx, o, seg) {
  const half = o.len * 0.5;
  const r = o.w;
  kit.add(lathe([
    [0.001, -half], [r * 0.86, -half + 0.01], [r * 0.95, -half * 0.3],
    [r, 0.1], [r * 0.92, half - 0.14], [r * 0.72, half - 0.10], [0.001, half - 0.09],
  ], seg), o.blade, 0, 0, 0, Math.PI / 2, 0, 0);

  // ferrules
  for (const z of [-half * 0.55, -0.02, half * 0.55]) {
    kit.add(lathe([
      [0.001, 0], [r * 1.32, 0.004], [r * 1.32, 0.026], [0.001, 0.030],
    ], seg), o.fitting, 0, 0, z, -Math.PI / 2, 0, 0);
  }
  // grip wrap where the hand closes
  kit.add(lathe([
    [0.001, -0.10], [r * 1.18, -0.095], [r * 1.18, 0.095], [0.001, 0.10],
  ], seg), o.grip, 0, 0, 0, -Math.PI / 2, 0, 0);

  // Head: three claws cradling an orb.
  const hz = half - 0.09;
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI * 2 * i) / 3;
    kit.add(loft(P_OVAL, [
      { z: 0, sx: r * 0.5, sy: r * 0.5 },
      { z: 0.09, sx: r * 0.42, sy: r * 0.42, ox: 0.030 },
      { z: 0.16, sx: r * 0.24, sy: r * 0.24, ox: 0.018 },
      { z: 0.20, sx: r * 0.06, sy: r * 0.06, ox: -0.010 },
    ]), o.fitting, 0, 0, hz, 0, 0, a);
  }
  if (o.orb) {
    kit.add(new THREE.SphereGeometry(r * 2.0, seg * 2, seg), o.orb, 0, 0, hz + 0.13);
  }
}

function genSpear(kit, ctx, o, seg) {
  const half = o.len * 0.5;
  kit.add(lathe([
    [0.001, -half], [0.020, -half + 0.01], [0.022, half - 0.20], [0.001, half - 0.18],
  ], seg), o.grip === 'leather' ? 'torchWood' : o.grip, 0, 0, 0, Math.PI / 2, 0, 0);
  kit.add(lathe([
    [0.001, 0], [0.030, 0.006], [0.028, 0.052], [0.014, 0.060], [0.001, 0.062],
  ], seg), o.fitting, 0, 0, half - 0.22, -Math.PI / 2, 0, 0);
  kit.add(loft(P_DOUBLE, [
    { z: half - 0.20, sx: o.w * 0.5, sy: o.t },
    { z: half - 0.10, sx: o.w, sy: o.t * 0.95 },
    { z: half + 0.04, sx: o.w * 0.72, sy: o.t * 0.7 },
    { z: half + 0.14, sx: 0.004, sy: 0.002 },
  ]), o.blade);
  kit.add(lathe([
    [0.001, 0], [0.024, 0.006], [0.020, 0.040], [0.001, 0.044],
  ], seg), o.fitting, 0, 0, -half, -Math.PI / 2, 0, 0);
}

function genAxe(kit, ctx, o, seg) {
  const half = o.len * 0.5;
  kit.add(lathe([
    [0.001, -half], [0.024, -half + 0.012], [0.026, half - 0.04], [0.001, half - 0.02],
  ], seg), 'torchWood', 0, 0, 0, Math.PI / 2, 0, 0);
  // A wrap over the haft rather than genHilt's slim grip, which would sit
  // inside the shaft and never be seen.
  kit.add(lathe([
    [0.001, -0.14], [0.031, -0.132], [0.031, 0.052], [0.001, 0.060],
  ], seg), o.grip, 0, 0, 0, Math.PI / 2, 0, 0);
  kit.add(lathe([
    [0.001, 0], [0.034, 0.008], [0.030, 0.034], [0.001, 0.038],
  ], seg), o.fitting, 0, 0, -half, -Math.PI / 2, 0, 0);

  // The bit: a flat wedge lofted across +X, cheeks fattest at the eye.
  const bz = half - 0.13;
  kit.add(loft(P_SLAB, [
    { z: 0.02, sx: 0.055, sy: o.t * 1.5 },
    { z: 0.06, sx: 0.086, sy: o.t * 1.35 },
    { z: o.w, sx: 0.098, sy: o.t * 0.35 },
    { z: o.w + 0.012, sx: 0.088, sy: 0.002 },
  ]), o.blade, 0, 0, bz, Math.PI / 2, Math.PI / 2, 0);
  // counterweight spike opposite the bit
  kit.add(loft(P_OVAL, [
    { z: 0.02, sx: 0.026, sy: 0.026 },
    { z: 0.07, sx: 0.016, sy: 0.016 },
    { z: 0.10, sx: 0.003, sy: 0.003 },
  ]), o.fitting, 0, 0, bz, Math.PI / 2, -Math.PI / 2, 0);
  kit.add(lathe([
    [0.001, 0], [0.034, 0.006], [0.034, 0.056], [0.001, 0.060],
  ], seg), o.fitting, 0, 0, bz - 0.03, -Math.PI / 2, 0, 0);
}

function genBow(kit, ctx, o, seg) {
  const half = o.len * 0.5;
  const limb = (sign) => {
    const rings = [
      { z: 0.06 * sign, sx: 0.018, sy: 0.014, ox: 0 },
      { z: half * 0.45 * sign, sx: 0.015, sy: 0.012, ox: 0.030 },
      { z: half * 0.80 * sign, sx: 0.011, sy: 0.010, ox: 0.046 },
      { z: half * sign, sx: 0.006, sy: 0.006, ox: 0.030 },
    ];
    // loft() caps assume rings run along +Z; reverse the lower limb.
    if (sign < 0) rings.reverse();
    return loft(P_OVAL, rings);
  };
  kit.add(limb(1), o.blade);
  kit.add(limb(-1), o.blade);
  kit.add(lathe([
    [0.001, -0.07], [0.021, -0.062], [0.021, 0.062], [0.001, 0.07],
  ], seg), o.grip, 0, 0, 0, -Math.PI / 2, 0, 0);
  // string: a thin bar from tip to tip through the grip side
  kit.add(loft(P_OVAL, [
    { z: -half, sx: 0.0025, sy: 0.0025, ox: 0.030 },
    { z: 0, sx: 0.0025, sy: 0.0025, ox: 0.030 },
    { z: half, sx: 0.0025, sy: 0.0025, ox: 0.030 },
  ]), 'sackcloth');
  kit.add(lathe([
    [0.001, 0], [0.026, 0.005], [0.026, 0.024], [0.001, 0.028],
  ], seg), o.fitting, 0, 0, -0.09, -Math.PI / 2, 0, 0);
}

// ===========================================================================
// 8. Shields
// ===========================================================================

/**
 * @returns {THREE.Object3D|null} +Z is the face normal, +Y up, grip at origin
 */
export function buildShield(id, ctx = {}) {
  const key = normId(id, SHIELD_ALIAS);
  if (!key) return null;

  const asset = SHIELD_ASSET[key];
  if (asset) {
    const modeled = instance(`a:${asset}:${libId(ctx)}`, () => assetGear(ctx, asset, 'shield'));
    if (modeled) return modeled;
  }

  let shape = SHIELD_SHAPE[key];
  if (!shape) {
    warnOnce(`[armory] unknown shield '${id}' — falling back to 木盾`);
    shape = SHIELD_SHAPE.wooden_shield;
  }
  return instance(`s:${key}:${libId(ctx)}:${segFor(ctx)}`, () => {
    const kit = new Kit();
    const seg = segFor(ctx);
    const w = shape.w;
    const h = shape.h;
    const t = shape.t;

    // Board: a kite lofted from the bottom point up to the shoulder, then
    // stood upright. `sx` is half-width, `sy` is half-thickness, so the face
    // ends up bowed rather than a flat slab.
    const rings = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;                 // 0 = bottom point, 1 = top edge
      const y = -h * 0.5 + h * f;
      // Narrow point at the bottom, broad and square across the shoulder.
      const k = f < 0.72 ? Math.pow(f / 0.72, 0.62) : 1 - (f - 0.72) * 0.18;
      rings.push({
        z: y,
        sx: Math.max(0.006, w * 0.5 * k),
        sy: t * 0.5 * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0.05, k)))),
      });
    }
    kit.add(loft(P_OVAL, rings), shape.board, 0, 0, 0, -Math.PI / 2, 0, 0);

    // Rim: an ellipse of tube hugging the widest part of the board.
    kit.add(new THREE.TorusGeometry(w * 0.52, 0.014, 6, Math.max(16, seg * 2)),
      shape.rim, 0, h * 0.10, 0, 0, 0, 0, 1, h / w * 0.82, 1);

    // Boss: rx = +PI/2 sends the lathe axis +Y to +Z so it stands proud of
    // the face rather than sinking into the arm.
    kit.add(lathe([
      [0.001, 0], [0.050, 0.004], [0.056, 0.026], [0.030, 0.052], [0.001, 0.058],
    ], seg), shape.boss, 0, h * 0.06, t * 0.5, Math.PI / 2, 0, 0);
    // grip bar behind the boss
    kit.add(loft(P_OVAL, [
      { z: -0.09, sx: 0.014, sy: 0.014 },
      { z: 0.09, sx: 0.014, sy: 0.014 },
    ]), 'leather', 0, h * 0.06, -0.012, 0, Math.PI / 2, 0);
    return kit.finish(ctx, `shield.${key}`);
  });
}

// ===========================================================================
// 9. Helmets
// ===========================================================================

/**
 * @returns {THREE.Object3D|null} origin at the crown (attach.headTop)
 */
export function buildHelmet(id, ctx = {}) {
  const key = normId(id, HELMET_ALIAS);
  if (!key) return null;
  let shape = HELMET_SHAPE[key];
  if (!shape) {
    warnOnce(`[armory] unknown helmet '${id}' — falling back to 头盔`);
    shape = HELMET_SHAPE.helm;
  }
  return instance(`h:${key}:${libId(ctx)}:${segFor(ctx)}`, () => {
    const kit = new Kit();
    const seg = segFor(ctx);
    const crown = shape.cheek > 0 ? 0.128 : 0.118;

    // Dome: profile runs bottom-to-top (inner wall up, over the crown, outer
    // wall back down) so LatheGeometry's normals come out facing the world.
    kit.add(lathe([
      [crown * 0.80, -0.156], [crown * 0.86, -0.150], [crown * 0.92, -0.100],
      [crown * 0.84, -0.036], [crown * 0.50, 0.002], [0.001, 0.010],
      [crown * 0.44, 0.004], [crown * 0.88, -0.048], [crown, -0.108],
      [crown * 0.99, -0.152], [crown * 0.86, -0.164],
    ], seg * 2), shape.shell, 0, 0, 0);

    // Brow band.
    kit.add(new THREE.TorusGeometry(crown * 0.99, 0.012, 6, Math.max(16, seg * 2)),
      shape.trim, 0, -0.150, 0, Math.PI / 2, 0, 0);

    if (shape.cheek > 0) {
      // Cheek guards: plates hanging beside the jaw, flared outward.
      // rx = +PI/2 sends the loft's +Z downward; ry then leans them out.
      for (const s of [-1, 1]) {
        kit.add(loft(P_PLANK, [
          { z: 0, sx: 0.030, sy: 0.010 },
          { z: 0.070 + 0.090 * shape.cheek, sx: 0.034, sy: 0.009 },
        ]), shape.shell, s * crown * 0.82, -0.142, 0.010, Math.PI / 2, s * 0.20, 0);
      }
      // Nasal bar down the front of the face.
      kit.add(loft(P_PLANK, [
        { z: 0, sx: 0.011, sy: 0.007 },
        { z: 0.030 + 0.055 * shape.cheek, sx: 0.009, sy: 0.006 },
      ]), shape.trim, 0, -0.148, -crown * 0.90, Math.PI / 2, 0, 0);
    }

    if (shape.crest === 'crown') {
      for (let i = 0; i < 3; i++) {
        const a = -0.5 + i * 0.5;
        kit.add(loft(P_PLANK, [
          { z: 0, sx: 0.012, sy: 0.006, oy: -0.02 },
          { z: 0.072, sx: 0.006, sy: 0.004, oy: 0.02 },
        ]), shape.trim, Math.sin(a) * crown * 0.62, 0, -Math.cos(a) * crown * 0.30,
        -Math.PI / 2, a, 0);
      }
    } else if (shape.crest) {
      // Plume: a swept fin along the midline.
      kit.add(loft(P_PLANK, [
        { z: -0.10, sx: 0.006, sy: 0.030, oy: 0.030 },
        { z: 0.02, sx: 0.008, sy: 0.062, oy: 0.046 },
        { z: 0.14, sx: 0.005, sy: 0.030, oy: 0.020 },
      ]), shape.crest, 0, 0.020, 0);
    }

    if (shape.jewel) {
      kit.add(new THREE.SphereGeometry(0.019, seg, seg), shape.jewel, 0, -0.128, -crown * 0.94);
    }
    return kit.finish(ctx, `helm.${key}`);
  });
}

// ===========================================================================
// 10. Armour
// ===========================================================================

/**
 * Parts are authored in character-body space (feet at y=0, up +Y, facing -Z)
 * for a 1.8-unit character. CharacterRig re-parents each onto the joint it
 * belongs to using the rest pose, so they follow the animation.
 *
 * @param {string} id
 * @param {'m'|'f'} build
 * @param {object} ctx
 * @returns {{chest:THREE.Object3D|null, pauldrons:THREE.Object3D|null,
 *            skirt:THREE.Object3D|null, boots:THREE.Object3D|null}}
 */
export function buildArmor(id, build = 'm', ctx = {}) {
  const key = normId(id, ARMOR_ALIAS);
  const empty = { chest: null, pauldrons: null, skirt: null, boots: null };
  if (!key) return empty;
  let shape = ARMOR_SHAPE[key];
  if (!shape) {
    warnOnce(`[armory] unknown armour '${id}' — falling back to 布衣`);
    shape = ARMOR_SHAPE.cloth_robe;
  }
  const b = build === 'f' ? 'f' : 'm';
  const lib = libId(ctx);
  const seg = segFor(ctx);

  return {
    chest: instance(`ac:${key}:${b}:${lib}:${seg}`, () => genArmorChest(ctx, shape, b, seg)),
    pauldrons: shape.pauldron
      ? instance(`ap:${key}:${b}:${lib}:${seg}`, () => genPauldrons(ctx, shape, b, seg))
      : null,
    skirt: instance(`as:${key}:${b}:${lib}:${seg}`, () => genSkirt(ctx, shape, b, seg)),
    boots: instance(`ab:${key}:${b}:${lib}:${seg}`, () => genBoots(ctx, shape, b, seg)),
  };
}

/** Body-space half-widths so male/female silhouettes actually differ. */
function bodyDims(b) {
  return b === 'f'
    ? { sh: 0.168, wa: 0.122, hi: 0.152, dep: 0.098, bust: 0.020 }
    : { sh: 0.216, wa: 0.166, hi: 0.170, dep: 0.126, bust: 0 };
}

function genArmorChest(ctx, shape, b, seg) {
  const kit = new Kit();
  const d = bodyDims(b);
  const bulk = shape.bulk;
  // A shell lofted up the torso: chest at 1.46, waist at 1.06.
  const rings = [];
  const y0 = 1.03;
  const y1 = 1.50;
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const y = y0 + (y1 - y0) * f;
    const w = d.wa + (d.sh - d.wa) * Math.pow(f, 0.8) + bulk;
    const dep = d.dep * (0.92 + 0.20 * f) + bulk;
    rings.push({ z: y, sx: w, sy: dep + (d.bust && f > 0.55 && f < 0.85 ? d.bust : 0) });
  }
  // lofted along +Z then stood up: rx = -PI/2 maps +Z -> +Y... use +PI/2 and flip.
  kit.add(loft(P_OVAL, rings), shape.shell, 0, 0, 0, -Math.PI / 2, 0, 0);

  // Collar: an open flared band, profile bottom-to-top.
  kit.add(lathe([
    [0.052, 1.482], [0.078, 1.500], [0.090, 1.524], [0.086, 1.536],
  ], Math.max(12, seg * 2)), shape.trim);

  // Belt.
  kit.add(lathe([
    [d.wa + bulk + 0.006, 1.030], [d.wa + bulk + 0.022, 1.044],
    [d.wa + bulk + 0.020, 1.076], [d.wa + bulk + 0.004, 1.082],
  ], Math.max(12, seg * 2)), shape.trim, 0, 0, 0, 0, 0, 0, 1, 1, d.dep / d.wa);

  // Buckle.
  kit.add(loft(P_PLANK, [
    { z: 0, sx: 0.030, sy: 0.026 },
    { z: 0.014, sx: 0.024, sy: 0.020 },
  ]), shape.trim === 'leather' ? 'bronze' : shape.trim, 0, 1.056, -(d.dep + bulk + 0.014));
  return kit.finish(ctx, 'armor.chest');
}

function genPauldrons(ctx, shape, b, seg) {
  const kit = new Kit();
  const d = bodyDims(b);
  for (const s of [-1, 1]) {
    // Profile bottom-to-top: outer skirt of the pauldron up over the cap and
    // back down the inside, so it reads as a shell, not a disc.
    kit.add(lathe([
      [0.068, -0.092], [0.078, -0.088], [0.076, -0.048], [0.052, -0.010], [0.001, 0.0],
      [0.001, -0.014], [0.046, -0.022], [0.066, -0.054], [0.062, -0.086],
    ], Math.max(12, seg * 2)), shape.pauldron,
    s * (d.sh + shape.bulk * 1.4), 1.470, 0, 0, 0, s * 0.20);
    kit.add(new THREE.TorusGeometry(0.072, 0.009, 5, Math.max(14, seg * 2)),
      shape.trim, s * (d.sh + shape.bulk * 1.4), 1.470 - 0.092, 0, Math.PI / 2, 0, s * 0.20);
  }
  return kit.finish(ctx, 'armor.pauldrons');
}

function genSkirt(ctx, shape, b, seg) {
  const kit = new Kit();
  const d = bodyDims(b);
  if (shape.skirt === 'robe') {
    // Flowing skirt: a folded cone from the belt to the ankles.
    const folds = b === 'f' ? 9 : 7;
    const pts = [];
    const hem = 0.10;
    const waist = 1.06;
    const steps = 7;
    // Bottom-to-top so the lathe's normals face outward.
    for (let i = 0; i <= steps; i++) {
      const f = 1 - i / steps;
      pts.push([d.hi + (0.130 + (b === 'f' ? 0.020 : 0)) * Math.pow(f, 1.35),
        waist + (hem - waist) * f]);
    }
    const g = lathe(pts, Math.max(12, seg * 2));
    // Push alternate meridians in/out so it reads as cloth, not a lampshade.
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-5) continue;
      const a = Math.atan2(z, x);
      const k = 1 + Math.sin(a * folds) * 0.045;
      pos.setX(i, Math.cos(a) * r * k);
      pos.setZ(i, Math.sin(a) * r * k);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    kit.add(g, shape.shell);
    // Hem band.
    kit.add(lathe([
      [d.hi + 0.140, 0.096], [d.hi + 0.156, 0.108], [d.hi + 0.150, 0.140],
    ], Math.max(12, seg * 2)), shape.trim);
  } else {
    // Tassets: overlapping plates hanging off the belt.
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = -1.25 + (i / (n - 1)) * 2.5;
      const px = Math.sin(a) * (d.hi + shape.bulk + 0.012);
      const pz = -Math.cos(a) * (d.dep + shape.bulk + 0.012);
      // rx = +PI/2 sends the loft's +Z straight down; rz then swings the plate
      // around the waist so it stays tangential to the hips.
      kit.add(loft(P_PLANK, [
        { z: 0, sx: 0.046, sy: 0.008 },
        { z: 0.20, sx: 0.036, sy: 0.008 },
      ]), shape.shell, px, 1.010, pz, Math.PI / 2, 0, a);
    }
    kit.add(lathe([
      [d.hi + shape.bulk + 0.002, 0.984], [d.hi + shape.bulk + 0.018, 0.998],
      [d.hi + shape.bulk + 0.016, 1.026], [d.hi + shape.bulk + 0.004, 1.034],
    ], Math.max(12, seg * 2)), shape.trim, 0, 0, 0, 0, 0, 0, 1, 1, d.dep / d.hi);
  }
  return kit.finish(ctx, 'armor.skirt');
}

function genBoots(ctx, shape, b, seg) {
  const g = new THREE.Group();
  g.name = 'armor.boots';
  for (const s of [-1, 1]) {
    const kit = new Kit();
    const x = s * 0.100;
    // shin cuff
    kit.add(lathe([
      [0.001, 0.0], [0.062, 0.004], [0.064, 0.130], [0.058, 0.190],
      [0.048, 0.192], [0.052, 0.128], [0.050, 0.010], [0.001, 0.006],
    ], seg), shape.boot, 0, 0.02, 0);
    // Foot. Body space faces -Z, so the toe is at negative z; rings still have
    // to run along +Z for loft()'s caps, hence heel-last.
    kit.add(loft(P_OVAL, [
      { z: -0.160, sx: 0.026, sy: 0.016, oy: 0.020 },
      { z: -0.120, sx: 0.046, sy: 0.028, oy: 0.026 },
      { z: -0.030, sx: 0.054, sy: 0.040, oy: 0.034 },
      { z: 0.060, sx: 0.048, sy: 0.036, oy: 0.038 },
    ]), shape.boot, 0, 0, 0);
    // sole
    kit.add(loft(P_PLANK, [
      { z: -0.150, sx: 0.040, sy: 0.008, oy: 0.008 },
      { z: 0.062, sx: 0.046, sy: 0.010, oy: 0.010 },
    ]), 'leather', 0, 0, 0);
    const part = kit.finish(ctx, s < 0 ? 'boot.R' : 'boot.L');
    part.name = s < 0 ? 'bootR' : 'bootL';
    part.position.set(x, 0, 0);
    g.add(part);
  }
  return g;
}

// ===========================================================================
// 11. Shared internals
//
// Not part of CONTRACTS §11b. CharacterRig.js builds its JS-fallback bodies out
// of exactly the same primitives so the fallback and the gear that hangs off it
// stay visually consistent; nothing outside src/entities/ should reach for
// these.
// ===========================================================================

export {
  Kit as GeoKit,
  loft as loftProfile,
  lathe as latheProfile,
  matOf as gearMaterial,
  segFor as gearSegments,
  P_OVAL, P_PLANK, P_DOUBLE, P_SINGLE, P_SLAB,
};

export default {
  buildWeapon, buildArmor, buildHelmet, buildShield, releaseGear, disposeArmory,
  WEAPON_IDS, ARMOR_IDS, HELMET_IDS, SHIELD_IDS,
};
