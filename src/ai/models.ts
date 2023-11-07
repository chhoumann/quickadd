export const models = ["gpt-3.5-turbo", "gpt-3.5-turbo-16k", "gpt-3.5-turbo-1106", "gpt-4", "gpt-4-1106-preview", "gpt-4-32k", "text-davinci-003"] as const;
export const models_and_ask_me = [...models, "Ask me"] as const;
export type Model = typeof models[number];
export type Models_And_Ask_Me = typeof models_and_ask_me[number];
