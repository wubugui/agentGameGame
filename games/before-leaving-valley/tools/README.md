# 美术管线

所有场景板与精灵由 Grok Build（`grokvpn`，走本机 7078 代理）的 `image_gen` / `image_edit` 生成，再用 ffmpeg 转 WebP。

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

把 `tools/autoplay.js` 整段粘进浏览器控制台（停在标题页），它会用合成事件从下车一路点到完成页，时间线写在 `window.__log`。2026-09-04 的结果：全程无卡点，纯操作路径 98 秒。

更稳的做法是用无头 Chrome 跑（不受浏览器面板隐藏时的定时器限制）：

```bash
npm run dev -- --port 5174   # 另开一个终端
node tools/smoke.mjs         # 输出时间线，最后打印 SMOKE PASS / FAIL，并列出控制台错误
```

单场景无头截图（真实 1280×720 布局，不受面板影响）：

```bash
node tools/shot.mjs school out.png "document.querySelector('.map-prop').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))" 4000
```

阅读节奏模式：`set PACED=1` 后运行 smoke.mjs，脚本会按每字约 0.18 秒读独白、在三个场景拍照并发给朋友、看消息、在山顶读信 9 秒、结尾读译文 14 秒，输出一次"像人一样玩"的实测时长。首屏测量：`node tools/perf.mjs`（先 `npx vite preview --port 5175`）。

JS 探针（在真实布局下读取任意表达式的值）：

```bash
EVAL="document.querySelector('.map-prop').getBoundingClientRect().toJSON()" node tools/probe.mjs school x "" 1500
```

QA 记录见 `docs/QA_REPORT.md`。
