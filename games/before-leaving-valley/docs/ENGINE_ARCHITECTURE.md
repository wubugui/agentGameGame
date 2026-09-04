# 《离开山谷以前》引擎架构

状态：**PROPOSED**（2026-09-04）
适用范围：`games/before-leaving-valley` 的全部运行时代码。
上位文件：`docs/SOURCE_TRANSCRIPT.md`（事实）> `docs/DESIGN_LOCK.md`（形式）> `docs/GAME_DESIGN_v4.md`（系统与节点）> 本文件（怎么实现）。
本文件不改任何设计，只回答一件事：**这些系统应该住在什么结构里，才能一直加下去而不塌。**

---

## 0 现在的问题（诊断，不是抱怨）

`src/App.tsx` 1275 行，是一张网页而不是一个游戏：

| 症状 | 证据 | 后果 |
|---|---|---|
| 状态全在 React | 30 余个 `useState` + 1 个 `useReducer`，`flags` 是一个 40 字段的扁平对象 | 任何系统都必须挂到组件生命周期上；无法脱离浏览器跑一遍剧情 |
| 机制内联在 JSX | `carabinerAction` / `grabHold` / `takeScreeStep` / `chooseArm` 全是组件内闭包，热点写死在 `return` 里的 `{node === "cable" && ...}` | 新增一个节点＝改一个 1200 行文件的三个不同位置；两个节点无法共用一条机制 |
| 分支表 | `isReady()`、`completeNode()` 两个 23 分支 `switch`，与 JSX 里的节点判断三处重复 | 加一个节点要同时改三处，漏一处就是 QA 报告里那类缺陷 |
| 时间靠 `setTimeout` | `schedule()` / `entryTimersRef` / `timersRef`，剧情节拍由计时器推进 | 与 v4 §3.8"干掉用 setTimeout 推剧情"直接冲突；隐藏 tab 下时序错乱（`tools/autoplay.js` 不得不劫持 `requestAnimationFrame`） |
| 派生量当成状态存 | `dusk` 由 `nodeSeconds` 算——站着不动天就会黑 | v4 §3.1 点名的缺陷 D1。派生量没有唯一来源 |
| 表现与规则耦合 | 音效、镜头冲量、说话、状态推进写在同一个函数里 | 想复用"过一个锚点"这条规则做别的节点，会连着把音效一起搬过去 |

v4 §F2 已经写死了顺序：**先拆，再加系统**。本文件就是那一拆的图纸。

---

## 1 分层：四层，一个方向

```
                       ┌───────────────────────────────────────┐
   玩家输入 ──────────▶ │  view/  (React)                        │
                       │  只做三件事：把 state 画出来、           │
                       │  把点击变成 Command、把高频量写进 DOM     │
                       └───────────────┬───────────────────────┘
                                       │ world.dispatch(Command)
                                       ▼
   ┌───────────────────────────────────────────────────────────┐
   │  engine/   World = GameState（可序列化） + EventBus + Runtime │
   │            没有 import React，没有 import three            │
   └───────┬───────────────────────────────────┬───────────────┘
           │ bus.emit / world.tick(dt)          │ 读写 state
           ▼                                    ▼
   ┌────────────────────┐            ┌──────────────────────────┐
   │  systems/          │            │  scenes/                  │
   │  横向规则：钟、光、  │◀──事件───▶│  纵向剧情：一个节点一个文件 │
   │  体力、心跳、电、   │            │  = 实体数据 + 一段脚本      │
   │  交互、背包、本子、 │            └──────────────────────────┘
   │  存档、音、镜头      │
   └────────────────────┘
```

四条铁律：

1. **World 不认识 React，也不认识 three。** `src/engine` 与 `src/systems/core` 里出现 `import ... from "react"` 一律视为 bug。这条铁律换来的是：整段剧情可以在 Node 里跑完（见 §9.3）。
2. **单向数据流。** View → `dispatch(Command)` → System 改 state → 通知订阅者 → View 重画。View 永远不直接改 state，Scene 脚本永远不直接改 DOM。
3. **高频量不进 React。** 视线、弹簧、按住进度、光照插值每帧都变，它们走 ref 与 CSS 变量直接写 DOM（`PanoStage` 今天已经这么做）。进 React 的只有粗粒度状态：当前场景、可见实体集合、背包、当前台词、overlay。
4. **数据说"有什么"，脚本说"发生什么"。** 实体、位置、可读文本、代价、条件是数据；一条机制的过程是 TypeScript。不做 effect 的数据 DSL——那会变成一门很差的编程语言。

---

## 2 文件布局

```
src/
  engine/                     ← 与平台无关的内核，可在 Node 里 import
    types.ts                  基础类型：Transform / Verb / Cost / Condition / Effect
    entity.ts                 EntityDef / EntityState / 组件类型 / EntityView
    world.ts                  World、GameState、set/patch/flag、dispatch、tick、subscribe
    bus.ts                    类型化事件总线（含重入队列与深度守卫）
    command.ts                Command 联合类型 + 校验
    condition.ts              Condition 求值器（纯函数，可单测）
    scene.ts                  SceneDef / defineScene / SceneCtx / 场景注册表
    registry.ts               SCENES、SCENE_ORDER、ITEMS、ENTRIES 的索引与校验
    loop.ts                   帧驱动：绑定到 PanoStage 的 rAF，或无头回退
    save.ts                   序列化 / 反序列化 / v4→v5 迁移
    dev.ts                    ?node= / ?time= / ?reveal= / warpTo / window.__world
    policy.ts                 DEV 期忠实性与叙事政策断言（见 §11）
    rng.ts                    带种子的随机（存档可复现，冒烟测试可复现）

  systems/
    index.ts                  coreSystems（无浏览器依赖）/ browserSystems（音、镜头、DOM）
    ClockSystem.ts            唯一时钟：分钟、日出日落、light 派生、定点事件
    InteractionSystem.ts      Command → 条件校验 → 代价结算 → interaction:done
    GazeSystem.ts             视线驻留、reveal 半径计算、gaze:dwell
    InventorySystem.ts        背包、穿戴、手上拿着什么
    JournalSystem.ts          本子 entry、纸地图、当前目标
    BodySystem.ts             fatigue / fear / breath / recover
    PowerSystem.ts            三块电：手机、相机、补光灯
    TriggerSystem.ts          场景触发器与环境记忆
    DialogueSystem.ts         台词队列、优先级、去重、显示时长（取代 say/flash 的散计时器）
    AudioSystem.ts            订阅事件 → Soundscape（不持有任何游戏状态）
    CameraBodySystem.ts       订阅事件 → PanoStage.kick / 阵风 / 呼吸
    SaveSystem.ts             静止时写档、进场景写档、退出写档

  scenes/
    index.ts                  按顺序 import 全部场景，产出 SCENES / SCENE_ORDER
    _shared.ts                跨节点复用的实体工厂：blaze()、goArrow()、readable()、restSpot()
    roadside.scene.ts
    meadow.scene.ts
    approach.scene.ts
    plaque.scene.ts
    cable.scene.ts            ← §7.1 完整示例
    crack.scene.ts
    slab.scene.ts
    mailbox.scene.ts
    exit.scene.ts
    summit.scene.ts
    plateau.scene.ts
    ledge.scene.ts
    hutView.scene.ts          ← §7.2 完整示例
    hutTurn.scene.ts
    signpost.scene.ts
    scree.scene.ts
    deer.scene.ts
    forestEdge.scene.ts
    forest1.scene.ts
    forest2.scene.ts
    hairpin.scene.ts
    car.scene.ts
    search.scene.ts / searchWall.scene.ts / searchPath.scene.ts
    hotel.scene.ts
    busStop.scene.ts
    police.scene.ts
    bench.scene.ts

  data/                       ← 纯数据，从今天的 story.ts 拆出来
    ferrata.ts                CABLE_ANCHORS / CRACK_HOLDS
    descent.ts                SCREE_STEPS / SIGNPOST_ARMS / FOREST_STEPS
    letter.ts                 LETTER_LINES_IT / LETTER_LINES_ZH / CLOSING_LINES（受保护原文）
    items.ts                  ITEMS：14 件道具的定义
    entries.ts                ENTRIES：本子条目
    map.ts                    MAP_LEGS / HUT_HOURS / 日落刻度
    contacts.ts               三个联系人与消息节拍

  view/
    GameRoot.tsx              阶段切换（title / play / complete）+ WorldProvider
    useWorld.ts               useWorldValue / useEntities / useWorldEvent
    SceneView.tsx             PanoStage + anchor layer；把实体渲染成热点与精灵
    Hotspot.tsx               一个可交互实体的 DOM（data-yaw/pitch/distance/reveal）
    PropSprite.tsx            一个纯装饰实体
    HandsLayer.tsx            伸手、走路的手、车里的手
    HUD.tsx                   场景说明、工具按钮、心跳条
    DialogueLine.tsx          当前台词（订阅 DialogueSystem）
    overlays/
      PackCloth.tsx           背包（一块布）
      PaperMap.tsx            纸地图与本子背面
      Notebook.tsx            信箱里的便签本
      CallSheet.tsx           112
      FindMy.tsx  HotelCalls.tsx  Selfie.tsx
    PhonePanel.tsx            包住现有 Phone.tsx，把 dispatch 接到 world
    TitleScreen.tsx  CreditsScreen.tsx  SettingsMenu.tsx

  PanoStage.tsx               渲染器：保持不变（唯一改动见 §10.1）
  Phone.tsx                   保持不变（改由 PhonePanel 供数据）
  soundscape.ts               保持不变（只被 AudioSystem 调用）
  phoneModel.ts               保持不变（PhoneState 成为 GameState 的一个 slice）
```

`src/App.tsx` 最终消失，其内容分别落到 `view/GameRoot.tsx`（约 80 行）、各 system、各 scene。

---

## 3 核心类型

### 3.1 基础

