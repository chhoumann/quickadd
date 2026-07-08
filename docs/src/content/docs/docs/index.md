---
title: Getting Started
description: "Get started with QuickAdd: install it, pick between Template, Capture, Macro, and Multi choices, and build your first workflow"
slug: docs
---

QuickAdd turns your repetitive Obsidian actions - creating a note from a
template, logging a line to your journal, running a script - into single
commands you trigger with a hotkey. Set a workflow up once, then run it in a
keystroke from anywhere in your vault.

New here? Build your [first workflow](#first-workflow) below in about a minute.

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

Let's build a capture that adds a timestamped line to your daily journal. It
takes about a minute.

1. Open **Settings → QuickAdd**. Type a name like `Add to journal`, choose
   **Capture** in the dropdown, and click **Add Choice**.
2. Click the gear (⚙) next to your new choice to open its settings.
3. Set **Capture To** to `Journal/{{DATE}}.md` - the note today's entries land in.
4. Turn on **Capture format** and enter `- {{DATE:HH:mm}} {{VALUE}}` - the shape
   of one entry.
5. Close the settings. Open the command palette (Ctrl/Cmd+P), run
   **QuickAdd: Run**, pick `Add to journal`, and type your entry.

QuickAdd writes a line like `- 09:42 Standup moved to Wednesday` into today's
journal note, without opening it. Once it works the way you want, give it a
hotkey from the ⚡ icon next to the choice or Obsidian's Hotkeys settings.

The `{{DATE}}` and `{{VALUE}}` above are [format syntax](/docs/FormatSyntax/):
placeholders QuickAdd fills in each time you run the choice. There are
placeholders for dates, your answers, links, clipboard content, and more. When a
prompt asks you for text, the [suggester system](/docs/SuggesterSystem/) lets you
type `[[` or `#` to pull in a file, tag, or heading from your vault.

## Common paths

### I want examples first

Use the [examples overview](/docs/Examples/) to pick a complete workflow by choice
type, difficulty, prerequisites, and outcome.

Good first examples:

- [Capture: Add entries to your daily note](/docs/Examples/Capture_ToDailyNote/)
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
