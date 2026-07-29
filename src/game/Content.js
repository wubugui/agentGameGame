/**
 * src/game/Content.js — the content database (CONTRACTS §14).
 *
 * Data only: no THREE, no DOM, no side effects. Every consumer (Player,
 * Combat, Inventory, Npc, World) reads these tables at import time, so nothing
 * here may throw and nothing may allocate lazily in a hot path.
 *
 * Objections noted per CONTRACTS §0 (implemented as specified regardless):
 *  - `Player.equipment` has discrete `ringL/ringR` and `braceletL/braceletR`
 *    slots, but an item definition carries a single `slot` string. Rings and
 *    bracelets are therefore authored against the `ringL` / `braceletL` slots;
 *    the right-hand slots are unreachable until Inventory grows slot groups.
 *  - Only the `poison` and `invisible` status kinds are actually simulated
 *    (Entity._updateEffects / Monster._look). Every other `buff` kind below is
 *    stored on the entity and is currently inert.
 *  - The assignment brief lists a jewellery piece as "绿色project"; that is a
 *    mangled 绿色项链, which is what ships here.
 *
 * Naming: catalogue ids are English snake_case and are deliberately shared with
 * `entities/Armory.js` so an equipped item id can be handed straight to
 * `buildWeapon()` / `buildArmor()` / `buildHelmet()`.
 */

// ---------------------------------------------------------------------------
// 1. CLASSES — 战士 / 法师 / 道士
// ---------------------------------------------------------------------------

/**
 * `base` is the level-1 stat block; `growth` is added per level above 1 by
 * `Player._applyBaseStats()` (which applies growth×1.5 to the upper bound of
 * every damage range and derives AC/MAC purely from growth).
 *
 * Key order matters: `main.js` renders the character-select buttons from
 * `Object.keys(CLASSES)`.
 */
export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: '战士',
    en: 'Warrior',
    glyph: '战',
    desc: '玛法大陆最坚实的盾。近身缠斗，以厚重的血量与破甲的攻击碾过一切挡路之物；魔法微弱，却从不需要它。',
    highlights: [
      '生命值成长最高，可硬抗数只怪物围攻',
      '攻击力（DC）冠绝三职业，装备越重收益越大',
      '半月弯刀与烈火剑法可一次扫倒成群敌人',
      '魔法值极低，几乎不依赖法术',
    ],
    palette: { skin: 0xd6a882, hair: 0x241a12, cloth: 0x7a2b22, trim: 0xd8b45a, metal: 0x8f939b },
    /** Weapon families this class may wield (drives Armory silhouettes). */
    weapons: ['sword', 'blade', 'greatsword', 'axe'],
    attackClip: 'attack.slash',
    base: { hp: 45, mp: 13, dc: [2, 4], mc: [0, 0], sc: [0, 0], accuracy: 7, agility: 5 },
    growth: { hp: 15.5, mp: 2.2, dc: 0.42, mc: 0.05, sc: 0.05, ac: 0.36, mac: 0.17 },
    startSkills: ['sword_basic'],
    startWeapon: 'wooden_sword',
    startArmor: 'cloth_robe',
    /** id -> qty, granted once at character creation. */
    startItems: { wooden_sword: 1, cloth_robe: 1, gold_wound: 10, herb_potion: 5 },
  },

  mage: {
    id: 'mage',
    name: '法师',
    en: 'Mage',
    glyph: '法',
    desc: '以血肉之躯承载烈焰与雷霆。一发大火球足以清场，可任何一只多角虫贴身都能要了你的命——先手，永远先手。',
    highlights: [
      '魔法攻击（MC）三职业最高，爆发无人能及',
      '冰咆哮、地狱雷光等群体法术可瞬间清怪',
      '魔法值池极深，回蓝依赖太阳水',
      '生命值最低，被近身即险象环生',
    ],
    palette: { skin: 0xe3c2a2, hair: 0x1b1b26, cloth: 0x2b3f86, trim: 0xc9d4f2, metal: 0x6f7c96 },
    weapons: ['staff', 'wand', 'sword'],
    attackClip: 'attack.thrust',
    base: { hp: 26, mp: 32, dc: [1, 2], mc: [3, 6], sc: [0, 1], accuracy: 5, agility: 5 },
    growth: { hp: 6.5, mp: 8.6, dc: 0.12, mc: 0.55, sc: 0.06, ac: 0.12, mac: 0.42 },
    startSkills: ['fireball'],
    startWeapon: 'wooden_sword',
    startArmor: 'cloth_robe',
    startItems: { wooden_sword: 1, cloth_robe: 1, sun_water: 10, herb_potion: 6 },
  },

  taoist: {
    id: 'taoist',
    name: '道士',
    en: 'Taoist',
    glyph: '道',
    desc: '持符驱鬼，遣骷髅为卒。攻不如战士，爆不如法师，却是唯一能自愈、能解毒、能带着一具骷髅走遍玛法的职业。',
    highlights: [
      '治愈术与群体治愈术带来无限续航',
      '施毒术持续掉血，越是厚皮的怪越吃亏',
      '召唤骷髅与召唤神兽，永远不是一个人在战斗',
      '道术（SC）成长稳健，攻守兼备',
    ],
    palette: { skin: 0xdcb891, hair: 0x2a2118, cloth: 0xe8e3d4, trim: 0x3f7a52, metal: 0xb9a068 },
    weapons: ['sword', 'staff', 'talisman'],
    attackClip: 'attack.thrust',
    base: { hp: 34, mp: 24, dc: [1, 3], mc: [1, 3], sc: [2, 5], accuracy: 6, agility: 6 },
    growth: { hp: 9.2, mp: 5.6, dc: 0.22, mc: 0.28, sc: 0.40, ac: 0.20, mac: 0.32 },
    startSkills: ['heal'],
    startWeapon: 'wooden_sword',
    startArmor: 'cloth_robe',
    startItems: { wooden_sword: 1, cloth_robe: 1, gold_wound: 6, sun_water: 6, herb_potion: 4 },
  },
};

// ---------------------------------------------------------------------------
// 2. SKILLS
// ---------------------------------------------------------------------------

/**
 * `effect` must be one of the kinds `game/Combat.js` implements:
 *   'projectile' | 'area' | 'nova' | 'heal' | 'buff' | 'debuff' | 'summon' | 'melee_arc'
 *
 * `school` selects the scaling stat in Combat.castSkill:
 *   'taoist' -> caster.sc, anything else -> caster.mc.
 *   'melee_arc' ignores school entirely and rolls caster.dc.
 *
 * `range` doubles as the walk-in distance in `Player._tryCast`, so caster-
 * centred effects (nova / buff / summon / self heal) use a large range to cast
 * on the spot instead of running at the cursor.
 *
 * Level gates follow the 1.76 client, except that each class's first skill is
 * moved to level 1 so a fresh character is playable (it is also listed in
 * `CLASSES[*].startSkills`).
 */
