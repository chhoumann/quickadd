export type InputPromptDraftKind = "single" | "multi";

export interface InputPromptDraftKey {
	kind: InputPromptDraftKind;
	header: string;
	placeholder?: string;
	linkSourcePath?: string;
}

interface DraftEntry {
	value: string;
	timestamp: number;
}

export class InputPromptDraftStore {
	private static instance: InputPromptDraftStore;
	private drafts: Map<string, DraftEntry> = new Map();
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
		});
	}

	get(key: string): string | undefined {
		return this.drafts.get(key)?.value;
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

	clear(key: string): void {
		this.drafts.delete(key);
	}

	clearAll(): void {
		this.drafts.clear();
	}

	private evictOldest(count: number): void {
		const entries = Array.from(this.drafts.entries())
			.sort(([, a], [, b]) => a.timestamp - b.timestamp)
			.slice(0, count);

		for (const [key] of entries) {
			this.drafts.delete(key);
		}
	}
}
