import { describe, expect, it } from "vitest";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { getCaptureAction } from "./captureAction";

describe("getCaptureAction", () => {
	const createChoice = (overrides: Partial<ICaptureChoice> = {}): ICaptureChoice => ({
		id: "test",
		name: "Test Choice",
		type: "Capture",
		command: false,
		captureTo: "",
		captureToActiveFile: false,
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

	it("returns 'prepend' when prepend is true", () => {
		const choice = createChoice({ prepend: true });
		expect(getCaptureAction(choice)).toBe("prepend");
	});

	it("returns 'append' by default", () => {
		const choice = createChoice();
		expect(getCaptureAction(choice)).toBe("append");
	});

	it("prioritizes currentLine over prepend when both are set", () => {
		const choice = createChoice({ captureToActiveFile: true, prepend: true });
		expect(getCaptureAction(choice)).toBe("prepend"); // prepend takes precedence
	});

	it("prioritizes insertAfter over prepend when both are set", () => {
		const choice = createChoice({ 
			prepend: true, 
			insertAfter: { enabled: true, after: "heading", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" }
		});
		expect(getCaptureAction(choice)).toBe("insertAfter");
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
});
