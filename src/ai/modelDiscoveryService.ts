import { requestUrl } from "obsidian";
import type { AIProvider, Model, ModelDiscoveryMode } from "./Provider";
import {
	fetchModelsDevDirectory,
	mapEndpointToModelsDevKey,
	mapModelsDevToQuickAdd,
} from "./modelsDirectory";
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

export async function discoverProviderModels(provider: AIProvider): Promise<Model[]> {
	const mode: ModelDiscoveryMode = provider.modelSource ?? "providerApi";
	if (mode === "modelsDev") {
		return fetchViaModelsDev(provider);
	}
	if (mode === "providerApi") {
		return fetchViaProviderApi(provider);
	}

	// auto: try provider API first, fall back to models.dev when possible
	try {
		return await fetchViaProviderApi(provider);
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

async function fetchViaProviderApi(provider: AIProvider): Promise<Model[]> {
	const { disableOnlineFeatures } = settingsStore.getState();
	if (disableOnlineFeatures) {
		throw new Error("Online features are disabled — enable them to browse provider models.");
	}
	if (!provider.endpoint) {
		throw new Error("Provider is missing an endpoint URL.");
	}
	const base = provider.endpoint.replace(/\/+$/, "");
	const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;

	const headers: Record<string, string> = {};
	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`;
	}

	let data: ProviderApiResponse;
	try {
		const response = await requestUrl({
			url,
			headers,
		});
		data = (await response.json) as ProviderApiResponse;
	} catch (err) {
		throw new Error(`Provider rejected /v1/models request: ${(err as Error).message}`);
	}

	const entries = extractModelsArray(data);
	const models: Model[] = [];
	for (const entry of entries) {
		const model = mapProviderEntry(entry);
		if (model) {
			models.push(model);
		}
	}

	if (!models.length) {
		throw new Error("Provider /v1/models response did not include any usable models.");
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
	throw new Error("Provider /v1/models response was not a list.");
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
