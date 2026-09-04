/* The way down: signpost arms, scree footings, forest holds. */
import type { Transform } from "../engine/types";

export const SIGNPOST_ARMS: Array<Transform & { id: string; label: string; correct: boolean; sprite: string }> = [
  { id: "arm-schiavaneis", label: "Val de Schiavaneis · 649", correct: false, yaw: 7.4, pitch: 4.2, sprite: "sprites/arm-schiavaneis.webp" },
  { id: "arm-selva", label: "Piz Selva · 649", correct: false, yaw: 7.4, pitch: -1.5, sprite: "sprites/arm-selva.webp" },
  { id: "arm-boe", label: "Rifugio Boè · 649", correct: false, yaw: 7.4, pitch: -5.6, sprite: "sprites/arm-boe.webp" },
  { id: "arm-lasties", label: "Plan de Roces · Val Lasties 2455 m · 656", correct: true, yaw: 7.4, pitch: -9.8, sprite: "sprites/arm-lasties.webp" },
];

/** Six steps down the scree: a flat stone on the path (steady), fine sand (fast, one in three slides), a big block off the path (safe, slow). */
export const SCREE_STEPS: Array<{ flat: Transform; sand: Transform; block: Transform }> = [
  { flat: { yaw: 6, pitch: -27 }, sand: { yaw: -7, pitch: -26 }, block: { yaw: 19, pitch: -25 } },
  { flat: { yaw: 8, pitch: -19 }, sand: { yaw: 21, pitch: -19 }, block: { yaw: -5, pitch: -18 } },
  { flat: { yaw: 10, pitch: -12 }, sand: { yaw: -3, pitch: -12 }, block: { yaw: 22, pitch: -11 } },
  { flat: { yaw: 12, pitch: -7 }, sand: { yaw: 24, pitch: -8 }, block: { yaw: 0, pitch: -6 } },
  { flat: { yaw: 15, pitch: -3 }, sand: { yaw: 3, pitch: -2 }, block: { yaw: 27, pitch: -2 } },
  { flat: { yaw: 17, pitch: 0 }, sand: { yaw: 28, pitch: 1 }, block: { yaw: 6, pitch: 2 } },
];

export type ForestHold = Transform & { id: string; kind: "root" | "rock" | "log"; label: string; sprite: string };
export const FOREST_STEPS: Record<"forest1" | "forest2", ForestHold[]> = {
  forest1: [
    { id: "f1-root-a", yaw: 29, pitch: -13, kind: "root", label: "树根", sprite: "sprites/root-arch.webp" },
    { id: "f1-rock-a", yaw: -14, pitch: 1, kind: "rock", label: "岩石", sprite: "sprites/rock-step.webp" },
    { id: "f1-rock-b", yaw: 9, pitch: 3, kind: "rock", label: "岩石", sprite: "sprites/rock-step.webp" },
    { id: "f1-root-b", yaw: 34, pitch: -6, kind: "root", label: "树根", sprite: "sprites/root-arch.webp" },
  ],
  forest2: [
    { id: "f2-root-a", yaw: -27, pitch: -21, kind: "root", label: "树根", sprite: "sprites/root-arch.webp" },
    { id: "f2-rock-a", yaw: -15, pitch: -24, kind: "rock", label: "岩石", sprite: "sprites/rock-step.webp" },
    { id: "f2-rock-b", yaw: 22, pitch: -21, kind: "rock", label: "岩石", sprite: "sprites/rock-step.webp" },
    { id: "f2-log", yaw: 11, pitch: 4, kind: "log", label: "倒木", sprite: "" },
  ],
};

export const SEARCH_SPOTS: Array<Transform & { id: string; label: string; line: string; scene: "search" | "searchWall" | "searchPath" }> = [
  { id: "under-boulder", yaw: 11, pitch: -10, label: "巨石下面", line: "巨石下面只有碎石和露水。", scene: "search" },
  { id: "dwarf-pines", yaw: -22, pitch: -12, label: "矮松丛", line: "矮松丛里挂着一小片红色。是我冲锋衣的线头。", scene: "search" },
  { id: "ditch", yaw: 11, pitch: -24, label: "路边的水沟", line: "水沟里只有松针和别人的一个瓶盖。", scene: "search" },
  { id: "wall-bushes", yaw: 24, pitch: 1, label: "石墙下的灌木", line: "对面就是 Sassolungo。灌木翻了一遍。没有。", scene: "searchWall" },
  { id: "wall-rocks", yaw: -10, pitch: -14, label: "乱石", line: "石头翻了个遍。没有。", scene: "searchWall" },
  { id: "wall-log", yaw: 30, pitch: -6, label: "一段倒木", line: "倒木后面是一窝露水。", scene: "searchWall" },
  { id: "path-moss", yaw: -12, pitch: -16, label: "蹭掉的苔藓", line: "昨晚我从这里爬过。苔藓被蹭掉了一块。", scene: "searchPath" },
  { id: "path-knee", yaw: 14, pitch: -20, label: "一个很浅的印", line: "泥地上一个很浅的膝盖印。是我的。", scene: "searchPath" },
];
