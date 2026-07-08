---
title: Variables and data flow
description: How run variables move between prompts, scripts, and Template, Capture, and AI steps within a single QuickAdd run
slug: docs/VariablesDataFlow
---

When a choice runs, QuickAdd keeps one scratchpad of named values for that run.
Prompts, scripts, and AI Assistant commands write values onto it; placeholders
like `{{VALUE:project}}` read them back. In a Macro, every step shares the same
scratchpad in order, so an answer you give in one step is available to every
step after it.

This page is about those **run variables** - the temporary values that exist
only while a Template, Capture, or Macro run is executing. For saved, reusable
snippets that persist across runs, see
[Global Variables](/docs/GlobalVariables/) instead. The exact placeholder
grammar lives in [Format Syntax](/docs/FormatSyntax/); this page is about how
values move between steps.

At a glance, here is what writes a run variable and what reads it back:

| Written by | Read by |
| --- | --- |
| A prompt, such as `{{VALUE:project}}` or `{{VDATE:due,YYYY-MM-DD}}` | `{{VALUE:project}}` in a later field or step |
| A user script (`params.variables.slug = "..."`) | `{{VALUE:slug}}`, or `params.variables.slug` in another script |
| An AI Assistant command's **Output variable name** | `{{VALUE:output}}` |
| A script, the CLI, or the API supplying a value up front | any placeholder that would otherwise prompt |

## Write once, use everywhere {#write-values-once}

Give a value a **name** when the same answer should appear in more than one
place. QuickAdd asks for it once and reuses your answer everywhere the name
appears:

```markdown
File name format:  Projects/{{VALUE:project}}
Template body:     # {{VALUE:project}}
Capture format:    Logged work for {{VALUE:project}}
```

If `project` isn't set yet, QuickAdd asks once and stores your answer under
`project`. Every later `{{VALUE:project}}` in the same run reads that stored
answer instead of asking again. This works across a Template file name, the
Template body, Capture formats, and later Macro steps.

If a script, the CLI, or the QuickAdd API supplies `project` before the
placeholder is formatted, the placeholder uses that value and never asks. A key
that is absent or set to `undefined` counts as missing; an empty string counts
as a deliberate empty answer.

When the prompt should be a picker, define the options once with a name, then
reuse the name on its own:

```markdown
{{VALUE:work,home,urgent|name:category}}
{{VALUE:category}}
```

