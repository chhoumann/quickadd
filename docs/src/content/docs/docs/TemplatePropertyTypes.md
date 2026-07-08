---
title: Template Property Types (Beta)
description: Write proper Obsidian property types from template frontmatter variables, with an optional beta string-to-type conversion
slug: docs/TemplatePropertyTypes
---

When a QuickAdd template or capture writes front matter, this feature makes sure
each value lands as the *right* Obsidian property type - a real List, Number, or
Checkbox - instead of a string that only looks right. You get clean, typed
front matter without hand-formatting YAML, so scripts can hand QuickAdd normal
JavaScript values and templates stay readable.

## What gets converted {#overview}

There are two layers, and only the second one is a beta toggle.

**Always on, no setting required.** When a script provides a **list (array)**
or **object** value for a front matter field, QuickAdd writes it as a real
Obsidian List or object property through Obsidian's own YAML serializer. This is
what makes templates like the
[Movie & Series script](/docs/Examples/Macro_MovieAndSeriesScript/) produce
valid front matter out of the box: a returned array of links becomes a List of
links instead of broken YAML.

**Behind the beta toggle.** The setting below *additionally* converts **string**
values into typed properties: a comma or bullet-list string becomes a List,
`"42"` becomes a Number, `"true"` becomes a Checkbox, and so on. This is the
beta part, because it changes a value's type based on its contents. It is
disabled by default.

Here is what the string conversion does to a comma-separated author list:

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

:::tip[Prefer explicit format-syntax options]
When you want a specific input or type, [format syntax](/docs/FormatSyntax/)
gives you one directly, with no beta toggle required:

- [`{{VALUE:x|type:number}}` / `|type:slider` / `|type:checkbox` / `|type:text`](/docs/FormatSyntax/#value-property-types) - pick the right input widget; `|type:slider|min:0|max:100` is useful for bounded Number properties, and `|type:text` keeps a number-looking value (e.g. `0042`) a string.
- [`{{VALUE:a,b,c|multi}}`](/docs/FormatSyntax/#value-multi) - a multi-select picker that writes a real List (also `|multi:linklist` for link lists).
- [`{{VDATE:when,fmt|time}}`](/docs/FormatSyntax/#vdate-time) - a date **and time** picker for `Date & time` properties.
:::

Plain `{{VALUE}}` already round-trips numbers, booleans, and dates to the correct
type without any setting. The beta string conversion below mainly adds
comma/bullet-string to List for properties typed as a list.

## Turn on string conversion (beta) {#enabling-the-string-conversion-beta}

List and object handling needs no setting. To *also* convert **string** values
into typed properties, enable the beta toggle:

1. Open **Settings → QuickAdd**.
2. Toggle **"Convert string front matter variables to typed properties (Beta)"**.

String conversion is **disabled by default** for safety.

## Walkthrough {#basic-usage}

### 1. Set structured data in a script {#1-set-structured-data-in-scripts}

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

### 2. Use them in a template {#2-use-in-templates}

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

### 3. Get perfect property types {#3-get-perfect-property-types}

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

## Which JavaScript type becomes which property {#supported-data-types}

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

### QuickAdd respects the type you set in Obsidian {#respecting-obsidian-property-types}

QuickAdd looks at the type you've assigned in Obsidian's *Properties* UI for
each field and formats the value accordingly:

- **`tags` / multi-select (`multitext`) / list** - strings such as `foo, bar` or bullet items become proper arrays.
- **Scalar types** (`text`, `number`, `date`, `datetime`, `checkbox`) stay as single values, even if the text contains commas or line breaks.
- **Unknown type** - falls back to the v2.0 behaviour (it will still split obvious arrays like YAML lists or JSON arrays).

This means you can safely type natural prose like `Hello, world` into a
`description` prompt without QuickAdd turning it into a YAML list, while
`sources` marked as a multi-value property will still receive a properly
formatted array.

### Deeply nested data works too {#complex-nested-structures}

The feature supports deeply nested structures:

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

## Real-world examples {#real-world-examples}

### Academic papers {#academic-papers}

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

### Project management {#project-management}

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

## Captures and fresh templates {#captures--fresh-templates}

When a capture choice creates a new file, QuickAdd analyses the just-generated
front matter instead of relying on cached metadata. The capture payload is
inserted **after** the closing `---`, so YAML stays at the top of the note even
on the first run.

For list-style placeholders inside the front matter, QuickAdd resolves the
parent property and respects the type you set in Obsidian:

```yaml
---
sources:
  - "{{VALUE:sources}}"
description: "{{VALUE:description}}"
---
```

| Property type (in Obsidian) | Behaviour |
| --------------------------- | --------- |
| `multitext`, `tags`, `list` | `sources` becomes a YAML array (`- value`) using your prompt input. |
| `text`, `number`, `checkbox`, `date`, `datetime` | Values remain scalars; commas or line breaks no longer force list formatting. |

Example output:

```yaml
sources:
  - [[Episode 1]]
  - [[Episode 2]]
description: This stays a single string, even with commas.
```

## Feedback and support {#feedback--support}

This is a **beta feature**. It is designed to be safe and backward-compatible,
but test it with your own templates before relying on it for important
workflows - and when reporting an issue, include the template and the variable
data that triggered it.
