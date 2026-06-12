import type { App } from "obsidian";
import { TFile } from "obsidian";
import { MacroAbortError } from "src/errors/MacroAbortError";
import GenericSuggester from "src/gui/GenericSuggester/genericSuggester";
import { settingsStore } from "src/settingsStore";
import { getMarkdownFilesInFolder } from "src/utilityObsidian";
import invariant from "src/utils/invariant";
import { isCancellationError } from "src/utils/errorUtils";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { OpenAIRequest, isLikelyContextLimitError } from "./OpenAIRequest";
import type { Model } from "./Provider";
import { getModelMaxTokens } from "./aiHelpers";
import { makeNoticeHandler } from "./makeNoticeHandler";
import { estimateModelInputBudget, estimateTokenCount } from "./tokenEstimator";

export const getTokenCount = (text: string, _model: Model | string) =>
	estimateTokenCount(text);

export interface AIRequestLogEntry {
	id: string;
	createdAt: number;
	provider: string;
	endpoint: string;
	model: string;
	systemPrompt: string;
	prompt: string;
	modelOptions: Partial<OpenAIModelParameters>;
	status: "pending" | "success" | "error";
	durationMs?: number;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	errorMessage?: string;
}

const MAX_AI_REQUEST_LOG_ENTRIES = 25;
const aiRequestLogEntries: AIRequestLogEntry[] = [];

function cloneRequestLogEntry(entry: AIRequestLogEntry): AIRequestLogEntry {
	return {
		...entry,
		modelOptions: { ...entry.modelOptions },
		usage: entry.usage ? { ...entry.usage } : undefined,
	};
}

export function beginAIRequestLogEntry(
	entry: Omit<AIRequestLogEntry, "id" | "createdAt" | "status">
): string {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const createdAt = Date.now();

	aiRequestLogEntries.push({
		...entry,
		modelOptions: { ...(entry.modelOptions ?? {}) },
		id,
		createdAt,
		status: "pending",
	});

	trimAIRequestLogEntries();

	return id;
}

export function finishAIRequestLogEntry(
	id: string,
	result: Omit<AIRequestLogEntry, "id" | "createdAt" | "provider" | "endpoint" | "model" | "systemPrompt" | "prompt" | "modelOptions">
) {
	const entry = aiRequestLogEntries.find((item) => item.id === id);
	if (!entry) return;

	entry.status = result.status;
	entry.durationMs = result.durationMs;
	entry.usage = result.usage;
	entry.errorMessage = result.errorMessage;

	trimAIRequestLogEntries();
}

export function getAIRequestLogEntries(limit = 10): AIRequestLogEntry[] {
	if (!Number.isFinite(limit)) {
		limit = 10;
	}

	const boundedLimit = Math.floor(limit);
	if (boundedLimit <= 0) return [];

	return aiRequestLogEntries
		.slice(-boundedLimit)
		.map(cloneRequestLogEntry)
		.reverse();
}

function trimAIRequestLogEntries() {
	if (aiRequestLogEntries.length <= MAX_AI_REQUEST_LOG_ENTRIES) return;

	let overflow = aiRequestLogEntries.length - MAX_AI_REQUEST_LOG_ENTRIES;
	while (overflow > 0) {
		const oldestCompletedIndex = aiRequestLogEntries.findIndex(
			(item) => item.status !== "pending"
		);
		if (oldestCompletedIndex === -1) {
			// Avoid dropping in-flight entries. We'll trim once requests finish.
			break;
		}

		aiRequestLogEntries.splice(oldestCompletedIndex, 1);
		overflow -= 1;
	}
}

export function getAIRequestLogEntryById(
	id: string
): AIRequestLogEntry | null {
	const entry = aiRequestLogEntries.find((item) => item.id === id);
	return entry ? cloneRequestLogEntry(entry) : null;
}

export function getLastAIRequestLogEntry(): AIRequestLogEntry | null {
	const latest = aiRequestLogEntries[aiRequestLogEntries.length - 1];
	return latest ? cloneRequestLogEntry(latest) : null;
}

export function clearAIRequestLogEntries(): void {
	aiRequestLogEntries.splice(0, aiRequestLogEntries.length);
}

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
	void promise.then(
		() => {
			isDone = true;
		},
		() => {
			isDone = true;
		}
	);

	// Execute the callback function every X milliseconds until the promise is resolved
	while (!isDone) {
		callback();
		await sleep(interval);
	}
}

