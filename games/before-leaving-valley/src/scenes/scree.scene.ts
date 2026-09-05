/* Val Lasties, 17:40. The huge grey-white scree slope of the account: she ran down it staring at her feet while the
   cloud and the last of the sun left her. One painting, six steps, and at every step the same question the slope
   really asks — the wide flat shelves on the left (slow, steady), the fine sand under the thin trail (fast, and one
   run in three carries you), or the heap of big blocks on the right (safe, and off the line). The only place in the
   game where one picture holds the sun, the wall and how much slope is left: she has to choose to look up for it.
   Every coordinate was read off the 150°×84° grid of 11-scree (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { after, before, flag } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, lookAt, prop, wrongWay } from "./_shared";

const STEP = "scree.step";
const TOTAL = 6;
const SUNSET = 20 * 60 + 15;          // ClockSystem's sunset mark
const STAR_MINUTE = 20 * 60 + 30;     // v4 §8: the first star, after half past eight
const HALFWAY = 3;                    // v4 §8: the look back at the whole wall comes at half way
const TO_DEER = 80;                   // v4 §3.1: the hundred minutes of this node minus the six steps themselves
const LOST_MINUTES = 12;              // v4 §3.5: no confirmed mark on scree costs twelve
const GULLY_MINUTES = 14;             // the sand runnel straight down the fall line (v4 §9: screeGully, folded into the node)

/* The six wide flat shelves of the painted stone band, far end first, and the single flat stone lying at her feet. */
const FLAT: Transform[] = [
  { yaw: 2.9, pitch: -2.1, distance: 13 },    // the farthest shelf of the band (665, 378)
  { yaw: -1.2, pitch: -4.2, distance: 12 },   // the next shelf down-left (630, 396)
  { yaw: -11.1, pitch: -6.5, distance: 12 },  // (545, 416)
  { yaw: -24, pitch: -9.6, distance: 11 },    // (435, 442)
  { yaw: -39.8, pitch: -12.4, distance: 10 }, // (300, 466)
  { yaw: -0.3, pitch: -35.2, distance: 8 },   // the single flat stone lying on the sand at her feet (638, 662)
];
/* The thin trail worn into the fine sand, from where it appears out of the slope down to where it leaves the picture. */
const SAND: Transform[] = [
  { yaw: 13.1, pitch: -9, distance: 13 },     // (752, 437)
  { yaw: 5.6, pitch: -15.4, distance: 12 },   // (688, 492)
  { yaw: 3.5, pitch: -20.8, distance: 11 },   // (670, 538)
  { yaw: 7.6, pitch: -26.3, distance: 10 },   // (705, 585)
  { yaw: 13.5, pitch: -30.9, distance: 9 },   // (755, 625)
  { yaw: 18.1, pitch: -34.4, distance: 9 },   // (795, 655)
];
/* The heap of big blocks off to the right of the trail: stable, and every one of them away from the line. */
const BLOCK: Transform[] = [
  { yaw: 26, pitch: -16.6, distance: 13 },    // the flat-topped block on top of the heap (862, 502)
  { yaw: 20.8, pitch: -21.9, distance: 12 },  // (818, 548)
  { yaw: 29.9, pitch: -23.1, distance: 11 },  // (895, 558)
  { yaw: 37.3, pitch: -27.5, distance: 11 },  // (958, 596)
  { yaw: 31, pitch: -31.5, distance: 10 },    // (905, 630)
  { yaw: 40.4, pitch: -33.3, distance: 10 },  // (985, 645)
];

