/* The Sella plateau, 15:35. A karst sea with no path: pale limestone ribs at her feet, a stepped slab with a small
   ometto behind it, a big split boulder on the right, snow lying in the hollows, three flat-topped towers on the
   skyline and a dark cloud bank coming over from the right. Nobody. Four marks on the stones (two are not paint),
   two ways across, the plateau's lip off to the right, and the twenty seconds the wind stops.
   Coordinates read off the 150°×84° grid of 09-plateau (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84). */
import { all, has } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform, Verb } from "../engine/types";
import { blaze, goArrow, lookAt, prop, windy, wrongWay } from "./_shared";

const CERTAIN = "plateau.certain";
const ROUTE = "plateau.route";
const STILL = "plateau.stillness";
const MARKS = "plateau.marks";
const SLIP_FATIGUE = 0.45;          // the snow shortcut slides once under tired legs (v4 §7)
const LOST_MINUTES = 15;            // going by the general direction across the karst (v4 §3.5: plateau = 15)
const STILL_HOLD = 16000;           // GazeSystem's waits land at 4 s, 12 s, 20 s: 4 + 16 = twenty seconds standing
const STILL_GAP = 26000;            // a longer silence than this between waits means she moved: start counting again
const STILL_MS = 19000;             // how long the wind stays down

/* A candidate mark costs a minute (v4 §7 "认记号每次 −1 分钟"). The false ones are charged by JournalSystem
   on blaze:confirm, so the scene must not charge them a second time — all four end up costing exactly 1.
   Settling one never takes it off the karst: the factory's default `visible: not(entityIs(id,"read"))` deletes the
   painted stripe and the lichen the moment she has looked at them, which is neither of the two things §3.5 asks for.
   Overriding `visible` (an `all` of nothing is true) keeps all four on the stones until she walks off the plateau, and
   `once` carries "settled": a second press comes back as `interact:refused`, which the script answers with her hand
   going out and returning. Not `enabled` — PanoStage writes an inline opacity onto every hotspot with a reveal every
   frame (PanoStage.tsx:427), so `.hotspot.is-disabled`'s .35 never reaches the screen and a disabled mark would be a
   silent dead button. The grey of the two that are not paint and the faint highlight of the two that are hang off
   these classes, as `filter` rather than opacity for that same reason; the rule is the integrator's, in the requests. */
const mark = (id: string, t: Transform, real: boolean, sizeVh?: number) =>
  blaze(id, t, real, {
    interactable: { verbs: ["inspect"] as Verb[], label: "石头上的记号", reveal: 12, cost: { minutes: real ? 1 : 0 }, once: true },
    visible: all(),
    className: real ? "blaze-found" : "blaze-ruled-out",
    ...(sizeVh
      ? { sprite: { src: real ? "sprites/blaze-red-white.webp" : "sprites/blaze-false.webp", layer: "prop" as const, sizeVh } }
      : {}),
  });

const TOWERS: Transform = { yaw: -30, pitch: 15, distance: 25 };   // the left flat-topped tower (x≈385, y≈230)
const CAIRN: Transform = { yaw: -2, pitch: -4, distance: 14 };     // the little stack behind the stepped slab (x≈625, y≈395)

