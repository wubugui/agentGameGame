/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (hutTurn). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "hutTurn",
  day: 1, place: "往山屋的路上", elevation: "2,720 m",
  painting: "pano/09d-hutturn.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 16 * 60 + 25,
  entities: [
    backArrow("back", { yaw: 0, pitch: -6 }, "hutView", "回头", 23),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
