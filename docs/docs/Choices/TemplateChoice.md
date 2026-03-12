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


**If the target file already exists**. Choose what QuickAdd should do when the target file already exists. Turn on **Use selected behavior automatically** to apply the selected mode without prompting, or turn it off to choose each time.

**Open**. Will open the file you've created. By default, it opens in the active pane. If you enable **New tab**, it'll open in a new tab in the direction you specified.

## File Already Exists Behavior

When a file with the target name already exists, QuickAdd can either prompt you or apply the selected behavior automatically:

- **Append to bottom**: Adds the template content to the end of the existing file
- **Append to top**: Adds the template content to the beginning of the existing file
- **Overwrite file**: Replaces the entire file content with the template
- **Increment trailing number**: Creates a new file by incrementing trailing digits while preserving zero padding when present (for example, `note009.md` becomes `note010.md`)
- **Append duplicate suffix**: Creates a new file by preserving the full base name and adding ` (1)`, ` (2)`, and so on (for example, `note.md` becomes `note (1).md`)
- **Do nothing**: Opens the existing file without modification

**Note**: When you select "Do nothing", the existing file will automatically open, making it easy to quickly access files that already exist without needing to enable the "Open" setting.

![image](https://user-images.githubusercontent.com/29108628/121773888-3f680980-cb7f-11eb-919b-97d56ef9268e.png)
