import { describe, expect, it } from "vitest";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { getCaptureAction, getWritePosition } from "./captureAction";
import { CaptureChoice } from "../types/choices/CaptureChoice";

describe("getCaptureAction", () => {
	const createChoice = (overrides: Partial<ICaptureChoice> = {}): ICaptureChoice => ({
		id: "test",
		name: "Test Choice",
		type: "Capture",
		command: false,
		captureTo: "",
		captureToActiveFile: false,
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
		format: { enabled: false, format: "" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: true },
		...overrides
	});

	it("returns 'currentLine' when captureToActiveFile is true and no other options", () => {
		const choice = createChoice({ captureToActiveFile: true });
		expect(getCaptureAction(choice)).toBe("currentLine");
	});

	it("returns 'insertAfter' when insertAfter is enabled", () => {
		const choice = createChoice({ insertAfter: { enabled: true, after: "heading", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" } });
		expect(getCaptureAction(choice)).toBe("insertAfter");
	});

	it("returns 'insertBefore' when insertBefore is enabled", () => {
		const choice = createChoice({
			insertBefore: {
				enabled: true,
				before: "heading",
				createIfNotFound: false,
				createIfNotFoundLocation: "",
			},
		});
		expect(getCaptureAction(choice)).toBe("insertBefore");
	});

	it("returns 'bottom' when the legacy prepend flag is set", () => {
		const choice = createChoice({ prepend: true });
		expect(getCaptureAction(choice)).toBe("bottom");
	});

	it("returns 'top' by default", () => {
		const choice = createChoice();
		expect(getCaptureAction(choice)).toBe("top");
	});

	it("treats legacy active-file prepend as a bottom write", () => {
		const choice = createChoice({ captureToActiveFile: true, prepend: true });
		expect(getCaptureAction(choice)).toBe("bottom");
	});

	it("puts a bottom write ahead of insertAfter, as the formatter places it", () => {
		const choice = createChoice({ 
			prepend: true, 
			insertAfter: { enabled: true, after: "heading", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" }
		});
		expect(getCaptureAction(choice)).toBe("bottom");
	});

	it("puts a bottom write ahead of insertBefore, as the formatter places it", () => {
		const choice = createChoice({
			prepend: true,
			insertBefore: {
				enabled: true,
				before: "heading",
				createIfNotFound: false,
				createIfNotFoundLocation: "",
			},
		});
		expect(getCaptureAction(choice)).toBe("bottom");
	});

	it("returns 'newLineAbove' when newLineCapture is enabled with above direction", () => {
		const choice = createChoice({ 
			captureToActiveFile: true,
			newLineCapture: { enabled: true, direction: "above" }
		});
		expect(getCaptureAction(choice)).toBe("newLineAbove");
	});

	it("returns 'newLineBelow' when newLineCapture is enabled with below direction", () => {
		const choice = createChoice({ 
			captureToActiveFile: true,
			newLineCapture: { enabled: true, direction: "below" }
		});
		expect(getCaptureAction(choice)).toBe("newLineBelow");
	});

	it("prioritizes newLineCapture over currentLine when both could apply", () => {
		const choice = createChoice({ 
			captureToActiveFile: true,
			newLineCapture: { enabled: true, direction: "below" }
		});
		expect(getCaptureAction(choice)).toBe("newLineBelow");
	});

	it("returns 'activeFileTop' when capturing to active file with write position set to top", () => {
		const choice = createChoice({
			captureToActiveFile: true,
			activeFileWritePosition: "top",
		});
		expect(getCaptureAction(choice)).toBe("activeFileTop");
	});

	it("returns 'currentLine' when capturing to active file with default cursor position", () => {
		const choice = createChoice({
			captureToActiveFile: true,
			activeFileWritePosition: "cursor",
		});
		expect(getCaptureAction(choice)).toBe("currentLine");
	});

	it("returns 'bottom' when capturing to active file at bottom", () => {
		const choice = createChoice({
			captureToActiveFile: true,
			activeFileWritePosition: "bottom",
		});
		expect(getCaptureAction(choice)).toBe("bottom");
	});

	it("prioritizes 'activeFileTop' over the default append action when eligible", () => {
		const choice = createChoice({
			captureToActiveFile: true,
			activeFileWritePosition: "top",
			prepend: false,
			insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
		});
		expect(getCaptureAction(choice)).toBe("activeFileTop");
	});
});

describe("getWritePosition", () => {
	const capture = (overrides: Partial<ICaptureChoice>): ICaptureChoice =>
		Object.assign(new CaptureChoice("Test"), overrides);

	it.each([
		["legacy prepend on a fixed file", { prepend: true }, "bottom"],
		["plain fixed file", {}, "top"],
		["active file with no position", { captureToActiveFile: true }, "top"],
		["legacy prepend on the active file", { captureToActiveFile: true, prepend: true }, "bottom"],
		["active file top", { captureToActiveFile: true, activeFileWritePosition: "top" as const }, "activeTop"],
		["new line above on the active file", { captureToActiveFile: true, newLineCapture: { enabled: true, direction: "above" as const } }, "newLineAbove"],
		["property capture over everything", { prepend: true, propertyCapture: { property: { kind: "prompt" as const }, action: "set" as const, createIfMissing: true, sort: "none" as const } }, "property"],
	])("resolves %s", (_label, overrides, expected) => {
		expect(getWritePosition(capture(overrides))).toBe(expected);
	});

	it.each([
		["a bottom write ahead of a line target, as the formatter does", { prepend: true }, "insertBefore", "bottom"],
		["insert-after ahead of insert-before", {}, "both", "after"],
		["a line target ahead of an active-file new-line flag", { captureToActiveFile: true, newLineCapture: { enabled: true, direction: "above" as const } }, "insertAfter", "after"],
	])("reports %s", (_label, overrides, lineTarget, expected) => {
		const choice = capture(overrides);
		if (lineTarget !== "insertBefore") choice.insertAfter.enabled = true;
		if (lineTarget !== "insertAfter") choice.insertBefore = { enabled: true, before: "## End", createIfNotFound: false, createIfNotFoundLocation: "top" };
		expect(getWritePosition(choice)).toBe(expected);
	});

	it("ignores a new-line flag on a fixed file, as the runtime does", () => {
		const choice = capture({ newLineCapture: { enabled: true, direction: "above" } });
		expect(getCaptureAction(choice)).toBe("top");
		expect(getWritePosition(choice)).toBe("top");
	});
});
