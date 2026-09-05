/* The hairpin at 22:45. The forest path spits her out onto the asphalt; the bus went hours ago and the phone is
   somewhere back under the spruces. Two headlights will come up the valley. The first one always goes by and the
   second one always stops — the only thing she decides is where it stops, by where she stands and how she signals.
   Coordinates read off the 150°×84° grid of 16-hairpin (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84, W×H = 1280×720). */
import { all, any, flag, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";

const STANCE = "hairpin.stance";        // "center" | "rail" | "shadow"
const SIGNAL = "hairpin.signal";        // "wave" | "shout" | "lamp"
const CARS = "hairpin.cars";            // 0, 1, 2 — never three (policy invariant)
const WAVED = "hairpin.waved";
const LEFT = "hairpin.leftBehind";
const PHASE = "hairpin.phase";          // "arrive" | "one" | "gap" | "two" | "stopped"
const STOP = "hairpin.stopAt";          // "front" | "near" | "far"

/* Painted places. */
const BEND: Transform = { yaw: 2, pitch: -24 };                    // asphalt inside the crook, under the yellow line (657, 566)
const RAIL: Transform = { yaw: 40, pitch: -18 };                   // the guardrail and its red reflectors (981, 514)
const SHADOW: Transform = { yaw: -52, pitch: -13 };                // the mossy verge in the trees' shadow, road edge (196, 471)
const BRANCH: Transform = { yaw: -40, pitch: -10 };                // the dead branches lying on the gravel apron (300, 447)
const SIGN: Transform = { yaw: -12.5, pitch: -6.4 };               // the wooden chevron board (533, 415)
const PLATE: Transform = { yaw: -11.7, pitch: -14.2 };             // the small blue plate under it (540, 482)
const VILLAGE: Transform = { yaw: 37, pitch: -8.4, distance: 40 }; // the lit church and the houses on the valley floor (958, 432)
const SKY: Transform = { yaw: 10, pitch: 29, distance: 60 };       // the milky way over the pass (730, 110)
const FAR_ROAD: Transform = { yaw: 7, pitch: -10.5, distance: 16 };// where the road comes round the far bend (700, 450)
const STOPPED: Transform = { yaw: 12, pitch: -18, distance: 9 };   // a car halted on the crook, wheels on (742, 581)
const DOOR: Transform = { yaw: 10, pitch: -15, distance: 9 };      // its near window, once it is standing there
const TAIL_NEAR: Transform = { yaw: 43, pitch: -24, distance: 14 };  // asphalt inside the guardrail, a dozen paces on (1007, 566)
const TAIL_FAR: Transform = { yaw: 29, pitch: -20.5, distance: 22 }; // where the road narrows past the reflectors (887, 536)
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };               // story actions: E-key prompts, never drawn on the painting

const carComing = any(flag(PHASE, { eq: "one" }), flag(PHASE, { eq: "two" }));
const tailAt = (w: World): Transform => (w.flag<string>(STOP, "far") === "near" ? TAIL_NEAR : TAIL_FAR);

