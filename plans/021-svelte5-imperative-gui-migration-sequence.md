# Plan 021: Svelte 5 imperative-GUI migration sequence

## Verified inventory

Plan 020's drift check was clean for the imperative GUI/preflight target set:

```bash
git diff --stat 71d6ed71..HEAD -- src/gui/ChoiceBuilder/ src/gui/MacroGUIs/ src/gui/AIAssistantProvidersModal.ts src/gui/AIAssistantSettingsModal.ts src/gui/ModelDirectoryModal.ts src/gui/MultiChoiceSettingsModal.ts src/gui/ProviderPickerModal.ts src/preflight/OnePageInputModal.ts src/gui/svelte/mountComponent.ts
```

It returned no output. The live `new Setting(` inventory remains the same 16-file imperative tail:

```text
src/gui/AIAssistantProvidersModal.ts
src/gui/AIAssistantSettingsModal.ts
src/gui/ChoiceBuilder/captureChoiceBuilder.ts
src/gui/ChoiceBuilder/choiceBuilder.ts
src/gui/ChoiceBuilder/templateChoiceBuilder.ts
src/gui/MacroGUIs/AIAssistantCommandSettingsModal.ts
src/gui/MacroGUIs/AIAssistantInfiniteCommandSettingsModal.ts
src/gui/MacroGUIs/CommandSequenceEditor.ts
src/gui/MacroGUIs/ConditionalCommandSettingsModal.ts
src/gui/MacroGUIs/MacroBuilder.ts
src/gui/MacroGUIs/OpenFileCommandSettingsModal.ts
src/gui/MacroGUIs/UserScriptSettingsModal.ts
src/gui/ModelDirectoryModal.ts
src/gui/MultiChoiceSettingsModal.ts
src/gui/ProviderPickerModal.ts
src/preflight/OnePageInputModal.ts
```

The current arithmetic is unchanged for the imperative backlog:

| Area | Files | Lines |
|------|-------|-------|
| ChoiceBuilder trio | 3 | 2169 |
| MacroGUIs imperative settings | 7 | 2149 |
| AI / misc `src/gui` settings modals | 5 | 918 |
| `src/gui` imperative total | 15 | 5236 |
| `src/preflight/OnePageInputModal.ts` | 1 | 536 |
| All-`src` imperative total | 16 | 5772 |

Inventory commands reproduced:

```text
grep -rl "new Setting(" src --include="*.ts" | grep -v ".test.ts" | grep "src/gui/" | xargs wc -l | tail -1
    5236 total

grep -rl "new Setting(" src --include="*.ts" | grep -v ".test.ts" | xargs wc -l | tail -1
    5772 total

git log --since="12 months ago" --oneline -- src/gui/ChoiceBuilder/captureChoiceBuilder.ts | wc -l
      27
```

The Svelte side still has 25 files, but the live line total is `4887 total`, not the plan snapshot's `4888 total`. The one-line difference comes from `src/gui/PackageManager/FilePreviewRow.svelte` after `71d6ed71`, outside this spike's imperative target set, and does not change the imperative sequencing decision.

## #1239 context

Issue #1239 converted the existing `.svelte` components to Svelte 5 runes mode and added the imperative mount seam. It did not convert the `new Setting(` modals/builders listed above. The remaining migration frontier is therefore not "finish the Svelte 4 -> 5 syntax change"; it is a new migration of Obsidian `Modal`/`Setting` classes into Svelte components.

The target shape is visible in `src/gui/MacroGUIs/CommandList.svelte`: props come from `let { commands = $bindable([]), app, plugin, ... }: CommandListProps = $props();`, mutations persist through callback props such as `saveCommands(snapshot(commands))`, and command interactions use on-prefixed callback props instead of `createEventDispatcher`.

The imperative bridge is already present:

```ts
mountComponent(target, Component, props)
```

`src/gui/svelte/mountComponent.ts` returns an idempotent `MountHandle`, and `src/gui/ChoiceBuilder/choiceBuilder.ts` stores those handles in `svelteElements`, destroys them in `reload()`, and destroys them again safely in `onClose()`. `src/gui/ChoiceBuilder/templateChoiceBuilder.ts` already uses this seam for `FolderList.svelte`, so incremental conversion can reuse a real current pattern. `src/gui/ChoiceBuilder/captureChoiceBuilder.ts` defines 9 private `add*Setting` methods, including `addCapturedToSetting`, `addAppendLinkSetting`, `addWritePositionSetting`, `addFormatSetting`, and `addCreateWithTemplateSetting`; these are natural conversion units.

## Sequence

