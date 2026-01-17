---
title: "Macro: Change properties in your daily notes (requires MetaEdit)"
---

This macro opens a suggester containing all properties in my daily journal note.

When I select one of them, I get prompted to add a value to it.

To use this, you need to change the path to your daily note - as this one only fits those similar to mine.
1. Change the date format from ``gggg-MM-DD - ddd MMM D`` to your daily notes' format.
2. Change the path to the daily note. Mine is in the ``bins/daily/`` folder - you should change yours such that it matches wherever your daily notes are.

Once you've done this, it'll work!

In case you already know which properties you want to change, and you don't want to get asked about the rest, you could just make an array containing the names of the properties instead. You'd pass that array to the ``suggester`` method.

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