export default defineScene({
  id: "hairpin",
  day: 1, place: "盘山公路 · 急转弯", elevation: "1,700 m",
  painting: "pano/16-hairpin.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "night" },
  chapter: { eyebrow: "谷底", title: "最原始的方式" },
  arriveAt: 22 * 60 + 45,
  exitWhen: all(flag(WAVED), flag(CARS, { gte: 2 }), not(flag(LEFT))),
  entities: [
    /* Where to stand. Three painted places: the crook of the asphalt, the guardrail, the shadow under the spruces. */
    { id: "stance-center", transform: BEND, className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "弯心的柏油", reveal: 16, cost: { minutes: 1 } },
      visible: not(flag(STANCE, { eq: "center" })) },
    { id: "stance-rail", transform: RAIL, className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "护栏外侧", reveal: 14, cost: { minutes: 1 } },
      visible: not(flag(STANCE, { eq: "rail" })) },
    { id: "stance-shadow", transform: SHADOW, className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "树影里", reveal: 14, cost: { minutes: 1 } },
      visible: not(flag(STANCE, { eq: "shadow" })) },

    /* What there is to find here. None of it is required and nothing on screen says it exists. */
    { id: "bus-plate", transform: PLATE, className: "counter-hotspot",
      interactable: { verbs: ["read"], label: "蓝色小牌", reveal: 12, cost: { minutes: 0 } },
      readable: { kind: "timetable", title: "站牌", lines: ["472", "Passo Sella — Canazei"], entry: "E-472", minutes: 1 } },
    { id: "bend-sign", transform: SIGN,
      interactable: { verbs: ["inspect"], label: "弯道指示牌", reveal: 13, cost: { minutes: 1 } } },
    { id: "village-lights", transform: VILLAGE,
      interactable: { verbs: ["inspect"], label: "谷底的灯", reveal: 13, cost: { minutes: 1 } } },
    { id: "milky-way", transform: SKY,
      interactable: { verbs: ["inspect"], label: "天上那条带子", reveal: 13, cost: { minutes: 1 } } },
    { id: "branches", transform: BRANCH,
      interactable: { verbs: ["inspect"], label: "路上的断枝", reveal: 12, cost: { minutes: 1 } } },
    /* The cars. Sprites are drawn on the painting whatever she is looking at; the things she can do about them
       are separate hotspots, so a car braking in front of her never fades out because her eyes went elsewhere. */
    { id: "headlights", transform: FAR_ROAD,
      sprite: { src: "sprites/car-passing.webp", layer: "prop", sizeVh: 5 },
      gaze: { radius: 14, dwell: 600 },
      visible: carComing },
    { id: "taillights", transform: tailAt,
      sprite: { src: "sprites/taillights-far.webp", layer: "prop", sizeVh: 4 },
      visible: flag(LEFT) },
    { id: "run-after", transform: tailAt, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "那两点红色", reveal: 20 },
      hold: { ms: 2600, scaleWith: ["fatigue"] },
      visible: flag(LEFT) },
    { id: "stopped-car", transform: STOPPED,
      sprite: { src: "sprites/car-stopped.webp", layer: "figure", sizeVh: 26 },
      visible: flag(STOP, { eq: "front" }) },
    { id: "go", transform: DOOR, className: "go-hotspot", tags: ["exit"],
      interactable: { verbs: ["inspect"], label: "上车", reveal: 24 },
      exit: { to: "car", kind: "walk", label: "上车", minutes: 25 } },

    /* How to signal. Three things a person does on a dark road; all three are hers to pick, in any order, any number of times. */
    { id: "signal-wave", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["wave"], label: "挥手", reveal: 0, cost: { minutes: 0 } },
      visible: not(flag(CARS, { gte: 2 })) },
    { id: "signal-shout", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["talk"], label: "喊 help", reveal: 0, cost: { minutes: 0, fatigue: 0.02 } },
      visible: not(flag(CARS, { gte: 2 })) },
    { id: "signal-lamp", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["use"], label: "把补光灯举起来", reveal: 0, cost: { minutes: 0, lamp: 0.02 }, requires: has("fillLight") },
      visible: not(flag(CARS, { gte: 2 })) },
  ],

  seed: (w) => {
    w.setFlag(STANCE, "center"); w.setFlag(SIGNAL, "lamp");
    w.setFlag(WAVED, true); w.setFlag(CARS, 2);
    w.setFlag(LEFT, false); w.setFlag(STOP, "front"); w.setFlag(PHASE, "stopped");
  },

  script: (ctx) => {
    const w = ctx.world;
    const phase = () => ctx.flag<string>(PHASE, "arrive");

    /* Headlights come up the valley whenever a minute goes by on this road: standing still counts, so does anything
       she does. Never a timer — every minute here was spent by the player. The lights then sit there and wait. */
    const summon = () => {
      const here = phase();
      if (here === "arrive") ctx.setFlag(PHASE, "one");
      else if (here === "gap" && ctx.flag(WAVED, false)) ctx.setFlag(PHASE, "two");
      else return;
      ctx.sfx("tick", 0.5, 0.35);
      ctx.kick("glance", 0.35, { yaw: 8, pitch: -6 });
      w.emit("ambience", { overrides: { engine: 0.16 } });
    };
    ctx.onWait(() => summon());
    ctx.on("clock:advance", () => summon());

    /* The first car. It always goes by: the beam crosses the trunks, the tyres change note, and the road is empty again. */
    const pass = () => {
      ctx.setFlag(CARS, 1);
      ctx.sfx("slide", -0.7, 0.9);
      ctx.kick("turn", 1.1, { yaw: 24, pitch: -2 });
      ctx.fx("flashlight", 0.9);
      ctx.after(700, () => {
        ctx.sfx("slide", 0.8, 0.5);
        ctx.kick("glance", 0.45, { yaw: 32, pitch: -8 });
        w.emit("ambience", { overrides: {} });
      });
      ctx.spend({ minutes: 1 }, "第一辆车过去了");
      ctx.setFlag(PHASE, "gap");
      ctx.say("它没有停。", { tag: "hairpin-first" });
    };

    /* The second car. It always stops. Where it stops is the whole decision: the crook plus the raised lamp puts it
       on the brakes in front of her; the shadow and a hand puts it forty metres down the road. */
    const halt = () => {
      ctx.setFlag(CARS, 2);
      ctx.setFlag(PHASE, "stopped");
      const stance = ctx.flag<string>(STANCE, "");
      const signal = ctx.flag<string>(SIGNAL, "");
      const score = (stance === "center" ? 2 : stance === "rail" ? 1 : 0) + (signal === "lamp" ? 2 : signal === "shout" ? 1 : 0);
      const where = score >= 4 ? "front" : score >= 2 ? "near" : "far";
      ctx.setFlag(STOP, where);
      ctx.sfx("brake", 0, 1);
      ctx.kick("brake", 1.3);
      ctx.fx("brake", 1);
      if (where === "front") {
        w.emit("ambience", { overrides: { engine: 0.3 } });
        ctx.after(600, () => { ctx.sfx("doorOpen", 0.2, 0.55); ctx.kick("settle", 0.5); });
        ctx.spend({ minutes: 1 }, "它停在面前");
        ctx.say("车窗降下来了。", { tag: "hairpin-stop" });
      } else {
        ctx.setFlag(LEFT, true);
        w.emit("ambience", { overrides: { engine: 0.1 } });
        ctx.after(600, () => { ctx.sfx("slide", 0.7, 0.5); ctx.kick("glance", 0.5, { yaw: 30, pitch: -8 }); });
        ctx.spend({ minutes: 1 }, "它从身边过去了");
        ctx.say("它在前面停下了。", { tag: "hairpin-past" });
      }
    };

    /* Both beats belong to the car, and the car answers two things: her eyes on it, or her hand in the air. */
    const resolve = () => {
      const here = phase();
      if (here === "one") pass();
      else if (here === "two") halt();
    };
    ctx.onGaze("headlights", () => resolve());

    /* Standing somewhere. Feet on asphalt, on gravel, on grass — three different sounds, three different distances. */
    const stand = (id: string, value: string, pan: number, strength: number) => ctx.onInteract(id, () => {
      ctx.setFlag(STANCE, value);
      ctx.sfx("step", pan, strength);
      ctx.sfx("step", pan, strength * 0.8);
      ctx.kick("step", 0.75, { yaw: pan * 12, pitch: -3 });
    });
    stand("stance-center", "center", 0, 1);
    stand("stance-rail", "rail", 0.6, 0.7);
    stand("stance-shadow", "shadow", -0.7, 0.55);

    /* Signalling. The most primitive way there is. */
    const signal = (kind: "wave" | "shout" | "lamp", body: () => void) => ctx.onInteract(`signal-${kind}`, () => {
      const first = !ctx.flag(WAVED, false);
      ctx.setFlag(SIGNAL, kind);
      ctx.setFlag(WAVED, true);
      body();
      if (first) ctx.say("所以我采用了最原始的方式。", { tag: "hairpin-primitive" });
      resolve();
    });
    signal("wave", () => {
      ctx.hand({ yaw: 4, pitch: -4 }, "grip");
      ctx.sfx("cloth", 0, 0.85);
      ctx.kick("turn", 0.5, { yaw: 6, pitch: 2 });
    });
    signal("shout", () => {
      ctx.fx("shout", 1);
      ctx.kick("shout", 1.1);
      ctx.sfx("breath", 0, 0.9);
    });
    signal("lamp", () => {
      ctx.hand({ yaw: 2, pitch: 6 }, "grip", true);
      ctx.fx("flashlight", 1.3);
      ctx.sfx("clink", 0, 0.5);
      ctx.kick("pull", 0.7, { yaw: 0, pitch: 5 });
    });

    /* Left behind: ten hours in, thirty seconds of running after two red points. It is never a failure, only a price. */
    ctx.onHold("run-after", () => {
      const far = ctx.flag<string>(STOP, "far") === "far";
      ctx.setFlag(LEFT, false);
      ctx.setFlag(STOP, "front");
      ctx.spend({ minutes: far ? 3 : 1, fatigue: far ? 0.06 : 0.02 }, "跑过去追那两点红色");
      w.emit("body:rest", { seconds: 4 });
      w.emit("ambience", { overrides: { engine: 0.3 } });
      ctx.sfx("exhale", 0, 0.95);
      ctx.kick("land", 1.0);
      ctx.say("追上了。", { tag: "hairpin-caught" });
    });
    ctx.onRelease("run-after", (progress) => {
      if (progress < 0.15) return;
      ctx.kick("settle", 0.6);
      ctx.sfx("breath", 0, 0.85);
    });

    /* Everything else on this bend is optional and silent. */
    ctx.onInteract("bus-plate", () => {
      ctx.hand(PLATE, "grip");
      ctx.kick("glance", 0.45, { yaw: -2, pitch: -4 });
      ctx.say("公交早没了。手机也掉了。", { tag: "hairpin-bus" });
    });
    ctx.onInteract("bend-sign", () => {
      ctx.kick("glance", 0.5, { yaw: -4, pitch: 3 });
      ctx.sfx("tock", -0.3, 0.5);
      ctx.entity("bend-sign").set("lit", true);
    });
    ctx.onInteract("village-lights", () => {
      ctx.kick("glance", 0.6, { yaw: 8, pitch: -3 });
      ctx.sfx("breath", 0.4, 0.55);
      ctx.say("下面有一点点光。", { tag: "hairpin-village" });
    });
    ctx.onInteract("milky-way", () => {
      ctx.kick("settle", 0.7, { yaw: 0, pitch: 6 });
      ctx.sfx("exhale", 0, 0.6);
      w.emit("body:rest", { seconds: 4 });
      w.emit("ambience", { overrides: { wind: 0.14, crickets: 0.35 } });
    });
    ctx.onInteract("branches", () => {
      ctx.hand({ yaw: -34, pitch: -14 }, "grip");
      ctx.sfx("thud", -0.5, 0.45);
      ctx.kick("glance", 0.4, { yaw: -8, pitch: -6 });
    });

    /* Standing still on the asphalt: the road ticks as it gives back the day's heat, and the crickets come back up. */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      ctx.kick("settle", 0.22);
      if (stills % 2 === 0) ctx.sfx("tick", -0.2, 0.25);
    });
  },

  /* Fastest legal way through: stand in the crook, raise the lamp at the first car, stand a moment, raise it again. */
  walkthrough: [
    { type: "interact", entity: "stance-center", verb: "step" }, { wait: 400 },
    { type: "interact", entity: "signal-lamp", verb: "use" }, { wait: 500 },
    { type: "wait" }, { wait: 400 },
    { type: "interact", entity: "signal-lamp", verb: "use" }, { wait: 500 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    /* The shadow and a bare hand: it goes past her and stops forty metres down, and she runs after it. */
    left: [
      { type: "interact", entity: "stance-shadow", verb: "step" }, { wait: 400 },
      { type: "interact", entity: "signal-wave", verb: "wave" }, { wait: 500 },
      { type: "wait" }, { wait: 400 },
      { type: "interact", entity: "signal-wave", verb: "wave" }, { wait: 500 },
      { type: "hold:start", entity: "run-after" }, { wait: 7000 }, { type: "hold:end" }, { wait: 500 },
      { type: "travel", entity: "go" },
    ],
    /* Everything the bend has: the branches, the plate, the chevron, the valley, the sky,
       both other places to stand, and all three ways of signalling before the second pair of lights comes up. */
    thorough: [
      { type: "interact", entity: "branches", verb: "inspect" }, { wait: 1200 },
      { type: "interact", entity: "bus-plate", verb: "read" }, { wait: 400 },
      { type: "overlay:close" }, { wait: 300 },
      { type: "interact", entity: "bend-sign", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "village-lights", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "milky-way", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "stance-rail", verb: "step" }, { wait: 300 },
      { type: "interact", entity: "stance-center", verb: "step" }, { wait: 300 },
      { type: "interact", entity: "signal-wave", verb: "wave" }, { wait: 300 },
      { type: "interact", entity: "signal-shout", verb: "talk" }, { wait: 300 },
      { type: "interact", entity: "signal-lamp", verb: "use" }, { wait: 300 },
      { type: "wait" }, { wait: 1200 },
      { type: "interact", entity: "signal-lamp", verb: "use" }, { wait: 500 },
      { type: "travel", entity: "go" },
    ],
  },
});
