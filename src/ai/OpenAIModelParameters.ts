export const DEFAULT_TOP_P = 1;
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_FREQUENCY_PENALTY = 0;
export const DEFAULT_PRESENCE_PENALTY = 0;

export interface OpenAIModelParameters {
	/**
	 * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. (source: OpenAI)
	 */
	temperature: number;
	/**
	 * An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered. (source: OpenAI)
	 */
	top_p: number;
	/**
	 * Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim. (source: OpenAI)
	 */
	frequency_penalty: number;
	/**
	 * Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics. (source: OpenAI)
	 */
	presence_penalty: number;
}
