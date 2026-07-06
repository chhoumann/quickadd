---
title: Macros
---

# Macros

Macros are the most powerful feature in QuickAdd, allowing you to chain together multiple operations into automated workflows. Think of macros as custom scripts that can execute any sequence of Obsidian commands, user scripts, AI commands, and more.

> **Tip:** Once you have a macro (or entire collections of choices) that you love, use the
> [QuickAdd package exporter](./Packages) to bundle it with its dependencies and share the
> `.quickadd.json` file with other vaults.

## What are Macros?

A **macro** is a collection of commands that execute sequentially. Each macro is associated with a **macro choice**, which allows you to trigger the macro from the QuickAdd command palette.

### Key Concepts

- **Macro Choice**: The trigger that appears in the QuickAdd menu
- **Macro**: The actual sequence of commands that gets executed
- **Commands**: Individual operations within a macro (Obsidian commands, scripts, AI prompts, etc.)
- **Variables**: Data that can be passed between commands within a macro

## Creating a Macro

### Step 1: Create a Macro Choice

1. Open QuickAdd settings
2. Click "Add Choice" and select "Macro"
3. Give your macro choice a descriptive name
4. Click the configure button (⚙️) to open the macro builder

![The Macro builder](../Images/choices/macro-builder.png)

### Step 2: Build Your Macro

In the Macro Builder, you can add different types of commands:

#### Command Types

1. **Obsidian Command** - Execute any Obsidian command
   - Examples: "Daily notes: Open today's daily note", "Toggle reading view"
2. **Editor Commands** - Manipulate text in the editor
   - Copy, Cut, Paste
   - Paste with format - Preserves rich formatting from clipboard (HTML → Markdown)
   - Select active line
   - Select link on active line
   - Move cursor to file start
   - Move cursor to file end
   - Move cursor to line start
   - Move cursor to line end
3. **User Script** - Run custom JavaScript code
   - Access the Obsidian API
   - Perform complex operations
   - Integrate with other plugins
4. **Nested Choice** - Execute another QuickAdd choice
   - Reuse existing templates, captures, or other macros
   - Create modular workflows
5. **Wait** - Add delays between commands
   - Useful when commands need time to complete
   - Specified in milliseconds
6. **AI Assistant** - Execute AI prompts
   - Generate content based on templates
   - Process notes with AI
   - Available with configured AI providers
7. **Open File** - Open files with formatted paths
   - Supports all QuickAdd formatting syntax (`{{DATE}}`, `{{VALUE}}`, etc.)
   - Configurable tab and split options
   - Opens files in default view mode with focus
   - Only opens existing files (no auto-creation)
8. **Conditional** - Branch macro execution based on live data
   - Compare macro variables using equality, numeric, or containment checks
   - Run custom scripts that return a boolean to choose a branch
   - Configure "then" and optional "else" command sequences from the builder

### Add a User Script Command