export const SKILLS = {
  // ---- 战士 ---------------------------------------------------------------
  sword_basic: {
    id: 'sword_basic', name: '基本剑术', class: 'warrior', school: 'warrior',
    level: 1, mp: 0, cooldown: 26, cast: 0.2, range: 40,
    effect: 'buff', buff: 'accuracy', buffPower: 2, duration: 60,
    vfx: 'shield.magic', color: 0xd8b45a, sfx: 'sword.swing',
    icon: 'sword', desc: '凝神握剑，短时间内大幅提升命中，是所有剑法的根基。',
  },
  slash_attack: {
    id: 'slash_attack', name: '攻杀剑术', class: 'warrior', school: 'warrior',
    level: 19, mp: 3, cooldown: 1.6, cast: 0.18, range: 2.0,
    effect: 'melee_arc', power: 1.9, arc: Math.PI * 0.35,
    vfx: 'hit.slash', color: 0xffe6a8, sfx: 'sword.swing',
    icon: 'sword', desc: '一记蓄力重斩，对正面之敌造成远超普通攻击的伤害。',
  },
  thrust_attack: {
    id: 'thrust_attack', name: '刺杀剑术', class: 'warrior', school: 'warrior',
    level: 25, mp: 5, cooldown: 2.0, cast: 0.16, range: 3.4,
    effect: 'melee_arc', power: 1.5, arc: Math.PI * 0.18,
    vfx: 'hit.slash', color: 0xfff2c0, sfx: 'sword.swing',
    icon: 'sword', desc: '前刺一线，可越过身前一格贯穿两名敌人。',
  },
  half_moon: {
    id: 'half_moon', name: '半月弯刀', class: 'warrior', school: 'warrior',
    level: 28, mp: 6, cooldown: 2.6, cast: 0.2, range: 2.4,
    effect: 'melee_arc', power: 1.25, arc: Math.PI * 1.0,
    vfx: 'hit.slash', color: 0xc9e8ff, sfx: 'sword.swing',
    icon: 'blade', desc: '横扫半圆，同时劈中身前所有敌人，清怪的看家本领。',
  },
  shoulder_dash: {
    id: 'shoulder_dash', name: '野蛮冲撞', class: 'warrior', school: 'warrior',
    level: 30, mp: 10, cooldown: 8, cast: 0.14, range: 40,
    effect: 'nova', power: 0.6, radius: 2.6, knockback: 2.6, stun: 1.3,
    vfx: 'dust.land', color: 0xbfae8c, sfx: 'sword.block',
    icon: 'shield', desc: '以肩破阵，撞飞周身敌人并使其短暂僵直，突围与开团皆宜。',
  },
  fire_sword: {
    id: 'fire_sword', name: '烈火剑法', class: 'warrior', school: 'warrior',
    level: 35, mp: 12, cooldown: 5, cast: 0.22, range: 2.2,
    effect: 'melee_arc', power: 2.6, arc: Math.PI * 0.5, element: 'fire',
    vfx: 'fire.explode', color: 0xff6a1e, sfx: 'fire.hit',
    icon: 'sword', desc: '以内力引火附于剑锋，一击焚敌，战士单体输出之最。',
  },
  moon_blade: {
    id: 'moon_blade', name: '抱月刀', class: 'warrior', school: 'warrior',
    level: 40, mp: 14, cooldown: 4.5, cast: 0.24, range: 3.0,
    effect: 'melee_arc', power: 1.7, arc: Math.PI * 2, element: 'physical',
    vfx: 'hit.crit', color: 0xdfe9ff, sfx: 'sword.swing',
    icon: 'blade', desc: '刀走一周天，环身三尺内敌人尽数被斩。',
  },
  sun_blade: {
    id: 'sun_blade', name: '逐日剑法', class: 'warrior', school: 'warrior',
    level: 43, mp: 18, cooldown: 6, cast: 0.28, range: 4.6,
    effect: 'melee_arc', power: 3.2, arc: Math.PI * 0.22,
    vfx: 'hit.crit', color: 0xffc24d, sfx: 'sword.hit',
    icon: 'sword', desc: '剑气如日贯空，隔着数格取敌性命，战士的终极剑技。',
  },

  // ---- 法师 ---------------------------------------------------------------
  fireball: {
    id: 'fireball', name: '火球术', class: 'mage', school: 'mage',
    level: 1, mp: 3, cooldown: 0.3, cast: 0.35, range: 9,
    effect: 'projectile', power: 1.0, speed: 15, element: 'fire',
    vfx: 'fire.ball', color: 0xff7a22, sfx: 'fire.cast',
    icon: 'fire', desc: '掷出一枚灼热火球，法师安身立命的第一术。',
  },
  fire_repel: {
    id: 'fire_repel', name: '抗拒火环', class: 'mage', school: 'mage',
    level: 11, mp: 6, cooldown: 7, cast: 0.3, range: 40,
    effect: 'nova', power: 0.6, radius: 4, knockback: 3.2, stun: 0.6, element: 'fire',
    vfx: 'fire.explode', color: 0xff9944, sfx: 'fire.cast',
    icon: 'fire', desc: '以自身为心炸开火环，将贴身之敌尽数推开。',
  },
  lure_light: {
    id: 'lure_light', name: '诱惑之光', class: 'mage', school: 'mage',
    level: 13, mp: 8, cooldown: 30, cast: 0.9, range: 40,
    effect: 'summon', summon: 'multi_horn', summonLevel: 10,
    vfx: 'summon.rune', color: 0xd8a2ff, sfx: 'summon',
    icon: 'charm', desc: '以幻光乱其心智，使一头野兽认你为主，替你厮杀。',
  },
  great_fireball: {
    id: 'great_fireball', name: '大火球', class: 'mage', school: 'mage',
    level: 18, mp: 8, cooldown: 0.9, cast: 0.45, range: 10,
    effect: 'projectile', power: 1.7, speed: 13, element: 'fire', explode: 1.7,
    vfx: 'fire.ball', color: 0xff5a12, sfx: 'fire.cast',
    icon: 'fire', desc: '凝聚更庞大的火球，落点炸开波及周围敌人。',
  },
  hellfire: {
    id: 'hellfire', name: '地狱火', class: 'mage', school: 'mage',
    level: 22, mp: 10, cooldown: 4, cast: 0.5, range: 6,
    effect: 'area', power: 1.6, radius: 2.4, duration: 1.2, element: 'fire',
    vfx: 'fire.pillar', color: 0xff4400, sfx: 'fire.cast',
    icon: 'fire', desc: '喷出一道地火，将身前一线烧成焦土。',
  },
  lightning: {
    id: 'lightning', name: '雷电术', class: 'mage', school: 'mage',
    level: 26, mp: 12, cooldown: 1.2, cast: 0.5, range: 11,
    effect: 'projectile', power: 2.1, speed: 32, element: 'lightning',
    vfx: 'thunder.bolt', color: 0x8fd4ff, sfx: 'thunder',
    icon: 'thunder', desc: '引天雷加身，快得几乎无法闪避，对石化之物尤为有效。',
  },
  blink: {
    id: 'blink', name: '瞬息移动', class: 'mage', school: 'mage',
    level: 30, mp: 10, cooldown: 12, cast: 0.25, range: 40,
    effect: 'buff', buff: 'haste', buffPower: 2, duration: 8,
    vfx: 'teleport.out', color: 0xa9c8ff, sfx: 'portal',
    icon: 'blink', desc: '身化流光，短时间内步履如飞，脱身之术。',
  },
  fire_wall: {
    id: 'fire_wall', name: '火墙', class: 'mage', school: 'mage',
    level: 31, mp: 14, cooldown: 9, cast: 0.7, range: 8,
    effect: 'area', power: 1.3, radius: 2.3, duration: 12, element: 'fire',
    vfx: 'fire.wall', color: 0xff7733, sfx: 'fire.cast',
    icon: 'fire', desc: '在地面立起一道久燃不熄的火墙，怪物踏之即伤。',
  },
  thunder_flash: {
    id: 'thunder_flash', name: '疾光电影', class: 'mage', school: 'mage',
    level: 33, mp: 16, cooldown: 3.5, cast: 0.55, range: 9,
    effect: 'area', power: 1.9, radius: 3.0, element: 'lightning',
    vfx: 'thunder.impact', color: 0xaee4ff, sfx: 'thunder',
    icon: 'thunder', desc: '电光成片落下，覆盖一小片区域。',
  },
  magic_shield: {
    id: 'magic_shield', name: '魔法盾', class: 'mage', school: 'mage',
    level: 35, mp: 20, cooldown: 20, cast: 0.8, range: 40,
    effect: 'buff', buff: 'shield', buffPower: 3, duration: 70,
    vfx: 'shield.magic', color: 0x6fa8ff, sfx: 'summon',
    icon: 'shield', desc: '以魔力织成护罩，替你挡下大部分伤害，法师的命根子。',
  },
  ice_roar: {
    id: 'ice_roar', name: '冰咆哮', class: 'mage', school: 'mage',
    level: 38, mp: 22, cooldown: 6, cast: 0.9, range: 40,
    effect: 'nova', power: 2.3, radius: 5, stun: 1.0, element: 'ice',
    vfx: 'ice.storm', color: 0x88ddff, sfx: 'ice.cast',
    icon: 'ice', desc: '寒气自足下轰然炸开，冻住并撕裂四周所有敌人。',
  },
  hell_thunder: {
    id: 'hell_thunder', name: '地狱雷光', class: 'mage', school: 'mage',
    level: 40, mp: 26, cooldown: 7, cast: 1.0, range: 40,
    effect: 'nova', power: 2.7, radius: 6, knockback: 2.0, element: 'lightning',
    vfx: 'thunder.impact', color: 0xc8ecff, sfx: 'thunder',
    icon: 'thunder', desc: '万雷加身，以自身为中心荡平一片战场。',
  },
  blast_flame: {
    id: 'blast_flame', name: '爆裂火焰', class: 'mage', school: 'mage',
    level: 43, mp: 30, cooldown: 8, cast: 1.1, range: 9,
    effect: 'area', power: 3.1, radius: 4, element: 'fire',
    vfx: 'fire.explode', color: 0xff3d00, sfx: 'fire.hit',
    icon: 'fire', desc: '指定之地骤然爆燃，火色由红转白。',
  },
  meteor_rain: {
    id: 'meteor_rain', name: '流星火雨', class: 'mage', school: 'mage',
    level: 50, mp: 45, cooldown: 18, cast: 1.4, range: 12,
    effect: 'area', power: 3.8, radius: 6.5, duration: 2.5, element: 'fire',
    vfx: 'fire.pillar', color: 0xff8a2b, sfx: 'fire.hit',
    icon: 'fire', desc: '天倾火雨，长久砸落于一大片土地，法师的终极毁灭。',
  },

  // ---- 道士 ---------------------------------------------------------------
  heal: {
    id: 'heal', name: '治愈术', class: 'taoist', school: 'taoist',
    level: 1, mp: 4, cooldown: 1.0, cast: 0.55, range: 20,
    effect: 'heal', power: 1.0,
    vfx: 'heal.aura', color: 0x8fffb0, sfx: 'heal',
    icon: 'heal', desc: '以道术引气归元，为自己或同伴回复生命。',
  },
  spirit_boost: {
    id: 'spirit_boost', name: '精神力战法', class: 'taoist', school: 'taoist',
    level: 9, mp: 0, cooldown: 30, cast: 0.4, range: 40,
    effect: 'buff', buff: 'spirit', buffPower: 2, duration: 120,
    vfx: 'shield.magic', color: 0xbfe9c8, sfx: 'summon',
    icon: 'spirit', desc: '收摄心神，提升灵魂火符的威力与出手准头。',
  },
  poison: {
    id: 'poison', name: '施毒术', class: 'taoist', school: 'taoist',
    level: 11, mp: 6, cooldown: 2.0, cast: 0.4, range: 7,
    effect: 'debuff', buff: 'poison', duration: 14, radius: 2, element: 'poison',
    vfx: 'poison.cloud', color: 0x7fd23a, sfx: 'poison',
    icon: 'poison', desc: '撒出绿毒，持续腐蚀敌人气血，血越厚越吃亏。',
  },
  soul_fire: {
    id: 'soul_fire', name: '灵魂火符', class: 'taoist', school: 'taoist',
    level: 13, mp: 8, cooldown: 0.8, cast: 0.4, range: 9,
    effect: 'projectile', power: 1.25, speed: 16, element: 'magic',
    vfx: 'soul.fireball', color: 0xffe9a0, sfx: 'fire.cast',
    icon: 'talisman', desc: '掷出燃烧的符箓，道士唯一的远程攻击手段。',
  },
  summon_skeleton: {
    id: 'summon_skeleton', name: '召唤骷髅', class: 'taoist', school: 'taoist',
    level: 19, mp: 16, cooldown: 30, cast: 1.2, range: 40,
    effect: 'summon', summon: 'bone_familiar', summonLevel: 12,
    vfx: 'summon.rune', color: 0xcfd8e6, sfx: 'summon',
    icon: 'summon', desc: '以符引骨，唤出一具骷髅精灵替你冲锋陷阵。',
  },
  invisibility: {
    id: 'invisibility', name: '隐身术', class: 'taoist', school: 'taoist',
    level: 21, mp: 10, cooldown: 16, cast: 0.6, range: 40,
    effect: 'buff', buff: 'invisible', buffPower: 1, duration: 30,
    vfx: 'invisible.puff', color: 0xa8c4d8, sfx: 'summon',
    icon: 'invisible', desc: '隐去形迹，寻常怪物再看不见你。',
  },
  group_invisibility: {
    id: 'group_invisibility', name: '集体隐身术', class: 'taoist', school: 'taoist',
    level: 24, mp: 18, cooldown: 22, cast: 0.9, range: 40,
    effect: 'buff', buff: 'invisible', buffPower: 1, duration: 25, radius: 4,
    vfx: 'invisible.puff', color: 0xbcd6e8, sfx: 'summon',
    icon: 'invisible', desc: '一符罩住身边众人，同队一并隐去身形。',
  },
  ghost_shield: {
    id: 'ghost_shield', name: '幽灵盾', class: 'taoist', school: 'taoist',
    level: 26, mp: 14, cooldown: 20, cast: 0.7, range: 40,
    effect: 'buff', buff: 'ghost_shield', buffPower: 3, duration: 90,
    vfx: 'shield.magic', color: 0x9fd0c8, sfx: 'summon',
    icon: 'shield', desc: '召来幽灵之气环身，显著提升物理防御。',
  },
  holy_armor: {
    id: 'holy_armor', name: '神圣战甲术', class: 'taoist', school: 'taoist',
    level: 29, mp: 16, cooldown: 20, cast: 0.7, range: 40,
    effect: 'buff', buff: 'holy_armor', buffPower: 3, duration: 90,
    vfx: 'shield.magic', color: 0xffe7a8, sfx: 'summon',
    icon: 'shield', desc: '以神圣之力铸甲，大幅提升魔法防御。',
  },
  group_heal: {
    id: 'group_heal', name: '群体治愈术', class: 'taoist', school: 'taoist',
    level: 31, mp: 24, cooldown: 6, cast: 1.0, range: 20,
    effect: 'heal', power: 2.1, radius: 5,
    vfx: 'heal.aura', color: 0xa8ffc4, sfx: 'heal',
    icon: 'heal', desc: '一术泽被周身，为身边所有同伴回复生命。',
  },
  summon_shinsu: {
    id: 'summon_shinsu', name: '召唤神兽', class: 'taoist', school: 'taoist',
    level: 35, mp: 32, cooldown: 60, cast: 1.6, range: 40,
    effect: 'summon', summon: 'guard_ghost', summonLevel: 30,
    vfx: 'summon.burst', color: 0x9fe0ff, sfx: 'summon',
    icon: 'summon', desc: '唤出神兽相随，道士后期真正的战力所在。',
  },
  taoist_zen: {
    id: 'taoist_zen', name: '无极真气', class: 'taoist', school: 'taoist',
    level: 42, mp: 0, cooldown: 40, cast: 0.5, range: 40,
    effect: 'buff', buff: 'zen', buffPower: 4, duration: 180,
    vfx: 'shield.magic', color: 0xdff0ff, sfx: 'summon',
    icon: 'spirit', desc: '真气无极，长时间提升自身全部攻击属性。',
  },
};

