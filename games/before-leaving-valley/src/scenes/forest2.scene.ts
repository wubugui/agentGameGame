/* 森林小路下段，21:35。比上面陡，抓手更少，光圈已经发黄：一根巨大的倒木斜着压过小路，断口炸开在左边，
   树根从右上的土里翻出来，路面上横着几条被踩白的根，再往下是长满苔藓的土坎和几块青石。
   引擎声从左下方一直传上来；透过树缝，下面山谷里有一小片橙色的光——那就是它。四个把手，每一个在
   光束里只有两个选择（比上面那段少一个抓手，每一格也更贵）：树根（快，只用手）、岩石（慢而稳）、
   倒木（最快，最费手，累了它会动）。走完第三个把手，口袋里滑出去一样东西。
   坐标读自 15-forest-2 的 150°×84° 网格（yaw = (x/W − .5)·150，pitch = (.5 − y/H)·84，W×H = 1280×720）。 */
import type { Ambience } from "../soundscape";
import { all, flag, not } from "../engine/condition";
import type { Condition } from "../engine/condition";
import { defineScene, type WalkStep } from "../engine/scene";
import type { EntityDef } from "../engine/entity";
import type { Transform } from "../engine/types";
import { blaze, goArrow, wrongWay } from "./_shared";

const STEP = "forest2.step";
const CERTAIN = "forest2.certain";
const TESTED = "forest2.logTested";
const ROAD = "forest2.roadSeen";
const LOOKED = "forest2.lookedDown";
const WRONG = "forest2.wrong";
const TOTAL = 4;
const PHONE_STEP = 3;              // 走完第三个把手（v4 §7）
const ROLL_FATIGUE = 0.5;          // 倒木在这之上会动
const LOST_MINUTES = 20;           // 夜森林没认记号（v4 §3.5）
const PHONE_LOST_AT = 21 * 60 + 50;
/* 公路就在下面，比 forest1（0.12）近一段：引擎声一直在，压在左下角。玩家是先听见，才转过头去（v4 §3.8）。 */
const ROAD_ENGINE = 0.18;
const ROAD_NEAR = 0.32;            // 视线真正落到那片光上时，它涨一档再落回来
/* 补光灯的光圈直接乘进这个基数：宽光 22×0.55×1.15 ≈ 13.9°，窄光落回 11° 下限（v4 §3.4）。 */
const HOLD_REVEAL = 22;

type Kind = "root" | "rock" | "log";
type Hold = { id: string; step: number; kind: Kind; label: string; t: Transform; sprite?: string; sizeVh?: number };

/* 每一个把手都压在画里那样东西上。八个抓手：比上面那段（forest1 九个）少一个，每一步只在两样东西里选（v4 §8「更陡，抓手更少」）。 */
const HOLDS: Hold[] = [
  { id: "f2-log", step: 0, kind: "log", label: "倒木", t: { yaw: 26, pitch: 5, distance: 9 } },                 // 树身跨过小路的那一段（x≈862, y≈317）
  { id: "f2-root-a", step: 0, kind: "root", label: "翻出来的树根", t: { yaw: 38, pitch: -7, distance: 9 } },     // 根盘垂下来的那条粗根，往里收进 ±40°（x≈964, y≈420）
  { id: "f2-stump", step: 1, kind: "log", label: "倒木的断口", t: { yaw: -6, pitch: -12, distance: 9 } },        // 炸开的木茬（x≈589, y≈463）
  { id: "f2-bank", step: 1, kind: "rock", label: "苔藓土坎", t: { yaw: -17, pitch: -22, distance: 8 } },         // 断口下面的苔藓土脊（x≈495, y≈549）
  { id: "f2-root-c", step: 2, kind: "root", label: "横在路上的根", t: { yaw: 18, pitch: -26, distance: 8 }, sprite: "sprites/root-arch-night.webp", sizeVh: 8 },  // 横穿路面被踩白的树根（x≈794, y≈583）
  { id: "f2-rock-c", step: 2, kind: "rock", label: "路边的石头", t: { yaw: 5, pitch: -20, distance: 8 }, sprite: "sprites/rock-step-night.webp", sizeVh: 7 },    // 小路左沿的碎石（x≈683, y≈531）
  { id: "f2-root-d", step: 3, kind: "root", label: "大树的板根", t: { yaw: -38, pitch: -22, distance: 8 }, sprite: "sprites/root-arch-night.webp", sizeVh: 11 }, // 近处大树铺开的苔藓板根（x≈316, y≈549）
  { id: "f2-rock-d", step: 3, kind: "rock", label: "青石", t: { yaw: -7, pitch: -28, distance: 8 }, sprite: "sprites/rock-step-night.webp", sizeVh: 9 },         // 路左的青石堆（x≈580, y≈600）
];

