#!/usr/bin/env python3
"""WordLight app icon: an open book whose lines of "words" are dim except one lit word — what the TV does.
Vega requires 512x512, 8-bit RGBA PNG, <= 1 MB (developer.amazon.com/docs/vega/0.21/manifest-package.html).
  python3 tools/vvd/make-icon.py   → apps/vega-tv/overlay/assets/image/wordlight-icon.png (needs Pillow)"""
import os
from PIL import Image, ImageDraw
S = 2048; k = S / 512                      # draw at 4x, downsample for clean edges
YEL, NAVY, DIM, LIT = (255, 209, 102, 255), (16, 24, 32, 255), (74, 96, 120, 255), (255, 209, 102, 255)
im = Image.new('RGBA', (S, S), YEL); d = ImageDraw.Draw(im)
def p(*xy): return [(x * k, y * k) for x, y in xy]
# open book: two pages meeting at a spine, top edges slightly lifted toward the spine
d.polygon(p((56, 150), (246, 130), (256, 150), (256, 410), (246, 392), (56, 408)), fill=NAVY)
d.polygon(p((456, 150), (266, 130), (256, 150), (256, 410), (266, 392), (456, 408)), fill=NAVY)
d.line(p((256, 148), (256, 410)), fill=YEL, width=int(6 * k))
def word(x, y, w, c): d.rounded_rectangle([x * k, y * k, (x + w) * k, (y + 18) * k], radius=9 * k, fill=c)
rows_l = [[(84, 46), (138, 70)], [(84, 80), (172, 44)], [(84, 30), (122, 58), (188, 34)], [(84, 64), (156, 60)], [(84, 40), (132, 84)]]
rows_r = [[(286, 70), (364, 62)], [(286, 40), (334, 92)], [(286, 58), (352, 74)], [(286, 86), (380, 42)], [(286, 52), (346, 60)]]
for r, row in enumerate(rows_l):
    for x, w in row: word(x, 182 + r * 42, w, DIM)
for r, row in enumerate(rows_r):
    for x, w in row: word(x, 182 + r * 42, w, LIT if (r, x) == (1, 334) else DIM)
out = os.path.join(os.path.dirname(__file__), '../../apps/vega-tv/overlay/assets/image/wordlight-icon.png')
im.resize((512, 512), Image.LANCZOS).save(out, optimize=True)
print('wrote', os.path.normpath(out))
