---
title: FAQ
---

## Syncing QuickAdd between devices

QuickAdd saves its choices and settings in
`<vault>/.obsidian/plugins/quickadd/data.json`. If your sync setup includes
Obsidian's configuration folder, that file carries your Template, Capture,
Macro, Multi choices, global variables, and normal QuickAdd settings to the
other device.

Two things are separate from `data.json`:

- QuickAdd has to be installed and enabled on the other device. Obsidian stores
  enabled community plugins in `<vault>/.obsidian/community-plugins.json`.
- SecretStorage-backed values are local. If QuickAdd stores an API key or
  script secret setting in Obsidian's SecretStorage, enter it on each device
  that needs it.

After your sync tool reports that the files have arrived, restart Obsidian on
the receiving device, or disable and re-enable QuickAdd in **Settings ->
Community plugins**. QuickAdd reads `data.json` when the plugin loads, so an
already-running copy of QuickAdd will keep using the choices it loaded earlier.

If you use Obsidian Sync, also check **Settings -> Sync** on each device:

- Under **Vault configuration sync**, enable **Active community plugin list**
  and **Installed community plugin list** if you want Obsidian Sync to install
  and enable QuickAdd for you.
- If a macro calls a standalone `.js` user script, enable **Sync all other
  types**. Obsidian's [Sync settings](https://obsidian.md/help/sync/settings)
  treat `.js` as an additional file type. Without the script file at the same
  vault path, the macro configuration can appear but the script will not run.
- Note-based user scripts in Markdown notes avoid the `.js` file-type toggle.
  See [User Scripts](./UserScripts) for the two script forms and mobile limits.

If you use iCloud, Dropbox, Git, Syncthing, or another file-sync tool, the
`.js` toggle does not apply. Make sure the tool syncs the whole `.obsidian`
configuration folder and the script files in your vault, then restart or
re-enable QuickAdd on the other device.

For a one-time transfer, [export a QuickAdd package](./Choices/Packages) and
import it on the other device. Packages move the QuickAdd configuration, but not
referenced `.js` files, note-script files, or local secrets.
