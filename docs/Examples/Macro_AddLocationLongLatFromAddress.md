This is especially useful for the [Obsidian Map View plugin](https://github.com/esm7/obsidian-map-view).

You can find the script [here](./Attachments/getLongLatFromAddress.js).
Here is a [guide to installing user scripts](./Capture_FetchTasksFromTodoist.md) like this one.

It adds a YAML property to the active file called ``location`` with `[lat, long]` as its value given the address you enter.

**Important:** Requires MetaEdit. If you have your edit mode in MetaEdit set to All Multi, do note that you will need to remove the braces on line 23 in the script, so it looks like this: ```await createYamlProperty("location", `${lat}, ${lon}`, activeFile);```.

![Demo](../Images/longLatDemo.gif)
