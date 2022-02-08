# QuickAdd
Quickly add new pages or content to your vault.
### Demo video
[![Demo video](https://img.youtube.com/vi/gYK3VDQsZJo/0.jpg)](https://www.youtube.com/watch?v=gYK3VDQsZJo)

## Installation
**This plugin is in the community plugin browser in Obsidian**. You can search for it and install it there .

You can also do a [manual installation](docs/ManualInstallation.md).

## What's new?
### 0.5.0 - 0.5.1
- Added support for scripts on mobile devices.
- (0.5.1) Exposed Obsidian API for scripts. Only works for desktop usage.

### 0.4.19 - 0.4.22
- Fix issues preventing the creation of folders with Template choices.
- Allow format syntax in folder names in Template Choices.
- Add CSS classes to all modals to indicate they're QuickAdd modals.
- Bugfix for wide input prompt in API. Thanks to @mrmrmrfinch

### 0.4.18
- Add multi-line input prompt

### 0.4.9
- Implement Math Modals - a WYSIWYG LaTeX formula prompt
- Input prompt file name search is now based on file names, rather than file paths.
- Input prompt is now closer to Obsidian UI (uses Obsidian API)

### 0.4.6
- Bugfix: user scripts with settings are no longer repeated.
- Add ``getSelectedText`` to the QuickAdd API under `utility`.

### 0.4.1 - 5
- Bugfix: Template Choices now correctly detects if the file it's trying to create already exists. If it does, you will be prompted to append, prepend, overwrite, or do nothing - and it'll open the file for you.
- Update error message when failing to create note to make it more understandable
- Fix RegExp bug
- User scripts with settings are now not forced to use ``entry`` function
- Obsidian commands are fixed in the macro list and should now behave property

### 0.4.0
- Massive improvements to user scripts and the API:
  - You can now define settings for user scripts, which can be configured in Obsidian.
  - Exposed ``format`` in the API, which will evaluate format syntax like `{{DATE}}`, `{{VALUE}}`, and so on.
  - Exposed a new date module in the API with methods for retrieving and formatting dates.
- Added settings for opening files in edit or preview mode.
- Added settings for automatically focusing the opened file.
- Improved the folder selector search in Template choices.
- You can now rename Multis.

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
- [Macro: Toggl Manager - set preset Toggl Track time entries and start them from Obsidian](docs/Examples/Macro_TogglManager.md)
- [How I Read Research Papers with Obsidian and Zotero](https://bagerbach.com/blog/how-i-read-research-papers-with-obsidian-and-zotero/)
- [How I Import Literature Notes into Obsidian](https://bagerbach.com/blog/importing-source-notes-to-obsidian)
- [Macro: Fetching movies and TV shows into your vault](docs/Examples/Macro_MovieAndSeriesScript.md)

#### Create powerful scripts and macros to automate my workflow
Take a look at the [QuickAdd API](docs/QuickAddAPI.md), [format syntax](docs/FormatSyntax.md), [inline scripts](docs/InlineScripts.md), and [macros](docs/Choices/MacroChoice.md).

#### Use QuickAdd even when Obsidian is minimized / in the background
You got it. Take a look at [this AutoHotKey script](docs/AHK_OpenQuickAddFromDesktop.md).

