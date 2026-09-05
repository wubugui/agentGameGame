/* Passo Sella, the road, the third day, 09:05. The same stand as `roadside` on the first morning — the same
   painting, the same playground, the same wooden houses, the same grey wall across the road — with the clock
   three days on and the luggage on the grass by her feet. She is waiting for the 472 out of the valley.

   Then a woman she has never seen walks up and asks (SOURCE_TRANSCRIPT, day 3 §15): "Have you lost your phone?"
   She freezes and says yes. There is no time to ask anything back: the bus is already coming in over there, and
   the woman says "这个公交车去警察局" and runs off. All she manages is a photograph of the woman's back.

   So the whole node is that window. The moment she answers, forty seconds start running (v4 §7: 这 40 秒里能做完
   两件事，做不完四件). Calling after the woman costs twelve of them and pushes her past the playground, so the
   only shot left is the far, unreadable one; not calling after her and simply raising the camera gets the clear
   back that the account describes. Anything else she does in those seconds — one more look at the mountain, one
   more breath standing still — spends them too, and then the woman is gone and there is no photograph at all.
   Once the window is running she can only do what she still has seconds for: reach for a fourth thing and her
   hand comes back with the last of them gone, and the woman is already past the houses.
   Nothing here can fail: the answer is always available, the bus always waits, boarding is never locked.

   Every coordinate was read off the 150°×84° grid of 20-bus-stop (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { ENTRIES } from "../data/entries";
import { all, any, flag, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { phoneDispatch } from "../systems/UISystem";
import { goArrow } from "./_shared";

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
/* v4 §12 A6: 这 40 秒里只允许做完两件事. At fifteen a third one still fitted — ask 12 + shot 12 + look 15 = 39 —
   so a player could answer, call after her, photograph her and still turn round to the playground. At twenty no
   three of them ever add up to forty or less, and any two of them always do. */
const COST_ASK = 12, COST_SHOT = 12, COST_OTHER = 20, COST_WAIT = 8;
/* If she spends the morning looking round instead of standing still. hotel hands the clock over at 09:10, so this
   has to sit far enough past that for "逛了一会儿" and "站着不动" to be two different ways of getting to her. */
const WOMAN_MINUTE = 9 * 60 + 18;

/* Protected text (v4 §10.4): not to be rewritten, expanded or brought forward. */
const ASK_LINE = "Have you lost your phone?";
const QUESTURA = "这个公交车去警察局";
const OBJ_LEAVE = "离开多洛米蒂，在山口等 472";

/* The two frames this morning can leave behind. Every other shutter in the game writes into `phone.photos`, and
   these two have to as well or they do not exist the moment the scene ends: §6 wants the day-one frame lying next
   to the first morning's in the album at the counter, and §7 wants the woman's back to be the picture the credits
   roll over. The 360 is the camera (the phone is in a Carabinieri drawer), so the cost is the 360's battery and
   the phone's own clock and charge must not move — `roll` below puts them back. */
const SAME_FRAME_PHOTO = {
  asset: "pano/20-bus-stop.webp", title: "第一天站的地方", place: "Passo Sella · 公交站",
  position: { x: 50, y: 30 }, zoom: 1.2, day: 3,
};
const BACK_PHOTO = {
  clear: { asset: "art/woman-back-clear.webp", title: "那位女士的背影", place: "Passo Sella · 公交站", position: { x: 50, y: 50 }, zoom: 1, day: 3 },
  blur: { asset: "art/woman-back-blur.webp", title: "那位女士的背影", place: "Passo Sella · 公交站", position: { x: 50, y: 50 }, zoom: 1, day: 3 },
};

/* Things painted in 20-bus-stop, with the pixel they were read from. */
const SASSOLUNGO: Transform = { yaw: 9, pitch: 16, distance: 40 };       // the great grey wall across the road (720, 220)
const PLAYGROUND: Transform = { yaw: -44, pitch: -17, distance: 16 };    // the wooden tower and the slide (265, 506)
const CHALETS: Transform = { yaw: 14, pitch: -13, distance: 14 };        // the front of the first wooden chalet (760, 469)
const BENCH: Transform = { yaw: -5, pitch: -16, distance: 14 };          // the bench outside the white house (597, 497)
const BUS_SIGN: Transform = { yaw: 42, pitch: -15.5 };                   // the small post at the road's edge by the chalets (998, 493)
const FAR_ROAD: Transform = { yaw: 52, pitch: -15, distance: 16 };       // the far stretch of tarmac before the trees take it (1090, 489)
/* Sprites: everything that moves, is picked up, or is only here on the third day. Each one is placed by its
   FOOT, not its middle: a sprite's foot sits at (its pixel row) + sizeVh·5.14/2 on the 1280×720 plate, and the
   tarmac's far edge runs (600, 618) → (760, 582) → (920, 542) → (1080, 502), so anything standing on the road
   has to have its wheels below that line at its own x. */
