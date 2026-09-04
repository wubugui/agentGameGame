/* Three batteries: phone (numbers on the lock screen), camera (only in the viewfinder), lamp (no numbers, only the ring). */
import type { System } from "../engine/world";

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

export const PowerSystem: System = {
  id: "power", order: 60,
  init(world) {
    const offs: Array<() => void> = [];
    offs.push(world.on("power:drain", ({ source, value }) => {
      const power = world.state.power;
      if (source === "phone") {
        if (world.flag("phone.lost", false)) return;
        const next = clamp(power.phone - value, 0, 100);
        world.patch("power", { phone: next });
        world.set("phone", { ...world.state.phone, battery: Math.round(next) });
        if (next <= 0 && power.phone > 0) world.emit("power:dead", { source: "phone" });
      } else if (source === "camera") {
        const next = clamp(power.camera - value, 0, 100);
        world.patch("power", { camera: next });
        if (next <= 0 && power.camera > 0) world.emit("power:dead", { source: "camera" });
      } else {
        // The lamp never truly dies: it drops to an ember at 0.15 (she walked out).
        const next = clamp(power.lamp - value, 0.15, 1);
        world.patch("power", { lamp: next, lampOut: next <= 0.15 });
        if (next <= 0.15 && !power.lampOut) world.emit("power:dead", { source: "lamp" });
      }
    }));
    offs.push(world.on("phone:open", () => {
      const night = world.state.clock.minuteOfDay >= world.state.clock.sunsetMinute && world.state.clock.day === 1;
      world.emit("power:drain", { source: "phone", value: night ? 4 : 1, reason: "开屏" });
      world.emit("clock:advance", { minutes: 1, reason: "看手机" });
      if (night) world.emit("body:fear", { delta: 0.12, reason: "屏幕毁了夜视" });
    }));
    offs.push(world.on("lamp:mode", ({ mode }) => { world.patch("power", { lampMode: mode }); }));
    // The lamp drains with the night's minutes once it is out of the pack.
    offs.push(world.on("clock:advance", ({ minutes }) => {
      const { lampMode } = world.state.power;
      if (!lampMode || world.state.clock.day !== 1) return;
      world.emit("power:drain", { source: "lamp", value: minutes * (lampMode === "wide" ? 0.016 : 0.009) / 10, reason: "补光灯" });
    }));
    // Facts: camera dead at the forest edge; phone at 8% after the 112 call.
    offs.push(world.on("scene:enter", ({ scene }) => {
      if (scene === "forestEdge" && world.state.power.camera > 0) { world.patch("power", { camera: 0 }); world.emit("power:dead", { source: "camera" }); }
      if (scene === "forestEdge" && world.state.power.phone > 9) { world.patch("power", { phone: 9 }); world.set("phone", { ...world.state.phone, battery: 9 }); }
    }));
    return () => offs.forEach((off) => off());
  },
};
