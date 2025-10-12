/**
 * Migrate Dataview Inline Properties to Frontmatter
 *
 * This script migrates inline dataview properties (e.g., "Reference:: [[link]]")
 * to YAML frontmatter. It handles comma-separated values with special care for
 * commas inside wikilinks.
 *
 * BEFORE:
 *   Reference:: [[2025-10-12 - Sun Oct 12]]
 *   Related:: [[Agentic Engineering|Agentic coding]], [[Note, with comma]]
 *   Tags:: #project, #important
 *
 * AFTER:
 *   ---
 *   Reference: "[[2025-10-12 - Sun Oct 12]]"
 *   Related:
 *     - "[[Agentic Engineering|Agentic coding]]"
 *     - "[[Note, with comma]]"
 *   tags:
 *     - "project"
 *     - "important"
 *   ---
 *
 * Special handling for Obsidian reserved properties:
 * - "tags" is normalized to lowercase (Tags -> tags)
 * - "#" symbols are stripped from tag values (#project -> project)
 *
 * Configure which properties to migrate in the script settings.
 *
 * Usage:
 * 1. Add this script to a QuickAdd macro as a User Script
 * 2. Configure the script settings to specify which properties to migrate
 * 3. Open a note with inline Dataview properties
 * 4. Run the macro to migrate properties to frontmatter
 */

module.exports = {
    entry: start,
    settings: {
        name: "Migrate Dataview Properties to Frontmatter",
        author: "QuickAdd",
        options: {
            "Migrate All Properties": {
                type: "toggle",
                defaultValue: false,
                description: "Migrate all inline properties (ignores the property list below)"
            },
            "Properties to Migrate": {
                type: "text",
                defaultValue: "Reference, Related",
                placeholder: "Property1, Property2, Property3",
                description: "Comma-separated list of property names to migrate (case-insensitive). Leave empty with toggle off to use defaults."
            }
        }
    }
};

async function start(params, settings) {
    const { app, obsidian } = params;

    // Determine which properties to migrate
    let propertiesToMigrate = [];
    const migrateAll = settings["Migrate All Properties"];

    if (!migrateAll) {
        const propertiesInput = settings["Properties to Migrate"];
        if (propertiesInput && propertiesInput.trim()) {
            // Parse comma-separated property names
            propertiesToMigrate = propertiesInput
                .split(',')
                .map(p => p.trim().toLowerCase())
                .filter(p => p.length > 0);
        } else {
            // Default to Reference and Related if nothing specified
            propertiesToMigrate = ['reference', 'related'];
        }
    }

    // Get the active file
    const activeFile = app.workspace.getActiveFile();
    if (!activeFile) {
        new obsidian.Notice("No active file. Please open a file first.");
        return;
    }

    try {
        // Read the file content
        const content = await app.vault.read(activeFile);

        // Parse inline fields
        const { fields, cleanedContent } = parseInlineFieldsWithWikilinks(content, propertiesToMigrate, migrateAll);

        if (fields.size === 0) {
            const message = migrateAll
                ? "No inline dataview properties found in this file."
                : `No ${propertiesToMigrate.join(', ')} properties found in this file.`;
            new obsidian.Notice(message);
            return;
        }

        // Update frontmatter AND content in a single operation
        // This prevents race conditions from processFrontMatter + vault.modify
        await app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
            fields.forEach((values, fieldName) => {
                // Convert Set to array
                let valuesArray = Array.from(values);

                // Handle special property names (Obsidian reserved fields)
                // "tags" must be lowercase and tag values should not have "#" prefix
                const normalizedFieldName = fieldName.toLowerCase() === 'tags' ? 'tags' : fieldName;

                if (normalizedFieldName === 'tags') {
                    // Strip "#" from tag values
                    valuesArray = valuesArray.map(tag => {
                        // Remove leading "#" if present
                        return tag.startsWith('#') ? tag.substring(1) : tag;
                    });
                }

                // Merge with existing frontmatter values instead of overwriting
                const existingValue = frontmatter[normalizedFieldName];

                if (existingValue !== undefined && existingValue !== null) {
                    // Property already exists - merge the values
                    const existingArray = Array.isArray(existingValue)
                        ? existingValue
                        : [existingValue];

                    // Combine existing and new values, then deduplicate
                    const combined = [...existingArray, ...valuesArray];
                    const deduplicated = [...new Set(combined.map(v => String(v)))];

                    // Store as string or array depending on count
                    frontmatter[normalizedFieldName] = deduplicated.length === 1
                        ? deduplicated[0]
                        : deduplicated;
                } else {
                    // Property doesn't exist - add it
                    if (valuesArray.length === 1) {
                        frontmatter[normalizedFieldName] = valuesArray[0];
                    } else if (valuesArray.length > 1) {
                        frontmatter[normalizedFieldName] = valuesArray;
                    }
                }
            });
        });

        // Now update the content to remove inline properties
        // We need to read the file again because processFrontMatter already saved it
        const updatedContent = await app.vault.read(activeFile);
        const { cleanedContent: finalContent } = parseInlineFieldsWithWikilinks(updatedContent, propertiesToMigrate, migrateAll);
        await app.vault.modify(activeFile, finalContent);

        // Show success message
        const fieldNames = Array.from(fields.keys()).join(", ");
        new obsidian.Notice(
            `Migrated ${fields.size} property/properties to frontmatter: ${fieldNames}`,
            5000
        );

    } catch (error) {
        console.error("Error migrating dataview properties:", error);
        new obsidian.Notice(`Error: ${error.message}`, 5000);
        throw error;
    }
}