```ts
// src/engine/types.ts
export type Deg = number;

/** 画面上的一个位置：yaw/pitch 是度，distance 影响投影出来的大小（PanoStage 的既有约定）。 */
export type Transform = { yaw: Deg; pitch: Deg; distance?: number; scale?: number };

/** 六个动词加上它们在画面里的具体形态。菜单里没有动词，动词都长在画面上。 */
export type Verb =
  | "inspect"    // 看：视线靠近后点一下，凑近看
  | "read"       // 读：牌子、路牌、便签、木雕
  | "take"       // 拿：进背包
  | "use"        // 用：摊开地图、拿出补光灯、吃巧克力
  | "clip"       // 挂：锁扣
  | "step"       // 踩：碎石坡的落脚点
  | "hold"       // 按住：攀爬、抓握、低吼
  | "photograph" // 举起手机或相机
  | "talk"       // 点头、回答、追问
  | "wave";      // 挥手、举灯

/** 一次动作的全部代价。任何一项都可以是 0；分钟是唯一所有系统共用的单位。 */
export type Cost = {
  minutes?: number;
  battery?: number;   // 手机 %
  camera?: number;    // 相机 %
  lamp?: number;      // 补光灯 0..1
  fatigue?: number;   // 手
  fear?: number;      // 心跳
};

export type FlagValue = boolean | number | string | null;
export type FlagKey = string;   // 一律命名空间化："cable.step" / "hutView.choice"
```

### 3.2 条件（可序列化的判定）

条件必须是数据，因为它同时被三处读：实体是否存在、实体是否可交互、场景是否可离开。

```ts
// src/engine/condition.ts
export type Condition =
  | { kind: "flag"; key: FlagKey; eq?: FlagValue; gte?: number; lt?: number }
  | { kind: "has"; item: ItemId }
  | { kind: "worn"; item: ItemId }
  | { kind: "held"; item: ItemId }                 // 现在拿在手上（夜里拿地图＝光不照地）
  | { kind: "knows"; entry: EntryId }
  | { kind: "entity"; id: EntityId; is: keyof EntityState; value?: FlagValue }
  | { kind: "visited"; scene: SceneId }
  | { kind: "beforeMinute"; minute: number }
  | { kind: "afterMinute"; minute: number }
  | { kind: "light"; gte?: number; lt?: number }    // 0..1 天光
  | { kind: "fatigue"; gte?: number; lt?: number }
  | { kind: "all"; of: Condition[] }
  | { kind: "any"; of: Condition[] }
  | { kind: "not"; of: Condition };

export function test(world: World, condition?: Condition): boolean {
  if (!condition) return true;
  const s = world.state;
  switch (condition.kind) {
    case "flag": {
      const value = s.flags[condition.key] ?? null;
      if (condition.eq !== undefined) return value === condition.eq;
      if (condition.gte !== undefined) return typeof value === "number" && value >= condition.gte;
      if (condition.lt !== undefined) return typeof value === "number" && value < condition.lt;
      return Boolean(value);
    }
    case "has":   return s.inventory.items.includes(condition.item);
    case "worn":  return s.inventory.worn.includes(condition.item);
    case "held":  return s.inventory.hands.includes(condition.item);
    case "knows": return s.journal.entries.includes(condition.entry);
    case "entity": {
      const state = s.scenes[s.sceneId]?.entities[condition.id];
      const value = state ? state[condition.is] : undefined;
      return condition.value === undefined ? Boolean(value) : value === condition.value;
    }
    case "visited":      return Boolean(s.scenes[condition.scene]?.visited);
    case "beforeMinute": return s.clock.minuteOfDay < condition.minute;
    case "afterMinute":  return s.clock.minuteOfDay >= condition.minute;
    case "light":        return range(lightOf(s), condition.gte, condition.lt);
    case "fatigue":      return range(s.body.fatigue, condition.gte, condition.lt);
    case "all":  return condition.of.every((c) => test(world, c));
    case "any":  return condition.of.some((c) => test(world, c));
    case "not":  return !test(world, condition.of);
  }
}
```

### 3.3 实体与组件

一个实体 = 一个 id + 若干组件。组件全是可选字段的普通对象，没有类、没有注册表、没有 archetype——节点里最多几十个实体，为它们上 ECS 的引擎学是自伤。

```ts
// src/engine/entity.ts
export type EntityId = string;

/** 位置：静态的写对象；会动的（跟随当前锚点的锁扣面板、驶近的公交）写函数。 */
export type TransformSource = Transform | ((world: World) => Transform);

export type Sprite = {
  src: string;
  layer?: "back" | "prop" | "figure" | "hand";
  className?: string;
  anim?: string;                 // CSS 动画名，交给 motion.css
  swap?: Array<{ when: Condition; src: string }>;   // 女士正面 → 背影 → 公交
};

export type Interactable = {
  verbs: Verb[];
  label: string;                 // 画面上那行小字
  reveal: Deg;                   // 视线靠多近才显现；实际半径由 GazeSystem 调制
  cost?: Cost;
  requires?: Condition;          // 不满足时热点仍然显现，但点下去她的手自己收回来（不弹字）
  once?: boolean;
  keyHint?: string;
};

export type Collectible = { item: ItemId; consumesEntity?: boolean };

export type Readable = {
  kind: "plaque" | "sign" | "note" | "carving" | "timetable" | "screen";
  lines: readonly string[];
  entry?: EntryId;               // 读完写进本子的那一条
  minutes: number;
};

export type Exit = {
  to: SceneId;
  kind: "walk" | "run" | "back" | "detour";
  label: string;
  minutes: number;               // 基准行程时间；玩家的动作叠加在钟上，不叠加在这里
  condition?: Condition;         // 不满足时箭头不显现
  battery?: number;
};

export type TriggerSource =
  | { on: "enter" }
  | { on: "gaze"; dwell: number }                 // 视线停留 N 毫秒
  | { on: "minute"; at: number }                  // 钟走到某一刻
  | { on: "idle"; seconds: number }               // 玩家"等"
  | { on: "event"; name: EventName }
  | { on: "flag"; key: FlagKey; eq: FlagValue };

export type Trigger = { source: TriggerSource; when?: Condition; once?: boolean; tag: string };

export type Holdable = {
  ms: number;                                     // 基准按住时长
  scaleWith?: Array<"fear" | "fatigue" | "lamp">; // 实际时长 = ms × (1 + fear·0.9 + fatigue·0.6)
  releaseLine?: string;                           // "手松了。再来。"
};

export type Gazeable = { radius: Deg; dwell: number };   // 纯观察触发（鹿、直升机、那位女士）
export type Blaze = { real: boolean };                   // 红白漆记：真 / 地衣、旧箭头、测量点

export type EntityDef = {
  id: EntityId;
  transform: TransformSource;
  tags?: readonly string[];
  visible?: Condition;      // 不满足＝这个实体在这个节点里根本不存在
  enabled?: Condition;      // 存在但此刻不可点（灰）
  sprite?: Sprite;
  interactable?: Interactable;
  collectible?: Collectible;
  readable?: Readable;
  exit?: Exit;
  trigger?: Trigger;
  hold?: Holdable;
  gaze?: Gazeable;
  blaze?: Blaze;
};

/** 实体的可变部分，进存档。定义不可变，状态可变——这条分界让存档永远很小。 */
export type EntityState = {
  taken?: boolean;
  read?: boolean;
  used?: number;
  hidden?: boolean;
  data?: Record<string, FlagValue>;
};

/** View 每帧拿到的东西：已经算好可见性与 reveal 的扁平结构。 */
export type EntityView = {
  id: EntityId;
  transform: Transform;
  reveal: Deg;
  label?: string;
  verbs?: readonly Verb[];
  sprite?: { src: string; className: string };
  disabled: boolean;
  kind: "hotspot" | "prop" | "exit" | "hold";
};
```

### 3.4 GameState：唯一的真相，且完全可序列化

```ts
// src/engine/world.ts
export type GameState = {
  version: 5;
  phase: "title" | "play" | "complete";
  sceneId: SceneId;
  previousSceneId: SceneId | null;

  clock: {
    day: 1 | 2 | 3;
    date: GameDate;
    minuteOfDay: number;      // 唯一真实时钟，第一天 09:40 起算
    sunsetMinute: number;     // 20:15
    lastLightMinute: number;  // 21:05：最后一点可用光
  };

  body: {
    fatigue: number;          // 0..1  手
    fear: number;             // 0..1  心跳（只在林缘与森林两节点存在）
    breath: "calm" | "walking" | "recovery";
    slips: number;
    adrenaline: boolean;      // fatigue ≥ 0.9：不再有惩罚，只是一切变慢，且她不再说话
  };

  power: {
    phone: number;            // % 沿用 phoneModel 的 battery 语义
    camera: number;           // % forestEdge 按事实归零
    lamp: number;             // 0..1 没有任何数字，只有光圈直径与颜色
    lampMode: "wide" | "narrow" | null;
  };

  inventory: {
    items: ItemId[];
    worn: ItemId[];           // 头盔、挽索、手套、帽子、冲锋衣
    hands: ItemId[];          // 现在占着手的东西（最多 2）
    packDirt: 0 | 1 | 2 | 3;  // 布随这一天变脏
  };

  journal: {
    entries: EntryId[];       // 本子：全部来自世界里可读的东西，没有一条是旁白送的
    mapLegs: Record<string, number>;   // 勾过的段与其小时数（未读到的段由玩家自己估）
    estimates: Record<string, number>;
    objective: string | null;
  };

  flags: Record<FlagKey, FlagValue>;   // 场景局部进度，一律带命名空间

  scenes: Record<SceneId, {
    visited: boolean;
    entered: number;          // 第一次进入时的分钟（第二天回森林小路要用）
    entities: Record<EntityId, EntityState>;
  }>;

  phone: PhoneState;          // 复用 src/phoneModel.ts，一字不改
  camera: { aimX: number; aimY: number; zoom: number };
  settings: GameSettings;     // 复用 src/settings.ts
  stats: { minutesSpent: number; photos: number; blazesFound: number; blazesMissed: number };
};
```

**不进 GameState 的东西**（派生或运行时，重算一次比存一次便宜，也不会因为存了旧值而说谎）：
`light`（由 `clock` 算）、每个热点的实际 reveal 半径、按住的实际毫秒数、当前台词与其剩余时间、镜头弹簧、音频节点、纹理、计时器、`EntityView`。

### 3.5 World

```ts
export type World = {
  readonly state: GameState;
  readonly bus: EventBus;
  readonly rt: Runtime;                 // 非序列化：rng、scene 订阅、计时器、外设句柄

  /** 整片替换与浅合并。两者都会 bump revision 并在帧末通知订阅者（同一帧内多次修改只通知一次）。 */
  set<K extends keyof GameState>(key: K, value: GameState[K]): void;
  patch<K extends keyof GameState>(key: K, patch: Partial<GameState[K]>): void;

  flag<T extends FlagValue>(key: FlagKey, fallback?: T): T;
  setFlag(key: FlagKey, value: FlagValue): void;
  bump(key: FlagKey, delta: number): number;

  entity(id: EntityId): EntityHandle;   // 当前场景的实体状态读写
  scene(): SceneDef;

  dispatch(command: Command): void;     // 玩家意图唯一入口（UI 与无头测试共用）
  emit: EventBus["emit"];
  on: EventBus["on"];

  tick(dt: number, gaze: GazePoint): void;
  subscribe(listener: () => void): () => void;
  revision: number;
};

export type Runtime = {
  rng: () => number;
  stage: { kick: (kind: ImpulseKind, strength?: number, dir?: { yaw: number; pitch: number }) => void } | null;
  sound: Soundscape | null;
  timers: Set<number>;
  sceneUnsubs: Array<() => void>;
  now: number;                 // 引擎时间（毫秒），与 performance.now 对齐
};
```

