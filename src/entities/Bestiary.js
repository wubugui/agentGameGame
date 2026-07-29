/**
 * src/entities/Bestiary.js — monster data table + rig factory (CONTRACTS §13).
 *
 * Objection noted, implemented as specified: §13's `MonsterDef` has no field for
 * the *shape* of a monster, so the geometry parameters live in an extra `body`
 * block. Extra fields are additive; every field the contract lists is present
 * with the documented meaning, and `src/entities/Monster.js` only ever reads
 * the contract ones (plus `projectileVfx`/`projectileColor`, which Combat asks
 * for).
 *
 * Two build paths, in order:
 *
 *  1. `ctx.assets.rig('mon_<id>', …)` — tools/blender/build.py's naming scheme
 *     (`monsters_field` / `monsters_undead` / `monsters_woma` / `monsters_zuma`
 *     / `monsters_boss` modules, asset key `mon_<id>`). None of those modules
 *     exist yet, so this returns null today.
 *  2. The JS generator below. This is the path that actually runs, so it is
 *     built as a first-class result, not a placeholder: real silhouettes,
 *     merged geometry, prototype-cached and cloned.
 *
 * ------------------------------------------------------------------- rigging
 *
 * Animator (§12) drives 17 named joints and composes poses in *character
 * space* (`L' = qPinv · R · qW`), so the roll of a generated bone around its
 * own axis is irrelevant — only the head→tail direction matters. Every joint
 * here is therefore placed by body-space position + bone direction, exactly
 * like tools/blender/lib/rig.py does, and every one of the 17 names exists even
 * when it is meaningless (a serpent has no knees), so Animator never indexes
 * undefined.
 *
 * Forward is -Z in body space (what the glTF Y-up conversion does to Blender's
 * +Y forward). The `back` mount therefore sits at +Z, which is the signal
 * Animator._measureSkeleton reads to fold the half-turn into the root yaw.
 *
 * -------------------------------------------------------------------- budget
 *
 * WORLD.activeMonsterBudget is 90. Prototypes are built once per (id, quality)
 * and cloned; a clone shares geometry and materials with its prototype, so
 * spawning is a tree copy and nothing else. Geometry is merged per
 * (joint, material) bucket — a spider's eight legs are four meshes, not
 * twenty-four — and at `low` the distal buckets fold into their parents.
 *
 * Because clones share geometry, `rig.dispose()` detaches and drops references
 * but must NOT free the buffers: the next spawn of the same monster needs
 * them. `disposeBestiary()` frees the prototype cache outright; call it on
 * teardown.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JOINT_NAMES } from '../core/Assets.js';

// ===========================================================================
// 0. scratch + tiny helpers (build-time only; nothing here runs per frame)
// ===========================================================================

const UP = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const _dir = /* @__PURE__ */ new THREE.Vector3();
const _q1 = /* @__PURE__ */ new THREE.Quaternion();
const _v1 = /* @__PURE__ */ new THREE.Vector3();
const _m1 = /* @__PURE__ */ new THREE.Matrix4();
const _e1 = /* @__PURE__ */ new THREE.Euler();
const _s1 = /* @__PURE__ */ new THREE.Vector3();
const _box = /* @__PURE__ */ new THREE.Box3();
const _size = /* @__PURE__ */ new THREE.Vector3();

const TAU = Math.PI * 2;

/** Transform a freshly-built geometry in place. Returns it for chaining. */
function T(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e1.set(rx, ry, rz, 'XYZ');
  _q1.setFromEuler(_e1);
  _v1.set(x, y, z);
  _s1.set(sx, sy, sz);
  _m1.compose(_v1, _q1, _s1);
  g.applyMatrix4(_m1);
  return g;
}

/** Merge a list of geometries, disposing the sources. Never throws. */
function weld(list) {
  const geos = list.filter(Boolean);
  if (geos.length === 0) return null;
  if (geos.length === 1) return geos[0];
  let out = null;
  try { out = mergeGeometries(geos, false); } catch (e) { out = null; }
  if (!out) return geos[0];
  for (let i = 0; i < geos.length; i++) geos[i].dispose();
  return out;
}

// ---- primitives -----------------------------------------------------------

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, s) => new THREE.SphereGeometry(r, Math.max(4, s), Math.max(3, s >> 1));
const cap = (r, l, s) => new THREE.CapsuleGeometry(r, Math.max(0.001, l), Math.max(2, s >> 2), Math.max(4, s));
const cyl = (rt, rb, h, s, open = false) => new THREE.CylinderGeometry(rt, rb, h, Math.max(3, s), 1, open);
const con = (r, h, s) => new THREE.ConeGeometry(r, h, Math.max(3, s));
const tor = (r, t, s, arc = TAU) => new THREE.TorusGeometry(r, t, Math.max(3, s >> 1), Math.max(4, s), arc);
const rock = (r, d) => new THREE.IcosahedronGeometry(r, d);

/**
 * A flat triangular panel in the XY plane (thickness along Z). Used for wing
 * membranes, tail feathers and tattered cloth — cheap, and it silhouettes.
 */
function tri(w, h, t) {
  const g = cyl(1, 1, Math.max(0.004, t), 3);
  T(g, 0, 0, 0, -Math.PI / 2, 0, 0);       // triangle now lies in XY, thin in Z
  T(g, 0, 0, 0, 0, 0, Math.PI / 6);        // point one vertex straight up
  T(g, 0, 0, 0, 0, 0, 0, w, h, 1);
  return g;
}

/**
 * A tapered, optionally curved tube starting at the origin and growing along
 * +Y. `bend` is the per-step pitch, `sweep` the per-step yaw — a horn, a rib,
 * a tentacle and a spider femur are all this function.
 */
function tube(len, r0, r1, seg, steps = 3, bend = 0, sweep = 0) {
  const geos = [];
  const acc = new THREE.Matrix4();
  const step = new THREE.Matrix4();
  const rotA = new THREE.Matrix4();
  const rotB = new THREE.Matrix4();
  const h = len / steps;
  for (let i = 0; i < steps; i++) {
    const ra = r0 + (r1 - r0) * (i / steps);
    const rb = r0 + (r1 - r0) * ((i + 1) / steps);
    const g = cyl(rb, ra, h, seg);
    g.translate(0, h * 0.5, 0);
    g.applyMatrix4(acc);
    geos.push(g);
    step.makeTranslation(0, h, 0);
    acc.multiply(step);
    if (bend) { rotA.makeRotationX(bend); acc.multiply(rotA); }
    if (sweep) { rotB.makeRotationZ(sweep); acc.multiply(rotB); }
  }
  return weld(geos);
}

/** Knobbed long bone: shaft plus condyles. The骷髅 line is built from these. */
function longBone(len, r, seg) {
  return weld([
    T(cyl(r * 0.56, r * 0.62, len, seg), 0, len * 0.5, 0),
    T(sph(r, seg), 0, r * 0.35, 0, 0, 0, 0, 1, 0.85, 1),
    T(sph(r * 0.92, seg), 0, len - r * 0.3, 0, 0, 0, 0, 1, 0.85, 1),
  ]);
}

/** Ellipsoid convenience — most organic mass in this file is one of these. */
function blob(rx, ry, rz, seg) { return T(sph(1, seg), 0, 0, 0, 0, 0, 0, rx, ry, rz); }

/**
 * An arc of ribs around a spinal column, authored around the origin with the
 * column on +Z (the back) and the sternum gap on -Z (the chest).
 */
function ribcage(h, w, d, count, seg) {
  const geos = [];
  const t = w * 0.055;
  for (let i = 0; i < count; i++) {
    const f = count > 1 ? i / (count - 1) : 0.5;
    const y = -h * 0.5 + h * f;
    const swell = 0.72 + 0.28 * Math.sin(Math.PI * (0.12 + 0.8 * f));
    const g = tor(w * swell, t, seg, Math.PI * 1.32);
    T(g, 0, y, 0, Math.PI / 2, Math.PI * 0.34, 0, 1, 1, (d / w) * 1.05);
    geos.push(g);
  }
  // spine column: stacked vertebrae so the back reads as bone, not a pipe
  const verts = Math.max(4, count + 2);
  for (let i = 0; i < verts; i++) {
    const y = -h * 0.55 + (h * 1.1 * i) / (verts - 1);
    geos.push(T(box(w * 0.20, h * 0.10, w * 0.17), 0, y, d * 0.52));
  }
  // sternum
  geos.push(T(box(w * 0.16, h * 0.72, t * 2.2), 0, 0, -d * 0.52));
  return weld(geos);
}

// ===========================================================================
// 1. materials
// ===========================================================================

/**
 * Every material this module can ask for, as (library name, overrides). The
 * list is deliberately closed: MaterialLibrary shouts at 400 cached variants
 * and each one is a shader program, so monsters share a fixed palette rather
 * than tinting per instance.
 */
const MATS = {
  bone:        ['bone', null],
  boneOld:     ['bone', { color: 0xa89c7e }],
  beak:        ['bone', { color: 0xd9a83e }],
  featherW:    ['furWhite', null],
  featherB:    ['furBrown', null],
  furGrey:     ['furGrey', null],
  hide:        ['hide', null],
  flesh:       ['flesh', null],
  fleshRot:    ['flesh', { color: 0x74805a }],
  chitin:      ['chitin', null],
  chitinDark:  ['chitin', { color: 0x2f2620 }],
  scaleGreen:  ['scaleGreen', null],
  scaleRed:    ['scaleRed', null],
  iron:        ['iron', null],
  ironRust:    ['ironRusted', null],
  steel:       ['steel', null],
  bronze:      ['bronze', null],
  gold:        ['gold', null],
  rock:        ['rock', null],
  stone:       ['stoneWall', null],
  temple:      ['templeWall', null],
  sack:        ['sackcloth', null],
  straw:       ['thatch', null],
  plank:       ['plank.worn', null],
  cloth:       ['clothRed', null],
  clothBlue:   ['clothBlue', null],
  leather:     ['leather', null],
  lava:        ['lava', null],
  rune:        ['rune', null],
  bead:        ['iron', { color: 0x0b0908, roughness: 0.3, metalness: 0.1 }],
  eyeRed:      ['eye.glow', { emissive: 0xff2a12, color: 0x180402 }],
  eyeAmber:    ['eye.glow', { emissive: 0xffa022, color: 0x1a0d02 }],
  eyeBlue:     ['eye.glow', { emissive: 0x49b8ff, color: 0x02101a }],
  eyeGreen:    ['eye.glow', { emissive: 0x6bff8c, color: 0x03180a }],
  ghost:       ['clothWhite', { transparent: true, opacity: 0.52, depthWrite: false, color: 0xbfe6ff }],
};

/** Locally-owned fallbacks, only used when ctx.materials is missing. */
const _localMats = new Map();

function materialFor(ctx, key) {
  const spec = MATS[key] || MATS.bone;
  const lib = ctx && ctx.materials;
  if (lib && typeof lib.get === 'function') {
    const m = spec[1] ? lib.get(spec[0], spec[1]) : lib.get(spec[0]);
    if (m) return m;
  }
  let m = _localMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ name: `bestiary.${key}`, color: 0x9a8f7c, roughness: 0.85 });
    if (spec[1] && spec[1].emissive !== undefined) {
      m.emissive = new THREE.Color(spec[1].emissive);
      m.emissiveIntensity = 1.9;
    }
    if (spec[1] && spec[1].color !== undefined) m.color.set(spec[1].color);
    _localMats.set(key, m);
  }
  return m;
}

function segmentsFor(quality) {
  if (quality === 'low') return 6;
  if (quality === 'med') return 8;
  if (quality === 'ultra') return 14;
  return 10;
}

// ===========================================================================
// 2. RigForge — joint placement + geometry bucketing
// ===========================================================================

/** Distal joints fold into their parent below `high`, cutting the mesh count. */
const LOD_FOLD = {
  elbowL: 'shoulderL', wristL: 'shoulderL',
  elbowR: 'shoulderR', wristR: 'shoulderR',
  kneeL: 'hipL', ankleL: 'hipL',
  kneeR: 'hipR', ankleR: 'hipR',
  spine: 'hips', neck: 'head',
};

class RigForge {
  constructor(ctx, id, quality) {
    this.ctx = ctx;
    this.id = id;
    this.seg = segmentsFor(quality);
    // Distal buckets fold into their parents below `high`: roughly a third
    // fewer draw calls per monster, for detail that does not survive the
    // isometric camera distance anyway.
    this.fold = quality === 'low' || quality === 'med';

    this.root = new THREE.Group();
    this.root.name = `mon.${id}`;
    this.body = new THREE.Group();
    this.body.name = 'body';
    this.root.add(this.body);

    /** name -> Object3D */
    this.joints = Object.create(null);
    /** name -> { q, p } rest transform in body space */
    this.info = Object.create(null);
    /** `${joint}|${mat}` -> { joint, mat, geos[] } */
    this.buckets = new Map();
    /** Object3Ds Animator should spring-drive (tails, rags). */
    this.secondary = [];
  }

  /**
   * Place a joint by body-space position and bone direction (head -> tail).
   * @returns {THREE.Object3D}
   */
  place(name, parent, x, y, z, dx = 0, dy = 1, dz = 0) {
    const o = new THREE.Object3D();
    o.name = name;
    _dir.set(dx, dy, dz);
    if (_dir.lengthSq() < 1e-9) _dir.set(0, 1, 0);
    _dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, _dir);
    const p = new THREE.Vector3(x, y, z);

    const pi = parent ? this.info[parent] : null;
    const node = parent && this.joints[parent] ? this.joints[parent] : this.body;
    if (pi) {
      _q1.copy(pi.q).invert();
      o.quaternion.copy(_q1).multiply(q);
      o.position.copy(p).sub(pi.p).applyQuaternion(_q1);
    } else {
      o.quaternion.copy(q);
      o.position.copy(p);
    }
    node.add(o);
    this.joints[name] = o;
    this.info[name] = { q, p };
    return o;
  }

  /** A mount point (handR/handL/back/headTop) pinned at a body-space point. */
  mount(name, joint, x, y, z) {
    const host = this.joints[joint] || this.body;
    const pi = this.info[joint];
    const o = new THREE.Object3D();
    o.name = name;
    if (pi) {
      o.quaternion.copy(pi.q).invert();
      o.position.set(x, y, z).sub(pi.p).applyQuaternion(o.quaternion);
    } else {
      o.position.set(x, y, z);
    }
    host.add(o);
    return o;
  }

  /**
   * Queue body-space geometry onto a joint. Geometry is merged per
   * (joint, material) at finish() time.
   */
  add(joint, mat, geo) {
    if (!geo) return;
    let j = joint;
    if (this.fold && LOD_FOLD[j] && this.joints[LOD_FOLD[j]]) j = LOD_FOLD[j];
    if (!this.joints[j]) j = 'hips';
    const key = `${j}|${mat}`;
    let b = this.buckets.get(key);
    if (!b) { b = { joint: j, mat, geos: [] }; this.buckets.set(key, b); }
    b.geos.push(geo);
  }

  /** Same geometry mirrored across X, for anything that comes in pairs. */
  addMirrored(jointL, jointR, mat, makeGeo) {
    this.add(jointL, mat, makeGeo(1));
    this.add(jointR, mat, makeGeo(-1));
  }

  /**
   * A free-swinging child object (tail, rag) that Animator springs. Geometry
   * handed here is authored around the object's own origin, not body space.
   */
  swinger(name, joint, x, y, z, mat, geo, opts) {
    const host = this.joints[joint] || this.body;
    const pi = this.info[joint];
    const o = new THREE.Object3D();
    o.name = name;
    if (pi) {
      o.quaternion.copy(pi.q).invert();
      o.position.set(x, y, z).sub(pi.p).applyQuaternion(o.quaternion);
    } else {
      o.position.set(x, y, z);
    }
    host.add(o);
    if (geo) {
      const mesh = new THREE.Mesh(geo, materialFor(this.ctx, mat));
      mesh.name = `${name}.mesh`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      o.add(mesh);
    }
    this.secondary.push(Object.assign({ object: o, gain: 0.09, limit: 0.45 }, opts || null));
    return o;
  }

  /** Make sure all 17 contract joints exist, stubbing anything unbuilt. */
  _stubMissing() {
    for (let i = 0; i < JOINT_NAMES.length; i++) {
      const n = JOINT_NAMES[i];
      if (this.joints[n]) continue;
      const host = this.joints.hips ? 'hips' : null;
      this.place(n, host, 0, 0, 0, 0, 1, 0);
      this.joints[n].name = n;
    }
  }

  /** Build the merged meshes and hand back a prototype record. */
  finish(scale = 1) {
    this._stubMissing();

    const meshes = [];
    let n = 0;
    for (const b of this.buckets.values()) {
      const geo = weld(b.geos);
      b.geos.length = 0;
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mat = materialFor(this.ctx, b.mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `part${n++}`;
      // A translucent 幽灵战士 casting a solid black shadow gives the game away.
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      const pi = this.info[b.joint];
      if (pi) {
        mesh.quaternion.copy(pi.q).invert();
        mesh.position.copy(pi.p).applyQuaternion(mesh.quaternion).negate();
      }
      this.joints[b.joint].add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();

    if (scale !== 1) this.body.scale.setScalar(scale);
    this.root.updateMatrixWorld(true);

    _box.makeEmpty();
    _box.setFromObject(this.body);
    if (_box.isEmpty()) _box.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 1.6, 0.3));
    _box.getSize(_size);

    // `height` places nameplates and floating damage numbers, so it wants the
    // top of the HEAD, not the tip of a raised halberd or an antler rack. The
    // headTop mount is the honest answer; the bounding box only caps it.
    let top = _size.y;
    const ht = this.joints.head && this.joints.head.getObjectByName('headTop');
    if (ht) {
      ht.getWorldPosition(_v1);
      this.root.worldToLocal(_v1);
      if (_v1.y > 0.05) top = Math.min(_size.y, _v1.y * 1.25);
    }

    // `radius` is a collision/footprint radius. The wide axis of a rig is the
    // T-posed arm span (or a wingspan) and says nothing about how much floor
    // the thing occupies, so weight the narrow horizontal extent heavily.
    const nar = Math.min(_size.x, _size.z);
    const wid = Math.max(_size.x, _size.z);
    const foot = 0.46 * (nar * 0.70 + wid * 0.30);

    return {
      root: this.root,
      height: Math.max(0.3, top),
      radius: Math.min(1.5, Math.max(0.26, foot)),
      meshCount: meshes.length,
      geometries: meshes.map((m) => m.geometry),
      secondaryNames: this.secondary.map((s) => s.object.name),
      secondaryOpts: this.secondary.map((s) => ({ gain: s.gain, limit: s.limit })),
    };
  }
}

