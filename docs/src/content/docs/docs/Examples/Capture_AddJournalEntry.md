---
title: "Capture: Add journal entry"
description: Compact Capture reference for appending timestamped journal lines under a heading in your date-formatted daily note file
slug: docs/Examples/Capture_AddJournalEntry
---

For the current step-by-step daily-note setup, use [Capture: Add entries to your daily note](/docs/Examples/Capture_ToDailyNote/). That cookbook covers this journal entry pattern plus creating today's note, inserting under a heading, tasks, quotes, callouts, table rows, and newline gotchas.

Compact reference for the journal entry format:

- **File path / format**: `bins/daily/{{DATE:YYYY-MM-DD - ddd MMM D}}.md`
- **Write position**: **After line...**
- **Insert after**: `## What did I do today?`
- **Capture format**:

```markdown
- {{DATE:HH:mm}} {{VALUE}}\n
```
