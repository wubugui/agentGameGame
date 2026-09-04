/* The journey as nodes. Every fact here comes from docs/SOURCE_TRANSCRIPT.md. */

export type Light = "day" | "dusk" | "night" | "interior" | "dawn";
export type Anchor = { yaw: number; pitch: number; distance?: number };

export const NODE_IDS = [
  "meadow", "approach", "plaque", "cable", "crack", "mailbox", "exit", "summit",
  "plateau", "hutView", "signpost", "scree", "deer", "forestEdge", "forest1", "forest2",
  "hairpin", "car", "search", "hotel", "busStop", "police", "bench",
] as const;
export type NodeId = typeof NODE_IDS[number];

export type NodeDef = {
  day: 1 | 2 | 3;
  place: string;
  elevation: string;
  asset: string;
  light: Light;
  minutes: number;        // story minutes spent on the way to the next node
  battery: number;        // phone battery spent on the way
  photoTitle: string;
  thoughts: readonly [string, string];
  next: NodeId | null;
  go?: Anchor;            // where the "walk on" hotspot sits in the painting
  chapter?: { eyebrow: string; title: string };
};

export const NODES: Record<NodeId, NodeDef> = {
  meadow: {
    day: 1, place: "Passo Sella · 山口草甸", elevation: "2,240 m", asset: "pano/01-meadow.webp", light: "day", minutes: 30, battery: 2,
    photoTitle: "石墙从草地上拔起来",
    thoughts: ["山口公路边有两个中国面孔朝我笑，说看过我的视频。打了个招呼。教练说的那面墙，就在草地尽头。", "来都来了。教练说，六七个小时的 easy 路线。"],
    next: "approach", go: { yaw: 4, pitch: -9 },
    chapter: { eyebrow: "多洛米蒂 · 八月 · 第一天", title: "来都来了" },
  },
  approach: {
    day: 1, place: "Sella 石墙脚下 · 碎石路", elevation: "2,300 m", asset: "pano/02-approach.webp", light: "day", minutes: 10, battery: 1,
    photoTitle: "回头还能看见山口",
    thoughts: ["碎石在鞋底下轻轻滑开。回头，山口的木屋已经变成一个小点。", "墙越来越高，高到要仰着头才看得到顶。"],
    next: "plaque", go: { yaw: 4, pitch: 13 },
  },
  plaque: {
    day: 1, place: "Pössnecker 飞拉达 · 起点", elevation: "2,340 m", asset: "pano/03-plaque.webp", light: "day", minutes: 5, battery: 1,
    photoTitle: "1912 年开辟的路",
    thoughts: ["岩壁上钉着两块小铜牌和一块说明牌。Pössnecker，1912。", "戴上头盔，挂好两把锁扣。从这里开始，就是天然岩壁了。"],
    next: "cable", go: { yaw: 18, pitch: 10 },
  },
  cable: {
    day: 1, place: "飞拉达 · 第一段", elevation: "2,355 m", asset: "pano/04-cable.webp", light: "day", minutes: 55, battery: 2,
    photoTitle: "钢缆比看起来更凉",
    thoughts: ["一开始就是 C 级，很快就是 D 级。钢缆比看起来更凉。", "两把锁扣，一蓝一橙，在腰下面一路叮当响。"],
    next: "crack", go: { yaw: 0, pitch: 16 },
  },
  crack: {
    day: 1, place: "飞拉达 · 裂缝", elevation: "2,368 m", asset: "pano/05-crack.webp", light: "day", minutes: 44, battery: 1,
    photoTitle: "自己找手点和脚点",
    thoughts: ["这一段没有钢缆。二级攀爬，全是天然岩壁。", "手指抠进去。石头是凉的，边缘扎手。"],
    next: "mailbox", go: { yaw: 4, pitch: 18 },
  },
  mailbox: {
    day: 1, place: "飞拉达 · 半途悬崖", elevation: "2,379 m", asset: "pano/06-mailbox.webp", light: "day", minutes: 20, battery: 2,
    photoTitle: "山崖上的信箱",
    thoughts: ["爬到一半，整个山口忽然在脚下摊开：草甸、森林、缆车、公路。", "岩壁上钉着一只金属盒。有人在悬崖上留了一个信箱。"],
    next: "exit", go: { yaw: 22, pitch: 14 },
  },
  exit: {
    day: 1, place: "飞拉达 · 顶段出口", elevation: "2,860 m", asset: "pano/07-exit.webp", light: "day", minutes: 115, battery: 1,
    photoTitle: "全天遇到的两个人",
    thoughts: ["顶段的钢缆断断续续，剩下的还是自己找手点脚点。", "两位攀登者从旁边经过，点了点头。这是我一整天在山里遇到的仅有的两个人。"],
    next: "summit", go: { yaw: -8, pitch: 12 },
  },
  summit: {
    day: 1, place: "Piz Selva 山顶", elevation: "2,941 m", asset: "pano/08-summit.webp", light: "day", minutes: 30, battery: 3,
    photoTitle: "木十字架与 Sassolungo",
    thoughts: ["相当于一屁股一屁股把自己抬升了一千六百米。木十字架，对面是 Sassolungo，云压在它上面。", "我开心了一下。举起相机的时候，一架直升机从头顶飞过去。"],
    next: "plateau", go: { yaw: 30, pitch: 0 },
    chapter: { eyebrow: "2,941 m", title: "登顶" },
  },
  plateau: {
    day: 1, place: "Sella 高原", elevation: "2,800 m", asset: "pano/09-plateau.webp", light: "day", minutes: 35, battery: 2,
    photoTitle: "灰白色的荒漠",
    thoughts: ["登顶之后要先走一条路去山屋。山屋是避难所，可以充电、吃饭。", "这里没有任何一个人。灰白的石头一直铺到天边。云越来越厚了。"],
    next: "hutView", go: { yaw: 12, pitch: -4 },
  },
  hutView: {
    day: 1, place: "高原边缘 · 望见山屋", elevation: "2,760 m", asset: "pano/09b-hut.webp", light: "day", minutes: 30, battery: 1,
    photoTitle: "山屋隔着山谷",
    thoughts: ["走了一半。山屋就在对面，隔着一整个山谷。", "我赶紧把地图啪地摊开。"],
    next: "signpost", go: { yaw: -26, pitch: -6 },
  },
  signpost: {
    day: 1, place: "岔口 · 路牌", elevation: "2,455 m", asset: "pano/10-signpost.webp", light: "day", minutes: 42, battery: 1,
    photoTitle: "Val Lasties 2455 m",
    thoughts: ["路牌指着好几个方向。", "现在看错一次，就是一个小时。"],
    next: "scree", go: { yaw: -30, pitch: -8 },
    chapter: { eyebrow: "决定", title: "紧急下撤" },
  },
  scree: {
    day: 1, place: "Val Lasties · 碎石坡", elevation: "2,300 m", asset: "pano/11-scree.webp", light: "dusk", minutes: 54, battery: 3,
    photoTitle: "一直盯着脚下",
    thoughts: ["疯狂下撤下撤下撤。碎石坡大得像一整片白色的海，我小得像一只蚂蚁。", "山间的云和最后的夕阳都在离我而去。我一直盯着脚下。"],
    next: "deer", go: { yaw: 8, pitch: -14 },
  },
  deer: {
    day: 1, place: "坡脚 · 林线", elevation: "2,050 m", asset: "pano/12-deer.webp", light: "dusk", minutes: 45, battery: 1,
    photoTitle: "十几只鹿",
    thoughts: ["不知道过了多久。前面有响动。", "十几只鹿。它们看到我，受了惊，扭头跑回远处的森林。"],
    next: "forestEdge", go: { yaw: -6, pitch: -4 },
  },
  forestEdge: {
    day: 1, place: "林缘 · 天黑", elevation: "1,980 m", asset: "pano/13-forest-edge.webp", light: "night", minutes: 30, battery: 4,
    photoTitle: "森林的入口",
    thoughts: ["我忽然想起来，一路看到的纪念品上，除了鹿，还有熊、狼和野猪。", "再一看地图：坏了，我也得进去。"],
    next: "forest1", go: { yaw: 2, pitch: -2 },
    chapter: { eyebrow: "夜", title: "我也得进去" },
  },
  forest1: {
    day: 1, place: "森林小路 · 上段", elevation: "1,900 m", asset: "pano/14-forest-1.webp", light: "night", minutes: 24, battery: 0,
    photoTitle: "补光灯的一小圈光",
    thoughts: ["相机先没了电，手机也快了。特别特别幸运，我带了一盏拍视频用的补光灯。", "我叼着补光灯，手脚并用地爬。心里有点害怕，就一直发出很粗重的声音给自己壮胆。"],
    next: "forest2", go: { yaw: -4, pitch: -6 },
  },
  forest2: {
    day: 1, place: "森林小路 · 下段", elevation: "1,780 m", asset: "pano/15-forest-2.webp", light: "night", minutes: 60, battery: 0,
    photoTitle: "肾上腺素",
    thoughts: ["十个小时了。体力早就耗尽，是肾上腺素在推着我走。", "完全是一个人猿泰山的形态。"],
    next: "hairpin", go: { yaw: 6, pitch: -4 },
  },
  hairpin: {
    day: 1, place: "盘山公路 · 急转弯", elevation: "1,700 m", asset: "pano/16-hairpin.webp", light: "night", minutes: 30, battery: 0,
    photoTitle: "公交早没了",
    thoughts: ["森林小路最后的出口，在盘山公路的一个急转弯上。", "公交早没了，手机也掉了。所以我采用了最原始的方式。"],
    next: "car", go: { yaw: 0, pitch: -2 },
    chapter: { eyebrow: "谷底", title: "最原始的方式" },
  },
  car: {
    day: 1, place: "他们的车 · 回酒店的路", elevation: "1,500 m", asset: "pano/17-car.webp", light: "interior", minutes: 35, battery: 0,
    photoTitle: "一对特别可爱的情侣",
    thoughts: ["第二辆车停下来了。一对特别可爱的情侣，把我从山里捡回了酒店。", "女生是意大利人，男生是西班牙人。异国恋。明天是他们恋爱四周年的纪念日，所以聚在这里。"],
    next: "search", go: { yaw: 0, pitch: 0 },
  },
  search: {
    day: 2, place: "森林小路 · 第二天", elevation: "1,820 m", asset: "pano/18-search.webp", light: "day", minutes: 90, battery: 0,
    photoTitle: "Find My 的最后定位",
    thoughts: ["第二天，我又重返那天的森林小路。", "Find My 显示的最后定位，就在这一片巨石和矮松之间。"],
    next: "hotel", go: { yaw: 0, pitch: -4 },
    chapter: { eyebrow: "第二天", title: "重返森林小路" },
  },
  hotel: {
    day: 2, place: "酒店房间 · 晚上", elevation: "1,450 m", asset: "pano/19-hotel.webp", light: "interior", minutes: 60, battery: 0,
    photoTitle: "二十多个电话",
    thoughts: ["打了二十多家附近的酒店和游客中心。得到的答案都是没有。", "那里面有这一年所有的照片和资料。都没备份。"],
    next: "busStop", go: { yaw: 0, pitch: 0 },
  },
  busStop: {
    day: 3, place: "Passo Sella · 公交站", elevation: "2,240 m", asset: "pano/20-bus-stop.webp", light: "day", minutes: 15, battery: 0,
    photoTitle: "472 路",
    thoughts: ["第三天。我准备彻底离开多洛米蒂。", "在公交站等 472 路。"],
    next: "police", go: { yaw: 0, pitch: 0 },
    chapter: { eyebrow: "第三天", title: "离开多洛米蒂" },
  },
  police: {
    day: 3, place: "警察局", elevation: "1,460 m", asset: "pano/21-police.webp", light: "interior", minutes: 60, battery: 0,
    photoTitle: "完好无损",
    thoughts: ["一小时后。", "那台我以为会永远在多洛米蒂的森林里和鹿一起生活的手机。"],
    next: "bench", go: { yaw: 0, pitch: 0 },
  },
  bench: {
    day: 3, place: "Canazei · 公交站长椅", elevation: "1,460 m", asset: "pano/22-bench.webp", light: "day", minutes: 0, battery: 0,
    photoTitle: "离开山谷以前",
    thoughts: ["等离开山谷的公交车。", "我突然想起了那封信。因为只有这部手机拍下了它。"],
    next: null,
  },
};

