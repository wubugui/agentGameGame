/* The top section, 13:25. The cable is intermittent here: one last span from the post stamped 12 (front right)
   across to the foot of the tower, with a painted bolt half-way. Above the cable's end, a ledge where the only two
   people she met all day stand waiting for the cable to clear. Below her feet the flagstones climb up-left and merge
   into the grey shoulder at the tower's foot. Three lines look walkable from here — the flagstones, the pale scree on
   the left, the scree right of the tower — and only one of them has a mark. Looking back down the cable, the box is a
   dot on the pale slope below it.
   Coordinates read off the 150°×84° grid of 07-exit (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84). */
import { all, flag, not, worn } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { backArrow, blaze, goArrow, lookAt } from "./_shared";

const STEP = "exit.step", PHASE = "exit.phase", SLAB_TOP = "exit.slabTop";
const SEEN = "exit.seen", NODDED = "exit.nodded", PHOTO = "exit.photo", PASSED = "exit.passed";
const TOTAL = 2;

/* Two anchors: the eye of the post stamped 12 (1024,459), then the cable itself where the painted bolt sits half-way
   along it (635,490). Both read off the painted cable in plain/07-exit.png, traced column by column. */
const CLIP_AT: Transform[] = [{ yaw: 45, pitch: -11.5 }, { yaw: -0.6, pitch: -15.2 }];
/* Mid-span on the sagging cable for each segment (traced: yaw 22 -> pitch -16.3, yaw -7 -> pitch -13.0). */
const HAUL_AT: Transform[] = [{ yaw: 22, pitch: -16.3 }, { yaw: -7, pitch: -13 }];
/* The tower's foot beside each segment: dark rock above the cable's right half, the pale mossy foot above its left half. */
const ROCK_AT: Transform[] = [{ yaw: 27, pitch: -7 }, { yaw: -8, pitch: -4 }];
/* Where the cable ends at the foot of the tower (528,432). */
const CABLE_END: Transform = { yaw: -13, pitch: -8.5 };
/* The ledge above the cable's end where the two climbers stand; the down-going cable right of the post, where they are
   after passing (traced: yaw 56 -> pitch -20.5). */
const LEDGE: Transform = { yaw: -8, pitch: -5.5, distance: 14 };
const BELOW: Transform = { yaw: 56, pitch: -20.5, distance: 13 };
/* The flagstones, mid-path. */
const SLABS: Transform = { yaw: -12, pitch: -20 };

const stepOf = (w: World) => w.flag<number>(STEP, 0);
const at = (list: Transform[], w: World) => list[Math.min(stepOf(w), TOTAL - 1)];
const onWall = flag(STEP, { lt: TOTAL });
const clipping = all(onWall, flag(PHASE, { eq: "clip" }));
const climbing = all(onWall, flag(PHASE, { eq: "climb" }));

const climb = (entity: "haul-cable" | "rock-holds", wait: number): WalkStep[] => [{ type: "hold:start", entity }, { wait }, { type: "hold:end" }];
const route = (entity: "haul-cable" | "rock-holds", wait: number): WalkStep[] => [
  { type: "interact", entity: "clip", verb: "clip" }, ...climb(entity, wait),
  { type: "interact", entity: "clip", verb: "clip" }, ...climb(entity, wait),
  { type: "interact", entity: "slabs", verb: "step" }, { wait: 900 },
  { type: "travel", entity: "go" },
];

