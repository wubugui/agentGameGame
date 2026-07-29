import * as THREE from 'three';
import bus from '../core/EventBus.js';
import { Engine } from '../core/Engine.js';
import { Input } from '../core/Input.js';
import { makeRng } from '../core/Rng.js';
import { TextureForge } from '../gfx/TextureForge.js';
import { MaterialLibrary } from '../gfx/Materials.js';
import { PostFX } from '../gfx/PostFX.js';
import { Sky } from '../gfx/Sky.js';
import { Weather } from '../gfx/Weather.js';
import { FxSystem } from '../gfx/Particles.js';
import { Audio } from '../audio/Audio.js';
import { World } from '../world/World.js';
import { Player } from '../entities/Player.js';
import { Inventory, makeItem } from './Inventory.js';
import { Hud } from '../ui/Hud.js';
import { getMap } from '../world/MapDefs.js';
import { CLASSES } from './Content.js';
import { PLAYER, WORLD, DEBUG, autoQuality } from './Config.js';

const _p = new THREE.Vector3();

/**
 * Top-level orchestrator: builds the render context, owns the frame loop, turns
 * raw input into player orders, and manages map transitions and death.
 */
export class Game {
  constructor(canvas, { name, klass, quality }) {
    this.canvas = canvas;
    this.quality = quality || autoQuality();

    const engine = new Engine(canvas, this.quality);
    const rng = makeRng(0xBEEF);

    this.ctx = {
      engine, bus, rng,
      quality: this.quality,
      time: 0,
      pickables: null,
      forge: null, materials: null, fx: null, audio: null,
    };

    this.ctx.forge = new TextureForge(engine.renderer, { maxAniso: engine.maxAniso, quality: this.quality });
    this.ctx.materials = new MaterialLibrary(this.ctx.forge, { quality: this.quality, maxAniso: engine.maxAniso });
    this.ctx.audio = new Audio();
    this.ctx.fx = new FxSystem(this.ctx);

    this.input = new Input(canvas);
    this.ctx.pickables = this.input.pickables;

    engine.postfx = new PostFX(engine, { quality: this.quality });
    this.sky = new Sky(this.ctx);
    this.weather = new Weather(this.ctx);
    if (this.sky.envMap) this.ctx.materials.setEnvironment(this.sky.envMap);

    this.pendingName = name;
    this.pendingClass = klass;

    this.world = null;
    this.player = null;
    this.hud = null;
    this.paused = false;
    this.deathTimer = 0;
    this._acc = 0;
    this._fpsSamples = [];
    this._autoTuneTimer = 5;

    this._wireInput();
    this._wireEvents();
  }

  /** Build the first map and drop the hero into it. */
  start(mapId = 'bichon') {
    this.loadMap(mapId, null, true);
    this.hud = new Hud(this);
    this.ctx.audio.unlock();
    this.ctx.audio.music(getMap(mapId).music || 'town');
    this.ctx.audio.ambience(getMap(mapId).ambientLoop || 'town');
    bus.emit('player:spawn', { player: this.player });
    this.player.emitStats();
    this._loop = this._loop.bind(this);
    this.ctx.engine.renderer.setAnimationLoop(this._loop);
  }

  loadMap(mapId, entry = null, first = false) {
    const def = getMap(mapId);
    if (!def) { console.error(`[game] no map '${mapId}'`); return; }

    let carried = null;
    if (this.player) {
      carried = {
        level: this.player.level, exp: this.player.exp, gold: this.player.gold,
        hp: this.player.hp, mp: this.player.mp,
        equipment: this.player.equipment, skills: this.player.skills,
        hotbar: this.player.hotbar, inventory: this.player.inventory,
      };
      this.player = null;
    }
    this.world?.dispose();

    this.ctx.rng = makeRng(def.seed || 1);
    this.world = new World(this.ctx, mapId);

    const p = new Player(this.world, { name: this.pendingName, klass: this.pendingClass });
    const e = entry || def.entry;
    const spot = this.world.nav.isWalkable(Math.floor(e.x), Math.floor(e.z))
      ? e : (this.world.nav.nearestWalkable(Math.floor(e.x), Math.floor(e.z), 12) || e);
    p.setPosition(spot.x + (spot.x % 1 ? 0 : 0.5), spot.z + (spot.z % 1 ? 0 : 0.5));

    if (carried) {
      p.level = carried.level; p.exp = carried.exp; p.gold = carried.gold;
      p.equipment = carried.equipment; p.skills = carried.skills; p.hotbar = carried.hotbar;
      p.recompute();
      p.hp = carried.hp; p.mp = carried.mp;
      p.inventory = carried.inventory;
      p.inventory.player = p;
    } else {
      p.inventory = new Inventory(p, this.ctx.rng);
      for (const [id, qty] of Object.entries(CLASSES[this.pendingClass].startItems || {})) {
        p.inventory.add(makeItem(id, this.ctx.rng, qty));
      }
    }

    this.player = p;
    this.world.setPlayer(p);

    this.sky.setPreset(def.sky || 'day', first ? 0 : 1.2);
    this.weather.set(this.ctx.rng.pick(def.weather || ['clear']), 1, first ? 0 : 3);
    this.ctx.engine.postfx?.setGrade(def.grade || 'normal', first ? 0 : 0.5);

    this.ctx.engine.camTarget.copy(p.position);
    this.ctx.engine.snapCamera();

    if (!first) {
      this.ctx.audio.music(def.music || 'field');
      this.ctx.audio.ambience(def.ambientLoop || 'field');
    }
    bus.emit('map:changed', { mapId, name: def.name });
    bus.emit('chat', { text: `进入【${def.name}】`, channel: 'system' });
  }

