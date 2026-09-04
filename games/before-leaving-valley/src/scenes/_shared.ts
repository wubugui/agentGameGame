/* Entity factories shared by scenes. */
import type { Condition } from "../engine/condition";
import { entityIs, not } from "../engine/condition";
import type { EntityDef, Exit, Readable } from "../engine/entity";
import type { EntityId, SceneId, Transform } from "../engine/types";
import type { World } from "../engine/world";

/** A red-white-red blaze on a stone (or something that looks like one). The label never gives it away. */
export const blaze = (id: EntityId, transform: Transform, real: boolean, extra: Partial<EntityDef> = {}): EntityDef => ({
  id, transform, blaze: { real },
  className: "blaze-hotspot",
  sprite: { src: real ? "sprites/blaze-red-white.webp" : "sprites/blaze-false.webp", layer: "prop", sizeVh: 4 },
  interactable: { verbs: ["inspect"], label: "石头上的记号", reveal: 12, cost: { minutes: 0 } },
  visible: not(entityIs(id, "read")),
  ...extra,
});

/** The way on. Shows only once the scene's exitWhen holds; a wide reveal so it is never hard to find. */
export const goArrow = (id: EntityId, transform: Transform, exit: Omit<Exit, "condition"> & { condition?: Condition }): EntityDef => ({
  id, transform, exit, tags: ["exit"], className: "go-hotspot",
  interactable: { verbs: ["inspect"], label: exit.label, reveal: 24 },
});

/** A way back: always available. */
export const backArrow = (id: EntityId, transform: Transform, to: SceneId, label = "回头", minutes = 0): EntityDef => ({
  id, transform, exit: { to, kind: "back", label, minutes }, tags: ["exit"], className: "go-hotspot back-hotspot",
  interactable: { verbs: ["inspect"], label, reveal: 24 },
});

/** A wrong turn inside a scene: walk over, look, come back. Costs minutes; never a dead end. */
export const wrongWay = (id: EntityId, transform: Transform, label: string, minutes: number, line: string, extra: Partial<EntityDef> = {}): EntityDef => ({
  id, transform, className: "wrong-hotspot", tags: ["wrongWay", line],
  interactable: { verbs: ["inspect"], label, reveal: 18, cost: { minutes }, once: true },
  ...extra,
});

/** Something to read up close. */
export const readable = (id: EntityId, transform: Transform, label: string, readable: Readable, extra: Partial<EntityDef> = {}): EntityDef => ({
  id, transform, readable,
  interactable: { verbs: ["read"], label, reveal: 12, cost: { minutes: 0 } },
  ...extra,
});

/** Something to look at: one line when she does, nothing more. */
export const lookAt = (id: EntityId, transform: Transform, label: string, minutes = 1, extra: Partial<EntityDef> = {}): EntityDef => ({
  id, transform,
  interactable: { verbs: ["inspect", "photograph"], label, reveal: 12, cost: { minutes } },
  ...extra,
});

/** A prop she can pick up. */
export const pickup = (id: EntityId, transform: Transform, label: string, item: EntityDef["collectible"] extends infer C ? (C extends { item: infer I } ? I : never) : never, sprite: string, sizeVh = 8, extra: Partial<EntityDef> = {}): EntityDef => ({
  id, transform, collectible: { item, consumesEntity: true },
  sprite: { src: sprite, layer: "prop", sizeVh },
  interactable: { verbs: ["take"], label, reveal: 12, cost: { minutes: 1 } },
  visible: not(entityIs(id, "taken")),
  ...extra,
});

/** A decorative sprite placed on the painting. */
export const prop = (id: EntityId, transform: Transform, sprite: string, sizeVh: number, extra: Partial<EntityDef> = {}): EntityDef => ({
  id, transform, sprite: { src: sprite, layer: "prop", sizeVh }, ...extra,
});

export const offset = (t: Transform, dYaw: number, dPitch: number): Transform => ({ ...t, yaw: t.yaw + dYaw, pitch: t.pitch + dPitch });

export const WINDY_SCENES: SceneId[] = ["cable", "exit", "summit", "plateau", "hutView", "ledge"];
export const windy = (world: World) => WINDY_SCENES.includes(world.state.sceneId);
export const isNight = (world: World) => world.state.clock.day === 1 && world.state.clock.minuteOfDay >= world.state.clock.sunsetMinute;
