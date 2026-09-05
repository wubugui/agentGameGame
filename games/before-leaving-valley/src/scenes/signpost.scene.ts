/* The fork at 2,455 m, 17:00. A wooden post with four arms on the gravel saddle: the grey limestone wall and the last
   direct sun on it away to the left, a pale track climbing the green shoulder behind it (that is 649, and it goes up),
   and on the right the stone tongue that drops into Val Lasties.
   A little cairn beside the post with a red-white-red stripe on its top stone, something on the blocks away to the
   left that is not paint, and a flat rock to spread the map on.
   Nobody says which arm is hers: the four boards read alike unless she already knows what 656 means.
   Every coordinate below was read off the 150°×84° grid of 10-signpost (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { after, before, entityIs, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, offset, prop, readable } from "./_shared";

const CHOSEN = "signpost.chosen";
const CERTAIN = "signpost.certain";
const WRONG = "signpost.wrong";
const ARMS_READ = "signpost.armsRead";
const LOST_MINUTES = 12;                    // v4 §3.5: leaving a gravel/upper node without a confirmed mark
const WRONG_649 = 60;                       // v4 §7: the wrong arm costs an hour and puts her back at the same fork
/* v4 §6: "那道光（20:15 之后就没有了）". The band slides up the wall as the valley fills with shadow and is gone at sunset. */
const LIGHT_FROM = 17 * 60, LIGHT_TO = 20 * 60 + 15;

/* The four arms, top to bottom, re-measured at 4.5× off 10-signpost: the painted boards sit at
   (657–848, 299–345) / (635–808, 348–392) / (612–850, 396–452) / (613–855, 452–508).
   The board itself is a PROP and the reading is a HOTSPOT on top of it, and they have to be two entities.
   PanoStage drives a Hotspot's opacity from how near the gaze is — `(reveal − distanceDeg) / (reveal × 0.45)`
   with the pitch weighted 1.4× — and the four boards span 18.4° of pitch, so with the reveal of 12° that §6 asks
   for, no gaze can ever have more than two of them up at once: the sign came apart into blank painted arms plus
   one or two glowing lettered ones, sliding in and out as the eye travelled down the post. PropSprite writes no
   data-reveal at all, so a prop never fades; the physical sign is on the picture the whole time she stands here,
   and the reveal-12 hotspot is only about reading it. (E1's repaint is still an ART request — see requests.) */
const BOARD_SCHIAVANEIS: Transform = { yaw: 13.2, pitch: 4.4 };  // top board, painted centre (752, 322)
const BOARD_SELVA: Transform = { yaw: 9.5, pitch: -1.2 };        // second board, painted centre (721, 370)
const BOARD_BOE: Transform = { yaw: 10.7, pitch: -7.5 };         // third board, painted centre (731, 424)
const BOARD_LASTIES: Transform = { yaw: 11, pitch: -14 };        // bottom board, painted centre (734, 480)
/* A Hotspot lays its ring and its <em> label out in one grid column, so the ring renders 9 px ABOVE the anchor;
   the reading hotspots are pulled 1.05° (9 px) lower so the ring lands on the middle of the board. */
const ARM_SCHIAVANEIS: Transform = offset(BOARD_SCHIAVANEIS, 0, -1.05);
const ARM_SELVA: Transform = offset(BOARD_SELVA, 0, -1.05);
const ARM_BOE: Transform = offset(BOARD_BOE, 0, -1.05);
const ARM_LASTIES: Transform = offset(BOARD_LASTIES, 0, -1.05);
const CAIRN: Transform = { yaw: 22.3, pitch: -30.3 };            // the pale stones piled beside the post (830, 620)
const CAIRN_TOP: Transform = { yaw: 22.3, pitch: -29.2 };        // the top stone of that stack (830, 610; same 9 px offset)
const BOULDERS: Transform = { yaw: -55.1, pitch: -21.6 };        // the grey-blue angular blocks on the left (170, 545)
const FLAT_ROCK: Transform = { yaw: -5.5, pitch: -30 };          // the flat pale stone left of the post (593, 617)
const TRACK_649: Transform = { yaw: -10.9, pitch: 9.9 };         // the pale track climbing the green shoulder (547, 275)
const PASTURE: Transform = { yaw: -25.8, pitch: 18.7, distance: 22 };  // the green slope above the track (420, 200)
const VAL_LASTIES: Transform = { yaw: 37.5, pitch: -14 };        // the stone tongue dropping into the valley (960, 480)

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/* The last direct sun on the bedded limestone escarpment filling the left of the picture. The shadow rises out of
   the valley, so the band climbs the bedding to the upper left and thins as it goes. Both ends were re-read at 3.5×
   and both are on lit rock face, not on the dark shadow band between the ledges: (190, 245) — the broad pale
   bedding band — at five o'clock, (110, 168) — the top ledge — at sunset. */
