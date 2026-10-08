#!/usr/bin/env python3
"""Import a StoryWeaver download (ZIP with <id>.pdf + StoryWeaverAttribution_<id>.txt) into content/sources/<id>/.

  python3 tools/content/import-storyweaver-pdf.py content/sources/1052-busy-ants.zip busy-ants --lang en-IN --level 1 \
      --url https://storyweaver.org.in/en/stories/1052-busy-ants

Story pages are the PDF pages that carry a page counter ("2/12"); each becomes one story page with that page's
illustration (the first embedded image, extracted losslessly) and its text (page counter removed, lines joined).
Credits come from StoryWeaver's own attribution file, copied verbatim — nothing is guessed. Needs poppler-utils
(pdftotext, pdfimages)."""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, unicodedata, zipfile

ap = argparse.ArgumentParser()
ap.add_argument("zip"); ap.add_argument("id")
ap.add_argument("--lang", required=True, choices=["en-IN", "hi-IN"]); ap.add_argument("--level", type=int, default=1)
ap.add_argument("--url", required=True)
ap.add_argument("--max-pages", type=int, default=0, help="keep only the first N story pages (e.g. drop an end-of-book activity page)")
a = ap.parse_args()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUT = os.path.join(ROOT, "content/sources", a.id)
tmp = tempfile.mkdtemp()
with zipfile.ZipFile(a.zip) as z:
    names = z.namelist()
    pdf = next(n for n in names if n.lower().endswith(".pdf")); att = next((n for n in names if n.startswith("StoryWeaverAttribution")), None)
    z.extract(pdf, tmp); att and z.extract(att, tmp)
pdf = os.path.join(tmp, pdf)
attribution_txt = open(os.path.join(tmp, att), encoding="utf-8").read() if att else ""
m = re.search(r"Attribution Text:\s*(.+?)\s*\n\s*\n", attribution_txt, re.S)
attribution = re.sub(r"\s+", " ", m.group(1)).strip() if m else None
if not attribution: sys.exit("no 'Attribution Text:' in the StoryWeaver attribution file — check the download")
def grab(rx):
    mm = re.search(rx, attribution); return mm.group(1).strip() if mm else None
title = grab(r"^(.+?) \(") or grab(r"^(.+?),"); author = grab(r"written by (.+?),"); illustrator = grab(r"illustrated by (.+?),")
publisher = grab(r"published by (.+?) \("); licence = grab(r"under a (CC BY[- A-Z]*\d\.\d) license")
if licence: licence = licence.replace("CC BY-SA", "CC BY-SA")
if licence not in ("CC BY 4.0", "CC BY-SA 4.0"): sys.exit(f"licence '{licence}' is not CC BY 4.0 / CC BY-SA 4.0 — not importing")
npages = int(re.search(r"Pages:\s+(\d+)", subprocess.check_output(["pdfinfo", pdf], text=True)).group(1))
listing = subprocess.check_output(["pdfimages", "-list", pdf], text=True).splitlines()[2:]
first_img = {}
for row in listing:
    f = row.split()
    if f[2] == "image" and int(f[0]) not in first_img: first_img[int(f[0])] = int(f[1])
os.makedirs(OUT, exist_ok=True)
pages = []
for p in range(1, npages + 1):
    txt = subprocess.check_output(["pdftotext", "-f", str(p), "-l", str(p), "-layout", pdf, "-"], text=True)
    mm = re.search(r"\b(\d+)/(\d+)\s*$", txt.strip())
    if not mm: continue                              # cover, word list, credits: not story pages
    body = re.sub(r"\b\d+/\d+\s*$", "", txt.strip())
    body = unicodedata.normalize("NFC", re.sub(r"\s+", " ", body)).strip()
    if not body or p not in first_img: continue
    pre = os.path.join(tmp, f"img{p}")
    subprocess.check_call(["pdfimages", "-f", str(p), "-l", str(p), "-j", pdf, pre])
    src = sorted(f for f in os.listdir(tmp) if f.startswith(f"img{p}-") and f.endswith(".jpg"))
    if not src: continue
    name = f"p{len(pages) + 1}.jpg"
    shutil.copy(os.path.join(tmp, src[0]), os.path.join(OUT, name))
    pages.append({"image": name, "text": body})
if not pages: sys.exit("no story pages found")
if a.max_pages:
    for p in pages[a.max_pages:]: os.remove(os.path.join(OUT, p["image"]))
    pages = pages[:a.max_pages]
source = {"id": a.id, "lang": a.lang, "level": a.level, "title": title, "credits": {
    "source": "StoryWeaver", "license": licence, "title": title, "author": author, "illustrator": illustrator,
    "publisher": publisher, "url": a.url, "attribution": attribution}, "pages": pages}
missing = [k for k, v in source["credits"].items() if not v]
if missing: sys.exit(f"could not read {missing} from the attribution text: {attribution}")
json.dump(source, open(os.path.join(OUT, "source.json"), "w"), ensure_ascii=False, indent=1)
print(f"imported {len(pages)} pages → content/sources/{a.id}  ·  {title} · {author} / {illustrator} · {licence}")
for i, p in enumerate(pages, 1): print(f"  {i}: {p['text']}")
