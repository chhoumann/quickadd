import { afterEach, describe, expect, it, vi } from "vitest";
import {
	interactivePromptServer,
	isLoopbackClient,
	safeEqual,
	type PromptSpec,
	type ReplyBody,
} from "./interactivePromptServer";
import { UserCancelError } from "../errors/UserCancelError";

/**
 * A reply as it arrives from a client: validated, then delivered. Goes through the
 * same method the HTTP handler calls, so the validation under test is production's.
 */
function replyOverWire(
	sessionId: string,
	body: ReplyBody,
): { status: number; body: { error?: string } } {
	const outcome = interactivePromptServer.submitWireReply(sessionId, body);
	return outcome.ok
		? { status: 200, body: {} }
		: { status: outcome.status, body: { error: outcome.error } };
}


afterEach(() => {
	vi.useRealTimers();
	// Sessions live for SESSION_TTL_MS after finish(), so without this the file
	// accumulates them across tests and eventually trips MAX_SESSIONS - a capacity
	// failure that looks like whatever test happens to be 33rd.
	interactivePromptServer.stop();
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

	// The flag arrives from untrusted JSON. A loose truthy check let
	// `"cancelled": "no"` kill a run; strict `=== true` alone would be worse - it would
	// resolve a mistyped cancel as an EMPTY ANSWER (textPrompt maps undefined -> ""),
	// handing the run a value the user never gave. So the wire rejects it and the prompt
	// stays pending. Note the value-less shape, which is what a mistaken cancel has.
	it.each([["no"], [1], [{}], ["true"], [[]], [null]])(
		"rejects a non-boolean cancelled flag (%o) with 400 and keeps the prompt pending",
		async (flag) => {
			const s = interactivePromptServer.createSession();
			const prompt = interactivePromptServer.emitPrompt(s.id, {
				type: "input",
				header: "Name",
				multiline: false,
			});
			let settled = false;
			void prompt.then(
				() => (settled = true),
				() => (settled = true),
			);
			const rid = pendingRequestId(s.id);

			const outcome = replyOverWire(s.id, { requestId: rid, cancelled: flag });

			expect(outcome.status).toBe(400);
			expect(String(outcome.body.error)).toMatch(/cancelled/i);
			await Promise.resolve();
			expect(settled, "the prompt must stay pending so the client can retry").toBe(
				false,
			);

			// ...and the corrected reply still works.
			expect(
				replyOverWire(s.id, { requestId: rid, cancelled: true }).status,
			).toBe(200);
			await expect(prompt).rejects.toBeInstanceOf(UserCancelError);
			interactivePromptServer.finish(s.id, { kind: "done", result: {} });
		},
	);

	it("accepts an explicit cancelled:false as a normal answer", async () => {
		const s = interactivePromptServer.createSession();
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "input",
			header: "Name",
			multiline: false,
		});
		const rid = pendingRequestId(s.id);
		expect(
			replyOverWire(s.id, { requestId: rid, value: "Ada", cancelled: false }).status,
		).toBe(200);
		await expect(prompt).resolves.toBe("Ada");
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
	});

	// A confirm reply that is neither boolean nor a cancel is validated HERE, while the
	// client is still holding the HTTP response and the prompt is still PENDING, so the
	// client can correct itself. Deeper in, the only options are to invent an answer or
	// to fail the whole run.
	it.each([[undefined], [null], ["yes"], [0], [{}]])(
		"rejects a non-boolean confirm reply (%o) with 400",
		async (value) => {
			const s = interactivePromptServer.createSession();
			const prompt = interactivePromptServer.emitPrompt(s.id, {
				type: "confirm",
				header: "Proceed?",
			});
			const rid = pendingRequestId(s.id);

			const outcome = replyOverWire(s.id, { requestId: rid, value });

			expect(outcome.status).toBe(400);
			expect(String(outcome.body.error)).toContain("confirm prompt needs a boolean");
			expect(String(outcome.body.error)).toContain('{"cancelled": true}');

			expect(replyOverWire(s.id, { requestId: rid, value: false }).status).toBe(200);
			await expect(prompt).resolves.toBe(false);
			interactivePromptServer.finish(s.id, { kind: "done", result: {} });
		},
	);

	it.each([[true], [false], ["true"], ["false"]])(
		"accepts a boolean-ish confirm reply (%o)",
		async (value) => {
			const s = interactivePromptServer.createSession();
			const prompt = interactivePromptServer.emitPrompt(s.id, {
				type: "confirm",
				header: "Proceed?",
			});
			const rid = pendingRequestId(s.id);
			expect(replyOverWire(s.id, { requestId: rid, value }).status).toBe(200);
			await expect(prompt).resolves.toBe(value);
			interactivePromptServer.finish(s.id, { kind: "done", result: {} });
		},
	);

	/**
	 * #1605. `GenericInfoDialog` resolves on EVERY close path and has no reject path at
	 * all, so the same choice run in the app continues past the panel. Escape is the only
	 * gesture an info panel affords, so a client mapping it to a cancel used to kill a run
	 * the app would have finished.
	 */
	it("closes an info panel on a cancel instead of ending the run", async () => {
		const s = interactivePromptServer.createSession();
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "info",
			header: "Heads up",
			text: ["Something to read."],
		});
		const rid = pendingRequestId(s.id);

		expect(replyOverWire(s.id, { requestId: rid, cancelled: true }).status).toBe(200);

		await expect(prompt).resolves.toBeUndefined();
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
	});

	it.each<[string, PromptSpec]>([
		["input", { type: "input", header: "Name", multiline: false }],
		["confirm", { type: "confirm", header: "Proceed?" }],
		["checkbox", { type: "checkbox", items: [] }],
	])(
		"still ends the run on a cancelled %s prompt",
		async (_name, spec) => {
			const s = interactivePromptServer.createSession();
			const prompt = interactivePromptServer.emitPrompt(s.id, spec);
			const rid = pendingRequestId(s.id);

			expect(replyOverWire(s.id, { requestId: rid, cancelled: true }).status).toBe(
				200,
			);

			await expect(prompt).rejects.toBeInstanceOf(UserCancelError);
			interactivePromptServer.finish(s.id, { kind: "done", result: {} });
		},
	);

	// The replacement for info-cancel-as-bail-out. Without it, making an info cancel
	// resolve would take away a client's only explicit way out, leaving it to stop
	// polling and wait out the 75-second watchdog.
	it("ends the run on abort, whatever prompt it is blocked on", async () => {
		const s = interactivePromptServer.createSession();
		const info = interactivePromptServer.emitPrompt(s.id, {
			type: "info",
			header: "Heads up",
			text: ["Something to read."],
		});

		expect(interactivePromptServer.abortSession(s.id)).toBe(1);

		await expect(info).rejects.toBeInstanceOf(UserCancelError);
		// And a prompt raised afterwards rejects immediately rather than parking, so a
		// run that was mid-work when the abort arrived unwinds at its next prompt.
		await expect(
			interactivePromptServer.emitPrompt(s.id, {
				type: "input",
				header: "Name",
				multiline: false,
			}),
		).rejects.toBeInstanceOf(UserCancelError);
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
	});

	// Reported so a client can tell an effective abort from a no-op: 0 means the run was
	// mid-work, or blocked on a prompt QuickAdd opened in Obsidian rather than here.
	it("reports how many pending prompts it interrupted", () => {
		const s = interactivePromptServer.createSession();

		expect(interactivePromptServer.abortSession(s.id)).toBe(0);

		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
	});

	it("refuses to abort a session that already ended", () => {
		const s = interactivePromptServer.createSession();
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });

		expect(interactivePromptServer.abortSession(s.id)).toBeNull();
		expect(interactivePromptServer.abortSession("no-such-session")).toBeNull();
	});

	// The pending entry is dropped BEFORE it is rejected, exactly as finish() does, so a
	// reply that was already mid-flight cannot be answered 200 for a settle that is a
	// no-op on an already-rejected promise.
	it("leaves no pending entry for a reply that arrives after the abort", async () => {
		const s = interactivePromptServer.createSession();
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "input",
			header: "Name",
			multiline: false,
		});
		const rid = pendingRequestId(s.id);

		interactivePromptServer.abortSession(s.id);

		expect(replyOverWire(s.id, { requestId: rid, value: "Ada" }).status).toBe(409);
		await expect(prompt).rejects.toBeInstanceOf(UserCancelError);
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
	});

	// The wire contract this PR adds and documents: everything above goes through
	// abortSession() directly, so without these the POST-only routing, the status
	// mapping and the response shape rest on manual verification alone.
	it("serves POST /abort over the router, and only POST", async () => {
		const s = interactivePromptServer.createSession();
		const qs = `session=${s.id}&token=${s.token}`;
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "info",
			header: "Heads up",
			text: ["Something to read."],
		});
		void prompt.catch(() => {});

		// A browser can issue a GET with no Origin; the method gate is what stops it
		// from ending a run.
		expect((await overWire("GET", "/abort", qs)).status).toBe(404);

		const aborted = await overWire("POST", "/abort", qs);
		expect(aborted.status).toBe(200);
		expect(aborted.body).toEqual({ ok: true, interrupted: 1 });
		await expect(prompt).rejects.toBeInstanceOf(UserCancelError);

		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
		// Aborting a run that already ended must not report that it stopped something.
		const late = await overWire("POST", "/abort", qs);
		expect(late.status).toBe(409);

		expect((await overWire("POST", "/abort", `session=${s.id}&token=nope`)).status).toBe(
			404,
		);
	});

	// A prompt raised while no poll was parked sits in the queue. Left there, the next
	// poll hands the client a dialog it just asked to cancel, for a requestId that no
	// longer exists, in FRONT of the run's real terminal event.
	it("does not hand the client a prompt it already aborted", async () => {
		const s = interactivePromptServer.createSession();
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "input",
			header: "Name",
			multiline: false,
		});
		void prompt.catch(() => {});

		interactivePromptServer.abortSession(s.id);
		interactivePromptServer.finish(s.id, {
			kind: "error",
			error: "Input cancelled by user",
		});

		const { res, events } = fakeRes();
		(
			interactivePromptServer as unknown as {
				handlePoll: (session: unknown, res: unknown) => void;
				sessions: Map<string, unknown>;
			}
		).handlePoll(
			(
				interactivePromptServer as unknown as {
					sessions: Map<string, unknown>;
				}
			).sessions.get(s.id),
			res,
		);

		expect(events[0]).toEqual({
			kind: "error",
			error: "Input cancelled by user",
		});
		await expect(prompt).rejects.toBeInstanceOf(UserCancelError);
	});

	it("still 409s an unknown requestId", () => {
		const s = interactivePromptServer.createSession();
		const outcome = replyOverWire(s.id, { requestId: "nope", value: "x" });
		expect(outcome.status).toBe(409);
		interactivePromptServer.finish(s.id, { kind: "done", result: {} });
	});

	// Leniency preserved on purpose: "" and [] are answers a user really gives in-app
	// via the Skip affordances and optional fields, so an empty reply must stay legal or
	// optional prompts break on remote runs.
	it("leaves an empty answer to a non-confirm prompt alone", async () => {
		const s = interactivePromptServer.createSession();
		const prompt = interactivePromptServer.emitPrompt(s.id, {
			type: "input",
			header: "Name",
			multiline: false,
		});
		const rid = pendingRequestId(s.id);
		expect(replyOverWire(s.id, { requestId: rid, value: null }).status).toBe(200);
		await expect(prompt).resolves.toBeNull();
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

/**
 * Drives a request through the real `handle()` router, so the method gate, the auth
 * gate and the status mapping are the ones production uses. Everything below the
 * router (session lookup, abort, reply) is shared with the direct-call tests.
 */
async function overWire(
	method: string,
	path: string,
	query: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const { res, events } = fakeRes();
	let status = 0;
	(res as { writeHead: (code: number) => void }).writeHead = (code: number) => {
		status = code;
	};
	await (
		interactivePromptServer as unknown as {
			handle: (req: unknown, res: unknown) => Promise<void>;
		}
	).handle(
		{
			method,
			url: `${path}?${query}`,
			headers: { host: "127.0.0.1" },
			on() {},
			// A real IncomingMessage is an async iterable; the router drains the body
			// before answering, so a stand-in that is not iterable would 400 here.
			async *[Symbol.asyncIterator]() {},
		},
		res,
	);
	return { status, body: (events[0] ?? {}) as Record<string, unknown> };
}

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
