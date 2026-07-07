import { requestUrl } from "obsidian";
import type { AIProvider, Model, ModelDiscoveryMode } from "./Provider";
import { CURRENT_MODEL_SEEDS, getProviderKind } from "./Provider";
import {
	enrichModelsWithDirectoryMetadata,
	fetchModelsDevDirectory,
	mapEndpointToModelsDevKey,
	mapModelsDevToQuickAdd,
} from "./modelsDirectory";
import { buildProviderError } from "./providerErrors";
import { settingsStore } from "src/settingsStore";

const DEFAULT_MAX_TOKENS = 128_000;

type ProviderApiModel = {
	id?: string;
	name?: string;
	context_length?: number | string;
	contextLength?: number | string;
	context_tokens?: number | string;
	max_context_tokens?: number | string;
	max_context_length?: number | string;
	max_input_tokens?: number | string;
	max_tokens?: number | string;
	limit?: { context?: number | string; output?: number | string };
	[extra: string]: unknown;
};

type ProviderApiResponse =
	| ProviderApiModel[]
	| { data?: ProviderApiModel[] }
	| { object?: string; data?: ProviderApiModel[] };

export async function discoverProviderModels(
	provider: AIProvider,
	apiKeyOverride?: string | null,
): Promise<Model[]> {
	const mode: ModelDiscoveryMode = provider.modelSource ?? "providerApi";
	if (mode === "modelsDev") {
		return fetchViaModelsDev(provider);
	}
	if (mode === "providerApi") {
		return fetchViaProviderApi(provider, apiKeyOverride);
	}

	// auto: try provider API first, fall back to models.dev when possible
	try {
		return await fetchViaProviderApi(provider, apiKeyOverride);
	} catch (err) {
		const fallbackKey = mapEndpointToModelsDevKey(provider.endpoint);
		if (!fallbackKey) {
			throw err;
		}
		return fetchViaModelsDev(provider, err);
	}
}

async function fetchViaModelsDev(provider: AIProvider, previousError?: unknown): Promise<Model[]> {
	try {
		const directory = await fetchModelsDevDirectory();
		const key = mapEndpointToModelsDevKey(provider.endpoint);
		if (!key || !(key in directory)) {
			throw new Error(
				`models.dev does not list a provider that matches ${provider.endpoint}.`
			);
		}
		const models = Object.values(directory[key].models);
		return mapModelsDevToQuickAdd(models);
	} catch (err) {
		if (previousError) {
			throw new Error(
				`Provider API failed (${(previousError as Error).message}). Fallback to models.dev also failed: ${(err as Error).message}`,
			);
		}
		throw err;
	}
}

async function fetchViaProviderApi(
	provider: AIProvider,
	apiKeyOverride?: string | null,
): Promise<Model[]> {
	const { disableOnlineFeatures } = settingsStore.getState();
	if (disableOnlineFeatures) {
		throw new Error("Online features are disabled — enable them to browse provider models.");
	}
	if (!provider.endpoint) {
		throw new Error("Provider is missing an endpoint URL.");
	}
	const apiKey = apiKeyOverride ?? provider.apiKey ?? "";

	// Each wire protocol has its own models endpoint AND its own auth scheme.
	// A Bearer header on Anthropic or Gemini is a guaranteed 401 (verified live),
	// so route by provider kind — exactly like the chat request layer does.
	const kind = getProviderKind(provider);
	const models =
		kind === "anthropic"
			? await fetchAnthropicModels(provider, apiKey)
			: kind === "gemini"
				? await fetchGeminiModels(provider, apiKey)
				: await fetchOpenAICompatibleModels(provider, apiKey);

	if (!models.length) {
		throw new Error("The provider's models endpoint did not include any usable models.");
	}

	// The native endpoints rarely report output caps or sampling support;
	// overlay models.dev metadata for ids it knows (best effort), then fill
	// remaining gaps from the shipped seed catalog so an offline models.dev
	// never downgrades a known model to placeholder limits.
	const enriched = await enrichModelsWithDirectoryMetadata(
		provider.endpoint,
		models,
	);
	return applySeedMetadataFallback(provider.endpoint, enriched);
}

/**
 * Offline metadata net: when models.dev was unreachable (or doesn't know an
 * id), matching entries from the shipped seed catalog supply the context
 * window, output cap, and sampling support that request routing depends on.
 */
function applySeedMetadataFallback(endpoint: string, models: Model[]): Model[] {
	const key = mapEndpointToModelsDevKey(endpoint);
	if (key !== "openai" && key !== "google" && key !== "anthropic") {
		return models;
	}
	const seeds = new Map(CURRENT_MODEL_SEEDS[key].map((s) => [s.name, s]));
	return models.map((model) => {
		const seed = seeds.get(model.name);
		if (!seed) return model;
		return {
			...model,
			// Only replace the fabricated placeholder — a real limit reported by
			// the provider or the directory wins over the seed.
			maxTokens:
				model.maxTokens === DEFAULT_MAX_TOKENS
					? seed.maxTokens
					: model.maxTokens,
			maxOutputTokens: model.maxOutputTokens ?? seed.maxOutputTokens,
			supportsTemperature:
				model.supportsTemperature ?? seed.supportsTemperature,
		};
	});
}

async function requestProviderJson<T>(
	provider: AIProvider,
	url: string,
	headers: Record<string, string>,
): Promise<T> {
	try {
		// Use `throw: false` so we can read the response body ourselves and turn
		// any 4xx/5xx into a structured provider error (e.g. "invalid api key")
		// instead of Obsidian's bare "Request failed, status N".
		const response = await requestUrl({
			url,
			headers,
			throw: false,
		});
		if (response.status >= 400) {
			throw buildProviderError(provider.name, response);
		}
		return (await response.json) as T;
	} catch (err) {
		throw new Error(`Provider rejected the models request: ${(err as Error).message}`);
	}
}