// ---------------------------------------------------------------------------
// 3. ITEMS
// ---------------------------------------------------------------------------

/**
 * `stats` values, as consumed by `Inventory.makeItem`:
 *   number                          -> copied verbatim (healHp, accuracy, ...)
 *   [lo, hi]                        -> fixed range
 *   [[loMin,loMax],[hiMin,hiMax]]   -> rolled per drop, the Mir2 variance
 *
 * Stat keys folded into the player's block by `Player._equipmentBonuses`:
 *   ranges: dc mc sc ac mac      numbers: hp mp accuracy agility attackSpeed
 * Anything else (healHp, healMp, teaches, luck) is read by its own system.
 */
export const ITEMS = {
  // ---- currency ----------------------------------------------------------
  gold: {
    name: '金币', type: 'gold', slot: null, icon: 'gold',
    stackable: true, weight: 0, price: 1, reqLevel: 0,
    desc: '玛法通行的货币，沉甸甸的成色。',
  },

  // ---- weapons -----------------------------------------------------------
  wooden_sword: {
    name: '木剑', type: 'weapon', slot: 'weapon', icon: 'sword',
    stats: { dc: [[1, 2], [3, 4]] },
    price: 150, weight: 8, reqLevel: 1, durability: 1200, reach: 0.0,
    desc: '新手village里削出来的木头剑，好歹是把剑。',
  },
  short_sword: {
    name: '短剑', type: 'weapon', slot: 'weapon', icon: 'sword',
    stats: { dc: [[2, 3], [4, 6]], accuracy: 1 },
    price: 600, weight: 7, reqLevel: 5, durability: 1500, reach: 0.0,
    desc: '轻巧的短刃，出手极快，适合尚未练成臂力的新人。',
  },
  bronze_sword: {
    name: '铜剑', type: 'weapon', slot: 'weapon', icon: 'sword',
    stats: { dc: [[3, 4], [6, 8]] },
    price: 1500, weight: 10, reqLevel: 9, durability: 2000, reach: 0.1,
    desc: '青铜浇铸，剑身泛着暗绿的锈色。',
  },
  iron_sword: {
    name: '铁剑', type: 'weapon', slot: 'weapon', icon: 'sword',
    stats: { dc: [[4, 6], [8, 10]] },
    price: 3600, weight: 12, reqLevel: 13, durability: 2600, reach: 0.1,
    desc: '比奇铁匠铺的量产货，结实耐用。',
  },
  ebony_sword: {
    name: '乌木剑', type: 'weapon', slot: 'weapon', icon: 'sword',
    stats: { dc: [[5, 7], [10, 13]] },
    price: 7000, weight: 13, reqLevel: 16, durability: 3000, reach: 0.15,
    desc: '乌木为柄，剑身漆黑不反光，夜战之利器。',
  },
  blue_blade: {
    name: '三尺青锋', type: 'weapon', slot: 'weapon', icon: 'sword',
    stats: { dc: [[6, 8], [12, 15]], accuracy: 1 },
    price: 13000, weight: 14, reqLevel: 19, durability: 3400, reach: 0.2,
    desc: '三尺青锋出鞘，寒光照亮半座地窖。',
  },
  crescent_blade: {
    name: '偃月', type: 'weapon', slot: 'weapon', icon: 'blade', class: 'warrior',
    stats: { dc: [[7, 10], [14, 18]] },
    price: 24000, weight: 22, reqLevel: 22, durability: 4000, reach: 0.35,
    desc: '刀身如残月，沉重但一击可开山。',
  },
  dragon_sword: {
    name: '龙纹剑', type: 'weapon', slot: 'weapon', icon: 'sword', class: 'warrior',
    stats: { dc: [[8, 11], [16, 20]], accuracy: 1 },
    price: 42000, weight: 18, reqLevel: 25, durability: 4200, reach: 0.25,
    desc: '剑脊刻有蟠龙纹路，据说为古时王侯佩剑。',
  },
  blood_drinker: {
    name: '血饮', type: 'weapon', slot: 'weapon', icon: 'blade', class: 'warrior',
    stats: { dc: [[9, 13], [18, 23]], accuracy: 2 },
    price: 68000, weight: 20, reqLevel: 28, durability: 4600, reach: 0.3,
    desc: '刃口的暗红洗不掉，握久了手心发烫。',
  },
  asura: {
    name: '修罗', type: 'weapon', slot: 'weapon', icon: 'blade', class: 'warrior',
    stats: { dc: [[10, 14], [20, 26]], accuracy: 2, agility: 1 },
    price: 110000, weight: 24, reqLevel: 31, durability: 5000, reach: 0.35,
    desc: '修罗嗜血，持之者难消杀念。',
  },
  bone_jade_staff: {
    name: '骨玉权杖', type: 'weapon', slot: 'weapon', icon: 'staff', class: 'mage',
    stats: { dc: [[2, 3], [4, 6]], mc: [[5, 8], [11, 15]], mp: 20 },
    price: 85000, weight: 12, reqLevel: 28, durability: 3200, reach: 0.15,
    desc: '白骨与青玉合铸，杖首镶着一颗常年温热的珠子。',
  },
  dragon_tooth: {
    name: '龙牙', type: 'weapon', slot: 'weapon', icon: 'staff', class: 'taoist',
    stats: { dc: [[3, 4], [6, 8]], sc: [[5, 8], [11, 14]], mp: 15 },
    price: 95000, weight: 14, reqLevel: 30, durability: 3400, reach: 0.2,
    desc: '取真龙一齿磨成，道术加持之下嗡嗡作响。',
  },
  soul_devour_staff: {
    name: '嗜魂法杖', type: 'weapon', slot: 'weapon', icon: 'staff', class: 'mage',
    stats: { dc: [[3, 5], [6, 9]], mc: [[8, 12], [16, 21]], mp: 35 },
    price: 260000, weight: 15, reqLevel: 35, durability: 3800, reach: 0.2,
    desc: '杖中封着不知多少亡魂，施法时能听见低语。',
  },
  judgement_staff: {
    name: '裁决之杖', type: 'weapon', slot: 'weapon', icon: 'greatsword', class: 'warrior',
    stats: { dc: [[13, 17], [24, 31]], accuracy: 2 },
    price: 420000, weight: 30, reqLevel: 36, durability: 5600, reach: 0.4,
    desc: '与其说是杖，不如说是一根能砸碎城门的铁柱。',
  },
  dragon_slayer: {
    name: '屠龙', type: 'weapon', slot: 'weapon', icon: 'greatsword', class: 'warrior',
    stats: { dc: [[18, 24], [32, 42]], accuracy: 3, agility: 1 },
    price: 1200000, weight: 38, reqLevel: 42, durability: 6500, reach: 0.45,
    desc: '玛法大陆的传说本身。见过它出鞘的人，多半没能把话说完。',
  },

  // ---- armour ------------------------------------------------------------
  cloth_robe: {
    name: '布衣', type: 'armor', slot: 'armor', icon: 'robe',
    stats: { ac: [[0, 1], [1, 2]] },
    price: 100, weight: 6, reqLevel: 1, durability: 900,
    desc: '粗麻缝制，挡风尚可，挡刀就算了。',
  },
  light_armor: {
    name: '轻型盔甲', type: 'armor', slot: 'armor', icon: 'armor',
    stats: { ac: [[1, 2], [3, 4]], hp: 5 },
    price: 1200, weight: 12, reqLevel: 7, durability: 1600,
    desc: '皮革缀铁片，行动不受拘束。',
  },
  medium_armor: {
    name: '中型盔甲', type: 'armor', slot: 'armor', icon: 'armor',
    stats: { ac: [[2, 3], [5, 7]], hp: 12 },
    price: 4500, weight: 18, reqLevel: 14, durability: 2200,
    desc: '锁子甲外罩胸板，比奇卫兵的制式装备。',
  },
  heavy_armor: {
    name: '重型盔甲', type: 'armor', slot: 'armor', icon: 'armor', class: 'warrior',
    stats: { ac: [[3, 5], [7, 9]], hp: 22, agility: -1 },
    price: 12000, weight: 26, reqLevel: 20, durability: 2800,
    desc: '全身板甲，穿上就别想跑快了。',
  },
  ghost_armor: {
    name: '幽灵战衣', type: 'armor', slot: 'armor', icon: 'armor',
    stats: { ac: [[4, 6], [9, 12]], mac: [[1, 2], [3, 4]], hp: 18 },
    price: 30000, weight: 20, reqLevel: 24, durability: 3200,
    desc: '甲面浮着一层灰白雾气，据说出自石墓深处。',
  },
  taoist_robe: {
    name: '天尊道袍', type: 'armor', slot: 'armor', icon: 'robe', class: 'taoist',
    stats: { ac: [[3, 5], [7, 10]], mac: [[3, 5], [7, 9]], sc: [[1, 2], [2, 4]], mp: 25 },
    price: 90000, weight: 16, reqLevel: 30, durability: 3000,
    desc: '道门至尊之袍，袍角绣满看不懂的星图。',
  },
  mage_cloak: {
    name: '法神披风', type: 'armor', slot: 'armor', icon: 'robe', class: 'mage',
    stats: { ac: [[2, 4], [6, 8]], mac: [[4, 6], [9, 12]], mc: [[1, 2], [3, 4]], mp: 40 },
    price: 110000, weight: 14, reqLevel: 32, durability: 2900,
    desc: '披上它，指尖的火便再没熄过。',
  },
  holy_plate: {
    name: '圣战宝甲', type: 'armor', slot: 'armor', icon: 'armor', class: 'warrior',
    stats: { ac: [[7, 10], [14, 18]], mac: [[1, 2], [2, 4]], hp: 45 },
    price: 180000, weight: 30, reqLevel: 34, durability: 4200,
    desc: '圣战三件套之首，金纹在日光下几乎刺眼。',
  },
  demon_armor: {
    name: '天魔神甲', type: 'armor', slot: 'armor', icon: 'armor',
    stats: { ac: [[10, 14], [19, 25]], mac: [[5, 8], [11, 15]], hp: 65 },
    price: 900000, weight: 34, reqLevel: 42, durability: 5200,
    desc: '赤月深处出土的魔甲，穿着它连怪物都会犹豫一下。',
  },

  // ---- helmets -----------------------------------------------------------
  helm: {
    name: '头盔', type: 'helmet', slot: 'helmet', icon: 'helm',
    stats: { ac: [[0, 1], [1, 2]] },
    price: 500, weight: 5, reqLevel: 5, durability: 1200,
    desc: '一顶普通的铁皮盔，聊胜于无。',
  },
  taoist_helm: {
    name: '道士头盔', type: 'helmet', slot: 'helmet', icon: 'helm', class: 'taoist',
    stats: { mac: [[1, 2], [2, 3]], sc: [[0, 1], [1, 2]] },
    price: 2000, weight: 4, reqLevel: 10, durability: 1300,
    desc: '道门弟子的束发之冠，正中嵌一枚墨玉。',
  },
  iron_helm: {
    name: '铁头盔', type: 'helmet', slot: 'helmet', icon: 'helm',
    stats: { ac: [[1, 2], [3, 4]] },
    price: 3000, weight: 7, reqLevel: 12, durability: 1800,
    desc: '厚实的整块铁盔，闷是闷了点。',
  },
  memory_helm: {
    name: '记忆头盔', type: 'helmet', slot: 'helmet', icon: 'helm',
    stats: { ac: [[1, 2], [3, 4]], mac: [[1, 2], [2, 3]], accuracy: 1 },
    price: 26000, weight: 6, reqLevel: 22, durability: 2400,
    desc: '据说戴上后能记起前世的招式，多半是酒馆里的胡话。',
  },
  holy_helm: {
    name: '圣战头盔', type: 'helmet', slot: 'helmet', icon: 'helm', class: 'warrior',
    stats: { ac: [[3, 5], [6, 8]], dc: [[0, 1], [1, 3]] },
    price: 150000, weight: 9, reqLevel: 34, durability: 3200,
    desc: '圣战套装之一，盔缨如火。',
  },
  taoist_crown: {
    name: '天尊头盔', type: 'helmet', slot: 'helmet', icon: 'crown', class: 'taoist',
    stats: { mac: [[3, 4], [5, 7]], sc: [[1, 2], [2, 4]] },
    price: 150000, weight: 5, reqLevel: 34, durability: 3000,
    desc: '天尊套装之一，冠上三星长明。',
  },
  mage_crown: {
    name: '法神头盔', type: 'helmet', slot: 'helmet', icon: 'crown', class: 'mage',
    stats: { mac: [[3, 4], [5, 7]], mc: [[1, 2], [2, 4]] },
    price: 150000, weight: 5, reqLevel: 34, durability: 3000,
    desc: '法神套装之一，戴上便觉思路清明。',
  },

  // ---- jewellery ---------------------------------------------------------
  necklace: {
    name: '项链', type: 'necklace', slot: 'necklace', icon: 'necklace',
    stats: { accuracy: 1 },
    price: 800, weight: 2, reqLevel: 5, durability: 800,
    desc: '一串打磨过的石珠，戴着顺手。',
  },
  amulet: {
    name: '护身符', type: 'necklace', slot: 'necklace', icon: 'necklace',
    stats: { mac: [[0, 1], [1, 2]], sc: [[0, 1], [1, 2]] },
    price: 2500, weight: 2, reqLevel: 8, durability: 900,
    desc: '道观里求来的黄符，折成三角挂在颈间。',
  },
  green_necklace: {
    name: '绿色项链', type: 'necklace', slot: 'necklace', icon: 'necklace',
    stats: { mc: [[1, 2], [2, 4]], accuracy: 1 },
    price: 30000, weight: 2, reqLevel: 18, durability: 1200,
    desc: '通体幽绿，凑近能听见极轻的嗡鸣。',
  },
  moral_words: {
    name: '道德真言', type: 'necklace', slot: 'necklace', icon: 'necklace', class: 'taoist',
    stats: { sc: [[1, 3], [3, 5]], mp: 15 },
    price: 45000, weight: 2, reqLevel: 22, durability: 1400,
    desc: '刻着五千言的玉牌，道士视若性命。',
  },
  dragon_heart: {
    name: '龙之心', type: 'necklace', slot: 'necklace', icon: 'necklace',
    stats: { dc: [[1, 2], [2, 4]], mc: [[1, 2], [2, 4]], sc: [[1, 2], [2, 4]], hp: 20 },
    price: 120000, weight: 3, reqLevel: 26, durability: 1600,
    desc: '仍在缓慢搏动的赤色晶核，三职业通吃。',
  },
  three_eye_bracelet: {
    name: '三眼手镯', type: 'bracelet', slot: 'braceletL', icon: 'bracelet',
    stats: { accuracy: 2, agility: 1 },
    price: 18000, weight: 3, reqLevel: 16, durability: 1200,
    desc: '镯上三只兽眼，据说能替你盯住看不见的东西。',
  },
  knight_bracelet: {
    name: '骑士手镯', type: 'bracelet', slot: 'braceletL', icon: 'bracelet',
    stats: { ac: [[1, 3], [3, 5]] },
    price: 55000, weight: 4, reqLevel: 24, durability: 1500,
    desc: '厚重的护腕，正面錾着骑士徽记。',
  },
  mind_bracelet: {
    name: '心灵手镯', type: 'bracelet', slot: 'braceletL', icon: 'bracelet',
    stats: { mac: [[1, 3], [3, 5]], mc: [[0, 1], [1, 2]] },
    price: 55000, weight: 3, reqLevel: 24, durability: 1500,
    desc: '贴腕处微凉，能压住体内乱窜的魔力。',
  },
  titan_ring: {
    name: '泰坦戒指', type: 'ring', slot: 'ringL', icon: 'ring',
    stats: { dc: [[2, 3], [4, 6]] },
    price: 130000, weight: 1, reqLevel: 28, durability: 1400,
    desc: '巨人指骨上取下的铁环，戴上便觉臂力大增。',
  },
  teleport_ring: {
    name: '传送戒指', type: 'ring', slot: 'ringL', icon: 'ring',
    stats: { agility: 2 },
    price: 40000, weight: 1, reqLevel: 20, durability: 1000,
    desc: '刻满传送符文，危急时总能让你快上半步。',
  },

  // ---- consumables -------------------------------------------------------
  herb_potion: {
    name: '疗伤药', type: 'potion', slot: null, icon: 'potion.white',
    stats: { healHp: 15 }, stackable: true,
    price: 20, weight: 1, reqLevel: 0,
    desc: '草药捣成的糊，苦得要命，回一点血。',
  },
  gold_wound: {
    name: '金创药', type: 'potion', slot: null, icon: 'potion.red',
    stats: { healHp: 40 }, stackable: true,
    price: 60, weight: 1, reqLevel: 0,
    desc: '比奇药店的招牌，止血极快。',
  },
  sun_water: {
    name: '太阳水', type: 'potion', slot: null, icon: 'potion.blue',
    stats: { healMp: 40 }, stackable: true,
    price: 70, weight: 1, reqLevel: 0,
    desc: '澄澈的蓝色药水，入喉一线清凉，回复魔法。',
  },
  gold_wound_strong: {
    name: '强效金创药', type: 'potion', slot: null, icon: 'potion.red',
    stats: { healHp: 100 }, stackable: true,
    price: 220, weight: 2, reqLevel: 10,
    desc: '加倍熬制的金创药，一瓶顶三瓶。',
  },
  sun_water_strong: {
    name: '强效太阳水', type: 'potion', slot: null, icon: 'potion.blue',
    stats: { healMp: 100 }, stackable: true,
    price: 250, weight: 2, reqLevel: 10,
    desc: '法师的命脉，盟重药商总是缺货。',
  },
  eternal_frost: {
    name: '万年雪霜', type: 'potion', slot: null, icon: 'potion.white',
    stats: { healHp: 250, healMp: 250 }, stackable: true,
    price: 1200, weight: 3, reqLevel: 25,
    desc: '雪山之巅千年不化的霜，气血魔法同补。',
  },
};

