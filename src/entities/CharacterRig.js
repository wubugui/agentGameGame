/**
 * src/entities/CharacterRig.js — character rigs (CONTRACTS §11).
 *
 * Strategy note: §11 was written before tools/blender/ existed and describes
 * building every body out of lathed/extruded geometry in JS. Real skinned GLBs
 * now ship in assets/models/, so the primary path is
 * `ctx.assets.rig('char_warrior_m', …)`; this module maps the spec onto an
 * asset name, tints the swapped materials to the spec's palette, mounts gear
 * from Armory onto the attach points, and hands back the §11 Rig shape.
 * The JS generator below is the safety net for anything not modeled yet
 * (every monster, today) and for a failed manifest fetch.
 *
 * Two things are load-bearing and were measured off the exported GLBs rather
 * than assumed:
 *
 *  1. FACING. Blender models are authored Y-forward; the glTF exporter maps
 *     that to -Z. The game's convention is `facing = 0` looks toward +Z
 *     (CONTRACTS §0). So the model is parented under a group yawed by π and
 *     `rig.root` is left clean for the Animator to write `rotation.y = facing`
 *     straight into. The JS fallback replicates the *same* rest transforms
 *     (bone-local +Y along the bone, model facing -Z inside the yawed group)
 *     so one Animator clip drives modeled and generated rigs identically.
 *
 *  2. DISPOSAL. `Assets.rig()` clones via SkeletonUtils, which shares geometry
 *     with the prototype scene; its `dispose()` would therefore free geometry
 *     that every future clone still needs. The dispose installed here removes
 *     the rig from the scene, releases pooled gear/body prototypes and the
 *     per-palette material clones, and deliberately leaves GLB geometry to
 *     core/Assets.js. (Reported, not fixed — Assets.js is not this module's.)
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { JOINT_NAMES } from '../core/Assets.js';
import {
  buildWeapon, buildShield, buildHelmet, buildArmor, releaseGear,
  GeoKit, loftProfile, latheProfile, gearMaterial, gearSegments, P_OVAL, P_PLANK,
} from './Armory.js';

// ===========================================================================
// 1. The rest pose — transcribed from the exported char_*.glb node table
// ===========================================================================

/** joint -> { p:parent|null, t:[x,y,z], q:[x,y,z,w], len } (glTF/Y-up space) */
const REST = {
  hips:      { p: null,        t: [0, 0.98, 0],      q: [0, 0, 0, 1], len: 0.14 },
  spine:     { p: 'hips',      t: [0, 0.14, 0],      q: [0, 0, 0, 1], len: 0.18 },
  chest:     { p: 'spine',     t: [0, 0.18, 0],      q: [0, 0, 0, 1], len: 0.22 },
  neck:      { p: 'chest',     t: [0, 0.22, 0],      q: [0, 0, 0, 1], len: 0.10 },
  head:      { p: 'neck',      t: [0, 0.10, 0],      q: [0, 0, 0, 1], len: 0.20 },

  shoulderL: { p: 'chest',     t: [0.075, 0.18, 0],  q: [-0.5369358, -0.4986339, -0.4986340, 0.4630642], len: 0.135 },
  elbowL:    { p: 'shoulderL', t: [0, 0.13537, 0],   q: [-0.4630642, -0.4986340, 0.4986339, 0.5369358], len: 0.27 },
  wristL:    { p: 'elbowL',    t: [0, 0.27, 0],      q: [0, 0, 0, 1], len: 0.24 },

  shoulderR: { p: 'chest',     t: [-0.075, 0.18, 0], q: [-0.5369358, 0.4986339, 0.4986340, 0.4630642], len: 0.135 },
  elbowR:    { p: 'shoulderR', t: [0, 0.13537, 0],   q: [-0.4630642, 0.4986340, -0.4986339, 0.5369358], len: 0.27 },
  wristR:    { p: 'elbowR',    t: [0, 0.27, 0],      q: [0, 0, 0, 1], len: 0.24 },

  hipL:      { p: 'hips',      t: [0.095, -0.02, 0], q: [-0.9999646, -0.0059520, -0.0059519, 0.0000354], len: 0.42 },
  kneeL:     { p: 'hipL',      t: [0, 0.42003, 0],   q: [-0.0000354, -0.0059519, 0.0059520, 0.9999646], len: 0.45 },
  ankleL:    { p: 'kneeL',     t: [0, 0.45, 0],      q: [0.5606288, 0, 0, 0.8280673], len: 0.162 },

  hipR:      { p: 'hips',      t: [-0.095, -0.02, 0], q: [-0.9999646, 0.0059520, 0.0059519, 0.0000354], len: 0.42 },
  kneeR:     { p: 'hipR',      t: [0, 0.42003, 0],   q: [-0.0000354, 0.0059519, -0.0059520, 0.9999646], len: 0.45 },
  ankleR:    { p: 'kneeR',     t: [0, 0.45, 0],      q: [0.5606288, 0, 0, 0.8280673], len: 0.162 },
};

/** Mount points, matching tools/blender/lib/rig.py ATTACH_POINTS. */
const ATTACH_REST = {
  handR:   { p: 'wristR', t: [-0.005, 0.26, 0.02], q: [1, 0, 0, 0] },
  handL:   { p: 'wristL', t: [0.005, 0.26, 0.02],  q: [1, 0, 0, 0] },
  back:    { p: 'chest',  t: [0, 0.12, 0.13],      q: [0, 0, 0, 1] },
  headTop: { p: 'head',   t: [0, 0.18, 0],         q: [0, 0, 0, 1] },
};

/** Nominal modeled height, used when a spec asks for a specific one. */
const NOMINAL_HEIGHT = 1.8;

/** Identity, for parts already authored in body space. */
const IDENTITY_MAT = /* @__PURE__ */ new THREE.Matrix4();

/** joint -> { q, p, iq, ip } world rest transform + its inverse, body space. */
const REST_WORLD = (() => {
  const out = {};
  const build = (name, def) => {
    const parent = def.p ? out[def.p] : null;
    const q = new THREE.Quaternion().fromArray(def.q);
    const p = new THREE.Vector3().fromArray(def.t);
    if (parent) {
      p.applyQuaternion(parent.q).add(parent.p);
      q.premultiply(parent.q);
    }
    const iq = q.clone().invert();
    const ip = p.clone().negate().applyQuaternion(iq);
    out[name] = { q, p, iq, ip };
  };
  for (const [name, def] of Object.entries(REST)) build(name, def);
  for (const [name, def] of Object.entries(ATTACH_REST)) build(name, def);
  return out;
})();

// ===========================================================================
// 2. Asset selection
// ===========================================================================

const ARCHETYPE_ASSET = { warrior: 'warrior', mage: 'mage', taoist: 'taoist' };

