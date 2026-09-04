/* The first cable: five anchors, two carabiners, and at each anchor the choice to haul the cable or climb the rock. */
import { flag, worn } from "../engine/condition";
import { defineScene } from "../engine/scene";
import { CABLE_ANCHORS } from "../data/ferrata";
import { blaze, goArrow, lookAt, offset, prop } from "./_shared";
import type { World } from "../engine/world";

const TOTAL = CABLE_ANCHORS.length;
const at = (index: number) => CABLE_ANCHORS[Math.min(index, TOTAL - 1)];
const A = "cable.blue", B = "cable.orange", STEP = "cable.step", PHASE = "cable.phase";
const stepOf = (w: World) => w.flag<number>(STEP, 0);

export default defineScene({
  id: "cable",
  day: 1, place: "飞拉达 · 第一段", elevation: "2,355 m",
  painting: "pano/04-cable.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.95, windTone: 1450, birds: 0.1, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { gusty: true, windPan: 0.45 },
  arriveAt: 10 * 60 + 30,
  fallback: "一开始就是 C 级，很快就是 D 级。",
  exitWhen: flag(STEP, { gte: TOTAL }),
  entities: [
    ...CABLE_ANCHORS.map((anchor, index) => prop(`anchor-${index}`, { ...anchor, distance: 9 }, "sprites/anchor-bolt.webp", 5, { visible: flag(STEP, { lt: TOTAL }) })),
    { id: "anchor", transform: (w) => at(stepOf(w)), interactable: { verbs: ["inspect"], label: "锚点", reveal: 12, cost: { minutes: 0 } }, visible: flag(STEP, { lt: TOTAL }) },
    { id: "carabiner-blue", transform: (w) => offset(at(stepOf(w)), -7, 7), sprite: { src: "sprites/carabiner-blue.webp", layer: "hand", sizeVh: 6 }, className: "carabiner-hotspot",
      interactable: { verbs: ["clip"], label: "蓝锁", reveal: 14, requires: worn("lanyard") }, visible: flag(STEP, { lt: TOTAL }) },
    { id: "carabiner-orange", transform: (w) => offset(at(stepOf(w)), 7, 7), sprite: { src: "sprites/carabiner-orange.webp", layer: "hand", sizeVh: 6 }, className: "carabiner-hotspot",
      interactable: { verbs: ["clip"], label: "橙锁", reveal: 14, requires: worn("lanyard") }, visible: flag(STEP, { lt: TOTAL }) },
    { id: "haul-cable", transform: (w) => offset(at(stepOf(w) + 1), -4, -4), className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "拉钢缆", reveal: 13, cost: { minutes: 6, fatigue: 0.06 } }, hold: { ms: 700, scaleWith: ["fatigue"] }, visible: flag(PHASE, { eq: "climb" }) },
    { id: "rock-holds", transform: (w) => offset(at(stepOf(w) + 1), 9, -2), className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "找岩点", reveal: 13, cost: { minutes: 10 } }, hold: { ms: 1000, scaleWith: ["fatigue"] }, visible: flag(PHASE, { eq: "climb" }) },
    lookAt("view-down", { yaw: -34, pitch: -26, distance: 14 }, "脚下的草甸", 1, { visible: flag(STEP, { gte: 2 }) }),
    { id: "climbers-far", transform: { yaw: 12, pitch: 22, distance: 16 }, sprite: { src: "sprites/climbers-far.webp", layer: "figure", sizeVh: 3 }, gaze: { radius: 10, dwell: 900 }, visible: flag(STEP, { gte: 1 }) },
    blaze("blaze-cable", { yaw: -21, pitch: -4 }, true),
    goArrow("go", { yaw: 0, pitch: 16 }, { to: "crack", minutes: 90, label: "往上", kind: "walk" }),
  ],
  seed: (w) => { w.setFlag(STEP, TOTAL); w.setFlag(A, TOTAL); w.setFlag(B, TOTAL); w.setFlag(PHASE, "done"); w.setFlag("cable.certain", true); },
  script: (ctx) => {
    const rung = (which: string) => ctx.flag<number>(which, 0);
    const step = () => stepOf(ctx.world);
    ctx.onEnter(() => { if (ctx.flag(PHASE, "") === "") ctx.setFlag(PHASE, "clip"); });

    const bothOff = (here: number) => {
      ctx.setFlag(A, here); ctx.setFlag(B, here);
      ctx.world.emit("body:slip", { entity: "anchor", severity: 1 });
      ctx.sfx("slip"); ctx.kick("slip", 0.9);
      ctx.spend({ minutes: 3 }, "两把锁同时离缆");
      ctx.say("手心一凉。挂回去。", { tag: "cable-bothoff", priority: 1 });
    };
    const clip = (mine: string, other: string) => {
      const here = step();
      if (here >= TOTAL) return;
      if (rung(mine) === here) {
        if (rung(other) === -1) return bothOff(here);
        ctx.setFlag(mine, -1);
        ctx.sfx("tock"); ctx.kick("clink", 0.6); ctx.hand(offset(at(here), 0, 9), "carabiner");
        return;
      }
      if (rung(mine) === -1) {
        const next = here + 1;
        ctx.setFlag(mine, next);
        ctx.sfx("clink"); ctx.kick("clink");
        if (rung(other) === next) ctx.setFlag(PHASE, "climb");
      }
    };
    const advance = (style: "cable" | "rock") => {
      const next = step() + 1;
      ctx.setFlag(STEP, next);
      ctx.setFlag(PHASE, next >= TOTAL ? "done" : "clip");
      ctx.setFlag(`cable.style.${next - 1}`, style);
      ctx.sfx("step"); ctx.kick("pull", style === "cable" ? 1.3 : 1.0); ctx.hand(at(Math.min(next, TOTAL - 1)), "grip", true);
      if (next === TOTAL) ctx.say(style === "cable" ? "一路拉着缆上来的。手已经在抖了。" : "最后一个锚点。上面是裂缝。", { tag: "cable-top" });
      else if (next === 2) ctx.say("钢缆比看起来更凉。", { tag: "cable-cold" });
    };
    ctx.onInteract("carabiner-blue", () => clip(A, B));
    ctx.onInteract("carabiner-orange", () => clip(B, A));
    ctx.onHold("haul-cable", () => advance("cable"));
    ctx.onHold("rock-holds", () => advance("rock"));
    ctx.onInteract("anchor", () => ctx.say("锚点。铁环上有别人留下的漆。", { tag: "cable-anchor" }));
    ctx.onInteract("view-down", () => ctx.say("整条碎石路在下面变成一条线。", { tag: "cable-view" }));
    ctx.onGaze("climbers-far", () => { ctx.setFlag("cable.sawClimbers", true); ctx.say("上面很远的地方有两个小点。", { tag: "cable-climbers" }); });
    // The cap can go in a strong gust.
    ctx.on("camera:impulse", ({ kind, strength }) => {
      if (kind !== "turn" || (strength ?? 0) < 1.3 || !ctx.world.state.inventory.worn.includes("cap") || ctx.world.rt.rng() > 0.12) return;
      ctx.lose("cap", "被风吹走"); ctx.say("帽子。", { tag: "cable-cap", priority: 1 });
    });
  },
});
