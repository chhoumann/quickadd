import type { App } from "obsidian";
import { requestUrl } from "obsidian";
import type { OpenAIModelParameters } from "./OpenAIModelParameters";
import { settingsStore } from "src/settingsStore";
import {
	beginAIRequestLogEntry,
	finishAIRequestLogEntry,
} from "./AIAssistant";
import { preventCursorChange } from "./preventCursorChange";
import type { AIProvider, Model } from "./Provider";
import { getModelProvider } from "./aiHelpers";
import { log } from "src/logger/logManager";
import { estimateTokenCount } from "./tokenEstimator";
import { buildProviderError, classifyProviderError } from "./providerErrors";

export interface CommonResponse {
	id: string;
	model: string;
	content: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	stopReason: string;
	stopSequence: string | null;
	created: number;
}

// Shared request execution for all providers: call `requestUrl` with
// `throw: false` so we can read the response body ourselves, run the
// post-request callback (cursor restore), and turn any 4xx/5xx into a
// structured, classifiable error before returning the parsed JSON.
async function dispatchProviderRequest<T>(
	params: Parameters<typeof requestUrl>[0] & object,
	providerName: string,
	afterRequestCallback?: () => void
): Promise<T> {
	const _response = requestUrl({ ...params, throw: false });

	if (afterRequestCallback) afterRequestCallback();

	const response = await _response;
	if (response.status >= 400) {
		throw buildProviderError(providerName, response);
	}
	return response.json as T;
}

function mapOpenAIResponseToCommon(
	response: OpenAIReqResponse
): CommonResponse {
	return {
		id: response.id,
		model: response.model,
		content: response.choices[0].message.content,
		usage: {
			promptTokens: response.usage.prompt_tokens,
			completionTokens: response.usage.completion_tokens,
			totalTokens: response.usage.total_tokens,
		},
		stopReason: response.choices[0].finish_reason,
		stopSequence: null,
		created: response.created,
	};
}

function mapAnthropicResponseToCommon(
	response: AnthropicResponse
): CommonResponse {
	return {
		id: response.id,
		model: response.model,
		content: response.content[0].text,
		usage: {
			promptTokens: response.usage.input_tokens,
			completionTokens: response.usage.output_tokens,
			totalTokens:
				response.usage.input_tokens + response.usage.output_tokens,
		},
		stopReason: response.stop_reason,
		stopSequence: response.stop_sequence,
		created: Date.now(),
	};
}

type OpenAIReqResponse = {
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

export interface AnthropicResponse {
	content: { text: string; type: string }[];
	id: string;
	model: string;
	role: string;
	stop_reason: string;
	stop_sequence: null;
	type: string;
	usage: { input_tokens: number; output_tokens: number };
}

type GeminiPart = { text?: string } & Record<string, unknown>;
type GeminiContent = { role: string; parts: GeminiPart[] };
export interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent;
    finishReason?: string;
    index?: number;
    safetyRatings?: unknown[];
  }>;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

async function makeOpenAIRequest(
	apiKey: string,
	model: Model,
	modelProvider: AIProvider,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters>,
	prompt: string,
	afterRequestCallback?: () => void
): Promise<OpenAIReqResponse> {
	return dispatchProviderRequest<OpenAIReqResponse>(
		{
			url: `${modelProvider.endpoint}/chat/completions`,
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
		},
		modelProvider.name,
		afterRequestCallback
	);
}

async function makeAnthropicRequest(
	apiKey: string,
	model: Model,
	modelProvider: AIProvider,
	modelParams: Partial<OpenAIModelParameters>,
	prompt: string,
	afterRequestCallback?: () => void
): Promise<AnthropicResponse> {
	return dispatchProviderRequest<AnthropicResponse>(
		{
			url: `${modelProvider.endpoint}/v1/messages`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "max-tokens-3-5-sonnet-2024-07-15"
			},
			body: JSON.stringify({
				model: model.name,
				max_tokens: 4096,
				messages: [{ role: "user", content: prompt }],
			}),
		},
		modelProvider.name,
		afterRequestCallback
	);
}

