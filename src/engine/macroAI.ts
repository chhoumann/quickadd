import type { App } from "obsidian";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceChain } from "./choiceChain";
import type { IAIAssistantCommand } from "../types/macros/QuickCommands/IAIAssistantCommand";
import { runAIAssistant } from "../ai/AIAssistant";
import { resolveProviderApiKey } from "../ai/providerSecrets";
import { settingsStore } from "../settingsStore";
import { CompleteFormatter } from "../formatters/completeFormatter";
import { getQuickAddInstance } from "../quickAddInstance";
import { resolveModel, type ResolvedModel } from "../ai/aiHelpers";
import { activeModelRef, sortModelsForDisplay } from "../ai/Provider";
import { isCancellationError } from "../utils/errorUtils";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import { onlineFeaturesOffRefusal, unknownModelRefusal } from "../ai/aiRefusals";
import { refuse } from "../errors/RefusalError";

export async function executeMacroAI(
	app: App, choice: IMacroChoice, executor: IChoiceExecutor, chain: ChoiceChain,
	command: IAIAssistantCommand, chooseModel: () => Promise<ResolvedModel>,
) {
	if (settingsStore.getState().disableOnlineFeatures) {
		throw onlineFeaturesOffRefusal();
	}

	const aiSettings = settingsStore.getState().ai;

	let resolved: ResolvedModel | undefined;
	if (command.model === "Ask me") {
		resolved = await chooseModel();
	} else {
		// Prefer the pinned provider-scoped ref — but only while it matches
		// the legacy string (a stale ref from a downgrade edit must not
		// override the visible selection). Bare names resolve first-match,
		// as they always have.
		resolved = resolveModel(
			activeModelRef(command.model, command.modelRef) ?? command.model,
		);
		if (!resolved) {
			throw unknownModelRefusal(command.model);
		}
	}

	const { model, provider: modelProvider } = resolved;

	const formatter = new CompleteFormatter(
		app,
		getQuickAddInstance(),
		executor
	);
	// Same run context every other prompt surface gets (issue #1546): a
	// {{VALUE}} inside the AI prompt template names the choice that is asking
	// instead of prompting generically. Scoped per command id, like
	// executeOpenFile below: a macro can hold several AI commands, and their
	// prompts must not share one draft.
	formatter.setPromptRunContext({
		choiceName: choice?.name,
		draftScopeId: `${choice?.id ?? "macro"}#aiAssistant:${command.id}`,
	});
	formatter.choiceChain = chain;

	const apiKey = await resolveProviderApiKey(app, modelProvider);

	const aiOutputVariables = await runAIAssistant(
		app,
		{
			apiKey,
			model,
			provider: modelProvider,
			outputVariableName: command.outputVariableName,
			promptTemplate: command.promptTemplate,
			promptTemplateFolder: aiSettings.promptTemplatesFolderPath,
			systemPrompt: command.systemPrompt,
			showAssistantMessages: aiSettings.showAssistant,
			modelOptions: command.modelParameters,
			interactive: executor.interactive,
			promptProvider: executor.promptProvider,
		},
		async (input: string) => {
			return formatter.formatFileContent(input);
		}
	);

	for (const key in aiOutputVariables) {
		executor.variables.set(key, aiOutputVariables[key]);
	}
}

/**
 * The "Ask me" model picker. Entries are provider-scoped so two providers
 * serving the same model name are distinguishable — picking from a flat
 * name list would silently first-match, defeating the point of asking.
 */
export async function pickMacroModel(app: App, executor: IChoiceExecutor): Promise<ResolvedModel> {
	const providers = settingsStore.getState().ai.providers;
	const entries: { label: string; qualified: string; resolved: ResolvedModel }[] =
		providers.flatMap((provider) =>
			sortModelsForDisplay(provider.models).map((model) => ({
				label: `${model.name} (${provider.name}${model.deprecated ? ", retired" : ""})`,
				qualified: `${provider.id ?? provider.name}/${model.name}`,
				resolved: { provider, model },
			})),
		);

	if (entries.length === 0) {
		throw refuse("No AI models are set up", "the AI request was not sent", "Add a provider with models in QuickAdd's AI settings.");
	}

	// Route to a remote interactive session (Raycast) when one is driving.
	const promptProvider = executor.promptProvider;
	if (promptProvider) {
		const picked = String(
			await promptProvider.suggester(
				entries.map((entry) => entry.label),
				entries.map((entry) => entry.qualified),
				"Select a model",
			),
		);
		const entry = entries.find((e) => e.qualified === picked);
		if (!entry) {
			throw new Error(`Model ${picked} not found with any provider.`);
		}
		return entry.resolved;
	}

	if (executor.interactive === false) {
		// Non-interactive run (CLI without `ui`): the "Ask me" model picker has
		// no one to answer it. Abort with an actionable error instead of hanging.
		throw new ChoiceAbortError(
			"This AI command is set to \"Ask me\" for the model, but this run is non-interactive. " +
			"Pick a specific model in the command, or re-run with the ui flag.",
		);
	}

	try {
		return await GenericSuggester.Suggest(
			app,
			entries.map((entry) => entry.label),
			entries.map((entry) => entry.resolved),
			"Select a model",
		);
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}
