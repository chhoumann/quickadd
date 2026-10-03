---
title: "Capture: Add journal entry"
description: Compact Capture reference for appending timestamped journal lines under a heading in your date-formatted daily note file
slug: docs/Examples/Capture_AddJournalEntry
---

This pattern has a full step-by-step guide:
[Capture: Add entries to your daily note](/docs/Examples/Capture_ToDailyNote/).
It covers the journal-entry recipe below plus creating today's note, inserting
under a heading, tasks, quotes, callouts, table rows, and newline gotchas.
Use **Copy package** on that page to install a journal capture and four other recipes; the packaged journal capture uses `{{DAILY}}` and `## Journal` and needs QuickAdd 2.30.0 or later.

For reference, the journal entry capture in compact form:

| Setting | Value |
| --- | --- |
| Capture to | `{{DAILY}}` (click **Daily note** next to the field) |
| Create file if it doesn't exist | On |
| Write position | **After line...** |
| Insert after | `## What did I do today?` |
| Capture format | `- {{DATE:HH:mm}} {{VALUE}}` |

Before QuickAdd 2.30.0, set **Capture to** to your daily-note path and date pattern instead, for example `Daily/{{DATE:YYYY-MM-DD - ddd MMM D}}.md`, turn on **Create file if it doesn't exist** yourself, and turn on the **Capture format** toggle.
