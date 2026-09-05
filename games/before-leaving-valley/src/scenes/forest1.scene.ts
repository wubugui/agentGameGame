/* The forest path, upper section, 20:45 — dark. The lamp is in her teeth and both hands are on the ground
   (SOURCE_TRANSCRIPT day 1 §11). Four pulls: at each one the beam finds two or three things to take hold of —
   a root, a stone, and on the right bank one fallen log that is the fastest thing here and the first thing to
   move under a body that has been climbing for ten hours. Fear is paid per hold and can be shouted or growled
   back down; growling takes the hand. On a trunk between the boulders there is a 656 blaze, and beside the two
   trunks on the left there is a gap that looks like a way through — from in there the road cannot be heard.
   Every coordinate was read off the 150°×84° grid of 14-forest-1 (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import type { Ambience } from "../soundscape";
import type { Condition } from "../engine/condition";
import { all, entityIs, flag, not } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import type { Cost, Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, wrongWay } from "./_shared";

const STEP = "forest1.step", CERTAIN = "forest1.certain";
const GAP = "forest1.gap", ROLLED = "forest1.rolled", HEARD = "forest1.heard", CANOPY = "forest1.canopy";
const BITING = "forest1.biting";       // the lamp is out of her teeth: for that second the hands cannot climb (v4 §3.4)
const TOTAL = 4;
const ROAD_ENGINE = 0.12;              // the pass road, a long way under the trees: present, and easy to miss

/* The four pulls, bottom of the frame first. Roots and stones both painted; the log only exists on the right bank. */
const ROOTS: Transform[] = [
  { yaw: -1.5, pitch: -28, distance: 8 },    // the root arch across the trail at her feet (627, 600)
  { yaw: 28, pitch: -16.5, distance: 11 },   // the root mat over the right bank (879, 501)
  { yaw: 0, pitch: -10, distance: 12 },      // the mossy root ridge right of the trail (640, 446)
  { yaw: -22, pitch: -26.5, distance: 9 },   // the roots at the foot of the left mossy bank (452, 587)
];
const ROCKS: Transform[] = [
  { yaw: -13, pitch: -32, distance: 8 },     // the pale flat stones at the left edge of the near trail (529, 634)
  { yaw: 13, pitch: -12, distance: 11 },     // the mossy rocks right of the trail (751, 463)
  { yaw: -11, pitch: -7, distance: 12 },     // the shoulder of the white boulder (546, 420)
  { yaw: -32, pitch: -16, distance: 10 },    // the big mossy boulder left of the trail (367, 497)
];
const DEADFALL: Transform = { yaw: 34.5, pitch: -7, distance: 11 };   // the thin fallen log lying across the right bank (934, 420)
/* The slender spruce between the two boulders. Measured on the plain plate: at y = 326 the bark runs x 628→641,
   so the mark sits on its centre line (635) and the sprite is cut to 2.8 vh = 1.85° ≈ 16 px wide, inside the bark. */
const TRUNK_MARK: Transform = { yaw: -0.6, pitch: 4, distance: 13 };  // the trunk between the two boulders (635, 326)
const BOULDER_MARK: Transform = { yaw: 14, pitch: 3.5, distance: 14 };// the lit face of the big leaning boulder (760, 330)
const LEFT_TRUNK: Transform = { yaw: -39.5, pitch: -6.4, distance: 12 }; // the near trunk of the left pair (303, 415)
const TREE_GAP: Transform = { yaw: -47.5, pitch: -14.5, distance: 14 }; // the dark between the two left trunks (235, 484)
const CANOPY_SKY: Transform = { yaw: -20, pitch: 33, distance: 40 };  // the last blue between the crowns (469, 77)
const TRAIL_ON: Transform = { yaw: -20, pitch: -16.3, distance: 12 }; // where the trail runs out past the white boulder (469, 500)
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };                  // story actions: E-key prompts, never drawn on the painting