/**
 * Parse inline fields with special handling for wikilinks in comma-separated values
 * @param {string} content - The file content
 * @param {string[]} allowedProperties - Array of property names to migrate (case-insensitive)
 * @param {boolean} migrateAll - If true, migrate all properties regardless of allowedProperties
 * @returns {{fields: Map<string, Set<string>>, cleanedContent: string}}
 */
function parseInlineFieldsWithWikilinks(content, allowedProperties = [], migrateAll = false) {
    const fields = new Map();
    const allowedPropertiesLower = allowedProperties.map(p => p.toLowerCase());

    // Split content into frontmatter and body
    const { frontmatterEnd, hasExistingFrontmatter, frontmatterText } = findFrontmatterEnd(content);
    const bodyContent = hasExistingFrontmatter ? content.slice(frontmatterEnd) : content;

    // Process each line in the body
    const bodyLines = bodyContent.split('\n');
    const cleanedBodyLines = [];

    for (let i = 0; i < bodyLines.length; i++) {
        const line = bodyLines[i];
        const trimmedLine = line.trim();

        // Check if this line is an inline field
        let isPropertyToRemove = false;

        if (trimmedLine && trimmedLine.includes('::')) {
            // Skip task checkboxes
            if (!/^[-*+]\s+\[[xX ]\]/.test(trimmedLine)) {
                // Try to match inline field
                const fieldMatch = trimmedLine.match(/^([^:]+?)::\s*(.+?)$/);

                if (fieldMatch) {
                    const fieldName = fieldMatch[1].trim();
                    const fieldValue = fieldMatch[2].trim();

                    // Check if this is a property we should migrate
                    if (fieldValue) {
                        const fieldNameLower = fieldName.toLowerCase();
                        const shouldMigrate = migrateAll ||
                            (allowedPropertiesLower.length > 0 && allowedPropertiesLower.includes(fieldNameLower));

                        if (shouldMigrate) {
                            // This line should be removed
                            isPropertyToRemove = true;

                            // Store the field value for frontmatter
                            if (!fields.has(fieldName)) {
                                fields.set(fieldName, new Set());
                            }

                            // Parse the value with special handling for wikilinks
                            const parsedValues = parseCommaSeparatedWithWikilinks(fieldValue);
                            parsedValues.forEach(value => fields.get(fieldName).add(value));
                        }
                    }
                }
            }
        }

        // Keep the line if it's not a property to remove
        if (!isPropertyToRemove) {
            cleanedBodyLines.push(line);
        }
    }

    // Reconstruct the content
    let cleanedContent;
    if (hasExistingFrontmatter) {
        cleanedContent = frontmatterText + cleanedBodyLines.join('\n');
    } else {
        cleanedContent = cleanedBodyLines.join('\n');
    }

    // Remove excessive blank lines (more than 2 consecutive)
    cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');

    return { fields, cleanedContent };
}

/**
 * Find the end position of frontmatter
 * @param {string} content - The file content
 * @returns {{frontmatterEnd: number, hasExistingFrontmatter: boolean, frontmatterText: string}}
 */
function findFrontmatterEnd(content) {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
    const match = content.match(frontmatterRegex);

    if (match) {
        return {
            frontmatterEnd: match[0].length,
            hasExistingFrontmatter: true,
            frontmatterText: match[0]
        };
    }

    return {
        frontmatterEnd: 0,
        hasExistingFrontmatter: false,
        frontmatterText: ''
    };
}

/**
 * Parse comma-separated values with special handling for wikilinks
 * Ensures commas inside [[wikilinks]] are not treated as separators
 * @param {string} value - The field value to parse
 * @returns {string[]} Array of parsed values
 */
function parseCommaSeparatedWithWikilinks(value) {
    // If no commas, return as single value
    if (!value.includes(',')) {
        return [value.trim()];
    }

    const values = [];
    let currentValue = '';
    let insideWikilink = false;

    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        const nextChar = value[i + 1];

        // Check for wikilink opening [[
        if (char === '[' && nextChar === '[') {
            insideWikilink = true;
            currentValue += char;
            continue;
        }

        // Check for wikilink closing ]]
        if (char === ']' && nextChar === ']') {
            insideWikilink = false;
            currentValue += char;
            continue;
        }

        // If we hit a comma outside wikilinks, split
        if (char === ',' && !insideWikilink) {
            const trimmed = currentValue.trim();
            if (trimmed) {
                values.push(trimmed);
            }
            currentValue = '';
            continue;
        }

        currentValue += char;
    }

    // Add the last value
    const trimmed = currentValue.trim();
    if (trimmed) {
        values.push(trimmed);
    }

    return values.length > 0 ? values : [value.trim()];
}