`set`/`patch` 之外没有别的写路径。DEV 下用 `Object.freeze` 冻结每个 slice，谁绕过写路径直接改，立刻在开发期炸出来。

---

## 4 命令（Command）

玩家能做的每一件事都是一个命令。UI 只产生命令，冒烟测试也只产生命令——这就是"无头通关"能成立的原因。

```ts
// src/engine/command.ts
export type Command =
  | { type: "interact"; entity: EntityId; verb: Verb }
  | { type: "hold:start"; entity: EntityId }
  | { type: "hold:end" }
  | { type: "travel"; entity: EntityId }              // 走向某个 Exit 实体
  | { type: "wait" }                                  // 指针静止满 4 秒，由 GazeSystem 自动发
  | { type: "pack:open" } | { type: "pack:close" }
  | { type: "pack:equip"; item: ItemId } | { type: "pack:stow"; item: ItemId }
  | { type: "item:use"; item: ItemId }                // 吃巧克力、拿出补光灯、摊开地图
  | { type: "lamp:mode"; mode: "wide" | "narrow" }
  | { type: "phone:open"; tab?: PhoneTab } | { type: "phone:close" }
  | { type: "phone:shoot"; snapshot?: string }
  | { type: "phone:send"; contact: ContactId; text?: string; photoId?: string }
  | { type: "overlay:open"; id: OverlayId } | { type: "overlay:close" }
  | { type: "ui:action"; id: string; value?: FlagValue }   // overlay 内部的按钮（地图勾段、电话拨号、翻译一句）
  | { type: "shout" } | { type: "growl:start" } | { type: "growl:end" }
  | { type: "settings"; patch: Partial<GameSettings> }
  | { type: "flow"; action: "begin" | "continue" | "title" | "credits:skip" }
  | { type: "dev:warp"; scene: SceneId };
```

`world.dispatch` 只做三件事：查表找到对应的 handler（system 在 init 时注册）、把命令写进本帧的命令队列、在 tick 的固定阶段消费。**命令不在 dispatch 里立即执行**，否则又会出现今天那种"点击处理函数里改了五个 state 再触发另一个点击"的重入。

---

## 5 事件目录

事件是系统之间唯一的耦合方式。命名一律 `域:动作`，payload 一律扁平对象。

```ts
// src/engine/bus.ts
export type EventMap = {
  // 流程
  "world:ready":        { save: boolean };
  "flow:phase":         { phase: GameState["phase"] };
  "scene:enter":        { scene: SceneId; from: SceneId | null; warped: boolean };
  "scene:ready":        { scene: SceneId };        // 画面纹理已就位
  "scene:exit":         { scene: SceneId; to: SceneId };
  "travel:begin":       { from: SceneId; to: SceneId; run: boolean; ms: number };
  "travel:arrive":      { scene: SceneId };

  // 输入与视线
  "gaze:enter":         { entity: EntityId; degrees: number };
  "gaze:leave":         { entity: EntityId };
  "gaze:dwell":         { entity: EntityId; ms: number };
  "input:wait":         { seconds: number };
  "hold:progress":      { entity: EntityId; progress: number };   // 只给 View，不进 state
  "hold:complete":      { entity: EntityId };
  "hold:release":       { entity: EntityId; progress: number };

  // 交互
  "interact:attempt":   { entity: EntityId; verb: Verb };
  "interact:done":      { entity: EntityId; verb: Verb; cost: Cost };
  "interact:refused":   { entity: EntityId; verb: Verb; reason: "condition" | "hands" | "gone" };

  // 世界状态
  "clock:advance":      { minutes: number; reason: string; minuteOfDay: number };
  "clock:light":        { light: number; previous: number };
  "clock:mark":         { minute: number; tag: string };          // 定点：17:00 山屋亮灯、20:15 日落
  "body:fatigue":       { value: number; delta: number };
  "body:fear":          { value: number; delta: number };
  "body:slip":          { entity: EntityId | null; severity: number };
  "body:rest":          { seconds: number };
  "body:adrenaline":    { on: boolean };
  "power:drain":        { source: "phone" | "camera" | "lamp"; value: number; reason: string };
  "power:dead":         { source: "phone" | "camera" | "lamp" };
  "lamp:mode":          { mode: "wide" | "narrow" };

  // 物与信息
  "item:gain":          { item: ItemId; from: EntityId | null };
  "item:lose":          { item: ItemId; reason: string };
  "item:equip":         { item: ItemId } ; "item:stow": { item: ItemId };
  "item:use":           { item: ItemId };
  "journal:entry":      { entry: EntryId; source: EntityId | null };
  "journal:objective":  { text: string | null };
  "blaze:confirm":      { entity: EntityId; real: boolean };

  // 手机
  "phone:open":         { tab: PhoneTab }; "phone:close": {};
  "phone:photo":        { photoId: string; scene: SceneId };
  "phone:message":      { contact: ContactId; text: string };
  "phone:lost":         { minute: number };
  "phone:returned":     {};

  // 表现（只被 AudioSystem / CameraBodySystem / View 订阅）
  "say":                { line: string; priority: number; delay?: number; tag?: string };
  "flash":              { text: string };
  "sfx":                { name: SfxName; pan?: number };
  "ambience":           { scene: SceneId; overrides?: Partial<Ambience> };
  "music":              { track: "day" | "warm" | "end" | null };
  "camera:impulse":     { kind: ImpulseKind; strength: number; dir?: { yaw: number; pitch: number } };
  "hand:reach":         { transform: Transform; kind: "grip" | "carabiner"; hold: boolean };

  // 存档与片尾
  "save:written":       { scene: SceneId };
  "save:loaded":        { scene: SceneId };
  "ending:begin":       {};
};

export type EventName = keyof EventMap;

export interface EventBus {
  on<K extends EventName>(name: K, fn: (payload: EventMap[K]) => void): () => void;
  once<K extends EventName>(name: K, fn: (payload: EventMap[K]) => void): () => void;
  emit<K extends EventName>(name: K, payload: EventMap[K]): void;
}
```

实现要点：

- `emit` 在别的 handler 执行期间被调用时，进入 FIFO 队列，由最外层 emit 循环排空——顺序确定，永不递归爆栈。
- 队列深度上限 64，超出在 DEV 期抛错并打印事件链，这是事件循环的唯一致命 bug 形态。
- 订阅者返回退订函数。场景脚本的订阅由 `SceneCtx.on` 收集，`scene:exit` 时统一退订——今天 `clearTimers()` 那类手工清理从此消失。

---

## 6 系统

### 6.1 统一契约

```ts
// src/systems/index.ts
export type System = {
  id: string;
  order: number;                                   // tick 顺序，见下表
  init?(world: World): void | (() => void);        // 返回值是 dispose
  tick?(world: World, dt: number): void;
};

export const coreSystems: System[] = [
  InputSystem, GazeSystem, InteractionSystem, ClockSystem, BodySystem,
  PowerSystem, InventorySystem, JournalSystem, TriggerSystem, ObjectiveSystem, SaveSystem,
];
export const browserSystems: System[] = [DialogueSystem, AudioSystem, CameraBodySystem];
```

`coreSystems` 不碰 DOM、不碰 Web Audio、不碰 three——Node 里跑整段剧情时只装这一组（§9.3）。

| order | 系统 | tick 做什么 | 订阅什么 | 写哪一块 state |
|---:|---|---|---|---|
| 10 | InputSystem | 排空本帧命令队列，分发给注册的 handler | — | — |
| 20 | GazeSystem | 用 PanoStage 给的 yaw/pitch 算每个实体的角距，维护驻留计时，发 `gaze:*` 与 `input:wait`；算每个实体的实际 reveal 并写进 DOM 属性 | `scene:enter` | — （纯派生） |
| 30 | InteractionSystem | 校验 `requires` → 结算 `Cost` → 发 `interact:done`；按住的计时与释放 | 命令 | `flags` / `scenes.entities` |
| 40 | ClockSystem | 累加分钟、算 `light`、触发定点 `clock:mark` | `clock:advance` | `clock` |
| 50 | BodySystem | fatigue 的持续项（不吃巧克力的常数）、"等"的恢复、fear 的自然上浮、adrenaline 阈值 | `interact:done` / `body:*` / `input:wait` | `body` |
| 60 | PowerSystem | 手机开屏、离线地图、通话、补光灯随时间衰减（下限 0.15） | `phone:open` / `item:use` / `clock:advance` | `power` |
| 70 | InventorySystem | 拿取、穿戴、占手判定（夜里拿地图＝光照纸不照地） | `item:*` 命令 | `inventory` |
| 80 | JournalSystem | 写 entry、勾地图段、目标行 | `interact:done`（readable） | `journal` |
| 90 | TriggerSystem | 检查本场景全部 Trigger 的 source 与 when | 全部 | `flags` |
| 95 | ObjectiveSystem | 由当前场景的 `exitWhen` 与本子推出"她现在打算做什么"，只写在纸上，不在 HUD 上 | `scene:enter` / `journal:entry` | `journal.objective` |
| 100 | SaveSystem | 静止 2 秒且不在过场时写档 | `scene:enter` / `flow:phase` | — |
| 200 | DialogueSystem | 台词队列：同 tag 去重、按优先级抢占、显示时长 = `min(9000, 2600 + 字数 × 120)` | `say` / `flash` | — （只推 View） |
| 210 | AudioSystem | 事件 → Soundscape；环境声按场景 + 光照混音 | `sfx` / `ambience` / `scene:enter` / `clock:light` | — |
| 220 | CameraBodySystem | 事件 → `PanoStage.kick`；阵风、心跳、呼吸的节律 | `camera:impulse` / `body:*` / `travel:*` | — |

### 6.2 ClockSystem（主系统，顺带修掉 D1）

