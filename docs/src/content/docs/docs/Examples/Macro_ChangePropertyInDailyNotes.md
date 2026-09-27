---
title: "Macro: Change properties in your daily notes"
description: Update a property in your daily note by picking it from a suggester and entering a new value, using Obsidian's frontmatter API
slug: docs/Examples/Macro_ChangePropertyInDailyNotes
package: change-daily-property
---

This macro lists every property in today's daily journal note in a menu. Pick one, type a new value, and the macro writes it back - a quick way to update a property without opening the note or editing frontmatter by hand.

## Before you start

- Today's daily journal note must exist at the path set in the script's **Daily note path** setting, and the property you want to change must already be in its frontmatter; the menu only lists existing properties.

## Setup

Imported the package above? The script and the **Change daily note property** macro are already in place; set **Daily note path** as in step 4, then run it.

1. <a href="/scripts/changeDailyProperty.js" download>Download changeDailyProperty.js</a> and save it somewhere in your vault (not inside the `.obsidian` folder). See [the user scripts guide](/docs/UserScripts/) for how QuickAdd loads scripts.
2. In **Settings → QuickAdd**, click **New choice** → **Macro**. The Macro Builder opens; click its name at the top to rename it (for example, `Change property`). See [the Macro choice docs](/docs/Choices/MacroChoice/) for a full walkthrough.
3. In the Macro Builder, add your script as a **User Script** command.
4. Click the cog on the script step and set **Daily note path** to where your daily notes live, with your daily notes' date format, for example `bins/daily/{{DATE:gggg-MM-DD - ddd MMM D}}.md`.

Run the macro, choose a property from the menu, and enter its new value. If the old value was a number or `true`/`false` and the new text still is one, it is written back as a number or boolean; otherwise as text.

If you already know which properties you want to change and don't want to be asked about the rest, edit the script and replace `keys` with a plain array of property names. You'd pass that array to the `suggester` method instead.
