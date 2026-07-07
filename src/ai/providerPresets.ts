import type { ModelDiscoveryMode, ProviderKind } from "./Provider";
import type { CURRENT_MODEL_SEEDS } from "./Provider";

export interface ProviderPreset {
  /**
   * Canonical stable provider id assigned when this preset is added (see
   * AIProvider["id"]). Must equal slugifyProviderId(name) so a pre-2.19
   * provider id-backfilled by migration matches a freshly added preset.
   */
  id: string;
  name: string;
  endpoint: string;
  doc?: string;
  note?: string;
  /** Wire protocol; recorded on the provider so routing never guesses from the name. */
  kind?: ProviderKind;
  /**
   * Where the card imports models from. OpenAI uses the curated models.dev
   * directory — its native /v1/models mixes ~90 non-chat entries (audio, image,
   * embeddings) into the list. Everyone else tries their own models endpoint
   * first and falls back to models.dev when mapped.
   */
  modelSource?: ModelDiscoveryMode;
  /** Offline-fallback seed list used when live import fails at add time. */
  seedKey?: keyof typeof CURRENT_MODEL_SEEDS;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    doc: "https://platform.openai.com/docs/models",
    kind: "openai",
    modelSource: "modelsDev",
    seedKey: "openai",
  },
  {
    id: "gemini",
    name: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com",
    doc: "https://ai.google.dev/gemini-api/docs",
    kind: "gemini",
    modelSource: "auto",
    seedKey: "google",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    endpoint: "https://api.anthropic.com",
    doc: "https://docs.anthropic.com/",
    kind: "anthropic",
    modelSource: "auto",
    seedKey: "anthropic",
  },
  {
    id: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    doc: "https://console.groq.com/docs/models",
    kind: "openai",
    modelSource: "auto",
  },
  {
    id: "togetherai",
    name: "TogetherAI",
    endpoint: "https://api.together.xyz/v1",
    doc: "https://docs.together.ai/docs/serverless-models",
    kind: "openai",
    modelSource: "auto",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    doc: "https://openrouter.ai/models",
    kind: "openai",
    modelSource: "auto",
  },
  {
    id: "hugging-face",
    name: "Hugging Face",
    endpoint: "https://router.huggingface.co/v1",
    doc: "https://huggingface.co/docs/inference-providers",
    kind: "openai",
    modelSource: "auto",
  },
  {
    id: "mistral",
    name: "Mistral",
    endpoint: "https://api.mistral.ai/v1",
    doc: "https://docs.mistral.ai/getting-started/models/",
    kind: "openai",
    modelSource: "auto",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    doc: "https://platform.deepseek.com/api-docs/",
    kind: "openai",
    modelSource: "auto",
  },
];
