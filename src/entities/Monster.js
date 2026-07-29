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

    if (this.aggroDropTimer > 0) this.aggroDropTimer -= dt;
    if (this.aggro && (this.aggro.dead || this.aggroDropTimer <= 0)) this.aggro = null;

    if (!this.aggro && this.aiKind !== 'passive') this._look();

    if (this.aggro) this._fight(dt);
    else this._wander(dt);

    // Leash: drag back home rather than chasing a kiting player forever.
    const dHome = Math.hypot(this.position.x - this.spawnPoint.x, this.position.z - this.spawnPoint.z);
    if (dHome > this.leash * 1.8) {
      this.aggro = null;
      if (!this.moving) this.moveTo(this.spawnPoint.x, this.spawnPoint.z);
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
    const d = this.distanceTo(t);
    if (d <= this.attackRange) {
      this.stop();
      this.faceToward(t.position.x, t.position.z);
      this.animator.play('idle.combat');
      if (this.attackCooldown <= 0) {
        this.attackCooldown = COMBAT.baseAttackInterval / Math.max(0.4, this.attackSpeed);
        const ranged = this.aiKind === 'ranged' || this.aiKind === 'caster';
        this.animator.overlay(ranged ? 'cast.release' : 'attack.slash', {
          onEvent: (e) => {
            if (e !== 'impact' || t.dead || this.dead) return;
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
    this.world.onMonsterKilled(this, killer);
    if (this.mdef.sfx?.die) bus.emit('audio:sfx', { id: this.mdef.sfx.die, pos: this.position });
    else bus.emit('audio:sfx', { id: 'monster.die', pos: this.position });
    this.ctx.fx?.spawn('hit.blood', this.position, { scale: (this.mdef.scale || 1) * 1.6 });
  }
}

export default Monster;
