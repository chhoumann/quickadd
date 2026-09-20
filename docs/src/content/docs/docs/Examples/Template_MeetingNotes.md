---
title: "Create a meeting note and start typing"
description: Create a meeting note or add a project update, then keep typing where you put the CURSOR marker.
slug: docs/Examples/Template_MeetingNotes
---

Create a dated meeting note, answer one question, and start typing under **Notes**. Then use the same `{{CURSOR}}` marker to add an update to an existing project note.

These examples require QuickAdd 2.27.0 or later. They use QuickAdd's own templates, so you do not need Templater.

## Create the meeting template

Create folders named `Templates` and `Meetings` in your vault. In `Templates`, create a note named `Meeting` and paste this content:

```markdown title="Templates/Meeting.md"
# {{VALUE:Meeting}}

Date: {{DATE:YYYY-MM-DD}}

## Notes
- {{CURSOR}}

## Next steps
- [ ] 
```

`{{VALUE:Meeting}}` asks for the meeting name. `{{DATE:YYYY-MM-DD}}` fills in today's date. `{{CURSOR}}` marks where you want to type after QuickAdd creates the note.

## Configure the choice

1. Open **Settings → QuickAdd** and choose **New choice → Template**.
2. Click the choice name at the top of the settings window. Rename it `New meeting` and confirm with **Ok**.
3. Set **Template path** to `Templates/Meeting.md`.
4. Turn **File name format** on and enter:

   ```text
   {{DATE:YYYY-MM-DD}} {{VALUE:Meeting}}
   ```

5. Set **New note location** to **In a specific folder**.
6. Enter `Meetings` in **Folder path** and click **Add**. The folder must appear in the list above the input.
7. Turn **Open** on.
8. Set **File opening location** to **Reuse current tab** and **View mode** to **Live Preview**.
9. Choose **Done** and close Settings.

![The Template choice settings with Open enabled, File opening location set to Reuse current tab, and View mode set to Live Preview](https://files.bagerbach.com/meeting-open-settings-l3soft9zeju2.png)

## Run it and start typing

1. Open Obsidian's command palette and run **QuickAdd: Run**.
2. Choose **New meeting**.
3. Enter `Website planning` for **Meeting** and choose **Ok**.
4. Without clicking in the note, type `Agree on the first three pages.`

QuickAdd creates a note in `Meetings` with today's date in the file name. On September 20, 2026, that file is `Meetings/2026-09-20 Website planning.md`:

```markdown
# Website planning

Date: 2026-09-20

## Notes
- Agree on the first three pages.

## Next steps
- [ ]
```

The marker is gone, and your sentence appears in the first bullet under **Notes**. QuickAdd uses your meeting name in both the file name and the heading without asking twice.

![A meeting note created in Obsidian, with the title and date filled in and the first sentence typed under Notes](https://files.bagerbach.com/meeting-result-yb8zrgx044ko.png)

To start in **Next steps** instead, remove the marker from **Notes** and change the checklist line to `- [ ] {{CURSOR}}`. The first marker in the note body sets the cursor position. QuickAdd removes any additional markers.

## Add an update to an existing project

Use a second template when you want to keep a project's history in one note.

1. Create a `Templates` folder if you do not already have one. Create `Templates/Project update.md` with:

   ```markdown
   ## Update - {{DATE:YYYY-MM-DD}}

   ### Progress
   - {{CURSOR}}

   ### Next steps
   - [ ] 
   ```

2. Open **Settings → QuickAdd**.
3. Under **Templates & properties → Template folder paths**, enter `Templates` and click **Add**. If the folder is already listed, leave it as it is.
4. Close Settings.
5. Create a `Projects` folder and `Projects/Website.md` with:

   ```markdown
   # Website

   Build a clear three-page site for the pottery studio.

   ## Decisions
   - Start with Home, Work, and Contact.
   ```

6. Open `Projects/Website.md` in **Live Preview** or **Source mode** and click in the note body.
7. From the command palette, run **QuickAdd: Apply template to active note**.
8. Choose **Template: Templates/Project update.md**.
9. Choose **Append to bottom**.
10. Without clicking in the note, type `The homepage draft is ready for review.`

The file keeps its name, description, and **Decisions** section. QuickAdd adds a dated section at the bottom:

```markdown
## Update - 2026-09-20

### Progress
- The homepage draft is ready for review.

### Next steps
- [ ]
```

![Applying the Project update template in Obsidian, choosing Append to bottom, and typing into the new Progress bullet while the original Decisions remain above](https://files.bagerbach.com/project-update-demo-avxs1h3l2buy.gif)

Recorded in Obsidian; played at twice the original speed.

Apply this template again for the next update. You do not need a separate Template choice for this workflow.

## Use the marker in your own templates

Put `{{CURSOR}}` wherever you want to continue typing in the note body. The destination must be focused in an editing mode. For a Template choice that creates a note, turn **Open** on and choose **Live Preview** or **Source**. If you open a new tab or pane, also turn **Focus new pane** on.

For a note you already have open, use **Live Preview** or **Source mode**. The marker does not switch a note out of Reading view or bring a background tab into focus.

See [cursor position](/docs/FormatSyntax/#cursor) for the full behavior and [Apply Template to Note](/docs/ApplyTemplateToNote/) for the other insertion modes.
