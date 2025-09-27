---
title: Template Property Types (Beta)
sidebar_position: 5
tags: [properties, templates, beta, front matter, obsidian]
---

# Template Property Types (Beta)

Native support for proper Obsidian property types in QuickAdd template front matter.

## Overview

QuickAdd now supports automatic property type formatting for template variables in front matter. Instead of converting everything to text, template variables become proper Obsidian property types: arrays become List properties, numbers become Number properties, booleans become Checkbox properties, and so on.

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

This feature uses Obsidian's built-in property system for maximum reliability and compatibility.

## Enabling the Feature

⚠️ **This is a beta feature** - enable it in settings:

1. Open **Settings → QuickAdd**
2. Toggle **"Format template variables as proper property types (Beta)"**
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
title: "{{VALUE:title}}"
authors: "{{VALUE:authors}}"
tags: "{{VALUE:tags}}"
metadata: "{{VALUE:metadata}}"
published: "{{VALUE:published}}"
year: "{{VALUE:year}}"
notes: "{{VALUE:notes}}"
---

# {{VALUE:title}}

Content here...
```

### 3. Get Perfect Property Types

The result is properly formatted as Obsidian property types:

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

| JavaScript Type | Property Output | Example |
|-----------------|-------------|---------|
| **Array** | List property | `["a", "b"]` → `- a`<br />`- b` |
| **Empty Array** | Empty list | `[]` → `[]` |
| **Object** | Object property | `{key: "value"}` → `key: value` |
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
title: "{{VALUE:title}}"
authors: "{{VALUE:authors}}"
year: "{{VALUE:year}}"
venue: "{{VALUE:venue}}"
keywords: "{{VALUE:keywords}}"
metrics: "{{VALUE:metrics}}"
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

## Feedback & Support

This is a **beta feature** - your feedback helps improve it:

- **Report issues**: Include template examples and variable data
- **Request features**: Suggest improvements for your workflow
- **Share success stories**: Help others learn effective patterns

The feature is designed to be safe and backward-compatible, but please test thoroughly with your specific use cases before relying on it for important workflows.
