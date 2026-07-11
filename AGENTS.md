# Repository Guidelines

## Project Overview
QuickAdd is an Obsidian community plugin that provides four choice types:
templates, captures, macros, and multis.

## Project Structure & Module Organization
QuickAdd is an Obsidian community plugin. Source code lives in `src/`: core logic under `engine/`, `services/`, and `utils/`; Svelte UI in `src/gui`; shared types in `src/types`; settings entry in `src/quickAddSettingsTab.ts`. Bundled artifacts `main.js` and `styles.css` stay at the repo root and should be generated, not hand-edited. Place tests and stubs in `tests/`, and keep user-facing docs in `docs/`.

## Tooling & GitHub
- Use `pnpm` for package management and scripts. Avoid npm/yarn/bun.
- Use the GitHub CLI (`gh`) for issues, PRs, and releases.
- When resolving a GitHub issue, use `gh issue develop <issue-number>` to
  create/link the working branch before implementation.
- GitHub does not allow approving your own PR from the same account; do not
  block merge waiting for self-approval.

## Build, Test, and Development Commands
- `pnpm run dev`: watch-mode bundle via `esbuild.config.mjs`, regenerating `main.js` as you edit.
- `pnpm run build`: run `tsc --noEmit` then produce the production bundle.
- `pnpm run build-with-lint`: type-check, run ESLint (`pnpm lint`), then produce the production build; use for release packaging.
- `pnpm run lint`: apply ESLint to TypeScript sources to catch type and usage issues.
- `pnpm run test`: execute Vitest with `--passWithNoTests` for fast local verification.

## Coding Style & Naming Conventions
The project uses tab indentation and LF endings (see `.editorconfig`); align editor settings. Use camelCase for variables and functions, PascalCase for classes and Svelte components, and kebab-case for directories and utilities. Preserve the hand-ordered imports in `src/main.ts`; disable auto-sorting there. Prefer type-only imports and route logging through the `logger` utilities for consistent output.

## Testing Guidelines
Vitest (configured in `vitest.config.mts`) runs under jsdom and cannot load real Obsidian modules. Structure production code so Obsidian dependencies are injected behind interfaces; unit tests target pure logic and swap in adapters or `tests/obsidian-stub.ts`. Co-locate specs with their source or group them under `tests/feature-name`. Add regression coverage for bug fixes, and ensure `pnpm run test` passes before pushing.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat:`, `fix:`, `test:`, ...) so the shared release pipeline can determine versions from history. Keep generated files in the same commit as the changes that produced them. Pull requests must include a concise summary, reproduction steps or screenshots for UI changes, linked issues when relevant, and explicit notes on release or migration impact. Request review from maintainers closest to the touched area.

## Documentation
Docs live in `docs/` (Astro Starlight) and are single-version: pages in `docs/src/content/docs/docs/` serve at `/docs/` on quickadd.obsidian.guide, and edits go live when they land on `master` (deployed by Cloudflare Pages). There are no versioned snapshots - do NOT recreate `versioned_docs/` or any per-release docs copies. Historical docs states are recoverable from git tags. Every page pins its URL with a `slug:` frontmatter field; keep slugs stable, and add a 301 in `docs/public/_redirects` if one must change.

Because docs track `master` while plugin releases are cut manually, docs can briefly describe features users don't have yet. The contract for that window: when documenting a feature that has not shipped in a release, add an `_Introduced in QuickAdd X.Y.Z._` line (or an `:::note[Available in the next release]` callout) at the section you're adding, in the same PR as the docs change. Fill in the real version number if it's known from the pending release.

Old `/docs/<version>/...` and `/docs/next/...` URLs 301 to their current equivalents via `docs/public/_redirects` (Cloudflare Pages reads it from the build output). If a docs page is ever renamed or deleted, add a redirect for its old path there.

## Agent Playbook
Automation or scripted work should surface disruptive operations in the PR description and rerun `pnpm run build-with-lint` to keep `main.js`, `manifest.json`, and `versions.json` synchronized. Treat unexpected diffs in those artifacts as blockers until a maintainer approves.

## Obsidian Runtime Workflow
Agents with the `verify-in-obsidian` skill get the generic workflow there:
vault-mode choice, the runner script quartet, the `--print-env` HOME remap,
instance teardown, and the dev-tools loop. This section is the QuickAdd-specific
brief that a skill-less agent still needs.

- Plugin id `quickadd`. Reload with `obsidian vault=<vault> plugin:reload
  id=quickadd`; the runner's ready probe is `quickadd:list`. Trigger the test
  action with `obsidian vault=<vault> command id=quickadd:testQuickAdd` (or via
  the runner: `pnpm run obsidian:e2e -- command id=quickadd:testQuickAdd`).
- The four runner scripts - `provision:e2e-vault`, `start:e2e-obsidian`,
  `stop:e2e-obsidian`, `obsidian:e2e` - run the shared `obsidian-e2e` bin,
  configured by `obsidian-e2e.config.mjs` at the repo root (plugin id, the
  symlinked artifacts, the `data.json` seed, and the `quickadd:list` ready
  probe).
- Worktrees use the isolated vault (`.obsidian-e2e-vaults/quickadd-<worktree>`)
  and must not race the shared `dev` vault. The main
  `/Users/christian/Developer/quickadd` checkout uses the shared `dev` vault
  (root `/Users/christian/Developer/dev_vault/dev`, plugin folder
  `.obsidian/plugins/quickadd` symlinked to this checkout's `main.js`); only one
  checkout can own those symlinks at a time. Run `pnpm run dev` to rebuild.
- Always pass the `vault=` selector as a **prefix** argument, never a suffix -
  suffix form can resolve to the wrong vault.

```bash
pnpm run dev                                # or: pnpm run build
pnpm run obsidian:e2e -- quickadd:list
pnpm run obsidian:e2e -- eval code='Boolean(app.plugins.plugins.quickadd)'
pnpm run obsidian:e2e -- dev:errors

