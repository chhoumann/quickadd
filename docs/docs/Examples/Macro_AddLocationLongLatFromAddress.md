---
title: "Macro: Add location long-lat from address"
---
This is especially useful for the [Obsidian Map View plugin](https://github.com/esm7/obsidian-map-view).

You can find the script [here](/scripts/getLongLatFromAddress.js).
Here is a [guide to installing user scripts](./Capture_FetchTasksFromTodoist.md) like this one.

1. Grab the script from [this page](/scripts/getLongLatFromAddress.js). This can be done in multiple ways:
   1. By clicking the 'Raw' button, and then saving the 'page' (CTRL+S on Windows, probably command+S on Mac), or
   2. Copying the file contents and saving it as `getLongLatFromAddress.js`. The `.js` is _crucial_.
2. Save the file to somewhere in your vault. It doesn't matter where, as long as it's in your vault.
3. Open QuickAdd settings, and then click 'Manage Macros'.
4. Enter a macro name (I call mine 'Mapper'), and click 'Add macro'.
5. The macro should appear. Click its 'Configure' button.
6. There will be 3 input fields. Place your cursor in the one besides 'User Scripts', and it should display a suggester. Assuming you have no other `.js` files in your vault besides the one we just grabbed, it should be the only one shown. Either way, you'll want to click it, and then click 'Add'. It should get added as number 1.
7. Go back to the QuickAdd main settings. Add a new choice with a name of your choosing. This choice should be a _Macro_ choice, which can be selected using the dropdown next to the 'Add Choice' button. Add this choice, and then
8. It will appear on the list of choices. Click the ⚙ (gear) button for it, to configure it.
9. Select the macro you've just created.
10. Go back out of the QuickAdd settings. You can now run QuickAdd with the `Run QuickAdd` command in the command palette. The Choice you've made should appear.

It adds a YAML property to the active file called ``location`` with `[lat, long]` as its value given the address you enter.

**Important:** Requires MetaEdit. If you have your edit mode in MetaEdit set to All Multi, do note that you will need to remove the braces on line 23 in the script, so it looks like this: ```await createYamlProperty("location", `${lat}, ${lon}`, activeFile);```.

![Demo](../Images/longLatDemo.gif)

