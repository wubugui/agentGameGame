"""
The Mir2 weapon ladder — 木剑 through 屠龙.

ORIENTATION CONTRACT (docs/CONTRACTS.md §11b): the grip sits at the origin and
+Z runs along the blade/shaft away from the hand. Everything here is authored
so that a character's `handR` empty closes around z == 0.

Modeling approach: blades are lofted hulls with a real cross-section (a central
ridge falling away to two ground edges) rather than extruded slabs, because the
cross-section is what makes a blade catch light along its length instead of
reading as a paddle. Flat furniture — axe bits, crescent guards, shield boards —
uses M.extrude_profile, which is what it is for. Lathes do pommels, ferrules,
grips and staff heads.

Silhouette is the whole job: every one of these has to be identifiable from its
outline at 26 units out, and the legendary tier has to be identifiable from each
other. So proportion is varied deliberately per weapon (屠龙 is a slab three
times the mass of anything else; 银蛇 waves; 修罗 is asymmetric; 裁决之杖 is
top-heavy) and the cheap tricks — uniform width, mirrored everything, perfect
circles — are avoided where a smith or a demon wouldn't have bothered.
"""
import sys
import os
import math

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.dirname(_HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bpy                                          # noqa: E402
from mathutils import Euler                         # noqa: E402
from lib import mesh as M, rig as R, mat as MAT     # noqa: E402

TAU = math.pi * 2


# ===========================================================================
# cross-sections.  Each is a closed 2D outline in (u, v), normalised to ±1,
# traversed counter-clockwise so the lofted hull ends up with outward normals.
# u scales to blade WIDTH, v scales to blade THICKNESS.
# ===========================================================================

# A ground double edge with a central ridge — jian, longsword, spearhead.
DOUBLE = [(-1.0, 0.0), (-0.42, -1.0), (0.42, -1.0),
          (1.0, 0.0), (0.42, 1.0), (-0.42, 1.0)]

# Single edge at -u, flat spine at +u — dao, saber, fang.
SINGLE = [(-1.00, 0.00), (-0.34, -1.00), (0.80, -1.00), (1.00, -0.45),
          (1.00, 0.45), (0.80, 1.00), (-0.34, 1.00)]

# A heavy slab that only bevels near the edge — 屠龙, cleavers.
SLAB = [(-1.00, 0.00), (-0.80, -1.00), (0.88, -1.00), (1.00, -0.52),
        (1.00, 0.52), (0.88, 1.00), (-0.80, 1.00)]

# Rounded bar — quillons, shafts that are not lathed, bow limbs.
OVAL = [(math.cos(TAU * i / 6 + TAU / 12), math.sin(TAU * i / 6 + TAU / 12))
        for i in range(6)]

# Plain rectangle — planks, ribs, straps, the crude wooden sword.
PLANK = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]

# Faceted lens — a fuller rib or an inlay that should read as a raised line.
RIB = [(-1.0, 0.0), (0.0, -1.0), (1.0, 0.0), (0.0, 1.0)]


# =============================================================== primitives

def _hull(name, rings, smooth=False, cap0=True, cap1=True):
    """Bridge equal-length rings of (x, y, z) and cap both ends."""
    verts, faces, idx = [], [], []
    for ring in rings:
        row = []
        for v in ring:
            row.append(len(verts))
            verts.append(tuple(v))
        idx.append(row)
    n = len(idx[0])
    for i in range(len(idx) - 1):
        a, b = idx[i], idx[i + 1]
        for s in range(n):
            t = (s + 1) % n
            faces.append([a[s], a[t], b[t], b[s]])
    if cap0:
        faces.append(list(reversed(idx[0])))
    if cap1:
        faces.append(list(idx[-1]))
    return M.new_mesh(name, verts, faces, smooth=smooth)


def _blade(name, sections, cross=DOUBLE, smooth=False):
    """
    Loft a blade running along +Z.

    `sections` is a list of (z, half_width, half_thick[, x_offset[, y_offset]]).
    Offsetting x per section is how a saber curves and how 银蛇 waves; varying
    half_width non-monotonically is how a leaf blade gets its belly.
    """
    rings = []
    for s in sections:
        z, hw, ht = s[0], s[1], s[2]
        xo = s[3] if len(s) > 3 else 0.0
        yo = s[4] if len(s) > 4 else 0.0
        rings.append([(u * hw + xo, v * ht + yo, z) for (u, v) in cross])
    return _hull(name, rings, smooth=smooth)


def _bar_x(name, sections, cross=OVAL, smooth=True):
    """
    Same idea running along X instead — crossguards, quillons, axe cheeks.

    `sections` is (x, half_z, half_y[, z_offset[, y_offset]]).  v is negated so
    the winding stays outward after the axis swap.
    """
    rings = []
    for s in sections:
        x, hz, hy = s[0], s[1], s[2]
        zo = s[3] if len(s) > 3 else 0.0
        yo = s[4] if len(s) > 4 else 0.0
        rings.append([(x, -v * hy + yo, u * hz + zo) for (u, v) in cross])
    return _hull(name, rings, smooth=smooth)


