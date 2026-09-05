/* Passo Sella, the road, 09:40. The first stand of the day and the spot she will stand on again three days later
   (20-bus-stop is the same painting; the clock alone makes it morning). Sassolungo fills the middle; the white
   house with its wooden gable, the benches in front of it and the playground on the left; the wooden chalets and
   the road on the right; the big wooden signpost at the far right, its arm still blank. The grass rises on the
   left: that is the way.
   WHAT IS AND IS NOT PAINTED (v4 §12 P1 says so in as many words): the two Chinese hikers, their car, the carving
   in the shop window and the blue 472 sign are NOT in 20-bus-stop; they were always meant to be sprites, and the
   sprites are not drawn yet. So nothing in this file puts a ring or a label on a patch of empty grass:
   `car-parked` and `hikers` are pure props that stay invisible until their pictures land, the hello is the E-key
   story action the engine keeps for things done to people, and the car leaving is a sound off to the right —
   two doors and tyres on gravel — with no dust and no head turned toward a blank piece of verge. The 472 sign is
   not here at all (E-472 is on the timetable at `hairpin` on the second day); it comes back with its picture.
   The trail board is the exception: the wooden signpost IS painted, so the board pinned to its arm keeps its ring.
   Every coordinate was read off the 150°x84.375° grid of 20-bus-stop (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280x720) is noted beside it. Sprite heights come from one scale law for this painting:
   the three painted road lines (left edge / centre dashes / right edge) meet at a vanishing point at y ≈ 486, so the
   ground horizon sits at y ≈ 480 and a thing standing on the ground at row y is (y − 480)/1.6 pixels per metre tall.
   Checked against four painted things: the play tower (base 525, 97 px → 3.45 m), the swing frame (base 522, 62 px
   → 2.36 m), the white house (base 508, ridge 130 px → 7.4 m), the near chalet (base 494, ridge 60 px → 6.9 m).
   1 vh = 5.14 px (viewport 60°, painting 84.375° over 720 px) and a sprite is centred on its transform, so a
   sprite's foot sits at its pixel row + sizeVh·5.14/2. */
import { ENTRIES } from "../data/entries";
import { MAP_LEGS } from "../data/map";
import { all, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { phoneDispatch } from "../systems/UISystem";
import { goArrow, lookAt, readable } from "./_shared";

const SEEN = "roadside.seen", GREETED = "roadside.greeted", CAR_GONE = "roadside.carGone", PHOTO = "roadside.photo";
/** They are leaving anyway: three minutes after she gets here the car pulls out (v4 §7: "40 秒后车开走").
    One mechanism only — the clock. Standing still is a minute each (BodySystem), reading is two, the hello is
    three, so every way of spending this morning arrives at 09:43 on its own; nothing here runs on a timer. */
const CAR_LEAVES_AT = 9 * 60 + 43;
/** The one photograph of this morning that is not hers. Its own title, so the police gallery can tell it apart. */
const THEIR_PHOTO = "Passo Sella · 出发前";

// Things painted in 20-bus-stop, with the pixel they were read from.
const SASSOLUNGO: Transform = { yaw: 9, pitch: 16, distance: 40 };        // the great grey wall across the road (720, 220)
const ROAD: Transform = { yaw: 30, pitch: -28, distance: 12 };            // the tarmac with its dashed centre line (896, 600)
const PLAYGROUND: Transform = { yaw: -36, pitch: -16, distance: 16 };     // the wooden tower, the slide and the swings (333, 497)
const HILLS: Transform = { yaw: -39.8, pitch: 3.5, distance: 30 };        // the green slope rising on the left (300, 330)
const SHOP_WINDOW: Transform = { yaw: 27.2, pitch: -13.2, distance: 14 }; // the near chalet's one dark ground-floor window (872, 473)
const BOARD: Transform = { yaw: 57, pitch: 0 };                            // the painted signpost's arm, on its pointed half (1126, 360; the plank runs 1093–1248 × 333–413)
const BENCH: Transform = { yaw: -5, pitch: -16, distance: 14 };           // the benches and tables outside the white house (597, 497; the row runs 566–696 × 494–514)
const CAR: Transform = { yaw: 38.1, pitch: -17 };                          // where the car will stand once it is drawn: half on the verge, half on the tarmac's edge (965, 506; wheels 530)
const HIKERS: Transform = { yaw: 31.1, pitch: -17.3 };                     // where the two will stand once they are drawn: on the grass, left of the car (905, 508; feet 536)
/** The hello is done to people, not to a place: an E-key action (v4 §3 story actions). Below the painting so it never projects. */
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };
const GRASS_WAY: Transform = { yaw: -47.3, pitch: -13.1 };                 // the open grass just left of the play tower, where the slope starts up (236, 472)

