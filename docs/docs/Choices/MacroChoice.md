---
title: Macros
---

# Macros

Macros are the most powerful feature in QuickAdd, allowing you to chain together multiple operations into automated workflows. Think of macros as custom scripts that can execute any sequence of Obsidian commands, user scripts, AI commands, and more.

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

![Macro Choice Settings](https://user-images.githubusercontent.com/29108628/121774145-22ccd100-cb81-11eb-8873-7533755bdf32.png)

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
   - Supports all QuickAdd formatting syntax ({{DATE}}, {{VALUE}}, etc.)
   - Configurable tab and split options
   - Opens files in default view mode with focus
   - Only opens existing files (no auto-creation)

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

## User Scripts

User scripts are JavaScript files that extend macro functionality. They have access to:
- The Obsidian app object
- The QuickAdd API
- A variables object for passing data between commands

:::warning Script Placement Requirements

User scripts (.js files) must be placed in your Obsidian vault, but **NOT** in the `.obsidian` directory.

✅ **Valid locations:**
- `/scripts/myScript.js`
- `/macros/utilities/helper.js`
- `/my-custom-folder/script.js`
- Any folder in your vault except `.obsidian`

❌ **Invalid locations:**
- `/.obsidian/plugins/quickadd/scripts/myScript.js`
- `/.obsidian/scripts/myScript.js`
- Any path within the `.obsidian` directory

Scripts placed in the `.obsidian` directory are intentionally ignored and will not appear in the script selection dialog.

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

Variables allow you to pass data between commands in a macro:

### Setting Variables in Scripts

```javascript
// Script 1: Set a variable
module.exports = async (params) => {
    const { quickAddApi, variables } = params;
    
    const bookName = await quickAddApi.inputPrompt("Book name:");
    variables.bookTitle = bookName;
    variables.readDate = new Date().toISOString();
};
```

### Using Variables in Format Syntax

After setting variables in a script, you can use them in subsequent commands:
- In templates: `{{VALUE:bookTitle}}`
- In file names: `Books/{{VALUE:bookTitle}} - Notes`
- In captures: `Read "{{VALUE:bookTitle}}" on {{VALUE:readDate}}`

### Accessing Variables in Later Scripts

```javascript
// Script 2: Use previously set variables
module.exports = async (params) => {
    const { variables, app } = params;
    
    console.log(`Processing book: ${variables.bookTitle}`);
    // Do something with the book title
};
```

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

## Macro Settings

![Macro Manager](https://user-images.githubusercontent.com/29108628/121774198-81924a80-cb81-11eb-9f80-9816263e4b6f.png)

### Run on Plugin Load
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
- Ensure you're using the correct syntax: `{{VALUE:variableName}}`
- Variables must be set before they're used
- Check that variable names match exactly (case-sensitive)

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