export default defineScene({
  id: "plateau",
  day: 1, place: "Sella 高原", elevation: "2,800 m",
  painting: "pano/09-plateau.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.75, windTone: 1300, birds: 0.1, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", clouds: true, gusty: true, windPan: 0.3 },
  arriveAt: 15 * 60 + 35,
  fallback: "灰白的石头一直铺到天边。",
  entities: [
    // Four candidates, all labelled the same (v4 §6): two paint stripes, a lichen rosette on the big boulder, an old survey mark on a rib.
    // sizeVh is the rendered height × distance/10 (Hotspot.tsx:39): a 25 cm mark 11 m out is ~2 vh, one 4 m out is ~4 vh.
    mark("blaze-plateau-a", { yaw: -4, pitch: -8 }, true, 2),                    // front face of the stepped slab's top step (x≈606, y≈428)
    mark("blaze-plateau-b", { yaw: 38, pitch: -13 }, true),                      // the left lobe of the big boulder (x≈964, y≈471)
    mark("lichen-plateau", { yaw: 50, pitch: -14.5 }, false),                    // the pale patch on the boulder's right lobe (x≈1065, y≈485)
    mark("survey-plateau", { yaw: -24, pitch: -22, distance: 8 }, false, 5),     // the top of the second rib at her feet (x≈435, y≈548)
    // Things to look at: the ometto somebody built, the towers with nobody under them, the cloud coming over.
    { id: "cairn", transform: CAIRN, interactable: { verbs: ["inspect"], label: "石堆", reveal: 12, cost: { minutes: 1 } } },
    lookAt("towers-far", TOWERS, "远处的石塔", 1),
    { id: "cloud-bank", transform: { yaw: 42, pitch: 32, distance: 30 }, gaze: { radius: 14, dwell: 1200 } },
    // The map, folded on the rib at her feet: a windy node, so a stone on each corner (v4 §3.7).
    prop("paper-map", { yaw: -12, pitch: -26, distance: 8 }, "sprites/map-folded.webp", 10, {   // on the top of the rib at her feet (x≈538, y≈583)
      interactable: { verbs: ["use"], label: "摊开地图", reveal: 12, cost: { minutes: 0 }, requires: has("paperMap") },
    }),
    // The flat bench on the left looks like a walkway. Ten minutes to nowhere.
    wrongWay("bench-west", { yaw: -48, pitch: -12 }, "左边的平石台", 10, "石台走到头，下面是空的。不是这条。"),
    // Where the pavement steps down on the right: a low pale shelf running out that way. Six minutes there, six back,
    // nothing but the view. This plate paints no lip — the label names the terrace, and 09c-ledge paints the drop.
    { id: "ledge-route", transform: { yaw: 67, pitch: -4, distance: 20 }, className: "go-hotspot", tags: ["exit"],
      exit: { to: "ledge", kind: "detour", label: "往右的低石台", minutes: 6 },
      interactable: { verbs: ["inspect"], label: "往右的低石台", reveal: 20 } },
    /* Two ways across, both always open (D6): along the stone rib is slow and sure; over the snow is faster and, tired,
       slides once. The two numbers are §7's own — "横切走岩脊（35 分，稳）还是抄雪斑（28 分，高疲劳时滑一次）" — so
       they stay verbatim; a fastest legal line of one mark plus the snow is 29 minutes, four over the 25 in the §3.1
       table. §7 is the node's spec and §3.1's row is the arithmetic, so the row is the thing that has to move: it is in
       the requests, not silently repriced here (§0.1: 不发明数字). */
    goArrow("ridge-route", { yaw: 12, pitch: -10 }, { to: "hutView", minutes: 35, label: "沿岩脊横切", kind: "walk" }),
    goArrow("snow-route", { yaw: 25, pitch: -20 }, { to: "hutView", minutes: 28, label: "从雪斑上抄过去", kind: "run" }),
  ],
  seed: (w) => { w.setFlag(CERTAIN, true); w.setFlag(ROUTE, "ridge"); w.setFlag(MARKS, 1); },
  script: (ctx) => {
    const w = ctx.world;
    const rt = w.rt as typeof w.rt & { gustT?: number; nextGust?: number };
    const glance = (dir: { yaw: number; pitch: number }, strength = 0.4) => ctx.kick("glance", strength, dir);
    const shoot = () => w.dispatch({ type: "phone:shoot" });

    // --- The stillness. Stand without moving for twenty seconds and the wind stops: no words, no gusts, one breath. Once a game.
    //     No idleLook on this node: a scene whose subject is standing still must not wander the camera, or the engine's
    //     gaze-moved test keeps firing and the waits never arrive in a row. ---
    let firstWaitAt = -Infinity, lastWaitAt = -Infinity, stillSince = 0, still = false;
    const windStops = () => {
      still = true; stillSince = rt.now;
      ctx.setFlag(STILL, true);
      w.emit("ambience", { overrides: { wind: 0, birds: 0 } });
      rt.gustT = 0; rt.nextGust = 600;                 // no gust while it lasts
      ctx.kick("settle", 0.35);
      ctx.sfx("exhale", 0, 0.5);
    };
    const windReturns = () => {
      if (!still) return;
      still = false;
      w.emit("ambience", { overrides: {} });
      rt.gustT = 0; rt.nextGust = 1.5;                 // the first gust back is what ends it
    };
    const moved = () => { firstWaitAt = -Infinity; lastWaitAt = -Infinity; windReturns(); };
    ctx.onWait(() => {
      const now = rt.now;
      if (now - lastWaitAt > STILL_GAP) firstWaitAt = now;   // the first wait of a new spell of standing still
      lastWaitAt = now;
      if (still) { if (now - stillSince >= STILL_MS) windReturns(); return; }
      if (now - firstWaitAt >= STILL_HOLD && !ctx.flag(STILL, false)) windStops();
    });
    ctx.on("interact:attempt", moved);
    ctx.on("phone:open", moved);
    ctx.on("overlay", ({ id }) => { if (id) moved(); });
    // Turning her head across a hotspot's edge counts as moving — but only when the gaze really travelled this frame.
    ctx.on("gaze:enter", () => { if (w.rt.gazeMoved) moved(); });
    ctx.on("gaze:leave", () => { if (w.rt.gazeMoved) moved(); });

    // --- Marks on the stones. Real ones are settled by the journal (hand, cloth, certain); she counts them. False ones: a hand, a look, a minute. ---
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.bump(MARKS, 1); glance({ yaw: 0, pitch: -3 }, 0.4); ctx.sfx("step", 0, 0.4); return; }
      ctx.hand(ctx.transformOf(entity)); glance({ yaw: 0, pitch: -2 }, 0.4);
      if (entity === "lichen-plateau") ctx.say("地衣。不是漆。", { tag: "plateau-lichen" });
      if (entity === "survey-plateau") ctx.say("旧的测量点。不是漆。", { tag: "plateau-survey" });
    });

    // --- Looking. The ometto: someone was here once. The towers: nobody now. The cloud: only if her eyes rest on it. ---
    ctx.onInteract("cairn", () => {
      glance({ yaw: 0, pitch: 2 }, 0.5); ctx.sfx("step", -0.1, 0.5); ctx.fx("dust", 0.3);
      ctx.say("有人垒的。", { tag: "plateau-cairn" });
    });
    ctx.onInteract("towers-far", (verb) => {
      if (verb === "photograph") { shoot(); ctx.setFlag("plateau.photo", true); glance({ yaw: -2, pitch: 3 }, 0.35); return; }
      glance({ yaw: -3, pitch: 3 }, 0.5); ctx.sfx("breath", -0.3, 0.5);
      w.emit("body:rest", { seconds: 2 });
      ctx.say("一个人都没有。", { tag: "plateau-towers" });
    });
    ctx.onGaze("cloud-bank", () => {
      ctx.setFlag("plateau.cloud", true);
      ctx.fx("gust", 0.8); ctx.kick("turn", 0.7);
      ctx.say("云压下来了。", { tag: "plateau-cloud" });
    });

    // --- The map on the rib: a stone on each corner before it will stay open. The paper says what it says; she says nothing. ---
    ctx.onInteract("paper-map", () => {
      ctx.bump("plateau.mapSpread", 1);
      if (windy(w)) ctx.spend({ minutes: 0.5 }, "用石头压住地图角");
      ctx.hand(ctx.transformOf("paper-map")); glance({ yaw: 0, pitch: -4 }, 0.4);
      w.dispatch({ type: "item:use", item: "paperMap" });
    });

    // --- The bench: she walks it, it ends above nothing, she comes back. Ten minutes and a little dust. ---
    ctx.onInteract("bench-west", () => {
      ctx.setFlag("plateau.wrong", true);
      ctx.kick("step", 0.8); ctx.sfx("step", -0.4); ctx.fx("dust", 0.3);
      w.emit("body:fatigue", { delta: 0.03, reason: "平石台往返" });
      ctx.after(600, () => { ctx.kick("settle", 0.6); ctx.sfx("step", -0.2); });
      ctx.say("石台走到头，下面是空的。不是这条。", { tag: "plateau-bench" });
    });
    /* Pressed again — the bench she has already walked, a mark she has already settled: the thing is still out there
       and still takes her hand, it just has nothing else to show her. The hand goes out, one dry knock, and comes back;
       no second sentence, no minute (as meadow, search). */
    ctx.on("interact:refused", ({ entity, reason }) => {
      if (reason !== "gone") return;
      const def = ctx.scene.entities.find((one) => one.id === entity);
      if (!def?.interactable?.once) return;
      const where = ctx.transformOf(entity);
      ctx.hand(where, "grip");
      glance({ yaw: 0, pitch: -4 }, 0.3);
      ctx.sfx("tock", Math.max(-1, Math.min(1, where.yaw / 60)), 0.3);
    });

    // --- Back from the lip: the plateau settles under her again. ---
    ctx.onEnter((from) => { if (from === "ledge") ctx.kick("settle", 0.5); });

    // --- Leaving: the route she took, the slide on the snow, and the fifteen minutes of a karst sea without a confirmed mark (v4 §3.5). ---
    ctx.on("travel:begin", ({ from, to, run }) => {
      if (from !== "plateau") return;
      windReturns();
      if (to !== "hutView") return;
      ctx.setFlag(ROUTE, run ? "snow" : "ridge");
      if (run && w.state.body.fatigue >= SLIP_FATIGUE) {
        w.emit("body:slip", { entity: "snow-route", severity: 1 });
        ctx.sfx("slip", 0.2, 1); ctx.sfx("slide", 0.2, 0.7);
        ctx.spend({ minutes: 4 }, "雪斑上滑了一下");
      }
      if (!ctx.flag(CERTAIN, false)) {
        ctx.spend({ minutes: LOST_MINUTES }, "没认记号，在石海上找了一段路");
        ctx.kick("turn", 0.5);
        ctx.say("走错了一小段。", { tag: "plateau-lost", priority: 1 });
      }
    });

    return () => { if (still) windReturns(); };
  },
  walkthrough: [
    { type: "interact", entity: "blaze-plateau-a", verb: "inspect" },
    { wait: 400 },
    { type: "travel", entity: "snow-route" },
  ],
  variants: {
    // The lip: six minutes out, the view, six minutes back (ledge's own back arrow).
    detour: [{ type: "travel", entity: "ledge-route" }],
    // The bench, the lichen and the survey mark first, then the stone rib.
    wrong: [
      { type: "interact", entity: "bench-west", verb: "inspect" }, { wait: 800 },
      { type: "interact", entity: "bench-west", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "lichen-plateau", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "survey-plateau", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "blaze-plateau-b", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "ridge-route" },
    ],
    // Twenty seconds without moving: no commands at all, the pointer simply rests and GazeSystem's own waits
    // arrive at 4 s / 12 s / 20 s (PanoStage clamps dt at 50 ms, so a slow headless renderer stretches that
    // wall-clock cadence — hence the generous wait). Then the far mark, then the rib.
    still: [
      { wait: 44000 },
      { type: "interact", entity: "blaze-plateau-b", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "ridge-route" },
    ],
    // No mark at all: fifteen minutes of looking for the line on the way out.
    blind: [{ type: "travel", entity: "ridge-route" }],
  },
});