const TRAIL_OUT: Transform = { yaw: 24, pitch: -38.7, distance: 9 };     // where the trail leaves the bottom of the picture (845, 692)
const BOULDER_MARK: Transform = { yaw: -19.9, pitch: -21.9 };            // the top stone of the rubble heap in the middle of the slope (470, 548)
const SLAB_MARK: Transform = { yaw: -55.1, pitch: -13.8 };               // the face of the big near shelf at the left end of the band (170, 478)
const FAR_ROCK_MARK: Transform = { yaw: 52.7, pitch: -12.8, distance: 16 }; // the grey terrace across the gully (1090, 470)
const CLOUDS: Transform = { yaw: 38, pitch: 28, distance: 16 };          // the peach cloud bank over the right-hand sky (964, 120)
const SUN: Transform = { yaw: 50, pitch: 16, distance: 16 };             // the warm band of sky low over the right terraces (1067, 231)
const WALL_BACK: Transform = { yaw: -55.1, pitch: 25.1, distance: 16 };  // the grey towers filling the left edge, above and behind her (170, 145)
const STAR: Transform = { yaw: -29.3, pitch: 36.2, distance: 16 };       // the blue gap of sky between the towers and the massif (390, 50)
const GREEN: Transform = { yaw: 35.2, pitch: -4.7, distance: 16 };       // the layered rock terraces across the gully, grass on their tops (940, 400)
const GULLY: Transform = { yaw: -36.3, pitch: -30.1, distance: 10 };     // the sand runnel between the shelves and the rubble (330, 618)

const stepOf = (w: World) => Math.min(w.flag<number>(STEP, 0), TOTAL - 1);
const pan = (t: Transform) => Math.max(-1, Math.min(1, t.yaw / 45));

const run = (entity: "flat-stone" | "sand-run" | "block-detour"): WalkStep[] =>
  Array.from({ length: TOTAL }, () => [{ type: "interact" as const, entity, verb: "step" as const }, { wait: 220 }]).flat();

