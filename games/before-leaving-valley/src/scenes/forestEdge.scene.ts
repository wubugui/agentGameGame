/* The forest edge, 20:15 — the sun goes behind Sassolungo exactly here (SOURCE_TRANSCRIPT day 1 §10–11).
   The deer are behind her; in front of her the grass runs out between two white boulders and one thin trail
   goes into the spruce. Here she calls 112 and gets nothing through, and here she digs the video light out of
   the pack. Nothing else in this scene is required: the 656 blaze on the trunk, the map, the last light on the
   wall, the zip, the rest of the chocolate and the shout are all hers to spend minutes on or walk past.
   Every coordinate was read off the 150°×84° grid of 13-forest-edge (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84);
   the pixel it came from (2048×1152) is noted beside it. */
import type { Condition } from "../engine/condition";
import { all, before, entityIs, flag, has, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { blaze, goArrow, lookAt, prop, wrongWay } from "./_shared";

const CALL_DONE = "forestEdge.callDone";
const CALL_TRIES = "forestEdge.callTries";
const CALL_TRIED = "forestEdge.callTried";      // the ids already said into the phone, comma-joined (CallSheet reads it back)
const CALLING = "forestEdge.calling";           // the number has been dialled once; the minute for it is spent once, not per re-open
const LAMP_OUT = "forestEdge.lampOut";          // her hand has found the lamp once; the beat belongs to that, not to a button
const ZIPPED = "forestEdge.zipped";
const COLD = "forestEdge.cold";
const SPREAD = "forestEdge.mapSpread";
const CERTAIN = "forestEdge.certain";
const PINNED_BATTERY = 8;                        // the fact nail: after she hangs up on 112 the phone reads 8%
const CRICKETS_HUSH = 20 * 60 + 40;

/** Her own words, and the only long line in this scene. It belongs to the lamp, not to the walk in. */
const LAMP_LINE = "特别特别幸运，我带了一盏拍视频用的补光灯。";

// Things painted in 13-forest-edge, with the pixel they were read from.
/* The mark goes on a trunk the painting actually draws. The wall of boughs on the right of the clearing has no
   bare trunk in it — brightened 2-3x and read at 4-6x it is boughs from the canopy down to the grass, and the
   anchor that used to sit there (yaw 27 / pitch -25.5) was on undifferentiated undergrowth, which red line 5
   forbids and which mattered: missing this mark costs twenty minutes and +0.1 of the heart.
   13-forest-edge does draw one trunk in the open: the dwarf pine over the low rock. Brightened 2x and read at 9x,
   its reddish stem runs from (700, 540) down to (683, 615) on the 1280x720 grid and is 14-16 px wide; at y 576 it
   spans x 686-702. The mark goes there, drawn with sprites/blaze-red-white.webp at 2.8 vh (14.4 px tall, 16 px
   wide - it lands inside the stem): sprites/blaze-656.webp does not exist and is not going to this round, and
   blaze-red-white is the same mark forest1 puts on its own painted trunk two nodes later, so the two nodes agree
   and the player who learns the bar here recognises the same bar in there. The bare bar with 656 on it stays an
   ART request; nothing in this scene names the number out loud, so nothing here asserts what the sprite lacks. */
const TRUNK: Transform = { yaw: 6.2, pitch: -25.2 };                    // the dwarf pine's reddish stem, right of the trail (693, 576)
const LEFT_BOULDER: Transform = { yaw: -23, pitch: -24 };               // the white boulder left of the trail (706, 905)
const LOW_ROCK: Transform = { yaw: 11, pitch: -30 };                    // the small grey rock under the dwarf pine's roots (1180, 993)
const RIGHT_BOULDER: Transform = { yaw: -1.5, pitch: -21.5 };          // the middle of that boulder's sloping top, so the map lies on stone (1003, 871)
const TRAIL_IN: Transform = { yaw: -15, pitch: -27 };                   // the pale trail between the two boulders (819, 946)
const FOREST_DARK: Transform = { yaw: -13, pitch: -12, distance: 16 };  // the dark between the trunks the trail runs into (846, 740)
const SASSO: Transform = { yaw: 32, pitch: 22, distance: 40 };          // the lit face of the grey wall over the treeline (1461, 274)
const GRASS_RIB: Transform = { yaw: 44, pitch: -31, distance: 12 };     // the open grass running up to the right of the boulders (1625, 1001)
const IN_HAND: Transform = { yaw: 0, pitch: -36, distance: 8 };         // where her hand goes: low, in front of her, half out of frame
/* The lamp in her hand, low and to the right, clear of the trail. Pitch -28, not -34: the viewport's pitch limit
   resolves to about 10.4 deg and the frame only reaches -40 when the player deliberately looks at their own feet,
   so at -34 the thing she is holding was off the bottom of the screen the whole scene. -28 sits it on the lower
   edge of the resting frame, which is where a hand carrying a light actually is. */
const LAMP_HAND: Transform = { yaw: 16, pitch: -28, distance: 8 };      // the lamp once it is out: held low and to the right, clear of the trail
const OFFSCREEN: Transform = { yaw: 0, pitch: -88 };                    // story actions: E-key prompts, never drawn on the painting

const HOLDING_LAMP: Condition = { kind: "held", item: "fillLight" };
const FALSE_LINES: Record<string, string> = { "lichen-edge": "地衣。不是漆。", "oldpaint-edge": "旧漆。别的路线。" };

export default defineScene({
  id: "forestEdge",
  day: 1, place: "林缘 · 天黑", elevation: "1,980 m",
  painting: "pano/13-forest-edge.webp",
  body: "stand", material: "soft",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "night" },
  chapter: { eyebrow: "夜", title: "我也得进去" },
  arriveAt: 20 * 60 + 15,
  fallback: "太阳落到 Sassolungo 后面了。",
  // v4 §8: the way on opens once 112 is behind her and the lamp is out of the pack. The blaze is never a lock (D6).
  exitWhen: all(flag(CALL_DONE), HOLDING_LAMP),
  entities: [
    // Three candidate marks: the 656 on the spruce trunk, lichen on the near boulder, another route's old paint on the low rock.
    // The label is the name of the thing in the painting: this one is on a trunk, the other two are on stone.
    // All three stay where they are once she has settled them and go grey (v4 §3.5) — in the dark, a mark she has
    // read is the one thing she can still steer by, and deleting it off the trunk is the opposite of that.
    blaze("blaze-656", TRUNK, true, {
      sprite: { src: "sprites/blaze-red-white.webp", layer: "prop", sizeVh: 2.8 },
      interactable: { verbs: ["inspect"], label: "树干上的记号", reveal: 12, cost: { minutes: 1 } },
      visible: undefined, enabled: not(entityIs("blaze-656", "read")),
    }),
    // The two that are not paint are pale stone: they only exist for her once there is a lamp on them. Before that
    // this frame has no light source in it, and nothing in it should be lit.
    blaze("lichen-edge", LEFT_BOULDER, false, { visible: HOLDING_LAMP, enabled: not(entityIs("lichen-edge", "read")) }),
    blaze("oldpaint-edge", LOW_ROCK, false, { visible: HOLDING_LAMP, enabled: not(entityIs("oldpaint-edge", "read")) }),
    // The dark the trail runs into. Nothing to click: she just looks at it.
    { id: "forest-dark", transform: FOREST_DARK, gaze: { radius: 14, dwell: 900 } },
    // 20:40, still standing here: the crickets stop. A trigger, not a timeout — the clock did it.
    { id: "crickets-hush", transform: FOREST_DARK, trigger: { source: { on: "minute", at: CRICKETS_HUSH }, once: true, tag: "crickets-hush" } },
    // The map on the boulder top: the 656 line goes straight into the green (v4 §5.2 obj-forest). One minute, and the dark under it.
    prop("paper-map", RIGHT_BOULDER, "sprites/map-folded.webp", 6.5, {
      // A whole minute: ClockSystem rounds cost minutes and drops anything that rounds to zero, so this is
      // written as the number the clock actually takes (v4 §6 charges the map and the wall a minute each).
      interactable: { verbs: ["use"], label: "摊开地图", reveal: 12, cost: { minutes: 1, fear: 0.05 }, requires: has("paperMap") },
    }),
    // The last direct light of the day, on the wall over the treeline. A minute, or 1% of what is left of the phone.
    // At 21:05 it goes, and so does this: there is no light on the wall left to look at (v4 §6).
    lookAt("sasso-wall", SASSO, "石墙上最后一道光", 1, { visible: before(21 * 60 + 5) }),
    // The open grass to the right looks far easier than the trail. It ends at a stream bank (v4 §8: −20 min, never a dead end).
    wrongWay("grass-rib", GRASS_RIB, "右边开阔的草脊", 20, "草脊到头是一道溪岸。过不去。"),
    // The lamp once it is out of the pack: in her hand, low in the frame.
    { id: "lamp-held", transform: LAMP_HAND, sprite: { src: "sprites/fill-light.webp", layer: "hand", sizeVh: 12 }, visible: HOLDING_LAMP },
    // 112, mountain rescue. Three things she might get across, none of which she does (B5).
    // Not `once`: the sheet can leave the screen without her hanging up (Esc → title → continue, or a reload), and
    // the number has to still be there when it does. The minute it costs is spent in the script, once (CALLING).
    { id: "call-112", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["use"], label: "打 112 · 山地救援", reveal: 24, requires: has("phone") },
      visible: not(flag(CALL_DONE)) },
    // Same reason: putting the lamp back in the pack has to leave a way to take it out again.
    { id: "lamp-out", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["use"], label: "从包里摸出补光灯", reveal: 24, requires: has("fillLight") },
      visible: all(flag(CALL_DONE), not(HOLDING_LAMP)) },
    // Only for someone who has the lamp and stood still long enough to feel the cold come down. (The bite — wide or
    // narrow, v4 §3.4 — lives on the lamp in the pack, where nothing on screen points at it.) A minute, because a
    // minute is what the clock can take: it rounds and drops anything under half of one.
    { id: "zip-jacket", transform: OFFSCREEN, tags: ["action"],
      interactable: { verbs: ["use"], label: "拉上冲锋衣拉链", reveal: 24, cost: { minutes: 1 }, requires: has("redJacket"), once: true },
      visible: all(HOLDING_LAMP, flag(COLD), not(flag(ZIPPED))) },
    goArrow("go", TRAIL_IN, { to: "forest1", minutes: 30, label: "钻进林子", kind: "walk" }),
  ],
  seed: (w) => {
    const inv = w.state.inventory;
    w.setFlag(CALL_TRIES, 3); w.setFlag(CALL_TRIED, "where,alone,phone");
    w.setFlag(CALLING, true); w.setFlag(CALL_DONE, true); w.setFlag(LAMP_OUT, true);
    w.setFlag(CERTAIN, true); w.setFlag(SPREAD, true); w.setFlag(COLD, true); w.setFlag(ZIPPED, true);
    // What the forest edge hands downstream: the lamp in her hand on wide, the jacket on, the camera dead, the phone at 8%.
    w.patch("inventory", {
      hands: Array.from(new Set([...inv.hands.filter((item) => item !== "paperMap"), "fillLight" as const])).slice(-2),
      worn: inv.worn.includes("redJacket") ? inv.worn : [...inv.worn, "redJacket" as const],
    });
    w.patch("power", { camera: 0, lampMode: "wide", phone: PINNED_BATTERY });
    w.set("phone", { ...w.state.phone, battery: PINNED_BATTERY });
    w.patch("journal", { entries: Array.from(new Set([...w.state.journal.entries, "E-656"])) });
  },
  walkthrough: [
    { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 400 },
    { type: "interact", entity: "call-112", verb: "use" }, { wait: 500 },
    { type: "ui:action", id: "call:hangup" }, { wait: 500 },
    { type: "interact", entity: "lamp-out", verb: "use" }, { wait: 500 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // All three things into the phone, then the silence, then the lamp: the line arrives on the lamp, not on hanging up.
    tries: [
      { type: "interact", entity: "call-112", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "call:try", value: "where" }, { wait: 400 },
      { type: "ui:action", id: "call:try", value: "alone" }, { wait: 400 },
      { type: "ui:action", id: "call:try", value: "phone" }, { wait: 400 },
      { type: "ui:action", id: "call:hangup" }, { wait: 600 },
      { type: "interact", entity: "lamp-out", verb: "use" }, { wait: 600 },
      { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // The grass on the right first: twenty minutes to a stream bank and back, then the trail.
    wrong: [
      { type: "interact", entity: "grass-rib", verb: "inspect" }, { wait: 1200 },
      { type: "interact", entity: "call-112", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "call:hangup" }, { wait: 400 },
      { type: "interact", entity: "lamp-out", verb: "use" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
    // Everything the edge offers: both false marks, the real one, the map, the wall and a photograph of it,
    // standing still until the cold comes, the zip and the narrow bite. (No chocolate: on the main line it is
    // already gone by the time she gets here — hutView eats it — so `item:use chocolate` would do nothing.)
    thorough: [
      { type: "interact", entity: "blaze-656", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "paper-map", verb: "use" }, { wait: 600 }, { type: "overlay:close" }, { wait: 300 },
      { type: "interact", entity: "sasso-wall", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "sasso-wall", verb: "photograph" }, { wait: 300 },
      { type: "wait" }, { wait: 400 },
      { type: "interact", entity: "call-112", verb: "use" }, { wait: 400 },
      { type: "ui:action", id: "call:try", value: "where" }, { wait: 300 },
      { type: "ui:action", id: "call:try", value: "alone" }, { wait: 300 },
      { type: "ui:action", id: "call:try", value: "phone" }, { wait: 300 },
      { type: "ui:action", id: "call:hangup" }, { wait: 500 },
      { type: "interact", entity: "lamp-out", verb: "use" }, { wait: 500 },
      // The two stones that are not paint are only there once the lamp is on them.
      { type: "interact", entity: "lichen-edge", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "oldpaint-edge", verb: "inspect" }, { wait: 300 },
      { type: "interact", entity: "zip-jacket", verb: "use" }, { wait: 300 },
      { type: "lamp:mode", mode: "narrow" }, { wait: 400 },
      { type: "travel", entity: "go" },
    ],
  },
  script: (ctx) => {
    const w = ctx.world;
    const tries = () => ctx.flag<number>(CALL_TRIES, 0);

    // Warped straight in (?node=): the body has not walked here, so give it the heart it would have arrived with.
    ctx.onEnter((from) => { if (from === null) w.patch("body", { fear: Math.max(w.state.body.fear, 0.3) }); });

    /* The dark the trail goes into. Sound and a breath first; one half-line, once. */
    ctx.onGaze("forest-dark", () => {
      if (ctx.flag("forestEdge.sawDark", false)) return;
      ctx.setFlag("forestEdge.sawDark", true);
      ctx.sfx("breath", -0.2, 0.7); ctx.kick("glance", 0.5, { yaw: -1, pitch: -4 });
      ctx.say("路钻进去了。", { tag: "edge-dark" });
    });

    /* 20:40 by her own minutes: the crickets stop and the wind is all that is left. */
    ctx.onGaze("crickets-hush", () => {
      w.emit("ambience", { overrides: { crickets: 0.12, wind: 0.44 } });
      ctx.sfx("cloth", 0.6, 0.35); ctx.kick("settle", 0.25);
    });

    /* The map, spread on the boulder in the dark: the 656 line runs straight into the green. She reads it; she never says it. */
    ctx.onInteract("paper-map", () => {
      ctx.setFlag(SPREAD, true);
      w.dispatch({ type: "item:use", item: "paperMap" });
      w.dispatch({ type: "ui:action", id: "map:objective", value: "再看一次地图：得进森林" });
      ctx.learn("E-656");
      ctx.sfx("paper", 0, 0.8); ctx.kick("glance", 0.4, { yaw: 0, pitch: -8 });
      ctx.flash("656 · 一直钻进林子");
    });

    /* The last direct light on the wall. A minute of looking, or one percent of what the phone has left. */
    ctx.onInteract("sasso-wall", (verb) => {
      if (verb === "photograph") {
        w.dispatch({ type: "phone:shoot" }); ctx.setFlag("forestEdge.photo", true);
        ctx.kick("glance", 0.35, { yaw: 2, pitch: 5 });
        return;
      }
      ctx.setFlag("forestEdge.sawWall", true);
      ctx.kick("glance", 0.6, { yaw: 2, pitch: 6 }); ctx.sfx("exhale", 0.4, 0.6);
    });

    /* The open grass on the right: twenty minutes out to a stream bank she cannot cross, and twenty minutes of dark back. */
    ctx.onInteract("grass-rib", () => {
      ctx.setFlag("forestEdge.wrong", true);
      ctx.kick("step", 0.9); ctx.sfx("step", 0.5, 0.9); ctx.fx("gust", 0.4);
      ctx.spend({ fatigue: 0.04, fear: 0.08 }, "草脊");
      ctx.after(700, () => { ctx.kick("turn", 0.7); ctx.sfx("slide", 0.2, 0.5); });
      ctx.say("草脊到头是一道溪岸。过不去。", { tag: "edge-rib" });
    });

    /* 112. Three things she might get across; the line answers in Italian and none of them lands (B5). */
    const openCall = (tried: string) => ctx.open("call", { connected: true, tried });
    ctx.onInteract("call-112", () => {
      // Dialling costs her a minute the first time; re-opening a call she never hung up costs nothing.
      if (!ctx.flag(CALLING, false)) { ctx.setFlag(CALLING, true); ctx.spend({ minutes: 1 }, "112"); }
      ctx.sfx("tick", 0, 0.8); ctx.kick("glance", 0.4, { yaw: 0, pitch: -6 });
      openCall(ctx.flag<string>(CALL_TRIED, ""));
    });
    ctx.onAction("call:try", (value) => {
      if (typeof value !== "string" || w.state.ui.overlay !== "call") return;
      const list = ctx.flag<string>(CALL_TRIED, "").split(",").filter(Boolean);
      if (list.includes(value)) return;
      list.push(value);
      ctx.setFlag(CALL_TRIED, list.join(","));
      ctx.bump(CALL_TRIES, 1);
      // A minute each, and a percent — but never below the nail, so the sheet reads 8% while she says it does (v4 §3.4).
      ctx.spend({ minutes: 1, battery: Math.min(1, Math.max(0, w.state.power.phone - PINNED_BATTERY)) }, "112");
      ctx.sfx("tock", 0.25, 0.6); ctx.kick("glance", 0.25, { yaw: 0, pitch: -2 });
      openCall(list.join(","));
    });
    /* Hanging up. Whatever takes the sheet off the screen counts as hanging up — the button, or anything else. */
    const hangUp = () => {
      if (ctx.flag(CALL_DONE, false)) return;
      ctx.setFlag(CALL_DONE, true);
      ctx.close();
      const over = w.state.power.phone - PINNED_BATTERY;
      if (over > 0) ctx.spend({ battery: over }, "挂断 112");
      ctx.sfx("tock", 0, 0.9); ctx.kick("settle", 0.6);
      // Hung up quickly: the line arrives at once and sounds like something she is telling herself.
      // Tried all three: she says nothing here — it waits until her hand actually finds the lamp.
      if (tries() < 3) ctx.say(LAMP_LINE, { tag: "edge-lamp", priority: 1 });
    };
    ctx.onAction("call:hangup", hangUp);
    ctx.on("overlay", ({ id }) => { if (id === null && ctx.flag(CALLING, false)) hangUp(); });

    /* The lamp out of the pack. The button is only one way to it — the cloth in the pack has its own. The beat hangs
       on her hand finding the lamp (the `item:use` event), so it happens whichever way she reaches for it. */
    ctx.onInteract("lamp-out", () => { w.dispatch({ type: "item:use", item: "fillLight" }); });
    /* Changing the bite. v4 §3.4 prices it at 20 seconds and ClockSystem cannot hold twenty seconds — it rounds
       cost minutes and drops anything under half of one — so it is charged as the whole minute the clock can
       take, and only the first time each bite is set up: the lamp has to come out of her teeth, the shroud gets
       turned, and it goes back in. Flipping back and forth after that is free, which is the honest reading of a
       cost the clock cannot represent. (InventorySystem emits its own 0.3 minutes for the same action and
       ClockSystem rounds it away; this is that cost, written as a number the clock can take.) Narrow also takes
       its slice of the heart, every time. */
    ctx.on("lamp:mode", ({ mode }) => {
      const first = ctx.flag(`forestEdge.bite.${mode}`, false) === false;
      ctx.setFlag(`forestEdge.bite.${mode}`, true);
      ctx.setFlag("forestEdge.lampMode", mode);
      if (first) ctx.spend({ minutes: 1 }, "换咬法");
      ctx.sfx("tock", 0, 0.7); ctx.kick("glance", 0.4, { yaw: 0, pitch: -3 });
      ctx.fx("flashlight", mode === "narrow" ? 1.2 : 0.8);
      if (mode === "narrow") ctx.spend({ fear: 0.06 }, "窄光");
    });

    /* The zip. Thirty seconds; it only shows up for someone who stood here long enough to get cold. */
    ctx.onInteract("zip-jacket", () => {
      if (!w.state.inventory.worn.includes("redJacket")) w.patch("inventory", { worn: [...w.state.inventory.worn, "redJacket"] });
      ctx.setFlag(ZIPPED, true);
      ctx.sfx("zip", 0, 0.9); ctx.kick("settle", 0.5);
      ctx.after(260, () => ctx.sfx("cloth", 0, 0.5));
    });

    /* The marks. The real one is the journal's business (the hand, the cloth, −0.25 of the heart); a false one gets a word. */
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("settle", 0.6); ctx.sfx("exhale", 0.3, 0.8); return; }
      const line = FALSE_LINES[entity];
      if (!line) return;
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.4, { yaw: 0, pitch: -3 });
      ctx.say(line, { tag: `edge-${entity}` });
    });

    /* The 360 camera is flat, and the way she learns it is by raising it (v4 §3.4). The chocolate, if any is left. */
    ctx.on("item:use", ({ item }) => {
      if (item === "fillLight" && !ctx.flag(LAMP_OUT, false)) {
        ctx.setFlag(LAMP_OUT, true);
        ctx.spend({ minutes: 1 }, "摸出补光灯");
        ctx.hand(IN_HAND, "grip"); ctx.sfx("cloth", 0, 0.9); ctx.kick("settle", 0.7);
        ctx.after(320, () => { ctx.sfx("tick", 0, 0.6); ctx.fx("flashlight", 0.9); });
        // Tried all three things into the phone: this is where her own words finally arrive.
        if (tries() >= 3) ctx.say(LAMP_LINE, { tag: "edge-lamp", priority: 1 });
        return;
      }
      if (item === "camera360" && w.state.power.camera <= 0) {
        ctx.setFlag("forestEdge.cameraDead", true);
        ctx.hand(IN_HAND, "grip"); ctx.sfx("tock", 0, 0.7); ctx.kick("glance", 0.5, { yaw: 0, pitch: -5 });
        return;
      }
      if (item === "chocolate") { ctx.kick("settle", 0.5); ctx.sfx("exhale", 0, 0.8); }
    });

    /* Standing still. The first breath is where the cold arrives; after that it is only breathing. */
    let stills = 0;
    ctx.onWait(() => {
      stills += 1;
      if (!ctx.flag(COLD, false)) {
        ctx.setFlag(COLD, true);
        ctx.sfx("cloth", 0, 0.5); ctx.kick("settle", 0.3); ctx.fx("gust", 0.3);
        return;
      }
      if (stills % 3 === 0) { ctx.sfx("exhale", 0, 0.6); ctx.kick("settle", 0.2); }
    });

    /* A shout into the trees, and the valley hands it back twice (v4 §3.3; the space bar is the only way to it here). */
    ctx.on("camera:impulse", ({ kind }) => {
      if (kind !== "shout") return;
      ctx.fx("shout", 0.8);
      ctx.after(430, () => ctx.sfx("breath", -0.7, 0.45));
      ctx.after(820, () => ctx.sfx("breath", 0.7, 0.28));
    });

    /* 21:05: the last of it goes. The lamp is all there is now. */
    ctx.onMark("last-light", () => {
      w.emit("ambience", { overrides: { crickets: 0.1, wind: 0.5, windTone: 480 } });
      ctx.kick("settle", 0.5); ctx.sfx("exhale", 0, 0.7);
      ctx.say("最后一点光也没了。", { tag: "edge-lastlight", priority: 1 });
    });

    /* Into the trees without the 656 on the trunk: twenty minutes of the wrong line in the dark, and the heart goes up (v4 §3.5). */
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "forestEdge" || to !== "forest1" || ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: 20, fear: 0.1 }, "没认记号，找了一段路");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "edge-lost", priority: 1 });
    });
  },
});
