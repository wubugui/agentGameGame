/* The mailbox on the cliff at 2,379 m: a steel box bolted to the rock beside the cable's anchor, a Memo pad inside,
   one page dated 28/07/2025. To have hands she must first hang the lanyard on that anchor (no hint: her hand simply
   comes back from the box). The box opens; the pad turns through its rain-soaked leaves; the 28/07 page is read and,
   with no signal, photographed. Wanting to take the page is the one time in the game her hand comes back on its own.
   Coordinates read off the 150°×84° grid of 06-mailbox (yaw = (x/1280 − 0.5)·150, pitch = (0.5 − y/720)·84):
   the cable enters bottom left over the forest at (666, 637), climbs right across the pale wall — (1000, 499),
   (1152, 474), (1180, 470) — and reaches the bolted hanger plate at (1200..1250, 390..530) before leaving the frame
   at (1280, 445). Everything on the box itself is placed against the rendered mailbox sprite, not guessed: at 18 vh
   the box sprite measures about 123 × 130 px on screen, and the pad drawn inside it occupies fractions x 0.31..0.70,
   y 0.35..0.56 of that rectangle. The pass lies 180 m below to the left. */
import { LETTER_LINES_IT } from "../data/letter";
import { all, entityIs, flag, not, worn } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { phoneDispatch } from "../systems/UISystem";
import { backArrow, blaze, goArrow, lookAt, readable } from "./_shared";

const CLIPPED = "mailbox.clipped", OPENED = "mailbox.opened", PAGE = "mailbox.page", SHOT = "mailbox.photographed";
const FLIPS = "mailbox.flips", VALLEY_SHOT = "mailbox.photoValley";
const LEAVES = 4;               // the pad: three rain-soaked leaves and the one that matters
const LETTER_LEAF = 2;          // the third leaf is the 28/07 page

/* Painted things. The hanger where the cable is bolted to the rock, top right; the box low on the wall under it; the
   cable's lower run at her feet, bottom left.
   The box sprite carries a stone plinth baked into it (a green box bolted onto a boulder, painted three-quarters from
   above, in a bluer stone than this wall). It is 18 vh rather than 24, so the borrowed stone covers a third less of the
   pale face, and it sits lower and further right than it did, against the blockier rock instead of out on the smooth
   panel. It cannot go lower than this: measured live, past about pitch -30 the sprite runs off the bottom of the
   viewport and the pad hotspots stop being reachable. The real fix is a recut without the plinth (it is in the art
   request); nothing here points at art that does not exist, because the box must never stop being drawn. */
const ANCHOR: Transform = { yaw: 65, pitch: -12 };                    // the cable at the foot of the hanger plate (1195, 463)
const LANYARD_ON_ANCHOR: Transform = { yaw: 64.5, pitch: -15.5, distance: 9 };   // the carabiner hanging from it
const BOX: Transform = { yaw: 54, pitch: -25.5, distance: 9 };       // the box, on the blockier rock under the cable (1101, 579)
/* Everything on the box is an offset from BOX, kept in the proportions that were verified against the rendered sprite
   and rescaled with it (24 vh -> 18 vh, so each offset x 0.75), then re-measured live with getBoundingClientRect
   against the pad the open sprite actually paints (fractions x 0.31..0.70, y 0.35..0.56 of its rectangle). */
const LID: Transform = { yaw: 54.53, pitch: -22.95 };                 // its lid: fraction (0.55, 0.24) of the closed sprite
const PAD: Transform = { yaw: 53.7, pitch: -24.83, distance: 9 };     // the leaf standing up in the open box (0.47, 0.42)
const PAD_EDGE: Transform = { yaw: 52.95, pitch: -25.8 };             // the pad's near left corner (0.385, 0.51)
const PAGE_AT: Transform = { yaw: 54.3, pitch: -24.53 };              // the writing on that leaf (0.53, 0.40)
const PAGE_CORNER: Transform = { yaw: 54.9, pitch: -26.03 };          // its loose bottom right corner (0.60, 0.575)
const CABLE_UP: Transform = { yaw: 60, pitch: -13.4 };                // the cable itself, rising past the box (1152, 474)
const CABLE_FOOT: Transform = { yaw: 3, pitch: -32.3 };               // the cable's lower run, dropping away left (666, 637)

/** The only photograph of that page: taken with this phone, at this box. */
const LETTER_PHOTO = {
  asset: "art/letter-paper-v1.webp", title: "信箱里的那一页", place: "飞拉达 · 半途悬崖 2,379 m",
  position: { x: 50, y: 50 }, zoom: 1, day: 1, kind: "letter" as const,
};

