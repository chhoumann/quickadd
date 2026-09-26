import { normalizePath, requestUrl } from "obsidian";
import type { DataAdapter } from "obsidian";
import type { Model } from "./Provider";
import { settingsStore } from "src/settingsStore";
import { log } from "src/logger/logManager";

export type ModelsDevModel = {
  id: string;
  name?: string;
  family?: string;
  /** False when the model rejects sampling parameters (temperature/top_p). */
  temperature?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
};

export type ModelsDevProvider = {
  id: string;
  api?: string;
  name: string;
  models: Record<string, ModelsDevModel>;
};

export type ModelsDevDirectory = Record<string, ModelsDevProvider>;

const MODELS_DEV_URL = "https://models.dev/api.json";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the last downloaded directory lives between Obsidian launches.
 * main.ts backs this with a file in the plugin folder; tests use a fake.
 */
export interface ModelsDirectoryDiskCache {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

type PersistedDirectory = { etag?: string; data: ModelsDevDirectory };

let diskCache: ModelsDirectoryDiskCache | null = null;
let cachedDirectory: { data: ModelsDevDirectory; fetchedAt: number } | null = null;
let inFlight: Promise<ModelsDevDirectory> | null = null;

export const MODELS_DIRECTORY_CACHE_FILE = "models-dev-cache.json";

/**
 * Disk cache backed by a file in the plugin folder, next to data.json but
 * separate from it: the directory is ~5 MB and settings saves rewrite data.json.
 */
export function pluginFolderDirectoryCache(
  adapter: Pick<DataAdapter, "exists" | "read" | "write">,
  pluginDir: string,
): ModelsDirectoryDiskCache {
  const path = normalizePath(`${pluginDir}/${MODELS_DIRECTORY_CACHE_FILE}`);
  return {
    read: async () => ((await adapter.exists(path)) ? adapter.read(path) : null),
    write: (contents) => adapter.write(path, contents),
  };
}

export function setModelsDirectoryDiskCache(
  cache: ModelsDirectoryDiskCache | null,
): void {
  diskCache = cache;
  cachedDirectory = null;
}

/**
 * The models.dev directory (~5 MB). Kept in memory for a day, and on disk
 * across launches: the first fetch of a session revalidates the disk copy with
 * If-None-Match, so an unchanged directory costs a bodiless 304 instead of a
 * full download. If revalidation fails, the disk copy is used as-is.
 */
export async function fetchModelsDevDirectory(): Promise<ModelsDevDirectory> {
  if (
    cachedDirectory &&
    Date.now() - cachedDirectory.fetchedAt < ONE_DAY_MS
  ) {
    return cachedDirectory.data;
  }

  if (settingsStore.getState().disableOnlineFeatures) {
    throw new Error(
      "Fetching models directory is disabled: Online features are turned off."
    );
  }

  inFlight ??= revalidateDirectory().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function revalidateDirectory(): Promise<ModelsDevDirectory> {
  const persisted = await readPersistedDirectory();

  let fresh: PersistedDirectory;
  try {
    const response = await requestUrl({
      url: MODELS_DEV_URL,
      method: "GET",
      headers: persisted?.etag ? { "If-None-Match": persisted.etag } : undefined,
    });
    if (response.status === 304 && persisted) {
      return remember(persisted.data);
    }
    const data: unknown = response.json;
    if (!isDirectory(data)) {
      throw new Error("models.dev returned an unexpected response.");
    }
    fresh = { etag: headerValue(response.headers, "etag"), data };
  } catch (err) {
    if (!persisted) throw err;
    log.logMessage(
      `Could not refresh the models.dev directory; using the saved copy. ${
        (err as Error)?.message ?? String(err)
      }`,
    );
    return remember(persisted.data);
  }

  await writePersistedDirectory(fresh);
  return remember(fresh.data);
}

/** A directory is a non-empty object of providers; anything else is unusable. */
function isDirectory(value: unknown): value is ModelsDevDirectory {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function remember(data: ModelsDevDirectory): ModelsDevDirectory {
  cachedDirectory = { data, fetchedAt: Date.now() };
  return data;
}

function headerValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const match = Object.keys(headers ?? {}).find(
    (key) => key.toLowerCase() === name,
  );
  return match ? headers[match] : undefined;
}

async function readPersistedDirectory(): Promise<PersistedDirectory | null> {
  if (!diskCache) return null;
  try {
    const raw = await diskCache.read();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedDirectory>;
    if (!isDirectory(parsed.data)) return null;
    return {
      etag: typeof parsed.etag === "string" ? parsed.etag : undefined,
      data: parsed.data,
    };
  } catch (err) {
    // A corrupt or unreadable cache is just a cache miss.
    log.logMessage(
      `Ignoring unreadable models.dev cache: ${(err as Error)?.message ?? String(err)}`,
    );
    return null;
  }
}

async function writePersistedDirectory(entry: PersistedDirectory): Promise<void> {
  if (!diskCache) return;
  try {
    await diskCache.write(JSON.stringify(entry));
  } catch (err) {
    // Failing to persist only costs a re-download next launch.
    log.logMessage(
      `Could not save the models.dev cache: ${(err as Error)?.message ?? String(err)}`,
    );
  }
}

// Extract the lowercased hostname from an endpoint, tolerating a missing
// scheme (e.g. "api.openai.com/v1"). Returns "" when it can't be parsed.
function endpointHost(endpoint: string): string {
  for (const candidate of [endpoint, `https://${endpoint}`]) {
    try {
      // A scheme-less "host:port/path" parses as an opaque scheme with an empty
      // hostname; require a real hostname so such inputs fall through to the
      // https://-prefixed candidate instead of resolving to "".
      const host = new URL(candidate).hostname.toLowerCase();
      if (host) return host;
    } catch {
      // try the next candidate
    }
  }
  return "";
}

export function mapEndpointToModelsDevKey(endpoint: string): string | null {
  const url = endpoint.toLowerCase();
  const host = endpointHost(endpoint);

  // Match a provider domain against the URL's hostname (or a subdomain of it)
  // so it can't be spoofed by the domain appearing elsewhere in the URL — e.g.
  // "https://evil.com/api.openai.com" or "https://openai.com.evil.com"
  // (CodeQL js/incomplete-url-substring-sanitization). Bare-keyword checks
  // below stay as loose substring matches on purpose (they identify providers
  // reached via proxy/custom URLs).
  const hostMatches = (domain: string): boolean =>
    host === domain || host.endsWith(`.${domain}`);

  if (hostMatches("openai.com")) return "openai";
  if (hostMatches("openrouter.ai")) return "openrouter";
  if (hostMatches("generativelanguage.googleapis.com")) return "google";
  if (url.includes("anthropic")) return "anthropic";
  if (hostMatches("groq.com")) return "groq";
  if (hostMatches("together.ai") || hostMatches("together.xyz"))
    return "togetherai";
  if (url.includes("huggingface")) return "huggingface";
  if (url.includes("github") && url.includes("models")) return "github-models";
  if (url.includes("bedrock") || url.includes("aws")) return "amazon-bedrock";
  if (url.includes("modelscope")) return "modelscope";
  if (url.includes("dashscope")) return "alibaba";
  if (hostMatches("fireworks.ai")) return "fireworks-ai";
  if (url.includes("vercel")) return "vercel";
  if (hostMatches("inference.net")) return "inference";
  if (hostMatches("z.ai") || url.includes("zhipu")) return "zhipuai";
  if (hostMatches("deepseek.com")) return "deepseek";
  if (hostMatches("mistral.ai")) return "mistral";
  if (url.includes("cerebras")) return "cerebras";
  if (hostMatches("venice.ai")) return "venice";
  if (hostMatches("upstage.ai")) return "upstage";
  if (hostMatches("llama.com")) return "llama";
  if (url.includes("morphllm")) return "morph";
  if (hostMatches("inceptionlabs.ai")) return "inception";
  if (url.includes("deepinfra")) return "deepinfra";
  if (hostMatches("opencode.ai")) return "opencode";
  if (hostMatches("inference.wandb.ai")) return "wandb";
  if (hostMatches("githubcopilot.com")) return "github-copilot";
  return null;
}

/**
 * Keep only models a chat completion can actually run on. The directory also
 * lists image generators (context 0), TTS voices (no text output), and
 * embedding models (an "output" that is a vector dimension, plus an
 * embedding family/id) — importing those into a chat model dropdown only
 * produces hard failures. Unknown shapes are kept: this filter drops entries
 * only on positive evidence.
 */
export function isChatCapableDirectoryModel(model: ModelsDevModel): boolean {
  const output = model.modalities?.output;
  if (Array.isArray(output) && !output.includes("text")) return false;

  const limit = model.limit ?? {};
  if (typeof limit.context === "number" && limit.context <= 0) return false;
  if (typeof limit.output === "number" && limit.output <= 1) return false;

  const family = (model.family ?? "").toLowerCase();
  const id = model.id.toLowerCase();
  if (family.includes("embedding") || id.includes("embedding")) return false;

  return true;
}

export function mapModelsDevToQuickAdd(models: ModelsDevModel[]): Model[] {
  return models.filter(isChatCapableDirectoryModel).map((m) => {
    const model: Model = {
      name: m.id,
      maxTokens: Math.max(1, Math.floor(m.limit?.context ?? 128000)),
    };
    if (typeof m.limit?.output === "number" && m.limit.output > 0) {
      model.maxOutputTokens = Math.floor(m.limit.output);
    }
    if (typeof m.temperature === "boolean") {
      model.supportsTemperature = m.temperature;
    }
    return model;
  });
}

/**
 * Best-effort metadata overlay for models discovered via a provider's own
 * models endpoint (which rarely reports output caps or sampling support).
 * When the endpoint maps to a models.dev provider, matching ids inherit the
 * directory's context/output/sampling metadata. Directory unavailability is
 * not an error — the models are still usable without the extra metadata.
 */
export async function enrichModelsWithDirectoryMetadata(
  endpoint: string,
  models: Model[],
): Promise<Model[]> {
  const key = mapEndpointToModelsDevKey(endpoint);
  if (!key) return models;

  let directory: ModelsDevDirectory;
  try {
    directory = await fetchModelsDevDirectory();
  } catch {
    return models;
  }
  const entries = directory[key]?.models;
  if (!entries) return models;

  return models.map((model) => {
    const entry = entries[model.name];
    if (!entry) return model;
    const enriched: Model = { ...model };
    if (typeof entry.limit?.context === "number" && entry.limit.context > 0) {
      enriched.maxTokens = Math.floor(entry.limit.context);
    }
    if (
      enriched.maxOutputTokens === undefined &&
      typeof entry.limit?.output === "number" &&
      entry.limit.output > 0
    ) {
      enriched.maxOutputTokens = Math.floor(entry.limit.output);
    }
    if (
      enriched.supportsTemperature === undefined &&
      typeof entry.temperature === "boolean"
    ) {
      enriched.supportsTemperature = entry.temperature;
    }
    return enriched;
  });
}

export function dedupeModels(existing: Model[], incoming: Model[]): Model[] {
  const existingNames = new Set(existing.map((m) => m.name));
  const filtered = incoming.filter((m) => !existingNames.has(m.name));
  return existing.concat(filtered);
}

/**
 * Sync merge: append models the provider doesn't have yet AND refresh the
 * metadata (context window, output cap, sampling support) of the ones it does.
 * Token estimation and chunk sizing read these fields, so a sync must carry
 * forward corrected limits — append-only dedupe would pin stale assumptions
 * forever. Never removes anything: users may rely on manually added entries.
 */
export function mergeModels(existing: Model[], incoming: Model[]): Model[] {
  const incomingByName = new Map(incoming.map((m) => [m.name, m]));

  const refreshed = existing.map((model) => {
    const update = incomingByName.get(model.name);
    if (!update) return model;
    return {
      ...model,
      maxTokens: update.maxTokens,
      maxOutputTokens: update.maxOutputTokens ?? model.maxOutputTokens,
      supportsTemperature:
        update.supportsTemperature ?? model.supportsTemperature,
    };
  });

  const existingNames = new Set(existing.map((m) => m.name));
  const added = incoming.filter((m) => !existingNames.has(m.name));
  return refreshed.concat(added);
}