export default defineScene({
  id: "exit",
  day: 1, place: "飞拉达 · 顶段出口", elevation: "2,860 m",
  painting: "pano/07-exit.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.85, windTone: 1400, birds: 0.15, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { gusty: true, windPan: 0.35, clouds: true },
  arriveAt: 13 * 60 + 25,
  fallback: "钢缆到这里就断断续续的了。",
  exitWhen: flag(SLAB_TOP),
  entities: [
    // The two carabiners, at whichever anchor is next: the post's eye, then the cable at the bolt half-way along.
    { id: "clip", transform: (w) => ({ ...at(CLIP_AT, w), distance: 9 }), className: "carabiner-hotspot",
      sprite: { src: "sprites/carabiner-pair.webp", layer: "hand", sizeVh: 7 },
      interactable: { verbs: ["clip"], label: "锚点", reveal: 13, cost: { minutes: 1 }, requires: worn("lanyard") },
      visible: clipping },
    // Up one segment: haul the cable (fast, hard on the hands) or climb the tower's foot beside it (slow, free).
    { id: "haul-cable", transform: (w) => at(HAUL_AT, w), className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "拉钢缆", reveal: 13, cost: { minutes: 6, fatigue: 0.06 } },
      hold: { ms: 700, scaleWith: ["fatigue"] }, visible: climbing },
    { id: "rock-holds", transform: (w) => at(ROCK_AT, w), className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "找岩点", reveal: 13, cost: { minutes: 10 } },
      hold: { ms: 1000, scaleWith: ["fatigue"] }, visible: climbing },
    // After the cable: the flagstones up to the grey shoulder. Walking them is what ends the section.
    { id: "slabs", transform: SLABS, className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "石板路", reveal: 14, cost: { minutes: 8 }, once: true },
      visible: all(flag(STEP, { gte: TOTAL }), not(flag(SLAB_TOP))) },
    // The only two people she met all day. They stand on the ledge until she is on the cable, then come down past her.
    { id: "climbers", transform: (w) => (w.flag(PASSED, false) ? BELOW : LEDGE),
      sprite: { src: "sprites/climbers-pair.webp", layer: "figure", sizeVh: 5, swap: [
        { when: flag(PASSED), src: "sprites/climbers-far.webp" },
      ] },
      gaze: { radius: 14, dwell: 600 } },
    { id: "climbers-nod", transform: LEDGE, interactable: { verbs: ["wave"], label: "两位攀登者", reveal: 14, cost: { minutes: 1 }, once: true },
      visible: all(flag(SEEN), not(flag(NODDED)), not(flag(PASSED))) },
    { id: "climbers-photo", transform: LEDGE, interactable: { verbs: ["photograph"], label: "两位攀登者", reveal: 14, cost: { minutes: 0 }, once: true },
      visible: all(flag(NODDED), not(flag(PHOTO)), not(flag(PASSED))) },
    // Three candidate marks, one per line: the white-topped stone where the flagstones end, the boulder on the left scree, the tower's foot on the right.
    blaze("blaze-exit-a", { yaw: -20, pitch: -11.5 }, true),
    blaze("blaze-exit-b", { yaw: -33, pitch: -11.5 }, false),
    blaze("blaze-exit-c", { yaw: 16, pitch: -4 }, false),
    // The two other lines that look walkable from here. Twelve minutes each, a slide or a dead face, then back.
    { id: "wrong-left", transform: { yaw: -38, pitch: -22 }, className: "wrong-hotspot", tags: ["wrongWay"],
      interactable: { verbs: ["inspect"], label: "左边的碎石坡", reveal: 18, cost: { minutes: 12, fatigue: 0.1 }, once: true } },
    { id: "wrong-right", transform: { yaw: 33, pitch: -4 }, className: "wrong-hotspot", tags: ["wrongWay"],
      interactable: { verbs: ["inspect"], label: "石塔右边的碎石", reveal: 18, cost: { minutes: 12, fatigue: 0.1 }, once: true } },
    // The valley floor off to the right: roads, a stream, a white roof. A minute to look; a shot from the phone.
    lookAt("valley", { yaw: 62, pitch: -8, distance: 20 }, "谷底", 1),
    /* Looking back down the cable: the box is a dot on the pale slope under it. One tick of attention, nothing said.
       distance 16 keeps it inside PanoStage's 1:1 band (scale = max(.6, 10/d) cancels the wrapper's d/10 up to 16.7),
       so sizeVh is the height it really draws — beyond that the 0.6 floor makes a "far" sprite come out bigger. */
    { id: "mailbox-below", transform: { yaw: 54, pitch: -28, distance: 16 },
      sprite: { src: "sprites/mailbox-far.webp", layer: "prop", sizeVh: 1.9 },
      gaze: { radius: 12, dwell: 900 } },
    backArrow("back", { yaw: 66, pitch: -27.3 }, "mailbox", "回头", 12),
    goArrow("go", { yaw: -17, pitch: -5.5 }, { to: "summit", minutes: 88, label: "往上", kind: "walk" }),
  ],
  seed: (w) => {
    w.setFlag(STEP, TOTAL); w.setFlag(PHASE, "done"); w.setFlag(SLAB_TOP, true); w.setFlag(PASSED, true); w.setFlag("exit.certain", true);
    for (let i = 0; i < TOTAL; i += 1) w.setFlag(`exit.style.${i}`, "cable");
  },
  script: (ctx) => {
    const w = ctx.world;
    const step = () => stepOf(w);
    ctx.onEnter(() => { if (ctx.flag(PHASE, "") === "") ctx.setFlag(PHASE, "clip"); });

    /* They come down past her once she is on the cable: boots on rock from the left, a carabiner, then they are below.
       Whether she looked up and nodded first is the whole difference; nothing else changes. */
    const pass = () => {
      if (ctx.flag(PASSED, false)) return;
      ctx.setFlag(PASSED, true);
      ctx.sfx("step", -0.5, 0.8); ctx.after(380, () => ctx.sfx("clink", 0.1, 0.5)); ctx.after(760, () => ctx.sfx("step", 0.5, 0.6));
      ctx.kick("glance", 0.5, { yaw: -4, pitch: 1 });
      if (ctx.flag(SEEN, false) && !ctx.flag(NODDED, false)) ctx.say("他们从旁边过去了。", { tag: "exit-pass" });
    };

    /* The anchors: two clinks and the hand with the carabiners. */
    ctx.onInteract("clip", () => {
      ctx.setFlag(PHASE, "climb");
      ctx.sfx("clink", 0.3); ctx.after(160, () => ctx.sfx("clink", 0.3, 0.7)); ctx.kick("clink", 0.7);
      ctx.hand({ ...at(CLIP_AT, w), distance: 9 }, "carabiner");
    });
    /* Up one segment. The cable costs the hands, the rock costs minutes; at the top the cable simply stops. */
    const advance = (style: "cable" | "rock") => {
      const here = step();
      if (here >= TOTAL) return;
      const next = here + 1;
      ctx.setFlag(STEP, next);
      ctx.setFlag(PHASE, next >= TOTAL ? "slabs" : "clip");
      ctx.setFlag(`exit.style.${here}`, style);
      ctx.sfx("step", 0, style === "cable" ? 1 : 0.7); ctx.kick("pull", style === "cable" ? 1.3 : 0.9);
      ctx.hand(next >= TOTAL ? CABLE_END : { ...at(CLIP_AT, w), distance: 9 }, "grip", true);
      if (next === 1) pass();
      if (next >= TOTAL) { w.emit("body:rest", { seconds: 3 }); ctx.say("上面没有钢缆了。剩下的是走的。", { tag: "exit-top" }); }
    };
    ctx.onHold("haul-cable", () => advance("cable"));
    ctx.onHold("rock-holds", () => advance("rock"));
    const slipBack = (progress: number) => { if (progress > 0.3) { ctx.kick("slip", 0.4); ctx.sfx("slide", 0, 0.5); } };
    ctx.onRelease("haul-cable", slipBack);
    ctx.onRelease("rock-holds", slipBack);

    /* The flagstones: three steps up to the notch, dust off the slabs, and the way on is there. */
    ctx.onInteract("slabs", () => {
      ctx.setFlag(SLAB_TOP, true); ctx.setFlag(PHASE, "done");
      ctx.kick("step", 0.8); ctx.sfx("step", -0.1, 0.9); ctx.fx("dust", 0.5);
      ctx.after(350, () => { ctx.kick("step", 0.7); ctx.sfx("step", 0.1, 0.8); });
      ctx.after(700, () => { ctx.kick("settle", 0.6, { yaw: 0, pitch: 2 }); ctx.sfx("step", 0, 0.7); });
    });

    /* The climbers. Seeing them is a look; the nod is two minutes and a nod back; the photo is the phone. No words from them. */
    ctx.onGaze("climbers", () => {
      if (ctx.flag(PASSED, false)) { ctx.sfx("step", 0.6, 0.4); ctx.kick("glance", 0.3, { yaw: 3, pitch: -2 }); return; }
      if (ctx.flag(SEEN, false)) return;
      ctx.setFlag(SEEN, true);
      ctx.sfx("clink", -0.3, 0.45);
      ctx.say("上面站着两个人。", { tag: "exit-seen" });
    });
    ctx.onInteract("climbers-nod", () => {
      ctx.setFlag(NODDED, true);
      ctx.kick("glance", 0.8, { yaw: 0, pitch: -5 }); ctx.after(380, () => ctx.kick("glance", 0.4, { yaw: 0, pitch: 3 }));
      ctx.sfx("cloth", -0.2, 0.6);
      ctx.say("点了点头。他们也点了点头。", { tag: "exit-nod" });
    });
    ctx.onInteract("climbers-photo", () => {
      ctx.setFlag(PHOTO, true);
      w.dispatch({ type: "phone:shoot" });
      ctx.kick("glance", 0.4, { yaw: -2, pitch: 1 });
    });

    /* The marks. The real one is settled by the journal (hand, cloth); the two false ones cost a minute each. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (entity === "blaze-exit-a" && real) { ctx.kick("settle", 0.5); ctx.sfx("step", -0.2, 0.5); return; }
      if (entity === "blaze-exit-b" || entity === "blaze-exit-c") {
        ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
        ctx.say(entity === "blaze-exit-b" ? "地衣。不是漆。" : "锈。不是漆。", { tag: "exit-false" });
      }
    });

    /* The two wrong lines: walked over, looked at, walked back. The left one slides; the right one ends at a face. */
    ctx.onInteract("wrong-left", () => {
      ctx.bump("exit.wrong", 1);
      ctx.kick("slip", 0.9); ctx.sfx("slide", -0.5); ctx.fx("dust", 0.8);
      ctx.after(600, () => { ctx.kick("settle", 0.5); ctx.sfx("step", -0.3, 0.6); });
    });
    ctx.onInteract("wrong-right", () => {
      ctx.bump("exit.wrong", 1);
      ctx.kick("settle", 0.8); ctx.sfx("step", 0.5); ctx.fx("dust", 0.5);
      ctx.after(600, () => { ctx.kick("turn", 0.4, { yaw: -2, pitch: 0 }); ctx.sfx("step", 0.3, 0.6); });
    });
    ctx.on("interact:done", ({ entity }) => {
      if (entity !== "wrong-left" && entity !== "wrong-right") return;
      ctx.say(entity === "wrong-left" ? "碎石一直往下滑。不是这条。" : "石塔右边绕不过去。不是这条。", { tag: "exit-wrong" });
    });

    /* Looking. The valley floor: a breath and a glance, or the phone. The box below: a tick of light, nothing said. */
    ctx.onInteract("valley", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.setFlag("exit.photoValley", true); return; }
      ctx.kick("glance", 0.4, { yaw: 4, pitch: -3 }); ctx.sfx("exhale", 0.5, 0.6);
    });
    ctx.onGaze("mailbox-below", () => {
      ctx.setFlag("exit.lookedBack", true);
      ctx.sfx("tick", 0.6, 0.35); ctx.kick("glance", 0.35, { yaw: 3, pitch: -3 });
    });

    /* Standing still: once, the cable ticks against the post off to the right and a gust comes round the tower.
       Hanging on the cable, every wait is a small settle. */
    ctx.onWait(() => {
      if (!ctx.flag("exit.stillness", false)) {
        ctx.setFlag("exit.stillness", true);
        ctx.sfx("clink", 0.55, 0.35); ctx.fx("gust", 0.4); ctx.kick("turn", 0.3, { yaw: 1, pitch: 0 });
        return;
      }
      if (step() > 0 && step() < TOTAL) ctx.kick("settle", 0.25);
    });

    /* Leaving. Up: the climbers are gone whatever happened; without a confirmed mark, twelve minutes of looking for the line (v4 §3.5).
       Back down: the carabiners go back on the cable. */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "exit") return;
      if (to === "mailbox") { ctx.sfx("clink", 0.4); ctx.kick("clink", 0.5); return; }
      if (to !== "summit") return;
      ctx.setFlag(PASSED, true);
      if (!ctx.flag("exit.certain", false)) { ctx.spend({ minutes: 12 }, "没认记号，找了一段路"); ctx.kick("turn", 0.5); ctx.say("走错了一小段。", { tag: "exit-lost", priority: 1 }); }
    });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-exit-a", verb: "inspect" }, { wait: 300 },
    ...route("haul-cable", 2200),
  ],
  variants: {
    // The rock beside the cable both times: eight minutes more, nothing off the hands.
    rock: [{ type: "interact", entity: "blaze-exit-a", verb: "inspect" }, { wait: 300 }, ...route("rock-holds", 2900)],
    // Look up, nod, take the picture, then climb. Two minutes and a photograph that gives nothing back.
    nod: [
      { wait: 4000 },
      { type: "interact", entity: "climbers-nod", verb: "wave" }, { wait: 600 },
      { type: "interact", entity: "climbers-photo", verb: "photograph" }, { wait: 600 },
      { type: "interact", entity: "blaze-exit-a", verb: "inspect" }, { wait: 300 },
      ...route("haul-cable", 2200),
    ],
    // Both wrong lines, a false mark, then the right one; no mark confirmed on the way out would cost twelve more.
    wrong: [
      { type: "interact", entity: "wrong-left", verb: "inspect" }, { wait: 800 },
      { type: "interact", entity: "wrong-right", verb: "inspect" }, { wait: 800 },
      { type: "interact", entity: "blaze-exit-b", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-exit-a", verb: "inspect" }, { wait: 300 },
      ...route("rock-holds", 2900),
    ],
    // Straight up the cable without looking for a mark: the twelve minutes are paid at the top.
    blind: route("haul-cable", 2200),
    back: [{ type: "travel", entity: "back" }],
  },
});
