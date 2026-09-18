import { requestUrl } from "obsidian";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import type { AIProvider, Model } from "./Provider";
import type { ProviderKind } from "./tools/providerToolMapping";
import type { NormalizedStopReason, NormalizedToolCall } from "./tools/NormalizedTools";
import { buildProviderError } from "./providerErrors";
import { providerSamplingParams } from "./samplingParams";

type RequestContext = {
	apiKey: string;
	provider: AIProvider;
	model: Model;
	afterRequest?: () => void;
};

// Restore the cursor after dispatch, before the HTTP result settles.
export async function dispatchProviderRequest<T>({
	kind, apiKey, provider, model, body, afterRequest,
}: RequestContext & {
	kind: ProviderKind;
	body: Record<string, unknown>;
}): Promise<T> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	let path: string;
	switch (kind) {
		case "anthropic":
			path = "/v1/messages";
			headers["x-api-key"] = apiKey;
			headers["anthropic-version"] = "2023-06-01";
			break;
		case "gemini":
			path = `/v1beta/models/${encodeURIComponent(model.name)}:generateContent`;
			headers["x-goog-api-key"] = apiKey;
			break;
		default:
			path = "/chat/completions";
			headers.Authorization = `Bearer ${apiKey}`;
	}
	const pending = requestUrl({
		url: provider.endpoint + path,
		method: "POST",
		headers,
		body: JSON.stringify(body),
		throw: false,
	});
	afterRequest?.();
	const response = await pending;
	if (response.status >= 400) throw buildProviderError(provider.name, response);
	return response.json as T;
}

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

// Non-text blocks may contain tool calls instead of text.
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

// Anthropic requires an output budget, distinct from the model context window.
// Prefer output-cap metadata; otherwise retain the conservative 4096 default.
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

function legacyBody(
	kind: ProviderKind,
	model: Model,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters>,
	prompt: string,
): Record<string, unknown> {
	if (kind !== "anthropic" && kind !== "gemini") {
		return {
			model: model.name,
			...modelParams,
			messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
		};
	}
	const sampling = providerSamplingParams(kind, modelParams);
	if (kind === "anthropic") {
		return {
			model: model.name,
			max_tokens: anthropicMaxTokens(model),
			messages: [{ role: "user", content: prompt }],
			...(systemPrompt && systemPrompt.trim().length > 0 ? { system: systemPrompt } : {}),
			...sampling,
		};
	}
	return {
		contents: [{ role: "user", parts: [{ text: prompt }] }],
		...(systemPrompt && systemPrompt.trim().length > 0 ? { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } } : {}),
		...(Object.keys(sampling).length ? { generationConfig: sampling } : {}),
	};
}

export async function requestPrompt({
	kind, systemPrompt, params, prompt, ...target
}: RequestContext & {
	kind: ProviderKind;
	systemPrompt: string;
	params: Partial<OpenAIModelParameters>;
	prompt: string;
}): Promise<CommonResponse> {
	const body = legacyBody(kind, target.model, systemPrompt, params, prompt);
	const request = { ...target, kind, body };
	switch (kind) {
		case "anthropic":
			return mapAnthropicResponseToCommon(await dispatchProviderRequest<AnthropicResponse>(request));
		case "gemini":
			return mapGeminiResponseToCommon(await dispatchProviderRequest<GeminiResponse>(request));
		default:
			return mapOpenAIResponseToCommon(await dispatchProviderRequest<OpenAIReqResponse>(request));
	}
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