def _bake(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Push a placement into the mesh data so joins and unwraps behave."""
    ob.location = loc
    ob.rotation_euler = Euler(rot)
    ob.scale = scale
    M.apply_transform(ob, location=True, rotation=True, scale=True)
    return ob


def _grip(name, z0, z1, r0=0.017, r1=0.019, ridges=4.0, depth=0.075,
          segments=10, steps=9):
    """A lathed handle with wrap ridges, so it never reads as a bare dowel."""
    prof = [(0.0, z0)]
    for i in range(steps):
        t = i / (steps - 1)
        z = z0 + (z1 - z0) * t
        r = (r0 + (r1 - r0) * t) * (1.0 + depth * math.sin(t * math.pi * ridges * 2.0))
        prof.append((r, z))
    prof.append((0.0, z1))
    return M.lathe(name, prof, segments=segments, smooth=True)


def _disc(name, z, r, h, seg=12, waist=0.55, dome=0.9):
    """Lens-shaped pommel / collar / washer."""
    prof = [
        (0.0, z - h * 0.5),
        (r * waist, z - h * 0.46),
        (r, z - h * 0.08),
        (r * dome, z + h * 0.30),
        (r * 0.45, z + h * 0.5),
        (0.0, z + h * 0.5),
    ]
    return M.lathe(name, prof, segments=seg, smooth=True)


def _band(name, z0, z1, r0, r1=None, seg=10, bulge=1.08):
    """
    A decorative ring wrapping a shaft or grip.

    Open at both ends on purpose: the thing it wraps is solid, so caps would be
    invisible geometry. A lathed ferrule costs nearly twice this for the same
    read, and grips carry three or four of these each.
    """
    r1 = r0 if r1 is None else r1
    rmax = max(r0, r1) * bulge
    steps = ((z0, r0), (z0 + (z1 - z0) * 0.30, rmax),
             (z0 + (z1 - z0) * 0.70, rmax), (z1, r1))
    rings = [[(math.cos(TAU * s / seg) * r, math.sin(TAU * s / seg) * r, z)
              for s in range(seg)] for (z, r) in steps]
    return _hull(name, rings, smooth=True, cap0=False, cap1=False)


def _ferrule(name, z0, z1, r0, r1, seg=12, flare=1.0):
    prof = [(0.0, z0), (r0, z0), (r0 * flare, z0 + (z1 - z0) * 0.25),
            (r1, z1 - (z1 - z0) * 0.15), (r1 * 0.9, z1), (0.0, z1)]
    return M.lathe(name, prof, segments=seg, smooth=True)


def _spike(name, base_z, tip_z, r, seg=6, curve=0.0):
    """
    A tapered horn / fang / tooth pointing along +Z, optionally swept in X.

    Built with an explicit apex vertex rather than a collapsed ring, so there
    are no zero-area quads at the point.
    """
    verts, faces = [], []
    rings = []
    n = 4
    for i in range(n):
        t = i / n                      # note: stops short of 1, apex closes it
        z = base_z + (tip_z - base_z) * t
        rr = r * (1.0 - t) ** 0.72
        row = []
        for s in range(seg):
            a = TAU * s / seg
            row.append(len(verts))
            verts.append((math.cos(a) * rr + curve * t * t,
                          math.sin(a) * rr, z))
        rings.append(row)
    apex = len(verts)
    verts.append((curve, 0.0, tip_z))
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for s in range(seg):
            t_ = (s + 1) % seg
            faces.append([a[s], a[t_], b[t_], b[s]])
    last = rings[-1]
    for s in range(seg):
        faces.append([last[s], last[(s + 1) % seg], apex])
    faces.append(list(reversed(rings[0])))
    return M.new_mesh(name, verts, faces, smooth=True)


def _fuller(name, z0, z1, half_w, half_t, steps=5, x_off=0.0):
    """A raised rib down a blade — a fuller line that catches the key light."""
    secs = []
    for i in range(steps):
        t = i / (steps - 1)
        z = z0 + (z1 - z0) * t
        w = half_w * (1.0 - 0.55 * t)
        secs.append((z, w, half_t, x_off))
    return _blade(name, secs, cross=RIB)


def _path_strip(name, path, half_w, thick, cross=SLAB, smooth=False):
    """
    Sweep a strip along a 3D path, keeping it lying on a curved surface.

    The cross-section's u axis follows the in-plane normal of the path and its
    v axis is world +Z, which is exactly what a rim band or a batten glued to a
    dished shield needs — a straight bar would float off the boss and sink into
    the edge.
    """
    rings = []
    n = len(path)
    for i, (x, y, z) in enumerate(path):
        j0 = max(0, i - 1)
        j1 = min(n - 1, i + 1)
        dx = path[j1][0] - path[j0][0]
        dy = path[j1][1] - path[j0][1]
        L = math.hypot(dx, dy) or 1.0
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        rings.append([(x + nx * u * half_w, y + ny * u * half_w, z + v * thick)
                      for (u, v) in cross])
    return _hull(name, rings, smooth=smooth)


def _finish(parts, name, unwrap=True):
    """Apply modifiers, join, unwrap. Every builder ends here."""
    live = []
    for ob in parts:
        if ob is None:
            continue
        M.apply_all_modifiers(ob)
        live.append(ob)
    joined = M.join(live, name)
    if joined and unwrap:
        M.uv_unwrap(joined)
    return joined


def _mat(ob, name):
    MAT.assign(ob, name)
    return ob


# ============================================================ hilt families

def _plain_hilt(metal="iron", grip_mat="leather", z_bot=-0.125, z_top=0.075,
                grip_r=0.017, pommel_r=0.030, pommel_h=0.048, seg=10):
    """Pommel + grip + collar, returned as a list of already-materialled parts."""
    parts = []
    p = _disc("pommel", z_bot + pommel_h * 0.5, pommel_r, pommel_h, seg=seg)
    parts.append(_mat(p, metal))
    g = _grip("grip", z_bot + pommel_h * 0.85, z_top - 0.012,
              r0=grip_r, r1=grip_r * 1.06, segments=seg)
    parts.append(_mat(g, grip_mat))
    c = _ferrule("collar", z_top - 0.020, z_top + 0.006,
                 grip_r * 1.25, grip_r * 1.45, seg=seg)
    parts.append(_mat(c, metal))
    return parts


# ===========================================================================
#                                                       T I E R   1 :  wood
# ===========================================================================

def wooden_sword():
    """木剑 — a stick someone sanded flat. Crude, knotty, obviously starter kit."""
    parts = []

    # Blade: a plank, not a blade. It is thick, it is blunt, it never tapers to
    # a point, and its width wanders — this was split off a branch with a
    # hatchet and it needs to look like it next to the bronze sword.
    secs = [
        (0.045, 0.036, 0.0150, 0.000),
        (0.150, 0.046, 0.0146, 0.004),
        (0.265, 0.049, 0.0142, 0.008),
        (0.380, 0.045, 0.0138, 0.007),
        (0.495, 0.047, 0.0132, 0.004),
        (0.590, 0.042, 0.0128, 0.000),
        (0.646, 0.034, 0.0122, -0.004),
        (0.664, 0.022, 0.0104, -0.006),   # chopped-off blunt end
    ]
    bl = _blade("wood_blade", secs, cross=PLANK)
    M.add_bevel(bl, 0.006, 1)
    M.displace_noise(bl, strength=0.0055, scale=4.0, seed=3)
    parts.append(_mat(bl, "torchWood"))

    # A crossbar lashed on crooked — nobody squared it up, and one arm is
    # noticeably longer than the other.
    bar = _bar_x("crossbar", [
        (-0.050, 0.012, 0.011, 0.006),
        (-0.024, 0.016, 0.015, 0.000),
        (0.000, 0.017, 0.016, 0.000),
        (0.040, 0.015, 0.014, 0.002),
        (0.082, 0.010, 0.009, 0.010),
    ])
    _bake(bar, loc=(0, 0, 0.036), rot=(0.0, 0.0, 0.10))
    parts.append(_mat(bar, "plank"))

    # The lashing holding it on.
    parts.append(_mat(_band("lash", 0.024, 0.050, 0.0215, seg=8, bulge=1.10),
                      "sackcloth"))

    g = _grip("grip", -0.120, 0.028, r0=0.019, r1=0.017, ridges=2.0, depth=0.05,
              segments=9)
    M.displace_noise(g, strength=0.0025, scale=6.0, seed=7)
    parts.append(_mat(g, "torchWood"))

    wrap = _ferrule("wrap", -0.075, -0.020, 0.0205, 0.0205, seg=9, flare=1.05)
    parts.append(_mat(wrap, "leather"))

    knob = _disc("knob", -0.128, 0.024, 0.030, seg=9)
    M.displace_noise(knob, strength=0.003, scale=5.0, seed=11)
    parts.append(_mat(knob, "torchWood"))

    _finish(parts, "wpn_wooden_sword")


def wooden_staff():
    """木棍 — a quarterstaff. Straight-ish, tapered, hand-worn in the middle."""
    parts = []

    prof = [(0.0, -0.34)]
    steps = 13
    for i in range(steps):
        t = i / (steps - 1)
        z = -0.34 + 1.86 * t
        # thick at the butt, thinning toward the far end, with growth rings
        r = 0.026 * (1.0 - 0.34 * t) * (1.0 + 0.05 * math.sin(t * 11.0))
        prof.append((r, z))
    prof.append((0.0, 1.52))
    shaft = M.lathe("shaft", prof, segments=10, smooth=True)
    M.displace_noise(shaft, strength=0.0035, scale=3.0, seed=5)
    parts.append(_mat(shaft, "torchWood"))

    for i, (z0, z1) in enumerate(((-0.055, 0.045), (0.075, 0.135))):
        w = _ferrule(f"wrap{i}", z0, z1, 0.0275, 0.0270, seg=10, flare=1.03)
        parts.append(_mat(w, "leather"))

    # A stub where a branch was cut off — kills the perfect-dowel read.
    stub = _spike("stub", 0.0, 0.055, 0.016, seg=6, curve=0.02)
    _bake(stub, loc=(0.024, 0.0, 0.72), rot=(0.0, math.radians(72), 0.0))
    parts.append(_mat(stub, "torchWood"))

    cap = _ferrule("buttcap", -0.345, -0.295, 0.0255, 0.0275, seg=10)
    parts.append(_mat(cap, "iron"))

    _finish(parts, "wpn_wooden_staff")


# ===========================================================================
#                                                    T I E R   2 :  metal
# ===========================================================================

def bronze_sword():
    """铜剑 — a cast bronze leaf-blade jian. Wide belly, short reach."""
    parts = []
    parts += _plain_hilt(metal="bronze", z_bot=-0.120, z_top=0.070,
                         grip_r=0.0165, pommel_r=0.029, pommel_h=0.044)

    guard = _bar_x("guard", [
        (-0.058, 0.010, 0.009, 0.010),
        (-0.036, 0.014, 0.012, 0.003),
        (-0.014, 0.017, 0.014, 0.000),
        (0.014, 0.017, 0.014, 0.000),
        (0.036, 0.014, 0.012, 0.003),
        (0.058, 0.010, 0.009, 0.010),
    ])
    _bake(guard, loc=(0, 0, 0.086))
    parts.append(_mat(guard, "bronze"))

    secs = [
        (0.084, 0.027, 0.0090),
        (0.150, 0.038, 0.0094),
        (0.250, 0.046, 0.0092),
        (0.360, 0.049, 0.0086),
        (0.470, 0.046, 0.0076),
        (0.570, 0.038, 0.0064),
        (0.660, 0.026, 0.0052),
        (0.725, 0.013, 0.0038),
        (0.760, 0.005, 0.0026),
    ]
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "bronze"))

    rib = _fuller("rib", 0.095, 0.660, 0.010, 0.0104)
    parts.append(_mat(rib, "bronze"))

    _finish(parts, "wpn_bronze_sword")


def iron_sword():
    """铁剑 — the honest cruciform arming sword. Longer, straighter, plainer."""
    parts = []
    parts += _plain_hilt(metal="iron", z_bot=-0.135, z_top=0.080,
                         grip_r=0.0170, pommel_r=0.032, pommel_h=0.050)

    guard = _bar_x("guard", [
        (-0.088, 0.009, 0.008, 0.014),
        (-0.060, 0.013, 0.011, 0.006),
        (-0.028, 0.017, 0.015, 0.000),
        (0.000, 0.019, 0.016, -0.001),
        (0.028, 0.017, 0.015, 0.000),
        (0.060, 0.013, 0.011, 0.006),
        (0.088, 0.009, 0.008, 0.014),
    ])
    _bake(guard, loc=(0, 0, 0.096))
    parts.append(_mat(guard, "iron"))

    secs = [
        (0.092, 0.031, 0.0092),
        (0.200, 0.033, 0.0090),
        (0.330, 0.032, 0.0084),
        (0.460, 0.030, 0.0077),
        (0.590, 0.028, 0.0069),
        (0.700, 0.025, 0.0060),
        (0.790, 0.019, 0.0050),
        (0.855, 0.010, 0.0036),
        (0.885, 0.004, 0.0024),
    ]
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "iron"))

    rib = _fuller("fuller", 0.110, 0.720, 0.011, 0.0100)
    parts.append(_mat(rib, "iron"))

    _finish(parts, "wpn_iron_sword")


def ebony_sword():
    """
    乌木剑 — ebony furniture over a narrow blade.

    Distinguished from 铁剑 by an angular, squared-off block guard and a long
    hexagonal wooden grip banded in bronze: a straight-edged silhouette against
    everything else's curves.
    """
    parts = []

    p = _blade("pommel", [
        (-0.152, 0.030, 0.020),
        (-0.140, 0.036, 0.026),
        (-0.118, 0.032, 0.023),
        (-0.108, 0.024, 0.017),
    ], cross=SLAB, smooth=False)
    parts.append(_mat(p, "bronze"))

    g = _blade("grip", [
        (-0.112, 0.021, 0.017),
        (-0.070, 0.022, 0.018),
        (-0.020, 0.023, 0.018),
        (0.030, 0.022, 0.017),
        (0.066, 0.020, 0.016),
    ], cross=SLAB, smooth=False)
    parts.append(_mat(g, "torchWood"))

    for i, z in enumerate((-0.086, -0.030, 0.026)):
        b = _blade(f"band{i}", [
            (z - 0.008, 0.0245, 0.0195),
            (z + 0.008, 0.0245, 0.0195),
        ], cross=SLAB, smooth=False)
        parts.append(_mat(b, "bronze"))

    # Squared block guard, deliberately wider on one side.
    guard = _blade("guard", [
        (0.068, 0.052, 0.024),
        (0.086, 0.066, 0.026),
        (0.104, 0.062, 0.024),
        (0.116, 0.040, 0.019),
    ], cross=SLAB, smooth=False)
    parts.append(_mat(guard, "torchWood"))

    lip = _bar_x("lip", [
        (-0.068, 0.011, 0.026, 0.0),
        (-0.030, 0.014, 0.028, 0.0),
        (0.030, 0.014, 0.028, 0.0),
        (0.068, 0.011, 0.026, 0.0),
    ], cross=SLAB)
    _bake(lip, loc=(0, 0, 0.090))
    parts.append(_mat(lip, "bronze"))

    secs = [
        (0.112, 0.024, 0.0088),
        (0.200, 0.026, 0.0086),
        (0.330, 0.026, 0.0080),
        (0.470, 0.025, 0.0073),
        (0.610, 0.024, 0.0065),
        (0.730, 0.022, 0.0056),
        (0.820, 0.018, 0.0046),
        (0.880, 0.009, 0.0032),
        (0.905, 0.004, 0.0022),
    ]
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "iron"))

    # A narrow bronze inlay down the blade and a squared ricasso block: the
    # ebony sword is austere, not empty.
    parts.append(_mat(_fuller("inlay", 0.130, 0.780, 0.0060, 0.0098, steps=5),
                      "bronze"))
    ric = _blade("ricasso", [
        (0.112, 0.030, 0.0112),
        (0.148, 0.034, 0.0118),
        (0.182, 0.028, 0.0106),
    ], cross=SLAB, smooth=False)
    parts.append(_mat(ric, "bronze"))

    _finish(parts, "wpn_ebony_sword")


def bluesky():
    """
    三尺青锋 — three feet of blue steel.

    The elegant one: very long, very slender, gold-fitted, with the shallow
    swept 山-shaped guard of a Chinese jian. Reads as a line, not a wedge.
    """
    parts = []

    p = _disc("pommel", -0.128, 0.026, 0.042, seg=12, waist=0.5, dome=0.85)
    parts.append(_mat(p, "gold"))
    cap = _ferrule("pcap", -0.108, -0.092, 0.019, 0.0175, seg=12)
    parts.append(_mat(cap, "gold"))

    g = _grip("grip", -0.098, 0.062, r0=0.0155, r1=0.0165, ridges=5.0,
              depth=0.06, segments=12)
    parts.append(_mat(g, "silk"))

    for i, z in enumerate((-0.062, -0.006, 0.046)):
        b = _ferrule(f"band{i}", z - 0.007, z + 0.007, 0.0178, 0.0178, seg=12)
        parts.append(_mat(b, "gold"))

    # Swept guard: quillons rise toward the blade instead of hanging, and reach
    # far enough that the 山 shape survives a 26-unit camera.
    guard = _bar_x("guard", [
        (-0.092, 0.009, 0.008, 0.046),
        (-0.070, 0.012, 0.011, 0.026),
        (-0.040, 0.016, 0.015, 0.006),
        (-0.014, 0.019, 0.017, -0.001),
        (0.014, 0.019, 0.017, -0.001),
        (0.040, 0.016, 0.015, 0.006),
        (0.070, 0.012, 0.011, 0.026),
        (0.092, 0.009, 0.008, 0.046),
    ])
    _bake(guard, loc=(0, 0, 0.078))
    parts.append(_mat(guard, "gold"))

    secs = [
        (0.086, 0.024, 0.0072),
        (0.210, 0.025, 0.0070),
        (0.360, 0.024, 0.0066),
        (0.520, 0.023, 0.0060),
        (0.680, 0.022, 0.0053),
        (0.830, 0.020, 0.0045),
        (0.940, 0.016, 0.0037),
        (1.010, 0.008, 0.0026),
        (1.040, 0.003, 0.0018),
    ]
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "steel"))

    rib = _fuller("fuller", 0.100, 0.900, 0.0085, 0.0080)
    parts.append(_mat(rib, "steel"))

    _finish(parts, "wpn_bluesky")


def dagger():
    """短剑 — short, broad at the base, unmistakably small next to everything."""
    parts = []
    parts += _plain_hilt(metal="steel", z_bot=-0.090, z_top=0.052,
                         grip_r=0.0155, pommel_r=0.024, pommel_h=0.034, seg=10)

    guard = _bar_x("guard", [
        (-0.040, 0.008, 0.008, 0.006),
        (-0.018, 0.012, 0.012, 0.000),
        (0.018, 0.012, 0.012, 0.000),
        (0.040, 0.008, 0.008, 0.006),
    ])
    _bake(guard, loc=(0, 0, 0.062))
    parts.append(_mat(guard, "steel"))

    secs = [
        (0.058, 0.028, 0.0080),
        (0.110, 0.031, 0.0078),
        (0.180, 0.029, 0.0070),
        (0.250, 0.024, 0.0060),
        (0.305, 0.015, 0.0046),
        (0.335, 0.006, 0.0030),
    ]
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "steel"))
    parts.append(_mat(_fuller("rib", 0.066, 0.250, 0.009, 0.0086), "steel"))

    _finish(parts, "wpn_dagger")


# ===========================================================================
#                                            T I E R   3 :  named blades
# ===========================================================================

def crescent():
    """
    偃月 — the crescent saber.

    A single-edged dao with a real belly-curve and a pierced crescent-moon
    disc guard. The curve plus the ring guard is the whole silhouette.
    """
    parts = []

    # Crescent guard: outer arc minus an offset inner arc, extruded thin.
    pts = []
    n = 11
    for i in range(n):
        a = math.radians(-118 + 236 * i / (n - 1))
        pts.append((math.sin(a) * 0.074, -math.cos(a) * 0.074))
    for i in range(n - 1, -1, -1):
        a = math.radians(-104 + 208 * i / (n - 1))
        pts.append((math.sin(a) * 0.046 + 0.008, -math.cos(a) * 0.046 - 0.006))
    guard = M.extrude_profile("guard", pts, 0.014, bevel=0.004)
    _bake(guard, loc=(0, -0.007, 0.062))
    parts.append(_mat(guard, "bronze"))

    p = _disc("pommel", -0.128, 0.028, 0.044, seg=10)
    parts.append(_mat(p, "bronze"))
    g = _grip("grip", -0.108, 0.058, r0=0.0165, r1=0.0180, ridges=4.0,
              segments=10)
    parts.append(_mat(g, "leather"))
    c = _ferrule("collar", 0.058, 0.086, 0.0215, 0.0235, seg=10)
    parts.append(_mat(c, "bronze"))

    # Curved single edge. x_offset traces the arc; the tip is clipped back
    # toward the spine the way a real dao is.
    secs = []
    steps = 10
    for i in range(steps):
        t = i / (steps - 1)
        z = 0.088 + 0.760 * t
        curve = 0.150 * (t ** 1.75)
        w = 0.036 + 0.016 * math.sin(t * 2.3) - 0.030 * max(0.0, t - 0.80) * 5.0
        th = 0.0100 - 0.0056 * t
        secs.append((z, max(0.004, w), max(0.0022, th), curve))
    bl = _blade("blade", secs, cross=SINGLE)
    parts.append(_mat(bl, "steel"))

    spine = _fuller("spine", 0.100, 0.760, 0.0090, 0.0090, steps=6, x_off=0.020)
    parts.append(_mat(spine, "steel"))

    _finish(parts, "wpn_crescent")


def dragon_sword():
    """
    龙纹剑 — dragon-pattern sword.

    Gold dragon-jaw quillons that sweep forward and swallow the ricasso, plus a
    scaled collar. A straight steel blade with a wave-patterned edge so the
    outline ripples slightly instead of running dead parallel.
    """
    parts = []

    p = _disc("pommel", -0.140, 0.031, 0.050, seg=12)
    parts.append(_mat(p, "gold"))
    g = _grip("grip", -0.116, 0.070, r0=0.0170, r1=0.0180, ridges=5.0,
              segments=12)
    parts.append(_mat(g, "leather"))
    c = _ferrule("collar", 0.070, 0.098, 0.0215, 0.0245, seg=12)
    parts.append(_mat(c, "gold"))

    # Jaw quillons — swept forward and up the blade, one longer than the other,
    # big enough to actually read as a dragon's head from across the screen.
    for side, reach in ((-1, 0.112), (1, 0.126)):
        jaw = _bar_x(f"jaw{side}", [
            (0.000, 0.026, 0.022, 0.006),
            (reach * 0.32, 0.024, 0.019, 0.004),
            (reach * 0.60, 0.020, 0.015, 0.020),
            (reach * 0.84, 0.014, 0.010, 0.055),
            (reach * 1.00, 0.006, 0.005, 0.086),
        ])
        _bake(jaw, loc=(0, 0, 0.100), scale=(side, 1, 1))
        parts.append(_mat(jaw, "gold"))

    # Fangs biting down over the ricasso.
    for i, side in enumerate((-1, 1)):
        f = _spike(f"fang{i}", 0.0, 0.062, 0.010, seg=5, curve=0.016)
        _bake(f, loc=(side * 0.034, 0.0, 0.112), rot=(0, math.radians(-22 * side), 0))
        parts.append(_mat(f, "bone"))

    # Horns sweeping back over the grip — the profile that says 龙纹.
    for i, side in enumerate((-1, 1)):
        h = _spike(f"horn{i}", 0.0, 0.070, 0.011, seg=5, curve=0.022)
        _bake(h, loc=(side * 0.026, 0.0, 0.092),
              rot=(0, math.radians(side * 152), 0))
        parts.append(_mat(h, "gold"))

    secs = []
    steps = 11
    for i in range(steps):
        t = i / (steps - 1)
        z = 0.114 + 0.800 * t
        w = 0.033 * (1.0 - 0.42 * t) * (1.0 + 0.10 * math.sin(t * 9.0))
        if t > 0.90:
            w *= (1.0 - t) * 10.0 * 0.55 + 0.05
        secs.append((z, max(0.004, w), 0.0098 - 0.0064 * t))
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "steel"))

    rib = _fuller("fuller", 0.130, 0.790, 0.0105, 0.0104, steps=6)
    parts.append(_mat(rib, "gold"))

    _finish(parts, "wpn_dragon_sword")


def bloodlust():
    """
    血饮 — blood-drinker.

    Wicked and lopsided: one clean edge, one edge with a hook barb near the
    base and a second bite near the tip, a dark iron body and a red channel
    running the length of it. Hangs heavier on one side on purpose.
    """
    parts = []

    p = _disc("pommel", -0.134, 0.030, 0.046, seg=10)
    parts.append(_mat(p, "ironRusted"))
    g = _grip("grip", -0.112, 0.062, r0=0.0170, r1=0.0185, ridges=3.0,
              segments=10)
    parts.append(_mat(g, "leather"))

    # Two downward fangs instead of a crossguard, different lengths.
    for i, (side, ln, tilt) in enumerate(((-1, 0.070, 24), (1, 0.052, 34))):
        f = _spike(f"fang{i}", 0.0, ln, 0.013, seg=7, curve=-0.014)
        _bake(f, loc=(side * 0.020, 0.0, 0.070),
              rot=(0, math.radians(side * (180 - tilt)), 0))
        parts.append(_mat(f, "bone"))

    c = _ferrule("collar", 0.062, 0.092, 0.0215, 0.0250, seg=10)
    parts.append(_mat(c, "ironRusted"))

    # Asymmetric outline: the -x edge grows barbs, the +x edge stays clean.
    secs = [
        (0.096, 0.030, 0.0105, 0.004),
        (0.150, 0.046, 0.0104, -0.008),   # base barb
        (0.190, 0.034, 0.0100, 0.002),
        (0.300, 0.036, 0.0095, 0.000),
        (0.420, 0.037, 0.0088, -0.002),
        (0.540, 0.036, 0.0079, -0.004),
        (0.640, 0.048, 0.0070, -0.014),   # second bite
        (0.690, 0.032, 0.0064, -0.002),
        (0.780, 0.026, 0.0053, -0.004),
        (0.850, 0.014, 0.0038, -0.008),
        (0.882, 0.005, 0.0025, -0.010),
    ]
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "iron"))

    # The channel the name is about.
    ch = _fuller("channel", 0.110, 0.800, 0.0090, 0.0116, steps=7, x_off=0.006)
    parts.append(_mat(ch, "scaleRed"))

    _finish(parts, "wpn_bloodlust")


def asura():
    """
    修罗 — Asura.

    Demonic and deliberately unbalanced: a saw of three descending barbs down
    the back, a flared cleaver tip, and a single oversized wing quillon on one
    side answered by a stub on the other.
    """
    parts = []

    p = _disc("pommel", -0.146, 0.030, 0.052, seg=10, dome=1.0)
    parts.append(_mat(p, "ironRusted"))
    g = _grip("grip", -0.120, 0.066, r0=0.0175, r1=0.0190, ridges=3.5,
              segments=10)
    parts.append(_mat(g, "leather"))

    # One big wing, one stub. This is the asymmetry that names the weapon.
    wing = _bar_x("wing", [
        (0.000, 0.024, 0.020, 0.004),
        (0.034, 0.026, 0.016, -0.006),
        (0.066, 0.024, 0.012, -0.022),
        (0.094, 0.017, 0.008, -0.046),
        (0.112, 0.008, 0.004, -0.070),
    ], cross=SLAB)
    _bake(wing, loc=(0, 0, 0.088), rot=(math.radians(8), 0, 0))
    parts.append(_mat(wing, "bone"))

    stub = _bar_x("stub", [
        (0.000, 0.022, 0.018, 0.004),
        (-0.026, 0.020, 0.014, -0.004),
        (-0.046, 0.013, 0.008, -0.018),
        (-0.056, 0.006, 0.004, -0.030),
    ], cross=SLAB)
    _bake(stub, loc=(0, 0, 0.088))
    parts.append(_mat(stub, "bone"))

    c = _ferrule("collar", 0.064, 0.098, 0.0220, 0.0265, seg=10)
    parts.append(_mat(c, "ironRusted"))

    # Three barbs down the spine, decreasing, then a flare into the tip.
    secs = [
        (0.104, 0.030, 0.0112, 0.006),
        (0.170, 0.041, 0.0108, 0.011),
        (0.215, 0.030, 0.0104, 0.001),
        (0.320, 0.040, 0.0098, 0.010),
        (0.365, 0.030, 0.0094, 0.001),
        (0.470, 0.038, 0.0086, 0.009),
        (0.515, 0.030, 0.0082, 0.001),
        (0.620, 0.032, 0.0074, 0.002),
        (0.720, 0.044, 0.0064, 0.010),   # cleaver flare
        (0.800, 0.040, 0.0054, 0.004),
        (0.862, 0.020, 0.0040, -0.010),
        (0.895, 0.006, 0.0026, -0.018),
    ]
    bl = _blade("blade", secs, cross=SINGLE)
    parts.append(_mat(bl, "iron"))

    ridge = _fuller("ridge", 0.120, 0.780, 0.0088, 0.0122, steps=7, x_off=0.014)
    parts.append(_mat(ridge, "ironRusted"))

    _finish(parts, "wpn_asura")


def serpent():
    """
    银蛇 — silver serpent.

    A flamberge: the edge waves down its whole length so the outline reads as a
    snake even in a thumbnail, and the pommel is a serpent's head with lit eyes.
    """
    parts = []

    g = _grip("grip", -0.052, 0.064, r0=0.0160, r1=0.0170, ridges=6.0,
              depth=0.10, segments=10)
    parts.append(_mat(g, "leather"))

    # Serpent head pommel, tilted so it looks back over the hand.
    head = _blade("head", [
        (-0.146, 0.014, 0.011),
        (-0.132, 0.022, 0.019),
        (-0.112, 0.026, 0.023),
        (-0.088, 0.024, 0.021),
        (-0.064, 0.019, 0.017),
        (-0.050, 0.016, 0.014),
    ], cross=OVAL, smooth=True)
    _bake(head, rot=(math.radians(10), 0, 0))
    parts.append(_mat(head, "steel"))

    jaw = _blade("jaw", [
        (-0.150, 0.008, 0.006),
        (-0.128, 0.016, 0.009),
        (-0.104, 0.018, 0.008),
    ], cross=OVAL, smooth=True)
    _bake(jaw, loc=(0, 0.014, 0.004), rot=(math.radians(20), 0, 0))
    parts.append(_mat(jaw, "steel"))

    for i, side in enumerate((-1, 1)):
        e = M.sphere(f"eye{i}", 0.0060, location=(side * 0.017, -0.010, -0.112),
                     segments=6, rings=4)
        parts.append(_mat(e, "eye.glow"))

    # Hood: flared collar where the head meets the grip.
    hood = _bar_x("hood", [
        (-0.062, 0.020, 0.007, -0.006),
        (-0.034, 0.026, 0.011, -0.012),
        (0.000, 0.028, 0.013, -0.014),
        (0.034, 0.026, 0.011, -0.012),
        (0.062, 0.020, 0.007, -0.006),
    ], cross=SLAB)
    _bake(hood, loc=(0, 0, 0.086))
    parts.append(_mat(hood, "steel"))

    secs = []
    steps = 15
    for i in range(steps):
        t = i / (steps - 1)
        z = 0.098 + 0.860 * t
        wave = 0.020 * math.sin(t * 8.4) * (1.0 - 0.45 * t)
        w = 0.027 * (1.0 - 0.30 * t)
        if t > 0.88:
            w *= (1.0 - t) / 0.12 * 0.85 + 0.06
        secs.append((z, max(0.004, w), 0.0086 - 0.0056 * t, wave))
    bl = _blade("blade", secs)
    parts.append(_mat(bl, "steel"))

    _finish(parts, "wpn_serpent")


def dragonslayer():
    """
    屠龙 — Dragonslayer.

    The one everyone recognises. A slab of iron roughly the size of a door: 1.4
    units of blade, 0.30 wide at the ricasso, 0.10 thick, with an angular
    chopped tip. A fanged crossguard, a dragon's head worked into the ricasso,
    and a two-handed grip long enough to justify the mass.

    Everything about it is oversized relative to the rest of the ladder, which
    is the point — at game camera distance you should be able to tell 屠龙 from
    every other weapon by outline alone.
    """
    parts = []

    # --- two-handed hilt --------------------------------------------------
    pommel = _blade("pommel", [
        (-0.330, 0.040, 0.030),
        (-0.300, 0.062, 0.048),
        (-0.262, 0.050, 0.038),
        (-0.240, 0.036, 0.026),
    ], cross=SLAB, smooth=False)
    parts.append(_mat(pommel, "gold"))

    for i, side in enumerate((-1, 1)):
        s = _spike(f"pspike{i}", 0.0, 0.052, 0.014, seg=5)
        _bake(s, loc=(side * 0.052, 0.0, -0.292),
              rot=(0, math.radians(side * 96), 0))
        parts.append(_mat(s, "gold"))

    g = _grip("grip", -0.248, 0.052, r0=0.0225, r1=0.0245, ridges=7.0,
              depth=0.07, segments=10)
    parts.append(_mat(g, "leather"))

    for i, z in enumerate((-0.196, -0.104, -0.012)):
        b = _band(f"band{i}", z - 0.011, z + 0.011, 0.0258, seg=10)
        parts.append(_mat(b, "gold"))

    # --- fanged crossguard ------------------------------------------------
    guard = _bar_x("guard", [
        (-0.185, 0.016, 0.014, 0.030),
        (-0.130, 0.027, 0.025, 0.008),
        (-0.045, 0.037, 0.035, -0.005),
        (0.045, 0.037, 0.035, -0.005),
        (0.130, 0.027, 0.025, 0.008),
        (0.185, 0.016, 0.014, 0.030),
    ], cross=SLAB)
    _bake(guard, loc=(0, 0, 0.096))
    parts.append(_mat(guard, "iron"))

    for i, (x, ln, r) in enumerate(((-0.150, 0.086, 0.016),
                                    (-0.078, 0.062, 0.013),
                                    (0.078, 0.058, 0.013),
                                    (0.150, 0.092, 0.017))):
        f = _spike(f"gfang{i}", 0.0, ln, r, seg=5, curve=0.016)
        _bake(f, loc=(x, 0.0, 0.074),
              rot=(0, math.radians(180 + (14 if x < 0 else -14)), 0))
        parts.append(_mat(f, "bone"))

    # --- ricasso with the dragon motif ------------------------------------
    ric = _blade("ricasso", [
        (0.118, 0.070, 0.042),
        (0.156, 0.104, 0.046),
        (0.230, 0.110, 0.042),
        (0.290, 0.086, 0.034),
    ], cross=SLAB, smooth=False)
    parts.append(_mat(ric, "iron"))

    # Dragon head worked into the ricasso face, snout up the blade. It sits
    # half-sunk into the slab and stands about 25mm proud, which is enough to
    # catch a rim light at game distance without spending a rig's worth of tris.
    # One face only — like a real maker's crest, and the budget says so.
    snout = _blade("dsnout", [
        (0.146, 0.030, 0.014, 0.0, -0.040),
        (0.180, 0.040, 0.022, 0.0, -0.046),
        (0.216, 0.038, 0.025, 0.0, -0.048),
        (0.250, 0.028, 0.019, 0.0, -0.044),
        (0.272, 0.013, 0.010, 0.0, -0.038),
    ], cross=OVAL, smooth=True)
    parts.append(_mat(snout, "gold"))

    jaw = _blade("djaw", [
        (0.150, 0.026, 0.010, 0.006, -0.056),
        (0.196, 0.030, 0.013, 0.004, -0.062),
        (0.238, 0.022, 0.009, 0.002, -0.058),
    ], cross=OVAL, smooth=True)
    parts.append(_mat(jaw, "gold"))

    for i, (side, sweep) in enumerate(((-1, 0.026), (1, 0.032))):
        h = _spike(f"dhorn{i}", 0.0, 0.078, 0.011, seg=4, curve=sweep)
        _bake(h, loc=(side * 0.028, -0.040, 0.244),
              rot=(0.0, math.radians(side * 132), 0.0))
        parts.append(_mat(h, "gold"))
        e = M.sphere(f"deye{i}", 0.0090,
                     location=(side * 0.024, -0.058, 0.222),
                     segments=5, rings=3, scale=(1.0, 0.7, 1.0))
        parts.append(_mat(e, "eye.glow"))

    # --- the slab ---------------------------------------------------------
    secs = [
        (0.286, 0.128, 0.0270),
        (0.420, 0.146, 0.0262),
        (0.600, 0.152, 0.0248),
        (0.800, 0.150, 0.0230),
        (1.000, 0.146, 0.0208),
        (1.180, 0.140, 0.0186),
        (1.330, 0.130, 0.0166),
        (1.440, 0.116, 0.0148, 0.014),
        (1.510, 0.086, 0.0126, 0.034),   # chopped angular tip
        (1.552, 0.036, 0.0092, 0.058),
        (1.570, 0.010, 0.0060, 0.070),
    ]
    bl = _blade("slab", secs, cross=SLAB)
    parts.append(_mat(bl, "iron"))

    # Twin fullers, offset off-centre so the slab is not mirror-perfect.
    parts.append(_mat(_fuller("f1", 0.320, 1.300, 0.020, 0.0300, steps=3,
                              x_off=-0.052), "iron"))
    parts.append(_mat(_fuller("f2", 0.320, 1.180, 0.017, 0.0296, steps=3,
                              x_off=0.058), "iron"))

    # Ricasso plates riveted over the base of the slab.
    plate = _blade("plate", [
        (0.300, 0.116, 0.0320),
        (0.372, 0.122, 0.0324),
        (0.452, 0.068, 0.0300),
    ], cross=SLAB, smooth=False)
    parts.append(_mat(plate, "gold"))

    _finish(parts, "wpn_dragonslayer")


# ===========================================================================
#                                                  T I E R   3 :  staves
# ===========================================================================

def bone_staff():
    """
    骨玉权杖 — bone-and-jade sceptre.

    Bone white and organic: a shaft that grows in irregular vertebral nodes,
    two ribs curling up to cradle a crystal orb, and a gold band where a hand
    would have worn it smooth.
    """
    parts = []

    # Vertebral shaft — radius pulses at every node, and the nodes are not
    # evenly spaced, because bone isn't turned on a lathe.
    prof = [(0.0, -0.30)]
    steps = 16
    for i in range(steps):
        t = i / (steps - 1)
        z = -0.30 + 1.42 * t
        base = 0.022 * (1.0 - 0.18 * t)
        knot = 1.0 + 0.34 * max(0.0, math.sin(t * 9.6 + 0.6)) ** 3
        prof.append((base * knot, z))
    prof.append((0.0, 1.12))
    shaft = M.lathe("shaft", prof, segments=9, smooth=True)
    parts.append(_mat(shaft, "bone"))

    grip = _band("gripwrap", -0.070, 0.070, 0.0245, seg=9, bulge=1.02)
    parts.append(_mat(grip, "leather"))
    for i, z in enumerate((-0.078, 0.078)):
        b = _band(f"band{i}", z - 0.011, z + 0.011, 0.0255, seg=9)
        parts.append(_mat(b, "gold"))

    # Two ribs curling up and inward around the orb — different sweeps, so the
    # cradle is organic rather than a pair of tongs.
    # Ribs sweeping wide before curling back over the orb. They have to bow out
    # far enough to punch a hole of daylight into the silhouette, otherwise the
    # head just reads as a lump on a stick.
    for i, (side, sweep, top) in enumerate(((-1, 0.150, 1.372), (1, 0.126, 1.330))):
        rings = []
        n = 8
        for k in range(n):
            t = k / (n - 1)
            z = 1.03 + (top - 1.03) * t
            x = side * sweep * math.sin(t * math.pi * 0.86)
            y = side * 0.018 * math.sin(t * math.pi)
            r = 0.017 * (1.0 - 0.60 * t)
            rings.append([(math.cos(TAU * s / 5) * r * 1.25 + x,
                           math.sin(TAU * s / 5) * r * 1.7 + y, z)
                          for s in range(5)])
        rib = _hull(f"rib{i}", rings, smooth=True)
        parts.append(_mat(rib, "bone"))

    orb = M.sphere("orb", 0.062, location=(0.0, 0.0, 1.208), segments=10, rings=6,
                   scale=(1.0, 0.94, 1.06))
    parts.append(_mat(orb, "crystal"))

    seat = _disc("seat", 1.120, 0.040, 0.048, seg=9, dome=0.7)
    parts.append(_mat(seat, "gold"))

    # Small teeth around the seat.
    for i in range(5):
        a = TAU * i / 5 + 0.4
        t_ = _spike(f"tooth{i}", 0.0, 0.040, 0.009, seg=4)
        _bake(t_, loc=(math.cos(a) * 0.036, math.sin(a) * 0.036, 1.128),
              rot=(math.radians(34) * math.sin(a), math.radians(-34) * math.cos(a), 0))
        parts.append(_mat(t_, "bone"))

    butt = _spike("butt", 0.0, 0.10, 0.020, seg=7)
    _bake(butt, loc=(0, 0, -0.298), rot=(0, math.pi, 0))
    parts.append(_mat(butt, "bone"))

    _finish(parts, "wpn_bone_staff")


def dragon_tooth():
    """
    龙牙 — Dragon Tooth.

    Literally a tooth: a single heavy curved fang of bone, serrated along the
    inner curve, socketed into an iron root collar. Nothing else in the ladder
    has a silhouette that hooks like this.
    """
    parts = []

    g = _grip("grip", -0.124, 0.048, r0=0.0180, r1=0.0195, ridges=3.0,
              segments=10)
    parts.append(_mat(g, "leather"))
    p = _disc("pommel", -0.140, 0.030, 0.044, seg=10)
    parts.append(_mat(p, "iron"))

    collar = _ferrule("collar", 0.046, 0.116, 0.0230, 0.0340, seg=10, flare=1.05)
    parts.append(_mat(collar, "iron"))

    # Root prongs gripping the base of the fang.
    for i in range(4):
        a = TAU * i / 4 + 0.5
        pr = _spike(f"root{i}", 0.0, 0.086, 0.011, seg=5, curve=-0.010)
        _bake(pr, loc=(math.cos(a) * 0.030, math.sin(a) * 0.030, 0.104),
              rot=(math.radians(15) * math.sin(a), math.radians(-15) * math.cos(a), 0))
        parts.append(_mat(pr, "iron"))

    # The fang: thick at the root, curving hard, with a needle point.
    secs = []
    steps = 12
    for i in range(steps):
        t = i / (steps - 1)
        z = 0.100 + 0.760 * t
        curve = 0.230 * (t ** 2.0)
        w = 0.058 * (1.0 - t) ** 0.62 + 0.006
        th = 0.030 * (1.0 - t) ** 0.70 + 0.003
        secs.append((z, w, th, curve))
    fang = _blade("fang", secs, cross=SINGLE, smooth=True)
    parts.append(_mat(fang, "bone"))

    # Serrations on the inner curve.
    for i in range(5):
        t = 0.20 + 0.14 * i
        z = 0.100 + 0.760 * t
        x = 0.230 * (t ** 2.0) - (0.058 * (1.0 - t) ** 0.62 + 0.006) * 0.9
        s = _spike(f"serr{i}", 0.0, 0.030 - 0.004 * i, 0.011 - 0.001 * i, seg=5)
        _bake(s, loc=(x, 0.0, z), rot=(0, math.radians(-118), 0))
        parts.append(_mat(s, "bone"))

    _finish(parts, "wpn_dragon_tooth")


def soul_staff():
    """
    嗜魂法杖 — soul-devouring staff.

    A twisted dark shaft that opens into a claw of four iron talons holding a
    burning rune stone, with a skull slung beneath it. Reads as a caster's
    weapon from any angle.
    """
    parts = []

    prof = [(0.0, -0.28)]
    steps = 12
    for i in range(steps):
        t = i / (steps - 1)
        z = -0.28 + 1.42 * t
        r = 0.023 * (1.0 - 0.20 * t) * (1.0 + 0.13 * math.sin(t * 11.0))
        prof.append((r, z))
    prof.append((0.0, 1.14))
    shaft = M.lathe("shaft", prof, segments=9, smooth=True)
    M.displace_noise(shaft, strength=0.0035, scale=4.0, seed=13)
    parts.append(_mat(shaft, "torchWood"))

    wrap = _band("wrap", -0.080, 0.080, 0.0250, seg=9, bulge=1.02)
    parts.append(_mat(wrap, "leather"))
    for i, z in enumerate((-0.090, 0.090, 0.560)):
        b = _band(f"band{i}", z - 0.011, z + 0.011, 0.0258, seg=9)
        parts.append(_mat(b, "iron"))

    cup = _ferrule("cup", 1.060, 1.150, 0.0300, 0.0480, seg=9, flare=1.1)
    parts.append(_mat(cup, "iron"))

    # Four talons, uneven, curling in over the stone.
    for i, (a, ln) in enumerate(((0.35, 0.150), (1.95, 0.132),
                                 (3.35, 0.156), (4.95, 0.138))):
        rings = []
        n = 6
        for k in range(n):
            t = k / (n - 1)
            z = 1.130 + ln * t
            rad = 0.050 + 0.030 * math.sin(t * math.pi * 0.85) - 0.030 * t * t
            r = 0.013 * (1.0 - 0.80 * t) + 0.002
            rings.append([(math.cos(TAU * s / 5) * r + math.cos(a) * rad,
                           math.sin(TAU * s / 5) * r + math.sin(a) * rad, z)
                          for s in range(5)])
        parts.append(_mat(_hull(f"talon{i}", rings, smooth=True), "iron"))

    stone = M.sphere("stone", 0.048, location=(0.0, 0.0, 1.198), segments=8,
                     rings=6, scale=(1.0, 1.0, 1.12))
    parts.append(_mat(stone, "rune"))

    # Skull slung under the claw.
    skull = M.sphere("skull", 0.046, location=(0.0, 0.0, 1.012), segments=9,
                     rings=6, scale=(0.86, 1.0, 0.92))
    parts.append(_mat(skull, "bone"))
    jaw = _blade("skulljaw", [
        (0.000, 0.030, 0.016),
        (0.030, 0.032, 0.019),
        (0.052, 0.024, 0.014),
    ], cross=OVAL, smooth=True)
    _bake(jaw, loc=(0.0, 0.026, 0.978), rot=(math.radians(-74), 0, 0))
    parts.append(_mat(jaw, "bone"))
    for i, side in enumerate((-1, 1)):
        e = M.sphere(f"socket{i}", 0.0125, location=(side * 0.019, 0.036, 1.020),
                     segments=5, rings=3)
        parts.append(_mat(e, "eye.glow"))

    butt = _ferrule("butt", -0.290, -0.240, 0.0220, 0.0270, seg=9)
    parts.append(_mat(butt, "iron"))

    _finish(parts, "wpn_soul_staff")


def judgement():
    """
    裁决之杖 — Judgement.

    A war staff, not a wand: a thick banded shaft and a crowned head of six
    heavy flanges over a squat drum. Top-heavy, blunt, and authoritative — the
    silhouette is a hammer, not a wand or a blade.
    """
    parts = []

    prof = [(0.0, -0.34)]
    steps = 6
    for i in range(steps):
        t = i / (steps - 1)
        z = -0.34 + 1.26 * t
        r = 0.031 + 0.006 * t
        prof.append((r, z))
    prof.append((0.0, 0.92))
    shaft = M.lathe("shaft", prof, segments=10, smooth=True)
    parts.append(_mat(shaft, "iron"))

    wrap = _band("wrap", -0.100, 0.110, 0.0335, seg=10, bulge=1.02)
    parts.append(_mat(wrap, "leather"))
    for i, z in enumerate((-0.112, 0.122, 0.420, 0.700)):
        b = _band(f"band{i}", z - 0.016, z + 0.016, 0.0345, seg=10)
        parts.append(_mat(b, "gold"))

    # Head: drum + crown.
    drum = M.lathe("drum", [
        (0.0, 0.905), (0.048, 0.908), (0.068, 0.965),
        (0.062, 1.052), (0.046, 1.078), (0.0, 1.078),
    ], segments=10, smooth=True)
    parts.append(_mat(drum, "steel"))

    # Six flanges — a mace crown. Each is a wedge plate standing off the drum.
    for i in range(6):
        a = TAU * i / 6 + 0.26
        fl = _blade(f"flange{i}", [
            (0.902, 0.032, 0.014),
            (0.960, 0.056, 0.018),
            (1.040, 0.050, 0.016),
            (1.086, 0.024, 0.012),
        ], cross=SLAB, smooth=False)
        _bake(fl, loc=(math.cos(a) * 0.056, math.sin(a) * 0.056, 0.0),
              rot=(0, 0, a + math.pi * 0.5))
        parts.append(_mat(fl, "steel"))

    # Crown ring + points on top.
    ring = _disc("crown", 1.096, 0.056, 0.036, seg=10, dome=0.95)
    parts.append(_mat(ring, "gold"))
    for i in range(6):
        a = TAU * i / 6 + 0.26
        s = _spike(f"point{i}", 0.0, 0.062 if i % 2 else 0.090, 0.013, seg=4)
        _bake(s, loc=(math.cos(a) * 0.040, math.sin(a) * 0.040, 1.108),
              rot=(math.radians(20) * math.sin(a), math.radians(-20) * math.cos(a), 0))
        parts.append(_mat(s, "gold"))
    finial = M.sphere("finial", 0.030, location=(0, 0, 1.164), segments=8, rings=5)
    parts.append(_mat(finial, "gold"))

    # Butt spike, so it reads as a weapon rather than a sceptre.
    spk = _spike("buttspike", 0.0, 0.120, 0.030, seg=8)
    _bake(spk, loc=(0, 0, -0.330), rot=(0, math.pi, 0))
    parts.append(_mat(spk, "steel"))

    _finish(parts, "wpn_judgement")


# ===========================================================================
#                                       T I E R   3 :  polearms & missiles
# ===========================================================================

def axe():
    """斧 — a broad-bitted felling axe: crescent bit one side, spike the other."""
    parts = []

    prof = [(0.0, -0.20)]
    steps = 9
    for i in range(steps):
        t = i / (steps - 1)
        z = -0.20 + 1.02 * t
        r = 0.021 + 0.007 * (1.0 - t) + 0.003 * math.sin(t * 7.0)
        prof.append((r, z))
    prof.append((0.0, 0.82))
    haft = M.lathe("haft", prof, segments=9, smooth=True)
    M.displace_noise(haft, strength=0.0025, scale=5.0, seed=17)
    parts.append(_mat(haft, "torchWood"))

    wrap = _ferrule("wrap", -0.060, 0.090, 0.0290, 0.0280, seg=9, flare=1.02)
    parts.append(_mat(wrap, "leather"))
    cap = _ferrule("buttcap", -0.205, -0.160, 0.0250, 0.0285, seg=9)
    parts.append(_mat(cap, "iron"))

    # Bit: a flat plate in the X/Z plane, extruded in Y. Outline is drawn in
    # (x = out from the haft, y = along the haft) then rotated upright.
    pts = [
        (0.020, -0.130), (0.090, -0.150), (0.160, -0.130),
        (0.215, -0.070), (0.232, 0.010), (0.208, 0.092),
        (0.150, 0.150), (0.082, 0.170), (0.026, 0.156),
        (0.014, 0.090), (0.010, 0.000), (0.014, -0.070),
    ]
    bit = M.extrude_profile("bit", pts, 0.026, bevel=0.008)
    _bake(bit, loc=(0.0, 0.013, 0.600), rot=(math.radians(90), 0, 0))
    parts.append(_mat(bit, "iron"))

    # Back spike.
    spike = M.extrude_profile("backspike", [
        (-0.020, -0.062), (-0.088, -0.036), (-0.126, 0.004),
        (-0.086, 0.044), (-0.020, 0.070),
    ], 0.022, bevel=0.006)
    _bake(spike, loc=(0.0, 0.011, 0.598), rot=(math.radians(90), 0, 0))
    parts.append(_mat(spike, "iron"))

    # Langets / socket wrapping the haft.
    for i, z in enumerate((0.480, 0.720)):
        b = _ferrule(f"socket{i}", z - 0.026, z + 0.026, 0.0300, 0.0300, seg=9,
                     flare=1.06)
        parts.append(_mat(b, "iron"))

    _finish(parts, "wpn_axe")


def spear():
    """长矛 — a long shaft, a narrow leaf head, a bronze collar and a butt spike."""
    parts = []

    prof = [(0.0, -0.36)]
    steps = 10
    for i in range(steps):
        t = i / (steps - 1)
        z = -0.36 + 1.86 * t
        r = 0.020 * (1.0 - 0.22 * t)
        prof.append((r, z))
    prof.append((0.0, 1.50))
    shaft = M.lathe("shaft", prof, segments=9, smooth=True)
    parts.append(_mat(shaft, "torchWood"))

    wrap = _ferrule("wrap", -0.070, 0.075, 0.0225, 0.0220, seg=9, flare=1.03)
    parts.append(_mat(wrap, "leather"))

    collar = _ferrule("collar", 1.470, 1.535, 0.0180, 0.0230, seg=9, flare=1.05)
    parts.append(_mat(collar, "bronze"))

    # Tassel ring below the head — the detail that says 长矛 and not "pole".
    for i in range(7):
        a = TAU * i / 7
        t_ = _blade(f"tassel{i}", [
            (0.000, 0.006, 0.005),
            (0.030, 0.008, 0.007),
            (0.062, 0.004, 0.003),
        ], cross=OVAL, smooth=True)
        _bake(t_, loc=(math.cos(a) * 0.022, math.sin(a) * 0.022, 1.468),
              rot=(math.radians(-166) + 0.2 * math.sin(a * 3), 0, a))
        parts.append(_mat(t_, "clothRed"))

    secs = [
        (1.520, 0.016, 0.0090),
        (1.560, 0.030, 0.0100),
        (1.620, 0.036, 0.0096),
        (1.700, 0.033, 0.0086),
        (1.770, 0.026, 0.0072),
        (1.822, 0.014, 0.0050),
        (1.848, 0.005, 0.0030),
    ]
    head = _blade("head", secs)
    parts.append(_mat(head, "iron"))
    parts.append(_mat(_fuller("rib", 1.530, 1.780, 0.0075, 0.0104), "iron"))

    butt = _spike("butt", 0.0, 0.090, 0.021, seg=8)
    _bake(butt, loc=(0, 0, -0.352), rot=(0, math.pi, 0))
    parts.append(_mat(butt, "bronze"))

    _finish(parts, "wpn_spear")


def bow():
    """
    弓 — a recurve bow.

    The stave runs along Z (the grip at the origin, the upper limb longer than
    the lower, as every real bow is), curving away in +X with the string
    strung flat between the nocks. Bone nocks and a leather-wrapped riser.
    """
    parts = []

    TIP_X, TOP, BOT = 0.116, 0.690, -0.610

    def limb_sections(z_end, n=9):
        secs = []
        for i in range(n):
            t = i / (n - 1)
            z = z_end * t
            f = abs(t)
            # quadratic sweep out to the string line, then a recurve flick
            x = TIP_X * (f ** 2.05) + 0.030 * max(0.0, f - 0.78) * 4.5
            hw = 0.0175 * (1.0 - 0.55 * f) + 0.0035          # thickness in X
            hh = 0.0250 * (1.0 - 0.62 * f) + 0.0055          # width in Y
            secs.append((z, hw, hh, x))
        return secs

    up = _blade("limbU", limb_sections(TOP), cross=OVAL, smooth=True)
    parts.append(_mat(up, "torchWood"))
    dn = _blade("limbD", limb_sections(BOT), cross=OVAL, smooth=True)
    parts.append(_mat(dn, "torchWood"))

    # Riser: thicker, with a shelf on one side.
    riser = _blade("riser", [
        (-0.130, 0.020, 0.024),
        (-0.090, 0.024, 0.030),
        (-0.020, 0.026, 0.033),
        (0.050, 0.025, 0.031),
        (0.110, 0.021, 0.026),
        (0.150, 0.018, 0.022),
    ], cross=OVAL, smooth=True)
    parts.append(_mat(riser, "torchWood"))

    shelf = _blade("shelf", [
        (0.070, 0.016, 0.010),
        (0.096, 0.026, 0.011),
        (0.116, 0.020, 0.009),
    ], cross=SLAB, smooth=False)
    _bake(shelf, loc=(0.020, 0.0, 0.0))
    parts.append(_mat(shelf, "bone"))

    wrap = _blade("gripwrap", [
        (-0.088, 0.028, 0.034),
        (-0.050, 0.030, 0.036),
        (0.010, 0.029, 0.035),
        (0.052, 0.026, 0.031),
    ], cross=OVAL, smooth=True)
    parts.append(_mat(wrap, "leather"))

    def nock_x(z_end):
        f = 1.0
        return TIP_X * (f ** 2.05) + 0.030 * max(0.0, f - 0.78) * 4.5

    for i, z_end in enumerate((TOP, BOT)):
        x = nock_x(z_end)
        n = _blade(f"nock{i}", [
            (0.000, 0.011, 0.014),
            (0.020, 0.013, 0.016),
            (0.040, 0.008, 0.010),
        ], cross=OVAL, smooth=True)
        _bake(n, loc=(x, 0.0, z_end - (0.032 if z_end > 0 else -0.032)),
              rot=(0, math.radians(-6 if z_end > 0 else 174), 0))
        parts.append(_mat(n, "bone"))

    # String: a thin four-sided prism between the nocks, plus a serving.
    sx = nock_x(TOP) + 0.006
    string = _blade("string", [
        (BOT - 0.020, 0.0022, 0.0022, sx),
        (-0.020, 0.0024, 0.0024, sx),
        (0.020, 0.0024, 0.0024, sx),
        (TOP + 0.024, 0.0022, 0.0022, sx),
    ], cross=PLANK, smooth=False)
    parts.append(_mat(string, "sackcloth"))

    serving = _blade("serving", [
        (-0.056, 0.0042, 0.0042, sx),
        (0.056, 0.0042, 0.0042, sx),
    ], cross=OVAL, smooth=True)
    parts.append(_mat(serving, "leather"))

    _finish(parts, "wpn_bow")


# ===========================================================================
#                                                     T I E R   3 :  shields
# ===========================================================================

def shield_wood():
    """
    木盾 — a planked round shield.

    A shallow dish of boards, slightly taller than wide, with an iron rim, a
    hammered boss, and two cross-battens. Noise on the boards keeps it from
    looking moulded. Face is +Z, grip at the origin.
    """
    parts = []

    RX, RY = 0.278, 0.306          # slightly taller than wide, like a real one

    def face_z(x, y):
        """Height of the dished board face at (x, y) — battens ride on this."""
        r = min(1.0, math.hypot(x / RX, y / RY))
        return 0.062 - 0.066 * (r ** 2.2)

    prof = [
        (0.000, 0.062), (0.070, 0.058), (0.140, 0.048), (0.205, 0.032),
        (0.255, 0.014), (0.278, -0.004), (0.278, -0.034), (0.250, -0.042),
        (0.150, -0.030), (0.060, -0.020), (0.000, -0.016),
    ]
    board = M.lathe("board", prof, segments=16, smooth=False)
    _bake(board, scale=(1.0, RY / RX, 1.0))
    M.displace_noise(board, strength=0.005, scale=3.0, seed=23)
    parts.append(_mat(board, "plank.worn"))

    # Plank seams — raised strips that follow the dish instead of floating off
    # it. Widths differ per board because nobody rives planks to a gauge.
    for i, (x, w) in enumerate(((-0.158, 0.0075), (-0.052, 0.0085),
                                (0.056, 0.0070), (0.162, 0.0080))):
        span = RY * math.sqrt(max(0.0, 1.0 - (x / RX) ** 2)) - 0.012
        path = []
        for k in range(5):
            t = -1.0 + 2.0 * k / 4
            y = span * t
            path.append((x, y, face_z(x, y) + 0.004))
        parts.append(_mat(_path_strip(f"seam{i}", path, w, w, cross=RIB),
                          "plank"))

    # Iron rim, swept round the (elliptical) edge.
    rim_path = []
    for k in range(17):
        a = TAU * k / 16
        rim_path.append((math.cos(a) * RX * 0.985, math.sin(a) * RY * 0.985,
                         face_z(math.cos(a) * RX, math.sin(a) * RY) - 0.008))
    parts.append(_mat(_path_strip("rim", rim_path, 0.020, 0.026, cross=SLAB),
                      "iron"))

    boss = M.lathe("boss", [
        (0.000, 0.118), (0.030, 0.112), (0.052, 0.092),
        (0.062, 0.062), (0.066, 0.040), (0.000, 0.038),
    ], segments=12, smooth=True)
    parts.append(_mat(boss, "iron"))

    # Two battens, deliberately not centred and not parallel.
    for i, (ang, off) in enumerate(((math.radians(84), -0.010),
                                    (math.radians(-8), 0.030))):
        path = []
        for k in range(5):
            t = -1.0 + 2.0 * k / 4
            L = 0.240 * t
            x = math.cos(ang) * L - math.sin(ang) * off
            y = math.sin(ang) * L + math.cos(ang) * off
            if math.hypot(x / RX, y / RY) > 0.96:
                L *= 0.9
                x = math.cos(ang) * L - math.sin(ang) * off
                y = math.sin(ang) * L + math.cos(ang) * off
            path.append((x, y, face_z(x, y) + 0.008))
        parts.append(_mat(_path_strip(f"batten{i}", path, 0.026, 0.010),
                          "plank"))

    handle = _blade("handle", [
        (-0.090, 0.016, 0.013),
        (0.000, 0.018, 0.015),
        (0.090, 0.016, 0.013),
    ], cross=OVAL, smooth=True)
    _bake(handle, loc=(0, 0, -0.022), rot=(0, math.radians(90), 0))
    parts.append(_mat(handle, "leather"))

    _finish(parts, "wpn_shield_wood")


def shield_iron():
    """
    铁盾 — a curved iron heater.

    Built as a lofted grid (rows of a horizontal arc, narrowing to a point at
    the bottom) then solidified, which gives a genuinely dished plate instead
    of a flat card. Riveted rim, a raised spine, and a steel boss.
    """
    parts = []

    n_rows, n_cols = 9, 7

    def outline(t):
        """Half-width of the heater at parameter t (0 = top, 1 = the point)."""
        return max(0.250 * (1.0 - t ** 2.6) ** 0.62, 0.004)

    def row_y(t):
        return 0.330 - 0.760 * t

    def dish_z(u, t):
        return 0.070 * (1.0 - u * u) * (1.0 - 0.35 * t) + 0.012 * (1.0 - t)

    rows = []
    for r in range(n_rows):
        t = r / (n_rows - 1)                      # 0 = top, 1 = bottom point
        y, half = row_y(t), outline(t)
        ring = []
        for c in range(n_cols):
            u = -1.0 + 2.0 * c / (n_cols - 1)
            ring.append((half * u, y, dish_z(u, t)))
        rows.append(ring)
    plate = M.loft("plate", rows, close=False, smooth=True)
    M.add_solidify(plate, thickness=0.022, offset=-1)
    M.add_bevel(plate, 0.006, 1)
    parts.append(_mat(plate, "iron"))

    # Raised central spine following the dish.
    spine_rings = []
    for r in range(n_rows):
        t = r / (n_rows - 1)
        y = 0.330 - 0.760 * t
        z = 0.070 * (1.0 - 0.35 * t) + 0.012 * (1.0 - t) + 0.012
        hw = 0.026 * (1.0 - 0.55 * t) + 0.004
        spine_rings.append([(u * hw, y + v * 0.010, z + v * 0.010)
                            for (u, v) in RIB])
    parts.append(_mat(_hull("spine", spine_rings, smooth=False), "steel"))

    # Rim: one continuous band swept round the whole outline — down the left
    # side, round the point, back up the right, across the top.
    rim_path = []
    for r in range(n_rows):
        t = r / (n_rows - 1)
        rim_path.append((-outline(t), row_y(t), dish_z(-1.0, t)))
    for r in range(n_rows - 2, -1, -1):
        t = r / (n_rows - 1)
        rim_path.append((outline(t), row_y(t), dish_z(1.0, t)))
    for c in range(n_cols - 2, 0, -1):
        u = -1.0 + 2.0 * c / (n_cols - 1)
        rim_path.append((outline(0.0) * u, row_y(0.0), dish_z(u, 0.0)))
    rim_path.append(rim_path[0])
    parts.append(_mat(_path_strip("rim", rim_path, 0.016, 0.024, cross=SLAB),
                      "steel"))

    boss = M.lathe("boss", [
        (0.000, 0.150), (0.028, 0.144), (0.048, 0.126),
        (0.058, 0.100), (0.062, 0.082), (0.000, 0.080),
    ], segments=12, smooth=True)
    _bake(boss, loc=(0.0, 0.030, -0.018))
    parts.append(_mat(boss, "steel"))

    for i in range(6):
        a = TAU * i / 6 + 0.3
        rv = M.sphere(f"rivet{i}", 0.0115,
                      location=(math.cos(a) * 0.115, 0.030 + math.sin(a) * 0.150,
                                0.055 + 0.02 * math.cos(a)),
                      segments=6, rings=4, scale=(1, 1, 0.6))
        parts.append(_mat(rv, "steel"))

    handle = _blade("handle", [
        (-0.085, 0.016, 0.014),
        (0.000, 0.018, 0.016),
        (0.085, 0.016, 0.014),
    ], cross=OVAL, smooth=True)
    _bake(handle, loc=(0, 0.020, -0.028), rot=(0, math.radians(90), 0))
    parts.append(_mat(handle, "leather"))

    strap = _blade("strap", [
        (-0.150, 0.030, 0.007),
        (0.150, 0.030, 0.007),
    ], cross=SLAB, smooth=False)
    _bake(strap, loc=(0.0, 0.190, -0.010), rot=(0, math.radians(90), 0))
    parts.append(_mat(strap, "leather"))

    _finish(parts, "wpn_shield_iron")


# ===========================================================================

ASSETS = {
    "wpn_wooden_sword":  ("weapon", wooden_sword),
    "wpn_bronze_sword":  ("weapon", bronze_sword),
    "wpn_iron_sword":    ("weapon", iron_sword),
    "wpn_ebony_sword":   ("weapon", ebony_sword),
    "wpn_bluesky":       ("weapon", bluesky),
    "wpn_dagger":        ("weapon", dagger),
    "wpn_crescent":      ("weapon", crescent),
    "wpn_dragon_sword":  ("weapon", dragon_sword),
    "wpn_bloodlust":     ("weapon", bloodlust),
    "wpn_asura":         ("weapon", asura),
    "wpn_serpent":       ("weapon", serpent),
    "wpn_dragonslayer":  ("weapon", dragonslayer),
    "wpn_bone_staff":    ("weapon", bone_staff),
    "wpn_dragon_tooth":  ("weapon", dragon_tooth),
    "wpn_soul_staff":    ("weapon", soul_staff),
    "wpn_judgement":     ("weapon", judgement),
    "wpn_axe":           ("weapon", axe),
    "wpn_spear":         ("weapon", spear),
    "wpn_bow":           ("weapon", bow),
    "wpn_wooden_staff":  ("weapon", wooden_staff),
    "wpn_shield_wood":   ("weapon", shield_wood),
    "wpn_shield_iron":   ("weapon", shield_iron),
}
