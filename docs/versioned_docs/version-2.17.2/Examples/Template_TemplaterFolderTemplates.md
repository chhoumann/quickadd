---
title: "Template: Reuse Templater Folder Templates"
---

If you use [Templater's](https://github.com/SilentVoid13/Templater) folder
templates, a QuickAdd Template choice normally needs its own template path -
so you end up maintaining the folder-to-template mapping in two places.

This recipe removes the duplication. A small
[Templater user script](https://silentvoid13.github.io/Templater/user-functions/script-user-functions.html)
reads the mapping from Templater's own settings, and a one-line shim template
includes whichever template is configured for the destination folder. One
QuickAdd choice then works for every folder that has a Templater folder
template.

## 1. Create the user script

Save the following as `folder_template.js` in your Templater user scripts
folder (set under Templater's "User script functions" settings). The file name
matters: Templater exposes it as `tp.user.folder_template`.

```js
/**
 * Resolve the Templater template configured for a given folder, via the
 * Templater plugin's folder-template settings.
 * @param {string} folderPath - Folder path to look up, matched exactly against `folder_templates[].folder`.
 * @returns {string | undefined} The configured template path, or `undefined` if Templater is disabled or the folder has no mapping.
 */
function folderTemplate(folderPath) {
  let templater = app.plugins.plugins["templater-obsidian"];
  if (!templater) return;

  const folderTemplates = templater.settings.folder_templates;
  const templateByFolder = folderTemplates.find((t) => t.folder === folderPath);
  if (!templateByFolder) return;
  return templateByFolder.template;
}

module.exports = folderTemplate;
```

## 2. Create the shim template

Create a new template file, for example `QuickAdd.md`, containing only:

```
<% tp.file.include("[[" + tp.user.folder_template(tp.file.folder(true)) + "]]") %>
```

When Templater processes the new note, this looks up the note's folder and
includes the template configured for it.

## 3. Create the Template choice

Add a Template choice in QuickAdd's settings:

- **Template Path**: `QuickAdd.md` (the shim template)
- **Create in folder**: a folder that has a folder template configured in
  Templater's settings

Running the choice creates the note in that folder, and the shim pulls in the
correct Templater template automatically. If the choice offers several
folders, each one resolves to its own configured template.

## Limitations

- The lookup matches the folder path exactly against Templater's
  folder-template list. Unlike Templater's own trigger, it does not fall back
  to a template configured on a parent folder.
- If the destination folder has no folder template configured, the include
  fails with a Templater error. Only point the choice at folders that have a
  mapping.

Contributed by [@codedpalette](https://github.com/codedpalette) in
[discussion 1105](https://github.com/chhoumann/quickadd/discussions/1105).
