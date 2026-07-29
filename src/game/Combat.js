import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { SKILLS } from './Content.js';
import { COMBAT } from './Config.js';

const _a = new THREE.Vector3();

/**
 * Mir2's combat maths, faithfully: damage is `roll(attacker DC) - roll(target
 * AC)`, magic uses MC vs MAC, and whether you connect at all is accuracy vs
 * agility. A blocked hit still shows a spark so the player never wonders
 * whether the click registered.
 */
export class Combat {
  constructor(world) {
    this.world = world;
    this.ctx = world.ctx;
    this.rng = world.ctx.rng;
    /** Live projectiles: fireballs, arrows, soul fire. */
    this.projectiles = [];
  }

  _roll(range) {
    if (!range) return 0;
    const [lo, hi] = range;
    return hi > lo ? lo + Math.floor(this.rng() * (hi - lo + 1)) : lo;
  }

  hitChance(attacker, target) {
    const acc = (attacker.accuracy ?? 6) + 3;
    const agi = target.agility ?? 4;
    return THREE.MathUtils.clamp((acc - agi) * 0.09 + 0.72, COMBAT.minHitChance, COMBAT.maxHitChance);
  }

  meleeAttack(attacker, target) {
    if (!target || target.dead || attacker.dead) return;

    if (this.rng() > this.hitChance(attacker, target)) {
      bus.emit('combat:miss', { source: attacker, target });
      this.ctx.fx?.spawn('hit.block', _a.copy(target.position).setY(target.position.y + target.height * 0.55));
      bus.emit('audio:sfx', { id: 'sword.block', pos: target.position });
      return;
    }

    const raw = this._roll(attacker.dc);
    const armor = this._roll(target.ac);
    const crit = this.rng() < 0.06;
    let dmg = Math.max(1, raw - armor);
    if (crit) dmg = Math.round(dmg * COMBAT.critMultiplier);

    this.applyDamage(attacker, target, dmg, 'physical', crit);
  }

  magicAttack(attacker, target, power, kind = 'magic') {
    if (!target || target.dead) return;
    const resist = this._roll(target.mac);
    const dmg = Math.max(1, power - resist);
    this.applyDamage(attacker, target, dmg, kind, false);
  }

  applyDamage(attacker, target, amount, kind, crit) {
    if (!target || target.dead) return;
    const killed = target.takeDamage(amount, kind, attacker, crit);

    const at = _a.copy(target.position).setY(target.position.y + (target.height || 1.6) * 0.6);
    if (kind === 'physical') {
      this.ctx.fx?.spawn(crit ? 'hit.crit' : 'hit.slash', at);
      this.ctx.fx?.spawn('hit.blood', at, { scale: crit ? 1.5 : 1 });
      bus.emit('audio:sfx', { id: 'sword.hit', pos: target.position });
    } else if (kind === 'poison') {
      this.ctx.fx?.spawn('poison.tick', at);
    } else {
      this.ctx.fx?.spawn('hit.spark', at, { color: kind === 'fire' ? 0xff7722 : 0x66ccff });
    }

    if (target === this.world.player) {
      this.ctx.engine.addShake(crit ? 0.5 : 0.22);
      this.ctx.engine.postfx?.flash(0x880000, crit ? 0.6 : 0.25, 0.18);
    } else if (crit) {
      this.ctx.engine.addShake(0.12);
    }

    if (killed && attacker === this.world.player) this.ctx.engine.addShake(0.15);
  }

  // ---- skills -----------------------------------------------------------

