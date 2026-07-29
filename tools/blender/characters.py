"""
Player characters and town NPCs — every one skinned to the shared humanoid rig.

Everything here is built from a single spec-driven assembler (`_assemble`) so
that a warrior and a tailor differ by *proportion and layering*, not by an
independent pile of code. The rules that matter for the game camera:

  * Silhouette is read at ~26 units out, so the outline carries the identity.
    Warriors are the widest thing on screen (pauldrons + plated boots), mages
    are the tallest and narrowest with a skirt that flares to the floor, and
    Taoists sit between them with a crossed front panel and a sash.
  * Nothing is a capsule. Torsos are lofted super-ellipses whose front and back
    radii differ, limbs carry a bicep/calf bulge, and heads are sculpted with
    gaussian falloffs for brow, socket, cheekbone and chin rather than being a
    sphere with a nose glued on.
  * Female builds change shoulder:hip ratio, waist, bust and robe drape — they
    are not the male mesh scaled down.

Blender is Z-up and +Y is the character's FORWARD (this matches rig.py, whose
ankle bones point their tails to +Y).
"""
import sys
import os
import math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy                                    # noqa: E402
from mathutils import Vector, Matrix          # noqa: E402
from lib import mesh as M, rig as R, mat as MAT   # noqa: E402

TAU = math.pi * 2

SEG_TORSO = 14
SEG_HEAD = 16
SEG_LIMB = 9
SEG_ROBE = 18


# ----------------------------------------------------------------- primitives

def _sp(v, p):
    """Signed power — turns a circle into a super-ellipse as p drops below 1."""
    if p == 1.0:
        return v
    if v == 0.0:
        return 0.0
    return math.copysign(abs(v) ** p, v)


def oval(z, rx, ryf, ryb, n=14, p=1.0, cx=0.0, cy=0.0, phase=0.0):
    """
    A horizontal ring with independent FRONT (+Y) and BACK (-Y) radii — the
    single most useful shape here, because no part of a human body has the same
    depth in front as behind.
    """
    pts = []
    for s in range(n):
        a = TAU * s / n + phase
        c, si = math.cos(a), math.sin(a)
        ry = ryf if si >= 0.0 else ryb
        pts.append((cx + rx * _sp(c, p), cy + ry * _sp(si, p), z))
    return pts


def arc(z, rx, ryf, ryb, a0, a1, n, cx=0.0, cy=0.0):
    """An open ring spanning [a0, a1] degrees. Capes, collars, tabards."""
    pts = []
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        c, si = math.cos(a), math.sin(a)
        ry = ryf if si >= 0.0 else ryb
        pts.append((cx + rx * c, cy + ry * si, z))
    return pts


def ring_uv(c, U, V, ru, rv, n=12, p=1.0):
    """Ring in an arbitrary plane. Rings must advance along U x V."""
    c, U, V = Vector(c), Vector(U), Vector(V)
    out = []
    for s in range(n):
        a = TAU * s / n
        out.append(tuple(c + U * (ru * _sp(math.cos(a), p)) + V * (rv * _sp(math.sin(a), p))))
    return out


def loft_capped(name, rings, close=True, cap_start=False, cap_end=False, smooth=True):
    """Like M.loft but able to close the ends and to leave the ring open."""
    verts, faces, idx = [], [], []
    for r in rings:
        row = []
        for v in r:
            row.append(len(verts))
            verts.append(tuple(v))
        idx.append(row)
    n = len(idx[0])
    for i in range(len(idx) - 1):
        a, b = idx[i], idx[i + 1]
        for s in range(n if close else n - 1):
            t = (s + 1) % n
            faces.append([a[s], a[t], b[t], b[s]])
    if cap_start:
        faces.append(list(reversed(idx[0])))
    if cap_end:
        faces.append(list(idx[-1]))
    return M.new_mesh(name, verts, faces, smooth=smooth)


def sweep(name, path, rw, rh, n=4, up=(0, 0, 1), p=1.0, smooth=False):
    """
    Sweep a rectangular / elliptical cross-section along a polyline. This is how
    every strap, sash tail, belt, lapel, spear shaft and armour rib is made —
    eight triangles per segment buys a lot of silhouette.
    """
    P = [Vector(q) for q in path]
    rings = []
    for i, q in enumerate(P):
        if i == 0:
            t = P[1] - P[0]
        elif i == len(P) - 1:
            t = P[-1] - P[-2]
        else:
            t = P[i + 1] - P[i - 1]
        t.normalize()
        u = Vector(up).cross(t)
        if u.length < 1e-5:
            u = Vector((1, 0, 0)).cross(t)
        u.normalize()
        v = t.cross(u).normalized()
        w = rw[i] if isinstance(rw, (list, tuple)) else rw
        h = rh[i] if isinstance(rh, (list, tuple)) else rh
        if n == 4:
            rings.append([tuple(q + u * w + v * h), tuple(q - u * w + v * h),
                          tuple(q - u * w - v * h), tuple(q + u * w - v * h)])
        else:
            rings.append(ring_uv(q, u, v, w, h, n=n, p=p))
    return loft_capped(name, rings, cap_start=True, cap_end=True, smooth=smooth)


def oriented_lathe(name, profile, origin, direction, segments=10, smooth=True,
                   close_bottom=True, close_top=True):
    ob = M.lathe(name, profile, segments=segments, smooth=smooth,
                 close_bottom=close_bottom, close_top=close_top)
    d = Vector(direction).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    ob.matrix_world = Matrix.Translation(Vector(origin)) @ q.to_matrix().to_4x4()
    return ob


def fin(ob, matname, smooth=None):
    if smooth is not None:
        for poly in ob.data.polygons:
            poly.use_smooth = smooth
    MAT.assign(ob, matname)
    return ob


# ------------------------------------------------------------------ body plan

BASE = dict(
    name="char",
    skin="skin.tan",
    scale=1.0,
    # torso half-extents
    sh_w=0.205, sh_d=0.118,
    wa_w=0.148, wa_d=0.104,
    hi_w=0.158, hi_d=0.116,
    bust=0.0, belly=0.0,
    torso_p=0.86,
    neck_r=0.055,
    arm=(0.062, 0.047, 0.036),
    delt=0.078,
    leg=(0.118, 0.086, 0.048),
    stance=0.0,
    lean=0.0,
    head=None,
    hair=None,
    beard=None,
    boots=None,
    shell=None,
    robe=None,
    sleeve=None,
    belt=None,
    sash=None,
    lapel=None,
    collar=None,
    cape=None,
    tabard=None,
    tassets=None,
    bracers=None,
    pauldron=None,
    cap=None,
    apron=None,
    satchel=None,
    spear=False,
    trim=None,
)


def _torso_rings(sp):
    shw, shd = sp["sh_w"], sp["sh_d"]
    waw, wad = sp["wa_w"], sp["wa_d"]
    hiw, hid = sp["hi_w"], sp["hi_d"]
    bust, belly = sp["bust"], sp["belly"]
    # (z, rx, ry_front, ry_back)
    return [
        (0.880, hiw * 0.80, hid * 0.76, hid * 0.80),
        (0.935, hiw * 0.98, hid * 0.96, hid * 1.00),
        (0.995, hiw * 1.00, hid * 0.99 + belly * 0.5, hid * 1.02),
        (1.070, waw * 1.02, wad * 1.00 + belly * 1.0, wad * 1.02),
        (1.145, waw * 1.00, wad * 0.99 + belly * 0.9, wad * 1.01),
        (1.230, shw * 0.80, shd * 0.94 + bust * 0.5 + belly * 0.4, shd * 0.96),
        (1.320, shw * 0.89, shd * 1.02 + bust * 1.0, shd * 1.00),
        (1.400, shw * 0.97, shd * 1.00 + bust * 0.7, shd * 1.00),
        (1.470, shw * 1.00, shd * 0.94, shd * 0.97),
        (1.520, shw * 0.90, shd * 0.84, shd * 0.88),
        (1.556, shw * 0.56, shd * 0.62, shd * 0.66),
    ]


def _tr_at(rings, z):
    """Interpolate the torso profile so every shell layer follows the body."""
    if z <= rings[0][0]:
        return rings[0][1:]
    if z >= rings[-1][0]:
        return rings[-1][1:]
    for i in range(len(rings) - 1):
        z0, z1 = rings[i][0], rings[i + 1][0]
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return tuple(rings[i][k + 1] + (rings[i + 1][k + 1] - rings[i][k + 1]) * t
                         for k in range(3))
    return rings[-1][1:]


def p_torso(sp):
    rings = _torso_rings(sp)
    rows = [oval(z, rx, ryf, ryb, SEG_TORSO, sp["torso_p"]) for z, rx, ryf, ryb in rings]
    ob = loft_capped("torso", rows, cap_start=True, cap_end=True, smooth=True)
    return ob, rings


def p_neck(sp):
    r = sp["neck_r"]
    rows = [
        oval(1.500, r * 1.34, r * 1.30, r * 1.40, 10, 0.9),
        oval(1.545, r * 1.06, r * 1.02, r * 1.14, 10, 0.9),
        oval(1.585, r * 0.98, r * 0.96, r * 1.06, 10, 0.9),
        oval(1.615, r * 1.02, r * 1.00, r * 1.10, 10, 0.9),
    ]
    return loft_capped("neck", rows, smooth=True)


# ----------------------------------------------------------------------- head

HEAD_PROFILE = [
    # (z, rx, ry_front, ry_back)
    (1.583, 0.046, 0.050, 0.058),
    (1.606, 0.054, 0.064, 0.070),
    (1.632, 0.064, 0.081, 0.079),
    (1.662, 0.077, 0.088, 0.087),
    (1.694, 0.086, 0.090, 0.094),
    (1.723, 0.087, 0.088, 0.099),
    (1.749, 0.086, 0.091, 0.100),
    (1.775, 0.083, 0.086, 0.098),
    (1.802, 0.073, 0.075, 0.087),
    (1.823, 0.053, 0.054, 0.062),
    (1.836, 0.026, 0.027, 0.031),
]


def _head_prof(sp):
    """Shared by skull and hair shell so the hair always fits the skull."""
    h = sp.get("head") or {}
    sc = h.get("scale", 1.0)
    wide = h.get("wide", 1.09) * sc
    narrow = h.get("narrow", 1.0)
    out = []
    for z, rx, ryf, ryb in HEAD_PROFILE:
        out.append((1.583 + (z - 1.583) * sc,
                    rx * wide * narrow, ryf * wide, ryb * wide))
    return out


