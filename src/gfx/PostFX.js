/**
 * src/gfx/PostFX.js — CONTRACTS §5
 *
 * TONE MAPPING OWNERSHIP (important, read before changing anything):
 * Engine.js sets `renderer.toneMapping = ACESFilmicToneMapping`. When a chain is
 * active every scene render goes into an off-screen HalfFloat target, and three
 * only applies the renderer's tone mapping when the destination is the default
 * framebuffer — so the renderer's setting would only kick in inside `OutputPass`,
 * *after* our grade had already run on raw HDR. That ordering makes the grade
 * fight the tone curve and is exactly how a chain ends up washed out.
 *
 * So PostFX takes ownership: it flips the renderer to `NoToneMapping` (restored
 * in dispose()) and performs the ACES fit itself, inside the single grade pass,
 * right where exposure/lift/gamma/gain/saturation belong. `OutputPass` is then
 * left as a pure sRGB encode. `renderer.toneMappingExposure` is still honoured —
 * it is read every frame and folded into the grade's exposure — so anything that
 * animates exposure keeps working.
 *
 * Chain
 *   ultra/high : Render -> GTAO(subtle) -> Bloom -> Grade -> SMAA -> Output
 *   med        : Render ->                 Bloom -> Grade -> SMAA -> Output
 *   low        : Render ->                 Bloom -> Grade -> Output -> FXAA
 * (SMAA wants linear input so it sits before OutputPass; FXAA wants sRGB so it
 *  sits after. Both facts come from the vendored passes' own docs.)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ========================================================================== *
 * Grade parameter block
 *
 * Packed flat so a grade change is a plain per-element lerp with no allocation.
 *   0 exposure   1 contrast   2 saturation   3 vignette   4 grain   5 aberration
 *   6..8 lift    9..11 gamma  12..14 gain    15 (spare)
 * ========================================================================== */

const P = {
  EXPOSURE: 0, CONTRAST: 1, SAT: 2, VIGNETTE: 3, GRAIN: 4, CA: 5,
  LIFT: 6, GAMMA: 9, GAIN: 12, LEN: 16,
};

function grade(exposure, contrast, sat, vig, grain, ca, lift, gamma, gain) {
  const a = new Float32Array(P.LEN);
  a[P.EXPOSURE] = exposure; a[P.CONTRAST] = contrast; a[P.SAT] = sat;
  a[P.VIGNETTE] = vig; a[P.GRAIN] = grain; a[P.CA] = ca;
  a[P.LIFT] = lift[0]; a[P.LIFT + 1] = lift[1]; a[P.LIFT + 2] = lift[2];
  a[P.GAMMA] = gamma[0]; a[P.GAMMA + 1] = gamma[1]; a[P.GAMMA + 2] = gamma[2];
  a[P.GAIN] = gain[0]; a[P.GAIN + 1] = gain[1]; a[P.GAIN + 2] = gain[2];
  return a;
}

/**
 * Mir2's palette memory is warm daylight, cold blue nights, and a sulphur-red
 * underworld. These are deliberately gentle: the look should read as "lit",
 * not as "filtered".
 */
const GRADES = {
  normal: grade(1.00, 1.020, 1.060, 0.34, 0.030, 0.0016,
    [0.000, 0.000, 0.000], [1.000, 1.000, 1.000], [1.030, 1.000, 0.972]),
  night: grade(0.94, 1.050, 0.840, 0.46, 0.055, 0.0022,
    [0.006, 0.010, 0.020], [1.020, 1.000, 0.960], [0.920, 0.970, 1.100]),
  cave: grade(0.90, 1.100, 0.800, 0.58, 0.070, 0.0026,
    [0.004, 0.008, 0.013], [1.050, 1.010, 0.970], [0.900, 0.975, 1.060]),
  hell: grade(1.02, 1.120, 1.100, 0.55, 0.050, 0.0032,
    [0.018, 0.004, 0.002], [0.960, 1.020, 1.060], [1.160, 0.940, 0.860]),
  dead: grade(0.72, 1.160, 0.050, 0.78, 0.090, 0.0040,
    [0.010, 0.008, 0.014], [1.100, 1.080, 1.040], [0.860, 0.860, 0.920]),
};

