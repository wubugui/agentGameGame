import * as THREE from 'three';
import bus from './EventBus.js';

/**
 * Mouse + keyboard. Mir2 is a click-to-move game: left click walks / attacks,
 * right click (held) runs, number keys fire skills. We raycast against a
 * caller-supplied list of pickables and publish high-level intents on the bus.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.ndc = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    this.keys = new Set();
    this.mouseDown = [false, false, false];
    this.hover = null;         // entity currently under the cursor
    this.wheelDelta = 0;
    this.pointerInside = false;

    /** @type {{ground:THREE.Object3D[], entities:THREE.Object3D[]}} */
    this.pickables = { ground: [], entities: [] };
    this._listeners = [];

    this._bind();
  }

  _bind() {
    const c = this.canvas;
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push(() => target.removeEventListener(type, fn, opts));
    };
    const upd = (e) => {
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.screen = { x: e.clientX, y: e.clientY };
    };

    listen(c, 'pointerenter', () => (this.pointerInside = true));
    listen(c, 'pointerleave', () => (this.pointerInside = false));
    listen(c, 'pointermove', upd);

    listen(c, 'pointerdown', (e) => {
      upd(e);
      c.setPointerCapture?.(e.pointerId);
      this.mouseDown[e.button] = true;
      bus.emit('input:down', { button: e.button, ndc: this.ndc.clone(), shift: e.shiftKey, alt: e.altKey });
    });

    listen(window, 'pointerup', (e) => {
      this.mouseDown[e.button] = false;
      bus.emit('input:up', { button: e.button });
    });

    listen(c, 'contextmenu', (e) => e.preventDefault());

    listen(c, 'wheel', (e) => {
      e.preventDefault();
      this.wheelDelta += Math.sign(e.deltaY);
    }, { passive: false });

    listen(window, 'keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!e.repeat) bus.emit('input:key', { code: e.code, key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey });
      this.keys.add(e.code);
      // Stop the browser stealing our hotkeys.
      if (/^(F1|F2|F3|F4|F5|F6|F7|F8|Tab|Space)$/.test(e.code) || e.code.startsWith('Digit')) e.preventDefault();
    });

    listen(window, 'keyup', (e) => this.keys.delete(e.code));
    listen(window, 'blur', () => { this.keys.clear(); this.mouseDown.fill(false); });
  }

  isDown(code) { return this.keys.has(code); }
  get running() { return this.mouseDown[2] || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  /** Consume accumulated wheel ticks (positive == zoom out). */
  takeWheel() { const w = this.wheelDelta; this.wheelDelta = 0; return w; }

  /**
   * Raycast the cursor into the world.
   * @returns {{point:THREE.Vector3|null, entity:object|null, object:THREE.Object3D|null}}
   */
  pick(camera) {
    this.raycaster.setFromCamera(this.ndc, camera);

    let entity = null;
    const eh = this.raycaster.intersectObjects(this.pickables.entities, true);
    for (const h of eh) {
      let o = h.object;
      while (o && !o.userData.entity) o = o.parent;
      if (o && o.userData.entity && o.userData.entity.selectable !== false) { entity = o.userData.entity; break; }
    }

    let point = null, object = null;
    const gh = this.raycaster.intersectObjects(this.pickables.ground, true);
    if (gh.length) { point = gh[0].point.clone(); object = gh[0].object; }

    return { point, entity, object };
  }

  dispose() {
    for (const off of this._listeners.splice(0)) off();
    this.keys.clear();
    this.mouseDown.fill(false);
    this.pickables.ground = [];
    this.pickables.entities = [];
  }
}

export default Input;
