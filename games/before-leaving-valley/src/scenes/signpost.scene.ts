/* The fork at 2,455 m, 17:00. A wooden post with four arms on the gravel saddle: the grey limestone wall and the last
   direct sun on it away to the left, a pale track climbing the green shoulder behind it (that is 649, and it goes up),
   the white scree slope falling away on the left, and on the right the stone tongue that drops into Val Lasties.
   A little cairn beside the post with a red-white-red stripe on its top stone, two things on the stones that are not
   paint, and a flat rock to spread the map on.
   Nobody says which arm is hers: the four boards read alike unless she already knows what 656 means.
   Every coordinate below was read off the 150°×84° grid of 10-signpost (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { after, before, entityIs, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, prop, readable } from "./_shared";

const CHOSEN = "signpost.chosen";
const CERTAIN = "signpost.certain";
const WRONG = "signpost.wrong";
const ARMS_READ = "signpost.armsRead";
const LOST_MINUTES = 12;                    // v4 §3.5: leaving a gravel/upper node without a confirmed mark
const WRONG_649 = 60;                       // v4 §7: the wrong arm costs an hour and puts her back at the same fork
const WRONG_LEFT = 25;                      // the white slope on the left ends in a broken step
/* v4 §6: "那道光（20:15 之后就没有了）". The band slides up the wall as the valley fills with shadow and is gone at sunset. */
const LIGHT_FROM = 17 * 60, LIGHT_TO = 20 * 60 + 15;

/* The four arms, top to bottom. Centres and sizes were measured off the painting: the warm-pixel profile of
   10-signpost puts the painted boards at (656–843, 298–344) / (634–805, 346–392) / (610–848, 394–450) /
   (612–845, 450–506), and each sprite below is scaled to cover the board painted under it edge to edge, so the
   red arrow tip baked into the picture never shows past the sprite. (The painted arms come out of the picture
   altogether under GDD §11 P0; see requests.) */
/* The anchors below are pulled ~0.9° lower than the painted board's own centre on purpose: a Hotspot lays its
   image, the ring and the <em> label out in one grid column, so the image renders 9–10 px ABOVE the anchor
   (measured in the running engine: box centre 310 / image centre 300 for the top board). These four numbers are
   the anchor that puts the *image* on the board. Props (the cairn, the light band) have no such offset. */
const ARM_SCHIAVANEIS: Transform = { yaw: 13.3, pitch: 3.7 };    // top board, painted (656–843, 298–344)
const ARM_SELVA: Transform = { yaw: 9.6, pitch: -1.9 };          // second board, painted (634–805, 346–392)
const ARM_BOE: Transform = { yaw: 11.1, pitch: -8.1 };           // third board, painted (610–848, 394–450)
const ARM_LASTIES: Transform = { yaw: 11, pitch: -14.7 };        // bottom board, painted (612–845, 450–506)
const POST: Transform = { yaw: 9.6, pitch: -22 };                // the post under the boards (722, 549)
const CAIRN: Transform = { yaw: 22.3, pitch: -30.3 };            // the pale stones piled beside the post (830, 620)
const CAIRN_TOP: Transform = { yaw: 22.3, pitch: -29.2 };        // the top stone of that stack (830, 610; same 9 px offset)
const BOULDERS: Transform = { yaw: -55.1, pitch: -21.6 };        // the grey-blue angular blocks on the left (170, 545)
const GRAVEL: Transform = { yaw: -28.1, pitch: -28 };            // the pale rock band across the foreground (400, 600)
const FLAT_ROCK: Transform = { yaw: -5.5, pitch: -30 };          // the flat pale stone left of the post (593, 617)
const TRACK_649: Transform = { yaw: -10.9, pitch: 9.9 };         // the pale track climbing the green shoulder (547, 275)
const PASTURE: Transform = { yaw: -25.8, pitch: 18.7, distance: 22 };  // the green slope above the track (420, 200)
const SCREE_LEFT: Transform = { yaw: -32.4, pitch: -12.8 };      // the smooth white slope falling away left (363, 470)
const VAL_LASTIES: Transform = { yaw: 37.5, pitch: -14 };        // the stone tongue dropping into the valley (960, 480)

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/* The last direct sun on the grey wall. The shadow rises out of the valley, so the band climbs the bedding to the
   upper left and thins as it goes: (200, 265) on the wall at five o'clock, (120, 165) — the top ledge — at sunset. */
