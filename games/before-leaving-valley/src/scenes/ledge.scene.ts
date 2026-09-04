/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (ledge). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "ledge",
  day: 1, place: "高原边缘 · 岩唇", elevation: "2,790 m",
  painting: "pano/09c-ledge.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 15 * 60 + 45,
  entities: [
    backArrow("back", { yaw: 0, pitch: -6 }, "plateau", "回头", 12),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
