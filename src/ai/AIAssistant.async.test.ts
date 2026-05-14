import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./AIAssistant";

describe("RateLimiter async rejection handling", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("rejects queued work with an Error when the original rejection is not Error-like", async () => {
		vi.useFakeTimers();
		const rateLimiter = new RateLimiter(1, 100);

		const result = rateLimiter.add(async () => {
			throw "network failed";
		});
		const assertion = expect(result).rejects.toThrow("network failed");
		await vi.runAllTimersAsync();

		await assertion;
	});

	it("continues queued work after a rejection without unhandled finally rejections", async () => {
		vi.useFakeTimers();
		const rateLimiter = new RateLimiter(1, 100);
		const first = rateLimiter.add(async () => {
			throw new Error("first failed");
		});
		const second = rateLimiter.add(async () => "second succeeded");
		const firstAssertion = expect(first).rejects.toThrow("first failed");
		const secondAssertion = expect(second).resolves.toBe("second succeeded");

		await vi.runAllTimersAsync();

		await firstAssertion;
		await secondAssertion;
	});
});
