import * as THREE from 'three';

/**
 * Procedural character animation (docs/CONTRACTS.md §12).
 *
 * There are no baked clips anywhere in this game. Every pose is evaluated from
 * trigonometry, easing curves and a two-bone analytic IK solver, which is what
 * lets a walk cycle react to the entity's *actual* speed instead of playing a
 * fixed-length loop at a fixed cadence (the classic cause of foot skating).
 *
 * ---------------------------------------------------------------- bone space
 *
 * Joints are BONES out of a skinned GLB. A bone's local transform is its rest
 * transform; overwriting it collapses the skin. So every joint captures, on
 * construction:
 *
 *   restQ / restP  the bone's own local rest transform
 *   qW             the bone's rest rotation expressed relative to `rig.root`
 *   qPinv          the inverse of the PARENT's rest rotation relative to root
 *
 * A pose is authored as a rotation `R` in *character space* (the rig-root
 * frame: +Y up, +X toward the joints named "L", ±Z fore/aft). Composing it onto
 * the bone is then:
 *
 *   L' = qPinv · R · qW
 *
 * because the animated world rotation works out to  Rparent · R · Wrest — i.e.
 * character-space rotations accumulate down the chain exactly like FK angles,
 * which is what the IK solver assumes. R = identity reproduces the rest pose
 * bit-for-bit, so an un-animated joint is untouched.
 *
 * ------------------------------------------------------------------- forward
 *
 * tools/blender/lib/rig.py authors the face toward Blender +Y, which the glTF
 * Y-up conversion lands on three.js -Z. Rather than hard-code that, the rig is
 * measured at construction (the `back` mount, falling back to the toe
 * direction) and a half-turn is folded into the root yaw when needed. Clips are
 * authored in a canonical frame where forward is positive; `sf` mirrors the X
 * and Z components when the model faces the other way.
 *
 * ------------------------------------------------------------------- budget
 *
 * ~90 entities. update() allocates nothing: all temporaries are module-level
 * scratch, poses live in preallocated Float32Arrays, and callers that freeze an
 * entity simply stop calling update().
 */

// --------------------------------------------------------------------- joints

const JOINT_ORDER = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL',
  'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL',
  'hipR', 'kneeR', 'ankleR',
];

const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4;
const SHL = 5, ELL = 6, WRL = 7;
const SHR = 8, ELR = 9, WRR = 10;
const HIPL = 11, KNEEL = 12, ANKL = 13;
const HIPR = 14, KNEER = 15, ANKR = 16;

const NJ = JOINT_ORDER.length;   // 17
const CH = 6;                    // rx, ry, rz, px, py, pz
const POSE_LEN = NJ * CH;

// ---------------------------------------------------------------------- clips

/**
 * `dur` is the authored length in seconds. `impact` is the normalised time at
 * which onEvent('impact') fires — Combat lands the blow on that callback, so
 * these numbers are gameplay, not decoration. `mask` names the layer weight set
 * used when the clip runs as an overlay.
 */
const CLIPS = {
  'idle':          { loop: true,  dur: 9.6 },
  'idle.combat':   { loop: true,  dur: 4.8 },
  'walk':          { loop: true,  dur: 1.0, locomotion: true },
  'run':           { loop: true,  dur: 1.0, locomotion: true, run: true },
  'attack.slash':  { loop: false, dur: 0.72, impact: 0.44, mask: 'upper' },
  'attack.thrust': { loop: false, dur: 0.60, impact: 0.46, mask: 'upper' },
  'attack.heavy':  { loop: false, dur: 1.05, impact: 0.55, mask: 'heavy' },
  'cast.begin':    { loop: false, dur: 0.55, impact: 0.88, mask: 'upper' },
  'cast.loop':     { loop: true,  dur: 1.80, mask: 'upper' },
  'cast.release':  { loop: false, dur: 0.60, impact: 0.32, mask: 'upper' },
  'hurt':          { loop: false, dur: 0.42, impact: 0.10, mask: 'hurt' },
  'block':         { loop: false, dur: 0.55, impact: 0.22, mask: 'upper' },
  'die':           { loop: false, dur: 1.15, mask: 'full' },
  'dead':          { loop: true,  dur: 2.0,  mask: 'full' },
  'sit':           { loop: true,  dur: 6.4 },
  'pickup':        { loop: false, dur: 0.85, impact: 0.52, mask: 'pickup' },
  'cheer':         { loop: false, dur: 1.50, impact: 0.34, mask: 'upper' },
};

const DEFAULT_CLIP = 'idle';

/** Per-joint overlay authority. 1 == the overlay owns the joint outright. */
const MASK_SPECS = {
  upper:  { hips: 0.30, spine: 0.62, chest: 0.92, neck: 0.85, head: 0.72,
            shoulderL: 0.95, elbowL: 0.90, wristL: 0.90,
            shoulderR: 1.00, elbowR: 1.00, wristR: 1.00,
            hipL: 0.18, kneeL: 0.14, ankleL: 0.10,
            hipR: 0.18, kneeR: 0.14, ankleR: 0.10 },
  heavy:  { hips: 0.55, spine: 0.80, chest: 1.00, neck: 0.90, head: 0.80,
            shoulderL: 1.00, elbowL: 1.00, wristL: 1.00,
            shoulderR: 1.00, elbowR: 1.00, wristR: 1.00,
            hipL: 0.42, kneeL: 0.36, ankleL: 0.28,
            hipR: 0.42, kneeR: 0.36, ankleR: 0.28 },
  hurt:   { hips: 0.55, spine: 0.85, chest: 0.98, neck: 0.95, head: 0.95,
            shoulderL: 0.90, elbowL: 0.90, wristL: 0.85,
            shoulderR: 0.90, elbowR: 0.90, wristR: 0.85,
            hipL: 0.35, kneeL: 0.30, ankleL: 0.22,
            hipR: 0.35, kneeR: 0.30, ankleR: 0.22 },
  pickup: { hips: 0.80, spine: 0.95, chest: 1.00, neck: 0.95, head: 0.90,
            shoulderL: 0.95, elbowL: 0.95, wristL: 0.95,
            shoulderR: 1.00, elbowR: 1.00, wristR: 1.00,
            hipL: 0.60, kneeL: 0.60, ankleL: 0.45,
            hipR: 0.60, kneeR: 0.60, ankleR: 0.45 },
  full:   null,   // all ones
};

function buildMask(spec) {
  const m = new Float32Array(NJ);
  if (!spec) { m.fill(1); return m; }
  for (let i = 0; i < NJ; i++) m[i] = spec[JOINT_ORDER[i]] ?? 1;
  return m;
}

const MASKS = {};
for (const k of Object.keys(MASK_SPECS)) MASKS[k] = buildMask(MASK_SPECS[k]);

// ----------------------------------------------------------------- archetypes

/**
 * Silhouette and temperament. Warriors are heavy and wide, mages are narrow and
 * upright, Taoists sit between them, NPCs never take a combat stance, beasts
 * run a diagonal four-limb gait.
 */
const ARCHETYPES = {
  warrior: { breath: 0.23, breathAmp: 1.20, stance: 1.18, lean: 1.00, armAmp: 1.00, swing: 1.12, turn: 11.0, bounce: 1.10, idleShift: 5.4 },
  mage:    { breath: 0.29, breathAmp: 0.85, stance: 0.82, lean: 0.88, armAmp: 0.82, swing: 0.90, turn: 9.0,  bounce: 0.85, idleShift: 6.6 },
  taoist:  { breath: 0.26, breathAmp: 0.95, stance: 0.92, lean: 0.94, armAmp: 0.90, swing: 0.98, turn: 10.0, bounce: 0.95, idleShift: 6.0 },
  npc:     { breath: 0.24, breathAmp: 1.00, stance: 0.95, lean: 0.85, armAmp: 0.85, swing: 0.90, turn: 7.0,  bounce: 0.90, idleShift: 4.6 },
  beast:   { breath: 0.34, breathAmp: 1.30, stance: 1.00, lean: 1.00, armAmp: 1.00, swing: 1.05, turn: 8.0,  bounce: 1.20, idleShift: 3.8 },
};

// --------------------------------------------------------------------- easing

const PI2 = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

/** Hermite S-curve on the 0..1 interval. */
function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
/** Flatter-ended S-curve; used where a pose must settle without a visible stop. */
function smoother(t) { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); }
function easeOut(t) { t = clamp01(t); return 1 - (1 - t) * (1 - t); }
/** Sharp accelerating ramp — a sword leaving the wind-up. */
function easeInCubic(t) { t = clamp01(t); return t * t * t; }
function easeOutCubic(t) { t = clamp01(t); const u = 1 - t; return 1 - u * u * u; }
/** Ramp up over `a`, hold, ramp down to `b`. Used for overlay weight envelopes. */
function envelope(t, dur, a, b) {
  if (a < 1e-3) a = 1e-3;
  if (b < 1e-3) b = 1e-3;
  return Math.min(smooth(t / a), smooth((dur - t) / b));
}
/** Signed shortest difference between two angles. */
function shortAngle(from, to) {
  let d = (to - from) % PI2;
  if (d > Math.PI) d -= PI2;
  else if (d < -Math.PI) d += PI2;
  return d;
}
/** Frame-rate independent exponential approach. */
function damp(cur, goal, lambda, dt) {
  return goal + (cur - goal) * Math.exp(-lambda * dt);
}

// ------------------------------------------------------------------- springs

/**
 * Critically-dampable scalar spring. Secondary motion (hair, a cape hem, a
 * scabbard swinging off the belt) is driven by these rather than being baked
 * into the clips, so it reacts to whatever the body actually did.
 */
