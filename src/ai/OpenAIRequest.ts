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
import { settingsStore } from "src/settingsStore";
import {
	beginAIRequestLogEntry,
	finishAIRequestLogEntry,
} from "./requestLog";
import { preventCursorChange } from "./preventCursorChange";
import { reportError } from "../utils/errorUtils";
import type { AIProvider, ChatWire, Model } from "./Provider";
import { getChatWire, getProviderKind } from "./Provider";
import type { NormalizedChatRequest } from "./tools/NormalizedTools";
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


export type { CommonResponse } from "./providerRequest";
export { anthropicMaxTokens } from "./providerRequest";
import { anthropicMaxTokens, dispatchProviderRequest, requestPrompt, type CommonResponse } from "./providerRequest";
import { onlineFeaturesOffRefusal } from "./aiRefusals";

export function OpenAIRequest(
	app: App,
	apiKey: string,
	model: Model,
	// The provider the CALLER resolved (it already chose the API key from it).
	// Passed through rather than re-derived from model.name — a first-match
	// re-lookup here could route a provider-pinned model (#1495) to a different
	// endpoint than the key belongs to.
	modelProvider: AIProvider,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters> = {},
	// False when the caller's assistant notice shows the failure itself.
	reportFailure = true,
): (prompt: string) => Promise<CommonResponse> {
	return async function makeRequest(prompt: string): Promise<CommonResponse> {
		if (settingsStore.getState().disableOnlineFeatures) {
			throw onlineFeaturesOffRefusal();
		}

		const estimatedTokenCount =
			estimateTokenCount(prompt) + estimateTokenCount(systemPrompt);

		const requestStart = Date.now();
		const requestLogId = beginAIRequestLogEntry({
			provider: modelProvider.name,
			endpoint: modelProvider.endpoint,
			model: model.name,
			systemPrompt,
			prompt,
			modelOptions: modelParams,
		});
		log.logMessage(
			`[AI Request ${requestLogId}] Started ${modelProvider.name}/${model.name}`
		);
		if (
			Number.isFinite(model.maxTokens) &&
			model.maxTokens > 0 &&
			estimatedTokenCount > model.maxTokens
		) {
			log.logMessage(
				`[AI Request ${requestLogId}] Estimated prompt size is ${estimatedTokenCount} tokens, above the configured ${model.maxTokens} token context. Sending anyway; the provider will enforce the exact limit.`
			);
		}

		try {
			const restoreCursor = preventCursorChange(app);
			const kind = getProviderKind(modelProvider);

			const attempt = (params: Partial<OpenAIModelParameters>) =>
				requestPrompt({
					kind, apiKey, model, provider: modelProvider, systemPrompt, params, prompt,
					afterRequest: restoreCursor,
				});

			// Proactive: models whose metadata marks sampling as unsupported never
			// get the params. Reactive: when a provider rejects a sampling param we
			// DID send, retry once without them and say so — a settings slider must
			// never be a hard failure on a current model.
			const initialParams = applySamplingSupport(model, modelParams);
			const sentKeys = sentSamplingParams(initialParams);
			if (
				sentKeys.length === 0 &&
				sentSamplingParams(modelParams).length > 0
			) {
				log.logMessage(
					`[AI Request ${requestLogId}] ${model.name} uses fixed sampling; not sending ${describeSamplingParams(sentSamplingParams(modelParams))}.`
				);
			}

			const response = await retrySampling(
				() => attempt(initialParams),
				() => attempt(stripSamplingParams(initialParams)),
				{ sentKeys, model, provider: modelProvider, logPrefix: `AI Request ${requestLogId}`, advancedSettings: true },
			);

			const durationMs = Date.now() - requestStart;

			finishAIRequestLogEntry(requestLogId, {
				status: "success",
				durationMs,
				usage: response.usage,
			});
			log.logMessage(
				`[AI Request ${requestLogId}] Success in ${durationMs}ms`
			);

			return response;
		} catch (error) {
			const errorMessage =
				(error as { message?: string }).message ?? String(error);
			const durationMs = Date.now() - requestStart;

			finishAIRequestLogEntry(requestLogId, {
				status: "error",
				durationMs,
				errorMessage,
			});
			log.logMessage(
				`[AI Request ${requestLogId}] Failed in ${durationMs}ms: ${errorMessage}`
			);

			// Help users act on the most common failure: a prompt that overflows
			// the model's context window. (ChunkedPrompt retries these automatically;
			// the single-prompt path cannot, so we point the user at a remedy.)
			const guidance =
				classifyProviderError(error) === "input_context"
					? " The prompt likely exceeds the model's context window — shorten it, choose a model with a larger context, or use the chunked AI prompt API."
					: "";

			// Report the WRAPPER, not the bare provider error, and report it before
			// throwing so the failure is surfaced even if a caller swallows it. The
			// wrapper's message is a strict superset - it names the provider and
			// carries the guidance above - and since `reportError` reports a failure
			// once (#1601), reporting the cause instead would leave the user with the
			// least informative half of the pair.
			const failure = new Error(
				`Error while making request to ${modelProvider.name}: ${errorMessage}${guidance}`,
				{ cause: error }
			);
			if (reportFailure) reportError(failure);
			throw failure;
		}
	};
}

