# QA 报告 · 引擎版（2026-09-07 收敛）

## 状态

- **可通关**：`node tools/replay.mjs all` 三条路线（最快、去过山屋 hutTurn、路牌走错一次）从标题页起全程无头回放到片尾，`REPLAY PASS`；无异常、无 console error、无 `[policy]` 不变量报错。
- **配速**：09:40 出发 → 23:26 到公路（基准 23:00 ±15）；进 forest1 20:33（日落 20:15 之后）；hairpin 22:57（末班车之后）；第二天 08:40 搜索；第三天 11:13 长椅译完。
- **构建**：`npx tsc --noEmit` 无错；`npm run build` 通过（1.07 MB / gzip 294 KB）；生产包实测标题 → 下车 → 草甸可走（无 dev 钩子）。
- **场景审查**：29 个场景经 Opus xhigh 逐场审查，27 场通过；car 与 hutView 最后两条已按审查意见修正（车内夜间调色、乘客入座、手搭轮缘；山屋回到真实比例，17:00 只亮一扇窗），未再复审。
- **引擎修正**（审查中发现）：世界自持帧循环（标题页也 tick）；StrictMode 不再销毁系统；settled 热点真的变暗；sprite.className 到 img；站着不动按指针判定（步态不再打断 wait）；任何两句台词 ≥6 s；拍照不再让手机时钟双走；scree/signpost/deer 可喊；车里她手上没有手机。

## 未收敛（明确留下）

- **美术**：`docs/ART_QUEUE.md` 末尾列出的 14 项仍未通过视觉审查（夜林四枚树皮记号的家族一致性、开盖信箱、直升机、倒木/岩石夜间版、near 尾灯、手搭轮圈、裂缝岩台、假岩点裂纹、膝印、裂缝岩点、浮石）。现有版本已装在盘上，缺图时视图自动隐藏，不影响逻辑。
- 审查者列出的 minor 项（标签遮挡、个别坐标差 1–2°、注释措辞）未处理。
- `deer-herd` 全是公鹿而 §7 有小鹿；`deer-shadows-alert` 在 50 px 高时与 shadows 分不出。

## 工具

见 `tools/README.md`：`drive.mjs`（命令驱动）、`placement.mjs`（实体落位图）、`replay.mjs`（全程回放）、`grid.py`、`key-sprite.py`、`sprite-fit.py`、`gen-image.sh`（Grok，402 时退到 Codex）。
