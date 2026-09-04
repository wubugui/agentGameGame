/* The one clock. Minutes, light, and marks the day passes on its way (17:00 the hut window, 20:15 sunset). */
import { advanceClockOnly } from "../phoneModel";
import { lightOf } from "../engine/condition";
import type { System } from "../engine/world";
import { formatGameTime } from "../phoneModel";

export const CLOCK_MARKS = [
  { minute: 17 * 60, tag: "hut-window-lit" },
  { minute: 18 * 60, tag: "crickets-in" },
  { minute: 19 * 60 + 30, tag: "wind-turns" },
  { minute: 20 * 60 + 15, tag: "sunset" },
  { minute: 21 * 60 + 5, tag: "last-light" },
];

export const ClockSystem: System = {
  id: "clock", order: 40,
  init(world) {
    let lastLight = lightOf(world.state);
    const fired = new Set<string>();
    const off = world.on("clock:advance", ({ minutes, reason }) => {
      const before = world.state.clock.minuteOfDay;
      const whole = Math.max(0, Math.round(minutes));
      if (whole <= 0) return;
      const after = before + whole;
      world.patch("clock", { minuteOfDay: after });
      world.set("phone", advanceClockOnly(world.state.phone, whole));
      world.patch("stats", { minutesSpent: world.state.stats.minutesSpent + whole });
      if (world.state.clock.day === 1) {
        for (const mark of CLOCK_MARKS) {
          if (before < mark.minute && after >= mark.minute && !fired.has(mark.tag)) { fired.add(mark.tag); world.emit("clock:mark", { minute: mark.minute, tag: mark.tag }); }
        }
      }
      const light = lightOf(world.state);
      if (Math.abs(light - lastLight) > 0.004) { world.emit("clock:light", { light, previous: lastLight }); lastLight = light; }
      if (import.meta.env.DEV) world.rt.log.push(`+${whole}′ ${reason} → ${formatGameTime(after)}`);
    });
    const offEnter = world.on("scene:enter", () => { lastLight = lightOf(world.state); });
    return () => { off(); offEnter(); };
  },
};
