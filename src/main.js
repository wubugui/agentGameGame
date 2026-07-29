import { Game } from './game/Game.js';
import { CLASSES } from './game/Content.js';
import { autoQuality } from './game/Config.js';
import { assets } from './core/Assets.js';

const boot = (p, msg) => window.__boot?.(p, msg);

const el = (id) => document.getElementById(id);

/** Character select: three classes, straight out of the 1.76 client. */
function chooseCharacter() {
  return new Promise((resolve) => {
    const wrap = el('csClasses');
    const desc = el('csDesc');
    const ids = Object.keys(CLASSES);
    let picked = ids[0];

    const render = () => {
      wrap.innerHTML = '';
      for (const id of ids) {
        const c = CLASSES[id];
        const b = document.createElement('button');
        b.className = 'cs-class' + (id === picked ? ' on' : '');
        b.dataset.klass = id;
        b.innerHTML = `<span class="cs-glyph">${c.glyph}</span><span class="cs-cn">${c.name}</span><span class="cs-en">${c.en}</span>`;
        b.onclick = () => { picked = id; render(); };
        wrap.appendChild(b);
      }
      const c = CLASSES[picked];
      desc.innerHTML = `<p>${c.desc}</p><ul>${c.highlights.map((h) => `<li>${h}</li>`).join('')}</ul>`;
    };

    render();
    el('csGo').onclick = () => {
      const name = (el('csName').value || '无名少侠').trim().slice(0, 7);
      el('charsel').classList.add('hidden');
      resolve({ name, klass: picked });
    };
    el('charsel').classList.remove('hidden');
  });
}

async function main() {
  boot(0.1, '正在生成纹理…');
  // Yield so the loading bar paints before the (heavy) synchronous world build.
  const tick = (p, m) => new Promise((r) => { boot(p, m); requestAnimationFrame(() => setTimeout(r, 0)); });

  await tick(0.2, '正在唤醒玛法大陆…');

  el('boot').classList.add('hidden');
  const choice = await chooseCharacter();

  el('boot').classList.remove('hidden');

  // Modeled assets are loaded up front so entity constructors — which run
  // mid-frame during spawns and cannot await — can clone them synchronously.
  await assets.preload((n, total, name) => {
    boot(0.25 + 0.4 * (n / total), `正在载入模型 ${n}/${total} · ${name}`);
  });

  await tick(0.68, '正在雕刻地形…');

  const canvas = el('stage');
  const quality = new URLSearchParams(location.search).get('q') || autoQuality();
  const game = new Game(canvas, { ...choice, quality });
  window.game = game;

  await tick(0.7, '正在放置怪物与 NPC…');
  game.start(new URLSearchParams(location.search).get('map') || 'bichon');

  await tick(1.0, '完成');
  el('boot').classList.add('hidden');
  el('ui').classList.remove('hidden');
}

main().catch((e) => {
  console.error(e);
  const box = el('fatal'), msg = el('fatalMsg');
  box.classList.remove('hidden');
  msg.textContent = (e && (e.stack || e.message)) || String(e);
});
