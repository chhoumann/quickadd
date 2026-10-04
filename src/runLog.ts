import type { DataAdapter } from "obsidian";
import type { ChoiceEffect } from "./types/ChoiceOutcome";

export interface RunLogEntry {
	/** When the run ended, as an ISO time. */
	at: string;
	choiceId: string;
	choiceName: string;
	status: "success" | "error" | "cancelled";
	effect?: ChoiceEffect;
	/** The note the run last wrote to. */
	path?: string;
	reason?: string;
	durationMs: number;
}

export const RUN_LOG_LIMIT = 50;
const WRITE_INTERVAL_MS = 1000;

type Adapter = Pick<DataAdapter, "exists" | "read" | "write">;

/**
 * The last runs on this device. Kept in its own file next to data.json, not in
 * it, so it does not sync: it says what happened here.
 */
export class RunLog {
	private entries: RunLogEntry[] = [];
	private readonly listeners = new Set<() => void>();
	private storage: { adapter: Adapter; path: string } | null = null;
	private pendingWrite: ReturnType<typeof setTimeout> | null = null;
	private writing: Promise<void> = Promise.resolve();

	/** Reads the log from `path`; later changes are written there. */
	async load(adapter: Adapter, path: string): Promise<void> {
		this.storage = { adapter, path };
		if (!(await adapter.exists(path))) return;
		try {
			const stored: unknown = JSON.parse(await adapter.read(path));
			if (Array.isArray(stored)) this.entries = (stored as RunLogEntry[]).slice(-RUN_LOG_LIMIT);
		} catch {
			// An unreadable log starts over; the next run rewrites it.
		}
		this.changed();
	}

	/** Newest first. */
	list(): RunLogEntry[] {
		return [...this.entries].reverse();
	}

	append(entry: RunLogEntry): void {
		this.entries = [...this.entries, entry].slice(-RUN_LOG_LIMIT);
		this.save();
	}

	clear(): void {
		this.entries = [];
		this.save();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Writes a change still waiting for its turn, after any write under way. */
	async flush(): Promise<void> {
		if (this.pendingWrite !== null) {
			clearTimeout(this.pendingWrite);
			this.pendingWrite = null;
			this.write();
		}
		await this.writing;
	}

	private save(): void {
		this.changed();
		if (this.storage && this.pendingWrite === null) {
			this.pendingWrite = setTimeout(() => {
				this.pendingWrite = null;
				this.write();
			}, WRITE_INTERVAL_MS);
		}
	}

	/**
	 * Writes run one after another, each with the entries as they are when its
	 * turn comes, so a slow earlier write cannot land over a newer one.
	 */
	private write(): void {
		const storage = this.storage;
		if (!storage) return;
		this.writing = this.writing
			.catch(() => undefined)
			.then(() => storage.adapter.write(storage.path, JSON.stringify(this.entries, null, "\t")));
	}

	private changed(): void {
		for (const listener of this.listeners) listener();
	}
}

export const runLog = new RunLog();