export const nodeIndex = (id: NodeId) => NODE_IDS.indexOf(id);
export const isNodeId = (value: unknown): value is NodeId => typeof value === "string" && (NODE_IDS as readonly string[]).includes(value);

/* ---------- interaction tables (yaw/pitch in degrees on the painting) ---------- */

// Via ferrata anchors: at each one both carabiners must be moved onto the next cable segment, one at a time.
export const CABLE_ANCHORS: Anchor[] = [
  { yaw: 9, pitch: -20 }, { yaw: 5, pitch: -11 }, { yaw: 1, pitch: -3 }, { yaw: -1, pitch: 6 },
];

// The unprotected crack: the true sequence of holds plus decoys that slip.
export const CRACK_HOLDS: Array<Anchor & { order: number | null; label: string }> = [
  { yaw: -16, pitch: -13, order: 0, label: "左脚 · 岩阶" },
  { yaw: 18, pitch: -2, order: 1, label: "右手 · 裂缝边缘" },
  { yaw: 2, pitch: 2, order: 2, label: "左手 · 石突" },
  { yaw: 14, pitch: 12, order: 3, label: "右脚 · 裂缝里" },
  { yaw: -11, pitch: 19, order: null, label: "一片薄石" },
  { yaw: -5, pitch: 7, order: null, label: "一道浅槽" },
];

