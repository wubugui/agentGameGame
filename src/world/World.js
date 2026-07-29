import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { Terrain } from './Terrain.js';
import { Props } from './Props.js';
import { NavGrid } from './Nav.js';
import { getMap } from './MapDefs.js';
import { Monster } from '../entities/Monster.js';
import { Npc } from '../entities/Npc.js';
import { Combat } from '../game/Combat.js';
import { makeItem } from '../game/Inventory.js';
import { rollDrops } from '../game/Content.js';
import { WORLD, COMBAT } from '../game/Config.js';

const _v = new THREE.Vector3();

/**
 * One loaded map: terrain, props, nav grid, every entity standing on it, and
 * the loot lying on the floor. Swapping maps tears the whole thing down and
 * builds a fresh one, which keeps memory flat across a long play session.
 */
export class World {
  constructor(ctx, mapId) {
    this.ctx = ctx;
    this.mapId = mapId;
    this.def = getMap(mapId);
    if (!this.def) throw new Error(`Unknown map '${mapId}'`);

    this.group = new THREE.Group();
    this.group.name = `map:${mapId}`;
    ctx.engine.scene.add(this.group);

    this.terrain = new Terrain(this.def, ctx);
    this.group.add(this.terrain.group);

    this.props = new Props(this.def, this.terrain, ctx);
    this.group.add(this.props.group);

    this.nav = new NavGrid(this.def.width, this.def.height);
    this._buildNav();

    /** @type {import('../entities/Entity.js').Entity[]} */
    this.entities = [];
    /** @type {import('../entities/Player.js').Player|null} */
    this.player = null;
    /** Ground loot: [{item, mesh, position, life}] */
    this.loot = [];
    this.lootGroup = new THREE.Group();
    this.group.add(this.lootGroup);

    this.combat = new Combat(this);
    this.spawnQueue = [];
    this._spawnPoints = [];
    this._buildSpawns();
    this._buildNpcs();
  }

  _buildNav() {
    for (let z = 0; z < this.def.height; z++) {
      for (let x = 0; x < this.def.width; x++) {
        if (!this.terrain.walkableAt(x, z)) this.nav.setBlocked(x, z, true);
      }
    }
    for (const b of this.props.blockers || []) this.nav.blockCircle(b.x, b.z, b.r);
  }

  _buildSpawns() {
    for (const s of this.def.spawns || []) {
      for (let i = 0; i < s.count; i++) {
        const p = this._randomWalkableIn(s.area);
        if (!p) continue;
        this._spawnPoints.push({ monster: s.monster, x: p.x, z: p.z, leash: s.leash || 14 });
      }
    }
    for (const sp of this._spawnPoints) this._spawnMonster(sp);
  }

  _buildNpcs() {
    for (const n of this.def.npcs || []) {
      try {
        const npc = new Npc(this, n.id, n);
        this.addEntity(npc);
      } catch (e) { console.warn('[world] npc spawn failed', n.id, e); }
    }
  }

  _randomWalkableIn(area) {
    const rng = this.ctx.rng;
    for (let tries = 0; tries < 40; tries++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (area?.r ?? 20);
      const x = Math.floor((area?.x ?? this.def.width / 2) + Math.cos(a) * r);
      const z = Math.floor((area?.z ?? this.def.height / 2) + Math.sin(a) * r);
      if (x > 1 && z > 1 && x < this.def.width - 2 && z < this.def.height - 2 && this.nav.isWalkable(x, z)) {
        return { x: x + 0.5, z: z + 0.5 };
      }
    }
    return null;
  }

  _spawnMonster(sp) {
    try {
      const m = new Monster(this, sp.monster, sp);
      m.spawnRecord = sp;
      this.addEntity(m);
      return m;
    } catch (e) {
      console.warn('[world] monster spawn failed', sp.monster, e);
      return null;
    }
  }

  addEntity(e) {
    this.entities.push(e);
    this.group.add(e.root);
    if (e.faction !== 'player') this.ctx.pickables?.entities.push(e.root);
    return e;
  }

  removeEntity(e) {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    const pi = this.ctx.pickables?.entities.indexOf(e.root) ?? -1;
    if (pi >= 0) this.ctx.pickables.entities.splice(pi, 1);
    e.dispose();
  }

  setPlayer(p) {
    this.player = p;
    this.addEntity(p);
    this.ctx.pickables.ground = this.terrain.pickTargets;
  }

  heightAt(x, z) { return this.terrain.heightAt(x, z); }

