import { beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateEngine } from "./TemplateEngine";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: vi.fn().mockImplementation(() => ({
		setTitle: vi.fn(),
		formatFileContent: vi.fn(async (content: string) => content),
		formatFileName: vi.fn(async (name: string) => name),
	})),
}));

vi.mock("../utilityObsidian", () => ({
	getTemplater: vi.fn(() => null),
	overwriteTemplaterOnce: vi.fn().mockResolvedValue(undefined),
}));

class TestTemplateEngine extends TemplateEngine {
	constructor(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor) {
		super(app, plugin, choiceExecutor);
	}

	public async run(): Promise<void> {}

	public async testIncrement(fileName: string) {
		return await this.incrementFileName(fileName);
	}

	public async testDuplicateSuffix(fileName: string) {
		return await this.appendDuplicateSuffix(fileName);
	}
}

describe("TemplateEngine collision file naming", () => {
	let engine: TestTemplateEngine;
	let mockApp: App;

	beforeEach(() => {
		vi.clearAllMocks();

		mockApp = {
			vault: {
				adapter: {
					exists: vi.fn(),
				},
				create: vi.fn(),
			},
		} as unknown as App;

		engine = new TestTemplateEngine(mockApp, {} as QuickAdd, {} as IChoiceExecutor);
	});

	it("appends 1 before .md when no number exists", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testIncrement("Note.md")).resolves.toBe("Note1.md");
	});

	it("preserves zero padding for markdown files", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testIncrement("Note009.md")).resolves.toBe(
			"Note010.md",
		);
	});

	it("preserves zero padding for identifier-like markdown files", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testIncrement("tt0780504.md")).resolves.toBe(
			"tt0780505.md",
		);
	});

	it("preserves zero padding for .canvas files", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testIncrement("tt009.canvas")).resolves.toBe(
			"tt010.canvas",
		);
	});

	it("preserves zero padding for .base files", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testIncrement("tt009.base")).resolves.toBe(
			"tt010.base",
		);
	});

	it("recurses incrementing until an available file name is found", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => {
				return path === "Note.md" || path === "Note1.md";
			},
		);

		await expect(engine.testIncrement("Note.md")).resolves.toBe("Note2.md");
	});

	it("appends a duplicate suffix to markdown files", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testDuplicateSuffix("Note.md")).resolves.toBe(
			"Note (1).md",
		);
	});

	it("increments an existing duplicate suffix", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testDuplicateSuffix("Note (1).md")).resolves.toBe(
			"Note (2).md",
		);
	});

	it("preserves trailing digits when adding a duplicate suffix", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testDuplicateSuffix("Note1.md")).resolves.toBe(
			"Note1 (1).md",
		);
	});

	it("adds a duplicate suffix for identifier-like markdown files", async () => {
		(mockApp.vault.adapter.exists as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(engine.testDuplicateSuffix("tt0780504.md")).resolves.toBe(
			"tt0780504 (1).md",
		);
	});
});
