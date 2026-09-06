/* The gravel road under the Sella wall, 10:10. The road climbs the middle of the picture to a dark hollow at the
   foot of the wall; a big rounded bulge of the wall stands right of the road, a pale outcrop left of it. The grassy
   scree slope rises to the left, and the big bushes and the pass meadow fall away to the right, with the hut on it
   at the far right edge (1182–1238 × 610–647: roof, gable and window, not a dot).
   Coordinates read off the 150°×84° grid of 02-approach.
   WHAT IS AND IS NOT PAINTED: the wall, the road, the bulge, the pale block and the hut are painted; the rusted
   cable and the 1912 letters are not. This file used to hold a switch (ART_LANDED) that took both of them out of
   the scene until their pictures arrived, which emptied the whole "可发现的事" column §8 gives this node and took
   away the echo §6 asks for (1912 in the rock here, 1912 on the first bronze plate at `plaque` fifteen minutes
   later). The switch is gone. What decides whether a ring may exist is the contract's §1 rule and nothing else:
   **a sprite may name a file that does not exist yet; the view hides the img and leaves the ring where it is** —
   so a ring is allowed exactly when the thing it is drawn on is painted.
     · `carving-1912` sits on the lit face of the pale block at the wall's foot (a painted block, measured at 5x),
       and the reading overlay is what the letters say. Same construction as the four blank bronze plates at
       `plaque`, which are also read off a painting with no lettering in it.
     · `old-cable` is a pure sprite on the grey face right of the bulge — a shadowed groove is a real place on a
       real painted wall, and 旧钢缆 is what is hanging there. Until sprites/old-cable.webp lands the player finds
       cold rusted iron by touch, which is exactly what §6 prices at one minute.
   Both files are in docs/ART_QUEUE.md, old-cable first: it is the one that is only a sprite.
   The third candidate mark keeps its ring and takes the picture `blaze()` gives it by default (blaze-false.webp),
   so all three marks look like marks (§3.5) instead of two marks and a bare ring. */
import { entityIs, flag, not } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { EntityId, Transform } from "../engine/types";
import { blaze, goArrow, prop, readable } from "./_shared";

/* A mark that stays on its stone after she has read it (v4 §3.5 / §3.8 memory ③): the paint keeps a very faint
   highlight on the painting until she leaves the node, and can no longer be pressed. The shared factory hides the
   whole entity once it is read; here it stays and only its state changes — `enabled: false` is what fades it
   (`.hotspot.is-disabled { opacity:.35 }`), so no second picture is needed. Same three lines as meadow. */
const mark = (id: EntityId, transform: Transform, real: boolean, extra: Partial<EntityDef> = {}): EntityDef =>
  blaze(id, transform, real, { visible: undefined, enabled: not(entityIs(id, "read")), ...extra });

const CUT = "approach.cut";
const BOULDER: Transform = { yaw: 14, pitch: -12 };                   // the rounded bulge of the wall right of the road
const OUTCROP: Transform = { yaw: -19, pitch: -12 };                   // the lit face of the pale block at the wall's foot (478, 463); its top edge and the shadow behind it are at y 450
const OLD_CABLE: Transform = { yaw: 24, pitch: -6, distance: 12 };     // the grey face just right of the bulge
const HOLLOW: Transform = { yaw: -7, pitch: -12 };                     // the dark recess where the road ends
const WALL_TOP: Transform = { yaw: 0, pitch: 22, distance: 20 };       // the crest of the wall, straight overhead
/* The hut on the pass meadow, far right, and the one point in this file that had to be checked twice — once on the
   painting and once on a real frame, because at this corner the two do not agree to the pixel.
   ON THE PAINTING (the grid, contract §2): red-brown pixels of the building run x 1188–1240 by y 612–650 — dark
   gable wall, pale roof, one lit window. This point is the middle of that gable wall: (1206, 628), which is
   yaw = (1206/1280 − .5)×150 = 66.3 and pitch = (.5 − 628/720)×84 = −31.3.
   ON A REAL FRAME (drive with the pointer pushed to the bottom-right, gaze 67.5 / −37.2, which is as far as the
   camera goes): the hut's red-brown pixels land at x 1053–1131 by y 666–719, and the ring lands inside that box.
   The old (1195, 630) rendered about a degree up and left of the painted hut — that gap is the renderer's, not
   this file's (it shows on any anchor this far off axis), and it is written into `requests.engine`; the fix here
   is simply to aim at the middle of the wall instead of its top-left corner, which is on the hut in both frames.
   Reach: the gaze goes to about yaw 69 (yawLimit 28.5 + halfHfov·0.9) and pitch −37.6 (pitchLimit 12.9 + fov/2·0.9),
   so with reveal 18 the ring fades up while the head is still turning: at the corner the distance term is
   hypot(2.7, 6.3×1.4) = 9.2, well inside 18. Ring and label are both fully on screen in the frame above. */
