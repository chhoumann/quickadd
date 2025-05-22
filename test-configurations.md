# QuickAdd Templater Test Configurations

This document contains all the test configurations from the reported issues to verify our fix.

## Issue #801 Test Cases

### Configuration 1: Capture to specific file with Insert After disabled
**User**: jelleigh
**Capture Format**: 
```
{{VALUE:Task Name}} {{TEMPLATE:Templates/Tasks Tag.md}} {{VDATE: Scheduled Date,:hourglass_flowing_sand:YYYY-MM-DD}} {{VDATE:Due Date, :date: YYYY-MM-DD}} {{TEMPLATE:Templates/Tasks Priority.md}}
```

**Templates/Tasks Tag.md**:
```
<% tp.system.suggester(['#quick','#medium','#long'],['#quick','#medium','#long'],true,"Tag") %>
```

**Templates/Tasks Priority.md**:
```
<% tp.system.suggester([':small_red_triangle:',':arrow_double_up:',':arrow_up_small:',' ',':arrow_double_down:'],[':small_red_triangle:',':arrow_double_up:',':arrow_up_small:',' ',':arrow_double_down:'],true,"Priority") %>
```

**Settings to test**:
1. ❌ Capture to active file: **DESELECTED**
2. ❌ Insert after: **DESELECTED**
3. Define a folder or file for capture

### Configuration 2: Capture to active file with Insert After enabled
**Same capture format as above**

**Settings to test**:
1. ✅ Capture to active file: **SELECTED**
2. ✅ Insert after: **SELECTED**
3. Define line to insert after

### Configuration 3: Capture to active file with Insert After disabled (WORKING CASE)
**Same capture format as above**

**Settings to test**:
1. ✅ Capture to active file: **SELECTED**
2. ❌ Insert after: **DESELECTED**

## Issue #793 Test Case

### Configuration: Task capture with tp.date.now
**User**: a198h
**Capture Format**:
```
- [ ]  #t #ah {{VALUE: Task}} {{VALUE:🔼,⏫,🔽,🔺}} 📅 <% tp.date.now("YYYY-MM-DD", 0) %>
```

**Expected Result**:
```
- [ ]  #t #ah my task 🔼 📅 2025-05-22
```

**Settings to test**: Any capture configuration

## Issue #787 Test Cases

### Configuration 1: Capture to existing file with tp.file.title
**User**: executer9648
**Capture Format**:
```
([[<% tp.file.title %>]]) {{VALUE}} ⏳{{DATE:YYYY-MM-DD}}
```

**Settings**:
- Configure to capture to a constant/specific file
- Format as task: ✅

**Expected**: The `tp.file.title` should be replaced with the actual file title

### Configuration 2: Append to note
**User**: dmarcolongo
**Capture Format**: (Contains templater commands within `<% %>`)

**Settings**:
- Append to end of file
- Any file configuration

## Test Procedure

1. Create the template files mentioned above in your vault
2. Create QuickAdd capture choices with each configuration
3. Test each scenario and verify:
   - Templater commands execute properly
   - Suggesters appear when expected
   - Date commands are processed
   - File title references work
   - No raw templater code remains in the output

## Additional Test Scenarios

### Prepend Test
**Capture Format**:
```
<% tp.date.now() %> - {{VALUE:Note}}
```
**Settings**:
- Prepend: ✅
- Various file configurations

### Create File If It Doesn't Exist Test
**Capture Format with Templater**:
```
Created: <% tp.file.creation_date() %>
{{VALUE:Content}}
```
**Settings**:
- Create file if it doesn't exist: ✅
- Capture to a non-existent file path

## Expected Results for ALL Tests

✅ All templater commands should execute
✅ No raw `<% ... %>` syntax should remain
✅ Suggesters should appear when configured
✅ Variables like tp.file.title should resolve correctly
✅ Date functions should output formatted date