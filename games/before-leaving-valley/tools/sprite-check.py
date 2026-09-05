# sprite-check.py SPRITE.png PAINTING [--smax 0.283] [--vmin 0] [--vmax 1] [--vstd 1] [--dark 0]
# Mechanical gate for a keyed+fitted sprite against the painting it will sit on. Reports the sprite's
# mean saturation, mean value, value spread and the fraction of near-black pixels, plus the painting's
# own numbers, and exits non-zero when a threshold is missed. Python 2.7 + PIL + numpy.
import sys
import numpy as np
from PIL import Image
args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = {}
for i, a in enumerate(sys.argv):
    if a.startswith("--") and i + 1 < len(sys.argv):
        opts[a] = float(sys.argv[i + 1])
src, ref = args[0], args[1]

def stats(rgb):
    x = rgb.astype(np.float32) / 255.0
    mx = x.max(axis=-1); mn = x.min(axis=-1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return s, mx

refim = Image.open(ref).convert("RGB"); refim.thumbnail((512, 512))
rs, rv = stats(np.asarray(refim))
im = Image.open(src).convert("RGBA")
a = np.asarray(im).astype(np.float32)
mask = a[..., 3] > 128
ss, sv = stats(a[..., :3][mask])
S, V, VSTD = float(ss.mean()), float(sv.mean()), float(sv.std())
DARK = float((sv < 0.18).mean())
print("painting: S %.3f V %.3f Vstd %.3f" % (float(rs.mean()), float(rv.mean()), float(rv.std())))
print("sprite:   S %.3f V %.3f Vstd %.3f dark<0.18 %.3f%%" % (S, V, VSTD, DARK * 100))
fails = []
if S > opts.get("--smax", 1.0): fails.append("S %.3f > %.3f" % (S, opts["--smax"]))
if V < opts.get("--vmin", 0.0): fails.append("V %.3f < %.3f" % (V, opts["--vmin"]))
if V > opts.get("--vmax", 1.0): fails.append("V %.3f > %.3f" % (V, opts["--vmax"]))
if VSTD > opts.get("--vstd", 1.0): fails.append("Vstd %.3f > %.3f" % (VSTD, opts["--vstd"]))
if DARK > opts.get("--dark", 1.0): fails.append("dark %.3f%% > %.3f%%" % (DARK * 100, opts["--dark"] * 100))
print("GATE FAIL: " + "; ".join(fails) if fails else "GATE PASS")
sys.exit(1 if fails else 0)
