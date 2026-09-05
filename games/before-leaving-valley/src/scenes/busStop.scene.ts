/* Passo Sella, the road, the third day, 09:05. The same stand as `roadside` on the first morning — the same
   painting, the same playground, the same wooden houses, the same grey wall across the road — with the clock
   three days on and the luggage on the grass by her feet. She is waiting for the 472 out of the valley.

   Then a woman she has never seen walks up and asks (SOURCE_TRANSCRIPT, day 3 §15): "Have you lost your phone?"
   She freezes and says yes. There is no time to ask anything back: the bus is already coming in over there, and
   the woman says "这个公交车去警察局" and runs off. All she manages is a photograph of the woman's back.

   So the whole node is that window. The moment she answers, forty seconds start running (v4 §7: 这 40 秒里能做完
   两件事，做不完四件). Calling after the woman costs fourteen of them and pushes her past the playground, so the
   only shot left is the far, unreadable one; not calling after her and simply raising the camera gets the clear
   back that the account describes. Anything else she does in those seconds — one more look at the mountain, one
   more breath standing still — spends them too, and then the woman is gone and there is no photograph at all.
   Nothing here can fail: the answer is always available, the bus always waits, boarding is never locked.

   Every coordinate was read off the 150°×84° grid of 20-bus-stop (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { ENTRIES } from "../data/entries";
import { all, flag, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { goArrow, lookAt } from "./_shared";

const HEARD = "busStop.heard";            // she has asked at least once
const ASKS = "busStop.asks";              // how many times the question has been put to her (she asks twice)
const ANSWERED = "busStop.answered";      // yes
const ASKED = "busStop.asked";            // she called after her
const PHOTO = "busStop.photo";            // "clear" | "blur" — which back the credits get
const SAME = "busStop.samePhoto";         // the third-day frame of the first morning
const RUNNING = "busStop.running";        // the woman has turned and gone
const GONE = "busStop.gone";              // past the houses, out of sight
const BUS_IN = "busStop.busIn";           // the 472 is at the stop
const BUS_SEEN = "busStop.busSeen";       // she has picked it out down the road
const WINDOW = "busStop.window";          // seconds left of the forty; −1 until she answers
const BOARDED = "busStop.boarded";

const WINDOW_SECONDS = 40;
const COST_ASK = 14, COST_SHOT = 12, COST_OTHER = 15, COST_WAIT = 8;
const WOMAN_MINUTE = 9 * 60 + 9;          // if she spends the morning looking round instead of standing still

/* Protected text (v4 §10.4): not to be rewritten, expanded or brought forward. */
const ASK_LINE = "Have you lost your phone?";
const QUESTURA = "这个公交车去警察局";
const OBJ_LEAVE = "离开多洛米蒂，在山口等 472";

/* Things painted in 20-bus-stop, with the pixel they were read from. */
const SASSOLUNGO: Transform = { yaw: 9, pitch: 16, distance: 40 };       // the great grey wall across the road (720, 220)
const PLAYGROUND: Transform = { yaw: -44, pitch: -17, distance: 16 };    // the wooden tower and the slide (265, 506)
const CHALETS: Transform = { yaw: 14, pitch: -13, distance: 14 };        // the front of the first wooden chalet (760, 469)
const BENCH: Transform = { yaw: -5, pitch: -16, distance: 14 };          // the bench outside the white house (597, 497)
const BUS_SIGN: Transform = { yaw: 42, pitch: -15.5 };                   // the small post at the road's edge by the chalets (998, 493)
const FAR_ROAD: Transform = { yaw: 52, pitch: -15, distance: 16 };       // the far stretch of tarmac before the trees take it (1090, 489)
/* Sprites: everything that moves, is picked up, or is only here on the third day. */
const BUS_AT: Transform = { yaw: 33, pitch: -12, distance: 10 };         // pulled in on the near half of the road (922, 463)
const BUS_DOOR: Transform = { yaw: 28, pitch: -14, distance: 10 };       // the folding door on this side of it (879, 480)
const WOMAN: Transform = { yaw: -20, pitch: -11, distance: 7 };          // on the grass in front of the white house (469, 474)
const WOMAN_AWAY: Transform = { yaw: -27, pitch: -14, distance: 12 };    // going, across the grass past the swings (410, 480)
const WOMAN_FAR: Transform = { yaw: -55, pitch: -5, distance: 16 };      // past the playground, on the open slope (171, 393)
const BAG: Transform = { yaw: -18, pitch: -30, distance: 4 };            // the grass verge at her feet (486, 617)
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };                     // story actions: E-key prompts, never drawn

