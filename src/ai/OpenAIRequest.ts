import type { App } from "obsidian";
import { Notice, requestUrl } from "obsidian";
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
} from "./AIAssistant";
import { preventCursorChange } from "./preventCursorChange";
import type { AIProvider, Model } from "./Provider";
import { getProviderKind } from "./Provider";
import { getModelProvider } from "./aiHelpers";
import type { NormalizedChatRequest } from "./tools/NormalizedTools";
import {
	buildChatBody,
	parseChatResponse,
	type ProviderKind,
} from "./tools/providerToolMapping";
import { log } from "src/logger/logManager";
import { estimateTokenCount } from "./tokenEstimator";
import { buildProviderError, classifyProviderError } from "./providerErrors";
import type {
	NormalizedStopReason,
	NormalizedToolCall,
} from "./tools/NormalizedTools";

export interface CommonResponse {
	id: string;
	model: string;
	content: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	/** Raw provider stop/finish reason (kept for back-compat + debugging). */
	stopReason: string;
	stopSequence: string | null;
	created: number;
	// --- Tool-calling additions (#714); all optional so existing consumers are unaffected. ---
	/** Tool calls the model requested this turn, normalized across providers. */
	toolCalls?: NormalizedToolCall[];
	/** Provider stop reason mapped to a neutral enum, for the execute loop. */
	normalizedStopReason?: NormalizedStopReason;
	/**
	 * Opaque provider-specific blocks that must be echoed back unchanged on the
	 * next turn (e.g. Gemini `thoughtSignature` parts). Carried on the assistant
	 * turn the loop reconstructs.
	 */
	providerRaw?: unknown;
}

// Shared request execution for all providers: call `requestUrl` with
// `throw: false` so we can read the response body ourselves, run the
// post-request callback (cursor restore), and turn any 4xx/5xx into a
// structured, classifiable error before returning the parsed JSON.
async function dispatchProviderRequest<T>(
	params: Parameters<typeof requestUrl>[0] & object,
	providerName: string,
	afterRequestCallback?: () => void
): Promise<T> {
	const _response = requestUrl({ ...params, throw: false });

	if (afterRequestCallback) afterRequestCallback();

	const response = await _response;
	if (response.status >= 400) {
		throw buildProviderError(providerName, response);
	}
	return response.json as T;
}

function mapOpenAIResponseToCommon(
	response: OpenAIReqResponse
): CommonResponse {
	return {
		id: response.id,
		model: response.model,
		content: response.choices[0].message.content,
		usage: {
			promptTokens: response.usage.prompt_tokens,
			completionTokens: response.usage.completion_tokens,
			totalTokens: response.usage.total_tokens,
		},
		stopReason: response.choices[0].finish_reason,
		stopSequence: null,
		created: response.created,
	};
}

function mapAnthropicResponseToCommon(
	response: AnthropicResponse
): CommonResponse {
	return {
		id: response.id,
		model: response.model,
		// Scan all blocks and join the text ones — reading content[0] breaks the
		// moment a non-text block (e.g. a tool_use block) is first.
		content: response.content
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join(""),
		usage: {
			promptTokens: response.usage.input_tokens,
			completionTokens: response.usage.output_tokens,
			totalTokens:
				response.usage.input_tokens + response.usage.output_tokens,
		},
		stopReason: response.stop_reason,
		stopSequence: response.stop_sequence,
		created: Date.now(),
	};
}

type OpenAIReqResponse = {
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

// A content block can be text OR a non-text block (e.g. tool_use); only `type` is
// guaranteed. Modeled honestly so the tool-calling layer (PR2) can read tool_use
// blocks without the type lying about every block having a string `text`.
export interface AnthropicContentBlock {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
}

export interface AnthropicResponse {
	content: AnthropicContentBlock[];
	id: string;
	model: string;
	role: string;
	stop_reason: string;
	stop_sequence: null;
	type: string;
	usage: { input_tokens: number; output_tokens: number };
}

type GeminiPart = { text?: string } & Record<string, unknown>;
type GeminiContent = { role: string; parts: GeminiPart[] };
export interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent;
    finishReason?: string;
    index?: number;
    safetyRatings?: unknown[];
  }>;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

