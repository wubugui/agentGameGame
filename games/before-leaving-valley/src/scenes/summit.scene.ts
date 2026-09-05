/* Piz Selva, 2,941 m, 15:15. The wooden cross, Sassolungo under its cloud, the cloud lying over the valley on the
   left, the grey slope on the right where the plateau begins. The 360 selfie she had to take is the one thing that
   cannot be skipped; everything else — the cross, the photos, the messages, the helicopter that crosses once, the flat
   stone — costs four to eight minutes each (§6/§7), and the game says nothing about the sum.
   This is the node whose whole thesis is that the minutes spent being happy are paid back in the forest at night, so
   every look here is priced like a look, not like a click.
   Coordinates read off the 150°×84° grid of 08-summit (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84). */
import { any, entityIs, flag, not } from "../engine/condition";
import { defineScene } from "../engine/scene";
import type { Transform } from "../engine/types";
import { backArrow, goArrow, lookAt } from "./_shared";

const SELFIE = "summit.selfie";          // required downstream (policy §6)
const CAM_UP = "summit.cameraUp";
const HELI_NEAR = "summit.heliNear";     // the rotor is somewhere off to the left, hovering
const HELI = "summit.helicopter";        // it crossed overhead
const HELI_GONE = "summit.heliGone";     // and it is gone again
const SAT = "summit.sat";
const WAY = "summit.sawWay";

