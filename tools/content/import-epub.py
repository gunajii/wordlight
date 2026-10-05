#!/usr/bin/env python3
"""Import a StoryWeaver ePub into content/sources/<id>/ (text + one illustration per page).

  python3 tools/content/import-epub.py path/to/story.epub <id> --lang en-IN --level 1 --url https://storyweaver.org.in/… \
      [--license "CC BY 4.0"]
Reads the ePub spine in order; every page that has text becomes a story page with its first image. Cover/credit
pages without story text are skipped (the last page's attribution text is printed so it can be copied into
credits). Images are converted to JPEG (ffmpeg) because the Vega image component did not show WebP in S1.
Writes source.json with credits fields to CHECK BY HAND against the StoryWeaver page (licence, author,
illustrator, translator). Nothing is guessed silently: unknown fields are written as "CHECK".
"""
import argparse, json, os, re, shutil, subprocess, sys, zipfile, html, posixpath
from xml.etree import ElementTree as ET

ap = argparse.ArgumentParser()
ap.add_argument("epub"); ap.add_argument("id")
ap.add_argument("--lang", required=True, choices=["en-IN", "hi-IN"]); ap.add_argument("--level", type=int, default=1)
ap.add_argument("--url", required=True); ap.add_argument("--license", default="CC BY 4.0")
a = ap.parse_args()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUT = os.path.join(ROOT, "content/sources", a.id)
os.makedirs(OUT, exist_ok=True)
z = zipfile.ZipFile(a.epub)
ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container", "o": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}
opf_path = ET.fromstring(z.read("META-INF/container.xml")).find(".//c:rootfile", ns).get("full-path")
opf = ET.fromstring(z.read(opf_path)); base = posixpath.dirname(opf_path)
meta = {k: [e.text for e in opf.findall(f".//dc:{k}", ns)] for k in ("title", "creator", "contributor", "publisher", "rights", "language")}
manifest = {i.get("id"): i.get("href") for i in opf.findall(".//o:manifest/o:item", ns)}
spine = [manifest[i.get("idref")] for i in opf.findall(".//o:spine/o:itemref", ns)]

def text_of(xhtml):
    x = re.sub(r"(?is)<(script|style|head).*?</\1>", " ", xhtml)
    x = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</h\d>", "\n", x)
    x = html.unescape(re.sub(r"<[^>]+>", " ", x))
    return re.sub(r"[ \t]+", " ", "\n".join(l.strip() for l in x.splitlines())).strip()

pages, raw_pages = [], []
for href in spine:
    p = posixpath.normpath(posixpath.join(base, href))
    xh = z.read(p).decode("utf-8", "replace")
    t = re.sub(r"\s+", " ", text_of(xh)).strip()
    imgs = [posixpath.normpath(posixpath.join(posixpath.dirname(p), s)) for s in re.findall(r'(?i)<img[^>]+src="([^"]+)"', xh)]
    raw_pages.append((href, t, imgs))
# story pages: have text and an image; skip the cover (first) and anything that looks like credits/licence
for href, t, imgs in raw_pages[1:]:
    if not t or not imgs or re.search(r"(?i)creative commons|this book was|storyweaver|pratham books|attribution", t):
        continue
    n = len(pages) + 1
    src_img = imgs[0]; tmp = os.path.join(OUT, "_" + posixpath.basename(src_img))
    with open(tmp, "wb") as f: f.write(z.read(src_img))
    dst = f"p{n}.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-q:v", "3", os.path.join(OUT, dst)], check=True); os.remove(tmp)
    pages.append({"image": dst, "text": t})
credits_text = [t for _, t, _ in raw_pages if re.search(r"(?i)creative commons|attribution|storyweaver", t)]
title = (meta["title"] or ["CHECK"])[0]
src = {"id": a.id, "lang": a.lang, "level": a.level, "title": title,
       "credits": {"source": "StoryWeaver (Pratham Books)", "license": a.license, "title": title,
                   "author": ", ".join(meta["creator"]) or "CHECK", "illustrator": "CHECK", "url": a.url,
                   "attribution": f"“{title}” — CHECK author/illustrator — StoryWeaver, Pratham Books, {a.license}. Narration added by WordLight (Amazon Polly)."},
       "pages": pages, "_epub_meta": meta, "_credit_pages": credits_text[:3]}
json.dump(src, open(os.path.join(OUT, "source.json"), "w"), ensure_ascii=False, indent=1)
print(f"wrote content/sources/{a.id}: {len(pages)} pages")
for p in pages: print(f"  {p['image']}: {p['text'][:90]}")
print("credit pages (copy author/illustrator/licence into source.json credits, then remove CHECK):")
for t in credits_text[:3]: print("  >", t[:400])