async function makeOpenAIRequest(
	apiKey: string,
	model: Model,
	modelProvider: AIProvider,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters>,
	prompt: string,
	afterRequestCallback?: () => void
): Promise<OpenAIReqResponse> {
	return dispatchProviderRequest<OpenAIReqResponse>(
		{
			url: `${modelProvider.endpoint}/chat/completions`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: model.name,
				...modelParams,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: prompt },
				],
			}),
		},
		modelProvider.name,
		afterRequestCallback
	);
}

// Anthropic output budget. The Messages API REQUIRES max_tokens and REJECTS (400)
// any value above a model's OUTPUT cap — and model.maxTokens is the *context
// window*, not the output cap. Prefer the model's real output cap when the model
// list carries it (models.dev / provider sync metadata; full caps verified live
// non-streaming). Without metadata, fall back to 4096 — at or below the output
// limit of every Claude model, matching the long-standing pre-#714 default.
// Callers needing more pass maxOutputTokens explicitly (honored uncapped).
export function anthropicMaxTokens(model: Model): number {
	if (
		typeof model.maxOutputTokens === "number" &&
		Number.isFinite(model.maxOutputTokens) &&
		model.maxOutputTokens > 0
	) {
		return Math.floor(model.maxOutputTokens);
	}
	const ceiling = 4096;
	return Number.isFinite(model.maxTokens) && model.maxTokens > 0
		? Math.min(ceiling, model.maxTokens)
		: ceiling;
}

async function makeAnthropicRequest(
	apiKey: string,
	model: Model,
	modelProvider: AIProvider,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters>,
	prompt: string,
	afterRequestCallback?: () => void
): Promise<AnthropicResponse> {
	const body: Record<string, unknown> = {
		model: model.name,
		max_tokens: anthropicMaxTokens(model),
		messages: [{ role: "user", content: prompt }],
	};
	// Send the system prompt at the top level (the Messages API has no system role
	// inside `messages`). Previously dropped entirely — this is a real behaviour fix.
	if (systemPrompt && systemPrompt.trim().length > 0) {
		body.system = systemPrompt;
	}
	// Forward the user's sampling settings — previously ignored here, so a
	// configured Temperature silently did nothing on Claude models that accept
	// one. Only the params the Messages API knows; the OpenAI-specific penalty
	// params would be rejected as unknown fields.
	if (typeof modelParams.temperature === "number") {
		body.temperature = modelParams.temperature;
	}
	if (typeof modelParams.top_p === "number") {
		body.top_p = modelParams.top_p;
	}

	return dispatchProviderRequest<AnthropicResponse>(
		{
			url: `${modelProvider.endpoint}/v1/messages`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify(body),
		},
		modelProvider.name,
		afterRequestCallback
	);
}

async function makeGeminiRequest(
  apiKey: string,
  model: Model,
  modelProvider: AIProvider,
  systemPrompt: string,
  modelParams: Partial<OpenAIModelParameters>,
  prompt: string,
  afterRequestCallback?: () => void
): Promise<GeminiResponse> {
  // Gemini takes the API key as a header (verified live) — a `?key=` query
  // parameter would leak it into request logs and proxies.
  const url = `${modelProvider.endpoint}/v1beta/models/${encodeURIComponent(
    model.name
  )}:generateContent`;

  const generationConfig: Record<string, unknown> = {};
  if (typeof modelParams.temperature === "number") {
    generationConfig.temperature = modelParams.temperature;
  }
  if (typeof modelParams.top_p === "number") {
    generationConfig.topP = modelParams.top_p;
  }
  // Do NOT pass frequency_penalty / presence_penalty; Gemini does not support them

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };

  if (systemPrompt && systemPrompt.trim().length > 0) {
    // Prefer systemInstruction when available; otherwise include a system content
    body["systemInstruction"] = {
      role: "system",
      parts: [{ text: systemPrompt }],
    } as GeminiContent;
  }

  if (Object.keys(generationConfig).length > 0) {
    body["generationConfig"] = generationConfig;
  }

  return dispatchProviderRequest<GeminiResponse>(
    {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
    modelProvider.name,
    afterRequestCallback
  );
}

