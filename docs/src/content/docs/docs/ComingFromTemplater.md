---
title: Coming from Templater
description: Migrate Templater workflows to QuickAdd - templates, prompts, dates, daily notes, folder workflows, cursor placement, and scripts, done the QuickAdd-native way.
keywords:
  - templater
  - migration
  - template
slug: docs/ComingFromTemplater
---

If you built your note workflows around the Templater plugin, this page maps each familiar job to the QuickAdd-native way to do it. Every pattern below runs on QuickAdd alone: one engine owns your prompts, dates, and file creation, which is what keeps you clear of double prompts and half-rendered template syntax (see [common migration snags](#common-migration-snags)).

New to QuickAdd entirely? Start with [Getting Started](/docs/) for the choice types, then come back here for the mappings.

## Point QuickAdd at your template folder

You don't need to move or rewrite your template files to start. Add your existing template folder(s) under **Template folder paths** in [Settings → Templates & Properties](/docs/Settings/#templates--properties). That single step powers:

- the **QuickAdd: New note from template** command, which lists every template in those folders and prompts for the new note's name - no per-template setup;
- the **QuickAdd: Apply template to active note** command, whose picker offers those template files too;
- template-path autocomplete when you configure choices.

Make a [Template choice](/docs/Choices/TemplateChoice/) for the templates that deserve their own hotkey, a fixed destination folder, or a file name format.

## The quick map

The left column names the job; the middle names the Templater expression you may know it by (as a landmark only - the QuickAdd patterns don't use or require it).

| The job | You may know it as | The QuickAdd way |
| --- | --- | --- |
| Insert the note's title | `tp.file.title` | [`{{TITLE}}`](/docs/FormatSyntax/#title) |
| Today's date, any format | `tp.date.now` | [`{{DATE:YYYY-MM-DD}}`](/docs/FormatSyntax/#date-format), offsets like `{{DATE+7}}` |
| Ask for a date in plain language | `tp.system.prompt` | [`{{VDATE:due,YYYY-MM-DD}}`](/docs/FormatSyntax/#vdate) - natural language built in |
| Prompt for text | `tp.system.prompt` | [`{{VALUE:name}}`](/docs/FormatSyntax/#named-value) |
| Pick from a list | `tp.system.suggester` | [`{{VALUE:Option A,Option B}}`](/docs/FormatSyntax/#named-value), [`{{FIELD:...}}`](/docs/FormatSyntax/#field), [`{{FILE:...}}`](/docs/FormatSyntax/#file) |
| Include one template in another | `tp.file.include` | [`{{TEMPLATE:Templates/Partial.md}}`](/docs/FormatSyntax/#template) |
| Apply a template to an existing note | the insert template command | [Apply template to active note](/docs/ApplyTemplateToNote/) |
| Insert the clipboard | `tp.system.clipboard` | [`{{CLIPBOARD}}`](/docs/FormatSyntax/#clipboard) |
| Insert the selected text | `tp.selection` | [`{{selected}}`](/docs/FormatSyntax/#selected) |
| Reuse a property from the note you're in | `tp.frontmatter` | [`{{FIELD:project\|default-from:active}}`](/docs/FormatSyntax/#field-default-from-active); to re-render a value you prompted for, just [repeat `{{VALUE:name}}`](#prompt-once-reuse-everywhere) |
| Link back to the note you came from | `tp.file.path` workarounds | [`{{LINKCURRENT}}`](/docs/FormatSyntax/#linkcurrent) (a link), [`{{FILENAMECURRENT}}`](/docs/FormatSyntax/#filenamecurrent) (raw name, for embeds like `![[{{FILENAMECURRENT}}#Heading]]`), [`{{LINKSECTION}}`](/docs/FormatSyntax/#linksection) (link to the heading you're in) |
| Run JavaScript | `tp.user` | [Inline scripts](/docs/InlineScripts/), [user scripts in macros](/docs/Choices/MacroChoice/), [`{{MACRO:...}}`](/docs/FormatSyntax/#macro) |
| Folder templates | folder templates | No automatic equivalent - see [Templates chosen by folder](#templates-chosen-by-folder) |
| Cursor marker in a template | `tp.file.cursor` | No direct equivalent - see [Where the cursor lands](#where-the-cursor-lands) |

## Create new notes from templates

A [Template choice](/docs/Choices/TemplateChoice/) creates a note from a template file, with a configurable destination folder, file name format, link insertion, and open behavior. QuickAdd resolves every token - prompts included - before the note is created, so the finished note is plain text from its first moment.

To position user input at an exact spot in the new note, put the token exactly where the text belongs. One named value can drive both the file name and the body:

File name format: `{{VALUE:topic}}`

```markdown
---
type: meeting
---
# {{TITLE}}

Topic: {{VALUE:topic}}
Date: {{DATE:YYYY-MM-DD}}
```

You are asked for `topic` once; the answer becomes the file name and fills the body, and `{{TITLE}}` renders the final file name.

## Add to existing notes

### Shared template content in new and existing notes

Keep one template file and use it both ways - no parallel template sets:

- **New notes**: point a Template choice at it, or include it inside a bigger template with [`{{TEMPLATE:Templates/Partial.md}}`](/docs/FormatSyntax/#template).
- **Existing notes**: run **QuickAdd: Apply template to active note** (also in a file's right-click menu). You pick the template and where it goes - cursor, top, bottom, or replace. For the insert modes, the template's frontmatter is merged into the note's existing frontmatter, with the note's own values winning (replace overwrites the whole note, frontmatter included). See [Apply Template to Note](/docs/ApplyTemplateToNote/).

A [Capture choice](/docs/Choices/CaptureChoice/) whose format is `{{TEMPLATE:Templates/Partial.md}}` also inserts that shared content into a target note. Prefer it for body-only snippets: a capture inserts the template text as-is, so a template that starts with its own `---` frontmatter block ends up as a literal second block instead of being merged. When the shared content carries frontmatter, use **Apply template to active note**.

### Today's daily note

Appending to today's note is a Capture choice with a date-formatted target path - the file doesn't have to exist beforehand:

- **Capture to**: `Daily/{{DATE}}.md`
- **Create file if it doesn't exist**, with your daily template
- **Insert after**: `## Log`, with **Create line if not found**
- **Capture format**: `- {{VALUE}}`

Say today is 2026-07-06: running it and typing `did a thing` creates `Daily/2026-07-06.md` from the template on first capture and appends `- did a thing` under `## Log` - one hotkey, with or without an existing note. For a step-by-step walkthrough with variations, see [Capture: Add entries to your daily note](/docs/Examples/Capture_ToDailyNote/); [Capture choices](/docs/Choices/CaptureChoice/) covers every target and position option.

## Templates chosen by folder

QuickAdd does not watch folders: nothing runs automatically when a note appears in a folder, no matter how it was created. What it offers instead is explicit and per-choice:

- **One Template choice per destination.** Set **New note location** to **In a specific folder** and name the choice after the destination ("New person", "New project"). Each gets its own command and can get its own hotkey.
- **One choice, several folders.** List multiple folders on the choice (optionally **Include subfolders**) and QuickAdd asks which one at run time.
- **Dynamic paths.** Both the template path and the folder path accept [format syntax](/docs/FormatSyntax/), and one named value can drive both. A choice with template path `Templates/{{VALUE:kind}}.md` and folder path `{{VALUE:kind}}s` asks for `kind` once - answering `Person` creates the note from `Templates/Person.md` in the `Persons` folder, keeping the whole folder-to-template mapping in a single choice.
- **No setup at all**: the **New note from template** command picks any template from your template folder and creates the note in Obsidian's default location.

## Dates without another plugin

`{{DATE}}` renders today (`YYYY-MM-DD` by default), `{{DATE:<format>}}` takes any [Moment format](https://momentjs.com/docs/#/displaying/format/), and offsets travel in days: `{{DATE+7}}`, `{{DATE:gggg-[W]WW+7}}`. Snap to period boundaries with [`|startof:` / `|endof:`](/docs/FormatSyntax/#date-snap), for example `{{DATE:YYYY-MM|startof:week}}` for weekly notes that file under the month the week belongs to.

For dates you enter, [`{{VDATE:name,format}}`](/docs/FormatSyntax/#vdate) understands natural language out of the box - no companion plugin. Type `tomorrow`, `next friday`, or `in two weeks`. Enter the date once, render it many times:

```markdown
Due: {{VDATE:due,YYYY-MM-DD}}
Week: {{VDATE:due,gggg-[W]WW}}
```

Typing `tomorrow` fills both lines from one prompt - with 2026-07-06 as today, that's `Due: 2026-07-07` and `Week: 2026-W28`.

There is no token for a file's creation or modification date - reach for a [script](#run-scripts) if you need those.

## Prompt once, reuse everywhere

Named values are shared across an entire run. `{{VALUE:topic}}` in the file name, the template body, and any other step of the same run all resolve from a single prompt - the mechanism behind the [Template choice example above](#create-new-notes-from-templates).

That sharing spans [Macro choice](/docs/Choices/MacroChoice/) steps too. A classic two-step flow - log a task in today's daily note and create its note - is a macro of two choices sharing one name:

1. A Capture choice into `Daily/{{DATE}}.md` with the format `- [ ] [[{{VALUE:task}}]]`
2. A Template choice with file name format `{{VALUE:task}}` creating the note in your `Tasks` folder

You type the task name once. Scripts join the same pool: anything a script assigns to `params.variables.task` is what `{{VALUE:task}}` resolves to in later steps - see the [scripting guide](/docs/Advanced/ScriptingGuide/).

To gather every prompt on a single form up front instead of one dialog at a time, enable [one-page input](/docs/Advanced/onePageInputs/) - and see [Controlling Prompts](/docs/ControllingPrompts/) for everything about prompt order, labels, defaults, and skipping.

## Where the cursor lands

QuickAdd has no in-template cursor marker of its own - you can't mark an arbitrary spot in a template and land there. What you can control:

- **Captures follow the insertion.** With **Capture to active file**, the cursor ends up right after the inserted text; with **Open** enabled on other targets (opened focused, in an editing mode), QuickAdd places the cursor immediately after the inserted text.
- **Apply template to active note** offers an **Insert at cursor** mode, so content lands where you already are.
- **After creating a note**, a Template choice with **Open** doesn't move the cursor - you typically land at the top of the note. To end at the bottom instead, wrap the Template choice in a [Macro choice](/docs/Choices/MacroChoice/) and add the **Move cursor to file end** editor command as the next step (file start and line start/end variants exist too).

## Run scripts

QuickAdd runs JavaScript in two shapes:

- **[Inline scripts](/docs/InlineScripts/)**: a fenced code block tagged `js quickadd` inside a template body or capture format. The block runs when the choice does, and a returned string is spliced into the output in its place.
- **[User scripts](/docs/Choices/MacroChoice/)**: a `.js` file in your vault, run as a step of a Macro choice. Scripts receive `app`, the [QuickAdd API](/docs/QuickAddAPI/) (`inputPrompt`, `suggester`, `executeChoice`, and more), the shared `variables` map, and the `obsidian` module - see the [scripting guide](/docs/Advanced/ScriptingGuide/).

`{{MACRO:My macro}}` embeds a macro's return value anywhere format syntax is accepted, so a computed value can flow straight into a file name, template body, or capture line.

## Common migration snags

These are the classic symptoms of splitting one template between two engines - each has a QuickAdd-native fix:

- **You get prompted twice.** QuickAdd resolves all of its prompts before the file is created. If another engine prompts in the same template, you answer twice - once per engine. Let QuickAdd own the prompt with `{{VALUE:name}}` and reuse the answer everywhere it's needed.
- **Template syntax shows up unrendered.** QuickAdd renders QuickAdd tokens; another engine's syntax is only rendered by that engine. If it isn't installed or doesn't run on the file, its markup stays behind as literal text. Port the line to the matching token from [the map](#the-quick-map).
- **Capturing into a note throws template errors.** A note that keeps live template syntax can re-execute or error whenever a plugin processes the file again. QuickAdd tokens like `{{DATE:YYYY-MM-DD}}` render once, at creation, into plain text - later captures find nothing to re-run. Migrate the offending line to a QuickAdd token and let QuickAdd create the note so the token renders - a Capture with **Create file if it doesn't exist** plus that template does both (see [Today's daily note](#todays-daily-note)).
