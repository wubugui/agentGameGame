/* The foot of the Sassolungo wall, day two, mid-morning (SOURCE_TRANSCRIPT day 2 §13): the fourth kind of place
   inside the circle Find My drew — 巨石、矮松、灌木、Sassolungo 石墙下. Here she turns over the dewy scrub belt
   under the wall, the heap of loose stones beside it, and the one fallen log lying on the grass shelf.
   Nothing is here, and nothing here points anywhere (v4 §12 B6): the wall is only a wall, the gap under the
   slab is empty and cold, and the scree spilling out from under it is this mountain's own — she came down
   Val Lasties yesterday, on the far side of the valley, so nothing on this slope is a track of hers.
   Day two has no gate at all (v4 §8): both ways out — back down to the path, and straight home — are on the
   painting from the first minute and nothing has to be done to earn them.
   Every coordinate was read off the 150°×84° grid of 18b-searchwall (yaw = (x/W − .5)·150,
   pitch = (.5 − y/H)·84); the pixel it came from (1280×720) is noted beside it. */
import { entityIs, flag, not } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { EntityId, ItemId, SfxName, Transform } from "../engine/types";
import { backArrow, goArrow, prop } from "./_shared";

/** What she is still wearing on the second morning (the same three `search` leaves her in). */
const DAY_TWO_WORN: ItemId[] = ["backpack", "cap", "redJacket"];

const TURNED = "searchWall.turned";      // how many of this stand's three places she has been through
const LOG_DONE = "searchWall.log";       // the log is a hold, and holds never write entity.used

/* The two places on this canvas she can go down on one knee and turn over. Ids and labels follow
   data/descent.ts SEARCH_SPOTS (scene "searchWall"); the coordinates are read off the repainted canvas.
   Twelve minutes each (v4 §6). The third place, the fallen log, is a sprite and is held, not clicked. */
type Spot = { id: EntityId; label: string; line: string; sfx: SfxName; pan: number; fx: "dust" | "gust"; transform: Transform };
const SPOTS: Spot[] = [
  // The dew-covered scrub belt running along under the wall, right of the boulders (1015, 514).
  { id: "wall-bushes", label: "墙脚下的灌木", line: "灌木翻了一遍。没有。", sfx: "cloth", pan: 0.45, fx: "gust", transform: { yaw: 44, pitch: -18 } },
  // The heap of rounded loose stones spilling off the big boulders, mid-field (802, 501).
  { id: "wall-rocks", label: "乱石堆", line: "石头一块一块搬开了。", sfx: "slide", pan: 0.15, fx: "dust", transform: { yaw: 19, pitch: -16.5 } },
];

const LOG: Transform = { yaw: -25, pitch: -21, distance: 13 };        // the grass shelf above the mossy rocks, left of centre (426, 540)
const CRACK: Transform = { yaw: 61, pitch: -5 };                      // the dark gap under the overhanging slab, top right (1160, 403)
const DEW_MOSS: Transform = { yaw: -5, pitch: -31, distance: 9 };     // the near mossy boulder with the big drops on it (597, 626)
const SCREE_FAN: Transform = { yaw: -28, pitch: -7, distance: 25 };   // the scree this wall pours out of its own gullies (401, 420)
const WALL: Transform = { yaw: 12, pitch: 25, distance: 30 };         // the jagged summit of the wall above her (742, 146)
const MOVED_STONE: Transform = { yaw: 24, pitch: -20, distance: 11 }; // the grass just below the heap (845, 531)
/* The pack has to be inside the resting frame: at pitch −33 the whole bag sat under the bottom edge. Measured in
   the running view, this puts it on row ≈653 on the grass in front of her, clear of the way back down the sand
   on its right (that node runs 759–825) and of the log and the way home on its left. */
const PACK_DOWN: Transform = { yaw: 4, pitch: -24.5 };                // the grass this side of the sandy line (674, 570)
/* Both ways out are read off the painting AND measured in the running 1280×720 view: a perspective camera puts a
   point at (yaw, pitch) on screen row 360·(1 − tan(pitch)/(cos(yaw)·tan 30°)), so the further off centre a thing
   is, the lower it lands. Everything below −25° at these yaws falls out under the bottom edge, arrow and all. */
const DOWN_PATH: Transform = { yaw: 13.7, pitch: -22.9 };             // the sand of the trail, going back down the way she came (757, 556)
/* The way home walks off down the green. At {−37, −19.3} it stood on the pale scree fan instead — the whole row
   there is dry grass and stone (R≈G, 179/176/137) and the solid green only starts fifteen pixels down and right
   (358, 555) = 73/82/66 — so the arrow that says 顺草坡 was standing on the scree it is walking away from. */
const HOME_SLOPE: Transform = { yaw: -33, pitch: -22.8 };             // the green slope falling away to the left (358, 555)

