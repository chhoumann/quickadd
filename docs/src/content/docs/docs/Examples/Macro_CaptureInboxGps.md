---
title: "Macro: Capture to inbox with GPS"
description: Append a timestamped inbox line with device GPS coordinates, for offline capture on Obsidian mobile 1.11+
slug: docs/Examples/Macro_CaptureInboxGps
package: capture-inbox-gps
---

This macro asks for a quick note, looks up your device location at the same
time, and appends a timestamped line to `Inbox.md`. It is meant for capture on
the go: voice-to-text in the prompt, GPS in the background, one line waiting
when you get home.

GPS works on **Obsidian mobile 1.11 or newer**. The first run asks Android or
iOS for location permission. Desktop cannot read GPS, so the line is still
saved, just without coordinates. A cold satellite lock while offline can take
a while; if it times out, the note is saved without GPS.

This is not a built-in `{{coordinates}}` token. A capture format that calls
`{{MACRO:...}}` would wait for GPS *before* opening the prompt, which fights
voice-to-text. The script starts the location lookup first, then prompts.

## Install from the package {#install-from-a-package}

The package at the top of this page writes `scripts/captureInboxGps.js` and a
Macro choice that runs it. After importing, open the cog on the script step to
change the Inbox path (default `Inbox.md`) or to turn off creating the note
when it is missing. Then assign a hotkey to **Capture to Inbox with GPS**, or
run it from the command palette.

## Install by hand {#install-by-hand}

1. Save <a href="/scripts/captureInboxGps.js" download>captureInboxGps.js</a>
   anywhere in your vault except `.obsidian` or a hidden folder.
2. In **Settings → QuickAdd**, click **New choice** → **Run a script**. The
   Macro Builder opens with one script step; set **Name** to
   `Capture to Inbox with GPS`.
3. On the script step, click **Choose file** and pick `captureInboxGps.js`.
4. Turn on the ⚡ **Command palette** toggle on the choice's row so it appears
   in the palette.

## What you get

Each run appends one line:

```markdown
- 2026-08-31 15:42 Saw the trail marker at the ridge (55.676098, 12.568337)
```

If GPS is unavailable, the same line is written without the coordinates.

A run that already has `value` and `coordinates` set (URI, CLI, or an earlier
macro step) skips the prompt and the location lookup.
