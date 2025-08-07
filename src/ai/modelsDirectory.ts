import { requestUrl } from "obsidian";
import type { AIProvider, Model } from "./Provider";
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

export function mapEndpointToModelsDevKey(endpoint: string): string | null {
  const url = endpoint.toLowerCase();
  if (url.includes("openai.com")) return "openai";
  if (url.includes("openrouter.ai")) return "openrouter";
  if (url.includes("generativelanguage.googleapis.com")) return "google";
  if (url.includes("anthropic.com") || url.includes("anthropic"))
    return "anthropic";
  if (url.includes("groq.com")) return "groq";
  if (url.includes("together.ai")) return "togetherai";
  if (url.includes("huggingface.co") || url.includes("huggingface"))
    return "huggingface";
  if (url.includes("github") && url.includes("models")) return "github-models";
  if (url.includes("bedrock") || url.includes("aws")) return "amazon-bedrock";
  if (url.includes("modelscope")) return "modelscope";
  if (url.includes("dashscope")) return "alibaba";
  if (url.includes("fireworks.ai")) return "fireworks-ai";
  if (url.includes("vercel")) return "vercel";
  if (url.includes("inference.net")) return "inference";
  if (url.includes("z.ai") || url.includes("zhipu")) return "zhipuai";
  if (url.includes("deepseek.com")) return "deepseek";
  if (url.includes("cerebras")) return "cerebras";
  if (url.includes("venice.ai")) return "venice";
  if (url.includes("upstage.ai")) return "upstage";
  if (url.includes("llama.com") || url.includes("api.llama.com")) return "llama";
  if (url.includes("morphllm")) return "morph";
  if (url.includes("inceptionlabs.ai")) return "inception";
  if (url.includes("deepinfra")) return "deepinfra";
  if (url.includes("gateway.opencode.ai")) return "opencode";
  if (url.includes("router.huggingface.co")) return "huggingface";
  if (url.includes("inference.wandb.ai")) return "wandb";
  if (url.includes("api.githubcopilot.com")) return "github-copilot";
  if (url.includes("api.openai.com")) return "openai";
  return null;
}

export async function getModelsForProvider(
  provider: AIProvider
): Promise<ModelsDevModel[]> {
  const dir = await fetchModelsDevDirectory();
  const key = mapEndpointToModelsDevKey(provider.endpoint);
  if (!key || !(key in dir)) {
    throw new Error(
      `Could not determine models.dev provider for endpoint: ${provider.endpoint}`
    );
  }
  const mdp = dir[key];
  return Object.values(mdp.models);
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
