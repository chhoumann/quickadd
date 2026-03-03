# Rebuild QuickAdd Settings UI Around Draft Sessions and Serialized Persistence

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` was not found in this repository at the time this ExecPlan was authored (searched from repository root on 2026-03-02). This document therefore follows the required ExecPlan structure directly and must continue to be maintained as a living plan.

## Purpose / Big Picture

After this change, a QuickAdd user will be able to edit complex settings (especially Capture and Template choices) without the UI jumping, losing scroll position, or dropping cursor focus during normal interactions. The plugin will still persist settings to Obsidian’s file-based plugin config (`data.json`), but writes will be serialized and coalesced so state is durable without writing on every keystroke. A maintainer can verify success by editing a long form in QuickAdd settings, toggling sections repeatedly, and observing that the form stays stable while settings still persist after reload.

## Progress

- [x] (2026-03-02 10:35Z) Established baseline problem and identified teardown-based rendering (`contentEl.empty() + display()`) as primary state-loss source.
- [x] (2026-03-02 10:45Z) Confirmed current persistence wiring writes on every `settingsStore` mutation via `main.ts` subscription.
- [x] (2026-03-02 10:52Z) Ran persistence behavior experiments and captured evidence on write overhead and race risk patterns.
- [x] (2026-03-02 11:05Z) Authored this ExecPlan with milestones, interfaces, validation strategy, and recovery guidance.
- [x] (2026-03-02 15:05Z) Implemented Milestone 1: serialized write-behind persistence queue (`src/state/settingsPersistenceQueue.ts`) and deterministic tests; migrated `main.ts` subscription to queued scheduling.
- [x] (2026-03-02 15:20Z) Implemented Milestone 2: added `uiStore`, `createDraftSession`, tests, and migrated `OpenFileCommandSettingsModal` to draft-session flow without reload-driven re-rendering.
- [x] (2026-03-02 16:10Z) Implemented Milestone 3 goals via section-scoped rerendering in Capture/Template builders (no full-modal reloads); this deviates from the original “single-mount Svelte editor” implementation detail.
- [x] (2026-03-02 16:23Z) Implemented Milestone 4: added dev verification seam (`window.__quickaddDebug`), UI reload counters, persistence burst metrics, and validated via Obsidian CLI + full lint/test/build.
- [x] (2026-03-02 17:40Z) Implemented Follow-up 1: queue failure hardening via bounded `flushNow` retries/timeouts and deterministic failure reporting.
- [x] (2026-03-02 17:40Z) Implemented Follow-up 2: reduced clone pressure by moving snapshot cloning to write time (coalesced bursts clone once per flush attempt).
- [x] (2026-03-02 17:42Z) Implemented Follow-up 3: formalized OpenFile modal close semantics through shared result resolver + unit tests for save/cancel/dismiss.
- [x] (2026-03-02 17:43Z) Implemented Follow-up 4: applied UI-context preservation to section-level rerenders in Capture/Template builders.
- [x] (2026-03-02 17:45Z) Implemented Follow-up 5: extracted shared behavior-section helpers for one-page override and file opening controls.
- [x] (2026-03-02 17:48Z) Implemented Follow-up 6: added integration tests for queue + `settingsStore` subscription/dispose lifecycle.
- [x] (2026-03-02 17:53Z) Implemented Follow-up 7: added stable CLI debug command surface (`quickadd:debug`) while retaining namespace compatibility.
- [x] (2026-03-02 21:38Z) Added full simplification feedback backlog from Claude pass (`claude -p "/simplify but don't fix, just give the feedback"`).
- [x] (2026-03-02 21:52Z) Implemented simplification backlog items across builder deduplication, CLI utility reuse, draft-session consistency, queue/preserve-ui refinements, and targeted efficiency cleanups; reran tests/build + Obsidian CLI verification.

## Surprises & Discoveries

- Observation: The current persistence path saves settings on every mutation because `main.ts` subscribes to `settingsStore` and immediately calls `saveSettings()`.
  Evidence: `src/main.ts:56-59` shows subscription callback invoking `void this.saveSettings()`.

- Observation: Single file writes are fast on local disk, but speed is not the core risk; ordering and concurrency behavior are.
  Evidence:

    Working directory: `/Users/christian/Developer/quickadd`
    Command:
        node -e 'const fs=require("fs/promises");const path="/tmp/qa-save-bench.json";const obj=JSON.parse(require("fs").readFileSync("/Users/christian/Developer/dev_vault/dev/.obsidian/plugins/quickadd/data.json","utf8"));const text=JSON.stringify(obj);(async()=>{const n=200;const t0=Date.now();for(let i=0;i<n;i++){await fs.writeFile(path,text,"utf8");}const dt=Date.now()-t0;console.log({bytes:text.length,writes:n,totalMs:dt,avgMs:dt/n});})();'
    Output:
        { bytes: 26465, writes: 200, totalMs: 26, avgMs: 0.13 }

- Observation: Naive async save fan-out can end with stale state if completion order is nondeterministic.
  Evidence:

    Command (simulated naive concurrent saves):
        node - <<'NODE'
        class NaivePersistence {
          constructor() { this.disk = null; }
          async save(state) {
            const delay = Math.floor(Math.random() * 20);
            await new Promise((r) => setTimeout(r, delay));
            this.disk = state;
          }
        }
        async function runOnce() {
          const p = new NaivePersistence();
          const promises = [];
          for (let i = 1; i <= 50; i++) promises.push(p.save(i));
          await Promise.all(promises);
          return p.disk;
        }
        (async () => {
          let stale = 0;
          const runs = 500;
          for (let i = 0; i < runs; i++) if ((await runOnce()) !== 50) stale++;
          console.log({ runs, staleRuns: stale, staleRate: stale / runs });
        })();
        NODE
    Output:
        { runs: 500, staleRuns: 477, staleRate: 0.954 }

- Observation: A serialized queue model eliminates stale-final-state outcomes under the same delay model.
  Evidence:

    Command (simulated queued writes):
        node - <<'NODE'
        class QueuedPersistence {
          constructor() { this.disk = null; this.pendingState = null; this.inflight = false; }
          schedule(state) { this.pendingState = state; if (!this.inflight) void this.flushLoop(); }
          async flushLoop() {
            this.inflight = true;
            while (this.pendingState !== null) {
              const next = this.pendingState;
              this.pendingState = null;
              const delay = Math.floor(Math.random() * 20);
              await new Promise((r) => setTimeout(r, delay));
              this.disk = next;
            }
            this.inflight = false;
          }
        }
        async function runOnce() {
          const p = new QueuedPersistence();
          for (let i = 1; i <= 50; i++) p.schedule(i);
          while (p.inflight || p.pendingState !== null) await new Promise((r) => setTimeout(r, 1));
          return p.disk;
        }
        (async () => {
          let stale = 0;
          const runs = 500;
          for (let i = 0; i < runs; i++) if ((await runOnce()) !== 50) stale++;
          console.log({ runs, staleRuns: stale, staleRate: stale / runs });
        })();
        NODE
    Output:
        { runs: 500, staleRuns: 0, staleRate: 0 }

- Observation: TypeScript control-flow narrowing does not model async callback assignment in tests; direct nullable snapshot variables were treated as effectively never-updated in `tsc --noEmit`.
  Evidence: `bun run build-with-lint` initially failed with `TS2339` in `src/state/settingsPersistenceQueue.test.ts` until the test switched to an explicit write-collection pattern.

- Observation: `obsidian vault=dev command id=app:open-settings` does not expose a usable settings leaf handle for scripted tab introspection in this environment (`app.setting.lastTab` stayed null in eval).
  Evidence: CLI eval checks repeatedly returned `no-tab` / `null` even after open-settings command execution.

## Decision Log

- Decision: Build around serialized write-behind persistence instead of immediate write-through on each mutation.
  Rationale: The main reliability risk is ordering under asynchronous saves, not raw write speed. Serializing writes guarantees that the newest revision is durable.
  Date/Author: 2026-03-02 / Codex.

- Decision: Split persistent settings state from ephemeral UI state.
  Rationale: UI-only concerns (expanded sections, filters, scroll hints, active tab in a modal) should never be stored in plugin config. Keeping them separate reduces unintended persistence churn and model coupling.
  Date/Author: 2026-03-02 / Codex.

- Decision: Use draft editing sessions in modals with explicit commit on Save.
  Rationale: Modern UI behavior requires local reactive updates without global state writes on each input event. Draft sessions remove reload-driven rendering and preserve in-progress edits naturally.
  Date/Author: 2026-03-02 / Codex.

- Decision: Migrate the hottest surfaces first (Capture and Template builders) before broad cleanup.
  Rationale: These are highest-frequency interaction points and largest source of user-visible frustration.
  Date/Author: 2026-03-02 / Codex.

- Decision: Implement Milestone 3 with section-scoped rerendering in existing TypeScript builders instead of full Svelte editor replacement in this change set.
  Rationale: This removed full-modal teardown and preserved behavior parity with lower migration risk while still eliminating the primary state-loss path.
  Date/Author: 2026-03-02 / Codex.

- Decision: Expose verification seam as dev-only global namespace (`window.__quickaddDebug`) with queue stats and UI counters.
  Rationale: Obsidian CLI can invoke eval expressions against a stable object shape, enabling deterministic regression checks without UI-only interactions.
  Date/Author: 2026-03-02 / Codex.

## Outcomes & Retrospective

Milestones 1-4 are now implemented in this branch. Persistence moved to a serialized, coalescing queue with deterministic tests; draft-session infrastructure exists and is used by `OpenFileCommandSettingsModal`; Capture/Template builders no longer perform full-modal teardown during routine toggles (they rerender only affected sections); and a dev-only CLI-verifiable seam reports persistence and UI metrics.

Key outcomes:
- `bun run lint` passes.
- `bun run test` passes (`101` files passed, `2` skipped at last run).
- `bun run build-with-lint` passes.
- Obsidian CLI verification in `vault=dev` shows:
  - no runtime errors captured in `dev:errors`,
  - coalesced burst persistence (`writesDuringBurst: 1` for 10 scheduled revisions),
  - focus-stability helper available and returning `true` in scripted check.

Remaining limitation:
- Milestone 3 implementation uses section-scoped rerendering in TypeScript builders rather than new Svelte editor components, so focus can still reset within the rerendered section itself. Full single-mount Svelte migration can be done as follow-up if stricter focus invariants are required.

Follow-up completion update (2026-03-02):
- Queue hardening and performance follow-ups are now implemented and covered by new/updated tests.
- Open-file modal semantics are explicit and unit-tested.
- Section-level focus preservation and behavior deduplication are implemented in Capture/Template builders.
- CLI-verifiable debug operations are now exposed through `quickadd:debug` (get/reset/flush), not only a global namespace.
- Full validation rerun succeeded: lint, full test suite, and build-with-lint.

## Senior Review Follow-up Backlog

This section captures a fresh-eyes senior-engineering pass after Milestones 1-4 completion. Items are prioritized for reliability first, then maintainability and observability.

### Follow-up 1 (High): Persistence queue failure hardening

Problem:
- `flushNow()` can enter an effectively unbounded retry loop if `saveFn` keeps failing because failed revisions are re-queued and flush mode bypasses debounce delay.

Scope:
- Add bounded retry behavior and explicit timeout/cancellation support for `flushNow()`.
- Surface terminal failures through logger/reporting path.
- Ensure queue state remains coherent when retries are exhausted.

Validation:
- New deterministic tests for repeated save failures with retry exhaustion.
- Verify `flushNow()` rejects predictably within timeout bounds.
- Confirm no busy-looping under persistent write failure.

### Follow-up 2 (High): Reduce persistence snapshot cost

Problem:
- Full deep clone on every `schedule()` can become expensive for large settings trees and high-frequency updates.

Scope:
- Evaluate delayed snapshotting (clone at write time), or immutable structural sharing strategy.
- Keep stale-write protections and deterministic semantics unchanged.

Validation:
- Add micro-benchmark test/seam for burst schedule cost.
- Confirm coalescing semantics and latest-revision durability remain unchanged.

### Follow-up 3 (Medium): Modal close semantics formalization (Open File)

Problem:
- Open-file settings modal now treats close/X/Escape as cancel (`null`), which should be intentional and explicitly tested.

Scope:
- Document expected behavior for Save, Cancel button, close icon, and Escape.
- Add modal-level tests to prevent regressions in resolve semantics.

Validation:
- Tests proving each closure path returns intended value.
- Runtime sanity check in Obsidian for keyboard and click closure paths.

### Follow-up 4 (Medium): Preserve focus/caret through section rerenders

Problem:
- Full-modal teardown is removed, but section-level rerenders still replace DOM and can reset focus/caret within that section.

Scope:
- Apply `preserveUiContext` (or equivalent) to section rerender helpers.
- Prioritize high-churn inputs in Capture/Template flows.

Validation:
- Add verification seam counters per section rerender path.
- CLI/eval checks demonstrating focus identity stability during representative toggles.

### Follow-up 5 (Medium): Capture/Template builder deduplication

Problem:
- Capture and Template builders now duplicate behavior-rendering logic (open-file settings, one-page override variants, section orchestration).

Scope:
- Extract shared helpers/base abstractions for behavior section rendering and common controls.
- Preserve choice-specific differences while reducing drift risk.

Validation:
- Type-safe shared helper coverage.
- No behavior regressions in existing builder tests and manual verification.

### Follow-up 6 (Medium): Integration coverage for queue + plugin lifecycle

Problem:
- Unit tests cover queue behavior, but plugin lifecycle integration paths (subscription + unload flush) need direct regression protection.

Scope:
- Add integration tests around `main.ts` lifecycle boundaries with mocked persistence sink.
- Include migration and save paths that call `saveSettings()`.

Validation:
- Tests proving latest revision persisted across load/mutate/unload cycles.
- Failure-path test proving unload flush does not silently hang.

### Follow-up 7 (Low): Stabilize debug surface for CLI verification

Problem:
- `window.__quickaddDebug` is useful but global APIs can drift and are less discoverable than explicit command seams.

Scope:
- Promote debug operations to a stable dev command/API surface consumed by CLI eval/command workflows.
- Keep current namespace as compatibility shim during transition.

Validation:
- CLI transcript using only stable seam.
- Backward-compatible behavior during deprecation window for global namespace access.

## Simplification Feedback Backlog (Claude Pass, 2026-03-02)

This section captures all feedback items from the Claude simplification pass.
Items are tracked individually even where they overlap previously completed work.

### Code Reuse

- [x] [High] Remove dead base-class methods from
      `src/gui/ChoiceBuilder/choiceBuilder.ts`:
      `addOnePageOverrideSetting`,
      `addOpenFileSetting`,
      `addFileOpeningSetting`.
- [x] [High] Deduplicate identical `renderSection` implementations in
      `src/gui/ChoiceBuilder/captureChoiceBuilder.ts` and
      `src/gui/ChoiceBuilder/templateChoiceBuilder.ts` by moving shared logic
      to base class.
- [x] [High] Avoid reimplementing flattening logic in
      `src/cli/registerQuickAddCliHandlers.ts`; extend/reuse
      `src/utils/choiceUtils.ts:flattenChoices` with optional path segments.
- [x] [High] Replace repeated `instanceof Error ? error.message : String(error)`
      handling in CLI with shared `src/utils/errorUtils.ts:toError`.
- [x] [Low] Replace `checkObjectDiff` usage in
      `src/gui/AIAssistant/AIAssistantProvidersModal.ts` with
      `createDraftSession().isDirty()` where appropriate.
- [x] [Low] Extract a shared save/cancel modal action bar helper used by:
      `src/gui/MacroGUIs/OpenFileCommandSettingsModal.ts`,
      `src/gui/MacroGUIs/ConditionalCommandSettingsModal.ts`,
      `src/gui/MacroGUIs/ConditionalBranchEditorModal.ts`.

### Code Quality

- [x] [Medium] Simplify `flushNow` in
      `src/state/settingsPersistenceQueue.ts` by separating timeout, retry, and
      loop-wake responsibilities.
- [x] [Medium] Document and/or refactor double-restore behavior in
      `src/gui/utils/preserveUiContext.ts:scheduleRestore` to make intent
      explicit and controllable.
- [x] [Medium] Consolidate debug API access in `src/main.ts`:
      prefer `getDebugApi(): QuickAddDebugApi | null` over multiple pass-through
      debug methods and avoid leaking queue internals in public return types.
- [x] [Medium] Migrate `src/gui/AIAssistant/AIAssistantProvidersModal.ts` to
      `DraftSession` pattern for consistency with Open File modal editing.
- [x] [Low] Remove dual source of truth for `filterQuery` in
      `src/gui/ChoiceView.svelte` (local state vs `uiStore` field).
- [x] [Low] Revisit `scheduledRevisions` stat in
      `src/state/settingsPersistenceQueue.ts`; rename or remove to avoid
      misleading metrics.
- [x] [Low] Simplify no-op conditional branch in
      `src/gui/MacroGUIs/ConditionalCommandSettingsModal.ts:cloneCondition`.
- [x] [Low] Replace stringly-typed debug actions (`"get"`, `"reset"`, `"flush"`)
      in `src/cli/registerQuickAddCliHandlers.ts` with typed constants/union.

### Efficiency

- [x] [Medium] Reduce repeated `querySelectorAll` work in
      `src/gui/utils/preserveUiContext.ts` by reusing scroll target discovery
      across capture + restore passes.
- [x] [Medium] Add caching or memoization for vault-wide scans triggered by
      section rerenders in:
      `src/gui/ChoiceBuilder/captureChoiceBuilder.ts` and
      `src/gui/ChoiceBuilder/templateChoiceBuilder.ts`.
- [x] [Medium] Optimize `createDraftSession().isDirty()` in
      `src/state/createDraftSession.ts` for repeated checks (dirty flag and/or
      incremental tracking).
- [x] [Medium] Cancel losing timeout in
      `src/state/settingsPersistenceQueue.ts:waitForPromiseOrTimeout`.
- [x] [Medium] Reconsider timeout window reset across retries in
      `src/state/settingsPersistenceQueue.ts` so max wait does not scale by
      retry count under persistent failure.
- [x] [Low] Avoid scheduling persistence writes on semantically unchanged
      settings in `src/main.ts` subscriber path.
- [x] [Low] Memoize `prepareFuzzySearch` usage in
      `src/gui/ChoiceView.svelte` when inputs are unchanged.
- [x] [Low] Add cleanup/eviction strategy for stale `collapsedChoiceIds` in
      `src/gui/stores/uiStore.ts`.
- [x] [Low] Avoid full-vault template scans on every request in
      `src/main.ts:getTemplateFiles` (cache/index by folder path).
- [ ] [Low] Revisit `api` getter allocation pattern in `src/main.ts` to avoid
      constructing a new `ChoiceExecutor` per access.

## Context and Orientation

This repository is an Obsidian community plugin named QuickAdd. Obsidian plugins persist settings by calling the plugin method `saveData(...)`, which writes JSON into the plugin’s data file (`<vault>/.obsidian/plugins/quickadd/data.json`). In this codebase, settings are held in a Zustand store at `src/settingsStore.ts` and mirrored onto the plugin instance in `src/main.ts`.

The current persistence flow is:

1. `onload()` calls `settingsStore.setState(this.settings)`.
2. `main.ts` subscribes to store changes.
3. Every change triggers `this.saveSettings()`, which calls `saveData(this.settings)`.

The current rendering problem appears because many modals are written in imperative style: a change handler calls `reload()`, which empties modal content and rebuilds all controls. Browser state (scroll, focus, cursor selection) belongs to DOM nodes, so replacing nodes removes that state. This is why users report “full modal refresh” and losing edit position.

Important files for this plan:

- `src/main.ts`: plugin lifecycle, settings load/save, and global settings subscription.
- `src/settingsStore.ts`: current global settings store.
- `src/quickAddSettingsTab.ts`: settings tab composition.
- `src/gui/ChoiceBuilder/choiceBuilder.ts`: base for Capture/Template builders.
- `src/gui/ChoiceBuilder/captureChoiceBuilder.ts`: high-churn settings UI for Capture choices.
- `src/gui/ChoiceBuilder/templateChoiceBuilder.ts`: high-churn settings UI for Template choices.
- `src/gui/choiceList/ChoiceView.svelte`: Svelte settings view host for choices.

Key plain-language terms used in this plan:

- Durable state: settings that must survive plugin reload (saved to `data.json`).
- Ephemeral state: UI-only state that must not be saved (open panels, temporary filters).
- Draft session: an in-memory editable copy used by a modal until user clicks Save.
- Write-behind queue: a single-writer persistence mechanism that coalesces many updates and flushes them in order.

## Plan of Work

### Milestone 1: Introduce serialized persistence queue and migrate `main.ts` to use it

This milestone adds a small persistence subsystem that ensures only one write runs at a time and only the latest revision is persisted after bursts of updates. At the end of this milestone, no user-facing UI changes are required, but persistence semantics become safe and observable.

Create `src/state/settingsPersistenceQueue.ts` with a queue class that accepts complete `QuickAddSettings` snapshots and writes them through an injected async save function. The queue must track revision numbers internally so older in-flight writes cannot become the final durable state. Add coalescing behavior: if five updates arrive while one write is running, only the newest snapshot should be written next.

Add `src/state/settingsPersistenceQueue.test.ts` with deterministic tests that simulate delayed writes and verify final persisted revision is always latest. Include tests for burst updates, in-flight update arrival, and flush-on-demand behavior.

Update `src/main.ts` so the settings subscription does not call `saveSettings()` directly. Instead it calls `persistenceQueue.schedule(settings)` and stores queue instance on plugin class. Add unload handling that attempts a best-effort `flushNow()` before unsubscribe completes.

Acceptance for milestone 1 is passing tests and a new test proving stale-final-state cannot occur under delayed async writes.

### Milestone 2: Add explicit state layers and a reusable draft-session helper

This milestone introduces a clean boundary between durable settings and ephemeral UI state and creates one reusable draft-editing helper used by modal UIs.

Create `src/state/uiStore.ts` for non-persisted state only. Initial keys should include choice filter text and per-choice expansion state. Do not move all UI at once; start with only keys needed by migrated surfaces.

Create `src/state/createDraftSession.ts` that takes an input object, returns mutable draft state and `commit`/`discard` behavior, and emits a minimal patch or full replacement object for caller-controlled persistence.

Add unit tests in `src/state/createDraftSession.test.ts` proving that editing draft does not mutate source object until commit, and discard restores original behavior.

Migrate one modal as pilot (recommended: `src/gui/MacroGUIs/OpenFileCommandSettingsModal.ts`) to draft-session pattern: no content teardown on option changes, local reactive state, commit only on Save button. This is a controlled migration with manageable complexity.

Acceptance for milestone 2 is that pilot modal no longer calls reload for normal option changes and tests for draft isolation pass.

### Milestone 3: Convert Capture and Template builders to single-mount Svelte editors

This milestone delivers the primary user value by replacing rebuild-heavy imperative builders with single-mounted Svelte components.

Create new Svelte components:

- `src/gui/ChoiceBuilder/CaptureChoiceEditor.svelte`
- `src/gui/ChoiceBuilder/TemplateChoiceEditor.svelte`

Each component receives a draft object and callback props (`onSave`, `onCancel`). Conditional sections must be implemented with Svelte conditionals (`{#if}` blocks) and local reactive state, not by destroying and rebuilding the full modal body.

Refactor:

- `src/gui/ChoiceBuilder/captureChoiceBuilder.ts`
- `src/gui/ChoiceBuilder/templateChoiceBuilder.ts`
- `src/gui/ChoiceBuilder/choiceBuilder.ts`

The builder class should mount editor once and delegate input handling to Svelte. Keep modal shell responsibilities (title, open/close) but remove repeated teardown calls for routine interaction.

Add tests where practical for helper logic extracted from builders. For UI behavior, add a dev verification seam (Milestone 4) because jsdom cannot fully prove scroll/focus behavior in real Obsidian rendering.

Acceptance for milestone 3 is that repeated toggling in Capture/Template forms does not recreate full modal content and editing caret remains in place.

### Milestone 4: Add CLI-verifiable runtime checks, remove obsolete reload paths, and finalize docs

Add a dev-only verification seam callable from Obsidian CLI using `obsidian vault=dev eval ...` that returns structured status for key invariants:

- number of full modal rebuilds after initial mount,
- whether focused input identity stayed stable during scripted toggles,
- number of persistence writes during burst input.

Keep this seam lightweight and dev-only. It can be exposed as helper functions attached under plugin debug namespace when `devMode` is true.

Remove obsolete preservation wrappers that are no longer needed for migrated builders, while retaining any still required for untouched modals. Update docs/comments in touched files to explain new architecture and why durable and ephemeral states are separated.

Acceptance for milestone 4 is passing lint/tests/build and a CLI transcript showing stable focus and bounded writes in the migrated surfaces.

## Concrete Steps

Run all commands from repository root: `/Users/christian/Developer/quickadd`.

1. Confirm baseline and create a working branch tied to issue 1130.

    git status --short --branch
    gh issue develop 1130
    git checkout 1130-feature-request-ux-improvement-modal-completely-refreshes-on-button-clicks-causing-loss-of-edit-position

2. Implement Milestone 1 files and tests.

    bun run lint
    bun run test

   Expected: lint exits `0`; tests include new persistence queue tests and all pass.

3. Implement Milestone 2 draft-session files and pilot modal migration.

    bun run lint
    bun run test

   Expected: no new ESLint errors; draft-session tests pass.

4. Implement Milestone 3 Capture and Template editor conversion.

    bun run lint
    bun run test
    bun run build-with-lint

   Expected: build succeeds; generated artifacts stay consistent unless intentional.

5. Perform runtime verification in Obsidian dev vault.

    obsidian vault=dev plugin:reload id=quickadd
    obsidian vault=dev dev:debug on
    obsidian vault=dev dev:console clear
    obsidian vault=dev dev:errors clear

   Open QuickAdd settings and run scripted checks via `obsidian vault=dev eval code='...'` for focus stability and rebuild counters defined in Milestone 4.

    obsidian vault=dev dev:console limit=200
    obsidian vault=dev dev:errors
    obsidian vault=dev dev:debug off

   Expected: zero runtime errors; logs show no unexpected full rebuilds for migrated builders; persistence write count is coalesced (not per-keystroke).

## Validation and Acceptance

Validation is complete only when all of the following are true:

- Automated checks pass:

    bun run lint
    bun run test
    bun run build-with-lint

- Behavior is verified in the real app (`vault=dev`):
  - In a long Capture builder form, toggling options does not jump to top.
  - Caret remains in the active text field after toggling dependent sections.
  - Closing and reopening settings shows saved changes persisted in QuickAdd behavior.

- Persistence correctness is verified:
  - Burst updates do not create stale final file content.
  - Debug verification seam reports serialized write behavior and latest revision persistence.

- Acceptance phrased as user-visible behavior:
  - A user can keep typing in a Capture/Template setting while toggling related options and does not lose place.
  - A user’s final saved edits remain after plugin reload (`obsidian vault=dev plugin:reload id=quickadd`).

## Idempotence and Recovery

This plan is designed to be safely repeatable.

- Running lint/test/build commands repeatedly is safe.
- Queue and draft-session code additions are additive and can be introduced incrementally.
- If a milestone is partially implemented, keep tests compiling by preserving old code paths behind temporary adapters until migration is complete.
- If runtime verification fails, revert only the affected milestone files, keep earlier milestones intact, and rerun tests before proceeding.
- Never use destructive git commands in recovery; use targeted file restores or explicit commits.

## Artifacts and Notes

Use concise terminal evidence in commit messages or PR description. Include snippets like the following when validating milestone outcomes:

    bun run test
    ...
    Test Files  XXX passed
    Tests       YYY passed

    obsidian vault=dev dev:errors
    No errors captured.

    obsidian vault=dev eval code='/* verification helper call */'
    => { rebuildsAfterMount: 0, focusStable: true, writesDuringBurst: 1 }

When reporting persistence behavior, include before/after counters for writes and revisions so reviewers can confirm coalescing happened in practice.

## Interfaces and Dependencies

Implement these concrete interfaces and keep names stable unless a later Decision Log entry records a rename.

In `src/state/settingsPersistenceQueue.ts`, define:

    export interface SettingsPersistenceQueueOptions {
      debounceMs: number;
      maxWaitMs: number;
    }

    export interface SettingsPersistenceStats {
      scheduledRevisions: number;
      flushedRevisions: number;
      lastFlushedRevision: number;
      writesStarted: number;
      writesCompleted: number;
    }

    export class SettingsPersistenceQueue {
      constructor(
        saveFn: (settings: QuickAddSettings) => Promise<void>,
        options?: Partial<SettingsPersistenceQueueOptions>,
      );
      schedule(next: QuickAddSettings): number;
      flushNow(): Promise<void>;
      getStats(): SettingsPersistenceStats;
      dispose(): Promise<void>;
    }

In `src/state/createDraftSession.ts`, define:

    export interface DraftSession<T> {
      draft: T;
      commit(): T;
      discard(): void;
      isDirty(): boolean;
    }

    export function createDraftSession<T extends object>(source: T): DraftSession<T>;

In `src/state/uiStore.ts`, define a non-persistent store with at least:

    export interface QuickAddUiState {
      choiceFilterQuery: string;
      collapsedChoiceIds: Record<string, boolean>;
    }

    export const uiStore: {
      getState: () => QuickAddUiState;
      setState: (partial: Partial<QuickAddUiState>) => void;
      subscribe: (listener: (state: QuickAddUiState) => void) => () => void;
    };

Dependencies and constraints:

- Use existing toolchain (`bun`, `vitest`, `svelte`, `zustand`).
- Do not add new runtime dependencies unless strictly necessary; if added, record why in Decision Log.
- Keep compatibility with existing `settingsStore` consumers during migration by introducing adapters rather than big-bang rewrites.

## Revision Note

2026-03-02 / Codex: Initial ExecPlan authored in response to request for a clean rebuild strategy that supports Obsidian file-backed persistence without reload-driven UI state loss. Included concrete experiments and evidence to justify serialized persistence and draft-session architecture.
