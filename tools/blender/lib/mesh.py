"""
Modeling helpers shared by every asset script.

The point of this module is that a modeling script should read like modeling
intent ("a tapered limb from shoulder to elbow", "a tiled roof with upturned
eaves") rather than like bmesh bookkeeping. Anything used by more than one
asset belongs here.
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix, Euler

TAU = math.pi * 2


# --------------------------------------------------------------- scene setup

def reset():
    """Empty scene, no default cube/light/camera."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def new_mesh(name, verts, faces, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(verbose=False)
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------ profiles

def lathe(name, profile, segments=12, smooth=True, close_bottom=True, close_top=True):
    """
    Revolve a 2D profile [(radius, z), ...] around Z.

    This is the workhorse for limbs, pots, pillars, tree trunks — anything
    radially symmetric. Varying the radius down the profile is what gives a
    limb a deltoid bulge and a narrowing wrist instead of a capsule silhouette.
    """
    verts, faces = [], []
    rings = []
    for r, z in profile:
        ring = []
        if r <= 1e-6:
            ring = [len(verts)]
            verts.append((0.0, 0.0, z))
        else:
            for s in range(segments):
                a = TAU * s / segments
                ring.append(len(verts))
                verts.append((math.cos(a) * r, math.sin(a) * r, z))
        rings.append(ring)

    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        if len(a) == 1 and len(b) > 1:
            for s in range(segments):
                faces.append([a[0], b[s], b[(s + 1) % segments]])
        elif len(b) == 1 and len(a) > 1:
            for s in range(segments):
                faces.append([a[s], a[(s + 1) % segments], b[0]])
        elif len(a) > 1 and len(b) > 1:
            for s in range(segments):
                faces.append([a[s], a[(s + 1) % segments], b[(s + 1) % segments], b[s]])

    if close_bottom and len(rings[0]) > 1:
        faces.append(list(reversed(rings[0])))
    if close_top and len(rings[-1]) > 1:
        faces.append(list(rings[-1]))

    return new_mesh(name, verts, faces, smooth=smooth)


def limb(name, p0, p1, r0, r1, mid_bulge=1.0, segments=10, taper_curve=None):
    """
    A tapered tube from p0 to p1. `mid_bulge` > 1 swells the middle (a bicep,
    a calf); `taper_curve` optionally supplies per-step radii for full control.
    """
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    length = axis.length
    if length < 1e-6:
        raise ValueError(f"limb '{name}' has zero length")

    steps = max(3, len(taper_curve) if taper_curve else 5)
    profile = []
    for i in range(steps):
        t = i / (steps - 1)
        if taper_curve:
            r = taper_curve[i]
        else:
            r = r0 + (r1 - r0) * t
            r *= 1.0 + (mid_bulge - 1.0) * math.sin(t * math.pi)
        profile.append((r, t * length))

    ob = lathe(name, profile, segments=segments)
    # Orient +Z along the limb axis, then move into place.
    quat = Vector((0, 0, 1)).rotation_difference(axis.normalized())
    ob.matrix_world = Matrix.Translation(p0) @ quat.to_matrix().to_4x4()
    return ob


def box(name, size, location=(0, 0, 0), rotation=(0, 0, 0), bevel=0.0, segments=2):
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (sx, sy, sz)
    apply_transform(ob)
    if bevel > 0:
        add_bevel(ob, bevel, segments)
    return ob


