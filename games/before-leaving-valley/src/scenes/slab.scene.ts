/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (slab). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "slab",
  day: 1, place: "飞拉达 · 走错的岩台", elevation: "2,372 m",
  painting: "pano/05b-slab.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 12 * 60 + 20,
  entities: [
    backArrow("back", { yaw: 0, pitch: -6 }, "crack", "回头", 20),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
