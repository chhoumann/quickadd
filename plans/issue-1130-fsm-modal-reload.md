# Stabilize Modal Editing with FSM-Managed Reloads

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is not present in this repository as of 2026-03-05, so this document is the authoritative execution spec for this change.

## Purpose / Big Picture

After this change, QuickAdd users can change toggle/dropdown/button settings in QuickAdd modals without losing their place. In practical terms, when a control currently triggers `reload()` (which fully rebuilds the modal), the modal will return to the same scroll position and restore focus to the same input when possible. This directly addresses issue #1130: users will no longer be forced to scroll back and re-find where they were editing in Macro and settings flows.

The user-visible proof is simple: in a dev modal that currently jumps (the existing `quickadd:testQuickAdd` command), scrolling near the bottom and toggling “Show advanced settings” should no longer reset scroll to top or drop focus to `BODY`.

## Progress

- [x] (2026-03-05 06:06Z) Mapped reload hotspots and confirmed current behavior from code paths in `src/gui/ChoiceBuilder/*`, `src/gui/MacroGUIs/*`, and `src/gui/AIAssistant*`.
- [x] (2026-03-05 06:06Z) Captured CLI evidence that current reload flow resets scroll/focus in a real Obsidian modal via `quickadd:testQuickAdd`.
- [x] (2026-03-05 06:14Z) Implemented shared FSM-based modal reload controller in `src/gui/utils/modalReloadMachine.ts` with unit tests in `src/gui/utils/modalReloadMachine.test.ts`.
- [x] (2026-03-05 06:15Z) Integrated reload controller into scoped modals (`ChoiceBuilder`, Macro settings modals, AI settings modals) and replaced direct full-refresh `reload()` implementations.
- [x] (2026-03-05 06:16Z) Verified with `bun run test`, `bun run build`, `bun run build-with-lint`, and Obsidian CLI runtime probes in `vault=dev`.
- [x] (2026-03-05 06:44Z) Hardened reload queue handling by replacing recursive pending-reload replay with iterative draining and added two regression tests for re-entrant/coalesced reload requests.
- [x] (2026-03-05 07:56Z) Implemented phase-2 in-place UI updates for AI command settings modals so `Show advanced settings` no longer triggers full modal reload, and removed non-infinite model-change/name-edit reloads by refreshing UI elements directly.
- [x] (2026-03-05 08:06Z) Implemented phase-3 in-place subsection rendering for `OpenFileCommandSettingsModal` and `ConditionalCommandSettingsModal`, removing full reload dependency for location/type/operator/value-type UI pivots.

## Surprises & Discoveries

- Observation: the active scroll container in Obsidian modals is `.modal`, not `.modal-content`, in the tested dev flow.
  Evidence: `overflowY` is `auto` on `.modal` and `visible` on `.modal-content` during runtime inspection.

- Observation: `quickadd:testQuickAdd` already provides a deterministic CLI-openable modal that reproduces the jump behavior, so we can validate fixes without manual navigation.
  Evidence: `obsidian vault=dev command id=quickadd:testQuickAdd` reliably opens `InfiniteAIAssistantCommandSettingsModal`.

- Observation: baseline reproduction confirms both symptoms from #1130 in one action.
  Evidence: before toggle, `activeTag` was `TEXTAREA` and `shellScrollTop` was non-zero; after toggle, `activeTag` became `BODY` and `shellScrollTop` reset to `0`.

- Observation: “Show advanced settings” can legitimately clamp scroll to `0` after reload when the post-toggle modal becomes shorter than the viewport.
  Evidence: after toggling from advanced-on to advanced-off, `after.shellScrollHeight` equaled `after.shellClientHeight`, leaving no scroll range.

- Observation: model dropdown reload is a stable-height probe and demonstrates the intended preservation behavior.
  Evidence: in runtime probe, `shellScrollTop` remained `168` before and after model change, and focus stayed on `TEXTAREA`.

- Observation: `requestReload()` can be called re-entrantly during `render()`, so pending replay should avoid recursion.
  Evidence: added tests where render triggers queued reload(s), asserting two render passes and latest-reason coalescing.

- Observation: `Show advanced settings` can be updated as a local section re-render without changing surrounding settings rows.
  Evidence: CLI probe in `quickadd:testQuickAdd` showed `scrollTop` remained `220` and active element stayed `TEXTAREA` while modal height increased after toggle.

- Observation: split-direction and conditional-form pivots can be isolated to dedicated subsection containers without redrawing the full modal.
  Evidence: both modals now update only their dynamic containers (`openFileCommandSettingsModal__splitDirection`, `conditionalSettingsModal__conditionConfig`) while keeping static controls mounted.

