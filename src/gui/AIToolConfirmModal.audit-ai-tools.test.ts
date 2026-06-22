import { describe, it, expect } from "vitest";
import { summarizeToolCall } from "./AIToolConfirmModal";

describe("ai-tools-tool-confirm-modal: summarizeToolCall surfaces the write target", () => {
	it("surfaces the target path as a labeled line for a create/append call", () => {
		expect(summarizeToolCall("create_note", { path: "Notes/Foo.md", content: "x" })).toBe(
			"Target: Notes/Foo.md",
		);
	});

	it("includes the heading when an insert_under_heading call has one", () => {
		const summary = summarizeToolCall("insert_under_heading", {
			path: "Notes/Bar.md",
			heading: "Tasks",
			content: "- [ ] x",
		});
		expect(summary).toContain("Target: Notes/Bar.md");
		expect(summary).toContain("Heading: Tasks");
	});

	it("returns an empty summary when no recognizable target field is present", () => {
		expect(summarizeToolCall("get_date", { format: "YYYY" })).toBe("");
		expect(summarizeToolCall("noop", {})).toBe("");
		expect(summarizeToolCall("noop", null)).toBe("");
		expect(summarizeToolCall("noop", "not-an-object" as unknown)).toBe("");
	});

	it("ignores blank/whitespace-only path or heading values", () => {
		expect(summarizeToolCall("create_note", { path: "   " })).toBe("");
	});
});
