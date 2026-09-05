/* The forest path above the hairpin, the next morning (SOURCE_TRANSCRIPT, day 2 §13): she walked back up into the
   circle Find My had stopped in and turned over everything inside it — under the big boulder, the dwarf pines, the
   heap of loose stones beside the path. Nothing is here, and nothing in this scene points anywhere (v4 §12 B6):
   the only things she finds are her own — a thread off her red jacket, a stone she remembers holding.
   The way back down is on the painting from the first minute and no gate stands in front of it (v4 §8, day two has
   no completion threshold at all); the two other footholds (the wall, the upper path) hang off this one.
   Every coordinate was read off the 150°×84° grid of 18-search (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (1280×720) is noted beside it. */
import { any, entityIs } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { EntityId, SfxName, Transform } from "../engine/types";
import { goArrow, prop } from "./_shared";

/** The three places she turns over here. Ids and labels are the ones in data/descent.ts SEARCH_SPOTS, scene "search";
 *  the coordinates below are read off the repainted 18-search, and the third spot is the heap of loose stones the
 *  painting actually has beside the path (there is no ditch on this canvas). Twelve minutes each (v4 §6). */
type Spot = { id: EntityId; label: string; line: string; sfx: SfxName; pan: number; fx: "dust" | "gust"; transform: Transform };
const SPOTS: Spot[] = [
  // The big grey boulder left of the path, in its own shadow (443, 523).
  { id: "under-boulder", label: "巨石下面", line: "巨石下面只有碎石和露水。", sfx: "thud", pan: -0.35, fx: "dust", transform: { yaw: -23, pitch: -19 } },
  // The creeping pine spread over the near rocks, dew all over it (529, 591).
  { id: "dwarf-pines", label: "矮松丛", line: "矮松丛翻了一遍。没有。", sfx: "cloth", pan: -0.15, fx: "gust", transform: { yaw: -13, pitch: -27 } },
  // The heap of round loose stones on the bank above the sand (777, 471).
  { id: "path-stones", label: "路边的碎石堆", line: "石头一块一块搬开。湿沙。", sfx: "slide", pan: 0.3, fx: "dust", transform: { yaw: 16, pitch: -13 } },
];

const THREAD: Transform = { yaw: -8, pitch: -19 };             // a sprig higher up the same creeping pine (572, 523)
const MOVED_STONE: Transform = { yaw: 19.5, pitch: -17 };      // the bare ground right of the heap (806, 506)
const PACK_DOWN: Transform = { yaw: 13, pitch: -33 };          // clear sand below the standing stone, clear of it (751, 643)
const STANDING_STONE: Transform = { yaw: 21, pitch: -26 };     // the upright stone in the middle of the sand (819, 583)
const SASSOLUNGO: Transform = { yaw: 6, pitch: 19, distance: 30 };  // the jagged wall across the valley (691, 205)
const WALL_FOOT: Transform = { yaw: 13, pitch: 5 };            // the dark green scrub belt under the wall (751, 318)
const UPPER_PATH: Transform = { yaw: 39, pitch: -9.5 };        // the sand running on up between the rocks (973, 441)
const DOWN_PATH: Transform = { yaw: 8, pitch: -27 };           // the sand at her feet, going out of the picture (708, 591)

const searched = (id: EntityId) => entityIs(id, "used");

