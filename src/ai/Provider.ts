export type ModelDiscoveryMode = "modelsDev" | "providerApi" | "auto";

export interface AIProvider {
	name: string;
	endpoint: string;
	apiKey: string;
	models: Model[];
	/** If true, QuickAdd may auto-sync models from models.dev for this provider. */
	autoSyncModels?: boolean;
	/** Controls how QuickAdd discovers browseable models for this provider. */
	modelSource: ModelDiscoveryMode;
}

export interface Model {
	name: string;
	maxTokens: number;
}

const OpenAIProvider: AIProvider = {
	name: "OpenAI",
	endpoint: "https://api.openai.com/v1",
	apiKey: "",
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
	autoSyncModels: false,
	modelSource: "modelsDev",
};

const GeminiProvider: AIProvider = {
	name: "Gemini",
	endpoint: "https://generativelanguage.googleapis.com",
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