export async function chatRequest(
	app: App,
	apiKey: string,
	model: Model,
	// Caller-resolved provider; see OpenAIRequest for why it is never re-derived.
	modelProvider: AIProvider,
	request: NormalizedChatRequest,
	afterRequestCallback?: () => void,
	// False when the caller's assistant notice shows the failure itself.
	reportFailure = true,
): Promise<CommonResponse> {
	void app; // cursor handling is owned by the caller (Agent) for the whole loop
	if (settingsStore.getState().disableOnlineFeatures) {
		throw onlineFeaturesOffRefusal();
	}

	const wire = getChatWire(modelProvider);
	// Same sampling safety as the single-prompt path: drop params the model's
	// metadata marks unsupported, and keep the sent set for the reactive retry.
	const effectiveRequest: NormalizedChatRequest = {
		...request,
		modelParams: applySamplingSupport(model, request.modelParams ?? {}),
	};
	const samplingKeysSent = sentSamplingParams(
		effectiveRequest.modelParams ?? {},
	);
	const body = buildChatBody(
		wire,
		model.name,
		effectiveRequest,
		anthropicMaxTokens(model),
	);

	// Compact log summary — never dump the whole transcript / tool data into the log.
	const systemMsg = request.messages.find((m) => m.role === "system");
	const lastUser = [...request.messages]
		.reverse()
		.find((m) => m.role === "user");
	const requestStart = Date.now();
	const requestLogId = beginAIRequestLogEntry({
		provider: modelProvider.name,
		endpoint: modelProvider.endpoint,
		model: model.name,
		systemPrompt: systemMsg && systemMsg.role === "system" ? systemMsg.content : "",
		prompt:
			lastUser && lastUser.role === "user" ? lastUser.content : "[tool-calling turn]",
		modelOptions: request.modelParams ?? {},
	});

	try {
		const send = (body: Record<string, unknown>) => dispatchProviderRequest<Record<string, unknown>>({
			kind: wire, apiKey, provider: modelProvider, model, body,
			afterRequest: afterRequestCallback,
		});
		const dispatch = async (body: Record<string, unknown>) => {
			try {
				return await send(body);
			} catch (error) {
				const retryBody = toolReasoningRetryBody(
					wire,
					body,
					(error as { message?: string }).message ?? String(error),
				);
				if (!retryBody) throw error;
				log.logMessage(
					`[AI Chat ${requestLogId}] ${model.name} rejected function tools while reasoning; retrying with reasoning_effort "none".`,
				);
				return send(retryBody);
			}
		};
		const json = await retrySampling(
			() => dispatch(body),
			() => dispatch(buildChatBody(wire, model.name, {
				...effectiveRequest,
				modelParams: stripSamplingParams(effectiveRequest.modelParams ?? {}),
			}, anthropicMaxTokens(model))),
			{ sentKeys: samplingKeysSent, model, provider: modelProvider, logPrefix: `AI Chat ${requestLogId}` },
		);
		const parsed = parseChatResponse(wire, json);
		const durationMs = Date.now() - requestStart;
		finishAIRequestLogEntry(requestLogId, {
			status: "success",
			durationMs,
			usage: parsed.usage,
		});
		log.logMessage(`[AI Chat ${requestLogId}] Success in ${durationMs}ms`);

		return {
			id: (json.id as string) ?? `${Date.now()}`,
			model: model.name,
			content: parsed.content,
			usage: parsed.usage,
			stopReason: parsed.rawStopReason,
			stopSequence: null,
			created: Date.now(),
			toolCalls: parsed.toolCalls,
			normalizedStopReason: parsed.normalizedStopReason,
			providerRaw: parsed.providerRaw,
		};
	} catch (error) {
		const errorMessage =
			(error as { message?: string }).message ?? String(error);
		const durationMs = Date.now() - requestStart;
		finishAIRequestLogEntry(requestLogId, {
			status: "error",
			durationMs,
			errorMessage,
		});
		// Report the wrapper, not the bare cause: its message names the provider, and
		// `reportError` reports a failure once (#1601), so reporting the cause first
		// would suppress the more informative message at every layer above.
		const guidance = isForcedToolChoiceUnsupportedError(error)
			? ` ${model.name} can't be forced to call a tool, so toolChoice "required" and named tools don't work with it. Use toolChoice "auto" (the default) and say in the prompt when to call the tool, or pass a schema to get a fixed JSON shape.`
			: "";
		const failure = new Error(
			`Error while making request to ${modelProvider.name}: ${errorMessage}${guidance}`,
			{ cause: error },
		);
		if (reportFailure) reportError(failure);
		throw failure;
	}
}

// "Function tools with reasoning_effort are not supported for gpt-6-sol in
// /v1/chat/completions. To use function tools, use /v1/responses or set
// reasoning_effort to 'none'." (verified live 2026-09-26 for the gpt-6 and
// gpt-5.6 families, which reason by default; gpt-5.5 and older default to none).
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

async function retrySampling<T>(attempt: () => Promise<T>, retry: () => Promise<T>, context: {
	sentKeys: ReturnType<typeof sentSamplingParams>;
	model: Model;
	provider: AIProvider;
	logPrefix: string;
	advancedSettings?: boolean;
}): Promise<T> {
	try {
		return await attempt();
	} catch (error) {
		const errorText = (error as { message?: string }).message ?? String(error);
		const { sentKeys, model, provider, logPrefix, advancedSettings } = context;
		if (!isUnsupportedSamplingParamError(errorText, sentKeys)) throw error;
		const labels = describeSamplingParams(sentKeys);
		const pronoun = sentKeys.length > 1 ? "them" : "it";
		log.logMessage(`[${logPrefix}] ${provider.name} rejected ${labels}; retrying without sampling parameters.`);
		new Notice(
			`${model.name} doesn't accept the ${labels} setting${sentKeys.length > 1 ? "s" : ""}, so QuickAdd retried without ${pronoun}.` +
			(advancedSettings ? ` You can remove ${pronoun} from this command's advanced settings.` : ""),
		);
		return retry();
	}
}
