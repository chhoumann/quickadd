import GenericSuggester from "src/gui/GenericSuggester/genericSuggester";
import type { Model } from "./models";
import { TFile } from "obsidian";
import { getMarkdownFilesInFolder } from "src/utilityObsidian";
import invariant from "src/utils/invariant";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { settingsStore } from "src/settingsStore";
import { encodingForModel } from "js-tiktoken";
import { OpenAIRequest } from "./OpenAIRequest";
import { makeNoticeHandler } from "./makeNoticeHandler";

export const getTokenCount = (text: string, model: Model) => {
	// gpt-3.5-turbo-16k is a special case - it isn't in the library list yet
	const m = model === "gpt-3.5-turbo-16k" ? "gpt-3.5-turbo" : model;

	return encodingForModel(m).encode(text).length;
};

export const noticeMsg = (task: string, message: string) =>
	`Assistant is ${task}.${message ? `\n\n${message}` : ""}`;

async function repeatUntilResolved(
	callback: () => void,
	promise: Promise<unknown>,
	interval: number
) {
	// Validate input
	if (typeof callback !== "function") {
		throw new TypeError("Callback must be a function.");
	}
	if (!(promise instanceof Promise)) {
		throw new TypeError("Promise must be an instance of Promise.");
	}
	if (typeof interval !== "number" || interval <= 0) {
		throw new TypeError("Interval must be a positive number.");
	}

	let isDone = false;
	promise.finally(() => {
		isDone = true;
	});

	// Execute the callback function every X milliseconds until the promise is resolved
	while (!isDone) {
		callback();
		await sleep(interval);
	}
}

async function getTargetPromptTemplate(
	userDefinedPromptTemplate: Params["promptTemplate"],
	promptTemplates: TFile[]
): Promise<[string, string]> {
	let targetFile;

	if (userDefinedPromptTemplate.enable) {
		targetFile = promptTemplates.find((item) =>
			item.path.endsWith(userDefinedPromptTemplate.name)
		);
	} else {
		const basenames = promptTemplates.map((f) => f.basename);

		targetFile = await GenericSuggester.Suggest(
			app,
			basenames,
			promptTemplates
		);
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
	systemPrompt: string;
	outputVariableName: string;
	promptTemplate: {
		enable: boolean;
		name: string;
	};
	promptTemplateFolder: string;
	showAssistantMessages: boolean;
	modelOptions: Partial<OpenAIModelParameters>;
}

export async function runAIAssistant(
	settings: Params,
	formatter: (input: string) => Promise<string>
) {
	if (settingsStore.getState().disableOnlineFeatures) {
		throw new Error(
			"Blocking request to OpenAI: Online features are disabled in settings."
		);
	}

	const notice = makeNoticeHandler(settings.showAssistantMessages);

	try {
		const {
			apiKey,
			model,
			outputVariableName: outputVariable,
			promptTemplate,
			systemPrompt,
			promptTemplateFolder,
		} = settings;

		const promptTemplates = getMarkdownFilesInFolder(promptTemplateFolder);

		const [targetKey, targetPrompt] = await getTargetPromptTemplate(
			promptTemplate,
			promptTemplates
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
			apiKey,
			model,
			systemPrompt,
			settings.modelOptions
		);
		const res = makeRequest(formattedPrompt);

		const result = await timePromise(
			res,
			100,
			(time) => {
				notice.setMessage(
					promptingMsg[0],
					`${promptingMsg[1]} (${(time / 1000).toFixed(2)}s)`
				);
			},
			(time) => {
				notice.setMessage(
					"finished",
					`Took ${(time / 1000).toFixed(2)}s.`
				);
			}
		);

		const output = result.choices[0].message.content;
		const outputInMarkdownBlockQuote = ("> " + output).replace(
			/\n/g,
			"\n> "
		);

		const variables = {
			[outputVariable]: output,
			// For people that want the output in callouts or quote blocks.
			[`${outputVariable}-quoted`]: outputInMarkdownBlockQuote,
		};

		setTimeout(() => notice.hide(), 5000);

		return variables;
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		setTimeout(() => notice.hide(), 5000);
	}
}

async function timePromise<T>(
	promise: Promise<T>,
	interval: number,
	tick: (time: number) => void,
	onFinish: (time: number) => void
): Promise<T> {
	const time_start = Date.now();

	await repeatUntilResolved(
		() => tick(Date.now() - time_start),
		promise,
		interval
	);

	onFinish(Date.now() - time_start);

	return await promise;
}

type PromptParams = Omit<
	Params & { prompt: string },
	"promptTemplate" | "promptTemplateFolder"
>;

export async function Prompt(
	settings: PromptParams,
	formatter: (input: string) => Promise<string>
) {
	if (settingsStore.getState().disableOnlineFeatures) {
		throw new Error(
			"Blocking request to OpenAI: Online features are disabled in settings."
		);
	}

	const notice = makeNoticeHandler(settings.showAssistantMessages);

	try {
		const {
			apiKey,
			model,
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
			apiKey,
			model,
			systemPrompt,
			modelOptions
		);
		const res = makeRequest(formattedPrompt);

		const result = await timePromise(
			res,
			100,
			(time) => {
				notice.setMessage(
					promptingMsg[0],
					`${promptingMsg[1]} (${(time / 1000).toFixed(2)}s)`
				);
			},
			(time) => {
				notice.setMessage(
					"finished",
					`Took ${(time / 1000).toFixed(2)}s.`
				);
			}
		);

		const output = result.choices[0].message.content;
		const outputInMarkdownBlockQuote = ("> " + output).replace(
			/\n/g,
			"\n> "
		);

		const variables = {
			[outputVariable]: output,
			// For people that want the output in callouts or quote blocks.
			[`${outputVariable}-quoted`]: outputInMarkdownBlockQuote,
		};

		setTimeout(() => notice.hide(), 5000);

		return variables;
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		setTimeout(() => notice.hide(), 5000);
	}
}
