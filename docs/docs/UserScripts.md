# User Scripts

User scripts are JavaScript files that extend QuickAdd's functionality with custom code. They can be used within macros to perform complex operations, integrate with external APIs, and automate sophisticated workflows.

> 📚 **Obsidian API Reference**: This guide references the [Obsidian API](https://docs.obsidian.md/Home). Familiarize yourself with the [App](https://docs.obsidian.md/Reference/TypeScript+API/App), [Vault](https://docs.obsidian.md/Reference/TypeScript+API/Vault), and [Workspace](https://docs.obsidian.md/Reference/TypeScript+API/Workspace) modules for advanced scripting.

## Basic Structure

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

## Script Parameters

The script receives two parameters:

### `params` Object
Contains the QuickAdd API and Obsidian context:

```javascript
{
    app: App,                  // Obsidian app instance - see https://docs.obsidian.md/Reference/TypeScript+API/App
    quickAddApi: QuickAddApi,   // QuickAdd API methods (documented below)
    variables: {},              // Variables object for sharing data between scripts and templates
    obsidian: obsidian          // Obsidian module with all classes and utilities
}
```

The `app` object provides access to the entire Obsidian API, including:
- `app.vault` - File and folder operations ([Vault API](https://docs.obsidian.md/Reference/TypeScript+API/Vault))
- `app.workspace` - Window and pane management ([Workspace API](https://docs.obsidian.md/Reference/TypeScript+API/Workspace))
- `app.metadataCache` - File metadata and links ([MetadataCache API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache))
- `app.fileManager` - File operations and renaming ([FileManager API](https://docs.obsidian.md/Reference/TypeScript+API/FileManager))

### `settings` Object
Contains the user-configured values for your script's options (only available when using the settings structure).

## Configurable Options

User scripts can define configurable options that users can set through the QuickAdd UI. This makes your scripts more flexible and reusable.

### Option Types

#### Text Input
For string values, API keys, paths, etc.

```javascript
options: {
    "API Key": {
        type: "text",              // or "input"
        defaultValue: "",
        placeholder: "Enter API key",
        secret: true,              // Optional: masks input for sensitive data
        description: "Your API key" // Optional: help text
    }
}
```

#### Toggle/Checkbox
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

#### Dropdown/Select
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

#### Format Input
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

## Complete Example

Here's a comprehensive example showing all option types:

```javascript
module.exports = {
    entry: start,
    settings: {
        name: "Advanced Script",
        author: "Your Name",
        options: {
            "API Key": {
                type: "text",
                defaultValue: "",
                placeholder: "sk-...",
                secret: true,
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

## Using the QuickAdd API

User scripts have full access to the [QuickAdd API](../QuickAddAPI.md) through `params.quickAddApi`. For complete API documentation, see the [QuickAdd API Reference](../QuickAddAPI.md).

### User Input
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

### Variables
Set variables that can be used in subsequent template operations:

```javascript
// Set variables
params.variables.myVariable = "value";
params.variables.timestamp = new Date().toISOString();
params.variables.results = arrayOfResults;

// Variables are accessible in templates as {{VALUE:myVariable}}
```

### Formatting
Format strings with QuickAdd syntax:

```javascript
const formatted = await quickAddApi.format(
    "Today is {{DATE}} and the title is {{VALUE:title}}",
    { title: "My Document" }
);
```

### Execute Other Choices
Trigger other QuickAdd choices programmatically:

```javascript
await quickAddApi.executeChoice("My Other Choice", {
    customVariable: "value"
});
```

## Error Handling

Always include proper error handling in your scripts:

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

## Best Practices

1. **Validate Settings**: Always check that required settings are configured before using them
2. **User Feedback**: Use `new Notice()` to provide feedback to users
3. **Error Messages**: Provide clear, actionable error messages
4. **Default Values**: Always provide sensible default values for options
5. **Documentation**: Add descriptions to all options to help users understand their purpose
6. **Variable Names**: Use clear, descriptive names for variables you set
7. **Async/Await**: Always use async/await for asynchronous operations
8. **Console Logging**: Use `console.log()` for debugging, but remove or minimize in production

## Advanced Patterns

### Multiple Entry Points

Export an object with multiple functions that users can choose from:

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

### Returning Values

Scripts can return values that become available as macro output:

```javascript
async function start(params, settings) {
    const result = await processData();
    
    // Return value becomes available as macro output
    return result;
}
```

### Working with Files

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

### Working with the Active File

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

### Working with Metadata and Frontmatter

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

### Opening and Navigating Files

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

## Common Patterns & Recipes

### Processing Multiple Notes

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

### Creating Notes from Templates

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

### Bulk Tag Operations

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

### Search and Replace Across Vault

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

### Daily Note Automation

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

## Debugging Tips

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

## Example Scripts

For complete working examples, see:
- [Complete Example with All Options](./Examples/Attachments/userScriptExample.js) - Demonstrates all option types and patterns
- [Movie Script](./Examples/Attachments/movies.js) - Fetches movie data from OMDb API
- [Citations Manager](./Examples/Attachments/citationsManager.js) - Integrates with Obsidian Citations plugin
- [Book Finder](./Examples/Macro_BookFinder.md) - Searches for book information

## Additional Resources

### Obsidian API Documentation
- [Official Obsidian API Reference](https://docs.obsidian.md/Reference/TypeScript+API)
- [Plugin Development Guide](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Vault Module](https://docs.obsidian.md/Reference/TypeScript+API/Vault) - File operations
- [MetadataCache](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache) - File metadata and links
- [Workspace](https://docs.obsidian.md/Reference/TypeScript+API/Workspace) - Panes and leaves
- [Editor](https://docs.obsidian.md/Reference/TypeScript+API/Editor) - Text editing operations

### QuickAdd Resources
- [QuickAdd API Reference](../QuickAddAPI.md)
- [Format Syntax Guide](../FormatSyntax.md)
- [Macro Choice Documentation](../Choices/MacroChoice.md)
- [Inline Scripts](../InlineScripts.md)

## Troubleshooting

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
- Variable names are case-sensitive
- Check that the script completes successfully

**API methods returning undefined:**
- Ensure you're using `await` with async methods
- Check that QuickAdd plugin is enabled
- Verify you're accessing the API correctly through `params.quickAddApi`