// ===========================================================================
// 3. shared joint layouts
// ===========================================================================

/**
 * Upright biped. Returns the measurements the geometry builders need so a
 * skeleton, a minotaur and a 5-unit demon are all the same code with different
 * numbers.
 */
function layoutBiped(f, o = {}) {
  const h = o.h || 1.75;
  const P = {
    h,
    hipY: h * (o.hipF ?? 0.505),
    kneeY: h * (o.kneeF ?? 0.275),
    ankleY: h * (o.ankleF ?? 0.062),
    waistY: h * (o.waistF ?? 0.585),
    chestY: h * (o.chestF ?? 0.695),
    shY: h * (o.shF ?? 0.795),
    neckY: h * (o.neckF ?? 0.845),
    headY: h * (o.headF ?? 0.905),
    hipX: h * (o.hipXF ?? 0.058),
    shX: h * (o.shXF ?? 0.118),
    armR: h * (o.armRF ?? 0.038),
    legR: h * (o.legRF ?? 0.052),
    lean: o.lean ?? 0,
    kneeZ: h * (o.kneeZF ?? 0.018),
    seg: f.seg,
  };
  const lz = Math.sin(P.lean);

  f.place('hips', null, 0, P.hipY, 0, 0, 1, 0);
  f.place('spine', 'hips', 0, P.waistY, -lz * h * 0.02, 0, 1, -P.lean * 0.5);
  f.place('chest', 'spine', 0, P.chestY, -lz * h * 0.06, 0, 1, -P.lean * 0.9);
  f.place('neck', 'chest', 0, P.neckY, -lz * h * 0.10, 0, 1, -P.lean * 0.6);
  f.place('head', 'neck', 0, P.headY, -lz * h * 0.13, 0, 1, -P.lean * 0.2);

  const upper = h * (o.upperArmF ?? 0.155);
  const fore = h * (o.foreArmF ?? 0.150);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    f.place(`shoulder${side}`, 'chest', s * P.shX, P.shY, -lz * h * 0.09, s, -0.10, 0);
    f.place(`elbow${side}`, `shoulder${side}`, s * (P.shX + upper), P.shY - h * 0.026, -lz * h * 0.09, s, -0.22, 0);
    f.place(`wrist${side}`, `elbow${side}`, s * (P.shX + upper + fore), P.shY - h * 0.072, -lz * h * 0.09, s, -0.30, 0);
    f.place(`hip${side}`, 'hips', s * P.hipX, P.hipY - h * 0.018, 0, 0, -1, 0);
    f.place(`knee${side}`, `hip${side}`, s * P.hipX, P.kneeY, P.kneeZ, 0, -1, 0);
    f.place(`ankle${side}`, `knee${side}`, s * P.hipX, P.ankleY, 0, 0, -0.34, -1);
  }

  f.mount('handR', 'wristR', -(P.shX + upper + fore + h * 0.055), P.shY - h * 0.09, -lz * h * 0.09);
  f.mount('handL', 'wristL', P.shX + upper + fore + h * 0.055, P.shY - h * 0.09, -lz * h * 0.09);
  f.mount('back', 'chest', 0, P.chestY + h * 0.05, h * 0.075);
  f.mount('headTop', 'head', 0, P.headY + h * 0.085, -lz * h * 0.13);

  P.upper = upper;
  P.fore = fore;
  return P;
}

/**
 * Four-legged plan. The chest bone runs along the body, which is exactly the
 * signal Animator uses to switch to its diagonal four-limb gait.
 */
function layoutQuad(f, o = {}) {
  const h = o.h || 1.0;            // shoulder height
  const L = o.len || h * 1.5;      // nose-to-rump
  const P = {
    h, L,
    backY: h,
    rear: L * 0.40,
    fore: -L * 0.34,
    spanX: h * (o.spanF ?? 0.17),
    girth: h * (o.girthF ?? 0.24),
    legR: h * (o.legRF ?? 0.048),
    headY: h * (o.headYF ?? 1.28),
    headZ: -L * (o.headZF ?? 0.60),
    seg: f.seg,
  };
  const kneeY = h * (o.kneeF ?? 0.52);
  const ankleY = h * (o.ankleF ?? 0.16);

  f.place('hips', null, 0, P.backY, P.rear, 0, 0.22, -1);
  f.place('spine', 'hips', 0, P.backY + h * 0.02, P.rear - L * 0.26, 0, 0.14, -1);
  f.place('chest', 'spine', 0, P.backY + h * 0.03, P.fore + L * 0.12, 0, 0.16, -1);
  f.place('neck', 'chest', 0, P.backY + h * 0.10, P.fore - L * 0.02, 0, o.neckUp ?? 0.75, -0.7);
  f.place('head', 'neck', 0, P.headY, P.headZ, 0, o.headUp ?? 0.10, -1);

  const frontZ = P.fore + L * 0.16;
  const rearZ = P.rear - L * 0.06;
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    f.place(`shoulder${side}`, 'chest', s * P.spanX, P.backY - h * 0.07, frontZ, 0, -1, 0);
    f.place(`elbow${side}`, `shoulder${side}`, s * P.spanX, kneeY, frontZ + h * 0.03, 0, -1, 0);
    f.place(`wrist${side}`, `elbow${side}`, s * P.spanX, ankleY, frontZ, 0, -0.4, -1);
    f.place(`hip${side}`, 'hips', s * P.spanX, P.backY - h * 0.06, rearZ, 0, -1, 0);
    f.place(`knee${side}`, `hip${side}`, s * P.spanX, kneeY, rearZ - h * 0.04, 0, -1, 0);
    f.place(`ankle${side}`, `knee${side}`, s * P.spanX, ankleY, rearZ, 0, -0.4, -1);
  }

  f.mount('handR', 'wristR', -P.spanX, ankleY, frontZ);
  f.mount('handL', 'wristL', P.spanX, ankleY, frontZ);
  f.mount('back', 'chest', 0, P.backY + h * 0.12, P.rear * 0.4 + 0.02);
  f.mount('headTop', 'head', 0, P.headY + h * 0.16, P.headZ);

  P.kneeY = kneeY;
  P.ankleY = ankleY;
  P.frontZ = frontZ;
  P.rearZ = rearZ;
  return P;
}

// ===========================================================================
// 4. body builders — 比奇城外 (field)
// ===========================================================================

/** 鸡 / 母鸡: compact ovoid, comb, wattle, scaly three-toed legs. */
function buildFowl(f, b) {
  const s = f.seg;
  const h = b.h || 0.62;
  const feather = b.feather || 'featherB';
  const bodyY = h * 0.58;

  // The chest bone stays near-vertical so Animator keeps the wings as arms
  // instead of paddling them along the ground.
  f.place('hips', null, 0, bodyY, h * 0.14, 0, 0.55, -1);
  f.place('spine', 'hips', 0, bodyY + h * 0.04, h * 0.04, 0, 0.7, -1);
  f.place('chest', 'spine', 0, bodyY + h * 0.08, -h * 0.10, 0, 0.92, -0.4);
  f.place('neck', 'chest', 0, bodyY + h * 0.24, -h * 0.19, 0, 0.90, -0.44);
  f.place('head', 'neck', 0, bodyY + h * 0.46, -h * 0.28, 0, 0.28, -1);

  const hipX = h * 0.115;
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.place(`hip${side}`, 'hips', sg * hipX, bodyY - h * 0.06, h * 0.03, 0, -1, 0);
    f.place(`knee${side}`, `hip${side}`, sg * hipX, h * 0.20, h * 0.05, 0, -1, 0);
    f.place(`ankle${side}`, `knee${side}`, sg * hipX, h * 0.035, h * 0.01, 0, -0.25, -1);
    f.place(`shoulder${side}`, 'chest', sg * h * 0.20, bodyY + h * 0.08, -h * 0.06, sg * 0.5, -0.15, 0.85);
    f.place(`elbow${side}`, `shoulder${side}`, sg * h * 0.26, bodyY + h * 0.02, h * 0.10, sg * 0.4, -0.3, 0.86);
    f.place(`wrist${side}`, `elbow${side}`, sg * h * 0.29, bodyY - h * 0.06, h * 0.22, sg * 0.3, -0.4, 0.86);
  }
  f.mount('handR', 'wristR', -h * 0.30, bodyY - h * 0.08, h * 0.26);
  f.mount('handL', 'wristL', h * 0.30, bodyY - h * 0.08, h * 0.26);
  f.mount('back', 'chest', 0, bodyY + h * 0.22, h * 0.16);
  f.mount('headTop', 'head', 0, bodyY + h * 0.62, -h * 0.28);

  // ---- torso ------------------------------------------------------------
  f.add('chest', feather, weld([
    T(blob(h * 0.30, h * 0.29, h * 0.40, s), 0, bodyY + h * 0.02, -h * 0.01),
    T(blob(h * 0.22, h * 0.22, h * 0.20, s), 0, bodyY + h * 0.10, -h * 0.22),   // breast
    // wing coverts lying against the flanks
    T(blob(h * 0.09, h * 0.20, h * 0.30, s), h * 0.26, bodyY + h * 0.04, h * 0.02, 0, 0, -0.25),
    T(blob(h * 0.09, h * 0.20, h * 0.30, s), -h * 0.26, bodyY + h * 0.04, h * 0.02, 0, 0, 0.25),
  ]));

  // rump + tail fan
  const tail = [T(blob(h * 0.20, h * 0.22, h * 0.16, s), 0, bodyY + h * 0.12, h * 0.30)];
  for (let i = -1; i <= 1; i++) {
    tail.push(T(tri(h * 0.10, h * 0.46, h * 0.02), i * h * 0.09, bodyY + h * 0.40, h * 0.40,
      -0.55, i * 0.28, i * 0.10));
  }
  f.add('hips', feather, weld(tail));

  // ---- head -------------------------------------------------------------
  const hy = bodyY + h * 0.46, hz = -h * 0.28;
  f.add('neck', feather, T(cap(h * 0.085, h * 0.20, s), 0, bodyY + h * 0.32, -h * 0.22, 0.42, 0, 0));
  f.add('head', feather, T(blob(h * 0.115, h * 0.115, h * 0.13, s), 0, hy, hz));
  f.add('head', 'beak', weld([
    T(con(h * 0.055, h * 0.15, s), 0, hy - h * 0.01, hz - h * 0.14, -Math.PI / 2, 0, 0),
  ]));
  // comb: three fleshy lobes; wattles under the beak
  const comb = [];
  for (let i = 0; i < 3; i++) {
    comb.push(T(blob(h * 0.018, h * 0.055 * (1 - Math.abs(i - 1) * 0.3), h * 0.05, s),
      0, hy + h * 0.13, hz + h * (0.04 - i * 0.05)));
  }
  comb.push(T(blob(h * 0.022, h * 0.055, h * 0.03, s), h * 0.035, hy - h * 0.10, hz - h * 0.09));
  comb.push(T(blob(h * 0.022, h * 0.055, h * 0.03, s), -h * 0.035, hy - h * 0.10, hz - h * 0.09));
  f.add('head', 'flesh', weld(comb));
  f.add('head', 'bead', weld([
    T(sph(h * 0.022, 6), h * 0.075, hy + h * 0.025, hz - h * 0.055),
    T(sph(h * 0.022, 6), -h * 0.075, hy + h * 0.025, hz - h * 0.055),
  ]));

  // ---- legs -------------------------------------------------------------
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`hip${side}`, feather, T(cap(h * 0.075, h * 0.10, s), sg * hipX, bodyY - h * 0.12, h * 0.03));
    f.add(`knee${side}`, 'beak', T(cyl(h * 0.032, h * 0.040, h * 0.17, s), sg * hipX, h * 0.125, h * 0.03));
    const toes = [T(sph(h * 0.040, 6), sg * hipX, h * 0.035, h * 0.01)];
    for (let t = -1; t <= 1; t++) {
      toes.push(T(cyl(h * 0.014, h * 0.020, h * 0.13, 5), sg * hipX + t * h * 0.035, h * 0.022, -h * 0.055,
        Math.PI / 2 - 0.15, t * 0.42, 0));
    }
    toes.push(T(cyl(h * 0.012, h * 0.018, h * 0.08, 5), sg * hipX, h * 0.022, h * 0.045, -Math.PI / 2 + 0.2, 0, 0));
    f.add(`ankle${side}`, 'beak', weld(toes));
  }
}

/** 鹿 / 饿狼: slender quadruped. `b.antlers` / `b.ruff` pick the species. */
function buildQuadBeast(f, b) {
  const s = f.seg;
  const P = layoutQuad(f, {
    h: b.h, len: b.len, spanF: b.spanF, girthF: b.girthF,
    headYF: b.headYF, headZF: b.headZF, neckUp: b.neckUp, headUp: b.headUp,
    kneeF: b.kneeF, ankleF: b.ankleF,
  });
  const hide = b.hide || 'featherB';
  const g = P.girth;

  // ---- barrel + haunches ------------------------------------------------
  f.add('chest', hide, weld([
    T(blob(g, g * 0.98, P.L * 0.30, s), 0, P.backY - g * 0.16, P.fore + P.L * 0.30),
    T(blob(g * 0.94, g * 0.90, P.L * 0.14, s), 0, P.backY - g * 0.12, P.fore + P.L * 0.10),
    // shoulder mass
    T(blob(g * 0.52, g * 0.55, g * 0.62, s), P.spanX * 0.9, P.backY - g * 0.10, P.frontZ),
    T(blob(g * 0.52, g * 0.55, g * 0.62, s), -P.spanX * 0.9, P.backY - g * 0.10, P.frontZ),
  ]));
  f.add('hips', hide, weld([
    T(blob(g * 1.02, g * 1.00, P.L * 0.22, s), 0, P.backY - g * 0.14, P.rear - P.L * 0.10),
    T(blob(g * 0.60, g * 0.66, g * 0.70, s), P.spanX * 0.95, P.backY - g * 0.08, P.rearZ),
    T(blob(g * 0.60, g * 0.66, g * 0.70, s), -P.spanX * 0.95, P.backY - g * 0.08, P.rearZ),
  ]));

  // ---- neck + head ------------------------------------------------------
  f.add('neck', hide, weld([
    T(cap(g * 0.42, P.L * 0.22, s), 0, P.backY + P.h * 0.16, P.fore - P.L * 0.06, -0.72, 0, 0),
    b.ruff ? T(blob(g * 0.62, g * 0.58, g * 0.42, s), 0, P.backY + P.h * 0.10, P.fore + P.L * 0.02) : null,
  ]));

  const hy = P.headY, hz = P.headZ;
  const headParts = [
    T(blob(g * 0.42, g * 0.42, g * 0.52, s), 0, hy, hz + g * 0.20),
    T(blob(g * 0.26, g * 0.27, g * 0.42, s), 0, hy - g * 0.06, hz - g * 0.24),   // muzzle
    // ears
    T(blob(g * 0.09, g * 0.20, g * 0.06, s), g * 0.24, hy + g * 0.38, hz + g * 0.26, 0.2, 0, -0.35),
    T(blob(g * 0.09, g * 0.20, g * 0.06, s), -g * 0.24, hy + g * 0.38, hz + g * 0.26, 0.2, 0, 0.35),
  ];
  if (b.jaws) {
    headParts.push(T(box(g * 0.30, g * 0.10, g * 0.36), 0, hy - g * 0.20, hz - g * 0.24));
  }
  f.add('head', hide, weld(headParts));
  f.add('head', 'bead', weld([
    T(sph(g * 0.055, 6), g * 0.28, hy + g * 0.10, hz - g * 0.02),
    T(sph(g * 0.055, 6), -g * 0.28, hy + g * 0.10, hz - g * 0.02),
  ]));
  f.add('head', 'bone', T(sph(g * 0.05, 6), 0, hy - g * 0.10, hz - g * 0.44));   // nose

  if (b.jaws) {
    const teeth = [];
    for (let i = -1; i <= 1; i += 2) {
      teeth.push(T(con(g * 0.030, g * 0.11, 5), i * g * 0.11, hy - g * 0.14, hz - g * 0.36, Math.PI, 0, 0));
      teeth.push(T(con(g * 0.026, g * 0.09, 5), i * g * 0.13, hy - g * 0.20, hz - g * 0.30));
    }
    f.add('head', 'bone', weld(teeth));
  }

  if (b.antlers) {
    const A = [];
    for (let i = -1; i <= 1; i += 2) {
      const bx = i * g * 0.20, by = hy + g * 0.34, bz = hz + g * 0.24;
      A.push(T(tube(P.h * 0.46, g * 0.075, g * 0.035, 6, 4, -0.14, i * 0.16),
        bx, by, bz, -0.30, 0, i * -0.34));
      // tines
      A.push(T(tube(P.h * 0.20, g * 0.045, g * 0.018, 5, 2, -0.10, 0),
        bx + i * g * 0.20, by + P.h * 0.20, bz - g * 0.10, -0.9, 0, i * -0.5));
      A.push(T(tube(P.h * 0.16, g * 0.040, g * 0.016, 5, 2, -0.10, 0),
        bx + i * g * 0.12, by + P.h * 0.10, bz + g * 0.02, -0.4, 0, i * -0.9));
    }
    f.add('head', 'boneOld', weld(A));
  }

  // ---- legs -------------------------------------------------------------
  const upperLen = P.backY - P.kneeY;
  const lowerLen = P.kneeY - P.ankleY;
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    for (const [j1, j2, j3, z] of [
      [`shoulder${side}`, `elbow${side}`, `wrist${side}`, P.frontZ],
      [`hip${side}`, `knee${side}`, `ankle${side}`, P.rearZ],
    ]) {
      f.add(j1, hide, T(cyl(P.legR * 0.78, P.legR * 1.35, upperLen, s),
        sg * P.spanX, P.backY - upperLen * 0.5 - P.h * 0.03, z));
      f.add(j2, hide, T(cyl(P.legR * 0.58, P.legR * 0.80, lowerLen, s),
        sg * P.spanX, P.ankleY + lowerLen * 0.5, z));
      f.add(j3, 'chitinDark', weld([
        T(cyl(P.legR * 0.62, P.legR * 0.72, P.ankleY * 1.5, s), sg * P.spanX, P.ankleY * 0.4, z - P.h * 0.01),
        T(blob(P.legR * 0.7, P.ankleY * 0.5, P.legR * 1.1, s), sg * P.spanX, P.ankleY * 0.24, z - P.h * 0.035),
      ]));
    }
  }

  // ---- tail (spring-driven) --------------------------------------------
  const tailGeo = b.bushyTail
    ? weld([T(cap(P.girth * 0.20, P.h * 0.42, s), 0, 0, P.h * 0.26, Math.PI / 2 - 0.4, 0, 0)])
    : weld([T(cap(P.girth * 0.10, P.h * 0.16, s), 0, 0, P.h * 0.09, Math.PI / 2 - 0.7, 0, 0)]);
  f.swinger('tail', 'hips', 0, P.backY + P.girth * 0.30, P.rear + P.girth * 0.30, hide, tailGeo,
    { gain: 0.14, limit: 0.55 });
}

