/**
 * src/audio/Audio.js — 100% WebAudio synthesis.
 *
 * No sample files, no fetches, no decodeAudioData. Every sound in the game is
 * built here out of oscillators, procedurally filled noise buffers, biquad
 * filters and a convolver whose impulse response is itself generated
 * (exponentially decaying, air-absorbed noise).
 *
 * Graph
 *   voice ─┬─────────────────────────────────► bus(sfx|music|ambience) ─┐
 *          └─ send ─► roomSend ─► convolver ─► roomReturn ──────────────┤
 *                                                                       ▼
 *                                            master ─► compressor ─► destination
 *
 * The room send is raised in dungeon/cave/hell ambiences and the impulse
 * response is swapped for a longer, darker one, so the same sword hit reads as
 * "stone corridor" underground and "open street" in town.
 *
 * Timing: music and ambience events are scheduled AHEAD on the WebAudio clock.
 * A wall-clock pump (recursive setTimeout, never setInterval) only decides when
 * to *schedule more*; it never decides when a note sounds, so main-thread jank
 * cannot make the score stutter.
 *
 * Contract note (§16): the contract signature is `constructor()`. We accept an
 * optional options bag purely for quality hints; calling `new Audio()` with no
 * arguments is the supported path and is what Game.js does.
 */

import { CAMERA } from '../game/Config.js';

// ---------------------------------------------------------------------------
// Musical material
// ---------------------------------------------------------------------------

/** 宫调 pentatonic (do re mi sol la) — the bright mode for town/field. */
const PENTA_MAJOR = [0, 2, 4, 7, 9];
/** 羽调 pentatonic (la do re mi sol) — the minor colour for dungeon/boss/death. */
const PENTA_MINOR = [0, 3, 5, 7, 10];

/**
 * Score configuration per music id. `beat` is seconds per step; a bar is 8
 * steps. Everything else biases the generative layers.
 */
const TRACKS = {
  town: {
    root: 196.00,           // G3 — warm, low, unhurried
    scale: PENTA_MAJOR, beat: 0.62, swing: 0.06,
    drone: { gain: 0.055, fifth: true, cutoff: 420 },
    pluck: { chance: 0.55, gain: 0.20, damp: 0.9965, octaves: [0, 12], dur: 2.4 },
    flute: { chance: 0.16, gain: 0.10, dur: 1.5, octave: 12 },
    drum: null,
    room: 0.10, master: 1.0,
  },
  field: {
    root: 220.00,           // A3 — open and sparse
    scale: PENTA_MAJOR, beat: 0.78, swing: 0.0,
    drone: { gain: 0.035, fifth: true, cutoff: 520 },
    pluck: { chance: 0.32, gain: 0.17, damp: 0.9968, octaves: [0, 12, 12], dur: 2.8 },
    flute: { chance: 0.20, gain: 0.11, dur: 2.1, octave: 12 },
    drum: null,
    room: 0.09, master: 0.92,
  },
  dungeon: {
    root: 146.83,           // D3 — minor and tense
    scale: PENTA_MINOR, beat: 0.56, swing: 0.0,
    drone: { gain: 0.075, fifth: false, cutoff: 240, detune: 11 },
    pluck: { chance: 0.34, gain: 0.16, damp: 0.9955, octaves: [0, 0, 12], dur: 2.0 },
    flute: { chance: 0.14, gain: 0.085, dur: 1.7, octave: 12 },
    drum: { pattern: [0.9, 0, 0, 0.35, 0, 0, 0.5, 0], gain: 0.20, tune: 96 },
    room: 0.34, master: 0.95,
  },
  boss: {
    root: 130.81,           // C3 — heavier, faster, percussive
    scale: PENTA_MINOR, beat: 0.36, swing: 0.0,
    drone: { gain: 0.09, fifth: false, cutoff: 200, detune: 17 },
    pluck: { chance: 0.5, gain: 0.19, damp: 0.994, octaves: [0, 0, 12], dur: 1.5 },
    flute: { chance: 0.1, gain: 0.09, dur: 1.1, octave: 12 },
    drum: { pattern: [1.0, 0.3, 0.55, 0.3, 0.85, 0.3, 0.6, 0.45], gain: 0.26, tune: 84 },
    room: 0.30, master: 1.0,
  },
  death: {
    root: 110.00,           // A2 — a slow lament, almost no pulse
    scale: PENTA_MINOR, beat: 1.55, swing: 0.0,
    drone: { gain: 0.06, fifth: false, cutoff: 180, detune: 6 },
    pluck: { chance: 0.30, gain: 0.15, damp: 0.997, octaves: [0, 12], dur: 3.4 },
    flute: { chance: 0.45, gain: 0.115, dur: 3.0, octave: 12, descend: true },
    drum: null,
    room: 0.42, master: 0.9,
  },
};

/**
 * Ambience beds. `layers` are continuous; `events` are one-shots re-scheduled
 * on the audio clock with a randomised gap so they never fall into a pattern.
 */
const AMBIENCES = {
  town: {
    room: 'hall', send: 0.10,
    layers: ['breeze.soft', 'chatter'],
    events: [['blacksmith', 5.5, 13], ['bird', 6, 16], ['dog', 22, 60]],
  },
  field: {
    room: 'hall', send: 0.08,
    layers: ['wind', 'insects'],
    events: [['bird', 3.5, 11], ['gust', 9, 22]],
  },
  desert: {
    room: 'hall', send: 0.07,
    layers: ['wind.dry'],
    events: [['gust', 5, 13], ['grit', 7, 18]],
  },
  dungeon: {
    room: 'cave', send: 0.36,
    layers: ['rumble', 'breeze.hollow'],
    events: [['drip', 2.2, 7], ['groan', 14, 38], ['scuttle', 9, 26]],
  },
  cave: {
    room: 'cave', send: 0.42,
    layers: ['rumble', 'breeze.hollow'],
    events: [['drip', 1.4, 4.5], ['groan', 16, 44], ['scuttle', 7, 20]],
  },
  hell: {
    room: 'cave', send: 0.34,
    layers: ['rumble', 'firebed'],
    events: [['crackle', 0.9, 3.2], ['boom', 10, 26], ['groan', 12, 30]],
  },
};

/** Concurrent-voice ceiling per quality tier — the cheapest way to degrade. */
const VOICE_CAP = { low: 20, med: 30, high: 44, ultra: 60 };

/** Minimum seconds between two firings of the same sfx id (anti machine-gun). */
const THROTTLE = {
  'walk.grass': 0.11, 'walk.stone': 0.11, 'walk.sand': 0.11,
  'sword.hit': 0.045, 'sword.swing': 0.05, 'monster.hit': 0.05,
  'ui.click': 0.03, 'coin': 0.04, 'loot': 0.05,
};