const handsFree = flag(CLIPPED);
const onLetterLeaf = all(flag(OPENED), flag(PAGE, { eq: LETTER_LEAF }));

const takeLetterPhoto = (world: World) => {
  if (world.state.phone.photos.some((photo) => photo.kind === "letter")) return;
  phoneDispatch(world, { type: "capture_photo", photo: LETTER_PHOTO });
};

/* Clip, open, turn to the third leaf, read, put the page down. */
const TO_THE_PAGE: WalkStep[] = [
  { type: "interact", entity: "anchor", verb: "clip" }, { wait: 300 },
  { type: "interact", entity: "mailbox-lid", verb: "use" }, { wait: 300 },
  { type: "interact", entity: "memo-flip", verb: "use" }, { wait: 200 },
  { type: "interact", entity: "memo-flip", verb: "use" }, { wait: 200 },
  { type: "interact", entity: "letter-page", verb: "read" }, { wait: 400 },
  { type: "overlay:close" }, { wait: 600 },
];

export default defineScene({
  id: "mailbox",
  day: 1, place: "飞拉达 · 半途悬崖", elevation: "2,379 m",
  painting: "pano/06-mailbox.webp",
  body: "stand", material: "rock",
  ambience: { wind: 0.75, windTone: 1300, birds: 0.2, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { gusty: true, windPan: 0.3, clouds: true },
  arriveAt: 13 * 60,
  idleLook: true,
  fallback: "整个山口都在脚下。",
  exitWhen: flag(SHOT),
  entities: [
    // The anchor the cable is bolted to. The lanyard goes here first; until it does, nothing at the box will take her hand.
    { id: "anchor", transform: ANCHOR,
      interactable: { verbs: ["clip"], label: "锚点", reveal: 14, cost: { minutes: 1 }, requires: worn("lanyard") },
      visible: not(flag(CLIPPED)) },
    { id: "anchor-lanyard", transform: LANYARD_ON_ANCHOR, sprite: { src: "sprites/carabiner-blue.webp", layer: "hand", sizeVh: 7 }, visible: flag(CLIPPED) },
    // The box on the wall under the cable: closed until she has both hands; the lid is the thing she opens.
    { id: "mailbox", transform: BOX, sprite: { src: "sprites/mailbox-closed.webp", layer: "prop", sizeVh: 18, swap: [{ when: flag(OPENED), src: "sprites/mailbox-open.webp" }] } },
    { id: "mailbox-lid", transform: LID,
      interactable: { verbs: ["use"], label: "金属盒", reveal: 13, cost: { minutes: 1 }, requires: handsFree },
      visible: not(flag(OPENED)) },
    // The Memo pad inside is painted into the open box: three rain-soaked leaves. Landing on the fourth turns one leaf
    // up against the lid — the only leaf with writing on it, and the only one this sprite ever shows.
    { id: "memo-pad", transform: PAD, sprite: { src: "sprites/memo-page.webp", layer: "prop", sizeVh: 6 }, visible: onLetterLeaf },
    { id: "memo-flip", transform: PAD_EDGE,
      interactable: { verbs: ["use"], label: "便签本", reveal: 12, cost: { minutes: 0.5 }, requires: handsFree },
      visible: flag(OPENED) },
    readable("letter-page", PAGE_AT, "这一页", { kind: "note", title: "Memo · 28/07/2025", lines: LETTER_LINES_IT, entry: "E-memo", minutes: 4 },
      { visible: onLetterLeaf, interactable: { verbs: ["read"], label: "这一页", reveal: 12, cost: { minutes: 0 }, requires: handsFree } }),
    // The loose corner of the page. Her hand goes halfway and comes back: the one refusal in the game.
    { id: "letter-take", transform: PAGE_CORNER,
      interactable: { verbs: ["take"], label: "纸角", reveal: 12, cost: { minutes: 0.5 }, requires: handsFree, once: true },
      visible: all(onLetterLeaf, not(entityIs("letter-take", "used"))) },
    // The pass, 180 m below: meadow and forest, the road's hairpins at the far left, the houses at the foot of the wall.
    lookAt("valley", { yaw: -22, pitch: -4, distance: 18 }, "脚下的山口", 1),
    lookAt("road", { yaw: -46, pitch: -33, distance: 16 }, "盘山公路", 1),
    lookAt("houses", { yaw: 12, pitch: -15.5, distance: 16 }, "公路边的房子", 1),
    { id: "far-peak", transform: { yaw: -36, pitch: 24, distance: 30 }, gaze: { radius: 12, dwell: 1000 } },
    // Two candidate marks: red paint on the wall above the cable, and a rust streak on the pale rock at her feet.
    blaze("blaze-mailbox", { yaw: 41, pitch: -8 }, true),
    blaze("rust-mailbox", { yaw: 15, pitch: -31.5 }, false),
    // On: up the cable itself, the stretch between the box and the hanger. Back: down the cable to the crack, always open.
    goArrow("go", CABLE_UP, { to: "exit", minutes: 15, label: "往上", kind: "walk" }),
    backArrow("back", CABLE_FOOT, "crack", "回头", 15),
  ],
  seed: (w) => {
    w.setFlag(CLIPPED, false); w.setFlag(OPENED, true); w.setFlag(PAGE, LETTER_LEAF); w.setFlag(SHOT, true); w.setFlag(FLIPS, 2);
    w.setFlag("mailbox.certain", true);
    if (!w.state.inventory.items.includes("letterPhoto")) w.patch("inventory", { items: [...w.state.inventory.items, "letterPhoto"] });
    if (!w.state.journal.entries.includes("E-memo")) w.patch("journal", { entries: [...w.state.journal.entries, "E-memo"] });
    takeLetterPhoto(w);
  },
  script: (ctx) => {
    const w = ctx.world;
    let waits = 0;

    // Reading the page is photographing it: she lowers the sheet, the phone comes up. Not a choice.
    const shoot = () => {
      if (ctx.flag(SHOT, false)) return;
      takeLetterPhoto(w);
      ctx.setFlag(SHOT, true);
      ctx.hand(PAGE_AT, "grip");
      ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
      ctx.sfx("shutter");
      ctx.spend({ minutes: 1, battery: 1 }, "拍下那一页");
      ctx.give("letterPhoto", "letter-page");
      ctx.say("没有信号。先拍下来，以后翻译。", { tag: "mailbox-shot", priority: 1 });
    };
    const pageRead = () => Boolean(ctx.entity("letter-page").state.read);
    ctx.on("overlay", ({ id }) => { if (id === null && pageRead()) shoot(); });

    // The lanyard onto the anchor: a clink, and her hands are hers.
    ctx.onInteract("anchor", () => {
      ctx.setFlag(CLIPPED, true);
      ctx.sfx("clink", 0.5); ctx.kick("clink", 0.8); ctx.hand(LANYARD_ON_ANCHOR, "carabiner");
    });
    // The lid: stiff, then the clang of it against the rock.
    ctx.onInteract("mailbox-lid", () => {
      ctx.setFlag(OPENED, true); ctx.setFlag(PAGE, 0);
      ctx.sfx("tock", 0.4); ctx.after(350, () => ctx.sfx("thud", 0.4, 0.35));
      ctx.kick("settle", 0.5); ctx.hand(LID, "grip");
    });
    // Turning the leaves. With gloves on, the first turn costs a glove. Landing on the dated page: a tick of attention,
    // and the leaf comes up where the three soaked ones showed nothing.
    ctx.onInteract("memo-flip", () => {
      const flips = ctx.bump(FLIPS, 1);
      if (flips === 1 && w.state.inventory.worn.includes("gloves")) { ctx.spend({ minutes: 40 / 60 }, "脱一只手套"); ctx.sfx("cloth", 0.3, 0.6); }
      const leaf = (ctx.flag<number>(PAGE, 0) + 1) % LEAVES;
      ctx.setFlag(PAGE, leaf);
      ctx.sfx("paper", 0.3); ctx.kick("glance", 0.3, { yaw: 0, pitch: -2 }); ctx.hand(PAD_EDGE, "grip");
      if (leaf === LETTER_LEAF) ctx.sfx("tick", 0.3, 0.5);
    });
    ctx.onInteract("letter-page", (verb) => { if (verb === "read") { ctx.hand(PAGE_AT, "grip"); ctx.kick("glance", 0.3, { yaw: 0, pitch: -3 }); } });
    // The one time she refuses: the hand goes halfway, comes back, presses the page to the bottom of the box.
    ctx.onInteract("letter-take", () => {
      ctx.hand(PAGE_CORNER, "grip");
      ctx.after(500, () => { ctx.sfx("paper", 0.3, 0.7); ctx.kick("settle", 0.4); ctx.hand(PAD, "grip"); });
      ctx.say("它得留在这里。", { tag: "mailbox-keep" });
    });

    // Looking down. Each look is a glance and a minute; a photograph is the phone's shutter on top of that.
    const shot = (id: string) => { w.dispatch({ type: "phone:shoot" }); ctx.kick("glance", 0.3, { yaw: 0, pitch: -2 }); if (id === "valley") ctx.setFlag(VALLEY_SHOT, true); };
    ctx.onInteract("valley", (verb) => {
      if (verb === "photograph") return shot("valley");
      ctx.kick("glance", 0.5, { yaw: -3, pitch: -3 }); ctx.sfx("exhale", -0.2, 0.7);
      ctx.say("小得像一张地图。", { tag: "mailbox-valley" });
    });
    ctx.onInteract("road", (verb) => {
      if (verb === "photograph") return shot("road");
      ctx.kick("glance", 0.4, { yaw: -4, pitch: -3 }); w.emit("ambience", { overrides: { engine: 0.05 } });
    });
    ctx.onInteract("houses", (verb) => {
      if (verb === "photograph") return shot("houses");
      ctx.kick("glance", 0.4, { yaw: 2, pitch: -3 }); ctx.sfx("breath", 0.1, 0.5);
    });
    ctx.onGaze("far-peak", () => { ctx.fx("gust", 0.6); ctx.kick("turn", 0.5, { yaw: -1, pitch: 0 }); });

    // The marks: the paint settles the segment (hand and cloth from the journal); the rust costs its minute.
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (entity === "blaze-mailbox" && real) { ctx.kick("glance", 0.4, { yaw: 2, pitch: 2 }); return; }
      if (entity === "rust-mailbox") { ctx.kick("glance", 0.4, { yaw: 0, pitch: -4 }); ctx.say("锈。不是漆。", { tag: "mailbox-rust" }); }
    });

    // Standing still on the ledge: the second breath brings a car up from the pass road; the fourth, a gust.
    ctx.onWait(() => {
      waits += 1;
      if (waits === 2) { w.emit("ambience", { overrides: { engine: 0.06 } }); ctx.kick("settle", 0.25); }
      if (waits === 4) { ctx.fx("gust", 0.4); ctx.kick("settle", 0.3); }
    });

    // Back down from the top section: a drop onto the ledge.
    ctx.onEnter((from) => { if (from === "exit") { ctx.kick("land", 0.6); ctx.sfx("step", 0.2, 0.7); } });
    // Leaving either way: the page, if read, has been photographed; the lanyard goes back on the cable.
    // Going on without having settled which mark is paint costs the same eight minutes crack charges for the same doubt.
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "mailbox") return;
      if (pageRead()) shoot();
      if (ctx.flag(CLIPPED, false)) { ctx.setFlag(CLIPPED, false); ctx.sfx("clink", 0.3); ctx.kick("clink", 0.5); }
      if (to !== "exit" || ctx.flag("mailbox.certain", false)) return;
      ctx.spend({ minutes: 8 }, "没认记号，找了一段路");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "mailbox-lost" });
    });
  },
  // Fastest legal line: the paint costs 0 minutes and saves the 8 that travel:begin charges for leaving unsure.
  walkthrough: [
    { type: "interact", entity: "blaze-mailbox", verb: "inspect" }, { wait: 300 },
    ...TO_THE_PAGE, { type: "travel", entity: "go" },
  ],
  variants: {
    // Everything the ledge offers: the mark, three looks and the best photograph of the day, the other leaves, the corner of the page.
    thorough: [
      { type: "interact", entity: "blaze-mailbox", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "valley", verb: "photograph" }, { wait: 300 },
      { type: "interact", entity: "road", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "houses", verb: "inspect" }, { wait: 300 },
      ...TO_THE_PAGE,
      { type: "interact", entity: "memo-flip", verb: "use" }, { wait: 200 },
      { type: "interact", entity: "memo-flip", verb: "use" }, { wait: 200 },
      { type: "interact", entity: "memo-flip", verb: "use" }, { wait: 200 },
      { type: "interact", entity: "memo-flip", verb: "use" }, { wait: 200 },
      { type: "interact", entity: "letter-take", verb: "take" }, { wait: 800 },
      { type: "travel", entity: "go" },
    ],
    // The box before the anchor: her hand comes back, twice, then she hangs the lanyard and it opens. The rust for a mark,
    // and eight minutes on the top section for never having settled which one was paint.
    fumble: [
      { type: "interact", entity: "mailbox-lid", verb: "use" }, { wait: 400 },
      { type: "interact", entity: "rust-mailbox", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "mailbox-lid", verb: "use" }, { wait: 400 },
      ...TO_THE_PAGE,
      { type: "travel", entity: "go" },
    ],
    back: [{ type: "travel", entity: "back" }],
  },
});
