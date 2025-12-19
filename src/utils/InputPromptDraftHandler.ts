import { settingsStore } from "../settingsStore";
import {
	InputPromptDraftStore,
	type InputPromptDraftKey,
} from "./InputPromptDraftStore";

export class InputPromptDraftHandler {
	private readonly store = InputPromptDraftStore.getInstance();
	private readonly draftKey: string;
	private initialValue = "";
	private didChange = false;
	private readonly shouldPersist: () => boolean;

	constructor(key: InputPromptDraftKey, shouldPersist?: () => boolean) {
		this.draftKey = this.store.makeKey(key);
		this.shouldPersist = shouldPersist ??
			(() => settingsStore.getState().persistInputPromptDrafts);
	}

	hydrate(initialValue: string): string {
		this.initialValue = initialValue;
		if (!this.shouldPersist()) return initialValue;

		const draft = this.store.get(this.draftKey);
		return draft ?? initialValue;
	}

	markChanged(): void {
		this.didChange = true;
	}

	persist(value: string, didSubmit: boolean): void {
		if (!this.shouldPersist()) return;

		if (didSubmit) {
			this.store.clear(this.draftKey);
			return;
		}

		if (!this.didChange || value === this.initialValue) return;

		if (!value.trim()) {
			this.store.clear(this.draftKey);
			return;
		}

		this.store.set(this.draftKey, value);
	}
}