/* ========================================================================== *
 * The one grade pass. Exposure, ACES, lift/gamma/gain, saturation, contrast,
 * vignette, edge chromatic aberration, dark-biased grain, danger pulse and
 * screen flash — a single fullscreen draw, not six.
 * ========================================================================== */

const GradeShader = {
  name: 'MirGradeShader',

  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uVignette: { value: 0.34 },
    uGrain: { value: 0.03 },
    uAberration: { value: 0.0016 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uFlash: { value: 0 },
    uDanger: { value: 0 },
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,

  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2  uResolution;
    uniform float uTime;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform vec3  uLift;
    uniform vec3  uGamma;
    uniform vec3  uGain;
    uniform vec3  uFlashColor;
    uniform float uFlash;
    uniform float uDanger;

    varying vec2 vUv;

    const vec3 LUMA = vec3( 0.2125, 0.7154, 0.0721 );
    const float GAMMA = 2.2;
    const float INV_GAMMA = 0.4545454545;

    // Same RRT/ODT fit three's ACESFilmicToneMapping uses, so emissive values
    // authored against the renderer's curve land where their authors expect.
    const mat3 ACES_IN = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777
    );
    const mat3 ACES_OUT = mat3(
       1.60475, -0.10208, -0.00327,
      -0.53108,  1.10813, -0.07276,
      -0.07367, -0.00605,  1.07602
    );

    vec3 rrtOdtFit( vec3 v ) {
      vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
      vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
      return a / b;
    }

    vec3 filmic( vec3 c ) {
      c = ACES_IN * c;
      c = rrtOdtFit( c );
      c = ACES_OUT * c;
      return clamp( c, 0.0, 1.0 );
    }

    float hash21( vec2 p ) {
      p = fract( p * vec2( 443.8975, 397.2973 ) );
      p += dot( p, p.yx + 19.19 );
      return fract( ( p.x + p.y ) * p.y );
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot( c, c );

      // Very subtle lateral aberration: zero in the middle, a fraction of a
      // pixel at the corners. Three taps, always — branching costs more here.
      vec2 off = c * ( uAberration * r2 * 2.0 );
      vec3 col;
      col.r = texture2D( tDiffuse, vUv + off ).r;
      col.g = texture2D( tDiffuse, vUv ).g;
      col.b = texture2D( tDiffuse, vUv - off ).b;

      // ---- tone mapping (owned here; the renderer is on NoToneMapping) -----
      col = max( col, 0.0 ) * ( uExposure / 0.6 );
      col = filmic( col );

      // Everything below is a *grade*, and a grade belongs in a perceptual
      // space. Contrast-about-0.5 or a vignette applied to linear light eats
      // the shadows alive (a mid-blue loses a third of its value). Step into
      // approximate display gamma, grade there, step back out — OutputPass
      // still owns the real sRGB encode, and the round trip is lossless for
      // a neutral grade.
      col = pow( clamp( col, 0.0, 1.0 ), vec3( INV_GAMMA ) );

      // ---- lift / gamma / gain --------------------------------------------
      col = col * uGain + uLift * ( 1.0 - col );
      col = pow( max( col, 0.0 ), uGamma );

      // ---- saturation + contrast ------------------------------------------
      float l = dot( col, LUMA );
      col = mix( vec3( l ), col, uSaturation );
      col = ( col - 0.5 ) * uContrast + 0.5;
      col = max( col, 0.0 );

      // ---- low-HP danger: red rim that breathes ---------------------------
      if ( uDanger > 0.0 ) {
        float pulse = 0.58 + 0.42 * sin( uTime * 6.2831 * 1.15 );
        float d = uDanger * pulse;
        float rim = smoothstep( 0.10, 0.62, r2 * 2.0 );
        float dl = dot( col, LUMA );
        vec3 bleed = mix( col, vec3( dl ), 0.45 * d );
        bleed = mix( bleed, vec3( 0.52, 0.015, 0.02 ), rim * 0.85 * d );
        col = mix( col, bleed, clamp( d, 0.0, 1.0 ) );
      }

      // ---- vignette --------------------------------------------------------
      float vig = 1.0 - uVignette * pow( smoothstep( 0.06, 0.52, r2 ), 1.35 );
      col *= vig;

      // ---- screen flash ----------------------------------------------------
      col += uFlashColor * uFlash;

      // ---- grain, heavier in the shadows where film actually grains --------
      if ( uGrain > 0.0 ) {
        float g = hash21( vUv * uResolution + fract( uTime ) * 137.31 );
        float lum = dot( col, LUMA );
        col += ( g - 0.5 ) * uGrain * ( 1.0 - smoothstep( 0.0, 0.55, lum ) );
      }

      // back to linear so OutputPass's sRGB transfer lands where we intended
      col = pow( clamp( col, 0.0, 1.0 ), vec3( GAMMA ) );

      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

/* ========================================================================== */

const _lerp = (a, b, k) => a + (b - a) * k;

export class PostFX {
  /**
   * @param {import('../core/Engine.js').Engine} engine
   * @param {{quality?:'low'|'med'|'high'|'ultra'}} [opts]
   */
  constructor(engine, { quality = 'high' } = {}) {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.quality = quality;
    this.preset = engine.preset || {};
    this._disposed = false;

    // We own tone mapping from here on. Remember what Engine wanted so a later
    // dispose() (map teardown, quality rebuild) leaves the renderer as found.
    this._savedToneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;

    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this._w = w;
    this._h = h;
    this._pixelRatio = this.renderer.getPixelRatio();

    // ---- state driven by gameplay ----------------------------------------
    this._time = 0;
    this._flashColor = new THREE.Color(1, 1, 1);
    this._flash = 0;
    this._flashRate = 4;
    this._danger = 0;
    this._dangerGoal = 0;

    this._cur = new Float32Array(P.LEN);
    this._from = new Float32Array(P.LEN);
    this._to = new Float32Array(P.LEN);
    this._cur.set(GRADES.normal);
    this._from.set(GRADES.normal);
    this._to.set(GRADES.normal);
    this._blend = 1;        // 0..1 progress from _from to _to
    this._blendRate = 0;    // 1/seconds; 0 == snapped
    this.gradeName = 'normal';
    this._warned = new Set();

    this._buildChain();
    this.setSize(w, h);
    this._pushUniforms();
  }

  /* ------------------------------------------------------------------ chain */

  _buildChain() {
    const q = this.quality;
    const hi = (q === 'high' || q === 'ultra');
    const ultra = (q === 'ultra');
    const wantAO = hi && this.preset.ssao !== false;
    const wantBloom = this.preset.bloom !== false;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this._pixelRatio);

    /** Every pass we constructed, in order, so dispose() can free them all. */
    this._passes = [];

    this.renderPass = new RenderPass(this.scene, this.camera);
    this._add(this.renderPass);

    // ---- ambient occlusion (subtle: contact shading, never a grey wash) ----
    this.aoPass = null;
    if (wantAO) {
      try {
        this.aoPass = new GTAOPass(this.scene, this.camera, this._w, this._h);
        this.aoPass.output = GTAOPass.OUTPUT.Default;
        this.aoPass.blendIntensity = ultra ? 0.55 : 0.45;
        this.aoPass.updateGtaoMaterial({
          radius: 0.45,
          distanceExponent: 1.4,
          thickness: 0.6,
          scale: 0.72,
          samples: ultra ? 16 : 8,
          distanceFallOff: 1.0,
          screenSpaceRadius: false,
        });
        this.aoPass.updatePdMaterial({
          lumaPhi: 8, depthPhi: 2.2, normalPhi: 3.2,
          radius: ultra ? 8 : 5, rings: 2, samples: ultra ? 16 : 8,
        });
        this._add(this.aoPass);
      } catch (e) {
        console.warn('[PostFX] GTAO unavailable, continuing without AO', e);
        this.aoPass = null;
      }
    }

    // ---- bloom: torches, lava, runes and eyes only ------------------------
    this.bloomPass = null;
    if (wantBloom) {
      const strength = ultra ? 0.52 : hi ? 0.44 : q === 'med' ? 0.38 : 0.32;
      // radius kept tight: a wide kernel turns every magic shell into a solid
      // ball of light and hazes the whole frame
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this._w, this._h), strength, 0.42, 0.85
      );
      this._add(this.bloomPass);
    }

    // ---- the one grade pass ------------------------------------------------
    // ShaderPass deep-clones the template uniforms, so each pass owns its own
    // Vector2/Vector3/Color instances — safe to mutate in place every frame.
    this.gradePass = new ShaderPass(GradeShader);
    this._u = this.gradePass.material.uniforms;
    this._u.uResolution.value.set(this._w, this._h);
    this._add(this.gradePass);

    // ---- AA + output -------------------------------------------------------
    this.smaaPass = null;
    this.fxaaPass = null;
    if (hi) {
      // SMAA operates in linear-srgb, so it must precede OutputPass.
      this.smaaPass = new SMAAPass();
      this._add(this.smaaPass);
      this.outputPass = new OutputPass();
      this._add(this.outputPass);
    } else {
      // FXAA needs sRGB input, so it follows OutputPass.
      this.outputPass = new OutputPass();
      this._add(this.outputPass);
      this.fxaaPass = new FXAAPass();
      this._add(this.fxaaPass);
    }
  }

  _add(pass) {
    this._passes.push(pass);
    this.composer.addPass(pass);
  }

  _teardownChain() {
    if (!this.composer) return;
    for (const p of this._passes) {
      try { p.dispose?.(); } catch (e) { /* a pass without dispose is fine */ }
    }
    this._passes.length = 0;
    this.composer.dispose();
    this.composer = null;
  }

  /* ------------------------------------------------------------------ sizing */

  setSize(w, h) {
    if (this._disposed) return;
    const W = Math.max(1, Math.floor(w || window.innerWidth));
    const H = Math.max(1, Math.floor(h || window.innerHeight));
    this._w = W; this._h = H;

    const pr = this.renderer.getPixelRatio();
    if (pr !== this._pixelRatio) {
      this._pixelRatio = pr;
      this.composer.setPixelRatio(pr);   // this re-runs setSize internally
    }
    this.composer.setSize(W, H);

    const res = this._u && this._u.uResolution.value;
    if (res) res.set(W * pr, H * pr);
  }

  /** Rebuild the chain for a new quality tier. Safe to call at any time. */
  setQuality(quality) {
    if (this._disposed || quality === this.quality) return;
    this.quality = quality;
    this.preset = this.engine.preset || this.preset;
    this._teardownChain();
    this._buildChain();
    this.setSize(this._w, this._h);
    this._pushUniforms();
  }

  /* ---------------------------------------------------------------- controls */

  /**
   * Screen flash. Additive, decays linearly to nothing over `seconds`.
   * Stacking flashes take the brightest and the fastest decay.
   */
  flash(color = 0xffffff, strength = 1, seconds = 0.25) {
    if (this._disposed) return;
    const s = Math.max(0, Math.min(3, strength));
    if (s <= 0) return;
    const rate = s / Math.max(0.02, seconds);
    if (s >= this._flash) {
      // the brighter flash wins outright: its colour and its own decay
      this._flashColor.setHex(color >>> 0, THREE.SRGBColorSpace);
      this._flash = s;
      this._flashRate = rate;
    } else {
      // a dimmer one can only make the existing flash clear faster
      this._flashRate = Math.max(this._flashRate, rate);
    }
  }

  /** 0..1 red vignette pulse when the player is low on HP. */
  setDanger(v) {
    if (this._disposed) return;
    const n = typeof v === 'number' && isFinite(v) ? v : 0;
    this._dangerGoal = n < 0 ? 0 : n > 1 ? 1 : n;
  }

  /** Blend to a named look. `seconds <= 0` snaps. */
  setGrade(name, seconds = 0.6) {
    if (this._disposed) return;
    const key = String(name || 'normal');
    const g = GRADES[key];
    if (!g) {
      if (!this._warned.has(key)) {
        this._warned.add(key);
        console.warn(`[PostFX] unknown grade '${key}' — using 'normal'`);
      }
      return this.setGrade('normal', seconds);
    }
    this.gradeName = key;
    this._from.set(this._cur);
    this._to.set(g);
    if (!(seconds > 0)) {
      this._cur.set(g);
      this._blend = 1;
      this._blendRate = 0;
      this._pushUniforms();
    } else {
      this._blend = 0;
      this._blendRate = 1 / seconds;
    }
    return undefined;
  }

  /* ------------------------------------------------------------------- frame */

  /**
   * Game calls this from its fixed step. All timing actually advances in
   * render(), which runs every frame including while paused, so this is a
   * deliberate no-op — advancing here too would double every decay rate.
   */
  update() { /* intentionally empty — see render(dt) */ }

  render(dt) {
    if (this._disposed || !this.composer) return;
    const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(Math.max(dt, 0), 0.1) : 0.0166;
    this._advance(d);
    this.composer.render(d);
  }

  _advance(dt) {
    this._time += dt;
    if (this._time > 3600) this._time -= 3600;

    if (this._flash > 0) {
      this._flash -= this._flashRate * dt;
      if (this._flash <= 0) { this._flash = 0; this._flashRate = 4; }
    }

    if (this._danger !== this._dangerGoal) {
      const k = 1 - Math.exp(-6 * dt);
      this._danger += (this._dangerGoal - this._danger) * k;
      if (Math.abs(this._danger - this._dangerGoal) < 0.002) this._danger = this._dangerGoal;
    }

    if (this._blend < 1) {
      this._blend = Math.min(1, this._blend + this._blendRate * dt);
      // smoothstep so a grade change eases in and out instead of ramping
      const t = this._blend * this._blend * (3 - 2 * this._blend);
      const a = this._from, b = this._to, c = this._cur;
      for (let i = 0; i < P.LEN; i++) c[i] = _lerp(a[i], b[i], t);
    }

    this._pushUniforms();
  }

  _pushUniforms() {
    const u = this._u;
    if (!u) return;
    const c = this._cur;
    // Engine's exposure knob is still honoured; PostFX just applies it.
    u.uExposure.value = c[P.EXPOSURE] * (this.renderer.toneMappingExposure || 1);
    u.uContrast.value = c[P.CONTRAST];
    u.uSaturation.value = c[P.SAT];
    u.uVignette.value = c[P.VIGNETTE];
    u.uGrain.value = c[P.GRAIN];
    u.uAberration.value = c[P.CA];
    u.uLift.value.set(c[P.LIFT], c[P.LIFT + 1], c[P.LIFT + 2]);
    u.uGamma.value.set(c[P.GAMMA], c[P.GAMMA + 1], c[P.GAMMA + 2]);
    u.uGain.value.set(c[P.GAIN], c[P.GAIN + 1], c[P.GAIN + 2]);
    u.uFlashColor.value.copy(this._flashColor);
    u.uFlash.value = this._flash * 0.85;
    u.uDanger.value = this._danger;
    u.uTime.value = this._time;
  }

  /* ----------------------------------------------------------------- teardown */

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._teardownChain();
    this.renderer.toneMapping = this._savedToneMapping;
    this._u = null;
    this.renderPass = this.aoPass = this.bloomPass = null;
    this.gradePass = this.smaaPass = this.fxaaPass = this.outputPass = null;
  }
}

export default PostFX;
