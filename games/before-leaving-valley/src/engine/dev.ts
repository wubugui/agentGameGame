/* ?node= / ?time= / ?reveal= / ?fatigue= and the handles the headless tools drive. */
import { MAIN_ORDER, enterScene } from "./registry";
import { SCENES } from "./scene";
import { resolveTransform, type EntityDef } from "./entity";
import { isItemId, isSceneId, type SceneId } from "./types";
import type { World } from "./world";
import type { Command } from "./command";

const SIDE_PARENT: Partial<Record<SceneId, SceneId>> = { slab: "crack", ledge: "plateau", hutTurn: "hutView", searchWall: "search", searchPath: "search" };

export function warpTo(world: World, target: SceneId) {
  const mainTarget = SIDE_PARENT[target] ?? target;
  for (const id of MAIN_ORDER) {
    if (id === mainTarget) break;
    const def = SCENES[id];
    def?.seed?.(world);
    world.markSceneEntered(id);
  }
  const def = SCENES[target];
  if (!def) return;
  world.patch("clock", { day: def.day, minuteOfDay: def.arriveAt ?? 9 * 60 + 40 });
  world.set("phone", { ...world.state.phone, minuteOfDay: def.arriveAt ?? 9 * 60 + 40, date: def.day === 3 ? { year: 2025, month: 8, day: 1 } : { year: 2025, month: 7, day: def.day === 1 ? 30 : 31 } });
  world.set("phase", "play");
  enterScene(world, target, { from: null, warped: true });
}

export function parseHHMM(value: string) {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function applyDevParams(world: World) {
  if (!import.meta.env.DEV) return false;
  const q = new URLSearchParams(window.location.search);
  const node = q.get("node");
  let warped = false;
  if (isSceneId(node)) { warpTo(world, node); warped = true; }
  const time = q.get("time"); if (time) { world.patch("clock", { minuteOfDay: parseHHMM(time) }); world.set("phone", { ...world.state.phone, minuteOfDay: parseHHMM(time) }); }
  const fatigue = q.get("fatigue"); if (fatigue) world.patch("body", { fatigue: Number(fatigue) });
  const fear = q.get("fear"); if (fear) world.patch("body", { fear: Number(fear) });
  q.getAll("give").filter(isItemId).forEach((item) => world.emit("item:gain", { item, from: null }));
  if (q.get("reveal") === "1") world.rt.forceReveal = true;
  if (q.get("nosave") === "1") world.rt.noSave = true;
  const w = window as unknown as { __world: World; __cmd: (c: Command) => void; __log: string[]; __scenes: typeof SCENES; __resolve: (e: EntityDef) => ReturnType<typeof resolveTransform> };
  w.__world = world;
  w.__cmd = (command) => world.dispatch(command);
  w.__log = world.rt.log;
  w.__scenes = SCENES;
  w.__resolve = (entity) => resolveTransform(world, entity.transform);
  return warped;
}
