/* The first cable, 10:30: five anchors up a zigzag gully. At each one the two carabiners change segments one at a
   time (never both off), then she hauls the cable (fast, hard on the hands) or climbs the rock beside it (slow, free).
   Coordinates read off the 150°×84° grid of 04-cable (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84, W×H = 1280×720). */
import { all, flag, knows, worn } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, offset } from "./_shared";

/* The painted bolts, bottom to top. She arrives clipped to the thick near cable that runs up from bottom-left. */
const ANCHORS: Transform[] = [
  { yaw: 18.5, pitch: -27.5 },  // A: the loop bolt the near cable arrives at (x 797, y 596)
  { yaw: 34.5, pitch: -21 },    // B: the tall hooked piton to the right (935, 540)
  { yaw: -10, pitch: -14.5 },   // F: the hollow bolt at the left end of the lowest rung (555, 484)
  { yaw: 16, pitch: -7.5 },     // G: the bolt where the long diagonal cable starts (777, 424)
  { yaw: -11.5, pitch: -7.5 },  // H: the left bolt of the second rung (542, 424)
  { yaw: 10, pitch: -1 },       // I: the right bolt of the third rung (725, 369); the rungs above are walked
];
const TOTAL = 5;
/* Mid-segment points on the painted cable (A→B, B→pins→F, F→G, G→H, H→I). */
const HAUL: Transform[] = [{ yaw: 26, pitch: -24.5 }, { yaw: 10, pitch: -16 }, { yaw: 3, pitch: -11 }, { yaw: 2, pitch: -7.5 }, { yaw: -1, pitch: -4.5 }];
/* The pale natural rock beside each segment: the gully-floor slab, the ledge above the pins, between the rungs. */
const ROCK: Transform[] = [{ yaw: 9, pitch: -22 }, { yaw: 14, pitch: -13 }, { yaw: -2, pitch: -10 }, { yaw: 8, pitch: -5 }, { yaw: -7, pitch: -3 }];
const LIP: Transform = { yaw: 2, pitch: 5 };              // where the cable disappears over the top of the gully (655, 317)
const RING: Transform = { yaw: 53, pitch: -29 };           // the big ring anchor at the right where the long cable ends (1092, 609)
const NEAR_CABLE: Transform = { yaw: -12, pitch: -36, distance: 14 };   // the thick cable running back down out of the picture
const CLIMBERS: Transform = { yaw: 12, pitch: 11, distance: 30 };       // the lit face of the right wall, just under its skyline

const STEP = "cable.step", A = "cable.a", B = "cable.b", PHASE = "cable.phase", CAP = "cable.capLoose";
const stepOf = (w: World) => w.flag<number>(STEP, 0);
const anchorAt = (index: number) => ANCHORS[Math.max(0, Math.min(index, TOTAL))];
const segmentOf = (w: World) => Math.min(stepOf(w), TOTAL - 1);
const near = (t: Transform): Transform => ({ ...t, distance: 9 });

/* Where a carabiner hangs: on the segment below the anchor, in her hand, or already on the segment above. */
const carabinerAt = (key: string, side: -1 | 1) => (w: World): Transform => {
  const here = segmentOf(w);
  const seg = w.flag<number>(key, 0);
  const at = near(anchorAt(here));
  if (seg === -1) return offset(at, side * 3, -8);
  if (seg > here) return offset(at, side * 4, 4);
  return offset(at, side * 4, -4);
};
/* The open gate shows only if she read the rule on the second plate (v4 §3.7): otherwise the lock is just a colour. */
const inHand = (key: string) => all(flag(key, { eq: -1 }), knows("E-carabinerRule"));

