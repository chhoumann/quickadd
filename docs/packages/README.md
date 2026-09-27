# Example packages

Every example workflow in the docs ships as a QuickAdd package the reader can
copy from the page and import in **Settings → QuickAdd → Import package…**.
This folder is the source of truth for those packages.

```
docs/packages/<id>/package.json     manifest (hand-authored, committed)
docs/packages/<id>/files/*.md       templates the package bundles (optional)
docs/public/scripts/*.js            user scripts the package bundles
docs/public/packages/<id>.quickadd.json   built package (generated, committed)
```

A page offers its package by setting `package: <id>` in its frontmatter. The
`PackageCard` component then renders the "Get this workflow" card from the
manifest, and `/packages/<id>.quickadd.json` is what the Copy button copies.

## Manifest format

A manifest is a QuickAdd package (the same JSON `Export package…` produces)
with two differences:

- Assets carry a `source` path relative to the manifest instead of base64
  `content`. Scripts must come from `../../public/scripts/`, so the page's
  download link and the package always bundle the same file. Templates live in
  `files/` next to the manifest.
- An optional `install` block feeds the card:
  - `requires`: things the reader needs before importing (an account, another
    plugin, a minimum Obsidian version).
  - `afterImport`: settings to fill in afterwards, as short imperative lines.
    Lines support `` `code` ``, `**bold**` and `[links](/docs/...)`.

Choice ids must be `qa-pkg-<id>` or `qa-pkg-<id>-<suffix>`. Stable ids let a
reader re-import an updated package and get "Overwrite" instead of a duplicate.

Secrets (API keys, tokens) are never in a package. Leave the setting out of the
script's `settings` object and tell the reader where to paste it in
`afterImport`.

## Authoring a package

1. Build the workflow in a vault, then **Settings → QuickAdd → Export package…**
   and copy the JSON.
2. Create `docs/packages/<id>/package.json`, paste the `choices` and
   `rootChoiceIds`, and rename every choice id to the `qa-pkg-<id>` namespace.
   Set `quickAddVersion` to the plugin version the workflow needs.
3. Replace each asset's `content` with a `source` path. Scripts point at
   `docs/public/scripts/`; put templates under `files/`.
4. Add the `install` block and set `package: <id>` on the docs page.
5. Run `pnpm run packages:build` and commit the generated file.

`pnpm run test` (the root Vitest suite, run on every PR) fails when a built
package is stale, when a choice's shape drifts from what the plugin stores,
when a package references a file it does not bundle, when a secret value is
present, or when a page and a manifest do not match one to one.
