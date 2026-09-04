/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (plateau). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "plateau",
  day: 1, place: "Sella 高原", elevation: "2,800 m",
  painting: "pano/09-plateau.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 15 * 60 + 35,
  entities: [
    goArrow("go", { yaw: 12, pitch: -4 }, { to: "hutView", minutes: 25, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
