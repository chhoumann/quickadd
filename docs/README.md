# QuickAdd docs

The docs site (https://quickadd.obsidian.guide), built with [Astro Starlight](https://starlight.astro.build/).

## Layout

- `src/content/docs/docs/` - the documentation pages (markdown). Each page sets
  `slug:` explicitly to keep its historical URL, so renaming a file does not
  change its URL. If you do change a slug, add a 301 in `public/_redirects`.
- `src/pages/index.astro` - the landing page (self-contained, zero client JS).
- `astro.config.mjs` - Starlight config, including the sidebar.
- `public/` - static assets served as-is (`img/`, downloadable example
  `scripts/`, `_redirects`, `_headers`).
- `plugins/remark-heading-id.mjs` - supports `## Heading {#custom-id}` anchors.

Note on dependencies: `zod` and `unist-util-visit` are direct dependencies on
purpose. This package lives inside the plugin repo, and under pnpm's isolated
layout a transitive import that isn't declared here can resolve to the PARENT
repo's node_modules (a different major of zod broke the build this way).

## Commands

```sh
pnpm install
pnpm dev      # local dev server
pnpm build    # production build into build/
pnpm preview  # serve the production build
python3 scripts/check-links.py  # verify internal links/anchors in build/
```

## LLM and agent surface

Built artifacts for AI tooling, all served from the same deployment:

- `/llms.txt`, `/llms-small.txt`, `/llms-full.txt` - llms.txt-standard indexes
  (via `starlight-llms-txt`).
- `<page-url>.md` - every docs page as raw markdown
  (e.g. `/docs/FormatSyntax.md`); the "Copy Markdown" button uses these.
- `/docs-index.json` - machine-readable page manifest (slug, title,
  description, headings, text).
- `/mcp` - an MCP server (Streamable HTTP, stateless; `functions/mcp.ts` runs
  as a Cloudflare Pages Function) exposing `search_quickadd_docs` and
  `get_quickadd_doc`. Point any MCP client at
  `https://quickadd.obsidian.guide/mcp`.

## Deployment

Cloudflare Pages (GitHub integration) builds this directory on every push and
publishes `build/`. Pull requests get preview deployments automatically.

Docs are single-version: pages go live when they land on `master`. When
documenting a feature that has not shipped in a plugin release yet, add an
`_Introduced in QuickAdd X.Y.Z._` line at the section (see AGENTS.md).
