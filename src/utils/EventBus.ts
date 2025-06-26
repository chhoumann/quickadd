export type EventHandler<Args extends unknown[] = unknown[]> = (...args: Args) => void;

/**
 * Very small pub-sub implementation used by the public QuickAdd API.
 * We keep it intentionally minimal (no wildcard events, no namespaces)
 * and strongly typed via a string union should a wider QuickAddEvent
 * type be introduced later.
 */
export class EventBus<Event extends string = string> {
	private static _instance: EventBus<string>;

	/**
	 * Lazily create a single global EventBus instance. We want a single
	 * bus for the entire plugin lifecycle so extensions can communicate
	 * between each other if they wish.
	 */
	public static getInstance(): EventBus<string> {
		if (!EventBus._instance) {
			EventBus._instance = new EventBus();
		}
		return EventBus._instance;
	}

	private listeners: Map<Event, Set<EventHandler>> = new Map();

	private constructor() {}

	/**
	 * Register a persistent handler for an event.
	 */
	on(event: Event, handler: EventHandler): void {
		let handlers = this.listeners.get(event);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(event, handlers);
		}
		handlers.add(handler);
	}

	/**
	 * Remove a previously registered handler.
	 */
	off(event: Event, handler: EventHandler): void {
		const handlers = this.listeners.get(event);
		if (!handlers) return;
		handlers.delete(handler);
		if (handlers.size === 0) {
			this.listeners.delete(event);
		}
	}

	/**
	 * Register a handler that will be invoked at most once.
	 */
	once(event: Event, handler: EventHandler): void {
		const wrapper: EventHandler = (...args: unknown[]) => {
			this.off(event, wrapper);
			handler(...args);
		};
		this.on(event, wrapper);
	}

	/**
	 * Emit an event with arguments.  Internal use – we don't expose
	 * this on the public API in Phase 1, but QuickAdd internals can
	 * import and use it directly.
	 */
	emit(event: Event, ...args: unknown[]): void {
		const handlers = this.listeners.get(event);
		if (!handlers) return;
		// Copy to array to allow handlers to de-register themselves safely
		[...handlers].forEach((h) => {
			try {
				h(...args);
			} catch (err) {
				// Ensure one faulty handler doesn't break the rest.
				console.error("QuickAdd EventBus handler error", err);
			}
		});
	}
}

// Alias type for easier future refactor when we introduce a concrete
// union of event names (e.g. "choice:execute:start").
export type QuickAddEvent = string;