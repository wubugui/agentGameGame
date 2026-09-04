/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (busStop). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "busStop",
  day: 3, place: "Passo Sella · 公交站", elevation: "2,240 m",
  painting: "pano/20-bus-stop.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  chapter: { eyebrow: "第三天", title: "离开多洛米蒂" },
  arriveAt: 9 * 60 + 5,
  entities: [
    goArrow("go", { yaw: 0, pitch: 0 }, { to: "police", minutes: 0, label: "往前", kind: "walk" }),
  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
