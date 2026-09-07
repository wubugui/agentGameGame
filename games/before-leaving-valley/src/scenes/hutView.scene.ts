/* The plateau edge, 16:00. The karst stops at a lip: a cracked table of limestone lies at her feet, a square
   grass-topped block stands out over the drop, and the whole valley opens away to the left with the far wall
   across it — the hut is the one dark thing standing on that far rim. To the right the pavement runs out into a
   dirt track with a red-white bar painted on a stone beside it. Here she spreads the map for the eighth time,
   adds the legs up, and decides: the hut, or straight down. Nothing here is locked; only the light is spent.
   Every coordinate was read off the 150°×84° grid of 09b-hut (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { after, before, entityIs, flag, has, not } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { EntityId, Transform } from "../engine/types";
import { goArrow, lookAt, offset, prop, windy, wrongWay } from "./_shared";

const CHOICE = "hutView.choice";
const SPREAD = "hutView.mapSpread";
const CERTAIN = "hutView.certain";
const SUMMED = "hutView.summed";
const WROTE = "hutView.wroteTime";
const HUT_LIT = 17 * 60;            // ClockSystem's hut-window-lit mark
const LOST_MINUTES = 15;            // v4 §3.5: no confirmed mark on the high plateau costs fifteen
const TO_SIGNPOST = 60;             // v4 §3.1: hutView 16:00 → signpost 17:00
const TO_HUTTURN = 22;              // 22 out + 23 back = the forty-five minutes of §7
const OBJ_TIME = "把从这里到公路的每一段时间加起来";
const OBJ_RETREAT = "紧急下撤：找 656 · Plan de Roces · Val Lasties";

// Things painted in 09b-hut, with the pixel they were read from.
/* distance 16 keeps the sprite out of PanoStage's scale clamp (max(0.6, 10/d)), so sizeVh really is the height on
   screen. The pitch is set from the painting rather than from the middle of the house: the grassy shelf the hut
   stands on runs through plate (350, 352) = pitch 0.93, and at 7 vh the file is 50 px tall = 4.2°, so the anchor
   sits 2.1° above the shelf and the walls come down onto it. */
const HUT: Transform = { yaw: -34, pitch: 3.2, distance: 16 };        // standing on the shelf above the far wall (350, 352)
const FAR_WALL: Transform = { yaw: -29.7, pitch: -8.6, distance: 20 }; // the middle of the layered grey wall on the far side (387, 434)
const MESA: Transform = { yaw: 12, pitch: 14.5, distance: 35 };       // the flat-topped range in the sun, centre skyline (742, 236)
const CLOUDS: Transform = { yaw: 36, pitch: 33, distance: 30 };       // the cloud bank over the right-hand massif (947, 78)
const MAP_STONE: Transform = { yaw: -20, pitch: -20.5, distance: 9 }; // the top face of the big cracked table rock (470, 531)
const CHOC_STONE: Transform = { yaw: -7, pitch: -22, distance: 9 };   // the same table, its narrow right end (580, 549)
const BLAZE_TRAIL: Transform = { yaw: 58.5, pitch: -33 };             // the red-white bar painted on the stone in the track (1139, 643)
const WHITE_SMEAR: Transform = { yaw: 57.4, pitch: -17 };             // the pale half-gone smear further up the same track (1130, 507)
const PAVEMENT_MARK: Transform = { yaw: 28, pitch: -18.7, distance: 12 }; // a slab of the limestone pavement, mid-field (880, 520)
/* The grass top of the square block, not its face: the block's upper surface runs from pitch −2.3 down to its front
   lip at −4, and the hotspot means "walk out onto it and stand above the drop", so it sits on the lip (570, 390). */
