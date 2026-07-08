---
title: "Capture: Add journal entry"
description: Compact Capture reference for appending timestamped journal lines under a heading in your date-formatted daily note file
slug: docs/Examples/Capture_AddJournalEntry
---

This pattern has a full step-by-step guide:
[Capture: Add entries to your daily note](/docs/Examples/Capture_ToDailyNote/).
It covers the journal-entry recipe below plus creating today's note, inserting
under a heading, tasks, quotes, callouts, table rows, and newline gotchas.

For reference, the journal entry capture in compact form:

| Setting | Value |
| --- | --- |
| File path / format | `Daily/{{DATE:YYYY-MM-DD - ddd MMM D}}.md` |
| Write position | **After line...** |
| Insert after | `## What did I do today?` |
| Capture format | `- {{DATE:HH:mm}} {{VALUE}}\n` |
