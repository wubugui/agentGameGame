# 美术队列（ART QUEUE）

各关卡作者按需追加；每行一枚精灵。

## before-leaving-valley · slab / mailbox / exit / summit / plateau / ledge（关卡作者，第 1 轮）

这一组场景在没有新图的情况下已经是完整的游戏：下面每一条都有一张现成的图在顶替，或者是一段没有它也成立、有了它才更好的画面。
格式：`- id | 用在哪个场景 | 描述 | 光照 | 屏高 vh | yaw/pitch/distance | 派生状态`

- mailbox-wall | mailbox（mailbox）· slab（box）· exit（mailbox-below） | 深绿色金属信箱，正面平视钉在浅灰石灰岩壁上，不带任何石头底座；盖子边缘一道反光 | day | 13.5（mailbox）· 4（slab）· 1.9（exit 远景） | mailbox 56 / -27 / 9；slab -23.8 / -7.8 / 12；exit 54 / -28 / 16 | 由 mailbox-closed.webp 重切，去掉那块蓝赭色圆石底座。现用 mailbox-closed.webp 顶替：盒子已经缩到 13.5vh 并挪到画里那片碎块岩上，但底座仍在，是这一组唯一没修净的画面瑕疵
- mailbox-wall-open | mailbox（mailbox 开盖态） | 同上，盖子掀开，盒底立着一本被雨洇过的 Memo 便签 | day | 13.5 | 56 / -27 / 9 | 由 mailbox-open.webp 重切。现用 mailbox-open.webp 顶替；盒内五个热点按 x 0.31..0.70 / y 0.35..0.56 的比例挂在精灵上，重切时请保持这块便签的位置比例
- blaze-streak-wet | slab（rust-slab）· exit（blaze-exit-c） | 竖直岩面上一道被水洇开的橙红色锈痕，形状像漆但边缘散开；没有鹅卵石、没有落地阴影 | day | 4 | slab 40 / -19 / 10；exit 16 / -4 / 10 | 由 blaze-false.webp 衍生。现两处都用 blaze-false.webp（浅色石头 + 橙灰地衣），所以她在这两处只说「不是漆。」，不点名；这张图落地后可以把「锈。不是漆。」还回去
- blaze-arrow-old | plateau（survey-plateau） | 一枚褪色的旧测量点：白漆方块加一个凿出来的十字，压在灰白石肋顶上 | day | 5 | -24 / -22 / 8 | 由 blaze-false.webp 衍生。§6 点名高原四枚候选里有「旧测量点」，台词按规格保留，现用 blaze-false.webp 顶替
- notebook-open | ledge（flat-rock 摊开本子那一拍） | 摊开的速写本平放在平岩上，右页一条铅笔画的下撤线，午后长影 | day | 9 | -20 / -28 / 8 | 新画。现用 item-notebook.webp 顶替（同一本本子的背面，那张纸本来就是摊开的），所以这一拍今天已经看得见东西
- helicopter-passing | summit（heli 飞过头顶的第二拍） | 同一架红白救援直升机，正下方仰视，旋翼在转 | day | 6 | 0 / +28 / 12 | 由 helicopter.webp 衍生。现在只有一张侧面图：她看见它 → 一次飞过 → 精灵离场（直升机只飞一次），有了这张才有「从左边到右边」的中间那一格
- item-cap | summit（大风掀帽子那一支）· cable | 米色棒球帽，被风掀起来在空中翻 | day | 4 | summit 30 / -12 / 9 | 新画，cable 在等同一张。这一支目前整段不存在（抓一顶画面上没有的帽子比不丢它更糟）


## roadside / meadow / approach / plaque / cable / crack（第 1 轮补图队列）

格式：- id | 用在哪个场景 | 描述 | 光照 | 屏高 vh | yaw/pitch/distance | 派生状态

### 阻塞（缺了这张，某一行 §6/§8 只能靠触觉与声音交付）