```ts
// src/systems/ClockSystem.ts
export const SUNSET = 20 * 60 + 15;
export const LAST_LIGHT = 21 * 60 + 5;

/** 天光：>0 是白昼到暮色的连续量，0 是日落之后。这是唯一的光照来源。 */
export function lightOf(state: GameState): number {
  const remaining = state.clock.sunsetMinute - state.clock.minuteOfDay;
  return Math.max(0, Math.min(1, remaining / 90));
}

export const ClockSystem: System = {
  id: "clock", order: 40,
  init(world) {
    let lastLight = lightOf(world.state);
    const marks = new Set<string>();

    const off = world.on("clock:advance", ({ minutes, reason }) => {
      const before = world.state.clock.minuteOfDay;
      const after = before + Math.max(0, Math.round(minutes));
      world.patch("clock", { minuteOfDay: after });
      world.patch("phone", advanceClockOnly(world.state.phone, minutes));   // 手机与世界共用一口钟
      world.patch("stats", { minutesSpent: world.state.stats.minutesSpent + minutes });

      // 定点：跨过某一刻就发一次，永不重复
      for (const mark of CLOCK_MARKS) {
        if (before < mark.minute && after >= mark.minute && !marks.has(mark.tag)) {
          marks.add(mark.tag);
          world.emit("clock:mark", { minute: mark.minute, tag: mark.tag });
        }
      }
      const light = lightOf(world.state);
      if (Math.abs(light - lastLight) > 0.004) {
        world.emit("clock:light", { light, previous: lastLight });
        lastLight = light;
      }
      if (import.meta.env.DEV) console.debug(`[clock] +${minutes}′ ${reason} → ${formatGameTime(after)}`);
    });
    return off;
  },
};

/** 定点事件：全部来自 v4 §3.1 / §3.8，不是计时器，是钟。 */
const CLOCK_MARKS = [
  { minute: 17 * 60,        tag: "hut-window-lit" },   // 山屋的窗户亮起来
  { minute: 18 * 60,        tag: "crickets-in" },
  { minute: 19 * 60 + 30,   tag: "wind-turns" },
  { minute: SUNSET,         tag: "sunset" },           // 太阳落到 Sassolungo 后面，环境声整体 −3 dB
  { minute: LAST_LIGHT,     tag: "last-light" },
];
```

`PanoStage` 的 `TINT` 从"按节点写死的 light 字段"改为"按 `light` 连续插值"（§10.1）。`App.tsx` 里由 `nodeSeconds` 驱动的 `dusk` 整段删除——**站着不动天不会黑，走路才会**。

### 6.3 InteractionSystem（取代所有内联点击处理）

```ts
// src/systems/InteractionSystem.ts
export const InteractionSystem: System = {
  id: "interaction", order: 30,
  init(world) {
    const holdState = { entity: null as EntityId | null, start: 0, required: 0 };

    onCommand(world, "interact", ({ entity, verb }) => {
      const def = findEntity(world, entity);
      if (!def?.interactable || !def.interactable.verbs.includes(verb)) {
        return world.emit("interact:refused", { entity, verb, reason: "gone" });
      }
      if (!test(world, def.visible) || !test(world, def.enabled)) {
        return world.emit("interact:refused", { entity, verb, reason: "condition" });
      }
      if (def.interactable.requires && !test(world, def.interactable.requires)) {
        // 她不会去做这件事：手伸到一半自己收回来。不弹任何字。
        world.emit("camera:impulse", { kind: "glance", strength: 0.5, dir: { yaw: 0, pitch: -4 } });
        return world.emit("interact:refused", { entity, verb, reason: "condition" });
      }
      world.emit("interact:attempt", { entity, verb });
      const cost = def.interactable.cost ?? {};
      spend(world, cost, `${entity}:${verb}`);
      if (def.interactable.once) world.entity(entity).patch({ used: (world.entity(entity).state.used ?? 0) + 1 });
      world.emit("interact:done", { entity, verb, cost });     // ← 场景脚本在这里接手
    });

    onCommand(world, "hold:start", ({ entity }) => {
      const def = findEntity(world, entity);
      if (!def?.hold) return;
      holdState.entity = entity;
      holdState.start = world.rt.now;
      holdState.required = holdMs(world, def.hold);            // ms × (1 + fear·0.9 + fatigue·0.6)
      world.emit("hand:reach", { transform: resolve(world, def.transform), kind: "grip", hold: true });
      world.emit("sfx", { name: "grip" });
    });

    onCommand(world, "hold:end", () => {
      if (!holdState.entity) return;
      const progress = (world.rt.now - holdState.start) / holdState.required;
      const entity = holdState.entity;
      holdState.entity = null;
      if (progress < 1) world.emit("hold:release", { entity, progress });
    });
  },

  tick(world) {
    const hold = currentHold(world);
    if (!hold) return;
    const progress = Math.min(1, (world.rt.now - hold.start) / hold.required);
    world.emit("hold:progress", { entity: hold.entity, progress });    // View 只写 CSS 变量
    if (progress >= 1) { clearHold(); world.emit("hold:complete", { entity: hold.entity }); }
  },
};

/** 唯一的结算口：所有代价从这里走，所有系统只需要盯住自己的那一项。 */
export function spend(world: World, cost: Cost, reason: string) {
  if (cost.minutes)  world.emit("clock:advance", { minutes: cost.minutes, reason, minuteOfDay: world.state.clock.minuteOfDay });
  if (cost.battery)  world.emit("power:drain", { source: "phone",  value: cost.battery, reason });
  if (cost.camera)   world.emit("power:drain", { source: "camera", value: cost.camera,  reason });
  if (cost.lamp)     world.emit("power:drain", { source: "lamp",   value: cost.lamp,    reason });
  if (cost.fatigue)  world.emit("body:fatigue", { value: 0, delta: cost.fatigue });
  if (cost.fear)     world.emit("body:fear",    { value: 0, delta: cost.fear });
}
```

### 6.4 GazeSystem（"看"这个动词的全部实现）

```ts
// src/systems/GazeSystem.ts
export const GazeSystem: System = {
  id: "gaze", order: 20,
  tick(world, dt) {
    const gaze = world.rt.gaze;                    // PanoStage 每帧喂进来的 { yaw, pitch }
    const light = lightOf(world.state);
    const lamp = world.state.power.lampMode;
    for (const view of world.rt.views) {           // 当前场景可见实体的投影缓存
      const def = view.def;
      if (!def.interactable && !def.gaze) continue;

      // 实际显现半径：天黑、疲劳、窄光都让人看见得更少，但硬下限 11°（v4 §3.1/§3.2/§3.4）
      const base = def.interactable?.reveal ?? def.gaze!.radius;
      const radius = Math.max(11,
        base * (0.55 + 0.45 * light)
             * (1 - world.state.body.fatigue * 0.35)
             * (lamp === "narrow" ? 0.5 : lamp === "wide" ? 1.15 : 1)
             * (world.state.inventory.worn.includes("cap") ? 1.1 : 1));
      view.node.dataset.reveal = radius.toFixed(1);   // 直接写 DOM，不进 React

      const distance = Math.hypot(view.transform.yaw - gaze.yaw, (view.transform.pitch - gaze.pitch) * 1.4);
      const inside = distance <= radius * 0.55;
      if (inside && !view.gazing) { view.gazing = true; view.dwell = 0; world.emit("gaze:enter", { entity: def.id, degrees: distance }); }
      else if (!inside && view.gazing) { view.gazing = false; view.dwell = 0; world.emit("gaze:leave", { entity: def.id }); }
      if (view.gazing) {
        view.dwell += dt * 1000;
        const need = def.gaze?.dwell ?? def.trigger?.source.on === "gaze" ? (def.trigger as any).source.dwell : 0;
        if (need && view.dwell >= need && !view.fired) { view.fired = true; world.emit("gaze:dwell", { entity: def.id, ms: view.dwell }); }
      }
    }

    // "等"：指针静止满 4 秒＝唯一的休息，也是"看久了才看见"的东西的唯一触发
    world.rt.stillFor = gazeMoved(world) ? 0 : world.rt.stillFor + dt;
    if (world.rt.stillFor >= 4 && !world.rt.waited) { world.rt.waited = true; world.dispatch({ type: "wait" }); }
    if (world.rt.stillFor < 4) world.rt.waited = false;
  },
};
```

**为什么 reveal 写 DOM 而不写 state**：一个节点有十几个热点，每帧重算是 O(20) 的浮点运算；走 React 就是每帧 20 次 re-render。今天 `PanoStage` 已经在自己的循环里读 `data-reveal` 做同样的事——GazeSystem 只是把这个数从常量变成活的。

### 6.5 DialogueSystem（取代 `say()` 与那一堆计时器）

```ts
// src/systems/DialogueSystem.ts
type Line = { text: string; priority: number; tag?: string; at: number; ms: number };

export const DialogueSystem: System = {
  id: "dialogue", order: 200,
  init(world) {
    let current: Line | null = null;
    const queue: Line[] = [];
    const push = (line: Line) => {
      if (line.tag && (current?.tag === line.tag || queue.some((q) => q.tag === line.tag))) return;  // 同一句不说两遍
      if (current && line.priority > current.priority) { current = null; }                            // 玩家触发的话抢占入场旁白
      queue.push(line);
    };
    world.on("say", ({ line, priority = 0, delay = 0, tag }) =>
      push({ text: line, priority, tag, at: world.rt.now + delay, ms: Math.min(9000, 2600 + line.length * 120) }));
    world.on("scene:exit", () => { queue.length = 0; current = null; world.rt.line = null; });
    // 肾上腺素状态下她不再说话（v4 §3.2）
    world.on("body:adrenaline", ({ on }) => { if (on) { queue.length = 0; current = null; } });
  },
  tick(world) {
    // 队列推进；当前台词写进 rt.line，View 用一次 useSyncExternalStore 订阅它
  },
};
```

这一步把今天散落在 `say` / `flash` / `entryTimersRef` / `thoughtTimerRef` 里的四套计时逻辑收成一套，并且天然满足 v4 §10"不连播、不推剧情"：队列每次只放一句，`priority` 保证玩家的动作永远盖过入场白。

---

## 7 场景：数据 + 一段脚本

