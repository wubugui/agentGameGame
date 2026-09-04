/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (mailbox). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "mailbox",
  day: 1, place: "飞拉达 · 半途悬崖", elevation: "2,379 m",
  painting: "pano/06-mailbox.webp",
  body: "stand", material: "rock",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 13 * 60,
  entities: [
    goArrow("go", { yaw: 22, pitch: 14 }, { to: "exit", minutes: 25, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