Macros do not contain JavaScript code directly. Your code lives either in a
`.js` file inside your vault **or** in a ` ```js ` code block inside a note, and
the macro simply runs it. The note option is handy on mobile, where Obsidian
cannot open `.js` files — see [User Scripts](../UserScripts.md#scripts-in-a-note-code-block).

Create a new script file such as `scripts/my-macro.js`, or a note such as
`Scripts/my-macro.md` with your code in a ` ```js ` (or ` ```javascript `)
block. QuickAdd runs the **first** matching JavaScript fence in a note and
ignores surrounding prose.

Keep the script inside your vault, but not inside `.obsidian` or any folder
whose name starts with a dot. Obsidian may exclude hidden folders from its file
index, and QuickAdd builds the picker from Obsidian's indexed vault files. Use a
normal folder such as `scripts/` or a visible underscore-prefixed folder such as
`_quickadd/scripts/`.

Open the Macro Builder and add a **User Script** command. The **Browse** button
opens QuickAdd's script picker, not a native file picker. It lists the `.js`
files and notes-with-a-code-block Obsidian has already discovered in the vault,
so it cannot pick files outside the vault or hidden from Obsidian's index.

You can also type the script into the text field and click **Add**. For a `.js`
file, type its basename — for `scripts/my-macro.js`, enter `my-macro`. For a
note, type its vault path, e.g. `Scripts/my-macro.md`. To run a specific exported
member, append it with `::`, such as `my-macro::start`.

If the script exports multiple functions and you do not specify a member,
QuickAdd will ask which export to run. You can also set an output variable name
so later commands can reuse the result.

If your goal is to insert text into a note, use a **Template** or **Capture**
choice and run it from the macro using a **Nested Choice** command. This is the
intended way to write content. No YAML frontmatter is required.

If your script calls APIs from other plugins, those plugins must be installed
and enabled in your vault. You do not need any extra plugins just to run user
scripts in macros.

### Conditional Commands

Conditional commands let you branch your macro without writing boilerplate JavaScript. Each conditional includes:

- **Condition mode** – Choose between comparing a macro variable or running a script that returns `true`/`false`.
- **Variable comparisons** – Evaluate variables using operators like equals, contains, less/greater than, or basic truthiness checks. Value types (text, number, boolean) control how comparisons are coerced.
- **Script mode** – Point to a JavaScript file in your vault (with optional exported function) that returns a boolean. The script receives the same parameters as user scripts, including access to macro variables and `params.abort`.
- **Branch editors** – Configure the commands that should run when the condition passes or fails. Each branch is a full command sequence, so you can nest additional conditionals or reuse any macro command type.

To add a conditional:

1. Click the branch icon in the command bar of the Macro Builder (or any conditional branch editor).
2. Click the settings icon on the new command to define the condition.
3. Use the branch buttons to configure the commands that run for the **Then** and **Else** outcomes.

Macros execute the matching branch in order and then continue with the rest of the macro. Branch commands share the same variable map as the outer macro, so they can read or update variables for later steps.

## Editor Commands

Editor commands provide text manipulation capabilities within the active editor:

### Paste with Format

The **Paste with format** command preserves rich formatting when pasting content from external sources. Unlike the standard paste command which only handles plain text, this command:

- **Detects HTML content** in your clipboard
- **Converts to Markdown** using Obsidian's built-in conversion
- **Preserves formatting** like links, bold text, italics, headers, and lists
- **Falls back gracefully** to plain text when HTML isn't available

**Example use cases:**
- Copy a formatted link from a webpage → Pastes as `[Link Text](https://example.com)`
- Copy formatted text with bold/italic → Preserves **bold** and *italic* formatting
- Copy a bulleted list → Converts to proper Markdown list syntax
- Copy tables from websites → Converts to Markdown table format

**Browser compatibility:** Uses modern clipboard APIs with automatic fallback for older versions.

### Other Editor Commands

- **Copy/Cut/Paste**: Standard clipboard operations
- **Select active line**: Selects the entire line where your cursor is positioned
- **Select link on active line**: Finds and selects any link on the current line
- **Move cursor to file start**: Moves the cursor to the beginning of the file
- **Move cursor to file end**: Moves the cursor to the end of the file
- **Move cursor to line start**: Moves the cursor to the beginning of the current line
- **Move cursor to line end**: Moves the cursor to the end of the current line

## User Scripts

User scripts extend macro functionality with custom JavaScript — written in a
`.js` file or in a ` ```js ` code block inside a note. They have access to:
- The Obsidian app object
- The QuickAdd API
- A variables object for passing data between commands

:::warning Script Placement Requirements

User scripts (a `.js` file, or a note with a ` ```js ` block) must be placed in your Obsidian vault, but **NOT** in the `.obsidian` directory or in hidden folders (folders starting with a dot).

✅ **Valid locations:**
- `/scripts/myScript.js`
- `/_quickadd/scripts/myScript.js`
- `/macros/utilities/helper.js`
- `/my-custom-folder/script.js`
- Any folder in your vault except `.obsidian` or hidden folders

❌ **Invalid locations:**
- `/.obsidian/plugins/quickadd/scripts/myScript.js`
- `/.obsidian/scripts/myScript.js`
- `/.quickadd/scripts/myScript.js` (hidden folder - use `_quickadd` instead)
- `/.scripts/myScript.js` (hidden folder - use `_scripts` instead)
- Any path within the `.obsidian` directory
- Any path within folders starting with a dot (.)

Scripts placed in the `.obsidian` directory or hidden folders are intentionally ignored and will not appear in the script selection dialog.

:::

### Basic Script Structure

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

### Using the QuickAdd API

The QuickAdd API provides several useful methods:

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

### Getting the current selection

Use the utility helper to read the active editor selection. It returns an empty
string when nothing is selected or no editor is active.

```javascript
module.exports = async (params) => {
    const selection = params.quickAddApi.utility.getSelection();
    if (selection) {
        params.variables.selectedText = selection;
    }
};
```

### Accessing Other Plugins

Scripts can interact with other Obsidian plugins:

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

## Variables and Data Flow

Macro commands share one temporary variable map during the current Macro run. User scripts can write `params.variables.bookTitle`, and later Template or Capture commands can read `{{VALUE:bookTitle}}`.

For the full rules, including named `VALUE` prompts, empty values, AI Assistant output variables, and the `executeChoice` boundary, see [Variables and data flow](../VariablesDataFlow.md).

## Advanced Script Patterns

### Exporting Multiple Functions

Scripts can export multiple functions, giving users options:

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

### Direct Function Access

You can skip the selection prompt by specifying the function directly:
- `{{MACRO:MyMacro::option1}}` - Runs option1 directly
- `{{MACRO:MyMacro::start}}` - Runs the start function

When a macro has more than one user script, `Macro::member` uses the script
that uniquely exports the requested member across all scripts in the macro.

QuickAdd resolves `Macro::member` like this:
- If exactly one script exports the requested member, QuickAdd uses it.
- If no script exports the requested member, QuickAdd stops and shows an error.
  - Exception: if the macro has no user-script commands at all, QuickAdd cannot
    satisfy member access — it logs a warning and returns an empty result instead
    of stopping the macro.
- If multiple scripts export the requested member, QuickAdd stops and lists the
  conflicting script names instead of guessing.
- Exception: the convention keys `settings`, `entry`, and `quickadd` (which many
  scripts export as metadata rather than entrypoints) resolve to the **first** script
  that exports them and show a one-time notice pointing at the selector form below,
  rather than stopping. Use the selector if you need a different script.

If there is a conflict, you can target a specific script by name:
- `{{MACRO:MyMacro::Script 1::option1}}`

The script selector uses the macro command name shown in the editor. If multiple
user-script commands share the same name, rename one of them before using the
selector form.

## Macro Settings

![The Macro builder, including the Run on startup toggle](../Images/choices/macro-builder.png)

### Run on startup
Enable this to automatically run a macro when Obsidian starts. Useful for:
- Creating daily notes automatically
- Setting up your workspace
- Running maintenance tasks

## Practical Examples

### Example 1: Book Logging Macro

This macro logs books to your daily note:

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

### Example 2: Task Management Macro

Create a task with automatic scheduling:

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

### Example 3: Research Workflow

Chain multiple operations for research:

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

## Macro Execution Control

### Automatic Abort Behavior

Macros automatically stop execution in the following situations:

1. **User Cancellation**: When a user presses Escape or clicks Cancel in any prompt
2. **Script Errors**: When an unhandled error occurs in a user script
3. **Explicit Abort**: When `params.abort()` is called in a script

**What happens when a macro aborts:**
- All remaining commands in the macro are skipped
- A message is logged explaining why the macro stopped
- For user cancellations and explicit aborts, no error dialog is shown
- For script errors, the full error with stack trace is preserved for debugging

## Best Practices

### 1. Error Handling
Always include error handling in your scripts:

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

### 2. Check for Plugin Dependencies
Verify required plugins are available:

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

### 3. Use Meaningful Variable Names
Choose descriptive variable names for clarity:
- ✅ `variables.projectName`
- ✅ `variables.meetingDate`
- ❌ `variables.var1`
- ❌ `variables.temp`

### 4. Modular Design
Break complex macros into smaller, reusable parts:
- Create separate scripts for distinct operations
- Use nested choices to reuse existing functionality
- Keep scripts focused on a single purpose

## Troubleshooting

### Common Issues

**"Syntax error: unexpected identifier"**
- This usually means there's a JavaScript syntax error in your script
- Check for missing semicolons, brackets, or quotes
- See [issue #417](https://github.com/chhoumann/quickadd/issues/417) for detailed solutions

**"Cannot read property of undefined"**
- A plugin or API you're trying to access doesn't exist
- Add null checks before accessing plugin APIs
- Ensure plugins are enabled before running the macro

**Variables not passing between commands**
- Use a named token such as `{{VALUE:sharedName}}` or set `params.variables.sharedName` for values that later Macro steps need.
- Make sure scripts run before the commands that read their variables.
- See [Variables and data flow](../VariablesDataFlow.md) for the full run-variable model.

**Macro not appearing in command palette**
- Ensure the macro choice is enabled in settings
- Restart Obsidian if you've just created the macro
- Check that QuickAdd is enabled in Community Plugins

## Tips and Tricks

1. **Test incrementally**: Build your macro step by step, testing each command
2. **Use console.log**: Debug scripts by logging values to the developer console
3. **Backup complex scripts**: Keep your JavaScript files in your vault for version control
4. **Share macros**: Export/import macro configurations with other users
5. **Combine with hotkeys**: Assign keyboard shortcuts to frequently used macros

## See Also

- [Template Choices](TemplateChoice.md) - For creating new notes
- [Capture Choices](CaptureChoice.md) - For appending to existing notes
- [Format Syntax](../FormatSyntax.md) - Available template variables
- [QuickAdd API](../QuickAddAPI.md) - Detailed API documentation
- [Examples](../Examples/Macro_BookFinder.md) - Pre-built macro examples
