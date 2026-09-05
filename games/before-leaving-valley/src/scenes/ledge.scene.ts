/* The lip of the plateau, 15:45. Six minutes off the line, and the whole rest of the day is lying open in front of
   her: karst ribs run out under her boots and simply stop; below them a huge pale scree fan pours all the way to
   the valley floor with one hair-thin path zigzagging down it; at the fan's foot the spruce closes in, and through
   the trees a length of guardrail on the pass road; further out a few roofs, and on the far rim a small dark house.
   Nothing here changes any event — you come, you look, you go back the way you came. What it changes is whether
   the next forty minutes are readable (v4 §7 "纯粹是看", §8 "死路（值得走的死路）").
   Every coordinate below was read off the 150°×84° grid of 09c-ledge (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { ENTRIES } from "../data/entries";
import { after, flag, has } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { Transform, Verb } from "../engine/types";
import { backArrow, prop, windy, wrongWay } from "./_shared";

const LOOKS = "ledge.looks";        // how many of the four stretches her eye has actually followed
const SEEN = "ledge.seen";          // she stood here and looked at least once (cross-scene name, contract §6)
const TRACED = "ledge.traced";      // fan → path → treeline → road, all four
const SKETCHED = "ledge.sketched";
const LEANED = "ledge.leaned";
const HUT_SEEN = "ledge.hutSeen";
const CLOUD = "ledge.cloud";
const ROAD_HEARD = "ledge.roadHeard";
const DESCENT = "E-descent";        // the notebook line for the way down — still to be added to data/entries.ts
const HUT_LIT = 17 * 60;            // ClockSystem's hut-window-lit mark
const BACK_MINUTES = 6;             // 6 out (plateau's ledge-route) + 6 back = the twelve minutes of v4 §7

/* Things painted in 09c-ledge, with the pixel they were read from. */
const FAN: Transform = { yaw: -16.5, pitch: -8.5, distance: 22 };     // the middle of the great pale scree fan (500, 430)
const PATH: Transform = { yaw: 5.9, pitch: -2.3, distance: 26 };      // the hair-thin zigzag on the fan (690, 380)
const TREELINE: Transform = { yaw: 14, pitch: -17.5, distance: 20 };  // dark spruce at the foot of the fan (760, 510)
const ROAD: Transform = { yaw: 25.5, pitch: -21.7, distance: 18 };    // the guardrail showing between the trunks (858, 546)
const VILLAGE: Transform = { yaw: 25, pitch: 2.2, distance: 40 };     // the roofs far down the valley (855, 341)
/* The skyline of the far shoulder across the valley: the sky/ridge edge sits on row 240 at x 926 (sampled on the plain
   plate), so the house stands on that crest. distance 16 keeps it inside PanoStage's 1:1 band (scale = max(.6, 10/d)
   cancels the wrapper's d/10 exactly at d ≤ 16.7), which makes sizeVh the literal height on screen: 0.9 vh ≈ 6 px on a
   720-high viewport — smaller than the 8–14 px roofs of the village painted much nearer, as a whole valley away should be. */
const HUT: Transform = { yaw: 33.5, pitch: 13.8, distance: 16 };      // on the crest of the far shoulder (926, 242)
const CLOUD_SHADOW: Transform = { yaw: -26, pitch: 0, distance: 30 }; // the dark bands walking down the left slope (420, 360)
const LIP: Transform = { yaw: 2, pitch: -28.5, distance: 7 };         // the nose of the middle rib, where the rock stops (657, 604)
const FLAT: Transform = { yaw: -20, pitch: -28, distance: 8 };        // the broad pale top of the left rib (469, 600)
const BLOCKS: Transform = { yaw: -57, pitch: -14, distance: 14 };     // the boulder field on the left shoulder (154, 480)
const TURF: Transform = { yaw: -51.5, pitch: -30, distance: 8 };      // the grass-and-mud channel between the ribs (201, 620)

/** One of the four stretches of the way down. All of them are just looking; the phone is allowed on each. */
const stretch = (id: string, transform: Transform, label: string, minutes: number, reveal = 13): EntityDef => ({
  id, transform,
  interactable: { verbs: ["inspect", "photograph"] as Verb[], label, reveal, cost: { minutes } },
});

