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
                const isTags = fieldName.toLowerCase() === 'tags';
                const normalizedFieldName = isTags ? 'tags' : fieldName;

                if (isTags) {
                    // Strip "#" from tag values
                    valuesArray = valuesArray.map(tag => {
                        // Remove leading "#" if present
                        return tag.startsWith('#') ? tag.substring(1) : tag;
                    });
                }

                // Frontmatter property names behave case-insensitively in Obsidian,
                // so collect EVERY key that matches case-insensitively. A hand-edited
                // or synced note (or a note migrated by an older version of this
                // script) can hold more than one case variant - e.g. both "Reference"
                // and "reference", or both "Tags" and "tags" - and we must merge them
                // all into one key rather than stranding (or dropping) a variant.
                const matchingKeys = Object.keys(frontmatter).filter(
                    key => key.toLowerCase() === normalizedFieldName.toLowerCase()
                );

                // The reserved "tags" property must be stored lowercase, so always
                // target "tags"; other properties reuse the first existing key's case
                // (or the field name).
                const targetKey = isTags ? 'tags' : (matchingKeys[0] ?? normalizedFieldName);

                // Gather the existing values from every case variant, then drop the
                // non-target keys so no duplicate survives.
                const existingValues = [];
                for (const key of matchingKeys) {
                    const value = frontmatter[key];
                    if (value !== undefined && value !== null) {
                        if (Array.isArray(value)) existingValues.push(...value);
                        else existingValues.push(value);
                    }
                    if (key !== targetKey) delete frontmatter[key];
                }

                if (existingValues.length > 0) {
                    // Combine, then deduplicate by string form WITHOUT coercing the
                    // stored values - keep the original typed values (numbers,
                    // booleans) so an existing "rating: 5" stays a number.
                    const combined = [...existingValues, ...valuesArray];
                    const seen = new Set();
                    const deduplicated = [];
                    for (const value of combined) {
                        const key = String(value);
                        if (!seen.has(key)) {
                            seen.add(key);
                            deduplicated.push(value);
                        }
                    }

                    // Store as string or array depending on count
                    frontmatter[targetKey] = deduplicated.length === 1
                        ? deduplicated[0]
                        : deduplicated;
                } else {
                    // Property doesn't exist - add it
                    if (valuesArray.length === 1) {
                        frontmatter[targetKey] = valuesArray[0];
                    } else if (valuesArray.length > 1) {
                        frontmatter[targetKey] = valuesArray;
                    }
                }
            });
        });

        // Now strip the migrated inline properties from the body. Use vault.process
        // so the read + rewrite is a single atomic operation (processFrontMatter
        // already persisted the frontmatter; a separate read-then-modify could
        // clobber a concurrent edit or sync that landed in between).
        await app.vault.process(activeFile, (data) => {
            const { cleanedContent } = parseInlineFieldsWithWikilinks(data, propertiesToMigrate, migrateAll);
            return cleanedContent;
        });

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

    // Split content into frontmatter and body. Frontmatter is preserved verbatim
    // and is never scanned for fields or collapsed.
    const { frontmatterEnd, hasExistingFrontmatter, frontmatterText } = findFrontmatterEnd(content);
    const bodyContent = hasExistingFrontmatter ? content.slice(frontmatterEnd) : content;

    // Process each line in the body.
    const bodyLines = bodyContent.split('\n');
    const cleanedBodyLines = [];
    // Parallel to cleanedBodyLines: a "protected" line (a fence delimiter or any
    // line inside a fenced code block) is kept verbatim and never collapsed.
    const protectedFlags = [];

    // Track the currently open fenced code block, if any. fenceDepth is the
    // blockquote nesting level the fence opened at (0 = top level), so a fence
    // inside "> ..." is closed by a closer at the same quote depth. fenceListIndent
    // is the list-item content indent the fence opened at (0 = not in a list), so a
    // fence opened by "- ```" has its body and closing fence tracked at that indent.
    let fenceChar = null; // '`' or '~'
    let fenceLen = 0;
    let fenceDepth = 0;
    let fenceListIndent = 0;

    for (let i = 0; i < bodyLines.length; i++) {
        const line = bodyLines[i];

        if (fenceChar !== null) {
            // Inside a fenced code block. Strip exactly the fence's blockquote
            // container; if this line carries fewer markers, the blockquote (and
            // therefore the fenced block) has ended - reprocess the line below as
            // non-fence so a real field after the block still migrates.
            const { depth, content } = stripBlockquote(line, fenceDepth);
            if (depth >= fenceDepth) {
                // If the fence opened inside a list item, its body and closing fence
                // sit at the list's content indent - strip that before matching the
                // closer. For a non-list fence fenceListIndent is 0, so this is a
                // no-op and behaviour is identical to a plain top-level fence.
                const { rest, indent } = stripLeadingSpaces(content, fenceListIndent);
                if (fenceListIndent > 0 && indent < fenceListIndent && rest.trim() !== '') {
                    // A non-blank line indented LESS than the list content has left
                    // the list item, so per CommonMark the (unclosed) fence ends
                    // here. Exit and fall through to reprocess the line - it may be a
                    // real field or a NEW top-level fence (e.g. a bare ``` that would
                    // otherwise be mistaken for this fence's closer). Blank lines stay
                    // in the block.
                    fenceChar = null;
                    fenceLen = 0;
                    fenceDepth = 0;
                    fenceListIndent = 0;
                } else {
                    // Still inside the block: preserve verbatim, never migrate. Only a
                    // matching closing fence (same marker, long enough, no info string)
                    // at the same quote + list depth ends it.
                    if (isClosingFence(rest, fenceChar, fenceLen)) {
                        fenceChar = null;
                        fenceLen = 0;
                        fenceDepth = 0;
                        fenceListIndent = 0;
                    }
                    cleanedBodyLines.push(line);
                    protectedFlags.push(true);
                    continue;
                }
            } else {
                // Blockquote container exited: end the fence and fall through so this
                // line is handled normally.
                fenceChar = null;
                fenceLen = 0;
                fenceDepth = 0;
                fenceListIndent = 0;
            }
        }

        // Not inside a code block: an opening fence (top-level, blockquoted, or as
        // the first content of a list item) starts one. Detect it on the
        // blockquote-stripped content, after optionally stripping a list marker, and
        // remember the quote depth + list indent so the matching closer is found.
        {
            const { depth, content } = stripBlockquote(line, Infinity);
            const { rest, indent } = stripListMarker(content);
            const fence = openingFence(rest);
            if (fence) {
                fenceChar = fence.char;
                fenceLen = fence.len;
                fenceDepth = depth;
                fenceListIndent = indent;
                cleanedBodyLines.push(line);
                protectedFlags.push(true);
                continue;
            }
        }

        // Outside any code fence: decide whether this line is a migratable field.
        const trimmedLine = line.trim();
        let isPropertyToRemove = false;

        if (
            trimmedLine.includes('::') &&
            // Skip task checkboxes (e.g. "- [ ] do:: thing").
            !/^[-*+]\s+\[[xX ]\]/.test(trimmedLine)
        ) {
            // Mask inline code spans so a "::" inside code is not read as a field
            // separator. Masking preserves length so positions stay aligned with
            // the original line.
            const maskedLine = maskInlineCode(trimmedLine);
            const fieldMatch = maskedLine.match(/^([^:]+?)::(.*)$/);

            if (fieldMatch) {
                const nameEnd = fieldMatch[1].length;
                // The field name must be free of inline code. If masking changed
                // the name region, the line is mid-content (e.g. a code span sits
                // before the colon), not a clean "name:: value" field - leave it
                // verbatim so we never delete the code span that precedes it.
                const nameIsClean =
                    maskedLine.slice(0, nameEnd) === trimmedLine.slice(0, nameEnd);

                if (nameIsClean) {
                    const fieldName = trimmedLine.slice(0, nameEnd).trim();
                    // Skip the "::" separator; recover the real value (including any
                    // backticks) from the original line.
                    const fieldValue = trimmedLine.slice(nameEnd + 2).trim();

                    if (fieldName && fieldValue) {
                        const fieldNameLower = fieldName.toLowerCase();
                        // `frontmatter['__proto__'] = value` hits the Object.prototype
                        // accessor instead of creating an own property, so the value
                        // would be silently dropped while the body line is deleted -
                        // data loss. Leave such a line in the body verbatim instead
                        // (mirrors the core plugin's dunder-key guard, which blocks
                        // __proto__ in any position).
                        const isUnwritableName = fieldName === '__proto__';
                        const shouldMigrate = !isUnwritableName && (migrateAll ||
                            (allowedPropertiesLower.length > 0 && allowedPropertiesLower.includes(fieldNameLower)));

                        if (shouldMigrate) {
                            // This line should be removed (moved to frontmatter).
                            isPropertyToRemove = true;

                            if (!fields.has(fieldName)) {
                                fields.set(fieldName, new Set());
                            }

                            // Parse the value with special handling for wikilinks.
                            const parsedValues = parseCommaSeparatedWithWikilinks(fieldValue);
                            parsedValues.forEach(value => fields.get(fieldName).add(value));
                        }
                    }
                }
            }
        }

        // Keep the line if it's not a property to remove.
        if (!isPropertyToRemove) {
            cleanedBodyLines.push(line);
            protectedFlags.push(false);
        }
    }

    // Collapse runs of 2+ consecutive blank lines down to a single blank line, but
    // never touch blank lines inside fenced code blocks (verbatim guarantee). This
    // also leaves the frontmatter untouched, unlike a global newline regex.
    const collapsedLines = [];
    let blankRun = 0;
    for (let i = 0; i < cleanedBodyLines.length; i++) {
        const bodyLine = cleanedBodyLines[i];
        if (!protectedFlags[i] && bodyLine.trim() === '') {
            blankRun += 1;
            if (blankRun <= 1) {
                collapsedLines.push(bodyLine);
            }
        } else {
            blankRun = 0;
            collapsedLines.push(bodyLine);
        }
    }

    const cleanedBody = collapsedLines.join('\n');
    const cleanedContent = hasExistingFrontmatter
        ? frontmatterText + cleanedBody
        : cleanedBody;

    return { fields, cleanedContent };
}

