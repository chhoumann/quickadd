---
title: Migrate Dataview Properties to Frontmatter
---

This script allows you to migrate inline Dataview properties to YAML frontmatter. It's particularly useful when transitioning from Dataview's inline syntax to native Obsidian properties, which offer better performance and broader compatibility.

The script handles comma-separated values with special care for commas inside wikilinks, ensuring that links like `[[Note, with comma]]` are preserved correctly.

## Use Case

If you've been using Dataview's inline property syntax like this:

```markdown
Reference:: [[2025-10-12 - Sun Oct 12]]
Related:: [[Agentic Engineering|Agentic coding]], [[Note, with comma]]
Tags:: #project, #important
```

This script will migrate those properties to frontmatter:

```markdown
---
Reference: "[[2025-10-12 - Sun Oct 12]]"
Related:
  - "[[Agentic Engineering|Agentic coding]]"
  - "[[Note, with comma]]"
tags:
  - "project"
  - "important"
---
```

The inline properties are removed from the body of the note after migration.

**Note:** The `tags` property is automatically normalized to lowercase and `#` symbols are stripped, following Obsidian's frontmatter conventions for reserved property names.

## Installation

1. Save the script (`migrateDataviewToFrontmatter.js`) to your vault. Make sure it is saved as a JavaScript file, meaning that it has the `.js` at the end. **Important:** Do not save scripts in the `.obsidian` directory - they will be ignored. Valid locations include folders like `/scripts/`, `/macros/`, or any custom folder in your vault.
2. Open the Macro Manager by opening the QuickAdd plugin settings and clicking `Manage Macros`.
3. Create a new Macro - you decide what to name it. I named mine `Migrate Dataview Properties`.
4. Add the user script to the macro command list.
5. Click the cog ⚙ icon next to the script to configure its settings (see Configuration below).
6. Go back out to your QuickAdd main menu and add a new Macro choice. I named mine `Migrate Properties`.
7. Attach the Macro to the Macro Choice you just created by clicking the cog ⚙ icon and selecting it.

You can download the script here: <a href="/scripts/migrateDataviewToFrontmatter.js" download>migrateDataviewToFrontmatter.js</a>

## Configuration

The script offers two configuration options:

### Migrate All Properties

**Type:** Toggle (on/off)
**Default:** Off

When enabled, the script will migrate **all** inline properties found in the note, regardless of their names. When disabled, only the properties specified in "Properties to Migrate" will be migrated.

### Properties to Migrate

**Type:** Text input
**Default:** `Reference, Related`

A comma-separated list of property names to migrate (case-insensitive). This setting is ignored if "Migrate All Properties" is enabled.

**Examples:**
- `Reference, Related` - Migrates only Reference and Related properties
- `Author, Title, Date, Tags` - Migrates these four properties
- Leave empty with "Migrate All Properties" off to use the default (Reference, Related)

## Usage

1. Open a note that contains inline Dataview properties
2. Run the macro (via command palette, QuickAdd menu, or hotkey)
3. The script will:
   - Add the properties to the note's frontmatter
   - Remove the inline property lines from the note body
   - Show a notification with the migrated property names

## Key Features

- **Smart Wikilink Parsing**: Preserves commas inside wikilinks (e.g., `[[Note, with comma]]`)
- **Comma-Separated Values**: Automatically handles multiple values separated by commas
- **Single vs Multiple Values**: Stores single values as strings, multiple values as arrays
- **Case-Insensitive Matching**: Property names are matched case-insensitively
- **Selective Migration**: Choose to migrate all properties or only specific ones
- **Reserved Property Handling**: Special handling for Obsidian reserved properties like `tags`
- **Frontmatter Merging**: Merges with existing frontmatter values instead of overwriting (deduplicates)
- **Clean Output**: Removes excessive blank lines after migration

## Examples

### Example 1: Migrate Specific Properties

**Configuration:**
- Migrate All Properties: Off
- Properties to Migrate: `Reference, Related`

**Input:**
```markdown
# My Note

Reference:: [[2025-10-12 - Sun Oct 12]]
Related:: [[Agentic Engineering|Agentic coding]]
Author:: John Doe
Status:: In Progress
```

**Output:**
```markdown
---
Reference: "[[2025-10-12 - Sun Oct 12]]"
Related: "[[Agentic Engineering|Agentic coding]]"
---

# My Note

Author:: John Doe
Status:: In Progress
```

Note: Only Reference and Related were migrated. Author and Status remain as inline properties.

### Example 2: Migrate All Properties

**Configuration:**
- Migrate All Properties: On
- Properties to Migrate: (ignored)

**Input:**
```markdown
# Project Notes

Reference:: [[Main Document]]
Related:: [[Doc A]], [[Doc B]]
Author:: John Doe
Status:: In Progress
Priority:: High
```

