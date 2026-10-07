import type { TFile } from "obsidian";

/**
 * The note a top-level QuickAdd run treats as current (issue #1429). Captured
 * once at the outermost execution boundary, before any QuickAdd modal opens or
 * a Template choice creates and opens a new note, so every read of the current
 * note (capture to active file, append link, `{{LINKCURRENT}}` and its
 * siblings, `{{SELECTED}}`, `default-from:active`) sees the note that triggered
 * the run, not whatever is active by the time it resolves. The CLI names it
 * with `current=` instead (see `ChoiceExecutor.setCurrentFile`). Read it
 * through `utils/currentFile.ts`.
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
}
