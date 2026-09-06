/* The hairpin at 22:45. The forest path spits her out onto the asphalt; the bus went hours ago and the phone is
   somewhere back under the spruces. Two headlights will come up the valley. The first one always goes by and the
   second one always stops — the only thing she decides is where it stops, by where she stands and how she signals.
   Coordinates read off the 150°×84° grid of 16-hairpin (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84, W×H = 1280×720).

   Two things about this scene are workarounds for the engine, not design intent, and both are in the report's
   `requests`: (1) the three ways of signalling are one E button that hands itself on (挥手 → 喊 help → 举补光灯 →
   挥手) because `.story-action` is pinned to a single slot (pano.css:127) and `Actions.tsx` sends E to the first
   node it finds — with three slots this goes back to three buttons under E/1/2/3, and 怎么示意 becomes a choice
   again instead of a place in a rotation; (2) 护栏边的柏油 is the strip of asphalt hard against the guardrail posts,
   where §7 says 护栏外侧 — beyond the posts this painting has nothing but the drop into the valley, so the anchor
   moved to the only painted footing there is. */
import { all, any, flag, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import { prop } from "./_shared";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";

const STANCE = "hairpin.stance";        // "center" | "rail" | "shadow"
const SIGNAL = "hairpin.signal";        // "wave" | "shout" | "lamp" — the last thing she did with her body
const NEXT = "hairpin.nextSignal";      // which of the three the single E-key action will do next
const CARS = "hairpin.cars";            // 0, 1, 2 — never three (policy invariant)
const WAVED = "hairpin.waved";
const LEFT = "hairpin.leftBehind";
const PHASE = "hairpin.phase";          // "arrive" | "one" | "gap" | "two" | "stopped"
const STOP = "hairpin.stopAt";          // "front" | "near" | "far"

/* Painted places. Read off the grid: x = yaw·8.5333 + 640, y = 360 − pitch·8.5714. */
const BEND: Transform = { yaw: 5, pitch: -26 };                    // asphalt inside the crook, clear of the lit gravel apron (683, 583)
const RAIL: Transform = { yaw: 38, pitch: -24 };                   // the asphalt at the foot of the guardrail posts (964, 566)
const SHADOW: Transform = { yaw: -52, pitch: -13 };                // the mossy verge in the trees' shadow, road edge (196, 471)
const BRANCH: Transform = { yaw: -40, pitch: -10 };                // the dead branches lying on the gravel apron (300, 447)
const PLATE: Transform = { yaw: -11.7, pitch: -14.2 };             // the small blue plate under the chevron board (540, 482)
const VILLAGE: Transform = { yaw: 37, pitch: -8.4, distance: 40 }; // the lit church and the houses on the valley floor (958, 432)
const SKY: Transform = { yaw: 10, pitch: 29, distance: 60 };       // the milky way over the pass (730, 110)
const FAR_ROAD: Transform = { yaw: 8.5, pitch: -11.3, distance: 16 };// on the tarmac of the far bend, not the grass inside it (712, 457)
const STOPPED: Transform = { yaw: 12, pitch: -18, distance: 9 };   // a car halted on the crook, wheels on (742, 581)
const DOOR: Transform = { yaw: 10, pitch: -15, distance: 9 };      // its near window, once it is standing there
/* The two places it can be standing when she is left behind. Both distances stay under 16.7, where PanoStage's
   `Math.max(0.6, 10/distance)` clamp is still inactive and the sprite's on-screen height is exactly its sizeVh —
   past that the clamp stops the shrinking and the far pair renders bigger than the near one. One entity carries both:
   `transform` takes a function, so the prop and the hold are each a single entity that moves with `hairpin.stopAt`
   (the two-entity version cost the same two entities and left the far pair invisible, see the prop below). */
const TAIL_NEAR: Transform = { yaw: 22, pitch: -26, distance: 12 };  // the bend's asphalt, a dozen paces on (828, 583)
const TAIL_FAR: Transform = { yaw: 30, pitch: -22.7, distance: 16 }; // the road at the far side of the curve (896, 555)
const tailAt = (w: World): Transform => (w.flag<string>(STOP, "far") === "near" ? TAIL_NEAR : TAIL_FAR);
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };               // story actions: E-key prompts, never drawn on the painting

const carComing = any(flag(PHASE, { eq: "one" }), flag(PHASE, { eq: "two" }));
const beforeSecondStop = not(flag(CARS, { gte: 2 }));
/* "wave" is also what an unset flag means, so a fresh arrival always has exactly one button on screen. */
const nextIs = (kind: "wave" | "shout" | "lamp") =>
  kind === "wave" ? not(any(flag(NEXT, { eq: "shout" }), flag(NEXT, { eq: "lamp" }))) : flag(NEXT, { eq: kind });
