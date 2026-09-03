// Smoke test: paste into the browser console on the title screen. Plays the whole game with synthetic events
// and records a timeline in window.__log. Works even when the tab is hidden (rAF and layout are stubbed).
if (!Element.prototype.__gbcr) { Element.prototype.__gbcr = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { const r = this.__gbcr(); if (r.width === 0 && this.classList && this.classList.contains('world-input')) return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, x: 0, y: 0 }; return r; }; }
// Hidden tabs throttle timers, so the walk animation is skipped: every frame reports a far-future time and the walk completes in one step.
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now() + 60000), 16); window.cancelAnimationFrame = (id) => clearTimeout(id);
window.__log = [];
const log = (m) => { window.__log.push(`${((performance.now() - window.__t0) / 1000).toFixed(1)}s ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const shell = () => $(".game-shell");
const sceneOf = () => { const m = (shell()?.className || "").match(/scene-([A-Za-z0-9]+)/); return m ? m[1] : (shell()?.className.includes("title-screen") ? "title" : shell()?.className.includes("complete-screen") ? "complete" : "?"); };
const moving = () => shell()?.classList.contains("is-moving");
async function waitFor(fn, label, timeout = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { if (fn()) return true; await sleep(120); }
  log(`TIMEOUT waiting ${label} (scene=${sceneOf()})`); return false;
}
function pointer(el, fx = 0.5, fy = 0.5, type = "pointerdown") {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width * fx, y = r.top + r.height * fy;
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }));
  return { x, y };
}
async function press(sel, label) {
  const ok = await waitFor(() => $(sel), `${label} to appear`);
  if (!ok) return false;
  const el = $(sel);
  pointer(el, 0.5, 0.5, "pointerdown"); pointer(el, 0.5, 0.5, "pointerup"); el.click();
  log(`press ${label}`);
  return true;
}
async function world(fx, fy, label) {
  const el = $(".world-input"); pointer(el, fx, fy, "pointermove"); pointer(el, fx, fy, "pointerdown"); log(`world click ${label}`);
}
async function walkTo(fx, fy, label) {
  await waitFor(() => !moving(), "not moving");
  await world(fx, fy, label);
  await waitFor(() => moving(), "walk start", 4000);
  await waitFor(() => !moving(), "walk end", 12000);
}
async function untilScene(name) { const s = sceneOf(); const ok = await waitFor(() => sceneOf() === name, `scene ${name}`, 20000); log(`${ok ? "→" : "✗"} ${name}`); return ok; }
async function repeat(sel, n, label, gap = 300) { for (let i = 0; i < n; i++) { await waitFor(() => !moving() && $(sel), `${label} ${i + 1}`); await press(sel, `${label} ${i + 1}/${n}`); await sleep(gap); } }
(async () => {
  window.__t0 = performance.now();
  try {
    if (sceneOf() === "title") { await press(".title-actions .primary-button", "下车"); }
    await untilScene("school");
    await press(".map-prop", "map");
    await sleep(800);
    await walkTo(0.82, 0.55, "out of the door");
    await untilScene("arrival");
    // drag the backpack down
    await waitFor(() => $(".backpack-object"), "backpack");
    const bag = $(".backpack-object"); const p = pointer(bag, 0.5, 0.5, "pointerdown");
    bag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: p.x, clientY: p.y + 160, pointerId: 1 }));
    bag.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: p.x, clientY: p.y + 160, pointerId: 1 }));
    log("backpack taken=" + !$(".backpack-object"));
    await sleep(300);
    await walkTo(0.55, 0.62, "arrival road");
    await untilScene("forestEntry");
    await walkTo(0.5, 0.6, "forest path");
    await untilScene("trail");
    await walkTo(0.3, 0.6, "left path");
    await untilScene("chainTraverse");
    await repeat(".chain-target", 4, "chain", 200);
    await untilScene("chainUpper");
    await repeat(".chain-target", 4, "upper", 200);
    await untilScene("rubbleSlope");
    await repeat(".rubble-target", 4, "rubble", 200);
    await untilScene("viewpoint");
    await walkTo(0.5, 0.5, "viewpoint");
    await untilScene("summitRest");
    await press(".chocolate-prop", "chocolate");
    await sleep(600);
    await walkTo(0.6, 0.6, "to the mailbox");
    await untilScene("letterBox");
    await press(".letter-prop", "letter prop");
    await waitFor(() => $(".letter-view"), "letter view");
    await sleep(600);
    await press(".letter-view", "put letter back");
    await sleep(400);
    await walkTo(0.5, 0.7, "down from summit");
    await untilScene("sunsetFork");
    await sleep(1500);
    await walkTo(0.5, 0.7, "descend");
    await untilScene("nightSlope");
    await press(".call-action", "call");
    await waitFor(() => $(".call-hangup") && !$(".call-hangup").disabled, "call finished", 30000);
    await press(".call-hangup", "hang up");
    await sleep(500);
    await press(".light-controls button", "fill light");
    await repeat(".night-target", 4, "night slope", 200);
    await untilScene("deepForest");
    await repeat(".night-target", 4, "deep forest", 200);
    await untilScene("marker656");
    await repeat(".night-target", 3, "marker", 200);
    await untilScene("roadBank");
    await repeat(".night-target", 4, "bank", 200);
    await untilScene("roadside");
    await press(".rescue-action", "wave");
    await untilScene("carInterior");
    await repeat(".conversation-action", 6, "talk", 400);
    await untilScene("police");
    await repeat(".conversation-action", 3, "police", 400);
    await untilScene("searchRoad");
    await repeat(".search-target", 3, "search", 400);
    await press(".phone-return-action", "phone returned");
    await untilScene("valleyExit");
    await walkTo(0.5, 0.6, "to the station");
    await press('.utility-controls button[aria-label="打开手机"]', "open phone");
    await waitFor(() => $(".phone-overlay"), "phone");
    const album = [...document.querySelectorAll(".app-grid button")].find((b) => b.textContent.includes("相册")); album && album.click(); log("open album");
    await waitFor(() => $(".gallery-grid button.is-letter"), "letter tile");
    $(".gallery-grid button.is-letter").click(); log("open letter photo");
    await waitFor(() => $(".letter-paper .letter-zh"), "translation visible");
    await sleep(800);
    $(".phone-close").click(); log("close phone");
    await untilScene("complete");
    await waitFor(() => $(".complete-card"), "complete card", 40000);
    log("DONE total");
  } catch (e) { log("ERROR " + (e && e.message)); }
  window.__done = true;
})();
"autoplay started"
