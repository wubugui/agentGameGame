/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (summit). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "summit",
  day: 1, place: "Piz Selva 山顶", elevation: "2,941 m",
  painting: "pano/08-summit.webp",
  body: "stand", material: "rock",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  chapter: { eyebrow: "2,941 m", title: "登顶" },
  arriveAt: 15 * 60 + 15,
  entities: [
    goArrow("go", { yaw: 30, pitch: 0 }, { to: "plateau", minutes: 20, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
