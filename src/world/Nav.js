import * as THREE from 'three';

/**
 * Tile navigation for one loaded map.
 *
 * Contract: docs/CONTRACTS.md §10.
 *
 * Design notes
 * ------------
 * - The grid is a flat `Uint8Array`; tile (tx,tz) lives at `tz * width + tx`.
 * - A* uses an octile heuristic and a real binary heap with a position index so
 *   decrease-key is O(log n) instead of "push a duplicate and hope".
 * - Every scratch buffer (g, f, cameFrom, heap, visit stamp) is allocated once in
 *   the constructor and re-used. A repeated query does **zero** allocation until
 *   the final waypoint array is built, and that array has to be fresh because
 *   `Entity.moveTo` mutates its last element.
 * - Instead of clearing the scratch buffers between queries we bump a generation
 *   counter and compare against `_mark`. Clearing 65k floats per monster
 *   re-path was the single biggest cost in the naive version.
 * - Diagonal steps refuse to squeeze between two blocked tiles, so units never
 *   clip a building corner.
 * - When `maxNodes` runs out we return the best partial path rather than null:
 *   a monster that walks halfway looks alive, one that freezes looks broken.
 */

const SQRT2 = Math.SQRT2;

/**
 * Slight heuristic over-weight. Costs at most ~6% path length but cuts the
 * expanded-node count by a large factor on open ground, which is what keeps a
 * 256x256 query far inside one frame.
 */
const H_WEIGHT = 1.06;

/** 4-neighbours first, then diagonals. */
const DIRS = new Int8Array([
  1, 0, -1, 0, 0, 1, 0, -1,
  1, 1, 1, -1, -1, 1, -1, -1,
]);
const DIR_COST = new Float32Array([1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2]);

const OPEN = 1;
const CLOSED = 2;

/** How far ahead string-pulling may look before it commits an anchor. */
const MAX_PULL = 32;

/** Smallest disc a `blockCircle` call is allowed to shrink to. */
const MIN_BLOCK_RADIUS = 0.7;
/** Extra fat on prop blockers so units don't scrape walls with their shoulders. */
const BLOCK_PAD = 0.1;

export class NavGrid {
  constructor(width, height) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    const n = this.width * this.height;
    this.size = n;

    /** 0 = walkable, 1 = blocked. Public so debug tooling can peek. */
    this.blocked = new Uint8Array(n);

    // ---- reusable A* scratch (never reallocated) --------------------------
    this._g = new Float32Array(n);
    this._f = new Float32Array(n);
    this._from = new Int32Array(n);
    this._mark = new Int32Array(n);   // generation stamp per node
    this._state = new Uint8Array(n);  // OPEN / CLOSED, valid only when stamped
    this._heap = new Int32Array(n);   // node ids, min-heap on _f
    this._heapPos = new Int32Array(n);
    this._heapSize = 0;
    this._gen = 0;
    this._trace = new Int32Array(n);  // reversed path scratch

    /** Bumped on every mutation so callers can invalidate cached routes. */
    this.version = 0;

