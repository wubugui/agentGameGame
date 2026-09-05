/* The crack, 12:00 — UIAA II, no cable. A dark chimney up the pale wall with moss on its lips; a hairline across
   the block to the left; the smooth terrace to the right that looks so much easier. Three points of contact:
   one limb moves at a time, each hold only after the one below. Look before you grab (0.8 s on the thin flake
   shows the hairline, on the seam shows the sheen). The last hold: step on it honestly, or stretch past it to the
   lip of the crack. Deep in the dark there is a shelf — the only place on the whole wall to sit down.
   Coordinates read off the 150°×84° grid of 05-crack (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84). */
import { all, entityIs, flag, not } from "../engine/condition";
import type { Condition } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import { CRACK_HOLDS } from "../data/ferrata";
import type { EntityDef } from "../engine/entity";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, lookAt } from "./_shared";

const STEP = "crack.step", WET = "crack.wet", SAT = "crack.sat";
const LEDGE = "crack.ledgeSeen", LUNGED = "crack.lunged", MISSED = "crack.lungeMissed", PRICKED = "crack.pricked", SKY = "crack.sky", PHOTO = "crack.photoDown";

/* The four true holds in order, then the two that only look like holds. Positions re-read from the grid of 05-crack:
   the painting is bare limestone, so every hold is a sprite laid on the thing it stands on. */
const REAL = CRACK_HOLDS.filter((h): h is typeof h & { order: number } => h.order !== null).sort((a, b) => a.order - b.order);
const FALSE = CRACK_HOLDS.filter((h) => h.order === null);
const TOTAL = REAL.length;
const PLACE: Record<string, Transform> = {
  "hold-step": { yaw: 10, pitch: -24, distance: 9 },   // foot: the seam under the middle block, left of the crack (725, 566)
  "hold-edge": { yaw: 22, pitch: -5, distance: 9 },    // hand: the crack's left lip, moss beside it (828, 403)
  "hold-knob": { yaw: 6, pitch: -1, distance: 9 },     // foot: a nub on the lip of the upper block, where its seam runs into the crack (691, 369)
  "hold-slot": { yaw: 24, pitch: 13, distance: 9 },    // hand: inside the crack, between the two moss tufts (845, 249)
  // Both false holds stand inside the same reach envelope as the real ones, one arm span either side of the crack.
  "hold-flake": { yaw: 14, pitch: 7, distance: 9 },    // a thin flake propped on the block edge just left of the crack (760, 300)
  "hold-groove": { yaw: 35, pitch: 11, distance: 9 },  // the seam under the top-right block, right of the crack: the tempting long reach (939, 266)
};
const MINUTES = [4, 5, 5, 8];              // 22 on the holds + 38 to the box = the hour of v4 §3.1
const HOLD_MS = [700, 900, 900, 1100];
const LIP: Transform = { yaw: 22, pitch: 23 };                      // where the crack opens to the sky (828, 163)
const DEEP: Transform = { yaw: 32, pitch: -14, distance: 9 };       // the widest, darkest part of the chimney (913, 480)
const SHELF: Transform = { yaw: 31, pitch: -16, distance: 9 };      // the shelf inside it (905, 497)

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

/* A false hold: a thin flake whose own sprite carries the hairline, a shallow seam that seeps. Look at it 0.8 s
   and her hand will not go there. Both sit within reach of the climbing line, so refusing them is a real choice. */
const falseHold = (h: typeof FALSE[number], seen: string, sizeVh: number): EntityDef => ({
  id: h.id, transform: PLACE[h.id] ?? h, className: "hold-hotspot",
  sprite: { src: h.sprite, layer: "prop", sizeVh, swap: [{ when: entityIs(h.id, "read"), src: seen }] },
  interactable: { verbs: ["hold"], label: h.label, reveal: 13, cost: { minutes: 2 }, requires: not(entityIs(h.id, "read")) },
  hold: { ms: 500, scaleWith: ["fatigue"] },
  gaze: { radius: 13, dwell: 800 },
  visible: mid,
});

