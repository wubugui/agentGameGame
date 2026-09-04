// placement.mjs <sceneId> [out.png]
// Dumps every entity's resolved transform from the running engine (dev server must be running)
// and draws them on the scene's painting over the yaw/pitch grid (tools/grid.py).
// Prints JSON: { scene, painting, entities, visibleNow, console, exceptions }.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [scene, out = join(process.cwd(), `placement-${scene}.png`)] = process.argv.slice(2);
if (!scene) { console.error("usage: node tools/placement.mjs <sceneId> [out.png]"); process.exit(2); }
const work = mkdtempSync(join(tmpdir(), "blv-place-"));
const script = [
  "const def = __scenes[__world.state.sceneId];",
  "const kindOf = (e) => e.exit ? 'exit' : e.blaze ? 'blaze' : e.readable ? 'readable' : e.sprite ? 'sprite' : e.interactable ? 'interact' : e.gaze ? 'gaze' : 'other';",
  "window.__trace = def.entities.map((e) => { const t = __resolve(e); return { id: e.id, yaw: +t.yaw.toFixed(1), pitch: +t.pitch.toFixed(1), distance: t.distance || 10, kind: kindOf(e), sizeVh: e.sprite && e.sprite.sizeVh, sprite: e.sprite && e.sprite.src, label: e.interactable && e.interactable.label, visibleNow: __world.rt.views.has(e.id) }; });",
].join("\n");
writeFileSync(join(work, "dump.js"), script);
const dump = execFileSync("node", [join(here, "drive.mjs"), `${scene}&reveal=1&nosave=1`, join(work, "dump.js"), "800"], { encoding: "utf8", env: { ...process.env, BLV_DEADLINE: "60000" } });
const parsed = JSON.parse(dump);
const markers = parsed.trace;
const source = readFileSync(join(here, "..", "src", "scenes", `${scene}.scene.ts`), "utf8");
const painting = source.match(/painting:\s*"([^"]+)"/)?.[1];
if (!painting) { console.error("no painting in scene file"); process.exit(1); }
writeFileSync(join(work, "markers.json"), JSON.stringify(markers));
const r = spawnSync("python", [join(here, "grid.py"), join(here, "..", "public", painting), out, join(work, "markers.json")], { encoding: "utf8" });
process.stdout.write(r.stdout + r.stderr);
console.log(JSON.stringify({
  scene, painting, out, entities: markers,
  visibleNow: markers.filter((m) => m.visibleNow).map((m) => m.id),
  console: parsed.console.filter((l) => l.startsWith("error")), exceptions: parsed.exceptions,
}, null, 1));
