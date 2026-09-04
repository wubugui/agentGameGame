/* The plateau edge: the hut across the valley, the map for the eighth time, the decision. */
import { after, flag, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import { blaze, goArrow, prop, windy } from "./_shared";

const CHOICE = "hutView.choice";
const SPREAD = "hutView.mapSpread";

export default defineScene({
  id: "hutView",
  day: 1, place: "高原边缘 · 望见山屋", elevation: "2,760 m",
  painting: "pano/09b-hut.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.7, windTone: 1350, birds: 0, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", clouds: true, gusty: true, windPan: 0.25 },
  arriveAt: 16 * 60,
  idleLook: true,
  fallback: "山屋就在对面。隔着一整个山谷。",
  exitWhen: flag(CHOICE, { eq: "retreat" }),
  entities: [
    { id: "hut", transform: { yaw: 26, pitch: 5, distance: 25 }, sprite: { src: "sprites/hut-far.webp", layer: "prop", sizeVh: 2.2, swap: [{ when: after(17 * 60), src: "sprites/hut-far-lit.webp" }] },
      interactable: { verbs: ["inspect"], label: "山屋", reveal: 12, cost: { minutes: 1 } }, gaze: { radius: 12, dwell: 800 } },
    prop("paper-map", { yaw: -8, pitch: -16, distance: 9 }, "sprites/map-folded.webp", 11, {
      interactable: { verbs: ["use"], label: "摊开地图", reveal: 12, cost: { minutes: 0 }, requires: has("paperMap") },
      visible: not(flag(CHOICE, { eq: "retreat" })),
    }),
    prop("chocolate", { yaw: 12, pitch: -18, distance: 9 }, "sprites/chocolate.webp", 8, {
      interactable: { verbs: ["use"], label: "巧克力", reveal: 12, cost: { minutes: 0 }, requires: has("chocolate") },
      visible: has("chocolate"),
    }),
    blaze("blaze-hut-a", { yaw: 30, pitch: -18 }, true),
    blaze("blaze-hut-b", { yaw: -30, pitch: -12 }, false),
    { id: "go-hut", transform: { yaw: 22, pitch: -4 }, className: "go-hotspot", exit: { to: "hutTurn", kind: "detour", label: "往山屋走", minutes: 22, condition: flag(CHOICE, { eq: "hut" }) }, interactable: { verbs: ["inspect"], label: "往山屋走", reveal: 24 } },
    goArrow("go", { yaw: -26, pitch: -6 }, { to: "signpost", minutes: 60, label: "下撤", kind: "run" }),
  ],
  seed: (w) => { w.setFlag(CHOICE, "retreat"); w.setFlag(SPREAD, 1); w.setFlag("hutView.certain", true); },
  script: (ctx) => {
    ctx.onInteract("paper-map", () => {
      ctx.bump(SPREAD, 1);
      if (windy(ctx.world)) ctx.spend({ minutes: 0.5 }, "用石头压住地图角");
      ctx.world.dispatch({ type: "item:use", item: "paperMap" });
      if (ctx.flag<number>(SPREAD, 0) === 1) ctx.say("我赶紧把地图啪地摊开。", { tag: "hut-map" });
    });
    ctx.onAction("map:choose:hut", () => { ctx.setFlag(CHOICE, "hut"); ctx.close(); });
    ctx.onAction("map:choose:retreat", () => {
      ctx.setFlag(CHOICE, "retreat"); ctx.close(); ctx.sfx("tick");
      ctx.say("紧急下撤。素材不要了，饭也不吃了。", { tag: "hut-decide" });
    });
    ctx.onEnter((from) => {
      if (from !== "hutTurn") return;
      ctx.setFlag("hutView.turned", true);
      ctx.setFlag(CHOICE, null);
      ctx.say("太阳比刚才低了一格。", { tag: "hut-back" });
    });
    ctx.onInteract("hut", () => {
      const lit = ctx.minute() >= 17 * 60;
      ctx.say(lit ? "山屋的窗户亮了。隔着一整个山谷。" : "山屋在对面。隔着一整个山谷。", { tag: "hut-look" });
    });
    ctx.onMark("hut-window-lit", () => { ctx.sfx("tick", 0.4); ctx.say("对面亮了一盏灯。", { tag: "hut-lit", priority: 1 }); ctx.learn("E-hutLit"); });
    ctx.onInteract("chocolate", () => { ctx.world.dispatch({ type: "item:use", item: "chocolate" }); ctx.say("一板巧克力。今天唯一的一顿饭。", { tag: "hut-choc" }); });
  },
});
