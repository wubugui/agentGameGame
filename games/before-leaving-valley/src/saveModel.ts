import { isNodeId, type NodeId } from "./story";
import type { PhoneState } from "./phoneModel";

export type Flags = {
  helmet: boolean;
  clipped: boolean;
  cableStep: number;
  carabiner: { a: number; b: number };   // cable segment index each carabiner is clipped to; -1 = in hand
  crackStep: number;
  slips: number;
  mailboxOpened: boolean;
  letterPhotographed: boolean;
  summitSelfie: boolean;
  mapLegs: number[];
  mapDone: boolean;
  hutChoice: null | "hut" | "retreat";
  chocolate: boolean;
  signChosen: boolean;
  screeStep: number;
  deerSeen: boolean;
  cameraDead: boolean;
  callDone: boolean;
  forestStep1: number;
  forestStep2: number;
  phoneLost: boolean;
  waved: boolean;
  carLine: number;
  searchStep: number;
  hotelCalled: number[];
  hotelCalls: number;
  busLine: number;
  busAnswered: boolean;
  policeLine: number;
  phoneReturned: boolean;
  letterTranslated: boolean;
  womanPhotographed: boolean;
  searched: number[];          // second-day spots she has already looked at
  translatedLines: number;     // how many lines of the letter she has translated on the bench
  lostAt: number | null;       // minute of day when the phone slipped out of her pocket
};

export const INITIAL_FLAGS: Flags = {
  helmet: false, clipped: false, cableStep: 0, carabiner: { a: 0, b: 0 }, crackStep: 0, slips: 0,
  mailboxOpened: false, letterPhotographed: false, summitSelfie: false, mapLegs: [], mapDone: false, hutChoice: null, chocolate: false,
  signChosen: false, screeStep: 0, deerSeen: false, cameraDead: false, callDone: false, forestStep1: 0, forestStep2: 0, phoneLost: false,
  waved: false, carLine: 0, searchStep: 0, hotelCalled: [], hotelCalls: 0, busLine: 0, busAnswered: false, policeLine: 0, phoneReturned: false,
  letterTranslated: false, womanPhotographed: false, searched: [], translatedLines: 0, lostAt: null,
};

export type JourneySave = {
  version: 4;
  savedAt: string;
  node: NodeId;
  flags: Flags;
  phone: PhoneState;
  cameraAim: { x: number; y: number };
  cameraZoom: number;
};

// v4: the game was rebuilt as node panoramas on 2026-09-04.
const SAVE_KEY = "before-leaving-valley.journey.v4";
const RETIRED_KEYS = ["before-leaving-valley.journey.v1", "before-leaving-valley.journey.v2", "before-leaving-valley.journey.v3"];
const MAX_PERSISTED_SNAPSHOTS = 12;

function trimSnapshots(phone: PhoneState, keep: number): PhoneState {
  if (keep <= 0) return { ...phone, photos: phone.photos.map((photo) => ({ ...photo, snapshot: undefined })) };
  return { ...phone, photos: phone.photos.map((photo, index) => index < keep ? photo : { ...photo, snapshot: undefined }) };
}

function isPhoneState(value: unknown): value is PhoneState {
  if (!value || typeof value !== "object") return false;
  const phone = value as Partial<PhoneState>;
  const isRecord = (candidate: unknown) => Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate);
  return Array.isArray(phone.photos) && phone.photos.every((photo) => Boolean(photo) && typeof photo === "object" && typeof (photo as { asset?: unknown }).asset === "string")
    && typeof phone.minuteOfDay === "number" && typeof phone.battery === "number"
    && isRecord(phone.threads) && isRecord(phone.unread) && isRecord(phone.typing)
    && isRecord(phone.date) && typeof (phone.date as { day?: unknown }).day === "number";
}

export function loadJourneySave(): JourneySave | null {
  try {
    RETIRED_KEYS.forEach((key) => window.localStorage.removeItem(key));
    const serialized = window.localStorage.getItem(SAVE_KEY);
    if (!serialized) return null;
    const raw = JSON.parse(serialized) as Record<string, unknown>;
    if (raw.version !== 4 || !isNodeId(raw.node) || !isPhoneState(raw.phone)) return null;
    const flags = { ...INITIAL_FLAGS, ...((raw.flags ?? {}) as Partial<Flags>) };
    flags.carabiner = { ...INITIAL_FLAGS.carabiner, ...(flags.carabiner ?? {}) };
    return {
      version: 4,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
      node: raw.node,
      flags,
      phone: raw.phone,
      cameraAim: raw.cameraAim && typeof raw.cameraAim === "object" ? raw.cameraAim as { x: number; y: number } : { x: 50, y: 50 },
      cameraZoom: typeof raw.cameraZoom === "number" ? raw.cameraZoom : 1,
    };
  } catch {
    return null;
  }
}

export function persistJourneySave(save: JourneySave) {
  const serialize = (keep: number) => JSON.stringify({ ...save, phone: trimSnapshots(save.phone, keep) });
  for (const keep of [MAX_PERSISTED_SNAPSHOTS, 6, 2, 0]) {
    try { window.localStorage.setItem(SAVE_KEY, serialize(keep)); return true; } catch { /* retry smaller */ }
  }
  return false;
}

export function clearJourneySave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
}
