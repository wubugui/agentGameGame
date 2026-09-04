/* STUB — replace with the full scene per docs/GAME_DESIGN_v4.md §8 (roadside). */
import { defineScene } from "../engine/scene";
import { backArrow, goArrow } from "./_shared";

export default defineScene({
  id: "roadside",
  day: 1, place: "", elevation: "",
  painting: "",
  body: "stand", material: "road",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  arriveAt: 9 * 60 + 40,
  entities: [

  ],
  seed: () => undefined,
  script: () => undefined,
});
void backArrow; void goArrow;
