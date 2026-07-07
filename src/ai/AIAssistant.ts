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
import { isLikelyContextLimitError } from "./providerErrors";
import type { AIProvider, Model } from "./Provider";
import { makeNoticeHandler } from "./makeNoticeHandler";
import { estimateModelInputBudget, estimateTokenCount } from "./tokenEstimator";
import { log } from "src/logger/logManager";
import {
	GLOBAL_VAR_REGEX,
	INLINE_JAVASCRIPT_REGEX,
	MACRO_REGEX,
	TEMPLATE_REGEX,
	VARIABLE_REGEX,
} from "src/constants";
import { transformCase } from "src/utils/caseTransform";

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
			throw new UserCancelError("Input cancelled by user");
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
	// Start timestamps of the requests dispatched within the current window. Old
	// entries are pruned on every schedule() so this acts as a sliding window:
	// no more than `maxRequests` may START within any `intervalMs` span.
	private startTimes: number[] = [];

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
		if (this.queue.length === 0) {
			return;
		}

		const now = Date.now();
		// Drop start timestamps older than the window so they no longer count
		// against the per-interval cap.
		this.startTimes = this.startTimes.filter(
			(t) => now - t < this.intervalMs
		);

		if (this.startTimes.length >= this.maxRequests) {
			// Window is full; wait until the oldest in-window start ages out,
			// then re-evaluate.
			const oldest = this.startTimes[0];
			const waitMs = Math.max(0, this.intervalMs - (now - oldest));
			window.setTimeout(() => this.schedule(), waitMs + 1);
			return;
		}

		const promiseFactory = this.queue.shift();
		if (!promiseFactory) {
			return;
		}

		this.startTimes.push(now);
		const promise = promiseFactory();
		// A freed slot opens only when an in-window start ages out, so re-check
		// once this dispatch leaves the window.
		window.setTimeout(() => this.schedule(), this.intervalMs);
		// Keep draining the queue immediately for any remaining slots in the
		// current window.
		this.schedule();
		void promise;
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
const MAX_CHUNKED_PROMPTS = 500;
const CHUNK_PROBE_VALUE = "quickadd_chunk_probe_123456789";

function getChunkProbeVariants(): string[] {
	return Array.from(
		new Set([
			CHUNK_PROBE_VALUE,
			...[
				"kebab",
				"snake",
				"camel",
				"pascal",
				"title",
				"lower",
				"upper",
				"slug",
			].map((style) => transformCase(CHUNK_PROBE_VALUE, style)),
		])
	).filter(Boolean);
}

const CHUNK_PROBE_VARIANTS = getChunkProbeVariants();

// Split a chunk near its middle, preferring a natural boundary (paragraph,
// sentence, then space). Works on UTF-16 indices directly — no Array.from — so it
// stays cheap on multi-megabyte inputs; the fallback only nudges off a surrogate
// pair so a code point is never split.
function splitChunkNearMiddle(chunk: string): [string, string] | null {
	if (chunk.length <= 1) return null;

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

	// No separator: split at the UTF-16 midpoint, nudging forward if it lands on
	// the low half of a surrogate pair so we never cut a code point in two.
	let splitIndex = midpoint;
	const code = chunk.charCodeAt(splitIndex);
	if (code >= 0xdc00 && code <= 0xdfff) splitIndex += 1;
	if (splitIndex <= 0 || splitIndex >= chunk.length) return null;

	return [chunk.slice(0, splitIndex), chunk.slice(splitIndex)];
}

// Does the template reference the injected `chunk` variable via {{VALUE:chunk}}?
// Matches the formatter's own parsing: the variable name is the text before the
// first `|`, so {{VALUE:chunk-id}} / {{VALUE:chunk,other}} are correctly excluded.
function templateReferencesChunk(template: string): boolean {
	const regex = new RegExp(VARIABLE_REGEX.source, "gi");
	let match: RegExpExecArray | null;
	while ((match = regex.exec(template)) !== null) {
		const variableName = match[1].split("|")[0].trim().toLowerCase();
		if (variableName === "chunk") return true;
	}
	return false;
}