## Decision Log

- Decision: implement an explicit finite state machine (FSM) for modal reload lifecycle instead of direct `contentEl.empty(); display();` calls.
  Rationale: the issue is specifically caused by uncontrolled full re-render side effects. An FSM makes each step explicit (`capture -> render -> restore`) and testable.
  Date/Author: 2026-03-05 / Codex

- Decision: use `xstate` as the FSM library.
  Rationale: it provides explicit transition definitions, typed events/context, and predictable action ordering for lifecycle-sensitive UI work.
  Date/Author: 2026-03-05 / Codex

- Decision: first solve user pain by preserving scroll and focus across reload, then optionally reduce reload frequency in follow-up work.
  Rationale: issue #1130 explicitly accepts restoration when full re-render is required; this gives immediate user value with lower migration risk.
  Date/Author: 2026-03-05 / Codex

- Decision: use model-change reload in `InfiniteAIAssistantCommandSettingsModal` as the primary runtime acceptance probe.
  Rationale: unlike advanced-settings toggles, model-change keeps modal height stable, so preserved scroll can be measured directly instead of clamped to zero by layout shrink.
  Date/Author: 2026-03-05 / Codex

- Decision: replace recursive pending reload replay with iterative queue draining in `ModalReloadController.requestReload`.
  Rationale: iterative draining preserves behavior while removing recursive call chains during re-entrant reload scenarios.
  Date/Author: 2026-03-05 / Codex

- Decision: convert advanced-settings visibility in AI command settings modals from full reload to in-place section rendering.
  Rationale: this is a high-frequency interaction and does not require rebuilding unrelated controls; local re-render removes unnecessary modal churn.
  Date/Author: 2026-03-05 / Codex

- Decision: remove `ModalReloadController` from `OpenFileCommandSettingsModal` and `ConditionalCommandSettingsModal` after converting their dynamic sections to in-place rendering.
  Rationale: these flows no longer require full modal redraw for their conditional UI, so keeping reload orchestration adds complexity without value.
  Date/Author: 2026-03-05 / Codex

## Outcomes & Retrospective

Implemented outcome matches purpose: reload-driven modal jumps are now handled through an FSM-based controller that captures and restores UI position. Scoped modal classes no longer call direct full-refresh reload logic without restoration.

Validation results:

- `bun run test`: passed (including new `modalReloadMachine` tests).
- `bun run build`: passed.
- `bun run build-with-lint`: passed.
- Obsidian CLI runtime probe (`vault=dev`) confirms preserved scroll/focus on model-change reload in the test modal.
- Post-merge hardening: `modalReloadMachine` now has 6 passing tests, including queued and coalesced reload behavior during render re-entrancy.
- Phase-2 follow-up: `Show advanced settings` in both AI command settings modals now updates in place (no full reload); CLI probe confirms stable scroll/focus with non-zero scroll range.
- Phase-3 follow-up: `OpenFileCommandSettingsModal` and `ConditionalCommandSettingsModal` now re-render only dynamic subsections rather than full modal content for conditional UI changes.

Remaining gap: this change reduces reload frequency in AI and macro command settings flows but does not eliminate reloads across all modal classes. Further follow-up can convert additional conditional UI paths (for example `CaptureChoiceBuilder`, `TemplateChoiceBuilder`, and provider/model editors) to fine-grained section updates.

## Context and Orientation

QuickAdd settings/configuration UI mixes Svelte and direct Obsidian `Modal` + `Setting` APIs. The jumping behavior comes from modal classes that call `reload()` methods implemented as full teardown and rebuild (`contentEl.empty(); display();`). The most important shared base is `src/gui/ChoiceBuilder/choiceBuilder.ts`, where `protected reload()` currently empties and redraws all content. `TemplateChoiceBuilder` and `CaptureChoiceBuilder` inherit this behavior and call `this.reload()` from many toggle/dropdown handlers.

Macro and AI modal classes have similar local patterns: `src/gui/MacroGUIs/ConditionalCommandSettingsModal.ts`, `src/gui/MacroGUIs/OpenFileCommandSettingsModal.ts`, `src/gui/MacroGUIs/MacroBuilder.ts`, `src/gui/MacroGUIs/AIAssistantCommandSettingsModal.ts`, `src/gui/MacroGUIs/AIAssistantInfiniteCommandSettingsModal.ts`, `src/gui/AIAssistantSettingsModal.ts`, and `src/gui/AIAssistantProvidersModal.ts`.

A finite state machine (FSM) in this plan means a small explicit model with named states and controlled transitions triggered by events. Here, the FSM controls modal reload lifecycle:

1. capture current UI state (scroll and focus),
2. run the actual render,
3. restore UI state.

