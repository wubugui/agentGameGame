/* Events → Soundscape. Holds no game state. */
import { lightOf } from "../engine/condition";
import { SCENES } from "../engine/scene";
import type { System, World } from "../engine/world";
import { SILENCE, Soundscape } from "../soundscape";

type MusicKind = "day" | "warm" | "end";
const MUSIC: Record<MusicKind, { src: string; volume: number; fadeStep: number }> = {
  day: { src: "audio/clear-air.mp3", volume: 0.14, fadeStep: 0.02 },
  warm: { src: "audio/simple-duet.mp3", volume: 0.2, fadeStep: 0.02 },
  end: { src: "audio/promises-to-keep.mp3", volume: 0.2, fadeStep: 0.006 },
};
const DAY_MUSIC = new Set(["roadside", "meadow", "approach", "plaque", "cable", "crack", "mailbox", "exit", "summit", "plateau", "ledge"]);

export const AudioSystem: System = {
  id: "audio", order: 210,
  init(world) {
    if (world.rt.headless || typeof window === "undefined") return;
    const offs: Array<() => void> = [];
    let sound: Soundscape | null = null;
    const els: Partial<Record<MusicKind, HTMLAudioElement>> = {};
    const targets: Partial<Record<MusicKind, number>> = {};
    let blocked = false;
    const ensure = () => {
      if (sound) { sound.resume(); return sound; }
      try { sound = new Soundscape(); sound.setMaster(world.state.settings.master); world.rt.sound = sound; } catch { return null; }
      return sound;
    };
    const wake = () => { if (world.state.settings.master > 0) { ensure(); blocked = false; } };
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    offs.push(() => { window.removeEventListener("pointerdown", wake); window.removeEventListener("keydown", wake); });

    (Object.keys(MUSIC) as MusicKind[]).forEach((kind) => { const el = document.createElement("audio"); el.src = `${import.meta.env.BASE_URL}${MUSIC[kind].src}`; el.loop = true; el.preload = "none"; el.volume = 0; els[kind] = el; });
    const fade = window.setInterval(() => {
      (Object.keys(MUSIC) as MusicKind[]).forEach((kind) => {
        const el = els[kind]; if (!el) return;
        const target = targets[kind] ?? 0; const diff = target - el.volume;
        if (target > 0 && el.paused && !blocked) el.play().catch(() => { blocked = true; });
        if (Math.abs(diff) <= MUSIC[kind].fadeStep) { el.volume = target; if (target <= 0 && !el.paused) el.pause(); return; }
        el.volume = Math.max(0, Math.min(1, el.volume + Math.sign(diff) * MUSIC[kind].fadeStep));
      });
    }, 100);
    offs.push(() => { window.clearInterval(fade); Object.values(els).forEach((el) => { el.pause(); el.removeAttribute("src"); }); });

    const music = () => {
      const level = world.state.settings.music;
      const next: Partial<Record<MusicKind, number>> = {};
      const s = world.state;
      if (level > 0 && s.phase !== "title") {
        if (s.sceneId === "car") next.warm = MUSIC.warm.volume * level;
        else if (s.phase === "complete" || (s.sceneId === "bench" && world.flag("bench.translated", false)) || (s.sceneId === "police" && world.flag("police.returned", false))) next.end = MUSIC.end.volume * level;
        else if (DAY_MUSIC.has(s.sceneId) && lightOf(s) > 0.2) next.day = MUSIC.day.volume * level;
      }
      Object.assign(targets, { day: 0, warm: 0, end: 0 }, next);
    };
    const ambience = () => {
      const s = ensure(); if (!s) return;
      const def = SCENES[world.state.sceneId];
      const base = world.state.phase === "title" ? { ...SILENCE, wind: 0.3, windTone: 950, birds: 0.5 } : def?.ambience ?? SILENCE;
      const light = lightOf(world.state);
      const night = light <= 0 && world.state.clock.day === 1 && !def?.interior;
      const mix = { ...base, wind: base.wind * (night ? 0.8 : 1), crickets: Math.max(base.crickets, night ? 0.55 : world.state.clock.minuteOfDay >= 18 * 60 && world.state.clock.day === 1 ? 0.3 : 0), birds: base.birds * (light > 0.3 ? 1 : 0.2) };
      s.setAmbience(mix, 1.6);
      s.setWindPan(def?.weather?.windPan ?? 0);
    };
    offs.push(world.on("scene:enter", () => { ambience(); music(); }));
    offs.push(world.on("flow:phase", () => { ambience(); music(); }));
    offs.push(world.on("clock:light", () => { ambience(); music(); }));
    offs.push(world.on("flag:set", () => music()));
    offs.push(world.on("ambience", ({ overrides }) => { const s = ensure(); const def = SCENES[world.state.sceneId]; if (s && def) s.setAmbience({ ...def.ambience, ...(overrides ?? {}) }, 0.9); }));
    offs.push(world.on("sfx", ({ name, pan, strength = 1 }) => {
      const s = ensure(); if (!s || world.state.settings.master <= 0) return;
      const play = () => {
        switch (name) {
          case "step": s.step(SCENES[world.state.sceneId]?.material ?? "soft"); break;
          case "shutter": s.shutter(); break;
          case "tick": s.uiTick(true); break;
          case "tock": s.uiTick(false); break;
          case "clink": s.chainClink(); break;
          case "slip": s.slip(); break;
          case "door": s.carDoor(); break;
          case "breath": s.breath({ duration: 0.9 * strength, gain: 0.5 * strength, cutoff: 900 }); break;
          case "thud": s.thud(strength); break;
          case "slide": s.slide(); break;
          case "brake": s.brake(); break;
          case "grip": s.grip(); break;
          case "helicopter": s.helicopter(); break;
          case "hooves": s.hooves(1); break;
          case "doorOpen": s.door(true); break;
          case "doorClose": s.door(false); break;
          case "wiper": s.wiper(); break;
          case "exhale": s.exhale(); break;
          case "heartbeat": s.heartbeat(strength); break;
          case "pencil": s.pencil(); break;
          case "paper": s.paper(); break;
          case "zip": s.zip(); break;
          case "cloth": s.cloth(); break;
        }
      };
      if (pan) s.panned(pan, play); else play();
    }));
    offs.push(world.on("travel:begin", ({ run, ms }) => {
      const cadence = run ? 300 : 560;
      for (let at = 0; at < ms - 120; at += cadence) world.after(at, () => { world.emit("sfx", { name: "step" }); if (run) world.emit("sfx", { name: "thud" }); });
      if (run) world.after(700, () => world.emit("sfx", { name: "breath" }));
    }));
    offs.push(world.on("scene:enter", ({ scene }) => {
      const def = SCENES[scene];
      if (def?.interior && scene !== "car") { world.emit("sfx", { name: "doorOpen" }); world.after(1500, () => world.emit("sfx", { name: "doorClose" })); }
      if (scene === "car") world.emit("sfx", { name: "door" });
    }));
    offs.push(world.on("flag:set", ({ key }) => { if (key === "settings") return; }));
    const master = () => { sound?.setMaster(world.state.settings.master); music(); };
    let lastMaster = world.state.settings.master;
    offs.push(world.subscribe(() => { if (world.state.settings.master !== lastMaster) { lastMaster = world.state.settings.master; master(); } }));
    return () => { offs.forEach((off) => off()); sound?.dispose(); sound = null; };
  },
  tick(world, dt) {
    // Heartbeat and breath rhythms live here; the view only draws them.
    const rt = world.rt as typeof world.rt & { beatT?: number; breathT?: number; wiperT?: number };
    const s = world.state;
    const inForest = s.sceneId === "forest1" || s.sceneId === "forest2";
    if (inForest && s.phase === "play") {
      rt.beatT = (rt.beatT ?? 0) + dt * 1000;
      const period = 1000 - s.body.fear * 520;
      if (rt.beatT >= period) { rt.beatT = 0; world.emit("sfx", { name: "heartbeat", strength: s.body.fear }); }
    }
    const night = lightOf(s) <= 0 && s.clock.day === 1 && !SCENES[s.sceneId]?.interior;
    if (night && s.phase === "play" && !s.ui.phoneOpen) {
      rt.breathT = (rt.breathT ?? 0) + dt * 1000;
      const period = (s.body.breath === "recovery" ? 1.7 : 2.8) * 1000;
      if (rt.breathT >= period) { rt.breathT = 0; world.emit("sfx", { name: "exhale" }); }
    }
    if (s.sceneId === "car" && s.phase === "play") { rt.wiperT = (rt.wiperT ?? 0) + dt * 1000; if (rt.wiperT >= 2200) { rt.wiperT = 0; world.emit("sfx", { name: "wiper" }); } }
  },
};

export const soundOf = (world: World) => world.rt.sound as Soundscape | null;
