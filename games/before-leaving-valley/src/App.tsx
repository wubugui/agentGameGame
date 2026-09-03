import { Check, Flashlight, RotateCcw, Smartphone, Volume2, VolumeX } from "lucide-react";
import { lazy, useCallback, useEffect, useReducer, useRef, useState } from "react";
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

type LightMode = "off" | "phone" | "flashlight";
type DeerState = "hidden" | "standing" | "leaving";

// Where the deer stands on the sunset board, as a look-space x (-1..1); used to
// notice when she is looking straight at it.
const DEER_LOOK_X = (0.24 - 0.5) * 2;
const CREDIT_LINES_TOTAL = LETTER_LINES_IT.length + LETTER_LINES_ZH.length;

// Quiet chapter cards at the turns of the day.
const CHAPTER_CARDS: Partial<Record<JourneyScene, { eyebrow: string; title: string }>> = {
  arrival: { eyebrow: "多洛米蒂 · 八月", title: "来都来了" },
  sunsetFork: { eyebrow: "日落", title: "光已经走到山后面" },
  nightSlope: { eyebrow: "夜", title: "一小块一小块地走" },
  roadside: { eyebrow: "谷底公路", title: "远处终于有了灯" },
  searchRoad: { eyebrow: "第二天 · 清晨", title: "回头路" },
};

type SoundscapeNodes = {
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  engineGain: GainNode;
};

const requestedDevScene = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("scene") : null;
const DEV_SCENE: JourneyScene | null = isJourneyScene(requestedDevScene) ? requestedDevScene : null;

function createDevInteractions(scene: JourneyScene | null): JourneyInteractionState {
  const state = { ...INITIAL_INTERACTIONS };
  if (!scene) return state;
  if (["deepForest", "roadside", "carInterior", "searchRoad"].includes(scene)) state.nightStep = NIGHT_SLOPE_POINTS.length;
  if (["roadside", "carInterior", "searchRoad"].includes(scene)) state.nightStep += DEEP_FOREST_POINTS.length;
  if (["roadside", "carInterior", "searchRoad"].includes(scene)) state.phoneLost = true;
  if (scene === "carInterior" || scene === "searchRoad") state.rescuersMet = true;
  if (journeySceneIndex(scene) > journeySceneIndex("letterBox")) state.letterRead = true;
  if (scene === "valleyExit") state.phoneReturned = true;
  return state;
}

function createJourneyPhoneState(): PhoneState {
  const state = createInitialPhoneState();
  if (!DEV_SCENE) return state;
  const previewTimes: Partial<Record<JourneyScene, number>> = {
    sunsetFork: 19 * 60 + 40,
    nightSlope: 20 * 60 + 50,
    deepForest: 21 * 60 + 30,
    roadside: 22 * 60 + 10,
    carInterior: 22 * 60 + 30,
    searchRoad: 6 * 60 + 35,
    valleyExit: 7 * 60 + 40,
  };
  state.minuteOfDay = previewTimes[DEV_SCENE] ?? state.minuteOfDay;
  if (DEV_SCENE === "searchRoad" || DEV_SCENE === "valleyExit") state.date = { ...NEXT_MORNING_DATE };
  // Past the summit she has already photographed the letter; seed it so the
  // ending can be previewed from any later scene.
  if (journeySceneIndex(DEV_SCENE) > journeySceneIndex("letterBox")) {
    state.photos = [{
      id: "dev-letter",
      kind: "letter",
      asset: JOURNEY_SCENE_INFO.letterBox.asset,
      title: JOURNEY_SCENE_INFO.letterBox.photoTitle,
      place: JOURNEY_SCENE_INFO.letterBox.place,
      dateLabel: DEV_SCENE === "searchRoad" || DEV_SCENE === "valleyExit" ? "昨天" : "今天",
      minute: 17 * 60 + 5,
      position: { x: 68, y: 66 },
      zoom: 1.6,
      isNew: true,
    }, ...state.photos];
  }
  return state;
}

const PHONE_BEATS: Partial<Record<Phase, { id: string; contactId: ContactId; text: string }>> = {
  trail: { id: "trail-xiaoyu", contactId: "xiaoyu", text: "刚看了你的定位，那边的天好蓝。替我多看两眼。" },
  viewpoint: { id: "viewpoint-mama", contactId: "mama", text: "小树收到了。今天的山好看吗？" },
  sunsetFork: { id: "sunset-asha", contactId: "asha", text: "我在收拾最后一箱书。你那边现在是什么颜色的天？" },
  nightSlope: { id: "night-xiaoyu", contactId: "xiaoyu", text: "睡前看到你的定位还在山上。拍到星星了吗？" },
};

