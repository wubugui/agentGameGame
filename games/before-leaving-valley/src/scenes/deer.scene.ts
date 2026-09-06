/* Val Lasties, 19:20. The scree stops. She steps off the last white boulders onto grass, and there is a herd
   standing in it between her and the tree line — a dozen of them, the only living thing she has seen all day
   (SOURCE_TRANSCRIPT day 1 §9). However she plays it they end the same way: startled, heads round, gone back into
   the far forest. What the player decides is only how much of them he gets first, and how late he got here to
   look (v4 §6 deer: 完整的一群 → 几个影子 → 两点反光; v4 §7 deer: 停住 / 绕开 / 直接走过去).
   Every coordinate was read off the 150°×84° grid of 12-deer (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { all, any, entityIs, flag, not } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { blaze, goArrow, lookAt, prop } from "./_shared";

const SEEN = "deer.seen";        // the invariant every later scene leans on (contract §6)
const HOW = "deer.how";          // "still" | "skirt" | "through"
const BOLTED = "deer.bolted";
const FLEEING = "deer.fleeing";  // the 800 ms while they are actually running
const ALERT = "deer.alert";      // heads up, watching her
const FAWN = "deer.fawn";        // the smallest one has come two steps closer
const WATCH = "deer.watching";   // she took the tree line: they have turned and are tracking her
const GONE = "deer.gone";        // she made a noise before she got here: they left without her
const COUNTED = "deer.counted";
const PHOTO = "deer.photo";
const CERTAIN = "deer.certain";

const TO_FOREST_EDGE = 55;       // v4 §3.1: deer 19:20 → forestEdge 20:15
const LOST_MINUTES = 12;         // no confirmed mark: v4 §3.5 charges 12 for this terrain band (scree uses 12 too)

// Things painted in 12-deer, with the pixel they were read from.
/* deer-herd.webp has been re-cut since the anchor below was set, and re-measured against the file that is now on
   disk it comes out right. The file is 902x390 and it is DEER ONLY: no spruce band, no grass tufts, fourteen
   animals on transparency. Row-scanned off its alpha, the content runs y 26-365 (6.7% to 93.6% of the height) and
   x 26-877 (2.9% to 97.2% of the width), so nothing but animals is drawn.
   At 18 vh and distance 14 the sprite renders 130 x 301 px (PanoStage's scale is 14/10 x max(.6, 10/14) = 1.00,
   so sizeVh is the height on screen), and centred on the anchor it occupies y 501-631, x 571-872 of the 1280x720
   grid. The animals themselves stand from y 510 (the far heads, up against the painted larches, whose bases run
   y 500-560 across this span) down to y 623, which is painted grass everywhere between x 579 and the sandy path
   at x 860 - 12-deer draws the wood-to-grass line at about y 585, so the herd stands in the open with the wood
   behind it, which is where §6 puts it. The animals come out 4 vh (back row) to 9.4 vh (front row): a 1.4 m deer
   at about thirty down to thirteen metres.
   The old tree-band problem is gone with the old file; what is still missing is the dusk progression, and that is
   three faces of the herd, not a placement (ART request, see the herd entity). */
