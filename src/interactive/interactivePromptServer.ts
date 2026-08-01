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

import {
	PROMPT_CANCELLED_MESSAGE,
	UserCancelError,
} from "../errors/UserCancelError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";

// Minimal structural types for the slice of Node's `http` we use, declared
// locally so this module never statically imports a Node builtin (keeps the
// mobile bundle clean; `http` is required lazily on desktop only).
interface HttpServer {
	on(event: "error", listener: (error: Error) => void): void;
	listen(port: number, host: string, callback: () => void): void;
	address(): { port: number } | string | null;
	close(): void;
}
interface HttpIncomingMessage extends AsyncIterable<Buffer> {
	url?: string;
	method?: string;
	headers: { origin?: string; referer?: string; host?: string };
}
interface HttpServerResponse {
	writeHead(status: number, headers: Record<string, string>): void;
	end(payload?: string): void;
	on(event: "close", listener: () => void): void;
}
type HttpModule = {
	createServer: (
		listener: (req: HttpIncomingMessage, res: HttpServerResponse) => void,
	) => HttpServer;
};

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

/** One field of a batch `requestInputs` form (a subset of QuickAdd's FieldRequirement). */
export interface FormField {
	id: string;
	label: string;
	type:
		| "text"
		| "number"
		| "textarea"
		| "dropdown"
		| "date"
		| "suggester"
		| "slider"
		| "field-suggest";
	placeholder?: string;
	defaultValue?: string;
	description?: string;
	options?: string[];
	displayOptions?: string[];
	dateFormat?: string;
	optional?: boolean;
	numericConfig?: { min?: number; max?: number; step?: number };
	suggesterConfig?: { allowCustomInput?: boolean; multiSelect?: boolean };
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
			type: "multiselect";
			placeholder?: string;
			allowCustomInput: boolean;
			items: SuggesterItem[];
			/** `value`s (wire tokens) that start pre-selected. */
			preselected: string[];
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
			/** Render a date *and time* picker (VDATE `|time`/`|datetime`). */
			withTime?: boolean;
	  }
	| { type: "confirm"; header: string; text?: string }
	| { type: "checkbox"; header?: string; items: CheckboxItem[] }
	| { type: "info"; header: string; text: string[] }
	| { type: "form"; fields: FormField[] };

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
	waiterTimer: number | null;
	pending: Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			/** What kind of reply this prompt accepts, for wire-level validation. */
			promptType: PromptSpec["type"];
		}
	>;
	finished: boolean;
	/**
	 * The client asked to end the run (`POST /abort`). Every pending prompt has been
	 * rejected; this makes a prompt raised AFTERWARDS reject immediately instead of
	 * parking, so a run that was mid-work when the abort arrived unwinds at its next
	 * prompt rather than carrying on to completion.
	 */
	aborted: boolean;
	cleanupTimer: number | null;
	/** True once a client has polled at least once. */
	attached: boolean;
	/** Aborts the run if no client attaches in time (avoids a hung executor). */
	attachTimer: number | null;
	/** Aborts the run if an attached client stops polling (disconnect/crash). */
	pollWatchdog: number | null;
}

const LONG_POLL_MS = 25_000;
/** Keep a finished session around briefly so the client can still poll its final event. */
const SESSION_TTL_MS = 60_000;
/** Abort a run whose caller never attached, so a prompt can't park forever. */
const ATTACH_TIMEOUT_MS = 30_000;
/**
 * Abort a run whose attached client stopped polling. A healthy client re-polls
 * at least every LONG_POLL_MS (25s), so this generous multiple only fires on a
 * genuine disconnect/crash — otherwise a prompt awaiting a reply would hang the
 * executor and leak the session forever.
 */
const POLL_TIMEOUT_MS = 75_000;
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
	const c = (window as { crypto?: Crypto }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	// The bearer token is the only local auth secret, so never fall back to a
	// non-cryptographic source: use getRandomValues, else fail closed.
	if (c?.getRandomValues) {
		const bytes = c.getRandomValues(new Uint8Array(16));
		return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	}
	throw new Error(
		"Interactive prompts require a secure random source (crypto), which is unavailable here.",
	);
}

/** Body of a `POST /reply`. Every field is untrusted JSON, hence the `unknown`s. */
export interface ReplyBody {
	requestId?: string;
	value?: unknown;
	cancelled?: unknown;
}

