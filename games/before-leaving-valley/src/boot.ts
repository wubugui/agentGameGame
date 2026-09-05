/* Boot: build the one world for this page. No React here. */
import { loadSave } from "./engine/save";
import { createInitialState, createWorld, type World } from "./engine/world";
import { loadSettings } from "./settings";
import { browserSystems } from "./systems";
import "./scenes";

/** The engine's own frame loop: systems tick whether or not a scene view is mounted (title, overlays, headless). */
function startLoop(world: World) {
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    world.rt.now = now;
    world.tick(dt, world.rt.gaze);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function bootWorld(): World {
  const saved = loadSave();
  const state = saved ? { ...saved, phase: "title" as const } : createInitialState(loadSettings());
  const world = createWorld({ systems: browserSystems(), state });
  world.rt.hasSave = Boolean(saved);
  startLoop(world);
  return world;
}
