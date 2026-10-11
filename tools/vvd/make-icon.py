#!/usr/bin/env python3
"""WordLight app icon (option B, chosen 2026-10-11): a speech bubble holding an open book — reading aloud — on the
app's yellow. Everything sits in the middle 16:9 band, because the Vega launcher shows the square icon as a wide tile
(centre crop) while Settings shows it square. Vega requires 512x512, 8-bit RGBA PNG, <= 1 MB
(developer.amazon.com/docs/vega/0.21/manifest-package.html).
  python3 tools/vvd/make-icon.py   → apps/vega-tv/overlay/assets/image/wordlight-icon.png (needs Pillow)"""
import os
from PIL import Image, ImageDraw
S = 2048; k = S / 512                      # draw at 4x, downsample for clean edges
NAVY, YEL, WHITE = (16, 24, 32, 255), (255, 209, 102, 255), (255, 255, 255, 255)
im = Image.new('RGBA', (S, S), YEL); d = ImageDraw.Draw(im)
def R(x0, y0, x1, y1, r, fill): d.rounded_rectangle([x0 * k, y0 * k, x1 * k, y1 * k], radius=r * k, fill=fill)
R(104, 128, 408, 340, 64, NAVY)                                                   # speech bubble
d.polygon([(150 * k, 330 * k), (214 * k, 330 * k), (136 * k, 392 * k)], fill=NAVY)  # its tail
d.polygon([(158*k, 190*k), (250*k, 178*k), (256*k, 188*k), (256*k, 300*k), (250*k, 292*k), (158*k, 300*k)], fill=YEL)  # left page
d.polygon([(354*k, 190*k), (262*k, 178*k), (256*k, 188*k), (256*k, 300*k), (262*k, 292*k), (354*k, 300*k)], fill=YEL)  # right page
for i, (a, b) in enumerate([(172, 236), (172, 220), (172, 240)]): R(a, 206 + i * 28, b, 218 + i * 28, 6, NAVY)
for i, (a, b, c) in enumerate([(272, 340, NAVY), (272, 334, WHITE), (272, 326, NAVY)]): R(a, 206 + i * 28, b, 218 + i * 28, 6, c)  # one lit line
out = os.path.join(os.path.dirname(__file__), '../../apps/vega-tv/overlay/assets/image/wordlight-icon.png')
im.resize((512, 512), Image.LANCZOS).save(out, optimize=True)
print('wrote', os.path.normpath(out))
