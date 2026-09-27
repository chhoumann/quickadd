---
title: "Macro: Move notes with a tag to a folder"
description: Move every note carrying a chosen tag to a target folder, matching both frontmatter and inline tags, via a macro script
slug: docs/Examples/Macro_MoveNotesWithATagToAFolder
package: move-tagged-notes
---

This macro moves every note carrying a tag you pick into a folder you pick. It matches the tag whether it lives in a note's frontmatter or inline in the body, and it can optionally include nested tags (for example `#project/work` when you choose `#project`). No extra plugins are needed - it uses only Obsidian's own API.

![Running the macro: picking the #website tag, answering No to nested tags, and choosing Projects/Website moves both tagged notes out of Inbox](../Images/move_tagged_notes_demo.gif)

## Setup

Imported the package above? The script and the **Move notes with a tag** macro are already in place; skip the setup steps and read how to run it below.

1. Save the <a href="/scripts/moveNotesWithTag.js" download>Move notes with a tag script</a> to your vault, for example as `scripts/moveNotesWithTag.js` (not inside the `.obsidian` folder). See [the user scripts guide](/docs/UserScripts/) for how QuickAdd loads scripts.
2. In **Settings → QuickAdd**, click **New choice** → **Macro**. The Macro Builder opens; click its name at the top to rename it (for example, `Move tagged notes`). See [the Macro choice docs](/docs/Choices/MacroChoice/) for a full walkthrough.
3. In the Macro Builder, add your script as a **User Script** command.

Back up your vault before you run it: the move happens as soon as you pick the folder, with no preview or undo. Run the macro, pick a tag, choose whether nested tags count too, then pick the destination folder; the folder menu shows how many notes will move. Notes whose path contains `template` (in any case, such as `Templates/`) are left where they are.

