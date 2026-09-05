/* The lip of the plateau, 15:45. Six minutes off the line, and the whole rest of the day is lying open in front of
   her: karst ribs run out under her boots and simply stop; below them a huge pale scree fan pours all the way to
   the valley floor with one hair-thin path zigzagging down it; at the fan's foot the spruce closes in, and through
   the trees a length of guardrail on the pass road; further out a few roofs, and on the far rim a small dark house.
   Nothing here changes any event — you come, you look, you go back the way you came. What it changes is whether
   the next forty minutes are readable (v4 §7 "纯粹是看", §8 "死路（值得走的死路）").
   Every coordinate below was read off the 150°×84° grid of 09c-ledge (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
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
const HUT_LIT = 17 * 60;            // ClockSystem's hut-window-lit mark
const BACK_MINUTES = 6;             // 6 out (plateau's ledge-route) + 6 back = the twelve minutes of v4 §7

/* Things painted in 09c-ledge, with the pixel they were read from. */
const FAN: Transform = { yaw: -16.5, pitch: -8.5, distance: 22 };     // the middle of the great pale scree fan (500, 430)
const PATH: Transform = { yaw: 5.9, pitch: -2.3, distance: 26 };      // the hair-thin zigzag on the fan (690, 380)
const TREELINE: Transform = { yaw: 14, pitch: -17.5, distance: 20 };  // dark spruce at the foot of the fan (760, 510)
const ROAD: Transform = { yaw: 25.5, pitch: -21.7, distance: 18 };    // the guardrail showing between the trunks (858, 546)
const VILLAGE: Transform = { yaw: 25, pitch: 2.2, distance: 40 };     // the roofs far down the valley (855, 341)
const HUT: Transform = { yaw: 33.5, pitch: 11.5, distance: 40 };      // the crest of the far shoulder across the valley (926, 259)
const CLOUD_SHADOW: Transform = { yaw: -26, pitch: 0, distance: 30 }; // the dark bands walking down the left slope (420, 360)
const LIP: Transform = { yaw: 2, pitch: -25.5, distance: 7 };         // where the middle rib stops and it is air (657, 578)
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
    // Further out, and nothing to do with the way down: the roofs, and the one dark house on the far rim.
    stretch("village", VILLAGE, "谷底的几点屋顶", 1),
    { id: "hut", transform: HUT,
      sprite: { src: "sprites/hut-far.webp", layer: "prop", sizeVh: 1.6, swap: [{ when: after(HUT_LIT), src: "sprites/hut-far-lit.webp" }] },
      interactable: { verbs: ["inspect", "photograph"], label: "对面崖边的小房子", reveal: 12, cost: { minutes: 1 } },
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
  seed: (w) => {
    w.setFlag(LOOKS, 4);
    w.setFlag(SEEN, true);
    w.setFlag(TRACED, true);
    w.setFlag(SKETCHED, true);
    w.setFlag(HUT_SEEN, true);
    w.emit("journal:entry", { entry: "E-descent", source: null });
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

    /* --- The four stretches. Each is a look and a minute; the fourth one joins them up. --- */
    const follow = (id: string, target: Transform, pan: number) => {
      ctx.onInteract(id, (verb) => {
        roadOut();
        if (verb === "photograph") return shoot(target);
        glanceAt(target, 0.55);
        ctx.sfx("breath", pan, 0.5);
        w.emit("body:rest", { seconds: 2 });
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
      if (windy(w)) ctx.spend({ minutes: 0.5 }, "用石头压住本子");
      ctx.hand(FLAT); glanceAt(FLAT, 0.4);
      w.dispatch({ type: "item:use", item: "notebook" });
      if (!ctx.flag(TRACED, false) || ctx.flag(SKETCHED, false)) return;
      ctx.setFlag(SKETCHED, true);
      ctx.spend({ minutes: 2 }, "在本子上把这条线画下来");
      ctx.learn("E-descent");
      ctx.flash("本子上多了一条线");
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
      { type: "hold:start", entity: "lip" }, { wait: 2200 }, { type: "hold:end" }, { wait: 600 },
      { type: "interact", entity: "flat-rock", verb: "use" }, { wait: 500 },
      { type: "overlay:close" }, { wait: 200 },
      { type: "travel", entity: "back" },
    ],
    // Out along the blocks first, then the fan, then back.
    wrong: [
      { type: "interact", entity: "blocks", verb: "inspect" }, { wait: 900 },
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
