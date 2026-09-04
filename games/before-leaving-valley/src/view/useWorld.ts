import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { GameState } from "../engine/types";
import type { World } from "../engine/world";

export const WorldContext = createContext<World | null>(null);

export function useWorldContext(): World {
  const world = useContext(WorldContext);
  if (!world) throw new Error("WorldContext missing");
  return world;
}

/** Subscribe to a coarse slice of state. Re-renders only when the selected value changes. */
export function useWorldValue<T>(select: (state: GameState, world: World) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const world = useWorldContext();
  const cache = useRef<{ revision: number; value: T; primed: boolean }>({ revision: -1, value: undefined as T, primed: false });
  const snapshot = () => {
    if (cache.current.revision !== world.revision || !cache.current.primed) {
      const next = select(world.state, world);
      if (!cache.current.primed || !equal(cache.current.value, next)) cache.current.value = next;
      cache.current.revision = world.revision;
      cache.current.primed = true;
    }
    return cache.current.value;
  };
  return useSyncExternalStore(world.subscribe, snapshot, snapshot);
}

export const shallowArray = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((value, index) => value === b[index]);
