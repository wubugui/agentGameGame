/* Typed event bus. emit() during a handler queues FIFO and the outermost emit drains it: deterministic order, no recursion. */
import type { Ambience } from "../soundscape";
import type { ContactId } from "../phoneModel";
import type { PhoneTab } from "../Phone";
import type { Cost, EntityId, EntryId, FlagKey, FlagValue, GameState, ImpulseKind, ItemId, SceneId, SfxName, Transform, Verb } from "./types";

export type EventMap = {
  "world:ready": { save: boolean };
  "flow:phase": { phase: GameState["phase"] };
  "scene:enter": { scene: SceneId; from: SceneId | null; warped: boolean };
  "scene:exit": { scene: SceneId; to: SceneId };
  "travel:begin": { from: SceneId; to: SceneId; run: boolean; ms: number };
  "travel:arrive": { scene: SceneId };

  "gaze:enter": { entity: EntityId; degrees: number };
  "gaze:leave": { entity: EntityId };
  "gaze:dwell": { entity: EntityId; ms: number };
  "input:wait": { seconds: number };
  "hold:progress": { entity: EntityId; progress: number };
  "hold:complete": { entity: EntityId };
  "hold:release": { entity: EntityId; progress: number };

  "interact:attempt": { entity: EntityId; verb: Verb };
  "interact:done": { entity: EntityId; verb: Verb; cost: Cost };
  "interact:refused": { entity: EntityId; verb: Verb; reason: "condition" | "hands" | "gone" };

  "clock:advance": { minutes: number; reason: string };
  "clock:light": { light: number; previous: number };
  "clock:mark": { minute: number; tag: string };
  "body:fatigue": { delta: number; reason?: string };
  "body:fear": { delta: number; reason?: string };
  "body:slip": { entity: EntityId | null; severity: number };
  "body:rest": { seconds: number };
  "body:adrenaline": { on: boolean };
  "power:drain": { source: "phone" | "camera" | "lamp"; value: number; reason: string };
  "power:dead": { source: "phone" | "camera" | "lamp" };
  "lamp:mode": { mode: "wide" | "narrow" };

  "item:gain": { item: ItemId; from: EntityId | null };
  "item:lose": { item: ItemId; reason: string };
  "item:equip": { item: ItemId };
  "item:stow": { item: ItemId };
  "item:use": { item: ItemId };
  "journal:entry": { entry: EntryId; source: EntityId | null };
  "journal:objective": { text: string | null };
  "blaze:confirm": { entity: EntityId; real: boolean };
  "flag:set": { key: FlagKey; value: FlagValue };

  "phone:open": { tab: PhoneTab };
  "phone:close": Record<string, never>;
  "phone:photo": { scene: SceneId; kind?: "letter" | "back" };
  "phone:message": { contact: ContactId; text: string };
  "phone:lost": { minute: number };
  "phone:returned": Record<string, never>;

  "ui:action": { id: string; value?: FlagValue };
  "overlay": { id: string | null };

  "say": { line: string; priority?: number; delay?: number; tag?: string };
  "flash": { text: string };
  "sfx": { name: SfxName; pan?: number; strength?: number };
  "ambience": { overrides?: Partial<Ambience> };
  "music": { track: "day" | "warm" | "end" | null };
  "camera:impulse": { kind: ImpulseKind; strength?: number; dir?: { yaw: number; pitch: number } };
  "hand:reach": { transform: Transform; kind: "grip" | "carabiner"; hold: boolean };
  "fx": { name: "dust" | "shout" | "brake" | "flashlight" | "gust"; strength?: number };

  "save:written": { scene: SceneId };
  "save:loaded": { scene: SceneId };
  "ending:begin": Record<string, never>;
};

export type EventName = keyof EventMap;
export type Listener<K extends EventName> = (payload: EventMap[K]) => void;

export interface EventBus {
  on<K extends EventName>(name: K, fn: Listener<K>): () => void;
  once<K extends EventName>(name: K, fn: Listener<K>): () => void;
  emit<K extends EventName>(name: K, payload: EventMap[K]): void;
}

export function createBus(): EventBus {
  const listeners = new Map<EventName, Set<Listener<EventName>>>();
  const queue: Array<{ name: EventName; payload: unknown }> = [];
  let draining = false;
  const on: EventBus["on"] = (name, fn) => {
    let set = listeners.get(name);
    if (!set) { set = new Set(); listeners.set(name, set); }
    set.add(fn as Listener<EventName>);
    return () => { set?.delete(fn as Listener<EventName>); };
  };
  const once: EventBus["once"] = (name, fn) => {
    const off = on(name, ((payload: EventMap[typeof name]) => { off(); fn(payload); }) as Listener<typeof name>);
    return off;
  };
  const emit: EventBus["emit"] = (name, payload) => {
    queue.push({ name, payload });
    if (draining) return;
    draining = true;
    let guard = 0;
    try {
      while (queue.length) {
        const next = queue.shift()!;
        guard += 1;
        if (guard > 512) { throw new Error(`[bus] event storm at ${String(next.name)}`); }
        const set = listeners.get(next.name);
        if (!set) continue;
        for (const fn of Array.from(set)) {
          try { fn(next.payload as EventMap[EventName]); } catch (error) { console.error(`[bus] ${String(next.name)} listener failed`, error); }
        }
      }
    } finally { draining = false; queue.length = 0; }
  };
  return { on, once, emit };
}