const clipRound: WalkStep[] = [
  { type: "interact", entity: "carabiner-blue", verb: "clip" }, { type: "interact", entity: "carabiner-blue", verb: "clip" },
  { type: "interact", entity: "carabiner-orange", verb: "clip" }, { type: "interact", entity: "carabiner-orange", verb: "clip" },
];
const climb = (entity: "haul-cable" | "rock-holds", wait: number): WalkStep[] => [{ type: "hold:start", entity }, { wait }, { type: "hold:end" }, { wait: 250 }];
const round = (entity: "haul-cable" | "rock-holds", wait: number): WalkStep[] => [...clipRound, ...climb(entity, wait)];
const route = (entity: "haul-cable" | "rock-holds", wait: number): WalkStep[] => [
  ...Array.from({ length: TOTAL }, () => round(entity, wait)).flat(),
  { type: "travel", entity: "go" },
];

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
    // The two carabiners, hanging at the anchor she stands at. Each click moves one; one always stays on the cable.
    { id: "carabiner-blue", transform: carabinerAt(A, -1), className: "carabiner-hotspot",
      sprite: { src: "sprites/carabiner-blue.webp", layer: "hand", sizeVh: 6, swap: [{ when: inHand(A), src: "sprites/carabiner-blue-open.webp" }] },
      interactable: { verbs: ["clip"], label: "蓝锁", reveal: 14, cost: { minutes: 0 }, requires: worn("lanyard") },
      visible: flag(PHASE, { eq: "clip" }) },
    { id: "carabiner-orange", transform: carabinerAt(B, 1), className: "carabiner-hotspot",
      sprite: { src: "sprites/carabiner-orange.webp", layer: "hand", sizeVh: 6, swap: [{ when: inHand(B), src: "sprites/carabiner-orange-open.webp" }] },
      interactable: { verbs: ["clip"], label: "橙锁", reveal: 14, cost: { minutes: 0 }, requires: worn("lanyard") },
      visible: flag(PHASE, { eq: "clip" }) },
    // Up one segment: the cable (six minutes, the hands) or the pale rock beside it (ten minutes, free).
    { id: "haul-cable", transform: (w) => near(HAUL[segmentOf(w)]), className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "拉钢缆", reveal: 13, cost: { minutes: 6, fatigue: 0.06 } },
      hold: { ms: 700, scaleWith: ["fatigue"] }, visible: flag(PHASE, { eq: "climb" }) },
    { id: "rock-holds", transform: (w) => near(ROCK[segmentOf(w)]), className: "climb-hotspot",
      sprite: { src: "sprites/rock-hold-light.webp", layer: "prop", sizeVh: 6 },
      interactable: { verbs: ["hold"], label: "找岩点", reveal: 13, cost: { minutes: 10 } },
      hold: { ms: 1000, scaleWith: ["fatigue"] }, visible: flag(PHASE, { eq: "climb" }) },
    // From the third anchor: the cable she came up on runs back down out of the picture, and the pass is under it.
    { id: "view-down", transform: NEAR_CABLE,
      interactable: { verbs: ["inspect", "photograph"], label: "往下的钢缆", reveal: 12, cost: { minutes: 0 } },
      visible: flag(STEP, { gte: 2 }) },
    // Two dots high on the right wall: the only two people she will meet all day, an hour ahead of her.
    { id: "climbers-far", transform: CLIMBERS, sprite: { src: "sprites/climbers-far.webp", layer: "figure", sizeVh: 2.4 },
      gaze: { radius: 10, dwell: 900 }, visible: flag(STEP, { gte: 1 }) },
    // Three candidate marks: paint on the left wall beside the lowest rung, a rust streak on the right block, lichen on the loose boulder.
    blaze("blaze-cable", { yaw: -24, pitch: -13 }, true),
    blaze("rust-cable", { yaw: 41, pitch: -12 }, false),
    blaze("lichen-cable", { yaw: -22, pitch: -32 }, false),
    // The cap, when a gust takes it: snagged on the rock beside her until the next gust, unless she grabs it.
    { id: "cap-loose", transform: (w) => offset(near(anchorAt(stepOf(w))), -11, -7), className: "hold-hotspot",
      sprite: { src: "sprites/item-cap.webp", layer: "prop", sizeVh: 7 },
      interactable: { verbs: ["hold"], label: "帽子", reveal: 16 }, hold: { ms: 400, scaleWith: ["fatigue"] },
      visible: flag(CAP, { eq: true }) },
    // The big ring where the long cable ends, off to the right. A hand on it, and the cable answers.
    { id: "anchor-ring", transform: RING, interactable: { verbs: ["inspect"], label: "锚环", reveal: 13, cost: { minutes: 0 } } },
    goArrow("go", LIP, { to: "crack", minutes: 40, label: "往上", kind: "walk" }),
  ],
  seed: (w) => {
    w.setFlag(STEP, TOTAL); w.setFlag(A, TOTAL); w.setFlag(B, TOTAL); w.setFlag(PHASE, "done");
    w.setFlag("cable.certain", true); w.setFlag("cable.hauled", 3);
    for (let i = 0; i < TOTAL; i += 1) w.setFlag(`cable.style.${i}`, i < 3 ? "cable" : "rock");
  },
  script: (ctx) => {
    const w = ctx.world;
    const rung = (key: string) => ctx.flag<number>(key, 0);
    const step = () => stepOf(w);
    const FALSE_MARK_LINES: Record<string, string> = { "rust-cable": "锈迹。不是漆。", "lichen-cable": "地衣。不是漆。" };
    ctx.onEnter(() => { if (ctx.flag(PHASE, "") === "") ctx.setFlag(PHASE, "clip"); });

    /* The cap: a strong gust takes it and snags it on the rock beside her; the next gust takes it for good unless she grabs it. */
    const capGone = (how: string) => {
      if (!ctx.flag(CAP, false)) return;
      ctx.setFlag(CAP, false); ctx.lose("cap", how);
      ctx.sfx("cloth", -0.5, 0.8); ctx.kick("turn", 0.8); ctx.fx("gust", 0.8);
    };
    ctx.on("camera:impulse", ({ kind, strength }) => {
      if (kind !== "turn") return;
      const s = strength ?? 0;
      if (ctx.flag(CAP, false)) { if (s >= 0.9) capGone("被风吹走"); return; }
      if (s < 1.3 || ctx.flag("cable.capBlown", false) || !w.state.inventory.worn.includes("cap") || w.rt.rng() > 0.15) return;
      ctx.setFlag("cable.capBlown", true); ctx.setFlag(CAP, true);
      ctx.sfx("cloth", -0.6, 1); ctx.kick("jolt", 0.7); ctx.fx("gust", 1.2);
      ctx.say("帽子。", { tag: "cable-cap", priority: 1 });
    });
    ctx.onHold("cap-loose", () => {
      ctx.setFlag(CAP, false); ctx.setFlag("cable.capCaught", true);
      ctx.sfx("cloth"); ctx.kick("settle", 0.5); ctx.hand(ctx.transformOf("cap-loose"), "grip");
      ctx.spend({ minutes: 1 }, "抓帽子");
    });
    ctx.onRelease("cap-loose", () => capGone("没抓住"));

    /* Carabiners: any clipped one can come off; one in the hand goes onto the segment above. Both off is the one real scare:
       a lurch, three minutes, the hands, and both locks back on the segment below. She never falls. */
    const bothOff = (here: number) => {
      ctx.setFlag(A, here); ctx.setFlag(B, here);
      w.emit("body:slip", { entity: "carabiner-blue", severity: 1 });
      ctx.sfx("slip", 0, 1.2); ctx.sfx("thud", 0, 0.6); ctx.kick("slip", 1.4, { yaw: 0, pitch: -14 });
      ctx.hand(offset(near(anchorAt(here)), 0, -6), "carabiner", true);
      ctx.spend({ minutes: 3 }, "两把锁同时离缆");
      ctx.bump("cable.bothOff", 1);
      ctx.say("手心一凉。挂回去。", { tag: "cable-bothoff", priority: 1 });
    };
    const clip = (mine: string, other: string, side: -1 | 1) => {
      const here = step();
      if (here >= TOTAL) return;
      const at = near(anchorAt(here));
      if (rung(mine) !== -1) {
        if (rung(other) === -1) return bothOff(here);
        ctx.setFlag(mine, -1);
        ctx.sfx("tock", side * 0.3); ctx.kick("clink", 0.6); ctx.hand(offset(at, side * 3, -8), "carabiner");
        return;
      }
      const next = here + 1;
      ctx.setFlag(mine, next);
      ctx.sfx("clink", side * 0.3); ctx.kick("clink"); ctx.hand(offset(at, side * 4, 4), "carabiner");
      if (rung(other) === next) { ctx.setFlag(PHASE, "climb"); ctx.kick("settle", 0.4); }
    };
    ctx.onInteract("carabiner-blue", () => clip(A, B, -1));
    ctx.onInteract("carabiner-orange", () => clip(B, A, 1));

    /* Up one segment: hauling costs the hands, the rock costs minutes. The top is a breath, and one line if the hands did it all. */
    const advance = (style: "cable" | "rock") => {
      const here = step();
      if (here >= TOTAL) return;
      const next = here + 1;
      capGone("她爬上去了");
      ctx.setFlag(STEP, next);
      ctx.setFlag(PHASE, next >= TOTAL ? "done" : "clip");
      ctx.setFlag(`cable.style.${here}`, style);
      const hauled = style === "cable" ? ctx.bump("cable.hauled", 1) : ctx.flag<number>("cable.hauled", 0);
      ctx.sfx("step", 0, style === "cable" ? 1 : 0.7); ctx.kick("pull", style === "cable" ? 1.3 : 0.9);
      ctx.hand(near(anchorAt(next)), "grip", true);
      if (next >= TOTAL) { w.emit("body:rest", { seconds: 3 }); ctx.sfx("exhale", 0, 0.7); ctx.kick("settle", 1.0); }
      if (style === "cable" && hauled === 1) ctx.say("钢缆比看起来的凉。", { tag: "cable-cold" });
      else if (next === TOTAL && hauled >= TOTAL) ctx.say("一路拉着缆上来的。手在抖。", { tag: "cable-top" });
    };
    ctx.onHold("haul-cable", () => advance("cable"));
    ctx.onHold("rock-holds", () => advance("rock"));
    const slipBack = (progress: number) => { if (progress > 0.3) { ctx.kick("slip", 0.4); ctx.sfx("slide", 0, 0.5); } };
    ctx.onRelease("haul-cable", slipBack);
    ctx.onRelease("rock-holds", slipBack);

    /* Looking. Down the cable from the third anchor: a minute, or a photograph. Up: two dots on the wall. */
    ctx.onInteract("view-down", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.setFlag("cable.photoDown", true); ctx.kick("glance", 0.4, { yaw: -1, pitch: -6 }); return; }
      ctx.spend({ minutes: 1 }, "往下看");
      ctx.kick("glance", 0.6, { yaw: -2, pitch: -8 }); ctx.sfx("breath", -0.4, 0.6);
      ctx.say("整条碎石路在下面变成一条线。", { tag: "cable-view" });
    });
    ctx.onGaze("climbers-far", () => {
      ctx.setFlag("cable.sawClimbers", true);
      ctx.sfx("clink", 0.3, 0.25); ctx.kick("glance", 0.4, { yaw: 1, pitch: 6 });
      ctx.say("上面很远的地方有两个小点。", { tag: "cable-climbers" });
    });

    /* The marks. The real one is settled by the journal (hand, cloth); a false one costs the minute and gets a word. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 }); return; }
      const line = FALSE_MARK_LINES[entity];
      if (!line) return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.4, { yaw: 0, pitch: -3 });
      ctx.say(line, { tag: `cable-${entity}` });
    });

    /* The ring: a hand on cold iron, and the long cable answers with a tick. */
    ctx.onInteract("anchor-ring", () => {
      ctx.hand(near(RING), "grip"); ctx.sfx("clink", 0.6, 0.5); ctx.kick("clink", 0.5);
      ctx.setFlag("cable.ring", true);
    });

    /* Standing still on the wall: the body settles into the harness; every third breath the cable ticks on the rock. */
    let stills = 0;
    ctx.onWait(() => {
      if (step() <= 0 || step() >= TOTAL) return;
      stills += 1;
      ctx.kick("settle", 0.25);
      if (stills % 3 === 0) ctx.sfx("clink", 0.2, 0.3);
    });

    /* Leaving: whatever the wind still holds of the cap goes; without a confirmed mark the line out of the gully takes eight minutes (v4 §3.5). */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "cable") return;
      capGone("留在墙上");
      if (to === "crack" && !ctx.flag("cable.certain", false)) {
        ctx.spend({ minutes: 8 }, "没认记号，找了一段路");
        ctx.kick("turn", 0.5);
        ctx.say("走错了一小段。", { tag: "cable-lost", priority: 1 });
      }
    });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-cable", verb: "inspect" }, { wait: 300 },
    ...route("haul-cable", 1800),
  ],
  variants: {
    // Every anchor on the rock: ten minutes each, nothing on the hands. Leaves without a mark (eight minutes on the way out).
    rock: route("rock-holds", 2400),
    // Both locks off at the first anchor: the lurch, three minutes, then the whole cable.
    slip: [
      { type: "interact", entity: "carabiner-blue", verb: "clip" }, { type: "interact", entity: "carabiner-orange", verb: "clip" }, { wait: 600 },
      ...route("haul-cable", 1800),
    ],
    // Everything the wall offers: the marks, the ring, the look down from the third anchor and its photograph, mixed climbing.
    thorough: [
      { type: "interact", entity: "lichen-cable", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-cable", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "anchor-ring", verb: "inspect" }, { wait: 300 },
      ...round("rock-holds", 2400), ...round("haul-cable", 1800),
      { type: "interact", entity: "view-down", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "view-down", verb: "photograph" }, { wait: 300 },
      { type: "interact", entity: "rust-cable", verb: "inspect" }, { wait: 300 },
      ...round("rock-holds", 2400), ...round("haul-cable", 1800), ...round("haul-cable", 1800),
      { type: "travel", entity: "go" },
    ],
  },
});
