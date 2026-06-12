import { describe, expect, it } from "vitest";
import type { Model } from "./Provider";
import {
	estimateTokenCount,
	getTokenCount,
	getTokenCountAsync,
} from "./AIAssistant";

const model = { name: "gpt-4", maxTokens: 8192 } as unknown as Model;

describe("AI Assistant token counting", () => {
	it("estimates tokens from character length synchronously", () => {
		expect(estimateTokenCount("")).toBe(0);
		expect(estimateTokenCount("abcd")).toBe(1);
		expect(estimateTokenCount("abcde")).toBe(2);
	});

	it("keeps getTokenCount as the synchronous estimate wrapper", () => {
		const text = "count this prompt quickly";

		expect(getTokenCount(text, model)).toBe(estimateTokenCount(text));
	});

	it("counts tokens exactly through the lazy async encoder", async () => {
		const first = await getTokenCountAsync("hello world", model);
		const second = await getTokenCountAsync("hello world", model);

		expect(Number.isInteger(first)).toBe(true);
		expect(first).toBeGreaterThan(0);
		expect(first).toBeLessThanOrEqual("hello world".length);
		expect(second).toBe(first);
	});
});