**Output:**
```markdown
---
Reference: "[[Main Document]]"
Related:
  - "[[Doc A]]"
  - "[[Doc B]]"
Author: "John Doe"
Status: "In Progress"
Priority: "High"
---

# Project Notes
```

All inline properties are migrated to frontmatter.

### Example 3: Handling Complex Wikilinks

**Input:**
```markdown
Related:: [[Book Title, by Author]], [[Article, from Journal]], [[Simple Note]]
```

**Output:**
```markdown
---
Related:
  - "[[Book Title, by Author]]"
  - "[[Article, from Journal]]"
  - "[[Simple Note]]"
---
```

Commas inside wikilinks are preserved correctly.

### Example 4: Handling Tags Property

**Input:**
```markdown
Tags:: #project, #work, #important
```

**Output:**
```markdown
---
tags:
  - "project"
  - "work"
  - "important"
---
```

The `tags` property is special in Obsidian:
- It's automatically normalized to lowercase (even if you write `Tags::` or `TAGS::`)
- The `#` symbols are stripped from tag values
- This follows Obsidian's frontmatter convention where tags don't use `#`

### Example 5: Merging with Existing Frontmatter

**Input:**
```markdown
---
tags:
  - existing-tag
Reference: "[[Existing Reference]]"
---

# My Note

Tags:: #new-tag, #another-tag
Reference:: [[New Reference]]
Related:: [[Some Link]]
```

**Output:**
```markdown
---
tags:
  - existing-tag
  - new-tag
  - another-tag
Reference:
  - "[[Existing Reference]]"
  - "[[New Reference]]"
Related: "[[Some Link]]"
---

# My Note
```

The script **merges** values instead of overwriting:
- Existing `tags` are preserved and new tags are added
- Existing `Reference` value is kept and the new one is added
- `Related` is added as a new property
- All values are deduplicated

## Obsidian Reserved Properties

Obsidian has special handling for certain property names in frontmatter. The script automatically handles these:

### tags

- **Must be lowercase**: `Tags::` is converted to `tags:` in frontmatter
- **No hash symbols**: `#project` becomes `project`
- **Why**: Obsidian's native tag system expects tags without `#` in frontmatter

**Example:**
```markdown
# Inline format (with #)
Tags:: #project, #important

# Frontmatter format (without #)
---
tags:
  - project
  - important
---
```

Other reserved properties (like `aliases`, `cssclass`) are preserved as-is but may have special behaviors in Obsidian. Always verify the [Obsidian documentation](https://help.obsidian.md/Editing+and+formatting/Properties) for the latest reserved property names.

## Technical Details

### Smart Comma Splitting

The script uses a custom parser that tracks whether it's inside a wikilink when splitting comma-separated values:

```javascript
function parseCommaSeparatedWithWikilinks(value) {
    let insideWikilink = false;

    for (let i = 0; i < value.length; i++) {
        if (char === '[' && nextChar === '[') {
            insideWikilink = true;
        }
        if (char === ']' && prevChar === ']') {
            insideWikilink = false;
        }

        // Only split on commas outside wikilinks
        if (char === ',' && !insideWikilink) {
            // Split here
        }
    }
}
```

### Race Condition Prevention

The script uses `processFrontMatter` to update the frontmatter, then re-reads the file before removing inline properties. This prevents race conditions where the frontmatter changes might be overwritten:

```javascript
// Update frontmatter first
await app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
    // Add properties to frontmatter
});

// Re-read the file to get updated frontmatter
const updatedContent = await app.vault.read(activeFile);

// Then remove inline properties
await app.vault.modify(activeFile, cleanedContent);
```

## Tips

1. **Test on a Copy First**: Try the script on a copy of your note to ensure it works as expected
2. **Use Version Control**: If you use Git, commit your vault before running bulk migrations
3. **Migrate Gradually**: Start with specific properties before using "Migrate All"
4. **Check Frontmatter Format**: After migration, verify that the frontmatter is formatted correctly
5. **Tags Property**: Remember that `tags` must be lowercase in frontmatter and shouldn't have `#` symbols
6. **Combine with Other Macros**: You can add additional steps to the macro, such as opening a specific note or running another script

## Troubleshooting

**Properties not migrating:**
- Check that the property names are spelled correctly in the settings
- Ensure the inline properties use `::` syntax (two colons)
- Verify that the properties aren't inside code blocks or task checkboxes

**Commas not handled correctly:**
- Make sure wikilinks use proper `[[` and `]]` syntax
- Check for unmatched brackets in your wikilinks

**How are existing frontmatter values handled:**
- The script merges with existing frontmatter values instead of overwriting
- If a property already exists in frontmatter, the new values are combined and deduplicated
- Example: If frontmatter has `tags: [project]` and inline has `Tags:: #work`, result will be `tags: [project, work]`

## Related Resources

- [QuickAdd API Reference](../QuickAddAPI.md)
- [User Scripts Documentation](../UserScripts.md)
- [processFrontMatter API](https://docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter)
