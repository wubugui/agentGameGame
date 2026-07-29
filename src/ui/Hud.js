/**
 * src/ui/Hud.js — the whole DOM HUD (CONTRACTS §15).
 *
 * Objections noted per CONTRACTS §0 (implemented as specified regardless):
 *  - §15 says "sans for body" while the assignment brief forbids sans-serif body
 *    text inside panels. The brief is the more specific instruction, so every
 *    panel runs a CJK serif stack; only the tiny numeric readouts fall back to a
 *    tabular-figure face.
 *  - `Inventory` has no "move item between slots" API, so the bag's drag-to-move
 *    swaps `inventory.slots[]` in place and re-emits `inventory:changed`. If a
 *    move() lands later this should call it instead.
 *  - `Player.equipment` exposes `ringR` / `braceletR` / `belt` / `boots` /
 *    `shield`, but no catalogue item declares those slots. The paper doll draws
 *    them anyway (permanently empty) because the silhouette is the point.
 *
 * Design notes
 * ------------
 *  - Panel skins are drawn once into canvases and published as `--tex-*` CSS
 *    custom properties (data URLs). `styles/ui.css` stands on its own without
 *    them — every rule has a gradient fallback — because #boot and #charsel are
 *    on screen long before this class is constructed.
 *  - Nothing in `update(dt)` allocates. Every world-anchored element (damage
 *    number, nameplate, loot label) comes from a fixed pool of DOM nodes, and
 *    the only per-frame writes are `transform` / `width` strings, guarded by a
 *    "did it actually change" check.
 *  - Expensive work is throttled: the minimap redraws at 20 Hz, the nameplate
 *    census and the hover raycast at 8 Hz. Projection alone runs every frame so
 *    nothing swims relative to the world.
 */

import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { SKILLS, ITEMS, CLASSES, NPCS } from '../game/Content.js';
import { BAG_SLOTS } from '../game/Inventory.js';
import { MAP_ORDER, MAPS } from '../world/MapDefs.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function el(tag, cls, parent) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d') };
}

function urlOf(c) { return `url("${c.toDataURL('image/png')}")`; }

function lg(g, x0, y0, x1, y1, stops) {
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  for (const s of stops) grad.addColorStop(s[0], s[1]);
  return grad;
}

function rg(g, x0, y0, r0, x1, y1, r1, stops) {
  const grad = g.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const s of stops) grad.addColorStop(s[0], s[1]);
  return grad;
}

/** Rounded rect path (used for bevels and slot recesses, not for pill buttons). */
function rrect(g, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr); g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const STAT_CN = {
  dc: '攻击', mc: '魔法', sc: '道术', ac: '防御', mac: '魔御',
  accuracy: '准确', agility: '敏捷', hp: '最大生命', mp: '最大魔法',
  attackSpeed: '攻速', healHp: '恢复生命', healMp: '恢复魔法',
  luck: '幸运', teaches: '传授技能',
};

const TYPE_CN = {
  weapon: '武器', armor: '衣服', helmet: '头盔', necklace: '项链',
  ring: '戒指', bracelet: '手镯', potion: '药水', book: '秘籍',
  gold: '金币', belt: '腰带', boots: '靴子', shield: '盾牌',
};

const SLOT_CN = {
  weapon: '武器', armor: '衣服', helmet: '头盔', necklace: '项链',
  ringL: '左戒指', ringR: '右戒指', braceletL: '左手镯', braceletR: '右手镯',
  belt: '腰带', boots: '靴子', shield: '盾牌',
};

/** Paper-doll layout: [slot, grid-area]. */
const DOLL = [
  ['helmet', 'a'], ['necklace', 'b'], ['armor', 'c'], ['weapon', 'd'],
  ['shield', 'e'], ['ringL', 'f'], ['ringR', 'g'], ['braceletL', 'h'],
  ['braceletR', 'i'], ['belt', 'j'], ['boots', 'k'],
];

const CHAN_COLOR = {
  system: 'sys', loot: 'loot', exp: 'exp', chat: 'say', say: 'say',
  shout: 'shout', whisper: 'whis', guild: 'guild',
};

const HOTKEY_LABEL = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];

// ---------------------------------------------------------------------------
// Procedural skins — drawn once, published as CSS custom properties
// ---------------------------------------------------------------------------

/** Seamless beaten-bronze plate. */
function texBronze(size, dark, mid, light, seed) {
  const { c, g } = cv(size, size);
  g.fillStyle = mid; g.fillRect(0, 0, size, size);

  const rnd = mulberry32(seed);
  // Broad patina blotches.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size, r = 14 + rnd() * 40;
    const col = rnd() < 0.5 ? dark : light;
    const paint = (px, py) => {
      g.fillStyle = rg(g, px, py, 0, px, py, r, [[0, col + '3a'], [1, col + '00']]);
      g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
    };
    paint(x, y);
    if (x < r) paint(x + size, y); if (x > size - r) paint(x - size, y);
    if (y < r) paint(x, y + size); if (y > size - r) paint(x, y - size);
  }

  // Hammer dents: a lit rim on top-left, shadow bottom-right.
  for (let i = 0; i < 120; i++) {
    const x = rnd() * size, y = rnd() * size, r = 3 + rnd() * 9;
    const paint = (px, py) => {
      g.fillStyle = rg(g, px - r * 0.35, py - r * 0.35, 0, px, py, r, [
        [0, 'rgba(255,226,178,0.16)'], [0.55, 'rgba(255,220,170,0.03)'], [1, 'rgba(0,0,0,0.30)'],
      ]);
      g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
    };
    paint(x, y);
    if (x < r) paint(x + size, y); if (x > size - r) paint(x - size, y);
    if (y < r) paint(x, y + size); if (y > size - r) paint(x, y - size);
  }

  // Fine drag scratches.
  g.lineWidth = 1;
  for (let i = 0; i < 90; i++) {
    const x = rnd() * size, y = rnd() * size, len = 6 + rnd() * 26;
    const a = (rnd() - 0.5) * 0.5;
    g.strokeStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.20)' : 'rgba(255,226,180,0.09)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }

  // Vertical grime streaks — keeps it from reading as flat noise.
  for (let i = 0; i < 14; i++) {
    const x = rnd() * size, w = 2 + rnd() * 7;
    g.fillStyle = lg(g, x, 0, x + w, 0, [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(0,0,0,0.16)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(x, 0, w, size);
  }
  return c;
}

/** Nine-slice bronze + gold filigree frame. `size`/4 is the slice width. */
function texFrame(size, slice, gold1, gold2, gold3) {
  const { c, g } = cv(size, size);
  const s = slice;

  // Outer body band.
  const band = (x, y, w, h, vertical) => {
    g.fillStyle = vertical
      ? lg(g, x, 0, x + w, 0, [[0, '#0d0906'], [0.16, '#4b3720'], [0.45, '#2c2013'], [0.82, '#5b4426'], [1, '#0b0805']])
      : lg(g, 0, y, 0, y + h, [[0, '#0d0906'], [0.16, '#4b3720'], [0.45, '#2c2013'], [0.82, '#5b4426'], [1, '#0b0805']]);
    g.fillRect(x, y, w, h);
  };
  band(0, 0, size, s, false);
  band(0, size - s, size, s, false);
  band(0, 0, s, size, true);
  band(size - s, 0, s, size, true);

  // Carved gold trim: a raised bead just inside the outer edge.
  const bead = (x, y, w, h, vertical) => {
    g.fillStyle = vertical
      ? lg(g, x, 0, x + w, 0, [[0, gold3], [0.35, gold1], [0.62, gold2], [1, gold3]])
      : lg(g, 0, y, 0, y + h, [[0, gold3], [0.35, gold1], [0.62, gold2], [1, gold3]]);
    g.fillRect(x, y, w, h);
  };
  const t = Math.max(2, Math.round(s * 0.18));
  bead(0, s - t - 1, size, t, false);
  bead(0, size - s + 1, size, t, false);
  bead(s - t - 1, 0, t, size, true);
  bead(size - s + 1, 0, t, size, true);

  // Edge filigree — a vine that repeats at the slice period so `round` tiles it.
  g.strokeStyle = gold1; g.lineWidth = Math.max(1, s * 0.09);
  g.lineCap = 'round';
  const period = size - 2 * s;
  const vine = (cx, cy, horiz) => {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.5) / n;
      const p = s + t0 * period;
      g.beginPath();
      if (horiz) {
        g.moveTo(p - period / (n * 2.6), cy);
        g.quadraticCurveTo(p, cy - s * 0.30, p + period / (n * 2.6), cy);
        g.quadraticCurveTo(p, cy + s * 0.22, p - period / (n * 2.6), cy);
      } else {
        g.moveTo(cx, p - period / (n * 2.6));
        g.quadraticCurveTo(cx - s * 0.30, p, cx, p + period / (n * 2.6));
        g.quadraticCurveTo(cx + s * 0.22, p, cx, p - period / (n * 2.6));
      }
      g.stroke();
    }
  };
  vine(0, s * 0.44, true);
  vine(0, size - s * 0.44, true);
  vine(s * 0.44, 0, false);
  vine(size - s * 0.44, 0, false);

  // Ornate corner pieces: scroll curls + a rivet stud.
  const corner = (cx, cy, sx, sy) => {
    g.save();
    g.translate(cx, cy); g.scale(sx, sy);
    g.strokeStyle = gold1; g.lineWidth = Math.max(1.4, s * 0.13);
    g.beginPath();
    g.moveTo(s * 0.20, s * 0.86);
    g.quadraticCurveTo(s * 0.20, s * 0.22, s * 0.86, s * 0.20);
    g.stroke();
    g.strokeStyle = gold2; g.lineWidth = Math.max(1, s * 0.08);
    g.beginPath();
    g.arc(s * 0.40, s * 0.40, s * 0.20, Math.PI * 0.75, Math.PI * 2.05);
    g.stroke();
    g.beginPath();
    g.moveTo(s * 0.30, s * 0.92); g.quadraticCurveTo(s * 0.62, s * 0.62, s * 0.92, s * 0.30);
    g.stroke();
    // rivet
    g.fillStyle = rg(g, s * 0.36, s * 0.34, 0, s * 0.40, s * 0.40, s * 0.20, [
      [0, '#ffeab4'], [0.45, gold1], [1, '#2b1d0c'],
    ]);
    g.beginPath(); g.arc(s * 0.40, s * 0.40, s * 0.155, 0, 6.2832); g.fill();
    g.restore();
  };
  corner(0, 0, 1, 1);
  corner(size, 0, -1, 1);
  corner(0, size, 1, -1);
  corner(size, size, -1, -1);

  // Punch the middle out so the panel fill shows through.
  g.clearRect(s, s, size - 2 * s, size - 2 * s);
  return c;
}

/** Deeply bevelled sunken slot. */
function texSlot(size, hot) {
  const { c, g } = cv(size, size);
  const b = Math.max(2, Math.round(size * 0.09));
  // Outer raised lip.
  g.fillStyle = lg(g, 0, 0, size, size, [[0, '#6a5030'], [0.5, '#3a2a18'], [1, '#1a120a']]);
  g.fillRect(0, 0, size, size);
  // Recess.
  g.fillStyle = hot
    ? lg(g, 0, 0, 0, size, [[0, '#2a1d0d'], [0.55, '#3d2a12'], [1, '#241809']])
    : lg(g, 0, 0, 0, size, [[0, '#0b0805'], [0.55, '#170f09'], [1, '#241a10']]);
  g.fillRect(b, b, size - 2 * b, size - 2 * b);
  // Inner shadow, top + left heavy.
  g.fillStyle = lg(g, b, b, b, size * 0.62, [[0, 'rgba(0,0,0,0.85)'], [1, 'rgba(0,0,0,0)']]);
  g.fillRect(b, b, size - 2 * b, size - 2 * b);
  g.fillStyle = lg(g, b, b, size * 0.62, b, [[0, 'rgba(0,0,0,0.70)'], [1, 'rgba(0,0,0,0)']]);
  g.fillRect(b, b, size - 2 * b, size - 2 * b);
  // Bottom-right catch-light.
  g.fillStyle = lg(g, 0, size, 0, size * 0.6, [[0, 'rgba(255,215,150,0.16)'], [1, 'rgba(255,215,150,0)']]);
  g.fillRect(b, b, size - 2 * b, size - 2 * b);
  // Hairline gold keyline.
  g.strokeStyle = hot ? 'rgba(255,214,130,0.85)' : 'rgba(180,140,74,0.42)';
  g.lineWidth = 1;
  g.strokeRect(b + 0.5, b + 0.5, size - 2 * b - 1, size - 2 * b - 1);
  return c;
}

/** Empty glass tube groove (tiles horizontally). */
function texTube(h) {
  const { c, g } = cv(8, h);
  g.fillStyle = lg(g, 0, 0, 0, h, [
    [0, '#000000'], [0.12, '#120c07'], [0.5, '#1d140c'], [0.86, '#0d0906'], [1, '#3a2a18'],
  ]);
  g.fillRect(0, 0, 8, h);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, 8, Math.max(1, h * 0.14));
  return c;
}

/** Glassy liquid fill for a tube: deep core, specular streak, rounded top gloss. */
function texFill(h, lo, mid, hi, spec) {
  const { c, g } = cv(8, h);
  g.fillStyle = lg(g, 0, 0, 0, h, [
    [0, lo], [0.16, mid], [0.30, hi], [0.34, spec], [0.44, hi], [0.72, mid], [1, lo],
  ]);
  g.fillRect(0, 0, 8, h);
  g.fillStyle = lg(g, 0, 0, 0, h * 0.42, [[0, 'rgba(255,255,255,0.34)'], [1, 'rgba(255,255,255,0)']]);
  g.fillRect(0, 0, 8, h * 0.42);
  return c;
}

