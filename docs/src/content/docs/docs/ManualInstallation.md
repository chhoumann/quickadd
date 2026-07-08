---
title: Manual Installation
description: Install QuickAdd manually from GitHub release files into your vault's plugins folder when the plugin browser is unavailable
slug: docs/ManualInstallation
---

1. Go to [Releases](https://github.com/chhoumann/quickadd/releases) and open the latest release.
2. Download the release assets. If there is a ZIP file named like `quickadd-x.x.x.zip`, download that. If the release lists loose files instead, download `main.js`, `manifest.json`, and `styles.css`.
3. Open your Obsidian plugins folder. If you don't know where that is, go to `Community Plugins` inside Obsidian. There is a folder icon on the right of `Installed Plugins`. Click that and it opens your plugins folder.
4. Create a folder named `quickadd` inside the plugins folder.
5. Extract the ZIP file into `.obsidian/plugins/quickadd/`, or copy the loose `main.js`, `manifest.json`, and `styles.css` files into `.obsidian/plugins/quickadd/`.

Do not place `main.js`, `manifest.json`, or `styles.css` directly in `.obsidian/plugins/`. They must be inside the `quickadd` folder.

When finished, your vault should contain these files:

```text
.obsidian/plugins/quickadd/main.js
.obsidian/plugins/quickadd/manifest.json
.obsidian/plugins/quickadd/styles.css
```