const HERD: Transform = { yaw: 9.5, pitch: -24, distance: 14 };       // the herd at the wood edge, its front rows out on the grass (721, 566)
const HERD_RUN: Transform = { yaw: 15, pitch: -25.5, distance: 12 };  // where they go up, half a step nearer the trees (768, 578)
const FAWN_AT: Transform = { yaw: 11, pitch: -30, distance: 11 };     // the open grass two steps nearer, in front of the herd's front row (734, 617)
const PRESS: Transform = { yaw: 12.3, pitch: -30.1, distance: 10 };   // the grass they were standing in, left of the sand (745, 618)
const HOOF: Transform = { yaw: 23.5, pitch: -32, distance: 9 };       // the wide sandy path in front of her feet; the sand runs 804-875 here (841, 634)
const TREELINE: Transform = { yaw: 12, pitch: -15.5 };                // the tall dark spruce where the scree runs into the wood (745, 493)
const BOULDER: Transform = { yaw: 26.7, pitch: -24.7 };               // the big white boulder standing beside the path, painted (855-885, 558-585)
const RUST_ROCK: Transform = { yaw: -14.5, pitch: -19.3 };            // the rust-orange block in the boulder field at the scree foot (516, 526)
const SCREE_BACK: Transform = { yaw: -36, pitch: -2, distance: 16 };  // the pale cone of the scree she has just come down (333, 377)
const SUNSET: Transform = { yaw: 32, pitch: 26, distance: 16 };       // the orange cloud band over the right-hand sky (912, 137)
const SASSO: Transform = { yaw: 44.5, pitch: 8.7, distance: 16 };     // the jagged grey wall across the valley (1020, 285)
const TRAIL_IN: Transform = { yaw: 41, pitch: -27.5 };                // where the sandy path runs out under the first larches (1007, 597)

/* The two light thresholds §6 hangs the herd on are 19:48 (lightOf < 0.3, 几个影子) and 20:15 (0, 两点反光).
   They are not conditions in this file yet: the three dusk faces they would switch to do not exist, and a
   condition that resolves to a missing file empties the frame instead of changing it (ART request). */
const HERE = all(not(flag(GONE)), not(flag(BOLTED)));
const AFTERWARDS = any(flag(BOLTED), flag(GONE));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pan = (t: Transform) => clamp(t.yaw / 45, -1, 1);

/* A look she only takes once: after that the hotspot is spent (as in roadside / exit / signpost / summit). */
const look1 = (id: string, t: Transform, label: string, extra: Partial<EntityDef> = {}): EntityDef =>
  lookAt(id, t, label, 1, {
    interactable: { verbs: ["inspect", "photograph"], label, reveal: 12, cost: { minutes: 1 }, once: true },
    ...extra,
  });

