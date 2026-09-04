/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (bench). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "bench",
  day: 3, place: "Canazei · 公交站长椅", elevation: "1,460 m",
  painting: "pano/22-bench.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 11 * 60 + 50,
  entities: [

  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
