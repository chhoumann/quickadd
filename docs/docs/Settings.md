---
title: Settings
---

The QuickAdd settings tab is reached from Obsidian's **Settings → Community plugins → QuickAdd** (or **Settings → QuickAdd**). Settings are grouped into sections; this page documents each group and the controls it contains. Changes save automatically.

## Choices & Packages

- **Choices** — Build and organize your QuickAdd choices. See [Template Choices](./Choices/TemplateChoice), [Capture Choices](./Choices/CaptureChoice), [Macro Choices](./Choices/MacroChoice), and [Multi Choices](./Choices/MultiChoice).
- **Packages** — Bundle or import QuickAdd automations as reusable packages. See [Share QuickAdd Packages](./Choices/Packages). Use **Export package…** to bundle your choices and **Import package…** to bring in someone else's.

## Choice Picker

- **Search nested choices** — When searching in the choice picker, also match choices nested inside Multi choices and show their path. Note that nested matches can outrank same-level ones. Disable to search only the open level.

## Input

- **Use Multi-line Input Prompt** — Use multi-line input prompt instead of single-line input prompt.
- **Persist Input Prompt Drafts** — Keep drafts when closing input prompts so they can be restored on reopen. Drafts are stored only for this session.
- **Use editor selection as default Capture value** — When enabled, Capture uses the current editor selection as `{{VALUE}}` and may skip the prompt. When disabled, Capture always prompts for `{{VALUE}}`.
- **One-page input for choices (Beta)** — Experimental. Resolve variables up front and show a single dynamic form before executing Template/Capture choices. See [One-page Inputs](./Advanced/onePageInputs).
- **Date aliases** — Shortcodes for natural language date parsing. One per line: `alias = phrase`. Example: `tm = tomorrow`. Use **Reset to defaults** to restore the built-in aliases.

## Templates & Properties

- **Template Folder Path** — Path to the folder where templates are stored. Used to suggest template files when configuring QuickAdd.
- **Convert string front matter variables to typed properties (Beta)** — List/object values from scripts are **always** written as proper Obsidian properties (a list value becomes a List property), so templates produce valid front matter out of the box. This toggle **additionally** converts string values into typed properties: a comma or bullet-list string becomes a List, `"42"` becomes a Number, `"true"` becomes a Checkbox, etc. Disabled by default; the string conversion is a beta heuristic that may have edge cases. See [Template Property Types (Beta)](./TemplatePropertyTypes).

## Notifications

- **Announce Updates** — Display release notes when a new version is installed. This includes new features, demo videos, and bug fixes. Choose between *Show updates on each new release*, *Show updates only on major releases (new features, breaking changes)*, or *Don't show*.
- **Show Capture Notifications** — Display a notification when content is captured successfully to confirm the operation completed.
- **Show Input Cancellation Notifications** — Display a notification when an input prompt is cancelled without submitting. Disable this to avoid extra notices when dismissing prompts.

## Global Variables

- **Global Variables** — Define vault-scoped, reusable snippets and reference them anywhere QuickAdd formatting is supported. See [Global Variables](./GlobalVariables).

## AI & Online

- **Disable AI & Online features** — This prevents the plugin from making requests to external providers like OpenAI. You can still use User Scripts to execute arbitrary code, including contacting external providers. However, this setting disables plugin features like the AI Assistant from doing so. You need to disable this setting to use the AI Assistant. See [AI Assistant](./AIAssistant).

## Appearance

- **Show icon in sidebar** — Add QuickAdd icon to the sidebar ribbon. Requires a reload.
