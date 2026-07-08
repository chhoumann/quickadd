/**
 * QuickAdd User Script Example
 * This script demonstrates all available option types and common patterns
 */

module.exports = {
    entry: start,
    settings: {
        name: "User Script Example",
        author: "QuickAdd Documentation",
        options: {
            // Text input option - for strings, paths, API keys, etc.
            "Project Name": {
                type: "text",
                defaultValue: "My Project",
                placeholder: "Enter project name",
                description: "The name of your project"
            },
            
            // Secret text input - input is masked
            "API Key": {
                type: "text",
                defaultValue: "",
                placeholder: "sk-...",
                secret: true,
                description: "Your secret API key (will be masked)"
            },
            
            // Toggle option - for boolean settings
            "Create Folder": {
                type: "toggle",
                defaultValue: true,
                description: "Create a folder for the project"
            },
            
            // Checkbox option (alternative to toggle)
            "Add Tags": {
                type: "checkbox",
                defaultValue: false,
                description: "Add tags to the created note"
            },
            
            // Dropdown option - for selecting from predefined choices
            "Template Type": {
                type: "dropdown",
                defaultValue: "basic",
                options: ["basic", "advanced", "custom"],
                description: "Choose the template type"
            },
            
            // Select option (alternative to dropdown)
            "Priority": {
                type: "select",
                defaultValue: "medium",
                options: ["low", "medium", "high", "urgent"],
                description: "Set the priority level"
            },
            
            // Format option - supports QuickAdd format syntax
            "File Name Pattern": {
                type: "format",
                defaultValue: "{{DATE:YYYY-MM-DD}} - {{VALUE:projectName}}",
                placeholder: "File naming template",
                description: "Template for generating file names (supports QuickAdd format syntax)"
            },
            
            // Another format example
            "Note Template": {
                type: "format",
                defaultValue: "# {{VALUE:projectName}}\n\nCreated: {{DATE}}\nPriority: {{VALUE:priority}}",
                placeholder: "Note content template",
                description: "Template for the note content"
            },
            
            // Numeric value stored as text
            "Max Items": {
                type: "text",
                defaultValue: "10",
                placeholder: "Number",
                description: "Maximum number of items to process"
            },
            
            // URL or path
            "Repository URL": {
                type: "text",
                defaultValue: "",
                placeholder: "https://github.com/...",
                description: "Git repository URL"
            }
        }
    }
};