const womanHere = all(flag(HEARD), not(flag(RUNNING)));
const womanGoing = all(flag(RUNNING), not(flag(GONE)));

export default defineScene({
  id: "busStop",
  day: 3, place: "Passo Sella · 公交站", elevation: "2,240 m",
  painting: "pano/20-bus-stop.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen" },
  chapter: { eyebrow: "第三天", title: "离开多洛米蒂" },
  arriveAt: 9 * 60 + 5,
  idleLook: true,
  fallback: "472 还没来。",
  exitWhen: flag(ANSWERED),
  entities: [
    /* The same four things as the first morning, three days older. A minute each; the camera is the only one left
       that works (the phone is still in somebody else's hands), so a photograph costs the 360's battery, not the phone's. */
    lookAt("sassolungo", SASSOLUNGO, "对面的锯齿石墙", 1),
    lookAt("playground", PLAYGROUND, "儿童游乐架", 1),
    lookAt("chalets", CHALETS, "木屋", 1),
    { id: "bench", transform: BENCH,
      interactable: { verbs: ["inspect"], label: "长椅", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 12, dwell: 900 } },
    /* The blue plate she is standing under. No timetable on it: the account never gives one (v4 §12 B9). */
    { id: "bus-sign", transform: BUS_SIGN,
      sprite: { src: "sprites/busstop-sign.webp", layer: "prop", sizeVh: 5 },
      interactable: { verbs: ["inspect"], label: "蓝色站牌", reveal: 12, cost: { minutes: 0 } } },
    /* Everything she owns, down on the grass beside her boots, until she picks it up to get on. */
    { id: "backpack", transform: BAG,
      sprite: { src: "sprites/backpack-grass.webp", layer: "prop", sizeVh: 18 },
      visible: not(flag(BOARDED)) },

    /* The 472 comes up from the Canazei side and is a long way off for a long time (v4 §8: 从画面右侧远处驶近).
       It waits there until she picks it out of the road, and it pulls in when she has given the woman her answer. */
    { id: "bus-far", transform: FAR_ROAD,
      sprite: { src: "sprites/bus-arriving.webp", layer: "prop", sizeVh: 5 },
      gaze: { radius: 13, dwell: 700 },
      visible: not(flag(BUS_IN)) },
    { id: "bus", transform: BUS_AT,
      sprite: { src: "sprites/bus-472.webp", layer: "figure", sizeVh: 26 },
      visible: flag(BUS_IN) },

    /* The woman. She is not a timer: she comes over when the player stands still, or when enough of the morning
       has gone by on the clock, and then she stands there and asks — twice, if the player has not turned round yet. */
    { id: "woman", transform: WOMAN,
      sprite: { src: "sprites/woman-front.webp", layer: "figure", sizeVh: 26 },
      gaze: { radius: 14, dwell: 600 },
      visible: womanHere },
    /* Her back, going. Two places, because how far away she is when the shutter goes is the whole of the decision:
       call after her and she is already past the playground; raise the camera instead and she is still readable. */
    { id: "woman-away", transform: WOMAN_AWAY,
      sprite: { src: "sprites/woman-back.webp", layer: "figure", sizeVh: 14 },
      interactable: { verbs: ["talk", "photograph"], label: "跑开的背影", reveal: 15, cost: { minutes: 0 } },
      visible: all(womanGoing, not(flag(ASKED))) },
    { id: "woman-far", transform: WOMAN_FAR,
      sprite: { src: "sprites/woman-back.webp", layer: "figure", sizeVh: 6.5 },
      interactable: { verbs: ["photograph"], label: "远处的背影", reveal: 15, cost: { minutes: 0 }, requires: has("camera360") },
      visible: all(womanGoing, flag(ASKED)) },

    /* The one word this whole day turns on. It is a thing said to a person, so it is an E-key action, not a hotspot. */
    { id: "answer", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["talk"], label: "yes", reveal: 0, cost: { minutes: 0 } },
      visible: all(flag(HEARD), not(flag(ANSWERED))) },

    /* The way on is the folding door. It opens onto an hour of hairpins and a Carabinieri counter. */
    goArrow("go", BUS_DOOR, { to: "police", minutes: 60, label: "拎起背包上车", kind: "walk", condition: all(flag(ANSWERED), flag(BUS_IN)) }),
  ],

  seed: (w) => {
    /* What the third morning leaves behind: she was asked, she said yes, she never got to ask back, she got the
       clear photograph of the back, and she got on the bus (engine policy: busStop.answered / busStop.boarded). */
    w.setFlag(HEARD, true); w.setFlag(ASKS, 2); w.setFlag(ANSWERED, true);
    w.setFlag(ASKED, false); w.setFlag(PHOTO, "clear"); w.setFlag(SAME, false);
    w.setFlag(RUNNING, true); w.setFlag(GONE, true);
    w.setFlag(BUS_IN, true); w.setFlag(BUS_SEEN, true); w.setFlag(WINDOW, 0);
    w.setFlag(BOARDED, true);
    w.patch("journal", {
      objective: QUESTURA,
      entries: ENTRIES["E-questura"] ? Array.from(new Set([...w.state.journal.entries, "E-questura"])) : w.state.journal.entries,
    });
    /* The 360 spent the night on a hotel charger; the phone is still gone. (Belongs to `hotel`; see requests.) */
    if (w.state.power.camera <= 0) w.patch("power", { camera: 100 });
    w.patch("body", { fatigue: Math.min(w.state.body.fatigue, 0.2), fear: 0 });
  },

  /* Fastest legal way through: stand still until she comes over, say yes, pick up the bag and get on. */
  walkthrough: [
    { type: "wait" }, { wait: 600 },
    { type: "interact", entity: "answer", verb: "talk" }, { wait: 900 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    /* Say yes and raise the camera straight away: the clear back, the one the account describes. */
    shot: [
      { type: "wait" }, { wait: 600 },
      { type: "interact", entity: "answer", verb: "talk" }, { wait: 700 },
      { type: "interact", entity: "woman-away", verb: "photograph" }, { wait: 600 },
      { type: "travel", entity: "go" },
    ],
    /* Call after her first. Half a sentence of Italian, fourteen seconds, and the only back left is the far one. */
    ask: [
      { type: "wait" }, { wait: 600 },
      { type: "interact", entity: "answer", verb: "talk" }, { wait: 700 },
      { type: "interact", entity: "woman-away", verb: "talk" }, { wait: 700 },
      { type: "interact", entity: "woman-far", verb: "photograph" }, { wait: 600 },
      { type: "travel", entity: "go" },
    ],
    /* Everything the stop offers: the wall from the first morning's frame, the playground, the houses, the bench,
       the plate, the bus down the road — then she comes over, asks twice, and there is still time for one shot. */
    thorough: [
      { type: "interact", entity: "sassolungo", verb: "photograph" }, { wait: 700 },
      { type: "interact", entity: "playground", verb: "inspect" }, { wait: 500 },
      { type: "interact", entity: "chalets", verb: "inspect" }, { wait: 500 },
      { type: "interact", entity: "bench", verb: "inspect" }, { wait: 500 },
      { type: "interact", entity: "bus-sign", verb: "inspect" }, { wait: 500 },
      { type: "wait" }, { wait: 800 },
      { type: "interact", entity: "answer", verb: "talk" }, { wait: 700 },
      { type: "interact", entity: "woman-away", verb: "photograph" }, { wait: 600 },
      { type: "travel", entity: "go" },
    ],
    /* Answer, then hesitate. Four breaths and she is past the houses; there is no photograph of anybody. */
    late: [
      { type: "wait" }, { wait: 600 },
      { type: "interact", entity: "answer", verb: "talk" }, { wait: 700 },
      { type: "wait" }, { wait: 400 }, { type: "wait" }, { wait: 400 },
      { type: "wait" }, { wait: 400 }, { type: "wait" }, { wait: 400 },
      { type: "wait" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
  },

  script: (ctx) => {
    const w = ctx.world;
    const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: clamp((target.yaw - here.yaw) * 0.14, 6), pitch: clamp((target.pitch - here.pitch) * 0.14, 4) });
    };
    /* The phone is still somewhere in a Carabinieri drawer, so every shutter here is the 360's. */
    const shoot = (target: Transform) => {
      ctx.spend({ camera: 2 }, "举起相机");
      ctx.sfx("shutter", 0, 0.7);
      glanceAt(target, 0.35);
    };

    /* The third morning: she has one bag, a charged 360 and an empty pocket. */
    ctx.onEnter(() => {
      if (w.state.power.camera <= 0) w.patch("power", { camera: 100 });
      if (w.state.journal.objective !== QUESTURA) w.patch("journal", { objective: OBJ_LEAVE });
    });

    /* ---- The forty seconds. They start when she has given her answer and nothing else. ---- */
    const gone = () => {
      if (ctx.flag(GONE, false)) return;
      ctx.setFlag(GONE, true);
      ctx.kick("turn", 0.5, { yaw: -14, pitch: 0 });
      ctx.sfx("doorOpen", 0.5, 0.6);
      w.emit("ambience", { overrides: { engine: 0.4 } });
    };
    const burn = (seconds: number) => {
      const left = ctx.flag<number>(WINDOW, -1);
      if (left <= 0) return;
      const next = Math.max(0, left - seconds);
      ctx.setFlag(WINDOW, next);
      if (next <= 0) gone();
    };
    /* Anything at all she does in those seconds spends them: the mountain, the houses, the plate. */
    const PRICED = new Set(["answer", "woman-away", "woman-far"]);
    ctx.on("interact:done", ({ entity }) => { if (!PRICED.has(entity)) burn(COST_OTHER); });

    /* ---- The woman. She is a person who walks up, not an event that fires. ---- */
    const ask = () => {
      const asks = ctx.flag<number>(ASKS, 0) + 1;
      ctx.setFlag(ASKS, asks);
      ctx.setFlag(HEARD, true);
      ctx.say(ASK_LINE, { priority: 1, tag: `bus-ask-${asks}` });
    };
    /* Gravel on the left, then a voice. If the player is watching the road she will only hear it. */
    const arrive = () => {
      if (ctx.flag(HEARD, false) || ctx.flag(ANSWERED, false)) return;
      ctx.sfx("step", -0.45, 0.5);
      ctx.after(280, () => ctx.sfx("step", -0.4, 0.45));
      ctx.kick("turn", 0.5, { yaw: -10, pitch: -2 });
      ask();
    };
    ctx.on("clock:advance", () => { if (ctx.minute() >= WOMAN_MINUTE) arrive(); });
    /* Turning round and finding her there: she puts it again (v4 §8: 她问两次). */
    ctx.onGaze("woman", () => {
      if (ctx.flag(ANSWERED, false) || ctx.flag<number>(ASKS, 0) >= 2) return;
      glanceAt(WOMAN, 0.5);
      ctx.sfx("breath", -0.3, 0.4);
      ask();
    });

    /* yes. She freezes on it — a caught breath, the camera settling — and the road answers with air brakes.
       Then the woman's own sentence, and she is already turning away while she says it. */
    ctx.onInteract("answer", () => {
      if (ctx.flag(ANSWERED, false)) return;
      ctx.setFlag(ANSWERED, true);
      ctx.setFlag(WINDOW, WINDOW_SECONDS);
      ctx.sfx("breath", 0, 0.85);
      ctx.kick("settle", 0.8);
      ctx.setFlag(BUS_IN, true); ctx.setFlag(BUS_SEEN, true);
      w.emit("ambience", { overrides: { engine: 0.34 } });
      ctx.after(320, () => { ctx.sfx("brake", 0.5, 0.8); ctx.kick("brake", 0.7); ctx.fx("brake", 0.5); });
      ctx.say(QUESTURA, { priority: 1, tag: "bus-questura" });
      ctx.setFlag(RUNNING, true);
      ctx.after(680, () => { ctx.sfx("cloth", -0.45, 0.45); ctx.sfx("step", -0.5, 0.4); ctx.kick("turn", 0.45, { yaw: -8, pitch: 0 }); });
      w.dispatch({ type: "ui:action", id: "map:objective", value: QUESTURA });
      if (ENTRIES["E-questura"]) ctx.learn("E-questura", "woman");
    });

    /* Calling after her. She does not stop; fourteen of the forty seconds go, and the grass between them doubles.
       What comes back is half a sentence with nothing in it — the account never learns any of this either. */
    const askBack = () => {
      if (ctx.flag(ASKED, false) || ctx.flag(GONE, false)) return;
      ctx.setFlag(ASKED, true);
      burn(COST_ASK);
      ctx.kick("turn", 0.85, { yaw: -16, pitch: 0 });
      ctx.sfx("cloth", -0.5, 0.5);
      ctx.fx("gust", 0.3);
      ctx.say("…non lo so…", { priority: 1, tag: "bus-fragment" });
    };
    /* The photograph. Twelve seconds and two percent of the 360; how far off she is by then is not the camera's fault. */
    const shootBack = () => {
      if (ctx.flag(GONE, false) || ctx.flag<string>(PHOTO, "") !== "") return;
      if (!w.state.inventory.items.includes("camera360")) { ctx.hand(WOMAN_AWAY, "grip"); ctx.sfx("tock", 0, 0.4); return; }
      const blurred = ctx.flag(ASKED, false);
      burn(COST_SHOT);
      ctx.setFlag(PHOTO, blurred ? "blur" : "clear");
      shoot(blurred ? WOMAN_FAR : WOMAN_AWAY);
      ctx.kick("glance", 0.4, { yaw: -6, pitch: 0 });
    };
    ctx.onInteract("woman-away", (verb) => { if (verb === "talk") askBack(); else shootBack(); });
    ctx.onInteract("woman-far", () => shootBack());

    /* ---- The 472, down the road. Sound first, off to the right; she has to find it herself. ---- */
    ctx.onGaze("bus-far", () => {
      if (ctx.flag(BUS_SEEN, false)) return;
      ctx.setFlag(BUS_SEEN, true);
      ctx.sfx("slide", 0.7, 0.4);
      ctx.kick("glance", 0.45, { yaw: 7, pitch: -2 });
      w.emit("ambience", { overrides: { engine: 0.12 } });
    });

    /* ---- The first morning's four things, three days on. ---- */
    ctx.onInteract("sassolungo", (verb) => {
      if (verb !== "photograph") {
        glanceAt(SASSOLUNGO, 0.7); ctx.sfx("exhale", 0.3, 0.6); ctx.setFlag("busStop.sassolungo", true);
        return;
      }
      shoot(SASSOLUNGO);
      if (ctx.flag(SAME, false)) return;
      ctx.setFlag(SAME, true);
      ctx.say("第一天就站在这里。", { tag: "bus-same" });
    });
    ctx.onInteract("playground", (verb) => {
      if (verb === "photograph") return shoot(PLAYGROUND);
      glanceAt(PLAYGROUND, 0.5); ctx.setFlag("busStop.playground", true);
      ctx.sfx("clink", -0.6, 0.25); ctx.after(520, () => ctx.sfx("clink", -0.6, 0.18));   // the swing's chain, same as day one
    });
    ctx.onInteract("chalets", (verb) => {
      if (verb === "photograph") return shoot(CHALETS);
      glanceAt(CHALETS, 0.5); ctx.sfx("tock", 0.3, 0.35); ctx.setFlag("busStop.chalets", true);
    });
    ctx.onInteract("bench", () => {
      glanceAt(BENCH, 0.4); ctx.sfx("breath", -0.1, 0.4); ctx.fx("gust", 0.25);
      ctx.setFlag("busStop.bench", true);
    });
    ctx.onGaze("bench", () => {
      if (ctx.flag("busStop.bench", false)) return;
      ctx.setFlag("busStop.bench", true);
      ctx.kick("settle", 0.3); ctx.sfx("breath", -0.1, 0.35);
    });
    ctx.onInteract("bus-sign", () => {
      ctx.hand(BUS_SIGN, "grip"); ctx.kick("glance", 0.4, { yaw: 5, pitch: -3 }); ctx.sfx("tock", 0.5, 0.4);
      ctx.setFlag("busStop.sign", true);
    });

    /* ---- Standing still. Before she comes over it is a bus stop; after, it is eight seconds she will not get back. ---- */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      ctx.kick("settle", 0.2);
      arrive();
      burn(COST_WAIT);
      if (stills === 1) ctx.fx("gust", 0.35);
      if (stills % 3 === 0) ctx.sfx("clink", -0.6, 0.2);
    });

    /* ---- Getting on. The bag comes up off the grass, the door folds, and the valley is behind her. ---- */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "busStop" || to !== "police") return;
      ctx.setFlag(BOARDED, true);
      gone();
      ctx.sfx("zip", -0.2, 0.5);
      ctx.after(220, () => { ctx.sfx("cloth", -0.15, 0.5); ctx.kick("step", 0.8); });
      ctx.after(560, () => { ctx.sfx("doorClose", 0.35, 0.6); ctx.kick("settle", 0.6); });
      w.emit("ambience", { overrides: { engine: 0.5 } });
    });
  },
});
