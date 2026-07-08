---
title: "Capture: Add a Task to a Kanban Board"
description: Add a task to a chosen lane on an Obsidian Kanban board by capturing after the lane heading, with optional date formatting
slug: docs/Examples/Capture_AddTaskToKanbanBoard
---

You end up with one QuickAdd command that drops whatever you type onto a Kanban board as a card in the lane you choose - without opening the board first.

## Prerequisites

- The [Kanban](https://github.com/mgmeyers/obsidian-kanban) community plugin, installed and enabled.
- A Kanban board with at least one lane. Each lane is a Markdown heading, for example `## Backlog`.

## Setup

1. In QuickAdd settings, add a new **Capture** choice and name it (for example, `Add to board`).
2. Open its settings.
3. Set **Capture to** to your Kanban board file.
4. Enable the **Task** toggle (in the **Content** section). This wraps your text in `- [ ]` so Kanban reads it as a card.
5. Set **Write position** to **After line…**.
6. In the **Insert after** field that appears, write `## ` followed by the name of the lane you want to add the card to. For a lane called `Backlog`, that is `## Backlog`.

## What you get

You run the choice, type `Buy milk`, and QuickAdd adds `- [ ] Buy milk` as a new card at the top of the `Backlog` lane.

## Add a date to the card

Kanban recognizes a date written as `@{YYYY-MM-DD}` on a card. Enable **Capture format** and set the format to add one:

- Use today's date automatically:

  ```
  {{VALUE}} @{{{DATE}}}
  ```

- Get asked which date to use each time:

  ```
  {{VALUE}} @{{{VDATE:DATE,gggg-MM-DD}}}
  ```

  You can type an exact date or a natural-language date such as `tomorrow`.

Read more about [format syntax here](/docs/FormatSyntax/).

![A Capture choice that adds a task to a board](../Images/examples/capture-add-task.png)
