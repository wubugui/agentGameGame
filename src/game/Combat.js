import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { SKILLS } from './Content.js';
import { COMBAT } from './Config.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

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
    /** Persistent ground effects such as 火墙 and 流星火雨. */
    this.zones = [];
  }

  _roll(range) {
    if (!range) return 0;
    const [lo, hi] = range;
    return hi > lo ? lo + Math.floor(this.rng() * (hi - lo + 1)) : lo;
  }

  hitChance(attacker, target) {
    const acc = (attacker.accuracy ?? 6) + 3
      + (attacker.effectPower?.('accuracy') || 0) * 2
      + (attacker.effectPower?.('spirit') || 0);
    const agi = target.agility ?? 4;
    return THREE.MathUtils.clamp((acc - agi) * 0.09 + 0.72, COMBAT.minHitChance, COMBAT.maxHitChance);
  }

  meleeAttack(attacker, target) {
    if (!target || target.dead || attacker.dead || attacker.faction === target.faction) return;

    const reach = (attacker.attackRange || COMBAT.meleeRange)
      + (attacker.equipment?.weapon?.reach || 0);
    if (attacker.distanceTo(target) > reach + (target.radius || 0.35) * 0.35
        || !this.world.hasLineOfSight(attacker, target)) {
      bus.emit('combat:miss', { source: attacker, target });
      return;
    }

    if (this.rng() > this.hitChance(attacker, target)) {
      bus.emit('combat:miss', { source: attacker, target });
      this.ctx.fx?.spawn('hit.block', _a.copy(target.position).setY(target.position.y + target.height * 0.55));
      bus.emit('audio:sfx', { id: 'sword.block', pos: target.position });
      return;
    }

    const raw = this._roll(attacker.dc) + (attacker.effectPower?.('zen') || 0);
    const armor = this._roll(target.ac) + (target.effectPower?.('ghost_shield') || 0);
    const crit = this.rng() < 0.06;
    let dmg = Math.max(1, raw - armor);
    if (crit) dmg = Math.round(dmg * COMBAT.critMultiplier);

    this.applyDamage(attacker, target, dmg, 'physical', crit);
  }

  magicAttack(attacker, target, power, kind = 'magic') {
    if (!target || target.dead || attacker?.faction === target.faction) return;
    const resist = this._roll(target.mac) + (target.effectPower?.('holy_armor') || 0);
    const dmg = Math.max(1, power - resist);
    this.applyDamage(attacker, target, dmg, kind, false);
  }

  rangedPhysicalAttack(attacker, target) {
    if (!target || target.dead || attacker.dead || attacker.faction === target.faction) return;
    if (this.rng() > this.hitChance(attacker, target)) {
      bus.emit('combat:miss', { source: attacker, target });
      this.ctx.fx?.spawn('hit.block', _a.copy(target.position).setY(target.position.y + target.height * 0.55));
      return;
    }
    const raw = this._roll(attacker.dc) + (attacker.effectPower?.('zen') || 0);
    const armor = this._roll(target.ac) + (target.effectPower?.('ghost_shield') || 0);
    this.applyDamage(attacker, target, Math.max(1, raw - armor), 'physical', false);
  }

  applyDamage(attacker, target, amount, kind, crit) {
    if (!target || target.dead) return;
    const shield = target.effectPower?.('shield') || 0;
    if (shield > 0) {
      const reduction = THREE.MathUtils.clamp(0.16 + shield * 0.1, 0, 0.62);
      amount = Math.max(1, Math.round(amount * (1 - reduction)));
    } else {
      amount = Math.max(1, Math.round(amount));
    }

    const eventKind = kind === 'physical' || kind === 'poison' ? kind : 'magic';
    const killed = target.takeDamage(amount, eventKind, attacker, crit);

    const at = _a.copy(target.position).setY(target.position.y + (target.height || 1.6) * 0.6);
    if (kind === 'physical') {
      this.ctx.fx?.spawn(crit ? 'hit.crit' : 'hit.slash', at);
      const hardBody = target.undead
        || target.mdef?.body?.plan === 'idol'
        || target.monsterId === 'stone_golem';
      this.ctx.fx?.spawn(hardBody ? 'hit.spark' : 'hit.blood', at, { scale: crit ? 1.5 : 1 });
      bus.emit('audio:sfx', {
        id: attacker?.faction === 'monster' ? (attacker.mdef?.sfx?.hit || 'monster.hit') : 'sword.hit',
        pos: target.position,
      });
    } else if (kind === 'poison') {
      this.ctx.fx?.spawn('poison.tick', at);
    } else {
      this.ctx.fx?.spawn('hit.spark', at, { color: kind === 'fire' ? 0xff7722 : 0x66ccff });
      if (kind === 'ice' && !killed) target.addEffect?.('slow', 2.6, 0.28, attacker);
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
      const range = s.school === 'warrior' ? caster.dc
        : s.school === 'taoist' ? caster.sc : caster.mc;
      let base = this._roll(range);
      base += caster.effectPower?.('zen') || 0;
      if (s.school === 'taoist') base += caster.effectPower?.('spirit') || 0;
      return Math.max(1, Math.round(base * (s.power || 1)));
    };
    const fallback = point || caster.position;
    const aim = target && !target.dead
      ? target.position.clone()
      : new THREE.Vector3(fallback.x, this.world.heightAt(fallback.x, fallback.z), fallback.z);

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
        const element = s.element || (s.school === 'warrior' ? 'physical' : 'magic');
        const amount = power();
        if (element === 'physical') this.physicalAreaAttack(caster, aim, s.radius || 3, s.power || 1);
        else this.areaDamage(caster, aim, s.radius || 3, amount, element);
        if ((s.duration || 0) > 1.5) {
          this._addZone(caster, aim, s.radius || 3, amount, element, s.duration);
        }
        this.ctx.engine.addShake(0.3);
        break;
      }

      case 'nova': {
        this.ctx.fx?.spawn(s.vfx || 'ice.storm', caster.position, { scale: s.radius, color: s.color });
        const element = s.element || (s.school === 'warrior' ? 'physical' : 'magic');
        if (element === 'physical') {
          this.physicalAreaAttack(caster, caster.position, s.radius || 4, s.power || 1);
        } else {
          this.areaDamage(caster, caster.position, s.radius || 4, power(), element);
        }
        for (const e of this.world.entitiesInRange(caster.position, s.radius || 4, 'monster')) {
          if (s.knockback) this.knockback(e, caster.position, s.knockback);
          if (s.stun) e.stunTimer = Math.max(e.stunTimer, s.stun);
        }
        break;
      }

      case 'heal': {
        const amount = Math.round(power() * 1.6);
        const allies = s.radius
          ? this.world.entitiesInRange(caster.position, s.radius, caster.faction)
          : [target && target.faction === caster.faction ? target : caster];
        for (const who of allies) {
          if (who.heal(amount) <= 0) continue;
          this.ctx.fx?.spawn('heal.aura', who.position, { parent: who.root });
        }
        bus.emit('audio:sfx', { id: 'heal', pos: caster.position });
        break;
      }

      case 'buff': {
        const allies = s.radius
          ? this.world.entitiesInRange(caster.position, s.radius, caster.faction)
          : [caster];
        for (const ally of allies) {
          ally.addEffect(s.buff, s.duration || 20, s.buffPower || 1, caster);
          this.ctx.fx?.spawn(s.vfx || 'shield.magic', ally.position, {
            parent: ally.root,
            duration: s.duration,
            color: s.color,
          });
        }
        break;
      }

      case 'debuff': {
        const hostile = caster.faction === 'player' ? 'monster' : 'player';
        const list = target && target.faction === hostile
          ? [target] : this.world.entitiesInRange(aim, s.radius || 2, hostile);
        for (const e of list) {
          e.addEffect(s.buff || 'poison', s.duration || 12, power() * 0.25, caster);
          this.ctx.fx?.spawn('poison.cloud', e.position, { parent: e.root });
        }
        break;
      }

      case 'summon': {
        if (caster.summonedPet && !caster.summonedPet.dead) caster.summonedPet.die(caster);
        const pet = this.world.summonPet(caster, s.summon || 'skeleton', s.summonLevel || 1);
        if (pet) {
          caster.summonedPet = pet;
          this.ctx.fx?.spawn('summon.burst', pet.position, { scale: pet.mdef?.scale || 1 });
        }
        break;
      }

      case 'melee_arc': {
        // 半月弯刀 / 烈火剑法: sweep everything in a cone in front of the caster.
        const hits = this.world.entitiesInRange(caster.position, s.range || 2.2, 'monster');
        for (const e of hits) {
          if (!this.world.hasLineOfSight(caster, e)) continue;
          const ang = Math.atan2(e.position.x - caster.position.x, e.position.z - caster.position.z);
          let d = Math.abs(((ang - caster.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (d <= (s.arc || Math.PI * 0.6) * 0.5) {
            const offense = this._roll(caster.dc) + (caster.effectPower?.('zen') || 0);
            const defense = this._roll(e.ac) + (e.effectPower?.('ghost_shield') || 0);
            const dmg = Math.max(1, Math.round(offense * (s.power || 1.4)) - defense);
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

  physicalAreaAttack(source, center, radius, powerScale = 1) {
    const faction = source.faction === 'player' ? 'monster' : 'player';
    for (const e of this.world.entitiesInRange(center, radius, faction)) {
      const falloff = 1 - Math.min(1, e.distanceTo(center) / radius) * 0.35;
      const raw = (this._roll(source.dc) + (source.effectPower?.('zen') || 0)) * powerScale * falloff;
      const armor = this._roll(e.ac) + (e.effectPower?.('ghost_shield') || 0);
      this.applyDamage(source, e, Math.max(1, Math.round(raw - armor)), 'physical', false);
    }
  }

  _addZone(source, center, radius, power, element, seconds) {
    this.zones.push({
      source,
      center: center.clone(),
      radius,
      power: Math.max(1, Math.round(power * 0.34)),
      element,
      life: seconds,
      tick: 0.72,
    });
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
      handle: null,
    };
    p.handle = this.ctx.fx?.spawn(opts.vfx || 'fire.ball', p.pos, { color: opts.color });
    this.projectiles.push(p);
    return p;
  }

  monsterProjectile(monster, target) {
    bus.emit('audio:sfx', {
      id: monster.aiKind === 'ranged' ? 'bow.shoot' : 'fire.cast',
      pos: monster.position,
    });
    this.spawnProjectile(monster, target, target.position, {
      speed: 12,
      vfx: monster.mdef.projectileVfx || 'soul.fireball',
      color: monster.mdef.projectileColor,
      onHit: (hit) => {
        if (monster.aiKind === 'ranged') this.rangedPhysicalAttack(monster, hit);
        else this.magicAttack(monster, hit, this._roll(monster.dc), 'magic');
      },
    });
  }

  update(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick += 0.72;
        if (z.element === 'physical') this.physicalAreaAttack(z.source, z.center, z.radius, 0.34);
        else this.areaDamage(z.source, z.center, z.radius, z.power, z.element);
      }
      if (z.life <= 0) this.zones.splice(i, 1);
    }

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

      _b.set(
        p.pos.x + (dx / d) * step,
        p.pos.y + (dy / d) * step,
        p.pos.z + (dz / d) * step
      );
      if (!this.world.nav.isWalkable(Math.floor(_b.x), Math.floor(_b.z))) {
        p.handle?.stop();
        p.onMiss?.(p.pos.clone());
        this.projectiles.splice(i, 1);
        continue;
      }
      p.pos.copy(_b);
      p.handle?.setPosition(p.pos);
    }
  }

  clear() {
    for (const p of this.projectiles) p.handle?.stop();
    this.projectiles.length = 0;
    this.zones.length = 0;
  }
}

export default Combat;
