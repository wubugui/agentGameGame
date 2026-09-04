export type GameSettings = {
  master: number;   // 0..1 sound effects and ambience
  music: number;    // 0..1 background music
  motion: boolean;  // false = calmer camera, no drifting motes, shorter transitions
};

const KEY = "before-leaving-valley.settings.v1";

const systemPrefersCalm = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const DEFAULT_SETTINGS: GameSettings = { master: 0.9, music: 0.85, motion: !systemPrefersCalm() };

export function loadSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      master: typeof parsed.master === "number" ? Math.min(1, Math.max(0, parsed.master)) : DEFAULT_SETTINGS.master,
      music: typeof parsed.music === "number" ? Math.min(1, Math.max(0, parsed.music)) : DEFAULT_SETTINGS.music,
      motion: typeof parsed.motion === "boolean" ? parsed.motion : !systemPrefersCalm(),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable; settings simply live for this session.
  }
}