// Tokens that can expand into a {{VALUE:chunk}} reference at format time. The
// rendered probe below must still prove that the chunk value was actually used.
function templateHasDynamicExpansionSite(template: string): boolean {
	return (
		TEMPLATE_REGEX.test(template) ||
		MACRO_REGEX.test(template) ||
		GLOBAL_VAR_REGEX.test(template) ||
		INLINE_JAVASCRIPT_REGEX.test(template)
	);
}

function renderedPromptContainsChunk(renderedPrompt: string): boolean {
	return CHUNK_PROBE_VARIANTS.some((variant) =>
		renderedPrompt.includes(variant)
	);
}

function removeChunkProbeFromRenderedPrompt(renderedPrompt: string): string {
	return CHUNK_PROBE_VARIANTS
		.slice()
		.sort((a, b) => b.length - a.length)
		.reduce(
			(output, variant) => output.split(variant).join(" "),
			renderedPrompt
		);
}

function assertWithinChunkBudget(count: number): void {
	if (count > MAX_CHUNKED_PROMPTS) {
		throw new Error(
			`QuickAdd would split this chunked AI request into more than ${MAX_CHUNKED_PROMPTS} prompts, which exceeds the safety limit. Increase the chunk size, use a larger chunk separator, or reduce the input text.`
		);
	}
}

// Split one chunk down to the estimated budget and append the pieces to `out`.
// Uses a depth-first stack (push right then left so pieces emit left-to-right),
// which keeps the working set bounded by recursion depth (~log2 of the chunk
// length). The cap is enforced on the pieces produced *from this one chunk*, so a
// pathological separator-poor input bails out immediately instead of materialising
// hundreds of thousands of pieces — without penalising many small chunks that will
// later merge (the final post-merge count is capped separately by the caller).
function appendSplitToBudget(
	chunk: string,
	budgetTokens: number,
	out: string[]
): void {
	const budget = Math.max(1, Math.floor(budgetTokens));
	const stack = [chunk];
	let producedFromChunk = 0;

	while (stack.length > 0) {
		const current = stack.pop() as string;
		const fitsBudget = estimateTokenCount(current) <= budget;
		const split = fitsBudget ? null : splitChunkNearMiddle(current);

		if (!split) {
			out.push(current);
			producedFromChunk += 1;
			assertWithinChunkBudget(producedFromChunk);
			continue;
		}

		stack.push(split[1], split[0]);
	}
}

function countRegExpGroups(re: RegExp): number {
	// Appending "|" makes the pattern match empty at position 0, so exec always
	// returns a result whose length is 1 + the number of capturing groups. The
	// probe must keep the source's own flags (minus the match-position ones,
	// g/y): u- or v-only syntax like /[\u{4E00}-\u{9FFF}]/gu does not parse
	// flagless and would throw here instead of splitting.
	const probeFlags = re.flags.replace(/[gy]/g, "");
	return (
		new RegExp(re.source + "|", probeFlags).exec("") as RegExpExecArray
	).length - 1;
}

// An unescaped `\1`-`\9` in a group-FREE pattern is a legacy octal escape;
// wrapping the source in a capture group would silently turn it into a
// BACKREFERENCE and change what it matches. Such separators stay on the
// historical (separator-discarding) path.
const UNESCAPED_DIGIT_ESCAPE_RE = /(?:^|[^\\])(?:\\\\)*\\[1-9]/;

/**
 * Split `text` like `text.split(separator)` while RETAINING each consumed
 * separator, so the merge path can re-insert the boundary it split on -
 * otherwise merged lines/paragraphs reach the model glued together
 * ("A\nB" → "AB"). Wrapping the pattern in one capturing group makes split()
 * interleave the matched separators without changing the chunk substrings.
 *
 * A separator regex that already has capturing groups keeps the historical
 * split behavior unchanged (its captures interleave into the chunk list, so
 * the captured text is preserved as chunks); `separators` is null there and
 * no boundary is re-inserted, exactly as before.
 */
