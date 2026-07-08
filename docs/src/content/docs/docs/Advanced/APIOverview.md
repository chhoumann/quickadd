---
title: API Overview
description: Reference for the QuickAdd scripting API - where it is available and the method families for input, choices, dates, AI, and fields
slug: docs/Advanced/APIOverview
---

Use the QuickAdd API when a workflow needs scripted input, file operations,
formatting, model calls, or access from another plugin.

If you only need to create a note or append text, start with
[Template Choices](/docs/Choices/TemplateChoice/) or
[Capture Choices](/docs/Choices/CaptureChoice/). Add the API when the workflow
needs logic.

## Where the API is available

| Context | Access pattern | Use it for |
| --- | --- | --- |
| Macro user script | `params.quickAddApi` | Scripted macro steps |
| Inline script | `this.quickAddApi` | Small transformations inside templates or captures |
| Other plugin | `app.plugins.plugins.quickadd.api` | Calling QuickAdd from plugin code |
| Templater script | `app.plugins.plugins.quickadd.api` | Prompting or running choices from Templater |

## Common tasks

| Task | Method family | Reference |
| --- | --- | --- |
| Ask for text, selections, dates, or grouped inputs | User input methods | [QuickAdd API Reference](/docs/QuickAddAPI/#user-input-methods) |
| Run another choice from a script | Choice execution | [Choice Execution](/docs/QuickAddAPI/#choice-execution) |
| Read selected text or clipboard content | Utility module | [Utility Module](/docs/QuickAddAPI/#utility-module) |
| Format dates | Date module | [Date Module](/docs/QuickAddAPI/#date-module) |
| Call configured AI providers | AI module | [AI Module](/docs/QuickAddAPI/#ai-module) |
| Read field suggestions from the vault | Field suggestions module | [Field Suggestions Module](/docs/QuickAddAPI/#field-suggestions-module) |

## Recommended path

1. Read the [scripting overview](/docs/Advanced/ScriptingGuide/) if you have not written a
   QuickAdd script before.
2. Copy a working pattern from the [examples overview](/docs/Examples/).
3. Use the [QuickAdd API reference](/docs/QuickAddAPI/) for exact signatures and
   edge-case behavior.

## Minimal macro script

```javascript
module.exports = async ({ quickAddApi }) => {
  const title = await quickAddApi.inputPrompt("Book title");
  return `# ${title}`;
};
```

The returned value can be used by later macro steps or inserted through format
syntax.
