/* The bench at the pass, 11:50 on the third day. The phone is back in her hand and the bus that leaves the
   valley has not come yet (SOURCE_TRANSCRIPT, day 3 §17: 等离开山谷的公交车时，她突然想起那封信，因为只有这部
   手机拍下了它。翻译出来。这段话让她在长椅上泪流满面).

   22-bench paints Passo Sella — the Sassolungo wall, the same chalet and the same swing frame as 20-bus-stop,
   the pass road — and the account puts her at the pass, so the place and altitude on the HUD are the pass's
   (docs/ART_AUDIT.md, 22-bench: 画对了，应改地点与海拔，而不是改画).

   Nothing here costs anything and nothing here is timed: there is no clock on this bench — the bus arrives after
   she is done, never before (v4 §7, bench). The one thing she must do is read the page again, one line at a time,
   in the phone's gallery; between the lines she can look up, and the last line lands on whatever she is looking at.

   Every coordinate below was read off the 150°×84° grid of 22-bench (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84,
   W×H = 1280×720); the pixel it came from is noted beside it. */
import { flag } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene, type WalkStep } from "../engine/scene";
import { LETTER_LINES_ZH } from "../data/letter";
import type { EntityId, SfxName, Transform } from "../engine/types";
import { prop } from "./_shared";

const LINES = "bench.lines";            // how many lines of the translation she has read (v4 §6 naming table)
const TRANSLATED = "bench.translated";  // all of them: the ending is unlocked and the closing music comes in
const SAT = "bench.sat";
const NOTE = "bench.note";              // the couple's slip of paper is out of the pack
const NOTE_READ = "bench.noteRead";
const GALLERY = "bench.gallery";        // the album, start to finish: the receipt for the whole run
const REMEMBERED = "bench.remembered";
const LOOKED = "bench.looked";          // how many things she has raised her eyes to
const LOOKED_AT = "bench.lookedAt";
const LANDED = "bench.landedOn";        // what the last line of the letter came down on
const BUS = "bench.busHere";

/** The Chinese page shows one line per press, blanks skipped — the same count the phone's gallery uses. */
const ZH_COUNT = LETTER_LINES_ZH.filter((line) => line.length > 0).length;

/* Things painted in 22-bench, with the pixel each was read from. */
const BENCH: Transform = { yaw: -33, pitch: -24, distance: 6 };        // the lower backrest plank of the wooden bench (358, 566)
const NOTE_AT: Transform = { yaw: -24, pitch: -29, distance: 8 };      // the seat plank just right of the backrest post (435, 609)
/* The 472, pulled in beside the stop. Its wheels have to be ON the tarmac, and where a thing lands is the
   perspective camera's answer, not the plate's: screen row = 360·(1 − tan(pitch)/(cos(yaw)·tan 30°)) at 1280×720.
   At 18vh the coach is 130 px tall, so its centre lands on row 575 and its wheels come down along row 640 —
   sampled off the rendered view, that row is tarmac from x 538 rightwards and the coach starts at x 583. */
const BUS_AT: Transform = { yaw: 5.5, pitch: -18.9, distance: 14 };   // stopped on the road by the stop (687, 522; wheels 566)
const DOOR_AT: Transform = { yaw: 9, pitch: -19.9, distance: 14 };    // the folding door on this side of it (717, 531)

