import type { App } from "obsidian";
import { getModelProvider } from "./aiHelpers";
import type { Model, AIProvider } from "./Provider";
import { TokenUsageTracker } from "./TokenUsageTracker";
import { getTokenCount } from "./AIAssistant";
import { StreamingResponseModal } from "src/gui/StreamingResponseModal";

export type StreamCallback = (chunkText: string) => void;

/**
 * Returns a function that, when called, will stream an OpenAI chat completion
 * and invoke the provided callback with each textual delta received. The
 * function resolves with the full response text once the stream ends.
 */
export function OpenAIStreamRequest(
    app: App,
    apiKey: string,
    model: Model,
    systemPrompt: string,
    modelParams: Record<string, unknown> = {}
): (prompt: string, onChunk: StreamCallback) => Promise<string> {
    return async function (prompt: string, onChunk: StreamCallback): Promise<string> {
        const provider = getModelProvider(model.name);
        if (!provider) throw new Error(`Model ${model.name} not found with any provider.`);

        // Track input tokens immediately (cost control)
        TokenUsageTracker.instance.addTokens(provider.name, getTokenCount(prompt, model) + getTokenCount(systemPrompt, model), "input", provider);

        const response = await fetch(`${provider.endpoint}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model.name,
                ...modelParams,
                stream: true,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt },
                ],
            }),
        });

        if (!response.ok || !response.body) {
            throw new Error(`Streaming API request failed: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let fullText = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // streaming responses from OpenAI are delimited by newlines and prefixed with "data: "
            const lines = buffer.split(/\r?\n/);
            // last line may be incomplete -> keep in buffer
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const jsonStr = trimmed.replace("data:", "").trim();
                if (jsonStr === "[DONE]") {
                    reader.cancel();
                    break;
                }

                try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const json = JSON.parse(jsonStr);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const delta = json.choices?.[0]?.delta?.content ?? "";
                    if (delta) {
                        fullText += delta;
                        onChunk(delta);
                    }
                } catch {
                    // ignore malformed lines
                }
            }
        }

        // Track output tokens at end
        TokenUsageTracker.instance.addTokens(provider.name, getTokenCount(fullText, model), "output", provider);
        return fullText;
    };
}

/**
 * Convenience wrapper that handles modal UI while streaming.
 */
export async function streamWithModal(
    app: App,
    apiKey: string,
    model: Model,
    systemPrompt: string,
    prompt: string,
    modelParams: Record<string, unknown> = {}
): Promise<string> {
    let accumulated = "";
    const modal = new StreamingResponseModal(app, () => {
        // TODO: Properly implement cancellation via AbortController.
    });
    modal.open();

    const makeStream = OpenAIStreamRequest(app, apiKey, model, systemPrompt, modelParams);

    try {
        const resultPromise = makeStream(prompt, async (delta) => {
            accumulated += delta;
            await modal.updateContent(accumulated);
        });

        const result = await resultPromise;
        await modal.updateContent(result);
        modal.close();
        return result;
    } catch (err) {
        modal.close();
        throw err;
    }
}