  // ---- input ------------------------------------------------------------

  _wireInput() {
    bus.on('input:down', ({ button, shift }) => {
      if (this.paused || !this.player || this.player.dead) return;
      const hit = this.input.pick(this.ctx.engine.camera);

      if (button === 0) {
        if (hit.entity && hit.entity.faction === 'monster' && !hit.entity.dead) {
          this.player.orderAttack(hit.entity);
        } else if (hit.entity && hit.entity.faction === 'npc') {
          if (this.player.distanceTo(hit.entity) <= hit.entity.interactRange) hit.entity.interact(this.player);
          else this.player.orderMove(hit.entity.position.x, hit.entity.position.z);
        } else if (hit.point) {
          if (shift) this.player.faceToward(hit.point.x, hit.point.z);
          else this.player.orderMove(hit.point.x, hit.point.z);
          this.ctx.fx?.spawn('dust.step', hit.point, { scale: 0.5 });
        }
      }
    });

    bus.on('input:key', ({ code, key }) => {
      if (!this.player) return;
      const p = this.player;

      if (code.startsWith('F') && code.length <= 3) {
        const i = parseInt(code.slice(1), 10) - 1;
        if (i >= 0 && i < 8) { this._useHotbar(i); return; }
      }
      if (code.startsWith('Digit')) {
        const i = parseInt(code.slice(5), 10) - 1;
        if (i >= 0 && i < 8) { this._useHotbar(i); return; }
      }

      switch (code) {
        case 'KeyI': case 'KeyB': this.hud?.togglePanel('inventory'); break;
        case 'KeyC': this.hud?.togglePanel('character'); break;
        case 'KeyK': this.hud?.togglePanel('skills'); break;
        case 'KeyM': this.hud?.togglePanel('map'); break;
        case 'KeyH': this.hud?.togglePanel('help'); break;
        case 'Space': case 'KeyZ': p.inventory.quickPotion('hp'); break;
        case 'KeyX': p.inventory.quickPotion('mp'); break;
        case 'KeyE': case 'KeyG': this._interact(); break;
        case 'KeyT': this._togglePickup(); break;
        case 'Escape': this.hud?.closeTopPanel(); break;
        case 'KeyP': this.paused = !this.paused; bus.emit('chat', { text: this.paused ? '已暂停' : '继续', channel: 'system' }); break;
        case 'BracketLeft': this.sky.timeOfDay = (this.sky.timeOfDay + 23) % 24; break;
        case 'BracketRight': this.sky.timeOfDay = (this.sky.timeOfDay + 1) % 24; break;
        case 'Backquote': DEBUG.stats = !DEBUG.stats; break;
        default: break;
      }
      if (key === '+' || key === '=') this._cycleQuality(1);
      if (key === '-' || key === '_') this._cycleQuality(-1);
    });
  }

  _useHotbar(i) {
    const p = this.player;
    const id = p.hotbar[i];
    if (!id) return;
    const hit = this.input.pick(this.ctx.engine.camera);
    const target = (hit.entity && hit.entity.faction === 'monster' && !hit.entity.dead)
      ? hit.entity
      : (p.orderTarget && !p.orderTarget.dead ? p.orderTarget : null);
    const point = hit.point || _p.copy(p.position).add(new THREE.Vector3(Math.sin(p.facing) * 4, 0, Math.cos(p.facing) * 4));
    p.orderSkill(id, target, { x: point.x, z: point.z });
  }

