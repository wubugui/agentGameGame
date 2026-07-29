import * as THREE from 'three';
import { makeRng } from '../core/Rng.js';
import { WORLD } from '../game/Config.js';

/**
 * Sky dome, celestial bodies and the day/night lighting rig.
 *
 * Everything here is analytic — a single-scattering Rayleigh/Mie dome shader
 * (no textures, no addons), a star field with a Milky Way band baked into the
 * dome, a phased moon quad, and a drifting procedural cloud layer projected on
 * a flat plane in view direction space. The same scattering maths is evaluated
 * once per frame on the CPU to drive `scene.fog` so the horizon and the fog
 * never disagree.
 *
 * Frame budget notes:
 *  - zero allocation in update(); every vector/colour temp is module scope.
 *  - the PMREM environment map is refreshed on a throttle, never per frame.
 *  - the shadow frustum is a tight ortho box snapped to shadow-map texels and
 *    re-centred on the camera target each frame — that, not resolution, is what
 *    makes the world shadow crisp.
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ shared */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _snap = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const _m3 = new THREE.Matrix3();
const _m4 = new THREE.Matrix4();

/** Rayleigh coefficients (sea level, per metre) and scale heights. */
const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6];
const BETA_M0 = 21e-6;
const H_R = 8400.0;
const H_M = 1250.0;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }

/** Chapman-style relative air mass for a given cosine of the zenith angle. */
function airMass(cosZ) {
  const ang = Math.acos(clamp(cosZ, -1, 1)) * 57.29577951;
  return 1.0 / (Math.max(cosZ, 0) + 0.15 * Math.pow(Math.max(93.885 - ang, 1e-3), -1.253));
}

/**
 * CPU twin of the dome's single-scattering term. Mirrors `skyScatter()` in the
 * fragment shader below — keep the two in sync when tuning.
 * Writes linear radiance into `out`.
 */
function scatterCPU(dirY, cosT, sunY, turbidity, mieG, intensity, out) {
  const bM = BETA_M0 * turbidity;
  const vD = airMass(Math.max(dirY, -0.05));
  const sD = airMass(Math.max(sunY + 0.15 * Math.max(dirY, 0), 0.012));
  const pR = (3 / (16 * Math.PI)) * (1 + cosT * cosT);
  const g = mieG;
  const pM = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(Math.max(1 + g * g - 2 * g * cosT, 1e-4), 1.5));
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < 3; i++) {
    const bR = BETA_R[i];
    const tauV = (bR * H_R + bM * H_M) * vD;
    const tauS = (bR * H_R + bM * H_M) * sD;
    const fex = Math.exp(-tauV);
    const att = Math.exp(-tauS);
    const num = bR * pR + bM * pM;
    const den = bR + bM;
    const v = (num / den) * att * (1 - fex) * intensity;
    if (i === 0) r = v; else if (i === 1) gg = v; else b = v;
  }
  out.setRGB(r, gg, b);
  return out;
}

/* ----------------------------------------------------------------- presets */

/**
 * A preset is a set of multipliers/overrides layered on top of the time-of-day
 * solution. Every field is linearly blendable so `setPreset` can cross-fade.
 * `hours` (optional) is the window the clock is nudged into when the preset is
 * selected — outside it the look would be a lie.
 */
const PRESET_DEFS = {
  day: {
    hours: [6.8, 17.2], clock: 1, sun: 1.0, moon: 1.0, hemi: 1.0,
    fogMul: 1.0, fogTint: 0x000000, fogTintAmt: 0,
    turbidity: 2.2, mieG: 0.76, exposure: 1.0,
    cover: 0.30, cloudLight: 1.0, cloudDark: 0.55, wind: 1.0,
    star: 1.0, milky: 1.0, override: 0, ovrZenith: 0x000000, ovrHorizon: 0x000000,
    grey: 0.0, greyColor: 0xb8c2cc, ash: 0, sunTint: 0xffffff,
  },
  dawn: {
    hours: [4.9, 7.1], clock: 1, sun: 1.0, moon: 1.0, hemi: 1.02,
    fogMul: 1.55, fogTint: 0x3a2a2a, fogTintAmt: 0.18,
    turbidity: 3.1, mieG: 0.79, exposure: 1.05,
    cover: 0.34, cloudLight: 1.15, cloudDark: 0.5, wind: 0.8,
    star: 1.0, milky: 1.0, override: 0, ovrZenith: 0x000000, ovrHorizon: 0x000000,
    grey: 0.0, greyColor: 0xb8c2cc, ash: 0, sunTint: 0xffe6d2,
  },
  dusk: {
    hours: [17.4, 19.6], clock: 1, sun: 1.0, moon: 1.0, hemi: 1.02,
    fogMul: 1.7, fogTint: 0x3d2418, fogTintAmt: 0.22,
    turbidity: 3.6, mieG: 0.80, exposure: 1.05,
    cover: 0.40, cloudLight: 1.2, cloudDark: 0.45, wind: 0.9,
    star: 1.0, milky: 1.0, override: 0, ovrZenith: 0x000000, ovrHorizon: 0x000000,
    grey: 0.0, greyColor: 0xb8c2cc, ash: 0, sunTint: 0xffd9b0,
  },
  night: {
    hours: [20.6, 4.4], clock: 1, sun: 1.0, moon: 1.15, hemi: 1.1,
    fogMul: 1.25, fogTint: 0x0a1122, fogTintAmt: 0.3,
    turbidity: 2.0, mieG: 0.74, exposure: 1.0,
    cover: 0.26, cloudLight: 0.7, cloudDark: 0.35, wind: 0.7,
    star: 1.15, milky: 1.2, override: 0, ovrZenith: 0x000000, ovrHorizon: 0x000000,
    grey: 0.0, greyColor: 0x8aa0bc, ash: 0, sunTint: 0xffffff,
  },
  overcast: {
    hours: null, clock: 1, sun: 0.34, moon: 0.55, hemi: 1.18,
    fogMul: 2.1, fogTint: 0x8e96a0, fogTintAmt: 0.45,
    turbidity: 5.2, mieG: 0.72, exposure: 0.9,
    cover: 0.93, cloudLight: 0.62, cloudDark: 0.72, wind: 1.5,
    star: 0.12, milky: 0.1, override: 0, ovrZenith: 0x000000, ovrHorizon: 0x000000,
    grey: 0.72, greyColor: 0xa8b2be, ash: 0, sunTint: 0xdfe6ee,
  },
  storm: {
    hours: null, clock: 1, sun: 0.16, moon: 0.35, hemi: 0.98,
    fogMul: 3.1, fogTint: 0x50565e, fogTintAmt: 0.6,
    turbidity: 7.4, mieG: 0.70, exposure: 0.82,
    cover: 1.0, cloudLight: 0.34, cloudDark: 0.85, wind: 3.4,
    star: 0.0, milky: 0.0, override: 0, ovrZenith: 0x000000, ovrHorizon: 0x000000,
    grey: 0.86, greyColor: 0x6d747c, ash: 0, sunTint: 0xc6cfda,
  },
  cave: {
    hours: null, clock: 0, sun: 0.0, moon: 0.0, hemi: 0.50,
    fogMul: 4.0, fogTint: 0x0a0b0f, fogTintAmt: 1.0,
    turbidity: 2.0, mieG: 0.76, exposure: 1.0,
    cover: 0.0, cloudLight: 0.0, cloudDark: 0.0, wind: 0.0,
    star: 0.0, milky: 0.0, override: 1, ovrZenith: 0x05060a, ovrHorizon: 0x14100c,
    grey: 0.0, greyColor: 0x101216, ash: 0, sunTint: 0xffd2a0,
  },
  hell: {
    hours: [9.0, 16.0], clock: 0, sun: 0.30, moon: 0.0, hemi: 0.62,
    fogMul: 2.9, fogTint: 0x2c0805, fogTintAmt: 0.95,
    turbidity: 6.0, mieG: 0.78, exposure: 0.95,
    cover: 0.62, cloudLight: 0.35, cloudDark: 0.9, wind: 1.8,
    star: 0.12, milky: 0.0, override: 1, ovrZenith: 0x11040a, ovrHorizon: 0x66150a,
    grey: 0.0, greyColor: 0x50201a, ash: 1, sunTint: 0xff6a3a,
  },
};

