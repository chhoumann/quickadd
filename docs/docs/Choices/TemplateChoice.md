---
title: Template
---

The template choice type is not meant to be a replacement for [Templater](https://github.com/SilentVoid13/Templater/) plugin or core `Templates`. It's meant to augment them, to add more possibilities. You can use both QuickAdd format syntax in a Templater template - and both will work.

The Template choice builder groups its settings into four sections: **Template** (template path and file name format), **Location** (where the file is created), **Linking** (whether and how to link to the created file), and **Behavior** (what happens when the file already exists, and how the file is opened).

![The QuickAdd Template builder, showing the Template, Location, Linking, and Behavior sections](/img/choices/template-builder.png)

## Mandatory
**Template Path**. This is a path to the template you wish to insert. Paths are vault-relative; a leading `/` is ignored.

QuickAdd supports markdown (`.md`), canvas (`.canvas`), and base (`.base`) templates. The created file uses the same extension as the template.
If you want a new markdown note to include a live embedded Base dashboard, see
[Template: Create an MOC Note with a Link Dashboard](/Examples/Template_CreateMOCNoteWithLinkDashboard.md).

## Optional
**File Name Format**. You can specify a format for the file name, which is based on the [format syntax](/FormatSyntax.md).
Basically, this allows you to have dynamic file names. If you wrote `£ {{DATE}} {{NAME}}`, it would translate to a file name like `£ 2021-06-12 Manually-Written-File-Name`, where `Manually-Written-File-Name` is a value you enter when invoking the template.
If you disable **File Name Format**, QuickAdd uses `{{VALUE}}` as the file name format. This keeps the default behavior of prompting for a file name when you run the choice, with the same `{{VALUE}}` / `{{NAME}}` behavior described in the format syntax docs.

**New note location**. A dropdown that controls where the note is created. Pick one of four modes:
- **Obsidian default** – use Obsidian's "Default location for new notes" setting.
- **In a specific folder** – create the note in the folder(s) you configure below. If you specify one folder, the note is created there; if you specify multiple, you'll get a suggester asking which folder to use. An **Include subfolders** toggle (shown only in this mode) lets the suggester offer the selected folders *and* their subfolders. Folder paths support QuickAdd [format syntax](/FormatSyntax.md), including `{{VALUE}}`, named values such as `{{VALUE:client}}`, dates, and global variables — for example, `Projects/{{VALUE:client}}/{{DATE:YYYY}}` prompts for a client and creates the file under that client's folder for the current year.
- **Same folder as current file** – create the note next to the currently active file (falls back to the vault root if no file is open).
- **Ask for folder each time** – prompt you to pick any folder in the vault each time the choice runs.

Switching modes hides the fields that don't apply, but your configured folder list is kept — switching back restores it.

**Link to created file**. Choose how QuickAdd should insert a link to the created file in the current note. Pick one of three modes:
- **Enabled (requires active file)** – throw an error if no note is focused (legacy behavior)
- **Enabled (skip if no active file)** – insert the link when possible and skip silently otherwise
- **Disabled** – never append a link

When either enabled mode is selected, **Link placement** lets you choose where the link is placed:
- **Replace selection** - Replaces any selected text with the link (default)
- **After selection** - Preserves selected text and places the link after it  
- **End of line** - Places the link at the end of the current line
- **New line** - Places the link on a new line below the cursor

**Link type**. Shown only when **Link placement** is **Replace selection**. Choose whether replacing the selection should insert a **Link** or an **Embed**.

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

### Create Another File

These options keep the existing file untouched and create a new file instead:

- **Increment trailing number**: Changes trailing digits only while preserving zero padding when present. For example, `note009.md` becomes `note010.md`.
- **Append duplicate suffix**: Keeps the full base name and adds ` (1)`, ` (2)`, and so on. For example, `note.md` becomes `note (1).md`.

### Keep Existing File

Selecting **Keep existing file** applies the same result as choosing
**Do nothing** from the prompt:

- **Do nothing**: Leaves the existing file unchanged and opens it
  automatically. This does not require the separate **Open** setting.
