---
title: Template
---

The template choice type is not meant to be a replacement for [Templater](https://github.com/SilentVoid13/Templater/) plugin or core `Templates`. It's meant to augment them, to add more possibilities. You can use both QuickAdd format syntax in a Templater template - and both will work.

## Mandatory
**Template Path**. This is a path to the template you wish to insert.

QuickAdd supports both markdown (`.md`) and canvas (`.canvas`) templates. When using a canvas template, the created file will also be a canvas file with the same extension.

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


**Increment file name**. If a file with that name already exists, increment the file name with a number. So if a file called `untitled` already exists, the new file will be called `untitled1`.

**Open**. Will open the file you've created. By default, it opens in the active pane. If you enable **New tab**, it'll open in a new tab in the direction you specified.

## File Already Exists Behavior

When a file with the target name already exists, QuickAdd will prompt you with several options:

- **Append to the bottom of the file**: Adds the template content to the end of the existing file
- **Append to the top of the file**: Adds the template content to the beginning of the existing file  
- **Overwrite the file**: Replaces the entire file content with the template
- **Increment the file name**: Creates a new file with a number suffix (e.g., `note1.md`)
- **Nothing**: Opens the existing file without modification

**Note**: When you select "Nothing", the existing file will automatically open, making it easy to quickly access files that already exist without needing to enable the "Open" setting.

![image](https://user-images.githubusercontent.com/29108628/121773888-3f680980-cb7f-11eb-919b-97d56ef9268e.png)
