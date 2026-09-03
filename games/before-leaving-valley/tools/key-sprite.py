# key.py IN OUT.png  -- greenness-based chroma key with soft edge, despill, crop to content (Python 2 compatible)
import sys
import numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.float32)
h, w, _ = a.shape
r, g, b = a[..., 0], a[..., 1], a[..., 2]
greenness = g - np.maximum(r, b)          # key green ~ +84, brown/skin/grey <= ~+10
lo, hi = 14.0, 58.0                        # <= lo fully opaque, >= hi fully transparent
alpha = np.clip((hi - greenness) / (hi - lo), 0.0, 1.0)
# despill: on any non-opaque pixel, pull green down to the red/blue average
edge = alpha < 0.995
spill = np.maximum(0.0, g - (r + b) / 2.0)
a[..., 1] = np.where(edge, g - spill, g)
out = np.dstack([a, alpha * 255.0]).astype(np.uint8)
img = Image.fromarray(out, "RGBA")
ys, xs = np.where(alpha > 0.05)
m = 10
box = (max(0, xs.min() - m), max(0, ys.min() - m), min(w, xs.max() + m), min(h, ys.max() + m))
img.crop(box).save(dst)
print("box", box, "opaque", int((alpha > 0.99).sum()), "semi", int(((alpha > 0.01) & (alpha < 0.99)).sum()))
