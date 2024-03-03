export interface AIProvider {
	name: string;
	endpoint: string;
	apiKey: string;
	models: Model[];
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
			name: "text-davinci-003",
			maxTokens: 4096,
		},
	],
};


export const DefaultProviders: AIProvider[] = [
	OpenAIProvider,
];
