## One-Page Input UI for QuickAdd

### Objectives
- **Pre-resolve all QuickAdd variables** before any execution.
- **Present a single, dynamic form** for all inputs with previews/suggestions/defaults.
- **Integrate cleanly with Template and Capture choices** first; provide a path for Macros.
- **Retain backward compatibility** by falling back to current step-by-step prompting when needed.

### What we must pre-resolve
- **QuickAdd format syntax**:
  - VALUE/NAME: `{{VALUE}}`, `{{NAME}}`
  - Named variables (with defaults/options): `{{VALUE:author}}`, `{{VALUE:status|Open}}`, `{{VALUE:low,medium,high}}`
  - Date variables: `{{VDATE:due, YYYY-MM-DD}}`, `{{VDATE:due, YYYY-MM-DD|tomorrow}}`
  - Field variables with filters: `{{FIELD:project|folder:Projects|tag:#active|inline:true|default:In Progress}}`
  - Random, selected, clipboard, time/date, title (previews only)
  - Template inclusion: `{{TEMPLATE:path}}` (scan included templates too)
  - Inline JS code blocks (do not execute; treat as opaque during preflight)
  - Macros `{{MACRO:name}}` (best-effort only; see caveats)
- **Choice-pathing inputs**:
  - Template Choice: file name format, folder choice (when enabled)
  - Capture Choice: capture target path (folder/tag mode needs a file pick), capture content

### Core approach
- Add a **preflight stage** that collects all variable requirements across the choice before rendering any prompt.
- Generate a **dynamic one-page GUI** from that requirement set (our schema).
- On submit, **set everything into** `ChoiceExecutor.variables` and run the choice engines normally (they won’t prompt).

### Architecture
- **RequirementCollector** (new, subclass of `Formatter`)
  - Overrides:
    - `promptForValue`, `promptForVariable`, `promptForMathValue`, `suggestForField`, `getSelectedText`, `getClipboardContent`
  - Behavior: record a `FieldRequirement` instead of prompting; return a harmless placeholder to keep scanning
  - Supports:
    - Named variables with default/options
    - VDATE variables with `dateFormat`/default
    - FIELD variables with parsed filters (via `FieldSuggestionParser`)
  - Traversal:
    - Template Choice: scan file name format, folder paths needing formatting, and template content (and recursively any `{{TEMPLATE:...}}` inside)
    - Capture Choice: scan `captureTo` and capture content (via `CaptureChoiceFormatter` logic without prompting). If `captureTo` resolves to folder/tag mode, collect a “file selection” requirement and precompute suggestions using existing utilities.
  - Macro Choice (phase 2+):
    - Best-effort: find nested Template/Capture commands and preflight them
    - Skip executing user scripts/macros; we cannot safely introspect them. Fall back to runtime prompts if they ask for inputs.

### Dynamic form schema
- Reuse/extend our settings UI patterns into a general-purpose modal:
  - FieldSpec:
    - `id` (variable key), `label`, `type`: text | textarea | dropdown | toggle | date | field-suggest | format-preview
    - `defaultValue`, `placeholder`, `description`
    - `options` (for dropdown), `suggester` (async, e.g., FIELD variables and file pickers)
    - Preview hooks (e.g., date format live preview)
  - Deduplicate variables by name across all scanned sources
  - Pre-fill from `ChoiceExecutor.variables` (URI parameters, previous values)
  - Grouping: General (VALUE/NAME), Variables, Dates, Fields, Capture/Template targets

### One-page input modal (new)
- Built with Obsidian `Modal` + `Setting`, like `UserScriptSettingsModal`.
- Controls:
  - Respect `settings.inputPrompt` for single-line vs multi-line inputs
  - Named variables: text or dropdown (when comma list detected), with "Custom…" fallback
  - VDATE: text input + live preview (reuse `VDateInputPrompt` logic)
  - FIELD: text input with `InputSuggester`, using filters and cache
  - Capture target file picker dropdown for folder/tag modes
  - Optional preview panel (e.g., formatted file name) via `FormatDisplayFormatter`
- Validation: required fields, defaults honored, sensible fallbacks
- On submit: returns a `Record<string, unknown>` to merge into `ChoiceExecutor.variables`

### Integration flow
- Add a plugin setting: **“One-page input for choices”** (on/off, default off)
- In `ChoiceExecutor.execute`:
  - If enabled and choice is Template or Capture:
    1) Run preflight (RequirementCollector)
    2) Show modal (One-page input)
    3) Merge results into `this.variables`
    4) Execute engine
  - Macro: initially off by default; optional later with caveats (no user script pre-collection)
  - Multi Choice: skip for now (selection is dynamic)

### Important details
- **Defaults and options**:
  - `{{VALUE:name|default}}` is prefilled; if left empty, use default.
  - `{{VALUE:low,medium,high}}` renders dropdown; allow a "Custom…" text fallback.
- **VDATE**:
  - Prompt with preview and store canonical `@date:ISO` in `variables` (same as current), format at runtime.
- **FIELD variables**:
  - Use same collection/filter logic and cache as `CompleteFormatter.suggestForField`.
  - Respect filters (folder, tags, inline, defaults, case sensitivity, exclusions).
- **Capture target file**:
  - For folder/tag mode, present a searchable list of candidate files.
- **Template inclusion**:
  - Recursively scan included templates; track visited paths to avoid loops.
- **Macros & inline JS**:
  - Do not execute during preflight. Fall back to runtime prompts when unknowns arise.

### Performance and safety
- Scan only files referenced by the choice (template files, included templates)
- FIELD suggestions use batched vault scanning + cache
- Safeguards against template recursion loops

### Testing
- Unit tests for RequirementCollector:
  - Extracting variables from file name, folder paths, template content (incl. nested templates)
  - VDATE parsing and preview capture
  - FIELD filters producing expected suggestion sources
- Integration tests:
  - Template choice with one-page inputs replacing prompts
  - Capture choice with folder/tag mode file picker
  - Fallbacks when inputs left blank and defaults present

### Phased delivery
- **Phase 1**: Template/Capture choices; one-page modal; preflight collector; setting toggle
- **Phase 2**: Macro best-effort preflight for nested QuickAdd variables (skip user scripts)
- **Phase 3**: Live previews for more contexts and richer field types
- **Phase 4**: Optional per-choice “always use one-page” override

---

### Progress checklist
- [ ] Add plugin setting: "One-page input for choices"
- [ ] Implement RequirementCollector (Formatter subclass)
- [ ] Template Choice preflight: filename, folder(s), template content, nested templates
- [ ] Capture Choice preflight: captureTo (file/folder/tag), content; file picker when needed
- [ ] Build OnePageInputModal with dynamic schema
- [ ] VDATE control with live preview (reuse logic)
- [ ] FIELD variable suggester integration
- [ ] Merge results into `ChoiceExecutor.variables`
- [ ] Execute engines without further prompts when possible
- [ ] Tests: RequirementCollector unit tests
- [ ] Tests: Template/Capture integration tests
- [ ] (Optional) Macro best-effort preflight (Phase 2)
- [ ] (Optional) Per-choice override and richer previews (Phase 3-4)
