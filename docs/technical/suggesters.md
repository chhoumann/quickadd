# Suggester System

The QuickAdd suggester system provides intelligent text completion and suggestions for various input fields. The system has been redesigned to be more robust, performant, and extensible.

## Architecture

### Core Components

- **suggest.ts** - The main suggester base class
- **utils.ts** - Utility functions for text manipulation and highlighting
- **Domain-specific suggesters** - Specialized implementations for different use cases

### Key Features

1. **Debounced Input Processing** - Eliminates flicker and reduces unnecessary API calls
2. **Async Support** - Handles asynchronous suggestion generation with race condition protection
3. **Smart Positioning** - Uses Popper.js with flip and overflow prevention
4. **Enhanced Keyboard Navigation** - Supports arrow keys, Page Up/Down, Home/End
5. **Accessibility** - Full ARIA attributes and screen reader support
6. **Instance Management** - Prevents duplicate popups through WeakMap-based reuse
7. **Global Close Handlers** - Closes suggestions when clicking outside or scrolling

## Creating a Custom Suggester

To create a custom suggester, extend the `TextInputSuggest` base class:

```typescript
import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";

export class MyCustomSuggester extends TextInputSuggest<string> {
    constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement) {
        super(app, inputEl);
    }

    // Required: Generate suggestions based on input
    getSuggestions(inputStr: string): string[] | Promise<string[]> {
        // Return array of suggestions or a Promise that resolves to suggestions
        return ["suggestion1", "suggestion2", "suggestion3"];
    }

    // Required: Render each suggestion in the dropdown
    renderSuggestion(item: string, el: HTMLElement): void {
        el.setText(item);
        // Or use highlighting:
        // el.innerHTML = this.renderMatch(item, this.getCurrentQuery());
    }

    // Required: Handle when user selects a suggestion
    selectSuggestion(item: string, event: MouseEvent | KeyboardEvent): void {
        this.inputEl.value = item;
        this.inputEl.trigger("input");
        this.close();
    }
}
```

### Advanced Features

#### Async Suggestions

For suggestions that require API calls or complex processing:

```typescript
async getSuggestions(inputStr: string): Promise<string[]> {
    // The base class handles race conditions automatically
    const results = await fetch(`/api/suggestions?q=${inputStr}`);
    return results.json();
}
```

#### Custom Highlighting

Override the highlighting function for better visual feedback:

```typescript
constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement) {
    super(app, inputEl);
    
    // Use fuzzy highlighting instead of exact matches
    this.renderMatch = (text, query) => highlightFuzzyMatches(text, query);
}
```

#### Context-Aware Suggestions

Access cursor position and surrounding text:

```typescript
getSuggestions(inputStr: string): string[] {
    const cursorPos = this.inputEl.selectionStart ?? 0;
    const textBefore = getTextBeforeCursor(this.inputEl, 20);
    
    // Generate suggestions based on context
    if (textBefore.includes("#")) {
        return this.getTagSuggestions(inputStr);
    }
    
    return this.getDefaultSuggestions(inputStr);
}
```

## Utility Functions

The `utils.ts` file provides helpful functions for text manipulation:

```typescript
import { 
    insertAtCursor, 
    replaceRange, 
    getTextBeforeCursor, 
    highlightMatches, 
    highlightFuzzyMatches 
} from "./utils";

// Insert text at current cursor position
insertAtCursor(inputEl, "inserted text");

// Replace text in a specific range
replaceRange(inputEl, startPos, endPos, "replacement");

// Get text before cursor (useful for context-aware suggestions)
const context = getTextBeforeCursor(inputEl, 15);

// Highlight exact matches
const highlighted = highlightMatches("Hello World", "World");

// Highlight fuzzy matches
const fuzzyHighlighted = highlightFuzzyMatches("Hello World", "HW");
```

## Best Practices

### Performance

1. **Cache suggestions** when possible to avoid redundant processing
2. **Use debouncing** - the base class handles this automatically
3. **Limit suggestion count** to 10-15 items for best UX
4. **Prefer synchronous over async** when data is readily available

### User Experience

1. **Provide visual feedback** with highlighting
2. **Sort results meaningfully** - prefix matches first, then fuzzy matches
3. **Handle empty results gracefully** - return empty array to close suggestions
4. **Position cursor appropriately** after selection

### Accessibility

The base class automatically handles:
- ARIA attributes (`role="listbox"`, `aria-selected`, etc.)
- Keyboard navigation
- Screen reader announcements
- Focus management

### Error Handling

```typescript
async getSuggestions(inputStr: string): Promise<string[]> {
    try {
        return await this.fetchSuggestions(inputStr);
    } catch (error) {
        console.error("Failed to fetch suggestions:", error);
        return []; // Return empty array on error
    }
}
```

## Migration from Old System

The new system is backward compatible. To migrate:

1. **Update imports**: Change from `./suggest` to `./BaseSuggest`
2. **Optional**: Add async support to `getSuggestions`
3. **Optional**: Use highlighting utilities for better visual feedback
4. **Optional**: Add proper error handling for async operations

## Examples

See the existing suggesters for reference implementations:

- **ImprovedTagSuggester** - Shows tag suggestions with fuzzy search
- **ImprovedFormatSyntaxSuggester** - Context-aware syntax completion
- **FileSuggester** - File and folder suggestions
- **GenericTextSuggester** - Simple text completion

Each demonstrates different patterns and capabilities of the suggester system.
