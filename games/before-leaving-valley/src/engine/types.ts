/* Engine base types. Nothing in src/engine imports React or three. */
import type { GameSettings } from "../settings";
import type { PhoneState } from "../phoneModel";
import type { PhoneTab as PhoneTabModel } from "../Phone";
import type { GameDate } from "../phoneModel";

export type Deg = number;

/** A place on the painting: yaw/pitch in degrees, distance scales the projected element (10 = natural). */
export type Transform = { yaw: Deg; pitch: Deg; distance?: number; scale?: number };

/** The verbs. There is no menu; every verb lives on the picture. */
export type Verb = "inspect" | "read" | "take" | "use" | "clip" | "step" | "hold" | "photograph" | "talk" | "wave";

/** The full cost of one action. Minutes are the one unit every system shares. */
export type Cost = { minutes?: number; battery?: number; camera?: number; lamp?: number; fatigue?: number; fear?: number };

export type FlagValue = boolean | number | string | null;
export type FlagKey = string;

export const SCENE_IDS = [
  "roadside", "meadow", "approach", "plaque", "cable", "crack", "slab", "mailbox", "exit", "summit",
  "plateau", "ledge", "hutView", "hutTurn", "signpost", "scree", "deer", "forestEdge", "forest1", "forest2",
  "hairpin", "car", "search", "searchWall", "searchPath", "hotel", "busStop", "police", "bench",
] as const;
export type SceneId = typeof SCENE_IDS[number];
export const isSceneId = (value: unknown): value is SceneId => typeof value === "string" && (SCENE_IDS as readonly string[]).includes(value);

export const ITEM_IDS = [
  "helmet", "lanyard", "gloves", "backpack", "cap", "camera360", "phone", "fillLight", "chocolate",
  "paperMap", "pencil", "notebook", "redJacket", "letterPhoto", "contactCard",
] as const;
export type ItemId = typeof ITEM_IDS[number];
export const isItemId = (value: unknown): value is ItemId => typeof value === "string" && (ITEM_IDS as readonly string[]).includes(value);

export type EntryId = string;
export type EntityId = string;

export type OverlayId = "pack" | "paperMap" | "notebook" | "call" | "findmy" | "hotelCalls" | "selfie" | "board" | "reading";
export type PhoneTab = PhoneTabModel;

export type BodyMode = "stand" | "walk" | "run" | "climb" | "crawl" | "ride";
export type SoundMaterial = "rock" | "soft" | "gravel" | "road";
export type ImpulseKind = "step" | "land" | "slip" | "pull" | "clink" | "jolt" | "brake" | "turn" | "shout" | "settle" | "glance";
export type SfxName = "step" | "shutter" | "tick" | "tock" | "clink" | "slip" | "door" | "breath" | "thud" | "slide" | "brake" | "grip" | "helicopter" | "hooves" | "doorOpen" | "doorClose" | "wiper" | "exhale" | "heartbeat" | "pencil" | "paper" | "zip" | "cloth";

export type GazePoint = { yaw: Deg; pitch: Deg };

export type GameState = {
  version: 5;
  phase: "title" | "play" | "complete";
  sceneId: SceneId;
  previousSceneId: SceneId | null;
  clock: { day: 1 | 2 | 3; date: GameDate; minuteOfDay: number; sunsetMinute: number; lastLightMinute: number };
  body: { fatigue: number; fear: number; breath: "calm" | "walking" | "recovery"; slips: number; adrenaline: boolean };
  power: { phone: number; camera: number; lamp: number; lampMode: "wide" | "narrow" | null; lampOut: boolean };
  inventory: { items: ItemId[]; worn: ItemId[]; hands: ItemId[]; packDirt: 0 | 1 | 2 | 3 };
  journal: { entries: EntryId[]; mapLegs: Record<string, number>; estimates: Record<string, number>; objective: string | null; blazesLearned: boolean };
  flags: Record<FlagKey, FlagValue>;
  scenes: Partial<Record<SceneId, { visited: boolean; entered: number; entities: Record<EntityId, EntityState> }>>;
  phone: PhoneState;
  camera: { aimX: number; aimY: number; zoom: number };
  settings: GameSettings;
  stats: { minutesSpent: number; photos: number; blazesFound: number; blazesMissed: number; fallbackLines: number };
  ui: {
    overlay: OverlayId | null;
    overlayData: Record<string, FlagValue>;
    phoneOpen: boolean;
    phoneTab: PhoneTab;
    menuOpen: boolean;
    travel: { to: SceneId; run: boolean; started: number; ms: number } | null;
    line: { text: string; until: number; key: number } | null;
    flash: { text: string; until: number; key: number } | null;
    chapter: { eyebrow: string; title: string; until: number } | null;
    reading: { title: string; lines: readonly string[]; kind: string } | null;
    creditLine: number;
  };
};

/** The mutable part of an entity; it goes into the save. Definitions never change, states do. */
export type EntityState = { taken?: boolean; read?: boolean; used?: number; hidden?: boolean; data?: Record<string, FlagValue> };