/** 蝙蝠: membranous wings, big ears, hangs its legs. */
function buildBat(f, b) {
  const s = f.seg;
  const h = b.h || 0.72;         // hover height of the body centre
  const bodyY = h;
  const r = h * 0.17;

  f.place('hips', null, 0, bodyY - r * 0.6, r * 0.5, 0, 0.4, -1);
  f.place('spine', 'hips', 0, bodyY - r * 0.2, r * 0.2, 0, 0.7, -1);
  f.place('chest', 'spine', 0, bodyY + r * 0.2, -r * 0.1, 0, 0.94, -0.32);
  f.place('neck', 'chest', 0, bodyY + r * 0.9, -r * 0.3, 0, 0.9, -0.4);
  f.place('head', 'neck', 0, bodyY + r * 1.5, -r * 0.5, 0, 0.3, -1);

  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.place(`shoulder${side}`, 'chest', sg * r * 0.7, bodyY + r * 0.5, -r * 0.1, sg, 0.15, 0.1);
    f.place(`elbow${side}`, `shoulder${side}`, sg * r * 2.4, bodyY + r * 0.9, r * 0.2, sg, -0.1, 0.4);
    f.place(`wrist${side}`, `elbow${side}`, sg * r * 4.2, bodyY + r * 0.7, r * 0.9, sg, -0.3, 0.7);
    // Stubby hooked feet: short enough that Animator falls back to cheap FK
    // rather than trying to plant a foot that never touches the floor.
    f.place(`hip${side}`, 'hips', sg * r * 0.35, bodyY - r * 0.9, r * 0.4, 0, -1, 0);
    f.place(`knee${side}`, `hip${side}`, sg * r * 0.35, bodyY - r * 1.3, r * 0.5, 0, -1, 0);
    f.place(`ankle${side}`, `knee${side}`, sg * r * 0.35, bodyY - r * 1.6, r * 0.4, 0, -0.6, -1);
  }
  f.mount('handR', 'wristR', -r * 4.6, bodyY + r * 0.6, r * 1.0);
  f.mount('handL', 'wristL', r * 4.6, bodyY + r * 0.6, r * 1.0);
  f.mount('back', 'chest', 0, bodyY + r * 0.6, r * 0.9);
  f.mount('headTop', 'head', 0, bodyY + r * 2.3, -r * 0.5);

  f.add('chest', 'fleshRot', weld([
    T(blob(r * 0.72, r * 0.95, r * 0.80, s), 0, bodyY + r * 0.1, 0),
    T(blob(r * 0.50, r * 0.55, r * 0.50, s), 0, bodyY - r * 0.8, r * 0.35),
  ]));

  const hy = bodyY + r * 1.5, hz = -r * 0.5;
  f.add('head', 'fleshRot', weld([
    T(blob(r * 0.44, r * 0.42, r * 0.48, s), 0, hy, hz),
    T(blob(r * 0.22, r * 0.20, r * 0.24, s), 0, hy - r * 0.12, hz - r * 0.40),
    T(tri(r * 0.34, r * 1.05, r * 0.05), r * 0.30, hy + r * 0.85, hz + r * 0.10, -0.25, 0, -0.30),
    T(tri(r * 0.34, r * 1.05, r * 0.05), -r * 0.30, hy + r * 0.85, hz + r * 0.10, -0.25, 0, 0.30),
  ]));
  f.add('head', 'eyeRed', weld([
    T(sph(r * 0.075, 6), r * 0.18, hy + r * 0.10, hz - r * 0.36),
    T(sph(r * 0.075, 6), -r * 0.18, hy + r * 0.10, hz - r * 0.36),
  ]));
  f.add('head', 'bone', weld([
    T(con(r * 0.035, r * 0.14, 5), r * 0.09, hy - r * 0.24, hz - r * 0.44, Math.PI, 0, 0),
    T(con(r * 0.035, r * 0.14, 5), -r * 0.09, hy - r * 0.24, hz - r * 0.44, Math.PI, 0, 0),
  ]));

  // Wings: a finger frame plus two membrane panels, built onto the arm chain
  // so the Animator's arm swing flaps them.
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, 'fleshRot',
      T(cyl(r * 0.09, r * 0.12, r * 1.8, 5), sg * r * 1.55, bodyY + r * 0.7, r * 0.05, 0, sg * 0.1, sg * Math.PI / 2 - sg * 0.12));
    f.add(`elbow${side}`, 'fleshRot', weld([
      T(cyl(r * 0.06, r * 0.09, r * 2.0, 5), sg * r * 3.3, bodyY + r * 0.8, r * 0.55, -0.25, 0, sg * Math.PI / 2),
      T(cyl(r * 0.05, r * 0.07, r * 2.6, 5), sg * r * 3.2, bodyY + r * 0.1, r * 0.9, -0.55, 0, sg * (Math.PI / 2 + 0.5)),
    ]));
    f.add(`elbow${side}`, 'hide', weld([
      T(tri(r * 2.5, r * 2.2, r * 0.02), sg * r * 2.9, bodyY + r * 0.25, r * 0.45, 0, sg * 0.22, sg * -1.85),
      T(tri(r * 1.9, r * 1.9, r * 0.02), sg * r * 1.6, bodyY - r * 0.35, r * 0.75, 0, sg * 0.35, sg * -2.55),
    ]));
    f.add(`ankle${side}`, 'bone',
      T(cyl(r * 0.05, r * 0.07, r * 0.75, 5), sg * r * 0.35, bodyY - r * 1.35, r * 0.45));
  }
}

/** 多角虫: low armoured crawler bristling with horns. */
function buildMultiHorn(f, b) {
  const s = f.seg;
  const h = b.h || 0.48;
  const L = b.len || 1.05;
  const P = layoutQuad(f, {
    h, len: L, spanF: 0.34, girthF: 0.52,
    headYF: 0.92, headZF: 0.56, neckUp: 0.18, headUp: 0.05,
    kneeF: 0.46, ankleF: 0.12,
  });
  const g = P.girth;

  // ---- segmented armoured back -----------------------------------------
  const segsBack = [];
  const segsHips = [];
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = P.fore + L * 0.16 + t * L * 0.66;
    const w = g * (1.05 - Math.abs(t - 0.35) * 0.55);
    const plate = weld([
      T(blob(w, w * 0.72, L * 0.085, s), 0, h * 0.46, z),
      T(tor(w * 0.86, w * 0.14, s, Math.PI), 0, h * 0.44, z, 0, 0, 0, 1, 1, 0.55),
    ]);
    // horns: a crown of spikes per segment, alternating length
    const spikes = [plate];
    const count = 4;
    for (let k = 0; k < count; k++) {
      const a = -Math.PI * 0.42 + (Math.PI * 0.84 * k) / (count - 1);
      const len = h * (0.24 + 0.14 * ((k % 2) === 0 ? 1 : 0.4)) * (1 - t * 0.35);
      spikes.push(T(con(h * 0.052, len, 5),
        Math.sin(a) * w * 0.82, h * 0.46 + Math.cos(a) * w * 0.55, z,
        0.25, 0, -a));
    }
    (t < 0.55 ? segsBack : segsHips).push(weld(spikes));
  }
  f.add('chest', 'chitin', weld(segsBack));
  f.add('hips', 'chitin', weld(segsHips));

  // underbelly
  f.add('chest', 'chitinDark', T(blob(g * 0.82, h * 0.20, L * 0.40, s), 0, h * 0.20, P.fore + L * 0.40));

  // ---- head -------------------------------------------------------------
  const hy = P.headY, hz = P.headZ;
  f.add('head', 'chitin', weld([
    T(blob(g * 0.78, h * 0.34, L * 0.16, s), 0, hy, hz + L * 0.05),
    T(blob(g * 0.50, h * 0.22, L * 0.10, s), 0, hy - h * 0.06, hz - L * 0.10),
  ]));
  const horns = [];
  for (let i = -1; i <= 1; i += 2) {
    horns.push(T(tube(h * 0.62, h * 0.075, h * 0.02, 6, 3, -0.18, 0),
      i * g * 0.40, hy + h * 0.14, hz + L * 0.02, -0.55, 0, i * -0.42));
    horns.push(T(tube(h * 0.38, h * 0.055, h * 0.015, 5, 3, -0.14, 0),
      i * g * 0.58, hy + h * 0.04, hz + L * 0.06, -0.30, 0, i * -0.95));
    // mandibles
    horns.push(T(tube(h * 0.34, h * 0.05, h * 0.018, 5, 3, 0.22, 0),
      i * g * 0.26, hy - h * 0.10, hz - L * 0.14, -1.35, 0, i * -0.30));
  }
  f.add('head', 'boneOld', weld(horns));
  f.add('head', 'eyeAmber', weld([
    T(sph(h * 0.055, 6), g * 0.34, hy + h * 0.06, hz - L * 0.06),
    T(sph(h * 0.055, 6), -g * 0.34, hy + h * 0.06, hz - L * 0.06),
  ]));

  // ---- legs: two driven pairs plus static filler pairs -------------------
  const upperLen = P.backY - P.kneeY;
  const lowerLen = P.kneeY - P.ankleY;
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    for (const [j1, j2, j3, z] of [
      [`shoulder${side}`, `elbow${side}`, `wrist${side}`, P.frontZ],
      [`hip${side}`, `knee${side}`, `ankle${side}`, P.rearZ],
    ]) {
      f.add(j1, 'chitinDark', T(cyl(P.legR * 0.7, P.legR, upperLen, s),
        sg * P.spanX * 1.05, P.backY - upperLen * 0.5 - h * 0.04, z, 0, 0, sg * -0.28));
      f.add(j2, 'chitinDark', T(cyl(P.legR * 0.45, P.legR * 0.68, lowerLen, s),
        sg * P.spanX * 1.25, P.ankleY + lowerLen * 0.5, z, 0, 0, sg * 0.18));
      f.add(j3, 'chitinDark', T(con(P.legR * 0.55, P.ankleY * 1.7, 5),
        sg * P.spanX * 1.3, P.ankleY * 0.5, z - h * 0.02, Math.PI, 0, 0));
    }
    // two extra pairs so it reads as a many-legged crawler, welded to the body
    for (let i = 0; i < 2; i++) {
      const z = P.fore + L * (0.34 + i * 0.20);
      f.add('chest', 'chitinDark', weld([
        T(cyl(P.legR * 0.5, P.legR * 0.8, h * 0.34, 5), sg * P.spanX * 1.15, h * 0.30, z, 0, 0, sg * -0.5),
        T(con(P.legR * 0.45, h * 0.20, 5), sg * P.spanX * 1.42, h * 0.10, z, Math.PI, 0, sg * 0.25),
      ]));
    }
  }
}

/** 蜘蛛: eight three-segment legs, bulbous abdomen, cluster of eyes. */
function buildSpider(f, b) {
  const s = f.seg;
  const h = b.h || 0.55;        // body height off the ground
  const L = b.len || 0.95;
  const g = h * 0.42;

  const bodyY = h * 0.62;
  f.place('hips', null, 0, bodyY, L * 0.26, 0, 0.12, -1);
  f.place('spine', 'hips', 0, bodyY, L * 0.10, 0, 0.10, -1);
  f.place('chest', 'spine', 0, bodyY, -L * 0.08, 0, 0.12, -1);
  f.place('neck', 'chest', 0, bodyY, -L * 0.22, 0, 0.12, -1);
  f.place('head', 'neck', 0, bodyY - h * 0.04, -L * 0.32, 0, 0.05, -1);

  // Two legs per driven limb: front pair on the shoulders, rear pair on the
  // hips. Four merged limb meshes instead of twenty-four loose ones.
  const legPlan = [
    { j: 'shoulder', z: -L * 0.10, spread: 0.55, lift: 0.30 },
    { j: 'hip', z: L * 0.12, spread: 0.30, lift: 0.18 },
  ];
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    for (const plan of legPlan) {
      const par = plan.j === 'shoulder' ? 'chest' : 'hips';
      const kneeName = plan.j === 'shoulder' ? `elbow${side}` : `knee${side}`;
      const footName = plan.j === 'shoulder' ? `wrist${side}` : `ankle${side}`;
      f.place(`${plan.j}${side}`, par, sg * g * 0.55, bodyY, plan.z, sg * 0.75, 0.65, 0);
      f.place(kneeName, `${plan.j}${side}`, sg * (g * 0.55 + h * 0.46), bodyY + h * 0.38, plan.z, sg * 0.55, -0.85, 0);
      f.place(footName, kneeName, sg * (g * 0.55 + h * 0.80), h * 0.06, plan.z, sg * 0.3, -0.4, -0.85);
    }
  }
  f.mount('handR', 'wristR', -(g * 0.55 + h * 0.9), h * 0.04, -L * 0.10);
  f.mount('handL', 'wristL', g * 0.55 + h * 0.9, h * 0.04, -L * 0.10);
  f.mount('back', 'chest', 0, bodyY + g * 0.5, L * 0.30);
  f.mount('headTop', 'head', 0, bodyY + g * 0.6, -L * 0.32);

  // ---- three body segments ---------------------------------------------
  f.add('hips', 'chitin', weld([
    T(blob(g * 1.15, g * 1.05, L * 0.34, s), 0, bodyY + g * 0.06, L * 0.30),
    // abdominal markings
    T(blob(g * 0.34, g * 0.12, L * 0.14, s), 0, bodyY + g * 0.92, L * 0.30),
  ]));
  f.add('chest', 'chitinDark', T(blob(g * 0.84, g * 0.72, L * 0.24, s), 0, bodyY, -L * 0.06));
  f.add('head', 'chitinDark', weld([
    T(blob(g * 0.52, g * 0.46, L * 0.14, s), 0, bodyY - h * 0.04, -L * 0.30),
    // chelicerae
    T(con(g * 0.11, h * 0.24, 5), g * 0.16, bodyY - h * 0.16, -L * 0.40, -2.5, 0, 0.2),
    T(con(g * 0.11, h * 0.24, 5), -g * 0.16, bodyY - h * 0.16, -L * 0.40, -2.5, 0, -0.2),
  ]));

  // eight eyes: two big, six small
  const eyes = [
    T(sph(g * 0.115, 6), g * 0.20, bodyY + h * 0.10, -L * 0.40),
    T(sph(g * 0.115, 6), -g * 0.20, bodyY + h * 0.10, -L * 0.40),
  ];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * g * 0.16;
    eyes.push(T(sph(g * 0.055, 5), x + g * 0.05, bodyY + h * 0.20, -L * 0.365));
    eyes.push(T(sph(g * 0.045, 5), x - g * 0.05, bodyY + h * 0.015, -L * 0.375));
  }
  f.add('head', b.eye || 'eyeRed', weld(eyes));

  // ---- legs: femur / tibia / tarsus -------------------------------------
  const femur = h * 0.62, tibia = h * 0.78, tarsus = h * 0.48;
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    for (const plan of legPlan) {
      const jU = `${plan.j}${side}`;
      const jK = plan.j === 'shoulder' ? `elbow${side}` : `knee${side}`;
      const jF = plan.j === 'shoulder' ? `wrist${side}` : `ankle${side}`;
      const up = [], mid = [], low = [];
      for (let n = 0; n < 2; n++) {
        const zz = plan.z + (n - 0.5) * L * 0.20;
        const yaw = sg * (plan.spread + (n - 0.5) * 0.55);
        up.push(T(cyl(h * 0.045, h * 0.062, femur, 5),
          sg * (g * 0.55 + femur * 0.35), bodyY + femur * 0.28, zz, -0.10, yaw * 0.5, sg * -1.05));
        mid.push(T(cyl(h * 0.034, h * 0.048, tibia, 5),
          sg * (g * 0.55 + femur * 0.72 + tibia * 0.22), bodyY + h * 0.22 - tibia * 0.30, zz,
          0.16, yaw * 0.5, sg * -2.30));
        low.push(T(cyl(h * 0.016, h * 0.032, tarsus, 5),
          sg * (g * 0.55 + femur * 0.86 + tibia * 0.50), h * 0.22, zz, 0.30, yaw * 0.5, sg * -2.85));
      }
      f.add(jU, 'chitinDark', weld(up));
      f.add(jK, 'chitinDark', weld(mid));
      f.add(jF, 'chitinDark', weld(low));
    }
  }
}

