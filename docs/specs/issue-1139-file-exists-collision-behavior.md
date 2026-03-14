# Issue 1139: File Exists Collision Behavior

## Summary

QuickAdd currently has a file collision mode called `Increment the file
name`. That behavior works for sequence-style names such as `Note1.md`, but
it is not safe for identifier-style names such as IMDb IDs like
`tt0780504.md`.

Issue `#1139` surfaced two separate problems:

1. A runtime bug: QuickAdd silently increments even when the UI implies it
   should prompt.
2. A product gap: QuickAdd only offers a trailing-number increment strategy,
   which is not appropriate for IDs, dates, invoice numbers, and similar
   filename patterns.

This spec proposes a compatibility-safe path that fixes the bug, preserves
existing workflows, and adds an identifier-safe collision strategy.

## Problem Statement

The report is based on an IMDb ID:

- `tt0780504` maps to `https://www.imdb.com/title/tt0780504/`

For this kind of filename, `tt0780505` is not a duplicate of the same note.
It is a different identifier entirely. That means the current increment
behavior is semantically wrong for that workflow, even if it is working as
designed for other users.

At the same time, many existing QuickAdd users likely rely on the current
trailing-digit increment behavior:

- `Note.md` -> `Note1.md`
- `Note1.md` -> `Note2.md`

Changing that behavior globally would be a breaking product decision.

## Goals

- Fix the prompt behavior so the UI and runtime match.
- Preserve existing increment-based workflows.
- Add an identifier-safe collision strategy.
- Improve wording so users can understand the difference between collision
  modes.
- Avoid heuristics that try to infer whether trailing digits are a counter or
  an identifier.

## Non-Goals

- Do not silently change the semantics of the current increment behavior for
  existing users.
- Do not attempt to detect IDs automatically based on filename shape.
- Do not introduce a breaking migration for existing saved choices.

## Product Decision

Keep the current behavior for compatibility, but make the collision modes more
explicit and add a new safe option.

## Proposed UX

### Setting Group

Current wording:

- `Set default behavior if file already exists`

Proposed wording:

- `If the target file already exists`

Current toggle meaning:

- Apply selected behavior automatically when enabled.
- Prompt when disabled.

Proposed toggle wording:

- `Use selected behavior automatically`

Behavior:

- `On`: apply the selected file-exists behavior without prompting.
- `Off`: prompt the user each time a matching file already exists.

Helper text:

- `When off, QuickAdd will ask what to do each time a matching file already exists.`

### Collision Options

Keep the current options:

- `Append to top`
- `Append to bottom`
- `Overwrite file`
- `Do nothing`

Rename the current option:

- From: `Increment the file name`
- To: `Increment trailing number`

Add a new option:

- `Append duplicate suffix`

## Proposed Behavior

### Increment Trailing Number

This preserves the existing semantics.

Examples:

- `Note.md` -> `Note1.md`
- `Note1.md` -> `Note2.md`
- `Note009.md` -> `Note010.md`
- `tt0780504.md` -> `tt0780505.md`

Important detail:

- If a numeric suffix already exists, preserve width with zero padding.

This means:

- `009` -> `010`
- `0780504` -> `0780505`

This is still the wrong collision mode for identifier-style names, but it is
the correct implementation of this mode.

### Append Duplicate Suffix

This is the identifier-safe collision mode.

Examples:

- `Note.md` -> `Note (1).md`
- `Note (1).md` -> `Note (2).md`
- `Note1.md` -> `Note1 (1).md`
- `tt0780504.md` -> `tt0780504 (1).md`
- `tt0780504 (1).md` -> `tt0780504 (2).md`

This mode preserves the full original base name and adds a duplicate suffix
before the extension.

## Why This Direction

### No Heuristics

QuickAdd cannot reliably infer the meaning of trailing digits. They may
represent:

- a sequence number
- an external identifier
- a date
- an invoice number
- an episode number
- a serial number

The product should let the user choose the collision policy explicitly rather
than guessing intent from the filename.

### No Breaking Change

Existing users who expect:

- `Note1.md` -> `Note2.md`

keep that behavior.

Users with identifier-based workflows gain a new, correct option:

- `Append duplicate suffix`

### Better Mental Model

The collision strategies become visibly different:

- `Increment trailing number`: mutate ending digits
- `Append duplicate suffix`: preserve the full filename and add `(1)`, `(2)`,
  etc.

## Required Bug Fixes

### 1. Prompt Semantics

When `Use selected behavior automatically` is off, QuickAdd must not
pre-apply increment behavior before checking for an existing file.

Expected behavior:

- resolve the original target path
- check whether it exists
- if it exists and auto behavior is off, prompt the user
- only perform the selected action after the prompt result is known

This addresses the current mismatch where the code silently increments even
though the setting implies the user should be asked.

### 2. Zero-Padding Preservation

When `Increment trailing number` is used and a numeric suffix already exists,
QuickAdd should preserve the suffix width after incrementing.

Expected examples:

- `Note009.md` -> `Note010.md`
- `tt0780504.md` -> `tt0780505.md`

## Migration Strategy

No breaking migration.

### Stored Values

Existing saved choices that use the current increment mode should continue to
work exactly as they do today.

Implementation options:

- keep the internal stored value as-is for backward compatibility and only
  rename the display label in the UI, or
- add compatibility mapping from the legacy value to the new displayed label

Either approach is acceptable as long as existing settings continue to load
without user action.

### Toggle Behavior

Keep the existing boolean setting that controls whether the chosen action is
applied automatically. Only fix the runtime behavior so `false` actually
results in prompting.

## Implementation Guidance

### Step 1: Fix Prompt Behavior

Update the template file creation flow so `Increment trailing number` is not
applied eagerly when auto behavior is disabled.

If auto behavior is:

- `true`: apply the selected file-exists behavior immediately
- `false`: check for existence first, then prompt

### Step 2: Fix Numeric Increment

Update the increment logic to:

- detect the trailing numeric run before the extension
- increment the numeric value
- preserve the original width with `padStart`

### Step 3: Add Duplicate Suffix Mode

Add a new file-exists resolver that:

- preserves the full base name
- inserts ` (n)` before the extension
- increments only the duplicate suffix it previously added

Examples:

- `foo.md` -> `foo (1).md`
- `foo (1).md` -> `foo (2).md`

### Step 4: UI Wording and Compatibility

- rename the displayed increment mode
- add the new duplicate suffix mode
- preserve compatibility with saved settings

## Testing

Add or update tests for:

- `tt0780504.md` increments to `tt0780505.md`
- `tt009.canvas` increments to `tt010.canvas`
- `tt009.base` increments to `tt010.base`
- when auto behavior is off and the file exists, QuickAdd prompts instead of
  silently incrementing
- when auto behavior is on and increment mode is selected, QuickAdd still
  increments automatically
- duplicate suffix mode:
  - `Note.md` -> `Note (1).md`
  - `Note (1).md` -> `Note (2).md`
  - `tt0780504.md` -> `tt0780504 (1).md`

## Rollout Recommendation

Ship this as:

1. A bug fix for prompt behavior.
2. A compatibility fix for zero-padding preservation.
3. A small feature addition for identifier-safe duplicate handling.

This resolves the reporter's IMDb use case without regressing users who depend
on the existing trailing-number increment workflow.