- crack-ledge | crack | 裂缝深处横卡着的一块浅色岩台，一条边被上方缺口的光打亮；全墙唯一能坐下的地方 | 裂缝内阴影 + 上方一道边光 | 12 | 31 / -16 / 9 | 新画，由 05-crack 局部衍生（E3）
- trail-board | roadside | 钉在木牌臂上半块板上的步道展示牌：PASSO SELLA · SENTIERI 649/656、四段用时、Rifugio Boè、Val Lasties 2455 m | 上午晴天顺光 | 7 | 57 / 0 / 10 | 新画，由 20-bus-stop 那根空白木牌衍生。全游戏只有它写 E-route 与 MAP_LEGS
- old-cable | approach | 一段锈死在岩面上的旧钢缆，锈成石头的颜色，挂在鼓包右侧的阴影凹槽里 | 上午晴天，岩面侧光 | 9 | 24 / -6 / 12 | 新画，由 02-approach 局部衍生。纯精灵：没有它，那面墙上什么都没有

### 常规

- car-parked | roadside | 停在公路边草地上的两厢小车，外侧车轮压着柏油边；车身宽度上限 100 px（9.5vh 高时） | 上午晴天，车身右侧受光 | 9.5 | 41 / -16.5 / 10 | 新画。不可用 car-stopped.webp 代替：那是夜里开着大灯的车
- hikers-cn | roadside | 两位中国观众，背对镜头站在车左边的草地上，日常徒步装 | 上午晴天顺光 | 11 | 31.1 / -17.3 / 10 | 新画。不可用 climbers-pair.webp 代替：那是墙上那两位飞拉达攀登者，全天只出现一次，复用会撞人
- woodcarving | roadside | 木屋橱窗里的一架木雕：鹿站在最前面，后面是熊、狼、野猪 | 室内暗光，隔着玻璃有一点反光 | 1.2 | 27.2 / -13.2 / 14 | 新画（画里那扇暗窗只有 11x15 px）
- cloud-shadow | meadow | 一块横向拉长、软边的云影，压在 Sella 石墙上，10:00–10:12 由左向右扫过 | 上午，正片叠底 | 14 | -52→-8 随分钟右移 / 10 / 14 | 新画 + CSS 类 .cloud-shadow-sprite（multiply、无投影）
- carving-1912 | approach | 凿进石灰岩的 PÖSSNECKER / 1912，边缘已被风磨圆 | 上午晴天，浅色岩块的受光面 | 4.5 | -19 / -12 / 10 | 新画，由 02-approach 局部衍生
- hold-flake-cracked | crack | hold-flake 上多一道发丝裂纹的版本（看过之后才换图） | 同 hold-flake | 6 | 14 / 7 / 9 | 由 hold-flake.webp 衍生。目前只在注释里，图到了再加 sprite.swap
- hold-groove-wet | crack | hold-groove 渗水发亮的版本（看过之后才换图） | 同 hold-groove | 6 | 35 / 11 / 9 | 由 hold-groove.webp 衍生。同上

### 不是精灵，是重画（同一条红线，请与上面一起排期）

- 03-plaque 重画 | plaque | 前景浅色岩面上烙死了一块橙红漆痕（x 640–700, y 595–660）。真记号压在它上面、假记号压在光板上，§3.5「凑近之前不可分辨」在这一场不成立 | — | — | — | 抹掉漆痕后 blaze-plaque 的 sizeVh 从 13 退回 4
- blaze-false 重绘 | 全部户外场景 | blaze-red-white.webp 与 blaze-false.webp 是两张完全不同的底图，任何一处候选记号都能靠图片本身分辨 | — | 4 | — | 与上一条是同一条红线，一起排
- 04-cable 左下角补画 | cable | §6 要的是「向左下俯瞰整个草甸与碎石路」，画面左下角只有粗缆和岩石，现在只能交付「往下看」 | — | — | — | 由 02-approach 衍生保风格（E3）