const grab = (entity: string, wait: number): WalkStep[] => [{ type: "hold:start", entity }, { wait }, { type: "hold:end" }];
const TO_THE_KNOB: WalkStep[] = [...grab("hold-step", 1600), ...grab("hold-edge", 2000), ...grab("hold-knob", 2000)];

export default defineScene({
  id: "crack",
  day: 1, place: "飞拉达 · 裂缝", elevation: "2,368 m",
  painting: "pano/05-crack.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.55, windTone: 900, birds: 0.2, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", gusty: false, windPan: 0.3 },
  arriveAt: 12 * 60,
  fallback: "从这里开始，没有钢缆了。",
  exitWhen: flag(STEP, { gte: TOTAL }),
  entities: [
    ...REAL.map(realHold),
    falseHold(FALSE[0], "sprites/hold-flake-cracked.webp", 6),
    falseHold(FALSE[1], "sprites/hold-groove-wet.webp", 6),
    // The last move: past the slot straight to the lip of the crack — one move fewer, a tenth of her hands, one in four does not reach.
    { id: "crack-lip", transform: LIP, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "裂缝顶端", reveal: 14, cost: { minutes: 2, fatigue: 0.1 }, requires: all(lastStep, not(flag(MISSED))) },
      hold: { ms: 1500, scaleWith: ["fatigue"] }, visible: all(lastStep, not(flag(MISSED))) },
    // Deep inside the chimney: only a gaze that goes into the dark finds the shelf.
    { id: "crack-deep", transform: DEEP, gaze: { radius: 14, dwell: 900 }, visible: all(onWall, not(flag(LEDGE))) },
    { id: "ledge", transform: SHELF, sprite: { src: "sprites/crack-ledge.webp", layer: "prop", sizeVh: 12 },
      interactable: { verbs: ["use"], label: "岩台", reveal: 13, cost: { minutes: 1 } }, visible: all(onWall, flag(LEDGE), not(flag(SAT))) },
    // Wet hands: a free wipe on the trousers (an E-key action; the transform sits below the painting so it never projects).
    { id: "wipe", transform: { yaw: 0, pitch: -88 }, tags: ["action"], interactable: { verbs: ["use"], label: "在裤子上蹭一下", reveal: 0, cost: { minutes: 0 } }, visible: flag(WET) },
    // The chimney below her, once she is up in it: a look, or the one photograph of the day taken straight down.
    lookAt("view-down", { yaw: 22, pitch: -36, distance: 12 }, "裂缝下方", 1, { visible: flag(STEP, { gte: 1 }) }),
    // The clouds over the lip of the crack: rest the eyes there and the wind comes down the chimney.
    { id: "sky", transform: { yaw: 20, pitch: 36, distance: 40 }, gaze: { radius: 14, dwell: 1200 } },
    // Two candidate marks: red paint on the middle block beside the chimney; a rust streak under the seam on the right.
    blaze("blaze-crack", { yaw: 14, pitch: -12 }, true),
    blaze("rust-crack", { yaw: 42, pitch: -21 }, false),
    // Mid-way, the smooth terrace to the right looks far easier. It is not the route; slab's back arrow carries the twenty minutes.
    { id: "slab-way", transform: { yaw: 46, pitch: 3 }, className: "go-hotspot", tags: ["exit"],
      exit: { to: "slab", kind: "detour", label: "右边平滑的大石板", minutes: 0, condition: all(mid, not({ kind: "visited", scene: "slab" })) },
      interactable: { verbs: ["inspect"], label: "右边平滑的大石板", reveal: 20 } },
    goArrow("go", { yaw: 23, pitch: 28 }, { to: "mailbox", minutes: 38, label: "往上", kind: "walk" }),
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
    // Looking first: 0.8 s on the flake shows the hairline; on the seam, the sheen. After that her hand will not go there.
    for (const h of FALSE) ctx.onGaze(h.id, () => {
      const state = ctx.entity(h.id).state;
      if (state.read || state.hidden) return;
      ctx.entity(h.id).patch({ read: true });
      const at = PLACE[h.id] ?? h;
      ctx.sfx("tick", at.yaw / 60, 0.6); ctx.kick("glance", 0.4, { yaw: at.yaw * 0.05, pitch: at.pitch * 0.05 });
      if (h.id === "hold-flake") ctx.say("有一道发丝裂纹。", { tag: "crack-hairline" });
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

    // Looking down the chimney: a glance and a breath, and no words for the thing she is already looking at;
    // the photograph is the phone's shutter laid on top of the minute.
    ctx.onInteract("view-down", (verb) => {
      if (verb === "photograph") { w.dispatch({ type: "phone:shoot" }); ctx.setFlag(PHOTO, true); ctx.kick("glance", 0.3, { yaw: 0, pitch: -4 }); return; }
      ctx.kick("glance", 0.6, { yaw: 0, pitch: -8 }); ctx.sfx("breath", 0.4, 0.6);
    });
    // The clouds over the lip: once, the wind comes down the chimney.
    ctx.onGaze("sky", () => {
      if (ctx.flag(SKY, false)) return;
      ctx.setFlag(SKY, true);
      ctx.fx("gust", 0.6); ctx.kick("turn", 0.4, { yaw: 1, pitch: 0 }); ctx.sfx("breath", 0.3, 0.4);
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
    // Leaving: she stands if she was sitting; without the mark, the line out of the crack is found by feel (v4 §3.5).
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "crack") return;
      stand();
      if (to === "mailbox" && !ctx.flag("crack.certain", false)) { ctx.spend({ minutes: 8 }, "没认记号，找了一段路"); ctx.kick("turn", 0.5); ctx.say("走错了一小段。", { tag: "crack-lost", priority: 1 }); }
    });
  },
  // Fastest legal line: the paint costs 0 minutes and saves the 8 that travel:begin charges for leaving unsure.
  walkthrough: [
    { type: "interact", entity: "blaze-crack", verb: "inspect" }, { wait: 300 },
    ...TO_THE_KNOB, ...grab("hold-slot", 2400), { type: "travel", entity: "go" },
  ],
  variants: {
    // Two holds up, then the terrace that looks easier: leaves for `slab` (whose back arrow returns here with the twenty minutes).
    detour: [...grab("hold-step", 1600), ...grab("hold-edge", 2000), { type: "travel", entity: "slab-way" }],
    // The stretch: if it misses, the honest last hold follows; if it lands, that hold is simply refused.
    lunge: [...TO_THE_KNOB, ...grab("crack-lip", 3400), ...grab("hold-slot", 2400), { type: "travel", entity: "go" }],
    // The seam grabbed without looking: wet hands, the wipe, then the honest way up.
    // Replay this one WITHOUT ?reveal=1 (`crack&nosave=1`): reveal pins GazeSystem's radius at 999, so both false
    // holds are already "read" on the first frame and the grab is refused in silence. Unflagged it costs 2 minutes
    // and 0.04 fatigue, and crack.wet is back to false after the wipe (measured: reaches mailbox at minute 790,
    // i.e. 2 for the seep plus the 8 this variant pays for never confirming the mark).
    fumble: [
      ...grab("hold-step", 1600), ...grab("hold-edge", 2000),
      ...grab("hold-groove", 1200), { wait: 400 },
      { type: "interact", entity: "wipe", verb: "use" }, { wait: 300 },
      ...grab("hold-knob", 2000), ...grab("hold-slot", 2400), { type: "travel", entity: "go" },
    ],
    // Everything the crack offers that a script can reach: the mark, the shelf's minute, the photograph straight down.
    thorough: [
      { type: "interact", entity: "blaze-crack", verb: "inspect" }, { wait: 300 },
      ...grab("hold-step", 1600),
      { type: "interact", entity: "view-down", verb: "photograph" }, { wait: 300 },
      ...grab("hold-edge", 2000), ...grab("hold-knob", 2000), ...grab("hold-slot", 2400),
      { type: "travel", entity: "go" },
    ],
  },
});
