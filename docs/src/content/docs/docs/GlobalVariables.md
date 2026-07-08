---
title: Global Variables
description: "Define reusable, vault-wide text snippets once in settings and drop them into any choice or template with the {{GLOBAL_VAR:name}} placeholder"
slug: docs/GlobalVariables
---

A global variable is a named snippet you define once in QuickAdd's settings and
reuse anywhere QuickAdd fills in placeholders. Keep your list of projects, a
folder path, or a block of boilerplate in one place, then drop it into any
choice or template with `{{GLOBAL_VAR:<name>}}`. Edit the snippet in settings
and every choice that uses it updates at once.

Unlike a [run variable](/docs/VariablesDataFlow/), which lives only while one
choice is running, a global variable is saved with your vault and available to
every choice, every time.

For example, define a snippet named `Signature`:

```text title="Settings → QuickAdd → Global Variables"
Name:  Signature
Value: Logged by QuickAdd on {{DATE:YYYY-MM-DD}}
```

Then use it in a capture or template:

```markdown title="You write"
{{GLOBAL_VAR:Signature}}
```

```markdown title="You get"
Logged by QuickAdd on 2026-07-08
```

Snippets can hold other placeholders (like the `{{DATE}}` above), so a global
variable can be a fixed string, a small template, or a reusable option list.

Good places to use one:

- A single list of projects, tags, or folders reused across many choices and templates
- Constants you'd otherwise retype: paths, emojis, boilerplate text, or a YAML block

## Define a global variable {#define}

1. Open **Settings → QuickAdd → Global Variables**.
2. Add a **name** and a **value**. The value is free text and supports all of
   [format syntax](/docs/FormatSyntax/).
3. That's it - changes save automatically as you type.

:::tip
Typing `{{GLOBAL_VAR:` anywhere QuickAdd formats text pops up suggestions,
including the names you've defined. Use descriptive names, and avoid two names
that differ only by case.
:::

## Use it anywhere: `{{GLOBAL_VAR:<name>}}` {#use}

Write `{{GLOBAL_VAR:<name>}}` and QuickAdd replaces it with that snippet's
value. It works everywhere QuickAdd formats text:

| Where | Which fields |
| --- | --- |
| **Template choice** | File name format, folder paths, template content |
| **Capture choice** | Target path, content formatting |
| **Macros** | Inline formatting strings |

Good to know:

- The name after `GLOBAL_VAR:` matches **case-insensitively**, so `{{global_var:Signature}}` also works. The stored key itself is case-sensitive, which is why you should avoid defining two variables whose names differ only in case.
- A name that doesn't match any global variable becomes an **empty string** rather than erroring.

## Put other placeholders inside a snippet {#nested-tokens}

A snippet's value can contain any QuickAdd placeholder - `{{VALUE:...}}`,
`{{VDATE:...}}`, `{{FIELD:...}}`, `{{RANDOM:n}}`, and so on. When the snippet is
inserted, those placeholders run just like they would if you'd typed them
directly.

```text title="Settings → QuickAdd → Global Variables"
Name:  MyProjects
Value: {{VALUE:Inbox,Work,Personal,Archive}}
```

```markdown title="You write (a template path)"
Projects/{{GLOBAL_VAR:MyProjects}}/{{DATE:YYYY}}/
```

Running a choice that uses `MyProjects` shows the `Inbox / Work / Personal /
Archive` picker, and your pick lands in the path.

Good to know:

- A snippet can reference **another global variable**. QuickAdd resolves up to 5 levels of nesting, so an accidental loop stops instead of hanging.
- Globals expand **early** in the formatter, so any placeholders inside a snippet are processed by the passes that follow.
- The [one-page input form](/docs/Advanced/onePageInputs/) looks inside your snippets too, so prompts they introduce (like `{{VALUE:...}}`) appear up front with the rest.
