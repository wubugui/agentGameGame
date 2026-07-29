import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { Entity } from './Entity.js';
import { buildHumanoid } from './CharacterRig.js';
import { CLASSES, SKILLS, EXP_TABLE } from '../game/Content.js';
import { PLAYER, COMBAT } from '../game/Config.js';

/**
 * The hero. Click-to-move, auto-attack on the current target, hotkey skills,
 * and the stat block Mir2 players will recognise (AC/MAC ranges, DC/MC/SC,
 * accuracy vs agility, weight limits).
 */
export class Player extends Entity {
  constructor(world, { name, klass }) {
    const cls = CLASSES[klass] || CLASSES.warrior;
    super(world, { name, faction: 'player', level: 1, moveSpeed: PLAYER.walkSpeed, selectable: false });

    this.klass = klass;
    this.cls = cls;
    this.exp = 0;
    this.gold = 5000;
    this.stamina = 100;
    this.staminaMax = 100;

    /** Learned skill ids -> { level, exp } */
    this.skills = new Map();
    this.cooldowns = new Map();
    /** Hotbar: index 0..7 -> skill id (F1..F8) */
    this.hotbar = new Array(8).fill(null);

    this.equipment = { weapon: null, armor: null, helmet: null, necklace: null, ringL: null, ringR: null, braceletL: null, braceletR: null, belt: null, boots: null, shield: null };

    this._applyBaseStats();
    this.hp = this.hpMax; this.mp = this.mpMax;

    const rig = buildHumanoid({
      archetype: klass,
      build: 'm',
      palette: cls.palette,
      armor: cls.startArmor,
      weapon: cls.startWeapon,
      scale: 1,
    }, world.ctx);
    this._attachRig(rig, klass);

    /** What the player clicked: an entity to attack or a point to walk to. */
    this.orderTarget = null;
    this.orderPoint = null;
    this.autoAttack = true;
    this.castTimer = 0;
    this.pendingSkill = null;
    this._statsTimer = 0;
    this._footstepTimer = 0;

    for (const id of cls.startSkills || []) this.learnSkill(id);
  }

  _applyBaseStats() {
    const c = this.cls, L = this.level;
    const g = c.growth;
    this.hpMax = Math.round(c.base.hp + g.hp * (L - 1));
    this.mpMax = Math.round(c.base.mp + g.mp * (L - 1));
    this.dc = [Math.round(c.base.dc[0] + g.dc * (L - 1)), Math.round(c.base.dc[1] + g.dc * 1.5 * (L - 1))];
    this.mc = [Math.round(c.base.mc[0] + g.mc * (L - 1)), Math.round(c.base.mc[1] + g.mc * 1.5 * (L - 1))];
    this.sc = [Math.round(c.base.sc[0] + g.sc * (L - 1)), Math.round(c.base.sc[1] + g.sc * 1.5 * (L - 1))];
    this.ac = [0, Math.round(g.ac * (L - 1))];
    this.mac = [0, Math.round(g.mac * (L - 1))];
    this.accuracy = c.base.accuracy + Math.floor((L - 1) / 6);
    this.agility = c.base.agility + Math.floor((L - 1) / 7);
    this.attackSpeed = 1;
    this.weightMax = 40 + L * 2;
    this._equipmentBonuses();
  }

  /** Fold every equipped item's stats into the live stat block. */
  _equipmentBonuses() {
    this.bonus = { hp: 0, mp: 0, dc: [0, 0], mc: [0, 0], sc: [0, 0], ac: [0, 0], mac: [0, 0], accuracy: 0, agility: 0, attackSpeed: 0 };
    for (const it of Object.values(this.equipment)) {
      if (!it || !it.stats) continue;
      for (const [k, v] of Object.entries(it.stats)) {
        if (Array.isArray(v) && Array.isArray(this.bonus[k])) { this.bonus[k][0] += v[0]; this.bonus[k][1] += v[1]; }
        else if (typeof v === 'number' && typeof this.bonus[k] === 'number') this.bonus[k] += v;
      }
    }
    this.hpMax += this.bonus.hp;
    this.mpMax += this.bonus.mp;
    for (const k of ['dc', 'mc', 'sc', 'ac', 'mac']) { this[k][0] += this.bonus[k][0]; this[k][1] += this.bonus[k][1]; }
    this.accuracy += this.bonus.accuracy;
    this.agility += this.bonus.agility;
    this.attackSpeed += this.bonus.attackSpeed;
  }

