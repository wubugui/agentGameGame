/* Piz Selva, 2,941 m, 15:15. The wooden cross with its plate, Sassolungo under its cloud, the sea of cloud over the
   valley on the left, the grey slope on the right where the plateau begins. The 360 selfie she had to take is the one
   thing that cannot be skipped; everything else — the cross, the plate, the photos, the messages, the helicopter that
   crosses once, the flat stone — is a few minutes each, and the game says nothing about the sum.
   Coordinates read off the 150°×84° grid of 08-summit (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84). */
import { all, any, entityIs, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { backArrow, goArrow, lookAt, readable } from "./_shared";

const SELFIE = "summit.selfie";          // required downstream (policy §6)
const CAM_UP = "summit.cameraUp";
const HELI_NEAR = "summit.heliNear";     // the rotor is somewhere to the right, hovering
const HELI = "summit.helicopter";        // it crossed overhead (found with the eyes)
const HELI_GONE = "summit.heliGone";
const SAT = "summit.sat";
const CAP_LOOSE = "summit.capLoose";
const WAY = "summit.sawWay";

/* The cross: post above the crossbar (433, 280), the rope binding at the crossing (435, 360), the post below it (437, 446). */
const POST_UP: Transform = { yaw: -24.3, pitch: 9, distance: 9 };
const CROSSING: Transform = { yaw: -23.5, pitch: -0.5, distance: 9 };
const PLATE: Transform = { yaw: -23.8, pitch: -10, distance: 9 };
const RIBBON: Transform = { yaw: -47.5, pitch: -5.5, distance: 9 };          // the wrapped tape on the left arm's tip (235, 405)
const SIT_STONE: Transform = { yaw: -6, pitch: -27, distance: 8 };           // the pale flat block right of the cross's foot (587, 595)
const CAP_LANDS: Transform = { yaw: 33, pitch: -22, distance: 9 };           // the rocks above the gully on the right (1050, 549)
const HELI_FAR: Transform = { yaw: 58, pitch: 24, distance: 30 };            // blue sky right of the big cloud (1135, 154)
const HELI_OVER: Transform = { yaw: 2, pitch: 28, distance: 14 };            // overhead, sky left of the cloud (657, 120)

export default defineScene({
  id: "summit",
  day: 1, place: "Piz Selva 山顶", elevation: "2,941 m",
  painting: "pano/08-summit.webp",
  body: "stand", material: "rock",
  ambience: { wind: 0.75, windTone: 1250, birds: 0.15, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { motes: "dust", clouds: true, gusty: true, windPan: 0.3 },
  chapter: { eyebrow: "2,941 m", title: "登顶" },
  arriveAt: 15 * 60 + 15,
  idleLook: true,
  fallback: "眼前是 Sassolungo 和云海。",
  exitWhen: flag(SELFIE),
  entities: [
    // --- The cross. The post to put a hand on, the plate under the crossbar to read, the crossing to raise the camera at. ---
    { id: "cross", transform: POST_UP,
      interactable: { verbs: ["inspect"], label: "木十字架", reveal: 12, cost: { minutes: 1 } } },
    readable("plate", PLATE, "铭牌", { kind: "plaque", title: "PIZ SELVA", lines: ["PIZ SELVA", "2941 m"], entry: "E-summit", minutes: 1 },
      { sprite: { src: "sprites/summit-cross-plate.webp", layer: "prop", sizeVh: 4.5 } }),
    { id: "selfie", transform: CROSSING, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "举起相机", reveal: 13, cost: { minutes: 4, camera: 3 }, requires: any({ kind: "held", item: "camera360" }, flag(CAM_UP)) },
      hold: { ms: 1200, scaleWith: ["fatigue"] },
      visible: not(flag(SELFIE)) },
    // The tape wrapped round the left arm's tip: it lifts in the wind when she looks at it. No words.
    { id: "ribbon", transform: RIBBON, gaze: { radius: 10, dwell: 900 } },

    // --- What she looked at. Each is minutes; none of them says anything she could read for herself. ---
    { id: "sassolungo", transform: { yaw: 26, pitch: 11, distance: 30 },
      interactable: { verbs: ["photograph", "inspect"], label: "Sassolungo", reveal: 14, cost: { minutes: 3 } } },
    { id: "cloud-cap", transform: { yaw: 26, pitch: 25, distance: 30 }, gaze: { radius: 14, dwell: 1200 } },
    { id: "cloud-sea", transform: { yaw: -46, pitch: 9, distance: 30 },
      interactable: { verbs: ["photograph", "inspect"], label: "云海", reveal: 14, cost: { minutes: 3 } } },
    lookAt("valley", { yaw: -52, pitch: -17, distance: 30 }, "下面的山谷", 1),
    { id: "plateau-way", transform: { yaw: 46, pitch: -4, distance: 18 },
      interactable: { verbs: ["inspect"], label: "右边的石坡", reveal: 13, cost: { minutes: 1 } } },

    // --- The helicopter: heard first, off to the right, hovering. It only crosses overhead once she has found it with her eyes. ---
    { id: "heli-far", transform: HELI_FAR,
      sprite: { src: "sprites/helicopter.webp", layer: "figure", sizeVh: 2.2 },
      gaze: { radius: 14, dwell: 600 },
      visible: all(flag(HELI_NEAR), not(flag(HELI))) },
    { id: "heli-over", transform: HELI_OVER,
      sprite: { src: "sprites/helicopter-passing.webp", layer: "figure", sizeVh: 6, className: "heli-passing" },
      visible: all(flag(HELI), not(flag(HELI_GONE))) },

    // --- The flat stone in front of the cross: the only seat on the summit. ---
    { id: "sit-stone", transform: SIT_STONE,
      interactable: { verbs: ["use"], label: "平石", reveal: 12, cost: { minutes: 3 }, once: true },
      visible: not(entityIs("sit-stone", "used")) },

    // --- The cap, when a gust takes it: it lands on the rocks to the right. Grab it against the wind, or the next gust has it. ---
    { id: "cap", transform: CAP_LANDS, className: "hold-hotspot",
      sprite: { src: "sprites/item-cap.webp", layer: "prop", sizeVh: 5 },
      interactable: { verbs: ["hold"], label: "帽子", reveal: 14, cost: { minutes: 0 } },
      hold: { ms: 400, scaleWith: ["fatigue"] },
      visible: flag(CAP_LOOSE) },

    // --- The way on: the sandy track between the rocks on the right (14 min + the pack and the selfie = the 20 of the base plan). The way back: down the boulders on the left. ---
    goArrow("go", { yaw: 44, pitch: -27 }, { to: "plateau", minutes: 14, label: "往高原", kind: "walk" }),
    backArrow("back", { yaw: -57, pitch: -32 }, "exit", "回头", 10),
  ],
  seed: (w) => {
    w.setFlag(SELFIE, true); w.setFlag(CAM_UP, true);
    w.setFlag(HELI_NEAR, true); w.setFlag(HELI, true); w.setFlag(HELI_GONE, true);
    w.patch("power", { camera: Math.max(0, w.state.power.camera - 3) });
  },
  script: (ctx) => {
    const w = ctx.world;
    const shoot = () => w.dispatch({ type: "phone:shoot" });
    const closeSelfie = () => { if (w.state.ui.overlay === "selfie") ctx.close(); };

    /* The rotor: somewhere to the right, idling, until she turns and finds it. It comes on her first breath here or her selfie. */
    const heliCome = () => {
      if (ctx.flag(HELI_NEAR, false)) return;
      ctx.setFlag(HELI_NEAR, true);
      ctx.sfx("helicopter", 0.7, 0.4);
    };
    const heliGone = () => { if (ctx.flag(HELI, false) && !ctx.flag(HELI_GONE, false)) ctx.setFlag(HELI_GONE, true); };

    /* Raising the camera from the pack is what frees the hold at the crossing; stowing it takes that back. */
    ctx.on("item:use", ({ item }) => {
      if (item !== "camera360") return;
      ctx.setFlag(CAM_UP, true);
      ctx.sfx("cloth"); ctx.kick("glance", 0.5, { yaw: 0, pitch: 6 }); ctx.hand(CROSSING, "grip", false);
    });
    ctx.on("item:stow", ({ item }) => { if (item === "camera360") ctx.setFlag(CAM_UP, false); });

    /* The selfie: the one thing she did here that cannot be skipped. The little planet spins; a rotor starts off to the right. */
    ctx.onHold("selfie", () => {
      ctx.setFlag(SELFIE, true);
      ctx.open("selfie");
      ctx.sfx("shutter"); ctx.kick("settle", 0.7); ctx.hand(POST_UP, "grip", true);
      ctx.say("我开心了一下。", { tag: "summit-selfie", priority: 1 });
      heliCome();
    });
    ctx.onRelease("selfie", (progress) => { if (progress > 0.25) { ctx.kick("glance", 0.3, { yaw: 0, pitch: -3 }); ctx.sfx("cloth", 0, 0.5); } });
    /* The flash leaves on her next look, touch or breath — never on a timer. The helicopter, once it has crossed, is gone the same way. */
    ctx.on("gaze:enter", () => { closeSelfie(); heliGone(); });
    ctx.on("gaze:leave", closeSelfie);
    ctx.on("interact:attempt", () => { closeSelfie(); heliGone(); });
    ctx.on("phone:open", closeSelfie);
    ctx.on("camera:impulse", ({ kind }) => { if (kind === "turn") closeSelfie(); });

    /* The cross: a hand on the post, the day's height in her own words. The plate: a hand, a dip of the head, the notebook. */
    ctx.onInteract("cross", () => {
      ctx.hand(POST_UP, "grip", false); ctx.sfx("cloth", -0.3, 0.6); ctx.kick("glance", 0.5, { yaw: -2, pitch: 8 });
      w.emit("body:rest", { seconds: 2 });
      ctx.say("相当于一屁股一屁股把自己抬升了一千六百米。", { tag: "summit-cross" });
    });
    ctx.onInteract("plate", () => { ctx.hand(PLATE, "grip", false); ctx.kick("glance", 0.4, { yaw: 0, pitch: -4 }); });
    ctx.onGaze("ribbon", () => { ctx.sfx("cloth", -0.6, 0.7); ctx.kick("glance", 0.3, { yaw: -3, pitch: 0 }); ctx.fx("gust", 0.3); });

    /* Looking. A phone photo where she clicks the mountain or the cloud; a glance and a breath where she only looks. */
    ctx.onInteract("sassolungo", (verb) => {
      if (verb === "photograph") shoot();
      ctx.kick("glance", 0.4, { yaw: 4, pitch: 3 }); ctx.sfx("exhale", 0.3, 0.6);
    });
    ctx.onGaze("cloud-cap", () => {
      ctx.fx("gust", 0.5); ctx.kick("settle", 0.3);
      ctx.say("云压在 Sassolungo 上面。", { tag: "summit-cloud" });
    });
    ctx.onInteract("cloud-sea", (verb) => {
      if (verb === "photograph") shoot();
      ctx.kick("glance", 0.4, { yaw: -4, pitch: 2 }); ctx.fx("gust", 0.35);
    });
    ctx.onInteract("valley", (verb) => {
      if (verb === "photograph") shoot();
      ctx.kick("glance", 0.5, { yaw: -5, pitch: -3 }); ctx.sfx("breath", -0.5, 0.5);
    });
    ctx.onInteract("plateau-way", () => {
      ctx.setFlag(WAY, true);
      ctx.kick("glance", 0.5, { yaw: 6, pitch: -2 }); ctx.fx("dust", 0.5); ctx.sfx("step", 0.5, 0.4);
      ctx.say("高原在那边。先去山屋。", { tag: "summit-way" });
    });

    /* The helicopter crosses once she has found it: four minutes of standing with her head back. */
    ctx.onGaze("heli-far", () => {
      if (ctx.flag(HELI, false)) return;
      ctx.setFlag(HELI, true);
      ctx.spend({ minutes: 4 }, "看直升机飞过");
      ctx.sfx("helicopter", 0, 1); ctx.kick("turn", 0.9, { yaw: 0, pitch: 8 }); ctx.fx("gust", 0.8);
      ctx.say("头顶飞过一架直升机。", { tag: "summit-heli", priority: 1 });
    });

    /* Sitting: a longer breath, and every wait after it rests a little more. Standing still is also what brings the rotor. */
    ctx.onInteract("sit-stone", () => {
      ctx.setFlag(SAT, true);
      w.emit("body:rest", { seconds: 5 }); w.emit("body:fatigue", { delta: -0.1, reason: "坐下" });
      ctx.kick("settle", 1.2, { yaw: 0, pitch: -3 }); ctx.sfx("exhale"); ctx.sfx("cloth", 0.2, 0.5);
    });
    ctx.onWait(() => {
      heliCome();
      if (ctx.flag(HELI_NEAR, false) && !ctx.flag(HELI, false)) ctx.sfx("helicopter", 0.7, 0.3);   // still idling out there
      if (ctx.flag(SAT, false)) w.emit("body:fatigue", { delta: -0.02, reason: "坐着" });
    });

    /* Messages sent from up here get their replies; each one is a few minutes of looking at the screen. */
    ctx.on("phone:message", ({ contact }) => {
      ctx.bump("summit.sent", 1);
      ctx.spend({ minutes: 4 }, `等${contact}的回信`);
      ctx.sfx("tick", 0, 0.6); ctx.kick("glance", 0.3, { yaw: 0, pitch: -5 });
    });

    /* A strong gust can take the cap. It lands on the rocks to the right; grabbing it is a short hold; the next strong gust has it. */
    ctx.on("camera:impulse", ({ kind, strength }) => {
      if (kind !== "turn") return;
      const s = strength ?? 0;
      if (ctx.flag(CAP_LOOSE, false)) {
        if (s >= 1.2 && !w.rt.hold) { ctx.setFlag(CAP_LOOSE, false); ctx.lose("cap", "被风吹下山顶"); ctx.sfx("cloth", 0.6, 0.8); ctx.fx("gust", 0.9); }
        return;
      }
      if (s < 1.25 || !w.state.inventory.worn.includes("cap") || w.rt.rng() > 0.15) return;
      ctx.setFlag(CAP_LOOSE, true);
      w.dispatch({ type: "pack:stow", item: "cap" });
      ctx.kick("turn", 1.1, { yaw: 30, pitch: -20 }); ctx.fx("gust", 1);
      ctx.say("帽子。", { tag: "summit-cap", priority: 1 });
    });
    ctx.onHold("cap", () => {
      ctx.setFlag(CAP_LOOSE, false);
      w.dispatch({ type: "pack:equip", item: "cap" });
      ctx.hand(CAP_LANDS, "grip", false); ctx.kick("settle", 0.6); ctx.sfx("cloth", 0.3, 0.6);
    });
    ctx.onRelease("cap", () => { ctx.kick("glance", 0.3, { yaw: 2, pitch: -2 }); ctx.sfx("slide", 0.4, 0.4); });
    ctx.on("travel:begin", ({ from }) => {
      if (from !== "summit") return;
      heliGone();
      if (ctx.flag(CAP_LOOSE, false)) { ctx.setFlag(CAP_LOOSE, false); ctx.lose("cap", "留在了山顶的石头上"); }
    });
  },
  walkthrough: [
    { type: "pack:open" },
    { type: "item:use", item: "camera360" },
    { type: "pack:close" },
    { type: "hold:start", entity: "selfie" },
    { wait: 3200 },
    { type: "hold:end" },
    { wait: 300 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Everything the summit offers: the cross, the plate, both photos, the valley, the way on, the stone, the rotor found, a message.
    full: [
      { type: "interact", entity: "cross", verb: "inspect" },
      { type: "interact", entity: "plate", verb: "read" },
      { type: "overlay:close" },
      { type: "interact", entity: "sassolungo", verb: "photograph" },
      { type: "interact", entity: "cloud-sea", verb: "photograph" },
      { type: "interact", entity: "valley", verb: "inspect" },
      { type: "interact", entity: "plateau-way", verb: "inspect" },
      { type: "interact", entity: "sit-stone", verb: "use" },
      { type: "wait" },
      { type: "phone:open", tab: "messages" }, { type: "phone:send", contact: "mama", kind: "text", text: "到顶了" }, { wait: 2200 }, { type: "phone:close" },
      { type: "pack:open" },
      { type: "item:use", item: "camera360" },
      { type: "pack:close" },
      { type: "hold:start", entity: "selfie" },
      { wait: 3200 },
      { type: "hold:end" },
      { type: "wait" },
      { type: "travel", entity: "go" },
    ],
    back: [
      { type: "travel", entity: "back" },
    ],
  },
});
