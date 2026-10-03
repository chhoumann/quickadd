import { describe, expect, it } from "vitest";
import { protectUserText, restoreUserText, restoreUserTextAt } from "./userText";

describe("user text marks", () => {
	it.each(["{{{VALUE}}}", "<%* tR += '{{x}}' -%>", "<{%{<%%>>", "{\uFDD0x", "plain"])(
		"hide every token or tag delimiter in %j and restore it exactly",
		(text) => {
			const marked = protectUserText(text);
			expect(marked).not.toMatch(/\{\{|<%|%>/);
			expect(restoreUserText(marked)).toBe(text);
		},
	);

	it("keeps offsets on the same character", () => {
		const marked = `${protectUserText("a{{b}}")}|${protectUserText("<%c")}|`;
		const restored = restoreUserTextAt(marked, [marked.indexOf("|"), marked.length]);
		expect(restored).toEqual({ content: "a{{b}}|<%c|", offsets: [6, 11] });
	});
});
