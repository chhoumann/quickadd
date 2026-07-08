---
title: Macros
description: Chain Obsidian commands, user scripts, nested choices, AI steps, and conditionals into one automated command that shares data between steps
slug: docs/Choices/MacroChoice
---

A macro chains several QuickAdd actions into one command you can run from the
palette or a hotkey. Instead of running a template, then a capture, then a
script by hand, a macro runs them in order and passes data from one step to the
next. Reach for a macro when a single choice isn't enough. Use it to:

- Ask a question once and reuse the answer across several steps
- Run your own JavaScript to talk to the Obsidian API or another plugin
- Branch the workflow based on what you picked or what a script returns
- Kick off a routine automatically when Obsidian starts

Macros are QuickAdd's most capable - and most technical - choice type. You
don't need to be a programmer to start: the walkthrough below uses no code at
all. The deeper sections assume you're comfortable with a little JavaScript.

:::tip
Once you have a macro (or a whole collection of choices) that you love, use the
[QuickAdd package exporter](/docs/Choices/Packages/) to bundle it with its
dependencies and share the `.quickadd.json` file with other vaults.
:::

## What is a macro? {#what-are-macros}

A **macro** is a list of commands that run one after another. Each macro is
paired with a **macro choice**, the entry that shows up in the QuickAdd menu and
gives you something to trigger.

### The pieces {#key-concepts}

- **Macro choice** - the trigger that appears in the QuickAdd menu.
- **Macro** - the actual sequence of commands that runs.
- **Commands** - the individual steps (Obsidian commands, scripts, AI prompts, and more).
- **Variables** - data that one command sets and a later command reads, all within a single run.

## Set up your first macro {#creating-a-macro}

We'll build a tiny macro with no code: it opens today's daily note and drops
your cursor at the end, ready to type. Two commands, run as one.

### Step 1: Create the macro choice {#step-1-create-a-macro-choice}

1. Open **Settings → QuickAdd**, type a name like `Open daily note`, choose
   **Macro** in the dropdown, and click **Add Choice**.
2. Click the gear (⚙) next to the new choice to open the Macro Builder.

![The Macro builder](../Images/choices/macro-builder.png)

### Step 2: Build the macro {#step-2-build-your-macro}

1. In the Macro Builder, add an **Obsidian Command** and pick
   `Daily notes: Open today's daily note`.
2. Add an **Editor commands** entry and choose **Move cursor to file end**.
3. Close the builder, then run it: command palette →
   `QuickAdd: Run` → `Open daily note`.

