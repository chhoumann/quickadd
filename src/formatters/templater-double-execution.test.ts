import { describe, it, expect, vi, beforeEach } from "vitest";

// Provide a stub for the 'obsidian' module so importing production code does not throw.
vi.mock("obsidian", () => ({
	// Only expose the minimal surface used in these tests.
	MarkdownView: class {},
	TFile: class {},
	App: class {},
}));

import type { App } from "obsidian";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

// Mock the utilityObsidian module but preserve all original exports except templaterParseTemplate
vi.mock("../utilityObsidian", async () => {
	const actual = await vi.importActual<any>("../utilityObsidian");
	return {
		...actual,
		templaterParseTemplate: vi.fn(async (_app: any, content: string) => `processed::${content}`),
	};
});

const createMockApp = () => ({
	workspace: { getActiveViewOfType: () => undefined },
}) as unknown as App;

const createDummyChoice = (): ICaptureChoice => ({
	name: "TestCapture",
	type: "Capture",
	// Minimal properties required by CaptureChoiceFormatter logic
	insertAfter: { enabled: false, after: "", createIfNotFound: false },
	prepend: true,
	captureToActiveFile: false,
	task: false,
} as unknown as ICaptureChoice);

describe("CaptureChoiceFormatter – templater execution", () => {
	let formatter: CaptureChoiceFormatter;
	let choice: ICaptureChoice;
	let app: any;

	beforeEach(() => {
		app = createMockApp();
		choice = createDummyChoice();
		formatter = new CaptureChoiceFormatter(app, {} as any, {} as any);
	});

	it("runs templater exactly once across multi-pass formatting", async () => {
		const { templaterParseTemplate } = await import("../utilityObsidian");

		// First pass – no file, no templater
		const first = await formatter.formatContentOnly("Hello <% tp.date.now %>");
		// Templater should NOT have been called yet
		expect((templaterParseTemplate as any).mock.calls.length).toBe(0);

		// Second pass – with file, templater should execute exactly once
		await formatter.formatContentWithFile(first, choice, "", { path: "dummy.md" } as any);
		expect((templaterParseTemplate as any).mock.calls.length).toBe(1);

		// A third pass on the same formatter should not re-execute templater
		await formatter.formatContentWithFile(first, choice, "", { path: "dummy.md" } as any);
		expect((templaterParseTemplate as any).mock.calls.length).toBe(1);
	});
}); 