async function start(params, settings) {
    const { quickAddApi, app, variables, obsidian } = params;
    
    // ====================
    // Accessing Settings
    // ====================
    
    const projectName = settings["Project Name"];
    const apiKey = settings["API Key"];
    const createFolder = settings["Create Folder"];
    const addTags = settings["Add Tags"];
    const templateType = settings["Template Type"];
    const priority = settings["Priority"];
    const fileNamePattern = settings["File Name Pattern"];
    const noteTemplate = settings["Note Template"];
    const maxItems = parseInt(settings["Max Items"]);
    const repoUrl = settings["Repository URL"];
    
    console.log("Script started with settings:", {
        projectName,
        createFolder,
        addTags,
        templateType,
        priority,
        maxItems,
        repoUrl
    });
    
    // ====================
    // Input Validation
    // ====================
    
    if (!projectName) {
        new obsidian.Notice("Please configure a project name in the script settings");
        throw new Error("Project name is required");
    }
    
    if (maxItems < 1 || maxItems > 100) {
        new obsidian.Notice("Max items must be between 1 and 100");
        throw new Error("Invalid max items value");
    }
    
    // ====================
    // User Interaction Examples
    // ====================
    
    // Get additional input from user
    const description = await quickAddApi.inputPrompt(
        "Project Description",
        "Enter a brief description",
        "A new QuickAdd project"
    );
    
    if (!description) {
        new obsidian.Notice("No description provided, using default");
    }
    
    // Confirm action with user
    const confirmed = await quickAddApi.yesNoPrompt(
        "Create Project?",
        `This will create a new project: ${projectName}`
    );
    
    if (!confirmed) {
        new obsidian.Notice("Project creation cancelled");
        return;
    }
    
    // Let user select from options
    const categories = ["Development", "Research", "Personal", "Work"];
    const category = await quickAddApi.suggester(
        categories,
        categories,
        "Select a category"
    );
    
    // Multi-select with checkboxes
    const features = await quickAddApi.checkboxPrompt(
        ["README", "Tasks", "Notes", "Resources"],
        ["README", "Tasks"]  // Pre-selected
    );
    
    // ====================
    // Setting Variables
    // ====================
    
    // These variables can be used in templates
    variables.projectName = projectName;
    variables.description = description || "No description";
    variables.priority = priority;
    variables.category = category || "Uncategorized";
    variables.features = features.join(", ");
    variables.timestamp = new Date().toISOString();
    variables.templateType = templateType;
    
    // ====================
    // Format Templates
    // ====================
    
    // Format the file name using the pattern from settings
    const fileName = await quickAddApi.format(fileNamePattern, {
        projectName: projectName
    });
    
    // Format the note content
    const noteContent = await quickAddApi.format(noteTemplate, {
        projectName: projectName,
        priority: priority
    });
    
    // ====================
    // Working with Files
    // ====================
    
    try {
        // Create folder if enabled
        if (createFolder) {
            const folderPath = `Projects/${projectName}`;
            
            // Check if folder exists
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (!folder) {
                await app.vault.createFolder(folderPath);
                new obsidian.Notice(`Created folder: ${folderPath}`);
            }
            
            // Create the note in the folder
            const notePath = `${folderPath}/${fileName}.md`;
            
            // Add tags if enabled
            let finalContent = noteContent;
            if (addTags) {
                const tags = `\n\n#project #${priority} #${category.toLowerCase()}`;
                finalContent += tags;
            }
            
            // Create the file
            await app.vault.create(notePath, finalContent);
            
            // Open the file
            const file = app.vault.getAbstractFileByPath(notePath);
            if (file) {
                await app.workspace.getLeaf().openFile(file);
            }
            
            new obsidian.Notice(`Project "${projectName}" created successfully!`);
            
            // Set success variable
            variables.success = true;
            variables.filePath = notePath;
            
        } else {
            // Just create the note without a folder
            const notePath = `${fileName}.md`;
            await app.vault.create(notePath, noteContent);
            
            variables.success = true;
            variables.filePath = notePath;
        }
        
        // ====================
        // Show Summary
        // ====================
        
        await quickAddApi.infoDialog(
            "Project Created",
            [
                `Name: ${projectName}`,
                `Type: ${templateType}`,
                `Priority: ${priority}`,
                `Category: ${category}`,
                `Features: ${features.join(", ")}`,
                `Path: ${variables.filePath}`
            ]
        );
        
    } catch (error) {
        console.error("Error creating project:", error);
        new obsidian.Notice(`Error: ${error.message}`, 5000);
        variables.success = false;
        throw error;
    }
    
    // ====================
    // Return Value
    // ====================
    
    // The return value can be accessed as macro output
    return {
        projectName,
        filePath: variables.filePath,
        success: variables.success,
        metadata: {
            category,
            priority,
            features,
            created: variables.timestamp
        }
    };
}

/**
 * Alternative: Export multiple functions
 * Users can choose which function to run
 */
/*
module.exports = {
    "Create Project": createProject,
    "Update Project": updateProject,
    "Archive Project": archiveProject
};

async function createProject(params) {
    // Implementation
}

async function updateProject(params) {
    // Implementation
}

async function archiveProject(params) {
    // Implementation
}
*/

/**
 * Alternative: Simple function export
 * No settings/options UI
 */
/*
module.exports = async (params) => {
    const { quickAddApi, app, variables } = params;
    
    // Simple implementation without settings
    const name = await quickAddApi.inputPrompt("Project name:");
    variables.projectName = name;
    
    return `Project ${name} initialized`;
};
*/