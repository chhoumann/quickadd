---
title: YAML Structured Variables (Beta)
sidebar_position: 5
tags: [yaml, templates, beta, front matter]
---

# YAML Structured Variables (Beta)

Native support for arrays, objects, and other structured data types in QuickAdd template front matter.

## Overview

QuickAdd now supports automatic YAML formatting for structured variables in template front matter. Instead of manually converting arrays to comma-separated strings, you can use native JavaScript data structures that get properly formatted as YAML.

**Before:**
```yaml
authors: "John Doe, Jane Smith, Bob Wilson"  # Manual string formatting
```

**After:**
```yaml
authors:
  - John Doe
  - Jane Smith  
  - Bob Wilson
```

This feature uses Obsidian's built-in YAML processor for maximum reliability and compatibility.

## Enabling the Feature

⚠️ **This is a beta feature** - enable it in settings:

1. Open **Settings → QuickAdd**
2. Toggle **"Enable YAML Structured Variables (Beta)"**
3. The feature is **disabled by default** for safety

## Basic Usage

### 1. Set Structured Data in Scripts

Instead of manually formatting data as strings, use native JavaScript types:

```javascript
// ✅ NEW: Use native data structures
QuickAdd.variables.authors = ["John Doe", "Jane Smith", "Bob Wilson"];
QuickAdd.variables.tags = ["research", "ai", "papers"];
QuickAdd.variables.metadata = {
    rating: 5,
    conference: "ICML",
    keywords: ["ML", "AI"]
};
QuickAdd.variables.published = true;
QuickAdd.variables.year = 2023;
QuickAdd.variables.notes = null;

// ❌ OLD: Manual string formatting (no longer needed)
// QuickAdd.variables.authors = "John Doe, Jane Smith, Bob Wilson";
```

### 2. Use in Templates

Your template syntax stays exactly the same:

```yaml
---
title: {{VALUE:title}}
authors: {{VALUE:authors}}
tags: {{VALUE:tags}}
metadata: {{VALUE:metadata}}
published: {{VALUE:published}}
year: {{VALUE:year}}
notes: {{VALUE:notes}}
---

# {{VALUE:title}}

Content here...
```

### 3. Get Perfect YAML Output

The result is properly formatted YAML:

```yaml
---
title: "My Research Paper"
authors:
  - John Doe
  - Jane Smith
  - Bob Wilson
tags:
  - research
  - ai
  - papers
metadata:
  rating: 5
  conference: ICML
  keywords:
    - ML
    - AI
published: true
year: 2023
notes: null
---

# My Research Paper

Content here...
```

## Supported Data Types

| JavaScript Type | YAML Output | Example |
|-----------------|-------------|---------|
| **Array** | YAML list | `["a", "b"]` → `- a`<br />`- b` |
| **Empty Array** | Empty list | `[]` → `[]` |
| **Object** | YAML mapping | `{key: "value"}` → `key: value` |
| **Empty Object** | Empty mapping | `{}` → `{}` |
| **Number** | Number literal | `42` → `42` |
| **Boolean** | Boolean literal | `true` → `true` |
| **Null** | Null literal | `null` → `null` |
| **String** | String (unchanged) | `"text"` → `text` |

### Complex Nested Structures

The feature supports deeply nested data:

```javascript
QuickAdd.variables.paper = {
    title: "Advanced Research",
    authors: ["Alice", "Bob"],
    metadata: {
        year: 2023,
        conference: "ICML",
        tags: ["ML", "AI"],
        metrics: {
            pages: 12,
            citations: null
        }
    },
    reviewed: true
};
```

Results in:

```yaml
paper:
  title: Advanced Research
  authors:
    - Alice
    - Bob
  metadata:
    year: 2023
    conference: ICML
    tags:
      - ML
      - AI
    metrics:
      pages: 12
      citations: null
  reviewed: true
```

## Context-Aware Processing

The feature only applies YAML formatting when appropriate:

### ✅ **When YAML Formatting Applies**
- Variable is in YAML front matter (between `---` delimiters)
- Variable is the complete value for a YAML key (`key: {{VALUE:var}}`)
- Variable contains structured data (not a string)

### ❌ **When String Replacement is Used**
- Variable is outside front matter: `# {{VALUE:title}}`
- Variable is quoted: `title: "{{VALUE:title}}"` *(still gets structured formatting)*
- Variable is part of a larger value: `aliases: [{{VALUE:a}}, {{VALUE:b}}]`
- Variable contains string data

## Real-World Examples

### Academic Papers

**Script:**
```javascript
// From Zotero or other source
const paper = {
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    year: 2017,
    venue: "NIPS",
    keywords: ["attention", "transformer", "neural networks"],
    metrics: {
        citations: 50000,
        pages: [3000, 3010]
    }
};

Object.assign(QuickAdd.variables, paper);
```