/* 比 forest1（log 4/.08、root 5/.06、rock 8/.02）每一格都更贵——这一段更陡。三种代价互不支配：
   倒木最快最费手，树根居中，石头最慢最省手。 */
const COST: Record<Kind, { minutes: number; fatigue: number }> = {
  root: { minutes: 6, fatigue: 0.06 },
  rock: { minutes: 9, fatigue: 0.03 },
  log: { minutes: 5, fatigue: 0.09 },
};
const BASE_MS = [900, 1000, 1100, 1200];
const MS_SCALE: Record<Kind, number> = { root: 1, rock: 1.3, log: 0.8 };

const LOG_BODY: Transform = { yaw: 16, pitch: 0, distance: 9 };     // 倒木离她最近的一段（x≈777, y≈360）
const LIGHTS: Transform = { yaw: -27, pitch: -3, distance: 40 };     // 树缝里山谷的灯（x≈410, y≈386）
const rolled = (step: number) => `forest2.rolled.${step}`;
const atStep = (n: number): Condition => (n === 0 ? flag(STEP, { lt: 1 }) : all(flag(STEP, { gte: n }), flag(STEP, { lt: n + 1 })));
const liveAt = (h: Hold): Condition => (h.kind === "log" ? all(atStep(h.step), not(flag(rolled(h.step)))) : atStep(h.step));

const holdEntity = (h: Hold): EntityDef => ({
  id: h.id, transform: h.t, className: "hold-hotspot",
  ...(h.sprite ? { sprite: { src: h.sprite, layer: "prop" as const, sizeVh: h.sizeVh } } : {}),
  interactable: { verbs: ["hold"], label: h.label, reveal: HOLD_REVEAL, cost: COST[h.kind], requires: liveAt(h) },
  hold: { ms: Math.round(BASE_MS[h.step] * MS_SCALE[h.kind]), scaleWith: ["fear", "fatigue", "lamp"] },
  visible: liveAt(h),
});

/* 回放用的按住。到这一场的时候 fatigue/fear 已经接近 1，按住时长要乘 (1 + fear·0.9 + fatigue·0.6) = 2.5，
   所以下面每个 wait 都不小于 hold.ms × 2.5 + 300：
   log 720/800/880/960 → 2100/2300/2500/2700；root 900/1000/1100/1200 → 3150/3400；rock 1170/1300/1430/1560 → 3550/3875/4200。
   多等是免费的：按住到时会自己完成，之后的 hold:end 是空操作。 */
const grab = (entity: string, wait: number): WalkStep[] => [{ type: "hold:start", entity }, { wait }, { type: "hold:end" }, { wait: 200 }];

