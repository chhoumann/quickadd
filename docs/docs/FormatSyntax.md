---
title: Format syntax
---

## `{{DATE}}` {#date}

Outputs the current date in `YYYY-MM-DD` format. You could write `{{DATE+3}}` to offset the date with 3 days. You can use `+-3` to offset with `-3` days.

Example: `Daily/{{DATE}}.md` or `Review on {{DATE+7}}`.

## `{{DATE:<DATEFORMAT>}}` {#date-format}

Replace `<DATEFORMAT>` with a [Moment.js date format](https://momentjs.com/docs/#/displaying/format/). You could write `{{DATE<DATEFORMAT>+3}}` to offset the date with 3 days.

Example: `{{DATE:YYYY-MM-DD_HH-mm}}` or `{{DATE:YYYY-MM-DD+3}}`.

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

## `{{VALUE}}` / `{{NAME}}` {#value}

Interchangeable. Represents the value given in an input prompt. If text is selected in the current editor, it will be used as the value. For Capture choices, selection-as-value can be disabled globally or per-capture. When using the QuickAdd API, this can be passed programmatically using the reserved variable name 'value'.

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

## `{{VALUE|case:<style>}}` / `{{NAME|case:<style>}}` / `{{VALUE:<variable>|case:<style>}}` {#value-case}

Transforms the resolved value into a casing style. Supported: `kebab`, `snake`, `camel`, `pascal`, `title`, `lower`, `upper`, `slug`.

Example: `{{DATE:YYYY-MM-DD}}-{{VALUE:title|case:slug}}.md`.

## `{{VALUE:<options>|custom}}` {#value-custom}

Allows you to type custom values in addition to selecting from the provided options. Example: `{{VALUE:Red,Green,Blue|custom}}` will suggest Red, Green, and Blue, but also allows you to type any other value like "Purple". This is useful when you have common options but want flexibility for edge cases. **Note:** You cannot combine `|custom` with a shorthand default value - use `|default:` if you need both.

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

## Optional fields: `|optional` {#optional-fields}

Marks a prompt as optional, so it can be skipped and resolve to nothing. Works on `{{VALUE}}`/`{{NAME}}`, `{{VALUE:<variable>}}`, option lists, and `{{VDATE:...}}`.

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

## `{{FILENAMECURRENT}}` {#filenamecurrent}

The basename (without extension) of the file from which the template or capture was triggered. Honors the same **required/optional** behavior as `{{LINKCURRENT}}` - when optional and no active file exists, resolves to an empty string.

Example: `Notes from {{FILENAMECURRENT}}`.

## `{{FOLDER}}` {#folder}

The folder the note is being created in, as a vault-relative path (no trailing slash). For a note created at the vault root this resolves to an empty string.

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

## `{{GLOBAL_VAR:<name>}}` {#global-var}

Inserts the value of a globally defined snippet from QuickAdd settings. Snippet values can include other QuickAdd tokens (e.g., `{{VALUE:...}}`, `{{VDATE:...}}`) and are processed by the usual formatter passes. Names match case‑insensitively in the token.

Example: `{{GLOBAL_VAR:Meeting Header}}`.

## `{{MVALUE}}` {#mvalue}

Math modal for writing LaTeX. Use CTRL + Enter to submit.

Example: `Equation: ${{MVALUE}}$`.

## `{{FIELD:<FIELDNAME>}}` {#field}

Suggest the values of `FIELDNAME` anywhere `{{FIELD:FIELDNAME}}` is used. Fields are YAML fields, and the values represent any value this field has in your vault. If there exists no such field or value, you are instead prompted to enter one.

Example: `project: {{FIELD:project}}`.

**Enhanced Filtering Options:**

- `{{FIELD:fieldname|folder:path/to/folder}}` - Only suggest values from files in specific folder
- `{{FIELD:fieldname|tag:tagname}}` - Only suggest values from files with specific tag
- `{{FIELD:fieldname|inline:true}}` - Include Dataview inline fields (fieldname:: value)
- `{{FIELD:fieldname|inline:true|inline-code-blocks:ad-note}}` - Include inline fields inside specific fenced code blocks (opt-in)
- `{{FIELD:fieldname|exclude-folder:templates}}` - Exclude values from files in specific folder
- `{{FIELD:fieldname|exclude-tag:deprecated}}` - Exclude values from files with specific tag
- `{{FIELD:fieldname|exclude-file:example.md}}` - Exclude values from specific file
- `{{FIELD:fieldname|default:Status - To Do}}` - Prepend a default suggestion; the modal placeholder shows it and pressing Enter accepts it.
- `{{FIELD:fieldname|default:Draft|default-empty:true}}` - Only add the default when no matching values are found.
- `{{FIELD:fieldname|default:Draft|default-always:true}}` - Keep the default first even if other suggestions exist.
- Combine filters: `{{FIELD:fieldname|folder:daily|tag:work|exclude-folder:templates|inline:true|inline-code-blocks:ad-note}}`
- Multiple exclusions: `{{FIELD:fieldname|exclude-folder:templates|exclude-folder:archive}}`

Examples: `status: {{FIELD:status|default:Draft|default-always:true}}` or `id: {{FIELD:Id|inline:true|inline-code-blocks:ad-note}}`.

This is currently in beta, and the syntax can change—leave your thoughts [here](https://github.com/chhoumann/quickadd/issues/337).

## `{{FILE:<folder>}}` {#file}

Prompts you to pick a markdown **file** from `<folder>` and inserts the choice. Unlike `{{FIELD:...}}` (which suggests the *values* of a YAML field), this suggests the files themselves — handy for "metadata folders" such as a `People/` or `Research Topics/` folder where each note is an option. Because the options are real files, the list always reflects what currently exists, which keeps your links consistent.

By default the **basename** (just the file name, no folder or extension) is inserted. Output modes:

- `{{FILE:People}}` — inserts the basename, e.g. `Tom`.
- `{{FILE:People|link}}` — inserts a resolved wikilink, e.g. `[[Tom]]`, using your link settings (wikilink vs. Markdown, shortest path, etc.). In a capture it resolves relative to the capture target; in a template it resolves like `{{LINKCURRENT}}`. Do **not** wrap this in `[[ ]]` yourself — you'd get `[[[[Tom]]]]`.
- `{{FILE:People|path}}` — inserts the vault-relative path, e.g. `People/Tom.md`.

Example — add a wikilink to a `research-topics` frontmatter list (quote it so the YAML stays a valid list item):

```yaml
research-topics:
  - "{{FILE:Research Topics|link}}"
```

**Options:**

- `{{FILE:<folder>|optional}}` — allow skipping the pick (resolves to nothing).
- `{{FILE:<folder>|custom}}` — also allow typing a value that isn't in the folder.
- `{{FILE:<folder>|label:Pick a person}}` — set the picker's placeholder text.
- `{{FILE:<folder>|name:<id>}}` — give the pick a shared **id**. Like `{{VALUE}}` and `{{FIELD}}`, FILE tokens are cached by identity: tokens that differ (by folder, filters, mode, or `|label:`) prompt independently, while *identical* tokens reuse one pick. So to choose **two different** files from the same folder, give them distinct labels — e.g. `{{FILE:People|label:Author}}` and `{{FILE:People|label:Reviewer}}` prompt separately. To reuse the *same* pick across tokens — for example to insert both the name and a link to one chosen file — give them the same `|name:`. Tokens that share an id should target the same folder/filters; the shared pick is required if *any* occurrence omits `|optional`.
- Filtering reuses the `{{FIELD}}` grammar: `|tag:`, `|exclude-folder:`, `|exclude-tag:`, `|exclude-file:` (each repeatable).

Notes:

- The folder is the first part of the token; a `|folder:` option is **not** used here (that's `{{FIELD}}` syntax) and is ignored.
- The folder is matched **recursively** (its subfolders are included). Point at the leaf folder (e.g. `{{FILE:fields/people}}`) to scope tightly.
- Markdown files only.
- `|link` and `|path` insert characters that aren't valid in file names; in the **file name** field, use the default basename mode.

## `{{selected}}` {#selected}

The selected text in the current editor. Will be empty if no active editor exists.

Example: `> {{selected}}`.

## `{{CLIPBOARD}}` {#clipboard}

The current clipboard content. Will be empty if clipboard access fails due to permissions or security restrictions.

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
