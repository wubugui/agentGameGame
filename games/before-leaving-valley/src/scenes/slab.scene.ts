/* The smooth terrace right of the crack, 12:20 — the one wrong line on this wall, and the best dead end in the game.
   Half a metre of ledge under her boots, a whole panel of polished limestone in front of her, nothing beyond that.
   No cable here, no pins: the route is over on the far rib, across a vertical cleft — a strand of steel, one anchor
   bolt, and bolted to the rock beside it a small dark box whose lid catches the light. Seeing it costs nothing and
   changes no event; it is only how a lot of people find that letter. The only way out is back down the way she came.
   Every coordinate below was read off the 150°×84° grid of 05b-slab (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { all, any, flag, worn } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import type { Transform } from "../engine/types";
import { backArrow, blaze, lookAt, wrongWay } from "./_shared";

const SEEN = "slab.seenBox", LEANED = "slab.leaned", TOUCHED = "slab.touched";
const HUM = "slab.hum", RIDGE = "slab.ridge", TRIED = "slab.triedClip";

/* Things painted in 05b-slab, with the pixel they were read from. */
const BOLT: Transform = { yaw: -28.5, pitch: -6, distance: 12 };      // the anchor bolt clamped on the far rib (398, 412)
const BOX: Transform = { yaw: -28, pitch: -8.5, distance: 12 };       // bolted to the rib beside it, one box-height down (400, 431)
const SEAM: Transform = { yaw: -12, pitch: -4 };                      // the near lip of the vertical cleft (527, 383)
const FACE: Transform = { yaw: 26, pitch: -5 };                       // the middle of the polished panel (862, 403)
const STREAK: Transform = { yaw: 13, pitch: 0 };                      // the dark seam running across the slab (711, 360)
const OLD_PAINT: Transform = { yaw: 40, pitch: -19 };                 // the dark smudge low on the slab (981, 523)
const CHIMNEY: Transform = { yaw: 64, pitch: -10.5, distance: 12 };   // the deep cleft at the right edge (1186, 450)
const FOOT: Transform = { yaw: 6, pitch: -35 };                       // the pale ledge lip under her boots (691, 660)
const PASS: Transform = { yaw: -51.5, pitch: -2.5, distance: 18 };    // the green pass floor 200 m below (188, 381)
const ROAD: Transform = { yaw: -63, pitch: -31.5, distance: 18 };     // the road's pale bend under the forest (102, 630)
const RIDGE_AT: Transform = { yaw: -35, pitch: 22, distance: 30 };    // the green ridge across the pass (341, 171)
const DOWN: Transform = { yaw: -17.6, pitch: -27 };                   // the foot of the cleft, the way she traversed in (490, 591)

const hold = (entity: string, wait: number): WalkStep[] => [{ type: "hold:start", entity }, { wait }, { type: "hold:end" }];

