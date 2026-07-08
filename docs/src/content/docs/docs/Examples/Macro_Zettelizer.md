---
title: Zettelizer
description: Create a linked note from each heading of a chosen level in your active file, naming it after the heading text
slug: docs/Examples/Macro_Zettelizer
---

This macro turns the headings of your active note into separate linked notes. For each heading of the level you choose, it creates a new note named after the heading text and links back to that heading - a fast way to break a big note into atomic, connected notes.

![Zettelizer Demo](../Images/zettelizer_demo.gif)

## Setup

Get the `.js` file for this user script <a href="/scripts/zettelizer.js" download>here</a>, then add it to a Macro choice. To install it, follow the same process as in the [fetch tasks from Todoist example - with video](/docs/Examples/Capture_FetchTasksFromTodoist/), and see [the Macro choice docs](/docs/Choices/MacroChoice/) for a full walkthrough of creating a macro.

Next, define the folder you want the script to place the new notes in.

This can be done on line 19, where it says ``const folder = "..."``. Change the text inside the `""` to match the desired folder path.

Currently, the script _only_ looks for level 3 headers. This means headers with three pound symbols, like so ``### header``.

You can freely change this. On line 29 it says ``if (heading.level === 3)``. You can change this to any other number, denoting the heading level desired. You can also, rather than checking for equality (`===`), check for other conditions, such as `heading.level >= 1`, which denotes headers of level 1 or greater.

The script looks for headers in your active file with the desired level.
If such a header is found, it will ignore the first 'word' (any sequence of characters - i.e., letters, numbers, symbols, etc - followed by a space). Then, it will create a file with a name containing the remaining text in the heading.

In that file, it will link to the heading it created the file from.