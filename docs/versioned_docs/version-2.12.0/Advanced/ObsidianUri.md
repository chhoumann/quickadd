---
title: Open QuickAdd from a URI
---

QuickAdd choices can be launched from external scripts or apps such as Shortcuts on Mac and iOS, through the use of the `obsidian://quickadd` URI.

If you prefer shell scripting, see [QuickAdd CLI](./CLI.md) for native Obsidian
CLI handlers.

```
obsidian://quickadd?choice=<YOUR_CHOICE_NAME>[&value-VALUE_NAME=...]
```

:::note

All parameter names and values must be properly [URL encoded](https://en.wikipedia.org/wiki/Percent-encoding) to work. You can use an online tool like [urlencoder.org](https://www.urlencoder.org/) to help you easily encode parts of the URI.

:::

The only required parameter is `choice` which selects the choice to run by its name. The name must match exactly, otherwise it will not be able to be found.

[Variables to your choice](../FormatSyntax.md) are passed as additional `value-VARIABLE_NAME` parameters, with `value-` prefixing the name. Variables with a space in their name can still be used, but the spaces in the name must be encoded as `%20` as usual. For example, a capture asking for a variable named `log notes` would be passed as `value-log%20notes=...` in the URI.

Keep in mind that unnamed variables (a bare `{{VALUE}}`/`{{NAME}}` or `{{MVALUE}}`) cannot be filled by the URI and you will instead be prompted inside Obsidian as usual.

## Vault parameter

Like every Obsidian URI, you can use the special `vault` parameter to specify which vault to run QuickAdd in. If left blank, it will be executed in your most recent vault.

```
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-contents=Lorem%20ipsum.
```

## Important: Sync Service Limitations

:::warning

When using QuickAdd via URI with sync services (Obsidian Sync, iCloud, Dropbox, etc.), be aware of a critical limitation:

**If Obsidian hasn't been opened on a device**, files created on other devices won't be synced yet. This can cause QuickAdd to create duplicate files that overwrite the synced versions when they arrive.

### Example Scenario
1. You create a Daily Note on your laptop
2. Without opening Obsidian on your phone, you trigger a Capture via URI
3. QuickAdd checks if the Daily Note exists (it doesn't locally)
4. QuickAdd creates a new Daily Note
5. When sync runs, the new file overwrites the one from your laptop

### Workarounds
- **Open Obsidian first**: Always open Obsidian and wait for sync before using URIs
- **Use device-specific names**: Configure different filename formats per device (e.g., `{{date}}-mobile`)
- **Capture to active file**: Use an already-open note to avoid file creation issues
- **Include timestamps**: Add `{{time}}` to filenames to ensure uniqueness

This is a fundamental limitation of file-based sync services and cannot be fully resolved without sync status APIs.

:::
