/* Save v5: the whole GameState. */
import { createInitialState } from "./world";
import { isItemId, isSceneId, type GameState } from "./types";

export type SaveV5 = { version: 5; savedAt: string; state: GameState };
const KEY = "before-leaving-valley.journey.v5";
const RETIRED = ["before-leaving-valley.journey.v1", "before-leaving-valley.journey.v2", "before-leaving-valley.journey.v3", "before-leaving-valley.journey.v4"];
const SNAPSHOT_STEPS = [12, 6, 2, 0];

function trimSnapshots(state: GameState, keep: number): GameState {
  return { ...state, phone: { ...state.phone, photos: state.phone.photos.map((photo, index) => index < keep ? photo : { ...photo, snapshot: undefined }) } };
}

export function serialize(state: GameState, keep = 12): SaveV5 {
  const clean = trimSnapshots(state, keep);
  return { version: 5, savedAt: new Date().toISOString(), state: { ...clean, ui: createInitialState().ui } };
}

export function hydrate(save: SaveV5): GameState | null {
  if (!save || save.version !== 5 || !save.state) return null;
  const base = createInitialState();
  const state: GameState = { ...base, ...save.state, ui: base.ui };
  state.clock = { ...base.clock, ...save.state.clock };
  state.body = { ...base.body, ...save.state.body };
  state.power = { ...base.power, ...save.state.power };
  state.inventory = { ...base.inventory, ...save.state.inventory, items: (save.state.inventory?.items ?? base.inventory.items).filter(isItemId), worn: (save.state.inventory?.worn ?? []).filter(isItemId), hands: (save.state.inventory?.hands ?? []).filter(isItemId) };
  state.journal = { ...base.journal, ...save.state.journal };
  state.stats = { ...base.stats, ...save.state.stats };
  state.scenes = Object.fromEntries(Object.entries(save.state.scenes ?? {}).filter(([id]) => isSceneId(id))) as GameState["scenes"];
  if (!isSceneId(state.sceneId)) return null;
  if (state.phase === "complete") return null;
  return state;
}

export function loadSave(): GameState | null {
  try {
    RETIRED.forEach((key) => window.localStorage.removeItem(key));
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return hydrate(JSON.parse(raw) as SaveV5);
  } catch { return null; }
}

export function writeSave(state: GameState): boolean {
  for (const keep of SNAPSHOT_STEPS) {
    try { window.localStorage.setItem(KEY, JSON.stringify(serialize(state, keep))); return true; } catch { /* smaller */ }
  }
  return false;
}

export function clearSave() {
  try { window.localStorage.removeItem(KEY); } catch { /* unavailable */ }
}
