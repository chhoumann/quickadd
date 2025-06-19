# QuickAdd Live Preview Improvements

## Overview
Enhanced the live preview system for format syntax during Choice editing to provide much clearer and more helpful previews with emojis and realistic examples.

## What's New

### Improved File Name Display Formatter
- **File:** `src/formatters/fileNameDisplayFormatter.ts`
- **Purpose:** Enhanced live preview for file name formats in Template and Capture choices

### Enhanced Format Display Formatter
- **File:** `src/formatters/formatDisplayFormatter.ts` 
- **Purpose:** Better capture format previews with realistic placeholder values

### Shared Preview Utilities
- **File:** `src/formatters/helpers/previewHelpers.ts`
- **Purpose:** Reusable utilities for consistent preview generation across formatters

## Key Improvements

### Before vs After Examples

#### Date Formatting
- **Before:** `File Name: 2024-01-15 - _value_`
- **After:** `Preview: 2024-01-15 - user input`

#### Variable Formatting
- **Before:** `File Name: title_ - project_`
- **After:** `Preview: My Document Title - Project Alpha`

#### Macro Formatting
- **Before:** `File Name: _macro: clipboard_ - _macro: uuid_`
- **After:** `Preview: clipboard_content - unique_id`

#### Date Variables
- **Before:** `File Name: 2024-01-15 (dueDate)`
- **After:** `Preview: 2024-01-15`

#### Current File Links
- **Before:** `File Name: /path/to/current/file.md`
- **After:** `Preview: current_file`

### Smart Variable Recognition
The new formatter recognizes common variable patterns and provides contextual examples:

- `title` → `My Document Title`
- `project` → `Project Alpha`
- `author` → `Your Name`
- `status` → `Draft`
- `priority` → `High`
- `category` → `Notes`
- `date` variables → `2024-01-15`
- `number` variables → `001`

### Enhanced Date Format Previews
Supports more date format patterns:
- `YYYY-MM-DD` → `2024-01-15`
- `MMMM D, YYYY` → `January 15, 2024`
- `ddd, MMM D` → `Mon, Jan 15`
- Week numbers, 12/24 hour time, and more

### Clear Preview Indicators
- `Preview:` prefix for file name formats to distinguish from actual output
- Realistic placeholder values instead of generic underscored names
- Contextual examples based on variable name patterns
- Clean text formatting without potentially confusing symbols

## Implementation Details

### Code Organization
- **Shared utilities:** `src/formatters/helpers/previewHelpers.ts` contains reusable preview logic
- **DRY principle:** Eliminated code duplication between formatters
- **Single responsibility:** Each utility function has a clear, focused purpose
- **Comprehensive testing:** Full test coverage for all preview utilities

### Components Updated
- `src/formatters/fileNameDisplayFormatter.ts` - Refactored to use shared utilities
- `src/formatters/formatDisplayFormatter.ts` - Enhanced and refactored
- `src/gui/ChoiceBuilder/captureChoiceBuilder.ts` - Uses improved formatters
- `src/gui/ChoiceBuilder/templateChoiceBuilder.ts` - Uses improved formatters

### Key Features
1. **Error Handling:** Gracefully handles incomplete or malformed syntax
2. **Contextual Examples:** Provides realistic examples based on variable names
3. **Clear Preview Formatting:** Clean text formatting that won't confuse users about actual output
4. **Enhanced Date Formatting:** More comprehensive date format pattern support
5. **Code Reusability:** Shared utilities prevent duplication and ensure consistency

## Benefits
- **User Experience:** Much clearer understanding of what format strings will produce
- **Reduced Errors:** Better previews help users spot formatting issues before saving
- **Faster Workflow:** Users can quickly see the effects of their format changes
- **No Confusion:** Clean text formatting ensures users understand these are preview examples, not actual output
- **Better Accessibility:** Clear text formatting is easier to read and understand

## Testing
- Created comprehensive test suite: `src/formatters/fileNameDisplayFormatter.test.ts`
- Shared utilities fully tested: `src/formatters/helpers/previewHelpers.test.ts`
- All existing functionality preserved
- New features thoroughly tested
- Clean refactoring with no breaking changes
