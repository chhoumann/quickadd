---
title: Format syntax
---

## `{{DATE}}` {#date}

Outputs the current date in `YYYY-MM-DD` format. You could write `{{DATE+3}}` to offset the date with 3 days. You can use `+-3` to offset with `-3` days.

Example: `Daily/{{DATE}}.md` or `Review on {{DATE+7}}`.

## `{{DATE:<DATEFORMAT>}}` {#date-format}

Replace `<DATEFORMAT>` with a [Moment.js date format](https://momentjs.com/docs/#/displaying/format/). You could write `{{DATE<DATEFORMAT>+3}}` to offset the date with 3 days.

Example: `{{DATE:YYYY-MM-DD_HH-mm}}` or `{{DATE:YYYY-MM-DD+3}}`.

### Jalali / Persian calendar

Use `|calendar:jalali` to format dates with the Jalali/Persian calendar.
Jalali formats use `moment-jalaali` tokens such as `jYYYY`, `jMM`, and
`jDD`.

Example: `{{DATE:jYYYY-jMM-jDD|calendar:jalali}}`.

On Gregorian `2026-05-28`, this outputs `1405-03-07`.

Offsets still work: `{{DATE:jYYYY-jMM-jDD+3|calendar:jalali}}`.

Accepted calendar values are `gregorian` (default), `jalali`, `jalaali`,
and `persian`. QuickAdd does not infer the Jalali calendar from `j` tokens
alone; use `|calendar:jalali` explicitly.

#### Persian digits and month names

By default Jalali output uses Western digits and transliterated month names
(for example, `jD jMMMM jYYYY` renders `7 Khordaad 1405`, and `dddd` renders the
English weekday). Add `|locale:fa` to render Persian digits and Persian
month/weekday names instead:

- `{{DATE:jYYYY/jMM/jDD|calendar:jalali|locale:fa}}` → `۱۴۰۵/۰۳/۰۷`
- `{{DATE:jD jMMMM jYYYY|calendar:jalali|locale:fa}}` → `۷ خرداد ۱۴۰۵`

Accepted locale values are `default` (the Latin default), `fa`, `farsi`, and
`persian`. `locale:fa` only affects the Jalali calendar; it is ignored for
Gregorian formatting. Offsets and options can be combined in any order, e.g.
`{{DATE:jYYYY/jMM/jDD+1|calendar:jalali|locale:fa}}`.

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

You can also format variable dates with the Jalali calendar:
`{{VDATE:due,jYYYY-jMM-jDD|calendar:jalali}}`.

When `calendar:jalali` is set, the prompt accepts dates typed in the exact
Jalali format you provided (for example, `1405-03-07` for
`jYYYY-jMM-jDD`) and still falls back to natural language/Gregorian parsing
for inputs like `today` or `next monday`.

When combining date options with a default value, use the keyed `default:`
option: `{{VDATE:due,jYYYY-jMM-jDD|calendar:jalali|default:today}}`.

Add `|locale:fa` for Persian digits and month names (see
[Persian digits and month names](#persian-digits-and-month-names) above):
`{{VDATE:due,jYYYY/jMM/jDD|calendar:jalali|locale:fa}}`. The prompt also accepts
Persian-digit input (for example, `۱۴۰۵-۰۳-۰۷`) in addition to Western digits.

The legacy shorthand default remains supported for formats without keyed
options: `{{VDATE:due,YYYY-MM-DD|today}}`.

If any VDATE option segment uses a recognized keyed option (`calendar:`,
`locale:`, or `default:`), QuickAdd treats the whole option list as keyed mode.
In keyed mode,
bare option segments are ignored, so write
`{{VDATE:due,YYYY-MM-DD|calendar:jalali|default:today}}` rather than
`{{VDATE:due,YYYY-MM-DD|calendar:jalali|today}}`.

**Note:** A `VDATE` date format cannot contain a pipe character (`|`). The first
`|` always begins the option list (`calendar:`, `default:`, or a legacy
shorthand default), so pipes in the format — including Moment literals like
`[|]` — are not supported here. If you need a literal pipe in the rendered date,
use the [`{{DATE:<DATEFORMAT>}}`](#date-format) token, where `[|]` is preserved.

## `{{VALUE}}` / `{{NAME}}` {#value}

Interchangeable. Represents the value given in an input prompt. If text is selected in the current editor, it will be used as the value. For Capture choices, selection-as-value can be disabled globally or per-capture. When using the QuickAdd API, this can be passed programmatically using the reserved variable name 'value'.

**Inline script note:** For `js quickadd` blocks, prefer the QuickAdd API (`this.quickAddApi.inputPrompt(...)`) and `this.variables` for transformation flows. Do not rely on `{{VALUE}}` inside JavaScript string literals. See [Inline scripts](./InlineScripts.md#execution-order-and-value).

**Macro note:** `{{VALUE}}` / `{{NAME}}` are scoped per template step, so each template in a macro prompts independently. Use `{{VALUE:sharedName}}` when you want one prompt reused across the macro.

Example: `- [ ] {{VALUE|label:Task}}`.

## `{{VALUE:<variable name>}}` {#named-value}

You can now use variable names in values. They'll get saved and inserted just like values, but the difference is that you can have as many of them as you want. Use comma separation to get a suggester rather than a prompt.

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

For option lists, decouples what is shown in the suggester from what is inserted. `items` and `text` must have the same number of comma-separated entries, and each `text` entry must be unique. If you also use `|custom`, typed custom text is inserted as-is.

Example: `priority: {{VALUE:🔽,🔼,⏫|text:Low,Normal,High}}`.

## `{{VALUE:<variable name>|<default>}}` {#value-default}

Same as above, but with a default value. For single-value prompts (e.g., `{{VALUE:name|Anonymous}}`), the default is pre-populated in the input field - press Enter to accept or clear/edit it. For multi-value suggesters without `|custom`, you must select one of the provided options (no default applies). If you combine keyed options like `|label:`, `|default:`, `|type:`, or `|case:`, shorthand defaults like `|Anonymous` are ignored; use `|default:Anonymous` instead.

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

## `{{LINKCURRENT}}` {#linkcurrent}

A link to the file from which the template or capture was triggered (`[[link]]` format). When the append-link setting is set to **Enabled (skip if no active file)**, this token resolves to an empty string instead of throwing an error if no note is focused.

Example: `Source: {{LINKCURRENT}}`.

## `{{FILENAMECURRENT}}` {#filenamecurrent}

The basename (without extension) of the file from which the template or capture was triggered. Honors the same **required/optional** behavior as `{{LINKCURRENT}}` - when optional and no active file exists, resolves to an empty string.

Example: `Notes from {{FILENAMECURRENT}}`.

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

`|text:` limitations (current): commas and pipes inside individual `items`/`text` entries are not supported.

### Mixed-mode example

Use single-line for a title and multi-line for a body:

```markdown
- {{VALUE:Title|label:Title}}
{{VALUE:Body|type:multiline|label:Body}}
```
