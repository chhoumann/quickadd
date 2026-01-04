import type { TiktokenModel } from "js-tiktoken";
import { Tiktoken, getEncodingNameForModel } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";
import o200k_base from "js-tiktoken/ranks/o200k_base";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { MacroAbortError } from "src/errors/MacroAbortError";
import GenericSuggester from "src/gui/GenericSuggester/genericSuggester";
import { settingsStore } from "src/settingsStore";
import { getMarkdownFilesInFolder } from "src/utilityObsidian";
import invariant from "src/utils/invariant";
import { isCancellationError } from "src/utils/errorUtils";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { OpenAIRequest } from "./OpenAIRequest";
import type { Model } from "./Provider";
import { getModelMaxTokens } from "./aiHelpers";
import { makeNoticeHandler } from "./makeNoticeHandler";

type Encoding = ConstructorParameters<typeof Tiktoken>[0];

const encodings: Record<string, Encoding> = {
	cl100k_base,
	o200k_base,
};
const encodingCache = new Map<string, Tiktoken>();

function getEncoding(name: string) {
	const encodingName = name in encodings ? name : "cl100k_base";
	const cached = encodingCache.get(encodingName);
	if (cached) return cached;

	const encoding = new Tiktoken(encodings[encodingName]);
	encodingCache.set(encodingName, encoding);
	return encoding;
}

export const getTokenCount = (text: string, model: Model) => {
	// Use best-effort for non-OpenAI/unknown models by falling back to cl100k.
	let encodingName = "cl100k_base";
	try {
		encodingName = getEncodingNameForModel(model.name as TiktokenModel);
	} catch {
		encodingName = "cl100k_base";
	}

	if (encodingName === "p50k_base" || encodingName === "p50k_edit") {
		encodingName = "cl100k_base";
	} else if (encodingName === "r50k_base" || encodingName === "gpt2") {
		encodingName = "cl100k_base";
	}

	return getEncoding(encodingName).encode(text).length;
};

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
	app: App,
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
	app: App,
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

		const promptTemplates = getMarkdownFilesInFolder(app, promptTemplateFolder);

		const [targetKey, targetPrompt] = await getTargetPromptTemplate(
			app,
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
			app,
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

		const output = result.content;
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
		// Always abort on cancelled input
		if (isCancellationError(error)) {
			throw new MacroAbortError("Input cancelled by user");
		}
		throw error;
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
	app: App,
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
			app,
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

		const output = result.content;
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
		// No user input in this function - re-throw original error
		throw error;
	}
}

class RateLimiter {
	private queue: (() => Promise<unknown>)[] = [];
	private pendingPromises: Promise<unknown>[] = [];

	constructor(private maxRequests: number, private intervalMs: number) {}

	add<T>(promiseFactory: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push(async () => {
				try {
					resolve(await promiseFactory());
				} catch (err) {
					reject(err);
				}
			});
			this.schedule();
		});
	}

	private schedule() {
		if (
			this.queue.length === 0 ||
			this.pendingPromises.length >= this.maxRequests
		) {
			return;
		}
		const promiseFactory = this.queue.shift();
		if (!promiseFactory) {
			return;
		}

		const promise = promiseFactory();
		this.pendingPromises.push(promise);
		promise.finally(() => {
			this.pendingPromises = this.pendingPromises.filter(
				(p) => p !== promise
			);
			this.schedule();
		});
		setTimeout(() => this.schedule(), this.intervalMs);
	}
}

type ChunkedPromptParams = Omit<
	PromptParams & {
		chunkSeparator: RegExp;
		resultJoiner: string;
		text: string;
		promptTemplate: string;
		shouldMerge: boolean;
	},
	"prompt"
>;

export async function ChunkedPrompt(
	app: App,
	settings: ChunkedPromptParams,
	formatter: (
		input: string,
		variables: { [k: string]: unknown }
	) => Promise<string>
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
			promptTemplate,
			text,
			modelOptions,
		} = settings;

		notice.setMessage(
			"chunking",
			"Creating prompt chunks with text and prompt template"
		);

		const chunkSeparator = settings.chunkSeparator || /\n/g;
		const chunks = text.split(chunkSeparator);

		const systemPromptLength = getTokenCount(systemPrompt, model);
		// We need the prompt template to be rendered to get the token count of it, except the chunk variable.
		const renderedPromptTemplate = await formatter(promptTemplate, {
			chunk: " ", // empty would make QA ask for a value, which we don't want
		});
		const promptTemplateTokenCount = getTokenCount(
			renderedPromptTemplate,
			model
		);

		const maxChunkTokenSize =
			getModelMaxTokens(model.name) / 2 - systemPromptLength; // temp, need to impl. config

		// Whether we should strictly enforce the chunking rules or we should merge chunks that are too small
		const shouldMerge = settings.shouldMerge ?? true; // temp, need to impl. config

		const chunkedPrompts = [];
		const maxCombinedChunkSize =
			maxChunkTokenSize - promptTemplateTokenCount;

		if (shouldMerge) {
			const output: string[] = [];
			let combinedChunk = "";
			let combinedChunkSize = 0;

			for (const chunk of chunks) {
				const strSize = getTokenCount(chunk, model) + 1; // +1 for the newline

				if (strSize > maxCombinedChunkSize) {
					throw new Error(
						`The chunk "${chunk.slice(
							0,
							25
						)}..." is too large to fit in a single prompt.`
					);
				}

				if (combinedChunkSize + strSize < maxCombinedChunkSize) {
					// Add string to the current chunk and increase its size
					combinedChunk += chunk;
					combinedChunkSize += strSize;
				} else {
					// Push the current chunk to the output array
					output.push(combinedChunk);

					// Start a new chunk with the current string
					combinedChunk = chunk;
					combinedChunkSize = strSize;
				}
			}

			if (combinedChunk !== "") {
				output.push(combinedChunk);
			}

			for (const chunk of output) {
				const prompt = await formatter(promptTemplate, { chunk });
				chunkedPrompts.push(prompt);
			}
		} else {
			for (const chunk of chunks) {
				const tokenCount = getTokenCount(chunk, model);

				if (tokenCount > maxChunkTokenSize) {
					throw new Error(
						`Chunk size (${tokenCount}) is larger than the maximum chunk size (${maxChunkTokenSize}). Please check your chunk separator.`
					);
				}

				const prompt = await formatter(promptTemplate, { chunk });
				chunkedPrompts.push(prompt);
			}
		}

		const makeRequest = OpenAIRequest(
			app,
			apiKey,
			model,
			systemPrompt,
			modelOptions
		);

		const promptingMsg = [
			"prompting",
			`${chunkedPrompts.length} prompts being sent.`,
		];
		notice.setMessage(promptingMsg[0], promptingMsg[1]);

		const rateLimiter = new RateLimiter(5, 1000 * 30); // 5 requests per half minute
		const results = Promise.all(
			chunkedPrompts.map((prompt) =>
				rateLimiter.add(() => makeRequest(prompt))
			)
		);

		const result = await timePromise(
			results,
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

		const outputs = result.map((r) => r.content);

		const output = outputs.join(settings.resultJoiner);
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
		// No user input in this function - re-throw original error
		throw error;
	}
}
