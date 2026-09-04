/* The wall: cable anchors, and the crack's holds. Coordinates verified against the paintings. */
import type { Transform } from "../engine/types";

export const CABLE_ANCHORS: Transform[] = [
  { yaw: 9, pitch: -20 }, { yaw: 5, pitch: -11 }, { yaw: 1, pitch: -3 }, { yaw: -1, pitch: 6 }, { yaw: -3, pitch: 13 },
];

export const CRACK_HOLDS: Array<Transform & { id: string; order: number | null; label: string; sprite: string }> = [
  { id: "hold-step", yaw: -16, pitch: -13, order: 0, label: "岩阶", sprite: "sprites/hold-step.webp" },
  { id: "hold-edge", yaw: 21, pitch: -6, order: 1, label: "裂缝边缘", sprite: "sprites/hold-edge.webp" },
  { id: "hold-knob", yaw: 2, pitch: 2, order: 2, label: "石突", sprite: "sprites/hold-knob.webp" },
  { id: "hold-slot", yaw: 26, pitch: 12, order: 3, label: "裂缝里", sprite: "sprites/hold-slot.webp" },
  { id: "hold-flake", yaw: -11, pitch: 19, order: null, label: "一片薄石", sprite: "sprites/hold-flake.webp" },
  { id: "hold-groove", yaw: -18, pitch: 10, order: null, label: "一道浅槽", sprite: "sprites/hold-groove.webp" },
];