// ---- generated skill books (技能书) ---------------------------------------
// One book per skill, so trainers can sell them and bosses can drop them.
for (const s of Object.values(SKILLS)) {
  ITEMS[`book_${s.id}`] = {
    name: `${s.name}（技能书）`,
    type: 'book', slot: null, icon: 'book',
    stats: { teaches: s.id },
    class: s.class,
    price: Math.round(600 + Math.pow(s.level, 1.9) * 22),
    weight: 2,
    reqLevel: s.level,
    desc: `记载着【${s.name}】的秘籍。${s.desc}`,
  };
}

/** Convenience lookups (extra to the contract, safe for anyone to ignore). */
export function getItem(id) { return ITEMS[id] || null; }
export function getSkill(id) { return SKILLS[id] || null; }
export function skillsForClass(klass) {
  return Object.values(SKILLS).filter((s) => s.class === klass).sort((a, b) => a.level - b.level);
}

// ---------------------------------------------------------------------------
// 4. NPCS
// ---------------------------------------------------------------------------

const _SHOP_WEAPONS = [
  'wooden_sword', 'short_sword', 'bronze_sword', 'iron_sword', 'ebony_sword', 'blue_blade',
];
const _SHOP_WEAPONS_DESERT = [
  'iron_sword', 'ebony_sword', 'blue_blade', 'crescent_blade', 'dragon_sword',
];
const _SHOP_POTIONS = ['herb_potion', 'gold_wound', 'sun_water'];
const _SHOP_POTIONS_STRONG = ['gold_wound', 'sun_water', 'gold_wound_strong', 'sun_water_strong'];
const _SHOP_ARMOR = ['cloth_robe', 'light_armor', 'medium_armor', 'helm', 'iron_helm'];
const _SHOP_ARMOR_DESERT = ['medium_armor', 'heavy_armor', 'ghost_armor', 'iron_helm', 'memory_helm'];
const _SHOP_GENERAL = ['herb_potion', 'necklace', 'amulet', 'helm', 'three_eye_bracelet'];

