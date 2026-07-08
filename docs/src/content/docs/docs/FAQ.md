---
title: FAQ
description: How to sync your QuickAdd choices, macros, and scripts between devices, and why API keys stay local to each one
slug: docs/FAQ
---

## Syncing QuickAdd between devices

QuickAdd keeps everything - your choices, macros, global variables, and settings - in `<vault>/.obsidian/plugins/quickadd/data.json`. As long as your sync setup includes Obsidian's configuration folder, that one file brings your whole QuickAdd setup to the other device.

Two things don't travel with it:

- **The plugin itself.** QuickAdd must be installed and enabled on the other device. Obsidian tracks enabled plugins in `<vault>/.obsidian/community-plugins.json`.
- **Secrets.** API keys stored through Obsidian's secret storage stay on the device where you entered them, so enter them once per device.

One gotcha catches almost everyone: QuickAdd reads `data.json` when it loads, so a device that's already running keeps the choices it loaded earlier. After the files have synced, restart Obsidian on the receiving device - or toggle QuickAdd off and on in **Settings -> Community plugins** - and your changes appear.

If you use **Obsidian Sync**, also check **Settings -> Sync** on each device:

- Enable **Active community plugin list** and **Installed community plugin list** under **Vault configuration sync** if you want Obsidian Sync to install and enable QuickAdd for you.
- If a macro runs a standalone `.js` user script, enable **Sync all other types**. Obsidian Sync skips `.js` files unless that setting is on (see [Sync settings](https://obsidian.md/help/sync/settings)) - which is why a macro can arrive on the other device with its script missing: the configuration syncs, the script doesn't, and the macro fails.
- Scripts kept in Markdown notes sync like any other note and sidestep the file-type toggle entirely. See [User Scripts](/docs/UserScripts/) for both script forms.

With iCloud, Dropbox, Git, Syncthing, or any other file-sync tool, the file-type toggle doesn't apply - just make sure the tool syncs the whole `.obsidian` folder plus your script files, then restart or re-enable QuickAdd on the other device.

For a one-time transfer, [export a QuickAdd package](/docs/Choices/Packages/) and import it on the other device. A package moves your QuickAdd configuration and bundled dependent scripts. Secrets still stay local, so enter those on each device.
