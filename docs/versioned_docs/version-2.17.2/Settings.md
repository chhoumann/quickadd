---
title: Settings
---

The QuickAdd settings tab is reached from Obsidian's **Settings → Community plugins → QuickAdd** (or **Settings → QuickAdd**). Settings are grouped into sections; this page documents each group and the controls it contains. Changes save automatically.

## Choices & Packages

- **Choices** — Build and organize your QuickAdd choices. See [Template Choices](./Choices/TemplateChoice), [Capture Choices](./Choices/CaptureChoice), [Macro Choices](./Choices/MacroChoice), and [Multi Choices](./Choices/MultiChoice).
- **Packages** — Bundle or import QuickAdd automations as reusable packages. See [Share QuickAdd Packages](./Choices/Packages). Use **Export package…** to bundle your choices and **Import package…** to bring in someone else's.

## Choice Picker

- **Search nested choices** — When searching in the choice picker, also match choices nested inside Multi choices and show their path. Note that nested matches can outrank same-level ones. Disable to search only the open level.
- **"New note from template" in the launcher** — Where the row that lists templates from your configured template folder appears in Run QuickAdd, so you can create a note from a template without a dedicated Template choice. *Show at the bottom* (default) keeps your most-used choice in the first slot; *Show at the top* makes it the first item; *Hide* removes it. Only appears when a [template folder](#templates--properties) is configured; the **New note from template** command works regardless.

## Input

- **Use Multi-line Input Prompt** — Use multi-line input prompt instead of single-line input prompt. Multi-line prompts submit with Ctrl/Cmd+Enter (Enter inserts a newline). See [Controlling Prompts](./ControllingPrompts#submit-keys).
- **Persist Input Prompt Drafts** — Keep drafts when closing input prompts so they can be restored on reopen. Drafts are stored only for this session.
- **Use editor selection as default Capture value** — When enabled, Capture uses the current editor selection as `{{VALUE}}` and may skip the prompt. When disabled, Capture always prompts for `{{VALUE}}`.
- **One-page input for choices** — Collect a choice's inputs in one form before it runs, instead of one prompt at a time. Works with Template and Capture choices, and with Macros whose scripts declare inputs; Template and Capture choices can [override this individually](./Advanced/onePageInputs#per-choice-override). See [One-page Inputs](./Advanced/onePageInputs) and [Controlling Prompts](./ControllingPrompts).
- **Date aliases** — Shortcodes for natural language date parsing. One per line: `alias = phrase`. Example: `tm = tomorrow`. Use **Reset to defaults** to restore the built-in aliases.

## Templates & Properties

- **Template folder paths** — Folders where templates are stored, used to suggest template files when configuring QuickAdd. Add as many folders as you like: type a folder (with autocomplete) and press **Add** or Enter, then remove one with its row's trash button. Leave the list empty to suggest every template file in the vault. Note that an empty list also disables the **New note from template** launcher row and command, which need at least one configured folder.
- **Convert string front matter variables to typed properties (Beta)** — List/object values from scripts are **always** written as proper Obsidian properties (a list value becomes a List property), so templates produce valid front matter out of the box. This toggle **additionally** converts string values into typed properties: a comma or bullet-list string becomes a List, `"42"` becomes a Number, `"true"` becomes a Checkbox, etc. Disabled by default; the string conversion is a beta heuristic that may have edge cases. See [Template Property Types (Beta)](./TemplatePropertyTypes).

## Notifications

- **Announce Updates** — Display release notes when a new version is installed. This includes new features, demo videos, and bug fixes. Choose between *Show updates on each new release*, *Show updates only on major releases (new features, breaking changes)*, or *Don't show*.
- **Show Capture Notifications** — Display a notification when content is captured successfully to confirm the operation completed.
- **Show Input Cancellation Notifications** — Display a notification when an input prompt is cancelled without submitting. Disable this to avoid extra notices when dismissing prompts.

## Global Variables

- **Global Variables** — Define vault-scoped, reusable snippets and reference them anywhere QuickAdd formatting is supported. See [Global Variables](./GlobalVariables).

## AI & Online

- **Disable AI & Online features** — This prevents the plugin from making requests to external providers like OpenAI. You can still use User Scripts to execute arbitrary code, including contacting external providers. However, this setting disables plugin features like the AI Assistant from doing so. You need to disable this setting to use the AI Assistant. See [AI Assistant](./AIAssistant).
- **Allow URI x-callback-url** — Off by default, because the callback URL is set by whoever creates the `obsidian://` link and a successful callback can carry the affected note's vault path. When on, an `obsidian://quickadd` URI may open a callback URL (`x-success` / `x-error` / `x-cancel`) after a Template or Capture choice finishes, sending the outcome (and, on success, the note's vault path and URL) to that callback. Only `shortcuts:` and `obsidian:` callback URLs are permitted. See [Obsidian URI](./Advanced/ObsidianUri).

## Appearance

- **Show icon in sidebar** — Add QuickAdd icon to the sidebar ribbon. Requires a reload.

## Choice icons

- **Automatic choice icons** — QuickAdd gives each choice type a default Obsidian/Lucide icon: `file-text` for Template, `pencil` for Capture, `terminal` for Macro, and `folder` for Multi. These icons show in the QuickAdd launcher, inside Multi choice pickers, and on registered commands in the command palette / mobile editing toolbar.
- **Override a choice's icon** — Open a choice's configuration and set **Icon** to any [Lucide](https://lucide.dev) icon id (for example `star`). Leave the field empty to use the choice type default. Icons inherit the active Obsidian theme color; QuickAdd does not set per-choice icon colors.
