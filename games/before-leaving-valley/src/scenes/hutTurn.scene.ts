/* Half way to the hut, 16:22. Twenty-two minutes along the rim from the plateau lip, and the karst runs out on a
   table of cracked limestone with somebody's cairn stacked on it. The house on the far rim is nearer — and still on
   the far rim. For the first time the whole valley is open underneath: pale terraces stepping down and down, spruce
   in the shade of them, and on the other side one hair-thin road. The sun has dropped a notch since the lip.
   Nothing here can be gained; the map is spread a ninth time, the numbers are the same numbers, and the only way
   out is the way back (v4 §7 hutView 决策行, §8 hutTurn 行: 再摊一次地图 · 回头箭头 · 死路).
   Every coordinate below was read off the 150°×84° grid of 09d-hutturn (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { after, flag, has, not, entityIs } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { EntityId, Transform } from "../engine/types";
import { backArrow, lookAt, prop, wrongWay } from "./_shared";

const CHOICE = "hutView.choice";      // the decision itself stays locked at the lip (v4 §7)
const SPREAD = "hutTurn.mapSpread";   // cross-scene flag name, contract §6
const CERTAIN = "hutTurn.certain";    // set by JournalSystem when the real mark is confirmed
const DECIDED = "hutTurn.decided";    // what the pencil wrote in the margin here: "hut" | "retreat"
const CAIRN = "hutTurn.cairn";        // one more stone on somebody else's cairn
const VALLEY = "hutTurn.valley";      // the moment the whole valley opened underneath
const WENT_ON = "hutTurn.wentOn";     // she followed the rim a little further and came back

const HUT_LIT = 17 * 60;              // ClockSystem's hut-window-lit mark
const BACK_MINUTES = 23;              // 22 out (hutView's go-hut) + 23 back = the forty-five minutes of v4 §7
const RIM_MINUTES = 9;                // the ledge really does carry on; nine minutes to find that out
const OBJ_RETREAT = "紧急下撤：找 656 · Plan de Roces · Val Lasties";
const OBJ_HUT = "先走一条路去山屋，可以充电、吃饭";   // v4 §5.2 obj-hut, in her own wording

/* Things painted in 09d-hutturn, with the pixel they were read from. */
/* distance 16 keeps the house out of PanoStage's scale clamp, so sizeVh is its real height on screen: 6.5 vh
   ≈ 47 px at 720p, against hutView's 2.2 vh. Twenty-two minutes of walking is a thing you see, not a line. */
const HUT: Transform = { yaw: -31, pitch: 2.6, distance: 16 };        // the green shoulder on the far rim, above the layered cliffs (376, 338)
const VALLEY_FLOOR: Transform = { yaw: -33, pitch: -16, distance: 20 }; // the green valley floor under the far grey wall (358, 497)
const TERRACES: Transform = { yaw: 24, pitch: -14.5, distance: 16 };  // the layered pale cliff face stepping down, spruce in its shade below (845, 484)
const FAR_ROAD: Transform = { yaw: 30.5, pitch: -5.6, distance: 26 }; // the pale ribbon of track on the far side (900, 408)
const MASSIF: Transform = { yaw: 52.7, pitch: 23.3, distance: 40 };   // the big tan wall holding the last direct light (1090, 160)
const CLOUDS: Transform = { yaw: 6.4, pitch: 21, distance: 30 };      // the cloud band coming down over the skyline (695, 180)
const CAIRN_T: Transform = { yaw: -16.1, pitch: -18.9, distance: 9 }; // the stacked flat stones on the table rock (503, 522)
/* The added stone rests ON the painted top stone: that stone's upper edge is at y 458 (pitch −11.6), and a 2.2 vh
   sprite is 11 px tall, so an anchor at −11.3 (y 456) drops its lower edge a few pixels into the stone under it
   instead of leaving it floating above the stack. */