const lastLightAt = (w: World): Transform => {
  const t = clamp01((w.state.clock.minuteOfDay - LIGHT_FROM) / (LIGHT_TO - LIGHT_FROM));
  return { yaw: -51.6 - t * 9.3, pitch: 11.1 + t * 11.7, distance: 14 };
};

export default defineScene({
  id: "signpost",
  day: 1, place: "岔口 · 路牌", elevation: "2,455 m",
  painting: "pano/10-signpost.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", clouds: true, windPan: -0.2 },
  chapter: { eyebrow: "决定", title: "紧急下撤" },
  arriveAt: 17 * 60,
  idleLook: true,
  fallback: "岔口。风从下面上来。",
  // No gate: a player who touches nothing and walks down the stone tongue still leaves (v4 §12 A2, §3.5 D6).
  // Which way she took is written down on the way out.
  exitWhen: undefined,
  entities: [
    // --- The four boards. Each one has to be read from close up (reveal 12°) and costs its minute (v4 §6). ---
    readable("arm-schiavaneis", ARM_SCHIAVANEIS, "最上面的木牌", {
      kind: "sign", title: "VAL DE SCHIAVANEIS",
      lines: ["VAL DE SCHIAVANEIS", "649", "白铁皮上钉着号码"],
      minutes: 1,
    }, { sprite: { src: "sprites/arm-schiavaneis.webp", layer: "prop", sizeVh: 9.7 } }),
    readable("arm-selva", ARM_SELVA, "第二块木牌", {
      kind: "sign", title: "PIZ SELVA",
      lines: ["PIZ SELVA", "649", "木头晒得起了毛，字是手写的"],
      minutes: 1,
    }, { sprite: { src: "sprites/arm-selva.webp", layer: "prop", sizeVh: 9.7 } }),
    readable("arm-boe", ARM_BOE, "第三块木牌", {
      kind: "sign", title: "RIFUGIO BOÈ",
      lines: ["RIFUGIO BOÈ", "649"],
      minutes: 1,
    }, { sprite: { src: "sprites/arm-boe.webp", layer: "prop", sizeVh: 11.8 } }),
    readable("arm-lasties", ARM_LASTIES, "最下面的木牌", {
      kind: "sign", title: "PLAN DE ROCES – VAL LASTIES",
      lines: ["PLAN DE ROCES –", "VAL LASTIES 2455 m", "656"],
      entry: "E-656", minutes: 1,
    }, { sprite: { src: "sprites/arm-lasties.webp", layer: "prop", sizeVh: 11.8 } }),
    // The post itself: something to put a hand on while she reads. One minute, one breath back.
    // (ClockSystem rounds cost.minutes, so half minutes do not exist; this really is one.)
    { id: "post", transform: POST, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "路牌的柱子", reveal: 13, cost: { minutes: 1 } },
      hold: { ms: 600, scaleWith: ["fatigue"] } },
    // --- The stones. The stack beside the post carries the mark; two other things on the rock are not paint. ---
    // The cairn is scenery, not a hotspot: as a plain prop it is painted on the picture the whole time she stands
    // here (v4 §11 P0 asks for exactly this stack at the foot of the post), and the mark on it is the thing to press.
    prop("cairn", CAIRN, "sprites/cairn.webp", 11),
    // The real one stays on the picture after she wipes it, greyed out: her attention, not a UI highlight (v4 §3.5).
    blaze("blaze-cairn", CAIRN_TOP, true, { visible: undefined, enabled: not(entityIs("blaze-cairn", "read")) }),
    blaze("lichen-boulder", BOULDERS, false),
    blaze("rust-gravel", GRAVEL, false),
    // --- The last direct sun on the grey wall. It is a plain prop, so it is on the picture whether or not she is
    // looking at it: that is the whole point of v4 §7 — come back to this fork an hour later and the light is
    // somewhere else on the wall and a different colour. Touching it is a separate hotspot below. ---
    { id: "last-light", transform: lastLightAt,
      sprite: { src: "sprites/last-light-wall.webp", layer: "back", sizeVh: 5.4, className: "light-beam-sprite",
        swap: [{ when: after(18 * 60), src: "sprites/last-light-wall-low.webp" }] },
      gaze: { radius: 14, dwell: 900 },
      visible: before(LIGHT_TO) },
    { id: "last-light-look", transform: lastLightAt,
      interactable: { verbs: ["inspect", "photograph"], label: "石墙上的那道光", reveal: 14, cost: { minutes: 1 } },
      visible: before(LIGHT_TO) },
    // --- The map on the flat stone, and the green shoulder the bells come from. ---
    prop("paper-map", FLAT_ROCK, "sprites/map-folded.webp", 11, {
      interactable: { verbs: ["use"], label: "摊开地图", reveal: 13, cost: { minutes: 1 }, requires: has("paperMap") },
    }),
    // Nothing to click on the pasture: the bells come from over there and she has to turn her head.
    { id: "pasture", transform: PASTURE, gaze: { radius: 14, dwell: 1000 } },
    // --- Three ways off the saddle. They look alike; the boards are the only thing that tells them apart. ---
    // 649 up the green shoulder: an hour there and back, and she is standing at the same post again with the light
    // higher up the wall and redder.
    { id: "way-649", transform: TRACK_649, className: "go-hotspot", tags: ["wrongWay"],
      interactable: { verbs: ["step"], label: "绿坡上那条小路", reveal: 22, cost: { minutes: WRONG_649 }, once: true },
      enabled: not(entityIs("way-649", "used")) },
    // The white slope on the left looks like the easy way down. It ends in a broken step.
    { id: "way-left", transform: SCREE_LEFT, className: "go-hotspot", tags: ["wrongWay"],
      interactable: { verbs: ["step"], label: "左边的白色碎石坡", reveal: 22, cost: { minutes: WRONG_LEFT }, once: true },
      enabled: not(entityIs("way-left", "used")) },
    goArrow("go", VAL_LASTIES, { to: "scree", minutes: 40, label: "下去的碎石道", kind: "run" }),
  ],
  seed: (w) => {
    w.setFlag(CHOSEN, "656");
    w.setFlag(CERTAIN, true);
    w.setFlag(WRONG, 0);
    w.setFlag(ARMS_READ, 4);
    w.patch("journal", { entries: Array.from(new Set([...w.state.journal.entries, "E-656"])) });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-cairn", verb: "inspect" },
    { wait: 400 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // The hour up the green track, then the white slope, then the boards, then the mark, then down.
    wrong: [
      { type: "interact", entity: "way-649", verb: "step" }, { wait: 1200 },
      { type: "interact", entity: "way-left", verb: "step" }, { wait: 1200 },
      { type: "interact", entity: "arm-lasties", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "blaze-cairn", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Everything the fork offers: all four boards, the map, the mark and both things that are not paint,
    // the light on the wall, and a hand on the post.
    thorough: [
      { type: "interact", entity: "arm-schiavaneis", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "arm-selva", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "arm-boe", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "arm-lasties", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "paper-map", verb: "use" }, { wait: 400 }, { type: "overlay:close" },
      { type: "interact", entity: "lichen-boulder", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "rust-gravel", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-cairn", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "last-light-look", verb: "photograph" }, { wait: 300 },
      { type: "hold:start", entity: "post" }, { wait: 1600 }, { type: "hold:end" },
      { type: "travel", entity: "go" },
    ],
    // Straight down without reading or confirming anything: twelve minutes of looking for the line on the way out.
    blind: [{ type: "travel", entity: "go" }],
  },
  script: (ctx) => {
    const w = ctx.world;
    const glance = (dir: { yaw: number; pitch: number }, strength = 0.4) => ctx.kick("glance", strength, dir);
    const shoot = () => w.dispatch({ type: "phone:shoot" });
    // Her eyes go to wherever the band is on the wall right now — the one thing in this picture that moves.
    const towardLight = () => {
      const t = lastLightAt(w);
      glance({ yaw: t.yaw < -50 ? -5 : -4, pitch: t.pitch > 16 ? 3 : 2 }, 0.45);
    };

    // --- Arriving off the plateau: the gravel settles under her, nothing is said. ---
    ctx.onEnter((from) => { if (from === "hutView") { ctx.kick("settle", 0.45); ctx.sfx("step", 0, 0.5); } });

    // --- The four boards. She reads them; she does not read them out. ---
    for (const id of ["arm-schiavaneis", "arm-selva", "arm-boe", "arm-lasties"]) {
      ctx.onInteract(id, () => {
        ctx.bump(ARMS_READ, 1);
        ctx.hand(ctx.transformOf(id));
        glance({ yaw: 0, pitch: 1 }, 0.35);
      });
    }

    // --- A hand on the post: a minute, one breath back. ---
    ctx.onHold("post", () => { w.emit("body:rest", { seconds: 8 }); ctx.sfx("exhale", 0, 0.6); ctx.kick("settle", 0.4); });
    ctx.onRelease("post", () => { ctx.sfx("cloth", 0, 0.35); });

    // --- The stones. The mark on the top stone of the stack is the thing worth a minute. ---
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.5); ctx.sfx("step", 0.3, 0.5); return; }
      ctx.hand(ctx.transformOf(entity));
      glance({ yaw: 0, pitch: -2 }, 0.45);
      ctx.say(entity === "lichen-boulder" ? "地衣。不是漆。" : "铁锈。不是漆。", { tag: "sp-false" });
    });

    // --- The map on the flat stone: the paper says what it says. ---
    ctx.onInteract("paper-map", () => {
      ctx.bump("signpost.mapSpread", 1);
      ctx.hand(ctx.transformOf("paper-map"));
      glance({ yaw: 0, pitch: -4 }, 0.4);
      w.dispatch({ type: "item:use", item: "paperMap" });
    });

    // --- The last direct sun on the wall. Her eyes find it first; touching it is a minute and a breath. ---
    ctx.onGaze("last-light", () => {
      if (ctx.flag("signpost.lightSeen", false)) return;
      ctx.setFlag("signpost.lightSeen", true);
      towardLight(); ctx.sfx("breath", -0.45, 0.45);
    });
    ctx.onInteract("last-light-look", (verb) => {
      ctx.setFlag("signpost.light", true);
      if (verb === "photograph") { shoot(); towardLight(); return; }
      towardLight(); ctx.sfx("exhale", -0.45, 0.55);
      w.emit("body:rest", { seconds: 2 });
      ctx.say("光快从墙上下去了。", { tag: "sp-light" });
    });

    // --- Standing still: the second breath brings the bells up from the green shoulder, off to the left. ---
    let waits = 0;
    ctx.onWait(() => {
      waits += 1;
      if (waits !== 2 || ctx.flag("signpost.bells", false)) return;
      ctx.setFlag("signpost.bells", true);
      ctx.sfx("clink", -0.55, 0.32);
      ctx.after(760, () => ctx.sfx("clink", -0.5, 0.26));
      glance({ yaw: -5, pitch: 1 }, 0.4);
    });
    ctx.onGaze("pasture", () => {
      if (ctx.flag("signpost.pasture", false)) return;
      ctx.setFlag("signpost.pasture", true);
      ctx.sfx("clink", -0.5, 0.28); ctx.kick("settle", 0.25);
      w.emit("body:rest", { seconds: 2 });
      ctx.say("牛铃。很远。", { tag: "sp-bell" });
    });

    // --- The clock crossing her while she stands here. Six o'clock brings the crickets and takes the wide gold band
    // off the wall (the sprite swaps to the narrow red one); half past seven turns the wind. No words for either. ---
    ctx.onMark("crickets-in", () => {
      w.emit("ambience", { overrides: { crickets: 0.22, birds: 0.12 } });
      ctx.sfx("tick", 0.3, 0.35);
      towardLight();
    });
    ctx.onMark("wind-turns", () => {
      w.emit("ambience", { overrides: { wind: 0.85, windTone: 1450, crickets: 0.22, birds: 0 } });
      ctx.fx("gust", 0.6); ctx.kick("turn", 0.4);
    });

    // --- The two ways that are not hers. She walks them, they run out, she is back at the same post and the band
    // on the wall has moved. ctx.after here is only the body coming back: 0.6 s and 0.95 s (contract §0.2). ---
    const wander = (id: string, pan: number, fatigue: number, line: string, tag: string) => {
      ctx.onInteract(id, () => {
        ctx.bump(WRONG, 1);
        ctx.kick("step", 0.9); ctx.sfx("step", pan, 0.7); ctx.fx("dust", 0.35);
        w.emit("body:fatigue", { delta: fatigue, reason: `${id} 往返` });
        ctx.after(600, () => { ctx.kick("turn", 0.7); ctx.sfx("step", pan * 0.5, 0.5); });
        ctx.after(950, () => { ctx.kick("settle", 0.55); ctx.sfx("exhale", 0, 0.5); towardLight(); });
        ctx.say(line, { tag });
      });
    };
    wander("way-649", -0.35, 0.06, "这条一直在往上。", "sp-649");
    wander("way-left", -0.5, 0.04, "碎石坡下面是断的。", "sp-left");

    // --- Leaving. Which arm she took goes down here; without a confirmed mark she loses the line for a while first. ---
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "signpost" || to !== "scree") return;
      ctx.setFlag(CHOSEN, "656");
      if (ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: LOST_MINUTES }, "没认记号，在岔口找了一段路");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "sp-lost", priority: 1 });
    });
  },
});