function splitTextRetainingSeparators(
	text: string,
	separator: RegExp | string
): { chunks: string[]; separators: string[] | null } {
	if (typeof separator === "string") {
		const chunks = text.split(separator);
		return {
			chunks,
			separators: new Array(Math.max(0, chunks.length - 1)).fill(separator),
		};
	}

	if (
		countRegExpGroups(separator) > 0 ||
		UNESCAPED_DIGIT_ESCAPE_RE.test(separator.source)
	) {
		return { chunks: text.split(separator), separators: null };
	}

	const wrapped = new RegExp(`(${separator.source})`, separator.flags);
	const parts = text.split(wrapped);
	const chunks: string[] = [];
	const separators: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 0) chunks.push(parts[i]);
		else separators.push(parts[i]);
	}
	return { chunks, separators };
}

interface PreparedChunk {
	text: string;
	/** The separator that preceded this chunk in the original text ("" for the
	 * first chunk and for continuation pieces cut out of one oversized chunk). */
	joiner: string;
}

function buildEstimatedPromptChunks(
	chunks: string[],
	separators: string[] | null,
	maxEstimatedChunkTokens: number,
	shouldMerge: boolean
): string[] {
	const preparedChunks: PreparedChunk[] = [];
	chunks.forEach((chunk, index) => {
		const pieces: string[] = [];
		appendSplitToBudget(chunk, maxEstimatedChunkTokens, pieces);
		pieces.forEach((piece, pieceIndex) => {
			preparedChunks.push({
				text: piece,
				// Only the first piece of a raw chunk was preceded by a real
				// separator; later pieces were cut mid-text by the budget split.
				joiner:
					pieceIndex === 0 && index > 0
						? (separators?.[index - 1] ?? "")
						: "",
			});
		});
	});

	if (!shouldMerge) return preparedChunks.map((chunk) => chunk.text);

	const output: string[] = [];
	let combinedChunk = "";
	let combinedChunkSize = 0;

	for (const chunk of preparedChunks) {
		// Budget the separator that is actually re-inserted, floored at the
		// historical +1 so grouping is unchanged for the default "\n"
		// (estimateTokenCount("\n") === 1) and for joiner-less pieces. Without
		// this, a long custom separator (e.g. "\n\n===CHUNK===\n\n") would be
		// re-inserted uncounted and push a merged request far over the budget.
		const strSize =
			estimateTokenCount(chunk.text) +
			Math.max(1, estimateTokenCount(chunk.joiner));

		if (
			combinedChunk !== "" &&
			combinedChunkSize + strSize >= maxEstimatedChunkTokens
		) {
			output.push(combinedChunk);
			combinedChunk = "";
			combinedChunkSize = 0;
		}

		// Re-insert the separator the text was split on so merged chunks keep
		// their original boundaries; a chunk that opens a new request drops its
		// leading separator (it IS the request boundary).
		combinedChunk +=
			combinedChunk === "" ? chunk.text : chunk.joiner + chunk.text;
		combinedChunkSize += strSize;
	}

	if (combinedChunk !== "") {
		output.push(combinedChunk);
	}

	return output;
}

