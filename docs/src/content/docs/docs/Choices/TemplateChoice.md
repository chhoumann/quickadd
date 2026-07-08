---
title: Template
description: Create notes from template files with dynamic paths, file name formats, destination folders, linking, and file-already-exists handling
slug: docs/Choices/TemplateChoice
---

The Template choice type creates notes from template files using QuickAdd's own [format syntax](/docs/FormatSyntax/) - prompts, dates, and variables included, with no other plugin required. If your templates come from the Templater plugin, see [Coming from Templater](/docs/ComingFromTemplater/) for the QuickAdd-native way to do each familiar job.

:::tip[Run a template without making a choice]
If you just want to spin up a note from a template in your [template folder](/docs/Settings/#templates--properties) without maintaining a Template choice per file, use the **New note from template** command. It lists the templates in your configured folder, prompts for the new note's name, and creates it in Obsidian's default location. When a template folder is configured, the same entry also appears in **Run QuickAdd** — at the bottom by default, or move it to the top / hide it under [Settings → Choice Picker](/docs/Settings/#choice-picker) — and it's scriptable via [`quickadd:run-template`](/docs/Advanced/CLI/#quickaddrun-template). Make a Template choice (below) when you need a fixed location, file-name format, linking, or a hotkey.
:::

**New note from template** uses a discovery-first title picker. As you type the
new note name, QuickAdd shows matching existing notes and unresolved wikilink
targets first. Choose an existing note to open it unchanged, or choose the
**Create new note** row to create the note from the selected template.

The Template choice builder groups its settings into four sections: **Template** (template path and file name format), **Location** (where the file is created), **Linking** (whether and how to link to the created file), and **Behavior** (what happens when the file already exists, and how the file is opened).

![The QuickAdd Template builder, showing the Template, Location, Linking, and Behavior sections](../Images/choices/template-builder.png)

## Mandatory
**Template Path**. This is a path to the template you wish to insert. Paths are vault-relative; a leading `/` is ignored.

The Template Path supports QuickAdd [format syntax](/docs/FormatSyntax/), so the path can be dynamic. For example, `Templates/{{VALUE:collectionName}} Template.md` prompts for a collection name and resolves to a path like `Templates/Games Template.md` when the choice runs. Named values (`{{VALUE:client}}`), dates (`{{DATE:YYYY}}`), fields, and global variables all work in the path. The same applies to the Capture choice's *Create file with template* path.

The path is resolved with a **path-safe** subset of the format syntax: macros, inline JavaScript, and `{{TEMPLATE:...}}` inclusion are **not** run while computing a path, and `{{title}}` cannot be used in a path (the title is derived from the created file, not the source template). Note-relative tokens — `{{FOLDER}}`, `{{FILENAMECURRENT}}`, `{{LINKCURRENT}}`, and `{{LINKSECTION}}` — are left as-is in a template path, since they describe the runtime note/folder context (the target folder, or the active note and the cursor's heading) rather than the source template (`{{FOLDER}}` is still available in file names and template bodies). The created file's extension comes from the *resolved* path, so a token that expands to `.canvas`/`.base` produces a canvas/base file.

:::note
A few things don't apply to a *dynamic* template path: the path can't be auto-bundled when exporting a QuickAdd package (it isn't a literal file), and if you use the [one-page input](/docs/Advanced/onePageInputs/) form, prompts inside the resolved template's body are gathered when the choice runs rather than in the up-front form.
:::

QuickAdd supports markdown (`.md`), canvas (`.canvas`), and base (`.base`) templates. The created file uses the same extension as the template.
If you want a new markdown note to include a live embedded Base dashboard, see
[Template: Create an MOC Note with a Link Dashboard](/docs/Examples/Template_CreateMOCNoteWithLinkDashboard/).

## Optional
**File Name Format**. You can specify a format for the file name, which is based on the [format syntax](/docs/FormatSyntax/).
Basically, this allows you to have dynamic file names. If you wrote `£ {{DATE}} {{NAME}}`, it would translate to a file name like `£ 2021-06-12 Manually-Written-File-Name`, where `Manually-Written-File-Name` is a value you enter when invoking the template.
If you disable **File Name Format**, QuickAdd uses `{{VALUE}}` as the file name format. This keeps the default behavior of prompting for a file name when you run the choice, with the same `{{VALUE}}` / `{{NAME}}` behavior described in the format syntax docs.

If a value used in the file name contains a line break or another control character, QuickAdd folds it to a space in the created path and strips trailing spaces or periods from that path segment. The original value is still available unchanged in the template body, so multi-line prompts can create readable note content without making the note hard to link.

**Search existing notes before creating**. For Template choices that use the
default note-title prompt, this opens the same discovery-first picker used by
**New note from template**. Matching notes and unresolved wikilink targets appear
while you type, so you can open an existing note instead of creating a duplicate.
Selecting an existing note opens it unchanged and does not apply the template,
append template content, insert links, or copy links. Selecting the explicit
**Create new note** row continues with normal Template creation.

**New note location**. A dropdown that controls where the note is created. Pick one of four modes:
- **Obsidian default** – use Obsidian's "Default location for new notes" setting.
- **In a specific folder** – create the note in the folder(s) you configure below. If you specify one folder, the note is created there; if you specify multiple, you'll get a suggester asking which folder to use. An **Include subfolders** toggle (shown only in this mode) lets the suggester offer the selected folders *and* their subfolders. Folder paths support QuickAdd [format syntax](/docs/FormatSyntax/), including `{{VALUE}}`, named values such as `{{VALUE:client}}`, dates, and global variables — for example, `Projects/{{VALUE:client}}/{{DATE:YYYY}}` prompts for a client and creates the file under that client's folder for the current year.
- **Same folder as current file** – create the note next to the currently active file (falls back to the vault root if no file is open).
- **Ask for folder each time** – prompt you to pick any folder in the vault each time the choice runs.

Switching modes hides the fields that don't apply, but your configured folder list is kept — switching back restores it.

**Link to created file**. Choose whether QuickAdd should insert a link to the created file. Pick one of three modes:
- **Enabled (strict)** – require the configured link destination to be available
- **Enabled (skip if unavailable)** – insert the link when possible and skip silently when a current-note destination has no focused Markdown editor
- **Disabled** – never append a link

When either enabled mode is selected, **Link destination** controls where the link is written:
- **Current note** – insert the link into the active Markdown editor
- **Specified note** – append the link to the bottom of an existing Markdown note, such as an index or MOC, without opening that note

For **Current note**, strict mode keeps the legacy behavior and requires a focused Markdown editor. For **Specified note**, QuickAdd validates the destination note before creating the new note.

For the **Current note** destination, **Link placement** lets you choose where the link is placed:
- **Replace selection** - Replaces any selected text with the link (default)
- **After selection** - Preserves selected text and places the link after it  
- **End of line** - Places the link at the end of the current line
- **New line** - Places the link on a new line below the cursor
- **In frontmatter property** - Adds the link to a named frontmatter property

When **In frontmatter property** is selected, set the property name and choose how strictly QuickAdd should handle missing or non-list properties:
- **Create or convert** (default) - Create the property if it is missing, or convert an existing scalar value into a list before appending the new link. Object values still throw an error.
- **Create if missing** - Create the property if it is missing. Existing scalar/object values still throw an error.
- **Require list** - Append only to an existing list property. Empty/null properties are treated as empty lists; missing properties and existing scalar/object values throw an error.

If the cursor is in an editable Obsidian Properties field when the Template
choice starts, and the placement is not **In frontmatter property**, QuickAdd
appends the link to that focused property instead of using the stale editor
cursor behind the Properties panel. Text properties receive the link at the end
of the value, and list properties receive a new list item.

**Link type**. Shown for any **Current note** body placement — **Replace selection**, **After selection**, **End of line**, and **New line**. Choose whether QuickAdd inserts a **Link** (`[[Note]]`) or an **Embed** (`![[Note]]`). An embed transcludes the linked note's contents at the placement position, so for example **New line** + **Embed** drops `![[Note]]` on its own line. The inline placements (**After selection**, **End of line**) insert the embed inline on the same line. The **In frontmatter property** placement and the **Specified note** destination stay link-only.

**Link display text**. Shown for the selection placements (**Replace selection**, **After selection**) with the **Link** type. Chooses what the inserted link displays. **Selected text** keeps the highlighted text as the link's display text: select `Meeting with Mark`, run a Template choice whose file name format is `20240101 {{selected}}`, and the selection becomes `[[20240101 Meeting with Mark|Meeting with Mark]]` instead of a bare `[[20240101 Meeting with Mark]]`. With nothing selected (or when the selection can't be represented safely inside a link), QuickAdd inserts the plain link instead. Multi-line selections are collapsed to a single line for the display text, and vaults using Markdown-style links get `[Meeting with Mark](20240101%20Meeting%20with%20Mark.md)`.

For the **Specified note** destination, choose an existing Markdown file. QuickAdd appends a normal link at the bottom of that file. It does not create the index file, insert under a heading, update properties, or remove duplicate links.

**Copy link to clipboard**. Copies a link to the created file after the Template
choice runs. This works separately from **Link to created file**, so you can copy
the link without inserting it into the current note, or do both. The copied link
is a vault-path wikilink, which makes it suitable for pasting into another note.

**If the target file already exists**. Choose whether QuickAdd should ask what to do, update the existing file, create another file, or keep the existing file.

**Open**. Will open the created file. When enabled, additional file-opening controls appear (these are shared with the Capture choice):
- **File Opening Location** – where to open the file: **Reuse current tab**, **New tab**, **Split pane**, **New window**, **Left sidebar**, or **Right sidebar**.
- **Split Direction** – shown only when the location is **Split pane**. Arrange the new pane as **Split right** or **Split down**.
- **View Mode** – how to display the opened file: **Source**, **Preview**, **Live Preview**, or **Default**.
- **Focus new pane** – shown for every location except **Reuse current tab**. Focus the opened tab immediately after opening.

## File Already Exists Behavior

When a file with the target name already exists, the setting works in two steps:

- **If the target file already exists**:
  choose one of these high-level behaviors:
  **Ask every time**, **Update existing file**, **Create another file**, or
  **Keep existing file**
- **Update action**:
  shown only when you choose **Update existing file**
- **New file naming**:
  shown only when you choose **Create another file**

### Ask Every Time

QuickAdd prompts you to choose one of these actions each time the target path
already exists:

- **Append to bottom**
- **Append to top**
- **Overwrite file**
- **Increment trailing number**
- **Append duplicate suffix**
- **Do nothing**

### Update Existing File

These options modify the existing markdown, canvas, or base file:

- **Append to bottom**: Adds the template content to the end of the existing file
- **Append to top**: Adds the template content to the beginning of the existing file
- **Overwrite file**: Replaces the existing file content with the template

For markdown files, **Append to bottom** and **Append to top** handle template
frontmatter the same way as [Apply Template to Note](/docs/ApplyTemplateToNote/):
the template's frontmatter properties are merged into the existing note instead
of inserting a second `---` block. Existing note values win, and missing or
empty properties are filled from the template. Canvas and base files receive the
template content as-is.

### Create Another File

These options keep the existing file untouched and create a new file instead:

- **Increment trailing number**: Changes trailing digits only while preserving zero padding when present. For example, `note009.md` becomes `note010.md`.
- **Append duplicate suffix**: Keeps the full base name and adds ` (1)`, ` (2)`, and so on. For example, `note.md` becomes `note (1).md`.

### Keep Existing File

Selecting **Keep existing file** applies the same result as choosing
**Do nothing** from the prompt:

- **Do nothing**: Leaves the existing file unchanged and opens it
  automatically. This does not require the separate **Open** setting.