async function makeGeminiRequest(
  apiKey: string,
  model: Model,
  modelProvider: AIProvider,
  systemPrompt: string,
  modelParams: Partial<OpenAIModelParameters>,
  prompt: string,
  afterRequestCallback?: () => void
): Promise<GeminiResponse> {
  // Gemini uses API key as query param and different payload shape
  const url = `${modelProvider.endpoint}/v1beta/models/${encodeURIComponent(
    model.name
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const generationConfig: Record<string, unknown> = {};
  if (typeof modelParams.temperature === "number") {
    generationConfig.temperature = modelParams.temperature;
  }
  if (typeof modelParams.top_p === "number") {
    generationConfig.topP = modelParams.top_p;
  }
  // Do NOT pass frequency_penalty / presence_penalty; Gemini does not support them

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };

  if (systemPrompt && systemPrompt.trim().length > 0) {
    // Prefer systemInstruction when available; otherwise include a system content
    body["systemInstruction"] = {
      role: "system",
      parts: [{ text: systemPrompt }],
    } as GeminiContent;
  }

  if (Object.keys(generationConfig).length > 0) {
    body["generationConfig"] = generationConfig;
  }

  return dispatchProviderRequest<GeminiResponse>(
    {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    modelProvider.name,
    afterRequestCallback
  );
}

function mapGeminiResponseToCommon(response: GeminiResponse): CommonResponse {
  const firstCandidate = response.candidates?.[0];
  const parts = firstCandidate?.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");

  return {
    id: `${Date.now()}`,
    model: response.modelVersion ?? "gemini",
    content: text,
    usage: {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    },
    stopReason: firstCandidate?.finishReason ?? "",
    stopSequence: null,
    created: Date.now(),
  };
}

export function OpenAIRequest(
	app: App,
	apiKey: string,
	model: Model,
	systemPrompt: string,
	modelParams: Partial<OpenAIModelParameters> = {}
): (prompt: string) => Promise<CommonResponse> {
	return async function makeRequest(prompt: string): Promise<CommonResponse> {
		if (settingsStore.getState().disableOnlineFeatures) {
			throw new Error(
				"Blocking request to OpenAI: Online features are disabled in settings."
			);
		}

		const estimatedTokenCount =
			estimateTokenCount(prompt) + estimateTokenCount(systemPrompt);

		const modelProvider = getModelProvider(model.name);

		if (!modelProvider) {
			throw new Error(`Model ${model.name} not found with any provider.`);
		}

		const requestStart = Date.now();
		const requestLogId = beginAIRequestLogEntry({
			provider: modelProvider.name,
			endpoint: modelProvider.endpoint,
			model: model.name,
			systemPrompt,
			prompt,
			modelOptions: modelParams,
		});
		log.logMessage(
			`[AI Request ${requestLogId}] Started ${modelProvider.name}/${model.name}`
		);
		if (
			Number.isFinite(model.maxTokens) &&
			model.maxTokens > 0 &&
			estimatedTokenCount > model.maxTokens
		) {
			log.logMessage(
				`[AI Request ${requestLogId}] Estimated prompt size is ${estimatedTokenCount} tokens, above the configured ${model.maxTokens} token context. Sending anyway; the provider will enforce the exact limit.`
			);
		}

		try {
			const restoreCursor = preventCursorChange(app);

			let response: CommonResponse;
          if (modelProvider.name === "Anthropic") {
				const anthropicResponse = await makeAnthropicRequest(
					apiKey,
					model,
					modelProvider,
					modelParams,
					prompt,
					restoreCursor
				);
				response = mapAnthropicResponseToCommon(anthropicResponse);
          } else if (modelProvider.name === "Gemini") {
            const geminiResponse = await makeGeminiRequest(
              apiKey,
              model,
              modelProvider,
              systemPrompt,
              modelParams,
              prompt,
              restoreCursor
            );
            response = mapGeminiResponseToCommon(geminiResponse);
			} else {
				const openaiResponse = await makeOpenAIRequest(
					apiKey,
					model,
					modelProvider,
					systemPrompt,
					modelParams,
					prompt,
					restoreCursor
				);
				response = mapOpenAIResponseToCommon(openaiResponse);
			}

			const durationMs = Date.now() - requestStart;

			finishAIRequestLogEntry(requestLogId, {
				status: "success",
				durationMs,
				usage: response.usage,
			});
			log.logMessage(
				`[AI Request ${requestLogId}] Success in ${durationMs}ms`
			);

			return response;
		} catch (error) {
			const errorMessage =
				(error as { message?: string }).message ?? String(error);
			const durationMs = Date.now() - requestStart;

			finishAIRequestLogEntry(requestLogId, {
				status: "error",
				durationMs,
				errorMessage,
			});
			log.logMessage(
				`[AI Request ${requestLogId}] Failed in ${durationMs}ms: ${errorMessage}`
			);

			log.logError(error as Error);

			// Help users act on the most common failure: a prompt that overflows
			// the model's context window. (ChunkedPrompt retries these automatically;
			// the single-prompt path cannot, so we point the user at a remedy.)
			const guidance =
				classifyProviderError(error) === "input_context"
					? " The prompt likely exceeds the model's context window — shorten it, choose a model with a larger context, or use the chunked AI prompt API."
					: "";

			throw new Error(
				`Error while making request to ${modelProvider.name}: ${errorMessage}${guidance}`,
				{ cause: error }
			);
		}
	};
}
