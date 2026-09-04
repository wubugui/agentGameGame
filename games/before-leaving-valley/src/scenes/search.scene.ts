/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (search). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "search",
  day: 2, place: "森林小路 · 第二天", elevation: "1,820 m",
  painting: "pano/18-search.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  chapter: { eyebrow: "第二天", title: "重返森林小路" },
  arriveAt: 8 * 60 + 40,
  entities: [
    goArrow("go", { yaw: 0, pitch: -4 }, { to: "hotel", minutes: 0, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