export type ReplyOutcome =
	| { ok: true }
	| { ok: false; status: 400 | 409; error: string };

const NO_PENDING_PROMPT = "No pending prompt for that requestId";

/**
 * Why a prompt that was waiting on the client will never be answered.
 *
 * Thrown as a {@link ChoiceAbortError}, not a bare `Error`, and that matters now that
 * ENGINE prompts travel this bridge too (#1614). `isCancellationError` is false for a
 * plain Error, so the engines' catch blocks would classify a client that simply stopped
 * polling as a run FAILURE - a red "Error running choice" notice on a desktop nobody is
 * sitting at, and an `error` outcome where the truth is an abort. A ChoiceAbortError
 * flows through the existing abort handling and lands as `cancelled`/`aborted` carrying
 * this reason.
 */
const SESSION_ENDED_REASON =
	"The interactive client disconnected, so the run was ended.";

/**
 * Why this reply cannot be honoured, or null if it can.
 *
 * Validating here rather than deeper in is what makes a malformed reply safe: the
 * client is still waiting on the HTTP response, so it gets an actionable 400 and the
 * prompt stays pending. Deeper in, the only options are to invent an answer (which
 * is the bug this seam had) or to fail the whole run with a message the client may
 * never see - the Template/Capture path replaces it with a generic sentence.
 *
 * Only two things are checked, both because a wrong answer there is
 * indistinguishable from a real one. Empty answers stay legal everywhere else:
 * `""` and `[]` are things a user genuinely submits in-app via the Skip
 * affordances and optional fields, so rejecting them would break optional prompts
 * on remote runs.
 */
function describeReplyProblem(
	promptType: PromptSpec["type"],
	body: ReplyBody,
): string | null {
	if (body.cancelled !== undefined && typeof body.cancelled !== "boolean") {
		return 'The "cancelled" flag must be the literal true (or omitted). A cancel that is not recognised would otherwise be answered on the user\'s behalf.';
	}
	if (body.cancelled === true) return null;

	if (promptType === "confirm") {
		const value = body.value;
		const isBoolean =
			value === true ||
			value === false ||
			value === "true" ||
			value === "false";
		if (!isBoolean) {
			return `A confirm prompt needs a boolean reply, or {"cancelled": true} if the user dismissed it. Got ${describeValue(value)}.`;
		}
	}
	return null;
}

/** A short, safe rendering of a bad reply value for an error message. */
function describeValue(value: unknown): string {
	if (value === undefined) return "no value";
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value.slice(0, 40));
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return Array.isArray(value) ? "an array" : typeof value;
}

class InteractivePromptServer {
	private server: HttpServer | null = null;
	private port = 0;
	private readonly sessions = new Map<string, Session>();
	// Memoized so concurrent ensureStarted() calls share one listen (no leaked
	// duplicate servers on a race between two interactive runs).
	private startPromise: Promise<number> | null = null;
	// Bumped by stop(). A listen() callback that resolves after a stop() belongs
	// to a torn-down generation and must discard its server, never install it —
	// otherwise unloading QuickAdd mid-startup leaves a live listener behind.
	private generation = 0;