/** Numeric preset fields blended term by term. */
const NUM_KEYS = [
  'sun', 'moon', 'hemi', 'fogMul', 'fogTintAmt', 'turbidity', 'mieG', 'exposure',
  'cover', 'cloudLight', 'cloudDark', 'wind', 'star', 'milky', 'override', 'grey', 'ash',
  'clock',
];
const COL_KEYS = ['fogTint', 'ovrZenith', 'ovrHorizon', 'greyColor', 'sunTint'];

function makeParams(src) {
  const p = {};
  for (const k of NUM_KEYS) p[k] = src[k];
  for (const k of COL_KEYS) p[k] = new THREE.Color(src[k]);
  return p;
}
function copyParams(dst, src) {
  for (const k of NUM_KEYS) dst[k] = src[k];
  for (const k of COL_KEYS) dst[k].copy(src[k]);
  return dst;
}
function blendParams(dst, a, b, t) {
  // indexed loops: this runs every frame while a preset cross-fades
  for (let i = 0; i < NUM_KEYS.length; i++) { const k = NUM_KEYS[i]; dst[k] = a[k] + (b[k] - a[k]) * t; }
  for (let i = 0; i < COL_KEYS.length; i++) { const k = COL_KEYS[i]; dst[k].copy(a[k]).lerp(b[k], t); }
  return dst;
}

/* ------------------------------------------------------------ glsl helpers */

