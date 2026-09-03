import { Check, Flashlight, RotateCcw, Settings as SettingsIcon, Smartphone, Volume2, VolumeX } from "lucide-react";
import { lazy, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { loadSettings, saveSettings, type GameSettings } from "./settings";
import { SILENCE, Soundscape, type Ambience, type SoundMaterial } from "./soundscape";
import Phone, { type PhoneTab } from "./Phone";
import type { BreathState, JourneyScene, LookPoint } from "./PixiJourney";
import { createInitialPhoneState, formatGameTime, NEXT_MORNING_DATE, phoneReducer, sceneAsset, type ContactId, type PhoneState } from "./phoneModel";
import { isJourneyScene, JOURNEY_SCENE_INFO, journeySceneIndex, LETTER_LINES_IT, LETTER_LINES_ZH, nextJourneyScene } from "./journeyModel";
import { clearJourneySave, INITIAL_INTERACTIONS, loadJourneySave, persistJourneySave, type JourneyInteractionState, type JourneySave } from "./saveModel";

type Phase = "title" | JourneyScene | "complete";
type Route = "open" | "stream" | null;

const SCENE_INFO = JOURNEY_SCENE_INFO;

const STONES = [
  { x: 68, y: 70 },
  { x: 61, y: 61 },
  { x: 67, y: 51 },
  { x: 73, y: 41 },
];

const CHAIN_POINTS = [
  { x: 26, y: 61 },
  { x: 35, y: 54 },
  { x: 44, y: 47 },
  { x: 53, y: 40 },
];

const RUBBLE_POINTS = [
  { x: 42, y: 70 },
  { x: 54, y: 60 },
  { x: 63, y: 49 },
  { x: 73, y: 36 },
];

const NIGHT_SLOPE_POINTS = [
  { x: 40, y: 72 },
  { x: 47, y: 61 },
  { x: 37, y: 50 },
  { x: 30, y: 39 },
];

const DEEP_FOREST_POINTS = [
  { x: 64, y: 71 },
  { x: 69, y: 60 },
  { x: 75, y: 49 },
  { x: 68, y: 39 },
];

const SEARCH_POINTS = [
  { x: 23, y: 62, label: "倒下的树根" },
  { x: 49, y: 73, label: "白色石头" },
  { x: 70, y: 54, label: "拐弯处的苔" },
];

const CHAIN_UPPER_POINTS = [
  { x: 71, y: 84 },
  { x: 62, y: 66 },
  { x: 54, y: 50 },
  { x: 46, y: 34 },
];

const MARKER_POINTS = [
  { x: 22, y: 64, label: "树桩" },
  { x: 68, y: 68, label: "溪边的石头" },
  { x: 58, y: 44, label: "路标" },
];

const BANK_POINTS = [
  { x: 34, y: 74 },
  { x: 50, y: 60 },
  { x: 60, y: 46 },
  { x: 64, y: 28 },
];

// The call she makes on the slope. Rhythm only; she gets herself down.
const CALL_LINES = [
  "拨号中……",
  "接通了。‘Pronto, emergenza.’",
  "我说：我在山上。天黑了。我一个人。",
  "对方的英语和我的英语在风里碎成一片。",
  "我只听清了一句：往公路的方向走。",
  "通话结束 · 02:14",
];

type LightMode = "off" | "phone" | "flashlight";
type DeerState = "hidden" | "standing" | "leaving";

// Where the deer stands on the sunset board, as a look-space x (-1..1); used to
// notice when she is looking straight at it.
const DEER_LOOK_X = (0.24 - 0.5) * 2;
const CREDIT_LINES_TOTAL = LETTER_LINES_IT.length + LETTER_LINES_ZH.length;

// Quiet chapter cards at the turns of the day.
const CHAPTER_CARDS: Partial<Record<JourneyScene, { eyebrow: string; title: string }>> = {
  school: { eyebrow: "多洛米蒂 · 八月", title: "两个小时" },
  arrival: { eyebrow: "下午", title: "来都来了" },
  sunsetFork: { eyebrow: "日落", title: "光已经走到山后面" },
  nightSlope: { eyebrow: "夜", title: "一小块一小块地走" },
  roadside: { eyebrow: "谷底公路", title: "远处终于有了灯" },
  police: { eyebrow: "第二天 · 清晨", title: "天亮了" },
  searchRoad: { eyebrow: "清晨", title: "回头路" },
};

// What each place sounds like. Wind tone: open ridge ~1450, forest ~900, night ~540.
const AMBIENCE: Record<JourneyScene, Ambience> = {
  school: { ...SILENCE, wind: 0.06, windTone: 500, birds: 0.25 },
  arrival: { ...SILENCE, wind: 0.4, windTone: 920, birds: 0.5 },
  forestEntry: { ...SILENCE, wind: 0.25, windTone: 900, birds: 0.9, stream: 0.12 },
  trail: { ...SILENCE, wind: 0.25, windTone: 900, birds: 0.8, stream: 0.7 },
  chainTraverse: { ...SILENCE, wind: 0.95, windTone: 1450, birds: 0.12 },
  chainUpper: { ...SILENCE, wind: 1, windTone: 1500, birds: 0.05 },
  rubbleSlope: { ...SILENCE, wind: 0.75, windTone: 1450, birds: 0.2 },
  viewpoint: { ...SILENCE, wind: 0.85, windTone: 1450, birds: 0.25 },
  summitRest: { ...SILENCE, wind: 0.7, windTone: 1400, birds: 0.25 },
  letterBox: { ...SILENCE, wind: 0.7, windTone: 1300, birds: 0.2 },
  sunsetFork: { ...SILENCE, wind: 0.6, windTone: 1200, birds: 0.08, crickets: 0.3 },
  nightSlope: { ...SILENCE, wind: 0.5, windTone: 540, crickets: 0.7 },
  deepForest: { ...SILENCE, wind: 0.2, windTone: 540, crickets: 0.9, stream: 0.1 },
  marker656: { ...SILENCE, wind: 0.18, windTone: 520, crickets: 0.85 },
  roadBank: { ...SILENCE, wind: 0.35, windTone: 620, crickets: 0.4, engine: 0.12 },
  roadside: { ...SILENCE, wind: 0.3, windTone: 700, crickets: 0.5, engine: 0.6 },
  carInterior: { ...SILENCE, wind: 0.05, windTone: 360, engine: 1, heater: 1 },
  police: { ...SILENCE, wind: 0.15, windTone: 800, birds: 0.5, engine: 0.1 },
  searchRoad: { ...SILENCE, wind: 0.25, windTone: 900, birds: 0.7, stream: 0.1 },
  valleyExit: { ...SILENCE, wind: 0.3, windTone: 900, birds: 0.6, engine: 0.15 },
};

const stepMaterialFor = (scene: JourneyScene): SoundMaterial =>
  scene === "chainTraverse" || scene === "chainUpper" || scene === "rubbleSlope" || scene === "nightSlope" ? "rock"
    : scene === "roadside" || scene === "valleyExit" || scene === "arrival" || scene === "school" || scene === "police" ? "road"
      : scene === "sunsetFork" || scene === "roadBank" ? "gravel"
        : "soft";

const NIGHT_LIGHT_SCENES: readonly JourneyScene[] = ["nightSlope", "deepForest", "marker656", "roadBank"];

const requestedDevScene = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("scene") : null;
const DEV_SCENE: JourneyScene | null = isJourneyScene(requestedDevScene) ? requestedDevScene : null;

function createDevInteractions(scene: JourneyScene | null): JourneyInteractionState {
  const state = { ...INITIAL_INTERACTIONS };
  if (!scene) return state;
  const index = journeySceneIndex(scene);
  const after = (other: JourneyScene) => index > journeySceneIndex(other);
  if (after("school")) state.routeDrawn = true;
  if (after("chainTraverse")) state.chainStep = CHAIN_POINTS.length;
  if (after("chainUpper")) state.chainUpperStep = CHAIN_UPPER_POINTS.length;
  if (after("rubbleSlope")) state.rubbleStep = RUBBLE_POINTS.length;
  if (after("summitRest")) state.chocolateEaten = true;
  if (after("letterBox")) state.letterRead = true;
  if (after("nightSlope")) { state.callDone = true; state.nightStep = NIGHT_SLOPE_POINTS.length; }
  if (after("deepForest")) { state.nightStep += DEEP_FOREST_POINTS.length; state.phoneLost = true; }
  if (after("marker656")) state.markerStep = MARKER_POINTS.length;
  if (after("roadBank")) state.bankStep = BANK_POINTS.length;
  if (after("roadside")) state.rescuersMet = true;
  if (after("carInterior")) state.rescueStep = 6;
  if (after("police")) state.policeStep = 3;
  if (scene === "valleyExit") { state.searchStep = SEARCH_POINTS.length; state.phoneReturned = true; state.phoneLost = false; }
  return state;
}

function createJourneyPhoneState(): PhoneState {
  const state = createInitialPhoneState();
  if (!DEV_SCENE) return state;
  const previewTimes: Partial<Record<JourneyScene, number>> = {
    school: 14 * 60 + 40,
    chainUpper: 16 * 60 + 50,
    summitRest: 18 * 60 + 5,
    sunsetFork: 19 * 60 + 40,
    nightSlope: 20 * 60 + 50,
    deepForest: 21 * 60 + 30,
    marker656: 21 * 60 + 55,
    roadBank: 22 * 60 + 5,
    roadside: 22 * 60 + 25,
    carInterior: 22 * 60 + 40,
    police: 6 * 60 + 5,
    searchRoad: 6 * 60 + 35,
    valleyExit: 7 * 60 + 40,
  };
  state.minuteOfDay = previewTimes[DEV_SCENE] ?? state.minuteOfDay;
  if (DEV_SCENE === "police" || DEV_SCENE === "searchRoad" || DEV_SCENE === "valleyExit") state.date = { ...NEXT_MORNING_DATE };
  // Past the summit she has already photographed the letter; seed it so the
  // ending can be previewed from any later scene.
  if (journeySceneIndex(DEV_SCENE) > journeySceneIndex("letterBox")) {
    state.photos = [{
      id: "dev-letter",
      kind: "letter",
      asset: JOURNEY_SCENE_INFO.letterBox.asset,
      title: JOURNEY_SCENE_INFO.letterBox.photoTitle,
      place: JOURNEY_SCENE_INFO.letterBox.place,
      dateLabel: DEV_SCENE === "police" || DEV_SCENE === "searchRoad" || DEV_SCENE === "valleyExit" ? "昨天" : "今天",
      minute: 17 * 60 + 5,
      position: { x: 68, y: 66 },
      zoom: 1.6,
      isNew: true,
    }, ...state.photos];
  }
  return state;
}

const PHONE_BEATS: Partial<Record<Phase, { id: string; contactId: ContactId; text: string }>> = {
  forestEntry: { id: "forest-asha", contactId: "asha", text: "看到怪路牌记得拍。我想画一组路牌。" },
  trail: { id: "trail-xiaoyu", contactId: "xiaoyu", text: "刚看了你的定位，那边的天好蓝。替我多看两眼。" },
  chainUpper: { id: "upper-xiaoyu", contactId: "xiaoyu", text: "？？？你的定位怎么在一面悬崖上" },
  viewpoint: { id: "viewpoint-mama", contactId: "mama", text: "小树收到了。今天的山好看吗？" },
  summitRest: { id: "rest-asha", contactId: "asha", text: "书装完了。空房间里回声好大。你到顶了吗？" },
  sunsetFork: { id: "sunset-asha", contactId: "asha", text: "我在收拾最后一箱书。你那边现在是什么颜色的天？" },
  nightSlope: { id: "night-xiaoyu", contactId: "xiaoyu", text: "睡前看到你的定位还在山上。拍到星星了吗？" },
  valleyExit: { id: "exit-xiaoyu", contactId: "xiaoyu", text: "定位又亮了！！你昨晚去哪了，一整夜都是灰的" },
};

const PHONE_REPLIES: Record<ContactId, Record<"text" | "photo", Partial<Record<JourneyScene, string>>>> = {  xiaoyu: {
    text: {
      school: "教练？你还真找了个教练。行，等你照片。",
      arrival: "行，我等照片。",
      forestEntry: "林子里信号还有啊。替我闻一下松树。",
      trail: "你每次说‘就走一点’，最后都要多走半座山。哈哈。",
      chainTraverse: "铁索？？你抓稳了再回我。",
      chainUpper: "我不看了，我看着腿软。",
      rubbleSlope: "回头看一眼走了多远，然后拍给我。",
      viewpoint: "你还在上面？替我看一眼那边的云。",
      summitRest: "巧克力留一半！你每次都吃光。",
      letterBox: "信箱？山顶有信箱？你拍了没有。",
      sunsetFork: "太阳下山了你还在上面？慢慢来。",
      police: "警局？？你先告诉我你人没事。",
      valleyExit: "回来第一顿我请。你把这一夜讲三遍我都听。",
    },
    photo: {
      school: "这地图上的线画得好随意，哈哈。",
      arrival: "空得有点电影开场的感觉。",
      forestEntry: "这光！像有人在树上开了灯。",
      trail: "这个光好看。构图也很你——路总要留一大半。",
      chainTraverse: "你在悬崖上还拍照？？好吧，好看。",
      chainUpper: "只有天。这张我要设成壁纸。",
      rubbleSlope: "原来你走了这么远。",
      viewpoint: "好看！原图存好，回来洗出来贴墙上。",
      summitRest: "巧克力和风景一起拍，很你。",
      letterBox: "意大利语？我一个词都不认识。留着，回来找人翻。",
      sunsetFork: "这个颜色。我不说话了。",
      police: "灯还亮着。好温柔的一张。",
      valleyExit: "回头看那一眼，我懂。",
    },
  },
  mama: {
    text: {
      school: "有教练就好。听教练的。",
      arrival: "看到了。慢慢走。",
      forestEntry: "树多的地方凉快，走慢点。",
      trail: "不用赶，看够了再往前。",
      chainTraverse: "妈妈不看这个。到了上面再发。",
      chainUpper: "收到。上面风大吗。",
      rubbleSlope: "石头路走稳。累了就坐一会儿。",
      viewpoint: "风大的地方站一会儿就好。回来讲给我听。",
      summitRest: "吃点东西。你从小爬山就忘了吃。",
      letterBox: "别人留的信就别拿走，看看就好。",
      sunsetFork: "天黑得快，看看时间。",
      police: "在警局就好。人平安比什么都重要。回来再说。",
      valleyExit: "定位又亮了。回来慢慢讲给我听。",
    },
    photo: {
      school: "地图。你小时候也爱看地图。",
      arrival: "天气真好。你小时候也总爱在半路忽然下车看东西。",
      forestEntry: "这片林子真好看。",
      trail: "树很漂亮。",
      chainTraverse: "妈妈手心出汗。",
      chainUpper: "天真蓝。",
      rubbleSlope: "走了好远。",
      viewpoint: "收到了，很开阔。你爸问是哪座山。",
      summitRest: "看到巧克力了。多吃点。",
      letterBox: "有人在山顶写信，真好。",
      sunsetFork: "好看。天黑前下来。",
      police: "灯亮着就好。",
      valleyExit: "回来了就好。",
    },
  },
  asha: {
    text: {
      school: "教练画的线发我一张，我想画一张‘别人给我画的地图’。",
      arrival: "临时拐进去的地方通常最好画，帮我多看两眼颜色。",
      forestEntry: "松林里的光是绿的还是黄的？我要画。",
      trail: "别找标准路线，哪边让你想走就走哪边。",
      chainTraverse: "铁索是什么颜色？我猜是锈红。",
      chainUpper: "你现在的视野里有几种蓝？",
      rubbleSlope: "回头的那一眼，一定要拍。",
      viewpoint: "先别给风景起名字，回来再告诉我它像什么。",
      summitRest: "坐着的时候看一眼脚边，脚边总有好东西。",
      letterBox: "信！山顶的信！念给我听，我不管听不听得懂。",
      sunsetFork: "日落的橙色和珊瑚色，哪个多？",
      police: "警局门口有灯吗。有的话拍一张。",
      valleyExit: "回来一起看。这一年，还有这一夜。",
    },
    photo: {
      school: "地图的褶皱我要画。",
      arrival: "这个灰蓝和珊瑚色可以！原图留着，我晚上想画。",
      forestEntry: "松针里漏下来的光。我知道该怎么画了。",
      trail: "你把路放在画面边上这点很妙，像它还会继续出去。",
      chainTraverse: "岩壁的白和天的蓝。谢谢。",
      chainUpper: "只有天。这张我画三遍。",
      rubbleSlope: "线一样的小路。像回忆。",
      viewpoint: "光落得太好了。别滤镜，原图就这样发我。",
      summitRest: "银纸的反光。细节满分。",
      letterBox: "纸的黄。字的灰。我懂了。",
      sunsetFork: "这一张，什么都不用画了。",
      police: "灯的黄和天的粉。早安。",
      valleyExit: "回头的路。我等你回来一起画。",
    },
  },
};

/* ---------- background music (Kevin MacLeod, incompetech.com, CC BY 4.0) ----------
   Daytime scenes carry a little music; the night and the dawn search stay with
   wind and breath alone; the ending theme enters slowly only after she has
   re-read the letter in her own album. */
type MusicKind = "day" | "warm" | "end";
const MUSIC_TRACKS: Record<MusicKind, { src: string; volume: number; fadeStep: number }> = {
  day: { src: "audio/clear-air.mp3", volume: 0.14, fadeStep: 0.02 },
  warm: { src: "audio/simple-duet.mp3", volume: 0.2, fadeStep: 0.02 },
  end: { src: "audio/promises-to-keep.mp3", volume: 0.2, fadeStep: 0.006 },
};
const DAY_MUSIC_SCENES: readonly JourneyScene[] = ["school", "arrival", "forestEntry", "trail", "chainTraverse", "chainUpper", "rubbleSlope", "viewpoint", "summitRest"];

const easeInOut = (value: number) => value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
const PixiJourney = lazy(() => import("./PixiJourney"));

export default function App() {
  const [phase, setPhase] = useState<Phase>(DEV_SCENE ?? "title");
  const [scene, setScene] = useState<JourneyScene>(DEV_SCENE ?? "arrival");
  const [canvasReady, setCanvasReady] = useState(false);
  const [bagTaken, setBagTaken] = useState(DEV_SCENE !== null && DEV_SCENE !== "arrival");
  const [bagPos, setBagPos] = useState({ x: 84, y: 74 });
  const [bagDragging, setBagDragging] = useState(false);
  const [arrivalProgress, setArrivalProgress] = useState(0);
  const [trailProgress, setTrailProgress] = useState(0);
  const [sceneProgress, setSceneProgress] = useState(0);
  const [route, setRoute] = useState<Route>(null);
  const [streamStep, setStreamStep] = useState(0);
  const [interactions, setInteractions] = useState<JourneyInteractionState>(() => createDevInteractions(DEV_SCENE));
  const [moving, setMoving] = useState(false);
  const [look, setLook] = useState<LookPoint>({ x: 0, y: 0 });
  const [walkFocus, setWalkFocus] = useState<LookPoint | null>(null);
  const [breathState, setBreathState] = useState<BreathState>("calm");
  const [lightMode, setLightMode] = useState<LightMode>(DEV_SCENE && NIGHT_LIGHT_SCENES.includes(DEV_SCENE) && DEV_SCENE !== "nightSlope" ? "flashlight" : "off");
  const [callActive, setCallActive] = useState(false);
  const [callStep, setCallStep] = useState(0);
  const [thought, setThought] = useState("");
  const [feedback, setFeedback] = useState("");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("home");
  const [cameraAim, setCameraAim] = useState({ x: 50, y: 50 });
  const [cameraZoom, setCameraZoom] = useState(1);
  const [stagePhotoTaken, setStagePhotoTaken] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedJourney, setSavedJourney] = useState<JourneySave | null>(() => loadJourneySave());
  const [deerState, setDeerState] = useState<DeerState>("hidden");
  const [letterOpen, setLetterOpen] = useState(false);
  const [creditLine, setCreditLine] = useState(0);
  const [phone, dispatchPhone] = useReducer(phoneReducer, undefined, createJourneyPhoneState);
  const soundRef = useRef<Soundscape | null>(null);
  const breathAudioTimerRef = useRef(0);
  const bagStartRef = useRef({ x: 0, y: 0 });
  const transitionRef = useRef(false);
  const walkFrameRef = useRef(0);
  const recoveryTimerRef = useRef(0);
  const feedbackTimerRef = useRef(0);
  const replyTimersRef = useRef<number[]>([]);
  const narrativeMessagesRef = useRef(new Set<string>());
  const anchorLayerRef = useRef<HTMLDivElement>(null);
  const onCanvasReady = useCallback(() => setCanvasReady(true), []);

  // The title needs only its key art, not the whole renderer: show the card as
  // soon as that one image is in, while the canvas keeps preloading behind it.
  useEffect(() => {
    const image = new Image();
    image.onload = () => setCanvasReady(true);
    image.src = `${import.meta.env.BASE_URL}art/title-key-art-v1.webp`;
    const fallback = window.setTimeout(() => setCanvasReady(true), 4000);
    return () => window.clearTimeout(fallback);
  }, []);

  const flash = useCallback((message: string) => {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback(message);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(""), 1500);
  }, []);

  const markEndingGalleryViewed = useCallback(() => {
    if (phase !== "valleyExit" || sceneProgress < 1) return;
    setInteractions((value) => value.endingGallerySeen ? value : { ...value, endingGallerySeen: true });
  }, [phase, sceneProgress]);

  const startAudio = useCallback(() => {
    if (soundRef.current) return;
    try {
      const sound = new Soundscape();
      sound.setMaster(settings.master);
      soundRef.current = sound;
      setAudioReady(true);
    } catch {
      // No Web Audio; the game stays silent but playable.
    }
  }, [settings.master]);

  const stepSound = useCallback(() => {
    if (!soundOn) return;
    soundRef.current?.step(stepMaterialFor(scene));
  }, [scene, soundOn]);

  const updateSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const beginRecovery = useCallback((duration = 5200) => {
    window.clearTimeout(recoveryTimerRef.current);
    setBreathState("recovery");
    recoveryTimerRef.current = window.setTimeout(() => setBreathState("calm"), duration);
  }, []);

  useEffect(() => {
    if (!soundOn) {
      soundRef.current?.suspend();
      return;
    }
    startAudio();
    soundRef.current?.resume();
  }, [soundOn, startAudio]);

  useEffect(() => {
    soundRef.current?.setMaster(settings.master);
  }, [audioReady, settings.master]);

  useEffect(() => {
    const sound = soundRef.current;
    if (!audioReady || !sound) return;
    const activeScene: JourneyScene = phase === "title" ? "arrival" : phase === "complete" ? "valleyExit" : phase;
    sound.setAmbience(phase === "title" ? { ...AMBIENCE.arrival, wind: 0.25, birds: 0.3 } : AMBIENCE[activeScene]);
    if (phase === "carInterior") sound.carDoor();
  }, [audioReady, phase]);

  useEffect(() => {
    window.clearInterval(breathAudioTimerRef.current);
    const sound = soundRef.current;
    if (!audioReady || !sound || !soundOn || phase === "title" || phase === "complete") return;
    const profile = breathState === "walking"
      ? { interval: 1720, duration: .72, gain: .015, cutoff: 1050 }
      : breathState === "recovery"
        ? { interval: 2500, duration: 1.05, gain: .021, cutoff: 920 }
        : { interval: 5000, duration: 1.18, gain: .0065, cutoff: 760 };
    const playBreath = () => sound.breath(profile);
    const first = window.setTimeout(playBreath, 420);
    breathAudioTimerRef.current = window.setInterval(playBreath, profile.interval);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(breathAudioTimerRef.current);
    };
  }, [audioReady, breathState, phase, soundOn]);

  useEffect(() => {
    const timers: number[] = [];
    setThought("");
    if (phase !== "title" && phase !== "complete") {
      const [first, second] = SCENE_INFO[phase].thoughts;
      timers.push(window.setTimeout(() => setThought(first), 650));
      timers.push(window.setTimeout(() => setThought(second), 4300));
    }
    return () => timers.forEach(window.clearTimeout);
  }, [phase]);

  const musicElsRef = useRef<Partial<Record<MusicKind, HTMLAudioElement>>>({});
  const musicTargetsRef = useRef<Partial<Record<MusicKind, number>>>({});

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const kinds = Object.keys(MUSIC_TRACKS) as MusicKind[];
    kinds.forEach((kind) => {
      const el = document.createElement("audio");
      el.src = `${base}${MUSIC_TRACKS[kind].src}`;
      el.loop = true;
      el.preload = "none";
      el.volume = 0;
      musicElsRef.current[kind] = el;
    });
    const fadeTimer = window.setInterval(() => {
      kinds.forEach((kind) => {
        const el = musicElsRef.current[kind];
        if (!el) return;
        const target = musicTargetsRef.current[kind] ?? 0;
        const diff = target - el.volume;
        if (target > 0 && el.paused) void el.play().catch(() => undefined);
        if (Math.abs(diff) <= MUSIC_TRACKS[kind].fadeStep) {
          el.volume = target;
          if (target <= 0 && !el.paused) el.pause();
          return;
        }
        el.volume = Math.max(0, Math.min(1, el.volume + Math.sign(diff) * MUSIC_TRACKS[kind].fadeStep));
      });
    }, 100);
    return () => {
      window.clearInterval(fadeTimer);
      kinds.forEach((kind) => {
        const el = musicElsRef.current[kind];
        if (el) {
          el.pause();
          el.removeAttribute("src");
        }
      });
      musicElsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const targets: Partial<Record<MusicKind, number>> = {};
    const level = settings.music;
    if (soundOn && level > 0) {
      if (phase === "carInterior") targets.warm = MUSIC_TRACKS.warm.volume * level;
      else if (phase === "complete" || (phase === "valleyExit" && interactions.endingGallerySeen)) targets.end = MUSIC_TRACKS.end.volume * level;
      else if (phase !== "title" && DAY_MUSIC_SCENES.includes(phase)) targets.day = MUSIC_TRACKS.day.volume * level;
    }
    musicTargetsRef.current = targets;
  }, [interactions.endingGallerySeen, phase, settings.music, soundOn]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "p" && phase !== "title" && phase !== "complete" && !menuOpen) {
        if (interactions.phoneLost) {
          flash("外套口袋是空的。手机不在身上。");
          return;
        }
        soundRef.current?.uiTick(!phoneOpen);
        setPhoneOpen((value) => !value);
        setPhoneTab("home");
      }
      if (event.key === "Escape") {
        if (phoneOpen) setPhoneOpen(false);
        else if (phase !== "complete") setMenuOpen((value) => !value);
      }
      if (event.code === "Space" && phase === "trail" && route !== "open") {
        event.preventDefault();
        advanceStone();
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  });

  useEffect(() => {
    if (!phoneOpen) return;
    const timer = window.setInterval(() => dispatchPhone({ type: "advance_time", minutes: 1, batteryCost: 1 }), 45000);
    return () => window.clearInterval(timer);
  }, [phoneOpen]);

  useEffect(() => {
    if (lightMode !== "phone" || interactions.phoneLost) return;
    const timer = window.setInterval(() => dispatchPhone({ type: "advance_time", minutes: 1, batteryCost: 1 }), 30000);
    return () => window.clearInterval(timer);
  }, [interactions.phoneLost, lightMode]);

  useEffect(() => {
    if (phone.battery > 0 || lightMode !== "phone") return;
    setLightMode("off");
    flash("手机没有电了");
  }, [flash, lightMode, phone.battery]);

  useEffect(() => {
    if (phase === "nightSlope") {
      setLightMode("off");
      setBreathState("recovery");
    }
    if (phase === "roadside" || phase === "carInterior" || phase === "police" || phase === "searchRoad" || phase === "valleyExit") {
      setLightMode("off");
      setBreathState("calm");
    }
    if (phase === "police" && phone.date.day !== NEXT_MORNING_DATE.day) {
      dispatchPhone({ type: "set_clock", date: { ...NEXT_MORNING_DATE }, minuteOfDay: 6 * 60 + 5 });
    }
    if (phase === "searchRoad" && phone.date.day !== NEXT_MORNING_DATE.day) {
      dispatchPhone({ type: "set_clock", date: { ...NEXT_MORNING_DATE }, minuteOfDay: 6 * 60 + 35 });
    }
  }, [phase]);

  // The emergency call: lines arrive on their own rhythm; hanging up is hers.
  useEffect(() => {
    if (!callActive) return;
    if (callStep >= CALL_LINES.length - 1) return;
    const timer = window.setTimeout(() => setCallStep((value) => value + 1), callStep === 0 ? 2600 : 3000);
    return () => window.clearTimeout(timer);
  }, [callActive, callStep]);

  useEffect(() => {
    if (DEV_SCENE || phase === "title" || moving) return;
    const timer = window.setTimeout(() => {
      const activePhase: JourneyScene = phase === "complete" ? "valleyExit" : phase;
      const save: JourneySave = {
        version: 2,
        savedAt: new Date().toISOString(),
        phase: activePhase,
        scene: phase === "complete" ? "valleyExit" : scene,
        sceneProgress,
        bagTaken,
        arrivalProgress,
        trailProgress,
        route,
        streamStep,
        interactions,
        look,
        cameraAim,
        cameraZoom,
        stagePhotoTaken,
        phone,
      };
      if (persistJourneySave(save)) setSavedJourney(save);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [arrivalProgress, bagTaken, cameraAim, cameraZoom, interactions, moving, phase, phone, route, scene, sceneProgress, stagePhotoTaken, streamStep, trailProgress]);

  // The deer at the tree line: steps out a moment after she arrives on the
  // shoulder, watches her for a while, and walks off when she looks straight
  // at it for a beat, starts walking, or simply after a while.
  useEffect(() => {
    if (phase !== "sunsetFork") {
      setDeerState("hidden");
      return;
    }
    const appear = window.setTimeout(() => setDeerState("standing"), 2400);
    const leave = window.setTimeout(() => setDeerState((state) => state === "standing" ? "leaving" : state), 14000);
    return () => {
      window.clearTimeout(appear);
      window.clearTimeout(leave);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "sunsetFork" || deerState !== "standing") return;
    if (moving) {
      setDeerState("leaving");
      return;
    }
    if (Math.abs(look.x - DEER_LOOK_X) > 0.28 || look.y > 0.35) return;
    const timer = window.setTimeout(() => setDeerState("leaving"), 1700);
    return () => window.clearTimeout(timer);
  }, [deerState, look.x, look.y, moving, phase]);

  // Ending: the letter is read out line by line before the closing card.
  useEffect(() => {
    if (phase !== "complete") {
      setCreditLine(0);
      return;
    }
    const timer = window.setInterval(() => setCreditLine((value) => value > CREDIT_LINES_TOTAL ? value : value + 1), 1400);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const beat = PHONE_BEATS[phase];
    if (!beat || narrativeMessagesRef.current.has(beat.id)) return;
    narrativeMessagesRef.current.add(beat.id);
    dispatchPhone({ type: "receive_message", contactId: beat.contactId, text: beat.text });
  }, [phase]);

  useEffect(() => {
    if (phase === "title" || phase === "complete" || transitionRef.current) return;
    const sceneFinished =
      (phase === "arrival" && arrivalProgress >= 1) ||
      (phase === "trail" && trailProgress >= 1) ||
      (phase === "chainTraverse" && interactions.chainStep >= CHAIN_POINTS.length) ||
      (phase === "chainUpper" && interactions.chainUpperStep >= CHAIN_UPPER_POINTS.length) ||
      (phase === "rubbleSlope" && interactions.rubbleStep >= RUBBLE_POINTS.length) ||
      (phase === "nightSlope" && interactions.nightStep >= NIGHT_SLOPE_POINTS.length) ||
      (phase === "deepForest" && interactions.nightStep >= NIGHT_SLOPE_POINTS.length + DEEP_FOREST_POINTS.length) ||
      (phase === "marker656" && interactions.markerStep >= MARKER_POINTS.length) ||
      (phase === "roadBank" && interactions.bankStep >= BANK_POINTS.length) ||
      (phase === "roadside" && interactions.rescuersMet) ||
      (phase === "carInterior" && interactions.rescueStep >= 6) ||
      (phase === "police" && interactions.policeStep >= 3) ||
      (phase === "searchRoad" && interactions.phoneReturned) ||
      (phase === "valleyExit" && sceneProgress >= 1 && interactions.endingGallerySeen && !phoneOpen) ||
      (!["arrival", "trail", "chainTraverse", "chainUpper", "rubbleSlope", "nightSlope", "deepForest", "marker656", "roadBank", "roadside", "carInterior", "police", "searchRoad", "valleyExit"].includes(phase) && sceneProgress >= 1);
    if (!sceneFinished) return;
    transitionRef.current = true;
    const transitionDelay = phase === "viewpoint" ? 2600 : phase === "deepForest" ? 3600 : phase === "marker656" ? 2600 : phase === "roadBank" ? 3400 : phase === "roadside" ? 3800 : phase === "carInterior" ? 4200 : phase === "police" ? 3400 : phase === "searchRoad" ? 3600 : 720;
    const timer = window.setTimeout(() => {
      const next = nextJourneyScene(phase);
      if (!next) {
        setPhase("complete");
      } else {
        setScene(next);
        setPhase(next);
        setSceneProgress(0);
      }
      setLook({ x: 0, y: 0 });
      setWalkFocus(null);
      transitionRef.current = false;
    }, transitionDelay);
    return () => window.clearTimeout(timer);
  }, [arrivalProgress, interactions, phase, phoneOpen, sceneProgress, stagePhotoTaken, trailProgress]);

  useEffect(() => () => {
    cancelAnimationFrame(walkFrameRef.current);
    window.clearTimeout(recoveryTimerRef.current);
    window.clearTimeout(feedbackTimerRef.current);
    window.clearInterval(breathAudioTimerRef.current);
    replyTimersRef.current.forEach(window.clearTimeout);
    soundRef.current?.dispose();
  }, []);

  const resetRuntime = (nextPhase: "title" | "school") => {
    cancelAnimationFrame(walkFrameRef.current);
    window.clearTimeout(recoveryTimerRef.current);
    replyTimersRef.current.forEach(window.clearTimeout);
    replyTimersRef.current = [];
    clearJourneySave();
    setSavedJourney(null);
    setPhase(nextPhase);
    setScene("school");
    setCallActive(false);
    setCallStep(0);
    setLetterOpen(false);
    setBagTaken(false);
    setBagPos({ x: 84, y: 74 });
    setArrivalProgress(0);
    setTrailProgress(0);
    setSceneProgress(0);
    setRoute(null);
    setStreamStep(0);
    setInteractions({ ...INITIAL_INTERACTIONS });
    setMoving(false);
    setLook({ x: 0, y: 0 });
    setWalkFocus(null);
    setBreathState("calm");
    setLightMode("off");
    setPhoneOpen(false);
    setPhoneTab("home");
    setCameraAim({ x: 50, y: 50 });
    setCameraZoom(1);
    setStagePhotoTaken(false);
    setThought("");
    narrativeMessagesRef.current.clear();
    dispatchPhone({ type: "reset" });
    transitionRef.current = false;
  };

  const begin = () => {
    if (soundOn) {
      startAudio();
      soundRef.current?.resume();
    }
    setMenuOpen(false);
    resetRuntime("school");
  };

  const continueJourney = () => {
    if (!savedJourney) return;
    if (soundOn) {
      startAudio();
      soundRef.current?.resume();
    }
    setMenuOpen(false);
    cancelAnimationFrame(walkFrameRef.current);
    setPhase(savedJourney.phase);
    setScene(savedJourney.scene);
    setBagTaken(savedJourney.bagTaken);
    setBagPos({ x: 84, y: 74 });
    setArrivalProgress(savedJourney.arrivalProgress);
    setTrailProgress(savedJourney.trailProgress);
    setSceneProgress(savedJourney.sceneProgress);
    setRoute(savedJourney.route);
    setStreamStep(savedJourney.streamStep);
    setInteractions({ ...INITIAL_INTERACTIONS, ...savedJourney.interactions });
    setMoving(false);
    setLook(savedJourney.look);
    setWalkFocus(null);
    setBreathState("calm");
    setLightMode(NIGHT_LIGHT_SCENES.includes(savedJourney.phase) && savedJourney.interactions.callDone ? "flashlight" : "off");
    setCallActive(false);
    setCallStep(0);
    setLetterOpen(false);
    setPhoneOpen(false);
    setPhoneTab("home");
    setCameraAim(savedJourney.cameraAim);
    setCameraZoom(savedJourney.cameraZoom);
    setStagePhotoTaken(savedJourney.stagePhotoTaken);
    narrativeMessagesRef.current.clear();
    const restoredSceneIndex = journeySceneIndex(savedJourney.phase);
    (Object.entries(PHONE_BEATS) as Array<[Phase, { id: string }]>).forEach(([beatPhase, beat]) => {
      if (isJourneyScene(beatPhase) && journeySceneIndex(beatPhase) <= restoredSceneIndex) narrativeMessagesRef.current.add(beat.id);
    });
    dispatchPhone({ type: "restore", state: savedJourney.phone });
    transitionRef.current = false;
  };

  const startAutomaticWalk = useCallback((target: LookPoint) => {
    if (moving || transitionRef.current || phase === "title" || phase === "complete") return;
    const startValue = phase === "arrival" ? arrivalProgress : phase === "trail" ? trailProgress : sceneProgress;
    const duration = phase === "arrival" ? 3300 : phase === "trail" ? 3900 : 3600;
    const { minutes, batteryCost } = SCENE_INFO[scene];
    const startedAt = performance.now();
    let lastStepAt = -1000;
    setWalkFocus(target);
    setMoving(true);
    setBreathState("walking");

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const normalized = Math.min(1, elapsed / duration);
      const value = startValue + (1 - startValue) * easeInOut(normalized);
      if (phase === "arrival") setArrivalProgress(value);
      else if (phase === "trail") setTrailProgress(value);
      else setSceneProgress(value);
      if (elapsed - lastStepAt > 500) {
        lastStepAt = elapsed;
        stepSound();
      }
      if (normalized < 1) {
        walkFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      setMoving(false);
      dispatchPhone({ type: "advance_time", minutes, batteryCost });
      beginRecovery(5600);
    };
    walkFrameRef.current = requestAnimationFrame(tick);
  }, [arrivalProgress, beginRecovery, moving, phase, scene, sceneProgress, stepSound, trailProgress]);

  const coords = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const worldClick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (phoneOpen || moving) return;
    const point = coords(event);
    const focus = { x: (point.x - 0.5) * 2, y: (point.y - 0.5) * 2 };
    if (phase === "arrival") {
      if (!bagTaken) {
        flash("背包还在候车亭里");
        return;
      }
      if (point.x > 0.31 && point.x < 0.78 && point.y > 0.3) startAutomaticWalk(focus);
      else flash(point.x < 0.32 ? "公路往山下绕去了" : "那边没有可以走的路");
    }
    if (phase === "trail") {
      if (route === null && point.x < 0.55 && point.y > 0.28) {
        setRoute("open");
        setThought("我选了左边。路远一点，但能一直看见山。");
        startAutomaticWalk(focus);
      } else if (route === "open" && trailProgress < 1) startAutomaticWalk(focus);
      else if (route === null) flash("右侧溪水里有几块可以落脚的石头");
    }
    if (phase === "forestEntry") {
      if (point.x > 0.28 && point.x < 0.76 && point.y > 0.34) startAutomaticWalk(focus);
      else flash("林间旧路在树影中间");
    }
    if (phase === "letterBox" && !interactions.letterRead) {
      flash("信箱里好像留着什么");
    }
    if (phase === "school") {
      if (!interactions.routeDrawn) flash("先看看桌上的地图");
      else if (point.x > 0.6) startAutomaticWalk(focus);
      else flash("门在右边");
    }
    if (phase === "summitRest") {
      if (!interactions.chocolateEaten) flash("先坐一会儿。脚边有东西");
      else startAutomaticWalk(focus);
    }
    if (phase === "sunsetFork" || phase === "valleyExit" || phase === "viewpoint" || (phase === "letterBox" && interactions.letterRead)) {
      startAutomaticWalk(focus);
    }
  };

  const drawRoute = () => {
    if (phase !== "school" || interactions.routeDrawn) return;
    setInteractions((value) => ({ ...value, routeDrawn: true }));
    setThought("铅笔在地图上画了一条线，停在一个小三角上。‘两个小时，你就能站在上面。’");
    if (soundOn) soundRef.current?.uiTick(true);
    dispatchPhone({ type: "advance_time", minutes: 6, batteryCost: 0 });
  };

  const eatChocolate = () => {
    if (phase !== "summitRest" || interactions.chocolateEaten) return;
    setInteractions((value) => ({ ...value, chocolateEaten: true }));
    setThought("掰下两格。剩下的用银纸包好，塞回口袋。风把包装纸吹得哗哗响。");
    dispatchPhone({ type: "advance_time", minutes: 10, batteryCost: 0 });
    beginRecovery(4000);
  };

  const startCall = () => {
    if (phase !== "nightSlope" || interactions.callDone || callActive) return;
    setCallStep(0);
    setCallActive(true);
    setThought("");
    openPhone("call");
  };

  const hangUp = () => {
    if (!callActive) return;
    setCallActive(false);
    setInteractions((value) => ({ ...value, callDone: true }));
    dispatchPhone({ type: "advance_time", minutes: 4, batteryCost: 3 });
    closePhone();
    setThought("挂掉电话。风还在。我打开补光灯。");
  };

  const advanceChainUpper = () => {
    if (phase !== "chainUpper" || moving || interactions.chainUpperStep >= CHAIN_UPPER_POINTS.length) return;
    const point = CHAIN_UPPER_POINTS[interactions.chainUpperStep];
    setWalkFocus({ x: (point.x / 100 - 0.5) * 2, y: (point.y / 100 - 0.5) * 2 });
    setMoving(true);
    setBreathState("walking");
    if (soundOn) soundRef.current?.chainClink();
    stepSound();
    window.setTimeout(() => {
      const next = interactions.chainUpperStep + 1;
      setInteractions((value) => ({ ...value, chainUpperStep: next }));
      setSceneProgress(next / CHAIN_UPPER_POINTS.length);
      dispatchPhone({ type: "advance_time", minutes: 7, batteryCost: next === CHAIN_UPPER_POINTS.length ? 1 : 0 });
      setMoving(false);
      if (next === CHAIN_UPPER_POINTS.length) {
        setThought("最后一级。翻上去的时候，风忽然从四面八方来了。");
        beginRecovery(7200);
      } else setBreathState("recovery");
    }, 680);
  };

  const advanceMarker = () => {
    if (phase !== "marker656" || moving || interactions.markerStep >= MARKER_POINTS.length) return;
    if (lightMode === "off") {
      flash("先打开一种光，再一处一处地照");
      return;
    }
    const point = MARKER_POINTS[interactions.markerStep];
    setWalkFocus({ x: (point.x / 100 - 0.5) * 2, y: (point.y / 100 - 0.5) * 2 });
    setMoving(true);
    setBreathState("walking");
    stepSound();
    window.setTimeout(() => {
      const next = interactions.markerStep + 1;
      setInteractions((value) => ({ ...value, markerStep: next }));
      setSceneProgress(next / MARKER_POINTS.length);
      dispatchPhone({ type: "advance_time", minutes: 7, batteryCost: 0 });
      setMoving(false);
      setThought(next === 1 ? "只是一截树桩。" : next === 2 ? "石头。上面什么都没有。" : "656。红白两道漆。往上，就能到公路。我对自己说了三遍。");
      if (next === MARKER_POINTS.length) beginRecovery(6000);
      else setBreathState("recovery");
    }, 700);
  };

  const advanceBank = () => {
    if (phase !== "roadBank" || moving || interactions.bankStep >= BANK_POINTS.length) return;
    if (lightMode === "off") {
      flash("先打开一种光，再找下一处能抓的地方");
      return;
    }
    const point = BANK_POINTS[interactions.bankStep];
    setWalkFocus({ x: (point.x / 100 - 0.5) * 2, y: (point.y / 100 - 0.5) * 2 });
    setMoving(true);
    setBreathState("walking");
    stepSound();
    window.setTimeout(() => {
      const next = interactions.bankStep + 1;
      setInteractions((value) => ({ ...value, bankStep: next }));
      setSceneProgress(next / BANK_POINTS.length);
      dispatchPhone({ type: "advance_time", minutes: 6, batteryCost: 0 });
      setMoving(false);
      if (next === BANK_POINTS.length) {
        setThought("护栏。手指碰到冰凉的铁的时候，我差点哭出来。");
        beginRecovery(8000);
      } else {
        setThought(next === 1 ? "树根很结实。一下。" : next === 2 ? "石头松了一点。换一处。再一下。" : "上面那道浅黑越来越近了。");
        setBreathState("recovery");
      }
    }, 760);
  };

  const advancePolice = () => {
    if (phase !== "police" || interactions.policeStep >= 3) return;
    const next = interactions.policeStep + 1;
    const lines = [
      "警局的人给我倒了一杯咖啡，问：手机是什么样子的？",
      "我说：锁屏是我自己的照片，界面是中文的。他记在本子上。",
      "‘山里捡到东西的人，通常会送到这里。’他说。我没敢抱希望。",
    ];
    setInteractions((value) => ({ ...value, policeStep: next }));
    setThought(lines[next - 1]);
    dispatchPhone({ type: "advance_time", minutes: next === 3 ? 12 : 4, batteryCost: 0 });
  };

  const worldMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = coords(event);
    setLook({ x: (point.x - 0.5) * 2, y: (point.y - 0.5) * 2 });
  };

  const bagDown = (event: React.PointerEvent<HTMLImageElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    bagStartRef.current = { x: event.clientX, y: event.clientY };
    setBagDragging(true);
  };

  const bagMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!bagDragging) return;
    setBagPos({ x: event.clientX / window.innerWidth * 100, y: event.clientY / window.innerHeight * 100 });
  };

  const bagUp = (event: React.PointerEvent<HTMLImageElement>) => {
    const pulledDown = event.clientY - bagStartRef.current.y > 85 || event.clientY / window.innerHeight > 0.82;
    setBagDragging(false);
    if (pulledDown) {
      setBagTaken(true);
      setThought("水、薄外套、补光灯、一板巧克力。走吧。");
      stepSound();
      dispatchPhone({ type: "advance_time", minutes: 2, batteryCost: 0 });
    } else setBagPos({ x: 84, y: 74 });
  };

  function advanceStone() {
    if (transitionRef.current || moving || streamStep >= STONES.length) return;
    if (route === null) {
      setRoute("stream");
      setThought("石头只露出一点。看准下一块，再落脚。");
    }
    const stone = STONES[streamStep];
    setWalkFocus({ x: (stone.x / 100 - 0.5) * 2, y: (stone.y / 100 - 0.5) * 2 });
    setMoving(true);
    setBreathState("walking");
    stepSound();
    window.setTimeout(() => {
      const next = streamStep + 1;
      setStreamStep(next);
      setTrailProgress(Math.min(1, next / STONES.length));
      dispatchPhone({ type: "advance_time", minutes: 8, batteryCost: next === STONES.length ? 2 : 0 });
      setMoving(false);
      if (next === STONES.length) beginRecovery(6200);
      else setBreathState("calm");
    }, 430);
  }

  const advanceChain = () => {
    if (phase !== "chainTraverse" || moving || interactions.chainStep >= CHAIN_POINTS.length) return;
    const point = CHAIN_POINTS[interactions.chainStep];
    setWalkFocus({ x: (point.x / 100 - 0.5) * 2, y: (point.y / 100 - 0.5) * 2 });
    setMoving(true);
    setBreathState("walking");
    if (soundOn) soundRef.current?.chainClink();
    stepSound();
    window.setTimeout(() => {
      const next = interactions.chainStep + 1;
      setInteractions((value) => ({ ...value, chainStep: next }));
      setSceneProgress(next / CHAIN_POINTS.length);
      dispatchPhone({ type: "advance_time", minutes: 8, batteryCost: next === CHAIN_POINTS.length ? 1 : 0 });
      setMoving(false);
      if (next === CHAIN_POINTS.length) beginRecovery(6800);
      else setBreathState("recovery");
    }, 620);
  };

  const advanceRubble = () => {
    if (phase !== "rubbleSlope" || moving || interactions.rubbleStep >= RUBBLE_POINTS.length) return;
    const point = RUBBLE_POINTS[interactions.rubbleStep];
    setWalkFocus({ x: (point.x / 100 - 0.5) * 2, y: (point.y / 100 - 0.5) * 2 });
    setMoving(true);
    setBreathState("walking");
    stepSound();
    window.setTimeout(() => {
      const next = interactions.rubbleStep + 1;
      setInteractions((value) => ({ ...value, rubbleStep: next }));
      setSceneProgress(next / RUBBLE_POINTS.length);
      dispatchPhone({ type: "advance_time", minutes: 10, batteryCost: next === RUBBLE_POINTS.length ? 2 : 0 });
      setMoving(false);
      if (next === RUBBLE_POINTS.length) beginRecovery(7600);
      else setBreathState("recovery");
    }, 720);
  };

  const readLetter = () => {
    if (phase !== "letterBox" || interactions.letterRead || letterOpen) return;
    setLetterOpen(true);
    setThought("");
  };

  const putLetterBack = () => {
    if (!letterOpen) return;
    setLetterOpen(false);
    setInteractions((value) => ({ ...value, letterRead: true }));
    setThought("读不懂。可是有人把它留在这里，留给任何一个走上来的人。我把它拍了下来，放回信箱。");
    dispatchPhone({
      type: "capture_photo",
      photo: {
        kind: "letter",
        asset: sceneAsset("letterBox"),
        title: SCENE_INFO.letterBox.photoTitle,
        place: SCENE_INFO.letterBox.place,
        position: { x: 68, y: 66 },
        zoom: 1.6,
      },
    });
  };

  const chooseLight = (mode: Exclude<LightMode, "off">) => {
    if (mode === "phone" && interactions.phoneLost) {
      flash("手机已经不在口袋里了");
      return;
    }
    if (mode === "phone" && phone.battery <= 0) {
      flash("手机没有电了");
      return;
    }
    setLightMode((current) => current === mode ? "off" : mode);
    if (mode === "phone") dispatchPhone({ type: "advance_time", minutes: 1, batteryCost: 1 });
  };

  const advanceNight = (nightScene: "nightSlope" | "deepForest") => {
    if (phase !== nightScene || moving) return;
    if (lightMode === "off") {
      flash("先打开一种光，再找下一块地面");
      setBreathState("recovery");
      return;
    }
    const offset = nightScene === "nightSlope" ? 0 : NIGHT_SLOPE_POINTS.length;
    const points = nightScene === "nightSlope" ? NIGHT_SLOPE_POINTS : DEEP_FOREST_POINTS;
    const localStep = interactions.nightStep - offset;
    if (localStep < 0 || localStep >= points.length) return;
    const point = points[localStep];
    setWalkFocus({ x: (point.x / 100 - 0.5) * 2, y: (point.y / 100 - 0.5) * 2 });
    setMoving(true);
    setBreathState("walking");
    stepSound();
    window.setTimeout(() => {
      const next = interactions.nightStep + 1;
      setInteractions((value) => ({
        ...value,
        nightStep: next,
        phoneLost: nightScene === "deepForest" && next >= NIGHT_SLOPE_POINTS.length + DEEP_FOREST_POINTS.length ? true : value.phoneLost,
      }));
      setSceneProgress((localStep + 1) / points.length);
      dispatchPhone({ type: "advance_time", minutes: 8, batteryCost: lightMode === "phone" ? 2 : 0 });
      setMoving(false);
      if (nightScene === "deepForest" && next >= NIGHT_SLOPE_POINTS.length + DEEP_FOREST_POINTS.length) {
        setPhoneOpen(false);
        if (lightMode === "phone") setLightMode("off");
        if (soundOn) soundRef.current?.slip();
        setThought("脚下的石头滚了一下。我抓住树，站稳了——再摸口袋时，手机已经不在了。");
        beginRecovery(9000);
      } else {
        setBreathState("recovery");
      }
    }, 760);
  };

  const meetRescuers = () => {
    if (phase !== "roadside" || interactions.rescuersMet) return;
    setInteractions((value) => ({ ...value, rescuersMet: true }));
    setThought("车停下来了。车窗降下，里面的人先问：‘你还好吗？上来吧，外面冷。’");
    setBreathState("recovery");
    dispatchPhone({ type: "advance_time", minutes: SCENE_INFO.roadside.minutes, batteryCost: 0 });
  };

  const advanceRescueConversation = () => {
    if (phase !== "carInterior" || interactions.rescueStep >= 6) return;
    const next = interactions.rescueStep + 1;
    const lines = [
      "开车的人把暖风调大了一点：‘先暖和起来。你想去哪，我们送你。’",
      "副驾上的人回过头，把一瓶水拧开递给我：‘慢慢喝。’",
      "他们说自己是异国恋，一个住在这边，一个住在海的那边，攒了很久才凑出这几天假。",
      "‘所以今晚，我们也算捡到一个人。’开车的人说。副驾上的人笑着打了他一下。",
      "我说手机可能丢在山上了。他们说：那明天一早，我们送你回谷口。",
      "我笑出了声。在暖风里，第一次觉得今天也许还是好的一天。",
    ];
    setInteractions((value) => ({ ...value, rescueStep: next }));
    setThought(lines[next - 1]);
    dispatchPhone({ type: "advance_time", minutes: next === 6 ? 16 : 4, batteryCost: 0 });
  };

  const advanceSearch = () => {
    if (phase !== "searchRoad" || interactions.searchStep >= SEARCH_POINTS.length) return;
    const next = interactions.searchStep + 1;
    setInteractions((value) => ({ ...value, searchStep: next }));
    setThought(next === 1 ? "树根旁没有。只有露水。" : next === 2 ? "白石头下面压着一颗昨晚掉下的外套扣子。手机不在。" : "拐弯处也没有。好吧。这一年的照片，就当留在山里了。我已经准备好失去一样东西。");
    setWalkFocus({ x: (SEARCH_POINTS[next - 1].x / 100 - 0.5) * 2, y: (SEARCH_POINTS[next - 1].y / 100 - 0.5) * 2 });
    dispatchPhone({ type: "advance_time", minutes: 9, batteryCost: 0 });
  };

  const acceptReturnedPhone = () => {
    if (phase !== "searchRoad" || interactions.searchStep < SEARCH_POINTS.length || interactions.phoneReturned) return;
    setInteractions((value) => ({ ...value, phoneLost: false, phoneReturned: true }));
    setThought("她一早在山上捡到它，送去了警局。锁屏是我的脸，界面是中文，警局的人想起昨晚山里那通电话。屏幕没碎，一张照片都没少。");
    dispatchPhone({ type: "receive_message", contactId: "mama", text: "定位又亮起来了。回来慢慢讲给我听。" });
  };

  const openPhone = (tab: PhoneTab = "home") => {
    if (interactions.phoneLost) {
      flash("口袋是空的。手机留在山里了。");
      return;
    }
    setCameraAim({ x: 50 + look.x * 34, y: 50 + look.y * 28 });
    setPhoneTab(tab);
    if (soundOn) soundRef.current?.uiTick(true);
    setPhoneOpen(true);
  };

  const closePhone = () => {
    if (soundOn) soundRef.current?.uiTick(false);
    setPhoneOpen(false);
  };

  const takePhoto = (snapshot?: string) => {
    if (soundOn) soundRef.current?.shutter();
    dispatchPhone({
      type: "capture_photo",
      photo: {
        asset: sceneAsset(scene),
        snapshot,
        title: SCENE_INFO[scene].photoTitle,
        place: SCENE_INFO[scene].place,
        position: cameraAim,
        zoom: cameraZoom,
      },
    });
    if (scene === "viewpoint") setStagePhotoTaken(true);
  };

  const requestPhoneReply = useCallback((contactId: ContactId, kind: "text" | "photo") => {
    dispatchPhone({ type: "set_typing", contactId, value: true });
    const timer = window.setTimeout(() => {
      dispatchPhone({ type: "set_typing", contactId, value: false });
      dispatchPhone({
        type: "receive_message",
        contactId,
        text: PHONE_REPLIES[contactId][kind][scene] ?? (kind === "photo" ? "看到了。原图留好，回来一起看。" : "收到。慢慢走。"),
      });
    }, kind === "photo" ? 1850 : 1350);
    replyTimersRef.current.push(timer);
  }, [scene]);

  const reset = () => {
    resetRuntime("title");
  };

  const renderScene = phase === "complete" ? "valleyExit" : scene;
  const progress = phase === "arrival" ? arrivalProgress : phase === "trail" ? trailProgress : phase === "complete" ? 1 : sceneProgress;

  const menu = menuOpen ? (
    <div className="menu-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <div className="menu-card" role="dialog" aria-label="设置">
        <p className="eyebrow">离开山谷以前</p>
        <h3>设置</h3>
        <label className="menu-row"><span>环境声与音效</span><input type="range" min={0} max={1} step={0.05} value={settings.master} onChange={(event) => updateSettings({ master: Number(event.target.value) })} /><output>{Math.round(settings.master * 100)}</output></label>
        <label className="menu-row"><span>音乐</span><input type="range" min={0} max={1} step={0.05} value={settings.music} onChange={(event) => updateSettings({ music: Number(event.target.value) })} /><output>{Math.round(settings.music * 100)}</output></label>
        <div className="menu-toggle"><span>镜头呼吸与浮动细节</span><button className={settings.motion ? "on" : ""} onClick={() => updateSettings({ motion: !settings.motion })}>{settings.motion ? "开" : "关"}</button></div>
        <div className="menu-actions">
          <button className="primary-button" onClick={() => setMenuOpen(false)}>继续</button>
          {phase !== "title" && <button className="secondary-button" onClick={() => { setMenuOpen(false); setPhoneOpen(false); setPhase("title"); }}>回到标题</button>}
        </div>
        <p className="menu-hint">ESC 打开或关闭</p>
      </div>
    </div>
  ) : null;

  if (phase === "title") return (
    <main className={`game-shell title-screen ${settings.motion ? "" : "reduce-motion"}`} onPointerMove={worldMove}>
      <PixiJourney scene="arrival" walking={false} progress={0} look={look} walkFocus={null} breath="calm" onReady={onCanvasReady} reduceMotion={!settings.motion} />
      <div className="title-art" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/title-key-art-v1.webp")`, "--tilt-x": `${(-look.x * 14).toFixed(1)}px`, "--tilt-y": `${(-look.y * 9).toFixed(1)}px` } as React.CSSProperties} />
      <div className="cinema-grade" />
      <div className={`title-card ${canvasReady ? "is-ready" : ""}`}>
        <p className="eyebrow">离开山谷以前</p>
        <h1>走到风景那里</h1>
        <p className="title-subtitle">教练说，两个小时就能登顶。<br />来都来了，就往上走一点点。</p>
        <div className="title-actions">
          <button className="primary-button" onClick={savedJourney ? continueJourney : begin}>{savedJourney ? "继续旅程" : "下车"}</button>
          {savedJourney && <button className="secondary-button" onClick={begin}>重新开始</button>}
          <button className="secondary-button" onClick={() => setMenuOpen(true)}>设置</button>
        </div>
        {savedJourney && <p className="save-hint">上次停在 {SCENE_INFO[savedJourney.scene].place} · {formatGameTime(savedJourney.phone.minuteOfDay)} · 手机 {savedJourney.phone.battery}%</p>}
        <p className="title-hint">移动鼠标观察 · 点击想去的地方 · P 打开手机 · 建议佩戴耳机</p>
        <p className="music-credit">Music: “Clear Air” “Simple Duet” “Promises to Keep” — Kevin MacLeod (incompetech.com) · CC BY 4.0</p>
      </div>
      {menu}
    </main>
  );

  if (phase === "complete") {
    const creditsDone = creditLine > CREDIT_LINES_TOTAL;
    return (
      <main className="game-shell complete-screen" onPointerDown={() => { if (!creditsDone) setCreditLine(CREDIT_LINES_TOTAL + 1); }}>
        <PixiJourney scene="valleyExit" walking={false} progress={1} look={look} walkFocus={null} breath="calm" reduceMotion={!settings.motion} />
        <div className="cinema-grade" />
        {!creditsDone ? (
          <div className="credits-poem" aria-live="polite">
            <div className="credits-block credits-it">
              {LETTER_LINES_IT.map((line, index) => <p key={`it-${index}`} className={index < creditLine ? "shown" : ""}>{line || " "}</p>)}
            </div>
            <div className="credits-block credits-zh">
              {LETTER_LINES_ZH.map((line, index) => <p key={`zh-${index}`} className={index + LETTER_LINES_IT.length < creditLine ? "shown" : ""}>{line || " "}</p>)}
            </div>
            <p className="credits-skip">点击跳过</p>
          </div>
        ) : (
          <div className="complete-card">
            <span className="completion-mark"><Check size={23} /></span>
            <p className="eyebrow">离开山谷以前</p>
            <h2>你是特别的。</h2>
            <p>手机回来了，一张照片都没少。有些话在山里读不懂，离开的时候，才知道它为什么在那里。</p>
            <p className="credits-source">灵感来自一段真实的经历 · 山顶那封信的作者不详</p>
            <p className="music-credit">Music: “Clear Air” “Simple Duet” “Promises to Keep” — Kevin MacLeod (incompetech.com) · CC BY 4.0</p>
            <button className="primary-button" onClick={reset}><RotateCcw size={16} /> 再走一次</button>
          </div>
        )}
      </main>
    );
  }

  const info = SCENE_INFO[scene];
  const stone = STONES[Math.min(streamStep, STONES.length - 1)];
  const displayTime = formatGameTime(phone.minuteOfDay);

  return (
    <main className={`game-shell scene-${scene} scene-light-${info.light} light-${lightMode} ${moving ? "is-moving" : ""} ${letterOpen ? "letter-open" : ""} ${settings.motion ? "" : "reduce-motion"} breath-${breathState}`}>
      <PixiJourney scene={renderScene} walking={moving} progress={progress} look={look} walkFocus={walkFocus} breath={breathState} anchorLayerRef={anchorLayerRef} reduceMotion={!settings.motion} />
      <div className="cinema-grade" />
      <div className="film-grain" />
      <div className="scene-blink" key={`blink-${phase}`} />
      {CHAPTER_CARDS[scene] && phase === scene && (
        <div className="chapter-card" key={`chapter-${phase}`} aria-hidden="true">
          <small>{CHAPTER_CARDS[scene]!.eyebrow}</small>
          <strong>{CHAPTER_CARDS[scene]!.title}</strong>
        </div>
      )}
      {info.light === "night" && <><div className="journey-night-ambient" /><div className="journey-darkness" style={{ "--beam-x": `${(look.x + 1) * 50}%`, "--beam-y": `${(look.y + 1) * 50}%` } as React.CSSProperties} /><div className="journey-light-volume" style={{ "--beam-x": `${(look.x + 1) * 50}%`, "--beam-y": `${(look.y + 1) * 50}%` } as React.CSSProperties} /></>}

      <div className="scene-caption"><span>{displayTime}</span>{info.place} · {info.elevation}</div>
      <div className="utility-controls">
        <button onClick={() => setSoundOn((value) => !value)} aria-label="切换声音">{soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        <button className={interactions.phoneLost ? "phone-missing" : ""} onClick={() => openPhone()} aria-label={interactions.phoneLost ? "手机已遗失" : "打开手机"}><Smartphone size={17} /><kbd>P</kbd></button>
        <button onClick={() => setMenuOpen(true)} aria-label="设置"><SettingsIcon size={17} /></button>
      </div>

      {NIGHT_LIGHT_SCENES.includes(phase as JourneyScene) && (phase !== "nightSlope" || interactions.callDone) && (
        <div className="light-controls" aria-label="选择照明方式">
          <button className={lightMode === "flashlight" ? "active" : ""} onClick={() => chooseLight("flashlight")}><Flashlight size={16} />补光灯</button>
          <button className={lightMode === "phone" ? "active" : ""} disabled={interactions.phoneLost || phone.battery <= 0} onClick={() => chooseLight("phone")}><Smartphone size={16} />手机光 · {phone.battery}%</button>
        </div>
      )}

      <div className="world-input" onPointerMove={worldMove} onPointerDown={worldClick}>
        <span className="gaze-dot" style={{ left: `${(look.x + 1) * 50}%`, top: `${(look.y + 1) * 50}%` }} />
        {moving && walkFocus && <span className="walk-focus" style={{ left: `${(walkFocus.x + 1) * 50}%`, top: `${(walkFocus.y + 1) * 50}%` }} />}
      </div>

      {phase === "arrival" && !bagTaken && (
        <img
          className={`backpack-object ${bagDragging ? "dragging" : ""}`}
          src={`${import.meta.env.BASE_URL}art/stage1-backpack.webp`}
          alt="候车亭座椅上的背包"
          draggable={false}
          style={{ left: `${bagPos.x}%`, top: `${bagPos.y}%` }}
          onPointerDown={bagDown}
          onPointerMove={bagMove}
          onPointerUp={bagUp}
          onPointerCancel={bagUp}
        />
      )}

      <div className="anchor-layer" ref={anchorLayerRef}>
        {phase === "trail" && route !== "open" && streamStep < STONES.length && (
          <button className="stone-target" style={{ left: `${stone.x}%`, top: `${stone.y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceStone(); }} aria-label="踩向下一块石头"><span /></button>
        )}

        {phase === "chainTraverse" && (
          <img className={`chain-prop chain-step-${interactions.chainStep}`} src={`${import.meta.env.BASE_URL}art/chain-overlay-v1.webp`} alt="固定在岩壁上的铁索" draggable={false} />
        )}
        {phase === "chainTraverse" && interactions.chainStep < CHAIN_POINTS.length && (
          <button className="terrain-target chain-target" style={{ left: `${CHAIN_POINTS[interactions.chainStep].x}%`, top: `${CHAIN_POINTS[interactions.chainStep].y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceChain(); }} aria-label="抓住下一段铁索"><span /></button>
        )}
        {phase === "chainUpper" && interactions.chainUpperStep < CHAIN_UPPER_POINTS.length && (
          <button className="terrain-target chain-target" style={{ left: `${CHAIN_UPPER_POINTS[interactions.chainUpperStep].x}%`, top: `${CHAIN_UPPER_POINTS[interactions.chainUpperStep].y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceChainUpper(); }} aria-label="抓住上一级铁梯"><span /></button>
        )}
        {phase === "school" && !interactions.routeDrawn && (
          <button className="map-prop" onPointerDown={(event) => { event.stopPropagation(); drawRoute(); }} aria-label="看桌上的地图" />
        )}
        {phase === "school" && interactions.routeDrawn && (
          <svg className="route-line" viewBox="0 0 1280 720" aria-hidden="true">
            <path d="M 330 652 C 410 612, 500 628, 570 592 S 660 540, 700 520 S 736 502, 748 494" />
            <circle cx="748" cy="494" r="5" />
          </svg>
        )}
        {phase === "summitRest" && !interactions.chocolateEaten && (
          <button className="chocolate-prop" onPointerDown={(event) => { event.stopPropagation(); eatChocolate(); }} aria-label="掰一块巧克力" />
        )}
        {phase === "marker656" && interactions.markerStep < MARKER_POINTS.length && (
          <button className={`terrain-target night-target ${lightMode === "off" ? "unlit" : ""}`} style={{ left: `${MARKER_POINTS[interactions.markerStep].x}%`, top: `${MARKER_POINTS[interactions.markerStep].y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceMarker(); }} aria-label={`照向${MARKER_POINTS[interactions.markerStep].label}`}><span /></button>
        )}
        {phase === "roadBank" && interactions.bankStep < BANK_POINTS.length && (
          <button className={`terrain-target night-target bank-target ${lightMode === "off" ? "unlit" : ""}`} style={{ left: `${BANK_POINTS[interactions.bankStep].x}%`, top: `${BANK_POINTS[interactions.bankStep].y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceBank(); }} aria-label="抓住下一处树根"><span /></button>
        )}
        {phase === "rubbleSlope" && interactions.rubbleStep < RUBBLE_POINTS.length && (
          <button className="terrain-target rubble-target" style={{ left: `${RUBBLE_POINTS[interactions.rubbleStep].x}%`, top: `${RUBBLE_POINTS[interactions.rubbleStep].y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceRubble(); }} aria-label="踩向下一块稳定石面"><span /></button>
        )}
        {phase === "letterBox" && !interactions.letterRead && !letterOpen && (
          <button className="letter-prop" onPointerDown={(event) => { event.stopPropagation(); readLetter(); }}><span>信箱里的一张纸</span></button>
        )}
        {((phase === "nightSlope" && interactions.callDone) || phase === "deepForest") && (() => {
          const points = phase === "nightSlope" ? NIGHT_SLOPE_POINTS : DEEP_FOREST_POINTS;
          const offset = phase === "nightSlope" ? 0 : NIGHT_SLOPE_POINTS.length;
          const localStep = interactions.nightStep - offset;
          const point = points[Math.max(0, Math.min(points.length - 1, localStep))];
          return localStep >= 0 && localStep < points.length ? <button className={`terrain-target night-target ${lightMode === "off" ? "unlit" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceNight(phase); }} aria-label="确认下一处落脚点"><span /></button> : null;
        })()}
        {phase === "roadside" && <><div className="car-headlights" /><img className="rescue-car-prop" src={`${import.meta.env.BASE_URL}art/rescue-car-cutout-v2.webp`} alt="停在谷底公路边的蓝色旧车" /></>}
        {phase === "sunsetFork" && deerState !== "hidden" && (
          <img className={`deer-prop deer-${deerState}`} src={`${import.meta.env.BASE_URL}art/deer-v1.webp`} alt="林线边的一只鹿" draggable={false} />
        )}
        {phase === "searchRoad" && interactions.searchStep >= SEARCH_POINTS.length && (
          <img className={`finder-prop ${interactions.phoneReturned ? "finder-leaving" : "finder-waiting"}`} src={`${import.meta.env.BASE_URL}art/finder-v1.webp`} alt="举着手机走来的人" draggable={false} onPointerDown={(event) => { event.stopPropagation(); acceptReturnedPhone(); }} />
        )}
        {phase === "searchRoad" && interactions.searchStep < SEARCH_POINTS.length && <button className="terrain-target search-target" style={{ left: `${SEARCH_POINTS[interactions.searchStep].x}%`, top: `${SEARCH_POINTS[interactions.searchStep].y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceSearch(); }} aria-label={`查看${SEARCH_POINTS[interactions.searchStep].label}`}><span /></button>}
      </div>

      {phase === "nightSlope" && !interactions.callDone && !callActive && <button className="story-action call-action" onPointerDown={(event) => { event.stopPropagation(); startCall(); }}>拨打求助电话</button>}
      {phase === "nightSlope" && callActive && !phoneOpen && <button className="story-action call-action" onPointerDown={(event) => { event.stopPropagation(); openPhone("call"); }}>回到通话</button>}
      {phase === "roadside" && <button className="story-action rescue-action" onPointerDown={(event) => { event.stopPropagation(); meetRescuers(); }}>朝车灯挥手</button>}
      {phase === "carInterior" && interactions.rescueStep < 6 && <button className="story-action conversation-action" onPointerDown={(event) => { event.stopPropagation(); advanceRescueConversation(); }}>{interactions.rescueStep === 0 ? "听他们说" : interactions.rescueStep === 1 ? "接过那瓶水" : "继续听"}</button>}
      {phase === "police" && interactions.policeStep < 3 && <button className="story-action conversation-action" onPointerDown={(event) => { event.stopPropagation(); advancePolice(); }}>{interactions.policeStep === 0 ? "推门进去" : interactions.policeStep === 1 ? "描述那部手机" : "谢过他，出门"}</button>}
      {phase === "searchRoad" && interactions.searchStep >= SEARCH_POINTS.length && !interactions.phoneReturned && <button className="story-action phone-return-action" onPointerDown={(event) => { event.stopPropagation(); acceptReturnedPhone(); }}>“是你吗？锁屏上的那个女孩。”</button>}

      {letterOpen && (
        <div className="letter-view" onPointerDown={(event) => { event.stopPropagation(); putLetterBack(); }} role="dialog" aria-label="信箱里的那张纸">
          <div className="letter-view-paper" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/letter-paper-v1.webp")` }}>
            {LETTER_LINES_IT.map((line, index) => <p key={index}>{line || " "}</p>)}
          </div>
          <p className="letter-view-hint">读不懂。点一下，把它拍下来放回去</p>
        </div>
      )}
      {thought && <div className="thought-line">{thought}</div>}
      {feedback && <div className="world-feedback">{feedback}</div>}

      <div className="action-whisper">
        {phase === "school" && !interactions.routeDrawn && "看看桌上的地图"}
        {phase === "school" && interactions.routeDrawn && !moving && "推开右边的门，出去"}
        {phase === "chainUpper" && "抓住发亮的上一级铁梯，一级一级往上"}
        {phase === "summitRest" && !interactions.chocolateEaten && "坐一会儿。脚边有巧克力"}
        {phase === "summitRest" && interactions.chocolateEaten && !moving && "想走的时候，点一下信箱那边"}
        {phase === "nightSlope" && !interactions.callDone && !callActive && "先拨一次求助电话"}
        {phase === "marker656" && lightMode === "off" && "打开补光灯或手机，一处一处地照"}
        {phase === "marker656" && lightMode !== "off" && interactions.markerStep < MARKER_POINTS.length && `照向：${MARKER_POINTS[interactions.markerStep].label}`}
        {phase === "roadBank" && lightMode === "off" && "打开光。上面就是公路"}
        {phase === "roadBank" && lightMode !== "off" && "抓住发亮的树根，往上"}
        {phase === "police" && "门口的灯还亮着"}
        {phase === "arrival" && !bagTaken && "抓住背包，拖向画面下方"}
        {phase === "arrival" && bagTaken && !moving && arrivalProgress < 1 && "看向山路，点击想走到的位置"}
        {phase === "arrival" && moving && "正在走近 · 镜头会朝向目的地"}
        {phase === "trail" && route === null && "看向并点击左侧山路，或直接踩右侧石头"}
        {phase === "trail" && route === "open" && moving && "脚步会把你带到路的那一头"}
        {phase === "trail" && route === "stream" && streamStep < STONES.length && "看准发亮的石面，逐块踩过去"}
        {phase === "forestEntry" && !moving && "沿着林中透光的旧路继续走"}
        {phase === "chainTraverse" && "抓住发亮的下一段铁索，逐步横移"}
        {phase === "rubbleSlope" && "选择稳定的石面，一步一步向上"}
        {phase === "viewpoint" && !stagePhotoTaken && "按 P 拿出手机，把这里拍下来 · 想继续走，点一下画面"}
        {phase === "viewpoint" && stagePhotoTaken && "收起手机。记住这阵风 · 想走的时候，点一下画面"}
        {phase === "letterBox" && !interactions.letterRead && "看看信箱里留下的那张纸"}
        {phase === "letterBox" && interactions.letterRead && "已经拍下来了。想走的时候，点一下下山的路"}
        {phase === "sunsetFork" && !moving && "趁最后的光，沿来路下山"}
        {((phase === "nightSlope" && interactions.callDone) || phase === "deepForest") && lightMode === "off" && "打开补光灯或手机，再找下一块地面"}
        {((phase === "nightSlope" && interactions.callDone) || phase === "deepForest") && lightMode !== "off" && "让光跟着视线走，踩向发亮的地面"}
        {phase === "roadside" && !interactions.rescuersMet && "有车停在远处。朝它挥手"}
        {phase === "carInterior" && "暖风很轻。听他们说话"}
        {phase === "searchRoad" && interactions.searchStep < SEARCH_POINTS.length && `寻找记忆里的路标：${SEARCH_POINTS[interactions.searchStep].label}`}
        {phase === "searchRoad" && interactions.searchStep >= SEARCH_POINTS.length && !interactions.phoneReturned && "谷口有人朝这边走来，手里举着一部手机"}
        {phase === "valleyExit" && !moving && sceneProgress < 1 && "离开以前，再回头看一眼来路"}
        {phase === "valleyExit" && sceneProgress >= 1 && !interactions.endingGallerySeen && "上车以前，打开相册，再看一眼那张纸"}
        {phase === "valleyExit" && interactions.endingGallerySeen && "收起手机。该走了。"}
      </div>

      {phoneOpen && (
        <Phone
          tab={phoneTab}
          setTab={setPhoneTab}
          close={closePhone}
          phone={phone}
          dispatch={dispatchPhone}
          scene={scene}
          place={info.place}
          progress={progress}
          cameraAim={cameraAim}
          setCameraAim={setCameraAim}
          cameraZoom={cameraZoom}
          setCameraZoom={setCameraZoom}
          lightMode={lightMode}
          takePhoto={takePhoto}
          requestReply={requestPhoneReply}
          onGalleryViewed={markEndingGalleryViewed}
          letterTranslated={interactions.phoneReturned}
          call={callActive ? { lines: CALL_LINES, step: callStep, done: callStep >= CALL_LINES.length - 1, hangUp } : undefined}
        />
      )}
      {menu}
    </main>
  );
}
