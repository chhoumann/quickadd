import type { App } from "obsidian";
import { Notice } from "obsidian";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import {
	applySamplingSupport,
	describeSamplingParams,
	isUnsupportedSamplingParamError,
	sentSamplingParams,
	stripSamplingParams,
} from "./samplingParams";
import {
	beginAIRequestLogEntry,
	finishAIRequestLogEntry,
} from "./requestLog";
import { preventCursorChange } from "./preventCursorChange";
import { reportError } from "../utils/errorUtils";
import type { AIProvider, ChatWire, Model } from "./Provider";
import { getChatWire, getProviderKind } from "./Provider";
import type { NormalizedChatRequest, NormalizedMessage } from "./tools/NormalizedTools";
import {
	buildChatBody,
	parseChatResponse,
} from "./tools/providerToolMapping";
import { log } from "src/logger/logManager";
import { estimateTokenCount } from "./tokenEstimator";
import {
	classifyProviderError,
	isForcedToolChoiceUnsupportedError,
} from "./providerErrors";
import { assertOnlineFeaturesEnabled } from "./onlineFeatures";
import {
	anthropicMaxTokens,
	dispatchProviderRequest,
	toCommonResponse,
	type CommonResponse,
} from "./providerRequest";

export function OpenAIRequest(
	app: App,
	apiKey: string,
	model: Model,
	// The provider the caller resolved, which chose the API key. A first-match
	// re-lookup from model.name could route a provider-pinned model to a
	// different endpoint than the key belongs to.
	modelProvider: AIProvider,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters> = {},
	// False when the caller's assistant notice shows the failure itself.
	reportFailure = true,
): (prompt: string) => Promise<CommonResponse> {
	return async function makeRequest(prompt: string): Promise<CommonResponse> {
		assertOnlineFeaturesEnabled();

		// The single-prompt path stays on Chat Completions even for OpenAI's own
		// endpoint (getProviderKind, not getChatWire): it sends no tools.
		const kind = getProviderKind(modelProvider);
		const messages: NormalizedMessage[] = [];
		if (systemPrompt.trim()) messages.push({ role: "system", content: systemPrompt });
		messages.push({ role: "user", content: prompt });

		return sendLogged(
			{
				label: "AI Request",
				provider: modelProvider,
				model,
				reportFailure,
				logEntry: { systemPrompt, prompt, modelOptions: modelParams },
				// Help users act on the most common failure: a prompt that overflows
				// the model's context window. (ChunkedPrompt retries these
				// automatically; the single-prompt path cannot, so point at a remedy.)
				guidance: (error) =>
					classifyProviderError(error) === "input_context"
						? " The prompt likely exceeds the model's context window — shorten it, choose a model with a larger context, or use the chunked AI prompt API."
						: "",
			},
			async (logPrefix) => {
				const estimatedTokenCount =
					estimateTokenCount(prompt) + estimateTokenCount(systemPrompt);
				if (
					Number.isFinite(model.maxTokens) &&
					model.maxTokens > 0 &&
					estimatedTokenCount > model.maxTokens
				) {
					log.logMessage(
						`[${logPrefix}] Estimated prompt size is ${estimatedTokenCount} tokens, above the configured ${model.maxTokens} token context. Sending anyway; the provider will enforce the exact limit.`
					);
				}

				const restoreCursor = preventCursorChange(app);
				const json = await withSamplingRetry(
					modelParams,
					{ model, provider: modelProvider, logPrefix },
					(params) =>
						dispatchProviderRequest({
							kind, apiKey, model, provider: modelProvider,
							body: buildChatBody(kind, model.name, { messages, modelParams: params }, anthropicMaxTokens(model)),
							afterRequest: restoreCursor,
						}),
				);
				return toCommonResponse(json, parseChatResponse(kind, json), model);
			},
		);
	};
}

export async function chatRequest(
	apiKey: string,
	model: Model,
	// Caller-resolved provider; see OpenAIRequest for why it is never re-derived.
	modelProvider: AIProvider,
	request: NormalizedChatRequest,
	afterRequestCallback?: () => void,
	// False when the caller's assistant notice shows the failure itself.
	reportFailure = true,
): Promise<CommonResponse> {
	assertOnlineFeaturesEnabled();

	const wire = getChatWire(modelProvider);
	// Compact log summary — never dump the whole transcript / tool data into the log.
	const systemMsg = request.messages.find((m) => m.role === "system");
	const lastUser = [...request.messages]
		.reverse()
		.find((m) => m.role === "user");

	return sendLogged(
		{
			label: "AI Chat",
			provider: modelProvider,
			model,
			reportFailure,
			logEntry: {
				systemPrompt: systemMsg && systemMsg.role === "system" ? systemMsg.content : "",
				prompt:
					lastUser && lastUser.role === "user" ? lastUser.content : "[tool-calling turn]",
				modelOptions: request.modelParams ?? {},
			},
			guidance: (error) =>
				isForcedToolChoiceUnsupportedError(error)
					? ` ${model.name} can't be forced to call a tool, so toolChoice "required" and named tools don't work with it. Use toolChoice "auto" (the default) and say in the prompt when to call the tool, or pass a schema to get a fixed JSON shape.`
					: "",
		},
		async (logPrefix) => {
			const send = (body: Record<string, unknown>) => dispatchProviderRequest({
				kind: wire, apiKey, provider: modelProvider, model, body,
				afterRequest: afterRequestCallback,
			});
			const json = await withSamplingRetry(
				request.modelParams ?? {},
				{ model, provider: modelProvider, logPrefix },
				async (modelParams) => {
					const body = buildChatBody(wire, model.name, { ...request, modelParams }, anthropicMaxTokens(model));
					try {
						return await send(body);
					} catch (error) {
						const retryBody = toolReasoningRetryBody(wire, body, errorText(error));
						if (!retryBody) throw error;
						log.logMessage(
							`[${logPrefix}] ${model.name} rejected function tools while reasoning; retrying with reasoning_effort "none".`,
						);
						return send(retryBody);
					}
				},
			);
			const parsed = parseChatResponse(wire, json);
			return {
				...toCommonResponse(json, parsed, model),
				toolCalls: parsed.toolCalls,
				normalizedStopReason: parsed.normalizedStopReason,
				providerRaw: parsed.providerRaw,
			};
		},
	);
}