const PHONE_REPLIES: Record<ContactId, Record<"text" | "photo", Partial<Record<JourneyScene, string>>>> = {  xiaoyu: {
    text: {
      arrival: "行，我等照片。",
      trail: "你每次说‘就走一点’，最后都要多走半座山。哈哈。",
      viewpoint: "你还在上面？替我看一眼那边的云。",
    },
    photo: {
      arrival: "空得有点电影开场的感觉。",
      trail: "这个光好看。构图也很你——路总要留一大半。",
      viewpoint: "好看！原图存好，回来洗出来贴墙上。",
    },
  },
  mama: {
    text: {
      arrival: "看到了。慢慢走。",
      trail: "不用赶，看够了再往前。",
      viewpoint: "风大的地方站一会儿就好。回来讲给我听。",
    },
    photo: {
      arrival: "天气真好。你小时候也总爱在半路忽然下车看东西。",
      trail: "树很漂亮。",
      viewpoint: "收到了，很开阔。你爸问是哪座山。",
    },
  },
  asha: {
    text: {
      arrival: "临时拐进去的地方通常最好画，帮我多看两眼颜色。",
      trail: "别找标准路线，哪边让你想走就走哪边。",
      viewpoint: "先别给风景起名字，回来再告诉我它像什么。",
    },
    photo: {
      arrival: "这个灰蓝和珊瑚色可以！原图留着，我晚上想画。",
      trail: "你把路放在画面边上这点很妙，像它还会继续出去。",
      viewpoint: "光落得太好了。别滤镜，原图就这样发我。",
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
const DAY_MUSIC_SCENES: readonly JourneyScene[] = ["arrival", "forestEntry", "trail", "chainTraverse", "rubbleSlope", "viewpoint"];

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
  const [lightMode, setLightMode] = useState<LightMode>(DEV_SCENE === "deepForest" ? "flashlight" : "off");
  const [thought, setThought] = useState("");
  const [feedback, setFeedback] = useState("");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("home");
  const [cameraAim, setCameraAim] = useState({ x: 50, y: 50 });
  const [cameraZoom, setCameraZoom] = useState(1);
  const [stagePhotoTaken, setStagePhotoTaken] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [savedJourney, setSavedJourney] = useState<JourneySave | null>(() => loadJourneySave());
  const [deerState, setDeerState] = useState<DeerState>("hidden");
  const [letterOpen, setLetterOpen] = useState(false);
  const [creditLine, setCreditLine] = useState(0);
  const [phone, dispatchPhone] = useReducer(phoneReducer, undefined, createJourneyPhoneState);
  const audioRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<SoundscapeNodes | null>(null);
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
    if (audioRef.current) return;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      last = last * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[index] = last;
    }
    const wind = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    wind.buffer = buffer;
    wind.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 720;
    gain.gain.value = 0.035;
    wind.connect(filter).connect(gain).connect(ctx.destination);
    wind.start();
    const engine = ctx.createOscillator();
    const engineFilter = ctx.createBiquadFilter();
    const engineGain = ctx.createGain();
    engine.type = "sawtooth";
    engine.frequency.value = 47;
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 92;
    engineGain.gain.value = 0;
    engine.connect(engineFilter).connect(engineGain).connect(ctx.destination);
    engine.start();
    audioRef.current = ctx;
    audioNodesRef.current = { windGain: gain, windFilter: filter, engineGain };
    setAudioReady(true);
  }, []);

  const stepSound = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx || !soundOn) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const rocky = scene === "chainTraverse" || scene === "rubbleSlope" || scene === "nightSlope";
    const soft = scene === "forestEntry" || scene === "trail" || scene === "deepForest" || scene === "searchRoad";
    const baseFrequency = rocky ? 92 : soft ? 68 : 78;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(baseFrequency + Math.random() * 24, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(rocky ? 48 : 38, ctx.currentTime + 0.13);
    gain.gain.setValueAtTime(rocky ? 0.038 : soft ? 0.022 : 0.03, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }, [scene, soundOn]);

  const beginRecovery = useCallback((duration = 5200) => {
    window.clearTimeout(recoveryTimerRef.current);
    setBreathState("recovery");
    recoveryTimerRef.current = window.setTimeout(() => setBreathState("calm"), duration);
  }, []);

  useEffect(() => {
    if (!soundOn) {
      const ctx = audioRef.current;
      if (ctx && ctx.state === "running") void ctx.suspend();
      return;
    }
    startAudio();
    const ctx = audioRef.current;
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }, [soundOn, startAudio]);

  useEffect(() => {
    const ctx = audioRef.current;
    const nodes = audioNodesRef.current;
    if (!audioReady || !ctx || !nodes) return;
    const activeScene: JourneyScene = phase === "title" ? "arrival" : phase === "complete" ? "valleyExit" : phase;
    const openWindScenes: JourneyScene[] = ["chainTraverse", "rubbleSlope", "viewpoint", "letterBox", "sunsetFork", "nightSlope"];
    const forestScenes: JourneyScene[] = ["forestEntry", "trail", "deepForest", "searchRoad"];
    const windTarget = activeScene === "carInterior" ? 0.006 : activeScene === "roadside" ? 0.024 : openWindScenes.includes(activeScene) ? 0.072 : forestScenes.includes(activeScene) ? 0.027 : 0.038;
    const filterTarget = activeScene === "carInterior" ? 360 : activeScene === "nightSlope" || activeScene === "deepForest" ? 540 : openWindScenes.includes(activeScene) ? 1450 : 920;
    const engineTarget = activeScene === "carInterior" ? 0.034 : activeScene === "roadside" ? 0.02 : 0;
    const now = ctx.currentTime;
    nodes.windGain.gain.cancelScheduledValues(now);
    nodes.windFilter.frequency.cancelScheduledValues(now);
    nodes.engineGain.gain.cancelScheduledValues(now);
    nodes.windGain.gain.linearRampToValueAtTime(windTarget, now + 1.2);
    nodes.windFilter.frequency.linearRampToValueAtTime(filterTarget, now + 1.2);
    nodes.engineGain.gain.linearRampToValueAtTime(engineTarget, now + 1.5);
  }, [audioReady, phase]);

  useEffect(() => {
    window.clearInterval(breathAudioTimerRef.current);
    const ctx = audioRef.current;
    if (!audioReady || !ctx || !soundOn || phase === "title" || phase === "complete") return;
    const profile = breathState === "walking"
      ? { interval: 1720, duration: .72, gain: .015, cutoff: 1050 }
      : breathState === "recovery"
        ? { interval: 2500, duration: 1.05, gain: .021, cutoff: 920 }
        : { interval: 5000, duration: 1.18, gain: .0065, cutoff: 760 };
    const playBreath = () => {
      if (ctx.state !== "running") return;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const sampleCount = Math.ceil(ctx.sampleRate * profile.duration);
      const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let shaped = 0;
      for (let index = 0; index < data.length; index += 1) {
        shaped = shaped * .86 + (Math.random() * 2 - 1) * .14;
        data[index] = shaped;
      }
      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.value = profile.cutoff;
      filter.Q.value = .55;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(profile.gain, now + profile.duration * .4);
      gain.gain.exponentialRampToValueAtTime(.0001, now + profile.duration);
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start(now);
      source.stop(now + profile.duration + .04);
    };
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
    if (soundOn) {
      if (phase === "carInterior") targets.warm = MUSIC_TRACKS.warm.volume;
      else if (phase === "complete" || (phase === "valleyExit" && interactions.endingGallerySeen)) targets.end = MUSIC_TRACKS.end.volume;
      else if (phase !== "title" && DAY_MUSIC_SCENES.includes(phase)) targets.day = MUSIC_TRACKS.day.volume;
    }
    musicTargetsRef.current = targets;
  }, [interactions.endingGallerySeen, phase, soundOn]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "p" && phase !== "title" && phase !== "complete") {
        if (interactions.phoneLost) {
          flash("外套口袋是空的。手机不在身上。");
          return;
        }
        setPhoneOpen((value) => !value);
        setPhoneTab("home");
      }
      if (event.key === "Escape") setPhoneOpen(false);
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
    if (phase === "roadside" || phase === "carInterior" || phase === "searchRoad" || phase === "valleyExit") {
      setLightMode("off");
      setBreathState("calm");
    }
    if (phase === "searchRoad" && phone.date.day !== NEXT_MORNING_DATE.day) {
      dispatchPhone({ type: "set_clock", date: { ...NEXT_MORNING_DATE }, minuteOfDay: 6 * 60 + 35 });
    }
  }, [phase]);

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
      (phase === "rubbleSlope" && interactions.rubbleStep >= RUBBLE_POINTS.length) ||
      (phase === "nightSlope" && interactions.nightStep >= NIGHT_SLOPE_POINTS.length) ||
      (phase === "deepForest" && interactions.nightStep >= NIGHT_SLOPE_POINTS.length + DEEP_FOREST_POINTS.length) ||
      (phase === "roadside" && interactions.rescuersMet) ||
      (phase === "carInterior" && interactions.rescueStep >= 3) ||
      (phase === "searchRoad" && interactions.phoneReturned) ||
      (phase === "valleyExit" && sceneProgress >= 1 && interactions.endingGallerySeen && !phoneOpen) ||
      (!["arrival", "trail", "chainTraverse", "rubbleSlope", "nightSlope", "deepForest", "roadside", "carInterior", "searchRoad", "valleyExit"].includes(phase) && sceneProgress >= 1);
    if (!sceneFinished) return;
    transitionRef.current = true;
    const transitionDelay = phase === "viewpoint" ? 2600 : phase === "deepForest" ? 3600 : phase === "roadside" ? 3800 : phase === "carInterior" ? 4200 : phase === "searchRoad" ? 3600 : 720;
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
    const ctx = audioRef.current;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }, []);

  const resetRuntime = (nextPhase: "title" | "arrival") => {
    cancelAnimationFrame(walkFrameRef.current);
    window.clearTimeout(recoveryTimerRef.current);
    replyTimersRef.current.forEach(window.clearTimeout);
    replyTimersRef.current = [];
    clearJourneySave();
    setSavedJourney(null);
    setPhase(nextPhase);
    setScene("arrival");
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
      const ctx = audioRef.current;
      if (ctx && ctx.state === "suspended") void ctx.resume();
    }
    resetRuntime("arrival");
  };

  const continueJourney = () => {
    if (!savedJourney) return;
    if (soundOn) {
      startAudio();
      const ctx = audioRef.current;
      if (ctx && ctx.state === "suspended") void ctx.resume();
    }
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
    setLightMode(savedJourney.interactions.phoneLost ? "off" : savedJourney.phase === "nightSlope" || savedJourney.phase === "deepForest" ? "flashlight" : "off");
    setPhoneOpen(false);
    setPhoneTab("home");
    setCameraAim(savedJourney.cameraAim);
    setCameraZoom(savedJourney.cameraZoom);
    setStagePhotoTaken(savedJourney.stagePhotoTaken);
    narrativeMessagesRef.current.clear();
    const restoredSceneIndex = journeySceneIndex(savedJourney.phase);
    if (restoredSceneIndex >= journeySceneIndex("trail")) narrativeMessagesRef.current.add("trail-xiaoyu");
    if (restoredSceneIndex >= journeySceneIndex("viewpoint")) narrativeMessagesRef.current.add("viewpoint-mama");
    if (restoredSceneIndex >= journeySceneIndex("sunsetFork")) narrativeMessagesRef.current.add("sunset-asha");
    if (restoredSceneIndex >= journeySceneIndex("nightSlope")) narrativeMessagesRef.current.add("night-xiaoyu");
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
    if (phase === "sunsetFork" || phase === "valleyExit" || phase === "viewpoint" || (phase === "letterBox" && interactions.letterRead)) {
      startAutomaticWalk(focus);
    }
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
    if (phase !== "carInterior" || interactions.rescueStep >= 3) return;
    const next = interactions.rescueStep + 1;
    const lines = [
      "开车的人把暖风调大了一点：‘先暖和起来。你想去哪，我们送你。’",
      "他们说自己是异国恋，一个住在这边，一个住在海的那边，攒了很久才凑出这几天假。‘所以今晚，我们也算捡到一个人。’",
      "我笑出了声。在暖风里，第一次觉得今天也许还是好的一天。",
    ];
    setInteractions((value) => ({ ...value, rescueStep: next }));
    setThought(lines[next - 1]);
    dispatchPhone({ type: "advance_time", minutes: next === 3 ? 20 : 5, batteryCost: 0 });
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
    setPhoneOpen(true);
  };

  const takePhoto = (snapshot?: string) => {
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

  if (phase === "title") return (
    <main className="game-shell title-screen" onPointerMove={worldMove}>
      <PixiJourney scene="arrival" walking={false} progress={0} look={look} walkFocus={null} breath="calm" onReady={onCanvasReady} />
      <div className="title-art" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}art/title-key-art-v1.webp")`, "--tilt-x": `${(-look.x * 14).toFixed(1)}px`, "--tilt-y": `${(-look.y * 9).toFixed(1)}px` } as React.CSSProperties} />
      <div className="cinema-grade" />
      <div className={`title-card ${canvasReady ? "is-ready" : ""}`}>
        <p className="eyebrow">离开山谷以前</p>
        <h1>走到风景那里</h1>
        <p className="title-subtitle">教练说，两个小时就能登顶。<br />来都来了，就往上走一点点。</p>
        <div className="title-actions">
          <button className="primary-button" onClick={savedJourney ? continueJourney : begin}>{savedJourney ? "继续旅程" : "下车"}</button>
          {savedJourney && <button className="secondary-button" onClick={begin}>重新开始</button>}
        </div>
        {savedJourney && <p className="save-hint">上次停在 {SCENE_INFO[savedJourney.scene].place} · {formatGameTime(savedJourney.phone.minuteOfDay)} · 手机 {savedJourney.phone.battery}%</p>}
        <p className="title-hint">移动鼠标观察 · 点击想去的地方 · P 打开手机 · 建议佩戴耳机</p>
        <p className="music-credit">Music: “Clear Air” “Simple Duet” “Promises to Keep” — Kevin MacLeod (incompetech.com) · CC BY 4.0</p>
      </div>
    </main>
  );

  if (phase === "complete") {
    const creditsDone = creditLine > CREDIT_LINES_TOTAL;
    return (
      <main className="game-shell complete-screen" onPointerDown={() => { if (!creditsDone) setCreditLine(CREDIT_LINES_TOTAL + 1); }}>
        <PixiJourney scene="valleyExit" walking={false} progress={1} look={look} walkFocus={null} breath="calm" />
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
    <main className={`game-shell scene-${scene} scene-light-${info.light} light-${lightMode} ${moving ? "is-moving" : ""} ${letterOpen ? "letter-open" : ""} breath-${breathState}`}>
      <PixiJourney scene={renderScene} walking={moving} progress={progress} look={look} walkFocus={walkFocus} breath={breathState} anchorLayerRef={anchorLayerRef} />
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
      </div>

      {(phase === "nightSlope" || phase === "deepForest") && (
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
        {phase === "rubbleSlope" && interactions.rubbleStep < RUBBLE_POINTS.length && (
          <button className="terrain-target rubble-target" style={{ left: `${RUBBLE_POINTS[interactions.rubbleStep].x}%`, top: `${RUBBLE_POINTS[interactions.rubbleStep].y}%` }} onPointerDown={(event) => { event.stopPropagation(); advanceRubble(); }} aria-label="踩向下一块稳定石面"><span /></button>
        )}
        {phase === "letterBox" && !interactions.letterRead && !letterOpen && (
          <button className="letter-prop" onPointerDown={(event) => { event.stopPropagation(); readLetter(); }}><span>信箱里的一张纸</span></button>
        )}
        {(phase === "nightSlope" || phase === "deepForest") && (() => {
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

      {phase === "roadside" && <button className="story-action rescue-action" onPointerDown={(event) => { event.stopPropagation(); meetRescuers(); }}>朝车灯挥手</button>}
      {phase === "carInterior" && interactions.rescueStep < 3 && <button className="story-action conversation-action" onPointerDown={(event) => { event.stopPropagation(); advanceRescueConversation(); }}>{interactions.rescueStep === 0 ? "接过那瓶水，听他们说" : "继续听"}</button>}
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
        {(phase === "nightSlope" || phase === "deepForest") && lightMode === "off" && "打开补光灯或手机，再找下一块地面"}
        {(phase === "nightSlope" || phase === "deepForest") && lightMode !== "off" && "让光跟着视线走，踩向发亮的地面"}
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
          close={() => setPhoneOpen(false)}
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
        />
      )}
    </main>
  );
}
