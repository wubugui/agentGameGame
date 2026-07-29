import bus from '../core/EventBus.js';
import { Entity } from './Entity.js';
import { buildHumanoid } from './CharacterRig.js';
import { NPCS } from '../game/Content.js';

/**
 * Town NPCs: shopkeepers, trainers, storage. They stand still, turn to face
 * the player when spoken to, and open a dialog panel through the bus.
 */
export class Npc extends Entity {
  constructor(world, npcId, spawn) {
    const def = NPCS[npcId];
    if (!def) throw new Error(`Unknown NPC '${npcId}'`);
    super(world, { name: def.name, faction: 'npc', level: 1, hp: 9999, moveSpeed: 0 });
    this.npcId = npcId;
    this.ndef = def;
    this.title = def.title || '';
    this.interactRange = 2.6;

    this._attachRig(buildHumanoid({ archetype: 'npc', ...(def.rig || {}) }, world.ctx), 'npc');
    this.setPosition(spawn.x, spawn.z);
    this.facing = spawn.facing ?? 0;
    if (this.animator) this.animator.facingTarget = this.facing;
  }

  interact(player) {
    this.faceToward(player.position.x, player.position.z);
    this.animator?.overlay('cheer');
    bus.emit('audio:sfx', { id: 'ui.click' });
    bus.emit('npc:dialog', { npc: this, def: this.ndef, player });
  }

  update(dt) {
    this.animator?.play('idle');
    super.update(dt);
  }
}

export default Npc;