/** The eight things worth raising her eyes to. Each one owns the last line of the letter if she is looking at it. */
type Look = { id: EntityId; at: Transform; label: string; sound: SfxName; pan: number; strength: number; line: string };
const LOOKS: Look[] = [
  { id: "busstop-sign", at: { yaw: -20, pitch: -2.3 }, label: "公交站牌", sound: "tock", pan: -0.25, strength: 0.4, line: "牌子在风里响。" },                       // the blue plate on its pole (470, 380)
  { id: "road", at: { yaw: 4, pitch: -22, distance: 12 }, label: "公路", sound: "slide", pan: 0.3, strength: 0.3, line: "路是空的。" },                              // the tarmac and its yellow line (674, 549)
  { id: "far-slope", at: { yaw: -2, pitch: -8, distance: 20 }, label: "对面的山坡", sound: "clink", pan: 0.3, strength: 0.28, line: "对面的草在动。" },              // the green shoulder across the road (623, 428)
  { id: "sassolungo", at: { yaw: 16, pitch: 16, distance: 40 }, label: "对面的锯齿石墙", sound: "exhale", pan: 0.2, strength: 0.5, line: "那面墙还在那儿。" },        // the main tower of Sassolungo (776, 223)
  { id: "playground", at: { yaw: 36, pitch: -8.5, distance: 16 }, label: "草地上的游乐架", sound: "clink", pan: 0.55, strength: 0.34, line: "秋千自己在晃。" },      // the swing seats under the A-frame (947, 433)
  { id: "chalet", at: { yaw: 62, pitch: -3, distance: 16 }, label: "对面的木屋", sound: "doorClose", pan: 0.7, strength: 0.28, line: "木屋那边没有人。" },            // the door of the white-and-wood house (1169, 386)
  { id: "white-rock", at: { yaw: -56, pitch: -13, distance: 9 }, label: "路边的大白石", sound: "grip", pan: -0.6, strength: 0.4, line: "石头是热的。" },              // the big rounded boulder left of the bench (162, 471)
  { id: "far-hut", at: { yaw: -26, pitch: -12 }, label: "草坡上的小屋", sound: "tock", pan: -0.35, strength: 0.22, line: "那边的屋顶很小。" },                        // the tiny farm building up the slope (418, 465)
];
/** Nothing in reach of her eyes: the last line comes down on the bench she is sitting on. */
const BENCH_LINE = "长椅是热的。";

/** GazeSystem reads `interactable.reveal` first and only falls back to `gaze.radius`, so the catch radius has to
 *  be written where it is read: the two at the edges of the view and the slope she rests her eyes on are wider.
 *  The verb list is `inspect` alone — view/Hotspot.tsx only ever dispatches verbs[0], and the last photograph of
 *  the day is taken from the phone's own camera (see `phone:photo` in the script). */
const REVEAL: Record<string, number> = { chalet: 14, "white-rock": 14, "far-slope": 14 };
const lookEntity = (entry: Look): EntityDef => {
  const reveal = REVEAL[entry.id] ?? 12;
  return {
    id: entry.id, transform: entry.at,
    interactable: { verbs: ["inspect"], label: entry.label, reveal, cost: { minutes: 0 } },
    gaze: { radius: reveal, dwell: entry.id === "far-slope" ? 1400 : 900 },
  };
};

const translateSteps = (count: number): WalkStep[] =>
  Array.from({ length: count }).flatMap(() => [{ type: "ui:action", id: "bench:translate" } as WalkStep, { wait: 220 } as WalkStep]);

