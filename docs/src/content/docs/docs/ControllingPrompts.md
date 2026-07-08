---
title: Controlling Prompts
description: Everything you control about the questions QuickAdd asks - which ones appear, in what order, how they look, how to skip them, and which keys submit or cancel.
slug: docs/ControllingPrompts
---

When a choice runs, every placeholder that needs input becomes a prompt: `{{VALUE:title}}` in a file name, `{{VDATE:due,YYYY-MM-DD}}` in a template, the target file of a Capture, and so on. This page covers everything you control about those prompts - which ones appear, the order they come in, how each one looks, how to make one skippable, the keys that submit or cancel, and the one-page form that asks everything at once.

For the full syntax of each placeholder and flag, see [Format Syntax](/docs/FormatSyntax/). For the one-page form in depth, see [One-page Inputs](/docs/Advanced/onePageInputs/).

## What QuickAdd asks you {#where-prompts-come-from}

QuickAdd prompts whenever it meets a placeholder it cannot fill on its own:

- [`{{VALUE}}` / `{{VALUE:name}}`](/docs/FormatSyntax/#value) ask for text, or show a pick list when you give them options.
- [`{{VDATE:name,format}}`](/docs/FormatSyntax/#vdate) asks for a date, and understands natural language like `tomorrow`.
- [`{{FIELD:name}}`](/docs/FormatSyntax/#field) suggests values a property already has in your vault.
- [`{{FILE:folder}}`](/docs/FormatSyntax/#file) asks you to pick a note from a folder.
- Template choices may also ask for a file name or folder; Capture choices may ask which file to capture to.

You are asked once per variable, per run. If `{{VALUE:title}}` appears in both the file name and the template body, you answer once and QuickAdd reuses it. A variable that already has a value never prompts: prefilled variables from a macro step, [the API](/docs/QuickAddAPI/), or the [CLI](/docs/Advanced/CLI/) skip their prompts, and even an empty string counts as an answer.

## The order prompts appear in {#prompt-order}

Prompts follow the structure of the choice, not where the placeholders sit in your text. Take this template:

```markdown
Attendees: {{VALUE:attendees}}
Due: {{VDATE:due,YYYY-MM-DD}}
```

The `due` prompt appears first, even though `attendees` comes first in the text. That is because dates are asked before named values within one piece of text. The full order:

1. **Template choices** resolve the template path first, then the folder, then the file name, and finally the template's content. A placeholder in the file name always prompts before anything in the template body.
2. **Capture choices** resolve the capture target first, then the capture format.
3. **Within one piece of text** (a file name, a template, a capture format), prompts are grouped by kind, and only inside a kind do they follow the order they appear. The kinds run in this order: plain `{{VALUE}}`/`{{NAME}}` first, then dates (`{{VDATE}}`), then named values (`{{VALUE:name}}`), then fields (`{{FIELD}}`) and file pickers (`{{FILE}}`), with the math prompt (`{{MVALUE}}`) last.

No flag reorders individual prompts. If the sequence bothers you, switch on the [one-page input form](#one-form-instead-of-many-prompts): it lists every input in one form (still in resolution order), and you fill them in whatever order you like.

:::note
A pick list defined with [`|name:`](/docs/FormatSyntax/#value-name) and its reuses can appear in any order within one piece of text. When a reuse comes before the definition, QuickAdd resolves the definition early so you are still asked only once.
:::

## Change how a prompt looks {#shape-an-individual-prompt}

Each control is a flag you add to the placeholder. The most common ones:

| You want | Flag | Example |
| --- | --- | --- |
| Helper text on the prompt | [`\|label:`](/docs/FormatSyntax/#value-label) | `{{VALUE:attendees\|label:Comma-separated names}}` |
| A pre-filled default | [`\|default:`](/docs/FormatSyntax/#value-default-option) | `{{VALUE:status\|default:open}}` |
| A large, multi-line text box | [`\|type:multiline`](/docs/FormatSyntax/#value-multiline) | `{{VALUE:notes\|type:multiline}}` |
| A number, slider, or checkbox | [`\|type:number` and friends](/docs/FormatSyntax/#value-property-types) | `{{VALUE:rating\|type:slider\|min:0\|max:10}}` |
| A pick list | [comma-separated options](/docs/FormatSyntax/#named-value) | `{{VALUE:low,medium,high}}` |
| A pick list that also accepts custom text | [`\|custom`](/docs/FormatSyntax/#value-custom) | `{{VALUE:home,work\|custom}}` |
| Several selections at once | [`\|multi`](/docs/FormatSyntax/#value-multi) | `{{VALUE:a,b,c\|multi}}` |

The full reference for every flag lives in [Format Syntax](/docs/FormatSyntax/).

Good to know:

- `|label:` works on `{{VALUE}}` placeholders and [`{{FILE:...}}`](/docs/FormatSyntax/#file) pickers, not on `{{VDATE}}` or `{{FIELD}}`. On a plain text prompt the label shows as helper text below the title; on a pick list it becomes the placeholder.
- `|type:multiline` upgrades a single placeholder to the large text box and overrides the global **Use Multi-line Input Prompt** setting. There is no reverse flag: with the global setting on, every plain text prompt is already multi-line.
- `|type:` flags only work on single-value placeholders. A pick list ignores them.

## Make a prompt skippable {#optional-prompts}

Add [`|optional`](/docs/FormatSyntax/#optional-fields) to let a prompt be left blank, in which case it resolves to nothing:

```markdown
- [ ] {{VALUE:task}} {{VDATE:due,[📅 ]YYYY-MM-DD|optional}}
```

An optional prompt gains a **Skip** button and treats an empty submission as the answer, so you are not asked again later in the run. `|optional` works on `{{VALUE}}` placeholders, option lists, `{{VDATE}}`, and `{{FILE}}`.

Skipping is an answer; pressing **Esc** still cancels the whole choice. If the same variable appears in several places, put `|optional` on every occurrence - that is the one spelling that behaves the same in both the sequential prompts and the one-page form.

## Keys that submit, skip, and cancel {#submit-keys}

| Prompt | Submit | Also useful |
| --- | --- | --- |
| Single-line input (also number, slider, and date prompts) | `Enter` | |
| Multi-line input | `Ctrl/Cmd+Enter` (`Enter` inserts a newline) | `Tab` indents; `Shift+Tab` moves focus out |
| Pick list / suggester | `Enter` picks the highlighted option | |
| Math prompt ([`{{MVALUE}}`](/docs/FormatSyntax/#mvalue)) | `Ctrl/Cmd+Enter` | `Tab` jumps to the cursor marker |
| One-page input form | `Ctrl/Cmd+Enter` | `Tab` moves between fields |
| Any optional prompt | | `Ctrl/Cmd+Shift+Enter` skips |

`Esc` cancels the prompt and with it the whole run - nothing is created or captured by the cancelled choice. (In a macro, steps that already ran are not undone.) To get a notice when that happens, enable **Show Input Cancellation Notifications** in [settings](/docs/Settings/#notifications).

## Autocomplete while you type {#autocomplete-inside-prompts}

Inside a prompt, `#` searches your vault's tags and `[[` searches your files (headings, blocks, and relative paths work too). See [Suggester System](/docs/SuggesterSystem/) for all triggers and keys.

These triggers work in the single-line and multi-line prompts. The one-page form's plain text fields do not offer them, though its field and pick-list inputs have their own inline suggestions.

## One form instead of many prompts {#one-form-instead-of-many-prompts}

Rather than answering prompts one at a time, QuickAdd can collect everything in a single form before the choice runs. Every unanswered variable appears as the right widget - text, textarea, date with a calendar, dropdown, slider - with optional fields badged, and Template choices with a file name format get a live file name preview.

- Turn it on for everything with **One-page input for choices** under [Settings → Input](/docs/Settings/#input).
- Template and Capture choices each have a **One-page input override** dropdown in their builder (**Follow global setting**, **Always**, **Never**), so you can flip the form on or off for one choice.
- A few inputs still run as follow-up steps after the form, such as [`{{FIELD:...|multi}}`](/docs/FormatSyntax/#field-multi) pickers and Capture's insert-after heading picker.
- Cancelling the form cancels the whole run, exactly like cancelling a sequential prompt.

The full behavior - what is collected, date parsing, defaults, and script-declared inputs - is documented in [One-page Inputs](/docs/Advanced/onePageInputs/).

## For script authors {#for-script-authors}

User scripts can declare their inputs so they appear in the one-page form (`quickadd.inputs`), and can open a one-page form of their own at runtime with [`quickAddApi.requestInputs`](/docs/QuickAddAPI/). Both are covered in [One-page Inputs](/docs/Advanced/onePageInputs/#user-scripts-declare-inputs-optional).
