import { describe, expect, it } from "vitest";
import {
	interactivePromptServer,
	isLoopbackClient,
	safeEqual,
} from "./interactivePromptServer";

describe("safeEqual", () => {
	it("matches equal strings and rejects different or different-length ones", () => {
		expect(safeEqual("abc123", "abc123")).toBe(true);
		expect(safeEqual("abc123", "abc124")).toBe(false);
		expect(safeEqual("abc", "abcd")).toBe(false);
		expect(safeEqual("", "")).toBe(true);
	});
});

describe("isLoopbackClient", () => {
	it("allows loopback hosts with no browser origin", () => {
		expect(isLoopbackClient({ host: "127.0.0.1:5000" })).toBe(true);
		expect(isLoopbackClient({ host: "localhost:5000" })).toBe(true);
	});
	it("rejects browser origins and non-loopback hosts (DNS-rebinding)", () => {
		expect(isLoopbackClient({ host: "127.0.0.1:5000", origin: "https://evil.test" })).toBe(false);
		expect(isLoopbackClient({ host: "127.0.0.1:5000", referer: "https://evil.test/x" })).toBe(false);
		expect(isLoopbackClient({ host: "evil.test:5000" })).toBe(false);
		expect(isLoopbackClient({})).toBe(false);
	});
});

describe("interactivePromptServer session multiplexing", () => {
	it("resolves each prompt with the reply for its own session and requestId", async () => {
		const a = interactivePromptServer.createSession();
		const b = interactivePromptServer.createSession();
		expect(a.id).not.toBe(b.id);
		expect(a.token).not.toBe(b.token);

		const promptA = interactivePromptServer.emitPrompt(a.id, {
			type: "input",
			header: "A",
			multiline: false,
		});
		const promptB = interactivePromptServer.emitPrompt(b.id, {
			type: "input",
			header: "B",
			multiline: false,
		});

		// A reply for one session must not resolve the other's prompt.
		const rid = crypto.randomUUID();
		expect(interactivePromptServer.submitReply(a.id, rid, "wrong-request")).toBe(false);

		// Reply to each with its actual pending requestId (the only pending one).
		const ridA = pendingRequestId(a.id);
		const ridB = pendingRequestId(b.id);
		expect(interactivePromptServer.submitReply(a.id, ridA, "answer-A")).toBe(true);
		expect(interactivePromptServer.submitReply(b.id, ridB, "answer-B")).toBe(true);

		await expect(promptA).resolves.toBe("answer-A");
		await expect(promptB).resolves.toBe("answer-B");

		interactivePromptServer.finish(a.id, { kind: "done", result: {} });
		interactivePromptServer.finish(b.id, { kind: "done", result: {} });
	});

	it("rejects a still-open prompt when the session finishes", async () => {
		const s = interactivePromptServer.createSession();
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "confirm",
			header: "Proceed?",
		});
		interactivePromptServer.finish(s.id, { kind: "error", error: "boom" });
		await expect(prompt).rejects.toThrow(/ended/i);
	});

	it("caps the number of concurrent sessions", () => {
		const created: string[] = [];
		try {
			// Already have some sessions from earlier tests may have been cleaned up;
			// create until it throws to prove the cap is enforced.
			for (let i = 0; i < 64; i++) created.push(interactivePromptServer.createSession().id);
			throw new Error("expected the session cap to be hit");
		} catch (error) {
			expect((error as Error).message).toMatch(/too many/i);
		} finally {
			for (const id of created) interactivePromptServer.finish(id, { kind: "done", result: {} });
		}
	});
});

/** Reads the single pending requestId for a session (test helper). */
function pendingRequestId(sessionId: string): string {
	const sessions = (
		interactivePromptServer as unknown as {
			sessions: Map<string, { pending: Map<string, unknown> }>;
		}
	).sessions;
	const pending = sessions.get(sessionId)?.pending;
	const first = pending ? [...pending.keys()][0] : undefined;
	if (!first) throw new Error("no pending prompt");
	return first;
}
