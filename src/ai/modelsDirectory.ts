import { requestUrl } from "obsidian";
import type { Model } from "./Provider";
import { settingsStore } from "src/settingsStore";

export type ModelsDevModel = {
  id: string;
  name?: string;
  limit?: { context?: number; output?: number };
};

export type ModelsDevProvider = {
  id: string;
  api?: string;
  name: string;
  models: Record<string, ModelsDevModel>;
};

export type ModelsDevDirectory = Record<string, ModelsDevProvider>;

let cachedDirectory: { data: ModelsDevDirectory; fetchedAt: number } | null = null;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

  const response = await requestUrl({
    url: "https://models.dev/api.json",
    method: "GET",
  });

  const data = (await response.json) as ModelsDevDirectory;
  cachedDirectory = { data, fetchedAt: Date.now() };
  return data;
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

export function mapModelsDevToQuickAdd(models: ModelsDevModel[]): Model[] {
  return models.map((m) => ({
    name: m.id,
    maxTokens: Math.max(1, Math.floor(m.limit?.context ?? 128000)),
  }));
}

export function dedupeModels(existing: Model[], incoming: Model[]): Model[] {
  const existingNames = new Set(existing.map((m) => m.name));
  const filtered = incoming.filter((m) => !existingNames.has(m.name));
  return existing.concat(filtered);
}
