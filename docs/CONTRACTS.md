# 模块契约 · Module Contracts

**This file is normative.** Every module listed here is owned by exactly one
author. If you are implementing a module below, you may change *anything* inside
your own files, but the exported signatures here are a hard contract — other
modules are written against them and will break if you rename, reorder, or drop
an export.

If you believe a contract is wrong, implement it as specified anyway and note
the objection in a comment at the top of your file. Do not unilaterally change
it.

---

## 0. Ground rules

- **ES modules only.** No bundler, no build step. The page is opened directly.
- Import three via the bare specifier: `import * as THREE from 'three';`
  Addons: `import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';`
  (An import map in `index.html` resolves both.)
- **No network requests at runtime.** No CDNs, no fetched textures, no audio
  files, no fonts. Every texture, mesh, sound, and animation is generated
  procedurally in JS. This is non-negotiable: the game must run from `file://`
  and from GitHub Pages with zero external dependencies.
- **No third-party art.** Do not attempt to reproduce, trace, or embed original
  Legend of Mir assets. We are building an *homage*: the silhouette, palette,
  UI language, and content names are period-accurate; every pixel is ours.
- Coordinates: **X east, Z south, Y up.** One world unit = one Mir tile.
  Tile `(tx,tz)` centre is world `(tx + 0.5, height, tz + 0.5)`.
- Angles in radians. `facing = 0` looks toward `+Z`; increases counter-clockwise
  when viewed from above (i.e. `atan2(dx, dz)`).
- Time is in **seconds**. `dt` is already clamped by the caller to `<= 0.1`.
- Everything you allocate per-frame must be pooled or reused. No `new` inside
  an `update(dt)` hot path.
- All user-facing strings are **Simplified Chinese**, matching Mir2's zh-CN
  client. Code comments and identifiers are English.

## 0.1 Shared services passed to constructors

Most subsystems receive a `ctx` object. It always has at least:

```js
ctx = {
  engine,      // core/Engine.js instance — .renderer .scene .camera .maxAniso .preset .addShake()
  bus,         // core/EventBus.js singleton
  forge,       // gfx/TextureForge.js instance
  materials,   // gfx/Materials.js instance
  fx,          // gfx/Particles.js FxSystem instance
  audio,       // audio/Audio.js instance
  quality,     // 'low'|'med'|'high'|'ultra'
  rng,         // deterministic RNG: rng() -> [0,1), rng.int(a,b), rng.pick(arr), rng.range(a,b)
}
```

---

## 1. `src/gfx/TextureForge.js` — procedural PBR texture generation

The single source of all surface detail. Everything is drawn to a `<canvas>`
(or generated into a `Uint8Array` for data textures) and uploaded as a
`THREE.CanvasTexture` / `THREE.DataTexture`.

```js
export class TextureForge {
  constructor(renderer, { maxAniso = 8, quality = 'high' } = {})

  /**
   * Full PBR set for a named surface. Results are cached by (kind + opts hash).
   * @param {string} kind
   * @param {object} [opts] - { size, repeat, tint, seed, roughness, normalStrength, ... }
   * @returns {{ map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture,
   *             aoMap:THREE.Texture, emissiveMap?:THREE.Texture }}
   */
  pbr(kind, opts = {})

  /** Just the albedo canvas, uncached-friendly. @returns {HTMLCanvasElement} */
  canvas(kind, size = 512, opts = {})

  /** Derive a tangent-space normal map from a height/luminance canvas. */
  normalFromHeight(canvasOrTex, strength = 1.0)

  /** A 1x1..NxN data texture from a callback. cb(x,y,u,v) -> [r,g,b,a] in 0..255 */
  data(key, size, cb, opts = {})

  /** Seamless value/simplex/worley fields, all tileable. */
  noise(key, size, { type='simplex', octaves=5, freq=4, lacunarity=2, gain=0.5, seed=1 })

  dispose()
}
```

**Required `kind` values** (all must tile seamlessly at their default repeat):