/** Seamless parchment for tooltips and dialog text. */
function texParchment(size, seed) {
  const { c, g } = cv(size, size);
  g.fillStyle = '#d8c9a4'; g.fillRect(0, 0, size, size);
  const rnd = mulberry32(seed);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * size, y = rnd() * size, r = 10 + rnd() * 34;
    g.fillStyle = rg(g, x, y, 0, x, y, r, [[0, 'rgba(140,110,64,0.16)'], [1, 'rgba(140,110,64,0)']]);
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  g.lineWidth = 1;
  for (let i = 0; i < 130; i++) {
    const x = rnd() * size, y = rnd() * size, len = 4 + rnd() * 20, a = rnd() * 3.14159;
    g.strokeStyle = rnd() < 0.5 ? 'rgba(120,96,58,0.16)' : 'rgba(255,246,222,0.22)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  return c;
}

// ---------------------------------------------------------------------------
// Procedural item / skill icons
// ---------------------------------------------------------------------------

const ICON_SIZE = 48;

function metalGrad(g, x0, y0, x1, y1, a, b, d) {
  return lg(g, x0, y0, x1, y1, [[0, d], [0.3, a], [0.5, b], [0.72, a], [1, d]]);
}

function drawSwordish(g, S, opts) {
  const w = opts.w || 0.16, curve = opts.curve || 0, tip = opts.tip || 0.08;
  const cx = S * 0.5;
  g.save();
  g.translate(0, 0);
  // blade
  g.beginPath();
  g.moveTo(cx - S * w, S * 0.66);
  g.quadraticCurveTo(cx - S * w + curve * S, S * 0.36, cx - S * tip + curve * S * 1.4, S * 0.10);
  g.lineTo(cx + curve * S * 1.6, S * 0.04);
  g.lineTo(cx + S * tip + curve * S * 1.4, S * 0.10);
  g.quadraticCurveTo(cx + S * w + curve * S, S * 0.36, cx + S * w, S * 0.66);
  g.closePath();
  g.fillStyle = metalGrad(g, cx - S * w, 0, cx + S * w, 0, opts.a || '#cfd6e0', opts.b || '#ffffff', opts.d || '#5a6270');
  g.fill();
  g.strokeStyle = 'rgba(10,10,14,0.75)'; g.lineWidth = 1.2; g.stroke();
  // fuller
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx + curve * S * 1.2, S * 0.12); g.lineTo(cx, S * 0.62); g.stroke();
  // guard
  g.fillStyle = metalGrad(g, 0, S * 0.64, 0, S * 0.74, '#d8ae56', '#ffe9a8', '#6b4c19');
  rrect(g, cx - S * 0.30, S * 0.64, S * 0.60, S * 0.09, S * 0.03); g.fill();
  g.strokeStyle = 'rgba(20,14,4,0.8)'; g.lineWidth = 1; g.stroke();
  // grip
  g.fillStyle = lg(g, cx - S * 0.06, 0, cx + S * 0.06, 0, [[0, '#2b1a10'], [0.5, '#6b452a'], [1, '#241409']]);
  g.fillRect(cx - S * 0.055, S * 0.73, S * 0.11, S * 0.17);
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.moveTo(cx - S * 0.055, S * (0.755 + i * 0.038)); g.lineTo(cx + S * 0.055, S * (0.745 + i * 0.038)); g.stroke();
  }
  // pommel
  g.fillStyle = rg(g, cx - S * 0.02, S * 0.90, 0, cx, S * 0.92, S * 0.075, [[0, '#ffe9a8'], [0.5, '#c99a3f'], [1, '#4a3210']]);
  g.beginPath(); g.arc(cx, S * 0.92, S * 0.07, 0, 6.2832); g.fill();
  g.restore();
}

function drawFlask(g, S, liquid, glow) {
  const cx = S * 0.5;
  // body
  g.beginPath();
  g.moveTo(cx - S * 0.10, S * 0.30);
  g.lineTo(cx - S * 0.24, S * 0.56);
  g.quadraticCurveTo(cx - S * 0.28, S * 0.90, cx, S * 0.90);
  g.quadraticCurveTo(cx + S * 0.28, S * 0.90, cx + S * 0.24, S * 0.56);
  g.lineTo(cx + S * 0.10, S * 0.30);
  g.closePath();
  g.fillStyle = lg(g, cx - S * 0.26, 0, cx + S * 0.26, 0, [
    [0, 'rgba(30,40,44,0.92)'], [0.35, liquid], [0.6, glow], [1, 'rgba(20,26,30,0.95)'],
  ]);
  g.fill();
  g.strokeStyle = 'rgba(8,10,12,0.85)'; g.lineWidth = 1.3; g.stroke();
  // meniscus
  g.fillStyle = 'rgba(255,255,255,0.20)';
  g.beginPath(); g.ellipse(cx, S * 0.55, S * 0.20, S * 0.045, 0, 0, 6.2832); g.fill();
  // specular
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath(); g.ellipse(cx - S * 0.11, S * 0.70, S * 0.035, S * 0.10, 0.25, 0, 6.2832); g.fill();
  // neck + cork
  g.fillStyle = 'rgba(24,30,34,0.9)';
  g.fillRect(cx - S * 0.10, S * 0.22, S * 0.20, S * 0.10);
  g.fillStyle = lg(g, 0, S * 0.12, 0, S * 0.24, [[0, '#a8763f'], [1, '#4d3116']]);
  rrect(g, cx - S * 0.11, S * 0.13, S * 0.22, S * 0.11, S * 0.02); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.stroke();
}

function drawGem(g, x, y, r, a, b) {
  g.beginPath();
  g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
  g.closePath();
  g.fillStyle = rg(g, x - r * 0.3, y - r * 0.3, 0, x, y, r, [[0, b], [0.55, a], [1, '#120a1e']]);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.stroke();
}

function drawGlow(g, S, x, y, r, color) {
  g.fillStyle = rg(g, x, y, 0, x, y, r, [[0, color + 'cc'], [0.5, color + '55'], [1, color + '00']]);
  g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
}