const CAIRN_TOP: Transform = { yaw: -16.1, pitch: -11.3 };            // on top of the painted top stone of the stack (503, 456)
const MAP_STONE: Transform = { yaw: 2.3, pitch: -32, distance: 9 };   // the broad flat slab right of the cairn; the rock face here starts at −28.5 (660, 634)
const BLAZE_ROCK: Transform = { yaw: -31, pitch: -29 };               // the raised pale block left of the cairn (350, 609)
const LICHEN_ROCK: Transform = { yaw: 20, pitch: -35 };               // a paler patch on the slab by her right boot (811, 660)
const RIM_ON: Transform = { yaw: -57.4, pitch: -28.6, distance: 12 }; // where the rock carries on past the break, left (150, 605)
const BACK_SLOPE: Transform = { yaw: 39, pitch: -31, distance: 12 };  // the grass ramp running back the way she came (982, 630)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* A candidate mark, labelled the same as every other one until she is close enough to see it (v4 §3.5).
   The stone stays on the picture after she has settled it and stops answering (`is-disabled`): §3.5 asks a
   confirmed real mark to leave a faint highlight until she leaves the node and a confirmed false one to go grey —
   not for the stone to vanish out of the frame while her hand is still on it. */
const mark = (id: EntityId, transform: Transform, real: boolean): EntityDef => ({
  id, transform, blaze: { real }, className: "blaze-hotspot",
  sprite: { src: real ? "sprites/blaze-red-white.webp" : "sprites/blaze-false.webp", layer: "prop", sizeVh: 4 },
  interactable: { verbs: ["inspect"], label: "石头上的记号", reveal: 12, cost: { minutes: 0 } },
  enabled: not(entityIs(id, "read")),
});

