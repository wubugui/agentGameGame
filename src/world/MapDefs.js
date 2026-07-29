/**
 * All world content data. See docs/CONTRACTS.md §7.
 *
 * Everything here is hand-authored layout, not noise: 比奇省 is a walled town
 * with four gates, a paved main street lined with shops and a temple closing the
 * north end; the dungeons are real floor plans (corridors, pillared halls, side
 * chambers, an altar room) painted onto a coarse cell grid and then decomposed
 * into wall boxes, so the player navigates architecture rather than an open
 * field with props sprinkled over it.
 *
 * Coordinate conventions, matching the rest of the engine:
 *   - `entry`, `respawn`, `portals[].x/.z` and `spawns[].area` are **tile
 *     indices** (integers). Game.js / World.js add the +0.5 tile-centre offset.
 *   - `structures[].x/.z` and `npcs[].x/.z` are **world units** (a tile centre is
 *     `tile + 0.5`), because Props and Npc place meshes directly.
 *
 * Structure shape produced here (a superset of the contract's `{kind,x,z,rot}`):
 *   { kind, x, z, rot,            // centre + yaw
 *     w, d, h,                    // box footprint / height, boxes only
 *     len, x1, z1, x2, z2,        // centreline of the long axis, boxes only
 *     r,                          // blocking radius, point props only
 *     style }                     // 'stone'|'temple'|'sand'|'cave'|'lava'|'wood'
 * Point props carry no w/d; use `structureBlockers(def)` (exported below) to get
 * the `[{x,z,r}]` circle list the nav grid wants, or `applyStructuresToNav()` for
 * an exact and much cheaper rectangle fill.
 */

const PI = Math.PI;
const HALF_PI = PI / 2;

// ---------------------------------------------------------------------------
// 0. Structure helpers
// ---------------------------------------------------------------------------

/** Axis-aligned box from world-space bounds. */
function box(kind, ax, az, bx, bz, o = {}) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
  const z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  const w = x1 - x0, d = z1 - z0;
  const along = w >= d;
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
  return {
    ...o,
    kind, x, z,
    rot: o.rot ?? 0,
    w, d,
    h: o.h ?? 4,
    len: along ? w : d,
    x1: along ? x0 : x, z1: along ? z : z0,
    x2: along ? x1 : x, z2: along ? z : z1,
  };
}

/** Box given a centre and size. */
function bld(kind, x, z, w, d, o = {}) {
  return box(kind, x - w / 2, z - d / 2, x + w / 2, z + d / 2, o);
}

/** Point prop (pillar, brazier, cart, …). */
function pt(kind, x, z, rot = 0, o = {}) {
  return { ...o, kind, x, z, rot };
}

/** Split [from,to] around a sorted list of [g0,g1] gaps. */
function spans(from, to, gaps) {
  const out = [];
  let cursor = from;
  for (const [g0, g1] of gaps) {
    if (g0 > cursor) out.push([cursor, g0]);
    if (g1 > cursor) cursor = g1;
  }
  if (to > cursor) out.push([cursor, to]);
  return out;
}

/**
 * A rectangular curtain wall with gates punched through it.
 * @param {Array} out            structures array to append to
 * @param {number} ax,az,bx,bz   outer footprint in world units
 * @param {number} thick         wall thickness
 * @param {Array}  gates         [{ side:'n'|'s'|'e'|'w', at, width }]
 */
function townWalls(out, ax, az, bx, bz, thick, gates, o = {}) {
  const h = o.h ?? 7;
  const style = o.style ?? 'stone';
  const t = thick / 2;
  const pick = (side) => gates
    .filter((g) => g.side === side)
    .map((g) => [g.at - g.width / 2, g.at + g.width / 2])
    .sort((p, q) => p[0] - q[0]);

  for (const [s, e] of spans(ax, bx, pick('n'))) out.push(box('wall.town', s, az - t, e, az + t, { h, style }));
  for (const [s, e] of spans(ax, bx, pick('s'))) out.push(box('wall.town', s, bz - t, e, bz + t, { h, style }));
  for (const [s, e] of spans(az, bz, pick('w'))) out.push(box('wall.town', ax - t, s, ax + t, e, { h, style }));
  for (const [s, e] of spans(az, bz, pick('e'))) out.push(box('wall.town', bx - t, s, bx + t, e, { h, style }));

  for (const g of gates) {
    const horizontal = g.side === 'n' || g.side === 's';
    const gx = horizontal ? g.at : (g.side === 'w' ? ax : bx);
    const gz = horizontal ? (g.side === 'n' ? az : bz) : g.at;
    out.push(pt('gate.town', gx, gz, horizontal ? 0 : HALF_PI, {
      w: horizontal ? g.width : thick,
      d: horizontal ? thick : g.width,
      h: h + 3, style, span: g.width, walkable: true,
    }));
  }
}

/** A run of fence posts between two points. */
function fenceRun(out, ax, az, bx, bz, step = 3, o = {}) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / step));
  const rot = Math.atan2(dx, dz);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const mx = ax + dx * (t0 + t1) / 2, mz = az + dz * (t0 + t1) / 2;
    out.push(pt('fence', mx, mz, rot, { len: len / n, h: 1.2, ...o }));
  }
}

// ---------------------------------------------------------------------------
// 1. Cell painter — dungeons are drawn on a coarse grid, then vectorised
// ---------------------------------------------------------------------------

const SOLID = '#';
const FLOOR = '.';

/** Marker char -> prop. All markers are walkable floor apart from lava. */
const CELL_PROPS = {
  P: { kind: 'temple.pillar', r: 0.8 },
  B: { kind: 'brazier', r: 0.55 },
  A: { kind: 'altar', r: 1.5 },
  T: { kind: 'torch.wall', r: 0 },
  C: { kind: 'crate', r: 0.65 },
  K: { kind: 'barrel', r: 0.5 },
  R: { kind: 'tomb.stone', r: 0.8 },
  G: { kind: 'statue.beast', r: 1.25 },
  V: { kind: 'banner.pole', r: 0.4 },
  L: { kind: 'lava.pool', r: 1.7 },
  M: { kind: 'cave.mouth', r: 0 },
  S: { kind: 'stairs', r: 0 },
  W: { kind: 'well', r: 1.15 },
};

class CellGrid {
  constructor(cols, rows, cell) {
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.g = [];
    for (let r = 0; r < rows; r++) this.g.push(new Array(cols).fill(SOLID));
    /** name -> { x, z } tile indices */
    this.marks = {};
  }

  set(c, r, ch) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;
    this.g[r][c] = ch;
  }

  get(c, r) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return SOLID;
    return this.g[r][c];
  }

  isFloor(c, r) { return this.get(c, r) !== SOLID; }

  /** Carve an inclusive rectangle of floor. This is the only excavation verb. */
  room(c0, r0, c1, r1, ch = FLOOR) {
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) this.set(c, r, ch);
    }
    return this;
  }

  /** Stamp props on a lattice inside an already-carved room. */
  lattice(c0, r0, c1, r1, stepC, stepR, ch) {
    for (let r = r0; r <= r1; r += stepR) {
      for (let c = c0; c <= c1; c += stepC) if (this.isFloor(c, r)) this.set(c, r, ch);
    }
    return this;
  }

  put(c, r, ch) { if (this.isFloor(c, r)) this.set(c, r, ch); return this; }

  putAll(list, ch) { for (const [c, r] of list) this.put(c, r, ch); return this; }

  /** Tile-index centre of a cell. Integers, which is what portals/entry want. */
  center(c, r) {
    return { x: Math.floor(c * this.cell + this.cell / 2), z: Math.floor(r * this.cell + this.cell / 2) };
  }

  /** Record a named anchor (and make sure the cell is floor). */
  mark(name, c, r) {
    if (!this.isFloor(c, r)) this.set(c, r, FLOOR);
    this.marks[name] = this.center(c, r);
    return this;
  }

  /** Inscribed spawn area for an inclusive cell rectangle. */
  area(c0, r0, c1, r1, shrink = 1.0) {
    const x0 = c0 * this.cell, x1 = (c1 + 1) * this.cell;
    const z0 = r0 * this.cell, z1 = (r1 + 1) * this.cell;
    return {
      x: Math.floor((x0 + x1) / 2),
      z: Math.floor((z0 + z1) / 2),
      r: Math.max(2, Math.floor(Math.min(x1 - x0, z1 - z0) / 2 - shrink)),
    };
  }
}