const SPUR: Transform = { yaw: -8, pitch: -3.5, distance: 14 };       // the square grass-topped block out over the drop (570, 390)
const RIM: Transform = { yaw: 14, pitch: -3.3, distance: 16 };        // the grass-and-stone lip running on past the block (760, 388)
const TRAIL: Transform = { yaw: 54, pitch: -24 };                     // the dirt track where it widens under her right hand (1101, 566)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* The house on the far rim. ONE prop with one src swap, not two entities: hut-far.webp and hut-far-lit.webp are now
   the same 611x401 file twice — same building, same camera, and (measured) an alpha silhouette that overlaps 1.000 —
   so the swap cannot move the house or change its size the way two differently-cropped paintings did. The old pair
   needed their sizeVh matched by hand on the width of the painted walls and still grew the building 17% at the one
   frame that is supposed to read "nothing changed but the window"; that whole correction is gone with them.
   It is a prop and not the hotspot's own sprite because PanoStage drives a Hotspot's opacity from how near the gaze
   is: while the house lived inside its hotspot it faded off the far rim whenever she was not looking straight at it,
   and 17:00's window could only be noticed by someone already staring at the spot it happens in. As a prop it is on
   the picture the whole time she stands here and the window comes on in the corner of the eye, which is what §8
   (17:00 山屋的窗户亮起来) is for; the hotspot beside it is only the minute she spends looking at it.
   Two measurements this file has to be honest about. (1) SCALE: the far wall is 200-300 m of rock drawn about 204 px
   tall, so a 7 m hut on its rim is 5-7 px — 7 vh (50 px) is a deliberate ~9x exaggeration, taken because a house
   that reads as a house is the only way §7's decision has an object, and stated here rather than hidden. It went up
   from 4 vh for the window's sake: (2) THE WINDOW — the warm pixels that separate the two files sit at fractions
   x 0.465..0.519, y 0.741..0.825, so the lit square went from 2.4 px to 4.2 px across, which is the difference
   between a warm pixel and a lit window at this range. It is the only warm colour anywhere on that side of the
   valley and the beat also turns her head and says one line.
   The swap carries a class as well as a src, and that is not decoration. Measured, hut-far-lit is keyed 27% darker
   overall than hut-far (mean luminance 90 against 123) — an evening key on a file that has to go up at 17:00, when
   lightOf() is still exactly 1 and the whole valley is bright, so the house dims at the very moment one window is
   supposed to brighten. `hut-lit` is where the interior of that value gets corrected in CSS until ART re-keys the
   file to hut-far's daylight value with only the window warm (both are filed: docs/ART_QUEUE.md and `requests`). */
const house = (id: EntityId, transform: Transform, sizeVh: number): EntityDef => ({
  id, transform,
  sprite: { src: "sprites/hut-far.webp", layer: "prop", sizeVh, swap: [{ when: after(HUT_LIT), src: "sprites/hut-far-lit.webp", className: "hut-lit" }] },
});

/* A candidate mark. Three of them, all labelled the same, indistinguishable until she is close (v4 §3.5).
   Two are painted into 09b-hut and carry no sprite of their own; the third is a lichened stone on the pavement.
   None of them is deleted out of the frame once she has settled it.
   Settled is `requires`, NOT `enabled` — and that is the whole fix. `enabled: false` makes `Hotspot` drop the
   click before it becomes a command (Hotspot.tsx:21), so a settled mark took the press and answered with nothing
   at all: a live-looking dead button, §12 D7. With `requires` the point still takes her hand and
   `InteractionSystem` (:47-53) sends the hand out and back with a dry tock and charges nothing, which is what a
   stone she has already read should do. The class the sprite picks up when it is settled is what carries §3.5's
   「确认过的记号留一点亮，排除掉的变灰」 for the one mark that has a sprite of its own. */
const mark = (id: EntityId, transform: Transform, real: boolean, sprite?: string): EntityDef => ({
  id, transform, blaze: { real }, className: "blaze-hotspot",
  interactable: { verbs: ["inspect"], label: "石头上的记号", reveal: 12, cost: { minutes: 0 }, requires: not(entityIs(id, "read")) },
  ...(sprite ? { sprite: { src: sprite, layer: "prop" as const, sizeVh: 3.5, swap: [{ when: entityIs(id, "read"), src: sprite, className: real ? "blaze-found" : "blaze-ruled-out" }] } } : {}),
});

