---
title: Open QuickAdd from a URI
description: "Trigger QuickAdd choices with the obsidian://quickadd URI, pass named values, and get the created note's path back via x-callback-url"
slug: docs/Advanced/ObsidianUri
---

A special link, `obsidian://quickadd`, runs a QuickAdd choice from outside
Obsidian - from an Apple Shortcut, a launcher, another app, or a Markdown link
in a note. You give it the name of the choice to run and, optionally, the
values to fill in, and QuickAdd runs it just as if you had triggered it
yourself.

This is the shape of the link:

```
obsidian://quickadd?choice=<YOUR_CHOICE_NAME>[&value-VALUE_NAME=...]
```

:::note[Encode everything]
Every parameter name and value has to be [URL encoded](https://en.wikipedia.org/wiki/Percent-encoding)
to work. An online tool like [urlencoder.org](https://www.urlencoder.org/)
makes it easy to encode parts of the link.
:::

The only required part is `choice`, which picks the choice to run **by its
name**. The name has to match exactly, or QuickAdd cannot find it.

If you would rather script this from a shell than build links, see
[QuickAdd CLI](/docs/Advanced/CLI/) for the native Obsidian CLI commands.

## Pass values into the choice

Add a `value-<name>` parameter for each [named value](/docs/FormatSyntax/) the
choice asks for. A capture asking for `{{VALUE:contents}}` is filled by
`value-contents=...`.

If a variable name has a space in it, encode the space as `%20` like everything
else. A variable named `log notes` is passed as `value-log%20notes=...`.

Values are used exactly as they are encoded in the link. If a format should
ignore an accidental leading or trailing space for one placeholder, add `|trim`
to it, for example `{{VALUE:log notes|trim}}`.

Unnamed values - a bare `{{VALUE}}`/`{{NAME}}`, or `{{MVALUE}}` - cannot be
filled from the link. QuickAdd prompts for them inside Obsidian as usual.

## Choose which vault: `vault=` {#vault-parameter}

Like every Obsidian URI, you can add a `vault` parameter to say which vault to
run QuickAdd in. Leave it out and Obsidian uses your most recent vault.

```
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-contents=Lorem%20ipsum.
```

## Get a result back: x-callback-url {#getting-a-result-back-x-callback-url}

QuickAdd can open a callback link once a choice finishes, so whatever triggered
it (an Apple Shortcut, say) can react to the result and receive the path of the
affected note. This follows the [x-callback-url](http://x-callback-url.com/)
convention.

:::note[Off by default]
This is opt-in. Turn on **Settings → AI & Online → Allow URI x-callback-url**
first. It is off by default because the callback link is controlled by whoever
creates the `obsidian://` link, and the callback can carry your note's vault
path.
:::

:::note[Template and Capture only]
Callbacks work for **Template** and **Capture** choices. Triggering a Macro or
Multi choice with a callback fires `x-error` with
`errorCode=unsupported-choice-type` instead. (You can still trigger Macro and
Multi choices from the URI without a callback.)
:::

### Which callback fires when {#callback-parameters}

| Parameter        | Fired when                                                       |
| ---------------- | ---------------------------------------------------------------- |
| `x-success`      | the choice completed successfully                                |
| `x-error`        | the choice failed, was aborted, was not found, or is unsupported |
| `x-cancel`       | you cancelled a prompt while the choice was running              |
| `x-callback-url` | legacy shorthand - used only when none of the above are present; it then fires for **success and cancel** (never error) |

If you do not provide a slot, nothing opens for that outcome (there is no
fallback - a cancel with no `x-cancel` opens nothing).

Only `shortcuts:` and `obsidian:` callback links are allowed. Any other scheme
(such as `https:`, `file:`, or `javascript:`) is rejected and the choice does
not run.

### What QuickAdd sends back {#result-parameters}

QuickAdd appends these query parameters to your callback link:

- On `x-success`: `status=success`, and - for Template/Capture - `path=<vault-relative path>` and `url=<obsidian://open…>` pointing at the affected note.
- On `x-error`: `status=error` and a stable `errorCode` (one of `choice-not-found`, `unsupported-choice-type`, `execution-failed`, `execution-aborted`, `bad-callback-url`). The detailed error message stays in Obsidian's log and is never sent to the callback.
- On `x-cancel`: `status=cancel`.

### Encode your callback link twice {#encoding-your-callback-url-important}

Your callback link is itself a value inside the `obsidian://` link, so it
**must be fully percent-encoded** (double-encoded). If you leave a `=` or `&`
un-encoded, Obsidian's URI parser silently cuts the callback off before
QuickAdd ever sees it.

For example, this looks reasonable but is **broken** - the
`=My%20Cool%20Shortcut` part is dropped, leaving `shortcuts://run-shortcut?name`:

```text
obsidian://quickadd?choice=Daily%20log&x-success=shortcuts://run-shortcut?name=My%20Cool%20Shortcut
```

The **correct** form encodes the entire `x-success` value:

```text
obsidian://quickadd?choice=Daily%20log&x-success=shortcuts%3A%2F%2Frun-shortcut%3Fname%3DMy%2520Cool%2520Shortcut
```

(Note the `%2520` - the spaces inside the shortcut name are encoded twice
because the value is decoded once by Obsidian and once by Shortcuts.)

### Full example {#example}

Trigger a capture, run a shortcut on success, and pass along the created note's
path:

```text
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-contents=Lorem%20ipsum&x-success=shortcuts%3A%2F%2Frun-shortcut%3Fname%3DLog%2520Saved
```

On success QuickAdd opens your `x-success` link with these extra query
parameters appended (shown here decoded - they are percent-encoded on the wire):

- `status` = `success`
- `path` = `Daily/2026-06-14.md`
- `url` = `obsidian://open?vault=My Vault&file=Daily/2026-06-14.md`

Your shortcut reads them from the link it was opened with.

:::note[Mobile]
QuickAdd opens callbacks with `window.open`, exactly like Obsidian's own
x-callback support. Whether a custom scheme such as `shortcuts:` launches
reliably on iOS is a platform behaviour shared with Obsidian core - verify on
your device.
:::

_Introduced in QuickAdd 2.14.0._

## Watch out for sync services {#important-sync-service-limitations}

:::caution
When you use QuickAdd via URI with a sync service (Obsidian Sync, iCloud,
Dropbox, and so on), there is a limitation to be aware of.

**If Obsidian hasn't been opened on a device**, files created on other devices
haven't synced to it yet. QuickAdd can then create a duplicate file that
overwrites the synced version when it finally arrives.

### How this goes wrong {#example-scenario}

1. You create a Daily Note on your laptop.
2. Without opening Obsidian on your phone, you trigger a Capture via URI.
3. QuickAdd checks whether the Daily Note exists (it doesn't, locally).
4. QuickAdd creates a new Daily Note.
5. When sync runs, the new file overwrites the one from your laptop.

### How to avoid it {#workarounds}

- **Open Obsidian first**: always open Obsidian and wait for sync before using URIs.
- **Use device-specific names**: configure different filename formats per device (for example `{{date}}-mobile`).
- **Capture to active file**: use an already-open note to avoid creating a file at all.
- **Include timestamps**: add `{{time}}` to filenames so each one is unique.

This is a fundamental limitation of file-based sync services and cannot be
fully resolved without sync-status APIs.
:::
