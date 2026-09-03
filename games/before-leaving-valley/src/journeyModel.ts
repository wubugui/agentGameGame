export const JOURNEY_SCENES = [
  "school",
  "arrival",
  "forestEntry",
  "trail",
  "chainTraverse",
  "chainUpper",
  "rubbleSlope",
  "viewpoint",
  "summitRest",
  "letterBox",
  "sunsetFork",
  "nightSlope",
  "deepForest",
  "marker656",
  "roadBank",
  "roadside",
  "carInterior",
  "police",
  "searchRoad",
  "valleyExit",
] as const;

export type JourneyScene = typeof JOURNEY_SCENES[number];
export type SceneLight = "day" | "dusk" | "night" | "interior" | "dawn";

export type JourneySceneInfo = {
  place: string;
  elevation: string;
  asset: string;
  light: SceneLight;
  minutes: number;
  batteryCost: number;
  photoTitle: string;
  thoughts: readonly [string, string];
};

/* 山顶信箱里那张纸上的话。匿名作者，意大利语原文。
   在山上读不懂；离开山谷以后，她才把它翻译出来。 */
export const LETTER_LINES_IT: readonly string[] = [
  "Grazie montagna,",
  "che per un attimo riesci",
  "a connetterti all’infinito",
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

export const JOURNEY_SCENE_INFO: Record<JourneyScene, JourneySceneInfo> = {
  school: {
    place: "登山学校 · 教练的桌子",
    elevation: "1,540 m",
    asset: "art/school-desk-v1.webp",
    light: "interior",
    minutes: 12,
    batteryCost: 1,
    photoTitle: "教练画的那条线",
    thoughts: ["教练看了看我，又看了看窗外的天，把地图转过来对着我。", "‘飞拉达标着三到四小时。不过你嘛——’他拿起铅笔。"],
  },
  arrival: {
    place: "多洛米蒂 · 山谷停靠点",
    elevation: "1,560 m",
    asset: "art/stage1-arrival-v2.webp",
    light: "day",
    minutes: 15,
    batteryCost: 1,
    photoTitle: "下车后的第一眼",
    thoughts: ["登山学校的教练看了看我，在地图上画了一条线：‘两个小时，你就能站在上面。’", "整辆车只有我一个人下了。天气比预报里还好。来都来了。"],
  },
  forestEntry: {
    place: "落叶松林 · 入山旧路",
    elevation: "1,640 m",
    asset: "art/forest-entry-base-v1.webp",
    light: "day",
    minutes: 30,
    batteryCost: 1,
    photoTitle: "林子把山藏了一半",
    thoughts: ["树影一下子把公路的声音关在了身后。", "光从松针里漏下来。我停下来拍了一张，又一张。"],
  },
  trail: {
    place: "牧道岔口 · 溪石",
    elevation: "1,720 m",
    asset: "art/stage1-trail.webp",
    light: "day",
    minutes: 32,
    batteryCost: 2,
    photoTitle: "两条路都像邀请",
    thoughts: ["教练画的是一条细线，眼前却有两条路。", "不用猜哪条正确。选一条，自己走过去。"],
  },
  chainTraverse: {
    place: "飞拉达 · 白色岩壁",
    elevation: "2,050 m",
    asset: "art/chain-traverse-base-v1.webp",
    light: "day",
    minutes: 32,
    batteryCost: 1,
    photoTitle: "岩壁外面全是风",
    thoughts: ["铁索比看起来更凉。每向前一步，山谷就多露出一点。", "风从岩壁外面过来。我腾出一只手，把这一刻也拍了下来。"],
  },
  chainUpper: {
    place: "飞拉达 · 上段",
    elevation: "2,180 m",
    asset: "art/chain-upper-v1.webp",
    light: "day",
    minutes: 28,
    batteryCost: 1,
    photoTitle: "往上看，只有天",
    thoughts: ["铁索转成了竖直的梯级。往上看，只有天。", "腾出一只手拍照的时候，我才发现自己在笑。"],
  },
  rubbleSlope: {
    place: "碎石坡 · 回望处",
    elevation: "2,300 m",
    asset: "art/rubble-slope-base-v1.webp",
    light: "day",
    minutes: 40,
    batteryCost: 2,
    photoTitle: "原来已经走了这么远",
    thoughts: ["碎石在鞋底下轻轻滑开，像山在跟我说话。", "一回头，林间的小路已经缩成了一根线。"],
  },
  viewpoint: {
    place: "山顶 · 无名观景台",
    elevation: "2,480 m",
    asset: "art/stage1-viewpoint-clean-v2.webp",
    light: "day",
    minutes: 30,
    batteryCost: 3,
    photoTitle: "风从山谷另一边来",
    thoughts: ["风从山脊另一边吹过来，整片山谷忽然亮了。", "原来不是所有风景，都需要先知道名字。"],
  },
  summitRest: {
    place: "山顶 · 一块巧克力",
    elevation: "2,480 m",
    asset: "art/summit-rest-v1.webp",
    light: "day",
    minutes: 18,
    batteryCost: 2,
    photoTitle: "只带了一板巧克力",
    thoughts: ["坐下来的时候，腿才开始抖。", "只带了一板巧克力。掰一半，剩下的留给回程。"],
  },
  letterBox: {
    place: "山顶 · 信箱",
    elevation: "2,480 m",
    asset: "art/letterbox-summit-v1.webp",
    light: "dusk",
    minutes: 15,
    batteryCost: 1,
    photoTitle: "信箱里的一张纸",
    thoughts: ["石头旁边立着一只旧信箱。有人在山顶给不认识的人留了信。", "里面只有一张被晒白的纸。意大利语，我只认得一个词：montagna，山。"],
  },
  sunsetFork: {
    place: "山肩 · 望见山屋",
    elevation: "2,380 m",
    asset: "art/hut-sunset-v1.webp",
    light: "dusk",
    minutes: 60,
    batteryCost: 2,
    photoTitle: "光已经走到山后面",
    thoughts: ["山屋就在坡顶，窗亮着，看起来很近。可碎石坡上每一步都比想的慢，天已经这样了。", "光已经走到山后面了。林线边站着一只鹿，看了我一会儿，才慢慢走开。"],
  },
  nightSlope: {
    place: "回程山坡 · 无照明路段",
    elevation: "2,100 m",
    asset: "art/night-slope-base-v1.webp",
    light: "night",
    minutes: 28,
    batteryCost: 5,
    photoTitle: "补光灯照到的那小块路",
    thoughts: ["天不是一下子黑的。是我终于承认，已经看不清路了。", "求助电话接通了，两种语言在风里碎成一片。我挂掉电话，打开补光灯。"],
  },
  deepForest: {
    place: "落叶松林 · 656 号小径",
    elevation: "1,780 m",
    asset: "art/night-trail-base-v1.webp",
    light: "night",
    minutes: 24,
    batteryCost: 6,
    photoTitle: "林子里只有呼吸声",
    thoughts: ["林子把风挡住以后，我才听见自己的呼吸有多快。", "656 号路标。往上爬，就能到公路。我对自己说了三遍。"],
  },
  marker656: {
    place: "落叶松林 · 岔口",
    elevation: "1,690 m",
    asset: "art/marker-656-v1.webp",
    light: "night",
    minutes: 22,
    batteryCost: 0,
    photoTitle: "红白两道漆",
    thoughts: ["路在这里分开了。地图上说，这附近应该有一根路标。", "光只有那么一小圈。一处一处地照过去。"],
  },
  roadBank: {
    place: "路基下 · 最后一段",
    elevation: "1,560 m",
    asset: "art/road-bank-v1.webp",
    light: "night",
    minutes: 26,
    batteryCost: 0,
    photoTitle: "护栏上的一点光",
    thoughts: ["树缝上方有一道更浅的黑。那是公路。", "最后一段要往上爬。抓住树根，一下，再一下。"],
  },
  roadside: {
    place: "谷底公路 · 旧里程牌",
    elevation: "1,540 m",
    asset: "art/roadside-night-base-v1.webp",
    light: "night",
    minutes: 17,
    batteryCost: 0,
    photoTitle: "远处终于有了灯",
    thoughts: ["翻过护栏，脚踩到柏油的那一刻，腿软了一下。然后，远处出现了两束光。", "我挥手的时候，才发现手一直在抖。"],
  },
  carInterior: {
    place: "他们的车 · 暖风口旁",
    elevation: "1,530 m",
    asset: "art/car-interior-couple-v1.webp",
    light: "interior",
    minutes: 26,
    batteryCost: 0,
    photoTitle: "陌生人的暖风",
    thoughts: ["他们没有问我为什么一个人跑进山里，只先递来一瓶水。", "暖风口对着我。副驾上的人把外套往我这边又推了一点。"],
  },
  police: {
    place: "谷口 · 警局",
    elevation: "1,530 m",
    asset: "art/police-dawn-v1.webp",
    light: "dawn",
    minutes: 24,
    batteryCost: 0,
    photoTitle: "门口的那盏灯",
    thoughts: ["天刚亮，他们就把车停在了警局门口。", "‘去登记一下。山里捡到东西的人，一般会送到这里。’"],
  },
  searchRoad: {
    place: "落叶松林 · 清晨",
    elevation: "1,700 m",
    asset: "art/search-dawn-base-v1.webp",
    light: "dawn",
    minutes: 34,
    batteryCost: 0,
    photoTitle: "天亮后的回头路",
    thoughts: ["天亮后，昨晚的黑路重新变回了普通的树林。", "他们把车停在谷口等我。我沿着记得的细节往回找：倒下的树、白色石头、拐弯处的苔。"],
  },
  valleyExit: {
    place: "谷口车站 · 清晨",
    elevation: "1,560 m",
    asset: "art/valley-exit-dawn-base-v1.webp",
    light: "dawn",
    minutes: 18,
    batteryCost: 0,
    photoTitle: "离开山谷以前",
    thoughts: ["手机回来了，一张照片都没少。他们两个靠在车边，朝我挥手。", "上车以前，再回头看一眼来路。"],
  },
};

export const journeySceneIndex = (scene: JourneyScene) => JOURNEY_SCENES.indexOf(scene);

export function isJourneyScene(value: unknown): value is JourneyScene {
  return typeof value === "string" && (JOURNEY_SCENES as readonly string[]).includes(value);
}

export function nextJourneyScene(scene: JourneyScene): JourneyScene | null {
  const index = journeySceneIndex(scene);
  return index >= 0 && index < JOURNEY_SCENES.length - 1 ? JOURNEY_SCENES[index + 1] : null;
}
