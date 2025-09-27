---
title: Quick Start - YAML Structured Variables
sidebar_position: 6
tags: [yaml, quick start, templates, beta]
---

# Quick Start: YAML Structured Variables

Get proper YAML formatting for arrays and objects in your QuickAdd templates.

## Enable the Feature

1. **Settings → QuickAdd**
2. Toggle **"Enable YAML Structured Variables (Beta)"**

## Basic Example

### In Your Script
```javascript
// Instead of: QuickAdd.variables.authors = "John, Jane, Bob";
QuickAdd.variables.authors = ["John Doe", "Jane Smith", "Bob Wilson"];
QuickAdd.variables.tags = ["research", "ai"];
QuickAdd.variables.year = 2023;
QuickAdd.variables.published = true;
```

### In Your Template
```yaml
---
title: {{VALUE:title}}
authors: {{VALUE:authors}}
tags: {{VALUE:tags}}
year: {{VALUE:year}}
published: {{VALUE:published}}
---
```

### Result
```yaml
---
title: "My Paper"
authors:
  - John Doe
  - Jane Smith
  - Bob Wilson
tags:
  - research
  - ai
year: 2023
published: true
---
```

## What Works

| Data Type | Result |
|-----------|---------|
| `["a", "b"]` | `- a`<br>`- b` |
| `{key: "value"}` | `key: value` |
| `42` | `42` |
| `true` | `true` |
| `null` | `null` |

## Important Notes

- ✅ **Works in front matter** (between `---` delimiters)
- ✅ **Backward compatible** - existing templates unchanged
- ✅ **Safe** - if processing fails, you still get a file with strings
- ⚠️ **Beta feature** - test with your workflows first

## Need Help?

See the full [YAML Structured Variables documentation](YAMLStructuredVariables.md) for detailed examples, troubleshooting, and advanced usage.
