---
title: Mobile Share Menu
---

On mobile, when you share text or a link to Obsidian from another app, Obsidian shows an in-app menu (for example *Insert text* and *Add to daily note*). QuickAdd can add your choices to that menu, so shared content can be routed straight through a Capture, Template, Macro, or Multi choice.

This lets you do "share a URL to my reading inbox" or "send selected text to a capture" without any external automation.

## Enable a choice in the share menu

1. Open **Settings → QuickAdd**.
2. Right-click a choice (or open its **⋯ More options** menu).
3. Choose **Show in mobile share menu**.

Repeat for any choices you want available when sharing. To remove one, open the same menu and choose **Hide from mobile share menu**.

The toggle is configured on any device but only has an effect on mobile — the underlying share event never fires on desktop.

## How the shared text is passed to your choice

The shared text is bound to QuickAdd's reserved `value`, the same one `{{VALUE}}` uses:

- **Capture / Template** choices: a bare `{{VALUE}}` in your capture format, template body, or file-name format resolves to the shared text **without prompting**.
- **Macro** choices: your user scripts read it from `params.variables.value`.
- A format that does not reference `{{VALUE}}` simply ignores the shared text.

For example, a Capture choice with the format `- [ ] Read: {{VALUE}}` files the shared link as a task with no extra input.

## Good to know

- **It runs exactly like the command palette.** Only the bare `{{VALUE}}` prompt is skipped. Any other input your choice needs — date prompts, `{{VALUE:option1,option2}}` dropdowns, a target-file picker, a Macro suggester, or a Multi choice's sub-menu — still appears. Design share-targeted choices to run with as little extra input as possible.
- **Template file names.** If a Template choice has no file-name format set, the new note is named after the shared text — so a long URL or paragraph would become the file name. Give share-targeted Template choices an explicit **file-name format** (for example a date-based name like `Inbox/{{DATE}}`) and put `{{VALUE}}` in the template body instead.
- **Choices that need an active note.** Choices that write to the *currently open* note (a Capture set to "capture to the active file", or a Macro that runs an editor command) need a note open in Obsidian. When you arrive from a share there may not be one, so prefer choices that create or target a specific file.
- **Files and other share types** are not supported yet — only shared text and links.
