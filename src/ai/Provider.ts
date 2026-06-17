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
	/** If true, QuickAdd may auto-sync models from models.dev for this provider. */
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
	const endpoint = (provider.endpoint ?? "").toLowerCase();
	if (name === "anthropic" || endpoint.includes("api.anthropic.com")) {
		return "anthropic";
	}
	if (
		name === "gemini" ||
		endpoint.includes("generativelanguage.googleapis.com")
	) {
		return "gemini";
	}
	return "openai";
}

export interface Model {
	name: string;
	maxTokens: number;
}

const OpenAIProvider: AIProvider = {
	name: "OpenAI",
	endpoint: "https://api.openai.com/v1",
	kind: "openai",
	apiKey: "",
	models: [
		{
			name: "gpt-3.5-turbo",
			maxTokens: 4096,
		},
		{
			name: "gpt-3.5-turbo-16k",
			maxTokens: 16384,
		},
		{
			name: "gpt-3.5-turbo-1106",
			maxTokens: 16385,
		},
		{
			name: "gpt-4",
			maxTokens: 8192,
		},
		{
			name: "gpt-4-32k",
			maxTokens: 32768,
		},
		{
			name: "gpt-4-1106-preview",
			maxTokens: 128000,
		},
		{
			name: "gpt-4-turbo",
			maxTokens: 128000,
		},
		{
			name: "gpt-4o",
			maxTokens: 128000,
		},
		{
			name: "gpt-4o-mini",
			maxTokens: 128000,
		},
	],
	autoSyncModels: false,
	modelSource: "modelsDev",
};

const GeminiProvider: AIProvider = {
	name: "Gemini",
	endpoint: "https://generativelanguage.googleapis.com",
	kind: "gemini",
	apiKey: "",
	models: [
        {
            name: "gemini-1.5-pro",
            maxTokens: 1000000,
        },
        {
            name: "gemini-1.5-flash",
            maxTokens: 1000000,
        },
        {
            name: "gemini-1.5-flash-8b",
            maxTokens: 1000000,
        },
	],
	autoSyncModels: false,
	modelSource: "modelsDev",
};


export const DefaultProviders: AIProvider[] = [
    OpenAIProvider,
    GeminiProvider,
];
