# QuickAdd
Quickly add new pages or content to your vault.
### Demo
![zApIWkHrKP](https://user-images.githubusercontent.com/29108628/121762835-bb8b2e80-cb38-11eb-8ef6-b65700526caf.gif)

## Installation
**This plugin is in the community plugin browser in Obsidian**. You can search for it and install it there .

You can also do a [manual installation](docs/ManualInstallation.md).

## What's new?
### 0.3.6 - 0.3.7
- Added setting to create the 'Insert After' line if it isn't found.
- (HOTFIX) Escape regular expression special characters in Insert After when searching for it

### 0.3.5
- You can now execute [inline JavaScript](docs/InlineScripts.md) in templates or captures.

### 0.3.4
- When creating a new file with a template, and the file already exists, you will be asked what you want to do. You can append the template to the top, bottom, overwrite the file with the template, or do nothing.

### 0.3.3
- Fix 'undefined' error when cancelling template choices.
- Insert after in captures now allow format syntax for dynamic insertion.
- Appending to active file now replaces the selected text instead of inserting after it.

### 0.3.0 - 0.3.1
- Link suggestion in the input prompt now uses your Obsidian link settings by default.
- Add error handling for using ``{{MACRO}}`` to execute a macro that does not exist.
- Input prompt can now also suggest unresolved links.
- Capped input prompt at 50 suggestions for performance in larger vaults.
- You can now offset dates with ``{{DATE+3}}`` or ``{{DATE:<format>+3}}``. `+3` gives you the date in three days, while `+-3` gives you the date three days ago.
- Added a new API feature which allows you to execute choices from within user scripts. These keep the current variables for the execution, so you can 'transfer' variables.
- (0.3.1 HOTFIX) Fix choice finding algorithm.

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
- [Capture: Fetch tasks from Todoist and capture to a file](docs/Examples/Capture_FetchTasksFromTodoist.md)
- [Macro: Zettelizer - easily create new notes from headings while keeping the contents in the file](docs/Examples/Macro_Zettelizer.md)
- [Macro: Obsidian Map View plugin helper - insert location from address](docs/Examples/Macro_AddLocationLongLatFromAddress.md)

#### Create powerful scripts and macros to automate my workflow
Take a look at the [QuickAdd API](docs/QuickAddAPI.md), [format syntax](docs/FormatSyntax.md), [inline scripts](docs/InlineScripts.md), and [macros](docs/Choices/MacroChoice.md).

#### Use QuickAdd even when Obsidian is minimized / in the background
You got it. Take a look at [this AutoHotKey script](docs/AHK_OpenQuickAddFromDesktop.md).

