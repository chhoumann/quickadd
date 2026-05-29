---
title: Scripting Overview
---

QuickAdd scripts are JavaScript files that run inside Obsidian. They can prompt
for input, call Obsidian APIs, read other plugins, and pass values back into a
Macro choice.

## Which scripting feature should I use?

| Need | Use | Why |
| --- | --- | --- |
| A reusable script with settings | User script | Best for larger workflows and shared code |
| A small transformation inside a template or capture | Inline script | Keeps tiny logic close to the format using it |
| Several script and choice steps in sequence | Macro choice | Coordinates order, variables, and abort behavior |
| A script users can configure from the QuickAdd UI | Script with settings | Lets non-coders change values without editing JavaScript |

## Basic user script shape

```javascript
module.exports = async (params) => {
  const { app, quickAddApi, variables } = params;
  const title = await quickAddApi.inputPrompt("Title");

  variables.title = title;
  return title;
};
```

The `params` object gives scripts access to:

- `app`: the Obsidian app instance
- `quickAddApi`: QuickAdd's prompt, utility, AI, and execution helpers
- `variables`: values shared across macro steps

## How values move through a macro

1. A choice or script asks for a value.
2. QuickAdd stores that value in `variables`.
3. Later template, capture, and script steps can reuse it.
4. If a prompt is cancelled, QuickAdd aborts the macro unless your script handles
   the cancellation.

Use named values like `{{VALUE:project}}` when several macro steps should share
one prompt.

## Suggested learning order

1. [Macro Choices](../Choices/MacroChoice) for how macro steps are assembled.
2. [User Scripts](../UserScripts) for complete scripting patterns.
3. [Scripts with Settings](./scriptsWithSettings) for configurable scripts.
4. [QuickAdd API Reference](../QuickAddAPI) for exact method details.

## Debugging

Use `console.log` while developing scripts, then check Obsidian's developer
console. Keep scripts small enough that each step can be tested independently
before adding it to a longer macro.