## forest1 / forest2 / hairpin / car（第 1 轮）

- blaze-656 | forest1 blaze-656、forest2 blaze-f2 | 树皮上的红-白-红 656 漆记，竖长条，不宽于 14 屏幕像素，画在细云杉树干上 | night（补光灯冷白光圈里） | 3 | f1 −0.6/4/13，f2 11/6/9 | 由 blaze-red-white.webp 衍生：去掉石头本体，只留刷在树皮上的漆。今天两场都先用 blaze-red-white.webp 顶着（是同一道漆，画在石头上）
- blaze-656-dim | forest1 blaze-656、forest2 blaze-f2（认过之后） | 同一道漆被确认之后压暗的版本，只剩一道极淡的高光（v4 §3.5「留一道极淡的高光」） | night | 3 | 同 blaze-656 | 由 blaze-656 衍生。没有它时认过的记号仍留在画上，靠 requires 给手+tock，不发生变化
- blaze-lichen-night | forest1 moss-mark | 大倾斜巨石亮面上的一块橙灰色地衣，轮廓与 656 同大同形，凑近才分得出 | night | 3 | 14/3.5/14 | 由 blaze-false.webp 衍生（去掉整块鹅卵石，只留地衣）。今天用 blaze-false.webp 顶着
- blaze-arrow-old-night | forest1 old-arrow | 另一条路线留下的旧箭头，褪色的红漆，刷在左边那对树干近处那一根的树皮上 | night | 3 | −39.5/−6.4/12 | 新画，可由 blaze-false.webp 改。今天用 blaze-false.webp 顶着
- blaze-false-bark | forest2 moss-f2 | 树皮上的一块旧树脂疤，颜色接近漆，形状不对 | night | 3 | −33/−12/8 | 由 blaze-false.webp 衍生。今天用 blaze-false.webp 顶着
- root-arch-night | forest1 hold-root、forest2 f2-root-c/f2-root-d | 补光灯照到的树根拱：只有光圈那一圈是亮的，边缘迅速掉进黑里 | night | f1 9，f2 8–11 | f1 随把手变（10.5/−28.5/8、28/−16.5/11、0/−10/12、−22/−26.5/9），f2 18/−26/8 与 −38/−22/8 | 由 root-arch.webp 调色。今天两场都用 root-arch.webp（白天光）顶着
- rock-step-night | forest1 hold-rock、forest2 f2-rock-c/f2-rock-d | 补光灯照到的踏脚石，湿的苔藓反一点光 | night | f1 9，f2 7–9 | f1 随把手变（−23.4/−23.9/8、13/−12/11、−11/−7/12、−32/−16/10），f2 5/−20/8 与 −12.5/−29.5/8 | 由 rock-step.webp 调色。今天两场都用 rock-step.webp 顶着
- headlights-far | hairpin headlight-beam | 180 米外上坡而来的两点车灯加光晕，路面上带一小段反光；不画车身 | night | 1.5 | 8.5/−11.3/16 | 新画，可从 car-passing.webp 的车灯裁出来。今天用 car-passing.webp 缩到 1.5 vh（11 px）顶着——那个距离上整台车也就一个亮点
- taillights-near | hairpin taillights（stopAt = near） | 十几步外停下的车尾：两盏尾灯，光晕比 far 重，能看出一点车尾板 | night | 5 | 22/−26/12 | 由 taillights-far.webp 衍生。今天 near 与 far 共用 taillights-far.webp（原来的 swap 指向不存在的文件，被落下的那一拍画面上什么都没有）
- hand-on-wheel | car wheel-hand | 副驾的手搭在驾驶员的手背上，两只手一起搭在方向盘轮圈上（画里没有挡杆的位置，v4 §6/§7 的「搭在挡杆上的手」落在轮圈上） | night interior（仪表盘暖光） | 18 | −17/−12.8/6 | 新画。public/sprites 里没有等价的手，所以这一个锚点今天是空圆环，标签指的是画里确实画着的轮圈
- water-bottle-night | car water-bottle | 一只手臂从左上越过仪表台把矿泉水瓶递过来 | night interior | 30 | 31/−13/5 | 由 water-bottle.webp 衍生（改光、改手臂方向）。今天用 water-bottle.webp（白天光、手臂从右下）顶着

