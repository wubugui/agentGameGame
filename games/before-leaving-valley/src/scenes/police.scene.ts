/* The Carabinieri office in Canazei, 10:05 on the third day (SOURCE_TRANSCRIPT, day 3 §16): one hour after a
   woman she had never seen asked her "Have you lost your phone?" and told her the bus went to the police station,
   the phone she had already said goodbye to comes back over the counter, undamaged. Nobody here knows who found
   it in the folded valleys, who carried it down, or how that woman knew it was hers — he only spreads his hands
   (v4 §12 B7: the officer adds nothing at all).

   The room is painted: the green noticeboard with the valley map and a typed sheet pinned under it, the crucifix,
   the two flags, the open door into the back room with its filing cabinets and coat stand, the perspex screen and
   the green rotary telephone on the wooden counter, the desk pad, the open window onto the mountains and the
   village, the geranium on the sill, the tiled floor. Everything that moves or is handed over is a sprite: the
   officer, and her own phone lying on the desk pad.

   Coordinates read off the 150°×84° grid of 21-police (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84,
   W×H = 1280×720); the pixel each one came from is noted beside it. */
import { all, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { goArrow, readable } from "./_shared";

/* Painted in 21-police. */
const WALL_MAP: Transform = { yaw: -53, pitch: 11 };        // the valley map pinned on the green board (185, 265)
const NOTICE: Transform = { yaw: -49, pitch: -11 };         // the typed sheet pinned under it (225, 452)
const BACK_ROOM: Transform = { yaw: -13, pitch: -3 };       // the open door, cabinets and coat stand behind it (529, 385)
const DESK_PHONE: Transform = { yaw: 7, pitch: -17 };       // the green rotary telephone on the counter (700, 505)
const COUNTER: Transform = { yaw: -16, pitch: -25 };        // the bare counter top at its near end, left of the pad (503, 574)
const WINDOW: Transform = { yaw: 54, pitch: 13, distance: 40 };  // the mountains through the open window (1101, 249)
const GERANIUM: Transform = { yaw: 54, pitch: -5.5 };       // the geranium on the windowsill (1101, 407)
const DOORWAY_OUT: Transform = { yaw: 42, pitch: -31 };     // the tiles and the mat by the way out (1000, 626)
/* Sprites: the man behind the counter, and her phone on the green desk pad in front of him. */
const OFFICER: Transform = { yaw: -4, pitch: -12 };         // behind the counter, in the open doorway (606, 463; cut off at the counter line, 550)
const PAD: Transform = { yaw: -3, pitch: -23.2 };           // the middle of the green desk pad, where he sets it down (614, 559)
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };        // story actions: E-key prompts, never drawn on the painting

const GREETED = "police.greeted", ASKED = "police.asked", STEP = "police.step";
const RETURNED = "police.returned", SHRUG = "police.shrug", GALLERY = "police.gallery";
const HANDED = "police.handed";                             // the phone has left his hand and is on the pad
const SHRUG_HELD = "police.shrugHeld";                      // his hands are still out (a second, not for ever)
const AWAY = flag(STEP, { eq: 1 });                          // he is in the back room
/** Between the door opening and the small knock on the counter he is carrying it; after that the pad has it. */
const HANDING = all(flag(STEP, { gte: 2 }), not(flag(HANDED)));
const ON_PAD = all(flag(HANDED), not(flag(RETURNED)));
const SHRUGGING = all(flag(SHRUG), flag(SHRUG_HELD));

