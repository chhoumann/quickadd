---
sidebar_position: 50
title: One-page Inputs
description: Collect all QuickAdd inputs in a single dynamic form (Beta)
---

# One-page Inputs

QuickAdd can collect all inputs in a single, dynamic form before running your choice.
This feature is currently in Beta.

## Enable
- Settings → QuickAdd → toggle “One-page input for choices”.
- Works with Template and Capture choices. Macros get partial support (see User Scripts below).
 - Note: Beta – please report issues and edge cases.

## What gets collected
- Format variables in filenames, templates, and capture content:
  - `{{VALUE}}`, `{{VALUE:name}}`, `{{VDATE:name, YYYY-MM-DD}}`, `{{FIELD:name|...}}`
  - Nested `{{TEMPLATE:path}}` are scanned recursively.
- Capture target file when capturing to a folder or tag.
- Script-declared inputs (from user scripts inside macros), if provided.

## Date UX
- Date fields support natural language (e.g., “today”, “next friday”).
- The modal shows a formatted preview and stores a normalized `@date:ISO` internally.

## FIELD UX
- FIELD inputs get inline suggestions from your vault (Dataview if available, with a manual fallback).

## Skipping the modal
- If all required inputs already have values (e.g., prefilled by an earlier macro step), the modal will not open.
- Empty string is considered an intentional value and will not prompt again.

Note: For date fields with a default, leaving the input blank will apply the default automatically at submit time.

### Cancel behavior
- If you press Cancel in the one-page modal, the preflight is aborted and the choice proceeds with the standard step-by-step prompts at runtime.

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
- `type` ("text" | "textarea" | "dropdown" | "date" | "field-suggest" | "suggester")
- `placeholder` (string)
- `defaultValue` (string)
- `options` (string[] for dropdown and suggester)
- `dateFormat` (string for date)
- `description` (string)
- `suggesterConfig` (object for suggester: `{ allowCustomInput?: boolean, caseSensitive?: boolean, multiSelect?: boolean }`)

**Field Type Details:**
- `text`: Single-line text input
- `textarea`: Multi-line text input
- `dropdown`: Fixed dropdown menu (no search, must select from list)
- `date`: Date input with natural language support
- `field-suggest`: Vault field suggestions (uses `{{FIELD:...}}` syntax)
- `suggester`: **NEW** - Searchable autocomplete with custom options (allows typing custom values)
  - Supports multi-select mode via `suggesterConfig.multiSelect: true`
  - Multi-select: Select multiple items, separated by commas. Suggestions stay open after each selection.

In the modal these inputs are labeled “(from script)”.

---

## Scripts: request inputs at runtime (API)

From within a script, you can open a single one-page modal to collect multiple inputs in one go using the QuickAdd API.

```js
export default async function entry({ quickAddApi }) {
  const values = await quickAddApi.requestInputs([
    { id: "project", label: "Project", type: "text", defaultValue: "Inbox" },
    { id: "due", label: "Due", type: "date", dateFormat: "YYYY-MM-DD" },
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
