---
title: "Template: Create an MOC Note with a Link Dashboard"
---

Use this pattern when you want QuickAdd to create a new map-of-content note
that already contains a live Base dashboard for both backlinks and outgoing
links.

## Why this pattern

A Template choice can create the note and insert the dashboard in one step.
The note stays markdown, while the embedded `.base` block gives you a live view
of how that note connects to the rest of your vault.

This works well for maps of knowledge, hub notes, topic notes, and evergreen
indexes.

## Setup

1. Create a reusable `.base` template, for example
   `Templates/MOC Link Dashboard.base`:

```yaml
formulas:
  note_link: "file.asLink()"
properties:
  formula.note_link:
    displayName: Note
  file.folder:
    displayName: Folder
  file.mtime:
    displayName: Updated
views:
  - type: table
    name: Backlinks
    filters:
      and:
        - 'file.ext == "md"'
        - "file.hasLink(this.file)"
        - "file.path != this.file.path"
    order:
      - formula.note_link
      - file.folder
      - file.mtime
  - type: table
    name: Outgoing links
    filters:
      and:
        - 'file.ext == "md"'
        - "this.file.hasLink(file)"
        - "file.path != this.file.path"
    order:
      - formula.note_link
      - file.folder
      - file.mtime
```

2. Create a markdown template, for example `Templates/MOC Link Dashboard.md`:

````markdown
---
tags:
  - moc
---

# {{VALUE:moc_title}}

## Link Dashboard

Use the view picker in this embedded base to switch between backlinks and
outgoing links for this note.

```base
{{TEMPLATE:Templates/MOC Link Dashboard.base}}
```

## Notes

- Start linking this note to related ideas.
````

3. Create a **Template** choice with settings like these:

- **Template Path**: `Templates/MOC Link Dashboard.md`
- **File Name Format**: `{{VALUE:moc_title}}`
- **Create in folder**: your MOC folder, for example `MOCs`
- **Open**: enabled
- **If the target file already exists**: `Create another file`
- **New file naming**: `Increment trailing number`

4. Run the Template choice and enter a title such as `Alpha Project`.

## What you get

QuickAdd creates a new markdown note with an embedded Base block.
Inside the note:

- `Backlinks` shows notes that link to the new MOC.
- `Outgoing links` shows notes the MOC links to.
- Both views use `this.file`, so the dashboard automatically scopes itself to
  the note that was just created.

After the note exists, add links in either direction and the dashboard updates
with the current graph around that note.

![MOC link dashboard template demo](../Images/template_moc_link_dashboard_demo.png)
