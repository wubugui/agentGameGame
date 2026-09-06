/* The forest path, upper section, 20:45 — dark. The lamp is in her teeth and both hands are on the ground
   (SOURCE_TRANSCRIPT day 1 §11). Four pulls: at each one the beam finds two or three things to take hold of —
   a root, a stone, and on the right bank one fallen log that is the fastest thing here and the first thing to
   move under a body that has been climbing for ten hours. Fear is paid per hold and can be shouted or growled
   back down; growling takes the hand. On a trunk between the boulders there is a 656 blaze, and beside the two
   trunks on the left there is a gap that looks like a way through — from in there the road cannot be heard.
   Every coordinate was read off the 150°×84° grid of 14-forest-1 (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it.
   Sprites: the night set is on disk now and every anchor here uses it — root-arch-night / rock-step-night for the two
   holds, and for the three candidate marks the tall bark strips (blaze-656-dim, blaze-lichen-night,
   blaze-arrow-old-night) that replace the daylight cobbles this scene used to hang on tree trunks. Two things come
   right at once: a mark labelled 树干上的记号 draws bark instead of a boulder (§0.5), and all three read as the same
   dark smear until she is on top of them, because none of them is a bright daylight file any more. The one that
   turns legible is the one she has confirmed — blaze-656 swaps to the lit 656 strip on `read` (§3.5's trace, done
   with the src, which reaches the DOM through Hotspot's <img>, and not with a class, which does not). */
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
/* The first pair is off the bottom-centre of the frame on purpose: `Actions.tsx` pins the engine's own 喊一声 into
   `.story-action` (pano.css:127, left:50% / bottom:9.5vh), a box that sits over roughly yaw −8…0 / pitch −26…−30 in
   this scene's crawling camera and over the hotspot layer. A hold under it gets a shout (fear −0.40, four-second
   cooldown) instead of a hand. Both first-step anchors are now clear of that column by more than a ring's width. */
const ROOTS: Transform[] = [
  { yaw: 10.5, pitch: -28.5, distance: 8 },  // the root lying across the right half of the trail at her feet (730, 604)
  { yaw: 28, pitch: -16.5, distance: 11 },   // the root mat over the right bank (879, 501)
  { yaw: 0, pitch: -10, distance: 12 },      // the mossy root ridge right of the trail (640, 446)
  { yaw: -22, pitch: -26.5, distance: 9 },   // the roots at the foot of the left mossy bank (452, 587)
];
const ROCKS: Transform[] = [
  { yaw: -23.4, pitch: -23.9, distance: 8 }, // the mossy dome of stone at the left edge of the trail (440, 565)
  { yaw: 13, pitch: -12, distance: 11 },     // the mossy rocks right of the trail (751, 463)
  { yaw: -11, pitch: -7, distance: 12 },     // the shoulder of the white boulder (546, 420)
  { yaw: -32, pitch: -16, distance: 10 },    // the big mossy boulder left of the trail (367, 497)
];
const DEADFALL: Transform = { yaw: 34.5, pitch: -7, distance: 11 };   // the thin fallen log lying across the right bank (934, 420)
/* The slender spruce between the two boulders. Measured on the plain plate at y = 326: the bark runs x 628→645, i.e.
   17 plate px ≈ 2.0° ≈ 28 screen px wide (the plate is 8.53 px per degree; the screen 14.2 in yaw, 12 in pitch).
   All three mark files are bark strips about 0.33 as wide as they are tall, so MARK_VH 8 draws them 58 px tall and
   19 px across — narrower than the trunk they are painted on, with the paint band itself about 19 x 18 px.
   All three carry the same MARK_VH: at that size, in that light, nothing but walking up to one tells them apart. */
