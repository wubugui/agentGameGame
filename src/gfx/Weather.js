import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { makeRng } from '../core/Rng.js';

/**
 * Weather: precipitation volumes that ride along with the camera, plus the
 * atmospheric side effects (fog thickening, ground wetness, lightning).
 *
 * Design notes
 *  - Every particle system is a single draw call whose motion is solved on the
 *    GPU from a per-instance seed. update() writes a handful of uniforms and a
 *    draw count; it never touches per-particle data and never allocates.
 *  - Kinds cross-fade through a weight table, so `set()` during an active fade
 *    blends instead of popping.
 *  - `Sky` writes `scene.fog` every frame *before* Game calls us, so we layer
 *    our density/tint on top of whatever the sky decided. Reading the fog also
 *    lets precipitation pick up the ambient colour for free.
 *  - Splash rings sit on the plane through the focus position; on steep slopes
 *    they can float a few centimetres. That is deliberate — Weather has no
 *    terrain reference and a per-drop height query would cost far more than it
 *    is worth.
 */

const KINDS = ['clear', 'rain', 'storm', 'snow', 'fog', 'sandstorm', 'ash', 'embers'];

/**
 * Drifting particulate presets. One shader, four looks.
 *  fall  — metres/sec downward (negative rises, for embers)
 *  swirl — curl-noise frequency; drift — curl amplitude in metres
 */
