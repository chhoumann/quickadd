---
title: Suggester System
description: "Type # for tags or [[ for files, headings, and blocks right inside QuickAdd prompts, with keyboard navigation to pick fast"
slug: docs/SuggesterSystem
---

When a QuickAdd prompt asks you for text, you don't have to type a file name or
tag from memory. Start typing a trigger like `[[` and QuickAdd shows a
searchable list of matches, exactly like Obsidian's own link and tag
autocomplete. Pick one, and QuickAdd drops it in where you were typing.

![The QuickAdd suggester listing files after typing two square brackets](https://github.com/user-attachments/assets/cc89f672-3451-42c0-89b8-89e0a1ebc780)

## What you can search for {#special-search-modes}

Type one of these triggers anywhere in a prompt:

| Type this | To search |
| --- | --- |
| [`#`](#tag-search) | Every tag in your vault |
| [`[[`](#file-search) | Every file in your vault |
| [`[[#`](#heading-search) | Every heading in your vault |
| [`[[#^`](#block-reference-search) | A specific block |

:::note[Where the triggers work]
The `#` and `[[` triggers work in QuickAdd's single-line and multi-line input
prompts. The [one-page input form](/docs/ControllingPrompts/#one-form-instead-of-many-prompts)'s
text fields don't offer them; its field and pick-list inputs have their own
inline suggestions instead.
:::

### Search your tags: `#` {#tag-search}

Type `#` to search every tag in your vault, then pick one.

### Search your files: `[[` {#file-search}

Type `[[` to search every file in your vault. Each result is labelled by its
frontmatter `title` if it has one, then its first level-1 heading, then its file
name - but whichever label you see, QuickAdd always inserts a link to the real
file.

#### Search a nearby folder: `./` and `../` {#relative-path-navigation}

Narrow a file search to a folder near the current note:

- `./` searches the folder the current note is in.
- `../` searches the parent folder.

### Jump to a heading: `[[#` {#heading-search}

Type `[[#` to search every heading in your vault and link straight to it.

### Link a specific block: `[[#^` {#block-reference-search}

Type `[[#^` to find and link an individual block.

## Keyboard shortcuts {#keyboard-shortcuts}

You can drive the suggester entirely from the keyboard:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move up and down through the suggestions |
| `Enter` | Pick the highlighted suggestion |
| `Escape` | Close the suggester without picking |

The list wraps around: pressing `↓` on the last item jumps back to the first.