const MARK_VH = 8;                                                    // all three candidate marks, identical on screen (v4 §3.5)
const TRUNK_MARK: Transform = { yaw: -0.6, pitch: 4, distance: 13 };  // the trunk between the two boulders (635, 326)
const BOULDER_MARK: Transform = { yaw: 14, pitch: 3.5, distance: 14 };// the lit face of the big leaning boulder (760, 330)
const LEFT_TRUNK: Transform = { yaw: -39.5, pitch: -6.4, distance: 12 }; // the near trunk of the left pair (303, 415)
const TREE_GAP: Transform = { yaw: -47.5, pitch: -14.5, distance: 14 }; // the dark between the two left trunks (235, 484)
const CANOPY_SKY: Transform = { yaw: -20, pitch: 33, distance: 40 };  // the last blue between the crowns (469, 77)
const TRAIL_ON: Transform = { yaw: -20, pitch: -16.3, distance: 12 }; // where the trail runs out past the white boulder (469, 500)

/* What the beam is worth. `revealRadius` = max(11, base × (0.55 + 0.45·light) × (1 − fatigue·0.35) × lampFactor);
   at night light = 0 and she arrives here at fatigue ≥ 0.9, so a hold only clears the 11° floor on wide
   (1.15) if base ≥ 11 / (0.55 × 0.65 × 1.15) = 26.8. At 34: wide ≈ 14.0°, narrow (0.5) lands on the floor at 11°.
   That is the whole point of the bite — wide sees the two or three things at once, narrow sees one. */
const HOLD_REVEAL = 34;
const onTrail = flag(STEP, { lt: TOTAL });
const handsFree = all(onTrail, not(flag(BITING)));      // during the bite change the hand goes out and comes back
const atStep = (n: number): Condition => n === 0 ? flag(STEP, { lt: 1 }) : all(flag(STEP, { gte: n }), flag(STEP, { lt: n + 1 }));
const stepOf = (w: World) => Math.max(0, Math.min(TOTAL - 1, w.flag<number>(STEP, 0)));

/* Fast on the hands, slow and safe, or fastest of all and the only one that can move. The minutes below are the wide
   beam's: everything is lit and nothing is bright, so each hold takes a beat of looking. Narrow gives that minute back
   (v4 §3.4: 窄光……瞬间显形) and takes it out of her heart instead (fear ×1.4). Neither bite dominates. */
