---
title: Multis
description: Group choices into collapsible folders in the QuickAdd picker, with placeholder text, custom icons, and search across nested choices
slug: docs/Choices/MultiChoice
---

A Multi is a **folder for your other choices**. Group related choices under one
entry in the QuickAdd picker, then open it to see what's inside - handy once your
picker grows past a handful of items. In the settings list, a Multi is the entry
you can fold and unfold.

![The Multi choice settings modal](../Images/choices/multi-choice.png)

## Put choices inside a multi {#add-choices}

You add a choice to a multi by **dragging it in**. Make sure the multi is
unfolded (as in the screenshot above), grab the drag handle of the choice you
want to move, and drop it just below and slightly to the right of the multi's
own drag handle. When it works, the choice appears indented under the multi.

:::tip
The first choice is the fiddly one, since there's nothing nested yet to aim for.
Drop it just below and to the right of the multi's drag handle and watch for the
indent. Once one choice is inside, the rest are easy.
:::

## Set the search box hint: Placeholder text {#placeholder-text}

Each multi can show its own hint in the choice picker's search box when you open
it - useful for labeling a complex menu or a grouped workflow. Leave it empty and
the multi's name is used instead.

Because [search reaches everything nested under the multi](#searching-nested-choices),
word the hint for the whole group, not just the top level.

## Change a choice's icon {#icons}

Choices in the QuickAdd picker use the same Obsidian/Lucide icons as registered
QuickAdd commands. Every choice type has a default icon, and you can override it
from the choice's **Icon** setting. Icons are monochrome and take on your active
Obsidian theme color.

## Search across nested choices {#searching-nested-choices}

Typing in the choice picker searches every choice nested inside the current
level's multis, not just the level you are looking at. A nested match shows its
folder path (for example `Work / Meetings`) beneath the choice name. This also
applies to the root picker opened by the **QuickAdd: Run** command or the ribbon
icon.

Good to know:

- Browsing is unchanged: with an empty search box, you still see one level at a time.
- The search also matches the folder path, so `work meeting` finds `New meeting` inside `Work / Meetings`.
- Selecting a nested multi from the results opens it. Its **← Back** entry returns to the level you searched from, skipping any levels in between.
- Searching from inside a multi only covers that multi's sub-choices. Go back (or open the root picker) to search more broadly.

To limit search to the level you have open, turn off **Settings → QuickAdd →
Search nested choices**.