function mapGeminiResponseToCommon(response: GeminiResponse): CommonResponse {
  const firstCandidate = response.candidates?.[0];
  const parts = firstCandidate?.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");

  return {
    id: `${Date.now()}`,
    model: response.modelVersion ?? "gemini",
    content: text,
    usage: {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    },
    stopReason: firstCandidate?.finishReason ?? "",
    stopSequence: null,
    created: Date.now(),
  };
}

export function OpenAIRequest(
	app: App,
	apiKey: string,
	model: Model,
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

		const modelProvider = getModelProvider(model.name);

		if (!modelProvider) {
			throw new Error(`Model ${model.name} not found with any provider.`);
		}

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

			// Route on the provider KIND (not the display name) so a custom-named
			// Anthropic/Gemini provider — e.g. { name: "Claude Proxy", kind: "anthropic" } —
			// gets the right wire shape here too, matching the ai.agent chat path.
			// getProviderKind falls back to name inference, so the built-in
			// "Anthropic"/"Gemini" providers are unchanged.
			const providerKind = getProviderKind(modelProvider);
			const attempt = async (
				params: Partial<OpenAIModelParameters>
			): Promise<CommonResponse> => {
				if (providerKind === "anthropic") {
					return mapAnthropicResponseToCommon(
						await makeAnthropicRequest(
							apiKey,
							model,
							modelProvider,
							systemPrompt,
							params,
							prompt,
							restoreCursor
						)
					);
				}
				if (providerKind === "gemini") {
					return mapGeminiResponseToCommon(
						await makeGeminiRequest(
							apiKey,
							model,
							modelProvider,
							systemPrompt,
							params,
							prompt,
							restoreCursor
						)
					);
				}
				return mapOpenAIResponseToCommon(
					await makeOpenAIRequest(
						apiKey,
						model,
						modelProvider,
						systemPrompt,
						params,
						prompt,
						restoreCursor
					)
				);
			};

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

			let response: CommonResponse;
			try {
				response = await attempt(initialParams);
			} catch (error) {
				const errorText =
					(error as { message?: string }).message ?? String(error);
				if (!isUnsupportedSamplingParamError(errorText, sentKeys)) {
					throw error;
				}
				const labels = describeSamplingParams(sentKeys);
				log.logMessage(
					`[AI Request ${requestLogId}] ${modelProvider.name} rejected ${labels}; retrying without sampling parameters.`
				);
				new Notice(
					`${model.name} doesn't accept the ${labels} setting${
						sentKeys.length > 1 ? "s" : ""
					}, so QuickAdd retried without ${
						sentKeys.length > 1 ? "them" : "it"
					}. You can remove ${
						sentKeys.length > 1 ? "them" : "it"
					} from this command's advanced settings.`
				);
				response = await attempt(stripSamplingParams(initialParams));
			}

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

			log.logError(error as Error);

			// Help users act on the most common failure: a prompt that overflows
			// the model's context window. (ChunkedPrompt retries these automatically;
			// the single-prompt path cannot, so we point the user at a remedy.)
			const guidance =
				classifyProviderError(error) === "input_context"
					? " The prompt likely exceeds the model's context window — shorten it, choose a model with a larger context, or use the chunked AI prompt API."
					: "";

			throw new Error(
				`Error while making request to ${modelProvider.name}: ${errorMessage}${guidance}`,
				{ cause: error }
			);
		}
	};
}

