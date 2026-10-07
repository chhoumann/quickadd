import type { TFile } from "obsidian";

/**
 * The note a top-level QuickAdd run was triggered from (issue #1429), captured
 * once at the outermost execution boundary, before any QuickAdd modal opens.
 * `{{FIELD:…|default-from:active}}` always reads it, so a macro that opens
 * another note still takes its default from the note the run started in.
 *
 * Every other read of the current note (capture to active file, append link,
 * `{{LINKCURRENT}}` and its siblings, `{{SELECTED}}`, same folder as current
 * file) reads it only when the caller named it with `current=` (see
 * `ChoiceExecutor.setCurrentFile`). Otherwise those reads follow the active
 * tab, so a macro step that opens a note hands it to the next step. Read the
 * current note through `utils/currentFile.ts`.
 *
 * Threaded via {@link IChoiceExecutor}, which the engines, {@link CompleteFormatter}
 * and {@link RequirementCollector} already hold.
 */
export interface QuickAddTriggerContext {
	/**
	 * The file active when the run started, or the file the caller named; `null`
	 * when there is none (no file was active, or `current=none`).
	 */
	activeFile: TFile | null;
	/** Set when the caller named the current note, so the run never reads the active tab for it. */
	named?: true;
}
