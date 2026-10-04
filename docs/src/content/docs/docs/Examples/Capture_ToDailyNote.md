---
title: "Capture: Add entries to your daily note"
description: Cookbook of Capture recipes that add timestamped lines, tasks, quotes, callouts, and table rows to today's daily note
slug: docs/Examples/Capture_ToDailyNote
package: daily-note-captures
---

This cookbook gives you one QuickAdd choice that adds text to today's daily note - even when the note or the target heading doesn't exist yet.

Every recipe starts from the same base Capture choice; you only change the **Capture format** and the target heading.

## Base setup

The package above needs QuickAdd 2.30.0 or later. On an earlier version, the package writes its captures to a note named `{{DAILY}}.md`, so build the capture by hand with the base setup below instead.

Imported the package above? Follow **After importing** in the card, then skip the base setup below. [Recipes](#recipes) explains what each imported capture does and how to add more.

1. In **Settings → QuickAdd**, click **New choice** → **Log with a timestamp**. The Capture builder opens as a page of the settings window; set **Name** to `Daily entry`. The preset already does steps 2 to 8 below, with `## Log` as the heading, so check them and change the heading to your own. (Before QuickAdd 2.30.0, the builder is a dialog; click its name at the top to rename it.)
2. Disable **Capture to active file**.
3. Click **Daily note** next to **Capture to** (QuickAdd 2.30.0 or later). It fills in `{{DAILY}}`, which uses the folder, date format, and template from Obsidian's **Daily notes** settings, or from Periodic Notes when it manages your daily notes. On earlier versions, type your daily-note path and date pattern instead, for example `Daily/{{DATE:YYYY-MM-DD}}.md`.
4. Make sure **Create file if it doesn't exist** is on. The **Daily note** button turns it on. On earlier versions, turn it on yourself; to start a new note from your daily-note template, also turn on **Create file with a template** and pick the template.
5. Set **Write position** to **After line...**.
6. In the **Insert after** field, enter the heading you want entries placed under, for example `## Journal`.
7. Make sure **Insert at end of section** is on, so each capture appends at the bottom of the section.
8. Make sure **Create line if not found** is on, and set its placement to **Bottom**, so a note that lacks the heading gets it at the end instead of above its title. A new Capture starts with **Insert at end of section** and **Create line if not found** on in QuickAdd 2.30.0 or later; on earlier versions, turn them on.
9. Leave **Link to captured file** disabled.
10. Fill in **Capture format** with one of the recipes below.

## Recipes

Each recipe shows what to change from the base setup. Before QuickAdd 2.30.0, turn on the **Capture format** toggle to type a recipe.

### Timestamped journal line

Keep **Insert after** set to `## Journal`.

**Capture format:**

```
- {{DATE:HH:mm}} {{VALUE}}
```

Produces:

```markdown
## Journal
- 18:54 first journal entry
- 18:55 second journal entry
```

Before QuickAdd 2.30.0, end each recipe's format with `\n` (for example `- {{DATE:HH:mm}} {{VALUE}}\n`). Without it, a capture at the end of a section removes the blank line before the next heading.

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
> {{VALUE}}
```

Change the **Create line if not found** placement to **Top**, so on first use the callout opener goes at the top of the note. At **Bottom**, the opener lands inside the section of the heading above it, such as `## Quotes`, and the next capture to that heading goes into the callout. Before QuickAdd 2.31.0, an opener added right after a quoted line also joined that blockquote and didn't render as a callout. To have the callout below the note's title, put the opener line in your daily notes template instead. Each subsequent capture appends before the next blank line or heading, so keep the callout as one contiguous quoted block. The `>` prefix is required to keep the entry inside the callout block.

### Quote

Change **Insert after** to `## Quotes`.

**Capture format:**

```
> {{VALUE}}
```

Same format as the callout recipe but targeting a regular heading. Produces a blockquote line under the section.

### Table row

Use this when the daily note already has a table under a heading and the table is the last block in that section. Keep **Write position** as **After line...**, set **Insert after** to the heading above the table, and keep **Insert at end of section** enabled. If more content follows the table in the same section, target the table separator row instead.

**Capture format:**

```
| {{DATE:HH:mm}} | {{VALUE}} |
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

With **Capture to** set to `{{DAILY}}`, set **Which day** to **Custom…**, one day forward. `{{DAILY}}` follows [Which day](/docs/Choices/TemplateChoice/#date-origin), so the capture targets tomorrow's note and creates it from your daily notes template.

With a typed path, change **Capture to** to:

```
Daily/{{DATE:YYYY-MM-DD+1}}.md
```

The `+1` shifts the target date one day forward. Combine with any of the formats above.

## Troubleshooting

**Pasted multiple lines became one task.**
The **Task** setting wraps the whole capture once. Turn on [**One entry per line**](/docs/Choices/CaptureChoice/#one-entry-per-line) (QuickAdd 2.30.0 or later) to make each line its own task.

**The heading is not found and capture fails.**
Turn on **Create line if not found** with placement **Bottom** (or **Top**). QuickAdd inserts the heading on first use and places new content after it.

**You need to insert above a placeholder.**
Use **Before line...** instead of **After line...** and target the placeholder, such as `<!-- quickadd:notes -->`. See [Insert before](/docs/Choices/CaptureChoice/#insert-before) for the full setting.

**Capture writes to the wrong file.**
Use `{{DAILY}}` in **Capture to**, which reads the path from your Daily notes settings. With a typed path, the date pattern must match your vault's daily-note naming exactly. If your notes are named `2025.01.15.md` inside `Journal/`, use `Journal/{{DATE:YYYY.MM.DD}}.md`.
