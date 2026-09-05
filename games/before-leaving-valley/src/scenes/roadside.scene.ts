/* Passo Sella, the road, 09:40. The first stand of the day and the spot she will stand on again three days later
   (20-bus-stop is the same painting; the clock alone makes it morning). Sassolungo fills the middle; the white
   house with its wooden gable and the playground on the left; the wooden chalets and the road on the right, a car
   pulled onto the road with two people beside it, backs to her, looking at the mountain; the blank wooden signpost
   at the far right with the trail board pinned to its upper arm. The grass rises on the left: that is the way.
   Every coordinate was read off the 150°×84° grid of 20-bus-stop (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { ENTRIES } from "../data/entries";
import { MAP_LEGS } from "../data/map";
import { all, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { phoneDispatch } from "../systems/UISystem";
import { goArrow, lookAt, readable } from "./_shared";

const SEEN = "roadside.seen", GREETED = "roadside.greeted", CAR_GONE = "roadside.carGone", PHOTO = "roadside.photo";
/** They are leaving anyway: three minutes after she gets here the car pulls out (v4 §7: "40 秒后车开走"). */
const CAR_LEAVES_AT = 9 * 60 + 43;

// Things painted in 20-bus-stop, with the pixel they were read from.
const SASSOLUNGO: Transform = { yaw: 9, pitch: 16, distance: 40 };        // the great grey wall across the road (720, 220)
const ROAD: Transform = { yaw: 30, pitch: -28, distance: 12 };            // the tarmac with its dashed centre line (896, 600)
const PLAYGROUND: Transform = { yaw: -36, pitch: -16, distance: 16 };     // the wooden tower, the slide and the swings (333, 497)
const HILLS: Transform = { yaw: -46, pitch: 3, distance: 30 };            // the green slope rising on the left (247, 334)
const SHOP_WINDOW: Transform = { yaw: 23, pitch: -13.5, distance: 14 };   // the near chalet's dark ground-floor window (836, 476)
const BOARD: Transform = { yaw: 62, pitch: 0 };                            // the upper arm of the blank wooden signpost (1169, 360)
const BUS_SIGN: Transform = { yaw: 42, pitch: -15.5 };                     // the small post at the road's edge by the chalets (998, 493)
const BENCH: Transform = { yaw: -5, pitch: -16, distance: 14 };           // the bench outside the white house (597, 497)
const CAR: Transform = { yaw: 45.5, pitch: -21 };                          // on the right half of the road, this side of the sign (1028, 540)
const HIKERS: Transform = { yaw: 38.5, pitch: -22 };                       // beside the car, between it and the centre line (968, 549)
const GRASS_WAY: Transform = { yaw: -56, pitch: -8 };                      // the grass slope beyond the playground (162, 429)

const carHere = all(not(flag(CAR_GONE)), not(flag(GREETED)));
const hours = (h: number) => (h >= 1 ? `${Math.floor(h)} h${h % 1 ? ` ${Math.round((h % 1) * 60)}` : ""}` : `${Math.round(h * 60)} min`);
/** The trail board: the two route numbers, the legs of the way down with their times, the hut. Nothing she will ever repeat. */
const BOARD_LINES = [
  "649 · Passo Sella → Via ferrata Pössnecker → Piz Selva 2941 m",
  "656 · Piz Selva → Plan de Roces → Val Lasties 2455 m → Passo Sella",
  ...MAP_LEGS.map((leg) => `${leg.name} · ${hours(leg.hours)}`),
  "Rifugio Boè · Altopiano del Sella",
];

