"""
Material slots for exported assets.

Deliberately thin: a Blender material here carries a NAME and a rough preview
colour, nothing more. At load time the game swaps each slot for the real
material from src/gfx/Materials.js, which is textured by the procedural
TextureForge. So Blender owns geometry, TextureForge owns surface.

That split keeps the GLBs small (no embedded images), keeps every surface
consistent between modeled assets and JS-generated terrain, and means a
texture improvement propagates to every asset without re-exporting anything.

NAMES MUST MATCH MaterialLibrary.get() keys in docs/CONTRACTS.md §2 — an
unmatched name shows up magenta in game, which is the intended loud failure.
"""
import bpy

# name -> preview colour, only used when viewing the .blend directly.
PREVIEW = {
    "skin.pale":   (0.86, 0.68, 0.56),
    "skin.tan":    (0.72, 0.52, 0.36),
    "skin.grey":   (0.55, 0.56, 0.54),
    "clothRed":    (0.52, 0.11, 0.10),
    "clothBlue":   (0.13, 0.20, 0.44),
    "clothWhite":  (0.82, 0.80, 0.74),
    "silk":        (0.60, 0.18, 0.22),
    "leather":     (0.32, 0.20, 0.12),
    "sackcloth":   (0.56, 0.48, 0.34),
    "iron":        (0.42, 0.44, 0.47),
    "ironRusted":  (0.38, 0.24, 0.16),
    "steel":       (0.62, 0.65, 0.70),
    "bronze":      (0.55, 0.36, 0.18),
    "gold":        (0.83, 0.66, 0.22),
    "bone":        (0.85, 0.82, 0.72),
    "flesh":       (0.55, 0.22, 0.20),
    "furBrown":    (0.34, 0.23, 0.14),
    "furGrey":     (0.40, 0.40, 0.40),
    "furWhite":    (0.85, 0.84, 0.80),
    "hide":        (0.45, 0.34, 0.22),
    "chitin":      (0.24, 0.20, 0.16),
    "scaleGreen":  (0.20, 0.34, 0.18),
    "scaleRed":    (0.42, 0.12, 0.10),
    "bark":        (0.28, 0.20, 0.13),
    "leaf":        (0.20, 0.36, 0.14),
    "leaf.pine":   (0.14, 0.28, 0.15),
    "bush":        (0.22, 0.34, 0.16),
    "rock":        (0.42, 0.40, 0.37),
    "cliff":       (0.38, 0.35, 0.32),
    "plank":       (0.45, 0.31, 0.18),
    "plank.worn":  (0.38, 0.28, 0.19),
    "brick":       (0.48, 0.28, 0.22),
    "stoneWall":   (0.48, 0.46, 0.42),
    "templeWall":  (0.40, 0.38, 0.36),
    "roofTile":    (0.24, 0.24, 0.28),
    "thatch":      (0.55, 0.44, 0.24),
    "plaster":     (0.76, 0.72, 0.64),
    "paperScreen": (0.88, 0.84, 0.72),
    "banner":      (0.55, 0.12, 0.12),
    "torchWood":   (0.30, 0.21, 0.14),
    "crystal":     (0.55, 0.75, 0.85),
    "glass":       (0.70, 0.80, 0.85),
    "lava":        (0.90, 0.30, 0.06),
    "water":       (0.18, 0.32, 0.38),
    "rune":        (0.35, 0.65, 0.95),
    "eye.glow":    (1.00, 0.55, 0.15),
}

_cache = {}


def get(name):
    """Fetch-or-create the named material slot."""
    if name in _cache and name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        c = PREVIEW.get(name, (0.8, 0.0, 0.8))
        bsdf.inputs["Base Color"].default_value = (*c, 1.0)
        # Metals and emissives get flagged so the preview isn't misleading;
        # the real values come from MaterialLibrary at runtime.
        if name in ("iron", "steel", "bronze", "gold", "ironRusted"):
            bsdf.inputs["Metallic"].default_value = 1.0
            bsdf.inputs["Roughness"].default_value = 0.35
        elif name in ("lava", "rune", "eye.glow"):
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = (*c, 1.0)
                bsdf.inputs["Emission Strength"].default_value = 3.0
        else:
            bsdf.inputs["Roughness"].default_value = 0.75
    _cache[name] = mat
    return mat


def assign(ob, name):
    """Give the whole object one material slot."""
    ob.data.materials.clear()
    ob.data.materials.append(get(name))
    return ob


def assign_faces(ob, mapping, default):
    """
    Multi-material object. `mapping` is {material_name: predicate(face_center)}
    evaluated per polygon; anything unmatched falls to `default`.
    """
    ob.data.materials.clear()
    slots = {}
    ob.data.materials.append(get(default))
    slots[default] = 0
    for i, mname in enumerate(mapping.keys(), start=1):
        ob.data.materials.append(get(mname))
        slots[mname] = i
    for poly in ob.data.polygons:
        c = poly.center
        for mname, pred in mapping.items():
            if pred(c):
                poly.material_index = slots[mname]
                break
    return ob
