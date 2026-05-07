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

You'll get prompted to enter a date and it'll be parsed to the given date format. You could write 'today' or 'in two weeks' and it'll give you the date for that. Works like variables, so you can use the date in multiple places with different formats - enter once, format many times!

Example:

```markdown
Due: {{VDATE:due,YYYY-MM-DD}}
Week: {{VDATE:due,gggg-[W]WW}}
```

## `{{VDATE:<variable name>, <date format>|<default>}}` {#vdate-default}

Same as above, but with a default value. If you leave the prompt empty, the default value will be used instead. Example: `{{VDATE:date,YYYY-MM-DD|today}}` will use "today" if no input is provided. Default values can be any natural language date like "tomorrow", "next monday", "+7 days", etc.

Example: `{{VDATE:due,YYYY-MM-DD|next monday}}`.

**Note:** If your date format contains pipe characters (`|`), escape them as `\|` or wrap them in square brackets, such as `[|]`, so QuickAdd does not treat them as the default value separator.

## `{{VALUE}}` / `{{NAME}}` {#value}

Interchangeable. Represents the value given in an input prompt. If text is selected in the current editor, it will be used as the value. When using the QuickAdd API, this can be passed programmatically using the reserved variable name 'value'.

**Macro note:** `{{VALUE}}` / `{{NAME}}` are scoped per template step, so each template in a macro prompts independently. Use `{{VALUE:sharedName}}` when you want one prompt reused across the macro.

Example: `- [ ] {{VALUE}}`.

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

## `{{VALUE:<variable name>|<default>}}` {#value-default}

Same as above, but with a default value. For single-value prompts (e.g., `{{VALUE:name|Anonymous}}`), the default is pre-populated in the input field - press Enter to accept or clear/edit it. For multi-value suggesters without `|custom`, you must select one of the provided options (no default applies).

Example: `status: {{VALUE:status|Draft}}`.

## `{{VALUE:<options>|custom}}` {#value-custom}

Allows you to type custom values in addition to selecting from the provided options. Example: `{{VALUE:Red,Green,Blue|custom}}` will suggest Red, Green, and Blue, but also allows you to type any other value like "Purple". This is useful when you have common options but want flexibility for edge cases. **Note:** You cannot combine `|custom` with a default value - it's either one or the other.

## `{{LINKCURRENT}}` {#linkcurrent}

A link to the file from which the template or capture was triggered (`[[link]]` format). When the append-link setting is set to **Enabled (skip if no active file)**, this token resolves to an empty string instead of throwing an error if no note is focused.

Example: `Source: {{LINKCURRENT}}`.

## `{{FILENAMECURRENT}}` {#filenamecurrent}

The basename (without extension) of the file from which the template or capture was triggered. Honors the same **required/optional** behavior as `{{LINKCURRENT}}` - when optional and no active file exists, resolves to an empty string.

Example: `Notes from {{FILENAMECURRENT}}`.

## `{{MACRO:<MACRONAME>}}` {#macro}

Execute a macro and write the return value here.

Example: `{{MACRO:Generate summary}}`.

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
- `{{FIELD:fieldname|exclude-folder:templates}}` - Exclude values from files in specific folder
- `{{FIELD:fieldname|exclude-tag:deprecated}}` - Exclude values from files with specific tag
- `{{FIELD:fieldname|exclude-file:example.md}}` - Exclude values from specific file
- `{{FIELD:fieldname|default:Status - To Do}}` - Prepend a default suggestion; the modal placeholder shows it and pressing Enter accepts it.
- `{{FIELD:fieldname|default:Draft|default-empty:true}}` - Only add the default when no matching values are found.
- `{{FIELD:fieldname|default:Draft|default-always:true}}` - Keep the default first even if other suggestions exist.
- Combine filters: `{{FIELD:fieldname|folder:daily|tag:work|exclude-folder:templates|inline:true}}`
- Multiple exclusions: `{{FIELD:fieldname|exclude-folder:templates|exclude-folder:archive}}`

Example: `status: {{FIELD:status|default:Draft|default-always:true}}`.

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