/** 稻草人: a lashed post, straw stuffing, a sacking head. */
function buildScarecrow(f, b) {
  const s = f.seg;
  const P = layoutBiped(f, {
    h: b.h || 1.62, hipF: 0.46, kneeF: 0.25, ankleF: 0.05,
    chestF: 0.68, shF: 0.80, neckF: 0.84, headF: 0.90,
    shXF: 0.155, hipXF: 0.052, upperArmF: 0.19, foreArmF: 0.18,
    armRF: 0.030, legRF: 0.040,
  });
  const h = P.h;

  // post + crossbar
  f.add('hips', 'plank', weld([
    T(box(h * 0.055, h * 0.62, h * 0.055), 0, P.hipY - h * 0.16, h * 0.02),
  ]));
  f.add('chest', 'plank', weld([
    T(box(h * 0.05, h * 0.42, h * 0.05), 0, P.chestY + h * 0.03, h * 0.02),
    T(box(h * 0.42, h * 0.036, h * 0.036), 0, P.shY, h * 0.02),
  ]));

  // straw body: a bound bundle with wisps poking out
  const straw = [T(blob(h * 0.135, h * 0.20, h * 0.105, s), 0, P.chestY + h * 0.01, 0)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    straw.push(T(cyl(h * 0.006, h * 0.010, h * 0.20, 4),
      Math.sin(a) * h * 0.10, P.chestY - h * 0.11, Math.cos(a) * h * 0.08,
      Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5));
  }
  f.add('chest', 'straw', weld(straw));
  f.add('hips', 'straw', weld([
    T(blob(h * 0.105, h * 0.10, h * 0.09, s), 0, P.hipY, 0),
  ]));
  f.add('chest', 'cloth', weld([
    T(tor(h * 0.135, h * 0.016, s), 0, P.chestY + h * 0.075, 0, Math.PI / 2, 0, 0),
    T(tor(h * 0.12, h * 0.014, s), 0, P.chestY - h * 0.075, 0, Math.PI / 2, 0, 0),
  ]));

  // head: a stuffed sack, cinched, with stitched eyes and a slash mouth
  const hy = P.headY;
  f.add('head', 'sack', weld([
    T(blob(h * 0.088, h * 0.098, h * 0.086, s), 0, hy, 0),
    T(cyl(h * 0.030, h * 0.052, h * 0.05, s), 0, hy + h * 0.105, 0),
  ]));
  f.add('head', 'cloth', T(tor(h * 0.052, h * 0.012, s), 0, hy + h * 0.086, 0, Math.PI / 2, 0, 0));
  f.add('head', 'bead', weld([
    T(box(h * 0.030, h * 0.008, h * 0.008), h * 0.035, hy + h * 0.020, -h * 0.080, 0, 0, 0.5),
    T(box(h * 0.030, h * 0.008, h * 0.008), h * 0.035, hy + h * 0.020, -h * 0.080, 0, 0, -0.5),
    T(box(h * 0.030, h * 0.008, h * 0.008), -h * 0.035, hy + h * 0.020, -h * 0.080, 0, 0, 0.5),
    T(box(h * 0.030, h * 0.008, h * 0.008), -h * 0.035, hy + h * 0.020, -h * 0.080, 0, 0, -0.5),
    T(box(h * 0.070, h * 0.009, h * 0.009), 0, hy - h * 0.042, -h * 0.076),
  ]));

  // straw limbs
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, 'straw', T(cyl(h * 0.026, h * 0.032, P.upper, 5),
      sg * (P.shX + P.upper * 0.5), P.shY - h * 0.012, h * 0.005, 0, 0, sg * Math.PI / 2));
    f.add(`elbow${side}`, 'straw', T(cyl(h * 0.020, h * 0.026, P.fore, 5),
      sg * (P.shX + P.upper + P.fore * 0.5), P.shY - h * 0.048, h * 0.005, 0, 0, sg * (Math.PI / 2 - 0.16)));
    const wisp = [];
    for (let i = 0; i < 5; i++) {
      wisp.push(T(cyl(h * 0.005, h * 0.008, h * 0.11, 4),
        sg * (P.shX + P.upper + P.fore + h * 0.045), P.shY - h * 0.085, h * 0.005,
        (i - 2) * 0.22, 0, sg * (Math.PI / 2 - 0.4)));
    }
    f.add(`wrist${side}`, 'straw', weld(wisp));

    f.add(`hip${side}`, 'straw', T(cyl(h * 0.030, h * 0.038, P.hipY - P.kneeY, 5),
      sg * P.hipX, (P.hipY + P.kneeY) * 0.5, 0));
    f.add(`knee${side}`, 'straw', T(cyl(h * 0.024, h * 0.030, P.kneeY - P.ankleY, 5),
      sg * P.hipX, (P.kneeY + P.ankleY) * 0.5, P.kneeZ * 0.5));
    f.add(`ankle${side}`, 'sack', T(blob(h * 0.038, h * 0.030, h * 0.055, s),
      sg * P.hipX, P.ankleY * 0.6, -h * 0.012));
  }
}

// ===========================================================================
// 5. body builders — 石墓阵 (undead) and constructs
// ===========================================================================

/** Shared skull: cranium, brow, hollow orbits, jaw, and an ember in each eye. */
function skullGeo(f, r, opts = {}) {
  const s = f.seg;
  return {
    bone: weld([
      T(blob(r, r * 1.02, r * 1.12, s), 0, 0, 0),
      T(blob(r * 0.72, r * 0.44, r * 0.50, s), 0, -r * 0.52, -r * 0.62),        // maxilla
      T(box(r * 1.18, r * 0.32, r * 0.30), 0, r * 0.34, -r * 0.80),             // brow ridge
      T(blob(r * 0.80, r * 0.30, r * 0.62, s), 0, -r * 0.86, -r * 0.46),        // mandible
      T(box(r * 0.16, r * 0.30, r * 0.16), 0, -r * 0.52, -r * 1.02),            // nasal spine
    ]),
    sockets: weld([
      T(blob(r * 0.30, r * 0.28, r * 0.20, s), r * 0.40, r * 0.02, -r * 0.86),
      T(blob(r * 0.30, r * 0.28, r * 0.20, s), -r * 0.40, r * 0.02, -r * 0.86),
      T(blob(r * 0.10, r * 0.16, r * 0.16, s), 0, -r * 0.40, -r * 0.92),
    ]),
    teeth: weld([
      T(box(r * 0.62, r * 0.12, r * 0.10), 0, -r * 0.70, -r * 0.80),
      T(box(r * 0.58, r * 0.11, r * 0.09), 0, -r * 0.80, -r * 0.74),
    ]),
    ember: weld([
      T(sph(r * 0.135, 6), r * 0.40, r * 0.02, -r * 0.80),
      T(sph(r * 0.135, 6), -r * 0.40, r * 0.02, -r * 0.80),
    ]),
    embMat: opts.ember || 'eyeRed',
  };
}

/** 骷髅 / 持斧骷髅 / 骷髅精灵: an articulated bone frame. */
function buildSkeleton(f, b) {
  const s = f.seg;
  const P = layoutBiped(f, {
    h: b.h || 1.72, lean: b.lean || 0.06,
    shXF: b.wide ? 0.135 : 0.115, armRF: 0.030, legRF: 0.038,
  });
  const h = P.h;
  const boneMat = b.boneMat || 'bone';
  const eye = b.eye || 'eyeRed';
  const r = h * 0.072;

  // ---- ribcage + spine + pelvis ----------------------------------------
  f.add('chest', boneMat, T(ribcage(h * 0.26, h * 0.115, h * 0.085, b.ribs || 6, s),
    0, P.chestY - h * 0.01, 0));
  f.add('chest', boneMat, weld([
    // clavicles + scapulae
    T(cyl(h * 0.012, h * 0.014, P.shX * 1.9, 5), 0, P.shY - h * 0.012, -h * 0.045, 0, 0, Math.PI / 2),
    T(box(h * 0.085, h * 0.075, h * 0.018), P.shX * 0.75, P.shY - h * 0.02, h * 0.045),
    T(box(h * 0.085, h * 0.075, h * 0.018), -P.shX * 0.75, P.shY - h * 0.02, h * 0.045),
  ]));
  f.add('spine', boneMat, weld((() => {
    const v = [];
    for (let i = 0; i < 5; i++) {
      const y = P.hipY + h * 0.02 + i * h * 0.019;
      v.push(T(box(h * 0.030, h * 0.014, h * 0.028), 0, y, h * 0.008));
      v.push(T(box(h * 0.014, h * 0.010, h * 0.030), 0, y, h * 0.028));
    }
    return v;
  })()));
  f.add('hips', boneMat, weld([
    T(tor(h * 0.070, h * 0.020, s, Math.PI * 1.15), 0, P.hipY, 0, Math.PI / 2, Math.PI * 0.42, 0, 1, 1, 0.7),
    T(box(h * 0.038, h * 0.062, h * 0.026), 0, P.hipY + h * 0.012, h * 0.038),
    T(blob(h * 0.052, h * 0.028, h * 0.030, s), h * 0.052, P.hipY - h * 0.012, 0),
    T(blob(h * 0.052, h * 0.028, h * 0.030, s), -h * 0.052, P.hipY - h * 0.012, 0),
  ]));

  // ---- skull ------------------------------------------------------------
  const hy = P.headY, hz = -h * 0.012;
  const S = skullGeo(f, r, { ember: eye });
  f.add('head', boneMat, T(weld([S.bone, S.teeth]), 0, hy, hz));
  f.add('head', 'bead', T(S.sockets, 0, hy, hz));
  f.add('head', eye, T(S.ember, 0, hy, hz));
  f.add('neck', boneMat, weld([
    T(cyl(h * 0.020, h * 0.024, h * 0.055, 6), 0, P.neckY + h * 0.020, 0),
  ]));

  // ---- limbs: knobbed long bones ---------------------------------------
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, boneMat, T(longBone(P.upper, h * 0.026, 6),
      sg * P.shX, P.shY, 0, 0, 0, sg * (Math.PI / 2 + 0.10)));
    f.add(`elbow${side}`, boneMat, weld([
      T(longBone(P.fore, h * 0.021, 6), sg * (P.shX + P.upper), P.shY - h * 0.026, 0, 0, 0, sg * (Math.PI / 2 + 0.15)),
      T(cyl(h * 0.011, h * 0.013, P.fore * 0.86, 5), sg * (P.shX + P.upper + P.fore * 0.45), P.shY - h * 0.055, h * 0.018, 0, 0, sg * (Math.PI / 2 + 0.15)),
    ]));
    const hand = [T(blob(h * 0.026, h * 0.016, h * 0.030, s), sg * (P.shX + P.upper + P.fore + h * 0.02), P.shY - h * 0.080, 0)];
    for (let k = -1; k <= 1; k++) {
      hand.push(T(cyl(h * 0.006, h * 0.008, h * 0.052, 4),
        sg * (P.shX + P.upper + P.fore + h * 0.045), P.shY - h * 0.098, k * h * 0.014, 0.2, 0, sg * 1.15));
    }
    f.add(`wrist${side}`, boneMat, weld(hand));

    f.add(`hip${side}`, boneMat, T(longBone(P.hipY - P.kneeY, h * 0.030, 6),
      sg * P.hipX, P.kneeY, 0));
    f.add(`knee${side}`, boneMat, weld([
      T(longBone(P.kneeY - P.ankleY, h * 0.025, 6), sg * P.hipX, P.ankleY, P.kneeZ * 0.4),
      T(cyl(h * 0.010, h * 0.012, (P.kneeY - P.ankleY) * 0.8, 5), sg * P.hipX * 1.35, (P.kneeY + P.ankleY) * 0.5, P.kneeZ * 0.2),
    ]));
    const foot = [T(box(h * 0.042, h * 0.018, h * 0.030), sg * P.hipX, P.ankleY * 0.55, -h * 0.005)];
    for (let k = -1; k <= 1; k++) {
      foot.push(T(cyl(h * 0.006, h * 0.008, h * 0.055, 4),
        sg * P.hipX + k * h * 0.014, P.ankleY * 0.42, -h * 0.038, Math.PI / 2, 0, 0));
    }
    f.add(`ankle${side}`, boneMat, weld(foot));
  }

  // ---- kit --------------------------------------------------------------
  if (b.axe) {
    const ax = P.shX + P.upper + P.fore + h * 0.06;
    f.add('wristR', 'plank', T(cyl(h * 0.014, h * 0.016, h * 0.52, 6), -ax, P.shY - h * 0.10, 0, 0.25, 0, 0));
    f.add('wristR', 'ironRust', weld([
      T(box(h * 0.030, h * 0.14, h * 0.040), -ax, P.shY + h * 0.14, -h * 0.05),
      T(tri(h * 0.10, h * 0.20, h * 0.030), -ax - h * 0.03, P.shY + h * 0.14, -h * 0.10, 0, Math.PI / 2, 0),
      T(tri(h * 0.07, h * 0.15, h * 0.026), -ax + h * 0.03, P.shY + h * 0.14, -h * 0.02, 0, -Math.PI / 2, Math.PI),
    ]));
    // a rusted skullcap so the two skeleton types read apart at a glance
    f.add('head', 'ironRust', weld([
      T(blob(r * 1.12, r * 0.72, r * 1.22, s), 0, hy + r * 0.42, hz),
      T(tor(r * 1.10, r * 0.10, s), 0, hy + r * 0.18, hz, Math.PI / 2, 0, 0, 1, 1, 1.08),
    ]));
  }
  if (b.spectral) {
    // 骷髅精灵: a caged wisp where the heart should be
    f.add('chest', b.eye || 'eyeBlue', T(sph(h * 0.032, s), 0, P.chestY, -h * 0.02));
  }
}

/** 僵尸: hunched, bloated, rotting; ribs showing through split skin. */
function buildZombie(f, b) {
  const s = f.seg;
  const P = layoutBiped(f, {
    h: b.h || 1.68, lean: 0.34, hipF: 0.48, chestF: 0.66, shF: 0.76,
    neckF: 0.80, headF: 0.855, shXF: 0.130, armRF: 0.042, legRF: 0.055,
    upperArmF: 0.170, foreArmF: 0.175,
  });
  const h = P.h;
  const skin = 'fleshRot';

  f.add('chest', skin, weld([
    T(blob(h * 0.145, h * 0.150, h * 0.115, s), 0, P.chestY, -h * 0.030),
    T(blob(h * 0.120, h * 0.095, h * 0.100, s), 0, P.chestY - h * 0.105, -h * 0.010),   // gut
    T(blob(h * 0.075, h * 0.070, h * 0.070, s), P.shX * 0.92, P.shY - h * 0.012, -h * 0.02),
    T(blob(h * 0.075, h * 0.070, h * 0.070, s), -P.shX * 0.92, P.shY - h * 0.012, -h * 0.02),
  ]));
  f.add('hips', skin, T(blob(h * 0.105, h * 0.085, h * 0.090, s), 0, P.hipY, 0));
  // exposed ribs on the left flank
  f.add('chest', 'boneOld', weld((() => {
    const v = [];
    for (let i = 0; i < 4; i++) {
      v.push(T(tor(h * 0.062, h * 0.007, 6, Math.PI * 0.55),
        h * 0.045, P.chestY - h * 0.06 + i * h * 0.032, -h * 0.03,
        Math.PI / 2, Math.PI * 0.72, 0, 1, 1, 0.85));
    }
    return v;
  })()));

  // head lolling to one side
  const hy = P.headY, hz = -h * 0.055;
  f.add('head', skin, weld([
    T(blob(h * 0.078, h * 0.088, h * 0.082, s), 0, hy, hz, 0, 0, 0.22),
    T(blob(h * 0.048, h * 0.034, h * 0.036, s), 0, hy - h * 0.040, hz - h * 0.062),
  ]));
  f.add('head', 'bead', weld([
    T(blob(h * 0.019, h * 0.017, h * 0.012, s), h * 0.030, hy + h * 0.016, hz - h * 0.070),
    T(blob(h * 0.019, h * 0.017, h * 0.012, s), -h * 0.030, hy + h * 0.010, hz - h * 0.070),
  ]));
  f.add('head', 'eyeGreen', weld([
    T(sph(h * 0.010, 5), h * 0.030, hy + h * 0.016, hz - h * 0.078),
    T(sph(h * 0.010, 5), -h * 0.030, hy + h * 0.010, hz - h * 0.078),
  ]));
  f.add('head', 'boneOld', T(box(h * 0.052, h * 0.010, h * 0.010), 0, hy - h * 0.048, hz - h * 0.072));
  f.add('neck', skin, T(cyl(h * 0.030, h * 0.036, h * 0.060, 6), 0, P.neckY + h * 0.02, -h * 0.045, 0.3, 0, 0));

  // torn loincloth
  f.add('hips', 'sack', weld((() => {
    const v = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      v.push(T(box(h * 0.045, h * 0.16, h * 0.010),
        Math.sin(a) * h * 0.085, P.hipY - h * 0.09, Math.cos(a) * h * 0.075,
        0, a, Math.sin(a * 2) * 0.15));
    }
    return v;
  })()));

  // limbs: one arm hangs longer than the other
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    const drop = side === 'R' ? h * 0.03 : 0;
    f.add(`shoulder${side}`, skin, T(cap(h * 0.040, P.upper * 0.78, s),
      sg * (P.shX + P.upper * 0.5), P.shY - h * 0.014, -h * 0.02, 0, 0, sg * (Math.PI / 2 - 0.12)));
    f.add(`elbow${side}`, skin, T(cap(h * 0.033, P.fore * 0.80, s),
      sg * (P.shX + P.upper + P.fore * 0.5), P.shY - h * 0.048 - drop, -h * 0.02, 0, 0, sg * (Math.PI / 2 - 0.22)));
    const hand = [T(blob(h * 0.034, h * 0.022, h * 0.038, s), sg * (P.shX + P.upper + P.fore + h * 0.022), P.shY - h * 0.086 - drop, -h * 0.02)];
    for (let k = -1; k <= 1; k++) {
      hand.push(T(cyl(h * 0.007, h * 0.010, h * 0.062, 4),
        sg * (P.shX + P.upper + P.fore + h * 0.058), P.shY - h * 0.098 - drop, -h * 0.02 + k * h * 0.017, 0.25, 0, sg * 1.05));
    }
    f.add(`wrist${side}`, skin, weld(hand));

    f.add(`hip${side}`, skin, T(cap(h * 0.050, (P.hipY - P.kneeY) * 0.75, s), sg * P.hipX, (P.hipY + P.kneeY) * 0.5, 0));
    f.add(`knee${side}`, skin, T(cap(h * 0.040, (P.kneeY - P.ankleY) * 0.75, s), sg * P.hipX, (P.kneeY + P.ankleY) * 0.5, P.kneeZ * 0.4));
    f.add(`ankle${side}`, skin, T(blob(h * 0.042, h * 0.028, h * 0.070, s), sg * P.hipX, P.ankleY * 0.6, -h * 0.020));
  }
}

