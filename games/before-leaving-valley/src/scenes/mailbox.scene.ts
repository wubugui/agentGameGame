/* The mailbox on the cliff at 2,379 m: a steel box bolted to the rock beside the cable's anchor, a Memo pad inside,
   one page dated 28/07/2025. To have hands she must first hang the lanyard on that anchor (no hint: her hand simply
   comes back from the box). The box opens; the pad turns through its rain-soaked leaves; the 28/07 page is read and,
   with no signal, photographed. Wanting to take the page is the one time in the game her hand comes back on its own.
   Coordinates read off the 150°×84° grid of 06-mailbox (yaw = (x/1280 − 0.5)·150, pitch = (0.5 − y/720)·84):
   the cable enters bottom left over the forest at (666, 637), climbs right across the pale wall — (1000, 499),
   (1152, 474), (1180, 470) — and reaches the bolted hanger plate at (1200..1250, 390..530) before leaving the frame
   at (1280, 445). Everything on the box itself is placed against the rendered mailbox sprite, not guessed: at 13.5 vh
   the box sprite measures about 92 × 97 px on screen, and the pad drawn inside it occupies fractions x 0.31..0.70,
   y 0.35..0.56 of that rectangle. The pass lies 180 m below to the left. */
import { LETTER_LINES_IT } from "../data/letter";
import { all, entityIs, flag, not, worn } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene, type WalkStep } from "../engine/scene";
import type { EntityId, Transform } from "../engine/types";
import type { World } from "../engine/world";
import { phoneDispatch } from "../systems/UISystem";
import { backArrow, blaze, goArrow, lookAt, readable } from "./_shared";

const CLIPPED = "mailbox.clipped", OPENED = "mailbox.opened", PAGE = "mailbox.page", SHOT = "mailbox.photographed";
const FLIPS = "mailbox.flips", VALLEY_SHOT = "mailbox.photoValley";
const LEAVES = 4;               // the pad: three rain-soaked leaves and the one that matters
const LETTER_LEAF = 2;          // the third leaf is the 28/07 page

/* Painted things. The hanger where the cable is bolted to the rock, top right; the box low on the wall under it; the
   cable's lower run at her feet, bottom left.
   The box is `mailbox-wall.webp` / `mailbox-wall-open.webp`: the recut that the art queue asked for and that is now on
   disk — the same green ammo box painted FACE ON, bolted through a flat plate, with no stone plinth under it and no
   cable of its own (the old mailbox-closed/open pair carried both, so it read as a boulder pasted on a vertical wall
   and its baked-in cable duplicated the painted one nine degrees away). Nothing is cropped or hidden any more, so the
   `mailbox-cut` class and the clip-path request are gone with it.
   It is also no longer a 13.5 vh postage stamp. She is standing at the box with a hand in it: at 28 vh the sprite
   draws 202 x 214 px on a 720-high viewport, which is a 25 cm box at arm's length, and — the reason the size had to
   move — the Memo pad the open sprite paints inside it (fractions x 0.315..0.675, y 0.345..0.60 of the file) then
   covers 96 x 43 px instead of 25 x 32, which is what the four things she does in there need to stop sharing one
   pointer target and one label line.
   Screen geometry used for every offset below: 12 px per degree of pitch (60 deg over 720 px), 14.2 px per degree of
   yaw (90 deg over 1280 px); at distance 9 PanoStage's scale is 0.9 x max(0.6, 10/9) = 1.00, so sizeVh really is the
   height on screen. 28 vh = 16.8 deg of pitch and 15.06 deg of yaw across the file. */
const ANCHOR: Transform = { yaw: 65, pitch: -12 };                    // the cable at the foot of the hanger plate (1195, 463)
const LANYARD_ON_ANCHOR: Transform = { yaw: 64.5, pitch: -15.5, distance: 9 };   // the carabiner hanging from it
const BOX: Transform = { yaw: 56, pitch: -25.5, distance: 9 };        // the box on the broken blocks under the cable (1118, 578)
/* Everything on the box is a fraction of the rendered sprite converted through the two numbers above. The box spans
   pitch -17.1..-33.9 and yaw 48.47..63.53; the open sprite's pad is the block x 0.315..0.675, y 0.345..0.60 inside
   that, and the 28/07 leaf stands up out of it against the open lid. */
