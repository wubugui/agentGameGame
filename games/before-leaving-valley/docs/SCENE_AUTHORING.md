# 场景作者契约（Scene Authoring Contract）

每一个节点是一个文件：`src/scenes/<id>.scene.ts`。它是**数据**（实体、条件、出口）加**一段脚本**（对事件的回应）。你写的是一个游戏关卡，不是一个网页。这份文件是作者与审查者共用的唯一契约；`docs/GAME_DESIGN_v4.md` 讲"该有什么"，本文讲"怎么写、怎么验"。

## 0 红线（任何一条违反即打回）

1. **忠实**：事件与事实以 `docs/SOURCE_TRANSCRIPT.md` 为准，`GAME_DESIGN_v4.md` §7 决策表和 §8 节点表就是你这一场的规格。不发明数字、对白、事件。§12 B1–B10。
2. **不是视觉小说**：没有入场播报，没有"继续"按钮，没有把玩家按着头看的东西。剧情节拍由玩家的**看**（gaze）、**做**（interact/hold）、**等**（wait）、**钟**（clock:mark）触发。`ctx.after()` 只准用于 1 秒以内的物理反馈（手回来、二段音效），**绝不用来推进剧情**。
3. **她不复述玩家能自己读到的东西**。单句 ≤26 字（原话除外），没有提醒、劝阻、反思、解释。一个场景里 `ctx.say` 调用不超过 8 处，且大多数动作的反馈应是**身体与世界**（`kick`、`hand`、`sfx`、`fx`、精灵切换、钟走、电量变），不是文字。
4. **前景画里不烙死任何会动/会拿/会变的东西**——那些是精灵（`sprite`）。作者本人永远不出现在任何图里。
5. **每个热点必须落在画里画着的那个东西上**（用网格图定位，见 §2），标签必须是画里那个东西的名字。点了草不能说踩了石头。
6. 没有 game over、没有失败、没有分数。错误只花分钟和光。
7. 每个场景**至少两个**需要玩家判断的可选动作（不含必做的），屏幕上没有任何东西提示它们存在（A1）。§8 标了错误出口/死路的场景必须做出来（A3/A4）。
8. 不得出现任何"显示身体状态"的数字或开关；恐惧、体力、灯电量只通过声音、抖动、镜头、光圈表现（D4）。

## 1 你能改什么

- **只写** `src/scenes/<id>.scene.ts`。它必须 `export default defineScene({...})`，并且已被 `src/scenes/index.ts` 引入（不要动 index）。
- **只读**：`src/engine/*`、`src/systems/*`、`src/data/*`、`src/view/*`、`src/scenes/_shared.ts`、其它场景文件。需要新增本子条目（`data/entries.ts`）、数据表、CSS 类、精灵、系统能力时，**不要自己改**，写进你的结构化输出的 `requests` 里，由集成者合并。
- 精灵文件可以引用尚不存在的路径（`sprites/<kebab-id>.webp`），美术随后生成；图片缺失时视图会隐藏它，不会报错。但每一个你引用的精灵都必须在输出的 `sprites` 里给出描述、光照时段、屏幕高度与位置。
- 类型检查用 `npx tsc --noEmit -p tsconfig.app.json`（不要用 `tsc -b`，多人并行时 tsbuildinfo 会打架）。

## 2 坐标：网格图是唯一依据

每张画是 150°×84° 的球面片，画面像素与角度**线性**对应：

```
yaw   = (x / W − 0.5) × 150        pitch = (0.5 − y / H) × 84
```

不要用旧文档里的 `0.071°/px`（那是错的，差 1.65 倍，正是过去热点跑偏的原因）。

- 网格图：`<scratchpad>/grids/<画名>.png`（1280 宽，每 10° 一条线，边缘标了度数）。用 Read 看它，读出你要的东西在哪一格，直接写 yaw/pitch。
- 干净图：`<scratchpad>/plain/<画名>.png`。
- 验证：`node tools/placement.mjs <sceneId> out.png` 把你场景里**每个实体**画在网格图上（带 id 与坐标），然后 Read 那张 png——每一个框都必须压在画里对应的东西上。这一步不可省。
- `distance`：10 = 自然距离；越大越远（用于视差与远景），`sizeVh` 是精灵**最终在屏幕上的高度**（vh，视口高 = 60°）。尺寸常识：1.65 m 的人在 d 米外 ≈ `143/d` vh（5 m → 29vh，10 m → 14vh，30 m → 5vh）；1.2 m 的鹿 25 m 外 ≈ 5vh；3 m 高的公交 35 m 外 ≈ 9vh。
- 视口只显示中间约 ±45° yaw / ±30° pitch，玩家转头能看到 ±75° / ±42°。把主要热点放在 ±40° 内，把"要找的东西"可以放到边上。
- 每个场景带 DOM 节点的实体（有 `interactable` / `sprite` / `gaze` / `exit` 的）**≤ 16 个**。

