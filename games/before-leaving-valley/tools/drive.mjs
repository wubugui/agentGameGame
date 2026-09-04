// Headless driver for the command-driven engine (dev server must be running).
//   node tools/drive.mjs <node[&params]> <script.js|-> [waitMs] [out.png]
// The script runs in the page after window.__world exists; it may be async (top-level await is wrapped).
// Prints JSON: { trace: window.__trace, state: <summary>, console: [...], exceptions: [...] }.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [scene, scriptPath, waitMs = "3000", out = ""] = process.argv.slice(2);
if (!scene || !scriptPath) { console.error("usage: node tools/drive.mjs <node[&params]> <script.js|-> [waitMs] [out.png]"); process.exit(2); }
const script = scriptPath === "-" ? readFileSync(0, "utf8") : readFileSync(scriptPath, "utf8");
const base = process.env.BLV_URL || "http://localhost:5174/agentGameGame/games/before-leaving-valley/";
const chrome = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].filter(Boolean).find((path) => existsSync(path));
const port = 9800 + Math.floor(Math.random() * 500);
const profile = join(tmpdir(), `blv-profile-${process.pid}-${Date.now()}`);
const deadline = Number(process.env.BLV_DEADLINE || 120000);
setTimeout(() => { console.error("drive: deadline"); try { proc.kill(); } catch {} process.exit(3); }, deadline).unref();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--window-size=1280,720", `--user-data-dir=${profile}`, "--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });

async function debuggerUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  throw new Error("no debugger");
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(); const logs = []; const exceptions = [];
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
};
const send = (method, params = {}, sessionId) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });
const evaluate = async (expression, sessionId) => {
  const { result } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result?.exceptionDetails) exceptions.push("eval: " + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
  return result?.result?.value;
};
let exit = 0;
try {
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] }, sessionId);
  await send("Page.navigate", { url: `${base}?${scene.startsWith("node=") || scene.startsWith("title") ? scene : `node=${scene}`}` }, sessionId);
  let ready = false;
  for (let i = 0; i < 80 && !ready; i += 1) { await sleep(250); ready = Boolean(await evaluate("Boolean(window.__world && window.__world.rt.booted)", sessionId)); }
  if (!ready) throw new Error("world never booted");
  await sleep(1500);
  await evaluate(`window.__trace = window.__trace || []; (async () => { ${script} })().catch((e) => { console.error("script:", e && e.stack || e); })`, sessionId);
  await sleep(Number(waitMs));
  const summary = await evaluate(`(() => { const s = __world.state; return { scene: s.sceneId, phase: s.phase, minute: s.clock.minuteOfDay, fear: +s.body.fear.toFixed(2), fatigue: +s.body.fatigue.toFixed(2), overlay: s.ui.overlay, line: s.ui.line && s.ui.line.text, travel: s.ui.travel, entries: s.journal.entries, objective: s.journal.objective, worn: s.inventory.worn, hands: s.inventory.hands, items: s.inventory.items.length, views: [...__world.rt.views.keys()], handlers: __world.rt.handlers.size, queue: __world.rt.queue.length, revision: __world.revision, trace: window.__trace }; })()`, sessionId);
  if (out) { const { result } = await send("Page.captureScreenshot", { format: "png" }, sessionId); writeFileSync(out, Buffer.from(result.data, "base64")); }
  console.log(JSON.stringify({ ...summary, console: logs.filter((l) => !l.startsWith("debug")).slice(-40), exceptions }, null, 1));
} catch (error) { console.error("drive:", error.message); console.error(JSON.stringify({ console: logs.slice(-30), exceptions }, null, 1)); exit = 1; }
finally {
  proc.kill();
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(exit); }, 300);
}
