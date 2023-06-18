import type { Model } from "./models";
import { requestUrl } from "obsidian";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { settingsStore } from "src/settingsStore";
import { getTokenCount } from "./AIAssistant";
import { getModelMaxTokens } from "./getModelMaxTokens";

type ReqResponse = {
    id: string;
    model: string;
    object: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    choices: {
        finish_reason: string;
        index: number;
        message: { content: string; role: string; };
    }[];
    created: number;
};
export function OpenAIRequest(
    apiKey: string,
    model: Model,
    systemPrompt: string,
    modelParams: Partial<OpenAIModelParameters> = {}
) {
    return async function makeRequest(prompt: string) {
        if (settingsStore.getState().disableOnlineFeatures) {
            throw new Error(
                "Blocking request to OpenAI: Online features are disabled in settings."
            );
        }

        const tokenCount = getTokenCount(prompt) + getTokenCount(systemPrompt);
        const maxTokens = getModelMaxTokens(model);

        if (tokenCount > maxTokens) {
            throw new Error(
                `The ${model} API has a token limit of ${maxTokens}. Your prompt has ${tokenCount} tokens.`
            );
        }

        try {
            const response = await requestUrl({
                url: `https://api.openai.com/v1/chat/completions`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    ...modelParams,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: prompt },
                    ],
                }),
            });

            return response.json as ReqResponse;
        } catch (error) {
            console.log(error);
            throw new Error(
                `Error while making request to OpenAI API: ${(error as { message: string; }).message}`
            );
        }
    };
}
