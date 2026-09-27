import { describe, expect, it } from "vitest";
import { describeSyncStatus, formatTimeAgo } from "./syncStatus";

const MINUTE = 60_000;
const now = Date.UTC(2026, 8, 26, 12, 0, 0);

describe("formatTimeAgo", () => {
	it("rounds down across unit boundaries", () => {
		expect(formatTimeAgo(now - 59_000, now)).toBe("just now");
		expect(formatTimeAgo(now - MINUTE, now)).toBe("1 minute ago");
		expect(formatTimeAgo(now - 59 * MINUTE, now)).toBe("59 minutes ago");
		expect(formatTimeAgo(now - 60 * MINUTE, now)).toBe("1 hour ago");
		expect(formatTimeAgo(now - 47 * 60 * MINUTE, now)).toBe("1 day ago");
		// Clock skew never produces "-3 minutes ago".
		expect(formatTimeAgo(now + 3 * MINUTE, now)).toBe("just now");
	});
});

describe("describeSyncStatus", () => {
	const models = [{ name: "a", maxTokens: 1 }, { name: "b", maxTokens: 1 }];

	it("reports success with the model count, failures with the error", () => {
		expect(describeSyncStatus({ models }, now)).toBe("Not synced yet.");
		expect(
			describeSyncStatus({ models, lastModelSync: { at: now - 5 * MINUTE } }, now),
		).toBe("Last synced 5 minutes ago · 2 models.");
		expect(
			describeSyncStatus({ models: [models[0]], lastModelSync: { at: now } }, now),
		).toBe("Last synced just now · 1 model.");
		expect(
			describeSyncStatus(
				{ models, lastModelSync: { at: now - 2 * MINUTE, error: "Request failed, status 503" } },
				now,
			),
		).toBe("Last sync failed 2 minutes ago: Request failed, status 503");
	});
});
