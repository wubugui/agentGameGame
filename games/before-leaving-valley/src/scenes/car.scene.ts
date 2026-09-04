/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (car). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "car",
  day: 1, place: "他们的车 · 回酒店的路", elevation: "1,500 m",
  painting: "pano/17-car.webp",
  body: "ride", material: "road",
  ambience: { wind: 0.05, windTone: 1100, birds: 0, crickets: 0, stream: 0, engine: 0.6, heater: 0.7 },
  interior: true,
  arriveAt: 23 * 60 + 10,
  entities: [
    goArrow("go", { yaw: 0, pitch: 0 }, { to: "search", minutes: 0, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
