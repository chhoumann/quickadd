#!/usr/bin/env python3
"""Rewrite extensionless relative doc links (./Foo, ../Bar#baz) to
site-absolute /docs/... paths. Only rewrites when the target resolves to a
real .md file, so asset links are untouched."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src/content/docs/docs"
LINK_RE = re.compile(r"\]\((\.{1,2}/[^)#\s]+?)/?(#[^)\s]*)?\)")
count = 0

for md in sorted(ROOT.rglob("*.md")):
    text = md.read_text()

    def repl(m: re.Match) -> str:
        global count
        target, anchor = m.group(1), m.group(2) or ""
        base = (md.parent / target).resolve()
        if base.with_suffix(".md").exists():
            resolved = base.with_suffix(".md")
        elif (base / "index.md").exists():
            resolved = base / "index.md"
        else:
            return m.group(0)
        parts = list(resolved.relative_to(ROOT).with_suffix("").parts)
        if parts and parts[-1] == "index":
            parts = parts[:-1]
        count += 1
        return f"](/{'/'.join(['docs', *parts])}/{anchor})"

    new = LINK_RE.sub(repl, text)
    if new != text:
        md.write_text(new)

print(f"rewrote {count} extensionless links")
