---
title: Apply Template to Note
description: Apply a template to an existing note with insert, append, or replace modes, merging frontmatter and optionally moving the note to match
slug: docs/ApplyTemplateToNote
---

Created a note manually - with `Cmd/Ctrl+N`, the Quick Switcher, or by clicking
a link to a file that didn't exist yet - and only then realized you forgot to
use your template? You don't need to delete the note and start over. QuickAdd
can apply a template to a note you already have.

There are two ways in:

- Run **QuickAdd: Apply template to active note** from the command palette to apply a template to the note currently open.
- Right-click a Markdown file (in the file explorer, a tab header, and so on) and pick **Apply QuickAdd template** to target that file directly.

Either way, you pick a template, choose how it should be added, and QuickAdd
fills in the placeholders and merges the frontmatter for you.

## How it works {#how-it-works}

1. Run the command while a Markdown note is active.
2. **Pick what to apply.** The picker lists your
   [Template choices](/docs/Choices/TemplateChoice/) first (including ones
   nested in Multi choices), followed by template files from your configured
   templates folder that aren't already covered by a choice.
3. **Pick how to apply it** (skipped for empty notes - see
   [Smart behaviors](#smart-behaviors)):
   - **Insert at cursor**: inserts the template at the cursor. Only offered when the note is open in the active editor.
   - **Insert at top**: inserts the template below the note's frontmatter, or at the very top if there is none.
   - **Append to bottom**: adds the template content to the end of the note.
   - **Replace note content**: replaces the entire note with the template.

The template runs through the full QuickAdd
[format syntax](/docs/FormatSyntax/) pipeline, and Templater syntax is processed
as usual.

:::note
Only Markdown templates can be applied. Canvas (`.canvas`) and Base (`.base`)
templates hold data for their own file types, so they're left out of the picker
- use a regular [Template choice](/docs/Choices/TemplateChoice/) to create
those. The target note must be Markdown too.
:::

## Smart behaviors {#smart-behaviors}

QuickAdd handles a few common situations for you so you don't have to think
about them:

- **Empty notes skip the prompt.** If the note is empty (or only whitespace), the "how to apply" step is skipped and the template becomes the note's full content. The usual case is a freshly created blank note.
- **The title fills itself in.** The note already has a name, so `{{title}}` and the unnamed `{{VALUE}}` / `{{NAME}}` resolve to the note's file name instead of prompting. Named values like `{{VALUE:project}}` still prompt as usual.
- **Frontmatter merges instead of stacking.** For **Insert at top**, **Append to bottom**, and **Insert at cursor**, the template's frontmatter is not added as a second `---` block. Its properties are merged into the note's existing frontmatter, and your note's existing values always win - only properties that are missing or empty in the note are filled from the template. (**Replace note content** replaces the whole note, frontmatter included.)
- **The note can move to match the choice.** If you picked a Template choice with a folder and/or file name format, and the note's current location or name doesn't match what that choice would have produced, QuickAdd offers to move or rename the note to match. Links to the note are updated automatically. This is skipped when the choice's folder settings need a runtime folder picker, or when a file already exists at the target path.

## From scripts and macros {#from-scripts-and-macros}

The [QuickAdd API](/docs/QuickAddAPI/) does the same thing without any prompts:

```js
await quickAddApi.applyTemplateToActiveFile("templates/meeting.md", {
  mode: "top", // "cursor" | "top" | "bottom" | "replace"
});
```

When `mode` is omitted, empty notes get `replace` and non-empty notes get
`bottom`.
