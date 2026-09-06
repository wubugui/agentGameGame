/* The Pössnecker start, 10:25. Four plates on the wall to the right (three bronze, one white sheet under glass),
   an older plate below them with its lettering gone, the first cable running up from the lower ring anchor past
   the plates to the two pegs where it goes over the edge, the gear on the gravel at her feet, the red paint on
   the pale rock below the cable, and the pass far behind her on the left.
   Coordinates read off the 150°×84° grid of 03-plaque (yaw = (x/W − .5)·150, pitch = (.5 − y/H)·84).
   Time: v4 §3.1 gives this node five minutes to the next one and puts `cable` at 10:30, and those five minutes are
   now spent where the engine actually spends them — four on the dressing it makes compulsory (pack open and close
   round 0.5 up to 1 each, helmet 1, lanyard 1) and one on stepping off the gravel onto the wall. The fastest legal
   line therefore leaves at 10:29 and opens `cable` at 10:30, exactly the baseline; everything else here (the four
   plates, the marks, the anchor, the two shots, the comparison) is optional and priced on top.

   THREE THINGS A READER SHOULD NOT HAVE TO REDERIVE:
   1. THE 360 SHUTTER TOUCHES THE PHONE'S ALBUM AND NOTHING ELSE OF THE PHONE'S. `shoot()` writes the picture with
      `phoneDispatch(capture_photo)` and then charges the 360 camera (1% of its own battery) and the minute. It is
      safe to write straight into the album because the reducer no longer owns power or time: phoneModel's
      capture_photo returns `{...state, photos}` and says so in a comment, and the phone's clock is moved only by
      ClockSystem (advanceClockOnly) and its battery only by PowerSystem. Verified on the machine after this round:
      four shots in a row leave `power.phone` and the lock-screen battery equal and unchanged, and worldClock and
      phoneClock equal (both +1 per shot, from the minute this scene spends). Do not "fix" this by re-routing the
      shot through `phone:shoot` — that is the phone raising itself, and it would charge the phone's 1% for a
      picture the 360 took.
   2. ② IS A PROMISE THE VIEW HAS NOT KEPT YET. `plate-grade` writes E-carabinerRule, and §6 prices missing it as
      「锁扣面板只显示颜色，不显示状态文字」 — but nothing in src/view reads that entry, and `cable` has no
      permanent carabiner panel at all. So today reading ② costs a minute and buys the journal line and nothing
      else. The panel is in this scene's `requests.engine/css`; the entry stays because the plate really does have
      that rule cast into it, not because the cost is delivered.
   3. THE PAINT ON THE FOREGROUND ROCK IS NOW ONLY IN THE SPRITE. 03-plaque used to carry an orange-red streak of
      its own under the cable, which broke §3.5's 「真假在凑近之前完全不可分辨」 in this one node; the painting has
      been cleaned of it and the mark is back to the shared 4 vh. See the note on `blaze-plaque` below. */
import { all, entityIs, flag, not, worn } from "../engine/condition";
import type { EntityDef } from "../engine/entity";
import { defineScene } from "../engine/scene";
import type { EntityId, Transform } from "../engine/types";
import { blaze, goArrow, prop, readable } from "./_shared";
import { phoneDispatch } from "../systems/UISystem";

/* A mark that stays on its stone after she has read it (v4 §3.5 / §3.8 memory ③): the paint keeps a very faint
   highlight until she leaves the node, and can no longer be pressed. `enabled: false` is what fades it
   (`.hotspot.is-disabled { opacity:.35 }`); the shared factory would delete it from the painting instead. */
const mark = (id: EntityId, transform: Transform, real: boolean, extra: Partial<EntityDef> = {}): EntityDef =>
  blaze(id, transform, real, { visible: undefined, enabled: not(entityIs(id, "read")), ...extra });

const BLUE = "plaque.blue", ORANGE = "plaque.orange", CLIPPED = "plaque.clipped", PULLED = "plaque.pulled";
const ANCHOR: Transform = { yaw: 13, pitch: -14 };                // the lower ring anchor the cable starts from (752, 482)
const CABLE_GO: Transform = { yaw: 23, pitch: 7 };                // on the cable between the orange carabiner and the upper ring (836, 300)
const CABLE_TOP: Transform = { yaw: 17, pitch: 20 };              // the two pegs where the cable goes over the edge (770–803, 165–193)
const PASS: Transform = { yaw: -58, pitch: 3, distance: 30 };     // the meadow and the pass, far left behind her (145, 334)
const GEAR: Transform = { yaw: -22, pitch: -33 };                 // the gravel and white stones at her feet (452, 643)
const dressed = all(worn("helmet"), worn("lanyard"));