| Order | Conversion unit | Lines | Churn, 12mo | Risk | Depends on |
|-------|-----------------|-------|-------------|------|------------|
| 1 | `src/gui/ChoiceBuilder/choiceBuilder.ts` shared primitives host | 235 | 12 | High | Establish Svelte equivalents for base settings before child builders depend on them. |
| 2 | `src/gui/ChoiceBuilder/captureChoiceBuilder.ts` - location, canvas target, write position, format preview, behavior groups | 1451 | 27 | High | Base primitives, `mountComponent`, Plan 010 debounce decision, Plan 013 append-link seam. |
| 3 | `src/gui/ChoiceBuilder/templateChoiceBuilder.ts` - template path, file name, folder, append link, open behavior | 483 | 16 | High | Base primitives, reuse existing `FolderList` mount, Plan 013 append-link seam. |
| 4 | `src/preflight/OnePageInputModal.ts` | 536 | 14 | High | Keep after ChoiceBuilder base because choice-level one-page overrides feed this workflow. |
| 5 | `src/gui/MacroGUIs/MacroBuilder.ts` | 182 | 12 | Medium | Keep aligned with `CommandList.svelte` and command-list props before modal settings migrate. |
| 6 | `src/gui/MacroGUIs/AIAssistantCommandSettingsModal.ts` | 329 | 11 | Medium | Shared AI provider/model primitives from the top-level AI modals. |
| 7 | `src/gui/MacroGUIs/AIAssistantInfiniteCommandSettingsModal.ts` | 356 | 11 | Medium | Same AI command settings primitives as the finite assistant command modal. |
| 8 | `src/gui/AIAssistantProvidersModal.ts` | 380 | 10 | Medium | Provider picker/model directory components should settle before command modals rely on them. |
| 9 | `src/gui/AIAssistantSettingsModal.ts` | 157 | 8 | Medium | Follows provider primitives; lower line count but shared configuration state. |
| 10 | `src/gui/MacroGUIs/OpenFileCommandSettingsModal.ts` | 196 | 8 | Medium | Reuse `<FileOpeningSetting>` / `<OpenFileSetting>` from ChoiceBuilder base work. |
| 11 | `src/gui/MacroGUIs/UserScriptSettingsModal.ts` | 228 | 7 | Medium | After MacroBuilder because it is command configuration, not list orchestration. |
| 12 | `src/gui/MacroGUIs/CommandSequenceEditor.ts` | 529 | 6 | High | Depends on stable command-list composition and persistence test patterns. |
| 13 | `src/gui/MacroGUIs/ConditionalCommandSettingsModal.ts` | 329 | 6 | High | Depends on `CommandList.conditional.test.ts` parity and nested branch persistence. |
| 14 | `src/gui/ModelDirectoryModal.ts` | 152 | 6 | Low | Reuse AI/model primitives built for providers and assistant settings. |
| 15 | `src/gui/ProviderPickerModal.ts` | 138 | 5 | Low | Reuse provider primitives after the larger provider modal is converted. |
| 16 | `src/gui/MultiChoiceSettingsModal.ts` | 91 | 3 | Low | Lowest churn and smallest surface; convert after shared settings conventions are proven. |

Recommended order: base primitives first, then the ChoiceBuilder trio led by capture, then MacroGUIs settings, then AI/misc long tail, with `OnePageInputModal` after the ChoiceBuilder base/trio seam is stable. Capture goes early because it is the highest-churn file in the repo slice at 27 commits/12mo and the largest conversion unit at 1451 lines. `CommandSequenceEditor` and `ConditionalCommandSettingsModal` are later despite non-trivial risk because `CommandList.svelte` already covers the highest-value macro list surface; these should follow the existing component test model rather than race ahead of the ChoiceBuilder backlog.

Plan interactions:

- [Plan 010](010-debounce-format-preview.md) is currently blocked on a ChoiceBuilder scope decision after extra per-keystroke preview formatting call sites were found. If it lands first, the capture/template migration must port its debounce and staleness guard. If the Svelte conversion starts first, fold the debounce behavior into the new format-preview primitive and avoid porting it twice.
- [Plan 013](013-dedup-append-link-setting.md) is the same seam as a future `<AppendLinkSetting>` component. If 013 lands first, preserve the hoisted base API. If Svelte conversion lands first, implement the shared component once instead of doing the TypeScript hoist and then replacing it.
- [Plan 014](014-extract-open-written-file-helper.md) is orthogonal engine cleanup. It is currently blocked by a plan/excerpt mismatch in the open-written-file helper extraction, so this GUI sequencing must not assume the engine helper exists or move engine logic into Svelte.

## Shared primitives

Build these once before converting large files:

