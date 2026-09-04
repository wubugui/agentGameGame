/* Scene order and the scene lifecycle: enter / exit, scripts, seeds. */
import { testCondition } from "./condition";
import type { EntityView } from "./entity";
import { resolveTransform } from "./entity";
import { makeSceneCtx, SCENES, type SceneDef } from "./scene";
import { SCENE_IDS, type SceneId } from "./types";
import type { World } from "./world";

/** The main line. Side scenes (slab, ledge, hutTurn, hutView detour, searchWall, searchPath) hang off it. */
export const MAIN_ORDER: SceneId[] = [
  "roadside", "meadow", "approach", "plaque", "cable", "crack", "mailbox", "exit", "summit", "plateau", "hutView",
  "signpost", "scree", "deer", "forestEdge", "forest1", "forest2", "hairpin", "car", "search", "hotel", "busStop", "police", "bench",
];
export const SCENE_ORDER = SCENE_IDS;
export const sceneIndex = (id: SceneId) => MAIN_ORDER.indexOf(id);

export function sceneOf(world: World): SceneDef {
  const def = SCENES[world.state.sceneId];
  if (!def) throw new Error(`scene ${world.state.sceneId} is not registered`);
  return def;
}

/** Leave the current scene (tear down its script) and enter another. */
export function enterScene(world: World, target: SceneId, options: { from?: SceneId | null; warped?: boolean } = {}) {
  const previous = world.state.sceneId;
  const from = options.from === undefined ? previous : options.from;
  if (world.state.scenes[previous]?.visited && previous !== target) world.emit("scene:exit", { scene: previous, to: target });
  world.rt.sceneUnsubs.forEach((off) => off());
  world.rt.sceneUnsubs = [];
  world.rt.timers.forEach((id) => window.clearTimeout(id));
  world.rt.timers.clear();
  world.rt.views.clear();
  world.rt.hold = null;
  world.set("previousSceneId", previous);
  world.set("sceneId", target);
  world.markSceneEntered(target);
  const def = SCENES[target];
  if (!def) throw new Error(`scene ${target} is not registered`);
  world.patch("clock", { day: def.day, date: dateOfDay(def.day) });
  const dispose = def.script?.(makeSceneCtx(world, def));
  if (dispose) world.sceneUnsub(dispose);
  world.emit("scene:enter", { scene: target, from, warped: Boolean(options.warped) });
}

export function dateOfDay(day: 1 | 2 | 3) {
  return { year: 2025, month: 7, day: day === 1 ? 30 : day === 2 ? 31 : 1 } as { year: number; month: number; day: number };
}

export function dateFor(day: 1 | 2 | 3) {
  return day === 3 ? { year: 2025, month: 8, day: 1 } : { year: 2025, month: 7, day: day === 1 ? 30 : 31 };
}

/** Everything the view should draw for the current scene, visibility resolved. */
export function buildViews(world: World): EntityView[] {
  const scene = sceneOf(world);
  const state = world.state;
  const views: EntityView[] = [];
  for (const def of scene.entities) {
    if (!testCondition(state, def.visible)) continue;
    const entityState = state.scenes[scene.id]?.entities[def.id];
    if (entityState?.hidden) continue;
    if (def.collectible && entityState?.taken) continue;
    if (def.exit && def.exit.condition && !testCondition(state, def.exit.condition)) continue;
    if (def.exit && !def.exit.condition && scene.exitWhen && def.exit.kind !== "back" && !testCondition(state, scene.exitWhen)) continue;
    const disabled = !testCondition(state, def.enabled);
    let sprite: EntityView["sprite"];
    if (def.sprite) {
      const swap = def.sprite.swap?.find((entry) => testCondition(state, entry.when));
      sprite = { src: swap?.src ?? def.sprite.src, className: swap?.className ?? def.sprite.className ?? "", sizeVh: def.sprite.sizeVh };
    }
    const kind: EntityView["kind"] = def.exit ? "exit" : def.hold ? "hold" : def.blaze ? "blaze" : def.interactable ? "hotspot" : "prop";
    views.push({
      id: def.id,
      transform: resolveTransform(world, def.transform),
      reveal: def.interactable?.reveal ?? def.gaze?.radius ?? 0,
      label: def.interactable?.label ?? def.exit?.label,
      verbs: def.interactable?.verbs,
      sprite,
      disabled,
      kind,
      className: def.className,
      keyHint: def.interactable?.keyHint,
    });
  }
  return views;
}

export const canLeave = (world: World) => testCondition(world.state, sceneOf(world).exitWhen);
