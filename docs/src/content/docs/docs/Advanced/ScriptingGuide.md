---
title: Scripting Overview
description: Choose between user scripts, inline scripts, and macros, and see how values move through a macro run via the shared variables object
slug: docs/Advanced/ScriptingGuide
---

QuickAdd scripts are JavaScript files that run inside Obsidian. They can ask you
for input, call Obsidian's own APIs, read data from other plugins, and hand
values back to a Macro. This page helps you pick which kind of script to write,
then points you at the detailed guides.

You don't need to be a programmer to use scripting, but you do need to be
comfortable pasting and lightly editing JavaScript.

## Which one do I want? {#which-scripting-feature-should-i-use}

| Need | Use | Why |
| --- | --- | --- |
| A reusable script with settings | User script | Best for larger workflows and shared code |
| A small transformation inside a template or capture | Inline script | Keeps tiny logic close to the format using it |
| Several script and choice steps in sequence | Macro choice | Coordinates order, variables, and abort behavior |
| A script users can configure from the QuickAdd UI | Script with settings | Lets non-coders change values without editing JavaScript |

## What a user script looks like {#basic-user-script-shape}

Every user script exports one function. QuickAdd calls it with a `params`
object and waits for it to finish:

```javascript
module.exports = async (params) => {
  const { app, quickAddApi, variables } = params;
  const title = await quickAddApi.inputPrompt("Title");

  variables.title = title;
  return title;
};
```

The `params` object is how your script reaches everything it needs:

- `app`: the Obsidian app instance
- `quickAddApi`: QuickAdd's prompt, utility, AI, and execution helpers
- `variables`: values shared across macro steps

## How a value travels through a macro {#how-values-move-through-a-macro}

When a macro runs several steps, they pass values to each other through the
shared `variables` object:

1. A choice or script asks for a value.
2. QuickAdd stores that value in `variables`.
3. Later template, capture, and script steps can reuse it.
4. If a prompt is cancelled, QuickAdd aborts the macro unless your script handles
   the cancellation.

Use named values like `{{VALUE:project}}` when several macro steps should share
one prompt.

## A good order to learn this in {#suggested-learning-order}

1. [Macro Choices](/docs/Choices/MacroChoice/) for how macro steps are assembled.
2. [User Scripts](/docs/UserScripts/) for complete scripting patterns.
3. [Scripts with Settings](/docs/Advanced/scriptsWithSettings/) for configurable scripts.
4. [QuickAdd API Reference](/docs/QuickAddAPI/) for exact method details.

## Debugging {#debugging}

Sprinkle `console.log` through a script while you build it, then read the output
in Obsidian's developer console. Keep each script small enough that you can test
one step at a time before wiring it into a longer macro.