/** 石人: fissured rock golem, glowing seams, no neck. */
function buildGolem(f, b) {
  const s = f.seg;
  const P = layoutBiped(f, {
    h: b.h || 2.05, hipF: 0.46, kneeF: 0.25, ankleF: 0.06,
    chestF: 0.70, shF: 0.80, neckF: 0.83, headF: 0.88,
    shXF: 0.175, hipXF: 0.085, armRF: 0.070, legRF: 0.085,
    upperArmF: 0.195, foreArmF: 0.205,
  });
  const h = P.h;
  const stone = b.stone || 'rock';
  const seam = b.seam || 'eyeAmber';

  const chunk = (rr, x, y, z, sx, sy, sz, rot) =>
    T(rock(rr, 0), x, y, z, rot, rot * 1.7, rot * 0.6, sx, sy, sz);

  f.add('chest', stone, weld([
    chunk(h * 0.16, 0, P.chestY, -h * 0.01, 1.15, 1.05, 0.85, 0.3),
    chunk(h * 0.10, P.shX * 0.95, P.shY, 0, 1.1, 0.9, 1.0, 0.7),
    chunk(h * 0.10, -P.shX * 0.95, P.shY, 0, 1.1, 0.9, 1.0, -0.7),
    chunk(h * 0.085, 0, P.chestY + h * 0.075, -h * 0.05, 1.0, 0.7, 0.8, 1.1),
  ]));
  f.add('hips', stone, weld([
    chunk(h * 0.125, 0, P.hipY, 0, 1.15, 0.95, 0.95, -0.4),
    chunk(h * 0.07, 0, P.hipY - h * 0.06, h * 0.02, 1.3, 0.7, 0.9, 0.2),
  ]));

  // glowing seams: thin emissive slabs sunk into the mass
  f.add('chest', seam, weld([
    T(box(h * 0.016, h * 0.115, h * 0.016), h * 0.045, P.chestY + h * 0.01, -h * 0.115, 0, 0, 0.32),
    T(box(h * 0.014, h * 0.085, h * 0.014), -h * 0.055, P.chestY - h * 0.02, -h * 0.110, 0, 0, -0.5),
    T(box(h * 0.090, h * 0.013, h * 0.013), 0, P.chestY + h * 0.055, -h * 0.108, 0, 0, 0.18),
  ]));
  f.add('hips', seam, T(box(h * 0.070, h * 0.013, h * 0.013), 0, P.hipY - h * 0.02, -h * 0.095, 0, 0, -0.2));

  // head: a wedge boulder with two lit fissures for eyes
  const hy = P.headY, hz = -h * 0.015;
  f.add('head', stone, weld([
    chunk(h * 0.085, 0, hy, hz, 1.05, 0.95, 1.0, 0.9),
    chunk(h * 0.045, 0, hy - h * 0.045, hz - h * 0.055, 1.2, 0.7, 0.9, 0.3),
  ]));
  f.add('head', seam, weld([
    T(box(h * 0.032, h * 0.014, h * 0.014), h * 0.035, hy + h * 0.012, hz - h * 0.070, 0, 0, 0.22),
    T(box(h * 0.032, h * 0.014, h * 0.014), -h * 0.035, hy + h * 0.012, hz - h * 0.070, 0, 0, -0.22),
  ]));

  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, stone, weld([
      chunk(h * 0.085, sg * (P.shX + P.upper * 0.45), P.shY - h * 0.02, 0, 0.95, 1.0, 0.95, sg * 0.5),
    ]));
    f.add(`elbow${side}`, stone, weld([
      chunk(h * 0.075, sg * (P.shX + P.upper + P.fore * 0.40), P.shY - h * 0.055, 0, 0.9, 1.0, 0.9, sg * -0.6),
      chunk(h * 0.095, sg * (P.shX + P.upper + P.fore + h * 0.035), P.shY - h * 0.105, 0, 1.0, 0.95, 1.0, sg * 0.9),
    ]));
    f.add(`elbow${side}`, seam,
      T(box(h * 0.010, h * 0.060, h * 0.010), sg * (P.shX + P.upper + P.fore * 0.40), P.shY - h * 0.055, -h * 0.062, 0, 0, sg * 0.4));

    f.add(`hip${side}`, stone, chunk(h * 0.095, sg * P.hipX, (P.hipY + P.kneeY) * 0.5, 0, 0.95, 1.15, 0.95, sg * 0.3));
    f.add(`knee${side}`, stone, chunk(h * 0.085, sg * P.hipX, (P.kneeY + P.ankleY) * 0.5, P.kneeZ * 0.4, 0.95, 1.1, 0.95, sg * -0.4));
    f.add(`ankle${side}`, stone, chunk(h * 0.075, sg * P.hipX, P.ankleY * 0.7, -h * 0.020, 1.15, 0.7, 1.35, sg * 0.2));
  }
}

/** 幽灵战士: a translucent warrior that tapers into a wisp below the waist. */
function buildGhost(f, b) {
  const s = f.seg;
  const P = layoutBiped(f, {
    h: b.h || 1.86, hipF: 0.52, kneeF: 0.30, ankleF: 0.10,
    shXF: 0.125, armRF: 0.036, legRF: 0.045,
  });
  const h = P.h;

  f.add('chest', 'ghost', weld([
    T(blob(h * 0.125, h * 0.145, h * 0.095, s), 0, P.chestY, 0),
    T(blob(h * 0.062, h * 0.062, h * 0.062, s), P.shX * 0.95, P.shY - h * 0.005, 0),
    T(blob(h * 0.062, h * 0.062, h * 0.062, s), -P.shX * 0.95, P.shY - h * 0.005, 0),
    // pauldron spikes so it silhouettes as a soldier, not a sheet
    T(con(h * 0.045, h * 0.10, s), P.shX * 1.05, P.shY + h * 0.055, 0, 0, 0, -0.4),
    T(con(h * 0.045, h * 0.10, s), -P.shX * 1.05, P.shY + h * 0.055, 0, 0, 0, 0.4),
  ]));
  // wisp: the hips taper to nothing instead of legs
  f.add('hips', 'ghost', weld([
    T(cyl(h * 0.105, h * 0.045, P.hipY * 0.85, s), 0, P.hipY - P.hipY * 0.30, 0),
    T(blob(h * 0.100, h * 0.070, h * 0.085, s), 0, P.hipY + h * 0.010, 0),
  ]));

  const hy = P.headY, hz = -h * 0.012;
  const S = skullGeo(f, h * 0.070, { ember: 'eyeBlue' });
  f.add('head', 'ghost', T(weld([S.bone, S.teeth]), 0, hy, hz));
  f.add('head', 'eyeBlue', T(S.ember, 0, hy, hz));
  f.add('head', 'ghost', weld([
    // a horned spectral helm
    T(cyl(h * 0.055, h * 0.075, h * 0.055, s), 0, hy + h * 0.055, hz),
    T(tube(h * 0.13, h * 0.016, h * 0.004, 5, 3, -0.20, 0), h * 0.055, hy + h * 0.060, hz + h * 0.01, -0.3, 0, -0.7),
    T(tube(h * 0.13, h * 0.016, h * 0.004, 5, 3, -0.20, 0), -h * 0.055, hy + h * 0.060, hz + h * 0.01, -0.3, 0, 0.7),
  ]));

  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, 'ghost', T(cap(h * 0.036, P.upper * 0.75, s),
      sg * (P.shX + P.upper * 0.5), P.shY - h * 0.012, 0, 0, 0, sg * (Math.PI / 2 - 0.1)));
    f.add(`elbow${side}`, 'ghost', T(cap(h * 0.030, P.fore * 0.80, s),
      sg * (P.shX + P.upper + P.fore * 0.5), P.shY - h * 0.048, 0, 0, 0, sg * (Math.PI / 2 - 0.2)));
    f.add(`wrist${side}`, 'ghost', T(blob(h * 0.032, h * 0.024, h * 0.036, s),
      sg * (P.shX + P.upper + P.fore + h * 0.020), P.shY - h * 0.082, 0));
    // legs exist as joints but carry no geometry — the wisp covers them
  }

  // spectral blade
  const ax = P.shX + P.upper + P.fore + h * 0.03;
  f.add('wristR', 'eyeBlue', weld([
    T(box(h * 0.020, h * 0.44, h * 0.008), -ax, P.shY + h * 0.12, -h * 0.06, 0.25, 0, 0),
    T(box(h * 0.070, h * 0.014, h * 0.016), -ax, P.shY - h * 0.10, -h * 0.02),
  ]));
}

// ===========================================================================
// 6. body builders — 沃玛 (minotaur line) and 祖玛 (idol line)
// ===========================================================================

/**
 * 沃玛 line: bull-headed brutes. `b.tier` (0..3) escalates armour, horn size
 * and bulk without changing the code path, which is what makes the four of
 * them read as one family.
 */
function buildMinotaur(f, b) {
  const s = f.seg;
  const tier = b.tier || 0;
  const P = layoutBiped(f, {
    h: b.h || 1.90, lean: 0.10, hipF: 0.50, kneeF: 0.29, ankleF: 0.065,
    chestF: 0.685, shF: 0.795, neckF: 0.835, headF: 0.90,
    shXF: 0.150 + tier * 0.006, hipXF: 0.068, armRF: 0.055, legRF: 0.070,
    upperArmF: 0.180, foreArmF: 0.180,
  });
  const h = P.h;
  const fur = b.fur || 'featherB';
  const metal = b.metal || 'ironRust';
  const trim = b.trim || null;

  // ---- torso ------------------------------------------------------------
  f.add('chest', fur, weld([
    T(blob(h * 0.150 + tier * h * 0.006, h * 0.150, h * 0.110, s), 0, P.chestY, -h * 0.012),
    T(blob(h * 0.120, h * 0.075, h * 0.090, s), 0, P.chestY - h * 0.095, -h * 0.005),
    T(blob(h * 0.088, h * 0.078, h * 0.080, s), P.shX * 0.90, P.shY - h * 0.010, -h * 0.005),
    T(blob(h * 0.088, h * 0.078, h * 0.080, s), -P.shX * 0.90, P.shY - h * 0.010, -h * 0.005),
  ]));
  f.add('hips', fur, weld([
    T(blob(h * 0.108, h * 0.085, h * 0.092, s), 0, P.hipY, 0),
  ]));
  // pectoral / abdominal definition
  f.add('chest', 'hide', weld([
    T(blob(h * 0.062, h * 0.038, h * 0.030, s), h * 0.052, P.chestY + h * 0.045, -h * 0.088),
    T(blob(h * 0.062, h * 0.038, h * 0.030, s), -h * 0.052, P.chestY + h * 0.045, -h * 0.088),
  ]));

  // ---- armour -----------------------------------------------------------
  if (tier >= 1) {
    f.add('chest', metal, weld([
      T(blob(h * 0.098, h * 0.058, h * 0.045, s), P.shX * 0.96, P.shY + h * 0.030, -h * 0.005),
      T(blob(h * 0.098, h * 0.058, h * 0.045, s), -P.shX * 0.96, P.shY + h * 0.030, -h * 0.005),
    ]));
  }
  if (tier >= 2) {
    f.add('chest', metal, weld([
      T(blob(h * 0.140, h * 0.100, h * 0.026, s), 0, P.chestY + h * 0.010, -h * 0.098),
      T(cyl(h * 0.075, h * 0.075, h * 0.020, s), 0, P.chestY + h * 0.035, -h * 0.112, Math.PI / 2, 0, 0),
    ]));
    f.add('hips', metal, weld([
      T(tor(h * 0.108, h * 0.020, s), 0, P.hipY - h * 0.045, 0, Math.PI / 2, 0, 0, 1, 1, 0.88),
    ]));
  }
  if (tier >= 3) {
    // spiked pauldrons and a heavy skirt of plates
    const sp = [];
    for (let i = -1; i <= 1; i += 2) {
      for (let k = 0; k < 3; k++) {
        sp.push(T(con(h * 0.020, h * 0.070, 5),
          i * (P.shX * 0.96 + (k - 1) * h * 0.030), P.shY + h * 0.075, -h * 0.005 + (k - 1) * h * 0.018,
          0.15, 0, i * -0.35));
      }
    }
    f.add('chest', trim || metal, weld(sp));
    const skirt = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      skirt.push(T(box(h * 0.055, h * 0.135, h * 0.014),
        Math.sin(a) * h * 0.105, P.hipY - h * 0.100, Math.cos(a) * h * 0.095, 0, a, 0));
    }
    f.add('hips', metal, weld(skirt));
  }

  // ---- bull head --------------------------------------------------------
  const hy = P.headY, hz = -h * 0.030;
  const hornScale = 0.8 + tier * 0.28;
  f.add('neck', fur, T(cyl(h * 0.050, h * 0.062, h * 0.060, s), 0, P.neckY + h * 0.02, -h * 0.012, 0.2, 0, 0));
  f.add('head', fur, weld([
    T(blob(h * 0.082, h * 0.086, h * 0.090, s), 0, hy, hz),
    T(blob(h * 0.052, h * 0.048, h * 0.075, s), 0, hy - h * 0.030, hz - h * 0.095),   // muzzle
    T(blob(h * 0.026, h * 0.040, h * 0.014, s), h * 0.085, hy + h * 0.030, hz + h * 0.020, 0, 0, -0.5),
    T(blob(h * 0.026, h * 0.040, h * 0.014, s), -h * 0.085, hy + h * 0.030, hz + h * 0.020, 0, 0, 0.5),
  ]));
  f.add('head', 'bead', weld([
    T(sph(h * 0.016, 6), h * 0.050, hy + h * 0.020, hz - h * 0.070),
    T(sph(h * 0.016, 6), -h * 0.050, hy + h * 0.020, hz - h * 0.070),
    T(sph(h * 0.012, 5), h * 0.018, hy - h * 0.040, hz - h * 0.152),
    T(sph(h * 0.012, 5), -h * 0.018, hy - h * 0.040, hz - h * 0.152),
  ]));
  if (tier >= 2) {
    f.add('head', b.eye || 'eyeRed', weld([
      T(sph(h * 0.011, 5), h * 0.050, hy + h * 0.020, hz - h * 0.078),
      T(sph(h * 0.011, 5), -h * 0.050, hy + h * 0.020, hz - h * 0.078),
    ]));
  }
  f.add('head', 'boneOld', weld([
    T(tube(h * 0.20 * hornScale, h * 0.024 * hornScale, h * 0.005, 6, 4, -0.24, 0),
      h * 0.070, hy + h * 0.060, hz + h * 0.010, -0.35, 0, -0.85),
    T(tube(h * 0.20 * hornScale, h * 0.024 * hornScale, h * 0.005, 6, 4, -0.24, 0),
      -h * 0.070, hy + h * 0.060, hz + h * 0.010, -0.35, 0, 0.85),
    T(cyl(h * 0.012, h * 0.014, h * 0.055, 5), 0, hy - h * 0.042, hz - h * 0.150, Math.PI / 2, 0, 0),  // nose ring bar
  ]));
  if (tier >= 1) {
    f.add('head', trim || metal, T(tor(h * 0.030, h * 0.008, s), 0, hy - h * 0.058, hz - h * 0.140, 0, 0, 0));
  }

  // ---- limbs ------------------------------------------------------------
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, fur, T(cap(h * 0.052, P.upper * 0.72, s),
      sg * (P.shX + P.upper * 0.5), P.shY - h * 0.012, -h * 0.005, 0, 0, sg * (Math.PI / 2 - 0.10)));
    f.add(`elbow${side}`, fur, T(cap(h * 0.044, P.fore * 0.76, s),
      sg * (P.shX + P.upper + P.fore * 0.5), P.shY - h * 0.048, -h * 0.005, 0, 0, sg * (Math.PI / 2 - 0.18)));
    const hand = [T(blob(h * 0.046, h * 0.038, h * 0.048, s), sg * (P.shX + P.upper + P.fore + h * 0.026), P.shY - h * 0.084, -h * 0.005)];
    for (let k = -1; k <= 1; k++) {
      hand.push(T(cyl(h * 0.010, h * 0.013, h * 0.058, 4),
        sg * (P.shX + P.upper + P.fore + h * 0.065), P.shY - h * 0.096, -h * 0.005 + k * h * 0.020, 0.2, 0, sg * 1.05));
    }
    f.add(`wrist${side}`, fur, weld(hand));
    if (tier >= 2) {
      f.add(`elbow${side}`, metal, T(tor(h * 0.048, h * 0.012, s),
        sg * (P.shX + P.upper + h * 0.02), P.shY - h * 0.032, -h * 0.005, 0, 0, sg * Math.PI / 2));
    }

    f.add(`hip${side}`, fur, T(cap(h * 0.062, (P.hipY - P.kneeY) * 0.70, s), sg * P.hipX, (P.hipY + P.kneeY) * 0.5, 0));
    f.add(`knee${side}`, fur, T(cap(h * 0.048, (P.kneeY - P.ankleY) * 0.72, s), sg * P.hipX, (P.kneeY + P.ankleY) * 0.5, P.kneeZ * 0.5));
    f.add(`ankle${side}`, 'boneOld', weld([
      T(cyl(h * 0.042, h * 0.050, P.ankleY * 1.5, s), sg * P.hipX, P.ankleY * 0.55, -h * 0.010),
      T(box(h * 0.032, P.ankleY * 0.9, h * 0.058), sg * (P.hipX + h * 0.018), P.ankleY * 0.42, -h * 0.030),
      T(box(h * 0.032, P.ankleY * 0.9, h * 0.058), sg * (P.hipX - h * 0.018), P.ankleY * 0.42, -h * 0.030),
    ]));
  }

  // 沃玛教主 carries a great axe and drags a cape
  if (b.weapon === 'axe') {
    const ax = P.shX + P.upper + P.fore + h * 0.075;
    f.add('wristR', 'plank', T(cyl(h * 0.018, h * 0.021, h * 0.66, 6), -ax, P.shY - h * 0.05, -h * 0.01, 0.22, 0, 0));
    f.add('wristR', metal, weld([
      T(box(h * 0.038, h * 0.19, h * 0.055), -ax, P.shY + h * 0.22, -h * 0.075),
      T(tri(h * 0.14, h * 0.27, h * 0.038), -ax - h * 0.038, P.shY + h * 0.22, -h * 0.13, 0, Math.PI / 2, 0),
      T(tri(h * 0.10, h * 0.20, h * 0.032), -ax + h * 0.038, P.shY + h * 0.22, -h * 0.02, 0, -Math.PI / 2, Math.PI),
    ]));
  }
  if (tier >= 3) {
    // boss tell: a scorched, lit ring where it plants its hooves
    f.add('hips', b.eye || 'eyeRed', T(tor(h * 0.34, h * 0.020, s), 0, h * 0.014, 0, Math.PI / 2, 0, 0));
  }
  if (b.cape) {
    const capeGeo = weld([
      T(cyl(h * 0.115, h * 0.20, h * 0.62, s, true), 0, -h * 0.31, 0),
    ]);
    f.swinger('cape', 'chest', 0, P.chestY + h * 0.075, h * 0.055, 'cloth', capeGeo, { gain: 0.10, limit: 0.42 });
  }
}