export default defineScene({
  id: "ledge",
  day: 1, place: "高原边缘 · 岩唇", elevation: "2,790 m",
  painting: "pano/09c-ledge.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", clouds: true, gusty: true, windPan: -0.2 },
  arriveAt: 15 * 60 + 45,
  idleLook: true,
  fallback: "下面全看得见。",
  entities: [
    // The four stretches of the descent, in the order the eye takes them. The path is the small one: you have to be close.
    stretch("scree-fan", FAN, "灰白的碎石扇", 1),
    stretch("hair-path", PATH, "碎石上的一条细线", 2, 12),
    stretch("tree-line", TREELINE, "碎石扇脚下的林线", 1),
    stretch("guardrail", ROAD, "林子里露出来的护栏", 1, 12),
    // Further out, and nothing to do with the way down: the roofs, and the one dark house on the far skyline.
    stretch("village", VILLAGE, "谷底的几点屋顶", 1),
    { id: "hut", transform: HUT,
      sprite: { src: "sprites/hut-far.webp", layer: "prop", sizeVh: 0.9, swap: [{ when: after(HUT_LIT), src: "sprites/hut-far-lit.webp" }] },
      interactable: { verbs: ["inspect", "photograph"], label: "对面的小房子", reveal: 12, cost: { minutes: 1 } },
      gaze: { radius: 12, dwell: 900 } },
    // The cloud shadows crossing the slope: no hotspot, no label, only somewhere for her eyes to rest.
    { id: "cloud-shadow", transform: CLOUD_SHADOW, gaze: { radius: 14, dwell: 1200 } },
    // The edge of the rib. Weight forward, hold it, and the drop opens straight down under her boots.
    { id: "lip", transform: LIP, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "岩唇的边", reveal: 14 },
      hold: { ms: 900, scaleWith: ["fatigue"] } },
    // The flat top of the near rib: the third place all day where the notebook comes out (v4 §9 ledge).
    { id: "flat-rock", transform: FLAT, className: "foot-hotspot",
      interactable: { verbs: ["use"], label: "平岩上摊开本子", reveal: 12, cost: { minutes: 1 }, requires: has("notebook") } },
    prop("notebook-open", FLAT, "sprites/notebook-open.webp", 9, { visible: flag(SKETCHED) }),
    // The blocks along the left shoulder look like they carry on. Four minutes to find out they do not.
    wrongWay("blocks", BLOCKS, "左边那堆乱石", 4, "只有石头。没有路。"),
    // The way back over the turf channel, onto the plateau. Always open (A4).
    backArrow("back", TURF, "plateau", "回头", BACK_MINUTES),
  ],
  exitWhen: undefined,
  /* ledge is a side scene: engine/dev.ts's warpTo walks MAIN_ORDER only, so this seed is never run by ?node=.
     Nothing downstream reads ledge.* today; it is kept complete against a future wiring, not relied on. */
  seed: (w) => {
    w.setFlag(LOOKS, 4);
    w.setFlag(SEEN, true);
    w.setFlag(TRACED, true);
    w.setFlag(SKETCHED, true);
    w.setFlag(LEANED, true);
    w.setFlag(HUT_SEEN, true);
    if (ENTRIES[DESCENT]) w.emit("journal:entry", { entry: DESCENT, source: null });
  },
  script: (ctx) => {
    const w = ctx.world;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: clamp((target.yaw - here.yaw) * 0.15, -6, 6), pitch: clamp((target.pitch - here.pitch) * 0.15, -4, 4) });
    };
    const shoot = (target: Transform) => { w.dispatch({ type: "phone:shoot" }); ctx.setFlag("ledge.photo", true); glanceAt(target, 0.35); };

    /* Standing still long enough, a car goes along the pass road far below. It stays audible until she moves again. */
    let roadOn = false;
    const roadIn = () => { roadOn = true; ctx.setFlag(ROAD_HEARD, true); w.emit("ambience", { overrides: { engine: 0.12 } }); };
    const roadOut = () => { if (!roadOn) return; roadOn = false; w.emit("ambience", { overrides: {} }); };

    /* --- The four stretches. Each is a look and a minute; the fourth one joins them up. Framing one in the phone is
           also having followed it: the minute is charged either way, so it has to count either way. --- */
    const follow = (id: string, target: Transform, pan: number) => {
      ctx.onInteract(id, (verb) => {
        roadOut();
        if (verb === "photograph") {
          shoot(target);
        } else {
          glanceAt(target, 0.55);
          ctx.sfx("breath", pan, 0.5);
          w.emit("body:rest", { seconds: 2 });
        }
        const already = ctx.flag(`ledge.followed.${id}`, false);
        if (already) return;
        ctx.setFlag(`ledge.followed.${id}`, true);
        ctx.setFlag(SEEN, true);
        const looks = ctx.flag<number>(LOOKS, 0) + 1;
        ctx.setFlag(LOOKS, looks);
        if (looks < 4 || ctx.flag(TRACED, false)) return;
        ctx.setFlag(TRACED, true);
        ctx.kick("settle", 0.45);
        ctx.sfx("exhale", 0, 0.6);
        ctx.say("从这儿到公路，一条线。", { tag: "ledge-traced" });
      });
    };
    follow("scree-fan", FAN, -0.3);
    follow("hair-path", PATH, 0);
    follow("tree-line", TREELINE, 0.2);
    follow("guardrail", ROAD, 0.45);

    /* --- The roofs, and the house on the far rim. Seeing it here is an hour before hutView asks anything of it. --- */
    ctx.onInteract("village", (verb) => {
      roadOut();
      if (verb === "photograph") return shoot(VILLAGE);
      glanceAt(VILLAGE, 0.5); ctx.sfx("breath", 0.4, 0.45);
      ctx.setFlag("ledge.village", true);
    });
    const findHut = () => {
      if (ctx.flag(HUT_SEEN, false)) return;
      ctx.setFlag(HUT_SEEN, true);
      ctx.setFlag(SEEN, true);
      glanceAt(HUT, 0.5); ctx.sfx("tick", 0.4, 0.45);
      ctx.say("那栋房子。隔着一整个山谷。", { tag: "ledge-hut" });
    };
    ctx.onGaze("hut", findHut);
    ctx.onInteract("hut", (verb) => {
      roadOut();
      if (verb === "photograph") return shoot(HUT);
      findHut();
      glanceAt(HUT, 0.4); ctx.sfx("breath", 0.35, 0.45);
    });
    /* 17:00, for anyone still standing here: the window comes on across the valley. The sprite swaps itself. */
    ctx.onMark("hut-window-lit", () => {
      if (w.state.sceneId !== "ledge" || w.state.ui.travel) return;
      glanceAt(HUT, 0.7); ctx.sfx("breath", 0.35, 0.45);
      ctx.say("窗亮了。", { tag: "ledge-lit", priority: 1 });
      ctx.learn("E-hutLit");
    });

    /* --- The cloud shadows. Her eyes rest on the slope and one of them arrives: the light drops a shade. --- */
    ctx.onGaze("cloud-shadow", () => {
      if (ctx.flag(CLOUD, false)) return;
      ctx.setFlag(CLOUD, true);
      roadOut();
      ctx.fx("gust", 0.5); ctx.kick("turn", 0.55); ctx.sfx("exhale", -0.35, 0.5);
    });

    /* --- The edge. Weight onto the front foot and hold it: grit goes over and takes a long time to land. --- */
    ctx.onHold("lip", () => {
      roadOut();
      ctx.setFlag(LEANED, true);
      ctx.hand(LIP, "grip", true);
      ctx.kick("pull", 0.9, { yaw: 0, pitch: -6 });
      ctx.sfx("grip", 0, 0.7);
      ctx.spend({ minutes: 1, fatigue: 0.02 }, "在岩唇边上探身往下看");
      ctx.after(430, () => { ctx.sfx("slide", 0, 0.35); ctx.fx("dust", 0.3); ctx.kick("settle", 0.5); });
      ctx.say("脚尖前面是空的。", { tag: "ledge-lip" });
    });
    ctx.onRelease("lip", (progress) => {
      if (progress <= 0.25) return;
      ctx.kick("settle", 0.4, { yaw: 0, pitch: 2 });
      ctx.sfx("cloth", 0, 0.5);
    });

    /* --- The notebook on the flat rib. A stone on the corner because it is windy up here; then a line down the page.
           Nothing gets drawn that she has not followed with her eyes first (v4 §6: 世界里读到的，她不复述). --- */
    ctx.onInteract("flat-rock", () => {
      roadOut();
      if (windy(w)) ctx.spend({ minutes: 1 }, "用石头压住本子");   // ClockSystem rounds each spend: a whole minute or none
      ctx.hand(FLAT); glanceAt(FLAT, 0.4);
      w.dispatch({ type: "item:use", item: "notebook" });
      if (!ctx.flag(TRACED, false) || ctx.flag(SKETCHED, false)) return;
      ctx.setFlag(SKETCHED, true);
      ctx.spend({ minutes: 2 }, "在本子上把这条线画下来");
      /* The line only says "本子上多了一条线" when a line really went into the notebook. E-descent is not in
         data/entries.ts yet (it is in the requests): JournalSystem drops ids it does not know, so asking for it would
         warn and write nothing while the corner of the screen claimed otherwise. Until the entry lands the beat is the
         pencil alone — one sound, no second sentence; when it lands the journal's own pencil covers it and the flash
         becomes true. */
      if (ENTRIES[DESCENT]) { ctx.learn(DESCENT); ctx.flash("本子上多了一条线"); }
      else ctx.sfx("pencil", 0, 0.6);
    });

    /* --- The blocks on the left shoulder: she walks out along them, they end on grass, she comes back. --- */
    ctx.onInteract("blocks", () => {
      roadOut();
      ctx.setFlag("ledge.wrong", true);
      ctx.kick("step", 0.8); ctx.sfx("step", -0.5); ctx.fx("dust", 0.3);
      w.emit("body:fatigue", { delta: 0.03, reason: "乱石堆往返" });
      ctx.after(620, () => { ctx.kick("settle", 0.6); ctx.sfx("step", -0.3); });
      ctx.say("只有石头。没有路。", { tag: "ledge-blocks" });
    });
    /* Pressed again once she has been out there: the blocks are still on the shoulder and still take her hand, they
       just have nothing more in them. The hand goes out, one dry knock, and comes back (as meadow, search). */
    ctx.on("interact:refused", ({ entity, reason }) => {
      if (entity !== "blocks" || reason !== "gone") return;
      roadOut();
      ctx.hand(BLOCKS, "grip");
      glanceAt(BLOCKS, 0.3);
      ctx.sfx("tock", Math.max(-1, Math.min(1, BLOCKS.yaw / 60)), 0.3);
    });

    /* --- Standing still. The wind comes up the face once; a while later a car runs along the road down there. --- */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 2 && !ctx.flag("ledge.gust", false)) {
        ctx.setFlag("ledge.gust", true);
        ctx.fx("gust", 0.55); ctx.sfx("breath", -0.4, 0.5); ctx.kick("settle", 0.25);
        return;
      }
      if (stills >= 4 && !roadOn && !ctx.flag(ROAD_HEARD, false)) { roadIn(); ctx.kick("glance", 0.3, { yaw: 4, pitch: -6 }); }
    });
    ctx.on("interact:attempt", roadOut);
    ctx.on("gaze:enter", roadOut);
    ctx.on("phone:open", roadOut);
    /* ledge.seen is the contract's name for "she stood here and looked at least once" — any of it counts, not only the four stretches. */
    ctx.on("interact:done", () => ctx.setFlag(SEEN, true));

    /* --- Arriving off the plateau, and going back onto it. --- */
    ctx.onEnter(() => { ctx.kick("step", 0.6, { yaw: 0, pitch: -3 }); ctx.sfx("step", -0.2, 0.6); ctx.fx("dust", 0.2); });
    ctx.on("travel:begin", ({ from }) => { if (from === "ledge") roadOut(); });

    return () => roadOut();
  },
  /* A dead end: the fastest legal way through it is to look once and step back onto the plateau. */
  walkthrough: [
    { type: "travel", entity: "back" },
  ],
  variants: {
    // Everything the lip has: the four stretches, the roofs, the house, a photograph, the edge, the notebook.
    full: [
      { type: "interact", entity: "scree-fan", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "hair-path", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "tree-line", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "guardrail", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "hut", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "village", verb: "photograph" }, { wait: 300 },
      { type: "hold:start", entity: "lip" }, { wait: 2700 }, { type: "hold:end" }, { wait: 600 },
      { type: "interact", entity: "flat-rock", verb: "use" }, { wait: 500 },
      { type: "overlay:close" }, { wait: 200 },
      { type: "travel", entity: "back" },
    ],
    // Out along the blocks first, then the fan, then back.
    wrong: [
      { type: "interact", entity: "blocks", verb: "inspect" }, { wait: 900 },
      { type: "interact", entity: "blocks", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "scree-fan", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "back" },
    ],
    // Standing still on the lip: the gust, then the road down there.
    still: [
      { type: "wait" }, { wait: 200 }, { type: "wait" }, { wait: 200 },
      { type: "wait" }, { wait: 200 }, { type: "wait" }, { wait: 600 },
      { type: "travel", entity: "back" },
    ],
  },
});
