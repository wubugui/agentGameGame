/* The upper stretch of last night's forest path, day two, ten in the morning (SOURCE_TRANSCRIPT day 2 §13):
   inside the circle Find My drew she turned over everything — 巨石、矮松、灌木、Sassolungo 石墙下 — and found
   nothing. This stand is the piece of path she came down on her hands and knees, and the only things it gives
   back are her own: a patch of moss rubbed off the bank, a branch snapped new, a very shallow knee print in the
   mud (v4 §8). Nothing here points anywhere — she still does not know where the phone went (v4 §12 B6) — and the
   two empty places stay empty however long she works at them.
   In daylight the wood is not frightening at all (v4 §9), and day two has no gate at all (v4 §8): both ways out
   are on the painting from the first minute and nothing has to be done to earn them.
   Every coordinate was read off the 150°×84° grid of 18c-searchpath (yaw = (x/W − .5)·150,
   pitch = (.5 − y/H)·84); the pixel it came from (1280×720) is noted beside it. */
import { entityIs, flag, not } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { EntityId, SfxName, Transform } from "../engine/types";
import { backArrow, goArrow, prop, wrongWay } from "./_shared";

const TURNED = "searchPath.turned";        // how many of this stand's five places she has been through
const FOUND_MOSS = "searchPath.moss";      // the scuffed moss on the bank
const FOUND_KNEE = "searchPath.knee";      // the knee print in the mud beside the sand
const FOUND_BRANCH = "searchPath.branch";  // the branch snapped off under the creeping pine

/** The five places on this canvas she can go down on one knee and turn over. Twelve minutes each (v4 §6).
 *  Three of them give back a trace she left here herself; two of them give back nothing, and go on giving
 *  back nothing — that is the fact, not a punishment (v4 §6). Ids follow data/descent.ts SEARCH_SPOTS where
 *  the table already has them (path-moss / path-knee become the traces those places yield). */
type Spot = {
  id: EntityId; label: string; sfx: SfxName; pan: number; fx: "dust" | "gust";
  transform: Transform; find?: "moss" | "knee" | "branch";
};
const SPOTS: Spot[] = [
  // The pale sand of the path itself, right where it flattens out in front of her (700, 568).
  { id: "path-sand", label: "路面的沙土", sfx: "slide", pan: 0.1, fx: "dust", transform: { yaw: 7, pitch: -23 }, find: "knee" },
  // The mossy bank of roots and stones on the left, where the green runs down to the bare dirt (529, 467).
  { id: "moss-bank", label: "路边的苔藓", sfx: "cloth", pan: -0.3, fx: "gust", transform: { yaw: -13, pitch: -12.5 }, find: "moss" },
  // The creeping pine spread over the slope on the right, its near lobe over the path edge (964, 514).
  { id: "pine-bush", label: "矮松丛", sfx: "cloth", pan: 0.5, fx: "gust", transform: { yaw: 38, pitch: -18 }, find: "branch" },
  // The long pale stone lying at the left edge of the sand, a streak of moss along its back (580, 576).
  { id: "flat-stone", label: "路边那块长石头", sfx: "thud", pan: -0.15, fx: "dust", transform: { yaw: -7, pitch: -25 } },
  // The heap of rounded boulders down the slope on the left, in their own shadow (375, 634).
  { id: "boulders", label: "坡下的几块巨石", sfx: "thud", pan: -0.55, fx: "dust", transform: { yaw: -31, pitch: -32, distance: 9 } },
];

const MOSS_SCUFF: Transform = { yaw: -16, pitch: -14 };        // the green of the bank itself, just above the bare dirt (503, 480)
const KNEE_PRINT: Transform = { yaw: 17, pitch: -21 };         // the damp brown dirt along the right edge of the sand (785, 540)
const BROKEN_BRANCH: Transform = { yaw: 34, pitch: -22 };      // the bare ground at the foot of the creeping pine (930, 549)
const PACK_DOWN: Transform = { yaw: -13, pitch: -33 };         // the pine needles left of the sand, at her feet (529, 643)
const BIG_ROOT: Transform = { yaw: -35, pitch: -17 };          // the roots of the big pine coming out of the bank (345, 510)
const SPIRES: Transform = { yaw: 0, pitch: 22, distance: 30 }; // the rock towers standing over the canopy (640, 161)
const UP_PATH: Transform = { yaw: 5, pitch: -10 };             // the sand going on up over the rise (683, 446)
const DOWN_PATH: Transform = { yaw: 2, pitch: -31 };           // the sand going out of the picture at her feet (657, 626)
const HOME_PATH: Transform = { yaw: 18, pitch: -34 };          // the same sand, lower and further right, leaving the frame (794, 651)