/**
 * Strip up to `max` leading blockquote markers from a line. A marker is up to 3
 * spaces of indentation, a ">", and one optional following space, and markers
 * nest ("> > " or ">> "). Returns the number of markers stripped (`depth`) and the
 * remaining `content`. This lets fenced code blocks be tracked inside blockquotes:
 * the block's content and its closing fence sit at the same quote depth as the
 * opener, and a line with fewer markers means the blockquote (and the block) ended.
 */
function stripBlockquote(line, max) {
    let content = line;
    let depth = 0;
    while (depth < max) {
        const match = content.match(/^ {0,3}>( ?)/);
        if (!match) break;
        depth += 1;
        content = content.slice(match[0].length);
    }
    return { depth, content };
}

/**
 * Strip an optional leading list-item marker ("- ", "* ", "+ ", "1. ", "1) ")
 * from a line whose blockquote markers have already been removed. Returns the
 * remaining text and the number of columns the marker consumed (the list content
 * indent). This lets a code fence that opens as the first content of a list item
 * (e.g. "- ```") be recognised, with its body and closing fence tracked at that
 * indent. A list marker is an unambiguous block container, so detecting it here is
 * safe - unlike a bare indent, it cannot be confused with ordinary text.
 */
function stripListMarker(content) {
    const match = content.match(/^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/);
    if (!match) return { rest: content, indent: 0 };
    return { rest: content.slice(match[0].length), indent: match[0].length };
}

