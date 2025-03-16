# Error Handling Improvement Plan

## Design Decisions

1. **Standardize Error Types**
   - Use `unknown` as the base type for all error parameters
   - Ensure consistent error object handling throughout codebase

2. **Error Logging Architecture**
   - Maintain logger facade pattern but with Error-first approach
   - Preserve original error objects and stack traces end-to-end
   - Implement memory-safe error storage

3. **UI/Console Consistency**
   - Ensure errors display consistently in both console and UI
   - Add structured error data to Obsidian notices where possible

## Todo List

### Phase 1: Core Error Handling Infrastructure

- [x] Update `QuickAddError` interface to store stack traces and original errors
- [x] Modify `LogManager` to accept and propagate Error objects
- [x] Update console logging to leverage Chrome DevTools error display
- [x] Add `toError` utility function for standardized error conversion
- [x] Add JSDoc comments to new error handling functions
- [x] Create ErrorUtils.ts with standardized error handling functions

### Phase 2: Systematic Codebase Updates

- [ ] Scan and update all try/catch blocks in:
  - [x] Engine directory
  - [x] Formatters directory
  - [ ] Main application code
  - [ ] Macros and command execution
- [ ] Standardize error patterns using ErrorUtils helper functions
- [ ] Update GuiLogger to display rich error information in Obsidian notices
- [ ] Add warning notices for deprecated error logging patterns

### Phase 3: Testing and Documentation

- [ ] Add comprehensive error handling tests:
  - [ ] Test stack trace preservation
  - [ ] Test various error types (Error, string, unknown)
  - [ ] Test error propagation across boundaries
- [ ] Add memory leak tests for error storage
- [ ] Update developer documentation with error handling guidelines

### Phase 4: Performance Optimization

- [x] Implement error log size limits
- [ ] Add WeakRef for original error objects to prevent memory leaks
- [ ] Optimize stack trace generation for performance-critical paths
- [ ] Add error sampling for high-frequency error scenarios

### Phase 5: User Experience Improvements

- [ ] Improve error reporting in Obsidian UI:
  - [ ] Add stack trace collapsible section to error notices
  - [ ] Create error reporting mechanism for users
  - [ ] Add debugging mode toggle for detailed error information
- [ ] Add better visualization for template/macro errors

## Implementation Guidelines

1. **Error Conversion Standard**
   ```typescript
   // Always use this pattern in catch blocks
   try {
     // operation
   } catch (err) {
     log.logError(ErrorUtils.toError(err, "Context message"));
   }
   ```

2. **Error Display Guidelines**
   - Console: Show full stack trace with clickable frames
   - UI Notices: Show error message with expandable details
   - Error Logs: Store full context including original error

3. **Memory Management**
   - Limit error log to last 100 entries
   - Use WeakRef for original error objects
   - Clear error log on plugin unload