import type { QuickAddSettings } from "../settings";
import { deepClone } from "../utils/deepClone";

export interface SettingsPersistenceQueueOptions {
	debounceMs: number;
	maxWaitMs: number;
}

export interface FlushNowOptions {
	timeoutMs: number;
	maxRetryAttempts: number;
}

export interface SettingsPersistenceStats {
	scheduledRevisions: number;
	flushedRevisions: number;
	lastFlushedRevision: number;
	writesStarted: number;
	writesCompleted: number;
	writesFailed: number;
}

type PendingRevision = {
	revision: number;
	settingsRef: QuickAddSettings;
	firstScheduledAt: number;
	lastScheduledAt: number;
};

const DEFAULT_OPTIONS: SettingsPersistenceQueueOptions = {
	debounceMs: 150,
	maxWaitMs: 1000,
};

const DEFAULT_FLUSH_OPTIONS: FlushNowOptions = {
	timeoutMs: 10_000,
	maxRetryAttempts: 3,
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
		writesFailed: 0,
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
			settingsRef: next,
			firstScheduledAt: this.pending?.firstScheduledAt ?? now,
			lastScheduledAt: now,
		};
		this.stats.scheduledRevisions += 1;
		this.ensureLoop();
		this.wakeLoop();
		return revision;
	}

	async flushNow(options?: Partial<FlushNowOptions>): Promise<void> {
		const resolvedOptions: FlushNowOptions = {
			...DEFAULT_FLUSH_OPTIONS,
			...(options ?? {}),
		};
		const startedAt = Date.now();
		let retryCount = 0;

		this.flushRequested = true;
		try {
			for (;;) {
				if (!this.pending && !this.loopPromise) {
					return;
				}

				const remainingMs = this.getRemainingTimeoutMs(
					startedAt,
					resolvedOptions.timeoutMs,
				);
				if (remainingMs <= 0) {
					throw this.buildAndClearFlushError(
						`flushNow timed out after ${resolvedOptions.timeoutMs}ms.`,
						retryCount,
					);
				}

				if (!this.loopPromise && this.pending) {
					this.ensureLoop();
				}
				this.wakeLoop();

				const currentLoop = this.loopPromise;
				if (!currentLoop) {
					continue;
				}

				const completed = await this.waitForPromiseOrTimeout(
					currentLoop,
					remainingMs,
				);
				if (!completed) {
					throw this.buildAndClearFlushError(
						`flushNow timed out after ${resolvedOptions.timeoutMs}ms.`,
						retryCount,
					);
				}

				if (this.lastError === undefined) {
					continue;
				}

				retryCount += 1;
				if (retryCount > resolvedOptions.maxRetryAttempts) {
					throw this.buildAndClearFlushError(
						`flushNow exceeded retry limit (${resolvedOptions.maxRetryAttempts}).`,
						retryCount,
					);
				}

				this.lastError = undefined;
			}
		} finally {
			this.flushRequested = false;
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

		this.loopPromise = this.runLoop().finally(() => {
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
			const snapshot = deepClone(pending.settingsRef);

			try {
				await this.saveFn(snapshot);
				this.lastError = undefined;
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
						firstScheduledAt: pending.firstScheduledAt,
						lastScheduledAt: now,
					};
				}

				this.stats.writesFailed += 1;
				this.lastError = error;

				if (!this.flushRequested) {
					// Background mode: back off before the next attempt.
					await this.waitForSignal(Math.max(this.options.debounceMs, 50));
					continue;
				}

				// Exit loop so flushNow can apply retry bounds deterministically.
				return;
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

	private buildFlushError(
		message: string,
		cause: unknown,
		retryCount: number,
	): Error {
		const suffix =
			cause instanceof Error
				? ` Last error: ${cause.message}`
				: cause !== undefined
					? ` Last error: ${String(cause)}`
					: "";
		const err = new Error(`${message} Retries: ${retryCount}.${suffix}`);
		(err as Error & { cause?: unknown }).cause = cause;
		return err;
	}

	private buildAndClearFlushError(message: string, retryCount: number): Error {
		const cause = this.lastError;
		this.lastError = undefined;
		return this.buildFlushError(message, cause, retryCount);
	}

	private getRemainingTimeoutMs(startedAt: number, timeoutMs: number): number {
		const elapsed = Date.now() - startedAt;
		return timeoutMs - elapsed;
	}

	private async waitForPromiseOrTimeout(
		promise: Promise<void>,
		timeoutMs: number,
	): Promise<boolean> {
		return await new Promise<boolean>((resolve, reject) => {
			const timer = setTimeout(() => {
				resolve(false);
			}, timeoutMs);

			promise.then(
				() => {
					clearTimeout(timer);
					resolve(true);
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}
}
