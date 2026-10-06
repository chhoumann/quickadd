---
title: Buttons in notes
description: "Put buttons that run QuickAdd choices in any note with a quickadd code block: a toolbar on a dashboard note, a tap on your phone"
slug: docs/Choices/NoteButtons
---

A `quickadd` code block in a note shows as a row of buttons. Each button runs
a choice, the same as running it from the command palette. Put one at the top
of a dashboard or daily note and your most used choices are a click, or a tap
on your phone, away. Nothing else to install.

````markdown
```quickadd
Log
Task
Meeting note
```
````

Each button shows the choice's icon and name. Hover over it to see what the
choice does, the same line the settings list shows under its name. The buttons
show in reading view and in live preview; in source mode you see the block's
text.

## The block {#the-block}

Write one choice per line. Blank lines are skipped, and so is a line that
starts with `#`, so you can leave notes for yourself in the block:

````markdown
```quickadd
# Morning
Log
Task
```
````

A line names a choice by its name, exactly as it reads in **Settings →
QuickAdd**. When no choice has that exact name, a choice whose name differs
only in upper and lower case counts too. Choices inside folders count.

## Names and ids {#names-and-ids}

A name breaks when you rename the choice, and it can't tell two choices with
the same name apart. A line can name the choice by its id instead, which stays
the same through renames:

````markdown
```quickadd
id: 2b60f8ae-56ce-4367-b16b-f9415e94a872
```
````

When a line doesn't find exactly one choice, its button is greyed out and says
why: `No choice named 'Log'` or `Several choices named 'Log'`. Rename the
choice back, fix the line, or switch it to the choice's id.

Open notes follow your choices: rename a choice, add one, or delete one, and
the buttons in open notes update straight away.

## Labels {#labels}

To show something other than the choice's name, put a label after a pipe:

````markdown
```quickadd
Log | Add to journal
id: 2b60f8ae-56ce-4367-b16b-f9415e94a872 | New meeting
```
````

## Copy button block {#copy-button-block}

You don't have to write the block yourself. In **Settings → QuickAdd**,
right-click a choice, or click its **More options** button, and pick **Copy
button block**. QuickAdd puts a block with a button for that choice on the
clipboard, ready to paste in a note. The block names the choice, or uses its
id when another choice has the same name.

To make a row of several buttons, copy each and put their lines in one block.

## On a phone {#on-a-phone}

A button is a tap: it runs the choice and opens its prompts as the command
would. On a phone the buttons are taller, so they are easy to hit, and the row
wraps onto more lines when it doesn't fit the screen.

While a choice runs, its button is greyed out, so a second tap doesn't start
it twice. It comes back when the run finishes or you cancel it.
