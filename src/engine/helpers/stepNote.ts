import { TFile, type App } from "obsidian";
import { refuse } from "../../errors/RefusalError";
import { CompleteFormatter } from "../../formatters/completeFormatter";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { log } from "../../logger/logManager";
import { getQuickAddInstance } from "../../quickAddInstance";
import type IChoice from "../../types/choices/IChoice";
import type { ChoiceChain } from "../choiceChain";
import { isRunNoteToken } from "../CaptureTargetEngine";

export interface StepNoteContext {
	app: App;
	executor: IChoiceExecutor;
	/** The macro or action the step belongs to: it names the prompts and their drafts. */
	choice: Pick<IChoice, "id" | "name">;
	chain: ChoiceChain;
}

/**
 * The note a step works on: the run note for `{{NOTE}}`, which refuses with
 * `consequence` before any note is written, else the note at the formatted
 * `path`. Null, with the reason logged under `label`, when the path names no
 * note. `scope` keeps the drafts of a `{{VALUE}}` in the path apart per step.
 */
export async function resolveStepNote(
	{ app, executor, choice, chain }: StepNoteContext,
	path: string,
	{ scope, label, consequence }: { scope: string; label: string; consequence: string },
): Promise<TFile | null> {
	if (isRunNoteToken(path)) {
		if (!executor.runNote) throw refuse("nothing has written a note yet", consequence);
		return executor.runNote;
	}
	const formatter = new CompleteFormatter(app, getQuickAddInstance(), executor);
	formatter.setPromptRunContext({ choiceName: choice.name, draftScopeId: `${choice.id}#${scope}` });
	formatter.choiceChain = chain;
	const normalizedPath = (await formatter.formatFileName(path, "filePath")).replace(/\\/g, "/");

	// Only a literal '..' segment or an empty one (from '//') is a traversal or
	// a malformed path; a file name may contain "..". The leading slash of an
	// absolute path and a single trailing slash are allowed.
	const segments = normalizedPath.split("/");
	const hasTraversal = segments.some(
		(segment, index) =>
			segment === ".." || (segment === "" && index !== 0 && index !== segments.length - 1),
	);
	if (hasTraversal) {
		log.logError(`${label}: Path traversal not allowed in '${normalizedPath}'`);
		return null;
	}

	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(file instanceof TFile)) {
		log.logError(`${label}: '${normalizedPath}' does not exist or is not a file`);
		return null;
	}
	return file;
}
