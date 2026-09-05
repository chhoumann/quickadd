import type { App } from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import {
	routePrompt,
	type PromptRoutingContext,
} from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { renderNotePathSuggestion } from "src/gui/InputSuggester/renderNotePathSuggestion";
import { isCancellationError } from "src/utils/errorUtils";
import { UserCancelError } from "src/errors/UserCancelError";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";

export {
	shouldRunTemplateNoteDiscovery,
	usesDefaultTemplateTitlePrompt,
} from "src/utils/templateNoteDiscoveryEligibility";

export {
	buildDiscoveryCandidates,
	decodeTemplateNoteSelection,
	selectionForDiscoveryCandidate,
	resolveTemplateNoteSelection,
	testExports,
} from "src/utils/templateNoteDiscovery";
export type { DiscoveryCandidate, TemplateNoteDiscoveryResult, TemplateNoteSelection } from "src/utils/templateNoteDiscovery";
import {
	buildDiscoveryCandidates,
	decodeTemplateNoteSelection,
	resolveTemplateNoteSelection,
	normalizedKey,
	type TemplateNoteDiscoveryResult,
} from "src/utils/templateNoteDiscovery";

function renderUnresolvedSuggestion(el: HTMLElement, title: string): void {
	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });
	content.createDiv({ cls: "suggestion-title", text: title });
	content.createDiv({ cls: "suggestion-note", text: "Unresolved link" });
}

function renderExistingSuggestion(
	el: HTMLElement,
	path: string,
	alias?: string,
): void {
	renderNotePathSuggestion(el, path);
	if (!alias) return;

	const content = el.querySelector(".suggestion-content");
	content?.createDiv({ cls: "suggestion-note", text: `Alias: ${alias}` });
}

export async function promptForTemplateNoteDiscovery(
	app: App,
	choice: ITemplateChoice,
	executor: PromptRoutingContext,
): Promise<TemplateNoteDiscoveryResult> {
	const { candidates, existingKeys } = buildDiscoveryCandidates(app, choice);
	const candidateByItem = new Map(
		candidates.map((candidate) => [candidate.item, candidate]),
	);

	const placeholder = `Search notes or create ${choice.name}`;

	try {
		const selected = String(
			await routePrompt(executor, {
				// This picker is the one the one-page preflight deliberately does NOT
				// pre-collect (it filters the `value` requirement out for discovery), so
				// before this an interactive run collected nothing and walked straight
				// into a desktop list of every note in the vault (#1614).
				remote: (provider) =>
					promptEngineChoice(provider, {
						items: candidates.map((candidate) => ({
							value: candidate.item,
							title: candidate.title,
						})),
						placeholder,
						// "Create new note" - the whole point of the picker.
						allowCustomInput: true,
						what: "the note-discovery picker",
					}),
				// A headless run never reaches here: `shouldRunTemplateNoteDiscovery`
				// needs an unresolved `value`, which the CLI refuses up front as a
				// missing input. Guarded anyway, so the branch cannot become a hang.
				headless: () => {
					throw new ChoiceAbortError(
						`'${choice.name}' needs to ask which note to open or create, but this run is non-interactive. ` +
							`Pass the note name (e.g. value-value=<name>), or re-run with the ui flag.`,
					);
				},
				app: () =>
					InputSuggester.Suggest(
			app,
			candidates.map((candidate) => candidate.display),
			candidates.map((candidate) => candidate.item),
			{
				placeholder,
				allowCustomValue: true,
				customValueLabel: (value) => `Create new note: ${value}`,
				valueExists: (value) => {
					const key = normalizedKey(value);
					return (
						existingKeys.has(key) ||
						candidates.some(
							(candidate) =>
								candidate.unresolvedTitle &&
								normalizedKey(candidate.unresolvedTitle) === key,
						)
					);
				},
				renderItem: (item, el) => {
					const candidate = candidateByItem.get(item);
					if (!candidate) return;
					if (candidate.renderPath) {
						renderExistingSuggestion(
							el,
							candidate.renderPath,
							candidate.renderAlias,
						);
						return;
					}
					if (candidate.unresolvedTitle) {
						renderUnresolvedSuggestion(el, candidate.unresolvedTitle);
					}
				},
			},
					),
			}),
		);

		return resolveTemplateNoteSelection(app, decodeTemplateNoteSelection(selected));
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}
