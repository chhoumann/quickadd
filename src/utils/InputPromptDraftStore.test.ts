import { beforeEach, describe, expect, it } from "vitest";
import { InputPromptDraftHandler } from "./InputPromptDraftHandler";
import { InputPromptDraftStore } from "./InputPromptDraftStore";

describe("InputPromptDraftStore execution scopes", () => {
	const store = InputPromptDraftStore.getInstance();
	const key = {
		kind: "single" as const,
		header: "Enter value",
		placeholder: "",
	};
	const draftKey = store.makeKey(key);
	const shouldPersist = () => true;

	beforeEach(() => {
		store.clearAll();
	});

	it("keeps existing submit behavior outside an execution scope", () => {
		store.set(draftKey, "old draft");
		const handler = new InputPromptDraftHandler(key, shouldPersist);

		handler.persist("submitted", true);

		expect(store.get(draftKey)).toBeUndefined();
	});

	it("keeps submitted drafts pending until the execution scope commits", () => {
		const handler = new InputPromptDraftHandler(key, shouldPersist);

		store.beginExecutionScope();
		handler.persist("submitted", true);

		expect(store.get(draftKey)).toBe("submitted");

		store.commitExecutionScope();

		expect(store.get(draftKey)).toBeUndefined();
	});

	it("preserves submitted drafts when the execution scope rolls back", () => {
		const handler = new InputPromptDraftHandler(key, shouldPersist);

		store.beginExecutionScope();
		handler.persist("submitted", true);
		store.rollbackExecutionScope();

		expect(store.get(draftKey)).toBe("submitted");
	});

	it("preserves submitted drafts when a swallowed failure marks the scope failed", () => {
		const handler = new InputPromptDraftHandler(key, shouldPersist);

		store.beginExecutionScope();
		handler.persist("submitted", true);
		store.markExecutionScopeFailed();
		store.commitExecutionScope();

		expect(store.get(draftKey)).toBe("submitted");
	});

	it("does not resurrect unchanged defaults after cancellation before submit", () => {
		const handler = new InputPromptDraftHandler(key, shouldPersist);

		expect(handler.hydrate("default")).toBe("default");
		handler.persist("default", false);

		expect(store.get(draftKey)).toBeUndefined();
	});

	it("keeps changed non-empty drafts after cancellation before submit", () => {
		const handler = new InputPromptDraftHandler(key, shouldPersist);

		expect(handler.hydrate("default")).toBe("default");
		handler.markChanged();
		handler.persist("changed", false);

		expect(store.get(draftKey)).toBe("changed");
	});
});