| Primitive | Source grounding | Consumers |
|-----------|------------------|-----------|
| `<AppendLinkSetting>` | `captureChoiceBuilder.ts:addAppendLinkSetting`, `templateChoiceBuilder.ts:addAppendLinkSetting`, and Plan 013 | Capture and Template choice builders. |
| `<OpenFileSetting>` | `choiceBuilder.ts:addOpenFileSetting` | Capture and Template behavior sections; likely open-file macro settings. |
| `<FileOpeningSetting>` | `choiceBuilder.ts:addFileOpeningSetting` | Capture/Template file-opening behavior and `OpenFileCommandSettingsModal.ts`. |
| `<FormatPreviewField>` | `captureChoiceBuilder.ts:addFormatSetting`, `addInsertAfterFields`, `addInsertBeforeFields`, `templateChoiceBuilder.ts:addFileNameFormatSetting`, and Plan 010 | Capture/template formatting fields with debounce/staleness behavior. |
| `<OnePageOverrideSetting>` | `choiceBuilder.ts:addOnePageOverrideSetting` | Template/Capture choice builders and the OnePageInput workflow. |
| `<ValidatedPathInput>` / folder-file picker | `captureChoiceBuilder.ts:addCapturedToSetting`, `templateChoiceBuilder.ts:addTemplatePathSetting`, `addFolderSetting`, existing `FolderList.svelte` | File/folder path settings and canvas target setup. |

Keep the already-decided Svelte 5 constraints:

- Cross-cutting state remains in `src/settingsStore.ts`.
- Reactive-to-plain persistence boundaries use `snapshot(value)` from `src/gui/svelte/persist.svelte.ts`.
- Callback props stay on-prefixed and flattened.
- Drag/drop reuses `src/gui/shared/dndReorder.ts` and `svelte-dnd-action`.
- Imperative hosts use `mountComponent`; do not add exported-prop-reassign bridges.

## Per-file test bar

Each converted unit should ship with its own tests, modeled on:

- `src/gui/MacroGUIs/CommandList.reorder.test.ts`
- `src/gui/MacroGUIs/CommandList.conditional.test.ts`
- `src/gui/MacroGUIs/CommandList.keyboardReorder.test.ts`

Minimum bar per converted unit:

| Test type | Requirement |
|-----------|-------------|
| Mount-render test | Mount the component under jsdom using `mountComponent` or `@testing-library/svelte`, `flushSync()` where needed, and assert stable DOM output. |
| Persistence test | Edit a choice/command and assert the host callback receives a plain `snapshot()` payload, not a `$state` proxy. |
| Behavior-parity test | Cover any stateful branch, drag/reorder path, conditional path, file-opening option, or reload-dependent section that existed in the imperative UI. |

Tests that transitively import `src/main` or dataview-facing modules should keep the current stub pattern:

```ts
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
```

Future implementers should also keep the Obsidian dev-vault QA workflow as a secondary confirmation for stateful UI: `obsidian vault=dev plugin:reload id=quickadd`, `dev:console`, `dev:errors`, and screenshots where useful. Unit tests, typecheck, lint, and Svelte checks remain the primary gate; this spike did not run dev-vault proof because the Plan 020 executor did not hold the dev-vault lock.

## Atomic vs incremental

Atomic option: convert the whole imperative tail in one PR, matching the recorded #1239 intent. The benefit is one coherent architecture review and no long-lived half-migrated state. The cost is large: a single PR would cover 5236 `src/gui` imperative lines, plus the 536-line preflight modal, and would freeze the 1451-line capture builder that has 27 commits in the last 12 months. That creates a high merge-conflict risk and a review surface too large for careful behavioral parity.

Incremental option: convert by cluster behind the existing `mountComponent` seam. The benefit is reviewable PRs with a focused test bar, and capture development does not block for the lifetime of a giant rewrite. The cost is a temporary hybrid GUI where imperative hosts and Svelte components coexist. That hybrid already exists today in `templateChoiceBuilder.ts`, so the main risk is governance: each step needs a crisp boundary, source-linked tests, and no opportunistic design churn.

Recommendation: choose the incremental path, starting with shared primitives and then the ChoiceBuilder trio, unless the maintainer explicitly decides that a short-lived feature freeze is acceptable for a single atomic rewrite. The maintainer decides the final atomic-vs-incremental policy; this document recommends incremental because the remaining tail is larger than the already-migrated Svelte side and the capture builder is actively changing.

## Verification for this spike

Executed and recorded:

```text
git diff --stat 71d6ed71..HEAD -- [Plan 020 target paths]
no output

grep -rl "new Setting(" src --include="*.ts" | grep -v ".test.ts" | sort
16 files listed above

grep -rl "new Setting(" src --include="*.ts" | grep -v ".test.ts" | grep "src/gui/" | xargs wc -l | tail -1
    5236 total

grep -rl "new Setting(" src --include="*.ts" | grep -v ".test.ts" | xargs wc -l | tail -1
    5772 total

git log --since="12 months ago" --oneline -- src/gui/ChoiceBuilder/captureChoiceBuilder.ts | wc -l
      27

git ls-files '*.svelte' | wc -l
      25

git ls-files '*.svelte' | xargs wc -l | tail -1
    4887 total

ls plans/010-debounce-format-preview.md plans/013-dedup-append-link-setting.md plans/014-extract-open-written-file-helper.md
all three files exist
```
