// Smoke test for the node build: paste into the browser console on the title screen, or let tools/smoke.mjs inject it.
// Plays the whole journey with synthetic events and records a timeline in window.__log; sets window.__done at the end.
if (!Element.prototype.__gbcr) { Element.prototype.__gbcr = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { const r = this.__gbcr(); if (r.width === 0 && this.classList && this.classList.contains("world-input")) return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, x: 0, y: 0 }; return r; }; }
// Hidden tabs throttle timers: every frame reports a far-future time so walks complete in one step.
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now() + 60000), 16); window.cancelAnimationFrame = (id) => clearTimeout(id);
window.__log = []; window.__done = false; window.__t0 = performance.now();
const log = (m) => { window.__log.push(`${((performance.now() - window.__t0) / 1000).toFixed(1)}s ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const shell = () => $(".game-shell");
const nodeOf = () => { const m = (shell()?.className || "").match(/node-([A-Za-z0-9]+)/); return m ? m[1] : (shell()?.className.includes("title-screen") ? "title" : shell()?.className.includes("complete-screen") ? "complete" : "?"); };
const moving = () => shell()?.classList.contains("is-moving");
async function waitFor(fn, label, timeout = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { if (fn()) return true; await sleep(100); }
  log(`TIMEOUT waiting ${label} (node=${nodeOf()})`); return false;
}
function pointer(el, type) {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true, button: 0 }));
}
function tap(el) { pointer(el, "pointerdown"); pointer(el, "pointerup"); el.click(); }
async function press(selOrFn, label, timeout = 30000) {
  const find = typeof selOrFn === "function" ? selOrFn : () => $(selOrFn);
  const ok = await waitFor(() => find(), `${label} to appear`, timeout);
  if (!ok) return false;
  tap(find()); log(`press ${label}`); await sleep(150);
  return true;
}
const byText = (sel, text) => () => $$(sel).find((el) => el.textContent.includes(text));
async function go(expectNext) {
  await waitFor(() => !moving(), "not moving");
  const ok = await press(".go-hotspot", `go (${nodeOf()} -> ${expectNext})`);
  if (!ok) return false;
  await waitFor(() => nodeOf() === expectNext, `arrive ${expectNext}`, 15000);
  await sleep(300);
  return nodeOf() === expectNext;
}
// Hold-to-climb: press the glowing hold and keep the pointer down until the step registers (the hold time grows with fear).
async function climbAll() {
  for (let i = 0; i < 4; i += 1) {
    if (!(await waitFor(() => $(".climb-hotspot"), "climb hold", 8000))) return;
    if (i === 2 && $(".shout-action")) { tap($(".shout-action")); log("shout"); await sleep(200); }
    const before = $(".climb-hotspot").getAttribute("data-yaw") + "/" + $(".climb-hotspot").getAttribute("data-pitch");
    pointer($(".climb-hotspot"), "pointerdown");
    const start = performance.now();
    while (performance.now() - start < 3000) { const el = $(".climb-hotspot"); if (!el || el.getAttribute("data-yaw") + "/" + el.getAttribute("data-pitch") !== before) break; await sleep(60); }
    const el = $(".climb-hotspot"); if (el) pointer(el, "pointerup");
    log(`climb ${i} (${Math.round(performance.now() - start)} ms)`);
    await sleep(250);
  }
}

(async () => {
  try {
    if (nodeOf() === "title") { await press(() => $$(".title-actions .primary-button")[0], "title start"); await waitFor(() => nodeOf() === "meadow", "meadow"); }
    log(`start at ${nodeOf()}`);
    await go("approach");
    await go("plaque");
    await press(byText(".hotspot", "头盔"), "helmet"); await press(byText(".hotspot", "钢缆起点"), "clip in"); await go("cable");
    for (let anchor = 0; anchor < 4; anchor += 1) {
      await press(".carabiner-a", `A unclip ${anchor}`); await press(".carabiner-a", `A clip ${anchor}`);
      await press(".carabiner-b", `B unclip ${anchor}`); await press(".carabiner-b", `B clip ${anchor}`);
    }
    await go("crack");
    await press(byText(".hotspot", "一片薄石"), "decoy hold (slip)");
    for (const label of ["左脚", "右手", "左手", "右脚"]) await press(byText(".hold-hotspot", label), `hold ${label}`);
    await go("mailbox");
    await press(byText(".hotspot", "信箱"), "mailbox"); await press(".notebook-actions .primary-button:not([disabled])", "photograph letter", 8000); await go("exit");
    await go("summit");
    await press(byText(".hotspot", "十字架"), "cross"); await press(byText(".hotspot", "全景相机"), "selfie"); await sleep(3600); await go("plateau");
    await go("hutView");
    await press(byText(".hotspot", "山屋"), "look at hut"); await press(byText(".hotspot", "摊开地图"), "map");
    for (let i = 0; i < 4; i += 1) { await press(() => $$(".map-legs button")[i], `leg ${i}`); }
    await press(".map-choice .secondary-button", "try the hut (refused)"); await press(".map-choice .primary-button", "retreat");
    await press(byText(".hotspot", "巧克力"), "chocolate"); await go("signpost");
    await press(byText(".sign-arm", "Piz Selva"), "wrong arm"); await press(byText(".sign-arm", "Val Lasties"), "right arm"); await go("scree");
    await press(() => $$(".foot-hotspot")[1], "loose stone (slip)");
    for (let i = 0; i < 6; i += 1) await press(() => $$(".foot-hotspot")[0], `scree step ${i}`);
    await go("deer");
    await press(".deer-herd", "deer"); await go("forestEdge");
    await press(".call-action", "call 112");
    for (let i = 0; i < 6 && !$(".call-hangup"); i += 1) { await waitFor(() => $(".call-next") || $(".call-hangup"), "call line", 8000); if ($(".call-next")) { tap($(".call-next")); log(`call line ${i}`); await sleep(200); } }
    await press(".call-hangup", "hang up", 10000); await go("forest1");
    await climbAll(); await go("forest2");
    await climbAll();
    log(`phone button: ${$(".utility-controls .phone-missing") ? "missing (phone lost)" : "PRESENT (expected lost)"}`);
    await go("hairpin");
    for (let attempt = 0; attempt < 6 && !$(".go-hotspot"); attempt += 1) {
      await waitFor(() => $(".wave-action.lit") || $(".go-hotspot"), "car lights", 20000);
      if ($(".wave-action.lit")) { tap($(".wave-action")); log(`wave ${attempt}`); await sleep(400); }
      if (!$(".go-hotspot")) await waitFor(() => !$(".wave-action.lit") || $(".go-hotspot"), "car to pass", 10000);
    }
    await go("car");
    for (let i = 0; i < 5; i += 1) await press(".conversation-action", `car line ${i}`);
    await go("search");
    await press(".findmy-sheet .primary-button", "find my");
    await press(byText(".search-hotspot", "倒木后面"), "empty spot");
    for (const label of ["巨石下面", "矮松丛", "石墙下", "最后定位的那块坡"]) await press(byText(".search-hotspot", label), `search ${label}`);
    await go("hotel");
    await press(".call-action", "open hotel list"); for (let i = 0; i < 30 && $(".hotel-sheet li button:not(.called)"); i += 1) await press(() => $$(".hotel-sheet li button:not(.called)")[0], `hotel ${i}`); await press(".hotel-sheet .map-close", "put phone down"); await go("busStop");
    await press(".conversation-action", "woman approaches", 12000); await press(".conversation-action", "she asks"); await press(".answer-action", "yes"); await press(byText(".story-action", "举起相机"), "photograph her back"); await go("police");
    for (let i = 0; i < 3; i += 1) await press(".counter-hotspot", `police ${i}`);
    log(`phone button after return: ${$(".utility-controls .phone-missing") ? "STILL MISSING" : "present"}`);
    await go("bench");
    await press(".phone-return-action", "open gallery"); await press(".gallery-grid button.is-letter", "letter photo"); for (let i = 0; i < 12; i += 1) { const start = performance.now(); while (!$(".letter-translate") && nodeOf() === "bench" && !$(".phone-overlay") === false && performance.now() - start < 3000) await sleep(100); const button = $(".letter-translate"); if (!button) break; tap(button); log(`translate line ${i}`); await sleep(150); }
    await waitFor(() => nodeOf() === "complete", "complete screen", 45000);
    log(`DONE total ${((performance.now() - window.__t0) / 1000).toFixed(1)}s at ${nodeOf()}`);
  } catch (error) {
    log(`ERROR ${error && error.stack ? error.stack : error}`);
  }
  window.__done = true;
})();
