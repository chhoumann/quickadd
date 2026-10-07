---
title: Format syntax
description: "Placeholders like {{DATE}} and {{VALUE}} that QuickAdd replaces with real values: dates, your answers, links, clipboard content, and more"
slug: docs/FormatSyntax
---

Format syntax lets you put **placeholders** in anything QuickAdd creates. When a
choice runs, each placeholder is replaced with a real value: today's date, an
answer you type, a link to the note you came from.

You can use placeholders anywhere QuickAdd asks for a format: file name fields,
capture formats, folder paths, "Insert after" targets, and inside template files.

In the format fields of a choice's settings (such as **Capture format**,
**Capture to**, **File name**, and the insert after/before targets), type
`{{` to get a list of placeholders, then keep typing to filter it. Template
files and folder pickers don't show this list. Press Enter to insert the highlighted one. For placeholders that take
an argument, like `{{VDATE:}}`, the cursor lands inside so you can finish it.

![Typing two curly braces in a Capture format field opens a list of placeholders with a short description of each. Typing "val" narrows it to VALUE variants, Enter inserts {{VALUE}}, and picking {{VDATE:}} leaves the cursor inside so "due,YYYY-MM-DD" can be typed. The preview under the field updates as the format changes](./Images/format-syntax-autocomplete.gif)

For example, a Capture with this format:

```markdown
- {{DATE:HH:mm}} {{VALUE}}
```

asks you for a value, and if you answer `Standup moved to Wednesday`, it inserts:

```markdown
- 09:42 Standup moved to Wednesday
```

You describe the shape once; QuickAdd fills in the blanks every run.

Answers, selected text, clipboard contents and `value-` URI parameters are
inserted as written. A placeholder or Templater `<% %>` tag inside them stays
text. A Templater tag in the format itself can still use an answer, as in
`<% "{{VALUE:title}}".toUpperCase() %>`.

## Quick reference {#quick-reference}

**Ask for input**

