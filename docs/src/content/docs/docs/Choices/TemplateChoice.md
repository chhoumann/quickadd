---
title: Template
description: "Create a new note from a template file: dynamic paths and file names, a destination folder, linking, and what to do when the note already exists"
slug: docs/Choices/TemplateChoice
---

A Template choice creates a **new note from a template file**. Press a hotkey,
answer any prompts, and QuickAdd builds the note - filling in dates, your
answers, and links as it goes. Use it to spin up a book note, a meeting note, or
a project page from a layout you keep once and reuse everywhere.

Templates use QuickAdd's own [format syntax](/docs/FormatSyntax/) - prompts,
dates, and variables included - so no other plugin is required. If your
templates come from the Templater plugin, see
[Coming from Templater](/docs/ComingFromTemplater/) for the QuickAdd-native way
to do each familiar job.

![The QuickAdd Template builder, showing the Template, Location, Linking, and Behavior sections](../Images/choices/template-builder.png)

## Set up your first template choice {#set-up}

1. Create a template note, for example `Templates/Book.md`:

   ```markdown title="Templates/Book.md"
   ---
   author:
   status: reading
   ---
   # {{VALUE:title}}

   Started {{DATE}}
   ```

2. Open **Settings → QuickAdd**, type a name like `New book note`, choose
   **Template** in the dropdown, and click **Add Choice**.
3. Click the gear (⚙) next to the new choice.
4. Set **Template Path** to `Templates/Book.md`.
5. Under **New note location**, choose **In a specific folder** and enter
   `Books`.
6. Run it: command palette → `QuickAdd: Run`, pick `New book note`,
   type the title, for example `Dune`.

QuickAdd creates `Books/Dune.md` from your template, with the title, date, and
frontmatter filled in. Assign the choice a hotkey (⚡ icon, or Obsidian's
Hotkeys settings) once it behaves the way you want.

## Run a template without making a choice {#run-without-choice}

