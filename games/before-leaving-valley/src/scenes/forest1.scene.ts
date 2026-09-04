/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (forest1). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "forest1",
  day: 1, place: "森林小路 · 上段", elevation: "1,900 m",
  painting: "pano/14-forest-1.webp",
  body: "crawl", material: "soft",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: 0, heater: 0 },
  arriveAt: 20 * 60 + 45,
  entities: [
    goArrow("go", { yaw: -4, pitch: -6 }, { to: "forest2", minutes: 50, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
