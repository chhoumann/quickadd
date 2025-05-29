# Complete Workflow Automation

This example demonstrates how to create a comprehensive macro that automates a complete workflow - from project setup to task management.

## What This Macro Does

This macro creates a complete project structure with:
1. Project folder hierarchy
2. Project overview note from template
3. Task tracking in a Kanban board
4. Meeting notes template
5. Resource collection

## Installation

### Step 1: Create the Project Template

Create a file at `Templates/Project Overview.md`:

```markdown
# {{VALUE:projectName}}

## Project Details
- **Client**: {{VALUE:clientName}}
- **Start Date**: {{DATE}}
- **Deadline**: {{VALUE:deadline}}
- **Status**: 🟡 In Progress

## Description
{{VALUE:projectDescription}}

## Team Members
- 

## Milestones
- [ ] Project Kickoff - {{DATE}}
- [ ] Initial Design - 
- [ ] Development Phase - 
- [ ] Testing & QA - 
- [ ] Final Delivery - {{VALUE:deadline}}

## Quick Links
- [[{{VALUE:projectFolder}}/Tasks|Task Board]]
- [[{{VALUE:projectFolder}}/Meetings/Meeting Log|Meeting Log]]
- [[{{VALUE:projectFolder}}/Resources/Resource List|Resources]]

## Notes

```

### Step 2: Create the Task Board Template

Create a file at `Templates/Task Board.md`:

```markdown
# {{VALUE:projectName}} - Tasks

## 📥 Backlog

## 🚧 In Progress

## 👀 Review

## ✅ Done

---
*Last Updated: {{DATE}}*
```

### Step 3: Create the Meeting Template

Create a file at `Templates/Meeting Template.md`:

```markdown
# Meeting: {{VALUE:meetingTitle}}
**Date**: {{DATE}}
**Project**: [[{{VALUE:projectFolder}}/Overview|{{VALUE:projectName}}]]
**Attendees**: {{VALUE:attendees}}

## Agenda
1. 

## Discussion Notes

## Action Items
- [ ] 

## Next Meeting
- Date: 
- Topics: 
```

### Step 4: Create the User Script

Save this as `Scripts/projectSetup.js` in your vault:

```javascript
module.exports = async (params) => {
    const { quickAddApi, app, variables } = params;
    
    try {
        // Get project details
        const projectName = await quickAddApi.inputPrompt("Project Name:");
        if (!projectName) return;
        
        const clientName = await quickAddApi.inputPrompt("Client Name:");
        const deadline = await quickAddApi.inputPrompt("Project Deadline (YYYY-MM-DD):");
        const projectDescription = await quickAddApi.wideInputPrompt("Project Description:");
        
        // Create folder structure
        const projectFolder = `Projects/${projectName.replace(/[\\/:*?"<>|]/g, '-')}`;
        const vault = app.vault;
        
        // Create main folders
        await createFolderIfNotExists(vault, projectFolder);
        await createFolderIfNotExists(vault, `${projectFolder}/Meetings`);
        await createFolderIfNotExists(vault, `${projectFolder}/Resources`);
        await createFolderIfNotExists(vault, `${projectFolder}/Archive`);
        
        // Set variables for templates
        variables.projectName = projectName;
        variables.clientName = clientName;
        variables.deadline = deadline;
        variables.projectDescription = projectDescription;
        variables.projectFolder = projectFolder;
        
        // Create meeting log
        const meetingLogContent = `# Meeting Log - ${projectName}\n\n` +
            `## Meetings\n` +
            `- [[${projectFolder}/Meetings/${window.moment().format('YYYY-MM-DD')} - Kickoff|Project Kickoff]] - ${window.moment().format('YYYY-MM-DD')}\n`;
        
        await vault.create(`${projectFolder}/Meetings/Meeting Log.md`, meetingLogContent);
        
        // Create resource list
        const resourceContent = `# Resources - ${projectName}\n\n` +
            `## Documents\n\n` +
            `## Links\n\n` +
            `## Contacts\n- ${clientName} - Client\n`;
        
        await vault.create(`${projectFolder}/Resources/Resource List.md`, resourceContent);
        
        new Notice(`Project "${projectName}" structure created successfully!`);
        
    } catch (error) {
        console.error("Project setup error:", error);
        new Notice(`Failed to create project: ${error.message}`);
    }
};

async function createFolderIfNotExists(vault, path) {
    if (!await vault.adapter.exists(path)) {
        await vault.createFolder(path);
    }
}
```

### Step 5: Set Up the Macro

1. Open QuickAdd settings
2. Create a new Macro choice called "Complete Project Setup"
3. Click the configure button (⚙️)
4. Add the following commands in order:

   **Command 1: User Script**
   - Type: User Script
   - Script: Select `Scripts/projectSetup.js`

   **Command 2: Template**
   - Type: Nested Choice
   - Create a Template choice called "Project Overview"
   - Template path: `Templates/Project Overview.md`
   - Create in folder: `{{VALUE:projectFolder}}`
   - File name: `Overview`

   **Command 3: Template**
   - Type: Nested Choice
   - Create a Template choice called "Task Board"
   - Template path: `Templates/Task Board.md`
   - Create in folder: `{{VALUE:projectFolder}}`
   - File name: `Tasks`

   **Command 4: Template**
   - Type: Nested Choice
   - Create a Template choice called "Kickoff Meeting"
   - Template path: `Templates/Meeting Template.md`
   - Create in folder: `{{VALUE:projectFolder}}/Meetings`
   - File name: `{{DATE}} - Kickoff`
   - Set variables:
     - meetingTitle: "Project Kickoff"
     - attendees: "Team"

   **Command 5: Obsidian Command**
   - Command: "Open link under cursor"
   - (This opens the project overview after creation)

## Usage

1. Trigger QuickAdd (Ctrl/Cmd + P, then "QuickAdd")
2. Select "Complete Project Setup"
3. Enter the project details when prompted
4. The macro will create the entire project structure and open the overview

## Extending the Macro

You can enhance this macro by adding:

### Automatic Git Repository Creation

Add this command to your script:

```javascript
// After creating folders
if (await quickAddApi.yesNoPrompt("Initialize Git repository?")) {
    const { exec } = require('child_process');
    exec(`cd "${vault.adapter.basePath}/${projectFolder}" && git init`, 
        (error) => {
            if (!error) new Notice("Git repository initialized");
        }
    );
}
```

### Integration with Task Management Plugins

```javascript
// If using Tasks plugin
const taskContent = `- [ ] Set up project repository 📅 ${deadline} ⏫ #project/${projectName}`;
// Append to daily note or task file
```

### Automatic Calendar Events

```javascript
// Create calendar event for deadline
variables.calendarEvent = `Project ${projectName} Deadline`;
// Use with Calendar plugin or other integrations
```

## Tips

1. **Customize Templates**: Modify the templates to match your workflow
2. **Add More Structure**: Include additional folders like "Documentation", "Code", etc.
3. **Use with Hotkeys**: Assign a keyboard shortcut for quick access
4. **Combine with Other Plugins**: Integrate with Kanban, Calendar, or Tasks plugins
5. **Template Variables**: Add more prompts for additional project details

## Troubleshooting

- **Folders not created**: Ensure the script has proper permissions
- **Templates not found**: Check template paths in settings
- **Variables not replaced**: Verify variable names match in script and templates