/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (forest2). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "forest2",
  day: 1, place: "森林小路 · 下段", elevation: "1,780 m",
  painting: "pano/15-forest-2.webp",
  body: "crawl", material: "soft",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: 0, heater: 0 },
  arriveAt: 21 * 60 + 35,
  entities: [
    goArrow("go", { yaw: 6, pitch: -4 }, { to: "hairpin", minutes: 70, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
