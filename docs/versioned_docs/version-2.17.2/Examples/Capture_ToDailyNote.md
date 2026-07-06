---
title: "Capture: Add entries to your daily note"
---

This cookbook gives you one QuickAdd choice that adds text to today's daily note - even when the note or the target heading doesn't exist yet.

Every recipe starts from the same base Capture choice; you only change the **Capture format** and the target heading.

## Base setup

1. In QuickAdd settings, add a new **Capture** choice.
2. Name it (for example, `Daily entry`) and open its settings.
3. Disable **Capture to active file**.
4. Set **File path / format** to match your vault's daily-note path and date pattern, for example `Daily/{{DATE:YYYY-MM-DD}}.md`.
5. Enable **Create file if it doesn't exist**.
6. Set **Write position** to **After line...**.
7. In the **Insert after** field, enter the heading you want entries placed under, for example `## Journal`.
8. Enable **Insert at end of section** so each capture appends at the bottom of the section.
9. Enable **Create line if not found** and set its placement to **Top** so the heading is inserted when a fresh note does not have it yet.
10. Leave **Link to captured file** disabled.
11. Enable **Capture format** and use one of the recipes below.

## Recipes

Each recipe shows what to change from the base setup.

### Timestamped journal line

Keep **Insert after** set to `## Journal`.

**Capture format:**

```
- {{DATE:HH:mm}} {{VALUE}}\n
```

Produces:

```markdown
## Journal
- 18:54 first journal entry
- 18:55 second journal entry
```

End non-task formats with `\n` so each capture lands as its own complete line.

### Task line

Change **Insert after** to `## Tasks`.

**Task:** on (in the **Content** section).

**Capture format:**

```
{{VALUE}}
```

**Task** wraps the value in `- [ ] ...` automatically. Do not add `- [ ]` to the format manually.

### Task with a date prompt

**Task:** on.

**Capture format:**

```
{{VALUE}} due {{VDATE:due,YYYY-MM-DD}}
```

QuickAdd prompts for the task text and then for `due`. You can enter an exact date or a natural-language date such as `tomorrow`. Result: `- [ ] pay rent due 2026-07-07`.

### Callout line

Change **Insert after** to the callout opener, for example:

```
> [!info]- Captured today
```

**Capture format:**

```
> {{VALUE}}\n
```

On first use, **Create line if not found** inserts the callout opener at the position you chose. Each subsequent capture appends before the next blank line or heading, so keep the callout as one contiguous quoted block. The `>` prefix is required to keep the entry inside the callout block.

### Quote

Change **Insert after** to `## Quotes`.

**Capture format:**

```
> {{VALUE}}\n
```

Same format as the callout recipe but targeting a regular heading. Produces a blockquote line under the section.

### Table row

Use this when the daily note already has a table under a heading and the table is the last block in that section. Keep **Write position** as **After line...**, set **Insert after** to the heading above the table, and keep **Insert at end of section** enabled. If more content follows the table in the same section, target the table separator row instead.

**Capture format:**

```
| {{DATE:HH:mm}} | {{VALUE}} |\n
```

This keeps the row attached to the table:

```markdown
## Log
| When | What |
| --- | --- |
| 09:00 | existing |
| 18:55 | section row |
```

### Tomorrow's daily note

Change **File path / format** to:

```
Daily/{{DATE:YYYY-MM-DD+1}}.md
```

The `+1` shifts the target date one day forward. Combine with any of the formats above.

## Troubleshooting

**Captures run together on one line.**
For non-task formats, end the capture format with `\n` or press Enter at the end of the format field. Formats that use **Task** do not need one; QuickAdd inserts that line break.

**Pasted multiple lines became one task.**
The **Task** setting wraps the whole capture once. Capture one task at a time, or use an advanced macro or userscript if you need to split pasted lines into separate tasks.

**The heading is not found and capture fails.**
Enable **Create line if not found** with placement **Top** (or **Bottom**). QuickAdd inserts the heading on first use and places new content after it.

**You need to insert above a placeholder.**
Use **Before line...** instead of **After line...** and target the placeholder, such as `<!-- quickadd:notes -->`. See [Insert before](../Choices/CaptureChoice#insert-before) for the full setting.

**Capture writes to the wrong file.**
The date pattern in **File path / format** must match your vault's daily-note naming exactly. If your notes are named `2025.01.15.md` inside `Journal/`, use `Journal/{{DATE:YYYY.MM.DD}}.md`.

**Table rows or callout content breaks when using bottom-of-file placement.**
Use **After line...** with **Insert at end of section** instead of **Bottom of file**. Bottom-of-file placement starts non-task captures on a new line, and when the file already ends with a newline that leaves a blank line before the captured content. That blank line splits table rows and callout blocks.
