---
title: Issue 339 - Multiline Input Context
---

# Context: per-capture or per-token multiline input

This note summarizes what exists today around VALUE prompts and multiline input,
plus potential directions for Issue #339 ("Toggle multiline input per capture
command"), for PM review.

## What exists today

### Global input prompt mode
- There is a global setting: **"Use Multi-line Input Prompt"**.
- It switches all VALUE input prompts between:
  - **Single-line** (`GenericInputPrompt`) and
  - **Multi-line** (`GenericWideInputPrompt`).

Behavior differences (code):
- Single-line: Enter submits.
- Multi-line: Ctrl/Cmd+Enter submits, and input backslashes are escaped on submit.
- Drafts are persisted separately for single vs multi (`InputPromptDraftStore` uses
  `kind: "single" | "multi"`).

Relevant code:
- `src/settings.ts` (`inputPrompt` setting)
- `src/quickAddSettingsTab.ts` (toggle UI)
- `src/gui/InputPrompt.ts` (chooses single vs multi)
- `src/gui/GenericInputPrompt/GenericInputPrompt.ts`
- `src/gui/GenericWideInputPrompt/GenericWideInputPrompt.ts`

### VALUE syntax and options (docs)
Format syntax supports:
- `{{VALUE}}` (and `{{NAME}}`) for a single prompt value.
- `{{VALUE:variable}}` for named prompts.
- Options like:
  - `|label:Helper text`
  - `|default:Some value` (or shorthand `|Some value` when no other options)
  - `|custom` for multi-option suggesters.

Docs: `docs/docs/FormatSyntax.md`.

Examples already in docs:
- Capture format: `- {{DATE:HH:mm}} {{VALUE}}`
- Named values: `{{VALUE:title}}`, `{{VALUE:description}}`
- Labeled prompt: `{{VALUE:title|label:Snake case}}`
- Default: `{{VALUE:title|default:My_Title}}`
- Suggester: `{{VALUE:Red,Green,Blue|custom}}`

### Capture choice has a per-choice *selection-as-value* override
Capture choices already have a per-choice override for whether editor selection
prefills `{{VALUE}}` (follow global, enabled, disabled).

Docs: `docs/docs/Choices/CaptureChoice.md`.

This is a good precedent for a per-capture override UI.

### One-page input supports textarea
The one-page modal already supports field type `textarea`:
- Used in scripts via `quickAddApi.requestInputs(...)`.
- Internally, the preflight scanner chooses `text` vs `textarea` for `{{VALUE}}`
  based on the *global* input prompt setting.

Docs: `docs/docs/Advanced/onePageInputs.md` and `docs/docs/QuickAddAPI.md`.

### QuickAdd API has both single and wide prompts
Scripts can call either:
- `quickAddApi.inputPrompt(...)` (single-line)
- `quickAddApi.wideInputPrompt(...)` (multi-line)

Docs: `docs/docs/QuickAddAPI.md`, `docs/docs/UserScripts.md`.

## What Issue #339 asks for
Problem statement (summary):
- Multiline input is global today.
- Users want **per-capture** (or even per-`{{VALUE}}`) control so that
  logging stays single-line, while tasks or notes can be multi-line.

## Options worth considering

### Option A: Per-capture setting (UI toggle)
- Add a capture-level override: follow global / single-line / multi-line.
- Mirrors existing "selection-as-value" per-capture override UX.
- Simple mental model for users who want a fixed behavior per Capture choice.

Pros:
- Easy to explain in UI.
- Minimal new syntax.
- Aligns with existing capture-specific overrides.

Cons:
- No fine-grained control within a capture format that uses multiple VALUEs.

### Option B: Per-token modifier (Format Syntax)
Introduce something like:
- `{{VALUE|multi}}`
- `{{VALUE:Description|multi}}`

Potential variants (to align with existing `|key:value` options):
- `{{VALUE|type:textarea}}`
- `{{VALUE:description|input:multi}}`
- `{{VALUE:description|multiline:true}}`

Pros:
- Fine-grained control per VALUE token.
- Scales to named variables and templates.

Cons:
- Adds new syntax rules and parsing.
- Need to define how it interacts with:
  - `|label:` and `|default:`
  - `|custom` (only applies to option lists)
  - unnamed `{{VALUE}}`
- Requires changes in both runtime prompts *and* one-page preflight.

### Option C: Combine A + B
- Offer per-capture override as the default behavior.
- Allow per-token override for cases that need mixed input types.

## Notes on implementation impact (for planning)
- `parseValueToken` currently recognizes only `label`, `default`, `custom` as
  options. Any new `|multi` or `|type:...` would need to extend parsing.
- `InputPrompt` currently chooses prompt type solely from global settings. A
  per-token or per-capture override would need to reach this selection.
- One-page input preflight uses the global setting to decide `text` vs `textarea`
  for `{{VALUE}}` requirements; token-level control would need to pass through
  to `RequirementCollector`.
- Multi-line prompt behavior differs from single-line (submit keys, backslash
  escaping, draft persistence kind), so it is not only a UI width change.

## Open questions for PM
1. Should multiline control be per-capture only, per-token, or both?
2. If per-token, what option syntax should we standardize on? (short `|multi`
   vs explicit `|type:textarea` / `|input:multi`)
3. If per-token, should the modifier be allowed only for single-value prompts,
   or also for option lists?
4. How should per-token settings interact with one-page input? (Should they map
   to `textarea` in the one-page modal?)

