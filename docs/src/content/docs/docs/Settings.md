---
title: Settings
description: What every QuickAdd setting does and the effect of turning it on, from choices and input behavior to templates, AI, notifications, and choice icons
slug: docs/Settings
---

This page is a reference for the QuickAdd settings tab, one group at a time. Each entry says what the setting does and what changes when you turn it on. Open the tab from Obsidian's **Settings → Community plugins → QuickAdd** (or **Settings → QuickAdd**); changes save as you make them.

## Choices & Packages {#choices--packages}

- **Choices** - build and organize your QuickAdd choices. This is the main list you add to, reorder, and configure. See [Template Choices](/docs/Choices/TemplateChoice/), [Capture Choices](/docs/Choices/CaptureChoice/), [Macro Choices](/docs/Choices/MacroChoice/), and [Multi Choices](/docs/Choices/MultiChoice/).
- **Packages** - share a set of choices with someone else, or bring theirs in. Use **Export package…** to bundle your choices into a file, and **Import package…** to add someone else's. See [Share QuickAdd Packages](/docs/Choices/Packages/).

## Choice Picker {#choice-picker}

The choice picker is the list you see when you run **QuickAdd: Run**.

- **Search nested choices** - find a choice even when it lives inside a Multi choice. When on, searching also matches choices nested in Multi choices and shows their path. A nested match can rank above a same-level one. Turn it off to search only the level you have open.
- **"New note from template" in the launcher** - decide where the "create a note from a template" row sits in the picker, so you can make a note from any template without building a dedicated Template choice. *Show at the bottom* (default) keeps your most-used choice in the first slot, *Show at the top* makes the template row first, and *Hide* removes it. The row only appears once you have a [template folder](#templates--properties) configured. The **New note from template** command is always in the command palette, but it needs a configured folder too - without one it shows a notice and opens these settings.

## Input {#input}

- **Use Multi-line Input Prompt** - get a large text box for text prompts instead of a single line, so you can write several lines at once. Multi-line prompts submit with Ctrl/Cmd+Enter, and plain Enter adds a newline. See [Controlling Prompts](/docs/ControllingPrompts/#submit-keys).
- **Persist Input Prompt Drafts** - don't lose what you typed if you close a prompt by accident. When on, a closed prompt keeps its draft and restores it when you reopen. Drafts last only for the current session.
- **Use editor selection as default Capture value** - let a Capture reuse text you already have highlighted. When on, Capture uses the current editor selection as `{{VALUE}}` and may skip the prompt entirely. When off, Capture always asks for `{{VALUE}}`. Individual Capture choices can override this.
- **One-page input for choices** - answer all of a choice's questions in one form up front, instead of one prompt after another. Works with Template and Capture choices, and with Macros whose scripts declare inputs. Template and Capture choices can [override this individually](/docs/Advanced/onePageInputs/#per-choice-override). See [One-page Inputs](/docs/Advanced/onePageInputs/) and [Controlling Prompts](/docs/ControllingPrompts/).
- **Date aliases** - set your own shortcodes for natural-language dates, so typing `tm` in a date prompt means `tomorrow`. Write one per line as `alias = phrase`, for example `tm = tomorrow`. **Reset to defaults** restores the built-in aliases.

## Templates & Properties {#templates--properties}

- **Template folder paths** - tell QuickAdd where your templates live, so it can suggest them when you configure a choice. Type a folder (autocomplete helps) and press **Add** or Enter; remove one with the trash button on its row. Add as many folders as you like. Leaving the list empty suggests every template file in the vault, but it also removes the **New note from template** launcher row, and the command of the same name will only point you back here until a folder is configured.
- **Convert string front matter variables to typed properties (Beta)** - turn text values into real Obsidian property types so front matter reads correctly. List and object values from scripts are **always** written as proper properties (a list value becomes a List property), so templates produce valid front matter without this toggle. Turning it on **also** converts string values: a comma or bullet-list string becomes a List, `"42"` becomes a Number, `"true"` becomes a Checkbox, and so on. Off by default, because the string conversion is a beta heuristic that can have edge cases. See [Template Property Types (Beta)](/docs/TemplatePropertyTypes/).

## Notifications {#notifications}

- **Announce Updates** - see what changed when a new version installs, including new features, demo videos, and bug fixes. Choose *Show updates on each new release*, *Show updates only on major releases (new features, breaking changes)*, or *Don't show*.
- **Show Capture Notifications** - get a confirmation that a capture landed. When on, QuickAdd shows a notice after content is captured successfully.
- **Show Input Cancellation Notifications** - get a notice when you dismiss a prompt without submitting. Turn it off to avoid the extra notice every time you cancel a prompt.

## Global Variables {#global-variables}

- **Global Variables** - define reusable snippets once and drop them in anywhere QuickAdd formatting is supported. These are vault-scoped. See [Global Variables](/docs/GlobalVariables/).

## AI & Online {#ai--online}

- **Disable AI & Online features** - stop the plugin from reaching external providers like OpenAI. This blocks plugin features such as the AI Assistant from making those requests. User Scripts can still run arbitrary code, including contacting external providers, so this setting does not affect them. Turn it off to use the [AI Assistant](/docs/AIAssistant/).
- **Allow URI x-callback-url** - let an `obsidian://quickadd` link report its result back to whoever launched it. Off by default, because the callback URL is set by whoever creates the `obsidian://` link and a successful callback can carry the affected note's vault path. When on, an `obsidian://quickadd` URI may open a callback URL (`x-success` / `x-error` / `x-cancel`) after a Template or Capture choice finishes, sending the outcome and, on success, the note's vault path and URL to that callback. Only `shortcuts:` and `obsidian:` callback URLs are permitted. See [Obsidian URI](/docs/Advanced/ObsidianUri/).

## Appearance {#appearance}

- **Show icon in sidebar** - add the QuickAdd icon to the sidebar ribbon for one-click access. Requires a reload to take effect.

## Choice icons {#choice-icons}

- **Automatic choice icons** - QuickAdd gives each choice type a default [Lucide](https://lucide.dev) icon: `file-text` for Template, `pencil` for Capture, `terminal` for Macro, and `folder` for Multi. These show in the QuickAdd launcher, inside Multi choice pickers, and on registered commands in the command palette and mobile editing toolbar.
- **Override a choice's icon** - give a single choice its own icon. Open the choice's configuration and set **Icon** to any Lucide icon id (for example `star`); leave it empty to fall back to the choice type default. Icons take the active Obsidian theme's color; QuickAdd does not set per-choice icon colors.

_Choice icons introduced in QuickAdd 2.14.0._