## 3 实体速查（`src/engine/entity.ts`）

```ts
{ id, transform: {yaw, pitch, distance?} | (world) => Transform,
  visible?: Condition, enabled?: Condition, tags?: string[], className?: string,
  sprite?: { src, layer?: "back"|"prop"|"figure"|"hand", sizeVh?, swap?: [{ when: Condition, src }] },
  interactable?: { verbs: Verb[], label, reveal: 度, cost?: {minutes,battery,camera,lamp,fatigue,fear}, requires?: Condition, once?: boolean },
  readable?: { kind, title, lines, entry?, minutes },   // verb "read" → 阅读 overlay + 本子条目
  collectible?: { item, consumesEntity? },              // verb "take" → item:gain
  exit?: { to, kind: "walk"|"run"|"back"|"detour", label, minutes, condition? },
  hold?: { ms, scaleWith?: ["fear"|"fatigue"|"lamp"] }, // verb "hold" → 按住；完成发 hold:complete
  gaze?: { radius, dwell },                            // 视线停留 dwell ms → gaze:dwell → ctx.onGaze
  trigger?: { source: {on:"enter"|"gaze"|"minute"|"idle"|"event"|"flag", ...}, when?, once?, tag },  // 非视线来源也走 ctx.onGaze(id)
  blaze?: { real } }
```

- 动词：`inspect | read | take | use | clip | step | hold | photograph | talk | wave`。`InteractionSystem` 先查 `visible/enabled/once/requires`（`requires` 不满足：手伸出去又收回，无文字），再扣 `cost`，再按组件做事，最后发 `interact:done` → `ctx.onInteract(id, verb => ...)`。
- `_shared.ts` 工厂：`blaze(id, t, real)`、`goArrow(id, t, exit)`（只有 `exitWhen` 满足才能走）、`backArrow(id, t, to)`（永远能走）、`wrongWay(id, t, label, minutes, line)`、`readable(...)`、`lookAt(...)`、`pickup(...)`、`prop(...)`、`offset(t, dYaw, dPitch)`、`windy(world)`、`isNight(world)`。
- `tags: ["action"]` 的实体不投影到画上，而是变成屏幕下缘的 E 键动作按钮（打招呼、点头、回答……这类"对人做的事"）。
- `exit.kind: "back"` 永远可走；其它出口受 `exitWhen`（场景级）或 `exit.condition` 约束。`canLeave` = `exitWhen` 为空或成立。
- 现有 CSS 类：`go-hotspot back-hotspot wrong-hotspot blaze-hotspot climb-hotspot carabiner-hotspot hold-hotspot foot-hotspot search-hotspot counter-hotspot`；精灵容器 `prop-item`。

## 4 脚本 API（`SceneCtx`，见 `src/engine/scene.ts`）

`onInteract(id, fn(verb))`、`onGaze(id, fn)`、`onHold(id, fn)`、`onRelease(id, fn(progress))`、`onMark(tag, fn)`（钟：`hut-window-lit` 17:00 / `crickets-in` 18:00 / `wind-turns` 19:30 / `sunset` 20:15 / `last-light` 21:05）、`onWait(fn(seconds))`（指针静止 4 秒触发，之后每 8 秒一次）、`onAction(id, fn(value))`（overlay 按钮）、`onEnter(fn(from))`、`on(event, fn)`（任意事件，见 `src/engine/bus.ts`）。