const lastLightAt = (w: World): Transform => {
  const t = clamp01((w.state.clock.minuteOfDay - LIGHT_FROM) / (LIGHT_TO - LIGHT_FROM));
  return { yaw: -52.7 - t * 9.4, pitch: 13.4 + t * 9, distance: 14 };
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
    // --- The four boards themselves: props, so the sign is one object on the picture at every gaze angle.
    // Each sprite is scaled 8% taller than the board painted under it, which at these aspects puts it 10–19%
    // wider as well, so no painted arrow tip shows past a sprite in any direction. ---
    prop("board-schiavaneis", BOARD_SCHIAVANEIS, "sprites/arm-schiavaneis.webp", 9.7),
    prop("board-selva", BOARD_SELVA, "sprites/arm-selva.webp", 9.3),
    prop("board-boe", BOARD_BOE, "sprites/arm-boe.webp", 11.8),
    prop("board-lasties", BOARD_LASTIES, "sprites/arm-lasties.webp", 11.8),
    // --- Reading them. Each one has to be read from close up (reveal 12°) and costs its minute (v4 §6). ---
    readable("arm-schiavaneis", ARM_SCHIAVANEIS, "最上面的木牌", {
      kind: "sign", title: "VAL DE SCHIAVANEIS",
      lines: ["VAL DE SCHIAVANEIS", "649", "白铁皮上钉着号码"],
      minutes: 1,
    }),
    readable("arm-selva", ARM_SELVA, "第二块木牌", {
      kind: "sign", title: "PIZ SELVA",
      lines: ["PIZ SELVA", "649", "木头晒得起了毛，字是手写的"],
      minutes: 1,
    }),
    readable("arm-boe", ARM_BOE, "第三块木牌", {
      kind: "sign", title: "RIFUGIO BOÈ",
      lines: ["RIFUGIO BOÈ", "649"],
      minutes: 1,
    }),
    readable("arm-lasties", ARM_LASTIES, "最下面的木牌", {
      kind: "sign", title: "PLAN DE ROCES – VAL LASTIES",
      lines: ["PLAN DE ROCES –", "VAL LASTIES 2455 m", "656"],
      entry: "E-656", minutes: 1,
    }),
    // --- The stones. The stack beside the post carries the mark; the blocks on the left carry something that is not paint. ---
    // The cairn is scenery, not a hotspot: as a plain prop it is painted on the picture the whole time she stands
    // here (v4 §11 P0 asks for exactly this stack at the foot of the post), and the mark on it is the thing to press.
    prop("cairn", CAIRN, "sprites/cairn.webp", 11),
    // Both stay on the picture after she wipes them, greyed out: her attention, not a UI highlight (v4 §3.5).
    blaze("blaze-cairn", CAIRN_TOP, true, { visible: undefined, enabled: not(entityIs("blaze-cairn", "read")) }),
    blaze("lichen-boulder", BOULDERS, false, { visible: undefined, enabled: not(entityIs("lichen-boulder", "read")) }),
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
    // --- Two ways off the saddle. They look alike; the boards are the only thing that tells them apart. ---
    // 649 up the green shoulder: an hour there and back, and she is standing at the same post again with the light
    // higher up the wall and redder.
    { id: "way-649", transform: TRACK_649, className: "go-hotspot", tags: ["wrongWay"],
      interactable: { verbs: ["step"], label: "绿坡上那条小路", reveal: 22, cost: { minutes: WRONG_649 }, once: true },
      enabled: not(entityIs("way-649", "used")) },
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
    // The hour up the green track, then the boards, then the mark, then down.
    wrong: [
      { type: "interact", entity: "way-649", verb: "step" }, { wait: 1200 },
      { type: "interact", entity: "arm-lasties", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "blaze-cairn", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Everything the fork offers: all four boards, the map, the mark and the thing on the blocks that is not
    // paint, and the light on the wall — looked at, and photographed.
    thorough: [
      { type: "interact", entity: "arm-schiavaneis", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "arm-selva", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "arm-boe", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "arm-lasties", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "paper-map", verb: "use" }, { wait: 400 }, { type: "overlay:close" },
      { type: "interact", entity: "lichen-boulder", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-cairn", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "last-light-look", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "last-light-look", verb: "photograph" }, { wait: 300 },
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

    // --- The stones. The mark on the top stone of the stack is the thing worth a minute. ---
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.5); ctx.sfx("step", 0.3, 0.5); return; }
      ctx.hand(ctx.transformOf(entity));
      glance({ yaw: 0, pitch: -2 }, 0.45);
      ctx.say("地衣。不是漆。", { tag: "sp-false" });
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

    // --- The way that is not hers. She walks it, it runs out, she is back at the same post and the band on the
    // wall has moved. ctx.after here is only the body coming back: 0.6 s and 0.95 s (contract §0.2). ---
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