def _sculpt_head(ob, brow=1.0, cheek=1.0, jaw=1.0):
    """
    Gaussian-blended facial landmarks. Cheap, and it is the difference between
    a head and an egg: brow ridge, recessed sockets, cheekbones, chin.
    """
    for v in ob.data.vertices:
        x, y, z = v.co
        if y <= -0.01:
            continue
        ax = abs(x)
        fz = math.exp(-((z - 1.751) / 0.015) ** 2)
        fx = math.exp(-((ax - 0.028) / 0.046) ** 2)
        v.co.y += 0.013 * brow * fz * fx

        sz = math.exp(-((z - 1.726) / 0.013) ** 2)
        sx = math.exp(-((ax - 0.036) / 0.021) ** 2)
        v.co.y -= 0.012 * sz * sx

        cz = math.exp(-((z - 1.697) / 0.019) ** 2)
        cx = math.exp(-((ax - 0.060) / 0.028) ** 2)
        v.co.y += 0.009 * cheek * cz * cx
        v.co.x += 0.006 * cheek * cz * cx * (1.0 if x >= 0 else -1.0)

        jz = math.exp(-((z - 1.637) / 0.017) ** 2)
        jx = math.exp(-(ax / 0.048) ** 2)
        v.co.y += 0.011 * jaw * jz * jx

        # mouth crease
        mz = math.exp(-((z - 1.672) / 0.008) ** 2)
        mx = math.exp(-(ax / 0.030) ** 2)
        v.co.y -= 0.004 * mz * mx


def p_head(sp):
    h = sp.get("head") or {}
    parts = []
    rows = [oval(z, rx, ryf, ryb, SEG_HEAD, 0.95) for z, rx, ryf, ryb in _head_prof(sp)]
    skull = loft_capped("head", rows, cap_start=True, cap_end=True, smooth=True)
    _sculpt_head(skull, h.get("brow", 1.0), h.get("cheek", 1.0), h.get("jaw", 1.0))
    parts.append(fin(skull, sp["skin"]))

    k = h.get("wide", 1.09) * h.get("scale", 1.0)   # facial features track the skull

    # nose — a small lofted wedge riding on the sculpted bridge
    nose_rows = [
        oval(1.694, 0.021, 0.020, 0.006, 8, 0.8, cy=0.090 * k),
        oval(1.706, 0.022, 0.021, 0.008, 8, 0.8, cy=0.100 * k),
        oval(1.720, 0.018, 0.018, 0.008, 8, 0.8, cy=0.098 * k),
        oval(1.736, 0.014, 0.014, 0.008, 8, 0.8, cy=0.091 * k),
        oval(1.752, 0.011, 0.011, 0.008, 8, 0.8, cy=0.084 * k),
    ]
    nose = loft_capped("nose", nose_rows, cap_start=True, cap_end=True, smooth=True)
    parts.append(fin(nose, sp["skin"]))

    # brow bar gives the eye line a shadow at distance
    browbar = sweep("brow", [(-0.076 * k, 0.062 * k, 1.746), (-0.036 * k, 0.088 * k, 1.754),
                             (0.0, 0.092 * k, 1.752), (0.036 * k, 0.088 * k, 1.754),
                             (0.076 * k, 0.062 * k, 1.746)], 0.009, 0.008, n=4)
    parts.append(fin(browbar, sp["skin"]))

    for s in (1, -1):
        eye = M.sphere(f"eye{s}", 0.015, location=(s * 0.038 * k, 0.080 * k, 1.727),
                       segments=7, rings=5, scale=(0.95, 0.55, 0.62))
        parts.append(fin(eye, "chitin"))
        ear = M.sphere(f"ear{s}", 0.023, location=(s * 0.090 * k, -0.008, 1.712),
                       segments=7, rings=5, scale=(0.30, 0.72, 1.15))
        parts.append(fin(ear, sp["skin"]))
    return parts


# ----------------------------------------------------------------------- hair

def p_hair(sp):
    hcfg = sp.get("hair") or {}
    style = hcfg.get("style", "topknot")
    hm = hcfg.get("mat", "chitin")
    parts = []

    # fitted shell: front radius collapses inside the skull below the hairline,
    # so the face stays clear without any boolean work.
    line = hcfg.get("hairline", 1.772)
    prof = _head_prof(sp)
    shell = []
    for z, rx, ryf, ryb in prof[3:]:
        pad = 1.075
        if z < line:
            f = 0.14 + 0.30 * max(0.0, (z - 1.66)) / 0.12
            shell.append(oval(z, rx * 0.90, ryf * f, ryb * pad, 14, 0.95))
        else:
            shell.append(oval(z, rx * pad, ryf * pad, ryb * pad, 14, 0.95))
    if style in ("long", "loose"):
        rx0, _f0, ryb0 = prof[3][1], prof[3][2], prof[3][3]
        drop = []
        for i in range(5):
            t = i / 4.0
            z = 1.66 - t * 0.24
            drop.append(oval(z, rx0 * (0.94 + 0.36 * t), 0.012,
                             ryb0 * (1.06 + 0.30 * t), 14, 0.9, cy=-0.006 * t))
        shell = drop[::-1] + shell
    ob = loft_capped("hair", shell, cap_start=True, cap_end=True, smooth=True)
    M.displace_noise(ob, strength=0.004, scale=22.0, seed=5)
    parts.append(fin(ob, hm))

    if style in ("topknot", "elder"):
        band = loft_capped("hairband", [
            oval(1.826, 0.036, 0.036, 0.040, 10, 0.9),
            oval(1.846, 0.033, 0.033, 0.036, 10, 0.9),
        ], smooth=False)
        parts.append(fin(band, hcfg.get("band", "leather")))
        knot = M.lathe("topknot", [(0.024, 1.842), (0.030, 1.862), (0.041, 1.884),
                                   (0.038, 1.906), (0.022, 1.920), (0.0, 1.928)],
                       segments=10)
        parts.append(fin(knot, hm))
    elif style == "bun":
        bun = M.sphere("bun", 0.052, location=(0.0, -0.088, 1.796),
                       segments=10, rings=7, scale=(1.0, 0.86, 0.92))
        parts.append(fin(bun, hm))
        pin = sweep("hairpin", [(-0.060, -0.090, 1.812), (0.060, -0.086, 1.802)],
                    0.006, 0.006, n=4)
        parts.append(fin(pin, hcfg.get("pin", "bronze")))
    elif style == "bun_high":
        bun = M.sphere("bun", 0.050, location=(0.0, -0.030, 1.870),
                       segments=10, rings=7, scale=(1.0, 0.92, 0.86))
        parts.append(fin(bun, hm))
        for s in (1, -1):
            lock = sweep(f"lock{s}", [(s * 0.070, -0.020, 1.760),
                                      (s * 0.086, -0.040, 1.660),
                                      (s * 0.078, -0.056, 1.570)],
                         0.016, 0.012, n=6, smooth=True)
            parts.append(fin(lock, hm))
    elif style == "queue":
        q = sweep("queue", [(0.0, -0.098, 1.790), (0.0, -0.120, 1.680),
                            (0.0, -0.128, 1.560), (0.006, -0.120, 1.440),
                            (0.010, -0.108, 1.360)],
                  [0.028, 0.026, 0.022, 0.017, 0.011],
                  [0.028, 0.026, 0.022, 0.017, 0.011], n=6, smooth=True)
        parts.append(fin(q, hm))
    return parts


def p_beard(sp):
    b = sp.get("beard")
    if not b:
        return []
    kind = b.get("style", "full")
    bm = b.get("mat", "chitin")
    parts = []
    if kind in ("full", "long"):
        low = 1.482 if kind == "long" else 1.556
        rows = []
        steps = 6
        for i in range(steps):
            t = i / (steps - 1)
            z = low + (1.664 - low) * t
            rx = 0.030 + 0.052 * t
            ryf = 0.036 + 0.056 * t
            parts_w = 1.0 + 0.10 * math.sin(t * 5.0)
            rows.append(oval(z, rx * parts_w, ryf, 0.016 + 0.062 * t, 12, 0.9,
                             cy=0.012 * (1.0 - t)))
        ob = loft_capped("beard", rows, cap_start=True, cap_end=False, smooth=True)
        M.displace_noise(ob, strength=0.005, scale=18.0, seed=9)
        parts.append(fin(ob, bm))
    else:  # goatee
        rows = []
        for i in range(4):
            t = i / 3.0
            z = 1.556 + (1.658 - 1.556) * t
            rows.append(oval(z, 0.016 + 0.020 * t, 0.026 + 0.036 * t,
                             0.010 + 0.020 * t, 10, 0.9, cy=0.020 * (1.0 - t)))
        parts.append(fin(loft_capped("goatee", rows, cap_start=True, smooth=True), bm))
    mo = sweep("moustache", [(-0.036, 0.070, 1.672), (0.0, 0.086, 1.682),
                             (0.036, 0.070, 1.672)], 0.012, 0.009, n=6, smooth=True)
    parts.append(fin(mo, bm))
    return parts


# ----------------------------------------------------------------------- limbs

def p_arms(sp):
    ra, rb, rc = sp["arm"]
    parts = []
    for s in (1, -1):
        delt = M.sphere(f"delt{s}", sp["delt"], location=(s * 0.176, 0.0, 1.474),
                        segments=10, rings=7, scale=(1.05, 0.92, 1.10))
        parts.append(fin(delt, sp["skin"]))
        up = M.limb(f"upperarm{s}", (s * 0.205, 0.0, 1.478), (s * 0.212, 0.006, 1.196),
                    ra, rb, segments=SEG_LIMB,
                    taper_curve=[ra * 1.02, ra * 1.06, ra * 0.99, rb * 1.10, rb * 1.0, rb * 0.96])
        parts.append(fin(up, sp["skin"]))
        fo = M.limb(f"forearm{s}", (s * 0.212, 0.006, 1.202), (s * 0.213, 0.020, 0.968),
                    rb, rc, segments=SEG_LIMB,
                    taper_curve=[rb * 0.97, rb * 1.06, rb * 0.98, rc * 1.20, rc * 1.02, rc])
        parts.append(fin(fo, sp["skin"]))
        parts += p_hand(sp, s)
    return parts


