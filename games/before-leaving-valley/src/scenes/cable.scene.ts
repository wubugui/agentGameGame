/* The first cable, 10:30: five anchors up a zigzag gully. At each one the two carabiners change segments one at a
   time (never both off), then she hauls the cable (fast, hard on the hands) or climbs the rock beside it (slow, free).
   Coordinates read off the 150°×84° grid of 04-cable (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84, W×H = 1280×720).

   THREE THINGS A READER SHOULD NOT HAVE TO REDERIVE:
   1. FIVE anchors, not four. v4 §8 gives this node 5 anchors; v4 §7 prices the whole cable at "省 16 分钟 /
      fatigue +0.24", which is four decisions of 4 minutes and 0.06. The two specs disagree and this file follows
      §8, so hauling the whole wall is 5 × (10 − 6) = 20 minutes saved and 5 × 0.06 = +0.30 fatigue (+0.18 gloved).
      Those numbers are §7 arithmetic applied to §8 count — nothing here was invented.
   2. NO penalty for leaving without a confirmed mark. §3.5 charges that on 草甸 / 碎石路·顶段 / 高原 / 夜森林 and
      nowhere else, and it would make no sense here: the line up this gully is a cable bolted to the rock and there
      is no second line to take. Confirming a mark on this wall is confirmation and nothing more; a false one still
      costs its minute to the JournalSystem, which is the price of being unsure, not of being wrong.
   3. The cap. sprites/item-cap.webp is not drawn, so while ART_LANDED is false the gust never takes it: a
      snatch at a cap the painting cannot show would be an E-key button pointing at bare limestone, which is what
      §12 A1 forbids. The whole beat — the gust, the cap on the rock, the grab — comes back with the picture. */
import { entityIs, flag, not, worn } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene, type WalkStep } from "../engine/scene";
import type { EntityId, Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, offset } from "./_shared";

/** Flip to true in the same commit as sprites/item-cap.webp. */
const ART_LANDED: boolean = false;

/* A mark that stays on its rock after she has read it (v4 §3.5 / §3.8 memory ③): the paint keeps a very faint
   highlight until she leaves the node, and can no longer be pressed. `enabled: false` is what fades it
   (`.hotspot.is-disabled { opacity:.35 }`); the shared factory would delete it from the painting instead. */
const mark = (id: EntityId, transform: Transform, real: boolean): EntityDef =>
  blaze(id, transform, real, { visible: undefined, enabled: not(entityIs(id, "read")) });

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
/* Where the cable goes over the top of the gully. pitch 5 was (655, 317) — at that column the sky wedge between
   the two walls has not closed yet, so the arrow sat in air with only its ring touching rock. The topmost strand
   is pinned at (673, 328) and the rock lip under it runs through y ≈ 330, so pitch 3.5 puts the arrow on the lip
   itself, right where the cable turns over it. */
const LIP: Transform = { yaw: 2, pitch: 3.5 };            // (655, 330)
const RING: Transform = { yaw: 53, pitch: -29 };           // the big ring anchor at the right where the long cable ends (1092, 609)
/* The thick cable running back down out of the picture: its painted core at x 538 spans y 683–694, so pitch −38 is
   its middle. This point is the foot of SEGMENTS[0] and nothing else — it decides where the two carabiners ride on
   the lowest length of cable, so it does not move. */
const NEAR_CABLE: Transform = { yaw: -12, pitch: -38, distance: 14 };
/* The same painted cable, further up it. `view-down` used to sit on NEAR_CABLE, and −38 is below the lowest gaze a
   climbing body can reach (GAIT.climb lifts the whole view by 3°, so the floor measures about −34.2): it was
   reachable only because GazeSystem has a 7° hard floor under its inside test, with 1.7° to spare and the pointer
   pinned to the bottom of the screen. The cable rises to the right — traced on a 5× crop its core runs through
   (560, 672), (640, 634) and (680, 618) — so following it up to (678, 617) keeps the hotspot on the painted cable
   and puts four degrees of room under it. */
const VIEW_DOWN: Transform = { yaw: 4.5, pitch: -30, distance: 14 };  // (678, 617)
const CLIMBERS: Transform = { yaw: 12, pitch: 11, distance: 16 };       // the lit face of the right wall, just under its skyline (d 16: sizeVh is the height on screen)
/** Things done in one movement, to a thing rather than a place: an E-key action. Below the painting so it never projects. */
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };

/* Every painted length of cable, foot to head. SEGMENTS[i] is the one that ends at ANCHORS[i], so at anchor h the
   cable below her is SEGMENTS[h] and the cable above her is SEGMENTS[h + 1]. `sag` is how far the painted cable
   hangs below the straight line between the two bolts at each end (degrees of pitch, read off the grid): only the
   top two lengths have enough slack in the picture to matter. */
type Segment = { foot: Transform; head: Transform; sagFoot: number; sagHead: number };
const SEGMENTS: Segment[] = [
  { foot: NEAR_CABLE, head: ANCHORS[0], sagFoot: 0, sagHead: 0 },      // up out of the gully floor to A
  { foot: ANCHORS[0], head: ANCHORS[1], sagFoot: 0, sagHead: 0 },      // A → B
  { foot: ANCHORS[1], head: ANCHORS[2], sagFoot: 0, sagHead: 0 },      // B → the pins → F
  { foot: ANCHORS[2], head: ANCHORS[3], sagFoot: 0, sagHead: 0 },      // F → G
  { foot: ANCHORS[3], head: ANCHORS[4], sagFoot: 0.4, sagHead: 0.8 },  // G → H: the rung dips and stays low at its left bolt
  { foot: ANCHORS[4], head: ANCHORS[5], sagFoot: 0.8, sagHead: 0 },    // H → I: it leaves H from a ring under the bolt
];
/** A point on a painted length of cable: t = 0 at its foot, 1 at its head. */
const along = (seg: Segment, t: number): Transform => ({
  yaw: seg.foot.yaw + (seg.head.yaw - seg.foot.yaw) * t,
  pitch: seg.foot.pitch + (seg.head.pitch - seg.foot.pitch) * t - (seg.sagFoot + (seg.sagHead - seg.sagFoot) * t),
});

const STEP = "cable.step", A = "cable.a", B = "cable.b", PHASE = "cable.phase", CAP = "cable.capLoose";
const stepOf = (w: World) => w.flag<number>(STEP, 0);
const anchorAt = (index: number) => ANCHORS[Math.max(0, Math.min(index, TOTAL))];
const segmentOf = (w: World) => Math.min(stepOf(w), TOTAL - 1);
const near = (t: Transform): Transform => ({ ...t, distance: 9 });

/* Where a carabiner rides: on the length of cable below her, in her hand, or already on the length above. The two
   locks sit a hand apart, and the lead runs the opposite way on the two cables so that the moment one is up and the
   other still down they never cover each other (at the fourth bolt the two cables pass within 1.2° of one another).
   Checked against the grid: all twenty resulting points are 0–3.6 px off painted cable. */
