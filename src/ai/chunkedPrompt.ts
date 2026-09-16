import type { App } from "obsidian";
import type { PromptParams } from "./AIAssistant";
import { settingsStore } from "src/settingsStore";
import { OpenAIRequest } from "./OpenAIRequest";
import { isLikelyContextLimitError } from "./providerErrors";
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
import { outputVariables, trackPrompt } from "./promptProgress";

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
					reject(err instanceof Error ? err : new Error(String(err)));
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

		const result = await trackPrompt(results, notice, promptingMsg);

		const outputs = result.flat();

		const output = outputs.join(settings.resultJoiner);

		window.setTimeout(() => notice.hide(), 5000);

		return outputVariables(outputVariable, output);
	} catch (error) {
		notice.setMessage("dead", (error as { message: string }).message);
		window.setTimeout(() => notice.hide(), 5000);
		// No user input in this function - re-throw original error
		throw error;
	}
}
