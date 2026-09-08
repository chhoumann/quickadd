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
import { existingNoteActionVerb } from "src/template/fileExistsPolicy";

import {
	buildDiscoveryCandidates,
	createTemplateNoteSelection,
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
				app: async () => {
					const result = await InputSuggester.Suggest(
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
						if (action !== "Open") el.querySelector(".suggestion-title")?.prepend(`${action}: `);
						return;
					}
					if (candidate.unresolvedTitle) {
						renderUnresolvedSuggestion(el, candidate.unresolvedTitle);
					}
				},
			},
					);
					return candidateByItem.has(result) ? decodeTemplateNoteSelection(result) : createTemplateNoteSelection(result);
				},
			});

		return resolveTemplateNoteSelection(app, selected);
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}