| group | kinds |
|---|---|
| ground | `grass`, `grass.dry`, `dirt`, `dirt.road`, `mud`, `sand`, `snow`, `stone.floor`, `cobble`, `cave.floor`, `temple.floor`, `blood.floor` |
| rock | `rock`, `rock.mossy`, `cliff`, `gravel` |
| wood | `bark.pine`, `bark.oak`, `plank`, `plank.worn`, `log` |
| built | `brick`, `stone.wall`, `temple.wall`, `roof.tile`, `roof.thatch`, `plaster`, `paper.screen` |
| organic | `leaf.pine`, `leaf.broad`, `bush`, `reed`, `fur.brown`, `fur.grey`, `fur.white`, `hide`, `chitin`, `scale.green`, `scale.red`, `bone`, `flesh` |
| gear | `iron`, `iron.rusted`, `steel`, `bronze`, `gold`, `cloth.linen`, `cloth.silk`, `leather`, `leather.studded`, `sackcloth`, `robe.blue`, `robe.white` |
| fx | `rune`, `parchment`, `lava`, `water.normal`, `caustics`, `ember`, `smoke.puff`, `spark`, `glow.radial`, `blood.splat`, `crack` |

Unknown kinds must not throw — fall back to a tinted noise and `console.warn`.

**Quality gate:** at `high`, ground textures are 1024², detail-mapped, and must
survive a screenshot at 2× zoom without visible tiling or mush. A flat colour +
uniform noise is a failure. Real surfaces have *structure*: grass has blades,
clumps, dead patches, and dirt showing through; cobble has individual stones
with mortar, chips, and wear; bark has vertical fissures with depth.

---

## 2. `src/gfx/Materials.js` — material library

```js
export class MaterialLibrary {
  constructor(forge, { quality, maxAniso, envMap = null })

  /** Cached. @returns {THREE.Material} */
  get(name, overrides = {})

  /** Called once per frame; animates lava/water/rune/emissive uniforms. */
  update(dt, elapsed)

  /** Assign the scene env map to every PBR material at once. */
  setEnvironment(envTexture, intensity = 1)

  dispose()
}
```

**Required names:** `terrain` is NOT here (Terrain owns its own splat material).

`bark`, `leaf`, `leaf.pine`, `bush`, `rock`, `cliff`, `plank`, `plank.worn`,
`brick`, `stoneWall`, `templeWall`, `roofTile`, `thatch`, `plaster`,
`paperScreen`, `iron`, `ironRusted`, `steel`, `bronze`, `gold`, `clothRed`,
`clothBlue`, `clothWhite`, `silk`, `leather`, `sackcloth`, `banner`, `bone`,
`flesh`, `furBrown`, `furGrey`, `furWhite`, `hide`, `chitin`, `scaleGreen`,
`scaleRed`, `lava` (animated), `water` (animated), `rune` (animated emissive),
`crystal`, `glass`, `torchWood`, `skin.pale`, `skin.tan`, `skin.grey`,
`eye.glow` (emissive), `shadowBlob` (transparent).

Unknown names must not throw — return a magenta `MeshStandardMaterial` and warn.

---

## 3. `src/gfx/Sky.js` — sky dome, celestial bodies, day/night

```js
export class Sky {
  constructor(ctx)                  // adds its own objects + lights to ctx.engine.scene

  /** 0..24 in-game hours. Setting this jumps; use update() for smooth flow. */
  timeOfDay = 8.5

  /** Blend to a named look over `seconds`. */
  setPreset(name, seconds = 3)      // 'dawn'|'day'|'dusk'|'night'|'overcast'|'storm'|'cave'|'hell'

  update(dt)

  sun      // THREE.DirectionalLight (casts the world shadow)
  moon     // THREE.DirectionalLight
  hemi     // THREE.HemisphereLight
  /** Cube/equirect env map for the material library. May be null early. */
  envMap

  /** Ground fog colour the terrain/props should tint distant geometry with. */
  fogColor  // THREE.Color

  dispose()
}
```

The sun must actually travel an arc, colour-shift through the day, and drive the
directional shadow. Night is *blue and readable*, not black. Stars appear after
dusk. Clouds are procedural and drift.

---

## 4. `src/gfx/Weather.js`

```js
export class Weather {
  constructor(ctx)
  /** kind: 'clear'|'rain'|'storm'|'snow'|'fog'|'sandstorm'|'ash'|'embers' */
  set(kind, intensity = 1, fadeSeconds = 4)
  update(dt, focusPos /* THREE.Vector3 */)
  dispose()
}
```

