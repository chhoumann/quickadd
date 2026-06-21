import { describe, it, expect, vi } from "vitest";
import { renderStoredFileValue } from "./fileTokenRendering";

// decodeFileValue contract: a real pick is "@file:<path>" (kind file), typed
// text is "@filecustom:<text>" (kind custom), "" is empty, and any other bare
// string is kind raw (passed through verbatim, never resolved to a file).
describe("renderStoredFileValue", () => {
	const link = (stored: unknown) => `[[${String(stored)}]]`;

	it("renders a picked file's basename in name mode", () => {
		expect(renderStoredFileValue("@file:Notes/Idea.md", "name", link)).toBe(
			"Idea",
		);
	});

	it("renders the full path in path mode", () => {
		expect(renderStoredFileValue("@file:Notes/Idea.md", "path", link)).toBe(
			"Notes/Idea.md",
		);
	});

	it("delegates link mode to the injected resolver (verbatim stored value)", () => {
		const resolve = vi.fn(() => "[[Notes/Idea|Idea]]");
		expect(renderStoredFileValue("@file:Notes/Idea.md", "link", resolve)).toBe(
			"[[Notes/Idea|Idea]]",
		);
		expect(resolve).toHaveBeenCalledWith("@file:Notes/Idea.md");
	});

	it("renders empty for an empty stored value", () => {
		expect(renderStoredFileValue("", "name", link)).toBe("");
		expect(renderStoredFileValue("", "path", link)).toBe("");
	});

	it("passes literal custom text through verbatim, never resolving it", () => {
		const resolve = vi.fn(() => "SHOULD-NOT-BE-CALLED");
		expect(
			renderStoredFileValue("@filecustom:My typed value", "name", resolve),
		).toBe("My typed value");
		expect(resolve).not.toHaveBeenCalled();
	});

	it("passes a bare (unprefixed) raw string through verbatim", () => {
		expect(renderStoredFileValue("just text", "name", link)).toBe("just text");
		expect(renderStoredFileValue("just text", "path", link)).toBe("just text");
	});

	it("maps array stored values element-wise", () => {
		expect(
			renderStoredFileValue(["@file:A/one.md", "@file:B/two.md"], "name", link),
		).toEqual(["one", "two"]);
	});

	it("applies link mode element-wise for arrays", () => {
		expect(
			renderStoredFileValue(["@file:one.md", "@file:two.md"], "link", link),
		).toEqual(["[[@file:one.md]]", "[[@file:two.md]]"]);
	});
});
