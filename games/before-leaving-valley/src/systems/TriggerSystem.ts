/* Scene triggers (enter / minute / idle / event / flag) and the small memories the world keeps. */
import { testCondition } from "../engine/condition";
import { sceneOf } from "../engine/registry";
import type { System } from "../engine/world";

export const TriggerSystem: System = {
  id: "trigger", order: 90,
  init(world) {
    const offs: Array<() => void> = [];
    const firedOnce = new Set<string>();
    const fire = (entityId: string, tag: string, once?: boolean) => {
      const key = `${world.state.sceneId}:${entityId}:${tag}`;
      if (once && firedOnce.has(key)) return;
      firedOnce.add(key);
      world.emit("gaze:dwell", { entity: entityId, ms: 0 });
      world.setFlag(`trigger.${key}`, true);
    };
    const scan = (kind: "enter" | "minute" | "idle" | "flag", payload?: { minute?: number; seconds?: number; key?: string; value?: unknown }) => {
      const scene = sceneOf(world);
      for (const def of scene.entities) {
        const trigger = def.trigger;
        if (!trigger || !testCondition(world.state, def.visible) || !testCondition(world.state, trigger.when)) continue;
        const source = trigger.source;
        if (source.on === "enter" && kind === "enter") fire(def.id, trigger.tag, trigger.once);
        if (source.on === "minute" && kind === "minute" && payload?.minute !== undefined && payload.minute >= source.at) fire(def.id, trigger.tag, trigger.once ?? true);
        if (source.on === "idle" && kind === "idle" && (payload?.seconds ?? 0) >= source.seconds) fire(def.id, trigger.tag, trigger.once);
        if (source.on === "flag" && kind === "flag" && payload?.key === source.key && payload.value === source.eq) fire(def.id, trigger.tag, trigger.once ?? true);
      }
    };
    offs.push(world.on("scene:enter", () => scan("enter")));
    offs.push(world.on("clock:advance", () => scan("minute", { minute: world.state.clock.minuteOfDay })));
    offs.push(world.on("input:wait", ({ seconds }) => scan("idle", { seconds: world.rt.stillFor || seconds })));
    offs.push(world.on("flag:set", ({ key, value }) => scan("flag", { key, value })));
    return () => offs.forEach((off) => off());
  },
};