export default defineScene({
  id: "plaque",
  day: 1, place: "Pössnecker 飞拉达 · 起点", elevation: "2,340 m",
  painting: "pano/03-plaque.webp",
  body: "stand", material: "rock",
  ambience: { wind: 0.7, windTone: 1300, birds: 0.2, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { gusty: false },
  arriveAt: 10 * 60 + 25,
  fallback: "从这里开始，就是天然岩壁了。",
  // v4 §8: helmet && clipped. Clipping needs the lanyard, the lanyard needs the helmet; the helmet has to stay on.
  exitWhen: all(worn("helmet"), flag(CLIPPED)),
  entities: [
    // The four plates (v4 §6): ① name and 1912, ② grade and the rule, ③ the sketch and 2941 m, ④ the white sheet under glass.
    readable("plate-name", { yaw: 33, pitch: 11 }, "铜牌", {                       // top-left bronze plate with the badge (918, 263)
      kind: "plaque", title: "VIA FERRATA PÖSSNECKER",
      lines: ["Via ferrata Pössnecker (Mesules)", "1912", "Piz Selva 2941 m"],
      entry: "E-possnecker", minutes: 1,
    }),
    readable("plate-grade", { yaw: 41, pitch: 11 }, "第二块牌子", {                 // top-right bronze plate, the wide one (990, 265)
      kind: "plaque", title: "Difficoltà",
      lines: ["Difficoltà: C / D", "Tratto in fessura: II grado UIAA, non attrezzato", "Tenere sempre almeno un moschettone agganciato al cavo"],
      entry: "E-carabinerRule", minutes: 1,
    }),
    // ③ is a sketch of the route with the summit on it. The other three plates carry what is cast into them, and
    // this one used to carry a description of the drawing instead — narration wearing a plate's clothes, in the one
    // overlay where every line is supposed to be something she can point at. It now says what a plate like this has
    // stamped on it and nothing else; the line itself is on the plate, for her to look at.
    readable("plate-route", { yaw: 33, pitch: 7 }, "路线图", {                     // bronze plate under ① (918, 300)
      kind: "plaque", title: "Schizzo dell'itinerario",
      // What is stamped along the drawn line and nowhere else on this wall: the route's number, the summit it ends
      // at, and the refuge the line runs on to across the plateau. The previous two lines were both already cast
      // into ① — a minute spent reading a plate should not be a minute spent reading the first plate again.
      lines: ["649", "Piz Selva 2941 m", "Rifugio Boè"],
      entry: "E-summit", minutes: 1,
    }),
    readable("plate-hut", { yaw: 38, pitch: 1.5 }, "玻璃下的告示", {               // the white sheet under glass (963, 347)
      kind: "note", title: "Rifugio Boè",
      lines: ["Rifugio Boè · punto di appoggio", "Ricarica · pasti caldi · pernottamento", "Dall'altopiano: 2 h 30"],
      entry: "E-hutTime", minutes: 1,
    }),
    // The fifth plate, lower and alone: two bolts and a streak of rust, the lettering worn flat. Scenery only.
    { id: "plate-old", transform: { yaw: 26, pitch: 0 },                             // (862, 363)
      interactable: { verbs: ["inspect"], label: "旧牌子", reveal: 12, cost: { minutes: 0 } } },
    // The lower anchor: where the cable starts. She can take hold of it and pull — the cable answers, nothing more.
    // One minute, once: after she has felt it hold, her hand goes out and comes back (hold:start honours `requires`).
    { id: "anchor-start", transform: ANCHOR, className: "hold-hotspot",
      interactable: { verbs: ["hold"], label: "钢缆起点", reveal: 13, cost: { minutes: 1 }, requires: not(flag(PULLED)) },
      hold: { ms: 500, scaleWith: ["fatigue"] } },
    // The two carabiners, hanging on the cable above the anchor. They only appear once helmet and lanyard are on (v4 §4: she would not go to clip otherwise).
    { id: "carabiner-blue", transform: { yaw: 15, pitch: -10.5 },                    // on the cable just above the ring (768, 450)
      sprite: { src: "sprites/carabiner-blue.webp", layer: "hand", sizeVh: 6 }, className: "carabiner-hotspot",
      interactable: { verbs: ["clip"], label: "蓝锁", reveal: 14, cost: { minutes: 0 }, requires: dressed }, visible: dressed, enabled: not(flag(BLUE)) },
    { id: "carabiner-orange", transform: { yaw: 19, pitch: -2.5 },                   // on the cable halfway to the plates (802, 381)
      sprite: { src: "sprites/carabiner-orange.webp", layer: "hand", sizeVh: 6 }, className: "carabiner-hotspot",
      interactable: { verbs: ["clip"], label: "橙锁", reveal: 14, cost: { minutes: 0 }, requires: dressed }, visible: dressed, enabled: not(flag(ORANGE)) },
    // The gear on the gravel at her feet. Opens the cloth; gone from the ground once helmet and lanyard are on her.
    prop("gear-cloth", GEAR, "sprites/gear.webp", 16, {
      interactable: { verbs: ["use"], label: "装备", reveal: 14, cost: { minutes: 0 } },
      visible: not(dressed),
    }),
    /* Two candidate marks: the red paint on the pale rock below the cable, and the crustose lichen on the slab
       above it. This wall used to be the one place in this group where §0.4 was broken by the picture itself and
       not by the scene — 03-plaque had an orange-red streak burnt into the foreground rock, so the true mark sat
       on a painted blob and the false one on bare stone and the two were told apart from across the node. Both
       halves of that red line have now landed (docs/ART_QUEUE.md): the painting has been cleaned of the streak,
       so the paint IS the sprite again and this mark takes the shared 4 vh; and blaze-false.webp has been
       repainted as a mineral stain in the same three bands and the same footprint as blaze-red-white.webp, so
       nothing separates a candidate mark from a real one until she is close enough to look at it. */
    mark("blaze-plaque", { yaw: 3.7, pitch: -32 }, true),                            // the pale rock below the cable (672, 634)
    mark("lichen-plaque", { yaw: 5.5, pitch: 13.5 }, false),                         // the lichened patch on the slab (687, 243); sprites/blaze-false.webp is orange-grey, so her line names no colour
    // Where the cable goes over the edge, and the pass behind her. Looking is free (gaze); a 360 shot costs a
    // minute, or three from the pack. All of that is charged inside shoot(): the minute, the camera's 1%, and the
    // two extra minutes for digging it out. Nothing here goes through the phone (see shoot()).
    { id: "cable-up", transform: { ...CABLE_TOP, distance: 14 }, interactable: { verbs: ["photograph"], label: "往上的钢缆", reveal: 14, cost: { minutes: 0 } }, gaze: { radius: 12, dwell: 900 } },
    { id: "pass-view", transform: PASS, interactable: { verbs: ["photograph"], label: "山口草甸", reveal: 14, cost: { minutes: 0 } }, gaze: { radius: 12, dwell: 900 } },
    // Up onto the wall: one minute of the five §3.1 gives this leg — the other four are the dressing above it.
    goArrow("go", CABLE_GO, { to: "cable", minutes: 1, label: "上墙", kind: "walk" }),
  ],
  seed: (w) => {
    w.patch("inventory", { worn: Array.from(new Set([...w.state.inventory.worn, "helmet", "lanyard", "gloves"])) as typeof w.state.inventory.worn });
    w.setFlag(BLUE, true); w.setFlag(ORANGE, true); w.setFlag(CLIPPED, true); w.setFlag("plaque.certain", true);
    // What the plates give downstream: the rule for the cable's carabiner panel, the hut leg for the map on the plateau edge.
    w.patch("journal", {
      entries: Array.from(new Set([...w.state.journal.entries, "E-carabinerRule", "E-hutTime"])),
      mapLegs: { ...w.state.journal.mapLegs, toHut: 2.5 },
    });
  },
  walkthrough: [
    { type: "pack:open" },
    { type: "pack:equip", item: "helmet" },
    { type: "pack:equip", item: "lanyard" },
    { type: "pack:close" },
    { wait: 300 },
    { type: "interact", entity: "carabiner-blue", verb: "clip" },
    { wait: 300 },
    { type: "interact", entity: "carabiner-orange", verb: "clip" },
    { wait: 300 },
    { type: "travel", entity: "go" },
  ],
  variants: {
    // Everything the start offers: gloves and the camera on the strap, the mark, all four plates, the memo beside the grade, the cable in her hand, two shots.
    thorough: [
      { type: "pack:open" },
      { type: "pack:equip", item: "helmet" },
      { type: "pack:equip", item: "lanyard" },
      { type: "pack:equip", item: "gloves" },
      { type: "pack:equip", item: "camera360" },
      { type: "pack:close" },
      { type: "interact", entity: "blaze-plaque", verb: "inspect" },
      { type: "interact", entity: "plate-name", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "plate-grade", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "plate-route", verb: "read" }, { type: "overlay:close" },
      { type: "interact", entity: "plate-hut", verb: "read" }, { type: "overlay:close" },
      { type: "phone:open", tab: "conversation" }, { type: "ui:action", id: "phone:tab", value: "conversation" }, { type: "phone:close" },
      { type: "hold:start", entity: "anchor-start" }, { wait: 1600 }, { type: "hold:end" },
      { type: "interact", entity: "pass-view", verb: "photograph" },
      { type: "interact", entity: "cable-up", verb: "photograph" },
      { type: "interact", entity: "carabiner-blue", verb: "clip" },
      { type: "interact", entity: "carabiner-orange", verb: "clip" },
      { type: "travel", entity: "go" },
    ],
    // The wrong order: lanyard before helmet (her hand comes back), the lichen for a mark, the camera left in the pack.
    fumble: [
      { type: "pack:open" },
      { type: "pack:equip", item: "lanyard" },
      { type: "pack:equip", item: "helmet" },
      { type: "pack:equip", item: "lanyard" },
      { type: "pack:close" },
      { type: "interact", entity: "lichen-plaque", verb: "inspect" },
      { type: "interact", entity: "pass-view", verb: "photograph" },
      { type: "interact", entity: "carabiner-orange", verb: "clip" },
      { type: "interact", entity: "carabiner-blue", verb: "clip" },
      { type: "travel", entity: "go" },
    ],
  },
  script: (ctx) => {
    const inv = () => ctx.world.state.inventory;
    const glance = (pitch: number, strength = 0.4) => ctx.kick("glance", strength, { yaw: 0, pitch });

    // Reading a plate: her hand goes to it, the camera dips. The plates themselves say everything; she says nothing.
    for (const id of ["plate-name", "plate-grade", "plate-route", "plate-hut"]) {
      ctx.onInteract(id, (verb) => {
        if (verb !== "read") return;
        ctx.hand(ctx.transformOf(id)); glance(2, 0.3);
        if (id === "plate-grade") ctx.learn("E-grade", id);
        if (id === "plate-hut") ctx.learn("E-hut", id);
      });
    }
    // The old plate: she wipes it, there is nothing left to read.
    ctx.onInteract("plate-old", () => { ctx.hand(ctx.transformOf("plate-old")); ctx.sfx("cloth", 0.3, 0.5); glance(-1, 0.3); });
    // The anchor: a hand on the cable, a pull, and the cable answers off the rock. Letting go early is just a hand coming back.
    ctx.onHold("anchor-start", () => {
      ctx.hand(ANCHOR, "grip", true); ctx.kick("pull", 0.6); ctx.sfx("clink", 0.2, 0.5);
      ctx.bump("plaque.pulled", 1);
    });
    ctx.onRelease("anchor-start", (progress) => { if (progress > 0.2) { ctx.sfx("tock", 0.2, 0.3); glance(-2, 0.3); } });

    // The gear: her hand goes down to it and the cloth opens. Dressing is the pack's business (helmet before lanyard, else her hand comes back — no text).
    ctx.onInteract("gear-cloth", () => {
      ctx.hand(GEAR, "grip"); glance(-5, 0.5);
      ctx.world.dispatch({ type: "pack:open" });
    });
    ctx.on("item:equip", ({ item }) => {
      if (ctx.world.state.sceneId !== "plaque") return;
      if (item === "helmet") { ctx.kick("settle", 0.6); ctx.sfx("tick", 0, 0.5); }
      if (item === "lanyard") { ctx.hand({ yaw: 0, pitch: -18 }, "carabiner"); ctx.kick("clink", 0.5); }
      if (item === "gloves") { ctx.hand({ yaw: 4, pitch: -16 }, "grip"); ctx.kick("settle", 0.3); }
      if (item === "camera360") { ctx.setFlag("plaque.cameraOnStrap", true); ctx.sfx("clink", -0.3, 0.4); ctx.kick("clink", 0.3); }
    });

    // The two carabiners. Each one is a clink and a hand; the second closes the scene's gate.
    const clip = (which: string, id: EntityId) => {
      if (ctx.flag(which, false)) return;
      ctx.setFlag(which, true);
      ctx.sfx("clink", 0.25); ctx.kick("clink"); ctx.hand(ctx.transformOf(id), "carabiner");
      if (ctx.flag(BLUE, false) && ctx.flag(ORANGE, false)) {
        ctx.setFlag(CLIPPED, true);
        ctx.kick("settle", 0.5);
        ctx.say("两把锁都在缆上了。", { tag: "plaque-clipped" });
      }
    };
    ctx.onInteract("carabiner-blue", () => clip(BLUE, "carabiner-blue"));
    ctx.onInteract("carabiner-orange", () => clip(ORANGE, "carabiner-orange"));

    // The marks. The real one is settled by the journal (hand, cloth, the lesson if it is her first); the lichen costs a minute.
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (entity === "blaze-plaque" && real) { glance(-3, 0.5); ctx.sfx("step", 0.1, 0.4); return; }
      if (entity === "lichen-plaque") { ctx.hand(ctx.transformOf(entity)); glance(2, 0.4); ctx.say("地衣。不是漆。", { tag: "plaque-lichen" }); }
    });

    // Looking up the cable and back at the pass: free, and she only breathes at one of them.
    ctx.onGaze("cable-up", () => {
      if (ctx.flag("plaque.lookedUp", false)) return;
      ctx.setFlag("plaque.lookedUp", true);
      ctx.sfx("exhale", 0.1, 0.6); glance(3, 0.5);
    });
    ctx.onGaze("pass-view", () => {
      if (ctx.flag("plaque.lookedBack", false)) return;
      ctx.setFlag("plaque.lookedBack", true);
      ctx.sfx("breath", -0.5, 0.5); ctx.kick("turn", 0.4, { yaw: -1, pitch: 0 });
      ctx.say("山口已经在下面了。", { tag: "plaque-back" });
    });
    /* A 360 shot: one minute with the camera on the strap, three if it has to come out of the pack (v4 §7).
       It is the 360 camera that takes it, so it is the 360 camera that pays: one percent of its own battery and
       the minute, and the picture goes into the album by hand. It used to go out through `phone:shoot`, which is
       the phone raising itself — a second percent off the phone for a photograph the phone did not take. The phone
       battery is spent on the phone's own shutter, and one of those (the letter at `mailbox`) is an invariant. */
    const shoot = (id: EntityId) => {
      if (!inv().hands.includes("camera360")) { ctx.spend({ minutes: 2 }, "从包里翻出相机"); ctx.sfx("zip", 0, 0.6); glance(-6, 0.5); }
      const st = ctx.world.state;
      phoneDispatch(ctx.world, { type: "capture_photo", photo: {
        asset: "pano/03-plaque.webp", title: "Pössnecker 飞拉达 · 起点", place: "Pössnecker 飞拉达 · 起点",
        position: { x: st.camera.aimX, y: st.camera.aimY }, zoom: st.camera.zoom, day: 1,
      } });
      ctx.spend({ camera: 1, minutes: 1 }, "全景相机");
      ctx.sfx("shutter");
      ctx.kick("glance", 0.35, { yaw: 0, pitch: id === "cable-up" ? 3 : -1 });
      ctx.bump("plaque.shots", 1);
    };
    ctx.onInteract("cable-up", (verb) => { if (verb === "photograph") shoot("cable-up"); });
    ctx.onInteract("pass-view", (verb) => { if (verb === "photograph") shoot("pass-view"); });

    // The grade beside the memo: her one hesitation. A line, a breath, twenty seconds. Nothing else happens; she does not turn round.
    const compare = () => {
      if (ctx.flag("plaque.compared", false)) return;
      const entries = ctx.world.state.journal.entries;
      if (!entries.includes("E-grade") || !entries.includes("E-coach")) return;
      ctx.setFlag("plaque.compared", true);
      ctx.spend({ minutes: 1 }, "把 C/D 和备忘录并排看了一眼");         // v4 §6 prices it at 1 分（ClockSystem 会把 <0.5 直接丢掉）
      ctx.world.emit("body:rest", { seconds: 2 });
      ctx.kick("settle", 0.5); ctx.sfx("exhale", 0, 0.7);
      // The grade is on the plate and the coach's line is in the memo; she reads neither of them out (v4 §10.2.4).
      // All this line carries is the hesitation itself.
      ctx.say("跟我以为的不太一样。", { tag: "plaque-compare", priority: 1 });
    };
    ctx.on("journal:entry", ({ entry }) => { if (entry === "E-grade" || entry === "E-coach") compare(); });
    ctx.onAction("phone:tab", (value) => { if (value === "conversation") compare(); });

    // Standing still under the start: once, the cable ticks against the rock off to the right, and a gust comes down.
    ctx.onWait(() => {
      if (ctx.flag("plaque.stillness", false)) return;
      ctx.setFlag("plaque.stillness", true);
      ctx.sfx("clink", 0.45, 0.3); ctx.fx("gust", 0.4); ctx.kick("turn", 0.3, { yaw: 1, pitch: 0 });
    });
  },
});