If you just want to spin up a note from a template in your
[template folder](/docs/Settings/#templates--properties) without maintaining a
Template choice per file, use the **New note from template** command. It lists
the templates in your configured folder, prompts for the new note's name, and
creates it in Obsidian's default location.

**New note from template** uses a discovery-first title picker: as you type the
new note name, QuickAdd shows matching existing notes and unresolved wikilink
targets first. Choose an existing note to open it unchanged, or choose the
**Create new note** row to create the note from the selected template.

:::tip[Where the command shows up]
When a template folder is configured, the same entry also appears in **Run
QuickAdd** - at the bottom by default, or move it to the top / hide it under
[Settings → Choice Picker](/docs/Settings/#choice-picker) - and it's scriptable
via [`quickadd:run-template`](/docs/Advanced/CLI/#quickaddrun-template). Make a
Template choice (below) when you need a fixed location, file-name format,
linking, or a hotkey.
:::

The builder groups a Template choice's settings into four sections:
**Template** (template path and file name format), **Location** (where the file
is created), **Linking** (whether and how to link to the created file), and
**Behavior** (what happens when the file already exists, and how the file is
opened).

## Point to the template file: Template Path {#mandatory}

**Template Path** is the one required setting: the path to the template you want
to insert. Paths are vault-relative; a leading `/` is ignored.

```text title="Template Path"
Templates/Book.md
```

QuickAdd supports markdown (`.md`), canvas (`.canvas`), and base (`.base`)
templates. The created file uses the same extension as the template. If you want
a new markdown note to include a live embedded Base dashboard, see
[Template: Create an MOC Note with a Link Dashboard](/docs/Examples/Template_CreateMOCNoteWithLinkDashboard/).

### Use a dynamic template path {#dynamic-template-path}

The Template Path supports [format syntax](/docs/FormatSyntax/), so the path can
change from run to run. Named values (`{{VALUE:client}}`), dates
(`{{DATE:YYYY}}`), fields, and global variables all work in the path. The same
applies to the Capture choice's *Create file with template* path.

```text title="You configure"
Templates/{{VALUE:collectionName}} Template.md
```

Running the choice prompts for a collection name and resolves to a path like
`Templates/Games Template.md`. The created file's extension comes from the
*resolved* path, so a placeholder that expands to `.canvas` or `.base` produces a
canvas or base file.

A path is resolved with a **path-safe** subset of the format syntax:

- Macros, inline JavaScript, and `{{TEMPLATE:...}}` inclusion are **not** run
  while computing a path.
- `{{title}}` cannot be used in a path (the title is derived from the created
  file, not the source template).
- The note-relative placeholders `{{FOLDER}}`, `{{FILENAMECURRENT}}`,
  `{{LINKCURRENT}}`, and `{{LINKSECTION}}` are left as-is in a template path,
  since they describe the runtime note/folder context (the target folder, or the
  active note and the cursor's heading) rather than the source template.
  `{{FOLDER}}` is still available in file names and template bodies.

:::note
A couple of things don't apply to a *dynamic* template path: the path can't be
auto-bundled when exporting a QuickAdd package (it isn't a literal file), and if
you use the [one-page input](/docs/Advanced/onePageInputs/) form, prompts inside
the resolved template's body are gathered when the choice runs rather than in the
up-front form.
:::

## Name the new note: File Name Format {#optional}

**File Name Format** sets a format for the created file's name, using
[format syntax](/docs/FormatSyntax/) - so file names can be dynamic too.

```text title="You configure"
£ {{DATE}} {{NAME}}
```

```text title="You get (with a typed name of Manually-Written-File-Name)"
£ 2021-06-12 Manually-Written-File-Name
```

`{{NAME}}` is a value you enter when invoking the template. If you **disable**
File Name Format, QuickAdd uses `{{VALUE}}` as the file name format, which keeps
the default behavior of prompting for a file name when you run the choice (with
the same `{{VALUE}}` / `{{NAME}}` behavior described in the format syntax docs).

:::note
If a value used in the file name contains a line break or another control
character, QuickAdd folds it to a space in the created path and strips trailing
spaces or periods from that path segment. The original value is still available
unchanged in the template body, so multi-line prompts can create readable note
content without making the note hard to link.
:::

### Search for an existing note first {#search-existing}

**Search existing notes before creating** applies to Template choices that use
the default note-title prompt. It opens the same discovery-first picker used by
**New note from template**: matching notes and unresolved wikilink targets appear
while you type, so you can open an existing note instead of creating a duplicate.

Selecting an existing note opens it unchanged and does **not** apply the
template, append template content, insert links, or copy links. Selecting the
explicit **Create new note** row continues with normal Template creation.

## Decide where the note is created: New note location {#new-note-location}

**New note location** is a dropdown that controls where the note is created.
Pick one of four modes:

- **Obsidian default** - use Obsidian's "Default location for new notes" setting.
- **In a specific folder** - create the note in the folder(s) you configure
  below. One folder creates the note there; several folders open a suggester
  asking which to use. An **Include subfolders** toggle (shown only in this
  mode) lets the suggester offer the selected folders *and* their subfolders.
- **Same folder as current file** - create the note next to the currently active
  file (falls back to the vault root if no file is open).
- **Ask for folder each time** - prompt you to pick any folder in the vault each
  time the choice runs.

Switching modes hides the fields that don't apply, but your configured folder
list is kept - switching back restores it.

Folder paths support [format syntax](/docs/FormatSyntax/), including `{{VALUE}}`,
named values such as `{{VALUE:client}}`, dates, and global variables:

```text title="In a specific folder"
Projects/{{VALUE:client}}/{{DATE:YYYY}}
```

This prompts for a client and creates the file under that client's folder for
the current year.

## Link to the new note: Link to created file {#link-to-created-file}

**Link to created file** controls whether QuickAdd inserts a link to the note it
just created - handy for leaving a trail in the note you were in. Three modes:

- **Enabled (strict)** - require the configured link destination to be available
- **Enabled (skip if unavailable)** - insert the link when possible and skip
  silently when a current-note destination has no focused Markdown editor
- **Disabled** - never append a link

With either enabled mode, **Link destination** controls where the link is
written:

- **Current note** - insert the link into the active Markdown editor
- **Specified note** - append the link to the bottom of an existing Markdown
  note, such as an index or MOC, without opening that note

For **Current note**, strict mode keeps the legacy behavior and requires a
focused Markdown editor. For **Specified note**, QuickAdd validates the
destination note before creating the new note. It appends a normal link at the
bottom of that file; it does not create the index file, insert under a heading,
update properties, or remove duplicate links.

### Where the link is placed {#link-placement}

For the **Current note** destination, **Link placement** chooses the spot:

- **Replace selection** - replaces any selected text with the link (default)
- **After selection** - preserves the selected text and places the link after it
- **End of line** - places the link at the end of the current line
- **New line** - places the link on a new line below the cursor
- **In frontmatter property** - adds the link to a named frontmatter property

When **In frontmatter property** is selected, set the property name and choose
how strictly QuickAdd should handle missing or non-list properties:

- **Create or convert** (default) - create the property if it is missing, or
  convert an existing scalar value into a list before appending the new link.
  Object values still throw an error.
- **Create if missing** - create the property if it is missing. Existing
  scalar/object values still throw an error.
- **Require list** - append only to an existing list property. Empty/null
  properties are treated as empty lists; missing properties and existing
  scalar/object values throw an error.

:::note
If the cursor is in an editable Obsidian Properties field when the Template
choice starts, and the placement is not **In frontmatter property**, QuickAdd
appends the link to that focused property instead of using the stale editor
cursor behind the Properties panel. Text properties receive the link at the end
of the value, and list properties receive a new list item.
:::

### Link or embed {#link-type}

**Link type** is shown for any **Current note** body placement (**Replace
selection**, **After selection**, **End of line**, and **New line**). Choose
whether QuickAdd inserts a **Link** (`[[Note]]`) or an **Embed** (`![[Note]]`).
An embed transcludes the linked note's contents at the placement position, so
for example **New line** + **Embed** drops `![[Note]]` on its own line. The
inline placements (**After selection**, **End of line**) insert the embed inline
on the same line. The **In frontmatter property** placement and the **Specified
note** destination stay link-only.

### What the link says {#link-display-text}

**Link display text** is shown for the selection placements (**Replace
selection**, **After selection**) with the **Link** type. It chooses what the
inserted link displays. **Selected text** keeps your highlight as the link's
display text:

```text title="You do"
Select "Meeting with Mark", run a Template choice whose file name format is
20240101 {{selected}}
```

```text title="You get"
[[20240101 Meeting with Mark|Meeting with Mark]]
```

With nothing selected (or when the selection can't be represented safely inside
a link), QuickAdd inserts the plain link instead. Multi-line selections are
collapsed to a single line for the display text, and vaults using Markdown-style
links get `[Meeting with Mark](20240101%20Meeting%20with%20Mark.md)`.

### Copy a link to the clipboard {#copy-link-to-clipboard}

**Copy link to clipboard** copies a link to the created file after the Template
choice runs. This works separately from **Link to created file**, so you can copy
the link without inserting it into the current note, or do both. The copied link
is a vault-path wikilink, ready to paste into another note.

## Open the note after creating: Open {#open-created-file}

**Open** opens the created file. When enabled, additional file-opening controls
appear (these are shared with the Capture choice):

- **File Opening Location** - where to open the file: **Reuse current tab**,
  **New tab**, **Split pane**, **New window**, **Left sidebar**, or **Right
  sidebar**.
- **Split Direction** - shown only when the location is **Split pane**. Arrange
  the new pane as **Split right** or **Split down**.
- **View Mode** - how to display the opened file: **Source**, **Preview**,
  **Live Preview**, or **Default**.
- **Focus new pane** - shown for every location except **Reuse current tab**.
  Focus the opened tab immediately after opening.

## When the note already exists {#file-already-exists-behavior}

**If the target file already exists** decides what QuickAdd does when a note with
the target name is already there. The setting works in two steps: first pick a
high-level behavior, then a follow-up field appears for the two behaviors that
need a detail.

- **If the target file already exists** - choose **Ask every time**, **Update
  existing file**, **Create another file**, or **Keep existing file**.
- **Update action** - shown only when you choose **Update existing file**.
- **New file naming** - shown only when you choose **Create another file**.

### Let QuickAdd ask each time {#ask-every-time}

QuickAdd prompts you to choose one of these actions each time the target path
already exists:

- **Append to bottom**
- **Append to top**
- **Overwrite file**
- **Increment trailing number**
- **Append duplicate suffix**
- **Do nothing**

### Update the existing note {#update-existing-file}

These options modify the existing markdown, canvas, or base file:

- **Append to bottom** - adds the template content to the end of the existing
  file.
- **Append to top** - adds the template content to the beginning of the existing
  file.
- **Overwrite file** - replaces the existing file content with the template.

:::note
For markdown files, **Append to bottom** and **Append to top** handle template
frontmatter the same way as
[Apply Template to Note](/docs/ApplyTemplateToNote/): the template's frontmatter
properties are merged into the existing note instead of inserting a second `---`
block. Existing note values win, and missing or empty properties are filled from
the template. Canvas and base files receive the template content as-is.
:::

### Create a new note instead {#create-another-file}

These options keep the existing file untouched and create a new file instead:

- **Increment trailing number** - changes trailing digits only while preserving
  zero padding when present. For example, `note009.md` becomes `note010.md`.
- **Append duplicate suffix** - keeps the full base name and adds ` (1)`, ` (2)`,
  and so on. For example, `note.md` becomes `note (1).md`.

### Keep the existing note {#keep-existing-file}

Selecting **Keep existing file** applies the same result as choosing **Do
nothing** from the prompt:

- **Do nothing** - leaves the existing file unchanged and opens it
  automatically. This does not require the separate **Open** setting.