/**
 * `rig` is spread into `buildHumanoid({ archetype:'npc', ...rig })`, so it may
 * carry build / height / palette / armor / helmet / weapon / scale.
 */
export const NPCS = {
  // ---- 比奇省 -------------------------------------------------------------
  blacksmith: {
    id: 'blacksmith', name: '王铁匠', title: '武器店老板', role: 'weapon', town: 'bichon',
    shop: _SHOP_WEAPONS,
    dialog: [
      '要打铁还是买剑？炉子刚旺，别耽误我工夫。',
      '木剑砍鸡够用了，真想进石墓，至少得换把铁剑。',
      '刀口卷了就拿来，修一次收你几个铜板。',
    ],
    rig: { build: 'm', height: 1.78, scale: 1.02, weapon: 'iron_sword',
      palette: { skin: 0xc79067, hair: 0x1d1710, cloth: 0x4a3526, trim: 0x8a6a3a, metal: 0x8f939b } },
  },
  apothecary: {
    id: 'apothecary', name: '陈药师', title: '药店老板', role: 'potion', town: 'bichon',
    shop: _SHOP_POTIONS,
    dialog: [
      '金创药、太阳水，出门在外，宁可多带三瓶。',
      '省着点用——死一次掉的经验，可比药钱贵多了。',
      '这药苦，苦才有用。',
    ],
    rig: { build: 'f', height: 1.66, scale: 0.98,
      palette: { skin: 0xe6c7a8, hair: 0x241b14, cloth: 0x3d6b4f, trim: 0xd8c98a, metal: 0xb9a068 } },
  },
  grocer: {
    id: 'grocer', name: '李掌柜', title: '杂货店老板', role: 'general', town: 'bichon',
    shop: _SHOP_GENERAL,
    dialog: [
      '杂货铺，什么都有一点，什么都不多。',
      '项链？有，成色一般，胜在便宜。',
      '收货也收，你背包里那些破铜烂铁，我按四成价收。',
    ],
    rig: { build: 'm', height: 1.7, scale: 0.99,
      palette: { skin: 0xd9ab84, hair: 0x2b2118, cloth: 0x6b5230, trim: 0xc9a55f, metal: 0x9a8f7a } },
  },
  tailor: {
    id: 'tailor', name: '花娘', title: '裁缝店老板', role: 'armor', town: 'bichon',
    shop: _SHOP_ARMOR,
    dialog: [
      '布衣只能挡风，进了地窖还是得穿盔甲。',
      '姑娘家的手艺，针脚密着呢，穿三个月不裂。',
      '要合身就站好别动，我给你量一量。',
    ],
    rig: { build: 'f', height: 1.64, scale: 0.97,
      palette: { skin: 0xecd0b4, hair: 0x1a1410, cloth: 0x8e3a52, trim: 0xe8cf8a, metal: 0xb08a4a } },
  },
  storekeeper: {
    id: 'storekeeper', name: '张管事', title: '仓库管理员', role: 'storage', town: 'bichon',
    shop: [],
    dialog: [
      '东西存我这儿，丢一件我赔十件。',
      '背不动就别硬撑，仓库有的是地方。',
      '存取各收五十金，童叟无欺。',
    ],
    rig: { build: 'm', height: 1.72, scale: 1.0,
      palette: { skin: 0xd2a37c, hair: 0x3a3128, cloth: 0x33405c, trim: 0xb0b6c4, metal: 0x8f939b } },
  },
  teleporter: {
    id: 'teleporter', name: '玄机子', title: '传送员', role: 'teleport', town: 'bichon',
    shop: ['teleport_ring'],
    dialog: [
      '想去哪儿？盟重、沃玛、石墓，只要你付得起路费。',
      '传送阵一开一合，切莫回头看。',
      '赤月峡谷？劝你先掂量掂量自己的斤两。',
    ],
    rig: { build: 'm', height: 1.74, scale: 1.0,
      palette: { skin: 0xdcc0a0, hair: 0xcfc8bd, cloth: 0x2f3a63, trim: 0x9fb6e6, metal: 0x7d88a0 } },
  },
  master_warrior: {
    id: 'master_warrior', name: '洪教头', title: '战士师父', role: 'trainer', town: 'bichon',
    teaches: 'warrior',
    shop: ['book_sword_basic', 'book_slash_attack', 'book_thrust_attack', 'book_half_moon'],
    dialog: [
      '剑要握实，腰要沉住。站都站不稳，谈什么攻杀剑术。',
      '半月弯刀一出，身前皆敌皆倒——但先把基本剑术练到家。',
      '战士不靠花招，靠的是一刀比一刀重。',
    ],
    rig: { build: 'm', height: 1.84, scale: 1.06, weapon: 'crescent_blade', armor: 'medium_armor',
      palette: { skin: 0xc98f63, hair: 0x191310, cloth: 0x6f2a22, trim: 0xd8b45a, metal: 0x9aa0a8 } },
  },
  master_mage: {
    id: 'master_mage', name: '玄冥先生', title: '法师师父', role: 'trainer', town: 'bichon',
    teaches: 'mage',
    shop: ['book_fireball', 'book_fire_repel', 'book_great_fireball', 'book_lightning'],
    dialog: [
      '火球术是根基，别嫌它小——练到极致，一样烧穿祖玛的石头。',
      '法师最忌贪。放完就走，站在原地念咒的人都埋在沃玛了。',
      '魔法盾学不会之前，别去赤月，那不是勇气，是送死。',
    ],
    rig: { build: 'm', height: 1.74, scale: 1.0, weapon: 'bone_jade_staff',
      palette: { skin: 0xe6cbae, hair: 0xd6d0c6, cloth: 0x28356e, trim: 0xbfd0f4, metal: 0x6f7c96 } },
  },
  master_taoist: {
    id: 'master_taoist', name: '清虚道长', title: '道士师父', role: 'trainer', town: 'bichon',
    teaches: 'taoist',
    shop: ['book_heal', 'book_poison', 'book_soul_fire', 'book_summon_skeleton'],
    dialog: [
      '道法自然。治愈术不是让你不死，是让你有第二次机会。',
      '施毒术阴损了些，可救人的手，也得先能杀人。',
      '骷髅不是仆从，是同伴。它替你挡刀的时候，记着它。',
    ],
    rig: { build: 'm', height: 1.76, scale: 1.0, weapon: 'dragon_tooth', armor: 'taoist_robe',
      palette: { skin: 0xddbc95, hair: 0xe8e4dc, cloth: 0xefe9da, trim: 0x3f7a52, metal: 0xb9a068 } },
  },

  // ---- 盟重土城 -----------------------------------------------------------
  blacksmith_mongchon: {
    id: 'blacksmith_mongchon', name: '阿木', title: '盟重武器店老板', role: 'weapon', town: 'mongchon',
    shop: _SHOP_WEAPONS_DESERT,
    dialog: [
      '沙子进炉子，火候难拿，所以我的刀比比奇贵三成。',
      '偃月沉，龙纹剑利，你选一样。',
      '别在城里拔刀，城守的规矩，我可保不住你。',
    ],
    rig: { build: 'm', height: 1.8, scale: 1.03, weapon: 'crescent_blade',
      palette: { skin: 0xb87f52, hair: 0x120e0a, cloth: 0x5c4527, trim: 0xa8823f, metal: 0x8f939b } },
  },
  apothecary_mongchon: {
    id: 'apothecary_mongchon', name: '阿依娜', title: '盟重药店老板', role: 'potion', town: 'mongchon',
    shop: _SHOP_POTIONS_STRONG,
    dialog: [
      '强效金创药，只此一家，走出这道门就买不到了。',
      '沙漠里脱水比中刀死得快，多带两瓶水。',
      '万年雪霜？那要看你的钱袋，也要看我的存货。',
    ],
    rig: { build: 'f', height: 1.63, scale: 0.97,
      palette: { skin: 0xd6a97e, hair: 0x1e1712, cloth: 0x7a4a86, trim: 0xe0c176, metal: 0xb9a068 } },
  },
  tailor_mongchon: {
    id: 'tailor_mongchon', name: '素娘', title: '盟重裁缝店老板', role: 'armor', town: 'mongchon',
    shop: _SHOP_ARMOR_DESERT,
    dialog: [
      '幽灵战衣刚到两件，识货的自己看。',
      '重甲扛得住沃玛，可挡不住祖玛的箭，你自己掂量。',
      '这一针一线，都是拿命换回来的料子。',
    ],
    rig: { build: 'f', height: 1.65, scale: 0.98,
      palette: { skin: 0xe0b28c, hair: 0x241a14, cloth: 0x8a6a3a, trim: 0xe6d29a, metal: 0xa08a5a } },
  },
  storekeeper_mongchon: {
    id: 'storekeeper_mongchon', name: '古大海', title: '盟重仓库管理员', role: 'storage', town: 'mongchon',
    shop: [],
    dialog: [
      '土城的仓库最保险，沙子埋不着，贼也进不来。',
      '要存什么，报个数。',
      '别问我别人存了什么，规矩就是规矩。',
    ],
    rig: { build: 'm', height: 1.75, scale: 1.02,
      palette: { skin: 0xc99a70, hair: 0x2e2620, cloth: 0x3f4a3a, trim: 0xa9b08c, metal: 0x8f939b } },
  },
  sabak_guard: {
    id: 'sabak_guard', name: '石守将', title: '沙巴克城守', role: 'guard', town: 'mongchon',
    shop: [],
    dialog: [
      '沙巴克的城门，不是给闲人推的。',
      '想攻城？先把行会拉起来，再来跟我说话。',
      '城在人在。这句话，我说了十七年。',
    ],
    rig: { build: 'm', height: 1.88, scale: 1.1, weapon: 'judgement_staff', armor: 'holy_plate', helmet: 'holy_helm',
      palette: { skin: 0xbf8a5e, hair: 0x141010, cloth: 0x5c1f1f, trim: 0xe0c064, metal: 0xb8bcc4 } },
  },
  teleporter_mongchon: {
    id: 'teleporter_mongchon', name: '沙婆婆', title: '盟重传送员', role: 'teleport', town: 'mongchon',
    shop: ['teleport_ring'],
    dialog: [
      '祖玛寺庙、赤月峡谷，价钱不一样，命也不一样。',
      '老身送过太多人出去，回来的不到一半。',
      '路费先付，规矩如此。',
    ],
    rig: { build: 'f', height: 1.56, scale: 0.94,
      palette: { skin: 0xcaa483, hair: 0xd8d2c8, cloth: 0x4a3a5e, trim: 0xb49ad0, metal: 0x7d88a0 } },
  },
};

