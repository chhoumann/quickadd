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

export interface CheckboxItem {
	title: string;
	value: string;
	checked: boolean;
}

/**
 * A prompt the running script is blocked on. Mirrors the QuickAdd API prompt
 * seam (suggester / inputPrompt / wideInputPrompt / datePrompt / yesNoPrompt /
 * checkboxPrompt / infoDialog). The reply `value` type per prompt:
 *  - suggester/input/date -> string   - confirm -> boolean
 *  - checkbox -> string[]             - info -> acknowledgement (any)
 */
export type PromptSpec =
	| {
			type: "suggester";
			placeholder?: string;
			allowCustomInput: boolean;
			items: SuggesterItem[];
	  }
	| {
			type: "input";
			header: string;
			placeholder?: string;
			defaultValue?: string;
			/** Render a multi-line field (wideInputPrompt). */
			multiline: boolean;
	  }
	| {
			type: "date";
			header: string;
			placeholder?: string;
			defaultValue?: string;
			dateFormat?: string;
	  }
	| { type: "confirm"; header: string; text?: string }
	| { type: "checkbox"; header?: string; items: CheckboxItem[] }
	| { type: "info"; header: string; text: string[] };

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
	/** True once a client has polled at least once. */
	attached: boolean;
	/** Aborts the run if no client attaches in time (avoids a hung executor). */
	attachTimer: ReturnType<typeof setTimeout> | null;
}

const LONG_POLL_MS = 25_000;
/** Keep a finished session around briefly so the client can still poll its final event. */
const SESSION_TTL_MS = 60_000;
/** Abort a run whose caller never attached, so a prompt can't park forever. */
const ATTACH_TIMEOUT_MS = 30_000;
/** Bound concurrent sessions so a runaway caller can't exhaust memory. */
const MAX_SESSIONS = 32;

/** Length-independent, constant-time string comparison (localhost, but cheap to be safe). */
export function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * True only for a request that looks like our own loopback client: no browser
 * Origin/Referer, and a Host of 127.0.0.1/localhost (DNS-rebinding guard).
 */
export function isLoopbackClient(headers: {
	origin?: string;
	referer?: string;
	host?: string;
}): boolean {
	if (headers.origin || headers.referer) return false;
	const hostname = (headers.host ?? "").split(":")[0];
	return hostname === "127.0.0.1" || hostname === "localhost";
}

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
		if (this.sessions.size >= MAX_SESSIONS) {
			throw new Error("Too many active interactive sessions.");
		}
		const id = randomId();
		const token = randomId() + randomId();
		const session: Session = {
			id,
			token,
			queue: [],
			waiter: null,
			waiterTimer: null,
			pending: new Map(),
			finished: false,
			cleanupTimer: null,
			attached: false,
			attachTimer: null,
		};
		session.attachTimer = setTimeout(() => {
			if (!session.attached && !session.finished) {
				this.finish(session.id, {
					kind: "error",
					error: "No client attached to the interactive session.",
				});
			}
		}, ATTACH_TIMEOUT_MS);
		this.sessions.set(id, session);
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
		if (session.attachTimer) {
			clearTimeout(session.attachTimer);
			session.attachTimer = null;
		}
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
			if (session.attachTimer) clearTimeout(session.attachTimer);
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
		if (session.attachTimer) clearTimeout(session.attachTimer);
		this.sessions.delete(session.id);
		if (this.sessions.size === 0) {
			this.server?.close();
			this.server = null;
			this.port = 0;
		}
	}

	private authed(session: Session | undefined, token: string | null): session is Session {
		return !!session && !!token && safeEqual(session.token, token);
	}

	/**
	 * Reject anything that doesn't look like our own loopback client: a browser
	 * (sends Origin/Referer) or a Host header that isn't 127.0.0.1/localhost
	 * (DNS-rebinding). The server is bound to loopback, but these headers are the
	 * cheap defence against a drive-by page probing the port.
	 */
	private originAllowed(req: IncomingMessage): boolean {
		return isLoopbackClient({
			origin: req.headers.origin,
			referer: req.headers.referer,
			host: req.headers.host,
		});
	}

	/**
	 * Deliver an answer (or a cancel) to the prompt a session is blocked on.
	 * Public so the HTTP layer and tests share one path. Returns true if a
	 * matching pending prompt was found.
	 */
	submitReply(
		sessionId: string,
		requestId: string,
		value: unknown,
		cancelled = false,
	): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		const pending = session.pending.get(requestId);
		if (!pending) return false;
		session.pending.delete(requestId);
		if (cancelled) pending.reject(new Error("Prompt cancelled"));
		else pending.resolve(value);
		return true;
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
			if (!this.originAllowed(req)) {
				this.send(res, 403, { ok: false, error: "Forbidden" });
				return;
			}
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
		// First poll = the caller attached; cancel the no-attach abort.
		if (!session.attached) {
			session.attached = true;
			if (session.attachTimer) {
				clearTimeout(session.attachTimer);
				session.attachTimer = null;
			}
		}
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
		this.submitReply(session.id, body.requestId, body.value, body.cancelled);
	}
}

export const interactivePromptServer = new InteractivePromptServer();
