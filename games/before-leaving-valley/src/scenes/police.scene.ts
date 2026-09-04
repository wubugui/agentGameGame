/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (police). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "police",
  day: 3, place: "警察局", elevation: "1,460 m",
  painting: "pano/21-police.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.05, windTone: 1100, birds: 0, crickets: 0, stream: 0, engine: 0, heater: 0.16 },
  interior: true,
  arriveAt: 10 * 60 + 5,
  entities: [
    goArrow("go", { yaw: 0, pitch: 0 }, { to: "bench", minutes: 0, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
