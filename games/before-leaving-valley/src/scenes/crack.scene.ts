/* The crack, 12:00 — UIAA II, no cable. A dark chimney up the pale wall with moss on its lips; a hairline across
   the block to the left; the smooth terrace to the right that looks so much easier. Three points of contact:
   one limb moves at a time, each hold only after the one below. Look before you grab (0.8 s on the thin flake
   shows the hairline, on the seam shows the sheen). The last hold: step on it honestly, or stretch past it to the
   lip of the crack. Deep in the dark there is a shelf — the only place on the whole wall to sit down.
   Coordinates read off the 150°×84° grid of 05-crack (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84).
   Entity budget: 15 of the 16 the contract allows. `wipe` is a story action but the view still projects it (it is
   parked below the painting, where PanoStage drops it) — the engine request to keep `tags:["action"]` out of
   buildViews is in this scene's output, and until it lands the one free slot is the margin.

   NO PENALTY FOR LEAVING UNSURE. §3.5 charges minutes for walking off without a confirmed mark on 草甸 / 碎石路·
   顶段 / 高原 / 夜森林 — four places where there is a wrong line to take. The crack is not one of them and never
   was on that list; it is a chimney with one way up it, exactly like `cable`, which charges nothing. The eight
   minutes that used to be charged here were an invention on top of §3.5 and sat straight on the fastest route.
   The paint on the middle block is still worth pressing (the journal, the lesson, the stats); it is worth no
   minutes, and the rust streak costs the minute that being unsure has always cost.

   ART STILL TO LAND: sprites/crack-ledge.webp (blocking — see below), hold-flake-cracked.webp, hold-groove-wet.webp.
   Nothing in this file describes any of them as if it were on screen; the shelf is labelled by the part of the
   painting it is in, and a used-up hold fades instead of changing its picture.
   ONE RULE FOR ALL OF THEM, and it is the contract's §1: a sprite may name a file that does not exist yet, the view
   hides the img, and the ring stays where it is. So `ledge` keeps its ring over the dark of the chimney even though
   crack-ledge.webp has not been drawn — deleting it would delete §6's only place on the whole wall to sit down —
   and it is labelled 「裂缝深处」 rather than 「岩台」 so the caption never promises a shape the picture has not
   got. The same rule and the same reading now hold in roadside (the trail board, the shop window, the two hikers
   and their car), approach (the 1912 letters and the old cable) and cable (the cap): a missing picture is a queue
   entry, never a reason to take a beat out of the game. crack-ledge.webp is the blocking one of the three, because
   it is the only one of them that a §6 row depends on. */
import { all, entityIs, flag, not } from "../engine/condition";
import type { Condition } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import { CRACK_HOLDS } from "../data/ferrata";
import type { EntityDef } from "../engine/entity";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow } from "./_shared";
import type { EntityId } from "../engine/types";

const STEP = "crack.step", WET = "crack.wet", SAT = "crack.sat";
const LEDGE = "crack.ledgeSeen", LUNGED = "crack.lunged", MISSED = "crack.lungeMissed", PRICKED = "crack.pricked", PHOTO = "crack.photoDown";

/* A mark that stays on its rock after she has read it (v4 §3.5 / §3.8 memory ③): the paint keeps a very faint
   highlight until she leaves the node, and can no longer be pressed. `enabled: false` is what fades it
   (`.hotspot.is-disabled { opacity:.35 }`); the shared factory would delete it from the painting instead. */
const mark = (id: EntityId, transform: Transform, real: boolean): EntityDef =>
  blaze(id, transform, real, { visible: undefined, enabled: not(entityIs(id, "read")) });

/* The four true holds in order, then the two that only look like holds. Positions re-read from the grid of 05-crack:
   the painting is bare limestone, so every hold is a sprite laid on the thing it stands on. */