// Defensive aliases: MapDefs is authored by another hand, so accept the
// obvious alternative ids for the same townsfolk rather than throwing in
// `new Npc()`.
const _NPC_ALIASES = {
  weaponsmith: 'blacksmith',
  weapon_shop: 'blacksmith',
  smith: 'blacksmith',
  pharmacist: 'apothecary',
  potion_shop: 'apothecary',
  potion_seller: 'apothecary',
  druggist: 'apothecary',
  general_store: 'grocer',
  merchant: 'grocer',
  clothier: 'tailor',
  armor_shop: 'tailor',
  warehouse: 'storekeeper',
  storage: 'storekeeper',
  storage_keeper: 'storekeeper',
  teleport_master: 'teleporter',
  teleport: 'teleporter',
  warrior_master: 'master_warrior',
  mage_master: 'master_mage',
  taoist_master: 'master_taoist',
  guard: 'sabak_guard',
  sabak_lord: 'sabak_guard',
  city_guard: 'sabak_guard',
};
for (const [alias, target] of Object.entries(_NPC_ALIASES)) {
  if (!NPCS[alias] && NPCS[target]) NPCS[alias] = NPCS[target];
}

// ---------------------------------------------------------------------------
// 5. EXP_TABLE — experience required to advance FROM index level
// ---------------------------------------------------------------------------