const HUT: Transform = { yaw: 66.3, pitch: -31.3, distance: 30 };      // (1206, 628), the middle of the gable wall
const FINE_GRAVEL: Transform = { yaw: -32, pitch: -8 };                // the smooth sand between the stones, straight up the slope
const ROAD_TOP: Transform = { yaw: -2, pitch: -21 };                   // where the road narrows into the wall's foot

const FALSE_MARK_LINES: Record<string, string> = {
  "lichen-stone": "地衣。不是漆。",
  "arrow-old": "旧箭头。别的路线留下的。",
};

export default defineScene({
  id: "approach",
  day: 1, place: "Sella 石墙脚下 · 碎石路", elevation: "2,300 m",
  painting: "pano/02-approach.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.6, windTone: 1100, birds: 0.3, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust" },
  arriveAt: 10 * 60 + 10,
  idleLook: true,
  fallback: "碎石路。墙已经在头顶上了。",
  exitWhen: undefined,
  entities: [
    // Three candidate marks (v4 §3.5): the bulge right of the road carries the paint; a stone on the slope carries
    // lichen; the wall's right face carries an old arrow from another route. Indistinguishable until she is close.
    mark("blaze-boulder", BOULDER, true),
    mark("lichen-stone", { yaw: -36, pitch: -22 }, false),
    mark("arrow-old", { yaw: 40, pitch: -4 }, false),
    // What the wall keeps from 1912 (v4 §6/§8): a rusted length of cable on the face, and letters chiselled into
    // the pale block. Both rings are on painted stone; the two pictures are queued (see the header).
    prop("old-cable", OLD_CABLE, "sprites/old-cable.webp", 9, {
      interactable: { verbs: ["inspect"], label: "旧钢缆", reveal: 12, cost: { minutes: 1 } },
    }),
    readable("carving-1912", OUTCROP, "石头上凿的字", {
      kind: "carving", title: "PÖSSNECKER 1912",
      lines: ["PÖSSNECKER", "1912", "凿进石灰岩的字，边缘已经被风磨圆了。"],
      entry: "E-possnecker", minutes: 1,
    }, { sprite: { src: "sprites/carving-1912.webp", layer: "prop", sizeVh: 4.5 } }),
    // The hollow at the foot of the wall, and the crest straight overhead: looking is free and gets a breath, not a word.
    { id: "wall-foot", transform: HOLLOW, gaze: { radius: 12, dwell: 900 } },
    { id: "wall-up", transform: WALL_TOP, gaze: { radius: 14, dwell: 1000 } },
    // Looking back at the pass (v4 §6: 一分钟 + 那张回望的照片). One verb, because src/view/Hotspot.tsx only ever
    // dispatches verbs[0] — turning round and raising the phone is one movement, and §6 prices the whole movement
    // at one minute. That minute is the phone: `phone:shoot` charges it (UISystem) together with the 1%, so this
    // hotspot charges nothing of its own. It used to charge a minute as well, which made the look back cost two.
    // reveal 18, not 14: at the far right of the painting the ring has to fade in while the head is still turning,
    // or it only ever exists with the pointer jammed into the corner.
    { id: "pass-view", transform: HUT,
      interactable: { verbs: ["photograph"], label: "山口的木屋", reveal: 18, cost: { minutes: 0 } } },
    // The fine gravel straight up the slope looks shorter than the road. Every step slides back (v4 §8: −9 min, fatigue +0.08:
    // 0.05 here, and the 0.03 that BodySystem adds for the body:slip of severity 0.6 the hold emits — do not move the total into one place).
    { id: "gravel-cut", transform: FINE_GRAVEL, className: "foot-hotspot",
      interactable: { verbs: ["hold"], label: "细砾坡", reveal: 16, cost: { minutes: 9, fatigue: 0.05 } },
      hold: { ms: 900, scaleWith: ["fatigue"] }, visible: not(flag(CUT)) },
    // The way on: the road itself, where it narrows into the wall's foot. Never locked.
    goArrow("go", ROAD_TOP, { to: "plaque", minutes: 15, label: "碎石路往上", kind: "walk" }),
  ],
  seed: (w) => { w.setFlag("approach.certain", true); },
  walkthrough: [
    { type: "interact", entity: "blaze-boulder", verb: "inspect" },
    { wait: 400 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Cut straight up the fine gravel first: nine minutes and the slope gives them all back. Then the mark, then the road.
    cut: [
      { type: "hold:start", entity: "gravel-cut" }, { wait: 2600 }, { type: "hold:end" },
      { wait: 400 },
      { type: "interact", entity: "blaze-boulder", verb: "inspect" },
      { type: "travel", entity: "go" },
    ],
    // Everything the road offers: the false arrow, the lichen, the real mark, the old cable, the 1912 letters,
    // and the look back with its photograph.
    thorough: [
      { type: "interact", entity: "arrow-old", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "lichen-stone", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-boulder", verb: "inspect" },
      { type: "interact", entity: "old-cable", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "carving-1912", verb: "read" }, { type: "overlay:close" }, { wait: 300 },
      { type: "interact", entity: "pass-view", verb: "photograph" },
      { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Leave without confirming any mark: twelve minutes of looking for the path on the way out.
    blind: [{ type: "travel", entity: "go" }],
  },
  script: (ctx) => {
    const glance = (dir: { yaw: number; pitch: number }, strength = 0.4) => ctx.kick("glance", strength, dir);
    const shoot = () => ctx.world.dispatch({ type: "phone:shoot" });

    // The marks. The real one is settled by the journal (hand, cloth, the lesson if it is her first); the scene adds her feet.
    // A false one gets her hand, a glance down, and a word.
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (entity === "blaze-boulder" && real) { ctx.kick("settle", 0.5); ctx.sfx("step", 0.2, 0.5); return; }
      const line = FALSE_MARK_LINES[entity];
      if (!line) return;
      ctx.hand(ctx.transformOf(entity)); glance({ yaw: 0, pitch: -3 }, 0.4);
      ctx.say(line, { tag: `approach-${entity}` });
    });

    // The old cable: a hand on it, and it answers like the stone it has become.
    ctx.onInteract("old-cable", () => {
      ctx.setFlag("approach.cable", true);
      ctx.hand(OLD_CABLE); ctx.sfx("clink", 0.3, 0.5); ctx.kick("clink", 0.4);
      ctx.say("旧钢缆。锈成了石头的颜色。", { tag: "approach-cable" });
    });

    // The letters: her hand brushes the grit out of them. The reading overlay says the rest; she says nothing.
    ctx.onInteract("carving-1912", (verb) => {
      if (verb !== "read") return;
      ctx.hand(OUTCROP); glance({ yaw: 0, pitch: -2 }, 0.3); ctx.sfx("cloth", -0.2, 0.4);
    });

    // Looking back: she turns round, breathes, and takes it. No line — the hut is painted large enough to see for
    // yourself (it is 56 px of the picture, roof, gable and window), so there is nothing here for her to announce.
    ctx.onInteract("pass-view", () => {
      ctx.setFlag("approach.lookedBack", true);
      ctx.kick("turn", 0.5, { yaw: 1, pitch: 0 }); ctx.sfx("breath", 0.6, 0.5);
      shoot(); ctx.setFlag("approach.photoBack", true);
      glance({ yaw: 2, pitch: -2 }, 0.35);
    });
    ctx.on("phone:photo", ({ scene }) => {
      if (scene !== "approach") return;
      ctx.bump("approach.photos", 1);
      if (ctx.world.rt.gaze.yaw > 40) ctx.setFlag("approach.photoBack", true);
    });

    // The hollow at the wall's foot: a breath, and the camera settles. The crest overhead: a longer breath, and the head tips back.
    ctx.onGaze("wall-foot", () => {
      ctx.setFlag("approach.hollow", true);
      ctx.sfx("breath", -0.1, 0.4); ctx.kick("settle", 0.4);
      ctx.say("墙根下的空气是凉的。", { tag: "approach-foot" });
    });
    ctx.onGaze("wall-up", () => {
      ctx.setFlag("approach.lookedUp", true);
      ctx.sfx("exhale", 0, 0.6); glance({ yaw: 0, pitch: 3 }, 0.5);
    });

    // The fine gravel: nine minutes and the slope gives them all back. Letting go early slides too.
    ctx.onHold("gravel-cut", () => {
      ctx.setFlag(CUT, true);
      ctx.world.emit("body:slip", { entity: "gravel-cut", severity: 0.6 });
      ctx.sfx("slide", -0.5, 1); ctx.kick("slip", 1.1, { yaw: -2, pitch: -5 }); ctx.fx("dust", 0.9);
      ctx.say("细砾一直在往下走。", { tag: "approach-cut", priority: 1 });
    });
    // A hand laid on it for a moment answers with grit and dust and costs nothing; only a real try, given up, slides her back a minute.
    ctx.onRelease("gravel-cut", (progress) => {
      if (progress <= 0.05) return;
      ctx.sfx("slide", -0.5, 0.4); ctx.kick("slip", 0.4, { yaw: -1, pitch: -2 }); ctx.fx("dust", 0.5);
      if (progress <= 0.2) return;
      ctx.spend({ minutes: 1, fatigue: 0.01 }, "在细砾上滑了一下");
    });

    // Standing still under the wall. The first breath brings a gust down off it; the third, grit settling somewhere on the slope.
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 1 && !ctx.flag("approach.gusted", false)) { ctx.setFlag("approach.gusted", true); ctx.fx("gust", 0.7); ctx.kick("turn", 0.6); return; }
      if (stills === 3 && !ctx.flag("approach.grit", false)) { ctx.setFlag("approach.grit", true); ctx.sfx("slide", -0.6, 0.25); glance({ yaw: -3, pitch: 0 }, 0.3); }
    });

    // Leaving without the mark costs twelve minutes of looking for the path (v4 §3.5, gravel road). The exit is never locked.
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "approach" || to !== "plaque" || ctx.flag("approach.certain", false)) return;
      ctx.spend({ minutes: 12 }, "没认记号，找了一段路");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "approach-lost", priority: 1 });
    });
  },
});