/** Explicit NPC ids / roles -> modeled asset. */
const NPC_ASSET = {
  blacksmith: 'npc_blacksmith', blacksmith_mongchon: 'npc_blacksmith',
  apothecary: 'npc_apothecary', apothecary_mongchon: 'npc_apothecary',
  grocer: 'npc_general_store', general: 'npc_general_store',
  tailor: 'npc_tailor', tailor_mongchon: 'npc_tailor',
  storekeeper: 'npc_storage', storekeeper_mongchon: 'npc_storage',
  teleporter: 'npc_master_taoist', teleporter_mongchon: 'npc_villager_f',
  master_warrior: 'npc_master_warrior',
  master_mage: 'npc_master_mage',
  master_taoist: 'npc_master_taoist',
  sabak_guard: 'npc_guard', guard: 'npc_guard',
  villager: 'npc_villager_m', villager_m: 'npc_villager_m', villager_f: 'npc_villager_f',
  // by NPCS[].role
  weapon: 'npc_blacksmith', potion: 'npc_apothecary', armor: 'npc_tailor',
  storage: 'npc_storage', teleport: 'npc_master_taoist',
};

/**
 * STOPGAP. `Npc.js` spreads only `NPCS[id].rig` into the spec, so the NPC's
 * identity never reaches this module; `build|height|weapon` happens to be
 * unique per NPC in Content.js, so we recover it from that. Delete this table
 * the moment the spec carries `asset` / `id` / `role`. Reported upstream.
 */
const NPC_SIGNATURE = {
  'm|1.78|iron_sword': 'npc_blacksmith',
  'm|1.80|crescent_blade': 'npc_blacksmith',
  'f|1.66|': 'npc_apothecary',
  'f|1.63|': 'npc_apothecary',
  'm|1.70|': 'npc_general_store',
  'f|1.64|': 'npc_tailor',
  'f|1.65|': 'npc_tailor',
  'm|1.72|': 'npc_storage',
  'm|1.75|': 'npc_storage',
  'm|1.74|': 'npc_master_taoist',
  'm|1.84|crescent_blade': 'npc_master_warrior',
  'm|1.74|bone_jade_staff': 'npc_master_mage',
  'm|1.76|dragon_tooth': 'npc_master_taoist',
  'm|1.88|judgement_staff': 'npc_guard',
  'f|1.56|': 'npc_villager_f',
};

function npcAssetFor(s) {
  const direct = s.npc || s.npcId || s.id || s.role;
  if (direct && NPC_ASSET[direct]) return NPC_ASSET[direct];
  if (s.teaches) {
    const t = NPC_ASSET[`master_${s.teaches}`];
    if (t) return t;
  }
  const sig = `${s.build}|${(s.height || 0).toFixed(2)}|${s.weapon || ''}`;
  if (NPC_SIGNATURE[sig]) return NPC_SIGNATURE[sig];

  // Last-ditch heuristics from the gear the spec does carry.
  if (s.helmet || s.armor === 'holy_plate' || s.armor === 'demon_armor') return 'npc_guard';
  if (s.weapon === 'bone_jade_staff' || s.weapon === 'soul_devour_staff') return 'npc_master_mage';
  if (s.weapon === 'dragon_tooth') return 'npc_master_taoist';
  if (s.armor === 'medium_armor' || s.armor === 'heavy_armor') return 'npc_master_warrior';
  if (s.weapon) return 'npc_blacksmith';
  return s.build === 'f' ? 'npc_villager_f' : 'npc_villager_m';
}

function humanoidAssetFor(s) {
  if (s.asset) return s.asset;
  if (s.archetype === 'npc') return npcAssetFor(s);
  const base = ARCHETYPE_ASSET[s.archetype];
  if (!base) return null;
  return `char_${base}_${s.build}`;
}

// ===========================================================================
// 3. Palette tinting
// ===========================================================================

/** Blender material slot -> palette key, for humanoids. */
const SLOT_HUMANOID = {
  'skin.pale': 'skin', 'skin.tan': 'skin', 'skin.grey': 'skin',
  chitin: 'hair', furGrey: 'hair', furWhite: 'hair', furBrown: 'hair',
  clothRed: 'cloth', clothBlue: 'cloth', clothWhite: 'cloth',
  silk: 'cloth', sackcloth: 'cloth', banner: 'cloth',
  gold: 'trim', bronze: 'trim',
  iron: 'metal', steel: 'metal', ironRusted: 'metal',
};

/** Beasts have no "hair"; hide and plating both take the body colour. */
const SLOT_BEAST = {
  'skin.pale': 'skin', 'skin.tan': 'skin', 'skin.grey': 'skin',
  furBrown: 'skin', furGrey: 'skin', furWhite: 'skin', hide: 'skin', flesh: 'skin',
  scaleGreen: 'cloth', scaleRed: 'cloth', chitin: 'cloth',
  bone: 'trim', gold: 'trim', bronze: 'trim',
  iron: 'metal', steel: 'metal', ironRusted: 'metal',
};

/** How hard each slot pulls the library colour toward the palette. */
const SLOT_STRENGTH = { skin: 0.92, hair: 0.88, cloth: 0.80, trim: 0.55, metal: 0.55 };

/** Metal/trim accents so an armour upgrade actually reads on a modeled body. */
const ARMOR_ACCENT = {
  light_armor: { metal: 0x8a6a3a },
  medium_armor: { metal: 0x9aa0a8 },
  heavy_armor: { metal: 0xb6bcc4 },
  ghost_armor: { metal: 0xc6d0d4, trim: 0xd8dcd2 },
  taoist_robe: { trim: 0x3f7a52 },
  mage_cloak: { trim: 0x9fb6e6 },
  holy_plate: { metal: 0xd8b45a, trim: 0xffe6a8 },
  demon_armor: { metal: 0x6a2a26, trim: 0xd8b45a },
};

/** `${material.uuid}|${hex}|${strength}` -> { mat, refs } */
const _tints = new Map();
const _tintColor = new THREE.Color();

function tintAcquire(mat, hex, strength) {
  if (!mat || !mat.color || typeof hex !== 'number') return null;
  const key = `${mat.uuid}|${hex}|${strength}`;
  let rec = _tints.get(key);
  if (!rec) {
    let clone;
    try { clone = mat.clone(); } catch (e) { return null; }
    clone.name = mat.name;
    _tintColor.setHex(hex);
    clone.color.lerp(_tintColor, strength);
    rec = { mat: clone, refs: 0 };
    _tints.set(key, rec);
  }
  rec.refs++;
  return { key, mat: rec.mat };
}

function tintRelease(key) {
  const rec = _tints.get(key);
  if (!rec) return;
  rec.refs--;
  if (rec.refs > 0) return;
  _tints.delete(key);
  rec.mat.dispose();
}

/**
 * Swap every mesh material for a palette-tinted clone. Clones are shared
 * between rigs with the same palette, so a town of 20 NPCs costs 20 material
 * objects, not 20 shader programs.
 */
