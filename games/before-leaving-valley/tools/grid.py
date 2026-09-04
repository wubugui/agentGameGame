# grid.py PAINTING OUT.png [MARKERS.json]
# Draws the yaw/pitch grid of the 150x84 degree panorama section on a painting (any size), output 1280 wide.
# Optional MARKERS.json: [{"id":..,"yaw":..,"pitch":..,"kind":..,"sizeVh":..,"distance":..}] drawn as labelled boxes.
# yaw = (u-0.5)*150, pitch = (0.5-v)*84  (u,v in [0,1] across the painting). Python 2.7 + PIL.
import sys, json
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]
markers = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else []
im = Image.open(src).convert("RGB")
W = 1280; H = int(round(im.size[1] * W / float(im.size[0])))
im = im.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA")
try:
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 13); big = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 14)
except Exception:
    font = ImageFont.load_default(); big = font
def X(yaw): return W * (0.5 + yaw / 150.0)
def Y(pitch): return H * (0.5 - pitch / 84.0)
for yaw in range(-70, 71, 10):
    x = X(yaw); col = (255, 255, 255, 170) if yaw == 0 else (255, 255, 255, 90)
    d.line([(x, 0), (x, H)], fill=col, width=1)
    d.rectangle([x + 2, 2, x + 34, 17], fill=(0, 0, 0, 150)); d.text((x + 4, 3), "%+d" % yaw, fill=(255, 255, 255, 255), font=font)
    d.rectangle([x + 2, H - 18, x + 34, H - 3], fill=(0, 0, 0, 150)); d.text((x + 4, H - 17), "%+d" % yaw, fill=(255, 255, 255, 255), font=font)
for pitch in range(-40, 41, 10):
    y = Y(pitch); col = (255, 255, 255, 170) if pitch == 0 else (255, 255, 255, 90)
    d.line([(0, y), (W, y)], fill=col, width=1)
    d.rectangle([2, y + 2, 34, y + 17], fill=(0, 0, 0, 150)); d.text((4, y + 3), "%+d" % pitch, fill=(255, 255, 255, 255), font=font)
    d.rectangle([W - 36, y + 2, W - 2, y + 17], fill=(0, 0, 0, 150)); d.text((W - 34, y + 3), "%+d" % pitch, fill=(255, 255, 255, 255), font=font)
for yaw in range(-75, 76, 5):
    d.line([(X(yaw), Y(0) - 4), (X(yaw), Y(0) + 4)], fill=(255, 255, 255, 200))
for pitch in range(-40, 41, 5):
    d.line([(X(0) - 4, Y(pitch)), (X(0) + 4, Y(pitch))], fill=(255, 255, 255, 200))
COLORS = {"exit": (80, 200, 255), "blaze": (255, 90, 90), "sprite": (255, 210, 60), "interact": (120, 255, 140), "gaze": (220, 140, 255), "readable": (255, 160, 60)}
for m in markers:
    x, y = X(m["yaw"]), Y(m["pitch"])
    col = COLORS.get(m.get("kind", "interact"), (255, 255, 255))
    size = m.get("sizeVh"); dist = m.get("distance") or 10
    if size:
        hpx = H * (size / 100.0) * (60.0 / 84.0); wpx = hpx * 0.8; dist = dist
    else:
        hpx = wpx = 22
    d.rectangle([x - wpx / 2, y - hpx / 2, x + wpx / 2, y + hpx / 2], outline=col + (255,), width=2)
    d.line([(x - 8, y), (x + 8, y)], fill=col + (255,), width=2); d.line([(x, y - 8), (x, y + 8)], fill=col + (255,), width=2)
    label = "%s (%g,%g)" % (m["id"], m["yaw"], m["pitch"])
    tw = d.textsize(label, font=big)[0]
    d.rectangle([x + 6, y - hpx / 2 - 18, x + 10 + tw, y - hpx / 2 - 2], fill=(0, 0, 0, 180)); d.text((x + 8, y - hpx / 2 - 17), label, fill=col + (255,), font=big)
im.save(dst, "PNG")
print("saved %s (%d markers)" % (dst, len(markers)))
