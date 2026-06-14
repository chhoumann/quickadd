---
title: Capture
---

Allows to quickly capture your input and save it from anywhere in Obsidian, without leaving your current window setup e.g.

-   Add messages to your work log
-   Save interesting links for later reading and watching
-   Individually timed notes in Daily notes file

![The QuickAdd Capture builder, showing the Location and Position sections](/img/choices/capture-builder.png)

## Capture To

_Capture To_ is the name of the file you are capturing to.
You can choose to either enable _Capture to active file_, or you can enter a file name in the _File Name_ input field.

QuickAdd treats file names as basename-first by default:
- If you do **not** provide an extension, QuickAdd creates/targets a Markdown file (`.md`).
- If you provide an explicit supported extension (for example `.md` or `.canvas`), QuickAdd keeps that extension.
- Capture to `.base` files is not supported. Use a Template choice for `.base` workflows.

This field also supports the [format syntax](/FormatSyntax.md), which allows you to use dynamic file names.
I have one for my daily journal with the name `bins/daily/{{DATE:gggg-MM-DD - ddd MMM D}}.md`.
This automatically finds the file for the day, and whatever I enter will be captured to it.

### How QuickAdd picks a target

When **Capture to active file** is disabled, QuickAdd resolves the _File path /
format_ value after applying format syntax:

- An empty value, or `/`, opens a whole-vault picker for Markdown files.
- A value starting with `#` opens a picker for Markdown files with that tag.
- A value ending in `/` opens a folder picker.
- A value ending in a supported file extension, such as `.md` or `.canvas`,
  targets that file path directly.
- A value without an extension targets a folder only when that folder exists and
  there is no same-name Markdown file. For example, if both `Projects/` and
  `Projects.md` exist, `Projects` targets `Projects.md`; use `Projects/` to
  force the folder picker.

Folder pickers include Markdown files in the selected folder and its nested
folders. The picker also accepts custom input, so you can type a new file name
or path and let QuickAdd create it when **Create file if it doesn't exist** is
enabled. The picker still needs at least one matching Markdown file to open.

### Capturing to folders

You can also type a **folder name** into the _Capture To_ field, and QuickAdd will ask you which file in the folder you'd like to capture to.
This also supports the [format syntax](/FormatSyntax.md). You can even write a filename in the suggester that opens, and it will create the file for you - assuming you have the _Create file if it doesn't exist_ setting enabled.

For example, you might have a folder called `CRM/people`. In this folder, you have a note for the people in your life. You can type `CRM/people` in the _Capture To_ field, and QuickAdd will ask you which file to capture to. You can then type `John Doe` in the suggester, and QuickAdd will create a file called `John Doe.md` in the `CRM/people` folder.

You could also write nothing - or `/` - in the _Capture To_ field. This will open the suggester with all of your files in it, and you can select or type the name of the file you want to capture to.
Paths are vault-relative. A leading `/` is ignored (except a lone `/`, which opens the file picker for the whole vault).

Capturing to a folder will show all files in that folder. This means that files in nested folders will also appear.

### Capturing to tags

Similarly, you can type a **tag name** in the _Capture To_ field, and QuickAdd will ask you which file to capture to, assuming the file has the tag you specify.

If you have a tag called `#people`, and you type `#people` in the _Capture To_ field, QuickAdd will ask you which file to capture to, assuming the file has the `#people` tag.

## Capture Options

The Capture builder is grouped into sections: **Location**, **Position**, **Linking**, **Content**, and **Behavior**.

