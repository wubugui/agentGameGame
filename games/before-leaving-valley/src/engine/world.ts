/* World = serializable GameState + event bus + runtime. No React, no three. */
import { createInitialPhoneState, type PhoneState } from "../phoneModel";
import { DEFAULT_SETTINGS, type GameSettings } from "../settings";
import { createBus, type EventBus } from "./bus";
import type { Command, CommandHandler, CommandType } from "./command";
import type { EntityHandle } from "./entity";
import { seeded } from "./rng";
import type { EntityId, EntityState, FlagKey, FlagValue, GameState, GazePoint, ImpulseKind, SceneId } from "./types";

export const SUNSET = 20 * 60 + 15;
export const LAST_LIGHT = 21 * 60 + 5;
export const START_MINUTE = 9 * 60 + 40;

export type StageHandle = { kick: (kind: ImpulseKind, strength?: number, dir?: { yaw: number; pitch: number }) => void };

export type ViewRuntime = {
  id: EntityId;
  node: HTMLElement | null;
  transform: { yaw: number; pitch: number; distance: number };
  gazing: boolean;
  dwell: number;
  fired: boolean;
};

export type Runtime = {
  rng: () => number;
  stage: StageHandle | null;
  sound: unknown;                        // Soundscape, owned by AudioSystem
  timers: Set<number>;
  sceneUnsubs: Array<() => void>;
  now: number;
  gaze: GazePoint;
  look: { x: number; y: number };
  gazeMoved: boolean;
  stillFor: number;
  waited: boolean;
  views: Map<EntityId, ViewRuntime>;
  nodes: Map<EntityId, HTMLElement>;
  forceReveal: boolean;
  noSave: boolean;
  hold: { entity: EntityId; start: number; required: number } | null;
  growling: boolean;
  handlers: Map<CommandType, Array<CommandHandler<CommandType>>>;
  queue: Command[];
  log: string[];
  headless: boolean;
  booted: boolean;                       // dev params applied / world:ready emitted (once per page)
  hasSave: boolean;
};

export type World = {
  readonly state: GameState;
  readonly bus: EventBus;
  readonly rt: Runtime;
  revision: number;
  set<K extends keyof GameState>(key: K, value: GameState[K]): void;
  patch<K extends keyof GameState>(key: K, patch: Partial<GameState[K]>): void;
  flag<T extends FlagValue>(key: FlagKey, fallback: T): T;
  setFlag(key: FlagKey, value: FlagValue): void;
  bump(key: FlagKey, delta: number): number;
  entity(id: EntityId, scene?: SceneId): EntityHandle;
  dispatch(command: Command): void;
  handle<T extends CommandType>(type: T, fn: CommandHandler<T>): () => void;
  emit: EventBus["emit"];
  on: EventBus["on"];
  tick(dt: number, gaze: GazePoint): void;
  subscribe(listener: () => void): () => void;
  notify(): void;
  after(ms: number, fn: () => void): number;
  sceneUnsub(fn: () => void): void;
  markSceneEntered(scene: SceneId): void;
};

export type System = {
  id: string;
  order: number;
  init?(world: World): void | (() => void);
  tick?(world: World, dt: number): void;
};

export function createInitialState(settings: GameSettings = DEFAULT_SETTINGS, phone: PhoneState = createInitialPhoneState()): GameState {
  return {
    version: 5,
    phase: "title",
    sceneId: "roadside",
    previousSceneId: null,
    clock: { day: 1, date: { year: 2025, month: 7, day: 30 }, minuteOfDay: START_MINUTE, sunsetMinute: SUNSET, lastLightMinute: LAST_LIGHT },
    body: { fatigue: 0, fear: 0, breath: "calm", slips: 0, adrenaline: false },
    power: { phone: phone.battery, camera: 100, lamp: 1, lampMode: null, lampOut: false },
    inventory: { items: ["helmet", "lanyard", "gloves", "backpack", "cap", "camera360", "phone", "fillLight", "chocolate", "paperMap", "pencil", "notebook", "redJacket"], worn: ["backpack", "cap"], hands: [], packDirt: 0 },
    journal: { entries: [], mapLegs: {}, estimates: {}, objective: null, blazesLearned: false },
    flags: {},
    scenes: {},
    phone,
    camera: { aimX: 50, aimY: 50, zoom: 1 },
    settings,
    stats: { minutesSpent: 0, photos: 0, blazesFound: 0, blazesMissed: 0, fallbackLines: 0 },
    ui: { overlay: null, overlayData: {}, phoneOpen: false, phoneTab: "home", menuOpen: false, travel: null, line: null, flash: null, chapter: null, reading: null, creditLine: 0 },
  };
}

