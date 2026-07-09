---
title: User Scripts
description: "Write custom JavaScript for macros: script structure, configurable options, the params API, and file and metadata recipes"
slug: docs/UserScripts
---

A user script is a piece of JavaScript you write once and run from a
[Macro](/docs/Choices/MacroChoice/). It can prompt for input, read and write
notes, call Obsidian's own APIs, talk to other plugins, and pass values into the
rest of the macro - the escape hatch for anything QuickAdd's built-in choices
don't cover. This page is the full reference: how a script is shaped, how to
give it settings, what the `params` API offers, and a shelf of copy-paste
recipes.

You don't need to be a professional developer, but you should be comfortable
reading and lightly editing JavaScript.

:::tip[New to scripting?]

Start with the [Scripting Overview](/docs/Advanced/ScriptingGuide/) for the
decision path, then use this page as the detailed reference.

:::

:::note[Obsidian API reference]
Scripts lean heavily on the [Obsidian API](https://docs.obsidian.md/Home). For
anything beyond the recipes here, keep the
[App](https://docs.obsidian.md/Reference/TypeScript+API/App),
[Vault](https://docs.obsidian.md/Reference/TypeScript+API/Vault), and
[Workspace](https://docs.obsidian.md/Reference/TypeScript+API/Workspace)
references open.
:::

## Add a script to a macro {#adding-scripts-to-macros}

A user script can live in either of two places inside your vault:

- a standalone `.js` file, or
- a note (`.md`) containing a ` ```js ` (or ` ```javascript `) code block.

The note form is handy on mobile, where Obsidian can't open `.js` files at all.

:::caution[Where scripts can live]
A user script must sit inside your Obsidian vault, but **not** in the
`.obsidian` directory or in any hidden folder (one whose name starts with a
dot). Obsidian may exclude those from the vault file index QuickAdd uses for
script discovery, so a script there is intentionally ignored and won't appear
in the script picker.

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
:::

In the Macro Builder, **Browse** opens QuickAdd's picker of discovered scripts
(both `.js` files and notes that contain a code block); it is not a native file
picker. If you add a script manually, type a `.js` script's basename - for
`scripts/my-script.js`, enter `my-script` - or, for a note, type its vault path
(e.g. `Scripts/my-script.md`). For a specific export, append a member expression
such as `my-script::start` (or `Scripts/my-script.md::start`).

### Keep a script in a note, for mobile {#scripts-in-a-note-code-block}

Write your script in a ` ```js ` code block inside any note; QuickAdd runs the
**first** ` ```js ` (or ` ```javascript `) block in the note and ignores all
prose and other code blocks. The block is a CommonJS module exactly like a `.js`
file - it must assign `module.exports` / `exports.default` (a top-level `return`
the way [inline scripts](/docs/InlineScripts/) work will **not** export anything):

````markdown
# My script

Notes about what this does - ignored by QuickAdd.

```js
module.exports = async (params) => {
    // Your code here
};
```
````

If the note has no ` ```js ` block, QuickAdd shows a notice and skips the script.

:::note
Only plain ` ```js ` fences are recognized - blocks nested inside callouts or
blockquotes (`> ```js`) and `~~~` fences are not. To embed a literal ` ``` ` line
inside the script body, open the block with four or more backticks.
:::

## The basic shape of a script {#basic-structure}

Every user script must export a module with at least an entry point function:

```javascript
module.exports = async (params) => {
    // Your code here
};
```

Or with the object syntax:

```javascript
module.exports = {
    entry: start,
    settings: {
        name: "Script Name",
        author: "Your Name",
        options: {
            // Define configurable options here
        }
    }
};

async function start(params, settings) {
    // Your code here
}
```

Use the plain function form for a quick script, and the object form when you
want [configurable settings](#configurable-options) in the QuickAdd UI.

## What your script receives {#script-parameters}

The script is called with up to two arguments: `params` (always) and `settings`
(only with the object form above).

### The `params` object {#params-object}

`params` carries the QuickAdd API and the Obsidian context:

```javascript
{
    app: App,                  // Obsidian app instance - see https://docs.obsidian.md/Reference/TypeScript+API/App
    quickAddApi: QuickAddApi,   // QuickAdd API methods (documented below)
    variables: {},              // Variables object for sharing data between scripts and templates
    obsidian: obsidian,         // Obsidian module with all classes and utilities
    abort: (message) => never   // Abort macro execution with optional message
}
```

The `app` object provides access to the entire Obsidian API, including:
- `app.vault` - File and folder operations ([Vault API](https://docs.obsidian.md/Reference/TypeScript+API/Vault))
- `app.workspace` - Window and pane management ([Workspace API](https://docs.obsidian.md/Reference/TypeScript+API/Workspace))
- `app.metadataCache` - File metadata and links ([MetadataCache API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache))
- `app.fileManager` - File operations and renaming ([FileManager API](https://docs.obsidian.md/Reference/TypeScript+API/FileManager))

### The `settings` object {#settings-object}

`settings` holds the user-configured values for your script's options. It's only
passed when you use the object structure with a `settings` block.

## Let users configure your script {#configurable-options}

User scripts can define configurable options that users set through the QuickAdd
UI. This makes your scripts flexible and reusable - a folder path, an API key,
or an on/off toggle becomes a form field instead of a line you have to edit.

### The option types {#option-types}

#### Text: `type: "text"` {#text-input}

For regular string values, paths, names, etc.

```javascript
options: {
    "Project": {
        type: "text",              // or "input"
        defaultValue: "",
        placeholder: "Project name",
        description: "Default project" // Optional: help text
    }
}
```

#### Secret: `type: "secret"` {#secret-input}

For API keys, access tokens, and other sensitive values. Secrets are stored in Obsidian's SecretStorage and QuickAdd stores only a reference in `data.json`.

```javascript
options: {
    "API Key": {
        type: "secret",
        id: "api-key", // Optional stable storage id
        placeholder: "Paste API key",
        description: "Your API key"
    }
}
```

`type: "text"` / `type: "input"` with `secret: true` is still supported for older scripts and is treated as a secret setting.

Secret values are local to the Obsidian app profile. They are not included in QuickAdd package exports and are not synced through the plugin's `data.json`; users must enter them on each device where the script runs.

The optional `id` controls the SecretStorage reference used for the setting. If omitted, QuickAdd uses the option name. Set `id` when you want to rename the visible setting label later without creating a new saved secret.

#### Toggle: `type: "toggle"` {#togglecheckbox}

For boolean on/off settings.

```javascript
options: {
    "Enable Feature": {
        type: "toggle",            // or "checkbox"
        defaultValue: false,
        description: "Enable this feature"
    }
}
```

#### Dropdown: `type: "dropdown"` {#dropdownselect}

For choosing from predefined options.

```javascript
options: {
    "Output Format": {
        type: "dropdown",          // or "select"
        defaultValue: "markdown",
        options: ["markdown", "plain", "html"],
        description: "Choose output format"
    }
}
```

#### Format: `type: "format"` {#format-input}

For template strings with QuickAdd format syntax support.

```javascript
options: {
    "File Name Template": {
        type: "format",
        defaultValue: "{{DATE}} - {{VALUE:title}}",
        placeholder: "Enter template",
        description: "Template for file names"
    }
}
```

### Complete example {#complete-example}

Here's a comprehensive example showing all option types, and reading them back
inside `start`:

```javascript
module.exports = {
    entry: start,
    settings: {
        name: "Advanced Script",
        author: "Your Name",
        options: {
            "API Key": {
                type: "secret",
                placeholder: "sk-...",
                description: "OpenAI API key"
            },
            "Model": {
                type: "dropdown",
                defaultValue: "gpt-3.5-turbo",
                options: ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo"],
                description: "AI model to use"
            },
            "Include Metadata": {
                type: "toggle",
                defaultValue: true,
                description: "Include file metadata in output"
            },
            "Output Template": {
                type: "format",
                defaultValue: "## {{DATE:YYYY-MM-DD}}\n{{VALUE:content}}",
                placeholder: "Template for output",
                description: "Format for the output"
            },
            "Max Results": {
                type: "text",
                defaultValue: "10",
                placeholder: "Number",
                description: "Maximum number of results"
            }
        }
    }
};

async function start(params, settings) {
    const { quickAddApi, app, variables } = params;
    
    // Access settings
    const apiKey = settings["API Key"];
    const model = settings["Model"];
    const includeMetadata = settings["Include Metadata"];
    const outputTemplate = settings["Output Template"];
    const maxResults = parseInt(settings["Max Results"]);
    
    // Validate inputs
    if (!apiKey) {
        new Notice("Please configure your API key in the script settings");
        throw new Error("API key not configured");
    }
    
    // Use QuickAdd API
    const query = await quickAddApi.inputPrompt("Enter your search query:");
    if (!query) return;
    
    // Your logic here...
    console.log(`Using model: ${model}`);
    console.log(`Max results: ${maxResults}`);
    
    if (includeMetadata) {
        // Include metadata logic
    }
    
    // Set variables for use in templates
    variables.model = model;
    variables.query = query;
    variables.resultCount = maxResults;
}
```

## Prompt, format, and run other choices {#using-the-quickadd-api}

User scripts have full access to the [QuickAdd API](/docs/QuickAddAPI/) through `params.quickAddApi`. For complete API documentation, see the [QuickAdd API Reference](/docs/QuickAddAPI/). The sections below cover the calls you'll reach for most.

### Ask the user for input {#user-input}

```javascript
// Text input
const text = await quickAddApi.inputPrompt("Enter text:");

// Wide text input (multi-line)
const longText = await quickAddApi.wideInputPrompt("Enter description:");

// Yes/No confirmation
const confirmed = await quickAddApi.yesNoPrompt("Are you sure?");

// Suggester (dropdown selection)
const choice = await quickAddApi.suggester(
    ["Option 1", "Option 2", "Option 3"],
    ["value1", "value2", "value3"]
);

// Checkbox selection
const selected = await quickAddApi.checkboxPrompt(
    ["Item 1", "Item 2", "Item 3"],
    ["Item 1"]  // Pre-selected items
);
```

### Share values with later steps: variables {#variables}

Set variables that can be used in subsequent template operations:

:::tip[Sharing functions and constants]
Variables pass **data** between steps. To reuse the same **functions or
constants** across scripts, put them in a shared module - see
[Sharing Code Between Scripts](#sharing-code-between-scripts).
:::

```javascript
// Set variables
params.variables.myVariable = "value";
params.variables.timestamp = new Date().toISOString();
params.variables.results = arrayOfResults;

// Variables are accessible in templates as {{VALUE:myVariable}}
```

### Run format syntax yourself {#formatting}

Format strings with QuickAdd syntax:

```javascript
const formatted = await quickAddApi.format(
    "Today is {{DATE}} and the title is {{VALUE:title}}",
    { title: "My Document" }
);
```

### Run another choice {#execute-other-choices}

Trigger other QuickAdd choices programmatically:

```javascript
await quickAddApi.executeChoice("My Other Choice", {
    customVariable: "value"
});
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

The plugin must be installed and enabled in the vault, so check for it and fail
with a clear message when it's missing.

## Handle errors and stop a macro {#error-handling-and-macro-control}

### Stop a macro on purpose: `abort()` {#aborting-macro-execution}

You can intentionally stop a macro using `params.abort()`. This is useful for validation or conditional execution:

```javascript
module.exports = async (params) => {
    const { abort, quickAddApi } = params;
    
    // Get user input
    const projectName = await quickAddApi.inputPrompt("Project name:");
    
    // Validate input
    if (!projectName || projectName.length < 3) {
        abort("Project name must be at least 3 characters");
        // Execution stops here - remaining macro commands won't run
    }
    
    // Continue with valid input
    console.log(`Creating project: ${projectName}`);
};
```

**When to use `params.abort()`:**
- Input validation failures
- Missing required configuration
- You want to provide a custom message after catching a `MacroAbortError`
- Prerequisites not met (e.g., required plugin not installed)

Prompt cancellations already throw `MacroAbortError` and halt macros automatically, so only call `abort()` in those scenarios if you need to surface a custom message or you're stopping for a non-prompt reason.

**What happens when you call `abort()`:**
- Macro execution stops immediately
- A message is logged: "Macro execution aborted: [your message]"
- Remaining commands in the macro are skipped
- No error is thrown to the user

**QuickAdd API methods that can be cancelled:**
- `inputPrompt()`
- `wideInputPrompt()`
- `yesNoPrompt()`
- `suggester()`
- `checkboxPrompt()`

Each of these now rejects with `MacroAbortError("Input cancelled by user")` when the user presses Escape or closes the dialog. If you do nothing, the macro will automatically stop (matching user expectations). If you want to handle cancellation in your script, wrap the call in `try/catch` and intercept the error before it reaches the macro engine.

```javascript
try {
    const name = await quickAddApi.inputPrompt("Your name:");
} catch (error) {
    if (error?.name === "MacroAbortError") {
        // Optional custom handling (e.g., cleanup) before the macro aborts
        return;
    }
    throw error; // real errors should still bubble up
}
```

**Important:** Because cancellations now throw, you should only call `abort()` yourself when you want to provide a custom message or stop execution for a non-prompt reason.

```javascript
module.exports = async (params) => {
    const { quickAddApi, abort } = params;
    
    let name;
    try {
        name = await quickAddApi.inputPrompt("Your name:");
    } catch (error) {
        if (error?.name === "MacroAbortError") {
            abort("Name is required");
            return;
        }
        throw error;
    }
    
    console.log(`Processing: ${name}`);
};
```

### Catch unexpected errors {#script-error-handling}

Always include proper error handling for unexpected errors:

```javascript
async function start(params, settings) {
    try {
        // Your code here
        const result = await riskyOperation();
        
        if (!result) {
            new Notice("Operation failed", 5000);
            throw new Error("Failed to complete operation");
        }
        
    } catch (error) {
        console.error("Script error:", error);
        new Notice(`Error: ${error.message}`, 5000);
        throw error;  // Re-throw to stop macro execution
    }
}
```

**Error behavior:**
- Unhandled errors in scripts automatically stop the macro
- Original error stack traces are preserved for debugging
- Errors are logged to the console for troubleshooting

## Best practices {#best-practices}

1. **Validate Settings**: Always check that required settings are configured before using them
2. **User Feedback**: Use `new Notice()` to provide feedback to users
3. **Error Messages**: Provide clear, actionable error messages
4. **Default Values**: Always provide sensible default values for options
5. **Documentation**: Add descriptions to all options to help users understand their purpose
6. **Variable Names**: Use clear, descriptive names for variables you set
7. **Async/Await**: Always use async/await for asynchronous operations
8. **Console Logging**: Use `console.log()` for debugging, but remove or minimize in production

## Share code between scripts {#sharing-code-between-scripts}

Need the same helper functions or constants in several scripts? Put them in one
shared `.js` module and `require()` it from each script. User scripts run as
CommonJS modules and receive a `require` function (backed by Obsidian's
Electron/Node `require`), so you can load any module on disk by its **absolute**
path.

:::caution[Desktop only]
`require()` uses Obsidian's Electron/Node runtime, which exists only in the
desktop app. On mobile there is no `require`, so this pattern does not work
there - see [Cross-platform alternatives](#cross-platform-alternatives).
:::

:::caution[require() runs code immediately]
`require()` executes the target file with full Node/Electron access (filesystem,
network, and more) the moment it loads - before any export is called. Only
`require` modules you wrote or trust, exactly as you would any code you run on
your machine.
:::

### Create the shared module {#create-the-shared-module}

Save a normal `.js` file in your vault. (It must be a real `.js` file - `require`
loads from disk and cannot read a script written in a ` ```js ` note code block.)
Export your helpers with `module.exports`:

```javascript
// scripts/shared-utils.js
module.exports = {
    formatNumber: (n) => new Intl.NumberFormat("en-US").format(n),
    CURRENCY: "USD",
};
```

The module must already exist on disk when the requiring script runs.

### Require it from your scripts {#require-it-from-your-scripts}

Build the absolute path **at runtime** from the vault's base path, then `require`
the module. Don't paste a literal absolute path - the vault lives at a different
location on every machine and account, so a hardcoded path breaks the moment the
vault is synced or opened elsewhere. Relative paths don't work either (the script
has no `__dirname`), so always resolve against `getBasePath()`:

```javascript
// scripts/my-macro-script.js
module.exports = async (params) => {
    const { app, obsidian } = params;

    // require() is desktop-only - fail clearly on mobile.
    if (!(app.vault.adapter instanceof obsidian.FileSystemAdapter)) {
        throw new Error("This script shares helpers via require(), which only works in the desktop app.");
    }

    const path = require("path");
    // getBasePath() is the supported method; older scripts may use the
    // equivalent app.vault.adapter.basePath.
    const utils = require(path.join(app.vault.adapter.getBasePath(), "scripts", "shared-utils.js"));

    new obsidian.Notice(`${utils.formatNumber(1234567)} ${utils.CURRENCY}`); // "1,234,567 USD"
};
```

:::note[Reload to pick up edits]
A `require`'d module is cached the first time it loads. After you edit
`shared-utils.js` the change is **not** picked up until you reload - run
**Reload app without saving** from the Command palette. (A regular user script is
re-read on every run, but a module it `require`s is not.)

Advanced: bust the cache from a script without reloading. Use `window.require` -
the `require` your script receives is a thin wrapper and has no `.cache`/`.resolve`:

```javascript
module.exports = async (params) => {
    const { app, obsidian } = params;
    if (!(app.vault.adapter instanceof obsidian.FileSystemAdapter)) return;

    const fullPath = window.require("path").join(app.vault.adapter.getBasePath(), "scripts", "shared-utils.js");
    delete window.require.cache[window.require.resolve(fullPath)];
    const utils = window.require(fullPath); // reflects your latest edits to this file
    // Only refreshes shared-utils.js itself, not other modules it requires.
};
```
:::

### Cross-platform alternatives {#cross-platform-alternatives}

Because `require` is desktop-only, on mobile (or for a portable vault) share code
another way:

- **Inline the helper** in each script, or
- **Chain scripts in a macro** and pass *data* (not functions) through
  `params.variables` between steps.

## Advanced patterns {#advanced-patterns}

### Offer several actions from one script {#multiple-entry-points}

Export an object with multiple functions that users can choose from. The object
can also carry plain values (a default or shared constant) alongside the
functions:

```javascript
module.exports = {
    "Create Note": createNote,
    "Update Note": updateNote,
    "Delete Note": deleteNote
};

async function createNote(params) {
    // Implementation
}

async function updateNote(params) {
    // Implementation
}

async function deleteNote(params) {
    // Implementation
}
```

### Return a value {#returning-values}

Scripts can return values that become available as macro output:

```javascript
async function start(params, settings) {
    const result = await processData();
    
    // Return value becomes available as macro output
    return result;
}
```

### Work with files {#working-with-files}

```javascript
async function start(params, settings) {
    const { app, obsidian } = params;
    
    // Get all markdown files
    const files = app.vault.getMarkdownFiles();
    
    // Get a specific file
    const file = app.vault.getAbstractFileByPath("path/to/file.md");
    if (file instanceof obsidian.TFile) {
        // Read file content
        const content = await app.vault.read(file);
        
        // Get file metadata
        const metadata = app.metadataCache.getFileCache(file);
        const frontmatter = metadata?.frontmatter;
        const links = metadata?.links || [];
        const tags = metadata?.tags || [];
        
        // Process content
        const modified = content.replace(/old/g, "new");
        
        // Save changes
        await app.vault.modify(file, modified);
    }
    
    // Create new file
    const newFile = await app.vault.create(
        "folder/subfolder/new-note.md", 
        "# Title\n\nContent here"
    );
    
    // Rename file
    await app.fileManager.renameFile(
        newFile, 
        "folder/subfolder/renamed-note.md"
    );
    
    // Delete file
    await app.vault.delete(newFile);
    
    // Copy file
    await app.vault.copy(
        file, 
        "path/to/copy.md"
    );
    
    // Get folder
    const folder = app.vault.getAbstractFileByPath("folder/subfolder");
    if (folder instanceof obsidian.TFolder) {
        // List folder contents
        const children = folder.children;
        
        // Create folder if it doesn't exist
        const path = "new/folder/structure";
        if (!app.vault.getAbstractFileByPath(path)) {
            await app.vault.createFolder(path);
        }
    }
}
```

### Work with the active file {#working-with-the-active-file}

```javascript
async function start(params, settings) {
    const { app, obsidian } = params;
    
    // Get active file
    const activeFile = app.workspace.getActiveFile();
    if (!activeFile) {
        new obsidian.Notice("No active file");
        return;
    }
    
    // Get active editor
    const activeView = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (activeView) {
        const editor = activeView.editor;
        
        // Get selected text
        const selection = editor.getSelection();
        
        // Get current line
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        
        // Replace selection
        editor.replaceSelection("New text");
        
        // Insert at cursor
        editor.replaceRange(
            "Inserted text", 
            cursor
        );
        
        // Get entire document
        const fullText = editor.getValue();
        
        // Replace entire document
        editor.setValue("Completely new content");
    }
}
```

### Work with metadata and frontmatter {#working-with-metadata-and-frontmatter}

```javascript
async function start(params, settings) {
    const { app, obsidian } = params;
    
    const file = app.workspace.getActiveFile();
    if (!file) return;
    
    // Get frontmatter
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter || {};
    
    // Update frontmatter
    await app.fileManager.processFrontMatter(file, (fm) => {
        fm.tags = fm.tags || [];
        fm.tags.push("processed");
        fm.date = new Date().toISOString();
        fm.status = "completed";
        delete fm.oldField;  // Remove a field
    });
    
    // Get all files with specific frontmatter
    const filesWithTag = app.vault.getMarkdownFiles().filter(f => {
        const meta = app.metadataCache.getFileCache(f);
        return meta?.frontmatter?.tags?.includes("important");
    });
    
    // Get backlinks
    const backlinks = app.metadataCache.getBacklinksForFile(file);
    
    // Get outgoing links
    const links = cache?.links || [];
    const embeds = cache?.embeds || [];
}
```

### Open and navigate files {#opening-and-navigating-files}

```javascript
async function start(params, settings) {
    const { app, obsidian } = params;
    
    // Open file in active pane
    const file = app.vault.getAbstractFileByPath("path/to/note.md");
    if (file instanceof obsidian.TFile) {
        await app.workspace.getLeaf().openFile(file);
    }
    
    // Open in new pane
    await app.workspace.getLeaf('split').openFile(file);
    
    // Open in new tab
    await app.workspace.getLeaf('tab').openFile(file);
    
    // Open in new window
    await app.workspace.getLeaf('window').openFile(file);
    
    // Navigate to specific heading
    await app.workspace.openLinkText(
        "note#heading", 
        "",  // source path
        true  // new leaf
    );
    
    // Create and open a daily note
    const { createDailyNote } = app.plugins.plugins["daily-notes"].instance;
    const dailyNote = await createDailyNote(moment());
    await app.workspace.getLeaf().openFile(dailyNote);
}
```

## Recipes {#common-patterns--recipes}

### Process every note in a folder {#processing-multiple-notes}

```javascript
async function processAllNotesInFolder(params, settings) {
    const { app, obsidian, quickAddApi } = params;
    
    const folderPath = settings["Folder Path"] || "Notes";
    const folder = app.vault.getAbstractFileByPath(folderPath);
    
    if (!(folder instanceof obsidian.TFolder)) {
        throw new Error(`Folder not found: ${folderPath}`);
    }
    
    let processed = 0;
    const errors = [];
    
    // Process each markdown file in folder
    for (const file of folder.children) {
        if (file instanceof obsidian.TFile && file.extension === "md") {
            try {
                const content = await app.vault.read(file);
                
                // Your processing logic here
                const modified = content + "\n\n---\nProcessed: " + new Date().toISOString();
                
                await app.vault.modify(file, modified);
                processed++;
                
            } catch (error) {
                errors.push(`${file.path}: ${error.message}`);
            }
        }
    }
    
    // Report results
    new obsidian.Notice(`Processed ${processed} files`);
    if (errors.length > 0) {
        await quickAddApi.infoDialog("Errors", errors);
    }
    
    return { processed, errors };
}
```

### Create a note from a template {#creating-notes-from-templates}

```javascript
async function createNoteFromTemplate(params, settings) {
    const { app, quickAddApi, variables } = params;
    
    // Get template
    const templatePath = settings["Template Path"];
    const templateFile = app.vault.getAbstractFileByPath(templatePath);
    
    if (!templateFile) {
        throw new Error(`Template not found: ${templatePath}`);
    }
    
    // Read template content
    const template = await app.vault.read(templateFile);
    
    // Get user input
    const title = await quickAddApi.inputPrompt("Note title:");
    const tags = await quickAddApi.inputPrompt("Tags (comma-separated):");
    
    // Format the template
    const formatted = await quickAddApi.format(template, {
        title: title,
        tags: tags.split(",").map(t => `#${t.trim()}`).join(" "),
        date: new Date().toISOString()
    });
    
    // Create the note
    const fileName = `${title.replace(/[^\w\s]/gi, '')}.md`;
    const filePath = `${settings["Output Folder"]}/${fileName}`;
    
    await app.vault.create(filePath, formatted);
    
    // Open the new note
    const newFile = app.vault.getAbstractFileByPath(filePath);
    await app.workspace.getLeaf().openFile(newFile);
    
    return filePath;
}
```

### Add, remove, or replace a tag in bulk {#bulk-tag-operations}

```javascript
async function bulkTagOperations(params, settings) {
    const { app, quickAddApi, obsidian } = params;
    
    const operation = await quickAddApi.suggester(
        ["Add tag", "Remove tag", "Replace tag"],
        ["add", "remove", "replace"]
    );
    
    const tag = await quickAddApi.inputPrompt("Tag name (without #):");
    let newTag;
    
    if (operation === "replace") {
        newTag = await quickAddApi.inputPrompt("Replace with tag:");
    }
    
    const files = app.vault.getMarkdownFiles();
    let modified = 0;
    
    for (const file of files) {
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.tags = fm.tags || [];
            
            if (operation === "add" && !fm.tags.includes(tag)) {
                fm.tags.push(tag);
                modified++;
            } else if (operation === "remove") {
                const index = fm.tags.indexOf(tag);
                if (index > -1) {
                    fm.tags.splice(index, 1);
                    modified++;
                }
            } else if (operation === "replace") {
                const index = fm.tags.indexOf(tag);
                if (index > -1) {
                    fm.tags[index] = newTag;
                    modified++;
                }
            }
        });
    }
    
    new obsidian.Notice(`Modified ${modified} files`);
    return modified;
}
```

### Search and replace across the vault {#search-and-replace-across-vault}

```javascript
async function searchAndReplace(params, settings) {
    const { app, quickAddApi, obsidian } = params;
    
    const searchTerm = await quickAddApi.inputPrompt("Search for:");
    const replaceTerm = await quickAddApi.inputPrompt("Replace with:");
    
    const confirm = await quickAddApi.yesNoPrompt(
        "Confirm",
        `Replace all occurrences of "${searchTerm}" with "${replaceTerm}"?`
    );
    
    if (!confirm) return;
    
    const files = app.vault.getMarkdownFiles();
    const results = [];
    
    for (const file of files) {
        const content = await app.vault.read(file);
        
        if (content.includes(searchTerm)) {
            const newContent = content.replaceAll(searchTerm, replaceTerm);
            await app.vault.modify(file, newContent);
            
            const count = (content.match(new RegExp(searchTerm, 'g')) || []).length;
            results.push(`${file.path}: ${count} replacements`);
        }
    }
    
    if (results.length > 0) {
        await quickAddApi.infoDialog("Replacements Made", results);
    } else {
        new obsidian.Notice("No matches found");
    }
    
    return results;
}
```

### Enhance the daily note {#daily-note-automation}

```javascript
async function enhanceDailyNote(params, settings) {
    const { app, obsidian } = params;
    
    // Get or create today's daily note
    const { moment } = window;
    const dailyNotes = app.plugins.plugins["daily-notes"];
    
    if (!dailyNotes) {
        throw new Error("Daily Notes plugin not enabled");
    }
    
    const { createDailyNote, getDailyNote } = dailyNotes.instance;
    const date = moment();
    
    let dailyNote = getDailyNote(date, dailyNotes.instance.options);
    if (!dailyNote) {
        dailyNote = await createDailyNote(date);
    }
    
    // Add content to daily note
    const content = await app.vault.read(dailyNote);
    
    // Add weather (example - would need actual API)
    const weather = "☀️ Sunny, 22°C";
    
    // Add tasks from yesterday
    const yesterday = moment().subtract(1, 'day');
    const yesterdayNote = getDailyNote(yesterday, dailyNotes.instance.options);
    
    let unfinishedTasks = "";
    if (yesterdayNote) {
        const yesterdayContent = await app.vault.read(yesterdayNote);
        const taskRegex = /- \[ \] .+/g;
        const tasks = yesterdayContent.match(taskRegex);
        if (tasks) {
            unfinishedTasks = "\n## Carried Over Tasks\n" + tasks.join("\n");
        }
    }
    
    const enhanced = content + `
## Weather
${weather}

${unfinishedTasks}

## Notes
- 

## Gratitude
- 
`;
    
    await app.vault.modify(dailyNote, enhanced);
    await app.workspace.getLeaf().openFile(dailyNote);
    
    return dailyNote.path;
}
```

## Debugging tips {#debugging-tips}

1. **Use Console Logging Strategically**
   ```javascript
   console.log("Script started", { settings, params });
   console.group("Processing files");
   files.forEach(f => console.log(f.path));
   console.groupEnd();
   ```

2. **Developer Console Access**
   - Windows/Linux: `Ctrl + Shift + I`
   - Mac: `Cmd + Option + I`
   - Filter console by typing "QuickAdd" to see only relevant logs

3. **Error Boundaries**
   ```javascript
   try {
       // Risky operation
       await app.vault.modify(file, content);
   } catch (error) {
       console.error("Failed to modify file:", error);
       new Notice(`Error: ${error.message}`);
       // Continue or throw depending on severity
   }
   ```

4. **Performance Monitoring**
   ```javascript
   console.time("Processing files");
   // ... your code
   console.timeEnd("Processing files");
   ```

5. **Debugging State**
   ```javascript
   // Use debugger statement to pause execution
   debugger;  // Execution will pause here if DevTools is open
   
   // Inspect variables at specific points
   console.table(variables);  // Great for objects/arrays
   ```

## Example scripts {#example-scripts}

For complete working examples, see:
- <a href="/scripts/userScriptExample.js" download>Complete Example with All Options</a> - Demonstrates all option types and patterns
- <a href="/scripts/movies.js" download>Movie Script</a> - Fetches movie data from OMDb API
- <a href="/scripts/citationsManager.js" download>Citations Manager</a> - Integrates with Obsidian Citations plugin
- [Book Finder](/docs/Examples/Macro_BookFinder/) - Searches for book information
- [Migrate Dataview Properties](/docs/Examples/Macro_MigrateDataviewProperties/) - Migrates inline dataview properties to YAML frontmatter with configurable settings

## Additional resources {#additional-resources}

### Obsidian API documentation {#obsidian-api-documentation}
- [Official Obsidian API Reference](https://docs.obsidian.md/Reference/TypeScript+API)
- [Plugin Development Guide](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Vault Module](https://docs.obsidian.md/Reference/TypeScript+API/Vault) - File operations
- [MetadataCache](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache) - File metadata and links
- [Workspace](https://docs.obsidian.md/Reference/TypeScript+API/Workspace) - Panes and leaves
- [Editor](https://docs.obsidian.md/Reference/TypeScript+API/Editor) - Text editing operations

### QuickAdd resources {#quickadd-resources}
- [QuickAdd API Reference](/docs/QuickAddAPI/)
- [Format Syntax Guide](/docs/FormatSyntax/)
- [Macro Choice Documentation](/docs/Choices/MacroChoice/)
- [Inline Scripts](/docs/InlineScripts/)

## Troubleshooting {#troubleshooting}

**Script not loading:**
- Check the file path in your macro configuration
- Ensure the script exports a valid module
- Check console for syntax errors

**Settings not appearing:**
- Verify the settings object structure
- Ensure option names are unique
- Restart Obsidian after making changes to the settings structure

**Variables not available in templates:**
- Make sure you're setting them on `params.variables`
- Read them with `{{VALUE:name}}`, not `{{name}}`
- Check that the script completes successfully
- See [Variables and data flow](/docs/VariablesDataFlow/) for how script variables move into later Template and Capture steps

**API methods returning undefined:**
- Ensure you're using `await` with async methods
- Check that QuickAdd plugin is enabled
- Verify you're accessing the API correctly through `params.quickAddApi`
