---
title: Share QuickAdd Packages
description: Bundle choices, macros, and scripts into a .quickadd.json file to move between vaults, with a capability review before importing
slug: docs/Choices/Packages
---

A package bundles choices, macros, and their supporting scripts into a single
`.quickadd.json` file. Use one to move a workflow to another vault or share it
with someone else - they import the file and get your choices without rebuilding
anything by hand. Importing shows a full review of what the package can do first,
so you always see the scripts and macros before they run.

## Export a package {#export-a-package}

1. Open **Settings → QuickAdd** and scroll to the choices list.
2. Click **Export package…** in the Packages setting.
3. Use the filter to find the choices you want to share, then tick their
   checkboxes. Any dependent choices or scripts are added automatically.
4. Review the summary panel to confirm how many choices and assets are included.
5. Choose **Copy JSON** (puts the package on your clipboard) or **Save to file**.
   When saving, QuickAdd creates any missing folders inside your vault
   automatically.

:::caution
If a referenced script is missing from your vault, the exporter finishes with a
warning so you can locate or recreate the file before you share the package.
:::

## Import a package {#import-a-package}

1. Open **Settings → QuickAdd** and click **Import package…**.
2. Paste the full contents of a `.quickadd.json` file into the text box.
3. QuickAdd analyses the JSON and shows a **review** of exactly what the package
   will add and run before you commit - see [Review what a package can do](#review-what-a-package-can-do).
4. Under **Choices**, pick an action for each choice:
   - **Import** adds a new choice only when its ID does not already exist.
   - **Overwrite** keeps the original ID and replaces the existing choice.
   - **Duplicate** copies the choice with new IDs so you can keep both versions.
   - **Skip** leaves the choice untouched.
5. Under **Files**, each bundled file is grouped as **Added** or **Will
   overwrite**. Choose **Write**, **Overwrite**, or **Skip** per file, and adjust
   the destination path if you want it saved elsewhere (templates default to your
   QuickAdd template folder when one is set). QuickAdd updates the imported
   choices to reference the new locations.
6. If the package runs code, tick the acknowledgement, then click **Import
   package**. The choices list updates immediately and a notice summarises what
   changed.

:::note
QuickAdd rebuilds your choice hierarchy from the stored parent IDs and path
hints. If it cannot find the original parent - for example, the destination
vault does not contain the same multi-choice folder - the imported choice lands
at the root and a warning is logged.
:::

## Review what a package can do {#review-what-a-package-can-do}

Importing a package can run scripts and macros that have full access to your
vault and the network, so the import screen treats it as a trust decision: it
makes everything visible **before** anything is written.

### What the package can do to your vault {#capability-summary}

A **What this package can do** panel lists the package's capabilities, ranked by
how much they can affect your vault:

- **Runs custom JavaScript** - a user script, or a script-mode condition, that runs arbitrary code.
- **Runs on startup** - a macro set to run automatically every time Obsidian launches, with no interaction.
- **Adds commands** - choices that register a command in the palette / hotkeys.
- **Overwrites existing choices or files**, **sends content to an AI provider**, **triggers other Obsidian commands**, and similar.

Each row names the choice it comes from. Hover any badge for a plain-language
explanation of what it means.

### Read the files before you trust them {#read-the-files-before-you-trust-them}

Every bundled file appears under **Files** with its destination and size. Click
**View contents** to read a script or template exactly as it will be written.
Files that are run as code are marked **Executable** (regardless of their
declared type), and very long or minified scripts are flagged as not fully
reviewable.

### Acknowledge the code before importing {#acknowledgement-gate}

When a package can run code, the **Import package** button stays disabled until
you have opened **View contents** on each bundled executable script and ticked
the acknowledgement. Reviewed scripts are marked so you can track what is left.

:::caution
If a referenced script is **not** bundled, QuickAdd warns that it will run from
whatever file already exists at that path after import.
:::

### Preview a package from the command line {#preview-from-the-command-line}

For scripting or CI, the `quickadd:package-preview` command returns the same
review as JSON, without opening the modal:

```bash
obsidian quickadd:package-preview path=path/to/package.quickadd.json
```

Add `decode=true` to inline the decoded contents of each bundled file.

## Check version compatibility {#version-compatibility}

Packages record the QuickAdd version and a schema number, so future releases can
warn you when a file needs a newer plugin. If you see a schema version error,
upgrade QuickAdd in both vaults and export the package again.
