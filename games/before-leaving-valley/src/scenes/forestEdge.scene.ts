/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (forestEdge). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "forestEdge",
  day: 1, place: "林缘 · 天黑", elevation: "1,980 m",
  painting: "pano/13-forest-edge.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: 0, heater: 0 },
  chapter: { eyebrow: "夜", title: "我也得进去" },
  arriveAt: 20 * 60 + 15,
  entities: [
    goArrow("go", { yaw: 2, pitch: -2 }, { to: "forest1", minutes: 30, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
