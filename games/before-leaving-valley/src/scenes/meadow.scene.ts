/* Passo Sella meadow, 09:50. Half an hour of path from the pass to the start of the ferrata (SOURCE_TRANSCRIPT, day 1 §3).
   The first blaze lesson on the foreground stones, the white chapel with its bell, the Sella wall at the end of the grass
   and Sassolungo across the road. Two dirt tracks: the obvious one under her feet bends right to the chapel and the road;
   the real way is the faint track climbing the rise at the far-left end of the grass, under the wall.
   Every coordinate below was read off the 150°×84° grid of 01-meadow (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { after, all, before } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import type { World } from "../engine/world";
import { blaze, goArrow, lookAt, wrongWay } from "./_shared";

const BELL_MINUTE = 10 * 60;                                   // the chapel bell strikes the hour
const CLOUD_FROM = 10 * 60, CLOUD_TO = 10 * 60 + 12;           // v4 §8: the cloud shadow crosses the wall 10:00–10:12

// Things painted in 01-meadow, with the pixel they were read from.
const BOULDER: Transform = { yaw: -33, pitch: -28 };                 // the big rounded boulder left of the track (358, 600)
const FLAT_STONE: Transform = { yaw: -16, pitch: -26 };              // the flat stone between the boulder and the track (503, 583)
const FLOWER_STONES: Transform = { yaw: 37, pitch: -33.5 };          // the low stones in the flowers right of the track (956, 647)
const CHAPEL: Transform = { yaw: 23, pitch: -14, distance: 16 };     // the nave of the white chapel (836, 480)
const BELL_TOWER: Transform = { yaw: 21, pitch: -10.5 };             // the belfry window under the spire (819, 450)
const WALL_ROUTE: Transform = { yaw: -15, pitch: 9, distance: 24 };  // the dark cleft up the wall above the scree cone's apex (512, 283)
const SASSOLUNGO: Transform = { yaw: 48, pitch: 6, distance: 40 };   // the main tower of the jagged wall across the road (1050, 309)
const HUT: Transform = { yaw: 46.5, pitch: -14, distance: 18 };      // the wooden house on the road (1037, 480)
const TRACK_BEND: Transform = { yaw: 21, pitch: -22 };               // where the track under her feet bends right toward the chapel (819, 549)
const FAR_TRACK: Transform = { yaw: -66, pitch: -8 };                // the faint pale track up the rise at the far-left end of the grass (77, 429)

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/* The cloud shadow lies on the left half of the wall and drifts right across it as the minutes pass. */
const cloudAt = (w: World): Transform => {
  const t = clamp01((w.state.clock.minuteOfDay - CLOUD_FROM) / (CLOUD_TO - CLOUD_FROM));
  return { yaw: -52 + t * 44, pitch: 10, distance: 14 };
};