export default defineScene({
  id: "slab",
  day: 1, place: "飞拉达 · 走错的岩台", elevation: "2,372 m",
  painting: "pano/05b-slab.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", gusty: true, windPan: -0.35 },
  arriveAt: 12 * 60 + 20,
  idleLook: true,
  fallback: "这边一根铁钉都没有。",
  entities: [
    // The far rib, across the cleft: the cable comes down through this bolt. A look, or a photograph of it.
    lookAt("route", BOLT, "对面的锚栓", 1, { interactable: { verbs: ["inspect", "photograph"], label: "对面的锚栓", reveal: 13, cost: { minutes: 1 } } }),
    /* Bolted to the rock beside it: a small dark box. One sprite in one state — the lid turning over in the light is
       carried by the tick, the glance and her line, not by a second picture. (mailbox-far.webp is the box standing on a
       boulder, painted three-quarters from above for a horizontal surface; on a vertical rib it reads as a lunchbox on a
       floating stone, so this asks for its own face-on id instead.) */
    { id: "box", transform: BOX,
      sprite: { src: "sprites/mailbox-wall.webp", layer: "prop", sizeVh: 4 },
      gaze: { radius: 12, dwell: 900 } },
    // The near lip of the cleft. Lean out over it and the far wall opens up all the way down.
    { id: "seam", transform: SEAM, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "裂缝这边的岩棱", reveal: 13, cost: { minutes: 2, fatigue: 0.05 } },
      hold: { ms: 1000, scaleWith: ["fatigue"] } },
    // The panel itself: a palm goes over it looking for anything at all.
    { id: "face", transform: FACE, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "打磨过的石板", reveal: 14, cost: { minutes: 1, fatigue: 0.02 } },
      hold: { ms: 800, scaleWith: ["fatigue"] } },
    /* Two candidate marks, both of them not paint: a wet seam running down the upper slab, and old colour from another
       line low on it. The factory's default false-blaze is a lichened pebble — a boulder silhouette glued to a polished
       vertical panel, and not what she names — so each one carries the picture its word describes. */
    blaze("streak-slab", STREAK, false, { sprite: { src: "sprites/blaze-streak-wet.webp", layer: "prop", sizeVh: 4 } }),
    blaze("oldpaint-slab", OLD_PAINT, false, { sprite: { src: "sprites/blaze-arrow-old.webp", layer: "prop", sizeVh: 4 } }),
    // The deep cleft at the right edge. Three minutes of shuffling along the ledge to look into it.
    wrongWay("chimney", CHIMNEY, "右边的深缝", 3, "缝里过不去。"),
    // Her own ledge, and the two hundred metres of pass under it.
    { id: "foot", transform: FOOT, interactable: { verbs: ["inspect"], label: "脚下的岩台", reveal: 13, cost: { minutes: 1 } } },
    lookAt("pass", PASS, "脚下的山口", 1),
    lookAt("road", ROAD, "盘山公路", 1),
    { id: "ridge", transform: RIDGE_AT, gaze: { radius: 13, dwell: 1100 } },
    // Nothing on this side takes a carabiner. Her hand finds that out for itself — but only once she has had her hands
    // on this wall; a line on screen from the first frame telling her to clip in would be an instruction, not an idea.
    { id: "lanyard", transform: { yaw: 0, pitch: -88 }, tags: ["action"],
      interactable: { verbs: ["clip"], label: "找地方挂挽索", reveal: 0, cost: { minutes: 0.5 } },
      visible: all(worn("lanyard"), any(flag(LEANED), flag(TOUCHED))) },
    // The only way out: down-climb the way she traversed in. Twenty minutes, there and back (v4 §7).
    backArrow("back", DOWN, "crack", "下攀回去", 20),
  ],
  exitWhen: undefined,
  /* slab is a side scene: engine/dev.ts's warpTo walks MAIN_ORDER and never reaches it, so this never runs on ?node=.
     It exists so that slab.seenBox (contract §6's cross-scene table) is right if the loop ever includes side scenes;
     it must stay out of any main-line seed pass, or it would claim the box was seen by a player who never came here. */
  seed: (w) => { w.setFlag(SEEN, true); },
  script: (ctx) => {
    const w = ctx.world;
    let stills = 0;

    /* Stepping off the traverse onto half a metre of rock. */
    ctx.onEnter(() => {
      ctx.kick("settle", 0.8, { yaw: 0, pitch: -3 });
      ctx.sfx("step", 0.2, 0.7);
      ctx.fx("dust", 0.25);
    });

    /* The box. Its lid turns over once in the light and stays turned; nothing else about it changes today. */
    const findBox = () => {
      if (ctx.flag(SEEN, false)) return;
      ctx.setFlag(SEEN, true);
      ctx.sfx("tick", -0.45, 0.55);
      ctx.kick("glance", 0.5, { yaw: -3, pitch: -2 });
      ctx.say("盖子在反光。", { tag: "slab-box" });
    };
    ctx.onGaze("box", findBox);

    /* The far rib: a look across, or the phone. If the box has turned over already, that is what the frame holds. */
    ctx.onInteract("route", (verb) => {
      if (verb === "photograph") {
        w.dispatch({ type: "phone:shoot" });
        ctx.kick("glance", 0.35, { yaw: -2, pitch: 0 });
        return;
      }
      ctx.kick("glance", 0.6, { yaw: -4, pitch: -2 });
      ctx.sfx("breath", -0.4, 0.6);
    });

    /* Leaning out over the cleft: weight onto the outside hand, the far wall opens all the way down, the box with it.
       Letting go early is just the hand coming back. */
    ctx.onHold("seam", () => {
      ctx.setFlag(LEANED, true);
      ctx.hand(SEAM, "grip", true);
      ctx.kick("pull", 1.0, { yaw: -5, pitch: -3 });
      ctx.sfx("grip", -0.3);
      ctx.after(420, () => { ctx.sfx("slide", -0.4, 0.4); ctx.fx("dust", 0.35); ctx.kick("settle", 0.5); });
      // The cable is painted across the cleft; she does not read the picture back. The lean's only word is the box's.
      findBox();
    });
    ctx.onRelease("seam", (progress) => {
      if (progress <= 0.25) return;
      ctx.kick("settle", 0.45, { yaw: 2, pitch: 0 });
      ctx.sfx("cloth", -0.2, 0.5);
    });

    /* The panel: the palm goes over it and finds a polished surface with nothing on it. */
    ctx.onHold("face", () => {
      ctx.setFlag(TOUCHED, true);
      ctx.hand(FACE, "grip");
      ctx.sfx("slide", 0.35, 0.5);
      ctx.kick("glance", 0.5, { yaw: 3, pitch: -3 });
      ctx.after(400, () => { ctx.sfx("cloth", 0.3, 0.5); ctx.kick("settle", 0.4); });
      ctx.say("什么都抓不住。", { tag: "slab-face" });
    });
    ctx.onRelease("face", (progress) => { if (progress > 0.25) ctx.sfx("cloth", 0.3, 0.4); });

    /* Both marks are marks of something else. The minute and the tock come from the journal; the hand and the word are hers. */
    ctx.on("blaze:confirm", ({ entity }) => {
      if (entity !== "streak-slab" && entity !== "oldpaint-slab") return;
      ctx.hand(ctx.transformOf(entity));
      ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
      ctx.say(entity === "streak-slab" ? "水痕。不是漆。" : "旧箭头。不是这条。", { tag: "slab-false" });
    });

    /* The cleft at the right edge: a shuffle along the ledge, cold air out of it, and a shuffle back. */
    ctx.onInteract("chimney", () => {
      ctx.bump("slab.wrong", 1);
      ctx.sfx("step", 0.6, 0.7); ctx.kick("step", 0.7, { yaw: 4, pitch: 0 }); ctx.fx("dust", 0.3);
      ctx.after(560, () => { ctx.sfx("breath", 0.7, 0.5); ctx.kick("turn", 0.5, { yaw: -3, pitch: 0 }); });
      ctx.say("缝里过不去。", { tag: "slab-chimney" });
    });

    /* Her boots on half a metre of rock; the pass two hundred metres under it; the road; the ridge across the valley. */
    ctx.onInteract("foot", () => {
      ctx.kick("glance", 0.7, { yaw: 0, pitch: -8 });
      ctx.sfx("step", 0, 0.6);
      ctx.after(380, () => { ctx.sfx("slide", -0.2, 0.35); ctx.fx("dust", 0.3); });
    });
    ctx.onInteract("pass", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.kick("glance", 0.3, { yaw: -3, pitch: -2 }); return; }
      ctx.kick("glance", 0.6, { yaw: -5, pitch: -3 }); ctx.sfx("exhale", -0.4, 0.7);
    });
    ctx.onInteract("road", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.kick("glance", 0.3, { yaw: -4, pitch: -2 }); return; }
      ctx.kick("glance", 0.5, { yaw: -6, pitch: -3 }); w.emit("ambience", { overrides: { engine: 0.05 } });
    });
    ctx.onGaze("ridge", () => {
      if (ctx.flag(RIDGE, false)) return;
      ctx.setFlag(RIDGE, true);
      ctx.fx("gust", 0.6); ctx.kick("turn", 0.45, { yaw: -2, pitch: 0 }); ctx.sfx("breath", -0.3, 0.4);
    });

    /* The lanyard: it goes out looking for something to bite and comes back with nothing. No words. */
    ctx.onInteract("lanyard", () => {
      ctx.setFlag(TRIED, true);
      ctx.hand(SEAM, "carabiner");
      ctx.sfx("clink", -0.1, 0.5);
      ctx.after(460, () => { ctx.sfx("cloth", 0, 0.45); ctx.kick("settle", 0.4, { yaw: 0, pitch: -2 }); });
    });

    /* Standing still on the ledge. The second breath brings the cable's hum across the cleft; every third, a gust. */
    ctx.onWait(() => {
      stills += 1;
      w.emit("body:rest", { seconds: 4 });
      ctx.sfx("exhale", 0, 0.55);
      if (stills === 2 && !ctx.flag(HUM, false)) {
        ctx.setFlag(HUM, true);
        ctx.sfx("tick", -0.55, 0.4); ctx.after(260, () => ctx.sfx("tick", -0.55, 0.3));
        ctx.kick("turn", 0.35, { yaw: -2, pitch: 0 });
      }
      if (stills % 3 === 0) { ctx.fx("gust", 0.45); ctx.kick("settle", 0.3); }
    });

    /* Leaving is the down-climb: outside hand on the lip, a foot feeling for the traverse, dust off the ledge.
       The twenty minutes ride on the exit; the landing back in the crack is crack's own. */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "slab" || to !== "crack") return;
      ctx.hand(DOWN, "grip", true);
      ctx.sfx("grip", -0.3);
      ctx.kick("slip", 0.7, { yaw: 0, pitch: -6 });
      ctx.fx("dust", 0.4);
      w.emit("body:fatigue", { delta: 0.06, reason: "下攀退回" });
      ctx.after(520, () => { ctx.sfx("step", -0.4, 0.7); ctx.kick("step", 0.8, { yaw: 0, pitch: -3 }); });
    });
  },
  /* The fastest legal way through a dead end is out of it. */
  walkthrough: [{ type: "travel", entity: "back" }],
  variants: {
    // Lean out over the cleft — the box turns over in the light — then down-climb.
    look: [...hold("seam", 2900), { wait: 600 }, { type: "travel", entity: "back" }],
    // Everything the terrace has: the far rib and a photograph of it, the lean, the panel, both marks,
    // the right-hand cleft, the ledge, the pass and the road, and the carabiner that finds nothing.
    thorough: [
      { type: "interact", entity: "route", verb: "inspect" }, { wait: 300 },
      ...hold("seam", 2900), { wait: 500 },
      { type: "interact", entity: "route", verb: "photograph" }, { wait: 300 },
      ...hold("face", 2400), { wait: 400 },
      { type: "interact", entity: "streak-slab", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "oldpaint-slab", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "chimney", verb: "inspect" }, { wait: 700 },
      { type: "interact", entity: "foot", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "pass", verb: "photograph" }, { wait: 300 },
      { type: "interact", entity: "road", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "lanyard", verb: "clip" }, { wait: 600 },
      { type: "travel", entity: "back" },
    ],
  },
});
