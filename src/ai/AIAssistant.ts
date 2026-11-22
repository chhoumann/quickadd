import type { App } from "obsidian";
import { TFile } from "obsidian";
import { promptCancelled, UserCancelError } from "src/errors/UserCancelError";
import { ChoiceAbortError } from "src/errors/ChoiceAbortError";
import GenericSuggester from "src/gui/GenericSuggester/genericSuggester";
import type { PromptProvider } from "src/interactive/promptProvider";
import { routePrompt } from "src/interactive/routePrompt";
import { getMarkdownFilesInFolder } from "src/utils/vaultQueries";
import invariant from "src/utils/invariant";
import { isCancellationError } from "src/utils/errorUtils";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { OpenAIRequest } from "./OpenAIRequest";
import type { AIProvider, Model } from "./Provider";
import { makeNoticeHandler } from "./makeNoticeHandler";
import { assertOnlineFeaturesEnabled } from "./onlineFeatures";
import { outputVariables, trackPrompt } from "./promptProgress";

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

export type PromptParams = Omit<
	Params & { prompt: string },
	"promptTemplate" | "promptTemplateFolder"
>;

/** Run an AI Assistant macro command: its prompt comes from a template note. */
export async function runAIAssistant(
	app: App,
	settings: Params,
	formatter: (input: string) => Promise<string>
) {
	return sendPrompt(app, settings, formatter, async () => {
		const [name, prompt] = await getTargetPromptTemplate(app, settings);
		return { prompt, label: `Using prompt template "${name}".` };
	});
}

/** Run a script's `ai.prompt`: its prompt is the text the script passed. */
export async function Prompt(
	app: App,
	settings: PromptParams,
	formatter: (input: string) => Promise<string>
) {
	return sendPrompt(app, settings, formatter, async () => ({
		prompt: settings.prompt,
		label: "Using custom prompt.",
	}));
}

/**
 * Format the prompt, send it, and return its output variables, narrating each
 * stage in the assistant notice when "Show assistant messages" is on.
 */
async function sendPrompt(
	app: App,
	settings: Omit<Params, "promptTemplate" | "promptTemplateFolder">,
	formatter: (input: string) => Promise<string>,
	resolvePrompt: () => Promise<{ prompt: string; label: string }>,
) {
	assertOnlineFeaturesEnabled();

	const notice = makeNoticeHandler(settings.showAssistantMessages);

	try {
		const { prompt, label } = await resolvePrompt();

		notice.setMessage(
			"waiting",
			"QuickAdd is formatting the prompt template."
		);
		const formattedPrompt = await formatter(prompt);

		const makeRequest = OpenAIRequest(
			app,
			settings.apiKey,
			settings.model,
			settings.provider,
			settings.systemPrompt,
			settings.modelOptions,
			!settings.showAssistantMessages
		);
		const result = await trackPrompt(
			makeRequest(formattedPrompt),
			notice,
			["prompting", label],
		);

		return outputVariables(settings.outputVariableName, result.content);
	} catch (error) {
		notice.fail(error);
		// A cancelled prompt in the formatter aborts the run like any other.
		if (isCancellationError(error) && !(error instanceof UserCancelError)) {
			throw promptCancelled();
		}
		throw error;
	}
}

async function getTargetPromptTemplate(
	app: App,
	settings: Params,
): Promise<[string, string]> {
	const { promptTemplate } = settings;
	const promptTemplates = getMarkdownFilesInFolder(app, settings.promptTemplateFolder);
	const targetFile = promptTemplate.enable
		? promptTemplates.find((item) => item.path.endsWith(promptTemplate.name))
		: await pickPromptTemplate(app, promptTemplates, settings);

	invariant(targetFile, "Prompt template does not exist");

	const targetTemplatePath = targetFile.path;

	const file = app.vault.getAbstractFileByPath(targetTemplatePath);
	invariant(file instanceof TFile, `${targetTemplatePath} is not a file`);
	const targetTemplateContent = await app.vault.cachedRead(file);

	return [targetFile.basename, targetTemplateContent];
}

function pickPromptTemplate(
	app: App,
	promptTemplates: TFile[],
	settings: Pick<Params, "interactive" | "promptProvider">,
): Promise<TFile | undefined> {
	const basenames = promptTemplates.map((f) => f.basename);
	const placeholder = "Select a prompt template";
	return routePrompt(settings, {
		// A remote interactive session (Raycast) answers with the selected
		// template, or with typed text that names none.
		remote: async (provider) => {
			const picked = await provider.suggester(basenames, promptTemplates, placeholder);
			return typeof picked === "string" ? undefined : picked;
		},
		// Non-interactive run (CLI without `ui`): the picker has no one to answer
		// it, so opening it would hang.
		headless: () => {
			throw new ChoiceAbortError(
				"This AI command asks which prompt template to use, but this run is non-interactive. " +
					"Enable a specific prompt template in the command, or re-run with the ui flag."
			);
		},
		app: () => GenericSuggester.Suggest(app, basenames, promptTemplates, placeholder),
	});
}