This keeps behavior deterministic and avoids ad-hoc reload side effects.

## Plan of Work

Add a shared reload controller that owns the reload lifecycle and delegates actual redraw to existing modal `display()` logic. Replace direct reload implementations with event dispatch into that controller. Preserve all existing modal business logic and conditional UI sections first; only change how reload is orchestrated.

The controller will capture a snapshot before redraw: the scroll container (`.modal`), its scroll position, and a focus descriptor (which setting/control was active, plus caret/selection for text inputs). After redraw it restores scroll (clamped if content height changed) and attempts to restore focus to the matching control. If exact restoration is impossible because the control disappeared, restoration falls back to nearest stable control in the same setting row.

Add focused unit tests around the controller logic and keep runtime verification CLI-native by using `quickadd:testQuickAdd` plus `obsidian eval` scripts.

## Milestones

### Milestone 1: Build and verify the shared reload FSM

At the end of this milestone, a reusable controller exists with deterministic transitions and tests proving snapshot/restore behavior. No modal class is migrated yet.

Implement `src/gui/utils/modalReloadMachine.ts` (FSM + controller), plus tests in `src/gui/utils/modalReloadMachine.test.ts`. Add `xstate` with Bun. The tests should cover at least four cases: happy-path scroll/focus restore, clamp when new content is shorter, missing target control fallback, and no crash when no focusable element exists.

Run tests after this milestone and confirm they pass before integration.

### Milestone 2: Migrate reload-based modals to the controller

At the end of this milestone, each modal that currently uses brute-force reload in scope routes reload through the shared controller.

Edit `src/gui/ChoiceBuilder/choiceBuilder.ts` first (covers Template/Capture). Then migrate direct-reload classes: `src/gui/MacroGUIs/ConditionalCommandSettingsModal.ts`, `src/gui/MacroGUIs/OpenFileCommandSettingsModal.ts`, `src/gui/MacroGUIs/MacroBuilder.ts`, `src/gui/MacroGUIs/AIAssistantCommandSettingsModal.ts`, `src/gui/MacroGUIs/AIAssistantInfiniteCommandSettingsModal.ts`, `src/gui/AIAssistantSettingsModal.ts`, and `src/gui/AIAssistantProvidersModal.ts`.

Keep each modal’s existing `display()` content intact. Only replace the reload orchestration and ensure no duplicate `contentEl.empty()` calls happen outside the controller-managed render callback.

### Milestone 3: Runtime validation and regression hardening

At the end of this milestone, the behavior is proven in the dev vault and protected by tests.

Use the Obsidian CLI with `vault=dev` to reproduce the old path and confirm the fix. Keep debugger capture logs and one eval output snippet in this ExecPlan. Add or update tests where reload behavior is most critical so regressions are caught without manual clicking.

## Concrete Steps

Run these commands from `/Users/christian/Developer/quickadd`.

1. Install FSM dependency.

    bun add xstate

2. Implement shared controller and tests.

    - edit `src/gui/utils/modalReloadMachine.ts`
    - edit `src/gui/utils/modalReloadMachine.test.ts`

3. Integrate controller into modal classes in scope.

    - edit `src/gui/ChoiceBuilder/choiceBuilder.ts`
    - edit `src/gui/MacroGUIs/ConditionalCommandSettingsModal.ts`
    - edit `src/gui/MacroGUIs/OpenFileCommandSettingsModal.ts`
    - edit `src/gui/MacroGUIs/MacroBuilder.ts`
    - edit `src/gui/MacroGUIs/AIAssistantCommandSettingsModal.ts`
    - edit `src/gui/MacroGUIs/AIAssistantInfiniteCommandSettingsModal.ts`
    - edit `src/gui/AIAssistantSettingsModal.ts`
    - edit `src/gui/AIAssistantProvidersModal.ts`

4. Run automated checks.

    bun run test
    bun run build

5. Run runtime verification in the dev vault.

    obsidian vault=dev plugin:reload id=quickadd
    obsidian vault=dev dev:debug on
    obsidian vault=dev dev:console clear
    obsidian vault=dev dev:errors clear
    obsidian vault=dev command id=quickadd:testQuickAdd

6. Run the scroll/focus probe.

    obsidian vault=dev eval code="$(cat /tmp/qa_modal_probe.js)"

`/tmp/qa_modal_probe.js` should contain a synchronous probe that focuses textarea, scrolls `.modal`, clicks “Show advanced settings”, and prints before/after JSON.

7. Collect logs and detach.

    obsidian vault=dev dev:console limit=120
    obsidian vault=dev dev:errors
    obsidian vault=dev dev:debug off

As implementation proceeds, replace placeholder “# edit …” lines with short notes of completed edits and actual command outputs.