export default defineScene({
  id: "police",
  day: 3, place: "Canazei · Carabinieri", elevation: "1,460 m",
  painting: "pano/21-police.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.06, windTone: 1100, birds: 0.12, crickets: 0, stream: 0, engine: 0.04, heater: 0.16 },
  interior: true,
  arriveAt: 10 * 60 + 5,
  fallback: "这里很安静。",
  // v4 §8: phoneReturned. Nothing else is asked of her here; the album, the map and the question are all optional.
  exitWhen: flag(RETURNED),
  entities: [
    // The man behind the counter. He nods, he goes into the back room, he comes back, and at the end he spreads his hands.
    { id: "officer", transform: OFFICER,
      sprite: { src: "sprites/officer.webp", layer: "figure", sizeVh: 34, swap: [
        { when: SHRUGGING, src: "sprites/officer-shrug.webp" },
        { when: HANDING, src: "sprites/officer-returning.webp" },
      ] },
      // GazeSystem reads `interactable.reveal` first and falls back to `gaze.radius`: one number, written twice.
      interactable: { verbs: ["talk"], label: "柜台后的警察", reveal: 16, cost: { minutes: 0 } },
      gaze: { radius: 16, dwell: 800 },
      visible: not(AWAY) },
    // The door into the back room: cabinets, a coat stand, and the drawer that is opened somewhere behind it.
    { id: "back-room", transform: BACK_ROOM,
      interactable: { verbs: ["inspect"], label: "里屋的门", reveal: 13, cost: { minutes: 0 } },
      gaze: { radius: 13, dwell: 900 } },
    // Her phone, on the green pad, screen down, not a scratch on it. Holding it is taking it back (v4 §8 phoneReturned).
    { id: "phone-returned", transform: PAD, className: "hold-hotspot",
      sprite: { src: "sprites/phone-returned.webp", layer: "prop", sizeVh: 3 },
      interactable: { verbs: ["hold"], label: "我的手机", reveal: 15 },
      hold: { ms: 700, scaleWith: ["fatigue"] },
      visible: ON_PAD },
    // The valley map on the noticeboard: Val Lasties is on it, a finger wide (v4 §6). Free, and she says nothing about it.
    readable("wall-map", WALL_MAP, "墙上的山谷地图", {
      kind: "board", title: "Gruppo del Sella · Val di Fassa",
      lines: ["Passo Sella 2240", "Piz Selva 2941", "Val Lasties 2455", "656 · Plan de Roces", "Canazei 1460"],
      entry: "E-valleyMap", minutes: 0,
    }),
    // The typed sheet pinned under the map. Italian, and that is as far as she gets.
    { id: "notice", transform: NOTICE,
      interactable: { verbs: ["inspect"], label: "钉着的公告", reveal: 12, cost: { minutes: 0 } } },
    // The green telephone on the counter. It is the office's, not hers; she only looks.
    { id: "desk-phone", transform: DESK_PHONE,
      interactable: { verbs: ["inspect"], label: "柜台上的电话", reveal: 12, cost: { minutes: 0 } } },
    // The counter itself: she puts both hands flat on it while she waits.
    { id: "counter", transform: COUNTER,
      interactable: { verbs: ["use"], label: "柜台", reveal: 14, cost: { minutes: 0 } } },
    // Out of the open window: the same wall she was under two days ago, and the roofs under it.
    { id: "window-view", transform: WINDOW,
      interactable: { verbs: ["inspect"], label: "窗外的山", reveal: 13, cost: { minutes: 0 } },
      gaze: { radius: 13, dwell: 900 } },
    { id: "geranium", transform: GERANIUM,
      interactable: { verbs: ["inspect"], label: "窗台上的花", reveal: 12, cost: { minutes: 0 } } },
    // The three things she does to a person here. None of them is on the painting.
    { id: "describe", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["talk"], label: "描述那台手机", reveal: 24, cost: { minutes: 1 }, once: true },
      visible: not(flag(ASKED)) },
    { id: "ask-who", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["talk"], label: "问是谁送来的", reveal: 24, cost: { minutes: 1 }, once: true },
      visible: all(flag(RETURNED), not(flag(SHRUG))) },
    { id: "album", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["use"], label: "翻相册", reveal: 24, cost: { minutes: 0 } },
      visible: flag(RETURNED) },
    /* Out. The bench is at Passo Sella, 2,240 m (docs/ART_AUDIT.md, 22-bench), and this counter is down in
       Canazei at 1,460 m: the way back up is the same hour of hairpins the 472 brought her down, not a walk. */
    goArrow("go", DOORWAY_OUT, { to: "bench", minutes: 60, label: "上车回山口", kind: "walk" }),
  ],
  seed: (w) => {
    // The invariant this scene owns (SCENE_AUTHORING §6): the phone is back in her hands and the flag is set.
    if (!w.state.inventory.items.includes("phone")) w.emit("item:gain", { item: "phone", from: null });
    w.setFlag("phone.lost", false);
    w.setFlag(GREETED, true); w.setFlag(ASKED, true); w.setFlag(STEP, 3);
    w.setFlag(RETURNED, true); w.setFlag(SHRUG, true); w.setFlag(GALLERY, true);
    w.setFlag(HANDED, true); w.setFlag(SHRUG_HELD, false); w.setFlag("police.albumLine", true);
    w.emit("phone:returned", {});
    // Two nights of sleep between the forest and this counter: the body she carries into the last scene is rested.
    if (w.state.body.fatigue > 0) w.emit("body:fatigue", { delta: -1, reason: "第三天" });
    if (w.state.body.fear > 0) w.emit("body:fear", { delta: -1, reason: "第三天" });
    // Through the same door the played path uses: JournalSystem drops an id data/entries.ts does not have yet,
    // so a warped save and a played one show the same page instead of one of them printing a bare id.
    w.emit("journal:entry", { entry: "E-valleyMap", source: null });
  },
  walkthrough: [
    { type: "interact", entity: "describe", verb: "talk" },
    { wait: 500 },
    { type: "interact", entity: "back-room", verb: "inspect" },
    { wait: 900 },
    { type: "hold:start", entity: "phone-returned" },
    { wait: 2100 },
    { type: "hold:end" },
    { wait: 500 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Everything the room has: the map, the sheet, the window, the flower, the counter, the album, and the question.
    thorough: [
      { type: "interact", entity: "wall-map", verb: "read" }, { type: "overlay:close" }, { wait: 400 },
      { type: "interact", entity: "notice", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "window-view", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "geranium", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "officer", verb: "talk" }, { wait: 400 },
      { type: "interact", entity: "describe", verb: "talk" }, { wait: 500 },
      { type: "interact", entity: "counter", verb: "use" }, { wait: 400 },
      { type: "wait" }, { wait: 600 },
      { type: "wait" }, { wait: 800 },
      { type: "hold:start", entity: "phone-returned" }, { wait: 2100 }, { type: "hold:end" }, { wait: 600 },
      { type: "interact", entity: "album", verb: "use" }, { wait: 700 },
      { type: "ui:action", id: "phone:tab", value: "gallery" }, { wait: 6600 },
      { type: "phone:close" }, { wait: 400 },
      { type: "interact", entity: "ask-who", verb: "talk" }, { wait: 900 },
      { type: "interact", entity: "desk-phone", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // She says what it looks like and takes it back, and never asks the question nobody can answer.
    quiet: [
      { type: "interact", entity: "describe", verb: "talk" }, { wait: 500 },
      { type: "wait" }, { wait: 600 },
      { type: "wait" }, { wait: 800 },
      { type: "hold:start", entity: "phone-returned" }, { wait: 2100 }, { type: "hold:end" }, { wait: 500 },
      { type: "travel", entity: "go" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;
    const glance = (dYaw: number, dPitch: number, strength = 0.4) => ctx.kick("glance", strength, { yaw: dYaw, pitch: dPitch });
    const step = () => ctx.flag<number>(STEP, 0);
    /* How long she has been standing there since he went through the door — not how long she has been in the
       room. Waiting before she has said anything must not spend the beat behind the wall. */
    let waited = 0;
    /* When she last said something out loud, so the second short line cannot cut the first one off (v4 §12 C3). */
    let saidAt = -Infinity;

    /* Two nights between the forest and this counter. The breath she comes in with is not last night's. */
    ctx.onEnter(() => {
      if (w.state.body.fatigue > 0) w.emit("body:fatigue", { delta: -1, reason: "第三天" });
      if (w.state.body.fear > 0) w.emit("body:fear", { delta: -1, reason: "第三天" });
    });

    /* He is reading something when she comes in; he puts it down. */
    const greet = () => {
      if (ctx.flag(GREETED, false)) {
        // Looking at him again: he looks back up from what he is doing. Nothing is said either time.
        ctx.sfx("cloth", 0.05, 0.3);
        glance(1, 1, 0.2);
        return;
      }
      ctx.setFlag(GREETED, true);
      ctx.sfx("paper", 0.05, 0.45);
      glance(1, 1, 0.35);
    };
    ctx.onGaze("officer", greet);
    ctx.onInteract("officer", greet);

    /* She says what it looks like, with her hands. He nods and goes through the door behind him. */
    ctx.onInteract("describe", () => {
      if (step() !== 0) return;
      greet();
      ctx.setFlag(ASKED, true);
      ctx.setFlag(STEP, 1);
      waited = 0;
      ctx.hand({ yaw: 3, pitch: -19 }, "grip");
      ctx.kick("settle", 0.45);
      ctx.sfx("tock", -0.1, 0.5);
      ctx.after(650, () => { ctx.sfx("doorClose", -0.4, 0.45); glance(-2, 0, 0.3); });
    });

    /* And he comes back with it. Looking through the door does it, and so does standing there long enough. */
    const bringBack = () => {
      if (step() !== 1) return;
      ctx.setFlag(STEP, 2);
      ctx.sfx("doorOpen", -0.35, 0.5);
      ctx.kick("turn", 0.45, { yaw: -1, pitch: 0 });
      // He carries it over, and six hundred milliseconds later it is on the pad and out of his hand.
      ctx.after(600, () => { ctx.sfx("tock", -0.15, 0.7); ctx.kick("settle", 0.4); ctx.setFlag(HANDED, true); });
    };
    ctx.onGaze("back-room", bringBack);
    ctx.onInteract("back-room", () => {
      if (step() === 1) { bringBack(); return; }
      glance(-3, 0, 0.35); ctx.sfx("slide", -0.45, 0.3);
    });

    /* Taking it back. The hold is her hand closing round it; the room's music starts on the flag (AudioSystem). */
    ctx.onHold("phone-returned", () => {
      if (ctx.flag(RETURNED, false)) return;
      ctx.setFlag(RETURNED, true);
      ctx.setFlag(STEP, 3);                 // out of his hand, off the pad, back in hers: where the seed says it ends
      ctx.setFlag("phone.lost", false);
      ctx.give("phone", "phone-returned");
      w.emit("phone:returned", {});
      ctx.hand({ ...PAD, pitch: PAD.pitch + 2 }, "grip");
      ctx.kick("settle", 0.8);
      ctx.sfx("cloth", -0.1, 0.6);
      ctx.say("完好无损。", { priority: 1, tag: "police-back" });
      saidAt = w.rt.now;
    });
    ctx.onRelease("phone-returned", (progress) => {
      if (progress <= 0.2) return;
      ctx.sfx("tock", -0.15, 0.3); glance(-1, -2, 0.3);
    });

    /* The question. He spreads his hands, and that is the whole answer, now and afterwards (v4 §12 B7). */
    ctx.onInteract("ask-who", () => {
      if (ctx.flag(SHRUG, false)) return;
      ctx.setFlag(SHRUG, true);
      ctx.setFlag(SHRUG_HELD, true);
      ctx.sfx("cloth", 0.05, 0.55);
      glance(0, 1, 0.45);
      // His hands go out, and then they come down again: he does not hold the gesture for the rest of the morning.
      ctx.after(600, () => ctx.sfx("exhale", 0.05, 0.4));
      ctx.after(900, () => ctx.setFlag(SHRUG_HELD, false));
    });

    /* Every phone:open in this room is free (v4 §7: 警局的相册不花代价). PowerSystem charges every one of them a
       minute and one percent with no day-three exception (see requests.engine), so this room puts them back: the
       handler runs after PowerSystem's on the same event, so what it undoes has already happened. */
    ctx.on("phone:open", () => {
      const clock = w.state.clock, phone = w.state.phone;
      w.patch("clock", { minuteOfDay: clock.minuteOfDay - 1 });
      w.patch("stats", { minutesSpent: Math.max(0, w.state.stats.minutesSpent - 1) });
      const charged = !w.flag("phone.lost", false) && w.state.power.phone > 0;   // 0% was already 0% before it opened
      const battery = Math.min(100, w.state.power.phone + (charged ? 1 : 0));
      w.patch("power", { phone: battery });
      w.set("phone", { ...phone, minuteOfDay: phone.minuteOfDay - 1, battery: Math.round(battery) });
    });

    /* The album: every shutter of that day except one is the player's own (v4 §12 D8). */
    const album = () => {
      if (!ctx.flag(RETURNED, false)) return;
      if (ctx.flag(GALLERY, false)) return;
      ctx.setFlag(GALLERY, true);
      ctx.sfx("tick", 0, 0.4);
      glance(0, -2, 0.3);
    };
    /* And what she says about it comes when the phone goes back down — never on top of 完好无损。, which is only
       a second or two old when the album opens (v4 §12 C3: 任意两句之间 ≥6 秒). */
    ctx.on("phone:close", () => {
      if (!ctx.flag(GALLERY, false) || ctx.flag("police.albumLine", false)) return;
      if (w.rt.now - saidAt < 6000) return;
      if (!w.state.phone.photos.some((photo) => photo.kind === "letter")) return;
      ctx.setFlag("police.albumLine", true);
      saidAt = w.rt.now;
      ctx.say("一张都没少。", { priority: 1, tag: "police-album" });
    });
    ctx.onInteract("album", () => { w.dispatch({ type: "phone:open", tab: "gallery" }); });
    ctx.on("phone:open", ({ tab }) => { if (tab === "gallery") album(); });
    ctx.onAction("phone:tab", (value) => { if (value === "gallery") album(); });

    /* The board on the left wall. The map says where Val Lasties is; she does not say it after it. */
    ctx.onInteract("wall-map", (verb) => {
      if (verb !== "read") return;
      ctx.hand(WALL_MAP); glance(-4, 1, 0.35);
    });
    ctx.onInteract("notice", () => {
      ctx.hand(NOTICE); ctx.sfx("paper", -0.5, 0.4); glance(-3, -1, 0.3);
      ctx.say("意大利语。", { tag: "police-notice" });
    });

    /* Things in the room that answer and say nothing: the counter under her hands, the telephone, the flower. */
    ctx.onInteract("counter", () => {
      ctx.hand({ ...COUNTER, pitch: COUNTER.pitch - 2 }, "grip");
      ctx.kick("settle", 0.35); ctx.sfx("tock", 0.25, 0.35);
      w.emit("body:rest", { seconds: 3 });
    });
    ctx.onInteract("desk-phone", () => { ctx.sfx("tick", 0.2, 0.4); glance(1, -2, 0.3); });
    ctx.onInteract("geranium", () => { ctx.hand(GERANIUM); ctx.sfx("cloth", 0.55, 0.35); glance(4, -1, 0.3); });

    /* The open window: the wall she spent a day under is on the other side of it, and the village is awake. */
    const outside = () => {
      if (ctx.flag("police.window", false)) return;
      ctx.setFlag("police.window", true);
      w.emit("ambience", { overrides: { birds: 0.3, engine: 0.09, wind: 0.12 } });
      ctx.kick("turn", 0.45, { yaw: 2, pitch: 1 });
      ctx.sfx("breath", 0.5, 0.45);
    };
    ctx.onGaze("window-view", outside);
    ctx.onInteract("window-view", outside);

    /* Standing still. While he is in the back a drawer runs somewhere behind the wall; the second time, he comes back. */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (step() === 1) {
        waited += 1;
        if (waited === 1) { ctx.sfx("slide", -0.5, 0.5); glance(-2, 0, 0.3); return; }
        bringBack();
        return;
      }
      if (stills % 2 === 0) ctx.sfx("tick", -0.1, 0.25);
      else ctx.sfx("cloth", 0.4, 0.2);
      ctx.kick("settle", 0.18);
    });
  },
});