Precipitation follows the camera in a moving volume. Rain implies wet ground
(bump `bus.emit('weather:wetness', 0..1)`), ripples, and occasional lightning
that flashes `ctx.engine.postfx` and fires `bus.emit('audio:sfx', {id:'thunder'})`.

---

## 5. `src/gfx/PostFX.js`

```js
export class PostFX {
  constructor(engine, { quality })  // reads engine.renderer/scene/camera
  composer
  setSize(w, h)
  render(dt)
  /** Screen flash, e.g. lightning or taking a big hit. */
  flash(color = 0xffffff, strength = 1, seconds = 0.25)
  /** 0..1 red vignette pulse when the player is low on HP. */
  setDanger(v)
  /** Desaturate + darken for death / menus. */
  setGrade(name, seconds = 0.6)     // 'normal'|'dead'|'cave'|'night'|'hell'
  dispose()
}
```

Chain at `high`: Render → SSAO(optional) → Bloom(selective, threshold ~0.85) →
Grade/LUT → FXAA/SMAA → Output. Bloom must make torches, lava, magic, and eyes
glow *without* washing out daylight.

---

## 6. `src/gfx/Particles.js` — VFX

```js
export class FxSystem {
  constructor(ctx)
  /**
   * @param {string} name
   * @param {THREE.Vector3} pos
   * @param {object} [opts] - { dir:THREE.Vector3, scale, color, target:THREE.Vector3,
   *                            duration, onDone:Function, parent:THREE.Object3D }
   * @returns {{ stop():void, setPosition(v):void, alive:boolean }}
   */
  spawn(name, pos, opts = {})
  update(dt, camera)
  dispose()
}
```

**Required names:**
`hit.slash`, `hit.blunt`, `hit.blood`, `hit.spark`, `hit.block`, `hit.crit`,
`fire.ball`, `fire.trail`, `fire.explode`, `fire.wall`, `fire.pillar`,
`ice.shard`, `ice.storm`, `ice.freeze`,
`thunder.bolt`, `thunder.impact`,
`heal.aura`, `poison.cloud`, `poison.tick`, `shield.magic`, `invisible.puff`,
`summon.rune`, `summon.burst`, `soul.fireball`,
`torch.flame`, `campfire`, `brazier`, `lava.bubble`, `chimney.smoke`,
`dust.step`, `dust.land`, `leaf.fall`, `firefly`,
`level.up`, `loot.sparkle`, `portal.swirl`, `teleport.in`, `teleport.out`,
`death.dissolve`, `boss.aura`.

Prefer **one pooled `THREE.Points` per material** plus a few instanced quads
over creating objects per effect. Additive-blended, soft-edged, camera-facing.

---

## 7. `src/world/MapDefs.js` — content data for the world

```js
export const MAPS = { /* id -> MapDef */ }
export function getMap(id)
```

A `MapDef`:

```js
{
  id: 'bichon',
  name: '比奇省',
  biome: 'meadow',              // drives terrain palette + prop tables
  width: 128, height: 128,      // tiles
  safeZone: true,               // no monster spawns / no PvP
  sky: 'day', weather: ['clear','clear','rain'],
  ambientLoop: 'town',
  music: 'town',
  /** Seed for deterministic terrain + prop scatter. */
  seed: 20031107,
  /** Where the player appears when entering. */
  entry: { x: 64, z: 64 },
  /** Hand-authored structures. See Props contract for shape list. */
  structures: [ { kind:'wall.town', ... }, { kind:'house.tiled', x, z, rot } ],
  npcs:    [ { id:'blacksmith', x, z, facing } ],
  spawns:  [ { monster:'chicken', count:14, area:{x,z,r} } ],
  portals: [ { x, z, to:'woma', toEntry:{x,z}, label:'沃玛寺庙' } ],
}
```

**Required maps** (Mir2-accurate names and progression):

| id | 名称 | biome | role |
|---|---|---|---|
| `bichon` | 比奇省 | meadow | starter town, safe zone |
| `bichon_field` | 比奇城外 | meadow | 鸡/鹿/多角虫, levels 1-10 |
| `mongchon` | 盟重土城 | desert | second town, safe zone |
| `woma` | 沃玛寺庙 | temple | dungeon, 沃玛 line, levels 20-30 |
| `zuma` | 祖玛寺庙 | temple | dungeon, 祖玛 line, levels 30-40 |
| `stonetomb` | 石墓阵 | cave | 骷髅 line, levels 12-22 |
| `redmoon` | 赤月峡谷 | hell | endgame, 赤月恶魔 |