const LID: Transform = { yaw: 56, pitch: -23.15 };                    // the closed lid, fraction (0.50, 0.36)
const PAD: Transform = { yaw: 55.9, pitch: -20.5, distance: 9 };      // the leaf standing up out of the pad, 14 vh
const PAD_EDGE: Transform = { yaw: 53.6, pitch: -26.8 };              // the pad's near left corner (0.34, 0.575)
const PAGE_AT: Transform = { yaw: 56.6, pitch: -21.3 };               // the writing on the standing leaf
const PAGE_CORNER: Transform = { yaw: 58.3, pitch: -24.4 };           // its loose bottom right corner
const CABLE_UP: Transform = { yaw: 60, pitch: -13.4 };                // the cable itself, rising past the box (1152, 474)
/* Traced on the plain plate column by column: the strand runs (620, 637) -> (666, 624) -> (700, 612) -> (760, 596).
   The old -32.3 anchored the arrow at y = 637, a ring's width under the cable at that x. */
const CABLE_FOOT: Transform = { yaw: 3, pitch: -30.8 };               // the cable's lower run, dropping away left (666, 624)

/** The only photograph of that page: taken with this phone, at this box. */
const LETTER_PHOTO = {
  asset: "art/letter-paper-v1.webp", title: "信箱里的那一页", place: "飞拉达 · 半途悬崖 2,379 m",
  position: { x: 50, y: 50 }, zoom: 1, day: 1, kind: "letter" as const,
};

const handsFree = flag(CLIPPED);
const onLetterLeaf = all(flag(OPENED), flag(PAGE, { eq: LETTER_LEAF }));

/* §3.5: settling a mark never deletes it. The `blaze` factory's default is `visible: not(entityIs(id,"read"))` — the
   paint and the rock it is on leave the wall the moment she has looked at them. Overriding `visible` (an `all` of
   nothing is true) keeps both marks where they are for as long as she is on this ledge, and `once` is what says they
   are settled: the second press comes back as `interact:refused` and the script answers it with her hand going out and
   returning. Not `enabled` — PanoStage writes an inline opacity onto every hotspot with a reveal every frame
   (PanoStage.tsx:427), so `.hotspot.is-disabled` never reaches the screen and a disabled mark is a silent dead button.

   The class that tells the grey one from the paint hangs off `sprite.swap` (registry.ts:69) and is gated on
   `entityIs(id,"read")`, so it comes into being only once she has walked up and settled that mark. Nothing written from
   `real` may sit on the entity itself: a class there would be in the DOM from the first frame and would sort true from
   false before she is near either of them (§3.5 / §12 A1). */