  hasLineOfSight(a, b) {
    return this.nav.lineOfWalk(a.position.x, a.position.z, b.position.x, b.position.z);
  }

  entitiesInRange(center, radius, faction = null) {
    const out = [];
    const r2 = radius * radius;
    for (const e of this.entities) {
      if (e.dead) continue;
      if (faction && e.faction !== faction) continue;
      const dx = e.position.x - center.x, dz = e.position.z - center.z;
      if (dx * dx + dz * dz <= r2) out.push(e);
    }
    return out;
  }

  /** Is anything hostile close enough that the player should hold a combat stance? */
  combatNearby(entity, radius = 8) {
    for (const e of this.entities) {
      if (e.dead || e.faction !== 'monster') continue;
      if (e.distanceTo(entity) <= radius && e.aggro) return true;
    }
    return false;
  }

  /**
   * Resolve the small overlaps that path-following agents can accumulate at a
   * doorway or around a target. Static navigation keeps units out of props;
   * this pass handles dynamic bodies and re-samples terrain height after every
   * accepted correction so feet never hover on a sloped tile.
   *
   * The active population is capped at 90, making this bounded O(n²) pass
   * cheaper than maintaining a per-frame allocating spatial hash.
   */
  _resolveCrowding(dt) {
    const list = this.entities;
    const focus = this.player;
    const simR = WORLD.simulationRadius + 4;
    const simR2 = simR * simR;
    const relax = Math.min(1, Math.max(0, dt) * 18);
    if (relax <= 0) return;

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || !a.position) continue;
      if (focus && a !== focus) {
        const ax = a.position.x - focus.position.x;
        const az = a.position.z - focus.position.z;
        if (ax * ax + az * az > simR2) continue;
      }

      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b || b.dead || !b.position) continue;
        if (a.faction === 'npc' && b.faction === 'npc') continue;

        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        let d2 = dx * dx + dz * dz;
        const ar = Math.max(0.2, a.radius || 0.35);
        const br = Math.max(0.2, b.radius || 0.35);
        const minD = (ar + br) * 0.78;
        if (d2 >= minD * minD) continue;

        let dist;
        if (d2 < 1e-8) {
          // Stable id-based direction: no random jitter and no temporary vec.
          const ang = (((a.id || i) * 17 + (b.id || j) * 31) % 360) * Math.PI / 180;
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          dist = 0;
          d2 = 1;
        } else {
          dist = Math.sqrt(d2);
          dx /= dist;
          dz /= dist;
        }

        const correction = Math.min(0.12, Math.max(0, minD - dist) * 0.52 * relax);
        if (correction <= 0) continue;
        const aFixed = a.faction === 'npc';
        const bFixed = b.faction === 'npc';
        const aw = aFixed ? 0 : (bFixed ? 1 : 0.5);
        const bw = bFixed ? 0 : (aFixed ? 1 : 0.5);
        if (aw > 0) this._moveBodyIfClear(a, -dx * correction * aw, -dz * correction * aw);
        if (bw > 0) this._moveBodyIfClear(b, dx * correction * bw, dz * correction * bw);
      }
    }
  }

  _moveBodyIfClear(entity, ox, oz) {
    const x = entity.position.x + ox;
    const z = entity.position.z + oz;
    if (x < 0.05 || z < 0.05 || x >= this.def.width - 0.05 || z >= this.def.height - 0.05) return;
    if (!this.nav.isWalkable(Math.floor(x), Math.floor(z))) return;
    if (!this.nav.lineOfWalk(entity.position.x, entity.position.z, x, z)) return;
    entity.position.x = x;
    entity.position.z = z;
    entity.position.y = this.heightAt(x, z);
    entity.root?.position.copy(entity.position);
  }

  nearestInteractable(pos, radius = 2.6) {
    let best = null, bestD = radius;
    for (const e of this.entities) {
      if (e.faction !== 'npc') continue;
      const d = e.distanceTo(pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    for (const it of this.props.interactables || []) {
      const d = Math.hypot(it.position.x - pos.x, it.position.z - pos.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  // ---- loot -------------------------------------------------------------

  onMonsterKilled(monster, killer) {
    if (killer === this.player) this.player.gainExp(monster.exp);

    const drops = rollDrops(monster.mdef, this.ctx.rng);
    for (const d of drops) {
      const item = makeItem(d.item, this.ctx.rng, d.qty || 1);
      if (item) this.dropItem(item, monster.position);
    }

    // Queue a replacement so the field never empties out.
    if (monster.spawnRecord) {
      const [lo, hi] = COMBAT.respawnDelay;
      this.spawnQueue.push({ sp: monster.spawnRecord, at: this.ctx.time + this.ctx.rng.range(lo, hi) });
    }
  }

  dropItem(item, near) {
    const rng = this.ctx.rng;
    const a = rng() * Math.PI * 2, r = rng.range(0.2, 1.1);
    const x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
    const y = this.heightAt(x, z);

    const mesh = this.ctx.makeLootMarker
      ? this.ctx.makeLootMarker(item)
      : new THREE.Mesh(
          new THREE.OctahedronGeometry(0.16),
          new THREE.MeshStandardMaterial({ color: 0xffcc55, emissive: 0x442200, roughness: 0.35, metalness: 0.8 })
        );
    mesh.position.set(x, y + 0.2, z);
    this.lootGroup.add(mesh);

    const entry = { item, mesh, position: new THREE.Vector3(x, y, z), life: 120, bob: rng() * 6.28 };
    this.loot.push(entry);
    this.ctx.fx?.spawn('loot.sparkle', mesh.position, { parent: mesh });
    bus.emit('item:dropped', { item, position: entry.position });
    return entry;
  }

  /** Pick up everything within reach of the player. Returns how many were taken. */
  pickupNear(player, radius) {
    let taken = 0;
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      if (Math.hypot(l.position.x - player.position.x, l.position.z - player.position.z) > radius) continue;
      if (l.item.id === 'gold') {
        player.gold += l.item.qty;
        bus.emit('chat', { text: `捡起 ${l.item.qty} 金币`, channel: 'loot' });
      } else if (!player.inventory.add(l.item)) {
        continue;
      } else {
        bus.emit('chat', { text: `捡起【${l.item.name}】`, channel: 'loot' });
      }
      bus.emit('item:looted', { item: l.item, qty: l.item.qty });
      bus.emit('audio:sfx', { id: l.item.id === 'gold' ? 'coin' : 'loot', pos: l.position });
      this._destroyLoot(i);
      taken++;
    }
    if (taken) player.emitStats();
    return taken;
  }

  _destroyLoot(i) {
    const l = this.loot[i];
    this.lootGroup.remove(l.mesh);
    l.mesh.geometry?.dispose?.();
    this.loot.splice(i, 1);
  }

  summonPet(owner, monsterId, level) {
    const spot = this._randomWalkableIn({ x: owner.position.x, z: owner.position.z, r: 2.5 });
    if (!spot) return null;
    const pet = this._spawnMonster({ monster: monsterId, x: spot.x, z: spot.z, leash: 999 });
    if (!pet) return null;
    pet.faction = 'player';
    pet.owner = owner;
    pet.aiKind = 'pet';
    pet.level = level;
    pet.spawnRecord = null;
    return pet;
  }

  // ---- frame ------------------------------------------------------------

  update(dt, input) {
    const p = this.player;

    for (const e of this.entities) {
      if (e === p) continue;
      // Freeze distant monsters — a 128×128 field can hold hundreds.
      if (p && e.faction === 'monster' && !e.aggro && e.distanceTo(p) > WORLD.simulationRadius) continue;
      e.update(dt);
    }
    if (p) p.update(dt, input);

    this._resolveCrowding(dt);
    this.combat.update(dt);

    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.life -= dt;
      l.bob += dt * 2.4;
      l.mesh.position.y = l.position.y + 0.2 + Math.sin(l.bob) * 0.055;
      l.mesh.rotation.y += dt * 1.3;
      if (l.life <= 0) this._destroyLoot(i);
    }

    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.ctx.time) {
      const q = this.spawnQueue.shift();
      const live = this.entities.filter((e) => e.faction === 'monster' && !e.dead).length;
      if (live < WORLD.activeMonsterBudget) this._spawnMonster(q.sp);
    }

    this.terrain.update(dt, this.ctx.engine.camera);
    this.props.update(dt, this.ctx.engine.camera);
  }

  dispose() {
    for (const e of [...this.entities]) this.removeEntity(e);
    while (this.loot.length) this._destroyLoot(0);
    this.combat.clear();
    this.terrain.dispose();
    this.props.dispose();
    this.ctx.engine.scene.remove(this.group);
    if (this.ctx.pickables) { this.ctx.pickables.ground = []; this.ctx.pickables.entities = []; }
  }
}

export default World;