  recompute() {
    const hpFrac = this.hpMax > 0 ? this.hp / this.hpMax : 1;
    const mpFrac = this.mpMax > 0 ? this.mp / this.mpMax : 1;
    this._applyBaseStats();
    this.hp = Math.round(this.hpMax * hpFrac);
    this.mp = Math.round(this.mpMax * mpFrac);
    this.emitStats();
  }

  /** Rebuild the visible loadout after an equipment swap, preserving Entity.root. */
  refreshAppearance() {
    const eq = this.equipment;
    const nextRig = buildHumanoid({
      archetype: this.klass,
      build: 'm',
      palette: this.cls.palette,
      armor: eq.armor?.id || null,
      helmet: eq.helmet?.id || null,
      weapon: eq.weapon?.id || null,
      shield: eq.shield?.id || null,
      scale: 1,
    }, this.world.ctx);
    if (!nextRig) return false;

    const oldRig = this.rig;
    const oldClip = this.dead ? 'dead' : (this.animator?.current || 'idle');
    oldRig?.root?.parent?.remove(oldRig.root);
    oldRig?.dispose?.();
    this._attachRig(nextRig, this.klass);
    this.animator.setFacing?.(this.facing);
    this.animator.play(oldClip, { force: true, blend: 0.01 });
    this.root.position.copy(this.position);
    return true;
  }

  emitStats() {
    bus.emit('player:stats', {
      hp: this.hp, hpMax: this.hpMax, mp: this.mp, mpMax: this.mpMax,
      exp: this.exp, expMax: EXP_TABLE[this.level] || 999999,
      level: this.level, stamina: this.stamina, staminaMax: this.staminaMax,
      gold: this.gold,
    });
  }

  learnSkill(id) {
    const skill = SKILLS[id];
    if (!skill || this.skills.has(id)) return false;
    if (skill.class && skill.class !== this.klass) {
      bus.emit('chat', { text: '你的职业无法修习这本技能书', channel: 'system' });
      return false;
    }
    if ((skill.level || 1) > this.level) {
      bus.emit('chat', { text: `需要等级 ${skill.level} 才能修习【${skill.name}】`, channel: 'system' });
      return false;
    }
    this.skills.set(id, { level: 1, exp: 0 });
    const slot = this.hotbar.indexOf(null);
    if (slot >= 0) this.hotbar[slot] = id;
    bus.emit('chat', { text: `你学会了【${SKILLS[id].name}】`, channel: 'system' });
    bus.emit('skill:learned', { skillId: id });
    return true;
  }

  gainExp(amount) {
    if (this.dead) return;
    this.exp += amount;
    bus.emit('chat', { text: `获得经验 ${amount}`, channel: 'exp' });
    while (this.exp >= (EXP_TABLE[this.level] || Infinity)) {
      this.exp -= EXP_TABLE[this.level];
      this.level++;
      this.recompute();
      this.hp = this.hpMax; this.mp = this.mpMax;
      bus.emit('player:levelup', { level: this.level });
      this.ctx.fx?.spawn('level.up', this.position, { parent: this.root });
      bus.emit('audio:sfx', { id: 'levelup' });
      // Class skills unlock at their level gates.
      for (const [id, s] of Object.entries(SKILLS)) {
        if (s.class === this.klass && s.level <= this.level) this.learnSkill(id);
      }
    }
    this.emitStats();
  }

  // ---- orders -----------------------------------------------------------

  orderMove(x, z) {
    this.orderTarget = null;
    this.pendingSkill = null;
    this.castTimer = 0;
    this.animator?.clearOverlay?.();
    const moved = this.moveTo(x, z);
    this.orderPoint = moved ? { x, z } : null;
    return moved;
  }

  orderAttack(entity) {
    if (!entity || entity.dead || entity.faction !== 'monster') return false;
    const wasCasting = this.castTimer > 0;
    this.pendingSkill = null;
    this.castTimer = 0;
    if (wasCasting) this.animator?.clearOverlay?.();
    this.orderTarget = entity;
    this.orderPoint = null;
    return true;
  }

