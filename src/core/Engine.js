import * as THREE from 'three';
import { CAMERA, QUALITY_PRESETS } from '../game/Config.js';

/**
 * Renderer + camera rig + frame timing. Owns nothing about gameplay; the Game
 * pushes a follow target each frame and Engine smooths the isometric rig onto
 * it, applies screen shake, and hands the frame to PostFX (if one is attached).
 */
export class Engine {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.quality = quality;
    this.preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.preset.taa,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = true;

    this.maxAniso = Math.min(
      this.preset.aniso,
      this.renderer.capabilities.getMaxAnisotropy?.() ?? 1
    );

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    /** Point the rig orbits. Game writes the player position here every frame. */
    this.camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this.yaw = CAMERA.yaw;
    this.pitch = CAMERA.pitch;
    this.distance = CAMERA.distance;
    this._distanceGoal = CAMERA.distance;

    this._shake = 0;
    this._shakeDecay = 1;
    this._shakeSeed = Math.random() * 1000;

    /** @type {import('../gfx/PostFX.js').PostFX|null} */
    this.postfx = null;

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.frame = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.snapCamera();
  }

  get size() {
    return { w: this.canvas.clientWidth || window.innerWidth, h: this.canvas.clientHeight || window.innerHeight };
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx?.setSize(w, h);
  }

  setQuality(q) {
    if (!QUALITY_PRESETS[q]) return;
    this.quality = q;
    this.preset = QUALITY_PRESETS[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.resize();
  }

  /** Nudge the zoom level; `ticks` is the signed wheel delta. */
  zoom(ticks) {
    this._distanceGoal = THREE.MathUtils.clamp(
      this._distanceGoal + ticks * 2.4, CAMERA.minDistance, CAMERA.maxDistance
    );
  }

  addShake(amount, decay = 3.2) {
    this._shake = Math.min(1.4, this._shake + amount);
    this._shakeDecay = decay;
  }

  /** Teleport the rig to its goal with no easing (map changes, respawns). */
  snapCamera() {
    this.distance = this._distanceGoal;
    this._camLook.copy(this.camTarget);
    this._applyCamera(0);
  }

  _applyCamera(shake) {
    const d = this.distance;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this._camPos.set(
      this._camLook.x + Math.sin(this.yaw) * cp * d,
      this._camLook.y + sp * d,
      this._camLook.z + Math.cos(this.yaw) * cp * d
    );

    if (shake > 0.0005) {
      const t = this.elapsed * 34 + this._shakeSeed;
      const m = shake * shake * 0.9;
      this._camPos.x += Math.sin(t * 1.7) * m;
      this._camPos.y += Math.sin(t * 2.3 + 1.7) * m * 0.7;
      this._camPos.z += Math.cos(t * 1.9 + 0.4) * m;
    }

    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);
  }

  /** Advance camera easing + shake. Call once per frame before render. */
  updateCamera(dt) {
    const k = 1 - Math.exp(-CAMERA.followLambda * dt);
    this._camLook.lerp(this.camTarget, k);
    this.distance += (this._distanceGoal - this.distance) * (1 - Math.exp(-6 * dt));
    if (this._shake > 0) this._shake = Math.max(0, this._shake - this._shakeDecay * dt);
    this._applyCamera(this._shake);
  }

  render(dt) {
    this.frame++;
    if (this.postfx) this.postfx.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

export default Engine;
