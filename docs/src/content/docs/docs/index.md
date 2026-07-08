---
title: Getting Started
description: "Get started with QuickAdd: install it, pick between Template, Capture, Macro, and Multi choices, and build your first workflow"
slug: docs
---

QuickAdd adds one fast command for repeatable Obsidian workflows. Use it to
create notes from templates, capture text into existing notes, run scripts, or
organize several choices behind one menu.

## Install QuickAdd

Install QuickAdd from Obsidian's Community Plugins browser, then enable it.

If you cannot use the plugin browser, follow the
[manual installation guide](/docs/ManualInstallation/).

## Choose the right choice type

| If you want to... | Use this | Start here |
| --- | --- | --- |
| Create a new note from a reusable file | Template choice | [Template Choices](/docs/Choices/TemplateChoice/) |
| Append text to a journal, log, task list, or existing file | Capture choice | [Capture Choices](/docs/Choices/CaptureChoice/) |
| Run one or more Obsidian commands, scripts, or choices | Macro choice | [Macro Choices](/docs/Choices/MacroChoice/) |
| Group choices into a nested menu | Multi choice | [Multi Choices](/docs/Choices/MultiChoice/) |
| Share configured workflows across vaults | Package | [Share QuickAdd Packages](/docs/Choices/Packages/) |

Most workflows start with either a Template choice or a Capture choice. Add a
Macro choice when you need scripting, multiple steps, or data from another
plugin or API.

## First workflow

1. Create a Template choice or Capture choice in QuickAdd settings.
2. Add a name you will recognize in the command palette.
3. Configure the target file, folder, template, or capture format.
4. Run the `QuickAdd: Run` command from the command palette.
5. Assign a hotkey once the workflow behaves the way you want.

QuickAdd choices can use [format syntax](/docs/FormatSyntax/), including values like
`{{DATE}}`, `{{VALUE}}`, and `{{FIELD:status}}`. The
[suggester system](/docs/SuggesterSystem/) provides fuzzy search for files, tags,
headings, and fields.

## Common paths

### I want examples first

Use the [examples overview](/docs/Examples/) to pick a complete workflow by choice
type, difficulty, prerequisites, and outcome.

Good first examples:

- [Capture: Add Journal Entry](/docs/Examples/Capture_AddJournalEntry/)
- [Template: Add an Inbox Item](/docs/Examples/Template_AddAnInboxItem/)
- [Macro: Book Finder](/docs/Examples/Macro_BookFinder/)
- [Capture: Canvas Capture](/docs/Examples/Capture_CanvasCapture/)

### I want to automate with scripts

Start with the [scripting overview](/docs/Advanced/ScriptingGuide/), then move to
[User Scripts](/docs/UserScripts/) and the [QuickAdd API reference](/docs/QuickAddAPI/)
when you need exact method details.

### I want to call QuickAdd from outside Obsidian

Use [Obsidian URI](/docs/Advanced/ObsidianUri/) for URI-triggered workflows, or the
[QuickAdd CLI](/docs/Advanced/CLI/) for shell scripts and external automation.
