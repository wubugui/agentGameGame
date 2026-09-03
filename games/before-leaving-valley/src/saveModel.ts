import { isJourneyScene, type JourneyScene } from "./journeyModel";
import type { LookPoint } from "./PixiJourney";
import type { PhoneState } from "./phoneModel";

export type SavedRoute = "open" | "stream" | null;

export type JourneyInteractionState = {
  chainStep: number;
  rubbleStep: number;
  letterRead: boolean;
  nightStep: number;
  phoneLost: boolean;
  rescuersMet: boolean;
  rescueStep: number;
  searchStep: number;
  phoneReturned: boolean;
  endingGallerySeen: boolean;
};

export type JourneySave = {
  version: 2;
  savedAt: string;
  phase: JourneyScene;
  scene: JourneyScene;
  sceneProgress: number;
  bagTaken: boolean;
  arrivalProgress: number;
  trailProgress: number;
  route: SavedRoute;
  streamStep: number;
  interactions: JourneyInteractionState;
  look: LookPoint;
  cameraAim: { x: number; y: number };
  cameraZoom: number;
  stagePhotoTaken: boolean;
  phone: PhoneState;
};

// v2: the script, dates and album were rewritten on 2026-09-04; older saves are dropped.
const SAVE_KEY = "before-leaving-valley.journey.v2";

// Photo snapshots are ~40–80 KB data URLs each; keep localStorage well below
// its quota by persisting only the newest ones (older photos fall back to
// asset + position rendering), and dropping all snapshots as a last resort.
const MAX_PERSISTED_SNAPSHOTS = 12;

function trimSnapshots(phone: PhoneState, keep: number): PhoneState {
  if (keep <= 0) {
    return { ...phone, photos: phone.photos.map((photo) => ({ ...photo, snapshot: undefined })) };
  }
  return { ...phone, photos: phone.photos.map((photo, index) => index < keep ? photo : { ...photo, snapshot: undefined }) };
}

export const INITIAL_INTERACTIONS: JourneyInteractionState = {
  chainStep: 0,
  rubbleStep: 0,
  letterRead: false,
  nightStep: 0,
  phoneLost: false,
  rescuersMet: false,
  rescueStep: 0,
  searchStep: 0,
  phoneReturned: false,
  endingGallerySeen: false,
};

function isPhoneState(value: unknown): value is PhoneState {
  if (!value || typeof value !== "object") return false;
  const phone = value as Partial<PhoneState>;
  return Array.isArray(phone.photos) && typeof phone.minuteOfDay === "number" && typeof phone.battery === "number";
}

function migrateLegacySave(raw: Record<string, unknown>): JourneySave | null {
  if (raw.version !== 1 || !isJourneyScene(raw.scene) || !isJourneyScene(raw.phase) || !isPhoneState(raw.phone)) return null;
  const arrivalProgress = typeof raw.arrivalProgress === "number" ? raw.arrivalProgress : 0;
  const trailProgress = typeof raw.trailProgress === "number" ? raw.trailProgress : 0;
  return {
    version: 2,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
    phase: raw.phase,
    scene: raw.scene,
    sceneProgress: raw.scene === "arrival" ? arrivalProgress : raw.scene === "trail" ? trailProgress : 0,
    bagTaken: raw.bagTaken === true,
    arrivalProgress,
    trailProgress,
    route: raw.route === "open" || raw.route === "stream" ? raw.route : null,
    streamStep: typeof raw.streamStep === "number" ? raw.streamStep : 0,
    interactions: { ...INITIAL_INTERACTIONS },
    look: raw.look && typeof raw.look === "object" ? raw.look as LookPoint : { x: 0, y: 0 },
    cameraAim: raw.cameraAim && typeof raw.cameraAim === "object" ? raw.cameraAim as { x: number; y: number } : { x: 50, y: 50 },
    cameraZoom: typeof raw.cameraZoom === "number" ? raw.cameraZoom : 1,
    stagePhotoTaken: raw.stagePhotoTaken === true,
    phone: raw.phone,
  };
}

export function loadJourneySave(): JourneySave | null {
  try {
    const serialized = window.localStorage.getItem(SAVE_KEY);
    if (!serialized) return null;
    const raw = JSON.parse(serialized) as Record<string, unknown>;
    if (raw.version === 1) return migrateLegacySave(raw);
    if (raw.version !== 2 || !isJourneyScene(raw.phase) || !isJourneyScene(raw.scene) || !isPhoneState(raw.phone)) return null;
    return {
      ...(raw as unknown as JourneySave),
      interactions: { ...INITIAL_INTERACTIONS, ...((raw.interactions ?? {}) as Partial<JourneyInteractionState>) },
    };
  } catch {
    return null;
  }
}

export function persistJourneySave(save: JourneySave) {
  const serialize = (keep: number) => JSON.stringify({ ...save, phone: trimSnapshots(save.phone, keep) });
  for (const keep of [MAX_PERSISTED_SNAPSHOTS, 0]) {
    try {
      window.localStorage.setItem(SAVE_KEY, serialize(keep));
      return true;
    } catch {
      // Quota exceeded; retry with a smaller payload.
    }
  }
  return false;
}

export function clearJourneySave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage can be unavailable in a restricted browser; the game remains playable.
  }
}