export default defineScene({
  id: "bench",
  day: 3, place: "Passo Sella · 公交站长椅", elevation: "2,240 m",
  painting: "pano/22-bench.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen" },
  arriveAt: 11 * 60 + 50,
  idleLook: true,
  fallback: "车还没来。",
  // Nothing is locked by it, but this is the shape of the scene: she leaves after the last line, not before.
  exitWhen: flag(TRANSLATED),
  entities: [
    // The bench itself. Sitting down is free, optional, and the only thing that changes how the waiting feels.
    { id: "bench", transform: BENCH,
      interactable: { verbs: ["use"], label: "长椅", reveal: 15, cost: { minutes: 0 } } },
    // Eight places to raise her eyes to between the lines (v4 §7: 句与句之间可以抬头).
    ...LOOKS.map(lookEntity),
    // The slip of paper with their two numbers, once she has taken it out of the pack (v4 §6, bench).
    { id: "note", transform: NOTE_AT, visible: flag(NOTE),
      sprite: { src: "sprites/contact-note.webp", layer: "prop", sizeVh: 4, swap: [{ when: flag(NOTE_READ), src: "sprites/contact-note-open.webp" }] },
      interactable: { verbs: ["inspect"], label: "他们写的纸", reveal: 12, cost: { minutes: 0 } } },
    /* The 472. It comes after she is done, and then it waits (v4 §7: 长椅上没有钟). Same redrawn coach as the one
       that pulls in at busStop, and it is the one she gets on: it stands at the stop, a dozen metres off across
       the road, not on the bend forty metres away — 6vh was the size of `bus-arriving`, seen coming (ART_AUDIT). */
    prop("bus", BUS_AT, "sprites/bus-472.webp", 18, { visible: flag(BUS) }),
    { id: "board", transform: DOOR_AT, className: "go-hotspot", visible: flag(BUS),
      interactable: { verbs: ["step"], label: "上车", reveal: 24 } },
  ],
  seed: (w) => {
    w.setFlag(LINES, ZH_COUNT);
    w.setFlag(TRANSLATED, true);
    w.setFlag(LANDED, "sassolungo");
    w.setFlag(SAT, true);
    w.setFlag(GALLERY, true);
    w.setFlag(REMEMBERED, true);
    w.setFlag(BUS, true);
  },
  // Fastest legal way through: read the page to the end, lower the phone, get on the bus.
  walkthrough: [
    ...translateSteps(ZH_COUNT),
    { wait: 500 },
    { type: "wait" },
    { wait: 500 },
    { type: "interact", entity: "board", verb: "step" },
  ],
  variants: {
    // Look up between every line; the last thing she looks up at is the wall, so the last line comes down on it.
    lookup: [
      { type: "interact", entity: "bench", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "phone:tab", value: "gallery" }, { wait: 400 },
      ...LOOKS.slice(0, 6).flatMap((entry): WalkStep[] => [
        { type: "ui:action", id: "bench:translate" }, { wait: 200 },
        { type: "interact", entity: entry.id, verb: "inspect" }, { wait: 200 },
      ]),
      { type: "interact", entity: "sassolungo", verb: "inspect" }, { wait: 300 },
      { type: "ui:action", id: "bench:translate" }, { wait: 500 },
      { type: "wait" }, { wait: 600 },
      { type: "interact", entity: "board", verb: "step" },
    ],
    // Everything the bench offers: sit, the album, their piece of paper, one last photograph, all eight looks.
    thorough: [
      { type: "interact", entity: "bench", verb: "use" }, { wait: 400 },
      { type: "pack:open" }, { wait: 300 },
      { type: "item:use", item: "contactCard" }, { wait: 400 },
      { type: "interact", entity: "note", verb: "inspect" }, { wait: 600 },
      { type: "ui:action", id: "phone:tab", value: "gallery" }, { wait: 400 },
      ...LOOKS.map((entry): WalkStep => ({ type: "interact", entity: entry.id, verb: "inspect" })),
      { wait: 400 },
      { type: "interact", entity: "sassolungo", verb: "inspect" }, { wait: 300 },
      { type: "phone:shoot" }, { wait: 400 },
      ...translateSteps(ZH_COUNT),
      { wait: 500 },
      { type: "wait" }, { wait: 500 },
      { type: "interact", entity: "board", verb: "step" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;
    const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: clamp((target.yaw - here.yaw) * 0.14, 6), pitch: clamp((target.pitch - here.pitch) * 0.14, 4) });
    };

    // The third day has no objective written on the map any more.
    ctx.onEnter(() => { if (w.state.journal.objective) w.patch("journal", { objective: null }); });

    /* 长椅上没有钟 (v4 §7), and §6 prices this whole stand at 免费. The engine does not know that: UISystem
       charges `phone:shoot` a minute and one percent, PowerSystem charges every `phone:open` the same (see
       requests.engine). Both handlers run before these two, so this puts the minute and the percent back. */
    ctx.on("clock:advance", ({ minutes }) => {
      const whole = Math.max(0, Math.round(minutes));
      if (!whole) return;
      w.patch("clock", { minuteOfDay: w.state.clock.minuteOfDay - whole });
      w.patch("stats", { minutesSpent: Math.max(0, w.state.stats.minutesSpent - whole) });
      w.set("phone", { ...w.state.phone, minuteOfDay: w.state.phone.minuteOfDay - whole });
    });
    ctx.on("power:drain", ({ source, value }) => {
      if (source !== "phone" || !value || w.state.power.phone <= 0) return;
      const battery = Math.min(100, w.state.power.phone + value);
      w.patch("power", { phone: battery });
      w.set("phone", { ...w.state.phone, battery: Math.round(battery) });
    });

    /* --- She remembers the page. It is hers to remember: it arrives on the second breath she takes sitting here,
       or on the second thing she looks at, or the moment she opens the album. Never on a timer. --- */
    const remember = () => {
      if (ctx.flag(REMEMBERED, false) || ctx.flag(TRANSLATED, false)) return;
      ctx.setFlag(REMEMBERED, true);
      ctx.kick("glance", 0.5, { yaw: 0, pitch: -5 });
      ctx.sfx("cloth", 0, 0.5);
      ctx.say("那封信。只有这部手机拍下了它。", { tag: "bench-remember" });
    };

    /* --- Raising her eyes. A turn of the head and a sound from that side; the world answers, she does not talk. --- */
    const seen = new Set<EntityId>();
    const look = (entry: Look) => {
      ctx.setFlag(LOOKED_AT, entry.id);
      glanceAt(entry.at, 0.55);
      ctx.sfx(entry.sound, entry.pan, entry.strength);
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      ctx.bump(LOOKED, 1);
      // The slope answers twice: a second bell, further off, from a herd she never sees.
      if (entry.id === "far-slope") ctx.after(640, () => ctx.sfx("clink", 0.45, 0.2));
      if (entry.id === "playground") ctx.after(520, () => ctx.sfx("clink", 0.6, 0.18));
      if (seen.size >= 2) remember();
    };
    for (const entry of LOOKS) {
      ctx.onInteract(entry.id, () => look(entry));
      ctx.onGaze(entry.id, () => look(entry));
    }

    /* --- One last photograph, taken the way every other one this run was taken: from the phone's own camera.
       Whatever it was pointed at is the thing her eyes were on, so it can still own the last line. --- */
    ctx.on("phone:photo", ({ scene }) => {
      if (scene !== "bench") return;
      const target = landing();
      if (target) ctx.setFlag(LOOKED_AT, target.id);
    });

    /* --- Sitting down. Ten hours of walking were three days ago and her legs still know it. --- */
    ctx.onInteract("bench", () => {
      const first = !ctx.flag(SAT, false);
      ctx.setFlag(SAT, true);
      ctx.kick("settle", first ? 1 : 0.35, { yaw: 0, pitch: -2 });
      ctx.sfx("cloth", -0.2, first ? 0.6 : 0.3);
      w.emit("body:rest", { seconds: first ? 6 : 3 });
      if (first) w.emit("ambience", { overrides: { wind: 0.45 } });
    });

    /* --- Their piece of paper, out of the pack. Two numbers in two hands; she reads them and folds it back. --- */
    ctx.on("item:use", ({ item }) => {
      if (item !== "contactCard" || ctx.flag(NOTE, false)) return;
      ctx.setFlag(NOTE, true);
      if (w.state.ui.overlay === "pack") ctx.close();
      ctx.hand(NOTE_AT, "grip");
      ctx.sfx("paper", -0.15, 0.5);
      ctx.kick("glance", 0.4, { yaw: -2, pitch: -3 });
    });
    ctx.onInteract("note", () => {
      const first = !ctx.flag(NOTE_READ, false);
      ctx.setFlag(NOTE_READ, true);
      ctx.hand(NOTE_AT, "grip");
      ctx.sfx("paper", 0, first ? 0.55 : 0.3);
      ctx.kick("settle", 0.3);
      if (first) ctx.say("他们的字。", { tag: "bench-note" });
    });

    /* --- The album, start to finish. Every frame in it is a shutter the player pressed (v4 §12 D8). --- */
    ctx.onAction("phone:tab", (value) => {
      if (value !== "gallery" || ctx.flag(GALLERY, false)) return;
      ctx.setFlag(GALLERY, true);
      ctx.sfx("tick", 0, 0.3);
      ctx.kick("settle", 0.2);
      remember();
    });

    /* --- Where the last line comes down: the last thing she actually raised her eyes to — a click on it, or the
       pointer resting on it long enough for the dwell to fire, both go through `look()` and both write LOOKED_AT.
       Only if she never looked up at anything does the pointer's own direction decide it. (Reading LOOKED_AT
       second made the pointer win every time: far-slope sits 11° off the resting centre, so it took every line
       however deliberately the player had turned to something else.) --- */
    const landing = (): Look | null => {
      const last = ctx.flag<string>(LOOKED_AT, "");
      const looked = LOOKS.find((entry) => entry.id === last);
      if (looked) return looked;
      const gaze = w.rt.gaze;
      let best: Look | null = null;
      // About the width of a reveal: nearer than this she is looking at that thing, further and she is not.
      let nearest = 14;
      for (const entry of LOOKS) {
        const degrees = Math.hypot(entry.at.yaw - gaze.yaw, (entry.at.pitch - gaze.pitch) * 1.4);
        if (degrees < nearest) { nearest = degrees; best = entry; }
      }
      return best;
    };

    /* --- The last line. The wind drops, the music comes in on the flag, and she stops being able to see straight. --- */
    const finish = () => {
      ctx.setFlag(LINES, ZH_COUNT);
      ctx.setFlag(TRANSLATED, true);
      w.emit("body:rest", { seconds: 10 });
      w.emit("ambience", { overrides: { wind: 0.26, birds: 0.5 } });
      ctx.sfx("exhale", 0, 1);
      ctx.kick("settle", 1.2);
      const target = landing();
      ctx.setFlag(LANDED, target ? target.id : "bench");
      if (target) { glanceAt(target.at, 0.8); ctx.after(420, () => ctx.sfx(target.sound, target.pan, target.strength + 0.15)); }
      else { ctx.sfx("cloth", -0.2, 0.4); }
      ctx.say(target ? target.line : BENCH_LINE, { priority: 1, tag: "bench-landing" });
    };

    /* --- One line per press, in the phone. Paper under her thumb, a breath halfway down the page. --- */
    ctx.onAction("bench:translate", () => {
      if (ctx.flag(TRANSLATED, false)) return;
      const read = ctx.bump(LINES, 1);
      ctx.sfx("paper", 0, 0.22);
      ctx.kick("settle", 0.12);
      if (read === 4) ctx.sfx("breath", 0, 0.5);
      if (read >= ZH_COUNT) finish();
    });

    /* --- The bus. It comes the first time she looks up from the phone, and after that it stays. --- */
    const busArrives = () => {
      if (!ctx.flag(TRANSLATED, false) || ctx.flag(BUS, false)) return;
      ctx.setFlag(BUS, true);
      ctx.sfx("slide", 0.6, 0.55);
      w.emit("ambience", { overrides: { engine: 0.3 } });
      ctx.after(460, () => { ctx.sfx("brake", 0.3, 0.7); ctx.kick("brake", 0.35); });
      ctx.after(880, () => ctx.sfx("doorOpen", 0.1, 0.7));
    };
    ctx.on("phone:close", busArrives);
    ctx.on("gaze:dwell", busArrives);
    ctx.on("interact:done", busArrives);
    ctx.on("overlay", busArrives);

    /* --- Sitting still. The grass, a bell somewhere across the road, and the page she has not opened yet. --- */
    let waits = 0;
    ctx.onWait(() => {
      waits += 1;
      busArrives();
      w.emit("body:rest", { seconds: 4 });
      if (waits === 1) { ctx.kick("settle", 0.25); ctx.sfx("cloth", -0.2, 0.35); return; }
      if (waits === 2) { ctx.fx("gust", 0.35); ctx.kick("turn", 0.3); remember(); return; }
      if (waits % 3 === 0) ctx.sfx("clink", 0.45, 0.22);
      else ctx.sfx("breath", 0, 0.28);
    });

    /* --- Getting on. The step, the door, and the valley behind her. --- */
    ctx.onInteract("board", () => {
      ctx.kick("step", 0.9);
      ctx.sfx("step", 0, 0.8);
      ctx.sfx("doorClose", 0.1, 0.6);
      w.dispatch({ type: "flow", action: "complete" });
    });
  },
});
