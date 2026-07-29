"""
Asset build. Run from the repo root:

    python3 tools/blender/build.py                 # everything
    python3 tools/blender/build.py characters      # one module
    python3 tools/blender/build.py --list          # what would be built

Each asset module exposes:

    ASSETS = { "asset_name": ("category", builder_callable), ... }

The builder receives no arguments, models into the CURRENT (already-cleared)
scene, and returns nothing. build.py resets the scene between assets, so a
builder never has to clean up after the previous one — and one broken builder
cannot corrupt its neighbours.

Every asset is exported alone into its own GLB. The game loads and clones them,
so per-asset isolation costs nothing at runtime and keeps rebuilds cheap.
"""
import sys
import os
import time
import traceback
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lib import mesh as M          # noqa: E402
from lib import export as EX       # noqa: E402

# Asset modules, in build order. A module that does not exist yet is skipped
# with a notice rather than failing the whole build — this lets modeling work
# land incrementally.
MODULES = [
    "characters",
    "weapons",
    "armor",
    "monsters_field",
    "monsters_undead",
    "monsters_woma",
    "monsters_zuma",
    "monsters_boss",
    "nature",
    "structures",
    "dungeon",
]


def load_modules(only=None):
    mods = []
    for name in MODULES:
        if only and name not in only:
            continue
        try:
            mods.append((name, importlib.import_module(name)))
        except ModuleNotFoundError:
            print(f"  - {name}: not implemented yet, skipping")
        except Exception:
            print(f"  ! {name}: failed to import")
            traceback.print_exc()
    return mods


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    flags = {a for a in sys.argv[1:] if a.startswith("-")}
    only = set(args) if args else None

    mods = load_modules(only)

    if "--list" in flags:
        for name, mod in mods:
            for asset, (cat, _fn) in getattr(mod, "ASSETS", {}).items():
                print(f"  {name:20s} {asset:28s} [{cat}]")
        return 0

    t0 = time.time()
    built = failed = 0

    for name, mod in mods:
        assets = getattr(mod, "ASSETS", {})
        if not assets:
            print(f"  - {name}: exposes no ASSETS dict, skipping")
            continue
        print(f"\n=== {name} ({len(assets)} assets) ===")
        for asset, spec in assets.items():
            category, fn = spec
            try:
                M.reset()
                fn()
                EX.emit(asset, category=category)
                built += 1
            except Exception:
                failed += 1
                print(f"  ! {asset} FAILED")
                traceback.print_exc(limit=6)

    EX.write_manifest()
    print(f"\n{built} built, {failed} failed in {time.time() - t0:.1f}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