```ts
// src/engine/scene.ts
export type SceneDef = {
  id: SceneId;
  day: 1 | 2 | 3;
  place: string;
  elevation: string;
  painting: string;                 // public/pano/*.webp
  body: BodyMode;                   // stand / climb / crawl / ride
  material: SoundMaterial;
  ambience: Ambience;
  arriveAt?: number;                // 基准到达时刻（v4 §3.1 的表），供 dev warp 与配速校验
  chapter?: { eyebrow: string; title: string };
  entities: EntityDef[];
  exitWhen?: Condition;             // 取代 isReady() 那个 23 分支 switch
  script?: (ctx: SceneCtx) => void | (() => void);
  seed?: (world: World) => void;    // 取代 completeNode()：场景自述它"玩完之后"的样子
};

export type SceneCtx = {
  world: World;
  scene: SceneDef;
  on: EventBus["on"];                                   // 自动在 scene:exit 时退订
  onInteract(entity: EntityId, fn: (verb: Verb) => void): void;
  onGaze(entity: EntityId, fn: () => void): void;
  onMark(tag: string, fn: () => void): void;            // 钟走到某一刻
  onHold(entity: EntityId, fn: () => void): void;
  say(line: string, opts?: { delay?: number; priority?: number; tag?: string }): void;
  flash(text: string): void;
  sfx(name: SfxName, pan?: number): void;
  kick(kind: ImpulseKind, strength?: number, dir?: { yaw: number; pitch: number }): void;
  hand(transform: Transform, kind?: "grip" | "carabiner", hold?: boolean): void;
  spend(cost: Cost, reason: string): void;
  flag: World["flag"]; setFlag: World["setFlag"]; bump: World["bump"];
  entity(id: EntityId): EntityHandle;
  give(item: ItemId): void; learn(entry: EntryId): void;
  after(ms: number, fn: () => void): void;              // 场景作用域计时器，离场自动清
  travel(scene: SceneId): void;
};
```

### 7.1 `cable.scene.ts` — 钢缆与两把锁扣

原经历里这一段是：一开始就是 C 级，很快 D 级，钢缆沿天然岩壁，自己找手点脚点。玩法上每个锚点问两个问题：**锁扣的顺序**（任何时候至少一把在缆上）和**怎么上去**（拉钢缆快而费手 / 找岩点慢而不费手）。

```ts
// src/scenes/cable.scene.ts
import { defineScene } from "../engine/scene";
import { blaze, goArrow } from "./_shared";
import { CABLE_ANCHORS } from "../data/ferrata";

const TOTAL = CABLE_ANCHORS.length;
const at = (i: number) => CABLE_ANCHORS[Math.min(i, TOTAL - 1)];

// 锁扣挂在哪一段：数字＝段号，-1＝在手里
const A = "cable.blue", B = "cable.orange", STEP = "cable.step", PHASE = "cable.phase";

export default defineScene({
  id: "cable",
  day: 1, place: "飞拉达 · 第一段", elevation: "2,355 m",
  painting: "pano/04-cable.webp",
  body: "climb", material: "rock",
  ambience: { wind: 0.95, windTone: 1450, birds: 0.1 },
  arriveAt: 10 * 60 + 30,
  exitWhen: { kind: "flag", key: STEP, gte: TOTAL },

  entities: [
    // 当前锚点的标记：只是看得见，点它只是凑近看一眼
    { id: "anchor", transform: (w) => at(w.flag<number>(STEP, 0)),
      sprite: { src: "sprites/anchor.webp", layer: "prop" },
      interactable: { verbs: ["inspect"], label: "锚点", reveal: 12, cost: { minutes: 0 } },
      visible: { kind: "flag", key: STEP, lt: TOTAL } },

    // 两把锁：位置跟着当前锚点走；标签是否显示状态，取决于起点第二块牌子读没读（v4 §3.7）
    { id: "carabiner-blue", transform: (w) => offset(at(w.flag<number>(STEP, 0)), -7, 8),
      sprite: { src: "sprites/carabiner-blue.webp", layer: "hand" },
      interactable: { verbs: ["clip"], label: "蓝锁", reveal: 14 },
      visible: { kind: "flag", key: STEP, lt: TOTAL } },
    { id: "carabiner-orange", transform: (w) => offset(at(w.flag<number>(STEP, 0)), 7, 8),
      sprite: { src: "sprites/carabiner-orange.webp", layer: "hand" },
      interactable: { verbs: ["clip"], label: "橙锁", reveal: 14 },
      visible: { kind: "flag", key: STEP, lt: TOTAL } },

    // 两把锁都挂到下一段之后，才谈得上怎么上去
    { id: "haul-cable", transform: (w) => offset(at(w.flag<number>(STEP, 0)), -3, 14),
      interactable: { verbs: ["hold"], label: "拉钢缆", reveal: 13, cost: { minutes: 6, fatigue: 0.06 } },
      hold: { ms: 700, scaleWith: ["fatigue"] },
      visible: { kind: "flag", key: PHASE, eq: "climb" } },
    { id: "rock-holds", transform: (w) => offset(at(w.flag<number>(STEP, 0)), 6, 12),
      interactable: { verbs: ["hold"], label: "找岩点", reveal: 13, cost: { minutes: 10 } },
      hold: { ms: 1000, scaleWith: ["fatigue"] },
      visible: { kind: "flag", key: PHASE, eq: "climb" } },

    // 第三个锚点向左下俯瞰整个草甸与碎石路（v4 §6）
    { id: "view-down", transform: { yaw: -34, pitch: -26, distance: 14 },
      interactable: { verbs: ["inspect", "photograph"], label: "脚下的草甸", reveal: 12, cost: { minutes: 1 } },
      visible: { kind: "flag", key: STEP, gte: 2 } },

    // 上方远处两个小小的人影：一小时以后她会在顶段遇到他们
    { id: "climbers-far", transform: { yaw: 12, pitch: 22, distance: 16 },
      sprite: { src: "sprites/climbers-far.webp", layer: "figure" },
      gaze: { radius: 10, dwell: 900 },
      visible: { kind: "flag", key: STEP, gte: 1 } },

    blaze("blaze-cable", { yaw: -21, pitch: -4 }, true),

    goArrow("go", { yaw: 0, pitch: 16 }, { to: "crack", minutes: 55, label: "往上", kind: "walk" }),
  ],

  seed: (w) => { w.setFlag(STEP, TOTAL); w.setFlag(A, TOTAL); w.setFlag(B, TOTAL); w.setFlag(PHASE, "done"); },

  script: (ctx) => {
    const rung = (which: string) => ctx.flag<number>(which, 0);
    const step = () => ctx.flag<number>(STEP, 0);

    /** 挂一把锁：从缆上取下来，或挂到下一段。 */
    const clip = (mine: string, other: string) => {
      const here = step();
      if (here >= TOTAL) return;

      if (rung(mine) === here) {
        if (rung(other) === -1) return bothOff(here);        // 两把都在手里
        ctx.setFlag(mine, -1);
        ctx.sfx("tock"); ctx.kick("clink", 0.6);
        ctx.hand(offset(at(here), 0, 9), "carabiner");
        return;
      }
      if (rung(mine) === -1) {
        const next = here + 1;
        ctx.setFlag(mine, next);
        ctx.sfx("clink"); ctx.kick("clink");
        if (rung(other) === next) {
          ctx.setFlag(PHASE, "climb");                        // 两把都过去了，现在得把人也弄上去
          ctx.say(["钢缆比看起来更凉。", "一步一步。风从右边来。", "越往上，人越小。", "最后一个锚点。上面是裂缝。"][here] ?? "", { tag: "cable-anchor" });
        }
      }
    };

    /** 两把锁同时离开钢缆：一次真正吓人的镜头下坠，3 分钟，重新挂回去。永远不会掉下去。 */
    const bothOff = (here: number) => {
      ctx.sfx("slip"); ctx.kick("slip", 0.8);
      ctx.setFlag(A, here); ctx.setFlag(B, here);
      ctx.bump("cable.slips", 1);
      ctx.spend({ minutes: 3, fatigue: 0.05 }, "两把锁同时离缆");
      ctx.flash("两把锁都离开了钢缆。手心一凉，重新挂回去。");
      ctx.world.emit("body:rest", { seconds: 3.6 });
    };

    /** 上去一段：拉缆快而费手，找岩点慢而不费手。代价已经写在 Interactable.cost 里，这里只管后果。 */
    const advance = (style: "cable" | "rock") => {
      const next = step() + 1;
      ctx.setFlag(STEP, next);
      ctx.setFlag(PHASE, next >= TOTAL ? "done" : "clip");
      ctx.setFlag(`cable.style.${next - 1}`, style);
      ctx.sfx("step"); ctx.sfx("grip"); ctx.kick("pull", style === "cable" ? 1.3 : 1.0);
      ctx.hand(at(next), "grip", true);
      if (style === "cable" && next === TOTAL) ctx.say("一路拉着缆上来的。手已经在抖了。", { tag: "cable-hands" });
    };

    ctx.onInteract("carabiner-blue",   () => clip(A, B));
    ctx.onInteract("carabiner-orange", () => clip(B, A));
    ctx.onHold("haul-cable", () => advance("cable"));
    ctx.onHold("rock-holds", () => advance("rock"));

    ctx.onInteract("anchor", () => ctx.say("锚点。铁环上有别人留下的漆记。", { tag: "cable-anchor-look" }));
    ctx.onInteract("view-down", (verb) => {
      if (verb === "photograph") return;                       // 拍照由 PhoneSystem 统一处理
      ctx.say("整条碎石路在下面变成一条线。今天早上我从那里走上来。", { tag: "cable-view" });
    });

    // 上方那两个人影：看见了才会在顶段认出他们（纯观察，零机制回报）
    ctx.onGaze("climbers-far", () => {
      ctx.setFlag("cable.sawClimbers", true);
      ctx.say("上面很远的地方有两个小点。也在往上爬。", { tag: "cable-climbers" });
    });

    // 帽子：风大的节点会被吹掉，0.4 秒内按住才抓得住（v4 §4）
    ctx.on("camera:impulse", ({ kind, strength }) => {
      if (kind !== "turn" || strength < 1.3) return;
      if (!ctx.world.state.inventory.worn.includes("cap")) return;
      if (ctx.world.rt.rng() > 0.12) return;
      ctx.world.emit("item:lose", { item: "cap", reason: "被风吹走" });
    });
  },
});
```

对照今天的 `carabinerAction`：规则一样，但音效、镜头、时间、疲劳分别由 AudioSystem、CameraBodySystem、ClockSystem、BodySystem 承担，脚本里只剩"锁扣与人怎么上去"这一件事。同一段代码在 Node 里跑（不装 browserSystems）也能完整推进状态——这就是无头冒烟能覆盖三条路径的前提。

### 7.2 `hutView.scene.ts` — 地图、山屋、巧克力

