---
title: Template
---

The template choice type is not meant to be a replacement for [Templater](https://github.com/SilentVoid13/Templater/) plugin or core `Templates`. It's meant to augment them, to add more possibilities. You can use both QuickAdd format syntax in a Templater template - and both will work.

## Mandatory
**Template Path**. This is a path to the template you wish to insert. Paths are vault-relative; a leading `/` is ignored.

QuickAdd supports markdown (`.md`), canvas (`.canvas`), and base (`.base`) templates. The created file uses the same extension as the template.
If you want a new markdown note to include a live embedded Base dashboard, see
[Template: Create an MOC Note with a Link Dashboard](/Examples/Template_CreateMOCNoteWithLinkDashboard.md).

## Optional
**File Name Format**. You can specify a format for the file name, which is based on the format syntax - which you can see further down this page.
Basically, this allows you to have dynamic file names. If you wrote `£ {{DATE}} {{NAME}}`, it would translate to a file name like `£ 2021-06-12 Manually-Written-File-Name`, where `Manually-Written-File-Name` is a value you enter when invoking the template.

**Create in folder**. In which folder should the file be created in.
You can specify as many folders as you want. If you don't, it'll just create the file in the root directory. If you specify one folder, it'll automatically create the file in there.
If you specify multiple folders, you'll get a suggester asking which of the folders you wish to create the file in.

**Append link**. The file you're currently in will get a link to a newly created file. Pick one of three modes:
- **Enabled (requires active file)** – throw an error if no note is focused (legacy behavior)
- **Enabled (skip if no active file)** – insert the link when possible and skip silently otherwise
- **Disabled** – never append a link

When either enabled mode is selected, you can choose where the link is placed:
- **Replace selection** - Replaces any selected text with the link (default)
- **After selection** - Preserves selected text and places the link after it  
- **End of line** - Places the link at the end of the current line
- **New line** - Places the link on a new line below the cursor


**If the target file already exists**. Choose whether QuickAdd should ask what to do, update the existing file, create another file, or keep the existing file.

**Open**. Will open the file you've created. By default, it opens in the active pane. If you enable **New tab**, it'll open in a new tab in the direction you specified.

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