	/** Start the server if needed and return the bound port. */
	async ensureStarted(): Promise<number> {
		if (this.server) return this.port;
		if (this.startPromise) return this.startPromise;
		const http = nodeRequire<HttpModule>("http");
		if (!http) {
			throw new Error(
				"Interactive prompts require desktop Obsidian (Node http is unavailable).",
			);
		}
		const generation = this.generation;
		this.startPromise = new Promise<number>((resolve, reject) => {
			const server = http.createServer(
				(req: HttpIncomingMessage, res: HttpServerResponse) =>
					void this.handle(req, res),
			);
			server.on("error", (error) => {
				if (this.generation === generation) this.startPromise = null;
				reject(error);
			});
			// Port 0 → OS picks a free port. Bind to loopback only.
			server.listen(0, "127.0.0.1", () => {
				if (this.generation !== generation) {
					// stop() ran while we were binding — discard this listener.
					server.close();
					reject(new Error("Interactive server stopped during startup."));
					return;
				}
				const address = server.address();
				this.port =
					typeof address === "object" && address ? address.port : 0;
				this.server = server;
				resolve(this.port);
			});
		});
		return this.startPromise;
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
			aborted: false,
			cleanupTimer: null,
			attached: false,
			attachTimer: null,
			pollWatchdog: null,
		};
		session.attachTimer = window.setTimeout(() => {
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
		// A prompt raised after the session ended (e.g. the no-attach timeout
		// already fired finish()) must reject, not park forever, so the executor
		// aborts instead of hanging.
		if (session.finished) {
			return Promise.reject(new ChoiceAbortError(SESSION_ENDED_REASON));
		}
		// The client already asked to end this run; do not park a new prompt it will
		// never answer.
		if (session.aborted) {
			return Promise.reject(new UserCancelError(PROMPT_CANCELLED_MESSAGE));
		}
		const requestId = randomId();
		return new Promise<unknown>((resolve, reject) => {
			session.pending.set(requestId, {
				resolve,
				reject,
				promptType: prompt.type,
			});
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
			window.clearTimeout(session.attachTimer);
			session.attachTimer = null;
		}
		if (session.pollWatchdog) {
			window.clearTimeout(session.pollWatchdog);
			session.pollWatchdog = null;
		}
		for (const [, pending] of session.pending) {
			pending.reject(new ChoiceAbortError(SESSION_ENDED_REASON));
		}
		session.pending.clear();
		this.push(session, event);
		session.cleanupTimer = window.setTimeout(
			() => this.destroySession(session),
			SESSION_TTL_MS,
		);
	}

	/**
	 * End a run at the client's request: reject everything it is blocked on, and make
	 * the next prompt reject too.
	 *
	 * This exists because cancelling an `info` prompt no longer aborts. Escape is the
	 * only gesture an info panel affords, so treating it as "end the run" made a remote
	 * run diverge from the identical run in the app, where `GenericInfoDialog` resolves
	 * on every close path and can never abort anything (#1605). Taking that away without
	 * replacing it would have left a client with no explicit way out at all - only
	 * stopping its polling and waiting out the 75-second watchdog.
	 *
	 * No final event is pushed: the run unwinds through the ordinary cancellation path
	 * and delivers its real outcome, which is more truthful than a fabricated one.
	 *
	 * The honest limit, documented at the wire: this interrupts prompts that were routed
	 * to the CLIENT. A run that is mid-work between prompts keeps going, which is why the
	 * reply says how many pending prompts it actually interrupted. The Template/Capture
	 * engine prompts that used to be outside that set - the file-exists chooser, the
	 * folder chooser, the capture-target and heading pickers - now travel this bridge and
	 * are interruptible (#1614); the AI tool-confirmation modal still is not.
	 *
	 * @returns the number of pending prompts rejected, or null if there is no live
	 * session to abort.
	 */
	abortSession(sessionId: string): number | null {
		const session = this.sessions.get(sessionId);
		if (!session || session.finished) return null;
		session.aborted = true;
		// Delete before rejecting, exactly as finish() does: a `/reply` that was already
		// mid-readBody would otherwise still find a pending entry, pass validation and
		// be answered 200 for a settle that is a no-op on an already-rejected promise.
		const pending = [...session.pending.values()];
		session.pending.clear();
		for (const prompt of pending) {
			prompt.reject(new UserCancelError(PROMPT_CANCELLED_MESSAGE));
		}
		// Drop prompts the client has not collected yet. A prompt raised while no poll
		// was parked sits in the queue, and the next poll would hand the client a dialog
		// it just asked to cancel - for a requestId that no longer exists, in front of
		// the run's real terminal event. Only prompts are dropped; a queued done/error
		// is the outcome the client is waiting for.
		session.queue = session.queue.filter((event) => event.kind !== "prompt");
		return pending.length;
	}

	/** Stop the server and drop all sessions (plugin unload). */
	stop(): void {
		// Invalidate any in-flight ensureStarted() so its listen() callback
		// discards the server instead of installing it after unload.
		this.generation++;
		for (const session of this.sessions.values()) {
			if (session.waiterTimer) window.clearTimeout(session.waiterTimer);
			if (session.cleanupTimer) window.clearTimeout(session.cleanupTimer);
			if (session.attachTimer) window.clearTimeout(session.attachTimer);
			if (session.pollWatchdog) window.clearTimeout(session.pollWatchdog);
			for (const [, pending] of session.pending) {
				pending.reject(
					new ChoiceAbortError("QuickAdd was unloaded during an interactive run."),
				);
			}
			// Close any parked long-poll response so it isn't orphaned after
			// server.close() (which won't terminate in-flight connections).
			if (session.waiter) {
				const waiter = session.waiter;
				session.waiter = null;
				waiter({ kind: "error", error: "QuickAdd unloaded" });
			}
		}
		this.sessions.clear();
		this.server?.close();
		this.server = null;
		this.port = 0;
		this.startPromise = null;
	}

	private push(session: Session, event: ServerEvent): void {
		if (session.waiter) {
			const waiter = session.waiter;
			session.waiter = null;
			if (session.waiterTimer) {
				window.clearTimeout(session.waiterTimer);
				session.waiterTimer = null;
			}
			waiter(event);
		} else {
			session.queue.push(event);
		}
	}

	private destroySession(session: Session): void {
		if (session.waiterTimer) window.clearTimeout(session.waiterTimer);
		if (session.cleanupTimer) window.clearTimeout(session.cleanupTimer);
		if (session.attachTimer) window.clearTimeout(session.attachTimer);
		if (session.pollWatchdog) window.clearTimeout(session.pollWatchdog);
		// Reject any still-pending prompt so a caller awaiting it aborts rather
		// than hanging (finish() normally clears these, but be defensive).
		for (const [, pending] of session.pending) {
			pending.reject(new ChoiceAbortError(SESSION_ENDED_REASON));
		}
		session.pending.clear();
		this.sessions.delete(session.id);
		if (this.sessions.size === 0) {
			this.server?.close();
			this.server = null;
			this.port = 0;
			this.startPromise = null;
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
	private originAllowed(req: HttpIncomingMessage): boolean {
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
		cancelled: unknown = false,
	): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		const pending = session.pending.get(requestId);
		if (!pending) return false;
		session.pending.delete(requestId);
		// A remote cancel must abort the run exactly like dismissing the Obsidian
		// modal: reject with UserCancelError so downstream abort handling classifies
		// it as a user cancellation (x-cancel, suppressed notice) rather than an error.
		//
		// Strict `=== true`. A malformed flag must never reach here as a plain answer -
		// `describeReplyProblem` turns it into a 400 at the wire, leaving the prompt
		// pending - because resolving it would hand the run an empty answer the user
		// never gave, which is worse than the spurious abort a loose truthy check caused.
		if (cancelled === true) {
			// An `info` prompt is the exception, and it is the in-app behaviour that
			// makes it one: `GenericInfoDialog` resolves on EVERY close path and has no
			// reject path at all, so pressing Escape on it in the app continues the run.
			// Escape is the only gesture an info panel affords, so a client that maps it
			// to a cancel used to kill a run the same choice would have finished in the
			// app (#1605). Closing an info panel is not a cancellation; a client that
			// really wants out sends `POST /abort`.
			//
			// Decided here rather than in RemotePromptProvider.infoDialog because the
			// provider cannot tell a per-prompt cancel from a session abort without a
			// second error class - and swallowing both would leave /abort unable to end
			// a run blocked on an info panel, the one case it exists for.
			if (pending.promptType === "info") pending.resolve(value);
			else pending.reject(new UserCancelError(PROMPT_CANCELLED_MESSAGE));
		} else pending.resolve(value);
		return true;
	}

	/** The pending prompt's type, or undefined if nothing is waiting on that id. */
	private pendingPromptType(
		session: Session,
		requestId: string,
	): PromptSpec["type"] | undefined {
		return session.pending.get(requestId)?.promptType;
	}

	private send(res: HttpServerResponse, status: number, body: unknown): void {
		const payload = JSON.stringify(body);
		res.writeHead(status, {
			"content-type": "application/json",
			"cache-control": "no-store",
		});
		res.end(payload);
	}

	/** Read and discard a request body we have no use for. */
	private async drainBody(req: HttpIncomingMessage): Promise<void> {
		let size = 0;
		for await (const chunk of req) {
			size += (chunk as Buffer).length;
			if (size > 1_000_000) throw new Error("Request body too large");
		}
	}

	private async readBody(req: HttpIncomingMessage): Promise<unknown> {
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

	private async handle(req: HttpIncomingMessage, res: HttpServerResponse): Promise<void> {
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
			if (req.method === "POST" && url.pathname === "/abort") {
				// Consume the request before answering, like /reply does. /abort takes no
				// body, but a client may still send one, and unread bytes left on a
				// keep-alive socket are the next request's problem. Node drains an
				// unconsumed request itself when the response finishes; doing it here
				// makes the route independent of that internal.
				await this.drainBody(req);
				const interrupted = this.abortSession(session.id);
				if (interrupted === null) {
					// The run already ended, so nothing was aborted. Saying ok:true would
					// tell the client it stopped something it did not.
					this.send(res, 409, {
						ok: false,
						error: "The interactive session has already ended",
					});
					return;
				}
				// `interrupted` lets a client tell an effective abort from a no-op: it is
				// 0 when the run was mid-work, or blocked on a prompt QuickAdd opened in
				// Obsidian rather than routing here.
				this.send(res, 200, { ok: true, interrupted });
				return;
			}
			if (req.method === "POST" && url.pathname === "/reply") {
				const body = (await this.readBody(req)) as ReplyBody;
				const outcome = this.submitWireReply(session.id, body);
				if (outcome.ok) {
					this.send(res, 200, { ok: true });
				} else {
					// 400: the reply itself is malformed, and the prompt is STILL
					// pending so the client can correct itself and try again.
					// 409: nothing was waiting on that requestId, so the client
					// doesn't believe a blocked run was answered.
					this.send(res, outcome.status, { ok: false, error: outcome.error });
				}
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

	private handlePoll(session: Session, res: HttpServerResponse): void {
		// First poll = the caller attached; cancel the no-attach abort.
		if (!session.attached) {
			session.attached = true;
			if (session.attachTimer) {
				window.clearTimeout(session.attachTimer);
				session.attachTimer = null;
			}
		}
		// Reset the disconnect watchdog on every poll: while the client keeps
		// polling the run stays alive; if it goes silent, abort so a pending
		// prompt doesn't hang the executor and leak the session.
		if (session.pollWatchdog) window.clearTimeout(session.pollWatchdog);
		session.pollWatchdog = window.setTimeout(() => {
			this.finish(session.id, {
				kind: "error",
				error: "Interactive client disconnected.",
			});
		}, POLL_TIMEOUT_MS);
		const queued = session.queue.shift();
		if (queued) {
			this.send(res, 200, queued);
			return;
		}
		// Only one poll may park at a time. A concurrent/overlapping poll (a
		// misbehaving or double-mounted client) gets an immediate idle instead
		// of overwriting - and cross-wiring - the parked waiter.
		if (session.waiter) {
			this.send(res, 200, { kind: "idle" } satisfies ServerEvent);
			return;
		}
		// Long-poll: hold the request until the next event or a keepalive timeout.
		// The identity checks below ensure a stale timeout/close only clears the
		// waiter it created, never a newer one.
		const waiter = (event: ServerEvent) => this.send(res, 200, event);
		session.waiter = waiter;
		session.waiterTimer = window.setTimeout(() => {
			if (session.waiter !== waiter) return;
			session.waiter = null;
			session.waiterTimer = null;
			this.send(res, 200, { kind: "idle" } satisfies ServerEvent);
		}, LONG_POLL_MS);
		res.on("close", () => {
			// Client hung up mid-poll; drop the waiter so we don't write to a dead socket.
			if (session.waiter !== waiter) return;
			if (session.waiterTimer) window.clearTimeout(session.waiterTimer);
			session.waiter = null;
			session.waiterTimer = null;
		});
	}

	/**
	 * Validate and deliver a reply that arrived over the wire. Public so the HTTP layer
	 * and tests share ONE path - the validation is the interesting part, and a test that
	 * bypassed it would be testing a shape production never sees.
	 */
	submitWireReply(sessionId: string, body: ReplyBody): ReplyOutcome {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { ok: false, status: 409, error: NO_PENDING_PROMPT };
		}
		if (!body.requestId) {
			return { ok: false, status: 409, error: NO_PENDING_PROMPT };
		}
		const promptType = this.pendingPromptType(session, body.requestId);
		if (!promptType) {
			return { ok: false, status: 409, error: NO_PENDING_PROMPT };
		}
		// Validate BEFORE settling. A reply we cannot honour must leave the prompt
		// pending and say why, never resolve it with something the user did not send.
		const problem = describeReplyProblem(promptType, body);
		if (problem) return { ok: false, status: 400, error: problem };

		const accepted = this.submitReply(
			session.id,
			body.requestId,
			body.value,
			body.cancelled,
		);
		return accepted
			? { ok: true }
			: { ok: false, status: 409, error: NO_PENDING_PROMPT };
	}
}

export const interactivePromptServer = new InteractivePromptServer();
