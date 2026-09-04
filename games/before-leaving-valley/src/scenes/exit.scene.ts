/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (exit). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "exit",
  day: 1, place: "飞拉达 · 顶段出口", elevation: "2,860 m",
  painting: "pano/07-exit.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 13 * 60 + 25,
  entities: [
    goArrow("go", { yaw: -8, pitch: 12 }, { to: "summit", minutes: 110, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
