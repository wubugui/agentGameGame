/* Faithfulness and narration policy, asserted in development. */
import type { World } from "./world";

const FORBIDDEN = [/注意安全/, /小心/, /务必/, /建议你/, /记得带/, /不应该/, /本可以/, /教训/, /提醒/, /可以试试/, /做得好/, /你错了/];

export function checkLine(line: string) {
  if (!import.meta.env.DEV) return;
  const hit = FORBIDDEN.find((re) => re.test(line));
  if (hit) console.error(`[policy] 台词违反叙事政策（${hit}）：${line}`);
  const plain = line.replace(/[\s，。！？、“”…—·]/g, "");
  if (plain.length > 30 && !PROTECTED.some((p) => line.includes(p))) console.warn(`[policy] 台词偏长（${plain.length} 字）：${line}`);
}

/** Her own words from the account may run long. */
const PROTECTED = ["来都来了", "我开心了一下", "一屁股一屁股", "特别特别幸运", "Have you lost your phone", "这个公交车去警察局"];

export const INVARIANTS: Array<{ id: string; why: string; check: (w: World) => boolean }> = [
  { id: "mailbox-before-summit", why: "信箱在半途悬崖，不在山顶", check: (w) => !w.state.scenes.summit?.visited || Boolean(w.state.flags["mailbox.photographed"]) },
  { id: "first-car-passes", why: "第一辆车必定过，第二辆必定停，且没有第三辆", check: (w) => Number(w.state.flags["hairpin.cars"] ?? 0) <= 2 },
  { id: "phone-lost-in-forest2", why: "手机在 forest2 第三步无声滑落", check: (w) => !w.state.scenes.hairpin?.visited || Boolean(w.state.flags["phone.lost"]) || Boolean(w.state.flags["police.returned"]) },
  { id: "letter-only-by-phone", why: "只有这部手机拍下了那封信", check: (w) => !w.state.flags["mailbox.photographed"] || w.state.phone.photos.some((p) => p.kind === "letter") },
];

export function checkInvariants(world: World) {
  if (!import.meta.env.DEV) return;
  for (const invariant of INVARIANTS) {
    if (!invariant.check(world)) console.error(`[policy] 违反不变量 ${invariant.id}：${invariant.why}`);
  }
}
