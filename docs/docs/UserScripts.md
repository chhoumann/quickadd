# User Scripts

User scripts are JavaScript files that extend QuickAdd's functionality with custom code. They can be used within macros to perform complex operations, integrate with external APIs, and automate sophisticated workflows.

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
    app: App,                  // Obsidian app instance
    quickAddApi: QuickAddApi,   // QuickAdd API methods
    variables: {},              // Variables object for sharing data
    obsidian: obsidian          // Obsidian module
}
```

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

User scripts have full access to the QuickAdd API through `params.quickAddApi`:

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
    const { app } = params;
    
    // Get all markdown files
    const files = app.vault.getMarkdownFiles();
    
    // Read file content
    const file = app.vault.getAbstractFileByPath("path/to/file.md");
    if (file) {
        const content = await app.vault.read(file);
        // Process content
    }
    
    // Create new file
    await app.vault.create("path/to/new.md", "File content");
    
    // Modify file
    await app.vault.modify(file, "New content");
}
```

## Debugging Tips

1. Use `console.log()` liberally during development
2. Open the Developer Console (Ctrl/Cmd + Shift + I) to see output
3. Test with simple inputs before adding complexity
4. Use `debugger;` statements to pause execution in the Developer Tools
5. Wrap risky operations in try-catch blocks

## Example Scripts

For complete working examples, see:
- [Movie Script](./Examples/Attachments/movies.js) - Fetches movie data from OMDb API
- [Citations Manager](./Examples/Attachments/citationsManager.js) - Integrates with Obsidian Citations plugin
- [Book Finder](./Examples/Macro_BookFinder.md) - Searches for book information

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