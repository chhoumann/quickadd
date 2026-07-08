#!/usr/bin/env python3
"""Internal link + anchor checker for the built site in build/."""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

BUILD = Path(__file__).resolve().parent.parent / "build"


class Collector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.ids = [], set()

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "a" and d.get("href"):
            self.links.append(d["href"])
        if tag in ("img", "source", "video") and d.get("src"):
            self.links.append(d["src"])
        if d.get("id"):
            self.ids.add(d["id"])
        if tag == "a" and d.get("name"):
            self.ids.add(d["name"])


pages = {}
for f in BUILD.rglob("*.html"):
    c = Collector()
    c.feed(f.read_text(errors="replace"))
    pages[f] = c

ids_by_url = {}
for f, c in pages.items():
    url = "/" + str(f.relative_to(BUILD))
    url = re.sub(r"/index\.html$", "/", url)
    ids_by_url[url] = c.ids

errors = []
for f, c in pages.items():
    src_url = "/" + str(f.relative_to(BUILD).parent) + "/"
    for href in c.links:
        if re.match(r"^(https?:|mailto:|#|data:)", href):
            continue
        path, _, frag = href.partition("#")
        if not path.startswith("/"):
            continue  # relative asset urls resolved by astro; rare
        clean = re.sub(r"[?].*$", "", path)
        target = BUILD / clean.lstrip("/")
        ok = (
            target.exists()
            or (target.parent / (target.name + ".html")).exists()
            or (target / "index.html").exists()
        )
        if not ok:
            errors.append(f"{src_url}: broken link {href}")
            continue
        if frag:
            page_url = clean if clean.endswith("/") else clean + "/"
            ids = ids_by_url.get(page_url)
            if ids is not None and frag not in ids:
                errors.append(f"{src_url}: missing anchor {href}")

for e in sorted(set(errors)):
    print(e)
print(f"{len(set(errors))} problems across {len(pages)} pages")
sys.exit(1 if errors else 0)