const GLSL_NOISE = /* glsl */`
float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash31(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise2(vec2 x){
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vnoise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

/* --------------------------------------------------------------------- Sky */

export class Sky {
  constructor(ctx) {
    this.ctx = ctx;
    const engine = ctx.engine;
    this.engine = engine;
    this.scene = engine.scene;
    this.renderer = engine.renderer;
    this.quality = ctx.quality || 'high';

    /** 0..24 in-game hours. Assigning jumps the clock; update() flows it. */
    this.timeOfDay = WORLD.startHour != null ? WORLD.startHour : 8.5;
    this._prevTod = this.timeOfDay;
    this._day = 0;

    /** Public: the colour distant geometry should dissolve into. */
    this.fogColor = new THREE.Color(0x8ea8c4);
    /** Public: PMREM env map. Null only if the renderer refused to build one. */
    this.envMap = null;

    this._params = makeParams(PRESET_DEFS.day);
    this._from = makeParams(PRESET_DEFS.day);
    this._to = makeParams(PRESET_DEFS.day);
    this.preset = 'day';
    this._blendT = 1;
    this._blendDur = 0;

    this._hourGoal = -1;
    this._hourRate = 0;

    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._moonDir = new THREE.Vector3(0, -1, 0);
    this._sunColor = new THREE.Color(1, 1, 1);
    this._moonColor = new THREE.Color(0.62, 0.72, 1.0);
    this._dayF = 1;
    this._moonPhase = 0.5;
    this._moonIllum = 1;

    this._envTimer = 0;
    this._envDirty = true;
    this._bakeSunY = -99;
    this._disposed = false;

    this._geoms = [];
    this._mats = [];

    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.group.frustumCulled = false;
    this.scene.add(this.group);

    const far = (engine.camera && engine.camera.far) || 400;
    this._radius = far * 0.78;

    this._buildDome();
    this._buildStars();
    this._buildMoon();
    this._buildClouds();
    this._buildLights();
    this._buildFog();
    this._buildEnv();

    // Solve once so the very first rendered frame is already correct.
    this._solve(0);
    this._refreshEnv();
  }

  /* ---------------------------------------------------------------- build */

  _buildDome() {
    const geo = new THREE.SphereGeometry(1, 40, 24);
    this._geoms.push(geo);

    this._skyU = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunI: { value: 34.0 },
      uMoonI: { value: 0.0 },
      uTurbidity: { value: 2.2 },
      uMieG: { value: 0.76 },
      uNight: { value: 0.0 },
      uMilky: { value: 0.0 },
      uStarRot: { value: new THREE.Matrix3() },
      uGround: { value: new THREE.Color(0x30363c) },
      uOverride: { value: 0.0 },
      uOvrZenith: { value: new THREE.Color(0x000000) },
      uOvrHorizon: { value: new THREE.Color(0x000000) },
      uGrey: { value: 0.0 },
      uGreyColor: { value: new THREE.Color(0xb8c2cc) },
      uExposure: { value: 1.0 },
      uAsh: { value: 0.0 },
      uTime: { value: 0.0 },
      uSunDisc: { value: 1.0 },
    };

    const vert = /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const frag = /* glsl */`
      varying vec3 vDir;

      uniform vec3  uSunDir;
      uniform vec3  uMoonDir;
      uniform float uSunI;
      uniform float uMoonI;
      uniform float uTurbidity;
      uniform float uMieG;
      uniform float uNight;
      uniform float uMilky;
      uniform mat3  uStarRot;
      uniform vec3  uGround;
      uniform float uOverride;
      uniform vec3  uOvrZenith;
      uniform vec3  uOvrHorizon;
      uniform float uGrey;
      uniform vec3  uGreyColor;
      uniform float uExposure;
      uniform float uAsh;
      uniform float uTime;
      uniform float uSunDisc;

      #define PI 3.141592653589793

      ${GLSL_NOISE}

      const vec3  betaR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
      const float betaM0 = 21e-6;
      const float hR = 8400.0;
      const float hM = 1250.0;

      float airMass(float cosZ) {
        float ang = degrees(acos(clamp(cosZ, -1.0, 1.0)));
        return 1.0 / (max(cosZ, 0.0) + 0.15 * pow(max(93.885 - ang, 1e-3), -1.253));
      }

      // Single-scattering approximation: Rayleigh + Henyey-Greenstein Mie,
      // attenuated along both the view ray and the light ray.
      vec3 skyScatter(vec3 dir, vec3 light, float intensity, out vec3 sunAtt) {
        float cosT = clamp(dot(dir, light), -1.0, 1.0);
        float bM = betaM0 * uTurbidity;
        float vD = airMass(max(dir.y, -0.05));
        // A scattering point overhead sits higher in the atmosphere, so the
        // light reaching it has travelled through less air than the light
        // reaching the horizon. Without this term twilight goes red->black
        // instead of red->deep blue.
        float sD = airMass(max(light.y + 0.15 * max(dir.y, 0.0), 0.012));
        vec3 tauV = (betaR * hR + bM * hM) * vD;
        vec3 tauS = (betaR * hR + bM * hM) * sD;
        vec3 fex = exp(-tauV);
        sunAtt = exp(-tauS);
        float pR = (3.0 / (16.0 * PI)) * (1.0 + cosT * cosT);
        float g = uMieG;
        float pM = (1.0 / (4.0 * PI)) * ((1.0 - g * g) /
                    pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5));
        vec3 num = betaR * pR + bM * pM;
        vec3 den = betaR + bM;
        return (num / den) * sunAtt * (1.0 - fex) * intensity;
      }

      float fbm3(vec3 p) {
        float a = 0.5, s = 0.0;
        for (int i = 0; i < 3; i++) { s += a * vnoise3(p); p *= 2.03; a *= 0.5; }
        return s;
      }

      void main() {
        vec3 dir = normalize(vDir);

        float sunUp  = smoothstep(-0.16, 0.05, uSunDir.y);
        float moonUp = smoothstep(-0.09, 0.07, uMoonDir.y);

        vec3 sunAtt, moonAtt;
        vec3 col = skyScatter(dir, uSunDir, uSunI * sunUp, sunAtt);
        col += skyScatter(dir, uMoonDir, uMoonI * moonUp, moonAtt) * vec3(0.55, 0.68, 1.0);

        // --- night floor: navy at the zenith, a touch lighter at the horizon
        float up = clamp(dir.y, 0.0, 1.0);
        vec3 nightCol = mix(vec3(0.0150, 0.0210, 0.0430), vec3(0.0045, 0.0075, 0.0250),
                            smoothstep(0.0, 0.75, up));
        col += nightCol * uNight;

        // --- Milky Way band + faint galactic dust, rotating with the stars.
        // The expensive noise only runs inside the band, which is a spatially
        // coherent ~20% of the sky, so the branch is cheap in practice.
        if (uMilky > 0.001) {
          vec3 sd = uStarRot * dir;
          float band = exp(-pow(abs(sd.y) * 3.4, 2.0));
          if (band > 0.02) {
            float dust = fbm3(sd * 5.0 + 3.1);
            float rift = smoothstep(0.32, 0.60, vnoise3(sd * 2.4 - 7.0) * 0.7 + vnoise3(sd * 5.1) * 0.3);
            float m = band * (0.35 + 0.9 * dust) * (0.35 + 0.65 * rift);
            col += m * uMilky * vec3(0.020, 0.021, 0.030);
          }
        }

        // --- sun disc + aureole, reddened by the same extinction as the sky
        float cosS = clamp(dot(dir, uSunDir), -1.0, 1.0);
        float disc = smoothstep(0.99958, 0.99986, cosS);
        float aureole = pow(max(cosS, 0.0), 320.0) * 0.55 + pow(max(cosS, 0.0), 24.0) * 0.06;
        col += (disc * 46.0 + aureole * 3.0) * sunAtt * uSunI * 0.03 * sunUp * uSunDisc;

        // --- preset override (cave / hell) replaces the atmosphere outright
        if (uOverride > 0.001) {
          float h = pow(clamp(dir.y, 0.0, 1.0), 0.60);
          vec3 ovr = mix(uOvrHorizon, uOvrZenith, h);
          if (uAsh > 0.001) {
            vec2 ap = dir.xz / max(dir.y * 0.6 + 0.45, 0.08) * 1.4 + vec2(uTime * 0.012, uTime * 0.006);
            float haze = vnoise2(ap * 1.7) * 0.6 + vnoise2(ap * 4.1) * 0.4;
            ovr += uAsh * haze * haze * vec3(0.075, 0.020, 0.008) * (1.0 - h * 0.5);
            ovr += uAsh * pow(1.0 - clamp(dir.y, 0.0, 1.0), 8.0) * vec3(0.10, 0.014, 0.004);
          }
          col = mix(col, ovr, uOverride);
        }

        // --- overcast / storm flatten the dome into a luminous grey sheet
        if (uGrey > 0.001) {
          vec3 flat0 = uGreyColor * (0.42 + 0.58 * smoothstep(-0.08, 0.55, dir.y));
          col = mix(col, flat0, uGrey);
        }

        // --- below the horizon fade into the ground haze
        col = mix(col, uGround, (1.0 - smoothstep(-0.14, 0.005, dir.y)));

        col *= uExposure;

        // cheap ordered-ish dither kills banding in the big smooth gradients
        col += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 320.0);

        gl_FragColor = vec4(max(col, 0.0), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `;

    const mat = new THREE.ShaderMaterial({
      uniforms: this._skyU,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this._mats.push(mat);
    this._domeMat = mat;

    this._dome = new THREE.Mesh(geo, mat);
    this._dome.scale.setScalar(this._radius);
    this._dome.renderOrder = 1000;      // last of the opaque queue: free early-z
    this._dome.frustumCulled = false;
    this._dome.matrixAutoUpdate = false;
    this.group.add(this._dome);

    // A second dome sharing the same uniform object feeds the PMREM pass.
    const envMat = new THREE.ShaderMaterial({
      uniforms: this._skyU,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this._mats.push(envMat);
    this._envScene = new THREE.Scene();
    this._envDome = new THREE.Mesh(geo, envMat);
    this._envDome.scale.setScalar(4);
    this._envDome.frustumCulled = false;
    this._envScene.add(this._envDome);
  }

  _buildStars() {
    const rng = makeRng(0x5741d0);
    const q = this.quality;
    const count = q === 'low' ? 700 : q === 'med' ? 1100 : q === 'ultra' ? 2200 : 1600;

    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const mag = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    const phase = new Float32Array(count);

    const R = this._radius * 0.97;
    for (let i = 0; i < count; i++) {
      // 45% of the field clusters into the galactic band so the sky has structure
      let x, y, z;
      if (rng() < 0.45) {
        const a = rng() * TAU;
        const yy = rng.gauss(0, 0.17);
        const r = Math.sqrt(Math.max(0, 1 - yy * yy));
        x = Math.cos(a) * r; y = yy; z = Math.sin(a) * r;
      } else {
        const u = rng() * 2 - 1;
        const a = rng() * TAU;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        x = Math.cos(a) * r; y = u; z = Math.sin(a) * r;
      }
      const l = Math.hypot(x, y, z) || 1;
      pos[i * 3] = (x / l) * R;
      pos[i * 3 + 1] = (y / l) * R;
      pos[i * 3 + 2] = (z / l) * R;

      // magnitude: a lot of faint stars, a handful of beacons
      const m = Math.pow(rng(), 3.1);
      mag[i] = 0.22 + m * 1.7;
      size[i] = 1.1 + m * 3.4;
      phase[i] = rng() * TAU;

      // spectral tint: mostly white, some blue-white giants, some orange dwarfs
      const t = rng();
      if (t < 0.16) { _c1.setRGB(0.66, 0.76, 1.0); }
      else if (t < 0.32) { _c1.setRGB(1.0, 0.82, 0.62); }
      else { _c1.setRGB(0.94, 0.95, 1.0); }
      tint[i * 3] = _c1.r; tint[i * 3 + 1] = _c1.g; tint[i * 3 + 2] = _c1.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.05);
    this._geoms.push(geo);

    this._starU = {
      uOpacity: { value: 0.0 },
      uPixelRatio: { value: this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1 },
      uTime: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this._starU,
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute float aMag;
        attribute vec3  aTint;
        attribute float aPhase;
        uniform float uOpacity;
        uniform float uPixelRatio;
        uniform float uTime;
        varying float vBright;
        varying vec3  vTint;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.80 + 0.20 * sin(uTime * (1.1 + fract(aPhase) * 2.7) + aPhase * 5.3);
          vBright = aMag * uOpacity * tw;
          vTint = aTint;
          gl_PointSize = aSize * uPixelRatio * (0.7 + 0.5 * aMag);
        }
      `,
      fragmentShader: /* glsl */`
        varying float vBright;
        varying vec3  vTint;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float core = (1.0 - smoothstep(0.04, 0.5, r));
          float flare = pow(max(0.0, 1.0 - r * 2.0), 6.0) * 0.35;
          float a = core * core + flare;
          if (a * vBright < 0.002) discard;
          gl_FragColor = vec4(vTint * vBright, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this._mats.push(mat);

    this._stars = new THREE.Points(geo, mat);
    this._stars.renderOrder = 1001;
    this._stars.frustumCulled = false;
    this._stars.visible = false;
    this.group.add(this._stars);

    this._starAxis = new THREE.Vector3(0, Math.cos(0.58), -Math.sin(0.58)).normalize();
  }

  _buildMoon() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this._geoms.push(geo);

    this._moonU = {
      uLight: { value: new THREE.Vector3(1, 0, 0.2) },
      uColor: { value: new THREE.Color(0xf2f4ff) },
      uOpacity: { value: 0 },
      uGlow: { value: 1 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this._moonU,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform vec3  uLight;
        uniform vec3  uColor;
        uniform float uOpacity;
        uniform float uGlow;

        ${GLSL_NOISE}

        float mare(vec3 n) {
          float a = vnoise3(n * 3.1) * 0.55 + vnoise3(n * 7.3) * 0.28 + vnoise3(n * 15.7) * 0.17;
          return a;
        }

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float body = (1.0 - smoothstep(0.955, 1.0, r));
          float halo = exp(-max(r - 0.42, 0.0) * 3.1) * uGlow;

          vec3 n = vec3(p, sqrt(max(1e-4, 1.0 - min(r * r, 1.0))));
          float lam = clamp(dot(n, normalize(uLight)), 0.0, 1.0);
          float term = smoothstep(0.0, 0.16, lam);
          float limb = mix(1.0, 0.68, pow(min(r, 1.0), 3.0));

          float m = mare(n);
          vec3 surf = uColor * mix(0.62, 1.0, m) * limb;
          vec3 col = surf * term * 1.35;
          col += uColor * 0.020 * body;                 // earthshine
          col += uColor * halo * 0.16 * (0.35 + 0.65 * term);

          float a = clamp(body * (term * 0.92 + 0.08) + halo * 0.30, 0.0, 1.0) * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(col * uOpacity, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this._mats.push(mat);

    this._moonMesh = new THREE.Mesh(geo, mat);
    this._moonMesh.scale.setScalar(this._radius * 0.085);
    this._moonMesh.renderOrder = 1002;
    this._moonMesh.frustumCulled = false;
    this._moonMesh.visible = false;
    this.group.add(this._moonMesh);
  }

  _buildClouds() {
    // Upper hemisphere only; the shader projects the view direction onto a flat
    // layer so the clouds compress toward the horizon like a real deck.
    const geo = new THREE.SphereGeometry(1, 48, 18, 0, TAU, 0, Math.PI * 0.52);
    this._geoms.push(geo);

    this._cloudU = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSkyColor: { value: new THREE.Color(0x6f8fb5) },
      uCover: { value: 0.3 },
      uLight: { value: 1.0 },
      uDark: { value: 0.55 },
      uOpacity: { value: 1.0 },
      uWind: { value: new THREE.Vector2(0.004, 0.0016) },
      uScale: { value: 0.020 },
    };

    const oct = (this.quality === 'low' || this.quality === 'med') ? 3 : 5;

    const mat = new THREE.ShaderMaterial({
      uniforms: this._cloudU,
      defines: { CLOUD_OCTAVES: oct },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform float uTime;
        uniform vec3  uSunDir;
        uniform vec3  uSunColor;
        uniform vec3  uSkyColor;
        uniform float uCover;
        uniform float uLight;
        uniform float uDark;
        uniform float uOpacity;
        uniform vec2  uWind;
        uniform float uScale;

        ${GLSL_NOISE}

        const mat2 R2 = mat2(0.86, 0.51, -0.51, 0.86);

        float fbm2(vec2 p) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < CLOUD_OCTAVES; i++) {
            s += a * vnoise2(p);
            p = R2 * p * 2.07;
            a *= 0.5;
          }
          return s;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float horizon = smoothstep(0.015, 0.28, dir.y);
          if (horizon <= 0.001 || uOpacity <= 0.002) discard;

          // project onto a flat cloud deck
          vec2 uv = dir.xz / max(dir.y, 0.05) * 90.0;
          vec2 w = uWind * uTime * 6.0;
          vec2 q = uv * uScale + w;

          // A single low-frequency octave carries the cloud *shape* (fbm alone
          // clusters around 0.5 and turns the whole sky into milk); the fbm
          // only adds billowing detail on top.
          float shape = vnoise2(q);
          // detail fades out toward the horizon where the projection squashes
          // it into aliasing-prone streaks
          float det = mix(0.5, fbm2(q * 3.1), horizon);
          float n = shape * 0.70 + det * 0.30;
          float cover = clamp(uCover, 0.0, 1.0);
          float t0 = 0.63 - cover * 0.46;
          float dens = smoothstep(t0, t0 + 0.11, n);
          if (dens <= 0.003) discard;
          dens *= clamp(0.70 + 0.55 * vnoise2(q * 6.7), 0.0, 1.0);   // erode edges
          dens = clamp(dens, 0.0, 1.0);

          // self-shadowing: sample the field a step toward the sun
          vec2 sunStep = normalize(uSunDir.xz + vec2(1e-4)) * 0.16;
          float ns = vnoise2(q + sunStep) * 0.70 + fbm2((q + sunStep) * 3.1) * 0.30;
          float lit = clamp((n - ns) * 3.2 + 0.5, 0.0, 1.0);

          // silver rim where the deck thins out against the light
          float rim = pow(1.0 - dens, 2.5) * pow(max(dot(dir, uSunDir), 0.0), 5.0);

          vec3 darkCol = uSkyColor * uDark;
          vec3 litCol  = uSunColor * uLight;
          vec3 col = mix(darkCol, litCol, lit * lit);
          col += uSunColor * rim * 1.7 * uLight;

          float a = dens * horizon * uOpacity * (0.55 + 0.45 * cover);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      fog: false,
    });
    this._mats.push(mat);

    this._clouds = new THREE.Mesh(geo, mat);
    this._clouds.scale.set(this._radius * 0.93, this._radius * 0.93, this._radius * 0.93);
    this._clouds.renderOrder = 1003;
    this._clouds.frustumCulled = false;
    this.group.add(this._clouds);
  }

  _buildLights() {
    const preset = this.engine.preset || {};
    const mapSize = preset.shadowMap || 2048;
    this._shadowSize = mapSize;

    this.sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
    this.sun.name = 'sun';
    this.sun.position.set(40, 80, 20);
    this.sun.castShadow = preset.shadows !== false;
    this._configureShadow(this.sun.shadow, mapSize);
    this.sunTarget = new THREE.Object3D();
    this.group.add(this.sun);
    this.group.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.moon = new THREE.DirectionalLight(0x9fb6ff, 0.0);
    this.moon.name = 'moon';
    this.moon.position.set(-40, 70, -20);
    // Only high tiers pay for a second shadow map at night.
    this._moonShadows = (preset.shadows !== false) && (this.quality === 'high' || this.quality === 'ultra');
    this.moon.castShadow = false;
    if (this._moonShadows) this._configureShadow(this.moon.shadow, Math.max(1024, mapSize >> 1));
    this.moonTarget = new THREE.Object3D();
    this.group.add(this.moon);
    this.group.add(this.moonTarget);
    this.moon.target = this.moonTarget;

    this.hemi = new THREE.HemisphereLight(0x9dc4ff, 0x6b5a3e, 0.85);
    this.hemi.name = 'hemi';
    this.group.add(this.hemi);

    this._shadowRadius = 0;
  }

  _configureShadow(shadow, mapSize) {
    shadow.mapSize.set(mapSize, mapSize);
    shadow.bias = -0.00045;
    shadow.normalBias = 0.035;
    shadow.radius = 2.2;
    const cam = shadow.camera;
    cam.near = 1;
    cam.far = 220;
    cam.left = -20; cam.right = 20; cam.top = 20; cam.bottom = -20;
    cam.updateProjectionMatrix();
  }

  _buildFog() {
    this.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.006);
    this.fog.color.copy(this.fogColor);
    this._prevFog = this.scene.fog || null;
    this.scene.fog = this.fog;
  }

  _buildEnv() {
    this._pmrem = null;
    this._envRT = null;
    try {
      this._pmrem = new THREE.PMREMGenerator(this.renderer);
      this._pmrem.compileEquirectangularShader?.();
    } catch (e) {
      console.warn('[sky] PMREM unavailable, skipping env map', e);
      this._pmrem = null;
    }
    this._envSize = (this.quality === 'low' || this.quality === 'med') ? 96 : 160;
  }

  /* -------------------------------------------------------------- presets */

  /**
   * Cross-fade to a named look. Unknown names fall back to 'day' with a warning.
   * @param {string} name
   * @param {number} seconds
   */
  setPreset(name, seconds = 3) {
    let def = PRESET_DEFS[name];
    if (!def) {
      console.warn(`[sky] unknown preset '${name}', using 'day'`);
      name = 'day';
      def = PRESET_DEFS.day;
    }
    this.preset = name;
    copyParams(this._from, this._params);
    copyParams(this._to, makeParams(def));
    this._blendDur = Math.max(0, seconds || 0);
    this._blendT = this._blendDur > 0 ? 0 : 1;
    if (this._blendT === 1) copyParams(this._params, this._to);

    // Nudge the clock into the window the look actually describes.
    const hrs = def.hours;
    this._hourGoal = -1;
    if (hrs) {
      const t = this.timeOfDay;
      const inside = hrs[0] <= hrs[1]
        ? (t >= hrs[0] && t <= hrs[1])
        : (t >= hrs[0] || t <= hrs[1]);
      if (!inside) {
        const mid = hrs[0] <= hrs[1]
          ? (hrs[0] + hrs[1]) * 0.5
          : ((hrs[0] + hrs[1] + 24) * 0.5) % 24;
        this._hourGoal = mid;
        let d = mid - t;
        while (d > 12) d -= 24;
        while (d < -12) d += 24;
        this._hourRate = this._blendDur > 0.01 ? d / this._blendDur : d * 1000;
        if (this._blendDur <= 0.01) { this.timeOfDay = mid; this._hourGoal = -1; }
      }
    }
    this._envDirty = true;
  }

  /* ---------------------------------------------------------------- frame */

  update(dt) {
    if (this._disposed) return;
    const d = dt > 0 ? dt : 0;

    // clock
    if (this._hourGoal >= 0) {
      let rem = this._hourGoal - this.timeOfDay;
      while (rem > 12) rem -= 24;
      while (rem < -12) rem += 24;
      const step = this._hourRate * d;
      if (Math.abs(step) >= Math.abs(rem) || Math.abs(rem) < 0.002) {
        this.timeOfDay = this._hourGoal;
        this._hourGoal = -1;
      } else {
        this.timeOfDay += step;
      }
    } else {
      // dungeons freeze the clock (preset.clock === 0) — there is no sky to
      // watch turn, and a cave that silently slides into night is a bug report
      const perHour = WORLD.secondsPerGameHour || 55;
      this.timeOfDay += (d / perHour) * this._params.clock;
    }
    if (this.timeOfDay >= 24) { this.timeOfDay -= 24 * Math.floor(this.timeOfDay / 24); this._day++; }
    if (this.timeOfDay < 0) { this.timeOfDay += 24 * (Math.floor(-this.timeOfDay / 24) + 1); this._day--; }
    this._prevTod = this.timeOfDay;

    // preset blend
    if (this._blendT < 1) {
      this._blendT = Math.min(1, this._blendT + (this._blendDur > 0 ? d / this._blendDur : 1));
      const t = this._blendT * this._blendT * (3 - 2 * this._blendT);
      blendParams(this._params, this._from, this._to, t);
      this._envDirty = true;
    }

    this._solve(d);

    // env map refresh on a throttle — a PMREM bake is far too heavy per frame
    this._envTimer -= d;
    if (this._envTimer <= 0) {
      const fast = this._blendT < 1;
      this._envTimer = fast ? 0.5 : ((this.quality === 'low' || this.quality === 'med') ? 4.0 : 2.0);
      // ...and only actually bake when the sky has moved enough to matter.
      if (this._envDirty || Math.abs(this._sunDir.y - this._bakeSunY) > 0.02) this._refreshEnv();
    }
  }

  /** Recompute every derived value: celestial positions, colours, fog, shadows. */
  _solve(dt) {
    const p = this._params;
    const cam = this.engine.camera;
    const camPos = cam ? _camPos.copy(cam.position) : _camPos.set(0, 0, 0);
    const t = this.ctx.time || (this.engine.elapsed || 0);

    // ---- sun / moon geometry (real arc: latitude 35N, mild declination) ----
    const lat = 35 * DEG;
    const dec = 11 * DEG;
    const H = (this.timeOfDay - 12) / 24 * TAU;
    this._skyDir(lat, dec, H, this._sunDir);

    // +0.5 so hour zero of day zero is a full moon: a brand-new game must not
    // open on a moonless week.
    const phase = (0.5 + (this._day + this.timeOfDay / 24) / 29.53) % 1;
    this._moonPhase = phase < 0 ? phase + 1 : phase;
    this._moonIllum = (1 - Math.cos(this._moonPhase * TAU)) * 0.5;
    this._skyDir(lat, 8 * DEG, H - this._moonPhase * TAU, this._moonDir);

    const sunY = this._sunDir.y;
    const moonY = this._moonDir.y;
    const dayF = smoothstep(-0.10, 0.24, sunY);
    this._dayF = dayF;
    const night = 1 - smoothstep(-0.16, 0.10, sunY);

    // ---- light colour: warm -> white -> warm -> out ------------------------
    const warm = smoothstep(0.30, -0.02, sunY);            // 1 at the horizon
    _c1.setRGB(1.0, 0.955, 0.895);                          // high sun
    _c2.setRGB(1.0, 0.66, 0.35);                            // golden hour
    _c3.setRGB(1.0, 0.34, 0.12);                            // last light
    this._sunColor.copy(_c1).lerp(_c2, smoothstep(0.0, 0.85, warm));
    this._sunColor.lerp(_c3, smoothstep(0.72, 1.0, warm));
    this._sunColor.multiply(p.sunTint);

    const sunI = 3.15 * smoothstep(-0.055, 0.20, sunY) * p.sun;
    this.sun.color.copy(this._sunColor);
    this.sun.intensity = sunI;

    this._moonColor.setRGB(0.60, 0.71, 1.0);
    const moonI = 0.50 * smoothstep(-0.05, 0.16, moonY) * (0.45 + 0.55 * this._moonIllum) * p.moon * (1 - dayF * 0.85);
    this.moon.color.copy(this._moonColor);
    this.moon.intensity = moonI;

    // ---- ambient: night stays blue and readable ---------------------------
    _c1.setHex(0x36568e); _c2.setHex(0x9dc4ff);
    this.hemi.color.copy(_c1).lerp(_c2, dayF);
    _c1.setHex(0x11182a); _c2.setHex(0x6b5a3e);
    this.hemi.groundColor.copy(_c1).lerp(_c2, dayF);
    this.hemi.intensity = lerp(0.86, 0.92, dayF) * p.hemi;

    // hell/cave override the ambient hue outright
    if (p.override > 0.001) {
      this.hemi.color.lerp(p.ovrHorizon, p.override * 0.88);
      this.hemi.groundColor.lerp(p.ovrZenith, p.override * 0.55);
      if (p.ash > 0.3) {
        _c1.setHex(0x8a2a12);
        this.hemi.color.lerp(_c1, p.override * 0.8);
      }
    }

    // ---- fog: same scattering solution as the dome ------------------------
    // Two samples just above the horizon — one toward the light, one away —
    // averaged into the aerial-perspective colour. Same maths as the dome, so
    // distant geometry always dissolves into exactly the sky behind it.
    const turb = p.turbidity;
    const sunUpF = smoothstep(-0.16, 0.05, sunY);
    const FOG_MUL = 0.45;
    scatterCPU(0.16, 0.80, sunY, turb, p.mieG, 34.0 * sunUpF, _c1);
    scatterCPU(0.16, -0.10, sunY, turb, p.mieG, 34.0 * sunUpF, _c2);
    _c1.add(_c2).multiplyScalar(0.5 * FOG_MUL);

    const moonUpF = smoothstep(-0.09, 0.07, moonY);
    scatterCPU(0.16, 0.5, moonY, turb, p.mieG, 0.75 * moonUpF, _c2);
    _c2.r *= 0.55; _c2.g *= 0.68;
    _c1.add(_c2);
    _c1.r += 0.0130 * night; _c1.g += 0.0180 * night; _c1.b += 0.0360 * night;

    if (p.grey > 0.001) {
      _c2.copy(p.greyColor).multiplyScalar(0.06 + 0.30 * dayF);
      _c1.lerp(_c2, p.grey);
    }
    if (p.override > 0.001) {
      _c2.copy(p.ovrHorizon).multiplyScalar(0.55);
      _c1.lerp(_c2, p.override);
    }
    if (p.fogTintAmt > 0.001) _c1.lerp(p.fogTint, p.fogTintAmt * 0.6);
    _c1.multiplyScalar(p.exposure);

    this.fogColor.copy(_c1);
    this.fog.color.copy(_c1);
    // The camera sits 13..42 units from the player, so anything past ~0.026
    // starts fogging the hero themselves. Clamp rather than trust the presets.
    const baseDensity = lerp(lerp(0.0125, 0.0058, dayF), 0.0072, clamp(p.override, 0, 1));
    this.fog.density = clamp(baseDensity * p.fogMul, 0, 0.026);

    // ---- dome uniforms ----------------------------------------------------
    const u = this._skyU;
    u.uSunDir.value.copy(this._sunDir);
    u.uMoonDir.value.copy(this._moonDir);
    u.uSunI.value = 34.0 * p.sun;
    u.uMoonI.value = 0.62 * p.moon * (0.25 + 0.75 * this._moonIllum);
    u.uTurbidity.value = turb;
    u.uMieG.value = p.mieG;
    u.uNight.value = night;
    u.uMilky.value = night * p.milky * p.star;
    u.uGround.value.copy(this.fogColor).multiplyScalar(0.85);
    u.uOverride.value = p.override;
    u.uOvrZenith.value.copy(p.ovrZenith);
    u.uOvrHorizon.value.copy(p.ovrHorizon);
    u.uGrey.value = p.grey;
    u.uGreyColor.value.copy(p.greyColor).multiplyScalar(0.05 + 0.28 * dayF);
    u.uExposure.value = p.exposure;
    u.uAsh.value = p.ash;
    u.uTime.value = t;
    u.uSunDisc.value = 1 - p.grey * 0.95;

    // star rotation (celestial sphere turning about a tilted pole)
    const ang = -(this.timeOfDay / 24) * TAU;
    this._stars.quaternion.setFromAxisAngle(this._starAxis, ang);
    _m4.makeRotationFromQuaternion(this._stars.quaternion);
    // world direction -> star space is the inverse (= transpose) of that rotation
    u.uStarRot.value.setFromMatrix4(_m4).transpose();

    // ---- follow the camera ------------------------------------------------
    this._dome.position.copy(camPos);
    this._dome.updateMatrix();
    this._dome.matrixWorldNeedsUpdate = true;
    this._clouds.position.copy(camPos);
    this._stars.position.copy(camPos);

    // ---- stars ------------------------------------------------------------
    const starA = smoothstep(0.08, -0.10, sunY) * p.star * (1 - p.grey * 0.92) * (1 - p.override * 0.9);
    this._starU.uOpacity.value = starA;
    this._starU.uTime.value = t;
    this._starU.uPixelRatio.value = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1;
    this._stars.visible = starA > 0.004;

    // ---- moon quad --------------------------------------------------------
    const moonA = smoothstep(-0.06, 0.05, moonY) * (1 - dayF * 0.82) * (1 - p.grey * 0.9) * (1 - p.override) * p.moon;
    this._moonMesh.visible = moonA > 0.005;
    if (this._moonMesh.visible) {
      _v2.copy(this._moonDir).multiplyScalar(this._radius * 0.9).add(camPos);
      this._moonMesh.position.copy(_v2);
      this._moonMesh.lookAt(camPos);
      this._moonMesh.updateMatrixWorld();
      _m3.setFromMatrix4(this._moonMesh.matrixWorld).invert();
      this._moonU.uLight.value.copy(this._sunDir).applyMatrix3(_m3).normalize();
      this._moonU.uOpacity.value = moonA;
      this._moonU.uGlow.value = 0.35 + 0.65 * this._moonIllum;
    }

    // ---- clouds -----------------------------------------------------------
    const cu = this._cloudU;
    cu.uTime.value = t;
    cu.uSunDir.value.copy(sunY > -0.02 || moonY < 0.02 ? this._sunDir : this._moonDir);
    _c2.copy(this._sunColor).multiplyScalar(0.55 + 1.15 * dayF);
    _c3.copy(this._moonColor).multiplyScalar(0.10 + 0.22 * this._moonIllum * smoothstep(-0.05, 0.2, moonY));
    _c2.lerp(_c3, clamp(1 - dayF * 4, 0, 1));
    cu.uSunColor.value.copy(_c2);
    cu.uSkyColor.value.copy(this.fogColor).multiplyScalar(1.7);
    cu.uCover.value = p.cover;
    cu.uLight.value = p.cloudLight;
    cu.uDark.value = p.cloudDark;
    cu.uOpacity.value = clamp(p.cover * 5, 0, 1) * (1 - p.override);
    cu.uWind.value.set(0.0042 * p.wind, 0.0017 * p.wind);
    this._clouds.visible = p.cover > 0.012 && p.override < 0.98;

    // ---- shadow rig -------------------------------------------------------
    this._updateShadows();
  }

  /** Elevation/azimuth solution for a body at hour angle H. Writes a unit dir. */
  _skyDir(lat, dec, H, out) {
    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    const cosEl = Math.cos(el);
    let az;
    const denom = cosEl * Math.cos(lat);
    if (Math.abs(denom) < 1e-5) {
      az = 0;
    } else {
      az = Math.acos(clamp((Math.sin(dec) - sinEl * Math.sin(lat)) / denom, -1, 1));
      let hh = H % TAU;
      if (hh < -Math.PI) hh += TAU;
      if (hh > Math.PI) hh -= TAU;
      if (hh > 0) az = TAU - az;   // afternoon: swing to the west
    }
    // azimuth measured from north (-Z) toward east (+X)
    out.set(Math.sin(az) * cosEl, Math.sin(el), -Math.cos(az) * cosEl);
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
    return out;
  }

  /**
   * Tight ortho frustum around the player, snapped to shadow-map texels so the
   * shadow edges do not crawl as the camera moves.
   */
  _updateShadows() {
    const engine = this.engine;
    const preset = engine.preset || {};
    const shadowsOn = preset.shadows !== false;

    // quality may have been cycled at runtime
    const want = preset.shadowMap || 2048;
    if (want !== this._shadowSize) {
      this._shadowSize = want;
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.mapSize.set(want, want);
      if (this._moonShadows) {
        if (this.moon.shadow.map) { this.moon.shadow.map.dispose(); this.moon.shadow.map = null; }
        const ms = Math.max(1024, want >> 1);
        this.moon.shadow.mapSize.set(ms, ms);
      }
    }

    const sunLit = shadowsOn && this.sun.intensity > 0.05;
    const moonLit = shadowsOn && this._moonShadows && !sunLit && this.moon.intensity > 0.06;
    this.sun.castShadow = sunLit;
    this.moon.castShadow = moonLit;

    // Frustum radius tracks the zoom so a wide camera still gets full coverage.
    const dist = engine.distance || 26;
    const r = clamp(dist * 0.72 + 4, 12, 34);
    if (Math.abs(r - this._shadowRadius) > 0.6) {
      this._shadowRadius = r;
      this._resizeFrustum(this.sun.shadow.camera, r);
      this._resizeFrustum(this.moon.shadow.camera, r);
    }

    const focus = engine.camTarget || _v1.set(0, 0, 0);
    if (sunLit) this._aimLight(this.sun, this.sunTarget, this._sunDir, focus, this._shadowRadius, this._shadowSize);
    if (moonLit) this._aimLight(this.moon, this.moonTarget, this._moonDir, focus, this._shadowRadius, Math.max(1024, this._shadowSize >> 1));
    if (!sunLit) {
      // keep the un-shadowed key roughly overhead so normals still read
      this.sunTarget.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(this._sunDir, 120);
    }
    if (!moonLit) {
      this.moonTarget.position.copy(focus);
      this.moon.position.copy(focus).addScaledVector(this._moonDir, 120);
    }
  }

  _resizeFrustum(c, r) {
    if (!c) return;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.near = 1; c.far = r * 2 + 150;
    c.updateProjectionMatrix();
  }

  _aimLight(light, target, dir, focus, radius, mapSize) {
    // build a light-space basis to quantise the focus point onto texels
    _v2.copy(dir).normalize();
    if (Math.abs(_v2.y) > 0.999) _v3.set(1, 0, 0); else _v3.set(0, 1, 0);
    _v4.copy(_v3).cross(_v2);
    if (_v4.lengthSq() < 1e-8) _v4.set(1, 0, 0);
    _v4.normalize();                 // right
    _v3.copy(_v2).cross(_v4).normalize();  // up

    const texel = (radius * 2) / Math.max(16, mapSize);
    const fx = Math.round(focus.dot(_v4) / texel) * texel;
    const fy = Math.round(focus.dot(_v3) / texel) * texel;
    const fz = focus.dot(_v2);
    _snap.set(0, 0, 0).addScaledVector(_v4, fx).addScaledVector(_v3, fy).addScaledVector(_v2, fz);

    target.position.copy(_snap);
    light.position.copy(_snap).addScaledVector(_v2, radius + 70);
  }

  /* ------------------------------------------------------------------ env */

  _refreshEnv() {
    if (!this._pmrem || this._disposed) return;
    let rt = null;
    try {
      rt = this._pmrem.fromScene(this._envScene, 0, 0.1, 60, { size: this._envSize });
    } catch (e) {
      console.warn('[sky] env map bake failed', e);
      this._pmrem = null;
      return;
    }
    if (!rt) return;
    const old = this._envRT;
    this._envRT = rt;
    this.envMap = rt.texture;
    if (old) old.dispose();

    this.scene.environment = this.envMap;
    const mats = this.ctx.materials;
    if (mats && typeof mats.setEnvironment === 'function') {
      mats.setEnvironment(this.envMap, this._envIntensityFor());
    }
    this._envDirty = false;
    this._bakeSunY = this._sunDir.y;
  }

  _envIntensityFor() {
    const p = this._params;
    if (p.override > 0.5) return 0.35;
    return lerp(0.55, 1.0, this._dayF);
  }

  /* -------------------------------------------------------------- dispose */

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this.scene.fog === this.fog) this.scene.fog = this._prevFog;
    if (this.scene.environment === this.envMap) this.scene.environment = null;

    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    });
    this._envScene.clear();

    for (const g of this._geoms) g.dispose();
    for (const m of this._mats) m.dispose();
    this._geoms.length = 0;
    this._mats.length = 0;

    if (this._envRT) { this._envRT.dispose(); this._envRT = null; }
    if (this._pmrem) { this._pmrem.dispose(); this._pmrem = null; }
    this.envMap = null;
  }
}

export default Sky;
