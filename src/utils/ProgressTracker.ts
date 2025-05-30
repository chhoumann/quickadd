export interface ProgressUpdate {
	current: number;
	total: number;
	currentFile?: string;
	phase?: string;
	percentage: number;
	estimatedTimeRemaining?: number;
}

export interface ProgressCallback {
	(update: ProgressUpdate): void;
}

export interface ProgressOptions {
	showProgress?: boolean;
	updateInterval?: number; // ms
	estimateTime?: boolean;
}

export class ProgressTracker {
	private operationId: string;
	private total: number;
	private current = 0;
	private startTime: number;
	private lastUpdateTime = 0;
	private callback?: ProgressCallback;
	private options: ProgressOptions;
	private isCompleted = false;

	constructor(
		operationId: string,
		total: number,
		callback?: ProgressCallback,
		options: ProgressOptions = {}
	) {
		this.operationId = operationId;
		this.total = total;
		this.callback = callback;
		this.options = {
			showProgress: true,
			updateInterval: 100, // Update every 100ms
			estimateTime: true,
			...options
		};
		this.startTime = Date.now();
	}

	update(current?: number, currentFile?: string, phase?: string): void {
		if (this.isCompleted) return;

		if (current !== undefined) {
			this.current = current;
		} else {
			this.current++;
		}

		// Throttle updates based on update interval
		const now = Date.now();
		if (now - this.lastUpdateTime < this.options.updateInterval!) {
			return;
		}
		this.lastUpdateTime = now;

		const percentage = this.total === 0 ? 0 : Math.min((this.current / this.total) * 100, 100);
		
		let estimatedTimeRemaining: number | undefined;
		if (this.options.estimateTime && this.current > 0 && this.total > 0) {
			const elapsed = now - this.startTime;
			const averageTimePerItem = elapsed / this.current;
			const remaining = this.total - this.current;
			estimatedTimeRemaining = Math.round(remaining * averageTimePerItem);
		}

		const update: ProgressUpdate = {
			current: this.current,
			total: this.total,
			currentFile,
			phase,
			percentage,
			estimatedTimeRemaining
		};

		if (this.callback && this.options.showProgress) {
			this.callback(update);
		}
	}

	complete(): void {
		if (this.isCompleted) return;

		this.isCompleted = true;
		this.current = this.total;
		
		const update: ProgressUpdate = {
			current: this.total,
			total: this.total,
			percentage: this.total === 0 ? 100 : 100
		};

		if (this.callback && this.options.showProgress) {
			this.callback(update);
		}
	}

	getProgress(): ProgressUpdate {
		const percentage = this.total === 0 ? (this.isCompleted ? 100 : 0) : Math.min((this.current / this.total) * 100, 100);
		
		let estimatedTimeRemaining: number | undefined;
		if (this.options.estimateTime && this.current > 0 && this.total > 0) {
			const elapsed = Date.now() - this.startTime;
			const averageTimePerItem = elapsed / this.current;
			const remaining = this.total - this.current;
			estimatedTimeRemaining = Math.round(remaining * averageTimePerItem);
		}

		return {
			current: this.current,
			total: this.total,
			percentage,
			estimatedTimeRemaining
		};
	}

	cancel(): void {
		this.isCompleted = true;
	}

	get isComplete(): boolean {
		return this.isCompleted;
	}

	get id(): string {
		return this.operationId;
	}
}

export class ProgressManager {
	private static activeTrackers = new Map<string, ProgressTracker>();

	static create(
		operationId: string,
		total: number,
		callback?: ProgressCallback,
		options?: ProgressOptions
	): ProgressTracker {
		// Cancel any existing tracker with the same ID
		this.cancel(operationId);

		const tracker = new ProgressTracker(operationId, total, callback, options);
		this.activeTrackers.set(operationId, tracker);
		return tracker;
	}

	static get(operationId: string): ProgressTracker | undefined {
		return this.activeTrackers.get(operationId);
	}

	static cancel(operationId: string): void {
		const tracker = this.activeTrackers.get(operationId);
		if (tracker) {
			tracker.cancel();
			this.activeTrackers.delete(operationId);
		}
	}

	static cancelAll(): void {
		for (const [id, tracker] of this.activeTrackers) {
			tracker.cancel();
		}
		this.activeTrackers.clear();
	}

	static getActiveOperations(): string[] {
		return Array.from(this.activeTrackers.keys());
	}

	static formatProgress(update: ProgressUpdate): string {
		const { current, total, percentage, currentFile, phase, estimatedTimeRemaining } = update;
		
		let message = `Progress: ${current}/${total} (${percentage.toFixed(1)}%)`;
		
		if (phase) {
			message = `${phase}: ${message}`;
		}
		
		if (currentFile) {
			message += `\nCurrent: ${currentFile}`;
		}
		
		if (estimatedTimeRemaining && estimatedTimeRemaining > 0) {
			const seconds = Math.ceil(estimatedTimeRemaining / 1000);
			if (seconds < 60) {
				message += `\nETA: ${seconds}s`;
			} else {
				const minutes = Math.ceil(seconds / 60);
				message += `\nETA: ${minutes}m`;
			}
		}
		
		return message;
	}

	static createProgressBar(percentage: number, width = 20): string {
		const filled = Math.round((percentage / 100) * width);
		const empty = width - filled;
		return '█'.repeat(filled) + '░'.repeat(empty);
	}
}

// Helper for creating progress-aware async operations
export async function withProgress<T>(
	operationId: string,
	items: T[],
	processor: (item: T, index: number, tracker: ProgressTracker) => Promise<void>,
	callback?: ProgressCallback,
	options?: ProgressOptions
): Promise<void> {
	const tracker = ProgressManager.create(operationId, items.length, callback, options);
	
	try {
		for (let i = 0; i < items.length; i++) {
			if (tracker.isComplete) break; // Operation was cancelled
			
			await processor(items[i], i, tracker);
			tracker.update(i + 1);
		}
		
		tracker.complete();
	} catch (error) {
		ProgressManager.cancel(operationId);
		throw error;
	}
}