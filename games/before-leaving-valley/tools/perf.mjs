// First-load measurement in headless Chrome against a built site:
//   node tools/perf.mjs [url]
// Reports navigation timing, time until the title card is ready, transferred bytes by type.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:5175/agentGameGame/games/before-leaving-valley/";
const chrome = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].filter(Boolean).find((path) => existsSync(path));
const port = 9200 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--window-size=1280,720", `--user-data-dir=${join(tmpdir(), `blv-perf-profile-${port}`)}`, "--use-gl=angle", "--use-angle=swiftshader", "about:blank"], { stdio: "ignore" });

async function debuggerUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  throw new Error("no debugger");
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });
try {
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Network.clearBrowserCache", {}, sessionId);
  await send("Page.navigate", { url }, sessionId);
  const started = Date.now();
  let titleReadyAt = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(250);
    const { result } = await send("Runtime.evaluate", { expression: "!!document.querySelector('.title-card.is-ready')", returnByValue: true }, sessionId);
    if (result.result.value) { titleReadyAt = Date.now() - started; break; }
  }
  await sleep(6000); // let scene textures preload behind the title
  const { result } = await send("Runtime.evaluate", { expression: `JSON.stringify((() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource");
    const byType = {};
    for (const r of res) { const ext = (r.name.split("?")[0].split(".").pop() || "").toLowerCase(); const key = ["webp","png","jpg"].includes(ext) ? "images" : ext === "mp3" ? "audio" : ext === "js" ? "js" : ext === "css" ? "css" : "other"; byType[key] = (byType[key] || 0) + (r.transferSize || r.encodedBodySize || 0); }
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), resources: res.length, bytesByType: byType, totalBytes: Object.values(byType).reduce((a, b) => a + b, 0) };
  })())`, returnByValue: true }, sessionId);
  const metrics = JSON.parse(result.result.value);
  metrics.titleReadyMs = titleReadyAt;
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  proc.kill();
  process.exit(0);
}
