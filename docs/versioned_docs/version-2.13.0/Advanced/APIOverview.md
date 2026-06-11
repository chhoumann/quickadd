---
title: API Overview
---

Use the QuickAdd API when a workflow needs scripted input, file operations,
formatting, model calls, or access from another plugin.

If you only need to create a note or append text, start with
[Template Choices](../Choices/TemplateChoice) or
[Capture Choices](../Choices/CaptureChoice). Add the API when the workflow
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
| Ask for text, selections, dates, or grouped inputs | User input methods | [QuickAdd API Reference](../QuickAddAPI#user-input-methods) |
| Run another choice from a script | Choice execution | [Choice Execution](../QuickAddAPI#choice-execution) |
| Read selected text or clipboard content | Utility module | [Utility Module](../QuickAddAPI#utility-module) |
| Format dates | Date module | [Date Module](../QuickAddAPI#date-module) |
| Call configured AI providers | AI module | [AI Module](../QuickAddAPI#ai-module) |
| Read field suggestions from the vault | Field suggestions module | [Field Suggestions Module](../QuickAddAPI#field-suggestions-module) |

## Recommended path

1. Read the [scripting overview](./ScriptingGuide) if you have not written a
   QuickAdd script before.
2. Copy a working pattern from the [examples overview](../Examples/).
3. Use the [QuickAdd API reference](../QuickAddAPI) for exact signatures and
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
