---
title: "Macro: Change properties in your daily notes (requires MetaEdit)"
description: Update a property in your daily note by picking it from a suggester and entering a new value, using the MetaEdit API
slug: docs/Examples/Macro_ChangePropertyInDailyNotes
---

This macro lists every property in today's daily journal note in a menu. Pick one, type a new value, and the macro writes it back - a quick way to update a property without opening the note or editing frontmatter by hand.

## Before you start

- The [MetaEdit plugin](https://github.com/chhoumann/MetaEdit) must be installed and enabled. This macro calls MetaEdit's `getPropertiesInFile` and `update` functions.

## Setup

1. Save the script below to a `.js` file somewhere in your vault (not inside the `.obsidian` folder). See [the user scripts guide](/docs/UserScripts/) for how QuickAdd loads scripts.
2. In QuickAdd settings, click **Add Choice**, select **Macro**, and name it (for example, `Change property`). See [the Macro choice docs](/docs/Choices/MacroChoice/) for a full walkthrough.
3. Click the configure button (the gear icon) to open the Macro Builder, then add your script as a **User Script** command.
4. Edit the script to point at your own daily notes:
   - Change the date format from `gggg-MM-DD - ddd MMM D` to match your daily notes' file names.
   - Change the path from `bins/daily/` to wherever your daily notes live.

Run the macro, choose a property from the menu, and enter its new value.

If you already know which properties you want to change and don't want to be asked about the rest, replace the suggester's property list with a plain array of property names. You'd pass that array to the `suggester` method instead.

````js
module.exports = async (params) => {
    const {quickAddApi: {inputPrompt, suggester}} = params;
    const {update, getPropertiesInFile} = app.plugins.plugins["metaedit"].api;
    const date = window.moment().format("gggg-MM-DD - ddd MMM D");
    const dailyJournalFilePath = `bins/daily/${date}.md`;

    const propertiesInDailyJournal = await getPropertiesInFile(dailyJournalFilePath);
    const targetProp = await suggester(propertiesInDailyJournal.map(p => p.key), propertiesInDailyJournal);

    const newPropertyValue = await inputPrompt(`Log ${targetProp.key}`, targetProp.content, targetProp.content);
    
    await update(targetProp.key, newPropertyValue, dailyJournalFilePath);
}
````