const SIGNAL_ORDER: Record<string, "wave" | "shout" | "lamp"> = { wave: "shout", shout: "lamp", lamp: "wave" };

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
    // Not "outside the rail" — beyond it the painting shows only the drop into the valley. This is the strip of
    // asphalt hard against the posts, which is what the plate actually paints there.
    { id: "stance-rail", transform: RAIL, className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "护栏边的柏油", reveal: 14, cost: { minutes: 1 } },
      visible: not(flag(STANCE, { eq: "rail" })) },
    { id: "stance-shadow", transform: SHADOW, className: "foot-hotspot",
      interactable: { verbs: ["step"], label: "树影里", reveal: 14, cost: { minutes: 1 } },
      visible: not(flag(STANCE, { eq: "shadow" })) },

    /* What there is to find here. None of it is required and nothing on screen says it exists. */
    { id: "bus-plate", transform: PLATE, className: "counter-hotspot",
      interactable: { verbs: ["read"], label: "蓝色小牌", reveal: 12, cost: { minutes: 0 } },
      readable: { kind: "timetable", title: "站牌", lines: ["472", "Passo Sella — Canazei"], entry: "E-472", minutes: 1 } },
    { id: "village-lights", transform: VILLAGE,
      interactable: { verbs: ["inspect"], label: "谷底的灯", reveal: 13, cost: { minutes: 1 } } },
    { id: "milky-way", transform: SKY,
      interactable: { verbs: ["inspect"], label: "天上那条带子", reveal: 13, cost: { minutes: 1 } } },
    { id: "branches", transform: BRANCH,
      interactable: { verbs: ["inspect"], label: "路上的断枝", reveal: 12, cost: { minutes: 1 } } },
    /* The cars. Headlights come round the far bend and then sit there: the beat is hers to take, by resting her eyes
       on them (v4 §10.3 — 第一辆车 is a gaze trigger, never a timer) or by reaching for them.
       The light itself is a prop of its own, because a `sprite` inside a `Hotspot` inherits that button's reveal
       opacity (GazeSystem writes the live radius onto the node, floored at 11°, so even `reveal: 0` fades) — and a
       car coming up the valley at her is not something to be found by sweeping the beam. The hotspot on the same
       point stays reveal-gated: to take the beat she has to turn and look at it. */
    // 1.5 vh ≈ 11 px on a 720-high viewport. On a 5.6× crop of the plate that far bend's road band is ~11 plate px
    // (1.3°) and its guardrail posts ~5 plate px apart, which puts it 180 m or more away: a whole car body there is
    // about 8 px. What is coming up the valley at that range is light, so `headlights-far.webp` is briefed (two
    // headlight points with bloom, docs/ART_QUEUE.md). Until it is drawn this anchor carries `car-passing.webp` —
    // the one car in the sprite folder whose headlights are on — at 11 px, where a whole body is a lit speck on the
    // far bend. Nothing drawn at all would leave this beat with no visible cause, and the beat is the whole node.
    prop("headlight-beam", FAR_ROAD, "sprites/car-passing.webp", 1.5, { visible: carComing }),
    { id: "headlights", transform: FAR_ROAD,
      interactable: { verbs: ["inspect"], label: "上来的车灯", reveal: 22 },
      gaze: { radius: 14, dwell: 600 },
      visible: carComing },
    /* Left behind: two red points on the road and thirty seconds of running. The red itself is a prop of its own —
       a `sprite` inside a `Hotspot` inherits that button's reveal opacity, and the anchor is 40-odd degrees off the
       resting gaze, so as one entity the two points rendered at opacity 0.000 (and `pointerEvents:"none"`) until she
       happened to look straight at them. They are the whole content of this beat and the only way out of the state,
       so they are painted, not found. The hold sits on the same moving point with a wide reveal (18° of live radius
       on ten-hour legs), so the button arrives as soon as the braking has turned her head that way. */
    /* 5 vh ≈ 36 px: two tail lamps with their bloom, not a car's back end (0.2 m of lamp at 40 m is a few pixels;
       what carries at night is the glow). Both states draw the same file: `taillights-near.webp` (heavier bloom, a
       hint of the rear panel) is briefed in docs/ART_QUEUE.md, and a `swap` to a file that does not exist left the
       whole 被落下 beat — which is more than half of the ways this scene can end — with nothing on the road at all.
       The difference between 十几步 and 四十米 is carried by everything else: the anchor sits further along the road
       and higher in the frame, and `runAfter` charges three minutes instead of one. */
    { id: "taillights", transform: tailAt,
      sprite: { src: "sprites/taillights-far.webp", layer: "prop", sizeVh: 5 },
      visible: flag(LEFT) },
    { id: "tail", transform: tailAt, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "那两点红色", reveal: 45 },
      hold: { ms: 2600, scaleWith: ["fatigue"] },
      visible: flag(LEFT) },
    { id: "stopped-car", transform: STOPPED,
      sprite: { src: "sprites/car-stopped.webp", layer: "figure", sizeVh: 26 },
      visible: flag(STOP, { eq: "front" }) },
    { id: "go", transform: DOOR, className: "go-hotspot", tags: ["exit"],
      interactable: { verbs: ["inspect"], label: "上车", reveal: 24 },
      exit: { to: "car", kind: "walk", label: "上车", minutes: 25 } },

    /* How to signal. Three things a person does on a dark road, and she does one of them at a time: pressing E does
       the one on the button and moves the button on to the next, 挥手 → 喊 help → 把补光灯举起来 → 挥手. Whatever she
       did last is what the second car answers, so all three are hers to land on and none of them is a menu.
       Signalling costs no clock: what brings the next pair of lights up the valley is a minute spent on something
       real — moving her feet, reading the plate — or standing still (`onWait`), never the signal itself.
       They are one button because `.story-action` is pinned to a single slot at the bottom of the screen (pano.css
       :127, `left:50% !important`): two visible at once and they stack pixel-on-pixel, and E only ever reaches the
       first. See requests.css — with three separate slots this can go back to three buttons. */
    { id: "signal-wave", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["wave"], label: "挥手", reveal: 0, cost: { minutes: 0 } },
      visible: all(beforeSecondStop, any(nextIs("wave"), all(nextIs("lamp"), not(has("fillLight"))))) },
    { id: "signal-shout", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["talk"], label: "喊 help", reveal: 0, cost: { minutes: 0, fatigue: 0.02 } },
      visible: all(beforeSecondStop, nextIs("shout")) },
    { id: "signal-lamp", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["use"], label: "把补光灯举起来", reveal: 0, cost: { minutes: 0, lamp: 0.02 }, requires: has("fillLight") },
      visible: all(beforeSecondStop, nextIs("lamp"), has("fillLight")) },
  ],

  seed: (w) => {
    w.setFlag(STANCE, "center"); w.setFlag(SIGNAL, "lamp"); w.setFlag(NEXT, "wave");
    w.setFlag(WAVED, true); w.setFlag(CARS, 2);
    w.setFlag(LEFT, false); w.setFlag(STOP, "front"); w.setFlag(PHASE, "stopped");
  },

  script: (ctx) => {
    const w = ctx.world;
    const phase = () => ctx.flag<string>(PHASE, "arrive");
    // The ladder starts on the bare hand; the entity conditions treat "unset" as 挥手 too, this only makes it explicit.
    ctx.onEnter(() => { if (!ctx.flag<string>(NEXT, "")) ctx.setFlag(NEXT, "wave"); });

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
      ctx.spend({ minutes: 1 }, "第一辆车过去了");   // still phase "one" while this drains, so it cannot summon the second
      ctx.setFlag(PHASE, "gap");
      /* No line. She arrives here at fatigue 1, and BodySystem's adrenaline latch means DialogueSystem drops
         everything under priority 2 — so a line here is either unreachable or shouted over the gate. The beam
         across the trunks, the tyres changing note twice and the road going quiet again say it by themselves. */
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
        ctx.spend({ minutes: 1 }, "它停在面前");   // the brake, the door and an engine idling in front of her: this beat needs no sentence
      } else {
        ctx.setFlag(LEFT, true);
        const tail = where === "near" ? TAIL_NEAR : TAIL_FAR;
        w.emit("ambience", { overrides: { engine: 0.1 } });
        // The red is out at the edge of what she can see: the sound and the head turn are what take her eyes there.
        ctx.after(600, () => { ctx.sfx("slide", 0.7, 0.5); ctx.kick("glance", 0.8, { yaw: tail.yaw * 0.4, pitch: -8 }); });
        ctx.spend({ minutes: 1 }, "它从身边过去了");   // what speaks is the head turn, and two red points coming up on the road
      }
    };

    /* Both beats belong to the car, and the car answers her eyes — v4 §10.3: the headlights come round the bend and
       then wait there; nothing on a timer picks them up. Signalling never resolves them, so she is free to change
       her mind about what she is doing with her body for as long as the lights are still coming. */
    const resolve = () => {
      const here = phase();
      if (here === "one") pass();
      else if (here === "two") halt();
    };
    ctx.onGaze("headlights", () => resolve());
    ctx.onInteract("headlights", () => resolve());

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

    /* Signalling. No line goes with it: a hand, a voice and a lamp on an empty road say it themselves.
       Each one also hands the button on to the next, so the road always offers her exactly one thing to try. */
    const signal = (kind: "wave" | "shout" | "lamp", body: () => void) => ctx.onInteract(`signal-${kind}`, () => {
      ctx.setFlag(SIGNAL, kind);
      ctx.setFlag(WAVED, true);
      ctx.setFlag(NEXT, SIGNAL_ORDER[kind]);
      body();
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
    const runAfter = () => {
      const far = ctx.flag<string>(STOP, "far") === "far";
      ctx.setFlag(LEFT, false);
      ctx.setFlag(STOP, "front");
      ctx.spend({ minutes: far ? 3 : 1, fatigue: far ? 0.06 : 0.02 }, "跑过去追那两点红色");
      w.emit("body:rest", { seconds: 4 });
      w.emit("ambience", { overrides: { engine: 0.3 } });
      ctx.sfx("exhale", 0, 0.95);
      ctx.kick("land", 1.0);   // thirty seconds of running, one landing, one breath — no line gets past the gate here, and none is needed
    };
    const caughtBreath = (progress: number) => {
      if (progress < 0.15) return;
      ctx.kick("settle", 0.6);
      ctx.sfx("breath", 0, 0.85);
    };
    ctx.onHold("tail", runAfter);
    ctx.onRelease("tail", caughtBreath);

    /* Everything else on this bend is optional and silent. */
    ctx.onInteract("bus-plate", () => {
      ctx.hand(PLATE, "grip");
      ctx.kick("glance", 0.45, { yaw: -2, pitch: -4 });
      /* §6 makes this line the whole return on reading the plate, so it is the one line in this scene that has to
         reach the screen: she arrives at fatigue 1, BodySystem latches adrenaline, and DialogueSystem drops
         everything under priority 2. §6 sanctions this half only — the empty pocket is hers to find in the pack
         (§3.6), never to be told about. */
      ctx.say("公交早没了。", { tag: "hairpin-bus", priority: 2 });
    });
    ctx.onInteract("village-lights", () => {
      ctx.kick("glance", 0.6, { yaw: 8, pitch: -3 });
      ctx.sfx("breath", 0.4, 0.55);   // the valley lights are painted down there; she does not say them back
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

  /* Fastest legal way through: step into the crook, go up the ladder to the lamp while the first pair of lights is
     still coming, look at it so it goes by, stand a moment for the second, and look at that one too.
     Each signal spends the minute that brings the next car up the valley; the eyes do the rest. */
  walkthrough: [
    { type: "interact", entity: "stance-center", verb: "step" }, { wait: 400 },
    { type: "interact", entity: "signal-wave", verb: "wave" }, { wait: 400 },
    { type: "interact", entity: "signal-shout", verb: "talk" }, { wait: 400 },
    { type: "interact", entity: "signal-lamp", verb: "use" }, { wait: 400 },
    { type: "interact", entity: "headlights", verb: "inspect" }, { wait: 900 },
    { type: "wait" }, { wait: 500 },
    { type: "interact", entity: "headlights", verb: "inspect" }, { wait: 900 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    /* The shadow and a bare hand: it goes past her and stops forty metres down, and she runs after it.
       The hold is scaled by fatigue only (2600 ms × up to 1.6), so 7 s covers the worst arrival. */
    left: [
      { type: "interact", entity: "stance-shadow", verb: "step" }, { wait: 400 },
      { type: "interact", entity: "signal-wave", verb: "wave" }, { wait: 400 },
      { type: "interact", entity: "headlights", verb: "inspect" }, { wait: 900 },
      { type: "wait" }, { wait: 500 },
      { type: "interact", entity: "headlights", verb: "inspect" }, { wait: 900 },
      { type: "hold:start", entity: "tail" }, { wait: 7000 }, { type: "hold:end" }, { wait: 500 },
      { type: "travel", entity: "go" },
    ],
    /* Everything the bend has: the branches, the plate, the valley, the sky, both other places to stand, and all
       three ways of signalling — the ladder goes round twice, so the second car answers the lamp. */
    thorough: [
      { type: "interact", entity: "branches", verb: "inspect" }, { wait: 1200 },
      { type: "interact", entity: "bus-plate", verb: "read" }, { wait: 400 },
      { type: "overlay:close" }, { wait: 300 },
      { type: "interact", entity: "village-lights", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "milky-way", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "stance-rail", verb: "step" }, { wait: 300 },
      { type: "interact", entity: "stance-shadow", verb: "step" }, { wait: 300 },
      { type: "interact", entity: "signal-wave", verb: "wave" }, { wait: 300 },
      { type: "interact", entity: "signal-shout", verb: "talk" }, { wait: 300 },
      { type: "interact", entity: "headlights", verb: "inspect" }, { wait: 900 },
      { type: "interact", entity: "stance-center", verb: "step" }, { wait: 300 },
      { type: "interact", entity: "signal-lamp", verb: "use" }, { wait: 300 },
      { type: "wait" }, { wait: 900 },
      { type: "interact", entity: "headlights", verb: "inspect" }, { wait: 900 },
      { type: "travel", entity: "go" },
    ],
  },
});
