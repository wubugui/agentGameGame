import bus from '../core/EventBus.js';
import { ITEMS } from './Content.js';

/** Mir2 bags are a fixed grid; overflow goes nowhere and the pickup is refused. */
export const BAG_SLOTS = 46;

let _instanceUid = 1;

/** Make a live item instance from a catalogue id (rolls variable stats). */
export function makeItem(itemId, rng, qty = 1) {
  const base = ITEMS[itemId];
  if (!base) { console.warn(`[inventory] unknown item '${itemId}'`); return null; }
  const it = {
    uid: _instanceUid++,
    id: itemId,
    name: base.name,
    type: base.type,
    slot: base.slot || null,
    icon: base.icon || 'misc',
    qty: base.stackable ? qty : 1,
    stackable: !!base.stackable,
    weight: base.weight || 1,
    price: base.price || 1,
    reqLevel: base.reqLevel || 0,
    klass: base.class || null,
    durability: base.durability ? [base.durability, base.durability] : null,
    reach: base.reach || 0,
    stats: {},
    desc: base.desc || '',
  };
  // Roll the per-drop variance that made Mir2 gear feel personal.
  for (const [k, v] of Object.entries(base.stats || {})) {
    if (Array.isArray(v) && Array.isArray(v[0])) {
      // [[loMin,loMax],[hiMin,hiMax]]
      it.stats[k] = [
        v[0][0] + Math.floor((rng?.() ?? Math.random()) * (v[0][1] - v[0][0] + 1)),
        v[1][0] + Math.floor((rng?.() ?? Math.random()) * (v[1][1] - v[1][0] + 1)),
      ];
    } else if (Array.isArray(v)) {
      it.stats[k] = [v[0], v[1]];
    } else {
      it.stats[k] = v;
    }
  }
  return it;
}

export class Inventory {
  constructor(player, rng) {
    this.player = player;
    this.rng = rng;
    /** @type {Array<object|null>} */
    this.slots = new Array(BAG_SLOTS).fill(null);
  }

  get weight() {
    return this.slots.reduce((w, s) => w + (s ? s.weight * s.qty : 0), 0);
  }

  add(item) {
    if (!item) return false;
    if (item.stackable) {
      const s = this.slots.find((x) => x && x.id === item.id);
      if (s) { s.qty += item.qty; bus.emit('inventory:changed', {}); return true; }
    }
    const i = this.slots.indexOf(null);
    if (i < 0) { bus.emit('chat', { text: '背包已满', channel: 'system' }); return false; }
    this.slots[i] = item;
    bus.emit('inventory:changed', {});
    return true;
  }

  remove(uid, qty = 1) {
    const i = this.slots.findIndex((s) => s && s.uid === uid);
    if (i < 0) return false;
    const s = this.slots[i];
    if (s.stackable && s.qty > qty) s.qty -= qty;
    else this.slots[i] = null;
    bus.emit('inventory:changed', {});
    return true;
  }

  find(uid) { return this.slots.find((s) => s && s.uid === uid) || null; }
  countOf(itemId) { return this.slots.reduce((n, s) => n + (s && s.id === itemId ? s.qty : 0), 0); }

  canEquip(item) {
    const p = this.player;
    if (!item.slot) return { ok: false, why: '这件物品不能装备' };
    if (item.reqLevel > p.level) return { ok: false, why: `需要等级 ${item.reqLevel}` };
    if (item.klass && item.klass !== p.klass) return { ok: false, why: '你的职业无法使用' };
    return { ok: true };
  }

  equip(uid) {
    const item = this.find(uid);
    if (!item) return false;
    const chk = this.canEquip(item);
    if (!chk.ok) { bus.emit('chat', { text: chk.why, channel: 'system' }); bus.emit('audio:sfx', { id: 'ui.error' }); return false; }

    const slot = item.slot;
    const prev = this.player.equipment[slot];
    this.remove(uid);
    this.player.equipment[slot] = item;
    if (prev) this.add(prev);

    this.player.recompute();
    bus.emit('inventory:changed', {});
    bus.emit('equipment:changed', { slot, item });
    bus.emit('audio:sfx', { id: 'ui.click' });
    return true;
  }

  unequip(slot) {
    const item = this.player.equipment[slot];
    if (!item) return false;
    if (this.slots.indexOf(null) < 0) { bus.emit('chat', { text: '背包已满', channel: 'system' }); return false; }
    this.player.equipment[slot] = null;
    this.add(item);
    this.player.recompute();
    bus.emit('equipment:changed', { slot, item: null });
    return true;
  }

  use(uid) {
    const item = this.find(uid);
    if (!item) return false;
    if (item.type === 'potion') {
      const p = this.player;
      if (item.stats.healHp) p.heal(item.stats.healHp);
      if (item.stats.healMp) p.mp = Math.min(p.mpMax, p.mp + item.stats.healMp);
      this.remove(uid, 1);
      bus.emit('audio:sfx', { id: 'potion' });
      p.emitStats();
      return true;
    }
    if (item.slot) return this.equip(uid);
    if (item.type === 'book') {
      const learned = this.player.learnSkill(item.stats.teaches);
      if (learned) { this.remove(uid, 1); return true; }
      bus.emit('chat', { text: '你已经会这个技能了', channel: 'system' });
      return false;
    }
    return false;
  }

  /** Quick-drink the cheapest healing potion in the bag (Mir2 muscle memory). */
  quickPotion(which = 'hp') {
    const key = which === 'hp' ? 'healHp' : 'healMp';
    const cand = this.slots.filter((s) => s && s.type === 'potion' && s.stats[key]);
    if (!cand.length) { bus.emit('chat', { text: which === 'hp' ? '没有治疗药水' : '没有魔法药水', channel: 'system' }); return false; }
    cand.sort((a, b) => a.stats[key] - b.stats[key]);
    return this.use(cand[0].uid);
  }

  sell(uid) {
    const item = this.find(uid);
    if (!item) return false;
    const gold = Math.max(1, Math.floor(item.price * 0.4)) * item.qty;
    this.remove(uid, item.qty);
    this.player.gold += gold;
    bus.emit('chat', { text: `卖出【${item.name}】获得 ${gold} 金币`, channel: 'system' });
    bus.emit('audio:sfx', { id: 'coin' });
    this.player.emitStats();
    return true;
  }

  buy(itemId, qty = 1) {
    const base = ITEMS[itemId];
    if (!base) return false;
    const cost = (base.price || 1) * qty;
    if (this.player.gold < cost) { bus.emit('chat', { text: '金币不足', channel: 'system' }); return false; }
    const it = makeItem(itemId, this.rng, qty);
    if (!this.add(it)) return false;
    this.player.gold -= cost;
    bus.emit('audio:sfx', { id: 'coin' });
    this.player.emitStats();
    return true;
  }
}

export default Inventory;
