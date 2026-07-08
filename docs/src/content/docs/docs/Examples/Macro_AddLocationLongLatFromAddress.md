---
title: "Macro: Add location long-lat from address"
description: Macro and user script that geocode an address into a location latitude-longitude property on the active note, for the Map View plugin
slug: docs/Examples/Macro_AddLocationLongLatFromAddress
---

This macro asks you for an address, looks up its coordinates, and adds a `location` property with `[lat, long]` as its value to the note you have open. It is especially useful for the [Obsidian Map View plugin](https://github.com/esm7/obsidian-map-view), which reads that property to place notes on a map.

## Before you start

- The [MetaEdit plugin](https://github.com/chhoumann/MetaEdit) must be installed and enabled. This macro uses MetaEdit's `createYamlProperty` function to write the property.

## Setup

1. Grab the script from [this page](/scripts/getLongLatFromAddress.js). You can either click the download link, or copy the file contents and save them as `getLongLatFromAddress.js`. The `.js` extension is essential.
2. Save the file anywhere in your vault (not inside the `.obsidian` folder). For a fuller walkthrough with video, see [the guide to installing user scripts](/docs/Examples/Capture_FetchTasksFromTodoist/).
3. In QuickAdd settings, click **Add Choice**, select **Macro**, and give it a name (I call mine `Mapper`). This creates a Macro choice and opens the Macro Builder. If you close the builder, click the gear (Configure) button on the choice in the list to reopen it. See [the Macro choice docs](/docs/Choices/MacroChoice/) for a full walkthrough.
4. In the Macro Builder, place your cursor in the **User Scripts** field to bring up a suggester, pick `getLongLatFromAddress.js` (or click **Browse** to select the file), and click **Add**. It should appear as the first command.
5. Close the QuickAdd settings.

## What you get

Run the macro with the `QuickAdd: Run` command in the command palette and pick your choice. Enter an address, and QuickAdd adds a `location` property to the active note whose value is `[lat, long]` for that address.

![Demo](../Images/longLatDemo.gif)

:::note
If you have MetaEdit's edit mode set to **All Multi**, remove the braces on line 23 of the script so it reads:

```js
await createYamlProperty("location", `${lat}, ${lon}`, activeFile);
```
:::
