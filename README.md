# QuickAdd
Quickly add new pages or content to your vault.
### Demo
![zApIWkHrKP](https://user-images.githubusercontent.com/29108628/121762835-bb8b2e80-cb38-11eb-8ef6-b65700526caf.gif)

## Installation
**This plugin is in the community plugin browser in Obsidian**. You can search for it and install it there .

You can also do a [manual installation](docs/ManualInstallation.md).

## What's new?
### 0.2.9 - 0.2.10
- Fix Capture 'Create file if it doesn't exist' bug where some Templater functions did not activate
- Address #28 - choices in multis were not able to be added as commands
- Implement #29 - you can now capture to the bottom of a file
- Fix macro ID conversion
- Fix select macro bug for users with 0-1 macros

### 0.2.7 - 0.2.8
- Linebreak formatting no longer occurs in Template choices - it only activates for Capture choices. It caused unnecessary conflicts.
- Fix bug where some Templater functions are activated twice.

### 0.2.6
- Throw error if insert after line can't be found - #22
- Add drag & drop to macro commands
- Support user script member access in macros

## Getting started
The first thing you'll want to do is add a new choice. A choice can be one of four types.
- [Template Choice](docs/Choices/TemplateChoice.md) - A powerful way to insert templates into your vault.
- [Capture Choice](docs/Choices/CaptureChoice.md) - Quick capture anything, anywhere.
- [Macro Choice](docs/Choices/MacroChoice.md) - Macros to augment your workflow. Do more, faster.
- [Multi Choice](docs/Choices/MultiChoice.md) - Organize your choices in folders.

In your choices, you can use [format syntax](docs/FormatSyntax.md), which is similar to the Obsidian template syntax.

You could, for example, use ``{{DATE}}`` to get the current date.

## I'm ready to _augment my workflow_ 🚀
That's the spirit. What do you want to do?

### I want to...
#### Be inspired
Take a look at some examples...
- [Capture: Add Journal Entry](docs/Examples/Capture_AddJournalEntry.md)
- [Macro: Log book to daily journal](docs/Examples/Macro_LogBookToDailyJournal.md)
- [Template: Add an Inbox Item](docs/Examples/Template_AddAnInboxItem.md)
- [Macro: Move all notes with a tag to a certain folder](docs/Examples/Macro_MoveNotesWithATagToAFolder.md)
- [Template: Automatically create a new book note with notes & highlights from Readwise](docs/Examples/Template_AutomaticBookNotesFromReadwise.md)
- [Capture: Add a task to a Kanban board](docs/Examples/Capture_AddTaskToKanbanBoard.md)
- [Macro: Easily change properties in your daily note (requires MetaEdit)](docs/Examples/Macro_ChangePropertyInDailyNotes.md)

#### Create powerful scripts and macros to automate my workflow
Take a look at the [QuickAdd API](docs/QuickAddAPI.md), [format syntax](docs/FormatSyntax.md), and [macros](docs/Choices/MacroChoice.md).

#### Use QuickAdd even when Obsidian is minimized / in the background
You got it. Take a look at [this AutoHotKey script](docs/AHK_OpenQuickAddFromDesktop.md).

