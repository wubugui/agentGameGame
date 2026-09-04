/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (hotel). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "hotel",
  day: 2, place: "酒店房间 · 晚上", elevation: "1,450 m",
  painting: "pano/19-hotel.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.05, windTone: 1100, birds: 0, crickets: 0, stream: 0, engine: 0, heater: 0.16 },
  interior: true,
  arriveAt: 20 * 60 + 15,
  entities: [
    goArrow("go", { yaw: 0, pitch: 0 }, { to: "busStop", minutes: 0, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
