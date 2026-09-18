# Simplification validation

The requested 30% overall line reduction is **not achieved**. Measurements include new modules and fixtures; production, tests, and other tracked text are reported separately. No released feature was intentionally removed.

Run `python3 .audit/measure-lines.py e15ee783 HEAD` to reproduce the counts. The baseline includes 220,330 tracked text lines: 82,123 production, 112,632 tests, and 25,575 other. The measured code revision and machine-readable verification results are in `evidence.json`.

## Structural changes

- CLI registration delegates parsing, inspection, and execution to focused modules. CLI and interactive execution share outcome translation; URI callbacks retain their separate error-redaction contract.
- Script API modules own prompts, input forms, AI, and field suggestions. AI prompt variants share configuration and result assignment.
- Formatter stages share global expansion, date/current-file tokens, preview policy, vault prompts, and ordered capture insertion. Evaluation order and generated-token semantics remain explicit.
- Engines share capture candidate construction, template preparation, and file completion actions. Capture commits return their effect and valid cursor together. User scripts return output from invocation-local execution.
- Prompt components share lifecycle code. Settings definitions and choice actions are separate from rendering. Live getters preserve state across asynchronous UI actions.
- File suggestions share metadata and ranking. Package services separate validation, traversal, assets, and remapping. AI separates chunking, transport policy, progress, and request logs.

`ARCHITECTURE.md` maps entrypoints and ownership. Some substantial modules remain, notably CaptureChoiceEngine. This PR does not claim that every large file has been eliminated.

## Behavior and tests

Original build, lint, and Svelte checks passed. Baseline unit coverage ran 5,499 tests successfully, with 37 skipped. The original built plugin passed all 92 native tests after correcting two existing native fixtures: sandbox path handling in the GPS package suite, and the date-capture test's ineffective clock override.

The final results are recorded in `evidence.json`. Coverage percentages are reported alongside their denominators because refactoring changes the instrumented code. Higher coverage alone does not establish equivalence.

Test consolidation preserves runtime assertions and uses shared fixtures. Seven formatter suites, four engine suites, six migration cases, and the standalone property pipeline now call production implementations. Two obsolete property simulators were replaced with production-backed assertions, including six opt-in performance cases. Thirty-two excluded package tests were removed after mapping their behavior to active suites; two distinct dependency compositions were retained as active tests.

An independent reviewer demonstrated that the initial replacement engine fixture could hide deleted YAML through a stale property cache. The corrected fixture parses actual stored YAML using a development-only codec, and a mutation regression verifies that overwriting or removing YAML changes the observed properties.

Native verification used Obsidian 1.13.7 in this worktree's isolated vault. It covers prompt forms, property widgets, hotkeys and direct execution, template discovery, capture, packages, macros, collision handling, tab reuse, and formatting. Live external AI providers were not exercised. The opt-in performance tests were run separately during fixture consolidation; they are skipped in the ordinary full suite.

## Adjacent fixes

- YAML context now treats its range end as exclusive. A helper probe in native Obsidian changed `isInYaml` from true to false for a token immediately after frontmatter; the public formatting result remained unchanged in that probe.
- Package validation and preview now use the same legacy macro reader as import. A real pasted package containing an array-valued macro previously showed zero scripts and enabled import. It now shows the script and missing-file warnings and requires acknowledgement. This inconsistency existed in the baseline source.

No settings migration or schema change is required. Plugin manifest and versions files are unchanged. Generated bundles were rebuilt and remain ignored according to repository policy. The only added dependency is `yaml` for test fixtures.

## Independent review

Three reviewers covered core execution, UI and prompts, and external boundaries. A different model also reviewed the decision trail. Accepted findings included the stale YAML fixture, legacy macro traversal, stale source-test references, whitespace, and missing evidence records. The user-script inheritance criticism led to invocation-local execution. Existing protected folder and capture-target helpers remain grouped in focused base classes; that coupling is a known architectural limit.

The final core review also exercised capture commit ordering, failures, no-op writes, and cursor validity through ten independent probes. No confirmed production regression remained in the reviewed core changes.

## Native screenshots

The settings layout was visually checked before and after. No automated pixel-equality claim is made.

![Settings after refactor](https://files.bagerbach.com/settings-after-h1lt6c3b2x3l.png)

![Legacy macro script warning](https://files.bagerbach.com/legacy-package-after-vypdw28tcnqs.png)
