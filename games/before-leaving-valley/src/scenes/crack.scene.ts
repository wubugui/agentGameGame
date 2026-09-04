/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (crack). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "crack",
  day: 1, place: "飞拉达 · 裂缝", elevation: "2,368 m",
  painting: "pano/05-crack.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 12 * 60,
  entities: [
    goArrow("go", { yaw: 4, pitch: 18 }, { to: "mailbox", minutes: 60, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