  orderSkill(skillId, targetEntity, targetPoint) {
    const s = SKILLS[skillId];
    if (!s || !this.skills.has(skillId) || this.dead) return false;
    if (this.castTimer > 0) {
      bus.emit('chat', { text: '正在施法', channel: 'system' });
      bus.emit('audio:sfx', { id: 'ui.error' });
      return false;
    }
    const cd = this.cooldowns.get(skillId) || 0;
    if (cd > 0) {
      bus.emit('chat', { text: `【${s.name}】还需 ${cd.toFixed(1)} 秒`, channel: 'system' });
      bus.emit('audio:sfx', { id: 'ui.error' });
      return false;
    }
    if (this.mp < s.mp) {
      bus.emit('chat', { text: '魔法值不足', channel: 'system' });
      bus.emit('audio:sfx', { id: 'ui.error' });
      return false;
    }
    const fallback = targetEntity?.position;
    this.pendingSkill = {
      id: skillId,
      target: targetEntity || null,
      point: targetPoint ? { x: targetPoint.x, z: targetPoint.z }
        : fallback ? { x: fallback.x, z: fallback.z } : null,
    };
    // A newly ordered skill cancels any uncommitted basic swing without
    // letting Animator resolve that swing early when cast.begin replaces it.
    this.animator?.clearOverlay?.();
    this.orderTarget = targetEntity || null;
    return true;
  }

  // ---- per-frame --------------------------------------------------------

  update(dt, input) {
    if (this.dead) { super.update(dt); return; }

    for (const [k, v] of this.cooldowns) {
      if (v > 0) {
        const n = Math.max(0, v - dt);
        this.cooldowns.set(k, n);
        if (n === 0) bus.emit('skill:cooldown', { skillId: k, seconds: 0 });
      }
    }

    if (this.stunTimer > 0) {
      this.castTimer = 0;
      this.pendingSkill = null;
      this.stop();
      this.animator.clearOverlay();
      this.animator.play('idle.combat');
      super.update(dt);
      this._emitStatsOnCadence(dt);
      return;
    }

    const wantRun = input?.running && this.stamina > 1;
    const haste = Math.min(0.5, this.effectPower('haste') * 0.12);
    const slow = Math.max(0.45, 1 - this.effectPower('slow'));
    const speed = (wantRun ? PLAYER.runSpeed : PLAYER.walkSpeed) * (1 + haste) * slow;
    if (wantRun && this.moving) this.stamina = Math.max(0, this.stamina - PLAYER.runStaminaDrain * dt);
    else this.stamina = Math.min(this.staminaMax, this.stamina + PLAYER.staminaRegen * dt);

    if (this.castTimer > 0) {
      this.castTimer -= dt;
      this.stop();
      if (this.castTimer <= 0) this._releaseSkill();
    } else if (this.pendingSkill) {
      this._tryCast(dt, speed, wantRun);
    } else if (this.orderTarget) {
      this._pursueTarget(dt, speed, wantRun);
    } else if (this.moving) {
      this._followPath(dt, speed);
      this.animator.play(wantRun ? 'run' : 'walk');
    } else {
      this.animator.play(this.world.combatNearby(this) ? 'idle.combat' : 'idle');
    }

    // Passive regen, slower while moving. Mir2 rewards standing still.
    const rest = this.moving ? 0.35 : 1;
    this.hp = Math.min(this.hpMax, this.hp + this.hpMax * 0.012 * rest * dt);
    this.mp = Math.min(this.mpMax, this.mp + this.mpMax * 0.030 * rest * dt);
    this._updateFootsteps(dt, wantRun);

    super.update(dt);
    this._emitStatsOnCadence(dt);
  }

  _emitStatsOnCadence(dt) {
    this._statsTimer -= dt;
    if (this._statsTimer > 0) return;
    this._statsTimer = 0.1;
    this.emitStats();
  }

  _updateFootsteps(dt, running) {
    if (!this.moving) {
      this._footstepTimer = Math.min(this._footstepTimer, 0.08);
      return;
    }
    this._footstepTimer -= dt;
    if (this._footstepTimer > 0) return;
    this._footstepTimer = running ? 0.28 : 0.43;
    const biome = this.world.def?.biome;
    const id = biome === 'desert' ? 'walk.sand'
      : (biome === 'temple' || biome === 'cave' || biome === 'hell') ? 'walk.stone'
        : 'walk.grass';
    bus.emit('audio:sfx', { id, pos: this.position });
    this.ctx.fx?.spawn('dust.step', this.position, { scale: running ? 0.58 : 0.38 });
  }