export function createWorld(options: { systems: System[]; state?: GameState; seed?: number; headless?: boolean }): World {
  const bus = createBus();
  let state = options.state ?? createInitialState();
  const listeners = new Set<() => void>();
  let dirty = false;
  const rt: Runtime = {
    rng: seeded(options.seed ?? 42), stage: null, sound: null, timers: new Set(), sceneUnsubs: [], now: 0,
    gaze: { yaw: 0, pitch: 0 }, look: { x: 0, y: 0 }, gazeMoved: false, stillFor: 0, waited: false,
    views: new Map(), nodes: new Map(), forceReveal: false, noSave: false, hold: null, growling: false,
    handlers: new Map(), queue: [], log: [], headless: Boolean(options.headless), booted: false, hasSave: false,
  };
  const disposers: Array<() => void> = [];
  let lastGaze = { yaw: 0, pitch: 0 };

  const world: World = {
    get state() { return state; },
    bus, rt, revision: 0,
    set(key, value) { state = { ...state, [key]: value }; dirty = true; },
    patch(key, patch) { state = { ...state, [key]: { ...(state[key] as object), ...patch } }; dirty = true; },
    flag(key, fallback) { const value = state.flags[key]; return (value === undefined || value === null ? fallback : value) as typeof fallback; },
    setFlag(key, value) { if (state.flags[key] === value) return; state = { ...state, flags: { ...state.flags, [key]: value } }; dirty = true; bus.emit("flag:set", { key, value }); },
    bump(key, delta) { const next = Number(state.flags[key] ?? 0) + delta; world.setFlag(key, next); return next; },
    entity(id, scene = state.sceneId) {
      const read = (): EntityState => state.scenes[scene]?.entities[id] ?? {};
      const write = (next: EntityState) => {
        const current = state.scenes[scene] ?? { visited: true, entered: state.clock.minuteOfDay, entities: {} };
        state = { ...state, scenes: { ...state.scenes, [scene]: { ...current, entities: { ...current.entities, [id]: next } } } };
        dirty = true;
      };
      return {
        get state() { return read(); },
        patch(next) { write({ ...read(), ...next }); },
        set(key, value) { const current = read(); write({ ...current, data: { ...(current.data ?? {}), [key]: value } }); },
        get(key, fallback) { const value = read().data?.[key]; return (value === undefined ? fallback : value) as typeof fallback; },
      };
    },
    dispatch(command) { rt.queue.push(command); },
    handle(type, fn) {
      const list = rt.handlers.get(type) ?? [];
      list.push(fn as unknown as CommandHandler<CommandType>);
      rt.handlers.set(type, list);
      return () => { const current = rt.handlers.get(type) ?? []; rt.handlers.set(type, current.filter((f) => f !== (fn as unknown))); };
    },
    emit: bus.emit,
    on: bus.on,
    tick(dt, gaze) {
      rt.gazeMoved = Math.abs(gaze.yaw - lastGaze.yaw) > 0.05 || Math.abs(gaze.pitch - lastGaze.pitch) > 0.05;
      lastGaze = { yaw: gaze.yaw, pitch: gaze.pitch };
      rt.gaze = gaze;
      for (const system of options.systems) system.tick?.(world, dt);
      if (dirty) world.notify();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify() { dirty = false; world.revision += 1; listeners.forEach((fn) => fn()); },
    after(ms, fn) {
      const id = window.setTimeout(() => { rt.timers.delete(id); fn(); if (dirty) world.notify(); }, ms);
      rt.timers.add(id);
      return id;
    },
    sceneUnsub(fn) { rt.sceneUnsubs.push(fn); },
    markSceneEntered(scene) {
      const current = state.scenes[scene];
      state = { ...state, scenes: { ...state.scenes, [scene]: { visited: true, entered: current?.entered ?? state.clock.minuteOfDay, entities: current?.entities ?? {} } } };
      dirty = true;
    },
  };

  // The input system: drain the command queue at the head of each tick.
  const drain = () => {
    let guard = 0;
    while (rt.queue.length && guard < 64) {
      const command = rt.queue.shift()!;
      guard += 1;
      const handlers = rt.handlers.get(command.type);
      if (!handlers || handlers.length === 0) { if (import.meta.env.DEV) console.warn("[world] unhandled command", command); continue; }
      for (const fn of handlers) { try { fn(command); } catch (error) { console.error("[world] command failed", command, error); } }
    }
  };
  options.systems.unshift({ id: "input", order: 0, tick: drain });
  options.systems.sort((a, b) => a.order - b.order);
  for (const system of options.systems) { const dispose = system.init?.(world); if (dispose) disposers.push(dispose); }
  (world as { dispose?: () => void }).dispose = () => { disposers.forEach((fn) => fn()); rt.timers.forEach((id) => window.clearTimeout(id)); };
  return world;
}

/** Replace the whole state (load / new game). Scene subscriptions are torn down by the caller. */
export function replaceState(world: World, next: GameState) {
  for (const key of Object.keys(next) as Array<keyof GameState>) world.set(key, next[key]);
}
