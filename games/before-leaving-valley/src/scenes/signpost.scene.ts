/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (signpost). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "signpost",
  day: 1, place: "岔口 · 路牌", elevation: "2,455 m",
  painting: "pano/10-signpost.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  chapter: { eyebrow: "决定", title: "紧急下撤" },
  arriveAt: 17 * 60,
  entities: [
    goArrow("go", { yaw: -30, pitch: -8 }, { to: "scree", minutes: 40, label: "往前", kind: "run" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