---

## 8. `src/world/Terrain.js`

```js
export class Terrain {
  constructor(mapDef, ctx)
  group            // THREE.Group — add to scene; contains ground mesh(es)
  /** The mesh(es) the mouse raycasts against for click-to-move. */
  pickTargets      // THREE.Object3D[]
  heightAt(x, z)   // world-space Y, bilinear
  slopeAt(x, z)    // 0..1
  /** Static terrain walkability (cliffs, water). Props add their own blockers. */
  walkableAt(tx, tz)
  update(dt, camera)
  dispose()
}
```

Multi-layer splatted ground (4+ layers weighted by height/slope/noise), a real
heightfield (not a flat plane), and a detail/macro texture pair so it reads at
both zoom extremes. Water surfaces belong to Terrain and must be reflective.

---

## 9. `src/world/Props.js`

```js
export class Props {
  constructor(mapDef, terrain, ctx)
  group
  /** Circles the nav grid should mark unwalkable: [{x, z, r}] in world units. */
  blockers
  /** Objects the player can interact with (doors, chests, signs). */
  interactables    // [{ id, kind, position:THREE.Vector3, radius, label, onUse(game) }]
  update(dt, camera)
  dispose()
}
```

Uses `THREE.InstancedMesh` for anything repeated (trees, grass tufts, rocks,
fences). Structures listed in a MapDef's `structures[]` are built as real
geometry: `wall.town`, `gate.town`, `house.tiled`, `house.thatch`, `shop`,
`inn`, `temple.hall`, `temple.pillar`, `altar`, `brazier`, `torch.wall`,
`well`, `cart`, `crate`, `barrel`, `fence`, `bridge`, `stairs`, `statue.beast`,
`banner.pole`, `tomb.stone`, `cave.mouth`, `lava.pool`.

Every torch/brazier gets a flickering `THREE.PointLight` — but respect the light
budget: at most 8 dynamic lights near the camera, distance-culled.

---

## 10. `src/world/Nav.js`

```js
export class NavGrid {
  constructor(width, height)
  setBlocked(tx, tz, blocked)
  blockCircle(x, z, r)
  isWalkable(tx, tz)
  /** @returns {Array<{x:number,z:number}>|null} tile centres, start excluded. */
  findPath(sx, sz, gx, gz, { maxNodes = 4000, diagonal = true } = {})
  /** Nearest walkable tile to (tx,tz) within `radius`, or null. */
  nearestWalkable(tx, tz, radius = 6)
  /** Straight-line walkability test used to shortcut/smooth paths. */
  lineOfWalk(x0, z0, x1, z1)
  debugMesh()      // optional THREE.Object3D for DEBUG.navGrid
}
```

A* with an octile heuristic, a binary heap, and string-pulling so units don't
walk staircase paths. Must handle a 256×256 grid in well under a frame.

---

## 11. `src/entities/CharacterRig.js` — procedural characters

```js
/**
 * @param {object} spec
 *   { archetype:'warrior'|'mage'|'taoist'|'npc'|'beast',
 *     build:'m'|'f', height, palette:{skin,hair,cloth,trim,metal},
 *     armor:string|null, helmet:string|null, weapon:string|null,
 *     shield:string|null, cape:string|null, scale:number }
 * @returns {Rig}
 */
export function buildHumanoid(spec, ctx)

/** Rig shape — Animator drives exactly these joints. */
Rig = {
  root,                          // THREE.Group (position/rotation owned by the entity)
  joints: {
    hips, spine, chest, neck, head,
    shoulderL, elbowL, wristL,
    shoulderR, elbowR, wristR,
    hipL, kneeL, ankleL,
    hipR, kneeR, ankleR,
  },                             // all THREE.Object3D, T-pose rest transforms baked
  attach: { handR, handL, back, head },   // THREE.Object3D mount points
  height,                        // world units, for nameplate placement
  radius,                        // collision radius
  meshes,                        // THREE.Mesh[] for dispose + material swaps
  dispose(),
}
```

