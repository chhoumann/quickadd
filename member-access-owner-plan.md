# Member Access Namespace Pivot Plan

## Tasks
- [x] T1 Remove owner-model schema and cleanup
- [x] T2 Runtime merged-namespace resolution
- [x] T3 Parser and conflict-selector rules
- [x] T4 UI/doc cleanup and new guidance
- [x] T5 Tests and verification

## Work Log
- Removed the unshipped `exposeForMemberAccess` field from user-script types and deleted the related migration wiring.
- Reworked `SingleMacroEngine` so `Macro::member` searches all user scripts, errors on zero or multiple matches, and supports `Macro::Script Name::member` disambiguation.
- Preserved pre/post macro execution around the selected script, including selector-based execution on later scripts.
- Removed the owner toggle/badge UI and updated the unreleased macro docs to describe the merged-namespace model.
- Replaced the focused regression tests with unique-match, conflict, selector, duplicate-name, and selector-fallback coverage.
- Updated the vault-backed e2e fixtures to cover unique later-script lookup, ambiguous conflict failure, and qualified selector success.
- Rebuilt the plugin, copied the generated bundle to `/Users/christian/Developer/quickadd/`, reloaded QuickAdd in the `dev` vault, and reran focused e2e/CLI verification.

## Files Modified Or Created
- `docs/docs/Choices/MacroChoice.md`
- `src/engine/SingleMacroEngine.ts`
- `src/engine/SingleMacroEngine.member-access.test.ts`
- `src/gui/MacroGUIs/CommandList.svelte`
- `src/gui/MacroGUIs/Components/UserScriptCommand.svelte`
- `src/gui/MacroGUIs/UserScriptSettingsModal.ts`
- `src/migrations/migrate.ts`
- `src/settings.ts`
- `src/types/macros/IUserScript.ts`
- `src/types/macros/UserScript.ts`
- `tests/e2e/macro-member-access.test.ts`
- `member-access-owner-plan.md`

## Errors / Gotchas
- The `dev` vault still loads `/Users/christian/Developer/quickadd/main.js`, so verification required copying this worktree's built `main.js` and `styles.css` into that checkout before reloading the plugin.
- The first version of the qualified-selector e2e fixture used an object-export script as a pre-command, which opened the legacy object-picker prompt and blocked the test; the fixture was updated so the earlier ambiguous script is directly runnable.
- A live settings-modal DOM check in Obsidian kept surfacing a stale pre-reload modal instance that still contained the removed toggle text, even though the rebuilt bundle no longer contains the `Expose for member access` string. Functional CLI verification and source/bundle inspection matched the new implementation, but that one UI probe remained unreliable in the running app session.