const MAX_AUDIBLE = 56;      // world units past which a positional sfx is culled
const LOOKAHEAD = 0.85;      // seconds of music/ambience scheduled ahead
const PUMP_MS = 110;         // wall-clock pump interval

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Audio {
  constructor(opts = {}) {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** True once a real AudioContext exists. Everything no-ops until then. */
    this.ok = false;
    this.quality = opts.quality || 'high';

    this.buses = { sfx: null, music: null, ambience: null };
    this.volumes = { master: 0.75, sfx: 0.9, music: 0.34, ambience: 0.42 };

    // Listener state — written every frame by Game, never allocates.
    this._lx = 0; this._ly = 0; this._lz = 0; this._facing = 0;
    this._panYaw = CAMERA.yaw;

    this._tracks = [];           // active music tracks (>1 only while crossfading)
    this._musicId = null;
    this._bed = null;            // active ambience bed
    this._retiring = null;       // previous bed, still fading out
    this._ambienceId = null;
    this._pendingMusic = null;
    this._pendingAmbience = null;

    this._white = null;
    this._brown = null;
    this._ir = { hall: null, cave: null };
    this._roomKind = 'hall';
    this._roomAmount = 0.12;
    this._ks = new Map();        // Karplus-Strong buffer cache
    this._ksKeys = [];

    this._voices = 0;
    this._last = new Map();      // id -> last start time (throttle)
    this._warned = new Set();
    this._timer = null;
    this._roomTimer = null;
    this._stepFlip = false;
    this._gestureHooks = null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Build the graph. Must be called from a user gesture — before that the page
   * is silent, and if the browser has no AudioContext at all we stay silent
   * forever without ever throwing.
   */
  unlock() {
    if (this.ok) { this._resume(); return this; }
    try {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return this;
      const c = new AC({ latencyHint: 'interactive' });
      this.ctx = c;

      // master -> compressor/limiter -> destination
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -10;
      this.comp.knee.value = 8;
      this.comp.ratio.value = 8;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.22;
      this.comp.connect(c.destination);

      this.master = c.createGain();
      this.master.gain.value = this.volumes.master;
      this.master.connect(this.comp);

      for (const name of ['sfx', 'music', 'ambience']) {
        const g = c.createGain();
        g.gain.value = this.volumes[name];
        g.connect(this.master);
        this.buses[name] = g;
      }

      // Procedural reverb: generated IR, one shared send bus.
      this.roomSend = c.createGain();
      this.roomSend.gain.value = this._roomAmount;
      this.convolver = c.createConvolver();
      this.convolver.normalize = true;
      this.convolver.buffer = this._impulse('hall');
      this.roomReturn = c.createGain();
      this.roomReturn.gain.value = 1.0;
      // Tame the send's top end so the tail sits behind the dry signal.
      this.roomTone = c.createBiquadFilter();
      this.roomTone.type = 'lowpass';
      this.roomTone.frequency.value = 5200;
      this.roomSend.connect(this.roomTone);
      this.roomTone.connect(this.convolver);
      this.convolver.connect(this.roomReturn);
      this.roomReturn.connect(this.master);

      this._white = this._noiseBuffer(4.0, 'white');
      this._brown = this._noiseBuffer(6.0, 'brown');

      this.ok = true;
      this._resume();
      this._startPump();

      // Anything requested before the gesture landed gets applied now.
      if (this._pendingMusic) { const m = this._pendingMusic; this._pendingMusic = null; this.music(m.id, m.opts); }
      if (this._pendingAmbience) { const a = this._pendingAmbience; this._pendingAmbience = null; this.ambience(a.id, a.opts); }
    } catch (e) {
      this.ok = false;
      console.warn('[audio] WebAudio unavailable, running silent:', e && e.message);
    }
    return this;
  }

  /** Some browsers still hand back a suspended context; retry on next gesture. */
  _resume() {
    const c = this.ctx;
    if (!c) return;
    try { if (c.state === 'suspended') c.resume(); } catch { /* ignore */ }
    if (c.state === 'suspended' && !this._gestureHooks && typeof window !== 'undefined') {
      const kick = () => { try { c.resume(); } catch { /* ignore */ } this._dropGestureHooks(); };
      this._gestureHooks = kick;
      window.addEventListener('pointerdown', kick, { once: true, passive: true });
      window.addEventListener('keydown', kick, { once: true });
    }
  }

  _dropGestureHooks() {
    if (!this._gestureHooks || typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', this._gestureHooks);
    window.removeEventListener('keydown', this._gestureHooks);
    this._gestureHooks = null;
  }

  /** Optional runtime quality change — only affects polyphony head-room. */
  setQuality(q) { this.quality = q || 'high'; }

  // -------------------------------------------------------------------------
  // Generated buffers
  // -------------------------------------------------------------------------

  /** @param {'white'|'brown'} kind */
  _noiseBuffer(seconds, kind) {
    const c = this.ctx, n = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      if (kind === 'brown') {
        let last = 0;
        for (let i = 0; i < n; i++) {
          last = (last + (Math.random() * 2 - 1) * 0.06) * 0.996;
          d[i] = clamp(last * 3.2, -1, 1);
        }
      } else {
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
    }
    return b;
  }

  /**
   * Impulse response: sparse early reflections followed by exponentially
   * decaying noise pushed through a one-pole whose cutoff falls with time
   * (cheap air/wall absorption). 'cave' is longer, darker and more diffuse.
   */
  _impulse(kind) {
    if (this._ir[kind]) return this._ir[kind];
    const c = this.ctx;
    const long = kind === 'cave';
    const seconds = long ? (this.quality === 'low' ? 2.4 : 3.4) : (this.quality === 'low' ? 1.3 : 1.9);
    const decay = long ? 3.1 : 3.8;
    const n = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(2, n, c.sampleRate);
    const sr = c.sampleRate;

    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0, lp2 = 0;
      const spread = ch === 0 ? 1.0 : 1.07;             // decorrelate the channels
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // cutoff coefficient falls from bright to dull across the tail
        const k = (long ? 0.30 : 0.46) * (1 - t * 0.75);
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * k;
        lp2 += (lp - lp2) * k;
        d[i] = lp2 * Math.pow(1 - t, decay) * spread;
      }
      // Early reflections: a handful of discrete taps in the first ~90 ms.
      const taps = long ? 9 : 6;
      for (let j = 0; j < taps; j++) {
        const delay = Math.floor(sr * (0.006 + Math.random() * (long ? 0.11 : 0.055)));
        if (delay < n) d[delay] += (Math.random() * 2 - 1) * (long ? 0.55 : 0.42) * (1 - j / taps);
      }
      // Normalise so swapping IRs does not jump the level.
      let peak = 0;
      for (let i = 0; i < n; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
      if (peak > 0) { const s = 0.85 / peak; for (let i = 0; i < n; i++) d[i] *= s; }
    }
    this._ir[kind] = b;
    return b;
  }

  /**
   * Karplus-Strong plucked string — the guzheng/pipa colour. Rendering is
   * O(sampleRate * duration) so buffers are cached by pitch; the scale is
   * fixed, which means the cache warms up within a couple of bars.
   */
  _ksBuffer(freq, dur, damp) {
    const key = `${Math.round(freq * 2)}|${dur.toFixed(1)}|${damp.toFixed(4)}`;
    const hit = this._ks.get(key);
    if (hit) return hit;

    const c = this.ctx, sr = c.sampleRate;
    const n = Math.max(64, Math.floor(sr * dur));
    const N = Math.max(2, Math.round(sr / freq));
    const line = new Float32Array(N);

    // Excitation: noise burst rolled off so the attack is woody, not hissy,
    // plus a pick-position comb that thins the even partials.
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * 0.55;
      line[i] = lp;
    }
    const pick = Math.floor(N * 0.22);
    for (let i = N - 1; i >= pick; i--) line[i] -= line[i - pick] * 0.6;

    const out = new Float32Array(n);
    let idx = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      const cur = line[idx];
      out[i] = cur;
      const nxt = line[(idx + 1) % N];
      const avg = (cur + nxt) * 0.5 * damp;
      prev += (avg - prev) * 0.82;                   // string damping
      line[idx] = prev;
      idx = (idx + 1) % N;
    }

    // Body envelope + fade-out so the buffer never ends on a click.
    const fade = Math.min(n, Math.floor(sr * 0.12));
    let peak = 0;
    for (let i = 0; i < n; i++) {
      out[i] *= Math.pow(1 - i / n, 0.45);
      const a = out[i] < 0 ? -out[i] : out[i];
      if (a > peak) peak = a;
    }
    for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
    if (peak > 0) { const s = 0.9 / peak; for (let i = 0; i < n; i++) out[i] *= s; }

    const buf = c.createBuffer(1, n, sr);
    buf.getChannelData(0).set(out);
    this._ks.set(key, buf);
    this._ksKeys.push(key);
    if (this._ksKeys.length > 48) {
      const old = this._ksKeys.shift();
      this._ks.delete(old);
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  // Low-level voice helpers
  // -------------------------------------------------------------------------

  _rand(a, b) { return a + Math.random() * (b - a); }

  /** StereoPanner where available, silent pass-through gain where not. */
  _panner(pan) {
    const c = this.ctx;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan || 0, -1, 1);
      return p;
    }
    const g = c.createGain();
    g.gain.value = 1;
    return g;
  }

  /** Percussive envelope: linear attack, exponential decay, hard zero after. */
  _perc(param, t0, peak, attack, decay, hold = 0) {
    const p = Math.max(0.0002, peak);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(p, t0 + attack);
    if (hold > 0) param.setValueAtTime(p, t0 + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
    param.setValueAtTime(0, t0 + attack + hold + decay + 0.002);
    return t0 + attack + hold + decay + 0.01;
  }

  /** Book-keeping for polyphony + node teardown. */
  _own(src, stopAt, tail) {
    this._voices++;
    try { src.stop(stopAt); } catch { /* already scheduled */ }
    src.onended = () => {
      this._voices--;
      try { src.disconnect(); } catch { /* gone */ }
      if (tail) { try { tail.disconnect(); } catch { /* gone */ } }
    };
  }

  /** True when we should drop a low-priority sound to protect the frame. */
  _busy() { return this._voices > (VOICE_CAP[this.quality] || 44); }

  _dest(name) { return this.buses[name] || this.buses.sfx; }

  /** Attach a reverb send from `node` at `amount`. */
  _send(node, amount) {
    if (!(amount > 0)) return;
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.roomSend);
  }

  /**
   * Filtered noise burst. `f0 -> f1` is a filter sweep across the burst, which
   * is what makes a swing sound like air and a hit sound like meat.
   */
  _noise(o) {
    const c = this.ctx;
    const t0 = o.t0;
    const dur = Math.max(0.01, o.dur || 0.2);
    const src = c.createBufferSource();
    src.buffer = o.brown ? this._brown : this._white;
    src.loop = true;
    // Random read offset so two bursts never share the same noise.
    const off = Math.random() * (src.buffer.duration - dur - 0.05);
    if (o.rate) src.playbackRate.value = o.rate;

    const flt = c.createBiquadFilter();
    flt.type = o.type || 'bandpass';
    flt.frequency.setValueAtTime(clamp(o.f0 || 1200, 20, 20000), t0);
    if (o.f1 && o.f1 !== o.f0) {
      flt.frequency.exponentialRampToValueAtTime(clamp(o.f1, 20, 20000), t0 + dur * (o.sweep || 1));
    }
    flt.Q.value = o.q == null ? 1 : o.q;

    const amp = c.createGain();
    const end = this._perc(amp.gain, t0, o.gain == null ? 0.3 : o.gain,
      o.attack == null ? 0.004 : o.attack, dur, o.hold || 0);

    const pan = this._panner(o.pan);
    src.connect(flt);
    flt.connect(amp);
    amp.connect(pan);
    pan.connect(this._dest(o.dest || 'sfx'));
    this._send(amp, o.send);

    src.start(t0, Math.max(0, off));
    this._own(src, end + 0.02, pan);
    return amp;
  }

  /** Single oscillator with an optional glide and vibrato. */
  _tone(o) {
    const c = this.ctx;
    const t0 = o.t0;
    const dur = Math.max(0.02, o.dur || 0.3);
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(clamp(o.freq, 8, 20000), t0);
    if (o.to && o.to !== o.freq) {
      osc.frequency.exponentialRampToValueAtTime(clamp(o.to, 8, 20000), t0 + dur * (o.sweep || 1));
    }
    if (o.detune) osc.detune.value = o.detune;

    const amp = c.createGain();
    const end = this._perc(amp.gain, t0, o.gain == null ? 0.2 : o.gain,
      o.attack == null ? 0.006 : o.attack, dur, o.hold || 0);

    let head = amp;
    if (o.tone) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = clamp(o.tone, 60, 20000);
      amp.connect(lp);
      head = lp;
    }
    const pan = this._panner(o.pan);
    osc.connect(amp);
    head.connect(pan);
    pan.connect(this._dest(o.dest || 'sfx'));
    this._send(amp, o.send);

    let lfo = null, lfoGain = null;
    if (o.vibrato) {
      lfo = c.createOscillator();
      lfo.frequency.value = o.vibrato.rate || 5.2;
      lfoGain = c.createGain();
      lfoGain.gain.value = o.vibrato.depth || 4;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      lfo.start(t0);
      try { lfo.stop(end + 0.02); } catch { /* ignore */ }
      lfo.onended = () => { try { lfo.disconnect(); lfoGain.disconnect(); } catch { /* gone */ } };
    }

    osc.start(t0);
    this._own(osc, end + 0.02, pan);
    return amp;
  }

  /** Inharmonic partial stack — struck/ringing metal. */
  _metal(o) {
    const ratios = o.ratios || [1, 2.41, 3.86, 5.12, 6.73];
    const base = o.freq;
    const dur = o.dur || 0.5;
    for (let i = 0; i < ratios.length; i++) {
      const f = base * ratios[i] * (1 + (Math.random() - 0.5) * 0.012);
      if (f > 16000) continue;
      this._tone({
        t0: o.t0 + i * 0.0015,
        freq: f,
        dur: dur * Math.pow(0.72, i),
        type: i === 0 ? 'triangle' : 'sine',
        gain: (o.gain || 0.2) / (1 + i * 1.15),
        pan: o.pan,
        send: o.send,
        dest: o.dest,
        attack: 0.002,
      });
    }
  }

  /** Low-end body: a fast downward sine sweep. Fireball landings, drums, doors. */
  _thump(o) {
    return this._tone({
      t0: o.t0,
      freq: o.f0 || 150,
      to: o.f1 || 45,
      dur: o.dur || 0.35,
      type: o.type || 'sine',
      gain: o.gain == null ? 0.35 : o.gain,
      attack: 0.003,
      sweep: o.sweep || 0.7,
      pan: o.pan,
      send: o.send,
      dest: o.dest,
    });
  }

  /** Cached Karplus-Strong pluck played back with a hair of pitch drift. */
  _pluck(o) {
    const c = this.ctx;
    const buf = this._ksBuffer(o.freq, o.dur || 2.0, o.damp || 0.996);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.006;

    const amp = c.createGain();
    amp.gain.setValueAtTime(o.gain == null ? 0.2 : o.gain, o.t0);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.bright || 3800;
    const pan = this._panner(o.pan);

    src.connect(amp);
    amp.connect(lp);
    lp.connect(pan);
    pan.connect(this._dest(o.dest || 'music'));
    this._send(amp, o.send == null ? 0.24 : o.send);

    src.start(o.t0);
    this._own(src, o.t0 + buf.duration + 0.02, pan);
    return amp;
  }

  /**
   * Breathy bamboo flute (笛/箫): a high-Q band of noise at the pitch, an octave
   * band above it, and a weak sine to pin the fundamental — plus vibrato.
   */
  _flute(o) {
    const c = this.ctx;
    const t0 = o.t0, dur = o.dur || 1.4;
    const f = o.freq;
    const g = o.gain == null ? 0.1 : o.gain;

    const src = c.createBufferSource();
    src.buffer = this._white;
    src.loop = true;

    const b1 = c.createBiquadFilter();
    b1.type = 'bandpass'; b1.frequency.value = f; b1.Q.value = 16;
    const b2 = c.createBiquadFilter();
    b2.type = 'bandpass'; b2.frequency.value = f * 2; b2.Q.value = 11;

    const air = c.createGain();
    air.gain.value = 1.0;
    const amp = c.createGain();
    const atk = Math.min(0.2, dur * 0.28);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), t0 + atk);
    amp.gain.setValueAtTime(Math.max(0.0002, g), t0 + dur * 0.62);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const pan = this._panner(o.pan);
    src.connect(b1); b1.connect(air);
    src.connect(b2); b2.connect(air);
    air.connect(amp);
    amp.connect(pan);
    pan.connect(this._dest(o.dest || 'music'));
    this._send(amp, o.send == null ? 0.3 : o.send);

    // Vibrato on the formant bands, slightly delayed like a real player.
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.6 + Math.random() * 1.2;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0.0001, t0);
    lg.gain.linearRampToValueAtTime(f * 0.012, t0 + dur * 0.5);
    lfo.connect(lg);
    lg.connect(b1.frequency);
    lfo.start(t0);
    try { lfo.stop(t0 + dur + 0.05); } catch { /* ignore */ }
    lfo.onended = () => { try { lfo.disconnect(); lg.disconnect(); } catch { /* gone */ } };

    // Weak sine core for pitch definition.
    this._tone({
      t0, freq: f, dur, type: 'sine', gain: g * 0.42, attack: atk,
      pan: o.pan, dest: o.dest || 'music', send: 0.2,
    });

    const off = Math.random() * (src.buffer.duration - dur - 0.1);
    src.start(t0, Math.max(0, off));
    this._own(src, t0 + dur + 0.05, pan);
  }

  /** Frame drum (腰鼓): membrane tone plus a skin slap. */
  _drum(o) {
    const t = o.tune || 92;
    this._tone({
      t0: o.t0, freq: t * 1.9, to: t * 0.62, dur: o.dur || 0.34,
      type: 'sine', gain: o.gain || 0.22, attack: 0.002, sweep: 0.35,
      pan: o.pan, dest: o.dest || 'music', send: o.send == null ? 0.28 : o.send,
    });
    this._noise({
      t0: o.t0, dur: 0.075, type: 'bandpass', f0: 1500, f1: 480, q: 0.9,
      gain: (o.gain || 0.22) * 0.55, pan: o.pan, dest: o.dest || 'music',
      send: (o.send == null ? 0.28 : o.send) * 0.5,
    });
  }

  /**
   * Creature voice: two or three moving formants of noise over a detuned growl
   * pair. `scale` shifts every frequency, which is how one routine covers a
   * chicken and a 赤月恶魔.
   */
  _growl(o) {
    const c = this.ctx;
    const t0 = o.t0, dur = o.dur || 0.5, s = o.scale || 1, g = o.gain == null ? 0.3 : o.gain;
    const forms = o.formants || [520, 1180, 2450];

    const src = c.createBufferSource();
    src.buffer = this._white;
    src.loop = true;
    const amp = c.createGain();
    const end = this._perc(amp.gain, t0, g, o.attack == null ? 0.012 : o.attack, dur, o.hold || 0);
    const pan = this._panner(o.pan);
    amp.connect(pan);
    pan.connect(this._dest(o.dest || 'sfx'));
    this._send(amp, o.send);

    for (let i = 0; i < forms.length; i++) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      const fr = clamp(forms[i] * s, 40, 16000);
      f.frequency.setValueAtTime(fr, t0);
      f.frequency.exponentialRampToValueAtTime(clamp(fr * (o.bend || 0.62), 40, 16000), t0 + dur);
      f.Q.value = 6 + i * 2;
      const fg = c.createGain();
      fg.gain.value = 1 / (1 + i * 0.6);
      src.connect(f); f.connect(fg); fg.connect(amp);
    }

    src.start(t0, Math.random() * 2.5);
    this._own(src, end + 0.03, pan);

    // Vocal-fold growl: two detuned saws dropping in pitch.
    const base = (o.pitch || 120) * s;
    this._tone({
      t0, freq: base, to: base * (o.bend || 0.62), dur: dur * 1.05, type: 'sawtooth',
      gain: g * 0.42, tone: clamp(base * 9, 200, 6000), pan: o.pan, send: o.send,
      dest: o.dest, vibrato: { rate: 17 + Math.random() * 9, depth: 30 },
    });
    this._tone({
      t0, freq: base * 1.01, to: base * (o.bend || 0.62) * 0.99, dur: dur * 0.9, type: 'sawtooth',
      gain: g * 0.24, tone: clamp(base * 7, 200, 6000), pan: o.pan, dest: o.dest,
    });
  }

  // -------------------------------------------------------------------------
  // Spatialisation
  // -------------------------------------------------------------------------

  /**
   * Distance gain + stereo pan computed by hand. The camera is a fixed-yaw
   * isometric rig, so panning follows *screen* space (camera yaw) rather than
   * the avatar's facing — otherwise the whole stereo field would spin every
   * time the player turned on the spot. `facing` still matters: sources behind
   * the character are rolled off slightly, which is the cue that actually
   * reads. Cheaper than a PannerNode per voice and no listener bookkeeping.
   *
   * Writes into a reusable struct — no allocation on the call path.
   */
  _spatial(pos) {
    const dx = pos.x - this._lx, dz = pos.z - this._lz;
    const dy = (pos.y || 0) - this._ly;
    const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (d > MAX_AUDIBLE) return null;
    const s = this._sp || (this._sp = { gain: 1, pan: 0, tone: 1 });
    s.gain = 1 / (1 + (d / 7.5) * (d / 7.5) * 0.55 + d * 0.045);
    if (d > 0.001) {
      const cy = Math.cos(this._panYaw), sy = Math.sin(this._panYaw);
      // Camera right vector on the ground plane is (cos yaw, -sin yaw).
      const right = (dx * cy - dz * sy) / d;
      s.pan = clamp(right * 0.85, -1, 1);
      // Behind the listener: a touch duller.
      const fwd = (dx * Math.sin(this._facing) + dz * Math.cos(this._facing)) / d;
      s.tone = clamp(0.78 + fwd * 0.22, 0.6, 1) * clamp(1 - d / (MAX_AUDIBLE * 1.6), 0.42, 1);
    } else {
      s.pan = 0; s.tone = 1;
    }
    return s;
  }

  // -------------------------------------------------------------------------
  // SFX
  // -------------------------------------------------------------------------

  /**
   * @param {string} id
   * @param {{pos?:{x:number,y?:number,z:number}, volume?:number, rate?:number}} [opts]
   */
  sfx(id, { pos = null, volume = 1, rate = 1 } = {}) {
    if (!this.ok || !id) return;
    const c = this.ctx;
    const now = c.currentTime;

    const gap = THROTTLE[id];
    if (gap) {
      const last = this._last.get(id) || -99;
      if (now - last < gap) return;
      this._last.set(id, now);
    }

    let g = volume * this._rand(0.84, 1.12);   // level jitter on EVERY call
    let r = rate * this._rand(0.94, 1.07);     // pitch jitter on EVERY call
    let pan = 0, tone = 1;

    if (pos) {
      const s = this._spatial(pos);
      if (!s) return;
      g *= s.gain; pan = s.pan; tone = s.tone;
      if (g < 0.012) return;
    }
    if (this._busy() && id.indexOf('walk.') === 0) return;

    const t0 = now + 0.004;
    const send = this._roomAmount > 0.2 ? 1.35 : 1.0;   // dungeons wash more
    this._emit(id, t0, g, r, pan, tone, send);
  }

  /** The actual synthesis table. Kept out of sfx() so throttling stays cheap. */
  _emit(id, t0, g, r, pan, tone, roomMul) {
    const T = (v) => clamp(v * tone, 40, 18000);
    switch (id) {

      // ---- melee -------------------------------------------------------
      case 'sword.swing': {
        // Air moving past a blade: broad noise with a fast downward sweep.
        this._noise({ t0, dur: 0.26, type: 'bandpass', f0: T(3600 * r), f1: T(420 * r), q: 1.6, gain: 0.24 * g, pan, attack: 0.03, sweep: 0.85 });
        this._noise({ t0: t0 + 0.02, dur: 0.16, type: 'highpass', f0: T(1800 * r), f1: T(700 * r), q: 0.7, gain: 0.09 * g, pan: pan * 0.7 });
        break;
      }
      case 'sword.hit': {
        // Metallic inharmonic transient sitting under a wet noise thwack.
        this._metal({ t0, freq: 430 * r, ratios: [1, 2.37, 3.91, 5.44], dur: 0.2, gain: 0.24 * g, pan, send: 0.16 * roomMul });
        this._noise({ t0, dur: 0.1, type: 'bandpass', f0: T(1700 * r), f1: T(340), q: 0.85, gain: 0.42 * g, pan, attack: 0.001 });
        this._thump({ t0, f0: 190 * r, f1: 70, dur: 0.14, gain: 0.22 * g, pan });
        break;
      }
      case 'sword.block': {
        // Bright ringing metal, long tail, plenty of room.
        this._metal({ t0, freq: 940 * r, ratios: [1, 2.71, 4.13, 5.9, 7.4], dur: 0.85, gain: 0.22 * g, pan, send: 0.34 * roomMul });
        this._noise({ t0, dur: 0.05, type: 'highpass', f0: T(4200), f1: T(2600), q: 0.8, gain: 0.28 * g, pan, attack: 0.001 });
        break;
      }
      case 'bow.shoot': {
        this._noise({ t0, dur: 0.05, type: 'bandpass', f0: T(2400 * r), f1: T(900), q: 3.2, gain: 0.3 * g, pan, attack: 0.001 });
        this._tone({ t0, freq: 340 * r, to: 190, dur: 0.13, type: 'triangle', gain: 0.16 * g, pan });
        this._noise({ t0: t0 + 0.03, dur: 0.22, type: 'bandpass', f0: T(1400), f1: T(4200), q: 1.4, gain: 0.07 * g, pan, attack: 0.05 });
        break;
      }

      // ---- magic -------------------------------------------------------
      case 'fire.cast': {
        // Rising filtered noise gathering into a low thump.
        this._noise({ t0, dur: 0.46, type: 'bandpass', f0: T(260), f1: T(2900 * r), q: 1.3, gain: 0.24 * g, pan, attack: 0.09, send: 0.16 * roomMul });
        this._tone({ t0, freq: 90 * r, to: 220 * r, dur: 0.42, type: 'sawtooth', gain: 0.1 * g, tone: 900, pan });
        this._thump({ t0: t0 + 0.4, f0: 170, f1: 52, dur: 0.26, gain: 0.26 * g, pan, send: 0.2 * roomMul });
        break;
      }
      case 'fire.hit': {
        this._noise({ t0, dur: 0.4, type: 'lowpass', f0: T(3600), f1: T(180), q: 0.9, gain: 0.42 * g, pan, attack: 0.004, send: 0.24 * roomMul });
        this._thump({ t0, f0: 150 * r, f1: 42, dur: 0.42, gain: 0.34 * g, pan, send: 0.2 * roomMul });
        // Crackle: three short high bursts scattered through the tail.
        for (let i = 0; i < 3; i++) {
          this._noise({ t0: t0 + 0.05 + Math.random() * 0.3, dur: 0.035, type: 'bandpass', f0: T(this._rand(2200, 5200)), f1: T(1400), q: 4, gain: 0.12 * g, pan: pan + this._rand(-0.15, 0.15) });
        }
        break;
      }
      case 'ice.cast': {
        const base = 1250 * r;
        for (let i = 0; i < 4; i++) {
          this._tone({ t0: t0 + i * 0.035, freq: base * (1 + i * 0.5), to: base * (1 + i * 0.5) * 1.18, dur: 0.5 - i * 0.07, type: 'triangle', gain: 0.1 * g / (1 + i * 0.5), pan, send: 0.3 * roomMul });
        }
        this._noise({ t0, dur: 0.5, type: 'highpass', f0: T(2600), f1: T(7000), q: 0.8, gain: 0.1 * g, pan, attack: 0.08, send: 0.3 * roomMul });
        break;
      }
      case 'thunder': {
        // Broadband crack, then a long rumble pushed hard into the convolver.
        this._noise({ t0, dur: 0.06, type: 'highpass', f0: T(2600), f1: T(1600), q: 0.5, gain: 0.62 * g, pan, attack: 0.0008 });
        this._noise({ t0: t0 + 0.005, dur: 0.22, type: 'bandpass', f0: T(900), f1: T(260), q: 0.6, gain: 0.46 * g, pan, attack: 0.002, send: 0.5 });
        this._noise({ t0: t0 + 0.06, dur: 2.6, type: 'lowpass', f0: 620, f1: 55, q: 0.7, gain: 0.4 * g, pan: pan * 0.4, attack: 0.05, brown: true, send: 0.95 });
        this._tone({ t0: t0 + 0.05, freq: 62, to: 28, dur: 2.2, type: 'sine', gain: 0.2 * g, pan: 0, send: 0.6 });
        break;
      }
      case 'heal': {
        // Soft consonant bell arpeggio, all inside one pentatonic chord.
        const root = 523.25 * r;
        const steps = [0, 4, 7, 12];
        for (let i = 0; i < steps.length; i++) {
          const f = root * Math.pow(2, steps[i] / 12);
          this._tone({ t0: t0 + i * 0.075, freq: f, dur: 0.75 - i * 0.08, type: 'sine', gain: 0.14 * g, attack: 0.02, pan, send: 0.4 * roomMul });
          this._tone({ t0: t0 + i * 0.075, freq: f * 2.01, dur: 0.35, type: 'sine', gain: 0.05 * g, attack: 0.01, pan, send: 0.35 * roomMul });
        }
        break;
      }
      case 'poison': {
        this._noise({ t0, dur: 0.55, type: 'bandpass', f0: T(640), f1: T(190), q: 4.5, gain: 0.2 * g, pan, attack: 0.05, send: 0.2 * roomMul });
        for (let i = 0; i < 4; i++) {
          this._tone({ t0: t0 + i * this._rand(0.06, 0.13), freq: this._rand(180, 420), to: this._rand(90, 160), dur: 0.09, type: 'sine', gain: 0.1 * g, pan });
        }
        break;
      }
      case 'summon': {
        const root = 196 * r;
        [0, 7, 12, 19].forEach((st, i) => {
          this._tone({ t0: t0 + i * 0.07, freq: root * Math.pow(2, st / 12), dur: 0.9, type: 'triangle', gain: 0.13 * g, attack: 0.05, pan, send: 0.45 * roomMul });
        });
        this._noise({ t0, dur: 0.8, type: 'bandpass', f0: T(300), f1: T(2400), q: 2.4, gain: 0.11 * g, pan, attack: 0.25, send: 0.45 * roomMul });
        break;
      }

      // ---- feedback ----------------------------------------------------
      case 'levelup': {
        // Ascending fanfare that actually resolves onto the octave.
        const root = 392 * r;
        const line = [0, 4, 7, 12, 16, 19];
        for (let i = 0; i < line.length; i++) {
          const f = root * Math.pow(2, line[i] / 12);
          this._tone({ t0: t0 + i * 0.085, freq: f, dur: 0.4, type: 'triangle', gain: 0.16 * g, attack: 0.008, send: 0.3 });
          this._tone({ t0: t0 + i * 0.085, freq: f * 1.004, dur: 0.4, type: 'sawtooth', gain: 0.05 * g, tone: 2600, send: 0.3 });
        }
        const hold = t0 + line.length * 0.085;
        [0, 7, 12].forEach((st, i) => {
          this._tone({ t0: hold, freq: root * Math.pow(2, (st + 12) / 12), dur: 1.5, type: 'triangle', gain: 0.13 * g / (1 + i * 0.4), attack: 0.02, send: 0.5 });
        });
        this._metal({ t0: hold, freq: root * 2, ratios: [1, 2.76, 5.4], dur: 1.6, gain: 0.09 * g, send: 0.5 });
        break;
      }
      case 'coin': {
        const n = 2 + (Math.random() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const f = this._rand(1900, 2900) * r;
          this._metal({ t0: t0 + i * this._rand(0.035, 0.07), freq: f, ratios: [1, 2.13, 3.4], dur: 0.16, gain: 0.11 * g, pan, send: 0.18 * roomMul });
        }
        break;
      }
      case 'loot': {
        this._tone({ t0, freq: 720 * r, to: 1180 * r, dur: 0.22, type: 'triangle', gain: 0.14 * g, pan, send: 0.2 * roomMul });
        this._noise({ t0, dur: 0.18, type: 'bandpass', f0: T(1600), f1: T(4200), q: 2.2, gain: 0.09 * g, pan, attack: 0.03 });
        break;
      }
      case 'potion': {
        this._tone({ t0, freq: 900 * r, to: 260, dur: 0.07, type: 'sine', gain: 0.25 * g, pan, sweep: 0.6 });   // cork
        for (let i = 0; i < 4; i++) {
          this._tone({ t0: t0 + 0.09 + i * this._rand(0.05, 0.1), freq: this._rand(320, 620), to: this._rand(180, 300), dur: 0.07, type: 'sine', gain: 0.1 * g, pan });
        }
        this._noise({ t0: t0 + 0.08, dur: 0.3, type: 'bandpass', f0: T(700), f1: T(1900), q: 3, gain: 0.09 * g, pan, attack: 0.06 });
        break;
      }
      case 'door': {
        // Timber creak: a resonant saw whose filter wanders, then a stone thud.
        this._noise({ t0, dur: 0.62, type: 'bandpass', f0: T(420 * r), f1: T(880 * r), q: 9, gain: 0.16 * g, pan, attack: 0.12, send: 0.3 * roomMul });
        this._tone({ t0: t0 + 0.03, freq: 128 * r, to: 96, dur: 0.55, type: 'sawtooth', gain: 0.07 * g, tone: 700, pan, vibrato: { rate: 7.5, depth: 45 } });
        this._thump({ t0: t0 + 0.6, f0: 120, f1: 46, dur: 0.3, gain: 0.26 * g, pan, send: 0.35 * roomMul });
        break;
      }
      case 'portal': {
        const base = 180 * r;
        for (let i = 0; i < 3; i++) {
          this._tone({ t0: t0 + i * 0.05, freq: base * (1 + i * 0.34), to: base * (1 + i * 0.34) * 3.1, dur: 0.9, type: 'sine', gain: 0.12 * g, attack: 0.15, pan: pan + this._rand(-0.3, 0.3), send: 0.55 * roomMul, vibrato: { rate: 6, depth: 20 } });
        }
        this._noise({ t0, dur: 1.0, type: 'bandpass', f0: T(400), f1: T(3600), q: 2.0, gain: 0.14 * g, pan, attack: 0.3, send: 0.6 * roomMul });
        this._thump({ t0: t0 + 0.85, f0: 140, f1: 40, dur: 0.4, gain: 0.2 * g, pan, send: 0.4 });
        break;
      }
      case 'ui.click': {
        this._noise({ t0, dur: 0.028, type: 'bandpass', f0: 2600, f1: 1500, q: 2.5, gain: 0.14 * g, attack: 0.001 });
        this._tone({ t0, freq: 1450, dur: 0.05, type: 'triangle', gain: 0.05 * g, attack: 0.001 });
        break;
      }
      case 'ui.error': {
        this._tone({ t0, freq: 260, dur: 0.09, type: 'square', gain: 0.07 * g, tone: 1600 });
        this._tone({ t0: t0 + 0.1, freq: 185, dur: 0.19, type: 'square', gain: 0.07 * g, tone: 1400 });
        break;
      }

      // ---- footsteps ---------------------------------------------------
      case 'walk.grass': {
        const p = pan + (this._stepFlip ? 0.07 : -0.07);
        this._stepFlip = !this._stepFlip;
        this._noise({ t0, dur: this._rand(0.05, 0.09), type: 'bandpass', f0: T(this._rand(1500, 2400) * r), f1: T(700), q: 1.5, gain: this._rand(0.07, 0.12) * g, pan: p, attack: 0.002 });
        this._noise({ t0: t0 + 0.012, dur: 0.05, type: 'lowpass', f0: T(420), f1: T(180), q: 0.7, gain: 0.06 * g, pan: p });
        break;
      }
      case 'walk.stone': {
        const p = pan + (this._stepFlip ? 0.07 : -0.07);
        this._stepFlip = !this._stepFlip;
        this._noise({ t0, dur: this._rand(0.035, 0.06), type: 'bandpass', f0: T(this._rand(2200, 3400) * r), f1: T(1200), q: 2.4, gain: this._rand(0.08, 0.13) * g, pan: p, attack: 0.001, send: 0.22 * roomMul });
        this._thump({ t0, f0: 190 * r, f1: 92, dur: 0.07, gain: 0.09 * g, pan: p });
        break;
      }
      case 'walk.sand': {
        const p = pan + (this._stepFlip ? 0.06 : -0.06);
        this._stepFlip = !this._stepFlip;
        this._noise({ t0, dur: this._rand(0.07, 0.12), type: 'lowpass', f0: T(this._rand(900, 1500) * r), f1: T(380), q: 0.6, gain: this._rand(0.06, 0.1) * g, pan: p, attack: 0.012 });
        break;
      }

      // ---- creatures ---------------------------------------------------
      case 'monster.hit': {
        this._growl({ t0, dur: 0.22, scale: r, pitch: 150, formants: [480, 1050, 2100], gain: 0.3 * g, pan, send: 0.18 * roomMul, bend: 0.6 });
        this._noise({ t0, dur: 0.1, type: 'lowpass', f0: T(1100), f1: T(240), q: 0.8, gain: 0.24 * g, pan, attack: 0.002 });
        break;
      }
      case 'monster.die': {
        this._growl({ t0, dur: 0.7, scale: r, pitch: 165, formants: [430, 980, 1900], gain: 0.32 * g, pan, send: 0.3 * roomMul, bend: 0.35, attack: 0.03 });
        this._noise({ t0: t0 + 0.25, dur: 0.5, type: 'lowpass', f0: T(900), f1: T(140), q: 0.9, gain: 0.16 * g, pan, attack: 0.1, send: 0.3 * roomMul });
        this._thump({ t0: t0 + 0.5, f0: 110, f1: 40, dur: 0.3, gain: 0.16 * g, pan, send: 0.3 * roomMul });
        break;
      }
      case 'boss.roar': {
        const s = r * 0.55;                       // bosses are big and slow
        this._growl({ t0, dur: 1.7, scale: s, pitch: 78, formants: [340, 760, 1500], gain: 0.5 * g, pan, send: 0.6, bend: 0.5, attack: 0.08, hold: 0.35 });
        this._noise({ t0, dur: 1.9, type: 'lowpass', f0: 480, f1: 90, q: 0.8, gain: 0.24 * g, pan: pan * 0.5, attack: 0.15, brown: true, send: 0.7 });
        this._tone({ t0, freq: 42, to: 26, dur: 2.0, type: 'sine', gain: 0.24 * g, pan: 0, send: 0.4 });
        break;
      }

      default: {
        if (!this._warned.has(id)) {
          this._warned.add(id);
          console.warn(`[audio] unknown sfx id '${id}' — using fallback`);
        }
        this._noise({ t0, dur: 0.1, type: 'bandpass', f0: T(1300 * r), f1: T(600), q: 1.2, gain: 0.12 * g, pan });
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Music — generative, scheduled ahead on the audio clock
  // -------------------------------------------------------------------------

  /**
   * Cross-fade to a generative track. Ids: town|field|dungeon|boss|death.
   * @param {string} id
   * @param {{fade?:number}} [opts]
   */
  music(id, { fade = 2 } = {}) {
    if (!this.ok) { this._pendingMusic = { id, opts: { fade } }; return; }
    if (this._musicId === id) return;
    this._musicId = id;

    const now = this.ctx.currentTime;
    for (const tr of this._tracks) this._fadeTrack(tr, fade, now);

    const cfg = TRACKS[id];
    if (!cfg) {
      if (!this._warned.has(`m:${id}`)) {
        this._warned.add(`m:${id}`);
        console.warn(`[audio] unknown music id '${id}' — falling back to 'field'`);
      }
      this._tracks.push(this._buildTrack('field', TRACKS.field, fade, now));
      return;
    }
    this._tracks.push(this._buildTrack(id, cfg, fade, now));
  }

  _buildTrack(id, cfg, fade, now) {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(Math.max(0.02, cfg.master || 1), now + Math.max(0.05, fade));
    out.connect(this.buses.music);

    const tr = {
      id, cfg, out, nodes: [],
      next: now + 0.12,
      step: 0,
      mel: 2,                        // index into the scale, random-walked
      endAt: Infinity,
      dead: false,
    };

    // Drone: two slow detuned oscillators through a breathing lowpass.
    if (cfg.drone) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cfg.drone.cutoff || 320;
      lp.Q.value = 1.2;
      const dg = c.createGain();
      dg.gain.value = cfg.drone.gain;
      lp.connect(dg);
      dg.connect(out);
      this._send(dg, 0.35);

      const mk = (freq, det, type) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = det;
        o.connect(lp);
        o.start(now);
        tr.nodes.push(o);
        return o;
      };
      mk(cfg.root * 0.5, 0, 'sawtooth');
      mk(cfg.root * 0.5, cfg.drone.detune || 5, 'triangle');
      if (cfg.drone.fifth) mk(cfg.root * 0.75, -4, 'sine');

      // Slow filter breathing so the pad never sits still.
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.045 + Math.random() * 0.03;
      const lg = c.createGain();
      lg.gain.value = (cfg.drone.cutoff || 320) * 0.35;
      lfo.connect(lg);
      lg.connect(lp.frequency);
      lfo.start(now);
      tr.nodes.push(lfo, lg, lp, dg);
    }

    return tr;
  }

  _fadeTrack(tr, fade, now) {
    if (tr.dead) return;
    const f = Math.max(0.05, fade);
    try {
      tr.out.gain.cancelScheduledValues(now);
      tr.out.gain.setValueAtTime(Math.max(0.0001, tr.out.gain.value), now);
      tr.out.gain.exponentialRampToValueAtTime(0.0001, now + f);
    } catch { /* ignore */ }
    tr.endAt = now + f;
  }

  _killTrack(tr) {
    tr.dead = true;
    for (const n of tr.nodes) {
      try { if (n.stop) n.stop(); } catch { /* not a source */ }
      try { n.disconnect(); } catch { /* gone */ }
    }
    tr.nodes.length = 0;
    try { tr.out.disconnect(); } catch { /* gone */ }
  }

  /** Schedule every layer of one track up to `horizon` on the audio clock. */
  _scheduleTrack(tr, horizon) {
    const cfg = tr.cfg;
    const scale = cfg.scale;
    // If the tab was backgrounded the pump falls behind; skip forward rather
    // than dumping a bar of notes into the past all at once.
    const now = horizon - LOOKAHEAD;
    if (tr.next < now) tr.next = now + 0.05;
    let guard = 0;
    while (tr.next < horizon && ++guard < 64) {
      const s = tr.step;
      const swing = (s % 2 === 1 ? (cfg.swing || 0) * cfg.beat : 0);
      const t = tr.next + swing;
      if (t > tr.endAt) break;

      // --- plucked string (guzheng/pipa) -------------------------------
      if (Math.random() < cfg.pluck.chance) {
        // Random walk along the scale, favouring small moves and the tonic.
        let mi = tr.mel + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.75 ? 1 : 2);
        if (mi < 0) mi += scale.length;
        if (mi >= scale.length) mi -= scale.length;
        if (s % 8 === 0 && Math.random() < 0.55) mi = 0;
        tr.mel = mi;
        const oct = cfg.pluck.octaves[(Math.random() * cfg.pluck.octaves.length) | 0];
        const freq = cfg.root * Math.pow(2, (scale[mi] + oct) / 12);
        this._pluck({
          t0: t, freq, dur: cfg.pluck.dur, damp: cfg.pluck.damp,
          gain: cfg.pluck.gain * this._rand(0.7, 1.1),
          pan: this._rand(-0.45, 0.45),
          bright: 2600 + Math.random() * 2200,
          dest: 'music', send: 0.22 + this._roomAmount,
        });
        // Occasional grace note a scale step below, guzheng style.
        if (Math.random() < 0.18) {
          const gi = (mi + scale.length - 1) % scale.length;
          this._pluck({
            t0: t - 0.07, freq: cfg.root * Math.pow(2, (scale[gi] + oct) / 12),
            dur: 0.8, damp: cfg.pluck.damp * 0.998, gain: cfg.pluck.gain * 0.45,
            pan: this._rand(-0.4, 0.4), bright: 2600, dest: 'music', send: 0.2,
          });
        }
      }

      // --- flute melody -------------------------------------------------
      if (Math.random() < cfg.flute.chance) {
        const di = (Math.random() * scale.length) | 0;
        const dir = cfg.flute.descend ? -12 : 0;
        const freq = cfg.root * Math.pow(2, (scale[di] + (cfg.flute.octave || 12) + dir) / 12);
        this._flute({
          t0: t, freq, dur: cfg.flute.dur * this._rand(0.8, 1.25),
          gain: cfg.flute.gain * this._rand(0.8, 1.15),
          pan: this._rand(-0.3, 0.3), dest: 'music', send: 0.3 + this._roomAmount,
        });
      }

      // --- frame drum ---------------------------------------------------
      if (cfg.drum) {
        const hit = cfg.drum.pattern[s % cfg.drum.pattern.length];
        if (hit > 0) {
          this._drum({
            t0: t, gain: cfg.drum.gain * hit * this._rand(0.85, 1.1),
            tune: cfg.drum.tune * this._rand(0.97, 1.03),
            pan: this._rand(-0.12, 0.12), dest: 'music',
            send: 0.25 + this._roomAmount,
          });
        }
      }

      tr.next += cfg.beat;
      tr.step++;
    }
  }

  // -------------------------------------------------------------------------
  // Ambience
  // -------------------------------------------------------------------------

  /**
   * Cross-fade the layered ambience bed. Ids follow MapDefs.ambientLoop:
   * town|field|desert|dungeon|cave|hell.
   */
  ambience(id, { fade = 3 } = {}) {
    if (!this.ok) { this._pendingAmbience = { id, opts: { fade } }; return; }
    if (this._ambienceId === id) return;
    this._ambienceId = id;

    const c = this.ctx, now = c.currentTime;
    const def = AMBIENCES[id] || AMBIENCES.field;
    if (!AMBIENCES[id] && !this._warned.has(`a:${id}`)) {
      this._warned.add(`a:${id}`);
      console.warn(`[audio] unknown ambience id '${id}' — falling back to 'field'`);
    }

    // A bed already fading out from an earlier switch never gets a second
    // chance — tear it down now so rapid map changes cannot leak nodes.
    if (this._retiring) { this._killBed(this._retiring); this._retiring = null; }

    const old = this._bed;
    if (old) {
      try {
        old.out.gain.cancelScheduledValues(now);
        old.out.gain.setValueAtTime(Math.max(0.0001, old.out.gain.value), now);
        old.out.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.05, fade));
      } catch { /* ignore */ }
      old.endAt = now + Math.max(0.05, fade);
      old.retiring = true;
    }

    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(1, now + Math.max(0.05, fade));
    out.connect(this.buses.ambience);

    const bed = { id, out, nodes: [], events: [], endAt: Infinity, retiring: false };
    for (const layer of def.layers) this._bedLayer(bed, layer, now);
    for (const [kind, min, max] of def.events) {
      bed.events.push({ kind, min, max, next: now + this._rand(0.5, max) });
    }
    this._bed = bed;
    this._retiring = old || null;
    this._setRoom(def.room, def.send, fade);
  }

  /** One continuous ambience layer. All noise, all filtered, all modulated. */
  _bedLayer(bed, kind, now) {
    const c = this.ctx;
    const src = c.createBufferSource();
    const amp = c.createGain();
    const pan = this._panner(this._rand(-0.25, 0.25));
    let head = amp;

    const modulate = (param, rate, depth, base) => {
      const lfo = c.createOscillator();
      lfo.frequency.value = rate;
      const lg = c.createGain();
      lg.gain.value = depth;
      lfo.connect(lg);
      lg.connect(param);
      param.value = base;
      lfo.start(now);
      bed.nodes.push(lfo, lg);
    };

    switch (kind) {
      case 'wind': case 'wind.dry': case 'breeze.soft': case 'breeze.hollow': {
        src.buffer = this._brown;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = kind === 'breeze.hollow' ? 3.2 : 0.9;
        const base = kind === 'wind.dry' ? 900 : kind === 'breeze.hollow' ? 260 : 520;
        modulate(lp.frequency, 0.055, base * 0.5, base);
        modulate(bp.frequency, 0.031, base * 0.4, base * 1.3);
        amp.gain.value = kind === 'breeze.soft' ? 0.10 : kind === 'breeze.hollow' ? 0.16 : 0.20;
        modulate(amp.gain, 0.023, amp.gain.value * 0.55, amp.gain.value);
        src.connect(lp); lp.connect(bp); bp.connect(amp);
        bed.nodes.push(lp, bp);
        break;
      }
      case 'chatter': {
        // Distant crowd: two wandering formants of noise, amplitude-wobbled.
        src.buffer = this._white;
        const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 7;
        const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 9;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
        modulate(f1.frequency, 0.42, 120, 420);
        modulate(f2.frequency, 0.29, 260, 1150);
        const mix = c.createGain(); mix.gain.value = 0.5;
        src.connect(f1); src.connect(f2);
        f1.connect(mix); f2.connect(mix);
        mix.connect(lp); lp.connect(amp);
        amp.gain.value = 0.075;
        modulate(amp.gain, 0.19, 0.045, 0.075);
        bed.nodes.push(f1, f2, lp, mix);
        break;
      }
      case 'insects': {
        // Cicadas: a narrow high band chopped by a fast tremolo.
        src.buffer = this._white;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 22;
        bp.frequency.value = 4600;
        modulate(bp.frequency, 0.07, 600, 4600);
        amp.gain.value = 0.03;
        modulate(amp.gain, 11.5, 0.026, 0.032);
        src.connect(bp); bp.connect(amp);
        bed.nodes.push(bp);
        break;
      }
      case 'rumble': {
        src.buffer = this._brown;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
        modulate(lp.frequency, 0.037, 45, 105);
        amp.gain.value = 0.34;
        modulate(amp.gain, 0.021, 0.12, 0.34);
        src.connect(lp); lp.connect(amp);
        // Sub sine underneath so it is felt more than heard.
        const sub = c.createOscillator();
        sub.type = 'sine'; sub.frequency.value = 38;
        const sg = c.createGain(); sg.gain.value = 0.05;
        sub.connect(sg); sg.connect(amp);
        sub.start(now);
        bed.nodes.push(lp, sub, sg);
        break;
      }
      case 'firebed': {
        src.buffer = this._brown;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
        modulate(lp.frequency, 0.19, 160, 340);
        amp.gain.value = 0.22;
        modulate(amp.gain, 0.13, 0.09, 0.22);
        src.connect(lp); lp.connect(amp);
        bed.nodes.push(lp);
        break;
      }
      default: {
        src.buffer = this._white;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
        amp.gain.value = 0.05;
        src.connect(lp); lp.connect(amp);
        bed.nodes.push(lp);
        break;
      }
    }

    head.connect(pan);
    pan.connect(bed.out);
    this._send(amp, 0.18);
    src.loop = true;
    src.start(now, Math.random() * (src.buffer.duration * 0.5));
    bed.nodes.push(src, amp, pan);
  }

  /** One-shot ambience events, scheduled ahead like music notes. */
  _ambienceEvent(kind, t) {
    const room = 0.4 + this._roomAmount;
    switch (kind) {
      case 'blacksmith': {
        // Two or three hammer blows on an anvil, with the real ring on top.
        const n = 2 + ((Math.random() * 2) | 0);
        const pan = this._rand(-0.6, 0.6);
        for (let i = 0; i < n; i++) {
          const tt = t + i * this._rand(0.28, 0.42);
          this._metal({ t0: tt, freq: this._rand(1500, 2100), ratios: [1, 2.63, 4.17, 6.1], dur: 0.9, gain: 0.11, pan, send: room, dest: 'ambience' });
          this._noise({ t0: tt, dur: 0.05, type: 'bandpass', f0: 900, f1: 300, q: 1.4, gain: 0.09, pan, dest: 'ambience', send: room * 0.5, attack: 0.001 });
        }
        break;
      }
      case 'bird': {
        const pan = this._rand(-0.8, 0.8);
        const n = 2 + ((Math.random() * 4) | 0);
        const base = this._rand(2200, 3600);
        for (let i = 0; i < n; i++) {
          const f = base * this._rand(0.86, 1.2);
          this._tone({ t0: t + i * this._rand(0.07, 0.16), freq: f, to: f * this._rand(0.7, 1.5), dur: this._rand(0.05, 0.11), type: 'sine', gain: 0.05, pan, dest: 'ambience', send: 0.3, attack: 0.008 });
        }
        break;
      }
      case 'dog': {
        for (let i = 0; i < 2; i++) {
          this._growl({ t0: t + i * 0.34, dur: 0.18, scale: 1.35, pitch: 210, formants: [640, 1300, 2400], gain: 0.07, pan: this._rand(-0.7, 0.7), dest: 'ambience', send: room, bend: 0.55 });
        }
        break;
      }
      case 'gust': {
        this._noise({ t0: t, dur: this._rand(2.2, 4.0), type: 'bandpass', f0: 380, f1: 900, q: 1.1, gain: 0.14, pan: this._rand(-0.6, 0.6), attack: 0.9, brown: true, dest: 'ambience', send: 0.25 });
        break;
      }
      case 'grit': {
        this._noise({ t0: t, dur: this._rand(0.6, 1.4), type: 'highpass', f0: 2400, f1: 5200, q: 0.7, gain: 0.05, pan: this._rand(-0.8, 0.8), attack: 0.25, dest: 'ambience' });
        break;
      }
      case 'drip': {
        // Water drop: fast upward pitch blip, tiny tick, long tail in the cave IR.
        const pan = this._rand(-0.85, 0.85);
        const f = this._rand(700, 1500);
        this._tone({ t0: t, freq: f * 0.55, to: f * 1.9, dur: 0.09, type: 'sine', gain: 0.11, pan, dest: 'ambience', send: room * 1.2, attack: 0.002, sweep: 0.8 });
        this._noise({ t0: t, dur: 0.02, type: 'bandpass', f0: f * 3, f1: f * 2, q: 3, gain: 0.05, pan, dest: 'ambience', send: room, attack: 0.001 });
        break;
      }
      case 'groan': {
        this._growl({ t0: t, dur: this._rand(1.2, 2.2), scale: 0.7, pitch: 90, formants: [300, 700, 1400], gain: 0.075, pan: this._rand(-0.7, 0.7), dest: 'ambience', send: room * 1.3, bend: 0.7, attack: 0.35 });
        break;
      }
      case 'scuttle': {
        const pan = this._rand(-0.9, 0.9);
        const n = 4 + ((Math.random() * 5) | 0);
        for (let i = 0; i < n; i++) {
          this._noise({ t0: t + i * this._rand(0.04, 0.1), dur: 0.02, type: 'bandpass', f0: this._rand(2600, 5200), f1: 1800, q: 5, gain: 0.035, pan, dest: 'ambience', attack: 0.001 });
        }
        break;
      }
      case 'crackle': {
        const pan = this._rand(-0.7, 0.7);
        const n = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) {
          this._noise({ t0: t + i * this._rand(0.03, 0.14), dur: 0.03, type: 'bandpass', f0: this._rand(1800, 4800), f1: 1200, q: 4, gain: this._rand(0.03, 0.07), pan, dest: 'ambience', send: 0.3, attack: 0.001 });
        }
        break;
      }
      case 'boom': {
        this._thump({ t0: t, f0: 92, f1: 28, dur: 1.6, gain: 0.16, pan: this._rand(-0.4, 0.4), dest: 'ambience', send: 0.8, sweep: 0.5 });
        this._noise({ t0: t, dur: 1.8, type: 'lowpass', f0: 320, f1: 60, q: 0.7, gain: 0.1, pan: 0, brown: true, attack: 0.08, dest: 'ambience', send: 0.8 });
        break;
      }
      default: break;
    }
  }

  /**
   * Swap the reverb character. The convolver buffer cannot be swapped without a
   * discontinuity, so the send is ducked, the buffer changed, then the send is
   * brought back to the new amount.
   */
  _setRoom(kind, amount, seconds = 1.5) {
    if (!this.ok) return;
    const c = this.ctx, now = c.currentTime;
    this._roomAmount = amount;
    const ramp = Math.max(0.15, Math.min(seconds, 3));

    const apply = () => {
      try {
        this.roomSend.gain.cancelScheduledValues(c.currentTime);
        this.roomSend.gain.setValueAtTime(Math.max(0.0001, this.roomSend.gain.value), c.currentTime);
        this.roomSend.gain.linearRampToValueAtTime(amount, c.currentTime + ramp * 0.6);
      } catch { /* ignore */ }
      this.roomTone.frequency.setTargetAtTime(kind === 'cave' ? 3400 : 5600, c.currentTime, 0.4);
    };

    if (kind === this._roomKind) { apply(); return; }
    this._roomKind = kind;

    try {
      this.roomSend.gain.cancelScheduledValues(now);
      this.roomSend.gain.setValueAtTime(Math.max(0.0001, this.roomSend.gain.value), now);
      this.roomSend.gain.linearRampToValueAtTime(0.0001, now + 0.28);
    } catch { /* ignore */ }

    if (this._roomTimer) clearTimeout(this._roomTimer);
    this._roomTimer = setTimeout(() => {
      this._roomTimer = null;
      if (!this.ok) return;
      try { this.convolver.buffer = this._impulse(kind); } catch { /* ignore */ }
      apply();
    }, 320);
  }

  // -------------------------------------------------------------------------
  // Scheduler pump
  // -------------------------------------------------------------------------

  _startPump() {
    if (this._timer != null) return;
    const tick = () => {
      this._timer = setTimeout(tick, PUMP_MS);
      try { this._pump(); } catch (e) { console.warn('[audio] scheduler:', e && e.message); }
    };
    this._timer = setTimeout(tick, 0);
  }

  _pump() {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;

    for (let i = this._tracks.length - 1; i >= 0; i--) {
      const tr = this._tracks[i];
      if (now > tr.endAt + 0.35) { this._killTrack(tr); this._tracks.splice(i, 1); continue; }
      this._scheduleTrack(tr, horizon);
    }

    const retiring = this._retiring;
    if (retiring && now > retiring.endAt + 0.2) {
      this._killBed(retiring);
      this._retiring = null;
    }

    const bed = this._bed;
    if (bed && !bed.retiring) {
      for (const ev of bed.events) {
        if (ev.next < now) ev.next = now + this._rand(0.05, ev.min);
        let guard = 0;
        while (ev.next < horizon && ++guard < 6) {
          this._ambienceEvent(ev.kind, ev.next);
          ev.next += this._rand(ev.min, ev.max);
        }
      }
    }
  }

  _killBed(bed) {
    for (const n of bed.nodes) {
      try { if (n.stop) n.stop(); } catch { /* not a source */ }
      try { n.disconnect(); } catch { /* gone */ }
    }
    bed.nodes.length = 0;
    bed.events.length = 0;
    try { bed.out.disconnect(); } catch { /* gone */ }
  }

  // -------------------------------------------------------------------------
  // Public odds and ends
  // -------------------------------------------------------------------------

  /**
   * @param {{x:number,y?:number,z:number}} position
   * @param {number} facing radians, 0 looks toward +Z
   */
  setListener(position, facing) {
    if (!position) return;
    this._lx = position.x;
    this._ly = position.y || 0;
    this._lz = position.z;
    this._facing = facing || 0;
  }

  /** Override the yaw used as the stereo basis (defaults to the camera yaw). */
  setPanBasis(yaw) { this._panYaw = yaw || 0; }

  /** @param {'master'|'sfx'|'music'|'ambience'} bus */
  setVolume(bus, v) {
    const val = clamp(Number(v) || 0, 0, 1.5);
    if (!(bus in this.volumes)) return;
    this.volumes[bus] = val;
    if (!this.ok) return;
    const node = bus === 'master' ? this.master : this.buses[bus];
    if (!node) return;
    try {
      node.gain.setTargetAtTime(val, this.ctx.currentTime, 0.05);
    } catch { node.gain.value = val; }
  }

  dispose() {
    if (this._timer != null) { clearTimeout(this._timer); this._timer = null; }
    if (this._roomTimer != null) { clearTimeout(this._roomTimer); this._roomTimer = null; }
    this._dropGestureHooks();

    for (const tr of this._tracks) this._killTrack(tr);
    this._tracks.length = 0;
    if (this._bed) { this._killBed(this._bed); this._bed = null; }
    if (this._retiring) { this._killBed(this._retiring); this._retiring = null; }

    this._ks.clear();
    this._ksKeys.length = 0;
    this._last.clear();
    this._warned.clear();
    this._ir.hall = null;
    this._ir.cave = null;
    this._white = null;
    this._brown = null;

    if (this.ctx) {
      for (const n of [this.roomSend, this.roomTone, this.convolver, this.roomReturn,
        this.buses.sfx, this.buses.music, this.buses.ambience, this.master, this.comp]) {
        try { if (n) n.disconnect(); } catch { /* gone */ }
      }
      if (this.convolver) { try { this.convolver.buffer = null; } catch { /* ignore */ } }
      try { this.ctx.close(); } catch { /* already closed */ }
    }
    this.buses.sfx = this.buses.music = this.buses.ambience = null;
    this.ctx = null;
    this.ok = false;
    this._musicId = null;
    this._ambienceId = null;
    this._voices = 0;
  }
}

export default Audio;
