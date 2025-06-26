export interface AIProvider {
	name: string;
	endpoint: string;
	apiKey: string;
	models: Model[];
	/** Optional per-token cost in USD (for very rough cost tracking). */
	costPerToken?: {
		input: number;
		output: number;
	};
}

export interface Model {
	name: string;
	maxTokens: number;
	/** Override provider-level cost if available (USD per token) */
	costPerToken?: {
		input: number;
		output: number;
	};
}

const OpenAIProvider: AIProvider = {
	name: "OpenAI",
	endpoint: "https://api.openai.com/v1",
	apiKey: "",
	// Approximate costs for gpt-3.5-turbo (USD per 1 token). Keep simple until we track per-model.
	costPerToken: { input: 0.0000015, output: 0.000002 },
	models: [
		{
			name: "text-davinci-003",
			maxTokens: 4096,
		},
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
};


export const DefaultProviders: AIProvider[] = [
	OpenAIProvider,
];