const COST: Record<"root" | "rock" | "log", Cost> = {
  root: { minutes: 5, fatigue: 0.06, fear: 0.16 },
  rock: { minutes: 8, fatigue: 0.02, fear: 0.16 },
  log: { minutes: 4, fatigue: 0.08, fear: 0.16 },
};
/* Walkthrough holds. `wait` has to cover the worst case the replay can arrive in — fear 1, fatigue 1 multiply the
   hold by 2.5 — so every number below is at least `hold.ms × 2.5 + 300` (root 850 → 2425, rock 1150 → 3175,
   deadfall 700 → 2050). Waiting longer than that is free: the hold completes on its own and hold:end is a no-op. */
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
      interactable: { verbs: ["hold"], label: "树根", reveal: HOLD_REVEAL, requires: handsFree },
      hold: { ms: 850, scaleWith: ["fear", "fatigue", "lamp"] }, visible: onTrail },
    // The stone at this pull: three minutes more, and it costs the hands almost nothing.
    { id: "hold-rock", transform: (w) => ROCKS[stepOf(w)], className: "foot-hotspot",
      sprite: { src: "sprites/rock-step-night.webp", layer: "prop", sizeVh: 9 },
      interactable: { verbs: ["hold"], label: "石头", reveal: HOLD_REVEAL, requires: handsFree },
      hold: { ms: 1150, scaleWith: ["fear", "fatigue", "lamp"] }, visible: onTrail },
    // The one log, on the right bank, at the second pull only. The quickest way past — until the arms are gone.
    { id: "deadfall", transform: DEADFALL, className: "climb-hotspot",
      interactable: { verbs: ["hold"], label: "倒木", reveal: HOLD_REVEAL, requires: all(atStep(1), not(flag(ROLLED)), not(flag(BITING))) },
      hold: { ms: 700, scaleWith: ["fear", "fatigue", "lamp"] }, visible: all(atStep(1), not(flag(ROLLED))) },
    /* Three candidate marks, all the same size and all labelled the same: 656 on the trunk between the boulders,
       lichen on the leaning boulder, and another route's old arrow on the near trunk of the left pair — right beside
       the gap. All three behave alike, and all three stay on the picture after they have been settled (v4 §3.5 wants
       a trace, not a disappearance). What a settled mark must not become is a live-looking dead button: `enabled`
       false only adds `.is-disabled`, which no stylesheet in this project defines, and `Hotspot.act()` then returns
       before dispatching — a full-brightness ring that answers nothing. `requires` instead: InteractionSystem sends
       the hand out and back with a glance and a tock, and charges nothing (see requests.css for the dim rule and
       docs/ART_QUEUE.md for the dimmed paint). The decoys carry no `cost`: JournalSystem already bills the one
       minute for reading a mark wrong, and §3.5 charges it exactly once. */
    blaze("blaze-656", TRUNK_MARK, true, {
      sprite: { src: "sprites/blaze-656-dim.webp", layer: "prop", sizeVh: MARK_VH,
        swap: [{ when: entityIs("blaze-656", "read"), src: "sprites/blaze-656.webp" }] },
      interactable: { verbs: ["inspect"], label: "树干上的记号", reveal: 12, cost: { minutes: 1 },
        requires: not(entityIs("blaze-656", "read")) },
      visible: undefined,   // drops _shared.blaze's "gone once read": this mark is the trace that the segment was checked
    }),
    blaze("moss-mark", BOULDER_MARK, false, {
      sprite: { src: "sprites/blaze-lichen-night.webp", layer: "prop", sizeVh: MARK_VH },
      interactable: { verbs: ["inspect"], label: "石头上的记号", reveal: 12,
        requires: not(entityIs("moss-mark", "read")) },
      visible: undefined,
    }),
    blaze("old-arrow", LEFT_TRUNK, false, {
      sprite: { src: "sprites/blaze-arrow-old-night.webp", layer: "prop", sizeVh: MARK_VH },
      interactable: { verbs: ["inspect"], label: "树干上的记号", reveal: 12,
        requires: not(entityIs("old-arrow", "read")) },
      visible: undefined,
    }),
    // The gap between the two trunks on the left. Twenty-five minutes in and back out; in there the road is gone.
    // It leaves the painting once she has been in there: `once` alone would leave a hotspot that refuses silently.
    wrongWay("tree-gap", TREE_GAP, "左边两棵树之间的缝", 25, "那里听不见公路。", { visible: not(flag(GAP)) }),
    // The last blue between the crowns. Nothing to click: she looks up, and for a moment the wood has a top.
    { id: "canopy", transform: CANOPY_SKY, gaze: { radius: 13, dwell: 1000 } },
    /* 换咬法 has no entity here. It lives on the lamp in the pack (PackCloth's 宽光 / 窄光), where nothing on screen
       points at it — the same place forestEdge and forest2 leave it. It used to be a `tags:["action"]` button, but
       `Actions.tsx` renders the engine's own 喊一声 into the same pinned `.story-action` slot in forest1 and forest2
       (hud.css:19 / pano.css:127), so the two labels sat on top of each other and E only ever reached the first.
       The scene still charges the bite: see `ctx.on("lamp:mode")` below. */
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
    const narrow = () => w.state.power.lampMode === "narrow";
    const fearUp = (base: number) => base * (narrow() ? 1.4 : 1);   // narrow: everything around the one lit thing is black
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
      leaveGap();               // the first thing she does after the gap is what puts the road back under the trees
      if (style === "log" && w.state.body.fatigue >= 0.55 && w.rt.rng() < 0.34) {
        ctx.setFlag(ROLLED, true);
        w.emit("body:slip", { entity: "deadfall", severity: 1 });
        ctx.spend({ minutes: 4, fear: fearUp(0.12) }, "倒木滚了");
        ctx.sfx("slide", 0.55, 1.1); ctx.sfx("thud", 0.5, 0.8);
        ctx.kick("slip", 1.3, { yaw: 5, pitch: -11 });
        return;   // the wood moving under her is a sound and a shove, not a sentence (§3.2: past 0.9 she stops talking)
      }
      const base = COST[style];
      ctx.spend({ ...base, minutes: Math.max(1, (base.minutes ?? 0) - (narrow() ? 1 : 0)), fear: fearUp(base.fear ?? 0) }, `forest1:${style}`);
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
      }
    };
    ctx.onHold("hold-root", () => advance("root"));
    ctx.onHold("hold-rock", () => advance("rock"));
    ctx.onHold("deadfall", () => advance("log"));

    /* Letting go: five seconds of breath, a little more heart, and the same hold still there. Never a fall. */
    const slip = (progress: number) => {
      /* Letting go on purpose is not losing the hold: growling takes the hand (v4 §3.3), and so does changing the
         bite (`lamp:mode` below ends the hold unconditionally, which lands inside the first few per cent of it).
         CameraBodySystem charges every release past 5 % +0.08 fear from the engine side, so the refund has to be
         decided before any threshold of ours, or a deliberate release in that window silently costs fear — the
         opposite sign of §3.3. Engine request: let hold:end say whether the hand was taken or lost. */
      if (w.rt.growling || ctx.flag(BITING, false)) {
        if (progress > 0.05) ctx.spend({ fear: -0.08 }, "自己松的手");
        return;
      }
      if (progress < 0.15) return;
      /* §3.3 prices 松手 at +0.08 and the ENGINE already charges exactly that: CameraBodySystem emits body:fear +0.08
         on every hold:release past 5 %. Spending fearUp(0.08) here on top of it charged 0.16 wide and 0.192 narrow —
         measured in the page, fear 0.5 -> 0.660. Only the narrow beam's surcharge belongs to the scene, so only the
         difference is spent: nothing on wide, +0.032 on narrow. */
      const extra = fearUp(0.08) - 0.08;
      if (extra > 0.0001) ctx.spend({ fear: extra }, "手松了（窄光）");
      w.emit("body:rest", { seconds: 5 });
      ctx.kick("slip", 0.8, { yaw: 0, pitch: -8 });
      ctx.sfx("slide", 0, 0.7); ctx.sfx("breath", 0, 0.9);
      // §3.3 names this line; priority 2 is the only way past the adrenaline gate she arrives here behind.
      ctx.say("手松了。再来。", { tag: "forest1-slip", priority: 2 });
    };
    ctx.onRelease("hold-root", slip);
    ctx.onRelease("hold-rock", slip);
    ctx.onRelease("deadfall", slip);

    /* The marks. The journal settles the real one (the hand, the cloth, the heart); a wrong one is a hand that comes
       back and a minute gone (JournalSystem's tock). Ten hours in she is past naming what she just looked at, and
       the adrenaline gate would drop the line anyway — the hand and the clock say it. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.6); ctx.sfx("step", 0, 0.5); return; }
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
    });

    /* The gap between the trunks. She goes in, and the one sound that was telling her where down is stops. */
    /* §8 makes «那里听不见公路声，那个「听不见」就是信息» the whole content of this twenty-five-minute wrong turn, so
       the road going away has to be somewhere she is STANDING, not a blip. Going in sets the ambience and leaves it
       set: no timer brings it back. It comes back when she does something — the next hold, or walking out of the
       node — which is also the moment her body turns round. */
    let beforeGap: Partial<Ambience> | null = null;   // what the wood sounded like before she walked in there
    const leaveGap = () => {
      if (!beforeGap) return;
      amb = beforeGap; beforeGap = null;               // restores 21:05's quieter wind too, if it had already come
      w.emit("ambience", { overrides: amb });
      ctx.kick("turn", 0.7); ctx.sfx("step", -0.25, 0.7);
    };
    ctx.onInteract("tree-gap", () => {
      ctx.setFlag(GAP, true);
      ctx.spend({ fear: 0.12 }, "走错树缝");
      ctx.kick("step", 0.9); ctx.sfx("step", -0.6, 0.9); ctx.fx("dust", 0.25);
      beforeGap = amb;
      setAmb({ engine: 0, crickets: 0.12, wind: 0.1 });
    });

    /* Looking up. The wood has a top, and for a breath the dark has an edge. */
    ctx.onGaze("canopy", () => {
      if (ctx.flag(CANOPY, false)) return;
      ctx.setFlag(CANOPY, true);
      ctx.spend({ fear: -0.05 }, "抬头");
      ctx.kick("glance", 0.5, { yaw: 0, pitch: 6 });
      ctx.fx("gust", 0.4); ctx.sfx("cloth", 0, 0.35);
    });

    /* Changing the bite: wide for everything at once and dim, narrow for one thing and nothing else. It happens on the
       cloth in the pack; what happens here is the price. The lamp is out of her teeth while she does it, so for that
       beat the hands cannot take a hold, and half a clock minute goes (v4 §3.4 — ClockSystem rounds it up to a whole
       one until the sub-minute accumulator lands; engine request). PowerSystem writes `lampMode` on this same event,
       so `last` is what it was before this one. */
    let last = w.state.power.lampMode;
    ctx.on("lamp:mode", ({ mode }) => {
      if (mode === last) return;                        // pressing 宽光 while already wide is not a bite
      last = mode;
      ctx.setFlag(BITING, true);
      if (w.rt.hold) w.dispatch({ type: "hold:end" });
      ctx.spend({ minutes: 0.5 }, "换一种咬法");
      ctx.fx("flashlight", mode === "narrow" ? 1 : 0.6);
      ctx.sfx("cloth", 0, 0.5); ctx.kick("glance", 0.35, { yaw: 0, pitch: -3 });
      ctx.after(900, () => { ctx.setFlag(BITING, false); ctx.sfx("cloth", 0, 0.3); });
    });
    ctx.onEnter(() => { ctx.setFlag(BITING, false); last = w.state.power.lampMode; });

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
      ctx.spend({ fear: fearUp(0.05) }, "光束停住了");
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
      if (from !== "forest1") return;
      leaveGap();
      if (to !== "forest2" || ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: 20, fear: 0.1 }, "没认记号，找了一段路");
      ctx.kick("turn", 0.5);
      // §3.5's own line for leaving without a confirmed mark: priority 2, or the adrenaline gate eats it.
      ctx.say("走错了一小段。", { tag: "forest1-lost", priority: 2 });
    });
  },
  /* The log is the fastest hold here and the only one that can answer back: above fatigue 0.55 it rolls one time in
     three, and that costs four minutes instead of a step. The replay arrives with the hands gone, so every route that
     touches the deadfall carries one spare pull; if the log held, that pull finds `onTrail` false and is refused
     without starting anything (a tock, no hand, no clock). */
  walkthrough: [
    { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 320 },
    ...pull("hold-root", 2600),
    ...pull("deadfall", 2600),
    ...pull("hold-root", 3000),
    ...pull("hold-root", 3200),
    ...pull("hold-root", 3200),
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Into the gap between the left trunks first: twenty-five minutes, and the road goes quiet while she is in there.
    wrong: [
      { type: "interact", entity: "tree-gap", verb: "inspect" }, { wait: 1500 },
      { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 320 },
      ...pull("hold-root", 2800), ...pull("deadfall", 2800), ...pull("hold-root", 3200), ...pull("hold-root", 3400),
      ...pull("hold-root", 3400),
      { type: "travel", entity: "go" },
    ],
    // Every stone, no mark: eight minutes a pull and twenty more on the way out, with the hands almost intact.
    blind: [
      ...pull("hold-rock", 3300), ...pull("hold-rock", 3400), ...pull("hold-rock", 3500), ...pull("hold-rock", 3600),
      { type: "travel", entity: "go" },
    ],
    // Everything the dark offers: both false marks, the real one, a shout, the narrow bite (a minute a hold cheaper,
    // and every hold's fear ×1.4), mixed holds.
    thorough: [
      { type: "interact", entity: "moss-mark", verb: "inspect" }, { wait: 320 },
      { type: "interact", entity: "old-arrow", verb: "inspect" }, { wait: 320 },
      { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 320 },
      { type: "shout" }, { wait: 600 },
      ...pull("hold-rock", 3300),
      { type: "lamp:mode", mode: "narrow" }, { wait: 1200 },
      ...pull("deadfall", 2800),
      { type: "shout" }, { wait: 600 },
      ...pull("hold-root", 3000), ...pull("hold-rock", 3400),
      ...pull("hold-root", 3400),
      { type: "travel", entity: "go" },
    ],
  },
});