-   _Create file if it doesn't exist_ will do as the name implies - you can also create the file from a template, if you specify the template (the input box will appear below the setting).
-   _Task_ will format your captured text as a task.
-   _Use editor selection as default value_ controls whether the current editor selection is used as `{{VALUE}}`. Choose **Follow global setting**, **Use selection**, or **Ignore selection** (global default lives in Settings > Input). This does not affect `{{SELECTED}}`.
-   _Write position_ is a dropdown that controls where Capture writes. The available options depend on whether _Capture to active file_ is enabled:
    -   **At cursor** (active file) / **Top of file** (target file) - the first option's label changes with the mode
    -   **Top of file (after frontmatter)** (active file only)
    -   **New line above cursor** (active file only)
    -   **New line below cursor** (active file only)
    -   **After line…**
    -   **Under heading…** - pick a heading from the target note at capture time (a dropdown of the note's headings appears when you run the capture), and the text is inserted under the one you choose. See [Under heading](#under-heading).
    -   **Before line…**
    -   **Bottom of file**
-   _Link to captured file_ is a dropdown that controls whether QuickAdd inserts a link to the captured file in the current note. You can choose between three modes:
    -   **Enabled (requires active file)** – keeps the legacy behavior and throws an error if no note is focused (except Canvas-triggered capture, where link insertion is skipped)
    -   **Enabled (skip if no active file)** – inserts the link when possible and silently drops `{{LINKCURRENT}}` if nothing is open
    -   **Disabled** – never append a link

    When either enabled mode is selected, a _Link placement_ dropdown appears so you can choose where the link is placed:
    -   **Replace selection** - Replaces any selected text with the link (default)
    -   **After selection** - Preserves selected text and places the link after it
    -   **End of line** - Places the link at the end of the current line
    -   **New line** - Places the link on a new line below the cursor

    When placement is **Replace selection**, an extra _Link type_ dropdown appears, letting you choose **Link** or **Embed**. Embed is only respected for the Replace selection placement.

### Opening the captured file

When _Capture to active file_ is disabled, the **Behavior** section shows an _Open_ toggle (described as "Open the captured file."). Enabling it reveals the shared file-opening controls:

-   _File Opening Location_ - a dropdown for where to open the captured file: **Reuse current tab**, **New tab**, **Split pane**, **New window**, **Left sidebar**, or **Right sidebar**.
-   _Split Direction_ - shown only when location is **Split pane**; choose **Split right** or **Split down**.
-   _View Mode_ - how to display the opened file: **Source**, **Preview**, **Live Preview**, or **Default**.
-   _Focus new pane_ - a toggle to focus the opened tab immediately after opening. Shown for every location except **Reuse current tab**.

### Run Templater on entire destination file after capture

The **Behavior** section also has a _Run Templater on entire destination file after capture_ toggle. This is an advanced / legacy option: it executes any `<% %>` anywhere in the destination file, including inside code blocks. Leave it off unless you specifically need that whole-file Templater pass.

### Templater and newly created files

Capture has two different Templater paths when it creates a missing Markdown
file:

- If **Create file if it doesn't exist** is enabled without a QuickAdd template,
  QuickAdd creates a blank file first. When Templater's new-file trigger is
  enabled and applies to that location, QuickAdd waits for Templater to finish
  before inserting the capture content.
- If **Create with template** is enabled, QuickAdd owns the initial file
  content. It renders the selected QuickAdd template, suppresses Templater's
  new-file/directory trigger for that creation event, and then runs Templater
  once on the content QuickAdd wrote.

This means a blank Capture-created file can receive Templater's directory
template first, while a Capture-created file that uses a QuickAdd template runs
Templater on QuickAdd's selected template content instead.

## Canvas Capture Notes

QuickAdd supports two Canvas capture workflows:

- Capture to one selected card in the active Canvas view
- Capture to a specific card in a specific `.canvas` file

### 1) Capture to selected card in active Canvas

This mode is enabled when **Capture to active file** is on and the active leaf
is a Canvas.

Supported card targets:

- Text cards
- File cards that point to markdown files

### 2) Capture to specific card in specific `.canvas` file

This mode is enabled when **Capture to active file** is off, the capture path
resolves to a `.canvas` file, and **Target canvas node** is set.

When the capture path is a `.canvas` file, QuickAdd shows a node picker that
helps you choose a node id directly from that board.

### Write position support in Canvas

- Text cards support: **Top of file**, **Bottom of file**, **After line...**, **Before line...**
- File cards (markdown targets) support: **Top of file**, **Bottom of file**, **After line...**, **Before line...**
- Canvas does not support cursor-based modes: **At cursor**, **New line above cursor**, **New line below cursor**

If **Capture to active file** is enabled and you leave the default write
position at **At cursor**, capture will abort in Canvas until you switch to a
supported mode.

Canvas capture requires exactly one selected card in selected-card mode. If the
selection is missing, multi-select, or unsupported, QuickAdd aborts with a
notice instead of writing to the wrong place.

When append-link is set to **Enabled (requires active file)** and capture runs
from a Canvas card without a focused Markdown editor, the capture still writes
and link insertion is skipped.

For a step-by-step setup, see
[Capture: Canvas Capture](../Examples/Capture_CanvasCapture).

### Canvas Capture FAQ

**Why did my capture abort in Canvas?**

Most often one of these is true:

- No card is selected
- More than one card is selected
- The selected card type is unsupported
- The selected write mode is cursor-based

**Can I target a specific card in a Canvas file?**

Yes. Set capture path to a `.canvas` file and choose a **Target canvas node**.

**Does "At cursor" work in Canvas cards?**

No. Use top, bottom, insert-after, or insert-before placement.

**Can I capture to a file card that points to a Canvas file?**

No. File-card capture supports markdown targets only.

**Can I still create new Canvas files from templates?**

Yes. Template choices support `.canvas` templates.

## Insert after

Insert After will allow you to insert the text after some line with the specified text.
By default, QuickAdd preserves blank lines after ATX headings to keep heading
spacing intact. Use **Blank lines after match** to control this behavior:

-   **Auto (headings only)** - Skip blank lines only when the matched line is
    a Markdown heading.
-   **Always skip** - Skip all consecutive blank lines after the match.
-   **Never skip** - Insert immediately after the matched line.

Example (Auto, Insert After `# H` with content `X`):

```markdown
# H

X
A
```

With Insert After, you can also enable `Insert at end of section` and `Consider subsections`.
You can see an explanation of these below.

I use this in my daily journal capture, where I insert after the heading line `## What did I do today?`.

It's also possible to use `Create line if not found`, which will create the line if it doesn't exist. This is useful if you want to insert after a line that might not exist in the file you're capturing to.
This setting can place the line at the start or end of the file, or at your current cursor position.

## Under heading

Choose **Under heading…** as the _Write position_ when you want to pick the target heading **at capture time** instead of typing it in advance. When you run the capture, QuickAdd reads the target note and shows a dropdown of its headings — pick one, and the text is inserted under it. This is the same idea as the note-selection dropdown that appears when no file name is specified, but for headings within a single note.

This is a flavor of [Insert after](#insert-after) (the picked heading becomes the insert-after target), so all of its placement controls still apply:

-   By default the text is inserted directly under the chosen heading line. Enable `Insert at end of section` to append it to the end of that heading's section instead.
-   `Consider subsections`, `Blank lines after match`, and `Create line if not found` work exactly as for Insert after.

Notes:

-   You can also **type a heading** that doesn't exist yet. To have QuickAdd create it, enable `Create line if not found` (type the heading with its `#` markers, e.g. `## Tasks`).
-   The dropdown lists ATX headings (lines starting with `#`). For a brand-new note created from a template, the picker can't list the template's headings yet (the note doesn't exist at pick time) — type the heading and use `Create line if not found`.
-   If you use the one-page input form, the heading dropdown still appears as a separate step after the form.

### Consider subsections -option

#### `Consider subsections` disabled

Behavior with `Insert after` & `Insert at end`:

```markdown
## 1. First heading

**Insert after** comes here.

-   content 1
-   content 2
-   content 3
    **Insert at end** comes here.

### 1.1. Nested heading 1

Content

## 2. Another heading

Content
```

#### `Consider subsections` enabled

Behavior with `Insert after` & `Insert at end`:

```markdown
## 1. First heading

**Insert after** comes here

-   content 1
-   content 2
-   content 3

### 1.1. Nested heading 1

Content
**Insert at end** comes here. Captures to after this, as it's considered part of the "1. First heading" section.

## 2. Another heading

Content
```

## Insert before

Insert Before inserts the capture before the first line that matches the specified text.
The target accepts QuickAdd format syntax, so values such as `{{title}}` and
`{{linkcurrent}}` can be used in the match text.

It's also possible to use `Create line if not found`, which will create the
line if it doesn't exist. For Insert Before, QuickAdd writes the captured
content first, then creates the missing line below it. This setting can place
the line at the start or end of the file, or at your current cursor position.

## Capture Format

Capture format lets you specify the exact format that you want what you're capturing to be inserted as.
You can do practically anything here. Think of it as a mini template.

If you do not enable this, QuickAdd will default to `{{VALUE}}`, which will insert whatever you enter in the prompt, or (if selection-as-value is enabled) the current editor selection.

You can use [format syntax](/FormatSyntax.md) here, which allows you to use dynamic values in your capture format.

If you want to insert `.base` content into your current note, keep **Capture to active file** enabled and use a `.base` template token in the capture format. See [Capture: Insert a Related Notes Base into an MOC Note](/Examples/Capture_InsertBaseTemplateIntoActiveFile.md).
If you want QuickAdd to create a brand new note that already contains an
embedded Base, use a Template choice instead. See
[Template: Create an MOC Note with a Link Dashboard](/Examples/Template_CreateMOCNoteWithLinkDashboard.md).

If your capture format includes an inline `js quickadd` block and you need to
transform user input, prefer reading input in script code through
`this.quickAddApi.inputPrompt(...)` and/or assigning script variables on
`this.variables`. Avoid relying on `{{VALUE}}` inside JavaScript string
literals. See [Inline scripts](/InlineScripts.md#execution-order-and-value).

In my journal capture, I have it set to `- {{DATE:HH:mm}} {{VALUE}}`. This inserts a bullet point with the time in hour:minute format, followed by whatever I entered in the prompt.
