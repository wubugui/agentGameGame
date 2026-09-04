/* Looking is the search. Reveal radii breathe with light, fatigue and the lamp; hard floor 11°. */
import { lightOf, testCondition } from "../engine/condition";
import { resolveTransform } from "../engine/entity";
import { sceneOf } from "../engine/registry";
import type { System, World } from "../engine/world";

export const REVEAL_FLOOR = 11;

export function revealRadius(world: World, base: number) {
  if (world.rt.forceReveal) return 999;
  const state = world.state;
  const light = lightOf(state);
  const lamp = state.power.lampMode;
  const night = light <= 0;
  const lampFactor = !night ? 1 : lamp === "narrow" ? 0.5 : lamp === "wide" ? 1.15 : 0.7;
  const lampOut = night && state.power.lampOut ? 0.45 : 1;
  const cap = state.inventory.worn.includes("cap") && light > 0.6 ? 1.1 : 1;
  return Math.max(REVEAL_FLOOR, base * (0.55 + 0.45 * light) * (1 - state.body.fatigue * 0.35) * lampFactor * lampOut * cap);
}

export const GazeSystem: System = {
  id: "gaze", order: 20,
  tick(world, dt) {
    if (world.state.phase !== "play" || world.state.ui.travel) return;
    const scene = sceneOf(world);
    const gaze = world.rt.gaze;
    const state = world.state;
    const seen = new Set<string>();
    for (const def of scene.entities) {
      if (!def.interactable && !def.gaze && !def.trigger) continue;
      if (!testCondition(state, def.visible)) continue;
      const entityState = state.scenes[scene.id]?.entities[def.id];
      if (entityState?.hidden || (def.collectible && entityState?.taken)) continue;
      seen.add(def.id);
      let view = world.rt.views.get(def.id);
      const transform = resolveTransform(world, def.transform);
      if (!view) { view = { id: def.id, node: null, transform: { yaw: transform.yaw, pitch: transform.pitch, distance: transform.distance ?? 10 }, gazing: false, dwell: 0, fired: false }; world.rt.views.set(def.id, view); }
      view.transform = { yaw: transform.yaw, pitch: transform.pitch, distance: transform.distance ?? 10 };
      const base = def.interactable?.reveal ?? def.gaze?.radius ?? 14;
      const radius = revealRadius(world, base);
      const node = world.rt.nodes.get(def.id);
      if (node) node.dataset.reveal = radius.toFixed(1);
      const distance = Math.hypot(transform.yaw - gaze.yaw, (transform.pitch - gaze.pitch) * 1.4);
      const inside = distance <= Math.max(radius * 0.55, 7);
      if (inside && !view.gazing) { view.gazing = true; view.dwell = 0; world.emit("gaze:enter", { entity: def.id, degrees: distance }); }
      else if (!inside && view.gazing) { view.gazing = false; view.dwell = 0; world.emit("gaze:leave", { entity: def.id }); }
      if (view.gazing) {
        view.dwell += dt * 1000;
        const need = def.gaze?.dwell ?? (def.trigger?.source.on === "gaze" ? def.trigger.source.dwell : 0);
        if (need && view.dwell >= need && !view.fired) {
          if (!def.trigger || testCondition(state, def.trigger.when)) { view.fired = true; world.emit("gaze:dwell", { entity: def.id, ms: view.dwell }); }
        }
      }
    }
    for (const id of Array.from(world.rt.views.keys())) if (!seen.has(id)) world.rt.views.delete(id);

    // Waiting: the pointer still for 4 s is the only rest, and the only trigger for things you see only after a while.
    if (state.ui.overlay || state.ui.phoneOpen || state.ui.menuOpen) { world.rt.stillFor = 0; return; }
    world.rt.stillFor = world.rt.gazeMoved ? 0 : world.rt.stillFor + dt;
    if (world.rt.stillFor >= 4 && !world.rt.waited) { world.rt.waited = true; world.dispatch({ type: "wait" }); }
    if (world.rt.stillFor >= 12) { world.rt.stillFor = 4; world.rt.waited = false; }   // keep resting: another wait every 8 s
    if (world.rt.stillFor < 4) world.rt.waited = false;
  },
};
