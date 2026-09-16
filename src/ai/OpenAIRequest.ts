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
import type { AIProvider, Model } from "./Provider";
import { getProviderKind } from "./Provider";
import type { NormalizedChatRequest } from "./tools/NormalizedTools";
import {
	buildChatBody,
	parseChatResponse,
} from "./tools/providerToolMapping";
import { log } from "src/logger/logManager";
import { estimateTokenCount } from "./tokenEstimator";
import { classifyProviderError } from "./providerErrors";


export type { CommonResponse, AnthropicContentBlock, AnthropicResponse, GeminiResponse } from "./providerRequest";
export { anthropicMaxTokens } from "./providerRequest";
import { anthropicMaxTokens, dispatchProviderRequest, requestPrompt, type CommonResponse } from "./providerRequest";

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
	modelParams: Partial<OpenAIModelParameters> = {}
): (prompt: string) => Promise<CommonResponse> {
	return async function makeRequest(prompt: string): Promise<CommonResponse> {
		if (settingsStore.getState().disableOnlineFeatures) {
			throw new Error(
				"Blocking request: Online features are disabled in settings."
			);
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
			reportError(failure);
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
): Promise<CommonResponse> {
	void app; // cursor handling is owned by the caller (Agent) for the whole loop
	if (settingsStore.getState().disableOnlineFeatures) {
		throw new Error(
			"Blocking request: Online features are disabled in settings.",
		);
	}

	const kind = getProviderKind(modelProvider);
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
		kind,
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
		const dispatch = (body: Record<string, unknown>) => dispatchProviderRequest<Record<string, unknown>>({
			kind, apiKey, provider: modelProvider, model, body,
			afterRequest: afterRequestCallback,
		});
		const json = await retrySampling(
			() => dispatch(body),
			() => dispatch(buildChatBody(kind, model.name, {
				...effectiveRequest,
				modelParams: stripSamplingParams(effectiveRequest.modelParams ?? {}),
			}, anthropicMaxTokens(model))),
			{ sentKeys: samplingKeysSent, model, provider: modelProvider, logPrefix: `AI Chat ${requestLogId}` },
		);
		const parsed = parseChatResponse(kind, json);
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
		const failure = new Error(
			`Error while making request to ${modelProvider.name}: ${errorMessage}`,
			{ cause: error },
		);
		reportError(failure);
		throw failure;
	}
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
