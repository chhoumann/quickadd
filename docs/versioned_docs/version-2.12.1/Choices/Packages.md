---
sidebar_position: 5
title: Share QuickAdd Packages
---

QuickAdd can bundle choices, macros, and their supporting scripts into a single
`.quickadd.json` package. Packages let you move automations between vaults or
share them with other users without rebuilding every choice by hand.

## Export a package

1. Open **Settings → QuickAdd** and scroll to the choices list.
2. Click **Export package…** in the Packages setting.
3. Use the filter to find the choices you want to share, then tick their
   checkboxes. Any dependent choices or scripts are added automatically.
4. Review the summary panel to confirm how many choices and assets will be
   included.
5. Choose whether to **Copy JSON** (places the package on your clipboard) or
   **Save to file**. When saving, QuickAdd creates missing folders inside your
   vault automatically.

If a referenced script is missing from your vault, the exporter finishes with a
warning so you can locate or recreate the file before distributing the package.

## Import a package

1. Open **Settings → QuickAdd** and click **Import package…**.
2. Paste the full contents of a `.quickadd.json` file into the text box.
3. QuickAdd analyses the JSON automatically and lists the choices and assets it
   contains:
   - **Import** adds a new choice only when its ID does not already exist.
   - **Overwrite** keeps the original ID and replaces the existing choice.
   - **Duplicate** copies the choice with new IDs so you can keep both versions.
   - **Skip** leaves the choice untouched.
4. For each asset, choose **Write**, **Overwrite**, or **Skip**, and adjust the
   destination path if you want it saved elsewhere (templates default to your
   QuickAdd template folder when set). QuickAdd automatically updates the
   imported choices to reference the new locations.
5. Click **Import package**. The choices list updates immediately and a notice
   summarises what changed.

QuickAdd preserves choice hierarchy using the stored parent IDs and path hints.
If QuickAdd cannot locate the original parent (for example, the destination
vault does not contain the same multi-choice folder), the imported choice is
added to the root and a warning is logged.

## Version compatibility

Packages record the QuickAdd version and a schema number so future releases can
warn you if the file requires a newer plugin version. If you see a schema
version error, upgrade QuickAdd in both vaults and export the package again.
