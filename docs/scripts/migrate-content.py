#!/usr/bin/env python3
"""One-shot Docusaurus -> Starlight content transform.

- slug frontmatter preserving the exact historical URL path (MixedCase)
- title backfill from a leading body H1 (which is then removed to avoid
  double H1s, since Starlight renders the frontmatter title)
- drops Docusaurus-only frontmatter keys (id, sidebar_position, tags)
- admonition mapping: :::info -> :::note, :::warning -> :::caution,
  ':::type Title' -> ':::type[Title]' (fence-aware)
- rewrites relative .md links to site-absolute /docs/... paths
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src/content/docs/docs"
ADMONITION_RE = re.compile(r"^(\s*):::(tip|note|caution|danger|info|warning)(?:\s+(.+?))?\s*$")
TYPE_MAP = {"info": "note", "warning": "caution"}
LINK_RE = re.compile(r"\]\((?!https?://|mailto:)([^)#\s]+\.mdx?)(#[^)\s]*)?\)")
DROP_KEYS = ("id", "sidebar_position", "tags")

report = {"admonitions": 0, "links": 0, "h1_hoisted": 0, "files": 0}


def site_path(md: Path) -> str:
    rel = md.relative_to(ROOT).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "index":
        parts = parts[:-1]
    return "/".join(["docs", *parts])


def split_frontmatter(text: str):
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            return text[4:end].rstrip("\n"), text[end + 5 :]
    return None, text


def transform(md: Path) -> None:
    text = md.read_text()
    fm, body = split_frontmatter(text)
    fm_lines = [] if fm is None else fm.split("\n")

    # Drop Docusaurus-only keys (including their indented continuation lines).
    kept, skipping = [], False
    for line in fm_lines:
        if re.match(rf"^({'|'.join(DROP_KEYS)}):", line):
            skipping = True
            continue
        if skipping and re.match(r"^\s+\S", line):
            continue
        skipping = False
        kept.append(line)
    fm_lines = kept

    # Hoist a leading body H1 into the title if none exists; drop it either way.
    body_lines = body.split("\n")
    i = 0
    while i < len(body_lines) and not body_lines[i].strip():
        i += 1
    if i < len(body_lines) and body_lines[i].startswith("# "):
        h1 = body_lines[i][2:].strip()
        if not any(l.startswith("title:") for l in fm_lines):
            fm_lines.append(f"title: {h1}")
        del body_lines[i]
        report["h1_hoisted"] += 1
    body = "\n".join(body_lines)

    fm_lines.append(f"slug: {site_path(md)}")

    # Fence-aware line pass for admonitions.
    out, in_fence, fence_marker = [], False, ""
    for line in body.split("\n"):
        stripped = line.lstrip()
        if in_fence:
            out.append(line)
            if stripped.startswith(fence_marker):
                in_fence = False
            continue
        m = re.match(r"^(`{3,}|~{3,})", stripped)
        if m:
            in_fence, fence_marker = True, m.group(1)
            out.append(line)
            continue
        am = ADMONITION_RE.match(line)
        if am:
            indent, typ, title = am.group(1), am.group(2), am.group(3)
            typ = TYPE_MAP.get(typ, typ)
            out.append(f"{indent}:::{typ}[{title}]" if title else f"{indent}:::{typ}")
            report["admonitions"] += 1
            continue
        out.append(line)
    body = "\n".join(out)

    # Relative .md links -> site-absolute paths.
    def repl(m: re.Match) -> str:
        target, anchor = m.group(1), m.group(2) or ""
        resolved = (md.parent / target).resolve()
        try:
            rel = resolved.relative_to(ROOT)
        except ValueError:
            print(f"  WARNING: link escapes docs root in {md}: {target}")
            return m.group(0)
        parts = list(rel.with_suffix("").parts)
        if parts and parts[-1] == "index":
            parts = parts[:-1]
        report["links"] += 1
        return f"](/{'/'.join(['docs', *parts])}/{anchor})"

    body = LINK_RE.sub(repl, body)

    md.write_text("---\n" + "\n".join(fm_lines) + "\n---\n" + body)
    report["files"] += 1


for md in sorted(ROOT.rglob("*.md")):
    transform(md)

print(report)
sys.exit(0)
