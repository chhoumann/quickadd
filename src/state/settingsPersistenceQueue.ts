import type { QuickAddSettings } from "../settings";
import { deepClone } from "../utils/deepClone";

export interface SettingsPersistenceQueueOptions {
	debounceMs: number;
	maxWaitMs: number;
}

export interface SettingsPersistenceStats {
	scheduledRevisions: number;
	flushedRevisions: number;
	lastFlushedRevision: number;
	writesStarted: number;
	writesCompleted: number;
}

type PendingRevision = {
	revision: number;
	settings: QuickAddSettings;
	firstScheduledAt: number;
	lastScheduledAt: number;
};

const DEFAULT_OPTIONS: SettingsPersistenceQueueOptions = {
	debounceMs: 150,
	maxWaitMs: 1000,
};

export class SettingsPersistenceQueue {
	private readonly saveFn: (settings: QuickAddSettings) => Promise<void>;
	private readonly options: SettingsPersistenceQueueOptions;
	private readonly stats: SettingsPersistenceStats = {
		scheduledRevisions: 0,
		flushedRevisions: 0,
		lastFlushedRevision: 0,
		writesStarted: 0,
		writesCompleted: 0,
	};

	private pending: PendingRevision | null = null;
	private nextRevision = 0;
	private loopPromise: Promise<void> | null = null;
	private waitResolve?: () => void;
	private flushRequested = false;
	private lastError: unknown = undefined;

	constructor(
		saveFn: (settings: QuickAddSettings) => Promise<void>,
		options?: Partial<SettingsPersistenceQueueOptions>,
	) {
		this.saveFn = saveFn;
		this.options = {
			...DEFAULT_OPTIONS,
			...(options ?? {}),
		};
	}

	schedule(next: QuickAddSettings): number {
		const revision = ++this.nextRevision;
		const now = Date.now();

		this.pending = {
			revision,
			settings: deepClone(next),
			firstScheduledAt: this.pending?.firstScheduledAt ?? now,
			lastScheduledAt: now,
		};
		this.stats.scheduledRevisions = revision;
		this.ensureLoop();
		this.wakeLoop();
		return revision;
	}

	async flushNow(): Promise<void> {
		this.flushRequested = true;
		this.ensureLoop();
		this.wakeLoop();

		while (this.pending || this.loopPromise) {
			if (!this.loopPromise && this.pending) {
				this.ensureLoop();
			}
			this.wakeLoop();

			const currentLoop = this.loopPromise;
			if (!currentLoop) {
				break;
			}

			await currentLoop;
		}

		this.flushRequested = false;

		if (this.lastError !== undefined) {
			const err = this.lastError;
			this.lastError = undefined;
			throw err;
		}
	}

	getStats(): SettingsPersistenceStats {
		return { ...this.stats };
	}

	async dispose(): Promise<void> {
		await this.flushNow();
	}

	private ensureLoop(): void {
		if (this.loopPromise) {
			return;
		}

		this.loopPromise = this.runLoop()
			.catch((error) => {
				this.lastError = error;
			})
			.finally(() => {
				this.loopPromise = null;
			});
	}

	private wakeLoop(): void {
		this.waitResolve?.();
	}

	private async runLoop(): Promise<void> {
		for (;;) {
			const pending = this.pending;
			if (!pending) {
				return;
			}

			const waitMs = this.getWaitMs(pending);
			if (waitMs > 0) {
				await this.waitForSignal(waitMs);
				continue;
			}

			this.pending = null;
			this.stats.writesStarted += 1;

			try {
				await this.saveFn(pending.settings);
				this.stats.writesCompleted += 1;
				this.stats.flushedRevisions += 1;
				this.stats.lastFlushedRevision = pending.revision;
			} catch (error) {
				const pendingAfterFailure = this.pending as PendingRevision | null;

				// If there is no newer revision, re-queue the failed write.
				if (
					!pendingAfterFailure ||
					pendingAfterFailure.revision < pending.revision
				) {
					const now = Date.now();
					this.pending = {
						...pending,
						firstScheduledAt: now,
						lastScheduledAt: now,
					};
				}

				this.lastError = error;

				// Avoid hot-looping if save repeatedly fails.
				await this.waitForSignal(
					Math.max(this.options.debounceMs, 50),
				);
			}
		}
	}

	private getWaitMs(pending: PendingRevision): number {
		if (this.flushRequested) {
			return 0;
		}

		const now = Date.now();
		const debounceAt = pending.lastScheduledAt + this.options.debounceMs;
		const maxWaitAt = pending.firstScheduledAt + this.options.maxWaitMs;
		const dueAt = Math.min(debounceAt, maxWaitAt);
		return Math.max(0, dueAt - now);
	}

	private async waitForSignal(timeoutMs: number): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | null = null;

		await new Promise<void>((resolve) => {
			const complete = () => {
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}

				if (this.waitResolve === complete) {
					this.waitResolve = undefined;
				}

				resolve();
			};

			this.waitResolve = complete;
			timer = setTimeout(complete, timeoutMs);
		});
	}
}