## search / searchWall / searchPath / hotel / busStop / police / bench（第 1 轮）

- fallen-log | searchWall | 草里那段横躺的倒木，湿的一面贴地，树皮上一层苔藓和露水 | 白天·高山晴光 | 7vh | yaw −25 / pitch −21 / distance 13 | 原图（派生 fallen-log-rolled）
- fallen-log-rolled | searchWall | 同一根倒木被翻过来仰躺，露出压平的湿印和一窝露水 | 白天·高山晴光 | 7vh | yaw −25 / pitch −21 / distance 13 | 由 fallen-log 派生
- laptop-closed | hotel | 合上的笔记本电脑，铝盖，屏幕熄着 | 室内·夜·台灯暖光 | 10vh | yaw −45 / pitch −14.5 / distance 6 | 由 laptop-open 派生（合盖版）
- notepad-list | hotel | 便签本摊开的一页，手抄的一列本地电话号码 | 室内·夜·台灯暖光 | 5vh | yaw −38 / pitch −14.2 / distance 6 | 原图（派生 notepad-crossed）
- notepad-crossed | hotel | 同一页，前八行被铅笔逐条划掉 | 室内·夜·台灯暖光 | 5vh | yaw −38 / pitch −14.2 / distance 6 | 由 notepad-list 派生
- busstop-sign | busStop | 意大利蓝底白车图标的公交站牌，小方牌插在路边矮柱上；**牌上不许有时刻表**（v4 §12 B9）| 白天·山口硬光 | 5vh | yaw 42 / pitch −15.5 / distance 10 | 原图（22-bench 底图里画了同款，20-bus-stop 缺）
- officer | police | 深蓝制服的 Carabinieri，站在柜台后的门口，柜台线以下整齐裁掉 | 室内·白天·右侧窗光 | 34vh | yaw −4 / pitch −9.7 / distance 10 | 原图（派生 officer-returning / officer-shrug）。**P0**：目前整段「手机回到手上」发生在一间空屋子里
- officer-returning | police | 同一个人从里间走回来，手里拿着那台手机 | 室内·白天·右侧窗光 | 34vh | yaw −4 / pitch −9.7 / distance 10 | 由 officer 派生；落地前场景用 officer 顶着（police.scene.ts 的 swap 已留好位）
- officer-shrug | police | 同一个人摊开双手，这就是全部答案 | 室内·白天·右侧窗光 | 34vh | yaw −4 / pitch −9.7 / distance 10 | 由 officer 派生；落地前同上
- contact-note | bench | 那对夫妇写下联系方式的纸条，折着，放在长椅座板上 | 白天·山口硬光 | 4vh | yaw −16 / pitch −26.8 / distance 8 | 原图（派生 contact-note-open）
- contact-note-open | bench | 同一张纸摊开，两行手写的名字与号码 | 白天·山口硬光 | 4vh | yaw −16 / pitch −26.8 / distance 8 | 由 contact-note 派生
- bus-472（**重做**，现有 593×395）| busStop 与 bench | Trentino trasporti 的现代客车，停在站边 | 白天·山口硬光 | 18vh（busStop d16 / bench d14，两处都渲染 130 px 高）| yaw 30 / pitch −20 / distance 16 | 约束写成长宽比：**≤ 2.3∶1，四分之三视角**。正侧面 3∶1 在 18vh 下有 390 px 宽，会同时盖住「木屋」与「蓝色站牌」两个节点；只有高度可控，别再提「≤300 px 宽」
- art/woman-back-clear | busStop | **不是 sprite，是相册照片资产**（`public/art/`）：那位女士跑开的背影，还看得清 | 白天·山口硬光 | 满幅 16∶9 | 相册与片尾用，不落在球面上 | 原图（派生 woman-back-blur）
- art/woman-back-blur | busStop | 同一张，但她已经跑过游乐架，远而糊 —— 玩家先喊住她才会得到这一张 | 白天·山口硬光 | 满幅 16∶9 | 同上 | 由 woman-back-clear 派生