Your daily note opens and the cursor sits at the end of the file, ready for the
next line - both steps in a single command. Assign the choice a hotkey (the ⚡
icon, or Obsidian's Hotkeys settings) once it behaves the way you want.

## The commands you can add {#command-types}

The Macro Builder offers these command types. Add as many as you like, in any
order.

| Command | What it does |
| --- | --- |
| **Obsidian Command** | Run any Obsidian command, for example `Daily notes: Open today's daily note` or `Toggle reading view`. |
| **Editor commands** | Manipulate text in the active editor: copy, cut, paste, [paste with format](#paste-with-format), select the line or a link on it, and move the cursor. See [Editor commands](#editor-commands). |
| **User Script** | Run your own JavaScript to reach the Obsidian API, do complex work, or integrate with other plugins. See [Add a user script command](#add-a-user-script-command). |
| **Nested Choice** | Run another QuickAdd choice - a template, capture, or another macro - so you can reuse existing work and build modular workflows. |
| **Wait** | Pause for a set number of milliseconds, useful when a previous command needs time to finish. |
| **AI Assistant** | Run an AI prompt to generate or process content. Available once you've configured an AI provider. |
| **Open File** | Open an existing file at a formatted path. Supports all [format syntax](/docs/FormatSyntax/) (`{{DATE}}`, `{{VALUE}}`, and so on), with tab and split options. It opens in the default view mode with focus, and only opens files that already exist (it won't create one). |
| **Conditional** | Branch the run based on live data. See [Branch with a conditional](#conditional-commands). |

### Add a user script command {#add-a-user-script-command}

Macros don't contain JavaScript directly. Your code lives either in a `.js` file
inside your vault **or** in a ` ```js ` code block inside a note, and the macro
simply runs it. The note option is handy on mobile, where Obsidian cannot open
`.js` files - see
[User Scripts](/docs/UserScripts/#scripts-in-a-note-code-block).

Create a script file such as `scripts/my-macro.js`, or a note such as
`Scripts/my-macro.md` with your code in a ` ```js ` (or ` ```javascript `)
block. QuickAdd runs the **first** matching JavaScript block in a note and
ignores the surrounding prose.

To add it, open the Macro Builder and add a **User Script** command. There are
two ways to point it at your script:

- **Browse** opens QuickAdd's script picker (not your operating system's file
  picker). It lists the `.js` files and notes-with-a-code-block that Obsidian
  has already discovered, so it can't reach files outside the vault or hidden
  from Obsidian's index.
- **Type it in.** For a `.js` file, type its basename - for
  `scripts/my-macro.js`, enter `my-macro`. For a note, type its vault path, for
  example `Scripts/my-macro.md`. Then click **Add**. To run a specific exported
  function, append it with `::`, such as `my-macro::start`.

If the script exports more than one function and you don't name one, QuickAdd
asks which export to run. You can also set an output variable name so later
commands can reuse the result.

:::caution[Where to keep scripts]
Keep the script inside your vault, but **not** inside `.obsidian` or any folder
whose name starts with a dot. Obsidian may exclude hidden folders from its file
index, and QuickAdd builds the picker from Obsidian's indexed files, so a hidden
script never shows up. Use a normal folder such as `scripts/`, or a visible
underscore-prefixed folder such as `_quickadd/scripts/`. Full rules are in
[User scripts](#user-scripts).
:::

Good to know:

- To **insert text into a note**, don't write it in a script. Use a **Template**
  or **Capture** choice and run it from the macro as a **Nested Choice**
  command. That's the intended way to write content, and no YAML frontmatter is
  required.
- If your script calls the API of another plugin, that plugin must be installed
  and enabled in your vault. You don't need any extra plugin just to run user
  scripts.

### Branch with a conditional {#conditional-commands}

A conditional command lets your macro take one path or another without writing
boilerplate JavaScript. Each conditional has:

- **Condition mode** - compare a macro variable, or run a script that returns
  `true`/`false`.
- **Variable comparisons** - test a variable with operators like equals,
  contains, less than, greater than, or a basic truthiness check. The value type
  (text, number, boolean) controls how the two sides are compared.
- **Script mode** - point to a JavaScript file in your vault (with an optional
  exported function) that returns a boolean. The script gets the same parameters
  as any user script, including your macro variables and `params.abort`.
- **Branch editors** - the commands that run when the condition passes
  (**Then**) or fails (**Else**). Each branch is a full command sequence, so you
  can nest more conditionals or reuse any command type.

To add one:

1. Click the branch icon in the command bar of the Macro Builder (or of any
   conditional branch editor).
2. Click the settings icon on the new command to define the condition.
3. Use the branch buttons to set the commands that run for the **Then** and
   **Else** outcomes.

The macro runs the matching branch in order, then continues with the rest of the
macro. Branch commands share the same variable map as the outer macro, so they
can read or update variables for later steps.

## Editor commands {#editor-commands}

Editor commands manipulate text in the active editor.

### Paste with format {#paste-with-format}

**Paste with format** preserves rich formatting when you paste from an external
source. Unlike the standard paste, which handles plain text only, it:

- **Detects HTML** in your clipboard
- **Converts it to Markdown** using Obsidian's built-in conversion
- **Preserves formatting** like links, bold, italics, headers, and lists
- **Falls back gracefully** to plain text when no HTML is available

What that looks like in practice:

| You copy | You paste |
| --- | --- |
| A formatted link from a webpage | `[Link Text](https://example.com)` |
| Text with bold/italic | **bold** and *italic* preserved |
| A bulleted list | A proper Markdown list |
| A table from a website | A Markdown table |

:::note
Paste with format uses modern clipboard APIs, with an automatic fallback for
older versions.
:::

### The other editor commands {#other-editor-commands}

- **Copy / Cut / Paste** - standard clipboard operations.
- **Select active line** - select the whole line the cursor is on.
- **Select link on active line** - find and select a link on the current line.
- **Move cursor to file start / file end** - jump to the beginning or end of the file.
- **Move cursor to line start / line end** - jump to the beginning or end of the current line.

## User scripts {#user-scripts}

A user script extends a macro with custom JavaScript, written either in a `.js`
file or in a ` ```js ` code block inside a note. Scripts have access to:

- The Obsidian `app` object
- The QuickAdd API
- A `variables` object for passing data between commands

:::caution[Where scripts can live]
A user script (a `.js` file, or a note with a ` ```js ` block) must sit inside
your Obsidian vault, but **not** in the `.obsidian` directory or in any hidden
folder (one whose name starts with a dot).

✅ **Valid locations:**

- `/scripts/myScript.js`
- `/_quickadd/scripts/myScript.js`
- `/macros/utilities/helper.js`
- `/my-custom-folder/script.js`
- Any folder in your vault except `.obsidian` or a hidden folder

❌ **Invalid locations:**

- `/.obsidian/plugins/quickadd/scripts/myScript.js`
- `/.obsidian/scripts/myScript.js`
- `/.quickadd/scripts/myScript.js` (hidden folder - use `_quickadd` instead)
- `/.scripts/myScript.js` (hidden folder - use `_scripts` instead)
- Any path within the `.obsidian` directory
- Any path within a folder starting with a dot (.)

Scripts in the `.obsidian` directory or in hidden folders are intentionally
ignored and won't appear in the script picker.
:::

### The basic script shape {#basic-script-structure}

Export an async function. QuickAdd calls it with a `params` object that carries
everything you need.

```javascript
module.exports = async (params) => {
    // Destructure the parameters
    const { app, quickAddApi, variables } = params;

    // Your code here
    console.log("Hello from my macro!");

    // Set a variable for use in later commands
    variables.myResult = "Some value";
};
```

### Prompt the user: the QuickAdd API {#using-the-quickadd-api}

`quickAddApi` gives you ready-made prompts so you don't have to build UI:

```javascript
module.exports = async (params) => {
    const { quickAddApi } = params;

    // Input prompt - get text from user
    const name = await quickAddApi.inputPrompt("Enter your name:");

    // Yes/No prompt
    const confirmed = await quickAddApi.yesNoPrompt("Are you sure?");

    // Suggester - let user choose from options
    const choice = await quickAddApi.suggester(
        ["Option 1", "Option 2", "Option 3"],  // Display values
        ["value1", "value2", "value3"]         // Actual values
    );

    // Wide input prompt - for longer text
    const longText = await quickAddApi.wideInputPrompt("Enter description:");

    // Checkbox prompt - multiple selections
    const selections = await quickAddApi.checkboxPrompt(
        ["Task 1", "Task 2", "Task 3"]
    );
};
```

For the full list of methods, see the [QuickAdd API](/docs/QuickAddAPI/).

### Read the editor selection {#getting-the-current-selection}

Use the utility helper to read whatever text is selected in the active editor.
It returns an empty string when nothing is selected or no editor is active.

```javascript
module.exports = async (params) => {
    const selection = params.quickAddApi.utility.getSelection();
    if (selection) {
        params.variables.selectedText = selection;
    }
};
```

### Reach into other plugins {#accessing-other-plugins}

A script can talk to other Obsidian plugins through `app.plugins.plugins`. Check
that the plugin is there before using it:

```javascript
module.exports = async (params) => {
    const { app } = params;

    // Access Templater
    const templater = app.plugins.plugins["templater-obsidian"];
    if (templater) {
        // Use Templater API
    }

    // Access MetaEdit
    const metaedit = app.plugins.plugins["metaedit"];
    if (metaedit) {
        const { update } = metaedit.api;
        await update("property", "value", "path/to/file.md");
    }
};
```

## Pass data between commands: variables {#variables-and-data-flow}

Every command in a macro shares one temporary variable map for the current run.
A user script can write `params.variables.bookTitle`, and a later Template or
Capture command can read it back as `{{VALUE:bookTitle}}`.

For the full rules - named `VALUE` prompts, empty values, AI Assistant output
variables, and the `executeChoice` boundary - see
[Variables and data flow](/docs/VariablesDataFlow/).

## Advanced script patterns {#advanced-script-patterns}

### Offer several actions from one script {#exporting-multiple-functions}

A script can export more than one function, so one file offers a menu of
actions:

```javascript
module.exports = {
    option1: async (params) => {
        console.log("Running option 1");
    },

    option2: async (params) => {
        console.log("Running option 2");
    },

    // Can also include variables
    defaultValue: "some default",

    // Main entry point
    start: async (params) => {
        const { quickAddApi } = params;
        const choice = await quickAddApi.suggester(
            ["Run Option 1", "Run Option 2"],
            ["option1", "option2"]
        );

        if (choice === "option1") {
            await module.exports.option1(params);
        } else if (choice === "option2") {
            await module.exports.option2(params);
        }
    }
};
```

### Run one export directly: `Macro::member` {#direct-function-access}

You can skip the "which export?" prompt by naming the function:

- `{{MACRO:MyMacro::option1}}` runs `option1` directly.
- `{{MACRO:MyMacro::start}}` runs the `start` function.

When a macro has more than one user script, `Macro::member` picks the script
that uniquely exports the requested member across all scripts in the macro.
QuickAdd resolves it like this:

- If exactly one script exports the member, QuickAdd uses it.
- If no script exports the member, QuickAdd stops and shows an error.
  - Exception: if the macro has no user-script commands at all, QuickAdd can't
    satisfy member access - it logs a warning and returns an empty result
    instead of stopping the macro.
- If several scripts export the member, QuickAdd stops and lists the conflicting
  script names instead of guessing.
- Exception: the convention keys `settings`, `entry`, and `quickadd` (which many
  scripts export as metadata rather than entrypoints) resolve to the **first**
  script that exports them and show a one-time notice pointing at the selector
  form below, rather than stopping. Use the selector if you need a different
  script.

When there's a conflict, target a specific script by name:

- `{{MACRO:MyMacro::Script 1::option1}}`

The selector uses the macro command name shown in the editor. If two user-script
commands share the same name, rename one before using the selector form.

## Macro settings {#macro-settings}

![The Macro builder, including the Run on startup toggle](../Images/choices/macro-builder.png)

### Run on startup {#run-on-startup}

Enable this to run a macro automatically when Obsidian starts. Handy for:

- Creating a daily note automatically
- Setting up your workspace
- Running maintenance tasks

## Practical examples {#practical-examples}

### Example 1: Log a book to your daily note {#example-1-book-logging-macro}

Prompt for a book name and write it into today's daily note (using the MetaEdit
plugin):

```javascript
module.exports = async (params) => {
    const { quickAddApi: { inputPrompt }, app } = params;

    // Get book name from user
    const bookName = await inputPrompt("📖 Book Name");

    // Get MetaEdit plugin
    const { update } = app.plugins.plugins["metaedit"].api;

    // Format today's date
    const date = window.moment().format("YYYY-MM-DD");

    // Update the daily note
    await update("Book", bookName, `Daily Notes/${date}.md`);
};
```

### Example 2: Create a task with priority {#example-2-task-management-macro}

Ask for a task and a priority, then hand them to a later Template command as
variables:

```javascript
module.exports = async (params) => {
    const { quickAddApi, app, variables } = params;

    // Get task details
    const task = await quickAddApi.inputPrompt("Task description:");
    const priority = await quickAddApi.suggester(
        ["🔴 High", "🟡 Medium", "🟢 Low"],
        ["high", "medium", "low"]
    );

    // Set variables for use in template
    variables.taskDescription = task;
    variables.taskPriority = priority;
    variables.taskCreated = new Date().toISOString();

    // Create task note using template (in next macro command)
};
```

### Example 3: Scaffold a research workspace {#example-3-research-workflow}

Chain several operations: create a folder structure for a topic, then set
variables for a later template step to fill an overview note.

```javascript
module.exports = async (params) => {
    const { quickAddApi, app, variables } = params;

    // Get research topic
    const topic = await quickAddApi.inputPrompt("Research topic:");

    // Create folder structure
    const vault = app.vault;
    const researchFolder = `Research/${topic}`;

    // Check if folder exists
    if (!await vault.adapter.exists(researchFolder)) {
        await vault.createFolder(researchFolder);
        await vault.createFolder(`${researchFolder}/Sources`);
        await vault.createFolder(`${researchFolder}/Notes`);
    }

    // Set variables for template
    variables.researchTopic = topic;
    variables.researchFolder = researchFolder;

    // Next commands in macro will create the overview note
};
```

## When a macro stops {#macro-execution-control}

### What stops a macro {#automatic-abort-behavior}

A macro stops early in three situations:

1. **You cancel** - press Escape or click Cancel in any prompt.
2. **A script errors** - an unhandled error is thrown in a user script.
3. **A script aborts on purpose** - `params.abort()` is called.

When a macro stops:

- Every remaining command is skipped.
- A message is logged explaining why.
- For your own cancel and for explicit aborts, no error dialog appears.
- For a script error, the full error and stack trace are kept for debugging.

## Best practices {#best-practices}

### 1. Handle errors {#1-error-handling}

Wrap script work in `try`/`catch` so a failure is visible and stops the rest of
the macro:

```javascript
module.exports = async (params) => {
    try {
        // Your code here
    } catch (error) {
        console.error("Macro error:", error);
        new Notice(`Macro failed: ${error.message}`);
        throw error; // Re-throw to stop remaining macro commands
    }
};
```

### 2. Check for plugin dependencies {#2-check-for-plugin-dependencies}

Confirm a required plugin is present before you use it:

```javascript
module.exports = async (params) => {
    const { app } = params;

    const requiredPlugin = app.plugins.plugins["plugin-id"];
    if (!requiredPlugin) {
        new Notice("Required plugin not found!");
        return;
    }

    // Continue with plugin operations
};
```

### 3. Use meaningful variable names {#3-use-meaningful-variable-names}

Descriptive names keep a macro readable:

- ✅ `variables.projectName`
- ✅ `variables.meetingDate`
- ❌ `variables.var1`
- ❌ `variables.temp`

### 4. Keep it modular {#4-modular-design}

Break a complex macro into smaller, reusable parts:

- Put distinct operations in separate scripts.
- Reuse existing choices with **Nested Choice** commands.
- Keep each script focused on a single purpose.

## Troubleshooting {#troubleshooting}

### Common issues {#common-issues}

**"Syntax error: unexpected identifier"**

- Usually a JavaScript syntax error in your script.
- Check for a missing semicolon, bracket, or quote.
- See [issue #417](https://github.com/chhoumann/quickadd/issues/417) for detailed solutions.

**"Cannot read property of undefined"**

- A plugin or API you're reaching for doesn't exist.
- Add a null check before you use a plugin's API.
- Make sure the plugin is enabled before you run the macro.

**Variables not passing between commands**

- Use a named placeholder such as `{{VALUE:sharedName}}`, or set
  `params.variables.sharedName`, for values later steps need.
- Make sure the script runs *before* the command that reads its variables.
- See [Variables and data flow](/docs/VariablesDataFlow/) for the full model.

**Macro not appearing in command palette**

- Make sure the macro choice is enabled in settings.
- Restart Obsidian if you just created the macro.
- Check that QuickAdd is enabled in Community Plugins.

## Tips and tricks {#tips-and-tricks}

1. **Test incrementally** - build the macro one command at a time, testing each.
2. **Use `console.log`** - log values to the developer console while debugging.
3. **Keep scripts in your vault** - so you can version and back them up.
4. **Share macros** - export and import macro configurations with other users.
5. **Combine with hotkeys** - assign a shortcut to a macro you run often.

## See also {#see-also}

- [Template Choices](/docs/Choices/TemplateChoice/) - for creating new notes
- [Capture Choices](/docs/Choices/CaptureChoice/) - for appending to existing notes
- [Format Syntax](/docs/FormatSyntax/) - available placeholders
- [QuickAdd API](/docs/QuickAddAPI/) - detailed API documentation
- [Examples](/docs/Examples/Macro_BookFinder/) - pre-built macro examples