function toError(reason: unknown): Error {
	if (reason instanceof Error) return reason;
	return new Error(String(reason));
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

		window.setTimeout(() => notice.hide(), 5000);

		return variables;
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		window.setTimeout(() => notice.hide(), 5000);
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

		window.setTimeout(() => notice.hide(), 5000);

		return variables;
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		window.setTimeout(() => notice.hide(), 5000);
		// No user input in this function - re-throw original error
		throw error;
	}
}

export class RateLimiter {
	private queue: (() => Promise<unknown>)[] = [];
	private pendingPromises: Promise<unknown>[] = [];

	constructor(private maxRequests: number, private intervalMs: number) {}

	add<T>(promiseFactory: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push(async () => {
				try {
					resolve(await promiseFactory());
				} catch (err) {
					reject(toError(err));
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
		void promise.then(
			() => {
				this.pendingPromises = this.pendingPromises.filter(
					(p) => p !== promise
				);
				this.schedule();
			},
			() => {
				this.pendingPromises = this.pendingPromises.filter(
					(p) => p !== promise
				);
				this.schedule();
			}
		);
		window.setTimeout(() => this.schedule(), this.intervalMs);
	}
}

type ChunkedPromptParams = Omit<
	PromptParams & {
		chunkSeparator: RegExp;
		resultJoiner: string;
		text: string;
		promptTemplate: string;
		shouldMerge: boolean;
		maxChunkTokens?: number;
	},
	"prompt"
>;

const MAX_CONTEXT_RETRY_DEPTH = 12;
const MIN_USABLE_ESTIMATED_CHUNK_TOKENS = 8;
const MAX_CHUNKED_PROMPTS = 500;

function splitChunkNearMiddle(chunk: string): [string, string] | null {
	const chars = Array.from(chunk);
	if (chars.length <= 1) return null;

	const midpoint = Math.floor(chunk.length / 2);
	const separators = ["\n\n", "\n", ". ", " "];

	let bestIndex = -1;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const separator of separators) {
		const before = chunk.lastIndexOf(separator, midpoint);
		const after = chunk.indexOf(separator, midpoint);
		const candidates = [before, after].filter((index) => index > 0);

		for (const index of candidates) {
			const splitIndex = index + separator.length;
			if (splitIndex <= 0 || splitIndex >= chunk.length) continue;

			const distance = Math.abs(splitIndex - midpoint);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = splitIndex;
			}
		}
	}

	if (bestIndex > 0 && bestIndex < chunk.length) {
		return [chunk.slice(0, bestIndex), chunk.slice(bestIndex)];
	}

	const charMidpoint = Math.floor(chars.length / 2);
	return [
		chars.slice(0, charMidpoint).join(""),
		chars.slice(charMidpoint).join(""),
	];
}

function splitChunkToEstimatedBudget(
	chunk: string,
	model: Model,
	maxEstimatedTokens: number
): string[] {
	const budget = Math.max(1, Math.floor(maxEstimatedTokens));
	const output: string[] = [];
	const queue = [chunk];

	while (queue.length > 0) {
		const current = queue.shift() ?? "";
		const currentEstimate = getTokenCount(current, model);

		if (currentEstimate <= budget) {
			output.push(current);
			continue;
		}

		const split = splitChunkNearMiddle(current);
		if (!split) {
			output.push(current);
			continue;
		}

		queue.unshift(split[1]);
		queue.unshift(split[0]);
	}

	return output;
}

function buildEstimatedPromptChunks(
	chunks: string[],
	model: Model,
	maxEstimatedChunkTokens: number,
	shouldMerge: boolean
): string[] {
	const preparedChunks = chunks.flatMap((chunk) =>
		splitChunkToEstimatedBudget(chunk, model, maxEstimatedChunkTokens)
	);

	if (!shouldMerge) return preparedChunks;

	const output: string[] = [];
	let combinedChunk = "";
	let combinedChunkSize = 0;

	for (const chunk of preparedChunks) {
		const strSize = getTokenCount(chunk, model) + 1; // +1 for the separator removed by split().

		if (
			combinedChunk !== "" &&
			combinedChunkSize + strSize >= maxEstimatedChunkTokens
		) {
			output.push(combinedChunk);
			combinedChunk = "";
			combinedChunkSize = 0;
		}

		combinedChunk += chunk;
		combinedChunkSize += strSize;
	}

	if (combinedChunk !== "") {
		output.push(combinedChunk);
	}

	return output;
}

function getEstimatedChunkBudget(
	model: Model,
	systemPrompt: string,
	renderedPromptTemplate: string,
	configuredMaxChunkTokens?: number
) {
	const estimatedInputBudget = estimateModelInputBudget(
		getModelMaxTokens(model.name)
	);
	const promptOverhead =
		getTokenCount(systemPrompt, model) +
		getTokenCount(renderedPromptTemplate, model);
	const modelBudget = Math.max(1, estimatedInputBudget - promptOverhead);

	if (
		configuredMaxChunkTokens !== undefined &&
		Number.isFinite(configuredMaxChunkTokens) &&
		configuredMaxChunkTokens > 0
	) {
		return Math.max(
			1,
			Math.min(modelBudget, Math.floor(configuredMaxChunkTokens))
		);
	}

	return modelBudget;
}

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

