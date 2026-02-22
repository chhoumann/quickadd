# Repository Guidelines

## Project Overview
QuickAdd is an Obsidian community plugin that provides four choice types:
templates, captures, macros, and multis.

## Project Structure & Module Organization
QuickAdd is an Obsidian community plugin. Source code lives in `src/`: core logic under `engine/`, `services/`, and `utils/`; Svelte UI in `src/gui`; shared types in `src/types`; settings entry in `src/quickAddSettingsTab.ts`. Bundled artifacts `main.js` and `styles.css` stay at the repo root and should be generated, not hand-edited. Place tests and stubs in `tests/`, and keep user-facing docs in `docs/`.

## Tooling & GitHub
- Use `bun` for package management and scripts. Avoid npm/yarn/pnpm.
- Use the GitHub CLI (`gh`) for issues, PRs, and releases.
- When resolving a GitHub issue, use `gh issue develop <issue-number>` to
  create/link the working branch before implementation.
- GitHub does not allow approving your own PR from the same account; do not
  block merge waiting for self-approval.

## Build, Test, and Development Commands
- `bun run dev`: watch-mode bundle via `esbuild.config.mjs`, regenerating `main.js` as you edit.
- `bun run build`: run `tsc --noEmit` then produce the production bundle.
- `bun run build-with-lint`: run Biome (`bun lint`) before the production build; use for release packaging.
- `bun run lint`: apply ESLint to TypeScript sources to catch type and usage issues.
- `bun run test`: execute Vitest with `--passWithNoTests` for fast local verification.

## Coding Style & Naming Conventions
Biome enforces tab indentation (width 2), LF endings, and an 80-character line guide; align editor settings. Use camelCase for variables and functions, PascalCase for classes and Svelte components, and kebab-case for directories and utilities. Preserve the hand-ordered imports in `src/main.ts`; disable auto-sorting there. Prefer type-only imports and route logging through the `logger` utilities for consistent output.

## Testing Guidelines
Vitest (configured in `vitest.config.mts`) runs under jsdom and cannot load real Obsidian modules. Structure production code so Obsidian dependencies are injected behind interfaces; unit tests target pure logic and swap in adapters or `tests/obsidian-stub.ts`. Co-locate specs with their source or group them under `tests/feature-name`. Use Testing Library helpers for Svelte components, add regression coverage for bug fixes, and ensure `bun run test` passes before pushing.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat:`, `fix:`, `test:`, `release(version): ...`) so semantic-release can determine versions. Keep generated files in the same commit as the changes that produced them. Pull requests must include a concise summary, reproduction steps or screenshots for UI changes, linked issues when relevant, and explicit notes on release or migration impact. Request review from maintainers closest to the touched area.

## Documentation Versioning
Docs live in `docs/` and use Docusaurus with versioned documentation. The current (unreleased) docs are in `docs/docs/`, while stable snapshots live in `docs/versioned_docs/version-X.Y.Z/`.

**When releasing a new version:**
```bash
cd docs && bun run docusaurus docs:version X.Y.Z
```
This snapshots `docs/docs/` as the new stable version. Update `docs/docusaurus.config.js` to set `lastVersion` to the new version and add an entry under `versions`.

**Structure:**
- `docs/docs/` → "Next" (unreleased, shows warning banner)
- `docs/versioned_docs/version-X.Y.Z/` → stable release docs
- `docs/versions.json` → list of versioned snapshots
- `docs/versioned_sidebars/` → sidebar configs for each version

Keep docs in sync: update `docs/docs/` when adding features, and snapshot when releasing.

## Agent Playbook
Automation or scripted work should surface disruptive operations in the PR description and rerun `bun run build-with-lint` to keep `main.js`, `manifest.json`, and `versions.json` synchronized. Treat unexpected diffs in those artifacts as blockers until a maintainer approves.

## Dev workflow
Always use the `obsidian` cli to test changes in the dev vault.

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
- Run `bun run dev` in this repository to generate/update `main.js` for
  development.
- Reload QuickAdd after build/deploy with:
  `obsidian vault=dev plugin:reload id=quickadd`.
- In this setup, the vault plugin `main.js` is symlinked to
  `/Users/christian/Developer/quickadd/main.js`, so rebuilding updates
  the active plugin code directly.

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