| Placeholder | What it does |
| --- | --- |
| [`{{VALUE}}`](#value) | Ask for text |
| [`{{VALUE:title}}`](#named-value) | Ask for text once, reuse the answer anywhere as `title` |
| [`{{VALUE:Red,Green,Blue}}`](#value-suggest) | Pick from a list |
| [`{{VDATE:due,YYYY-MM-DD}}`](#vdate) | Ask for a date ("tomorrow" works) |
| [`{{FIELD:project}}`](#field) | Suggest values that property already has in your vault |
| [`{{PROPERTY}}`](#property) | Insert the property's current value (property Captures only) |
| [`{{CURSOR}}`](#cursor) | Place the cursor inside a Template or Capture |
| [`{{FILE:People}}`](#file) | Pick a note from a folder |
| [`{{MVALUE}}`](#mvalue) | Write a math formula (LaTeX) |

**Dates**

| Placeholder | What you get |
| --- | --- |
| [`{{DATE}}`](#date) | Today, like `2026-07-08` |
| [`{{DATE:MMMM Do}}`](#date-format) | Today, formatted your way: `July 8th` |
| [`{{DATE+7}}`](#date) | Seven days from today |
| [`{{DATE:YYYY-MM\|startof:week}}`](#date-snap) | The week's starting month, for weekly notes |
| [`{{TIME}}`](#time) | The current time, like `14:05` |
| [`{{DAILY}}`](#daily) | The daily note, like `Journal/2026-07-08` |
| [`{{WEEKLY}}`](#periodic-notes) | This week's note, like `Weekly/2026-W28` |

**The note you ran QuickAdd from**

| Placeholder | What you get |
| --- | --- |
| [`{{LINKCURRENT}}`](#linkcurrent) | A link to it: `[[That note]]` |
| [`{{LINKSECTION}}`](#linksection) | A link to the section your cursor is in |
| [`{{FILENAMECURRENT}}`](#filenamecurrent) | Its file name |
| [`{{FOLDERCURRENT}}`](#foldercurrent) | Its folder |
| [`{{SELECTED}}`](#selected) | The text you had selected |

**The note being created**

| Placeholder | What you get |
| --- | --- |
| [`{{TITLE}}`](#title) | The new note's file name |
| [`{{FOLDER}}`](#folder) | The folder the new note lands in |

**Other content**

| Placeholder | What it inserts |
| --- | --- |
| [`{{CLIPBOARD}}`](#clipboard) | Whatever you copied last |
| [`{{TEMPLATE:Templates/Meeting.md}}`](#template) | The contents of a template file |
| [`{{MACRO:My Macro}}`](#macro) | Whatever a macro returns |
| [`{{GLOBAL_VAR:Header}}`](#global-var) | A snippet you defined in settings |
| [`{{RANDOM:6}}`](#random) | A random ID like `x7k2p9` |

## Dates

### Today's date: `{{DATE}}` {#date}

`{{DATE}}` becomes today's date in `YYYY-MM-DD` format.

A choice can aim that token at another day, so the same
`Daily/{{DATE}}.md` template opens yesterday when you ask it to. `{{DATE+3}}`
is still three days later. `{{TIME}}` is always the time you ran the choice.
See [Which day](/docs/Choices/TemplateChoice/#date-origin).

`{{DATE:HH:mm}}` only prints the clock, so it looks like `{{TIME}}`. The day
is still the chosen one. Write `{{DATE:YYYY-MM-DD HH:mm}}` if you want both.

Add `+N` to move the date: `{{DATE+3}}` is three days from that day,
`{{DATE+-3}}` is three days before it.

```markdown title="You write"
Daily/{{DATE}}.md
Review on {{DATE+7}}
```

```markdown title="You get (on July 8th, 2026)"
Daily/2026-07-08.md
Review on 2026-07-15
```

<a id="obsidian-date-placeholders"></a>

:::note[Seeing `+3` or `{{DATE+3}}` in your note?]
Obsidian's **Daily notes** and **Templates** core plugins fill `{{date}}`,
`{{time}}`, and `{{title}}` themselves, and nothing else. If **Open today's
daily note** or **Insert template** filled in the note, `{{DATE}}` works, but
`{{DATE:YYYY-MM-DD+3}}` becomes `2026-07-08+3`, `{{DATE+3}}` stays as-is, and
`|startof:` turns into gibberish. Run the file from a QuickAdd
[Template choice](/docs/Choices/TemplateChoice/) instead.
:::

### Choose the date format: `{{DATE:<format>}}` {#date-format}

Put a [Moment.js format](https://momentjs.com/docs/#/displaying/format/) after
the colon to control how the date looks. The `+N` day offset works here too:
`{{DATE:YYYY-MM-DD+3}}`.

| You write | You get |
| --- | --- |
| `{{DATE:MMMM Do, YYYY}}` | `July 8th, 2026` |
| `{{DATE:YYYY-MM-DD_HH-mm}}` | `2026-07-08_09-42` |
| `{{DATE:[Week] w}}` | `Week 28` |

:::tip
Literal text inside a date format goes in square brackets, like `[Week]` above.
Otherwise Moment.js treats every letter as a date token.
:::

### Change date text casing: `|case:` {#date-case}

Add `|case:<style>` after a `DATE`, `TIME`, or `VDATE` format to transform its
rendered text. It uses the same styles as [`VALUE`](#value-case): `kebab`,
`snake`, `camel`, `pascal`, `title`, `lower`, `upper`, and `slug`.

```markdown
## {{DATE:dddd, MMMM Do, yyyy.|case:lower}}
{{TIME:A|case:lower}}
{{VDATE:due,dddd, MMMM Do, YYYY|case:lower}}
```

On August 11, 2026 in the English locale, the first line becomes
`## tuesday, august 11th, 2026.`. Moment formats the date in your current
locale first, then QuickAdd applies the case transform. The transform is per
placeholder and does not change the locale or a reused `VDATE` value.

When combining a date snap and casing, put casing last:
`{{DATE:MMMM YYYY|startof:month|case:lower}}`.

### Snap to the start or end of a week, month, or year {#date-snap}

Add `|startof:<unit>` or `|endof:<unit>` to move the date to the boundary of a
period before formatting. `<unit>` is one of `year`, `quarter`, `month`, `week`,
`isoweek`, or `day` (case-insensitive).

This matters when the formatted output should reflect the period rather than
the exact day. The month of a week-snapped date is the month the *week* starts
in, not today's calendar month.

| You write (on Thursday 2023-06-01) | You get |
| --- | --- |
| `{{DATE:gggg.MM.[Wk]w\|startof:week}}` | `2023.05.Wk22` |
| `{{DATE:YYYY-MM\|startof:month}}` | `2023-06` |
| `{{DATE:YYYY-MM-DD\|endof:month}}` | `2023-06-30` |
| `{{DATE:YYYY-[Q]Q\|startof:quarter}}` | `2023-Q2` |
| `{{DATE:GGGG-[W]WW\|startof:isoweek}}` | ISO week, Monday-anchored |

- `week` starts on your locale's first day of the week (matching the `w`/`ww`/`gggg` tokens).
- `isoweek` starts on Monday (matching the `W`/`WW`/`GGGG` tokens).

**Example: weekly notes that cross months.** A weekly note named
`gggg.MM.[Wk]w` should file the week of June 1 under May (`2023.05.Wk22`),
while the heading inside the note still shows the actual day. Snap only the
file name:

```markdown
File name:  {{DATE:gggg.MM.[Wk]w|startof:week}}
In the note: {{DATE:M.DD dddd}}
```

Snapping also works on [`{{VDATE}}`](#vdate), so one picked date can be
week-snapped in the file name and day-accurate in the body:
`{{VDATE:d,gggg.MM.[Wk]w|startof:week}}` and `{{VDATE:d,M.DD dddd}}` share the
same prompt. Combine freely with `|default`, `|optional`, and `|time` in any
order.

Good to know:

- Snaps are QuickAdd-only. Obsidian's **Open today's daily note** and **Insert template** garble them; see [above](#obsidian-date-placeholders).
- The `+N` day offset is applied **before** the snap, so `{{DATE:YYYY-MM-DD+7|startof:week}}` means "the start of next week".
- `endof:` snaps to the last moment of the period (`23:59:59.999`), so `{{DATE:YYYY-MM-DD HH:mm|endof:day}}` renders `... 23:59`.
- `|startof:`, `|endof:`, and `|case:` are special pipe options in a date format. Any other literal `|` is kept as-is: `{{DATE:YYYY|MM}}` gives `2023|06`. Put a literal `|case:lower` inside square brackets.
- An unknown unit (like `|startof:fortnight`) shows an error listing the valid units.

### The current time: `{{TIME}}` {#time}

`{{TIME}}` becomes the current time in `HH:mm` format. `{{TIME:<format>}}`
takes any [Moment.js format](https://momentjs.com/docs/#/displaying/format), the
same as `{{DATE:<format>}}`.

```markdown title="You write"
- {{TIME}} {{VALUE}}
Meeting {{DATE}} {{TIME:HH.mm}}
```

```markdown title="You get"
- 14:05 Standup moved to Wednesday
Meeting 2026-07-08 14.05
```

Use `{{TIME:HH.mm}}` rather than `{{TIME}}` inside a file name: `:` is not
allowed in file names on Windows or macOS.

Unlike `{{DATE}}`, `{{TIME}}` takes no `+N` offset. For a time other than "now",
use `{{DATE:HH:mm}}` with an offset, or ask for one with
[`{{VDATE:<name>, <format>|time}}`](#vdate).

### The daily note: `{{DAILY}}` {#daily}

_Requires QuickAdd 2.30.0 or later._

`{{DAILY}}` is the path of the day's daily note, from the folder and date
format in Obsidian's **Daily notes** settings. Set **Capture to** to
`{{DAILY}}` and entries land in the note **Open today's daily note** opens,
even after you change those settings.

| You write | You get (Daily notes folder `Journal`, format `YYYY-MM-DD`) |
| --- | --- |
| `{{DAILY}}` | `Journal/2026-07-08` |
| `{{DAILY\|link}}` | `[[2026-07-08]]` |

When the [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes)
plugin manages daily notes, `{{DAILY}}` uses its settings instead.

Good to know:

- The day follows the choice's [Which day](/docs/Choices/TemplateChoice/#date-origin), so picking yesterday captures to yesterday's daily note.
- If the daily note doesn't exist and **Create file if it doesn't exist** is on, a Capture creates it from the daily notes template, filled the way that plugin fills it, not with QuickAdd's format syntax. With Daily notes, `{{date}}` and `{{time}}` are when the note is created and `{{title}}` is its name. With Periodic Notes, `{{date}}` is the note's day, and `{{yesterday}}` and `{{tomorrow}}` work too. Turn on **Create file with a template** to use a QuickAdd template instead.
- `|link` follows your link settings. A daily note that doesn't exist yet is linked by its full path, so following the link creates it in your daily notes folder. In front matter, quote it: `day: "{{DAILY|link}}"`.
- If neither plugin manages daily notes, or the daily note template is missing, the run stops with an error instead of writing somewhere else.

### Weekly, monthly, quarterly, and yearly notes: `{{WEEKLY}}` {#periodic-notes}

_Requires QuickAdd 2.30.0 or later._

`{{WEEKLY}}`, `{{MONTHLY}}`, `{{QUARTERLY}}`, and `{{YEARLY}}` work like
[`{{DAILY}}`](#daily) for the notes the
[Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes) plugin
manages, with that plugin's folder, format, and template for each period.

| You write (on Thursday 1 June 2023, weekly format `gggg.MM.[Wk]w`) | You get |
| --- | --- |
| `{{WEEKLY}}` | `Weekly/2023.05.Wk22` |
| `{{MONTHLY}}` | `Monthly/2023-06` |
| `[[{{QUARTERLY}}]]` or `{{QUARTERLY\|link}}` | A link to `2023-Q2` |

Good to know:

- A note is named from the start of its period, the way Periodic Notes names it. The week of 1 June 2023 starts on 28 May, so it files under May.
- A missing note is created from the period's template with Periodic Notes' placeholders. In weekly notes, `{{sunday:<format>}}` through `{{saturday:<format>}}` give that day of the week. In all periods, `{{date:<format>}}` is the start of the period.
- If Periodic Notes doesn't manage the period, the run stops with an error.
- Periodic Notes 1.0 (beta) isn't supported yet; use the released version, 0.0.17.

### Ask for a date: `{{VDATE:<name>, <format>}}` {#vdate}

`{{VDATE:due,YYYY-MM-DD}}` opens a date prompt and inserts your answer in the
given format. You can type natural language: `today`, `in two weeks`,
`next monday`. Short aliases like `t` (today), `tm` (tomorrow), and `yd`
(yesterday) work too, and are configurable in settings.

The name (`due` above) makes it a variable: enter the date once, use it in as
many places and formats as you like.

```markdown title="You write"
Due: {{VDATE:due,YYYY-MM-DD}}
Week: {{VDATE:due,gggg-[W]WW}}
```

```markdown title="You get (after answering "friday")"
Due: 2026-07-10
Week: 2026-W28
```

:::note[Need the day before or after the date you pick?]
A VDATE format takes no `+N` offset, so `+-1` is printed as-is. Set the
choice's [Which day](/docs/Choices/TemplateChoice/#date-origin) to **Ask each
time** instead. `{{DATE}}` is then the day you pick, and `{{DATE+N}}` counts
from it.

```markdown title="You write"
Yesterday: [[{{DATE:YYYY-MM-DD-ddd+-1}}]]
Tomorrow: [[{{DATE:YYYY-MM-DD-ddd+1}}]]
```

```markdown title="You get (after picking 2026-03-10)"
Yesterday: [[2026-03-09-Mon]]
Tomorrow: [[2026-03-11-Wed]]
```
:::

#### Reuse the date with `{{VALUE:<name>}}` {#vdate-reuse}

_Requires QuickAdd 2.29.0 or later._

`{{VALUE:due}}` after `{{VDATE:due,<format>}}` prints the same date, in that
VDATE's format. It's a short way to repeat a date you already asked for. With
several VDATEs for one name, the first one's format is used.

```markdown title="You write"
- [ ] Throw and trim 📅 {{VDATE:due,YYYY-MM-DD}}
- [ ] Glaze fire 📅 {{VALUE:due}}
```

```markdown title="You get (after answering "friday")"
- [ ] Throw and trim 📅 2026-07-10
- [ ] Glaze fire 📅 2026-07-10
```

A `{{VALUE:due}}` in a template you include with
[`{{TEMPLATE:path}}`](#template) reuses the date the same way (QuickAdd 2.30.0
or later). An include asks its prompts first, so step by step the date prompt
opens when the include needs the date.

A date that a script set, with no VDATE for that name, prints as
`YYYY-MM-DD`. QuickAdd 1.14.0 to 2.28.0 printed the stored value instead, such
as `@date:2026-07-10T10:00:00.000Z`.

:::note
Pipes (`|`) can't be part of a VDATE date format; everything after the first
pipe is read as the default value and flags. For a literal separator, use
bracketed text instead: `{{VDATE:due,[Due ]YYYY-MM-DD}}`.
:::

#### Give the date prompt a default {#vdate-default}

Add `|<default>` after the format. If you submit the prompt empty, the default
is used. Defaults can be natural language too: `{{VDATE:date,YYYY-MM-DD|today}}`,
`{{VDATE:due,YYYY-MM-DD|next monday}}`, `{{VDATE:d,YYYY-MM-DD|+7 days}}`. The
short aliases (`t`, `tm`, `yd`) also work as defaults.

A default combines with the [`optional` flag](#optional-fields) in any order:
`{{VDATE:due,YYYY-MM-DD|tomorrow|optional}}` and
`{{VDATE:due,YYYY-MM-DD|optional|tomorrow}}` are equivalent.

#### Name the date prompt: `|label:` {#vdate-label}

_Requires QuickAdd 2.30.0 or later._

`{{VDATE:due,YYYY-MM-DD|label:When is it due?}}` asks "When is it due?"
instead of "due", in the date prompt and in the
[one-page input form](/docs/Advanced/onePageInputs/). The name is still the
variable, so `{{VALUE:due}}` reuses the answer as before. With several VDATEs
for one name, the first one's label is used.

#### Ask for a time too: `|time` {#vdate-time}

Add `|time` (aliases: `|datetime`, `|type:datetime`) to put a time picker on
the date prompt - made for `Date & time` properties. The calendar gains an
`HH:mm` control, and picking a day keeps the time you set. If you omit the
date format, it defaults to `YYYY-MM-DD HH:mm`.

```markdown
---
start: {{VDATE:start,YYYY-MM-DDTHH:mm|time}}
---
```

Combines with a default and `optional` in any order:
`{{VDATE:meeting,YYYY-MM-DD HH:mm|tomorrow at 3pm|time|optional}}`. Without
`|time`, the picker stays date-only.

## Ask for input

### Ask for text: `{{VALUE}}` {#value}

`{{VALUE}}` opens a prompt and inserts whatever you type. `{{NAME}}` is the
same thing under another name.

```markdown title="You write (capture format)"
- [ ] {{VALUE|label:Task}}
```

```markdown title="You get (after typing "Buy milk")"
- [ ] Buy milk
```

If text is selected in the editor when the choice runs, the selection is used
as the value instead of prompting. For Capture choices you can turn
selection-as-value off, globally or per capture.

:::note[Paste images straight into the prompt]
Prompts whose answer lands in note content accept images. Paste (Ctrl/Cmd+V) a
screenshot or copied image, or drag an image from a file manager. QuickAdd
saves it using Obsidian's attachment settings and inserts an embedded link at
the cursor. You can mix typed text and images, and paste more than one.
Dropped images keep a sanitized original file name. If the drop is already a
vault image, QuickAdd embeds that file instead of copying it.

Clipboard text wins over an image on paste. Image files win on drop because
file managers also provide the filesystem path as text. Turn on **Name pasted
images after the note title** in QuickAdd settings to name a pasted file after
the destination note when that path is known (otherwise the file stays
`Clipboard image YYYY-MM-DD HH.MM.SS`). Dropped files keep their sanitized
original name even when that setting is on. Prompts for file names, folders,
capture targets, and insert-after/before targets never accept images because
an embed link would break the path. Saved attachments are ordinary vault
files. Cancelling the prompt does not delete them.
:::

Good to know:

- **In macros**, `{{VALUE}}` / `{{NAME}}` ask again for each template step. Use a [named value](#named-value) like `{{VALUE:sharedName}}` when one answer should be reused across the whole macro.
- **In `js quickadd` blocks**, don't put `{{VALUE}}` inside JavaScript string literals. Use the QuickAdd API (`this.quickAddApi.inputPrompt(...)`) and `this.variables` instead. See [Inline scripts](/docs/InlineScripts/#execution-order-and-value).
- **From the API**, pass the value programmatically under the reserved variable name `value`.

### Name the answer so you can reuse it: `{{VALUE:<name>}}` {#named-value}

Give the value a name and QuickAdd asks once, then inserts the same answer at
every other place the name appears - even across the steps of a macro.

```markdown title="You write (template)"
---
title: {{VALUE:title}}
---
# {{VALUE:title}}
```

```markdown title="You get (after answering "Project kickoff")"
---
title: Project kickoff
---
# Project kickoff
```

You can create as many named values as you need.

### Offer a list to pick from: `{{VALUE:<option>,<option>}}` {#value-suggest}

Two or more comma-separated options turn the prompt into a searchable picker.

```markdown title="You write"
status: {{VALUE:Backlog,In progress,Done}}
```

```markdown title="You get (after picking)"
status: In progress
```

Need a comma **inside** an option? Wrap the option in double quotes - the
quotes are stripped from the inserted value:

```markdown
{{VALUE:"One choice, with a comma",Second choice}}
```

- Straight (`"`) and curly (`“ ”`) quotes both work, so pasting from a rich-text editor is fine.
- For a literal double quote inside a quoted option, double it: `"say ""hi"""` inserts `say "hi"`.
- Single quotes are never special: `Bob's,Alice's` works unchanged.
- The same quoting works in `|text:` display labels and `|default:` values (e.g. `|default:"a, b"`).
- Pipes (`|`) inside an option are not supported. Whitespace inside quotes is trimmed.

#### Show friendlier labels: `|text:` {#value-text}

Decouple what the picker shows from what gets inserted:

```markdown title="You write"
priority: {{VALUE:🔽,🔼,⏫|text:Low,Normal,High}}
```

You pick "High", QuickAdd inserts `⏫`.

`items` and `text` need the same number of entries, and each label must be
unique. A comma inside an entry needs double quotes (`text:"High, urgent",Low`);
pipes inside an entry are not supported. With [`|custom`](#value-custom), text
you type yourself is inserted as-is.

#### Allow answers outside the list: `|custom` {#value-custom}

`{{VALUE:Red,Green,Blue|custom}}` suggests Red, Green, and Blue but also lets
you type anything else, like "Purple". Useful when you have common options but
want an escape hatch.

Note: `|custom` can't be combined with a [shorthand default](#value-default);
use `|default:` instead.

#### Pick several: `|multi` {#value-multi}

`|multi` turns the picker into a multi-select, and the picks are written as a
YAML list. Requires an option list (2+ comma-separated values).

```markdown title="You write"
---
tags: {{VALUE:work,home,urgent|multi}}
---
```

```yaml title="You get (after picking work and urgent)"
tags:
  - work
  - urgent
```

Variants and combinations:

- `|multi:linklist` wraps each pick as a wikilink, for list properties of links: `{{VALUE:Alice,Bob,Carol|multi:linklist}}` writes `- "[[Alice]]"` / `- "[[Bob]]"`.
- `|multi|custom` adds a text box to the picker for values not in the list.
- Combines with `|name:`, `|label:`, `|text:`, `|optional`, and `|trim`. `|case:` is ignored (a list isn't case-transformed).

Add `|format:` when the output shape should be intentional instead of inferred
from where the placeholder appears:

- `|format:yaml` writes a quoted YAML flow sequence. Obsidian recognizes it as
  a native list, including in capture content inserted into a template:
  `topics: {{VALUE:Alpha,Beta|multi|format:yaml}}` becomes
  `topics: ["Alpha", "Beta"]`.
- `|format:markdown` writes a vertical Markdown bullet list. Put the placeholder
  on its own line: `{{VALUE:Alpha,Beta|multi|format:markdown}}` becomes `- Alpha`
  followed by `- Beta`.
- `|format:inline` always writes the compact comma-separated text form:
  `Alpha,Beta`.
- `|format:spaced` writes the same text with a space after each comma:
  `{{VALUE:option a, option b|multi|format:spaced}}` becomes `option a, option b`.
- `|format:auto` is the default and preserves the context-sensitive behavior
  described below.

Formatting is separate from the selected item representation, so it composes
with `|multi:linklist`, `|text:`, `|custom`, and the other multi-select options.
For example, `|multi:linklist|format:yaml` writes a native YAML list of
wikilinks.

Good to know:

- The picks become a real YAML list **inside front matter**. In a note body they become comma-separated text.
- In a **Capture**, a whole multi-select token with the default `|format:auto` stays a list with [**Write position → Property**](/docs/Choices/CaptureChoice/#property). Into a list property, a multi-select token on its own line adds one item per pick, even next to other lines. `|format:markdown` and `|format:yaml` add no dashes or brackets there, and `|format:inline` or `|format:spaced` joins the picks into one item. Capturing into a brand-new note's frontmatter also produces a list when **Create file if it doesn't exist** is enabled without a template. Captures into an existing note's body write comma-separated text.
- With the [one-page input form](/docs/Advanced/onePageInputs/), avoid commas inside a single option (like `|text:"High, urgent"`) on a `|multi` placeholder - the one-page picker can't round-trip them. The default one-prompt-at-a-time picker handles them correctly.

#### Reuse the pick elsewhere: `|name:` {#value-name}

`|name:` gives a picker a reusable name, so one pick can drive several places.
Define the options once, then reuse the answer anywhere with
`{{VALUE:<name>}}`:

```markdown title="File name"
{{VALUE:Personal,Work,Errand|name:category}} - {{VALUE:title}}
```

```markdown title="In the body"
tags: #{{VALUE:category}}
```

You pick the category once; the file name and the tag both use it.

Good to know:

- Reuse is always `{{VALUE:category}}`. A bare `{{category}}` is **not** QuickAdd syntax and is left untouched (it would collide with Templater and Dataview).
- `|name` combines with the other options: `{{VALUE:🔽,🔼,⏫|name:priority|text:Low,Normal,High|label:Pick a priority}}`.
- Within one field, definition and reuses can appear in any order. Across fields in the default one-prompt-at-a-time flow, define the named picker in the field that is resolved first (the file name comes before the body); a reuse that runs earlier than its definition falls back to a text prompt. The [one-page input form](/docs/Advanced/onePageInputs/) removes this caveat.
- `value` and `title` are reserved and can't be used as names.
- Names match case-insensitively: `{{VALUE:Category}}` reuses a pick named `category`.
- **First definition wins.** If the same `|name` appears twice with different options in one run, the first definition's pick is reused and the second is never shown (a warning is logged to the developer console). Use distinct names for separate prompts.

### Fine-tune any prompt

These options work on text prompts and pickers alike. Combine them freely:
`{{VALUE:title|label:Note title|default:Untitled}}`. Inside a table cell, write
the pipe as `\|`, as in `{{FILE:People\|label:Who?}}`; QuickAdd reads it as `|`.

#### Name the prompt: `|label:` {#value-label}

`{{VALUE:project|label:Which client or project?}}` asks "Which client or
project?" instead of "project", in the prompt and in the
[one-page input form](/docs/Advanced/onePageInputs/). The name is still the
variable, so `{{VALUE:project}}` reuses the answer. On an option list, the
label titles the picker: `{{VALUE:Red,Green,Blue|label:Pick a color}}`.
Without one, the one-page form titles it by its `|name:` or else its options,
such as "Red / Green / Blue". An unnamed `{{VALUE|label:What's the order?}}` also shows its label in the
builder's preview.

Before QuickAdd 2.30.0, a named prompt kept its name as the title and showed
the label as helper text below it. If you wrote a label as an instruction,
such as `|label:Comma-separated names`, reword it as the question you want
asked.

#### Pre-fill a default: `|<default>` {#value-default}

`{{VALUE:name|Anonymous}}` pre-fills the input with `Anonymous` - press Enter
to accept, or edit it.

Good to know:

- Pickers without `|custom` ignore defaults - you have to pick one of the options.
- If the placeholder also uses keyed options (`|label:`, `|default:`, `|type:`, `|case:`), the shorthand form is ignored; write [`|default:Anonymous`](#value-default-option) instead. The bare `|optional` flag is the exception: `{{VALUE:name|Anonymous|optional}}` keeps the shorthand default.
- `optional` is a reserved word, so a literal default of "optional" needs the keyed form: `|default:optional`.

#### The keyed form: `|default:` {#value-default-option}

Same as above, written `{{VALUE:title|default:Untitled}}`. Required whenever
you combine a default with other keyed options like `|label:`.

#### Ask for multiple lines: `|type:multiline` {#value-multiline}

`{{VALUE:summary|type:multiline}}` opens a textarea instead of a single-line
input. Works on single-value prompts only (no option lists or `|custom`), and
overrides the global "Use multi-line input prompt" setting for that
placeholder.

<a id="mixed-mode-example"></a>

Mix single-line and multi-line in one format:

```markdown
- {{VALUE:Title|label:Title}}
{{VALUE:Body|type:multiline|label:Body}}
```

**Keyboard:** submit with **Ctrl/Cmd+Enter**; plain **Enter** adds a newline.
**Tab** inserts a tab character (with a selection, it indents every touched
line), and **Shift+Tab** moves focus out of the field. See
[Controlling Prompts](/docs/ControllingPrompts/#submit-keys) for all prompt
shortcuts.

If `|type:` is present, shorthand defaults like `|Some value` are ignored; use
`|default:`.

#### Match an Obsidian property type: `|type:number`, `|type:slider`, `|type:checkbox`, `|type:text` {#value-property-types}

These give the prompt the right input widget for a property, and write a value
Obsidian reads as the right type:

```markdown
---
rating: {{VALUE:rating|type:number|min:1|max:10}}
confidence: {{VALUE:confidence|type:slider|min:0|max:100|step:5|default:50}}
done: {{VALUE:done|type:checkbox|label:Completed?}}
id: {{VALUE:id|type:text}}
---
```

- `|type:number` shows a numeric input and writes the value unquoted (`rating: 42`), so Obsidian reads a **Number**. Constrain it with `|min:`, `|max:`, and/or `|step:`.
- `|type:slider` shows a slider plus numeric input. `|min:` and `|max:` are required; `|step:` defaults to `1`. If the range is missing or invalid, QuickAdd falls back to the plain numeric input instead of guessing.
- `|type:checkbox` (alias `|type:boolean`) shows a **true / false** picker for checkbox properties. The `|label:` becomes the picker's title, and it writes a real boolean: `done: true`.
- `|type:text` keeps the value a **string** by writing it as a quoted YAML value (`id: "0042"`). Without it, a text property given `0042` is read as the number `42`, `true` becomes a boolean, and values starting with `#` or `[` are mis-parsed entirely.

Good to know:

- Plain numbers and booleans already round-trip without `|type:` - `count: {{VALUE:count}}` answered `42` becomes a Number. The `|type:` options add the right widget and validation, and `|type:text` fixes the cases Obsidian would otherwise mis-read.
- Dates like `2025-12-25` are always kept as text by Obsidian, so they never need `|type:text`.
- `|min:`, `|max:`, and `|step:` are only treated as numeric options together with `|type:number` or `|type:slider`. Without those, they keep their old meaning as ordinary text.

#### Change the casing: `|case:` {#value-case}

Transforms the answer's casing. Styles: `kebab`, `snake`, `camel`, `pascal`,
`title`, `lower`, `upper`, `slug`.

```markdown title="You write"
{{DATE:YYYY-MM-DD}}-{{VALUE:title|case:slug}}.md
```

```markdown title="You get (after answering "My Great Idea!")"
2026-07-08-my-great-idea.md
```

#### Trim stray spaces: `|trim` {#value-trim}

`|trim` removes leading and trailing whitespace from the answer for that one
placeholder - useful in file names, links, and properties where an accidental
space from a mobile keyboard would create a different note.

```markdown
Raw: {{VALUE:title}}
Link: [[{{VALUE:title|trim}}]]
```

Trimming is per placeholder and doesn't change the stored value, so the same
answer can be used raw in one place and trimmed in another. It composes with
other options (`{{VALUE:title|trim|case:slug}}`). For `|multi` values, each
entry is trimmed while the value stays a list. The keyed form `|trim:false`
turns trimming off when a shared snippet adds it.

### Make a prompt skippable: `|optional` {#optional-fields}

`|optional` marks a prompt as fine to leave unanswered: skipping it resolves
to nothing instead of blocking the run. Works on `{{VALUE}}`/`{{NAME}}`,
`{{VALUE:<name>}}`, option lists, `{{VDATE:...}}`, and `{{FILE:...}}`.

```markdown
{{VALUE:reminder|optional}}
{{VDATE:due,YYYY-MM-DD|optional}}
{{VALUE:low,medium,high|optional}}
```

What `optional` changes:

- **Prompts gain a Skip button** (and a hint line). Skipping - or submitting empty - counts as an answer: the placeholder becomes nothing, and you aren't asked again for the same variable later in the run.
- **Empty beats the default.** With a default, the default is pre-filled; clearing it and submitting yields empty. (Required prompts keep the old behavior: empty falls back to the default.)
- **Optional dates accept a blank** instead of failing the run. A typo like "tomorow" still errors - only blank means "leave empty".
- **Option lists** show a skip shortcut in the footer (Ctrl/Cmd+Shift+Enter) instead of forcing a pick.
- **The one-page input form** shows an "(optional)" badge; optional dropdowns get a "Skip (leave empty)" entry.
- **Esc still cancels the whole run** - skipping is an answer, cancelling is not.

:::tip[Make decoration disappear with the answer]
Put literal text inside the date format using square brackets:

```markdown
- [ ] {{VALUE}} {{VDATE:due,[📅 ]YYYY-MM-DD|optional}}
```

An answered date renders `📅 2026-06-14`; a skipped date renders nothing at
all - the emoji vanishes with it. Works for prefixes like `[Due: ]YYYY-MM-DD`
too.
:::

Good to know:

- The keyed form `|optional:false` turns the flag off explicitly (useful when a shared snippet adds it).
- The flag sits happily next to a shorthand default: `{{VALUE:reminder|call mom|optional}}`. Because `optional` is reserved, a literal default of "optional" needs `{{VALUE:x|default:optional}}`.
- **Scripting:** setting a variable to the empty string (`params.variables.myVar = ""`) counts as "answered, empty" for every placeholder type, including `{{VDATE}}` - it renders empty instead of prompting. To force a prompt, leave the variable unset (or `delete` it / set it to `undefined`). The old workaround of assigning a single space still works but is no longer needed.

## The note you ran QuickAdd from

These placeholders read from the **active note** - the one that was focused
when you triggered QuickAdd.

### A link to the note: `{{LINKCURRENT}}` {#linkcurrent}

Inserts a link to the active note, in `[[link]]` format.

```markdown title="You write"
Source: {{LINKCURRENT}}
```

```markdown title="You get"
Source: [[Meeting with Alice]]
```

When the append-link setting is **Enabled (skip if unavailable)**, this
placeholder becomes empty instead of erroring when no note is focused.

### A link to the current section: `{{LINKSECTION}}` {#linksection}

Like `{{LINKCURRENT}}`, but links to the **heading your cursor is under**, in
`[[Note#Heading]]` format - clicking the link jumps to that section instead of
the top of the file.

It picks the nearest heading at or above the cursor. With the cursor above the
first heading (or in a file without headings), it falls back to a plain
whole-file link. When a heading's text repeats in the file, it uses the
disambiguating ancestor path (`[[Note#Parent#Heading]]`); if even that isn't
unique, it falls back to a whole-file link rather than linking to the wrong
section. Honors the same required/optional behavior as `{{LINKCURRENT}}`.

### The note's file name: `{{FILENAMECURRENT}}` {#filenamecurrent}

The active note's file name, without the extension: `Notes from
{{FILENAMECURRENT}}`. Honors the same required/optional behavior as
`{{LINKCURRENT}}` - when optional and no note is active, it becomes empty.

In a Template [File name](/docs/Choices/TemplateChoice/#optional),
`{{FILENAMECURRENT}}/{{VALUE}}` creates the new note under a folder named after
the active note.

### The note's folder: `{{FOLDERCURRENT}}` {#foldercurrent}

The active note's folder, as a vault-relative path with no trailing slash
(`Projects/Alpha`). For a note at the vault root it becomes empty. Not to be
confused with [`{{FOLDER}}`](#folder), which is the folder a *new* note is
being created in.

This makes per-project captures work without a macro. With **Capture to** set
to:

```text
{{FOLDERCURRENT}}/Project Tasks.md
```

running the capture from any note inside `Projects/Alpha` targets
`Projects/Alpha/Project Tasks.md`, from `Projects/Beta` it targets
`Projects/Beta/Project Tasks.md`, and so on. A trailing slash
(`{{FOLDERCURRENT}}/`) instead opens a file picker confined to that folder.

Works in capture targets, file name formats, note bodies and capture formats,
and Template choice folder paths (like `{{FOLDERCURRENT}}/Subnotes`).

**No active note:** in paths (capture targets, file names, folder paths) a
missing active note always stops the run with a clear error - it never falls
back to the vault root. In note bodies it honors the same required/optional
behavior as `{{LINKCURRENT}}`.

<a id="foldercurrentname---just-the-folder-name"></a>

#### Just the folder's name: `{{FOLDERCURRENT|name}}` {#foldercurrent-name}

`|name` keeps only the last path segment: for a note in `Projects/Acme`,
`{{FOLDERCURRENT}}` is `Projects/Acme` while `{{FOLDERCURRENT|name}}` is
`Acme`. Use it when you want the folder's name in a file name or sentence
rather than a path: `Tasks for {{FOLDERCURRENT|name}}`.

### The selected text: `{{SELECTED}}` {#selected}

Whatever text is selected in the editor, or empty when nothing is: `>
{{SELECTED}}`.

## The note being created

### The new note's folder: `{{FOLDER}}` {#folder}

The folder the note is being created in, as a vault-relative path with no
trailing slash. For a note created at the vault root it becomes empty. (For
the *active* note's folder, use [`{{FOLDERCURRENT}}`](#foldercurrent).)

Where it has a value:

- **Template choices** - in the file name format (the folder is resolved before the name is built) and in the template body.
- **Capture** - in the capture body, where it becomes the destination file's folder.
- **Apply template to a note** - the target note's folder.

Where it stays empty: the capture **Capture to** field (that field is what
*chooses* the folder, so there is nothing to reference yet), the `format`
JavaScript API, and macro file-path commands.

<a id="foldername--just-the-folder-name"></a>

#### Just the folder's name: `{{FOLDER|name}}` {#folder-name}

`|name` keeps only the last path segment: for a target folder `Projects/Acme`,
`{{FOLDER}}` is `Projects/Acme` while `{{FOLDER|name}}` is `Acme`. Use it to
put the folder's name *into* a file name: `{{FOLDER|name}} - {{VALUE}}`.

:::note
In a Template file name format, prefixing the full path (like
`{{FOLDER}}/{{VALUE}}`) is redundant - the note is already placed in the
target folder, so the leading path is stripped. Use `{{FOLDER|name}}` instead.
:::

### The new note's title: `{{TITLE}}` {#title}

The final file name (without extension) of the note being created or captured
to. Handy as the note's top heading:

```markdown
# {{TITLE}}
```

## Pull data from your vault

### Suggest values a property already has: `{{FIELD:<field name>}}` {#field}

`{{FIELD:project}}` scans your vault for every value the `project` property
has anywhere, and offers them as suggestions. If no values exist, you are
prompted to type one.

```markdown title="You write"
project: {{FIELD:project}}
```

You get a picker listing every project name already used in your vault - no
more typos creating a second "Websiet Redesign" project.

#### Pick several: `|multi` {#field-multi}

`{{FIELD:topic|multi}}` turns the suggestions into a multi-select. Pick
several existing values, or add new ones in the picker.

```markdown title="You write"
---
topics: {{FIELD:topic|multi}}
---
```

```yaml title="You get (after picking Alpha and Beta)"
topics:
  - Alpha
  - Beta
```

Inside front matter, `|multi` writes a real YAML list when the placeholder is
the property's whole value. With the default `|format:auto`, it also stays a
list when the entire Capture format is the token and
[**Write position → Property**](/docs/Choices/CaptureChoice/#property) is selected.
In note bodies, file names, and other text
positions it writes comma-separated text. Combines with the same filters and
defaults as single-value FIELD prompts:
`{{FIELD:topic|multi|folder:Projects|tag:active|default:Inbox}}`.

FIELD multi-selects support the same explicit output formats as VALUE:
`|format:yaml`, `|format:markdown`, `|format:inline`, `|format:spaced`,
and `|format:auto`.
For example, `topics: {{FIELD:topic|multi|format:yaml}}` always writes a native
YAML list, including in template-backed captures.

:::note
The one-page input form doesn't inline FIELD multi-selects yet: vault values
can contain commas, and the one-page multi input uses commas as separators.
When a format contains `{{FIELD:...|multi}}`, QuickAdd collects the other
one-page inputs first, then opens the regular multi-select for the FIELD
value.
:::

#### Label the prompt: `|label:` {#field-label}

_Requires QuickAdd 2.28.0 or later._

`{{FIELD:client|label:Which client?}}` asks "Which client?" instead of
"Enter value for client". The label replaces that wording wherever the prompt
appears: the picker's placeholder, the title of the text prompt you get when
the property has no values yet, and the field's name in the
[one-page input form](/docs/Advanced/onePageInputs/).

```markdown title="You write"
---
client: {{FIELD:client|label:Which client?}}
contact: {{FIELD:contact|label:Who did you talk to?}}
---
```

FIELD placeholders share one answer only when they match exactly, label
included. To ask twice from the same property, give each placeholder its own
label: `{{FIELD:person|label:Host}}` and `{{FIELD:person|label:Note taker}}`.
To ask once, write the same label (or none) everywhere.

#### Default to the active note's value: `|default-from:active` {#field-default-from-active}

`{{FIELD:project|default-from:active}}` pre-fills the prompt with the value
the **active note** already has for that property. This is metadata
inheritance: trigger a capture from a project note, and the new content
carries the project over as the default - accept it, pick another suggestion,
or type something else.

Active note:

```yaml
---
project: The Great Endeavor
---
```

Format:

```md
project: {{FIELD:project|default-from:active}}
```

The `project` prompt defaults to `The Great Endeavor`. The active note is
captured when the run starts, before any QuickAdd window can move focus.

Behavior:

- The suggestion list still comes from your whole vault (honoring `folder:`/`tag:`/`exclude-*`/`inline` filters); the active note's value is promoted to the top as the default and pre-filled in the one-page form. It is promoted even if it already exists in the suggestions.
- If no Markdown note is active, the note lacks the property, or the value is empty, you get a normal `{{FIELD:...}}` prompt with no default.
- Plain string/number/boolean values are used as-is. A YAML **list** value applies only to `|multi` prompts, where each item is pre-checked in the picker; single-select prompts skip list values. Objects and null are never used.
- The property name matches case-insensitively: `{{FIELD:Project|default-from:active}}` still reads a `project` property.
- This differs from `|default:` (a literal value), and is deliberately not spelled `|default:current` - that would clash with "current" as a real field value.

Combine with `|multi` to inherit a list property:

```md
topics: {{FIELD:topics|multi|default-from:active}}
```

#### Filter where suggestions come from {#field-filters}

| You write | Suggestions come from |
| --- | --- |
| `{{FIELD:status\|folder:projects}}` | Only files in `projects` |
| `{{FIELD:status\|folder:goals\|folder:projects}}` | Files in either folder |
| `{{FIELD:status\|tag:work}}` | Only files with `#work` |
| `{{FIELD:status\|tag:active\|tag:project}}` | Files with **both** tags |
| `{{FIELD:status\|exclude-folder:templates}}` | Everything except that folder |
| `{{FIELD:status\|exclude-tag:deprecated}}` | Everything except files with that tag |
| `{{FIELD:status\|exclude-file:example.md}}` | Everything except that file |
| `{{FIELD:id\|inline:true}}` | Also Dataview inline fields (`id:: value`) |
| `{{FIELD:id\|inline:true\|inline-code-blocks:ad-note}}` | Also inline fields inside those fenced code blocks (opt-in) |

Repeated `folder:` filters are OR (either folder). Repeated `tag:` filters are
AND (all tags). Exclusions remove any matching file. Filters combine freely:

```markdown
{{FIELD:status|folder:goals|folder:projects|tag:work|exclude-folder:templates}}
```

Defaults work here too:

- `{{FIELD:status|default:To Do}}` - put a default at the top of the suggestions; Enter accepts it.
- `{{FIELD:status|default:Draft|default-empty:true}}` - only add the default when no values were found.
- `{{FIELD:status|default:Draft|default-always:true}}` - keep the default first even when other suggestions exist.
- `{{FIELD:project|default-from:active}}` - default to the active note's value ([above](#field-default-from-active)).

:::caution[Beta]
FIELD filtering is in beta and the syntax can change - leave your thoughts
[on issue #1429](https://github.com/chhoumann/quickadd/issues/1429).
:::

### Cursor position: `{{CURSOR}}` {#cursor}

In a Template or Capture body, `{{CURSOR}}` marks where you want to continue typing.

```md
### {{DATE:DD-MMM-YYYY}}
- {{CURSOR}}
```

For complete setups, see
[meeting notes and project updates](/docs/Examples/Template_MeetingNotes/).

QuickAdd removes the marker and places the cursor there when the target note
is already focused in an editing mode, or when **Open** opens and focuses it.
The marker never opens a note by itself, switches out of Reading view, or
focuses a background pane.

It works when creating a Markdown note from a Template, overwriting an existing
note, or adding the template at the top or bottom. It also works in all
[Apply Template to Note](/docs/ApplyTemplateToNote/) modes, Capture's **At cursor**
and **New line above/below cursor**, and included `{{TEMPLATE:...}}` content.

The first marker in the note body sets the position. Additional markers in the
inserted content are removed. Spelling is case-insensitive. Insert and append
operations leave literal markers already in the destination note alone;
replacing the note replaces its old content.

A Template containing only markers can create an empty note. A Capture containing
only markers and whitespace does nothing. If Templater needs a new target note
before it produces an empty Capture, QuickAdd keeps that created note and skips
insertion and cursor placement.

Templater's cursor jump takes precedence. In Templates, QuickAdd finds the marker
after Templater finishes rendering, including content from `tp.file.include`.
QuickAdd preserves the position through frontmatter merges and links inserted
into the active note's body. Placement is skipped when a concurrent edit makes
the position unreliable. Capture also skips placement after a whole-file
Templater rewrite, a property update, or a link written through a specified
destination file.
The marker is still removed. Without a marker, cursor behavior stays unchanged.

In property Captures, Canvas and Base content, file names, folder paths, line
targets, and generic format API calls, the token is removed without moving the cursor.

### The property's current value: `{{PROPERTY}}` {#property}

In a [property Capture](/docs/Choices/CaptureChoice/#property), `{{PROPERTY}}`
is the value the property already has on the target note. Put it where that
value should appear.

```text title="New item above the existing ones"
work
{{PROPERTY}}
```

```text title="New item below the existing ones"
{{PROPERTY}}
work
```

```text title="Keep the current text and add to it"
{{PROPERTY}} → Ready
```

A list becomes one item per line. Text, numbers, and checkboxes become text. A
missing or empty property becomes nothing. If an existing list item already
contains a line break, QuickAdd stops with an error. Rewrite that list from an
inline script instead.

The token works only in a property Capture. Anywhere else, QuickAdd stops with
an error.

`{{PROPERTY}}` is not [`{{FIELD:...}}`](#field). `FIELD` suggests values from
across your vault and may ask you to pick one. `PROPERTY` is the value already
on this note.

Inline scripts read the same value through
[Property Capture variables](/docs/InlineScripts/#property-capture-variables).

### Pick a note from a folder: `{{FILE:<folder>}}` {#file}

`{{FILE:People}}` opens a picker listing the Markdown files in your `People`
folder and inserts your pick. Where [`{{FIELD}}`](#field) suggests the
*values* of a property, `{{FILE}}` suggests the notes themselves - made for
"metadata folders" like `People/` or `Research Topics/` where every note is an
option. Because the options are real files, the list always reflects what
currently exists.

The picker shows a note's file name. When the file name is an ID, the note
shows its first level-1 heading instead. An ID is an unbroken timestamp of 12
or more digits, such as `202610061432`, a UUID, or a ULID. A date such as
`2026-10-06` is not an ID, so a daily note shows its file name. A frontmatter
`title` wins for every note. The picker always inserts the actual file, so
friendly labels never change what you get.

You can also find a note by its `aliases`: the row shows the alias with the
note's name beneath it, and still inserts the note (QuickAdd 2.30.0 or later).

Output modes:

| You write | You get |
| --- | --- |
| `{{FILE:People}}` | The file name: `Tom` |
| `{{FILE:People\|link}}` | A resolved wikilink: `[[Tom]]` |
| `{{FILE:People\|path}}` | The vault path: `People/Tom.md` |
| `{{FILE:People\|multi}}` | Several picks |

`|link` follows your link settings (wikilink vs Markdown, shortest path). In a
capture it resolves relative to the capture target; in a template it resolves
like `{{LINKCURRENT}}`. Don't wrap it in `[[ ]]` yourself - you'd get
`[[[[Tom]]]]`.

Example - link a research topic in a frontmatter list (quote it so the YAML
stays valid):

```yaml
research-topics:
  - "{{FILE:Research Topics|link}}"
```

Options:

- `|optional` - allow skipping the pick (becomes nothing).
- `|custom` - also allow typing a value that isn't in the folder.
- `|multi` - pick several files. In frontmatter property positions, including a whole-token [property capture](/docs/Choices/CaptureChoice/#property), QuickAdd writes a YAML list. In note bodies, file names, and other text positions it writes comma-separated text. Combine with `|link` or `|path` to write links or paths for every pick.
- `|type:image` - pick images instead of notes. See [Pick attachments](#file-type).
- `|label:Pick a person` - set the picker's placeholder text.
- `|name:<id>` - share one pick between placeholders. FILE placeholders are cached by their full definition: placeholders that differ (folder, filters, mode, or `|label:`) prompt independently, while identical ones reuse one pick. To pick **two different** people, give the placeholders different labels (`{{FILE:People|label:Author}}` and `{{FILE:People|label:Reviewer}}`). To reuse **the same** pick - say, a name in one place and a link in another - give them the same `|name:`. Placeholders sharing an id should target the same folder and filters; the shared pick is required if *any* occurrence omits `|optional`.
- Filters reuse the FIELD syntax: `|tag:`, `|exclude-folder:`, `|exclude-tag:`, `|exclude-file:` (each repeatable).

Good to know:

- The folder is the first part of the placeholder. A `|folder:` option is FIELD syntax and is ignored here.
- The folder matches **recursively** (subfolders included). Point at a leaf folder (like `{{FILE:fields/people}}`) to scope tightly.
- Repeated `|tag:` filters are AND filters. Exclusions remove any matching file.
- Markdown notes only, unless you add `|type:`.
- `|link` and `|path` insert characters that aren't valid in file names; in the **file name** field, use the default mode.
- In a one-page input form, single and multi FILE pickers appear inline. Search matches the friendly title, file name, and full path. Selected files remain exact path-backed values internally, so commas in file names or labels are safe. A required single picker starts empty, and the form waits for a file before it submits (QuickAdd 2.30.0 or later).

FILE multi-selects support `|format:yaml`, `|format:markdown`,
`|format:inline`, `|format:spaced`, and `|format:auto`. The format composes with `|link` and
`|path`, so `{{FILE:People|multi|link|format:yaml}}` writes a native YAML list
of links without relying on the capture context.

#### Pick attachments: `|type:` {#file-type}

_Requires QuickAdd 2.28.0 or later._

Add `|type:` to pick images, PDFs, and other attachments instead of notes. Put
`!` in front of a link to embed the file:

```markdown
!{{FILE:Attachments|type:image|link}}
```

| Type | Picks |
| --- | --- |
| `image` | avif, bmp, gif, jpeg, jpg, png, svg, webp |
| `audio` | 3gp, flac, m4a, mp3, ogg, wav, webm |
| `video` | mkv, mov, mp4, ogv, webm |
| `pdf` | pdf |
| `note` | md |
| `any` | Every file |

Any other value is a file extension, so `|type:canvas` picks canvases. Combine
types with commas: `|type:image,pdf`. The default mode inserts the file name
with its extension (`photo.png`). `|tag:` only matches notes, since attachments
have no tags.

## Insert other content

### Your clipboard: `{{CLIPBOARD}}` {#clipboard}

Inserts the current clipboard content: `Copied: {{CLIPBOARD}}`. Becomes empty
if clipboard access fails due to permissions or security restrictions.

In Capture content, if the clipboard has no text but holds a supported image,
QuickAdd saves the image using Obsidian's attachment settings and inserts an
embedded link. Text wins when both are present. You can also paste or drop an image
straight into a [value prompt](#value) while typing. No placeholder needed.
The **Name pasted images after the note title** setting names pasted files
after the destination note when QuickAdd already knows that path.

### A template file: `{{TEMPLATE:<path>}}` {#template}

`{{TEMPLATE:Templates/Meeting.md}}` inserts that file's contents. Templater
syntax inside the file is supported.

In Capture choices this can be the entire capture format: keep the full
capture body in a template file and set the format to
`{{TEMPLATE:Templates/Capture Format.md}}`. QuickAdd inserts the file and then
runs the usual formatting passes on the result.

### A macro's result: `{{MACRO:<macro name>}}` {#macro}

`{{MACRO:Generate summary}}` runs that macro and inserts its return value.

#### Label the macro's prompt: `|label:` {#macro-label}

When the macro asks you to choose an export from a script,
`{{MACRO:Choose project|label:Project}}` shows "Project" as the placeholder -
helpful when several macro calls show similar lists.

### A snippet from settings: `{{GLOBAL_VAR:<name>}}` {#global-var}

Inserts the value of a [global variable](/docs/GlobalVariables/) defined in
QuickAdd settings: `{{GLOBAL_VAR:Meeting Header}}`. Snippets can contain other
placeholders (like `{{VALUE:...}}` or `{{VDATE:...}}`), which are processed as
usual. The `GLOBAL_VAR` keyword is case-insensitive; the snippet name must
match exactly as you defined it.

### A math formula: `{{MVALUE}}` {#mvalue}

Opens a math prompt for writing LaTeX, with a live preview. Submit with
Ctrl/Cmd+Enter: `Equation: ${{MVALUE}}$`.

The math prompt only suggests LaTeX commands, so `#` tag and `[[` link search
don't work there. For multi-line plain text, use
[`|type:multiline`](#value-multiline) instead:

```markdown
- {{TIME}} {{VALUE|type:multiline}}
```

### A random ID: `{{RANDOM:<length>}}` {#random}

Generates a random alphanumeric string of the given length (1-100). Useful for
unique identifiers, like block references: `^{{RANDOM:6}}`.
