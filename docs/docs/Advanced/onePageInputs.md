---
sidebar_position: 50
---

## One-page inputs for QuickAdd

QuickAdd can collect all inputs in a single, dynamic form before running your choice.

### Enable
- Settings → QuickAdd → toggle “One-page input for choices”.
- Works with Template and Capture choices. Macros get partial support (see User Scripts below).

### What gets collected
- Format variables in filenames, templates, and capture content:
  - `{{VALUE}}`, `{{VALUE:name}}`, `{{VDATE:name, YYYY-MM-DD}}`, `{{FIELD:name|...}}`
  - Nested `{{TEMPLATE:path}}` are scanned recursively.
- Capture target file when capturing to a folder or tag.
- Script-declared inputs (from user scripts inside macros), if provided.

### Date UX
- Date fields support natural language (e.g., “today”, “next friday”).
- The modal shows a formatted preview and stores a normalized `@date:ISO` internally.

### FIELD UX
- FIELD inputs get inline suggestions from your vault (Dataview if available, with a manual fallback).

### Skipping the modal
- If all required inputs already have values (e.g., prefilled by an earlier macro step), the modal will not open.
- Empty string is considered an intentional value and will not prompt again.

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
- `type` ("text" | "textarea" | "dropdown" | "date" | "field-suggest")
- `placeholder` (string)
- `defaultValue` (string)
- `options` (string[] for dropdown)
- `dateFormat` (string for date)
- `description` (string)

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
  ]);

  // Access collected values
  const { project, due, status } = values;
}
```

Behavior:
- Values already present in variables are used and not re-asked.
- Only missing inputs are prompted in the one-page modal.
- Returned values are also stored into `variables` for later steps in the macro.

---

## Notes
- Macro support is best-effort: user scripts can declare inputs via `quickadd.inputs`.
- Inline scripts aren’t scanned for input declarations yet.
- If needed, you can still prompt ad-hoc (e.g., using inputPrompt or suggester) and those values will skip future one-page prompts due to being prefilled.
