---
title: Apply Template to Note
---

Created a note manually — with `Cmd/Ctrl+N`, the Quick Switcher, or by clicking a link to a file that didn't exist yet — and then realized you forgot to use your template? You no longer need to delete the note and recreate it.

The **QuickAdd: Apply template to active note** command applies a template to the note you already have open.

You can also right-click a markdown file (in the file explorer, tab header, etc.) and pick **Apply QuickAdd template** to target that file directly.

## How it works

1. Run the command while a markdown note is active.
2. **Pick what to apply.** The picker lists your [Template choices](./Choices/TemplateChoice.md) first (including ones nested in Multi choices), followed by template files from your configured templates folder that aren't already covered by a choice.
3. **Pick how to apply it** (skipped for empty notes — see below):
   - **Insert at cursor**: inserts the template at the cursor position. Only offered when the note is open in the active editor.
   - **Insert at top**: inserts the template below the note's frontmatter, or at the very top if there is none.
   - **Append to bottom**: adds the template content to the end of the note.
   - **Replace note content**: replaces the entire note content with the template.

The template runs through the full QuickAdd [format syntax](./FormatSyntax.md) pipeline, and Templater syntax is processed as usual.

Only markdown templates can be applied: canvas (`.canvas`) and base (`.base`) templates contain data for their own file types and are excluded from the picker (use a regular [Template choice](./Choices/TemplateChoice.md) to create those). Likewise, the target must be a markdown note.

## Smart behaviors

**Empty-note fast path.** If the note is empty (or contains only whitespace), the "how to apply" prompt is skipped and the template is applied as the note's full content — the most common case is a freshly created blank note.

**Title pre-fill.** The note already has a name, so `{{title}}` and the unnamed `{{VALUE}}`/`{{NAME}}` resolve to the note's basename instead of prompting. Named values like `{{VALUE:project}}` still prompt as usual.

**Frontmatter merge.** For the **Insert at top**, **Append to bottom**, and **Insert at cursor** modes, the template's frontmatter is not inserted as a second `---` block. Instead, its properties are merged into the note's existing frontmatter — and existing values in your note always win. Properties that are missing or empty in the note are filled from the template. (**Replace note content** replaces the whole note, frontmatter included.)

**Move/rename to match the choice.** If you picked a Template choice that has a folder and/or file name format configured, and the note's current location or name doesn't match what the choice would have produced, QuickAdd offers to move/rename the note to match. Links to the note are updated automatically. This is skipped when the choice's folder settings require a runtime folder picker, or when a file already exists at the target path.

## From scripts and macros

The [QuickAdd API](./QuickAddAPI.md) exposes the same functionality without any prompts:

```js
await quickAddApi.applyTemplateToActiveFile("templates/meeting.md", {
  mode: "top", // "cursor" | "top" | "bottom" | "replace"
});
```

When `mode` is omitted, empty notes get `replace` and non-empty notes get `bottom`.