const FLAKE_DEFS = {
  snow: {
    count: 2600, box: [46, 28, 46], fall: 2.2, wind: [0.9, 0.35],
    drift: 1.6, swirl: 0.085, size: 2.7, color: 0xf2f6ff,
    alpha: 0.95, additive: false, tintAmbient: 0.32, glow: 0,
  },
  ash: {
    count: 1500, box: [48, 28, 48], fall: 1.1, wind: [1.5, 0.55],
    drift: 2.1, swirl: 0.07, size: 2.2, color: 0x6b6360,
    alpha: 0.82, additive: false, tintAmbient: 0.22, glow: 0,
  },
  ember: {
    count: 720, box: [44, 24, 44], fall: -1.6, wind: [0.7, 0.3],
    drift: 1.3, swirl: 0.11, size: 1.6, color: 0xff7a2a,
    alpha: 0.9, additive: true, tintAmbient: 0, glow: 0.8,
  },
  sand: {
    count: 2600, box: [54, 17, 54], fall: 0.55, wind: [9.5, 3.4],
    drift: 1.1, swirl: 0.16, size: 2.1, color: 0xd9b479,
    alpha: 0.72, additive: false, tintAmbient: 0.28, glow: 0,
  },
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function approach(cur, goal, rate, dt) {
  const d = goal - cur;
  const step = rate * dt;
  if (Math.abs(d) <= step) return goal;
  return cur + Math.sign(d) * step;
}

/* --------------------------------------------------------------- glsl bits */

const GLSL_NOISE = /* glsl */`
float hash31w(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise3w(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31w(i), hash31w(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash31w(i + vec3(0.0, 1.0, 0.0)), hash31w(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash31w(i + vec3(0.0, 0.0, 1.0)), hash31w(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash31w(i + vec3(0.0, 1.0, 1.0)), hash31w(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
vec3 noise3w(vec3 p){
  return vec3(vnoise3w(p), vnoise3w(p + 19.19), vnoise3w(p - 33.71));
}
/** Curl of a value-noise potential field — divergence free, so flakes swirl
    instead of clumping. Forward differences keep it to four noise taps. */
vec3 curl3(vec3 p){
  const float e = 0.45;
  vec3 n0 = noise3w(p);
  vec3 nx = noise3w(p + vec3(e, 0.0, 0.0));
  vec3 ny = noise3w(p + vec3(0.0, e, 0.0));
  vec3 nz = noise3w(p + vec3(0.0, 0.0, e));
  float x = (ny.z - n0.z) - (nz.y - n0.y);
  float y = (nz.x - n0.x) - (nx.z - n0.z);
  float z = (nx.y - n0.y) - (ny.x - n0.x);
  return vec3(x, y, z) / e;
}
`;

/* ----------------------------------------------------------------- Weather */

export class Weather {
  constructor(ctx) {
    this.ctx = ctx;
    this.engine = ctx.engine;
    this.scene = ctx.engine.scene;
    this.bus = ctx.bus || bus;
    this.quality = ctx.quality || 'high';
    this._rng = makeRng(0x51e3a1);

    this.group = new THREE.Group();
    this.group.name = 'weather';
    this.scene.add(this.group);

    /** Blend weights per kind; they always sum to ~1 once settled. */
    this._w = {};
    this._goal = {};
    this._int = {};
    for (const k of KINDS) { this._w[k] = 0; this._goal[k] = 0; this._int[k] = 1; }
    this._w.clear = 1; this._goal.clear = 1;
    this.kind = 'clear';
    this.intensity = 1;
    this._fadeRate = 0.25;

    this._wet = 0;
    this._wetEmitted = -1;

    this._center = new THREE.Vector3();
    /** Precipitation volumes sit between the camera and the player, not on the
     *  player: the isometric rig is ~26 units out, so a box centred on the hero
     *  would leave the camera standing outside the rain. */
    this._precip = new THREE.Vector3();
    this._time = 0;

    this._geoms = [];
    this._mats = [];
    this._sys = {};

    // lightning
    this._boltTimer = this._rng.range(3, 9);
    this._flashLevel = 0;
    this._flashDecay = 0;
    this._restrikes = 0;
    this._restrikeT = 0;
    this._flash = new THREE.DirectionalLight(0xcfe2ff, 0);
    this._flash.name = 'lightning';
    this._flash.castShadow = false;
    this._flash.position.set(40, 90, -30);
    this._flashTarget = new THREE.Object3D();
    this._flash.target = this._flashTarget;
    this.group.add(this._flash);
    this.group.add(this._flashTarget);
    this._thunder = [];
    for (let i = 0; i < 6; i++) this._thunder.push({ t: -1, x: 0, y: 0, z: 0 });
    // pooled vectors handed to fx/audio so a later strike cannot move an
    // effect that is still alive
    this._boltPos = [];
    for (let i = 0; i < 4; i++) this._boltPos.push(new THREE.Vector3());
    this._boltIdx = 0;
    this._sfxPos = new THREE.Vector3();

    this._disposed = false;
  }

  /* ----------------------------------------------------------------- api */

  /**
   * @param {string} kind 'clear'|'rain'|'storm'|'snow'|'fog'|'sandstorm'|'ash'|'embers'
   * @param {number} intensity 0..1(+)
   * @param {number} fadeSeconds cross-fade length; 0 snaps
   */
  set(kind, intensity = 1, fadeSeconds = 4) {
    if (!KINDS.includes(kind)) {
      console.warn(`[weather] unknown kind '${kind}', using 'clear'`);
      kind = 'clear';
    }
    this.kind = kind;
    this.intensity = clamp(intensity, 0, 2);
    this._int[kind] = this.intensity;
    for (const k of KINDS) this._goal[k] = (k === kind) ? 1 : 0;
    this._fadeRate = fadeSeconds > 0.01 ? 1 / fadeSeconds : 1000;
    if (fadeSeconds <= 0.01) for (const k of KINDS) this._w[k] = this._goal[k];
    if (kind === 'storm') this._boltTimer = Math.min(this._boltTimer, 2.5);
  }

  /* --------------------------------------------------------------- frame */

  update(dt, focusPos) {
    if (this._disposed) return;
    const d = dt > 0 ? dt : 0;
    this._time += d;

    if (focusPos) this._center.copy(focusPos);
    else if (this.engine.camTarget) this._center.copy(this.engine.camTarget);

    this._precip.copy(this._center);
    const camObj = this.engine.camera;
    if (camObj) {
      this._precip.x += (camObj.position.x - this._center.x) * 0.5;
      this._precip.z += (camObj.position.z - this._center.z) * 0.5;
    }

    // ---- blend weights ----------------------------------------------------
    for (let i = 0; i < KINDS.length; i++) {
      const k = KINDS[i];
      this._w[k] = approach(this._w[k], this._goal[k], this._fadeRate, d);
    }

    const w = this._w;
    const it = this._int;
    const rainW = clamp(w.rain * it.rain + w.storm * it.storm, 0, 1.4);
    const stormW = w.storm * it.storm;
    const snowW = w.snow * it.snow;
    const ashW = w.ash * it.ash;
    const emberW = w.embers * it.embers;
    const sandW = w.sandstorm * it.sandstorm;
    const fogW = w.fog * it.fog;

    const pq = (this.engine.preset && this.engine.preset.particles) || 1;

    // ---- ambient colour pulled from the fog the sky just wrote ------------
    const fog = this.scene.fog;
    if (fog && fog.color) _c1.copy(fog.color); else _c1.setRGB(0.16, 0.19, 0.24);

    // ---- rain -------------------------------------------------------------
    if (rainW > 0.002 || this._sys.rain) {
      const s = rainW > 0.002 ? this._ensureRain() : this._sys.rain;
      if (s) {
        const on = rainW > 0.002;
        s.mesh.visible = on;
        if (on) {
          const gust = 1 + stormW * 2.2;
          const u = s.u;
          u.uTime.value = this._time;
          u.uCenter.value.copy(this._precip);
          u.uOpacity.value = clamp(0.22 + 0.40 * rainW, 0, 1) * clamp(rainW * 1.6, 0, 1);
          u.uSpeed.value = 26 + 16 * stormW;
          u.uWind.value.set(2.6 * gust, 1.1 * gust);
          u.uLen.value = 0.55 + 0.55 * rainW + 0.5 * stormW;
          _c2.copy(_c1).multiplyScalar(1.9).addScalar(0.09);
          u.uColor.value.copy(_c2);
          s.geo.instanceCount = Math.max(1, Math.floor(s.max * pq * clamp(rainW, 0, 1)));
        }
      }
      // splash rings
      const sp = rainW > 0.05 ? this._ensureSplash() : this._sys.splash;
      if (sp) {
        const on = rainW > 0.05;
        sp.mesh.visible = on;
        if (on) {
          sp.u.uTime.value = this._time;
          sp.u.uCenter.value.copy(this._center);
          sp.u.uOpacity.value = clamp(rainW * 0.9, 0, 1);
          _c2.copy(_c1).multiplyScalar(1.6).addScalar(0.06);
          sp.u.uColor.value.copy(_c2);
          sp.geo.instanceCount = Math.max(1, Math.floor(sp.max * pq * clamp(rainW, 0, 1)));
        }
      }
    }

    // ---- drifting particulates (snow / ash / embers / sand grains) --------
    this._driveFlakes('snow', snowW, pq, _c1);
    this._driveFlakes('ash', ashW, pq, _c1);
    this._driveFlakes('ember', emberW, pq, _c1);
    this._driveFlakes('sand', sandW, pq, _c1);

    // ---- haze sheets for sandstorm / thick fog ----------------------------
    const hazeW = clamp(sandW * 1.0 + fogW * 0.7, 0, 1.2);
    if (hazeW > 0.004 || this._sys.haze) {
      const h = hazeW > 0.004 ? this._ensureHaze() : this._sys.haze;
      if (h) {
        const on = hazeW > 0.004;
        h.mesh.visible = on;
        if (on) {
          const sandMix = sandW / Math.max(1e-4, sandW + fogW * 0.7);
          // keep the sheets at the ambient exposure so they never glow at night
          const lum = _c1.r * 0.3 + _c1.g * 0.59 + _c1.b * 0.11;
          _c2.setHex(0xc8a165).multiplyScalar(clamp(lum * 3.4, 0.04, 1.3));
          _c2.lerp(_c1, 1 - sandMix * 0.8);
          h.u.uTime.value = this._time;
          h.u.uCenter.value.copy(this._precip);
          h.u.uOpacity.value = clamp(hazeW * 0.5, 0, 0.75);
          h.u.uSpeed.value = 6 + 17 * sandMix;
          h.u.uColor.value.copy(_c2);
          h.geo.instanceCount = Math.max(1, Math.floor(h.max * clamp(hazeW, 0.2, 1)));
        }
      }
    }

    // ---- fog + wetness ----------------------------------------------------
    this._applyFog(fogW, sandW, rainW, ashW, stormW);
    this._updateWetness(rainW, d);

    // ---- lightning --------------------------------------------------------
    this._updateLightning(d, stormW);
  }

  /* ----------------------------------------------------------------- fog */

  /**
   * Sky writes scene.fog first each frame; we layer weather on top of it so the
   * two never fight. Tints are re-exposed to the fog's own luminance, which
   * keeps a sandstorm bright at noon and murky at midnight.
   */
  _applyFog(fogW, sandW, rainW, ashW, stormW) {
    const fog = this.scene.fog;
    if (!fog) return;
    fog.density = clamp(
      fog.density + fogW * 0.012 + sandW * 0.018 + rainW * 0.004 + stormW * 0.004 + ashW * 0.006,
      0, 0.032);

    const col = fog.color;
    if (!col) return;
    const lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
    if (sandW > 0.002) {
      _c2.setHex(0xc9a468).multiplyScalar(clamp(lum * 3.4, 0.04, 1.3));
      col.lerp(_c2, clamp(sandW * 0.85, 0, 0.88));
    }
    if (fogW > 0.002) {
      _c2.setHex(0x9aa6b4).multiplyScalar(clamp(lum * 3.0, 0.03, 1.2));
      col.lerp(_c2, clamp(fogW * 0.5, 0, 0.6));
    }
    if (ashW > 0.002) {
      _c2.setHex(0x4a3b34).multiplyScalar(clamp(lum * 3.0, 0.05, 1.2));
      col.lerp(_c2, clamp(ashW * 0.45, 0, 0.55));
    }
  }

  /* ------------------------------------------------------------- wetness */

  _updateWetness(rainW, dt) {
    const goal = clamp(rainW * 0.92, 0, 1);
    const rate = goal > this._wet ? 0.085 : 0.05;
    this._wet = approach(this._wet, goal, rate, dt);
    if (Math.abs(this._wet - this._wetEmitted) > 0.015) {
      this._wetEmitted = this._wet;
      this.bus.emit('weather:wetness', this._wet);
    }
  }

  /* ----------------------------------------------------------- lightning */

  _updateLightning(dt, stormW) {
    // decay the flash key light
    if (this._flashLevel > 0) {
      this._flashLevel = Math.max(0, this._flashLevel - this._flashDecay * dt);
      this._flash.intensity = this._flashLevel;
      if (this._flashLevel <= 0.0005) this._flash.intensity = 0;
    }

    // queued restrikes of the same bolt
    if (this._restrikes > 0) {
      this._restrikeT -= dt;
      if (this._restrikeT <= 0) {
        this._restrikes--;
        this._restrikeT = this._rng.range(0.06, 0.16);
        this._flashLevel = Math.max(this._flashLevel, 1.1 + this._rng() * 0.8);
        this._flashDecay = 7.5;
        this.engine.postfx?.flash?.(0xd6e6ff, 0.45, 0.12);
      }
    }

    // thunder rolls in after the light
    for (let i = 0; i < this._thunder.length; i++) {
      const q = this._thunder[i];
      if (q.t < 0) continue;
      q.t -= dt;
      if (q.t <= 0) {
        q.t = -1;
        this._sfxPos.set(q.x, q.y, q.z);
        this.bus.emit('audio:sfx', { id: 'thunder', pos: this._sfxPos });
      }
    }

    if (stormW < 0.15) return;
    this._boltTimer -= dt * (0.6 + stormW);
    if (this._boltTimer > 0) return;
    this._boltTimer = this._rng.range(4.5, 13.0) / Math.max(0.35, stormW);
    this._strike();
  }

  _strike() {
    const rng = this._rng;
    const ang = rng() * Math.PI * 2;
    const dist = rng.range(22, 165);
    const x = this._center.x + Math.sin(ang) * dist;
    const z = this._center.z + Math.cos(ang) * dist;
    const y = this._center.y;
    const near = clamp(1 - (dist - 22) / 143, 0, 1);

    const bp = this._boltPos[this._boltIdx];
    this._boltIdx = (this._boltIdx + 1) % this._boltPos.length;
    bp.set(x, y, z);
    this.ctx.fx?.spawn?.('thunder.bolt', bp, {
      scale: 2.4 + near * 2.6,
      color: 0xcfe4ff,
      duration: 0.42,
    });

    // screen flash + key light kick
    this.engine.postfx?.flash?.(0xdbe9ff, 0.5 + near * 0.85, 0.22 + near * 0.12);
    this._flashLevel = 1.4 + near * 2.2;
    this._flashDecay = 6.0;
    _v2.set(x, y + 60, z);
    this._flash.position.copy(_v2);
    this._flashTarget.position.copy(this._center);
    this._restrikes = rng() < 0.55 ? rng.int(1, 2) : 0;
    this._restrikeT = rng.range(0.07, 0.2);

    if (near > 0.55) this.engine.addShake?.(0.18 + near * 0.35, 2.6);

    // sound travels: ~1s per 90 world units, capped so it never feels detached
    const delay = Math.min(6.5, dist / 90);
    for (let i = 0; i < this._thunder.length; i++) {
      const q = this._thunder[i];
      if (q.t >= 0) continue;
      q.t = delay; q.x = x; q.y = y + 12; q.z = z;
      break;
    }
  }

  /**
   * A unit quad as an InstancedBufferGeometry with a per-instance random seed.
   * Built by hand rather than borrowed from PlaneGeometry so no attribute is
   * ever shared with a geometry someone else might dispose.
   */
  _makeQuad(maxInstances) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]), 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    const seeds = new Float32Array(maxInstances * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = this._rng();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    geo.instanceCount = maxInstances;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this._geoms.push(geo);
    return geo;
  }

  /* ------------------------------------------------------------- systems */

  _ensureRain() {
    if (this._sys.rain) return this._sys.rain;
    const q = this.quality;
    const max = q === 'low' ? 2200 : q === 'med' ? 3600 : q === 'ultra' ? 7000 : 5200;
    const geo = this._makeQuad(max);

    const u = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(42, 24, 42) },
      uSpeed: { value: 28 },
      uWind: { value: new THREE.Vector2(2.4, 1.0) },
      uLen: { value: 0.9 },
      uWidth: { value: 0.0038 },  // radians of screen width -> ~2.5px at any depth
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0.55, 0.62, 0.74) },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        attribute vec3 aSeed;
        uniform float uTime;
        uniform vec3  uCenter;
        uniform vec3  uBox;
        uniform float uSpeed;
        uniform vec2  uWind;
        uniform float uLen;
        uniform float uWidth;
        varying vec2  vUv;
        varying float vFade;
        void main() {
          float rs = fract(sin(dot(aSeed, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
          float sp = uSpeed * (0.80 + 0.45 * rs);
          float px = mod(aSeed.x * uBox.x + uWind.x * uTime, uBox.x) - uBox.x * 0.5;
          float pz = mod(aSeed.z * uBox.z + uWind.y * uTime, uBox.z) - uBox.z * 0.5;
          float py = uBox.y - mod(uTime * sp + aSeed.y * uBox.y * 3.0, uBox.y);
          vec3 wp = uCenter + vec3(px, py, pz);

          vec3 vel = normalize(vec3(uWind.x, -sp, uWind.y));
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vec3 velV = (viewMatrix * vec4(vel, 0.0)).xyz;
          vec2 d2 = velV.xy;
          float l = length(d2);
          vec2 dir = (l > 1e-4) ? d2 / l : vec2(0.0, -1.0);
          vec2 perp = vec2(-dir.y, dir.x);
          // a drop coming straight at the camera must not smear sideways
          float stretch = mix(0.30, 1.0, clamp(l, 0.0, 1.0));
          // length is world-space (real motion blur shrinks with distance);
          // width is screen-space so far drops never fall below a pixel
          float depth = max(-mv.z, 1.0);
          mv.xy += dir * (position.y * uLen * sp * 0.011 * stretch)
                 + perp * (position.x * uWidth * depth);
          gl_Position = projectionMatrix * mv;

          vUv = uv;
          float rad = length(vec2(px, pz)) / (0.5 * max(uBox.x, uBox.z));
          vFade = (1.0 - smoothstep(0.72, 1.0, rad)) * smoothstep(0.0, 0.10, py / uBox.y);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uOpacity;
        uniform vec3  uColor;
        varying vec2  vUv;
        varying float vFade;
        void main() {
          float taper = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float a = uOpacity * vFade * taper * edge * 0.75;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // the streak billboard mirrors the quad whenever the velocity points up
      // the screen, which flips the winding — never cull these
      side: THREE.DoubleSide,
      fog: false,
    });
    this._mats.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);

    this._sys.rain = { mesh, geo, mat, u, max };
    return this._sys.rain;
  }

  _ensureSplash() {
    if (this._sys.splash) return this._sys.splash;
    const q = this.quality;
    const max = q === 'low' ? 90 : q === 'med' ? 160 : q === 'ultra' ? 420 : 280;
    const geo = this._makeQuad(max);

    const u = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 16 },
      uRate: { value: 1.7 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0.7, 0.78, 0.9) },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        attribute vec3 aSeed;
        uniform float uTime;
        uniform vec3  uCenter;
        uniform float uRadius;
        uniform float uRate;
        varying vec2  vUv;
        varying float vA;
        void main() {
          float t = fract(uTime * uRate * (0.75 + 0.5 * aSeed.z) + aSeed.z * 7.13);
          float r = 0.05 + t * 0.38;
          vA = (1.0 - t) * (1.0 - t);
          vec3 wp = uCenter + vec3((aSeed.x - 0.5) * uRadius, 0.035, (aSeed.y - 0.5) * uRadius);
          wp.x += sin(aSeed.z * 31.7) * 0.6;
          wp.z += cos(aSeed.x * 27.1) * 0.6;
          wp.xz += position.xy * r * 2.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          vUv = uv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uOpacity;
        uniform vec3  uColor;
        varying vec2  vUv;
        varying float vA;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.45, 0.82, d) * (1.0 - smoothstep(0.84, 1.0, d));
          float a = ring * vA * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor * (0.6 + 0.8 * vA), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this._mats.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);

    this._sys.splash = { mesh, geo, mat, u, max };
    return this._sys.splash;
  }

  /**
   * One shader for every drifting particulate; the differences are all
   * uniforms, so snow, ash, embers and sand grains share a code path.
   */
  _ensureFlakes(name, cfg) {
    if (this._sys[name]) return this._sys[name];
    const q = this.quality;
    const scale = q === 'low' ? 0.35 : q === 'med' ? 0.6 : q === 'ultra' ? 1.35 : 1.0;
    const max = Math.max(64, Math.floor(cfg.count * scale));

    const pos = new Float32Array(max * 3);
    const rnd = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      pos[i * 3] = this._rng() * cfg.box[0];
      pos[i * 3 + 1] = this._rng() * cfg.box[1];
      pos[i * 3 + 2] = this._rng() * cfg.box[2];
      rnd[i] = this._rng();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this._geoms.push(geo);

    const u = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(cfg.box[0], cfg.box[1], cfg.box[2]) },
      uFall: { value: cfg.fall },
      uWind: { value: new THREE.Vector2(cfg.wind[0], cfg.wind[1]) },
      uDrift: { value: cfg.drift },
      uSwirl: { value: cfg.swirl },
      uSize: { value: cfg.size },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(cfg.color) },
      uPixelRatio: { value: this.engine.renderer.getPixelRatio ? this.engine.renderer.getPixelRatio() : 1 },
      uGlow: { value: cfg.glow || 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        attribute float aRnd;
        uniform float uTime;
        uniform vec3  uCenter;
        uniform vec3  uBox;
        uniform float uFall;
        uniform vec2  uWind;
        uniform float uDrift;
        uniform float uSwirl;
        uniform float uSize;
        uniform float uPixelRatio;
        varying float vRnd;
        varying float vFade;

        ${GLSL_NOISE}

        void main() {
          float sp = 0.65 + 0.7 * aRnd;
          float px = mod(position.x + uWind.x * uTime, uBox.x) - uBox.x * 0.5;
          float pz = mod(position.z + uWind.y * uTime, uBox.z) - uBox.z * 0.5;
          float py = mod(position.y - uFall * uTime * sp, uBox.y);
          vec3 p = vec3(px, py - uBox.y * 0.18, pz);

          if (uDrift > 0.001) {
            vec3 c = curl3(p * uSwirl + vec3(0.0, uTime * 0.18, aRnd * 4.0));
            p += c * uDrift;
          }
          vec3 wp = uCenter + p;

          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = max(-mv.z, 0.5);
          gl_PointSize = min(uSize * uPixelRatio * (30.0 / dist) * (0.6 + 0.8 * aRnd), 72.0);
          vRnd = aRnd;
          float rad = length(vec2(px, pz)) / (0.5 * max(uBox.x, uBox.z));
          vFade = 1.0 - smoothstep(0.68, 1.0, rad);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uOpacity;
        uniform vec3  uColor;
        uniform float uTime;
        uniform float uGlow;
        varying float vRnd;
        varying float vFade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float core = (1.0 - smoothstep(0.08, 0.5, r));
          float a = core * core * uOpacity * vFade;
          vec3 c = uColor;
          if (uGlow > 0.001) {
            float fl = 0.55 + 0.45 * sin(uTime * (5.0 + vRnd * 9.0) + vRnd * 30.0);
            c *= (0.6 + 1.6 * fl) * (1.0 + uGlow);
            a *= 0.55 + 0.45 * fl;
          }
          if (a < 0.004) discard;
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this._mats.push(mat);

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 22;
    pts.matrixAutoUpdate = false;
    this.group.add(pts);

    this._sys[name] = { mesh: pts, geo, mat, u, max, cfg };
    return this._sys[name];
  }

  _driveFlakes(name, weight, pq, ambient) {
    const cfg = FLAKE_DEFS[name];
    if (!cfg) return;
    const live = this._sys[name];
    if (weight <= 0.002) { if (live) live.mesh.visible = false; return; }
    const s = this._ensureFlakes(name, cfg);
    s.mesh.visible = true;
    const u = s.u;
    u.uTime.value = this._time;
    u.uCenter.value.copy(this._precip);
    u.uOpacity.value = clamp(weight * cfg.alpha, 0, 1);
    u.uPixelRatio.value = this.engine.renderer.getPixelRatio ? this.engine.renderer.getPixelRatio() : 1;
    if (cfg.tintAmbient) {
      _c2.setHex(cfg.color).lerp(ambient, cfg.tintAmbient);
      u.uColor.value.copy(_c2);
    }
    const n = Math.max(1, Math.floor(s.max * clamp(pq * weight, 0.05, 1.4)));
    s.geo.setDrawRange(0, Math.min(n, s.max));
  }

  _ensureHaze() {
    if (this._sys.haze) return this._sys.haze;
    const max = this.quality === 'low' ? 22 : this.quality === 'med' ? 40 : 70;
    const geo = this._makeQuad(max);

    const u = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(64, 18, 64) },
      uSpeed: { value: 12 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xc8a165) },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        attribute vec3 aSeed;
        uniform float uTime;
        uniform vec3  uCenter;
        uniform vec3  uBox;
        uniform float uSpeed;
        varying vec2  vUv;
        varying float vFade;
        void main() {
          float sp = uSpeed * (0.7 + 0.6 * aSeed.z);
          float px = mod(aSeed.x * uBox.x + sp * uTime, uBox.x) - uBox.x * 0.5;
          float pz = mod(aSeed.z * uBox.z + sp * 0.35 * uTime, uBox.z) - uBox.z * 0.5;
          float py = aSeed.y * uBox.y * 0.75 + sin(uTime * 0.4 + aSeed.x * 9.0) * 0.8;
          vec3 wp = uCenter + vec3(px, py, pz);
          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          float size = 9.0 + aSeed.y * 16.0;
          mv.xy += position.xy * size;
          gl_Position = projectionMatrix * mv;
          vUv = uv;
          float rad = length(vec2(px, pz)) / (0.5 * max(uBox.x, uBox.z));
          vFade = (1.0 - smoothstep(0.55, 1.0, rad)) * (0.5 + 0.5 * aSeed.z);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uOpacity;
        uniform vec3  uColor;
        varying vec2  vUv;
        varying float vFade;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 2.2) * uOpacity * vFade;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
    this._mats.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 19;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);

    this._sys.haze = { mesh, geo, mat, u, max };
    return this._sys.haze;
  }

  /* -------------------------------------------------------------- dispose */

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._wetEmitted > 0.001) this.bus.emit('weather:wetness', 0);
    this.group.parent?.remove(this.group);
    for (const g of this._geoms) g.dispose();
    for (const m of this._mats) m.dispose();
    this._geoms.length = 0;
    this._mats.length = 0;
    this._sys = {};
  }
}

export default Weather;
