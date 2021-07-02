# QuickAdd
Quickly add new pages or content to your vault.
### Demo
![zApIWkHrKP](https://user-images.githubusercontent.com/29108628/121762835-bb8b2e80-cb38-11eb-8ef6-b65700526caf.gif)

## Installation
**This plugin is in the community plugin browser in Obsidian**. You can search for it and install it there .

You can also do a [manual installation](docs/ManualInstallation.md).

## What's new?
### 0.3.0 - 0.3.1
- Link suggestion in the input prompt now uses your Obsidian link settings by default.
- Add error handling for using ``{{MACRO}}`` to execute a macro that does not exist.
- Input prompt can now also suggest unresolved links.
- Capped input prompt at 50 suggestions for performance in larger vaults.
- You can now offset dates with ``{{DATE+3}}`` or ``{{DATE:<format>+3}}``. `+3` gives you the date in three days, while `+-3` gives you the date three days ago.
- Added a new API feature which allows you to execute choices from within user scripts. These keep the current variables for the execution, so you can 'transfer' variables.
- (0.3.1 HOTFIX) Fix choice finding algorithm.

### 0.2.14 - 0.2.16
- Add 'Insert at the end of section' feature to Captures.
- Revamped the Capture & Template format suggesters. They're now more like smart-autocompleters.
- Template choices now also use the Obsidian method for creating links to files.

### 0.2.13
- Add error logging for when no macro is in the choice.
- Add 'Add' buttons to Macro Builder.
- Multi choices can now have commands & hotkeys.
- Attempted to address #39 - capture not creating template.
- Suggest files from both core templates folder and templater templates folder when creating a Template choice.
- Fix bug where, if there is an emoji in the folder name, the file sometimes doesn't get created
- Update the API. The suggester can now take a map function for the `displayItems`, which will be executed on the `actualItems`. There is also a utility module now, which currently allows you to set or get your clipboard.


### 0.2.11 - 0.2.12
- Implement Quick Commands - ironically, starting with a Wait command. With this command, you can add a delay to your macros. Useful for commands that may take a while to finish.
- Fix a bug where the command sequence did not save.
- Fix bug where 'Create file if it doesn't exist' did not work as intended when no template was given.
- Updated the documentation with new examples and changes to settings.
- Remove (missed) `console.log`.
- If formatted content is empty, don't add anything.
- Capture: Don't create file if setting is disabled.

### 0.2.9 - 0.2.10
- Fix Capture 'Create file if it doesn't exist' bug where some Templater functions did not activate
- Address #28 - choices in multis were not able to be added as commands
- Implement #29 - you can now capture to the bottom of a file
- Fix macro ID conversion
- Fix select macro bug for users with 0-1 macros

### 0.2.7 - 0.2.8
- Linebreak formatting no longer occurs in Template choices - it only activates for Capture choices. It caused unnecessary conflicts.
- Fix bug where some Templater functions are activated twice.

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

#### Create powerful scripts and macros to automate my workflow
Take a look at the [QuickAdd API](docs/QuickAddAPI.md), [format syntax](docs/FormatSyntax.md), and [macros](docs/Choices/MacroChoice.md).

#### Use QuickAdd even when Obsidian is minimized / in the background
You got it. Take a look at [this AutoHotKey script](docs/AHK_OpenQuickAddFromDesktop.md).

