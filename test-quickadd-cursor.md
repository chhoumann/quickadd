# QuickAdd Cursor Syntax Test Configuration

## New QuickAdd Cursor Syntax

QuickAdd now supports native cursor positioning with `{{cursor}}` and `{{cursor:n}}` syntax!

## Capture Choice Tests

### Test 1: Basic Cursor
**Capture Format:**
```
Task: {{VALUE}} {{cursor}} Due: {{DATE:YYYY-MM-DD}}
```

**Expected**: Cursor positioned after the task value

### Test 2: Templater Cursor Conversion
**Capture Format:**
```
## {{DATE}} Entry
<% tp.date.now() %> - {{VALUE}}
Notes: <% tp.file.cursor() %>
Tags: {{VALUE:Tags}}
```

**Expected**: 
- `tp.date.now()` processed to current date
- `tp.file.cursor()` converted to `{{cursor}}` and cursor positioned there
- All other syntax processed correctly

### Test 3: Multiple Cursors
**Capture Format:**
```
Title: {{VALUE:Title}}
Author: {{cursor:1}}
Date: {{DATE}}
Notes: {{cursor:2}}
```

**Expected**: Cursor jumps to first position (Author field)

### Test 4: With Different Capture Settings
Test the above with:
- ✅ Prepend
- ✅ Insert after
- ✅ Capture to different file (with "Open file" enabled)

## Template Choice Tests

### Test 1: Template with Cursor
**Template Content:**
```
---
created: {{DATE:YYYY-MM-DD}}
tags: 
---

# {{NAME}}

## Overview
{{cursor}}

## Notes
Created with QuickAdd
```

**Expected**: File created with cursor in Overview section

### Test 2: Template with Templater Cursor
**Template Content:**
```
# Daily Note {{DATE}}

## Tasks
- [ ] <% tp.file.cursor(1) %>

## Notes
<% tp.file.cursor(2) %>

Created: <% tp.date.now("HH:mm") %>
```

**Expected**: 
- Templater commands processed
- Cursor positioned at first cursor location
- Time shows correctly

## Key Features

1. **Automatic Conversion**: `<% tp.file.cursor() %>` → `{{cursor}}`
2. **Multiple Cursors**: `{{cursor:1}}`, `{{cursor:2}}` (jumps to lowest number)
3. **Works Everywhere**: Captures (all modes) and Templates
4. **Clean Syntax**: No more complex Templater syntax needed for cursors
5. **Full Compatibility**: Still processes all other Templater commands normally

## Testing Notes

- Cursor positioning requires file to be opened (enable "Open file" for captures to different files)
- Small delay (100ms) ensures file is ready before cursor jump
- Works with Templater's "Automatic jump to cursor" both ON and OFF