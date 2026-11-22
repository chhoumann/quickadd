import { requestUrl } from "obsidian";
import type { AIProvider, ChatWire, Model, ProviderKind } from "./Provider";
import { providerAuthHeaders, providerUrl } from "./Provider";
import type { NormalizedStopReason, NormalizedToolCall } from "./tools/NormalizedTools";
import type { ParsedChatResult } from "./tools/providerToolMapping";
import { buildProviderError } from "./providerErrors";

function wirePath(wire: ChatWire, model: Model): string {
	switch (wire) {
		case "anthropic":
			return "/v1/messages";
		case "gemini":
			return `/v1beta/models/${encodeURIComponent(model.name)}:generateContent`;
		case "openai-responses":
			return "/responses";
		default:
			return "/chat/completions";
	}
}

/** The protocol family a wire belongs to, which decides its auth headers. */
function wireKind(wire: ChatWire): ProviderKind {
	return wire === "openai-responses" ? "openai" : wire;
}

// Restore the cursor after dispatch, before the HTTP result settles.
export async function dispatchProviderRequest({
	kind, apiKey, provider, model, body, afterRequest,
}: {
	kind: ChatWire;
	apiKey: string;
	provider: AIProvider;
	model: Model;
	body: Record<string, unknown>;
	afterRequest?: () => void;
}): Promise<Record<string, unknown>> {
	const pending = requestUrl({
		url: providerUrl(provider.endpoint, wirePath(kind, model)),
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...providerAuthHeaders(wireKind(kind), apiKey),
		},
		body: JSON.stringify(body),
		throw: false,
	});
	afterRequest?.();
	const response = await pending;
	if (response.status >= 400) throw buildProviderError(provider.name, response);
	return response.json as Record<string, unknown>;
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

/**
 * The fields every request path reports, from the parsed reply plus the
 * envelope fields a provider may include (its own id, model, timestamp, and
 * Anthropic's matched stop sequence).
 */
export function toCommonResponse(
	json: Record<string, unknown>,
	parsed: ParsedChatResult,
	model: Model,
): CommonResponse {
	const reportedModel = json.model ?? json.modelVersion;
	return {
		id: typeof json.id === "string" ? json.id : `${Date.now()}`,
		model: typeof reportedModel === "string" ? reportedModel : model.name,
		content: parsed.content,
		usage: parsed.usage,
		stopReason: parsed.rawStopReason,
		stopSequence: typeof json.stop_sequence === "string" ? json.stop_sequence : null,
		created: typeof json.created === "number" ? json.created : Date.now(),
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