def p_hand(sp, s):
    cx, cy = s * 0.213, 0.020
    rows = [
        oval(0.858, 0.024, 0.020, 0.018, 8, 0.75, cx=cx, cy=cy),
        oval(0.876, 0.036, 0.030, 0.026, 8, 0.75, cx=cx, cy=cy),
        oval(0.906, 0.041, 0.034, 0.030, 8, 0.75, cx=cx, cy=cy),
        oval(0.940, 0.039, 0.033, 0.029, 8, 0.75, cx=cx, cy=cy),
        oval(0.968, 0.033, 0.027, 0.025, 8, 0.75, cx=cx, cy=cy),
    ]
    mitt = loft_capped(f"hand{s}", rows, cap_start=True, cap_end=True, smooth=True)
    thumb = M.limb(f"thumb{s}", (cx - s * 0.024, cy + 0.010, 0.944),
                   (cx - s * 0.040, cy + 0.032, 0.898), 0.017, 0.011, segments=6)
    return [fin(mitt, sp["skin"]), fin(thumb, sp["skin"])]


CALF = [(0.545, 0.079), (0.470, 0.087), (0.390, 0.081), (0.300, 0.068),
        (0.210, 0.056), (0.130, 0.048), (0.100, 0.047)]


def _calf_r(z):
    if z >= CALF[0][0]:
        return CALF[0][1]
    if z <= CALF[-1][0]:
        return CALF[-1][1]
    for i in range(len(CALF) - 1):
        z0, r0 = CALF[i]
        z1, r1 = CALF[i + 1]
        if z1 <= z <= z0:
            t = (z0 - z) / (z0 - z1)
            return r0 + (r1 - r0) * t
    return CALF[-1][1]


def p_foot(s, scale=1.0, lift=0.0, mat="skin.tan", name="foot"):
    cx = s * 0.100
    spec = [
        (-0.068, 0.036, 0.030, 0.064),
        (-0.026, 0.045, 0.044, 0.055),
        (0.026, 0.049, 0.043, 0.046),
        (0.082, 0.048, 0.032, 0.036),
        (0.134, 0.042, 0.023, 0.028),
        (0.168, 0.026, 0.014, 0.023),
    ]
    rows = []
    for y, rx, rz, cz in spec:
        rows.append(ring_uv((cx, y * scale, cz * scale + lift),
                            (0, 0, 1), (1, 0, 0),
                            rz * scale, rx * scale, n=10, p=0.68))
    ob = loft_capped(f"{name}{s}", rows, cap_start=True, cap_end=True, smooth=True)
    for v in ob.data.vertices:
        if v.co.z < 0.006 + lift:
            v.co.z = 0.006 + lift
    return fin(ob, mat, smooth=False)


def p_legs(sp):
    th, ca, an = sp["leg"]
    spread = sp["stance"]
    parts = []
    for s in (1, -1):
        x = s * (0.098 + spread)
        thigh = M.limb(f"thigh{s}", (x, 0.004, 0.992), (x + s * 0.002, 0.006, 0.540),
                       th, ca, segments=SEG_LIMB,
                       taper_curve=[th * 1.02, th * 1.00, th * 0.92, th * 0.83,
                                    ca * 1.02, ca * 0.94])
        parts.append(fin(thigh, sp["skin"]))
        calf = M.limb(f"calf{s}", (x + s * 0.002, 0.006, 0.556), (x + s * 0.002, 0.022, 0.108),
                      ca, an, segments=SEG_LIMB,
                      taper_curve=[ca * 0.94, ca * 1.10, ca * 1.02, ca * 0.82,
                                   an * 1.22, an * 1.04, an])
        parts.append(fin(calf, sp["skin"]))
    return parts


def p_boots(sp):
    b = sp.get("boots")
    if not b:
        return [p_foot(1, mat=sp["skin"]), p_foot(-1, mat=sp["skin"])]
    top = b.get("top", 0.30)
    bm = b.get("mat", "leather")
    pad = b.get("pad", 0.016)
    plate = b.get("plate", False)
    parts = []
    for s in (1, -1):
        x = s * (0.098 + sp["stance"])
        rows = []
        zs = [0.098, 0.150, 0.220, 0.300]
        zs += [z for z in (0.380, 0.460, 0.540) if z < top - 0.03]
        zs.append(top - 0.020)
        zs.append(top)
        for i, z in enumerate(zs):
            r = _calf_r(z) + pad
            if i >= len(zs) - 2:
                r += b.get("cuff", 0.020) * (1.0 if i == len(zs) - 1 else 0.45)
            rows.append(oval(z, r, r * 0.98, r * 1.02, 10, 0.86, cx=x, cy=0.014))
        shaft = loft_capped(f"boot{s}", rows, cap_start=False, cap_end=True,
                            smooth=not plate)
        parts.append(fin(shaft, bm))
        parts.append(p_foot(s, scale=1.0 + pad * 4.0, lift=0.0, mat=bm, name="bootfoot"))
        if plate:
            shin = sweep(f"shinplate{s}", [
                (x, 0.058, 0.150), (x, 0.078, 0.260), (x, 0.086, 0.380),
                (x, 0.082, top - 0.030)], 0.052, 0.014, n=4)
            parts.append(fin(shin, b.get("plate_mat", bm)))
            cap = oriented_lathe(f"toecap{s}", [(0.030, 0.0), (0.052, 0.020),
                                                (0.058, 0.048), (0.040, 0.070),
                                                (0.0, 0.080)],
                                 (x, 0.086, 0.038), (0, 1, 0.30), segments=10, smooth=False)
            parts.append(fin(cap, b.get("plate_mat", bm)))
    return parts


# --------------------------------------------------------------- worn layers

def p_shell(sp, rings, cfg, name="shell"):
    """A garment/armour layer that follows the torso profile."""
    z0, z1 = cfg["z0"], cfg["z1"]
    pad = cfg.get("pad", 0.020)
    n = cfg.get("n", SEG_TORSO)
    steps = cfg.get("steps", 7)
    rows = []
    for i in range(steps):
        t = i / (steps - 1)
        z = z0 + (z1 - z0) * t
        rx, ryf, ryb = _tr_at(rings, z)
        k = pad * cfg.get("flare", 1.0) ** t
        if i == 0 and cfg.get("hem", 0.0):
            k += cfg["hem"]
        rows.append(oval(z, rx + k, ryf + k, ryb + k, n, sp["torso_p"]))
    ob = loft_capped(name, rows, cap_start=cfg.get("cap", True),
                     cap_end=cfg.get("cap", True), smooth=cfg.get("smooth", True))
    if cfg.get("noise"):
        M.displace_noise(ob, strength=cfg["noise"], scale=14.0, seed=cfg.get("seed", 3))
    return fin(ob, cfg["mat"])


def p_robe(sp):
    cfg = sp.get("robe")
    if not cfg:
        return []
    z0, z1 = cfg.get("z_top", 1.10), cfg.get("z_bot", 0.06)
    rt, rb = cfg.get("rt", 0.175), cfg.get("rb", 0.300)
    folds = cfg.get("folds", 7)
    amp = cfg.get("amp", 0.020)
    n = cfg.get("n", SEG_ROBE)
    steps = cfg.get("steps", 10)
    mm = cfg.get("mat", "clothBlue")
    ry = cfg.get("squash", 0.90)
    seed = cfg.get("seed", 3.0)
    rows = []
    for i in range(steps):
        t = i / (steps - 1)
        e = t * t * (3.0 - 2.0 * t)
        r = rt + (rb - rt) * (0.22 * t + 0.78 * e)
        z = z0 + (z1 - z0) * t
        a = amp * (0.18 + 0.82 * t)
        ph = seed + 0.55 * t
        pts = []
        for s in range(n):
            ang = TAU * s / n
            rr = r + a * math.cos(folds * ang + ph) + a * 0.35 * math.sin(3.0 * ang + seed * 2.3)
            zz = z + (0.016 * math.sin(folds * ang * 1.0 + ph * 1.9) if i == steps - 1 else 0.0)
            pts.append((math.cos(ang) * rr, math.sin(ang) * rr * ry, zz))
        rows.append(pts)
    rows.reverse()   # ascend in Z so the side normals face out
    ob = loft_capped("robe", rows, cap_start=False, cap_end=True, smooth=True)
    M.displace_noise(ob, strength=cfg.get("noise", 0.006), scale=10.0, seed=7)
    return [fin(ob, mm)]


def p_sleeves(sp):
    cfg = sp.get("sleeve")
    if not cfg:
        return []
    rt = cfg.get("rt", 0.082)
    rb = cfg.get("rb", 0.150)
    z0 = cfg.get("z_top", 1.470)
    z1 = cfg.get("z_bot", 0.960)
    mm = cfg.get("mat", "clothBlue")
    n = cfg.get("n", 12)
    steps = cfg.get("steps", 7)
    folds = cfg.get("folds", 5)
    parts = []
    for s in (1, -1):
        rows = []
        for i in range(steps):
            t = i / (steps - 1)
            e = t * t * (3.0 - 2.0 * t)
            r = rt + (rb - rt) * e
            z = z0 + (z1 - z0) * t
            cx = s * (0.208 + 0.010 * e)
            pts = []
            for k in range(n):
                ang = TAU * k / n
                rr = r * (1.0 + 0.05 * t * math.cos(folds * ang + s * 1.1))
                pts.append((cx + math.cos(ang) * rr, 0.010 + math.sin(ang) * rr * 0.92, z))
            rows.append(pts)
        rows.reverse()
        ob = loft_capped(f"sleeve{s}", rows, cap_start=False, cap_end=True, smooth=True)
        parts.append(fin(ob, mm))
        if cfg.get("cuff"):
            cuff = loft_capped(f"cuff{s}", [
                oval(z1, rb * 1.06, rb * 1.06, rb * 1.06, n, 1.0, cx=s * 0.218, cy=0.010),
                oval(z1 + 0.036, rb * 1.02, rb * 1.02, rb * 1.02, n, 1.0, cx=s * 0.216, cy=0.010),
            ], smooth=False)
            parts.append(fin(cuff, cfg["cuff"]))
    return parts