function applyPalette(meshes, palette, slots, owned) {
  if (!palette) return;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const cur = mesh.material;
    if (Array.isArray(cur)) {
      let changed = false;
      const next = cur.slice();
      for (let k = 0; k < cur.length; k++) {
        const t = tintFor(cur[k], palette, slots, owned);
        if (t) { next[k] = t; changed = true; }
      }
      if (changed) mesh.material = next;
    } else {
      const t = tintFor(cur, palette, slots, owned);
      if (t) mesh.material = t;
    }
  }
}

function tintFor(mat, palette, slots, owned) {
  if (!mat || !mat.name) return null;
  const slot = slots[mat.name];
  if (!slot) return null;
  const hex = palette[slot];
  if (typeof hex !== 'number') return null;
  const rec = tintAcquire(mat, hex, SLOT_STRENGTH[slot] || 0.7);
  if (!rec) return null;
  owned.tints.push(rec.key);
  return rec.mat;
}

// ===========================================================================
// 4. Spec normalisation
// ===========================================================================

const DEFAULT_PALETTE = {
  warrior: { skin: 0xd6a882, hair: 0x241a12, cloth: 0x7a2b22, trim: 0xd8b45a, metal: 0x8f939b },
  mage: { skin: 0xe3c2a2, hair: 0x1b1b26, cloth: 0x2b3f86, trim: 0xc9d4f2, metal: 0x6f7c96 },
  taoist: { skin: 0xdcb891, hair: 0x2a2118, cloth: 0xe8e3d4, trim: 0x3f7a52, metal: 0xb9a068 },
  npc: { skin: 0xd9ab84, hair: 0x2b2118, cloth: 0x8a7256, trim: 0xb08a4a, metal: 0x8f939b },
  beast: { skin: 0x6b4d33, hair: 0x3a2a1c, cloth: 0x4a3a2a, trim: 0xded3b8, metal: 0x8c9199 },
};

function normalizeSpec(spec) {
  const src = spec && typeof spec === 'object' ? spec : {};
  const archetype = src.archetype || src.class || src.klass || 'warrior';
  const build = src.build === 'f' ? 'f' : 'm';
  const base = DEFAULT_PALETTE[archetype] || DEFAULT_PALETTE.npc;
  const palette = Object.assign({}, base, src.palette || null);
  const accent = ARMOR_ACCENT[src.armor];
  if (accent) Object.assign(palette, accent);

  const scale = Number.isFinite(src.scale) && src.scale > 0 ? src.scale : 1;
  return {
    archetype,
    build,
    palette,
    scale,
    height: Number.isFinite(src.height) && src.height > 0 ? src.height : 0,
    asset: typeof src.asset === 'string' ? src.asset : (typeof src.model === 'string' ? src.model : null),
    forceGenerated: !!(src.forceGenerated || src.generated),
    armor: src.armor || null,
    helmet: src.helmet || null,
    weapon: src.weapon || null,
    shield: src.shield || null,
    cape: src.cape || null,
    npc: src.npc || null,
    npcId: src.npcId || null,
    id: src.id || null,
    role: src.role || null,
    teaches: src.teaches || null,
    plan: src.plan || src.body || src.shape || null,
    length: Number.isFinite(src.length) && src.length > 0 ? src.length : 0,
    hide: src.hide || src.material || src.mat || null,
    glowEyes: src.glowEyes !== undefined ? !!src.glowEyes : null,
    horns: !!src.horns,
    tail: src.tail !== undefined ? !!src.tail : null,
    wings: !!src.wings,
    legs: Number.isFinite(src.legs) ? src.legs : 0,
    src,
  };
}

// ===========================================================================
// 5. Modeled path
// ===========================================================================

function assetRig(assetName, s, ctx) {
  const assets = ctx && ctx.assets;
  if (!assets || typeof assets.rig !== 'function') return null;
  // has() first, so Assets never warns about models we already know are absent.
  if (typeof assets.has === 'function' && !assets.has(assetName)) return null;
  let rig = null;
  try {
    rig = assets.rig(assetName, { materials: ctx.materials, scale: s.scale });
  } catch (e) {
    console.warn(`[rig] '${assetName}' failed to instance:`, e && e.message);
    return null;
  }
  if (!rig || !rig.root || !rig.joints) return null;

  const inst = rig.root.children[0];
  if (inst) {
    // Blender faces -Z after the Y-up conversion; the game faces +Z.
    inst.rotation.y = Math.PI;
    measureRig(rig);
    if (s.height > 0 && rig.height > 0.05) {
      const k = s.height / rig.height;
      inst.scale.multiplyScalar(k);
      rig.height = s.height;
      rig.radius *= k;
    }
    inst.updateMatrix();
  }
  rig.root.name = assetName;
  return rig;
}

const _measureBox = new THREE.Box3();
const _measureTmp = new THREE.Box3();
const _measureSize = new THREE.Vector3();

/**
 * Re-measure a modeled rig from its bind-pose geometry. `Assets.rig()` measures
 * with `Box3.setFromObject`, which for a SkinnedMesh routes through
 * `SkinnedMesh.computeBoundingBox()` and therefore depends on whatever pose the
 * skeleton happens to be in. Nameplate placement and the collision radius both
 * read these numbers, so take them off the bind pose directly.
 */
function measureRig(rig) {
  rig.root.updateMatrixWorld(true);
  _measureBox.makeEmpty();
  for (let i = 0; i < rig.meshes.length; i++) {
    const m = rig.meshes[i];
    const g = m.geometry;
    if (!g) continue;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) continue;
    _measureTmp.copy(g.boundingBox).applyMatrix4(m.matrixWorld);
    _measureBox.union(_measureTmp);
  }
  if (_measureBox.isEmpty()) return rig;
  _measureBox.getSize(_measureSize);
  if (_measureSize.y > 0.05) rig.height = _measureSize.y;
  rig.radius = Math.max(0.22, Math.max(_measureSize.x, _measureSize.z) * 0.45);
  return rig;
}

// ===========================================================================
// 6. JS fallback bodies — pooled prototypes, cloned per rig
// ===========================================================================

/** key -> { obj:THREE.Object3D, refs:number, height:number, radius:number } */
const _bodies = new Map();

function bodyAcquire(key, factory) {
  let rec = _bodies.get(key);
  if (!rec) {
    let obj = null;
    try { obj = factory(); } catch (e) {
      console.warn(`[rig] fallback body '${key}' failed:`, e && e.message);
      return null;
    }
    if (!obj) return null;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    // Collision radius comes from the body's WIDTH. A quadruped is long, and
    // taking half its length would wedge every wolf in a doorway.
    const width = obj.userData.beastWidth || Math.max(size.x, Math.min(size.z, size.x * 1.5));
    rec = {
      obj,
      refs: 0,
      height: size.y > 0.05 ? size.y : NOMINAL_HEIGHT,
      radius: Math.max(0.2, width * 0.48),
    };
    _bodies.set(key, rec);
  }
  rec.refs++;
  return rec;
}

