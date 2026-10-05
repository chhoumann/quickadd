---
title: Starting from a preset
description: "The New choice menu: pick what you want to happen, and QuickAdd creates a Capture, Template, or Macro choice that is already set up for it"
slug: docs/Choices/Presets
---

**New choice** in **Settings → QuickAdd** asks what you want to happen, not
which type of choice to make. Each entry is a preset: it creates a Capture,
Template, or Macro choice that is already set up for that job, and opens its
settings so you can adjust it. The menu groups the presets by outcome:
**Add to a note**, **Create a note**, and **Automate**.

### Add to a note {#add-to-a-note}

| Preset | Creates | What it starts with |
| --- | --- | --- |
| **Log with a timestamp** | Capture | Adds `- {{TIME}} {{VALUE}}` under `## Log` in today's daily note. Creates the note and the heading if they are missing. |
| **Add a task** | Capture | Adds a task under `## Tasks` in today's daily note. Creates the note and the heading if they are missing. |
| **Add to a note** | Capture | Asks which note each time and writes at the bottom of it. |
| **Save the selection or clipboard** | Capture | Asks which note each time and writes the text you have selected at the bottom of it. With nothing selected, it asks for the text, so paste what you copied. |
| **Fill in a property** | Capture | Asks which property of the note you are in to set, then for its value. Adds the property if the note does not have it. |

### Create a note {#create-a-note}

| Preset | Creates | What it starts with |
| --- | --- | --- |
| **New note from a template** | Template | Asks for a title, then creates the note. Set **Template path** to the template to use. |
| **New note, linked from here** | Template | Creates the note, puts a link to it on a new line in the note you are in (if any), and opens it. |
| **New note of a type** | Template | Asks which template to use, which folder to put the note in, and its title, then creates the note and opens it. The templates offered are the notes in your template folder: QuickAdd's first template folder, else the Templates core plugin's folder, else `Templates/`. |

### Automate {#automate}

| Preset | Creates | What it starts with |
| --- | --- | --- |
| **Run a script** | Macro | One script step with no file yet. Click **Choose file** on it to pick the script. See [Add a user script command](/docs/Choices/MacroChoice/#add-a-user-script-command). |
| **Run a sequence of steps** | Macro | No steps. Add them in the Macro builder. |
| **Ask AI** | Macro | One [AI Assistant](/docs/AIAssistant/) step. Offered only while **Disable AI & online features** is off. |

Below the groups, **Browse recipes…** opens the
[Recipes gallery](/docs/Choices/Packages/#browse-recipes), ready-made
workflows from these docs, and **Import a package…** opens the
[package import](/docs/Choices/Packages/#import-a-package).

**New folder** is a separate button next to **New choice**. It adds a
[folder](/docs/Choices/MultiChoice/) for grouping choices.

The new choice is named after the preset, for example `Log`, and uses the
preset's icon. Change both in its settings. A preset only fills in settings,
so everything it sets can be changed later. A choice made from
**Log with a timestamp** is an ordinary Capture choice, documented on the
[Capture](/docs/Choices/CaptureChoice/) page.

To add a choice inside a folder, unfold the folder and click its **Add
choice** link. It offers the same presets, without the recipes and package
import.

:::tip
Hold Alt (⌥ on macOS) while you pick a preset to add the choice without
opening its settings.
:::

## Your first choices {#first-run}

When the list in **Settings → QuickAdd** is empty, it asks **What do you do in
Obsidian?** and offers five answers. Click the ones that fit, then click
**Create choices**. The button counts the choices it will add.

| Answer | Adds |
| --- | --- |
| **Keep a daily journal** | **Log** adds `- {{TIME}} {{VALUE}}` under `## Log`, and **Thought** adds `- {{VALUE}}` under `## Thoughts`, in today's daily note. |
| **Track tasks** | **Task** adds a task under `## Tasks` in today's daily note. With the Tasks plugin on, it also asks for an optional due date and writes it as `📅 2026-06-14`. |
| **Meeting and people notes** | **Meeting note** creates `Meetings/{{DATE}} {{VALUE:Topic}}` from a meeting template and opens it. |
| **Collect reading and ideas** | **Inbox** adds a line at the bottom of `Inbox.md`, and **Save link** adds a task at the bottom of `Reading list.md`. |
| **Run projects** | **Project** creates `Projects/{{VALUE:Name}}` from a project template, links it on a new line in the note you are in, and opens it. |

The choices follow your vault:

- **Daily notes.** Without the Daily notes core plugin or Periodic Notes, Log,
  Thought, and Task write to `Journal/{{DATE:YYYY-MM-DD}}.md` instead of
  today's daily note.
- **Templates.** Meeting note and Project use a note in your template folder
  whose name contains "meeting" or "project". The template folder is
  QuickAdd's first template folder, else the Templates core plugin's folder,
  else `Templates/`. When there is no such note, QuickAdd creates `Meeting.md`
  or `Project.md` there, and the answer's card says *Adds a Meeting template*.
- **Missing notes and headings** are created on the first run. QuickAdd never
  overwrites a note that exists.

Each one is an ordinary choice; change it in its settings like any other.
**or browse recipes** under **Create choices** opens the
[Recipes gallery](/docs/Choices/Packages/#browse-recipes) instead, and the
quieter **New choice** and **New folder** buttons start from scratch.

## The summary line {#summary}

Every choice shows one line under its name that says what it does, for
example *Adds a line under ## Log in today's daily note*. The line appears in
the settings list and in the launcher. Placeholders appear as short names in
braces, so an **Add to a note** choice that captures to `Journal/{{DATE}}.md`
reads *Adds a line at the bottom of Journal/{date}*.
A folder shows how many choices it holds instead.
