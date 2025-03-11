---
title: Working with Array Fields
sidebar_position: 2
---

# Array Support for Fields

QuickAdd supports array values in frontmatter when using the `{{FIELD}}` format syntax. This feature makes it easy to work with multi-value frontmatter fields like tags, categories, or any custom array field.

## How It Works

When using the `{{FIELD:<fieldname>}}` syntax, QuickAdd will:

1. Search all markdown files in your vault
2. Find frontmatter fields that match the specified name
3. Include all individual array items as separate suggestions in the dropdown

## Example: Tags

Consider a note with the following frontmatter:

```yaml
---
tags:
  - jrpg
  - game
  - coding
  - productivity
---
```

When you use `{{FIELD:tags}}` in a template or capture, you'll see each individual tag as a separate suggestion:

- jrpg
- game
- coding
- productivity

This allows you to:
- Maintain consistent tagging across your vault
- Choose from previously used tags
- Avoid typos when reusing tags

## Use Cases

This feature is especially useful for:

1. **Consistent Tagging**: Ensure you use the same tags across your vault
2. **Project Categories**: Select from existing project categories
3. **Status Values**: Choose from a predefined set of status values
4. **Custom Classifications**: Any array-based metadata you use to organize your notes

## Technical Implementation

For arrays, QuickAdd:
- Detects values that are JavaScript arrays (using `value.constructor === Array`)
- Iterates through each array item
- Converts each item to a string
- Adds each item to the suggestion list

For non-array fields, behavior remains unchanged - the value is converted to a string and added as a single suggestion.