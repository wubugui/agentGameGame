"""
GLB export with the settings this project needs, plus a budget report.

Every asset goes through `emit()` so the export flags stay identical across
scripts and so we get one place to enforce triangle budgets — a beautiful
model that tanks the frame rate is a defect, not a win.
"""
import bpy
import os
import json

OUT_DIR = os.environ.get("MIR_ASSET_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "models"))

# Per-category triangle ceilings. Exceeded budgets are reported, not silently
# accepted; the manifest records the real numbers for the QA pass to weigh.
BUDGETS = {
    "character": 6000,
    "monster": 5000,
    "boss": 16000,
    "weapon": 1200,
    "armor": 2000,
    "prop": 1500,
    "structure": 9000,
    "tree": 2500,
}

_manifest = []


def scene_tris():
    n = 0
    deps = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        try:
            ev = ob.evaluated_get(deps)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            n += len(me.loop_triangles)
            ev.to_mesh_clear()
        except Exception:
            pass
    return n


def emit(name, category="prop", animations=False, extras=None):
    """Export everything currently in the scene as assets/models/<name>.glb."""
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT_DIR, f"{name}.glb"))

    tris = scene_tris()
    budget = BUDGETS.get(category, 2000)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,               # bake modifiers into the exported mesh
        export_yup=True,                 # Blender Z-up -> Three.js Y-up
        export_animations=animations,
        export_skins=True,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="NONE",      # geometry only; TextureForge supplies surfaces
        export_normals=True,
        export_tangents=False,
        export_texcoords=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )

    size = os.path.getsize(path)
    over = tris > budget
    rec = {
        "name": name, "category": category, "tris": tris,
        "budget": budget, "overBudget": over, "bytes": size,
        **(extras or {}),
    }
    _manifest.append(rec)
    flag = "  OVER BUDGET" if over else ""
    print(f"  [emit] {name:28s} {tris:6d} tris  {size/1024:7.1f} KB{flag}")
    return rec


def write_manifest():
    """
    A machine-readable index the game loads to know what exists, and the QA
    pass reads to weigh fidelity against cost.

    MERGES with whatever is already on disk, because a partial build
    (`build.py weapons`) must not erase the entries for assets built by an
    earlier run. Records for GLBs that no longer exist are pruned, so the
    manifest stays an honest picture of the directory.
    """
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT_DIR, "manifest.json"))

    merged = {}
    if os.path.exists(path):
        try:
            with open(path) as f:
                merged = json.load(f).get("assets", {})
        except (ValueError, OSError):
            merged = {}

    for r in _manifest:
        merged[r["name"]] = r

    # Drop entries whose GLB has been deleted.
    merged = {k: v for k, v in merged.items()
              if os.path.exists(os.path.join(OUT_DIR, f"{k}.glb"))}

    records = list(merged.values())
    payload = {
        "generated": "tools/blender/build.py",
        "count": len(records),
        "totalTris": sum(r["tris"] for r in records),
        "totalBytes": sum(r["bytes"] for r in records),
        "overBudget": [r["name"] for r in records if r.get("overBudget")],
        "assets": merged,
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"\n  manifest: {len(records)} assets, {payload['totalTris']} tris, {payload['totalBytes']/1024/1024:.2f} MB")
    if payload["overBudget"]:
        print(f"  over budget: {', '.join(payload['overBudget'])}")
    return payload