export class Spring {
  constructor(stiffness = 90, damping = 14, value = 0) {
    this.k = stiffness;
    this.d = damping;
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /** Snap to a value, killing any stored velocity. */
  reset(v = 0) { this.value = v; this.target = v; this.velocity = 0; return this; }

  update(dt) {
    // Sub-step so a stiff spring stays stable at a long frame.
    const steps = dt > 0.034 ? 3 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.k - this.velocity * this.d;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

/** Three independent springs sharing one set of coefficients. */
export class SpringVec3 {
  constructor(stiffness = 90, damping = 14) {
    this.x = new Spring(stiffness, damping);
    this.y = new Spring(stiffness, damping);
    this.z = new Spring(stiffness, damping);
  }

  setTarget(x, y, z) { this.x.target = x; this.y.target = y; this.z.target = z; return this; }

  reset(x = 0, y = 0, z = 0) { this.x.reset(x); this.y.reset(y); this.z.reset(z); return this; }

  update(dt) { this.x.update(dt); this.y.update(dt); this.z.update(dt); return this; }

  writeTo(v3) { v3.set(this.x.value, this.y.value, this.z.value); return v3; }
}

// -------------------------------------------------------------------- scratch

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mInv = new THREE.Matrix4();
const _sc = new THREE.Vector3();

// =============================================================================

export class Animator {
  /**
   * @param {object} rig  a Rig per docs/CONTRACTS.md §11 (joints may be bones)
   * @param {{archetype?:string, quality?:string}} [opts]
   */
  constructor(rig, { archetype = 'warrior', quality = 'high' } = {}) {
    this.rig = rig;
    this.archetype = archetype;
    this.tune = ARCHETYPES[archetype] || ARCHETYPES.warrior;
    this.quality = quality;

    /** Caller may flip this off to park an entity without tearing it down. */
    this.enabled = true;
    /** 0 = full fidelity, 1 = cheap FK legs, 2 = half-rate. */
    this.lod = 0;

    /** @type {string} name of the active base clip */
    this.current = DEFAULT_CLIP;
    this.prev = null;
    this.time = 0;
    this.prevTime = 0;
    this.fade = 1;
    this.fadeDur = 0.18;
    this.timeScale = 1;
    this.prevTimeScale = 1;
    this._baseCb = null;
    this._baseFired = false;

    // overlay layer
    this.overlayName = null;
    this._ovTime = 0;
    this._ovDur = 0;
    this._ovIn = 0.09;
    this._ovOut = 0.16;
    this._ovImpact = -1;
    this._ovFired = true;
    this._ovCb = null;
    this._ovMask = MASKS.upper;
    this._ovScale = 1;
    this._ovWeight = 0;

    /** Heading the entity wants, radians, contract convention (0 => +Z). */
    this.facingTarget = 0;
    /** Eased heading actually rendered. */
    this.facing = 0;
    this._facingInit = false;
    this._turnRate = 0;
    this._lead = 0;

    // locomotion state
    this.speed = 0;
    this.stride = 0;
    this.strideLen = 1;
    this._lastX = 0;
    this._lastZ = 0;
    this._havePos = false;
    this._vx = 0; this._vz = 0;
    this._ax = 0; this._az = 0;
    this.duty = 0.6;
    this._halfStep = 0;
    this._lodTick = 0;

    // per-leg scratch (instance fields: no per-frame allocation)
    this._fF = 0; this._fY = 0; this._fP = 0;
    this._a1 = 0; this._a2 = 0;

    // pose buffers
    this._poseA = new Float32Array(POSE_LEN);
    this._poseB = new Float32Array(POSE_LEN);
    this._poseO = new Float32Array(POSE_LEN);
    this._out = new Float32Array(POSE_LEN);

    /** @type {Array<{object:THREE.Object3D, spring:SpringVec3, gain:number, base:THREE.Euler}>} */
    this.secondary = [];

    this._bindJoints();
    this._measureSkeleton();
    this._adoptSecondary();
  }

  // ------------------------------------------------------------- construction

  /** Capture rest transforms and the character-space conversion quaternions. */
  _bindJoints() {
    const rig = this.rig;
    const root = rig && rig.root ? rig.root : null;

    this.joints = new Array(NJ).fill(null);
    this.restQ = [];
    this.restP = [];
    this.qW = [];
    this.qPinv = [];
    this.pScale = new Float32Array(NJ);
    this.hasJoint = new Uint8Array(NJ);
    this.restWorld = [];

    for (let i = 0; i < NJ; i++) {
      this.restQ.push(new THREE.Quaternion());
      this.restP.push(new THREE.Vector3());
      this.qW.push(new THREE.Quaternion());
      this.qPinv.push(new THREE.Quaternion());
      this.restWorld.push(new THREE.Vector3());
      this.pScale[i] = 1;
    }

    if (!root) return;
    root.updateMatrixWorld(true);
    _mInv.copy(root.matrixWorld).invert();

    const joints = rig.joints || {};
    for (let i = 0; i < NJ; i++) {
      const j = joints[JOINT_ORDER[i]];
      if (!j || !j.isObject3D) continue;
      this.joints[i] = j;
      this.hasJoint[i] = 1;
      this.restQ[i].copy(j.quaternion);
      this.restP[i].copy(j.position);

      // Rest transform relative to rig.root (== character space).
      _m.multiplyMatrices(_mInv, j.matrixWorld);
      _m.decompose(_v, _q, _sc);
      this.restWorld[i].copy(_v);
      this.qW[i].copy(_q);

      const p = j.parent;
      if (p) {
        _m.multiplyMatrices(_mInv, p.matrixWorld);
        _m.decompose(_v2, _q2, _sc);
        this.qPinv[i].copy(_q2).invert();
        // A bone's translation lives in parent-local units; character-space
        // offsets have to be divided back out by the parent's scale.
        const s = (Math.abs(_sc.x) + Math.abs(_sc.y) + Math.abs(_sc.z)) / 3;
        this.pScale[i] = s > 1e-6 ? 1 / s : 1;
      } else {
        this.qPinv[i].identity();
      }
    }
  }

  /**
   * Work out which way the model faces and how long its legs are, so the same
   * clips drive a 1.6-unit villager and a 3-unit boss without retuning.
   */
  _measureSkeleton() {
    const rig = this.rig;

    // ---- forward. The `back` mount is the clearest signal; the toe direction
    // of the ankle bones is the fallback for rigs that lack mount points.
    let facesMinusZ = true;
    let decided = false;
    const back = rig && rig.attach ? rig.attach.back : null;
    if (back && back.isObject3D && rig.root) {
      rig.root.updateMatrixWorld(true);
      _mInv.copy(rig.root.matrixWorld).invert();
      _v.setFromMatrixPosition(back.matrixWorld).applyMatrix4(_mInv);
      if (Math.abs(_v.z) > 0.02) { facesMinusZ = _v.z > 0; decided = true; }
    }
    if (!decided) {
      let z = 0, n = 0;
      for (const idx of [ANKL, ANKR]) {
        if (!this.hasJoint[idx]) continue;
        // A bone's +Y axis runs head -> tail; on a foot that is the toe.
        _v.set(0, 1, 0).applyQuaternion(this.qW[idx]);
        z += _v.z; n++;
      }
      if (n && Math.abs(z / n) > 0.15) { facesMinusZ = (z / n) < 0; decided = true; }
    }
    this.facesMinusZ = facesMinusZ;
    /** Half-turn folded into the root so contract facing 0 really looks at +Z. */
    this.yawOffset = facesMinusZ ? Math.PI : 0;
    /** Mirrors the X/Z components of an authored pose onto this model. */
    this.sf = facesMinusZ ? 1 : -1;

    // ---- proportions
    const hipY = this.hasJoint[HIPL] ? this.restWorld[HIPL].y : 0.96;
    const ankY = this.hasJoint[ANKL] ? this.restWorld[ANKL].y : 0.09;
    const kneeY = this.hasJoint[KNEEL] ? this.restWorld[KNEEL].y : (hipY + ankY) * 0.5;

    this.hipOriginY = hipY;
    this.ankleRestY = ankY;
    this.L1 = (this.hasJoint[KNEEL] && this.hasJoint[HIPL])
      ? Math.max(0.02, this.restWorld[HIPL].distanceTo(this.restWorld[KNEEL]))
      : Math.max(0.02, hipY - kneeY);
    this.L2 = (this.hasJoint[ANKL] && this.hasJoint[KNEEL])
      ? Math.max(0.02, this.restWorld[KNEEL].distanceTo(this.restWorld[ANKL]))
      : Math.max(0.02, kneeY - ankY);
    this.legLen = this.L1 + this.L2;
    this.legReach = this.legLen * 0.985;
    this.hipSpanX = this.hasJoint[HIPL] ? Math.abs(this.restWorld[HIPL].x) : 0.095;
    this.socketXL = this.hasJoint[HIPL] ? this.restWorld[HIPL].x : this.hipSpanX;
    this.socketXR = this.hasJoint[HIPR] ? this.restWorld[HIPR].x : -this.hipSpanX;

    /** Everything authored in metres is scaled by this so small rigs read right. */
    this.sk = clamp(this.legLen / 0.87, 0.25, 4);

    // Two-bone IK only makes sense if the ankle really sits below the hip.
    this.ikOk = this.hasJoint[HIPL] && this.hasJoint[KNEEL] && this.hasJoint[ANKL] &&
                this.hasJoint[HIPR] && this.hasJoint[KNEER] && this.hasJoint[ANKR] &&
                (hipY - ankY) > 0.12 && this.L1 > 0.03 && this.L2 > 0.03;

    // A chest bone that points along the ground means a quadruped: the front
    // limbs have to be driven as legs, not as arms.
    let horizontalSpine = false;
    if (this.hasJoint[CHEST]) {
      _v.set(0, 1, 0).applyQuaternion(this.qW[CHEST]);
      horizontalSpine = Math.abs(_v.y) < 0.55;
    }
    this.quadruped = this.archetype === 'beast' && horizontalSpine;

    this.standY = -0.018 * this.sk;   // resting knee softness
  }

  /** Rigs may publish `secondary:[{object,...}]` for hair, capes, scabbards. */
  _adoptSecondary() {
    const list = this.rig && this.rig.secondary;
    if (!Array.isArray(list)) return;
    for (const s of list) {
      const o = s && (s.object || s.obj || s);
      if (o && o.isObject3D) this.addSecondary(o, s);
    }
  }

  /**
   * Register an object for spring-driven secondary motion. Driven by the
   * body's own acceleration and turn rate, so it lags and overshoots.
   * @param {THREE.Object3D} object
   */
  addSecondary(object, { stiffness = 78, damping = 12, gain = 0.05, limit = 0.5 } = {}) {
    if (!object || !object.isObject3D) return null;
    const rec = {
      object,
      spring: new SpringVec3(stiffness, damping),
      gain,
      limit,
      base: new THREE.Euler().copy(object.rotation),
    };
    this.secondary.push(rec);
    return rec;
  }

  // -------------------------------------------------------------- public API

  /**
   * Start (or keep playing) a looping base clip. Safe to call every frame with
   * the same name — Player/Monster/Npc all do exactly that.
   * @param {string} name
   * @param {{speed?:number, loop?:boolean, blend?:number, onEvent?:Function, force?:boolean}} [opts]
   */
  play(name, opts = {}) {
    if (!CLIPS[name]) {
      if (!Animator._warned) Animator._warned = new Set();
      if (!Animator._warned.has(name)) {
        Animator._warned.add(name);
        console.warn(`[animator] unknown clip '${name}', falling back to '${DEFAULT_CLIP}'`);
      }
      name = DEFAULT_CLIP;
    }
    if (name === this.current && !opts.force) {
      if (opts.onEvent) this._baseCb = opts.onEvent;
      if (opts.speed) this.timeScale = opts.speed;
      return;
    }

    this.prev = this.current;
    this.prevTime = this.time;
    this.prevTimeScale = this.timeScale;
    this.fadeDur = Math.max(0.001, opts.blend ?? 0.18);
    this.fade = 0;

    this.current = name;
    this.time = 0;
    this.timeScale = opts.speed || 1;
    this._baseCb = opts.onEvent || null;
    this._baseFired = false;
  }

  /**
   * Layer a one-shot over whatever is looping (attack while walking, a flinch
   * mid-run). Fires onEvent('start'|'impact'|'end').
   * @param {string} name
   * @param {{speed?:number, blend?:number, onEvent?:Function}} [opts]
   */
  overlay(name, opts = {}) {
    const clip = CLIPS[name];
    if (!clip) {
      if (!Animator._warned) Animator._warned = new Set();
      if (!Animator._warned.has(name)) {
        Animator._warned.add(name);
        console.warn(`[animator] unknown overlay '${name}' ignored`);
      }
      return;
    }

    // Never swallow a pending hit: if something interrupts an attack before
    // its contact frame, resolve the contact now so Combat still lands it.
    // The old callback is detached first, so a handler that starts its own
    // overlay cannot be clobbered by the rest of this call.
    if (this.overlayName && this._ovCb) {
      const cb = this._ovCb;
      const pending = !this._ovFired;
      this._ovCb = null;
      this._ovFired = true;
      if (pending) { try { cb('impact'); } catch (e) { console.error('[animator] impact handler', e); } }
      try { cb('end'); } catch (e) { console.error('[animator] end handler', e); }
    }

    this._ovScale = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.overlayName = name;
    this._ovTime = 0;
    this._ovDur = clip.dur / this._ovScale;
    this._ovIn = Math.min(opts.blend ?? 0.09, this._ovDur * 0.35);
    this._ovOut = Math.min(0.16, this._ovDur * 0.45);
    this._ovImpact = clip.impact !== undefined ? clip.impact * this._ovDur : -1;
    this._ovFired = this._ovImpact < 0;
    this._ovCb = opts.onEvent || null;
    this._ovMask = MASKS[clip.mask] || MASKS.upper;
    this._ovWeight = 0;

    // Fired last, and through a local, so a handler that immediately queues a
    // different overlay wins cleanly instead of being half-overwritten.
    const cb = this._ovCb;
    if (cb) { try { cb('start'); } catch (e) { console.error('[animator] start handler', e); } }
  }

  /** True while a one-shot overlay is still running. */
  get busy() { return this.overlayName !== null; }

  /** Drop the overlay layer without firing its remaining events. */
  clearOverlay() {
    this.overlayName = null;
    this._ovCb = null;
    this._ovWeight = 0;
  }

  /** Jump the visual heading with no easing (spawns, teleports, revives). */
  setFacing(a) {
    this.facing = a;
    this.facingTarget = a;
    this._facingInit = true;
    this._lead = 0;
    if (this.rig && this.rig.root) this.rig.root.rotation.y = a + this.yawOffset;
  }

  /** Rendering detail: 0 full, 1 cheap legs, 2 half-rate. */
  setLod(n) { this.lod = clamp(n | 0, 0, 2); }

  // ------------------------------------------------------------------ update

  update(dt) {
    if (!this.enabled || !this.rig) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;

    this._trackHost(dt);
    this._updateFacing(dt);
    this._advanceTime(dt);

    if (this.lod >= 2) {
      // Half-rate skinning for distant crowds. Clocks and heading still run
      // every frame, so nothing jumps when the entity comes back into detail.
      this._lodTick ^= 1;
      if (this._lodTick) { this._updateSecondary(dt); return; }
    }

    const out = this._out;
    const A = this._poseA;

    // `time`/`prevTime` already advance at their clip's timeScale, so the base
    // layer passes 1. Only the overlay layer keeps raw elapsed seconds and
    // needs its rate folded in here.
    this._evalClip(this.current, this.time, 1, A);

    if (this.fade < 1 && this.prev) {
      const B = this._poseB;
      this._evalClip(this.prev, this.prevTime, 1, B);
      const f = smooth(this.fade);
      const g = 1 - f;
      for (let i = 0; i < POSE_LEN; i++) out[i] = B[i] * g + A[i] * f;
    } else {
      out.set(A);
    }

    if (this.overlayName) {
      const O = this._poseO;
      this._evalClip(this.overlayName, this._ovTime, this._ovScale, O);
      const w = this._ovWeight;
      const mask = this._ovMask;
      if (w > 0.0005) {
        for (let j = 0; j < NJ; j++) {
          const k = w * mask[j];
          if (k <= 0.0005) continue;
          const inv = 1 - k;
          const o = j * CH;
          out[o]     = out[o]     * inv + O[o]     * k;
          out[o + 1] = out[o + 1] * inv + O[o + 1] * k;
          out[o + 2] = out[o + 2] * inv + O[o + 2] * k;
          out[o + 3] = out[o + 3] * inv + O[o + 3] * k;
          out[o + 4] = out[o + 4] * inv + O[o + 4] * k;
          out[o + 5] = out[o + 5] * inv + O[o + 5] * k;
        }
      }
    }

    // Turning reads as weight when the shoulders arrive after the hips.
    if (this._lead !== 0 && this.hasJoint[CHEST]) {
      out[CHEST * CH + 1] += this._lead;
      out[SPINE * CH + 1] += this._lead * 0.45;
      out[HIPS * CH + 1] -= this._lead * 0.30;
      out[HEAD * CH + 1] += this._lead * 0.35;
    }

    this._applyPose(out);
    this._updateSecondary(dt);
  }

  /** Clocks only — used by the LOD skip path and by the main path alike. */
  _advanceTime(dt) {
    const clip = CLIPS[this.current];
    this.time += dt * this.timeScale;
    if (clip.loop) {
      if (this.time >= clip.dur) this.time %= clip.dur;
    } else if (this.time > clip.dur) {
      this.time = clip.dur;
      if (this._baseCb && !this._baseFired) {
        this._baseFired = true;
        const cb = this._baseCb;
        this._baseCb = null;
        try { cb('end'); } catch (e) { console.error('[animator] base end handler', e); }
      }
    }

    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / this.fadeDur);
      const pc = CLIPS[this.prev];
      if (pc) {
        this.prevTime += dt * this.prevTimeScale;
        if (pc.loop) { if (this.prevTime >= pc.dur) this.prevTime %= pc.dur; }
        else if (this.prevTime > pc.dur) this.prevTime = pc.dur;
      }
      if (this.fade >= 1) this.prev = null;
    }

    // Stride phase — driven by real ground speed, which is what stops skating.
    //
    // Duty factor falls as the entity speeds up. That matters more than it
    // looks: the pelvis has to drop by legLen - sqrt(legLen^2 - halfStep^2) at
    // full split, so a long stance at game speeds turns the walk into a lurch.
    // Shortening stance (and eventually opening a flight phase) keeps the feet
    // planted without the body pumping up and down.
    const isRun = CLIPS[this.current].run || !!(this.prev && CLIPS[this.prev] && CLIPS[this.prev].run);
    const v = this.speed;
    const raw = isRun ? (1.05 + 0.28 * v) : (0.70 + 0.24 * v);
    this.strideLen = clamp(raw, 0.75, isRun ? 3.1 : 2.4) * this.sk;
    this.duty = isRun ? clamp(0.42 - 0.030 * v, 0.28, 0.42)
                      : clamp(0.62 - 0.055 * v, 0.42, 0.64);
    this._halfStep = 0.5 * this.duty * this.strideLen;
    if (this.strideLen > 1e-4) {
      this.stride += (v / this.strideLen) * dt;
      if (this.stride >= 1 || this.stride < 0) this.stride -= Math.floor(this.stride);
    }

    if (this.overlayName) {
      const token = this.overlayName;
      this._ovTime += dt;

      // Contact frame. Combat lands the blow here, and a handler is free to
      // start another overlay from inside the callback, so every field is
      // re-read afterwards rather than cached across the call.
      if (!this._ovFired && this._ovImpact >= 0 && this._ovTime >= this._ovImpact) {
        this._ovFired = true;
        const cb = this._ovCb;
        if (cb) { try { cb('impact'); } catch (e) { console.error('[animator] impact handler', e); } }
      }

      if (this.overlayName) {
        this._ovWeight = envelope(this._ovTime, this._ovDur, this._ovIn, this._ovOut);
        // Only retire the clip we started this tick; a handler may have
        // replaced it, in which case the new one owns the layer now.
        if (this.overlayName === token && this._ovTime >= this._ovDur) {
          const cb = this._ovCb;
          const pending = !this._ovFired;
          this._ovCb = null;
          this._ovFired = true;
          this.overlayName = null;
          this._ovWeight = 0;
          if (cb) {
            if (pending) { try { cb('impact'); } catch (e) { console.error('[animator] impact handler', e); } }
            try { cb('end'); } catch (e) { console.error('[animator] end handler', e); }
          }
        }
      }
    }
  }

  /** Derive ground speed and acceleration from the object the rig hangs under. */
  _trackHost(dt) {
    const host = this.rig.root ? this.rig.root.parent : null;
    if (!host || dt <= 0) { this.speed = damp(this.speed, 0, 12, dt || 0.016); return; }
    const x = host.position.x, z = host.position.z;
    if (!this._havePos) {
      this._lastX = x; this._lastZ = z; this._havePos = true;
      return;
    }
    const dx = x - this._lastX, dz = z - this._lastZ;
    this._lastX = x; this._lastZ = z;

    const inst = Math.min(14, Math.hypot(dx, dz) / dt);
    // A teleport reads as a huge spike; ignore rather than break into a sprint.
    this.speed = inst > 12 ? damp(this.speed, 0, 8, dt) : damp(this.speed, inst, 11, dt);

    const nvx = dx / dt, nvz = dz / dt;
    this._ax = damp(this._ax, (nvx - this._vx) / dt, 9, dt);
    this._az = damp(this._az, (nvz - this._vz) / dt, 9, dt);
    this._vx = nvx; this._vz = nvz;
  }

  _updateFacing(dt) {
    if (!this._facingInit) {
      this.facing = this.facingTarget;
      this._facingInit = true;
    }
    const d = shortAngle(this.facing, this.facingTarget);
    const lambda = this.tune.turn;
    const step = d * (1 - Math.exp(-lambda * dt));
    this.facing += step;
    if (this.facing > Math.PI) this.facing -= PI2;
    else if (this.facing < -Math.PI) this.facing += PI2;

    // Shoulders lead the hips into a turn, then unwind.
    const rate = dt > 0 ? step / dt : 0;
    this._turnRate = damp(this._turnRate, rate, 10, dt);
    this._lead = clamp(this._turnRate * 0.055, -0.42, 0.42);

    if (this.rig.root) this.rig.root.rotation.y = this.facing + this.yawOffset;
  }

  _updateSecondary(dt) {
    const n = this.secondary.length;
    if (!n) return;
    // Body-local acceleration: what a cape would actually feel.
    const c = Math.cos(-this.facing), s = Math.sin(-this.facing);
    const ax = this._ax * c - this._az * s;
    const az = this._ax * s + this._az * c;
    for (let i = 0; i < n; i++) {
      const r = this.secondary[i];
      const g = r.gain;
      r.spring.setTarget(
        clamp(-az * g * this.sf, -r.limit, r.limit),
        clamp(this._turnRate * g * 0.5, -r.limit, r.limit),
        clamp(ax * g, -r.limit, r.limit)
      );
      r.spring.update(dt);
      r.object.rotation.set(
        r.base.x + r.spring.x.value,
        r.base.y + r.spring.y.value,
        r.base.z + r.spring.z.value
      );
    }
  }

  // ------------------------------------------------------------ pose plumbing

  _set(P, j, rx, ry, rz) {
    const o = j * CH;
    P[o] = rx; P[o + 1] = ry; P[o + 2] = rz;
  }

  _setPos(P, j, px, py, pz) {
    const o = j * CH;
    P[o + 3] = px; P[o + 4] = py; P[o + 5] = pz;
  }

  _add(P, j, rx, ry, rz) {
    const o = j * CH;
    P[o] += rx; P[o + 1] += ry; P[o + 2] += rz;
  }

  /** Write the blended pose onto the bones as a delta from their rest pose. */
  _applyPose(P) {
    const sf = this.sf;
    for (let j = 0; j < NJ; j++) {
      if (!this.hasJoint[j]) continue;
      const bone = this.joints[j];
      const o = j * CH;
      const rx = P[o] * sf, ry = P[o + 1], rz = P[o + 2] * sf;

      if (rx !== 0 || ry !== 0 || rz !== 0) {
        // Compose in scratch and assign once. Object3D.quaternion fires an
        // Euler re-extraction (asin/atan2) on *every* mutation, so doing the
        // copy+multiply+multiply on the bone itself costs three of them per
        // joint per frame — the single biggest cost in this whole file.
        _e.set(rx, ry, rz, 'YXZ');
        _q.setFromEuler(_e);
        _q2.copy(this.qPinv[j]).multiply(_q).multiply(this.qW[j]);
        bone.quaternion.copy(_q2);
      } else {
        bone.quaternion.copy(this.restQ[j]);
      }

      // Authored offsets are +X toward the "L" joints, +Y up, +Z forward.
      const px = P[o + 3], py = P[o + 4], pz = P[o + 5];
      if (px !== 0 || py !== 0 || pz !== 0) {
        _v.set(px * sf, py, -pz * sf).applyQuaternion(this.qPinv[j]).multiplyScalar(this.pScale[j]);
        bone.position.copy(this.restP[j]).add(_v);
      } else {
        bone.position.copy(this.restP[j]);
      }
    }
  }

  /**
   * Dispatch a clip name to its poser.
   * @param {string} name
   * @param {number} t      seconds into the clip
   * @param {number} scale  playback rate still to be folded into `t`
   * @param {Float32Array} P
   */
  _evalClip(name, t, scale, P) {
    P.fill(0);
    const clip = CLIPS[name] || CLIPS[DEFAULT_CLIP];
    switch (name) {
      case 'walk':          this._poseLocomotion(P, false); break;
      case 'run':           this._poseLocomotion(P, true); break;
      case 'idle':          this._poseIdle(P, t); break;
      case 'idle.combat':   this._poseIdleCombat(P, t); break;
      case 'attack.slash':  this._poseSlash(P, t / clip.dur * scale); break;
      case 'attack.thrust': this._poseThrust(P, t / clip.dur * scale); break;
      case 'attack.heavy':  this._poseHeavy(P, t / clip.dur * scale); break;
      case 'cast.begin':    this._poseCastBegin(P, t / clip.dur * scale); break;
      case 'cast.loop':     this._poseCastLoop(P, t); break;
      case 'cast.release':  this._poseCastRelease(P, t / clip.dur * scale); break;
      case 'hurt':          this._poseHurt(P, t / clip.dur * scale); break;
      case 'block':         this._poseBlock(P, t / clip.dur * scale); break;
      case 'die':           this._poseDie(P, t / clip.dur * scale); break;
      case 'dead':          this._poseDie(P, 1); break;
      case 'sit':           this._poseSit(P, t); break;
      case 'pickup':        this._posePickup(P, t / clip.dur * scale); break;
      case 'cheer':         this._poseCheer(P, t / clip.dur * scale); break;
      default:              this._poseIdle(P, t); break;
    }
    return P;
  }

  // ------------------------------------------------------------------ leg IK

  /**
   * Planar two-bone solve. Writes forward-positive absolute angles for the
   * thigh (_a1) and the shin (_a2), measured from straight-down.
   * @param {number} f   forward offset of the ankle from the hip socket
   * @param {number} dy  vertical offset (negative: the foot is below the hip)
   */
  _ik(f, dy) {
    const L1 = this.L1, L2 = this.L2;
    if (dy > -0.02) dy = -0.02;
    let d = Math.sqrt(f * f + dy * dy);
    const dMax = (L1 + L2) * 0.999;
    const dMin = Math.abs(L1 - L2) + 0.02;
    if (d > dMax) d = dMax; else if (d < dMin) d = dMin;

    const alpha = Math.atan2(f, -dy);
    let cb = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    cb = cb < -1 ? -1 : cb > 1 ? 1 : cb;
    let cg = (L2 * L2 + d * d - L1 * L1) / (2 * L2 * d);
    cg = cg < -1 ? -1 : cg > 1 ? 1 : cg;

    this._a1 = alpha + Math.acos(cb);   // thigh, knee leads forward
    this._a2 = alpha - Math.acos(cg);   // shin, heel trails back
  }

  /**
   * Plant one foot. `f` is the ankle's forward offset from the hip socket,
   * `ly` its lift above the ground, `pitch` the desired absolute foot pitch.
   * `hipsRx`/`hipsRy`/`hipsRz` are the pelvis values already written, so the
   * chain can subtract them and keep the foot exactly where it was asked for.
   */
  _plantLeg(P, jh, jk, ja, f, ly, pitch, hipY, hipsRx, hipsRy, hipsRz, shiftX, abduct, socketX) {
    if (!this.ikOk) {
      // Degenerate skeleton (unbuilt monster rig): cheap FK so it still moves.
      const a = Math.atan2(f, this.legLen);
      this._set(P, jh, a - hipsRx, -hipsRy, abduct - hipsRz);
      this._set(P, jk, -Math.abs(a) * 0.9 - 0.12, 0, 0);
      this._set(P, ja, pitch, 0, 0);
      return;
    }
    // Pelvis yaw and roll carry the hip socket itself around; fold that back
    // out of the target or the planted foot creeps as the pelvis works.
    const socketF = socketX * Math.sin(hipsRy);
    const socketY = socketX * Math.sin(hipsRz);
    f -= socketF;
    hipY += socketY;

    const targetY = this.ankleRestY + ly;
    this._ik(f, targetY - hipY);
    const a1 = this._a1, a2 = this._a2;
    // Lateral: keep the foot under its rest x while the pelvis slides.
    const lat = clamp(-shiftX / this.legLen, -0.5, 0.5);
    const zc = Math.asin(lat) + abduct - hipsRz;
    this._set(P, jh, a1 - hipsRx, -hipsRy, zc);
    this._set(P, jk, a2 - a1, 0, 0);
    this._set(P, ja, pitch - a2, 0, 0);
  }

  /**
   * A static two-footed stance solved with the same IK, so idles and attacks
   * sit on the ground exactly the way the walk does.
   *
   * Positional rather than an options object on purpose: this runs once per
   * clip evaluation per entity, and an options literal here is ~90 short-lived
   * objects a frame.
   *
   * @param {Float32Array} P
   * @param {number} crouch  extra pelvis drop, in metres before rig scaling
   * @param {number} fL      left foot forward offset from its hip socket
   * @param {number} fR      right foot forward offset
   * @param {number} shiftX  lateral pelvis shift (+X is the "L" side)
   * @param {number} hipsRx  pelvis pitch  (canonical: + == leaning back)
   * @param {number} hipsRy  pelvis yaw    (+ == the "L" hip leads forward)
   * @param {number} hipsRz  pelvis roll   (+ == the "L" hip rides high)
   * @param {number} twistL  left leg abduction
   * @param {number} twistR  right leg abduction
   */
  _stance(P, crouch, fL, fR, shiftX, hipsRx, hipsRy, hipsRz, twistL, twistR) {
    const sk = this.sk;
    const reach = this.legReach;
    const capL = this.ankleRestY + Math.sqrt(Math.max(1e-4, reach * reach - fL * fL));
    const capR = this.ankleRestY + Math.sqrt(Math.max(1e-4, reach * reach - fR * fR));
    let hipY = Math.min(this.hipOriginY + this.standY, capL, capR) - crouch * sk;
    hipY = Math.max(hipY, this.ankleRestY + this.legLen * 0.42);

    this._setPos(P, HIPS, shiftX, hipY - this.hipOriginY, 0);
    this._add(P, HIPS, hipsRx, hipsRy, hipsRz);

    this._plantLeg(P, HIPL, KNEEL, ANKL, fL, 0, 0, hipY, hipsRx, hipsRy, hipsRz, shiftX, twistL, this.socketXL);
    this._plantLeg(P, HIPR, KNEER, ANKR, fR, 0, 0, hipY, hipsRx, hipsRy, hipsRz, shiftX, twistR, this.socketXR);
    return hipY;
  }

  // -------------------------------------------------------------- locomotion

  /**
   * Contact / down / passing / up, driven by real speed. The pelvis height is
   * *derived* from how far apart the feet are, which is what produces the
   * classic double-frequency rise-and-fall for free and guarantees the stance
   * leg can always reach the ground.
   */
  _poseLocomotion(P, run) {
    const T = this.tune;
    const sk = this.sk;
    const p = this.stride;
    const duty = this.duty;
    const half = this._halfStep;
    const lift = (run ? 0.20 : 0.085) * sk;

    // How energetic the cycle is; a crawl should not swing like a march.
    const gas = clamp(this.speed / (run ? 5.0 : 3.2), 0, 1.25);

    this._footTrack(p, duty, half, lift, run);
    const fL = this._fF, lyL = this._fY, fpL = this._fP;
    this._footTrack(p + 0.5, duty, half, lift, run);
    const fR = this._fF, lyR = this._fY, fpR = this._fP;

    // Pelvis height: the lowest of what each leg can still reach.
    const reach = this.legReach;
    const capL = this.ankleRestY + lyL + Math.sqrt(Math.max(1e-4, reach * reach - fL * fL));
    const capR = this.ankleRestY + lyR + Math.sqrt(Math.max(1e-4, reach * reach - fR * fR));
    let hipY = Math.min(this.hipOriginY + this.standY, capL, capR) - 0.012 * sk;
    // A touch of extra squash on the down phase reads as weight.
    hipY -= (run ? 0.022 : 0.010) * sk * gas * Math.max(0, Math.sin(PI2 * (p - 0.06) * 2));
    hipY = Math.max(hipY, this.ankleRestY + this.legLen * 0.45);

    // Lateral weight shift onto the supporting leg (L is planted around p=0.3).
    const supportPhase = Math.cos(PI2 * (p - duty * 0.5));
    const shiftX = (run ? 0.020 : 0.036) * sk * gas * supportPhase;
    const hipsRz = (run ? 0.030 : 0.046) * gas * supportPhase;
    const hipsRy = (run ? 0.150 : 0.090) * gas * Math.cos(PI2 * p);
    const leanFwd = (run ? 0.230 : 0.055) * T.lean * gas;
    const hipsRx = -leanFwd * 0.35;

    this._setPos(P, HIPS, shiftX, hipY - this.hipOriginY, 0);
    this._set(P, HIPS, hipsRx, hipsRy, hipsRz);

    if (this.quadruped) {
      this._quadLimbs(P, p, duty, half, lift, gas, run);
    } else {
      this._plantLeg(P, HIPL, KNEEL, ANKL, fL, lyL, fpL, hipY, hipsRx, hipsRy, hipsRz, shiftX, 0.012, this.socketXL);
      this._plantLeg(P, HIPR, KNEER, ANKR, fR, lyR, fpR, hipY, hipsRx, hipsRy, hipsRz, shiftX, -0.012, this.socketXR);
    }

    // Torso: counter-rotate against the pelvis, lean into the run.
    const counter = -hipsRy;
    this._set(P, SPINE, -leanFwd * 0.34, counter * 0.55, -hipsRz * 0.45);
    this._set(P, CHEST, -leanFwd * 0.31, counter * 1.05, -hipsRz * 0.55);
    // Chest breathes harder the faster we go.
    this._add(P, CHEST, 0.012 * Math.sin(PI2 * p * 2), 0, 0);

    // Head stabilised: it should not bob or twist with the shoulders.
    this._set(P, NECK, leanFwd * 0.22, counter * -0.35, 0);
    this._set(P, HEAD, leanFwd * 0.34 + 0.02 * Math.sin(PI2 * p * 2 + 1.1), counter * -0.55, -hipsRz * -0.3);

    if (this.quadruped) return;

    // Arms opposite the legs, driven off the actual foot travel.
    const norm = half > 1e-4 ? 1 / half : 0;
    const armAmp = (run ? 0.82 : 0.46) * T.armAmp * gas;
    const swingR = clamp(fL * norm, -1.3, 1.3) * armAmp;
    const swingL = clamp(fR * norm, -1.3, 1.3) * armAmp;
    const bendBase = run ? 1.32 : 0.24;
    const bendVar = run ? 0.30 : 0.42;

    this._armSwing(P, SHL, ELL, WRL, swingL, bendBase, bendVar, 1, run, gas, leanFwd);
    this._armSwing(P, SHR, ELR, WRR, swingR, bendBase, bendVar, -1, run, gas, leanFwd);
  }

  /**
   * Foot trajectory for one leg. Stance travels backwards at exactly the speed
   * the body moves forward — that is the whole no-skating trick.
   * Results land in _fF (forward), _fY (lift), _fP (pitch).
   */
  _footTrack(u, duty, half, lift, run) {
    u -= Math.floor(u);
    if (u < duty) {
      const s = u / duty;
      this._fF = half * (1 - 2 * s);
      this._fY = 0;
      // heel strike -> flat -> toe off
      if (s < 0.18) this._fP = lerp(-0.24, 0, smooth(s / 0.18));
      else if (s < 0.62) this._fP = 0;
      else this._fP = lerp(0, run ? 0.62 : 0.46, smooth((s - 0.62) / 0.38));
    } else {
      const s = (u - duty) / (1 - duty);
      // Slight overshoot before contact gives the leg a reaching feel.
      const e = smoother(s);
      const over = Math.sin(Math.PI * s) * 0.06;
      this._fF = lerp(-half, half, e) + over * half;
      this._fY = lift * Math.pow(Math.sin(Math.PI * s), 0.85);
      if (s < 0.35) this._fP = lerp(run ? 0.62 : 0.46, -0.10, smooth(s / 0.35));
      else this._fP = lerp(-0.10, -0.24, smooth((s - 0.35) / 0.65));
    }
  }

  _armSwing(P, js, je, jw, swing, bendBase, bendVar, side, run, gas, leanFwd) {
    // Clavicle: a small lift, opposite the swing, keeps the shoulders alive.
    this._set(P, js, -swing * 0.10, swing * 0.10, side * (0.015 + 0.030 * gas * (run ? 1 : 0.5)));
    // Upper arm: fore/aft swing plus a little outward clearance.
    const abduct = side * (0.085 + (run ? 0.055 : 0.020) * gas);
    this._set(P, je, swing - 0.055 - leanFwd * 0.25, side * swing * 0.10, abduct);
    // Forearm: bent, and bent harder as the hand comes forward.
    const bend = bendBase + bendVar * Math.max(0, swing) + (run ? 0.18 : 0.06) * gas;
    this._set(P, jw, bend, 0, 0);
  }

  /** Diagonal-pair gait: front limbs move with the opposite hind limb. */
  _quadLimbs(P, p, duty, half, lift, gas, run) {
    const scale = 0.75;
    this._footTrack(p, duty, half, lift, run);
    const swHindL = clamp(this._fF / Math.max(1e-4, half), -1.2, 1.2);
    const lyHL = this._fY;
    this._footTrack(p + 0.5, duty, half, lift, run);
    const swHindR = clamp(this._fF / Math.max(1e-4, half), -1.2, 1.2);
    const lyHR = this._fY;

    const amp = (run ? 0.85 : 0.55) * gas;
    this._quadLimb(P, HIPL, KNEEL, ANKL, swHindL, lyHL, amp);
    this._quadLimb(P, HIPR, KNEER, ANKR, swHindR, lyHR, amp);
    // Front pair, diagonal to the hind pair.
    this._quadLimb(P, SHL, ELL, WRL, swHindR * scale, lyHR, amp);
    this._quadLimb(P, SHR, ELR, WRR, swHindL * scale, lyHL, amp);
  }

  _quadLimb(P, jUp, jLo, jPaw, sw, ly, amp) {
    this._set(P, jUp, sw * amp, 0, 0);
    this._set(P, jLo, -Math.abs(sw) * amp * 0.7 - 0.18 - ly * 2, 0, 0);
    this._set(P, jPaw, Math.abs(sw) * amp * 0.35 + 0.10, 0, 0);
  }

  // --------------------------------------------------------------- idle poses

  /** Never perfectly still: breathing, a slow sway, a weight shift now and then. */
  _poseIdle(P, t) {
    const T = this.tune;
    const sk = this.sk;
    const br = Math.sin(PI2 * T.breath * t);
    const br2 = Math.sin(PI2 * T.breath * t + 1.9);

    // Weight shift every few seconds, eased in and out.
    const period = T.idleShift;
    const ph = (t % period) / period;
    const shiftDir = (Math.floor(t / period) % 2) ? -1 : 1;
    const shiftEnv = smooth(ph / 0.22) * smooth((1 - ph) / 0.30);
    const shiftX = 0.034 * sk * shiftDir * shiftEnv;

    const sway = 0.010 * Math.sin(PI2 * 0.13 * t) + 0.006 * Math.sin(PI2 * 0.31 * t + 2.1);
    const foot = 0.055 * sk * T.stance;

    const hipsRz = 0.045 * shiftDir * shiftEnv;
    this._stance(P, 0.004 + 0.004 * br, foot * 0.55, -foot * 0.55, shiftX,
      -0.010 + 0.006 * br, sway * 0.5 - shiftX * 0.4, hipsRz,
      0.030 * T.stance, -0.030 * T.stance);

    // Chest and shoulders carry the breath.
    const bAmp = 0.020 * T.breathAmp;
    this._set(P, SPINE, -0.014 + bAmp * 0.35 * br, sway * 0.6, -hipsRz * 0.5);
    this._set(P, CHEST, 0.006 + bAmp * br, sway * 0.9, -hipsRz * 0.6);
    this._set(P, NECK, 0.006 - bAmp * 0.4 * br, -sway * 0.5, 0);
    this._set(P, HEAD, 0.010 - bAmp * 0.5 * br + 0.010 * Math.sin(PI2 * 0.077 * t + 0.7),
              -sway * 0.9 + 0.055 * Math.sin(PI2 * 0.061 * t), 0.010 * br2);

    const shrug = 0.026 * T.breathAmp * br;
    this._set(P, SHL, -shrug * 0.4, 0, 0.030 + shrug);
    this._set(P, SHR, -shrug * 0.4, 0, -0.030 - shrug);

    const armIdle = -0.035 + 0.022 * br2;
    this._set(P, ELL, armIdle, 0.03, 0.105 + 0.012 * br);
    this._set(P, WRL, 0.175 + 0.030 * br2, 0, 0.03);
    this._set(P, ELR, armIdle, -0.03, -0.105 - 0.012 * br);
    this._set(P, WRR, 0.175 + 0.030 * br2, 0, -0.03);
  }

  /** Guard: crouched, bladed stance, weapon up, weight on the back foot. */
  _poseIdleCombat(P, t) {
    const T = this.tune;
    const sk = this.sk;
    const bob = Math.sin(PI2 * 0.85 * t);
    const bob2 = Math.sin(PI2 * 0.85 * t + 1.3);
    const br = Math.sin(PI2 * (T.breath * 1.7) * t);

    const split = 0.185 * sk * T.stance;
    this._stance(P, 0.085 + 0.014 * bob, split, -split,
      -0.028 * sk + 0.010 * sk * bob2, -0.075, 0.16, -0.030, 0.055, -0.075);

    this._set(P, SPINE, -0.075, -0.10, 0.020);
    this._set(P, CHEST, -0.060 + 0.012 * br, -0.20, 0.026);
    this._set(P, NECK, 0.055, 0.06, 0);
    this._set(P, HEAD, 0.085 + 0.012 * bob2, 0.10, 0);

    // Weapon arm up and cocked; off arm tucked across the body.
    this._set(P, SHR, -0.12, -0.10, -0.10);
    this._set(P, ELR, 0.62 + 0.05 * bob, -0.30, -0.28);
    this._set(P, WRR, 1.05 + 0.07 * bob2, 0, -0.12);

    this._set(P, SHL, -0.06, 0.06, 0.08);
    this._set(P, ELL, 0.40 + 0.04 * bob2, 0.34, 0.20);
    this._set(P, WRL, 1.25 + 0.05 * bob, 0, 0.10);
  }

  // ----------------------------------------------------------------- attacks

  /**
   * Anticipation, an accelerating swing with the hips leading the shoulders,
   * contact, a heavy follow-through, then recovery. Contact lands at the same
   * normalised time the clip table advertises to Combat.
   */
  _poseSlash(P, u) {
    const T = this.tune;
    u = clamp01(u);
    const A = 0.30, B = 0.44, C = 0.66;

    // s: -0.9 wound back .. +0.55 at contact .. +1.25 followed through
    let s;
    if (u < A) s = -0.90 * easeOut(u / A);
    else if (u < B) s = lerp(-0.90, 0.55, easeInCubic((u - A) / (B - A)));
    else if (u < C) s = lerp(0.55, 1.25, easeOutCubic((u - B) / (C - B)));
    else s = 1.25 * (1 - smoother((u - C) / (1 - C)));

    // Hips fire ~7% of the clip before the shoulders do.
    let h;
    const uh = Math.min(1, u + 0.07);
    if (uh < A) h = -0.90 * easeOut(uh / A);
    else if (uh < B) h = lerp(-0.90, 0.55, easeInCubic((uh - A) / (B - A)));
    else if (uh < C) h = lerp(0.55, 1.25, easeOutCubic((uh - B) / (C - B)));
    else h = 1.25 * (1 - smoother((uh - C) / (1 - C)));

    const g = T.swing;
    const lift = Math.sin(Math.PI * clamp01(u / C)) * 0.55 + (u < C ? 0.55 * smooth(u / A) : 0.55 * (1 - smoother((u - C) / (1 - C))));
    const drop = u > B ? smooth((u - B) / 0.34) : 0;

    const hipsRy = 0.34 * g * h;
    const chestRy = 0.58 * g * s;

    // Weight rolls onto the front foot through the swing.
    const step = 0.16 * this.sk * T.stance;
    this._stance(P, 0.055 + 0.045 * smooth(u / A) - 0.030 * drop,
      step * (1 + 0.5 * clamp01(s)), -step,
      -0.030 * this.sk + 0.055 * this.sk * clamp01(s * 0.8),
      -0.045 - 0.05 * clamp01(s), hipsRy, -0.03, 0.05, -0.06);

    this._set(P, SPINE, -0.05 - 0.10 * clamp01(s) + 0.06 * clamp01(-s), chestRy * 0.42, 0.05 * s);
    this._set(P, CHEST, -0.06 - 0.20 * clamp01(s) + 0.10 * clamp01(-s), chestRy, 0.10 * s);
    this._set(P, NECK, 0.03 + 0.05 * clamp01(s), -chestRy * 0.30, 0);
    this._set(P, HEAD, 0.05 + 0.08 * clamp01(s), -chestRy * 0.45, -0.05 * s);

    // Weapon arm: raised through the arc, sweeping across the body.
    this._set(P, SHR, -0.10 - 0.18 * lift, -0.16 * s, -0.10 - 0.10 * lift);
    this._set(P, ELR, 0.35 + 1.10 * lift - 0.35 * drop, -1.05 * s, -0.30 - 0.35 * lift);
    this._set(P, WRR, 0.55 + 0.55 * clamp01(-s) + 0.30 * drop, -0.25 * s, -0.10);

    // Off arm counterbalances outward, then pulls in behind the swing.
    this._set(P, SHL, -0.05, 0.10 * s, 0.08);
    this._set(P, ELL, 0.18 + 0.35 * clamp01(-s) - 0.30 * clamp01(s), 0.45 * s, 0.30 + 0.20 * clamp01(-s));
    this._set(P, WRL, 0.85 + 0.35 * clamp01(s), 0, 0.14);
  }

  /** A straight, fast stab: short wind, long reach, quick recovery. */
  _poseThrust(P, u) {
    const T = this.tune;
    u = clamp01(u);
    const A = 0.28, B = 0.46, C = 0.60;
    let s;
    if (u < A) s = -0.85 * easeOut(u / A);
    else if (u < B) s = lerp(-0.85, 1.0, easeInCubic((u - A) / (B - A)));
    else if (u < C) s = 1.0;
    else s = 1.0 * (1 - smoother((u - C) / (1 - C)));

    const reach = clamp01(s);
    const wind = clamp01(-s);
    const g = T.swing;
    const step = 0.14 * this.sk * T.stance;

    this._stance(P, 0.060 + 0.040 * wind - 0.020 * reach,
      step * (1 + 1.15 * reach), -step * (1 + 0.25 * wind),
      -0.026 * this.sk + 0.060 * this.sk * reach,
      -0.05 - 0.09 * reach, 0.34 * g * (reach - wind * 0.7), -0.025, 0.05, -0.06);

    const chestRy = 0.30 * g * (reach - wind);
    this._set(P, SPINE, -0.06 - 0.09 * reach, chestRy * 0.5, 0);
    this._set(P, CHEST, -0.07 - 0.13 * reach, chestRy, 0.03 * s);
    this._set(P, NECK, 0.05 + 0.04 * reach, -chestRy * 0.4, 0);
    this._set(P, HEAD, 0.06, -chestRy * 0.5, 0);

    // Arm drives straight out along the body's forward axis.
    this._set(P, SHR, -0.06 - 0.22 * reach, -0.28 * reach + 0.20 * wind, -0.06);
    this._set(P, ELR, 0.35 + 1.05 * reach + 0.30 * wind, -0.45 * reach + 0.30 * wind, -0.22 + 0.10 * reach);
    this._set(P, WRR, 1.25 * wind + 0.15 - 0.10 * reach, 0, -0.06);

    this._set(P, SHL, -0.04, 0.10 * reach, 0.07);
    this._set(P, ELL, -0.30 * reach + 0.30 * wind, 0.30 * reach, 0.26);
    this._set(P, WRL, 0.60 + 0.40 * reach, 0, 0.12);
  }

  /** A big committed overhead: long wind-up, slow start, brutal arrival. */
  _poseHeavy(P, u) {
    const T = this.tune;
    u = clamp01(u);
    const A = 0.42, B = 0.55, C = 0.76;
    let s;
    if (u < A) s = -1.05 * smoother(u / A);
    else if (u < B) s = lerp(-1.05, 0.70, easeInCubic((u - A) / (B - A)));
    else if (u < C) s = lerp(0.70, 1.30, easeOutCubic((u - B) / (C - B)));
    else s = 1.30 * (1 - smoother((u - C) / (1 - C)));

    const raise = clamp01(-s);
    const down = clamp01(s);
    const g = T.swing * 1.15;
    const step = 0.19 * this.sk * T.stance;

    this._stance(P, 0.020 + 0.150 * down * smooth((u - B) / 0.30),
      step * (1 + 0.6 * down), -step * (1 + 0.4 * raise),
      -0.020 * this.sk + 0.045 * this.sk * down,
      0.070 * raise - 0.150 * down, 0.30 * g * s, -0.02, 0.06, -0.07);

    this._set(P, SPINE, 0.13 * raise - 0.26 * down, 0.18 * g * s, 0);
    this._set(P, CHEST, 0.16 * raise - 0.34 * down, 0.34 * g * s, 0.06 * s);
    this._set(P, NECK, -0.10 * raise + 0.20 * down, -0.12 * g * s, 0);
    this._set(P, HEAD, -0.14 * raise + 0.26 * down, -0.18 * g * s, 0);

    // Both hands on the haft: mirrored arms, up over the head and down through
    // the target. The arc has to stay on the FRONT side of the body all the
    // way, or the hands end up behind the hips at the contact frame.
    const arc = 2.05 * raise + 0.62 * clamp(s, 0, 1.3);
    this._set(P, SHR, -0.30 * raise + 0.10 * down, -0.10, -0.16 - 0.18 * raise);
    this._set(P, ELR, 0.45 + arc, -0.30 * s, -0.26 - 0.30 * raise);
    this._set(P, WRR, 0.95 + 0.55 * raise - 0.55 * down, 0, -0.10);
    this._set(P, SHL, -0.30 * raise + 0.10 * down, 0.10, 0.16 + 0.18 * raise);
    this._set(P, ELL, 0.45 + arc, 0.30 * s, 0.26 + 0.30 * raise);
    this._set(P, WRL, 0.95 + 0.55 * raise - 0.55 * down, 0, 0.10);
  }

  // -------------------------------------------------------------------- cast

  /** Gather: arms sweep out and up, weight settles back, chin lifts. */
  _poseCastBegin(P, u) {
    u = clamp01(u);
    const g = smoother(u);
    const trem = Math.sin(u * 46) * 0.012 * g;

    this._stance(P, 0.030 * g, 0.075 * this.sk, -0.075 * this.sk, 0,
      0.045 * g, 0, 0, 0.03, -0.03);

    this._set(P, SPINE, 0.070 * g, 0, 0);
    this._set(P, CHEST, 0.095 * g, 0, 0);
    this._set(P, NECK, -0.060 * g, 0, 0);
    this._set(P, HEAD, -0.130 * g, 0, 0);

    const raise = 1.15 * g;
    this._set(P, SHL, -0.16 * g, 0.10 * g, 0.22 * g);
    this._set(P, ELL, raise + trem, 0.42 * g, 0.46 * g);
    this._set(P, WRL, 0.95 * g + trem, 0, 0.20 * g);
    this._set(P, SHR, -0.16 * g, -0.10 * g, -0.22 * g);
    this._set(P, ELR, raise - trem, -0.42 * g, -0.46 * g);
    this._set(P, WRR, 0.95 * g - trem, 0, -0.20 * g);
  }

  /** Hold: hands out front, the spell breathing between them. */
  _poseCastLoop(P, t) {
    const f = Math.sin(PI2 * 0.55 * t);
    const f2 = Math.sin(PI2 * 0.55 * t + 2.2);
    const trem = Math.sin(PI2 * 6.1 * t) * 0.014;

    this._stance(P, 0.030 + 0.006 * f, 0.075 * this.sk, -0.075 * this.sk,
      0.008 * this.sk * f2, 0.040, 0, 0.008 * f2, 0.03, -0.03);

    this._set(P, SPINE, 0.065 + 0.010 * f, 0, 0);
    this._set(P, CHEST, 0.090 + 0.014 * f, 0, 0);
    this._set(P, NECK, -0.055, 0, 0);
    this._set(P, HEAD, -0.120 + 0.010 * f2, 0, 0);

    const raise = 1.15 + 0.05 * f;
    this._set(P, SHL, -0.16, 0.10, 0.22);
    this._set(P, ELL, raise + trem, 0.42, 0.46 + 0.03 * f2);
    this._set(P, WRL, 0.95 + trem, 0, 0.20);
    this._set(P, SHR, -0.16, -0.10, -0.22);
    this._set(P, ELR, raise - trem, -0.42, -0.46 - 0.03 * f2);
    this._set(P, WRR, 0.95 - trem, 0, -0.20);
  }

  /** Release: a hard push forward, then the arms drift back down. */
  _poseCastRelease(P, u) {
    u = clamp01(u);
    const A = 0.18, B = 0.34;
    let s;
    if (u < A) s = -0.55 * easeOut(u / A);           // load back
    else if (u < B) s = lerp(-0.55, 1.0, easeInCubic((u - A) / (B - A)));
    else s = 1.0 * (1 - smoother((u - B) / (1 - B)));

    const push = clamp01(s), load = clamp01(-s);

    this._stance(P, 0.045 + 0.030 * load - 0.010 * push,
      0.085 * this.sk * (1 + 0.7 * push), -0.085 * this.sk,
      0.030 * this.sk * push, 0.050 * load - 0.090 * push, 0, 0, 0.03, -0.03);

    this._set(P, SPINE, 0.075 * load - 0.130 * push, 0, 0);
    this._set(P, CHEST, 0.100 * load - 0.170 * push, 0, 0);
    this._set(P, NECK, -0.070 * load + 0.090 * push, 0, 0);
    this._set(P, HEAD, -0.130 * load + 0.120 * push, 0, 0);

    const out = 1.35 * push;
    const up = 1.10 * load;
    this._set(P, SHL, -0.20 * push, 0.14 * push, 0.16 * load + 0.06 * push);
    this._set(P, ELL, up + out, 0.34 * load + 0.16 * push, 0.40 * load + 0.16 * push);
    this._set(P, WRL, 1.05 * load + 0.10 * push, 0, 0.14);
    this._set(P, SHR, -0.20 * push, -0.14 * push, -0.16 * load - 0.06 * push);
    this._set(P, ELR, up + out, -0.34 * load - 0.16 * push, -0.40 * load - 0.16 * push);
    this._set(P, WRR, 1.05 * load + 0.10 * push, 0, -0.14);
  }

  // ---------------------------------------------------------- hurt / block

  /** A short, sharp flinch: head snaps, torso folds, one knee gives. */
  _poseHurt(P, u) {
    u = clamp01(u);
    const hit = u < 0.22 ? easeOut(u / 0.22) : 1 - smoother((u - 0.22) / 0.78);
    const k = hit;

    this._stance(P, 0.075 * k, 0.05 * this.sk, -0.10 * this.sk * (1 + k),
      -0.045 * this.sk * k, 0.090 * k, -0.10 * k, -0.05 * k, 0.04, -0.05);

    this._set(P, SPINE, 0.16 * k, -0.13 * k, 0.07 * k);
    this._set(P, CHEST, 0.24 * k, -0.22 * k, 0.11 * k);
    this._set(P, NECK, -0.18 * k, 0.10 * k, -0.05 * k);
    this._set(P, HEAD, -0.32 * k, 0.16 * k, -0.10 * k);

    this._set(P, SHL, -0.16 * k, 0.10 * k, 0.16 * k);
    this._set(P, ELL, -0.30 * k, 0.22 * k, 0.34 * k);
    this._set(P, WRL, 0.75 * k, 0, 0.16 * k);
    this._set(P, SHR, -0.16 * k, -0.10 * k, -0.16 * k);
    this._set(P, ELR, -0.34 * k, -0.22 * k, -0.34 * k);
    this._set(P, WRR, 0.85 * k, 0, -0.16 * k);
  }

  /** Shield up and braced; the body shrinks behind it. */
  _poseBlock(P, u) {
    u = clamp01(u);
    const k = u < 0.20 ? easeOut(u / 0.20) : 1 - 0.25 * smooth((u - 0.20) / 0.80);

    this._stance(P, 0.095 * k, 0.20 * this.sk * k, -0.20 * this.sk * k,
      -0.035 * this.sk * k, -0.090 * k, 0.26 * k, -0.03 * k, 0.07 * k, -0.09 * k);

    this._set(P, SPINE, -0.090 * k, -0.16 * k, 0.03 * k);
    this._set(P, CHEST, -0.120 * k, -0.30 * k, 0.05 * k);
    this._set(P, NECK, 0.090 * k, 0.10 * k, 0);
    this._set(P, HEAD, 0.130 * k, 0.14 * k, 0);

    // Off arm carries the shield across the chest.
    this._set(P, SHL, -0.22 * k, 0.16 * k, 0.14 * k);
    this._set(P, ELL, 1.15 * k, 0.52 * k, 0.30 * k);
    this._set(P, WRL, 1.35 * k, 0, 0.10 * k);
    // Weapon arm tucked in behind.
    this._set(P, SHR, -0.06 * k, -0.10 * k, -0.08 * k);
    this._set(P, ELR, 0.28 * k, -0.34 * k, -0.26 * k);
    this._set(P, WRR, 0.95 * k, 0, -0.10 * k);
  }

  // ---------------------------------------------------------- die / corpse

  /**
   * Stagger, buckle, fall back, settle — and then stay there. Corpses linger
   * for COMBAT.corpseLinger seconds, so the terminal pose has to be readable
   * from the isometric camera and must not drift.
   */
  _poseDie(P, u) {
    u = clamp01(u);
    const sk = this.sk;

    // Three overlapping phases.
    const stagger = u < 0.20 ? smooth(u / 0.20) : 1 - smooth((u - 0.20) / 0.30);
    const fall = smoother(clamp01((u - 0.16) / 0.50));
    const settle = smoother(clamp01((u - 0.66) / 0.34));
    // One dying bounce as the body meets the ground.
    const bounce = u > 0.62 && u < 0.86 ? Math.sin(Math.PI * (u - 0.62) / 0.24) * (1 - settle) * 0.055 : 0;

    const flatY = this.ankleRestY + 0.045 * sk;
    const hipY = lerp(this.hipOriginY - 0.05 * sk * stagger, flatY, fall) + bounce * sk;

    this._setPos(P, HIPS, 0.05 * sk * fall, hipY - this.hipOriginY, 0.10 * sk * fall);
    // Pitch back a shade past horizontal so the torso ends up flat on the
    // ground, with the pelvis rolled slightly onto one hip.
    this._set(P, HIPS, 0.22 * stagger + 1.70 * fall, 0.26 * fall, -0.24 * fall);

    // A little curl left in the spine so the corpse is not a plank. These are
    // LOCAL angles: absolute torso pitch is the hips value plus these.
    this._set(P, SPINE, 0.16 * stagger - 0.05 * fall, -0.12 * fall, 0.09 * fall);
    this._set(P, CHEST, 0.20 * stagger - 0.06 * fall, -0.16 * fall, 0.12 * fall);
    this._set(P, NECK, 0.14 * stagger + 0.06 * fall, 0.12 * fall, -0.09 * fall);
    this._set(P, HEAD, 0.24 * stagger + 0.12 * fall, 0.20 * fall, -0.15 * fall);

    // Legs buckle, then come to rest lying along the ground, one knee folded
    // further than the other so the silhouette is not symmetrical.
    this._set(P, HIPL, -0.30 * stagger - 0.14 * fall, -0.10 * fall, 0.17 * fall);
    this._set(P, KNEEL, -0.55 * stagger - 0.22 * fall, 0, 0);
    this._set(P, ANKL, 0.25 * stagger + 0.12 * fall, 0, 0);
    this._set(P, HIPR, -0.20 * stagger - 0.22 * fall, 0.10 * fall, -0.23 * fall);
    this._set(P, KNEER, -0.40 * stagger - 0.18 * fall, 0, 0);
    this._set(P, ANKR, 0.20 * stagger + 0.10 * fall, 0, 0);

    // Arms fling out on the stagger, then lie slack and splayed.
    this._set(P, SHL, -0.20 * stagger - 0.06 * fall, 0.10 * fall, 0.22 * stagger + 0.10 * fall);
    this._set(P, ELL, 0.55 * stagger + 0.12 * fall, 0.28 * fall, 0.45 * stagger + 0.58 * fall);
    this._set(P, WRL, 0.70 * stagger + 0.34 * fall, 0, 0.18 * fall);
    this._set(P, SHR, -0.20 * stagger - 0.06 * fall, -0.10 * fall, -0.22 * stagger - 0.10 * fall);
    this._set(P, ELR, 0.45 * stagger + 0.16 * fall, -0.28 * fall, -0.45 * stagger - 0.72 * fall);
    this._set(P, WRR, 0.60 * stagger + 0.42 * fall, 0, -0.18 * fall);
  }

  // ------------------------------------------------------------ misc poses

  /** Cross-legged rest, with slow breathing. */
  _poseSit(P, t) {
    const T = this.tune;
    const br = Math.sin(PI2 * T.breath * 0.8 * t);
    const sk = this.sk;

    this._setPos(P, HIPS, 0, -(this.hipOriginY - this.ankleRestY - 0.20 * sk), -0.04 * sk);
    this._set(P, HIPS, -0.10 + 0.010 * br, 0, 0);

    this._set(P, SPINE, -0.030 + 0.014 * br, 0, 0);
    this._set(P, CHEST, -0.020 + 0.020 * br, 0.05 * Math.sin(PI2 * 0.09 * t), 0);
    this._set(P, NECK, 0.030, 0, 0);
    this._set(P, HEAD, 0.050 + 0.012 * br, 0.08 * Math.sin(PI2 * 0.07 * t), 0);

    // Folded legs: thighs forward and splayed, shins tucked back across.
    this._set(P, HIPL, 1.28, 0.42, 0.62);
    this._set(P, KNEEL, -2.05, 0, 0);
    this._set(P, ANKL, 0.35, 0, 0);
    this._set(P, HIPR, 1.28, -0.42, -0.62);
    this._set(P, KNEER, -2.05, 0, 0);
    this._set(P, ANKR, 0.35, 0, 0);

    this._set(P, SHL, -0.05, 0, 0.06);
    this._set(P, ELL, 0.55 + 0.02 * br, 0.22, 0.24);
    this._set(P, WRL, 0.85, 0, 0.10);
    this._set(P, SHR, -0.05, 0, -0.06);
    this._set(P, ELR, 0.55 - 0.02 * br, -0.22, -0.24);
    this._set(P, WRR, 0.85, 0, -0.10);
  }

  /** Crouch, reach down with the weapon hand, stand back up. */
  _posePickup(P, u) {
    u = clamp01(u);
    const k = u < 0.5 ? smoother(u / 0.5) : 1 - smoother((u - 0.5) / 0.5);

    this._stance(P, 0.26 * k, 0.10 * this.sk, -0.14 * this.sk,
      0.010 * this.sk * k, -0.44 * k, 0.10 * k, 0, 0.09 * k, -0.09 * k);

    this._set(P, SPINE, -0.34 * k, 0.06 * k, 0);
    this._set(P, CHEST, -0.40 * k, 0.10 * k, 0);
    this._set(P, NECK, -0.10 * k, 0, 0);
    this._set(P, HEAD, -0.14 * k, 0, 0);

    this._set(P, SHR, 0.10 * k, -0.10 * k, -0.08 * k);
    this._set(P, ELR, 0.42 * k, -0.12 * k, -0.10 * k);
    this._set(P, WRR, 0.34 * k, 0, -0.06 * k);
    this._set(P, SHL, 0.04 * k, 0.08 * k, 0.10 * k);
    this._set(P, ELL, -0.22 * k, 0.20 * k, 0.30 * k);
    this._set(P, WRL, 0.55 * k, 0, 0.14 * k);
  }

  /** Both arms up, a small hop, chin lifted. Also used as the NPC greeting. */
  _poseCheer(P, u) {
    u = clamp01(u);
    const rise = u < 0.30 ? smoother(u / 0.30) : 1 - smoother(Math.max(0, (u - 0.70) / 0.30));
    const wave = Math.sin(PI2 * 1.6 * u) * rise;
    const hop = Math.max(0, Math.sin(Math.PI * clamp01((u - 0.15) / 0.45))) * rise;

    this._stance(P, 0.055 * (1 - rise) - 0.020 * hop, 0.075 * this.sk, -0.075 * this.sk,
      0, 0.075 * rise, 0.05 * wave, 0, 0.05, -0.05);
    // Add the hop on top of whatever the stance chose for pelvis height.
    P[HIPS * CH + 4] += 0.075 * this.sk * hop;

    this._set(P, SPINE, 0.100 * rise, 0.04 * wave, 0);
    this._set(P, CHEST, 0.140 * rise, 0.07 * wave, 0);
    this._set(P, NECK, -0.090 * rise, 0, 0);
    this._set(P, HEAD, -0.190 * rise, -0.06 * wave, 0.05 * wave);

    const up = 2.35 * rise;
    this._set(P, SHL, -0.34 * rise, 0, 0.30 * rise);
    this._set(P, ELL, up, 0.10 * wave, 0.34 * rise + 0.08 * wave);
    this._set(P, WRL, 0.35 * rise + 0.12 * wave, 0, 0.10 * rise);
    this._set(P, SHR, -0.34 * rise, 0, -0.30 * rise);
    this._set(P, ELR, up, -0.10 * wave, -0.34 * rise - 0.08 * wave);
    this._set(P, WRR, 0.35 * rise - 0.12 * wave, 0, -0.10 * rise);
  }

  // ----------------------------------------------------------------- teardown

  dispose() {
    // Put the bones back so a rig handed on to something else is clean.
    for (let j = 0; j < NJ; j++) {
      if (!this.hasJoint[j]) continue;
      this.joints[j].quaternion.copy(this.restQ[j]);
      this.joints[j].position.copy(this.restP[j]);
    }
    for (const r of this.secondary) r.object.rotation.copy(r.base);
    this.secondary.length = 0;
    this.joints.length = 0;
    this.restQ.length = 0;
    this.restP.length = 0;
    this.qW.length = 0;
    this.qPinv.length = 0;
    this.restWorld.length = 0;
    this._baseCb = null;
    this._ovCb = null;
    this.overlayName = null;
    this.rig = null;
    this.enabled = false;
  }
}

/** Clip names this Animator can play; handy for editors and tests. */
export const CLIP_NAMES = Object.keys(CLIPS);

export default Animator;