这是全片的决定点。原经历："走了一半，把地图摊开一看……当场决定：不去山屋不吃饭，素材不要了，吃了一板巧克力，紧急下撤。" 忠实做法是：决定点锁死在这里（必须先隔着山谷看见山屋），但**两条路都真的能选**——去山屋不是被一句拒绝文字挡回来，而是走一趟 `hutTurn`，回来时天光实打实少一截。

```ts
// src/scenes/hutView.scene.ts
import { defineScene } from "../engine/scene";
import { blaze, goArrow } from "./_shared";
import { MAP_LEGS, HUT_HOURS } from "../data/map";

const CHOICE = "hutView.choice";      // null | "hut" | "retreat"
const SPREAD = "hutView.mapSpread";
const TURNED = "hutView.turned";      // 去过 hutTurn 回来了

export default defineScene({
  id: "hutView",
  day: 1, place: "高原边缘 · 望见山屋", elevation: "2,760 m",
  painting: "pano/09b-hut.webp",
  body: "stand", material: "gravel",
  ambience: { wind: 0.7, windTone: 1350 },
  arriveAt: 16 * 60,
  exitWhen: { kind: "flag", key: CHOICE, eq: "retreat" },     // 巧克力不再是离开条件

  entities: [
    // 对面山谷里真的立着那栋房子
    { id: "hut", transform: { yaw: 18, pitch: 5, distance: 12 },
      sprite: { src: "sprites/hut.webp", layer: "prop",
                swap: [{ when: { kind: "afterMinute", minute: 17 * 60 }, src: "sprites/hut-lit.webp" }] },
      interactable: { verbs: ["inspect"], label: "山屋", reveal: 12, cost: { minutes: 1 } },
      gaze: { radius: 12, dwell: 800 } },

    // 纸地图：这一天第八次摊开。风大的节点要用石头压住（多 30 秒）
    { id: "paper-map", transform: { yaw: -8, pitch: -16, distance: 9 },
      sprite: { src: "sprites/map-folded.webp", layer: "prop" },
      interactable: { verbs: ["use"], label: "摊开地图", reveal: 12, cost: { minutes: 6 },
                      requires: { kind: "has", item: "paperMap" } },
      visible: { kind: "not", of: { kind: "flag", key: CHOICE, eq: "retreat" } } },

    // 巧克力：可以在这里吃（原样），也可以留到碎石坡体力见底时
    { id: "chocolate", transform: { yaw: 12, pitch: -18, distance: 9 },
      sprite: { src: "sprites/chocolate.webp", layer: "prop" },
      interactable: { verbs: ["use"], label: "巧克力", reveal: 12, cost: { minutes: 3 },
                      requires: { kind: "has", item: "chocolate" } },
      visible: { kind: "has", item: "chocolate" } },

    blaze("blaze-hut-a", { yaw: -30, pitch: -12 }, true),
    blaze("blaze-hut-b", { yaw: 26, pitch: -9 }, false),      // 旧测量点

    // 两个出口都真的存在
    { id: "go-hut", transform: { yaw: 20, pitch: -3 },
      exit: { to: "hutTurn", kind: "detour", label: "往山屋走", minutes: 22,
              condition: { kind: "flag", key: CHOICE, eq: "hut" } } },
    goArrow("go", { yaw: -26, pitch: -6 }, { to: "signpost", minutes: 30, label: "下撤", kind: "run" }),
  ],

  seed: (w) => {
    w.setFlag(CHOICE, "retreat");
    w.setFlag(SPREAD, 1);
    for (const leg of MAP_LEGS) w.state.journal.mapLegs[leg.id] = leg.hours;
  },

  script: (ctx) => {
    // 摊开地图 → 打开纸地图 overlay。夜里还得让补光灯照着纸（这里是白天，不涉及）
    ctx.onInteract("paper-map", () => {
      ctx.bump(SPREAD, 1);
      if (windy(ctx.world)) ctx.spend({ minutes: 0.5 }, "用石头压住地图角");
      ctx.world.dispatch({ type: "overlay:open", id: "paperMap" });
      ctx.say("我赶紧把地图啪地摊开。", { tag: "hut-map" });
    });

    // overlay 里勾一段路：读过展示牌的人有确切小时数，没读过的人自己估——她那天就是在信息不全下决定的
    ctx.on("ui:action" as never, ({ id, value }: { id: string; value: number }) => {
      if (!id.startsWith("map:leg:")) return;
      const legId = id.slice("map:leg:".length);
      ctx.world.state.journal.mapLegs[legId] = value;         // JournalSystem 负责写回与通知
      ctx.sfx("tick");
    });

    // 两个都是真的选择
    ctx.on("ui:action" as never, ({ id }: { id: string }) => {
      if (id === "map:choose:hut") {
        ctx.setFlag(CHOICE, "hut");
        ctx.world.dispatch({ type: "overlay:close" });
        // 没有惩罚文本，没有"你错了"——只有光。
        return;
      }
      if (id === "map:choose:retreat") {
        ctx.setFlag(CHOICE, "retreat");
        ctx.world.dispatch({ type: "overlay:close" });
        ctx.sfx("tick");
        ctx.say("地图上一段一段加起来，从头到尾至少十个小时。教练说的是六七个。", { tag: "hut-total" });
        ctx.say("紧急下撤。素材不要了，饭也不吃了。", { delay: 6500, tag: "hut-decide" });
      }
    });

    // 从 hutTurn 回来：山谷第一次完整露出来，太阳低了一格。她自己看得见。
    ctx.on("scene:enter", ({ from }) => {
      if (from !== "hutTurn") return;
      ctx.setFlag(TURNED, true);
      ctx.setFlag(CHOICE, null);                              // 决定重新回到她手上
      ctx.say("走回来了。太阳比刚才低了一格。", { tag: "hut-back" });
    });

    ctx.onInteract("hut", () => {
      const lit = ctx.world.state.clock.minuteOfDay >= 17 * 60;
      ctx.say(lit ? "山屋的窗户亮起来了。隔着一整个山谷。"
                  : "山屋就在对面。隔着一整个山谷。地图上写着两个半小时。", { tag: "hut-look" });
    });

    // 17:00：如果玩家还在这里，能看见他放弃的那个地方亮起灯（v4 §3.8 环境记忆②）
    ctx.onMark("hut-window-lit", () => {
      ctx.sfx("tick", 0.4);
      ctx.say("对面亮了一盏灯。", { tag: "hut-lit", priority: 1 });
    });

    ctx.onInteract("chocolate", () => {
      ctx.world.dispatch({ type: "item:use", item: "chocolate" });   // InventorySystem/BodySystem 结算
      ctx.say("一板巧克力。今天唯一的一顿饭。", { tag: "hut-choc" });
    });
  },
});
```

注意这里没有一处 `setTimeout`，没有一处 `setState`，也没有"合上地图"的完成门槛：**离开条件就是一个 Condition**，`exitWhen` 一行说清楚，`goArrow` 的箭头由 `SceneView` 依据它显现。今天 `isReady()` 里那 23 个分支，从此各归各家。

### 7.3 共享实体工厂

```ts
// src/scenes/_shared.ts
/** 红白漆记：每个户外节点 2–4 个，标签统一是"石头上的记号"，真假在凑近之前不可分辨。 */
export const blaze = (id: EntityId, transform: Transform, real: boolean): EntityDef => ({
  id, transform, blaze: { real },
  interactable: { verbs: ["inspect"], label: "石头上的记号", reveal: 12, cost: { minutes: real ? 0 : 1 } },
  visible: { kind: "not", of: { kind: "entity", id, is: "read" } },
});

/** "往前"：只有本节点的必做动作完成后才显现，显现半径比别的热点大得多。 */
export const goArrow = (id: EntityId, transform: Transform, exit: Omit<Exit, "condition">): EntityDef => ({
  id, transform, exit, tags: ["exit"],
  interactable: { verbs: ["inspect"], label: exit.label, reveal: 24 },
});

/** 相对某个位置挪一点：锁扣挂在锚点两侧，手伸向锚点上方。 */
export const offset = (t: Transform, dYaw: number, dPitch: number): Transform =>
  ({ ...t, yaw: t.yaw + dYaw, pitch: t.pitch + dPitch });

/** 风大的节点摊地图要用石头压住（cable / exit / summit / plateau / hutView）。 */
export const windy = (world: World) => WINDY_SCENES.includes(world.state.sceneId);
```

`BlazeSystem` 的行为对所有节点一致（确认真记号 → 这一段 `certainty`，不确认就走 → 按节点扣分钟），因此它是一个横向系统而不是每个场景抄一遍——这正是今天做不到的事。

---

## 8 存档：序列化整个 World

```ts
// src/engine/save.ts
export type SaveV5 = {
  version: 5;
  savedAt: string;
  build: string;                 // import.meta.env.VITE_BUILD，用于开发期识别旧档
  state: GameState;              // 就是它，全部
};

const KEY = "before-leaving-valley.journey.v5";
const RETIRED = ["…v1", "…v2", "…v3", "before-leaving-valley.journey.v4"];
const MAX_SNAPSHOTS = 12;        // 相册里保留原图的张数，超出只留标题（沿用今天的降级策略）

export function serialize(world: World): SaveV5 {
  const state = structuredClone(world.state) as GameState;
  // 只裁剪体积，不裁剪语义：照片原图是唯一可能撑爆 localStorage 的东西
  state.phone = trimSnapshots(state.phone, MAX_SNAPSHOTS);
  // 派生量一律不写（写了也会被 hydrate 忽略，这里删掉是为了让存档可读）
  delete (state as Partial<GameState> & { light?: number }).light;
  return { version: 5, savedAt: new Date().toISOString(), build: BUILD, state };
}

export function hydrate(save: SaveV5): GameState | null {
  if (save.version !== 5) return null;
  const state = { ...createInitialState(), ...save.state };
  // 向前兼容：新加的 slice 用默认值补齐；已删除的场景/实体/道具在读档时丢弃
  state.clock     = { ...createInitialState().clock, ...save.state.clock };
  state.body      = { ...createInitialState().body, ...save.state.body };
  state.power     = { ...createInitialState().power, ...save.state.power };
  state.inventory = { ...createInitialState().inventory, ...save.state.inventory };
  state.journal   = { ...createInitialState().journal, ...save.state.journal };
  state.inventory.items = state.inventory.items.filter(isItemId);
  state.journal.entries = state.journal.entries.filter(isEntryId);
  state.scenes = Object.fromEntries(Object.entries(state.scenes ?? {}).filter(([id]) => isSceneId(id)));
  if (!isSceneId(state.sceneId)) return null;
  return state;
}

/** v4 → v5：旧的 40 字段扁平 Flags 翻译成新结构。一次性代码，v5 稳定后可删。 */
export function migrateV4(raw: unknown): GameState | null {
  const old = raw as { node: string; flags: Record<string, unknown>; phone: PhoneState } | null;
  if (!old || !isSceneId(old.node)) return null;
  const state = createInitialState();
  state.sceneId = old.node;
  state.phone = old.phone;
  const f = old.flags ?? {};
  const map: Record<string, FlagKey> = {
    cableStep: "cable.step", crackStep: "crack.step", screeStep: "scree.step",
    forestStep1: "forest1.step", forestStep2: "forest2.step",
    hutChoice: "hutView.choice", signChosen: "signpost.chosen",
    letterPhotographed: "mailbox.photographed", summitSelfie: "summit.selfie",
    deerSeen: "deer.seen", callDone: "forestEdge.called", waved: "hairpin.waved",
    phoneReturned: "police.returned", letterTranslated: "bench.translated",
  };
  for (const [from, to] of Object.entries(map)) if (f[from] !== undefined) state.flags[to] = f[from] as FlagValue;
  if (f.helmet)  state.inventory.worn.push("helmet");
  if (f.clipped) state.inventory.worn.push("lanyard");
  if (f.chocolate) state.inventory.items = state.inventory.items.filter((i) => i !== "chocolate");
  if (f.phoneLost) state.flags["phone.lost"] = true;
  return state;
}
```

