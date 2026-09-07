/* The back seat of their car, 23:10. Ten hours in the mountains end here: the heater, the engine, and two people
   in front of her who picked her up on a hairpin. The account gives them no lines, so the game gives them none —
   only what she carries away of them (SOURCE_TRANSCRIPT, day 1 §12: 女生意大利人，男生西班牙人，异国恋，
   第二天是恋爱四周年纪念日，所以聚在这里。交换联系方式，合了影). Look at a few things and you hear a few
   sentences; look at everything and you know who they are. Look at nothing and it is only the heater and the screen.

   Coordinates read off the 150°×84° grid of 17-car (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84, W×H = 1280×720);
   the pixel each one came from is noted beside it. */
import { flag, not } from "../engine/condition";
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
/* 导航屏 and 出风口 are 14° apart on the same painted vent housing, one on each vane group. The painting itself shows
   no phone; `nav-phone.webp` (a phone in a vent clip, lit screen, the clip over the slats) is drawn and in place, so
   the two hotspots read as two different objects. */
const NAV: Transform = { yaw: 7, pitch: -11, distance: 6 };            // clamped on the right slats of the vent grille (700, 454)
/* THE TWO OF THEM, and the one number that decides where they can stand: the resting frame.
   At 1280x720 the camera's half-width is atan(tan(30°)·16/9) = 45.75°, so with the head still the picture spans
   yaw ±45.75 and the head can only turn ±27.75 (PanoStage clamps yawLimit to 150/2 − 45.75 − 1.5). Anything past
   ±45.75 is off-screen until the player turns, and two things 112° apart can never both be in the frame.
   Measured off the plate, the two painted headrests are: LEFT plate x 0..313 = yaw −75..−38.3, RIGHT plate
   x 1000..1240 = yaw +42.2..+70.3, both between pitch +17 and −12. So the seats themselves only just reach into
   the resting frame, and the old anchors (−54 / +58) sat entirely outside it: at rest the car was empty.
   They now sit on the inner ends of their own headrests, 89° apart inside a 91.5° frame — a shoulder of each is on
   screen with the head still, and a quarter-turn either way brings that one fully in. What cannot be fixed from
   here is that these headrests are painted 36° wide (0.4 m from the camera) and hide the heads of anyone actually
   sitting in them; a plate whose seat backs carry two figures inside ±40° is an ART re-cut (docs/ART_QUEUE.md).
   Size comes off the same seats. couple-driver's head fills 0.46 of its 1023x1114 file and couple-passenger's 0.45
   of its 794x1181; at 56 vh and 44 vh their heads come out 13-14° across against a 26 cm headrest drawn 36° across,
   i.e. a head seen from about half a metre back, and each pitch is set so the head lands in the upper half of the
   headrest it is drawn against rather than floating over the roof lining. */
const DRIVER: Transform = { yaw: -45, pitch: 0.5, distance: 9 };       // the inner end of the left headrest (plate x 250)
const PASSENGER: Transform = { yaw: 44, pitch: -4, distance: 9 };      // the inner end of the right headrest (plate x 1015)
/* The gear lever this painting actually has is at the very bottom of the centre stack (642, 693) = pitch −38.9: below
   the viewport and behind `hands-lap`. What the plate does show of the two of them is the wheel, so their hands are
   there — v4 §6/§7 name 他们搭在挡杆上的手, and what tells her they are a couple is two hands touching, not one hand
   driving. `hand-on-wheel.webp` is on disk now and is exactly that: one hand laid over the other on a rim, cuffs
   going down either side — so this anchor names something the picture draws (§0.5) instead of being an empty ring
   under a label for a hand nobody had painted.
   The anchor moved with the picture. The one dark band of this wheel wide enough to carry a pair of hands is
   plate x 320..560 at y 500..545, the near arc of the rim in front of the instrument cluster; (430, 522) is the
   middle of it. The SIZE is what was wrong: at 18 vh the pair drew 280 x 130 px and hung out over the cluster and
   past the right of the painted rim, carrying its own grey-brown bar with it. At 12 vh they draw 186 x 86 px and
   cover plate 367..513 x 488..556 — inside the band, on the rim, nothing overhanging it.
   Two things about this file that placement cannot fix and that are queued as ART: its bottom edge is raw matte
   (a speckled fringe and a bar under the hands that the painted rim should be carrying), and it is keyed brighter
   than a night interior. The class below is the hook the interior filter hangs on (see `requests`). */
const WHEEL: Transform = { yaw: -24.6, pitch: -19, distance: 6 };      // the near arc of the steering-wheel rim (430, 522)
/* The bottle. `water-bottle-night.webp` is the night re-cut: a dark-sleeved forearm with the bottle held out at the
   end of it, which is §6's 递过来. The sleeve enters from the upper left, and left is where the driver sits, so the
   arm is his — reaching back over the console between the two front seats, which is the only way an arm gets to the
   back seat of this car.
   It used to sit at 24 vh with its anchor up on the dash, and measured on screen it ran across the WINDSCREEN: the
   dash's top edge is plate y 400..420 (pitch −7) and the sprite's top edge was above it, so the sleeve crossed the
   road ahead and the shoulder ended in the sky. It is now 18 vh (170 x 130 px) and sits low over the centre stack:
   the whole sprite covers plate 533..667 x 494..596 — under the vents, over the knobs, not one pixel of glass — and
   it clears the pair of hands on the rim (which end at plate x 513) instead of being drawn on top of them.
   The hotspot is the bottle itself, and the prop is offset so the bottle inside the file (fraction 0.865, 0.56)
   lands on it. At this size and place it is clear of the vent, the navigation screen, the road ahead and the wet
   road that carries the way out. */
