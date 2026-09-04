/* Procedural soundscape: wind with gusts, birds, crickets, stream, car engine
   and heater, plus one-shot foley (steps by material, shutter, UI ticks,
   chain clinks, gravel slips). Everything is synthesised in Web Audio so the
   game ships with no sample files; levels are tuned to sit under the music. */

export type SoundMaterial = "rock" | "soft" | "gravel" | "road";

export type Ambience = {
  wind: number;      // 0..1 overall wind level
  windTone: number;  // lowpass cutoff in Hz (open ridge ~1450, forest ~900, night ~540)
  birds: number;     // 0..1 density of bird calls
  crickets: number;  // 0..1
  stream: number;    // 0..1
  engine: number;    // 0..1
  heater: number;    // 0..1 warm air in the car
};

export const SILENCE: Ambience = { wind: 0, windTone: 800, birds: 0, crickets: 0, stream: 0, engine: 0, heater: 0 };

type BreathProfile = { duration: number; gain: number; cutoff: number };

function makeNoise(ctx: AudioContext, seconds: number, brown: boolean) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = last * 0.985 + white * 0.015;
      data[index] = last * 3.2;
    } else {
      data[index] = white;
    }
  }
  return buffer;
}

export class Soundscape {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly brown: AudioBuffer;
  private readonly white: AudioBuffer;
  private readonly windGain: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly cricketGain: GainNode;
  private readonly streamGain: GainNode;
  private readonly engineGain: GainNode;
  private readonly heaterGain: GainNode;
  private ambience: Ambience = { ...SILENCE };
  private gustTimer = 0;
  private birdTimer = 0;
  private disposed = false;

  constructor() {
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) throw new Error("Web Audio unavailable");
    const ctx = new AudioCtor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.brown = makeNoise(ctx, 3, true);
    this.white = makeNoise(ctx, 2, false);

    // Wind: brown noise through a lowpass whose cutoff sets how "open" the place feels.
    const wind = ctx.createBufferSource();
    wind.buffer = this.brown;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 800;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Crickets: narrow band of white noise pulsed at ~24 Hz.
    const cricketSource = ctx.createBufferSource();
    cricketSource.buffer = this.white;
    cricketSource.loop = true;
    const cricketBand = ctx.createBiquadFilter();
    cricketBand.type = "bandpass";
    cricketBand.frequency.value = 4300;
    cricketBand.Q.value = 9;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 23;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(pulse.gain);
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    cricketSource.connect(cricketBand).connect(pulse).connect(this.cricketGain).connect(this.master);
    cricketSource.start();
    lfo.start();

    // Stream: white noise band around 900 Hz with a slow wobble.
    const streamSource = ctx.createBufferSource();
    streamSource.buffer = this.white;
    streamSource.loop = true;
    const streamBand = ctx.createBiquadFilter();
    streamBand.type = "bandpass";
    streamBand.frequency.value = 950;
    streamBand.Q.value = 0.8;
    const wobble = ctx.createGain();
    wobble.gain.value = 0.8;
    const wobbleLfo = ctx.createOscillator();
    wobbleLfo.frequency.value = 0.27;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0.2;
    wobbleLfo.connect(wobbleDepth).connect(wobble.gain);
    this.streamGain = ctx.createGain();
    this.streamGain.gain.value = 0;
    streamSource.connect(streamBand).connect(wobble).connect(this.streamGain).connect(this.master);
    streamSource.start();
    wobbleLfo.start();

    // Car: a low sawtooth for the engine, brown noise for the heater.
    const engine = ctx.createOscillator();
    engine.type = "sawtooth";
    engine.frequency.value = 47;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 92;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    engine.connect(engineFilter).connect(this.engineGain).connect(this.master);
    engine.start();
    const heater = ctx.createBufferSource();
    heater.buffer = this.brown;
    heater.loop = true;
    heater.playbackRate.value = 0.8;
    const heaterFilter = ctx.createBiquadFilter();
    heaterFilter.type = "lowpass";
    heaterFilter.frequency.value = 420;
    this.heaterGain = ctx.createGain();
    this.heaterGain.gain.value = 0;
    heater.connect(heaterFilter).connect(this.heaterGain).connect(this.master);
    heater.start();

