/* Val Lasties, 19:20. The scree stops. She steps off the last white boulders onto grass, and there is a herd
   standing in it between her and the tree line — a dozen of them, the only living thing she has seen all day
   (SOURCE_TRANSCRIPT day 1 §9). However she plays it they end the same way: startled, heads round, gone back into
   the far forest. What the player decides is only how much of them he gets first, and how late he got here to
   look (v4 §6 deer: 完整的一群 → 几个影子 → 两点反光; v4 §7 deer: 停住 / 绕开 / 直接走过去).
   Every coordinate was read off the 150°×84° grid of 12-deer (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import type { Condition } from "../engine/condition";
import { all, any, flag, not } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { blaze, goArrow, lookAt } from "./_shared";

const SEEN = "deer.seen";        // the invariant every later scene leans on (contract §6)
const HOW = "deer.how";          // "still" | "skirt" | "through"
const BOLTED = "deer.bolted";
const FLEEING = "deer.fleeing";  // the 800 ms while they are actually running
const ALERT = "deer.alert";      // heads up, watching her
const FAWN = "deer.fawn";        // the smallest one has come two steps closer
const WATCH = "deer.watching";   // she took the tree line: they have turned and are tracking her
const GONE = "deer.gone";        // she made a noise before she got here: they left without her
const COUNTED = "deer.counted";
const PHOTO = "deer.photo";
const CERTAIN = "deer.certain";

const TO_FOREST_EDGE = 55;       // v4 §3.1: deer 19:20 → forestEdge 20:15
const LOST_MINUTES = 12;         // no confirmed mark: v4 §3.5 charges 12 for this terrain band (scree uses 12 too)

// Things painted in 12-deer, with the pixel they were read from.
const HERD: Transform = { yaw: 14, pitch: -25, distance: 14 };        // the open grass under the rise, left of the big boulder (760, 574)
const FAWN_AT: Transform = { yaw: 17, pitch: -29.5, distance: 11 };   // the grass two steps nearer, in front of the herd (785, 613)
const PRESS: Transform = { yaw: 18, pitch: -28.5, distance: 10 };     // the grass they were standing in (794, 604)
const HOOF: Transform = { yaw: 26, pitch: -32, distance: 9 };         // the wide sandy path in front of her feet (862, 634)
const TREELINE: Transform = { yaw: 12, pitch: -15.5 };                // the tall dark spruce where the scree runs into the wood (745, 493)
const BOULDER: Transform = { yaw: 27, pitch: -25 };                   // the big white boulder standing beside the path (870, 574)
const RUST_ROCK: Transform = { yaw: -14.5, pitch: -19.3 };            // the rust-orange block in the boulder field at the scree foot (516, 526)
const SCREE_BACK: Transform = { yaw: -36, pitch: -2, distance: 16 };  // the pale cone of the scree she has just come down (333, 377)
const SUNSET: Transform = { yaw: 32, pitch: 26, distance: 16 };       // the orange cloud band over the right-hand sky (912, 137)
const SASSO: Transform = { yaw: 44.5, pitch: 8.7, distance: 16 };     // the jagged grey wall across the valley (1020, 285)
const TRAIL_IN: Transform = { yaw: 41, pitch: -27.5 };                // where the sandy path runs out under the first larches (1007, 597)

/* Two light thresholds. lightOf() is 1 at 18:45 and 0 from 20:15 on, so these are the two moments
   at which the herd stops being a herd: first shapes, then two points of reflected light. */
const DIM: Condition = { kind: "light", lt: 0.3 };
const DARK: Condition = { kind: "light", lt: 0.001 };
const HERE = all(not(flag(GONE)), not(flag(BOLTED)));
const AFTERWARDS = any(flag(BOLTED), flag(GONE));
const HEADS_UP = any(flag(ALERT), flag(WATCH));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pan = (t: Transform) => clamp(t.yaw / 45, -1, 1);

/* A look she only takes once: after that the hotspot is spent (as in roadside / exit / signpost / summit). */
const look1 = (id: string, t: Transform, label: string, extra: Partial<EntityDef> = {}): EntityDef =>
  lookAt(id, t, label, 1, {
    interactable: { verbs: ["inspect", "photograph"], label, reveal: 12, cost: { minutes: 1 }, once: true },
    ...extra,
  });

