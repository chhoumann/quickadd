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

/**
 * Once prompts derive their title from what they are asking for (issue #1546),
 * the header stops discriminating one choice from another - "Note title" is the
 * same string for every Template choice. `scopeId` is what keeps their drafts
 * apart.
 */
describe("InputPromptDraftStore scope ids", () => {
	const store = InputPromptDraftStore.getInstance();
	const shouldPersist = () => true;
	const promptKey = (scopeId?: string) => ({
		kind: "single" as const,
		header: "Note title",
		placeholder: "Title for the new note",
		scopeId,
	});

	beforeEach(() => {
		store.clearAll();
	});

	it("does not let one choice's cancelled draft pre-fill another's prompt", () => {
		const bookChoice = new InputPromptDraftHandler(
			promptKey("choice-book"),
			shouldPersist,
		);
		bookChoice.hydrate("");
		bookChoice.markChanged();
		bookChoice.persist("Sapiens", false);

		const meetingChoice = new InputPromptDraftHandler(
			promptKey("choice-meeting"),
			shouldPersist,
		);

		expect(meetingChoice.hydrate("")).toBe("");
	});

	it("still restores the SAME choice's cancelled draft on a re-run", () => {
		const first = new InputPromptDraftHandler(
			promptKey("choice-book"),
			shouldPersist,
		);
		first.hydrate("");
		first.markChanged();
		first.persist("Sapiens", false);

		const rerun = new InputPromptDraftHandler(
			promptKey("choice-book"),
			shouldPersist,
		);

		expect(rerun.hydrate("")).toBe("Sapiens");
	});

	it("separates an included template's prompt from its parent's", () => {
		// {{TEMPLATE:...}} renders through its own formatter and raises its own
		// {{VALUE}} prompt in the same run.
		const parent = new InputPromptDraftHandler(
			promptKey("choice-meeting"),
			shouldPersist,
		);
		parent.hydrate("");
		parent.markChanged();
		parent.persist("Alice, Bob", false);

		const included = new InputPromptDraftHandler(
			promptKey("choice-meeting#Snippets/attendees.md"),
			shouldPersist,
		);

		expect(included.hydrate("")).toBe("");
	});
});