输出：`say(line, {priority?, tag?, delay?})`（priority 1 才能打断当前句；两句间隔 <6 s 的低优先级句子会被丢弃，**永不排队**）、`flash(text)`（角落一行小字，用于本子/地图这类"记下了"）、`sfx(name, pan?, strength?)`、`kick(kind, strength?, dir?)`（镜头：step/land/slip/pull/clink/jolt/brake/turn/shout/settle/glance）、`hand(transform, "grip"|"carabiner", hold?)`、`fx("dust"|"shout"|"brake"|"flashlight"|"gust")`、`spend(cost, reason)`、`flag/setFlag/bump`、`entity(id).patch/set/get`、`give(item)`、`lose(item, reason)`、`learn(entryId)`、`travel(scene, {run, minutes})`、`open(overlay, data)` / `close()`（overlay：`pack paperMap notebook call findmy hotelCalls selfie board reading`）、`read(id)`、`transformOf(id)`、`minute()`、`light()`（0–1，日落 20:15 前 90 分钟开始变暗）。

命令（玩家输入，也是无头回放用的）：`ctx.world.dispatch({type:"interact", entity, verb})`、`hold:start/hold:end`、`travel {entity}`、`wait`、`pack:open/close/equip/stow`、`item:use {item}`、`lamp:mode {mode}`、`phone:open/close/shoot/send`、`overlay:open/close`、`ui:action {id, value}`、`shout`、`growl:start/end`。

## 5 系统事实（你依赖它们，不要重做它们）

- **钟**：所有花费走 `cost.minutes` / `ctx.spend`。`arriveAt` 只用于 `?node=` 跳转。光 = `lightOf(state)`；`clock:mark` 见上。
- **本子**：`readable.entry` 或 `ctx.learn(id)` 写入 `journal.entries`（id 必须在 `data/entries.ts` 里，否则只会 console.warn）。`knows("E-x")` 做条件。地图页 `paperMap` overlay 由 `journal.mapLegs` 驱动。
- **漆记**：`blaze(id, t, true)` 被确认 → `<scene>.certain = true`、`blazesFound+1`，第一次给"红白红。跟着这个走。"；假的 → +1 分钟。离开时没确认漆记的代价由**场景自己**在 `travel:begin` 里扣（见 meadow）。D6：没找到漆记也必须能走。
- **身体**：`body:fatigue {delta}`（戴手套 ×0.6）、`body:fear {delta}`（只在 forestEdge/forest1/forest2 涨）、`body:slip {severity}`、`body:rest {seconds}`；等待 −0.04；巧克力 −0.25 疲劳 −0.15 恐惧；日落时巧克力还在包里 +0.15。按住时长 = `ms × (1 + fear·0.9 + fatigue·0.6) × (灯灭 ×2)`。
- **电**：拍照 −1% 手机 −1 分钟；夜里开屏 −4% 并 +0.12 恐惧；进 forestEdge 相机归零、手机压到 9%；补光灯拿出后按分钟耗，宽光快窄光慢，灯永远不彻底灭（0.15 余烬）。
- **手机**：`phone:shoot` 拍当前画；`phone:send {contact: "xiaoyu"|"mama"|"asha"}` 有固定回信；`phone.lost` 后 `phone:open` 只会让手伸向空口袋。丢手机 = `ctx.lose("phone", reason)`（InventorySystem 会设 `phone.lost/phone.lostAt` 并发 `phone:lost`）。归还 = `ctx.give("phone")` + `setFlag("police.returned", true)` + `world.emit("phone:returned", {})`。
- **Overlay 已有的动作 id**：`call:try {value: "where"|"alone"|"phone"}` / `call:hangup`（`open("call", {connected: true})`）、`findmy:off`（`open("findmy", {closing: true})`）、`hotel:call {value: index}` / `hotel:hangup`（记录在 flag `hotel.called` 逗号串）、`map:leg:<id> {value: hours}`、`map:objective`、`map:choose:hut` / `map:choose:retreat`、`bench:translate`。手机对话页被看过 → `E-coach` 自动写入本子。
- **视线半径**：最终 ≥11°，白天更大，夜里窄光 ×0.5 宽光 ×1.15 灯灭 ×0.45。要"凑近才读得清"的东西用 `reveal: 12`。
- **音乐**：白天曲在 DAY_MUSIC 场景且光 >0.2；`car` 暖曲；`bench.translated` / `police.returned` 后结尾曲。不用你管。
- **动作按钮键**：P 手机、I 背包、Esc、E 故事动作、空格（林中喊/低吼）。

## 6 `seed(world)`：让 `?node=` 跳转与不变量成立