export const MAILBOX_ANCHOR: Anchor = { yaw: 34, pitch: -20 };
export const SUMMIT_CROSS_ANCHOR: Anchor = { yaw: -19, pitch: 0 };
export const SUMMIT_CAMERA_ANCHOR: Anchor = { yaw: 3, pitch: -15 };
// On the plateau edge: the hut across the valley, the map she spreads on a rock, the chocolate bar.
export const PLATEAU_MAP_ANCHOR: Anchor = { yaw: -8, pitch: -16 };
export const HUT_ANCHOR: Anchor = { yaw: 18, pitch: 5, distance: 12 };
export const CHOCOLATE_ANCHOR: Anchor = { yaw: 12, pitch: -18 };

// Map legs she adds up on the plateau (hours, as the map legend gives them).
export const MAP_LEGS = [
  { name: "高原 → 岔口（Val Lasties 2455 m）", hours: 1.0 },
  { name: "岔口 → 碎石谷底", hours: 1.5 },
  { name: "谷底 → 森林小路", hours: 0.5 },
  { name: "森林小路 → 山口公路", hours: 0.5 },
];
export const HUT_HOURS = 2.5;          // the map's time to the hut across the valley
export const HOURS_ALREADY = 6.5;      // she has been going since the start
export const DAYLIGHT_LEFT = 4.5;      // hours of light left when she opens the map (sunset about 20:15)

