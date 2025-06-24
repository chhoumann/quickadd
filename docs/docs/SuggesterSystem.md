---
title: Suggester System
---

# Suggester System

QuickAdd's suggester system provides intelligent, context-aware suggestions when selecting files, tags, headings, and other content in your vault.

![Obsidian_kKQxHJal6p](https://github.com/user-attachments/assets/cc89f672-3451-42c0-89b8-89e0a1ebc780)

## Features

### Lightning-Fast Search

The new FileIndex system provides instant search results, even in vaults with thousands of files:

- **In-memory indexing** for immediate responses
- **Fuzzy search** powered by Fuse.js finds what you're looking for, even with typos
- **Incremental updates** keep the index fresh without performance impact
- **Smart caching** remembers recently accessed files

### What's New in File Search

![Obsidian_KosRolD8m9](https://github.com/user-attachments/assets/b2ca7c45-cdcb-45b0-b46a-9fa3309efcd3)

The file search is now smarter and faster:

- **Exact matches always come first** - If you type "Budget", the file named "Budget" appears before "2025 Budget Planning"
- **Understands what you meant** - Type "plan" to find "Planning", "Project Plan", and "Meal Plans"
- **Knows your context** - Files you just opened and files in the same folder appear higher
- **Works with aliases** - Search by file aliases, not just filenames
- **Visual hints** - See at a glance which files are recent, in the same folder, or share tags

### Special Search Modes

#### Heading Search
Type `#` to search through all headings in your vault:
```
{{VALUE:section,heading}}
```

#### Block Reference Search
Type `^` to find specific blocks:
```
{{VALUE:block,block}}
```

#### Relative Path Navigation
- Use `./` to search in the current folder
- Use `../` to search in the parent folder

## Keyboard Shortcuts

The suggester system supports comprehensive keyboard navigation:

| Key | Action |
|-----|--------|
| `↑`/`↓` | Navigate up/down through suggestions |
| `Tab`/`Shift+Tab` | Navigate down/up (alternative) |
| `Enter` | Select current suggestion |
| `Escape` | Cancel selection |
| `PageUp` | Jump up 5 items |
| `PageDown` | Jump down 5 items |
| `Home` | Jump to first item |
| `End` | Jump to last item |

Navigation wraps around - pressing down on the last item takes you to the first.

## Accessibility

The redesigned suggester system includes full accessibility support:

- **Screen reader support** with proper ARIA labels
- **High contrast mode** compatible
- **Reduced motion** support for users with motion sensitivity
- **Keyboard-only navigation** with no mouse required

## Performance

The new system delivers significant performance improvements:

- **50ms debounced input** for responsive typing
- **GPU-accelerated animations** for smooth transitions
- **Smart request tracking** prevents stale results
- **Batch processing** for large vaults ensures UI remains responsive

## Using Suggesters in Templates

### Basic File Suggester
```
Meeting with {{VALUE:person,file}}
```

### Tag Suggester
```
#{{VALUE:tag,tag}}
```

### Folder-Specific File Suggester
```
Project: {{VALUE:project,file:Projects}}
```

### Multi-Value Suggester
Use comma separation to get a multi-select suggester:
```
Attendees: {{VALUE:attendees,file,file,file}}
```

## Format Syntax Integration

The suggester system integrates seamlessly with QuickAdd's format syntax. When typing format syntax like `{{DATE}}` or `{{VALUE}}`, you'll get intelligent suggestions for:

- Available variables
- Date formats
- Macro names
- Template paths
- Field names

## Troubleshooting

### Suggester not appearing
- Ensure you're using the correct syntax (e.g., `{{VALUE:name,file}}` for file suggestions)
- Check that the Natural Language Dates plugin is installed if using date suggestions

### Slow performance
- The first search after starting Obsidian may take a moment to build the index
- Very large vaults (10,000+ files) may see a slight delay on first use
- Performance improves after the initial index is built

### Missing suggestions
- Files must be markdown files to appear in suggestions
- Hidden files and folders (starting with `.`) are excluded
- Files matching .gitignore patterns may be excluded

## API Usage

For developers using the QuickAdd API:

```javascript
// Get a file suggestion
const file = await quickAddApi.suggester(
  (file) => file.basename,
  app.vault.getMarkdownFiles()
);

// Get a file with enhanced context
const enhancedFile = await quickAddApi.suggester(
  quickAddApi.formatters.fileFormatter,
  app.vault.getMarkdownFiles()
);
```

The new suggester system automatically provides enhanced formatting and scoring when used through the API.