  _pursueTarget(dt, speed, running) {
    const t = this.orderTarget;
    if (!t || t.dead) { this.orderTarget = null; return; }
    const d = this.distanceTo(t);
    const reach = COMBAT.meleeRange + (this.equipment.weapon?.reach || 0);
    if (d > reach || !this.world.hasLineOfSight(this, t)) {
      // Repath only when the target has drifted off our current route.
      const last = this.path?.[this.path.length - 1];
      if (!this.moving || !last || Math.hypot(last.x - t.position.x, last.z - t.position.z) > 0.9) {
        this.moveTo(t.position.x, t.position.z);
      }
      this._followPath(dt, speed);
      this.animator.play(running ? 'run' : 'walk');
    } else {
      this.stop();
      this.faceToward(t.position.x, t.position.z);
      this.animator.play('idle.combat');
      if (this.attackCooldown <= 0 && this.autoAttack) this._swing(t);
    }
  }

  _swing(t) {
    const haste = 1 + Math.min(0.5, this.effectPower('haste') * 0.1);
    const slow = Math.max(0.45, 1 - this.effectPower('slow'));
    const effectiveSpeed = this.attackSpeed * haste * slow;
    this.attackCooldown = COMBAT.baseAttackInterval / Math.max(0.4, effectiveSpeed);
    const clip = this.cls.attackClip || 'attack.slash';
    this.animator.overlay(clip, {
      onEvent: (e) => {
        if (e !== 'impact' || t.dead) return;
        this.world.combat.meleeAttack(this, t);
      },
    });
    bus.emit('audio:sfx', { id: 'sword.swing', pos: this.position });
  }

  _tryCast(dt, speed, running) {
    const p = this.pendingSkill, s = SKILLS[p.id];
    const aim = p.target && !p.target.dead ? p.target.position : p.point;
    if (!aim) { this.pendingSkill = null; return; }
    const d = Math.hypot(aim.x - this.position.x, aim.z - this.position.z);
    const los = !p.target || this.world.hasLineOfSight(this, p.target);
    if (d > s.range || !los) {
      const last = this.path?.[this.path.length - 1];
      if (!this.moving || !last || Math.hypot(last.x - aim.x, last.z - aim.z) > 0.9) {
        if (!this.moveTo(aim.x, aim.z)) {
          bus.emit('chat', { text: '无法接近施法目标', channel: 'system' });
          this.pendingSkill = null;
          return;
        }
      }
      this._followPath(dt, speed);
      this.animator.play(running ? 'run' : 'walk');
      return;
    }
    this.stop();
    this.faceToward(aim.x, aim.z);
    this.castTimer = s.cast || 0.35;
    this.animator.overlay('cast.begin', { speed: 0.55 / this.castTimer });
    this.ctx.fx?.spawn('summon.rune', this.position, { duration: this.castTimer, color: s.color });
  }

  _releaseSkill() {
    const p = this.pendingSkill;
    this.pendingSkill = null;
    if (!p) return;
    const s = SKILLS[p.id];
    if (!s || this.mp < s.mp) return;
    this.mp -= s.mp;
    this.cooldowns.set(p.id, s.cooldown || 0);
    bus.emit('skill:cooldown', { skillId: p.id, seconds: s.cooldown || 0 });
    bus.emit('skill:cast', { skillId: p.id, caster: this, target: p.target });
    this.animator.overlay('cast.release');
    this.world.combat.castSkill(this, p.id, p.target, p.point);
  }

  die(killer) {
    this.pendingSkill = null;
    this.castTimer = 0;
    this.orderPoint = null;
    super.die(killer);
    bus.emit('player:died', {});
    // Mir2 death tax: you keep your gear, you lose a slice of your experience.
    this.exp = Math.max(0, Math.floor(this.exp * 0.9));
  }

  revive(x, z) {
    this.dead = false;
    this.deadFor = 0;
    this.hp = Math.round(this.hpMax * 0.5);
    this.mp = Math.round(this.mpMax * 0.5);
    this.orderTarget = null;
    this.orderPoint = null;
    this.pendingSkill = null;
    this.castTimer = 0;
    this.stunTimer = 0;
    this.stop();
    this.setPosition(x, z);
    this.animator.play('idle');
    this.emitStats();
  }
}

export default Player;
