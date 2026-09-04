/* An entity is an id plus optional components. Plain objects: a scene has a few dozen at most. */
import type { Condition } from "./condition";
import type { EventName } from "./bus";
import type { Cost, EntityId, EntityState, EntryId, FlagKey, FlagValue, ItemId, SceneId, Transform, Verb } from "./types";
import type { World } from "./world";

export type TransformSource = Transform | ((world: World) => Transform);

export type Sprite = {
  src: string;
  layer?: "back" | "prop" | "figure" | "hand";
  className?: string;
  sizeVh?: number;                 // final on-screen height at distance 10
  swap?: Array<{ when: Condition; src: string; className?: string }>;
};

export type Interactable = {
  verbs: Verb[];
  label: string;
  reveal: number;                  // degrees of gaze proximity before it shows
  cost?: Cost;
  requires?: Condition;            // not met: the hotspot shows, but her hand comes back on its own (no text)
  once?: boolean;
  keyHint?: string;
};

export type Collectible = { item: ItemId; consumesEntity?: boolean };

export type Readable = {
  kind: "plaque" | "sign" | "note" | "carving" | "timetable" | "screen" | "board";
  title: string;
  lines: readonly string[];
  entry?: EntryId;
  minutes: number;
};

export type Exit = {
  to: SceneId;
  kind: "walk" | "run" | "back" | "detour";
  label: string;
  minutes: number;
  condition?: Condition;
  battery?: number;
};

export type TriggerSource =
  | { on: "enter" }
  | { on: "gaze"; dwell: number }
  | { on: "minute"; at: number }
  | { on: "idle"; seconds: number }
  | { on: "event"; name: EventName }
  | { on: "flag"; key: FlagKey; eq: FlagValue };

export type Trigger = { source: TriggerSource; when?: Condition; once?: boolean; tag: string };

export type Holdable = { ms: number; scaleWith?: Array<"fear" | "fatigue" | "lamp">; releaseLine?: string };
export type Gazeable = { radius: number; dwell: number };
export type Blaze = { real: boolean; scene?: SceneId };

export type EntityDef = {
  id: EntityId;
  transform: TransformSource;
  tags?: readonly string[];
  visible?: Condition;
  enabled?: Condition;
  sprite?: Sprite;
  interactable?: Interactable;
  collectible?: Collectible;
  readable?: Readable;
  exit?: Exit;
  trigger?: Trigger;
  hold?: Holdable;
  gaze?: Gazeable;
  blaze?: Blaze;
  className?: string;
};

/** What the view renders each revision: visibility already decided. */
export type EntityView = {
  id: EntityId;
  transform: Transform;
  reveal: number;
  label?: string;
  verbs?: readonly Verb[];
  sprite?: { src: string; className: string; sizeVh?: number };
  disabled: boolean;
  kind: "hotspot" | "prop" | "exit" | "hold" | "blaze";
  className?: string;
  keyHint?: string;
};

export type EntityHandle = {
  readonly state: EntityState;
  patch(next: Partial<EntityState>): void;
  set(key: string, value: FlagValue): void;
  get<T extends FlagValue>(key: string, fallback: T): T;
};

export const resolveTransform = (world: World, source: TransformSource): Transform => typeof source === "function" ? source(world) : source;
