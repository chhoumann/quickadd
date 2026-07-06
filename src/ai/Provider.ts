export type ModelDiscoveryMode = "modelsDev" | "providerApi" | "auto";

/**
 * Which wire protocol a provider speaks. Used to select the request/response
 * adapter for tool calling + structured output (#714) instead of matching the
 * provider's display NAME — a custom Anthropic-compatible provider named anything
 * other than "Anthropic" must still get the Anthropic wire shape.
 */
export type ProviderKind = "openai" | "anthropic" | "gemini";

export interface AIProvider {
	name: string;
	endpoint: string;
	/** SecretStorage key name for this provider's API key. */
	apiKeyRef?: string;
	/** Legacy plaintext API key stored in settings (migrated to SecretStorage). */
	apiKey: string;
	models: Model[];
	/** If true, QuickAdd may auto-sync models from the provider's model source. */
	autoSyncModels?: boolean;
	/** Controls how QuickAdd discovers browseable models for this provider. */
	modelSource: ModelDiscoveryMode;
	/** Wire protocol. Optional for back-compat; inferred when absent (see getProviderKind). */
	kind?: ProviderKind;
}

/**
 * Resolve a provider's wire kind. Prefers the explicit `kind` field; otherwise
 * infers from the (legacy) name/endpoint so providers saved before the field
 * existed still route correctly. Unknown → "openai" (the OpenAI-compatible default,
 * matching today's fallback branch).
 */
export function getProviderKind(provider: {
	kind?: ProviderKind;
	name?: string;
	endpoint?: string;
}): ProviderKind {
	if (provider.kind) return provider.kind;
	const name = (provider.name ?? "").toLowerCase();
	const host = endpointHost(provider.endpoint);
	// Match the parsed HOSTNAME precisely (exact or a real subdomain), not a raw
	// substring of the whole URL — so e.g. `https://evil.com/?api.anthropic.com`
	// can't be mistaken for Anthropic.
	const isHost = (h: string) => host === h || host.endsWith(`.${h}`);
	if (name === "anthropic" || isHost("api.anthropic.com")) {
		return "anthropic";
	}
	if (name === "gemini" || isHost("generativelanguage.googleapis.com")) {
		return "gemini";
	}
	return "openai";
}

/** Lowercased hostname of an endpoint, or "" if it can't be parsed (scheme optional). */
function endpointHost(endpoint?: string): string {
	const raw = (endpoint ?? "").trim();
	if (!raw) return "";
	for (const candidate of [raw, `https://${raw}`]) {
		try {
			return new URL(candidate).hostname.toLowerCase();
		} catch {
			/* try next form */
		}
	}
	return "";
}

export interface Model {
	name: string;
	/** Context window (total input budget) in tokens. Historical field name. */
	maxTokens: number;
	/** Output cap (max completion tokens), when known from model metadata. */
	maxOutputTokens?: number;
	/**
	 * False when the model rejects sampling parameters (temperature/top_p/…)
	 * outright — e.g. OpenAI reasoning models and Anthropic's current generation.
	 * Undefined means unknown; the request layer then relies on its automatic
	 * unsupported-parameter recovery instead.
	 */
	supportsTemperature?: boolean;
}

/**
 * Shipped model seeds, keyed by models.dev provider id. These exist ONLY as an
 * offline fallback: live discovery (models.dev / the provider's models endpoint)
 * is the source of truth, and auto-sync keeps lists current without plugin
 * releases. Each entry below was verified live (directory metadata + a real
 * completion) on 2026-07-07. When touching this table, re-verify against
 * https://models.dev/api.json and the provider APIs — never add ids from memory.
 */
export const CURRENT_MODEL_SEEDS: Record<
	"openai" | "google" | "anthropic",
	Model[]
> = {
	openai: [
		{ name: "gpt-5.5", maxTokens: 1_050_000, maxOutputTokens: 128_000, supportsTemperature: false },
		{ name: "gpt-5.4", maxTokens: 1_050_000, maxOutputTokens: 128_000, supportsTemperature: false },
		{ name: "gpt-5.4-mini", maxTokens: 400_000, maxOutputTokens: 128_000, supportsTemperature: false },
		{ name: "gpt-5.4-nano", maxTokens: 400_000, maxOutputTokens: 128_000, supportsTemperature: false },
		{ name: "gpt-4.1", maxTokens: 1_047_576, maxOutputTokens: 32_768, supportsTemperature: true },
		{ name: "gpt-4.1-mini", maxTokens: 1_047_576, maxOutputTokens: 32_768, supportsTemperature: true },
		{ name: "gpt-4o", maxTokens: 128_000, maxOutputTokens: 16_384, supportsTemperature: true },
		{ name: "gpt-4o-mini", maxTokens: 128_000, maxOutputTokens: 16_384, supportsTemperature: true },
		{ name: "o3", maxTokens: 200_000, maxOutputTokens: 100_000, supportsTemperature: false },
		{ name: "o4-mini", maxTokens: 200_000, maxOutputTokens: 100_000, supportsTemperature: false },
	],
	google: [
		{ name: "gemini-3.5-flash", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
		{ name: "gemini-3.1-pro-preview", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
		{ name: "gemini-3.1-flash-lite", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
		{ name: "gemini-3-pro-preview", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
		{ name: "gemini-3-flash-preview", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
		{ name: "gemini-2.5-pro", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
		{ name: "gemini-2.5-flash", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
		{ name: "gemini-2.5-flash-lite", maxTokens: 1_048_576, maxOutputTokens: 65_536, supportsTemperature: true },
	],
	anthropic: [
		{ name: "claude-fable-5", maxTokens: 1_000_000, maxOutputTokens: 128_000, supportsTemperature: false },
		{ name: "claude-sonnet-5", maxTokens: 1_000_000, maxOutputTokens: 128_000, supportsTemperature: false },
		{ name: "claude-opus-4-8", maxTokens: 1_000_000, maxOutputTokens: 128_000, supportsTemperature: false },
		{ name: "claude-opus-4-5", maxTokens: 200_000, maxOutputTokens: 64_000, supportsTemperature: true },
		{ name: "claude-haiku-4-5", maxTokens: 200_000, maxOutputTokens: 64_000, supportsTemperature: true },
	],
};

/**
 * Previously shipped seed models that are retired upstream (verified live
 * 2026-07-07: OpenAI returns 404 model_not_found, Gemini 404s the whole 1.5
 * family). The refresh migration removes exactly these — nothing else — from
 * providers on the official endpoints.
 */
export const RETIRED_SEED_MODELS: Record<"openai" | "google", string[]> = {
	openai: ["gpt-4-32k", "gpt-4-1106-preview"],
	google: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.5-flash-8b"],
};

/** Copy of a seed list so consumers can never mutate the shared catalog. */
export function cloneModelSeeds(
	key: keyof typeof CURRENT_MODEL_SEEDS,
): Model[] {
	return CURRENT_MODEL_SEEDS[key].map((model) => ({ ...model }));
}

const OpenAIProvider: AIProvider = {
	name: "OpenAI",
	endpoint: "https://api.openai.com/v1",
	kind: "openai",
	apiKey: "",
	models: cloneModelSeeds("openai"),
	autoSyncModels: true,
	modelSource: "modelsDev",
};

const GeminiProvider: AIProvider = {
	name: "Gemini",
	endpoint: "https://generativelanguage.googleapis.com",
	kind: "gemini",
	apiKey: "",
	models: cloneModelSeeds("google"),
	autoSyncModels: true,
	modelSource: "modelsDev",
};

export const DefaultProviders: AIProvider[] = [
	OpenAIProvider,
	GeminiProvider,
];
