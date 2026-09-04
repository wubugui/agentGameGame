/* The Pössnecker start: four plates on the rock, the cloth spread for the gear, the first cable. */
import { all, has, knows, not, worn } from "../engine/condition";
import { defineScene } from "../engine/scene";
import { blaze, goArrow, prop, readable } from "./_shared";

export default defineScene({
  id: "plaque",
  day: 1, place: "Pössnecker 飞拉达 · 起点", elevation: "2,340 m",
  painting: "pano/03-plaque.webp",
  body: "stand", material: "rock",
  ambience: { wind: 0.7, windTone: 1300, birds: 0.2, crickets: 0, stream: 0, engine: 0, heater: 0 },
  weather: { gusty: false },
  arriveAt: 10 * 60 + 25,
  fallback: "从这里开始，就是天然岩壁了。",
  entities: [
    readable("plate-name", { yaw: 14, pitch: 8 }, "铜牌", { kind: "plaque", title: "VIA FERRATA PÖSSNECKER", lines: ["Via ferrata Pössnecker", "Sez. Pössneck del D.u.Ö.A.V. · 1912", "Piz Selva 2941 m"], entry: "E-possnecker", minutes: 1 }),
    readable("plate-grade", { yaw: 20, pitch: 4 }, "第二块牌子", { kind: "plaque", title: "Difficoltà", lines: ["Difficoltà: C / D", "Tratto in fessura: II grado UIAA, non attrezzato", "Tenere sempre almeno un moschettone agganciato al cavo"], entry: "E-carabinerRule", minutes: 1 }),
    readable("plate-route", { yaw: 24, pitch: 10 }, "路线图", { kind: "plaque", title: "Schizzo", lines: ["起点 2,340 m → 出口 2,860 m → Piz Selva 2,941 m", "在路线图的尽头画着一个小小的十字架"], entry: "E-summit", minutes: 1 }),
    readable("plate-hut", { yaw: 22, pitch: -3 }, "玻璃下的告示", { kind: "note", title: "Rifugio Boè", lines: ["Rifugio Boè 2871 m · punto di appoggio", "Ricarica · pasti caldi · pernottamento", "Dal Piz Selva: 2 h 30"], entry: "E-hutTime", minutes: 1 }),
    prop("gear-cloth", { yaw: -18, pitch: -13, distance: 9 }, "sprites/gear.webp", 15, { visible: not(all(worn("helmet"), worn("lanyard"))), interactable: { verbs: ["use"], label: "背包", reveal: 12 } }),
    prop("cable-start", { yaw: 18, pitch: 5, distance: 9 }, "sprites/carabiner-pair.webp", 10, {
      interactable: { verbs: ["clip"], label: "钢缆起点", reveal: 12, cost: { minutes: 1 }, requires: all(worn("helmet"), worn("lanyard")) },
      visible: not({ kind: "flag", key: "plaque.clipped" }),
    }),
    blaze("blaze-plaque", { yaw: -24, pitch: -8 }, true),
    { id: "compare-note", transform: { yaw: 21, pitch: 0 }, interactable: { verbs: ["inspect"], label: "和备忘录对一眼", reveal: 12, cost: { minutes: 0.3 }, once: true }, visible: all(knows("E-grade"), knows("E-coach")) },
    goArrow("go", { yaw: 18, pitch: 10 }, { to: "cable", minutes: 5, label: "上墙", kind: "walk" }),
  ],
  exitWhen: { kind: "flag", key: "plaque.clipped" },
  seed: (w) => { w.patch("inventory", { worn: Array.from(new Set([...w.state.inventory.worn, "helmet", "lanyard", "gloves"])) as typeof w.state.inventory.worn }); w.setFlag("plaque.clipped", true); w.setFlag("plaque.certain", true); },
  script: (ctx) => {
    ctx.onInteract("gear-cloth", () => { ctx.open("pack"); });
    ctx.onInteract("cable-start", () => {
      ctx.setFlag("plaque.clipped", true);
      ctx.sfx("clink"); ctx.kick("clink"); ctx.hand(ctx.transformOf("cable-start"), "carabiner");
      ctx.say("两把锁扣，一蓝一橙，都挂上钢缆。", { tag: "plaque-clip" });
    });
    ctx.on("interact:done", ({ entity, verb }) => {
      if (entity === "plate-grade" && verb === "read") ctx.learn("E-grade");
    });
    ctx.onInteract("compare-note", () => { ctx.say("C 到 D。教练说的是 easy。", { tag: "plaque-compare", priority: 1 }); ctx.world.emit("body:rest", { seconds: 2 }); });
    ctx.on("item:equip", ({ item }) => {
      if (item === "helmet") ctx.say("白色的头盔。扣好带子。", { tag: "plaque-helmet" });
      if (item === "lanyard") ctx.sfx("clink");
      if (item === "gloves") ctx.say("手套。", { tag: "plaque-gloves" });
    });
    void has;
  },
});
