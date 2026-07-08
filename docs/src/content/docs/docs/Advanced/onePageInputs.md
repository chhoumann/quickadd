---
title: One-page Inputs
description: Collect all QuickAdd inputs in a single dynamic form
slug: docs/Advanced/onePageInputs
---


QuickAdd can collect all inputs in a single, dynamic form before running your choice.
For a task-oriented overview of prompts in general, see [Controlling Prompts](/docs/ControllingPrompts/).

## Enable
- Settings → QuickAdd → toggle “One-page input for choices”.
- Works with Template, Capture, and Macro choices. For Macros, only script-declared inputs are collected (see User Scripts below).

## Per-choice override
Template and Capture choice builders have a **One-page input override** dropdown that lets you override the global setting for that choice:
- **Follow global setting** – use whatever the global toggle is set to (default).
- **Always** – force the one-page modal for this choice even if disabled globally.
- **Never** – disable the one-page modal for this choice even if enabled globally.

## What gets collected
- Format variables in filenames, templates, and capture content:
  - `{{VALUE}}`, `{{VALUE:name}}`, `{{VDATE:name, YYYY-MM-DD}}`, `{{FIELD:name|...}}`
  - Nested `{{TEMPLATE:path}}` are scanned recursively.
- `{{VALUE|type:multiline}}` and `{{VALUE:name|type:multiline}}` render as textareas in the one-page modal.
- `{{VALUE:name|type:number|min:1|max:10}}` renders as a bounded numeric input, and `{{VALUE:name|type:slider|min:0|max:100|step:5}}` renders as a slider plus numeric input.
- Capture target file when capturing to a folder or tag.
- Script-declared inputs (from user scripts inside macros), if provided.

## Date UX
- Date fields support natural language (e.g., “today”, “next friday”).
- Short aliases like `t` (today), `tm` (tomorrow), and `yd` (yesterday) are supported and configurable in settings.
- The modal shows a formatted preview and stores a normalized `@date:ISO` internally.

## FIELD UX
- FIELD inputs get inline suggestions from your vault (Dataview if available, with a manual fallback).
- `{{FIELD:...|multi}}` is collected by the runtime multi-select after the one-page modal, when one is shown. It is not rendered inline in the one-page form because vault field values can contain commas.