function bodyRelease(key) {
  const rec = _bodies.get(key);
  if (!rec) return;
  rec.refs--;
  if (rec.refs > 0) return;
  _bodies.delete(key);
  rec.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}

/** Clone a pooled prototype, rebinding its skeleton. */
function cloneBody(rec) {
  return cloneSkinned(rec.obj);
}

/** Collect joints/attach/meshes out of a cloned prototype by node name. */
function harvest(root) {
  const joints = {};
  const attach = {};
  const meshes = [];
  const byName = new Map();
  root.traverse((o) => {
    if (o.name && !byName.has(o.name)) byName.set(o.name, o);
    if (o.isMesh || o.isSkinnedMesh) meshes.push(o);
  });
  for (let i = 0; i < JOINT_NAMES.length; i++) {
    const n = JOINT_NAMES[i];
    let j = byName.get(n);
    if (!j) {
      j = new THREE.Object3D();
      j.name = `${n}__stub`;
      root.add(j);
    }
    joints[n] = j;
  }
  for (const n of ['handR', 'handL', 'back', 'headTop']) {
    attach[n] = byName.get(n) || null;
  }
  return { joints, attach, meshes };
}

/**
 * Build the fallback joint hierarchy: real THREE.Bone objects in the exact
 * rest pose the modeled GLBs use, so one Animator clip drives both. Facing
 * -Z inside `body`, which the caller yaws by π.
 * @returns {{joints:Object, bones:THREE.Bone[], index:Object}}
 */
function skeletonInto(body) {
  const joints = {};
  const bones = [];
  const index = {};
  for (const [name, def] of Object.entries(REST)) {
    const o = new THREE.Bone();
    o.name = name;
    o.position.fromArray(def.t);
    o.quaternion.fromArray(def.q);
    (def.p ? joints[def.p] : body).add(o);
    joints[name] = o;
    index[name] = bones.length;
    bones.push(o);
  }
  for (const [name, def] of Object.entries(ATTACH_REST)) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.fromArray(def.t);
    o.quaternion.fromArray(def.q);
    joints[def.p].add(o);
  }
  return { joints, bones, index };
}

/** Rest-pose bone matrices, so body parts can be baked into bind space. */
const REST_MAT = (() => {
  const out = {};
  const one = new THREE.Vector3(1, 1, 1);
  for (const [name, rw] of Object.entries(REST_WORLD)) {
    out[name] = new THREE.Matrix4().compose(rw.p, rw.q, one);
  }
  return out;
})();

const _skE = new THREE.Euler();
const _skQ = new THREE.Quaternion();
const _skV = new THREE.Vector3();
const _skS = new THREE.Vector3(1, 1, 1);
const _skLocal = new THREE.Matrix4();
const _skFinal = new THREE.Matrix4();

/** Strip a geometry to the exact attribute set mergeGeometries will accept. */
function normalizeGeo(g) {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    const n = g.getAttribute('position').count;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  for (const key of Object.keys(g.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
  }
  if (!g.index) {
    const n = g.getAttribute('position').count;
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(idx);
  }
  return g;
}

/**
 * Accumulates rigidly-weighted body parts and merges them into ONE
 * THREE.SkinnedMesh. A generated monster is a single draw call rather than
 * one per limb, which is what keeps WORLD.activeMonsterBudget affordable when
 * nothing in the bestiary is modeled yet.
 */
class SkinKit {
  constructor() {
    /** @type {Array<{geo:THREE.BufferGeometry, mat:string}>} */
    this.entries = [];
  }

  /** @param {THREE.Matrix4} restM the bone's rest-pose world matrix */
  add(geo, mat, boneIndex, restM, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
    if (!geo) return this;
    _skE.set(rx, ry, rz);
    _skQ.setFromEuler(_skE);
    _skV.set(px, py, pz);
    _skS.set(1, 1, 1);
    _skLocal.compose(_skV, _skQ, _skS);
    _skFinal.multiplyMatrices(restM, _skLocal);
    geo.applyMatrix4(_skFinal);
    normalizeGeo(geo);
    const n = geo.getAttribute('position').count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = boneIndex; sw[i * 4] = 1; }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.entries.push({ geo, mat });
    return this;
  }

  /** Tapered section running 0..len up a bone's local +Y. */
  limb(mat, boneIndex, restM, rings) {
    return this.add(loftProfile(P_OVAL, rings), mat, boneIndex, restM, 0, 0, 0, -Math.PI / 2, 0, 0);
  }

  /** @returns {THREE.SkinnedMesh|null} */
  build(ctx, name) {
    if (!this.entries.length) return null;
    const byMat = new Map();
    for (const e of this.entries) {
      let arr = byMat.get(e.mat);
      if (!arr) { arr = []; byMat.set(e.mat, arr); }
      arr.push(e.geo);
    }
    this.entries.length = 0;

    const mats = [];
    const parts = [];
    for (const [m, geos] of byMat) {
      let g = geos[0];
      if (geos.length > 1) {
        const merged = mergeGeometries(geos, false);
        if (merged) { for (const x of geos) x.dispose(); g = merged; }
        else for (let i = 1; i < geos.length; i++) geos[i].dispose();
      }
      mats.push(gearMaterial(ctx, m));
      parts.push(g);
    }

    let geom = parts[0];
    if (parts.length > 1) {
      const merged = mergeGeometries(parts, true);
      if (merged) { for (const p of parts) p.dispose(); geom = merged; }
      else { for (let i = 1; i < parts.length; i++) parts[i].dispose(); mats.length = 1; }
    }

    // Rigid skinning swings vertices well outside the bind-pose bounds, so
    // pad the culling sphere instead of switching frustum culling off.
    geom.computeBoundingSphere();
    if (geom.boundingSphere) geom.boundingSphere.radius *= 1.7;
    geom.computeBoundingBox();

    const mesh = new THREE.SkinnedMesh(geom, mats.length > 1 ? mats : mats[0]);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * Bake an Armory part — authored in character-body space — into the skinned
 * body, rigidly weighted to one bone. Cloning the geometry here means the
 * generated body owns everything it draws and the Armory instance can go
 * straight back to the pool, which also collapses the armour into the body's
 * single draw call.
 */
function bakePart(kit, part, boneIndex) {
  if (!part) return;
  part.updateMatrixWorld(true);
  part.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const name = (mats[0] && mats[0].name) || 'leather';
    kit.add(g, name, boneIndex, IDENTITY_MAT);
  });
}

/**
 * Finish a generated body: yaw it to the game's facing, then bind the mesh.
 * Order matters — the skeleton's inverses and the mesh's bind matrix are both
 * captured from the world matrices as they stand right now.
 */
function bindBody(root, body, mesh, bones) {
  body.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  if (!mesh) return;
  body.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
}

