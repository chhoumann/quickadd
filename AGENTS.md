# Repository Guidelines

## Project Overview
QuickAdd is an Obsidian community plugin that provides four choice types:
templates, captures, macros, and multis.

## Project Structure & Module Organization
QuickAdd is an Obsidian community plugin. Source code lives in `src/`: core logic under `engine/`, `services/`, and `utils/`; Svelte UI in `src/gui`; shared types in `src/types`; settings entry in `src/quickAddSettingsTab.ts`. Bundled artifacts `main.js` and `styles.css` stay at the repo root and should be generated, not hand-edited. Place tests and stubs in `tests/`, and keep user-facing docs in `docs/`.

## Tooling & GitHub
- Use `bun` for package management and scripts. Avoid npm/yarn/pnpm.
- Use the GitHub CLI (`gh`) for issues, PRs, and releases.

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

## Agent Playbook
Automation or scripted work should surface disruptive operations in the PR description and rerun `bun run build-with-lint` to keep `main.js`, `manifest.json`, and `versions.json` synchronized. Treat unexpected diffs in those artifacts as blockers until a maintainer approves.