const REAL = CRACK_HOLDS.filter((h): h is typeof h & { order: number } => h.order !== null).sort((a, b) => a.order - b.order);
const FALSE = CRACK_HOLDS.filter((h) => h.order === null);
const TOTAL = REAL.length;
const PLACE: Record<string, Transform> = {
  "hold-step": { yaw: 10, pitch: -24, distance: 9 },   // foot: the seam under the middle block, left of the crack (725, 566)
  "hold-edge": { yaw: 22, pitch: -5, distance: 9 },    // hand: the crack's left lip, moss beside it (828, 403)
  /* foot: the horizontal seam under the upper block, the one that runs in from the left edge of the picture and
     dies into the crack near x 827. pitch −1 was (691, 369), which on a 4× crop is the middle of that block's bare
     face — 55 px of blank stone between the seam above it (y ≈ 308) and this one, and 137 px clear of the crack.
     pitch −7 is (691, 420), on the seam itself, and it is below hold-edge at −5, which is the order the climb
     wants: the hand goes up, the foot comes up after it. */
  "hold-knob": { yaw: 6, pitch: -7, distance: 9 },     // (691, 420)
  "hold-slot": { yaw: 24, pitch: 13, distance: 9 },    // hand: inside the crack, between the two moss tufts (845, 249)
  // Both false holds stand inside the same reach envelope as the real ones, one arm span either side of the crack.
  "hold-flake": { yaw: 14, pitch: 7, distance: 9 },    // a thin flake propped on the block edge just left of the crack (760, 300)
  "hold-groove": { yaw: 35, pitch: 11, distance: 9 },  // the seam under the top-right block, right of the crack: the tempting long reach (939, 266)
};
const MINUTES = [4, 5, 5, 8];              // 22 on the holds + 38 to the box = the hour of v4 §3.1
const HOLD_MS = [700, 900, 900, 1100];
const LIP: Transform = { yaw: 22, pitch: 23 };                      // where the crack opens to the sky (828, 163)
const DEEP: Transform = { yaw: 32, pitch: -14, distance: 9 };       // the widest, darkest part of the chimney (913, 480)
const SHELF: Transform = { yaw: 29.7, pitch: -16, distance: 9 };      // the shelf inside it (905, 497)

const stepOf = (w: World) => w.flag<number>(STEP, 0);
const atStep = (n: number): Condition => n === 0 ? flag(STEP, { lt: 1 }) : all(flag(STEP, { gte: n }), flag(STEP, { lt: n + 1 }));
const mid = all(flag(STEP, { gte: 1 }), flag(STEP, { lt: TOTAL }));
const onWall = flag(STEP, { lt: TOTAL });
const lastStep = atStep(TOTAL - 1);
const isFoot = (order: number) => order % 2 === 0;

/* A true hold: only the one for the step she is on is there to be seen; each is a foot or a hand in turn. */
const realHold = (h: typeof REAL[number]): EntityDef => ({
  id: h.id, transform: PLACE[h.id] ?? h, className: "hold-hotspot",
  sprite: { src: h.sprite, layer: "prop", sizeVh: h.id === "hold-step" ? 7 : 6 },
  interactable: { verbs: ["hold"], label: h.label, reveal: 13, cost: { minutes: MINUTES[h.order] }, requires: atStep(h.order) },
  hold: { ms: HOLD_MS[h.order], scaleWith: ["fatigue"] },
  visible: atStep(h.order),
});

/* A false hold: a thin flake with a hairline in it, a shallow seam that seeps. Look at it 0.8 s and her hand will
   not go there. Both sit within reach of the climbing line, so refusing them is a real choice.
   No sprite swap on the look: sprites/hold-flake-cracked.webp and hold-groove-wet.webp are not drawn yet, and a
   picture that fails to load is hidden by the view — the hold would disappear instead of showing what is wrong with it. */
const falseHold = (h: typeof FALSE[number], sizeVh: number): EntityDef => ({
  id: h.id, transform: PLACE[h.id] ?? h, className: "hold-hotspot",
  sprite: { src: h.sprite, layer: "prop", sizeVh },
  interactable: { verbs: ["hold"], label: h.label, reveal: 13, cost: { minutes: 2 }, requires: not(entityIs(h.id, "read")) },
  hold: { ms: 500, scaleWith: ["fatigue"] },
  gaze: { radius: 13, dwell: 800 },
  visible: mid,
  /* Used up — looked at long enough to see what is wrong with it, or grabbed and paid for — it fades to .35 the
     way a confirmed mark does. Without this the seam stayed on the wall at full strength with its picture and its
     label unchanged after her hand had already slid out of it: a hold that had silently stopped working. Fading is
     `enabled`, and for a hold that is safe: view/Hotspot.tsx sends hold:start on pointer-down whatever the view
     says, so the press still reaches the engine and `requires` above turns it back.
     What the engine gives that refusal is one sound and nothing else — InteractionSystem's hold:start branch emits
     a tock and returns, and the hand + glance that the `interact` branch emits on the same kind of refusal are not
     on this path. §12 D7 wants two non-text channels, so the script adds the missing one itself (see the second
     hold:start handler at the bottom of the script). */
  enabled: not(entityIs(h.id, "read")),
});

