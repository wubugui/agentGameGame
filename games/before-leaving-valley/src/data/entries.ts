/* Notebook entries. Every one comes from something read in the world; none is narration. */
export type EntryDef = { id: string; line: string; mapLegs?: Record<string, number> };

export const ENTRIES: Record<string, EntryDef> = {
  "E-route": { id: "E-route", line: "649 上 · 656 下 · Val Lasties 2455 m", mapLegs: { toFork: 1.0, toScreeFoot: 1.5, toForest: 0.5, toRoad: 0.5 } },
  "E-hut": { id: "E-hut", line: "Rifugio Boè · 避难所 · 可充电 · 可吃饭" },
  "E-hutTime": { id: "E-hutTime", line: "高原 → 山屋 2.5 h", mapLegs: { toHut: 2.5 } },
  "E-forest": { id: "E-forest", line: "木雕：鹿、熊、狼、野猪" },
  "E-472": { id: "E-472", line: "472 · Passo Sella ↔ Canazei" },
  "E-possnecker": { id: "E-possnecker", line: "Pössnecker · 1912" },
  "E-grade": { id: "E-grade", line: "C / D · 裂缝 UIAA II 无保护" },
  "E-carabinerRule": { id: "E-carabinerRule", line: "任何时候至少一把锁在钢缆上" },
  "E-summit": { id: "E-summit", line: "Piz Selva 2941 m · 十字架" },
  "E-coach": { id: "E-coach", line: "教练：6–7 h · easy？" },
  "E-sunset": { id: "E-sunset", line: "tramonto 20:15" },
  "E-656": { id: "E-656", line: "656 · Plan de Roces · Val Lasties" },
  "E-hutLit": { id: "E-hutLit", line: "17:00 对面的窗亮了" },
  "E-findmy": { id: "E-findmy", line: "Find My · 最后定位 · Val Lasties · 一个圈" },
  "E-hotels": { id: "E-hotels", line: "酒店与游客中心的电话（本地电话册）" },
  "E-memo": { id: "E-memo", line: "Memo · 28/07/2025 · 意大利语 · 看不懂" },
  "E-couple": { id: "E-couple", line: "她意大利人，他西班牙人 · 明天四周年" },
  "E-lostAt": { id: "E-lostAt", line: "手机 · 森林小路 · 掉了" },
};
