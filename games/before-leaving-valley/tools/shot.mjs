// Headless screenshot of one scene (dev server must be running):
//   node tools/shot.mjs <nodeId> <out.png> [js-to-run-before-shot] [waitMs]
// Example: node tools/shot.mjs school school.png "document.querySelector('.map-prop').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))" 4000
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [scene, out, prelude = "", waitMs = "3000"] = process.argv.slice(2);
if (!scene || !out) {
  console.error("usage: node tools/shot.mjs <nodeId> <out.png> [js] [waitMs]");
  process.exit(2);
}
const base = process.env.BLV_URL || "http://localhost:5174/agentGameGame/games/before-leaving-valley/";
const chrome = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].filter(Boolean).find((path) => existsSync(path));
const port = 9800 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--window-size=1280,720", `--user-data-dir=${join(tmpdir(), `blv-shot-profile-${port}`)}`, "--use-gl=angle", "--use-angle=swiftshader", "about:blank"], { stdio: "ignore" });

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
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send("Page.navigate", { url: `${base}?node=${scene}` }, sessionId);
  await sleep(4500);
  if (prelude) await send("Runtime.evaluate", { expression: prelude, awaitPromise: true }, sessionId);
  await sleep(Number(waitMs));
  const { result } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(out, Buffer.from(result.data, "base64"));
  console.log("saved", out);
} finally {
  proc.kill();
  process.exit(0);
}
