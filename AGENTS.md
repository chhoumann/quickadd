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
Follow Conventional Commits (`feat:`, `fix:`, `test:`, `release(version): ...`) so semantic-release can determine versions. Keep generated files in the same commit as the changes that produced them. Pull requests must include a concise summary, reproduction steps or screenshots for UI changes, linked issues when relevant, and explicit notes on release or migration impact. Request review from maintainers closest to the touched area.

## Documentation
Docs live in `docs/` (Astro Starlight) and are single-version: pages in `docs/src/content/docs/docs/` serve at `/docs/` on quickadd.obsidian.guide, and edits go live when they land on `master` (deployed by Cloudflare Pages). There are no versioned snapshots - do NOT recreate `versioned_docs/` or any per-release docs copies. Historical docs states are recoverable from git tags. Every page pins its URL with a `slug:` frontmatter field; keep slugs stable, and add a 301 in `docs/public/_redirects` if one must change.

Because docs track `master` while plugin releases are cut manually, docs can briefly describe features users don't have yet. The contract for that window: when documenting a feature that has not shipped in a release, add an "Introduced in vX.Y.Z" line (or an `:::note[Available in the next release]` callout) at the section you're adding, in the same PR as the docs change. Fill in the real version number if it's known from the pending release.

Old `/docs/<version>/...` and `/docs/next/...` URLs 301 to their current equivalents via `docs/public/_redirects` (Cloudflare Pages reads it from the build output). If a docs page is ever renamed or deleted, add a redirect for its old path there.

## Agent Playbook
Automation or scripted work should surface disruptive operations in the PR description and rerun `pnpm run build-with-lint` to keep `main.js`, `manifest.json`, and `versions.json` synchronized. Treat unexpected diffs in those artifacts as blockers until a maintainer approves.

## Dev workflow
Always use the `obsidian` CLI to test changes. Use the shared `dev` vault in
the main checkout, and use the isolated worktree wrapper in Codex worktrees.

Obsidian CLI is a command line interface that lets you control Obsidian from your terminal for scripting, automation, and integration with external tools.

Anything you can do in Obsidian can be done from the command line. Obsidian CLI even includes developer commands to access developer tools, inspect elements, take screenshots, reload plugins, and more.

## Obsidian Dev Vault Workflow
- Always target the `dev` vault when using the Obsidian CLI by passing
  `vault=dev` as a prefix argument before the command:
  `obsidian vault=dev <command> ...`.
- Critical: do not use suffix form (`obsidian <command> vault=dev ...`).
  It may resolve to the wrong vault due to CLI parsing behavior.
- Dev vault root path: `/Users/christian/Developer/dev_vault/dev/`.
- QuickAdd plugin path in the vault:
  `/Users/christian/Developer/dev_vault/dev/.obsidian/plugins/quickadd`.
- Run `pnpm run dev` in this repository to generate/update `main.js` for
  development.
- Reload QuickAdd after build/deploy with:
  `obsidian vault=dev plugin:reload id=quickadd`.
- In this setup, the vault plugin `main.js` is symlinked to
  `/Users/christian/Developer/quickadd/main.js`, so rebuilding updates
  the active plugin code directly.

## Obsidian Worktree Vault Workflow
- In Codex worktrees, prefer the isolated worktree vault wrapper instead of the
  shared `dev` vault:
  `pnpm run obsidian:e2e -- <command> ...`.
- The wrapper provisions the worktree-local vault, starts or reuses an isolated
  Obsidian instance, disables Restricted Mode for that vault, waits until
  QuickAdd is available, and then runs the requested command with the correct
  private `HOME` and `vault=<worktree vault>` already applied.
- Examples:
  - `pnpm run obsidian:e2e -- quickadd:list`
  - `pnpm run obsidian:e2e -- dev:errors`
  - `pnpm run obsidian:e2e -- eval code='app.vault.getName()'`
- Use `pnpm run start:e2e-obsidian -- --print-env` only when you specifically
  need to export `QUICKADD_E2E_*` variables for a separate E2E test process.

### Stopping an isolated instance (avoid leaks)

Each started instance is a real Obsidian process tree plus a private profile
directory under `/private/tmp/quickadd-obsidian-e2e/<vault>-<hash>/`. Removing a
worktree does **not** stop it, so a finished worktree would leak an Obsidian
process tree and a `/private/tmp` directory. Stop it explicitly:

```bash
pnpm run stop:e2e-obsidian            # stop THIS worktree's instance + remove its tmp dir
pnpm run stop:e2e-obsidian -- --dry-run   # show what would be stopped/removed
pnpm run stop:e2e-obsidian -- --prune     # also reap orphaned instances (worktree gone)
```

The teardown identifies only this worktree's instance by its private
`--user-data-dir` token (which contains a per-worktree hash), terminates that
process tree (SIGTERM, then SIGKILL for stragglers), and removes its profile
directory. It never touches the shared `dev` vault, other worktrees, or PodNotes
instances.

Two layers keep instances from leaking, so you rarely need to run `stop` by hand:

- **Orca archive hook** — `orca.yaml` defines a `scripts.archive` hook that runs
  this teardown for the worktree being removed. Remove worktrees with
  `orca worktree rm --worktree <selector> --run-hooks` so the hook fires (Orca
  skips archive hooks without `--run-hooks`).
- **Reap on next start** — `start:e2e-obsidian` and `obsidian:e2e` reap any
  orphaned instance (one whose backing worktree no longer exists on disk, i.e.
  it was removed) before launching, even if its Obsidian is still running. An
  idle instance for a worktree that still exists is left alone so concurrent
  workers can reuse it. Reaping scans the default profile root
  (`/tmp/quickadd-obsidian-e2e`); instances started under a custom
  `--profile-root` are only reaped by a start that uses that same root, so stop
  those explicitly.

## Obsidian DevTools Workflow
- Developer commands are available through `obsidian`:
  `devtools`, `dev:debug`, `dev:cdp`, `dev:errors`, `dev:screenshot`,
  `dev:console`, `dev:css`, `dev:dom`, `dev:mobile`, and `eval`.
- Keep `vault=dev` as a prefix argument on every developer command as well.
- `dev:console` and `dev:errors` are only reliable while debugger capture is
  attached (`obsidian vault=dev dev:debug on`).
- For non-trivial `obsidian eval` code, use a heredoc/file and pass it to
  `code=...` to avoid shell-quoting corruption.
- Standard log-inspection sequence:
  1. `obsidian vault=dev dev:debug on`
  2. `obsidian vault=dev dev:console clear`
  3. `obsidian vault=dev dev:errors clear`
  4. Trigger a QuickAdd action, for example:
     `obsidian vault=dev command id=quickadd:testQuickAdd`
  5. Read logs:
     `obsidian vault=dev dev:console limit=200`
  6. Check runtime errors:
     `obsidian vault=dev dev:errors`
  7. Detach when done:
     `obsidian vault=dev dev:debug off`

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
