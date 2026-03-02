import { describe, expect, it } from "vitest";
import { createDraftSession } from "./createDraftSession";

describe("createDraftSession", () => {
	it("isolates draft mutations from source until commit", () => {
		const source = {
			name: "Original",
			flags: {
				enabled: false,
			},
		};

		const session = createDraftSession(source);
		session.draft.name = "Updated";
		session.draft.flags.enabled = true;

		expect(source).toEqual({
			name: "Original",
			flags: {
				enabled: false,
			},
		});
		expect(session.isDirty()).toBe(true);

		const committed = session.commit();
		expect(committed).toEqual({
			name: "Updated",
			flags: {
				enabled: true,
			},
		});
		expect(session.isDirty()).toBe(false);
	});

	it("restores draft to baseline on discard", () => {
		const source = {
			path: "folder/note.md",
			options: {
				focus: true,
			},
		};

		const session = createDraftSession(source);
		session.draft.path = "updated.md";
		session.draft.options.focus = false;

		session.discard();

		expect(session.draft).toEqual(source);
		expect(session.isDirty()).toBe(false);
	});

	it("resets to latest committed state after discard", () => {
		const source = {
			title: "A",
			meta: { count: 1 },
		};

		const session = createDraftSession(source);
		session.draft.title = "B";
		session.draft.meta.count = 2;
		session.commit();

		session.draft.title = "C";
		session.discard();

		expect(session.draft).toEqual({
			title: "B",
			meta: { count: 2 },
		});
		expect(session.isDirty()).toBe(false);
	});
});
