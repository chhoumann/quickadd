import { describe, expect, it } from "vitest";
import {
	buildPromptContextLine,
	describeValuePrompt,
	elideMiddlePath,
	isOnlyValueToken,
	isSoleValueToken,
	scopeShowsDestination,
	valueAnswersWholeScope,
} from "./promptScope";

/**
 * Copy rules for runtime prompts (issue #1546). The contract these tests pin is
 * "never assert something the configuration does not support": a derived TITLE
 * is only allowed when the user's answer really is the whole of what the scope
 * names.
 */
describe("isSoleValueToken", () => {
	it.each([
		"{{VALUE}}",
		"{{value}}",
		"{{NAME}}",
		"  {{VALUE}}  ",
		"{{VALUE|optional}}",
		"{{VALUE|type:number|min:1}}",
		"{{value}}\n",
	])("accepts %j", (input) => {
		expect(isSoleValueToken(input)).toBe(true);
	});

	it.each([
		"{{VALUE:name}}",
		"{{DATE:YYYY-MM-DD}} {{VALUE}}",
		"- [ ] {{VALUE}}",
		"Daily/{{VALUE}}.md",
		"{{VALUE}} {{VALUE}}",
		"",
		"literal",
	])("rejects %j", (input) => {
		expect(isSoleValueToken(input)).toBe(false);
	});
});

describe("isOnlyValueToken", () => {
	it("allows literal decoration around the token", () => {
		expect(isOnlyValueToken("- [ ] {{VALUE}}\n")).toBe(true);
		expect(isOnlyValueToken("- {{VALUE}} #inbox")).toBe(true);
		expect(isOnlyValueToken("{{VALUE}} {{VALUE}}")).toBe(true);
	});

	it("rejects strings carrying another token", () => {
		expect(isOnlyValueToken("{{DATE:YYYY-MM-DD}} {{VALUE}}")).toBe(false);
		expect(isOnlyValueToken("{{VALUE}} {{VALUE:author}}")).toBe(false);
	});

	it("rejects strings with no anonymous VALUE at all", () => {
		expect(isOnlyValueToken("plain text")).toBe(false);
		expect(isOnlyValueToken("{{VALUE:author}}")).toBe(false);
	});
});

describe("valueAnswersWholeScope", () => {
	it("is strict for paths: their literals are part of the answer", () => {
		// "Capture target" over `Daily/{{VALUE}}.md` would invite a full path.
		expect(valueAnswersWholeScope("captureTarget", "Daily/{{VALUE}}.md")).toBe(
			false,
		);
		expect(valueAnswersWholeScope("noteTitle", "{{DATE}} {{VALUE}}")).toBe(
			false,
		);
		expect(valueAnswersWholeScope("noteTitle", "{{VALUE}}")).toBe(true);
	});

	it("is strict for a template body: its literals ARE the note", () => {
		// One token, but the ask is a client name, not the note's content.
		const body = "---\nclient: {{VALUE}}\n---\n# Onboarding checklist\n";
		expect(valueAnswersWholeScope("noteBody", body)).toBe(false);
		expect(valueAnswersWholeScope("noteBody", "{{VALUE}}")).toBe(true);
	});

	it("is relaxed for a capture format: a task prefix is decoration, not input", () => {
		// The "Add to task list" toggle rewrites the format to `- [ ] {{VALUE}}`;
		// the ask is still exactly "the text to capture".
		expect(valueAnswersWholeScope("captureText", "- [ ] {{value}}\n")).toBe(
			true,
		);
		expect(valueAnswersWholeScope("captureText", "{{DATE}} {{VALUE}}")).toBe(
			false,
		);
	});
});

describe("describeValuePrompt", () => {
	it("only supplies a title when the answer is the whole thing", () => {
		expect(describeValuePrompt("noteTitle", true)).toEqual({
			title: "Note title",
			placeholder: "Title for the new note",
		});
		expect(describeValuePrompt("noteTitle", false)).toEqual({
			placeholder: "Part of the new note's title",
		});
	});

	it("asserts nothing for the generic scope", () => {
		expect(describeValuePrompt("generic", true)).toEqual({});
		expect(describeValuePrompt("generic", false)).toEqual({});
	});
});

describe("elideMiddlePath", () => {
	it("leaves short paths alone", () => {
		expect(elideMiddlePath("Daily/2026-07-26.md")).toBe("Daily/2026-07-26.md");
	});

	it("keeps the file name when eliding the middle", () => {
		const long = "Work/Clients/Acme/Meetings/2026/Weekly standup notes.md";
		expect(elideMiddlePath(long)).toBe("Work/…/Weekly standup notes.md");
	});

	it("keeps the file name when there is only one folder to drop", () => {
		const long = `Some Very Long Folder Name Indeed/${"n".repeat(20)}.md`;
		expect(elideMiddlePath(long)).toBe(`…/${"n".repeat(20)}.md`);
	});

	it("does not mangle a long single segment", () => {
		const long = `${"a".repeat(60)}.md`;
		expect(elideMiddlePath(long)).toBe(long);
	});
});

describe("buildPromptContextLine", () => {
	it("pairs the choice name with the destination", () => {
		expect(
			buildPromptContextLine(
				{
					choiceName: "New capture",
					destination: "Daily/2026-07-26.md",
					destinationKind: "file",
				},
				"Text to capture",
			),
		).toBe("New capture → Daily/2026-07-26.md");
	});

	it("marks a folder destination with a trailing slash", () => {
		expect(
			buildPromptContextLine(
				{
					choiceName: "New template",
					destination: "Books",
					destinationKind: "folder",
				},
				"Note title",
			),
		).toBe("New template → Books/");
	});

	it("never repeats the choice name when it is already the title", () => {
		expect(
			buildPromptContextLine(
				{ choiceName: "Add book", destination: "Books/Dune.md" },
				"Add book",
			),
		).toBe("→ Books/Dune.md");
	});

	it("says nothing when there is nothing true to say", () => {
		expect(buildPromptContextLine(undefined, "Note title")).toBeUndefined();
		expect(buildPromptContextLine({}, "Note title")).toBeUndefined();
		expect(
			buildPromptContextLine({ choiceName: "Add book" }, "Add book"),
		).toBeUndefined();
	});
});

describe("scopeShowsDestination", () => {
	it("withholds the destination where the answer does not land there", () => {
		expect(scopeShowsDestination("templatePath")).toBe(false);
		expect(scopeShowsDestination("generic")).toBe(false);
		expect(scopeShowsDestination("noteTitle")).toBe(true);
		expect(scopeShowsDestination("captureText")).toBe(true);
	});

	it("drops the destination from the line when withheld", () => {
		expect(
			buildPromptContextLine(
				{ choiceName: "Book note", destination: "Inbox/Draft.md" },
				"Template",
				{ showDestination: false },
			),
		).toBe("Book note");
	});
});

describe("buildPromptContextLine tooltip form", () => {
	it("can render the destination un-elided for the hover tooltip", () => {
		const context = {
			choiceName: "Note to self",
			destination: "Work/Clients/Acme/Meetings/2026/Weekly standup notes.md",
			destinationKind: "file" as const,
		};

		expect(buildPromptContextLine(context, "Text to capture")).toBe(
			"Note to self → Work/…/Weekly standup notes.md",
		);
		expect(
			buildPromptContextLine(context, "Text to capture", { elide: false }),
		).toBe(
			"Note to self → Work/Clients/Acme/Meetings/2026/Weekly standup notes.md",
		);
	});
});
