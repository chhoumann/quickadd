/**
 * Localhost HTTP bridge that lets an external front end (Raycast, scripts) drive
 * QuickAdd's *interactive* prompts — the ones a script raises at runtime and the
 * requirement collector therefore cannot pre-satisfy (e.g. a Readwise importer's
 * `quickAddApi.suggester(...)`).
 *
 * Transport: HTTP long-poll on 127.0.0.1 with an ephemeral random port. Chosen
 * over a WebSocket so it needs no dependency (Node's built-in `http`, required
 * lazily via `window.require` so the mobile bundle is untouched — desktop only).
 *
 * Concurrency: every run gets its own `sessionId` + per-session `token`; the
 * server multiplexes any number of concurrent sessions and correlates each
 * prompt to its answer by `requestId`. A caller can only ever see its own
 * session (unknown/mismatched token → 401/404).
 *
 * Lifecycle: the server starts on the first session and stops once the last
 * session is cleaned up, so nothing listens when no interactive run is active.
 */

import type { Server, IncomingMessage, ServerResponse } from "http";

export interface SuggesterItem {
	/** Text shown to the user. */
	title: string;
	/** The value handed back to the script when this item is chosen. */
	value: string;
}

/** A prompt the running script is blocked on. Extend with new `type`s over time. */
export type PromptSpec = {
	type: "suggester";
	placeholder?: string;
	allowCustomInput: boolean;
	items: SuggesterItem[];
};

/** Events streamed to the polling client. */
type ServerEvent =
	| { kind: "prompt"; requestId: string; prompt: PromptSpec }
	| { kind: "done"; result: unknown }
	| { kind: "error"; error: string }
	| { kind: "idle" };

interface Session {
	id: string;
	token: string;
	queue: ServerEvent[];
	waiter: ((event: ServerEvent) => void) | null;
	waiterTimer: ReturnType<typeof setTimeout> | null;
	pending: Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>;
	finished: boolean;
	cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const LONG_POLL_MS = 25_000;
/** Keep a finished session around briefly so the client can still poll its final event. */
const SESSION_TTL_MS = 60_000;

function nodeRequire<T>(mod: string): T | null {
	try {
		const req = (window as unknown as { require?: (m: string) => unknown })
			.require;
		return req ? (req(mod) as T) : null;
	} catch {
		return null;
	}
}

function randomId(): string {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	// Fallback: two random segments (localhost-only, non-cryptographic use is fine).
	return (
		Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
	);
}

class InteractivePromptServer {
	private server: Server | null = null;
	private port = 0;
	private readonly sessions = new Map<string, Session>();

