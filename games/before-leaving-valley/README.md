# 离开山谷以前

一段约 25–35 分钟的第一人称叙事冒险，形式取自 Myst III: Exile / Riven：每个地点是一张手绘宽幅全景，玩家在原地环视，点画面里的东西，再走向下一个地点。

2025 年 7 月底，多洛米蒂，Passo Sella。一个人，一条 Pössnecker 飞拉达，一整天。登山学校的教练说是六七个小时的 easy 路线；地图摊开一算，至少十个小时。她在半途的悬崖上打开一只金属信箱，拍下一页读不懂的意大利语；在 2,941 米的 Piz Selva 山顶举起全景相机，一架直升机从头顶飞过；在高原上望见隔着整个山谷的山屋，决定紧急下撤。碎石坡把夕阳带走，十几只鹿在林线边受惊跑开，森林里她叼着一盏补光灯手脚并用地往下爬，一边发出很粗重的声音给自己壮胆。手机掉在了森林里。盘山公路的急转弯上，第二辆车停了下来——一对明天纪念恋爱四周年的异国情侣，把她捡回了酒店。

第二天她重返森林小路，打了二十多个电话，得到的答案都是没有。第三天她在 Passo Sella 的公交站准备彻底离开，一位陌生的女士走过来问：Have you lost your phone？一小时后，那部手机完好无损地放在警察局的柜台上。

离开山谷以前，她在长椅上把那页纸翻译了出来。

## 体验

- **一张画，一个地点，环视与点选。** 22 个节点、22 张全新的全景画，全部对照原视频逐帧重绘：山口草甸、飞拉达起点铜牌、钢缆与裂缝、悬崖信箱、山顶木十字架与对面的 Sassolungo、灰白的 Sella 高原、Val Lasties 路牌与碎石坡、林线的鹿、夜林、急转弯、车内、酒店、公交站、警察局、长椅。
- **亲手走过这段路。** 钢缆上两把锁扣轮换过锚点；裂缝里按顺序找手点脚点（有会松动的石片）；地图上把每一段时间加起来，再决定去山屋还是下撤；路牌上认出 Val Lasties · 656；碎石坡上一步一步选平的石面，天色随之暗下去；夜林里按住树根和岩石直到抓稳，害怕了就喊一声；车灯亮起来的时候挥手；Find My 的最后定位、二十多个电话、公交站的一问一答、警察局的柜台、相册里那张纸的翻译。
- **手机贯穿全程。** 消息、地图、相机、相册；照片是这次旅程的证据；森林里丢掉以后，口袋是空的。
- **表达的只有一件事：被世界善待的命运感。** 没有安全教育，没有劝阻。

创作完全依据 B 站 UP 主「塑料叉FOKU」分享的亲身经历（BV17m4Q6jEp4）。事件顺序、地点、海拔、信件原文、每一句对话、手机失而复得的方式都以那段视频为准，逐帧整理见 `docs/SOURCE_TRANSCRIPT.md`。

## 本地运行

```bash
npm install
npm run dev
```

开发预览可用 `?node=<nodeId>` 直接进入任意节点（之前节点的进度自动补齐）。节点 id：meadow approach plaque cable crack mailbox exit summit plateau hutView signpost scree deer forestEdge forest1 forest2 hairpin car search hotel busStop police bench。

全景画由 Grok Build 的 `image_edit` 在原视频截帧上重绘，见 `tools/README.md`。

## 音乐

- “Clear Air” · “Simple Duet” · “Promises to Keep” — Kevin MacLeod ([incompetech.com](https://incompetech.com))，[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) 授权。
