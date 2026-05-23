---
sidebar_position: 1
title: Getting Started
---

QuickAdd adds one fast command for repeatable Obsidian workflows. Use it to
create notes from templates, capture text into existing notes, run scripts, or
organize several choices behind one menu.

## Install QuickAdd

Install QuickAdd from Obsidian's Community Plugins browser, then enable it.

If you cannot use the plugin browser, follow the
[manual installation guide](./ManualInstallation).

## Choose the right choice type

| If you want to... | Use this | Start here |
| --- | --- | --- |
| Create a new note from a reusable file | Template choice | [Template Choices](./Choices/TemplateChoice) |
| Append text to a journal, log, task list, or existing file | Capture choice | [Capture Choices](./Choices/CaptureChoice) |
| Run one or more Obsidian commands, scripts, or choices | Macro choice | [Macro Choices](./Choices/MacroChoice) |
| Group choices into a nested menu | Multi choice | [Multi Choices](./Choices/MultiChoice) |
| Share configured workflows across vaults | Package | [Share QuickAdd Packages](./Choices/Packages) |

Most workflows start with either a Template choice or a Capture choice. Add a
Macro choice when you need scripting, multiple steps, or data from another
plugin or API.

## First workflow

1. Create a Template choice or Capture choice in QuickAdd settings.
2. Add a name you will recognize in the command palette.
3. Configure the target file, folder, template, or capture format.
4. Run `QuickAdd: Run QuickAdd` from the command palette.
5. Assign a hotkey once the workflow behaves the way you want.

QuickAdd choices can use [format syntax](./FormatSyntax), including values like
`{{DATE}}`, `{{VALUE}}`, and `{{FIELD:status}}`. The
[suggester system](./SuggesterSystem) provides fuzzy search for files, tags,
headings, and fields.

## Common paths

### I want examples first

Use the [examples overview](./Examples/) to pick a complete workflow by choice
type, difficulty, prerequisites, and outcome.

Good first examples:

- [Capture: Add Journal Entry](./Examples/Capture_AddJournalEntry)
- [Template: Add an Inbox Item](./Examples/Template_AddAnInboxItem)
- [Macro: Book Finder](./Examples/Macro_BookFinder)
- [Capture: Canvas Capture](./Examples/Capture_CanvasCapture)

### I want to automate with scripts

Start with the [scripting overview](./Advanced/ScriptingGuide), then move to
[User Scripts](./UserScripts) and the [QuickAdd API reference](./QuickAddAPI)
when you need exact method details.

### I want to call QuickAdd from outside Obsidian

Use [Obsidian URI](./Advanced/ObsidianUri) for URI-triggered workflows, or the
[QuickAdd CLI](./Advanced/CLI) for shell scripts and external automation.