## Validation and Acceptance

Acceptance is behavior-driven.

Automated acceptance requires `bun run test` and `bun run build` to pass.

Runtime acceptance requires this observable behavior in the dev vault:

- Opening the test modal with `obsidian vault=dev command id=quickadd:testQuickAdd` still works.
- After scrolling near the bottom and focusing a text input, toggling “Show advanced settings” no longer resets modal scroll to top.
- Focus remains on a semantically matching input control instead of dropping to `BODY`.

The same probe command used for baseline must now show non-reset behavior. Specifically, `after.shellScrollTop` should remain close to `before.shellScrollTop` (allowing clamping if content shrinks), and `after.activeTag` should remain a form control (`TEXTAREA`, `INPUT`, or `SELECT`).

## Idempotence and Recovery

This plan is safe to run repeatedly. The new controller is additive and can be wired modal-by-modal. If one modal migration causes issues, revert that modal to its previous reload implementation while keeping the shared controller and tests in place; other migrated modals remain valid.

If runtime validation fails, use this recovery sequence:

1. Keep the failing modal on old reload logic temporarily.
2. Preserve unit tests for the controller.
3. Re-run `bun run test` and `bun run build`.
4. Re-open with CLI and re-check.

Avoid destructive Git operations; use focused file-level reverts only.

## Artifacts and Notes

Baseline reproduction artifact (before implementation):

    Command:
    obsidian vault=dev eval code="$(cat /tmp/qa_modal_eval_scroll.js)"

    Output:
    => {"before":{"shellScrollTop":207,"shellScrollHeight":1404,"shellClientHeight":1197,"activeTag":"TEXTAREA"},"after":{"shellScrollTop":0,"shellScrollHeight":921,"shellClientHeight":921,"activeTag":"BODY"}}

Supporting runtime evidence:

    Command:
    obsidian vault=dev dev:dom selector='.modal' all

    Observation:
    `.modal` is scrollable (`overflowY: auto`), so scroll restoration must target `.modal`.

Post-implementation runtime verification artifact:

    Command:
    obsidian vault=dev eval code="$(cat /tmp/qa_modal_probe_model.js)"

    Output:
    => {"before":{"shellScrollTop":168,"shellScrollHeight":1365,"shellClientHeight":1197,"activeTag":"TEXTAREA","selectedModel":"gpt-4"},"after":{"shellScrollTop":168,"shellScrollHeight":1365,"shellClientHeight":1197,"activeTag":"TEXTAREA","selectedModel":"text-davinci-003"}}

## Interfaces and Dependencies

Add dependency:

- `xstate` via `bun add xstate`.

Define in `src/gui/utils/modalReloadMachine.ts`:

    export type ModalReloadState =
      | "idle"
      | "capturing"
      | "rendering"
      | "restoring";

    export interface FocusSnapshot {
      settingName: string | null;
      controlTag: "INPUT" | "TEXTAREA" | "SELECT" | "BUTTON";
      inputType?: string;
      selectionStart?: number | null;
      selectionEnd?: number | null;
    }

    export interface ModalUiSnapshot {
      scrollTop: number;
      focus: FocusSnapshot | null;
    }

    export interface ModalReloadControllerOptions {
      modalEl: HTMLElement;
      contentEl: HTMLElement;
      render: () => void;
      onTransition?: (from: ModalReloadState, to: ModalReloadState, reason: string) => void;
    }

    export class ModalReloadController {
      constructor(options: ModalReloadControllerOptions);
      requestReload(reason: string): void;
      getLastSnapshot(): ModalUiSnapshot | null;
    }

Integration rule for every migrated modal:

- Replace direct `reload()` body with `controller.requestReload("<reason>")`.
- Keep domain data updates (choice/command mutation) unchanged.
- Ensure the controller-owned `render()` callback performs the exact prior redraw steps so UI content remains functionally identical.

Revision Note (2026-03-05): Initial ExecPlan created in response to issue #1130 and user request to pursue an FSM-based solution rather than ad-hoc `reload()` calls.
Revision Note (2026-03-05): Updated after implementation to reflect completed milestones, final validation evidence, and runtime probe adjustments needed to distinguish true preservation from expected scroll clamping.
Revision Note (2026-03-05): Updated after merge with queue-drain hardening and additional controller regression tests for re-entrant reload requests.
Revision Note (2026-03-05): Updated for phase-2 partial migration that removes full reloads from advanced-settings toggles in AI command settings modals and records new CLI evidence.
Revision Note (2026-03-05): Updated for phase-3 partial migration that replaces reload-driven conditional sections in Open File and Conditional command settings modals with in-place container rerenders.