def p_belt(sp, rings):
    cfg = sp.get("belt")
    if not cfg:
        return []
    z = cfg.get("z", 1.100)
    w = cfg.get("w", 0.050)
    mm = cfg.get("mat", "leather")
    pad = cfg.get("pad", 0.024)
    rows = []
    for zz in (z - w * 0.5, z - w * 0.25, z + w * 0.25, z + w * 0.5):
        rx, ryf, ryb = _tr_at(rings, zz)
        k = pad + (0.008 if abs(zz - z) < w * 0.3 else 0.0)
        rows.append(oval(zz, rx + k, ryf + k, ryb + k, SEG_TORSO, sp["torso_p"]))
    ob = loft_capped("belt", rows, smooth=False)
    parts = [fin(ob, mm)]
    if cfg.get("buckle"):
        rx, ryf, _ = _tr_at(rings, z)
        bk = M.box("buckle", (0.072, 0.030, 0.062), location=(0.0, ryf + 0.030, z), bevel=0.008)
        parts.append(fin(bk, cfg["buckle"], smooth=False))
    return parts


def p_sash(sp, rings):
    cfg = sp.get("sash")
    if not cfg:
        return []
    z = cfg.get("z", 1.095)
    w = cfg.get("w", 0.078)
    mm = cfg.get("mat", "silk")
    rows = []
    steps = 5
    for i in range(steps):
        t = i / (steps - 1)
        zz = z - w * 0.5 + w * t
        rx, ryf, ryb = _tr_at(rings, zz)
        k = 0.028 + 0.012 * math.sin(t * math.pi)
        rows.append(oval(zz, rx + k, ryf + k, ryb + k, SEG_TORSO, sp["torso_p"]))
    parts = [fin(loft_capped("sash", rows, smooth=True), mm)]
    rx, ryf, _ = _tr_at(rings, z)
    knot = M.sphere("sashknot", 0.052, location=(-0.052, ryf + 0.036, z - 0.010),
                    segments=8, rings=6, scale=(1.0, 0.60, 0.78))
    parts.append(fin(knot, mm))
    if cfg.get("tails", True):
        for i, (dx, drop, lean) in enumerate(((-0.076, 0.30, -0.020), (-0.020, 0.40, 0.014))):
            tail = sweep(f"sashtail{i}", [
                (dx, ryf + 0.030, z - 0.030),
                (dx + lean * 0.5, ryf + 0.040, z - drop * 0.35),
                (dx + lean, ryf + 0.026, z - drop * 0.72),
                (dx + lean * 1.4, ryf + 0.034, z - drop)],
                [0.030, 0.032, 0.030, 0.026], 0.008, n=4)
            parts.append(fin(tail, mm))
    return parts


def p_lapel(sp, rings):
    cfg = sp.get("lapel")
    if not cfg:
        return []
    mm = cfg.get("mat", "clothWhite")
    tm = cfg.get("trim", "silk")
    zt = cfg.get("z_top", 1.500)
    zb = cfg.get("z_bot", 1.070)
    parts = []
    # two crossed front panels — the 交领 read, plus a trim band on each edge
    for i, s in enumerate((1, -1)):
        rxt, ryft, _ = _tr_at(rings, zt)
        rxm, ryfm, _ = _tr_at(rings, (zt + zb) * 0.5)
        rxb, ryfb, _ = _tr_at(rings, zb)
        d = 0.030 + i * 0.014
        path = [
            (s * (rxt * 0.62), ryft * 0.72 + d, zt + 0.020),
            (s * (rxm * 0.40), ryfm * 0.94 + d, (zt + zb) * 0.5 + 0.075),
            (-s * (rxm * 0.12), ryfm * 1.00 + d, (zt + zb) * 0.5 - 0.030),
            (-s * (rxb * 0.44), ryfb * 0.90 + d, zb + 0.020),
        ]
        band = sweep(f"lapel{i}", path, [0.058, 0.062, 0.058, 0.050], 0.013, n=4)
        parts.append(fin(band, mm))
        trim = sweep(f"lapeltrim{i}", path, [0.014, 0.015, 0.014, 0.012], 0.016, n=4)
        for v in trim.data.vertices:
            v.co.x += s * 0.048 * (1.0 if abs(v.co.z - zt) < 0.6 else 1.0)
        parts.append(fin(trim, tm))
    return parts


def p_collar(sp, rings):
    cfg = sp.get("collar")
    if not cfg:
        return []
    mm = cfg.get("mat", "silk")
    z0 = cfg.get("z0", 1.440)
    z1 = cfg.get("z1", 1.690)
    a0, a1 = cfg.get("a0", 152.0), cfg.get("a1", 388.0)
    n = cfg.get("n", 14)
    steps = 5
    rows = []
    for i in range(steps):
        t = i / (steps - 1)
        z = z0 + (z1 - z0) * t
        rx, ryf, ryb = _tr_at(rings, min(z, 1.556))
        k = 0.030 + cfg.get("flare", 0.045) * t * t
        base = max(0.070, rx * (1.0 - 0.42 * t))
        rows.append(arc(z, base + k, max(0.062, ryf * (1.0 - 0.35 * t)) + k,
                        max(0.070, ryb * (1.0 - 0.20 * t)) + k, a0, a1, n))
    ob = loft_capped("collar", rows, close=False, smooth=True)
    M.add_solidify(ob, thickness=cfg.get("thick", 0.016))
    return [fin(ob, mm)]


def p_cape(sp, rings):
    cfg = sp.get("cape")
    if not cfg:
        return []
    mm = cfg.get("mat", "clothRed")
    z0, z1 = cfg.get("z0", 1.500), cfg.get("z1", 0.320)
    n = cfg.get("n", 13)
    steps = 8
    rows = []
    for i in range(steps):
        t = i / (steps - 1)
        z = z0 + (z1 - z0) * t
        rx, _ryf, ryb = _tr_at(rings, max(z, 0.9))
        rr = rx * (1.0 + 0.55 * t) + 0.030 + 0.10 * t * t
        rb = ryb + 0.036 + 0.09 * t * t
        pts = []
        for k in range(n):
            a = math.radians(192.0 + 156.0 * k / (n - 1))
            wob = 0.020 * math.sin(4.0 * k / (n - 1) * math.pi + 1.3) * t
            pts.append((math.cos(a) * (rr + wob), math.sin(a) * (rb + wob),
                        z + (0.030 * math.sin(3.0 * k) if i == steps - 1 else 0.0)))
        rows.append(pts)
    rows.reverse()
    ob = loft_capped("cape", rows, close=False, smooth=True)
    M.add_solidify(ob, thickness=0.012)
    parts = [fin(ob, mm)]
    clasp = sweep("capeclasp", [(-0.115, 0.020, 1.512), (0.0, 0.052, 1.520),
                                (0.115, 0.020, 1.512)], 0.022, 0.012, n=4)
    parts.append(fin(clasp, cfg.get("clasp", "gold")))
    return parts


def p_tabard(sp, rings):
    cfg = sp.get("tabard")
    if not cfg:
        return []
    mm = cfg.get("mat", "clothRed")
    z0, z1 = cfg.get("z0", 1.480), cfg.get("z1", 0.840)
    parts = []
    for name, (a0, a1) in (("front", (36.0, 144.0)), ("back", (216.0, 324.0))):
        rows = []
        steps = 5
        for i in range(steps):
            t = i / (steps - 1)
            z = z0 + (z1 - z0) * t
            rx, ryf, ryb = _tr_at(rings, max(z, 0.94))
            k = 0.034 + 0.016 * t
            rows.append(arc(z, rx + k, ryf + k, ryb + k, a0, a1, 8))
        rows.reverse()
        ob = loft_capped(f"tabard_{name}", rows, close=False, smooth=True)
        M.add_solidify(ob, thickness=0.010)
        parts.append(fin(ob, mm))
    return parts


def p_tassets(sp, rings):
    cfg = sp.get("tassets")
    if not cfg:
        return []
    mm = cfg.get("mat", "leather")
    n = cfg.get("n", 9)
    z0 = cfg.get("z0", 1.040)
    parts = []
    for i in range(n):
        a = math.radians(-90.0 + 360.0 * (i + 0.5) / n)
        rx, ryf, ryb = _tr_at(rings, z0)
        ry = ryf if math.sin(a) >= 0 else ryb
        drop = cfg.get("drop", 0.300) * (0.72 + 0.34 * abs(math.cos(a * 1.5)))
        c, s2 = math.cos(a), math.sin(a)
        path = [
            (c * (rx + 0.030), s2 * (ry + 0.030), z0),
            (c * (rx + 0.052), s2 * (ry + 0.052), z0 - drop * 0.45),
            (c * (rx + 0.070), s2 * (ry + 0.070), z0 - drop),
        ]
        st = sweep(f"tasset{i}", path, [0.036, 0.038, 0.034], 0.011, n=4)
        parts.append(fin(st, mm))
    return parts


def p_pauldrons(sp):
    cfg = sp.get("pauldron")
    if not cfg:
        return []
    mm = cfg.get("mat", "iron")
    r = cfg.get("r", 0.145)
    out = cfg.get("out", 0.110)
    parts = []
    for s in (1, -1):
        prof = [(r * 0.30, 0.0), (r * 0.74, out * 0.16), (r * 0.94, out * 0.42),
                (r * 1.00, out * 0.70), (r * 0.86, out * 0.92), (r * 0.50, out * 1.02),
                (0.0, out * 1.06)]
        dome = oriented_lathe(f"pauldron{s}", prof, (s * 0.150, 0.0, 1.470),
                              (s * 0.94, 0.0, 0.34), segments=cfg.get("seg", 11),
                              smooth=cfg.get("smooth", False))
        parts.append(fin(dome, mm))
        if cfg.get("layers", 1) >= 2:
            rows = []
            for i, (z, k) in enumerate(((1.394, 1.00), (1.348, 1.10), (1.306, 1.06))):
                rr = (0.070 + 0.020 * i) * k
                rows.append(oval(z, rr, rr * 0.96, rr * 1.02, 10, 0.9,
                                 cx=s * (0.208 + 0.006 * i), cy=0.004))
            rows.reverse()
            skirt = loft_capped(f"pauldron2_{s}", rows, cap_start=False,
                                cap_end=False, smooth=False)
            parts.append(fin(skirt, mm))
        if cfg.get("spike"):
            sp2 = oriented_lathe(f"spike{s}", [(0.030, 0.0), (0.024, 0.040),
                                               (0.014, 0.090), (0.0, 0.130)],
                                 (s * 0.230, -0.010, 1.560), (s * 0.42, -0.10, 0.90),
                                 segments=7, smooth=False)
            parts.append(fin(sp2, cfg.get("spike", "gold")))
    return parts