export default defineScene({
  id: "meadow",
  day: 1, place: "Passo Sella · 山口草甸", elevation: "约 2,200 m",
  painting: "pano/01-meadow.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.45, windTone: 950, birds: 0.6, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen" },
  arriveAt: 9 * 60 + 50,
  idleLook: true,
  fallback: "半小时山路。墙就在草地尽头。",
  entities: [
    // Three candidate marks on the foreground white stones (v4 §3.5: 2–4 per outdoor node, indistinguishable until close).
    blaze("blaze-meadow", BOULDER, true),
    blaze("lichen-meadow", FLAT_STONE, false),
    blaze("rust-meadow", FLOWER_STONES, false),
    // Things to look at (v4 §6: a minute each). None of them says anything she could read for herself.
    lookAt("chapel", CHAPEL, "白色小教堂", 1),
    lookAt("wall", WALL_ROUTE, "石墙上的路线", 1),
    lookAt("sassolungo", SASSOLUNGO, "对面的锯齿石墙", 1),
    lookAt("hut", HUT, "公路边的木屋", 1),
    // The cloud shadow: a sprite that exists only in its window and moves with the clock; the beat fires when the gaze rests on it.
    { id: "cloud-shadow", transform: cloudAt,
      sprite: { src: "sprites/cloud-shadow.webp", layer: "back", sizeVh: 14, className: "cloud-shadow-sprite" },
      gaze: { radius: 14, dwell: 1200 }, visible: all(after(CLOUD_FROM), before(CLOUD_TO)) },
    // The wrong track: the obvious one, bending right to the chapel and the road. Ten minutes there and back; never a dead end.
    wrongWay("chapel-track", TRACK_BEND, "往右去教堂的土路", 10, "土路到教堂门口就没了。"),
    // The way on: the faint track at the far-left end of the grass, climbing the rise under the wall. Never locked (D6).
    goArrow("go", FAR_TRACK, { to: "approach", minutes: 20, label: "草地尽头的土路", kind: "walk" }),
  ],
  exitWhen: undefined,
  seed: (w) => { w.setFlag("meadow.certain", true); w.patch("journal", { blazesLearned: true }); },
  walkthrough: [
    { type: "interact", entity: "blaze-meadow", verb: "inspect" },
    { wait: 400 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Walk the chapel track first (−10 min → 10:00: the bell strikes and the cloud shadow appears on the wall), then go on.
    wrong: [
      { type: "interact", entity: "chapel-track", verb: "inspect" },
      { wait: 1600 },
      { type: "interact", entity: "blaze-meadow", verb: "inspect" },
      { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Everything the meadow offers: the wall, the chapel (and a photo of it), Sassolungo, the hut, both false marks, the real one.
    thorough: [
      { type: "interact", entity: "wall", verb: "inspect" },
      { type: "interact", entity: "chapel", verb: "photograph" },
      { type: "interact", entity: "sassolungo", verb: "inspect" },
      { type: "interact", entity: "hut", verb: "inspect" },
      { type: "interact", entity: "lichen-meadow", verb: "inspect" },
      { type: "interact", entity: "rust-meadow", verb: "inspect" },
      { type: "interact", entity: "blaze-meadow", verb: "inspect" },
      { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Leave without confirming any mark: eight minutes of looking for the path on the way out.
    blind: [{ type: "travel", entity: "go" }],
  },
  script: (ctx) => {
    const w = ctx.world;
    const glanceAt = (target: Transform, strength = 0.5) => {
      const here = w.rt.gaze;
      ctx.kick("glance", strength, { yaw: Math.max(-6, Math.min(6, (target.yaw - here.yaw) * 0.15)), pitch: Math.max(-4, Math.min(4, (target.pitch - here.pitch) * 0.15)) });
    };
    // A phone shot of what she is looking at: the phone's business (shutter, a minute, 1%); the scene only turns her head.
    const shoot = (target: Transform) => { w.dispatch({ type: "phone:shoot" }); glanceAt(target, 0.35); };
    ctx.on("phone:photo", ({ scene }) => { if (scene === "meadow") ctx.bump("meadow.photos", 1); });

    // Looking. A glance of the camera, a breath, and a minute off the clock; only the wall and Sassolungo get a half-line.
    ctx.onInteract("chapel", (verb) => {
      if (verb === "photograph") return shoot(CHAPEL);
      glanceAt(CHAPEL, 0.6); ctx.sfx("breath", 0.3, 0.4); ctx.setFlag("meadow.chapel", true);
    });
    ctx.onInteract("wall", (verb) => {
      if (verb === "photograph") return shoot(WALL_ROUTE);
      glanceAt(WALL_ROUTE, 0.7); ctx.sfx("breath", -0.2, 0.7); ctx.setFlag("meadow.wall", true);
      ctx.say("墙上有一条线。那就是路。", { tag: "meadow-wall" });
    });
    ctx.onInteract("sassolungo", (verb) => {
      if (verb === "photograph") return shoot(SASSOLUNGO);
      glanceAt(SASSOLUNGO, 0.7); ctx.sfx("exhale", 0.5, 0.6); ctx.setFlag("meadow.sassolungo", true);
      ctx.say("对面那面墙，锯齿一样。", { tag: "meadow-sasso" });
    });
    ctx.onInteract("hut", (verb) => {
      if (verb === "photograph") return shoot(HUT);
      glanceAt(HUT, 0.5); ctx.sfx("breath", 0.6, 0.35); ctx.setFlag("meadow.hut", true);
    });

    // The cloud shadow crossing the wall: only for someone still here between ten and twelve past, and only if she looks at it.
    ctx.onGaze("cloud-shadow", () => {
      if (ctx.flag("meadow.sawCloud", false)) return;
      ctx.setFlag("meadow.sawCloud", true);
      ctx.kick("settle", 0.25); ctx.fx("gust", 0.3);
      ctx.say("云影从墙上走过去。", { tag: "meadow-cloud" });
    });

    // The bell at ten: the clock crossing the hour while she is still on the meadow. Three strikes off to the right, her head
    // turns to them; the line comes on the third strike and gives way to anything she is already saying.
    ctx.on("clock:advance", ({ minutes }) => {
      if (ctx.flag("meadow.bell", false) || w.state.ui.travel) return;
      const now = ctx.minute();
      const then = now - Math.max(0, Math.round(minutes));
      if (then >= BELL_MINUTE || now < BELL_MINUTE) return;
      ctx.setFlag("meadow.bell", true);
      ctx.sfx("clink", 0.55, 0.9); ctx.after(420, () => ctx.sfx("clink", 0.55, 0.8)); ctx.after(840, () => ctx.sfx("clink", 0.55, 0.7));
      glanceAt(BELL_TOWER, 0.8);
      ctx.after(900, () => ctx.say("钟声。十点了。", { tag: "meadow-bell" }));
    });

    // The marks. The real one is settled by the journal (hand, cloth, the first lesson); a false one gets her hand, a glance and a word.
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (entity === "blaze-meadow" && real) { ctx.kick("settle", 0.5); ctx.sfx("step", -0.3, 0.6); return; }
      if (entity !== "lichen-meadow" && entity !== "rust-meadow") return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.5, { yaw: 0, pitch: -3 });
      ctx.say(entity === "lichen-meadow" ? "地衣。不是漆。" : "铁锈。不是漆。", { tag: "meadow-false" });
    });

    // The chapel track: she walks it, it ends at the chapel door, she comes back. Ten minutes and a little dust.
    ctx.onInteract("chapel-track", () => {
      ctx.setFlag("meadow.wrong", true);
      ctx.kick("step", 0.8); ctx.sfx("step", 0.4); ctx.fx("dust", 0.3);
      ctx.after(600, () => { ctx.kick("settle", 0.6); ctx.sfx("step", 0.2); });
      ctx.say("土路到教堂门口就没了。", { tag: "meadow-wrong" });
    });

    // Standing still: the third breath brings a gust through the grass, once.
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 3 && !ctx.flag("meadow.gust", false)) { ctx.setFlag("meadow.gust", true); ctx.fx("gust", 0.4); ctx.kick("settle", 0.2); }
    });

    // Leaving without the mark costs eight minutes of looking for the path (v4 §3.5, meadow). The exit is never locked.
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "meadow" || to !== "approach" || ctx.flag("meadow.certain", false)) return;
      ctx.spend({ minutes: 8 }, "没认记号，找了一段路");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "meadow-lost", priority: 1 });
    });
  },
});
