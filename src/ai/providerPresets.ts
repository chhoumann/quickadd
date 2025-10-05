export interface ProviderPreset {
	name: string;
	endpoint: string;
	doc?: string;
	note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		doc: "https://platform.openai.com/docs/models",
	},
	{
		name: "Gemini",
		endpoint: "https://generativelanguage.googleapis.com",
		doc: "https://ai.google.dev/gemini-api/docs",
	},
	{
		name: "Anthropic",
		endpoint: "https://api.anthropic.com",
		doc: "https://docs.anthropic.com/",
	},
	{
		name: "Groq",
		endpoint: "https://api.groq.com/openai/v1",
		doc: "https://console.groq.com/docs/models",
	},
	{
		name: "TogetherAI",
		endpoint: "https://api.together.xyz/v1",
		doc: "https://docs.together.ai/docs/serverless-models",
	},
	{
		name: "OpenRouter",
		endpoint: "https://openrouter.ai/api/v1",
		doc: "https://openrouter.ai/models",
	},
	{
		name: "Hugging Face",
		endpoint: "https://router.huggingface.co/v1",
		doc: "https://huggingface.co/docs/inference-providers",
	},
	{
		name: "Mistral",
		endpoint: "https://api.mistral.ai/v1",
		doc: "https://docs.mistral.ai/getting-started/models/",
	},
	{
		name: "DeepSeek",
		endpoint: "https://api.deepseek.com",
		doc: "https://platform.deepseek.com/api-docs/",
	},
];
