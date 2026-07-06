---
title: Controlling Prompts
description: How QuickAdd decides what to ask and in which order, and how to label, shape, skip, or combine prompts - including every keyboard shortcut.
---

# Controlling Prompts

When QuickAdd runs a choice, every format token that needs input becomes a prompt: `{{VALUE:title}}` in a file name, `{{VDATE:due,YYYY-MM-DD}}` in a template, the target file of a Capture, and so on. This page is the overview of everything you control about those prompts: the order they appear in, per-prompt labels and widgets, optional prompts, the keys that submit or skip them, and the one-page form that collects every input at once.

For the full syntax of each token and flag, see [Format Syntax](./FormatSyntax.md). For the one-page form in depth, see [One-page Inputs](./Advanced/onePageInputs.md).

## Where prompts come from

QuickAdd prompts whenever it meets a token it cannot resolve on its own:

- [`{{VALUE}}` / `{{VALUE:name}}`](./FormatSyntax.md#value) ask for text, or show a pick list when you give them options.
- [`{{VDATE:name,format}}`](./FormatSyntax.md#vdate) asks for a date, with natural language support.
- [`{{FIELD:name}}`](./FormatSyntax.md#field) suggests values that already exist in your vault's properties.
- [`{{FILE:folder}}`](./FormatSyntax.md#file) asks you to pick a note from a folder.
- Template choices may also ask for a file name or folder; Capture choices may ask which file to capture to.

A variable prompts once per run. If `{{VALUE:title}}` appears in both the file name and the template body, you are asked once and the answer is reused. This also means prefilled variables (from a macro step, [the API](./QuickAddAPI.md), or the [CLI](./Advanced/CLI.md)) skip their prompts entirely - an empty string counts as an answer.

## Prompt order

Prompts follow the structure of the choice, not the position of tokens in your text:

1. **Template choices** resolve the template path first, then the folder, then the file name, and finally the template's content. A token in the file name always prompts before anything in the template body.
2. **Capture choices** resolve the capture target first, then the capture format.
3. **Within one piece of text** (a file name, a template, a capture format), prompts are grouped by token kind, and only within a kind do they follow the order they appear in. A plain `{{VALUE}}`/`{{NAME}}` is asked first of all, then dates (`{{VDATE}}`), then named values (`{{VALUE:name}}`), then fields (`{{FIELD}}`) and file pickers (`{{FILE}}`), with the math prompt (`{{MVALUE}}`) last.

For example, in this template:

```markdown
Attendees: {{VALUE:attendees}}
Due: {{VDATE:due,YYYY-MM-DD}}
```

the `due` prompt appears first, even though `attendees` comes first in the text.

There is no flag that reorders individual prompts. If the sequence bothers you, use the [one-page input form](#one-form-instead-of-many-prompts): it lists all inputs in a single form (in the same resolution order), and you fill them in any order you like.

:::note
A suggester defined with [`|name:`](./FormatSyntax.md#value-name) and its reuses can appear in any order within one piece of text - when a reuse comes before the definition, QuickAdd resolves the definition early so you are asked once.
:::

## Shape an individual prompt

Each control is a flag on the token. The reference for every flag lives in [Format Syntax](./FormatSyntax.md); the ones you will reach for most:

| You want | Flag | Example |
| --- | --- | --- |
| Helper text on the prompt | [`\|label:`](./FormatSyntax.md#value-label) | `{{VALUE:attendees\|label:Comma-separated names}}` |
| A pre-filled default | [`\|default:`](./FormatSyntax.md#value-default-option) | `{{VALUE:status\|default:open}}` |
| A large, multi-line text box | [`\|type:multiline`](./FormatSyntax.md#value-multiline) | `{{VALUE:notes\|type:multiline}}` |
| A number, slider, or checkbox | [`\|type:number` and friends](./FormatSyntax.md#value-property-types) | `{{VALUE:rating\|type:slider\|min:0\|max:10}}` |
| A pick list | [comma-separated options](./FormatSyntax.md#named-value) | `{{VALUE:low,medium,high}}` |
| A pick list that accepts custom text | [`\|custom`](./FormatSyntax.md#value-custom) | `{{VALUE:home,work\|custom}}` |
| Multiple selections | [`\|multi`](./FormatSyntax.md#value-multi) | `{{VALUE:a,b,c\|multi}}` |

Good to know:

- Among the input tokens, `|label:` works on `{{VALUE}}` tokens and [`{{FILE:...}}`](./FormatSyntax.md#file) pickers (not on `{{VDATE}}` or `{{FIELD}}`). On a plain text prompt the label renders as helper text below the title; on a pick list it becomes the placeholder.
- `|type:multiline` upgrades a single token to the large prompt and overrides the global **Use Multi-line Input Prompt** setting. The reverse does not exist: with the global setting on, every plain text prompt is multi-line.
- `|type:` flags only work on single-value tokens - a pick list ignores them.

## Optional prompts

Add [`|optional`](./FormatSyntax.md#optional-fields) to let a prompt be skipped, resolving to nothing:

```markdown
- [ ] {{VALUE:task}} {{VDATE:due,[📅 ]YYYY-MM-DD|optional}}
```

Optional prompts gain a **Skip** button and accept an empty submission as the answer; you are not re-asked later in the run. Skipping is an answer - pressing Esc still cancels the whole choice. `|optional` works on `{{VALUE}}` tokens, option lists, `{{VDATE}}`, and `{{FILE}}`.

If a variable appears in several places, put `|optional` on every occurrence. The sequential prompts and the one-page form combine repeated flags differently, and flagging every occurrence is the only spelling that behaves the same everywhere.

## Submit keys

| Prompt | Submit | Also useful |
| --- | --- | --- |
| Single-line input (also number, slider, and date prompts) | `Enter` | |
| Multi-line input | `Ctrl/Cmd+Enter` (`Enter` inserts a newline) | `Tab` indents; `Shift+Tab` moves focus out |
| Pick list / suggester | `Enter` picks the highlighted option | |
| Math prompt ([`{{MVALUE}}`](./FormatSyntax.md#mvalue)) | `Ctrl/Cmd+Enter` | `Tab` jumps to the cursor marker |
| One-page input form | `Ctrl/Cmd+Enter` | `Tab` moves between fields |
| Any optional prompt | | `Ctrl/Cmd+Shift+Enter` skips |

`Esc` cancels the prompt and with it the whole run - nothing is created or captured by the cancelled choice (in a macro, steps that already ran are not undone). If you want a notice when that happens, enable **Show Input Cancellation Notifications** in [settings](./Settings.md#notifications).

## Autocomplete inside prompts

While typing in a prompt, `#` searches your vault's tags and `[[` searches your files (headings, blocks, and relative paths work too). See [Suggester System](./SuggesterSystem.md) for all triggers and keys. These triggers work in the single-line and multi-line prompts; the one-page form's text fields do not offer them, though its field and pick-list inputs have their own inline suggestions.

## One form instead of many prompts

Instead of answering prompts one at a time, QuickAdd can collect everything in a single form before the choice runs: every unanswered variable, rendered as the right widget (text, textarea, date with a calendar, dropdown, slider), with optional fields badged and, for Template choices with a file name format, a live file name preview.

- Enable it globally with **One-page input for choices** under [Settings → Input](./Settings.md#input).
- Template and Capture choices each have a **One-page input override** dropdown in their builder (**Follow global setting**, **Always**, **Never**), so you can turn the form on or off per choice.
- A few inputs still run as follow-up steps after the form, such as [`{{FIELD:...|multi}}`](./FormatSyntax.md#field-multi) pickers and Capture's insert-after heading picker.
- Cancelling the form cancels the whole run, exactly like cancelling a sequential prompt.

The full behavior - what is collected, date parsing, defaults, and script-declared inputs - is documented in [One-page Inputs](./Advanced/onePageInputs.md).

## For script authors

User scripts can declare their inputs so they appear in the one-page form (`quickadd.inputs`), and can open a one-page form of their own at runtime with [`quickAddApi.requestInputs`](./QuickAddAPI.md). Both are covered in [One-page Inputs](./Advanced/onePageInputs.md#user-scripts-declare-inputs-optional).