/* The cross: post above the crossbar (433, 280), the rope binding at the crossing (435, 360). */
const POST_UP: Transform = { yaw: -24.3, pitch: 9, distance: 9 };
const CROSSING: Transform = { yaw: -23.5, pitch: -0.5, distance: 9 };
const RIBBON: Transform = { yaw: -47.5, pitch: -5.5, distance: 9 };          // the wrapped tape on the left arm's tip (235, 405)
const SIT_STONE: Transform = { yaw: -6, pitch: -27, distance: 8 };           // the pale flat block right of the cross's foot (587, 595)

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
    /* --- The cross. The post to put a hand on, the crossing to raise the camera at.
       §6 also gives this node the PIZ SELVA / 2941 m plate; 08-summit does not paint one — between the crossbar and the
       next rope binding the post is bare wood (checked at 4×) — and `summit-cross-plate.webp` has not been drawn. A
       readable hanging on nothing is a hotspot that is not on the thing the painting paints (§0.5), so the plate is not
       in this scene today: the art is a P0 request with its placement, and the entity comes back with it. Nothing is
       lost downstream — `E-summit` is the route plate's entry at plaque, and it is written there. --- */
    { id: "cross", transform: POST_UP,
      interactable: { verbs: ["inspect"], label: "木十字架", reveal: 12, cost: { minutes: 4 } } },
    { id: "selfie", transform: CROSSING, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "举起相机", reveal: 13, cost: { minutes: 4, camera: 3 }, requires: any({ kind: "held", item: "camera360" }, flag(CAM_UP)) },
      hold: { ms: 1200, scaleWith: ["fatigue"] },
      visible: not(flag(SELFIE)) },
    // The tape wrapped round the left arm's tip: it lifts in the wind when she looks at it. No words.
    { id: "ribbon", transform: RIBBON, gaze: { radius: 10, dwell: 900 } },

    // --- What she looked at. Four to eight minutes each (§6/§7); none of them says anything she could read for herself. ---
    { id: "sassolungo", transform: { yaw: 26, pitch: 11, distance: 30 },
      interactable: { verbs: ["photograph", "inspect"], label: "Sassolungo", reveal: 14, cost: { minutes: 5 } } },
    { id: "cloud-cap", transform: { yaw: 26, pitch: 25, distance: 30 }, gaze: { radius: 14, dwell: 1200 } },
    // The flat cloud base lying on the far ranges left of the cross (247, 339) — not the discrete cumulus in the sky above it.
    { id: "cloud-sea", transform: { yaw: -46, pitch: 2.5, distance: 30 },
      interactable: { verbs: ["photograph", "inspect"], label: "云海", reveal: 14, cost: { minutes: 5 } } },
    lookAt("valley", { yaw: -52, pitch: -17, distance: 30 }, "下面的山谷", 4),
    { id: "plateau-way", transform: { yaw: 46, pitch: -4, distance: 18 },
      interactable: { verbs: ["inspect"], label: "右边的石坡", reveal: 13, cost: { minutes: 4 } } },

    /* --- The helicopter is not an entity today. `helicopter.webp` / `helicopter-passing.webp` have not been drawn, and
       hanging the one thing §6 calls a discoverable on an invisible point in an empty sky means the only way to find it
       is to rest the pointer on a pixel with nothing on it. Until the art lands it is what it was in the valley all
       afternoon: a rotor somewhere off to the left, and then, if she is standing still, the whole machine going over —
       sound, a head thrown back, and the gust of it (see the script's onWait). Both sprites, and the `heli-passing`
       crossing rule, are in the requests; the gaze targets come back with them. --- */

    // --- The flat stone in front of the cross: the only seat on the summit. ---
    { id: "sit-stone", transform: SIT_STONE,
      interactable: { verbs: ["use"], label: "平石", reveal: 12, cost: { minutes: 6 }, once: true },
      visible: not(entityIs("sit-stone", "used")) },

    /* --- The way on: the sandy track between the rocks on the right (14 min + the pack and the selfie = the 20 of the
       base plan). The way back: down the boulders on the left. The summit stands 110 min above the top of the ferrata
       (§3.1) and exit charges 88 to come back up, so going down is priced at 40 rather than 10: the descent is half of
       one long price, not a cheap peek that ambushes the player with 88 on the way home. --- */
    goArrow("go", { yaw: 44, pitch: -27 }, { to: "plateau", minutes: 14, label: "往高原", kind: "walk" }),
    backArrow("back", { yaw: -57, pitch: -32 }, "exit", "回头", 40),
  ],
  seed: (w) => {
    w.setFlag(SELFIE, true); w.setFlag(CAM_UP, true);
    w.setFlag(HELI_NEAR, true); w.setFlag(HELI, true); w.setFlag(HELI_GONE, true);
    w.setFlag("summit.sent", 3);          // the three replies of §8; the per-contact keys are UISystem's
    w.patch("power", { camera: Math.max(0, w.state.power.camera - 3) });
  },
  script: (ctx) => {
    const w = ctx.world;
    const shoot = () => w.dispatch({ type: "phone:shoot" });
    const closeSelfie = () => { if (w.state.ui.overlay === "selfie") ctx.close(); };

    /* The rotor: somewhere off to the left over the valley, idling. It comes on her first breath here or on her selfie.
       The idling machine only ever gets a low thump panned that way — the full pass-overhead cue (soundscape.helicopter,
       7 s, −1 → +1, deaf to pan and strength) belongs to the crossing alone, which happens once. */
    const rotor = (strength: number) => ctx.sfx("thud", -0.65, strength);
    const heliCome = () => {
      if (ctx.flag(HELI_NEAR, false)) return;
      ctx.setFlag(HELI_NEAR, true);
      rotor(0.5);
    };
    /* And then it comes over: four minutes of standing with her head back, from the left to the right, the way the cue
       itself sweeps. With no machine painted in that sky this is sound, neck and wind — nothing to click, nothing on a
       timer, and nothing she is made to look at. It happens once, to a player who is standing still (§6: 直升机只飞一次). */
    const heliCross = () => {
      if (ctx.flag(HELI, false)) return;
      ctx.setFlag(HELI, true);
      ctx.spend({ minutes: 4 }, "看直升机飞过");
      ctx.sfx("helicopter", 0, 1);
      ctx.kick("turn", 0.9, { yaw: 0, pitch: 8 });
      ctx.fx("gust", 0.8);
      ctx.say("头顶飞过一架直升机。", { tag: "summit-heli", priority: 1 });
      // The crossing is the whole of it: it comes from the left, it goes out to the right, and that is the last of it
      // today. (When the two sprites land, HELI_GONE goes back to being the moment she watches it leave the frame.)
      ctx.setFlag(HELI_GONE, true);
    };

    /* Raising the camera from the pack is what frees the hold at the crossing; stowing it takes that back. */
    ctx.on("item:use", ({ item }) => {
      if (item !== "camera360") return;
      ctx.setFlag(CAM_UP, true);
      ctx.sfx("cloth"); ctx.kick("glance", 0.5, { yaw: 0, pitch: 6 }); ctx.hand(CROSSING, "grip", false);
    });
    ctx.on("item:stow", ({ item }) => { if (item === "camera360") ctx.setFlag(CAM_UP, false); });

    /* The selfie: the one thing she did here that cannot be skipped. The little planet spins; a rotor starts off to the left. */
    ctx.onHold("selfie", () => {
      ctx.setFlag(SELFIE, true);
      ctx.open("selfie");
      ctx.sfx("shutter"); ctx.kick("settle", 0.7); ctx.hand(POST_UP, "grip", true);
      ctx.say("我开心了一下。", { tag: "summit-selfie", priority: 1 });
      heliCome();
    });
    ctx.onRelease("selfie", (progress) => { if (progress > 0.25) { ctx.kick("glance", 0.3, { yaw: 0, pitch: -3 }); ctx.sfx("cloth", 0, 0.5); } });
    /* The flash leaves on her next look, touch or breath — never on a timer. The helicopter is not on this handler:
       turning toward a thing must never be what deletes it. */
    ctx.on("gaze:enter", closeSelfie);
    ctx.on("gaze:leave", closeSelfie);
    ctx.on("interact:attempt", closeSelfie);
    ctx.on("phone:open", closeSelfie);
    ctx.on("camera:impulse", ({ kind }) => { if (kind === "turn") closeSelfie(); });

    /* The cross: a hand on the post, the day's height in her own words. */
    ctx.onInteract("cross", () => {
      ctx.hand(POST_UP, "grip", false); ctx.sfx("cloth", -0.3, 0.6); ctx.kick("glance", 0.5, { yaw: -2, pitch: 8 });
      w.emit("body:rest", { seconds: 2 });
      ctx.say("相当于一屁股一屁股把自己抬升了一千六百米。", { tag: "summit-cross" });
    });
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
      ctx.say("高原在那边。", { tag: "summit-way" });   // the plan is on the memo page; she does not read it back to him
    });

    /* Sitting: a longer breath, and every wait after it rests a little more. Standing still is also what brings the rotor. */
    ctx.onInteract("sit-stone", () => {
      ctx.setFlag(SAT, true);
      w.emit("body:rest", { seconds: 5 }); w.emit("body:fatigue", { delta: -0.1, reason: "坐下" });
      ctx.kick("settle", 1.2, { yaw: 0, pitch: -3 }); ctx.sfx("exhale"); ctx.sfx("cloth", 0.2, 0.5);
    });
    /* Standing still: the first breath brings the rotor up out of the valley on the left, the next one is it still out
       there, and the one after that is the machine itself going over. Three breaths is about twenty seconds of a player
       doing nothing at all on a summit — she is not made to wait, and a player who never stops moving never hears more
       than the first thump. */
    let breaths = 0;
    ctx.onWait(() => {
      breaths += 1;
      const first = !ctx.flag(HELI_NEAR, false);
      heliCome();
      if (!first && !ctx.flag(HELI, false)) {
        if (breaths >= 3) heliCross();
        else rotor(0.3);
      }
      if (ctx.flag(SAT, false)) w.emit("body:fatigue", { delta: -0.02, reason: "坐着" });
    });

    /* Messages sent from up here get their replies; each one is a few minutes of looking at the screen. */
    ctx.on("phone:message", ({ contact }) => {
      ctx.bump("summit.sent", 1);
      ctx.spend({ minutes: 4 }, `等${contact}的回信`);
      ctx.sfx("tick", 0, 0.6); ctx.kick("glance", 0.3, { yaw: 0, pitch: -5 });
    });

    /* A gust taking her cap onto the rocks to the right was a hold on `item-cap.webp`, which has not been drawn (cable
       is waiting on the same file). Grabbing a hat that is not in the picture is worse than not losing it, so the whole
       branch is out until the sprite lands; it is in the requests with the placement it had. */
  },
  walkthrough: [
    { type: "pack:open" },
    { type: "item:use", item: "camera360" },
    { type: "pack:close" },
    { type: "hold:start", entity: "selfie" },
    { wait: 3400 },
    { type: "hold:end" },
    { wait: 300 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Everything the summit offers: the cross, both photos, the valley, the way on, the stone, the helicopter, a message.
    full: [
      { type: "interact", entity: "cross", verb: "inspect" },
      { type: "interact", entity: "sassolungo", verb: "photograph" },
      { type: "interact", entity: "cloud-sea", verb: "photograph" },
      { type: "interact", entity: "valley", verb: "inspect" },
      { type: "interact", entity: "plateau-way", verb: "inspect" },
      { type: "interact", entity: "sit-stone", verb: "use" },
      // Three breaths on the stone: the rotor comes up out of the valley, it is still out there, and then it goes over.
      { type: "wait" }, { wait: 400 },
      { type: "wait" }, { wait: 400 },
      { type: "wait" }, { wait: 900 },
      { type: "phone:open", tab: "messages" }, { type: "phone:send", contact: "mama", kind: "text", text: "到顶了" }, { wait: 2200 }, { type: "phone:close" },
      { type: "pack:open" },
      { type: "item:use", item: "camera360" },
      { type: "pack:close" },
      { type: "hold:start", entity: "selfie" },
      { wait: 3400 },
      { type: "hold:end" },
      { type: "wait" },
      { type: "travel", entity: "go" },
    ],
    back: [
      { type: "travel", entity: "back" },
    ],
  },
});