export default defineScene({
  id: "forest2",
  day: 1, place: "森林小路 · 下段", elevation: "1,780 m",
  painting: "pano/15-forest-2.webp",
  body: "crawl", material: "soft",
  ambience: { wind: 0.3, windTone: 560, birds: 0, crickets: 0.6, stream: 0, engine: ROAD_ENGINE, heater: 0 },
  weather: { motes: "night", windPan: -0.4 },
  arriveAt: 21 * 60 + 35,
  fallback: "只能手脚一起用。",
  exitWhen: flag(STEP, { gte: TOTAL }),
  entities: [
    ...HOLDS.map(holdEntity),
    // 上手之前先用手压一压那根木头。一分钟，换掉它会不会动。
    { id: "log-test", transform: LOG_BODY,
      interactable: { verbs: ["inspect"], label: "压一压倒木", reveal: HOLD_REVEAL, cost: { minutes: 0 }, once: true },
      visible: all(flag(STEP, { lt: 2 }), not(flag(TESTED))) },
    // 树缝里，下面山谷的一小片光。
    { id: "valley-lights", transform: LIGHTS, gaze: { radius: 13, dwell: 900 },
      interactable: { verbs: ["inspect", "photograph"], label: "下面的灯", reveal: 12, cost: { minutes: 0 } } },
    // 两处候选记号，都刷/长在树皮上：一处是小路右边那棵细树干上的红-白-红，一处是近处大树干上的旧树脂疤。
    // 两张精灵都是树皮上的一块记号（没有石头），同一轮廓、同一尺寸——凑近之前完全分不出来（v4 §3.5）。
    blaze("blaze-f2", { yaw: 11, pitch: 6, distance: 9 }, true, {
      sprite: { src: "sprites/blaze-656.webp", layer: "prop", sizeVh: 4 },
      interactable: { verbs: ["inspect"], label: "树干上的记号", reveal: 12, cost: { minutes: 1 } },
    }),
    blaze("moss-f2", { yaw: -33, pitch: -12, distance: 8 }, false, {
      sprite: { src: "sprites/blaze-false-bark.webp", layer: "prop", sizeVh: 4 },
      interactable: { verbs: ["inspect"], label: "树干上的记号", reveal: 12, cost: { minutes: 1 } },
    }),
    // 灯就在那几棵杉树后面，直着下去看起来近得多。八分钟，下面是一道下不去的坎。走过一次它就从画里退出去。
    wrongWay("wrong-slope", { yaw: -18, pitch: -12 }, "下面那几棵杉树", 8, "下不去。绕回来。", {
      visible: not(flag(WRONG)),
    }),
    goArrow("go", { yaw: 12, pitch: -33 }, { to: "hairpin", minutes: 70, label: "往下", kind: "walk" }),
  ],
  seed: (w) => {
    w.setFlag(STEP, TOTAL);
    w.setFlag(CERTAIN, true);
    w.setFlag(TESTED, true);
    w.setFlag(ROAD, true);
    w.setFlag(LOOKED, true);
    for (let i = 0; i < TOTAL; i += 1) w.setFlag(`forest2.style.${i}`, i === 0 ? "log" : "root");
    if (w.state.inventory.items.includes("phone")) w.emit("item:lose", { item: "phone", reason: "在森林里从口袋滑出去" });
    w.setFlag("phone.lost", true);
    w.setFlag("phone.lostAt", PHONE_LOST_AT);
  },
  script: (ctx) => {
    const w = ctx.world;
    const step = () => w.flag<number>(STEP, 0);
    const narrow = () => w.state.power.lampMode === "narrow";
    const fearUp = (base: number) => base * (narrow() ? 1.4 : 1);     // 窄光：四周全黑，心跳涨得快（v4 §3.4）
    const pan = (t: Transform) => Math.max(-1, Math.min(1, t.yaw / 60));

    /* 本场自己的环境声层。公路的引擎声是底噪的一部分（ROAD_ENGINE，比上面那段更响），
       视线落到那片光上时它涨一档再落回来——不是第一次被引入。 */
    const pulseAmb = (next: Partial<Ambience>, ms: number) => {
      w.emit("ambience", { overrides: next });
      ctx.after(ms, () => w.emit("ambience", { overrides: {} }));
    };

    // --- 一个把手。倒木最快，但在累坏的身体下面它会自己动一下：四分钟，然后这一步只剩别的抓手。 ---
    const advance = (h: Hold) => {
      const here = step();
      if (here !== h.step || here >= TOTAL) return;
      if (h.kind === "log" && !ctx.flag(TESTED, false) && w.state.body.fatigue >= ROLL_FATIGUE) {
        ctx.setFlag(rolled(here), true);
        w.emit("body:slip", { entity: h.id, severity: 1 });
        ctx.sfx("thud", pan(h.t), 1); ctx.sfx("slide", pan(h.t), 0.8);
        ctx.kick("jolt", 1.2, { yaw: 0, pitch: -8 });
        ctx.spend({ minutes: 4, fear: fearUp(0.08) }, "倒木动了一下");
        ctx.say("木头动了。", { tag: "f2-roll", priority: 1 });
        return;
      }
      const next = here + 1;
      ctx.setFlag(STEP, next);
      ctx.setFlag(`forest2.style.${here}`, h.kind);
      ctx.hand(h.t, "grip", true);
      ctx.sfx(h.kind === "rock" ? "grip" : "step", pan(h.t), h.kind === "log" ? 1 : 0.8);
      ctx.kick(h.kind === "log" ? "step" : "pull", h.kind === "rock" ? 0.8 : 1.1);
      ctx.spend({ fear: fearUp(0.16) }, "又一个把手");
      // 第三个把手走完：口袋里滑出去一样东西。没有音效提示，没有文字，只有一次极轻的布料声。
      if (next === PHONE_STEP && w.state.inventory.items.includes("phone")) {
        ctx.lose("phone", "在森林里从口袋滑出去");
        ctx.sfx("cloth", -0.25, 0.12);
      }
      if (next >= TOTAL) { w.emit("body:rest", { seconds: 4 }); ctx.sfx("exhale", 0, 0.7); ctx.kick("settle", 1); }
    };
    // 松手：五秒，手抖一下，重新来。永远不会掉下去。
    const release = (h: Hold) => (progress: number) => {
      if (progress < 0.12) return;
      ctx.spend({ minutes: 0.1, fear: fearUp(0.08) }, "手松了");
      ctx.sfx("slide", pan(h.t), 0.6); ctx.kick("slip", 0.7, { yaw: 0, pitch: -6 });
      ctx.say("手松了。再来。", { tag: "f2-slip", priority: 1 });
    };
    for (const h of HOLDS) { ctx.onHold(h.id, () => advance(h)); ctx.onRelease(h.id, release(h)); }

    // --- 先压一压那根木头：手上有多松，身体自己知道。 ---
    ctx.onInteract("log-test", () => {
      ctx.setFlag(TESTED, true);
      ctx.spend({ minutes: 1 }, "压一压倒木");
      ctx.hand(LOG_BODY, "grip");
      ctx.sfx("thud", 0.15, 0.5); ctx.kick("settle", 0.6);
      if (w.state.body.fatigue >= ROLL_FATIGUE) { ctx.sfx("slide", 0.15, 0.3); ctx.kick("jolt", 0.4); }
    });

    // --- 记号。真的那处由本子结算（手、布擦声、心跳 −0.25）；假的多一分钟，一个手势。 ---
    ctx.on("blaze:confirm", ({ entity, real }) => {
      if (real) { ctx.kick("glance", 0.5, { yaw: 0, pitch: 2 }); ctx.sfx("step", 0, 0.35); return; }
      ctx.hand(ctx.transformOf(entity)); ctx.kick("glance", 0.4, { yaw: 0, pitch: 2 }); ctx.sfx("tock", -0.3, 0.5);
    });

    // --- 下面的灯。引擎声一直在左下角响着；视线真落上去的那一下，它涨一档，又落回去。 ---
    const seeRoad = () => {
      pulseAmb({ engine: ROAD_NEAR }, 900);
      if (ctx.flag(ROAD, false)) return false;
      ctx.setFlag(ROAD, true);
      return true;
    };
    ctx.onGaze("valley-lights", () => {
      if (!seeRoad()) return;
      ctx.kick("glance", 0.5, { yaw: -4, pitch: 2 }); ctx.sfx("breath", -0.5, 0.6);
      ctx.say("下面有光。", { tag: "f2-road" });
    });
    ctx.onInteract("valley-lights", (verb) => {
      if (verb === "photograph") {
        if (!w.state.inventory.items.includes("phone")) {
          ctx.hand({ yaw: 0, pitch: -30, distance: 8 }, "grip");
          ctx.kick("glance", 0.6, { yaw: 0, pitch: -6 }); ctx.sfx("cloth", 0, 0.35);
          return;
        }
        w.dispatch({ type: "phone:shoot" });
        ctx.setFlag("forest2.photo", true);
        ctx.kick("glance", 0.35, { yaw: -3, pitch: 1 });
        return;
      }
      seeRoad();
      // 第一次真的停在那片光上，心跳才会降下去一点。再看只是再花一分钟（v4 §6：各 1 分的一次性可看物）。
      const first = !ctx.flag(LOOKED, false);
      ctx.setFlag(LOOKED, true);
      ctx.spend(first ? { minutes: 1, fear: -0.08 } : { minutes: 1 }, "看下面的灯");
      ctx.kick("glance", 0.6, { yaw: -4, pitch: 2 }); ctx.sfx("breath", -0.5, 0.7);
    });

    // --- 那几棵杉树在灯的方向，直着下去八分钟，下面是一道坎。 ---
    ctx.onInteract("wrong-slope", () => {
      ctx.setFlag(WRONG, true);
      ctx.kick("step", 0.9); ctx.sfx("step", -0.5, 0.9); ctx.fx("dust", 0.25);
      w.emit("body:fatigue", { delta: 0.04, reason: "往灯的方向下了一段" });
      ctx.spend({ fear: fearUp(0.06) }, "黑下去的一段");
      ctx.after(700, () => { ctx.kick("turn", 0.7); ctx.sfx("step", -0.2, 0.6); });
      ctx.say("下不去。绕回来。", { tag: "f2-wrong" });
    });

    // --- 站着不动：腿在回，心跳在涨（光束停在一个地方超过八秒，v4 §3.3）。旁边什么都没有。 ---
    ctx.onWait(() => {
      ctx.spend({ fear: fearUp(0.05) }, "光束停在一个地方");
      ctx.sfx("heartbeat", 0, 0.35 + w.state.body.fear * 0.5);
      ctx.kick("settle", 0.25);
    });

    // --- 喊出去的那一声，山谷把它送回来一点。 ---
    ctx.on("fx", ({ name }) => {
      if (name !== "shout") return;
      ctx.kick("turn", 0.3);
      ctx.after(420, () => ctx.sfx("breath", 0.6, 0.3));
    });

    // --- 换咬法：光圈缩紧或摊开，脚下的一切跟着变。 ---
    ctx.on("lamp:mode", ({ mode }) => {
      ctx.sfx("tock", 0, 0.5); ctx.kick("settle", 0.4);
      ctx.fx("flashlight", mode === "narrow" ? 1 : 0.6);
    });

    // --- 离开：没有确认过记号的话，这一段黑林子里要多找二十分钟（v4 §3.5）。 ---
    ctx.on("travel:begin", ({ from, to }) => {
      if (from !== "forest2") return;
      w.emit("ambience", { overrides: {} });
      if (to !== "hairpin" || ctx.flag(CERTAIN, false)) return;
      ctx.spend({ minutes: LOST_MINUTES, fear: 0.1 }, "没认记号，在林子里找了一段");
      ctx.kick("turn", 0.5);
      ctx.say("走错了一小段。", { tag: "f2-lost", priority: 1 });
    });
  },
  /* 最快的合法路线。倒木是这一场最便宜的抓手（5 分），但十小时之后它会自己动一下——除非先花一分钟用手压过它
     （advance 里的 TESTED 分支）。1+5+5+6+6 = 23 分，比全走树根的 24 分快，也不再靠运气。 */
  walkthrough: [
    { type: "interact", entity: "log-test", verb: "inspect" }, { wait: 400 },
    { type: "interact", entity: "blaze-f2", verb: "inspect" }, { wait: 400 },
    ...grab("f2-log", 2400),
    ...grab("f2-stump", 2600),
    ...grab("f2-root-c", 3300),
    ...grab("f2-root-d", 3500),
    { type: "travel", entity: "go" },
  ],
  variants: {
    // 一处记号都不认：出林子的时候多二十分钟。
    blind: [
      { type: "interact", entity: "log-test", verb: "inspect" }, { wait: 400 },
      ...grab("f2-log", 2400), ...grab("f2-stump", 2600), ...grab("f2-root-c", 3300), ...grab("f2-root-d", 3500),
      { type: "travel", entity: "go" },
    ],
    // 朝灯的方向下了一段，认错了一处旧疤，然后老老实实走石头。
    wrong: [
      { type: "interact", entity: "wrong-slope", verb: "inspect" }, { wait: 900 },
      { type: "interact", entity: "moss-f2", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "blaze-f2", verb: "inspect" }, { wait: 400 },
      ...grab("f2-root-a", 3200), ...grab("f2-bank", 3700), ...grab("f2-rock-c", 4000), ...grab("f2-rock-d", 4400),
      { type: "travel", entity: "go" },
    ],
    // 这片林子给的全部：压一压木头、看一眼下面的灯、拍一张、记号、慢的那条线。
    thorough: [
      { type: "interact", entity: "log-test", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "valley-lights", verb: "inspect" }, { wait: 400 },
      { type: "interact", entity: "valley-lights", verb: "photograph" }, { wait: 400 },
      { type: "interact", entity: "blaze-f2", verb: "inspect" }, { wait: 400 },
      ...grab("f2-root-a", 3000),
      { type: "wait" }, { wait: 600 },
      ...grab("f2-bank", 3700), ...grab("f2-rock-c", 4000), ...grab("f2-root-d", 3500),
      { type: "travel", entity: "go" },
    ],
  },
});