// Clamp the user-configured `maxChunkTokens` to the model's derived input budget.
// Returns whether clamping occurred so the caller can surface the effective value
// instead of silently shrinking the user's setting.
function clampChunkBudget(
	rawChunkBudget: number,
	configuredMaxChunkTokens: number | undefined
): { budget: number; clamped: boolean } {
	const budget = Math.max(1, Math.floor(rawChunkBudget));

	if (
		configuredMaxChunkTokens !== undefined &&
		Number.isFinite(configuredMaxChunkTokens) &&
		configuredMaxChunkTokens > 0
	) {
		const configured = Math.floor(configuredMaxChunkTokens);
		return {
			budget: Math.min(budget, configured),
			clamped: configured > budget,
		};
	}

	return { budget, clamped: false };
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
			promptTemplate,
			text,
			modelOptions,
		} = settings;

		notice.setMessage(
			"chunking",
			"Creating prompt chunks with text and prompt template"
		);

		const chunkSeparator = settings.chunkSeparator || /\n/g;
		const { chunks: rawChunks, separators } = splitTextRetainingSeparators(
			text,
			chunkSeparator
		);

		// Estimate the static prompt overhead by rendering the template once with a
		// probe chunk value. This also validates dynamic expansions: templates,
		// macros, globals, and inline JS are allowed to inject {{VALUE:chunk}}, but
		// they only pass if the rendered prompt actually contains the probe.
		const overheadProbe = await formatter(promptTemplate, {
			chunk: CHUNK_PROBE_VALUE,
		});
		const hasChunkReference =
			templateReferencesChunk(promptTemplate) ||
			(templateHasDynamicExpansionSite(promptTemplate) &&
				renderedPromptContainsChunk(overheadProbe));
		if (!hasChunkReference) {
			throw new Error(
				"The chunked prompt template does not reference the chunk text. Add {{VALUE:chunk}} to your prompt template so each chunk is inserted."
			);
		}

		const fullContextTokens = model.maxTokens;
		const estimatedInputBudget = estimateModelInputBudget(fullContextTokens);
		const overheadPrompt = removeChunkProbeFromRenderedPrompt(overheadProbe);
		const promptOverhead =
			estimateTokenCount(systemPrompt) + estimateTokenCount(overheadPrompt);

		// Only hard-stop when the static overhead exceeds the model's ENTIRE context
		// window (truly no room). If it merely exceeds the 45% planning budget, we
		// still proceed with a minimal chunk budget and let the provider decide.
		if (promptOverhead >= fullContextTokens) {
			throw new Error(
				`The estimated prompt overhead (${promptOverhead} tokens) exceeds the model's entire context window (${fullContextTokens} tokens). Shorten the system prompt or prompt template, or use a model with a larger context window.`
			);
		}

		const { budget: maxEstimatedChunkTokens, clamped } = clampChunkBudget(
			estimatedInputBudget - promptOverhead,
			settings.maxChunkTokens
		);
		if (clamped) {
			log.logMessage(
				`[ChunkedPrompt] Requested max chunk tokens (${settings.maxChunkTokens}) exceeds this model's estimated input budget; using ${maxEstimatedChunkTokens} estimated tokens per chunk instead.`
			);
		}

		// Whether we should merge chunks that are smaller than the budget.
		const shouldMerge = settings.shouldMerge ?? true;

		const chunkedText = buildEstimatedPromptChunks(
			rawChunks,
			separators,
			maxEstimatedChunkTokens,
			shouldMerge
		);

		// Final safety cap on the number of prompts actually dispatched (post-merge).
		assertWithinChunkBudget(chunkedText.length);

		const makeRequest = OpenAIRequest(
			app,
			apiKey,
			model,
			provider,
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

		// Render prompts through the formatter, but serialize the calls so the
		// formatter's shared variables map is never mutated concurrently: concurrent
		// chunks and recursive retries would otherwise race on `chunk`. Serializing
		// (rather than substituting into a once-rendered template) also keeps
		// {{VALUE:chunk|case:...}} and other modifiers working, since the real chunk
		// value flows through the formatter each time. Queued renders short-circuit
		// once an earlier chunk has failed terminally.
		let renderChain: Promise<unknown> = Promise.resolve();
		const renderChunkPrompt = (chunk: string): Promise<string> => {
			const rendered = renderChain.then(() => {
				if (hasTerminalFailure) {
					throw new Error(
						"Chunked prompt stopped after an earlier failure."
					);
				}
				return formatter(promptTemplate, { chunk });
			});
			renderChain = rendered.then(
				() => undefined,
				() => undefined
			);
			return rendered;
		};

		const requestChunk = async (
			chunk: string,
			depth = 0
		): Promise<string[]> => {
			if (hasTerminalFailure) {
				throw new Error("Chunked prompt stopped after an earlier failure.");
			}

			// Render failures (e.g. a macro/inline-JS error in the template) are
			// always terminal — they can't be fixed by splitting, so they trip the
			// gate and stop siblings rather than entering the context-limit retry.
			let prompt: string;
			try {
				prompt = await renderChunkPrompt(chunk);
			} catch (error) {
				hasTerminalFailure = true;
				throw error;
			}

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