/**
 * 祖玛 line: carved stone idols. Geometric relief, rectangular masks, gold
 * inlay, and a lit slit where a face should be.
 */
function buildIdol(f, b) {
  const s = f.seg;
  const tier = b.tier || 0;
  const P = layoutBiped(f, {
    h: b.h || 1.92, hipF: 0.50, kneeF: 0.28, ankleF: 0.06,
    chestF: 0.695, shF: 0.800, neckF: 0.840, headF: 0.900,
    shXF: 0.145, hipXF: 0.070, armRF: 0.055, legRF: 0.070,
    upperArmF: 0.175, foreArmF: 0.175,
  });
  const h = P.h;
  const stone = b.stone || 'temple';
  const inlay = b.inlay || 'bronze';
  const glow = b.eye || 'eyeAmber';

  // ---- blocky carved torso ---------------------------------------------
  f.add('chest', stone, weld([
    T(box(h * 0.230, h * 0.185, h * 0.150), 0, P.chestY, -h * 0.005),
    T(box(h * 0.195, h * 0.090, h * 0.130), 0, P.chestY - h * 0.125, 0),
    T(box(h * 0.105, h * 0.105, h * 0.125), P.shX * 0.98, P.shY - h * 0.005, 0),
    T(box(h * 0.105, h * 0.105, h * 0.125), -P.shX * 0.98, P.shY - h * 0.005, 0),
  ]));
  f.add('hips', stone, weld([
    T(box(h * 0.185, h * 0.110, h * 0.135), 0, P.hipY, 0),
    T(box(h * 0.205, h * 0.028, h * 0.150), 0, P.hipY + h * 0.062, 0),
  ]));

  // stepped relief: three sunken bands across the chest, inlaid
  f.add('chest', inlay, weld([
    T(box(h * 0.185, h * 0.020, h * 0.012), 0, P.chestY + h * 0.055, -h * 0.080),
    T(box(h * 0.150, h * 0.020, h * 0.012), 0, P.chestY + h * 0.010, -h * 0.080),
    T(box(h * 0.115, h * 0.020, h * 0.012), 0, P.chestY - h * 0.035, -h * 0.080),
    T(box(h * 0.020, h * 0.130, h * 0.012), h * 0.082, P.chestY + h * 0.010, -h * 0.080),
    T(box(h * 0.020, h * 0.130, h * 0.012), -h * 0.082, P.chestY + h * 0.010, -h * 0.080),
  ]));
  if (tier >= 2) {
    f.add('chest', 'rune', T(box(h * 0.060, h * 0.060, h * 0.010), 0, P.chestY + h * 0.010, -h * 0.084));
  }

  // ---- mask head --------------------------------------------------------
  const hy = P.headY, hz = -h * 0.012;
  f.add('neck', stone, T(box(h * 0.070, h * 0.055, h * 0.070), 0, P.neckY + h * 0.020, hz));
  f.add('head', stone, weld([
    T(box(h * 0.135, h * 0.140, h * 0.125), 0, hy, hz),
    T(box(h * 0.175, h * 0.038, h * 0.145), 0, hy + h * 0.082, hz),      // crown slab
    T(box(h * 0.085, h * 0.045, h * 0.030), 0, hy - h * 0.062, hz - h * 0.070),  // jaw block
  ]));
  f.add('head', inlay, weld([
    T(box(h * 0.150, h * 0.014, h * 0.012), 0, hy + h * 0.048, hz - h * 0.065),
    T(box(h * 0.014, h * 0.070, h * 0.012), 0, hy - h * 0.010, hz - h * 0.065),
  ]));
  f.add('head', glow, weld([
    T(box(h * 0.042, h * 0.016, h * 0.012), h * 0.038, hy + h * 0.018, hz - h * 0.066),
    T(box(h * 0.042, h * 0.016, h * 0.012), -h * 0.038, hy + h * 0.018, hz - h * 0.066),
  ]));
  if (tier >= 3) {
    // 祖玛教主: a horned stone crown
    f.add('head', stone, weld([
      T(tube(h * 0.22, h * 0.030, h * 0.008, 5, 3, -0.22, 0), h * 0.078, hy + h * 0.095, hz + h * 0.010, -0.30, 0, -0.72),
      T(tube(h * 0.22, h * 0.030, h * 0.008, 5, 3, -0.22, 0), -h * 0.078, hy + h * 0.095, hz + h * 0.010, -0.30, 0, 0.72),
    ]));
    f.add('head', 'gold', T(tor(h * 0.085, h * 0.012, s), 0, hy + h * 0.100, hz, Math.PI / 2, 0, 0, 1, 1, 1.05));
  }

  // ---- limbs: stone blocks with carved joints ---------------------------
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, stone, T(box(h * 0.150, h * 0.085, h * 0.085),
      sg * (P.shX + P.upper * 0.5), P.shY - h * 0.014, 0));
    f.add(`elbow${side}`, stone, weld([
      T(box(h * 0.150, h * 0.072, h * 0.072), sg * (P.shX + P.upper + P.fore * 0.5), P.shY - h * 0.048, 0),
      T(box(h * 0.070, h * 0.062, h * 0.070), sg * (P.shX + P.upper + P.fore + h * 0.035), P.shY - h * 0.082, 0),
    ]));
    f.add(`wrist${side}`, stone, T(box(h * 0.055, h * 0.050, h * 0.058),
      sg * (P.shX + P.upper + P.fore + h * 0.070), P.shY - h * 0.096, 0));
    f.add(`shoulder${side}`, inlay, T(box(h * 0.014, h * 0.062, h * 0.014),
      sg * (P.shX + P.upper * 0.5), P.shY - h * 0.014, -h * 0.048));

    f.add(`hip${side}`, stone, T(box(h * 0.095, (P.hipY - P.kneeY) * 0.92, h * 0.095),
      sg * P.hipX, (P.hipY + P.kneeY) * 0.5, 0));
    f.add(`knee${side}`, stone, T(box(h * 0.085, (P.kneeY - P.ankleY) * 0.92, h * 0.085),
      sg * P.hipX, (P.kneeY + P.ankleY) * 0.5, P.kneeZ * 0.5));
    f.add(`ankle${side}`, stone, T(box(h * 0.095, P.ankleY * 1.5, h * 0.135),
      sg * P.hipX, P.ankleY * 0.6, -h * 0.020));
  }

  if (b.weapon === 'bow') {
    const bx = P.shX + P.upper + P.fore + h * 0.085;
    f.add('wristL', 'boneOld', weld([
      T(tor(h * 0.20, h * 0.012, s, Math.PI * 1.15), bx, P.shY - h * 0.09, 0, 0, Math.PI / 2, Math.PI * 0.42),
    ]));
    f.add('wristL', 'bead', T(box(h * 0.004, h * 0.36, h * 0.004), bx + h * 0.015, P.shY - h * 0.09, 0));
  }
  if (b.weapon === 'halberd') {
    const ax = P.shX + P.upper + P.fore + h * 0.075;
    f.add('wristR', stone, T(cyl(h * 0.016, h * 0.019, h * 0.90, 6), -ax, P.shY - h * 0.02, -h * 0.01, 0.18, 0, 0));
    f.add('wristR', inlay, weld([
      T(tri(h * 0.10, h * 0.26, h * 0.030), -ax - h * 0.02, P.shY + h * 0.34, -h * 0.10, 0, Math.PI / 2, 0),
      T(con(h * 0.030, h * 0.16, 6), -ax, P.shY + h * 0.50, -h * 0.06),
    ]));
  }
  if (tier >= 3) {
    // boss tell: a lit ring carved into the floor beneath it
    f.add('hips', glow, T(tor(h * 0.34, h * 0.020, s), 0, h * 0.012, 0, Math.PI / 2, 0, 0));
  }
}

// ===========================================================================
// 7. body builders — 赤月峡谷 (endgame bosses)
// ===========================================================================

/** 赤月恶魔: winged, molten, enormous. */
function buildDemon(f, b) {
  const s = f.seg;
  const P = layoutBiped(f, {
    h: b.h || 2.20, lean: 0.14, hipF: 0.50, kneeF: 0.285, ankleF: 0.065,
    chestF: 0.700, shF: 0.815, neckF: 0.850, headF: 0.910,
    shXF: 0.175, hipXF: 0.078, armRF: 0.062, legRF: 0.080,
    upperArmF: 0.195, foreArmF: 0.200,
  });
  const h = P.h;
  const hideMat = 'scaleRed';

  f.add('chest', hideMat, weld([
    T(blob(h * 0.175, h * 0.155, h * 0.115, s), 0, P.chestY, -h * 0.010),
    T(blob(h * 0.130, h * 0.080, h * 0.095, s), 0, P.chestY - h * 0.100, 0),
    T(blob(h * 0.100, h * 0.090, h * 0.090, s), P.shX * 0.92, P.shY, 0),
    T(blob(h * 0.100, h * 0.090, h * 0.090, s), -P.shX * 0.92, P.shY, 0),
  ]));
  f.add('hips', hideMat, T(blob(h * 0.118, h * 0.090, h * 0.100, s), 0, P.hipY, 0));

  // molten fissures
  f.add('chest', 'lava', weld([
    T(box(h * 0.018, h * 0.140, h * 0.018), h * 0.050, P.chestY, -h * 0.108, 0, 0, 0.30),
    T(box(h * 0.016, h * 0.110, h * 0.016), -h * 0.062, P.chestY - h * 0.020, -h * 0.100, 0, 0, -0.45),
    T(box(h * 0.120, h * 0.016, h * 0.016), 0, P.chestY + h * 0.062, -h * 0.104, 0, 0, 0.12),
  ]));
  f.add('hips', 'lava', T(box(h * 0.100, h * 0.016, h * 0.016), 0, P.hipY - h * 0.030, -h * 0.092, 0, 0, -0.18));

  // shoulder spikes
  f.add('chest', 'boneOld', weld((() => {
    const v = [];
    for (let i = -1; i <= 1; i += 2) {
      for (let k = 0; k < 3; k++) {
        v.push(T(tube(h * 0.16 - k * h * 0.030, h * 0.024, h * 0.004, 5, 3, -0.18, 0),
          i * (P.shX * 0.95 + (k - 1) * h * 0.032), P.shY + h * 0.070, (k - 1) * h * 0.030,
          -0.30, 0, i * -0.55));
      }
    }
    return v;
  })()));

  // ---- head: horned skull, jaws, burning eyes ---------------------------
  const hy = P.headY, hz = -h * 0.030;
  f.add('neck', hideMat, T(cyl(h * 0.052, h * 0.068, h * 0.060, s), 0, P.neckY + h * 0.020, -h * 0.014, 0.2, 0, 0));
  f.add('head', hideMat, weld([
    T(blob(h * 0.090, h * 0.092, h * 0.100, s), 0, hy, hz),
    T(blob(h * 0.058, h * 0.050, h * 0.080, s), 0, hy - h * 0.034, hz - h * 0.100),
  ]));
  f.add('head', 'boneOld', weld([
    T(tube(h * 0.34, h * 0.034, h * 0.006, 6, 5, -0.20, 0.05), h * 0.075, hy + h * 0.062, hz + h * 0.020, -0.40, 0, -0.72),
    T(tube(h * 0.34, h * 0.034, h * 0.006, 6, 5, -0.20, -0.05), -h * 0.075, hy + h * 0.062, hz + h * 0.020, -0.40, 0, 0.72),
    T(tube(h * 0.16, h * 0.020, h * 0.004, 5, 3, -0.24, 0), h * 0.062, hy + h * 0.020, hz - h * 0.040, -0.9, 0, -1.15),
    T(tube(h * 0.16, h * 0.020, h * 0.004, 5, 3, -0.24, 0), -h * 0.062, hy + h * 0.020, hz - h * 0.040, -0.9, 0, 1.15),
    // fangs
    T(con(h * 0.014, h * 0.052, 5), h * 0.030, hy - h * 0.052, hz - h * 0.128, Math.PI, 0, 0),
    T(con(h * 0.014, h * 0.052, 5), -h * 0.030, hy - h * 0.052, hz - h * 0.128, Math.PI, 0, 0),
  ]));
  f.add('head', 'eyeAmber', weld([
    T(sph(h * 0.024, 7), h * 0.046, hy + h * 0.024, hz - h * 0.084),
    T(sph(h * 0.024, 7), -h * 0.046, hy + h * 0.024, hz - h * 0.084),
    T(box(h * 0.060, h * 0.010, h * 0.010), 0, hy - h * 0.062, hz - h * 0.116),   // burning maw
  ]));

  // ---- wings ------------------------------------------------------------
  for (let i = -1; i <= 1; i += 2) {
    const wx = i * h * 0.10, wy = P.chestY + h * 0.075, wz = h * 0.075;
    f.add('chest', 'boneOld', weld([
      T(tube(h * 0.62, h * 0.030, h * 0.012, 5, 3, -0.10, 0), wx, wy, wz, -0.20, 0, i * -0.95),
      T(tube(h * 0.56, h * 0.020, h * 0.008, 5, 3, 0.16, 0), wx + i * h * 0.44, wy + h * 0.30, wz + h * 0.02, 0.35, 0, i * -0.55),
      T(tube(h * 0.48, h * 0.018, h * 0.007, 5, 3, 0.20, 0), wx + i * h * 0.40, wy + h * 0.24, wz + h * 0.02, 0.70, 0, i * -0.85),
      T(tube(h * 0.40, h * 0.016, h * 0.006, 5, 3, 0.22, 0), wx + i * h * 0.34, wy + h * 0.16, wz + h * 0.02, 1.00, 0, i * -1.10),
    ]));
    f.add('chest', hideMat, weld([
      T(tri(h * 0.46, h * 0.60, h * 0.014), wx + i * h * 0.36, wy + h * 0.22, wz + h * 0.03, 0, i * 0.20, i * -2.15),
      T(tri(h * 0.40, h * 0.52, h * 0.014), wx + i * h * 0.30, wy + h * 0.02, wz + h * 0.03, 0, i * 0.28, i * -2.70),
    ]));
  }

  // ---- limbs ------------------------------------------------------------
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, hideMat, T(cap(h * 0.058, P.upper * 0.72, s),
      sg * (P.shX + P.upper * 0.5), P.shY - h * 0.014, 0, 0, 0, sg * (Math.PI / 2 - 0.10)));
    f.add(`elbow${side}`, hideMat, T(cap(h * 0.048, P.fore * 0.76, s),
      sg * (P.shX + P.upper + P.fore * 0.5), P.shY - h * 0.052, 0, 0, 0, sg * (Math.PI / 2 - 0.20)));
    const claw = [T(blob(h * 0.050, h * 0.042, h * 0.052, s), sg * (P.shX + P.upper + P.fore + h * 0.030), P.shY - h * 0.090, 0)];
    for (let k = -1; k <= 1; k++) {
      claw.push(T(tube(h * 0.10, h * 0.012, h * 0.003, 5, 3, 0.22, 0),
        sg * (P.shX + P.upper + P.fore + h * 0.062), P.shY - h * 0.104, k * h * 0.024, 1.05, 0, sg * 1.15));
    }
    f.add(`wrist${side}`, 'boneOld', weld(claw));

    f.add(`hip${side}`, hideMat, T(cap(h * 0.070, (P.hipY - P.kneeY) * 0.70, s), sg * P.hipX, (P.hipY + P.kneeY) * 0.5, 0));
    f.add(`knee${side}`, hideMat, T(cap(h * 0.052, (P.kneeY - P.ankleY) * 0.72, s), sg * P.hipX, (P.kneeY + P.ankleY) * 0.5, P.kneeZ * 0.5));
    f.add(`ankle${side}`, 'boneOld', weld([
      T(cyl(h * 0.046, h * 0.056, P.ankleY * 1.5, s), sg * P.hipX, P.ankleY * 0.55, -h * 0.012),
      T(box(h * 0.034, P.ankleY * 0.9, h * 0.066), sg * (P.hipX + h * 0.020), P.ankleY * 0.40, -h * 0.034),
      T(box(h * 0.034, P.ankleY * 0.9, h * 0.066), sg * (P.hipX - h * 0.020), P.ankleY * 0.40, -h * 0.034),
    ]));
    f.add(`hip${side}`, 'lava', T(box(h * 0.012, h * 0.090, h * 0.012), sg * (P.hipX + h * 0.055), (P.hipY + P.kneeY) * 0.5, 0));
  }

  // molten ring under its feet + a lashing tail
  f.add('hips', 'lava', T(tor(h * 0.36, h * 0.024, s), 0, h * 0.014, 0, Math.PI / 2, 0, 0));
  f.swinger('tail', 'hips', 0, P.hipY - h * 0.02, h * 0.090, hideMat,
    weld([
      T(cap(h * 0.038, h * 0.52, s), 0, 0, h * 0.30, Math.PI / 2 - 0.5, 0, 0),
      T(con(h * 0.055, h * 0.16, 6), 0, -h * 0.22, h * 0.56, 2.2, 0, 0),
    ]), { gain: 0.16, limit: 0.6 });
}

