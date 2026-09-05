# sprite-fit.py IN.png OUT.png REFERENCE_PAINTING [--sat 1.25] [--contrast 0.85]
# Pulls a keyed sprite toward the painting it will sit on: matches saturation (mean HSV S of the sprite's opaque
# pixels to --sat x the painting's mean S), softens contrast toward the painting's luminance range, and
# tints the shadows slightly toward the painting's average shadow hue. Also reports the numbers. Python 2.7 + PIL + numpy.
import sys
import numpy as np
from PIL import Image
args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = dict(zip([a for a in sys.argv[1:] if a.startswith("--")], [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a.startswith("--") and i + 1 < len(sys.argv)]))
src, dst, ref = args[0], args[1], args[2]
sat_ratio = float(opts.get("--sat", 1.25)); contrast = float(opts.get("--contrast", 0.85))

def hsv_stats(rgb):
    x = rgb.astype(np.float32) / 255.0
    mx = x.max(axis=-1); mn = x.min(axis=-1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return s, mx

refim = Image.open(ref).convert("RGB")
refim.thumbnail((512, 512))
ra = np.asarray(refim)
rs, rv = hsv_stats(ra)
ref_s = float(rs.mean()); ref_v_lo, ref_v_hi = float(np.percentile(rv, 5)), float(np.percentile(rv, 95))

im = Image.open(src).convert("RGBA")
a = np.asarray(im).astype(np.float32)
rgb, alpha = a[..., :3], a[..., 3]
mask = alpha > 128
ss, sv = hsv_stats(rgb[mask])
spr_s = float(ss.mean())
target_s = min(spr_s, ref_s * sat_ratio)
k = target_s / max(spr_s, 1e-6)            # <= 1: reduce saturation toward the painting
grey = rgb.mean(axis=-1, keepdims=True)
rgb2 = grey + (rgb - grey) * k
# contrast: compress luminance range toward the painting's 5-95 range
lum = rgb2.mean(axis=-1, keepdims=True) / 255.0
lo, hi = float(np.percentile(lum[mask], 5)), float(np.percentile(lum[mask], 95))
mid = (lo + hi) / 2.0
rgb2 = (rgb2 / 255.0 - mid) * contrast + mid
# nudge toward the painting's range without crushing
rgb2 = np.clip(rgb2, 0, 1) * 255.0
# tint dark pixels slightly toward the painting's mean shadow colour
dark = ra.reshape(-1, 3)[rv.reshape(-1) < np.percentile(rv, 25)].mean(axis=0)
weight = np.clip((0.45 - rgb2.mean(axis=-1, keepdims=True) / 255.0) / 0.45, 0, 1) * 0.25
rgb2 = rgb2 * (1 - weight) + dark * weight
out = np.dstack([np.clip(rgb2, 0, 255), alpha]).astype(np.uint8)
Image.fromarray(out, "RGBA").save(dst)
ss2, _ = hsv_stats(np.asarray(Image.open(dst).convert("RGBA"))[..., :3][mask])
print("painting S %.3f | sprite S %.3f -> %.3f (k=%.2f) | lum %.2f-%.2f -> contrast x%.2f" % (ref_s, spr_s, float(ss2.mean()), k, lo, hi, contrast))