    this.gustTimer = window.setInterval(() => this.gust(), 1100);
    this.scheduleBird();
  }

  get running() {
    return this.ctx.state === "running";
  }

  resume() {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  suspend() {
    if (this.ctx.state === "running") void this.ctx.suspend();
  }

  dispose() {
    this.disposed = true;
    window.clearInterval(this.gustTimer);
    window.clearTimeout(this.birdTimer);
    if (this.ctx.state !== "closed") void this.ctx.close();
  }

  setMaster(value: number) {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.ctx.currentTime, 0.05);
  }

  setAmbience(next: Ambience, ramp = 1.6) {
    this.ambience = { ...next };
    const now = this.ctx.currentTime;
    const ramps: Array<[AudioParam, number]> = [
      [this.windGain.gain, next.wind * 0.075],
      [this.windFilter.frequency, next.windTone],
      [this.cricketGain.gain, next.crickets * 0.011],
      [this.streamGain.gain, next.stream * 0.028],
      [this.engineGain.gain, next.engine * 0.034],
      [this.heaterGain.gain, next.heater * 0.02],
    ];
    ramps.forEach(([param, value]) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + ramp);
    });
  }

  private gust() {
    if (this.disposed || this.ctx.state !== "running") return;
    const base = this.ambience.wind * 0.075;
    if (base <= 0) return;
    const now = this.ctx.currentTime;
    const target = base * (0.62 + Math.random() * 0.8);
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setValueAtTime(this.windGain.gain.value, now);
    this.windGain.gain.linearRampToValueAtTime(target, now + 0.9 + Math.random() * 0.6);
    const tone = this.ambience.windTone * (0.88 + Math.random() * 0.28);
    this.windFilter.frequency.cancelScheduledValues(now);
    this.windFilter.frequency.setValueAtTime(this.windFilter.frequency.value, now);
    this.windFilter.frequency.linearRampToValueAtTime(tone, now + 1.1);
  }

  private scheduleBird() {
    if (this.disposed) return;
    const density = this.ambience.birds;
    const wait = density > 0 ? 900 + Math.random() * (5200 - density * 3800) : 1500;
    this.birdTimer = window.setTimeout(() => {
      if (this.ambience.birds > 0 && this.ctx.state === "running") this.birdCall(this.ambience.birds);
      this.scheduleBird();
    }, wait);
  }

  private birdCall(density: number) {
    const ctx = this.ctx;
    const notes = 2 + Math.floor(Math.random() * 3);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.012 + density * 0.012;
    pan.connect(out).connect(this.master);
    const baseFreq = 2300 + Math.random() * 1500;
    let at = ctx.currentTime + 0.02;
    for (let index = 0; index < notes; index += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const duration = 0.06 + Math.random() * 0.08;
      const up = Math.random() > 0.4;
      osc.type = "sine";
      osc.frequency.setValueAtTime(up ? baseFreq : baseFreq * 1.35, at);
      osc.frequency.exponentialRampToValueAtTime(up ? baseFreq * 1.35 : baseFreq, at + duration);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(1, at + duration * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      osc.connect(gain).connect(pan);
      osc.start(at);
      osc.stop(at + duration + 0.02);
      at += duration + 0.05 + Math.random() * 0.12;
    }
  }

  private noiseBurst(duration: number, gain: number, filterType: BiquadFilterType, frequency: number, q = 1, when = 0) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.white;
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const env = ctx.createGain();
    const at = ctx.currentTime + when;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.012, duration * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(env).connect(this.master);
    source.start(at);
    source.stop(at + duration + 0.03);
  }

  private tone(frequency: number, endFrequency: number, duration: number, gain: number, type: OscillatorType = "triangle", when = 0) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const at = ctx.currentTime + when;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(this.master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  step(material: SoundMaterial) {
    if (this.ctx.state !== "running") return;
    switch (material) {
      case "rock":
        this.tone(96 + Math.random() * 24, 48, 0.13, 0.036);
        this.noiseBurst(0.05, 0.02, "highpass", 1400);
        break;
      case "gravel":
        this.tone(80 + Math.random() * 20, 42, 0.12, 0.028);
        this.noiseBurst(0.11, 0.03, "bandpass", 2200, 0.8);
        this.noiseBurst(0.07, 0.016, "bandpass", 3400, 1.2, 0.04);
        break;
      case "road":
        this.tone(70 + Math.random() * 14, 36, 0.14, 0.03);
        this.noiseBurst(0.04, 0.012, "lowpass", 900);
        break;
      default:
        this.tone(66 + Math.random() * 20, 38, 0.13, 0.024);
        this.noiseBurst(0.08, 0.014, "lowpass", 700);
    }
  }

  breath(profile: BreathProfile) {
    if (this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.white;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = profile.cutoff;
    filter.Q.value = 0.55;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(profile.gain, now + profile.duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + profile.duration + 0.04);
  }

  shutter() {
    if (this.ctx.state !== "running") return;
    this.noiseBurst(0.018, 0.05, "highpass", 2600);
    this.noiseBurst(0.024, 0.04, "highpass", 1800, 1, 0.075);
  }

  uiTick(open = true) {
    if (this.ctx.state !== "running") return;
    this.tone(open ? 1500 : 1100, open ? 1900 : 800, 0.05, 0.014, "sine");
  }

  chainClink() {
    if (this.ctx.state !== "running") return;
    this.tone(2100, 1900, 0.22, 0.02, "sine");
    this.tone(3320, 3100, 0.16, 0.012, "sine", 0.01);
    this.noiseBurst(0.03, 0.03, "highpass", 3000);
    this.noiseBurst(0.09, 0.02, "bandpass", 2400, 0.9, 0.06);
  }

  slip() {
    if (this.ctx.state !== "running") return;
    this.noiseBurst(0.42, 0.05, "bandpass", 1900, 0.6);
    this.noiseBurst(0.25, 0.03, "bandpass", 3200, 1, 0.12);
    this.tone(70, 36, 0.3, 0.03);
  }

  carDoor() {
    if (this.ctx.state !== "running") return;
    this.tone(120, 50, 0.16, 0.05);
    this.noiseBurst(0.06, 0.03, "lowpass", 600);
  }

  /* A body landing: a foot on scree, the car dropping into a pothole. */
  thud(strength = 1) {
    if (this.ctx.state !== "running") return;
    this.tone(58 + Math.random() * 8, 30, 0.22, 0.05 * strength);
    this.noiseBurst(0.07, 0.022 * strength, "lowpass", 420);
  }

  /* Stones sliding away under a foot. */
  slide() {
    if (this.ctx.state !== "running") return;
    this.noiseBurst(0.34, 0.03, "bandpass", 2600, 0.7);
    this.noiseBurst(0.22, 0.02, "bandpass", 3600, 1, 0.16);
    this.noiseBurst(0.18, 0.012, "bandpass", 1800, 1, 0.3);
  }

  /* Brakes: a soft hiss and the body pressing forward. */
  brake() {
    if (this.ctx.state !== "running") return;
    this.noiseBurst(0.55, 0.026, "bandpass", 2400, 2.2);
    this.tone(190, 120, 0.45, 0.012, "sine");
    this.tone(64, 40, 0.3, 0.03, "triangle", 0.05);
  }

  /* Two beats of a heart; louder and tighter as fear rises. */
  heartbeat(intensity = 0.5) {
    if (this.ctx.state !== "running") return;
    const gain = 0.03 + 0.05 * intensity;
    this.tone(54, 38, 0.14, gain, "sine");
    this.tone(50, 34, 0.12, gain * 0.7, "sine", 0.16);
  }

  /* A gloved hand closing on rock. */
  grip() {
    if (this.ctx.state !== "running") return;
    this.noiseBurst(0.05, 0.02, "bandpass", 1600, 1.4);
    this.noiseBurst(0.09, 0.014, "highpass", 2800, 1, 0.03);
  }
}
