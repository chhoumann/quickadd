import type { App } from "obsidian";
import { TemplateNoteDiscoveryModal } from "src/gui/TemplateNoteDiscoveryModal";
import {
	routePrompt,
	type PromptRoutingContext,
} from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { isCancellationError } from "src/utils/errorUtils";
import { UserCancelError } from "src/errors/UserCancelError";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { existingNoteActionVerb } from "src/template/fileExistsPolicy";

import {
	buildDiscoveryCandidates,
	createTemplateNoteSelection,
	decodeTemplateNoteSelection,
	resolveTemplateNoteSelection,
	type TemplateNoteDiscoveryResult,
} from "src/utils/templateNoteDiscovery";

export async function promptForTemplateNoteDiscovery(
	app: App,
	choice: ITemplateChoice,
	executor: PromptRoutingContext,
): Promise<TemplateNoteDiscoveryResult> {
	const { candidates } = buildDiscoveryCandidates(app, choice);

	const placeholder = `Search notes or create ${choice.name}`;
	const action = existingNoteActionVerb(choice.existingNoteAction);

	try {
		const selected = await routePrompt(executor, {
			remote: async (provider) => {
				const result = await promptEngineChoice(provider, {
					items: candidates.map((candidate) => ({
						value: decodeTemplateNoteSelection(candidate.item),
						title: candidate.renderPath && action !== "Open" ? `${action}: ${candidate.title}` : candidate.title,
					})),
					placeholder,
					// "Create new note" - the whole point of the picker.
					allowCustomInput: true,
					what: "the note-discovery picker",
				});
				return typeof result === "string" ? createTemplateNoteSelection(result) : result;
			},
			// A headless run never reaches here: `shouldRunTemplateNoteDiscovery`
			// needs an unresolved `value`, which the CLI refuses up front as a
			// missing input. Guarded anyway, so the branch cannot become a hang.
			headless: () => {
				throw new ChoiceAbortError(
					`'${choice.name}' needs to ask which note to open or create, but this run is non-interactive. ` +
						`Pass the note name (e.g. value-value=<name>), or re-run with the ui flag.`,
				);
			},
			app: () => new TemplateNoteDiscoveryModal(app, choice, candidates).promise,
		});

		return resolveTemplateNoteSelection(app, selected);
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}
