// Headless smoke test: drives a real Chrome through the whole game with tools/autoplay.js.
//   node tools/smoke.mjs [url]
// Needs a running dev server (npm run dev -- --port 5174) or a built site URL.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || "http://localhost:5174/agentGameGame/games/before-leaving-valley/";
const candidates = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chrome = candidates.find((path) => existsSync(path));
if (!chrome) {
  console.error("No Chrome/Edge found; set CHROME=<path>");
  process.exit(2);
}
const port = 9333 + Math.floor(Math.random() * 500);
const script = readFileSync(join(here, "autoplay.js"), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1280,720",
  `--user-data-dir=${join(tmpdir(), `blv-smoke-profile-${port}`)}`,
  "--autoplay-policy=no-user-gesture-required",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "about:blank",
], { stdio: "ignore" });

async function debuggerUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await response.json();
      return info.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome did not expose the debugging port");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        this.listeners.forEach((listener) => listener(message));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(listener) {
    this.listeners.push(listener);
  }
}

const errors = [];
try {
  const ws = new WebSocket(await debuggerUrl());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  cdp.on((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value || arg.description).join(" "));
  });
  const loaded = () => new Promise((resolve) => {
    const listener = (message) => { if (message.sessionId === sessionId && message.method === "Page.loadEventFired") resolve(); };
    cdp.on(listener);
  });
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return result.result.value;
  };

  let load = loaded();
  await cdp.send("Page.navigate", { url }, sessionId);
  await load;
  await sleep(1500);
  load = loaded();
  await evaluate("localStorage.clear(); location.reload(); 1");
  await load;
  await sleep(4000);
  if (process.env.PACED) await evaluate("window.__paced = true; 1");
  await cdp.send("Runtime.evaluate", { expression: script }, sessionId);
  const started = Date.now();
  let last = 0;
  while (Date.now() - started < (process.env.PACED ? 60 : 8) * 60 * 1000) {
    await sleep(2000);
    const state = await evaluate("JSON.stringify({ done: !!window.__done, log: window.__log || [] })");
    const { done, log } = JSON.parse(state);
    for (; last < log.length; last += 1) console.log("  " + log[last]);
    if (done) {
      const ok = log.some((line) => line.includes("DONE total")) && !log.some((line) => line.includes("TIMEOUT") || line.includes("ERROR"));
      console.log(ok ? "\nSMOKE PASS" : "\nSMOKE FAIL");
      if (errors.length) console.log("Console errors:\n  " + errors.join("\n  "));
      proc.kill();
      process.exit(ok && errors.length === 0 ? 0 : 1);
    }
  }
  console.log("\nSMOKE TIMEOUT");
  proc.kill();
  process.exit(1);
} catch (error) {
  console.error(error);
  proc.kill();
  process.exit(1);
}
