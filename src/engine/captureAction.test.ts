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

	it("returns 'prepend' when prepend is true", () => {
		const choice = createChoice({ prepend: true });
		expect(getCaptureAction(choice)).toBe("prepend");
	});

	it("returns 'append' by default", () => {
		const choice = createChoice();
		expect(getCaptureAction(choice)).toBe("append");
	});

	it("treats legacy active-file prepend as bottom append", () => {
		const choice = createChoice({ captureToActiveFile: true, prepend: true });
		expect(getCaptureAction(choice)).toBe("append");
	});

	it("prioritizes insertAfter over prepend when both are set", () => {
		const choice = createChoice({ 
			prepend: true, 
			insertAfter: { enabled: true, after: "heading", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" }
		});
		expect(getCaptureAction(choice)).toBe("insertAfter");
	});

	it("prioritizes insertBefore over prepend when both are set", () => {
		const choice = createChoice({
			prepend: true,
			insertBefore: {
				enabled: true,
				before: "heading",
				createIfNotFound: false,
				createIfNotFoundLocation: "",
			},
		});
		expect(getCaptureAction(choice)).toBe("insertBefore");
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

	it("returns 'append' when capturing to active file at bottom", () => {
		const choice = createChoice({
			captureToActiveFile: true,
			activeFileWritePosition: "bottom",
		});
		expect(getCaptureAction(choice)).toBe("append");
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
		["property capture over everything", { prepend: true, propertyCapture: { property: { kind: "prompt" as const }, action: "set" as const, createIfMissing: true } }, "property"],
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
		expect(getCaptureAction(choice)).toBe("append");
		expect(getWritePosition(choice)).toBe("top");
	});

	// The editor handles these actions itself; every flag combination that
	// reaches one must report the matching position.
	it("agrees with getCaptureAction on every editor-side action", () => {
		const editorPosition = { currentLine: "top", newLineAbove: "newLineAbove", newLineBelow: "newLineBelow", activeFileTop: "activeTop" } as const;
		let checked = 0;
		for (const active of [true, false])
			for (const prepend of [true, false])
				for (const after of [true, false])
					for (const before of [true, false])
						for (const newLine of [undefined, "above", "below"] as const)
							for (const position of ["cursor", "top", "bottom"] as const) {
								const choice = capture({ captureToActiveFile: active, prepend, activeFileWritePosition: position });
								choice.insertAfter.enabled = after;
								choice.insertBefore = { enabled: before, before: "", createIfNotFound: false, createIfNotFoundLocation: "top" };
								choice.newLineCapture = { enabled: !!newLine, direction: newLine ?? "below" };
								const action = getCaptureAction(choice);
								if (!(action in editorPosition)) continue;
								expect(getWritePosition(choice)).toBe(editorPosition[action as keyof typeof editorPosition]);
								checked++;
							}
		expect(checked).toBeGreaterThan(0);
	});
});
