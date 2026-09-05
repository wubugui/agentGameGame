# key-sprite.py IN OUT.png [--magenta]
# Chroma key on greenness (or magenta-ness) with a soft edge, edge erosion, aggressive despill of
# yellow-green fringes, and a crop to content with a 3% margin. Python 2.7 + PIL + numpy.
import sys
import numpy as np
from PIL import Image, ImageFilter
args = [a for a in sys.argv[1:] if not a.startswith("--")]
magenta = "--magenta" in sys.argv
src, dst = args[0], args[1]
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.float32)
h, w, _ = a.shape
r, g, b = a[..., 0].copy(), a[..., 1].copy(), a[..., 2].copy()
if magenta:
    keyness = (r + b) / 2.0 - g            # magenta ~ +120
    lo, hi = 20.0, 70.0
else:
    keyness = g - np.maximum(r, b)         # key green ~ +84, brown/skin/grey <= ~+10
    lo, hi = 14.0, 58.0
alpha = np.clip((hi - keyness) / (hi - lo), 0.0, 1.0)
# Also treat the pale, low-saturation halo the models paint around a subject as background when it is greenish.
if not magenta:
    halo = (g > r + 6) & (g > b + 25) & (alpha > 0.0)
    alpha = np.where(halo & (keyness > 8), np.minimum(alpha, 0.35), alpha)
# Erode the alpha by ~1.5 px so the last column of contaminated pixels goes away.
am = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(3))
alpha = np.asarray(am).astype(np.float32) / 255.0
alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32) / 255.0
# Despill: inside a 6 px band from the edge, and anywhere green dominates, pull green down.
edge = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(13))).astype(np.float32) / 255.0
band = (alpha > 0.02) & (edge < 0.98)
if magenta:
    spill = np.maximum(0.0, (r + b) / 2.0 - g)
    r = np.where(band, r - spill * 0.8, r); b = np.where(band, b - spill * 0.8, b)
else:
    spill_any = np.maximum(0.0, g - (r + b) / 2.0)            # green above the red/blue average
    spill_yg = np.maximum(0.0, g - b - 30.0) * 0.5              # yellow-green residue (r ~ g >> b)
    spill = np.where(band, np.maximum(spill_any, spill_yg), np.maximum(0.0, g - np.maximum(r, b) - 18.0))
    g = g - spill
    # yellow-green fringe: also lift blue a little toward neutral inside the band
    b = np.where(band, b + spill_yg * 0.6, b)
# Bleed the subject's edge colour outward into the transparent pixels. The engine scales sprites
# bilinearly, which mixes in whatever RGB sits under alpha=0; leaving the green screen there is what
# produces a green fringe at small sizes. 24 rings of nearest-neighbour fill covers any resample; the
# far field gets the subject's mean colour.
col = np.dstack([np.clip(r, 0, 255), np.clip(g, 0, 255), np.clip(b, 0, 255)]).astype(np.float32)
solid = alpha > 0.02
if solid.any():
    mean_col = col[solid].mean(axis=0)
    c = np.where(solid[..., None], col, 0.0)
    f = solid.astype(np.float32)
    for _ in range(24):
        if f.min() > 0.5:
            break
        acc = np.zeros_like(c); accw = np.zeros_like(f)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            acc += np.roll(np.roll(c, dy, 0), dx, 1) * np.roll(np.roll(f, dy, 0), dx, 1)[..., None]
            accw += np.roll(np.roll(f, dy, 0), dx, 1)
        upd = (accw > 0) & (f < 0.5)
        c = np.where(upd[..., None], acc / np.maximum(accw, 1e-6)[..., None], c)
        f = np.where(upd, 1.0, f)
    c = np.where((f < 0.5)[..., None], mean_col, c)
    col = c
out = np.dstack([np.clip(col[..., 0], 0, 255), np.clip(col[..., 1], 0, 255), np.clip(col[..., 2], 0, 255), alpha * 255.0]).astype(np.uint8)
img = Image.fromarray(out, "RGBA")
ys, xs = np.where(alpha > 0.05)
if len(xs) == 0:
    print("nothing left after keying"); sys.exit(1)
bw, bh = xs.max() - xs.min(), ys.max() - ys.min()
m = int(max(8, 0.03 * max(bw, bh)))
box = (max(0, xs.min() - m), max(0, ys.min() - m), min(w, xs.max() + m), min(h, ys.max() + m))
img.crop(box).save(dst)
left = int(((g - np.maximum(r, b) > 22) & (alpha > 0.5)).sum())
print("box", box, "opaque", int((alpha > 0.99).sum()), "semi", int(((alpha > 0.01) & (alpha < 0.99)).sum()), "green-left", left)
