---
title: "Macro: Add location long-lat from address"
---
This is especially useful for the [Obsidian Map View plugin](https://github.com/esm7/obsidian-map-view).

You can find the script <a href="/scripts/getLongLatFromAddress.js" download>here</a>.
Here is a [guide to installing user scripts](./Capture_FetchTasksFromTodoist.md) like this one.

1. Grab the script from <a href="/scripts/getLongLatFromAddress.js" download>this page</a>. This can be done in multiple ways:
   1. By clicking the 'Raw' button, and then saving the 'page' (CTRL+S on Windows, probably command+S on Mac), or
   2. Copying the file contents and saving it as `getLongLatFromAddress.js`. The `.js` is _crucial_.
2. Save the file to somewhere in your vault. It doesn't matter where, as long as it's in your vault.
3. Open QuickAdd settings, click 'New choice', and select 'Macro' from the menu. This creates a Macro choice and opens the Macro Builder.
4. Give the choice a name of your choosing (I call mine 'Mapper'). You can rename it by clicking its title at the top of the Macro Builder. If you close the builder, click the ⚙ (gear) 'Configure' button on the choice in the list to reopen it.
5. In the Macro Builder, find the 'User Scripts' input. Place your cursor in it and it should display a suggester. Assuming you have no other `.js` files in your vault besides the one we just grabbed, it should be the only one shown. Either way, you'll want to click it, and then click 'Add' (you can also click 'Browse' to pick the script file). It should get added as the first command.
6. Close the QuickAdd settings. You can now run QuickAdd with the `QuickAdd: Run` command in the command palette. The choice you've made should appear.

It adds a YAML property to the active file called ``location`` with `[lat, long]` as its value given the address you enter.

**Important:** Requires MetaEdit. If you have your edit mode in MetaEdit set to All Multi, do note that you will need to remove the braces on line 23 in the script, so it looks like this: ```await createYamlProperty("location", `${lat}, ${lon}`, activeFile);```.

![Demo](../Images/longLatDemo.gif)