写档策略（SaveSystem）：

- 触发点：`scene:enter`、`flow:phase`、以及**静止 2 秒**（没有命令、没有过场、没有 overlay）。不再像今天那样把 `flags/phone/cameraAim` 全挂在一个 `useEffect` 依赖数组上每次变更都排一次 400 ms 定时器。
- 过场中（`travel:begin` 到 `travel:arrive` 之间）不写，避免存下"半步"。
- `bench.translated` 之后不写（片尾归零，与今天一致）。
- 写失败（配额）时按 `[12, 6, 2, 0]` 递减快照张数重试，沿用今天 `persistJourneySave` 的策略。

**存档的语义边界**：存的是"她走到哪儿、身上有什么、知道什么、这一天花了多少"。不存"画面现在什么样"——重新进游戏时，光由钟算、热点由条件算、台词从头排队，画面自然回到该有的样子。

---

## 9 开发与测试入口

### 9.1 `?node=` 跳转：场景自述完成态

今天的 `completeNode()` + `flagsUpTo()` 是两个 23 分支 switch，跟真正的机制分开维护，必然漂移。新做法：**每个场景自己写一个 `seed(world)`**，就在机制旁边，改机制的人一定会看见它。

```ts
// src/engine/dev.ts
export function warpTo(world: World, target: SceneId) {
  for (const id of SCENE_ORDER) {
    if (id === target) break;
    const def = SCENES[id];
    def.seed?.(world);
    world.patch("scenes", { ...world.state.scenes, [id]: { visited: true, entered: def.arriveAt ?? 0, entities: {} } });
  }
  const def = SCENES[target];
  world.patch("clock", { day: def.day, date: dateOfDay(def.day), minuteOfDay: def.arriveAt ?? 9 * 60 + 40 });
  world.patch("power", devPowerFor(target));          // forestEdge 之后相机是灰的，手机 8%，警局之后 61%
  world.set("sceneId", target);
  world.emit("scene:enter", { scene: target, from: null, warped: true });
}

export function applyDevParams(world: World) {
  if (!import.meta.env.DEV) return;
  const q = new URLSearchParams(location.search);
  const node = q.get("node");        if (isSceneId(node)) warpTo(world, node);
  const time = q.get("time");        if (time) world.patch("clock", { minuteOfDay: parseHHMM(time) });   // ?time=20:30 看夜色
  const fatigue = q.get("fatigue");  if (fatigue) world.patch("body", { fatigue: Number(fatigue) });
  const give = q.getAll("give");     give.filter(isItemId).forEach((item) => world.emit("item:gain", { item, from: null }));
  if (q.get("reveal") === "1") world.rt.forceReveal = true;    // 所有热点常显，用来校对热点落点
  if (q.get("nosave") === "1") world.rt.noSave = true;

  // 无头工具的把手：tools/probe.mjs / shot.mjs / smoke.mjs 用它驱动，而不是猜像素
  (window as unknown as { __world: World }).__world = world;
  (window as unknown as { __cmd: (c: Command) => void }).__cmd = (c) => world.dispatch(c);
  (window as unknown as { __log: string[] }).__log ??= [];
  world.on("scene:enter", ({ scene }) => (window as any).__log.push(`${formatGameTime(world.state.clock.minuteOfDay)} enter ${scene}`));
}
```

`?reveal=1` 从今天散在 JSX 里的 `DEV_REVEAL &&` 分支（八处）收敛成 `world.rt.forceReveal` 一个开关，由 GazeSystem 统一处理。

### 9.2 场景元数据即配速校验

每个场景有 `arriveAt`。DEV 启动时跑一次断言：`arriveAt(next) − arriveAt(prev) === exit.minutes`，偏差超过 5 分钟就在控制台报出来。v4 §3.1 那张重配平表因此不会退化成一段没人维护的文档。

### 9.3 无头回放（新增能力）

因为 `coreSystems` 不依赖浏览器，可以在 Node 里跑完整段剧情：

```ts
// tools/replay.mjs（用 tsx 或 vite-node 执行）
const world = createWorld({ systems: coreSystems, rng: seeded(42) });
loadScenes(world);
world.dispatch({ type: "flow", action: "begin" });
for (const command of ROUTE_FASTEST) { world.dispatch(command); world.tick(1 / 60, ZERO_GAZE); }
assert(world.state.sceneId === "bench");
assert(world.state.clock.minuteOfDay > 23 * 60);          // 她到公路一定在末班车之后
console.log(report(world));                               // 到达每个节点的时刻、疲劳曲线、错过了什么
```

三条路径（最省时 / 去过山屋 / 路牌走错一次）由三个命令序列表达，跑一次不到一秒。浏览器里的 `tools/smoke.mjs` 继续保留——它验证的是**投影与 DOM**（热点是不是真的能点到），职责不同，两个都要。

---

## 10 View 层

### 10.1 `PanoStage` 的唯一改动

它今天已经是一个好模块：自己的 rAF、自己的纹理缓存、自己的弹簧、每帧投影 `[data-yaw]`。只改两处：

1. **`light` 由数值驱动**：`TINT` 从 `Record<Light, number>` 改为 `tintFor(light: number)`，在 day → dusk → night 之间连续插值。props 里删掉 `light: "day" | ...`，改成 `light: number`。
2. **每帧回调**：新增 `onFrame?(dt: number, gaze: { yaw: number; pitch: number })`。`loop.ts` 把它接到 `world.tick`，全 App 只有一个 rAF，World 与画面永远同相位。没有 WebGL 时（无头、被降级）`loop.ts` 回退到自己的 rAF。

```ts
// src/engine/loop.ts
export function attachLoop(world: World, stage: { onFrame: FrameHook }) {
  let last = performance.now();
  return (dt: number, gaze: GazePoint) => {
    world.rt.now = performance.now();
    world.rt.gaze = gaze;
    world.tick(Math.min(0.05, dt), gaze);
  };
}
```

### 10.2 React 只订阅粗粒度状态

```ts
// src/view/useWorld.ts
export function useWorldValue<T>(select: (s: GameState) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const world = useWorldContext();
  const cache = useRef<{ revision: number; value: T }>({ revision: -1, value: undefined as T });
  const snapshot = () => {
    if (cache.current.revision !== world.revision) {
      const next = select(world.state);
      if (cache.current.revision < 0 || !equal(cache.current.value, next)) cache.current.value = next;
      cache.current.revision = world.revision;
    }
    return cache.current.value;
  };
  return useSyncExternalStore(world.subscribe, snapshot, snapshot);
}

/** 当前场景里"应该出现在画面上的东西"。只有可见性集合变化时才重算。 */
export function useEntities(): EntityView[] {
  const world = useWorldContext();
  return useWorldValue(() => buildViews(world), sameIds);
}
```

`SceneView` 把 `EntityView[]` 渲染成今天一模一样的 DOM——`<button className="hotspot" data-yaw data-pitch data-distance data-reveal>`。**样式表、`pano.css`、`motion.css`、`hud.css` 一行都不用改**，`PanoStage` 的投影契约也不变。这是整个迁移能一步一步来的关键：热点的 DOM 形状是稳定接口。

```tsx
// src/view/SceneView.tsx（骨架）
export function SceneView() {
  const world = useWorldContext();
  const scene = useWorldValue((s) => SCENES[s.sceneId]);
  const entities = useEntities();
  const anchorLayer = useRef<HTMLDivElement>(null);
  const light = useWorldValue((s) => Math.round(lightOf(s) * 40) / 40);   // 量化到 40 档，避免每分钟 re-render

  return (
    <>
      <PanoStage asset={scene.painting} light={light} anchorLayerRef={anchorLayer}
                 handleRef={world.rt.stageRef} onFrame={world.rt.frame} mode={scene.body} … />
      <div className="anchor-layer" ref={anchorLayer}>
        {entities.map((e) => e.kind === "prop"
          ? <PropSprite key={e.id} view={e} />
          : <Hotspot key={e.id} view={e} onCommand={world.dispatch} />)}
      </div>
      <DialogueLine />
      <HUD />
    </>
  );
}
```

### 10.3 高频量的去处

| 量 | 今天 | 之后 |
|---|---|---|
| 视线 look.x/y | `useState<LookPoint>` → 每次鼠标移动 re-render 整个 App | 写进 `world.rt.gaze` 与 CSS 变量；React 不参与 |
| 按住进度 climbHold | `useState` + rAF | `hold:progress` 事件 → `Hotspot` 用 ref 写 `style.setProperty("--hold")` |
| 天光 dusk | `useState<nodeSeconds>` 每秒 re-render | `lightOf(state)` 量化后进 props；`clock:light` 事件驱动音量 |
| 镜头弹簧 | 已在 PanoStage 内 | 不变 |
| 心跳/呼吸周期 | `useEffect` + `setInterval` | CameraBodySystem 的 tick |

---

## 11 忠实性守卫（DEV 期断言）

架构要能主动保护事实，而不是靠人记住。`engine/policy.ts` 在 DEV 下订阅事件并断言：