export const SIGNPOST_ARMS = [
  { label: "Val de Schiavaneis · 649", correct: false, yaw: 9, pitch: 5 },
  { label: "Piz Selva · 649", correct: false, yaw: 9, pitch: -1 },
  { label: "Rifugio Boè · 649", correct: false, yaw: 9, pitch: -7 },
  { label: "Plan de Roces · Val Lasties 2455 m · 656", correct: true, yaw: 9, pitch: -13 },
];

// Scree descent: pairs of footings per step; the flatter stone is the safe one.
export const SCREE_STEPS: Array<{ safe: Anchor; loose: Anchor }> = [
  { safe: { yaw: -10, pitch: -12 }, loose: { yaw: 8, pitch: -13 } },
  { safe: { yaw: 6, pitch: -9 }, loose: { yaw: -9, pitch: -8 } },
  { safe: { yaw: -3, pitch: -6 }, loose: { yaw: 12, pitch: -5 } },
  { safe: { yaw: 9, pitch: -3 }, loose: { yaw: -12, pitch: -2 } },
  { safe: { yaw: -6, pitch: 0 }, loose: { yaw: 6, pitch: 1 } },
  { safe: { yaw: 4, pitch: 3 }, loose: { yaw: -11, pitch: 4 } },
];

export const POLICE_COUNTER_ANCHOR: Anchor = { yaw: 4, pitch: -13 };
export const DEER_ANCHOR: Anchor = { yaw: 16, pitch: -14, distance: 12 };

