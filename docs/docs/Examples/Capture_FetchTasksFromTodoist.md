---
title: "Capture: Fetch Tasks From Todoist"
---

For this capture to work, you will need the Todoist plugin for Obsidian.
You will also need to set it up with your API key.

This is very useful for capturing tasks on the go with your phone, and then adding them to Obsidian when you get back to your computer.

You will need to set up a [macro](../Choices/MacroChoice.md) with the [Todoist Script](/scripts/TodoistScript.js).

The script has three exports, `SelectFromAllTasks`, `GetAllTasksFromProject`, and `GetAllTasksFromSection`.

-   `SelectFromAllTasks` will prompt you to select tasks from all tasks on your Todoist account,
-   `GetAllTasksFromProject` will prompt you for a project and get all tasks from that project, and
-   `GetAllTasksFromSection` will prompt you for a section and get all tasks from that section.

Personally, I just let QuickAdd ask me which one to execute.

However, when you are entering the user script in the macro, you can add `::GetAllTasksFromProject` (or, `::` followed by any of the other exports) to directly call one of the exported functions.

![Get all tasks from project](../Images/Todoist-GetAllTasksFromProject.png)

**IMPORTANT:** If you do _NOT_ want this script to complete tasks in Todoist that you put into your vault, remove the function call to `closeSelectedTasks`.

Now, you will need a [Capture choice](../Choices/CaptureChoice.md) with the following settings.

-   _Capture To File Name:_ the path to the file where you want to store the tasks.
-   _Capture format:_ Enabled - and in the format, write`{{MACRO:<MACRONAME>}}` where `MACRONAME` is the name of the macro that you made earlier.

The tasks are written in this format:
`- [ ] <Task Content> 📆 <YYYY-MM-DD>`

Which equals: `- [ ] Buy groceries 📆 2021-06-27`

This task will be recognized by the Tasks plugin for Obsidian, as well.
If there isn't a date set for the task, they'll simply be entered as `- [ ] Buy groceries`.

### Steps

_NOTE:_ If you simply follow the process below, you will be asked which export to execute each time.
That is fine - if you want to be asked - but you can also make separate [Capture choices](../Choices/CaptureChoice.md) for each exported function, meaning, it'll execute that function without asking you which one to execute.
Just set up the macro as shown in the image above.

1. Set up the Todoist plugin - grab the API key from your Todoist account. There's a link in the plugin's settings.
2. Grab the code block from the example and add it to your vault as a javascript file. I'd encourage you to call it something like todoistTaskSync.js to be explicit.
3. Follow along with what I do in the gif below

![GKkCNWZHLv](https://user-images.githubusercontent.com/29108628/123500983-26ad2880-d642-11eb-9e45-b537271312d1.gif)

### Installation video

https://user-images.githubusercontent.com/29108628/123511101-bde4a100-d67f-11eb-90c1-5bd146c5d0f2.mp4