/**
 * `EXP_TABLE[n]` is what a level-n character must earn to reach n+1, which is
 * exactly how `Player.gainExp` reads it. Index 0 is unused padding.
 * The curve is Mir2's: gentle to 10, brutal after 40.
 */
export const EXP_TABLE = [
  0,
  100, 200, 400, 800, 1300, 2000, 3000, 4000, 5000, 6000,          //  1-10
  7000, 8000, 10000, 12000, 14000, 17000, 20000, 24000, 28000, 32000, // 11-20
  38000, 44000, 50000, 57000, 65000, 75000, 85000, 95000, 110000, 125000, // 21-30
  140000, 160000, 180000, 200000, 230000, 260000, 290000, 330000, 370000, 420000, // 31-40
  480000, 540000, 610000, 690000, 780000, 880000, 990000, 1120000, 1260000, 1420000, // 41-50
  1600000, 1800000, 2030000, 2290000, 2580000, 2910000, 3280000, 3700000, 4170000, 4700000, // 51-60
];

/** Highest level the table supports. */
export const MAX_LEVEL = 60;

// ---------------------------------------------------------------------------
// 6. DROPS
// ---------------------------------------------------------------------------

/**
 * Named loot tables. A `MonsterDef` may point at one via `dropTable`; monsters
 * that declare neither `drops` nor `dropTable` fall back to the tier table for
 * their level so no corner of the world is loot-dead.
 *
 * Entry shape: `{ item, chance, qty }` — `qty` is a number or an inclusive
 * `[lo,hi]` pair. `chance` is per-kill probability.
 */
