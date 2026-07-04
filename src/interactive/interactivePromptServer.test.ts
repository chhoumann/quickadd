import { afterEach, describe, expect, it, vi } from "vitest";
import {
	interactivePromptServer,
	isLoopbackClient,
	safeEqual,
} from "./interactivePromptServer";
import { UserCancelError } from "../errors/UserCancelError";

afterEach(() => {
	vi.useRealTimers();
});

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

describe("interactivePromptServer long-poll waiter", () => {
	it("parks a single waiter and hands a concurrent poll an immediate idle", async () => {
		const s = interactivePromptServer.createSession();
		const srv = interactivePromptServer as unknown as {
			handlePoll(session: unknown, res: unknown): void;
			sessions: Map<string, unknown>;
		};
		const session = srv.sessions.get(s.id);

		const first = fakeRes();
		const second = fakeRes();

		// First poll parks (nothing queued yet) — no response written.
		srv.handlePoll(session, first.res);
		expect(first.events).toHaveLength(0);

		// A concurrent/overlapping poll must not overwrite the parked waiter;
		// it gets an immediate idle so the client simply re-polls.
		srv.handlePoll(session, second.res);
		expect(second.events).toEqual([{ kind: "idle" }]);

		// Emitting a prompt fires the *parked* (first) waiter, not the second.
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "confirm",
			header: "Proceed?",
		});
		expect(first.events).toHaveLength(1);
		expect((first.events[0] as { kind: string }).kind).toBe("prompt");

		// A stale close from the already-fired first poll must not disturb state.
		first.close();

		interactivePromptServer.submitReply(s.id, pendingRequestId(s.id), true);
		await expect(prompt).resolves.toBe(true);
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
	});

	it("aborts the run when an attached client stops polling (disconnect watchdog)", async () => {
		vi.useFakeTimers();
		const s = interactivePromptServer.createSession();
		const srv = interactivePromptServer as unknown as {
			handlePoll(session: unknown, res: unknown): void;
			sessions: Map<string, { finished: boolean }>;
		};
		const session = srv.sessions.get(s.id);

		// Client attaches (arms the watchdog), receives a prompt, then goes silent.
		srv.handlePoll(session, fakeRes().res);
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "confirm",
			header: "Proceed?",
		});
		// Attach the rejection handler before advancing timers so the abort isn't
		// briefly seen as an unhandled rejection.
		const rejected = expect(prompt).rejects.toThrow(/ended/i);

		// No further polls: the watchdog must fire and abort the awaiting prompt.
		await vi.advanceTimersByTimeAsync(75_000 + 10);
		await rejected;
		expect(srv.sessions.get(s.id)?.finished).toBe(true);

		// finish() scheduled a cleanup timeout; flush it so the session doesn't
		// linger in the map (and leak into later tests) once real timers resume.
		await vi.advanceTimersByTimeAsync(60_000);
		expect(srv.sessions.has(s.id)).toBe(false);
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

	it("rejects a prompt raised after the session already finished (no hang)", async () => {
		const s = interactivePromptServer.createSession();
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
		// Without the finished-guard this promise would park forever.
		await expect(
			interactivePromptServer.emitPrompt(s.id, {
				type: "confirm",
				header: "Late?",
			}),
		).rejects.toThrow(/ended/i);
	});

	it("rejects a cancelled reply with UserCancelError so the run aborts as a user cancel", async () => {
		const s = interactivePromptServer.createSession();
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "input",
			header: "Name",
			multiline: false,
		});
		const rid = pendingRequestId(s.id);
		expect(
			interactivePromptServer.submitReply(s.id, rid, undefined, true),
		).toBe(true);
		await expect(prompt).rejects.toBeInstanceOf(UserCancelError);
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
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

/** Minimal ServerResponse stand-in capturing what `send()` writes. */
function fakeRes(): {
	res: unknown;
	events: unknown[];
	close: () => void;
} {
	const events: unknown[] = [];
	let closeHandler: (() => void) | null = null;
	return {
		res: {
			writeHead() {},
			end(payload?: string) {
				if (payload) events.push(JSON.parse(payload));
			},
			on(event: string, cb: () => void) {
				if (event === "close") closeHandler = cb;
			},
		},
		events,
		close() {
			closeHandler?.();
		},
	};
}

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