/** Proportion sets. Warriors are broad, mages lean, Taoists in between. */
const FIGURE = {
  warrior: { sh: 1.16, limb: 1.16, gut: 1.10, robe: false, cape: false },
  mage:    { sh: 0.92, limb: 0.90, gut: 0.94, robe: true, cape: false },
  taoist:  { sh: 1.00, limb: 0.98, gut: 1.00, robe: true, cape: false },
  npc:     { sh: 1.00, limb: 1.00, gut: 1.02, robe: true, cape: false },
};

function genHumanoidBody(s, ctx) {
  const fig = FIGURE[s.archetype] || FIGURE.npc;
  const fem = s.build === 'f';
  const seg = gearSegments(ctx);
  const root = new THREE.Group();
  root.name = 'rig';
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const { joints, bones, index } = skeletonInto(body);
  const B = REST_MAT;

  const SKIN = 'skin.tan';
  const HAIR = 'chitin';
  const CLOTH = 'clothRed';
  const TRIM = 'leather';

  const shW = (fem ? 0.150 : 0.172) * fig.sh;
  const waW = (fem ? 0.112 : 0.138) * fig.gut;
  const hiW = (fem ? 0.140 : 0.144) * fig.gut;
  const dep = (fem ? 0.088 : 0.104) * fig.gut;
  const arm = (fem ? 0.044 : 0.054) * fig.limb;
  const leg = (fem ? 0.070 : 0.078) * fig.limb;

  const kit = new SkinKit();

  // ---- torso ------------------------------------------------------------
  kit.limb(CLOTH, index.hips, B.hips, [
    { z: -0.02, sx: hiW * 1.02, sy: dep * 0.96 },
    { z: 0.06, sx: hiW, sy: dep * 0.94 },
    { z: 0.14, sx: waW * 1.06, sy: dep * 0.90 },
  ]);
  kit.limb(CLOTH, index.spine, B.spine, [
    { z: 0, sx: waW * 1.06, sy: dep * 0.90 },
    { z: 0.10, sx: waW, sy: dep * 0.88 },
    { z: 0.18, sx: waW * 1.10, sy: dep * 0.94 },
  ]);
  kit.limb(CLOTH, index.chest, B.chest, [
    { z: 0, sx: waW * 1.10, sy: dep * 0.94 },
    { z: 0.09, sx: shW * 0.94, sy: dep * (fem ? 1.14 : 1.02) },
    { z: 0.17, sx: shW, sy: dep },
    { z: 0.22, sx: shW * 0.72, sy: dep * 0.80 },
  ]);
  // Deltoid caps, so the silhouette has shoulders rather than a cylinder.
  for (const sx of [-1, 1]) {
    kit.add(latheProfile([
      [0.001, 0.150], [arm * 1.42, 0.144], [arm * 1.50, 0.176], [0.001, 0.190],
    ], seg), CLOTH, index.chest, B.chest, sx * shW * 0.92, 0, 0);
  }
  kit.limb(SKIN, index.neck, B.neck, [
    { z: -0.01, sx: 0.052, sy: 0.048 },
    { z: 0.10, sx: 0.046, sy: 0.044 },
  ]);

  // ---- head -------------------------------------------------------------
  kit.limb(SKIN, index.head, B.head, [
    { z: 0.00, sx: 0.058, sy: 0.058 },
    { z: 0.05, sx: 0.082, sy: 0.086 },
    { z: 0.12, sx: 0.090, sy: 0.096 },
    { z: 0.175, sx: 0.062, sy: 0.064 },
    { z: 0.20, sx: 0.016, sy: 0.018 },
  ]);
  // hair cap + topknot
  kit.add(latheProfile([
    [0.001, 0.196], [0.060, 0.186], [0.092, 0.140], [0.096, 0.096],
    [0.088, 0.092], [0.084, 0.138], [0.054, 0.180], [0.001, 0.190],
  ], seg * 2), HAIR, index.head, B.head);
  kit.add(latheProfile([
    [0.001, 0.196], [0.026, 0.204], [0.030, 0.238], [0.018, 0.256], [0.001, 0.258],
  ], seg), HAIR, index.head, B.head);
  // eyes, sunk under the brow — the head faces -Z inside `body`
  for (const sx of [-1, 1]) {
    kit.add(new THREE.SphereGeometry(0.0125, 8, 6), HAIR, index.head, B.head,
      sx * 0.034, 0.132, -0.078);
  }

  // ---- arms -------------------------------------------------------------
  for (const side of ['L', 'R']) {
    kit.limb(CLOTH, index[`shoulder${side}`], B[`shoulder${side}`], [
      { z: 0.0, sx: arm * 1.30, sy: arm * 1.30 },
      { z: 0.135, sx: arm * 1.10, sy: arm * 1.10 },
    ]);
    kit.limb(CLOTH, index[`elbow${side}`], B[`elbow${side}`], [
      { z: 0.0, sx: arm * 1.10, sy: arm * 1.10 },
      { z: 0.16, sx: arm * 0.92, sy: arm * 0.92 },
      { z: 0.27, sx: arm * 0.80, sy: arm * 0.80 },
    ]);
    kit.limb(fig.robe ? CLOTH : SKIN, index[`wrist${side}`], B[`wrist${side}`], [
      { z: 0.0, sx: arm * 0.84, sy: arm * 0.84 },
      { z: 0.16, sx: arm * 0.66, sy: arm * 0.70 },
      { z: 0.24, sx: arm * 0.58, sy: arm * 0.62 },
    ]);
    kit.limb(SKIN, index[`wrist${side}`], B[`wrist${side}`], [
      { z: 0.24, sx: arm * 0.60, sy: arm * 0.64 },
      { z: 0.30, sx: arm * 0.62, sy: arm * 0.50 },
      { z: 0.335, sx: arm * 0.40, sy: arm * 0.34 },
    ]);
  }

  // ---- legs -------------------------------------------------------------
  for (const side of ['L', 'R']) {
    kit.limb(CLOTH, index[`hip${side}`], B[`hip${side}`], [
      { z: 0.0, sx: leg * 1.16, sy: leg * 1.16 },
      { z: 0.22, sx: leg * 0.98, sy: leg * 1.00 },
      { z: 0.42, sx: leg * 0.84, sy: leg * 0.88 },
    ]);
    kit.limb(CLOTH, index[`knee${side}`], B[`knee${side}`], [
      { z: 0.0, sx: leg * 0.86, sy: leg * 0.90 },
      { z: 0.14, sx: leg * 0.80, sy: leg * 0.84 },
      { z: 0.45, sx: leg * 0.52, sy: leg * 0.56 },
    ]);
    kit.limb(TRIM, index[`ankle${side}`], B[`ankle${side}`], [
      { z: -0.045, sx: leg * 0.62, sy: leg * 0.66 },
      { z: 0.06, sx: leg * 0.70, sy: leg * 0.60 },
      { z: 0.14, sx: leg * 0.56, sy: leg * 0.40 },
      { z: 0.172, sx: leg * 0.30, sy: leg * 0.24 },
    ]);
  }

  // ---- armour, baked into the same skinned mesh --------------------------
  if (s.armor) {
    const parts = buildArmor(s.armor, s.build, ctx);
    bakePart(kit, parts.chest, index.chest);
    bakePart(kit, parts.pauldrons, index.chest);
    bakePart(kit, parts.skirt, index.hips);
    if (parts.boots) {
      parts.boots.updateMatrixWorld(true);
      bakePart(kit, parts.boots.getObjectByName('bootL'), index.ankleL);
      bakePart(kit, parts.boots.getObjectByName('bootR'), index.ankleR);
    }
    for (const key of ['chest', 'pauldrons', 'skirt', 'boots']) releaseGear(parts[key]);
  } else if (fig.robe) {
    // A bare mage/Taoist still needs a skirt or the legs read as pyjamas.
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const f = 1 - i / 6;
      pts.push([hiW + 0.120 * Math.pow(f, 1.3), 1.04 + (0.16 - 1.04) * f]);
    }
    // Authored in body space, so bake it against the hips with no rest offset.
    kit.add(latheProfile(pts, Math.max(12, seg * 2)), CLOTH, index.hips, IDENTITY_MAT);
  }

  bindBody(root, body, kit.build(ctx, 'body.mesh'), bones);
  return root;
}

