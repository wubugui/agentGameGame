/* Conditions are data: the same condition decides whether an entity exists, whether it is enabled, and whether a scene can be left. */
import type { EntityId, EntityState, EntryId, FlagKey, FlagValue, GameState, ItemId, SceneId } from "./types";

export type Condition =
  | { kind: "flag"; key: FlagKey; eq?: FlagValue; gte?: number; lt?: number }
  | { kind: "has"; item: ItemId }
  | { kind: "worn"; item: ItemId }
  | { kind: "held"; item: ItemId }
  | { kind: "knows"; entry: EntryId }
  | { kind: "entity"; id: EntityId; is: keyof EntityState; value?: FlagValue }
  | { kind: "visited"; scene: SceneId }
  | { kind: "beforeMinute"; minute: number }
  | { kind: "afterMinute"; minute: number }
  | { kind: "light"; gte?: number; lt?: number }
  | { kind: "fatigue"; gte?: number; lt?: number }
  | { kind: "fear"; gte?: number; lt?: number }
  | { kind: "day"; eq: 1 | 2 | 3 }
  | { kind: "all"; of: Condition[] }
  | { kind: "any"; of: Condition[] }
  | { kind: "not"; of: Condition };

const range = (value: number, gte?: number, lt?: number) => (gte === undefined || value >= gte) && (lt === undefined || value < lt);

/** Daylight 0..1: >0 from day into dusk, 0 after sunset. The only source of light in the game. */
export function lightOf(state: GameState): number {
  const remaining = state.clock.sunsetMinute - state.clock.minuteOfDay;
  return Math.max(0, Math.min(1, remaining / 90));
}

export function testCondition(state: GameState, condition?: Condition): boolean {
  if (!condition) return true;
  switch (condition.kind) {
    case "flag": {
      const value = state.flags[condition.key] ?? null;
      if (condition.eq !== undefined) return value === condition.eq;
      if (condition.gte !== undefined) return typeof value === "number" && value >= condition.gte;
      if (condition.lt !== undefined) return typeof value === "number" ? value < condition.lt : true;
      return Boolean(value);
    }
    case "has": return state.inventory.items.includes(condition.item);
    case "worn": return state.inventory.worn.includes(condition.item);
    case "held": return state.inventory.hands.includes(condition.item);
    case "knows": return state.journal.entries.includes(condition.entry);
    case "entity": {
      const entity = state.scenes[state.sceneId]?.entities[condition.id];
      const value = entity ? entity[condition.is] : undefined;
      return condition.value === undefined ? Boolean(value) : value === condition.value;
    }
    case "visited": return Boolean(state.scenes[condition.scene]?.visited);
    case "beforeMinute": return state.clock.minuteOfDay < condition.minute;
    case "afterMinute": return state.clock.minuteOfDay >= condition.minute;
    case "light": return range(lightOf(state), condition.gte, condition.lt);
    case "fatigue": return range(state.body.fatigue, condition.gte, condition.lt);
    case "fear": return range(state.body.fear, condition.gte, condition.lt);
    case "day": return state.clock.day === condition.eq;
    case "all": return condition.of.every((c) => testCondition(state, c));
    case "any": return condition.of.some((c) => testCondition(state, c));
    case "not": return !testCondition(state, condition.of);
    default: return true;
  }
}

/* Small builders so scene files read like sentences. */
export const flag = (key: FlagKey, opts: { eq?: FlagValue; gte?: number; lt?: number } = {}): Condition => ({ kind: "flag", key, ...opts });
export const has = (item: ItemId): Condition => ({ kind: "has", item });
export const worn = (item: ItemId): Condition => ({ kind: "worn", item });
export const knows = (entry: EntryId): Condition => ({ kind: "knows", entry });
export const not = (of: Condition): Condition => ({ kind: "not", of });
export const all = (...of: Condition[]): Condition => ({ kind: "all", of });
export const any = (...of: Condition[]): Condition => ({ kind: "any", of });
export const entityIs = (id: EntityId, is: keyof EntityState, value?: FlagValue): Condition => ({ kind: "entity", id, is, value });
export const after = (minute: number): Condition => ({ kind: "afterMinute", minute });
export const before = (minute: number): Condition => ({ kind: "beforeMinute", minute });
