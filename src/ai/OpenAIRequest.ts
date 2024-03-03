import { requestUrl } from "obsidian";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { settingsStore } from "src/settingsStore";
import { getTokenCount } from "./AIAssistant";
import { preventCursorChange } from "./preventCursorChange";
import type { Model } from "./Provider";
import { getModelProvider } from "./aiHelpers";

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
		message: { content: string; role: string };
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

		const tokenCount =
			getTokenCount(prompt, model) + getTokenCount(systemPrompt, model);
		const { maxTokens } = model;

		if (tokenCount > maxTokens) {
			throw new Error(
				`The ${model.name} API has a token limit of ${maxTokens}. Your prompt has ${tokenCount} tokens.`
			);
		}

		const modelProvider = getModelProvider(model.name);

		if (!modelProvider) {
			throw new Error(`Model ${model.name} not found with any provider.`);
		}

		console.log(
			`Making request to ${modelProvider?.name} at ${modelProvider.endpoint} with model ${model.name}`
		);

		try {
			const restoreCursor = preventCursorChange();
			const _response = requestUrl({
				url: `${modelProvider?.endpoint}/chat/completions`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: model.name,
					...modelParams,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: prompt },
					],
				}),
			});
			restoreCursor();

			const response = await _response;

			return response.json as ReqResponse;
		} catch (error) {
			console.log(error);
			throw new Error(
				`Error while making request to OpenAI API: ${
					(error as { message: string }).message
				}`
			);
		}
	};
}