// ===========================================================================
// 7. JS fallback beasts
// ===========================================================================

const _tmpQ = new THREE.Quaternion();
const _tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ONE_V = new THREE.Vector3(1, 1, 1);

/**
 * Place a joint by world (body-space) position and bone direction, deriving
 * the local transform from the parent. Build-time only.
 */
function placeJoint(parentInfo, parent, name, wx, wy, wz, dir) {
  const o = new THREE.Bone();
  o.name = name;
  const q = new THREE.Quaternion().setFromUnitVectors(UP, _tmpV.copy(dir).normalize());
  const p = new THREE.Vector3(wx, wy, wz);
  if (parentInfo) {
    _tmpQ.copy(parentInfo.q).invert();
    o.quaternion.copy(_tmpQ).multiply(q);
    o.position.copy(p).sub(parentInfo.p).applyQuaternion(_tmpQ);
  } else {
    o.quaternion.copy(q);
    o.position.copy(p);
  }
  parent.add(o);
  return { node: o, q, p, info: { q, p } };
}

const BEAST_PLAN = {
  quadruped: { h: 0.62, len: 1.20, girth: 0.20, legs: 4 },
  insect:    { h: 0.42, len: 0.90, girth: 0.26, legs: 8 },
  serpent:   { h: 0.50, len: 2.20, girth: 0.22, legs: 0 },
  bird:      { h: 0.46, len: 0.60, girth: 0.16, legs: 2 },
};

function genBeastBody(s, ctx) {
  const planName = BEAST_PLAN[s.plan] ? s.plan : 'quadruped';
  const plan = BEAST_PLAN[planName];
  const h = s.height > 0 ? s.height : plan.h;
  const L = s.length > 0 ? s.length : plan.len * (h / plan.h);
  const girth = plan.girth * (h / plan.h);
  const hide = s.hide || (planName === 'insect' ? 'chitin' : planName === 'serpent' ? 'scaleGreen' : 'furBrown');
  const accent = planName === 'insect' ? 'chitin' : 'bone';

  const root = new THREE.Group();
  root.name = 'rig';
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  const backY = h;
  const rear = L * 0.42;
  const fore = -L * 0.34;   // body space faces -Z
  const F = new THREE.Vector3(0, 0, -1);
  const D = new THREE.Vector3(0, -1, 0);

  const bones = [];
  const index = {};
  const mat = {};
  const joints = {};
  const place = (parent, name, wx, wy, wz, dir) => {
    const j = placeJoint(parent ? parent.info : null, parent ? parent.node : body, name, wx, wy, wz, dir);
    joints[name] = j.node;
    index[name] = bones.length;
    mat[name] = new THREE.Matrix4().compose(j.p, j.q, ONE_V);
    bones.push(j.node);
    return j;
  };

  const hips = place(null, 'hips', 0, backY, rear, F);
  const spine = place(hips, 'spine', 0, backY + h * 0.02, rear - L * 0.30, F);
  const chest = place(spine, 'chest', 0, backY + h * 0.03, fore + L * 0.10, F);
  const neck = place(chest, 'neck', 0, backY + h * 0.10, fore - L * 0.02,
    new THREE.Vector3(0, planName === 'serpent' ? 0.1 : 0.45, -1));
  place(neck, 'head', 0, backY + h * 0.22, fore - L * 0.16, F);

  const kit = new SkinKit();

  // Front legs stand in for the arms, hind legs for the legs (rig.py's
  // QUADRUPED_MAP), so Animator never sees an undefined joint. The chain has
  // to reach the ground: upper + lower + paw == the shoulder height.
  const legY = backY - h * 0.08;
  const spread = girth * 0.82;
  const paw = Math.min(h * 0.16, legY * 0.16);
  // The paw bone points down-and-forward, so only part of its length is drop;
  // size the upper chain so the toe lands exactly on y = 0.
  const drop = paw * 0.33;
  const span = Math.max(0.02, legY - drop);
  const upper = span * 0.54;
  const lower = span * 0.46;
  const pairs = [
    ['shoulder', 'elbow', 'wrist', chest, fore + L * 0.16],
    ['hip', 'knee', 'ankle', hips, rear - L * 0.08],
  ];
  for (const [a, b, c, parent, z] of pairs) {
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? spread : -spread;
      const j1 = place(parent, `${a}${side}`, sx, legY, z, D);
      const j2 = place(j1, `${b}${side}`, sx, legY - upper, z + h * 0.05, D);
      place(j2, `${c}${side}`, sx, legY - upper - lower, z + h * 0.02,
        new THREE.Vector3(0, -0.35, -1));

      kit.limb(hide, index[`${a}${side}`], mat[`${a}${side}`], [
        { z: 0, sx: girth * 0.26, sy: girth * 0.26 },
        { z: upper, sx: girth * 0.19, sy: girth * 0.19 },
      ]);
      kit.limb(hide, index[`${b}${side}`], mat[`${b}${side}`], [
        { z: 0, sx: girth * 0.19, sy: girth * 0.19 },
        { z: lower, sx: girth * 0.13, sy: girth * 0.13 },
      ]);
      kit.limb(accent, index[`${c}${side}`], mat[`${c}${side}`], [
        { z: -0.01, sx: girth * 0.15, sy: girth * 0.15 },
        { z: paw, sx: girth * 0.09, sy: girth * 0.07 },
      ]);
    }
  }

  // Extra insect legs, weighted to the chest so they read at a glance.
  if (planName === 'insect') {
    for (let i = 0; i < 2; i++) {
      for (const sx of [-1, 1]) {
        const z = fore + L * (0.34 + i * 0.20);
        kit.add(loftProfile(P_OVAL, [
          { z: 0, sx: girth * 0.10, sy: girth * 0.10 },
          { z: legY * 0.62, sx: girth * 0.07, sy: girth * 0.07, ox: sx * h * 0.30 },
          { z: legY * 1.02, sx: girth * 0.04, sy: girth * 0.04, ox: sx * h * 0.10 },
        ]), hide, index.chest, IDENTITY_MAT,
        sx * spread * 0.8, legY, z, Math.PI / 2 - 0.35, 0, 0);
      }
    }
  }

  // Barrel, skull and tail are authored straight in body space (IDENTITY_MAT)
  // and weighted to whichever bone should carry them.
  kit.add(loftProfile(P_OVAL, [
    { z: fore - L * 0.04, sx: girth * 0.72, sy: girth * 0.74 },
    { z: fore + L * 0.22, sx: girth * 1.00, sy: girth * 1.02 },
    { z: rear - L * 0.22, sx: girth * 0.96, sy: girth * 1.00 },
    { z: rear + L * 0.06, sx: girth * 0.62, sy: girth * 0.66 },
  ]), hide, index.spine, IDENTITY_MAT, 0, backY, 0);

  const hy = backY + h * 0.22;
  const hz = fore - L * 0.16;
  kit.add(loftProfile(P_OVAL, [
    { z: hz - h * 0.40, sx: girth * 0.20, sy: girth * 0.18 },
    { z: hz - h * 0.22, sx: girth * 0.34, sy: girth * 0.32 },
    { z: hz + h * 0.02, sx: girth * 0.40, sy: girth * 0.42 },
    { z: hz + h * 0.16, sx: girth * 0.26, sy: girth * 0.30 },
  ]), hide, index.head, IDENTITY_MAT, 0, hy, 0);

  if (s.horns || planName === 'insect') {
    for (const sx of [-1, 1]) {
      kit.add(loftProfile(P_OVAL, [
        { z: 0, sx: girth * 0.09, sy: girth * 0.09 },
        { z: h * 0.34, sx: girth * 0.03, sy: girth * 0.03, ox: sx * h * 0.14 },
      ]), accent, index.head, IDENTITY_MAT,
      sx * girth * 0.24, hy + girth * 0.28, hz - h * 0.04, -Math.PI / 2 - 0.5, 0, 0);
    }
  }

  const eyeMat = s.glowEyes === false ? accent : 'eye.glow';
  for (const sx of [-1, 1]) {
    kit.add(new THREE.SphereGeometry(Math.max(0.012, girth * 0.075), 8, 6), eyeMat,
      index.head, IDENTITY_MAT, sx * girth * 0.20, hy + girth * 0.10, hz - h * 0.26);
  }

  if (s.tail !== false && planName !== 'bird') {
    kit.add(loftProfile(P_OVAL, [
      { z: rear + L * 0.02, sx: girth * 0.24, sy: girth * 0.24 },
      { z: rear + L * 0.28, sx: girth * 0.13, sy: girth * 0.14 },
      { z: rear + L * 0.50, sx: girth * 0.05, sy: girth * 0.05 },
    ]), hide, index.hips, IDENTITY_MAT, 0, backY - h * 0.02, 0);
  }

  if (s.wings) {
    for (const sx of [-1, 1]) {
      kit.add(loftProfile(P_PLANK, [
        { z: 0, sx: girth * 0.10, sy: L * 0.20 },
        { z: h * 0.9, sx: girth * 0.05, sy: L * 0.34 },
      ]), accent, index.chest, IDENTITY_MAT,
      sx * girth * 0.5, backY + h * 0.12, fore + L * 0.24, 0, 0, sx * 0.6);
    }
  }

  // Beasts have no hands; point the contract's mount names at sane bones so
  // Armory gear (a 骷髅's axe, say) still has somewhere to go.
  for (const [name, src] of [['handR', 'wristR'], ['handL', 'wristL'],
    ['back', 'spine'], ['headTop', 'head']]) {
    const o = new THREE.Object3D();
    o.name = name;
    if (name === 'headTop') o.position.set(0, girth * 0.5, 0);
    joints[src].add(o);
  }

  bindBody(root, body, kit.build(ctx, 'beast.mesh'), bones);
  root.userData.beastWidth = Math.max(girth * 2, spread * 2.4);
  return root;
}

