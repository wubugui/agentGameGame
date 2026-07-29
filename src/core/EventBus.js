/**
 * Tiny synchronous pub/sub. The whole game talks through this so subsystems
 * (combat, UI, audio, VFX) never need direct references to one another.
 */
class EventBus {
  constructor() { this._m = new Map(); }

  on(evt, fn) {
    let s = this._m.get(evt);
    if (!s) this._m.set(evt, (s = new Set()));
    s.add(fn);
    return () => this.off(evt, fn);
  }

  once(evt, fn) {
    const off = this.on(evt, (p) => { off(); fn(p); });
    return off;
  }

  off(evt, fn) {
    const s = this._m.get(evt);
    if (s) s.delete(fn);
  }

  emit(evt, payload) {
    const s = this._m.get(evt);
    if (!s) return;
    for (const fn of Array.from(s)) {
      try { fn(payload); } catch (e) { console.error(`[bus:${evt}]`, e); }
    }
  }

  clear() { this._m.clear(); }
}

export const bus = new EventBus();
export default bus;
