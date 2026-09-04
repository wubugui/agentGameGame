/* A scene is data (entities) plus a script that registers handlers on the bus. */
import type { Command } from "./command";
import type { Ambience } from "../soundscape";
import type { Condition } from "./condition";
import type { EventBus } from "./bus";
import type { EntityDef, EntityHandle, Sprite } from "./entity";
import { resolveTransform } from "./entity";
import type { BodyMode, Cost, EntityId, EntryId, FlagKey, FlagValue, ImpulseKind, ItemId, SceneId, SfxName, SoundMaterial, Transform, Verb } from "./types";
import type { World } from "./world";

/** One step of a headless walkthrough: a command, or a pause in milliseconds. Tools only; never used by the game. */
export type WalkStep = Command | { wait: number };

export type Weather = { motes?: "pollen" | "dust" | "night" | "grit"; clouds?: boolean; gusty?: boolean; windPan?: number };

export type SceneDef = {
  id: SceneId;
  day: 1 | 2 | 3;
  place: string;
  elevation: string;
  painting: string;
  body: BodyMode;
  material: SoundMaterial;
  ambience: Ambience;
  weather?: Weather;
  arriveAt?: number;
  chapter?: { eyebrow: string; title: string };
  interior?: boolean;
  idleLook?: boolean;
  /** A single fallback line if the player does nothing for 2 s after arriving (at most three per game). */
  fallback?: string;
  entities: EntityDef[];
  exitWhen?: Condition;
  script?: (ctx: SceneCtx) => void | (() => void);
  seed?: (world: World) => void;
  /** Sprites drawn as layers on the painting that are never interactive (e.g. the sun, cloud shadows). */
  layers?: Sprite[];
  /** The fastest legitimate way through this scene, ending with the command that leaves it (tools/replay.mjs). */
  walkthrough?: WalkStep[];
  /** Named alternatives (e.g. "detour", "wrong"): same shape, different route. */
  variants?: Record<string, WalkStep[]>;
};

export type SceneCtx = {
  world: World;
  scene: SceneDef;
  on: EventBus["on"];
  onInteract(entity: EntityId, fn: (verb: Verb) => void): void;
  onGaze(entity: EntityId, fn: () => void): void;
  onMark(tag: string, fn: () => void): void;
  onHold(entity: EntityId, fn: () => void): void;
  onRelease(entity: EntityId, fn: (progress: number) => void): void;
  onAction(id: string, fn: (value?: FlagValue) => void): void;
  onWait(fn: (seconds: number) => void): void;
  onEnter(fn: (from: SceneId | null) => void): void;
  say(line: string, opts?: { delay?: number; priority?: number; tag?: string }): void;
  flash(text: string): void;
  sfx(name: SfxName, pan?: number, strength?: number): void;
  kick(kind: ImpulseKind, strength?: number, dir?: { yaw: number; pitch: number }): void;
  hand(transform: Transform, kind?: "grip" | "carabiner", hold?: boolean): void;
  fx(name: "dust" | "shout" | "brake" | "flashlight" | "gust", strength?: number): void;
  spend(cost: Cost, reason: string): void;
  flag: World["flag"];
  setFlag: World["setFlag"];
  bump: World["bump"];
  entity(id: EntityId): EntityHandle;
  give(item: ItemId, from?: EntityId | null): void;
  lose(item: ItemId, reason: string): void;
  learn(entry: EntryId, source?: EntityId | null): void;
  after(ms: number, fn: () => void): void;
  travel(scene: SceneId, opts?: { run?: boolean; minutes?: number; ms?: number }): void;
  open(overlay: NonNullable<World["state"]["ui"]["overlay"]>, data?: Record<string, FlagValue>): void;
  close(): void;
  read(entity: EntityId): void;
  transformOf(entity: EntityId): Transform;
  minute(): number;
  light(): number;
};

const registry: Partial<Record<SceneId, SceneDef>> = {};
export const SCENES = registry as Record<SceneId, SceneDef>;