const TO_SEARCH = 12;      // the twelve minutes search charges to walk over here, paid again going back
const TO_HOTEL = 35;       // those twelve plus the twenty-five from the path down to the village

export default defineScene({
  id: "searchWall",
  day: 2, place: "Sassolungo 石墙下 · 第二天", elevation: "1,860 m",
  painting: "pano/18b-searchwall.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.4, windTone: 1000, birds: 0.25, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "pollen", clouds: true },
  arriveAt: 9 * 60 + 30,
  idleLook: true,
  fallback: "露水还没干。",
  // Day two has no completion threshold (v4 §8): nothing gates either way out.
  exitWhen: undefined,
  entities: [
    /* The two places she kneels down at. Once each: a second click still reaches the engine (no `enabled` guard,
       so the hotspot is never a dead button) and comes back as interact:refused — her hand goes out and comes back. */
    ...SPOTS.map((spot): EntityDef => ({
      id: spot.id, transform: spot.transform, className: "search-hotspot",
      interactable: { verbs: ["inspect"], label: spot.label, reveal: 13, cost: { minutes: 12 }, once: true },
    })),
    /* The fallen log: wet, heavier than it looks, and it takes both hands to bring it over. Two entities for the
       two states of one log, the way hotel does laptop / laptop-shut. It has to be two: view/Hotspot.tsx sends a
       `hold` node straight to hold:start, and InteractionSystem's hold:start branch answers an unmet `requires`
       with a bare tock — no hand, no kick — so a single hold entity could never come back the way the other five
       once-hotspots do. Once it is over, the log is an `inspect` with `once`, and the second press goes down the
       scene's own interact:refused path: the hand out to it and back, one dry knock, no text. */
    { id: "wall-log", transform: LOG,
      sprite: { src: "sprites/fallen-log.webp", layer: "prop", sizeVh: 7 },
      hold: { ms: 1100, scaleWith: ["fatigue"] },
      interactable: { verbs: ["hold"], label: "草里那段倒木", reveal: 13, cost: { minutes: 12 } },
      visible: not(flag(LOG_DONE)) },
    { id: "wall-log-rolled", transform: LOG, className: "search-hotspot",
      sprite: { src: "sprites/fallen-log-rolled.webp", layer: "prop", sizeVh: 7 },
      interactable: { verbs: ["inspect"], label: "草里那段倒木", reveal: 13, cost: { minutes: 0 }, once: true },
      visible: flag(LOG_DONE) },
    // The gap under the slab: the one place on this slope something could actually have slid into. It has not.
    { id: "wall-crack", transform: CRACK, className: "search-hotspot",
      interactable: { verbs: ["inspect"], label: "石板底下的缝", reveal: 12, cost: { minutes: 4 }, once: true } },
    // The moss on the near boulder, still holding the whole night's dew.
    { id: "dew-moss", transform: DEW_MOSS,
      interactable: { verbs: ["inspect"], label: "石头上的露水", reveal: 12, cost: { minutes: 1 }, once: true } },
    // The scree this wall spills out of its gullies, running down past her into the grass.
    { id: "scree-fan", transform: SCREE_FAN,
      interactable: { verbs: ["inspect"], label: "墙脚下淌下来的碎石坡", reveal: 12, cost: { minutes: 1 }, once: true },
      gaze: { radius: 12, dwell: 900 } },
    /* The wall itself, straight up out of the grass she is standing on. GazeSystem reads `interactable.reveal`
       first and only falls back to `gaze.radius`, so the two have to carry the same number. */
    { id: "wall-above", transform: WALL,
      interactable: { verbs: ["inspect"], label: "上方那面锯齿石墙", reveal: 14, cost: { minutes: 1 }, once: true },
      gaze: { radius: 14, dwell: 900 } },
    // One stone lifted out of the heap and left lying beside it.
    prop("moved-stone", MOVED_STONE, "sprites/stone-turned.webp", 4, { visible: entityIs("wall-rocks", "used") }),
    // The pack comes off her back the first time she kneels, and stays on the grass.
    // 12vh: the same bag at the same size as the other two outdoor stands (a 0.45 m pack about three metres off).
    prop("pack-down", PACK_DOWN, "sprites/backpack-floor.webp", 12, { visible: flag(TURNED, { gte: 1 }) }),
    // Both ways out, on the painting from the first minute.
    backArrow("back", DOWN_PATH, "search", "沿沙路走回去", TO_SEARCH),
    goArrow("go-hotel", HOME_SLOPE, { to: "hotel", minutes: TO_HOTEL, label: "顺草坡回酒店", kind: "walk" }),
  ],
  seed: (w) => {
    // What this stand leaves behind: three more of the eight places turned over, and nothing found.
    const list = String(w.flag("search.spots", "")).split(",").filter(Boolean);
    for (const id of ["wall-bushes", "wall-rocks", "wall-log"]) if (!list.includes(id)) list.push(id);
    w.setFlag("search.spots", list.join(","));
    w.setFlag(TURNED, 3);
    w.setFlag(LOG_DONE, true);
  },
  walkthrough: [
    { type: "travel", entity: "back" },
  ],
  variants: {
    // Everything this stand has: all three places, the gap under the slab, the moss, the scree, the wall.
    thorough: [
      { type: "interact", entity: "wall-bushes", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "wall-rocks", verb: "inspect" }, { wait: 300 },
      { type: "hold:start", entity: "wall-log" }, { wait: 3100 }, { type: "hold:end" }, { wait: 500 },
      { type: "interact", entity: "wall-crack", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "dew-moss", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "scree-fan", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "wall-above", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "back" },
    ],
    // Turn the scrub over, then give the day up and walk home from here.
    home: [
      { type: "interact", entity: "wall-bushes", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go-hotel" },
    ],
    // Standing under the wall doing nothing: the drop off a leaf, the gust, her hand on the pocket.
    still: [
      { type: "wait" }, { wait: 200 }, { type: "wait" }, { wait: 200 },
      { type: "wait" }, { wait: 200 }, { type: "wait" }, { wait: 600 },
      { type: "travel", entity: "back" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;

    /* The second day is walked on legs that slept and with nothing written on the map: `search` does both when
       she comes back up the path, and this stand only hangs off that one — but ?node=searchWall skips `search`'s
       seed (engine/dev.ts SIDE_PARENT), so a warped save has to arrive the same way a played one does. */
    ctx.onEnter(() => {
      if (w.state.journal.objective) w.patch("journal", { objective: null });
      if (w.state.body.fatigue > 0 || w.state.body.fear > 0) w.patch("body", { fatigue: 0, fear: 0, breath: "calm" });
      /* Same reason, same fix as `search`: the ferrata kit came off in the hotel room last night and the light
         went back in the pack, so a warped save must not stand here in a helmet and a lanyard. */
      const worn = w.state.inventory.worn.filter((item) => DAY_TWO_WORN.includes(item));
      const hands = w.state.inventory.hands.filter((item) => item !== "fillLight");
      if (worn.length !== w.state.inventory.worn.length || hands.length !== w.state.inventory.hands.length) {
        w.patch("inventory", { worn, hands });
      }
      if (w.state.power.lampMode) w.patch("power", { lampMode: null });
    });

    const spotList = () => String(ctx.flag("search.spots", "")).split(",").filter(Boolean);
    const addSpot = (id: EntityId) => {
      const list = spotList();
      if (list.includes(id)) return;
      ctx.setFlag("search.spots", [...list, id].join(","));
    };
    const turned = () => Number(ctx.flag(TURNED, 0));
    // Out of the third one she straightens up. No line — her back and her breath.
    const standUp = () => { if (turned() < 3) return; ctx.after(780, () => { ctx.kick("settle", 0.6); ctx.sfx("exhale", 0, 0.7); }); };

    /* A place she has already been through. The engine refuses it (once), and the refusal is answered the way an
       impossible reach is: her hand goes out to it and comes back, one dry knock, no text. */
    ctx.on("interact:refused", ({ entity, reason }) => {
      if (reason !== "gone") return;
      const def = ctx.scene.entities.find((one) => one.id === entity);
      if (!def?.interactable?.once) return;
      const where = ctx.transformOf(entity);
      ctx.hand(where, "grip");
      ctx.kick("glance", 0.3, { yaw: 0, pitch: -4 });
      ctx.sfx("tock", Math.max(-1, Math.min(1, where.yaw / 60)), 0.3);
    });

    // Turning a place over: down on one knee, the ground answers, and then she says what is not in it.
    for (const spot of SPOTS) {
      ctx.onInteract(spot.id, () => {
        addSpot(spot.id);
        ctx.bump(TURNED, 1);
        ctx.hand(spot.transform, "grip");
        ctx.kick("glance", 0.6, { yaw: 0, pitch: -6 });
        ctx.sfx(spot.sfx, spot.pan, 0.6);
        ctx.fx(spot.fx, 0.2);
        w.emit("body:rest", { seconds: 2.4 });
        ctx.after(430, () => ctx.sfx(spot.id === "wall-bushes" ? "cloth" : "slide", spot.pan, 0.3));
        ctx.say(spot.line, { tag: `wall-${spot.id}` });
        standUp();
      });
    }

    // The log. Both hands under the wet side, and it comes over onto its back.
    ctx.onHold("wall-log", () => {
      ctx.setFlag(LOG_DONE, true);
      addSpot("wall-log");
      ctx.bump(TURNED, 1);
      ctx.kick("pull", 0.8);
      ctx.sfx("thud", -0.3, 0.7);
      ctx.fx("dust", 0.25);
      w.emit("body:rest", { seconds: 2 });
      ctx.after(400, () => { ctx.kick("settle", 0.35); ctx.sfx("cloth", -0.3, 0.4); });
      ctx.say("倒木底下是一窝露水。", { tag: "wall-log" });
      standUp();
    });
    // Let go halfway and it settles back into its own hollow.
    ctx.onRelease("wall-log", () => { ctx.kick("slip", 0.4); ctx.sfx("slide", -0.3, 0.45); });
    /* The log on its back. A hand on the wet underside once more, and nothing under it the second time either. */
    ctx.onInteract("wall-log-rolled", () => {
      ctx.hand(LOG, "grip");
      ctx.kick("glance", 0.35, { yaw: 0, pitch: -5 });
      ctx.sfx("cloth", -0.3, 0.4);
      ctx.after(440, () => ctx.sfx("breath", -0.3, 0.35));
    });

    // The gap under the slab: an arm in to the shoulder, and it comes back cold.
    ctx.onInteract("wall-crack", () => {
      ctx.hand(CRACK, "grip", true);
      ctx.kick("glance", 0.5, { yaw: 5, pitch: -3 });
      ctx.sfx("grip", 0.6, 0.5);
      ctx.after(580, () => { ctx.kick("settle", 0.3); ctx.sfx("cloth", 0.6, 0.4); });
      ctx.say("缝里是空的。手是凉的。", { tag: "wall-crack" });
    });

    // The moss: her palm flat on it. It comes back wet, and she says nothing at all.
    ctx.onInteract("dew-moss", () => {
      ctx.hand(DEW_MOSS, "grip");
      ctx.kick("glance", 0.4, { yaw: 0, pitch: -8 });
      ctx.sfx("cloth", -0.1, 0.5);
      ctx.after(470, () => ctx.sfx("breath", -0.1, 0.4));
    });

    /* The scree running out from under the wall. A minute of looking, a breath, and not one word: she came down
       Val Lasties yesterday, not this fan, and the account gives this slope no sentence at all. */
    ctx.onInteract("scree-fan", () => {
      ctx.setFlag("searchWall.looked", true);
      ctx.kick("glance", 0.7, { yaw: -6, pitch: 3 });
      ctx.sfx("exhale", -0.3, 0.6);
      ctx.fx("dust", 0.14);
    });
    ctx.onGaze("scree-fan", () => {
      if (ctx.flag("searchWall.sawFan", false)) return;
      ctx.setFlag("searchWall.sawFan", true);
      ctx.sfx("breath", -0.3, 0.45);
      ctx.kick("settle", 0.2);
    });

    /* The wall straight up out of the grass. Her head goes back and her breath goes out; the one sentence this
       mountain gets today is said over in `search`, and it is not said twice. */
    ctx.onGaze("wall-above", () => {
      if (ctx.flag("searchWall.sawWall", false)) return;
      ctx.setFlag("searchWall.sawWall", true);
      ctx.kick("settle", 0.3);
      ctx.sfx("breath", 0.2, 0.45);
    });
    ctx.onInteract("wall-above", () => {
      ctx.kick("glance", 0.8, { yaw: 0, pitch: 9 });
      ctx.sfx("exhale", 0.2, 0.6);
      ctx.fx("gust", 0.18);
    });

    // Standing still under the wall: a drop off a leaf, a gust across the scrub, her hand on the pocket again.
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (stills === 1) { ctx.sfx("tick", 0.5, 0.3); ctx.kick("glance", 0.3, { yaw: 4, pitch: -4 }); return; }
      if (stills === 2) { ctx.fx("gust", 0.22); ctx.sfx("cloth", -0.4, 0.4); return; }
      if (stills >= 3 && !ctx.flag("searchWall.pocket", false)) {
        ctx.setFlag("searchWall.pocket", true);
        ctx.sfx("cloth", 0, 0.5);
        ctx.kick("glance", 0.4, { yaw: 0, pitch: -9 });
      }
    });

    // Leaving. Nothing had to be done to earn either way out, and what she says is made of what she turned over.
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "searchWall") return;
      const count = spotList().length;
      const line = to === "hotel"
        ? (count >= 6 ? "能翻的地方，我都翻过了。" : count > 0 ? "翻过的地方，都没有。" : "先回去。")
        : (turned() >= 3 ? "墙脚下也翻完了。" : "再回小路上看看。");
      ctx.kick("turn", 0.5);
      ctx.sfx("step", 0, 0.5);
      ctx.say(line, { tag: "wall-leave", priority: 1 });
    });
  },
});