/** 触龙神: a coiled serpent that rears up, with tentacle arms. */
function buildSerpent(f, b) {
  const s = f.seg;
  const h = b.h || 2.30;          // height of the reared head
  const g = h * 0.16;             // body girth

  f.place('hips', null, 0, h * 0.16, g * 0.6, 0, 0.55, -1);
  f.place('spine', 'hips', 0, h * 0.34, g * 0.2, 0, 0.85, -0.5);
  f.place('chest', 'spine', 0, h * 0.58, -g * 0.2, 0, 0.94, -0.34);
  f.place('neck', 'chest', 0, h * 0.76, -g * 0.5, 0, 0.90, -0.44);
  f.place('head', 'neck', 0, h * 0.93, -g * 0.9, 0, 0.24, -1);

  const shX = g * 0.85;
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.place(`shoulder${side}`, 'chest', sg * shX, h * 0.62, -g * 0.25, sg, 0.05, -0.15);
    f.place(`elbow${side}`, `shoulder${side}`, sg * (shX + h * 0.19), h * 0.58, -g * 0.45, sg, -0.30, -0.20);
    f.place(`wrist${side}`, `elbow${side}`, sg * (shX + h * 0.36), h * 0.48, -g * 0.60, sg, -0.55, -0.25);
    // No legs — the joints exist so Animator never indexes undefined, but the
    // chain is deliberately degenerate so it falls back to cheap FK.
    f.place(`hip${side}`, 'hips', sg * g * 0.35, h * 0.11, g * 0.7, 0, -1, 0);
    f.place(`knee${side}`, `hip${side}`, sg * g * 0.35, h * 0.07, g * 0.8, 0, -1, 0);
    f.place(`ankle${side}`, `knee${side}`, sg * g * 0.35, h * 0.04, g * 0.8, 0, -0.4, -1);
  }
  f.mount('handR', 'wristR', -(shX + h * 0.42), h * 0.44, -g * 0.7);
  f.mount('handL', 'wristL', shX + h * 0.42, h * 0.44, -g * 0.7);
  f.mount('back', 'chest', 0, h * 0.62, g * 0.9);
  f.mount('headTop', 'head', 0, h * 1.06, -g * 0.9);

  // ---- coils ------------------------------------------------------------
  const coils = [];
  for (let i = 0; i < 3; i++) {
    const rr = g * (2.5 - i * 0.55);
    coils.push(T(tor(rr, g * (0.62 - i * 0.06), s), 0, g * (0.60 + i * 0.62), g * 0.5 + i * g * 0.12, Math.PI / 2, i * 0.5, 0));
  }
  f.add('hips', 'scaleGreen', weld(coils));
  f.add('spine', 'scaleGreen', T(cap(g * 0.62, h * 0.22, s), 0, h * 0.40, -g * 0.05, -0.30, 0, 0));
  f.add('chest', 'scaleGreen', weld([
    T(cap(g * 0.56, h * 0.20, s), 0, h * 0.62, -g * 0.30, -0.36, 0, 0),
    // ventral scutes
    T(box(g * 0.60, h * 0.24, g * 0.10), 0, h * 0.60, -g * 0.72, -0.36, 0, 0),
  ]));
  f.add('neck', 'scaleGreen', T(cap(g * 0.44, h * 0.14, s), 0, h * 0.80, -g * 0.62, -0.42, 0, 0));

  // ---- dragon head ------------------------------------------------------
  const hy = h * 0.93, hz = -g * 0.9;
  f.add('head', 'scaleGreen', weld([
    T(blob(g * 0.52, g * 0.48, g * 0.80, s), 0, hy, hz),
    T(blob(g * 0.34, g * 0.28, g * 0.58, s), 0, hy - g * 0.14, hz - g * 0.80),
    // brow horns and frill
    T(tube(g * 0.90, g * 0.10, g * 0.02, 5, 3, -0.18, 0), g * 0.34, hy + g * 0.28, hz + g * 0.30, -0.15, 0, -0.55),
    T(tube(g * 0.90, g * 0.10, g * 0.02, 5, 3, -0.18, 0), -g * 0.34, hy + g * 0.28, hz + g * 0.30, -0.15, 0, 0.55),
  ]));
  f.add('head', 'boneOld', weld((() => {
    const v = [];
    for (let i = -1; i <= 1; i += 2) {
      for (let k = 0; k < 4; k++) {
        v.push(T(con(g * 0.055, g * 0.22, 5), i * g * 0.20, hy - g * 0.28, hz - g * 0.50 - k * g * 0.22, Math.PI, 0, 0));
        v.push(T(con(g * 0.048, g * 0.18, 5), i * g * 0.17, hy - g * 0.40, hz - g * 0.44 - k * g * 0.22));
      }
    }
    return v;
  })()));
  f.add('head', 'eyeGreen', weld([
    T(blob(g * 0.13, g * 0.09, g * 0.10, 7), g * 0.36, hy + g * 0.10, hz - g * 0.38),
    T(blob(g * 0.13, g * 0.09, g * 0.10, 7), -g * 0.36, hy + g * 0.10, hz - g * 0.38),
  ]));

  // ---- tentacle arms ----------------------------------------------------
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    f.add(`shoulder${side}`, 'scaleGreen', T(tube(h * 0.20, g * 0.24, g * 0.17, 6, 3, 0.10, 0),
      sg * shX, h * 0.62, -g * 0.25, 0.1, 0, sg * -1.45));
    f.add(`elbow${side}`, 'scaleGreen', T(tube(h * 0.19, g * 0.17, g * 0.10, 6, 3, 0.16, 0),
      sg * (shX + h * 0.19), h * 0.58, -g * 0.45, 0.25, 0, sg * -1.30));
    f.add(`wrist${side}`, 'scaleGreen', T(tube(h * 0.18, g * 0.10, g * 0.02, 5, 4, 0.22, 0),
      sg * (shX + h * 0.36), h * 0.48, -g * 0.60, 0.45, 0, sg * -1.15));
  }

  f.add('hips', 'eyeGreen', T(tor(g * 2.9, g * 0.09, s), 0, h * 0.010, g * 0.5, Math.PI / 2, 0, 0));
}

const PLANS = {
  fowl: buildFowl,
  quad: buildQuadBeast,
  bat: buildBat,
  worm: buildMultiHorn,
  spider: buildSpider,
  scarecrow: buildScarecrow,
  skeleton: buildSkeleton,
  zombie: buildZombie,
  golem: buildGolem,
  ghost: buildGhost,
  minotaur: buildMinotaur,
  idol: buildIdol,
  demon: buildDemon,
  serpent: buildSerpent,
};

// ===========================================================================
// 8. BESTIARY
// ===========================================================================

/**
 * Balance is set against `game/Content.js`'s class curves, not by feel:
 *
 *   Combat.meleeAttack  dmg   = roll(attacker.dc) - roll(target.ac)
 *   Combat.hitChance          = clamp((acc + 3 - agi) * 0.09 + 0.72, .12, .97)
 *   Config.COMBAT             base attack interval 1.1s, crit ×1.75
 *   Player._applyBaseStats    L35 warrior ≈ dc[16,25] ac[0,12] hp 572
 *                             + 修罗/圣战宝甲 ≈ dc[27,48] ac[8,28] hp ~650
 *
 * So a well-geared level-35 warrior lands ~20 damage a swing on 祖玛教主 and
 * takes ~44 back: a 2600-HP boss is a two-to-three-minute fight that punishes
 * standing still, and a level-1 鸡 with 18 HP and dc[1,3] dies to two swings of
 * a 木剑. `exp` is tuned against EXP_TABLE — roughly a dozen 鸡 to level 2, and
 * a 祖玛教主 kill is ~5% of a level in the 30s.
 *
 * `drops` lists the flavour item(s) unique to a monster; `dropTable` points at
 * the shared tier table in Content.js so loot stays in one place. Gold is
 * rolled from `level` by `rollDrops` and is never listed here.
 */
