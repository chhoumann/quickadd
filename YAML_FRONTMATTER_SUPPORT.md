# YAML Front Matter Support for Structured Variables

This implementation adds native support for proper YAML formatting of structured variables (arrays, objects, numbers, booleans, null) in QuickAdd templates.

## Enabling the Feature

This is a **beta feature** that must be enabled in settings:
1. Go to **Settings → QuickAdd**  
2. Enable **"Enable YAML Structured Variables (Beta)"**
3. The feature is disabled by default to ensure backward compatibility

## How It Works

### 1. Template Processing
During template expansion, the formatter now:
- Tracks variables that contain structured data (non-string values) when they appear in YAML front matter contexts
- Still performs string replacement initially for backward compatibility
- Stores structured variables for post-processing

### 2. File Creation & Post-Processing
After a file is created, QuickAdd automatically:
- Uses Obsidian's `FileManager.processFrontMatter()` to rewrite structured variables with proper YAML formatting
- Leverages Obsidian's battle-tested YAML serialization
- Ensures perfect compatibility with how Obsidian reads/writes YAML

## Example Usage

### Before (Manual String Formatting)
```javascript
// In your script
const formattedAuthorsString = authors.join(', '); // Manual formatting
QuickAdd.variables.authors = formattedAuthorsString;
```

Template:
```yaml
---
authors: {{VALUE:authors}}
---
```

Result (subpar):
```yaml
---
authors: John Doe, Jane Smith, Bob Wilson
---
```

### After (Native Structured Support)
```javascript
// In your script - just set the array directly!
QuickAdd.variables.authors = ["John Doe", "Jane Smith", "Bob Wilson"];
QuickAdd.variables.metadata = {
    rating: 5,
    conference: "ICML",
    keywords: ["ML", "AI"]
};
QuickAdd.variables.published = true;
QuickAdd.variables.year = 2023;
```

Template (same as before):
```yaml
---
title: {{VALUE:title}}
authors: {{VALUE:authors}}
metadata: {{VALUE:metadata}}
published: {{VALUE:published}}
year: {{VALUE:year}}
---
```

Result (perfect YAML):
```yaml
---
title: My Paper
authors:
  - John Doe
  - Jane Smith
  - Bob Wilson
metadata:
  rating: 5
  conference: ICML
  keywords:
    - ML
    - AI
published: true
year: 2023
---
```

## Supported Data Types

| Type | Example Input | YAML Output |
|------|---------------|-------------|
| **Array** | `["a", "b"]` | `- a`<br>`- b` |
| **Empty Array** | `[]` | `[]` |
| **Object** | `{key: "value"}` | `key: value` |
| **Empty Object** | `{}` | `{}` |
| **Number** | `42` | `42` |
| **Boolean** | `true` | `true` |
| **Null** | `null` | `null` |
| **String** | `"text"` | `text` (unchanged behavior) |

## Backward Compatibility

- **Existing templates continue to work unchanged**
- String variables still work exactly as before
- Quoted placeholders (e.g., `"{{VALUE:var}}"`) always use string replacement
- Variables outside YAML front matter use string replacement

## Context Detection

The system automatically detects when to apply YAML formatting by checking:
1. **Is in YAML front matter** (between `---` delimiters)
2. **Is a key-value position** (`key: {{VALUE:var}}`)
3. **Is not quoted** (`"{{VALUE:var}}"` stays as string)
4. **Is structured data** (not a string)

Only when all conditions are met does it apply YAML formatting.

## Implementation Details

### Components Modified
- **`Formatter`**: Added structured variable tracking
- **`TemplateEngine`**: Added post-processing step
- **`CaptureChoiceEngine`**: Added post-processing for capture templates
- **`SingleTemplateEngine`**: Added structured variable exposure

### Processing Flow
1. **Template Expansion**: Variables expand as strings, structured variables are tracked
2. **File Creation**: File created with string-expanded content
3. **Post-Processing**: `FileManager.processFrontMatter()` applied to rewrite structured variables
4. **Result**: Perfect YAML formatting using Obsidian's serialization

This approach ensures maximum reliability by using Obsidian's own YAML handling while maintaining full backward compatibility.