export const DROP_TABLES = {
  /** 比奇城外 — 鸡 / 鹿 / 多角虫 / 稻草人, levels 1-10. */
  field_low: [
    { item: 'herb_potion', chance: 0.14, qty: [1, 2] },
    { item: 'gold_wound', chance: 0.05, qty: 1 },
    { item: 'sun_water', chance: 0.04, qty: 1 },
    { item: 'wooden_sword', chance: 0.010, qty: 1 },
    { item: 'cloth_robe', chance: 0.010, qty: 1 },
    { item: 'short_sword', chance: 0.005, qty: 1 },
  ],

  /** 蜘蛛 / 饿狼 / 蝙蝠, levels 8-16. */
  field_mid: [
    { item: 'gold_wound', chance: 0.11, qty: [1, 2] },
    { item: 'sun_water', chance: 0.09, qty: [1, 2] },
    { item: 'short_sword', chance: 0.016, qty: 1 },
    { item: 'bronze_sword', chance: 0.010, qty: 1 },
    { item: 'light_armor', chance: 0.012, qty: 1 },
    { item: 'helm', chance: 0.012, qty: 1 },
    { item: 'necklace', chance: 0.008, qty: 1 },
  ],

  /** 石墓阵 — 骷髅 line, levels 12-22. */
  stonetomb: [
    { item: 'gold_wound', chance: 0.13, qty: [1, 3] },
    { item: 'sun_water', chance: 0.11, qty: [1, 3] },
    { item: 'iron_sword', chance: 0.014, qty: 1 },
    { item: 'ebony_sword', chance: 0.008, qty: 1 },
    { item: 'medium_armor', chance: 0.012, qty: 1 },
    { item: 'iron_helm', chance: 0.014, qty: 1 },
    { item: 'amulet', chance: 0.010, qty: 1 },
    { item: 'three_eye_bracelet', chance: 0.005, qty: 1 },
    { item: 'taoist_helm', chance: 0.006, qty: 1 },
  ],

  /** 沃玛寺庙, levels 20-30. */
  woma: [
    { item: 'gold_wound_strong', chance: 0.10, qty: [1, 2] },
    { item: 'sun_water_strong', chance: 0.09, qty: [1, 2] },
    { item: 'blue_blade', chance: 0.011, qty: 1 },
    { item: 'crescent_blade', chance: 0.007, qty: 1 },
    { item: 'heavy_armor', chance: 0.009, qty: 1 },
    { item: 'ghost_armor', chance: 0.004, qty: 1 },
    { item: 'memory_helm', chance: 0.006, qty: 1 },
    { item: 'green_necklace', chance: 0.006, qty: 1 },
    { item: 'teleport_ring', chance: 0.005, qty: 1 },
  ],

  /** 祖玛寺庙, levels 30-40. */
  zuma: [
    { item: 'gold_wound_strong', chance: 0.14, qty: [1, 3] },
    { item: 'sun_water_strong', chance: 0.13, qty: [1, 3] },
    { item: 'eternal_frost', chance: 0.02, qty: 1 },
    { item: 'dragon_sword', chance: 0.008, qty: 1 },
    { item: 'blood_drinker', chance: 0.005, qty: 1 },
    { item: 'bone_jade_staff', chance: 0.004, qty: 1 },
    { item: 'dragon_tooth', chance: 0.004, qty: 1 },
    { item: 'knight_bracelet', chance: 0.006, qty: 1 },
    { item: 'mind_bracelet', chance: 0.006, qty: 1 },
    { item: 'moral_words', chance: 0.005, qty: 1 },
  ],

  /** 赤月峡谷, endgame. */
  redmoon: [
    { item: 'eternal_frost', chance: 0.09, qty: [1, 2] },
    { item: 'gold_wound_strong', chance: 0.20, qty: [2, 4] },
    { item: 'sun_water_strong', chance: 0.18, qty: [2, 4] },
    { item: 'asura', chance: 0.006, qty: 1 },
    { item: 'soul_devour_staff', chance: 0.005, qty: 1 },
    { item: 'holy_plate', chance: 0.005, qty: 1 },
    { item: 'taoist_robe', chance: 0.005, qty: 1 },
    { item: 'mage_cloak', chance: 0.005, qty: 1 },
    { item: 'dragon_heart', chance: 0.006, qty: 1 },
    { item: 'titan_ring', chance: 0.005, qty: 1 },
  ],

  // ---- boss tables (guaranteed-ish, plus a lottery slot) ------------------
  boss_woma: [
    { item: 'gold_wound_strong', chance: 1.0, qty: [3, 6] },
    { item: 'sun_water_strong', chance: 1.0, qty: [3, 6] },
    { item: 'crescent_blade', chance: 0.22, qty: 1 },
    { item: 'ghost_armor', chance: 0.16, qty: 1 },
    { item: 'memory_helm', chance: 0.18, qty: 1 },
    { item: 'book_half_moon', chance: 0.06, qty: 1 },
    { item: 'book_hellfire', chance: 0.06, qty: 1 },
    { item: 'book_ghost_shield', chance: 0.06, qty: 1 },
  ],
  boss_zuma: [
    { item: 'eternal_frost', chance: 1.0, qty: [2, 4] },
    { item: 'dragon_sword', chance: 0.18, qty: 1 },
    { item: 'blood_drinker', chance: 0.12, qty: 1 },
    { item: 'bone_jade_staff', chance: 0.12, qty: 1 },
    { item: 'dragon_tooth', chance: 0.12, qty: 1 },
    { item: 'dragon_heart', chance: 0.08, qty: 1 },
    { item: 'book_fire_sword', chance: 0.07, qty: 1 },
    { item: 'book_ice_roar', chance: 0.07, qty: 1 },
    { item: 'book_summon_shinsu', chance: 0.07, qty: 1 },
  ],
  boss_redmoon: [
    { item: 'eternal_frost', chance: 1.0, qty: [4, 8] },
    { item: 'holy_plate', chance: 0.14, qty: 1 },
    { item: 'taoist_robe', chance: 0.14, qty: 1 },
    { item: 'mage_cloak', chance: 0.14, qty: 1 },
    { item: 'holy_helm', chance: 0.10, qty: 1 },
    { item: 'taoist_crown', chance: 0.10, qty: 1 },
    { item: 'mage_crown', chance: 0.10, qty: 1 },
    { item: 'judgement_staff', chance: 0.05, qty: 1 },
    { item: 'soul_devour_staff', chance: 0.05, qty: 1 },
    { item: 'demon_armor', chance: 0.02, qty: 1 },
    { item: 'dragon_slayer', chance: 0.008, qty: 1 },
    { item: 'book_sun_blade', chance: 0.09, qty: 1 },
    { item: 'book_meteor_rain', chance: 0.09, qty: 1 },
    { item: 'book_taoist_zen', chance: 0.09, qty: 1 },
  ],
};

/** Which tier table a monster falls back to when it declares no drops. */
export function tierTableFor(level, boss = false) {
  if (boss) {
    if (level >= 45) return 'boss_redmoon';
    if (level >= 32) return 'boss_zuma';
    return 'boss_woma';
  }
  if (level >= 42) return 'redmoon';
  if (level >= 30) return 'zuma';
  if (level >= 20) return 'woma';
  if (level >= 12) return 'stonetomb';
  if (level >= 8) return 'field_mid';
  return 'field_low';
}

function _rollQty(q, r) {
  if (Array.isArray(q)) {
    const lo = q[0] | 0, hi = q[1] | 0;
    return hi > lo ? lo + Math.floor(r() * (hi - lo + 1)) : lo;
  }
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

/**
 * Gold is never listed in a drop table — every kill rolls it from the monster's
 * level so the economy scales automatically as the Bestiary grows.
 */
function _rollGold(level, boss, r, scale) {
  let g = (3 + Math.pow(level, 1.55) * 1.1) * (0.6 + r() * 0.8);
  if (boss) g *= 18;
  if (Number.isFinite(scale) && scale > 0) g *= scale;
  return Math.max(1, Math.round(g));
}

/**
 * Roll a monster's loot.
 *
 * @param {object} monsterDef  a Bestiary MonsterDef: needs `level`, optionally
 *                             `ai`, `drops:[{item,chance,qty}]`, `dropTable`,
 *                             `goldScale`, `noGold`.
 * @param {function} rng       deterministic rng() -> [0,1); falls back to Math.random.
 * @returns {Array<{item:string, qty:number}>}
 */
export function rollDrops(monsterDef, rng) {
  const out = [];
  if (!monsterDef) return out;
  const r = typeof rng === 'function' ? rng : Math.random;

  const level = Math.max(1, Math.min(MAX_LEVEL + 20, monsterDef.level || 1));
  const boss = monsterDef.ai === 'boss';

  if (!monsterDef.noGold && (boss || r() < 0.82)) {
    out.push({ item: 'gold', qty: _rollGold(level, boss, r, monsterDef.goldScale) });
  }

  const listed = Array.isArray(monsterDef.drops) ? monsterDef.drops : null;
  const entries = [];
  if (listed && listed.length) entries.push(...listed);

  const tableName = monsterDef.dropTable || (entries.length ? null : tierTableFor(level, boss));
  const table = tableName ? DROP_TABLES[tableName] : null;
  if (table) entries.push(...table);

  for (let i = 0; i < entries.length; i++) {
    const d = entries[i];
    // Unknown ids are skipped silently: `Inventory.makeItem` would warn once per
    // kill otherwise, and the Bestiary is authored independently of this table.
    if (!d || !d.item || !ITEMS[d.item]) continue;
    const chance = d.chance == null ? 1 : d.chance;
    if (chance < 1 && r() >= chance) continue;
    out.push({ item: d.item, qty: Math.max(1, _rollQty(d.qty, r)) });
  }

  return out;
}

export default { CLASSES, SKILLS, ITEMS, NPCS, EXP_TABLE, DROP_TABLES, rollDrops };
