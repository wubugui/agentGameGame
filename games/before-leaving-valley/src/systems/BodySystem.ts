/* Hands (fatigue) and heart (fear). No numbers on screen: breath, trembling and a sinking camera carry them. */
import type { System } from "../engine/world";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const FEAR_SCENES = new Set(["forestEdge", "forest1", "forest2"]);

export const BodySystem: System = {
  id: "body", order: 50,
  init(world) {
    const offs: Array<() => void> = [];
    let adrenaline = false;
    const setFatigue = (value: number, reason?: string) => {
      const next = clamp01(value);
      world.patch("body", { fatigue: next });
      if (next >= 0.9 && !adrenaline) { adrenaline = true; world.patch("body", { adrenaline: true }); world.emit("body:adrenaline", { on: true }); }
      if (next < 0.75 && adrenaline) { adrenaline = false; world.patch("body", { adrenaline: false }); world.emit("body:adrenaline", { on: false }); }
      if (import.meta.env.DEV && reason) world.rt.log.push(`fatigue ${next.toFixed(2)} (${reason})`);
    };
    offs.push(world.on("body:fatigue", ({ delta, reason }) => {
      const gloves = world.state.inventory.worn.includes("gloves") && delta > 0 ? 0.6 : 1;
      setFatigue(world.state.body.fatigue + delta * gloves, reason);
    }));
    offs.push(world.on("body:fear", ({ delta }) => {
      if (!FEAR_SCENES.has(world.state.sceneId) && delta > 0) return;
      world.patch("body", { fear: clamp01(world.state.body.fear + delta) });
    }));
    offs.push(world.on("body:slip", ({ severity }) => {
      world.patch("body", { slips: world.state.body.slips + 1 });
      setFatigue(world.state.body.fatigue + 0.05 * severity, "slip");
      world.emit("body:rest", { seconds: 3.2 });
    }));
    offs.push(world.on("body:rest", ({ seconds }) => {
      world.patch("body", { breath: "recovery" });
      world.after(seconds * 1000, () => world.patch("body", { breath: "calm" }));
    }));
    // Waiting: the only rest. Every wait is 8 s of standing still.
    offs.push(world.on("input:wait", () => {
      if (world.state.ui.travel) return;
      setFatigue(world.state.body.fatigue - (world.state.sceneId === "summit" ? 0.05 : 0.04), "wait");
      world.emit("clock:advance", { minutes: 1, reason: "站着歇一口气" });
    }));
    offs.push(world.on("item:use", ({ item }) => {
      if (item === "chocolate") { setFatigue(world.state.body.fatigue - 0.25, "chocolate"); world.patch("body", { fear: clamp01(world.state.body.fear - 0.15) }); }
    }));
    offs.push(world.on("travel:begin", ({ run }) => { world.patch("body", { breath: "walking" }); if (run) setFatigue(world.state.body.fatigue + 0.02, "run"); }));
    offs.push(world.on("travel:arrive", ({ scene }) => {
      const hard = ["scree", "deer", "forestEdge", "forest1", "forest2", "hairpin"].includes(scene);
      world.patch("body", { breath: hard ? "recovery" : "calm" });
      if (hard) world.after(5000, () => world.patch("body", { breath: "calm" }));
      if (scene === "hairpin" || scene === "car") world.patch("body", { fear: 0 });
      if (scene === "forestEdge") world.patch("body", { fear: Math.max(world.state.body.fear, world.state.journal.entries.includes("E-forest") ? 0.4 : 0.3) });
    }));
    // Not eating all day: a constant weight (v4 §3.2). Applied once at sunset if the bar is still in the pack.
    offs.push(world.on("clock:mark", ({ tag }) => {
      if (tag === "sunset" && world.state.inventory.items.includes("chocolate")) setFatigue(world.state.body.fatigue + 0.15, "no meal");
    }));
    // Gusts wear you down a hair.
    offs.push(world.on("camera:impulse", ({ kind, strength }) => { if (kind === "turn" && (strength ?? 0) >= 0.9) setFatigue(world.state.body.fatigue + 0.01); }));
    return () => offs.forEach((off) => off());
  },
};
