import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { Entity } from './Entity.js';
import { BESTIARY, buildMonster } from './Bestiary.js';
import { COMBAT } from '../game/Config.js';

/**
 * Monster AI. Deliberately Mir2-simple: wander in a leash radius, notice the
 * player inside aggro range (passive types only after being hit), chase, hit,
 * and give up if pulled too far from the spawn point.
 */
export class Monster extends Entity {
  constructor(world, monsterId, spawn) {
    const def = BESTIARY[monsterId];
    if (!def) throw new Error(`Unknown monster '${monsterId}'`);
    super(world, {
      name: def.name, faction: 'monster', level: def.level,
      hp: def.hp, mp: def.mp || 0, moveSpeed: def.moveSpeed || 2.6,
    });

    this.monsterId = monsterId;
    this.mdef = def;
    this.ac = def.ac; this.mac = def.mac; this.dc = def.dc;
    this.accuracy = def.accuracy; this.agility = def.agility;
    this.attackRange = def.attackRange || COMBAT.meleeRange;
    this.aggroRange = def.aggroRange || 7;
    this.attackSpeed = def.attackSpeed || 1;
    this.exp = def.exp || 1;
    this.aiKind = def.ai || 'aggressive';
    this.undead = !!def.undead;

    this.spawnPoint = { x: spawn.x, z: spawn.z };
    this.leash = spawn.leash || 16;
    this.wanderTimer = world.ctx.rng.range(0.5, 4);
    this.aggro = null;
    this.aggroDropTimer = 0;
    this._petThinkTimer = 0;
    this._bossSpecialTimer = world.ctx.rng.range(4.5, 7.5);
    this._bossTellTimer = 0;
    this._bossAim = new THREE.Vector3();

    this._attachRig(buildMonster(monsterId, world.ctx), 'beast');
    this.setPosition(spawn.x, spawn.z);
  }

  /** Being attacked always aggroes, even for `passive` types. */
  takeDamage(amount, kind, source, crit) {
    if (source && source.faction !== this.faction) { this.aggro = source; this.aggroDropTimer = 12; }
    return super.takeDamage(amount, kind, source, crit);
  }

  update(dt) {
    if (this.dead) {
      super.update(dt);
      if (this.deadFor > COMBAT.corpseLinger) this.world.removeEntity(this);
      return;
    }

    if (this.stunTimer > 0) { super.update(dt); return; }

    if (this.aiKind === 'pet' || this.owner) {
      this._updatePet(dt);
      super.update(dt);
      return;
    }

    if (this._bossTellTimer > 0) {
      this._updateBossTell(dt);
      super.update(dt);
      return;
    }

    if (this.aiKind === 'boss') this._bossSpecialTimer -= dt;

    if (this.aggro?.dead || (this.aggro === this.world.player && this.aggro?.hasEffect('invisible'))) {
      this.aggro = null;
      this.stop();
    }

    if (this.aggro) {
      const visible = this.distanceTo(this.aggro) <= this.aggroRange * 1.75
        && this.world.hasLineOfSight(this, this.aggro);
      if (visible) this.aggroDropTimer = 12;
      else this.aggroDropTimer -= dt;
      if (this.aggroDropTimer <= 0) {
        this.aggro = null;
        this.stop();
      }
    }

    if (!this.aggro && this.aiKind !== 'passive') this._look();

    // Leash: drag back home rather than chasing a kiting player forever.
    const dHome = Math.hypot(this.position.x - this.spawnPoint.x, this.position.z - this.spawnPoint.z);
    if (dHome > this.leash * 1.8) {
      const wasAggro = !!this.aggro;
      this.aggro = null;
      if (wasAggro || !this.moving) {
        this.stop();
        this.moveTo(this.spawnPoint.x, this.spawnPoint.z);
      }
      this._followPath(dt, this.moveSpeed);
      this.animator.play('walk');
    } else if (this.aggro) {
      this._fight(dt);
    } else {
      this._wander(dt);
    }

    super.update(dt);
  }

  _look() {
    const p = this.world.player;
    if (!p || p.dead || p.hasEffect('invisible')) return;
    if (this.distanceTo(p) <= this.aggroRange && this.world.hasLineOfSight(this, p)) {
      this.aggro = p;
      this.aggroDropTimer = 12;
      if (this.mdef.sfx?.aggro) bus.emit('audio:sfx', { id: this.mdef.sfx.aggro, pos: this.position });
    }
  }

  _fight(dt) {
    const t = this.aggro;
    if (!t || t.dead || t.faction === this.faction) {
      this.aggro = null;
      this.stop();
      return;
    }
    const d = this.distanceTo(t);
    const los = this.world.hasLineOfSight(this, t);

    if (this.aiKind === 'boss' && this._bossSpecialTimer <= 0 && d <= Math.max(5.5, this.attackRange + 1.5)) {
      this._startBossTell(t);
      return;
    }

    if (d <= this.attackRange && los) {
      this.stop();
      this.faceToward(t.position.x, t.position.z);
      this.animator.play('idle.combat');
      if (this.attackCooldown <= 0) {
        this.attackCooldown = COMBAT.baseAttackInterval / Math.max(0.4, this.attackSpeed);
        const ranged = this.aiKind === 'ranged' || this.aiKind === 'caster';
        const clip = ranged ? 'cast.release' : this.aiKind === 'boss' ? 'attack.heavy' : 'attack.slash';
        this.animator.overlay(clip, {
          onEvent: (e) => {
            if (e !== 'impact' || t.dead || this.dead || t.faction === this.faction) return;
            if (ranged) this.world.combat.monsterProjectile(this, t);
            else this.world.combat.meleeAttack(this, t);
          },
        });
      }
    } else {
      const last = this.path?.[this.path.length - 1];
      if (!this.moving || !last || Math.hypot(last.x - t.position.x, last.z - t.position.z) > 1.2) {
        this.moveTo(t.position.x, t.position.z);
      }
      if (!this._followPath(dt, this.moveSpeed)) this.aggroDropTimer -= dt * 3;
      this.animator.play('walk');
    }
  }