// ---------------------------------------------------------------------------
// Multi-turn chat entrypoint (#714) — used by the tool-calling Agent loop.
// Sibling to OpenAIRequest: the single-prompt path above stays byte-identical.
// Builds a provider body from a NormalizedChatRequest, dispatches, and parses
// tool calls. It does NOT arm preventCursorChange — the Agent captures the cursor
// ONCE per generate() and passes its restore fn here so intermediate turns don't
// re-arm it.
// ---------------------------------------------------------------------------
async function dispatchChat(
	kind: ProviderKind,
	apiKey: string,
	modelProvider: AIProvider,
	model: Model,
	body: Record<string, unknown>,
	afterRequestCallback?: () => void,
): Promise<Record<string, unknown>> {
	if (kind === "anthropic") {
		return dispatchProviderRequest<Record<string, unknown>>(
			{
				url: `${modelProvider.endpoint}/v1/messages`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify(body),
			},
			modelProvider.name,
			afterRequestCallback,
		);
	}
	if (kind === "gemini") {
		// Key as a header, never a `?key=` query parameter (see makeGeminiRequest).
		const url = `${modelProvider.endpoint}/v1beta/models/${encodeURIComponent(
			model.name,
		)}:generateContent`;
		return dispatchProviderRequest<Record<string, unknown>>(
			{
				url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": apiKey,
				},
				body: JSON.stringify(body),
			},
			modelProvider.name,
			afterRequestCallback,
		);
	}
	return dispatchProviderRequest<Record<string, unknown>>(
		{
			url: `${modelProvider.endpoint}/chat/completions`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		},
		modelProvider.name,
		afterRequestCallback,
	);
}

export async function chatRequest(
	app: App,
	apiKey: string,
	model: Model,
	request: NormalizedChatRequest,
	afterRequestCallback?: () => void,
): Promise<CommonResponse> {
	void app; // cursor handling is owned by the caller (Agent) for the whole loop
	if (settingsStore.getState().disableOnlineFeatures) {
		throw new Error(
			"Blocking request: Online features are disabled in settings.",
		);
	}

	const modelProvider = getModelProvider(model.name);
	if (!modelProvider) {
		throw new Error(`Model ${model.name} not found with any provider.`);
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
		let json: Record<string, unknown>;
		try {
			json = await dispatchChat(
				kind,
				apiKey,
				modelProvider,
				model,
				body,
				afterRequestCallback,
			);
		} catch (error) {
			// Same recovery as the single-prompt path: a rejected sampling param
			// gets ONE retry without sampling params, plus an explanation.
			const errorText =
				(error as { message?: string }).message ?? String(error);
			if (!isUnsupportedSamplingParamError(errorText, samplingKeysSent)) {
				throw error;
			}
			const labels = describeSamplingParams(samplingKeysSent);
			log.logMessage(
				`[AI Chat ${requestLogId}] ${modelProvider.name} rejected ${labels}; retrying without sampling parameters.`,
			);
			new Notice(
				`${model.name} doesn't accept the ${labels} setting${
					samplingKeysSent.length > 1 ? "s" : ""
				}, so QuickAdd retried without ${
					samplingKeysSent.length > 1 ? "them" : "it"
				}.`,
			);
			const strippedBody = buildChatBody(
				kind,
				model.name,
				{
					...effectiveRequest,
					modelParams: stripSamplingParams(
						effectiveRequest.modelParams ?? {},
					),
				},
				anthropicMaxTokens(model),
			);
			json = await dispatchChat(
				kind,
				apiKey,
				modelProvider,
				model,
				strippedBody,
				afterRequestCallback,
			);
		}
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
		log.logError(error as Error);
		throw new Error(
			`Error while making request to ${modelProvider.name}: ${errorMessage}`,
			{ cause: error },
		);
	}
}
