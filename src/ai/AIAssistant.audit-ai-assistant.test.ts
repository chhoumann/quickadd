import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./AIAssistant";

// Finding: ai-assistant-api-chunked-prompt — the "RateLimiter" used by
// ChunkedPrompt was a concurrency limiter (cap on in-flight requests), NOT a
// rate limiter. With a fast provider it would dispatch a new request the instant
// any in-flight one settled, so far more than `maxRequests` could START within
// `intervalMs`. These tests assert the corrected sliding-window behavior: no more
// than `maxRequests` requests may begin within any `intervalMs` span.
describe("RateLimiter sliding-window rate limiting", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts no more than maxRequests within one interval even when work settles instantly", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);

		const maxRequests = 5;
		const intervalMs = 30_000;
		const limiter = new RateLimiter(maxRequests, intervalMs);

		const startTimes: number[] = [];

		// 20 requests that each resolve immediately. The old concurrency limiter
		// would start a 6th the moment the 1st settled (same tick), so all 20
		// would start within a few ms — well over 5 per 30s.
		const all = Array.from({ length: 20 }, () =>
			limiter.add(async () => {
				startTimes.push(Date.now());
				return "ok";
			}),
		);

		await vi.advanceTimersByTimeAsync(intervalMs * 4 + 10);
		await Promise.all(all);

		// Within the FIRST window no more than maxRequests may have started.
		const startedInFirstWindow = startTimes.filter(
			(t) => t < intervalMs,
		).length;
		expect(startedInFirstWindow).toBeLessThanOrEqual(maxRequests);

		// And for every sliding window of width intervalMs, the cap holds.
		for (const anchor of startTimes) {
			const inWindow = startTimes.filter(
				(t) => t >= anchor && t < anchor + intervalMs,
			).length;
			expect(inWindow).toBeLessThanOrEqual(maxRequests);
		}
	});

	it("eventually completes all queued requests across multiple windows", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);

		const limiter = new RateLimiter(2, 1000);
		const results: string[] = [];

		const all = Array.from({ length: 6 }, (_unused, i) =>
			limiter.add(async () => {
				results.push(`r${i}`);
				return `r${i}`;
			}),
		);

		await vi.advanceTimersByTimeAsync(5000);
		await Promise.all(all);

		expect(results).toHaveLength(6);
	});
});