const grab = (entity: string, wait: number): WalkStep[] => [{ type: "hold:start", entity }, { wait }, { type: "hold:end" }];
/* Hold waits are ms × 2.5 + 300 throughout: holdMs is ms × (1 + fatigue·0.6), so the route still runs at fatigue 1. */
const TO_THE_KNOB: WalkStep[] = [...grab("hold-step", 2100), ...grab("hold-edge", 2600), ...grab("hold-knob", 2600)];

export default defineScene({
  id: "crack",
  day: 1, place: "飞拉达 · 裂缝", elevation: "2,368 m",
  painting: "pano/05-crack.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.55, windTone: 900, birds: 0.2, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", gusty: false, windPan: 0.3 },
  arriveAt: 12 * 60,
  // Not "从这里开始，没有钢缆了" any more: that is the second line cast into plate ② at `plaque` (Tratto in
  // fessura: II grado UIAA, non attrezzato), and she does not read back what the player can read (§10.2.4).
  fallback: "手要自己找地方了。",
  exitWhen: flag(STEP, { gte: TOTAL }),
  entities: [
    ...REAL.map(realHold),
    falseHold(FALSE[0], 6),
    falseHold(FALSE[1], 6),
    // The last move: past the slot straight to the lip of the crack — one move fewer, a tenth of her hands, one in four does not reach.
    { id: "crack-lip", transform: LIP, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "裂缝顶端", reveal: 14, cost: { minutes: 2, fatigue: 0.1 }, requires: all(lastStep, not(flag(MISSED))) },
      hold: { ms: 1500, scaleWith: ["fatigue"] }, visible: all(lastStep, not(flag(MISSED))) },
    // Deep inside the chimney: only a gaze that goes into the dark finds the shelf.
    { id: "crack-deep", transform: DEEP, gaze: { radius: 14, dwell: 900 }, visible: all(onWall, not(flag(LEDGE))) },
    /* The one place on the whole wall to sit down (v4 §6). sprites/crack-ledge.webp — a pale shelf wedged across
       the dark chimney, one edge catching the light from the notch above — is still to be drawn, and 05-crack
       paints only the dark of the chimney there. So the label names the part of the painting the ring is in, not
       a shape the picture has not got: 「裂缝深处」. What is in there she finds out by putting her weight on it,
       and that is one line of hers, not a promise made by a caption. The label goes back to 「岩台」 with the
       picture. */
    { id: "ledge", transform: SHELF, sprite: { src: "sprites/crack-ledge.webp", layer: "prop", sizeVh: 7 },
      interactable: { verbs: ["use"], label: "裂缝深处", reveal: 13, cost: { minutes: 1 } }, visible: all(onWall, flag(LEDGE), not(flag(SAT))) },
    // Wet hands: a free wipe on the trousers (an E-key action; the transform sits below the painting so it never projects).
    { id: "wipe", transform: { yaw: 0, pitch: -88 }, tags: ["action"], interactable: { verbs: ["use"], label: "在裤子上蹭一下", reveal: 0, cost: { minutes: 0 } }, visible: flag(WET) },
    // The chimney below her, once she is up in it: the one photograph of the day taken straight down (v4 §8).
    // One verb, because view/Hotspot.tsx only ever dispatches verbs[0]; the free look is the gaze on the same point.
    { id: "view-down", transform: { yaw: 22, pitch: -36, distance: 12 },
      interactable: { verbs: ["photograph"], label: "裂缝下方", reveal: 12, cost: { minutes: 0 } },
      gaze: { radius: 12, dwell: 900 }, visible: flag(STEP, { gte: 1 }) },
    // Two candidate marks: red paint on the middle block beside the chimney; a rust streak under the seam on the right.
    mark("blaze-crack", { yaw: 14, pitch: -12 }, true),
    mark("rust-crack", { yaw: 42, pitch: -21 }, false),
    // Mid-way, the smooth terrace to the right looks far easier. It is not the route; slab's back arrow carries the twenty minutes.
    { id: "slab-way", transform: { yaw: 46, pitch: 3 }, className: "go-hotspot", tags: ["exit"],
      exit: { to: "slab", kind: "detour", label: "右边平滑的大石板", minutes: 0, condition: all(mid, not({ kind: "visited", scene: "slab" })) },
      interactable: { verbs: ["inspect"], label: "右边平滑的大石板", reveal: 20 } },
    // The way on, in the notch itself: at yaw 23 the painted rock inside the notch starts at y ≈ 160 (above that is
    // sky), so pitch 22 puts the arrow at (836, 171) — on the rock she pulls over, not in the air above it.
    goArrow("go", { yaw: 23, pitch: 22 }, { to: "mailbox", minutes: 38, label: "往上", kind: "walk" }),
  ],
  seed: (w) => {
    w.setFlag(STEP, TOTAL); w.setFlag(WET, false); w.setFlag(SAT, false); w.setFlag(LEDGE, false);
    w.setFlag("crack.certain", true);
  },
  script: (ctx) => {
    const w = ctx.world;
    const step = () => stepOf(w);
    const wet = () => ctx.flag(WET, false);
    const sat = () => ctx.flag(SAT, false);
    const gloved = () => w.state.inventory.worn.includes("gloves");
    let waits = 0;

    const stand = () => { if (!sat()) return; ctx.setFlag(SAT, false); ctx.sfx("cloth"); ctx.kick("settle", 0.5); };
    const top = () => { ctx.kick("settle", 1.2); ctx.sfx("exhale"); w.emit("body:rest", { seconds: 4 }); };

    // A true hold: one limb moves, the body follows. A foot is a push, a hand is a pull; bare hands pay the rock.
    // Wet hands cost a re-grip every time.
    const advance = (order: number, at: Transform) => {
      if (step() !== order) return;
      const next = order + 1;
      ctx.setFlag(STEP, next);
      if (isFoot(order)) { ctx.sfx("step", at.yaw / 60, 0.8); ctx.kick("step", 1.0, { yaw: 0, pitch: 3 }); }
      else {
        ctx.sfx("grip", at.yaw / 60); ctx.kick("pull", 1.0, { yaw: at.yaw * 0.1, pitch: 2 });
        if (!gloved()) {
          w.emit("body:fatigue", { delta: 0.02, reason: "没戴手套" });
          if (!ctx.flag(PRICKED, false)) { ctx.setFlag(PRICKED, true); ctx.say("石头扎手。", { tag: "crack-pricked" }); }
        }
      }
      if (wet()) { ctx.spend({ minutes: 1, fatigue: 0.03 }, "湿手再抓一次"); ctx.sfx("slide", at.yaw / 60, 0.5); ctx.kick("slip", 0.4, { yaw: 0, pitch: -3 }); }
      if (next === 3) ctx.say("石头是暖的。风从裂缝里出来。", { tag: "crack-warm" });
      if (next >= TOTAL) top();
    };
    for (const h of REAL) ctx.onHold(h.id, () => advance(h.order, PLACE[h.id] ?? h));
    // Letting go early: a slide back down to the hold below; wet fingers wear.
    for (const h of REAL) ctx.onRelease(h.id, (progress) => {
      if (progress <= 0.3) return;
      ctx.kick("slip", 0.4); ctx.sfx("slide", (PLACE[h.id] ?? h).yaw / 60, 0.5);
      if (wet()) w.emit("body:fatigue", { delta: 0.02, reason: "湿手松开" });
    });

    // A false hold grabbed without looking: it goes, the hand slides into the seep, two minutes and wet fingers.
    const fumble = (id: string, at: Transform) => {
      ctx.setFlag(WET, true);
      w.emit("body:slip", { entity: id, severity: 0.8 });
      ctx.sfx("slip", at.yaw / 60); ctx.kick("slip", 1.0, { yaw: 0, pitch: -5 });
      if (id === "hold-flake") { ctx.entity(id).patch({ hidden: true }); ctx.after(260, () => ctx.sfx("thud", at.yaw / 60, 0.5)); }
      else ctx.entity(id).patch({ read: true });
      ctx.say(id === "hold-flake" ? "石片碎了。" : "手滑出来了。", { tag: "crack-fumble", priority: 1 });
    };
    for (const h of FALSE) ctx.onHold(h.id, () => fumble(h.id, PLACE[h.id] ?? h));
    // Looking first: 0.8 s on the flake shows the hairline; on the seam, the sheen. After that her hand will not go
    // there — so each of them has to say, in half a line and one sound, what it is she has just seen. Without that
    // the seam was a hold that silently stopped working (sprites/hold-groove-wet.webp is still to be drawn).
    for (const h of FALSE) ctx.onGaze(h.id, () => {
      const state = ctx.entity(h.id).state;
      if (state.read || state.hidden) return;
      ctx.entity(h.id).patch({ read: true });
      const at = PLACE[h.id] ?? h;
      const flake = h.id === "hold-flake";
      ctx.kick("glance", 0.4, { yaw: at.yaw * 0.05, pitch: at.pitch * 0.05 });
      ctx.sfx(flake ? "tick" : "slide", at.yaw / 60, flake ? 0.6 : 0.35);
      ctx.say(flake ? "有一道发丝裂纹。" : "这道缝在渗水。", { tag: `crack-${h.id}` });
    });

    // The stretch past the last hold: a quarter of the time the fingers do not make it, and she does not try it twice.
    ctx.onHold("crack-lip", () => {
      if (step() !== TOTAL - 1) return;
      if (w.rt.rng() < 0.25) {
        ctx.setFlag(MISSED, true);
        w.emit("body:slip", { entity: "crack-lip", severity: 1 });
        ctx.sfx("slip", 0.3); ctx.after(300, () => ctx.sfx("thud", 0.3, 0.8)); ctx.kick("slip", 1.4, { yaw: 0, pitch: -8 });
        ctx.spend({ minutes: 4 }, "没够到，退回石突");
        ctx.say("没够到。", { tag: "crack-lunge-miss", priority: 1 });
        return;
      }
      ctx.setFlag(STEP, TOTAL); ctx.setFlag(LUNGED, true);
      ctx.sfx("grip", 0.3); ctx.kick("pull", 1.5, { yaw: 0, pitch: 4 }); ctx.hand(LIP, "grip", true);
      ctx.say("够到了。", { tag: "crack-lunge" });
      top();
    });

    // Reaching for any hold is standing up. The wipe: a hand down the thigh, dry again.
    ctx.on("hand:reach", ({ hold }) => { if (hold) stand(); });
    ctx.onInteract("wipe", () => { ctx.setFlag(WET, false); ctx.sfx("cloth"); ctx.hand({ yaw: 0, pitch: -22 }, "grip"); ctx.kick("glance", 0.5, { yaw: 0, pitch: -5 }); });

    // The shelf: a gaze into the dark finds it; sitting is the only rest on the whole wall (v4 §6: −0.05 per 8 s).
    ctx.onGaze("crack-deep", () => {
      if (ctx.flag(LEDGE, false)) return;
      ctx.setFlag(LEDGE, true);
      ctx.sfx("tick", 0.4, 0.5); ctx.kick("glance", 0.4, { yaw: 2, pitch: -3 });
    });
    ctx.onInteract("ledge", () => {
      ctx.setFlag(SAT, true); waits = 0;
      ctx.sfx("cloth"); ctx.sfx("exhale"); ctx.kick("settle", 1.0, { yaw: 0, pitch: -3 }); w.emit("body:rest", { seconds: 4 });
      ctx.say("这儿能坐下。", { tag: "crack-sit" });
    });
    ctx.onWait(() => {
      if (!sat()) return;
      waits += 1;
      w.emit("body:fatigue", { delta: -0.01, reason: "坐在岩台上" });
      ctx.sfx("exhale", 0, 0.6);
      if (waits % 3 === 0) { ctx.fx("gust", 0.35); ctx.kick("settle", 0.3); }
    });

    // Down the chimney: resting her eyes there is a glance and a breath and costs nothing; pressing it is the one
    // photograph taken straight down, and the phone charges its own minute and its 1% for it. No words either way —
    // she is looking at it.
    ctx.onGaze("view-down", () => { ctx.kick("glance", 0.6, { yaw: 0, pitch: -8 }); ctx.sfx("breath", 0.4, 0.6); });
    ctx.onInteract("view-down", () => {
      w.dispatch({ type: "phone:shoot" }); ctx.setFlag(PHOTO, true); ctx.kick("glance", 0.3, { yaw: 0, pitch: -4 });
    });

    // The marks: the paint settles the segment (hand and cloth from the journal); the rust costs its minute, no words.
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (entity === "blaze-crack" && real) { ctx.kick("settle", 0.5); ctx.sfx("step", 0.1, 0.4); return; }
      if (entity === "rust-crack") ctx.kick("glance", 0.4, { yaw: 2, pitch: -3 });
    });

    // Back from the terrace: the last move of the down-climb is a drop onto the step.
    ctx.onEnter((from) => {
      if (from !== "slab") return;
      ctx.kick("land", 0.9); ctx.sfx("thud", 0.5, 0.7); w.emit("body:rest", { seconds: 3 });
    });
    // Leaving: she stands if she was sitting. Nothing is charged for leaving unsure — see the header.
    ctx.on("travel:begin", ({ from }) => {
      if (from !== "crack") return;
      stand();
    });

    /* A used-up false hold, pressed again. `requires` refuses it inside InteractionSystem and that costs nothing —
       but all the engine puts on the hold:start refusal path is a tock, where the `interact` refusal path emits a
       hand and a glance as well. So this handler rides alongside the engine's on the same command and supplies the
       body half: her hand goes out to the seam and comes back, the camera dips, and the engine's tock lands with
       it. It is registered on the command (not on a bus event) because a refused hold never reaches the bus, and
       it is torn down with the scene. No cost, no text — she has already seen what is wrong with this one.
       (The engine-side fix, so that hold refusals and interact refusals feel the same everywhere, is in
       `requests.engine`; this stays correct either way, because it only fires when the hold is already refused.) */
    const offRefusedHold = w.handle("hold:start", ({ entity }) => {
      const h = FALSE.find((f) => f.id === entity);
      if (!h || w.rt.hold) return;                       // a hold that actually started is not a refusal
      const state = ctx.entity(entity).state;
      if (!state.read && !state.hidden) return;
      ctx.hand(PLACE[entity] ?? h, "grip");
      ctx.kick("glance", 0.4, { yaw: 0, pitch: -4 });
    });
    w.sceneUnsub(offRefusedHold);
  },
  // Fastest legal line: four holds and out. 4 + 5 + 5 + 8 on the holds and 38 walking is the hour §3.1 gives this
  // node. The paint is not in this line any more — it buys no minutes here (header) — it is in `thorough`.
  walkthrough: [
    ...TO_THE_KNOB, ...grab("hold-slot", 3100), { type: "travel", entity: "go" },
  ],
  variants: {
    // Two holds up, then the terrace that looks easier: leaves for `slab` (whose back arrow returns here with the twenty minutes).
    detour: [...grab("hold-step", 2100), ...grab("hold-edge", 2600), { type: "travel", entity: "slab-way" }],
    // The stretch: if it misses, the honest last hold follows; if it lands, that hold is simply refused.
    lunge: [...TO_THE_KNOB, ...grab("crack-lip", 4100), ...grab("hold-slot", 3100), { type: "travel", entity: "go" }],
    // The seam grabbed without looking: wet hands, the wipe, then the honest way up.
    // Replay this one WITHOUT ?reveal=1 (`crack&nosave=1`): reveal pins GazeSystem's radius at 999, so both false
    // holds are already "read" on the first frame and the grab is refused in silence. Unflagged it costs 2 minutes
    // and 0.04 fatigue, the seam fades out of use behind her, and crack.wet is back to false after the wipe.
    fumble: [
      ...grab("hold-step", 2100), ...grab("hold-edge", 2600),
      ...grab("hold-groove", 1600), { wait: 400 },
      { type: "interact", entity: "wipe", verb: "use" }, { wait: 300 },
      ...grab("hold-knob", 2600), ...grab("hold-slot", 3100), { type: "travel", entity: "go" },
    ],
    // Everything the crack offers that a script can reach: the mark, the shelf's minute, the photograph straight down.
    thorough: [
      { type: "interact", entity: "blaze-crack", verb: "inspect" }, { wait: 300 },
      ...grab("hold-step", 2100),
      { type: "interact", entity: "view-down", verb: "photograph" }, { wait: 300 },
      ...grab("hold-edge", 2600), ...grab("hold-knob", 2600), ...grab("hold-slot", 3100),
      { type: "travel", entity: "go" },
    ],
  },
});
