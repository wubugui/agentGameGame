/* Passo Sella meadow: the first blaze lesson, the chapel, the wall at the end of the grass. */
import { after, all, before, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import { blaze, goArrow, lookAt, wrongWay } from "./_shared";

export default defineScene({
  id: "meadow",
  day: 1, place: "Passo Sella · 山口草甸", elevation: "2,240 m",
  painting: "pano/01-meadow.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.45, windTone: 950, birds: 0.6, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen" },
  arriveAt: 9 * 60 + 50,
  idleLook: true,
  fallback: "教练说的那面墙，就在草地尽头。",
  entities: [
    blaze("blaze-meadow", { yaw: -15, pitch: -25 }, true),
    blaze("lichen-meadow", { yaw: 9, pitch: -22 }, false),
    lookAt("chapel", { yaw: 6, pitch: -6, distance: 14 }, "白色小教堂", 1),
    lookAt("wall", { yaw: -12, pitch: 10, distance: 20 }, "石墙上的路线", 1),
    { id: "cloud-shadow", transform: { yaw: -8, pitch: 14, distance: 22 }, gaze: { radius: 14, dwell: 1200 }, visible: all(after(10 * 60), before(10 * 60 + 12)) },
    wrongWay("chapel-track", { yaw: 24, pitch: -14 }, "右边通向教堂的土路", 10, "土路绕到了教堂门口。木屋，一条狗。不是这条。"),
    goArrow("go", { yaw: 11, pitch: -18 }, { to: "approach", minutes: 20, label: "往石墙走", kind: "walk" }),
  ],
  exitWhen: undefined,
  seed: (w) => { w.setFlag("meadow.certain", true); w.patch("journal", { blazesLearned: true }); },
  script: (ctx) => {
    ctx.onInteract("chapel", () => ctx.say("有钟声。十点了。", { tag: "meadow-chapel" }));
    ctx.onInteract("wall", () => ctx.say("从这里看，墙上有一条线。那就是路。", { tag: "meadow-wall" }));
    ctx.onGaze("cloud-shadow", () => ctx.say("云影从墙上走过去。", { tag: "meadow-cloud" }));
    ctx.onInteract("chapel-track", () => { ctx.say("土路绕到了教堂门口。不是这条。", { tag: "meadow-wrong" }); ctx.kick("settle", 0.6); });
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (entity === "lichen-meadow" && !real) ctx.say("地衣。橙灰色的，不是漆。", { tag: "meadow-lichen" });
    });
    // Leaving without the blaze costs eight minutes of looking for the path (v4 §3.5)
    ctx.on("travel:begin", ({ from, to }) => { if (from === "meadow" && to === "approach" && !ctx.flag("meadow.certain", false)) { ctx.spend({ minutes: 8 }, "没认记号，找了一段路"); ctx.say("走错了一小段。", { tag: "meadow-lost", priority: 1 }); } });
    void flag; void not;
  },
});
