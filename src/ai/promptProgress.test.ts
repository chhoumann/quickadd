import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoticeHandler } from "./makeNoticeHandler";
import { outputVariables, trackPrompt } from "./promptProgress";

function recordingNotice() {
	const calls: Array<[string, string]> = [];
	const notice: NoticeHandler = {
		setMessage: (status, msg) => calls.push([status, msg]),
		hide: () => {},
		finish: (msg) => calls.push(["finished", msg]),
		fail: () => {},
	};
	return { notice, calls };
}

describe("trackPrompt", () => {
	// Obsidian's renderer global; this test loads no Obsidian stub to provide it.
	beforeEach(() => {
		vi.stubGlobal("window", globalThis);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	// The progress notice used to poll with Obsidian's global sleep(100), so a
	// settled request still waited out the current tick, and nothing ran where
	// that global is missing.
	it("settles as soon as the request does, without waiting on a timer", async () => {
		vi.useFakeTimers();
		const { notice, calls } = recordingNotice();

		await expect(trackPrompt(Promise.resolve("answer"), notice, ["prompting", "Asking."]))
			.resolves.toBe("answer");

		expect(calls[0][0]).toBe("prompting");
		expect(calls.at(-1)?.[0]).toBe("finished");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("refreshes the elapsed time while the request runs", async () => {
		vi.useFakeTimers();
		const { notice, calls } = recordingNotice();
		let answer!: (value: string) => void;
		const tracked = trackPrompt(new Promise<string>((resolve) => { answer = resolve; }), notice, ["prompting", "Asking."]);

		await vi.advanceTimersByTimeAsync(350);
		answer("done");
		await tracked;

		expect(calls.filter(([status]) => status === "prompting").length).toBeGreaterThan(3);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("leaves a failure to the caller's notice.fail and stops the timer", async () => {
		vi.useFakeTimers();
		const { notice, calls } = recordingNotice();

		await expect(trackPrompt(Promise.reject(new Error("boom")), notice, ["prompting", "Asking."]))
			.rejects.toThrow("boom");

		expect(calls.some(([status]) => status === "finished")).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("outputVariables", () => {
	it("pairs the output with a blockquoted copy for {{VALUE:name-quoted}}", () => {
		expect(outputVariables("summary", "one\ntwo")).toEqual({
			summary: "one\ntwo",
			"summary-quoted": "> one\n> two",
		});
	});
});
