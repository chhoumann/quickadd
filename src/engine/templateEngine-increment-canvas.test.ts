import { describe, it, expect, beforeEach, vi } from "vitest";
import { TemplateEngine } from "./TemplateEngine";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";

// Minimal mocks
vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: vi.fn().mockImplementation(() => ({
		setTitle: vi.fn(),
		formatFileContent: vi.fn(async (c: string) => c),
		formatFileName: vi.fn(async (n: string) => n),
	})),
}));

vi.mock("../utilityObsidian", () => ({
	getTemplater: vi.fn(() => null),
	overwriteTemplaterOnce: vi.fn().mockResolvedValue(undefined),
}));

class TestTemplateEngine extends TemplateEngine {
	public async run(): Promise<void> {}
	public async testIncrement(fileName: string) {
		return await this.incrementFileName(fileName);
	}
}

describe("TemplateEngine - incrementFileName for .canvas", () => {
	let engine: TestTemplateEngine;
	let mockApp: App;
	let mockPlugin: QuickAdd;
	let mockChoiceExecutor: IChoiceExecutor;

	beforeEach(() => {
		vi.clearAllMocks();

		mockApp = {
			vault: {
				adapter: {
					exists: vi.fn(),
				},
				create: vi.fn(),
			},
		} as any;

		mockPlugin = {} as any;
		mockChoiceExecutor = {} as any;
		engine = new TestTemplateEngine(mockApp, mockPlugin, mockChoiceExecutor);
	});

	it("appends 1 before .canvas when no number exists", async () => {
		(mockApp.vault.adapter.exists as any)
			.mockResolvedValueOnce(true) // Note.canvas exists
			.mockResolvedValueOnce(false); // Note1.canvas does not exist
		const out = await engine.testIncrement("Note.canvas");
		expect(out).toBe("Note1.canvas");
	});

	it("increments trailing number for .canvas", async () => {
		(mockApp.vault.adapter.exists as any)
			.mockResolvedValueOnce(true) // Note1.canvas exists
			.mockResolvedValueOnce(false); // Note2.canvas does not exist
		const out = await engine.testIncrement("Note1.canvas");
		expect(out).toBe("Note2.canvas");
	});

	it("recurses until available name for .canvas", async () => {
		(mockApp.vault.adapter.exists as any).mockImplementation(
			async (p: string) => {
				if (p === "Note.canvas") return true;
				if (p === "Note1.canvas") return true;
				if (p === "Note2.canvas") return false;
				return false;
			}
		);
		const out = await engine.testIncrement("Note.canvas");
		expect(out).toBe("Note2.canvas");
	});

	it("works similarly for .md", async () => {
		(mockApp.vault.adapter.exists as any)
			.mockResolvedValueOnce(true) // Doc.md exists
			.mockResolvedValueOnce(false);
		const out = await engine.testIncrement("Doc.md");
		expect(out).toBe("Doc1.md");
	});
});