export default defineScene({
  id: "hutView",
  day: 1, place: "高原边缘 · 望见山屋", elevation: "2,760 m",
  painting: "pano/09b-hut.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.7, windTone: 1350, birds: 0, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", clouds: true, gusty: true, windPan: 0.25 },
  arriveAt: 16 * 60,
  idleLook: true,
  fallback: "高原到这里就断了。",
  exitWhen: flag(CHOICE, { eq: "retreat" }),
  entities: [
    // The one built thing on the far rim. At 17:00 the file swaps under the same anchor and the same sizeVh: the
    // walls stand exactly where they stood and one window comes on. Nobody announces it.
    house("hut-house", HUT, 7),
    /* The minute she spends actually looking at it: a point, not a picture — and three degrees BELOW the house,
       on the grass shelf it stands on. On the same anchor the ring (55 x 26 px) and its label printed straight
       across the walls (50 px), so the one built thing in the picture was smaller than the button pointing at it.
       At −3 the ring sits under the walls and the gaze radius 12 still covers the whole house. */
    { id: "hut", transform: offset(HUT, 0, -3),
      interactable: { verbs: ["inspect", "photograph"], label: "对面岩壁上的房子", reveal: 12, cost: { minutes: 1 } },
      gaze: { radius: 12, dwell: 900 } },
    // Things to look at across the gap. None of them tells her anything she could not see.
    lookAt("far-wall", FAR_WALL, "对面的岩壁", 1),
    lookAt("mesa", MESA, "对面的台状山", 1),
    { id: "cloud-bank", transform: CLOUDS, gaze: { radius: 14, dwell: 1200 } },
    /* The eighth spreading of the map, on the table rock, and the most expensive read in the game: v4 §6 prices
       this row at 6–18 minutes and calls it 那道算术. Four minutes to get the sheet open and oriented on the rock,
       one more for the stone on each corner because this is a windy node (§3.7, spent in the script), and two for
       every leg she actually traces — 紧急下撤 pressed straight away pays the minimum, the whole arithmetic pays
       thirteen. Her own summary of the day is that she underestimated exactly this.
       reveal 20, not 12: before the decision this node has no exit on screen at all (exitWhen is unmet and the hut
       way is closed), so the map is the only way on, and a Hotspot fades to nothing past ~reveal°. The folded map
       has to surface while she is still turning her head across the rock, the way `go` already does. */
    prop("paper-map", MAP_STONE, "sprites/map-folded.webp", 11, {
      interactable: { verbs: ["use"], label: "在平石上摊开地图", reveal: 20, cost: { minutes: 4 }, requires: has("paperMap") },
    }),
    // The only meal of the day. Now, or on the scree, or in the forest — she never has it twice.
    prop("chocolate", CHOC_STONE, "sprites/chocolate.webp", 7, {
      interactable: { verbs: ["use"], label: "巧克力", reveal: 12, cost: { minutes: 0 }, requires: has("chocolate") },
      visible: has("chocolate"),
    }),
    // Three candidates on the way out: the bar in the track, the half-gone smear above it, a lichened stone on the pavement.
    mark("blaze-hut-a", BLAZE_TRAIL, true),
    mark("blaze-hut-b", WHITE_SMEAR, false),
    mark("blaze-hut-c", PAVEMENT_MARK, false, "sprites/blaze-false.webp"),
    // The block looks like the lip carries on over it. Six minutes to stand above nothing and come back.
    wrongWay("spur", SPUR, "崖边那块方岩", 6, "岩顶到头了。下面是山谷。"),
    // Two ways out, and only the map decides which one is open (v4 §7). The hut way is a dead end that costs light.
    goArrow("go-hut", RIM, { to: "hutTurn", kind: "detour", label: "沿崖边往山屋", minutes: TO_HUTTURN, condition: flag(CHOICE, { eq: "hut" }) }),
    // The track is painted into the bottom right corner of 09b-hut and the arrow stays on it; a wider reveal is
    // what makes it surface early while she is still turning her head that way (the fallback line does the rest).
    { ...goArrow("go", TRAIL, { to: "signpost", kind: "run", label: "顺土路下撤", minutes: TO_SIGNPOST }),
      interactable: { verbs: ["inspect"], label: "顺土路下撤", reveal: 28 } },
  ],
  seed: (w) => {
    w.setFlag(CHOICE, "retreat");
    w.setFlag(SPREAD, 2);
    w.setFlag(CERTAIN, true);
    w.setFlag(SUMMED, true);
    w.setFlag(WROTE, true);
    w.setFlag("map.legsChecked", 4);
    w.setFlag("map.legsPaid", "toFork,toScreeFoot,toForest,toRoad");   // the arithmetic is already paid for (§6)
    w.patch("journal", {
      mapLegs: { ...w.state.journal.mapLegs, toFork: 1, toScreeFoot: 1.5, toForest: 0.5, toRoad: 0.5 },
      objective: OBJ_RETREAT,
    });
    // The account: one bar of chocolate, the only meal of the day, eaten here.
    if (w.state.inventory.items.includes("chocolate")) {
      w.patch("inventory", {
        items: w.state.inventory.items.filter((item) => item !== "chocolate"),
        hands: w.state.inventory.hands.filter((item) => item !== "chocolate"),
      });
      w.setFlag("chocolate.eatenAt", "hutView");
    }
  },
  script: (ctx) => {
    const w = ctx.world;
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: clamp((target.yaw - here.yaw) * 0.15, -6, 6), pitch: clamp((target.pitch - here.pitch) * 0.15, -4, 4) });
    };
    const shoot = (target: Transform) => { w.dispatch({ type: "phone:shoot" }); glanceAt(target, 0.35); };
    const write = (text: string) => w.dispatch({ type: "ui:action", id: "map:objective", value: text });

    // --- The house on the far rim. Her eyes rest on it and the pencil goes to the margin of the map: the one
    //     objective in the whole game she writes for herself (v4 §5.2 obj-time). No line comes with it. ---
    ctx.onGaze("hut", () => {
      if (ctx.flag(WROTE, false)) return;
      ctx.setFlag(WROTE, true);
      write(OBJ_TIME);                                   // JournalSystem answers with the pencil
      glanceAt(HUT, 0.4);
      ctx.flash("地图边上多了一行铅笔字");
    });
    ctx.onInteract("hut", (verb) => {
      if (verb === "photograph") return shoot(HUT);
      glanceAt(HUT, 0.6); ctx.sfx("breath", -0.4, 0.5);
      ctx.setFlag("hutView.looked", true);
      ctx.say(ctx.minute() >= HUT_LIT ? "窗亮了。还是隔着一整个山谷。" : "对面。隔着一整个山谷。", { tag: "hut-look" });
    });
    /* 17:00. The window comes on across the valley: the file swaps under the same anchor, her head turns, one line,
       one entry. This line is NOT gated the way 「太阳低了一格。」 is thirty lines down, and the difference is that
       this one names something the picture really does: the same building, the same silhouette, one warm square
       where a moment ago there was none. What the swap still does not carry is a halo wide enough to be read on its
       own at 50 px across a whole valley, nor a daylight key under the lit window — both are ART notes, not reasons
       for the node to stay silent about the only thing in this picture that changes by itself. */
    const windowLit = () => {
      if (w.state.journal.entries.includes("E-hutLit")) return;
      glanceAt(HUT, 0.7); ctx.sfx("breath", -0.4, 0.45);
      ctx.say("对面亮了一盏灯。", { tag: "hut-lit", priority: 1 });
      ctx.learn("E-hutLit");
    };
    ctx.onMark("hut-window-lit", () => {
      if (w.state.sceneId !== "hutView" || w.state.ui.travel) return;   // only for someone still standing on the lip
      windowLit();
    });

    // --- Looking down, and looking across. Half a breath each, a minute off the clock, no words. ---
    ctx.onInteract("far-wall", (verb) => {
      if (verb === "photograph") return shoot(FAR_WALL);
      glanceAt(FAR_WALL, 0.6); ctx.sfx("exhale", -0.4, 0.55); ctx.setFlag("hutView.wall", true);
    });
    ctx.onInteract("mesa", (verb) => {
      if (verb === "photograph") return shoot(MESA);
      glanceAt(MESA, 0.5); ctx.sfx("breath", 0.2, 0.45); ctx.setFlag("hutView.mesa", true);
    });
    ctx.onGaze("cloud-bank", () => {
      if (ctx.flag("hutView.cloud", false)) return;
      ctx.setFlag("hutView.cloud", true);
      ctx.kick("turn", 0.6); ctx.fx("gust", 0.5); ctx.sfx("exhale", 0.4, 0.5);
    });

    // --- The map on the table rock. Stones on the corners because the wind is up here; then it is paper's business. ---
    ctx.onInteract("paper-map", () => {
      ctx.bump(SPREAD, 1);
      // ClockSystem rounds and drops anything that rounds to zero, so this is written as the whole minute the
      // clock actually takes: up here the paper will not lie still and a stone goes on each corner (v4 §3.7).
      if (windy(w)) ctx.spend({ minutes: 1 }, "用石头压住地图角");
      ctx.hand(MAP_STONE); glanceAt(MAP_STONE, 0.45);
      w.dispatch({ type: "item:use", item: "paperMap" });
      if (ctx.flag<number>(SPREAD, 0) === 1) ctx.say("我赶紧把地图啪地摊开。", { tag: "hut-map" });
    });
    /* A leg goes down under her finger: the pencil (JournalSystem), her head dipping to the paper, and two minutes
       off the day for it. The paid list is a flag rather than a counter because the estimate slider fires a
       ui:action on every step it passes through — a leg is charged the first time it is traced and never again,
       here or out on the rim (map.legsPaid is shared with hutTurn: one sheet, one piece of arithmetic). */
    ctx.on("ui:action", ({ id }) => {
      if (!id.startsWith("map:leg:")) return;
      if (!ctx.flag(SUMMED, false)) { ctx.setFlag(SUMMED, true); ctx.kick("glance", 0.25, { yaw: 0, pitch: -2 }); }
      const leg = id.slice("map:leg:".length);
      const paid = ctx.flag<string>("map.legsPaid", "").split(",").filter(Boolean);
      if (paid.includes(leg)) return;
      paid.push(leg);
      ctx.setFlag("map.legsPaid", paid.join(","));
      ctx.spend({ minutes: 2 }, "在地图上量一段");
    });

    // --- The decision. Both are real. Choosing the hut says nothing at all: it only spends light (v4 §7). ---
    ctx.onAction("map:choose:hut", () => {
      ctx.setFlag(CHOICE, "hut"); ctx.close();
      ctx.sfx("paper", -0.1, 0.7); ctx.kick("turn", 0.5, { yaw: 5, pitch: 0 });
    });
    ctx.onAction("map:choose:retreat", () => {
      ctx.setFlag(CHOICE, "retreat"); ctx.close();
      ctx.sfx("tick", 0, 0.8); ctx.kick("turn", 0.7, { yaw: 6, pitch: -2 });
      ctx.setFlag(WROTE, true);                          // the margin now carries 656, not the sum
      write(OBJ_RETREAT);
      ctx.say("紧急下撤。素材不要了，饭也不吃了。", { tag: "hut-decide" });
    });

    // --- The bar of chocolate. Three minutes, a breath that goes all the way down, and it is gone for the day. ---
    ctx.onInteract("chocolate", () => {
      w.dispatch({ type: "item:use", item: "chocolate" });
      ctx.hand(CHOC_STONE); ctx.kick("settle", 0.45); ctx.sfx("exhale", 0, 0.6);
      w.emit("body:rest", { seconds: 2 });
    });

    // --- The marks. The real one is settled by the journal (hand, cloth, certainty); the others get a word. ---
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.5); ctx.sfx("step", 0.4, 0.6); return; }
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
      ctx.say(entity === "blaze-hut-b" ? "旧漆。红的掉光了。" : "地衣。不是漆。", { tag: "hut-false" });
    });

    /* Pressed a second time — the block she has already walked out onto, a mark she has already settled. The thing
       is still there and still takes her hand; it just has nothing new in it. No text, no minute, never a dead
       button (§12 D7, as mailbox). `requires` on the marks is answered by InteractionSystem itself; this is for
       the `once` hotspots, which come back as reason "gone". */
    ctx.on("interact:refused", ({ entity, reason }) => {
      if (reason !== "gone") return;
      const def = ctx.scene.entities.find((one) => one.id === entity);
      if (!def?.interactable?.once) return;
      const where = ctx.transformOf(entity);
      ctx.hand(where, "grip");
      ctx.kick("glance", 0.3, { yaw: 0, pitch: -4 });
      ctx.sfx("tock", clamp(where.yaw / 60, -1, 1), 0.3);
    });

    // --- The block over the drop. She walks out on it, stands above the valley, comes back. Six minutes and dust. ---
    ctx.onInteract("spur", () => {
      ctx.setFlag("hutView.wrong", true);
      ctx.kick("step", 0.8); ctx.sfx("step", -0.2); ctx.fx("dust", 0.3);
      w.emit("body:fatigue", { delta: 0.02, reason: "方岩往返" });
      ctx.after(600, () => { ctx.kick("settle", 0.6); ctx.sfx("step", -0.1); });
      ctx.say("岩顶到头了。下面是山谷。", { tag: "hut-spur" });
    });

    // --- Standing still: the wind turns and comes up out of the valley once. ---
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills !== 2 || ctx.flag("hutView.gust", false)) return;
      ctx.setFlag("hutView.gust", true);
      ctx.fx("gust", 0.55); ctx.sfx("breath", -0.5, 0.5); ctx.kick("settle", 0.25);
    });

    /* --- Back from the way to the hut: the same lip, forty-five minutes gone, and the decision open again.
           The body carries the walk — a heavier settle, the wind a tone lower, one long gust up out of the valley.
           What §7 wants the walk to cost is 光, and the engine cannot spend it yet: lightOf() = (20:15 − now)/90 is
           exactly 1 for every minute before 18:45, so a round trip that starts at 16:00 comes back to the same
           tint, the same shadows and the same sky. The sun line is therefore gated on the light having really
           moved (it fires for anyone who takes the detour late enough), and the longer light tail is filed as a
           DESIGN request — this scene will not assert a sky that has not changed.
           The one price the picture CAN carry today is the window across the valley, and with the re-export that is
           now a real one: leave before 17:00, come back after it, and the far rim is the same house with a lit
           window in it. The clock's mark fires wherever she is standing, so the lip has to deliver it to anyone who
           was out on the rim when it passed and never saw it (the entry is what stops it arriving twice). --- */
    ctx.onEnter((from) => {
      if (from !== "hutTurn") return;
      ctx.setFlag("hutView.turned", true);
      ctx.setFlag(CHOICE, null);
      w.emit("ambience", { overrides: { wind: 0.8, windTone: 1180 } });
      ctx.kick("settle", 0.8); ctx.sfx("exhale", -0.3, 0.6);
      ctx.after(420, () => { ctx.fx("gust", 0.7); ctx.sfx("breath", -0.5, 0.5); });
      if (ctx.light() < 1) { ctx.say("太阳低了一格。", { tag: "hut-back" }); return; }
      if (ctx.minute() >= HUT_LIT) windowLit();
    });

    // --- Leaving down the track without a confirmed mark: fifteen minutes of looking for the line (v4 §3.5). ---
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "hutView" || to !== "signpost" || ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: LOST_MINUTES }, "没认记号，在高原边上找了一段路");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "hut-lost", priority: 1 });
    });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-hut-a", verb: "inspect" },
    { wait: 300 },
    { type: "interact", entity: "paper-map", verb: "use" },
    { wait: 400 },
    { type: "ui:action", id: "map:leg:toFork", value: 1 },
    { wait: 200 },
    { type: "ui:action", id: "map:choose:retreat" },
    { wait: 400 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // The hut: the map, the other button, and the twenty-two minutes out along the lip (hutTurn brings her back).
    detour: [
      { type: "interact", entity: "paper-map", verb: "use" },
      { wait: 400 },
      { type: "ui:action", id: "map:choose:hut" },
      { wait: 400 },
      { type: "travel", entity: "go-hut" },
    ],
    // The block over the drop, both false marks, then the real one and the track.
    wrong: [
      { type: "interact", entity: "spur", verb: "inspect" }, { wait: 900 },
      { type: "interact", entity: "blaze-hut-c", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "blaze-hut-b", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "blaze-hut-a", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "paper-map", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "map:choose:retreat" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Everything the lip offers: the house, a photo of it, the far wall, the mesa, the meal, the sums, the mark.
    thorough: [
      { type: "interact", entity: "hut", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "hut", verb: "photograph" }, { wait: 300 },
      { type: "interact", entity: "far-wall", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "mesa", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "chocolate", verb: "use" }, { wait: 400 },
      { type: "interact", entity: "blaze-hut-a", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "paper-map", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "map:leg:toFork", value: 1 },
      { type: "ui:action", id: "map:leg:toScreeFoot", value: 1.5 },
      { type: "ui:action", id: "map:leg:toForest", value: 0.5 },
      { type: "ui:action", id: "map:leg:toRoad", value: 0.5 }, { wait: 300 },
      { type: "ui:action", id: "map:choose:retreat" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // No mark at all: fifteen minutes of hunting for the line on the way down. The way out is never locked.
    blind: [
      { type: "interact", entity: "paper-map", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "map:choose:retreat" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
  },
});