/**
 * Strip up to `max` leading spaces from a line. Returns the remaining text and the
 * number of spaces actually removed.
 */
function stripLeadingSpaces(content, max) {
    let indent = 0;
    while (indent < max && content[indent] === ' ') indent += 1;
    return { rest: content.slice(indent), indent };
}

/**
 * Detect an opening code fence (``` or ~~~) on a line whose blockquote and list
 * markers have already been stripped. Per CommonMark a fence may be indented 0-3
 * spaces (4+ is an indented code block) and may carry an info string. Returns
 * { char, len } for the marker, or null.
 *
 * Out of scope - 4-space INDENTED code blocks are not detected. Telling a genuine
 * indented code block apart from indented text needs paragraph block context
 * (CommonMark: indented code cannot interrupt a paragraph, and a 4-space indent
 * under a list item is list content rather than code). A line-based script lacks
 * that context, and a partial heuristic would either reintroduce data loss
 * (deleting indented code) or cause the opposite bug - silently skipping a real
 * inline field merely indented under a list (Dataview parses those as fields, so
 * users expect them to migrate). Fenced code (top-level, blockquoted, AND list-
 * nested) and inline code ARE detected and preserved; only an inline-field-like
 * line inside a genuine INDENTED code block may still migrate.
 */
function openingFence(line) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) return null;
    return { char: match[1][0], len: match[1].length };
}