# point the Vitest tests/e2e suite at the isolated instance:
eval "$(pnpm run --silent start:e2e-obsidian -- --print-env)"
export HOME="$OBSIDIAN_E2E_OBSIDIAN_HOME"   # re-point the CLI socket
pnpm run test:e2e

pnpm run stop:e2e-obsidian                  # stop this worktree's instance on wrap-up
```

The runner emits canonical `OBSIDIAN_E2E_*` env names, plus legacy
`QUICKADD_E2E_*` aliases during the migration (`tests/e2e/e2eVault.ts` reads
canonical first). `dev:console`/`dev:errors` are most reliable while debugger
capture is attached (`pnpm run obsidian:e2e -- dev:debug on`, which stays on this
worktree's isolated instance); for non-trivial `eval`,
pass code via `code=...` from a heredoc/file to avoid shell-quoting corruption.

## Evidence-First Bug Triage
- Default bug workflow: reproduce in Obsidian first, then implement fix, then
  verify in Obsidian again, then add/adjust unit tests for regression coverage.
- Do not assume a reported bug still exists. Issues may already be fixed by
  unrelated changes; confirm current behavior before changing code.
- For reproduction, prefer real user conditions over synthetic tests
  (hotkeys, choice settings, workspace/tab layout, and platform specifics).
- When debugging command-triggered behavior, test both paths:
  hotkey execution and direct command execution (`obsidian command ...`).
- Record evidence from `tabs`, `workspace`, `dev:console`, and `dev:errors`
  before and after the action being tested.
- For pane/tab diagnostics, treat `workspace ... ids` as authoritative layout
  evidence and use `tabs` as a quick summary.
- If not reproducible after solid evidence gathering, respond with exact tested
  setup and ask for a fresh issue with versions, config, and repro artifacts.

## CLI-Verifiable Development
- Verifiability is required: work is not complete until behavior can be checked
  through the Obsidian CLI in the `dev` vault.
- If a flow is UI-only (for example forms/modals), add a CLI-native verification
  seam first (command/API entrypoint, inspectable state, and deterministic logs).
- Prefer verification paths that can run both manually and scripted:
  command execution, `eval`, `dev:console`, `dev:errors`, `tabs`, and
  `workspace`.
- Add or update automated tests around the new seam so regressions are caught
  without depending on manual modal interaction.
