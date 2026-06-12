# Beta Flag Graduation Decision (spike)

> Status: PROPOSAL - requires maintainer sign-off. No code changed by this spike.
> Planned at commit 71d6ed71, 2026-06-12.

## Summary table

| Flag | Shipped | Months in Beta | Recommendation |
|------|---------|----------------|----------------|
| onePageInputEnabled | 2025-08-08 (#888) | ~10 | Keep Beta with named exit criteria |
| enableTemplatePropertyTypes | 2025-10-03 (#932) | ~8 | Keep Beta with named exit criteria |

Tracker search note: the local `gh` version rejected the plan's literal
`--state all` flag value, so searches were rerun without a state filter. Results
included open and closed issues.

## onePageInputEnabled

### Known edge cases (with sources)

- `{{FIELD:...}}` values must be keyed as `FIELD:<specifier>` during collection
  and modal submit, or the runtime formatter prompts twice. Sources:
  `src/preflight/RequirementCollector.test.ts:222`,
  `src/preflight/OnePageInputModal.test.ts:374`, issue #1184.
- Labeled dropdown `{{VALUE:option-a,option-b|label:Pick one}}` tokens need
  raw-value preservation and stale-value normalization. Sources:
  `src/preflight/OnePageInputModal.test.ts:298`,
  `src/preflight/suggesterValueMapping.test.ts:39`, issue #1180.
- Date inputs have several fallback paths: natural-language preview, internal
  `@date:ISO` storage, required blank dates falling back to the sequential
  prompt, optional blank dates staying empty, and invalid optional date text
  falling back instead of silently becoming empty. Sources:
  `docs/docs/Advanced/onePageInputs.md:25`,
  `docs/docs/Advanced/onePageInputs.md:33`,
  `src/preflight/OnePageInputModal.test.ts:495`, issues #1178 and #1026.
- Optional fields are variable-level, not occurrence-level: a field is optional
  only when every occurrence is flagged. Optional dropdowns get a skip entry but
  keep the first real option selected by default. Sources:
  `docs/docs/Advanced/onePageInputs.md:33`,
  `src/preflight/RequirementCollector.test.ts:255`,
  `src/preflight/OnePageInputModal.test.ts:413`, issue #1259.
- Macro support is deliberately partial. User scripts can expose static
  `quickadd.inputs`, malformed entries are ignored, inspection failures log a
  warning, and importing modules for metadata can execute top-level code.
  Sources: `docs/docs/Advanced/onePageInputs.md:14`,
  `docs/docs/Advanced/onePageInputs.md:188`,
  `src/preflight/collectChoiceRequirements.test.ts:91`.
- Capture and template discovery has path-specific behavior: capture folder
  paths ending in `.md` normalize to folders, tokenized capture paths do not add
  the internal target-file dropdown, and `.base` template references must not be
  forced to `.md`. Sources:
  `src/preflight/collectChoiceRequirements.test.ts:210`,
  `src/preflight/runOnePagePreflight.selection.test.ts:181`.

### Default-on blast radius

Flipping `onePageInputEnabled` to `true` changes the default input UX for every
Template, Capture, and Macro choice that does not opt out. The gate is global
plus per-choice override: `src/choiceExecutor.ts:42` reads
`settingsStore.getState().onePageInputEnabled`, `src/choiceExecutor.ts:45` enables
preflight when the override is `"always"` or the global flag is enabled, and
`src/choiceExecutor.ts:47` applies it to Template/Capture/Macro choices.
`src/types/choices/IChoice.ts:8` allows a choice-level `"always"` or `"never"`
override, but default-config users do not set that override. The flip would also
make the one-page path the default foundation for optional prompts (#1259), while
the docs still call Macro support partial (`docs/docs/Advanced/onePageInputs.md:14`).

### Recommendation

Keep Beta with named exit criteria. Do not retire it: #1259 already builds on the
subsystem, and the tracker shows real user demand for one-page prompt UX. Do not
promote it yet: the recent closed bugs #1178, #1180, #1184, and #1259 show that
the feature is still absorbing edge cases, and open issue #1299 asks for prompt
ordering control immediately before this spike.

Exit criteria:

- Resolve or explicitly defer #1299 with a documented ordering policy.
- Ship at least one release after #1259 with no new one-page-input bug reports.
- Add an Obsidian-verifiable regression path for Template, Capture, and the
  documented partial Macro path that covers `FIELD`, labeled dropdowns,
  optional VALUE, optional VDATE, invalid-date fallback, selection-as-value, and
  `.base` template scanning.
- Prepare a release-note and migration note that tells users how to keep the old
  sequential prompt behavior with the per-choice `"never"` override before any
  default flip.

### Open questions

- Is partial Macro support acceptable for a global default, or should promotion
  be limited to Template and Capture until script input discovery is complete?
- Should default-on preserve existing choices as sequential by migration and only
  enable one-page inputs for new choices/new installs?
- What is the expected prompt ordering contract when requirements come from file
  names, nested templates, capture targets, and script metadata?

## enableTemplatePropertyTypes

### Known edge cases (with sources)

- The flag changes collection and post-processing behavior: disabled mode does
  not collect `templatePropertyVars`, enabled mode does, and post-processing only
  runs when the flag is on. Sources:
  `src/engine/template-property-types-feature-flag.test.ts:62`,
  `src/engine/template-property-types-integration.test.ts:479`.
- `processFrontMatter` and YAML parsing errors must not fail file creation; they
  are logged and the file remains created, possibly without structured property
  formatting. Sources:
  `src/engine/template-property-types-feature-flag.test.ts:138`,
  `src/engine/template-property-types-integration.test.ts:449`,
  `src/engine/QuickAddEngine.ts:297`.
- Structured values include circular references, very large arrays/maps, null,
  undefined, nested objects, arrays, special characters, and Unicode. Sources:
  `src/engine/template-property-types-feature-flag.test.ts:163`,
  `src/engine/template-property-types-feature-flag.test.ts:220`,
  `src/engine/template-property-types-feature-flag.test.ts:303`.
- Dates use `@date:` sentinel strings and must convert valid ISO values while
  leaving invalid or empty date sentinels unchanged. Sources:
  `src/engine/template-property-types-integration.test.ts:503`,
  `src/engine/template-property-types-integration.test.ts:568`,
  `src/engine/template-property-types-integration.test.ts:604`.
- Arrays, objects, primitives, and Obsidian property-type metadata change the
  final YAML shape, including list handling for `multitext`, `tags`, and `list`
  properties versus scalar handling for text/number/checkbox/date/datetime.
  Sources: `docs/docs/TemplatePropertyTypes.md:112`,
  `docs/docs/TemplatePropertyTypes.md:125`,
  `docs/docs/TemplatePropertyTypes.md:280`,
  `src/engine/template-property-types-integration.test.ts:644`.
- Tracker history includes property/YAML regressions and demand: #972 reported a
  tags array spacing bug, #1140 reported list properties with links, #1077
  reported front matter not being added after an Obsidian update, and #757
  remains an open compatibility request for Obsidian property types.

### Default-on blast radius

Flipping `enableTemplatePropertyTypes` to `true` changes on-disk YAML output for
existing templates that currently rely on string-only substitution. The gate is
read by `src/formatters/completeFormatter.ts:411`, but the effect runs through
formatter collection (`src/formatters/formatter.ts:313`), Template choice file
creation/overwrite before Templater (`src/engine/TemplateEngine.ts:532` and
`src/engine/TemplateEngine.ts:554`), Capture choices that create files from
templates (`src/engine/CaptureChoiceEngine.ts:741` and
`src/engine/CaptureChoiceEngine.ts:759`), and the shared front matter
post-processing path (`src/engine/QuickAddEngine.ts:258`). The settings copy
explicitly says arrays become List properties, numbers become Number properties,
and booleans become Checkbox properties (`src/quickAddSettingsTab.ts:207`), so
the migration risk is not only UI behavior; it is persisted file content.

### Recommendation

Keep Beta with named exit criteria. Do not retire it: the docs describe a clear
goal for native Obsidian property support, issue #757 requests that direction,
and the tests cover substantial behavior. Do not promote it yet: a default flip
would alter YAML for existing templates, and the tracker still contains
frontmatter/list/property compatibility issues that should become explicit
promotion gates.

Exit criteria:

- Add or confirm regression coverage for #972 tags array spacing, #1140 list
  properties with links, #1077 front matter creation behavior, date sentinel
  conversion, invalid-date preservation, and Capture-created files with fresh
  templates.
- Run at least one release with no new `property type`, `front matter`,
  `frontmatter`, or `YAML` regressions after those cases are covered.
- Write a release-note compatibility section before promotion that states the
  default flip changes persisted YAML shape and names the opt-out/rollback path.
- Decide whether existing installs should keep their current disabled value while
  only new installs become default-on, or whether the default flip applies to all
  users without a migration.

### Open questions

- What backward-compatibility policy should protect users who intentionally
  relied on string output in front matter?
- Should promotion wait for explicit Obsidian-version coverage of property
  metadata, especially list, tags, date, datetime, and links?
- Should the follow-up plan include a migration prompt or only a release-note
  callout?

## Maintenance cost of the status quo

Leaving both flags in limbo keeps QuickAdd on dual behavior paths. One-page
inputs has a dedicated `src/preflight/` subsystem with tests for collection,
modal behavior, selection prefill, suggester mapping, capture targets, and script
metadata. Template property types has dedicated flag-on/flag-off suites in
`src/engine/template-property-types-feature-flag.test.ts` and
`src/engine/template-property-types-integration.test.ts`. Every Template/Capture
change that touches prompting, formatting, capture targets, front matter, or file
creation has to be reasoned about with both default-off and flag-on behavior.

The cost is compounding because #1259 optional/skippable prompts builds on the
one-page-inputs subsystem. Any promote recommendation requires maintainer
sign-off, a release-notes callout, and a separate follow-up plan. This spike does
not flip `src/settings.ts`, does not relabel the settings UI, and does not change
source defaults.

## Decision needed from maintainer

- Approve, revise, or reject the recommendation to keep `onePageInputEnabled` in
  Beta with the named exit criteria above.
- Approve, revise, or reject the recommendation to keep
  `enableTemplatePropertyTypes` in Beta with the named exit criteria above.
- If either flag should be promoted anyway, authorize a separate follow-up plan
  that changes the default, updates the Beta labels/docs, and ships release notes
  instead of bundling that implementation into this spike.