// ===========================================================================
// 8. Gear mounting + rig finalisation
// ===========================================================================

function mountGear(rig, s, ctx, owned) {
  const attach = rig.attach;

  if (s.weapon) {
    const w = buildWeapon(s.weapon, ctx);
    if (w && attach.handR) {
      const mount = new THREE.Object3D();
      mount.name = 'mount.weapon';
      // +Z is the blade; -PI/2 stands it up in the fist, the extra tilt keeps
      // it off the shoulder.
      mount.rotation.set(-Math.PI / 2 - 0.12, 0, 0.06);
      mount.add(w);
      attach.handR.add(mount);
      owned.gear.push(w);
      rig.weapon = w;
    } else if (w) {
      releaseGear(w);
    }
  }

  if (s.shield) {
    const sh = buildShield(s.shield, ctx);
    if (sh && attach.handL) {
      const mount = new THREE.Object3D();
      mount.name = 'mount.shield';
      // +Z is the face normal; the body faces -Z, so turn it around.
      mount.rotation.set(0, Math.PI, -0.18);
      mount.add(sh);
      attach.handL.add(mount);
      owned.gear.push(sh);
      rig.shield = sh;
    } else if (sh) {
      releaseGear(sh);
    }
  }

  if (s.helmet) {
    const hm = buildHelmet(s.helmet, ctx);
    const anchor = attach.headTop || attach.head;
    if (hm && anchor) {
      anchor.add(hm);
      owned.gear.push(hm);
      rig.helmet = hm;
    } else if (hm) {
      releaseGear(hm);
    }
  }

  if (s.cape && attach.back) {
    const cape = genCape(s, ctx);
    if (cape) {
      attach.back.add(cape);
      owned.capes.push(cape);
    }
  }
}

function genCape(s, ctx) {
  const kit = new GeoKit();
  const col = 'clothRed';
  // Authored in the back-attach frame: hangs -Y, bows out +Z (behind).
  kit.add(loftProfile(P_PLANK, [
    { z: 0.02, sx: 0.150, sy: 0.006, oy: 0.010 },
    { z: 0.30, sx: 0.185, sy: 0.006, oy: 0.048 },
    { z: 0.62, sx: 0.215, sy: 0.006, oy: 0.086 },
    { z: 0.86, sx: 0.170, sy: 0.005, oy: 0.104 },
  ]), col, 0, 0, 0, Math.PI / 2, 0, 0);
  return kit.finish(ctx, 'cape');
}

/**
 * Normalise attach points, mount gear, and install a dispose() that actually
 * frees what this module allocated (and nothing core/Assets.js still owns).
 */