const carHere = all(not(flag(CAR_GONE)), not(flag(GREETED)));
/** Board time, the way a board writes it: 1.5 h → "1.30". */
const boardHours = (h: number) => `${Math.floor(h)}.${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
/** The legs as the board names them — the same hours the map will carry, in the board's own language. */
const LEG_ON_BOARD: Record<string, string> = {
  toFork: "Altopiano – Bivio Val Lasties 2455 m",
  toScreeFoot: "Bivio – Fondo del ghiaione",
  toForest: "Ghiaione – Sentiero nel bosco",
  toRoad: "Bosco – Passo Sella",
};
/** The trail board: the two route numbers, the legs of the way down with their times, the hut. Nothing she will ever repeat. */
const BOARD_LINES = [
  "649 · Passo Sella → Via ferrata Pössnecker → Piz Selva 2941 m",
  "656 · Piz Selva → Plan de Roces → Val Lasties 2455 m → Passo Sella",
  ...MAP_LEGS.map((leg) => `${LEG_ON_BOARD[leg.id] ?? leg.name} · ${boardHours(leg.hours)}`),
  "Rifugio Boè · Altopiano del Sella",
];

/** The one photograph from this roadside that is not hers: taken with her phone, by them. */
const seedPhoto = (w: World) => {
  if (w.state.phone.photos.some((photo) => photo.title === THEIR_PHOTO)) return;
  phoneDispatch(w, { type: "capture_photo", photo: { asset: "pano/20-bus-stop.webp", title: THEIR_PHOTO, place: "Passo Sella · 公路边", position: { x: 50, y: 52 }, zoom: 1, day: 1 } });
};

export default defineScene({
  id: "roadside",
  day: 1, place: "Passo Sella · 公路边", elevation: "2,240 m",
  painting: "pano/20-bus-stop.webp",
  body: "stand", material: "road",
  ambience: { wind: 0.5, windTone: 1000, birds: 0.5, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen" },
  arriveAt: 9 * 60 + 40,
  chapter: { eyebrow: "第一天", title: "Passo Sella" },
  idleLook: true,
  fallback: "山口的早上，风还是凉的。",
  entities: [
    // Looking round (v4 §8: 环视认地形). A minute each; a photo is the phone's business.
    lookAt("sassolungo", SASSOLUNGO, "对面的锯齿石墙", 1),
    lookAt("road", ROAD, "山口公路", 1),
    lookAt("playground", PLAYGROUND, "儿童游乐架", 1),
    lookAt("hills", HILLS, "左边的草坡", 1),
    // The painted wooden signpost at the right, with the trail board on its arm: route numbers, the legs and their
    // times (v4 §6: 2 min → the map's hours). The only thing in this scene that writes MAP_LEGS, so it sits on the
    // pointed half of the plank rather than its middle — yaw 57 is well inside the 68.9° the gaze actually reaches.
    readable("trail-board", BOARD, "木头路牌", {
      kind: "board", title: "PASSO SELLA · SENTIERI 649 / 656", lines: BOARD_LINES, entry: "E-route", minutes: 2,
    }, { sprite: { src: "sprites/trail-board.webp", layer: "prop", sizeVh: 7 } }),
    // The chalet's shop window: a carved deer with a bear, a wolf and a boar behind it (v4 §6: 1 min → E-forest).
    // The window opening is 11x15 px in the painting, so the carving inside it is 6 px — 1.2 vh.
    readable("shop-window", SHOP_WINDOW, "木屋的橱窗", {
      kind: "carving", title: "橱窗里的木雕", lines: ["一架木雕。", "鹿站在最前面。", "后面是熊、狼、野猪。"], entry: "E-forest", minutes: 1,
    }, { sprite: { src: "sprites/woodcarving.webp", layer: "prop", sizeVh: 1.2 } }),
    // The benches and tables outside the white house. Empty today; that is the whole of it.
    { id: "bench", transform: BENCH, interactable: { verbs: ["inspect"], label: "长椅", reveal: 12, cost: { minutes: 0 } }, gaze: { radius: 12, dwell: 900 } },
    // A car pulled off onto the verge and two people beside it on the grass, backs to her, looking at the mountain.
    // Props only: no ring, no label, nothing to point at until the two pictures exist (see the header).
    { id: "car-parked", transform: CAR, sprite: { src: "sprites/car-parked.webp", layer: "prop", sizeVh: 9.5 }, visible: not(flag(CAR_GONE)) },
    { id: "hikers", transform: HIKERS, sprite: { src: "sprites/hikers-cn.webp", layer: "figure", sizeVh: 11 }, visible: not(flag(CAR_GONE)) },
    // A hello, for as long as the car is there. Three minutes, and they take one with her phone (v4 §7).
    { id: "hikers-greet", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["talk"], label: "跟路边那两位打个招呼", reveal: 0, cost: { minutes: 0 }, once: true },
      visible: carHere },
    // The clock takes them away at 09:43, whatever she did with the three minutes before it — including saying hello.
    { id: "car-leaves", transform: CAR, trigger: { source: { on: "minute", at: CAR_LEAVES_AT }, once: true, tag: "car-leaves" }, visible: not(flag(CAR_GONE)) },
    // The way on: up the grass on the left, toward the wall behind her. Never locked.
    goArrow("go", GRASS_WAY, { to: "meadow", minutes: 10, label: "往草甸走", kind: "walk" }),
  ],
  seed: (w) => {
    w.setFlag(SEEN, true); w.setFlag(GREETED, true); w.setFlag(PHOTO, true); w.setFlag(CAR_GONE, true);
    // What the roadside gives downstream: the legs' hours for the map on the plateau edge, and the carving for the forest.
    // (E-472 is not seeded here any more: with no picture there is no sign to read, and the timetable at `hairpin` carries it.)
    w.patch("journal", {
      entries: Array.from(new Set([...w.state.journal.entries, "E-route", "E-forest"])),
      mapLegs: { ...w.state.journal.mapLegs, ...(ENTRIES["E-route"].mapLegs ?? {}) },
    });
    seedPhoto(w);
  },
  walkthrough: [{ type: "travel", entity: "go" }],
  variants: {
    // Say hello, let them take one; then go.
    greet: [
      { wait: 600 },
      { type: "interact", entity: "hikers-greet", verb: "talk" }, { wait: 1200 },
      { type: "travel", entity: "go" },
    ],
    // Everything the roadside offers: the hello, the board, the carving, a shot of the wall, gloves and camera on, the memo.
    thorough: [
      { wait: 600 },
      { type: "interact", entity: "hikers-greet", verb: "talk" }, { wait: 1200 },
      { type: "interact", entity: "trail-board", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "shop-window", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "sassolungo", verb: "photograph" },
      { type: "interact", entity: "bench", verb: "inspect" },
      { type: "pack:open" }, { type: "pack:equip", item: "gloves" }, { type: "pack:equip", item: "camera360" }, { type: "pack:close" },
      { type: "phone:open", tab: "conversation" }, { type: "ui:action", id: "phone:tab", value: "conversation" }, { type: "phone:close" },
      { type: "travel", entity: "go" },
    ],
    // Read first: by the time she turns round the car has gone. The hello is refused (the hotspot is no longer there).
    late: [
      { type: "interact", entity: "trail-board", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "shop-window", verb: "read" }, { type: "overlay:close" }, { wait: 600 },
      { type: "interact", entity: "hikers-greet", verb: "talk" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Stand there and watch them instead: three settled breaths is three minutes, and at 09:43 the car pulls out.
    watch: [
      { type: "wait" }, { type: "wait" }, { type: "wait" }, { wait: 1200 },
      { type: "travel", entity: "go" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: Math.max(-6, Math.min(6, (target.yaw - here.yaw) * 0.15)), pitch: Math.max(-4, Math.min(4, (target.pitch - here.pitch) * 0.15)) });
    };
    // A phone shot of what she is looking at: the phone's business (shutter, a minute, 1%); the scene only turns her head.
    const shoot = (target: Transform) => { w.dispatch({ type: "phone:shoot" }); glanceAt(target, 0.35); };

    // Looking round. A glance of the camera, a sound off to one side, a minute off the clock. Only the wall gets a line.
    ctx.onInteract("sassolungo", (verb) => {
      if (verb === "photograph") return shoot(SASSOLUNGO);
      glanceAt(SASSOLUNGO, 0.7); ctx.sfx("exhale", 0.3, 0.6); ctx.setFlag("roadside.sassolungo", true);
      ctx.say("对面就是 Sassolungo。", { tag: "roadside-sasso" });
    });
    ctx.onInteract("road", (verb) => {
      if (verb === "photograph") return shoot(ROAD);
      glanceAt(ROAD, 0.5); ctx.fx("gust", 0.3); ctx.sfx("breath", 0.4, 0.35); ctx.setFlag("roadside.road", true);
    });
    ctx.onInteract("playground", (verb) => {
      if (verb === "photograph") return shoot(PLAYGROUND);
      glanceAt(PLAYGROUND, 0.5); ctx.setFlag("roadside.playground", true);
      ctx.sfx("clink", -0.6, 0.25); ctx.after(520, () => ctx.sfx("clink", -0.6, 0.18));   // the swing's chain in the wind
    });
    ctx.onInteract("hills", (verb) => {
      if (verb === "photograph") return shoot(HILLS);
      glanceAt(HILLS, 0.6); ctx.sfx("breath", -0.5, 0.5); ctx.setFlag("roadside.hills", true);
    });

    // Reading. Her hand goes to the thing, the camera dips; the board, the carving and the sign say everything themselves.
    ctx.onInteract("trail-board", (verb) => { if (verb !== "read") return; ctx.hand(BOARD); glanceAt(BOARD, 0.35); });
    ctx.onInteract("shop-window", (verb) => { if (verb !== "read") return; ctx.hand(SHOP_WINDOW); glanceAt(SHOP_WINDOW, 0.35); ctx.sfx("tock", 0.3, 0.3); });

    // The bench: she looks, it is empty, a breath. Nothing to say about it today.
    ctx.onGaze("bench", () => {
      if (ctx.flag("roadside.sawBench", false)) return;
      ctx.setFlag("roadside.sawBench", true);
      ctx.kick("settle", 0.3); ctx.sfx("breath", -0.1, 0.4);
    });
    ctx.onInteract("bench", () => { glanceAt(BENCH, 0.4); ctx.fx("gust", 0.25); ctx.setFlag("roadside.sawBench", true); });

    // The car pulls out: two doors and tyres coming off the gravel, all of it off to her right. No dust, no head
    // turned toward a piece of verge with nothing painted on it, and no words for a car (the second and third
    // sounds are the same event still finishing — well under the second §0.2 allows).
    const carLeaves = () => {
      if (ctx.flag(CAR_GONE, false)) return;
      ctx.setFlag(CAR_GONE, true);
      if (w.state.ui.travel) return;                                // the ten minutes of walking cross 09:43 too; she is not there to hear it
      ctx.sfx("door", 0.6, 0.7);
      ctx.after(480, () => ctx.sfx("door", 0.64, 0.5));
      ctx.after(900, () => ctx.sfx("slide", 0.7, 0.35));
    };
    ctx.onGaze("car-leaves", carLeaves);
    // Her phone in their hands and one shutter. Its own title: this is the one she did not take.
    const theirPhoto = () => {
      if (ctx.flag(PHOTO, false)) return;
      ctx.setFlag(PHOTO, true);
      seedPhoto(w);
      ctx.sfx("shutter", 0.4, 0.9);
    };
    // Hello. The whole encounter is three minutes (v4 §6) and it ends with the shutter, so the clock — never a
    // timer — is what shuts the doors: 09:40 + 3 is 09:43, and the minute trigger above fires on the same spend.
    ctx.onInteract("hikers-greet", () => {
      if (ctx.flag(GREETED, false) || ctx.flag(CAR_GONE, false)) return;
      ctx.setFlag(GREETED, true); ctx.setFlag(SEEN, true);
      ctx.kick("glance", 0.7, { yaw: 3, pitch: -2 }); ctx.sfx("breath", 0.5, 0.6);
      ctx.say("是看我视频的观众。", { tag: "roadside-greet", priority: 1 });
      theirPhoto();
      ctx.spend({ minutes: 3, battery: 1 }, "跟路边的两位打招呼，他们替她拍了一张");
    });
    ctx.on("phone:photo", ({ scene }) => { if (scene === "roadside") ctx.bump("roadside.photos", 1); });

    // The pack, here: gloves on is a hand, the camera on the strap is a clink; the map spread on the road is a dip of the head.
    ctx.on("item:equip", ({ item }) => {
      if (w.state.sceneId !== "roadside") return;
      if (item === "gloves") { ctx.hand({ yaw: 4, pitch: -16 }, "grip"); ctx.kick("settle", 0.3); }
      if (item === "camera360") { ctx.setFlag("roadside.cameraOnStrap", true); ctx.sfx("clink", -0.3, 0.4); ctx.kick("clink", 0.3); }
    });
    ctx.on("item:use", ({ item }) => {
      if (w.state.sceneId !== "roadside" || item !== "paperMap") return;
      ctx.bump("roadside.mapSpread", 1); ctx.kick("glance", 0.3, { yaw: 0, pitch: -3 });
    });

    // Standing still: the first breath brings a gust across the grass; the third, the swing's chain again, off to
    // the left — and that third breath is also 09:43, so the car goes on the clock, not on this counter.
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 1) { ctx.fx("gust", 0.35); ctx.kick("settle", 0.2); }
      if (stills === 3) ctx.sfx("clink", -0.6, 0.2);
    });
  },
});