const settled = (id: EntityId, src: string, sizeVh: number, real: boolean): Partial<EntityDef> => ({
  visible: all(),
  sprite: { src, layer: "prop", sizeVh, swap: [{ when: entityIs(id, "read"), src, className: real ? "blaze-found" : "blaze-ruled-out" }] },
  interactable: { verbs: ["inspect"], label: "石头上的记号", reveal: 12, cost: { minutes: 0 }, once: true },
});

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
    { id: "mailbox", transform: BOX, sprite: { src: "sprites/mailbox-wall.webp", layer: "prop", sizeVh: 28, swap: [{ when: flag(OPENED), src: "sprites/mailbox-wall-open.webp" }] } },
    { id: "mailbox-lid", transform: LID,
      interactable: { verbs: ["use"], label: "金属盒", reveal: 13, cost: { minutes: 1 }, requires: handsFree },
      visible: not(flag(OPENED)) },
    // The Memo pad inside is painted into the open box: three rain-soaked leaves. Landing on the fourth stands one leaf
    // up against the open lid — the only leaf with writing on it, and the only one this sprite ever shows.
    { id: "memo-pad", transform: PAD, sprite: { src: "sprites/memo-page.webp", layer: "prop", sizeVh: 14 }, visible: onLetterLeaf },
    /* Turning the leaves is free. §4's rejected list says the three rain-soaked pages are scenery — "可翻，但不设时间
       成本、不设内容" — and ClockSystem rounds every spend, so half a minute a turn was a whole minute a turn driving
       the clock (§12 B10). The four minutes §6 gives this pad are on the page itself; the only thing a turn still costs
       is the forty seconds of pulling one glove off, once.
       便签本 sits on the pad still lying in the box (fraction 0.34, 0.575) and 这一页 on the leaf standing up out of it:
       three degrees of yaw and 7.3 of pitch apart — measured live, the two rings land at (993, 583) and (1045, 518),
       106 px apart with 97 px between the label lines, so the two names no longer print over each other. */
    { id: "memo-flip", transform: PAD_EDGE,
      interactable: { verbs: ["use"], label: "便签本", reveal: 12, cost: { minutes: 0 }, requires: handsFree },
      visible: flag(OPENED) },
    /* The loose corner of the page. Her hand goes halfway and comes back: the one refusal in the game — and it only
       exists once she has read the page, which is both why she would want it and what keeps the corner from covering
       the read on the one beat the whole game is built around. Declared before `letter-page` so the page is painted
       last and wins the pointer wherever the two rings still touch. */
    { id: "letter-take", transform: PAGE_CORNER,
      interactable: { verbs: ["take"], label: "纸角", reveal: 12, cost: { minutes: 0.5 }, requires: handsFree, once: true },
      visible: all(onLetterLeaf, entityIs("letter-page", "read"), not(entityIs("letter-take", "used"))) },
    readable("letter-page", PAGE_AT, "这一页", { kind: "note", title: "Memo · 28/07/2025", lines: LETTER_LINES_IT, entry: "E-memo", minutes: 4 },
      { visible: onLetterLeaf, interactable: { verbs: ["read"], label: "这一页", reveal: 12, cost: { minutes: 0 }, requires: handsFree } }),
    // The pass, 180 m below: meadow and forest, the road's hairpins at the far left, the houses at the foot of the wall.
    lookAt("valley", { yaw: -22, pitch: -4, distance: 18 }, "脚下的山口", 2),   // §6 gives this look 2 minutes, not 1
    lookAt("road", { yaw: -46, pitch: -33, distance: 16 }, "盘山公路", 1),
    lookAt("houses", { yaw: 12, pitch: -15.5, distance: 16 }, "公路边的房子", 1),
    { id: "far-peak", transform: { yaw: -36, pitch: 24, distance: 30 }, gaze: { radius: 12, dwell: 1000 } },
    // Two candidate marks: red paint on the wall above the cable, and a rust streak on the pale rock at her feet.
    // The streak is `blaze-streak-wet.webp` now that it exists — a water-spread orange-red stain with drips, on rock —
    // so 「锈。不是漆。」 names what is drawn there again instead of the lichen-crusted cobble it used to borrow.
    blaze("blaze-mailbox", { yaw: 41, pitch: -8 }, true, settled("blaze-mailbox", "sprites/blaze-red-white.webp", 4, true)),
    blaze("rust-mailbox", { yaw: 15, pitch: -31.5 }, false, settled("rust-mailbox", "sprites/blaze-streak-wet.webp", 7, false)),
    /* On: up the cable itself, the stretch between the box and the hanger. Back: down the cable to the crack, always open.
       §3.1 gives this node 25 minutes to the next one and puts the top of the ferrata at 13:25. The fastest legal line
       through the box now costs 8 of those (anchor 1, lid 1, one glove 1, the page 4, the photograph 1) with the leaves
       free, so the climb between the box and the hanger carries the other 17. */
    goArrow("go", CABLE_UP, { to: "exit", minutes: 17, label: "往上", kind: "walk" }),
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

    /* Pressed a second time — a mark she has already settled, the page corner her hand already came back from: the
       thing is still on the wall and still takes her hand, it just has nothing new in it. The hand goes out, one dry
       knock, and comes back; no text, no minute, never a dead button (as meadow, search). */
    ctx.on("interact:refused", ({ entity, reason }) => {
      if (reason !== "gone") return;
      const def = ctx.scene.entities.find((one) => one.id === entity);
      if (!def?.interactable?.once) return;
      const where = ctx.transformOf(entity);
      ctx.hand(where, "grip");
      ctx.kick("glance", 0.3, { yaw: 0, pitch: -4 });
      ctx.sfx("tock", Math.max(-1, Math.min(1, where.yaw / 60)), 0.3);
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