  castSkill(caster, skillId, target, point) {
    const s = SKILLS[skillId];
    if (!s) return;
    const power = () => {
      const base = s.school === 'taoist' ? this._roll(caster.sc) : this._roll(caster.mc);
      return Math.max(1, Math.round(base * (s.power || 1)));
    };
    const aim = target && !target.dead ? target.position.clone() : new THREE.Vector3(point.x, this.world.heightAt(point.x, point.z), point.z);

    bus.emit('audio:sfx', { id: s.sfx || 'fire.cast', pos: caster.position });

    switch (s.effect) {
      case 'projectile':
        this.spawnProjectile(caster, target, aim, {
          speed: s.speed || 14, vfx: s.vfx || 'fire.ball', color: s.color,
          onHit: (hit) => {
            this.magicAttack(caster, hit, power(), s.element || 'magic');
            if (s.explode) this.areaDamage(caster, hit.position, s.explode, power() * 0.6, s.element);
          },
          onMiss: (pos) => { if (s.explode) this.areaDamage(caster, pos, s.explode, power() * 0.6, s.element); },
        });
        break;

      case 'area': {
        this.ctx.fx?.spawn(s.vfx || 'fire.explode', aim, { scale: s.radius, color: s.color, duration: s.duration });
        this.areaDamage(caster, aim, s.radius || 3, power(), s.element || 'magic');
        this.ctx.engine.addShake(0.3);
        break;
      }

      case 'nova': {
        this.ctx.fx?.spawn(s.vfx || 'ice.storm', caster.position, { scale: s.radius, color: s.color });
        this.areaDamage(caster, caster.position, s.radius || 4, power(), s.element || 'magic');
        for (const e of this.world.entitiesInRange(caster.position, s.radius || 4, 'monster')) {
          if (s.knockback) this.knockback(e, caster.position, s.knockback);
          if (s.stun) e.stunTimer = Math.max(e.stunTimer, s.stun);
        }
        break;
      }

      case 'heal': {
        const who = target && target.faction === caster.faction ? target : caster;
        who.heal(Math.round(power() * 1.6));
        this.ctx.fx?.spawn('heal.aura', who.position, { parent: who.root });
        bus.emit('audio:sfx', { id: 'heal', pos: who.position });
        break;
      }

      case 'buff':
        caster.addEffect(s.buff, s.duration || 20, s.buffPower || 1, caster);
        this.ctx.fx?.spawn(s.vfx || 'shield.magic', caster.position, { parent: caster.root, duration: s.duration });
        break;

      case 'debuff': {
        const list = target ? [target] : this.world.entitiesInRange(aim, s.radius || 2, 'monster');
        for (const e of list) {
          e.addEffect(s.buff || 'poison', s.duration || 12, power() * 0.25, caster);
          this.ctx.fx?.spawn('poison.cloud', e.position, { parent: e.root });
        }
        break;
      }

      case 'summon':
        this.world.summonPet(caster, s.summon || 'skeleton', s.summonLevel || 1);
        this.ctx.fx?.spawn('summon.burst', aim);
        break;

      case 'melee_arc': {
        // 半月弯刀 / 烈火剑法: sweep everything in a cone in front of the caster.
        const hits = this.world.entitiesInRange(caster.position, s.range || 2.2, 'monster');
        for (const e of hits) {
          const ang = Math.atan2(e.position.x - caster.position.x, e.position.z - caster.position.z);
          let d = Math.abs(((ang - caster.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (d <= (s.arc || Math.PI * 0.6) * 0.5) {
            const dmg = Math.max(1, Math.round(this._roll(caster.dc) * (s.power || 1.4)) - this._roll(e.ac));
            this.applyDamage(caster, e, dmg, 'physical', false);
          }
        }
        this.ctx.fx?.spawn(s.vfx || 'hit.slash', caster.position, { scale: s.range, color: s.color });
        break;
      }

      default:
        console.warn(`[combat] skill '${skillId}' has unhandled effect '${s.effect}'`);
    }
  }

  areaDamage(source, center, radius, power, element = 'magic') {
    const faction = source.faction === 'player' ? 'monster' : 'player';
    for (const e of this.world.entitiesInRange(center, radius, faction)) {
      const falloff = 1 - Math.min(1, e.distanceTo(center) / radius) * 0.4;
      this.magicAttack(source, e, Math.round(power * falloff), element);
    }
  }

  knockback(entity, from, distance) {
    const dx = entity.position.x - from.x, dz = entity.position.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = entity.position.x + (dx / d) * distance;
    const nz = entity.position.z + (dz / d) * distance;
    if (this.world.nav.isWalkable(Math.floor(nx), Math.floor(nz))) {
      entity.stop();
      entity.setPosition(nx, nz);
    }
  }

  // ---- projectiles ------------------------------------------------------

  spawnProjectile(source, target, aim, opts) {
    const p = {
      source, target,
      pos: source.position.clone().setY(source.position.y + (source.height || 1.7) * 0.62),
      aim: aim.clone(),
      speed: opts.speed || 14,
      life: 4,
      onHit: opts.onHit,
      onMiss: opts.onMiss,
      handle: this.ctx.fx?.spawn(opts.vfx || 'fire.ball', source.position, { color: opts.color }),
    };
    this.projectiles.push(p);
    return p;
  }

  monsterProjectile(monster, target) {
    this.spawnProjectile(monster, target, target.position, {
      speed: 12,
      vfx: monster.mdef.projectileVfx || 'soul.fireball',
      color: monster.mdef.projectileColor,
      onHit: (hit) => this.magicAttack(monster, hit, this._roll(monster.dc), 'magic'),
    });
  }

  update(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;

      // Home onto a living target; otherwise fly to where it was aimed.
      const goal = p.target && !p.target.dead
        ? _a.copy(p.target.position).setY(p.target.position.y + (p.target.height || 1.6) * 0.55)
        : _a.copy(p.aim);

      const dx = goal.x - p.pos.x, dy = goal.y - p.pos.y, dz = goal.z - p.pos.z;
      const d = Math.hypot(dx, dy, dz);
      const step = p.speed * dt;

      if (d <= step || p.life <= 0) {
        p.handle?.stop();
        if (p.target && !p.target.dead && d <= step) p.onHit?.(p.target);
        else p.onMiss?.(p.pos.clone());
        this.projectiles.splice(i, 1);
        continue;
      }

      p.pos.x += (dx / d) * step;
      p.pos.y += (dy / d) * step;
      p.pos.z += (dz / d) * step;
      p.handle?.setPosition(p.pos);
    }
  }

  clear() {
    for (const p of this.projectiles) p.handle?.stop();
    this.projectiles.length = 0;
  }
}

export default Combat;