def p_bracers(sp):
    cfg = sp.get("bracers")
    if not cfg:
        return []
    mm = cfg.get("mat", "iron")
    _ra, rb, rc = sp["arm"]
    parts = []
    for s in (1, -1):
        rows = []
        for i, z in enumerate((0.980, 1.030, 1.090, 1.150)):
            r = (rc + (rb - rc) * (z - 0.968) / 0.234) + 0.018
            if i == 3:
                r += 0.012
            rows.append(oval(z, r, r * 0.98, r * 1.02, 10, 0.85,
                             cx=s * 0.213, cy=0.018 - 0.010 * i))
        parts.append(fin(loft_capped(f"bracer{s}", rows, smooth=False), mm))
    return parts


def p_cap(sp):
    kind = sp.get("cap")
    if not kind:
        return []
    parts = []
    if kind == "daoist":
        rows = [
            oval(1.836, 0.048, 0.052, 0.052, 8, 0.55),
            oval(1.866, 0.054, 0.060, 0.060, 8, 0.55),
            oval(1.902, 0.050, 0.056, 0.056, 8, 0.55),
            oval(1.926, 0.034, 0.038, 0.038, 8, 0.55),
        ]
        parts.append(fin(loft_capped("daocap", rows, cap_start=True, cap_end=True,
                                     smooth=False), "chitin"))
        pin = sweep("daopin", [(-0.078, 0.006, 1.882), (0.078, 0.006, 1.882)],
                    0.007, 0.007, n=6, smooth=True)
        parts.append(fin(pin, "gold"))
        band = loft_capped("daoband", [
            oval(1.826, 0.088, 0.092, 0.098, 12, 0.9),
            oval(1.846, 0.086, 0.090, 0.096, 12, 0.9)], smooth=False)
        parts.append(fin(band, "silk"))
    elif kind == "scholar":
        rows = [
            oval(1.800, 0.092, 0.096, 0.102, 12, 0.8),
            oval(1.834, 0.090, 0.094, 0.100, 12, 0.8),
            oval(1.880, 0.070, 0.074, 0.082, 12, 0.8),
            oval(1.916, 0.044, 0.046, 0.052, 12, 0.8),
        ]
        parts.append(fin(loft_capped("scholarcap", rows, cap_start=True, cap_end=True,
                                     smooth=True), "chitin"))
        for s in (1, -1):
            wing = sweep(f"capwing{s}", [(0.0, -0.086, 1.856),
                                         (s * 0.090, -0.110, 1.858),
                                         (s * 0.160, -0.116, 1.844)],
                         [0.010, 0.018, 0.026], 0.007, n=4)
            parts.append(fin(wing, "chitin"))
    elif kind == "kerchief":
        rows = [
            oval(1.752, 0.092, 0.094, 0.104, 12, 0.9),
            oval(1.790, 0.090, 0.092, 0.102, 12, 0.9),
            oval(1.822, 0.072, 0.074, 0.084, 12, 0.9),
            oval(1.844, 0.040, 0.042, 0.048, 12, 0.9),
        ]
        ob = loft_capped("kerchief", rows, cap_start=True, cap_end=True, smooth=True)
        M.displace_noise(ob, strength=0.005, scale=16.0, seed=11)
        parts.append(fin(ob, sp.get("cap_mat", "sackcloth")))
        knot = sweep("kerchiefknot", [(0.0, -0.096, 1.800), (0.010, -0.140, 1.766)],
                     0.024, 0.016, n=6, smooth=True)
        parts.append(fin(knot, sp.get("cap_mat", "sackcloth")))
    elif kind == "helmet":
        dome = M.lathe("helm", [(0.116, 1.740), (0.128, 1.752), (0.104, 1.762),
                                (0.100, 1.792), (0.090, 1.828), (0.062, 1.866),
                                (0.030, 1.888), (0.0, 1.896)],
                       segments=13, smooth=False)
        parts.append(fin(dome, sp.get("cap_mat", "iron")))
        finial = M.lathe("helmfinial", [(0.026, 1.888), (0.020, 1.916),
                                        (0.030, 1.930), (0.0, 1.968)],
                         segments=8, smooth=False)
        parts.append(fin(finial, "bronze"))
        nasal = sweep("nasal", [(0.0, 0.104, 1.752), (0.0, 0.106, 1.700),
                                (0.0, 0.098, 1.678)], 0.014, 0.008, n=4)
        parts.append(fin(nasal, sp.get("cap_mat", "iron")))
        rows = []
        for i, (z, r) in enumerate(((1.744, 0.118), (1.706, 0.122), (1.660, 0.118),
                                    (1.622, 0.106))):
            rows.append(arc(z, r, r * 0.86, r * 1.02, 200.0, 340.0, 9))
        rows.reverse()
        guard = loft_capped("neckguard", rows, close=False, smooth=False)
        M.add_solidify(guard, thickness=0.012)
        parts.append(fin(guard, sp.get("cap_mat", "iron")))
    elif kind == "crown":
        rows = [
            oval(1.822, 0.086, 0.090, 0.096, 12, 0.7),
            oval(1.860, 0.084, 0.088, 0.094, 12, 0.7),
            oval(1.906, 0.078, 0.082, 0.088, 12, 0.7),
            oval(1.944, 0.058, 0.060, 0.066, 12, 0.7),
            oval(1.966, 0.030, 0.032, 0.036, 12, 0.7),
        ]
        parts.append(fin(loft_capped("crown", rows, cap_start=True, cap_end=True,
                                     smooth=False), "chitin"))
        band = loft_capped("crownband", [
            oval(1.816, 0.092, 0.096, 0.102, 12, 0.7),
            oval(1.842, 0.090, 0.094, 0.100, 12, 0.7)], smooth=False)
        parts.append(fin(band, "gold"))
        for s in (1, -1):
            tas = sweep(f"crowntas{s}", [(s * 0.086, 0.010, 1.826),
                                         (s * 0.098, 0.006, 1.740),
                                         (s * 0.094, -0.004, 1.664)],
                        [0.012, 0.014, 0.012], 0.008, n=4)
            parts.append(fin(tas, "gold"))
    return parts


def p_apron(sp, rings):
    cfg = sp.get("apron")
    if not cfg:
        return []
    mm = cfg.get("mat", "leather")
    z0, z1 = cfg.get("z0", 1.430), cfg.get("z1", 0.620)
    rows = []
    steps = 6
    for i in range(steps):
        t = i / (steps - 1)
        z = z0 + (z1 - z0) * t
        rx, ryf, ryb = _tr_at(rings, max(z, 0.94))
        k = 0.034 + 0.026 * t
        half = 62.0 + 34.0 * t
        rows.append(arc(z, rx + k + 0.030 * t, ryf + k, ryb + k,
                        90.0 - half, 90.0 + half, 9))
    rows.reverse()
    ob = loft_capped("apron", rows, close=False, smooth=True)
    M.add_solidify(ob, thickness=0.014)
    M.displace_noise(ob, strength=0.006, scale=12.0, seed=13)
    parts = [fin(ob, mm)]
    rxt, ryft, ryb = _tr_at(rings, 1.470)
    for s in (1, -1):
        strap = sweep(f"apronstrap{s}", [
            (s * 0.052, ryft * 0.90 + 0.030, z0 + 0.010),
            (s * 0.100, 0.010, 1.508),
            (s * 0.070, -(ryb + 0.030), 1.440)], 0.020, 0.008, n=4)
        parts.append(fin(strap, mm))
    return parts


def p_satchel(sp, rings):
    cfg = sp.get("satchel")
    if not cfg:
        return []
    mm = cfg.get("mat", "leather")
    s = cfg.get("side", -1)
    cx, cy, cz = s * 0.200, 0.020, 0.960
    bag = loft_capped("satchel", [
        oval(0.842, 0.086, 0.052, 0.052, 10, 0.55, cx=cx, cy=cy),
        oval(0.880, 0.098, 0.062, 0.062, 10, 0.55, cx=cx, cy=cy),
        oval(0.960, 0.100, 0.064, 0.064, 10, 0.55, cx=cx, cy=cy),
        oval(1.016, 0.092, 0.058, 0.058, 10, 0.55, cx=cx, cy=cy),
    ], cap_start=True, cap_end=True, smooth=False)
    parts = [fin(bag, mm)]
    flap = loft_capped("satchelflap", [
        oval(0.946, 0.100, 0.068, 0.068, 10, 0.55, cx=cx, cy=cy),
        oval(1.012, 0.104, 0.070, 0.070, 10, 0.55, cx=cx, cy=cy),
    ], smooth=False)
    parts.append(fin(flap, cfg.get("flap", mm)))
    rx, ryf, ryb = _tr_at(rings, 1.300)
    strap = sweep("satchelstrap", [
        (cx * 0.82, cy, 1.010),
        (s * (rx + 0.028), 0.010, 1.220),
        (-s * (rx * 0.28), ryf + 0.028, 1.430),
        (-s * (rx * 0.42), 0.0, 1.510),
        (-s * (rx * 0.20), -(ryb + 0.026), 1.400),
        (s * (rx + 0.020), -(ryb * 0.55), 1.180),
        (cx * 0.86, cy - 0.030, 1.000)], 0.024, 0.008, n=4)
    parts.append(fin(strap, mm))
    return parts


def p_spear():
    parts = []
    x, y = -0.302, 0.036
    shaft = M.limb("spearshaft", (x, y, 0.020), (x, y - 0.012, 2.080),
                   0.022, 0.019, segments=8)
    parts.append(fin(shaft, "torchWood", smooth=True))
    head = M.lathe("spearhead", [(0.020, 2.060), (0.036, 2.096), (0.044, 2.150),
                                 (0.034, 2.240), (0.018, 2.310), (0.0, 2.352)],
                   segments=8, smooth=False)
    head.location = (x, y - 0.012, 0.0)
    parts.append(fin(head, "steel"))
    for i, z in enumerate((2.040, 2.012)):
        band = M.lathe(f"spearband{i}", [(0.026, z), (0.028, z + 0.016), (0.026, z + 0.020)],
                       segments=8, smooth=False)
        band.location = (x, y - 0.012, 0.0)
        parts.append(fin(band, "bronze"))
    tas = sweep("speartassel", [(x, y + 0.010, 2.006), (x + 0.010, y + 0.028, 1.940),
                                (x + 0.006, y + 0.020, 1.888)],
                [0.020, 0.024, 0.014], 0.014, n=6, smooth=True)
    parts.append(fin(tas, "clothRed"))
    return parts