  _startBossTell(target) {
    this.stop();
    this.faceToward(target.position.x, target.position.z);
    this._bossAim.copy(target.position);
    this._bossTellTimer = 0.82;
    this._bossSpecialTimer = this.ctx.rng.range(7, 11);
    this.attackCooldown = Math.max(this.attackCooldown, 1.1);
    this.animator.overlay('attack.heavy', { speed: 0.72 });
    this.ctx.fx?.spawn('boss.aura', this._bossAim, {
      scale: Math.max(2.8, this.attackRange + 0.7),
      duration: this._bossTellTimer,
      color: 0xff5a24,
    });
    bus.emit('audio:sfx', { id: 'boss.roar', pos: this.position });
  }

  _updateBossTell(dt) {
    this._bossTellTimer -= dt;
    this.stop();
    this.faceToward(this._bossAim.x, this._bossAim.z);
    this.animator.play('idle.combat');
    if (this._bossTellTimer > 0) return;

    const radius = Math.max(2.8, this.attackRange + 0.7);
    this._bossAim.y = this.world.heightAt(this._bossAim.x, this._bossAim.z);
    this.ctx.fx?.spawn('dust.land', this._bossAim, { scale: radius, color: 0xff7438 });
    this.ctx.fx?.spawn('hit.blunt', this._bossAim, { scale: radius * 0.8, color: 0xffb06a });
    this.world.combat.physicalAreaAttack(this, this._bossAim, radius, 1.15);
    if (this.world.player && this.world.player.distanceTo(this._bossAim) <= radius + 3) {
      this.ctx.engine.addShake(0.6, 4.5);
    }
  }

  _updatePet(dt) {
    const owner = this.owner;
    if (!owner || owner.dead) {
      this.aggro = null;
      this.stop();
      this.animator.play('idle');
      return;
    }

    const dOwner = this.distanceTo(owner);
    if (this.aggro?.dead || this.aggro?.faction !== 'monster') this.aggro = null;
    if (dOwner > 14) this.aggro = null;
    this._petThinkTimer -= dt;
    if (this._petThinkTimer <= 0) {
      this._petThinkTimer = 0.3;
      const ordered = owner.orderTarget;
      if (ordered && !ordered.dead && ordered.faction === 'monster') {
        this.aggro = ordered;
      } else if (!this.aggro) {
        let best = null;
        let bestD2 = 10 * 10;
        for (const e of this.world.entities) {
          if (e === this || e.dead || e.faction !== 'monster') continue;
          const dx = e.position.x - owner.position.x;
          const dz = e.position.z - owner.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = e; }
        }
        this.aggro = best;
      }
    }

    if (this.aggro) {
      this._fight(dt);
      return;
    }

    if (dOwner > 18) {
      const tx = owner.position.x + Math.sin(owner.facing + Math.PI) * 1.1;
      const tz = owner.position.z + Math.cos(owner.facing + Math.PI) * 1.1;
      const walkable = this.world.nav.nearestWalkable(Math.floor(tx), Math.floor(tz), 3);
      const x = walkable ? walkable.x + 0.5 : owner.position.x;
      const z = walkable ? walkable.z + 0.5 : owner.position.z;
      this.ctx.fx?.spawn('teleport.out', this.position, { scale: 0.7 });
      this.setPosition(x, z);
      this.stop();
      this.ctx.fx?.spawn('teleport.in', this.position, { scale: 0.7 });
    } else if (dOwner > 3.2) {
      const last = this.path?.[this.path.length - 1];
      if (!this.moving || !last || Math.hypot(last.x - owner.position.x, last.z - owner.position.z) > 1.2) {
        this.moveTo(owner.position.x, owner.position.z);
      }
      this._followPath(dt, this.moveSpeed * 1.08);
      this.animator.play('run');
    } else {
      this.stop();
      this.faceToward(owner.position.x, owner.position.z);
      this.animator.play('idle');
    }
  }

  _wander(dt) {
    if (this.moving) {
      this._followPath(dt, this.moveSpeed * 0.6);
      this.animator.play('walk');
      return;
    }
    this.animator.play('idle');
    this.wanderTimer -= dt;
    if (this.wanderTimer > 0) return;
    this.wanderTimer = this.ctx.rng.range(3, 9);
    const a = this.ctx.rng() * Math.PI * 2;
    const r = this.ctx.rng.range(1, this.leash);
    this.moveTo(this.spawnPoint.x + Math.cos(a) * r, this.spawnPoint.z + Math.sin(a) * r);
  }

  die(killer) {
    super.die(killer);
    if (this.owner) {
      if (this.owner.summonedPet === this) this.owner.summonedPet = null;
    } else {
      this.world.onMonsterKilled(this, killer);
    }
    if (this.mdef.sfx?.die) bus.emit('audio:sfx', { id: this.mdef.sfx.die, pos: this.position });
    else bus.emit('audio:sfx', { id: 'monster.die', pos: this.position });
    const hardBody = this.undead
      || this.mdef.body?.plan === 'idol'
      || this.monsterId === 'stone_golem';
    this.ctx.fx?.spawn(hardBody ? 'hit.spark' : 'hit.blood', this.position, {
      scale: (this.mdef.scale || 1) * 1.6,
    });
    this.ctx.fx?.spawn('death.dissolve', this.position, {
      parent: this.root,
      scale: this.mdef.scale || 1,
    });
  }
}

export default Monster;