export default defineScene({
  id: "deer",
  day: 1, place: "Val Lasties · 坡脚林线", elevation: "2,050 m",
  painting: "pano/12-deer.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.45, windTone: 900, birds: 0.15, crickets: 0.35, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen", windPan: 0.3 },
  arriveAt: 19 * 60 + 20,
  idleLook: true,
  fallback: "灰白的碎石坡到这里就完了。",
  // No gate: leaving is itself one of the three ways past them (v4 §7), and it is what sets deer.seen.
  exitWhen: undefined,
  entities: [
    /* The herd, standing in the grass with the wood behind it: the whole subject of the node, and it has to be on
       the screen. It is TWO entities at one anchor — the picture of them (a prop) and the place her eyes and her
       hand go (a hotspot) — because only PropSprite passes a sprite's className through to the <img>, and the
       className is the one handle this file has on §6's 到得越晚看见得越少.
       THE THREE FACES ARE ON DISK NOW (ART, art-5; re-cut art-6). All three are made from deer-herd.webp's own
       pixels on its own 1549x682 canvas: deer-shadows only crushes the light, and the two heads-up faces move
       nothing below the shoulder line (measured: the silhouette below it is identical pixel for pixel; the whole
       silhouette overlaps deer-shadows 0.92), so every animal keeps its place, its pose and its size across the
       swap and only the light and the necks change. What the alert face does NOT do is turn the heads to the
       camera: the animals in deer-herd stand in profile, their necks come up, and turning a painted profile head
       into a face is a redraw, which is what the art-5 attempt did and why the whole herd moved. 19:48
       (light < 0.3) takes the herd down to silhouettes, and if her standing still has already lifted their heads
       (ALERT, also set by the tree-line walk) it is the heads-up silhouette instead; sunset (light 0) leaves an
       almost black herd with two points of eyeshine - one on each of the two hinds nearest her beam, which is
       what 「两点反光」 describes on a herd standing side-on. That is §6's 完整的一群 → 几个影子 → 两点反光, and a player who
       took the careful line down the scree now finds a different herd from the one who ran the sand — the hour
       is in the picture instead of only in the phone. Entries are tested in order, first match wins, so night
       comes before dusk and the alert dusk face before the plain one.
       Running is a separate entity, not a swap, because deer-fleeing.webp is six animals filling its frame and a
       swap entry cannot carry its own sizeVh — at the herd's 18 vh those six would be three metres tall. */
    { id: "herd-image", transform: HERD,
      sprite: { src: "sprites/deer-herd.webp", layer: "figure", sizeVh: 18,
        swap: [
          { when: { kind: "light", lt: 0.001 }, src: "sprites/deer-eyeshine.webp" },
          { when: all({ kind: "light", lt: 0.3 }, flag(ALERT)), src: "sprites/deer-shadows-alert.webp" },
          { when: { kind: "light", lt: 0.3 }, src: "sprites/deer-shadows.webp" },
        ] },
      visible: all(HERE, not(flag(FLEEING))) },
    { id: "herd", transform: HERD,
      interactable: { verbs: ["inspect", "photograph"], label: "草坡上的鹿群", reveal: 16, cost: { minutes: 3 }, once: true },
      gaze: { radius: 16, dwell: 700 },
      visible: all(HERE, not(flag(FLEEING))) },
    // The eight hundred milliseconds of them actually going. Nothing to click: it is over before a hand could move.
    prop("herd-running", HERD_RUN, "sprites/deer-fleeing.webp", 5.5, { visible: flag(FLEEING) }),
    // The smallest one, once she has stood still long enough for it to risk two steps. sprites/deer-fawn.webp is
    // on disk now (ART, art-5): one calf, head on, a third shorter than the adults, standing on the open grass in
    // front of the herd's front row. The two footfalls still carry the movement; the calf is what they arrive at.
    /* sizeVh is 9.5, not the queue's 5 (ART, art-6). The line the queue writes is 比其他鹿矮三分之一, and that is a
       ratio the two sprites have to satisfy between them: an adult stands 0.59 of deer-herd.webp's own canvas
       height, so at the herd's 18 vh / distance 14 it is 0.59 x 25.2 = 14.9 vh on screen; the calf fills 0.946 of
       its canvas, so at distance 11 it is 1.041 x sizeVh. Two thirds of 14.9 is 9.9 vh, which is sizeVh 9.5.
       At 5 the calf came out 45% of an adult (a toy-sized deer standing NEARER the camera than the herd), and at
       the 7.4 the review asked for it is 52% - that number was read off an adult measured at 80 px, and the same
       animal measures 14.9 vh here. The queue's size column is the thing that has to give; flagged in the report. */
    { id: "fawn", transform: FAWN_AT,
      sprite: { src: "sprites/deer-fawn.webp", layer: "figure", sizeVh: 9.5 },
      gaze: { radius: 12, dwell: 600 },
      visible: all(flag(FAWN), not(flag(BOLTED))) },
    // Keeping to the trees instead of crossing the open grass: six minutes, and she gets to watch them longer.
    // `once`: the walk round only changes the herd the first time, and six minutes that buy nothing new would be
    // a hole in a node whose entire currency is minutes.
    { id: "treeline", transform: TREELINE,
      interactable: { verbs: ["step"], label: "林线下的那排云杉", reveal: 14, cost: { minutes: 6 }, once: true },
      visible: HERE },
    // What is left afterwards, and all there ever is if she made a noise coming down.
    // The prints are the one deer thing that is actually drawn, and she reads them after dark: no night swap, or
    // the only trace in the picture would delete itself at exactly the hour she goes looking for it.
    { id: "hoofprints", transform: HOOF,
      sprite: { src: "sprites/hoofprints.webp", layer: "prop", sizeVh: 8 },
      interactable: { verbs: ["inspect"], label: "小路上的蹄印", reveal: 13, cost: { minutes: 1 }, once: true },
      visible: AFTERWARDS },
    // The press itself is drawn now (ART, art-5): a shallow oval of meadow grass combed flat one way, keyed to
    // the value of the painted grass around it, so the label 「它们站过的那片草」 names a thing that is there.
    { id: "grass-pressed", transform: PRESS,
      sprite: { src: "sprites/grass-pressed.webp", layer: "prop", sizeVh: 4.5 },
      interactable: { verbs: ["inspect"], label: "它们站过的那片草", reveal: 13, cost: { minutes: 1 }, once: true },
      visible: AFTERWARDS },
    // Two candidate marks: the red-white bar on the boulder beside the path, and a rust stain on the red block.
    // Both keep their stone after she settles them and go grey instead of vanishing (v4 §3.5). The bar is 3 vh so
    // it sits inside the painted boulder rather than standing a second stone on top of it.
    blaze("blaze-deer", BOULDER, true, {
      sprite: { src: "sprites/blaze-red-white.webp", layer: "prop", sizeVh: 3 },
      visible: undefined, enabled: not(entityIs("blaze-deer", "read")),
    }),
    blaze("rust-deer", RUST_ROCK, false, { visible: undefined, enabled: not(entityIs("rust-deer", "read")) }),
    // Looking. The scree behind her, the last of the sun, the wall across the valley. A minute each, once each.
    look1("scree-back", SCREE_BACK, "刚下来的碎石坡"),
    look1("sunset-clouds", SUNSET, "天上最后一道橙色", { visible: { kind: "light", gte: 0.001 } }),
    look1("sassolungo", SASSO, "对面的锯齿石墙"),
    // The way on: where the path runs out under the first larches. Never locked (D6).
    goArrow("go", TRAIL_IN, { to: "forestEdge", minutes: TO_FOREST_EDGE, label: "小路钻进树林的地方", kind: "run" }),
  ],
  seed: (w) => {
    w.setFlag(SEEN, true);
    w.setFlag(HOW, "still");
    w.setFlag(BOLTED, true);
    w.setFlag(FLEEING, false);
    w.setFlag(ALERT, false);
    w.setFlag(FAWN, false);
    w.setFlag(WATCH, false);
    w.setFlag(GONE, false);
    w.setFlag(COUNTED, true);
    w.setFlag(CERTAIN, true);
  },
  walkthrough: [
    // The fastest legal way through: settle the mark on the boulder (free, and it saves the five minutes of
    // hunting for the trail under the larches), then walk on. They go up in front of her as she does.
    { type: "interact", entity: "blaze-deer", verb: "inspect" }, { wait: 300 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Stand still twice: heads up, then the smallest one comes two steps closer. Then count them, then walk on.
    still: [
      { type: "wait" }, { wait: 700 },
      { type: "wait" }, { wait: 700 },
      { type: "interact", entity: "herd", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Round them along the tree line: six minutes. They turn and track her instead of bolting, so the small one
    // risks it on the very first stand; the next thing she does is what finally sends them.
    skirt: [
      { type: "interact", entity: "treeline", verb: "step" }, { wait: 800 },
      { type: "wait" }, { wait: 700 },
      { type: "interact", entity: "herd", verb: "inspect" }, { wait: 1800 },
      { type: "interact", entity: "hoofprints", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Everything the meadow foot has: the mark, the wrong mark, the scree behind, the sun, the wall,
    // the count, one photograph, the long stand, the way round, and both traces they leave.
    thorough: [
      { type: "interact", entity: "rust-deer", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "blaze-deer", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "herd", verb: "inspect" }, { wait: 300 },
      { type: "phone:shoot" }, { wait: 400 },
      { type: "wait" }, { wait: 700 },
      { type: "wait" }, { wait: 700 },
      { type: "interact", entity: "treeline", verb: "step" }, { wait: 800 },
      { type: "interact", entity: "scree-back", verb: "inspect" }, { wait: 1800 },
      { type: "interact", entity: "sunset-clouds", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "sassolungo", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "hoofprints", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "grass-pressed", verb: "inspect" }, { wait: 300 },
      { type: "travel", entity: "go" },
    ],
    // Leave without confirming the mark: twelve minutes looking for where the path goes under the trees.
    blind: [{ type: "travel", entity: "go" }],
  },
  script: (ctx) => {
    const w = ctx.world;
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: clamp((target.yaw - here.yaw) * 0.15, -6, 6), pitch: clamp((target.pitch - here.pitch) * 0.15, -4, 4) });
    };
    const shoot = (target: Transform) => { w.dispatch({ type: "phone:shoot" }); glanceAt(target, 0.35); };
    const herdGone = () => ctx.flag(BOLTED, false) || ctx.flag(GONE, false);

    /* Arriving. The sound comes first and it comes from one side (v4 §3.8) — no line, no camera grab.
       If she made a noise somewhere on the way down, the grass is already empty and the prints are all there is
       (§8: 如果在林缘前喊过，鹿已经走了，只剩蹄印). The branch is correct and it is currently unreachable:
       UISystem refuses the `shout` command outside forestEdge / forest1 / forest2, and all three come after this
       node in MAIN_ORDER, so shout.at stays 0 and nothing ever writes scree.shouted or signpost.shouted. §3.8
       and §8 also disagree about which node the shout belongs to. It is left switched on and wired to all three
       flags so that whichever way the author rules, the fork lands here without a rewrite; letting the sand slide
       on the scree stand in for the shout is NOT the answer — the fastest line slides, and the node would lose
       its herd on the main route. (Escalated as an ENGINE + DESIGN request.) */
    ctx.onEnter(() => {
      if (herdGone()) return;
      if (ctx.flag<number>("shout.at", 0) > 0 || ctx.flag("scree.shouted", false) || ctx.flag("signpost.shouted", false)) {
        // She arrives at an empty slope and the prints. That is still having seen them (contract §6/§8: deerSeen).
        ctx.setFlag(GONE, true); ctx.setFlag(SEEN, true); ctx.setFlag(HOW, "gone");
        ctx.sfx("cloth", pan(HERD), 0.3); ctx.kick("settle", 0.2);
        return;
      }
      ctx.sfx("hooves", pan(HERD), 0.35);
    });

    /* Seeing them at all: the herd's own beat, fired by the gaze resting on it (v4 §3.8, A5). */
    ctx.onGaze("herd", () => {
      if (ctx.flag("deer.noticed", false)) return;
      ctx.setFlag("deer.noticed", true); ctx.setFlag(SEEN, true);
      ctx.sfx("hooves", pan(HERD), 0.5); ctx.kick("glance", 0.45, { yaw: 1, pitch: -2 });
      ctx.say("前面有响动。", { tag: "deer-see" });
    });

    /* Counting them: three minutes, and one count. §6 wants three — 完整的一群 → 几个影子 → 两点反光 — and the
       count follows the SPRITE, not the clock: the only herd the frame can draw today is the whole one, so
       「十几只。」 is the only count she can honestly give. The other two arrive with the two dark faces. */
    ctx.onInteract("herd", (verb) => {
      if (verb === "photograph") return shoot(HERD);
      ctx.setFlag(SEEN, true); ctx.setFlag(COUNTED, true);
      ctx.sfx("breath", pan(HERD), 0.5); ctx.kick("glance", 0.3, { yaw: 0, pitch: -1 });
      ctx.say("十几只。", { tag: "deer-count" });
    });

    /* A photograph of them: the day's only picture that is not a rock. The shutter does not frighten them. */
    ctx.on("phone:photo", ({ scene }) => {
      if (scene !== "deer" || herdGone() || ctx.flag(PHOTO, false)) return;
      ctx.setFlag(PHOTO, true); ctx.setFlag(SEEN, true);
      ctx.sfx("hooves", pan(HERD), 0.3); ctx.kick("glance", 0.3, { yaw: 0, pitch: -1 });
    });

    /* Standing still (v4 §7): the pointer unmoved is the whole action. First they lift their heads;
       then the smallest one risks two steps toward her; after that nothing more is given, only the breath. */
    /* Neither beat says out loud what it does, and that is now a choice rather than a lack. Both pictures landed
       with art-5: the fawn is drawn whenever FAWN is set, at any hour, so 「最小的那只往前走了两步。」 is honest
       from here on and is the node author's to put back. 「它们抬起头。」 is not, unqualified: the heads-up face
       (deer-shadows-alert) only replaces the herd once light < 0.3, so before 19:48 that line would still be
       describing a picture that has not moved — it needs the same light gate the swap has. Until someone writes
       them, what the player gets is what the world gives without words: hooves shifting in the grass off to one
       side, the camera settling, then two footfalls coming nearer, one after the other, out of that direction. */
    let stills = 0;
    ctx.onWait(() => {
      if (herdGone()) return;
      stills += 1;
      ctx.setFlag(SEEN, true);
      if (ctx.flag(HOW, "") === "") ctx.setFlag(HOW, "still");
      const alreadyUp = ctx.flag(ALERT, false) || ctx.flag(WATCH, false);
      if (!alreadyUp && !ctx.flag(FAWN, false)) {
        ctx.setFlag(ALERT, true);
        ctx.sfx("hooves", pan(HERD), 0.25); ctx.kick("settle", 0.25);
        ctx.after(300, () => ctx.sfx("cloth", pan(HERD), 0.22));
        return;
      }
      // From the tree line they are already turned toward her, so the smallest one risks it on the first stand.
      if (!ctx.flag(FAWN, false) && (stills >= 2 || ctx.flag(WATCH, false))) {
        ctx.setFlag(FAWN, true);
        ctx.sfx("step", pan(FAWN_AT), 0.35); ctx.after(340, () => ctx.sfx("step", pan(FAWN_AT), 0.3));
        ctx.kick("settle", 0.3);
        return;
      }
      ctx.sfx("breath", 0, 0.3); ctx.kick("settle", 0.15);
    });
    ctx.onGaze("fawn", () => {
      if (ctx.flag("deer.fawnSeen", false)) return;
      ctx.setFlag("deer.fawnSeen", true);
      ctx.sfx("breath", pan(FAWN_AT), 0.3); ctx.kick("settle", 0.2);
    });

    /* The one ending all three ways share: they turn and go back into the far forest.
       With the carvings from the first morning in the notebook, she remembers what else was on that shelf. */
    const bolt = (how: string) => {
      if (herdGone() || ctx.flag(FLEEING, false)) return;
      if (ctx.flag(HOW, "") === "") ctx.setFlag(HOW, how);
      ctx.setFlag(SEEN, true); ctx.setFlag(FLEEING, true);
      ctx.sfx("hooves", pan(HERD), 1.2); ctx.sfx("thud", pan(HERD), 0.5);
      ctx.kick("turn", 0.9, { yaw: 2, pitch: 0 }); ctx.fx("dust", 0.5);
      ctx.after(800, () => {
        ctx.setFlag(FLEEING, false); ctx.setFlag(BOLTED, true);
        ctx.setFlag(ALERT, false); ctx.setFlag(WATCH, false); ctx.setFlag(FAWN, false);
        ctx.sfx("hooves", 0.6, 0.35);
      });
      ctx.say(w.state.journal.entries.includes("E-forest") ? "纪念品上除了鹿，还有熊、狼、野猪。" : "跑回森林里去了。", { tag: "deer-bolt", priority: 1 });
    };

    /* Rounding them under the trees (v4 §7: 绕开 = 多站一会儿). Six minutes buys the only state in the scene where
       they neither graze nor run: they turn where they stand and track her along the tree line, close enough that
       the smallest one will come on the first stand. Nothing on a timer ends it — the next thing she DOES does. */
    ctx.onInteract("treeline", () => {
      if (herdGone()) return;
      ctx.setFlag(SEEN, true); ctx.setFlag(HOW, "skirt");
      ctx.setFlag(ALERT, true); ctx.setFlag(WATCH, true);
      ctx.kick("step", 0.7); ctx.sfx("step", -0.2, 0.6); ctx.fx("dust", 0.2);
      // Her step, then their heads coming round after it: one physical two-beat, well under a second.
      ctx.after(420, () => {
        if (herdGone()) return;
        ctx.sfx("hooves", pan(HERD), 0.3); ctx.kick("turn", 0.35, { yaw: 1, pitch: 0 });
      });
    });

    /* What they leave in the ground. */
    ctx.onInteract("hoofprints", () => {
      ctx.setFlag(SEEN, true); ctx.setFlag("deer.prints", true);
      ctx.hand(HOOF); ctx.kick("glance", 0.45, { yaw: 0, pitch: -5 }); ctx.sfx("step", pan(HOOF), 0.5);
    });
    ctx.onInteract("grass-pressed", () => {
      ctx.setFlag(SEEN, true); ctx.setFlag("deer.press", true);
      ctx.hand(PRESS); ctx.kick("glance", 0.4, { yaw: 0, pitch: -4 }); ctx.sfx("cloth", pan(PRESS), 0.5);
    });

    /* Looking around. Only two of the three are worth a half-line to her. */
    ctx.onInteract("scree-back", (verb) => {
      if (verb === "photograph") return shoot(SCREE_BACK);
      ctx.setFlag("deer.lookedBack", true);
      ctx.kick("turn", 0.7, { yaw: -4, pitch: 2 }); ctx.sfx("exhale", -0.5, 0.6);
      ctx.say("我是从那上面下来的。", { tag: "deer-back" });
    });
    /* The last orange. No line: the transcript's line about the clouds and the last sun leaving belongs to the
       scree, where the transcript puts it and where scree.scene.ts already says it. Here it is breath and light. */
    ctx.onInteract("sunset-clouds", (verb) => {
      if (verb === "photograph") return shoot(SUNSET);
      ctx.setFlag("deer.sawSunset", true);
      ctx.kick("glance", 0.5, { yaw: 2, pitch: 5 }); ctx.sfx("breath", 0.4, 0.5); ctx.fx("gust", 0.25);
    });
    ctx.onInteract("sassolungo", (verb) => {
      if (verb === "photograph") return shoot(SASSO);
      ctx.setFlag("deer.sawWall", true);
      ctx.kick("glance", 0.5, { yaw: 3, pitch: 2 }); ctx.sfx("breath", 0.6, 0.45);
    });

    /* The marks. The system pays for the wrong one (a minute and a tock); this adds the hand and the head. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.45); ctx.sfx("step", pan(BOULDER), 0.5); return; }
      if (entity !== "rust-deer") return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.4, { yaw: 0, pitch: -3 });
    });

    /* 19:30: the wind changes (ClockSystem's mark). If they are still there it puts their heads up for her. */
    ctx.onMark("wind-turns", () => {
      ctx.fx("gust", 0.6); ctx.sfx("cloth", -0.3, 0.5); ctx.kick("turn", 0.4, { yaw: -1, pitch: 0 });
      if (!herdGone()) ctx.setFlag(ALERT, true);
    });
    /* 20:15: the sun goes behind Sassolungo and everything drops three decibels. No words for it. */
    ctx.onMark("sunset", () => { ctx.sfx("exhale", 0, 0.5); ctx.kick("settle", 0.35); });

    /* Walking on. If they are still standing there, walking on is how she startles them — one second, a crash
       of sound, and nothing (v4 §7). Without a confirmed mark the trail into the trees takes twelve minutes to find. */
    /* Once they have turned to track her, the next thing she does with her hands is what breaks it — not a clock.
       Registered last so the action's own line lands first and the crash of hooves comes over the top of it. */
    ctx.on("interact:done", ({ entity }) => {
      if (entity === "treeline" || !ctx.flag(WATCH, false) || herdGone()) return;
      ctx.after(450, () => bolt("skirt"));
    });

    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "deer") return;
      ctx.setFlag(SEEN, true);              // every way out of this node is a way of having seen them (§6, §8)
      const startled = !herdGone();
      if (startled) bolt("through");
      if (to !== "forestEdge" || ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: LOST_MINUTES }, "没认记号，在林子边上找路");
      ctx.kick("turn", 0.5);
      if (!startled) ctx.say("走错了一小段。", { tag: "deer-lost", priority: 1 });
    });
  },
});
