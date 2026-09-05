/* The back seat of their car, 23:10. Ten hours in the mountains end here: the heater, the engine, and two people
   in front of her who picked her up on a hairpin. The account gives them no lines, so the game gives them none —
   only what she carries away of them (SOURCE_TRANSCRIPT, day 1 §12: 女生意大利人，男生西班牙人，异国恋，
   第二天是恋爱四周年纪念日，所以聚在这里。交换联系方式，合了影). Look at a few things and you hear a few
   sentences; look at everything and you know who they are. Look at nothing and it is only the heater and the screen.

   Coordinates read off the 150°×84° grid of 17-car (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84, W×H = 1280×720);
   the pixel each one came from is noted beside it. */
import { all, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { EntityId, Transform } from "../engine/types";
import { goArrow, prop } from "./_shared";

/* Painted in 17-car. */
const MIRROR: Transform = { yaw: 0.5, pitch: 19.5, distance: 8 };      // the glass of the rear-view mirror (644, 193)
const VILLAGE: Transform = { yaw: 12, pitch: 9, distance: 40 };        // the village lights down in the valley (742, 283)
const TREES: Transform = { yaw: -31, pitch: 21, distance: 22 };        // the spruce tops against the sky, left of the mirror (375, 180)
const VENT: Transform = { yaw: -7.5, pitch: -11, distance: 6 };        // the left half of the vent grille, its slats (576, 454)
/* The road ahead stays at distance 16: past 16.7 `PanoStage`'s `Math.max(0.6, 10/distance)` clamp stops the sprite
   shrinking and it renders `sizeVh × 0.06 × distance` instead of `sizeVh`. At or under it, sizeVh is the screen height. */
const ROAD_AHEAD: Transform = { yaw: -11, pitch: 8.4, distance: 16 };  // where the road narrows into the trees (546, 288)
const WET_ROAD: Transform = { yaw: 2, pitch: -1, distance: 16 };       // the wet tarmac in front of the bonnet (657, 372)
/* Sprites: the things that glow, move or are handed over. Everything on the centre stack has to stay above her own
   knees, which the engine keeps painted across the bottom of the screen for the whole ride (`hands-lap`, body "ride"). */
/* 导航屏 and 出风口 are 14° apart on the same painted vent housing, one on each vane group, and the painting itself
   shows no phone: `nav-phone.webp` is briefed as a phone in a vent clip (lit screen, the clip visible over the slats)
   so the two hotspots read as different objects the moment the art lands. Until then the label names a thing the
   picture does not yet show — permitted for a pending sprite, and flagged in the report. */
const NAV: Transform = { yaw: 7, pitch: -11, distance: 6 };            // clamped on the right slats of the vent grille (700, 454)
/* The gear lever this painting actually has is at the very bottom of the centre stack (642, 693) = pitch −38.9: below
   the viewport and behind `hands-lap`. What the plate does show of the two of them is the wheel, so their hands are
   there — v4 §6/§7 name 他们搭在挡杆上的手, and what tells her they are a couple is two hands touching, not one hand
   driving. The object had to move; the beat must not, so `hand-on-wheel.webp` is briefed as the passenger's hand
   resting over the driver's on the rim. Anchor measured on the plate: at y = 470 the dark rim band runs x 484→515,
   so (495, 470) is inside it — the old (502, 460) sat on the thin top-right of the rim, half off its outer edge. */
const WHEEL: Transform = { yaw: -17, pitch: -12.8, distance: 6 };      // the right arc of the steering-wheel rim (495, 470)
/* The bottle comes back over the right of the dash: an arm and a hand, and that is all of them the picture shows.
   Neither of them is ever drawn from the back seat — the account gives them no lines and the game gives them no face.
   `water-bottle.webp` is a daylight bottle in a bare hand with the forearm entering from the bottom right, i.e. from
   her own lap rather than from the front seats, and rendered 216×114 px it was the brightest thing in a night
   interior. This anchor takes a night-interior file instead (brief in the report): the forearm comes in from the
   upper left, across the dash. */
const WATER: Transform = { yaw: 31, pitch: -13, distance: 5 };         // an arm coming back over the right of the dash (905, 471)

const LOOKED = "car.looked", LINES_SAID = "car.lines", WATER_TAKEN = "car.water", PHOTO = "car.photo";
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };                   // story actions: E-key prompts, never drawn on the painting
/* What she carries away of them. Nothing here is invented: it is the account's own list, one sentence at a time. */
const CAR_LINES = [
  "女生是意大利人。",
  "男生是西班牙人。",
  "他们说，这是异国恋。",
  "明天是他们的四周年。",
  "两个人今天就为这个赶到这里。",
];
/* The six things worth resting your eyes on: three out of the glass, three inside the warm part of the car. */
const LOOKS: Array<{ id: EntityId; pan: number; sound: "cloth" | "tick" | "tock" | "slide" | "breath" }> = [
  { id: "taillights", pan: -0.3, sound: "slide" },
  { id: "village", pan: 0.35, sound: "breath" },
  { id: "roadside-trees", pan: -0.6, sound: "slide" },
  { id: "nav-screen", pan: 0.15, sound: "tick" },
  { id: "their-hand", pan: -0.2, sound: "cloth" },
  { id: "mirror", pan: 0, sound: "tock" },
];

