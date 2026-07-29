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
    const hpFrac = this.hp / this.hpMax, mpFrac = this.mp / this.mpMax;
    this._applyBaseStats();
    this.hp = Math.round(this.hpMax * hpFrac);
    this.mp = Math.round(this.mpMax * mpFrac);
    this.emitStats();
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
    if (!SKILLS[id] || this.skills.has(id)) return false;
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
    this.orderPoint = { x, z };
    this.moveTo(x, z);
  }

  orderAttack(entity) {
    if (!entity || entity.dead || entity.faction === 'player') return;
    this.orderTarget = entity;
    this.orderPoint = null;
  }

  orderSkill(skillId, targetEntity, targetPoint) {
    const s = SKILLS[skillId];
    if (!s || !this.skills.has(skillId)) return;
    if ((this.cooldowns.get(skillId) || 0) > 0) { bus.emit('audio:sfx', { id: 'ui.error' }); return; }
    if (this.mp < s.mp) { bus.emit('chat', { text: '魔法值不足', channel: 'system' }); bus.emit('audio:sfx', { id: 'ui.error' }); return; }
    this.pendingSkill = { id: skillId, target: targetEntity || null, point: targetPoint || null };
    this.orderTarget = targetEntity || null;
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

    const wantRun = input?.running && this.stamina > 1;
    const speed = wantRun ? PLAYER.runSpeed : PLAYER.walkSpeed;
    if (wantRun && this.moving) this.stamina = Math.max(0, this.stamina - PLAYER.runStaminaDrain * dt);
    else this.stamina = Math.min(this.staminaMax, this.stamina + PLAYER.staminaRegen * dt);

    if (this.castTimer > 0) {
      this.castTimer -= dt;
      this.stop();
      if (this.castTimer <= 0) this._releaseSkill();
    } else if (this.pendingSkill) {
      this._tryCast();
    } else if (this.orderTarget) {
      this._pursueTarget(dt, speed);
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

    super.update(dt);
    this.emitStats();
  }

  _pursueTarget(dt, speed) {
    const t = this.orderTarget;
    if (!t || t.dead) { this.orderTarget = null; return; }
    const d = this.distanceTo(t);
    const reach = COMBAT.meleeRange + (this.equipment.weapon?.reach || 0);
    if (d > reach) {
      // Repath only when the target has drifted off our current route.
      const last = this.path?.[this.path.length - 1];
      if (!this.moving || !last || Math.hypot(last.x - t.position.x, last.z - t.position.z) > 0.9) {
        this.moveTo(t.position.x, t.position.z);
      }
      this._followPath(dt, speed);
      this.animator.play(speed > PLAYER.walkSpeed ? 'run' : 'walk');
    } else {
      this.stop();
      this.faceToward(t.position.x, t.position.z);
      this.animator.play('idle.combat');
      if (this.attackCooldown <= 0 && this.autoAttack) this._swing(t);
    }
  }

  _swing(t) {
    this.attackCooldown = COMBAT.baseAttackInterval / Math.max(0.4, this.attackSpeed);
    const clip = this.cls.attackClip || 'attack.slash';
    this.animator.overlay(clip, {
      onEvent: (e) => {
        if (e !== 'impact' || t.dead) return;
        this.world.combat.meleeAttack(this, t);
      },
    });
    bus.emit('audio:sfx', { id: 'sword.swing', pos: this.position });
  }

  _tryCast() {
    const p = this.pendingSkill, s = SKILLS[p.id];
    const aim = p.target && !p.target.dead ? p.target.position : p.point;
    if (!aim) { this.pendingSkill = null; return; }
    const d = Math.hypot(aim.x - this.position.x, aim.z - this.position.z);
    if (d > s.range) {
      this.moveTo(aim.x, aim.z);
      this._followPath(1 / 60, PLAYER.runSpeed);
      this.animator.play('run');
      return;
    }
    this.stop();
    this.faceToward(aim.x, aim.z);
    this.castTimer = s.cast || 0.35;
    this.animator.overlay('cast.begin');
    this.ctx.fx?.spawn('summon.rune', this.position, { duration: this.castTimer, color: s.color });
  }

  _releaseSkill() {
    const p = this.pendingSkill;
    this.pendingSkill = null;
    if (!p) return;
    const s = SKILLS[p.id];
    if (this.mp < s.mp) return;
    this.mp -= s.mp;
    this.cooldowns.set(p.id, s.cooldown || 0);
    bus.emit('skill:cooldown', { skillId: p.id, seconds: s.cooldown || 0 });
    bus.emit('skill:cast', { skillId: p.id, caster: this, target: p.target });
    this.animator.overlay('cast.release');
    this.world.combat.castSkill(this, p.id, p.target, p.point);
  }

  die(killer) {
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
    this.stop();
    this.setPosition(x, z);
    this.animator.play('idle');
    this.emitStats();
  }
}

export default Player;
