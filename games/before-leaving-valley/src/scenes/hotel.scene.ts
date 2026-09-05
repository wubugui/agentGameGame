/* The hotel room in Canazei, the evening of the second day (SOURCE_TRANSCRIPT §13–14). She came down off the forest
   path with nothing, and spent what is left of the day on the room telephone: twenty-odd hotels and tourist offices,
   and the answer was no every time. The laptop on the desk still has Find My open on a circle that has not moved
   since last night. Nothing in this room can find the phone (v4 §12 B6) and nothing in it rewards the player:
   putting the receiver down is the only thing the night is waiting for, and closing Find My — the heaviest optional
   action in the game (v4 §7) — pays exactly nothing except that on the bench, two days later, the sentence about
   being ready to lose something forever is one the player pressed himself.

   Mom's joke arrives after the receiver goes down (v4 §8, 可发现的事). Her own phone is in the forest, so it comes
   the only way it can reach this room: the hotel telephone rings back. That is the single inference in the scene.

   Every coordinate is read off the 150°×84° grid of 19-hotel (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84,
   W×H = 1280×720); the pixel each one came from is noted beside it. */
import { all, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { goArrow } from "./_shared";

/* Painted into 19-hotel: the long desk under the two framed meadows, the lit lamp, the chair pulled out,
   the bay window over the valley, the radiator with its towel, the bed in the right-hand corner. */
const LAPTOP: Transform = { yaw: -45, pitch: -14.5, distance: 6 };      // desk top, left of the lamp (256, 485)
const NOTEPAD: Transform = { yaw: -38, pitch: -14.2, distance: 6 };     // desk top, between laptop and telephone (315, 490)
const ROOM_PHONE: Transform = { yaw: -33, pitch: -13.5, distance: 6 };  // desk top, right under the lamp (358, 476)
const LAMP: Transform = { yaw: -33, pitch: 5, distance: 8 };            // the lit shade of the desk lamp (358, 317)
const JACKET: Transform = { yaw: -25, pitch: -18, distance: 7 };        // the back of the chair (427, 514)
const WALL_PICTURE: Transform = { yaw: -43, pitch: 19, distance: 12 };  // the framed alpine meadow on the panelling (270, 200)
const PACK: Transform = { yaw: -10, pitch: -35.5, distance: 7 };        // the boards between desk and radiator (555, 664)
const RADIATOR: Transform = { yaw: 5, pitch: -20, distance: 8 };        // the white radiator under the window (683, 531)
const VILLAGE: Transform = { yaw: 26.5, pitch: 3, distance: 40 };       // the church tower and the village lights (866, 334)
const OPEN_WINDOW: Transform = { yaw: 52, pitch: 6, distance: 9 };      // the casement standing open on the right (1084, 309)
const BED: Transform = { yaw: 65, pitch: -22, distance: 8 };            // the striped blanket, turned down (1195, 549)

/** Evening: the whole day between the forest path and this room went into the circle on the screen. */
const EVENING = 20 * 60 + 15;
/** v4 §8: 打过 8 通之后随时可以放下. Before that the receiver simply goes back in its cradle. */
const CALLS_BEFORE_DONE = 8;
/** view/overlays/HotelCalls.tsx keeps the book: twenty-two places she could think of to ring. */
const CALLS_IN_BOOK = 22;

const listOf = (value: string) => value.split(",").filter(Boolean);

export default defineScene({
  id: "hotel",
  day: 2, place: "酒店房间 · 晚上", elevation: "1,450 m",
  painting: "pano/19-hotel.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.06, windTone: 800, birds: 0, crickets: 0.12, stream: 0, engine: 0, heater: 0.18 },
  interior: true,
  idleLook: true,
  arriveAt: EVENING,
  fallback: "手上还有山里的灰。",
  // The night is over when the receiver goes down, and not before (v4 §8, 离开条件：放下电话).
  exitWhen: flag("hotel.hungUp"),
  entities: [
    /* The laptop she left open this morning. The circle on it is the same circle, and it has not moved.
       Closing it is free, reversible by nothing, and worth nothing at all (v4 §7). */
    {
      id: "laptop", transform: LAPTOP,
      sprite: {
        src: "sprites/laptop-open.webp", layer: "prop", sizeVh: 10,
        swap: [{ when: flag("hotel.findmyOff"), src: "sprites/laptop-closed.webp" }],
      },
      interactable: { verbs: ["use"], label: "开着的电脑", reveal: 12, cost: { minutes: 0 } },
      enabled: not(flag("hotel.findmyOff")),
      gaze: { radius: 12, dwell: 900 },
    },
    /* Her own page out of the notebook, twenty-two numbers copied off the local directory. It never opens:
       it only fills up with crossed-off lines while she works down it. */
    {
      id: "notepad", transform: NOTEPAD,
      sprite: {
        src: "sprites/notepad-list.webp", layer: "prop", sizeVh: 3,
        swap: [{ when: flag("hotel.calls", { gte: CALLS_BEFORE_DONE }), src: "sprites/notepad-crossed.webp" }],
      },
    },
    /* The room telephone. Everything this evening goes through it — the calls, and, once she has put it down,
       the one call that comes the other way. The handset lying off its cradle is the only thing that says so. */
    {
      id: "room-phone", transform: ROOM_PHONE,
      sprite: {
        src: "sprites/desk-phone.webp", layer: "prop", sizeVh: 5,
        swap: [{ when: all(flag("hotel.momPing"), not(flag("hotel.momHeard"))), src: "sprites/desk-phone-handset.webp" }],
      },
      interactable: { verbs: ["use"], label: "桌上的电话", reveal: 12, cost: { minutes: 0 } },
    },
    /* Over the back of the chair, where it has been since last night. The snag on the sleeve is only hers,
       and it only means what the morning already meant: she came through there (v4 §4, redJacket). */
    {
      id: "jacket", transform: JACKET,
      sprite: { src: "sprites/jacket-chairback.webp", layer: "prop", sizeVh: 19 },
      interactable: { verbs: ["inspect"], label: "椅背上的红冲锋衣", reveal: 12, cost: { minutes: 0 } },
    },
    /* The hotel's own decoration: a painted alpine meadow, framed, on the panelling above the desk. */
    { id: "wall-picture", transform: WALL_PICTURE, interactable: { verbs: ["inspect"], label: "墙上镶框的草地画", reveal: 12, cost: { minutes: 0 } } },
    /* The pack on the floorboards. Opening it is the only place the empty slot can be seen (v4 §3.6). */
    {
      id: "pack-down", transform: PACK,
      sprite: { src: "sprites/backpack-floor.webp", layer: "prop", sizeVh: 18 },
      interactable: { verbs: ["use"], label: "地上的背包", reveal: 13, cost: { minutes: 0 } },
    },
    /* Two days of cold rock. Holding on to the radiator is the whole of it. */
    {
      id: "radiator", transform: RADIATOR, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "窗下的暖气片", reveal: 12 },
      hold: { ms: 800 },
    },
    /* Out of the glass: the village down in the valley with its lights on, and the church tower in the middle. */
    {
      id: "village-lights", transform: VILLAGE,
      interactable: { verbs: ["inspect"], label: "谷底的村灯", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 12, dwell: 900 },
    },
    /* The casement that is standing open on the right of the bay. Pushing it wider lets the valley in. */
    { id: "open-window", transform: OPEN_WINDOW, interactable: { verbs: ["use"], label: "开着的那扇窗", reveal: 13, cost: { minutes: 0 } } },
    /* The bed, turned down by somebody else this afternoon. */
    { id: "bed", transform: BED, interactable: { verbs: ["inspect"], label: "铺好的床", reveal: 13, cost: { minutes: 0 } } },
    /* The way out of the second day is the switch on the lamp (v4 §8: 离开条件 放下电话 gates it). */
    goArrow("go-lamp", LAMP, { to: "busStop", minutes: 0, label: "关掉台灯", kind: "walk" }),
  ],
  seed: (w) => {
    // What the evening leaves behind: the whole book rung through, the receiver down, Find My off, mom's joke heard.
    w.setFlag("hotel.called", Array.from({ length: CALLS_IN_BOOK }, (_, index) => String(index)).join(","));
    w.setFlag("hotel.calls", CALLS_IN_BOOK);
    w.setFlag("hotel.hungUp", true);
    w.setFlag("hotel.findmyOff", true);
    w.setFlag("hotel.momPing", true);
    w.setFlag("hotel.momHeard", true);
    w.patch("journal", { entries: Array.from(new Set([...w.state.journal.entries, "E-hotels", "E-mama"])) });
    // Two days on her feet end here; the third day starts rested and warm.
    w.patch("body", { fatigue: 0, fear: 0 });
  },
  walkthrough: [
    { type: "interact", entity: "room-phone", verb: "use" },
    { wait: 300 },
    { type: "ui:action", id: "hotel:call", value: 0 },
    { type: "ui:action", id: "hotel:call", value: 1 },
    { type: "ui:action", id: "hotel:call", value: 2 },
    { type: "ui:action", id: "hotel:call", value: 3 },
    { wait: 300 },
    { type: "ui:action", id: "hotel:call", value: 4 },
    { type: "ui:action", id: "hotel:call", value: 5 },
    { type: "ui:action", id: "hotel:call", value: 6 },
    { type: "ui:action", id: "hotel:call", value: 7 },
    { wait: 400 },
    { type: "ui:action", id: "hotel:hangup" },
    { wait: 600 },
    { type: "travel", entity: "go-lamp" },
  ],
  variants: {
    // Everything the room has: the whole book, mom on the line, the jacket, the window, the radiator, the lamp.
    thorough: [
      { type: "interact", entity: "laptop", verb: "use" },
      { wait: 500 },
      { type: "overlay:close" },
      { type: "interact", entity: "jacket", verb: "inspect" },
      { wait: 6500 },
      { type: "interact", entity: "room-phone", verb: "use" },
      { wait: 300 },
      ...Array.from({ length: CALLS_IN_BOOK }, (_, index) => ({ type: "ui:action" as const, id: "hotel:call", value: index })),
      { wait: 600 },
      { type: "ui:action", id: "hotel:hangup" },
      { wait: 1200 },
      { type: "interact", entity: "room-phone", verb: "use" },
      { wait: 6500 },
      { type: "interact", entity: "village-lights", verb: "inspect" },
      { wait: 1200 },
      { type: "interact", entity: "open-window", verb: "use" },
      { wait: 1200 },
      { type: "hold:start", entity: "radiator" },
      { wait: 2000 },
      { type: "hold:end" },
      { wait: 6500 },
      { type: "interact", entity: "wall-picture", verb: "inspect" },
      { wait: 1000 },
      { type: "interact", entity: "pack-down", verb: "use" },
      { wait: 600 },
      { type: "overlay:close" },
      { type: "interact", entity: "bed", verb: "inspect" },
      { wait: 800 },
      { type: "interact", entity: "laptop", verb: "use" },
      { wait: 600 },
      { type: "ui:action", id: "findmy:off" },
      { wait: 1500 },
      { type: "travel", entity: "go-lamp" },
    ],
    // Eight calls, and Find My left running on the desk all night: the sentence on the bench stays hers alone.
    keep: [
      { type: "interact", entity: "room-phone", verb: "use" },
      { wait: 300 },
      ...Array.from({ length: CALLS_BEFORE_DONE }, (_, index) => ({ type: "ui:action" as const, id: "hotel:call", value: index })),
      { wait: 400 },
      { type: "ui:action", id: "hotel:hangup" },
      { wait: 600 },
      { type: "interact", entity: "laptop", verb: "use" },
      { wait: 600 },
      { type: "overlay:close" },
      { wait: 400 },
      { type: "travel", entity: "go-lamp" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;
    const called = () => listOf(String(ctx.flag("hotel.called", "")));

    /* She walked down off the path in the morning and rang from here until it was dark. The clock catches up on
       the way in; no mark fires on day two, so nothing else moves. */
    ctx.onEnter(() => {
      if (w.state.clock.minuteOfDay >= EVENING) return;
      w.patch("clock", { minuteOfDay: EVENING });
      w.set("phone", { ...w.state.phone, minuteOfDay: EVENING });
    });

    /* The telephone does two things, and which one it is doing is on the cradle, not in a label. */
    ctx.onInteract("room-phone", () => {
      if (ctx.flag("hotel.momPing", false) && !ctx.flag("hotel.momHeard", false)) {
        ctx.setFlag("hotel.momHeard", true);
        ctx.hand(ROOM_PHONE, "grip");
        ctx.kick("settle", 0.35);
        ctx.sfx("cloth", -0.3, 0.4);
        ctx.after(600, () => ctx.sfx("breath", -0.2, 0.5));
        ctx.learn("E-mama", "room-phone");
        ctx.say("妈说：在伦敦一年没被偷，得丢一个以示尊重。", { priority: 1, tag: "hotel-mama" });
        return;
      }
      if (!ctx.flag("hotel.entries", false)) { ctx.setFlag("hotel.entries", true); ctx.learn("E-hotels", "room-phone"); }
      ctx.hand(ROOM_PHONE, "grip");
      ctx.sfx("tick", -0.35, 0.5);
      ctx.kick("glance", 0.3, { yaw: -4, pitch: -3 });
      ctx.open("hotelCalls");
    });

    /* One number. It rings, somebody answers in a language she half has, and it is no. The overlay writes the
       answer down itself; she never repeats it (v4 §10.4). Two minutes each, and the minutes cost nothing tonight. */
    ctx.onAction("hotel:call", (value) => {
      const index = String(Number(value ?? 0));
      const list = called();
      if (list.includes(index)) return;
      ctx.setFlag("hotel.called", [...list, index].join(","));
      const count = ctx.bump("hotel.calls", 1);
      ctx.spend({ minutes: 2 }, "打电话");
      ctx.sfx("tick", -0.35, 0.45);
      ctx.kick("settle", 0.12);
      ctx.after(640, () => ctx.sfx("tock", -0.35, 0.3));
      // Eight in, the pencil goes through the last of the lines she thought would work.
      if (count === CALLS_BEFORE_DONE) ctx.after(880, () => { ctx.sfx("pencil", -0.4, 0.5); ctx.kick("settle", 0.25); });
      if (count === CALLS_IN_BOOK) ctx.after(900, () => { ctx.sfx("exhale", -0.2, 0.65); ctx.kick("settle", 0.4); });
    });

    /* Putting it down. Under eight it is only a receiver going back in its cradle — she picks it up again.
       At eight or more the evening is finished, and the telephone rings the other way (v4 §8). */
    ctx.onAction("hotel:hangup", () => {
      ctx.close();
      ctx.sfx("tock", -0.35, 0.55);
      ctx.kick("settle", 0.3);
      if (called().length < CALLS_BEFORE_DONE || ctx.flag("hotel.hungUp", false)) return;
      ctx.setFlag("hotel.hungUp", true);
      ctx.setFlag("hotel.momPing", true);
      ctx.after(520, () => { ctx.sfx("clink", -0.35, 0.55); ctx.kick("glance", 0.35, { yaw: -5, pitch: 1 }); });
      ctx.after(940, () => ctx.sfx("clink", -0.35, 0.45));
    });

    /* The circle on the screen. Opening it is free; the button inside it is the heaviest thing in the game
       and pays nothing (v4 §7: 零机制回报). */
    ctx.onInteract("laptop", () => {
      ctx.sfx("tick", -0.5, 0.4);
      ctx.kick("glance", 0.25, { yaw: -3, pitch: -3 });
      ctx.open("findmy", { closing: true });
    });
    ctx.onGaze("laptop", () => {
      if (ctx.flag("hotel.screen", false)) return;
      ctx.setFlag("hotel.screen", true);
      ctx.sfx("tick", -0.5, 0.3);
      ctx.kick("settle", 0.2);
    });
    ctx.onAction("findmy:off", () => {
      if (ctx.flag("hotel.findmyOff", false)) return;
      ctx.setFlag("hotel.findmyOff", true);
      ctx.close();
      ctx.hand(LAPTOP, "grip");
      ctx.sfx("tock", -0.5, 0.6);
      ctx.kick("settle", 0.5);
      ctx.after(420, () => ctx.sfx("cloth", -0.5, 0.35));
      ctx.say("它可以留在山里了。", { priority: 1, tag: "hotel-findmy" });
    });

    /* The jacket. If she turned the dwarf pines over this morning she knows where the thread came off. */
    ctx.onInteract("jacket", () => {
      ctx.hand(JACKET, "grip");
      ctx.kick("glance", 0.35, { yaw: 0, pitch: -3 });
      ctx.sfx("cloth", -0.25, 0.5);
      ctx.after(560, () => ctx.sfx("breath", -0.2, 0.35));
      ctx.say(ctx.flag("search.thread", false) ? "线头是从这儿掉的。" : "袖口上还挂着松针。", { tag: "hotel-jacket" });
    });

    /* A painted meadow in a frame, hung by somebody who never had to walk across one at nine in the morning. */
    ctx.onInteract("wall-picture", () => {
      ctx.kick("glance", 0.4, { yaw: -2, pitch: 3 });
      ctx.sfx("breath", -0.4, 0.4);
      ctx.say("两天前我在里面。", { tag: "hotel-picture" });
    });

    /* The pack: the empty slot is in there, and she is not going to be told about it. */
    ctx.onInteract("pack-down", () => {
      ctx.sfx("zip", -0.1, 0.5);
      ctx.kick("glance", 0.35, { yaw: 0, pitch: -6 });
      w.dispatch({ type: "pack:open" });
    });

    /* The village. Every light down there belongs to somebody who is at home. */
    ctx.onInteract("village-lights", () => {
      ctx.setFlag("hotel.looked", true);
      ctx.kick("glance", 0.45, { yaw: 3, pitch: 2 });
      ctx.sfx("exhale", 0.3, 0.5);
      ctx.say("谷里的灯全亮着。", { tag: "hotel-village" });
    });
    ctx.onGaze("village-lights", () => {
      if (ctx.flag("hotel.sawValley", false)) return;
      ctx.setFlag("hotel.sawValley", true);
      ctx.sfx("breath", 0.3, 0.4);
      ctx.kick("settle", 0.2);
    });

    /* Pushing the casement wider. The valley comes in: colder air, and the crickets under the road. */
    ctx.onInteract("open-window", () => {
      if (ctx.flag("hotel.window", false)) return;
      ctx.setFlag("hotel.window", true);
      ctx.hand(OPEN_WINDOW, "grip");
      ctx.sfx("doorOpen", 0.5, 0.4);
      ctx.kick("settle", 0.4);
      w.emit("ambience", { overrides: { wind: 0.2, windTone: 700, crickets: 0.42 } });
      ctx.after(700, () => ctx.sfx("cloth", 0.5, 0.3));
    });

    /* Both hands flat on the radiator. Two days of limestone come out of them. */
    ctx.onHold("radiator", () => {
      ctx.setFlag("hotel.warm", true);
      w.emit("body:rest", { seconds: 6 });
      ctx.hand({ ...RADIATOR, pitch: RADIATOR.pitch + 2 }, "grip");
      ctx.kick("settle", 0.55);
      ctx.sfx("exhale", 0, 0.7);
      ctx.say("手是热的。", { tag: "hotel-warm" });
    });
    ctx.onRelease("radiator", (progress) => {
      if (progress <= 0.25) return;
      ctx.kick("glance", 0.25, { yaw: 0, pitch: -2 });
      ctx.sfx("cloth", 0, 0.3);
    });

    /* Somebody turned the bed down while she was out on the path. */
    ctx.onInteract("bed", () => {
      ctx.hand(BED, "grip");
      ctx.kick("settle", 0.3);
      ctx.sfx("cloth", 0.6, 0.45);
    });

    /* Standing still in a room: the curtain, the valley, and her hand going to a pocket that has nothing in it. */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 1) { ctx.sfx("cloth", 0.55, 0.35); ctx.kick("glance", 0.25, { yaw: 3, pitch: 1 }); return; }
      if (stills === 2) { ctx.sfx("breath", -0.2, 0.4); ctx.kick("settle", 0.2); return; }
      if (stills === 3 && !ctx.flag("hotel.pocket", false)) {
        ctx.setFlag("hotel.pocket", true);
        ctx.sfx("cloth", 0, 0.5);
        ctx.kick("glance", 0.35, { yaw: 0, pitch: -8 });
        ctx.say("口袋还是空的。", { tag: "hotel-pocket" });
        return;
      }
      if (stills % 3 === 0) ctx.sfx("tick", -0.5, 0.2);
    });

    /* The lamp goes off and the second day is over. The third one starts at the pass, with the bags already packed. */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "hotel" || to !== "busStop") return;
      ctx.kick("settle", 0.6);
      ctx.sfx("tock", -0.45, 0.6);
      ctx.after(420, () => ctx.sfx("cloth", 0, 0.3));
      w.patch("clock", { minuteOfDay: 9 * 60 + 10 });
      w.set("phone", { ...w.state.phone, minuteOfDay: 9 * 60 + 10, date: { year: 2025, month: 8, day: 1 } });
    });
  },
});