/**
 * A closing fence uses the same marker character, is at least as long as the
 * opening fence, and carries no info string (only optional trailing whitespace).
 */
function isClosingFence(line, fenceChar, fenceLen) {
    // Allow a trailing CR so CRLF files close their fences correctly.
    const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/);
    if (!match) return false;
    const marker = match[1];
    return marker[0] === fenceChar && marker.length >= fenceLen;
}

/**
 * Replace inline code spans with equal-length blanks so a "::" inside code is not
 * mistaken for an inline-field separator. Supports arbitrary backtick-run lengths
 * (`code`, ``co`de``). Character positions are preserved so the caller can slice
 * the original line by offsets computed on the masked line.
 *
 * Implemented as a linear-time scan over the indexed backtick runs (no
 * backtracking; it indexes the runs, then walks them once). The earlier regex
 * /(`+)(?:(?!\1)[\s\S])*?\1/g combined a backreferenced opener, a lazy body, and a
 * negative lookahead, which backtracks super-linearly (seconds of main-thread
 * freeze) on a long backtick run with no matching-length closer - reachable from a
 * synced/shared note that the user migrates. This scanner reproduces the regex's
 * exact masking behaviour with O(n) work: a run of k backticks is closed by the
 * first run of at least k backticks (its first k backticks form the closer, the
 * regex's `\1`), preferring the longest opener length the engine would have
 * matched. An unclosed opener stays verbatim.
 */
function maskInlineCode(text) {
    const n = text.length;

    // Index every maximal run of backticks once.
    const runStart = [];
    const runLen = [];
    for (let i = 0; i < n; ) {
        if (text.charCodeAt(i) === 96 /* ` */) {
            let j = i + 1;
            while (j < n && text.charCodeAt(j) === 96) j++;
            runStart.push(i);
            runLen.push(j - i);
            i = j;
        } else {
            i++;
        }
    }
    const runCount = runStart.length;
    if (runCount === 0) return text;

    // suffixMax[a] = longest run over runs[a..end]; suffixMax[runCount] = 0. Lets the
    // best closer for a given opener be found without re-scanning later runs.
    const suffixMax = new Array(runCount + 1);
    suffixMax[runCount] = 0;
    for (let a = runCount - 1; a >= 0; a--) {
        suffixMax[a] = Math.max(runLen[a], suffixMax[a + 1]);
    }

    const out = text.split('');
    const blank = (from, to) => { for (let p = from; p < to; p++) out[p] = ' '; };

    // Walk each logical opener. `a` is the run we sit in; `i`/`m` are the opener's
    // start position and remaining backtick count (m < runLen[a] only when a prior
    // closer already consumed a prefix of this run).
    let a = 0;
    let i = runStart[0];
    let m = runLen[0];
    while (true) {
        const half = m >> 1;            // floor(m/2): longest opener that closes inside this run
        const maxLater = suffixMax[a + 1];
        const kUpper = Math.min(m, maxLater); // longest opener that closes in a later run

        if (kUpper > half) {
            // Greedy opener of length kUpper; closer is the first later run that long.
            const k = kUpper;
            let b = a + 1;
            while (runLen[b] < k) b++;  // exists because maxLater >= k
            const matchEnd = runStart[b] + k;
            blank(i, matchEnd);
            const leftover = runLen[b] - k;
            if (leftover > 0) { a = b; i = matchEnd; m = leftover; continue; }
            a = b + 1;
        } else if (half > 0) {
            // Closer is the next `half` backticks inside this same run.
            const matchEnd = i + 2 * half;
            blank(i, matchEnd);
            const leftover = m - 2 * half; // 0 (even run) or 1 (odd run)
            if (leftover > 0) { i = matchEnd; m = leftover; continue; }
            a = a + 1;
        } else {
            // m === 1 with no later backticks: a lone backtick stays literal.
            a = a + 1;
        }

        if (a >= runCount) break;
        i = runStart[a];
        m = runLen[a];
    }
    return out.join('');
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
