/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (hairpin). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "hairpin",
  day: 1, place: "盘山公路 · 急转弯", elevation: "1,700 m",
  painting: "pano/16-hairpin.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: 0, heater: 0 },
  chapter: { eyebrow: "谷底", title: "最原始的方式" },
  arriveAt: 22 * 60 + 45,
  entities: [
    goArrow("go", { yaw: 0, pitch: -2 }, { to: "car", minutes: 25, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