export default defineScene({
  id: "hutTurn",
  day: 1, place: "往山屋的路上 · 岩台", elevation: "2,720 m",
  painting: "pano/09d-hutturn.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", clouds: true, gusty: true, windPan: 0.3 },
  arriveAt: 16 * 60 + 22,
  idleLook: true,
  exitWhen: undefined,
  entities: [
    // The house, nearer by twenty-two minutes and still on the other side: near enough now for the aerial on the
    // roof, and at 17:00 for the one lit window — the sprite changes itself, nobody announces either of them.
    { id: "hut", transform: HUT,
      sprite: { src: "sprites/hut-near.webp", layer: "prop", sizeVh: 6.5, swap: [{ when: after(HUT_LIT), src: "sprites/hut-near-lit.webp" }] },
      interactable: { verbs: ["inspect", "photograph"], label: "对面岩壁上的房子", reveal: 12, cost: { minutes: 1 } },
      gaze: { radius: 12, dwell: 900 } },
    // The thing this walk bought her: the whole valley, open all the way down. It arrives when her eyes rest on it.
    { id: "valley", transform: VALLEY_FLOOR,
      interactable: { verbs: ["inspect", "photograph"], label: "下面的谷地", reveal: 13, cost: { minutes: 1 } },
      gaze: { radius: 14, dwell: 900 } },
    // Things to follow with her eyes across the gap. None of them tells her anything she could not see for herself.
    lookAt("terraces", TERRACES, "一层层的白岩台阶", 1),
    lookAt("far-road", FAR_ROAD, "对岸那条细路", 1),
    lookAt("massif", MASSIF, "还照着太阳的大墙", 1),
    { id: "clouds", transform: CLOUDS, gaze: { radius: 14, dwell: 1200 } },
    // Somebody else's cairn. Two minutes to hold a flat stone on the top of it until it sits — for nothing at all.
    { id: "cairn", transform: CAIRN_T, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "往石堆上加一块石头", reveal: 13, cost: { minutes: 2, fatigue: 0.01 } },
      hold: { ms: 600, scaleWith: ["fatigue"] }, visible: not(flag(CAIRN)) },
    prop("cairn-cap", CAIRN_TOP, "sprites/cairn-stone.webp", 2.2, { visible: flag(CAIRN) }),
    // Two candidates on the rim: the bar on the raised block, and a pale patch on the slab by her right boot.
    mark("blaze-turn-a", BLAZE_ROCK, true),
    mark("blaze-turn-b", LICHEN_ROCK, false),
    // The ninth spreading. Stones on the corners first — up here the paper will not lie still (v4 §3.7).
    prop("paper-map", MAP_STONE, "sprites/map-folded.webp", 11, {
      interactable: { verbs: ["use"], label: "在平石上摊开地图", reveal: 12, cost: { minutes: 0 }, requires: has("paperMap") },
    }),
    // The rock carries on past the break, and so does the way to the hut. Nine minutes to stand in it and turn round.
    wrongWay("rim-on", RIM_ON, "左边接下去的岩台", RIM_MINUTES, "路还在往前。"),
    // The only way out, and it is always open (A4 / D6).
    backArrow("back", BACK_SLOPE, "hutView", "顺草坡回头", BACK_MINUTES),
  ],
  seed: (w) => {
    // Having stood here and walked back is what the seed describes, and coming back is what settles the lip's
    // decision — so the flag downstream reads the same as it does on the fast line (contract §6 invariant).
    w.setFlag(CHOICE, "retreat");
    w.setFlag(SPREAD, 1);
    w.setFlag(CERTAIN, true);
    w.setFlag(DECIDED, "retreat");
    w.setFlag(CAIRN, true);
    w.setFlag(VALLEY, true);
    if (!w.state.journal.entries.includes("E-hutTime")) w.emit("journal:entry", { entry: "E-hutTime", source: null });
    w.patch("journal", { mapLegs: { ...w.state.journal.mapLegs, toHut: 2.5 }, objective: OBJ_RETREAT });
  },
  script: (ctx) => {
    const w = ctx.world;
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: clamp((target.yaw - here.yaw) * 0.15, -6, 6), pitch: clamp((target.pitch - here.pitch) * 0.15, -4, 4) });
    };
    const shoot = (target: Transform) => { w.dispatch({ type: "phone:shoot" }); ctx.setFlag("hutTurn.photo", true); glanceAt(target, 0.35); };
    const write = (text: string) => w.dispatch({ type: "ui:action", id: "map:objective", value: text });

    /* --- The house. Nearer, and no nearer. Looking costs a minute and gets her half a line. --- */
    ctx.onInteract("hut", (verb) => {
      if (verb === "photograph") return shoot(HUT);
      glanceAt(HUT, 0.6); ctx.sfx("breath", -0.4, 0.5);
      ctx.setFlag("hutTurn.looked", true);
      ctx.say(ctx.minute() >= HUT_LIT ? "窗亮着。还是在对面。" : "近了。还是在对面。", { tag: "turn-hut" });
    });
    ctx.onGaze("hut", () => { if (!ctx.flag("hutTurn.hutGaze", false)) { ctx.setFlag("hutTurn.hutGaze", true); glanceAt(HUT, 0.35); ctx.sfx("breath", -0.4, 0.4); } });
    // 17:00, for anyone still out on this rock: the window across the valley comes on and the sprite swaps itself.
    ctx.onMark("hut-window-lit", () => {
      if (w.state.sceneId !== "hutTurn" || w.state.ui.travel) return;
      glanceAt(HUT, 0.7); ctx.sfx("breath", -0.4, 0.45);
      ctx.say("对面亮了一盏灯。", { tag: "turn-lit", priority: 1 });
      ctx.learn("E-hutLit");
    });

    /* --- The valley, all of it, for the first time all day. Her eyes only have to stop on it. --- */
    ctx.onGaze("valley", () => {
      if (ctx.flag(VALLEY, false)) return;
      ctx.setFlag(VALLEY, true);
      ctx.kick("turn", 0.55, { yaw: -3, pitch: -3 }); ctx.fx("gust", 0.5); ctx.sfx("exhale", -0.3, 0.6);
      ctx.say("整条山谷。", { tag: "turn-valley" });
    });
    ctx.onInteract("valley", (verb) => {
      if (verb === "photograph") return shoot(VALLEY_FLOOR);
      glanceAt(VALLEY_FLOOR, 0.6); ctx.sfx("exhale", -0.3, 0.55); w.emit("body:rest", { seconds: 2 });
    });
    ctx.onInteract("terraces", (verb) => {
      if (verb === "photograph") return shoot(TERRACES);
      glanceAt(TERRACES, 0.55); ctx.sfx("breath", 0.3, 0.45); ctx.setFlag("hutTurn.terraces", true);
    });
    ctx.onInteract("far-road", (verb) => {
      if (verb === "photograph") return shoot(FAR_ROAD);
      glanceAt(FAR_ROAD, 0.6); ctx.sfx("breath", 0.5, 0.5); ctx.setFlag("hutTurn.road", true);
      w.emit("body:rest", { seconds: 2 });
    });
    ctx.onInteract("massif", (verb) => {
      if (verb === "photograph") return shoot(MASSIF);
      glanceAt(MASSIF, 0.6); ctx.sfx("exhale", 0.6, 0.5); ctx.setFlag("hutTurn.massif", true);
    });
    ctx.onGaze("clouds", () => {
      if (ctx.flag("hutTurn.cloud", false)) return;
      ctx.setFlag("hutTurn.cloud", true);
      ctx.kick("turn", 0.5, { yaw: 0, pitch: 3 }); ctx.fx("gust", 0.45); ctx.sfx("exhale", 0.2, 0.45);
    });

    /* --- The cairn. A flat stone, held on the top until it stops rocking. Two minutes, and no reward of any kind. --- */
    ctx.onHold("cairn", () => {
      ctx.setFlag(CAIRN, true);
      ctx.hand(CAIRN_TOP); ctx.sfx("clink", -0.2, 0.7); ctx.kick("settle", 0.5);
      ctx.after(320, () => ctx.sfx("tick", -0.2, 0.4));
    });
    ctx.onRelease("cairn", () => { ctx.sfx("tock", -0.2, 0.6); ctx.kick("jolt", 0.35); });

    /* --- The marks. The real one is settled by the journal (hand, cloth, certainty); the other gets a word. --- */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.5); ctx.sfx("step", -0.3, 0.6); return; }
      if (entity !== "blaze-turn-b") return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
      ctx.say("地衣。不是漆。", { tag: "turn-false" });
    });

    /* --- The map, spread on the flat rock. Stones on the corners, then it is the paper's business (v4 §3.7). --- */
    ctx.onInteract("paper-map", () => {
      ctx.bump(SPREAD, 1);
      ctx.spend({ minutes: 0.5 }, "用石头压住地图角");
      ctx.hand(MAP_STONE); glanceAt(MAP_STONE, 0.45);
      w.dispatch({ type: "item:use", item: "paperMap" });
    });
    // A leg goes down under her finger: the pencil is JournalSystem's, her head dipping to the paper is the scene's.
    ctx.on("ui:action", ({ id }) => {
      if (!id.startsWith("map:leg:")) return;
      ctx.kick("glance", 0.25, { yaw: 0, pitch: -2 });
    });

    /* --- The map carries the same two buttons out here that it carries at the lip (PaperMap draws them for both
           nodes), so out here they have to be worth pressing. They are: on this rock the two words are not a
           decision to be filed, they are two directions to start walking in, and pressing one starts the walk.
           紧急下撤 folds the map and turns her round — the twenty-three minutes back along the rim IS the retreat,
           and the decision still lands at the lip, where she has to see the house across the valley to make it
           (v4 §7; hutView clears hutView.choice when she comes back over the grass). 往山屋走 sends her on along
           the ledge, which does not break and does not end. Neither one says anything out loud. --- */
    ctx.onAction("map:choose:retreat", () => {
      ctx.setFlag(DECIDED, "retreat"); ctx.close();
      ctx.sfx("tick", 0, 0.8); ctx.kick("turn", 0.7, { yaw: 6, pitch: -2 });
      write(OBJ_RETREAT);
      ctx.travel("hutView", { minutes: BACK_MINUTES });
    });
    ctx.onAction("map:choose:hut", () => {
      ctx.setFlag(DECIDED, "hut"); ctx.close();
      ctx.sfx("paper", -0.1, 0.7); ctx.kick("turn", 0.6, { yaw: -7, pitch: -2 });
      write(OBJ_HUT); glanceAt(RIM_ON, 0.4);
      // Deciding for the hut out here is walking on: the ledge hotspot spends its own nine minutes the first time,
      // and after that her hand goes out to the same rock and comes back with the margin already rewritten.
      w.dispatch({ type: "interact", entity: "rim-on", verb: "inspect" });
    });

    /* --- Following the rim a little further. It does not break, it does not end; it just goes on being nine
           minutes long, and then nine more. She comes back (v4 §8: 死路). --- */
    ctx.onInteract("rim-on", () => {
      ctx.setFlag(WENT_ON, true);
      ctx.kick("step", 0.8); ctx.sfx("step", -0.5); ctx.fx("dust", 0.3);
      w.emit("body:fatigue", { delta: 0.02, reason: "岩台往前又走了一段" });
      ctx.after(620, () => { ctx.kick("settle", 0.6); ctx.sfx("step", -0.3); });
      ctx.say("路还在往前。", { tag: "turn-on" });
    });

    /* --- Standing still on the rock: the wind turns and comes up out of the valley, once. --- */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills !== 2 || ctx.flag("hutTurn.gust", false)) return;
      ctx.setFlag("hutTurn.gust", true);
      ctx.fx("gust", 0.55); ctx.sfx("breath", -0.5, 0.5); ctx.kick("settle", 0.25);
    });

    /* --- Turning back: one look at the house she is not going to, and the grass ramp. No penalty; only the walk. --- */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "hutTurn" || to !== "hutView") return;
      ctx.setFlag("hutTurn.turned", true);
      glanceAt(HUT, 0.45); ctx.sfx("step", 0.3, 0.6);
    });
  },
  walkthrough: [
    { type: "interact", entity: "paper-map", verb: "use" },
    { wait: 400 },
    { type: "ui:action", id: "map:choose:retreat" },
    { wait: 400 },
    { type: "travel", entity: "back" },
  ],
  variants: {
    // The rim, a little further on, and back. Nine minutes for the knowledge that it really does carry on.
    detour: [
      { type: "interact", entity: "rim-on", verb: "inspect" },
      { wait: 1200 },
      { type: "interact", entity: "paper-map", verb: "use" },
      { wait: 400 },
      { type: "ui:action", id: "map:choose:retreat" },
      { wait: 400 },
      { type: "travel", entity: "back" },
    ],
    // Insisting on the hut: the margin says so, the ledge goes on, and the way out is still the way back.
    wrong: [
      { type: "interact", entity: "paper-map", verb: "use" },
      { wait: 400 },
      { type: "ui:action", id: "map:choose:hut" },
      { wait: 400 },
      { type: "interact", entity: "rim-on", verb: "inspect" },
      { wait: 1200 },
      { type: "travel", entity: "back" },
    ],
    // Everything the rock offers: the house and a photo of it, the valley, the steps, the far road, the wall,
    // both marks, a stone on the cairn, the map and all four legs.
    thorough: [
      { type: "interact", entity: "hut", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "hut", verb: "photograph" }, { wait: 300 },
      { type: "interact", entity: "valley", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "terraces", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "far-road", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "massif", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-turn-b", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "blaze-turn-a", verb: "inspect" }, { wait: 400 },
      // 600 ms of holding, stretched by tired arms: 600 × 2.5 + 300 covers the worst case the engine can hand it.
      { type: "hold:start", entity: "cairn" }, { wait: 1800 }, { type: "hold:end" }, { wait: 400 },
      { type: "interact", entity: "paper-map", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "map:leg:toFork", value: 1 },
      { type: "ui:action", id: "map:leg:toScreeFoot", value: 1.5 },
      { type: "ui:action", id: "map:leg:toForest", value: 0.5 },
      { type: "ui:action", id: "map:leg:toRoad", value: 0.5 }, { wait: 300 },
      { type: "ui:action", id: "map:choose:retreat" }, { wait: 400 },
      { type: "travel", entity: "back" },
    ],
  },
});
