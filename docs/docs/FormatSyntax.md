---
title: Format syntax
---

## `{{DATE}}` {#date}

Outputs the current date in `YYYY-MM-DD` format. You could write `{{DATE+3}}` to offset the date with 3 days. You can use `+-3` to offset with `-3` days.

Example: `Daily/{{DATE}}.md` or `Review on {{DATE+7}}`.

## `{{DATE:<DATEFORMAT>}}` {#date-format}

Replace `<DATEFORMAT>` with a [Moment.js date format](https://momentjs.com/docs/#/displaying/format/). You could write `{{DATE<DATEFORMAT>+3}}` to offset the date with 3 days.

Example: `{{DATE:YYYY-MM-DD_HH-mm}}` or `{{DATE:YYYY-MM-DD+3}}`.

## `{{DATE:<DATEFORMAT>|startof:<unit>}}` / `{{...|endof:<unit>}}` {#date-snap}

Snap the date to the **start** or **end** of a period before formatting. The
formatted output then reflects that boundary instead of the exact instant — so,
for example, the month of a week-snapped date is the month the *week* belongs to,
not today's calendar month.

`<unit>` is one of: `year`, `quarter`, `month`, `week`, `isoweek`, `day` (case-insensitive).

- `week` uses your locale's first day of the week (matching the `w`/`ww`/`gggg` tokens).
- `isoweek` uses Monday (matching the `W`/`WW`/`GGGG` tokens).

| Token (on Thursday 2023-06-01) | Output |
| --- | --- |
| `{{DATE:gggg.MM.[Wk]w\|startof:week}}` | `2023.05.Wk22` |
| `{{DATE:YYYY-MM\|startof:month}}` | `2023-06` |
| `{{DATE:YYYY-MM-DD\|endof:month}}` | `2023-06-30` |
| `{{DATE:YYYY-[Q]Q\|startof:quarter}}` | `2023-Q2` |
| `{{DATE:GGGG-[W]WW\|startof:isoweek}}` | ISO week, Monday-anchored |

**Weekly notes that cross months (issue #511).** A planner named `gggg.MM.[Wk]w`
should file the week of June 1 under May (`2023.05.Wk22`), while the in-note
heading still uses the actual day. Snap only the filename:

```markdown
# filename
{{DATE:gggg.MM.[Wk]w|startof:week}}
# heading inside the note
{{DATE:M.DD dddd}}
```

This also works on `{{VDATE}}` — a single picked date can be week-snapped in one
place and day-actual in another: `{{VDATE:d,gggg.MM.[Wk]w|startof:week}}` and
`{{VDATE:d,M.DD dddd}}` share the same prompt. Combine freely with `|default`,
`|optional`, and `|time` in any order.

**Notes:**

- The `+N` day offset is applied **before** the snap, so `{{DATE:YYYY-MM-DD+7|startof:week}}` is "the start of next week".
- `endof:` snaps to the last moment of the period (`23:59:59.999`), so with a time format `{{DATE:YYYY-MM-DD HH:mm|endof:day}}` renders `... 23:59`.
- `|startof:` and `|endof:` are the only reserved pipe options in a date format; any other literal `|` is still rendered verbatim (e.g. `{{DATE:YYYY|MM}}` → `2023|06`).
- An unknown unit (e.g. `|startof:fortnight`) reports an error listing the valid units.

## `{{VDATE:<variable name>, <date format>}}` {#vdate}

You'll get prompted to enter a date and it'll be parsed to the given date format. You could write 'today' or 'in two weeks' and it'll give you the date for that. Short aliases like `t` (today), `tm` (tomorrow), and `yd` (yesterday) are also supported and configurable in settings. Works like variables, so you can use the date in multiple places with different formats - enter once, format many times!

Example:

```markdown
Due: {{VDATE:due,YYYY-MM-DD}}
Week: {{VDATE:due,gggg-[W]WW}}
```

## `{{VDATE:<variable name>, <date format>|<default>}}` {#vdate-default}

Same as above, but with a default value. If you leave the prompt empty, the default value will be used instead. Example: `{{VDATE:date,YYYY-MM-DD|today}}` will use "today" if no input is provided. Default values can be any natural language date like "tomorrow", "next monday", "+7 days", etc. Short aliases like `t`, `tm`, and `yd` work here too.

Example: `{{VDATE:due,YYYY-MM-DD|next monday}}`.

You can combine a default with the `optional` flag in any order: `{{VDATE:due,YYYY-MM-DD|tomorrow|optional}}` and `{{VDATE:due,YYYY-MM-DD|optional|tomorrow}}` are equivalent. See [Optional fields](#optional-fields).

**Note:** Pipe characters (`|`) cannot be used inside VDATE date formats — everything after the first pipe is treated as the default value (and flags). Use a different literal, e.g. wrap text in square brackets: `{{VDATE:due,[Due ]YYYY-MM-DD}}`.

## `{{VDATE:<variable name>, <date format>|time}}` {#vdate-time}

Adds a **time picker** to the date prompt (aliases: `|datetime`, `|type:datetime`), for `Date & time` properties. The calendar gains an `HH:mm` control, and picking a day keeps the time you set (it isn't reset to midnight). If you omit the date format, it defaults to `YYYY-MM-DD HH:mm`.

```markdown
---
start: {{VDATE:start,YYYY-MM-DDTHH:mm|time}}
---
```

Combines with a default and `optional` in any order: `{{VDATE:meeting,YYYY-MM-DD HH:mm|tomorrow at 3pm|time|optional}}`. Without `|time`, the picker stays date-only and behaves exactly as before.

## `{{VALUE}}` / `{{NAME}}` {#value}

Interchangeable. Represents the value given in an input prompt. If text is selected in the current editor, it will be used as the value. For Capture choices, selection-as-value can be disabled globally or per-capture. When using the QuickAdd API, this can be passed programmatically using the reserved variable name 'value'.

**Image paste:** value prompts whose answer lands in note content accept a clipboard image. Paste (Ctrl/Cmd+V) a screenshot or a copied image into the prompt: QuickAdd saves it using Obsidian's attachment location settings and inserts an embedded attachment link at the cursor - you can mix typed text and pasted images in one value, and paste more than one image. Clipboard text always takes precedence over an image (copying a FILE from a file manager usually pastes its path as text). Prompts for file names, folders, capture targets, and insert-after/before targets never accept image paste, since an embed link would break the path. Pasted attachments are ordinary vault files; cancelling the prompt afterwards does not delete them.

**Inline script note:** For `js quickadd` blocks, prefer the QuickAdd API (`this.quickAddApi.inputPrompt(...)`) and `this.variables` for transformation flows. Do not rely on `{{VALUE}}` inside JavaScript string literals. See [Inline scripts](./InlineScripts.md#execution-order-and-value).

**Macro note:** `{{VALUE}}` / `{{NAME}}` are scoped per template step, so each template in a macro prompts independently. Use `{{VALUE:sharedName}}` when you want one prompt reused across the macro.

Example: `- [ ] {{VALUE|label:Task}}`.

## `{{VALUE:<variable name>}}` {#named-value}

You can now use variable names in values. They'll get saved and inserted just like values, but the difference is that you can have as many of them as you want. Use comma separation to get a suggester rather than a prompt.

**Commas inside an option:** wrap an option in double quotes to include a literal comma in it. The quotes are stripped from the inserted value.

```markdown
{{VALUE:"This is a single choice, with a comma",Second choice}}
```

This shows two options: `This is a single choice, with a comma` and `Second choice`. Notes:

- Both straight (`"`) and curly (`“ ”`) double quotes work, so pasting from a rich-text editor is fine.
- To include a literal double quote inside a quoted option, double it: `"say ""hi"""` inserts `say "hi"`.
- Single quotes/apostrophes are never special, so `Bob's,Alice's` keeps working unchanged.
- The same quoting applies to `|text:` display labels and to `|default:` (e.g. `|default:"a, b"`).
- Pipes (`|`) inside an option are still not supported; whitespace inside quotes is trimmed.

If the same variable name appears in multiple macro steps, QuickAdd prompts once and reuses the value.

Example:

```markdown
---
title: {{VALUE:title}}
---
# {{VALUE:title}}
```

## `{{VALUE:<variable name>|label:<helper text>}}` {#value-label}

Adds helper text to the prompt for a single-value input. The helper appears below the header and is useful for reminders or instructions. For multi-value lists, use the same syntax to label the suggester (e.g., `{{VALUE:Red,Green,Blue|label:Pick a color}}`).

Example: `{{VALUE:project|label:Client or project name}}`.

## `{{VALUE:<items>|text:<display items>}}` {#value-text}

For option lists, decouples what is shown in the suggester from what is inserted. `items` and `text` must have the same number of comma-separated entries, and each `text` entry must be unique. To put a comma inside one `items` or `text` entry, wrap that entry in double quotes (e.g. `text:"High, urgent",Low`). If you also use `|custom`, typed custom text is inserted as-is.

Example: `priority: {{VALUE:🔽,🔼,⏫|text:Low,Normal,High}}`.

## `{{VALUE:<variable name>|<default>}}` {#value-default}

Same as above, but with a default value. For single-value prompts (e.g., `{{VALUE:name|Anonymous}}`), the default is pre-populated in the input field - press Enter to accept or clear/edit it. For multi-value suggesters without `|custom`, you must select one of the provided options (no default applies). If you combine keyed options like `|label:`, `|default:`, `|type:`, or `|case:`, shorthand defaults like `|Anonymous` are ignored; use `|default:Anonymous` instead. The bare `|optional` flag is the exception: `{{VALUE:name|Anonymous|optional}}` keeps the shorthand default. Because `optional` is now a reserved flag word, a literal default of "optional" needs the keyed form: `|default:optional`.

Example: `status: {{VALUE:status|Draft}}`.

## `{{VALUE:<variable name>|default:<value>}}` {#value-default-option}

Option-form default value, required when combining with other options like `|label:`.

Example: `{{VALUE:title|label:Note title|default:Untitled}}`.

## `{{VALUE|type:multiline}}` / `{{VALUE:<variable>|type:multiline}}` {#value-multiline}

Forces a multi-line input prompt/textarea for that VALUE token. Only supported for single-value prompts (no comma options / `|custom`). Overrides the global "Use Multi-line Input Prompt" setting. If `|type:` is present, shorthand defaults like `|Some value` are ignored; use `|default:` instead.

Example:

```markdown
## Summary
{{VALUE:summary|type:multiline|label:Summary}}
```

**Keyboard:** Submit the multi-line prompt with **Ctrl/Cmd+Enter** - plain **Enter** inserts a newline. Pressing **Tab** inserts a tab character at the cursor (handy for nested Markdown lists) instead of moving focus; with text selected, Tab indents every line the selection touches. **Shift+Tab** is left unbound, so it still moves focus out of the field. See [Controlling Prompts](./ControllingPrompts.md#submit-keys) for all prompt shortcuts.

## `{{VALUE:<variable>|type:number}}` / `|type:slider` / `|type:checkbox` / `|type:text` {#value-property-types}

Tailors the input to an Obsidian property type. These are single-value prompts (no comma options / `|custom`):

- `|type:number` shows a numeric input. The value is written unquoted (`rating: 42`), so Obsidian reads it as a **Number**. Add `|min:`, `|max:`, and/or `|step:` to constrain the input.
- `|type:slider` shows a bounded number picker with a slider and numeric input. `|min:` and `|max:` are required; `|step:` defaults to `1`. If the slider range is missing or invalid, QuickAdd falls back to the numeric input instead of guessing a range.
- `|type:checkbox` (alias `|type:boolean`) shows a forced **true / false** picker — useful for a `checkbox` property. The `|label:` becomes the picker's title so you know which property you're setting. Writes `done: true` (a boolean).
- `|type:text` keeps the value a **string**. It writes the value as a quoted YAML scalar (`id: "0042"`), so Obsidian can't retype it — without it, a text property given `0042` is read as the number `42`, `true` as a boolean, and a value like `#todo` or `[a]` is mis-parsed entirely.

```markdown
---
rating: {{VALUE:rating|type:number|min:1|max:10}}
confidence: {{VALUE:confidence|type:slider|min:0|max:100|step:5|default:50}}
done: {{VALUE:done|type:checkbox|label:Completed?}}
id: {{VALUE:id|type:text}}
---
```

`|min:`, `|max:`, and `|step:` are only parsed as numeric options when the token also uses `|type:number` or `|type:slider`. Without a numeric type, they remain ordinary text/default syntax for backwards compatibility.

**Good to know:** plain number and checkbox values already round-trip correctly without `|type:` — `count: {{VALUE:count}}` typed `42` becomes a Number, and `{{VALUE:true,false}}` becomes a Boolean. The `|type:` options add the right input widget and validation, `|type:slider` gives bounded numeric range ergonomics, and `|type:text` closes the cases Obsidian gets "wrong" (a text value that looks like a number/boolean, or one that starts with a YAML character like `#` or `[`). Dates like `2025-12-25` are always kept as text by Obsidian, so they never need `|type:text`.

## `{{VALUE|case:<style>}}` / `{{NAME|case:<style>}}` / `{{VALUE:<variable>|case:<style>}}` {#value-case}

Transforms the resolved value into a casing style. Supported: `kebab`, `snake`, `camel`, `pascal`, `title`, `lower`, `upper`, `slug`.

Example: `{{DATE:YYYY-MM-DD}}-{{VALUE:title|case:slug}}.md`.

## `{{VALUE|trim}}` / `{{NAME|trim}}` / `{{VALUE:<variable>|trim}}` {#value-trim}

Trims leading and trailing whitespace from the resolved value for this token. This is useful for file names, links, and properties where accidental spaces from mobile keyboards or pasted text would create a different note or link target.

Example: `[[{{VALUE:title|trim}}]]`.

`|trim` is applied per token and does not mutate the stored value. This means you can reuse the same answer in raw and trimmed forms:

```markdown
Raw: {{VALUE:title}}
Link: [[{{VALUE:title|trim}}]]
```

It composes with other VALUE options, for example `{{VALUE:title|trim|case:slug}}`. For `|multi` values, string entries are trimmed while the value stays a List. The keyed form `|trim:false` turns trimming off when a shared snippet adds it.

## `{{VALUE:<options>|custom}}` {#value-custom}

Allows you to type custom values in addition to selecting from the provided options. Example: `{{VALUE:Red,Green,Blue|custom}}` will suggest Red, Green, and Blue, but also allows you to type any other value like "Purple". This is useful when you have common options but want flexibility for edge cases. **Note:** You cannot combine `|custom` with a shorthand default value - use `|default:` if you need both.

## `{{VALUE:<options>|multi}}` {#value-multi}

Turns an option-list suggester into a **multi-select**: pick several values and they're written as a YAML **List**. Requires an option list (2+ comma-separated values).

```markdown
---
tags: {{VALUE:work,home,urgent|multi}}
---
```

picks `work` and `urgent` → 

```yaml
tags:
  - work
  - urgent
```

Variants and combinations:

- `|multi:linklist` wraps each pick as a wikilink, for List properties of links: `{{VALUE:Alice,Bob,Carol|multi:linklist}}` → `- "[[Alice]]"` / `- "[[Bob]]"`.
- `|multi|custom` lets you add values not in the list (a text box in the picker).
- Combines with `|name:`, `|label:`, `|text:`, `|optional`, and `|trim`. `|case:` is ignored with `|multi` (a list isn't case-transformed).

Notes:

- Multi-select writes a real List with no settings required. It produces a List **inside front matter**; used in the note body it renders as a comma-separated string.
- In a **Capture**, multi-select becomes a List only when capturing into a brand-new note's front matter (Create file if it doesn't exist, without a template). Other capture shapes write a comma-separated string instead.
- With the **one-page input form** (Settings → QuickAdd), avoid commas inside an individual option (e.g. `|text:"High, urgent"`) on a `|multi` token — the one-page picker can't round-trip a comma that lives inside a single option. The default one-prompt-at-a-time picker handles it correctly.

## `{{VALUE:<options>|name:<variable name>}}` {#value-name}

Gives a suggester a reusable **name**, so the value you pick can be inserted again elsewhere without prompting a second time. Pick from the options once at the definition, then reuse the choice anywhere with `{{VALUE:<variable name>}}`.

This is what makes a single choice drive multiple places — for example choosing a category in the file name and reusing it as a tag in the body:

```markdown
File name: {{VALUE:Personal,Work,Errand|name:category}} - {{VALUE:title}}

tags: #{{VALUE:category}}
```

You choose `category` once from the suggester; both the file name and the `tags` line use that selection.

Notes:

- Reuse is always `{{VALUE:category}}`. A bare `{{category}}` is **not** a QuickAdd token and is left untouched (it would collide with Templater/Dataview syntax).
- `|name` combines with the other options, e.g. `{{VALUE:🔽,🔼,⏫|name:priority|text:Low,Normal,High|label:Pick a priority}}`.
- Within a single field the order is free — the definition and its `{{VALUE:category}}` reuses can appear in any order, because the named suggester is resolved before the field's other prompts. Across fields in the default one-prompt-at-a-time flow, define the named suggester in the field that is resolved first (the file name is resolved before the body); a reuse in an earlier field than its definition falls back to a text prompt. The one-page input form (Settings → QuickAdd) removes this caveat entirely.
- `value` and `title` are reserved and can't be used as a name.
- Names match **case-insensitively**: `{{VALUE:Category}}` reuses a value picked at `{{VALUE:...|name:category}}`.
- **First definition wins.** If you reuse the same `|name` with a different definition (different options, or a different `|custom` / `|text:` setting) in one run, the first definition's chosen value is reused for the rest — the later definition is not shown (a warning is logged to the developer console). Use distinct names if you want separate prompts.

## Optional fields: `|optional` {#optional-fields}

Marks a prompt as optional, so it can be skipped and resolve to nothing. Works on `{{VALUE}}`/`{{NAME}}`, `{{VALUE:<variable>}}`, option lists, `{{VDATE:...}}`, and `{{FILE:...}}`.

```markdown
{{VALUE:reminder|optional}}
{{VDATE:due,YYYY-MM-DD|optional}}
{{VALUE:low,medium,high|optional}}
```

What `optional` changes:

- **Prompts gain a Skip button** (and a hint line). Skipping — or submitting an empty input — accepts "empty" as the answer: the placeholder resolves to nothing, and you are not re-prompted for the same variable later in the run.
- **Empty beats the default.** For optional tokens with a default, the default is pre-filled in the input box; clearing it and submitting yields empty. (Required tokens keep today's behavior: an empty submission falls back to the default.)
- **Optional dates accept blank input** instead of failing the whole choice. A typo like "tomorow" still errors — only a blank input means "leave empty".
- **Option lists** show a skip instruction in the suggester footer (Ctrl/Cmd+Shift+Enter) instead of forcing a pick.
- **In the One-Page Input modal**, optional fields show an "(optional)" badge and may be left empty; optional dropdowns get a "Skip (leave empty)" entry.
- **Esc still cancels the whole choice** — skipping is an answer, cancelling is not.

The keyed form `|optional:false` turns the flag off explicitly (useful when a shared snippet adds it). The flag can sit next to a shorthand default: `{{VALUE:reminder|call mom|optional}}`. Because `optional` is a reserved flag word, a literal default of "optional" needs the keyed form: `{{VALUE:x|default:optional}}`.

**Tip — make decoration disappear with the date:** put literal text inside the moment format using square brackets. With

```markdown
- [ ] {{VALUE}} {{VDATE:due,[📅 ]YYYY-MM-DD|optional}}
```

an answered date renders `📅 2026-06-14`, and a skipped date renders nothing at all — the emoji vanishes with it. The same works for prefixes like `[Due: ]YYYY-MM-DD`.

**Scripting note:** setting a variable to the empty string (`params.variables.myVar = ""`) now counts as "answered, empty" for **all** token types, including `{{VDATE}}` — it renders empty instead of re-prompting. To force a prompt, leave the variable unset (or `delete` it / set it to `undefined`). The old workaround of assigning a single space (`" "`) still works but is no longer needed.

## `{{LINKCURRENT}}` {#linkcurrent}

A link to the file from which the template or capture was triggered (`[[link]]` format). When the append-link setting is set to **Enabled (skip if no active file)**, this token resolves to an empty string instead of throwing an error if no note is focused.

Example: `Source: {{LINKCURRENT}}`.

## `{{LINKSECTION}}` {#linksection}

Like `{{LINKCURRENT}}`, but links to the **heading the cursor is currently under** (`[[Note#Heading]]` format), so clicking the link scrolls to that section instead of the top of the file. Honors the same **required/optional** behavior as `{{LINKCURRENT}}`.

It picks the nearest heading at or above the cursor. When the cursor is above the first heading (or the file has no headings), it falls back to a plain whole-file link. When a heading's text is repeated in the file, it uses the disambiguating ancestor path (`[[Note#Parent#Heading]]`) so the link resolves to the right one; if even that can't uniquely identify the heading, it falls back to a whole-file link rather than linking to the wrong section.

Example: `Source: {{LINKSECTION}}`.

## `{{FILENAMECURRENT}}` {#filenamecurrent}

The basename (without extension) of the file from which the template or capture was triggered. Honors the same **required/optional** behavior as `{{LINKCURRENT}}` - when optional and no active file exists, resolves to an empty string.

Example: `Notes from {{FILENAMECURRENT}}`.

## `{{FOLDERCURRENT}}` {#foldercurrent}

The folder of the file from which the template or capture was triggered (the active file), as a vault-relative path with no trailing slash. For an active file at the vault root it resolves to an empty string. Not to be confused with `{{FOLDER}}` below, which is the folder the *new* note is being created in.

This makes per-project captures work without a macro: with **Capture To** set to

```text
{{FOLDERCURRENT}}/Project Tasks.md
```

running the capture from any note inside `Projects/Alpha` targets `Projects/Alpha/Project Tasks.md`, from `Projects/Beta` it targets `Projects/Beta/Project Tasks.md`, and so on. A trailing slash (`{{FOLDERCURRENT}}/`) instead opens a file picker confined to the active file's folder.

Where it resolves: capture targets and file name formats, note bodies/capture formats, and Template choice folder paths (e.g. `{{FOLDERCURRENT}}/Subnotes`).

**No active file:** in paths (capture targets, file names, folder paths) a missing active file always stops the run with a clear error - it never falls back to the vault root. In note bodies it honors the same **required/optional** behavior as `{{LINKCURRENT}}` (optional resolves to an empty string).

### `{{FOLDERCURRENT|name}}` - just the folder name

Add the `|name` modifier to get only the last path segment: for an active file in `Projects/Acme`, `{{FOLDERCURRENT}}` is `Projects/Acme` while `{{FOLDERCURRENT|name}}` is `Acme`. Use `|name` when you want the folder's name inside a file name or note body rather than a path.

Examples: `{{FOLDERCURRENT}}/Project Tasks.md`, `Tasks for {{FOLDERCURRENT|name}}`.

## `{{FOLDER}}` {#folder}

The folder the note is being created in, as a vault-relative path (no trailing slash). For a note created at the vault root this resolves to an empty string. (For the *active* file's folder, use `{{FOLDERCURRENT}}` above.)

Where it has a value:

- **Template choices** — in the file name format (the folder is resolved before the name is built) and in the template body.
- **Capture** — in the capture body, where it resolves to the destination file's folder.
- **Apply template to a note** — the target note's folder.

Where it resolves to an empty string: the capture **Capture to** field (that field is what *chooses* the folder, so there is nothing to reference yet), the `format` JavaScript API, and macro file-path commands.

### `{{FOLDER|name}}` — just the folder name

Add the `|name` modifier to get only the last path segment. For a target folder `Projects/Acme`, `{{FOLDER}}` is `Projects/Acme` while `{{FOLDER|name}}` is `Acme`. Use `{{FOLDER|name}}` when you want the folder's name reflected in a file name; use the bare `{{FOLDER}}` in note bodies where you want the full path.

> Note: in a Template file name format, prefixing with the full path (e.g. `{{FOLDER}}/{{VALUE}}`) is redundant — the note is already placed in the target folder, so the leading path is stripped. Use `{{FOLDER|name}}` to put the folder's name *into* the file name.

Examples: `Filed under {{FOLDER}}`, `{{FOLDER|name}} - {{VALUE}}`.

## `{{MACRO:<MACRONAME>}}` {#macro}

Execute a macro and write the return value here.

Example: `{{MACRO:Generate summary}}`.

## `{{MACRO:<MACRONAME>|label:<label>}}` {#macro-label}

Executes the macro but shows the label as the placeholder when the macro prompts you to choose an export from a script object. This is helpful when multiple macro calls show similar lists.

Example: `{{MACRO:Choose project|label:Project}}`.

## `{{TEMPLATE:<TEMPLATEPATH>}}` {#template}

Include templates in your `format`. Supports Templater syntax.

Example: `{{TEMPLATE:Templates/Meeting.md}}`.

In Capture choices, this can be the entire capture format. Put the full capture body in a template file, then set the Capture format to `{{TEMPLATE:Templates/Capture Format.md}}`. QuickAdd inserts the file contents and then runs the usual capture formatting passes on the result.

## `{{GLOBAL_VAR:<name>}}` {#global-var}

Inserts the value of a globally defined snippet from QuickAdd settings. Snippet values can include other QuickAdd tokens (e.g., `{{VALUE:...}}`, `{{VDATE:...}}`) and are processed by the usual formatter passes. The `GLOBAL_VAR` keyword itself is case‑insensitive, but the snippet name must match the name you defined (it is case‑sensitive).

Example: `{{GLOBAL_VAR:Meeting Header}}`.

## `{{MVALUE}}` {#mvalue}

Math modal for writing LaTeX. Use Ctrl/Cmd + Enter to submit.

Example: `Equation: ${{MVALUE}}$`.

## `{{FIELD:<FIELDNAME>}}` {#field}

Suggest the values of `FIELDNAME` anywhere `{{FIELD:FIELDNAME}}` is used. Fields are YAML fields, and the values represent any value this field has in your vault. If there exists no such field or value, you are instead prompted to enter one.

Example: `project: {{FIELD:project}}`.

### `{{FIELD:<FIELDNAME>|multi}}` {#field-multi}

Turns FIELD suggestions into a multi-select. Pick several existing field values,
or add custom values in the picker.

```markdown
---
topics: {{FIELD:topic|multi}}
---
```

picks `Alpha` and `Beta` →

```yaml
topics:
  - Alpha
  - Beta
```

Inside front matter, `|multi` writes a real YAML **List** when the token is the
complete property value. In note bodies, file names, and other text positions it
renders the selected values as comma-separated text. `|multi` combines with the
same FIELD filters and defaults as single-value FIELD prompts, for example
`{{FIELD:topic|multi|folder:Projects|tag:active|default:Inbox}}`.

The one-page input form intentionally does not inline FIELD multi-selects yet:
vault field values can contain commas, and the current one-page multi input uses
commas as separators. When a format contains `{{FIELD:...|multi}}`, QuickAdd
collects other one-page inputs first, then opens the runtime multi-select for
the FIELD value.

### `{{FIELD:<FIELDNAME>|default-from:active}}` {#field-default-from-active}

Defaults the FIELD prompt to the value the same property already has on the
**active note** - the note that was focused when you triggered QuickAdd. This is
useful for metadata inheritance: from an active project/person/area note, trigger
a capture or template and carry a property such as `project`, `type`, or `area`
over to the new content as the default. You can still accept it, pick another
suggestion, or type a different value.

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

The `project` prompt defaults to `The Great Endeavor`. The active note is captured
when the run starts, before any QuickAdd modal can move focus, so the default
reflects the note you triggered from.

Behavior:

- The normal FIELD suggestion list still comes from your vault (and honors
  `folder:`/`tag:`/`exclude-*`/`inline` filters); the active value is just
  promoted to the top as the default and pre-filled in the one-page form. It is
  promoted even if it already exists in the suggestions.
- If no Markdown note is active, the note doesn't have the property, or the value
  is empty, it falls back to a normal `{{FIELD:<field>}}` prompt with no default.
- Scalar string/number/boolean values are used as-is. A YAML **list** value
  applies only to `|multi` FIELD prompts, where each list item is pre-checked in
  the multi-select picker; for a single-select prompt a list value is skipped (no
  default). Object/map and null values are never used as defaults.
- The property name is matched case-insensitively against the active note's
  properties, so `{{FIELD:Project|default-from:active}}` still reads a `project`
  property.
- This is different from `|default:` (a literal default value) and intentionally
  not `|default:current` (which would clash with `current` as a real field value).

Combine it with `|multi` to inherit a list property:

```md
topics: {{FIELD:topics|multi|default-from:active}}
```

**Enhanced Filtering Options:**

- `{{FIELD:fieldname|folder:path/to/folder}}` - Only suggest values from files in a specific folder
- `{{FIELD:fieldname|folder:goals|folder:projects}}` - Suggest values from either folder
- `{{FIELD:fieldname|tag:tagname}}` - Only suggest values from files with a specific tag
- `{{FIELD:fieldname|tag:active|tag:project}}` - Only suggest values from files that have both tags
- `{{FIELD:fieldname|inline:true}}` - Include Dataview inline fields (fieldname:: value)
- `{{FIELD:fieldname|inline:true|inline-code-blocks:ad-note}}` - Include inline fields inside specific fenced code blocks (opt-in)
- `{{FIELD:fieldname|exclude-folder:templates}}` - Exclude values from files in specific folder
- `{{FIELD:fieldname|exclude-tag:deprecated}}` - Exclude values from files with specific tag
- `{{FIELD:fieldname|exclude-file:example.md}}` - Exclude values from specific file
- `{{FIELD:fieldname|default:Status - To Do}}` - Prepend a default suggestion; the modal placeholder shows it and pressing Enter accepts it.
- `{{FIELD:fieldname|default:Draft|default-empty:true}}` - Only add the default when no matching values are found.
- `{{FIELD:fieldname|default:Draft|default-always:true}}` - Keep the default first even if other suggestions exist.
- `{{FIELD:fieldname|default-from:active}}` - Default to the active note's current value of this property (see [above](#field-default-from-active)).
- Combine filters: `{{FIELD:fieldname|folder:goals|folder:projects|tag:work|tag:active|exclude-folder:templates|inline:true|inline-code-blocks:ad-note}}`
- Multiple exclusions: `{{FIELD:fieldname|exclude-folder:templates|exclude-folder:archive}}`

Repeated `folder:` filters are OR filters. Repeated `tag:` filters are AND
filters. Exclusions remove any matching file.

Examples: `status: {{FIELD:status|default:Draft|default-always:true}}` or `id: {{FIELD:Id|inline:true|inline-code-blocks:ad-note}}`.

This is currently in beta, and the syntax can change—leave your thoughts [on issue #1429](https://github.com/chhoumann/quickadd/issues/1429).

## `{{FILE:<folder>}}` {#file}

Prompts you to pick a markdown **file** from `<folder>` and inserts the choice. Unlike `{{FIELD:...}}` (which suggests the *values* of a YAML field), this suggests the files themselves — handy for "metadata folders" such as a `People/` or `Research Topics/` folder where each note is an option. Because the options are real files, the list always reflects what currently exists, which keeps your links consistent.

The picker shows a note's frontmatter `title` when available, then its first
level-1 heading, then its file basename. QuickAdd still stores the selected file
path internally, so friendly labels do not change which file is inserted.

By default the **basename** (just the file name, no folder or extension) is inserted. Output modes:

- `{{FILE:People}}` — inserts the basename, e.g. `Tom`.
- `{{FILE:People|link}}` — inserts a resolved wikilink, e.g. `[[Tom]]`, using your link settings (wikilink vs. Markdown, shortest path, etc.). In a capture it resolves relative to the capture target; in a template it resolves like `{{LINKCURRENT}}`. Do **not** wrap this in `[[ ]]` yourself — you'd get `[[[[Tom]]]]`.
- `{{FILE:People|path}}` — inserts the vault-relative path, e.g. `People/Tom.md`.
- `{{FILE:People|multi}}` — lets you pick several files.

Example — add a wikilink to a `research-topics` frontmatter list (quote it so the YAML stays a valid list item):

```yaml
research-topics:
  - "{{FILE:Research Topics|link}}"
```

**Options:**

- `{{FILE:<folder>|optional}}` — allow skipping the pick (resolves to nothing).
- `{{FILE:<folder>|custom}}` — also allow typing a value that isn't in the folder.
- `{{FILE:<folder>|multi}}` — select multiple files. In frontmatter/property positions where QuickAdd collects structured properties, QuickAdd writes a YAML list. In note bodies, file names, existing-note captures, and other text positions, it writes comma-separated text. Combine with `|link` or `|path` to write links or paths for every selected file.
- `{{FILE:<folder>|label:Pick a person}}` — set the picker's placeholder text.
- `{{FILE:<folder>|name:<id>}}` — give the pick a shared **id**. Like `{{VALUE}}` and `{{FIELD}}`, FILE tokens are cached by identity: tokens that differ (by folder, filters, mode, or `|label:`) prompt independently, while *identical* tokens reuse one pick. So to choose **two different** files from the same folder, give them distinct labels — e.g. `{{FILE:People|label:Author}}` and `{{FILE:People|label:Reviewer}}` prompt separately. To reuse the *same* pick across tokens — for example to insert both the name and a link to one chosen file — give them the same `|name:`. Tokens that share an id should target the same folder/filters; the shared pick is required if *any* occurrence omits `|optional`.
- Filtering reuses the `{{FIELD}}` grammar: `|tag:`, `|exclude-folder:`, `|exclude-tag:`, `|exclude-file:` (each repeatable).

Notes:

- The folder is the first part of the token; a `|folder:` option is **not** used here (that's `{{FIELD}}` syntax) and is ignored.
- The folder is matched **recursively** (its subfolders are included). Point at the leaf folder (e.g. `{{FILE:fields/people}}`) to scope tightly.
- Repeated `|tag:` filters are AND filters. Exclusions remove any matching file.
- Markdown files only.
- `|link` and `|path` insert characters that aren't valid in file names; in the **file name** field, use the default basename mode.
- One-page input forms collect other inputs first, then open the runtime FILE multi-select, because file names and title labels can contain commas.

## `{{selected}}` {#selected}

The selected text in the current editor. Will be empty if no active editor exists.

Example: `> {{selected}}`.

## `{{CLIPBOARD}}` {#clipboard}

The current clipboard content. Will be empty if clipboard access fails due to permissions or security restrictions.

In Capture choice content, if the clipboard has no text but contains a supported image, QuickAdd saves the image using Obsidian's attachment location settings and inserts an embedded attachment link. Clipboard text takes precedence when both text and an image are available.

You can also paste an image directly into a [value prompt](#value) while typing - no token required.

Example: `Copied: {{CLIPBOARD}}`.

## `{{RANDOM:<length>}}` {#random}

Generates a random alphanumeric string of the specified length (1-100). Useful for creating unique identifiers, block references, or temporary codes.

Example: `^{{RANDOM:6}}`.

## `{{TITLE}}` {#title}

The final rendered filename (without extension) of the note being created or captured to.

Example: `# {{TITLE}}`.

`|text:` limitations (current): a comma inside an `items`/`text` entry needs double quotes (e.g. `"a, b"`); pipes (`|`) inside an entry are not supported.

### Mixed-mode example

Use single-line for a title and multi-line for a body:

```markdown
- {{VALUE:Title|label:Title}}
{{VALUE:Body|type:multiline|label:Body}}
```
