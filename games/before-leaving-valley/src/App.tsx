import { RotateCcw, Settings as SettingsIcon, Smartphone, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import PanoStage, { type BodyMode, type BreathState, type ImpulseKind, type LookPoint, type StageHandle } from "./PanoStage";
import Phone, { type PhoneTab } from "./Phone";
import { createInitialPhoneState, formatGameTime, NEXT_MORNING_DATE, nodeAsset, phoneReducer, THIRD_DAY_DATE, type ContactId } from "./phoneModel";
import { loadSettings, saveSettings, type GameSettings } from "./settings";
import { SILENCE, Soundscape, type Ambience, type SoundMaterial } from "./soundscape";
import { clearJourneySave, INITIAL_FLAGS, loadJourneySave, persistJourneySave, type Flags, type JourneySave } from "./saveModel";
import {
  BUS_STOP_LINES, CABLE_ANCHORS, CALL_LINES, CAR_LINES, CHOCOLATE_ANCHOR, CLOSING_LINES, CRACK_HOLDS, DAYLIGHT_LEFT, DEER_ANCHOR,
  FOREST_STEPS, HOTEL_CALLS, HOURS_ALREADY, HUT_ANCHOR, HUT_HOURS, isNodeId, LETTER_LINES_IT, LETTER_LINES_ZH, MAILBOX_ANCHOR, MAP_LEGS, NODE_IDS, NODES,
  nodeIndex, PLATEAU_MAP_ANCHOR, POLICE_COUNTER_ANCHOR, POLICE_LINES, SCREE_STEPS, SEARCH_SPOTS, SIGNPOST_ARMS, SUMMIT_CAMERA_ANCHOR, SUMMIT_CROSS_ANCHOR, type Anchor, type NodeId,
} from "./story";

type Phase = "title" | "play" | "complete";
type Overlay = "none" | "map" | "notebook" | "call" | "findmy" | "hotel" | "selfie";
type CarState = "none" | "first" | "second" | "stopped";
type DeerState = "standing" | "fleeing" | "gone";

/* ---------- per-node sound ---------- */
const AMBIENCE: Record<NodeId, Ambience> = {
  meadow: { ...SILENCE, wind: 0.45, windTone: 950, birds: 0.6 },
  approach: { ...SILENCE, wind: 0.6, windTone: 1100, birds: 0.35 },
  plaque: { ...SILENCE, wind: 0.7, windTone: 1300, birds: 0.2 },
  cable: { ...SILENCE, wind: 0.95, windTone: 1450, birds: 0.1 },
  crack: { ...SILENCE, wind: 0.9, windTone: 1500, birds: 0.05 },
  mailbox: { ...SILENCE, wind: 0.8, windTone: 1400, birds: 0.15 },
  exit: { ...SILENCE, wind: 0.85, windTone: 1450, birds: 0.08 },
  summit: { ...SILENCE, wind: 1, windTone: 1500, birds: 0.05 },
  plateau: { ...SILENCE, wind: 0.75, windTone: 1400 },
  hutView: { ...SILENCE, wind: 0.7, windTone: 1350 },
  signpost: { ...SILENCE, wind: 0.6, windTone: 1200, crickets: 0.1 },
  scree: { ...SILENCE, wind: 0.65, windTone: 1100, crickets: 0.2 },
  deer: { ...SILENCE, wind: 0.4, windTone: 900, crickets: 0.45 },
  forestEdge: { ...SILENCE, wind: 0.35, windTone: 700, crickets: 0.7 },
  forest1: { ...SILENCE, wind: 0.3, windTone: 560, crickets: 0.6 },
  forest2: { ...SILENCE, wind: 0.3, windTone: 540, crickets: 0.6, stream: 0.15 },
  hairpin: { ...SILENCE, wind: 0.3, windTone: 600, crickets: 0.5 },
  car: { ...SILENCE, engine: 0.6, heater: 0.7 },
  search: { ...SILENCE, wind: 0.3, windTone: 900, birds: 0.8, stream: 0.2 },
  hotel: { ...SILENCE, wind: 0.05, windTone: 500, heater: 0.16 },
  busStop: { ...SILENCE, wind: 0.35, windTone: 950, birds: 0.55 },
  police: { ...SILENCE, wind: 0.05, windTone: 500, heater: 0.2 },
  bench: { ...SILENCE, wind: 0.4, windTone: 950, birds: 0.5 },
};

const MATERIAL: Record<NodeId, SoundMaterial> = {
  meadow: "soft", approach: "gravel", plaque: "rock", cable: "rock", crack: "rock", mailbox: "rock", exit: "rock", summit: "rock",
  plateau: "gravel", hutView: "gravel", signpost: "gravel", scree: "gravel", deer: "soft", forestEdge: "soft", forest1: "soft", forest2: "soft",
  hairpin: "road", car: "road", search: "soft", hotel: "road", busStop: "road", police: "road", bench: "road",
};

const NIGHT_NODES: readonly NodeId[] = ["forestEdge", "forest1", "forest2", "hairpin"];
/* Leaving these nodes she is running: the emergency descent. */
const RUN_FROM: readonly NodeId[] = ["signpost", "scree", "deer"];
/* What drifts in the air of a node: pollen in warm light, stone dust on the plateau, fireflies at dusk. */
const MOTES: Partial<Record<NodeId, "pollen" | "dust" | "night" | "grit">> = { meadow: "pollen", approach: "pollen", deer: "pollen", search: "pollen", bench: "pollen", busStop: "pollen", summit: "grit", exit: "grit", plateau: "dust", hutView: "dust", scree: "dust", forestEdge: "night" };
const MOTE_SPOTS = Array.from({ length: 14 }, (_, index) => ({ x: (index * 37 + 11) % 100, y: 20 + (index * 53 + 7) % 70, dur: 11 + (index * 7) % 9, delay: -(index * 1.7) }));
/* Nodes where the wind comes in gusts strong enough to push the body. */
const GUSTY: readonly NodeId[] = ["cable", "crack", "mailbox", "exit", "summit", "plateau", "hutView", "signpost"];
/* Where the wind comes from in each place (-1 left .. 1 right); the wall channels it. */
const WIND_PAN: Partial<Record<NodeId, number>> = { cable: 0.45, crack: 0.35, mailbox: -0.3, exit: 0.2, summit: -0.15, plateau: 0.1, hutView: 0.25, signpost: -0.2, scree: 0.15 };
/* Places she stops to look: when the pointer rests, the gaze wanders on its own. */
const IDLE_NODES: readonly NodeId[] = ["meadow", "mailbox", "summit", "plateau", "hutView", "deer", "search", "busStop", "bench"];
/* Cloud shadows cross the open ground of the high nodes. */
const CLOUDY: readonly NodeId[] = ["plateau", "hutView", "summit", "scree", "signpost", "exit"];
/* How hard each ground hits back through the feet. */
const STEP_KICK: Record<SoundMaterial, number> = { rock: 1.15, gravel: 0.95, soft: 0.6, road: 1 };
const WALK_CADENCE = 560;
const RUN_CADENCE = 300;
const DAY_MUSIC_NODES: readonly NodeId[] = ["meadow", "approach", "plaque", "cable", "crack", "mailbox", "exit", "summit", "plateau"];

type MusicKind = "day" | "warm" | "end";
const MUSIC_TRACKS: Record<MusicKind, { src: string; volume: number; fadeStep: number }> = {
  day: { src: "audio/clear-air.mp3", volume: 0.14, fadeStep: 0.02 },
  warm: { src: "audio/simple-duet.mp3", volume: 0.2, fadeStep: 0.02 },
  end: { src: "audio/promises-to-keep.mp3", volume: 0.2, fadeStep: 0.006 },
};

/* Messages that arrive on the phone while it is still in her pocket. */
const PHONE_BEATS: Partial<Record<NodeId, Array<{ contactId: ContactId; text: string }>>> = {
  approach: [{ contactId: "xiaoyu", text: "到山口了吗？教练说的那条 easy 路线，走慢点。" }],
  summit: [{ contactId: "mama", text: "今天天气怎么样？记得吃东西。" }],
  plateau: [{ contactId: "asha", text: "拍到什么了？我等着画。" }],
};

/* Messages that were waiting on the phone the whole time it was in the forest. They arrive when it comes back. */
const RETURNED_MESSAGES: Array<{ contactId: ContactId; text: string; delay: number }> = [
  { contactId: "xiaoyu", text: "昨晚看到你定位停在山里就再没动过。你人还好吗？", delay: 6000 },
  { contactId: "xiaoyu", text: "看到回我一下。", delay: 8500 },
  { contactId: "mama", text: "今天离开山里吗？到了说一声。", delay: 11000 },
  { contactId: "mama", text: "在伦敦待了一年手机都没被偷，看来是得丢一个以示尊重。", delay: 14000 },
  { contactId: "asha", text: "回来一起画。", delay: 17000 },
];

const PHONE_REPLIES: Record<ContactId, { text: string; photo: string }> = {
  xiaoyu: { text: "收到。慢慢走，别赶。", photo: "这也太好看了。原图留好。" },
  mama: { text: "好。到了发个消息。", photo: "真漂亮。你爸问是哪座山。" },
  asha: { text: "等你回来一起画。", photo: "这一张，什么都不用改了。" },
};

/* Places on the second-day slope that hold nothing. Looking there is still looking. */
const EMPTY_SPOTS: Array<Anchor & { label: string; line: string }> = [
  { yaw: -34, pitch: -14, label: "路边的水沟", line: "水沟里只有松针和别人的一个瓶盖。" },
  { yaw: 34, pitch: 4, label: "倒木后面", line: "倒木后面是一窝露水。" },
];

const ZH_LINE_COUNT = LETTER_LINES_ZH.filter((line) => line.length > 0).length;
const CLIMB_HOLD_MS = 1100;
const CREDIT_POEM_LINES = Math.max(LETTER_LINES_IT.length, LETTER_LINES_ZH.length);
const CREDIT_TOTAL = CREDIT_POEM_LINES + CLOSING_LINES.length + 1;

function isReady(node: NodeId, flags: Flags): boolean {
  switch (node) {
    case "plaque": return flags.helmet && flags.clipped;
    case "cable": return flags.cableStep >= CABLE_ANCHORS.length;
    case "crack": return flags.crackStep >= 4;
    case "mailbox": return flags.letterPhotographed;
    case "summit": return flags.summitSelfie;
    case "hutView": return flags.hutChoice === "retreat" && flags.chocolate;
    case "signpost": return flags.signChosen;
    case "scree": return flags.screeStep >= SCREE_STEPS.length;
    case "deer": return flags.deerSeen;
    case "forestEdge": return flags.callDone;
    case "forest1": return flags.forestStep1 >= FOREST_STEPS.forest1.length;
    case "forest2": return flags.forestStep2 >= FOREST_STEPS.forest2.length;
    case "hairpin": return flags.waved;
    case "car": return flags.carLine >= CAR_LINES.length;
    case "search": return SEARCH_SPOTS.every((_, index) => flags.searched.includes(index));
    case "hotel": return flags.hotelCalls >= HOTEL_CALLS.length;
    case "busStop": return flags.busAnswered && flags.womanPhotographed;
    case "police": return flags.policeLine >= POLICE_LINES.length;
    case "bench": return false;
    default: return true;
  }
}

/* Flags as they stand when a node has been fully played (used by ?node= previews in development). */
function completeNode(node: NodeId, flags: Flags): Flags {
  const next = { ...flags, carabiner: { ...flags.carabiner } };
  switch (node) {
    case "plaque": next.helmet = true; next.clipped = true; break;
    case "cable": next.cableStep = CABLE_ANCHORS.length; next.carabiner = { a: CABLE_ANCHORS.length, b: CABLE_ANCHORS.length }; break;
    case "crack": next.crackStep = 4; break;
    case "mailbox": next.mailboxOpened = true; next.letterPhotographed = true; break;
    case "summit": next.summitSelfie = true; break;
    case "hutView": next.mapLegs = MAP_LEGS.map((_, index) => index); next.mapDone = true; next.hutChoice = "retreat"; next.chocolate = true; break;
    case "signpost": next.signChosen = true; break;
    case "scree": next.screeStep = SCREE_STEPS.length; break;
    case "deer": next.deerSeen = true; break;
    case "forestEdge": next.cameraDead = true; next.callDone = true; break;
    case "forest1": next.forestStep1 = FOREST_STEPS.forest1.length; break;
    case "forest2": next.forestStep2 = FOREST_STEPS.forest2.length; next.phoneLost = true; next.lostAt = 22 * 60 + 18; break;
    case "hairpin": next.waved = true; break;
    case "car": next.carLine = CAR_LINES.length; break;
    case "search": next.searched = SEARCH_SPOTS.map((_, index) => index); break;
    case "hotel": next.hotelCalls = HOTEL_CALLS.length; next.hotelCalled = HOTEL_CALLS.map((_, index) => index); break;
    case "busStop": next.busLine = BUS_STOP_LINES.length; next.busAnswered = true; next.womanPhotographed = true; break;
    case "police": next.policeLine = POLICE_LINES.length; next.phoneReturned = true; next.phoneLost = false; break;
    default: break;
  }
  return next;
}

function flagsUpTo(node: NodeId): Flags {
  let flags = INITIAL_FLAGS;
  for (const id of NODE_IDS) {
    if (id === node) break;
    flags = completeNode(id, flags);
  }
  return flags;
}

function clockFor(node: NodeId) {
  const day = NODES[node].day;
  if (day === 2) return node === "hotel" ? { date: NEXT_MORNING_DATE, minuteOfDay: 20 * 60 + 15 } : { date: NEXT_MORNING_DATE, minuteOfDay: 8 * 60 + 40 };
  if (day === 3) return node === "police" ? { date: THIRD_DAY_DATE, minuteOfDay: 10 * 60 + 5 } : node === "bench" ? { date: THIRD_DAY_DATE, minuteOfDay: 11 * 60 + 50 } : { date: THIRD_DAY_DATE, minuteOfDay: 9 * 60 + 5 };
  return null;
}

function createDevPhone(node: NodeId) {
  let phone = createInitialPhoneState();
  for (const id of NODE_IDS) {
    if (id === node) break;
    phone = phoneReducer(phone, { type: "advance_time", minutes: NODES[id].minutes, batteryCost: NODES[id].battery });
  }
  const clock = clockFor(node);
  if (clock) phone = phoneReducer(phone, { type: "set_clock", ...clock });
  if (nodeIndex(node) >= nodeIndex("forestEdge") && nodeIndex(node) < nodeIndex("police")) phone = phoneReducer(phone, { type: "set_clock", battery: 9 });
  if (nodeIndex(node) >= nodeIndex("police")) phone = phoneReducer(phone, { type: "set_clock", battery: 61 });
  if (nodeIndex(node) > nodeIndex("mailbox")) {
    phone = phoneReducer(phone, { type: "capture_photo", photo: { asset: nodeAsset("mailbox"), title: NODES.mailbox.photoTitle, place: NODES.mailbox.place, position: { x: 50, y: 50 }, zoom: 1.4, kind: "letter", day: 1 } });
  }
  return phone;
}

// ?node=<id> jumps into a node with everything before it completed. Development builds only.
const DEV_NODE: NodeId | null = import.meta.env.DEV ? (() => {
  const value = new URLSearchParams(window.location.search).get("node");
  return isNodeId(value) ? value : null;
})() : null;

/* Hotspots carry their place on the painting and how close the gaze must come before they show. */
const anchorProps = (anchor: Anchor, reveal = 10) => ({ "data-yaw": anchor.yaw, "data-pitch": anchor.pitch, "data-distance": anchor.distance ?? 10, "data-reveal": reveal });
const propProps = (anchor: Anchor) => ({ "data-yaw": anchor.yaw, "data-pitch": anchor.pitch, "data-distance": anchor.distance ?? 10 });
/* Pointer and keyboard both trigger a world action; a keyboard "click" has detail 0 and would otherwise be ignored. */
const act = (fn: () => void) => ({
  onPointerDown: (event: React.PointerEvent) => { event.stopPropagation(); fn(); },
  onClick: (event: React.MouseEvent) => { if (event.detail === 0) fn(); },
});

export default function App() {
  const [phase, setPhase] = useState<Phase>(DEV_NODE ? "play" : "title");
  const [node, setNode] = useState<NodeId>(DEV_NODE ?? "meadow");
  const [flags, setFlags] = useState<Flags>(() => DEV_NODE ? flagsUpTo(DEV_NODE) : INITIAL_FLAGS);
  const [phone, dispatchPhone] = useReducer(phoneReducer, DEV_NODE, (dev) => dev ? createDevPhone(dev) : createInitialPhoneState());
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [savedJourney, setSavedJourney] = useState<JourneySave | null>(() => DEV_NODE ? null : loadJourneySave());
  const [soundOn, setSoundOn] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [look, setLook] = useState<LookPoint>({ x: 0, y: 0 });
  const [walking, setWalking] = useState(false);
  const [walkProgress, setWalkProgress] = useState(0);
  const [breath, setBreath] = useState<BreathState>("calm");
  const [thought, setThought] = useState("");
  const [feedback, setFeedback] = useState("");
  const [chapterShown, setChapterShown] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [notebookReady, setNotebookReady] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("home");
  const [cameraAim, setCameraAim] = useState({ x: 50, y: 50 });
  const [cameraZoom, setCameraZoom] = useState(1);
  const [fear, setFear] = useState(0);
  const [climbHold, setClimbHold] = useState(0);
  const [carState, setCarState] = useState<CarState>("none");
  const [deerState, setDeerState] = useState<DeerState>("standing");
  const [womanShown, setWomanShown] = useState(false);
  const [callStep, setCallStep] = useState(0);
  const [nodeSeconds, setNodeSeconds] = useState(0);
  const [creditLine, setCreditLine] = useState(0);
  const [running, setRunning] = useState(false);
  const [hand, setHand] = useState<{ key: number; anchor: Anchor; kind: "grip" | "carabiner"; hold: boolean } | null>(null);
  const [dust, setDust] = useState(0);
  const [shouting, setShouting] = useState(false);
  const [braking, setBraking] = useState(false);
  const stageRef = useRef<StageHandle | null>(null);

  const soundRef = useRef<Soundscape | null>(null);
  const musicElsRef = useRef<Partial<Record<MusicKind, HTMLAudioElement>>>({});
  const musicTargetsRef = useRef<Partial<Record<MusicKind, number>>>({});
  const musicBlockedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const entryTimersRef = useRef<number[]>([]);
  const walkFrameRef = useRef(0);
  const feedbackTimerRef = useRef(0);
  const recoveryTimerRef = useRef(0);
  const holdRef = useRef<{ start: number; raf: number } | null>(null);
  const anchorLayerRef = useRef<HTMLDivElement>(null);
  const flagsRef = useRef(flags);
  useEffect(() => { flagsRef.current = flags; }, [flags]);

  const info = NODES[node];
  const night = NIGHT_NODES.includes(node);
  const ready = isReady(node, flags);
  const unread = Object.values(phone.unread).reduce((sum, value) => sum + value, 0);

  /* ---------- helpers ---------- */
  const schedule = useCallback((fn: () => void, delay: number) => {
    const timer = window.setTimeout(fn, delay);
    timersRef.current.push(timer);
    return timer;
  }, []);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    entryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    entryTimersRef.current = [];
    cancelAnimationFrame(walkFrameRef.current);
  }, []);
  const flash = useCallback((message: string) => {
    window.clearTimeout(feedbackTimerRef.current);
    setFeedback(message);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(""), 1800);
  }, []);
  // A line she says. It cancels the node's own entry narration so player-triggered lines are never overwritten.
  const say = useCallback((line: string, delay = 0) => {
    entryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    entryTimersRef.current = [];
    if (delay <= 0) setThought(line);
    else schedule(() => setThought(line), delay);
  }, [schedule]);
  const recover = useCallback((duration = 4200) => {
    window.clearTimeout(recoveryTimerRef.current);
    setBreath("recovery");
    recoveryTimerRef.current = window.setTimeout(() => setBreath("calm"), duration);
  }, []);
  const patch = useCallback((update: Partial<Flags> | ((current: Flags) => Partial<Flags>)) => {
    setFlags((current) => ({ ...current, ...(typeof update === "function" ? update(current) : update) }));
  }, []);
  const sfx = useCallback((name: "step" | "shutter" | "tick" | "tock" | "clink" | "slip" | "door" | "breath" | "thud" | "slide" | "brake" | "grip" | "helicopter" | "hooves" | "doorOpen" | "doorClose" | "wiper" | "exhale") => {
    const sound = soundRef.current;
    if (!sound || !soundOn) return;
    if (name === "step") sound.step(MATERIAL[node]);
    else if (name === "helicopter") sound.helicopter();
    else if (name === "hooves") sound.hooves(1);
    else if (name === "doorOpen") sound.door(true);
    else if (name === "doorClose") sound.door(false);
    else if (name === "wiper") sound.wiper();
    else if (name === "exhale") sound.exhale();
    else if (name === "thud") sound.thud();
    else if (name === "slide") sound.slide();
    else if (name === "brake") sound.brake();
    else if (name === "grip") sound.grip();
    else if (name === "shutter") sound.shutter();
    else if (name === "tick") sound.uiTick(true);
    else if (name === "tock") sound.uiTick(false);
    else if (name === "clink") sound.chainClink();
    else if (name === "slip") sound.slip();
    else if (name === "door") sound.carDoor();
    else sound.breath({ duration: 0.9, gain: 0.5, cutoff: 900 });
  }, [node, soundOn]);
  /* A push on the body: the camera's springs react and settle. */
  const kick = useCallback((kind: ImpulseKind, strength = 1, direction?: { yaw: number; pitch: number }) => { stageRef.current?.kick(kind, strength, direction); }, []);
  /* Her hand comes into view, reaching for what was just grabbed. */
  const reach = useCallback((anchor: Anchor, kind: "grip" | "carabiner" = "grip", hold = false) => { setHand({ key: Date.now(), anchor, kind, hold }); }, []);
  const spend = useCallback((minutes: number, battery = 0) => {
    if (flagsRef.current.phoneLost) return;
    dispatchPhone({ type: "advance_time", minutes, batteryCost: battery });
  }, []);

  // Web Audio only starts from a user gesture; the title button and any first pointer press wake it.
  const startAudio = useCallback(() => {
    if (!soundRef.current) {
      try {
        const sound = new Soundscape();
        sound.setMaster(settings.master);
        soundRef.current = sound;
        setAudioReady(true);
      } catch { return; }
    }
    soundRef.current.resume();
    musicBlockedRef.current = false;
  }, [settings.master]);

  const updateSettings = useCallback((update: Partial<GameSettings>) => {
    setSettings((current) => { const next = { ...current, ...update }; saveSettings(next); return next; });
  }, []);

  const onCanvasReady = useCallback(() => setCanvasReady(true), []);

  /* ---------- title key art ---------- */
  useEffect(() => {
    const image = new Image();
    image.onload = () => setCanvasReady(true);
    image.src = `${import.meta.env.BASE_URL}pano/title-key-art.webp`;
    const fallback = window.setTimeout(() => setCanvasReady(true), 4000);
    return () => window.clearTimeout(fallback);
  }, []);

  /* ---------- audio ---------- */
  useEffect(() => {
    if (!soundOn) { soundRef.current?.suspend(); return; }
    if (phase !== "title") startAudio();
  }, [phase, soundOn, startAudio]);
  useEffect(() => {
    const wake = () => { if (soundOn) startAudio(); };
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => { window.removeEventListener("pointerdown", wake); window.removeEventListener("keydown", wake); };
  }, [soundOn, startAudio]);
  useEffect(() => { soundRef.current?.setMaster(settings.master); }, [audioReady, settings.master]);
  useEffect(() => {
    const sound = soundRef.current;
    if (!audioReady || !sound) return;
    const base = phase === "title" ? { ...AMBIENCE.meadow, wind: 0.3 } : phase === "complete" ? AMBIENCE.bench : AMBIENCE[node];
    // A car on the hairpin is heard before it is seen.
    const engine = node === "hairpin" && carState !== "none" ? (carState === "stopped" ? 0.35 : 0.5) : 0;
    sound.setAmbience(engine ? { ...base, engine } : base, node === "hairpin" ? 0.9 : 1.6);
  }, [audioReady, carState, node, phase]);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const kinds = Object.keys(MUSIC_TRACKS) as MusicKind[];
    kinds.forEach((kind) => {
      const el = document.createElement("audio");
      el.src = `${base}${MUSIC_TRACKS[kind].src}`;
      el.loop = true; el.preload = "none"; el.volume = 0;
      musicElsRef.current[kind] = el;
    });
    const fadeTimer = window.setInterval(() => {
      kinds.forEach((kind) => {
        const el = musicElsRef.current[kind];
        if (!el) return;
        const target = musicTargetsRef.current[kind] ?? 0;
        const diff = target - el.volume;
        // If the browser refuses playback we stop asking until the next user gesture (startAudio clears the block).
        if (target > 0 && el.paused && !musicBlockedRef.current) el.play().catch(() => { musicBlockedRef.current = true; });
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
      kinds.forEach((kind) => { const el = musicElsRef.current[kind]; if (el) { el.pause(); el.removeAttribute("src"); } });
      musicElsRef.current = {};
    };
  }, []);
  useEffect(() => {
    const targets: Partial<Record<MusicKind, number>> = {};
    const level = settings.music;
    if (soundOn && level > 0 && phase !== "title") {
      if (node === "car") targets.warm = MUSIC_TRACKS.warm.volume * level;
      else if (phase === "complete" || (node === "bench" && flags.letterTranslated) || (node === "police" && flags.phoneReturned)) targets.end = MUSIC_TRACKS.end.volume * level;
      else if (DAY_MUSIC_NODES.includes(node)) targets.day = MUSIC_TRACKS.day.volume * level;
    }
    musicTargetsRef.current = targets;
  }, [flags.letterTranslated, flags.phoneReturned, node, phase, settings.music, soundOn]);

  /* ---------- entering a node ---------- */
  useEffect(() => {
    if (phase !== "play") return;
    clearTimers();
    const chapter = Boolean(NODES[node].chapter);
    const firstAt = chapter ? 4600 : 0;            // the first line waits for the chapter card to clear
    const entry = (fn: () => void, delay: number) => { entryTimersRef.current.push(window.setTimeout(fn, delay)); };
    if (firstAt === 0) setThought(NODES[node].thoughts[0]); else { setThought(""); entry(() => setThought(NODES[node].thoughts[0]), firstAt); }
    entry(() => setThought(NODES[node].thoughts[1]), firstAt + 5200);
    setChapterShown(chapter);
    if (chapter) schedule(() => setChapterShown(false), 4600);
    setCarState("none");
    setDeerState("standing");
    setWomanShown(false);
    setClimbHold(0);
    setNodeSeconds(0);
    if (node === "forestEdge") {
      setFear(0.3);
      setFlags((current) => current.cameraDead ? current : { ...current, cameraDead: true });
      dispatchPhone({ type: "set_clock", battery: Math.min(phone.battery, 9) });
    }
    if (node === "hairpin") setFear(0);
    if (node === "search") schedule(() => setOverlay("findmy"), 2800);
    if (node === "busStop") schedule(() => setWomanShown(true), 3600);
    if (node === "car") sfx("door");
    if (node === "hotel" || node === "police") { sfx("doorOpen"); schedule(() => sfx("doorClose"), 1500); }
    // A save written after the letter was translated resumes straight into the ending instead of a dead bench.
    if (node === "bench" && flagsRef.current.letterTranslated) schedule(() => { setPhase("complete"); setCreditLine(0); clearJourneySave(); setSavedJourney(null); }, 1200);
    const beats = PHONE_BEATS[node];
    if (beats && !flagsRef.current.phoneLost) beats.forEach((beat, index) => schedule(() => dispatchPhone({ type: "receive_message", contactId: beat.contactId, text: beat.text }), 7000 + index * 3000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, phase]);

  /* seconds spent standing in the current node (drives the fading light of the descent) */
  useEffect(() => {
    if (phase !== "play") return;
    const timer = window.setInterval(() => setNodeSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [node, phase]);

  /* ---------- persistence ---------- */
  useEffect(() => {
    if (DEV_NODE || phase !== "play" || walking || flags.letterTranslated) return;
    const timer = window.setTimeout(() => {
      const save: JourneySave = { version: 4, savedAt: new Date().toISOString(), node, flags, phone, cameraAim, cameraZoom };
      persistJourneySave(save);
      setSavedJourney(save);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [cameraAim, cameraZoom, flags, node, phase, phone, walking]);

  /* ---------- keys ---------- */
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "p" && phase === "play" && !menuOpen) {
        if (flags.phoneLost) { flash("外套口袋是空的。手机不在身上。"); return; }
        sfx(phoneOpen ? "tock" : "tick");
        setPhoneOpen((value) => !value);
        setPhoneTab(overlay === "call" ? "call" : "home");
      }
      if (event.key === "Escape") {
        if (phoneOpen) setPhoneOpen(false);
        else if (overlay !== "none" && overlay !== "call" && overlay !== "selfie") setOverlay("none");
        else if (phase !== "complete") setMenuOpen((value) => !value);
      }
      if (event.code === "Space" && phase === "play" && (node === "forest1" || node === "forest2") && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); shout(); }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  });

  useEffect(() => {
    if (!phoneOpen || flags.phoneLost) return;
    const timer = window.setInterval(() => dispatchPhone({ type: "advance_time", minutes: 1, batteryCost: 1 }), 45000);
    return () => window.clearInterval(timer);
  }, [flags.phoneLost, phoneOpen]);

  /* the call: it rings, then every line has to be said again */
  useEffect(() => {
    if (overlay !== "call" || callStep !== 0) return;
    const timer = window.setTimeout(() => setCallStep(1), 1600);
    return () => window.clearTimeout(timer);
  }, [callStep, overlay]);

  /* the notebook: the date is read before the shutter is offered */
  useEffect(() => {
    if (overlay !== "notebook") { setNotebookReady(false); return; }
    const timer = window.setTimeout(() => setNotebookReady(true), 2600);
    return () => window.clearTimeout(timer);
  }, [overlay]);

  /* cars on the hairpin: the first one passes without stopping; after that a car comes by every few seconds until she waves one down. */
  const firstCarPassedRef = useRef(false);
  useEffect(() => { if (node !== "hairpin") firstCarPassedRef.current = false; }, [node]);
  useEffect(() => {
    if (phase !== "play" || node !== "hairpin" || flags.waved) return;
    let timer = 0;
    if (carState === "none") timer = window.setTimeout(() => setCarState(firstCarPassedRef.current ? "second" : "first"), firstCarPassedRef.current ? 4200 : 3200);
    else if (carState === "first") timer = window.setTimeout(() => { firstCarPassedRef.current = true; setCarState("none"); }, 5400);
    else if (carState === "second") timer = window.setTimeout(() => setCarState("none"), 5400);
    return () => window.clearTimeout(timer);
  }, [carState, flags.waved, node, phase]);

  /* the wind has a side: on the wall it comes across the face from the valley */
  useEffect(() => { soundRef.current?.setWindPan(WIND_PAN[node] ?? 0); }, [audioReady, node]);

  /* in the car the wipers keep time */
  useEffect(() => {
    if (phase !== "play" || node !== "car") return;
    const timer = window.setInterval(() => { if (soundOn) soundRef.current?.wiper(); }, 2200);
    return () => window.clearInterval(timer);
  }, [node, phase, soundOn]);

  /* at night every breath is visible; out of breath it comes faster */
  const breathPeriod = breath === "recovery" ? 1.7 : 2.8;
  useEffect(() => {
    if (phase !== "play" || !night || phoneOpen) return;
    const timer = window.setInterval(() => { if (soundOn) soundRef.current?.exhale(); }, breathPeriod * 1000);
    return () => window.clearInterval(timer);
  }, [breathPeriod, night, phase, phoneOpen, soundOn]);

  /* the heart in the forest: sound and vignette beat faster as fear rises */
  const beatPeriod = Math.round(1000 - fear * 520);
  useEffect(() => {
    if (phase !== "play" || (node !== "forest1" && node !== "forest2")) return;
    const timer = window.setInterval(() => { if (soundOn) soundRef.current?.heartbeat(fear); }, beatPeriod);
    return () => window.clearInterval(timer);
  }, [beatPeriod, fear, node, phase, soundOn]);

  /* gusts on the wall and the plateau push the body a little */
  useEffect(() => {
    if (phase !== "play" || !GUSTY.includes(node)) return;
    let timer = 0;
    const gust = () => { kick("turn", 0.25 + Math.random() * 0.3); timer = window.setTimeout(gust, 5000 + Math.random() * 9000); };
    timer = window.setTimeout(gust, 3000 + Math.random() * 5000);
    return () => window.clearTimeout(timer);
  }, [kick, node, phase]);

  /* credits: the letter first, alone; then her three lines; then the card */
  useEffect(() => {
    if (phase !== "complete" || creditLine > CREDIT_TOTAL) return;
    const delay = creditLine === 0 ? 1800 : creditLine < CREDIT_POEM_LINES ? 1700 : creditLine === CREDIT_POEM_LINES ? 5200 : 3800;
    const timer = window.setTimeout(() => setCreditLine((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [creditLine, phase]);

  useEffect(() => () => {
    clearTimers();
    soundRef.current?.dispose();
    soundRef.current = null;
    setAudioReady(false);
  }, [clearTimers]);

  /* ---------- walking between nodes ---------- */
  const walkOn = () => {
    if (walking || !ready || !info.next) return;
    const target = info.next;
    const run = RUN_FROM.includes(node);
    setRunning(run);
    setWalking(true);
    setBreath("walking");
    setOverlay("none");
    setPhoneOpen(false);
    // Footfalls at the gait's cadence; a run lands harder and leaves her out of breath.
    const duration = settings.motion ? (run ? 1500 : 1800) : 900;
    const cadence = run ? RUN_CADENCE : WALK_CADENCE;
    const material = MATERIAL[node];
    for (let at = 0; at < duration - 120; at += cadence) schedule(() => {
      sfx("step");
      kick("step", STEP_KICK[material] * (run ? 1.3 : 1));
      if (material === "gravel") kick("turn", 0.12);
      if (run) sfx("thud");
    }, at);
    if (run) schedule(() => sfx("breath"), 700);
    const started = performance.now();
    const tick = () => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      setWalkProgress(progress);
      if (progress < 1) { walkFrameRef.current = requestAnimationFrame(tick); return; }
      spend(info.minutes, info.battery);
      const clock = clockFor(target);
      if (clock && NODES[target].day !== info.day) dispatchPhone({ type: "set_clock", ...clock });
      setNode(target);
      setWalking(false);
      setRunning(false);
      setWalkProgress(0);
      kick("settle", run ? 1.6 : 1);
      if (run) { sfx("breath"); schedule(() => sfx("breath"), 1100); }
      setBreath(nodeIndex(target) >= nodeIndex("scree") && nodeIndex(target) <= nodeIndex("hairpin") ? "recovery" : "calm");
      schedule(() => setBreath("calm"), run ? 7000 : 5000);
    };
    walkFrameRef.current = requestAnimationFrame(tick);
  };
  const bodyMode: BodyMode = walking ? (running ? "run" : "walk") : node === "cable" || node === "crack" ? "climb" : node === "forest1" || node === "forest2" ? "crawl" : node === "car" ? "ride" : "stand";

  const worldMove = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setLook({ x: ((event.clientX - rect.left) / rect.width - 0.5) * 2, y: ((event.clientY - rect.top) / rect.height - 0.5) * 2 });
  };

  /* ---------- node mechanics ---------- */
  const putOnHelmet = () => { patch({ helmet: true }); sfx("tick"); say("白色的头盔。扣好带子。"); };
  const clipIn = () => {
    if (!flags.helmet) { flash("先戴头盔"); return; }
    patch({ clipped: true }); sfx("clink"); say("两把锁扣，一蓝一橙，都挂上钢缆。任何时候，至少一把在上面。");
  };

  const carabinerAction = (which: "a" | "b") => {
    const step = flags.cableStep;
    const mine = flags.carabiner[which];
    const other = flags.carabiner[which === "a" ? "b" : "a"];
    if (step >= CABLE_ANCHORS.length) return;
    if (mine === step) {
      if (other === -1) {
        sfx("slip"); kick("slip", 0.8);
        patch((current) => ({ slips: current.slips + 1, carabiner: { a: step, b: step } }));
        flash("两把锁都离开了钢缆。手心一凉，重新挂回去。");
        recover(3600);
        spend(3);
        return;
      }
      patch({ carabiner: { ...flags.carabiner, [which]: -1 } });
      sfx("tock"); kick("clink", 0.6); reach({ yaw: CABLE_ANCHORS[step].yaw, pitch: CABLE_ANCHORS[step].pitch + 9 }, "carabiner");
      return;
    }
    if (mine === -1) {
      const next = step + 1;
      const carabiner = { ...flags.carabiner, [which]: next };
      sfx("clink"); kick("clink");
      if (carabiner.a === next && carabiner.b === next) {
        patch({ carabiner, cableStep: next });
        sfx("step"); sfx("grip"); kick("pull", 1.1); reach(CABLE_ANCHORS[Math.min(next, CABLE_ANCHORS.length - 1)], "grip");
        spend(8, 0);
        if (next === CABLE_ANCHORS.length) say("最后一个锚点。上面是裂缝。");
        else say(["钢缆比看起来更凉。", "一步一步。风从右边来。", "越往上，人越小。"][next - 1] ?? "");
      } else patch({ carabiner });
    }
  };

  const grabHold = (index: number) => {
    const hold = CRACK_HOLDS[index];
    if (hold.order === null) {
      reach(hold, "grip"); sfx("slip"); kick("slip", 0.9); patch((current) => ({ slips: current.slips + 1 })); recover(3600); spend(2);
      flash(index === 4 ? "石片松了，掉下去很久才听见响。" : "浅槽里全是草，抓不住。");
      return;
    }
    if (hold.order !== flags.crackStep) { flash(hold.order < flags.crackStep ? "已经过了这一步" : "重心还没过去。先找下一个点"); return; }
    reach(hold, "grip", true); sfx("grip"); schedule(() => { sfx("step"); kick("pull", 1.2); }, 420); patch({ crackStep: flags.crackStep + 1 }); spend(6);
    say(["左脚先站稳。", "右手抠住裂缝边缘。粗糙，扎手，但很牢。", "左手石突。重心移过去。", "右脚踩进裂缝。上面又有钢缆了。"][hold.order]);
  };

  const openMailbox = () => { sfx("tick"); patch({ mailboxOpened: true }); setOverlay("notebook"); say("盒子里是一本本子。有人翻到 7 月 28 日那页，留了几行意大利语。"); };
  const photographLetter = () => {
    if (!notebookReady) return;
    sfx("shutter");
    dispatchPhone({ type: "capture_photo", photo: { asset: nodeAsset("mailbox"), title: "山崖上的信箱", place: NODES.mailbox.place, position: { x: 50, y: 50 }, zoom: 1.4, kind: "letter", day: 1 } });
    patch({ letterPhotographed: true });
    setOverlay("none");
    say("看不懂。先拍下来，放回去。");
    spend(4, 1);
  };

  const lookAtCross = () => say("木头十字架。对面是 Sassolungo，云压在它上面。往下看，就是早上出发的山口。");
  const takeSelfie = () => {
    sfx("shutter"); setOverlay("selfie");
    schedule(() => sfx("helicopter"), 900);
    schedule(() => { setOverlay("none"); patch({ summitSelfie: true }); say("举起相机的时候，一架直升机从头顶飞过去。这一整天，山里就它和那两个人。"); }, 3200);
    schedule(() => say("我开心了一下。然后一整天，都没再笑出来。"), 9000);
    spend(6, 2);
  };

  const toggleLeg = (index: number) => {
    sfx("tick");
    patch((current) => ({ mapLegs: current.mapLegs.includes(index) ? current.mapLegs.filter((value) => value !== index) : [...current.mapLegs, index] }));
  };
  const mapTotal = flags.mapLegs.reduce((sum, index) => sum + MAP_LEGS[index].hours, 0);
  const closeMap = () => {
    if (flags.mapLegs.length < MAP_LEGS.length) { flash("把每一段都加起来"); return; }
    setOverlay("none");
  };
  const lookAtHut = () => say("山屋就在对面。隔着一整个山谷。地图上写着两个半小时。");
  const chooseHut = () => { flash("天黑以前，到不了。"); say("隔着一整个山谷。地图上的两个半小时，天黑以前到不了。"); patch({ hutChoice: null }); };
  const chooseRetreat = () => {
    patch({ hutChoice: "retreat", mapDone: true }); setOverlay("none"); sfx("tick");
    say("地图上一段一段加起来，从头到尾至少十个小时。教练说的是六七个。已经走了六个半小时，天只剩四个半小时。");
    say("紧急下撤。素材不要了，饭也不吃了，一板巧克力。", 6500);
  };
  const eatChocolate = () => { sfx("tick"); patch({ chocolate: true }); say("一板巧克力。今天唯一的一顿饭。"); spend(3); };

  const chooseArm = (index: number) => {
    const arm = SIGNPOST_ARMS[index];
    if (arm.correct) { patch({ signChosen: true }); sfx("tick"); say("Plan de Roces，Val Lasties，2455 米。656 号。往下。"); return; }
    spend(60, 4); recover(5000);
    flash(arm.label.includes("Selva") ? "这是往回走的路。一个小时没了。" : arm.label.includes("Boè") ? "往山屋的路。绕了一个小时又回到这里。" : "走错谷了。一个小时。");
  };

  const takeScreeStep = (safe: boolean) => {
    if (flags.screeStep >= SCREE_STEPS.length) return;
    if (!safe) {
      const { safe: flat, loose } = SCREE_STEPS[flags.screeStep];
      sfx("slip"); sfx("slide"); kick("slip", 0.7);
      kick("glance", 1, { yaw: (loose.yaw - flat.yaw) * 1.1, pitch: -14 });
      patch((current) => ({ slips: current.slips + 1 })); recover(3200); flash("石头从脚下滑走，一直滚到看不见。"); spend(4); return;
    }
    sfx("step"); sfx("thud"); kick("land"); setDust((value) => value + 1); schedule(() => sfx("slide"), 90);
    const next = flags.screeStep + 1; patch({ screeStep: next }); spend(11, 0);
    if (next === 2) say("云在离我而去。");
    if (next === 4) say("最后的夕阳也在离我而去。我一直盯着脚下。");
    if (next === SCREE_STEPS.length) say("坡底了。林线就在前面。");
  };
  const dusk = node === "scree" ? Math.min(0.85, flags.screeStep / SCREE_STEPS.length * 0.5 + Math.min(1, nodeSeconds / 240) * 0.35)
    : node === "deer" ? 0.22 + Math.min(1, nodeSeconds / 300) * 0.22
    : node === "forestEdge" ? 0.42 + Math.min(1, nodeSeconds / 240) * 0.25
    : 0;

  const scareDeer = () => {
    if (deerState !== "standing") return;
    setDeerState("fleeing"); sfx("hooves"); kick("glance", 0.6, { yaw: 6, pitch: 0 });
    schedule(() => { setDeerState("gone"); patch({ deerSeen: true }); say("十几只鹿，扭头跑回远处的森林。纪念品上除了鹿，还有熊、狼和野猪。"); }, 2600);
  };

  const startCall = () => { sfx("tick"); setCallStep(0); setOverlay("call"); };
  const sayAgain = () => { if (callStep < CALL_LINES.length - 1) { sfx("tick"); setCallStep((value) => value + 1); } };
  const hangUp = () => {
    setOverlay("none"); setPhoneOpen(false);
    patch({ callDone: true });
    dispatchPhone({ type: "set_clock", battery: 8 });
    say("对方不太会说英语，信号又很差。几乎没传递什么有效信息。相机已经没电了，手机也快了。特别特别幸运，我带了一盏拍视频用的补光灯。");
  };

  const shout = () => {
    if (node !== "forest1" && node !== "forest2") return;
    sfx("breath"); kick("shout"); setShouting(true); schedule(() => setShouting(false), 380);
    setFear((value) => Math.max(0.12, value - 0.4));
    flash(["呼——", "哈！", "走！", "啊——"][Math.floor(Math.random() * 4)]);
  };
  const forestStep = node === "forest1" ? flags.forestStep1 : flags.forestStep2;
  const forestSteps = node === "forest1" || node === "forest2" ? FOREST_STEPS[node] : [];
  const beginClimb = () => {
    if (holdRef.current || (node !== "forest1" && node !== "forest2")) return;
    const start = performance.now();
    const required = CLIMB_HOLD_MS * (1 + fear * 0.9);
    reach(FOREST_STEPS[node][node === "forest1" ? flags.forestStep1 : flags.forestStep2] ?? { yaw: 0, pitch: -6 }, "grip", true);
    sfx("grip");
    const loop = () => {
      const progress = Math.min(1, (performance.now() - start) / required);
      setClimbHold(progress);
      if (progress < 1) { holdRef.current = { start, raf: requestAnimationFrame(loop) }; return; }
      holdRef.current = null;
      setClimbHold(0);
      completeClimbStep();
    };
    holdRef.current = { start, raf: requestAnimationFrame(loop) };
  };
  const endClimb = () => {
    if (!holdRef.current) return;
    cancelAnimationFrame(holdRef.current.raf);
    holdRef.current = null;
    if (climbHold > 0.05 && climbHold < 1) { flash("手松了。再来。"); kick("slip", 0.5); sfx("slide"); setFear((value) => Math.min(1, value + 0.08)); }
    setClimbHold(0);
  };
  const completeClimbStep = () => {
    const id = node as "forest1" | "forest2";
    const current = id === "forest1" ? flagsRef.current.forestStep1 : flagsRef.current.forestStep2;
    const next = current + 1;
    sfx("step"); sfx("thud"); kick("pull", 1.15); setFear((value) => Math.min(1, value + 0.16)); spend(9);
    if (id === "forest1") patch({ forestStep1: next });
    else patch({ forestStep2: next, phoneLost: flagsRef.current.phoneLost || next >= 3, lostAt: flagsRef.current.lostAt ?? (next >= 3 ? phone.minuteOfDay : null) });
    if (id === "forest2" && next === 3 && !flagsRef.current.phoneLost) {
      setPhoneOpen(false); sfx("slip");
      say("口袋里滑出去一样东西。没有声音。");
      recover(5000);
    } else if (id === "forest1" && next === 2) say("心里有点害怕，就一直发出很粗重的声音给自己壮胆。");
    else if (id === "forest2" && next === FOREST_STEPS.forest2.length) say("下面有一点点光。是公路。");
  };
  // Keyboard users hold Enter/Space on the focused hold.
  const climbKey = (event: React.KeyboardEvent, down: boolean) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault(); event.stopPropagation();
    if (down) beginClimb(); else endClimb();
  };

  const wave = () => {
    if (node !== "hairpin" || flags.waved) return;
    if (carState === "first") { flash("第一辆车没有停。"); return; }
    if (carState === "second") { setCarState("stopped"); patch({ waved: true }); sfx("brake"); schedule(() => sfx("door"), 900); say("第二辆车停下来了。车窗降下来，一对特别可爱的情侣。"); return; }
    flash("路上没有车。");
  };
  const nextCarLine = () => {
    if (flags.carLine >= CAR_LINES.length) return;
    const index = flags.carLine;
    say(CAR_LINES[index]); patch({ carLine: index + 1 });
    if (index === 0) { sfx("door"); kick("jolt", 1.2); schedule(() => kick("settle", 0.8), 600); }
    else if (index === CAR_LINES.length - 1) { sfx("brake"); kick("brake", 1.1); setBraking(true); schedule(() => setBraking(false), 900); schedule(() => sfx("door"), 1400); }
    else { sfx("tick"); kick("jolt", 0.5); }
  };

  const searchSpot = (index: number) => {
    if (flags.searched.includes(index)) return;
    sfx("step"); say(SEARCH_SPOTS[index].line);
    const searched = [...flags.searched, index];
    patch({ searched });
    if (SEARCH_SPOTS.every((_, spot) => searched.includes(spot))) say("好吧。昨天能那么顺利地走出来，说不定是它替我挡了一次。这一年的照片，就当留在山里了。", 5200);
  };
  const searchEmpty = (index: number) => { sfx("step"); say(EMPTY_SPOTS[index].line); };
  const callHotel = (index: number) => {
    if (flags.hotelCalled.includes(index)) return;
    sfx("tick");
    patch((current) => ({ hotelCalled: [...current.hotelCalled, index], hotelCalls: current.hotelCalls + 1 }));
    dispatchPhone({ type: "advance_time", minutes: 4, batteryCost: 0 });
    flash(["“No, sorry.”", "“Nessun telefono qui.”", "“没有人捡到。”", "“Non lo so.”", "“Mi dispiace.”"][index % 5]);
  };
  const closeHotel = () => {
    if (flags.hotelCalls < HOTEL_CALLS.length) { flash("还有没打的"); return; }
    setOverlay("none"); say("二十多个电话。得到的答案都是没有。");
  };

  const nextBusLine = () => { if (flags.busLine >= BUS_STOP_LINES.length) return; say(BUS_STOP_LINES[flags.busLine]); patch({ busLine: flags.busLine + 1 }); };
  const answerYes = () => { patch({ busAnswered: true }); sfx("tick"); say("“Yes.” 她说：这个公交车去警察局。"); };
  const photographWoman = () => {
    if (flags.womanPhotographed) return;
    sfx("shutter"); patch({ womanPhotographed: true });
    say("来不及细问，公交已经到了。我只来得及拍下她跑开的背影。");
  };

  const nextPoliceLine = () => {
    if (flags.policeLine >= POLICE_LINES.length) return;
    const index = flags.policeLine;
    say(POLICE_LINES[index]);
    if (index === 1) {
      patch({ policeLine: index + 1, phoneReturned: true, phoneLost: false }); dispatchPhone({ type: "set_clock", battery: 61 }); sfx("tick");
      RETURNED_MESSAGES.forEach((message) => schedule(() => dispatchPhone({ type: "receive_message", contactId: message.contactId, text: message.text }), message.delay));
      return;
    }
    patch({ policeLine: index + 1 });
  };

  const translateLine = () => {
    if (flags.letterTranslated) return;
    const next = Math.min(ZH_LINE_COUNT, flags.translatedLines + 1);
    sfx("tick");
    if (next >= ZH_LINE_COUNT) {
      patch({ translatedLines: next, letterTranslated: true });
      schedule(() => setPhoneOpen(false), 6500);
      schedule(() => { setPhase("complete"); setCreditLine(0); clearJourneySave(); setSavedJourney(null); }, 9500);
    } else patch({ translatedLines: next });
  };

  /* ---------- phone ---------- */
  const openPhone = (tab: PhoneTab = "home") => {
    if (flags.phoneLost) { flash("口袋是空的。手机在森林里。"); return; }
    setCameraAim({ x: 50 + look.x * 34, y: 50 + look.y * 28 });
    setPhoneTab(tab); sfx("tick"); setPhoneOpen(true);
  };
  const closePhone = () => { sfx("tock"); setPhoneOpen(false); };
  const takePhoto = (snapshot?: string) => {
    sfx("shutter");
    dispatchPhone({ type: "capture_photo", photo: { asset: nodeAsset(node), snapshot, title: info.photoTitle, place: info.place, position: cameraAim, zoom: cameraZoom, day: info.day } });
  };
  const requestReply = useCallback((contactId: ContactId, kind: "text" | "photo") => {
    dispatchPhone({ type: "set_typing", contactId, value: true });
    schedule(() => {
      dispatchPhone({ type: "set_typing", contactId, value: false });
      dispatchPhone({ type: "receive_message", contactId, text: PHONE_REPLIES[contactId][kind] });
    }, kind === "photo" ? 1850 : 1350);
  }, [schedule]);

  /* ---------- flow ---------- */
  const resetRuntime = () => {
    clearTimers();
    setOverlay("none"); setPhoneOpen(false); setMenuOpen(false); setFear(0); setCallStep(0); setCarState("none"); setCreditLine(0); setClimbHold(0); setWalking(false); setRunning(false); setWalkProgress(0); setHand(null); setDust(0); setShouting(false); setBraking(false);
    if (holdRef.current) { cancelAnimationFrame(holdRef.current.raf); holdRef.current = null; }
  };
  const begin = () => {
    clearJourneySave(); setSavedJourney(null);
    resetRuntime();
    setNode("meadow"); setFlags(INITIAL_FLAGS); dispatchPhone({ type: "reset" }); setCameraAim({ x: 50, y: 50 }); setCameraZoom(1);
    setPhase("play"); startAudio();
  };
  const continueJourney = () => {
    if (!savedJourney) return begin();
    resetRuntime();
    setNode(savedJourney.node); setFlags(savedJourney.flags); dispatchPhone({ type: "restore", state: savedJourney.phone });
    setCameraAim(savedJourney.cameraAim); setCameraZoom(savedJourney.cameraZoom);
    setPhase("play"); startAudio();
  };
  const backToTitle = () => { resetRuntime(); setPhase("title"); setSavedJourney(loadJourneySave()); };

  const displayTime = formatGameTime(phone.minuteOfDay);
  const dayLabel = `${phone.date.month}月${phone.date.day}日`;

  const menu = menuOpen ? (
    <div className="menu-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <div className="menu-card" role="dialog" aria-modal="true" aria-label="设置">
        <p className="eyebrow">离开山谷以前</p>
        <h3>设置</h3>
        <label className="menu-row"><span>环境声与音效</span><input type="range" min={0} max={1} step={0.05} value={settings.master} onChange={(event) => updateSettings({ master: Number(event.target.value) })} /><output>{Math.round(settings.master * 100)}</output></label>
        <label className="menu-row"><span>音乐</span><input type="range" min={0} max={1} step={0.05} value={settings.music} onChange={(event) => updateSettings({ music: Number(event.target.value) })} /><output>{Math.round(settings.music * 100)}</output></label>
        <div className="menu-toggle"><span>镜头呼吸与步伐晃动</span><button className={settings.motion ? "on" : ""} onClick={() => updateSettings({ motion: !settings.motion })}>{settings.motion ? "开" : "关"}</button></div>
        <div className="menu-actions">
          <button className="primary-button" autoFocus onClick={() => setMenuOpen(false)}>继续</button>
          {phase !== "title" && <button className="secondary-button" onClick={backToTitle}>回到标题</button>}
        </div>
        <p className="menu-hint">ESC 打开或关闭</p>
      </div>
    </div>
  ) : null;

  if (phase === "title") return (
    <main className={`game-shell title-screen ${settings.motion ? "" : "reduce-motion"}`} onPointerMove={worldMove}>
      <div className="title-art" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}pano/title-key-art.webp")`, "--tilt-x": `${(-look.x * 14).toFixed(1)}px`, "--tilt-y": `${(-look.y * 9).toFixed(1)}px` } as React.CSSProperties} />
      <div className="cinema-grade" />
      <div className={`title-card ${canvasReady ? "is-ready" : ""}`}>
        <p className="eyebrow">离开山谷以前</p>
        <h1>来都来了</h1>
        <p className="title-subtitle">多洛米蒂，Passo Sella。一个人，一条飞拉达，一整天。<br />山崖上的信箱里，有一封我读不懂的信。</p>
        <div className="title-actions">
          <button className="primary-button" onClick={savedJourney ? continueJourney : begin}>{savedJourney ? "继续" : "下车"}</button>
          {savedJourney && <button className="secondary-button" onClick={begin}>重新开始</button>}
          <button className="secondary-button" onClick={() => setMenuOpen(true)}>设置</button>
        </div>
        {savedJourney && <p className="save-hint">上次停在 {NODES[savedJourney.node].place} · {formatGameTime(savedJourney.phone.minuteOfDay)}</p>}
        <p className="title-hint">移动鼠标环视，看向什么，什么才会亮起来 · P 打开手机 · 建议佩戴耳机</p>
        <p className="music-credit">根据 2025 年夏天一段真实的经历 · Music: Kevin MacLeod (incompetech.com) CC BY 4.0</p>
      </div>
      {menu}
    </main>
  );

  if (phase === "complete") {
    const done = creditLine > CREDIT_TOTAL;
    const closingStart = CREDIT_POEM_LINES + 1;
    return (
      <main className="game-shell complete-screen" onPointerDown={() => { if (!done) setCreditLine(CREDIT_TOTAL + 1); }}>
        <PanoStage asset={NODES.bench.asset} light="day" look={look} walking={false} progress={0} breath="calm" anchorLayerRef={anchorLayerRef} reduceMotion={!settings.motion} />
        <div className="cinema-grade" />
        {!done ? (
          <div className="credits-poem" aria-live="polite">
            <div className={`credits-pair ${creditLine >= closingStart ? "credits-dim" : ""}`}>
              <div className="credits-block credits-it">{LETTER_LINES_IT.map((line, index) => <p key={`it-${index}`} className={index < creditLine ? "shown" : ""}>{line || " "}</p>)}</div>
              <div className="credits-block credits-zh">{LETTER_LINES_ZH.map((line, index) => <p key={`zh-${index}`} className={index < creditLine ? "shown" : ""}>{line || " "}</p>)}</div>
            </div>
            {creditLine >= closingStart && (
              <div className="credits-block credits-closing">
                {CLOSING_LINES.map((line, index) => <p key={`c-${index}`} className={index + closingStart <= creditLine ? "shown" : ""}>{line}</p>)}
              </div>
            )}
            <p className="credits-skip">点击跳过</p>
          </div>
        ) : (
          <div className="complete-card">
            <p className="eyebrow">离开山谷以前</p>
            <h2>你是特别的。</h2>
            <p className="credits-source">根据一段真实的经历 · 2025 年 7 月 · Passo Sella</p>
            <p className="music-credit">Music: “Clear Air” “Simple Duet” “Promises to Keep” — Kevin MacLeod (incompetech.com) · CC BY 4.0</p>
            <button className="primary-button" onClick={backToTitle}><RotateCcw size={16} /> 再走一次</button>
          </div>
        )}
      </main>
    );
  }

  const holdActive = holdRef.current !== null;

  return (
    <main className={`game-shell node-${node} scene-light-${info.light} body-${bodyMode} ${walking ? "is-moving" : ""} ${walking && running ? "is-running" : ""} ${shouting ? "shouting" : ""} ${braking ? "car-braking" : ""} ${night && phoneOpen ? "night-phone" : ""} ${settings.motion ? "" : "reduce-motion"} breath-${breath} ${overlay !== "none" && overlay !== "selfie" ? "overlay-open" : ""} ${phoneOpen ? "phone-open" : ""}`}>
      <PanoStage asset={info.asset} light={info.light} look={look} walking={walking} progress={walkProgress} breath={breath} mode={bodyMode} tension={fear} handleRef={stageRef} idle={IDLE_NODES.includes(node) && !walking && overlay === "none" && !phoneOpen && !menuOpen} anchorLayerRef={anchorLayerRef} reduceMotion={!settings.motion} onReady={onCanvasReady} />
      <div className="cinema-grade" />
      <div className="film-grain" />
      <div className={`scene-blink ${info.light === "interior" && node !== "car" ? "warm" : ""}`} key={`blink-${node}`} />
      {dusk > 0 && <div className="dusk-fall" style={{ opacity: dusk }} />}
      {CLOUDY.includes(node) && <div className="cloud-shadows" aria-hidden="true" />}
      <div className="breath-pulse" aria-hidden="true" />
      {night && !phoneOpen && <div className="breath-fog" aria-hidden="true" style={{ "--breath": `${breathPeriod}s` } as React.CSSProperties} />}
      {phoneOpen && night && <div className="phone-glow" aria-hidden="true" />}
      {MOTES[node] && <div className={`motes ${MOTES[node]}`} aria-hidden="true">{MOTE_SPOTS.map((spot, index) => <i key={index} style={{ "--x": `${spot.x}%`, "--y": `${spot.y}%`, "--dur": `${spot.dur}s`, "--delay": `${spot.delay}s` } as React.CSSProperties} />)}</div>}
      {node === "car" && <><div className="car-sweep" aria-hidden="true"><i /><i /><i /></div><div className="tree-flicker" aria-hidden="true" /><div className="dash-glow" aria-hidden="true" /><div className="wipers" aria-hidden="true"><i /><i /></div></>}
      <div className="hands-layer" aria-hidden="true">
        {walking && <img className="hand-walk" src={`${import.meta.env.BASE_URL}sprites/hand-walk.webp`} alt="" draggable={false} style={{ "--cadence": `${running ? RUN_CADENCE : WALK_CADENCE}ms` } as React.CSSProperties} />}
        {node === "car" && <img className="hands-lap" src={`${import.meta.env.BASE_URL}sprites/hands-lap.webp`} alt="" draggable={false} />}
      </div>
      {(node === "forest1" || node === "forest2") && <div className="fear-vignette" aria-hidden="true" style={{ "--beat": `${beatPeriod}ms`, "--beat-strength": (0.15 + fear * 0.55).toFixed(2) } as React.CSSProperties} />}
      {dust > 0 && <div key={dust} className="dust-puff" aria-hidden="true" onAnimationEnd={() => setDust(0)} />}
      {(node === "forest1" || node === "forest2") && <div className="lamp-light" aria-hidden="true" style={{ "--beam-x": `${(look.x + 1) * 50}%`, "--beam-y": `${(look.y + 1) * 50}%` } as React.CSSProperties} />}
      {night && <div className={`night-darkness ${node === "forestEdge" ? "faint" : node === "hairpin" ? `road ${carState !== "none" ? "lit" : ""}` : ""}`} style={{ "--beam-x": `${(look.x + 1) * 50}%`, "--beam-y": `${(look.y + 1) * 50}%` } as React.CSSProperties} />}
      {info.chapter && chapterShown && (
        <div className="chapter-card" key={`chapter-${node}`} aria-hidden="true">
          <small>{info.chapter.eyebrow}</small>
          <strong>{info.chapter.title}</strong>
        </div>
      )}

      <div className="scene-caption"><span>{dayLabel} {displayTime}</span>{info.place} · {info.elevation}</div>
      <div className="utility-controls">
        <button onClick={() => setSoundOn((value) => !value)} aria-label="切换声音">{soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        <button className={flags.phoneLost ? "phone-missing" : ""} onClick={() => openPhone()} aria-label={flags.phoneLost ? "手机已遗失" : "打开手机"}><Smartphone size={17} /><kbd>P</kbd>{!flags.phoneLost && unread > 0 && <i className="unread-badge">{unread}</i>}</button>
        <button onClick={() => setMenuOpen(true)} aria-label="设置"><SettingsIcon size={17} /></button>
      </div>

      <div className="world-input" onPointerMove={worldMove}>
        <span className="gaze-dot" style={{ left: `${(look.x + 1) * 50}%`, top: `${(look.y + 1) * 50}%` }} />
      </div>

      <div className="anchor-layer" ref={anchorLayerRef}>
        {hand && (
          <img key={hand.key} className={`hand-reach ${hand.kind} ${hand.hold ? "hold" : ""}`} {...propProps({ yaw: hand.anchor.yaw, pitch: hand.anchor.pitch, distance: 8 })} src={`${import.meta.env.BASE_URL}sprites/hand-${hand.kind}.webp`} alt="" draggable={false} onAnimationEnd={() => setHand((current) => current && current.key === hand.key ? null : current)} />
        )}
        {ready && info.go && info.next && !walking && (
          <button className="hotspot go-hotspot" {...anchorProps(info.go, 24)} {...act(walkOn)} aria-label="继续往前"><span /><em>{node === "hutView" ? "下撤" : node === "car" ? "到酒店了" : node === "hotel" ? "第三天" : node === "police" ? "到长椅上等车" : "往前"}</em></button>
        )}

        {node === "plaque" && !flags.helmet && <button className="hotspot" {...anchorProps({ yaw: -18, pitch: -12 })} {...act(putOnHelmet)}><span /><em>头盔</em></button>}
        {node === "plaque" && flags.helmet && !flags.clipped && <button className="hotspot" {...anchorProps({ yaw: 18, pitch: 5 })} {...act(clipIn)}><span /><em>钢缆起点</em></button>}

        {node === "cable" && flags.cableStep < CABLE_ANCHORS.length && (
          <span className="hotspot anchor-mark" {...propProps(CABLE_ANCHORS[flags.cableStep])} aria-hidden="true"><span /><em>锚点</em></span>
        )}
        {node === "cable" && flags.cableStep < CABLE_ANCHORS.length && (
          <div className="anchor-panel" {...propProps({ yaw: CABLE_ANCHORS[flags.cableStep].yaw + 14, pitch: CABLE_ANCHORS[flags.cableStep].pitch + 4 })}>
            <strong>锚点 {flags.cableStep + 1} / {CABLE_ANCHORS.length}</strong>
            {(["a", "b"] as const).map((which) => {
              const value = flags.carabiner[which];
              const state = value === -1 ? "free" : value > flags.cableStep ? "next" : "clipped";
              return (
                <button key={which} className={`carabiner carabiner-${which} state-${state}`} {...act(() => carabinerAction(which))}>
                  <span>{which === "a" ? "蓝锁" : "橙锁"}</span>
                  <small>{state === "free" ? "在手里 · 挂到下一段" : state === "next" ? "已在下一段" : "解开"}</small>
                </button>
              );
            })}
          </div>
        )}

        {node === "crack" && flags.crackStep < 4 && CRACK_HOLDS.map((hold, index) => (
          (hold.order === null || hold.order >= flags.crackStep) && (
            <button key={hold.label} className="hotspot hold-hotspot" {...anchorProps(hold, 11)} {...act(() => grabHold(index))}><span /><em>{hold.label}</em></button>
          )
        ))}

        {node === "mailbox" && !flags.letterPhotographed && <button className="hotspot" {...anchorProps(MAILBOX_ANCHOR, 14)} {...act(openMailbox)}><span /><em>信箱</em></button>}

        {node === "summit" && <button className="hotspot" {...anchorProps(SUMMIT_CROSS_ANCHOR, 12)} {...act(lookAtCross)}><span /><em>十字架</em></button>}
        {node === "summit" && !flags.summitSelfie && <button className="hotspot" {...anchorProps(SUMMIT_CAMERA_ANCHOR, 12)} {...act(takeSelfie)}><span /><em>全景相机</em></button>}

        {node === "hutView" && flags.hutChoice !== "retreat" && <button className="hotspot" {...anchorProps(HUT_ANCHOR, 12)} {...act(lookAtHut)}><span /><em>山屋</em></button>}
        {node === "hutView" && !flags.mapDone && <button className="hotspot" {...anchorProps(PLATEAU_MAP_ANCHOR, 12)} {...act(() => { setOverlay("map"); sfx("tick"); })}><span /><em>摊开地图</em></button>}
        {node === "hutView" && flags.mapDone && !flags.chocolate && <button className="hotspot" {...anchorProps(CHOCOLATE_ANCHOR, 12)} {...act(eatChocolate)}><span /><em>巧克力</em></button>}

        {node === "signpost" && !flags.signChosen && SIGNPOST_ARMS.map((arm, index) => (
          <button key={arm.label} className="hotspot sign-arm" {...anchorProps(arm, 16)} {...act(() => chooseArm(index))}><em>{arm.label}</em></button>
        ))}

        {node === "scree" && flags.screeStep < SCREE_STEPS.length && (
          <>
            <button className="hotspot foot-hotspot foot-flat" {...anchorProps(SCREE_STEPS[flags.screeStep].safe, 14)} {...act(() => takeScreeStep(true))} aria-label="一块平的石面"><span /></button>
            <button className="hotspot foot-hotspot foot-loose" {...anchorProps(SCREE_STEPS[flags.screeStep].loose, 14)} {...act(() => takeScreeStep(false))} aria-label="一块斜的石面"><span /></button>
          </>
        )}

        {node === "deer" && deerState !== "gone" && (
          <img className={`deer-herd deer-${deerState}`} {...propProps(DEER_ANCHOR)} src={`${import.meta.env.BASE_URL}sprites/deer-herd.webp`} alt="林线边的一群鹿" draggable={false} onPointerDown={(event) => { event.stopPropagation(); scareDeer(); }} style={{ pointerEvents: "auto" }} />
        )}
        {node === "deer" && deerState === "standing" && <button className="hotspot" {...anchorProps({ yaw: DEER_ANCHOR.yaw, pitch: DEER_ANCHOR.pitch }, 28)} {...act(scareDeer)}><span /><em>鹿</em></button>}

        {(node === "forest1" || node === "forest2") && forestStep < forestSteps.length && (
          <button className={`hotspot climb-hotspot ${holdActive ? "holding" : ""}`} {...anchorProps(forestSteps[forestStep], 16)} style={{ "--hold": climbHold } as React.CSSProperties}
            onPointerDown={(event) => { event.stopPropagation(); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ } beginClimb(); }}
            onPointerUp={endClimb} onPointerCancel={endClimb} onPointerLeave={endClimb}
            onKeyDown={(event) => climbKey(event, true)} onKeyUp={(event) => climbKey(event, false)}>
            <span /><em>{forestSteps[forestStep].kind === "root" ? "树根 · 按住" : forestSteps[forestStep].kind === "rock" ? "岩石 · 按住" : "倒木 · 按住"}</em>
          </button>
        )}

        {node === "hairpin" && <div className={`car-lights ${carState === "stopped" ? "stopped" : carState !== "none" ? "on" : ""}`} {...propProps({ yaw: 17, pitch: -14, distance: 12 })} />}

        {node === "search" && SEARCH_SPOTS.map((spot, index) => !flags.searched.includes(index) && (
          <button key={spot.label} className="hotspot search-hotspot" {...anchorProps(spot, 11)} {...act(() => searchSpot(index))}><span /><em>{spot.label}</em></button>
        ))}
        {node === "search" && EMPTY_SPOTS.map((spot, index) => (
          <button key={spot.label} className="hotspot search-hotspot" {...anchorProps(spot, 11)} {...act(() => searchEmpty(index))}><span /><em>{spot.label}</em></button>
        ))}

        {node === "police" && flags.policeLine < POLICE_LINES.length && (
          <button className="hotspot counter-hotspot" {...anchorProps(POLICE_COUNTER_ANCHOR, 30)} {...act(nextPoliceLine)}><span /><em>{flags.policeLine === 0 ? "柜台 · 描述那部手机" : flags.policeLine === 1 ? "他回来了" : "问是谁送来的"}</em></button>
        )}

        {node === "busStop" && womanShown && !flags.busAnswered && (
          <img className="woman-prop" {...propProps({ yaw: 27, pitch: -19, distance: 12 })} src={`${import.meta.env.BASE_URL}sprites/woman-front.webp`} alt="走过来的女士" draggable={false} />
        )}
        {node === "busStop" && flags.busAnswered && !flags.womanPhotographed && (
          <img className="woman-prop woman-back" {...propProps({ yaw: 30, pitch: -17, distance: 13 })} src={`${import.meta.env.BASE_URL}sprites/woman-back.webp`} alt="跑开的女士" draggable={false} />
        )}
        {node === "busStop" && flags.womanPhotographed && (
          <img className="bus-prop" {...propProps({ yaw: 30, pitch: -14, distance: 14 })} src={`${import.meta.env.BASE_URL}sprites/bus.webp`} alt="472 路公交车" draggable={false} />
        )}
      </div>

      {node === "forestEdge" && !flags.callDone && overlay !== "call" && <button className="story-action call-action" {...act(startCall)}>拨打 112</button>}
      {(node === "forest1" || node === "forest2") && forestStep < forestSteps.length && <button className={`story-action shout-action ${fear > 0.55 ? "urgent" : ""}`} {...act(shout)}>喊一声<kbd>空格</kbd></button>}
      {node === "hairpin" && !flags.waved && <button className={`story-action wave-action ${carState === "first" || carState === "second" ? "lit" : "dim"}`} {...act(wave)}>{carState === "none" ? "听……" : "朝车灯挥手"}</button>}
      {node === "car" && flags.carLine < CAR_LINES.length && <button className="story-action conversation-action" {...act(nextCarLine)}>{flags.carLine === 0 ? "上车" : flags.carLine === 1 ? "接过水" : "继续听"}</button>}
      {node === "hotel" && flags.hotelCalls < HOTEL_CALLS.length && overlay !== "hotel" && <button className="story-action call-action" {...act(() => { setOverlay("hotel"); sfx("tick"); })}>打电话问</button>}
      {node === "busStop" && womanShown && flags.busLine < BUS_STOP_LINES.length && <button className="story-action conversation-action" {...act(nextBusLine)}>{flags.busLine === 0 ? "有人走过来" : "她开口"}</button>}
      {node === "busStop" && womanShown && flags.busLine >= BUS_STOP_LINES.length && !flags.busAnswered && <button className="story-action answer-action" {...act(answerYes)}>“Yes.”</button>}
      {node === "busStop" && flags.busAnswered && !flags.womanPhotographed && <button className="story-action camera-action" {...act(photographWoman)}>举起相机</button>}
      {node === "bench" && !flags.letterTranslated && !phoneOpen && <button className="story-action phone-return-action" {...act(() => openPhone("gallery"))}>打开相册</button>}

      {(node === "forest1" || node === "forest2") && <div className="fear-meter" aria-hidden="true"><i style={{ width: `${Math.round(fear * 100)}%` }} /><small>心跳</small></div>}

      {overlay === "notebook" && (
        <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="信箱里的本子">
          <div className="notebook">
            <div className="notebook-page">
              <header><span>Memo</span><span>28/07/2025</span></header>
              {LETTER_LINES_IT.map((line, index) => <p key={index}>{line || " "}</p>)}
            </div>
            <div className="notebook-actions">
              <button className={`primary-button ${notebookReady ? "" : "is-waiting"}`} disabled={!notebookReady} onClick={photographLetter}>拍下来</button>
              <button className="secondary-button" autoFocus onClick={() => setOverlay("none")}>放回去</button>
            </div>
            <p className="overlay-hint">{notebookReady ? "意大利语。看不懂。" : "7 月 28 日。三天前。"}</p>
          </div>
        </div>
      )}
      {overlay === "map" && (
        <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="地图">
          <div className="map-sheet-overlay">
            <header><strong>Gruppo del Sella · Tabacco 05</strong><span>把从这里到公路的每一段时间加起来</span></header>
            <p className="map-lead">已经走了 {HOURS_ALREADY} 小时。教练说全程六七个小时。</p>
            <ul className="map-legs">
              {MAP_LEGS.map((leg, index) => (
                <li key={leg.name}><button className={flags.mapLegs.includes(index) ? "checked" : ""} autoFocus={index === 0} onClick={() => toggleLeg(index)}><span>{leg.name}</span><b>{leg.hours} h</b></button></li>
              ))}
            </ul>
            <div className="map-total"><span>下撤还要</span><b>{mapTotal.toFixed(1)} h</b>{flags.mapLegs.length === MAP_LEGS.length && <em>一共 {(HOURS_ALREADY + mapTotal).toFixed(1)} h · 天还剩 {DAYLIGHT_LEFT} 小时</em>}</div>
            {flags.mapLegs.length === MAP_LEGS.length ? (
              <div className="map-choice">
                <button className="secondary-button" onClick={chooseHut}>往山屋走 · {HUT_HOURS} h</button>
                <button className="primary-button" onClick={chooseRetreat}>紧急下撤 · {mapTotal.toFixed(1)} h</button>
              </div>
            ) : <button className="primary-button map-close" onClick={closeMap}>合上地图</button>}
          </div>
        </div>
      )}
      {overlay === "call" && (
        <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="通话">
          <div className="call-sheet">
            <div className="call-number">112</div>
            <div className="call-status">{callStep === 0 ? "拨号中" : callStep >= CALL_LINES.length - 1 ? "通话结束" : "通话中 · 信号很差"}</div>
            <div className="call-lines">{CALL_LINES.slice(0, callStep + 1).map((line, index) => <p key={index} className={index === 2 ? "mine" : ""}>{line}</p>)}</div>
            {callStep > 0 && callStep < CALL_LINES.length - 1 && <button className="secondary-button call-next" autoFocus onClick={sayAgain}>{callStep === 1 ? "“I'm alone. Under the Sella.”" : callStep === 2 ? "再说一遍" : "“Hello? Hello?”"}</button>}
            {callStep >= CALL_LINES.length - 1 && <button className="primary-button call-hangup" autoFocus onClick={hangUp}>挂断</button>}
          </div>
        </div>
      )}
      {overlay === "findmy" && (
        <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="Find My">
          <div className="findmy-sheet">
            <header><strong>Find My · 叉宝的 iPhone（酒店电脑上）</strong><span>最后定位 · 昨晚 {formatGameTime(flags.lostAt ?? 22 * 60 + 18)} · Val Lasties</span></header>
            <div className="findmy-map"><div className="trail" /><div className="pin" /></div>
            <p>定位停在森林小路上段，一片巨石和矮松之间。从那以后没有再更新。</p>
            <button className="primary-button" autoFocus onClick={() => setOverlay("none")}>去那里看看</button>
          </div>
        </div>
      )}
      {overlay === "hotel" && (
        <div className="paper-overlay" role="dialog" aria-modal="true" aria-label="打电话">
          <div className="hotel-sheet">
            <header><strong>附近的酒店与游客中心</strong><span>已打 {flags.hotelCalls} 个 · {displayTime}</span></header>
            <ul>
              {HOTEL_CALLS.map((name, index) => <li key={name}><button className={flags.hotelCalled.includes(index) ? "called" : ""} autoFocus={index === 0} onClick={() => callHotel(index)}><span>{name}</span><b>{flags.hotelCalled.includes(index) ? "没有" : "拨打"}</b></button></li>)}
            </ul>
            <button className="primary-button map-close" onClick={closeHotel}>放下电话</button>
          </div>
        </div>
      )}
      {overlay === "selfie" && (
        <div className="selfie-flash" aria-hidden="true"><div className="selfie-planet" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}${NODES.summit.asset}")` }} /></div>
      )}

      {thought && <div className="thought-line">{thought}</div>}
      {feedback && <div className="world-feedback">{feedback}</div>}

      <div className="action-whisper">
        {node === "meadow" && !ready && "环视四周"}
        {node === "plaque" && !flags.helmet && "岩壁下面，背包边上"}
        {node === "plaque" && flags.helmet && !flags.clipped && "钢缆从哪里开始"}
        {node === "cable" && !ready && "到锚点：先解开一把锁，挂到下一段，再换另一把"}
        {node === "crack" && !ready && "没有钢缆。看岩壁，找能抓住的地方"}
        {node === "mailbox" && !flags.letterPhotographed && "岩壁上有什么"}
        {node === "summit" && !flags.summitSelfie && "看看四周"}
        {node === "hutView" && !flags.mapDone && "山屋在对面。看看地图"}
        {node === "hutView" && flags.mapDone && !flags.chocolate && "背包里还有吃的"}
        {node === "signpost" && !flags.signChosen && "读路牌"}
        {node === "scree" && !ready && "选一块能站住的石头"}
        {node === "deer" && !flags.deerSeen && "前面有响动"}
        {node === "forestEdge" && !flags.callDone && "手机还剩 9%。信号一格"}
        {(node === "forest1" || node === "forest2") && !ready && "按住能抓住的东西，直到抓稳。害怕了就喊一声"}
        {node === "hairpin" && !flags.waved && "最原始的方式"}
        {node === "car" && !ready && "暖气开着"}
        {node === "search" && !ready && "沿着 Find My 的最后定位找"}
        {node === "hotel" && !ready && "附近所有的酒店和游客中心"}
        {node === "busStop" && !flags.busAnswered && "等 472 路"}
        {node === "busStop" && flags.busAnswered && !flags.womanPhotographed && "她跑开了"}
        {node === "police" && !ready && "走到柜台前"}
        {node === "bench" && !flags.letterTranslated && "只有这部手机拍下了那封信"}
        {ready && info.next && !walking && "想走的时候，看向路，点亮起来的箭头"}
      </div>

      {phoneOpen && <img className="hand-phone" src={`${import.meta.env.BASE_URL}sprites/hand-phone.webp`} alt="" draggable={false} aria-hidden="true" />}
      {phoneOpen && (
        <Phone
          tab={phoneTab} setTab={setPhoneTab} close={closePhone} phone={phone} dispatch={dispatchPhone}
          node={node} place={info.place} night={night}
          cameraAim={cameraAim} setCameraAim={setCameraAim} cameraZoom={cameraZoom} setCameraZoom={setCameraZoom}
          takePhoto={takePhoto} requestReply={requestReply}
          letterTranslated={flags.letterTranslated} translatedLines={flags.translatedLines} onTranslate={node === "bench" ? translateLine : undefined}
          call={overlay === "call" ? { lines: CALL_LINES, step: callStep, done: callStep >= CALL_LINES.length - 1, hangUp } : undefined}
        />
      )}
      {menu}
    </main>
  );
}
