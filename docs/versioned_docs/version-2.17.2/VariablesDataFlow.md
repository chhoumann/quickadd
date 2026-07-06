---
title: Variables and data flow
---

# Variables and data flow

This page covers run variables - the temporary values that live only while a Template, Capture, or Macro run is executing. For saved, reusable settings, see [Global Variables](./GlobalVariables.md).

QuickAdd keeps one temporary variable map for the current run. Prompts, scripts, and AI Assistant commands can write to that map. Format syntax reads from it. In a Macro, commands run in order and share the same map, so a value collected in one step can be used by later Template, Capture, script, and AI Assistant steps.

This page explains how values move between steps; the exact token grammar lives in [Format Syntax](./FormatSyntax.md).

## Write values once

Use a named `VALUE` token when one answer should appear in more than one place:

```markdown
File name format:
Projects/{{VALUE:project}}

Template body:
# {{VALUE:project}}

Capture format:
Logged work for {{VALUE:project}}
```

If `project` is not already set, QuickAdd asks once and stores the answer under `project`. Later `{{VALUE:project}}` tokens in the same run read that stored value instead of asking again. This works across a Template file name, the Template body, Capture formats, and later Macro steps.

If a script, the CLI, or the QuickAdd API supplies `project` before the token is formatted, the token uses that value and does not ask. An absent key or a key set to `undefined` is treated as missing. An empty string is a deliberate empty answer.

When the prompt should be a suggester, define the options once with a name, then reuse the name:

```markdown
{{VALUE:work,home,urgent|name:category}}
{{VALUE:category}}
```

See [`{{VALUE:<options>|name:<variable name>}}`](./FormatSyntax.md#value-name) for option lists, display labels, first-definition behavior, and reserved names.

In QuickAdd 2.17.2, leading and trailing spaces around the `VALUE` name are trimmed. `{{VALUE: project }}` reads the same variable as `{{VALUE:project}}`. Still prefer the no-space form because it is easier to scan and safer in shared vaults that may have older QuickAdd versions.

## The special `value` input

The unnamed `{{VALUE}}` token reads the special `value` variable. It is useful for one-off input or for a trigger that already supplied content:

```markdown
{{VALUE}}
```

It is not the same as `{{VALUE:project}}`. If a value must survive across multiple Macro steps, put it under a named key and read it with `{{VALUE:name}}`:

```javascript
module.exports = async (params) => {
    if (params.variables.value !== undefined) {
        params.variables.project = params.variables.value;
    }
};
```

Then later steps can use:

```markdown
{{VALUE:project}}
```

## Scripts share the map

User scripts in a Macro receive `params.variables`. That object is the shared run variable map:

```javascript
module.exports = async (params) => {
    const title = await params.quickAddApi.inputPrompt("Title");

    params.variables.title = title;
    params.variables.slug = title.toLowerCase().replace(/\s+/g, "-");
};
```

Later Macro steps can read those values:

```markdown
# {{VALUE:title}}
Slug: {{VALUE:slug}}
```

Some older examples name the first script parameter `QuickAdd`:

```javascript
module.exports = async (QuickAdd) => {
    QuickAdd.variables.title = "Inbox";
};
```

That works because `QuickAdd` is only the local parameter name. It is the same object as `params`. New scripts should use `params` so the code matches the rest of the docs.

Scripts must run before the Template, Capture, or script step that reads their variables. A local JavaScript variable is not enough:

```javascript
module.exports = async (params) => {
    const title = "Inbox"; // Only this script can see it.
    params.variables.title = title; // Later QuickAdd steps can see it.
};
```

## Inline Scripts

Inline scripts run before ordinary format tokens in the surrounding output. Do not expect this to read the prompted value:

```javascript
const value = "{{VALUE:project}}";
```

That string is literal JavaScript text while the inline script runs. If the script needs input-aware logic, prompt inside the script or read a variable that an earlier step already set:

```javascript
const project = this.variables.project;
return project ? `Project: ${project}` : "";
```

## AI Assistant outputs

An AI Assistant Macro command writes its response to the variable named in **Output variable name**. The default name is `output`, so later steps can read:

```markdown
{{VALUE:output}}
```

or, in a script:

```javascript
module.exports = async (params) => {
    console.log(params.variables.output);
};
```

QuickAdd also writes a quote-block version under `<name>-quoted`. With the default output name, use:

```markdown
{{VALUE:output-quoted}}
```

If the command's output variable name is `description`, read `{{VALUE:description}}` and `{{VALUE:description-quoted}}` instead. These variables are available to later steps in the same Macro run.

## `executeChoice` is a trigger

The Macro Builder's **Choice** command and the API method `quickAddApi.executeChoice` are different.

A **Choice** command inside a Macro runs as part of the current Macro sequence and shares the Macro's variable map with later steps.

`quickAddApi.executeChoice(choiceName, variables)` is a one-way trigger. It passes the provided variables into the target choice, waits for that choice to finish, and resolves with `undefined`. It does not return the target choice's output to the caller. After the target choice finishes, QuickAdd clears the temporary variable map used by that API execution. If you call it from inside a Macro script, do not expect the caller's current `params.variables` values to still be available afterward unless you saved or restored them yourself.

Good use:

```javascript
module.exports = async (params) => {
    await params.quickAddApi.executeChoice("Create project note", {
        project: params.variables.project,
    });
};
```

Avoid this pattern:

```javascript
module.exports = async (params) => {
    const result = await params.quickAddApi.executeChoice("Pick project");
    params.variables.project = result; // result is undefined
};
```

If later steps need a value, keep the workflow inside one Macro sequence, set `params.variables` directly, or call shared JavaScript helper code that returns a value to your script.

## Troubleshooting

**The same prompt appears more than once.** Use the same named token everywhere, such as `{{VALUE:project}}`. A bare `{{VALUE}}` and a named `{{VALUE:project}}` are different inputs.

**A script value is missing in a later Template or Capture.** Set it on `params.variables`, not only in a local JavaScript variable, and make sure the script step runs before the step that reads it.

**A token stayed as text.** Format syntax is `{{VALUE:name}}`. A bare `{{name}}` is not a QuickAdd token.

**An AI result is missing.** Check the AI Assistant command's **Output variable name**, then read that exact variable in a later Macro step.

**`executeChoice` returned `undefined`.** That is expected. Use `executeChoice` to trigger another choice with input variables, not to fetch a return value from it.
