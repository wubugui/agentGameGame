/* Boot: build the one world for this page. No React here. */
import { loadSave } from "./engine/save";
import { createInitialState, createWorld, type World } from "./engine/world";
import { loadSettings } from "./settings";
import { browserSystems } from "./systems";
import "./scenes";

export function bootWorld(): World {
  const saved = loadSave();
  const state = saved ? { ...saved, phase: "title" as const } : createInitialState(loadSettings());
  const world = createWorld({ systems: browserSystems(), state });
  world.rt.hasSave = Boolean(saved);
  return world;
}