const HOLDING_LAMP: Condition = { kind: "held", item: "fillLight" };
const onTrail = flag(STEP, { lt: TOTAL });
const handsFree = all(onTrail, not(flag(BITING)));      // during the bite change the hand goes out and comes back
const atStep = (n: number): Condition => n === 0 ? flag(STEP, { lt: 1 }) : all(flag(STEP, { gte: n }), flag(STEP, { lt: n + 1 }));
const stepOf = (w: World) => Math.max(0, Math.min(TOTAL - 1, w.flag<number>(STEP, 0)));

/* Fast on the hands, slow and safe, or fastest of all and the only one that can move. */
const COST: Record<"root" | "rock" | "log", Cost> = {
  root: { minutes: 5, fatigue: 0.06, fear: 0.16 },
  rock: { minutes: 8, fatigue: 0.02, fear: 0.16 },
  log: { minutes: 4, fatigue: 0.08, fear: 0.16 },
};
const FALSE_LINES: Record<string, string> = { "moss-mark": "地衣。不是漆。", "old-arrow": "旧箭头。别的路线。" };

const pull = (entity: string, wait: number): WalkStep[] => [{ type: "hold:start", entity }, { wait }, { type: "hold:end" }, { wait: 260 }];

export default defineScene({
  id: "forest1",
  day: 1, place: "森林小路 · 上段", elevation: "1,900 m",
  painting: "pano/14-forest-1.webp",
  body: "crawl", material: "soft",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: ROAD_ENGINE, heater: 0 },
  weather: { motes: "night", windPan: -0.3 },
  arriveAt: 20 * 60 + 45,
  fallback: "灯咬在嘴里。手和脚都在地上。",
  // v4 §8: forestStep1 到底. The blaze is never a lock (D6) — it only buys back the twenty minutes and the heart.
  exitWhen: flag(STEP, { gte: TOTAL }),
  entities: [
    // The root at this pull: fast, all hands. Its place changes with every step; that is why it is a sprite.
    { id: "hold-root", transform: (w) => ROOTS[stepOf(w)], className: "hold-hotspot",
      sprite: { src: "sprites/root-arch-night.webp", layer: "prop", sizeVh: 9 },
      interactable: { verbs: ["hold"], label: "树根", reveal: 14, requires: handsFree },
      hold: { ms: 850, scaleWith: ["fear", "fatigue", "lamp"] }, visible: onTrail },
    // The stone at this pull: three minutes more, and it costs the hands almost nothing.
    { id: "hold-rock", transform: (w) => ROCKS[stepOf(w)], className: "foot-hotspot",
      sprite: { src: "sprites/rock-step-night.webp", layer: "prop", sizeVh: 9 },
      interactable: { verbs: ["hold"], label: "石头", reveal: 14, requires: handsFree },
      hold: { ms: 1150, scaleWith: ["fear", "fatigue", "lamp"] }, visible: onTrail },
    // The one log, on the right bank, at the second pull only. The quickest way past — until the arms are gone.
    { id: "deadfall", transform: DEADFALL, className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "倒木", reveal: 14, requires: all(atStep(1), not(flag(ROLLED)), not(flag(BITING))) },
      hold: { ms: 700, scaleWith: ["fear", "fatigue", "lamp"] }, visible: all(atStep(1), not(flag(ROLLED))) },
    // Three candidate marks, all labelled the same: 656 on the trunk between the boulders, lichen on the leaning
    // boulder, and another route's old arrow on the near trunk of the left pair — right beside the gap.
    // The real one stays on the bark after it is confirmed — dimmed, and no longer worth a second minute (v4 §3.5).
    blaze("blaze-656", TRUNK_MARK, true, {
      sprite: { src: "sprites/blaze-656.webp", layer: "prop", sizeVh: 2.8,
        swap: [{ when: entityIs("blaze-656", "read"), src: "sprites/blaze-656.webp", className: "blaze-dim" }] },
      interactable: { verbs: ["inspect"], label: "树干上的记号", reveal: 12, cost: { minutes: 1 }, requires: not(entityIs("blaze-656", "read")) },
      visible: undefined,   // drops _shared.blaze's "gone once read": this mark is the trace that the segment was checked
    }),
    blaze("moss-mark", BOULDER_MARK, false, {
      sprite: { src: "sprites/blaze-false.webp", layer: "prop", sizeVh: 4 },
      interactable: { verbs: ["inspect"], label: "石头上的记号", reveal: 12, cost: { minutes: 1 } },
    }),
    blaze("old-arrow", LEFT_TRUNK, false, {
      sprite: { src: "sprites/blaze-arrow-old-night.webp", layer: "prop", sizeVh: 4 },
      interactable: { verbs: ["inspect"], label: "树干上的记号", reveal: 12, cost: { minutes: 1 } },
    }),
    // The gap between the two trunks on the left. Twenty-five minutes in and back out; in there the road is gone.
    wrongWay("tree-gap", TREE_GAP, "左边两棵树之间的缝", 25, "那里听不见公路。"),
    // The last blue between the crowns. Nothing to click: she looks up, and for a moment the wood has a top.
    { id: "canopy", transform: CANOPY_SKY, gaze: { radius: 13, dwell: 1000 } },
    // Wide (everything, dimly) or narrow (one thing, and nothing else). It costs the hands a beat, and half a
    // clock minute — which ClockSystem rounds up to a whole one until the sub-minute accumulator lands (engine request).
    { id: "lamp-bite", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["use"], label: "换一种咬法", reveal: 24, cost: { minutes: 0.5 }, requires: not(flag(BITING)) },
      visible: HOLDING_LAMP },
    goArrow("go", TRAIL_ON, { to: "forest2", minutes: 30, label: "白石头左边的小路", kind: "walk" }),
  ],
  seed: (w) => {
    w.setFlag(STEP, TOTAL);
    w.setFlag(CERTAIN, true);
    w.setFlag(HEARD, true);
    w.setFlag(GAP, false); w.setFlag(ROLLED, false); w.setFlag(CANOPY, false);
    for (let i = 0; i < TOTAL; i += 1) w.setFlag(`forest1.style.${i}`, i === 1 ? "log" : "root");
  },
  script: (ctx) => {
    const w = ctx.world;
    const step = () => w.flag<number>(STEP, 0);
    /* The scene's own ambience layer: last light takes the wind down, the wrong gap takes the road away. */
    let amb: Partial<Ambience> = {};
    const setAmb = (next: Partial<Ambience>) => { amb = { ...amb, ...next }; w.emit("ambience", { overrides: amb }); };
    const pulseAmb = (next: Partial<Ambience>, ms: number) => {
      w.emit("ambience", { overrides: { ...amb, ...next } });
      ctx.after(ms, () => w.emit("ambience", { overrides: amb }));
    };

    /* One pull. The log is the only hold that can answer back: on arms that are already gone it rolls, and then
       it is not there any more. Nothing else in this scene can take a step away from her. */
    const advance = (style: "root" | "rock" | "log") => {
      const here = step();
      if (here >= TOTAL) return;
      if (style === "log" && w.state.body.fatigue >= 0.55 && w.rt.rng() < 0.34) {
        ctx.setFlag(ROLLED, true);
        w.emit("body:slip", { entity: "deadfall", severity: 1 });
        ctx.spend({ minutes: 4, fear: 0.12 }, "倒木滚了");
        ctx.sfx("slide", 0.55, 1.1); ctx.sfx("thud", 0.5, 0.8);
        ctx.kick("slip", 1.3, { yaw: 5, pitch: -11 });
        ctx.say("木头在动。", { tag: "forest1-roll", priority: 1 });
        return;
      }
      ctx.spend(COST[style], `forest1:${style}`);
      const next = here + 1;
      ctx.setFlag(STEP, next);
      ctx.setFlag(`forest1.style.${here}`, style);
      ctx.sfx("grip", 0, style === "rock" ? 0.65 : 1);
      ctx.sfx("step", 0, 0.55);
      ctx.kick("pull", style === "rock" ? 0.8 : 1.2);
      ctx.hand(ctx.transformOf(style === "rock" ? "hold-rock" : "hold-root"), "grip", true);
      if (next >= TOTAL) {
        w.emit("body:rest", { seconds: 4 });
        ctx.sfx("exhale", 0, 0.8); ctx.kick("settle", 1.1);
        ctx.say("还在往下。", { tag: "forest1-bottom" });
      }
    };
    ctx.onHold("hold-root", () => advance("root"));
    ctx.onHold("hold-rock", () => advance("rock"));
    ctx.onHold("deadfall", () => advance("log"));

    /* Letting go: five seconds of breath, a little more heart, and the same hold still there. Never a fall. */
    const slip = (progress: number) => {
      if (progress < 0.15) return;
      // Letting go on purpose is not losing the hold: growling takes the hand (v4 §3.3), and so does changing the
      // bite. CameraBodySystem charges every hold:release +0.08 fear from the engine side, so give that one back
      // here until the engine can tell a chosen release from a lost one (engine request).
      if (w.rt.growling || ctx.flag(BITING, false)) { ctx.spend({ fear: -0.08 }, "自己松的手"); return; }
      ctx.spend({ fear: 0.08 }, "手松了");
      w.emit("body:rest", { seconds: 5 });
      ctx.kick("slip", 0.8, { yaw: 0, pitch: -8 });
      ctx.sfx("slide", 0, 0.7); ctx.sfx("breath", 0, 0.9);
      ctx.say("手松了。再来。", { tag: "forest1-slip", priority: 1 });
    };
    ctx.onRelease("hold-root", slip);
    ctx.onRelease("hold-rock", slip);
    ctx.onRelease("deadfall", slip);

    /* The marks. The journal settles the real one (the hand, the cloth, the heart); a false one gets a word. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.6); ctx.sfx("step", 0, 0.5); return; }
      const line = FALSE_LINES[entity];
      if (!line) return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
      ctx.say(line, { tag: `forest1-${entity}` });
    });

    /* The gap between the trunks. She goes in, and the one sound that was telling her where down is stops. */
    ctx.onInteract("tree-gap", () => {
      ctx.setFlag(GAP, true);
      ctx.spend({ fear: 0.12 }, "走错树缝");
      ctx.kick("step", 0.9); ctx.sfx("step", -0.6, 0.9); ctx.fx("dust", 0.25);
      pulseAmb({ engine: 0, crickets: 0.12, wind: 0.1 }, 950);
      ctx.after(980, () => { ctx.kick("turn", 0.7); ctx.sfx("step", -0.25, 0.7); });
    });

    /* Looking up. The wood has a top, and for a breath the dark has an edge. */
    ctx.onGaze("canopy", () => {
      if (ctx.flag(CANOPY, false)) return;
      ctx.setFlag(CANOPY, true);
      ctx.spend({ fear: -0.05 }, "抬头");
      ctx.kick("glance", 0.5, { yaw: 0, pitch: 6 });
      ctx.fx("gust", 0.4); ctx.sfx("cloth", 0, 0.35);
    });

    /* Changing the bite: wide for everything at once and dim, narrow for one thing and nothing else.
       The lamp is out of her teeth while she does it, so for that beat the hands cannot take a hold (v4 §3.4). */
    ctx.onInteract("lamp-bite", () => {
      const mode = w.state.power.lampMode === "narrow" ? "wide" : "narrow";
      w.dispatch({ type: "lamp:mode", mode });
      ctx.setFlag(BITING, true);
      if (w.rt.hold) w.dispatch({ type: "hold:end" });
      ctx.fx("flashlight", mode === "narrow" ? 1 : 0.6);
      ctx.sfx("cloth", 0, 0.5); ctx.kick("glance", 0.35, { yaw: 0, pitch: -3 });
      ctx.after(900, () => { ctx.setFlag(BITING, false); ctx.sfx("cloth", 0, 0.3); });
    });
    ctx.onEnter(() => ctx.setFlag(BITING, false));

    /* A shout comes back off the trunks twice. UISystem owns the shout itself; the wood owns the echo. */
    ctx.on("fx", ({ name }) => {
      if (name !== "shout") return;
      ctx.after(360, () => ctx.sfx("breath", -0.65, 0.5));
      ctx.after(720, () => ctx.sfx("breath", 0.6, 0.26));
    });

    /* DORMANT until the engine can measure stillness in a crawl scene. body: "crawl" keeps GAIT wobbling the reported
       gaze ~0.13°/frame, world.tick's rt.gazeMoved threshold is 0.05°, so rt.stillFor never reaches 4 s and no
       input:wait is ever dispatched here (measured: 20 s of an untouched pointer, 831/831 frames moved). The branch
       stays wired so it works the day the engine request lands; nothing in the scene's claims depends on it, and the
       road under the trees is carried by the ambience alone — no line names it. */
    let waits = 0;
    ctx.onWait(() => {
      if (w.state.ui.travel || step() >= TOTAL) return;
      waits += 1;
      ctx.spend({ fear: 0.05 }, "光束停住了");
      if (waits < 2 || ctx.flag(HEARD, false)) return;
      ctx.setFlag(HEARD, true);
      pulseAmb({ engine: 0.34 }, 1000);
      ctx.kick("glance", 0.5, { yaw: -7, pitch: -5 });
      ctx.sfx("breath", -0.5, 0.4);
    });

    /* 21:05. The last of it goes out of the sky and the wood drops a few decibels; only the beam is left. */
    ctx.onMark("last-light", () => {
      setAmb({ wind: 0.16, crickets: 0.34 });
      ctx.spend({ fear: 0.06 }, "最后一点光没了");
      ctx.kick("settle", 0.55); ctx.sfx("exhale", 0, 0.5);
    });

    /* Leaving without a confirmed mark: twenty minutes of looking for the trail in the dark (v4 §3.5). */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "forest1" || to !== "forest2" || ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: 20, fear: 0.1 }, "没认记号，找了一段路");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "forest1-lost", priority: 1 });
    });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 320 },
    ...pull("hold-root", 2600),
    ...pull("deadfall", 2600),
    ...pull("hold-root", 3000),
    ...pull("hold-root", 3200),
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Into the gap between the left trunks first: twenty-five minutes, and the road goes quiet while she is in there.
    wrong: [
      { type: "interact", entity: "tree-gap", verb: "inspect" }, { wait: 1500 },
      { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 320 },
      ...pull("hold-root", 2800), ...pull("deadfall", 2800), ...pull("hold-root", 3200), ...pull("hold-root", 3400),
      { type: "travel", entity: "go" },
    ],
    // Every stone, no mark: eight minutes a pull and twenty more on the way out, with the hands almost intact.
    blind: [
      ...pull("hold-rock", 3000), ...pull("hold-rock", 3200), ...pull("hold-rock", 3400), ...pull("hold-rock", 3600),
      { type: "travel", entity: "go" },
    ],
    // Everything the dark offers: both false marks, the real one, a shout, the narrow bite, mixed holds.
    thorough: [
      { type: "interact", entity: "moss-mark", verb: "inspect" }, { wait: 320 },
      { type: "interact", entity: "old-arrow", verb: "inspect" }, { wait: 320 },
      { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 320 },
      { type: "shout" }, { wait: 600 },
      ...pull("hold-rock", 3000),
      { type: "interact", entity: "lamp-bite", verb: "use" }, { wait: 400 },
      ...pull("deadfall", 2800),
      { type: "shout" }, { wait: 600 },
      ...pull("hold-root", 3000), ...pull("hold-rock", 3400),
      { type: "travel", entity: "go" },
    ],
  },
});
