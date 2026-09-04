/* Events → PanoStage impulses. Gusts, footfalls of a walk, the settle on arrival. */
import { SCENES } from "../engine/scene";
import type { System } from "../engine/world";

const STEP_KICK = { rock: 1.15, gravel: 0.95, soft: 0.6, road: 1 } as const;

export const CameraBodySystem: System = {
  id: "cameraBody", order: 220,
  init(world) {
    const offs: Array<() => void> = [];
    offs.push(world.on("camera:impulse", ({ kind, strength, dir }) => { world.rt.stage?.kick(kind, strength ?? 1, dir); }));
    offs.push(world.on("body:slip", ({ severity }) => { world.rt.stage?.kick("slip", 0.7 * severity); }));
    offs.push(world.on("travel:begin", ({ run, ms }) => {
      const cadence = run ? 300 : 560;
      const material = SCENES[world.state.sceneId]?.material ?? "soft";
      for (let at = 0; at < ms - 120; at += cadence) world.after(at, () => { world.rt.stage?.kick("step", STEP_KICK[material] * (run ? 1.3 : 1)); if (material === "gravel") world.rt.stage?.kick("turn", 0.12); });
    }));
    offs.push(world.on("travel:arrive", () => { world.rt.stage?.kick("settle", world.state.body.breath === "recovery" ? 1.6 : 1); }));
    offs.push(world.on("hold:release", ({ progress }) => { if (progress > 0.05) { world.rt.stage?.kick("slip", 0.5); world.emit("sfx", { name: "slide" }); world.emit("body:fear", { delta: 0.08 }); } }));
    return () => offs.forEach((off) => off());
  },
  tick(world, dt) {
    const rt = world.rt as typeof world.rt & { gustT?: number; nextGust?: number };
    const def = SCENES[world.state.sceneId];
    if (!def?.weather?.gusty || world.state.phase !== "play") return;
    rt.gustT = (rt.gustT ?? 0) + dt;
    rt.nextGust ??= 3 + world.rt.rng() * 5;
    if (rt.gustT >= rt.nextGust) {
      rt.gustT = 0; rt.nextGust = 5 + world.rt.rng() * 9;
      const strength = 0.9 + world.rt.rng() * 0.6;
      world.emit("camera:impulse", { kind: "turn", strength });
      world.emit("fx", { name: "gust", strength });
    }
  },
};
