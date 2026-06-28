import type { TFile } from "obsidian";

/**
 * A snapshot of the editor context at the moment a top-level QuickAdd choice
 * began executing (issue #1429). Captured once at the outermost execution
 * boundary — before any QuickAdd modal/suggester opens or a Template choice
 * creates and opens a new note — so context-derived format tokens read the note
 * that *triggered* the run rather than whatever happens to be active by the time
 * the token resolves.
 *
 * Threaded via {@link IChoiceExecutor}, which both {@link CompleteFormatter} and
 * {@link RequirementCollector} already hold, so every FIELD resolution path
 * (runtime and one-page preflight) can reach it without extra plumbing.
 */
export interface QuickAddTriggerContext {
	/**
	 * The file active when the run started, or `null` when no file (or a
	 * non-Markdown view such as a Canvas/PDF/graph leaf) was active. Used by
	 * `{{FIELD:<field>|default-from:active}}` to read the active note's current
	 * frontmatter property as the prompt's default.
	 */
	activeFile: TFile | null;
}
