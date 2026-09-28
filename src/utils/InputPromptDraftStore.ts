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

interface ExecutionScope {
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

	beginExecutionScope(): void {
		this.executionScopes.push({ submittedDraftKeys: new Set(), failed: false });
	}

	commitExecutionScope(): void {
		const scope = this.executionScopes.pop();
		if (!scope || scope.failed) return;

		for (const key of scope.submittedDraftKeys) {
			this.clear(key);
		}
	}

	rollbackExecutionScope(): void {
		if (!this.executionScopes.pop()) return;

		this.markExecutionScopeFailed();
	}

	/** A failure keeps the drafts of the failing choice and every choice around it. */
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

	private evictOldest(count: number): void {
		const entries = Array.from(this.drafts.entries())
			.sort(([, a], [, b]) => a.timestamp - b.timestamp)
			.slice(0, count);

		for (const [key] of entries) {
			this.clear(key);
		}
	}
}