/**
 * Turn a painted grid into structures.
 *
 * Two passes, both greedy maximal-rectangle decompositions, so a 25-cell
 * corridor wall is one long box rather than 25 cubes:
 *
 *   1. solid cells that touch floor (8-neighbourhood) -> visible wall boxes;
 *   2. everything still solid                         -> `hidden: true` boxes.
 *
 * Pass 2 exists purely so the nav grid marks the whole rock mass unwalkable;
 * those boxes sit entirely behind the shell from pass 1, so Props may skip
 * building geometry for anything flagged `hidden`.
 */
function buildCells(grid, o = {}) {
  const { cols, rows, cell } = grid;
  const wallKind = o.wall || 'wall.town';
  const style = o.style || 'stone';
  const h = o.wallHeight ?? 6;
  const out = [];

  const face = [];
  for (let r = 0; r < rows; r++) {
    const row = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      if (grid.get(c, r) !== SOLID) continue;
      let touches = false;
      for (let dr = -1; dr <= 1 && !touches; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          if (grid.isFloor(c + dc, r + dr)) { touches = true; break; }
        }
      }
      row[c] = touches ? 1 : 0;
    }
    face.push(row);
  }

  const used = [];
  for (let r = 0; r < rows; r++) used.push(new Uint8Array(cols));

  /** Greedy maximal-rectangle decomposition of whatever `take` accepts. */
  const decompose = (take, extra) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (used[r][c] || !take(c, r)) continue;
        let w = 1;
        while (c + w < cols && !used[r][c + w] && take(c + w, r)) w++;
        let hgt = 1;
        grow: while (r + hgt < rows) {
          for (let k = 0; k < w; k++) if (used[r + hgt][c + k] || !take(c + k, r + hgt)) break grow;
          hgt++;
        }
        for (let rr = r; rr < r + hgt; rr++) for (let cc = c; cc < c + w; cc++) used[rr][cc] = 1;
        out.push(box(wallKind, c * cell, r * cell, (c + w) * cell, (r + hgt) * cell, { h, style, ...extra }));
      }
    }
  };

  // Visible shell first, then the dead rock behind it. The second pass exists so
  // the nav grid marks the whole mass unwalkable — `hidden` boxes are entirely
  // enclosed by the shell, so Props is free to skip building geometry for them.
  decompose((c, r) => face[r][c] === 1, null);
  decompose((c, r) => grid.get(c, r) === SOLID, { hidden: true, h: h * 0.5 });

  // Props from markers.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid.get(c, r);
      const def = CELL_PROPS[ch];
      if (!def) continue;
      const cx = c * cell + cell / 2, cz = r * cell + cell / 2;
      let rot = 0;
      if (ch === 'T') {
        // Wall torches hang off the wall they back onto.
        if (!grid.isFloor(c, r - 1)) rot = 0;
        else if (!grid.isFloor(c, r + 1)) rot = PI;
        else if (!grid.isFloor(c + 1, r)) rot = -HALF_PI;
        else if (!grid.isFloor(c - 1, r)) rot = HALF_PI;
      }
      out.push(pt(def.kind, cx, cz, rot, { r: def.r, style }));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 2. 比奇省 — starter town
// ---------------------------------------------------------------------------

/*
 * Plan (128 x 128). North is -Z.
 *
 *          ┌───────── 北门 ─────────┐
 *          │      天 王 庙 (temple)  │
 *   西门 ──┤   住宅   ╬ 中央广场 ╬  市集 ├── 东门
 *          │  武器店│主街│杂货店      │
 *          │  药 店 │主街│客 栈       │
 *          │  裁缝店│主街│仓 库       │
 *          └───────── 南门 ─────────┘
 *
 * Streets kept clear: N-S main street x 60..68 for the full height, E-W street
 * z 60..68 for the full width, plaza 56..72 square. Every building sits at least
 * two tiles back from a street edge.
 */