const WATER: Transform = { yaw: 1, pitch: -22.3, distance: 6 };        // the bottle held out over the centre stack (648, 551)
const WATER_ARM: Transform = { yaw: -4.7, pitch: -21.6, distance: 6 };// where the whole arm-and-bottle file has to sit for that

const LOOKED = "car.looked", LINES_SAID = "car.lines", WATER_TAKEN = "car.water", PHOTO = "car.photo";
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
    prop("wheel-hand", WHEEL, "sprites/hand-on-wheel.webp", 12, { className: "car-night-prop" }),
    // v4 §6/§7 name 他们搭在挡杆上的手 and make two hands touching the thing that tells her they are a couple.
    // The painted gear lever is at plate (642,693) = pitch −38.9, under the viewport; the rim is where this
    // painting shows their hands. The label names the pair, not the wheel — the couple is the content.
    { id: "their-hand", transform: WHEEL,
      interactable: { verbs: ["inspect"], label: "叠在一起的两只手", reveal: 13, cost: { minutes: 0 } },
      gaze: { radius: 11, dwell: 1000 } },
    { id: "mirror", transform: MIRROR,
      interactable: { verbs: ["inspect"], label: "后视镜", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 10, dwell: 900 } },
    // The bottle, held back over the dash until she takes it. Holding is drinking (v4 §3.2: 车里接过那瓶水 −0.20).
    prop("water-bottle", WATER_ARM, "sprites/water-bottle-night.webp", 18, { visible: not(flag(WATER_TAKEN)), className: "car-night-prop" }),
    { id: "water", transform: WATER, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "递过来的水", reveal: 15 },
      hold: { ms: 900, scaleWith: ["fatigue"] },
      visible: not(flag(WATER_TAKEN)) },
    // The vent. Free, useless, and the whole point of the ride: it is warm in here.
    { id: "vent", transform: VENT,
      interactable: { verbs: ["use"], label: "出风口", reveal: 12, cost: { minutes: 0 } } },
    /* The two of them, in the two seats the painting draws empty. They are props and not hotspots: what she does with
       them is look at the things they hand her and the things they touch, and a figure inside a Hotspot would fade in
       and out of its seat with wherever her eyes happened to be. The account gives them no lines, so nothing here is
       clickable — they are simply there, which is the whole difference between this ride and an empty car. */
    prop("couple-driver", DRIVER, "sprites/couple-driver.webp", 56, { className: "car-night-prop" }),
    prop("couple-passenger", PASSENGER, "sprites/couple-passenger.webp", 44, { className: "car-night-prop" }),
    // The way on is the road itself: it ends at the hotel door, where the numbers and the photograph happen.
    goArrow("go", WET_ROAD, { to: "search", minutes: 0, label: "回酒店的路", kind: "walk" }),
    /* No button for the photograph. v4 §8 puts 交换联系方式合影 at the hotel door and §9 gives that door no painting,
       so it happens on `travel:begin`, at the door, the way the account has it. As an E press inside the moving car
       it moved the place, invented an action (asking two strangers to pose while they drive), and — being the only
       screen button in the scene, arriving exactly when the ride became able to end — read as a nudge to leave. */
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
       the six seconds are kept here.
       Three rules, and they used to be tangled into one:
        1. Looking at a new thing ALWAYS counts. It used to return before seen.add / looks / bump whenever the six
           seconds had not passed, so the player looked at something new, got the sound and the turn of her head, and
           the game recorded nothing — car.looked and the notebook then disagreed with what they had done, and they
           had to look at the same thing again for it to register.
        2. A sentence is OWED for every new thing, and owing one does not expire. `said < looks` is the whole budget:
           she never says more than the player has looked at, and a look made inside the six seconds does not throw
           its sentence away — it waits for the next time her eyes come to rest anywhere.
        3. So the next look pays it, even a second look at something already seen. That is what keeps the five
           sentences alive when several things are noticed at once (in the page with `reveal=1` every entity dwells
           on the same frame, which used to eat the whole budget in one instant and leave four sentences unsaid).
       Six targets against five sentences still leaves exactly one spare look, and looking at nothing still gets
       nothing: `looks` stays 0 and rule 2 never lets a line out. */
    const LINE_GAP = 6000;
    let lastLineAt = -Infinity;
    let looks = 0;
    const look = (id: EntityId, pan: number, sound: "cloth" | "tick" | "tock" | "slide" | "breath") => {
      /* Looking at something a second time still costs her nothing and still answers: the sound off that side of the
         car and her head going that way. A hotspot that goes silent on the second press is a dead control (§12 D7) —
         six of this scene's eight were exactly that. */
      const fresh = !seen.has(id);
      if (fresh) { seen.add(id); looks += 1; ctx.bump(LOOKED, 1); }
      ctx.sfx(sound, pan, 0.45);
      glanceAt(ctx.transformOf(id), fresh ? 0.5 : 0.4);
      if (fresh && looks % 3 === 0) ctx.sfx("slide", -0.35, 0.22);   // the tyres through the water under all of it
      const said = ctx.flag<number>(LINES_SAID, 0);
      if (said >= CAR_LINES.length || said >= looks) return;         // nothing owed
      if (w.rt.now - lastLineAt < LINE_GAP) return;                  // too soon: the road answers, the sentence keeps
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
      ctx.hand({ ...WATER, pitch: WATER.pitch + 1.5 }, "grip");
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
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "car" || to !== "search") return;
      ctx.kick("brake", 0.9); ctx.fx("brake", 0.6); ctx.sfx("doorOpen", -0.35, 0.6);
      ctx.setFlag("car.exchanged", true);
      ctx.give("contactCard");
      // Both are theirs and both happen at the door: two numbers on a slip of paper, one photograph on their phone.
      if (!ctx.flag(PHOTO, false)) shutter();
      ctx.flash("两个号码。一张合影。");
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
