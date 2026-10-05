"""Deterministic flat illustrations for the WordLight test story (content/sources/wl-test-kite). Original, generated.
   python3 tools/content/make-test-art.py"""
from PIL import Image, ImageDraw
import math, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content/sources/wl-test-kite')
W, H = 1280, 720

def sky(d, top, bottom):
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))

def hill(d, color, cx=640, cy=900, r=700):
    d.ellipse([cx - r * 1.6, cy - r * 0.55, cx + r * 1.6, cy + r], fill=color)

def girl(d, x, y, s=1.0, skirt=(240, 120, 60)):
    d.ellipse([x - 22 * s, y - 120 * s, x + 22 * s, y - 76 * s], fill=(110, 70, 50))            # head
    d.polygon([(x, y - 78 * s), (x - 36 * s, y - 6 * s), (x + 36 * s, y - 6 * s)], fill=skirt)  # dress
    d.line([(x - 10 * s, y - 6 * s), (x - 14 * s, y + 30 * s)], fill=(110, 70, 50), width=int(7 * s))
    d.line([(x + 10 * s, y - 6 * s), (x + 14 * s, y + 30 * s)], fill=(110, 70, 50), width=int(7 * s))
    d.line([(x + 14 * s, y - 60 * s), (x + 50 * s, y - 100 * s)], fill=(110, 70, 50), width=int(7 * s))  # arm up
    return (x + 50 * s, y - 100 * s)

def kite(d, x, y, hand=None, s=1.0):
    d.polygon([(x, y - 60 * s), (x + 42 * s, y), (x, y + 70 * s), (x - 42 * s, y)], fill=(220, 40, 50))
    d.line([(x, y - 60 * s), (x, y + 70 * s)], fill=(250, 220, 120), width=3)
    d.line([(x - 42 * s, y), (x + 42 * s, y)], fill=(250, 220, 120), width=3)
    for k in range(5):  # tail bows
        tx, ty = x + 14 * k * s, y + 70 * s + 26 * k * s
        d.polygon([(tx - 10, ty - 6), (tx + 10, ty + 6), (tx + 10, ty - 6), (tx - 10, ty + 6)], fill=(255, 200, 60))
    if hand: d.line([hand, (x, y + 10 * s)], fill=(60, 60, 60), width=2)

def bird(d, x, y, s=1.0):
    d.arc([x - 60 * s, y - 20 * s, x, y + 30 * s], 200, 340, fill=(40, 40, 60), width=int(8 * s))
    d.arc([x, y - 20 * s, x + 60 * s, y + 30 * s], 200, 340, fill=(40, 40, 60), width=int(8 * s))

def clouds(d, pts):
    for (x, y) in pts:
        for dx, dy, r in [(0, 0, 40), (40, -14, 46), (84, 0, 38)]:
            d.ellipse([x + dx - r, y + dy - r, x + dx + r, y + dy + r], fill=(255, 255, 255))

def page(n, f):
    im = Image.new('RGB', (W, H)); d = ImageDraw.Draw(im); f(d); im.save(os.path.join(OUT, f'p{n}.png'), optimize=True)

def p1(d):
    sky(d, (120, 190, 240), (200, 230, 250)); clouds(d, [(200, 140), (900, 110)]); hill(d, (110, 180, 90))
    h = girl(d, 560, 560); kite(d, 700, 380, None, 1.1)
def p2(d):
    sky(d, (110, 180, 240), (190, 225, 250)); clouds(d, [(980, 160)]); hill(d, (90, 170, 80), 520, 860, 640)
    h = girl(d, 480, 450, 1.0, (60, 150, 230)); kite(d, 860, 200, h)
def p3(d):
    sky(d, (100, 170, 235), (185, 220, 250)); hill(d, (95, 165, 85))
    h = girl(d, 380, 600, 0.9); kite(d, 760, 230, h); bird(d, 980, 170, 1.3); bird(d, 1100, 250, 0.8)
def p4(d):
    sky(d, (250, 150, 90), (120, 70, 120)); d.ellipse([560, 420, 720, 580], fill=(255, 210, 90)); hill(d, (70, 110, 70))
    h = girl(d, 640, 600, 0.9); kite(d, 700, 470, None, 0.6)

os.makedirs(OUT, exist_ok=True)
for n, f in enumerate([p1, p2, p3, p4], 1): page(n, f)
print('wrote', OUT)
