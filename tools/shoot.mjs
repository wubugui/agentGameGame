/**
 * Headless capture harness. Boots the game in Chromium, drives it, and writes
 * screenshots + a console error log so review agents have something concrete to
 * look at instead of reading source and guessing.
 *
 *   node tools/shoot.mjs --out shots/ --shots town,field,zuma,night,combat
 *
 * Exit code is non-zero if the page threw. Not part of the shipped game.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'shots' },
    shots: { type: 'string', default: 'town,field,combat,night,dungeon' },
    quality: { type: 'string', default: 'ultra' },
    width: { type: 'string', default: '1920' },
    height: { type: 'string', default: '1080' },
    klass: { type: 'string', default: 'warrior' },
    keep: { type: 'boolean', default: false },
  },
});

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, values.out);
const W = +values.width, H = +values.height;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

/** Boot the game to a playable state on the given map. */
async function boot(map, quality = values.quality) {
  await page.goto(`${BASE}/index.html?q=${quality}&map=${map}`, { waitUntil: 'load' });
  // Character select
  await page.waitForSelector('#charsel:not(.hidden)', { timeout: 60000 });
  await page.click(`.cs-class[data-klass="${values.klass}"]`).catch(() => {});
  await page.click('#csGo');
  // World build is synchronous and slow; wait for the game object to be live.
  await page.waitForFunction(() => window.game && window.game.player && !window.game.player.dead, null, { timeout: 180000 });
  // Let a few frames of easing, LOD and particle warm-up settle.
  await page.waitForTimeout(2500);
}

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  → ${name}.png`);
}

/** Run arbitrary code against the live game instance. */
const evalGame = (fn, arg) => page.evaluate(fn, arg);

const SHOTS = {
  async town() {
    await boot('bichon');
    await shot('01-town-wide');
    await evalGame(() => { window.game.ctx.engine.zoom(-6); window.game.ctx.engine.snapCamera(); });
    await page.waitForTimeout(900);
    await shot('02-town-close');
  },

  async field() {
    await boot('bichon_field');
    await shot('03-field-wide');
    await evalGame(() => { window.game.ctx.engine.zoom(-8); window.game.ctx.engine.snapCamera(); });
    await page.waitForTimeout(900);
    await shot('04-field-ground-detail');
  },

  async combat() {
    await boot('bichon_field');
    // Walk the player onto the nearest monster and let a fight play out.
    await evalGame(() => {
      const g = window.game;
      const m = g.world.entities.filter((e) => e.faction === 'monster' && !e.dead)
        .sort((a, b) => a.distanceTo(g.player) - b.distanceTo(g.player))[0];
      if (m) { g.player.setPosition(m.position.x + 1.2, m.position.z); g.player.orderAttack(m); }
      g.ctx.engine.camTarget.copy(g.player.position);
      g.ctx.engine.zoom(-7);
      g.ctx.engine.snapCamera();
    });
    await page.waitForTimeout(1400);
    await shot('05-combat-melee');
    // Fire the first offensive skill in the hotbar.
    await evalGame(() => {
      const g = window.game;
      const m = g.world.entities.filter((e) => e.faction === 'monster' && !e.dead)
        .sort((a, b) => a.distanceTo(g.player) - b.distanceTo(g.player))[0];
      g.player.level = 30; g.player.recompute();
      for (const id of Object.keys(g.player.skills.size ? Object.fromEntries(g.player.skills) : {})) {
        g.player.orderSkill(id, m, { x: m.position.x, z: m.position.z });
        break;
      }
    });
    await page.waitForTimeout(700);
    await shot('06-combat-skill');
  },

  async night() {
    await boot('bichon');
    await evalGame(() => { window.game.sky.timeOfDay = 22.5; window.game.sky.setPreset('night', 0); });
    await page.waitForTimeout(1800);
    await shot('07-town-night');
    await evalGame(() => { window.game.sky.timeOfDay = 6.2; window.game.sky.setPreset('dawn', 0); });
    await page.waitForTimeout(1800);
    await shot('08-town-dawn');
  },

  async dungeon() {
    await boot('zuma');
    await shot('09-zuma-hall');
    await evalGame(() => { window.game.ctx.engine.zoom(-8); window.game.ctx.engine.snapCamera(); });
    await page.waitForTimeout(900);
    await shot('10-zuma-close');
  },

  async weather() {
    await boot('bichon_field');
    await evalGame(() => window.game.weather.set('storm', 1, 0));
    await page.waitForTimeout(2500);
    await shot('11-storm');
    await evalGame(() => window.game.weather.set('snow', 1, 0));
    await page.waitForTimeout(2500);
    await shot('12-snow');
  },

  async ui() {
    await boot('bichon');
    await evalGame(() => { window.game.hud?.openPanel('inventory'); window.game.hud?.openPanel('character'); });
    await page.waitForTimeout(700);
    await shot('13-ui-panels');
  },

  async boss() {
    await boot('zuma');
    await evalGame(() => {
      const g = window.game;
      const b = g.world.entities.find((e) => e.faction === 'monster' && (e.mdef?.ai === 'boss'));
      if (b) { g.player.setPosition(b.position.x + 4, b.position.z + 4); g.ctx.engine.camTarget.copy(b.position); }
      g.ctx.engine.snapCamera();
    });
    await page.waitForTimeout(1200);
    await shot('14-boss');
  },
};

let failed = false;
for (const name of values.shots.split(',').map((s) => s.trim()).filter(Boolean)) {
  const fn = SHOTS[name];
  if (!fn) { console.warn(`unknown shot set '${name}'`); continue; }
  console.log(`[shoot] ${name}`);
  try {
    await fn();
  } catch (e) {
    failed = true;
    logs.push(`[harness] shot set '${name}' failed: ${e.message}`);
    console.error(`  ✗ ${name}: ${e.message}`);
    await page.screenshot({ path: join(OUT, `FAIL-${name}.png`) }).catch(() => {});
  }
}

// Frame-time sample so reviewers can weigh "pretty" against "playable".
let perf = null;
try {
  perf = await page.evaluate(() => new Promise((res) => {
    const t = []; let last = performance.now(); let n = 0;
    const tick = () => {
      const now = performance.now(); t.push(now - last); last = now;
      if (++n < 120) requestAnimationFrame(tick);
      else {
        t.sort((a, b) => a - b);
        res({ median: t[60], p95: t[113], calls: window.game?.ctx.engine.renderer.info.render.calls,
              tris: window.game?.ctx.engine.renderer.info.render.triangles,
              textures: window.game?.ctx.engine.renderer.info.memory.textures,
              geometries: window.game?.ctx.engine.renderer.info.memory.geometries });
      }
    };
    requestAnimationFrame(tick);
  }));
} catch { /* page may already be broken */ }

await writeFile(join(OUT, 'console.log'), logs.join('\n') || '(clean)');
await writeFile(join(OUT, 'perf.json'), JSON.stringify(perf, null, 2));

console.log(`\n[shoot] ${logs.length} console error/warning line(s) → ${join(OUT, 'console.log')}`);
if (perf) console.log(`[shoot] frame median ${perf.median?.toFixed(1)}ms p95 ${perf.p95?.toFixed(1)}ms · ${perf.calls} draw calls · ${(perf.tris / 1000).toFixed(0)}k tris`);

if (!values.keep) { await browser.close(); server.close(); }
process.exit(failed || logs.some((l) => l.startsWith('[pageerror]')) ? 1 : 0);
