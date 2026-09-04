/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (scree). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "scree",
  day: 1, place: "Val Lasties · 碎石坡", elevation: "2,300 m",
  painting: "pano/11-scree.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 17 * 60 + 40,
  entities: [
    goArrow("go", { yaw: 8, pitch: -14 }, { to: "deer", minutes: 100, label: "往前", kind: "run" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
