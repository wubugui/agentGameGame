import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { Animator } from './Animator.js';

let _uid = 1;

const _v = new THREE.Vector3();

/**
 * Base for anything that stands on the ground, has HP, and animates:
 * the player, monsters, NPCs, summons. Movement is path-following on the nav
 * grid; the visual heading is eased by the Animator so turns look weighted.
 */
export class Entity {
  constructor(world, def = {}) {
    this.id = _uid++;
    this.world = world;
    this.ctx = world.ctx;
    this.def = def;
    this.name = def.name || '';
    this.faction = def.faction || 'neutral';   // 'player'|'monster'|'npc'
    this.selectable = def.selectable !== false;

    this.level = def.level || 1;
    this.hpMax = def.hp || 20;
    this.hp = this.hpMax;
    this.mpMax = def.mp || 0;
    this.mp = this.mpMax;
    this.dead = false;
    this.deadFor = 0;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.moveSpeed = def.moveSpeed || 3.4;
    this.radius = def.radius || 0.35;

    /** @type {Array<{x:number,z:number}>|null} */
    this.path = null;
    this.pathIndex = 0;
    /** @type {Entity|null} */
    this.target = null;
    this.attackCooldown = 0;
    this.stunTimer = 0;
    /** Status effects: [{kind, seconds, power, source}] */
    this.effects = [];

    this.rig = null;
    this.animator = null;
    this.root = new THREE.Group();
    this.root.userData.entity = this;
  }

  /** Subclasses call this once their rig has been built. */
  _attachRig(rig, archetype) {
    this.rig = rig;
    this.root.add(rig.root);
    this.animator = new Animator(rig, { archetype });
    this.height = rig.height || 1.8;
    this.radius = rig.radius || this.radius;
  }

  setPosition(x, z, y = null) {
    this.position.set(x, y ?? this.world.heightAt(x, z), z);
    this.root.position.copy(this.position);
    return this;
  }

  get tileX() { return Math.floor(this.position.x); }
  get tileZ() { return Math.floor(this.position.z); }

  distanceTo(other) {
    const o = other.position || other;
    const dx = o.x - this.position.x, dz = o.z - this.position.z;
    return Math.hypot(dx, dz);
  }

  faceToward(x, z) {
    const dx = x - this.position.x, dz = z - this.position.z;
    if (dx * dx + dz * dz > 1e-6) {
      this.facing = Math.atan2(dx, dz);
      if (this.animator) this.animator.facingTarget = this.facing;
    }
  }

  /** Ask the nav grid for a route and start walking it. */
  moveTo(x, z) {
    const nav = this.world.nav;
    const gx = Math.floor(x), gz = Math.floor(z);
    const goal = nav.isWalkable(gx, gz) ? { x: gx, z: gz } : nav.nearestWalkable(gx, gz, 6);
    if (!goal) { this.path = null; return false; }
    const p = nav.findPath(this.tileX, this.tileZ, goal.x, goal.z);
    if (!p || !p.length) { this.path = null; return false; }
    // Replace the final waypoint with the exact requested point so the unit
    // stops where the player clicked, not at the tile centre.
    p[p.length - 1] = { x, z };
    this.path = p;
    this.pathIndex = 0;
    return true;
  }

  stop() { this.path = null; this.pathIndex = 0; }
  get moving() { return !!this.path && this.pathIndex < this.path.length; }

  _followPath(dt, speed) {
    if (!this.moving) return false;
    const wp = this.path[this.pathIndex];
    const dx = wp.x - this.position.x, dz = wp.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const arrive = this.pathIndex === this.path.length - 1 ? 0.08 : 0.2;
    if (d <= arrive) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) { this.path = null; return false; }
      return true;
    }
    const step = Math.min(d, speed * dt);
    const nx = this.position.x + (dx / d) * step;
    const nz = this.position.z + (dz / d) * step;
    this.position.set(nx, this.world.heightAt(nx, nz), nz);
    this.faceToward(wp.x, wp.z);
    return true;
  }

  addEffect(kind, seconds, power = 1, source = null) {
    const e = this.effects.find((x) => x.kind === kind);
    if (e) { e.seconds = Math.max(e.seconds, seconds); e.power = Math.max(e.power, power); }
    else this.effects.push({ kind, seconds, power, source });
  }

  hasEffect(kind) { return this.effects.some((e) => e.kind === kind); }
  effectPower(kind) { const e = this.effects.find((x) => x.kind === kind); return e ? e.power : 0; }

  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.seconds -= dt;
      if (e.kind === 'poison') {
        e._acc = (e._acc || 0) + dt;
        while (e._acc >= 1) {
          e._acc -= 1;
          this.world.combat.applyDamage(e.source, this, Math.max(1, Math.round(e.power)), 'poison', false);
        }
      }
      if (e.seconds <= 0) this.effects.splice(i, 1);
    }
  }

  heal(amount) {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = Math.min(this.hpMax, this.hp + amount);
    const got = this.hp - before;
    if (got > 0) bus.emit('entity:healed', { target: this, amount: got });
    return got;
  }

  /** Called by Combat after mitigation. Returns true if this blow killed. */
  takeDamage(amount, kind, source, crit = false) {
    if (this.dead) return false;
    this.hp -= amount;
    bus.emit('entity:damaged', { target: this, amount, kind, crit, source });
    if (this.hp <= 0) { this.hp = 0; this.die(source); return true; }
    if (this.animator && amount > this.hpMax * 0.08) this.animator.overlay('hurt');
    return false;
  }

  die(killer = null) {
    if (this.dead) return;
    this.dead = true;
    this.deadFor = 0;
    this.stop();
    this.target = null;
    this.effects.length = 0;
    this.animator?.play('die', { loop: false });
    bus.emit('entity:died', { entity: this, killer });
  }

  update(dt) {
    if (this.dead) { this.deadFor += dt; this.animator?.update(dt); this.root.position.copy(this.position); return; }
    this._updateEffects(dt);
    if (this.stunTimer > 0) this.stunTimer -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.animator?.update(dt);
    this.root.position.copy(this.position);
  }

  worldTop(out = _v) { return out.copy(this.position).setY(this.position.y + (this.height || 1.8)); }

  dispose() {
    this.root.parent?.remove(this.root);
    this.rig?.dispose?.();
  }
}

export default Entity;
