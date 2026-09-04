/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (searchPath). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "searchPath",
  day: 2, place: "昨晚的小路 · 第二天", elevation: "1,800 m",
  painting: "pano/18c-searchpath.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 10 * 60,
  entities: [
    backArrow("back", { yaw: 0, pitch: -6 }, "search", "回头", 0),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