# ------------------------------------------------------------------- assembly

def _lean(ob, amount, z0=0.98, hunch=0.0):
    if not amount and not hunch:
        return
    for v in ob.data.vertices:
        d = max(0.0, v.co.z - z0)
        if d <= 0.0:
            continue
        k = (d / 0.85) ** 1.35
        v.co.y += amount * k
        v.co.z -= hunch * k


def _seg_dist(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    if l2 < 1e-12:
        return (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


def _skin(ob, arm, power=5.0, cutoff=1.85, passes=2, limit=4):
    """
    Deterministic geometric skinning.

    Blender's bone-heat solver fails intermittently on layered clothing (a robe
    skirt is a shell floating around the legs, which is exactly the case it
    cannot solve) and, when it succeeds, emits weights a hair above 1.0 that
    make the mesh fail validation on export. Nearest-bone-segment weights with a
    relative cutoff, a couple of Laplacian smoothing passes and a hard 4-influence
    limit are stable, fast, and give cloth the "follows the nearest limb" motion
    we actually want.
    """
    bones = [(b.name, b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones]
    me = ob.data
    mw = ob.matrix_world
    W = []
    for v in me.vertices:
        p = mw @ v.co
        ds = sorted((_seg_dist(p, a, b), name) for name, a, b in bones)
        dmin = max(ds[0][0], 1e-4)
        acc, tot = {}, 0.0
        for d, name in ds[:6]:
            if d > dmin * cutoff:
                break
            w = 1.0 / (max(d, 1e-4) ** power)
            acc[name] = w
            tot += w
        W.append({k: w / tot for k, w in acc.items()})

    if passes:
        adj = [[] for _ in range(len(me.vertices))]
        for e in me.edges:
            a, b = e.vertices
            adj[a].append(b)
            adj[b].append(a)
        for _ in range(passes):
            out = []
            for i, w in enumerate(W):
                acc = dict(w)
                for j in adj[i]:
                    for k, val in W[j].items():
                        acc[k] = acc.get(k, 0.0) + val * 0.6
                s = sum(acc.values()) or 1.0
                out.append({k: val / s for k, val in acc.items()})
            W = out

    groups = {}
    for name, _a, _b in bones:
        groups[name] = ob.vertex_groups.new(name=name)
    for i, w in enumerate(W):
        top = sorted(w.items(), key=lambda kv: -kv[1])[:limit]
        s = sum(v for _k, v in top) or 1.0
        for name, val in top:
            groups[name].add([i], min(1.0, max(0.0, val / s)), "REPLACE")

    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    ob.parent = arm
    me.validate(verbose=False)


def _assemble(**over):
    sp = dict(BASE)
    sp.update(over)

    torso, rings = p_torso(sp)
    fin(torso, sp.get("body_mat", sp["skin"]))
    parts = [torso]
    parts.append(fin(p_neck(sp), sp["skin"]))
    parts += p_head(sp)
    parts += p_hair(sp)
    parts += p_beard(sp)
    parts += p_arms(sp)
    parts += p_legs(sp)
    parts += p_boots(sp)

    for cfg_name in ("shell", "shell2"):
        cfg = sp.get(cfg_name)
        if cfg:
            parts.append(p_shell(sp, rings, cfg, name=cfg_name))
    parts += p_robe(sp)
    parts += p_tabard(sp, rings)
    parts += p_sleeves(sp)
    parts += p_lapel(sp, rings)
    parts += p_collar(sp, rings)
    parts += p_belt(sp, rings)
    parts += p_sash(sp, rings)
    parts += p_tassets(sp, rings)
    parts += p_pauldrons(sp)
    parts += p_bracers(sp)
    parts += p_apron(sp, rings)
    parts += p_satchel(sp, rings)
    parts += p_cap(sp)

    for t in (sp.get("trim") or []):
        z = t["z"]
        rx, ryf, ryb = _tr_at(rings, z)
        k = t.get("pad", 0.026)
        w = t.get("w", 0.016)
        band = loft_capped(f"trim{z:.3f}", [
            oval(z - w, rx + k, ryf + k, ryb + k, SEG_TORSO, sp["torso_p"]),
            oval(z + w, rx + k, ryf + k, ryb + k, SEG_TORSO, sp["torso_p"])],
            smooth=False)
        parts.append(fin(band, t.get("mat", "gold")))

    parts = [p for p in parts if p is not None]
    for ob in parts:
        M.apply_all_modifiers(ob)

    body = M.join(parts, sp["name"])
    _lean(body, sp.get("lean", 0.0), hunch=sp.get("hunch", 0.0))
    M.apply_transform(body, location=True)
    M.uv_unwrap(body)

    # Parts that should not deform: a cape hangs off the shoulders as a stiff
    # sheet and a spear is a stick in a fist. Rigid-binding them is both cheaper
    # and better-looking than letting them stretch with the legs.
    rigid = []
    for group, bone in ((p_cape(sp, rings), "chest"),
                        (p_spear() if sp.get("spear") else [], "wristR")):
        group = [g for g in group if g is not None]
        if not group:
            continue
        for ob in group:
            M.apply_all_modifiers(ob)
        rm = M.join(group, f"{sp['name']}_{bone}")
        M.apply_transform(rm, location=True)
        M.uv_unwrap(rm)
        rigid.append((rm, bone))

    arm = R.build_armature("rig")
    _skin(body, arm)
    for ob, bone in rigid:
        R.rigid_bind(ob, arm, bone)
        ob.data.validate(verbose=False)
    R.add_attach_empties(arm)

    s = sp.get("scale", 1.0)
    if abs(s - 1.0) > 1e-4:
        arm.scale = (s, s, s)
    return body, arm


# --------------------------------------------------------------- the roster

def _warrior_common():
    return dict(
        sh_w=0.228, sh_d=0.128, wa_w=0.160, wa_d=0.112, hi_w=0.166, hi_d=0.120,
        neck_r=0.068, arm=(0.074, 0.056, 0.042), delt=0.090,
        leg=(0.126, 0.094, 0.052), stance=0.014, lean=0.030,
        torso_p=0.80,
    )


def char_warrior_m():
    _assemble(
        name="char_warrior_m", skin="skin.tan", scale=1.01,
        **_warrior_common(),
        head=dict(jaw=1.35, brow=1.35, cheek=1.1),
        hair=dict(style="topknot", mat="chitin", band="clothRed"),
        beard=dict(style="goatee", mat="chitin"),
        shell=dict(z0=1.075, z1=1.520, pad=0.024, mat="iron", smooth=False, steps=8),
        shell2=dict(z0=1.290, z1=1.470, pad=0.040, mat="steel", smooth=False, steps=4),
        pauldron=dict(mat="steel", r=0.155, out=0.118, layers=2, spike="bronze"),
        belt=dict(z=1.085, w=0.062, mat="leather", pad=0.030, buckle="gold"),
        tassets=dict(mat="leather", n=9, z0=1.040, drop=0.300),
        bracers=dict(mat="iron"),
        boots=dict(top=0.580, mat="iron", pad=0.028, cuff=0.030, plate=True,
                   plate_mat="steel"),
        trim=[dict(z=1.500, mat="bronze", pad=0.030, w=0.012)],
    )


def char_warrior_f():
    _assemble(
        name="char_warrior_f", skin="skin.pale", scale=0.955,
        sh_w=0.192, sh_d=0.112, wa_w=0.122, wa_d=0.092, hi_w=0.158, hi_d=0.118,
        bust=0.026, neck_r=0.052, arm=(0.058, 0.045, 0.034), delt=0.074,
        leg=(0.112, 0.084, 0.046), stance=0.006, lean=0.020, torso_p=0.86,
        head=dict(jaw=0.80, brow=0.70, cheek=1.25, narrow=0.94, scale=0.97),
        hair=dict(style="bun_high", mat="chitin", pin="gold"),
        shell=dict(z0=1.080, z1=1.500, pad=0.022, mat="steel", smooth=False, steps=8),
        shell2=dict(z0=1.300, z1=1.460, pad=0.034, mat="steel", smooth=False, steps=4),
        pauldron=dict(mat="steel", r=0.126, out=0.098, layers=1),
        belt=dict(z=1.078, w=0.052, mat="leather", pad=0.026, buckle="gold"),
        tassets=dict(mat="clothRed", n=7, z0=1.030, drop=0.340),
        bracers=dict(mat="steel"),
        boots=dict(top=0.520, mat="steel", pad=0.022, cuff=0.026, plate=True,
                   plate_mat="steel"),
        trim=[dict(z=1.470, mat="gold", pad=0.028, w=0.010)],
    )


def char_mage_m():
    _assemble(
        name="char_mage_m", skin="skin.pale", scale=1.025,
        sh_w=0.176, sh_d=0.104, wa_w=0.132, wa_d=0.094, hi_w=0.146, hi_d=0.108,
        neck_r=0.050, arm=(0.052, 0.041, 0.032), delt=0.064,
        leg=(0.100, 0.076, 0.044), torso_p=0.90,
        head=dict(jaw=0.85, brow=1.15, cheek=1.25, narrow=0.93, scale=0.99),
        hair=dict(style="topknot", mat="chitin", band="gold"),
        beard=dict(style="goatee", mat="chitin"),
        shell=dict(z0=1.060, z1=1.520, pad=0.024, mat="clothBlue", steps=8, noise=0.005),
        robe=dict(z_top=1.130, z_bot=0.032, rt=0.180, rb=0.318, folds=7, amp=0.026,
                  mat="clothBlue", steps=11, n=20, seed=2.1),
        sleeve=dict(rt=0.084, rb=0.178, z_bot=0.930, mat="clothBlue", steps=8,
                    n=13, folds=5, cuff="silk"),
        collar=dict(mat="silk", z0=1.430, z1=1.700, flare=0.050, thick=0.016),
        belt=dict(z=1.108, w=0.038, mat="gold", pad=0.026),
        boots=dict(top=0.180, mat="leather", pad=0.014, cuff=0.010),
        trim=[dict(z=1.300, mat="gold", pad=0.030, w=0.010)],
    )


def char_mage_f():
    _assemble(
        name="char_mage_f", skin="skin.pale", scale=0.965,
        sh_w=0.152, sh_d=0.096, wa_w=0.108, wa_d=0.084, hi_w=0.146, hi_d=0.110,
        bust=0.026, neck_r=0.044, arm=(0.048, 0.038, 0.030), delt=0.058,
        leg=(0.100, 0.076, 0.043), torso_p=0.92,
        head=dict(jaw=0.72, brow=0.60, cheek=1.30, narrow=0.92, scale=0.96),
        hair=dict(style="long", mat="chitin"),
        shell=dict(z0=1.040, z1=1.510, pad=0.022, mat="clothBlue", steps=8, noise=0.005),
        robe=dict(z_top=1.110, z_bot=0.026, rt=0.168, rb=0.336, folds=9, amp=0.024,
                  mat="clothBlue", steps=12, n=22, seed=4.4, squash=0.88),
        sleeve=dict(rt=0.074, rb=0.166, z_bot=0.920, mat="clothBlue", steps=8,
                    n=13, folds=6, cuff="silk"),
        collar=dict(mat="silk", z0=1.400, z1=1.672, flare=0.044, thick=0.014),
        belt=dict(z=1.086, w=0.032, mat="gold", pad=0.024),
        boots=dict(top=0.160, mat="leather", pad=0.012, cuff=0.008),
        trim=[dict(z=1.280, mat="silk", pad=0.028, w=0.012)],
    )


def char_taoist_m():
    _assemble(
        name="char_taoist_m", skin="skin.tan", scale=1.0,
        sh_w=0.194, sh_d=0.114, wa_w=0.144, wa_d=0.102, hi_w=0.154, hi_d=0.114,
        neck_r=0.056, arm=(0.058, 0.045, 0.035), delt=0.072,
        leg=(0.110, 0.082, 0.047), torso_p=0.86,
        head=dict(jaw=1.05, brow=1.05, cheek=1.05),
        hair=dict(style="topknot", mat="chitin", band="silk"),
        beard=dict(style="goatee", mat="chitin"),
        shell=dict(z0=1.050, z1=1.510, pad=0.024, mat="clothWhite", steps=8, noise=0.005),
        robe=dict(z_top=1.100, z_bot=0.078, rt=0.172, rb=0.262, folds=6, amp=0.019,
                  mat="clothWhite", steps=10, n=18, seed=1.4),
        sleeve=dict(rt=0.080, rb=0.122, z_bot=0.946, mat="clothWhite", steps=7,
                    n=12, folds=4),
        lapel=dict(mat="clothWhite", trim="silk", z_top=1.500, z_bot=1.060),
        sash=dict(z=1.096, w=0.084, mat="silk", tails=True),
        cap="daoist",
        boots=dict(top=0.220, mat="leather", pad=0.014, cuff=0.012),
    )


def char_taoist_f():
    _assemble(
        name="char_taoist_f", skin="skin.pale", scale=0.960,
        sh_w=0.160, sh_d=0.098, wa_w=0.112, wa_d=0.086, hi_w=0.148, hi_d=0.112,
        bust=0.024, neck_r=0.046, arm=(0.050, 0.040, 0.031), delt=0.060,
        leg=(0.104, 0.078, 0.044), torso_p=0.90,
        head=dict(jaw=0.74, brow=0.65, cheek=1.28, narrow=0.93, scale=0.96),
        hair=dict(style="bun", mat="chitin", pin="gold"),
        shell=dict(z0=1.030, z1=1.500, pad=0.022, mat="clothWhite", steps=8, noise=0.005),
        robe=dict(z_top=1.080, z_bot=0.064, rt=0.164, rb=0.276, folds=8, amp=0.020,
                  mat="clothWhite", steps=11, n=20, seed=5.2, squash=0.89),
        sleeve=dict(rt=0.072, rb=0.116, z_bot=0.936, mat="clothWhite", steps=7,
                    n=12, folds=5),
        lapel=dict(mat="clothWhite", trim="silk", z_top=1.470, z_bot=1.040),
        sash=dict(z=1.070, w=0.070, mat="silk", tails=True),
        boots=dict(top=0.180, mat="leather", pad=0.012, cuff=0.010),
    )


# ------------------------------------------------------------------- the NPCs

def npc_blacksmith():
    _assemble(
        name="npc_blacksmith", skin="skin.tan", scale=1.0,
        sh_w=0.244, sh_d=0.138, wa_w=0.190, wa_d=0.138, hi_w=0.186, hi_d=0.134,
        belly=0.026, neck_r=0.074, arm=(0.082, 0.062, 0.046), delt=0.098,
        leg=(0.132, 0.098, 0.056), stance=0.020, lean=0.045, torso_p=0.82,
        head=dict(jaw=1.45, brow=1.40, cheek=1.0, scale=1.02),
        hair=dict(style="topknot", mat="chitin", band="leather", hairline=1.766),
        beard=dict(style="full", mat="chitin"),
        shell=dict(z0=1.060, z1=1.480, pad=0.024, mat="sackcloth", steps=7, noise=0.007),
        sleeve=dict(rt=0.094, rb=0.098, z_bot=1.250, mat="sackcloth", steps=4,
                    n=11, folds=4, cuff="leather"),
        apron=dict(mat="leather", z0=1.400, z1=0.600),
        belt=dict(z=1.090, w=0.060, mat="leather", pad=0.034, buckle="bronze"),
        boots=dict(top=0.320, mat="leather", pad=0.022, cuff=0.024),
    )


def npc_apothecary():
    _assemble(
        name="npc_apothecary", skin="skin.pale", scale=0.945,
        sh_w=0.168, sh_d=0.100, wa_w=0.132, wa_d=0.100, hi_w=0.142, hi_d=0.108,
        neck_r=0.048, arm=(0.050, 0.040, 0.031), delt=0.062,
        leg=(0.100, 0.076, 0.044), lean=0.160, hunch=0.045, torso_p=0.88,
        head=dict(jaw=0.90, brow=1.30, cheek=0.80, scale=0.99),
        hair=dict(style="topknot", mat="furGrey", band="sackcloth", hairline=1.786),
        beard=dict(style="long", mat="furGrey"),
        shell=dict(z0=1.040, z1=1.500, pad=0.024, mat="clothWhite", steps=8, noise=0.006),
        robe=dict(z_top=1.090, z_bot=0.120, rt=0.164, rb=0.226, folds=6, amp=0.018,
                  mat="clothWhite", steps=9, n=16, seed=6.1),
        sleeve=dict(rt=0.074, rb=0.118, z_bot=0.960, mat="clothWhite", steps=6,
                    n=11, folds=4),
        sash=dict(z=1.088, w=0.062, mat="sackcloth", tails=False),
        satchel=dict(mat="leather", flap="sackcloth", side=-1),
        boots=dict(top=0.180, mat="leather", pad=0.012, cuff=0.010),
    )


def npc_general_store():
    _assemble(
        name="npc_general_store", skin="skin.tan", scale=0.985,
        sh_w=0.206, sh_d=0.122, wa_w=0.170, wa_d=0.124, hi_w=0.166, hi_d=0.122,
        belly=0.020, neck_r=0.060, arm=(0.064, 0.049, 0.037), delt=0.080,
        leg=(0.116, 0.088, 0.050), torso_p=0.84, lean=0.020,
        head=dict(jaw=1.15, brow=1.0, cheek=0.9, scale=1.01),
        hair=dict(style="topknot", mat="chitin", band="sackcloth"),
        beard=dict(style="goatee", mat="chitin"),
        shell=dict(z0=1.050, z1=1.500, pad=0.026, mat="sackcloth", steps=8, noise=0.008),
        robe=dict(z_top=1.100, z_bot=0.240, rt=0.176, rb=0.230, folds=5, amp=0.018,
                  mat="sackcloth", steps=8, n=16, seed=3.3, noise=0.008),
        sleeve=dict(rt=0.086, rb=0.108, z_bot=1.060, mat="sackcloth", steps=5,
                    n=11, folds=4),
        apron=dict(mat="sackcloth", z0=1.260, z1=0.760),
        belt=dict(z=1.096, w=0.052, mat="leather", pad=0.032, buckle="bronze"),
        satchel=dict(mat="leather", side=1),
        cap="kerchief", cap_mat="sackcloth",
        boots=dict(top=0.240, mat="leather", pad=0.016, cuff=0.016),
    )


def npc_tailor():
    _assemble(
        name="npc_tailor", skin="skin.pale", scale=0.970,
        sh_w=0.164, sh_d=0.098, wa_w=0.116, wa_d=0.086, hi_w=0.150, hi_d=0.112,
        bust=0.022, neck_r=0.046, arm=(0.050, 0.040, 0.031), delt=0.060,
        leg=(0.102, 0.078, 0.044), torso_p=0.90,
        head=dict(jaw=0.74, brow=0.62, cheek=1.24, narrow=0.92, scale=0.96),
        hair=dict(style="bun", mat="chitin", pin="bronze"),
        shell=dict(z0=1.030, z1=1.500, pad=0.022, mat="silk", steps=8, noise=0.004),
        robe=dict(z_top=1.080, z_bot=0.060, rt=0.162, rb=0.290, folds=9, amp=0.022,
                  mat="silk", steps=11, n=20, seed=7.7, squash=0.88),
        sleeve=dict(rt=0.072, rb=0.140, z_bot=0.940, mat="silk", steps=7,
                    n=12, folds=6, cuff="gold"),
        lapel=dict(mat="silk", trim="gold", z_top=1.470, z_bot=1.040),
        sash=dict(z=1.070, w=0.076, mat="clothRed", tails=True),
        collar=dict(mat="clothRed", z0=1.400, z1=1.630, flare=0.030, thick=0.012),
        boots=dict(top=0.160, mat="leather", pad=0.012, cuff=0.008),
    )


def npc_storage():
    _assemble(
        name="npc_storage", skin="skin.tan", scale=1.0,
        sh_w=0.212, sh_d=0.124, wa_w=0.158, wa_d=0.112, hi_w=0.162, hi_d=0.118,
        neck_r=0.062, arm=(0.066, 0.050, 0.038), delt=0.082,
        leg=(0.118, 0.088, 0.050), torso_p=0.85,
        head=dict(jaw=1.20, brow=1.10, cheek=0.95),
        hair=dict(style="queue", mat="chitin", hairline=1.780),
        beard=dict(style="goatee", mat="chitin"),
        shell=dict(z0=1.055, z1=1.510, pad=0.024, mat="clothWhite", steps=8, noise=0.005),
        shell2=dict(z0=1.140, z1=1.470, pad=0.040, mat="leather", steps=5, smooth=False),
        robe=dict(z_top=1.100, z_bot=0.180, rt=0.174, rb=0.244, folds=6, amp=0.019,
                  mat="clothWhite", steps=9, n=16, seed=8.8),
        sleeve=dict(rt=0.082, rb=0.112, z_bot=1.020, mat="clothWhite", steps=5,
                    n=11, folds=4),
        belt=dict(z=1.098, w=0.056, mat="leather", pad=0.036, buckle="bronze"),
        satchel=dict(mat="leather", side=-1),
        boots=dict(top=0.280, mat="leather", pad=0.018, cuff=0.018),
    )


def npc_guard():
    _assemble(
        name="npc_guard", skin="skin.tan", scale=1.02,
        sh_w=0.222, sh_d=0.126, wa_w=0.156, wa_d=0.110, hi_w=0.164, hi_d=0.118,
        neck_r=0.066, arm=(0.070, 0.054, 0.041), delt=0.086,
        leg=(0.122, 0.092, 0.051), stance=0.012, torso_p=0.82,
        head=dict(jaw=1.25, brow=1.20, cheek=1.0),
        hair=dict(style="short", mat="chitin", hairline=1.760),
        shell=dict(z0=1.070, z1=1.510, pad=0.024, mat="iron", smooth=False, steps=8),
        tabard=dict(mat="clothRed", z0=1.470, z1=0.820),
        pauldron=dict(mat="iron", r=0.132, out=0.098, layers=1),
        belt=dict(z=1.090, w=0.056, mat="leather", pad=0.032, buckle="bronze"),
        tassets=dict(mat="leather", n=7, z0=1.036, drop=0.260),
        bracers=dict(mat="iron"),
        cap="helmet", cap_mat="iron",
        boots=dict(top=0.440, mat="leather", pad=0.022, cuff=0.024, plate=True,
                   plate_mat="iron"),
        spear=True,
    )


def npc_master_warrior():
    _assemble(
        name="npc_master_warrior", skin="skin.tan", scale=1.04,
        sh_w=0.238, sh_d=0.134, wa_w=0.166, wa_d=0.116, hi_w=0.170, hi_d=0.122,
        neck_r=0.072, arm=(0.078, 0.058, 0.044), delt=0.094,
        leg=(0.130, 0.096, 0.054), stance=0.016, lean=0.026, torso_p=0.80,
        head=dict(jaw=1.45, brow=1.45, cheek=1.05, scale=1.02),
        hair=dict(style="topknot", mat="furGrey", band="gold"),
        beard=dict(style="full", mat="furGrey"),
        shell=dict(z0=1.070, z1=1.520, pad=0.026, mat="steel", smooth=False, steps=8),
        shell2=dict(z0=1.280, z1=1.480, pad=0.044, mat="gold", smooth=False, steps=4),
        cape=dict(mat="clothRed", z0=1.500, z1=0.280, clasp="gold"),
        pauldron=dict(mat="steel", r=0.172, out=0.132, layers=2, spike="gold"),
        belt=dict(z=1.086, w=0.066, mat="leather", pad=0.032, buckle="gold"),
        tassets=dict(mat="clothRed", n=11, z0=1.042, drop=0.330),
        bracers=dict(mat="gold"),
        boots=dict(top=0.600, mat="steel", pad=0.030, cuff=0.032, plate=True,
                   plate_mat="gold"),
        trim=[dict(z=1.500, mat="gold", pad=0.032, w=0.012),
              dict(z=1.180, mat="gold", pad=0.030, w=0.010)],
    )


def npc_master_mage():
    _assemble(
        name="npc_master_mage", skin="skin.pale", scale=1.035,
        sh_w=0.180, sh_d=0.106, wa_w=0.138, wa_d=0.098, hi_w=0.150, hi_d=0.110,
        neck_r=0.052, arm=(0.054, 0.043, 0.033), delt=0.066,
        leg=(0.102, 0.078, 0.045), torso_p=0.90,
        head=dict(jaw=0.95, brow=1.35, cheek=0.85, scale=1.0),
        hair=dict(style="topknot", mat="furWhite", band="gold", hairline=1.790),
        beard=dict(style="long", mat="furWhite"),
        shell=dict(z0=1.060, z1=1.520, pad=0.026, mat="clothBlue", steps=8, noise=0.005),
        robe=dict(z_top=1.140, z_bot=0.022, rt=0.186, rb=0.348, folds=8, amp=0.028,
                  mat="clothBlue", steps=12, n=22, seed=9.3),
        sleeve=dict(rt=0.088, rb=0.198, z_bot=0.910, mat="clothBlue", steps=8,
                    n=14, folds=5, cuff="gold"),
        collar=dict(mat="gold", z0=1.420, z1=1.760, flare=0.070, thick=0.018),
        belt=dict(z=1.112, w=0.044, mat="gold", pad=0.028),
        cap="crown",
        boots=dict(top=0.180, mat="leather", pad=0.014, cuff=0.010),
        trim=[dict(z=1.300, mat="gold", pad=0.032, w=0.012)],
    )


def npc_master_taoist():
    _assemble(
        name="npc_master_taoist", skin="skin.tan", scale=1.01,
        sh_w=0.198, sh_d=0.116, wa_w=0.150, wa_d=0.106, hi_w=0.158, hi_d=0.116,
        neck_r=0.058, arm=(0.060, 0.047, 0.036), delt=0.074,
        leg=(0.112, 0.084, 0.048), torso_p=0.86, lean=0.015,
        head=dict(jaw=1.10, brow=1.25, cheek=0.95, scale=1.01),
        hair=dict(style="topknot", mat="furGrey", band="gold", hairline=1.784),
        beard=dict(style="long", mat="furGrey"),
        shell=dict(z0=1.055, z1=1.515, pad=0.026, mat="clothWhite", steps=8, noise=0.005),
        robe=dict(z_top=1.110, z_bot=0.062, rt=0.180, rb=0.288, folds=7, amp=0.022,
                  mat="clothWhite", steps=11, n=20, seed=2.7),
        sleeve=dict(rt=0.084, rb=0.144, z_bot=0.930, mat="clothWhite", steps=7,
                    n=12, folds=5, cuff="gold"),
        lapel=dict(mat="clothWhite", trim="gold", z_top=1.510, z_bot=1.070),
        sash=dict(z=1.100, w=0.092, mat="silk", tails=True),
        cap="daoist",
        boots=dict(top=0.220, mat="leather", pad=0.014, cuff=0.012),
        trim=[dict(z=1.290, mat="gold", pad=0.032, w=0.010)],
    )


def npc_villager_m():
    _assemble(
        name="npc_villager_m", skin="skin.tan", scale=0.975,
        sh_w=0.198, sh_d=0.116, wa_w=0.150, wa_d=0.108, hi_w=0.156, hi_d=0.116,
        neck_r=0.058, arm=(0.060, 0.046, 0.035), delt=0.074,
        leg=(0.112, 0.084, 0.048), torso_p=0.85, lean=0.028,
        head=dict(jaw=1.15, brow=1.05, cheek=0.9),
        hair=dict(style="topknot", mat="chitin", band="sackcloth", hairline=1.768),
        shell=dict(z0=1.050, z1=1.490, pad=0.024, mat="sackcloth", steps=7, noise=0.009),
        robe=dict(z_top=1.090, z_bot=0.420, rt=0.170, rb=0.212, folds=5, amp=0.018,
                  mat="sackcloth", steps=7, n=14, seed=4.9, noise=0.009),
        sleeve=dict(rt=0.084, rb=0.092, z_bot=1.180, mat="sackcloth", steps=4,
                    n=10, folds=3),
        belt=dict(z=1.086, w=0.038, mat="leather", pad=0.028),
        boots=dict(top=0.200, mat="leather", pad=0.014, cuff=0.012),
    )


def npc_villager_f():
    _assemble(
        name="npc_villager_f", skin="skin.pale", scale=0.945,
        sh_w=0.158, sh_d=0.096, wa_w=0.114, wa_d=0.086, hi_w=0.150, hi_d=0.112,
        bust=0.024, neck_r=0.046, arm=(0.050, 0.040, 0.031), delt=0.060,
        leg=(0.104, 0.078, 0.044), torso_p=0.90,
        head=dict(jaw=0.76, brow=0.62, cheek=1.22, narrow=0.93, scale=0.96),
        hair=dict(style="bun", mat="chitin", pin="bronze"),
        shell=dict(z0=1.030, z1=1.490, pad=0.022, mat="clothRed", steps=8, noise=0.006),
        robe=dict(z_top=1.080, z_bot=0.100, rt=0.162, rb=0.264, folds=8, amp=0.020,
                  mat="sackcloth", steps=10, n=18, seed=6.6, squash=0.89, noise=0.008),
        sleeve=dict(rt=0.072, rb=0.096, z_bot=1.060, mat="clothRed", steps=5,
                    n=10, folds=4),
        apron=dict(mat="sackcloth", z0=1.120, z1=0.480),
        sash=dict(z=1.072, w=0.058, mat="clothWhite", tails=False),
        cap="kerchief", cap_mat="clothWhite",
        boots=dict(top=0.150, mat="leather", pad=0.012, cuff=0.008),
    )


ASSETS = {
    "char_warrior_m":     ("character", char_warrior_m),
    "char_warrior_f":     ("character", char_warrior_f),
    "char_mage_m":        ("character", char_mage_m),
    "char_mage_f":        ("character", char_mage_f),
    "char_taoist_m":      ("character", char_taoist_m),
    "char_taoist_f":      ("character", char_taoist_f),
    "npc_blacksmith":     ("character", npc_blacksmith),
    "npc_apothecary":     ("character", npc_apothecary),
    "npc_general_store":  ("character", npc_general_store),
    "npc_tailor":         ("character", npc_tailor),
    "npc_storage":        ("character", npc_storage),
    "npc_guard":          ("character", npc_guard),
    "npc_master_warrior": ("character", npc_master_warrior),
    "npc_master_mage":    ("character", npc_master_mage),
    "npc_master_taoist":  ("character", npc_master_taoist),
    "npc_villager_m":     ("character", npc_villager_m),
    "npc_villager_f":     ("character", npc_villager_f),
}
