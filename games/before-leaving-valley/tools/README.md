# 美术管线

所有场景板与精灵由 Grok Build（`grokvpn`，走本机 7078 代理）的 `image_gen` / `image_edit` 生成，再用 ffmpeg 转 WebP。

## 生成一张全景画（v3 节点形式）

每个节点一张 16:9 宽幅画，从原视频对应截帧用 image_edit 重绘（保留同一地点、同一视角，去掉字幕、水印和博主本人）；夜景与室内没有对应截帧的，用文字描述生成。转换：`ffmpeg -i in.jpg -vf scale=2048:-2 -c:v libwebp -quality 86 public/pano/NN-name.webp`。

## 生成一张图

```bash
# 全新构图
tools/gen-image.sh out.jpg 16:9 "提示词……"
# 从已有画板衍生（保证同一座山、同一支笔）：把参考图路径接在后面
tools/gen-image.sh out.jpg 16:9 "Keep this painting exactly as it is … only add …" public/art/stage1-viewpoint-clean-v2.webp
```

规则：新场景板一律用 image_edit 从相邻已有画板衍生；只有全新地点才用 image_gen，并在提示词里写明画风（hand-painted anime background, soft painterly brushwork, sage green / grey-blue / cream / apricot / coral）。

## 场景板转 WebP

```bash
ffmpeg -y -i out.jpg -c:v libwebp -quality 84 public/art/name-v1.webp
```

## 透明精灵

让模型把主体画在纯绿背景上（"isolated on a flat, solid, uniform bright green background"），然后：

```bash
python tools/key-sprite.py in-green.jpg keyed.png      # 按绿色度抠图、去溢色、裁到内容
ffmpeg -y -i keyed.png -c:v libwebp -quality 92 public/art/name-v1.webp
```

`key-sprite.py` 兼容本机的 Python 2.7 + PIL + numpy。

## 自动通关冒烟测试

把 `tools/autoplay.js` 整段粘进浏览器控制台（停在标题页），它会用合成事件从下车一路点到完成页（含一次故意的滑落、一次走错路牌、按住攀爬、两次挥手），时间线写在 `window.__log`。

更稳的做法是用无头 Chrome 跑（不受浏览器面板隐藏时的定时器限制）：

```bash
npm run dev -- --port 5174   # 另开一个终端
node tools/smoke.mjs         # 输出时间线，最后打印 SMOKE PASS / FAIL，并列出控制台错误
```

单场景无头截图（真实 1280×720 布局，不受面板影响）：

```bash
node tools/shot.mjs mailbox out.png "document.querySelectorAll('.hotspot').forEach(h=>{if(h.textContent.includes('信箱'))h.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))})" 1500
```

首屏测量：`node tools/perf.mjs`（先 `npx vite preview --port 5175`）。

JS 探针（在真实布局下读取任意表达式的值）：

```bash
EVAL="document.querySelector('.go-hotspot').getBoundingClientRect().toJSON()" node tools/probe.mjs meadow x "" 1500
```

QA 记录见 `docs/QA_REPORT.md`。

## 引擎版工具（2026-09-05）

- `node tools/drive.mjs "<node>&reveal=1&nosave=1" script.js [waitMs] [out.png]`：无头驱动引擎。脚本里可用 `__world`、`__cmd`、`__scenes`、`__resolve`，顶层 `await` 可用；打印状态摘要、`window.__trace`、console 与异常。
- `node tools/placement.mjs <scene> out.png`：把场景全部实体（含不可见的）画到该画的 yaw/pitch 网格图上，核对热点是否压在画着的东西上。
- `python tools/grid.py painting.webp out.png [markers.json]`：网格图（画是 150°×84° 的球面片，`yaw = (x/W − 0.5) × 150`，`pitch = (0.5 − y/H) × 84`）。
- `node tools/replay.mjs [fastest|detour|wrong|all] [--shots DIR]`：从标题页起按各场景 `walkthrough` / `variants` 全程回放，打印每场进出时刻与 `REPLAY PASS/FAIL`。
- `python tools/key-sprite.py in.jpg out.png [--magenta]`：绿幕/品红幕抠图（腐蚀边缘、去黄绿溢色、向外补色、留 3% 边）。
- `python tools/sprite-fit.py keyed.png out.png public/pano/<目标画>.webp`：把精灵的饱和度与对比拉到目标画板的水平。
- `tools/gen-image.sh` 现在把参考图路径转成绝对路径（grokvpn 在自己的工作目录里跑）。