```ts
export const INVARIANTS: Array<{ id: string; check: (w: World) => boolean; why: string }> = [
  { id: "mailbox-before-summit", why: "信箱在半途悬崖，不在山顶",
    check: (w) => !w.state.scenes.summit?.visited || Boolean(w.state.flags["mailbox.photographed"]) },
  { id: "first-car-passes", why: "第一辆车必定过，第二辆必定停，且没有第三辆",
    check: (w) => Number(w.state.flags["hairpin.cars"] ?? 0) <= 2 },
  { id: "phone-lost-in-forest2", why: "手机在 forest2 第三步无声滑落，没有音效提示也没有文字宣告",
    check: (w) => !w.state.scenes.hairpin?.visited || Boolean(w.state.flags["phone.lost"]) || Boolean(w.state.flags["police.returned"]) },
  { id: "returned-at-police", why: "手机在警局回来，不在别处",
    check: (w) => !w.state.flags["police.returned"] || w.state.sceneId === "police" || w.state.scenes.police?.visited },
  { id: "letter-only-by-phone", why: "只有这部手机拍下了那封信",
    check: (w) => !w.state.flags["mailbox.photographed"] || w.state.phone.photos.some((p) => p.kind === "letter") },
];

/** 叙事政策：禁止任何提醒、劝阻、反思式的文字（DESIGN_LOCK §3）。 */
const FORBIDDEN = [/注意安全/, /小心/, /务必/, /建议你/, /记得带/, /不应该/, /本可以/, /教训/, /提醒/];
export function checkLine(line: string) {
  if (!import.meta.env.DEV) return;
  const hit = FORBIDDEN.find((re) => re.test(line));
  if (hit) console.error(`[policy] 台词违反叙事政策（${hit}）：${line}`);
}
```

`DialogueSystem` 每次入队时调用 `checkLine`；`InvariantSystem` 在每次 `scene:enter` 时跑一遍 `INVARIANTS`。受保护原文（`data/letter.ts` 的九行意大利语与译文、`CLOSING_LINES`）用 `Object.freeze` 并在 DEV 下校验哈希——任何人改动都会立刻被发现。

---

## 12 迁移计划：十二步，每一步之后游戏都能跑

每一步的验收都是同一句话：`npm run build` 通过、`node tools/smoke.mjs` 打印 SMOKE PASS、控制台零错误、`?node=` 仍然可用。**任何一步做不到，就把这一步再拆小。**

### 第 1 步 · 引擎骨架（零行为变化）

新建 `engine/{types,bus,world,command,condition}.ts` 与 `systems/index.ts`。`GameState` 先只有 `settings` 与 `phase` 两块，`App.tsx` 通过 `WorldProvider` 拿到 world，把设置面板改成读 world。其余一切不动。
*保持可运行*：App 里其他 `useState` 一个都不删。

### 第 2 步 · Flags 搬家（键名先不改）

`saveModel.Flags` 的 40 个字段原样搬进 `GameState.flags`，App 用 `useWorldValue` 读、`world.setFlag` 写，删掉 `useState<Flags>` 与 `patch()`。存档层写一个双向适配（读 v4 写 v4），行为完全不变。
*保持可运行*：适配层保证旧存档继续能读。

### 第 3 步 · ClockSystem 与 D1 修复

`spend()` 改成 `clock:advance` 事件；`phone.minuteOfDay` 成为唯一时钟；新增 `lightOf()`；`PanoStage` 的 `light` 改为数值并连续插值；删除 `nodeSeconds` 与由它驱动的 `dusk`。同时把 v4 §3.1 的行程时间表灌进 `NODES.minutes`。
*保持可运行*：`AMBIENCE`/`MATERIAL` 表暂时留在 App 里。
*额外验收*：`?time=20:30` 能看到日落之后的画面；站着不动天不再变黑。

### 第 4 步 · 场景数据化（一次三个节点）

新建 `engine/scene.ts` 与 `scenes/`。先把 `meadow`、`approach`、`plaque` 三个节点写成 `.scene.ts`（只用 Transform / Sprite / Interactable / Exit），`SceneView` 渲染这三个节点的实体，App 的 JSX 里对应的热点块删掉。其余 20 个节点仍走老路径——`SceneView` 里一句 `SCENES[node] ? <SceneView/> : <LegacyNode/>` 让两套并存。
*保持可运行*：并存是这一步的全部技巧；一次三个，跑一次冒烟。

### 第 5 步 · InteractionSystem 与场景脚本

把 `putOnHelmet` / `clipIn` / `carabinerAction` / `grabHold` / … 逐个搬进对应的 scene script，`isReady()` 的分支逐条变成场景的 `exitWhen`。每搬完一个节点就把 App 里对应的函数和 JSX 删掉，冒烟一次。搬完最后一个节点时，`isReady()`、`completeNode()`、`flagsUpTo()` 与那一大段 JSX 一起消失。
*保持可运行*：老的 `LegacyNode` 分支在最后一个节点搬完后才删。

### 第 6 步 · DialogueSystem / AudioSystem / CameraBodySystem

`say` / `flash` / `sfx` / `kick` 变成事件；`AMBIENCE`、`MATERIAL`、`WIND_PAN`、`GUSTY`、`MUSIC_TRACKS` 从 App 移到场景定义与 AudioSystem；呼吸、心跳、阵风、雨刷的 `setInterval` 全部收进 CameraBodySystem/AudioSystem 的 tick。
*保持可运行*：这三个系统只订阅，不改状态，出错也只影响表现。
*额外验收*：`clearTimers()` 与 `timersRef`/`entryTimersRef` 删除后无残留计时器（离开节点时用 DEV 断言检查 `rt.timers.size === 0`）。

### 第 7 步 · SaveSystem v5

`GameState` 整体序列化；写 `migrateV4`；存档键升到 v5；写档时机改为进场景 / 静止 / 阶段切换。`?nosave=1` 上线。
*保持可运行*：旧档通过迁移进入新档；迁移失败则回到标题页（不崩）。

### 第 8 步 · dev warp 改为 seed

每个 `.scene.ts` 补上 `seed()`；`warpTo()` 取代 `flagsUpTo`/`createDevPhone`；`?reveal=1` 收进 `rt.forceReveal`；`window.__world` / `window.__cmd` 上线；`tools/probe.mjs`、`tools/shot.mjs` 改为通过 `__cmd` 驱动。
*额外验收*：23 个节点逐个 `?node=` 打开，热点位置与今天一致（用 `tools/shot.mjs` 对比截图）。

### 第 9 步 · InventorySystem + JournalSystem（v4 一期系统的第一批）

背包（一块布）、14 件道具、本子 entry、纸地图取代勾选列表。`plaque` 的装备检查改为从布上拿出来穿。
*保持可运行*：道具默认全给，先让背包只是"能打开、能看见"，再逐节点接上 `requires`。

### 第 10 步 · BodySystem + PowerSystem

`fatigue` / `fear` / adrenaline；三块电与补光灯的宽光窄光。接进 `PanoStage.tension`、`holdMs`、`GazeSystem` 的 reveal 系数、`GAIT.pitchOffset`。
*额外验收*：`tools/replay.mjs` 的三条路径跑出三条不同的疲劳曲线与到达时刻，且都能通关。

### 第 11 步 · GazeSystem 取代计时器叙事

两位攀登者、直升机、鹿群、第一辆车、那位女士改为凝视触发；`TriggerSystem` 接管环境记忆（喊过一声则鹿已走、17:00 山屋亮灯、确认过的漆记留高光、第二天倒伏的草）。
*额外验收*：全局搜索 `setTimeout` 在 `src/scenes` 与 `src/systems` 下的命中数为 0（`SceneCtx.after` 除外，且只用于表演，不用于推进剧情）。

### 第 12 步 · View 收尾与新节点

`App.tsx` 拆成 `view/*` 并删除；`GameRoot.tsx` 控制在 100 行以内。随后按 v4 §附的顺序加新节点（roadside、slab、searchPath…）——此时加一个节点＝新建一个 `.scene.ts` 并在 `scenes/index.ts` 里加一行，不再需要碰任何别的文件。**这一步能不能做到"只加一个文件"，就是整次重构成不成功的唯一判据。**

---

## 13 旧代码到新结构的对照表

| `App.tsx` 里的东西 | 新家 |
|---|---|
| `useState<Flags>` + `patch()` | `GameState.flags` + `world.setFlag` |
| `isReady()` | 每个 `SceneDef.exitWhen`（Condition） |
| `completeNode()` / `flagsUpTo()` | 每个 `SceneDef.seed()` + `engine/dev.warpTo` |
| `clockFor()` / `createDevPhone()` | `SceneDef.arriveAt` + `warpTo` |
| `AMBIENCE` / `MATERIAL` / `WIND_PAN` / `GUSTY` / `CLOUDY` / `MOTES` | `SceneDef.ambience` / `.material` / `.weather` |
| `walkOn()` | `InteractionSystem` 的 `travel` 命令 + `travel:begin/arrive` |
| `carabinerAction` / `grabHold` / `takeScreeStep` / `chooseArm` / `beginClimb` | 对应 `.scene.ts` 的 script |
| `say` / `flash` / `thoughtTimerRef` / `entryTimersRef` | `DialogueSystem` |
| `sfx()` / `kick()` / `recover()` | `AudioSystem` / `CameraBodySystem` 订阅 `sfx` / `camera:impulse` / `body:rest` |
| `schedule()` / `clearTimers()` | `SceneCtx.after`（离场自动清）+ `ClockSystem` 的定点事件 |
| 那 8 处 `DEV_REVEAL &&` | `world.rt.forceReveal` + `GazeSystem` |
| `overlay` 的 7 个分支 | `GameState.ui.overlay` + `view/overlays/*` |
| `PHONE_BEATS` / `RETURNED_MESSAGES` / `PHONE_REPLIES` | `data/contacts.ts` + 对应场景的 `onMark` / `onInteract` |
| `saveModel.ts` | `engine/save.ts`（v5） |
| `story.ts` 的 NODES 与全部交互表 | `scenes/*.scene.ts` + `data/*.ts` |

---

## 14 成本与收益（一句话结账）

这一次重构不新增任何画、不新增任何文案、不改任何事实，代价是把 1275 行的一个文件变成大约 40 个平均 60–150 行的文件，工作量集中在第 4、5 两步（约占全部工作的六成）。收益只有一条，但它是唯一重要的一条：

> 加一个节点、加一件道具、加一条规则，从"改三个地方并祈祷"变成"新建一个文件"。

v4 里那 8 个系统、29 个节点、14 件道具，只有在这个结构上才加得完；在今天的结构上，第三个系统就会把前两个压塌。