## Optional fields
- Fields whose tokens carry the `|optional` flag (see [Optional fields](/docs/FormatSyntax/#optional-fields)) show an "(optional)" badge and may be left empty. An empty optional field stores an intentional empty value — the sequential prompt will not re-ask for it.
- A field counts as optional only when **every** occurrence of that variable across the scanned formats is flagged.
- Optional dropdowns get a "Skip (leave empty)" entry; the first real option stays preselected.
- Optional date fields left blank resolve to empty. If the typed text cannot be parsed as a date, the field is handed to the regular sequential date prompt after submit instead of silently becoming empty.

## Skipping the modal
- If all required inputs already have values (e.g., prefilled by an earlier macro step), the modal will not open.
- Empty string is considered an intentional value and will not prompt again. This now applies to `{{VDATE}}` variables too: a script-set `""` renders empty instead of re-prompting.
- For Capture choices, a non-empty editor selection will prefill `{{VALUE}}` during preflight when selection-as-value is enabled.

Note: For **required** date fields with a default, leaving the input blank will apply the default automatically at submit time. A **required** date field left blank without a usable default is re-asked by the sequential date prompt after submit. Optional date fields left blank stay empty.

### Cancel behavior
- Cancelling the one-page modal (Cancel button or Esc) cancels the whole run. QuickAdd does not fall back to the step-by-step prompts.
- If the form fails to open for another reason (for example, a requirement could not be collected), QuickAdd logs a warning and the choice runs with the standard step-by-step prompts instead.

### Internals and reserved variables
- QuickAdd uses reserved variable ids prefixed with `__qa.` for internal wiring during preflight/runtime.
- Example: `__qa.captureTargetFilePath` stores the capture target chosen in the one-page modal so the capture engine can skip its own file picker.
- These internal keys won’t collide with your own variables; avoid using the `__qa.` prefix in your scripts.

---

## User scripts: declare inputs (optional)

To have your user script’s inputs included in the one-page form during preflight, export a static `quickadd.inputs` spec alongside your default export. This is optional and non-executing.

Example (function default export):
```js
export default async function entry(params, settings) {
  // ... your script ...
}
export const quickadd = {
  inputs: [
    { id: "project", label: "Project", type: "text", defaultValue: "Inbox" },
    { id: "due", label: "Due date", type: "date", dateFormat: "YYYY-MM-DD" },
    { id: "confidence", label: "Confidence", type: "slider", defaultValue: "50", sliderConfig: { min: 0, max: 100, step: 5 } },
    { id: "status", label: "Status", type: "dropdown", options: ["Todo","Doing","Done"] }
  ]
};
```

Example (object default export):
```js
export default {
  async entry(params, settings) {
    // ... your script ...
  }
};
export const quickadd = {
  inputs: [ { id: "topic", type: "text" } ]
};
```

Supported input fields:
- `id` (string, required)
- `label` (string)
- `type` ("text" | "number" | "textarea" | "dropdown" | "date" | "field-suggest" | "suggester" | "slider")
- `placeholder` (string)
- `defaultValue` (string)
- `options` (string[] for dropdown and suggester)
- `numericConfig` (object for number: `{ min?: number, max?: number, step?: number }`)
- `sliderConfig` (object for slider: `{ min: number, max: number, step?: number }`; `min` and `max` are required, `step` defaults to `1`)
- `dateFormat` (string for date)
- `description` (string)
- `optional` (boolean — field may be left empty; shows an "(optional)" badge)
- `suggesterConfig` (object for suggester: `{ allowCustomInput?: boolean, caseSensitive?: boolean, multiSelect?: boolean }`)

**Field Type Details:**
- `text`: Single-line text input
- `number`: Numeric input, optionally bounded by `numericConfig`
- `textarea`: Multi-line text input
- `dropdown`: Fixed dropdown menu (no search, must select from list)
- `date`: Date input with natural language support
- `field-suggest`: Vault field suggestions (uses `{{FIELD:...}}` syntax)
- `slider`: Bounded numeric input with a slider and editable number field. Requires `sliderConfig.min` and `sliderConfig.max`; invalid configs fall back to `number`.
- `suggester`: **NEW** - Searchable autocomplete with custom options (allows typing custom values)
  - Supports multi-select mode via `suggesterConfig.multiSelect: true`
  - Multi-select: Select multiple items, separated by commas. Suggestions stay open after each selection.

## Scripts: request inputs at runtime (API)

From within a script, you can open a single one-page modal to collect multiple inputs in one go using the QuickAdd API.

```js
export default async function entry({ quickAddApi }) {
  const values = await quickAddApi.requestInputs([
    { id: "project", label: "Project", type: "text", defaultValue: "Inbox" },
    { id: "due", label: "Due", type: "date", dateFormat: "YYYY-MM-DD" },
    { id: "confidence", label: "Confidence", type: "slider", defaultValue: "50", sliderConfig: { min: 0, max: 100, step: 5 } },
    { id: "status", label: "Status", type: "dropdown", options: ["Todo","Doing","Done"] },
    { 
      id: "tags", 
      label: "Tags", 
      type: "suggester", 
      options: ["work", "personal", "urgent"],
      placeholder: "Type to search tags..."
    },
  ]);

  // Access collected values
  const { project, due, status, tags } = values;
}
```

**Example with Dynamic Options (from Dataview):**
```js
export default async function entry({ quickAddApi, app }) {
  // Get dynamic options from Dataview
  const dv = app.plugins.plugins.dataview?.api;
  const projectNames = dv?.pages()
    .where(p => p.type === "project")
    .map(p => p.file.name)
    .array() ?? ["Inbox"];

  const values = await quickAddApi.requestInputs([
    {
      id: "project",
      label: "Select Project",
      type: "suggester",
      options: projectNames,
      placeholder: "Start typing project name..."
    },
  ]);

  const { project } = values;
}
```

**Example with Multi-Select:**
```js
export default async function entry({ quickAddApi }) {
  const values = await quickAddApi.requestInputs([
    {
      id: "tags",
      label: "Select Tags",
      type: "suggester",
      options: ["#work", "#personal", "#project", "#urgent", "#review"],
      suggesterConfig: {
        multiSelect: true,
        caseSensitive: false
      },
      placeholder: "Type or select multiple tags..."
    },
  ]);

  // Result: values.tags = "#work, #project, #urgent"
  const { tags } = values;

  // Split into array if needed
  const tagArray = tags.split(', ').filter(Boolean);
}
```

Behavior:
- Values already present in variables are used and not re-asked.
- Only missing inputs are prompted in the one-page modal.
- Returned values are also stored into `variables` for later steps in the macro.

---

## Notes
- Macro support is best-effort: user scripts can declare inputs via `quickadd.inputs`.
- Preflight may import user script modules to statically read `quickadd.inputs`. This can execute module top-level code.
- Inline scripts aren’t scanned for input declarations yet.
- If needed, you can still prompt ad-hoc (e.g., using inputPrompt or suggester) and those values will skip future one-page prompts due to being prefilled.
- Closing the `requestInputs` modal without submitting rejects with `MacroAbortError("Input cancelled by user")`, which stops the macro unless you catch it.