export const FOREST_STEPS: Record<"forest1" | "forest2", Array<Anchor & { kind: "root" | "rock" | "log" }>> = {
  forest1: [
    { yaw: -12, pitch: -10, kind: "root" }, { yaw: 6, pitch: -7, kind: "rock" }, { yaw: -3, pitch: -3, kind: "log" }, { yaw: 9, pitch: 1, kind: "root" },
  ],
  forest2: [
    { yaw: 8, pitch: -11, kind: "rock" }, { yaw: -7, pitch: -7, kind: "root" }, { yaw: 3, pitch: -3, kind: "rock" }, { yaw: -6, pitch: 2, kind: "log" },
  ],
};

export const SEARCH_SPOTS: Array<Anchor & { label: string; line: string }> = [
  { yaw: -22, pitch: -8, label: "巨石下面", line: "巨石下面只有碎石和露水。" },
  { yaw: 10, pitch: -12, label: "矮松丛", line: "矮松丛里挂着一小片红色——是我冲锋衣的线头，不是手机。" },
  { yaw: -4, pitch: 6, label: "石墙下", line: "对面就是 Sassolungo。石墙下面的灌木翻了一遍。没有。" },
  { yaw: 24, pitch: -2, label: "最后定位的那块坡", line: "定位就停在这里。石头翻了个遍。没有。" },
];

export const HOTEL_CALLS = [
  "山口边的旅馆", "山口的山屋", "缆车站的餐厅", "Canazei 游客中心", "Canazei 的一家 Garni", "湖边的旅馆", "教堂旁的 Pensione",
  "河对岸的 Residence", "Campitello 游客中心", "Campitello 的一家 Hotel", "Val Lasties 谷口的旅馆", "Sassolungo 脚下的 Chalet",
  "Col Rodella 缆车站", "Alba 的一家 Albergo", "Penia 的民宿", "Passo Pordoi 的山屋", "Selva 游客中心", "Selva 的一家 Hotel",
  "Plan de Gralba 的旅馆", "Val di Fassa 旅游局", "警局总机（无人接听）", "山地救援值班室",
];

// The call from the slope (112 → mountain rescue). Rhythm only.
export const CALL_LINES = [
  "拨号 112……",
  "接通了。转接山地救援。",
  "我说：我在 Sella 高原下面，天黑了，我一个人。",
  "对方不太会说英语。信号又很差。",
  "几乎没有办法传递什么有效信息。",
  "通话结束 · 电量 8%",
];

export const CAR_LINES = [
  "车里开着暖气。导航屏上是回 Canazei 的路。",
  "她回过头，递过来一瓶水。",
  "他们说，明天是他们恋爱四周年，所以聚在这里。她是意大利人，他是西班牙人，异国恋。",
  "我说我把手机爬掉了，在森林里。他们说：那我们先送你回酒店。",
  "我们交换了联系方式。在酒店门口，他们的手机替我们拍了一张。",
];

export const BUS_STOP_LINES = [
  "一位完全不认识的女士走到我面前。",
  "“Have you lost your phone?”",
];

export const POLICE_LINES = [
  "柜台后面的警察看了看我，转身进了里间。",
  "他把它放在柜台上。屏幕没碎，一张照片都没少。",
  "我问是谁送来的。他摊了摊手。",
];

export const LETTER_LINES_IT: readonly string[] = [
  "Grazie montagna,",
  "che per un attimo riesci",
  "a connetterti all'infinito",
  "ed il dolore si fa più leggero.",
  "",
  "Autore anonimo",
  "",
  "e buona vita a te che",
  "leggerai, sei speciale.",
];

export const LETTER_LINES_ZH: readonly string[] = [
  "谢谢你，大山。",
  "哪怕只有一瞬，",
  "你也让人与无限相连，",
  "痛苦因此轻了一些。",
  "",
  "——匿名",
  "",
  "也祝将要读到这些话的你，",
  "一生美好。你是特别的。",
];

export const CLOSING_LINES = [
  "那一天其实我犯了很多错误。",
  "但是当我彻底做好了永远失去某样东西的准备，",
  "命运它好像会经由很多人的手，把这样东西重新送回你手里。",
];
