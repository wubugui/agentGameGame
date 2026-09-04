/* Command → condition check → cost → interact:done. Holds, exits and waiting live here too. */
import { testCondition } from "../engine/condition";
import { resolveTransform } from "../engine/entity";
import { enterScene, sceneOf, canLeave } from "../engine/registry";
import { findEntity, spend, SCENES } from "../engine/scene";
import type { SceneId } from "../engine/types";
import { isSceneId } from "../engine/types";
import type { System, World } from "../engine/world";
import { checkInvariants } from "../engine/policy";

export function holdMs(world: World, base: number, scaleWith: Array<"fear" | "fatigue" | "lamp"> = ["fear", "fatigue"]) {
  const { fear, fatigue } = world.state.body;
  const lampFactor = scaleWith.includes("lamp") && world.state.power.lampOut ? 2 : 1;
  const settingsFactor = world.state.settings.holdScale ?? 1;
  return base * (1 + (scaleWith.includes("fear") ? fear * 0.9 : 0) + (scaleWith.includes("fatigue") ? fatigue * 0.6 : 0)) * lampFactor * settingsFactor;
}

function beginTravel(world: World, to: SceneId, run: boolean, minutes: number, battery = 0) {
  if (world.state.ui.travel) return;
  const from = world.state.sceneId;
  const ms = world.state.settings.motion ? (run ? 1500 : 1800) : 900;
  world.patch("ui", { travel: { to, run, started: world.rt.now, ms }, overlay: null, phoneOpen: false });
  world.emit("travel:begin", { from, to, run, ms });
  world.after(ms, () => {
    spend(world, { minutes, battery }, `走到 ${to}`);
    world.patch("ui", { travel: null });
    enterScene(world, to, { from });
    world.emit("travel:arrive", { scene: to });
    checkInvariants(world);
  });
}

export const InteractionSystem: System = {
  id: "interaction", order: 30,
  init(world) {
    const offs: Array<() => void> = [];

    offs.push(world.handle("interact", ({ entity, verb }) => {
      const scene = sceneOf(world);
      const def = findEntity(scene, entity);
      if (!def) return world.emit("interact:refused", { entity, verb, reason: "gone" });
      if (def.exit) { world.dispatch({ type: "travel", entity }); return; }
      if (!def.interactable || !def.interactable.verbs.includes(verb)) return world.emit("interact:refused", { entity, verb, reason: "gone" });
      const state = world.state;
      if (!testCondition(state, def.visible) || !testCondition(state, def.enabled)) return world.emit("interact:refused", { entity, verb, reason: "condition" });
      if (def.interactable.once && (state.scenes[scene.id]?.entities[entity]?.used ?? 0) > 0) return world.emit("interact:refused", { entity, verb, reason: "gone" });
      if (def.interactable.requires && !testCondition(state, def.interactable.requires)) {
        // She would not do this: the hand goes out and comes back. No text.
        world.emit("hand:reach", { transform: resolveTransform(world, def.transform), kind: "grip", hold: false });
        world.emit("camera:impulse", { kind: "glance", strength: 0.5, dir: { yaw: 0, pitch: -4 } });
        world.emit("sfx", { name: "tock" });
        return world.emit("interact:refused", { entity, verb, reason: "condition" });
      }
      world.emit("interact:attempt", { entity, verb });
      const cost = def.interactable.cost ?? {};
      spend(world, cost, `${entity}:${verb}`);
      world.entity(entity).patch({ used: (state.scenes[scene.id]?.entities[entity]?.used ?? 0) + 1 });
      if (def.readable && verb === "read") {
        world.entity(entity).patch({ read: true });
        world.patch("ui", { reading: { title: def.readable.title, lines: def.readable.lines, kind: def.readable.kind }, overlay: "reading" });
        if (def.readable.minutes) spend(world, { minutes: def.readable.minutes }, `读 ${entity}`);
        if (def.readable.entry) world.emit("journal:entry", { entry: def.readable.entry, source: entity });
        world.emit("sfx", { name: "paper" });
      }
      if (def.collectible && verb === "take") {
        world.entity(entity).patch({ taken: true });
        world.emit("item:gain", { item: def.collectible.item, from: entity });
        world.emit("hand:reach", { transform: resolveTransform(world, def.transform), kind: "grip", hold: false });
      }
      if (def.blaze && verb === "inspect") {
        world.entity(entity).patch({ read: true });
        world.emit("blaze:confirm", { entity, real: def.blaze.real });
      }
      if (def.hold && verb === "hold") { world.dispatch({ type: "hold:start", entity }); return; }
      world.emit("interact:done", { entity, verb, cost });
    }));

    offs.push(world.handle("hold:start", ({ entity }) => {
      const def = findEntity(sceneOf(world), entity);
      if (!def?.hold || world.rt.hold) return;
      if (def.interactable?.requires && !testCondition(world.state, def.interactable.requires)) { world.emit("sfx", { name: "tock" }); return; }
      if (world.rt.growling) return;                        // a growl takes the hand
      world.rt.hold = { entity, start: world.rt.now, required: holdMs(world, def.hold.ms, def.hold.scaleWith) };
      world.emit("hand:reach", { transform: resolveTransform(world, def.transform), kind: "grip", hold: true });
      world.emit("sfx", { name: "grip" });
    }));

    offs.push(world.handle("hold:end", () => {
      const hold = world.rt.hold;
      if (!hold) return;
      const progress = (world.rt.now - hold.start) / hold.required;
      world.rt.hold = null;
      world.emit("hold:progress", { entity: hold.entity, progress: 0 });
      if (progress < 1) world.emit("hold:release", { entity: hold.entity, progress });
    }));

    offs.push(world.handle("travel", ({ entity }) => {
      if (entity.startsWith("__to:")) {
        const [, to, mode, minutes] = entity.split(":");
        if (isSceneId(to)) beginTravel(world, to, mode === "run", Number(minutes) || 0);
        return;
      }
      const scene = sceneOf(world);
      const def = findEntity(scene, entity);
      if (!def?.exit) return;
      if (def.exit.condition ? !testCondition(world.state, def.exit.condition) : (def.exit.kind !== "back" && !canLeave(world))) return world.emit("interact:refused", { entity, verb: "inspect", reason: "condition" });
      if (!SCENES[def.exit.to]) { console.error(`[travel] scene ${def.exit.to} missing`); return; }
      beginTravel(world, def.exit.to, def.exit.kind === "run", def.exit.minutes, def.exit.battery);
    }));

    offs.push(world.handle("wait", () => { world.emit("input:wait", { seconds: 4 }); }));

    offs.push(world.handle("dev:warp", ({ scene }) => { enterScene(world, scene, { from: null, warped: true }); }));

    return () => offs.forEach((off) => off());
  },
  tick(world) {
    const hold = world.rt.hold;
    if (!hold) return;
    const progress = Math.min(1, (world.rt.now - hold.start) / hold.required);
    world.emit("hold:progress", { entity: hold.entity, progress });
    if (progress >= 1) {
      const def = findEntity(sceneOf(world), hold.entity);
      world.rt.hold = null;
      world.emit("hold:progress", { entity: hold.entity, progress: 0 });
      if (def?.interactable?.cost) spend(world, def.interactable.cost, `${hold.entity}:hold`);
      world.emit("hold:complete", { entity: hold.entity });
      world.emit("interact:done", { entity: hold.entity, verb: "hold", cost: def?.interactable?.cost ?? {} });
    }
  },
};