const TO_SEARCH = 10;    // the ten minutes search charges to walk up here, paid again going back
const TO_HOTEL = 35;     // those ten plus the twenty-five from the stand below down to the village

export default defineScene({
  id: "searchPath",
  day: 2, place: "昨晚的小路 · 第二天", elevation: "1,800 m",
  painting: "pano/18c-searchpath.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.3, windTone: 850, birds: 0.65, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen" },
  arriveAt: 10 * 60,
  idleLook: true,
  fallback: "昨晚我从这儿爬下去的。",
  // Day two has no completion threshold (v4 §8): nothing gates either way out.
  exitWhen: undefined,
  entities: [
    // The five places. Turned over once, then grey: the picture keeps the record of what she has already done.
    ...SPOTS.map((spot): EntityDef => ({
      id: spot.id, transform: spot.transform, className: "search-hotspot",
      interactable: { verbs: ["inspect"], label: spot.label, reveal: 13, cost: { minutes: 12 }, once: true },
      enabled: not(entityIs(spot.id, "used")),
      ...(spot.id === "pine-bush" ? { gaze: { radius: 13, dwell: 1000 } } : {}),
    })),
    // What the bank gives up: a hand's width of moss rubbed off it. Hers, and it stays where it is.
    { id: "moss-scuff", transform: MOSS_SCUFF,
      sprite: { src: "sprites/moss-scuff.webp", layer: "prop", sizeVh: 8 },
      interactable: { verbs: ["inspect"], label: "蹭掉的苔藓", reveal: 12, cost: { minutes: 1 }, once: true },
      visible: flag(FOUND_MOSS), enabled: not(entityIs("moss-scuff", "used")) },
    // What the sand gives up: one very shallow knee print in the mud along its edge.
    { id: "knee-print", transform: KNEE_PRINT,
      sprite: { src: "sprites/knee-print.webp", layer: "prop", sizeVh: 7 },
      interactable: { verbs: ["inspect"], label: "泥地上很浅的印", reveal: 12, cost: { minutes: 1 }, once: true },
      gaze: { radius: 12, dwell: 900 },
      visible: flag(FOUND_KNEE), enabled: not(entityIs("knee-print", "used")) },
    // What the creeping pine gives up: one branch snapped off at the root of it, the break still pale.
    { id: "broken-branch", transform: BROKEN_BRANCH,
      sprite: { src: "sprites/broken-branch.webp", layer: "prop", sizeVh: 7 },
      interactable: { verbs: ["inspect"], label: "断掉的树枝", reveal: 12, cost: { minutes: 1 }, once: true },
      visible: flag(FOUND_BRANCH), enabled: not(entityIs("broken-branch", "used")) },
    // The pack comes off her back the first time she kneels down, and stays on the needles.
    prop("pack-down", PACK_DOWN, "sprites/backpack-floor.webp", 14, { visible: flag(TURNED, { gte: 1 }) }),
    // The roots of the big pine, out of the bank at hand height. Last night she came down past them holding on.
    { id: "big-root", transform: BIG_ROOT, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "露出来的树根", reveal: 13, cost: { minutes: 2 }, requires: not(flag("searchPath.root")) },
      hold: { ms: 750, scaleWith: ["fatigue"] },
      enabled: not(flag("searchPath.root")) },
    // The towers standing over the canopy. Yesterday she was on the far side of them.
    { id: "spires", transform: SPIRES,
      interactable: { verbs: ["inspect"], label: "树顶上的石塔", reveal: 13, cost: { minutes: 1 }, once: true },
      gaze: { radius: 13, dwell: 900 } },
    // Further up the path, out past the edge of the circle. Twelve minutes there and back, and nothing in them.
    wrongWay("up-path", UP_PATH, "小路再往上一段", 12, "再往上，就在圈外了。"),
    // Both ways out, on the painting from the first minute (v4 §7: the way home is never gated).
    backArrow("back", DOWN_PATH, "search", "沿小路走回去", TO_SEARCH),
    goArrow("go-hotel", HOME_PATH, { to: "hotel", minutes: TO_HOTEL, label: "顺小路回酒店", kind: "walk" }),
  ],
  seed: (w) => {
    // What this stand leaves behind: the rest of the eight places turned over, three traces of her own, no phone.
    const list = String(w.flag("search.spots", "")).split(",").filter(Boolean);
    for (const spot of SPOTS) if (!list.includes(spot.id)) list.push(spot.id);
    w.setFlag("search.spots", list.join(","));
    w.setFlag(TURNED, SPOTS.length);
    w.setFlag(FOUND_MOSS, true);
    w.setFlag(FOUND_KNEE, true);
    w.setFlag(FOUND_BRANCH, true);
    w.setFlag("searchPath.root", true);
  },
  walkthrough: [
    { wait: 300 },
    { type: "travel", entity: "back" },
  ],
  variants: {
    // Everything this stand has: all five places, the three traces, the root, the towers, the path above.
    thorough: [
      { type: "interact", entity: "moss-bank", verb: "inspect" },
      { wait: 300 },
      { type: "interact", entity: "moss-scuff", verb: "inspect" },
      { type: "interact", entity: "path-sand", verb: "inspect" },
      { wait: 300 },
      { type: "interact", entity: "knee-print", verb: "inspect" },
      { type: "interact", entity: "pine-bush", verb: "inspect" },
      { wait: 300 },
      { type: "interact", entity: "broken-branch", verb: "inspect" },
      { type: "interact", entity: "flat-stone", verb: "inspect" },
      { wait: 300 },
      { type: "interact", entity: "boulders", verb: "inspect" },
      { wait: 300 },
      { type: "hold:start", entity: "big-root" },
      { wait: 2400 },
      { type: "hold:end" },
      { type: "interact", entity: "spires", verb: "inspect" },
      { type: "interact", entity: "up-path", verb: "inspect" },
      { wait: 600 },
      { type: "travel", entity: "back" },
    ],
    // Turn over the piece of path she actually crawled down, then go straight home from up here.
    home: [
      { type: "interact", entity: "path-sand", verb: "inspect" },
      { wait: 400 },
      { type: "interact", entity: "knee-print", verb: "inspect" },
      { wait: 400 },
      { type: "travel", entity: "go-hotel" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, {
        yaw: Math.max(-6, Math.min(6, (target.yaw - here.yaw) * 0.15)),
        pitch: Math.max(-5, Math.min(5, (target.pitch - here.pitch) * 0.15)),
      });
    };
    const addSpot = (id: EntityId) => {
      const list = String(ctx.flag("search.spots", "")).split(",").filter(Boolean);
      if (list.includes(id)) return;
      ctx.setFlag("search.spots", [...list, id].join(","));
    };
    const traces = () => [FOUND_MOSS, FOUND_KNEE, FOUND_BRANCH].filter((key) => ctx.flag(key, false)).length;

    /* Turning a place over: the pack goes down, she kneels, the ground answers, and either something of hers is
       lying under it or nothing is. Twelve minutes either way; the two empty ones stay empty for good. */
    for (const spot of SPOTS) {
      ctx.onInteract(spot.id, () => {
        addSpot(spot.id);
        ctx.bump(TURNED, 1);
        ctx.hand(spot.transform, "grip");
        ctx.kick("glance", 0.6, { yaw: 0, pitch: -7 });
        ctx.sfx(spot.sfx, spot.pan, 0.6);
        ctx.fx(spot.fx, 0.22);
        w.emit("body:rest", { seconds: 2.4 });
        ctx.after(420, () => ctx.sfx(spot.fx === "gust" ? "cloth" : "slide", spot.pan, 0.3));
        if (!spot.find) {
          // Nothing under it. She puts it back the way it was and stands up out of it, without a word.
          ctx.after(900, () => { ctx.kick("settle", 0.5); ctx.sfx("exhale", spot.pan, 0.6); });
          return;
        }
        // Something of her own is under it. Her head turns to it; the picture keeps it from now on.
        const where = spot.find === "moss" ? MOSS_SCUFF : spot.find === "knee" ? KNEE_PRINT : BROKEN_BRANCH;
        ctx.setFlag(spot.find === "moss" ? FOUND_MOSS : spot.find === "knee" ? FOUND_KNEE : FOUND_BRANCH, true);
        ctx.after(560, () => { glanceAt(where, 0.55); ctx.sfx("tick", spot.pan, 0.4); });
      });
    }

    /* The three traces. Each one is hers, each one proves only that she came through here, and she leaves all
       three where they are. Nothing about any of them says where the phone went (v4 §12 B6). */
    ctx.onInteract("moss-scuff", () => {
      ctx.hand(MOSS_SCUFF, "grip");
      ctx.kick("glance", 0.45, { yaw: 0, pitch: -3 });
      ctx.sfx("cloth", -0.3, 0.5);
      ctx.after(520, () => ctx.sfx("breath", -0.3, 0.4));
      ctx.say("昨晚我从这里爬过。苔藓被蹭掉了一块。", { tag: "path-moss", priority: 1 });
    });
    ctx.onInteract("knee-print", () => {
      ctx.hand(KNEE_PRINT, "grip");
      ctx.kick("glance", 0.5, { yaw: 0, pitch: -6 });
      ctx.sfx("breath", 0.15, 0.45);
      ctx.after(540, () => { ctx.kick("settle", 0.3); ctx.sfx("exhale", 0.15, 0.6); });
      ctx.say("泥地上一个很浅的膝盖印。是我的。", { tag: "path-knee", priority: 1 });
    });
    ctx.onInteract("broken-branch", () => {
      ctx.hand(BROKEN_BRANCH, "grip");
      ctx.kick("pull", 0.45);
      ctx.sfx("thud", 0.45, 0.5);
      ctx.after(500, () => ctx.sfx("cloth", 0.45, 0.35));
      ctx.say("树枝是新断的。", { tag: "path-branch" });
    });

    /* The roots of the big pine: she takes hold of them the way she took hold of them in the dark, and lets go.
       Letting go early costs nothing at all — there is nothing under her this morning. */
    ctx.onHold("big-root", () => {
      ctx.setFlag("searchPath.root", true);
      ctx.kick("pull", 0.6);
      ctx.sfx("grip", -0.4, 0.7);
      ctx.after(600, () => { ctx.kick("settle", 0.4); ctx.sfx("cloth", -0.4, 0.4); });
      ctx.say("这根树根，我昨晚抓过。", { tag: "path-root" });
    });
    ctx.onRelease("big-root", () => {
      ctx.kick("settle", 0.3);
      ctx.sfx("cloth", -0.4, 0.45);
    });

    /* The towers over the canopy: a minute of looking, a breath, and nothing else. */
    ctx.onInteract("spires", () => {
      ctx.setFlag("searchPath.looked", true);
      glanceAt(SPIRES, 0.7);
      ctx.sfx("exhale", 0, 0.6);
    });
    ctx.onGaze("spires", () => {
      if (ctx.flag("searchPath.sawSpires", false)) return;
      ctx.setFlag("searchPath.sawSpires", true);
      ctx.sfx("breath", 0, 0.45);
      ctx.kick("settle", 0.2);
    });

    /* Looking into the creeping pine long enough: last night's rain comes off it in drops. */
    ctx.onGaze("pine-bush", () => {
      if (ctx.flag("searchPath.dew", false)) return;
      ctx.setFlag("searchPath.dew", true);
      ctx.sfx("tick", 0.5, 0.4);
      ctx.after(380, () => ctx.sfx("tick", 0.55, 0.3));
      ctx.kick("glance", 0.35, { yaw: 2, pitch: -3 });
    });

    /* The print, once she has found it: her breath goes out of her when her eyes stay on it. */
    ctx.onGaze("knee-print", () => {
      if (ctx.flag("searchPath.sawKnee", false)) return;
      ctx.setFlag("searchPath.sawKnee", true);
      ctx.sfx("breath", 0.15, 0.5);
      ctx.kick("settle", 0.25);
    });

    /* Twelve minutes up the path and twelve minutes back: past the rise she is outside the circle Find My drew,
       so there is nothing up there to turn over. She walks it, looks, and comes back down. */
    ctx.onInteract("up-path", () => {
      ctx.setFlag("searchPath.above", true);
      ctx.kick("step", 0.8);
      ctx.sfx("step", 0.15, 0.6);
      ctx.fx("dust", 0.3);
      ctx.after(620, () => { ctx.kick("turn", 0.6); ctx.sfx("step", 0.1, 0.4); });
      ctx.say("再往上，就在圈外了。", { tag: "path-above" });
    });

    /* Standing still on it. A drop off a branch on the right, then a bird further off, and then the thing the
       morning actually gives back: this is the wood she crawled down in the dark, and it is not frightening. */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 1) { ctx.sfx("tick", 0.45, 0.35); ctx.kick("glance", 0.3, { yaw: 3, pitch: -2 }); return; }
      if (stills === 2) { ctx.sfx("breath", -0.35, 0.45); ctx.kick("settle", 0.2); return; }
      if (stills === 3 && !ctx.flag("searchPath.morning", false)) {
        ctx.setFlag("searchPath.morning", true);
        ctx.sfx("exhale", 0, 0.6);
        ctx.kick("settle", 0.25);
        ctx.say("白天的林子，一点都不吓人。", { tag: "path-morning" });
      }
    });

    /* Leaving, by either way out. Nothing had to be done to earn this, and what she says on the way down is
       made of what she turned over and what she got back — none of it a phone. */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "searchPath" || (to !== "search" && to !== "hotel")) return;
      const turned = Number(ctx.flag(TURNED, 0));
      const line = traces() >= 3 ? "我找到的全是我自己。"
        : turned >= 3 ? "能翻的都翻了。"
          : turned > 0 ? "这一段也没有。"
            : "回去吧。";
      ctx.kick("turn", 0.5);
      ctx.sfx("step", 0, 0.5);
      ctx.say(line, { tag: "path-leave", priority: 1 });
    });
  },
});