`warpTo` 会顺着主线把之前每个场景的 `seed` 跑一遍。你的 seed 必须把**本场景完成后**别的场景/系统依赖的一切设好：flags、物品（`give/lose` 直接 `world.patch("inventory", ...)` 或发 `item:gain/item:lose`）、本子条目、手机照片。硬性要求（`src/engine/policy.ts` 的不变量）：

- `mailbox`：`mailbox.photographed = true`，`phone.photos` 里有一张 `kind: "letter"`（用 `phoneDispatch(world, {type:"capture_photo", photo:{..., kind:"letter"}})`，从 `systems/UISystem` 引入），物品 `letterPhoto`。
- `hairpin`：`hairpin.cars = 2`，`hairpin.waved = true`。
- `forest2`：手机已丢（`item:lose phone`）。
- `police`：`police.returned = true`，手机回到 `inventory.items`。
- 其它：`<scene>.certain`、`hutView.choice = "retreat"`、`signpost.chosen = "656"`、`scree.step = 6`、`deer.seen = true`、`forestEdge.callDone = true` 且补光灯在手（`hands` 含 `fillLight`，`power.lampMode = "wide"`）、`summit.selfie = true`、`busStop.answered/boarded`、`bench.translated`。

**跨场景 flag 命名表**（上下游必须一致）：`meadow.certain approach.certain plaque.clipped cable.step cable.a cable.b cable.phase crack.step crack.wet crack.sat slab.seenBox mailbox.clipped mailbox.opened mailbox.page mailbox.photographed exit.nodded exit.step summit.selfie summit.helicopter summit.sent plateau.route plateau.stillness ledge.seen hutView.choice hutView.mapSpread hutView.certain hutView.turned hutTurn.mapSpread signpost.chosen signpost.wrong scree.step scree.style.<n> scree.lookedUp deer.seen deer.how forestEdge.callTries forestEdge.callDone forestEdge.zipped forest1.step forest2.step phone.lost phone.lostAt hairpin.stance hairpin.signal hairpin.cars hairpin.waved hairpin.leftBehind car.water car.looked car.lines search.spots(逗号串) hotel.called hotel.hungUp hotel.findmyOff busStop.answered busStop.asked busStop.photo busStop.boarded police.returned police.gallery bench.lines bench.translated chocolate.eatenAt shout.at <scene>.shouted`。

## 7 `walkthrough`：无头回放

`walkthrough: WalkStep[]` 是**最快的合法通关路径**——一串命令（与玩家输入同形）和 `{ wait: ms }`，**最后一步必须是离开本场景的命令**（`travel` 或触发 `travel` 的动作）。按住类：`{type:"hold:start", entity}`, `{wait: 1600}`, `{type:"hold:end"}`（时长要给足 fear/fatigue 放大后的值，宽松取 2×）。`variants` 可选：`"detour"`（走进死路再回来）、`"wrong"`（走错一次）等。回放工具会逐场景执行并要求 `sceneId` 变为下一场；变体路线由集成者拼接。

## 8 验证（必须做完，并在输出里附上结果）

1. `npx tsc --noEmit -p tsconfig.app.json` 无错误。
2. `node tools/placement.mjs <id> <scratchpad>/placement/<id>.png` → Read 图，逐个核对；不对就改坐标再跑。
3. 把 walkthrough 抄成一段脚本（`__cmd(step)` + `await sleep(ms)`，末尾 `window.__trace.push(__world.state.sceneId)`），跑 `node tools/drive.mjs "<id>&reveal=1&nosave=1" walk.js 9000 <scratchpad>/shots/<id>.png`，确认输出里 `scene` 已是下一场、`exceptions` 为空、`console` 里没有 `error:`（`[policy]` 的不变量报错也算）。若画面黑（无头 GPU 偶发），不影响状态判断。
4. Read 那张截图，看热点标签、精灵尺寸是否合理（这是玩家看到的视口）。

## 9 输出格式（结构化）

```
{ scene, file, entitiesWithNodes: n,
  optionalActions: [..≥2..], wrongExits: [...], deadEnds: [...],
  beats: [{ trigger: "gaze|interact|hold|mark|wait", what }],
  sprites: [{ id, path, description, lighting: "day|dusk|night|interior", sizeVh, yaw, pitch, distance, states?: [...] }],
  requests: { entries: [{id, title, text, mapLegs?}], data: [...], css: [...], engine: [...] },
  seedSets: [...flags/items...],
  walkthrough: "ok|fail + 说明", placementChecked: true/false, tscClean: true/false,
  notes }
```