const LEAD = 0.07;
const onCableBelow = (here: number, side: -1 | 1) => near(along(SEGMENTS[here], 0.72 + side * LEAD));
const onCableAbove = (here: number, side: -1 | 1) => near(along(SEGMENTS[here + 1], 0.28 - side * LEAD));
const inHerHand = (here: number, side: -1 | 1) => offset(near(anchorAt(here)), side * 3, -8);
const carabinerAt = (key: string, side: -1 | 1) => (w: World): Transform => {
  const here = segmentOf(w);
  const seg = w.flag<number>(key, 0);
  if (seg === -1) return inHerHand(here, side);
  return seg > here ? onCableAbove(here, side) : onCableBelow(here, side);
};
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
  fallback: "风从缝里往上灌。",
  exitWhen: flag(STEP, { gte: TOTAL }),
  entities: [
    // The two carabiners, hanging at the anchor she stands at. Each click moves one; one always stays on the cable.
    // Where each lock is, is read off the painting and nothing else: on the length below her, a hand's width out in
    // front of her (the (side·3, −8) offset of `inHerHand`), or already on the length above. No sprite swap: the
    // view drops `sprite.className` for hotspot images (only PropSprite passes it on), so a swap that changed
    // nothing but the class was a state no player could ever see. The open gate is an art + engine request.
    { id: "carabiner-blue", transform: carabinerAt(A, -1), className: "carabiner-hotspot",
      sprite: { src: "sprites/carabiner-blue.webp", layer: "hand", sizeVh: 6 },
      interactable: { verbs: ["clip"], label: "蓝锁", reveal: 14, cost: { minutes: 0 }, requires: worn("lanyard") },
      visible: flag(PHASE, { eq: "clip" }) },
    { id: "carabiner-orange", transform: carabinerAt(B, 1), className: "carabiner-hotspot",
      sprite: { src: "sprites/carabiner-orange.webp", layer: "hand", sizeVh: 6 },
      interactable: { verbs: ["clip"], label: "橙锁", reveal: 14, cost: { minutes: 0 }, requires: worn("lanyard") },
      visible: flag(PHASE, { eq: "clip" }) },
    // Up one segment: the cable (six minutes, the hands) or the pale rock beside it (ten minutes, free).
    { id: "haul-cable", transform: (w) => near(HAUL[segmentOf(w)]), className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "拉钢缆", reveal: 13, cost: { minutes: 6, fatigue: 0.06 } },
      hold: { ms: 700, scaleWith: ["fatigue"] }, visible: flag(PHASE, { eq: "climb" }) },
    { id: "rock-holds", transform: (w) => near(ROCK[segmentOf(w)]), className: "climb-hotspot",
      sprite: { src: "sprites/hold-knob.webp", layer: "prop", sizeVh: 6 },
      interactable: { verbs: ["hold"], label: "找岩点", reveal: 13, cost: { minutes: 10 } },
      hold: { ms: 1000, scaleWith: ["fatigue"] }, visible: flag(PHASE, { eq: "climb" }) },
    // From the third anchor: the cable she came up on runs back down out of the picture (v4 §6: 一分钟，一张照片).
    // One hotspot on the painted cable, not two — a hotspot only ever fires verbs[0] (see requests.engine), and the
    // second one was labelled with a verb instead of a thing.
    { id: "view-down", transform: VIEW_DOWN,
      interactable: { verbs: ["photograph"], label: "往下的钢缆", reveal: 12, cost: { minutes: 0 } },
      visible: flag(STEP, { gte: 2 }) },
    // Two dots high on the right wall: the only two people she will meet all day, an hour ahead of her.
    { id: "climbers-far", transform: CLIMBERS, sprite: { src: "sprites/climbers-far.webp", layer: "figure", sizeVh: 2.4 },
      gaze: { radius: 10, dwell: 900 }, visible: flag(STEP, { gte: 1 }) },
    // Three candidate marks: paint on the left wall beside the lowest rung, a rust streak on the right block, lichen on the loose boulder.
    mark("blaze-cable", { yaw: -24, pitch: -13 }, true),
    mark("rust-cable", { yaw: 41, pitch: -12 }, false),
    mark("lichen-cable", { yaw: -22, pitch: -32 }, false),
    // The cap, when a gust takes it (v4 §8: 风大时抓帽子): snagged on the rock beside her until the next gust, and
    // an E-key action to snatch it back, which is where the engine puts things done in one movement. Both halves
    // wait for sprites/item-cap.webp together (see the header): a button reading 抓住帽子 over a piece of rock with
    // no cap on it is a promise the painting cannot keep.
    ...(ART_LANDED ? [
      { id: "cap-loose", transform: (w: World) => offset(near(anchorAt(stepOf(w))), -11, -7),
        sprite: { src: "sprites/item-cap.webp", layer: "prop" as const, sizeVh: 7 },
        visible: flag(CAP, { eq: true }) },
      { id: "cap-grab", transform: OFFSCREEN, tags: ["action"],
        interactable: { verbs: ["take" as const], label: "抓住帽子", reveal: 0, cost: { minutes: 1 } },
        visible: flag(CAP, { eq: true }) },
    ] : []),
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
    if (ART_LANDED) ctx.on("camera:impulse", ({ kind, strength }) => {
      if (kind !== "turn") return;
      const s = strength ?? 0;
      if (ctx.flag(CAP, false)) { if (s >= 0.9) capGone("被风吹走"); return; }
      if (s < 1.3 || ctx.flag("cable.capBlown", false) || !w.state.inventory.worn.includes("cap") || w.rt.rng() > 0.15) return;
      ctx.setFlag("cable.capBlown", true); ctx.setFlag(CAP, true);
      ctx.sfx("cloth", -0.6, 1); ctx.kick("jolt", 0.7); ctx.fx("gust", 1.2);
      ctx.say("帽子。", { tag: "cable-cap", priority: 1 });
    });
    ctx.onInteract("cap-grab", () => {
      if (!ctx.flag(CAP, false)) return;
      ctx.setFlag(CAP, false); ctx.setFlag("cable.capCaught", true);
      ctx.sfx("cloth"); ctx.kick("settle", 0.5); ctx.hand(ctx.transformOf("cap-loose"), "grip");
    });

    /* Carabiners: any clipped one can come off; one in the hand goes onto the segment above. Both off is the one real scare:
       a lurch, three minutes, the hands, and both locks back on the segment below. She never falls. */
    const bothOff = (here: number) => {
      ctx.setFlag(A, here); ctx.setFlag(B, here);
      w.emit("body:slip", { entity: "carabiner-blue", severity: 1 });
      ctx.sfx("slip", 0, 1.2); ctx.sfx("thud", 0, 0.6); ctx.kick("slip", 1.4, { yaw: 0, pitch: -14 });
      ctx.hand(onCableBelow(here, -1), "carabiner", true);
      ctx.spend({ minutes: 3 }, "两把锁同时离缆");
      ctx.bump("cable.bothOff", 1);
      ctx.say("手心一凉。挂回去。", { tag: "cable-bothoff", priority: 1 });
    };
    const clip = (mine: string, other: string, side: -1 | 1) => {
      const here = step();
      if (here >= TOTAL) return;
      if (rung(mine) !== -1) {
        if (rung(other) === -1) return bothOff(here);
        ctx.setFlag(mine, -1);
        ctx.sfx("tock", side * 0.3); ctx.kick("clink", 0.6); ctx.hand(inHerHand(here, side), "carabiner");
        return;
      }
      const next = here + 1;
      ctx.setFlag(mine, next);
      ctx.sfx("clink", side * 0.3); ctx.kick("clink"); ctx.hand(onCableAbove(here, side), "carabiner");
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

    /* Looking. Down the cable from the third anchor: she leans out, looks, and takes it — a minute for the lean and
       the phone's own minute for the shutter (v4 §6 gives this one minute and one photograph; the lean is the
       minute, the shutter is the phone's). The line stays on what 04-cable actually paints down there: the thick
       cable running out of the bottom of the picture, and nothing under it — §6 asks for the whole meadow and the
       gravel road down there and the painting does not have them, so what is delivered here is a look down, not a
       view over the meadow (see `requests` for the art that would make it §6's line). */
    ctx.onInteract("view-down", () => {
      ctx.spend({ minutes: 1 }, "往下看");
      ctx.kick("glance", 0.6, { yaw: -2, pitch: -8 }); ctx.sfx("breath", -0.4, 0.6);
      ctx.say("缆一直下到看不见。", { tag: "cable-view" });
      w.dispatch({ type: "phone:shoot" }); ctx.setFlag("cable.photoDown", true);
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

    /* Leaving: whatever the wind still holds of the cap goes. No minutes are charged for leaving unsure — header note 2. */
    ctx.on("travel:begin", ({ from }) => {
      if (from !== "cable") return;
      capGone("留在墙上");
    });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-cable", verb: "inspect" }, { wait: 300 },
    ...route("haul-cable", 2100),
  ],
  variants: {
    // Every anchor on the rock: ten minutes each, nothing on the hands, and 50 minutes on the wall instead of 30.
    // Leaves without confirming a mark, which on this wall costs nothing at all (see the header, note 2).
    rock: route("rock-holds", 2900),
    // Both locks off at the first anchor: the lurch, three minutes, then the whole cable.
    slip: [
      { type: "interact", entity: "carabiner-blue", verb: "clip" }, { type: "interact", entity: "carabiner-orange", verb: "clip" }, { wait: 600 },
      ...route("haul-cable", 2100),
    ],
    // Everything the wall offers: the marks, the ring, the look down from the third anchor and its photograph, mixed climbing.
    thorough: [
      { type: "interact", entity: "lichen-cable", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-cable", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "anchor-ring", verb: "inspect" }, { wait: 300 },
      ...round("rock-holds", 2900), ...round("haul-cable", 2100),
      { type: "interact", entity: "view-down", verb: "photograph" }, { wait: 300 },
      { type: "interact", entity: "rust-cable", verb: "inspect" }, { wait: 300 },
      ...round("rock-holds", 2900), ...round("haul-cable", 2100), ...round("haul-cable", 2100),
      { type: "travel", entity: "go" },
    ],
  },
});