export default defineScene({
  id: "search",
  day: 2, place: "森林小路 · 第二天", elevation: "1,820 m",
  painting: "pano/18-search.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.35, windTone: 900, birds: 0.6, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen" },
  arriveAt: 8 * 60 + 40,
  chapter: { eyebrow: "第二天", title: "重返森林小路" },
  idleLook: true,
  fallback: "昨晚我从这里过。",
  // Day two has no gate: every exit, the way home included, is open from the first minute (v4 §8).
  exitWhen: undefined,
  entities: [
    /* The three places. Once each: a second click still reaches the engine (no `enabled` guard, so the hotspot is
       never a dead button) and comes back as interact:refused — her hand goes out to it and comes back. */
    ...SPOTS.map((spot): EntityDef => ({
      id: spot.id, transform: spot.transform, className: "search-hotspot",
      interactable: { verbs: ["inspect"], label: spot.label, reveal: 13, cost: { minutes: 12 }, once: true },
    })),
    // What the dwarf pines give up: a thread off her own jacket, on a sprig. It stays where it is.
    { id: "red-thread", transform: THREAD, sprite: { src: "sprites/red-thread.webp", layer: "prop", sizeVh: 6 },
      interactable: { verbs: ["inspect"], label: "松枝上的红线头", reveal: 12, cost: { minutes: 1 }, once: true },
      visible: searched("dwarf-pines") },
    // One stone lifted out of the heap and left lying beside it, with the damp print it came off.
    prop("moved-stone", MOVED_STONE, "sprites/stone-turned.webp", 5, { visible: searched("path-stones") }),
    /* The pack comes off her back the first time she kneels down, and stays on the sand. 14vh is the height the
       same pack has in the other two outdoor stands (searchWall, searchPath): one bag, one size on the ground. */
    prop("pack-down", PACK_DOWN, "sprites/backpack-floor.webp", 14, { visible: any(...SPOTS.map((spot) => searched(spot.id))) }),
    // The stone standing in the sand: nothing under it, but her hand knows it (v4 §7: 她记得抓过的那块石头).
    { id: "standing-stone", transform: STANDING_STONE, className: "search-hotspot",
      interactable: { verbs: ["inspect"], label: "沙地上立着的石头", reveal: 12, cost: { minutes: 2 }, once: true } },
    /* The wall across the valley, in the morning sun this time. Looking is a minute; it gives nothing, and it is
       one minute only: a second click comes back as interact:refused, the hand out and back, no second sentence. */
    { id: "sassolungo", transform: SASSOLUNGO,
      interactable: { verbs: ["inspect"], label: "对面的锯齿石墙", reveal: 12, cost: { minutes: 1 }, once: true },
      gaze: { radius: 12, dwell: 900 } },
    // The other two footholds inside the circle, and the way home. All three from the first minute.
    goArrow("go-wall", WALL_FOOT, { to: "searchWall", minutes: 12, label: "墙脚下的灌木带", kind: "walk" }),
    goArrow("go-path", UPPER_PATH, { to: "searchPath", minutes: 10, label: "小路上段", kind: "walk" }),
    goArrow("go-hotel", DOWN_PATH, { to: "hotel", minutes: 25, label: "顺小路回酒店", kind: "walk" }),
  ],
  seed: (w) => {
    // What the second day leaves behind: the circle read, this stand turned over, and one red thread of her own.
    w.setFlag("search.findmy", true);
    w.setFlag("search.spots", SPOTS.map((spot) => spot.id).join(","));
    // Consumed by hotel.scene.ts (the jacket over the chairback knows where the thread came off).
    w.setFlag("search.thread", true);
    // The first day's objective was answered by the road that night; the map carries nothing into day two.
    w.patch("journal", { objective: null, entries: Array.from(new Set([...w.state.journal.entries, "E-findmy"])) });
    /* A hotel bed stands between the forest and this path: the second day is walked on legs that have slept
       (v4 §1.3, §3.2 — day two lifts the resource pressure). Nobody upstream of here zeroes them, so this does. */
    w.patch("body", { fatigue: 0, fear: 0, breath: "calm" });
  },
  walkthrough: [
    { type: "overlay:close" },
    { wait: 300 },
    { type: "travel", entity: "go-hotel" },
  ],
  variants: {
    // Everything this stand has: all three places, the thread, the stone she held, the wall.
    thorough: [
      { type: "overlay:close" },
      { type: "interact", entity: "under-boulder", verb: "inspect" },
      { wait: 300 },
      { type: "interact", entity: "dwarf-pines", verb: "inspect" },
      { wait: 300 },
      { type: "interact", entity: "red-thread", verb: "inspect" },
      { type: "interact", entity: "path-stones", verb: "inspect" },
      { wait: 300 },
      { type: "interact", entity: "standing-stone", verb: "inspect" },
      { type: "interact", entity: "sassolungo", verb: "inspect" },
      { wait: 400 },
      { type: "travel", entity: "go-hotel" },
    ],
    // Off to the foot of the wall (the fourth kind of place in the account), then on from there.
    wall: [
      { type: "overlay:close" },
      { type: "interact", entity: "under-boulder", verb: "inspect" },
      { wait: 300 },
      { type: "travel", entity: "go-wall" },
    ],
    // Straight up to the stretch she crawled down last night.
    path: [
      { type: "overlay:close" },
      { type: "travel", entity: "go-path" },
    ],
    // Standing in the circle and going home without touching anything: allowed, and it costs nothing.
    give_up: [
      { type: "overlay:close" },
      { type: "travel", entity: "go-hotel" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;
    const doneHere = () => SPOTS.filter((spot) => Number(w.entity(spot.id).state.used ?? 0) > 0).length;
    const spotList = () => String(ctx.flag("search.spots", "")).split(",").filter(Boolean);
    const addSpot = (id: EntityId) => {
      const list = spotList();
      if (list.includes(id)) return;
      ctx.setFlag("search.spots", [...list, id].join(","));
    };

    /* A place she has already been through. The engine refuses it (once), and the refusal is answered the same way
       an impossible reach is: the hand goes out to it and comes back, one dry knock, no text. */
    ctx.on("interact:refused", ({ entity, reason }) => {
      if (reason !== "gone") return;
      const def = ctx.scene.entities.find((one) => one.id === entity);
      if (!def?.interactable?.once) return;
      const where = ctx.transformOf(entity);
      ctx.hand(where, "grip");
      ctx.kick("glance", 0.3, { yaw: 0, pitch: -4 });
      ctx.sfx("tock", Math.max(-1, Math.min(1, where.yaw / 60)), 0.3);
    });

    /* The night in Canazei happened between `car` and this path: she slept, ate, and walked back up in the morning.
       Nothing upstream resets the body, so the second day does it here — and searchWall / searchPath, which are
       only reachable through this stand, inherit the rested legs (v4 §1.3 第 5 条, §3.2). */
    ctx.onEnter(() => {
      w.patch("body", { fatigue: 0, fear: 0, breath: "calm" });
      // The first day's objective (656 · Plan de Roces) was answered by the road two nights ago.
      if (w.state.journal.objective) w.patch("journal", { objective: null });
    });

    // The screen she has been staring at since breakfast: a circle, not a point (v4 §8, entrance overlay).
    ctx.onEnter((from) => {
      if (from === "searchWall" || from === "searchPath") return;
      if (ctx.flag("search.findmy", false)) return;
      ctx.setFlag("search.findmy", true);
      ctx.learn("E-findmy");
      ctx.open("findmy");
    });

    // Turning a place over: she goes down on one knee, the ground answers, and then she says what is not there.
    for (const spot of SPOTS) {
      ctx.onInteract(spot.id, () => {
        addSpot(spot.id);
        ctx.hand(spot.transform, "grip");
        ctx.kick("glance", 0.6, { yaw: 0, pitch: -7 });
        ctx.sfx(spot.sfx, spot.pan, 0.6);
        ctx.fx(spot.fx, 0.22);
        w.emit("body:rest", { seconds: 2.4 });
        ctx.after(420, () => ctx.sfx(spot.id === "dwarf-pines" ? "cloth" : "slide", spot.pan, 0.3));
        ctx.say(spot.line, { tag: `search-${spot.id}` });
        // All three done: she stands up out of it. No line — just her back and her breath.
        if (doneHere() >= SPOTS.length) ctx.after(760, () => { ctx.kick("settle", 0.6); ctx.sfx("exhale", 0, 0.7); });
      });
    }

    // The thread. Hers, and it proves only that she came through here; she leaves it on the branch.
    ctx.onInteract("red-thread", () => {
      ctx.setFlag("search.thread", true);
      ctx.hand(THREAD, "grip");
      ctx.kick("glance", 0.45, { yaw: 0, pitch: -2 });
      ctx.sfx("cloth", -0.1, 0.5);
      ctx.after(520, () => ctx.sfx("breath", -0.1, 0.4));
      ctx.say("是我冲锋衣的线头。", { tag: "search-thread", priority: 1 });
    });

    // The stone in the sand: she takes hold of it the way she took hold of it last night, and lets go.
    ctx.onInteract("standing-stone", () => {
      ctx.setFlag("search.stone", true);
      ctx.hand(STANDING_STONE, "grip", true);
      ctx.kick("pull", 0.5);
      ctx.sfx("grip", 0.25, 0.6);
      ctx.after(560, () => { ctx.kick("settle", 0.3); ctx.sfx("tock", 0.25, 0.3); });
      ctx.say("这块石头，我昨晚抓过。", { tag: "search-stone" });
    });

    // The wall across the valley. A minute, a breath, and nothing else.
    ctx.onInteract("sassolungo", () => {
      ctx.setFlag("search.looked", true);
      ctx.kick("glance", 0.7, { yaw: 0, pitch: 4 });
      ctx.sfx("exhale", 0.2, 0.6);
      ctx.say("昨天，我在它对面。", { tag: "search-wall" });
    });
    ctx.onGaze("sassolungo", () => {
      if (ctx.flag("search.sawWall", false)) return;
      ctx.setFlag("search.sawWall", true);
      ctx.sfx("breath", 0.2, 0.45);
      ctx.kick("settle", 0.2);
    });

    // Standing still. A drop comes off a branch on the right, then her breath, then her hand goes to the pocket again.
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 1) { ctx.sfx("tick", 0.55, 0.35); ctx.kick("glance", 0.3, { yaw: 2, pitch: -3 }); return; }
      if (stills === 2) { ctx.sfx("breath", -0.3, 0.45); ctx.kick("settle", 0.2); return; }
      if (stills === 3 && !ctx.flag("search.pocket", false)) {
        ctx.setFlag("search.pocket", true);
        ctx.sfx("cloth", 0, 0.5);
        ctx.kick("glance", 0.4, { yaw: 0, pitch: -8 });
        ctx.say("手一直在往口袋上摸。", { tag: "search-pocket" });
      }
    });

    // Going home. Nothing had to be done to earn this, and what she says on the way out is made of what she turned over.
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "search" || to !== "hotel") return;
      const turned = spotList().length;
      const line = ctx.flag("search.thread", false) ? "山里只剩下我自己的痕迹。"
        : turned >= 4 ? "能翻的地方，我都翻过了。"
          : turned > 0 ? "翻过的地方，都没有。"
            : "先回去。";
      ctx.kick("turn", 0.5);
      ctx.sfx("step", 0, 0.5);
      ctx.say(line, { tag: "search-leave", priority: 1 });
    });
  },
});