export default defineScene({
  id: "car",
  day: 1, place: "他们的车 · 回酒店的路", elevation: "1,500 m",
  painting: "pano/17-car.webp",
  body: "ride", material: "road",
  ambience: { wind: 0.05, windTone: 1100, birds: 0, crickets: 0, stream: 0, engine: 0.6, heater: 0.7 },
  interior: true,
  idleLook: true,
  arriveAt: 23 * 60 + 10,
  fallback: "车里是热的。",
  // v4 §8: 看过至少一样并到达酒店. Nothing else is required of her; the ride happens either way.
  exitWhen: flag(LOOKED, { gte: 1 }),
  entities: [
    /* The four things in here that glow, move or are held out are drawn as props of their own, with the hotspot a
       second entity on the same point: a `sprite` inside a `Hotspot` inherits the button's reveal opacity, and a
       bottle held out to her — or a screen that is the only light on the dash — must not blink in and out with
       where her eyes happen to be (hairpin does the same for its cars). */
    // Out of the glass. Three of them, and three of them alone are still worth three sentences (v4 §7: 只看窗外＝三句).
    // A hundred-odd metres of wet road ahead: 1.3 vh is a car's back end at that range, smaller than the guardrail
    // reflectors the plate already paints beside it.
    prop("taillights-ahead", ROAD_AHEAD, "sprites/taillights-ahead.webp", 1.3),
    { id: "taillights", transform: ROAD_AHEAD,
      interactable: { verbs: ["inspect"], label: "前面的尾灯", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 10, dwell: 900 } },
    { id: "village", transform: VILLAGE,
      interactable: { verbs: ["inspect"], label: "谷底的灯", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 11, dwell: 900 } },
    { id: "roadside-trees", transform: TREES,
      interactable: { verbs: ["inspect"], label: "窗外的杉树", reveal: 13, cost: { minutes: 0 } },
      gaze: { radius: 11, dwell: 1000 } },
    // Inside the warm part of the car. The screen and his hand are sprites: they glow, they move, they are theirs.
    prop("nav-phone", NAV, "sprites/nav-phone.webp", 12),
    { id: "nav-screen", transform: NAV,
      interactable: { verbs: ["inspect"], label: "导航屏", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 10, dwell: 900 } },
    prop("wheel-hand", WHEEL, "sprites/hand-on-wheel.webp", 18),
    { id: "their-hand", transform: WHEEL,
      interactable: { verbs: ["inspect"], label: "方向盘上的手", reveal: 13, cost: { minutes: 0 } },
      gaze: { radius: 11, dwell: 1000 } },
    { id: "mirror", transform: MIRROR,
      interactable: { verbs: ["inspect"], label: "后视镜", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 10, dwell: 900 } },
    // The bottle, held back over the dash until she takes it. Holding is drinking (v4 §3.2: 车里接过那瓶水 −0.20).
    prop("water-bottle", WATER, "sprites/water-bottle-night.webp", 30, { visible: not(flag(WATER_TAKEN)) }),
    { id: "water", transform: WATER, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "递过来的水", reveal: 15 },
      hold: { ms: 900, scaleWith: ["fatigue"] },
      visible: not(flag(WATER_TAKEN)) },
    // The vent. Free, useless, and the whole point of the ride: it is warm in here.
    { id: "vent", transform: VENT,
      interactable: { verbs: ["use"], label: "出风口", reveal: 12, cost: { minutes: 0 } } },
    // The way on is the road itself: it ends at the hotel door, where the numbers and the photograph happen.
    goArrow("go", WET_ROAD, { to: "search", minutes: 0, label: "回酒店的路", kind: "walk" }),
    /* v4 §8 lists 在酒店门口交换联系方式合影 among this node's 可做的事. The two numbers are theirs and arrive either
       way — the account is explicit that contacts were exchanged and a photograph was taken — but the shutter can be
       hers: once the ride is able to end (she has rested her eyes on one thing) a single E press takes it. Never
       pressed, it still happens at the door on `travel:begin`, quietly. This is the scene's only `action` entity and
       `car` gets no 喊一声 button, so nothing else shares the pinned `.story-action` slot. */
    { id: "photo-together", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["photograph"], label: "合个影", reveal: 0, cost: { minutes: 0 } },
      visible: all(flag(LOOKED, { gte: 1 }), not(flag(PHOTO))) },
  ],
  seed: (w) => {
    w.setFlag(LOOKED, LOOKS.length); w.setFlag(LINES_SAID, CAR_LINES.length);
    w.setFlag(WATER_TAKEN, true); w.setFlag("car.heater", true); w.setFlag("car.exchanged", true); w.setFlag(PHOTO, true);
    // What the ride leaves behind: a slip of paper with two numbers, and knowing whose numbers they are (v4 §4).
    w.patch("inventory", { items: Array.from(new Set([...w.state.inventory.items, "contactCard"])) as typeof w.state.inventory.items });
    w.patch("journal", { entries: Array.from(new Set([...w.state.journal.entries, "E-couple"])) });
    w.patch("body", { fatigue: Math.max(0, w.state.body.fatigue - 0.2), fear: 0 });
  },
  walkthrough: [
    { type: "interact", entity: "nav-screen", verb: "inspect" },
    { wait: 400 },
    { type: "travel", entity: "go" },
  ],
  /* The 6500 ms between looks is the six-second line gap plus slack: look faster than that and the sentence keeps
     for the next thing she rests her eyes on, which is the point — nothing here can be rushed into a wall of text. */
  variants: {
    // Only what is out of the glass: three of the five sentences, and she never learns whose anniversary tomorrow is.
    window: [
      { type: "interact", entity: "taillights", verb: "inspect" }, { wait: 6500 },
      { type: "interact", entity: "village", verb: "inspect" }, { wait: 6500 },
      { type: "interact", entity: "roadside-trees", verb: "inspect" }, { wait: 6500 },
      { type: "travel", entity: "go" },
    ],
    // Everything the ride offers: the water, the vent, all six things, sitting still twice.
    thorough: [
      { type: "hold:start", entity: "water" }, { wait: 2400 }, { type: "hold:end" }, { wait: 6500 },
      { type: "interact", entity: "vent", verb: "use" }, { wait: 800 },
      { type: "interact", entity: "nav-screen", verb: "inspect" }, { wait: 6500 },
      { type: "interact", entity: "their-hand", verb: "inspect" }, { wait: 6500 },
      { type: "interact", entity: "mirror", verb: "inspect" }, { wait: 6500 },
      { type: "interact", entity: "taillights", verb: "inspect" }, { wait: 6500 },
      { type: "wait" }, { wait: 600 }, { type: "wait" }, { wait: 600 },
      { type: "interact", entity: "village", verb: "inspect" }, { wait: 6500 },
      { type: "interact", entity: "roadside-trees", verb: "inspect" }, { wait: 6500 },
      { type: "interact", entity: "photo-together", verb: "photograph" }, { wait: 500 },
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

    /* Looking at one more thing gets one more sentence out of the front seats, up to five (v4 §7).
       Nothing on screen counts them; the only record is the notebook line she gets if she hears them all. */
    const seen = new Set<EntityId>();
    /* v4 §10.2-6 / §12 C3: at least six seconds between any two lines, never queued. DialogueSystem only enforces
       that below priority 1, and these have to be priority 2 or the adrenaline gate swallows them ten hours in — so
       the six seconds are kept here. A look inside the window does not consume a sentence: it still counts, still
       sounds, still turns her head, and the sentence waits for the next thing she rests her eyes on. Six targets
       against five sentences leaves exactly one spare look. */
    const LINE_GAP = 6000;
    let lastLineAt = -Infinity;
    let looks = 0;
    const look = (id: EntityId, pan: number, sound: "cloth" | "tick" | "tock" | "slide" | "breath") => {
      if (seen.has(id)) return;
      const said = ctx.flag<number>(LINES_SAID, 0);
      const due = said < CAR_LINES.length && w.rt.now - lastLineAt >= LINE_GAP;
      if (!due && said < CAR_LINES.length) {
        // Too soon after the last one: the road answers instead, and the sentence keeps for the next look.
        ctx.sfx(sound, pan, 0.45);
        glanceAt(ctx.transformOf(id), 0.4);
        return;
      }
      seen.add(id);
      looks += 1;
      ctx.bump(LOOKED, 1);
      ctx.sfx(sound, pan, 0.45);
      glanceAt(ctx.transformOf(id), 0.5);
      if (looks % 3 === 0) ctx.sfx("slide", -0.35, 0.22);     // the tyres through the water under all of it
      if (said >= CAR_LINES.length) return;
      lastLineAt = w.rt.now;
      ctx.setFlag(LINES_SAID, said + 1);
      // priority 2: ten hours in, she is past talking to herself — but she still passes on what they say.
      ctx.say(CAR_LINES[said], { priority: 2, tag: `car-line-${said}` });
      if (said + 1 >= CAR_LINES.length && !ctx.flag("car.knows", false)) { ctx.setFlag("car.knows", true); ctx.learn("E-couple", id); }
    };
    for (const entry of LOOKS) {
      ctx.onInteract(entry.id, () => look(entry.id, entry.pan, entry.sound));
      ctx.onGaze(entry.id, () => look(entry.id, entry.pan, entry.sound));
    }

    /* The bottle. Holding it is drinking it; letting go early is only a hand coming down again. */
    ctx.onHold("water", () => {
      ctx.setFlag(WATER_TAKEN, true);
      w.emit("body:fatigue", { delta: -0.2, reason: "车里那瓶水" });
      w.emit("body:rest", { seconds: 5 });
      ctx.hand({ ...WATER, pitch: WATER.pitch - 4 }, "grip");
      ctx.kick("settle", 0.8); ctx.sfx("exhale", 0, 0.85);
      if (w.rt.now - lastLineAt < LINE_GAP) return;           // the same six seconds; the bottle needs no words
      lastLineAt = w.rt.now;
      ctx.say("第一口水。", { priority: 2, tag: "car-water" });
    });
    ctx.onRelease("water", (progress) => {
      if (progress <= 0.2) return;
      ctx.kick("glance", 0.3, { yaw: 2, pitch: -2 }); ctx.sfx("cloth", 0.3, 0.35);
    });

    /* The vent: she holds her hands in front of it. The car gets warmer and that is all that happens — and it keeps
       answering afterwards, because a hotspot that goes silent on the second press is a dead control (§12 D7). */
    ctx.onInteract("vent", () => {
      ctx.hand(VENT, "grip"); ctx.kick("settle", 0.45); ctx.sfx("cloth", -0.1, 0.4);
      if (ctx.flag("car.heater", false)) return;
      ctx.setFlag("car.heater", true);
      w.emit("ambience", { overrides: { heater: 1, engine: 0.55 } });
      w.emit("body:rest", { seconds: 4 });
    });

    /* Sitting still. The road answers under the wheels — not with the wiper: AudioSystem already sweeps one every
       2.2 s in this scene, so a wiper here would be inaudible inside its own loop. (In `ride` the camera never holds
       still enough for many of these; the tyres are also hung on the looks above, where they always land.) */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      ctx.kick("settle", 0.2);
      if (stills === 2) { ctx.sfx("slide", -0.4, 0.45); return; }
      if (stills % 3 === 0) ctx.sfx("cloth", 0.25, 0.25);
    });

    /* If the second car went past her and she had to run thirty seconds after it, she is still getting her breath back. */
    ctx.onEnter(() => {
      if (!ctx.flag("hairpin.leftBehind", false)) return;
      w.emit("body:rest", { seconds: 6 });
      ctx.sfx("breath", 0, 0.9); ctx.kick("settle", 0.6);
    });

    /* The hotel door (v4 §9: it happens here, it does not deserve a painting of its own). The car stops, they write
       two numbers down, a photograph is taken on their phone — hers is somewhere in the forest — and the night ends. */
    const shutter = () => {
      ctx.setFlag(PHOTO, true);
      ctx.sfx("shutter", 0.25, 0.7);
      ctx.kick("settle", 0.6);
    };
    // The photograph, when she asks for it: a press, a shutter, and the car keeps going. No line goes with it.
    ctx.onInteract("photo-together", () => { if (!ctx.flag(PHOTO, false)) { shutter(); ctx.flash("一张合影。"); } });
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "car" || to !== "search") return;
      ctx.kick("brake", 0.9); ctx.fx("brake", 0.6); ctx.sfx("doorOpen", -0.35, 0.6);
      ctx.setFlag("car.exchanged", true);
      ctx.give("contactCard");
      // The numbers are theirs and arrive either way; the photograph too, if she never took it herself.
      const already = ctx.flag(PHOTO, false);
      if (!already) shutter();
      ctx.flash(already ? "两个号码。" : "两个号码。一张合影。");
    });
    /* The night ends and the next morning starts — but only once the painting has changed. `travel:begin` runs 1.8 s
       before `enterScene`, and moving the clock there put 7月30日 08:40 in the top bar over a night interior, with the
       daylight tint already up (§12 D1). `scene:exit` fires inside enterScene; the day and the date that follow it
       are set by the scene definition itself. */
    ctx.on("scene:exit", ({ to }) => {
      if (to !== "search") return;
      w.patch("clock", { minuteOfDay: 8 * 60 + 40 });
      w.set("phone", { ...w.state.phone, minuteOfDay: 8 * 60 + 40, date: { year: 2025, month: 7, day: 31 } });
    });
  },
});
