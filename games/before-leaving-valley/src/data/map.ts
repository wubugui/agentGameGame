/* The paper map: legs she adds up on the plateau edge, and the sunset printed on its margin. */
export type MapLeg = { id: string; name: string; hours: number };

export const MAP_LEGS: MapLeg[] = [
  { id: "toFork", name: "高原 → 岔口（Val Lasties 2455 m）", hours: 1.0 },
  { id: "toScreeFoot", name: "岔口 → 碎石谷底", hours: 1.5 },
  { id: "toForest", name: "谷底 → 森林小路", hours: 0.5 },
  { id: "toRoad", name: "森林小路 → 山口公路", hours: 0.5 },
];
export const HUT_LEG: MapLeg = { id: "toHut", name: "高原 → 山屋（Rifugio Boè）", hours: 2.5 };
export const HOURS_ALREADY = 6.5;
export const SUNSET_LABEL = "tramonto 20:15";
export const SUNSET_MINUTE = 20 * 60 + 15;