/* The coach stands in a 406 px gap: the chalets hotspot lands at screen x 795 and the blue plate at x 1201, and
   yaw 30 is the middle of it. What was wrong was the size, not the place — at 26vh the 472 was 187 px tall, which
   is a three-metre coach eleven metres away, and it left barely thirty pixels either side. 18vh is the same
   three metres at the sixteen the transform says (260/d vh), it is the size the same coach has at `bench`
   (18vh at d14 → 16 m would be 15.75), and it fits the gap with eighty pixels of daylight on both sides.
   Its wheels still come down at screen row ≈687 = plate row 570, below the tarmac's far edge (545 at this x). */
const BUS_AT: Transform = { yaw: 30, pitch: -20, distance: 16 };         // stopped on the near lane, wheels on the tarmac (896, 531; wheels 570)
const BUS_DOOR: Transform = { yaw: 34, pitch: -19, distance: 16 };       // the folding door on this side of it (930, 523)
/* She stands where the frame can hold all of her: at −25.5° her boots were 26 px under the bottom edge of the
   static view, so the player's first sight of her was a woman cut off at the ankles (measured in the DOM). */
const WOMAN: Transform = { yaw: -22, pitch: -22, distance: 7 };          // on the near grass between the two boulders (452, 549; feet 584)
const WOMAN_AWAY: Transform = { yaw: -30, pitch: -14, distance: 12 };    // going, across the grass past the swings (384, 480; feet 503)
const WOMAN_FAR: Transform = { yaw: -46, pitch: -6.5, distance: 16 };    // past the playground, on the open slope (247, 416; feet 426)
const BAG: Transform = { yaw: -16, pitch: -25.5, distance: 8 };          // the grass verge at her feet (503, 569; foot 597)
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };                     // story actions: E-key prompts, never drawn

const womanHere = all(flag(HEARD), not(flag(RUNNING)));
const womanGoing = all(flag(RUNNING), not(flag(GONE)));
/* Whether one more of the free looks still fits in what is left of the forty seconds. Before she answers the
   window is unset and everything is free; once it is running, a look she cannot pay for does not happen — her
   hand goes out to it and comes back, which is what InteractionSystem does with an unmet `requires`.
   Without this the window only ever charged a look *after* it had happened, so ask 12 + shot 12 + look still
   went through and she did three things inside forty seconds (v4 §12 A6: 只允许做完两件事). */