**Template:**
```yaml
---
title: {{VALUE:title}}
authors: {{VALUE:authors}}
year: {{VALUE:year}}
venue: {{VALUE:venue}}
keywords: {{VALUE:keywords}}
metrics: {{VALUE:metrics}}
---

# {{VALUE:title}}

## Summary
Paper by {{VALUE:authors}} published in {{VALUE:venue}} ({{VALUE:year}}).
```

**Output:**
```yaml
---
title: Attention Is All You Need
authors:
  - Ashish Vaswani
  - Noam Shazeer
  - Niki Parmar
year: 2017
venue: NIPS
keywords:
  - attention
  - transformer
  - neural networks
metrics:
  citations: 50000
  pages:
    - 3000
    - 3010
---

# Attention Is All You Need

## Summary
Paper by Ashish Vaswani,Noam Shazeer,Niki Parmar published in NIPS (2017).
```

### Project Management

**Script:**
```javascript
QuickAdd.variables.project = {
    name: "Website Redesign",
    status: "in-progress",
    team: ["Alice", "Bob", "Carol"],
    priority: 3,
    tasks: [
        { name: "Research", complete: true },
        { name: "Design", complete: false },
        { name: "Development", complete: false }
    ],
    deadline: "2023-12-01"
};
```

**Result:**
```yaml
project:
  name: Website Redesign
  status: in-progress
  team:
    - Alice
    - Bob
    - Carol
  priority: 3
  tasks:
    - name: Research
      complete: true
    - name: Design
      complete: false
    - name: Development
      complete: false
  deadline: "2023-12-01"
```

## Backward Compatibility

### Existing Templates Keep Working
All existing QuickAdd templates continue to work exactly as before:
- String variables work unchanged
- Manual formatting still works
- No templates need to be modified

### Migration Path
You can gradually adopt structured variables:
1. **Phase 1**: Enable the feature, test with simple arrays
2. **Phase 2**: Convert complex string formatting to structured data
3. **Phase 3**: Fully leverage nested objects and complex structures

### Side-by-Side Usage
You can mix both approaches in the same template:
```yaml
---
title: "{{VALUE:title}}"              # String (unchanged)
authors: {{VALUE:authors}}            # Array (structured)
legacy_tags: "{{VALUE:tag_string}}"   # String (unchanged) 
modern_tags: {{VALUE:tag_array}}      # Array (structured)
---
```

## Troubleshooting

### Feature Not Working
1. **Check settings**: Ensure "Enable YAML Structured Variables (Beta)" is enabled
2. **Verify context**: Make sure variables are in front matter, not document body
3. **Check data types**: Ensure variables contain arrays/objects, not strings

### YAML Parsing Errors
If you see YAML parsing errors:
1. **Check for special characters** in string values
2. **Verify nested structure** doesn't have circular references
3. **Try with simpler data** first to isolate the issue

### Mixed Results
If some variables get structured formatting and others don't:
- **String variables** will always use string replacement
- **Variables outside front matter** use string replacement
- **Quoted placeholders** in complex expressions may use string replacement

### Debugging Tips
1. **Start simple**: Test with basic arrays before complex nested objects
2. **Check console**: Look for error messages in developer console
3. **Disable temporarily**: Turn off the feature to compare behavior
4. **Test incrementally**: Add one structured variable at a time

## Performance Considerations

### Minimal Impact
- Processing happens only when creating new files
- Uses Obsidian's optimized YAML processor
- No impact on existing files or daily usage

### Large Data Structures
- Very large objects may take slightly longer to process
- Consider breaking up extremely complex nested structures
- No practical limits for typical note-taking scenarios

## Technical Details

### How It Works
1. **Detection**: Identifies structured variables in YAML front matter during template processing
2. **Initial Creation**: Creates files with string representations first
3. **Post-Processing**: Uses `FileManager.processFrontMatter()` to rewrite structured data
4. **YAML Serialization**: Leverages Obsidian's battle-tested YAML formatting

### Security & Safety
- **No external dependencies**: Uses only Obsidian's built-in functionality
- **Graceful fallback**: If post-processing fails, file is still created with strings
- **Data integrity**: Original variable data is preserved throughout the process

### Compatibility
- **Obsidian versions**: Works with all recent Obsidian versions
- **Other plugins**: Compatible with Templater and other template plugins
- **File types**: Works with all Markdown files, including those with Canvas front matter

## Limitations (Beta)

### Current Limitations
- **Front matter only**: Only works in YAML front matter, not document body
- **Complete values only**: Doesn't work for partial replacements like `tags: [{{VALUE:a}}, "fixed"]`
- **Template choices and captures**: Both supported, but complex workflows may need testing

### Planned Improvements
- Enhanced support for mixed inline contexts
- Better error reporting and validation
- Performance optimizations for very large data structures
- Integration with field suggestions and autocomplete

## Feedback & Support

This is a **beta feature** - your feedback helps improve it:

- **Report issues**: Include template examples and variable data
- **Request features**: Suggest improvements for your workflow
- **Share success stories**: Help others learn effective patterns

The feature is designed to be safe and backward-compatible, but please test thoroughly with your specific use cases before relying on it for important workflows.
