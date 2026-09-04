// Headless replay of the whole game through the scenes' own walkthroughs (dev server must be running).
//   node tools/replay.mjs [fastest|detour|wrong|all] [--shots DIR]
// A route starts at the title (flow begin), then for every scene it dispatches SCENES[id].walkthrough
// (or the route's variant on that scene's first visit) and waits for the scene to change.
// Prints a per-scene table and REPLAY PASS / FAIL. Exit code 1 on failure.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const routeArg = args.find((a) => !a.startsWith("--")) || "fastest";
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : "";
const ROUTES = {
  fastest: {},
  detour: { hutView: "detour" },
  wrong: { signpost: "wrong" },
};
const routes = routeArg === "all" ? Object.keys(ROUTES) : [routeArg];
if (routes.some((r) => !ROUTES[r])) { console.error("unknown route; use fastest|detour|wrong|all"); process.exit(2); }

const base = process.env.BLV_URL || "http://localhost:5174/agentGameGame/games/before-leaving-valley/";
const chrome = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].filter(Boolean).find((path) => existsSync(path));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs in the page. Walks scene by scene until the game completes or something fails.
const PAGE_SCRIPT = (variants) => `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const variants = ${JSON.stringify(variants)};
  const seen = {};
  const report = { scenes: [], ok: true, reason: "" };
  window.__replay = report;
  const said = [];
  __world.on("say", (p) => said.push(p.line));
  if (__world.state.phase === "title") { __cmd({ type: "flow", action: "begin" }); await sleep(600); }
  for (let guard = 0; guard < 60; guard += 1) {
    const s = __world.state;
    if (s.phase === "complete") break;
    const id = s.sceneId;
    seen[id] = (seen[id] || 0) + 1;
    const def = __scenes[id];
    const useVariant = variants[id] && seen[id] === 1 && def.variants && def.variants[variants[id]];
    const steps = useVariant ? def.variants[variants[id]] : def.walkthrough;
    const entry = { id, variant: useVariant ? variants[id] : null, minuteIn: s.clock.minuteOfDay, fatigueIn: +s.body.fatigue.toFixed(2), fearIn: +s.body.fear.toFixed(2), steps: steps ? steps.length : 0, ok: false, ms: 0, said: [] };
    report.scenes.push(entry);
    if (!steps || !steps.length) { entry.error = "no walkthrough"; report.ok = false; report.reason = id + ": no walkthrough"; break; }
    const t0 = performance.now(); const saidBefore = said.length;
    for (const step of steps) {
      if (step && typeof step.wait === "number") { await sleep(step.wait); continue; }
      __cmd(step);
      await sleep(120);
    }
    let changed = false;
    for (let i = 0; i < 150; i += 1) { await sleep(100); if (__world.state.sceneId !== id || __world.state.phase === "complete") { changed = true; break; } }
    entry.ms = Math.round(performance.now() - t0);
    entry.said = said.slice(saidBefore);
    entry.minuteOut = __world.state.clock.minuteOfDay;
    entry.next = __world.state.phase === "complete" ? "(complete)" : __world.state.sceneId;
    if (!changed) {
      const st = __world.state;
      entry.error = "scene did not change; overlay=" + st.ui.overlay + " travel=" + JSON.stringify(st.ui.travel) + " flags=" + JSON.stringify(Object.fromEntries(Object.entries(st.flags).filter(([k]) => k.startsWith(id + "."))));
      report.ok = false; report.reason = id + ": stuck"; break;
    }
    entry.ok = true;
  }
  if (__world.state.phase !== "complete" && report.ok) { report.ok = false; report.reason = "did not reach the credits"; }
  report.finalMinute = __world.state.clock.minuteOfDay;
  report.photos = __world.state.phone.photos.length;
  report.entries = __world.state.journal.entries;
  report.fallbackLines = __world.state.stats.fallbackLines;
  window.__replayDone = true;
})().catch((e) => { window.__replay = { ok: false, reason: "script error: " + (e && e.stack || e), scenes: [] }; window.__replayDone = true; });
`;

async function runRoute(route) {
  const port = 9800 + Math.floor(Math.random() * 500);
  const profile = join(tmpdir(), `blv-replay-${process.pid}-${Date.now()}`);
  const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--window-size=1280,720", `--user-data-dir=${profile}`, "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
  const logs = []; const exceptions = [];
  try {
    let wsUrl = null;
    for (let attempt = 0; attempt < 60 && !wsUrl; attempt += 1) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(250); } }
    if (!wsUrl) throw new Error("no debugger");
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0; const pending = new Map();
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });
    const evaluate = async (expression, sessionId) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)).result?.result?.value;
    const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
    const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] }, sessionId);
    await send("Page.navigate", { url: `${base}?nosave=1` }, sessionId);
    let ready = false;
    for (let i = 0; i < 120 && !ready; i += 1) { await sleep(250); ready = Boolean(await evaluate("Boolean(window.__world && window.__world.rt.booted)", sessionId)); }
    if (!ready) throw new Error("world never booted");
    await sleep(800);
    await evaluate(PAGE_SCRIPT(ROUTES[route]), sessionId);
    const started = Date.now();
    let done = false;
    while (!done && Date.now() - started < 8 * 60 * 1000) {
      await sleep(1000);
      done = Boolean(await evaluate("Boolean(window.__replayDone)", sessionId));
      if (shotsDir) {
        const scene = await evaluate("__world.state.sceneId", sessionId);
        const file = join(shotsDir, `${route}-${scene}.png`);
        if (scene && !existsSync(file)) { mkdirSync(shotsDir, { recursive: true }); const { result } = await send("Page.captureScreenshot", { format: "png" }, sessionId); if (result?.data) writeFileSync(file, Buffer.from(result.data, "base64")); }
      }
    }
    const report = await evaluate("JSON.parse(JSON.stringify(window.__replay || { ok: false, reason: 'timeout', scenes: [] }))", sessionId);
    if (!done && report) { report.ok = false; report.reason = report.reason || "timeout"; }
    return { route, report, logs, exceptions };
  } finally {
    proc.kill();
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 300);
  }
}

let allOk = true;
for (const route of routes) {
  const { report, logs, exceptions } = await runRoute(route);
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  console.log(`\n== route ${route}: ${report.ok ? "OK" : "FAIL (" + report.reason + ")"}`);
  for (const s of report.scenes) console.log(`  ${s.ok ? "ok " : "!! "} ${s.id.padEnd(11)}${s.variant ? "[" + s.variant + "]" : "".padEnd(0)} ${fmt(s.minuteIn)} -> ${s.minuteOut !== undefined ? fmt(s.minuteOut) : "--:--"}  ${String(s.steps).padStart(2)} steps ${String(s.ms).padStart(6)} ms  fatigue ${s.fatigueIn} fear ${s.fearIn}${s.said && s.said.length ? "  said: " + s.said.join(" / ") : ""}${s.error ? "\n      " + s.error : ""}`);
  if (report.ok) console.log(`  final ${fmt(report.finalMinute)} · photos ${report.photos} · entries ${report.entries.length} · fallback lines ${report.fallbackLines}`);
  const errors = logs.filter((l) => l.startsWith("error"));
  if (errors.length) console.log("  console errors:\n    " + [...new Set(errors)].slice(0, 20).join("\n    "));
  if (exceptions.length) console.log("  exceptions:\n    " + [...new Set(exceptions)].slice(0, 10).join("\n    "));
  if (!report.ok || errors.length || exceptions.length) allOk = false;
}
console.log(allOk ? "\nREPLAY PASS" : "\nREPLAY FAIL");
process.exit(allOk ? 0 : 1);
