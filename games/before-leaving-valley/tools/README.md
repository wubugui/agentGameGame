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