// OpenAI-compatible /v1/models responses carry no capability metadata, so
// non-chat entries can only be recognized by name. These families cannot serve
// chat completions (verified against the live OpenAI and Groq catalogs):
// speech-to-text, text-to-speech, embeddings, image generation, moderation,
// rerankers, and realtime/audio-only endpoints.
const NON_CHAT_MODEL_ID_RE =
	/(whisper|-tts|tts-|embed|dall-e|image|moderation|transcribe|realtime|rerank)/i;

async function fetchOpenAICompatibleModels(
	provider: AIProvider,
	apiKey: string,
): Promise<Model[]> {
	const base = provider.endpoint.replace(/\/+$/, "");
	const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;

	const headers: Record<string, string> = {};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const data = await requestProviderJson<ProviderApiResponse>(provider, url, headers);
	const entries = extractModelsArray(data);
	const models: Model[] = [];
	for (const entry of entries) {
		const model = mapProviderEntry(entry);
		if (model && !NON_CHAT_MODEL_ID_RE.test(model.name)) {
			models.push(model);
		}
	}
	return models;
}

type AnthropicModelsResponse = {
	data?: Array<{ id?: string; type?: string }>;
	has_more?: boolean;
	last_id?: string | null;
};

async function fetchAnthropicModels(
	provider: AIProvider,
	apiKey: string,
): Promise<Model[]> {
	const base = provider.endpoint.replace(/\/+$/, "");
	const headers: Record<string, string> = {
		"anthropic-version": "2023-06-01",
	};
	if (apiKey) {
		headers["x-api-key"] = apiKey;
	}

	// Paginated; page size maxes out at 1000 which is far beyond the catalog,
	// but follow `has_more` anyway so we never silently truncate.
	const models: Model[] = [];
	let afterId: string | null = null;
	for (let page = 0; page < 10; page++) {
		const url: string =
			`${base}/v1/models?limit=1000` +
			(afterId ? `&after_id=${encodeURIComponent(afterId)}` : "");
		const data: AnthropicModelsResponse =
			await requestProviderJson<AnthropicModelsResponse>(
				provider,
				url,
				headers,
			);
		for (const entry of data.data ?? []) {
			if (entry.id) {
				models.push({ name: entry.id, maxTokens: DEFAULT_MAX_TOKENS });
			}
		}
		if (!data.has_more || !data.last_id) break;
		afterId = data.last_id;
	}
	return models;
}

type GeminiModelsResponse = {
	models?: Array<{
		name?: string;
		inputTokenLimit?: number;
		outputTokenLimit?: number;
		supportedGenerationMethods?: string[];
	}>;
	nextPageToken?: string;
};

async function fetchGeminiModels(
	provider: AIProvider,
	apiKey: string,
): Promise<Model[]> {
	const base = provider.endpoint.replace(/\/+$/, "");
	// The key travels as a header (verified live) — a `?key=` query parameter
	// would leak it into request logs and proxies.
	const headers: Record<string, string> = {};
	if (apiKey) {
		headers["x-goog-api-key"] = apiKey;
	}
	const models: Model[] = [];
	let pageToken: string | null = null;
	for (let page = 0; page < 10; page++) {
		const url: string =
			`${base}/v1beta/models?pageSize=1000` +
			(pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
		const data: GeminiModelsResponse =
			await requestProviderJson<GeminiModelsResponse>(provider, url, headers);
		for (const entry of data.models ?? []) {
			if (!entry.name) continue;
			// Only models that can serve generateContent belong in a chat model
			// list — the catalog also carries embedding/TTS/image entries.
			const methods = entry.supportedGenerationMethods;
			if (Array.isArray(methods) && !methods.includes("generateContent")) {
				continue;
			}
			const model: Model = {
				// The API name is "models/gemini-2.5-flash"; requests take the bare id.
				name: entry.name.replace(/^models\//, ""),
				maxTokens:
					typeof entry.inputTokenLimit === "number" &&
					entry.inputTokenLimit > 0
						? entry.inputTokenLimit
						: DEFAULT_MAX_TOKENS,
			};
			if (
				typeof entry.outputTokenLimit === "number" &&
				entry.outputTokenLimit > 0
			) {
				model.maxOutputTokens = entry.outputTokenLimit;
			}
			models.push(model);
		}
		if (!data.nextPageToken) break;
		pageToken = data.nextPageToken;
	}
	return models;
}

function extractModelsArray(payload: ProviderApiResponse): ProviderApiModel[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
		return payload.data;
	}
	throw new Error("The provider's models response was not a list.");
}

function mapProviderEntry(entry: ProviderApiModel): Model | null {
	const name = entry.id ?? entry.name;
	if (!name) {
		return null;
	}
	return {
		name,
		maxTokens: deriveMaxTokens(entry),
	};
}

function deriveMaxTokens(entry: ProviderApiModel): number {
	const candidates = [
		entry.context_length,
		entry.contextLength,
		entry.context_tokens,
		entry.max_context_tokens,
		entry.max_context_length,
		entry.max_input_tokens,
		entry.max_tokens,
		entry.limit?.context,
	];

	for (const candidate of candidates) {
		const value = coerceNumber(candidate);
		if (value && value > 0) {
			return Math.floor(value);
		}
	}

	return DEFAULT_MAX_TOKENS;
}

function coerceNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}