Bodies are built from lathed/extruded/tapered geometry with **real silhouette**:
shoulder pauldrons, tapered limbs, belted waists, flowing robe skirts for mages
and Taoists. Warriors are broad, mages are lean, Taoists wear layered robes.
No capsule-people. Weapons and armour are separate meshes from `Armory.js`.

## 11b. `src/entities/Armory.js`

```js
export function buildWeapon(id, ctx)   // -> THREE.Object3D, +Z = blade direction
export function buildArmor(id, build, ctx) // -> { chest, pauldrons?, skirt?, boots? }
export function buildHelmet(id, ctx)
export function buildShield(id, ctx)
export const WEAPON_IDS, ARMOR_IDS, HELMET_IDS
```

Mir2 gear names must appear: 木剑, 青铜剑, 铁剑, 乌木剑, 修罗, 银蛇, 龙纹剑,
裁决之杖, 屠龙, 骨玉权杖, 龙牙, 嗜魂法杖, 天尊道袍, 圣战宝甲, 法神披风,
天魔神甲, 记忆头盔, 圣战头盔.

## 12. `src/entities/Animator.js`

```js
export class Animator {
  constructor(rig, { archetype })
  /** @param {string} name @param {object} [opts] {speed, loop, blend, onEvent} */
  play(name, opts = {})
  /** Layered one-shot over the current loop (e.g. attack while walking). */
  overlay(name, opts = {})
  update(dt)
  /** Smoothed heading in radians; the entity writes `target`, Animator eases. */
  facingTarget
  current   // name of the active base clip
}
```

**Required clips:** `idle`, `idle.combat`, `walk`, `run`, `attack.slash`,
`attack.thrust`, `attack.heavy`, `cast.begin`, `cast.loop`, `cast.release`,
`hurt`, `block`, `die`, `dead`, `sit`, `pickup`, `cheer`.

Procedural (sine/spring driven), not baked clips. Walk cycles need weight
shift, arm counter-swing, and a settled contact pose — a swinging-limbs
placeholder is a failure. Attacks must fire an `onEvent('impact')` callback at
the contact frame so Combat can land the hit on the visual beat.

## 13. `src/entities/Bestiary.js`

```js
export const BESTIARY = { /* id -> MonsterDef */ }
export function buildMonster(id, ctx)   // -> Rig (same shape as CharacterRig)
```

`MonsterDef`: `{ id, name, level, hp, mp, ac:[min,max], mac:[min,max],
dc:[min,max], mc, sc, accuracy, agility, moveSpeed, attackSpeed, attackRange,
aggroRange, exp, drops:[{item, chance, qty}], ai:'passive'|'aggressive'|'ranged'|'caster'|'boss',
scale, undead:boolean, sfx:{hit,die,idle} }`

**Required monsters** (canonical Mir2 roster, zh-CN names):
`chicken 鸡`, `deer 鹿`, `scarecrow 稻草人`, `hen 母鸡`, `cave_bat 蝙蝠`,
`multi_horn 多角虫`, `spider_small 蜘蛛`, `hungry_wolf 饿狼`,
`skeleton 骷髅`, `skeleton_axe 持斧骷髅`, `bone_familiar 骷髅精灵`,
`zombie 僵尸`, `stone_golem 石人`, `guard_ghost 幽灵战士`,
`woma_soldier 沃玛战士`, `woma_warrior 沃玛勇士`, `woma_guard 沃玛卫士`,
`woma_taurus 沃玛教主`,
`zuma_archer 祖玛弓箭手`, `zuma_statue 祖玛雕像`, `zuma_guard 祖玛卫士`,
`zuma_taurus 祖玛教主`,
`red_moon 赤月恶魔`, `evil_snake 触龙神`.

Boss models must be *visibly bosses*: 2-3× scale, distinct silhouette, glowing
eyes, an aura effect, and a unique attack tell.

## 14. `src/game/Content.js` — classes, skills, items, drops, NPCs