	/** Start the server if needed and return the bound port. */
	async ensureStarted(): Promise<number> {
		if (this.server) return this.port;
		const http = nodeRequire<typeof import("http")>("http");
		if (!http) {
			throw new Error(
				"Interactive prompts require desktop Obsidian (Node http is unavailable).",
			);
		}
		return await new Promise<number>((resolve, reject) => {
			const server = http.createServer(
				(req: IncomingMessage, res: ServerResponse) =>
					void this.handle(req, res),
			);
			server.on("error", reject);
			// Port 0 → OS picks a free port. Bind to loopback only.
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				this.port =
					typeof address === "object" && address ? address.port : 0;
				this.server = server;
				resolve(this.port);
			});
		});
	}

	createSession(): { id: string; token: string } {
		const id = randomId();
		const token = randomId() + randomId();
		this.sessions.set(id, {
			id,
			token,
			queue: [],
			waiter: null,
			waiterTimer: null,
			pending: new Map(),
			finished: false,
			cleanupTimer: null,
		});
		return { id, token };
	}

	/** Raise a prompt for a session and resolve when the client replies. */
	emitPrompt(sessionId: string, prompt: PromptSpec): Promise<unknown> {
		const session = this.sessions.get(sessionId);
		if (!session) return Promise.reject(new Error("Unknown session"));
		const requestId = randomId();
		return new Promise<unknown>((resolve, reject) => {
			session.pending.set(requestId, { resolve, reject });
			this.push(session, { kind: "prompt", requestId, prompt });
		});
	}

	/** Deliver the run's final outcome and schedule the session for cleanup. */
	finish(
		sessionId: string,
		event: { kind: "done"; result: unknown } | { kind: "error"; error: string },
	): void {
		const session = this.sessions.get(sessionId);
		if (!session || session.finished) return;
		session.finished = true;
		for (const [, pending] of session.pending) {
			pending.reject(new Error("Interactive session ended"));
		}
		session.pending.clear();
		this.push(session, event);
		session.cleanupTimer = setTimeout(
			() => this.destroySession(session),
			SESSION_TTL_MS,
		);
	}

	/** Stop the server and drop all sessions (plugin unload). */
	stop(): void {
		for (const session of this.sessions.values()) {
			if (session.waiterTimer) clearTimeout(session.waiterTimer);
			if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
			for (const [, pending] of session.pending) {
				pending.reject(new Error("QuickAdd unloaded"));
			}
		}
		this.sessions.clear();
		this.server?.close();
		this.server = null;
		this.port = 0;
	}

	private push(session: Session, event: ServerEvent): void {
		if (session.waiter) {
			const waiter = session.waiter;
			session.waiter = null;
			if (session.waiterTimer) {
				clearTimeout(session.waiterTimer);
				session.waiterTimer = null;
			}
			waiter(event);
		} else {
			session.queue.push(event);
		}
	}

	private destroySession(session: Session): void {
		if (session.waiterTimer) clearTimeout(session.waiterTimer);
		if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
		this.sessions.delete(session.id);
		if (this.sessions.size === 0) {
			this.server?.close();
			this.server = null;
			this.port = 0;
		}
	}

	private authed(session: Session | undefined, token: string | null): session is Session {
		return !!session && !!token && session.token === token;
	}

	private send(res: ServerResponse, status: number, body: unknown): void {
		const payload = JSON.stringify(body);
		res.writeHead(status, {
			"content-type": "application/json",
			"cache-control": "no-store",
		});
		res.end(payload);
	}

	private async readBody(req: IncomingMessage): Promise<unknown> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			size += (chunk as Buffer).length;
			// Interactive replies are tiny; cap to avoid buffering junk.
			if (size > 1_000_000) throw new Error("Request body too large");
			chunks.push(chunk as Buffer);
		}
		if (chunks.length === 0) return {};
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			const sessionId = url.searchParams.get("session");
			const token = url.searchParams.get("token");
			const session = sessionId
				? this.sessions.get(sessionId)
				: undefined;

			if (!this.authed(session, token)) {
				this.send(res, 404, { ok: false, error: "Unknown session or token" });
				return;
			}

			if (req.method === "GET" && url.pathname === "/poll") {
				this.handlePoll(session, res);
				return;
			}
			if (req.method === "POST" && url.pathname === "/reply") {
				const body = (await this.readBody(req)) as {
					requestId?: string;
					value?: unknown;
					cancelled?: boolean;
				};
				this.handleReply(session, body);
				this.send(res, 200, { ok: true });
				return;
			}

			this.send(res, 404, { ok: false, error: "Not found" });
		} catch (error) {
			this.send(res, 400, {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private handlePoll(session: Session, res: ServerResponse): void {
		const queued = session.queue.shift();
		if (queued) {
			this.send(res, 200, queued);
			return;
		}
		// Long-poll: hold the request until the next event or a keepalive timeout.
		session.waiter = (event) => this.send(res, 200, event);
		session.waiterTimer = setTimeout(() => {
			session.waiter = null;
			session.waiterTimer = null;
			this.send(res, 200, { kind: "idle" } satisfies ServerEvent);
		}, LONG_POLL_MS);
		res.on("close", () => {
			// Client hung up mid-poll; drop the waiter so we don't write to a dead socket.
			if (session.waiterTimer) clearTimeout(session.waiterTimer);
			session.waiter = null;
			session.waiterTimer = null;
		});
	}

	private handleReply(
		session: Session,
		body: { requestId?: string; value?: unknown; cancelled?: boolean },
	): void {
		if (!body.requestId) return;
		const pending = session.pending.get(body.requestId);
		if (!pending) return;
		session.pending.delete(body.requestId);
		if (body.cancelled) {
			pending.reject(new Error("Prompt cancelled"));
		} else {
			pending.resolve(body.value);
		}
	}
}

export const interactivePromptServer = new InteractivePromptServer();