export default defineScene({
  id: "scree",
  day: 1, place: "Val Lasties · 碎石坡", elevation: "2,300 m",
  painting: "pano/11-scree.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.7, windTone: 1250, birds: 0.15, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "grit", gusty: true, windPan: 0.3 },
  arriveAt: 17 * 60 + 40,
  fallback: "一直盯着脚下。",
  exitWhen: flag(STEP, { gte: TOTAL }),
  entities: [
    // The three footings. Only one of each exists at a time; each sits on the thing it is named after.
    { id: "flat-stone", transform: (w) => FLAT[stepOf(w)], className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "平石", reveal: 14, cost: { minutes: 4, fatigue: 0.01 } },
      visible: flag(STEP, { lt: TOTAL }) },
    { id: "sand-run", transform: (w) => SAND[stepOf(w)], className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "细沙", reveal: 14, cost: { fatigue: 0.02 } },
      visible: flag(STEP, { lt: TOTAL }) },
    { id: "block-detour", transform: (w) => BLOCK[stepOf(w)], className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "大石块", reveal: 14, cost: { minutes: 3, fatigue: 0.03 } },
      visible: flag(STEP, { lt: TOTAL }) },
    // Three candidate marks (v4 §3.5): paint on the middle boulder, lichen on the near shelf, an old bar on the far terrace.
    blaze("blaze-scree", BOULDER_MARK, true),
    blaze("lichen-scree", SLAB_MARK, false),
    blaze("rust-scree", FAR_ROCK_MARK, false, { sprite: { src: "sprites/blaze-false.webp", layer: "prop", sizeVh: 2.5 } }),
    // Looking up: the one picture in the game with the sun, the wall and how much slope is left in it (v4 §6).
    lookAt("sunset-clouds", CLOUDS, "夕阳的云", 2, { interactable: { verbs: ["inspect", "photograph"], label: "夕阳的云", reveal: 16, cost: { minutes: 2 } } }),
    // Half way down, the whole wall is behind and above her.
    lookAt("wall-back", WALL_BACK, "身后那面石墙", 2, { visible: flag(STEP, { gte: HALFWAY }), interactable: { verbs: ["inspect", "photograph"], label: "身后那面石墙", reveal: 16, cost: { minutes: 2 } } }),
    // How much is left: the layered terraces across the gully, stepping down into the valley.
    lookAt("green-terraces", GREEN, "对面的岩台", 1),
    // The low sun burns out of the sky at 20:15; after half past eight one star stands in the gap over the massif.
    prop("sun-low", SUN, "sprites/sun-low.webp", 9, { visible: before(SUNSET) }),
    { id: "first-star", transform: STAR, sprite: { src: "sprites/first-star.webp", layer: "back", sizeVh: 2.5 },
      gaze: { radius: 12, dwell: 900 }, visible: after(STAR_MINUTE) },
    // Straight down the fall line: the sand runnel between the shelves and the rubble. It cliffs out; she comes back.
    wrongWay("scree-gully", GULLY, "石头中间那条沙沟", GULLY_MINUTES, "下面接不上。"),
    goArrow("go", TRAIL_OUT, { to: "deer", minutes: TO_DEER, label: "往下的小径", kind: "run" }),
  ],
  seed: (w) => {
    w.setFlag(STEP, TOTAL);
    w.setFlag("scree.certain", true);
    w.setFlag("scree.lookedUp", true);
    for (let i = 0; i < TOTAL; i += 1) w.setFlag(`scree.style.${i}`, i < 4 ? "sand" : "flat");
  },
  script: (ctx) => {
    const w = ctx.world;
    const step = () => ctx.flag<number>(STEP, 0);
    const FALSE_MARK_LINES: Record<string, string> = { "lichen-scree": "地衣。不是漆。", "rust-scree": "旧漆。不是这条路的。" };

    /* One step down. The clock and the hands are settled by the footing's own cost; the sand settles its own minutes
       because a run that carries her is worth one and a run that goes costs six. */
    const land = (style: "flat" | "sand" | "block", where: Transform) => {
      const here = step();
      if (here >= TOTAL) return;
      const next = here + 1;
      ctx.setFlag(`scree.style.${here}`, style);
      ctx.setFlag(STEP, next);
      ctx.hand(where, "grip");
      if (next >= TOTAL) { w.emit("body:rest", { seconds: 3 }); ctx.sfx("exhale", 0, 0.7); ctx.kick("settle", 1); }
    };

    ctx.onInteract("flat-stone", () => {
      const where = FLAT[stepOf(w)];
      ctx.sfx("step", pan(where), 0.9); ctx.kick("step", 0.8, { yaw: 0, pitch: -3 });
      land("flat", where);
    });

    ctx.onInteract("block-detour", () => {
      const where = BLOCK[stepOf(w)];
      ctx.bump("scree.blocks", 1);
      ctx.sfx("thud", pan(where), 0.7); ctx.kick("land", 0.9, { yaw: 0, pitch: -4 }); ctx.sfx("grip", pan(where), 0.4);
      land("block", where);
    });

    ctx.onInteract("sand-run", () => {
      const where = SAND[stepOf(w)];
      const loose = w.rt.rng() < 1 / 3;
      const control = w.rt.rng() > Math.max(0, Math.min(0.35, (w.state.body.fatigue - 0.35) * 0.9));
      if (loose && control) {
        // The slope takes her weight and carries her: the one time in this game that fast is right.
        ctx.spend({ minutes: 1 }, "跑沙");
        ctx.sfx("slide", pan(where), 0.9); ctx.kick("slip", 1.1, { yaw: 0, pitch: -9 }); ctx.fx("dust", 1);
        if (ctx.bump("scree.slides", 1) === 1) ctx.say("沙自己带着我往下走。", { tag: "scree-slide" });
      } else if (loose) {
        // Tired legs, and the whole panel of sand goes with her (v4 §8: −4 minutes, and it is not a fork).
        ctx.spend({ minutes: 6 }, "细沙滑了一下");
        w.emit("body:slip", { entity: "sand-run", severity: 0.8 });
        ctx.sfx("slide", pan(where), 1.2); ctx.sfx("thud", pan(where), 0.6);
        ctx.kick("slip", 1.5, { yaw: 0, pitch: -14 }); ctx.fx("dust", 1.3);
        ctx.say("脚下整片沙走了。", { tag: "scree-slip", priority: 1 });
      } else {
        ctx.spend({ minutes: 2 }, "跑沙");
        ctx.sfx("step", pan(where), 1); ctx.kick("step", 1, { yaw: 0, pitch: -5 }); ctx.fx("dust", 0.5);
      }
      land("sand", where);
    });

    /* Looking up. Two minutes, and before sunset it is still coloured; after it there is nothing up there to spend
       two minutes on. Photographing it is the phone's business, not hers. */
    ctx.onInteract("sunset-clouds", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.kick("glance", 0.4, { yaw: 2, pitch: 6 }); ctx.setFlag("scree.photo", true); return; }
      const lit = ctx.minute() < SUNSET;
      ctx.setFlag("scree.lookedUp", true); ctx.bump("scree.lookUps", 1);
      ctx.kick("glance", 0.8, { yaw: 3, pitch: 9 }); ctx.sfx("breath", 0.4, 0.6);
      if (!lit) ctx.fx("gust", 0.4);
      ctx.say(lit ? "云和最后的夕阳都在离我而去。" : "颜色已经没有了。", { tag: "scree-up" });
    });

    ctx.onInteract("wall-back", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.kick("turn", 0.5, { yaw: -6, pitch: 4 }); return; }
      ctx.setFlag("scree.lookedBack", true);
      ctx.kick("turn", 0.9, { yaw: -8, pitch: 5 }); ctx.sfx("exhale", -0.5, 0.7); ctx.fx("gust", 0.3);
      ctx.say("刚才还在那上面。", { tag: "scree-back" });
    });

    ctx.onInteract("green-terraces", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.kick("glance", 0.3, { yaw: 4, pitch: -1 }); return; }
      ctx.setFlag("scree.sawGreen", true);
      ctx.kick("glance", 0.6, { yaw: 5, pitch: -2 }); ctx.sfx("breath", 0.6, 0.5);
    });

    /* The star: it is only there after half past eight, and only for someone who looks up at that gap. */
    ctx.onGaze("first-star", () => {
      if (ctx.flag("scree.star", false)) return;
      ctx.setFlag("scree.star", true);
      ctx.kick("glance", 0.4, { yaw: -2, pitch: 7 }); ctx.sfx("breath", -0.2, 0.4);
      ctx.say("第一颗星。", { tag: "scree-star" });
    });

    /* The marks. A real one is settled by the journal (her hand, cloth on stone); a false one costs the minute. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("glance", 0.5, { yaw: 0, pitch: -4 }); ctx.fx("dust", 0.2); return; }
      const line = FALSE_MARK_LINES[entity];
      if (!line) return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.4, { yaw: 0, pitch: -3 });
      ctx.say(line, { tag: `scree-${entity}` });
    });

    /* Straight down the runnel between the shelves and the rubble. Fourteen minutes, a lot of dust, and it cliffs out. */
    ctx.onInteract("scree-gully", () => {
      ctx.setFlag("scree.gully", true);
      w.emit("body:fatigue", { delta: 0.06, reason: "沙沟里下了一段又爬回来" });
      ctx.kick("slip", 1.2, { yaw: -4, pitch: -10 }); ctx.sfx("slide", -0.6, 1); ctx.fx("dust", 1.2);
      ctx.after(700, () => { ctx.kick("settle", 0.7); ctx.sfx("step", -0.4, 0.7); });
      ctx.say("下面接不上。", { tag: "scree-gully" });
    });

    /* Eating the bar here: the body does the arithmetic, the scene only makes the sound of the foil. */
    ctx.on("item:use", ({ item }) => {
      if (item !== "chocolate") return;
      ctx.sfx("cloth", 0, 0.8); ctx.kick("settle", 0.6); w.emit("body:rest", { seconds: 4 });
    });

    /* Standing still on a slope like this: the boots settle, and every third breath something small rolls away below. */
    let stills = 0;
    ctx.onWait(() => {
      if (w.state.ui.travel) return;
      stills += 1;
      ctx.kick("settle", 0.25);
      if (stills % 3 === 0) { ctx.sfx("slide", 0.2, 0.35); ctx.fx("dust", 0.25); }
    });

    /* The day passing over her while she is on the slope. None of it is a line; all of it is the world moving. */
    ctx.onMark("crickets-in", () => { w.emit("ambience", { overrides: { crickets: 0.22 } }); ctx.kick("settle", 0.2); });
    ctx.onMark("wind-turns", () => {
      w.emit("ambience", { overrides: { wind: 0.85, windTone: 1050 } });
      ctx.fx("gust", 0.9); ctx.kick("turn", 0.7, { yaw: -5, pitch: 0 }); ctx.sfx("cloth", -0.4, 0.5);
    });
    ctx.onMark("sunset", () => {
      w.emit("ambience", { overrides: { birds: 0, wind: 0.6 } });
      ctx.sfx("exhale", 0, 0.6); ctx.kick("settle", 0.5); ctx.setFlag("scree.sunsetHere", true);
    });

    /* Leaving without having settled a mark: twelve minutes of finding the line again (v4 §3.5). Never a lock. */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "scree" || to !== "deer" || ctx.flag("scree.certain", false)) return;
      ctx.spend({ minutes: LOST_MINUTES }, "没认记号，找了一段路");
      ctx.kick("turn", 0.5); ctx.fx("dust", 0.4);
      ctx.say("走错了一小段。", { tag: "scree-lost", priority: 1 });
    });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-scree", verb: "inspect" }, { wait: 300 },
    ...run("sand-run"),
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Every step on the stone shelves: four minutes each, nothing on the hands, and the tree line in the dark.
    stone: [
      { type: "interact", entity: "blaze-scree", verb: "inspect" }, { wait: 300 },
      ...run("flat-stone"),
      { type: "travel", entity: "go" },
    ],
    // Round every step on the big blocks: safe, three minutes each, and off the line the whole way.
    blocks: [
      { type: "interact", entity: "blaze-scree", verb: "inspect" }, { wait: 300 },
      ...run("block-detour"),
      { type: "travel", entity: "go" },
    ],
    // Straight down the runnel first (fourteen minutes and a lot of dust), then the sand.
    detour: [
      { type: "interact", entity: "scree-gully", verb: "inspect" }, { wait: 1200 },
      { type: "interact", entity: "blaze-scree", verb: "inspect" }, { wait: 300 },
      ...run("sand-run"),
      { type: "travel", entity: "go" },
    ],
    // Down without settling a single mark: twelve minutes of looking for the line on the way out.
    blind: [...run("sand-run"), { type: "travel", entity: "go" }],
    // Everything the slope offers: both false marks, the real one, the look up, the valley, the look back, mixed footing.
    thorough: [
      { type: "interact", entity: "lichen-scree", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "sunset-clouds", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "sunset-clouds", verb: "photograph" }, { wait: 300 },
      { type: "interact", entity: "flat-stone", verb: "step" }, { wait: 250 },
      { type: "interact", entity: "sand-run", verb: "step" }, { wait: 250 },
      { type: "interact", entity: "rust-scree", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "block-detour", verb: "step" }, { wait: 250 },
      { type: "interact", entity: "wall-back", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "green-terraces", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-scree", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "sand-run", verb: "step" }, { wait: 250 },
      { type: "interact", entity: "flat-stone", verb: "step" }, { wait: 250 },
      { type: "interact", entity: "sand-run", verb: "step" }, { wait: 250 },
      { type: "travel", entity: "go" },
    ],
  },
});