export default defineScene({
  id: "deer",
  day: 1, place: "Val Lasties · 坡脚林线", elevation: "2,050 m",
  painting: "pano/12-deer.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.45, windTone: 900, birds: 0.15, crickets: 0.35, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen", windPan: 0.3 },
  arriveAt: 19 * 60 + 20,
  idleLook: true,
  fallback: "灰白的碎石坡到这里就完了。",
  // No gate: leaving is itself one of the three ways past them (v4 §7), and it is what sets deer.seen.
  exitWhen: undefined,
  entities: [
    /* The herd. Nothing but deer and the grass they stand in — the checked-in deer-herd.webp has a band of spruce
       painted into its top half, which at this pitch would put toy conifers in the middle of the meadow, so the
       whole family is re-cut (deer-herd-grass and its states, see the sprites output). Six faces: running,
       eyeshine, shapes with heads up, shapes, turned and tracking her, heads up. */
    { id: "herd", transform: HERD,
      sprite: { src: "sprites/deer-herd-grass.webp", layer: "figure", sizeVh: 6, swap: [
        { when: flag(FLEEING), src: "sprites/deer-fleeing.webp" },
        { when: DARK, src: "sprites/deer-eyeshine.webp" },
        { when: all(DIM, HEADS_UP), src: "sprites/deer-shadows-alert.webp" },
        { when: DIM, src: "sprites/deer-shadows.webp" },
        { when: flag(WATCH), src: "sprites/deer-herd-watching.webp" },
        { when: flag(ALERT), src: "sprites/deer-herd-alert.webp" },
      ] },
      interactable: { verbs: ["inspect"], label: "草坡上的鹿群", reveal: 16, cost: { minutes: 3 }, once: true },
      gaze: { radius: 16, dwell: 700 },
      visible: HERE },
    // The smallest one, once she has stood still long enough for it to risk two steps. It dims with the rest.
    { id: "fawn", transform: FAWN_AT,
      sprite: { src: "sprites/deer-fawn.webp", layer: "figure", sizeVh: 5.5, swap: [
        { when: DARK, src: "sprites/deer-fawn-eyeshine.webp" },
        { when: DIM, src: "sprites/deer-fawn-shadow.webp" },
      ] },
      gaze: { radius: 12, dwell: 600 },
      visible: all(flag(FAWN), not(flag(BOLTED))) },
    // Keeping to the trees instead of crossing the open grass: six minutes, and she gets to watch them longer.
    { id: "treeline", transform: TREELINE,
      interactable: { verbs: ["step"], label: "林线下的那排云杉", reveal: 14, cost: { minutes: 6 } },
      visible: HERE },
    // What is left afterwards, and all there ever is if she made a noise coming down.
    { id: "hoofprints", transform: HOOF,
      sprite: { src: "sprites/hoofprints.webp", layer: "prop", sizeVh: 8, swap: [
        { when: DARK, src: "sprites/hoofprints-dark.webp" },
      ] },
      interactable: { verbs: ["inspect"], label: "小路上的蹄印", reveal: 13, cost: { minutes: 1 }, once: true },
      visible: AFTERWARDS },
    { id: "grass-pressed", transform: PRESS,
      sprite: { src: "sprites/grass-pressed.webp", layer: "prop", sizeVh: 4.5, swap: [
        { when: DARK, src: "sprites/grass-pressed-dark.webp" },
      ] },
      interactable: { verbs: ["inspect"], label: "草上的压痕", reveal: 13, cost: { minutes: 1 }, once: true },
      visible: AFTERWARDS },
    // Two candidate marks: the red-white bar on the boulder beside the path, and a rust stain on the red block.
    blaze("blaze-deer", BOULDER, true),
    blaze("rust-deer", RUST_ROCK, false),
    // Looking. The scree behind her, the last of the sun, the wall across the valley. A minute each, once each.
    look1("scree-back", SCREE_BACK, "刚下来的碎石坡"),
    look1("sunset-clouds", SUNSET, "天上最后一道橙色", { visible: { kind: "light", gte: 0.001 } }),
    look1("sassolungo", SASSO, "对面的锯齿石墙"),
    // The way on: where the path runs out under the first larches. Never locked (D6).
    goArrow("go", TRAIL_IN, { to: "forestEdge", minutes: TO_FOREST_EDGE, label: "小路钻进树林的地方", kind: "run" }),
  ],
  seed: (w) => {
    w.setFlag(SEEN, true);
    w.setFlag(HOW, "still");
    w.setFlag(BOLTED, true);
    w.setFlag(FLEEING, false);
    w.setFlag(ALERT, false);
    w.setFlag(FAWN, false);
    w.setFlag(WATCH, false);
    w.setFlag(GONE, false);
    w.setFlag(COUNTED, true);
    w.setFlag(CERTAIN, true);
  },
  walkthrough: [
    // The fastest legal way through: settle the mark on the boulder (free, and it saves the five minutes of
    // hunting for the trail under the larches), then walk on. They go up in front of her as she does.
    { type: "interact", entity: "blaze-deer", verb: "inspect" }, { wait: 300 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Stand still twice: heads up, then the smallest one comes two steps closer. Then count them, then walk on.
    still: [
      { type: "wait" }, { wait: 700 },
      { type: "wait" }, { wait: 700 },
      { type: "interact", entity: "herd", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Round them along the tree line: six minutes. They turn and track her instead of bolting, so the small one
    // risks it on the very first stand; the next thing she does is what finally sends them.
    skirt: [
      { type: "interact", entity: "treeline", verb: "step" }, { wait: 800 },
      { type: "wait" }, { wait: 700 },
      { type: "interact", entity: "herd", verb: "inspect" }, { wait: 1800 },
      { type: "interact", entity: "hoofprints", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Everything the meadow foot has: the mark, the wrong mark, the scree behind, the sun, the wall,
    // the count, one photograph, the long stand, the way round, and both traces they leave.
    thorough: [
      { type: "interact", entity: "rust-deer", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-deer", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "herd", verb: "inspect" }, { wait: 300 },
      { type: "phone:shoot" }, { wait: 400 },
      { type: "wait" }, { wait: 700 },
      { type: "wait" }, { wait: 700 },
      { type: "interact", entity: "treeline", verb: "step" }, { wait: 800 },
      { type: "interact", entity: "scree-back", verb: "inspect" }, { wait: 1800 },
      { type: "interact", entity: "sunset-clouds", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "sassolungo", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "hoofprints", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "grass-pressed", verb: "inspect" }, { wait: 300 },
      { type: "travel", entity: "go" },
    ],
    // Leave without confirming the mark: twelve minutes looking for where the path goes under the trees.
    blind: [{ type: "travel", entity: "go" }],
  },
  script: (ctx) => {
    const w = ctx.world;
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: clamp((target.yaw - here.yaw) * 0.15, -6, 6), pitch: clamp((target.pitch - here.pitch) * 0.15, -4, 4) });
    };
    const shoot = (target: Transform) => { w.dispatch({ type: "phone:shoot" }); glanceAt(target, 0.35); };
    const herdGone = () => ctx.flag(BOLTED, false) || ctx.flag(GONE, false);

    /* Arriving. The sound comes first and it comes from one side (v4 §3.8) — no line, no camera grab.
       If she shouted somewhere on the way down, the grass is already empty and the prints are all there is. */
    ctx.onEnter(() => {
      if (herdGone()) return;
      if (ctx.flag<number>("shout.at", 0) > 0 || ctx.flag("scree.shouted", false) || ctx.flag("signpost.shouted", false)) {
        // She arrives at an empty slope and the prints. That is still having seen them (contract §6/§8: deerSeen).
        ctx.setFlag(GONE, true); ctx.setFlag(SEEN, true); ctx.setFlag(HOW, "gone");
        ctx.sfx("cloth", pan(HERD), 0.3); ctx.kick("settle", 0.2);
        return;
      }
      ctx.sfx("hooves", pan(HERD), 0.35);
    });

    /* Seeing them at all: the herd's own beat, fired by the gaze resting on it (v4 §3.8, A5). */
    ctx.onGaze("herd", () => {
      if (ctx.flag("deer.noticed", false)) return;
      ctx.setFlag("deer.noticed", true); ctx.setFlag(SEEN, true);
      ctx.sfx("hooves", pan(HERD), 0.5); ctx.kick("glance", 0.45, { yaw: 1, pitch: -2 });
      ctx.say("前面有响动。", { tag: "deer-see" });
    });

    /* Counting them: three minutes, and what the count comes to depends only on how late she got here. */
    ctx.onInteract("herd", () => {
      ctx.setFlag(SEEN, true); ctx.setFlag(COUNTED, true);
      ctx.sfx("breath", pan(HERD), 0.5); ctx.kick("glance", 0.3, { yaw: 0, pitch: -1 });
      const light = ctx.light();
      ctx.say(light <= 0 ? "两点反光。就这些了。" : light < 0.3 ? "数不清。都是影子。" : "十几只。", { tag: "deer-count" });
    });

    /* A photograph of them: the day's only picture that is not a rock. The shutter does not frighten them. */
    ctx.on("phone:photo", ({ scene }) => {
      if (scene !== "deer" || herdGone() || ctx.flag(PHOTO, false)) return;
      ctx.setFlag(PHOTO, true); ctx.setFlag(SEEN, true);
      ctx.sfx("hooves", pan(HERD), 0.3); ctx.kick("glance", 0.3, { yaw: 0, pitch: -1 });
    });

    /* Standing still (v4 §7): the pointer unmoved is the whole action. First they lift their heads;
       then the smallest one risks two steps toward her; after that nothing more is given, only the breath. */
    let stills = 0;
    ctx.onWait(() => {
      if (herdGone()) return;
      stills += 1;
      ctx.setFlag(SEEN, true);
      if (ctx.flag(HOW, "") === "") ctx.setFlag(HOW, "still");
      // After sunset there is nothing to see happen, so the beats keep the sound and drop the words: a line about
      // heads coming up would be the only carrier, over a picture of two points of eyeshine that does not change.
      const dark = ctx.light() <= 0;
      const alreadyUp = ctx.flag(ALERT, false) || ctx.flag(WATCH, false);
      if (!alreadyUp && !ctx.flag(FAWN, false)) {
        ctx.setFlag(ALERT, true);
        ctx.sfx("hooves", pan(HERD), 0.25); ctx.kick("settle", 0.25);
        if (!dark) ctx.say("它们抬起头。", { tag: "deer-still" });
        return;
      }
      // From the tree line they are already turned toward her, so the smallest one risks it on the first stand.
      if (!ctx.flag(FAWN, false) && (stills >= 2 || ctx.flag(WATCH, false))) {
        ctx.setFlag(FAWN, true);
        ctx.sfx("step", pan(FAWN_AT), 0.35); ctx.after(340, () => ctx.sfx("step", pan(FAWN_AT), 0.3));
        ctx.kick("settle", 0.3);
        if (!dark) ctx.say("最小的那只往前走了两步。", { tag: "deer-fawn" });
        return;
      }
      ctx.sfx("breath", 0, 0.3); ctx.kick("settle", 0.15);
    });
    ctx.onGaze("fawn", () => {
      if (ctx.flag("deer.fawnSeen", false)) return;
      ctx.setFlag("deer.fawnSeen", true);
      ctx.sfx("breath", pan(FAWN_AT), 0.3); ctx.kick("settle", 0.2);
    });

    /* The one ending all three ways share: they turn and go back into the far forest.
       With the carvings from the first morning in the notebook, she remembers what else was on that shelf. */
    const bolt = (how: string) => {
      if (herdGone() || ctx.flag(FLEEING, false)) return;
      if (ctx.flag(HOW, "") === "") ctx.setFlag(HOW, how);
      ctx.setFlag(SEEN, true); ctx.setFlag(FLEEING, true);
      ctx.sfx("hooves", pan(HERD), 1.2); ctx.sfx("thud", pan(HERD), 0.5);
      ctx.kick("turn", 0.9, { yaw: 2, pitch: 0 }); ctx.fx("dust", 0.5);
      ctx.after(800, () => {
        ctx.setFlag(FLEEING, false); ctx.setFlag(BOLTED, true);
        ctx.setFlag(ALERT, false); ctx.setFlag(WATCH, false); ctx.setFlag(FAWN, false);
        ctx.sfx("hooves", 0.6, 0.35);
      });
      ctx.say(w.state.journal.entries.includes("E-forest") ? "纪念品上除了鹿，还有熊、狼、野猪。" : "跑回森林里去了。", { tag: "deer-bolt", priority: 1 });
    };

    /* Rounding them under the trees (v4 §7: 绕开 = 多站一会儿). Six minutes buys the only state in the scene where
       they neither graze nor run: they turn where they stand and track her along the tree line, close enough that
       the smallest one will come on the first stand. Nothing on a timer ends it — the next thing she DOES does. */
    ctx.onInteract("treeline", () => {
      if (herdGone()) return;
      ctx.setFlag(SEEN, true); ctx.setFlag(HOW, "skirt");
      ctx.setFlag(ALERT, true); ctx.setFlag(WATCH, true);
      ctx.kick("step", 0.7); ctx.sfx("step", -0.2, 0.6); ctx.fx("dust", 0.2);
      // Her step, then their heads coming round after it: one physical two-beat, well under a second.
      ctx.after(420, () => {
        if (herdGone()) return;
        ctx.sfx("hooves", pan(HERD), 0.3); ctx.kick("turn", 0.35, { yaw: 1, pitch: 0 });
      });
    });

    /* What they leave in the ground. */
    ctx.onInteract("hoofprints", () => {
      ctx.setFlag(SEEN, true); ctx.setFlag("deer.prints", true);
      ctx.hand(HOOF); ctx.kick("glance", 0.45, { yaw: 0, pitch: -5 }); ctx.sfx("step", pan(HOOF), 0.5);
    });
    ctx.onInteract("grass-pressed", () => {
      ctx.setFlag(SEEN, true); ctx.setFlag("deer.press", true);
      ctx.hand(PRESS); ctx.kick("glance", 0.4, { yaw: 0, pitch: -4 }); ctx.sfx("cloth", pan(PRESS), 0.5);
    });

    /* Looking around. Only two of the three are worth a half-line to her. */
    ctx.onInteract("scree-back", (verb) => {
      if (verb === "photograph") return shoot(SCREE_BACK);
      ctx.setFlag("deer.lookedBack", true);
      ctx.kick("turn", 0.7, { yaw: -4, pitch: 2 }); ctx.sfx("exhale", -0.5, 0.6);
      ctx.say("我是从那上面下来的。", { tag: "deer-back" });
    });
    /* The last orange. No line: the transcript's line about the clouds and the last sun leaving belongs to the
       scree, where the transcript puts it and where scree.scene.ts already says it. Here it is breath and light. */
    ctx.onInteract("sunset-clouds", (verb) => {
      if (verb === "photograph") return shoot(SUNSET);
      ctx.setFlag("deer.sawSunset", true);
      ctx.kick("glance", 0.5, { yaw: 2, pitch: 5 }); ctx.sfx("breath", 0.4, 0.5); ctx.fx("gust", 0.25);
    });
    ctx.onInteract("sassolungo", (verb) => {
      if (verb === "photograph") return shoot(SASSO);
      ctx.setFlag("deer.sawWall", true);
      ctx.kick("glance", 0.5, { yaw: 3, pitch: 2 }); ctx.sfx("breath", 0.6, 0.45);
    });

    /* The marks. The system pays for the wrong one (a minute and a tock); this adds the hand and the head. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.45); ctx.sfx("step", pan(BOULDER), 0.5); return; }
      if (entity !== "rust-deer") return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.4, { yaw: 0, pitch: -3 });
    });

    /* 19:30: the wind changes (ClockSystem's mark). If they are still there it puts their heads up for her. */
    ctx.onMark("wind-turns", () => {
      ctx.fx("gust", 0.6); ctx.sfx("cloth", -0.3, 0.5); ctx.kick("turn", 0.4, { yaw: -1, pitch: 0 });
      if (!herdGone()) ctx.setFlag(ALERT, true);
    });
    /* 20:15: the sun goes behind Sassolungo and everything drops three decibels. No words for it. */
    ctx.onMark("sunset", () => { ctx.sfx("exhale", 0, 0.5); ctx.kick("settle", 0.35); });

    /* Walking on. If they are still standing there, walking on is how she startles them — one second, a crash
       of sound, and nothing (v4 §7). Without a confirmed mark the trail into the trees takes twelve minutes to find. */
    /* Once they have turned to track her, the next thing she does with her hands is what breaks it — not a clock.
       Registered last so the action's own line lands first and the crash of hooves comes over the top of it. */
    ctx.on("interact:done", ({ entity }) => {
      if (entity === "treeline" || !ctx.flag(WATCH, false) || herdGone()) return;
      ctx.after(450, () => bolt("skirt"));
    });

    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "deer") return;
      ctx.setFlag(SEEN, true);              // every way out of this node is a way of having seen them (§6, §8)
      const startled = !herdGone();
      if (startled) bolt("through");
      if (to !== "forestEdge" || ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: LOST_MINUTES }, "没认记号，在林子边上找路");
      ctx.kick("turn", 0.5);
      if (!startled) ctx.say("走错了一小段。", { tag: "deer-lost", priority: 1 });
    });
  },
});
