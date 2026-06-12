import { describe, expect, it, vi } from "vitest";
import type { Model } from "./Provider";

describe("AI Assistant token encoding cache", () => {
	it("shares one tokenizer construction between concurrent first callers", async () => {
		vi.resetModules();
		const constructorMock = vi.fn();

		vi.doMock("js-tiktoken/lite", () => ({
			Tiktoken: class {
				constructor(rank: unknown) {
					constructorMock(rank);
				}

				encode(text: string) {
					return Array.from(text);
				}
			},
			getEncodingNameForModel: () => "cl100k_base",
		}));
		vi.doMock("js-tiktoken/ranks/cl100k_base", () => ({
			default: { name: "cl100k_base" },
		}));
		vi.doMock("js-tiktoken/ranks/o200k_base", () => ({
			default: { name: "o200k_base" },
		}));

		const { getTokenCountAsync } = await import("./AIAssistant");
		const model = { name: "gpt-4", maxTokens: 8192 } as unknown as Model;

		const [first, second] = await Promise.all([
			getTokenCountAsync("abc", model),
			getTokenCountAsync("def", model),
		]);

		expect(first).toBe(3);
		expect(second).toBe(3);
		expect(constructorMock).toHaveBeenCalledTimes(1);
		expect(constructorMock).toHaveBeenCalledWith({ name: "cl100k_base" });
	});
});