/** The one photograph from this roadside that is not hers: taken with her phone, by them. */
const seedPhoto = (w: World) => {
  if (w.state.phone.photos.some((photo) => photo.place === "Passo Sella · 公路边" && photo.day === 1)) return;
  phoneDispatch(w, { type: "capture_photo", photo: { asset: "pano/20-bus-stop.webp", title: "Passo Sella · 公路边", place: "Passo Sella · 公路边", position: { x: 50, y: 52 }, zoom: 1, day: 1 } });
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
    // The trail board pinned to the blank signpost's upper arm: route numbers, the legs and their times (v4 §6: 2 min → the map's hours).
    readable("trail-board", BOARD, "木牌上的步道展示牌", {
      kind: "board", title: "PASSO SELLA · SENTIERI 649 / 656", lines: BOARD_LINES, entry: "E-route", minutes: 2,
    }, { sprite: { src: "sprites/trail-board.webp", layer: "prop", sizeVh: 7 } }),
    // The chalet's shop window: a carved deer with a bear, a wolf and a boar behind it (v4 §6: 1 min → E-forest).
    readable("shop-window", SHOP_WINDOW, "木屋的橱窗", {
      kind: "carving", title: "橱窗里的木雕", lines: ["一架木雕。", "鹿站在最前面。", "后面是熊、狼、野猪。"], entry: "E-forest", minutes: 1,
    }, { sprite: { src: "sprites/woodcarving.webp", layer: "prop", sizeVh: 3 } }),
    // The blue 472 sign at the road's edge. No timetable: the account never gives one (v4 §12 B9).
    readable("bus-sign", BUS_SIGN, "蓝色站牌", {
      kind: "sign", title: "472", lines: ["472", "Passo Sella ↔ Canazei", "Fermata"], entry: "E-472", minutes: 1,
    }, { sprite: { src: "sprites/busstop-sign.webp", layer: "prop", sizeVh: 5 } }),
    // The bench outside the white house. Empty today; that is the whole of it.
    { id: "bench", transform: BENCH, interactable: { verbs: ["inspect"], label: "长椅", reveal: 12, cost: { minutes: 0 } }, gaze: { radius: 12, dwell: 900 } },
    // A car pulled onto the road and two people beside it, backs to her, looking at the mountain. They are leaving soon.
    { id: "car-parked", transform: CAR, sprite: { src: "sprites/car-parked.webp", layer: "prop", sizeVh: 6 }, visible: not(flag(CAR_GONE)) },
    { id: "hikers", transform: HIKERS, sprite: { src: "sprites/hikers-cn.webp", layer: "figure", sizeVh: 6.5 },
      gaze: { radius: 12, dwell: 700 }, visible: not(flag(CAR_GONE)) },
    // Once she has looked at them: a hello. Three minutes, and they take one with her phone (v4 §7). Or she shoulders the pack and goes.
    { id: "hikers-greet", transform: HIKERS, interactable: { verbs: ["talk"], label: "两个中国面孔", reveal: 14, cost: { minutes: 0 }, once: true },
      visible: all(flag(SEEN), carHere) },
    // The clock takes them away if she has not gone over by 09:43. Not a timer: minutes she spent.
    { id: "car-leaves", transform: CAR, trigger: { source: { on: "minute", at: CAR_LEAVES_AT }, once: true, tag: "car-leaves" }, visible: carHere },
    // The way on: up the grass on the left, toward the wall behind her. Never locked.
    goArrow("go", GRASS_WAY, { to: "meadow", minutes: 10, label: "往草甸走", kind: "walk" }),
  ],
  seed: (w) => {
    w.setFlag(SEEN, true); w.setFlag(GREETED, true); w.setFlag(PHOTO, true); w.setFlag(CAR_GONE, true);
    // What the roadside gives downstream: the legs' hours for the map on the plateau edge, the carving for the forest, the bus for the third day.
    w.patch("journal", {
      entries: Array.from(new Set([...w.state.journal.entries, "E-route", "E-forest", "E-472"])),
      mapLegs: { ...w.state.journal.mapLegs, ...(ENTRIES["E-route"].mapLegs ?? {}) },
    });
    seedPhoto(w);
  },
  walkthrough: [{ type: "travel", entity: "go" }],
  variants: {
    // Look at them, say hello, let them take one; then go.
    greet: [
      { wait: 1000 },
      { type: "interact", entity: "hikers-greet", verb: "talk" }, { wait: 900 },
      { type: "travel", entity: "go" },
    ],
    // Everything the roadside offers: the hello, the board, the carving, the sign, a shot of the wall, gloves and camera on, the memo.
    thorough: [
      { wait: 1000 },
      { type: "interact", entity: "hikers-greet", verb: "talk" }, { wait: 900 },
      { type: "interact", entity: "trail-board", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "shop-window", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "bus-sign", verb: "read" }, { type: "overlay:close" },
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
    ctx.onInteract("bus-sign", (verb) => { if (verb !== "read") return; ctx.hand(BUS_SIGN); glanceAt(BUS_SIGN, 0.35); });

    // The bench: she looks, it is empty, a breath. Nothing to say about it today.
    ctx.onGaze("bench", () => {
      if (ctx.flag("roadside.sawBench", false)) return;
      ctx.setFlag("roadside.sawBench", true);
      ctx.kick("settle", 0.3); ctx.sfx("breath", -0.1, 0.4);
    });
    ctx.onInteract("bench", () => { glanceAt(BENCH, 0.4); ctx.fx("gust", 0.25); ctx.setFlag("roadside.sawBench", true); });

    // The two by the car. Sound first: she hears what they are speaking, and only then is there anyone to greet.
    ctx.onGaze("hikers", () => {
      if (ctx.flag(SEEN, false) || ctx.flag(CAR_GONE, false)) return;
      ctx.setFlag(SEEN, true);
      ctx.sfx("cloth", 0.5, 0.4); glanceAt(HIKERS, 0.4);
      ctx.say("他们在说中文。", { tag: "roadside-cn" });
    });
    // The car pulls out: a door, then dust off the road and her eyes following it. No words for a car.
    const carLeaves = () => {
      if (ctx.flag(CAR_GONE, false)) return;
      ctx.setFlag(CAR_GONE, true);
      ctx.sfx("door", 0.6, 0.7);
      ctx.after(650, () => { ctx.fx("dust", 0.35); ctx.kick("glance", 0.3, { yaw: 2, pitch: 0 }); });
    };
    ctx.onGaze("car-leaves", carLeaves);
    // Hello. Two minutes of talking, then her phone in their hands and one shutter; the car leaves on that photo.
    ctx.onInteract("hikers-greet", () => {
      if (ctx.flag(GREETED, false) || ctx.flag(CAR_GONE, false)) return;
      ctx.setFlag(GREETED, true);
      ctx.spend({ minutes: 2 }, "跟路边的两位打招呼");
      ctx.kick("glance", 0.7, { yaw: 3, pitch: -2 }); ctx.sfx("breath", 0.5, 0.6);
      ctx.hand(HIKERS, "grip");
      ctx.say("是看我视频的观众。", { tag: "roadside-greet", priority: 1 });
      w.dispatch({ type: "phone:shoot" });
    });
    ctx.on("phone:photo", ({ scene }) => {
      if (scene !== "roadside") return;
      ctx.bump("roadside.photos", 1);
      if (ctx.flag(GREETED, false) && !ctx.flag(PHOTO, false)) { ctx.setFlag(PHOTO, true); carLeaves(); }
    });

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

    // Standing still: the first breath brings a gust across the grass; the third, the swing's chain again, off to the left.
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 1) { ctx.fx("gust", 0.35); ctx.kick("settle", 0.2); }
      if (stills === 3) ctx.sfx("clink", -0.6, 0.2);
    });
  },
});
