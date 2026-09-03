export const JOURNEY_SCENES = [
  "arrival",
  "forestEntry",
  "trail",
  "chainTraverse",
  "rubbleSlope",
  "viewpoint",
  "letterBox",
  "sunsetFork",
  "nightSlope",
  "deepForest",
  "roadside",
  "carInterior",
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

export const JOURNEY_SCENE_INFO: Record<JourneyScene, JourneySceneInfo> = {
  arrival: {
    place: "洛恩谷 · 临时停靠点",
    elevation: "1,220 m",
    asset: "art/stage1-arrival-v2.webp",
    light: "day",
    minutes: 15,
    batteryCost: 1,
    photoTitle: "下车后的第一眼",
    thoughts: ["车门合上时，我才发现——整辆车只有我一个人下了。", "不过天气比预报里好。来都来了，就往上走一点点。"],
  },
  forestEntry: {
    place: "青杉林 · 入谷旧路",
    elevation: "1,315 m",
    asset: "art/forest-entry-base-v1.webp",
    light: "day",
    minutes: 30,
    batteryCost: 1,
    photoTitle: "林子把山藏了一半",
    thoughts: ["树影一下子把公路的声音关在了身后。", "回头还能看见来路。现在往前，似乎也没什么大不了。"],
  },
  trail: {
    place: "旧牧道 · 林间岔口",
    elevation: "1,410 m",
    asset: "art/stage1-trail.webp",
    light: "day",
    minutes: 32,
    batteryCost: 2,
    photoTitle: "两条路都像邀请",
    thoughts: ["地图上只有一条细线，眼前却有两条路。", "不用猜哪条正确。选一条，自己走过去。"],
  },
  chainTraverse: {
    place: "白砾岩壁 · 铁索横道",
    elevation: "1,515 m",
    asset: "art/chain-traverse-base-v1.webp",
    light: "day",
    minutes: 32,
    batteryCost: 1,
    photoTitle: "岩壁外面全是风",
    thoughts: ["铁索比看起来更凉。每向前一步，山谷就多露出一点。", "不用快。抓稳，确认脚下，再把重心移过去。"],
  },
  rubbleSlope: {
    place: "碎石坡 · 回望处",
    elevation: "1,610 m",
    asset: "art/rubble-slope-base-v1.webp",
    light: "day",
    minutes: 40,
    batteryCost: 2,
    photoTitle: "原来已经走了这么远",
    thoughts: ["碎石会在鞋底下轻轻滑开，像是在提醒我别逞强。", "一回头，林间的小路已经缩成了一根线。"],
  },
  viewpoint: {
    place: "无名观景台",
    elevation: "1,680 m",
    asset: "art/stage1-viewpoint-clean-v2.webp",
    light: "day",
    minutes: 30,
    batteryCost: 3,
    photoTitle: "风从山谷另一边来",
    thoughts: ["风从山脊另一边吹过来，整片山谷忽然亮了。", "原来不是所有风景，都需要先知道名字。"],
  },
  letterBox: {
    place: "无名观景台 · 旧信箱",
    elevation: "1,682 m",
    asset: "art/stage1-viewpoint-clean-v2.webp",
    light: "dusk",
    minutes: 15,
    batteryCost: 1,
    photoTitle: "被风留下的字",
    thoughts: ["石头后面压着一只旧信盒，里面只剩一张被晒白的纸。", "‘离开山谷以前，记得再看一眼来路。’落款已经认不出了。"],
  },
  sunsetFork: {
    place: "回程岔口 · 日落线",
    elevation: "1,545 m",
    asset: "art/rubble-slope-base-v1.webp",
    light: "dusk",
    minutes: 60,
    batteryCost: 2,
    photoTitle: "光已经走到山后面",
    thoughts: ["刚才觉得很宽的路，在斜光里忽然陌生起来。", "末班车的时间和当前位置之间，第一次出现了不太好看的空白。"],
  },
  nightSlope: {
    place: "回程山坡 · 无照明路段",
    elevation: "1,430 m",
    asset: "art/night-slope-base-v1.webp",
    light: "night",
    minutes: 28,
    batteryCost: 5,
    photoTitle: "手电照到的那小块路",
    thoughts: ["天不是一下子黑的。是我终于承认，已经看不清路了。", "先停下。打开手电，找下一块稳的地面。"],
  },
  deepForest: {
    place: "青杉林 · 回程旧路",
    elevation: "1,335 m",
    asset: "art/night-trail-base-v1.webp",
    light: "night",
    minutes: 24,
    batteryCost: 6,
    photoTitle: "林子里只有呼吸声",
    thoughts: ["林子把风挡住以后，我才听见自己的呼吸有多快。", "手机从外套口袋滑出去时，我只顾着扶住旁边的树。"],
  },
  roadside: {
    place: "谷底公路 · 旧里程牌",
    elevation: "1,225 m",
    asset: "art/roadside-night-base-v1.webp",
    light: "night",
    minutes: 17,
    batteryCost: 0,
    photoTitle: "远处终于有了灯",
    thoughts: ["树缝外面先出现两束光，然后才听见轮胎压过碎石。", "我挥手的时候，才发现手一直在抖。"],
  },
  carInterior: {
    place: "阿岚的车 · 暖风口旁",
    elevation: "1,210 m",
    asset: "art/car-interior-base-v1.webp",
    light: "interior",
    minutes: 26,
    batteryCost: 0,
    photoTitle: "陌生人的暖风",
    thoughts: ["他们没有问我为什么一个人跑进山里，只先递来热水。", "副驾叫阿岚，后座的乔乔把毯子往我这边又推了一点。"],
  },
  searchRoad: {
    place: "青杉林 · 清晨寻路",
    elevation: "1,300 m",
    asset: "art/search-dawn-base-v1.webp",
    light: "dawn",
    minutes: 34,
    batteryCost: 0,
    photoTitle: "三个人走过的回头路",
    thoughts: ["天亮后，昨晚的黑路重新变回了普通的树林。", "我们沿着我记得的细节往回找：倒下的树、白色石头、拐弯处的苔。"],
  },
  valleyExit: {
    place: "洛恩谷 · 离谷车站",
    elevation: "1,220 m",
    asset: "art/valley-exit-dawn-base-v1.webp",
    light: "dawn",
    minutes: 18,
    batteryCost: 0,
    photoTitle: "离开山谷以前",
    thoughts: ["手机只是被一位清晨遛狗的人捡到，又在站牌下还给了我。", "没有奇迹。可我还是在上车前，回头看了一眼来路。"],
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
