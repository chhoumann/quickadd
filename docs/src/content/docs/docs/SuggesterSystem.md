---
title: Suggester System
description: Use QuickAdd's suggester triggers for files, tags, headings, and blocks in input prompts, with keyboard navigation
slug: docs/SuggesterSystem
---


QuickAdd's suggester system provides intelligent, context-aware suggestions when selecting files, tags, headings, and other content in your vault.

The `#` and `[[` triggers below work in QuickAdd's single-line and multi-line input prompts. The [one-page input form](/docs/ControllingPrompts/#one-form-instead-of-many-prompts)'s text fields do not offer them; its field and pick-list inputs have their own inline suggestions.

![Obsidian_kKQxHJal6p](https://github.com/user-attachments/assets/cc89f672-3451-42c0-89b8-89e0a1ebc780)

## Special Search Modes

### Tag Search
Type `#` to search through all tags in your vault.

### File Search
Type `[[` to start searching through all files in your vault.

QuickAdd file pickers show a note's frontmatter `title` when available, then its
first level-1 heading, then its file basename. The selected item is still the
real vault path.

### Heading Search
Type `[[#` to start searching through all headings in your vault.

### Block Reference Search
Type `[[#^` to find specific blocks.

### Relative Path Navigation
- Use `./` to search in the current folder
- Use `../` to search in the parent folder

### Keyboard Shortcuts

The suggester system supports comprehensive keyboard navigation:

| Key | Action |
|-----|--------|
| `↑`/`↓` | Navigate up/down through suggestions |
| `Enter` | Select current suggestion |
| `Escape` | Cancel selection |

Navigation wraps around - pressing down on the last item takes you to the first.
