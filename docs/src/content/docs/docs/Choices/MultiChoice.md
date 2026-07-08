---
title: Multis
description: Group choices into collapsible folders in the QuickAdd picker, with placeholder text, custom icons, and search across nested choices
slug: docs/Choices/MultiChoice
---

Multi-choices are pretty simple. They're like folders for other choices. Here are mine. They're the ones which you can 'open' and 'close'.

![The Multi choice settings modal](../Images/choices/multi-choice.png)

To actually add something in this "folder", you need to drag it in! This is not easy to do when it is the first item in the multi-folder.

Make sure the multi is unfolded (as it is in the screenshot). Click the drag handle of one of the choices you want to add and drag it to just below and to the right of the drag handle for the multi. When successful, the choice will be indented under the multi.

## Placeholder text

You can optionally set a placeholder for each Multi choice. This text shows up in the choice picker search box when you open the multi, which is handy for complex menus or grouped workflows. Leave it empty to use the multi name as the placeholder.

Keep in mind that [searching covers everything nested under the multi](#searching-nested-choices), so word the placeholder accordingly.

## Icons

Choices shown in the QuickAdd picker use the same Obsidian/Lucide icons as registered QuickAdd commands. Each choice type has a default icon, and you can override it from the choice's **Icon** setting. Icons are monochrome and inherit the active Obsidian theme color.

## Searching nested choices

Typing in the choice picker searches every choice nested inside the current level's multis — not just the level you are looking at. Nested matches show their folder path (for example `Work / Meetings`) beneath the choice name. This also applies to the root picker opened by the **QuickAdd: Run** command or the ribbon icon.

A few details:

- Browsing is unchanged: with an empty search box, you still see one level at a time.
- Your search also matches against the folder path, so `work meeting` finds `New meeting` inside `Work / Meetings`.
- Selecting a nested multi from search results opens it. Its **← Back** entry returns to the level you searched from, skipping intermediate levels.
- Searching from inside a multi only covers that multi's sub-choices. Go back (or open the root picker) to search more broadly.

If you prefer search to only cover the level you have open, disable **Settings → QuickAdd → Search nested choices**.
