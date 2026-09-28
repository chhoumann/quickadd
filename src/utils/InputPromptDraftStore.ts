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

export interface ExecutionScope {
	submittedDraftKeys: Set<string>;
	failed: boolean;
}

interface DraftEntry {
	value: string;
	timestamp: number;
}

export class InputPromptDraftStore {
	private static instance: InputPromptDraftStore;
	private drafts: Map<string, DraftEntry> = new Map();
	/**
	 * One entry per running choice, innermost last. A choice clears the drafts
	 * it submitted once it completes, so a nested choice (a Macro step or an
	 * `executeChoice` call) that already wrote its text does not pre-fill the
	 * next run, even if the enclosing Macro is cancelled later.
	 */
	private executionScopes: ExecutionScope[] = [];
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
		const scope = this.executionScopes.at(-1);
		if (!scope) {
			this.clear(key);
			return;
		}

		this.set(key, value);
		scope.submittedDraftKeys.add(key);
	}

	beginExecutionScope(): ExecutionScope {
		const scope: ExecutionScope = { submittedDraftKeys: new Set(), failed: false };
		this.executionScopes.push(scope);
		return scope;
	}

	commitExecutionScope(scope: ExecutionScope): void {
		if (!this.endExecutionScope(scope) || scope.failed) return;

		for (const key of scope.submittedDraftKeys) {
			this.clear(key);
		}
	}

	rollbackExecutionScope(scope: ExecutionScope): void {
		if (!this.endExecutionScope(scope)) return;

		this.markExecutionScopeFailed();
	}

	/**
	 * A failure keeps the drafts of every choice still running, which includes
	 * the ones around the failing choice.
	 */
	markExecutionScopeFailed(): void {
		for (const scope of this.executionScopes) {
			scope.failed = true;
		}
	}

	hasActiveExecutionScope(): boolean {
		return this.executionScopes.length > 0;
	}

	clear(key: string): void {
		this.drafts.delete(key);
		for (const scope of this.executionScopes) {
			scope.submittedDraftKeys.delete(key);
		}
	}

	clearAll(): void {
		this.drafts.clear();
		this.executionScopes = [];
	}

	/** Scopes can end out of order when `executeChoice` calls overlap. */
	private endExecutionScope(scope: ExecutionScope): boolean {
		const index = this.executionScopes.indexOf(scope);
		if (index === -1) return false;

		this.executionScopes.splice(index, 1);
		return true;
	}

	private evictOldest(count: number): void {
		const entries = Array.from(this.drafts.entries())
			.sort(([, a], [, b]) => a.timestamp - b.timestamp)
			.slice(0, count);

		for (const [key] of entries) {
			this.clear(key);
		}
	}
}