function finishRig(rig, s, ctx, owned, slots) {
  rig.attach = rig.attach || {};
  const a = rig.attach;
  if (!a.handR) a.handR = rig.joints.wristR;
  if (!a.handL) a.handL = rig.joints.wristL;
  if (!a.back) a.back = rig.joints.chest;
  if (!a.headTop) a.headTop = a.head || rig.joints.head;
  // CONTRACTS §11 names this `head`; the GLB empties call it `headTop`.
  if (!a.head) a.head = a.headTop;

  applyPalette(rig.meshes, s.palette, slots, owned);
  mountGear(rig, s, ctx, owned);

  // Gear meshes belong in rig.meshes so callers can swap/inspect them.
  for (let i = 0; i < owned.gear.length; i++) {
    owned.gear[i].traverse((o) => { if (o.isMesh || o.isSkinnedMesh) rig.meshes.push(o); });
  }
  for (let i = 0; i < owned.capes.length; i++) {
    owned.capes[i].traverse((o) => { if (o.isMesh) rig.meshes.push(o); });
  }

  rig.archetype = s.archetype;
  rig.spec = s.src;
  rig.dispose = function dispose() {
    if (owned.disposed) return;
    owned.disposed = true;
    for (let i = 0; i < owned.gear.length; i++) releaseGear(owned.gear[i]);
    owned.gear.length = 0;
    for (let i = 0; i < owned.capes.length; i++) {
      const c = owned.capes[i];
      if (c.parent) c.parent.remove(c);
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    owned.capes.length = 0;
    for (let i = 0; i < owned.tints.length; i++) tintRelease(owned.tints[i]);
    owned.tints.length = 0;
    if (owned.bodyKey) { bodyRelease(owned.bodyKey); owned.bodyKey = null; }
    if (rig.root.parent) rig.root.parent.remove(rig.root);
  };
  return rig;
}

function newOwned() {
  return { gear: [], capes: [], tints: [], bodyKey: null, disposed: false };
}

// ===========================================================================
// 9. Public API
// ===========================================================================

/**
 * @param {object} spec
 *   { archetype:'warrior'|'mage'|'taoist'|'npc'|'beast', build:'m'|'f',
 *     height, palette:{skin,hair,cloth,trim,metal}, armor, helmet, weapon,
 *     shield, cape, scale, asset? }
 * @param {object} ctx  { assets, materials, quality, ... }
 * @returns {{root:THREE.Group, joints:Object, attach:Object, height:number,
 *            radius:number, meshes:THREE.Mesh[], dispose:Function}}
 */
export function buildHumanoid(spec, ctx = {}) {
  const s = normalizeSpec(spec);
  if (s.archetype === 'beast') return buildBeast(spec, ctx);

  const owned = newOwned();
  const assetName = s.forceGenerated ? null : humanoidAssetFor(s);
  let rig = assetName ? assetRig(assetName, s, ctx) : null;

  if (!rig) {
    const figure = FIGURE[s.archetype] ? s.archetype : 'npc';
    const key = `hum:${figure}:${s.build}:${s.armor || '-'}:${gearSegments(ctx)}`;
    const rec = bodyAcquire(key, () => genHumanoidBody(s, ctx));
    if (!rec) {
      // Nothing left to fall back to; hand back an empty but legal rig so the
      // caller never crashes on rig.joints.hips.
      rig = emptyRig();
    } else {
      owned.bodyKey = key;
      const root = cloneBody(rec);
      const h = harvest(root);
      let scale = s.scale;
      if (s.height > 0 && rec.height > 0.05) scale *= s.height / rec.height;
      if (scale !== 1) for (const c of root.children) c.scale.setScalar(scale);
      rig = {
        root,
        joints: h.joints,
        attach: h.attach,
        height: s.height > 0 ? s.height : rec.height * scale,
        radius: rec.radius * scale,
        meshes: h.meshes,
        source: `generated:${figure}`,
        dispose() {},
      };
    }
  }

  return finishRig(rig, s, ctx, owned, SLOT_HUMANOID);
}

/**
 * Non-humanoid rig: the same Rig shape and the same 17 joint names, with the
 * front legs standing in for the arms (tools/blender/lib/rig.py QUADRUPED_MAP).
 * @param {object} spec { plan:'quadruped'|'insect'|'serpent'|'bird', height,
 *   length, hide, palette, scale, horns, tail, wings, glowEyes, asset? }
 * @returns {object} Rig
 */
export function buildBeast(spec, ctx = {}) {
  const s = normalizeSpec(spec);
  const owned = newOwned();

  // Humanoid monsters (skeletons, 沃玛/祖玛 lines) reuse the humanoid path, but
  // must not be handed a townsfolk model just because the spec looks like one.
  if (s.plan === 'humanoid' || s.plan === 'biped') {
    return buildHumanoid(Object.assign({}, s.src, {
      archetype: s.src.archetype === 'beast' ? 'npc' : s.src.archetype,
      forceGenerated: s.src.forceGenerated !== undefined ? s.src.forceGenerated : !s.asset,
    }), ctx);
  }

  const assetName = s.asset || (s.id ? `mon_${s.id}` : null);
  let rig = assetName ? assetRig(assetName, s, ctx) : null;

  if (!rig) {
    const key = `beast:${s.plan || 'quadruped'}:${(s.height || 0).toFixed(2)}:${(s.length || 0).toFixed(2)}:${s.hide || '-'}:${s.horns ? 'h' : ''}${s.wings ? 'w' : ''}${s.tail === false ? '' : 't'}:${gearSegments(ctx)}`;
    const rec = bodyAcquire(key, () => genBeastBody(s, ctx));
    if (!rec) {
      rig = emptyRig();
    } else {
      owned.bodyKey = key;
      const root = cloneBody(rec);
      const h = harvest(root);
      if (s.scale !== 1) for (const c of root.children) c.scale.setScalar(s.scale);
      rig = {
        root,
        joints: h.joints,
        attach: h.attach,
        height: rec.height * s.scale,
        radius: rec.radius * s.scale,
        meshes: h.meshes,
        source: `generated:${s.plan || 'quadruped'}`,
        dispose() {},
      };
    }
  }

  return finishRig(rig, s, ctx, owned, SLOT_BEAST);
}

/** A legal, empty Rig — only reached if geometry generation itself throws. */
function emptyRig() {
  const root = new THREE.Group();
  root.name = 'rig.empty';
  const body = new THREE.Group();
  root.add(body);
  const { joints } = skeletonInto(body);
  body.rotation.y = Math.PI;
  const attach = {};
  body.traverse((o) => { if (ATTACH_REST[o.name]) attach[o.name] = o; });
  return {
    root, joints, attach,
    height: NOMINAL_HEIGHT, radius: 0.3, meshes: [],
    source: 'empty', dispose() {},
  };
}

/** Free every pooled fallback body and palette clone. For teardown/tests. */
export function disposeRigCache() {
  for (const rec of _bodies.values()) {
    rec.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  _bodies.clear();
  for (const rec of _tints.values()) rec.mat.dispose();
  _tints.clear();
}

export default { buildHumanoid, buildBeast, disposeRigCache };
