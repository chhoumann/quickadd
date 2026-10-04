---
title: Starting from a preset
description: "The New choice menu: pick what you want to happen, and QuickAdd creates a Capture, Template, or Macro choice that is already set up for it"
slug: docs/Choices/Presets
---

**New choice** in **Settings → QuickAdd** asks what you want to happen, not
which type of choice to make. Each entry is a preset: it creates a Capture,
Template, or Macro choice that is already set up for that job, and opens its
settings so you can adjust it.

| Preset | Creates | What it starts with |
| --- | --- | --- |
| **Log with a timestamp** | Capture | Adds `- {{TIME}} {{VALUE}}` under `## Log` in today's daily note. Creates the note and the heading if they are missing. |
| **Add to a note** | Capture | Asks which note each time and writes at the bottom of it. |
| **Add a task** | Capture | Adds a task under `## Tasks` in today's daily note. Creates the note and the heading if they are missing. |
| **New note from a template** | Template | Asks for a title, then creates the note. Set **Template path** to the template to use. |
| **New note, linked from here** | Template | Creates the note, puts a link to it on a new line in the note you are in (if any), and opens it. |
| **Run a script** | Macro | One script step with no file yet. Click **Choose file** on it to pick the script. See [Add a user script command](/docs/Choices/MacroChoice/#add-a-user-script-command). |
| **Run a sequence of steps** | Macro | No steps. Add them in the Macro builder. |

**New folder** is a separate button next to **New choice**. It adds a
[folder](/docs/Choices/MultiChoice/) for grouping choices.

The new choice is named after the preset, for example `Log`, and uses the
preset's icon. Change both in its settings. A preset only fills in settings,
so everything it sets can be changed later. A choice made from
**Log with a timestamp** is an ordinary Capture choice, documented on the
[Capture](/docs/Choices/CaptureChoice/) page.

To add a choice inside a folder, unfold the folder and click its **Add
choice** link. It offers the same presets.

:::tip
Hold Alt (⌥ on macOS) while you pick a preset to add the choice without
opening its settings.
:::

## The summary line {#summary}

Every choice shows one line under its name that says what it does, for
example *Adds a line under ## Log in today's daily note*. The line appears in
the settings list and in the launcher. Placeholders appear as short names in
braces, so an **Add to a note** choice that captures to `Journal/{{DATE}}.md`
reads *Adds a line at the bottom of Journal/{date}*.
A folder shows how many choices it holds instead.