const HAS_TIME = any(flag(WINDOW, { lt: 0 }), flag(WINDOW, { gte: COST_OTHER }));

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
       that works (the phone is still in somebody else's hands), so a photograph costs the 360's battery, not the
       phone's. One hotspot with the mountain's name on it, not two: view/Hotspot.tsx only ever dispatches
       verbs[0], so `photograph` is verbs[0] and the look is what the hand does on the way to the shutter. A
       second label reading「拍一张」floated on the same blank rock face twelve degrees from this one, and 拍一张
       is a verb, not the name of anything painted (SCENE_AUTHORING §0.5) — cable and exit split their entities the
       same way, but both halves there name the thing (往下的钢缆 / 两位攀登者). §6: 与第一天同机位的一张. */
    { id: "sassolungo", transform: SASSOLUNGO,
      interactable: { verbs: ["photograph"], label: "对面的锯齿石墙", reveal: 12, cost: { minutes: 1 }, requires: HAS_TIME } },
    { id: "playground", transform: PLAYGROUND,
      interactable: { verbs: ["inspect"], label: "儿童游乐架", reveal: 12, cost: { minutes: 1 }, requires: HAS_TIME } },
    { id: "chalets", transform: CHALETS,
      interactable: { verbs: ["inspect"], label: "木屋", reveal: 12, cost: { minutes: 1 }, requires: HAS_TIME } },
    { id: "bench", transform: BENCH,
      interactable: { verbs: ["inspect"], label: "长椅", reveal: 12, cost: { minutes: 0 }, requires: HAS_TIME },
      gaze: { radius: 12, dwell: 900 } },
    /* The blue plate she is standing under. No timetable on it: the account never gives one (v4 §12 B9). */
    { id: "bus-sign", transform: BUS_SIGN,
      sprite: { src: "sprites/busstop-sign.webp", layer: "prop", sizeVh: 5 },
      interactable: { verbs: ["inspect"], label: "蓝色站牌", reveal: 12, cost: { minutes: 0 }, requires: HAS_TIME } },
    /* Everything she owns, down on the grass beside her boots, until she picks it up to get on. */
    { id: "backpack", transform: BAG,
      sprite: { src: "sprites/backpack-grass.webp", layer: "prop", sizeVh: 11 },
      visible: not(flag(BOARDED)) },

    /* The 472 comes up from the Canazei side and is a long way off for a long time (v4 §8: 从画面右侧远处驶近).
       It waits there until she picks it out of the road, and it pulls in when she has given the woman her answer. */
    { id: "bus-far", transform: FAR_ROAD,
      sprite: { src: "sprites/bus-arriving.webp", layer: "prop", sizeVh: 5 },
      gaze: { radius: 13, dwell: 700 },
      visible: not(flag(BUS_IN)) },
    { id: "bus", transform: BUS_AT,
      sprite: { src: "sprites/bus-472.webp", layer: "figure", sizeVh: 18 },
      visible: flag(BUS_IN) },

    /* The woman. She is not a timer: she comes over when the player stands still, or when enough of the morning
       has gone by on the clock, and then she stands there and asks — twice, if the player has not turned round yet. */
    { id: "woman", transform: WOMAN,
      sprite: { src: "sprites/woman-front.webp", layer: "figure", sizeVh: 16 },
      gaze: { radius: 14, dwell: 600 },
      visible: womanHere },
    /* Her back, going. Two places, because how far away she is when the shutter goes is the whole of the decision:
       call after her and she is already past the playground; raise the camera instead and she is still readable. */
    /* Raising the camera is a thing done to the painting, so it is the hotspot on her back and its only verb;
       calling after her is a thing said to a person, so it is an E-key action (like `answer` below). Both were
       on this one entity before, and the UI never dispatched the second verb — the account's own photograph
       could not be pressed at all (v4 §7: 不追问直接举相机 是原片里她拍到的那张). */
    { id: "woman-away", transform: WOMAN_AWAY,
      sprite: { src: "sprites/woman-back.webp", layer: "figure", sizeVh: 9 },
      interactable: { verbs: ["photograph"], label: "跑开的背影", reveal: 15, cost: { minutes: 0 } },
      visible: all(womanGoing, not(flag(ASKED))) },
    { id: "call-after", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["talk"], label: "喊住她", reveal: 0, cost: { minutes: 0 } },
      visible: all(womanGoing, not(flag(ASKED))) },
    { id: "woman-far", transform: WOMAN_FAR,
      sprite: { src: "sprites/woman-back.webp", layer: "figure", sizeVh: 4 },
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
    /* And the frame she did get. It has to be in the roll, not only in a flag: the album at the counter shows it
       an hour later and the credits roll over it (v4 §6, §7). The phone is in a drawer in Canazei, so its own
       clock and charge are handed straight back — a shutter up here is the 360's. */
    if (!w.state.phone.photos.some((photo) => photo.title === BACK_PHOTO.clear.title)) {
      const before = w.state.phone;
      phoneDispatch(w, { type: "capture_photo", photo: BACK_PHOTO.clear });
      w.set("phone", { ...w.state.phone, battery: before.battery, minuteOfDay: before.minuteOfDay, date: before.date });
    }
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
      { type: "interact", entity: "call-after", verb: "talk" }, { wait: 700 },
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
    /* The phone is still somewhere in a Carabinieri drawer, so every shutter here is the 360's — and the frame
       has to end up somewhere it can be looked at afterwards, or the whole forty seconds vanish with the scene.
       `roll` puts it in the album and then hands the phone back its own clock and charge: it is lying in a
       drawer in Canazei and nothing that happens up here may move them. */
    const roll = (photo: typeof SAME_FRAME_PHOTO) => {
      const before = w.state.phone;
      phoneDispatch(w, { type: "capture_photo", photo });
      w.set("phone", { ...w.state.phone, battery: before.battery, minuteOfDay: before.minuteOfDay, date: before.date });
    };
    const shoot = (target: Transform, photo: typeof SAME_FRAME_PHOTO) => {
      ctx.spend({ camera: 2 }, "举起相机");
      ctx.sfx("shutter", 0, 0.7);
      glanceAt(target, 0.35);
      roll(photo);
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
    /* Whether there is still time for one more thing. Before she has answered there is no window at all and
       everything is free; once it is running, an action she cannot pay for does not happen — the hand goes out
       and comes back, the way the engine refuses anything she would not do (v4 §12 A6). */
    const affords = (seconds: number, where: Transform) => {
      const left = ctx.flag<number>(WINDOW, -1);
      if (left < 0 || left >= seconds) return true;
      ctx.hand(where, "grip");
      ctx.kick("glance", 0.45, { yaw: 0, pitch: -3 });
      ctx.sfx("tock", -0.3, 0.35);
      burn(left);
      return false;
    };
    /* Anything at all she does in those seconds spends them: the mountain, the houses, the plate. Whether it
       fits is decided before it happens, by HAS_TIME on each of those hotspots; here it is only paid for. */
    const PRICED = new Set(["answer", "call-after", "woman-away", "woman-far"]);
    ctx.on("interact:done", ({ entity }) => { if (!PRICED.has(entity)) burn(COST_OTHER); });
    /* And the reach that did not fit spends the rest of them: the hand comes back, and by the time it does the
       woman is past the houses. (The engine has already given the hand, the glance and the knock.) */
    ctx.on("interact:refused", ({ entity, reason }) => {
      if (reason !== "condition" || PRICED.has(entity)) return;
      const left = ctx.flag<number>(WINDOW, -1);
      if (left > 0) burn(left);
    });

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
      if (!affords(COST_ASK, WOMAN_AWAY)) return;
      ctx.setFlag(ASKED, true);
      burn(COST_ASK);
      ctx.kick("turn", 0.85, { yaw: -16, pitch: 0 });
      ctx.sfx("cloth", -0.5, 0.5);
      ctx.fx("gust", 0.3);
      ctx.say("…non lo so…", { priority: 1, tag: "bus-fragment" });
    };
    /* The photograph. Twelve seconds and two percent of the 360; how far off she is by then is not the camera's fault. */
    const shootBack = () => {
      // She has one frame of this and she has already taken it, or the woman is gone: the camera stays down.
      if (ctx.flag(GONE, false) || ctx.flag<string>(PHOTO, "") !== "") {
        ctx.hand(ctx.flag(ASKED, false) ? WOMAN_FAR : WOMAN_AWAY, "grip");
        ctx.sfx("tock", -0.2, 0.35);
        return;
      }
      if (!w.state.inventory.items.includes("camera360")) { ctx.hand(WOMAN_AWAY, "grip"); ctx.sfx("tock", 0, 0.4); return; }
      const blurred = ctx.flag(ASKED, false);
      if (!affords(COST_SHOT, blurred ? WOMAN_FAR : WOMAN_AWAY)) return;
      burn(COST_SHOT);
      ctx.setFlag(PHOTO, blurred ? "blur" : "clear");
      shoot(blurred ? WOMAN_FAR : WOMAN_AWAY, blurred ? BACK_PHOTO.blur : BACK_PHOTO.clear);
      ctx.kick("glance", 0.4, { yaw: -6, pitch: 0 });
    };
    ctx.onInteract("woman-away", () => shootBack());
    ctx.onInteract("woman-far", () => shootBack());
    ctx.onInteract("call-after", () => askBack());

    /* ---- The 472, down the road. Sound first, off to the right; she has to find it herself. ---- */
    ctx.onGaze("bus-far", () => {
      if (ctx.flag(BUS_SEEN, false)) return;
      ctx.setFlag(BUS_SEEN, true);
      ctx.sfx("slide", 0.7, 0.4);
      ctx.kick("glance", 0.45, { yaw: 7, pitch: -2 });
      w.emit("ambience", { overrides: { engine: 0.12 } });
    });

    /* ---- The first morning's four things, three days on. ---- */
    /* The wall. Her head goes back, and the first time it does the camera comes up with it: one frame from the
       stand she stood on three mornings ago, which is the one §6 wants lying beside the first morning's in the
       album. She has that frame after the first press; every look after it is only a look. */
    ctx.onInteract("sassolungo", () => {
      glanceAt(SASSOLUNGO, 0.7);
      ctx.setFlag("busStop.sassolungo", true);
      if (ctx.flag(SAME, false)) { ctx.sfx("exhale", 0.3, 0.6); return; }
      ctx.setFlag(SAME, true);
      shoot(SASSOLUNGO, SAME_FRAME_PHOTO);
      ctx.say("第一天就站在这里。", { tag: "bus-same" });
    });
    ctx.onInteract("playground", () => {
      glanceAt(PLAYGROUND, 0.5); ctx.setFlag("busStop.playground", true);
      ctx.sfx("clink", -0.6, 0.25); ctx.after(520, () => ctx.sfx("clink", -0.6, 0.18));   // the swing's chain, same as day one
    });
    ctx.onInteract("chalets", () => {
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