def cylinder(name, radius, depth, location=(0, 0, 0), rotation=(0, 0, 0), verts=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                        location=location, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    return ob


def sphere(name, radius, location=(0, 0, 0), segments=16, rings=10, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings,
                                         radius=radius, location=location)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    apply_transform(ob)
    return ob


# ---------------------------------------------------------------- extrusion

def extrude_profile(name, points, thickness, closed=True, bevel=0.0):
    """Extrude a 2D polygon (list of (x, y)) along Z. Blades, plates, walls."""
    n = len(points)
    verts = [(x, y, 0.0) for x, y in points] + [(x, y, thickness) for x, y in points]
    faces = []
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        faces.append([i, j, j + n, i + n])
    faces.append(list(range(n - 1, -1, -1)))
    faces.append(list(range(n, 2 * n)))
    ob = new_mesh(name, verts, faces)
    if bevel > 0:
        add_bevel(ob, bevel, 2)
    return ob


def loft(name, rings, close=True, smooth=True):
    """
    Bridge a sequence of rings, each a list of (x, y, z). Rings must share a
    vertex count. Used for anything that changes cross-section along its
    length — a robe skirt flaring out, a horn curving and tapering.
    """
    verts, faces = [], []
    idx = []
    for ring in rings:
        row = []
        for v in ring:
            row.append(len(verts))
            verts.append(tuple(v))
        idx.append(row)
    n = len(idx[0])
    for i in range(len(idx) - 1):
        a, b = idx[i], idx[i + 1]
        for s in range(n if close else n - 1):
            t = (s + 1) % n
            faces.append([a[s], a[t], b[t], b[s]])
    return new_mesh(name, verts, faces, smooth=smooth)


def ring_points(radius, z, segments, squash=1.0, offset=(0.0, 0.0), phase=0.0):
    return [
        (math.cos(TAU * s / segments + phase) * radius + offset[0],
         math.sin(TAU * s / segments + phase) * radius * squash + offset[1],
         z)
        for s in range(segments)
    ]


# --------------------------------------------------------------- modifiers

def add_bevel(ob, width=0.01, segments=2, angle=math.radians(45), clamp=True):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = angle
    m.use_clamp_overlap = clamp
    return m


def add_subsurf(ob, levels=1, render=None):
    m = ob.modifiers.new("Subsurf", "SUBSURF")
    m.levels = levels
    m.render_levels = render if render is not None else levels
    return m


def add_mirror(ob, axis="X"):
    m = ob.modifiers.new("Mirror", "MIRROR")
    m.use_axis = (axis == "X", axis == "Y", axis == "Z")
    m.use_clip = True
    return m


def add_solidify(ob, thickness=0.02, offset=-1):
    m = ob.modifiers.new("Solidify", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    return m


def add_decimate(ob, ratio=0.5):
    m = ob.modifiers.new("Decimate", "DECIMATE")
    m.ratio = ratio
    return m


def apply_all_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            print(f"  ! could not apply {m.name} on {ob.name}: {e}")


def apply_transform(ob, location=False, rotation=True, scale=True):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=location, rotation=rotation, scale=scale)


# ---------------------------------------------------------------- assembly

def join(objs, name):
    """Merge meshes into one object (fewer draw calls in the browser)."""
    objs = [o for o in objs if o and o.type == "MESH"]
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    return ob


def duplicate(ob, name, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    new = ob.copy()
    new.data = ob.data.copy()
    new.name = name
    new.location = location
    new.rotation_euler = Euler(rotation)
    new.scale = scale
    bpy.context.collection.objects.link(new)
    return new


def mirror_object(ob, name, axis="X"):
    """A real mirrored copy — for a left hand from a right hand."""
    new = duplicate(ob, name)
    s = [1, 1, 1]
    s["XYZ".index(axis)] = -1
    new.scale = s
    apply_transform(new)
    # Negative scale inverts winding; flip the normals back.
    bpy.context.view_layer.objects.active = new
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode="OBJECT")
    return new


# ------------------------------------------------------------------- detail

def shade_smooth(ob, angle=math.radians(40)):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()
    ob.data.use_auto_smooth = True if hasattr(ob.data, "use_auto_smooth") else None
    try:
        m = ob.modifiers.new("SmoothByAngle", "SMOOTH_BY_ANGLE")
        m.angle = angle
    except Exception:
        pass


def displace_noise(ob, strength=0.02, scale=4.0, seed=1):
    """Break up a too-clean surface — rock faces, bark, weathered stone."""
    tex = bpy.data.textures.new(f"{ob.name}_disp", type="CLOUDS")
    tex.noise_scale = 1.0 / max(0.001, scale)
    m = ob.modifiers.new("Displace", "DISPLACE")
    m.texture = tex
    m.strength = strength
    m.mid_level = 0.5
    return m


def uv_unwrap(ob, angle=66.0, margin=0.02):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    except RuntimeError as e:
        print(f"  ! unwrap failed on {ob.name}: {e}")
    bpy.ops.object.mode_set(mode="OBJECT")


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)