export function defineScene(def: SceneDef): SceneDef {
  registry[def.id] = def;
  return def;
}

export function findEntity(scene: SceneDef, id: EntityId): EntityDef | undefined {
  return scene.entities.find((entity) => entity.id === id);
}

export function makeSceneCtx(world: World, scene: SceneDef): SceneCtx {
  const on: EventBus["on"] = (name, fn) => { const off = world.on(name, fn); world.sceneUnsub(off); return off; };
  const ctx: SceneCtx = {
    world, scene, on,
    onInteract(entity, fn) { on("interact:done", (payload) => { if (payload.entity === entity) fn(payload.verb); }); },
    onGaze(entity, fn) { on("gaze:dwell", (payload) => { if (payload.entity === entity) fn(); }); },
    onMark(tag, fn) { on("clock:mark", (payload) => { if (payload.tag === tag) fn(); }); },
    onHold(entity, fn) { on("hold:complete", (payload) => { if (payload.entity === entity) fn(); }); },
    onRelease(entity, fn) { on("hold:release", (payload) => { if (payload.entity === entity) fn(payload.progress); }); },
    onAction(id, fn) { on("ui:action", (payload) => { if (payload.id === id) fn(payload.value); }); },
    onWait(fn) { on("input:wait", (payload) => fn(payload.seconds)); },
    onEnter(fn) { on("scene:enter", (payload) => { if (payload.scene === scene.id) fn(payload.from); }); },
    say(line, opts) { world.emit("say", { line, ...opts }); },
    flash(text) { world.emit("flash", { text }); },
    sfx(name, pan, strength) { world.emit("sfx", { name, pan, strength }); },
    kick(kind, strength, dir) { world.emit("camera:impulse", { kind, strength, dir }); },
    hand(transform, kind = "grip", hold = false) { world.emit("hand:reach", { transform, kind, hold }); },
    fx(name, strength) { world.emit("fx", { name, strength }); },
    spend(cost, reason) { spend(world, cost, reason); },
    flag: world.flag, setFlag: world.setFlag, bump: world.bump,
    entity(id) { return world.entity(id); },
    give(item, from = null) { world.emit("item:gain", { item, from }); },
    lose(item, reason) { world.emit("item:lose", { item, reason }); },
    learn(entry, source = null) { world.emit("journal:entry", { entry, source }); },
    after(ms, fn) { world.after(ms, fn); },
    travel(target, opts) { world.dispatch({ type: "travel", entity: `__to:${target}:${opts?.run ? "run" : "walk"}:${opts?.minutes ?? 0}` }); },
    open(overlay, data) { world.dispatch({ type: "overlay:open", id: overlay, data }); },
    close() { world.dispatch({ type: "overlay:close" }); },
    read(entity) { world.dispatch({ type: "interact", entity, verb: "read" }); },
    transformOf(entity) { const def = findEntity(scene, entity); return def ? resolveTransform(world, def.transform) : { yaw: 0, pitch: 0 }; },
    minute() { return world.state.clock.minuteOfDay; },
    light() { const remaining = world.state.clock.sunsetMinute - world.state.clock.minuteOfDay; return Math.max(0, Math.min(1, remaining / 90)); },
  };
  return ctx;
}

/** The only settlement point: every cost goes through here; every system watches just its own line. */
export function spend(world: World, cost: Cost, reason: string) {
  if (cost.minutes) world.emit("clock:advance", { minutes: cost.minutes, reason });
  if (cost.battery) world.emit("power:drain", { source: "phone", value: cost.battery, reason });
  if (cost.camera) world.emit("power:drain", { source: "camera", value: cost.camera, reason });
  if (cost.lamp) world.emit("power:drain", { source: "lamp", value: cost.lamp, reason });
  if (cost.fatigue) world.emit("body:fatigue", { delta: cost.fatigue, reason });
  if (cost.fear) world.emit("body:fear", { delta: cost.fear, reason });
}
