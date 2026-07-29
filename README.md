# 热血传奇 · Legend of Mir — Three.js Edition

A 3D homage to *热血传奇* (Legend of Mir 2, 1.76-era), built with Three.js.
No build step, no bundler, no runtime downloads: open `index.html` and play.

Every texture, mesh, animation, and sound is **generated procedurally in JS** —
there is not a single image or audio file in this repository. The homage is to
the game's silhouette, palette, UI language, and content design; none of the
original art is reproduced.

## Playing

```
python3 -m http.server 8080   # or any static file server
open http://localhost:8080
```

| control | action |
|---|---|
| left click | move / attack / talk |
| right click held (or Shift) | run |
| `F1`–`F8` / `1`–`8` | skills |
| `Space` / `Z` | drink healing potion |
| `X` | drink mana potion |
| `E` / `G` | pick up loot, interact |
| `T` | toggle auto-pickup |
| `I` `C` `K` `M` | bag / character / skills / map |
| wheel | zoom |
| `+` `-` | quality tier |
| `[` `]` | scrub time of day |

`?q=ultra` / `?map=zuma` in the URL override quality and starting map.

## Layout

```
index.html          shell, import map, boot screen
styles/ui.css       Mir2-style HUD skin
docs/CONTRACTS.md   normative module interfaces
src/core/           engine, input, event bus, RNG
src/gfx/            procedural textures, materials, sky, weather, VFX, post
src/world/          maps, terrain, props, navigation
src/entities/       character rigs, animation, bestiary, AI
src/game/           combat, inventory, content tables, orchestration
src/ui/             HUD
src/audio/          WebAudio synthesis
vendor/three/       Three.js r185 (MIT)
```

## Credits

Three.js © the Three.js authors, MIT.
*Legend of Mir 2* is a trademark of its respective owners; this project is an
unaffiliated fan homage and contains none of its assets.