## hutView / hutTurn / signpost / scree / deer / forestEdge（第 1 轮，作者：关卡组 B）

- last-light-wall | signpost | 石壁上最后一道直射光：横跨层岩层理的一条暖白光带，只有光没有岩石，两端柔化 | day→dusk（17:00–20:15） | 5.4 | 随钟滑动 yaw −52.7→−62.1 / pitch 13.4→22.4 / distance 14 | 从 pano/10-signpost.webp 左侧层岩衍生（E3）；缺它时该点只作「左边那面层岩」用
- last-light-wall-low | signpost | 同上，18:00 之后的那条：更窄、更红、更靠上 | dusk | 5.4 | 同上（18:00 起 swap） | 由 last-light-wall 衍生
- sun-low | scree | 低垂的太阳：暖白圆盘加一圈晕，圆盘本身约占图高十分之一（真实半度） | dusk（20:15 前可见） | 4 | yaw 50 / pitch 16 / distance 16 | 从 pano/11-scree.webp 右侧暖色天空衍生；§6「一张画里同时看见太阳、Sassolungo 与还剩多少路」缺的就是它
- first-star | scree | 第一颗星：一个亮点加极淡的光晕，深蓝天底 | night（20:30 后） | 2.5 | yaw −29.3 / pitch 30 / distance 16 | 从 pano/11-scree.webp 左上天空衍生；缺它时「第一颗星。」那句已按契约撤掉，落地后随精灵一起恢复
- deer-fawn | deer | 群里最小的一只鹿，单独一只，正面朝镜头站着，比其他鹿矮三分之一 | dusk | 5 | yaw 11 / pitch −30 / distance 11 | 从 sprites/deer-herd.webp 裁一只改姿势衍生；缺它时「最小的那只往前走了两步。」已撤，只留两声脚步
- grass-pressed | deer | 鹿群站过后压倒的一小片草，草叶朝一个方向倒伏，无鹿 | dusk | 4.5 | yaw 12.3 / pitch −30.1 / distance 10 | 从 pano/12-deer.webp 前景草地衍生
- deer-shadows | deer | §6 的第二张脸：十几只鹿只剩轮廓剪影，与 deer-herd 同构同位 | dusk（light < 0.3） | 18 | yaw 9.5 / pitch −24 / distance 14 | 由 sprites/deer-herd.webp 压暗去细节衍生；场景暂未引用（引用缺失文件会把鹿群整个从画面删掉），落地后 deer.scene.ts 加 swap
- deer-shadows-alert | deer | 同上，头全部抬起来朝向镜头 | dusk | 18 | 同上 | 由 deer-shadows 衍生；同上，落地后加 swap
- deer-eyeshine | deer | §6 的第三张脸：几乎全黑，只剩光束边缘的两点反光 | night（light = 0） | 18 | 同上 | 由 deer-shadows 衍生；同上，落地后加 swap
- blaze-656 | forestEdge | 树干上的红白红漆条，白漆上手写 656，不带树皮、不带石头（forest1 也用同一张） | night（灯光下） | 2.8 | yaw 6.2 / pitch −25.2 / distance 10 | 由 sprites/blaze-red-white.webp 去掉石头衍生；本轮已改用 blaze-red-white 顶上，与 forest1 一致