function buildBichon() {
  const st = [];
  const AX = 24, AZ = 24, BX = 104, BZ = 104;

  townWalls(st, AX, AZ, BX, BZ, 2.5, [
    { side: 'n', at: 64, width: 9 },
    { side: 's', at: 64, width: 9 },
    { side: 'w', at: 64, width: 9 },
    { side: 'e', at: 64, width: 9 },
  ], { h: 7.5, style: 'stone' });

  // Corner watchtowers.
  for (const [x, z] of [[AX, AZ], [BX, AZ], [AX, BZ], [BX, BZ]]) {
    st.push(bld('wall.town', x, z, 7, 7, { h: 10.5, style: 'stone', tower: true }));
  }
  // Gate banners.
  for (const [x, z, rot] of [[58, 27, 0], [70, 27, 0], [58, 101, PI], [70, 101, PI],
    [27, 58, HALF_PI], [27, 70, HALF_PI], [101, 58, -HALF_PI], [101, 70, -HALF_PI]]) {
    st.push(pt('banner.pole', x, z, rot, { r: 0.4, style: 'stone' }));
  }

  // ---- 天王庙 the temple closing the north end of the main street ---------
  st.push(bld('temple.hall', 64, 40, 26, 17, { h: 13, style: 'temple' }));
  for (const z of [50, 54, 58]) {
    st.push(pt('temple.pillar', 54, z, 0, { r: 0.85, style: 'temple' }));
    st.push(pt('temple.pillar', 74, z, 0, { r: 0.85, style: 'temple' }));
  }
  st.push(pt('brazier', 56, 50, 0, { r: 0.6 }));
  st.push(pt('brazier', 72, 50, 0, { r: 0.6 }));
  st.push(pt('statue.beast', 48, 40, HALF_PI, { r: 1.3, style: 'temple' }));
  st.push(pt('statue.beast', 80, 40, -HALF_PI, { r: 1.3, style: 'temple' }));
  st.push(pt('torch.wall', 57, 48.6, PI, { r: 0 }));
  st.push(pt('torch.wall', 71, 48.6, PI, { r: 0 }));

  // ---- 中央广场 plaza + well --------------------------------------------
  st.push(pt('well', 64, 64, 0, { r: 1.15 }));
  for (const [x, z] of [[58, 58], [70, 58], [58, 70], [70, 70]]) {
    st.push(pt('banner.pole', x, z, 0, { r: 0.4 }));
  }

  // ---- 主街 shops, west side --------------------------------------------
  st.push(bld('shop', 51, 74, 14, 10, { h: 6.5, style: 'wood', sign: '武器店' }));
  st.push(bld('shop', 51, 88, 14, 10, { h: 6.5, style: 'wood', sign: '药店' }));
  st.push(bld('shop', 51, 98, 14, 8, { h: 6.5, style: 'wood', sign: '裁缝店' }));
  // ---- 主街 shops, east side --------------------------------------------
  st.push(bld('shop', 77, 74, 14, 10, { h: 6.5, style: 'wood', sign: '杂货店' }));
  st.push(bld('inn', 77, 88, 14, 12, { h: 8.5, style: 'wood', sign: '客栈' }));
  st.push(bld('shop', 77, 98, 14, 8, { h: 6.5, style: 'wood', sign: '仓库' }));

  // Shop-front clutter, always outside the footprint and off the street.
  for (const [x, z] of [[59, 69.5], [59, 79.5], [59, 83.5], [59.5, 93.5]]) st.push(pt('crate', x, z, 0, { r: 0.65 }));
  for (const [x, z] of [[69.5, 69.5], [69.5, 79.5], [69.5, 82.5]]) st.push(pt('barrel', x, z, 0, { r: 0.5 }));
  st.push(pt('cart', 86, 95, HALF_PI, { r: 1.0 }));

  // ---- 东市 market stalls flanking the east street -----------------------
  // Two rows of trestles either side of the road, with a service lane at x 85..89
  // left open so the eastern houses stay reachable.
  for (const x of [72, 80, 94]) st.push(pt('cart', x, 57.5, 0, { r: 1.0, stall: true }));
  for (const x of [88, 96]) st.push(pt('cart', x, 70.5, PI, { r: 1.0, stall: true }));
  for (const [x, z] of [[75, 57.5], [83, 57.5], [97, 57.5], [91, 70.5]]) st.push(pt('crate', x, z, 0, { r: 0.65 }));
  for (const [x, z] of [[99, 70.5], [85, 70.5]]) st.push(pt('barrel', x, z, 0, { r: 0.5 }));
  for (const [x, z] of [[76, 54], [92, 54], [92, 74]]) st.push(pt('banner.pole', x, z, 0, { r: 0.4 }));

  // ---- residential quarters ----------------------------------------------
  // Two lanes, x 41..50 and x 85..88, run the full height of the town so the
  // north and south gates connect to the ring streets around the temple.
  st.push(bld('house.thatch', 33, 32, 12, 9, { h: 6, style: 'wood' }));
  st.push(bld('house.thatch', 33, 45, 12, 9, { h: 6, style: 'wood' }));
  st.push(bld('house.thatch', 33, 76, 12, 9, { h: 6, style: 'wood' }));
  st.push(bld('house.thatch', 33, 89, 12, 9, { h: 6, style: 'wood' }));
  st.push(bld('house.tiled', 95, 32, 12, 9, { h: 7, style: 'wood' }));
  st.push(bld('house.tiled', 95, 45, 12, 9, { h: 7, style: 'wood' }));
  st.push(bld('house.tiled', 95, 78, 12, 9, { h: 7, style: 'wood' }));
  st.push(bld('house.tiled', 95, 91, 12, 9, { h: 7, style: 'wood' }));

  fenceRun(st, 27, 38.5, 39, 38.5, 3);
  fenceRun(st, 27, 82.5, 39, 82.5, 3);
  fenceRun(st, 89, 38.5, 101, 38.5, 3);
  fenceRun(st, 89, 84.5, 101, 84.5, 3);
  st.push(pt('cart', 44, 52, HALF_PI, { r: 1.0 }));
  st.push(pt('cart', 44, 84, 0, { r: 1.0 }));
  st.push(pt('crate', 30, 52, 0, { r: 0.65 }));
  st.push(pt('barrel', 32, 53, 0, { r: 0.5 }));

  return {
    id: 'bichon',
    name: '比奇省',
    biome: 'meadow',
    width: 128, height: 128,
    safeZone: true,
    sky: 'day',
    weather: ['clear', 'clear', 'clear', 'rain'],
    ambientLoop: 'town',
    music: 'town',
    grade: 'normal',
    seed: 20011128,
    entry: { x: 64, z: 96 },
    respawn: { x: 64, z: 96 },
    respawnMap: 'bichon',
    terrain: {
      base: 'grass',
      heightScale: 1.6,
      roads: [
        { width: 9, surface: 'cobble', pts: [[64, 20], [64, 108]] },
        { width: 9, surface: 'cobble', pts: [[20, 64], [108, 64]] },
        { width: 14, surface: 'stone.floor', pts: [[64, 56], [64, 72]] },
        { width: 7, surface: 'dirt.road', pts: [[64, 108], [64, 127]] },
      ],
      groves: [
        { x: 40, z: 62, r: 7, density: 0.35 },
        { x: 88, z: 62, r: 6, density: 0.3 },
        { x: 16, z: 16, r: 14, density: 0.9 },
        { x: 112, z: 112, r: 14, density: 0.9 },
        { x: 16, z: 112, r: 14, density: 0.9 },
        { x: 112, z: 16, r: 14, density: 0.9 },
      ],
    },
    structures: st,
    npcs: [
      { id: 'blacksmith', x: 59.5, z: 74, facing: HALF_PI },
      { id: 'apothecary', x: 59.5, z: 88, facing: HALF_PI },
      { id: 'tailor', x: 59.5, z: 98, facing: HALF_PI },
      { id: 'grocer', x: 69.5, z: 74, facing: -HALF_PI },
      { id: 'storekeeper', x: 69.5, z: 99, facing: -HALF_PI },
      { id: 'teleporter', x: 98.5, z: 66.5, facing: -HALF_PI },
      { id: 'master_warrior', x: 56.5, z: 54.5, facing: HALF_PI },
      { id: 'master_mage', x: 71.5, z: 54.5, facing: -HALF_PI },
      { id: 'master_taoist', x: 64.5, z: 52.5, facing: 0 },
    ],
    spawns: [],
    portals: [
      { x: 64, z: 110, to: 'bichon_field', toEntry: { x: 80, z: 10 }, label: '比奇城外' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. 比奇城外 — the low-level meadow
// ---------------------------------------------------------------------------

function buildBichonField() {
  const st = [];

  // Road markers leading north to the town gate.
  for (const z of [14, 26, 38, 54, 68, 84]) {
    st.push(pt('banner.pole', 75, z, 0, { r: 0.4 }));
    st.push(pt('banner.pole', 85, z, 0, { r: 0.4 }));
  }
  st.push(pt('brazier', 74, 46, 0, { r: 0.6 }));
  st.push(pt('brazier', 86, 46, 0, { r: 0.6 }));

  // 大桥 — the only crossing of the river at z ≈ 96..108.
  st.push(bld('bridge', 80, 102, 12, 18, { h: 1.6, style: 'stone', walkable: true }));
  st.push(pt('banner.pole', 74, 93, 0, { r: 0.4 }));
  st.push(pt('banner.pole', 86, 93, 0, { r: 0.4 }));
  st.push(pt('torch.wall', 74.5, 111, PI, { r: 0 }));
  st.push(pt('torch.wall', 85.5, 111, PI, { r: 0 }));

  // 老农的院子 — a working farm west of the road.
  st.push(bld('house.thatch', 44, 40, 14, 10, { h: 6, style: 'wood' }));
  st.push(bld('house.thatch', 34, 52, 10, 8, { h: 5, style: 'wood' }));
  st.push(pt('well', 54, 38, 0, { r: 1.15 }));
  st.push(pt('cart', 52, 46, HALF_PI, { r: 1.0 }));
  st.push(pt('crate', 38, 46, 0, { r: 0.65 }));
  st.push(pt('barrel', 40, 47, 0, { r: 0.5 }));
  fenceRun(st, 30, 30, 62, 30, 3);
  fenceRun(st, 62, 30, 62, 58, 3);
  fenceRun(st, 30, 58, 62, 58, 3);

  // 东边的猎户 — a second homestead by the eastern meadow.
  st.push(bld('house.thatch', 124, 36, 14, 10, { h: 6, style: 'wood' }));
  st.push(pt('cart', 132, 44, 0, { r: 1.0 }));
  st.push(pt('crate', 116, 42, 0, { r: 0.65 }));
  fenceRun(st, 108, 28, 140, 28, 3);
  fenceRun(st, 140, 28, 140, 52, 3);

  // 石墓阵 cave mouth, tucked into the western cliffs.
  st.push(pt('cave.mouth', 26, 132, 0, { r: 0, style: 'cave', span: 8 }));
  st.push(pt('brazier', 21, 130, 0, { r: 0.6 }));
  st.push(pt('brazier', 31, 130, 0, { r: 0.6 }));
  st.push(pt('tomb.stone', 20, 122, 0, { r: 0.8 }));
  st.push(pt('tomb.stone', 33, 124, 0, { r: 0.8 }));
  st.push(bld('house.thatch', 40, 120, 12, 9, { h: 5.5, style: 'wood' }));

  // 沃玛寺庙 gate, at the far south-east.
  st.push(pt('cave.mouth', 134, 126, 0, { r: 0, style: 'temple', span: 9 }));
  st.push(pt('temple.pillar', 128, 124, 0, { r: 0.85, style: 'temple' }));
  st.push(pt('temple.pillar', 140, 124, 0, { r: 0.85, style: 'temple' }));
  st.push(pt('brazier', 128, 130, 0, { r: 0.6 }));
  st.push(pt('brazier', 140, 130, 0, { r: 0.6 }));
  st.push(pt('statue.beast', 122, 120, HALF_PI, { r: 1.25, style: 'temple' }));

  // 通往盟重的商道 — waystones on the eastern road.
  for (const x of [104, 118, 132, 146]) st.push(pt('banner.pole', x, 71, 0, { r: 0.4 }));
  st.push(pt('cart', 140, 80, -HALF_PI, { r: 1.0 }));
  st.push(pt('crate', 143, 82, 0, { r: 0.65 }));

  return {
    id: 'bichon_field',
    name: '比奇城外',
    biome: 'meadow',
    width: 160, height: 160,
    safeZone: false,
    sky: 'day',
    weather: ['clear', 'clear', 'rain', 'fog'],
    ambientLoop: 'field',
    music: 'field',
    grade: 'normal',
    seed: 19981015,
    entry: { x: 80, z: 12 },
    respawn: { x: 64, z: 96 },
    respawnMap: 'bichon',
    terrain: {
      base: 'grass',
      heightScale: 5.5,
      water: [{ x0: 0, z0: 96, x1: 160, z1: 108, level: -0.9, kind: 'river' }],
      roads: [
        { width: 8, surface: 'dirt.road', pts: [[80, 0], [80, 92], [80, 112], [80, 152]] },
        { width: 6, surface: 'dirt.road', pts: [[80, 76], [120, 74], [158, 76]] },
        { width: 5, surface: 'dirt.road', pts: [[80, 118], [52, 126], [30, 132]] },
        { width: 5, surface: 'dirt.road', pts: [[80, 118], [112, 124], [132, 128]] },
      ],
      groves: [
        { x: 24, z: 46, r: 18, density: 1.0 },
        { x: 20, z: 84, r: 16, density: 0.9 },
        { x: 132, z: 62, r: 18, density: 0.9 },
        { x: 108, z: 100, r: 14, density: 0.8 },
        { x: 46, z: 100, r: 14, density: 0.8 },
        { x: 60, z: 140, r: 20, density: 1.0 },
        { x: 120, z: 148, r: 18, density: 1.0 },
      ],
    },
    structures: st,
    npcs: [],
    spawns: [
      { monster: 'chicken', count: 10, area: { x: 46, z: 36, r: 13 }, leash: 12 },
      { monster: 'hen', count: 6, area: { x: 40, z: 50, r: 9 }, leash: 10 },
      { monster: 'deer', count: 8, area: { x: 118, z: 46, r: 16 }, leash: 18 },
      { monster: 'deer', count: 6, area: { x: 30, z: 72, r: 14 }, leash: 18 },
      { monster: 'scarecrow', count: 7, area: { x: 46, z: 44, r: 14 }, leash: 6 },
      { monster: 'multi_horn', count: 11, area: { x: 30, z: 96, r: 15 }, leash: 14 },
      { monster: 'multi_horn', count: 8, area: { x: 126, z: 96, r: 15 }, leash: 14 },
      { monster: 'spider_small', count: 8, area: { x: 24, z: 50, r: 14 }, leash: 12 },
      { monster: 'spider_small', count: 6, area: { x: 134, z: 62, r: 14 }, leash: 12 },
      { monster: 'hungry_wolf', count: 7, area: { x: 118, z: 134, r: 16 }, leash: 18 },
      { monster: 'hungry_wolf', count: 5, area: { x: 62, z: 142, r: 16 }, leash: 18 },
      { monster: 'cave_bat', count: 6, area: { x: 38, z: 132, r: 12 }, leash: 12 },
    ],
    portals: [
      { x: 80, z: 6, to: 'bichon', toEntry: { x: 64, z: 100 }, label: '比奇省' },
      { x: 26, z: 136, to: 'stonetomb', toEntry: { x: 62, z: 114 }, label: '石墓阵' },
      { x: 134, z: 130, to: 'woma', toEntry: { x: 62, z: 114 }, label: '沃玛寺庙' },
      { x: 156, z: 76, to: 'mongchon', toEntry: { x: 22, z: 64 }, label: '盟重土城' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. 盟重土城 — desert town
// ---------------------------------------------------------------------------

function buildMongchon() {
  const st = [];
  const AX = 26, AZ = 26, BX = 102, BZ = 102;

  townWalls(st, AX, AZ, BX, BZ, 3.5, [
    { side: 'n', at: 64, width: 10 },
    { side: 's', at: 64, width: 10 },
    { side: 'w', at: 64, width: 10 },
    { side: 'e', at: 64, width: 10 },
  ], { h: 9, style: 'sand' });

  for (const [x, z] of [[AX, AZ], [BX, AZ], [AX, BZ], [BX, BZ]]) {
    st.push(bld('wall.town', x, z, 9, 9, { h: 12, style: 'sand', tower: true }));
  }
  // Gate keeps.
  st.push(bld('wall.town', 56, 26, 5, 6, { h: 12, style: 'sand', tower: true }));
  st.push(bld('wall.town', 72, 26, 5, 6, { h: 12, style: 'sand', tower: true }));
  st.push(pt('statue.beast', 57, 33, 0, { r: 1.25, style: 'sand' }));
  st.push(pt('statue.beast', 71, 33, 0, { r: 1.25, style: 'sand' }));
  for (const [x, z, rot] of [[58, 30, 0], [70, 30, 0], [58, 98, PI], [70, 98, PI]]) {
    st.push(pt('banner.pole', x, z, rot, { r: 0.4 }));
  }

  // ---- 集市 the bazaar fills the crossing of the two main streets --------
  // Only trestles and awning posts stand here: they read as a dense market but
  // leave gaps everywhere, so the crossroads never actually closes.
  for (const x of [46, 54, 62, 70, 78]) {
    st.push(pt('cart', x, 57, 0, { r: 1.0, stall: true }));
    st.push(pt('cart', x, 71, PI, { r: 1.0, stall: true }));
    st.push(pt('crate', x + 3, 57, 0, { r: 0.65 }));
    st.push(pt('barrel', x + 3, 71, 0, { r: 0.5 }));
    st.push(pt('banner.pole', x - 3, 64, 0, { r: 0.4 }));
  }
  st.push(pt('well', 86, 64, 0, { r: 1.15 }));
  st.push(pt('brazier', 42, 57, 0, { r: 0.6 }));
  st.push(pt('brazier', 42, 71, 0, { r: 0.6 }));

  // ---- shops, one to each quarter, all clear of the two streets ----------
  st.push(bld('shop', 40, 44, 16, 10, { h: 7, style: 'sand', sign: '武器店' }));
  st.push(bld('shop', 88, 44, 16, 10, { h: 7, style: 'sand', sign: '药店' }));
  st.push(bld('shop', 40, 86, 16, 10, { h: 7, style: 'sand', sign: '裁缝店' }));
  st.push(bld('shop', 88, 86, 16, 10, { h: 7, style: 'sand', sign: '仓库' }));
  st.push(bld('inn', 44, 34, 18, 9, { h: 9, style: 'sand', sign: '客栈' }));
  st.push(bld('house.tiled', 86, 34, 12, 9, { h: 7, style: 'sand' }));
  st.push(bld('house.tiled', 34, 54, 12, 9, { h: 7, style: 'sand' }));
  st.push(bld('house.tiled', 95, 55, 10, 8, { h: 7, style: 'sand' }));
  st.push(bld('house.tiled', 34, 74, 12, 9, { h: 7, style: 'sand' }));
  st.push(bld('house.tiled', 94, 74, 12, 9, { h: 7, style: 'sand' }));

  st.push(pt('torch.wall', 55, 41.5, PI, { r: 0 }));
  st.push(pt('torch.wall', 73, 41.5, PI, { r: 0 }));
  st.push(pt('cart', 78, 94, 0, { r: 1.0 }));
  st.push(pt('crate', 50, 94, 0, { r: 0.65 }));

  return {
    id: 'mongchon',
    name: '盟重土城',
    biome: 'desert',
    width: 128, height: 128,
    safeZone: true,
    sky: 'day',
    weather: ['clear', 'clear', 'sandstorm'],
    ambientLoop: 'desert',
    music: 'town',
    grade: 'normal',
    seed: 20030815,
    entry: { x: 64, z: 44 },
    respawn: { x: 64, z: 44 },
    respawnMap: 'mongchon',
    terrain: {
      base: 'sand',
      heightScale: 2.2,
      roads: [
        { width: 10, surface: 'dirt', pts: [[64, 18], [64, 112]] },
        { width: 10, surface: 'dirt', pts: [[14, 64], [114, 64]] },
        { width: 20, surface: 'stone.floor', pts: [[44, 64], [84, 64]] },
      ],
      groves: [
        { x: 34, z: 112, r: 12, density: 0.4, kind: 'palm' },
        { x: 110, z: 108, r: 12, density: 0.4, kind: 'palm' },
        { x: 18, z: 30, r: 12, density: 0.3, kind: 'palm' },
      ],
    },
    structures: st,
    npcs: [
      { id: 'sabak_guard', x: 58.5, z: 36.5, facing: HALF_PI },
      { id: 'teleporter_mongchon', x: 69.5, z: 36.5, facing: -HALF_PI },
      { id: 'blacksmith_mongchon', x: 40.5, z: 50.5, facing: 0 },
      { id: 'apothecary_mongchon', x: 88.5, z: 50.5, facing: 0 },
      { id: 'tailor_mongchon', x: 40.5, z: 79.5, facing: PI },
      { id: 'storekeeper_mongchon', x: 88.5, z: 79.5, facing: PI },
    ],
    spawns: [],
    portals: [
      { x: 18, z: 64, to: 'bichon_field', toEntry: { x: 150, z: 76 }, label: '比奇城外' },
      { x: 110, z: 64, to: 'redmoon', toEntry: { x: 22, z: 130 }, label: '赤月峡谷' },
      { x: 64, z: 110, to: 'zuma', toEntry: { x: 66, z: 116 }, label: '祖玛寺庙' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 5. 沃玛寺庙 — first dungeon
// ---------------------------------------------------------------------------

function buildWoma() {
  const g = new CellGrid(32, 32, 4);

  g.room(12, 25, 19, 30);   // 山门大厅 — entry hall
  g.room(15, 21, 16, 25);   // corridor north
  g.room(9, 17, 22, 21);    // 前殿 — fore-hall
  g.room(2, 15, 7, 21);     // 西配殿
  g.room(7, 18, 9, 19);     //   ↳ west corridor
  g.room(24, 15, 29, 21);   // 东配殿
  g.room(22, 18, 24, 19);   //   ↳ east corridor
  g.room(15, 15, 16, 18);   // corridor up to the great hall
  g.room(8, 8, 23, 15);     // 大殿 — pillared great hall
  g.room(4, 10, 8, 11);     //   ↳ west passage
  g.room(2, 9, 4, 13);      // 西龛 alcove
  g.room(23, 10, 27, 11);   //   ↳ east passage
  g.room(27, 9, 29, 13);    // 东龛 alcove
  g.room(15, 5, 16, 8);     // 神道 — the approach to the altar
  g.room(9, 1, 22, 5);      // 祭坛殿 — altar room, 沃玛教主

  // Great hall colonnade.
  for (const c of [10, 13, 18, 21]) for (const r of [10, 13]) g.put(c, r, 'P');
  g.putAll([[9, 9], [22, 9], [9, 14], [22, 14]], 'B');
  // Fore-hall.
  g.putAll([[11, 18], [20, 18], [11, 20], [20, 20]], 'P');
  g.putAll([[10, 17], [21, 17]], 'T');
  // Entry hall.
  g.putAll([[12, 26], [19, 26], [12, 29], [19, 29]], 'T');
  g.putAll([[13, 30], [18, 30]], 'C');
  // Altar room.
  g.put(15, 3, 'A');
  g.putAll([[12, 3], [19, 3]], 'B');
  g.putAll([[10, 2], [21, 2]], 'G');
  g.putAll([[10, 4], [21, 4]], 'T');
  // Alcoves.
  g.putAll([[2, 10], [3, 12]], 'C');
  g.putAll([[28, 10], [29, 12]], 'K');
  // Side halls.
  g.putAll([[3, 16], [6, 20]], 'C');
  g.putAll([[25, 16], [28, 20]], 'K');
  g.putAll([[2, 18], [29, 18]], 'T');
  // Corridor torches.
  g.putAll([[15, 23], [16, 16], [15, 6]], 'T');

  g.mark('entry', 15, 28);
  g.mark('exit', 16, 30);
  g.mark('deep', 15, 1);

  const st = buildCells(g, { style: 'temple', wallHeight: 8 });
  st.push(pt('cave.mouth', g.marks.deep.x + 0.5, g.marks.deep.z + 0.5, 0, { r: 0, style: 'temple', span: 8 }));

  return {
    id: 'woma',
    name: '沃玛寺庙',
    biome: 'temple',
    width: 128, height: 128,
    safeZone: false,
    sky: 'cave',
    weather: ['clear'],
    ambientLoop: 'dungeon',
    music: 'dungeon',
    grade: 'cave',
    seed: 20020310,
    interior: true,
    entry: { x: g.marks.entry.x, z: g.marks.entry.z },
    respawn: { x: 64, z: 96 },
    respawnMap: 'bichon',
    terrain: {
      base: 'temple.floor',
      heightScale: 0,
      flat: true,
      roads: [],
      groves: [],
    },
    structures: st,
    npcs: [],
    spawns: [
      { monster: 'woma_soldier', count: 6, area: g.area(12, 25, 19, 30, 2), leash: 8 },
      { monster: 'cave_bat', count: 6, area: g.area(12, 25, 19, 30, 2), leash: 10 },
      { monster: 'woma_soldier', count: 12, area: g.area(9, 17, 22, 21, 2), leash: 10 },
      { monster: 'woma_soldier', count: 8, area: g.area(2, 15, 7, 21, 2), leash: 9 },
      { monster: 'woma_warrior', count: 8, area: g.area(24, 15, 29, 21, 2), leash: 9 },
      { monster: 'woma_warrior', count: 12, area: g.area(8, 8, 23, 15, 3), leash: 12 },
      { monster: 'woma_guard', count: 6, area: g.area(8, 8, 23, 15, 3), leash: 12 },
      { monster: 'woma_guard', count: 4, area: g.area(2, 9, 4, 13, 1), leash: 6 },
      { monster: 'woma_guard', count: 4, area: g.area(27, 9, 29, 13, 1), leash: 6 },
      { monster: 'woma_guard', count: 6, area: g.area(9, 1, 22, 5, 2), leash: 10 },
      { monster: 'woma_taurus', count: 1, area: { x: 64, z: 14, r: 3 }, leash: 16 },
    ],
    portals: [
      { x: g.marks.exit.x, z: g.marks.exit.z, to: 'bichon_field', toEntry: { x: 134, z: 132 }, label: '比奇城外' },
      { x: g.marks.deep.x, z: g.marks.deep.z, to: 'zuma', toEntry: { x: 62, z: 114 }, label: '祖玛寺庙' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 6. 祖玛寺庙 — second dungeon
// ---------------------------------------------------------------------------

function buildZuma() {
  const g = new CellGrid(32, 32, 4);

  g.room(13, 27, 18, 30);   // 山门 entry hall
  g.room(15, 24, 16, 27);   //   ↳ corridor
  g.room(4, 21, 27, 24);    // 横殿 — the long cross hall
  g.room(2, 14, 8, 20);     // 西殿
  g.room(4, 20, 5, 21);     //   ↳ link
  g.room(23, 14, 29, 20);   // 东殿
  g.room(26, 20, 27, 21);   //   ↳ link
  g.room(10, 13, 21, 20);   // 中殿 — central hall
  g.room(15, 20, 16, 21);   //   ↳ link
  g.room(15, 12, 16, 13);   //   ↳ link
  g.room(8, 6, 23, 12);     // 北大殿 — northern colonnade
  g.room(3, 7, 7, 11);      // 西侧室
  g.room(7, 9, 8, 10);      //   ↳ link
  g.room(24, 7, 28, 11);    // 东侧室
  g.room(23, 9, 24, 10);    //   ↳ link
  g.room(15, 5, 16, 6);     // 神道
  g.room(10, 1, 21, 5);     // 祖玛祭坛 — 祖玛教主

  // Northern colonnade: two rows of pillars either side of the aisle.
  for (const c of [9, 12, 19, 22]) for (const r of [7, 10]) g.put(c, r, 'P');
  g.putAll([[8, 6], [23, 6], [8, 11], [23, 11]], 'B');
  g.putAll([[15, 7], [16, 7]], 'G');
  // Central hall: 祖玛雕像 line the walls.
  for (const c of [11, 14, 17, 20]) g.put(c, 14, 'G');
  for (const c of [11, 14, 17, 20]) g.put(c, 19, 'P');
  g.putAll([[10, 16], [21, 16]], 'B');
  // Cross hall.
  for (const c of [6, 10, 14, 18, 22, 26]) g.put(c, 22, 'P');
  g.putAll([[4, 21], [27, 21], [4, 24], [27, 24]], 'B');
  g.putAll([[8, 24], [12, 24], [20, 24], [24, 24]], 'T');
  // Wings.
  g.putAll([[2, 15], [3, 19], [7, 15]], 'C');
  g.putAll([[29, 15], [28, 19], [24, 15]], 'K');
  g.putAll([[2, 17], [29, 17]], 'T');
  g.putAll([[4, 14], [7, 20], [25, 14], [28, 20]], 'G');
  // Side chambers.
  g.putAll([[3, 7], [7, 11]], 'C');
  g.putAll([[24, 7], [28, 11]], 'K');
  g.putAll([[5, 9], [26, 9]], 'B');
  // Altar room.
  g.put(15, 3, 'A');
  g.putAll([[12, 3], [19, 3]], 'B');
  g.putAll([[11, 2], [20, 2], [11, 4], [20, 4]], 'G');
  g.putAll([[10, 1], [21, 1]], 'T');
  // Entry hall.
  g.putAll([[13, 28], [18, 28]], 'T');
  g.putAll([[13, 30], [18, 30]], 'C');
  g.putAll([[15, 25], [16, 5]], 'T');

  g.mark('entry', 15, 29);
  g.mark('backWoma', 14, 30);
  g.mark('outMong', 17, 30);

  const st = buildCells(g, { style: 'temple', wallHeight: 9 });

  return {
    id: 'zuma',
    name: '祖玛寺庙',
    biome: 'temple',
    width: 128, height: 128,
    safeZone: false,
    sky: 'cave',
    weather: ['clear', 'fog'],
    ambientLoop: 'dungeon',
    music: 'dungeon',
    grade: 'cave',
    seed: 20040601,
    interior: true,
    entry: { x: g.marks.entry.x, z: g.marks.entry.z },
    respawn: { x: 64, z: 44 },
    respawnMap: 'mongchon',
    terrain: { base: 'temple.floor', heightScale: 0, flat: true, roads: [], groves: [] },
    structures: st,
    npcs: [],
    spawns: [
      { monster: 'zuma_archer', count: 5, area: g.area(13, 27, 18, 30, 2), leash: 8 },
      { monster: 'zuma_archer', count: 8, area: g.area(4, 21, 27, 24, 2), leash: 10 },
      { monster: 'zuma_guard', count: 7, area: g.area(4, 21, 27, 24, 2), leash: 10 },
      { monster: 'zuma_statue', count: 5, area: g.area(2, 14, 8, 20, 2), leash: 8 },
      { monster: 'zuma_statue', count: 5, area: g.area(23, 14, 29, 20, 2), leash: 8 },
      { monster: 'zuma_guard', count: 9, area: g.area(10, 13, 21, 20, 3), leash: 12 },
      { monster: 'zuma_archer', count: 7, area: g.area(10, 13, 21, 20, 3), leash: 12 },
      { monster: 'zuma_statue', count: 7, area: g.area(8, 6, 23, 12, 3), leash: 12 },
      { monster: 'zuma_guard', count: 7, area: g.area(8, 6, 23, 12, 3), leash: 12 },
      { monster: 'guard_ghost', count: 4, area: g.area(3, 7, 7, 11, 1), leash: 8 },
      { monster: 'guard_ghost', count: 4, area: g.area(24, 7, 28, 11, 1), leash: 8 },
      { monster: 'zuma_guard', count: 5, area: g.area(10, 1, 21, 5, 2), leash: 10 },
      { monster: 'zuma_taurus', count: 1, area: { x: 62, z: 14, r: 3 }, leash: 18 },
    ],
    portals: [
      { x: g.marks.backWoma.x, z: g.marks.backWoma.z, to: 'woma', toEntry: { x: 58, z: 114 }, label: '沃玛寺庙' },
      { x: g.marks.outMong.x, z: g.marks.outMong.z, to: 'mongchon', toEntry: { x: 64, z: 104 }, label: '盟重土城' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 7. 石墓阵 — the cave maze
// ---------------------------------------------------------------------------

function buildStoneTomb() {
  const g = new CellGrid(32, 32, 4);

  g.room(14, 26, 17, 30);   // 入口洞窟
  g.room(10, 24, 21, 26);   // 东西向甬道
  g.room(4, 22, 10, 25);    // 西洞
  g.room(21, 22, 27, 25);   // 东洞
  g.room(15, 20, 16, 24);   //   ↳ north corridor
  g.room(12, 17, 19, 20);   // 中室
  g.room(6, 18, 12, 19);    //   ↳ west corridor
  g.room(2, 15, 7, 20);     // 西墓室
  g.room(19, 18, 25, 19);   //   ↳ east corridor
  g.room(25, 15, 30, 20);   // 东墓室
  g.room(4, 10, 5, 16);     //   ↳ west riser
  g.room(27, 10, 28, 16);   //   ↳ east riser
  g.room(2, 7, 8, 10);      // 西北洞
  g.room(24, 7, 30, 10);    // 东北洞
  g.room(8, 8, 12, 9);      //   ↳ NW passage
  g.room(20, 8, 24, 9);     //   ↳ NE passage
  g.room(11, 3, 21, 9);     // 石墓王室 — the deep chamber

  // Blind alleys, because a maze without wrong turns is a corridor.
  g.room(11, 21, 11, 24);
  g.room(22, 20, 23, 22);
  g.room(2, 12, 4, 13);
  g.room(28, 12, 30, 13);
  g.room(15, 12, 16, 17);
  g.room(8, 26, 9, 27);
  g.room(23, 26, 24, 28);

  // Cave dressing.
  g.putAll([[14, 26], [17, 26], [15, 30], [16, 30]], 'T');
  g.putAll([[5, 23], [9, 22], [22, 23], [26, 22]], 'R');
  g.putAll([[3, 16], [6, 19], [26, 16], [29, 19]], 'R');
  g.putAll([[13, 17], [18, 20]], 'R');
  g.putAll([[10, 24], [21, 24]], 'B');
  g.putAll([[2, 8], [7, 9], [25, 8], [30, 9]], 'R');
  g.putAll([[12, 3], [20, 3], [12, 8], [20, 8]], 'B');
  g.putAll([[14, 4], [18, 4]], 'G');
  g.put(16, 5, 'A');
  g.putAll([[11, 6], [21, 6]], 'T');
  g.putAll([[15, 13], [23, 21], [3, 13], [29, 13]], 'R');
  g.putAll([[8, 27], [24, 28]], 'C');

  g.mark('entry', 15, 29);
  g.mark('exit', 16, 30);

  const st = buildCells(g, { style: 'cave', wall: 'wall.town', wallHeight: 7 });
  st.push(pt('cave.mouth', g.marks.exit.x + 0.5, g.marks.exit.z + 2.5, PI, { r: 0, style: 'cave', span: 7 }));

  return {
    id: 'stonetomb',
    name: '石墓阵',
    biome: 'cave',
    width: 128, height: 128,
    safeZone: false,
    sky: 'cave',
    weather: ['clear', 'fog'],
    ambientLoop: 'cave',
    music: 'dungeon',
    grade: 'cave',
    seed: 19991224,
    interior: true,
    entry: { x: g.marks.entry.x, z: g.marks.entry.z },
    respawn: { x: 64, z: 96 },
    respawnMap: 'bichon',
    terrain: { base: 'cave.floor', heightScale: 0.6, flat: true, roads: [], groves: [] },
    structures: st,
    npcs: [],
    spawns: [
      { monster: 'cave_bat', count: 8, area: g.area(14, 26, 17, 30, 1), leash: 10 },
      { monster: 'skeleton', count: 8, area: g.area(10, 24, 21, 26, 1), leash: 10 },
      { monster: 'skeleton', count: 6, area: g.area(4, 22, 10, 25, 1), leash: 9 },
      { monster: 'cave_bat', count: 6, area: g.area(21, 22, 27, 25, 1), leash: 10 },
      { monster: 'skeleton_axe', count: 6, area: g.area(21, 22, 27, 25, 1), leash: 9 },
      { monster: 'skeleton', count: 6, area: g.area(12, 17, 19, 20, 1), leash: 9 },
      { monster: 'skeleton_axe', count: 6, area: g.area(2, 15, 7, 20, 1), leash: 9 },
      { monster: 'zombie', count: 6, area: g.area(25, 15, 30, 20, 1), leash: 9 },
      { monster: 'bone_familiar', count: 6, area: g.area(2, 7, 8, 10, 1), leash: 9 },
      { monster: 'bone_familiar', count: 6, area: g.area(24, 7, 30, 10, 1), leash: 9 },
      { monster: 'skeleton_axe', count: 8, area: g.area(11, 3, 21, 9, 2), leash: 12 },
      { monster: 'zombie', count: 5, area: g.area(11, 3, 21, 9, 2), leash: 12 },
      { monster: 'stone_golem', count: 2, area: { x: 66, z: 26, r: 6 }, leash: 14 },
    ],
    portals: [
      { x: g.marks.exit.x, z: g.marks.exit.z, to: 'bichon_field', toEntry: { x: 30, z: 130 }, label: '比奇城外' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 8. 赤月峡谷 — endgame
// ---------------------------------------------------------------------------

function buildRedMoon() {
  const g = new CellGrid(36, 36, 4);

  g.room(3, 29, 9, 34);     // 入口台地
  g.room(9, 27, 14, 31);    //   ↳ 峡道
  g.room(13, 22, 20, 28);   // 熔岩湖
  g.room(2, 22, 8, 27);     // 西崖
  g.room(8, 24, 13, 25);    //   ↳ link
  g.room(19, 16, 26, 23);   // 上层台地
  g.room(17, 22, 20, 23);   //   ↳ link
  g.room(26, 24, 32, 30);   // 东南熔窟
  g.room(20, 26, 27, 27);   //   ↳ link
  g.room(27, 10, 33, 16);   // 东北岩室
  g.room(12, 8, 22, 15);    // 赤月祭坛 — the arena
  g.room(19, 15, 21, 16);   //   ↳ link
  g.room(6, 10, 12, 16);    // 西裂谷
  g.room(6, 16, 7, 22);     //   ↳ link down to 西崖
  g.room(14, 2, 20, 7);     // 赤月王座
  g.room(16, 7, 17, 8);     //   ↳ link

  // Lava. Each pool blocks a disc inside its cell, so the ledges stay walkable.
  g.putAll([[14, 24], [16, 26], [19, 23], [15, 27], [18, 25]], 'L');
  g.putAll([[21, 18], [24, 20], [22, 22]], 'L');
  g.putAll([[28, 27], [31, 25]], 'L');
  g.putAll([[8, 12], [10, 15]], 'L');
  g.putAll([[14, 10], [20, 13], [16, 14]], 'L');
  g.putAll([[29, 12], [32, 15]], 'L');
  g.putAll([[4, 31], [7, 33]], 'L');

  // Dressing.
  g.putAll([[13, 22], [20, 22], [13, 28], [20, 28]], 'B');
  g.putAll([[12, 8], [22, 8], [12, 15], [22, 15]], 'B');
  g.putAll([[15, 9], [19, 9]], 'G');
  g.put(17, 4, 'A');
  g.putAll([[14, 3], [20, 3], [14, 6], [20, 6]], 'G');
  g.putAll([[15, 2], [19, 2]], 'B');
  g.putAll([[3, 29], [9, 34]], 'T');
  g.putAll([[2, 22], [8, 27], [27, 10], [33, 16]], 'R');
  g.putAll([[26, 24], [32, 30]], 'R');
  g.putAll([[6, 10], [12, 16]], 'R');
  g.putAll([[19, 16], [26, 23]], 'R');
  g.putAll([[10, 28], [13, 30]], 'S');

  g.mark('entry', 5, 32);
  g.mark('exit', 4, 33);

  const st = buildCells(g, { style: 'lava', wall: 'wall.town', wallHeight: 10 });
  st.push(bld('bridge', 66, 100, 8, 14, { h: 1.2, style: 'stone', walkable: true }));
  st.push(bld('bridge', 90, 72, 14, 8, { h: 1.2, style: 'stone', walkable: true }));
  st.push(pt('cave.mouth', g.marks.exit.x - 2.5, g.marks.exit.z + 0.5, HALF_PI, { r: 0, style: 'cave', span: 7 }));

  return {
    id: 'redmoon',
    name: '赤月峡谷',
    biome: 'hell',
    width: 144, height: 144,
    safeZone: false,
    sky: 'hell',
    weather: ['ash', 'embers', 'ash'],
    ambientLoop: 'hell',
    music: 'boss',
    grade: 'hell',
    seed: 20051111,
    interior: true,
    entry: { x: g.marks.entry.x, z: g.marks.entry.z },
    respawn: { x: 64, z: 44 },
    respawnMap: 'mongchon',
    terrain: { base: 'rock', heightScale: 1.4, flat: true, roads: [], groves: [], lavaLevel: -1.2 },
    structures: st,
    npcs: [],
    spawns: [
      { monster: 'zombie', count: 8, area: g.area(3, 29, 9, 34, 2), leash: 10 },
      { monster: 'stone_golem', count: 6, area: g.area(9, 27, 14, 31, 2), leash: 10 },
      { monster: 'guard_ghost', count: 10, area: g.area(13, 22, 20, 28, 2), leash: 12 },
      { monster: 'zuma_guard', count: 8, area: g.area(2, 22, 8, 27, 2), leash: 10 },
      { monster: 'zuma_guard', count: 10, area: g.area(19, 16, 26, 23, 2), leash: 12 },
      { monster: 'stone_golem', count: 8, area: g.area(26, 24, 32, 30, 2), leash: 11 },
      { monster: 'guard_ghost', count: 8, area: g.area(27, 10, 33, 16, 2), leash: 11 },
      { monster: 'zuma_taurus', count: 2, area: g.area(6, 10, 12, 16, 2), leash: 14 },
      { monster: 'zuma_guard', count: 10, area: g.area(12, 8, 22, 15, 3), leash: 14 },
      { monster: 'evil_snake', count: 1, area: { x: 70, z: 48, r: 5 }, leash: 20 },
      { monster: 'red_moon', count: 1, area: { x: 70, z: 20, r: 4 }, leash: 24 },
    ],
    portals: [
      { x: g.marks.exit.x, z: g.marks.exit.z, to: 'mongchon', toEntry: { x: 106, z: 64 }, label: '盟重土城' },
    ],
  };
}

// ---------------------------------------------------------------------------
// 9. Registry
// ---------------------------------------------------------------------------

/** @type {Object<string, object>} */
export const MAPS = {
  bichon: buildBichon(),
  bichon_field: buildBichonField(),
  mongchon: buildMongchon(),
  woma: buildWoma(),
  zuma: buildZuma(),
  stonetomb: buildStoneTomb(),
  redmoon: buildRedMoon(),
};

/** Forgiving aliases so a typo in a URL or a sibling module doesn't hard-fail. */
const ALIASES = {
  town: 'bichon',
  bichon_town: 'bichon',
  bijou: 'bichon',
  field: 'bichon_field',
  bichonfield: 'bichon_field',
  mong: 'mongchon',
  mongchon_town: 'mongchon',
  woma_temple: 'woma',
  zuma_temple: 'zuma',
  stone_tomb: 'stonetomb',
  tomb: 'stonetomb',
  red_moon: 'redmoon',
  redmoon_valley: 'redmoon',
};

/** @returns {object|undefined} */
export function getMap(id) {
  if (!id) return undefined;
  const key = String(id);
  return MAPS[key] || MAPS[ALIASES[key.toLowerCase()]];
}

/** Ordered by progression, for the world map panel. */
export const MAP_ORDER = ['bichon', 'bichon_field', 'stonetomb', 'woma', 'zuma', 'mongchon', 'redmoon'];

export function listMaps() {
  return MAP_ORDER.map((id) => MAPS[id]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 10. Nav helpers for whoever builds the grid
// ---------------------------------------------------------------------------

/** Fallback blocking radii for point props that didn't declare one. */
const DEFAULT_RADIUS = {
  'temple.pillar': 0.8, brazier: 0.55, altar: 1.5, well: 1.15, cart: 1.0,
  crate: 0.65, barrel: 0.5, 'statue.beast': 1.25, 'banner.pole': 0.4,
  'tomb.stone': 0.8, fence: 0.35, 'lava.pool': 1.7,
};
/** Kinds you walk through or over. */
const NON_BLOCKING = new Set(['gate.town', 'bridge', 'stairs', 'torch.wall', 'cave.mouth']);

function structureBlocks(s) {
  if (!s || s.walkable || NON_BLOCKING.has(s.kind)) return false;
  return true;
}

/**
 * Circle blockers for every structure in a map, in the `[{x,z,r}]` shape
 * `World._buildNav()` feeds to `NavGrid.blockCircle`. Boxes are covered with an
 * overlapping lattice; point props emit one circle each.
 */
export function structureBlockers(def) {
  const out = [];
  if (!def || !def.structures) return out;
  for (const s of def.structures) {
    if (!structureBlocks(s)) continue;
    if (s.w > 0 && s.d > 0) {
      // Hidden boxes are dead rock behind a wall shell; a coarse lattice is
      // plenty and keeps the blocker list from tripling on a dungeon map.
      const step = s.hidden ? 1.5 : 1.1;
      const rad = s.hidden ? 1.1 : 0.6;
      const nx = Math.max(1, Math.ceil(s.w / step));
      const nz = Math.max(1, Math.ceil(s.d / step));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          out.push({
            x: s.x - s.w / 2 + (i + 0.5) * (s.w / nx),
            z: s.z - s.d / 2 + (j + 0.5) * (s.d / nz),
            r: rad,
          });
        }
      }
    } else {
      const r = s.r ?? DEFAULT_RADIUS[s.kind] ?? 0.6;
      if (r > 0) out.push({ x: s.x, z: s.z, r });
    }
  }
  return out;
}

/**
 * Exact and far cheaper alternative to `structureBlockers` when you already hold
 * the grid: fills boxes as rectangles instead of a chain of discs.
 * @param {import('./Nav.js').NavGrid} nav
 */
export function applyStructuresToNav(nav, def) {
  if (!nav || !def || !def.structures) return nav;
  for (const s of def.structures) {
    if (!structureBlocks(s)) continue;
    if (s.w > 0 && s.d > 0) {
      nav.blockRect(s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, true);
    } else {
      const r = s.r ?? DEFAULT_RADIUS[s.kind] ?? 0.6;
      if (r > 0) nav.blockCircle(s.x, s.z, r);
    }
  }
  return nav;
}

export default MAPS;
