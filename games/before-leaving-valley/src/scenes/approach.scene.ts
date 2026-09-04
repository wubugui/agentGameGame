/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (approach). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "approach",
  day: 1, place: "Sella 石墙脚下 · 碎石路", elevation: "2,300 m",
  painting: "pano/02-approach.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 10 * 60 + 10,
  entities: [
    goArrow("go", { yaw: -5, pitch: -7 }, { to: "plaque", minutes: 15, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
