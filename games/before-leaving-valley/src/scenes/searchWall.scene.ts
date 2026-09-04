/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (searchWall). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "searchWall",
  day: 2, place: "Sassolungo 石墙下 · 第二天", elevation: "1,860 m",
  painting: "pano/18b-searchwall.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 9 * 60 + 30,
  entities: [
    backArrow("back", { yaw: 0, pitch: -6 }, "search", "回头", 0),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