  _interact() {
    const p = this.player;
    if (this.world.pickupNear(p, PLAYER.pickupRange)) return;
    const near = this.world.nearestInteractable(p.position, 2.6);
    if (!near) return;
    if (near.interact) near.interact(p);
    else if (near.onUse) near.onUse(this);
  }

  _togglePickup() {
    this.autoPickup = !this.autoPickup;
    bus.emit('chat', { text: this.autoPickup ? '自动拾取：开' : '自动拾取：关', channel: 'system' });
  }

  _cycleQuality(dir) {
    const order = ['low', 'med', 'high', 'ultra'];
    const i = THREE.MathUtils.clamp(order.indexOf(this.quality) + dir, 0, order.length - 1);
    if (order[i] === this.quality) return;
    this.quality = order[i];
    this.ctx.quality = this.quality;
    this.ctx.engine.setQuality(this.quality);
    bus.emit('chat', { text: `画质：${this.quality.toUpperCase()}`, channel: 'system' });
  }

  _wireEvents() {
    bus.on('player:died', () => {
      this.deathTimer = 4;
      this.ctx.engine.postfx?.setGrade('dead', 1.2);
      this.ctx.audio.music('death');
    });

    bus.on('audio:sfx', ({ id, pos }) => this.ctx.audio.sfx(id, { pos }));

    bus.on('portal:enter', ({ to, toEntry }) => this.loadMap(to, toEntry));
  }

  // ---- frame ------------------------------------------------------------

  _loop() {
    const raw = this.ctx.engine.clock.getDelta();
    const dt = Math.min(raw, 0.1);
    this.ctx.engine.elapsed += dt;
    this.ctx.time += dt;

    if (!this.paused) this._step(dt);

    this.ctx.engine.updateCamera(dt);
    this.ctx.engine.render(dt);

    this._sampleFps(raw);
  }

  _step(dt) {
    const p = this.player;

    const wheel = this.input.takeWheel();
    if (wheel) this.ctx.engine.zoom(wheel);

    this.world.update(dt, this.input);

    if (p && !p.dead) {
      this.ctx.engine.camTarget.set(p.position.x, p.position.y + 1.1, p.position.z);
      this.ctx.audio.setListener(p.position, p.facing);
      if (this.autoPickup) this.world.pickupNear(p, PLAYER.pickupRange);
      this._checkPortals(p);
      this.ctx.engine.postfx?.setDanger(p.hp / p.hpMax < 0.28 ? 1 - p.hp / p.hpMax : 0);
    } else if (p && p.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        const def = getMap(this.mapId || this.world.mapId);
        const home = def.respawn || getMap('bichon').entry;
        if ((def.respawnMap || 'bichon') !== this.world.mapId) this.loadMap(def.respawnMap || 'bichon', home);
        else p.revive(home.x + 0.5, home.z + 0.5);
        this.player.revive?.(home.x + 0.5, home.z + 0.5);
        this.ctx.engine.postfx?.setGrade('normal', 1);
        this.ctx.audio.music(getMap(this.world.mapId).music || 'town');
        this.ctx.engine.snapCamera();
      }
    }

    this.sky.update(dt);
    this.weather.update(dt, p ? p.position : this.ctx.engine.camTarget);
    this.ctx.fx.update(dt, this.ctx.engine.camera);
    this.ctx.materials.update(dt, this.ctx.engine.elapsed);
    this.ctx.engine.postfx?.update?.(dt);
    this.hud?.update(dt);
  }

  _checkPortals(p) {
    for (const portal of this.world.def.portals || []) {
      if (Math.hypot(portal.x + 0.5 - p.position.x, portal.z + 0.5 - p.position.z) < 1.2) {
        this.ctx.fx?.spawn('teleport.out', p.position);
        bus.emit('portal:enter', portal);
        return;
      }
    }
  }

  /** Drop a quality tier if we can't hold frame rate — better smooth than pretty. */
  _sampleFps(raw) {
    this._fpsSamples.push(raw);
    if (this._fpsSamples.length > 90) this._fpsSamples.shift();
    this._autoTuneTimer -= raw;
    if (this._autoTuneTimer > 0 || this._fpsSamples.length < 90) return;
    this._autoTuneTimer = 8;
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    if (avg > 1 / 34 && this.quality !== 'low') this._cycleQuality(-1);
  }

  dispose() {
    this.ctx.engine.renderer.setAnimationLoop(null);
    this.hud?.dispose();
    this.world?.dispose();
    this.ctx.fx.dispose();
    this.ctx.materials.dispose();
    this.ctx.forge.dispose();
    this.ctx.audio.dispose();
    this.sky.dispose();
    this.weather.dispose();
    this.ctx.engine.dispose();
  }
}

export default Game;