See [`{{VALUE:<options>|name:<name>}}`](/docs/FormatSyntax/#value-name) for
option lists, display labels, first-definition behavior, and reserved names.

:::note
Leading and trailing spaces around the name are trimmed, so `{{VALUE: project }}`
reads the same variable as `{{VALUE:project}}`. Prefer the no-space form anyway
- it's easier to scan, and safer in shared vaults that might run an older
QuickAdd.

_Trimming introduced in QuickAdd 2.17.2._
:::

## The unnamed answer: `{{VALUE}}` {#the-special-value-input}

The unnamed `{{VALUE}}` reads a special variable called `value`. It's meant for
one-off input, or for a trigger that already supplied some content:

```markdown
{{VALUE}}
```

This is **not** the same as `{{VALUE:project}}`. If an answer needs to survive
across several Macro steps, copy it into a named key and read that instead:

```javascript
module.exports = async (params) => {
    if (params.variables.value !== undefined) {
        params.variables.project = params.variables.value;
    }
};
```

Later steps can then use:

```markdown
{{VALUE:project}}
```

## Sharing values with a script {#scripts-share-the-map}

A user script in a Macro receives `params.variables` - the same scratchpad the
placeholders read from. Write to it, and later steps see your values:

```javascript
module.exports = async (params) => {
    const title = await params.quickAddApi.inputPrompt("Title");

    params.variables.title = title;
    params.variables.slug = title.toLowerCase().replace(/\s+/g, "-");
};
```

Later Macro steps can read them:

```markdown
# {{VALUE:title}}
Slug: {{VALUE:slug}}
```

Two things trip people up here:

- **A plain JavaScript variable isn't enough.** Only values written onto `params.variables` are visible to later steps. A `const title = "Inbox"` stays private to that one script; `params.variables.title = title` is what makes it available.
- **Order matters.** A script must run *before* the Template, Capture, or script step that reads its variables.

:::note
Some older examples name the first parameter `QuickAdd` instead of `params`:

```javascript
module.exports = async (QuickAdd) => {
    QuickAdd.variables.title = "Inbox";
};
```

That works because `QuickAdd` is just the local parameter name - it's the same
object as `params`. New scripts should use `params` to match the rest of the
docs.
:::

## Inline scripts run first {#inline-scripts}

Inline scripts run **before** the ordinary placeholders around them, so an
inline script can't read a value the surrounding output is still about to
prompt for. This does not do what it looks like:

```javascript
const value = "{{VALUE:project}}";
```

While the inline script runs, that's just literal text - the placeholder hasn't
been filled in yet. If the script needs input-aware logic, prompt inside the
script, or read a variable an earlier step already set:

```javascript
const project = this.variables.project;
return project ? `Project: ${project}` : "";
```

## Reading an AI Assistant's output {#ai-assistant-outputs}

An AI Assistant Macro command writes its response to the variable named in its
**Output variable name** setting. The default name is `output`, so later steps
can read:

```markdown
{{VALUE:output}}
```

or, in a script:

```javascript
module.exports = async (params) => {
    console.log(params.variables.output);
};
```

QuickAdd also writes a quote-block version under `<name>-quoted`. With the
default output name that's:

```markdown
{{VALUE:output-quoted}}
```

If you renamed the output variable to `description`, read `{{VALUE:description}}`
and `{{VALUE:description-quoted}}` instead. Both are available to later steps in
the same Macro run.

## `executeChoice` is a trigger, not a function call {#executechoice-is-a-trigger}

The Macro Builder's **Choice** command and the API method
`quickAddApi.executeChoice` look similar but behave differently.

A **Choice** command added inside a Macro runs as part of that Macro's sequence
and shares the Macro's scratchpad with the steps after it.

`quickAddApi.executeChoice(choiceName, variables)` is a **one-way trigger**. It
passes the variables you give it into the target choice, waits for that choice
to finish, and resolves with `undefined` - it does **not** hand the target
choice's output back to the caller. After the target finishes, QuickAdd clears
the temporary variables that execution used. So if you call it from a Macro
script, don't expect your current `params.variables` to still be around
afterward unless you saved and restored them yourself.

Use it to trigger another choice with input:

```javascript
module.exports = async (params) => {
    await params.quickAddApi.executeChoice("Create project note", {
        project: params.variables.project,
    });
};
```

Don't expect a return value back from it:

```javascript
module.exports = async (params) => {
    const result = await params.quickAddApi.executeChoice("Pick project");
    params.variables.project = result; // result is undefined
};
```

When later steps need a value, keep the workflow inside one Macro sequence, set
`params.variables` directly, or call a shared JavaScript helper that returns the
value to your script.

## Troubleshooting {#troubleshooting}

**The same prompt appears more than once.** Use the same named placeholder
everywhere, such as `{{VALUE:project}}`. A bare `{{VALUE}}` and a named
`{{VALUE:project}}` are different inputs.

**A script value is missing in a later Template or Capture.** Set it on
`params.variables`, not only in a local JavaScript variable, and make sure the
script step runs before the step that reads it.

**A placeholder stayed as literal text.** The syntax is `{{VALUE:name}}`. A bare
`{{name}}` is not a QuickAdd placeholder.

**An AI result is missing.** Check the AI Assistant command's **Output variable
name**, then read that exact variable in a later Macro step.

**`executeChoice` returned `undefined`.** That's expected. Use `executeChoice`
to trigger another choice with input variables, not to fetch a return value from
it.
