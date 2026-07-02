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

Variable values are used exactly as encoded in the URI. If a format should ignore accidental leading or trailing whitespace for one token, add `|trim` to that token, for example `{{VALUE:log notes|trim}}`.

Keep in mind that unnamed variables (a bare `{{VALUE}}`/`{{NAME}}` or `{{MVALUE}}`) cannot be filled by the URI and you will instead be prompted inside Obsidian as usual.

## Vault parameter

Like every Obsidian URI, you can use the special `vault` parameter to specify which vault to run QuickAdd in. If left blank, it will be executed in your most recent vault.

```
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-contents=Lorem%20ipsum.
```

## Getting a result back (x-callback-url)

QuickAdd can open a callback URL after a choice finishes, so an external caller (for
example an Apple Shortcut) can react to the result and receive the path of the affected
note. This follows the [x-callback-url](http://x-callback-url.com/) convention.

:::info Off by default

This is opt-in. Enable **Settings → AI & Online → Allow URI x-callback-url** first. It is
off by default because the callback URL is controlled by whoever creates the
`obsidian://` link, and the callback can carry your note's vault path.

:::

:::note Template and Capture only

Callbacks are supported for **Template** and **Capture** choices. Triggering a Macro or
Multi choice with a callback fires `x-error` with `errorCode=unsupported-choice-type`
instead. (You can still trigger Macro/Multi choices via the URI without a callback.)

:::

### Callback parameters

| Parameter        | Fired when                                                       |
| ---------------- | ---------------------------------------------------------------- |
| `x-success`      | the choice completed successfully                                |
| `x-error`        | the choice failed, was aborted, was not found, or is unsupported |
| `x-cancel`       | you cancelled a prompt while the choice was running              |
| `x-callback-url` | legacy shorthand — used only when none of the above are present; it then fires for **success and cancel** (never error) |

If a slot is not provided, nothing is opened for that outcome (there is no fallback — a
cancel with no `x-cancel` opens nothing).

Only `shortcuts:` and `obsidian:` callback URLs are permitted; any other scheme (such as
`https:`, `file:`, or `javascript:`) is rejected and the choice is not run.

### Result parameters

QuickAdd appends these query parameters to your callback URL:

- On `x-success`: `status=success`, and — for Template/Capture — `path=<vault-relative
  path>` and `url=<obsidian://open…>` pointing at the affected note.
- On `x-error`: `status=error` and a stable `errorCode` (one of `choice-not-found`,
  `unsupported-choice-type`, `execution-failed`, `execution-aborted`, `bad-callback-url`).
  The detailed error message is kept in Obsidian's log and is never sent to the callback.
- On `x-cancel`: `status=cancel`.

### Encoding your callback URL (important)

Your callback URL is itself a value inside the `obsidian://` query string, so it **must be
fully percent-encoded** (double-encoded). If you leave a `=` or `&` un-encoded, Obsidian's
URI parser silently truncates the callback before QuickAdd ever sees it.

For example, this looks reasonable but is **broken** — the `=My%20Cool%20Shortcut` part is
dropped, leaving `shortcuts://run-shortcut?name`:

```text
obsidian://quickadd?choice=Daily%20log&x-success=shortcuts://run-shortcut?name=My%20Cool%20Shortcut
```

The **correct** form encodes the entire `x-success` value:

```text
obsidian://quickadd?choice=Daily%20log&x-success=shortcuts%3A%2F%2Frun-shortcut%3Fname%3DMy%2520Cool%2520Shortcut
```

(Note the `%2520` — the spaces inside the shortcut name are encoded twice because the value
is decoded once by Obsidian and once by Shortcuts.)

### Example

Trigger a capture and run a shortcut on success, passing the created note's path:

```text
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-contents=Lorem%20ipsum&x-success=shortcuts%3A%2F%2Frun-shortcut%3Fname%3DLog%2520Saved
```

On success QuickAdd opens your `x-success` URL with these extra query parameters appended
(shown here decoded — they are percent-encoded on the wire):

- `status` = `success`
- `path` = `Daily/2026-06-14.md`
- `url` = `obsidian://open?vault=My Vault&file=Daily/2026-06-14.md`

Your shortcut reads them from the URL it was opened with.

:::note Mobile

QuickAdd opens callbacks with `window.open`, exactly like Obsidian's own x-callback
support. Whether a custom scheme such as `shortcuts:` launches reliably on iOS is a
platform behaviour shared with Obsidian core — verify on your device.

:::

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