```js
export const CLASSES   // warrior/mage/taoist: base stats, per-level growth, weapon types
export const SKILLS    // id -> { name, class, level, mp, cooldown, cast, range, effect, vfx, desc }
export const ITEMS     // id -> { name, type, slot, icon, stats, price, weight, class?, reqLevel }
export const NPCS      // id -> { name, title, role, dialog, shop:[itemId], rig }
export const EXP_TABLE // [lvl] -> exp needed
export const DROP_TABLES
export function rollDrops(monsterDef, rng)
```

Skill lists must be the real Mir2 ones (火球术, 治愈术, 攻杀剑术, 烈火剑法,
half-moon 半月弯刀, 刺杀剑术, 大火球, 抗拒火环, 地狱雷光, 冰咆哮, 魔法盾,
爆裂火焰, 精神力战法, 施毒术, 灵魂火符, 召唤骷髅, 隐身术, 群体治愈术,
召唤神兽) with period-appropriate level gates and MP costs.

## 15. `src/ui/Hud.js` + `styles/ui.css`

```js
export class Hud {
  constructor(game)      // reads game.player, subscribes to bus events
  update(dt)
  toast(text, kind)      // 'info'|'good'|'bad'|'system'
  openPanel(name)        // 'inventory'|'character'|'skills'|'shop'|'dialog'|'map'
  closePanel(name)
  dispose()
}
```

The HUD is DOM, not canvas. It must read as *Mir2's* UI: dark bronzed panels,
carved gold trim, bevelled sunken slots, a bottom command bar, HP/MP bars with a
glassy highlight, floating damage numbers, and a top-left minimap. Fonts: system
CJK serif for headings, sans for body. Nothing may look like a modern web app —
no flat material design, no rounded pill buttons, no drop shadows in the CSS3
idiom.

## 16. `src/audio/Audio.js`

```js
export class Audio {
  constructor()
  /** Must be called from a user gesture. */
  unlock()
  sfx(id, { pos, volume, rate } = {})
  music(id, { fade = 2 } = {})
  ambience(id, { fade = 3 } = {})
  setListener(position, facing)
  setVolume(bus, v)      // 'master'|'sfx'|'music'|'ambience'
  dispose()
}
```

Everything synthesised with the WebAudio graph — oscillators, noise buffers,
filters, convolution from generated impulse responses. No sample files.
SFX ids: `sword.swing`, `sword.hit`, `sword.block`, `bow.shoot`, `fire.cast`,
`fire.hit`, `ice.cast`, `thunder`, `heal`, `poison`, `summon`, `levelup`,
`coin`, `loot`, `potion`, `door`, `portal`, `walk.grass`, `walk.stone`,
`walk.sand`, `monster.hit`, `monster.die`, `boss.roar`, `ui.click`, `ui.error`.
Music ids: `town`, `field`, `dungeon`, `boss`, `death`.

---

## 17. Bus events (the integration surface)

Emitted by gameplay, consumed by UI/VFX/audio:

| event | payload |
|---|---|
| `player:spawn` | `{ player }` |
| `player:stats` | `{ hp, hpMax, mp, mpMax, exp, expMax, level, stamina }` |
| `player:levelup` | `{ level }` |
| `player:died` | `{}` |
| `entity:damaged` | `{ target, amount, kind:'physical'\|'magic'\|'poison', crit, source }` |
| `entity:healed` | `{ target, amount }` |
| `entity:died` | `{ entity, killer }` |
| `combat:miss` | `{ source, target }` |
| `skill:cast` | `{ skillId, caster, target }` |
| `skill:cooldown` | `{ skillId, seconds }` |
| `item:looted` | `{ item, qty }` |
| `item:dropped` | `{ item, position }` |
| `inventory:changed` | `{}` |
| `map:changed` | `{ mapId, name }` |
| `quest:updated` | `{ questId, state }` |
| `chat` | `{ text, channel }` |
| `audio:sfx` | `{ id, pos }` |
| `weather:wetness` | `number 0..1` |
| `ui:panel` | `{ name, open }` |

---

## 18. Definition of done (every module)

1. `node --check` passes on every file you write.
2. Opening the game produces **zero** console errors or warnings from your code.
3. Your subsystem holds 60 fps at `high` on a mid-range laptop iGPU. If it
   can't, degrade it under `ctx.quality`, don't ship a stutter.
4. Nothing you allocate leaks across a map change — `dispose()` actually frees
   geometries, materials, and textures.
5. It looks like *热血传奇*, not like a Three.js example.
