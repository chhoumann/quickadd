---
sidebar_position: 1
title: Getting Started
---

## Installation

**This plugin is in the community plugin browser in Obsidian**. You can search for it and install it there .

You can also do a [manual installation](./ManualInstallation).

## First steps

The first thing you'll want to do is add a new choice. A choice can be one of four types.

-   [Template Choice](./Choices/TemplateChoice) - Insert templates into your vault. Works together with Obsidian template syntax and popular _Templater_ plugin, augmenting them and adding more options.
-   [Capture Choice](./Choices/CaptureChoice) - Quick capture your manually written information and save it. Daily notes, work log, to-read-and-watch-later list, etc.
-   [Macro Choice](./Choices/MacroChoice) - Macros to augment your workflow. Use the full power of Javascript programming language and Obsidian functions to do anything your want. E.g. [create a personal movie database](./Examples/Macro_MovieAndSeriesScript) by writing a movie name and getting the movie notes fully customized and filled with correct film's up-to-date data.
-   [Multi Choice](./Choices/MultiChoice) - Folders to better organize the previous 3 choices. Usability feature, not a new functionality.

In your choices, you can use [format syntax](./FormatSyntax), which is similar to the Obsidian template syntax.

You could, for example, use `{{DATE}}` to get the current date.

## I want to...

### Be inspired

Take a look at some examples...

-   [Capture: Add Journal Entry](docs/Examples/Capture_AddJournalEntry.md)
-   [Macro: Log book to daily journal](docs/Examples/Macro_LogBookToDailyJournal.md)
-   [Template: Add an Inbox Item](docs/Examples/Template_AddAnInboxItem.md)
-   [Macro: Move all notes with a tag to a certain folder](docs/Examples/Macro_MoveNotesWithATagToAFolder.md)
-   [Template: Automatically create a new book note with notes & highlights from Readwise](docs/Examples/Template_AutomaticBookNotesFromReadwise.md)
-   [Capture: Add a task to a Kanban board](docs/Examples/Capture_AddTaskToKanbanBoard.md)
-   [Macro: Easily change properties in your daily note (requires MetaEdit)](docs/Examples/Macro_ChangePropertyInDailyNotes.md)
-   [Capture: Fetch tasks from Todoist and capture to a file](docs/Examples/Capture_FetchTasksFromTodoist.md)
-   [Macro: Zettelizer - easily create new notes from headings while keeping the contents in the file](docs/Examples/Macro_Zettelizer.md)
-   [Macro: Obsidian Map View plugin helper - insert location from address](docs/Examples/Macro_AddLocationLongLatFromAddress.md)
-   [Macro: Toggl Manager - set preset Toggl Track time entries and start them from Obsidian](docs/Examples/Macro_TogglManager.md)
-   [How I Read Research Papers with Obsidian and Zotero](https://bagerbach.com/blog/how-i-read-research-papers-with-obsidian-and-zotero/)
-   [How I Import Literature Notes into Obsidian](https://bagerbach.com/blog/importing-source-notes-to-obsidian)
-   [Macro: Fetching movies and TV shows into your vault](docs/Examples/Macro_MovieAndSeriesScript.md)

### Create powerful scripts and macros to automate my workflow

Take a look at the [QuickAdd API](docs/QuickAddAPI.md), [format syntax](docs/FormatSyntax.md), [inline scripts](docs/InlineScripts.md), and [macros](docs/Choices/MacroChoice.md).

### Use QuickAdd even when Obsidian is minimized / in the background

You got it. Take a look at [this AutoHotKey script](./Misc/AHK_OpenQuickAddFromDesktop).
