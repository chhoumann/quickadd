import GenericSuggester from "src/gui/GenericSuggester/genericSuggester";
import type { Model } from "./models";
import { Notice, TFile, requestUrl } from "obsidian";
import { getMarkdownFilesInFolder } from "src/utilityObsidian";
import invariant from "src/utils/invariant";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { settingsStore } from "src/settingsStore";
import { encodingForModel } from "js-tiktoken";

const getTokenCount = (text: string) => {
	return encodingForModel("gpt-4").encode(text).length;
};

const noticeMsg = (task: string, message: string) =>
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
	userDefinedPromptTemplate: params["promptTemplate"],
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

interface params {
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
	settings: params,
	formatter: (input: string) => Promise<string>
) {
	if (settingsStore.getState().disableOnlineFeatures) {
		throw new Error(
			"Blocking request to OpenAI: Online features are disabled in settings."
		);
	}

	const notice = settings.showAssistantMessages
		? new Notice(noticeMsg("starting", ""), 1000000)
		: { setMessage: () => {}, hide: () => {} };

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
			noticeMsg("waiting", "QuickAdd is formatting the prompt template.")
		);
		const formattedPrompt = await formatter(targetPrompt);

		const promptingMsg = [
			"prompting",
			`Using prompt template "${targetKey}".`,
		];
		notice.setMessage(noticeMsg(promptingMsg[0], promptingMsg[1]));

		const makeRequest = OpenAIRequest(
			apiKey,
			model,
			systemPrompt,
			settings.modelOptions
		);
		const res = makeRequest(formattedPrompt);

		const time_start = Date.now();
		await repeatUntilResolved(
			() => {
				notice.setMessage(
					noticeMsg(
						promptingMsg[0],
						`${promptingMsg[1]} (${(
							(Date.now() - time_start) /
							1000
						).toFixed(2)}s)`
					)
				);
			},
			res,
			100
		);

		const result = await res; // already resolved, just getting the value.

		const time_end = Date.now();

		notice.setMessage(
			noticeMsg(`finished`, `Took ${(time_end - time_start) / 1000}s.`)
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
		notice.setMessage(
			noticeMsg("dead", (error as { message: string }).message)
		);
		setTimeout(() => notice.hide(), 5000);
	}
}

type ReqResponse = {
	id: string;
	model: string;
	object: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	choices: {
		finish_reason: string;
		index: number;
		message: { content: string; role: string };
	}[];
	created: number;
};

function getModelMaxTokens(model: Model) {
	switch (model) {
		case "text-davinci-003":
			return 4096;
		case "gpt-3.5-turbo":
			return 4096;
		case "gpt-4":
			return 8192;
		case "gpt-3.5-turbo-16k":
			return 16384;
		case "gpt-4-32k":
			return 32768;
		default:
			const exhaustiveCheck: never = model;
			throw new Error(`Unhandled model ${exhaustiveCheck}`);
	}
}

function OpenAIRequest(
	apiKey: string,
	model: Model,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters> = {}
) {
	return async function makeRequest(prompt: string) {
		if (settingsStore.getState().disableOnlineFeatures) {
			throw new Error(
				"Blocking request to OpenAI: Online features are disabled in settings."
			);
		}

		const tokenCount = getTokenCount(prompt) + getTokenCount(systemPrompt);
		const maxTokens = getModelMaxTokens(model);

		if (tokenCount > maxTokens) {
			throw new Error(
				`The ${model} API has a token limit of ${maxTokens}. Your prompt has ${tokenCount} tokens.`
			);
		}

		try {
			const response = await requestUrl({
				url: `https://api.openai.com/v1/chat/completions`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model,
					...modelParams,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: prompt },
					],
				}),
			});

			return response.json as ReqResponse;
		} catch (error) {
			console.log(error);
			throw new Error(
				`Error while making request to OpenAI API: ${
					(error as { message: string }).message
				}`
			);
		}
	};
}