export const BESTIARY = {
  // ---- 比奇城外 ---------------------------------------------------------
  chicken: {
    id: 'chicken', name: '鸡', level: 1,
    hp: 18, mp: 0,
    ac: [0, 1], mac: [0, 0], dc: [1, 3], mc: [0, 0], sc: [0, 0],
    accuracy: 2, agility: 2,
    moveSpeed: 2.0, attackSpeed: 0.8, attackRange: 1.3, aggroRange: 4,
    exp: 9, ai: 'passive', scale: 1, undead: false,
    goldScale: 0.35, dropTable: 'field_low',
    drops: [{ item: 'herb_potion', chance: 0.05, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'fowl', h: 0.60, feather: 'featherB' },
    desc: '比奇城外最不设防的活物，新手的第一滴血。',
  },
  hen: {
    id: 'hen', name: '母鸡', level: 2,
    hp: 26, mp: 0,
    ac: [0, 1], mac: [0, 0], dc: [1, 4], mc: [0, 0], sc: [0, 0],
    accuracy: 3, agility: 3,
    moveSpeed: 2.1, attackSpeed: 0.85, attackRange: 1.3, aggroRange: 4,
    exp: 13, ai: 'passive', scale: 1, undead: false,
    goldScale: 0.4, dropTable: 'field_low',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'fowl', h: 0.66, feather: 'featherW' },
    desc: '毛色雪白，护崽时也敢啄人一口。',
  },
  deer: {
    id: 'deer', name: '鹿', level: 3,
    hp: 44, mp: 0,
    ac: [0, 2], mac: [0, 1], dc: [2, 5], mc: [0, 0], sc: [0, 0],
    accuracy: 5, agility: 8,
    moveSpeed: 4.4, attackSpeed: 1.0, attackRange: 1.5, aggroRange: 5,
    exp: 22, ai: 'passive', scale: 1, undead: false,
    dropTable: 'field_low',
    drops: [{ item: 'herb_potion', chance: 0.16, qty: [1, 2] }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'quad', h: 1.02, len: 1.55, hide: 'featherB', antlers: true, spanF: 0.16, girthF: 0.23 },
    desc: '林间受惊便跑，追上它比杀了它难。',
  },
  scarecrow: {
    id: 'scarecrow', name: '稻草人', level: 4,
    hp: 76, mp: 0,
    ac: [1, 3], mac: [0, 1], dc: [3, 7], mc: [0, 0], sc: [0, 0],
    accuracy: 6, agility: 1,
    moveSpeed: 1.2, attackSpeed: 0.7, attackRange: 1.7, aggroRange: 5,
    exp: 30, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'field_low',
    drops: [{ item: 'wooden_sword', chance: 0.02, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'scarecrow', h: 1.62 },
    desc: '插在麦田里的草扎人偶，不知何时自己走了下来。',
  },
  multi_horn: {
    id: 'multi_horn', name: '多角虫', level: 6,
    hp: 100, mp: 0,
    ac: [2, 5], mac: [1, 3], dc: [4, 9], mc: [0, 0], sc: [0, 0],
    accuracy: 8, agility: 5,
    moveSpeed: 2.5, attackSpeed: 1.0, attackRange: 1.6, aggroRange: 6,
    exp: 46, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'field_low',
    drops: [{ item: 'gold_wound', chance: 0.07, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'worm', h: 0.50, len: 1.08 },
    desc: '浑身生角的甲虫，撞上来那一下能让新手回城。',
  },
  spider_small: {
    id: 'spider_small', name: '蜘蛛', level: 8,
    hp: 128, mp: 0,
    ac: [2, 6], mac: [1, 4], dc: [6, 12], mc: [0, 0], sc: [0, 0],
    accuracy: 10, agility: 9,
    moveSpeed: 3.3, attackSpeed: 1.15, attackRange: 1.6, aggroRange: 7,
    exp: 72, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'field_mid',
    drops: [{ item: 'herb_potion', chance: 0.12, qty: [1, 2] }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'spider', h: 0.56, len: 0.95, eye: 'eyeRed' },
    desc: '八足伏在草根间，跳起来正好咬在小腿上。',
  },
  cave_bat: {
    id: 'cave_bat', name: '蝙蝠', level: 9,
    hp: 112, mp: 0,
    ac: [1, 4], mac: [2, 5], dc: [5, 11], mc: [0, 0], sc: [0, 0],
    accuracy: 12, agility: 14,
    moveSpeed: 4.8, attackSpeed: 1.3, attackRange: 1.5, aggroRange: 8,
    exp: 80, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'field_mid',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'bat', h: 0.86 },
    desc: '洞窟顶上倒挂成片，惊起时能遮住整条通道。',
  },
  hungry_wolf: {
    id: 'hungry_wolf', name: '饿狼', level: 11,
    hp: 186, mp: 0,
    ac: [3, 7], mac: [2, 5], dc: [8, 16], mc: [0, 0], sc: [0, 0],
    accuracy: 13, agility: 12,
    moveSpeed: 4.6, attackSpeed: 1.2, attackRange: 1.6, aggroRange: 9,
    exp: 124, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'field_mid',
    drops: [{ item: 'gold_wound', chance: 0.10, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: {
      plan: 'quad', h: 0.92, len: 1.52, hide: 'furGrey',
      jaws: true, ruff: true, bushyTail: true, spanF: 0.17, girthF: 0.26,
      headYF: 1.10, headZF: 0.62, neckUp: 0.35,
    },
    desc: '成群出没，饿极了连沃玛卫士都敢咬。',
  },

  // ---- 石墓阵 -----------------------------------------------------------
  bone_familiar: {
    id: 'bone_familiar', name: '骷髅精灵', level: 12,
    hp: 168, mp: 0,
    ac: [3, 7], mac: [2, 6], dc: [9, 17], mc: [0, 0], sc: [0, 0],
    accuracy: 14, agility: 12,
    moveSpeed: 3.6, attackSpeed: 1.15, attackRange: 1.6, aggroRange: 8,
    exp: 142, ai: 'aggressive', scale: 1, undead: true,
    dropTable: 'stonetomb',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'skeleton', h: 1.48, ribs: 5, spectral: true, eye: 'eyeBlue', boneMat: 'boneOld' },
    desc: '道士以符箓唤起的小骨兵，也是石墓深处的原住民。',
  },
  skeleton: {
    id: 'skeleton', name: '骷髅', level: 13,
    hp: 220, mp: 0,
    ac: [4, 9], mac: [2, 5], dc: [10, 19], mc: [0, 0], sc: [0, 0],
    accuracy: 14, agility: 9,
    moveSpeed: 2.9, attackSpeed: 1.0, attackRange: 1.6, aggroRange: 8,
    exp: 172, ai: 'aggressive', scale: 1, undead: true,
    dropTable: 'stonetomb',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'skeleton', h: 1.72, ribs: 6 },
    desc: '石墓阵里走动的旧骨，眼窝深处还留着一点火。',
  },
  skeleton_axe: {
    id: 'skeleton_axe', name: '持斧骷髅', level: 16,
    hp: 312, mp: 0,
    ac: [6, 12], mac: [3, 7], dc: [14, 26], mc: [0, 0], sc: [0, 0],
    accuracy: 16, agility: 10,
    moveSpeed: 3.0, attackSpeed: 0.95, attackRange: 1.8, aggroRange: 9,
    exp: 270, ai: 'aggressive', scale: 1, undead: true,
    dropTable: 'stonetomb',
    drops: [{ item: 'iron_sword', chance: 0.012, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'skeleton', h: 1.80, ribs: 7, wide: true, axe: true, boneMat: 'boneOld' },
    desc: '生前是守陵的兵，死后连斧头都没放下。',
  },
  zombie: {
    id: 'zombie', name: '僵尸', level: 18,
    hp: 470, mp: 0,
    ac: [7, 13], mac: [2, 6], dc: [16, 28], mc: [0, 0], sc: [0, 0],
    accuracy: 15, agility: 5,
    moveSpeed: 1.7, attackSpeed: 0.7, attackRange: 1.7, aggroRange: 7,
    exp: 340, ai: 'aggressive', scale: 1, undead: true,
    dropTable: 'stonetomb',
    drops: [{ item: 'gold_wound', chance: 0.14, qty: [1, 2] }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'zombie', h: 1.68 },
    desc: '走得极慢，可血厚得离谱，围上三只就该跑了。',
  },
  stone_golem: {
    id: 'stone_golem', name: '石人', level: 21,
    hp: 640, mp: 0,
    ac: [12, 20], mac: [6, 12], dc: [20, 34], mc: [0, 0], sc: [0, 0],
    accuracy: 17, agility: 4,
    moveSpeed: 1.9, attackSpeed: 0.7, attackRange: 2.0, aggroRange: 7,
    exp: 490, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'stonetomb',
    drops: [{ item: 'medium_armor', chance: 0.02, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'golem', h: 2.05, stone: 'rock', seam: 'eyeAmber' },
    desc: '石墓深处自行合拢的乱石，裂缝里透着橘红的光。',
  },

  // ---- 沃玛寺庙 ---------------------------------------------------------
  woma_soldier: {
    id: 'woma_soldier', name: '沃玛战士', level: 22,
    hp: 500, mp: 0,
    ac: [8, 15], mac: [4, 9], dc: [20, 33], mc: [0, 0], sc: [0, 0],
    accuracy: 19, agility: 12,
    moveSpeed: 3.2, attackSpeed: 1.0, attackRange: 1.8, aggroRange: 9,
    exp: 540, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'woma',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'minotaur', h: 1.86, tier: 0, fur: 'featherB', metal: 'ironRust' },
    desc: '牛首人身，沃玛寺庙最低阶的守卫，也已比石人难缠。',
  },
  woma_warrior: {
    id: 'woma_warrior', name: '沃玛勇士', level: 25,
    hp: 660, mp: 0,
    ac: [10, 18], mac: [5, 11], dc: [24, 40], mc: [0, 0], sc: [0, 0],
    accuracy: 21, agility: 13,
    moveSpeed: 3.3, attackSpeed: 1.05, attackRange: 1.9, aggroRange: 10,
    exp: 750, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'woma',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'minotaur', h: 1.92, tier: 1, fur: 'hide', metal: 'bronze' },
    desc: '肩上钉了铜片，角比战士更长一截。',
  },
  woma_guard: {
    id: 'woma_guard', name: '沃玛卫士', level: 27,
    hp: 840, mp: 0,
    ac: [12, 21], mac: [6, 13], dc: [28, 46], mc: [0, 0], sc: [0, 0],
    accuracy: 23, agility: 13,
    moveSpeed: 3.3, attackSpeed: 1.05, attackRange: 2.0, aggroRange: 10,
    exp: 980, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'woma',
    drops: [{ item: 'gold_wound_strong', chance: 0.12, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'minotaur', h: 1.98, tier: 2, fur: 'featherB', metal: 'iron', eye: 'eyeRed' },
    desc: '内殿的把门者，一身铁甲，冲锋时地都在响。',
  },
  woma_taurus: {
    id: 'woma_taurus', name: '沃玛教主', level: 30,
    hp: 1800, mp: 0,
    ac: [14, 24], mac: [8, 16], dc: [36, 62], mc: [0, 0], sc: [0, 0],
    accuracy: 25, agility: 14,
    moveSpeed: 3.0, attackSpeed: 0.85, attackRange: 2.8, aggroRange: 14,
    exp: 6200, ai: 'boss', scale: 1.80, undead: false,
    dropTable: 'boss_woma', goldScale: 1.4,
    sfx: { hit: 'monster.hit', die: 'boss.roar', idle: 'boss.roar', aggro: 'boss.roar' },
    body: {
      plan: 'minotaur', h: 1.96, tier: 3, fur: 'featherB',
      metal: 'iron', trim: 'gold', eye: 'eyeRed', weapon: 'axe', cape: true,
    },
    desc: '沃玛寺庙的主人。巨斧一挥，半个殿的人一起躺下。',
  },

  // ---- 祖玛寺庙 ---------------------------------------------------------
  zuma_archer: {
    id: 'zuma_archer', name: '祖玛弓箭手', level: 30,
    hp: 720, mp: 40,
    ac: [9, 16], mac: [8, 15], dc: [26, 44], mc: [0, 0], sc: [0, 0],
    accuracy: 25, agility: 16,
    moveSpeed: 3.0, attackSpeed: 0.9, attackRange: 8.5, aggroRange: 11,
    exp: 1250, ai: 'ranged', scale: 1, undead: false,
    dropTable: 'zuma',
    projectileVfx: 'hit.spark', projectileColor: 0xffd27a,
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'bow.shoot' },
    body: { plan: 'idol', h: 1.88, tier: 1, stone: 'stone', inlay: 'bronze', weapon: 'bow', eye: 'eyeAmber' },
    desc: '石像抬手便是一箭，法师最恨的隔空点名。',
  },
  zuma_statue: {
    id: 'zuma_statue', name: '祖玛雕像', level: 32,
    hp: 1150, mp: 0,
    ac: [16, 26], mac: [10, 18], dc: [30, 50], mc: [0, 0], sc: [0, 0],
    accuracy: 23, agility: 8,
    moveSpeed: 1.8, attackSpeed: 0.75, attackRange: 2.1, aggroRange: 8,
    exp: 1550, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'zuma',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'idol', h: 2.02, tier: 0, stone: 'temple', inlay: 'bronze', eye: 'eyeAmber' },
    desc: '立在廊柱之间，直到有人走近才睁开石缝里的眼。',
  },
  zuma_guard: {
    id: 'zuma_guard', name: '祖玛卫士', level: 34,
    hp: 1000, mp: 0,
    ac: [13, 22], mac: [9, 17], dc: [32, 54], mc: [0, 0], sc: [0, 0],
    accuracy: 26, agility: 15,
    moveSpeed: 3.2, attackSpeed: 1.05, attackRange: 2.2, aggroRange: 11,
    exp: 1850, ai: 'aggressive', scale: 1, undead: false,
    dropTable: 'zuma',
    drops: [{ item: 'sun_water_strong', chance: 0.10, qty: 1 }],
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'idol', h: 1.98, tier: 2, stone: 'temple', inlay: 'gold', weapon: 'halberd', eye: 'eyeAmber' },
    desc: '祖玛内殿的执戟者，胸口的符纹一直亮着。',
  },
  guard_ghost: {
    id: 'guard_ghost', name: '幽灵战士', level: 33,
    hp: 920, mp: 0,
    ac: [11, 20], mac: [12, 22], dc: [30, 50], mc: [0, 0], sc: [0, 0],
    accuracy: 27, agility: 18,
    moveSpeed: 3.6, attackSpeed: 1.15, attackRange: 2.0, aggroRange: 11,
    exp: 1700, ai: 'aggressive', scale: 1, undead: true,
    dropTable: 'zuma',
    sfx: { hit: 'monster.hit', die: 'monster.die', idle: 'monster.hit' },
    body: { plan: 'ghost', h: 1.90 },
    desc: '半透的甲影，脚不沾地；道士的召唤神兽也是这副样子。',
  },
  zuma_taurus: {
    id: 'zuma_taurus', name: '祖玛教主', level: 38,
    hp: 2600, mp: 0,
    ac: [16, 28], mac: [12, 22], dc: [46, 78], mc: [0, 0], sc: [0, 0],
    accuracy: 29, agility: 16,
    moveSpeed: 3.1, attackSpeed: 0.85, attackRange: 3.0, aggroRange: 15,
    exp: 14000, ai: 'boss', scale: 2.00, undead: false,
    dropTable: 'boss_zuma', goldScale: 1.6,
    sfx: { hit: 'monster.hit', die: 'boss.roar', idle: 'boss.roar', aggro: 'boss.roar' },
    body: { plan: 'idol', h: 2.05, tier: 3, stone: 'temple', inlay: 'gold', weapon: 'halberd', eye: 'eyeRed' },
    desc: '祖玛寺庙的至尊石像。没有一身圣战别想单打。',
  },

  // ---- 赤月峡谷 ---------------------------------------------------------
  evil_snake: {
    id: 'evil_snake', name: '触龙神', level: 43,
    hp: 4200, mp: 120,
    ac: [18, 30], mac: [16, 28], dc: [56, 96], mc: [0, 0], sc: [0, 0],
    accuracy: 31, agility: 16,
    moveSpeed: 2.8, attackSpeed: 0.9, attackRange: 3.4, aggroRange: 16,
    exp: 27000, ai: 'boss', scale: 1.55, undead: false,
    dropTable: 'boss_redmoon', goldScale: 1.8,
    sfx: { hit: 'monster.hit', die: 'boss.roar', idle: 'boss.roar', aggro: 'boss.roar' },
    body: { plan: 'serpent', h: 2.35 },
    desc: '盘在赤月峡谷入口的巨蛇，触手所及无人生还。',
  },
  red_moon: {
    id: 'red_moon', name: '赤月恶魔', level: 48,
    hp: 7200, mp: 200,
    ac: [20, 34], mac: [18, 32], dc: [70, 120], mc: [0, 0], sc: [0, 0],
    accuracy: 35, agility: 18,
    moveSpeed: 3.4, attackSpeed: 0.8, attackRange: 3.6, aggroRange: 18,
    exp: 62000, ai: 'boss', scale: 2.00, undead: false,
    dropTable: 'boss_redmoon', goldScale: 2.4,
    sfx: { hit: 'monster.hit', die: 'boss.roar', idle: 'boss.roar', aggro: 'boss.roar' },
    body: { plan: 'demon', h: 2.20 },
    desc: '玛法大陆的终点。双翼一张，峡谷的岩壁都被照红。',
  },
};

// ===========================================================================
// 9. prototype cache + buildMonster
// ===========================================================================

/** `${id}|${quality}` -> { root, height, radius, secondaryNames, ... } */
const _protos = new Map();
/** ids we have already complained about, so the console stays readable. */
const _warned = new Set();

function protoFor(id, def, ctx) {
  const quality = (ctx && ctx.quality) || 'high';
  const key = `${id}|${quality}`;
  let rec = _protos.get(key);
  if (rec) return rec;

  const body = def.body || {};
  const plan = PLANS[body.plan] || PLANS.skeleton;
  const f = new RigForge(ctx, id, quality);
  try {
    plan(f, body);
  } catch (e) {
    console.warn(`[bestiary] '${id}' geometry failed, using a plain frame`, e);
    // Wipe whatever the failed builder half-created and lay down a plain biped
    // so the spawn still animates instead of throwing on rig.joints.hips.
    while (f.body.children.length) f.body.remove(f.body.children[0]);
    f.joints = Object.create(null);
    f.info = Object.create(null);
    f.buckets.clear();
    f.secondary.length = 0;
    const P = layoutBiped(f, { h: 1.7 });
    f.add('chest', 'bone', T(cap(0.16, 0.34, 8), 0, P.chestY, 0));
    f.add('head', 'bone', T(sph(0.12, 8), 0, P.headY, 0));
    f.add('hips', 'bone', T(cap(0.14, 0.14, 8), 0, P.hipY, 0));
  }
  rec = f.finish(def.scale || 1);
  rec.key = key;
  _protos.set(key, rec);
  return rec;
}

/** Pull the joints/attach/meshes back out of a cloned prototype by node name. */
function harvest(root, rec) {
  const joints = Object.create(null);
  const attach = Object.create(null);
  const meshes = [];
  const named = new Map();

  root.traverse((o) => {
    if (o.isMesh) { meshes.push(o); return; }
    if (o.name) named.set(o.name, o);
  });

  for (let i = 0; i < JOINT_NAMES.length; i++) {
    const n = JOINT_NAMES[i];
    let j = named.get(n);
    if (!j) {
      // Should never happen (finish() stubs everything) but Animator rotates
      // these blind, so hand it a real Object3D rather than undefined.
      j = new THREE.Object3D();
      j.name = `${n}__stub`;
      root.add(j);
    }
    joints[n] = j;
  }

  attach.handR = named.get('handR') || joints.wristR;
  attach.handL = named.get('handL') || joints.wristL;
  attach.back = named.get('back') || joints.chest;
  attach.headTop = named.get('headTop') || joints.head;
  attach.head = joints.head;

  const secondary = [];
  const names = rec.secondaryNames || [];
  for (let i = 0; i < names.length; i++) {
    const o = named.get(names[i]);
    if (o) secondary.push(Object.assign({ object: o }, rec.secondaryOpts[i]));
  }

  return { joints, attach, meshes, secondary };
}

/**
 * Build a monster rig (docs/CONTRACTS.md §13 / §11 Rig shape).
 *
 * @param {string} id  a key of BESTIARY
 * @param {object} ctx { assets, materials, quality, ... }
 * @returns {{root:THREE.Group, joints:Object, attach:Object, height:number,
 *            radius:number, meshes:THREE.Mesh[], secondary:Array, dispose:Function}}
 */
export function buildMonster(id, ctx = {}) {
  let def = BESTIARY[id];
  if (!def) {
    if (!_warned.has(id)) {
      _warned.add(id);
      console.warn(`[bestiary] unknown monster '${id}' — falling back to 骷髅`);
    }
    def = BESTIARY.skeleton;
    id = 'skeleton';
  }

  // ---- 1. modeled asset, if tools/blender/ has built one -----------------
  const assets = ctx.assets;
  if (assets && typeof assets.rig === 'function') {
    let rig = null;
    try {
      rig = assets.rig(`mon_${id}`, { materials: ctx.materials, scale: def.scale || 1 });
    } catch (e) {
      rig = null;
      if (!_warned.has(`asset:${id}`)) {
        _warned.add(`asset:${id}`);
        console.warn(`[bestiary] asset 'mon_${id}' failed to instance`, e);
      }
    }
    if (rig) {
      if (!rig.secondary) rig.secondary = [];
      // Assets.rig()'s dispose frees geometry that is shared with the loaded
      // prototype scene, which would blank every later clone. Detach only;
      // core/Assets.js owns those buffers. (Reported, not fixed — not our file.)
      const root = rig.root;
      rig.dispose = function dispose() { if (root.parent) root.parent.remove(root); };
      rig.monsterId = id;
      return rig;
    }
  }

  // ---- 2. generated geometry --------------------------------------------
  const rec = protoFor(id, def, ctx);
  const root = rec.root.clone(true);
  root.name = `mon.${id}`;
  const h = harvest(root, rec);

  return {
    root,
    joints: h.joints,
    attach: h.attach,
    height: rec.height,
    radius: rec.radius,
    meshes: h.meshes,
    secondary: h.secondary,
    source: `generated:${(def.body && def.body.plan) || 'biped'}`,
    monsterId: id,
    /**
     * Clones share geometry and materials with the cached prototype, so this
     * detaches and drops references but must not free buffers — the next
     * spawn of the same monster still needs them. `disposeBestiary()` frees
     * the prototypes themselves.
     */
    dispose() {
      if (root.parent) root.parent.remove(root);
      h.meshes.length = 0;
      h.secondary.length = 0;
    },
  };
}

/** Convenience lookup, extra to the contract. */
export function getMonster(id) { return BESTIARY[id] || null; }

/** Every id in the roster, in table order. */
export const MONSTER_IDS = Object.keys(BESTIARY);

/**
 * Free every cached prototype geometry and every locally-owned fallback
 * material. Call on teardown, not on map change: live monsters clone these.
 */
export function disposeBestiary() {
  const seen = new Set();
  for (const rec of _protos.values()) {
    rec.root.traverse((o) => {
      if (o.isMesh && o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    });
    if (rec.geometries) {
      for (const g of rec.geometries) if (g && !seen.has(g)) { seen.add(g); g.dispose(); }
      rec.geometries.length = 0;
    }
    if (rec.root.parent) rec.root.parent.remove(rec.root);
  }
  seen.clear();
  _protos.clear();
  for (const m of _localMats.values()) m.dispose();
  _localMats.clear();
  _warned.clear();
}

export default { BESTIARY, buildMonster, getMonster, MONSTER_IDS, disposeBestiary };
