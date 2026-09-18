import { outputVariables, trackPrompt } from "./promptProgress";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { UserCancelError } from "src/errors/UserCancelError";
import { ChoiceAbortError } from "src/errors/ChoiceAbortError";
import GenericSuggester from "src/gui/GenericSuggester/genericSuggester";
import type { PromptProvider } from "src/interactive/promptProvider";
import { settingsStore } from "src/settingsStore";
import { getMarkdownFilesInFolder } from "src/utilityObsidian";
import invariant from "src/utils/invariant";
import { isCancellationError } from "src/utils/errorUtils";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { OpenAIRequest } from "./OpenAIRequest";
import type { AIProvider, Model } from "./Provider";
import { makeNoticeHandler } from "./makeNoticeHandler";

export * from "./requestLog";
export { ChunkedPrompt, RateLimiter } from "./chunkedPrompt";

async function getTargetPromptTemplate(
	app: App,
	userDefinedPromptTemplate: Params["promptTemplate"],
	promptTemplates: TFile[],
	interactive = true,
	promptProvider?: PromptProvider
): Promise<[string, string]> {
	let targetFile;

	if (userDefinedPromptTemplate.enable) {
		targetFile = promptTemplates.find((item) =>
			item.path.endsWith(userDefinedPromptTemplate.name)
		);
	} else {
		const basenames = promptTemplates.map((f) => f.basename);

		if (promptProvider) {
			// Route the picker to a remote interactive session (Raycast). The
			// suggester returns the selected actualItems entry (the TFile).
			targetFile = (await promptProvider.suggester(
				basenames,
				promptTemplates as unknown as string[],
				"Select a prompt template"
			)) as TFile | undefined;
		} else if (!interactive) {
			// Non-interactive run (CLI without `ui`): the prompt-template picker has
			// no one to answer it, so opening it would hang. Abort with an actionable
			// error.
			throw new ChoiceAbortError(
				"This AI command asks which prompt template to use, but this run is non-interactive. " +
					"Enable a specific prompt template in the command, or re-run with the ui flag."
			);
		} else {
			targetFile = await GenericSuggester.Suggest(
				app,
				basenames,
				promptTemplates
			);
		}
	}

	invariant(targetFile, "Prompt template does not exist");

	const targetTemplatePath = targetFile.path;

	const file = app.vault.getAbstractFileByPath(targetTemplatePath);
	invariant(file instanceof TFile, `${targetTemplatePath} is not a file`);
	const targetTemplateContent = await app.vault.cachedRead(file);

	return [targetFile.basename, targetTemplateContent];
}

interface Params {
	apiKey: string;
	model: Model;
	/** The provider the model was resolved to; the apiKey belongs to it. */
	provider: AIProvider;
	systemPrompt: string;
	outputVariableName: string;
	promptTemplate: {
		enable: boolean;
		name: string;
	};
	promptTemplateFolder: string;
	showAssistantMessages: boolean;
	modelOptions: Partial<OpenAIModelParameters>;
	/**
	 * Whether the run may open a blocking picker (the prompt-template suggester).
	 * Defaults to interactive; the non-interactive CLI sets it false so the picker
	 * aborts with a clear error instead of hanging. Optional so existing callers
	 * (api.ai) are unaffected.
	 */
	interactive?: boolean;
	/**
	 * When set (a remote interactive session, e.g. Raycast), the prompt-template
	 * picker is forwarded to it instead of opening an Obsidian modal.
	 */
	promptProvider?: PromptProvider;
}

export async function runAIAssistant(
	app: App,
	settings: Params,
	formatter: (input: string) => Promise<string>
) {
	if (settingsStore.getState().disableOnlineFeatures) {
		throw new Error(
			"Online features are disabled in settings. Enable them to use the AI Assistant."
		);
	}

	const notice = makeNoticeHandler(settings.showAssistantMessages);

	try {
		const {
			apiKey,
			model,
			provider,
			outputVariableName: outputVariable,
			promptTemplate,
			systemPrompt,
			promptTemplateFolder,
		} = settings;

		const promptTemplates = getMarkdownFilesInFolder(app, promptTemplateFolder);

		const [targetKey, targetPrompt] = await getTargetPromptTemplate(
			app,
			promptTemplate,
			promptTemplates,
			settings.interactive ?? true,
			settings.promptProvider
		);

		notice.setMessage(
			"waiting",
			"QuickAdd is formatting the prompt template."
		);
		const formattedPrompt = await formatter(targetPrompt);

		const promptingMsg = [
			"prompting",
			`Using prompt template "${targetKey}".`,
		];
		notice.setMessage(promptingMsg[0], promptingMsg[1]);

		const makeRequest = OpenAIRequest(
			app,
			apiKey,
			model,
			provider,
			systemPrompt,
			settings.modelOptions
		);
		const res = makeRequest(formattedPrompt);

		const result = await trackPrompt(res, notice, promptingMsg);

		const output = result.content;

		window.setTimeout(() => notice.hide(), 5000);

		return outputVariables(outputVariable, output);
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		window.setTimeout(() => notice.hide(), 5000);
		// Always abort on cancelled input
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}

export type PromptParams = Omit<
	Params & { prompt: string },
	"promptTemplate" | "promptTemplateFolder"
>;

export async function Prompt(
	app: App,
	settings: PromptParams,
	formatter: (input: string) => Promise<string>
) {
	if (settingsStore.getState().disableOnlineFeatures) {
		throw new Error(
			"Online features are disabled in settings. Enable them to use the AI Assistant."
		);
	}

	const notice = makeNoticeHandler(settings.showAssistantMessages);

	try {
		const {
			apiKey,
			model,
			provider,
			outputVariableName: outputVariable,
			systemPrompt,
			prompt,
			modelOptions,
		} = settings;

		notice.setMessage(
			"waiting",
			"QuickAdd is formatting the prompt template."
		);
		const formattedPrompt = await formatter(prompt);

		const promptingMsg = ["prompting", `Using custom prompt.`];
		notice.setMessage(promptingMsg[0], promptingMsg[1]);

		const makeRequest = OpenAIRequest(
			app,
			apiKey,
			model,
			provider,
			systemPrompt,
			modelOptions
		);
		const res = makeRequest(formattedPrompt);

		const result = await trackPrompt(res, notice, promptingMsg);

		const output = result.content;

		window.setTimeout(() => notice.hide(), 5000);

		return outputVariables(outputVariable, output);
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		window.setTimeout(() => notice.hide(), 5000);
		// No user input in this function - re-throw original error
		throw error;
	}
}
