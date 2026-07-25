export type InputPromptDraftKind = "single" | "multi";

export interface InputPromptDraftKey {
	kind: InputPromptDraftKind;
	header: string;
	placeholder?: string;
	linkSourcePath?: string;
	/**
	 * Stable per-choice discriminator. The header used to be the only thing
	 * separating one choice's prompt from another's (it was the choice name), so
	 * once prompts derive a shared title such as "Note title" (issue #1546) a
	 * cancelled draft from one choice would pre-fill the next. Also separates two
	 * choices that happen to have the same name. Absent for prompts raised
	 * outside a choice (script API), which keep the header-only key.
	 */
	scopeId?: string;
}

interface DraftEntry {
	value: string;
	timestamp: number;
}

export class InputPromptDraftStore {
	private static instance: InputPromptDraftStore;
	private drafts: Map<string, DraftEntry> = new Map();
	private pendingSubmittedDraftKeys: Set<string> = new Set();
	private executionScopeDepth = 0;
	private executionScopeFailed = false;
	private readonly MAX_ENTRIES = 100;

	static getInstance(): InputPromptDraftStore {
		if (!InputPromptDraftStore.instance) {
			InputPromptDraftStore.instance = new InputPromptDraftStore();
		}
		return InputPromptDraftStore.instance;
	}

	private constructor() {
		// Session-only store
	}

	makeKey(key: InputPromptDraftKey): string {
		return JSON.stringify({
			v: 1,
			kind: key.kind,
			header: key.header,
			placeholder: key.placeholder ?? "",
			linkSourcePath: key.linkSourcePath ?? "",
			scopeId: key.scopeId ?? "",
		});
	}

	get(key: string): string | undefined {
		const entry = this.drafts.get(key);
		if (!entry) return undefined;
		entry.timestamp = Date.now();
		return entry.value;
	}

	set(key: string, value: string): void {
		if (this.drafts.size >= this.MAX_ENTRIES && !this.drafts.has(key)) {
			this.evictOldest(1);
		}

		this.drafts.set(key, {
			value,
			timestamp: Date.now(),
		});
	}

	handleSubmittedDraft(key: string, value: string): void {
		if (!this.hasActiveExecutionScope()) {
			this.clear(key);
			return;
		}

		this.set(key, value);
		this.pendingSubmittedDraftKeys.add(key);
	}

	beginExecutionScope(): void {
		this.executionScopeDepth += 1;
	}

	commitExecutionScope(): void {
		if (!this.hasActiveExecutionScope()) return;

		this.executionScopeDepth -= 1;
		if (this.executionScopeDepth > 0) return;

		if (!this.executionScopeFailed) {
			for (const key of this.pendingSubmittedDraftKeys) {
				this.clear(key);
			}
		}

		this.resetExecutionScope();
	}

	rollbackExecutionScope(): void {
		if (!this.hasActiveExecutionScope()) return;

		this.executionScopeFailed = true;
		this.executionScopeDepth -= 1;
		if (this.executionScopeDepth === 0) {
			this.resetExecutionScope();
		}
	}

	markExecutionScopeFailed(): void {
		if (!this.hasActiveExecutionScope()) return;

		this.executionScopeFailed = true;
	}

	hasActiveExecutionScope(): boolean {
		return this.executionScopeDepth > 0;
	}

	clear(key: string): void {
		this.drafts.delete(key);
		this.pendingSubmittedDraftKeys.delete(key);
	}

	clearAll(): void {
		this.drafts.clear();
		this.resetExecutionScope();
	}

	private evictOldest(count: number): void {
		const entries = Array.from(this.drafts.entries())
			.sort(([, a], [, b]) => a.timestamp - b.timestamp)
			.slice(0, count);

		for (const [key] of entries) {
			this.drafts.delete(key);
			this.pendingSubmittedDraftKeys.delete(key);
		}
	}

	private resetExecutionScope(): void {
		this.pendingSubmittedDraftKeys.clear();
		this.executionScopeDepth = 0;
		this.executionScopeFailed = false;
	}
}