function paintIcon(kind, S) {
  const { c, g } = cv(S, S);
  const cx = S * 0.5, cy = S * 0.5;
  g.lineJoin = 'round';

  switch (kind) {
    case 'sword':
      drawSwordish(g, S, { w: 0.13, tip: 0.07 }); break;
    case 'blade':
      drawSwordish(g, S, { w: 0.15, curve: 0.09, tip: 0.05, a: '#e8d7b0', b: '#fffbe8', d: '#6d5a34' }); break;
    case 'greatsword':
      drawSwordish(g, S, { w: 0.21, tip: 0.12, a: '#b9c2cf', b: '#f4f8ff', d: '#3f4753' }); break;

    case 'staff': {
      drawGlow(g, S, cx + S * 0.14, S * 0.20, S * 0.26, '#7fb8ff');
      g.strokeStyle = lg(g, S * 0.2, 0, S * 0.7, 0, [[0, '#3a2412'], [0.5, '#8a5f34'], [1, '#2b1a0c']]);
      g.lineWidth = S * 0.085; g.lineCap = 'round';
      g.beginPath(); g.moveTo(S * 0.30, S * 0.92); g.lineTo(S * 0.64, S * 0.24); g.stroke();
      g.strokeStyle = 'rgba(255,225,170,0.35)'; g.lineWidth = S * 0.02;
      g.beginPath(); g.moveTo(S * 0.31, S * 0.90); g.lineTo(S * 0.63, S * 0.28); g.stroke();
      // claw setting
      g.strokeStyle = '#d8ae56'; g.lineWidth = S * 0.045;
      g.beginPath(); g.arc(S * 0.66, S * 0.20, S * 0.14, 0.5, 5.4); g.stroke();
      g.fillStyle = rg(g, S * 0.62, S * 0.16, 0, S * 0.66, S * 0.20, S * 0.13, [
        [0, '#ffffff'], [0.35, '#9fd4ff'], [0.7, '#2f6bd0'], [1, '#0b1a3c'],
      ]);
      g.beginPath(); g.arc(S * 0.66, S * 0.20, S * 0.115, 0, 6.2832); g.fill();
      break;
    }

    case 'talisman': {
      g.save(); g.translate(cx, cy); g.rotate(-0.18); g.translate(-cx, -cy);
      g.fillStyle = lg(g, 0, S * 0.1, 0, S * 0.9, [[0, '#f2d9a0'], [0.5, '#e8c47c'], [1, '#c69a52']]);
      g.fillRect(S * 0.30, S * 0.08, S * 0.40, S * 0.84);
      g.strokeStyle = 'rgba(80,50,20,0.8)'; g.lineWidth = 1.2;
      g.strokeRect(S * 0.30, S * 0.08, S * 0.40, S * 0.84);
      g.strokeStyle = '#9d1f1f'; g.lineWidth = S * 0.035; g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const y = S * (0.22 + i * 0.17);
        g.beginPath(); g.moveTo(S * 0.40, y); g.lineTo(S * 0.60, y); g.stroke();
        g.beginPath(); g.moveTo(S * 0.50, y - S * 0.06); g.lineTo(S * 0.50, y + S * 0.06); g.stroke();
      }
      g.restore(); break;
    }

    case 'shield': {
      g.beginPath();
      g.moveTo(cx, S * 0.06);
      g.lineTo(S * 0.86, S * 0.22);
      g.quadraticCurveTo(S * 0.84, S * 0.74, cx, S * 0.95);
      g.quadraticCurveTo(S * 0.16, S * 0.74, S * 0.14, S * 0.22);
      g.closePath();
      g.fillStyle = lg(g, S * 0.14, 0, S * 0.86, 0, [[0, '#3f4a56'], [0.35, '#8e9aa8'], [0.55, '#c7d1de'], [1, '#39424d']]);
      g.fill();
      g.strokeStyle = '#c9a049'; g.lineWidth = S * 0.055; g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = rg(g, cx - S * 0.04, cy - S * 0.06, 0, cx, cy - S * 0.02, S * 0.17, [
        [0, '#ffe9a8'], [0.5, '#c9a049'], [1, '#4a3210'],
      ]);
      g.beginPath(); g.arc(cx, cy - S * 0.02, S * 0.15, 0, 6.2832); g.fill();
      break;
    }

    case 'armor': {
      g.beginPath();
      g.moveTo(S * 0.28, S * 0.16); g.lineTo(cx, S * 0.26); g.lineTo(S * 0.72, S * 0.16);
      g.lineTo(S * 0.88, S * 0.34); g.lineTo(S * 0.78, S * 0.50);
      g.lineTo(S * 0.76, S * 0.88); g.lineTo(S * 0.24, S * 0.88);
      g.lineTo(S * 0.22, S * 0.50); g.lineTo(S * 0.12, S * 0.34);
      g.closePath();
      g.fillStyle = lg(g, S * 0.12, 0, S * 0.88, 0, [[0, '#3b2b1c'], [0.3, '#8a6a3e'], [0.52, '#c39a58'], [1, '#33251a']]);
      g.fill();
      g.strokeStyle = 'rgba(12,8,4,0.85)'; g.lineWidth = 1.3; g.stroke();
      g.strokeStyle = 'rgba(255,228,170,0.35)'; g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.moveTo(S * 0.26, S * (0.56 + i * 0.11)); g.lineTo(S * 0.74, S * (0.56 + i * 0.11)); g.stroke();
      }
      drawGem(g, cx, S * 0.40, S * 0.075, '#a02828', '#ff8a7a');
      break;
    }

    case 'robe': {
      g.beginPath();
      g.moveTo(S * 0.34, S * 0.14); g.lineTo(S * 0.66, S * 0.14);
      g.quadraticCurveTo(S * 0.86, S * 0.40, S * 0.82, S * 0.92);
      g.lineTo(S * 0.18, S * 0.92);
      g.quadraticCurveTo(S * 0.14, S * 0.40, S * 0.34, S * 0.14);
      g.closePath();
      g.fillStyle = lg(g, S * 0.18, 0, S * 0.82, 0, [[0, '#1a2545'], [0.4, '#334a86'], [0.6, '#4e6bb4'], [1, '#141c34']]);
      g.fill();
      g.strokeStyle = 'rgba(8,10,20,0.85)'; g.lineWidth = 1.3; g.stroke();
      g.strokeStyle = '#d8c07a'; g.lineWidth = S * 0.035;
      g.beginPath(); g.moveTo(cx, S * 0.16); g.lineTo(cx, S * 0.90); g.stroke();
      break;
    }

    case 'helm': case 'crown': {
      const crown = kind === 'crown';
      g.beginPath();
      g.moveTo(S * 0.16, S * 0.66);
      g.quadraticCurveTo(S * 0.16, S * 0.16, cx, S * 0.14);
      g.quadraticCurveTo(S * 0.84, S * 0.16, S * 0.84, S * 0.66);
      g.closePath();
      g.fillStyle = crown
        ? lg(g, S * 0.16, 0, S * 0.84, 0, [[0, '#5b4212'], [0.35, '#c9a049'], [0.55, '#ffe9a8'], [1, '#4a3210']])
        : lg(g, S * 0.16, 0, S * 0.84, 0, [[0, '#39414c'], [0.35, '#8d97a4'], [0.55, '#cfd8e4'], [1, '#2c333c']]);
      g.fill();
      g.strokeStyle = 'rgba(8,10,14,0.85)'; g.lineWidth = 1.3; g.stroke();
      if (crown) {
        for (let i = 0; i < 3; i++) drawGem(g, S * (0.32 + i * 0.18), S * 0.42, S * 0.065, '#7a1f8a', '#e5a8ff');
      } else {
        g.fillStyle = 'rgba(0,0,0,0.72)';
        g.fillRect(S * 0.24, S * 0.44, S * 0.52, S * 0.13);
        g.fillStyle = '#c9a049';
        g.fillRect(cx - S * 0.035, S * 0.18, S * 0.07, S * 0.48);
      }
      g.fillStyle = lg(g, 0, S * 0.66, 0, S * 0.78, [[0, '#c9a049'], [1, '#4a3210']]);
      g.fillRect(S * 0.14, S * 0.64, S * 0.72, S * 0.10);
      break;
    }

    case 'necklace': {
      g.strokeStyle = lg(g, S * 0.2, 0, S * 0.8, 0, [[0, '#7d5f22'], [0.5, '#f0d68c'], [1, '#7d5f22']]);
      g.lineWidth = S * 0.05;
      g.beginPath(); g.arc(cx, S * 0.36, S * 0.30, 0.28, Math.PI - 0.28); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.30)'; g.lineWidth = S * 0.014;
      g.beginPath(); g.arc(cx, S * 0.35, S * 0.30, 0.4, Math.PI - 0.4); g.stroke();
      drawGlow(g, S, cx, S * 0.70, S * 0.20, '#6fd8ff');
      drawGem(g, cx, S * 0.70, S * 0.15, '#1f6fa0', '#a8ecff');
      break;
    }

    case 'ring': {
      drawGlow(g, S, cx, S * 0.32, S * 0.18, '#ffd27a');
      g.strokeStyle = lg(g, S * 0.26, 0, S * 0.74, 0, [[0, '#6b4c19'], [0.4, '#f0d68c'], [0.65, '#c9a049'], [1, '#4a3210']]);
      g.lineWidth = S * 0.10;
      g.beginPath(); g.ellipse(cx, S * 0.60, S * 0.24, S * 0.26, 0, 0, 6.2832); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = S * 0.02;
      g.beginPath(); g.ellipse(cx, S * 0.60, S * 0.24, S * 0.26, 0, 3.5, 5.3); g.stroke();
      drawGem(g, cx, S * 0.30, S * 0.135, '#9a2020', '#ff9c8a');
      break;
    }

    case 'bracelet': {
      g.strokeStyle = lg(g, S * 0.2, 0, S * 0.8, 0, [[0, '#4a3210'], [0.4, '#d8b45a'], [0.7, '#f6e3ab'], [1, '#3a2609']]);
      g.lineWidth = S * 0.13;
      g.beginPath(); g.ellipse(cx, cy, S * 0.30, S * 0.22, 0.22, 0, 6.2832); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(cx, cy, S * 0.30, S * 0.22, 0.22, 0, 6.2832); g.stroke();
      for (let i = 0; i < 3; i++) {
        drawGem(g, cx + Math.cos(-0.9 + i * 0.9) * S * 0.28, cy + Math.sin(-0.9 + i * 0.9) * S * 0.21, S * 0.06, '#1f7a4a', '#9cf0c0');
      }
      break;
    }

    case 'potion.red': drawFlask(g, S, 'rgba(190,26,26,0.95)', 'rgba(255,120,96,0.95)'); break;
    case 'potion.blue': drawFlask(g, S, 'rgba(30,72,190,0.95)', 'rgba(122,178,255,0.95)'); break;
    case 'potion.white': drawFlask(g, S, 'rgba(210,206,190,0.95)', 'rgba(255,255,242,0.95)'); break;

    case 'book': {
      g.fillStyle = lg(g, S * 0.16, 0, S * 0.84, 0, [[0, '#3a1c14'], [0.4, '#7d3423'], [0.7, '#5a2418'], [1, '#2a120c']]);
      rrect(g, S * 0.16, S * 0.14, S * 0.68, S * 0.72, S * 0.04); g.fill();
      g.strokeStyle = 'rgba(10,6,4,0.85)'; g.lineWidth = 1.3; g.stroke();
      g.fillStyle = lg(g, 0, S * 0.14, 0, S * 0.86, [[0, '#efe6cd'], [1, '#bdb096']]);
      g.fillRect(S * 0.78, S * 0.17, S * 0.09, S * 0.66);
      g.strokeStyle = '#d8b45a'; g.lineWidth = S * 0.035;
      g.strokeRect(S * 0.23, S * 0.21, S * 0.48, S * 0.58);
      g.fillStyle = '#e8cf8a';
      g.font = `600 ${Math.round(S * 0.30)}px serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('秘', S * 0.47, S * 0.50);
      break;
    }

    case 'gold': {
      const coin = (x, y, r) => {
        g.fillStyle = rg(g, x - r * 0.3, y - r * 0.35, 0, x, y, r, [[0, '#fff3c0'], [0.45, '#e8c460'], [0.8, '#a97c25'], [1, '#5a3d0d']]);
        g.beginPath(); g.ellipse(x, y, r, r * 0.78, 0, 0, 6.2832); g.fill();
        g.strokeStyle = 'rgba(60,40,8,0.8)'; g.lineWidth = 1; g.stroke();
        g.fillStyle = 'rgba(90,60,12,0.75)';
        g.fillRect(x - r * 0.16, y - r * 0.16, r * 0.32, r * 0.32);
      };
      coin(S * 0.34, S * 0.70, S * 0.20);
      coin(S * 0.66, S * 0.70, S * 0.20);
      coin(S * 0.50, S * 0.46, S * 0.22);
      break;
    }

    case 'fire': {
      drawGlow(g, S, cx, S * 0.60, S * 0.42, '#ff7a1e');
      g.beginPath();
      g.moveTo(cx, S * 0.08);
      g.quadraticCurveTo(S * 0.80, S * 0.40, S * 0.70, S * 0.66);
      g.quadraticCurveTo(S * 0.66, S * 0.92, cx, S * 0.92);
      g.quadraticCurveTo(S * 0.34, S * 0.92, S * 0.30, S * 0.66);
      g.quadraticCurveTo(S * 0.20, S * 0.40, cx, S * 0.08);
      g.closePath();
      g.fillStyle = rg(g, cx, S * 0.74, 0, cx, S * 0.55, S * 0.50, [
        [0, '#fff6c8'], [0.28, '#ffd24a'], [0.6, '#f0621c'], [1, '#7a1a08'],
      ]);
      g.fill();
      g.fillStyle = 'rgba(255,250,210,0.85)';
      g.beginPath();
      g.moveTo(cx, S * 0.44); g.quadraticCurveTo(S * 0.62, S * 0.66, cx, S * 0.86);
      g.quadraticCurveTo(S * 0.38, S * 0.66, cx, S * 0.44); g.closePath(); g.fill();
      break;
    }

    case 'ice': {
      drawGlow(g, S, cx, cy, S * 0.42, '#7fd8ff');
      g.strokeStyle = '#dff4ff'; g.lineWidth = S * 0.055; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI / 3;
        g.beginPath();
        g.moveTo(cx - Math.cos(a) * S * 0.36, cy - Math.sin(a) * S * 0.36);
        g.lineTo(cx + Math.cos(a) * S * 0.36, cy + Math.sin(a) * S * 0.36);
        g.stroke();
      }
      g.lineWidth = S * 0.03;
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const bx = cx + Math.cos(a) * S * 0.22, by = cy + Math.sin(a) * S * 0.22;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(a + 0.7) * S * 0.11, by + Math.sin(a + 0.7) * S * 0.11);
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(a - 0.7) * S * 0.11, by + Math.sin(a - 0.7) * S * 0.11);
        g.stroke();
      }
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(cx, cy, S * 0.075, 0, 6.2832); g.fill();
      break;
    }

    case 'thunder': {
      drawGlow(g, S, cx, cy, S * 0.42, '#b9a6ff');
      g.beginPath();
      g.moveTo(S * 0.58, S * 0.06); g.lineTo(S * 0.26, S * 0.54);
      g.lineTo(S * 0.46, S * 0.54); g.lineTo(S * 0.36, S * 0.94);
      g.lineTo(S * 0.74, S * 0.42); g.lineTo(S * 0.52, S * 0.42);
      g.lineTo(S * 0.70, S * 0.06); g.closePath();
      g.fillStyle = lg(g, 0, S * 0.06, 0, S * 0.94, [[0, '#ffffff'], [0.4, '#d8ccff'], [1, '#6a4fd8']]);
      g.fill();
      g.strokeStyle = 'rgba(40,24,90,0.8)'; g.lineWidth = 1.2; g.stroke();
      break;
    }

    case 'heal': {
      drawGlow(g, S, cx, cy, S * 0.42, '#6ef0a0');
      g.fillStyle = lg(g, 0, S * 0.2, 0, S * 0.8, [[0, '#e8fff0'], [0.5, '#66e39a'], [1, '#12703c']]);
      g.fillRect(cx - S * 0.09, S * 0.18, S * 0.18, S * 0.64);
      g.fillRect(S * 0.18, cy - S * 0.09, S * 0.64, S * 0.18);
      g.strokeStyle = 'rgba(6,40,20,0.7)'; g.lineWidth = 1.2;
      g.strokeRect(cx - S * 0.09, S * 0.18, S * 0.18, S * 0.64);
      g.strokeRect(S * 0.18, cy - S * 0.09, S * 0.64, S * 0.18);
      break;
    }

    case 'poison': {
      drawGlow(g, S, cx, S * 0.62, S * 0.38, '#8ce03a');
      g.beginPath();
      g.moveTo(cx, S * 0.10);
      g.quadraticCurveTo(S * 0.82, S * 0.56, cx, S * 0.92);
      g.quadraticCurveTo(S * 0.18, S * 0.56, cx, S * 0.10);
      g.closePath();
      g.fillStyle = rg(g, cx - S * 0.06, S * 0.52, 0, cx, S * 0.60, S * 0.40, [
        [0, '#e4ffb0'], [0.45, '#7fd028'], [1, '#1d3c06'],
      ]);
      g.fill();
      g.strokeStyle = 'rgba(10,26,4,0.8)'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = 'rgba(20,36,6,0.85)';
      g.beginPath(); g.arc(cx - S * 0.07, S * 0.60, S * 0.045, 0, 6.2832); g.fill();
      g.beginPath(); g.arc(cx + S * 0.07, S * 0.60, S * 0.045, 0, 6.2832); g.fill();
      break;
    }

    case 'summon': {
      drawGlow(g, S, cx, cy, S * 0.44, '#a8e8ff');
      g.fillStyle = lg(g, 0, S * 0.2, 0, S * 0.8, [[0, '#f4f1e4'], [1, '#9a927c']]);
      g.beginPath(); g.ellipse(cx, S * 0.44, S * 0.24, S * 0.26, 0, 0, 6.2832); g.fill();
      g.fillRect(cx - S * 0.16, S * 0.62, S * 0.32, S * 0.14);
      g.strokeStyle = 'rgba(20,18,12,0.8)'; g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(cx, S * 0.44, S * 0.24, S * 0.26, 0, 0, 6.2832); g.stroke();
      g.fillStyle = '#1a1408';
      g.beginPath(); g.ellipse(cx - S * 0.09, S * 0.42, S * 0.055, S * 0.07, 0, 0, 6.2832); g.fill();
      g.beginPath(); g.ellipse(cx + S * 0.09, S * 0.42, S * 0.055, S * 0.07, 0, 0, 6.2832); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(cx - S * 0.16 + i * S * 0.107, S * 0.62); g.lineTo(cx - S * 0.16 + i * S * 0.107, S * 0.76); g.stroke();
      }
      break;
    }

    case 'spirit': {
      drawGlow(g, S, cx, cy, S * 0.46, '#cfe8ff');
      g.strokeStyle = lg(g, 0, S * 0.1, 0, S * 0.9, [[0, '#ffffff'], [1, '#4a78c8']]);
      g.lineWidth = S * 0.07; g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const t = i / 60, a = t * 6.6, r = S * 0.36 * (1 - t * 0.86);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      break;
    }

    case 'invisible': {
      g.strokeStyle = 'rgba(200,220,255,0.55)'; g.lineWidth = S * 0.05;
      g.setLineDash([S * 0.09, S * 0.07]);
      g.beginPath(); g.arc(cx, S * 0.30, S * 0.13, 0, 6.2832); g.stroke();
      g.beginPath();
      g.moveTo(S * 0.30, S * 0.90); g.quadraticCurveTo(cx, S * 0.42, S * 0.70, S * 0.90);
      g.stroke();
      g.setLineDash([]);
      drawGlow(g, S, cx, cy, S * 0.40, '#9fb8e0');
      break;
    }

    case 'blink': {
      drawGlow(g, S, cx, cy, S * 0.46, '#c07aff');
      g.strokeStyle = lg(g, 0, S * 0.1, 0, S * 0.9, [[0, '#f0d8ff'], [1, '#5a1f9a']]);
      g.lineWidth = S * 0.06;
      for (let k = 0; k < 2; k++) {
        g.beginPath();
        for (let i = 0; i <= 48; i++) {
          const t = i / 48, a = t * 5.4 + k * 3.14, r = S * 0.34 * (1 - t * 0.75);
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.72;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      break;
    }

    case 'charm': {
      drawGlow(g, S, cx, cy, S * 0.40, '#ffd27a');
      g.fillStyle = rg(g, cx - S * 0.08, cy - S * 0.08, 0, cx, cy, S * 0.32, [
        [0, '#fff0c0'], [0.5, '#d8ae56'], [1, '#4a3210'],
      ]);
      g.beginPath(); g.arc(cx, cy, S * 0.30, 0, 6.2832); g.fill();
      g.strokeStyle = 'rgba(30,18,4,0.8)'; g.lineWidth = 1.3; g.stroke();
      g.fillStyle = '#3a2408';
      g.font = `600 ${Math.round(S * 0.32)}px serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('符', cx, cy + S * 0.01);
      break;
    }

    default: {
      // Sack of miscellany.
      g.fillStyle = lg(g, S * 0.2, 0, S * 0.8, 0, [[0, '#3b2f1c'], [0.4, '#7e6a44'], [1, '#2a2113']]);
      g.beginPath();
      g.moveTo(S * 0.34, S * 0.30);
      g.quadraticCurveTo(S * 0.10, S * 0.62, S * 0.26, S * 0.88);
      g.lineTo(S * 0.74, S * 0.88);
      g.quadraticCurveTo(S * 0.90, S * 0.62, S * 0.66, S * 0.30);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(10,8,4,0.85)'; g.lineWidth = 1.3; g.stroke();
      g.strokeStyle = '#c9a049'; g.lineWidth = S * 0.05;
      g.beginPath(); g.moveTo(S * 0.32, S * 0.30); g.lineTo(S * 0.68, S * 0.30); g.stroke();
      break;
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// Hud
// ---------------------------------------------------------------------------

const _v3 = new THREE.Vector3();
const _proj = { x: 0, y: 0, ok: false };

export class Hud {
  constructor(game) {
    this.game = game;
    this.ctx = game.ctx;

    this._t = 0;
    this._offs = [];
    this._iconCache = new Map();
    this._panels = new Map();
    this._stack = [];
    this._z = 400;
    this._hitAt = new WeakMap();

    this._w = window.innerWidth;
    this._h = window.innerHeight;

    // Throttles
    this._mmAcc = 0;
    this._censusAcc = 0;
    this._hoverAcc = 0;
    this.hovered = null;

    this._stats = { hp: 0, hpMax: 1, mp: 0, mpMax: 1, exp: 0, expMax: 1, level: 1, stamina: 100, staminaMax: 100, gold: 0 };
    this._applied = { hp: -1, mp: -1, xp: -1, st: -1, lv: -1, gold: -1 };

    this.root = document.getElementById('ui') || document.body;
    this.elTop = document.getElementById('uiTop') || el('div', '', this.root);
    this.elWorld = document.getElementById('uiWorld') || el('div', '', this.root);
    this.elBottom = document.getElementById('uiBottom') || el('div', '', this.root);
    this.elPanels = document.getElementById('uiPanels') || el('div', '', this.root);
    this.elToast = document.getElementById('uiToast') || el('div', '', this.root);

    this._publishSkins();
    this._buildVitals();
    this._buildMinimap();
    this._buildChat();
    this._buildCommandBar();
    this._buildWorldPools();
    this._buildTooltip();
    this._buildDeathOverlay();

    this._wire();
    this._rebuildMinimapBase();

    this.chat('欢迎来到玛法大陆。按 H 查看操作说明。', 'system');
    if (this.game.player) this._syncIdentity();
  }

  // -------------------------------------------------------------------------
  // Skins
  // -------------------------------------------------------------------------

  _publishSkins() {
    const s = document.documentElement.style;
    this._setVars = [];
    const set = (k, v) => { s.setProperty(k, v); this._setVars.push(k); };

    set('--tex-bronze', urlOf(texBronze(128, '#1a1109', '#332515', '#8a6a3a', 0x51a3)));
    set('--tex-bronze-dk', urlOf(texBronze(128, '#0c0805', '#20170d', '#5b4426', 0x77c1)));
    set('--tex-frame', urlOf(texFrame(128, 30, '#e8c47c', '#a57a2e', '#5a3f13')));
    set('--tex-slot', urlOf(texSlot(48, false)));
    set('--tex-slot-on', urlOf(texSlot(48, true)));
    set('--tex-tube', urlOf(texTube(24)));
    set('--tex-hp', urlOf(texFill(24, '#3d0505', '#9c1414', '#e83a2a', '#ffb8a0')));
    set('--tex-mp', urlOf(texFill(24, '#061436', '#1a3ea8', '#3f7ce8', '#bcd8ff')));
    set('--tex-xp', urlOf(texFill(14, '#2a1a02', '#8a6410', '#e0aa2c', '#fff0b8')));
    set('--tex-st', urlOf(texFill(10, '#052018', '#0f6a48', '#28b880', '#c8ffe8')));
    set('--tex-parch', urlOf(texParchment(160, 0x9e11)));
  }

  _icon(kind) {
    let u = this._iconCache.get(kind);
    if (!u) {
      u = urlOf(paintIcon(kind || 'misc', ICON_SIZE));
      this._iconCache.set(kind, u);
    }
    return u;
  }

  // -------------------------------------------------------------------------
  // Always-on chrome
  // -------------------------------------------------------------------------

  _buildVitals() {
    const box = el('div', 'mir-vitals', this.elTop);
    this.elVitals = box;

    const port = el('div', 'mir-portrait', box);
    this.elPortrait = port;

    const col = el('div', 'mir-vcol', box);
    const idrow = el('div', 'mir-idrow', col);
    this.elName = el('span', 'mir-name', idrow);
    this.elLevel = el('span', 'mir-lv', idrow);

    const tube = (cls) => {
      const t = el('div', `mir-tube ${cls}`, col);
      const f = el('i', 'mir-fill', t);
      const x = el('span', 'mir-tubetext', t);
      return { t, f, x };
    };
    this.tubeHp = tube('mir-hp');
    this.tubeMp = tube('mir-mp');
    const row = el('div', 'mir-thinrow', col);
    const xp = el('div', 'mir-tube mir-thin mir-xp', row);
    this.tubeXp = { t: xp, f: el('i', 'mir-fill', xp), x: el('span', 'mir-tubetext', xp) };
    const st = el('div', 'mir-tube mir-thin mir-st', row);
    this.tubeSt = { t: st, f: el('i', 'mir-fill', st), x: el('span', 'mir-tubetext', st) };

    this.elGold = el('div', 'mir-gold', box);
  }

  _syncIdentity() {
    const p = this.game.player;
    if (!p) return;
    this.elName.textContent = p.name || '无名少侠';
    const cls = CLASSES[p.klass] || CLASSES.warrior;
    this.elPortrait.style.backgroundImage = this._portrait(p.klass);
    this.elPortrait.dataset.klass = p.klass || 'warrior';
    this.elPortrait.title = `${cls.name} · ${cls.en}`;
  }

  _portrait(klass) {
    const key = `portrait:${klass}`;
    let u = this._iconCache.get(key);
    if (u) return u;
    const S = 96;
    const { c, g } = cv(S, S);
    const cls = CLASSES[klass] || CLASSES.warrior;
    const pal = cls.palette || {};
    const hex = (n, d) => '#' + ((n === undefined ? d : n) >>> 0).toString(16).padStart(6, '0');
    const cloth = hex(pal.cloth, 0x6a4a2a), trim = hex(pal.trim, 0xd8b45a), skin = hex(pal.skin, 0xd6a882), hair = hex(pal.hair, 0x241a12);

    // Recessed niche behind the bust.
    g.fillStyle = rg(g, S * 0.5, S * 0.36, S * 0.05, S * 0.5, S * 0.5, S * 0.62, [
      [0, '#3a2a17'], [0.6, '#1a1209'], [1, '#070503'],
    ]);
    g.fillRect(0, 0, S, S);
    // Shoulders.
    g.fillStyle = lg(g, 0, S * 0.6, 0, S, [[0, cloth], [1, '#120c06']]);
    g.beginPath();
    g.moveTo(S * 0.06, S); g.quadraticCurveTo(S * 0.18, S * 0.64, S * 0.5, S * 0.62);
    g.quadraticCurveTo(S * 0.82, S * 0.64, S * 0.94, S); g.closePath(); g.fill();
    // Collar trim.
    g.strokeStyle = trim; g.lineWidth = S * 0.035;
    g.beginPath(); g.moveTo(S * 0.28, S * 0.74); g.quadraticCurveTo(S * 0.5, S * 0.66, S * 0.72, S * 0.74); g.stroke();
    // Neck + head.
    g.fillStyle = skin;
    g.fillRect(S * 0.42, S * 0.52, S * 0.16, S * 0.14);
    g.beginPath(); g.ellipse(S * 0.5, S * 0.40, S * 0.155, S * 0.185, 0, 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath(); g.ellipse(S * 0.5, S * 0.44, S * 0.155, S * 0.14, 0, 0, 3.14159); g.fill();
    // Hair.
    g.fillStyle = hair;
    g.beginPath();
    g.moveTo(S * 0.34, S * 0.42);
    g.quadraticCurveTo(S * 0.34, S * 0.18, S * 0.5, S * 0.19);
    g.quadraticCurveTo(S * 0.66, S * 0.18, S * 0.66, S * 0.42);
    g.quadraticCurveTo(S * 0.60, S * 0.30, S * 0.5, S * 0.30);
    g.quadraticCurveTo(S * 0.40, S * 0.30, S * 0.34, S * 0.42);
    g.closePath(); g.fill();
    // Eyes.
    g.fillStyle = '#120c08';
    g.beginPath(); g.ellipse(S * 0.44, S * 0.41, S * 0.022, S * 0.014, 0, 0, 6.2832); g.fill();
    g.beginPath(); g.ellipse(S * 0.56, S * 0.41, S * 0.022, S * 0.014, 0, 0, 6.2832); g.fill();
    // Class glyph, carved into the lower-right.
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.font = `700 ${Math.round(S * 0.26)}px "Songti SC","SimSun",serif`;
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillText(cls.glyph || '侠', S * 0.93, S * 0.97);
    g.fillStyle = trim;
    g.fillText(cls.glyph || '侠', S * 0.92, S * 0.955);
    // Vignette.
    g.fillStyle = rg(g, S * 0.5, S * 0.5, S * 0.28, S * 0.5, S * 0.5, S * 0.72, [
      [0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.62)'],
    ]);
    g.fillRect(0, 0, S, S);

    u = urlOf(c);
    this._iconCache.set(key, u);
    return u;
  }

  _buildMinimap() {
    const box = el('div', 'mir-minimap', this.elTop);
    this.elMinimap = box;
    const frame = el('div', 'mir-mm-frame', box);
    const c = el('canvas', 'mir-mm-canvas', frame);
    c.width = 176; c.height = 176;
    this.mmCanvas = c;
    this.mmCtx = c.getContext('2d');
    this.mmCtx.imageSmoothingEnabled = false;
    this.elMapName = el('div', 'mir-mm-name', box);
    this.elCoord = el('div', 'mir-mm-coord', box);
    this._mmBase = null;
    this._mmView = 46;

    frame.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._mmView = Math.max(22, Math.min(96, this._mmView + Math.sign(e.deltaY) * 6));
    }, { passive: false });
    frame.addEventListener('click', () => this.togglePanel('map'));
  }

  _rebuildMinimapBase() {
    const w = this.game.world;
    if (!w || !w.nav) return;
    const nav = w.nav;
    const { c, g } = cv(nav.width, nav.height);
    const img = g.createImageData(nav.width, nav.height);
    const d = img.data;
    const biome = (w.def && w.def.biome) || 'meadow';
    const openC = {
      meadow: [78, 92, 52], desert: [136, 114, 70], temple: [86, 76, 62],
      cave: [64, 58, 54], hell: [96, 52, 40],
    }[biome] || [78, 84, 58];
    for (let i = 0; i < nav.size; i++) {
      const blocked = nav.blocked[i];
      const j = i * 4;
      // A little per-tile mottling so the minimap doesn't read as flat colour.
      const n = ((i * 2654435761) >>> 0) % 23 - 11;
      if (blocked) {
        d[j] = 26 + n * 0.4; d[j + 1] = 20 + n * 0.4; d[j + 2] = 15 + n * 0.4; d[j + 3] = 235;
      } else {
        d[j] = openC[0] + n; d[j + 1] = openC[1] + n; d[j + 2] = openC[2] + n; d[j + 3] = 215;
      }
    }
    g.putImageData(img, 0, 0);
    this._mmBase = c;
    this.elMapName.textContent = (w.def && w.def.name) || '';
  }

  _buildChat() {
    const box = el('div', 'mir-chat', this.elBottom);
    this.elChatBox = box;
    const tabs = el('div', 'mir-chat-tabs', box);
    for (const [k, cn] of [['all', '全部'], ['system', '系统'], ['loot', '拾取'], ['exp', '经验']]) {
      const b = el('button', 'mir-chat-tab' + (k === 'all' ? ' on' : ''), tabs);
      b.textContent = cn; b.dataset.ch = k;
      b.addEventListener('click', () => {
        this._chatFilter = k;
        for (const n of tabs.children) n.classList.toggle('on', n === b);
        this.elChatLog.dataset.filter = k;
      });
    }
    this._chatFilter = 'all';
    this.elChatLog = el('div', 'mir-chat-log', box);
    this.elChatLog.dataset.filter = 'all';
  }

  _buildCommandBar() {
    const bar = el('div', 'mir-cmdbar', this.elBottom);
    this.elCmdBar = bar;

    const left = el('div', 'mir-wing mir-wing-l', bar);
    const mkBtn = (parent, label, title, fn) => {
      const b = el('button', 'mir-cbtn', parent);
      b.textContent = label; b.title = title;
      b.addEventListener('click', () => { bus.emit('audio:sfx', { id: 'ui.click' }); fn(); });
      return b;
    };
    mkBtn(left, '背包', '背包 (B / I)', () => this.togglePanel('inventory'));
    mkBtn(left, '角色', '角色 (C)', () => this.togglePanel('character'));
    mkBtn(left, '技能', '技能 (K)', () => this.togglePanel('skills'));

    const hot = el('div', 'mir-hotbar', bar);
    this.hotSlots = [];
    for (let i = 0; i < 8; i++) {
      const b = el('button', 'mir-hot', hot);
      b.dataset.i = String(i);
      b.dataset.drop = 'hot';
      const ic = el('i', 'mir-hot-icon', b);
      const cd = el('i', 'mir-cd', b);
      const cdt = el('em', 'mir-cd-txt', b);
      const key = el('b', 'mir-hot-key', b);
      key.textContent = HOTKEY_LABEL[i];
      this.hotSlots.push({ b, ic, cd, cdt, id: null, deg: -1, txt: '' });
      b.addEventListener('click', () => this.game._useHotbar?.(i));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = this.game.player;
        if (p) { p.hotbar[i] = null; this._syncHotbar(true); }
      });
      b.addEventListener('pointerenter', () => {
        const p = this.game.player;
        const id = p && p.hotbar[i];
        if (id && SKILLS[id]) this._showTip(this._skillTipHTML(id));
      });
      b.addEventListener('pointerleave', () => this._hideTip());
    }

    const right = el('div', 'mir-wing mir-wing-r', bar);
    mkBtn(right, '地图', '大地图 (M)', () => this.togglePanel('map'));
    mkBtn(right, '帮助', '帮助 (H)', () => this.togglePanel('help'));
    this.elAuto = mkBtn(right, '拾取', '自动拾取 (T)', () => {
      this.game._togglePickup?.();
      this.elAuto.classList.toggle('on', !!this.game.autoPickup);
    });
  }

  _buildWorldPools() {
    this.elWorld.classList.add('mir-world');

    this._dmg = [];
    for (let i = 0; i < 64; i++) {
      const n = el('div', 'mir-dmg', this.elWorld);
      const t = el('span', 'mir-dmg-t', n);
      n.style.display = 'none';
      this._dmg.push({ n, t, active: false, wx: 0, wy: 0, wz: 0, life: 0, ttl: 1, crit: false, seed: 0, txt: '' });
    }

    this._plates = [];
    for (let i = 0; i < 24; i++) {
      const n = el('div', 'mir-plate', this.elWorld);
      const inner = el('div', 'mir-plate-in', n);
      const nm = el('div', 'mir-plate-name', inner);
      const bar = el('div', 'mir-plate-bar', inner);
      const fill = el('i', '', bar);
      n.style.display = 'none';
      this._plates.push({ n, inner, nm, bar, fill, ent: null, lastHp: -1, lastName: '', shown: false });
    }

    this._labels = [];
    for (let i = 0; i < 18; i++) {
      const n = el('div', 'mir-lootlbl', this.elWorld);
      const inner = el('div', 'mir-lootlbl-in', n);
      n.style.display = 'none';
      this._labels.push({ n, inner, entry: null, txt: '' });
    }

    this._plateScratch = [];
    this._byDist = (a, b) => a._hudD - b._hudD;
  }

  _buildTooltip() {
    this.elTip = el('div', 'mir-tip', this.root);
    this.elTip.style.display = 'none';
    this._mouse = { x: 0, y: 0 };
    this._onMove = (e) => {
      this._mouse.x = e.clientX; this._mouse.y = e.clientY;
      if (this.elTip.style.display !== 'none') this._placeTip();
      if (this._drag && this._drag.ghost) {
        this._drag.ghost.style.transform = `translate3d(${e.clientX - 22}px,${e.clientY - 22}px,0)`;
      }
    };
    document.addEventListener('pointermove', this._onMove, { passive: true });
  }

  _buildDeathOverlay() {
    const d = el('div', 'mir-death', this.root);
    el('div', 'mir-death-t', d).textContent = '你 死 了';
    this.elDeathSub = el('div', 'mir-death-s', d);
    d.style.display = 'none';
    this.elDeath = d;
  }

  // -------------------------------------------------------------------------
  // Bus wiring
  // -------------------------------------------------------------------------

  _wire() {
    const on = (evt, fn) => this._offs.push(bus.on(evt, fn));

    on('player:stats', (s) => {
      const t = this._stats;
      t.hp = s.hp; t.hpMax = s.hpMax; t.mp = s.mp; t.mpMax = s.mpMax;
      t.exp = s.exp; t.expMax = s.expMax; t.level = s.level;
      t.stamina = s.stamina ?? t.stamina; t.staminaMax = s.staminaMax ?? t.staminaMax;
      t.gold = s.gold ?? t.gold;
    });

    on('player:spawn', () => { this._syncIdentity(); this._syncHotbar(true); });

    on('player:levelup', ({ level }) => {
      this.toast(`等级提升！${level} 级`, 'good');
      this.chat(`恭喜你升到了 ${level} 级！`, 'system');
      if (this._panels.get('character')?.open) this._fillCharacter();
      if (this._panels.get('skills')?.open) this._fillSkills();
    });

    on('player:died', () => {
      this.elDeath.style.display = '';
      this.elDeath.classList.add('on');
    });

    on('entity:damaged', ({ target, amount, kind, crit }) => {
      if (!target) return;
      this._hitAt.set(target, this._t);
      const p = this.game.player;
      const cls = target === p ? 'self' : (crit ? 'crit' : kind === 'magic' ? 'magic' : kind === 'poison' ? 'poison' : 'phys');
      this._spawnDamage(target, String(Math.max(1, Math.round(amount))), cls, crit);
      if (target === p) {
        this.elVitals.classList.remove('hurt');
        // Force reflow so the animation restarts on consecutive hits.
        void this.elVitals.offsetWidth;
        this.elVitals.classList.add('hurt');
      }
    });

    on('entity:healed', ({ target, amount }) => {
      if (!target || amount <= 0) return;
      this._spawnDamage(target, '+' + Math.round(amount), 'heal', false);
    });

    on('combat:miss', ({ target }) => {
      if (target) this._spawnDamage(target, '未命中', 'miss', false);
    });

    on('entity:died', ({ entity }) => {
      for (const pl of this._plates) if (pl.ent === entity) { pl.ent = null; this._hidePlate(pl); }
    });

    on('skill:cooldown', () => this._syncHotbar(false));
    on('skill:learned', () => {
      this._syncHotbar(true);
      if (this._panels.get('skills')?.open) this._fillSkills();
    });

    on('inventory:changed', () => {
      if (this._panels.get('inventory')?.open) this._fillInventory();
      if (this._panels.get('shop')?.open) this._fillShop();
      if (this._panels.get('character')?.open) this._fillCharacter();
    });
    on('equipment:changed', () => {
      if (this._panels.get('character')?.open) this._fillCharacter();
    });

    on('map:changed', ({ name }) => {
      // Entities from the old world are already disposed; drop every reference
      // to them before the next census so nothing projects a dead transform.
      this._clearWorldPools();
      this._rebuildMinimapBase();
      this._syncIdentity();
      this._syncHotbar(true);
      this.toast(name, 'system');
      if (this._panels.get('map')?.open) this._fillMap();
      for (const n of ['shop', 'dialog']) this.closePanel(n);
      this._dialogNpc = null; this._dialogDef = null;
    });

    on('chat', ({ text, channel }) => this.chat(text, channel));

    on('npc:dialog', ({ npc, def }) => {
      this._dialogNpc = npc;
      this._dialogDef = def || npc.ndef;
      this.openPanel('dialog');
    });

    on('quest:updated', ({ questId, state }) => {
      this.toast(`任务更新：${questId} · ${state}`, 'info');
    });

    // Ordinary pickups already print to the chat log; only shout about the
    // things a Mir2 player would actually stop and stare at.
    on('item:looted', ({ item, qty }) => {
      if (!item || item.id === 'gold') return;
      if ((item.price || 0) < 40000) return;
      this.toast(`获得【${item.name}】${qty > 1 ? ' ×' + qty : ''}`, 'good');
    });

    this._onResize = () => { this._w = window.innerWidth; this._h = window.innerHeight; };
    window.addEventListener('resize', this._onResize);

    this._onUp = (e) => this._dragEnd(e);
    document.addEventListener('pointerup', this._onUp);

    // The world canvas kills its own context menu; the HUD must kill ours so a
    // right-click use/equip never pops the browser menu on top of the panel.
    this._onCtx = (e) => e.preventDefault();
    this.root.addEventListener('contextmenu', this._onCtx);
  }

  /** Forget every entity/loot reference held by the pooled world elements. */
  _clearWorldPools() {
    for (const pl of this._plates) { pl.ent = null; pl.lastHp = -1; this._hidePlate(pl); }
    for (const lb of this._labels) { lb.entry = null; lb.n.style.display = 'none'; }
    for (const d of this._dmg) { d.active = false; d.n.style.display = 'none'; }
    this._plateScratch.length = 0;
    this.hovered = null;
  }

  // -------------------------------------------------------------------------
  // Chat / toast
  // -------------------------------------------------------------------------

  chat(text, channel = 'chat') {
    if (!text) return;
    const line = el('div', 'mir-chat-line ch-' + (CHAN_COLOR[channel] || 'say'));
    line.dataset.ch = channel || 'chat';
    line.textContent = text;
    this.elChatLog.appendChild(line);
    while (this.elChatLog.childElementCount > 90) this.elChatLog.removeChild(this.elChatLog.firstChild);
    this.elChatLog.scrollTop = this.elChatLog.scrollHeight;
  }

  toast(text, kind = 'info') {
    const t = el('div', 'mir-toast t-' + kind, this.elToast);
    t.textContent = text;
    while (this.elToast.childElementCount > 6) this.elToast.removeChild(this.elToast.firstChild);
    const id = setTimeout(() => { t.classList.add('out'); }, 2200);
    const id2 = setTimeout(() => { t.remove(); }, 2900);
    t._timers = [id, id2];
  }

  // -------------------------------------------------------------------------
  // World-anchored elements
  // -------------------------------------------------------------------------

  _spawnDamage(target, txt, cls, crit) {
    let e = null;
    for (const d of this._dmg) if (!d.active) { e = d; break; }
    if (!e) { e = this._dmg[0]; }   // steal the oldest rather than allocate
    e.active = true;
    e.life = 0;
    e.ttl = crit ? 1.5 : 1.15;
    e.crit = !!crit;
    e.seed = Math.random() * 6.2832;
    const h = (target.height || 1.7);
    e.wx = target.position.x + (Math.random() - 0.5) * 0.5;
    e.wy = target.position.y + h * 0.78;
    e.wz = target.position.z + (Math.random() - 0.5) * 0.5;
    if (e.txt !== txt) { e.t.textContent = txt; e.txt = txt; }
    e.n.className = 'mir-dmg d-' + cls + (crit ? ' crit' : '');
    e.n.style.display = '';
  }

  _project(x, y, z) {
    _v3.set(x, y, z).project(this.ctx.engine.camera);
    _proj.ok = _v3.z < 1;
    _proj.x = (_v3.x * 0.5 + 0.5) * this._w;
    _proj.y = (-_v3.y * 0.5 + 0.5) * this._h;
    return _proj;
  }

  _updateDamage(dt) {
    for (const e of this._dmg) {
      if (!e.active) continue;
      e.life += dt;
      const t = e.life / e.ttl;
      if (t >= 1) { e.active = false; e.n.style.display = 'none'; continue; }
      const p = this._project(e.wx, e.wy, e.wz);
      if (!p.ok) { e.n.style.display = 'none'; continue; }
      if (e.n.style.display === 'none') e.n.style.display = '';
      const rise = 54 * (1 - (1 - t) * (1 - t));
      let jx = 0, jy = 0;
      if (e.crit) {
        const s = (1 - t) * 5;
        jx = Math.sin(e.seed + e.life * 41) * s;
        jy = Math.cos(e.seed + e.life * 37) * s * 0.7;
      }
      e.n.style.transform = `translate3d(${(p.x + jx).toFixed(1)}px,${(p.y - rise + jy).toFixed(1)}px,0)`;
      e.n.style.opacity = t > 0.68 ? String(((1 - t) / 0.32).toFixed(2)) : '1';
    }
  }

  _hidePlate(pl) {
    if (!pl.shown) return;
    pl.shown = false;
    pl.n.style.display = 'none';
  }

  _census() {
    const w = this.game.world, p = this.game.player;
    const list = this._plateScratch;
    list.length = 0;
    if (!w || !p) return;
    for (const e of w.entities) {
      if (e === p || e.dead) continue;
      if (e.faction !== 'monster' && e.faction !== 'npc') continue;
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 26) continue;
      e._hudD = d;
      list.push(e);
      if (list.length >= 96) break;
    }
    list.sort(this._byDist);
    for (let i = 0; i < this._plates.length; i++) {
      this._plates[i].ent = i < list.length ? list[i] : null;
    }
  }

  _updatePlates() {
    const p = this.game.player;
    const target = p ? p.orderTarget : null;
    for (const pl of this._plates) {
      const e = pl.ent;
      if (!e || e.dead) { this._hidePlate(pl); continue; }
      const pr = this._project(e.position.x, e.position.y + (e.height || 1.7) + 0.28, e.position.z);
      if (!pr.ok) { this._hidePlate(pl); continue; }
      if (!pl.shown) { pl.shown = true; pl.n.style.display = ''; }
      pl.n.style.transform = `translate3d(${pr.x.toFixed(1)}px,${pr.y.toFixed(1)}px,0)`;

      const label = e.faction === 'npc'
        ? `${e.name}${e.title ? ' · ' + e.title : ''}`
        : `${e.name} (${e.level})`;
      if (pl.lastName !== label) { pl.nm.textContent = label; pl.lastName = label; }
      const cls = 'mir-plate-name ' + (e.faction === 'npc' ? 'npc' : (e === target ? 'tgt' : 'mob'));
      if (pl.nm.className !== cls) pl.nm.className = cls;

      const hit = this._hitAt.get(e);
      const show = e.faction === 'monster' && (e === target || e === this.hovered || (hit !== undefined && this._t - hit < 3.5));
      if (show) {
        if (pl.bar.style.display === 'none') pl.bar.style.display = '';
        const frac = Math.round(clamp01(e.hp / (e.hpMax || 1)) * 100);
        if (frac !== pl.lastHp) { pl.fill.style.width = frac + '%'; pl.lastHp = frac; }
      } else if (pl.bar.style.display !== 'none') {
        pl.bar.style.display = 'none';
      }
    }
  }

  _updateLootLabels() {
    const w = this.game.world, p = this.game.player;
    let i = 0;
    if (w && p && w.loot) {
      for (const l of w.loot) {
        if (i >= this._labels.length) break;
        const dx = l.position.x - p.position.x, dz = l.position.z - p.position.z;
        if (dx * dx + dz * dz > 196) continue;
        const pr = this._project(l.position.x, l.position.y + 0.75, l.position.z);
        if (!pr.ok) continue;
        const lb = this._labels[i++];
        const txt = l.item.id === 'gold' ? `${l.item.qty} 金币` : (l.item.qty > 1 ? `${l.item.name} ×${l.item.qty}` : l.item.name);
        if (lb.txt !== txt) { lb.inner.textContent = txt; lb.txt = txt; }
        const gold = l.item.id === 'gold';
        const cls = 'mir-lootlbl-in' + (gold ? ' gold' : '');
        if (lb.inner.className !== cls) lb.inner.className = cls;
        if (lb.n.style.display === 'none') lb.n.style.display = '';
        lb.n.style.transform = `translate3d(${pr.x.toFixed(1)}px,${pr.y.toFixed(1)}px,0)`;
      }
    }
    for (; i < this._labels.length; i++) {
      if (this._labels[i].n.style.display !== 'none') this._labels[i].n.style.display = 'none';
    }
  }

  // -------------------------------------------------------------------------
  // Bars / hotbar / minimap
  // -------------------------------------------------------------------------

  _updateBars() {
    const s = this._stats, a = this._applied;
    const hp = clamp01(s.hp / (s.hpMax || 1));
    const mp = clamp01(s.mp / (s.mpMax || 1));
    const xp = clamp01(s.exp / (s.expMax || 1));
    const st = clamp01(s.stamina / (s.staminaMax || 1));

    const q = (v) => Math.round(v * 400);
    if (q(hp) !== a.hp) {
      a.hp = q(hp);
      this.tubeHp.f.style.width = (hp * 100).toFixed(2) + '%';
      this.tubeHp.x.textContent = `${Math.max(0, Math.round(s.hp))} / ${Math.round(s.hpMax)}`;
      this.tubeHp.t.classList.toggle('low', hp < 0.28);
    }
    if (q(mp) !== a.mp) {
      a.mp = q(mp);
      this.tubeMp.f.style.width = (mp * 100).toFixed(2) + '%';
      this.tubeMp.x.textContent = `${Math.max(0, Math.round(s.mp))} / ${Math.round(s.mpMax)}`;
    }
    if (q(xp) !== a.xp) {
      a.xp = q(xp);
      this.tubeXp.f.style.width = (xp * 100).toFixed(2) + '%';
      this.tubeXp.x.textContent = `经验 ${(xp * 100).toFixed(1)}%`;
    }
    if (q(st) !== a.st) {
      a.st = q(st);
      this.tubeSt.f.style.width = (st * 100).toFixed(2) + '%';
      this.tubeSt.x.textContent = `体力 ${Math.round(s.stamina)}`;
    }
    if (s.level !== a.lv) {
      a.lv = s.level;
      this.elLevel.textContent = `Lv.${s.level}`;
    }
    if (s.gold !== a.gold) {
      a.gold = s.gold;
      this.elGold.textContent = `${s.gold | 0} 金币`;
    }
  }

  _syncHotbar(rebuildIcons) {
    const p = this.game.player;
    if (!p) return;
    for (let i = 0; i < this.hotSlots.length; i++) {
      const h = this.hotSlots[i];
      const id = p.hotbar[i] || null;
      if (rebuildIcons || h.id !== id) {
        h.id = id;
        const s = id ? SKILLS[id] : null;
        h.ic.style.backgroundImage = s ? this._icon(s.icon) : '';
        h.b.classList.toggle('empty', !s);
        h.b.title = s ? `${s.name}　MP ${s.mp}` : '';
      }
    }
  }

  _updateCooldowns() {
    const p = this.game.player;
    if (!p) return;
    for (const h of this.hotSlots) {
      if (!h.id) {
        if (h.deg !== 0) { h.deg = 0; h.cd.style.background = 'none'; h.cdt.textContent = ''; }
        continue;
      }
      const s = SKILLS[h.id];
      const left = p.cooldowns.get(h.id) || 0;
      const total = (s && s.cooldown) || 1;
      const frac = left > 0 ? clamp01(left / total) : 0;
      const deg = Math.round(frac * 60) * 6;
      if (deg !== h.deg) {
        h.deg = deg;
        h.cd.style.background = deg > 0
          ? `conic-gradient(rgba(4,3,2,0.74) 0deg ${deg}deg, rgba(0,0,0,0) ${deg}deg 360deg)`
          : 'none';
      }
      const txt = left > 0.05 ? (left >= 10 ? String(Math.ceil(left)) : left.toFixed(1)) : '';
      if (txt !== h.txt) { h.cdt.textContent = txt; h.txt = txt; }
      const poor = s && p.mp < s.mp;
      h.b.classList.toggle('nomp', !!poor);
    }
  }

  _drawMinimap() {
    const g = this.mmCtx, C = this.mmCanvas;
    const w = this.game.world, p = this.game.player;
    if (!g || !w || !p || !this._mmBase) return;
    const S = C.width;
    g.clearRect(0, 0, S, S);

    const view = this._mmView;
    const sx = p.position.x - view * 0.5;
    const sy = p.position.z - view * 0.5;
    g.imageSmoothingEnabled = false;
    g.drawImage(this._mmBase, sx, sy, view, view, 0, 0, S, S);

    const k = S / view;
    const toX = (x) => (x - sx) * k;
    const toY = (z) => (z - sy) * k;

    // Portals.
    for (const pt of w.def.portals || []) {
      const x = toX(pt.x + 0.5), y = toY(pt.z + 0.5);
      if (x < -8 || y < -8 || x > S + 8 || y > S + 8) continue;
      g.fillStyle = 'rgba(120,220,255,0.85)';
      g.beginPath(); g.arc(x, y, 3.6, 0, 6.2832); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.stroke();
    }

    // Loot.
    g.fillStyle = 'rgba(255,208,96,0.9)';
    for (const l of w.loot || []) {
      const x = toX(l.position.x), y = toY(l.position.z);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      g.fillRect(x - 1, y - 1, 2, 2);
    }

    // Entities.
    for (const e of w.entities) {
      if (e === p || e.dead) continue;
      const x = toX(e.position.x), y = toY(e.position.z);
      if (x < -4 || y < -4 || x > S + 4 || y > S + 4) continue;
      if (e.faction === 'npc') {
        g.fillStyle = '#ffdc6a';
        g.fillRect(x - 2, y - 2, 4, 4);
      } else if (e.faction === 'monster') {
        g.fillStyle = e.aggro ? '#ff5a3c' : '#c8443a';
        g.beginPath(); g.arc(x, y, 2.2, 0, 6.2832); g.fill();
      } else if (e.faction === 'player') {
        g.fillStyle = '#7ef0a0';
        g.beginPath(); g.arc(x, y, 2.2, 0, 6.2832); g.fill();
      }
    }

    // Player arrow.
    const px = toX(p.position.x), py = toY(p.position.z);
    const dx = Math.sin(p.facing), dy = Math.cos(p.facing);
    g.fillStyle = '#fff6d8';
    g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px + dx * 6.5, py + dy * 6.5);
    g.lineTo(px - dy * 4 - dx * 3, py + dx * 4 - dy * 3);
    g.lineTo(px + dy * 4 - dx * 3, py - dx * 4 - dy * 3);
    g.closePath(); g.fill(); g.stroke();

    this.elCoord.textContent = `${p.position.x | 0} , ${p.position.z | 0}`;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt) {
    this._t += dt;
    const p = this.game.player;

    this._updateBars();
    this._updateCooldowns();
    this._syncHotbar(false);

    this._censusAcc += dt;
    if (this._censusAcc >= 0.125) { this._censusAcc = 0; this._census(); }

    this._hoverAcc += dt;
    if (this._hoverAcc >= 0.12) {
      this._hoverAcc = 0;
      const inp = this.game.input;
      if (inp && inp.pointerInside && !this._drag) {
        const hit = inp.pick(this.ctx.engine.camera);
        this.hovered = hit.entity || null;
      } else if (!inp || !inp.pointerInside) {
        this.hovered = null;
      }
    }

    this._updateDamage(dt);
    this._updatePlates();
    this._updateLootLabels();

    this._mmAcc += dt;
    if (this._mmAcc >= 0.05) { this._mmAcc = 0; this._drawMinimap(); }

    if (p) {
      if (p.dead) {
        if (this.elDeath.style.display === 'none') { this.elDeath.style.display = ''; this.elDeath.classList.add('on'); }
        const left = Math.max(0, this.game.deathTimer || 0);
        this.elDeathSub.textContent = `${left.toFixed(1)} 秒后在城中复活`;
      } else if (this.elDeath.style.display !== 'none') {
        this.elDeath.style.display = 'none';
        this.elDeath.classList.remove('on');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tooltips
  // -------------------------------------------------------------------------

  _placeTip() {
    const t = this.elTip;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = this._mouse.x + 18, y = this._mouse.y + 18;
    if (x + w > this._w - 8) x = this._mouse.x - w - 18;
    if (y + h > this._h - 8) y = Math.max(8, this._h - h - 8);
    t.style.transform = `translate3d(${x}px,${y}px,0)`;
  }

  _showTip(html) {
    if (!html) return;
    this.elTip.innerHTML = html;
    this.elTip.style.display = '';
    this._placeTip();
  }

  _hideTip() { this.elTip.style.display = 'none'; }

  _fmt(v) { return Array.isArray(v) ? `${v[0]}-${v[1]}` : String(v); }

  _itemTipHTML(item) {
    if (!item) return '';
    const base = ITEMS[item.id] || {};
    const rare = (item.price || 0) >= 40000;
    const rows = [];
    for (const [k, v] of Object.entries(item.stats || {})) {
      const cn = STAT_CN[k];
      if (!cn) continue;
      if (k === 'teaches') {
        const s = SKILLS[v];
        rows.push(`<div class="tp-row"><span>${cn}</span><b>${s ? s.name : v}</b></div>`);
        continue;
      }
      let extra = '';
      const bv = base.stats && base.stats[k];
      if (Array.isArray(bv) && Array.isArray(bv[0])) {
        extra = `<i class="tp-base">(${bv[0][0]}~${bv[0][1]} / ${bv[1][0]}~${bv[1][1]})</i>`;
      }
      rows.push(`<div class="tp-row"><span>${cn}</span><b>${this._fmt(v)}</b>${extra}</div>`);
    }
    const meta = [];
    if (item.reqLevel) meta.push(`需要等级 ${item.reqLevel}`);
    if (item.klass) meta.push(`职业 ${(CLASSES[item.klass] || {}).name || item.klass}`);
    if (item.durability) meta.push(`持久 ${item.durability[0]}/${item.durability[1]}`);
    meta.push(`重量 ${item.weight}`);
    if (item.price) meta.push(`价值 ${item.price} 金`);

    return `<div class="tp ${rare ? 'rare' : ''}">
      <div class="tp-name">${item.name}${item.qty > 1 ? ` <em>×${item.qty}</em>` : ''}</div>
      <div class="tp-type">${TYPE_CN[item.type] || '物品'}${item.slot ? ' · ' + (SLOT_CN[item.slot] || '') : ''}</div>
      ${rows.length ? `<div class="tp-stats">${rows.join('')}</div>` : ''}
      <div class="tp-meta">${meta.join('　')}</div>
      ${item.desc ? `<div class="tp-desc">${item.desc}</div>` : ''}
    </div>`;
  }

  _skillTipHTML(id) {
    const s = SKILLS[id];
    if (!s) return '';
    const p = this.game.player;
    const lv = p && p.skills.get(id);
    const rows = [
      `<div class="tp-row"><span>消耗魔法</span><b>${s.mp}</b></div>`,
      `<div class="tp-row"><span>冷却</span><b>${s.cooldown || 0} 秒</b></div>`,
      `<div class="tp-row"><span>吟唱</span><b>${(s.cast || 0).toFixed(2)} 秒</b></div>`,
      `<div class="tp-row"><span>距离</span><b>${s.range >= 40 ? '自身' : s.range}</b></div>`,
    ];
    return `<div class="tp">
      <div class="tp-name skill">${s.name}</div>
      <div class="tp-type">${(CLASSES[s.class] || {}).name || ''} · 需要等级 ${s.level}${lv ? ` · 已修炼 ${lv.level} 级` : ''}</div>
      <div class="tp-stats">${rows.join('')}</div>
      ${s.desc ? `<div class="tp-desc">${s.desc}</div>` : ''}
    </div>`;
  }

  // -------------------------------------------------------------------------
  // Drag & drop
  // -------------------------------------------------------------------------

  _dragStart(e, kind, payload, iconUrl) {
    if (e.button !== 0) return;
    this._hideTip();
    const ghost = el('div', 'mir-ghost', this.root);
    ghost.style.backgroundImage = iconUrl || '';
    ghost.style.transform = `translate3d(${e.clientX - 22}px,${e.clientY - 22}px,0)`;
    this._drag = { kind, payload, ghost };
  }

  _dragEnd(e) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    d.ghost.remove();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const zone = under && under.closest ? under.closest('[data-drop]') : null;
    if (!zone) return;
    const p = this.game.player;
    if (!p) return;
    const drop = zone.dataset.drop;

    if (d.kind === 'skill' && drop === 'hot') {
      const i = parseInt(zone.dataset.i, 10);
      if (i >= 0 && i < 8) {
        const prev = p.hotbar.indexOf(d.payload);
        if (prev >= 0) p.hotbar[prev] = p.hotbar[i];
        p.hotbar[i] = d.payload;
        this._syncHotbar(true);
        bus.emit('audio:sfx', { id: 'ui.click' });
      }
      return;
    }

    if (d.kind === 'bag' && drop === 'bag') {
      const from = d.payload, to = parseInt(zone.dataset.slot, 10);
      if (from === to || Number.isNaN(to)) return;
      const inv = p.inventory;
      const tmp = inv.slots[to];
      inv.slots[to] = inv.slots[from];
      inv.slots[from] = tmp;
      bus.emit('inventory:changed', {});
      bus.emit('audio:sfx', { id: 'ui.click' });
      return;
    }

    if (d.kind === 'bag' && drop === 'equip') {
      const it = p.inventory.slots[d.payload];
      if (it) p.inventory.equip(it.uid);
      return;
    }

    if (d.kind === 'equip' && (drop === 'bag' || drop === 'bagarea')) {
      p.inventory.unequip(d.payload);
    }
  }

  // -------------------------------------------------------------------------
  // Panels
  // -------------------------------------------------------------------------

  _window(name, title, cls) {
    const root = el('div', 'mir-win ' + (cls || ''), this.elPanels);
    root.dataset.panel = name;
    const bar = el('div', 'mir-win-t', root);
    const h = el('span', 'mir-win-h', bar);
    h.textContent = title;
    const x = el('button', 'mir-win-x', bar);
    x.textContent = '✕';
    x.addEventListener('click', () => this.closePanel(name));
    const body = el('div', 'mir-win-b', root);
    root.style.display = 'none';

    // Drag the window by its title bar.
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    const move = (e) => {
      if (!dragging) return;
      root.style.left = Math.max(0, Math.min(this._w - 60, ox + e.clientX - sx)) + 'px';
      root.style.top = Math.max(0, Math.min(this._h - 40, oy + e.clientY - sy)) + 'px';
      root.style.right = 'auto'; root.style.bottom = 'auto';
      root.style.transform = 'none';
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.target === x) return;
      const r = root.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY; dragging = true;
      root.style.left = ox + 'px'; root.style.top = oy + 'px';
      root.style.right = 'auto'; root.style.bottom = 'auto'; root.style.transform = 'none';
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    root.addEventListener('pointerdown', () => { root.style.zIndex = String(++this._z); });

    const rec = { name, root, body, open: false };
    this._panels.set(name, rec);
    this._place(rec, { left: '50%', top: '90px', transform: 'translateX(-50%)' });
    return rec;
  }

  /**
   * Anchor a window. Always clears all four insets first: a panel pinned to
   * `right`/`bottom` must not inherit a stale `left`/`top`, or the browser
   * resolves the over-constrained box in favour of the wrong edge.
   */
  _place(rec, css) {
    const s = rec.root.style;
    s.left = 'auto'; s.top = 'auto'; s.right = 'auto'; s.bottom = 'auto';
    s.transform = 'none';
    for (const [k, v] of Object.entries(css)) s[k] = v;
  }

  _ensure(name) {
    let rec = this._panels.get(name);
    if (rec) return rec;
    switch (name) {
      case 'inventory': rec = this._buildInventory(); break;
      case 'character': rec = this._buildCharacter(); break;
      case 'skills': rec = this._buildSkills(); break;
      case 'shop': rec = this._buildShop(); break;
      case 'dialog': rec = this._buildDialog(); break;
      case 'map': rec = this._buildMapPanel(); break;
      case 'help': rec = this._buildHelp(); break;
      default:
        console.warn(`[hud] unknown panel '${name}'`);
        return null;
    }
    return rec;
  }

  openPanel(name) {
    const rec = this._ensure(name);
    if (!rec) return;
    rec.root.style.display = '';
    rec.root.style.zIndex = String(++this._z);
    rec.open = true;
    const i = this._stack.indexOf(name);
    if (i >= 0) this._stack.splice(i, 1);
    this._stack.push(name);
    this._refresh(name);
    bus.emit('ui:panel', { name, open: true });
    bus.emit('audio:sfx', { id: 'ui.click' });
  }

  closePanel(name) {
    const rec = this._panels.get(name);
    if (!rec || !rec.open) return;
    rec.root.style.display = 'none';
    rec.open = false;
    const i = this._stack.indexOf(name);
    if (i >= 0) this._stack.splice(i, 1);
    this._hideTip();
    bus.emit('ui:panel', { name, open: false });
  }

  togglePanel(name) {
    const rec = this._panels.get(name);
    if (rec && rec.open) this.closePanel(name);
    else this.openPanel(name);
  }

  closeTopPanel() {
    if (!this._stack.length) return false;
    this.closePanel(this._stack[this._stack.length - 1]);
    return true;
  }

  _refresh(name) {
    switch (name) {
      case 'inventory': this._fillInventory(); break;
      case 'character': this._fillCharacter(); break;
      case 'skills': this._fillSkills(); break;
      case 'shop': this._fillShop(); break;
      case 'dialog': this._fillDialog(); break;
      case 'map': this._fillMap(); break;
      default: break;
    }
  }

  // ---- 背包 ---------------------------------------------------------------

  _buildInventory() {
    const rec = this._window('inventory', '背 包', 'w-inv');
    this._place(rec, { right: '18px', bottom: '132px' });

    const grid = el('div', 'mir-bag', rec.body);
    grid.dataset.drop = 'bagarea';
    rec.slots = [];
    for (let i = 0; i < BAG_SLOTS; i++) {
      const s = el('div', 'mir-slot', grid);
      s.dataset.slot = String(i);
      s.dataset.drop = 'bag';
      const ic = el('i', 'mir-slot-ic', s);
      const q = el('b', 'mir-slot-q', s);
      rec.slots.push({ s, ic, q, uid: -1 });

      s.addEventListener('pointerdown', (e) => {
        const p = this.game.player;
        const it = p && p.inventory.slots[i];
        if (!it) return;
        this._dragStart(e, 'bag', i, this._icon(it.icon));
      });
      s.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = this.game.player;
        const it = p && p.inventory.slots[i];
        if (it) p.inventory.use(it.uid);
      });
      s.addEventListener('pointerenter', () => {
        const p = this.game.player;
        const it = p && p.inventory.slots[i];
        if (it) this._showTip(this._itemTipHTML(it));
      });
      s.addEventListener('pointerleave', () => this._hideTip());
    }

    const foot = el('div', 'mir-bagfoot', rec.body);
    rec.wt = el('span', 'mir-bagwt', foot);
    rec.gold = el('span', 'mir-baggold', foot);
    const hint = el('span', 'mir-hint', foot);
    hint.textContent = '左键拖动摆放　右键使用/装备';
    return rec;
  }

  _fillInventory() {
    const rec = this._panels.get('inventory');
    const p = this.game.player;
    if (!rec || !p) return;
    const inv = p.inventory;
    for (let i = 0; i < rec.slots.length; i++) {
      const cell = rec.slots[i];
      const it = inv.slots[i] || null;
      const uid = it ? it.uid : -1;
      const qty = it && it.qty > 1 ? it.qty : 0;
      if (cell.uid === uid && cell.q.textContent === (qty ? String(qty) : '')) continue;
      cell.uid = uid;
      cell.ic.style.backgroundImage = it ? this._icon(it.icon) : '';
      cell.q.textContent = qty ? String(qty) : '';
      cell.s.classList.toggle('full', !!it);
      cell.s.classList.toggle('rare', !!(it && (it.price || 0) >= 40000));
    }
    const w = inv.weight;
    rec.wt.textContent = `负重 ${Math.round(w)} / ${p.weightMax}`;
    rec.wt.classList.toggle('over', w > p.weightMax);
    rec.gold.textContent = `${p.gold | 0} 金币`;
  }

  // ---- 角色 ---------------------------------------------------------------

  _buildCharacter() {
    const rec = this._window('character', '角 色', 'w-char');
    this._place(rec, { left: '18px', top: '150px' });

    const wrap = el('div', 'mir-char', rec.body);
    const doll = el('div', 'mir-doll', wrap);
    rec.doll = {};
    for (const [slot, area] of DOLL) {
      const cellWrap = el('div', 'mir-doll-cell', doll);
      cellWrap.style.gridArea = area;
      const s = el('div', 'mir-slot mir-eslot', cellWrap);
      s.dataset.drop = 'equip';
      s.dataset.eslot = slot;
      const ic = el('i', 'mir-slot-ic', s);
      const cap = el('span', 'mir-doll-cap', cellWrap);
      cap.textContent = SLOT_CN[slot];
      rec.doll[slot] = { s, ic, uid: -1 };

      s.addEventListener('pointerdown', (e) => {
        const p = this.game.player;
        const it = p && p.equipment[slot];
        if (!it) return;
        this._dragStart(e, 'equip', slot, this._icon(it.icon));
      });
      s.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = this.game.player;
        if (p && p.equipment[slot]) p.inventory.unequip(slot);
      });
      s.addEventListener('pointerenter', () => {
        const p = this.game.player;
        const it = p && p.equipment[slot];
        if (it) this._showTip(this._itemTipHTML(it));
      });
      s.addEventListener('pointerleave', () => this._hideTip());
    }
    const mid = el('div', 'mir-doll-mid', doll);
    mid.style.gridArea = 'm';
    rec.bust = el('div', 'mir-doll-bust', mid);
    rec.who = el('div', 'mir-doll-who', mid);

    rec.stats = el('div', 'mir-statblock', wrap);
    return rec;
  }

  _fillCharacter() {
    const rec = this._panels.get('character');
    const p = this.game.player;
    if (!rec || !p) return;

    for (const [slot] of DOLL) {
      const cell = rec.doll[slot];
      const it = p.equipment[slot] || null;
      const uid = it ? it.uid : -1;
      if (cell.uid === uid) continue;
      cell.uid = uid;
      cell.ic.style.backgroundImage = it ? this._icon(it.icon) : '';
      cell.s.classList.toggle('full', !!it);
    }
    rec.bust.style.backgroundImage = this._portrait(p.klass);
    const cls = CLASSES[p.klass] || CLASSES.warrior;
    rec.who.innerHTML = `<b>${p.name}</b><span>${cls.name} · ${p.level} 级</span>`;

    const wt = Math.round(p.inventory ? p.inventory.weight : 0);
    const rows = [
      ['攻击', `${p.dc[0]}-${p.dc[1]}`],
      ['魔法', `${p.mc[0]}-${p.mc[1]}`],
      ['道术', `${p.sc[0]}-${p.sc[1]}`],
      ['防御', `${p.ac[0]}-${p.ac[1]}`],
      ['魔御', `${p.mac[0]}-${p.mac[1]}`],
      ['准确', String(p.accuracy)],
      ['敏捷', String(p.agility)],
      ['生命', `${Math.round(p.hp)} / ${p.hpMax}`],
      ['魔法值', `${Math.round(p.mp)} / ${p.mpMax}`],
      ['负重', `${wt} / ${p.weightMax}`],
      ['金币', String(p.gold | 0)],
    ];
    rec.stats.innerHTML = rows
      .map(([k, v]) => `<div class="mir-strow"><span>${k}</span><b>${v}</b></div>`)
      .join('');
  }

  // ---- 技能 ---------------------------------------------------------------

  _buildSkills() {
    const rec = this._window('skills', '技 能', 'w-skill');
    this._place(rec, { left: '18px', top: '150px' });
    rec.list = el('div', 'mir-skills', rec.body);
    const hint = el('div', 'mir-hint mir-skillhint', rec.body);
    hint.textContent = '把技能拖到下方快捷栏，或按 F1-F8 施放';
    return rec;
  }

  _fillSkills() {
    const rec = this._panels.get('skills');
    const p = this.game.player;
    if (!rec || !p) return;
    rec.list.innerHTML = '';

    const learned = [];
    const locked = [];
    for (const s of Object.values(SKILLS)) {
      if (s.class !== p.klass) continue;
      (p.skills.has(s.id) ? learned : locked).push(s);
    }
    learned.sort((a, b) => a.level - b.level);
    locked.sort((a, b) => a.level - b.level);

    const head = (txt) => { const h = el('div', 'mir-skillhead', rec.list); h.textContent = txt; };
    const row = (s, on) => {
      const r = el('div', 'mir-skillrow' + (on ? '' : ' off'), rec.list);
      const ic = el('i', 'mir-skillic', r);
      ic.style.backgroundImage = this._icon(s.icon);
      const t = el('div', 'mir-skilltx', r);
      const lv = p.skills.get(s.id);
      t.innerHTML = `<b>${s.name}</b><span>${on ? `${lv ? lv.level : 1} 级　消耗 ${s.mp} 魔法　冷却 ${s.cooldown || 0}s` : `需要等级 ${s.level}`}</span>`;
      if (on) {
        r.dataset.drag = 'skill';
        r.addEventListener('pointerdown', (e) => this._dragStart(e, 'skill', s.id, this._icon(s.icon)));
        r.addEventListener('dblclick', () => {
          const slot = p.hotbar.indexOf(null);
          if (slot >= 0) { p.hotbar[slot] = s.id; this._syncHotbar(true); }
        });
      }
      r.addEventListener('pointerenter', () => this._showTip(this._skillTipHTML(s.id)));
      r.addEventListener('pointerleave', () => this._hideTip());
    };

    head(`已修炼（${learned.length}）`);
    if (!learned.length) { const e2 = el('div', 'mir-empty', rec.list); e2.textContent = '尚未习得任何技能'; }
    for (const s of learned) row(s, true);
    if (locked.length) {
      head('未习得');
      for (const s of locked) row(s, false);
    }
  }

  // ---- 商店 ---------------------------------------------------------------

  _buildShop() {
    const rec = this._window('shop', '交 易', 'w-shop');
    this._place(rec, { left: '50%', top: '110px', transform: 'translateX(-50%)' });
    const cols = el('div', 'mir-shop', rec.body);
    const l = el('div', 'mir-shopcol', cols);
    el('div', 'mir-shophead', l).textContent = '出售中';
    rec.buyList = el('div', 'mir-shoplist', l);
    const r = el('div', 'mir-shopcol', cols);
    el('div', 'mir-shophead', r).textContent = '你的背包';
    rec.sellList = el('div', 'mir-shoplist', r);
    rec.foot = el('div', 'mir-shopfoot', rec.body);
    return rec;
  }

  _fillShop() {
    const rec = this._panels.get('shop');
    const p = this.game.player;
    if (!rec || !p) return;
    const def = this._dialogDef;
    rec.buyList.innerHTML = '';
    rec.sellList.innerHTML = '';

    const wares = (def && def.shop) || [];
    if (!wares.length) {
      const e2 = el('div', 'mir-empty', rec.buyList);
      e2.textContent = '这里没有可买的东西';
    }
    for (const id of wares) {
      const base = ITEMS[id];
      if (!base) continue;
      const r = el('div', 'mir-shoprow', rec.buyList);
      const ic = el('i', 'mir-shopic', r);
      ic.style.backgroundImage = this._icon(base.icon);
      const t = el('div', 'mir-shoptx', r);
      t.innerHTML = `<b>${base.name}</b><span>${base.price || 0} 金</span>`;
      const b = el('button', 'mir-mini', r);
      b.textContent = '买';
      b.addEventListener('click', () => { p.inventory.buy(id, 1); this._fillShop(); });
      r.addEventListener('pointerenter', () => this._showTip(this._catalogTipHTML(id)));
      r.addEventListener('pointerleave', () => this._hideTip());
    }

    let any = false;
    for (const it of p.inventory.slots) {
      if (!it) continue;
      any = true;
      const r = el('div', 'mir-shoprow', rec.sellList);
      const ic = el('i', 'mir-shopic', r);
      ic.style.backgroundImage = this._icon(it.icon);
      const t = el('div', 'mir-shoptx', r);
      const gold = Math.max(1, Math.floor((it.price || 1) * 0.4)) * it.qty;
      t.innerHTML = `<b>${it.name}${it.qty > 1 ? ' ×' + it.qty : ''}</b><span>可卖 ${gold} 金</span>`;
      const b = el('button', 'mir-mini sell', r);
      b.textContent = '卖';
      b.addEventListener('click', () => { p.inventory.sell(it.uid); this._fillShop(); });
      r.addEventListener('pointerenter', () => this._showTip(this._itemTipHTML(it)));
      r.addEventListener('pointerleave', () => this._hideTip());
    }
    if (!any) { const e2 = el('div', 'mir-empty', rec.sellList); e2.textContent = '背包空空如也'; }

    rec.foot.textContent = `${(def && def.name) || '商人'}　·　你有 ${p.gold | 0} 金币`;
  }

  _catalogTipHTML(id) {
    const base = ITEMS[id];
    if (!base) return '';
    // Build a display-only instance so tooltips read identically to bag items.
    const fake = {
      id, name: base.name, type: base.type, slot: base.slot, icon: base.icon,
      qty: 1, weight: base.weight || 1, price: base.price || 1,
      reqLevel: base.reqLevel || 0, klass: base.class || null,
      durability: base.durability ? [base.durability, base.durability] : null,
      desc: base.desc || '', stats: {},
    };
    for (const [k, v] of Object.entries(base.stats || {})) {
      if (Array.isArray(v) && Array.isArray(v[0])) fake.stats[k] = [v[0][0], v[1][1]];
      else fake.stats[k] = v;
    }
    return this._itemTipHTML(fake);
  }

  // ---- NPC 对话 -----------------------------------------------------------

  _buildDialog() {
    const rec = this._window('dialog', '对 话', 'w-dialog');
    this._place(rec, { left: '50%', bottom: '150px', transform: 'translateX(-50%)' });
    rec.who = el('div', 'mir-dlg-who', rec.body);
    rec.text = el('div', 'mir-dlg-text', rec.body);
    rec.acts = el('div', 'mir-dlg-acts', rec.body);
    return rec;
  }

  _fillDialog() {
    const rec = this._panels.get('dialog');
    const p = this.game.player;
    const def = this._dialogDef;
    if (!rec || !def) return;
    rec.who.innerHTML = `<b>${def.name}</b><span>${def.title || ''}</span>`;
    const lines = def.dialog || ['……'];
    rec.text.textContent = lines[(Math.random() * lines.length) | 0];
    rec.acts.innerHTML = '';

    const act = (label, fn) => {
      const b = el('button', 'mir-dbtn', rec.acts);
      b.textContent = label;
      b.addEventListener('click', () => { bus.emit('audio:sfx', { id: 'ui.click' }); fn(); });
      return b;
    };

    if (def.shop && def.shop.length) {
      act(def.role === 'trainer' ? '学习技能' : '购买物品', () => this.openPanel('shop'));
    }
    if (def.role !== 'trainer') act('出售物品', () => this.openPanel('shop'));
    if (def.role === 'storage') act('打开仓库', () => this.chat('张管事说：仓库还在修，改日再来。', 'system'));
    if (def.role === 'teleport') {
      act('传送', () => {
        rec.acts.innerHTML = '';
        for (const id of MAP_ORDER) {
          const m = MAPS[id];
          if (!m || (this.game.world && id === this.game.world.mapId)) continue;
          act(m.name, () => {
            this.closePanel('dialog');
            bus.emit('portal:enter', { to: id, toEntry: m.entry });
          });
        }
        act('算了', () => this._fillDialog());
      });
    }
    if (def.role === 'trainer' && p && def.teaches && def.teaches !== p.klass) {
      rec.text.textContent = '你不是我这一门的，去找你自己的师父吧。';
    }
    act('离开', () => this.closePanel('dialog'));
  }

  // ---- 大地图 -------------------------------------------------------------

  _buildMapPanel() {
    const rec = this._window('map', '大 地 图', 'w-map');
    this._place(rec, { left: '50%', top: '80px', transform: 'translateX(-50%)' });
    const wrap = el('div', 'mir-mapwrap', rec.body);
    const c = el('canvas', 'mir-mapcv', wrap);
    c.width = 384; c.height = 384;
    rec.cv = c;
    rec.side = el('div', 'mir-mapside', wrap);
    return rec;
  }

  _fillMap() {
    const rec = this._panels.get('map');
    const w = this.game.world, p = this.game.player;
    if (!rec || !w || !p || !this._mmBase) return;
    const g = rec.cv.getContext('2d');
    const S = rec.cv.width;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, S, S);
    g.drawImage(this._mmBase, 0, 0, this._mmBase.width, this._mmBase.height, 0, 0, S, S);

    const kx = S / w.def.width, kz = S / w.def.height;

    g.font = '11px "Songti SC","SimSun",serif';
    g.textAlign = 'center';
    for (const n of w.def.npcs || []) {
      const x = n.x * kx, y = n.z * kz;
      const label = (NPCS[n.id] && NPCS[n.id].name) || n.id;
      g.fillStyle = '#ffdc6a';
      g.fillRect(x - 2.5, y - 2.5, 5, 5);
      g.fillStyle = 'rgba(0,0,0,0.8)';
      g.fillText(label, x + 1, y - 5);
      g.fillStyle = '#f3e0aa';
      g.fillText(label, x, y - 6);
    }
    for (const pt of w.def.portals || []) {
      const x = pt.x * kx, y = pt.z * kz;
      g.fillStyle = 'rgba(120,220,255,0.9)';
      g.beginPath(); g.arc(x, y, 4.5, 0, 6.2832); g.fill();
      g.strokeStyle = '#0a1a22'; g.lineWidth = 1; g.stroke();
      if (pt.label) {
        g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillText(pt.label, x + 1, y + 15);
        g.fillStyle = '#bff0ff'; g.fillText(pt.label, x, y + 14);
      }
    }
    const px = p.position.x * kx, py = p.position.z * kz;
    g.fillStyle = '#fff6d8'; g.strokeStyle = '#1a1206'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(px, py, 5, 0, 6.2832); g.fill(); g.stroke();

    rec.side.innerHTML = `<div class="mir-mapname">${w.def.name}</div>
      <div class="mir-mapmeta">${w.def.width}×${w.def.height}　${w.def.safeZone ? '安全区' : '危险区域'}</div>
      <div class="mir-maplegend">
        <span><i class="lg lg-p"></i>你</span>
        <span><i class="lg lg-n"></i>NPC</span>
        <span><i class="lg lg-t"></i>传送点</span>
      </div>
      <div class="mir-maphead">玛法大陆</div>` +
      MAP_ORDER.map((id) => {
        const m = MAPS[id];
        if (!m) return '';
        return `<div class="mir-maprow${id === w.mapId ? ' on' : ''}">${m.name}</div>`;
      }).join('');
  }

  // ---- 帮助 ---------------------------------------------------------------

  _buildHelp() {
    const rec = this._window('help', '操 作 说 明', 'w-help');
    this._place(rec, { left: '50%', top: '110px', transform: 'translateX(-50%)' });
    const rows = [
      ['左键点击地面', '走向该处'],
      ['左键点击怪物', '追击并攻击'],
      ['左键点击 NPC', '走过去对话'],
      ['按住右键 / Shift', '奔跑'],
      ['滚轮', '拉近拉远视角'],
      ['F1 - F8 / 1 - 8', '施放快捷栏技能'],
      ['Z / 空格', '喝治疗药水'],
      ['X', '喝魔法药水'],
      ['E / G', '拾取脚下物品、与身边互动'],
      ['T', '自动拾取开关'],
      ['B / I', '背包'],
      ['C', '角色'],
      ['K', '技能'],
      ['M', '大地图'],
      ['H', '本说明'],
      ['Esc', '关闭最上层窗口'],
      ['P', '暂停'],
      ['[ / ]', '拨动时辰'],
      ['+ / -', '升降画质'],
    ];
    rec.body.innerHTML = `<div class="mir-help">${rows
      .map(([k, v]) => `<div class="mir-helprow"><kbd>${k}</kbd><span>${v}</span></div>`)
      .join('')}</div>`;
    return rec;
  }

  // -------------------------------------------------------------------------

  dispose() {
    for (const off of this._offs) { try { off(); } catch (e) { /* already gone */ } }
    this._offs.length = 0;

    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('pointermove', this._onMove);
    document.removeEventListener('pointerup', this._onUp);
    this.root.removeEventListener('contextmenu', this._onCtx);

    if (this._drag && this._drag.ghost) this._drag.ghost.remove();
    this._drag = null;

    for (const node of [this.elVitals, this.elMinimap, this.elChatBox, this.elCmdBar, this.elTip, this.elDeath]) {
      node?.remove();
    }
    for (const d of this._dmg) d.n.remove();
    for (const p of this._plates) p.n.remove();
    for (const l of this._labels) l.n.remove();
    for (const rec of this._panels.values()) rec.root.remove();
    this._panels.clear();
    this._stack.length = 0;
    while (this.elToast && this.elToast.firstChild) this.elToast.removeChild(this.elToast.firstChild);

    const s = document.documentElement.style;
    for (const k of this._setVars || []) s.removeProperty(k);

    this._iconCache.clear();
    this._mmBase = null;
    this.mmCtx = null;
    this.mmCanvas = null;
    this._dmg.length = 0;
    this._plates.length = 0;
    this._labels.length = 0;
    this.hovered = null;
  }
}

export default Hud;