		// Render the prompt template once so the estimator includes static prompt overhead.
		const renderedPromptTemplate = await formatter(promptTemplate, {
			chunk: " ", // empty would make QA ask for a value, which we don't want
		});
		const maxEstimatedChunkTokens = getEstimatedChunkBudget(
			model,
			systemPrompt,
			renderedPromptTemplate,
			settings.maxChunkTokens
		);

		if (maxEstimatedChunkTokens < MIN_USABLE_ESTIMATED_CHUNK_TOKENS) {
			throw new Error(
				`The estimated prompt overhead leaves too little room for text chunks (${maxEstimatedChunkTokens} estimated tokens). Shorten the system prompt or prompt template, increase the max chunk tokens setting, or use a model with a larger context window.`
			);
		}

		// Whether we should merge chunks that are too small.
		const shouldMerge = settings.shouldMerge ?? true; // temp, need to impl. config

		const chunkedText = buildEstimatedPromptChunks(
			chunks,
			model,
			maxEstimatedChunkTokens,
			shouldMerge
		);

		if (chunkedText.length > MAX_CHUNKED_PROMPTS) {
			throw new Error(
				`QuickAdd estimated ${chunkedText.length} prompts for this chunked AI request, which exceeds the safety limit of ${MAX_CHUNKED_PROMPTS}. Increase the chunk size, use a larger chunk separator, or reduce the input text.`
			);
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
			`${chunkedText.length} prompts being sent.`,
		];
		notice.setMessage(promptingMsg[0], promptingMsg[1]);

		const rateLimiter = new RateLimiter(5, 1000 * 30); // 5 requests per half minute
		let hasTerminalFailure = false;
		let providerRequestCount = 0;

		const requestChunk = async (
			chunk: string,
			depth = 0
		): Promise<string[]> => {
			if (hasTerminalFailure) {
				throw new Error("Chunked prompt stopped after an earlier failure.");
			}

			const prompt = await formatter(promptTemplate, { chunk });

			try {
				const response = await rateLimiter.add(() => {
					if (hasTerminalFailure) {
						throw new Error(
							"Chunked prompt stopped after an earlier failure."
						);
					}

					providerRequestCount += 1;
					if (providerRequestCount > MAX_CHUNKED_PROMPTS) {
						throw new Error(
							`Chunked AI request exceeded the safety limit of ${MAX_CHUNKED_PROMPTS} provider requests.`
						);
					}

					return makeRequest(prompt);
				});
				return [response.content];
			} catch (error) {
				const split = splitChunkNearMiddle(chunk);
				if (
					depth >= MAX_CONTEXT_RETRY_DEPTH ||
					!split ||
					!isLikelyContextLimitError(error)
				) {
					hasTerminalFailure = true;
					throw error;
				}

				notice.setMessage(
					"prompting",
					"Provider rejected a prompt for context length. Retrying with smaller chunks."
				);

				const [left, right] = split;
				const leftOutput = await requestChunk(left, depth + 1);
				const rightOutput = await requestChunk(right, depth + 1);
				return [...leftOutput, ...rightOutput];
			}
		};

		const results = Promise.all(
			chunkedText.map((chunk) => requestChunk(chunk))
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

		const outputs = result.flat();

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

		window.setTimeout(() => notice.hide(), 5000);

		return variables;
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		window.setTimeout(() => notice.hide(), 5000);
		// No user input in this function - re-throw original error
		throw error;
	}
}
