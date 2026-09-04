/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (deer). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "deer",
  day: 1, place: "坡脚 · 林线", elevation: "2,050 m",
  painting: "pano/12-deer.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 19 * 60 + 20,
  entities: [
    goArrow("go", { yaw: -6, pitch: -4 }, { to: "forestEdge", minutes: 55, label: "往前", kind: "run" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
