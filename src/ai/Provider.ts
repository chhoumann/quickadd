export type ModelDiscoveryMode = "modelsDev" | "providerApi" | "auto";

/**
 * Which wire protocol a provider speaks. Used to select the request/response
 * adapter for tool calling + structured output (#714) instead of matching the
 * provider's display NAME — a custom Anthropic-compatible provider named anything
 * other than "Anthropic" must still get the Anthropic wire shape.
 */
export type ProviderKind = "openai" | "anthropic" | "gemini";

export interface AIProvider {
	/**
	 * Stable identity used by persisted model references and the script API's
	 * qualified `providerId/model` form. A lowercase slug, unique across the
	 * configured providers, never containing "/" (the qualified-form delimiter).
	 * Immutable once assigned — `name` is the editable display label.
	 * Optional only because pre-2.19 data.json files lack it; every creation
	 * path and the pinAiModelRefs migration assign one.
	 */
	id?: string;
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

/**
 * Provider-scoped model reference. The persisted identity of a pinned model:
 * a bare name string cannot express WHICH provider serves it once two
 * providers list the same id (#1495). Persisted alongside the legacy bare-name
 * string, which writers keep in sync (`model === modelRef.name`) so downgrades
 * and cross-vault imports degrade to today's first-match behavior.
 */
export interface ModelRef {
	providerId: string;
	name: string;
}

/**
 * Derive a provider id slug from a display name: lowercase, `a-z0-9-` only.
 * The charset intentionally excludes "/" so splitting a qualified
 * `providerId/model` string at its FIRST slash is unambiguous even for models
 * whose own names contain slashes (OpenRouter's `openai/gpt-4o` etc.).
 */
export function slugifyProviderId(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "provider";
}

/**
 * A provider id equal to the slug of `base`, or `-2`, `-3`, … suffixed when
 * other providers already claim it. Every creation path goes through here so
 * two providers can never share an id and no id can ever contain "/" —
 * enforced HERE rather than by caller discipline.
 */
export function uniqueProviderId(
	base: string,
	providers: AIProvider[],
): string {
	const slug = slugifyProviderId(base);
	const taken = new Set(
		providers.map((p) => p.id).filter((id): id is string => !!id),
	);

	let candidate = slug;
	for (let i = 2; taken.has(candidate); i++) {
		candidate = `${slug}-${i}`;
	}

	return candidate;
}

/**
 * Give every provider a unique stable id. Providers without one (pre-2.19
 * data, hand-edited data.json) get a fresh slug; when two providers CLAIM the
 * same id (only possible via hand-editing), the first keeps it — so refs
 * pointing at the duplicated id keep resolving to the provider they resolve
 * to today — and later claimants are reassigned. Returns true when anything
 * changed, so callers know the settings need persisting.
 */
export function ensureProviderIds(providers: AIProvider[]): boolean {
	let changed = false;
	const seen = new Set<string>();
	for (const provider of providers) {
		if (provider.id && !seen.has(provider.id)) {
			seen.add(provider.id);
			continue;
		}

		provider.id = uniqueProviderId(
			provider.id ?? provider.name,
			providers,
		);
		seen.add(provider.id);
		changed = true;
	}

	return changed;
}

/**
 * The ref, but only while it still matches the legacy string field. The two
 * can drift apart when an older QuickAdd (which writes only `model`) edited a
 * command after an upgrade pinned it — a stale ref must never override what
 * the user visibly selected. Drift makes the ref inert; re-selecting the
 * model in the dropdown re-pins it.
 */
export function activeModelRef(
	model: string | undefined,
	modelRef: ModelRef | undefined,
): ModelRef | undefined {
	return modelRef && modelRef.name === model ? modelRef : undefined;
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
	id: "openai",
	name: "OpenAI",
	endpoint: "https://api.openai.com/v1",
	kind: "openai",
	apiKey: "",
	models: cloneModelSeeds("openai"),
	autoSyncModels: true,
	modelSource: "modelsDev",
};

const GeminiProvider: AIProvider = {
	id: "gemini",
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
