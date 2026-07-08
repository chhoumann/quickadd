---
title: One-page Inputs
description: "Collect every input a choice needs in a single form, filled once, instead of one prompt at a time"
slug: docs/Advanced/onePageInputs
---

Normally QuickAdd asks for inputs one prompt at a time. Turn on one-page inputs
and it gathers everything a choice needs into a single form you fill once, then
runs. This is nicer when a choice asks for several things at once - a title, a
date, and a status, say - and you would rather see them all together than click
through them one by one.

For a task-oriented overview of prompts in general, see
[Controlling Prompts](/docs/ControllingPrompts/).

## Turn it on {#enable}

Go to **Settings → QuickAdd** and toggle **One-page input for choices**.

It works with Template, Capture, and Macro choices. For Macros, only the inputs
a script declares are collected (see [User scripts](#user-scripts-declare-inputs-optional)
below).

## Turn it on or off for one choice {#per-choice-override}

Template and Capture choice builders have a **One-page input override**
dropdown that overrides the global setting for that one choice:

- **Follow global setting** - use whatever the global toggle is set to (default).
- **Always** - force the one-page form for this choice even when it is off globally.
- **Never** - use step-by-step prompts for this choice even when it is on globally.

## What ends up in the form {#what-gets-collected}

QuickAdd scans the choice for placeholders and turns each one into a field:

- Placeholders in file names, templates, and capture content: `{{VALUE}}`, `{{VALUE:name}}`, `{{VDATE:name, YYYY-MM-DD}}`, `{{FIELD:name|...}}`.
- Nested `{{TEMPLATE:path}}` includes are scanned recursively, so their prompts show up too.
- `{{VALUE|type:multiline}}` and `{{VALUE:name|type:multiline}}` become textareas.
- `{{VALUE:name|type:number|min:1|max:10}}` becomes a bounded numeric input, and `{{VALUE:name|type:slider|min:0|max:100|step:5}}` becomes a slider plus numeric input.
- The capture target file, when you are capturing to a folder or a tag.
- Inputs declared by a user script inside a macro, if the script provides them.

### How dates behave in the form {#date-ux}

- Date fields accept natural language, like `today` or `next friday`.
- Short aliases work and are configurable in settings: `t` (today), `tm` (tomorrow), `yd` (yesterday).
- The field shows a formatted preview and stores a normalized `@date:ISO` value internally.

### How FIELD inputs behave {#field-ux}

- `{{FIELD:...}}` inputs suggest values from your vault (using Dataview when it is available, with a manual fallback otherwise).
- `{{FIELD:...|multi}}` is not shown inline in the form, because vault field values can contain commas. QuickAdd collects the rest of the form first, then opens the regular multi-select for that field.

## Fields you can leave empty {#optional-fields}

A field marked with the [`|optional` flag](/docs/FormatSyntax/#optional-fields)
shows an **(optional)** badge and may be left blank. Leaving it blank stores an
intentional empty value, so the step-by-step prompt will not ask for it again
later.

Good to know:

- A field counts as optional only when **every** occurrence of that variable across the scanned formats is flagged.
- Optional dropdowns get a **Skip (leave empty)** entry; the first real option stays preselected.
- An optional date field left blank resolves to empty. If what you typed cannot be read as a date, the field is handed to the regular step-by-step date prompt after you submit, instead of silently becoming empty.

## When the form is skipped {#skipping-the-modal}

The form only opens when it has something to ask:

- If every required input already has a value (for example, prefilled by an earlier macro step), the form does not open.
- An empty string counts as an intentional value and will not prompt again. This applies to `{{VDATE}}` too: a script-set `""` renders empty instead of re-prompting.
- For Capture choices, a non-empty editor selection prefills `{{VALUE}}` during preflight when selection-as-value is enabled.

:::note[Required date fields]
A **required** date field with a default applies the default automatically when
you leave it blank. A **required** date field left blank with no usable default
is re-asked by the step-by-step date prompt after you submit. Optional date
fields left blank stay empty.
:::

### What Cancel does {#cancel-behavior}

- Cancelling the form (Cancel button or Esc) cancels the whole run. QuickAdd does not fall back to the step-by-step prompts.
- If the form fails to open for some other reason (for example, a requirement could not be collected), QuickAdd logs a warning and runs the choice with the standard step-by-step prompts instead.

### Reserved internal variables {#internals-and-reserved-variables}

QuickAdd uses reserved variable ids prefixed with `__qa.` for internal wiring
during preflight and runtime. For example, `__qa.captureTargetFilePath` stores
the capture target chosen in the form so the capture engine can skip its own
file picker.

These internal keys will not collide with your own variables. Avoid using the
`__qa.` prefix in your scripts.

---

## User scripts: declare inputs (optional) {#user-scripts-declare-inputs-optional}

To have a user script's inputs appear in the one-page form during preflight,
export a static `quickadd.inputs` spec alongside your default export. This is
optional and non-executing.

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
- `optional` (boolean - field may be left empty; shows an "(optional)" badge)
- `suggesterConfig` (object for suggester: `{ allowCustomInput?: boolean, caseSensitive?: boolean, multiSelect?: boolean }`)

Field type details:

- `text`: single-line text input
- `number`: numeric input, optionally bounded by `numericConfig`
- `textarea`: multi-line text input
- `dropdown`: fixed dropdown menu (no search, must select from list)
- `date`: date input with natural language support
- `field-suggest`: vault field suggestions (uses `{{FIELD:...}}` syntax)
- `slider`: bounded numeric input with a slider and editable number field. Requires `sliderConfig.min` and `sliderConfig.max`; invalid configs fall back to `number`.
- `suggester`: searchable autocomplete with custom options (allows typing custom values)
  - Supports multi-select mode via `suggesterConfig.multiSelect: true`
  - Multi-select: select multiple items, separated by commas. Suggestions stay open after each selection.

## Scripts: request inputs at runtime (API) {#scripts-request-inputs-at-runtime-api}

From within a script, you can open one form that collects several inputs at
once using the QuickAdd API.

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

Example with dynamic options (from Dataview):

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

Example with multi-select:

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
- Only missing inputs are prompted in the form.
- Returned values are also stored into `variables` for later steps in the macro.

---

## Good to know {#notes}

- Macro support is best-effort: user scripts can declare inputs via `quickadd.inputs`.
- Preflight may import user script modules to statically read `quickadd.inputs`. This can execute module top-level code.
- Inline scripts aren't scanned for input declarations yet.
- You can still prompt ad-hoc (for example with `inputPrompt` or a suggester); those values are treated as prefilled and skip future one-page prompts.
- Closing the `requestInputs` form without submitting rejects with `MacroAbortError("Input cancelled by user")`, which stops the macro unless you catch it.