function errorText(error: unknown): string {
	return (error as { message?: string } | undefined)?.message ?? String(error);
}

interface LoggedRequest {
	/** Prefixes this request's log lines, e.g. "AI Request" or "AI Chat". */
	label: string;
	provider: AIProvider;
	model: Model;
	/** False when the caller's assistant notice shows the failure itself. */
	reportFailure: boolean;
	/** What the request log shows for this request. */
	logEntry: {
		systemPrompt: string;
		prompt: string;
		modelOptions: Partial<OpenAIModelParameters>;
	};
	/** Advice appended to the failure message for errors the caller recognizes. */
	guidance: (error: unknown) => string;
}

/**
 * Run one provider request inside the request log: record its start and
 * outcome, and turn a failure into an error that names the provider.
 */
async function sendLogged(
	request: LoggedRequest,
	send: (logPrefix: string) => Promise<CommonResponse>,
): Promise<CommonResponse> {
	const { provider, model } = request;
	const requestStart = Date.now();
	const requestLogId = beginAIRequestLogEntry({
		provider: provider.name,
		endpoint: provider.endpoint,
		model: model.name,
		...request.logEntry,
	});
	const logPrefix = `${request.label} ${requestLogId}`;
	log.logMessage(`[${logPrefix}] Started ${provider.name}/${model.name}`);

	try {
		const response = await send(logPrefix);
		const durationMs = Date.now() - requestStart;
		finishAIRequestLogEntry(requestLogId, {
			status: "success",
			durationMs,
			usage: response.usage,
		});
		log.logMessage(`[${logPrefix}] Success in ${durationMs}ms`);
		return response;
	} catch (error) {
		const errorMessage = errorText(error);
		const durationMs = Date.now() - requestStart;
		finishAIRequestLogEntry(requestLogId, {
			status: "error",
			durationMs,
			errorMessage,
		});
		log.logMessage(`[${logPrefix}] Failed in ${durationMs}ms: ${errorMessage}`);

		// Report the wrapper, not the bare provider error, before throwing: its
		// message names the provider and carries the guidance, and report-once
		// would otherwise keep only the less informative half.
		const failure = new Error(
			`Error while making request to ${provider.name}: ${errorMessage}${request.guidance(error)}`,
			{ cause: error },
		);
		if (request.reportFailure) reportError(failure);
		throw failure;
	}
}

/**
 * Send with the model's sampling support applied. Proactive: models whose
 * metadata marks sampling as unsupported never get the params. Reactive: when
 * a provider rejects a sampling param we DID send, retry once without them and
 * say so - a sampling setting must never be a hard failure on a current model.
 */
async function withSamplingRetry<T>(
	requested: Partial<OpenAIModelParameters>,
	{ model, provider, logPrefix }: { model: Model; provider: AIProvider; logPrefix: string },
	send: (params: Partial<OpenAIModelParameters>) => Promise<T>,
): Promise<T> {
	const params = applySamplingSupport(model, requested);
	const sentKeys = sentSamplingParams(params);
	const requestedKeys = sentSamplingParams(requested);
	if (sentKeys.length === 0 && requestedKeys.length > 0) {
		log.logMessage(
			`[${logPrefix}] ${model.name} uses fixed sampling; not sending ${describeSamplingParams(requestedKeys)}.`
		);
	}

	try {
		return await send(params);
	} catch (error) {
		if (!isUnsupportedSamplingParamError(errorText(error), sentKeys)) throw error;
		const labels = describeSamplingParams(sentKeys);
		const plural = sentKeys.length > 1;
		log.logMessage(`[${logPrefix}] ${provider.name} rejected ${labels}; retrying without sampling parameters.`);
		new Notice(
			`${model.name} doesn't accept the ${labels} setting${plural ? "s" : ""}, so QuickAdd retried without ${plural ? "them" : "it"}.`,
		);
		return send(stripSamplingParams(params));
	}
}

// "Function tools with reasoning_effort are not supported for gpt-6-sol in
// /v1/chat/completions. To use function tools, use /v1/responses or set
// reasoning_effort to 'none'." Hit by model families that reason by default.
const TOOLS_NEED_NO_REASONING_RE =
	/function tools with reasoning_effort are not supported[\s\S]*reasoning_effort to 'none'/i;

/**
 * The body to retry a Chat Completions tool request with when the model
 * rejected function tools because it reasons by default, or null when the
 * error is anything else or the caller already chose a reasoning effort.
 * Only the Chat Completions wire can hit this: OpenAI's own endpoint uses the
 * Responses API, but gateways (Azure OpenAI, OpenRouter, LiteLLM, ...) can
 * still serve these models over Chat Completions.
 */
function toolReasoningRetryBody(
	wire: ChatWire,
	body: Record<string, unknown>,
	errorText: string,
): Record<string, unknown> | null {
	if (wire !== "openai") return null;
	if (!Array.isArray(body.tools) || body.tools.length === 0) return null;
	if (body.reasoning_effort !== undefined) return null;
	if (!TOOLS_NEED_NO_REASONING_RE.test(errorText)) return null;
	return { ...body, reasoning_effort: "none" };
}