    this._debug = null;
  }

  // ---- grid ---------------------------------------------------------------

  index(tx, tz) { return tz * this.width + tx; }

  inBounds(tx, tz) {
    return tx >= 0 && tz >= 0 && tx < this.width && tz < this.height;
  }

  isWalkable(tx, tz) {
    tx |= 0; tz |= 0;
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
    return this.blocked[tz * this.width + tx] === 0;
  }

  /** Same test but taking continuous world coordinates. */
  isWalkableAt(x, z) {
    return this.isWalkable(Math.floor(x), Math.floor(z));
  }

  setBlocked(tx, tz, blocked = true) {
    tx |= 0; tz |= 0;
    if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return;
    const i = tz * this.width + tx;
    const v = blocked ? 1 : 0;
    if (this.blocked[i] !== v) { this.blocked[i] = v; this.version++; }
  }

  /** Rasterise a disc of blocked tiles. `x`,`z`,`r` are world units. */
  blockCircle(x, z, r) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r)) return;
    if (r <= 0) return;   // a zero-radius blocker is decoration, not an obstacle
    const rr = Math.max(r + BLOCK_PAD, MIN_BLOCK_RADIUS);
    const r2 = rr * rr;
    const x0 = Math.floor(x - rr), x1 = Math.floor(x + rr);
    const z0 = Math.floor(z - rr), z1 = Math.floor(z + rr);
    for (let tz = z0; tz <= z1; tz++) {
      if (tz < 0 || tz >= this.height) continue;
      const dz = tz + 0.5 - z;
      const row = tz * this.width;
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || tx >= this.width) continue;
        const dx = tx + 0.5 - x;
        if (dx * dx + dz * dz > r2) continue;
        if (this.blocked[row + tx] === 0) { this.blocked[row + tx] = 1; this.version++; }
      }
    }
  }

  /** Axis-aligned box blocker in world units — much cheaper than a circle chain
   *  for the long straight walls a town or dungeon is made of. */
  blockRect(x0, z0, x1, z1, blocked = true) {
    const ax = Math.floor(Math.min(x0, x1)), bx = Math.ceil(Math.max(x0, x1)) - 1;
    const az = Math.floor(Math.min(z0, z1)), bz = Math.ceil(Math.max(z0, z1)) - 1;
    for (let tz = az; tz <= bz; tz++) {
      for (let tx = ax; tx <= bx; tx++) this.setBlocked(tx, tz, blocked);
    }
  }

  /** Seal the outermost ring so nothing can path off the edge of the world. */
  blockBorder(thickness = 1) {
    const t = Math.max(1, thickness | 0);
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        if (x < t || z < t || x >= this.width - t || z >= this.height - t) this.setBlocked(x, z, true);
      }
    }
  }

  clear() {
    this.blocked.fill(0);
    this.version++;
  }

  /** Nearest walkable tile to (tx,tz) within `radius`, or null. */
  nearestWalkable(tx, tz, radius = 6) {
    tx = Math.floor(tx); tz = Math.floor(tz);
    if (this.isWalkable(tx, tz)) return { x: tx, z: tz };
    const rad = Math.max(1, radius | 0);
    for (let r = 1; r <= rad; r++) {
      let bx = 0, bz = 0, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        const edgeZ = dz === -r || dz === r;
        for (let dx = -r; dx <= r; dx++) {
          if (!edgeZ && dx !== -r && dx !== r) continue;
          const x = tx + dx, z = tz + dz;
          if (!this.isWalkable(x, z)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; bx = x; bz = z; }
        }
      }
      if (bd < Infinity) return { x: bx, z: bz };
    }
    return null;
  }

  // ---- line of walk -------------------------------------------------------

  /**
   * Supercover DDA between two world-space points. Every tile the segment
   * touches must be walkable; when the segment crosses an exact tile corner both
   * flanking tiles must be walkable too, so a unit can never thread the gap
   * between two diagonally-touching blockers.
   */
  lineOfWalk(x0, z0, x1, z1) {
    if (!Number.isFinite(x0) || !Number.isFinite(z0) || !Number.isFinite(x1) || !Number.isFinite(z1)) return false;
    let tx = Math.floor(x0), tz = Math.floor(z0);
    const ex = Math.floor(x1), ez = Math.floor(z1);
    if (!this.isWalkable(tx, tz) || !this.isWalkable(ex, ez)) return false;
    if (tx === ex && tz === ez) return true;

    const dx = x1 - x0, dz = z1 - z0;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const invX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const invZ = dz !== 0 ? 1 / Math.abs(dz) : Infinity;

    let tMaxX = stepX > 0 ? (tx + 1 - x0) * invX : stepX < 0 ? (x0 - tx) * invX : Infinity;
    let tMaxZ = stepZ > 0 ? (tz + 1 - z0) * invZ : stepZ < 0 ? (z0 - tz) * invZ : Infinity;

    const budget = Math.abs(ex - tx) + Math.abs(ez - tz) + 4;
    for (let i = 0; i < budget; i++) {
      if (tMaxX < tMaxZ - 1e-9) {
        tx += stepX; tMaxX += invX;
      } else if (tMaxZ < tMaxX - 1e-9) {
        tz += stepZ; tMaxZ += invZ;
      } else {
        // Dead-on corner crossing: both flanking tiles have to be open.
        if (stepX === 0 || stepZ === 0) return false; // degenerate, bail safe
        if (!this.isWalkable(tx + stepX, tz) || !this.isWalkable(tx, tz + stepZ)) return false;
        tx += stepX; tz += stepZ; tMaxX += invX; tMaxZ += invZ;
      }
      if (!this.isWalkable(tx, tz)) return false;
      if (tx === ex && tz === ez) return true;
    }
    // The budget is the exact supercover step count, so falling out of the loop
    // means the walk was degenerate. Fail closed.
    return false;
  }

  // ---- A* -----------------------------------------------------------------

  /**
   * @returns {Array<{x:number,z:number}>|null} tile centres, start excluded.
   */
  findPath(sx, sz, gx, gz, { maxNodes = 4000, diagonal = true } = {}) {
    const W = this.width, H = this.height;
    if (!Number.isFinite(sx) || !Number.isFinite(sz) || !Number.isFinite(gx) || !Number.isFinite(gz)) return null;
    sx = Math.floor(sx); sz = Math.floor(sz);
    gx = Math.floor(gx); gz = Math.floor(gz);

    if (!this.inBounds(sx, sz)) {
      const alt = this.nearestWalkable(
        Math.min(W - 1, Math.max(0, sx)), Math.min(H - 1, Math.max(0, sz)), 8);
      if (!alt) return null;
      sx = alt.x; sz = alt.z;
    }
    if (!this.isWalkable(gx, gz)) {
      const alt = this.nearestWalkable(gx, gz, 6);
      if (!alt) return null;
      gx = alt.x; gz = alt.z;
    }

    const scx = sx + 0.5, scz = sz + 0.5;
    const gcx = gx + 0.5, gcz = gz + 0.5;
    if (sx === gx && sz === gz) return [{ x: gcx, z: gcz }];
    // Overwhelmingly the common case for short orders: skip A* entirely.
    if (this.lineOfWalk(scx, scz, gcx, gcz)) return [{ x: gcx, z: gcz }];

    const start = sz * W + sx;
    const goal = gz * W + gx;
    const gen = ++this._gen;
    const g = this._g, f = this._f, from = this._from, mark = this._mark, state = this._state;
    const blocked = this.blocked, hpos = this._heapPos;

    this._heapSize = 0;
    mark[start] = gen;
    state[start] = OPEN;
    g[start] = 0;
    f[start] = this._octile(sx, sz, gx, gz) * H_WEIGHT;
    from[start] = -1;
    this._push(start);

    const budget = Math.max(64, maxNodes | 0);
    const dirCount = diagonal ? 8 : 4;
    let expanded = 0;
    let best = start;
    let bestH = this._octile(sx, sz, gx, gz);
    let found = false;

    while (this._heapSize > 0) {
      const cur = this._pop();
      if (cur === goal) { found = true; break; }
      state[cur] = CLOSED;

      const cx = cur % W;
      const cz = (cur - cx) / W;
      // Octile distance to the goal, inlined — this runs ~10x per expansion.
      let ax = cx > gx ? cx - gx : gx - cx;
      let az = cz > gz ? cz - gz : gz - cz;
      const h = (ax + az) + (SQRT2 - 2) * (ax < az ? ax : az);
      if (h < bestH) { bestH = h; best = cur; }

      if (++expanded >= budget) break;

      const gc = g[cur];
      const rowC = cz * W;
      for (let d = 0; d < dirCount; d++) {
        const nx = cx + DIRS[d * 2];
        const nz = cz + DIRS[d * 2 + 1];
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const rowN = nz * W;
        const ni = rowN + nx;
        if (blocked[ni]) continue;
        // A diagonal may not slip between two blockers that touch at a corner.
        if (d >= 4 && (blocked[rowC + nx] || blocked[rowN + cx])) continue;

        const seen = mark[ni] === gen;
        if (seen && state[ni] === CLOSED) continue;
        const ng = gc + DIR_COST[d];
        if (seen && ng >= g[ni]) continue;

        ax = nx > gx ? nx - gx : gx - nx;
        az = nz > gz ? nz - gz : gz - nz;
        mark[ni] = gen;
        g[ni] = ng;
        f[ni] = ng + ((ax + az) + (SQRT2 - 2) * (ax < az ? ax : az)) * H_WEIGHT;
        from[ni] = cur;
        if (seen && state[ni] === OPEN) this._siftUp(hpos[ni]);
        else { state[ni] = OPEN; this._push(ni); }
      }
    }

    const end = found ? goal : best;
    if (end === start) return null;

    // ---- reconstruct (reversed into scratch, then walked forwards) --------
    const trace = this._trace;
    let n = 0;
    let node = end;
    while (node !== -1 && n < trace.length) {
      trace[n++] = node;
      node = from[node];
    }
    if (n < 2) return null;

    // trace[n-1] is the start tile; emit everything after it, nearest first.
    const pts = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const idx = trace[n - 2 - i];
      const tx = idx % W;
      pts[i] = { x: tx + 0.5, z: (idx - tx) / W + 0.5 };
    }
    return this._stringPull(scx, scz, pts);
  }

  /** Octile distance: the exact cost of the cheapest unobstructed 8-way walk. */
  _octile(ax, az, bx, bz) {
    const dx = ax > bx ? ax - bx : bx - ax;
    const dz = az > bz ? az - bz : bz - az;
    return (dx + dz) + (SQRT2 - 2) * (dx < dz ? dx : dz);
  }

  /**
   * Greedy string-pulling: keep an anchor, walk forward while the anchor can see
   * the next waypoint, and commit the last visible one when it can't. This is
   * what stops units walking the A* staircase.
   *
   * The anchor is force-committed after MAX_PULL steps: without the cap the cost
   * is quadratic in the length of a straight run, and a 250-tile corridor alone
   * cost more than the search that produced it. The extra waypoints it leaves
   * behind are exactly collinear, so the second pass folds them away again and
   * the walked line is identical.
   */
  _stringPull(ax, az, pts) {
    const n = pts.length;
    if (n < 3) return pts;
    const out = [];
    let anchorX = ax, anchorZ = az, anchorK = -1;
    for (let k = 1; k < n; k++) {
      if (k - anchorK < MAX_PULL && this.lineOfWalk(anchorX, anchorZ, pts[k].x, pts[k].z)) continue;
      const p = pts[k - 1];
      out.push(p);
      anchorX = p.x; anchorZ = p.z; anchorK = k - 1;
    }
    out.push(pts[n - 1]);
    return this._collapseCollinear(ax, az, out);
  }

  /** Drop any waypoint that lies on the straight line between its neighbours. */
  _collapseCollinear(ax, az, pts) {
    const n = pts.length;
    if (n < 3) return pts;
    const out = [];
    let px = ax, pz = az;
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const v1x = a.x - px, v1z = a.z - pz;
      const v2x = b.x - a.x, v2z = b.z - a.z;
      const cross = v1x * v2z - v1z * v2x;
      if (cross > -1e-6 && cross < 1e-6 && v1x * v2x + v1z * v2z > 0) continue;
      out.push(a);
      px = a.x; pz = a.z;
    }
    out.push(pts[n - 1]);
    return out;
  }

  // ---- binary heap, min on _f ---------------------------------------------
  //
  // `_heapPos` maps node -> slot so a cheaper route to an already-open node is a
  // real decrease-key instead of a duplicate push. The comparator is `_f` alone;
  // H_WEIGHT already biases ties toward deeper nodes, so a second array read per
  // comparison would buy nothing.

  _push(node) {
    const k = this._heapSize++;
    this._heap[k] = node;
    this._heapPos[node] = k;
    this._siftUp(k);
  }

  _pop() {
    const heap = this._heap, pos = this._heapPos;
    const top = heap[0];
    pos[top] = -1;
    const last = heap[--this._heapSize];
    if (this._heapSize > 0) {
      heap[0] = last;
      pos[last] = 0;
      this._siftDown(0);
    }
    return top;
  }

  _siftUp(k) {
    const heap = this._heap, pos = this._heapPos, f = this._f;
    const node = heap[k];
    const fv = f[node];
    while (k > 0) {
      const p = (k - 1) >> 1;
      const pn = heap[p];
      if (f[pn] <= fv) break;
      heap[k] = pn; pos[pn] = k;
      k = p;
    }
    heap[k] = node; pos[node] = k;
  }

  _siftDown(k) {
    const heap = this._heap, pos = this._heapPos, f = this._f;
    const n = this._heapSize;
    const node = heap[k];
    const fv = f[node];
    for (;;) {
      let c = (k << 1) + 1;
      if (c >= n) break;
      const r = c + 1;
      if (r < n && f[heap[r]] < f[heap[c]]) c = r;
      const cn = heap[c];
      if (f[cn] >= fv) break;
      heap[k] = cn; pos[cn] = k;
      k = c;
    }
    heap[k] = node; pos[node] = k;
  }

  // ---- debug --------------------------------------------------------------

  /** Flat red quads over every blocked tile. Cached; call dispose() to free. */
  debugMesh(y = 0.08, maxQuads = 40000) {
    if (this._debug) return this._debug;

    let count = 0;
    for (let i = 0; i < this.size; i++) if (this.blocked[i]) count++;
    count = Math.min(count, maxQuads);

    const pos = new Float32Array(count * 12);
    const idx = new Uint32Array(count * 6);
    let q = 0;
    for (let z = 0; z < this.height && q < count; z++) {
      for (let x = 0; x < this.width && q < count; x++) {
        if (!this.blocked[z * this.width + x]) continue;
        const o = q * 12;
        const x0 = x + 0.06, x1 = x + 0.94, z0 = z + 0.06, z1 = z + 0.94;
        pos[o + 0] = x0; pos[o + 1] = y; pos[o + 2] = z0;
        pos[o + 3] = x1; pos[o + 4] = y; pos[o + 5] = z0;
        pos[o + 6] = x1; pos[o + 7] = y; pos[o + 8] = z1;
        pos[o + 9] = x0; pos[o + 10] = y; pos[o + 11] = z1;
        const v = q * 4, e = q * 6;
        idx[e + 0] = v; idx[e + 1] = v + 1; idx[e + 2] = v + 2;
        idx[e + 3] = v; idx[e + 4] = v + 2; idx[e + 5] = v + 3;
        q++;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (count > 0) geo.computeBoundingSphere();

    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3a4a, transparent: true, opacity: 0.3,
      depthWrite: false, side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'nav:debug';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this._debug = mesh;
    return mesh;
  }

  /** Drop the cached debug mesh so the next debugMesh() reflects new blockers. */
  invalidateDebug() {
    if (!this._debug) return;
    this._debug.geometry.dispose();
    this._debug.material.dispose();
    this._debug.parent?.remove(this._debug);
    this._debug = null;
  }

  dispose() {
    this.invalidateDebug();
    this._g = this._f = this._from = this._mark = null;
    this._state = this._heap = this._heapPos = this._trace = null;
    this.blocked = null;
    this.size = 0;
  }
}

export default NavGrid;
